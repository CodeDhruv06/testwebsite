import base64
import cv2
import threading
import numpy as np
import mediapipe as mp
from utils import is_looking_away, YAW_THRESHOLD, PITCH_THRESHOLD

mp_face = mp.solutions.face_mesh
face_mesh_lock = threading.Lock()
face_mesh = mp_face.FaceMesh(
    static_image_mode=False,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)

def analyze_gaze(base64_img: str) -> bool:
    try:
        img_bytes = base64.b64decode(base64_img)
        img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
        
        # Check if image was decoded successfully
        if img is None or img.size == 0:
            print("Error: Failed to decode image")
            return False  # no violation if image can't be processed
        
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        with face_mesh_lock:
            results = face_mesh.process(rgb)

        if not results.multi_face_landmarks:
            return False  # no face = no violation detected

        return is_looking_away(results.multi_face_landmarks[0])
    except Exception as e:
        print(f"Error in analyze_gaze: {e}")
        return False


def analyze_gaze_with_head_pose(base64_img: str) -> dict:
    """
    Enhanced gaze analysis using head pose estimation.
    Returns a dict with violation status and direction info.
    """
    try:
        img_bytes = base64.b64decode(base64_img)
        image = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
        
        if image is None or image.size == 0:
            return {"violation": False, "direction": "unknown", "error": "Failed to decode image"}
        
        image = cv2.flip(image, 1)
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        with face_mesh_lock:
            results = face_mesh.process(image_rgb)
        
        img_h, img_w, _ = image.shape

        if not results.multi_face_landmarks:
            return {"violation": False, "direction": "no_face", "yaw": 0, "pitch": 0}

        for face_landmarks in results.multi_face_landmarks:
            face_3d = []
            face_2d = []

            for idx, lm in enumerate(face_landmarks.landmark):
                if idx in [33, 263, 1, 61, 291, 199]:
                    x, y = int(lm.x * img_w), int(lm.y * img_h)
                    face_2d.append([x, y])
                    face_3d.append([x, y, lm.z])

            face_2d = np.array(face_2d, dtype=np.float64)
            face_3d = np.array(face_3d, dtype=np.float64)

            focal_length = 1 * img_w
            cam_matrix = np.array([
                [focal_length, 0, img_h / 2],
                [0, focal_length, img_w / 2],
                [0, 0, 1]
            ])
            dist_matrix = np.zeros((4, 1), dtype=np.float64)

            success, rot_vec, trans_vec = cv2.solvePnP(face_3d, face_2d, cam_matrix, dist_matrix)
            rmat, _ = cv2.Rodrigues(rot_vec)
            angles, _, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

            x_angle = angles[0] * 360  # Pitch
            y_angle = angles[1] * 360  # Yaw

            direction = "focused"
            violation = False

            if y_angle < -YAW_THRESHOLD:
                direction = "looking_left"
                violation = True
            elif y_angle > YAW_THRESHOLD:
                direction = "looking_right"
                violation = True
            elif x_angle < -PITCH_THRESHOLD:
                direction = "looking_down"
                violation = True
            elif x_angle > PITCH_THRESHOLD:
                direction = "looking_up"
                violation = True

            return {
                "violation": violation,
                "direction": direction,
                "yaw": round(y_angle, 2),
                "pitch": round(x_angle, 2)
            }

        return {"violation": False, "direction": "focused", "yaw": 0, "pitch": 0}
        
    except Exception as e:
        print(f"Error in analyze_gaze_with_head_pose: {e}")
        return {"violation": False, "direction": "error", "error": str(e)}


def process_frame_cv2(image: np.ndarray) -> dict:
    """
    Process a CV2 image frame directly (for standalone monitoring mode).
    Returns dict with violation status, direction, and annotated image.
    """
    try:
        image = cv2.flip(image, 1)
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        with face_mesh_lock:
            results = face_mesh.process(image_rgb)
        
        img_h, img_w, _ = image.shape

        if not results.multi_face_landmarks:
            return {
                "violation": False,
                "direction": "no_face",
                "image": image,
                "yaw": 0,
                "pitch": 0
            }

        for face_landmarks in results.multi_face_landmarks:
            face_3d = []
            face_2d = []

            for idx, lm in enumerate(face_landmarks.landmark):
                if idx in [33, 263, 1, 61, 291, 199]:
                    x, y = int(lm.x * img_w), int(lm.y * img_h)
                    face_2d.append([x, y])
                    face_3d.append([x, y, lm.z])

            face_2d = np.array(face_2d, dtype=np.float64)
            face_3d = np.array(face_3d, dtype=np.float64)

            focal_length = 1 * img_w
            cam_matrix = np.array([
                [focal_length, 0, img_h / 2],
                [0, focal_length, img_w / 2],
                [0, 0, 1]
            ])
            dist_matrix = np.zeros((4, 1), dtype=np.float64)

            success, rot_vec, trans_vec = cv2.solvePnP(face_3d, face_2d, cam_matrix, dist_matrix)
            rmat, _ = cv2.Rodrigues(rot_vec)
            angles, _, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

            x_angle = angles[0] * 360  # Pitch
            y_angle = angles[1] * 360  # Yaw

            direction = "focused"
            violation = False
            text = "Focused"

            if y_angle < -YAW_THRESHOLD:
                direction = "looking_left"
                violation = True
                text = "Looking Left!"
            elif y_angle > YAW_THRESHOLD:
                direction = "looking_right"
                violation = True
                text = "Looking Right!"
            elif x_angle < -PITCH_THRESHOLD:
                direction = "looking_down"
                violation = True
                text = "Looking Down!"
            elif x_angle > PITCH_THRESHOLD:
                direction = "looking_up"
                violation = True
                text = "Looking Up!"

            # Annotate image
            if violation:
                cv2.putText(image, "WARNING: " + text, (20, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            else:
                cv2.putText(image, text, (20, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

            return {
                "violation": violation,
                "direction": direction,
                "image": image,
                "yaw": round(y_angle, 2),
                "pitch": round(x_angle, 2)
            }

        return {
            "violation": False,
            "direction": "focused",
            "image": image,
            "yaw": 0,
            "pitch": 0
        }
        
    except Exception as e:
        print(f"Error in process_frame_cv2: {e}")
        return {
            "violation": False,
            "direction": "error",
            "image": image,
            "error": str(e)
        }
