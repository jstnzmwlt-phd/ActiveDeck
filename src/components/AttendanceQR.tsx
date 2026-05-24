import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Users, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';
import { MEDICAL_ICONS, MedicalIcon } from './MedicalIcon';

interface AttendanceQRProps {
  presentationId: string;
  logoUrl?: string;
  isSharingScreen?: boolean;
}

interface LocalTokenTracker {
  id: string;
  createdAt: number;
}

export const AttendanceQR: React.FC<AttendanceQRProps> = ({ presentationId, logoUrl, isSharingScreen = false }) => {
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [timeLeft, setTimeLeft] = useState(10); // 10s countdown for QR token refresh
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Ref to track generated tokens locally for precise self-cleaning
  const generatedTokensRef = useRef<LocalTokenTracker[]>([]);
  const lastTokenGenerationTimeRef = useRef<number>(Date.now());

  // Rotating OTP states and helpers
  const [shortUrl, setShortUrl] = useState<string>('');
  const [currentIcon, setCurrentIcon] = useState<string | null>(null);
  const currentIconRef = useRef<string | null>(null);
  const iconCycleCountRef = useRef<number>(1);

  // Fetch the manual URL shortened via API on mount/ID change
  useEffect(() => {
    if (!presentationId) return;
    
    const manualUrl = `${window.location.origin}/attendance/${presentationId}`;
    const fetchShortUrl = async () => {
      try {
        const response = await fetch(`/api/shorten?url=${encodeURIComponent(manualUrl)}`);
        if (response.ok) {
          const text = await response.text();
          setShortUrl(text);
        }
      } catch (error) {
        console.error("Failed to generate short URL for AttendanceQR:", error);
      }
    };
    
    fetchShortUrl();
  }, [presentationId]);

  // Helper to generate UUID safely across browser environments (especially inside iFrame/Office Add-in)
  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Standard robust fallback UUID v4 generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  // Function to generate and save a new token & rotate icon (Runs every 10 seconds)
  const generateNewToken = async () => {
    if (!presentationId) return;

    try {
      setErrorMsg(null); // Clear any previous errors on generation attempt
      const newTokenId = generateUUID();
      const now = Date.now();
      lastTokenGenerationTimeRef.current = now;

      const presRef = doc(db, 'presentations', presentationId);
      const prevIcon = currentIconRef.current;
      const availableIcons = prevIcon 
        ? MEDICAL_ICONS.filter(icon => icon !== prevIcon) 
        : MEDICAL_ICONS;
      const newIcon = availableIcons[Math.floor(Math.random() * availableIcons.length)];

      // Save token & rotated icon in a single Firestore document write
      await setDoc(presRef, {
        attendanceToken: newTokenId,
        currentIcon: newIcon,
        previousIcon: prevIcon || null,
        iconRotatedAt: now
      }, { merge: true });

      // Write token to Firestore subcollection with server timestamp
      const tokenRef = doc(db, 'presentations', presentationId, 'attendance_tokens', newTokenId);
      await setDoc(tokenRef, {
        createdAt: serverTimestamp()
      });

      // Update active token and icon in UI
      setActiveToken(newTokenId);
      currentIconRef.current = newIcon;
      setCurrentIcon(newIcon);
      setLoading(false);

      // Add to our tracker
      generatedTokensRef.current.push({ id: newTokenId, createdAt: now });

      // Run background self-cleaning of old tokens (older than 50 seconds, to guarantee students get a full 45s TTL)
      cleanExpiredTokens(now);
      console.log(`[Presenter QR] Generated token ${newTokenId} and rotated icon to: ${newIcon}`);
    } catch (err: any) {
      console.error('Error generating attendance token:', err);
      setLoading(false);
      setErrorMsg(err?.message || String(err));
    }
  };

  // Background self-cleaning function
  const cleanExpiredTokens = async (currentTime: number) => {
    const tokensToClean = generatedTokensRef.current.filter(t => currentTime - t.createdAt >= 50000);
    
    for (const token of tokensToClean) {
      try {
        const expiredTokenRef = doc(db, 'presentations', presentationId, 'attendance_tokens', token.id);
        await deleteDoc(expiredTokenRef);
        
        // Remove from local tracker
        generatedTokensRef.current = generatedTokensRef.current.filter(t => t.id !== token.id);
      } catch (err) {
        console.error(`Failed to clean up expired token ${token.id}:`, err);
      }
    }
  };

  // Setup the QR token and screen icon rotation loop (Runs every 10 seconds in sync)
  useEffect(() => {
    if (!presentationId) return;

    // Generate initial token & icon immediately
    generateNewToken();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTokenGenerationTimeRef.current) / 1000;
      
      if (elapsed >= 10) {
        generateNewToken();
        setTimeLeft(10);
      } else {
        setTimeLeft(Number((10 - elapsed).toFixed(1)));
      }
    }, 100);

    return () => {
      clearInterval(interval);
      // Clean up all leftover tokens from this session on unmount
      const now = Date.now();
      cleanExpiredTokens(now + 100000); // offset to trigger deletions on all remaining
    };
  }, [presentationId]);

  // Maximize when screen sharing starts
  useEffect(() => {
    if (isSharingScreen) {
      setIsCollapsed(false);
    }
  }, [isSharingScreen]);

  // Auto-minimize after 20 minutes (1200000ms) when maximized
  useEffect(() => {
    if (isCollapsed) return;

    const autoMinimizeTimer = setTimeout(() => {
      setIsCollapsed(true);
    }, 20 * 60 * 1000); // 20 minutes

    return () => clearTimeout(autoMinimizeTimer);
  }, [isCollapsed]);

  if (!presentationId) return null;

  const attendanceUrl = activeToken
    ? `${window.location.origin}/attendance/${presentationId}?token=${activeToken}`
    : '';

  // Width percentage for countdown bar
  const progressPercent = (timeLeft / 10) * 100;

  return (
    <div className="absolute bottom-4 left-4 z-[80] select-none font-sans">
      {isCollapsed ? (
        // Collapsed Badge
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-900 text-white rounded-xl border border-slate-700/50 shadow-xl transition-all duration-200 active:scale-95 group"
        >
          <QrCode className="w-4 h-4 text-osu-orange animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-wider">Attendance QR</span>
          <ChevronUp className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
        </button>
      ) : (
        // Expanded Panel
        <div className="w-[190px] bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center p-3.5 animate-in fade-in slide-in-from-bottom-3 duration-300">
          
          {/* Header */}
          <div className="flex justify-between items-center w-full mb-2">
            <div className="flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-osu-orange" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Attendance</span>
            </div>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-slate-800 text-slate-500 hover:text-white rounded-md transition-colors"
              title="Minimize"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* QR Display */}
          <div className="relative bg-white p-2.5 rounded-xl flex items-center justify-center w-[166px] h-[166px] shadow-inner mb-3">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white rounded-xl">
                <Loader2 className="w-6 h-6 text-osu-orange animate-spin" />
              </div>
            ) : errorMsg ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-xl p-2 text-center">
                <span className="text-red-500 font-bold text-[10px] mb-1">Error!</span>
                <span className="text-slate-600 text-[8px] line-clamp-4 leading-normal select-text break-all">
                  {errorMsg}
                </span>
                <button
                  onClick={() => {
                    setLoading(true);
                    generateNewToken();
                  }}
                  className="mt-1 p-1 bg-slate-100 hover:bg-slate-200 active:scale-95 rounded text-[8px] font-bold text-slate-700 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-2.5 h-2.5 text-osu-orange" />
                  Retry
                </button>
              </div>
            ) : (
              attendanceUrl && (
                <QRCodeSVG
                  value={attendanceUrl}
                  size={146}
                  level="H"
                  fgColor="#0f172a" // Slate 900
                  bgColor="#ffffff"
                  imageSettings={{
                    src: logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png",
                    x: undefined,
                    y: undefined,
                    height: 28,
                    width: 24,
                    excavate: true,
                  }}
                />
              )
            )}
          </div>

          {/* Prompt info */}
          <div className="w-full text-center space-y-2 mb-2.5 px-0.5">
            <p className="text-[10px] font-black text-slate-200 uppercase tracking-wider">Scan to Check-In</p>
            
            <div className="w-full bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 space-y-2 text-center">
              <div className="flex flex-col items-center">
                <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-none">OR JOIN AT:</span>
                <span className="text-[11px] font-black text-osu-orange truncate max-w-[156px] leading-normal select-all mt-0.5">
                  {shortUrl ? shortUrl.replace(/^https?:\/\//i, '') : `${window.location.hostname}/...`}
                </span>
              </div>
              <div className="h-px bg-slate-800/60 w-full" />
              <div className="flex flex-col items-center">
                <span className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-none">SCREEN ICON:</span>
                <div className="w-20 h-20 bg-slate-950 border border-osu-orange/30 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(255,102,0,0.15)] mt-2">
                  {currentIcon ? (
                    <MedicalIcon name={currentIcon} className="w-12 h-12 text-osu-orange" />
                  ) : (
                    <span className="text-slate-600 text-[14px] font-bold">---</span>
                  )}
                </div>
              </div>
            </div>
            
            <p className="text-[8px] text-slate-400 font-semibold leading-normal">QR & Icon: 10s Rotation</p>
          </div>

          {/* Visual Progress Bar Container */}
          <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-100 ease-linear ${
                timeLeft <= 3 ? 'bg-red-500' : 'bg-osu-orange'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
