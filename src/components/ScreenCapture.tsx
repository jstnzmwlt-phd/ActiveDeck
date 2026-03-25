import React, { useRef, useState, useEffect } from 'react';
import { Monitor, Play, Square, AlertCircle } from 'lucide-react';

export const ScreenCapture: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const startCapture = async () => {
    setError(null);
    try {
      const constraints: any = {
        video: true,
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getDisplayMedia(constraints);

      setStream(mediaStream);
      setIsCapturing(true);

      // Automatically go into full screen mode
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
      } catch (fullscreenErr) {
        console.error("Error attempting to enable full-screen mode:", fullscreenErr);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Explicitly call play to ensure video starts immediately
        videoRef.current.play().catch(err => {
          console.error("Error playing video stream:", err);
        });
      }

      // Handle stream stop (e.g., user clicks "Stop sharing" in browser UI)
      mediaStream.getVideoTracks()[0].onended = () => {
        stopCapture();
      };
    } catch (err) {
      console.error("Error starting screen capture:", err);
      setError("Failed to start screen capture. Please ensure you've granted permission.");
      setIsCapturing(false);
    }
  };

  const stopCapture = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCapturing(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
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
            <h3 className="text-xl font-bold text-slate-300 mb-2">Ready to Present</h3>
            <p className="max-w-md text-sm text-slate-400 mb-8">
              Click "Start Sharing" to select the window, screen, or tab you want to present to the audience.
            </p>

            <button
              onClick={startCapture}
              className="flex items-center gap-3 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest rounded-full transition-all active:scale-95 shadow-2xl shadow-indigo-500/40"
            >
              <Play className="w-5 h-5 fill-current" />
              Start Sharing
            </button>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 p-8 text-center bg-red-950/20 backdrop-blur-sm z-20">
            <AlertCircle className="w-12 h-12 mb-4" />
            <p className="text-lg font-bold mb-2">Capture Error</p>
            <p className="text-sm max-w-xs">{error}</p>
            <button 
              onClick={startCapture}
              className="mt-6 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-all"
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Controls Overlay */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-3 bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-full shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-50">
        {!isCapturing ? (
          <button
            onClick={startCapture}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
          >
            <Play className="w-4 h-4 fill-current" />
            Start Sharing
          </button>
        ) : (
          <button
            onClick={stopCapture}
            className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full transition-all active:scale-95 shadow-lg shadow-red-500/20"
          >
            <Square className="w-4 h-4 fill-current" />
            Stop Sharing
          </button>
        )}
      </div>

      {/* Status Badge */}
      {isCapturing && (
        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-red-600/90 text-white text-[10px] font-black uppercase tracking-widest rounded-md animate-pulse z-50">
          <div className="w-2 h-2 bg-white rounded-full" />
          Live Presentation
        </div>
      )}
    </div>
  );
};
