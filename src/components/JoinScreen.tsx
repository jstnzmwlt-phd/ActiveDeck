import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, query, collection, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { KeyRound, Loader2, AlertCircle, Download, FileText, X, CheckCircle2, ArrowRight } from 'lucide-react';
import { exportNotesToDocx, isNotesEmpty } from '../utils/exportNotesDocx';

export const JoinScreen: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isSessionEnded = urlParams.get('session_ended') === 'true';

  const [pinInput, setPinInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorErrorMsg] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Previous Session Notes Recovery States
  const [lastSessionId, setLastSessionId] = useState<string | null>(() => {
    const direct = localStorage.getItem('activeDeckLastSessionId');
    if (direct) return direct;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('activeDeckNotes_')) {
        const id = key.replace('activeDeckNotes_', '');
        if (id) return id;
      }
    }
    return null;
  });

  const [lastSessionPin, setLastSessionPin] = useState<string>(() => localStorage.getItem('activeDeckLastSessionPin') || '');
  const [lastPresenterEmail, setLastPresenterEmail] = useState<string>(() => localStorage.getItem('activeDeckLastPresenterEmail') || '');
  const [hasPreviousNotes, setHasPreviousNotes] = useState<boolean>(false);
  const [showPreviousNotesModal, setShowPreviousNotesModal] = useState<boolean>(() => isSessionEnded);
  const [isDownloadingPreviousNotes, setIsDownloadingPreviousNotes] = useState<boolean>(false);
  const [previousNotesDownloaded, setPreviousNotesDownloaded] = useState<boolean>(false);

  useEffect(() => {
    let targetSessionId = lastSessionId;
    if (!targetSessionId) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('activeDeckNotes_')) {
          const id = key.replace('activeDeckNotes_', '');
          if (id) {
            targetSessionId = id;
            setLastSessionId(id);
            break;
          }
        }
      }
    }

    if (!targetSessionId) {
      setHasPreviousNotes(false);
      if (isSessionEnded) {
        setShowPreviousNotesModal(true);
      }
      return;
    }

    const savedNotes = localStorage.getItem(`activeDeckNotes_${targetSessionId}`);
    const savedDrawings = localStorage.getItem(`activeDeckDrawings_${targetSessionId}`);
    const savedSlides = localStorage.getItem(`activeDeckPushedSlides_${targetSessionId}`);
    const savedStudentDrawings = localStorage.getItem(`activeDeckStudentSlideDrawings_${targetSessionId}`);

    let notesTextMap: Record<string, string> = {};
    if (savedNotes) {
      try {
        const parsed = JSON.parse(savedNotes);
        notesTextMap = typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { '1': savedNotes };
      } catch {
        notesTextMap = { '1': savedNotes };
      }
    }

    let notesDrawingsMap: Record<string, string> = {};
    if (savedDrawings) {
      try {
        notesDrawingsMap = JSON.parse(savedDrawings);
      } catch {}
    }

    let pushedSlidesMap: Record<string, string> = {};
    if (savedSlides) {
      try {
        pushedSlidesMap = JSON.parse(savedSlides);
      } catch {}
    }

    let studentDrawingsMap: Record<string, string> = {};
    if (savedStudentDrawings) {
      try {
        studentDrawingsMap = JSON.parse(savedStudentDrawings);
      } catch {}
    }

    const notesExist = !isNotesEmpty(notesTextMap, notesDrawingsMap, pushedSlidesMap, studentDrawingsMap);
    setHasPreviousNotes(notesExist);

    // If redirected from ended session or notes exist, display the recovery modal
    if (notesExist || isSessionEnded) {
      setShowPreviousNotesModal(true);
    }
  }, [lastSessionId, isSessionEnded]);

  const handleDownloadPreviousNotes = async () => {
    let idToExport = lastSessionId;
    if (!idToExport) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('activeDeckNotes_')) {
          idToExport = key.replace('activeDeckNotes_', '');
          break;
        }
      }
    }

    if (!idToExport) {
      alert("No previous session notes found on this device.");
      return;
    }

    setIsDownloadingPreviousNotes(true);
    try {
      const success = await exportNotesToDocx({
        presentationId: idToExport,
        pinCode: lastSessionPin || undefined,
        presenterEmail: lastPresenterEmail || undefined
      });
      if (success) {
        setPreviousNotesDownloaded(true);
        setTimeout(() => {
          setPreviousNotesDownloaded(false);
        }, 4000);
      } else {
        alert("No saved notes were found from the previous session to download.");
      }
    } catch (err) {
      console.error("Failed to export previous notes:", err);
      alert("Failed to export notes document.");
    } finally {
      setIsDownloadingPreviousNotes(false);
    }
  };

  const handleContinueToNewSession = () => {
    setShowPreviousNotesModal(false);
    setTimeout(() => {
      pinInputRef.current?.focus();
    }, 150);
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const getFormattedPin = (raw: string) => {
    if (raw.length > 3) {
      return `${raw.slice(0, 3)} ${raw.slice(3)}`;
    }
    return raw;
  };

  const handleSubmit = async (pinCode: string) => {
    if (pinCode.length !== 6) return;
    
    setIsValidating(true);
    setErrorErrorMsg(null);
    
    try {
      let presentationId: string | null = null;
      
      // Step 1: Try finding the PIN in the `sessionPins` collection
      try {
        const pinRef = doc(db, 'sessionPins', pinCode);
        const pinSnap = await getDoc(pinRef);
        
        if (pinSnap.exists() && pinSnap.data().active) {
          presentationId = pinSnap.data().presentationId;
        }
      } catch (err) {
        console.warn('Error reading from sessionPins, attempting direct presentations lookup fallback...', err);
      }
      
      // Step 2: Fallback to direct query on the `presentations` collection
      if (!presentationId) {
        try {
          const q = query(collection(db, 'presentations'), where('pinCode', '==', pinCode), limit(1));
          const querySnap = await getDocs(q);
          if (!querySnap.empty) {
            const data = querySnap.docs[0].data();
            if (data.active !== false && !data.isEnded) {
              presentationId = querySnap.docs[0].id;
              console.log('Fallback direct lookup successful. Found active presentation ID:', presentationId);
            }
          }
        } catch (fallbackErr) {
          console.error('Fallback presentations query failed:', fallbackErr);
        }
      }
      
      if (presentationId) {
        localStorage.setItem('activeDeckLastSessionId', presentationId);
        localStorage.setItem('activeDeckLastSessionPin', pinCode);
        // Redirect to the chat room for this presentation
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('id', presentationId);
        newUrl.searchParams.set('view', 'chat');
        window.location.href = newUrl.toString();
      } else {
        triggerShake();
        setErrorErrorMsg('Invalid or expired Session Code. Please try again.');
        setPinInput('');
        setIsValidating(false);
      }
    } catch (err: any) {
      console.error('Error verifying PIN:', err);
      triggerShake();
      setErrorErrorMsg('Connection failed. Please check your internet and try again.');
      setPinInput('');
      setIsValidating(false);
    }
  };

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isValidating) return;
    const val = e.target.value.replace(/\D/g, '').slice(0, 6); // Only allow up to 6 digits
    setPinInput(val);
    
    if (val.length === 6) {
      handleSubmit(val);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-6 relative overflow-hidden">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-osu-orange/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] bg-slate-900/20 blur-[100px] rounded-full pointer-events-none" />

      {/* Previous Session Notes Recovery Modal */}
      {showPreviousNotesModal && (hasPreviousNotes || isSessionEnded) && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-orange-500/10 text-center space-y-5 relative animate-in zoom-in-95 duration-200">
            <button
              type="button"
              onClick={() => setShowPreviousNotesModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 bg-osu-orange/10 border border-osu-orange/20 text-osu-orange rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-500/10">
              <FileText className="w-7 h-7 text-osu-orange" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black uppercase tracking-wide text-white">Previous Session Ended</h2>
              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                Your previous session {lastSessionPin ? <span className="font-mono font-bold text-osu-orange">(Code: {lastSessionPin})</span> : ''} has ended. Would you like to download your notes (.docx) before joining the new session?
              </p>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleDownloadPreviousNotes}
                disabled={isDownloadingPreviousNotes}
                className="w-full h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                {isDownloadingPreviousNotes ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Document...</span>
                  </>
                ) : previousNotesDownloaded ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-300" />
                    <span>Notes Downloaded (.docx)!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Previous Notes (.docx)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleContinueToNewSession}
                className="w-full h-11 border border-slate-700 hover:border-slate-600 bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Continue to Join New Session</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Code Card with Shake Micro-animation support */}
      <div 
        className={`max-w-md w-full bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-orange-500/5 text-center space-y-6 select-none relative z-10 ${
          isShaking ? 'animate-[shake_0.5s_ease-in-out]' : ''
        }`}
      >
        {/* Animated Icon Top Header */}
        <div className="w-16 h-16 bg-osu-orange/10 border border-osu-orange/20 text-osu-orange rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-500/10">
          <KeyRound className={`w-8 h-8 ${isValidating ? 'animate-pulse text-osu-orange' : ''}`} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black uppercase tracking-wide text-white">Join ActiveDeck Session</h1>
          <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
            Please enter the 6-digit session code displayed on the screen or provided by your presenter.
          </p>
        </div>

        {/* Dedicated Session Ended Notification Banner with Download & Continue Options */}
        {isSessionEnded && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs text-left space-y-3 animate-in fade-in-50 duration-200 max-w-[300px] mx-auto">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white text-xs">Previous Session Ended</p>
                <p className="text-[11px] text-amber-200/90 leading-relaxed mt-0.5">
                  Download notes from your previous session or enter the new code to join.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadPreviousNotes}
                disabled={isDownloadingPreviousNotes}
                className="w-full py-2 px-3 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 text-white text-[11px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
              >
                {isDownloadingPreviousNotes ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Exporting...</span>
                  </>
                ) : previousNotesDownloaded ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-300" />
                    <span>Notes Downloaded!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Notes (.docx)</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleContinueToNewSession}
                className="w-full py-1.5 px-3 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-[11px] font-medium rounded-xl border border-white/10 transition-colors flex items-center justify-center cursor-pointer"
              >
                Enter New Session Code
              </button>
            </div>
          </div>
        )}

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(pinInput);
          }} 
          className="space-y-4 pt-1"
        >
          <div className="space-y-2 text-left relative">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 text-center mb-1">
              Enter 6-Digit Code
            </label>
            <div className="relative max-w-[280px] mx-auto">
              <input 
                ref={pinInputRef}
                type="text" 
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={7}
                value={getFormattedPin(pinInput)}
                onChange={handlePinChange}
                disabled={isValidating}
                placeholder="000 000"
                className="w-full text-center text-3xl font-black font-mono tracking-[0.25em] h-14 rounded-2xl bg-slate-950 border border-slate-800 text-white placeholder-slate-800 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-all uppercase disabled:opacity-50"
                autoFocus
              />
            </div>
          </div>
          
          {errorMsg && !isSessionEnded && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs text-left animate-in fade-in-50 duration-200 max-w-[280px] mx-auto">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed opacity-95 font-medium">{errorMsg}</p>
            </div>
          )}

          <button 
            type="submit"
            disabled={isValidating || pinInput.length !== 6}
            className="w-full max-w-[280px] mx-auto h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Code...</span>
              </>
            ) : (
              'Join Session'
            )}
          </button>
        </form>

        {/* Previous Notes Download Quick Link */}
        {(hasPreviousNotes || !!lastSessionId) && !isSessionEnded && (
          <div className="pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleDownloadPreviousNotes}
              disabled={isDownloadingPreviousNotes}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-[11px] font-bold transition-all cursor-pointer"
            >
              {isDownloadingPreviousNotes ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-osu-orange" />
                  <span>Exporting notes...</span>
                </>
              ) : previousNotesDownloaded ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-green-300">Notes Downloaded (.docx)</span>
                </>
              ) : (
                <>
                  <Download className="w-3 h-3 text-osu-orange" />
                  <span>Download Previous Session Notes {lastSessionPin ? `(#${lastSessionPin})` : ''}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Styled Brand Tagline */}
      <footer className="mt-8 text-[10px] font-black tracking-widest text-slate-600 uppercase select-none relative z-10">
        ActiveDeck &copy; {new Date().getFullYear()}
      </footer>

      {/* Keyframes inject for shake animation if not available in general index.css */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
};
