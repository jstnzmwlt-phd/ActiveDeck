import React, { useState, useEffect } from 'react';
import { Presentation } from '../types';
import { useAuth } from './AuthProvider';
import { Maximize2, Minimize2, Monitor, Clock, Maximize, Minimize, ChevronUp, ChevronDown } from 'lucide-react';
import { ScreenCapture } from './ScreenCapture';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

type ViewMode = 'embed' | 'capture';

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      {/* Header */}
      <div className={`p-4 bg-white border-b border-slate-200 transition-all duration-300 ${isCollapsed ? 'h-12 py-1' : 'h-auto'} relative`}>
        <div className="flex items-center justify-between relative">
          <div className="flex items-center gap-4 z-10">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-osu-orange" />
              Screen Presentation
            </h2>
            
            {!isCollapsed && (
              <div className="px-3 py-1 bg-slate-100 rounded-lg border border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                Live Capture Mode
              </div>
            )}
          </div>

          {/* Centered ActiveDeck Logo */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h1 className="text-xl font-black tracking-tight text-slate-800">
              Active<span className="text-osu-orange">Deck</span>
            </h1>
          </div>

          <div className="flex items-center gap-4 z-10">
            <div className="flex items-center gap-2 text-base font-mono font-bold text-slate-800 bg-white px-3 py-1.5 rounded-lg border-2 border-osu-orange shadow-sm">
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
              <button 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-slate-600"
                title={isCollapsed ? "Expand Header" : "Collapse Header"}
              >
                {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
        
        {!isCollapsed && (
          <div className="mt-2 text-[10px] text-slate-400 px-1 flex items-center gap-2">
            <Monitor className="w-3 h-3" />
            <span>Select your PowerPoint window or any application to share with the audience.</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative bg-osu-black overflow-hidden flex items-center justify-center">
        {/* ActiveDeck Watermark */}
        <div className="absolute top-6 left-6 z-50 pointer-events-none opacity-50">
          <h1 className="text-2xl font-black tracking-tight text-white drop-shadow-md">
            Active<span className="text-osu-orange">Deck</span>
          </h1>
        </div>
        <ScreenCapture />
      </div>
    </div>
  );
};
