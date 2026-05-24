import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Users, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';

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
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const currentCodeRef = useRef<string | null>(null);

  // Helper to generate rotating 4-character alphanumeric OTP code
  const generateOTP = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

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

  // Function to generate and save a new token (Runs every 10 seconds)
  const generateNewToken = async () => {
    if (!presentationId) return;

    try {
      setErrorMsg(null); // Clear any previous errors on generation attempt
      const newTokenId = generateUUID();
      const now = Date.now();
      lastTokenGenerationTimeRef.current = now;

      // Save token directly to the presentation document (merge true to not touch screen codes)
      const presRef = doc(db, 'presentations', presentationId);
      await setDoc(presRef, {
        attendanceToken: newTokenId
      }, { merge: true });

      // Write token to Firestore with server timestamp
      const tokenRef = doc(db, 'presentations', presentationId, 'attendance_tokens', newTokenId);
      await setDoc(tokenRef, {
        createdAt: serverTimestamp()
      });

      // Update active token in UI
      setActiveToken(newTokenId);
      setLoading(false);

      // Add to our tracker
      generatedTokensRef.current.push({ id: newTokenId, createdAt: now });

      // Run background self-cleaning of old tokens (older than 50 seconds, to guarantee students get a full 45s TTL)
      cleanExpiredTokens(now);
    } catch (err: any) {
      console.error('Error generating attendance token:', err);
      setLoading(false);
      setErrorMsg(err?.message || String(err));
    }
  };

  // Function to rotate and save a new Screen Code OTP (Runs every 15 seconds)
  const rotateScreenCode = async () => {
    if (!presentationId) return;

    try {
      const prevCode = currentCodeRef.current;
      const newCode = generateOTP();

      // Save currentCode and previousCode directly to the presentation document
      const presRef = doc(db, 'presentations', presentationId);
      await setDoc(presRef, {
        currentCode: newCode,
        previousCode: prevCode || null
      }, { merge: true });

      // Update active code in UI
      currentCodeRef.current = newCode;
      setCurrentCode(newCode);
    } catch (err) {
      console.error('Error rotating Screen Code:', err);
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

  // Setup the QR token rotation and countdown loop
  useEffect(() => {
    if (!presentationId) return;

    // Generate initial token immediately
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

  // Setup the Screen Code rotation loop (Runs every 15 seconds)
  useEffect(() => {
    if (!presentationId) return;

    // Generate initial Screen Code immediately
    rotateScreenCode();

    const codeRotationInterval = setInterval(() => {
      rotateScreenCode();
    }, 15000); // 15000ms is exactly 15 seconds

    return () => {
      clearInterval(codeRotationInterval);
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
        <div className="w-[170px] bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center p-3 animate-in fade-in slide-in-from-bottom-3 duration-300">
          
          {/* Header */}
          <div className="flex justify-between items-center w-full mb-2">
            <div className="flex items-center gap-1">
              <QrCode className="w-3.5 h-3.5 text-osu-orange" />
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">Attendance</span>
            </div>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-slate-800 text-slate-500 hover:text-white rounded-md transition-colors"
              title="Minimize"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* QR Display */}
          <div className="relative bg-white p-2.5 rounded-xl flex items-center justify-center w-[146px] h-[146px] shadow-inner mb-3">
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
                  size={126}
                  level="H"
                  fgColor="#0f172a" // Slate 900
                  bgColor="#ffffff"
                  imageSettings={{
                    src: logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png",
                    x: undefined,
                    y: undefined,
                    height: 24,
                    width: 24,
                    excavate: true,
                  }}
                />
              )
            )}
          </div>

          {/* Prompt info */}
          <div className="w-full text-center space-y-1.5 mb-2.5 px-1">
            <p className="text-[10px] font-black text-slate-200 uppercase tracking-wider">Scan to Check-In</p>
            
            <div className="w-full bg-slate-950/80 p-2 rounded-xl border border-slate-800 space-y-1.5 text-center">
              <div className="flex flex-col items-center">
                <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-none">OR JOIN AT:</span>
                <span className="text-[10.5px] font-black text-osu-orange truncate max-w-[136px] leading-normal select-all mt-0.5">
                  {shortUrl ? shortUrl.replace(/^https?:\/\//i, '') : `${window.location.hostname}/...`}
                </span>
              </div>
              <div className="h-px bg-slate-800/60 w-full" />
              <div className="flex flex-col items-center">
                <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-none">SCREEN CODE:</span>
                <span className="text-3xl font-mono font-black text-white select-all mt-1 tracking-wider leading-none">
                  {currentCode || '----'}
                </span>
              </div>
            </div>
            
            <p className="text-[8px] text-slate-400 font-semibold leading-normal">QR: 10s | Code: 15s</p>
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
