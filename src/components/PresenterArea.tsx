import React, { useState, useEffect } from 'react';
import { Presentation } from '../types';
import { useAuth } from './AuthProvider';
import { Maximize2, Minimize2, Monitor, Clock } from 'lucide-react';
import { ScreenCapture } from './ScreenCapture';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

type ViewMode = 'embed' | 'capture';

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      {/* Header */}
      <div className={`p-4 bg-white border-b border-slate-200 transition-all duration-300 ${isCollapsed ? 'h-12 py-1' : 'h-auto'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-base font-mono font-bold text-slate-800 bg-white px-3 py-1.5 rounded-lg border-2 border-osu-orange shadow-sm">
              <Clock className="w-4 h-4 text-osu-orange" />
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 hover:bg-slate-100 rounded-md transition-colors"
            >
              {isCollapsed ? <Maximize2 className="w-5 h-5" /> : <Minimize2 className="w-5 h-5" />}
            </button>
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
        <ScreenCapture />
      </div>
    </div>
  );
};
