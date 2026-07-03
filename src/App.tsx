import React, { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation, GlobalSettings } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp, updateDoc, getDoc, setDoc, increment } from 'firebase/firestore';
import { Presentation as PresentationIcon, Loader2, AlertCircle } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BridgeProvider } from './contexts/BridgeContext';
import { AdminPortal } from './components/AdminPortal';
import { StudentAttendance } from './components/StudentAttendance';
import { JoinScreen } from './components/JoinScreen';

console.log('App.tsx - Module loaded');

// Global error handler for debugging
window.onerror = (msg, url, lineNo, columnNo, error) => {
  console.error('Global Error:', msg, 'at', url, ':', lineNo, ':', columnNo, error);
  return false;
};

const generateUniquePin = async (): Promise<string> => {
  let isUnique = false;
  let pin = '';
  let attempts = 0;
  while (!isUnique && attempts < 5) {
    attempts++;
    pin = Math.floor(100000 + Math.random() * 900000).toString();
    try {
      const pinRef = doc(db, 'sessionPins', pin);
      const pinSnap = await getDoc(pinRef);
      if (!pinSnap.exists()) {
        isUnique = true;
      }
    } catch (err) {
      console.warn('Failed to verify PIN uniqueness against Firestore, falling back to pure random PIN:', err);
      isUnique = true; // Fallback to avoid infinite loop on permission errors
    }
  }
  return pin;
};

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [presentationLoaded, setPresentationLoaded] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [hash, setHash] = useState(window.location.hash);
  const activeUnsubscribeRef = useRef<(() => void) | null>(null);

  // Initialize and capture the active presentation ID state
  const [activePresentationId, setActivePresentationId] = useState<string | null>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isChatOnly = urlParams.get('view') === 'chat';

    // 1. Check for URL-based explicit new session parameter (highly robust across all browsers/frames)
    const isNewSessionParam = urlParams.get('new_session') === 'true';
    if (isNewSessionParam) {
      console.log('AppContent - URL-based new_session parameter detected. Resetting all cached session IDs.');
      sessionStorage.removeItem('activePresenterPresentationId');
      sessionStorage.removeItem('activeDeckForceNewSession');
      urlParams.delete('new_session');
      urlParams.delete('id');
      if (window.history && typeof window.history.replaceState === 'function') {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('new_session');
        cleanUrl.searchParams.delete('id');
        window.history.replaceState({}, '', cleanUrl.toString());
      }
      return null;
    }

    if (!isChatOnly) {
      const urlId = urlParams.get('id');
      if (urlId) {
        console.log('AppContent - Capturing URL presentation ID and stripping from URL:', urlId);
        sessionStorage.setItem('activePresenterPresentationId', urlId);
        urlParams.delete('id');
        if (window.history && typeof window.history.replaceState === 'function') {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('id');
          window.history.replaceState({}, '', cleanUrl.toString());
        }
      }
    }

    const isForceNewSession = sessionStorage.getItem('activeDeckForceNewSession') === 'true';
    if (isForceNewSession) {
      sessionStorage.removeItem('activeDeckForceNewSession');
      sessionStorage.removeItem('activePresenterPresentationId');
      urlParams.delete('id');
      if (window.history && typeof window.history.replaceState === 'function') {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('id');
        window.history.replaceState({}, '', cleanUrl.toString());
      }
    }

    return isChatOnly 
      ? urlParams.get('id') 
      : (sessionStorage.getItem('activePresenterPresentationId') || urlParams.get('id'));
  });

  const createNewPresentation = async () => {
    console.log('AppContent - Creating new presentation for user:', user?.uid);
    if (!user) return '';
    try {
      const pinCode = await generateUniquePin();
      const docRef = await addDoc(collection(db, 'presentations'), {
        presenterId: user.uid,
        embedUrl: '',
        createdAt: serverTimestamp(),
        allowAnonymousChat: false,
        disableAttendance: true,
        hideComments: false,
        presenterEmail: sessionStorage.getItem('activePresenterEmail') || '',
        pinCode: pinCode,
        hasActivity: false
      });
      
      try {
        await setDoc(doc(db, 'sessionPins', pinCode), {
          presentationId: docRef.id,
          createdAt: serverTimestamp(),
          active: true
        });
      } catch (err) {
        console.error('Failed to register PIN in sessionPins during creation:', err);
      }
      
      console.log('AppContent - New presentation created:', docRef.id, 'with PIN:', pinCode);
      sessionStorage.setItem('activePresenterPresentationId', docRef.id);
      
      return docRef.id;
    } catch (error) {
      console.error("AppContent - Error creating presentation:", error);
      throw error;
    }
  };

  const handleStartNewSession = async () => {
    console.log('AppContent - Starting new presentation session strictly in-memory (preserving WebRTC capture and active screen share)...');
    
    // 1. Unsubscribe from any active snapshot listener to avoid memory leaks or stale updates
    if (activeUnsubscribeRef.current) {
      console.log('AppContent - Unsubscribing from current presentation listener');
      activeUnsubscribeRef.current();
      activeUnsubscribeRef.current = null;
    }

    // 2. Deactivate the old presentation PIN code so students can no longer join it
    if (presentation && presentation.pinCode) {
      try {
        await updateDoc(doc(db, 'sessionPins', presentation.pinCode), {
          active: false,
          deactivatedAt: serverTimestamp()
        });
        console.log(`AppContent - Deactivated old PIN: ${presentation.pinCode}`);
      } catch (err) {
        console.error('AppContent - Failed to deactivate old PIN in sessionPins:', err);
      }
    }

    // 3. Clear the local React presentation state to reset UI while transitioning
    setPresentation(null);
    setPresentationLoaded(false);

    // 4. Create the brand-new presentation and PIN in Firestore synchronously
    try {
      const newId = await createNewPresentation();
      if (newId) {
        console.log('AppContent - New presentation created in-memory:', newId);
        // 5. Update the unified state to mount and subscribe to the new session
        setActivePresentationId(newId);
      } else {
        throw new Error('Created presentation ID was empty.');
      }
    } catch (err) {
      console.error('AppContent - Failed to start a new presentation session in-memory:', err);
      setAppError('Failed to start a new presentation session. Please try again.');
    }
  };

  const handleCreatePresentationForArea = async () => {
    const newId = await createNewPresentation();
    if (newId) {
      setActivePresentationId(newId);
    }
    return newId;
  };

  const [emailDomainError, setEmailDomainError] = useState<string | null>(null);
  const [checkingEmailDomain, setCheckingEmailDomain] = useState(false);
  const [presenterEmail, setPresenterEmail] = useState<string>(() => sessionStorage.getItem('activePresenterEmail') || '');

  const handleSavePresenterEmail = async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }

    setEmailDomainError(null);
    setCheckingEmailDomain(true);

    try {
      // Step 1: Check Whitelisted Presenters
      const presenterRef = doc(db, 'whitelistedPresenters', trimmed);
      const presenterSnap = await getDoc(presenterRef);
      if (!presenterSnap.exists()) {
        setEmailDomainError("Access Denied: Your email is not registered as an authorized presenter. Please contact justin.zumwalt@okstate.edu to be whitelisted.");
        setCheckingEmailDomain(false);
        return;
      }

      // Step 2: Auto-match institution domain (Optional - do not block if not found)
      const emailDomain = trimmed.split('@')[1];
      if (emailDomain) {
        try {
          const { getDocs } = await import('firebase/firestore');
          const themesSnap = await getDocs(collection(db, 'savedThemes'));
          const matchedInstDoc = themesSnap.docs.find(docSnap => {
            const domain = docSnap.data().domain;
            return domain && domain.trim().toLowerCase() === emailDomain;
          });

          if (matchedInstDoc) {
            const instData = matchedInstDoc.data();
            // Apply matching institution settings globally
            await updateDoc(doc(db, 'settings', 'global'), {
              theme: instData.theme,
              activeInstitutionId: matchedInstDoc.id,
              activeInstitutionName: instData.name,
              activeInstitutionDomain: instData.domain || ''
            });
            console.log(`Auto-loaded matching institution theme for domain ${emailDomain}: ${instData.name}`);
          }
        } catch (err) {
          console.error('Failed to auto-match presenter institution domain:', err);
        }
      }

      // Step 3: Increment usage stats
      await updateDoc(presenterRef, {
        usageCount: increment(1),
        lastUsedAt: serverTimestamp()
      });

    } catch (err: any) {
      console.error('Error verifying whitelisted presenter:', err);
      alert('An error occurred while verifying your presenter account. Please try again.');
      setCheckingEmailDomain(false);
      return;
    }

    sessionStorage.setItem('activePresenterEmail', trimmed);
    setPresenterEmail(trimmed);
    setCheckingEmailDomain(false);

    if (presentation?.id) {
      try {
        await updateDoc(doc(db, 'presentations', presentation.id), {
          presenterEmail: trimmed
        });
      } catch (err) {
        console.error('Failed to update presenter email in presentation document:', err);
      }
    }
  };

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

  const pathname = window.location.pathname;
  
  // Smart routing to handle students forgetting "/chat" in the URL and landing on root "/"
  const isJoinRoute = 
    ((pathname === '/chat' || pathname === '/chat/') && !activePresentationId);

  console.log('AppContent Render - AuthLoading:', authLoading, 'User:', user?.uid, 'ActivePresentationId:', activePresentationId, 'isChatOnly:', isChatOnly, 'isJoinRoute:', isJoinRoute, 'presenterEmail:', presenterEmail);

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

    const loadPresentation = async () => {
      const ensurePresentationHasPin = async (presId: string, data: any) => {
        if (!data.pinCode && !isChatOnly && user) {
          try {
            const newPin = await generateUniquePin();
            await updateDoc(doc(db, 'presentations', presId), { pinCode: newPin });
            try {
              await setDoc(doc(db, 'sessionPins', newPin), {
                presentationId: presId,
                createdAt: serverTimestamp(),
                active: true
              });
              console.log(`v1.1 Migration: Generated PIN ${newPin} in sessionPins for presentation ${presId}`);
            } catch (err) {
              console.error('Failed to register PIN in sessionPins during migration:', err);
            }
          } catch (err) {
            console.error('Error generating and saving PIN for existing presentation:', err);
          }
        }
      };

      // Determine if we should load the presentation ID from the URL (students/chat-only only)
      let shouldLoadUrlId = false;
      if (isChatOnly && activePresentationId) {
        shouldLoadUrlId = true;
      }

      if (shouldLoadUrlId && activePresentationId) {
        console.log('AppContent - Loading existing presentation from URL ID:', activePresentationId);
        
        // Listen to specific presentation
        const docRef = doc(db, 'presentations', activePresentationId);
        const unsub = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            console.log('AppContent - Presentation data received:', docSnap.id);
            const data = docSnap.data();
            setPresentation({ id: docSnap.id, ...data } as Presentation);
            ensurePresentationHasPin(docSnap.id, data);
            const localEmail = sessionStorage.getItem('activePresenterEmail');
            if (localEmail && !data.presenterEmail) {
              updateDoc(docRef, { presenterEmail: localEmail }).catch(err => 
                console.error('Failed to sync local email to loaded presentation:', err)
              );
            }
          } else {
            console.warn('AppContent - Presentation not found:', activePresentationId);
            setPresentation(null);
          }
          setPresentationLoaded(true);
        }, (error) => {
          console.error("AppContent - Presentation snapshot error:", error);
          setPresentationLoaded(true);
        });
        activeUnsubscribeRef.current = unsub;
      } else if (!isChatOnly && user && !isJoinRoute) {
        if (activePresentationId) {
          console.log('AppContent - Found active presentation ID:', activePresentationId);
          const docRef = doc(db, 'presentations', activePresentationId);
          const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
              console.log('AppContent - Cached presentation exists in Firestore. Setting active:', docSnap.id);
              const data = docSnap.data();
              setPresentation({ id: docSnap.id, ...data } as Presentation);
              ensurePresentationHasPin(docSnap.id, data);
              const localEmail = sessionStorage.getItem('activePresenterEmail');
              if (localEmail && !data.presenterEmail) {
                updateDoc(docRef, { presenterEmail: localEmail }).catch(err => 
                  console.error('Failed to sync local email to cached presentation:', err)
                );
              }
            } else {
              console.warn('AppContent - Cached presentation does not exist in Firestore. Cleaning cache.');
              sessionStorage.removeItem('activePresenterPresentationId');
              setActivePresentationId(null);
              setPresentation(null);
            }
            setPresentationLoaded(true);
          }, (error) => {
            console.error("AppContent - Cached presentation snapshot error:", error);
            // If it's a permission or load error, clean up and fallback
            sessionStorage.removeItem('activePresenterPresentationId');
            setActivePresentationId(null);
            setPresentation(null);
            setPresentationLoaded(true);
          });
          activeUnsubscribeRef.current = unsub;
        } else if (presenterEmail) {
          // No active presentation, but presenter is logged in! Auto-create a session.
          console.log('AppContent - No cached presentation, but presenter is logged in. Auto-creating session...');
          try {
            const newId = await createNewPresentation();
            if (newId) {
              setActivePresentationId(newId);
            }
          } catch (err) {
            console.error('AppContent - Failed to auto-create presentation:', err);
            setPresentationLoaded(true);
          }
        } else {
          setPresentationLoaded(true);
        }
      } else {
        console.log('AppContent - No presentation ID and not a presenter/chat-only');
        setPresentationLoaded(true);
      }
    };

    loadPresentation();

    return () => {
      if (activeUnsubscribeRef.current) {
        console.log('AppContent - Unsubscribing from presentation');
        activeUnsubscribeRef.current();
        activeUnsubscribeRef.current = null;
      }
    };
  }, [authLoading, user, activePresentationId, isChatOnly, isJoinRoute, presenterEmail]);

  const isLoading = authLoading;

  if (appError) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-red-900 text-white p-8 text-center">
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
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-900 text-white">
        <Loader2 className="w-12 h-12 text-osu-orange animate-spin mb-4" />
        <p className="text-sm font-black uppercase tracking-[0.3em] opacity-50">Initializing ActiveDeck</p>
      </div>
    );
  }

  if (hash === '#admin') {
    return <AdminPortal presentationId={activePresentationId} />;
  }

  // Handle SPA path routing for Student Attendance
  const attendanceMatch = pathname.match(/^\/attendance\/([^\/]+)/);
  if (attendanceMatch) {
    const attendancePresentationId = attendanceMatch[1];
    const attendanceToken = urlParams.get('token');
    return (
      <StudentAttendance 
        presentationId={attendancePresentationId} 
        token={attendanceToken} 
      />
    );
  }

  // Check if we should render student Join Screen
  if (isJoinRoute) {
    return <JoinScreen />;
  }

  // Ask for presenter's email before letting them proceed to the presenter screen
  if (!isChatOnly && !presenterEmail) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-orange-500/5 text-center space-y-6 animate-in zoom-in-95 duration-200">
          <div className="w-16 h-16 bg-osu-orange/10 border border-osu-orange/20 text-osu-orange rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-500/10">
            <PresentationIcon className="w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-wide text-white">Welcome to ActiveDeck</h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
              Please enter your presenter email address. This will be used to generate your display name and log your sessions in the attendance registry.
            </p>
          </div>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const email = formData.get('email') as string;
              handleSavePresenterEmail(email);
            }} 
            className="space-y-4 pt-2"
          >
            <div className="space-y-1 text-left relative">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Presenter Email</label>
              <input 
                type="email" 
                name="email"
                required
                disabled={checkingEmailDomain}
                placeholder="e.g. name@institution.edu"
                className="w-full h-12 rounded-xl px-4 text-sm text-white bg-slate-950 border border-slate-800 focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent transition-all placeholder-slate-700 disabled:opacity-50"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.currentTarget.focus();
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                }}
                onKeyUp={(e) => {
                  e.stopPropagation();
                }}
              />
            </div>
            
            {emailDomainError && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs text-left animate-in fade-in-50 duration-200">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-red-400">Access Denied</p>
                  <p className="leading-relaxed opacity-90">{emailDomainError}</p>
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={checkingEmailDomain}
              className="w-full h-12 bg-osu-orange hover:bg-[#c03900] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {checkingEmailDomain ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Institution...</span>
                </>
              ) : (
                'Start Session'
              )}
            </button>
            <button 
              type="button"
              onClick={() => {
                sessionStorage.removeItem('presenterMode');
                window.location.href = '/chat';
              }}
              className="w-full h-11 border border-slate-800 hover:border-osu-orange/30 bg-slate-900/40 hover:bg-slate-900/80 text-slate-400 hover:text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              Looking for Chat? Join Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  console.log('AppContent - Rendering Main State. isChatOnly:', isChatOnly);

  // Chat-only view for audience members who scanned the QR code
  if (isChatOnly) {
    return (
      <div className="h-full w-full bg-white font-sans antialiased overflow-hidden">
        <ChatSidebar 
          isChatOnly={true} 
          presentation={presentation} 
          logoUrl={settings?.theme.logoUrl} 
          presentationLoaded={presentationLoaded} 
          showAttendance={settings?.showAttendance}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-100 font-sans antialiased">
      <Header 
        presentationId={presentation?.id || activePresentationId} 
        showAttendance={settings?.showAttendance}
        onNewSession={handleStartNewSession}
      />
      
      <div className="flex flex-row flex-1 p-6 pb-2 gap-6 bg-slate-100 min-h-0 overflow-hidden">
        {/* Presenter View (Flexible, but takes most space) */}
        <div className="flex-1 h-full min-w-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border border-slate-300 bg-black">
          <PresenterArea presentation={presentation} logoUrl={settings?.theme.logoUrl} onCreatePresentation={handleCreatePresentationForArea} />
        </div>

        {/* Audience Chat (Fixed width sidebar) */}
        <div className="w-[300px] h-full flex-shrink-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border-2 border-osu-orange bg-white">
          <ChatSidebar 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            presentationLoaded={presentationLoaded} 
            showAttendance={settings?.showAttendance}
          />
        </div>
      </div>

      <footer className="px-6 pb-3 pt-1 flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase select-none">
        <span>v1.1</span>
        <span className="opacity-65">ActiveDeck &copy; {new Date().getFullYear()}</span>
      </footer>
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
