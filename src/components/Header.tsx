import React, { useState, useEffect } from 'react';
import { Monitor, Clock, Maximize, Minimize, Link2, Link2Off, Sun, Moon, Loader2, AlertCircle } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';

export const Header: React.FC = () => {
  const { isBridgeConnected, setUseWithoutBridge } = useBridge();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [isWakeLockLoading, setIsWakeLockLoading] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const hours = currentTime.getHours();
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');
  const seconds = currentTime.getSeconds().toString().padStart(2, '0');
  const amPm = hours >= 12 ? 'PM' : 'AM';

  useEffect(() => {
    console.log('Header - Component mounted');
    return () => console.log('Header - Component unmounted');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.error("Error attempting to enable fullscreen:", err);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      console.warn("Wake Lock API not supported in this browser.");
      return;
    }

    if (isWakeLockLoading) return;
    setWakeLockError(null);

    try {
      setIsWakeLockLoading(true);
      if (!isWakeLockActive) {
        console.log("Header - Attempting to acquire Wake Lock...");
        const lock = await (navigator as any).wakeLock.request('screen');
        console.log("Header - Wake Lock acquired successfully");
        
        setWakeLock(lock);
        setIsWakeLockActive(true);
        
        lock.addEventListener('release', () => {
          console.log("Header - Wake Lock was released by the system");
          setIsWakeLockActive(false);
          setWakeLock(null);
        });
      } else {
        if (wakeLock) {
          console.log("Header - Releasing Wake Lock manually...");
          await wakeLock.release();
          setWakeLock(null);
          setIsWakeLockActive(false);
        }
      }
    } catch (err: any) {
      console.error("Header - Wake Lock error details:", {
        name: err.name,
        message: err.message,
        stack: err.stack
      });
      
      if (err.name === 'NotAllowedError') {
        setWakeLockError("Blocked by browser policy. Try opening in a new tab.");
      } else {
        setWakeLockError("Failed to activate wake lock.");
      }
      
      setIsWakeLockActive(false);
      setWakeLock(null);
    } finally {
      setIsWakeLockLoading(false);
    }
  };

  // Re-acquire wake lock if it was active and visibility changes
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (isWakeLockActive && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } catch (err: any) {
          if (err.name !== 'NotAllowedError') {
            console.error("Re-acquiring Wake Lock error:", err);
          }
          setIsWakeLockActive(false);
          setWakeLock(null);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isWakeLockActive]);

  return (
    <div className="p-4 bg-white border-b border-slate-200 h-12 py-1 relative z-50 w-full flex-shrink-0">
      <div className="flex items-center justify-between relative h-full">
        <div className="flex items-center gap-4 z-10">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-osu-orange" />
            Screen Presentation
          </h2>
          
          <button 
            onClick={() => !isBridgeConnected && setUseWithoutBridge(false)}
            disabled={isBridgeConnected}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ${
              isBridgeConnected 
                ? 'bg-green-50 border-green-200 text-green-600 cursor-default' 
                : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300 cursor-pointer'
            }`}
            title={!isBridgeConnected ? "Click to setup bridge" : "Bridge is connected"}
          >
            {isBridgeConnected ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            {isBridgeConnected ? 'Bridge Online' : 'Bridge Offline'}
          </button>
        </div>

        {/* Centered ActiveDeck Logo */}
        <div className="absolute inset-0 flex items-center justify-center">
            <h1 
              className="text-xl font-black tracking-tight text-slate-800 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => {
                console.log('Header - Admin click');
                const password = prompt('Enter Admin Password:');
                if (password === '@dm1N') {
                  console.log('Header - Password correct, setting hash');
                  window.location.href = window.location.origin + window.location.pathname + '#admin';
                  window.dispatchEvent(new Event('hashchange'));
                } else if (password !== null) {
                  alert('Invalid password');
                }
              }}
            >
              Active<span className="text-osu-orange">Deck</span>
            </h1>
        </div>

        <div className="flex items-center gap-4 z-10">
          <div className="flex items-center gap-2 text-lg font-mono font-bold text-slate-800 bg-white px-3 py-1 rounded-lg border-2 border-osu-orange shadow-sm">
            <Clock className="w-4 h-4 text-osu-orange" />
            <div className="flex items-baseline">
              <span>{displayHours}:{minutes}</span>
              <span className="text-[0.7em] opacity-60 ml-0.5">:{seconds}</span>
              <span className="text-[0.8em] ml-1.5 font-sans font-black text-osu-orange">{amPm}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-4 relative">
            {wakeLockError && (
              <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-red-600 text-white text-[10px] rounded shadow-lg animate-in fade-in slide-in-from-bottom-1">
                {wakeLockError}
              </div>
            )}
            <button 
              onClick={toggleWakeLock}
              disabled={isWakeLockLoading}
              className={`p-1.5 rounded-md transition-colors ${
                isWakeLockActive 
                  ? 'bg-amber-50 text-amber-600' 
                  : wakeLockError
                    ? 'bg-red-50 text-red-600'
                    : 'hover:bg-slate-100 text-slate-600'
              } ${isWakeLockLoading ? 'opacity-50 cursor-wait' : ''}`}
              title={isWakeLockActive ? "Screen Wake Lock Active" : wakeLockError || "Keep Screen Awake"}
            >
              {isWakeLockLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isWakeLockActive ? (
                <Sun className="w-5 h-5 animate-pulse" />
              ) : wakeLockError ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>
            <button 
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-slate-600"
              title={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
