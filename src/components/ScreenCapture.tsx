import React, { useRef, useEffect, useState } from 'react';
import { Monitor, Play, Square, AlertCircle } from 'lucide-react';

interface ScreenCaptureProps {
  isCapturing: boolean;
  stream: MediaStream | null;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  logoUrl?: string;
  isProjectorMode?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  isBridgeConnected?: boolean;
  currentSlideBase64?: string | null;
  currentSlide?: number | null;
  currentSlidePreviewUrl?: string | null;
  onSlideImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  deckId?: string | null;
}

export const ScreenCapture: React.FC<ScreenCaptureProps> = ({ 
  isCapturing, 
  stream, 
  error, 
  onStart, 
  onStop,
  logoUrl,
  isProjectorMode = false,
  videoRef,
  onLoadedMetadata,
  isBridgeConnected = false,
  currentSlideBase64,
  currentSlide,
  currentSlidePreviewUrl,
  onSlideImageLoad,
  deckId
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const activeVideoRef = videoRef || localVideoRef;

  // 1. Live video stream detection (from Screen Sharing / Start PPT)
  const hasVideoStream = Boolean(
    stream &&
    typeof stream.getVideoTracks === 'function' &&
    stream.getVideoTracks().some(track => track.readyState === 'live')
  );

  // 2. Safe slide image detection (from Bridge / Load PPT / Firebase synced state)
  // Ensure we only use valid base64 data URLs or preview URLs, avoiding broken image fallbacks
  const isImageActive = isBridgeConnected || isCapturing || isProjectorMode;
  const validSlideSrc = isImageActive ? (
    (
      currentSlideBase64 && 
      typeof currentSlideBase64 === 'string' && 
      (currentSlideBase64.startsWith('data:image') || currentSlideBase64.startsWith('blob:') || currentSlideBase64.startsWith('http'))
    ) ? currentSlideBase64 : (
      currentSlidePreviewUrl &&
      typeof currentSlidePreviewUrl === 'string' &&
      (currentSlidePreviewUrl.startsWith('data:image') || currentSlidePreviewUrl.startsWith('blob:') || currentSlidePreviewUrl.startsWith('http'))
    ) ? currentSlidePreviewUrl : null
  ) : null;

  // Handle video element stream attachment
  useEffect(() => {
    const videoElem = activeVideoRef.current;
    if (!videoElem) return;

    if (hasVideoStream && stream) {
      if (videoElem.srcObject !== stream) {
        videoElem.srcObject = stream;
      }
      
      const playVideo = () => {
        videoElem.play().catch(err => {
          console.warn("ActiveDeck: Initial video play failed, retrying...", err);
          setTimeout(() => {
            if (videoElem && stream) {
              videoElem.play().catch(e => console.error("ActiveDeck: Video play retry failed:", e));
            }
          }, 250);
        });
      };

      if (videoElem.readyState >= 2) {
        playVideo();
      } else {
        videoElem.onloadedmetadata = () => playVideo();
        playVideo();
      }
    } else {
      videoElem.srcObject = null;
    }
  }, [hasVideoStream, stream]);

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-900 overflow-hidden group">
      {/* Video / Slide Display: Dual-Mode Rendering */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {/* Mode A: Screen Sharing Active -> Render <video> element */}
        {hasVideoStream ? (
          <video
            ref={(el) => {
              if (videoRef) {
                (videoRef as any).current = el;
              }
              (localVideoRef as any).current = el;
              if (el && stream && el.srcObject !== stream) {
                el.srcObject = stream;
                el.play().catch(() => {});
              }
            }}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={(e) => {
              e.currentTarget.play().catch(() => {});
              if (onLoadedMetadata) onLoadedMetadata(e);
            }}
            className="absolute inset-0 w-full h-full object-contain z-10"
          />
        ) : validSlideSrc ? (
          /* Mode B: Python Bridge / Firebase Synced Slide Active -> Render <img> element with base64 */
          <img 
            src={validSlideSrc} 
            alt={`Slide ${currentSlide || 1}`}
            className="absolute inset-0 w-full h-full object-contain z-10 select-none pointer-events-none"
            onLoad={(e) => {
              if (onSlideImageLoad) onSlideImageLoad(e);
            }}
            onError={(e) => {
              console.warn("ActiveDeck: Slide image failed to load, hiding broken image:", e);
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          /* Mode C: Standby / Offline -> Clean OSU Logo Watermark (Zero broken image tags) */
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 z-0">
            <img 
              src={logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
              alt="Logo Watermark" 
              className="w-2/3 max-w-2xl object-contain" 
              referrerPolicy="no-referrer" 
            />
          </div>
        )}

        {/* Start Presentation Prompt (Only in presenter screen when nothing is active) */}
        {!hasVideoStream && !validSlideSrc && !isCapturing && !error && !isProjectorMode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 p-8 text-center z-20">
            <Monitor className="w-16 h-16 mb-4 opacity-20" />
            <h3 className="text-xl font-bold text-slate-300 mb-2">Presentation Mode</h3>
            <p className="max-w-md text-sm text-slate-400 mb-8">
              Click below to start. For the best experience, select your <span className="text-osu-orange font-bold">PowerPoint Slide Show window</span> (or Screen) when prompted.
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
                      const params = new URLSearchParams(window.location.search);
                      const id = params.get('id');
                      const cleanId = id ? id.replace(/[^a-zA-Z0-9\-_]/g, '') : '';
                      const safeUrl = cleanId ? `/?id=${cleanId}` : '/';
                      
                      try {
                        console.log("ActiveDeck: Opening direct app link:", safeUrl);
                        window.open(safeUrl, '_blank');
                      } catch (e) {
                        console.log("ActiveDeck: Opening fallback app link:", safeUrl);
                        window.open(safeUrl, '_blank');
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

    </div>
  );
};
