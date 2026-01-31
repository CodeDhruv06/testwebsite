import math

LEFT_EYE = [33, 133]
RIGHT_EYE = [362, 263]
NOSE = 1

def distance(a, b):
    return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)

def is_looking_away(landmarks) -> bool:
    left = landmarks.landmark[LEFT_EYE[0]]
    right = landmarks.landmark[RIGHT_EYE[1]]
    nose = landmarks.landmark[NOSE]

    eye_mid_x = (left.x + right.x) / 2

    # Increased threshold from 0.015 to 0.025 for less sensitivity
    if abs(nose.x - eye_mid_x) > 0.016:
        return True

    return False
