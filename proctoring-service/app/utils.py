import math
import psutil

# Try to import Windows-specific modules
try:
    import pygetwindow as gw
    import win32process  # type: ignore
    import win32gui  # type: ignore
    WINDOWS_AVAILABLE = True
except ImportError:
    WINDOWS_AVAILABLE = False

LEFT_EYE = [33, 133]
RIGHT_EYE = [362, 263]
NOSE = 1

# Head pose thresholds
YAW_THRESHOLD = 20
PITCH_THRESHOLD = 15

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

def get_active_window_pid():
    """Returns the Process ID (PID) of the currently active window."""
    if not WINDOWS_AVAILABLE:
        return None
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return pid
    except:
        return None

def get_active_window():
    """Returns the currently active window object."""
    if not WINDOWS_AVAILABLE:
        return None
    try:
        return gw.getActiveWindow()
    except:
        return None

def kill_process_by_pid(pid):
    """Kills a process given its PID."""
    try:
        process = psutil.Process(pid)
        process_name = process.name()
        process.terminate()  # Try graceful termination first
        print(f"🚫 BLOCKED: Killed unauthorized app '{process_name}'")
        return True
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return False

def activate_window(window):
    """Activates (brings to foreground) the specified window."""
    if window is None:
        return False
    try:
        window.activate()
        return True
    except:
        return False
