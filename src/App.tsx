import React, { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation, GlobalSettings } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp, updateDoc, getDoc, setDoc, increment } from 'firebase/firestore';
import { Presentation as PresentationIcon, Loader2, AlertCircle, Maximize, Minimize, Lock } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BridgeProvider } from './contexts/BridgeContext';
import { AdminPortal } from './components/AdminPortal';
import { StudentAttendance } from './components/StudentAttendance';
import { JoinScreen } from './components/JoinScreen';
import { RichTextEditor } from './components/RichTextEditor';

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

const isNotesEmpty = (notesMap: Record<string, string>) => {
  if (!notesMap || Object.keys(notesMap).length === 0) return true;
  return Object.values(notesMap).every(html => {
    if (!html) return true;
    const cleanText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return cleanText === '';
  });
};

const htmlToPlainText = (html: string) => {
  let text = html;
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#039;/g, "'");
  return text.trim();
};

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [presentationLoaded, setPresentationLoaded] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [hash, setHash] = useState(window.location.hash);
  const [hasJoinedChat, setHasJoinedChat] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlPresId = urlParams.get('id');
    const savedPresId = localStorage.getItem('activeDeckJoinedPresentationId');
    const savedJoined = localStorage.getItem('activeDeckJoined') === 'true';
    if (urlPresId && savedPresId !== urlPresId) {
      return false;
    }
    return savedJoined;
  });
  const activeUnsubscribeRef = useRef<(() => void) | null>(null);

  // Initialize and capture the active presentation ID state
  const [activePresentationId, setActivePresentationId] = useState<string | null>(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isChatOnly = urlParams.get('view') === 'chat';
    const isProjector = urlParams.get('view') === 'projector';

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

    if (!isChatOnly && !isProjector) {
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

    return (isChatOnly || isProjector) 
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
    console.log('AppContent - Starting a brand-new presentation session with page-reload...');
    
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

    // 3. Clear local states
    setPresentation(null);
    setPresentationLoaded(false);

    // 4. Create the brand-new presentation and PIN in Firestore
    try {
      const newId = await createNewPresentation();
      if (newId) {
        console.log('AppContent - New presentation created successfully:', newId);
        // 5. Store in sessionStorage
        sessionStorage.setItem('activePresenterPresentationId', newId);
        
        // 6. Perform a clean full page reload/redirect to clear parameters and reset capturing state
        const cleanUrl = window.location.origin + window.location.pathname;
        console.log('AppContent - Redirecting cleanly to:', cleanUrl);
        window.location.href = cleanUrl;
      } else {
        throw new Error('Created presentation ID was empty.');
      }
    } catch (err) {
      console.error('AppContent - Failed to start a new presentation session:', err);
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

  const [notesTextMap, setNotesTextMap] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>('1');
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [lastTypedAt, setLastTypedAt] = useState<number>(0);
  const [notesTitle, setNotesTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | ''>('');

  useEffect(() => {
    if (!activePresentationId) return;
    const savedNotes = localStorage.getItem(`activeDeckNotes_${activePresentationId}`);
    const savedTitle = localStorage.getItem(`activeDeckNotesTitle_${activePresentationId}`);
    
    let parsedNotesMap: Record<string, string> = { '1': '' };
    if (savedNotes) {
      try {
        const parsed = JSON.parse(savedNotes);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedNotesMap = parsed;
        } else {
          parsedNotesMap = { '1': savedNotes };
        }
      } catch (e) {
        // Fallback for single-string older notes format (migration)
        parsedNotesMap = { '1': savedNotes };
      }
    }
    setNotesTextMap(parsedNotesMap);
    setNotesTitle(savedTitle || '');
    setSaveStatus('');
    
    // Set active tab to presentation's current slide or default to '1'
    const initialSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
      ? String(presentation.currentSlide) 
      : '1';
    setActiveTab(initialSlide);
  }, [activePresentationId]);

  // Synchronize activeTab with presenter slide when slide changes (with idle detection)
  useEffect(() => {
    if (!presentation || presentation.currentSlide === undefined || presentation.currentSlide === null) return;
    const slideStr = String(presentation.currentSlide);
    
    const isTypingNow = Date.now() - lastTypedAt < 5000;
    
    if (!isEditorFocused && !isTypingNow) {
      setActiveTab(slideStr);
    }
  }, [presentation?.currentSlide]);

  useEffect(() => {
    if (!activePresentationId) return;
    
    const savedNotes = localStorage.getItem(`activeDeckNotes_${activePresentationId}`) || '';
    const savedTitle = localStorage.getItem(`activeDeckNotesTitle_${activePresentationId}`) || '';
    
    const currentNotesRaw = JSON.stringify(notesTextMap);
    
    // Check if anything actually changed to avoid redundant saves and flicker
    let isSameNotes = false;
    try {
      const parsedSaved = JSON.parse(savedNotes);
      isSameNotes = JSON.stringify(parsedSaved) === currentNotesRaw;
    } catch (e) {
      isSameNotes = false;
    }

    if (isSameNotes && notesTitle === savedTitle) {
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(() => {
      localStorage.setItem(`activeDeckNotes_${activePresentationId}`, currentNotesRaw);
      localStorage.setItem(`activeDeckNotesTitle_${activePresentationId}`, notesTitle);
      setSaveStatus('saved');
      
      const resetTimer = setTimeout(() => setSaveStatus(''), 2000);
      return () => clearTimeout(resetTimer);
    }, 500);

    return () => clearTimeout(timer);
  }, [notesTextMap, notesTitle, activePresentationId]);

  const handleDownloadNotes = () => {
    if (isNotesEmpty(notesTextMap)) {
      alert("Notes are empty. Type some notes first!");
      return;
    }
    const title = notesTitle.trim() || `Session_${presentation?.pinCode || 'Notes'}`;
    const filename = `ActiveDeck_Notes_${title.replace(/[^a-z0-9_-]/gi, '_')}.doc`;
    
    const presenterName = presentation?.presenterEmail ? presentation.presenterEmail.split('@')[0] : 'Presenter';
    const pin = presentation?.pinCode || 'N/A';
    
    // Sort slides numerically and compile notes
    const sortedSlides = Object.keys(notesTextMap)
      .filter(slide => {
        const html = notesTextMap[slide];
        return html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
      })
      .sort((a, b) => Number(a) - Number(b));

    const notesContentHtml = sortedSlides.map(slide => `
      <div style="margin-bottom: 25px;">
        <h3 style="color: #eb5d00; border-bottom: 1px solid #f3eedd; padding-bottom: 3px; margin-bottom: 10px;">Slide ${slide}</h3>
        <div>${notesTextMap[slide]}</div>
      </div>
    `).join('');

    const docHtml = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          body {
            font-family: 'Arial', sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #333333;
          }
          h2 {
            font-family: 'Arial', sans-serif;
            font-size: 16pt;
            color: #eb5d00; /* OSU Orange */
            border-bottom: 2px solid #eb5d00;
            padding-bottom: 4px;
            margin-top: 0;
          }
          .metadata-box {
            background-color: #f8f9fa;
            border-left: 4px solid #eb5d00;
            padding: 10px 15px;
            margin-bottom: 20px;
            font-size: 10pt;
            color: #555555;
          }
          .metadata-label {
            font-weight: bold;
            color: #111111;
          }
          .notes-container {
            font-size: 11pt;
            color: #222222;
          }
        </style>
      </head>
      <body>
        <h2>ActiveDeck Study Notes</h2>
        <div class="metadata-box">
          <span class="metadata-label">Presenter:</span> ${presenterName}<br/>
          <span class="metadata-label">Session PIN:</span> ${pin}<br/>
          <span class="metadata-label">Notes Title:</span> ${title}<br/>
          <span class="metadata-label">Date:</span> ${new Date().toLocaleDateString()}<br/>
        </div>
        <div class="notes-container">
          ${notesContentHtml}
        </div>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEmailNotes = () => {
    if (isNotesEmpty(notesTextMap)) {
      alert("Notes are empty. Type some notes first!");
      return;
    }
    const title = notesTitle.trim() || `Session ${presentation?.pinCode || 'Notes'}`;
    const subject = `ActiveDeck Notes: ${title}`;
    const presenterName = presentation?.presenterEmail ? presentation.presenterEmail.split('@')[0] : 'Presenter';
    const pin = presentation?.pinCode || 'N/A';
    
    const sortedSlides = Object.keys(notesTextMap)
      .filter(slide => {
        const html = notesTextMap[slide];
        return html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
      })
      .sort((a, b) => Number(a) - Number(b));

    const plainNotesText = sortedSlides.map(slide => {
      const slidePlain = htmlToPlainText(notesTextMap[slide]);
      return `Slide ${slide}\n------------------------------\n${slidePlain}\n`;
    }).join('\n');
    
    const body = `ActiveDeck Session Notes\n` +
                 `==============================\n` +
                 `Presenter: ${presenterName}\n` +
                 `Session PIN: ${pin}\n` +
                 `Title: ${title}\n` +
                 `Date: ${new Date().toLocaleDateString()}\n` +
                 `==============================\n\n` +
                 `${plainNotesText}`;
                 
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
  };

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
  const isProjector = urlParams.get('view') === 'projector';

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('activeDeckProjectorSidebarWidth');
    return saved ? parseInt(saved, 10) : 380;
  });

  const [presenterSidebarWidth, setPresenterSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('activeDeckPresenterSidebarWidth');
    return saved ? Math.max(270, parseInt(saved, 10)) : 300;
  });

  const [isFullscreen, setIsFullscreen] = useState(false);

  // Manage local fullscreen change state
  useEffect(() => {
    const handleLocalFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isCurrentlyFullscreen);
    };

    document.addEventListener('fullscreenchange', handleLocalFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleLocalFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.error("Error attempting to enable fullscreen:", err);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  const isDraggingProjectorRef = useRef(false);
  const isDraggingPresenterRef = useRef(false);

  const handleMouseDownProjector = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingProjectorRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseDownPresenter = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPresenterRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDoubleClickProjector = () => {
    setSidebarWidth(380);
    localStorage.setItem('activeDeckProjectorSidebarWidth', '380');
  };

  const handleDoubleClickPresenter = () => {
    setPresenterSidebarWidth(300);
    localStorage.setItem('activeDeckPresenterSidebarWidth', '300');
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 1. Projector Sidebar Dragging
      if (isDraggingProjectorRef.current) {
        const containerPadding = 24; // p-6 is 24px
        const calculatedWidth = window.innerWidth - e.clientX - containerPadding;
        const constrainedWidth = Math.max(260, Math.min(600, calculatedWidth));
        setSidebarWidth(constrainedWidth);
        localStorage.setItem('activeDeckProjectorSidebarWidth', constrainedWidth.toString());
      }

      // 2. Presenter Sidebar Dragging
      if (isDraggingPresenterRef.current) {
        const containerPadding = 24; // p-6 is 24px
        const calculatedWidth = window.innerWidth - e.clientX - containerPadding;
        const constrainedWidth = Math.max(270, Math.min(500, calculatedWidth));
        setPresenterSidebarWidth(constrainedWidth);
        localStorage.setItem('activeDeckPresenterSidebarWidth', constrainedWidth.toString());
      }
    };

    const handleMouseUp = () => {
      if (isDraggingProjectorRef.current) {
        isDraggingProjectorRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (isDraggingPresenterRef.current) {
        isDraggingPresenterRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);



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

  // Reactive PIN-to-ID resolver for Projector Mode
  useEffect(() => {
    if (!isProjector || activePresentationId) return;

    const currentUrlParams = new URLSearchParams(window.location.search);
    const pin = currentUrlParams.get('pin');
    if (!pin) return;

    const resolvePin = async () => {
      console.log('AppContent - Projector Mode: Resolving PIN:', pin);
      try {
        const pinRef = doc(db, 'sessionPins', pin);
        const pinSnap = await getDoc(pinRef);
        if (pinSnap.exists() && pinSnap.data().active) {
          const presId = pinSnap.data().presentationId;
          if (presId) {
            console.log('AppContent - PIN resolved successfully to presentationId:', presId);
            setActivePresentationId(presId);
            return;
          }
        }
      } catch (err) {
        console.warn('AppContent - Error reading PIN from sessionPins:', err);
      }

      // Direct fallback query
      try {
        const { query, collection, where, getDocs, limit } = await import('firebase/firestore');
        const q = query(collection(db, 'presentations'), where('pinCode', '==', pin), limit(1));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          const presId = querySnap.docs[0].id;
          console.log('AppContent - Fallback direct query resolved PIN to presentationId:', presId);
          setActivePresentationId(presId);
        }
      } catch (err) {
        console.error('AppContent - Direct presentations query fallback failed:', err);
      }
    };

    resolvePin();
  }, [isProjector, activePresentationId]);



  useEffect(() => {
    if (authLoading) {
      console.log('AppContent - Still loading auth...');
      return;
    }

    const loadPresentation = async () => {
      const ensurePresentationHasPin = async (presId: string, data: any) => {
        if (!data.pinCode && !isChatOnly && !isProjector && user) {
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

      // Determine if we should load the presentation ID from the URL (students/chat-only or projector)
      let shouldLoadUrlId = false;
      if ((isChatOnly || isProjector) && activePresentationId) {
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

  // Ask for presenter's email before letting them proceed to the presenter screen (bypass for chat & projector)
  if (!isChatOnly && !isProjector && !presenterEmail) {
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

  // Synced Projector Mode Layout
  if (isProjector) {
    return (
      <div className="flex flex-row h-full w-full overflow-hidden bg-slate-950 font-sans antialiased p-6 gap-3 relative group">
        {/* Giant Slide Presentation Area */}
        <div className="flex-1 h-full min-w-0 rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl">
          <PresenterArea 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            isProjectorMode={true}
          />
        </div>

        {/* Interactive Drag Splitter */}
        <div 
          onMouseDown={handleMouseDownProjector}
          onDoubleClick={handleDoubleClickProjector}
          className="w-3 h-full cursor-col-resize flex items-center justify-center flex-shrink-0 group/splitter select-none"
          title="Drag to resize sidebar (double-click to reset)"
        >
          <div className="w-[3px] h-20 bg-slate-800 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
        </div>

        {/* Expanded Read-Only Sidebar Q&A Display */}
        <div 
          style={{ width: `${sidebarWidth}px` }}
          className="h-full flex-shrink-0 rounded-2xl overflow-hidden border-2 border-osu-orange bg-slate-900 shadow-2xl"
        >
          <ChatSidebar 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            presentationLoaded={presentationLoaded} 
            showAttendance={settings?.showAttendance}
            isProjector={true}
            isChatOnly={true} // Acts as student but read-only
          />
        </div>

        {/* Floating Glassmorphic Fullscreen Toggle Button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="absolute bottom-10 left-10 z-[100] p-3 rounded-full bg-slate-900/80 hover:bg-osu-orange border border-slate-800 hover:border-osu-orange text-slate-400 hover:text-white shadow-2xl transition-all duration-300 backdrop-blur-md cursor-pointer opacity-0 group-hover:opacity-100 flex items-center justify-center hover:scale-110 active:scale-95 outline-none"
          title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
      </div>
    );
  }

  // Chat-only view for audience members who scanned the QR code
  if (isChatOnly) {
    return (
      <div className="h-full w-full flex flex-col md:flex-row bg-slate-950 font-sans antialiased overflow-hidden">
        {/* Left Side: The Chat Sidebar */}
        <div className="w-full md:w-[40%] lg:w-[35%] h-full bg-white relative">
          <ChatSidebar 
            isChatOnly={true} 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            presentationLoaded={presentationLoaded} 
            showAttendance={settings?.showAttendance}
            onJoinChange={setHasJoinedChat}
          />
        </div>

        {/* Right Side: Premium Welcome Panel (Desktop/Laptop only) */}
        <div className="hidden md:flex md:w-[60%] lg:w-[65%] h-full flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-l border-slate-800/80 p-8 relative overflow-y-auto">
          {/* Ambient lighting glow */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-osu-orange/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="max-w-3xl w-full mx-auto space-y-6 relative z-10 animate-in fade-in zoom-in-95 duration-500 flex flex-col h-full min-h-0">
            {/* Header Area: Logo, Title, and Stats */}
            <div className="space-y-4 shrink-0 select-none">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 p-2 bg-white/5 rounded-2xl border border-white/10 shadow-2xl flex items-center justify-center shrink-0">
                  <img 
                    src={settings?.theme.logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
                    alt="Logo" 
                    className="max-w-full max-h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="text-left">
                  <h1 className="text-xl font-black uppercase tracking-wider text-white">ActiveDeck Chat</h1>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    Join discussion, ask questions, take notes in real-time.
                  </p>
                </div>
              </div>

              {/* Session Stats Card */}
              {presentation && (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-left space-y-2.5 shadow-xl backdrop-blur-sm">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Active Session</span>
                    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/15 text-green-400 text-[8px] font-black uppercase tracking-wider rounded border border-green-500/25">
                      <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" />
                      Live
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3 pt-0.5">
                    <div>
                      <span className="block text-[8px] font-black uppercase tracking-wider text-slate-500">Presenter</span>
                      <span className="text-xs font-bold text-slate-200 truncate block">
                        {presentation.presenterEmail ? presentation.presenterEmail.split('@')[0] : 'Presenter'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[8px] font-black uppercase tracking-wider text-slate-500">Session PIN</span>
                      <span className="text-xs font-mono font-bold text-osu-orange">
                        {presentation.pinCode || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[8px] font-black uppercase tracking-wider text-slate-500">Current Slide</span>
                      <span className="text-xs font-bold text-slate-200 block truncate">
                        {presentation.currentSlide !== undefined && presentation.currentSlide !== null 
                          ? `Slide ${presentation.currentSlide}` 
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Note-Taking Section */}
            <div className="flex-1 flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-2xl p-4 shadow-xl backdrop-blur-sm space-y-3">
              {!hasJoinedChat ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-305">
                  <div className="w-12 h-12 rounded-2xl bg-osu-orange/10 border border-osu-orange/20 flex items-center justify-center text-osu-orange shadow-lg shadow-orange-500/5">
                    <Lock className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-200">Notes Locked</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Join the discussion by entering your name and email on the left to unlock real-time, slide-by-slide note-taking.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">My Study Notes</span>
                    {saveStatus && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded transition-all duration-305 ${
                        saveStatus === 'saving' ? 'text-slate-400 animate-pulse' : 'text-green-400 bg-green-500/10 border border-green-500/20'
                      }`}>
                        {saveStatus === 'saving' ? 'Saving...' : 'Auto-saved'}
                      </span>
                    )}
                  </div>

                  {/* Title input */}
                  <input 
                    type="text"
                    value={notesTitle}
                    onChange={(e) => setNotesTitle(e.target.value)}
                    placeholder="Notes Title (e.g. Lecture 1)"
                    className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-osu-orange focus:border-osu-orange transition-all shrink-0"
                  />

                  {/* Slide Tabs Bar */}
                  {(() => {
                    const slidesWithNotes = Object.keys(notesTextMap).filter(slide => {
                      const html = notesTextMap[slide];
                      return html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
                    });
                    
                    const presenterSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
                      ? String(presentation.currentSlide) 
                      : '1';
                    
                    // Determine the highest slide index dynamically
                    const maxSlide = Math.max(
                      1,
                      presentation?.currentSlide || 1,
                      ...Object.keys(notesTextMap).map(Number)
                    );

                    // Create a contiguous array of slide numbers from 1 to maxSlide
                    const allTabs: string[] = [];
                    for (let i = 1; i <= maxSlide; i++) {
                      allTabs.push(String(i));
                    }

                    return (
                      <div className="flex flex-col space-y-1 shrink-0">
                        <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Slides Overview</span>
                        <div className="flex flex-row flex-wrap items-center gap-1.5 py-1 select-none">
                          {allTabs.map(slide => {
                            const isCurrentTab = slide === activeTab;
                            const isPresenterSlide = slide === presenterSlide;
                            const hasContent = slidesWithNotes.includes(slide);

                            return (
                              <button
                                key={slide}
                                type="button"
                                onClick={() => setActiveTab(slide)}
                                className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                                  isCurrentTab 
                                    ? 'bg-osu-orange border-osu-orange text-white shadow-md shadow-orange-500/10'
                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                                }`}
                              >
                                <span>Slide {slide}</span>
                                {isPresenterSlide && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse border border-green-300" title="Presenter is currently on this slide" />
                                )}
                                {!isPresenterSlide && hasContent && (
                                  <span className="w-1 h-1 rounded-full bg-orange-300/60" title="Has notes" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Slide Out-of-Sync Alert */}
                  {presentation && presentation.currentSlide !== undefined && presentation.currentSlide !== null && String(presentation.currentSlide) !== activeTab && (
                    <div className="flex items-center justify-between p-2 rounded-xl bg-orange-500/10 border border-orange-500/20 text-[10px] shrink-0 text-orange-200 animate-in fade-in slide-in-from-top-2 duration-300">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                        Presenter is on Slide {presentation.currentSlide} (You are on Slide {activeTab})
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab(String(presentation.currentSlide))}
                        className="px-2 py-0.5 rounded bg-osu-orange text-white font-bold uppercase tracking-wider text-[8px] hover:bg-[#c03900] transition-colors cursor-pointer"
                      >
                        Go to Slide {presentation.currentSlide}
                      </button>
                    </div>
                  )}

                  {/* Rich Text Editor */}
                  <RichTextEditor
                    value={notesTextMap[activeTab] || ''}
                    onChange={(newVal) => {
                      setLastTypedAt(Date.now());
                      setNotesTextMap(prev => ({
                        ...prev,
                        [activeTab]: newVal
                      }));
                    }}
                    onFocus={() => setIsEditorFocused(true)}
                    onBlur={() => setIsEditorFocused(false)}
                    placeholder={`Type your notes for Slide ${activeTab} here...`}
                    className="flex-1 min-h-[120px]"
                  />

                  {/* Export Buttons */}
                  <div className="grid grid-cols-2 gap-2.5 pt-1.5 shrink-0 select-none">
                    <button
                      type="button"
                      onClick={handleDownloadNotes}
                      disabled={isNotesEmpty(notesTextMap)}
                      className="h-10 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      Download (.doc)
                    </button>
                    <button
                      type="button"
                      onClick={handleEmailNotes}
                      disabled={isNotesEmpty(notesTextMap)}
                      className="h-10 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      Email to Me
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Footer watermark */}
            <span className="text-[10px] font-black tracking-widest text-slate-600 uppercase select-none text-center shrink-0">
              ActiveDeck &copy; {new Date().getFullYear()}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-100 font-sans antialiased">
      <Header 
        presentationId={presentation?.id || activePresentationId} 
        showAttendance={settings?.showAttendance}
        onNewSession={handleStartNewSession}
        pinCode={presentation?.pinCode}
      />
      
      <div className="flex flex-row flex-1 p-6 pb-2 gap-3 bg-slate-100 min-h-0 overflow-hidden">
        {/* Presenter View (Flexible, but takes most space) */}
        <div className="flex-1 h-full min-w-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border border-slate-300 bg-black">
          <PresenterArea presentation={presentation} logoUrl={settings?.theme.logoUrl} onCreatePresentation={handleCreatePresentationForArea} />
        </div>

        {/* Interactive Drag Splitter */}
        <div 
          onMouseDown={handleMouseDownPresenter}
          onDoubleClick={handleDoubleClickPresenter}
          className="w-3 h-full cursor-col-resize flex items-center justify-center flex-shrink-0 group/splitter select-none"
          title="Drag to resize sidebar (double-click to reset)"
        >
          <div className="w-[3px] h-20 bg-slate-300 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
        </div>

        {/* Audience Chat (Resizable sidebar) */}
        <div 
          style={{ width: `${presenterSidebarWidth}px`, minWidth: '270px' }}
          className="h-full flex-shrink-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border-2 border-osu-orange bg-white"
        >
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
