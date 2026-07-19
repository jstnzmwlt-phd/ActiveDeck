import React, { useState, useEffect, useRef } from 'react';
import { Presentation } from '../types';
import { ScreenCapture } from './ScreenCapture';
import { ChevronLeft, ChevronRight, Download, Info, ShieldAlert, Presentation as PresentationIcon, Monitor, MonitorPlay, MousePointer2, Play, X, Loader2, Tv, Minimize, Maximize, FileText } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';
import { auth, db, storage } from '../firebase';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';

interface PresenterAreaProps {
  presentation: Presentation | null;
  logoUrl?: string;
  onCreatePresentation?: () => Promise<string>;
  isProjectorMode?: boolean;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation, logoUrl, onCreatePresentation, isProjectorMode = false }) => {
  const { 
    currentSlide, 
    sendSlideCommand, 
    isBridgeConnected, 
    useWithoutBridge, 
    setUseWithoutBridge,
    nextSlide,
    totalSlides,
    notes,
    clearNotesState
  } = useBridge();
  const [activeTab, setActiveTab] = useState<'single' | 'dual' | 'manual'>('single');
  const [secondaryColor, setSecondaryColor] = useState<string>('#ff3e00');
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [laserEnabled, setLaserEnabled] = useState(true);
  const [presentWithNotes, setPresentWithNotes] = useState(false);

  const [currentSlidePreviewUrl, setCurrentSlidePreviewUrl] = useState<string | null>(null);
  const [nextSlidePreviewUrl, setNextSlidePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!presentation?.id || currentSlide === null) {
      setCurrentSlidePreviewUrl(null);
      return;
    }
    const docId = `${presentation.id}_preview_slide_${currentSlide}`;
    const unsub = onSnapshot(doc(db, 'messages', docId), (docSnap) => {
      if (docSnap.exists()) {
        setCurrentSlidePreviewUrl(docSnap.data().fileUrl || null);
      } else {
        setCurrentSlidePreviewUrl(null);
      }
    }, (err) => {
      console.warn("ActiveDeck: Error loading current slide preview:", err);
    });
    return () => unsub();
  }, [presentation?.id, currentSlide]);

  useEffect(() => {
    if (!presentation?.id || nextSlide === null) {
      setNextSlidePreviewUrl(null);
      return;
    }
    const docId = `${presentation.id}_preview_slide_${nextSlide}`;
    const unsub = onSnapshot(doc(db, 'messages', docId), (docSnap) => {
      if (docSnap.exists()) {
        setNextSlidePreviewUrl(docSnap.data().fileUrl || null);
      } else {
        setNextSlidePreviewUrl(null);
      }
    }, (err) => {
      console.warn("ActiveDeck: Error loading next slide preview:", err);
    });
    return () => unsub();
  }, [presentation?.id, nextSlide]);

  const [localSlidesCount, setLocalSlidesCount] = useState<number>(0);

  useEffect(() => {
    if (isBridgeConnected) {
      console.log("ActiveDeck: Bridge connected, triggering slide images pre-export...");
      fetch('http://127.0.0.1:5000/export')
        .then(res => res.json())
        .then(data => {
          if (data && data.success && typeof data.count === 'number') {
            console.log(`ActiveDeck: Successfully pre-exported ${data.count} slide previews locally.`);
            setLocalSlidesCount(data.count);
          }
        })
        .catch(err => {
          console.warn("ActiveDeck: Failed to pre-export slides via bridge:", err);
        });
    } else {
      setLocalSlidesCount(0);
    }
  }, [isBridgeConnected]);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Track manual advances or animation builds to trigger slide recaptures
  const [captureTrigger, setCaptureTrigger] = useState(0);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
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

  // Background Automatic Slide Preview Capture & Upload Effect
  useEffect(() => {
    if (!presentation?.id || !isCapturing) return;

    const activeSlideNum = currentSlide !== null ? currentSlide : (presentation?.currentSlide || 1);

    console.log(`[SlidePreview Auto] Scheduling background preview capture for slide ${activeSlideNum} (trigger: ${captureTrigger})...`);

    // Capture after 1.5 seconds of "stillness" to avoid capturing while the presenter is scrolling through slides
    const timeoutId = setTimeout(async () => {
      try {
        // Query the video element INSIDE the timeout to guarantee React has finished rendering the video container!
        const video = containerRef.current?.querySelector('video');
        if (!video) {
          console.warn("[SlidePreview Auto] No active video stream found in DOM inside timeout to capture slide preview.");
          return;
        }

        console.log(`[SlidePreview Auto] Triggering background slide preview capture for slide ${activeSlideNum}...`);
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          if (!blob) return;

          try {
            const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
            const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

            const fileId = Math.random().toString(36).substring(2, 11);
            const fileName = `Slide_Preview_Slide_${activeSlideNum}_${Date.now()}.jpg`;
            const storagePath = `presentations/${presentation.id}/documents/${fileId}_${fileName}`;
            const storageRef = ref(storage, storagePath);

            await uploadBytes(storageRef, blob);
            const downloadUrl = await getDownloadURL(storageRef);

            // Save to messages with deterministic ID (presentationId_preview_slide_slideNum)
            const docId = `${presentation.id}_preview_slide_${activeSlideNum}`;
            await setDoc(doc(db, 'messages', docId), {
              presentationId: presentation.id,
              slide: activeSlideNum,
              fileUrl: downloadUrl,
              isBackgroundPreview: true,
              isPushedSlide: false,
              timestamp: serverTimestamp()
            });

            console.log(`[SlidePreview Auto] Background slide preview uploaded successfully for slide ${activeSlideNum}!`);
          } catch (uploadErr) {
            console.error("[SlidePreview Auto] Background slide preview upload failed:", uploadErr);
          }
        }, 'image/jpeg', 0.65);

      } catch (err) {
        console.error("[SlidePreview Auto] Error in background slide capture process:", err);
      }
    }, 3000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [currentSlide, presentation?.currentSlide, isCapturing, presentation?.id, captureTrigger]);

  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);



  const updateLaserPositionInFirebase = async (x: number, y: number, active: boolean) => {
    if (!presentation?.id) return;
    try {
      await updateDoc(doc(db, 'presentations', presentation.id), {
        laserX: Number(x.toFixed(2)),
        laserY: Number(y.toFixed(2)),
        laserActive: active
      });
    } catch (err) {
      console.warn("Error updating laser position in Firebase:", err);
    }
  };

  const updateLaserPosition = (x: number, y: number, active: boolean) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (!active) {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      pendingCoordsRef.current = null;
      lastUpdateRef.current = now;
      updateLaserPositionInFirebase(x, y, false);
      return;
    }

    if (timeSinceLastUpdate >= 40) {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      pendingCoordsRef.current = null;
      lastUpdateRef.current = now;
      updateLaserPositionInFirebase(x, y, true);
    } else {
      pendingCoordsRef.current = { x, y };

      if (!throttleTimeoutRef.current) {
        const remaining = 40 - timeSinceLastUpdate;
        throttleTimeoutRef.current = setTimeout(() => {
          throttleTimeoutRef.current = null;
          if (pendingCoordsRef.current) {
            const { x: px, y: py } = pendingCoordsRef.current;
            pendingCoordsRef.current = null;
            lastUpdateRef.current = Date.now();
            updateLaserPositionInFirebase(px, py, true);
          }
        }, remaining);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isProjectorMode || !presentation?.id || !isCapturing || !laserEnabled) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    updateLaserPosition(x, y, true);
  };

  const handleMouseLeave = () => {
    if (isProjectorMode || !presentation?.id) return;
    updateLaserPosition(0, 0, false);
  };

  useEffect(() => {
    const fetchTheme = async () => {
      const docSnap = await getDoc(doc(db, 'settings', 'global'));
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.theme?.secondaryColor) {
          setSecondaryColor(data.theme.secondaryColor);
        }
      }
    };
    fetchTheme();
  }, []);

  const handleSlideMove = (direction: 'next' | 'prev') => {
    sendSlideCommand(direction);
    setCaptureTrigger(prev => prev + 1);
  };

  // Keyboard navigation listener to capture animations/slides via remote clicker or keyboard
  useEffect(() => {
    if (!isCapturing) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when focusing inputs or textareas
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'Space') {
        e.preventDefault();
        handleSlideMove('next');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSlideMove('prev');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isCapturing, currentSlide, presentation?.currentSlide]);

  const startCapture = () => {
    setError(null);
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      .then(async (mediaStream) => {
        setError(null);
        setStream(mediaStream);
        setIsCapturing(true);

        // Expose mediaStream globally so the projector window can access it
        (window as any).activeDeckStream = mediaStream;

        // Broadcast that stream has started
        try {
          const channel = new BroadcastChannel('activedeck-stream');
          channel.postMessage({ type: 'stream-started' });
          channel.close();
        } catch (bcErr) {
          console.error("ActiveDeck: Error broadcasting stream-started:", bcErr);
        }
        // Automatically go into full screen mode
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          }
        } catch (fullscreenErr) {
          console.error("ActiveDeck: Error attempting to enable full-screen mode:", fullscreenErr);
        }
        // Only create a new presentation session if one doesn't exist yet
        let activePresentationId = presentation?.id;
        if (!presentation && onCreatePresentation) {
          try {
            activePresentationId = await onCreatePresentation();
          } catch (createErr) {
            console.error("ActiveDeck: Error creating presentation session:", createErr);
            mediaStream.getTracks().forEach(track => track.stop());
            setStream(null);
            setIsCapturing(false);
            setError("Failed to initialize presentation session in database.");
            return;
          }
        }

        // Set the current slide in database to 1 as soon as the presentation starts
        if (activePresentationId) {
          try {
            await updateDoc(doc(db, 'presentations', activePresentationId), {
              currentSlide: 1
            });
            console.log("ActiveDeck: Automatically set currentSlide to 1 in Firebase upon starting presentation.");
          } catch (updateErr) {
            console.error("ActiveDeck: Failed to set initial slide to 1 in Firebase:", updateErr);
          }
        }

        mediaStream.getVideoTracks()[0].onended = () => {
          stopCapture();
        };
      })
      .catch((err: any) => {
        console.error("ActiveDeck: Error starting screen capture:", err);
        if (err.name === 'NotAllowedError' && err.message.includes('permissions policy')) {
          setError("Browser Security: Screen capture is blocked inside the editor's preview window. Please use the 'Shared App URL' or the 'Open in New Tab' icon in the top right to present.");
        } else if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          // Gracefully return to the main instructions screen if the user cancels or denies the request
          setError(null);
        } else {
          setError("Failed to start screen capture. Please ensure your browser supports screen sharing.");
        }
        setIsCapturing(false);
      });
  };

  const stopCapture = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCapturing(false);
    (window as any).activeDeckStream = null;

    // Broadcast that stream has stopped
    try {
      const channel = new BroadcastChannel('activedeck-stream');
      channel.postMessage({ type: 'stream-stopped' });
      channel.close();
    } catch (bcErr) {
      console.error("ActiveDeck: Error broadcasting stream-stopped:", bcErr);
    }
  };

  useEffect(() => {
    if (stream) {
      (window as any).activeDeckStream = stream;
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        (window as any).activeDeckStream = null;
        try {
          const channel = new BroadcastChannel('activedeck-stream');
          channel.postMessage({ type: 'stream-stopped' });
          channel.close();
        } catch (e) {}
      }
    };
  }, [stream]);

  // Synchronize stream for projector mode
  useEffect(() => {
    if (!isProjectorMode) return;

    console.log("ActiveDeck Projector: Sync stream effect mounted");
    const channel = new BroadcastChannel('activedeck-stream');

    const checkParentStream = () => {
      console.log("ActiveDeck Projector: checkParentStream invoked");
      try {
        console.log("ActiveDeck Projector: window.opener =", window.opener);
        if (window.opener) {
          console.log("ActiveDeck Projector: window.opener.closed =", window.opener.closed);
          if (!window.opener.closed) {
            const parentStream = window.opener.activeDeckStream;
            console.log("ActiveDeck Projector: window.opener.activeDeckStream =", parentStream);
            if (parentStream) {
              console.log("ActiveDeck Projector: Stream found. Active tracks:", parentStream.getTracks().map((t: any) => ({ label: t.label, enabled: t.enabled, readyState: t.readyState })));
              
              setStream(parentStream);

              setIsCapturing(true);
              setError(null);
            } else {
              console.log("ActiveDeck Projector: Opener exists but activeDeckStream is null or undefined");
              setStream(null);
              setIsCapturing(false);
            }
          } else {
            console.log("ActiveDeck Projector: window.opener is closed");
            setStream(null);
            setIsCapturing(false);
          }
        } else {
          console.log("ActiveDeck Projector: window.opener is NULL/undefined");
          setStream(null);
          setIsCapturing(false);
        }
      } catch (err) {
        console.error("ActiveDeck Projector: Error accessing presenter window memory:", err);
      }
    };

    // 1. Check parent stream immediately on mount (or reload)
    checkParentStream();

    // 2. Set up BroadcastChannel listener for real-time start/stop
    channel.onmessage = (event) => {
      console.log("ActiveDeck Projector: BroadcastChannel message received:", event.data);
      if (event.data?.type === 'stream-started') {
        checkParentStream();
      } else if (event.data?.type === 'stream-stopped') {
        console.log("ActiveDeck Projector: Stream stopped message received");
        setStream(null);
        setIsCapturing(false);
      } else if (event.data?.type === 'close-projector') {
        console.log("ActiveDeck Projector: Close projector message received. Closing window.");
        window.close();
      }
    };

    // 3. Fallback interval check (polling every 1 second) in case of missed events or parent closing
    const intervalId = setInterval(checkParentStream, 1000);

    return () => {
      console.log("ActiveDeck Projector: Sync stream effect unmounting");
      channel.close();
      clearInterval(intervalId);
    };
  }, [isProjectorMode]);

  return (
    <div className="flex flex-col h-full bg-black relative group">
      {/* Presenter Control Bar - Displays off the slide area */}
      {isCapturing && !isProjectorMode && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between z-[70] shrink-0 select-none relative">
          {/* Left Side: Status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600/90 text-white text-[9px] font-black uppercase tracking-widest rounded-lg border border-red-500/20 shadow-lg shadow-red-500/5 animate-in fade-in duration-300">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Live
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">
              Active Display
            </span>
          </div>

          {/* Center: Slide Number */}
          <div className="absolute left-1/2 -translate-x-1/2 z-50">
            {(currentSlide !== null || presentation?.currentSlide !== undefined) && (
              <div className="bg-[#ff3e00]/90 text-white px-2.5 py-1 rounded-lg border border-white/20 shadow-lg flex items-center gap-1.5 animate-in fade-in duration-300">
                <span className="text-[9px] font-black uppercase tracking-wider opacity-85">Slide</span>
                <span className="text-sm font-black font-mono">
                  {currentSlide !== null ? currentSlide : presentation?.currentSlide}
                </span>
              </div>
            )}
          </div>

          {/* Right Side: Presenter Controls */}
          <div className="flex items-center gap-2">


            {/* Present with Notes Toggle Switch */}
            <button
              onClick={() => {
                const newEnabled = !presentWithNotes;
                setPresentWithNotes(newEnabled);
                if (!newEnabled) {
                  clearNotesState();
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all duration-200 shadow-lg cursor-pointer hover:scale-105 active:scale-95 ${
                presentWithNotes 
                  ? 'bg-osu-orange border-osu-orange text-white hover:bg-[#c03900] hover:border-[#c03900] shadow-orange-500/10' 
                  : 'bg-slate-900/90 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-600 shadow-slate-955/25'
              }`}
              title="Toggle Present with Notes"
            >
              <FileText className="w-3 h-3" />
              <span>Notes {presentWithNotes ? 'ON' : 'OFF'}</span>
            </button>

            {/* Laser Pointer Toggle Switch */}
            <button
              onClick={() => {
                const newEnabled = !laserEnabled;
                setLaserEnabled(newEnabled);
                if (!newEnabled) {
                  updateLaserPosition(0, 0, false);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all duration-200 shadow-lg cursor-pointer hover:scale-105 active:scale-95 ${
                laserEnabled 
                  ? 'bg-red-600 border-red-500 text-white hover:bg-red-700 hover:border-red-600 shadow-red-500/10' 
                  : 'bg-slate-900/90 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 hover:border-slate-600 shadow-slate-955/25'
              }`}
              title="Toggle Laser Pointer"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${laserEnabled ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
              <span>Laser {laserEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Slide Indicator - Shown as overlay only in Projector Mode (Presenter gets it in the Control Bar) */}
      {isProjectorMode && (currentSlide !== null || presentation?.currentSlide !== undefined) && (
        <div className="absolute top-2 right-2 z-[70] pointer-events-none">
          <div className="bg-[#ff3e00]/90 text-white px-2 py-1 rounded-lg border border-white/20 shadow-lg flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-500">
            <span className="text-[9px] font-black uppercase tracking-wider opacity-80">Slide</span>
            <span className="text-sm font-black">
              {currentSlide !== null ? currentSlide : presentation?.currentSlide}
            </span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div 
        ref={containerRef}
        onMouseMove={!isProjectorMode ? handleMouseMove : undefined}
        onMouseLeave={!isProjectorMode ? handleMouseLeave : undefined}
        className={`${presentWithNotes && isCapturing && !isProjectorMode ? 'flex-[2]' : 'flex-1'} relative bg-black overflow-hidden flex items-center justify-center transition-all duration-300`}
      >
        {!isProjectorMode ? (
          <div className="w-full h-full p-4 flex flex-col md:flex-row gap-10 items-start justify-between max-w-7xl mx-auto select-none overflow-y-auto custom-scrollbar">
            {presentWithNotes ? (
              <>
                {/* SPLIT SCREEN LAYOUT: Notes ON */}
                {/* Left Column (Current Slide + Presenter Notes below it): 60% */}
                <div className="flex flex-col gap-4 w-full md:w-[60%]">
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Slide</span>
                        {isCapturing && (
                          <button
                            onClick={() => setCaptureTrigger(prev => prev + 1)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 border border-slate-700 cursor-pointer"
                            title="Recapture Current Slide Preview"
                          >
                            Recapture
                          </button>
                        )}
                      </div>
                      {(currentSlide !== null || presentation?.currentSlide !== undefined) && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-osu-orange">
                          Slide {currentSlide !== null ? currentSlide : presentation?.currentSlide}
                        </span>
                      )}
                    </div>
                    <div className="relative w-full aspect-video bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl">
                      <ScreenCapture 
                        isCapturing={isCapturing} 
                        stream={stream} 
                        error={error} 
                        onStart={startCapture} 
                        onStop={stopCapture} 
                        logoUrl={logoUrl}
                        isProjectorMode={isProjectorMode}
                      />
                    </div>
                  </div>

                  {/* Confined Presenter Notes UI panel positioned immediately below the Current Slide preview */}
                  <div className="flex flex-col bg-slate-950 border border-slate-850 rounded-2xl p-5 min-h-[350px] max-h-[480px] select-none animate-in slide-in-from-bottom duration-300 shadow-xl">
                    <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-900/60 select-none">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-osu-orange" />
                        <span className="text-xs font-black uppercase tracking-wider text-slate-350">Presenter Notes</span>
                      </div>
                      {totalSlides !== null && currentSlide !== null && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Slide {currentSlide} of {totalSlides}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto text-base md:text-[17px] text-slate-100 font-bold leading-relaxed pr-2 custom-scrollbar space-y-2">
                      {notes ? (
                        <div className="whitespace-pre-wrap">{notes.replace(/\r/g, '\n')}</div>
                      ) : (
                        <div className="text-sm text-slate-500 italic flex items-center justify-center h-full">
                          No notes available for this slide.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column (Next Slide): smaller preview (35%) */}
                <div className="flex flex-col gap-2 w-full md:w-[35%] ml-auto">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Next Slide</span>
                    {nextSlide !== null && (
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Slide {nextSlide}
                      </span>
                    )}
                  </div>
                  <div className="relative w-full aspect-video bg-slate-950 border border-slate-850 rounded-2xl overflow-hidden flex items-center justify-center shadow-lg">
                    {isBridgeConnected && nextSlide !== null && nextSlide <= localSlidesCount ? (
                      <img 
                        src={`http://127.0.0.1:5000/slides/${nextSlide}.jpg`} 
                        alt="Next Slide Preview" 
                        className="w-full h-full object-contain bg-black animate-in fade-in duration-300"
                        key={`local-next-${nextSlide}`}
                      />
                    ) : nextSlidePreviewUrl ? (
                      <img 
                        src={nextSlidePreviewUrl} 
                        alt="Next Slide Preview" 
                        className="w-full h-full object-contain bg-black animate-in fade-in duration-300"
                        key={`firestore-next-${nextSlide}`}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-center p-4">
                        <Monitor className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                          {nextSlide !== null ? `Slide ${nextSlide}` : 'No Next Slide'}
                        </span>
                        <span className="text-[9px] text-slate-600 mt-1">
                          {nextSlide !== null ? 'Waiting for slide capture...' : 'End of presentation'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* SINGLE SCREEN FULL LAYOUT: Notes OFF */
              <div className="w-full flex flex-col gap-2 max-w-5xl">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Slide</span>
                    {isCapturing && (
                      <button
                        onClick={() => setCaptureTrigger(prev => prev + 1)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 border border-slate-700 cursor-pointer"
                        title="Recapture Current Slide Preview"
                      >
                        Recapture
                      </button>
                    )}
                  </div>
                  {(currentSlide !== null || presentation?.currentSlide !== undefined) && (
                    <span className="text-[10px] font-black uppercase tracking-wider text-osu-orange">
                      Slide {currentSlide !== null ? currentSlide : presentation?.currentSlide}
                    </span>
                  )}
                </div>
                <div className="relative w-full aspect-video bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl">
                  <ScreenCapture 
                    isCapturing={isCapturing} 
                    stream={stream} 
                    error={error} 
                    onStart={startCapture} 
                    onStop={stopCapture} 
                    logoUrl={logoUrl}
                    isProjectorMode={isProjectorMode}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <ScreenCapture 
            isCapturing={isCapturing} 
            stream={stream} 
            error={error} 
            onStart={startCapture} 
            onStop={stopCapture} 
            logoUrl={logoUrl}
            isProjectorMode={isProjectorMode}
          />
        )}

        {/* Real-time Virtual Laser Pointer Dot */}
        {isProjectorMode && presentation?.laserActive && presentation.laserX !== undefined && presentation.laserY !== undefined && (
          <div 
            style={{
              left: `${presentation.laserX}%`,
              top: `${presentation.laserY}%`,
              transform: 'translate(-50%, -50%)',
              width: '15px',
              height: '15px',
              borderRadius: '50%',
              backgroundColor: 'red',
              boxShadow: '0 0 8px 3px rgba(255, 0, 0, 0.8), 0 0 15px 5px rgba(255, 0, 0, 0.4)',
              position: 'absolute',
              pointerEvents: 'none',
              zIndex: 80,
              transition: 'top 0.05s ease-out, left 0.05s ease-out'
            }}
          />
        )}
        
        {/* Floating Setup Instructions Bubble - Shown in the top-left when not capturing */}
        {!isCapturing && !error && !isProjectorMode && (
          <button 
            onClick={() => setShowInstructions(true)}
            className="absolute top-4 left-4 z-[70] flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/50 text-white text-xs font-bold rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-sm"
            title="Show Presentation Setup Instructions"
          >
            <Info className="w-4 h-4 text-osu-orange" />
            <span>Setup Instructions</span>
          </button>
        )}

        {/* Setup Bridge Card - Shown when not capturing and no error */}
        {!isCapturing && !error && !isProjectorMode && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center flex flex-col items-center justify-center relative">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-500 shadow-lg ${
                isBridgeConnected 
                  ? 'bg-green-500/10 border border-green-500/35 text-green-400 shadow-green-500/5 animate-pulse' 
                  : 'bg-osu-orange/10 border border-osu-orange/30 text-osu-orange shadow-orange-500/5'
              }`}>
                <PresentationIcon className="w-7 h-7" />
              </div>
              
              <h2 className="text-xl font-black text-white mb-1 tracking-tight">Ready to Present?</h2>
              
              <div className="flex items-center gap-1.5 justify-center mb-6">
                <span className={`w-2 h-2 rounded-full ${isBridgeConnected ? 'bg-green-500 animate-pulse' : 'bg-osu-orange'}`} />
                <span className={`text-[11px] font-black uppercase tracking-wider ${isBridgeConnected ? 'text-green-500' : 'text-osu-orange'}`}>
                  {isBridgeConnected ? 'ActiveDeck Bridge Connected' : 'ActiveDeck Bridge Offline'}
                </span>
              </div>
              
              <div className="w-full space-y-3.5">
                {isBridgeConnected ? (
                  <>
                    <button
                      onClick={startCapture}
                      className="flex items-center justify-center gap-2.5 w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-650/20 text-sm cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Start Presentation
                    </button>
                    <p className="text-[10px] text-slate-500 leading-normal font-medium">
                      Ensure your PowerPoint is in Slide Show mode (F5) before sharing.
                    </p>
                  </>
                ) : (
                  <>
                    <a 
                      href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/ActiveBridge.Sync.zip"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2.5 w-full py-3.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Download ActiveDeck Bridge
                    </a>
                    
                    <div className="pt-2">
                      <button
                        onClick={() => {
                          setUseWithoutBridge(true);
                          startCapture();
                        }}
                        className="text-xs text-slate-400 hover:text-white transition-colors underline font-bold cursor-pointer bg-transparent border-0 p-0"
                      >
                        Start Presentation in Manual Mode (No Bridge)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stunning Classroom Welcome & Join Hub - Shown in projector mode when offline */}
        {!isCapturing && isProjectorMode && (
          <div className="absolute inset-0 z-[65] flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-white overflow-hidden">
            <div className="max-w-xl w-full flex flex-col items-center gap-5 md:gap-6 animate-in fade-in zoom-in-95 duration-500">
              {/* Logo / Brand Header */}
              <div className="flex flex-col items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="ActiveDeck" className="h-12 md:h-14 object-contain max-h-[56px]" />
                ) : (
                  <div className="flex items-center gap-2.5 text-2xl md:text-3xl font-black uppercase tracking-wider text-osu-orange">
                    <MonitorPlay className="w-8 h-8 md:w-9 md:h-9" />
                    <span>ActiveDeck</span>
                  </div>
                )}
                <p className="text-slate-400 text-sm md:text-base font-semibold tracking-wide mt-1">
                  Welcome! The presentation is about to begin.
                </p>
              </div>

               {/* QR Code Card */}
              <div className="bg-white p-4 rounded-2xl shadow-xl flex flex-col items-center justify-center border-2 border-osu-orange/20 hover:scale-102 transition-transform duration-300">
                <QRCodeSVG
                  value={`https://active-deck.app/chat?pin=${presentation?.pinCode || ''}`}
                  size={190}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* PIN & Connection Info */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="text-slate-500 text-xs md:text-sm font-black uppercase tracking-widest">
                    Scan to Join, or Go to:
                  </div>
                  <div className="text-2xl md:text-3xl font-black text-white bg-slate-900 border border-slate-800 px-7 py-3 rounded-2xl inline-block tracking-wider shadow-inner">
                    active-deck.app/chat
                  </div>
                </div>
                
                <div className="flex flex-col items-center gap-0.5 pt-1">
                  <div className="text-slate-500 text-[10px] md:text-xs font-black uppercase tracking-widest">
                    Enter Join Code (PIN):
                  </div>
                  <div className="text-5xl md:text-6xl font-black tracking-wider text-osu-orange select-all font-mono">
                    {presentation?.pinCode ? presentation.pinCode.replace(/(\d{3})(?=\d)/g, '$1 ') : '--- ---'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detailed Instructions Modal Overlay */}
        {showInstructions && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-205"
            onClick={() => setShowInstructions(false)}
          >
            <div 
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full text-center relative animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                onClick={() => setShowInstructions(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer border-0 bg-transparent"
                title="Close Instructions"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-10 h-10 bg-osu-orange/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <PresentationIcon className="w-5 h-5 text-osu-orange" />
              </div>
              
              <h2 className="text-lg font-black text-slate-900 mb-0.5">Ready to Present?</h2>
              <div className="text-slate-500 text-xs mb-4">
                {isBridgeConnected ? (
                  <span className="text-green-600 font-bold flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    Bridge Connected & Ready
                  </span>
                ) : (
                  <span>Choose your presentation type to get started.</span>
                )}
              </div>
              
              {/* Tabbed Interface */}
              <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
                <button
                  onClick={() => setActiveTab('single')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'single' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Single Screen
                </button>
                <button
                  onClick={() => setActiveTab('dual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'dual' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MonitorPlay className="w-3.5 h-3.5" />
                  Dual Screen
                </button>
                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'manual' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MousePointer2 className="w-3.5 h-3.5" />
                  Manual Mode
                </button>
              </div>

              <div className="text-left mb-4 min-h-[380px] flex flex-col">
                {activeTab === 'single' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario 1: Control & Sync</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Download <span className="font-bold">ActiveDeck Bridge (.zip)</span> below to computer.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Unzip file (right click and <span className="font-bold">"Extract All"</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Install file (<span className="font-bold">activedeck_bridge.exe</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">4</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Open PowerPoint and <span className="font-bold">start show (F5)</span>.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">5</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Press <span className="font-bold">Windows key</span> on keyboard and select browser.</p>
                        </div>
                        <div 
                          className="mt-1.5 p-2 bg-slate-50 rounded-lg border-2" 
                          style={{ borderColor: secondaryColor }}
                        >
                          <p className="text-[10px] text-slate-500 italic text-center leading-normal">
                            Advance slides using the <span className="font-bold">Prev/Next</span> button in ActiveDeck, not the PowerPoint.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      {!isBridgeConnected ? (
                        <>
                          <a 
                            href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/ActiveBridge.Sync.zip"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2.5 w-full py-2.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                          >
                            <Download className="w-4 h-4" />
                            Download ActiveDeck Bridge
                          </a>
                          <div className="flex gap-2.5 p-2 bg-amber-50 rounded-xl border border-amber-100">
                            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-700 leading-relaxed">
                              If Windows shows a protection warning, click <span className="font-bold">"More Info"</span> and then <span className="font-bold">"Run Anyway"</span>.
                            </p>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setShowInstructions(false);
                            startCapture();
                          }}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base cursor-pointer border-0"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Start Your Presentation
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'dual' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario 2: Dual Screen Pro</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Download <span className="font-bold">ActiveDeck Bridge (.zip)</span> below to computer.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Unzip file (right click and <span className="font-bold">"Extract All"</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Install file (<span className="font-bold">activedeck_bridge.exe</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">4</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Open PPT and start <span className="font-bold">Slide Show (F5)</span> on projector.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">5</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Drag this browser to your <span className="font-bold">secondary monitor</span>.</p>
                        </div>
                        <div 
                          className="mt-1.5 p-2 bg-slate-50 rounded-lg border-2" 
                          style={{ borderColor: secondaryColor }}
                        >
                          <p className="text-[10px] text-slate-500 italic text-center leading-normal">
                            Advance slides using the <span className="font-bold">Prev/Next</span> button in ActiveDeck, not the PowerPoint.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      {!isBridgeConnected ? (
                        <>
                          <a 
                            href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/ActiveBridge.Sync.zip"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2.5 w-full py-2.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                          >
                            <Download className="w-4 h-4" />
                            Download ActiveDeck Bridge
                          </a>
                          <div className="flex gap-2.5 p-2 bg-amber-50 rounded-xl border border-amber-100">
                            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-700 leading-relaxed">
                              If Windows shows a protection warning, click <span className="font-bold">"More Info"</span> and then <span className="font-bold">"Run Anyway"</span>.
                            </p>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setShowInstructions(false);
                            startCapture();
                          }}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base cursor-pointer border-0"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Start Your Presentation
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'manual' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario 3: Manual Mode</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Click <span className="font-bold">'Start Presentation'</span> below.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Use your <span className="font-bold">clicker/keyboard</span> to move slides manually.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Use <span className="font-bold">ActiveDeck</span> on a secondary screen with your PPT on the main screen. Advance the main screen PPT.</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      <button
                        onClick={() => {
                          setShowInstructions(false);
                          setUseWithoutBridge(true);
                          startCapture();
                        }}
                        className="flex items-center justify-center gap-2.5 w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-slate-900/30 text-base cursor-pointer border-0"
                      >
                        <Play className="w-5 h-5 fill-current" />
                        Start Presentation
                      </button>
                      <div className="flex gap-2.5 p-2 bg-blue-50 rounded-xl border border-blue-100">
                        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-blue-700 leading-relaxed">
                          <span className="font-bold">Note:</span> There will be no slide stamp on chat messages when not using the ActiveDeck Bridge.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              

              
              <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-slate-400">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isBridgeConnected || activeTab === 'manual' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {activeTab === 'manual' 
                    ? 'Ready for manual presentation' 
                    : isBridgeConnected 
                      ? 'Bridge Online & Ready' 
                      : 'Waiting for ActiveDeck connection...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>



      {/* Professional Remote Control Overlay - Only shown when bridge is connected */}
      {isBridgeConnected && !isProjectorMode && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 bg-slate-900/95 rounded-xl border border-slate-700/50 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 translate-y-2 group-hover:translate-y-0 z-50">
          <button
            onClick={() => handleSlideMove('prev')}
            className="flex items-center justify-center w-10 h-10 bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg transition-all active:scale-95 border border-slate-700/50 group/btn cursor-pointer"
            title="Previous Slide"
          >
            <ChevronLeft className="w-6 h-6 group-hover/btn:-translate-x-0.5 transition-transform" />
          </button>
          
          {totalSlides !== null && currentSlide !== null ? (
            <>
              <div className="w-px h-6 bg-slate-700/50 mx-0.5" />
              <div className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-350 bg-slate-950/40 rounded-lg border border-slate-850">
                Slide {currentSlide} of {totalSlides}
              </div>
            </>
          ) : null}

          <div className="w-px h-6 bg-slate-700/50 mx-0.5" />

          <button
            onClick={() => handleSlideMove('next')}
            className="flex items-center justify-center w-10 h-10 bg-osu-orange/90 hover:bg-osu-orange text-white rounded-lg transition-all active:scale-95 border border-orange-600/50 group/btn shadow-lg cursor-pointer"
            title="Next Slide"
          >
            <ChevronRight className="w-6 h-6 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* Floating Glassmorphic Fullscreen Toggle Button - Bottom Left (Vanishes when mouse is not hovering) */}
      {!isProjectorMode && (
        <button
          type="button"
          onClick={toggleFullscreen}
          className="absolute bottom-10 left-10 z-[100] p-3 rounded-full bg-slate-900/80 hover:bg-osu-orange border border-slate-800 hover:border-osu-orange text-slate-400 hover:text-white shadow-2xl transition-all duration-300 backdrop-blur-md cursor-pointer opacity-0 group-hover:opacity-100 flex items-center justify-center hover:scale-110 active:scale-95 outline-none"
          title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
      )}
    </div>
  );
};
