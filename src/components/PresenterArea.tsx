import React from 'react';
import { Presentation } from '../types';
import { ScreenCapture } from './ScreenCapture';
import { ChevronLeft, ChevronRight, Download, Info, ShieldAlert, Presentation as PresentationIcon } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  const { sendSlideCommand, isBridgeConnected } = useBridge();

  const handleSlideMove = (direction: 'next' | 'prev') => {
    sendSlideCommand(direction);
  };

  return (
    <div className="flex flex-col h-full bg-black relative group">
      {/* Main Content Area */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <ScreenCapture />
        
        {/* Setup Bridge Card - Only shown when disconnected */}
        {!isBridgeConnected && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-6">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-8 max-w-md w-full text-center animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 bg-osu-orange/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <PresentationIcon className="w-8 h-8 text-osu-orange" />
              </div>
              
              <h2 className="text-2xl font-black text-slate-900 mb-2">Ready to Present?</h2>
              <p className="text-slate-500 mb-8">Connect your computer to the projector and start your bridge.</p>
              
              <a 
                href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/activedeck_bridge.exe"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full py-4 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-xl shadow-orange-500/20 mb-8"
              >
                <Download className="w-5 h-5" />
                Download ActiveDeck Bridge
              </a>
              
              <div className="space-y-4 text-left">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">1</div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Download and run this app on the computer connected to the projector.
                  </p>
                </div>
                
                <div className="flex gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 leading-relaxed">
                    If Windows shows a protection warning, click <span className="font-bold">"More Info"</span> and then <span className="font-bold">"Run Anyway"</span>.
                  </p>
                </div>
              </div>
              
              <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-center gap-2 text-slate-400">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Waiting for bridge connection...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Professional Remote Control Overlay */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 p-2 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-700/50 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 translate-y-4 group-hover:translate-y-0 z-50">
        <button
          onClick={() => handleSlideMove('prev')}
          className="flex items-center justify-center w-14 h-14 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all active:scale-95 border border-slate-700 group/btn"
          title="Previous Slide"
        >
          <ChevronLeft className="w-8 h-8 group-hover/btn:-translate-x-0.5 transition-transform" />
        </button>
        
        <div className="w-px h-8 bg-slate-700 mx-1" />

        <button
          onClick={() => handleSlideMove('next')}
          className="flex items-center justify-center w-14 h-14 bg-osu-orange hover:bg-[#c03900] text-white rounded-xl transition-all active:scale-95 border border-orange-600 group/btn shadow-[0_0_15px_rgba(255,62,0,0.3)]"
          title="Next Slide"
        >
          <ChevronRight className="w-8 h-8 group-hover/btn:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
};
