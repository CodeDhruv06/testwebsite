from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import numpy as np
import cv2
import time
import sys
from gaze import analyze_gaze, analyze_gaze_with_head_pose, process_frame_cv2
from utils import (
    get_active_window_pid, 
    get_active_window, 
    kill_process_by_pid, 
    activate_window,
    WINDOWS_AVAILABLE
)

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods including OPTIONS
    allow_headers=["*"],  # Allow all headers
)

class FramePayload(BaseModel):
    image: str

class WindowCheckPayload(BaseModel):
    allowed_window_title: str = None

def decode_base64_image(b64):
    img_bytes = base64.b64decode(b64)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return frame

@app.post("/verify-gaze")
def verify_gaze(payload: FramePayload):
    try:
        violation = analyze_gaze(payload.image)
        return {
            "violation": violation,
            "looking_away": violation
        }
    except Exception as e:
        print(f"Error in verify_gaze: {e}")
        return {
            "violation": False,
            "looking_away": False
        }

@app.post("/verify-gaze-enhanced")
def verify_gaze_enhanced(payload: FramePayload):
    """Enhanced gaze verification with head pose estimation."""
    try:
        result = analyze_gaze_with_head_pose(payload.image)
        return result
    except Exception as e:
        print(f"Error in verify_gaze_enhanced: {e}")
        return {
            "violation": False,
            "direction": "error",
            "error": str(e)
        }


# Store the allowed window title for monitoring
allowed_window_store = {"title": None, "pid": None}

@app.post("/window/set-allowed")
def set_allowed_window():
    """Set the currently active window as the allowed window for the test."""
    if not WINDOWS_AVAILABLE:
        return {
            "success": False,
            "error": "Window monitoring not available (not running on Windows)",
            "windows_available": False
        }
    
    try:
        window = get_active_window()
        pid = get_active_window_pid()
        
        if window is None:
            return {"success": False, "error": "Could not detect active window"}
        
        allowed_window_store["title"] = window.title
        allowed_window_store["pid"] = pid
        
        return {
            "success": True,
            "allowed_window": window.title,
            "allowed_pid": pid,
            "windows_available": True
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/window/check")
def check_window():
    """Check if the current active window matches the allowed window."""
    if not WINDOWS_AVAILABLE:
        return {
            "violation": False,
            "windows_available": False,
            "message": "Window monitoring not available"
        }
    
    if allowed_window_store["title"] is None:
        return {
            "violation": False,
            "windows_available": True,
            "message": "No allowed window set. Call /window/set-allowed first."
        }
    
    try:
        current_window = get_active_window()
        current_pid = get_active_window_pid()
        
        if current_window is None:
            return {
                "violation": False,
                "current_window": None,
                "allowed_window": allowed_window_store["title"]
            }
        
        # Check if window changed
        is_violation = (
            current_pid != allowed_window_store["pid"] and 
            current_window.title != allowed_window_store["title"]
        )
        
        return {
            "violation": is_violation,
            "current_window": current_window.title,
            "current_pid": current_pid,
            "allowed_window": allowed_window_store["title"],
            "allowed_pid": allowed_window_store["pid"],
            "windows_available": True
        }
    except Exception as e:
        return {
            "violation": False,
            "error": str(e),
            "windows_available": True
        }


@app.get("/window/status")
def window_status():
    """Get the current window monitoring status."""
    return {
        "windows_available": WINDOWS_AVAILABLE,
        "allowed_window": allowed_window_store.get("title"),
        "allowed_pid": allowed_window_store.get("pid"),
        "monitoring_active": allowed_window_store["title"] is not None
    }


@app.post("/window/reset")
def reset_window_monitoring():
    """Reset the allowed window (stop monitoring)."""
    allowed_window_store["title"] = None
    allowed_window_store["pid"] = None
    return {"success": True, "message": "Window monitoring reset"}


def start_monitoring():
    """
    Standalone monitoring mode with window tracking and gaze detection.
    This function is called when running the script directly (not as FastAPI server).
    """
    if not WINDOWS_AVAILABLE:
        print("❌ ERROR: Windows-specific modules not available. This feature only works on Windows.")
        return
    
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("❌ ERROR: Could not open camera.")
        return
    
    print("\n--- 🔒 SECURE TEST ENVIRONMENT ---")
    print("1. Open the Test Window (Browser or App).")
    print("2. You have 5 seconds to CLICK inside that window to set it as the 'Allowed' window.")
    
    for i in range(5, 0, -1):
        print(f"Locking in {i}...")
        time.sleep(1)

    try:
        allowed_window = get_active_window()
        if allowed_window is None:
            print("❌ ERROR: Could not detect active window. Exiting.")
            cap.release()
            return
            
        allowed_title = allowed_window.title
        allowed_pid = get_active_window_pid()
        
        print(f"\n✅ TARGET LOCKED: '{allowed_title}' (PID: {allowed_pid})")
        print("Any other window opened or clicked will be CLOSED immediately.")
        print("Press 'q' in the camera window to end the test session.\n")
        
    except AttributeError as e:
        print(f"❌ ERROR: Could not detect active window. {e}")
        cap.release()
        return

    violation_count = 0
    
    while cap.isOpened():
        success, image = cap.read()
        if not success:
            continue

        # Window monitoring
        current_window = get_active_window()
        current_pid = get_active_window_pid()

        if current_pid is not None and current_pid != allowed_pid:
            if current_window is not None and current_window.title != allowed_title:
                print(f"⚠️ CHEATING ATTEMPT: User switched to '{current_window.title}'")
                kill_process_by_pid(current_pid)
                activate_window(allowed_window)

        # Gaze detection with head pose estimation
        result = process_frame_cv2(image)
        annotated_image = result.get("image", image)
        
        if result.get("violation", False):
            violation_count += 1
            if violation_count % 30 == 0:  # Log every ~1 second at 30fps
                print(f"⚠️ GAZE VIOLATION: {result.get('direction', 'unknown')}")

        cv2.imshow('Proctor Monitor (Press Q to quit)', annotated_image)

        if cv2.waitKey(5) & 0xFF == ord('q'):
            break

    print(f"\n📊 Session ended. Total gaze violations detected: {violation_count}")
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--monitor":
        # Run standalone monitoring mode
        start_monitoring()
    else:
        # Default: print help
        print("Proctoring Service")
        print("==================")
        print("\nUsage:")
        print("  python main.py --monitor    : Run standalone monitoring mode (Windows only)")
        print("  uvicorn main:app --reload   : Run as FastAPI server")
        print("\nAPI Endpoints (when running as server):")
        print("  POST /verify-gaze           : Basic gaze verification")
        print("  POST /verify-gaze-enhanced  : Enhanced gaze with head pose estimation")
