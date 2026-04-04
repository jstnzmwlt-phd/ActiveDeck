import React, { useState, useEffect } from 'react';
import { Monitor, Clock, Maximize, Minimize, Link2, Link2Off, Sun, Moon } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';

export const Header: React.FC = () => {
  const { isBridgeConnected, setUseWithoutBridge } = useBridge();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const hours = currentTime.getHours();
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');
  const seconds = currentTime.getSeconds().toString().padStart(2, '0');
  const amPm = hours >= 12 ? 'PM' : 'AM';

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
    if ('wakeLock' in navigator) {
      try {
        if (!isWakeLockActive) {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
          setIsWakeLockActive(true);
          
          lock.addEventListener('release', () => {
            setIsWakeLockActive(false);
            setWakeLock(null);
          });
        } else {
          if (wakeLock) {
            await wakeLock.release();
            setWakeLock(null);
            setIsWakeLockActive(false);
          }
        }
      } catch (err) {
        console.error("Wake Lock error:", err);
      }
    } else {
      console.warn("Wake Lock API not supported in this browser.");
    }
  };

  // Re-acquire wake lock if it was active and visibility changes
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (isWakeLockActive && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } catch (err) {
          console.error("Re-acquiring Wake Lock error:", err);
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <h1 className="text-xl font-black tracking-tight text-slate-800">
            Active<span className="text-osu-orange">Deck</span>
          </h1>
        </div>

        <div className="flex items-center gap-4 z-10">
          <div className="flex items-center gap-1.5 text-base font-mono font-bold text-slate-800 bg-white px-3 py-1.5 rounded-lg border-2 border-osu-orange shadow-sm scale-90">
            <Clock className="w-4 h-4 text-osu-orange" />
            <div className="flex items-baseline">
              <span>{displayHours}:{minutes}</span>
              <span className="text-[0.7em] opacity-60 ml-0.5">:{seconds}</span>
              <span className="text-[0.8em] ml-1.5 font-sans font-black text-osu-orange">{amPm}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-4">
            <button 
              onClick={toggleWakeLock}
              className={`p-1.5 rounded-md transition-colors ${
                isWakeLockActive 
                  ? 'bg-amber-50 text-amber-600' 
                  : 'hover:bg-slate-100 text-slate-600'
              }`}
              title={isWakeLockActive ? "Screen Wake Lock Active" : "Keep Screen Awake"}
            >
              {isWakeLockActive ? <Sun className="w-5 h-5 animate-pulse" /> : <Moon className="w-5 h-5" />}
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
