"use client";

import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import axios from "axios";
import Modal from "./Modal";
import QuestionNav from "./QuestionNAv";
import QuestionPanel from "./QuestionPanel";
import Banner from "./Banner";
import { useWindowMonitor } from "@/app/test/useWindowMonitor";
import { useTabMonitor } from "@/app/test/useTabMonitor";

function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const TestShell = forwardRef(function TestShell({ token, onAttemptIdReceived }: { token: string; onAttemptIdReceived?: (id: string) => void }, ref) {
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");

  const [attemptId, setAttemptId] = useState("");
  const [test, setTest] = useState<any>(null);

  const [currentIndex, setCurrentIndex] = useState(0);

  // answersMap: questionId -> optionIndex
  const [answersMap, setAnswersMap] = useState<Map<string, number>>(() => new Map());

  const [secondsLeft, setSecondsLeft] = useState(0);

  const [status, setStatus] = useState("idle"); // idle|active|locked|submitted
  const [violationsCount, setViolationsCount] = useState(0);
  const [lockReason, setLockReason] = useState("");
  const [camViolationsCount, setCamViolationsCount] = useState(0);
  const CAMERA_MAX = 3;

  // Window monitoring state
  const [windowMonitoringEnabled, setWindowMonitoringEnabled] = useState(false);
  
  // Tab monitoring state
  const [tabMonitoringEnabled, setTabMonitoringEnabled] = useState(false);
  const [otherTabsDetected, setOtherTabsDetected] = useState(false);
  const [otherTabsCount, setOtherTabsCount] = useState(0);

  // Pre-checks (camera/mic/speaker) before starting the test
  const preVideoRef = useRef<HTMLVideoElement>(null);
  const preCamStreamRef = useRef<MediaStream | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [camLoading, setCamLoading] = useState(false);
  const [micLoading, setMicLoading] = useState(false);
  const [speakerLoading, setSpeakerLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // modals
  const [warnOpen, setWarnOpen] = useState(false);
  const [warnText, setWarnText] = useState("");

  const [submitOpen, setSubmitOpen] = useState(false);

  const autosaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(status);

  // Keep statusRef in sync with status state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Expose updateStatus method to parent via ref
  useImperativeHandle(ref, () => ({
    updateStatus: (newStatus: string, count: number, violationType?: string) => {
      setStatus(newStatus);
      setViolationsCount(count);
      if (newStatus === "locked" && violationType) {
        const reasons: { [key: string]: string } = {
          "CAMERA": "📷 Camera violation detected - you were looking away from the screen",
          "FULLSCREEN_EXIT": "⚠️ You exited fullscreen mode",
          "TAB_HIDDEN": "⚠️ You switched tabs during the test",
          "BLUR": "⚠️ You switched away from the test window",
          "LOOKING_AWAY": "📷 You were looking away from the screen",
          "WINDOW_SWITCH": "🖥️ You switched to another application",
          "MULTIPLE_TABS": "🔀 Multiple browser tabs detected"
        };
        setLockReason(reasons[violationType] || `Test locked due to ${violationType}`);
      }
    },
    updateCameraViolations: (count: number) => {
      setCamViolationsCount(count);
    }
  }));

  const questions = useMemo(() => test?.questions || [], [test]);
  const currentQ = questions[currentIndex];

  // ---- Start exam: fullscreen + create session
  async function startTest() {
    try {
      setStarting(true);
      
      // STEP 1: Close other Windows applications (not browser tabs)
      // First, set current window as allowed
      const windowInitResult = await initializeMonitoring();
      if (windowInitResult) {
        // Now close other apps
        console.log("Attempting to close other applications...");
        const appCloseResult = await closeOtherApps();
        if (appCloseResult.success && appCloseResult.closedCount > 0) {
          console.log(`✅ Closed ${appCloseResult.closedCount} other application(s)`);
        }
      }
      
      // STEP 2: Check for other browser tabs
      const tabCheckResult = await initTabMonitoring();
      if (tabCheckResult.success && tabCheckResult.otherTabsCount > 0) {
        // Try to close other tabs automatically
        console.log(`Found ${tabCheckResult.otherTabsCount} other tab(s). Attempting to close them...`);
        const closeResult = await closeOtherTabs();
        
        if (closeResult.remaining > 0) {
          // Some tabs couldn't be closed (manually opened tabs)
          setWarnText(`⚠️ Could not close ${closeResult.remaining} tab(s) automatically. Please close them manually before starting the test.`);
          setWarnOpen(true);
          setStarting(false);
          stopTabMonitoring();
          return;
        } else {
          console.log(`✅ Successfully closed ${closeResult.closed} other tab(s)`);
        }
      }
      
      // Try to request fullscreen (optional - may fail in some browsers)
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (fsError) {
        console.warn("Fullscreen not available:", fsError);
      }

      setLoading(true);
      const res = await axios.get(`/api/public/session`, {
        params: { token },
      });

      if (!res.data || !res.data.test) {
        throw new Error("Invalid response data from server");
      }

      setAttemptId(res.data.attemptId);
      onAttemptIdReceived?.(res.data.attemptId);
      setTest(res.data.test);

      setSecondsLeft(res.data.test.durationSeconds || 0);
      setStatus("active");
      setLoading(false);
      setStarting(false);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Failed to start test session";
      setFatalError(msg);
      setLoading(false);
      setStarting(false);
    }
  }

  // ---- pre-checks helpers
  async function enableCameraPre() {
    try {
      setCamLoading(true);
      // Stop any previous camera tracks to avoid conflicts
      preCamStreamRef.current?.getTracks().forEach((t) => t.stop());

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      preCamStreamRef.current = stream;
      // Mark ready so the preview element renders, then attach in effect
      setCamReady(true);
      setCamLoading(false);
    } catch (err) {
      setCamReady(false);
      setCamLoading(false);
      setWarnText("Camera permission is required to proceed.");
      setWarnOpen(true);
    }
  }

  // Attach stream to preview once the element exists after camReady state updates
  useEffect(() => {
    async function attachPreview() {
      if (!camReady) return;
      const v = preVideoRef.current;
      const stream = preCamStreamRef.current;
      if (!v || !stream) return;
      (v as any).srcObject = stream as any;
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          v.removeEventListener("loadedmetadata", onLoaded);
          resolve();
        };
        if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) resolve();
        else v.addEventListener("loadedmetadata", onLoaded, { once: true });
      });
      try { await v.play(); } catch {}
    }
    attachPreview();
  }, [camReady]);

  async function enableMicPre() {
    try {
      setMicLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current!;
      const source = ctx.createMediaStreamSource(stream);
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      if (meterTimerRef.current) clearInterval(meterTimerRef.current);
      meterTimerRef.current = setInterval(() => {
        const analyser = analyserRef.current!;
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128; // -1..1
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length); // 0..1
        setMicLevel(Math.min(1, rms));
      }, 200);
      setMicReady(true);
      setMicLoading(false);
    } catch (err) {
      setMicReady(false);
      setMicLoading(false);
      setWarnText("Microphone permission failed. Please check your browser settings.");
      setWarnOpen(true);
    }
  }

  function playSpeakerTone() {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660; // test tone
    gain.gain.value = 0.05; // gentle volume
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setSpeakerLoading(true);
    setTimeout(() => { osc.stop(); ctx.close(); setSpeakerLoading(false); }, 800);
  }

  useEffect(() => {
    return () => {
      if (meterTimerRef.current) clearInterval(meterTimerRef.current);
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close?.();
    };
  }, []);

  // ---- autosave
  async function saveAnswers() {
    if (!attemptId || status !== "active") return;

    const answers = Array.from(answersMap.entries()).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));

    try {
      await axios.post(`/api/public/session/${attemptId}/save`, {
        answers,
      });
    } catch {
      // silent autosave fail
    }
  }

  // ---- submit
  async function submitAttempt() {
    if (!attemptId) return;

    try {
      await axios.post(`/api/public/session/${attemptId}/submit`);
      setStatus("submitted");
      setSubmitOpen(false);

      // exit fullscreen automatically on submit (optional)
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.response?.data?.message || "Submit failed");
    }
  }

  // ---- violation
  async function reportViolation(type: string) {
    if (!attemptId || statusRef.current !== "active") return;

    try {
      const res = await axios.post(
        `/api/public/session/${attemptId}/violation`,
        { type }
      );

      setViolationsCount(res.data.violationsCount);

      if (res.data.status === "locked") {
        // Set lock reason based on violation type
        const reasons: { [key: string]: string } = {
          "CAMERA": "📷 Camera violation detected - you were looking away from the screen",
          "FULLSCREEN_EXIT": "⚠️ You exited fullscreen mode",
          "TAB_HIDDEN": "⚠️ You switched tabs during the test",
          "BLUR": "⚠️ You switched away from the test window",
          "LOOKING_AWAY": "📷 You were looking away from the screen",
          "WINDOW_SWITCH": "🖥️ You switched to another application",
          "MULTIPLE_TABS": "🔀 Multiple browser tabs detected"
        };
        setLockReason(reasons[type] || `Test locked due to ${type}`);
        setStatus("locked");
        // No warning modal - just lock silently
      }
    } catch {
      // ignore
    }
  }

  // ---- Window monitoring hook
  const handleWindowViolation = useCallback((windowTitle: string) => {
    console.log(`🖥️ Window violation detected: switched to "${windowTitle}"`);
    reportViolation("WINDOW_SWITCH");
  }, [attemptId]);

  const { 
    initializeMonitoring, 
    stopMonitoring, 
    closeOtherApps,
    isMonitoring: windowMonitorActive,
    windowsAvailable,
    allowedWindow 
  } = useWindowMonitor({
    enabled: windowMonitoringEnabled && status === "active",
    checkInterval: 1000, // Check every second
    onViolation: handleWindowViolation,
  });

  // ---- Tab monitoring hook
  const handleTabViolation = useCallback(async (tabCount: number) => {
    console.log(`🔀 Tab violation detected: ${tabCount} other tab(s) open. Attempting to close...`);
    setOtherTabsCount(tabCount);
    setOtherTabsDetected(true);
    // Report the violation (will lock test if max violations exceeded)
    reportViolation("MULTIPLE_TABS");
  }, [attemptId]);

  const {
    initializeMonitoring: initTabMonitoring,
    stopMonitoring: stopTabMonitoring,
    checkForOtherTabs,
    closeOtherTabs,
    requestOtherTabsClose,
    isMonitoring: tabMonitorActive,
    otherTabsCount: currentOtherTabsCount,
  } = useTabMonitor({
    enabled: tabMonitoringEnabled && status === "active",
    onMultipleTabsDetected: handleTabViolation,
  });

  // Initialize window monitoring when test becomes active
  useEffect(() => {
    if (status === "active" && !windowMonitorActive) {
      initializeMonitoring().then((success) => {
        if (success) {
          setWindowMonitoringEnabled(true);
          console.log("✅ Window monitoring started");
        }
      });
    } else if (status !== "active" && windowMonitorActive) {
      stopMonitoring();
      setWindowMonitoringEnabled(false);
    }
  }, [status, windowMonitorActive, initializeMonitoring, stopMonitoring]);

  // Initialize tab monitoring when test becomes active
  useEffect(() => {
    if (status === "active" && !tabMonitorActive) {
      initTabMonitoring().then((result) => {
        if (result.success) {
          setTabMonitoringEnabled(true);
          console.log("✅ Tab monitoring started");
          
          // If other tabs were detected on start, report violation immediately
          if (result.otherTabsCount > 0) {
            console.log(`⚠️ Found ${result.otherTabsCount} other tab(s) on test start!`);
            setOtherTabsCount(result.otherTabsCount);
            setOtherTabsDetected(true);
            reportViolation("MULTIPLE_TABS");
          }
        }
      });
    } else if (status !== "active" && tabMonitorActive) {
      stopTabMonitoring();
      setTabMonitoringEnabled(false);
    }
  }, [status, tabMonitorActive, initTabMonitoring, stopTabMonitoring]);

  // ---- start timers when active
  useEffect(() => {
    if (status !== "active") return;

    // countdown
    tickTimer.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // time over -> auto submit
          if (tickTimer.current) clearInterval(tickTimer.current);
          setSubmitOpen(false);
          submitAttempt();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // autosave every 10 seconds
    autosaveTimer.current = setInterval(() => {
      saveAnswers();
    }, 10000);

    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current);
      if (autosaveTimer.current) clearInterval(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, attemptId, answersMap]);

  // ---- proctoring-lite events (tab switch / blur / fullscreen exit)
  useEffect(() => {
    if (status !== "active") return;

    let fsTimeout: NodeJS.Timeout | null = null;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") reportViolation("TAB_HIDDEN");
    };

    const onBlur = () => {
      reportViolation("BLUR");
    };

    const onFsChange = () => {
      if (fsTimeout) clearTimeout(fsTimeout);

      fsTimeout = setTimeout(() => {
        const isFullscreen = Boolean(document.fullscreenElement);

        if (!isFullscreen && statusRef.current === "active") {
          console.log("🚨 Fullscreen exited — locking test");
          // Record violation server-side
          reportViolation("FULLSCREEN_EXIT");
          // Immediately lock locally and show reason
          setLockReason("⚠️ You exited fullscreen mode");
          setStatus("locked");
        }
      }, 150);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      if (fsTimeout) clearTimeout(fsTimeout);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, attemptId]);

  // ---- selecting answer
  function setAnswerForCurrent(optionIndex: number) {
    if (!currentQ || status !== "active") return;

    setAnswersMap((prev) => {
      const next = new Map(prev);
      next.set(currentQ._id, optionIndex);
      return next;
    });
  }

  // ---- UI states
  if (fatalError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-200 p-6">
        <div className="mx-auto max-w-xl">
          <Banner variant="error" title="Cannot open test" message={fatalError} />
        </div>
      </div>
    );
  }

  if (status === "submitted") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-200 p-6">
        <div className="mx-auto max-w-xl">
          <Banner variant="success" title="Your response has been submitted" message="Thank you for completing the test. You may now close this window." />
        </div>
      </div>
    );
  }

  if (loading && status === "idle") {
    return (
      <>
      <img src="banner.png" alt="banner" className="w-full h-24"/>
      <div className="split-layout">
        {/* Left 70vw: dark with levitating balls */}
        <div className="split-left p-6">
          {/* Balls background */}
          <span className="ball lg" style={{ top: 120, left: 240 }} />
          <span className="ball md" style={{ top: 320, left: 520, animationDelay: "0.6s" }} />
          <span className="ball sm" style={{ top: 60, left: 820, animationDelay: "0.3s" }} />
          <span className="ball sm" style={{ top: 420, left: 180, animationDelay: "1.0s" }} />

          <div className="relative z-10 mx-auto max-w-2xl space-y-6">
          <Banner
            variant="info"
            title="Pre-checks before starting"
            message="Enable camera, check microphone, and test speakers for a smooth proctored experience."
          />

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">Camera</div>
                <div className="mt-1 text-sm text-zinc-600">We need camera access to monitor during the test.</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${camReady ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-50 text-zinc-700 border border-zinc-200"}`}>{camReady ? "Ready" : "Not enabled"}</span>
                <button className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60" onClick={enableCameraPre} disabled={camLoading || camReady}>
                  {camLoading ? (
                    <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-700 animate-spin" aria-hidden="true"></span>
                  ) : camReady ? (
                    <span className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white" aria-hidden="true">✓</span>
                  ) : null}
                  {camReady ? "Camera Enabled" : "Enable Camera"}
                </button>
              </div>
            </div>
            {camReady ? (
              <div className="mt-3 text-xs text-zinc-600">Preview appears at bottom-left.</div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">Microphone</div>
                <div className="mt-1 text-sm text-zinc-600">Grant mic access and speak to see the meter move.</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${micReady ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-50 text-zinc-700 border border-zinc-200"}`}>{micReady ? "Ready" : "Not enabled"}</span>
                <button className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60" onClick={enableMicPre} disabled={micLoading || micReady}>
                  {micLoading ? (
                    <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-700 animate-spin" aria-hidden="true"></span>
                  ) : micReady ? (
                    <span className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white" aria-hidden="true">✓</span>
                  ) : null}
                  {micReady ? "Mic Enabled" : "Enable Mic"}
                </button>
              </div>
            </div>
            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-zinc-100">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.round(micLevel * 100))}%` }}></div>
              </div>
              <div className="mt-1 text-xs text-zinc-600">Mic level</div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">Speaker</div>
                <div className="mt-1 text-sm text-zinc-600">Play a short tone to confirm you can hear audio.</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${speakerReady ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-50 text-zinc-700 border border-zinc-200"}`}>{speakerReady ? "Confirmed" : "Not checked"}</span>
                <button className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60" onClick={playSpeakerTone} disabled={speakerLoading}>
                  {speakerLoading ? (
                    <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-700 animate-spin" aria-hidden="true"></span>
                  ) : speakerReady ? (
                    <span className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white" aria-hidden="true">✓</span>
                  ) : null}
                  {speakerReady ? "Tone Played" : "Play Test Tone"}
                </button>
                <button className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black" onClick={() => setSpeakerReady(true)}>I heard it</button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-600">You can start once camera is enabled. Mic and speaker checks are recommended.</div>
            <button
              className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-black disabled:opacity-50"
              onClick={startTest}
              disabled={!camReady || !micReady || !speakerReady || starting}
            >
              {starting ? (
                <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-700 animate-spin" aria-hidden="true"></span>
              ) : null}
              Start Test
            </button>
          </div>
          </div>
        </div>

        {/* Right 30vw: quote */}
        <div className="split-right">
          <div className="max-w-md">
            <p className="text-3xl italic leading-relaxed text-zinc-900">“Winners are not those who never fail but those who never quit.”</p>
            <p className="mt-4 text-zinc-600">– Dr. APJ Abdul Kalam</p>
          </div>
        </div>
        {/* Bottom-left camera preview */}
        {camReady ? (
          <video ref={preVideoRef} className="fixed bottom-4 left-4 z-20 h-28 w-36 rounded-xl border border-zinc-300 bg-black shadow-md" autoPlay playsInline muted />
        ) : null}
      </div>
      </>
    );
  }

  if (!test) return null;

  const disabled = status !== "active";

  return (
    <>
    <img src="banner.png" alt="banner" className="w-full h-24" />
    <div className="flex min-h-screen overflow-hidden">
      <QuestionPanel
        questions={questions}
        currentIndex={currentIndex}
        answersMap={answersMap}
        onJump={setCurrentIndex}
      />

      <div style={styles.main as React.CSSProperties}>
        <div className="bg-white/90 backdrop-blur border-b border-zinc-200 px-4 py-3 flex items-center justify-between" style={{ minHeight: 70 }}>
          <div className="flex items-center gap-4">
            <div className="font-extrabold">{test.title}</div>
            {/* Overall violations pill */}
            {(() => {
              const max = Math.max(1, Number(test.maxViolations) || 1);
              const count = Math.max(0, violationsCount);
              const pct = Math.min(100, Math.round((count / max) * 100));
              const level = status === "locked" ? "rose" : pct <= 33 ? "emerald" : pct <= 66 ? "amber" : "rose";
              const bg = `bg-${level}-50`;
              const text = `text-${level}-900`;
              const border = `border-${level}-200`;
              const fill = `bg-${level}-400`;
              return (
                <div className={`inline-flex items-center gap-2 rounded-xl border ${border} ${bg} ${text} px-3 py-1 text-xs font-medium shadow-sm`}> 
                  <span className={`h-2 w-2 rounded-full ${fill}`}></span>
                  <span>Violations {count}/{max}</span>
                  {status === "locked" ? (
                    <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-rose-700">LOCKED</span>
                  ) : null}
                  <span className="ml-2 inline-block h-2 w-24 rounded-full bg-white/60">
                    <span className={`block h-2 rounded-full ${fill}`} style={{ width: `${pct}%` }}></span>
                  </span>
                </div>
              );
            })()}
            {/* Camera violations pill (same style) */}
            {(() => {
              const max = CAMERA_MAX;
              const count = Math.max(0, camViolationsCount);
              const pct = Math.min(100, Math.round((count / max) * 100));
              const level = status === "locked" ? "rose" : pct <= 33 ? "emerald" : pct <= 66 ? "amber" : "rose";
              const bg = `bg-${level}-50`;
              const text = `text-${level}-900`;
              const border = `border-${level}-200`;
              const fill = `bg-${level}-400`;
              return (
                <div className={`inline-flex items-center gap-2 rounded-xl border ${border} ${bg} ${text} px-3 py-1 text-xs font-medium shadow-sm`}> 
                  <span className={`h-2 w-2 rounded-full ${fill}`}></span>
                  <span>Camera {count}/{max}</span>
                  {status === "locked" ? (
                    <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-rose-700">LOCKED</span>
                  ) : null}
                  <span className="ml-2 inline-block h-2 w-24 rounded-full bg-white/60">
                    <span className={`block h-2 rounded-full ${fill}`} style={{ width: `${pct}%` }}></span>
                  </span>
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-3">
            <div className="min-w-[86px] rounded-2xl border-2 border-zinc-900 px-3 py-2 text-center text-[18px] font-black">{formatTime(secondsLeft)}</div>
            <button
              className="inline-flex items-center rounded-xl border border-zinc-300 bg-blue-400 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black hover:scale-110"
              onClick={() => setSubmitOpen(true)}
              disabled={status === "submitted"}
            >
              Submit
            </button>
          </div>
        </div>

        {status === "locked" && lockReason ? (
          <div className="px-4 py-3">
            <Banner variant="locked" title="Attempt Locked" message={lockReason} />
          </div>
        ) : null}

        <QuestionNav
          question={currentQ}
          selectedAnswer={answersMap.get(currentQ?._id)}
          onSelect={setAnswerForCurrent}
          disabled={disabled}
        />

        <div style={styles.bottombar}>
          <button
            style={styles.secondaryBtn}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
          >
            Prev
          </button>

          <button
            style={styles.secondaryBtn}
            onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
            disabled={currentIndex === questions.length - 1}
          >
            Next
          </button>
        </div>
      </div>

      {/* Warning modal */}
      <Modal
        open={warnOpen}
        title={status === "locked" ? "Attempt Locked" : "Warning"}
        primaryText={status === "locked" ? "OK" : "Continue"}
        onPrimary={() => setWarnOpen(false)}
      >
        <p style={{ marginTop: 0 }}>{warnText}</p>
        {status === "locked" ? (
          <p style={{ marginBottom: 0 }}>
            You can still submit, but you cannot change answers anymore.
          </p>
        ) : null}
      </Modal>

      {/* Submit confirm modal */}
      <Modal
        open={submitOpen}
        title="Submit test?"
        primaryText="Submit Now"
        secondaryText="Cancel"
        onPrimary={submitAttempt}
        onSecondary={() => setSubmitOpen(false)}
      >
        <p style={{ marginTop: 0 }}>
          Once submitted, you can exit normally. Your answers will be finalized.
        </p>
      </Modal>
    </div>
    </>
  );
});

const styles: { [key: string]: any } = {
  center: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center" as any,
    background: "#0b0b0b",
    color: "#111",
    padding: 16,
  },
  card: {
    width: "min(520px, 92vw)",
    background: "#fff",
    borderRadius: 14,
    padding: 18,
  },
  primaryBtn: {
    padding: "12px 16px",
    borderRadius: 12,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  layout: { display: "flex", height: "100vh", overflow: "hidden" },
  main: { flex: 1, display: "flex", flexDirection: "column" },
  topbar: {
    height: 70,
    borderBottom: "1px solid #eee",
    padding: "12px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
  },
  timer: {
    fontWeight: 900,
    fontSize: 18,
    padding: "8px 12px",
    borderRadius: 12,
    border: "2px solid #111",
    minWidth: 86,
    textAlign: "center",
  },
  bottombar: {
    marginTop: "auto",
    padding: 16,
    borderTop: "1px solid rgba(238,238,238,0.7)",
    display: "flex",
    justifyContent: "space-between",
    background: "rgba(255,255,255,0.78)",
    backdropFilter: "saturate(180%) blur(10px)",
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #ddd",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
};

export default TestShell;
