import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Loader2, CheckCircle2, XCircle, User, Mail, Timer, AlertCircle } from 'lucide-react';

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

  // Phase 1: Validate the token from Firestore
  useEffect(() => {
    if (!token || !presentationId) {
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

  // Phase 3: Submit Form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      // Validate again right before submit
      const createdAt = tokenData.createdAt as Timestamp;
      const tokenTime = createdAt.toMillis();
      const elapsed = (Date.now() - tokenTime) / 1000;

      if (elapsed >= 45) {
        setIsValid(false);
        throw new Error("EXPIRED_TOKEN");
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
        scannedToken: token,
        institutionId: activeInstitutionId,
        institutionName: activeInstitutionName
      });

      setSubmitSuccess(true);
    } catch (err: any) {
      console.error('Submission error:', err);
      if (err.message === "EXPIRED_TOKEN") {
        setErrorMsg("This QR code has expired. Please scan the newest code on the screen.");
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
          <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl text-left w-full text-xs space-y-1 text-slate-400">
            <div className="flex justify-between"><span className="opacity-60">Email:</span> <span className="text-slate-200 font-semibold">{email}</span></div>
            <div className="flex justify-between"><span className="opacity-60">Session ID:</span> <span className="text-slate-200 font-mono font-semibold">{presentationId}</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
        
        {/* Header and Countdown */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-black text-white">Session Check-In</h2>
            <p className="text-xs text-slate-400 mt-1">Please record your attendance</p>
          </div>
          
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black tracking-wider transition-colors ${
            timeLeft && timeLeft <= 10 
              ? 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse' 
              : 'bg-osu-orange/10 text-osu-orange border-osu-orange/20'
          }`}>
            <Timer className="w-4 h-4" />
            <span>{timeLeft}s</span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-950/30 border border-red-500/20 rounded-2xl flex gap-3 text-xs text-red-300 items-start">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
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
        </form>

        <p className="text-[10px] text-slate-500 text-center leading-relaxed mt-6">
          Your attendance data is written securely. This portal validates tokens automatically against the ActiveDeck session.
        </p>
      </div>
    </div>
  );
};
