import React from 'react';
import { Presentation } from '../types';
import { ScreenCapture } from './ScreenCapture';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  return (
    <div className="flex flex-col h-full bg-black">
      {/* Main Content Area */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <ScreenCapture />
      </div>
    </div>
  );
};
