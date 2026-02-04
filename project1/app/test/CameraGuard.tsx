"use client";

import { useProctoring } from "./useProctoring";
import { useEffect, useState } from "react";

export default function CameraGuard({ attemptId, onStatusChange, onCounterUpdate }: { attemptId: string; onStatusChange?: (status: string, count: number, type?: string) => void; onCounterUpdate?: (count: number) => void }) {
  const [isLocked, setIsLocked] = useState(false);
  
  const { videoRef, violations, recordViolation } = useProctoring(attemptId, async () => {
    console.log("Camera violation detected - sending to backend...");
    try {
      const res = await fetch(`/api/public/session/${attemptId}/violation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CAMERA" }),
      });
      
      const data = await res.json();
      console.log("Backend response:", data);
      
      if (data.violationsCount !== undefined) {
        recordViolation(data.violationsCount);
      }
      
      if (data.status === "locked") {
        setIsLocked(true);
        // Notify parent component to update status with reason
        onStatusChange?.("locked", data.violationsCount, "CAMERA");
      }
    } catch (error) {
      console.error("Error sending violation:", error);
    }
  });

  useEffect(() => {
    if (typeof violations === "number") {
      onCounterUpdate?.(violations);
    }
  }, [violations, onCounterUpdate]);

  return (
    <>
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className="fixed bottom-4 left-4 z-20 h-28 w-36 rounded-xl border border-zinc-300 bg-black shadow-md object-cover"
      />
      {/* Counter moved to top bar via parent */}
    </>
  );
}
