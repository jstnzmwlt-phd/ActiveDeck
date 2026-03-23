import React, { useState, useEffect } from 'react';
import { Presentation } from '../types';
import { useAuth } from './AuthProvider';
import { Maximize2, Minimize2, Monitor, Clock, Maximize, Minimize } from 'lucide-react';
import { ScreenCapture } from './ScreenCapture';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

type ViewMode = 'embed' | 'capture';

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200">
      {/* Main Content Area */}
      <div className="flex-1 relative bg-osu-black overflow-hidden flex items-center justify-center">
        <ScreenCapture />
      </div>
    </div>
  );
};
