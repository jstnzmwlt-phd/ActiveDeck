import React, { useRef, useEffect } from 'react';
import { Monitor, Play, Square, AlertCircle } from 'lucide-react';

interface ScreenCaptureProps {
  isCapturing: boolean;
  stream: MediaStream | null;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
}

export const ScreenCapture: React.FC<ScreenCaptureProps> = ({ 
  isCapturing, 
  stream, 
  error, 
  onStart, 
  onStop 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(err => {
        console.error("ActiveDeck: Error playing video stream:", err);
      });
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-900 overflow-hidden group">
      {/* Video Display */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {/* OSU Logo Watermark - Only visible when not sharing */}
        {!isCapturing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 z-0">
            <img 
              src="https://a.espncdn.com/i/teamlogos/ncaa/500/197.png" 
              alt="OSU Logo Watermark" 
              className="w-2/3 max-w-2xl object-contain" 
              referrerPolicy="no-referrer" 
            />
          </div>
        )}
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain relative z-10 ${isCapturing ? 'opacity-100' : 'opacity-0'}`}
        />
        
        {!isCapturing && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 p-8 text-center z-20">
            <Monitor className="w-16 h-16 mb-4 opacity-20" />
            <h3 className="text-xl font-bold text-slate-300 mb-2">Presentation Mode</h3>
            <p className="max-w-md text-sm text-slate-400 mb-8">
              Click below to start. For the best experience, select your <span className="text-osu-orange font-bold">PowerPoint window</span> when prompted.
            </p>

            <button
              onClick={onStart}
              className="flex items-center gap-3 px-10 py-4 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-full transition-all active:scale-95 shadow-2xl shadow-orange-500/20"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Presentation
            </button>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 p-8 text-center bg-red-950/20 backdrop-blur-sm z-20">
            <AlertCircle className="w-12 h-12 mb-4" />
            <p className="text-lg font-bold mb-2">Capture Error</p>
            <p className="text-sm max-w-xs">{error}</p>
            <div className="flex flex-col gap-3 mt-6">
              <button 
                onClick={onStart}
                className="px-6 py-2 bg-red-600 text-white font-bold rounded-full hover:bg-red-700 transition-all active:scale-95"
              >
                Try Again
              </button>
              {error.includes('Open in New Tab') && (
                <div className="flex flex-col gap-4 mt-4">
                  <button 
                    onClick={() => {
                      try {
                        // Create a clean URL from the current location
                        const currentUrl = new URL(window.location.href);
                        
                        // Force standard HTTPS and remove any dev ports (like 24678 for HMR)
                        const cleanUrl = new URL('https://' + currentUrl.hostname);
                        cleanUrl.pathname = '/';
                        
                        // If we have a presentation ID in the current URL, preserve it
                        const params = new URLSearchParams(window.location.search);
                        const id = params.get('id');
                        if (id) {
                          cleanUrl.searchParams.set('id', id);
                        }
                        
                        const finalUrl = cleanUrl.toString();
                        console.log("ActiveDeck: Opening direct app link:", finalUrl);
                        window.open(finalUrl, '_blank');
                      } catch (e) {
                        // Ultimate fallback: just try to fix the origin
                        const fallbackUrl = window.location.origin
                          .replace('wss://', 'https://')
                          .replace('ws://', 'http://')
                          .split(':')[0] + ':' + window.location.origin.split(':')[1]; // Keep hostname, drop port if it was HMR
                        
                        console.log("ActiveDeck: Opening fallback app link:", fallbackUrl);
                        window.open(fallbackUrl, '_blank');
                      }
                    }}
                    className="px-6 py-3 bg-white text-slate-900 font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all active:scale-95 shadow-xl"
                  >
                    Open Direct App Link
                  </button>
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10 text-xs text-slate-300">
                    <p className="mb-2">Or look for this icon in the top right of the editor:</p>
                    <div className="flex items-center justify-center gap-2 text-white font-bold">
                      <div className="p-1.5 bg-slate-800 rounded border border-slate-700">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                      </div>
                      <span>Open in New Tab</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controls Overlay - Only shown when capturing to allow stopping */}
      {isCapturing && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-slate-800/60 backdrop-blur-md border border-slate-700/30 rounded-full shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50">
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold rounded-full transition-all active:scale-95 shadow-lg shadow-red-500/10"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop Presentation
          </button>
        </div>
      )}

      {/* Status Badge */}
      {isCapturing && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-red-600/80 text-white text-[9px] font-black uppercase tracking-widest rounded transition-all duration-300 z-50">
          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          Live
        </div>
      )}
    </div>
  );
};
