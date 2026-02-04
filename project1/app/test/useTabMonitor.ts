"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const CHANNEL_NAME = "proctoring-tab-monitor";
const HEARTBEAT_INTERVAL = 1000; // 1 second
const TAB_TIMEOUT = 3000; // Consider tab dead after 3 seconds

interface TabInfo {
  id: string;
  lastSeen: number;
}

interface TabMonitorConfig {
  enabled: boolean;
  onMultipleTabsDetected: (tabCount: number) => void;
}

export function useTabMonitor({ enabled, onMultipleTabsDetected }: TabMonitorConfig) {
  const [tabId] = useState(() => `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [otherTabsCount, setOtherTabsCount] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isTestTab, setIsTestTab] = useState(false); // This tab is the test owner
  
  const channelRef = useRef<BroadcastChannel | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const tabsRef = useRef<Map<string, TabInfo>>(new Map());
  const hasReportedRef = useRef(false);

  // Clean up dead tabs (not seen in TAB_TIMEOUT ms)
  const cleanupDeadTabs = useCallback(() => {
    const now = Date.now();
    const tabs = tabsRef.current;
    
    for (const [id, info] of tabs.entries()) {
      if (now - info.lastSeen > TAB_TIMEOUT) {
        tabs.delete(id);
      }
    }
    
    const count = tabs.size;
    setOtherTabsCount(count);
    
    return count;
  }, []);

  // Send heartbeat to other tabs
  const sendHeartbeat = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "heartbeat",
        tabId,
        timestamp: Date.now(),
        isTestTab: isTestTab,
      });
    }
  }, [tabId, isTestTab]);

  // Request all tabs to respond
  const requestTabCount = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "ping",
        tabId,
        timestamp: Date.now(),
      });
    }
  }, [tabId]);

  // Request all other tabs to close themselves
  const requestOtherTabsClose = useCallback(() => {
    if (channelRef.current) {
      console.log("📢 Requesting all other tabs to close...");
      channelRef.current.postMessage({
        type: "close_request",
        tabId,
        timestamp: Date.now(),
      });
    }
  }, [tabId]);

  // Check for other tabs (returns count immediately)
  const checkForOtherTabs = useCallback((): Promise<number> => {
    return new Promise((resolve) => {
      // Clear existing tabs
      tabsRef.current.clear();
      hasReportedRef.current = false;
      
      // Request all tabs to respond
      requestTabCount();
      
      // Wait a bit for responses, then count
      setTimeout(() => {
        const count = cleanupDeadTabs();
        resolve(count);
      }, 500); // Give 500ms for other tabs to respond
    });
  }, [requestTabCount, cleanupDeadTabs]);

  // Close other tabs and return count of tabs that couldn't be closed
  const closeOtherTabs = useCallback(async (): Promise<{ closed: number; remaining: number }> => {
    // First, check how many tabs exist
    const initialCount = await checkForOtherTabs();
    
    if (initialCount === 0) {
      return { closed: 0, remaining: 0 };
    }
    
    // Request other tabs to close
    requestOtherTabsClose();
    
    // Wait for tabs to close
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check how many tabs remain
    const remainingCount = await checkForOtherTabs();
    
    return {
      closed: initialCount - remainingCount,
      remaining: remainingCount,
    };
  }, [checkForOtherTabs, requestOtherTabsClose]);

  // Initialize monitoring
  const initializeMonitoring = useCallback(async (): Promise<{ success: boolean; otherTabsCount: number }> => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      console.warn("BroadcastChannel not supported - tab monitoring disabled");
      return { success: false, otherTabsCount: 0 };
    }

    try {
      // Create broadcast channel
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      
      // Mark this as the test tab
      setIsTestTab(true);
      
      // Handle messages from other tabs
      channelRef.current.onmessage = (event) => {
        const { type, tabId: senderId, timestamp, isTestTab: senderIsTestTab } = event.data;
        
        if (senderId === tabId) return; // Ignore our own messages
        
        if (type === "heartbeat" || type === "pong") {
          // Another tab is alive
          tabsRef.current.set(senderId, {
            id: senderId,
            lastSeen: timestamp || Date.now(),
          });
          
          const count = cleanupDeadTabs();
          
          // Report violation if other tabs detected and we haven't reported yet
          if (count > 0 && enabled && !hasReportedRef.current) {
            hasReportedRef.current = true;
            console.log(`⚠️ TAB VIOLATION: ${count} other tab(s) detected`);
            onMultipleTabsDetected(count);
          }
        } else if (type === "ping") {
          // Respond to ping
          channelRef.current?.postMessage({
            type: "pong",
            tabId,
            timestamp: Date.now(),
            isTestTab: isTestTab,
          });
        } else if (type === "close_request") {
          // Another tab (the test tab) is requesting us to close
          // Only close if we're NOT the test tab
          if (!isTestTab) {
            console.log("🚪 Received close request from test tab. Closing this tab...");
            // Try to close this tab
            window.close();
            // If window.close() doesn't work (user-opened tab), redirect to a blank page
            setTimeout(() => {
              // If still here, show a message and try alternative methods
              document.body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1a1a2e;color:white;">
                  <h1>⚠️ Tab Closed for Test</h1>
                  <p>A proctored test is in progress. Please close this tab manually.</p>
                  <p style="color:#ff6b6b;margin-top:20px;">This tab should not be open during the exam.</p>
                </div>
              `;
              // Clear all scripts and intervals
              const highestId = window.setTimeout(() => {}, 0);
              for (let i = 0; i < highestId; i++) {
                window.clearTimeout(i);
                window.clearInterval(i);
              }
            }, 100);
          }
        } else if (type === "closing") {
          // Tab is closing, remove it
          tabsRef.current.delete(senderId);
          cleanupDeadTabs();
        }
      };

      // Check for existing tabs
      const existingTabCount = await checkForOtherTabs();
      
      setIsMonitoring(true);
      console.log(`✅ Tab monitoring initialized. Found ${existingTabCount} other tab(s).`);
      
      return { success: true, otherTabsCount: existingTabCount };
    } catch (error) {
      console.error("Error initializing tab monitoring:", error);
      return { success: false, otherTabsCount: 0 };
    }
  }, [tabId, isTestTab, enabled, onMultipleTabsDetected, checkForOtherTabs, cleanupDeadTabs]);

  // Start continuous monitoring
  const startMonitoring = useCallback(() => {
    if (heartbeatRef.current) return;
    
    // Send heartbeats periodically
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat();
      cleanupDeadTabs();
      
      // Check if new tabs appeared
      const count = tabsRef.current.size;
      if (count > 0 && enabled && !hasReportedRef.current) {
        hasReportedRef.current = true;
        console.log(`⚠️ TAB VIOLATION: New tab detected (${count} total). Requesting close...`);
        
        // Try to close the new tabs
        requestOtherTabsClose();
        
        // Report the violation
        onMultipleTabsDetected(count);
      }
    }, HEARTBEAT_INTERVAL);
    
    // Send initial heartbeat
    sendHeartbeat();
  }, [sendHeartbeat, cleanupDeadTabs, enabled, onMultipleTabsDetected, requestOtherTabsClose]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    // Notify other tabs we're closing
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: "closing",
        tabId,
        timestamp: Date.now(),
      });
      channelRef.current.close();
      channelRef.current = null;
    }
    
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    
    tabsRef.current.clear();
    setIsMonitoring(false);
    setIsTestTab(false);
    hasReportedRef.current = false;
    console.log("Tab monitoring stopped");
  }, [tabId]);

  // Start/stop based on enabled
  useEffect(() => {
    if (enabled && isMonitoring) {
      startMonitoring();
    } else if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [enabled, isMonitoring, startMonitoring]);

  // Cleanup on unmount
  useEffect(() => {
    // Notify other tabs when this tab closes
    const handleBeforeUnload = () => {
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: "closing",
          tabId,
          timestamp: Date.now(),
        });
      }
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      stopMonitoring();
    };
  }, [tabId, stopMonitoring]);

  return {
    initializeMonitoring,
    startMonitoring,
    stopMonitoring,
    checkForOtherTabs,
    closeOtherTabs,
    requestOtherTabsClose,
    isMonitoring,
    otherTabsCount,
    tabId,
    isTestTab,
  };
}
