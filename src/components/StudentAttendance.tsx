import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Loader2, CheckCircle2, XCircle, User, Mail, Timer, AlertCircle } from 'lucide-react';
import { MEDICAL_ICONS, MedicalIcon, generateIconGrid } from './MedicalIcon';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StudentAttendanceProps {
  presentationId: string;
  token: string | null;
}

export const StudentAttendance: React.FC<StudentAttendanceProps> = ({ presentationId, token }) => {
  const [loading, setLoading] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [tokenData, setTokenData] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isManualMode = !token;
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconGrid, setIconGrid] = useState<string[]>([]);
  const [presentation, setPresentation] = useState<any>(null);
  const [ipAddress, setIpAddress] = useState('127.0.0.1');

  // Fetch client-side IP address on mount
  useEffect(() => {
    const fetchIp = async () => {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
          const data = await res.json();
          if (data.ip) {
            setIpAddress(data.ip);
          }
        }
      } catch (err) {
        /* 
           DEVELOPER COMMENT: Client-side IP address fetching.
           This is a fallback solution using https://api.ipify.org.
           If this client-side request fails (e.g. due to user ad-blockers, network issues, 
           or CORS constraints), it gracefully defaults to '127.0.0.1'.
           In a production deployment, this client-side IP detection can be overridden 
           or verified by server-side middleware checking standard request headers 
           like 'X-Forwarded-For' or 'CF-Connecting-IP'.
        */
        console.warn('Failed to fetch client-side IP, using default fallback.', err);
      }
    };
    fetchIp();
  }, []);

  // Phase 1: Validate the token from Firestore (If not in manual mode)
  useEffect(() => {
    if (!token) return; // Standard token validation handles this

    if (!presentationId) {
      setIsValid(false);
      setLoading(false);
      return;
    }

    const validateToken = async () => {
      try {
        const tokenRef = doc(db, 'presentations', presentationId, 'attendance_tokens', token);
        const tokenSnap = await getDoc(tokenRef);

        if (!tokenSnap.exists()) {
          setIsValid(false);
          setLoading(false);
          return;
        }

        const data = tokenSnap.data();
        const createdAt = data.createdAt as Timestamp;
        
        if (!createdAt) {
          // If the timestamp hasn't registered yet, assume it is brand new
          setIsValid(true);
          setTokenData({ createdAt: Timestamp.now() });
          setTimeLeft(45);
          setLoading(false);
          return;
        }

        const tokenTime = createdAt.toMillis();
        // Fetch current estimated Firebase time by making a quick comparison, or just Date.now()
        // (Most users' clocks are within a few seconds of server time, so Date.now() works perfectly)
        const elapsed = (Date.now() - tokenTime) / 1000;

        if (elapsed >= 45) {
          setIsValid(false);
        } else {
          setIsValid(true);
          setTokenData(data);
          setTimeLeft(Math.max(0, Math.ceil(45 - elapsed)));
        }
      } catch (err) {
        console.error('Error validating token:', err);
        setIsValid(false);
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, [presentationId, token]);

  // Phase 1b: If in manual mode, subscribe reactively to presentation session so we get rotating icons
  useEffect(() => {
    if (token || !presentationId) return;

    setLoading(true);
    const presRef = doc(db, 'presentations', presentationId);
    
    const unsub = onSnapshot(presRef, (presSnap) => {
      setLoading(false);
      if (!presSnap.exists()) {
        setIsValid(false);
        setErrorMsg("Presentation session not found. Please verify the URL.");
        setPresentation(null);
      } else {
        setIsValid(true);
        const data = presSnap.data();
        setPresentation(data);
      }
    }, (err) => {
      console.error('Error listening to presentation details:', err);
      setLoading(false);
      setIsValid(false);
      setErrorMsg("Failed to connect to the session. Please check your internet connection.");
    });

    return () => unsub();
  }, [presentationId, token]);

  // Regenerate student manual-join 20-icon grid when the presenter's currentIcon rotates
  useEffect(() => {
    if (presentation?.currentIcon) {
      const grid = generateIconGrid(presentation.currentIcon);
      setIconGrid(grid);
      setSelectedIcon(null); // Reset selection on rotation to prevent accidental submittal of stale icon
    }
  }, [presentation?.currentIcon]);

  // Student manual check-in heartbeat effect to pause icon rotation
  useEffect(() => {
    if (!isManualMode || !isValid || submitSuccess || !presentationId) {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        const presRef = doc(db, 'presentations', presentationId);
        await setDoc(presRef, {
          lastManualActivityAt: Date.now()
        }, { merge: true });
        console.log('[Student Attendance Portal] Sent manual activity heartbeat to Firestore');
      } catch (err) {
        console.error('[Student Attendance Portal] Failed to send manual activity heartbeat:', err);
      }
    };

    // Send heartbeat immediately on mount/access
    sendHeartbeat();

    // Set up 10-second interval for subsequent heartbeats
    const interval = setInterval(() => {
      sendHeartbeat();
    }, 10000);

    return () => clearInterval(interval);
  }, [isManualMode, isValid, submitSuccess, presentationId]);

  // Phase 2: Live countdown timer
  useEffect(() => {
    if (!isValid || timeLeft === null || tokenData === null) return;

    const interval = setInterval(() => {
      const createdAt = tokenData.createdAt as Timestamp;
      if (!createdAt) return;

      const tokenTime = createdAt.toMillis();
      const elapsed = (Date.now() - tokenTime) / 1000;
      const remaining = Math.max(0, Math.ceil(45 - elapsed));

      setTimeLeft(remaining);

      if (remaining <= 0) {
        setIsValid(false);
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isValid, timeLeft, tokenData]);

  // Phase 2b: Live countdown timer for manual mode (rotates every 15s)
  useEffect(() => {
    if (!isManualMode || !isValid) return;

    const currentIcon = presentation?.currentIcon;
    if (!currentIcon) {
      setTimeLeft(15);
      return;
    }

    const rotatedAt = presentation?.iconRotatedAt;
    let initialRemaining = 15;

    if (rotatedAt) {
      const elapsed = (Date.now() - rotatedAt) / 1000;
      if (elapsed >= 0 && elapsed <= 15) {
        initialRemaining = 15 - elapsed;
      }
    }

    setTimeLeft(Math.max(1, Math.ceil(initialRemaining)));
    const startTime = Date.now() - (15 - initialRemaining) * 1000;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(15 - elapsed));

      setTimeLeft(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [isManualMode, isValid, presentation?.currentIcon, presentation?.iconRotatedAt]);

  // Phase 3: Submit Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    if (isManualMode && !selectedIcon) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      if (!isManualMode) {
        // Validate again right before submit
        if (!tokenData) throw new Error("EXPIRED_TOKEN");
        const createdAt = tokenData.createdAt as Timestamp;
        const tokenTime = createdAt.toMillis();
        const elapsed = (Date.now() - tokenTime) / 1000;

        if (elapsed >= 45) {
          setIsValid(false);
          throw new Error("EXPIRED_TOKEN");
        }
      } else {
        // Fetch presentation doc and validate screen icon
        const presRef = doc(db, 'presentations', presentationId);
        const presSnap = await getDoc(presRef);
        if (!presSnap.exists()) {
          throw new Error("SESSION_NOT_FOUND");
        }
        const presData = presSnap.data();
        const currentIconVal = presData.currentIcon || '';
        const previousIconVal = presData.previousIcon || '';

        if (!selectedIcon || (selectedIcon !== currentIconVal && selectedIcon !== previousIconVal)) {
          throw new Error("INVALID_SCREEN_ICON");
        }
      }

      // Format email to lower case and trim to ensure clean ID
      const studentEmail = email.trim().toLowerCase();

      // Fetch active institution details from settings/global
      let activeInstitutionId = 'custom';
      let activeInstitutionName = 'Custom / Active Theme';
      try {
        const globalRef = doc(db, 'settings', 'global');
        const globalSnap = await getDoc(globalRef);
        if (globalSnap.exists()) {
          const globalData = globalSnap.data();
          if (globalData.activeInstitutionId) {
            activeInstitutionId = globalData.activeInstitutionId;
          }
          if (globalData.activeInstitutionName) {
            activeInstitutionName = globalData.activeInstitutionName;
          }
        }
      } catch (err) {
        console.error('Error fetching global settings for institution info:', err);
      }

      // Write check-in directly to Firestore subcollection using the email as document ID
      const attendanceRef = doc(db, 'presentations', presentationId, 'attendance', studentEmail);
      await setDoc(attendanceRef, {
        name: name.trim(),
        email: studentEmail,
        checkedInAt: serverTimestamp(),
        scannedToken: token || null,
        institutionId: activeInstitutionId,
        institutionName: activeInstitutionName,
        authMethod: isManualMode ? 'URL' : 'QR',
        ipAddress: ipAddress
      });

      setSubmitSuccess(true);
    } catch (err: any) {
      console.error('Submission error:', err);
      if (err.message === "EXPIRED_TOKEN") {
        setErrorMsg("This QR code has expired. Please scan the newest code on the screen.");
      } else if (err.message === "INVALID_SCREEN_ICON") {
        setErrorMsg("Incorrect icon selected. Please look at the presenter's screen and choose the matching medical icon.");
      } else if (err.message === "SESSION_NOT_FOUND") {
        setErrorMsg("This presentation session is no longer active.");
      } else {
        setErrorMsg("Failed to record attendance. Please try again or ask your presenter.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6">
        <Loader2 className="w-12 h-12 text-osu-orange animate-spin mb-4" />
        <p className="text-sm font-black uppercase tracking-[0.2em] opacity-60">Verifying Ticket...</p>
      </div>
    );
  }

  if (!isValid && !submitSuccess) {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6">
        <div className="w-full max-w-md bg-slate-900 border border-red-500/20 rounded-3xl p-8 shadow-2xl text-center flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
            <XCircle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-white">QR Code Expired</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            This QR code has expired. To prevent cheating, attendance codes update every 10 seconds. Please scan the newest code on the presenter's screen.
          </p>
          <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 bg-slate-950 px-4 py-2 rounded-full border border-slate-800">
            45-Second Rotation Lock
          </div>
        </div>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6">
        <div className="w-full max-w-md bg-slate-900 border border-green-500/20 rounded-3xl p-8 shadow-2xl text-center flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mb-6 border border-green-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-white">Check-In Successful</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            Thank you, <span className="text-white font-bold">{name}</span>! Your attendance has been successfully recorded for this session.
          </p>
          <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl text-left w-full text-xs space-y-1.5 text-slate-400">
            <div className="flex justify-between"><span className="opacity-60">Email:</span> <span className="text-slate-200 font-semibold">{email}</span></div>
            <div className="flex justify-between"><span className="opacity-60">Session ID:</span> <span className="text-slate-200 font-mono font-semibold">{presentationId}</span></div>
            <div className="flex justify-between items-center"><span className="opacity-60">Verification:</span> <span className="text-osu-orange font-bold uppercase tracking-wider text-[9px] bg-osu-orange/10 px-2 py-0.5 rounded border border-osu-orange/20">{isManualMode ? 'Screen Icon Match' : 'Secure QR Scan'}</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-4 md:p-8 relative overflow-y-auto">
      <div className={cn(
        "w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-10 shadow-2xl animate-in fade-in zoom-in-95 duration-300 relative",
        isManualMode ? "max-w-5xl" : "max-w-md"
      )}>
        
        {/* Header and Countdown for QR/Token mode */}
        {!isManualMode && (
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-black text-white">Session Check-In</h2>
              <p className="text-xs text-slate-400 mt-1">Please record your attendance</p>
            </div>
            {timeLeft !== null && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black tracking-wider transition-colors ${
                timeLeft <= 10 
                  ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse' 
                  : 'bg-osu-orange/10 text-osu-orange border-osu-orange/20'
              }`}>
                <Timer className="w-3.5 h-3.5" />
                <span>QR: {timeLeft}s</span>
              </div>
            )}
          </div>
        )}

        {errorMsg && !isManualMode && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-500/20 rounded-2xl flex gap-3 text-xs text-red-300 items-start">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {isManualMode ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              
              {/* Left Column: Information and Inputs */}
              <div className="space-y-5 flex flex-col justify-between h-full">
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">Session Check-In</h2>
                  <p className="text-slate-400 text-xs md:text-sm mt-2 leading-relaxed">
                    Enter your name, email, and select the matching screen icon to register attendance for this session.
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-4 bg-red-950/30 border border-red-500/20 rounded-2xl flex gap-3 text-xs text-red-300 items-start">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <p className="leading-relaxed">{errorMsg}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Full Name</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                        <User className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Email Address</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                        <Mail className="w-4 h-4" />
                      </span>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !name.trim() || !email.trim() || !selectedIcon}
                  className="w-full h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/10 flex items-center justify-center gap-2 mt-4"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Checking In...</span>
                    </>
                  ) : (
                    <span>Confirm Check-In</span>
                  )}
                </button>
              </div>

              {/* Right Column: Icon verification Grid */}
              <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-400">
                    Verify Screen Icon
                  </label>
                  {timeLeft !== null && (
                    <div className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-wider uppercase transition-colors",
                      timeLeft <= 5 
                        ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse" 
                        : "bg-osu-orange/10 text-osu-orange border-osu-orange/20"
                    )}>
                      <Timer className="w-3.5 h-3.5" />
                      <span>Icon: {timeLeft}s</span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-500 leading-normal">
                  Select the medical icon shown on the presenter's screen to verify your attendance:
                </p>

                {/* Premium Progress Bar */}
                {timeLeft !== null && (
                  <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden relative border border-slate-900/50">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-100 ease-linear",
                        timeLeft <= 5 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-osu-orange"
                      )}
                      style={{ width: `${(timeLeft / 15) * 100}%` }}
                    />
                  </div>
                )}

                {/* 4x5 icon grid with overflow-hidden and no scrollbar */}
                <div className="grid grid-cols-4 gap-2.5 p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                  {iconGrid.map((iconName, idx) => {
                    const isSelected = selectedIcon === iconName;
                    return (
                      <button
                        key={`${iconName}-${idx}`}
                        type="button"
                        onClick={() => setSelectedIcon(iconName)}
                        className={cn(
                          "h-12 rounded-xl flex items-center justify-center transition-all duration-200 border cursor-pointer",
                          isSelected
                            ? "bg-osu-orange/20 border-osu-orange text-osu-orange shadow-[0_0_10px_rgba(235,93,0,0.4)] scale-95"
                            : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-white hover:border-slate-700 hover:bg-slate-900"
                        )}
                        title={iconName}
                      >
                        <MedicalIcon name={iconName} className="w-6 h-6" />
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          ) : (
            /* QR mode standard single column form */
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Full Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                    <User className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Email Address</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john.doe@example.com"
                    className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !name.trim() || !email.trim()}
                className="w-full h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/10 flex items-center justify-center gap-2 mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Checking In...</span>
                  </>
                ) : (
                  <span>Confirm Check-In</span>
                )}
              </button>
            </div>
          )}
        </form>

        <p className="text-[10px] text-slate-500 text-center leading-relaxed mt-6">
          Your attendance data is written securely. This portal validates tokens automatically against the ActiveDeck session.
        </p>
      </div>
    </div>
  );
};
