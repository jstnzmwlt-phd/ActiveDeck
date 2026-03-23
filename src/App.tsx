import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { LogIn, Presentation as PresentationIcon, Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';

function AppContent() {
  const { user, loading, signInWithGoogle } = useAuth();
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  // Check for view parameter
  const urlParams = new URLSearchParams(window.location.search);
  const isChatOnly = urlParams.get('view') === 'chat';
  const presentationId = urlParams.get('id');

  useEffect(() => {
    if (loading) return;

    let unsubscribe: () => void;

    const loadPresentation = async () => {
      if (presentationId) {
        // Listen to specific presentation
        const docRef = doc(db, 'presentations', presentationId);
        unsubscribe = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            setPresentation({ id: docSnap.id, ...docSnap.data() } as Presentation);
          }
        }, (error) => {
          console.error("Presentation snapshot error:", error);
        });
      } else if (!isChatOnly && user) {
        // Presenter creating a new session
        try {
          const docRef = await addDoc(collection(db, 'presentations'), {
            presenterId: user.uid,
            embedUrl: '',
            createdAt: serverTimestamp()
          });
          
          // Update URL with the new ID without reloading the page
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('id', docRef.id);
          window.history.replaceState({}, '', newUrl.toString());
          
          unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
              setPresentation({ id: docSnap.id, ...docSnap.data() } as Presentation);
            }
          });
        } catch (error) {
          console.error("Error creating presentation:", error);
        }
      }
    };

    loadPresentation();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [loading, user, presentationId, isChatOnly]);

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
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-slate-100 font-sans antialiased">
      <Header />
      
      <div className="flex flex-row flex-1 overflow-hidden">
        {/* Presenter View (Flexible, but takes most space) */}
        <div className="flex-1 h-full min-w-0">
          <PresenterArea presentation={presentation} />
        </div>

        {/* Audience Chat (Fixed width sidebar) */}
        <div className="w-[350px] h-full flex-shrink-0">
          <ChatSidebar presentation={presentation} />
        </div>
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
