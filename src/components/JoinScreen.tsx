import React, { useState } from 'react';
import { doc, getDoc, query, collection, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { KeyRound, Loader2, AlertCircle } from 'lucide-react';

export const JoinScreen: React.FC = () => {
  const [pinInput, setPinInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorErrorMsg] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

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
            presentationId = querySnap.docs[0].id;
            console.log('Fallback direct lookup successful. Found presentation ID:', presentationId);
          }
        } catch (fallbackErr) {
          console.error('Fallback presentations query failed:', fallbackErr);
        }
      }
      
      if (presentationId) {
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

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(pinInput);
          }} 
          className="space-y-4 pt-2"
        >
          <div className="space-y-2 text-left relative">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 text-center mb-1">
              Enter 6-Digit Code
            </label>
            <div className="relative max-w-[280px] mx-auto">
              <input 
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
          
          {errorMsg && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs text-left animate-in fade-in-50 duration-200 max-w-[280px] mx-auto">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed opacity-95 font-medium">{errorMsg}</p>
            </div>
          )}

          <button 
            type="submit"
            disabled={isValidating || pinInput.length !== 6}
            className="w-full max-w-[280px] mx-auto h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-2"
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
      </div>

      {/* Styled Brand Tagline */}
      <footer className="mt-8 text-[10px] font-black tracking-widest text-slate-600 uppercase select-none relative z-10 flex flex-col items-center gap-2">
        <span>ActiveDeck &copy; {new Date().getFullYear()}</span>
        <span 
          onClick={() => {
            sessionStorage.setItem('presenterMode', 'true');
            window.location.href = '/?mode=presenter';
          }}
          className="text-[9px] text-slate-500 hover:text-osu-orange transition-colors duration-200 cursor-pointer mt-1 font-bold border border-slate-800 hover:border-osu-orange/30 px-2.5 py-1 rounded-lg bg-slate-900/40"
        >
          Host Login
        </span>
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
