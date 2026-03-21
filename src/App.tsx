import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Presentation } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { LogIn, Presentation as PresentationIcon, Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';

function AppContent() {
  const { user, loading, signInWithGoogle } = useAuth();
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  // Check for view parameter
  const urlParams = new URLSearchParams(window.location.search);
  const isChatOnly = urlParams.get('view') === 'chat';

  useEffect(() => {
    // Listen for the latest presentation
    const q = query(
      collection(db, 'presentations'), 
      orderBy('createdAt', 'desc'), 
      limit(1)
    );
    
  const unsubscribe = onSnapshot(q, (snapshot) => {
    console.log('AppContent - Presentation Snapshot:', snapshot.empty ? 'Empty' : 'Found');
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      console.log('AppContent - Presentation Data:', data.presenterId);
      setPresentation({ id: doc.id, ...data } as Presentation);
    }
  }, (error) => {
    console.error("Presentation snapshot error:", error);
  });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <Loader2 className="w-12 h-12 text-osu-orange animate-spin mb-4" />
        <p className="text-sm font-black uppercase tracking-[0.3em] opacity-50">Initializing ActiveDeck</p>
      </div>
    );
  }

  // Chat-only view for audience members who scanned the QR code
  if (isChatOnly) {
    return (
      <div className="h-[100dvh] w-screen bg-white font-sans antialiased overflow-hidden">
        <ChatSidebar isChatOnly={true} presentation={presentation} />
      </div>
    );
  }

  return (
    <div className="flex flex-row h-[100dvh] w-screen overflow-hidden bg-slate-100 font-sans antialiased">
      {/* Presenter View (Flexible, but takes most space) */}
      <div className="flex-1 h-full min-w-0">
        <PresenterArea presentation={presentation} />
      </div>

      {/* Audience Chat (Fixed width sidebar) */}
      <div className="w-[350px] h-full flex-shrink-0">
        <ChatSidebar presentation={presentation} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
