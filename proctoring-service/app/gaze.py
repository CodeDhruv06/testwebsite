import base64
import cv2
import threading
import numpy as np
import mediapipe as mp
from utils import is_looking_away

mp_face = mp.solutions.face_mesh
face_mesh_lock = threading.Lock()
face_mesh = mp_face.FaceMesh( static_image_mode=False,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7)

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
