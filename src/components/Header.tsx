import React, { useState, useEffect } from 'react';
import { Monitor, Clock, Maximize, Minimize } from 'lucide-react';

export const Header: React.FC = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

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

  return (
    <div className="p-4 bg-white border-b border-slate-200 h-12 py-1 relative z-50 w-full flex-shrink-0">
      <div className="flex items-center justify-between relative h-full">
        <div className="flex items-center gap-4 z-10">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-osu-orange" />
            Screen Presentation
          </h2>
        </div>

        {/* Centered ActiveDeck Logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <h1 className="text-xl font-black tracking-tight text-slate-800">
            Active<span className="text-osu-orange">Deck</span>
          </h1>
        </div>

        <div className="flex items-center gap-4 z-10">
          <div className="flex items-center gap-2 text-base font-mono font-bold text-slate-800 bg-white px-3 py-1.5 rounded-lg border-2 border-osu-orange shadow-sm scale-90">
            <Clock className="w-4 h-4 text-osu-orange" />
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-4">
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
