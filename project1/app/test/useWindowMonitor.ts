"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const PROCTORING_SERVICE_URL = process.env.NEXT_PUBLIC_PROCTOR_URL ?? "http://localhost:8000";

interface WindowMonitorConfig {
  enabled: boolean;
  checkInterval?: number; // ms between checks, default 1000
  onViolation: (windowTitle: string) => void;
}

export function useWindowMonitor({ enabled, checkInterval = 1000, onViolation }: WindowMonitorConfig) {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [windowsAvailable, setWindowsAvailable] = useState<boolean | null>(null);
  const [allowedWindow, setAllowedWindow] = useState<string | null>(null);
  const [currentWindow, setCurrentWindow] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize monitoring - set current window as allowed
  const initializeMonitoring = useCallback(async () => {
    try {
      const res = await fetch(`${PROCTORING_SERVICE_URL}/window/set-allowed`, {
        method: "POST",
      });
      
      const data = await res.json();
      
      if (data.windows_available === false) {
        console.log("Window monitoring not available (proctoring service not on Windows)");
        setWindowsAvailable(false);
        return false;
      }
      
      setWindowsAvailable(true);
      
      if (data.success) {
        setAllowedWindow(data.allowed_window);
        setIsMonitoring(true);
        console.log(`✅ Window monitoring initialized. Allowed window: "${data.allowed_window}"`);
        return true;
      } else {
        console.error("Failed to set allowed window:", data.error);
        return false;
      }
    } catch (error) {
      console.error("Error initializing window monitoring:", error);
      setWindowsAvailable(false);
      return false;
    }
  }, []);

  // Check current window
  const checkWindow = useCallback(async () => {
    if (!isMonitoring || !enabled) return;
    
    try {
      const res = await fetch(`${PROCTORING_SERVICE_URL}/window/check`);
      const data = await res.json();
      
      if (data.windows_available === false) {
        return;
      }
      
      setCurrentWindow(data.current_window);
      
      if (data.violation) {
        console.log(`⚠️ WINDOW VIOLATION: User switched to "${data.current_window}"`);
        onViolation(data.current_window);
      }
    } catch (error) {
      // Silent fail - proctoring service may be unavailable
    }
  }, [isMonitoring, enabled, onViolation]);

  // Stop monitoring
  const stopMonitoring = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    try {
      await fetch(`${PROCTORING_SERVICE_URL}/window/reset`, { method: "POST" });
    } catch {
      // Ignore errors on reset
    }
    
    setIsMonitoring(false);
    setAllowedWindow(null);
    console.log("Window monitoring stopped");
  }, []);

  // Start/stop interval based on enabled state
  useEffect(() => {
    if (enabled && isMonitoring) {
      // Start checking
      intervalRef.current = setInterval(checkWindow, checkInterval);
      console.log(`Window check interval started (every ${checkInterval}ms)`);
    } else {
      // Stop checking
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isMonitoring, checkInterval, checkWindow]);

  // Close other applications (not browser tabs)
  const closeOtherApps = useCallback(async () => {
    try {
      const res = await fetch(`${PROCTORING_SERVICE_URL}/window/close-others`, {
        method: "POST",
      });
      
      const data = await res.json();
      
      if (data.success) {
        console.log(`✅ Closed ${data.closed_count} other application(s)`);
        if (data.closed && data.closed.length > 0) {
          console.log("Closed apps:", data.closed.map((a: { title: string }) => a.title).join(", "));
        }
        return {
          success: true,
          closedCount: data.closed_count,
          closedApps: data.closed || []
        };
      } else {
        console.log("Failed to close other apps:", data.error);
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error("Error closing other apps:", error);
      return { success: false, error: "Network error" };
    }
  }, []);

  // List all windows (for debugging)
  const listWindows = useCallback(async () => {
    try {
      const res = await fetch(`${PROCTORING_SERVICE_URL}/window/list`);
      const data = await res.json();
      return data;
    } catch (error) {
      console.error("Error listing windows:", error);
      return null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    initializeMonitoring,
    stopMonitoring,
    closeOtherApps,
    listWindows,
    isMonitoring,
    windowsAvailable,
    allowedWindow,
    currentWindow,
  };
}
