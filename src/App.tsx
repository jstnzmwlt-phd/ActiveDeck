import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation, GlobalSettings } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { Presentation as PresentationIcon, Loader2, AlertCircle } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BridgeProvider } from './contexts/BridgeContext';
import { AdminPortal } from './components/AdminPortal';

console.log('App.tsx - Module loaded');

// Global error handler for debugging
window.onerror = (msg, url, lineNo, columnNo, error) => {
  console.error('Global Error:', msg, 'at', url, ':', lineNo, ':', columnNo, error);
  return false;
};

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => {
      console.log('AppContent - Hash changed to:', window.location.hash);
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Global error handler update to show on screen
  useEffect(() => {
    const handleError = (msg: any, url: any, line: any, col: any, error: any) => {
      setAppError(`Error: ${msg}\nAt: ${url}:${line}:${col}`);
      return false;
    };
    window.onerror = handleError;
    return () => { window.onerror = null; };
  }, []);

  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
        if (docSnap.exists()) {
           const settingsData = docSnap.data() as GlobalSettings;
           setSettings(settingsData);
           document.documentElement.style.setProperty('--color-osu-orange', settingsData.theme.primaryColor);
           document.documentElement.style.setProperty('--color-osu-black', settingsData.theme.secondaryColor);
        }
    });
    return () => unsub();
  }, []);

  // Check for view parameter
  const urlParams = new URLSearchParams(window.location.search);
  const isChatOnly = urlParams.get('view') === 'chat';
  const presentationId = urlParams.get('id');

  console.log('AppContent Render - AuthLoading:', authLoading, 'User:', user?.uid, 'PresentationId:', presentationId, 'isChatOnly:', isChatOnly);

  useEffect(() => {
    // Hide static loader once React mounts
    const loader = document.getElementById('static-loader');
    if (loader) {
      console.log('AppContent - Hiding static loader');
      loader.style.display = 'none';
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      console.log('AppContent - Still loading auth...');
      return;
    }

    let unsubscribe: () => void;

    const loadPresentation = async () => {
      if (presentationId) {
        console.log('AppContent - Loading existing presentation:', presentationId);
        // Listen to specific presentation
        const docRef = doc(db, 'presentations', presentationId);
        unsubscribe = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            console.log('AppContent - Presentation data received:', docSnap.id);
            setPresentation({ id: docSnap.id, ...docSnap.data() } as Presentation);
          } else {
            console.warn('AppContent - Presentation not found:', presentationId);
          }
        }, (error) => {
          console.error("AppContent - Presentation snapshot error:", error);
        });
      } else if (!isChatOnly && user) {
        console.log('AppContent - Creating new presentation for user:', user.uid);
        // Presenter creating a new session
        try {
          const docRef = await addDoc(collection(db, 'presentations'), {
            presenterId: user.uid,
            embedUrl: '',
            createdAt: serverTimestamp(),
            allowAnonymousChat: false,
            hideComments: false
          });
          
          console.log('AppContent - New presentation created:', docRef.id);
          
          // Update URL with the new ID without reloading the page
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('id', docRef.id);
          window.history.replaceState({}, '', newUrl.toString());
          
          unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              console.log('AppContent - New presentation snapshot received:', docSnap.id, data);
              setPresentation({ id: docSnap.id, ...data } as Presentation);
            }
          }, (error) => {
            console.error("AppContent - New presentation snapshot error:", error);
          });
        } catch (error) {
          console.error("AppContent - Error creating presentation:", error);
        }
      } else {
        console.log('AppContent - No presentation ID and not a presenter/chat-only');
      }
    };

    loadPresentation();

    return () => {
      if (unsubscribe) {
        console.log('AppContent - Unsubscribing from presentation');
        unsubscribe();
      }
    };
  }, [authLoading, user, presentationId, isChatOnly]);

  const isLoading = authLoading;

  if (appError) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-900 text-white p-8 text-center">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h1 className="text-xl font-bold mb-2">Application Error</h1>
        <pre className="text-xs bg-black/30 p-4 rounded-lg mb-6 max-w-full overflow-auto whitespace-pre-wrap">
          {appError}
        </pre>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-white text-red-900 font-bold rounded-full"
        >
          Reload Application
        </button>
      </div>
    );
  }

  if (isLoading) {
    console.log('AppContent - Rendering Loading State. Auth:', authLoading);
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <Loader2 className="w-12 h-12 text-osu-orange animate-spin mb-4" />
        <p className="text-sm font-black uppercase tracking-[0.3em] opacity-50">Initializing ActiveDeck</p>
      </div>
    );
  }

  if (hash === '#admin') {
    return <AdminPortal />;
  }

  console.log('AppContent - Rendering Main State. isChatOnly:', isChatOnly);

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
      
      <div className="flex flex-row flex-1 p-6 gap-6 bg-slate-100">
        {/* Presenter View (Flexible, but takes most space) */}
        <div className="flex-1 h-full min-w-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border border-slate-300 bg-black">
          <PresenterArea presentation={presentation} logoUrl={settings?.theme.logoUrl} />
        </div>

        {/* Audience Chat (Fixed width sidebar) */}
        <div className="w-[350px] h-full flex-shrink-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border-2 border-osu-orange bg-white">
          <ChatSidebar presentation={presentation} logoUrl={settings?.theme.logoUrl} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BridgeProvider>
          <AppContent />
        </BridgeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
