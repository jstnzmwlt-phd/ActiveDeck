import React, { useState, useEffect, useRef } from 'react';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Users, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';

interface AttendanceQRProps {
  presentationId: string;
  logoUrl?: string;
}

interface LocalTokenTracker {
  id: string;
  createdAt: number;
}

export const AttendanceQR: React.FC<AttendanceQRProps> = ({ presentationId, logoUrl }) => {
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10); // 10s countdown for token refresh
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Ref to track generated tokens locally for precise self-cleaning
  const generatedTokensRef = useRef<LocalTokenTracker[]>([]);

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

  // Function to generate and save a new token
  const generateNewToken = async () => {
    if (!presentationId) return;

    try {
      setErrorMsg(null); // Clear any previous errors on generation attempt
      const newTokenId = generateUUID();
      const now = Date.now();

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

  // Setup the token rotation loop (Runs every 10 seconds)
  useEffect(() => {
    if (!presentationId) return;

    // Generate initial token immediately
    generateNewToken();

    const rotationInterval = setInterval(() => {
      setTimeLeft(10);
      generateNewToken();
    }, 10000); // 10000ms is exactly 10 seconds

    return () => {
      clearInterval(rotationInterval);
      // Clean up all leftover tokens from this session on unmount
      const now = Date.now();
      cleanExpiredTokens(now + 100000); // offset to trigger deletions on all remaining
    };
  }, [presentationId]);

  // Setup countdown bar ticks (Runs every 100ms for ultra-smooth UI progress bar)
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) return 10;
        return Number((prev - 0.1).toFixed(1));
      });
    }, 100);

    return () => clearInterval(timer);
  }, []);

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
          <div className="text-center space-y-1 mb-2">
            <p className="text-[10px] font-black text-slate-200">Scan to Check-In</p>
            <p className="text-[8px] text-slate-400 font-medium leading-normal">Updates every 10s</p>
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
