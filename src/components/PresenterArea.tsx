import React, { useState, useEffect } from 'react';
import { Presentation } from '../types';
import { ScreenCapture } from './ScreenCapture';
import { ChevronLeft, ChevronRight, Download, Info, ShieldAlert, Presentation as PresentationIcon, Monitor, MonitorPlay, MousePointer2, Play } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';

interface PresenterAreaProps {
  presentation: Presentation | null;
  logoUrl?: string;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation, logoUrl }) => {
  const { currentSlide, sendSlideCommand, isBridgeConnected, useWithoutBridge, setUseWithoutBridge } = useBridge();
  const [activeTab, setActiveTab] = useState<'single' | 'dual' | 'manual'>('single');
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSlideMove = (direction: 'next' | 'prev') => {
    sendSlideCommand(direction);
  };

  const startCapture = () => {
    setError(null);
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      .then(async (mediaStream) => {
        setError(null);
        setStream(mediaStream);
        setIsCapturing(true);

        // Automatically go into full screen mode
        try {
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
          }
        } catch (fullscreenErr) {
          console.error("ActiveDeck: Error attempting to enable full-screen mode:", fullscreenErr);
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
          setError("Permission Denied: The screen share request was cancelled or denied.");
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
  };

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  return (
    <div className="flex flex-col h-full bg-black relative group">
      {/* Slide Indicator - Matches Chat Badge Style (OSU Orange) */}
      {(currentSlide !== null || presentation?.currentSlide !== undefined) && (
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
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <ScreenCapture 
          isCapturing={isCapturing} 
          stream={stream} 
          error={error} 
          onStart={startCapture} 
          onStop={stopCapture} 
          logoUrl={logoUrl}
        />
        
        {/* Setup Bridge Card - Shown when not capturing and no error */}
        {!isCapturing && !error && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-5 max-w-lg w-full text-center">
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
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === 'single' ? 'bg-white text-osu-orange shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Single Screen
                </button>
                <button
                  onClick={() => setActiveTab('dual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === 'dual' ? 'bg-white text-osu-orange shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MonitorPlay className="w-3.5 h-3.5" />
                  Dual Screen
                </button>
                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
                    activeTab === 'manual' ? 'bg-white text-osu-orange shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
                        <div className="mt-1.5 p-2 bg-slate-50 border border-slate-100 rounded-lg">
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
                          onClick={startCapture}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base"
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
                        <div className="mt-1.5 p-2 bg-slate-50 border border-slate-100 rounded-lg">
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
                          onClick={startCapture}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base"
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
                          setUseWithoutBridge(true);
                          startCapture();
                        }}
                        className="flex items-center justify-center gap-2.5 w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-slate-900/30 text-base"
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
      {isBridgeConnected && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-700/30 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 translate-y-2 group-hover:translate-y-0 z-50">
          <button
            onClick={() => handleSlideMove('prev')}
            className="flex items-center justify-center w-10 h-10 bg-slate-800/80 hover:bg-slate-700 text-white rounded-lg transition-all active:scale-95 border border-slate-700/50 group/btn"
            title="Previous Slide"
          >
            <ChevronLeft className="w-6 h-6 group-hover/btn:-translate-x-0.5 transition-transform" />
          </button>
          
          <div className="w-px h-6 bg-slate-700/50 mx-0.5" />

          <button
            onClick={() => handleSlideMove('next')}
            className="flex items-center justify-center w-10 h-10 bg-osu-orange/90 hover:bg-osu-orange text-white rounded-lg transition-all active:scale-95 border border-orange-600/50 group/btn shadow-lg"
            title="Next Slide"
          >
            <ChevronRight className="w-6 h-6 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}
    </div>
  );
};
