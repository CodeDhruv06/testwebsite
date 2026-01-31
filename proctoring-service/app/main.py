from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import numpy as np
import cv2
from gaze import analyze_gaze

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
