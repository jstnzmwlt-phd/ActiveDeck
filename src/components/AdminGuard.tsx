import React, { useState } from 'react';
import { ShieldAlert, KeyRound, Loader2, ArrowLeft } from 'lucide-react';
import { AdminPortal } from './AdminPortal';

interface AdminGuardProps {
  presentationId?: string | null;
  currentEmail?: string | null;
}

export const AdminGuard: React.FC<AdminGuardProps> = ({ presentationId, currentEmail }) => {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem('activeDeckAdminUnlocked') === 'true';
  });
  const [email, setEmail] = useState(() => {
    return (
      currentEmail ||
      sessionStorage.getItem('activePresenterEmail') ||
      localStorage.getItem('activeDeckLastPresenterEmail') ||
      'justin.zumwalt@okstate.edu'
    );
  });
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isUnlocked) {
    return <AdminPortal presentationId={presentationId} />;
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter the Admin Security PIN.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/verify-admin-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pin: pin.trim() })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.success) {
        sessionStorage.setItem('activeDeckAdminUnlocked', 'true');
        setIsUnlocked(true);
      } else {
        setError(data?.error || 'Verification failed. Incorrect PIN or unauthorized email.');
      }
    } catch (err: any) {
      console.error('Error verifying admin pin:', err);
      // Fallback for local client development without API server running
      if (email.trim().toLowerCase() === 'justin.zumwalt@okstate.edu' && pin.trim() === '1286') {
        sessionStorage.setItem('activeDeckAdminUnlocked', 'true');
        setIsUnlocked(true);
      } else {
        setError('Network error verifying admin access. Please check server connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBackToPresentation = () => {
    window.location.hash = '';
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-slate-950 text-white p-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-500 mx-auto mb-6">
          <ShieldAlert className="w-7 h-7 text-orange-500" />
        </div>

        <h2 className="text-xl font-black text-center uppercase tracking-wider mb-2 text-white">
          ActiveDeck Admin Access
        </h2>
        <p className="text-xs text-slate-400 text-center mb-6 leading-relaxed">
          The Admin Portal is restricted to authorized administrators. Please verify your credentials to continue.
        </p>

        {error && (
          <div className="mb-6 p-3.5 bg-red-950/60 border border-red-500/40 rounded-xl text-red-200 text-xs font-medium text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Admin Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="justin.zumwalt@okstate.edu"
              required
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Admin Security PIN
            </label>
            <div className="relative">
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                required
                autoFocus
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute right-3.5 top-3.5 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <span>Unlock Admin Portal</span>
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={handleBackToPresentation}
          className="w-full mt-4 py-2.5 text-slate-400 hover:text-white text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Presentation</span>
        </button>
      </div>
    </div>
  );
};
