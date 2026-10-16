import React, { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea, useRenderedSlideBounds } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation, GlobalSettings, DrawingStroke, DeckItem, SlideTextAnnotation } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp, updateDoc, getDoc, setDoc, increment, where } from 'firebase/firestore';
import { Presentation as PresentationIcon, Loader2, AlertCircle, Maximize, Minimize, Lock, Pen, ZoomIn, Tv, ArrowLeftRight, MessageSquare, NotebookPen, Plus, FileText, X, Download, ChevronsLeft, ChevronsRight, Edit3, Sun, Moon, Eye } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BridgeProvider } from './contexts/BridgeContext';
import { AdminPortal } from './components/AdminPortal';
import { StudentAttendance } from './components/StudentAttendance';
import { JoinScreen } from './components/JoinScreen';
import { RichTextEditor } from './components/RichTextEditor';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { exportNotesToDocx, getSlideTextAnnotationsForSlide } from './utils/exportNotesDocx';

console.log('App.tsx - Module loaded');

const getStrokePath = (stroke: DrawingStroke): string => {
  if (!stroke.points || stroke.points.length === 0) return '';
  if (stroke.isArrow && stroke.points.length >= 2) {
    const p1 = stroke.points[0];
    const p2 = stroke.points[stroke.points.length - 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const headLength = Math.max(25, stroke.width * 4);
    const arrowAngle = Math.PI / 6;

    const h1x = p2.x - headLength * Math.cos(angle - arrowAngle);
    const h1y = p2.y - headLength * Math.sin(angle - arrowAngle);
    const h2x = p2.x - headLength * Math.cos(angle + arrowAngle);
    const h2y = p2.y - headLength * Math.sin(angle + arrowAngle);

    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} M ${p2.x} ${p2.y} L ${h1x.toFixed(1)} ${h1y.toFixed(1)} M ${p2.x} ${p2.y} L ${h2x.toFixed(1)} ${h2y.toFixed(1)}`;
  }
  if (stroke.isLine && stroke.points.length >= 2) {
    const p1 = stroke.points[0];
    const p2 = stroke.points[stroke.points.length - 1];
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }
  if (stroke.isRectangle && stroke.points.length >= 2) {
    const p1 = stroke.points[0];
    const p2 = stroke.points[stroke.points.length - 1];
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p1.y} L ${p2.x} ${p2.y} L ${p1.x} ${p2.y} Z`;
  }
  if (stroke.isCircle && stroke.points.length >= 2) {
    const p1 = stroke.points[0];
    const p2 = stroke.points[stroke.points.length - 1];
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const rx = Math.abs(p2.x - p1.x) / 2;
    const ry = Math.abs(p2.y - p1.y) / 2;
    if (rx < 0.1 || ry < 0.1) {
      return `M ${p1.x} ${p1.y} L ${p1.x + 0.1} ${p1.y + 0.1}`;
    }
    return `M ${(cx - rx).toFixed(1)} ${cy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(cx + rx).toFixed(1)} ${cy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(cx - rx).toFixed(1)} ${cy.toFixed(1)}`;
  }
  if (stroke.points.length === 1) {
    const pt = stroke.points[0];
    return `M ${pt.x} ${pt.y} L ${pt.x + 0.1} ${pt.y + 0.1}`;
  }
  return stroke.points.reduce((acc, pt, i) => i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`, '');
};

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

const isNotesEmpty = (
  notesMap: Record<string, string>,
  studentSlideDrawingsMap?: Record<string, string>,
  studentSlideTextAnnotationsMap?: Record<string | number, SlideTextAnnotation[]>
) => {
  const hasText = notesMap && Object.keys(notesMap).length > 0 && !Object.values(notesMap).every(html => {
    if (!html) return true;
    const cleanText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return cleanText === '';
  });

  const hasSlideDrawings = studentSlideDrawingsMap && Object.keys(studentSlideDrawingsMap).length > 0 && !Object.values(studentSlideDrawingsMap).every(drawingJson => {
    if (!drawingJson) return true;
    try {
      const strokes = JSON.parse(drawingJson);
      return !Array.isArray(strokes) || strokes.length === 0;
    } catch {
      return true;
    }
  });

  const hasSlideTextAnnotations =
    studentSlideTextAnnotationsMap &&
    Object.keys(studentSlideTextAnnotationsMap).length > 0 &&
    Object.values(studentSlideTextAnnotationsMap).some(
      list => Array.isArray(list) && list.some(a => a && a.text && a.text.trim() !== '')
    );

  return !hasText && !hasSlideDrawings && !hasSlideTextAnnotations;
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
  const [isPresentationSharing, setIsPresentationSharing] = useState(false);

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

  const createNewPresentation = async (
    initialDecks: DeckItem[] = [],
    initialPptxUrl: string | null = null,
    initialPptxFileName: string | null = null,
    initialSelectedDeckId: string | null = null
  ) => {
    console.log('AppContent - Creating new presentation for user:', user?.uid);
    if (!user) return '';
    try {
      const pinCode = await generateUniquePin();
      const isAttendanceActive = settings?.showAttendance !== false;
      const effectiveEmail = (
        sessionStorage.getItem('activePresenterEmail') || 
        presenterEmail || 
        localStorage.getItem('activeDeckLastPresenterEmail') || 
        ''
      ).trim().toLowerCase();

      let decksToSave: DeckItem[] = Array.isArray(initialDecks) ? initialDecks : [];
      let pptxUrlToSave: string | null = initialPptxUrl;
      let pptxFileNameToSave: string | null = initialPptxFileName;
      let selectedDeckIdToSave: string | null = initialSelectedDeckId;

      // If initialDecks is empty, attempt to pre-load permanent saved decks from whitelistedPresenters
      if (effectiveEmail && decksToSave.length === 0) {
        try {
          const presenterSnap = await getDoc(doc(db, 'whitelistedPresenters', effectiveEmail));
          if (presenterSnap.exists()) {
            const data = presenterSnap.data();
            if (Array.isArray(data.savedDecks)) {
              decksToSave = data.savedDecks;
              if (decksToSave.length > 0 && !pptxUrlToSave) {
                const lastSelectedId = data.lastSelectedDeckId || sessionStorage.getItem('activeDeckSelectedId') || (effectiveEmail ? localStorage.getItem(`activeDeckLastSelectedDeckId_${effectiveEmail}`) : null);
                const targetDeck = (lastSelectedId && decksToSave.find((d: any) => d.id === lastSelectedId)) || decksToSave[0];
                pptxUrlToSave = targetDeck.url;
                pptxFileNameToSave = targetDeck.name;
                selectedDeckIdToSave = targetDeck.id;
              }
            }
          }
        } catch (e) {
          console.warn('AppContent - Could not pre-fetch savedDecks from whitelistedPresenters:', e);
        }
      }

      const docData: any = {
        presenterId: user.uid,
        embedUrl: '',
        createdAt: serverTimestamp(),
        allowAnonymousChat: false,
        disableAttendance: !isAttendanceActive,
        hideComments: false,
        presenterEmail: effectiveEmail,
        pinCode: pinCode,
        hasActivity: false
      };

      if (decksToSave.length > 0) {
        docData.uploadedDecks = decksToSave;
      }
      if (pptxUrlToSave) {
        docData.pptxUrl = pptxUrlToSave;
      }
      if (pptxFileNameToSave) {
        docData.pptxFileName = pptxFileNameToSave;
      }
      if (selectedDeckIdToSave) {
        docData.selectedDeckId = selectedDeckIdToSave;
      }

      const docRef = await addDoc(collection(db, 'presentations'), docData);
      
      try {
        await setDoc(doc(db, 'sessionPins', pinCode), {
          presentationId: docRef.id,
          createdAt: serverTimestamp(),
          active: true
        });
      } catch (err) {
        console.error('Failed to register PIN in sessionPins during creation:', err);
      }
      
      console.log('AppContent - New presentation created:', docRef.id, 'with PIN:', pinCode, 'and decks:', decksToSave.length);
      sessionStorage.setItem('activePresenterPresentationId', docRef.id);
      
      return docRef.id;
    } catch (error) {
      console.error("AppContent - Error creating presentation:", error);
      throw error;
    }
  };

  const handleStartNewSession = async (mode: 'same' | 'different' = 'different') => {
    console.log(`AppContent - Starting new session in mode: ${mode}...`);
    setIsPresentationSharing(false);
    
    // Broadcast message to close the projector window/tab
    try {
      const channel = new BroadcastChannel('activedeck-stream');
      channel.postMessage({ type: 'close-projector' });
      channel.close();
    } catch (err) {
      console.error('AppContent - Failed to broadcast close-projector:', err);
    }

    // Broadcast session-ended message to instantly notify all open student/audience tabs
    try {
      const channel = new BroadcastChannel('activedeck-session');
      channel.postMessage({ type: 'session-ended', presentationId: presentation?.id });
      channel.close();
    } catch (err) {
      console.error('AppContent - Failed to broadcast session-ended:', err);
    }

    // 1. Unsubscribe from any active snapshot listener to avoid memory leaks or stale updates
    if (activeUnsubscribeRef.current) {
      console.log('AppContent - Unsubscribing from current presentation listener');
      activeUnsubscribeRef.current();
      activeUnsubscribeRef.current = null;
    }

    // 2. Mark the presentation as ended/inactive in Firestore and deactivate the old PIN
    if (presentation) {
      if (presentation.id) {
        try {
          await updateDoc(doc(db, 'presentations', presentation.id), {
            isEnded: true,
            active: false,
            endedAt: serverTimestamp()
          });
          console.log(`AppContent - Marked presentation ${presentation.id} as isEnded: true`);
        } catch (err) {
          console.error('AppContent - Failed to mark presentation as ended in Firestore:', err);
        }
      }

      if (presentation.pinCode) {
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
    }

    if (mode === 'same') {
      // Keep presenterEmail, carry over decks, and generate a fresh session
      const existingDecks = presentation?.uploadedDecks || [];
      const existingPptxUrl = presentation?.pptxUrl || null;
      const existingPptxFileName = presentation?.pptxFileName || null;
      const existingSelectedDeckId = presentation?.selectedDeckId || null;

      sessionStorage.removeItem('activePresenterPresentationId');
      sessionStorage.removeItem('activeDeckForceNewSession');
      setPresentation(null);
      setPresentationLoaded(false);

      try {
        const newId = await createNewPresentation(
          existingDecks,
          existingPptxUrl,
          existingPptxFileName,
          existingSelectedDeckId
        );
        if (newId) {
          console.log('AppContent - Successfully created new session for same presenter with carried-over decks:', newId);
          setActivePresentationId(newId);
        }
      } catch (err) {
        console.error('AppContent - Failed to create new presentation for same presenter:', err);
      }
    } else {
      // 3. Clear cached presenter details to force re-authentication for the next presenter
      sessionStorage.removeItem('activePresenterEmail');
      sessionStorage.removeItem('activePresenterPresentationId');
      sessionStorage.removeItem('activeDeckForceNewSession');
      localStorage.removeItem('activeDeckLastPresenterEmail');

      // 4. Clear local states
      setPresenterEmail('');
      setPresentation(null);
      setPresentationLoaded(false);

      // 5. Perform a clean full page reload/redirect to prompt for presenter login
      const cleanUrl = window.location.origin + window.location.pathname;
      console.log('AppContent - Redirecting cleanly to:', cleanUrl);
      window.location.href = cleanUrl;
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
  const [studentSlideDrawingsMap, setStudentSlideDrawingsMap] = useState<Record<string, string>>({});
  const [studentSlideTextAnnotationsMap, setStudentSlideTextAnnotationsMap] = useState<Record<number | string, SlideTextAnnotation[]>>({});
  const [, setCompositedSlidePreviewsMap] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>('1');
  const [maxSlideSeen, setMaxSlideSeen] = useState<number>(1);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [lastTypedAt, setLastTypedAt] = useState<number>(0);
  const [notesTitle, setNotesTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | ''>('');

  const [pushedSlidesMap, setPushedSlidesMap] = useState<Record<string, string>>({});

  const handleUpdateSlideTextAnnotations = (tabKey: string | number, newAnnotations: SlideTextAnnotation[]) => {
    setStudentSlideTextAnnotationsMap(prev => {
      const next = { ...prev };
      const strKey = String(tabKey);
      const numKey = Number(tabKey);
      next[strKey] = newAnnotations;
      if (!isNaN(numKey)) {
        next[numKey] = newAnnotations;
      }
      return next;
    });
  };

  const getSlidePreviewUrl = (tab: string | number | undefined | null): string | undefined => {
    if (tab === undefined || tab === null) return undefined;
    const strKey = String(tab);
    if (pushedSlidesMap[strKey]) return pushedSlidesMap[strKey];
    const numKey = Number(tab);
    if (!isNaN(numKey) && pushedSlidesMap[String(numKey)]) return pushedSlidesMap[String(numKey)];
    return undefined;
  };

  // Custom blank note tabs added by the student
  const [customTabs, setCustomTabs] = useState<Array<{ id: string; label: string; position: number }>>([]);

  // Load custom tabs for presentation
  useEffect(() => {
    if (!activePresentationId) {
      setCustomTabs([]);
      return;
    }
    const saved = localStorage.getItem(`activeDeckCustomTabs_${activePresentationId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCustomTabs(parsed);
        }
      } catch (e) {
        console.error('Failed to parse custom tabs:', e);
      }
    } else {
      setCustomTabs([]);
    }
  }, [activePresentationId]);

  // Save custom tabs
  useEffect(() => {
    if (!activePresentationId) return;
    localStorage.setItem(`activeDeckCustomTabs_${activePresentationId}`, JSON.stringify(customTabs));
  }, [customTabs, activePresentationId]);

  const handleAddCustomTab = () => {
    const currentHighestPos = Math.max(
      1,
      maxSlideSeen,
      presentation?.currentSlide || 1,
      ...customTabs.map(t => t.position),
      ...Object.keys(notesTextMap).map(Number).filter(n => !isNaN(n))
    );

    const newPos = Number((currentHighestPos + 0.1).toFixed(2));
    const newId = `note_${Date.now()}`;
    const newLabel = `Notes ${customTabs.length + 1}`;

    const newTab = {
      id: newId,
      label: newLabel,
      position: newPos
    };

    setCustomTabs(prev => [...prev, newTab]);
    setActiveTab(newId);
  };

  const handleDeleteCustomTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm("Are you sure you want to delete this custom note tab?");
    if (!confirmed) return;

    setCustomTabs(prev => prev.filter(t => t.id !== tabId));
    setNotesTextMap(prev => {
      const copy = { ...prev };
      delete copy[tabId];
      return copy;
    });

    if (activeTab === tabId) {
      setActiveTab('1');
    }
  };

  const getTabTitle = (tabId: string) => {
    const custom = customTabs.find(c => c.id === tabId);
    if (custom) return custom.label;
    return `Slide ${tabId}`;
  };

  const [notesSplitRatio, setNotesSplitRatio] = useState<number>(() => {
    const saved = localStorage.getItem('activeDeckNotesSplitRatio');
    return saved ? parseFloat(saved) : 60; // Default: 60% notes, 40% preview
  });

  const [chatLayoutDirection, setChatLayoutDirection] = useState<'left' | 'right'>(() => {
    const saved = localStorage.getItem('activeDeckChatLayoutDirection');
    return (saved === 'left' ? 'left' : 'right');
  });

  const [studentTheme, setStudentTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('activeDeckStudentTheme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [editorTheme, setEditorTheme] = useState<'dark' | 'light' | 'paper'>(() => {
    const savedStudentTheme = localStorage.getItem('activeDeckStudentTheme');
    if (savedStudentTheme === 'light') return 'light';
    if (savedStudentTheme === 'dark') return 'dark';
    const saved = localStorage.getItem('activeDeckEditorTheme');
    return saved === 'paper' || saved === 'light' ? 'light' : 'dark';
  });

  const toggleStudentTheme = () => {
    const nextTheme = studentTheme === 'dark' ? 'light' : 'dark';
    setStudentTheme(nextTheme);
    localStorage.setItem('activeDeckStudentTheme', nextTheme);
    setEditorTheme(nextTheme);
    localStorage.setItem('activeDeckEditorTheme', nextTheme);
  };

  const handleEditorThemeChange = (theme: 'dark' | 'light' | 'paper') => {
    const normalized = theme === 'paper' || theme === 'light' ? 'light' : 'dark';
    setEditorTheme(normalized);
    localStorage.setItem('activeDeckEditorTheme', normalized);
    setStudentTheme(normalized);
    localStorage.setItem('activeDeckStudentTheme', normalized);
  };

  const [isEditingNotesTitle, setIsEditingNotesTitle] = useState(false);

  const [isStudentChatCollapsed, setIsStudentChatCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('activeDeckStudentChatCollapsed') === 'true';
  });

  const toggleStudentChatCollapsed = (collapsed: boolean) => {
    setIsStudentChatCollapsed(collapsed);
    localStorage.setItem('activeDeckStudentChatCollapsed', String(collapsed));
  };

  const [chatUnreadInfo, setChatUnreadInfo] = useState<{ unreadCount: number; hasActiveActivity: boolean }>({
    unreadCount: 0,
    hasActiveActivity: false,
  });

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxImgUrl, setLightboxImgUrl] = useState('');

  const [isMobile, setIsMobile] = useState(() => 
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [mobileTab, setMobileTab] = useState<'chat' | 'notes'>('chat');

  useEffect(() => {
    if (presentation?.chatEnabled === false) {
      setMobileTab('notes');
    }
  }, [presentation?.chatEnabled]);

  // Maintain maxSlideSeen so slide tabs only grow and never get removed when presenter moves backwards
  useEffect(() => {
    const candidates: number[] = [1, maxSlideSeen];
    if (presentation?.currentSlide && typeof presentation.currentSlide === 'number') {
      candidates.push(presentation.currentSlide);
    }
    if (activeTab) {
      const numTab = parseInt(activeTab, 10);
      if (!isNaN(numTab) && numTab > 0) candidates.push(numTab);
    }
    Object.keys(notesTextMap).forEach(k => {
      const n = parseInt(k, 10);
      if (!isNaN(n) && n > 0) candidates.push(n);
    });
    Object.keys(pushedSlidesMap).forEach(k => {
      const n = parseInt(k, 10);
      if (!isNaN(n) && n > 0) candidates.push(n);
    });

    const highest = Math.max(...candidates);
    if (highest > maxSlideSeen) {
      setMaxSlideSeen(highest);
    }
  }, [presentation?.currentSlide, activeTab, notesTextMap, pushedSlidesMap, maxSlideSeen]);

  // Reset maxSlideSeen when changing presentation session
  useEffect(() => {
    if (!activePresentationId) {
      setMaxSlideSeen(1);
      return;
    }
    const initial = presentation?.currentSlide || 1;
    setMaxSlideSeen(initial);
  }, [activePresentationId]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!activePresentationId) {
      console.log("[SlidePreview] No activePresentationId, clearing pushedSlidesMap.");
      setPushedSlidesMap({});
      return;
    }

    console.log(`[SlidePreview] Subscribing to messages collection for background slidePreviews. presentationId: ${activePresentationId}`);

    const qPreviews = query(
      collection(db, 'messages'),
      where('presentationId', '==', activePresentationId)
    );

    const unsubPreviews = onSnapshot(qPreviews, (snapshot) => {
      const newPreviewsMap: Record<string, string> = {};
      const previewsTimeMap: Record<string, number> = {};
      const incomingCustomTabs: Array<{ id: string; label: string; position: number }> = [];
      let latestPushedId: string | null = null;
      let latestTime = 0;

      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.fileUrl && data.slide !== undefined && data.slide !== null) {
          const slideId = String(data.slide);
          const timestampVal = data.timestamp?.seconds 
            ? data.timestamp.seconds * 1000 
            : (typeof data.timestamp?.toMillis === 'function' ? data.timestamp.toMillis() : 0);

          // Give priority to newer timestamps or explicit slide preview captures
          if (!newPreviewsMap[slideId] || timestampVal >= (previewsTimeMap[slideId] || 0) || data.isBackgroundPreview || data.isPushedSlide) {
            newPreviewsMap[slideId] = data.fileUrl;
            previewsTimeMap[slideId] = timestampVal;
          }

          if (data.isCustomNoteTab || slideId.startsWith('note_')) {
            const pos = data.position || 999;
            const label = data.label || '';
            incomingCustomTabs.push({ id: slideId, label, position: pos });

            if (timestampVal > latestTime) {
              latestTime = timestampVal;
              latestPushedId = slideId;
            }
          }
        }
      });

      console.log("[SlidePreview] Updated background slidePreviewsMap:", newPreviewsMap);
      setPushedSlidesMap(newPreviewsMap);
      if (activePresentationId && Object.keys(newPreviewsMap).length > 0) {
        localStorage.setItem(`activeDeckPushedSlides_${activePresentationId}`, JSON.stringify(newPreviewsMap));
      }

      if (incomingCustomTabs.length > 0) {
        setCustomTabs(prev => {
          let updated = [...prev];
          let addedCount = 0;

          incomingCustomTabs.forEach(ict => {
            if (!updated.some(t => t.id === ict.id)) {
              addedCount++;
              const labelIndex = updated.length + 1;
              updated.push({
                id: ict.id,
                label: ict.label || `Notes ${labelIndex}`,
                position: ict.position
              });
            }
          });

          if (addedCount > 0 && latestPushedId) {
            setActiveTab(latestPushedId);
          }

          return updated;
        });
      }
    }, (error) => {
      console.error("[SlidePreview] Slide previews subscription error:", error);
    });

    return () => {
      unsubPreviews();
    };
  }, [activePresentationId]);

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

    const savedStudentSlideDrawings = localStorage.getItem(`activeDeckStudentSlideDrawings_${activePresentationId}`) || '';
    let parsedStudentSlideDrawings: Record<string, string> = {};
    if (savedStudentSlideDrawings) {
      try {
        parsedStudentSlideDrawings = JSON.parse(savedStudentSlideDrawings);
      } catch (e) {}
    }

    const savedStudentSlideTextAnnotations = localStorage.getItem(`activeDeckStudentSlideTextAnnotations_${activePresentationId}`) || '';
    let parsedStudentSlideTextAnnotations: Record<number | string, SlideTextAnnotation[]> = {};
    if (savedStudentSlideTextAnnotations) {
      try {
        parsedStudentSlideTextAnnotations = JSON.parse(savedStudentSlideTextAnnotations);
      } catch (e) {}
    }

    // Migrate any legacy stroke.text items from studentSlideDrawings into editable percentage text annotations
    Object.keys(parsedStudentSlideDrawings).forEach(slideKey => {
      try {
        const rawStrokes: DrawingStroke[] = JSON.parse(parsedStudentSlideDrawings[slideKey]);
        if (Array.isArray(rawStrokes) && rawStrokes.some(s => s && s.text)) {
          const migratedTextAnns: SlideTextAnnotation[] = [
            ...getSlideTextAnnotationsForSlide(parsedStudentSlideTextAnnotations, slideKey)
          ];
          const remainingStrokes: DrawingStroke[] = [];
          rawStrokes.forEach((s, idx) => {
            if (s && s.text && s.points?.[0]) {
              migratedTextAnns.push({
                id: `migrated_${slideKey}_${idx}_${Date.now()}`,
                xPct: Number(Math.max(1, Math.min(92, s.points[0].x / 10)).toFixed(2)),
                yPct: Number(Math.max(1, Math.min(92, s.points[0].y / 10)).toFixed(2)),
                text: s.text,
                color: s.color || '#EF4444',
                fontSize: 16
              });
            } else {
              remainingStrokes.push(s);
            }
          });
          parsedStudentSlideDrawings[slideKey] = JSON.stringify(remainingStrokes);
          parsedStudentSlideTextAnnotations[slideKey] = migratedTextAnns;
          const numKey = Number(slideKey);
          if (!isNaN(numKey)) {
            parsedStudentSlideTextAnnotations[numKey] = migratedTextAnns;
          }
        }
      } catch {}
    });

    setStudentSlideDrawingsMap(parsedStudentSlideDrawings);
    setStudentSlideTextAnnotationsMap(parsedStudentSlideTextAnnotations);

    setNotesTitle(savedTitle || '');
    setSaveStatus('');
    
    // Cache last active presentation details for note recovery upon session termination
    if (activePresentationId) {
      localStorage.setItem('activeDeckLastSessionId', activePresentationId);
      if (presentation?.pinCode) {
        localStorage.setItem('activeDeckLastSessionPin', presentation.pinCode);
      }
      if (presentation?.presenterEmail) {
        localStorage.setItem('activeDeckLastPresenterEmail', presentation.presenterEmail);
      }
    }

    // Set active tab to presentation's current slide or default to '1'
    const initialSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
      ? String(presentation.currentSlide) 
      : '1';
    setActiveTab(initialSlide);
  }, [activePresentationId]);

  // Keep last active presentation info always up to date in localStorage as presentation loads
  useEffect(() => {
    if (presentation?.id) {
      localStorage.setItem('activeDeckLastSessionId', presentation.id);
      if (presentation.pinCode) {
        localStorage.setItem('activeDeckLastSessionPin', presentation.pinCode);
      }
      if (presentation.presenterEmail) {
        localStorage.setItem('activeDeckLastPresenterEmail', presentation.presenterEmail);
      }
    }
  }, [presentation?.id, presentation?.pinCode, presentation?.presenterEmail]);

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
    const savedStudentSlideDrawings = localStorage.getItem(`activeDeckStudentSlideDrawings_${activePresentationId}`) || '';
    const savedStudentSlideTextAnnotations = localStorage.getItem(`activeDeckStudentSlideTextAnnotations_${activePresentationId}`) || '';
    const savedTitle = localStorage.getItem(`activeDeckNotesTitle_${activePresentationId}`) || '';
    
    const currentNotesRaw = JSON.stringify(notesTextMap);
    const currentStudentSlideDrawingsRaw = JSON.stringify(studentSlideDrawingsMap);
    const currentStudentSlideTextAnnotationsRaw = JSON.stringify(studentSlideTextAnnotationsMap);
    
    // Check if anything actually changed to avoid redundant saves and flicker
    let isSameNotes = false;
    try {
      const parsedSaved = JSON.parse(savedNotes);
      isSameNotes = JSON.stringify(parsedSaved) === currentNotesRaw;
    } catch (e) {
      isSameNotes = false;
    }

    let isSameStudentSlideDrawings = false;
    try {
      const parsedSaved = JSON.parse(savedStudentSlideDrawings);
      isSameStudentSlideDrawings = JSON.stringify(parsedSaved) === currentStudentSlideDrawingsRaw;
    } catch (e) {
      isSameStudentSlideDrawings = false;
    }

    let isSameStudentSlideTextAnnotations = false;
    try {
      const parsedSaved = JSON.parse(savedStudentSlideTextAnnotations);
      isSameStudentSlideTextAnnotations = JSON.stringify(parsedSaved) === currentStudentSlideTextAnnotationsRaw;
    } catch (e) {
      isSameStudentSlideTextAnnotations = false;
    }

    if (
      isSameNotes &&
      isSameStudentSlideDrawings &&
      isSameStudentSlideTextAnnotations &&
      notesTitle === savedTitle
    ) {
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(() => {
      localStorage.setItem(`activeDeckNotes_${activePresentationId}`, currentNotesRaw);
      localStorage.setItem(`activeDeckStudentSlideDrawings_${activePresentationId}`, currentStudentSlideDrawingsRaw);
      localStorage.setItem(`activeDeckStudentSlideTextAnnotations_${activePresentationId}`, currentStudentSlideTextAnnotationsRaw);
      localStorage.setItem(`activeDeckNotesTitle_${activePresentationId}`, notesTitle);
      setSaveStatus('saved');
      
      const resetTimer = setTimeout(() => setSaveStatus(''), 2000);
      return () => clearTimeout(resetTimer);
    }, 500);

    return () => clearTimeout(timer);
  }, [notesTextMap, studentSlideDrawingsMap, studentSlideTextAnnotationsMap, notesTitle, activePresentationId]);

  const handleDownloadNotes = async () => {
    if (!activePresentationId) return;
    const success = await exportNotesToDocx({
      presentationId: activePresentationId,
      pinCode: presentation?.pinCode,
      presenterEmail: presentation?.presenterEmail,
      notesTitle,
      notesTextMap,
      studentSlideDrawingsMap,
      studentSlideTextAnnotationsMap,
      pushedSlidesMap,
      presenterDrawingsMap: presentation?.presenterDrawings,
      customTabs
    });
    if (!success) {
      alert("Nothing to export. Connect to a presentation or take some notes first!");
    }
  };



  const handleSavePresenterEmail = async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }

    setEmailDomainError(null);
    setCheckingEmailDomain(true);

    let savedDecksFromPresenter: DeckItem[] = [];
    try {
      // Step 1: Check Whitelisted Presenters
      const presenterRef = doc(db, 'whitelistedPresenters', trimmed);
      const presenterSnap = await getDoc(presenterRef);
      if (!presenterSnap.exists()) {
        setEmailDomainError("Access Denied: Your email is not registered as an authorized presenter. Please contact justin.zumwalt@okstate.edu to be whitelisted.");
        setCheckingEmailDomain(false);
        return;
      }

      if (Array.isArray(presenterSnap.data().savedDecks)) {
        savedDecksFromPresenter = presenterSnap.data().savedDecks;
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
    localStorage.setItem('activeDeckLastPresenterEmail', trimmed);
    setPresenterEmail(trimmed);
    setCheckingEmailDomain(false);

    const targetPresentationId = presentation?.id || activePresentationId;
    if (targetPresentationId) {
      try {
        const updates: any = {
          presenterEmail: trimmed
        };
        if (savedDecksFromPresenter.length > 0 && (!presentation?.uploadedDecks || presentation.uploadedDecks.length === 0)) {
          updates.uploadedDecks = savedDecksFromPresenter;
          if (!presentation?.pptxUrl) {
            const lastSelectedId = sessionStorage.getItem('activeDeckSelectedId') || (trimmed ? localStorage.getItem(`activeDeckLastSelectedDeckId_${trimmed}`) : null);
            const targetDeck = (lastSelectedId && savedDecksFromPresenter.find((d: any) => d.id === lastSelectedId)) || savedDecksFromPresenter[0];
            updates.pptxUrl = targetDeck.url;
            updates.pptxFileName = targetDeck.name;
            updates.selectedDeckId = targetDeck.id;
          }
        }
        await updateDoc(doc(db, 'presentations', targetPresentationId), updates);
      } catch (err) {
        console.error('Failed to update presenter email and sync decks in presentation document:', err);
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
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (parsed === 440) return 320;
      return !isNaN(parsed) && parsed >= 280 ? parsed : 320;
    }
    return 320;
  });

  const [audienceChatWidth, setAudienceChatWidth] = useState(() => {
    const saved = localStorage.getItem('activeDeckAudienceChatWidth');
    return saved ? Math.max(250, parseInt(saved, 10)) : 380;
  });

  const [isFullscreen, setIsFullscreen] = useState(false);

  const [viewingAsEmail, setViewingAsEmail] = useState<string | null>(() => {
    return sessionStorage.getItem('activeDeckViewingAs') || null;
  });

  const handleExitViewAs = () => {
    const original = sessionStorage.getItem('activeDeckAdminOriginalEmail') || 'justin.zumwalt@okstate.edu';
    sessionStorage.setItem('activePresenterEmail', original);
    localStorage.setItem('activeDeckLastPresenterEmail', original);
    sessionStorage.removeItem('activeDeckViewingAs');
    sessionStorage.removeItem('activeDeckAdminOriginalEmail');
    window.location.hash = '#admin';
    window.location.reload();
  };

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

  // Listen for close-projector broadcast in Projector Mode and broadcast liveness
  useEffect(() => {
    if (!isProjector) return;
    console.log('AppContent - Projector Mode: Listening for close-projector broadcast & announcing liveness');
    const channel = new BroadcastChannel('activedeck-stream');

    // Announce immediately that projector window is open and deployed
    channel.postMessage({ type: 'projector-alive' });

    // Send periodic heartbeat every 2 seconds
    const heartbeatTimer = setInterval(() => {
      try {
        channel.postMessage({ type: 'projector-alive' });
      } catch (e) {}
    }, 2000);

    channel.onmessage = (event) => {
      if (event.data?.type === 'close-projector') {
        console.log('AppContent - Closing projector window as requested by presenter');
        window.close();
      } else if (event.data?.type === 'projector-ping') {
        try {
          channel.postMessage({ type: 'projector-alive' });
        } catch (e) {}
      }
    };

    const handleBeforeUnload = () => {
      try {
        channel.postMessage({ type: 'projector-closed' });
      } catch (e) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(heartbeatTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      try {
        channel.postMessage({ type: 'projector-closed' });
      } catch (e) {}
      channel.close();
    };
  }, [isProjector]);

  // Listen for session-ended broadcast on same-origin tabs (forces student notes page to restart session)
  useEffect(() => {
    if (!isChatOnly) return;
    try {
      const channel = new BroadcastChannel('activedeck-session');
      channel.onmessage = (event) => {
        if (event.data?.type === 'session-ended') {
          if (!activePresentationId || !event.data.presentationId || event.data.presentationId === activePresentationId) {
            console.log('AppContent - Received session-ended broadcast. Forcing student to Join Screen for new session.');
            const endingId = event.data?.presentationId || activePresentationId || localStorage.getItem('activeDeckJoinedPresentationId');
            if (endingId) {
              localStorage.setItem('activeDeckLastSessionId', endingId);
            }
            if (presentation?.pinCode) {
              localStorage.setItem('activeDeckLastSessionPin', presentation.pinCode);
            }
            if (presentation?.presenterEmail) {
              localStorage.setItem('activeDeckLastPresenterEmail', presentation.presenterEmail);
            }
            localStorage.removeItem('activeDeckJoined');
            localStorage.removeItem('activeDeckJoinedPresentationId');
            setHasJoinedChat(false);
            setPresentation(null);
            setActivePresentationId(null);
            window.location.href = window.location.origin + '/chat?session_ended=true';
          }
        }
      };
      return () => {
        channel.close();
      };
    } catch (e) {}
  }, [isChatOnly, activePresentationId, presentation]);

  // Listen for clear-all-drawings broadcast when presentation stops
  useEffect(() => {
    try {
      const channel = new BroadcastChannel('activedeck-presenter-drawing');
      channel.onmessage = (event) => {
        if (event.data?.type === 'clear-all-drawings') {
          console.log('AppContent - Received clear-all-drawings broadcast');
          setPresentation(prev => prev ? { ...prev, presenterDrawings: {} } : null);
        }
      };
      return () => {
        channel.close();
      };
    } catch (e) {}
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
  const isDraggingAudienceChatRef = useRef(false);
  const isDraggingNotesSplitRef = useRef(false);
  const notesContainerRef = useRef<HTMLDivElement>(null);
  const desktopPreviewFrameRef = useRef<HTMLDivElement>(null);
  const mobilePreviewFrameRef = useRef<HTMLDivElement>(null);
  const chatLayoutDirectionRef = useRef(chatLayoutDirection);
  const activeSlidePreviewUrl = getSlidePreviewUrl(activeTab);
  const desktopPreviewBounds = useRenderedSlideBounds(desktopPreviewFrameRef, [activeTab, activeSlidePreviewUrl]);
  const mobilePreviewBounds = useRenderedSlideBounds(mobilePreviewFrameRef, [activeTab, activeSlidePreviewUrl]);

  useEffect(() => {
    chatLayoutDirectionRef.current = chatLayoutDirection;
  }, [chatLayoutDirection]);

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

  const handleMouseDownAudienceChat = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingAudienceChatRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDoubleClickProjector = () => {
    setSidebarWidth(380);
    localStorage.setItem('activeDeckProjectorSidebarWidth', '380');
  };

  const handleDoubleClickPresenter = () => {
    setPresenterSidebarWidth(320);
    localStorage.setItem('activeDeckPresenterSidebarWidth', '320');
  };

  const handleDoubleClickAudienceChat = () => {
    setAudienceChatWidth(380);
    localStorage.setItem('activeDeckAudienceChatWidth', '380');
  };

  const handleMouseDownNotesSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingNotesSplitRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleDoubleClickNotesSplit = () => {
    setNotesSplitRatio(60);
    localStorage.setItem('activeDeckNotesSplitRatio', '60');
  };

  const handleTouchStartProjector = () => {
    isDraggingProjectorRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartPresenter = () => {
    isDraggingPresenterRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartAudienceChat = () => {
    isDraggingAudienceChatRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartNotesSplit = () => {
    isDraggingNotesSplitRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleDragMove = (clientX: number) => {
      // 1. Projector Sidebar Dragging
      if (isDraggingProjectorRef.current) {
        const containerPadding = 24; // p-6 is 24px
        const calculatedWidth = window.innerWidth - clientX - containerPadding;
        const constrainedWidth = Math.max(260, Math.min(600, calculatedWidth));
        setSidebarWidth(constrainedWidth);
        localStorage.setItem('activeDeckProjectorSidebarWidth', constrainedWidth.toString());
      }

      // 2. Presenter Sidebar Dragging
      if (isDraggingPresenterRef.current) {
        const containerPadding = 24; // p-6 is 24px
        const calculatedWidth = window.innerWidth - clientX - containerPadding;
        const constrainedWidth = Math.max(280, Math.min(650, calculatedWidth));
        setPresenterSidebarWidth(constrainedWidth);
        localStorage.setItem('activeDeckPresenterSidebarWidth', constrainedWidth.toString());
      }

      // 3. Audience Chat Sidebar Dragging
      if (isDraggingAudienceChatRef.current) {
        const calculatedWidth = chatLayoutDirectionRef.current === 'right'
          ? window.innerWidth - clientX
          : clientX;
        const constrainedWidth = Math.max(250, Math.min(600, calculatedWidth));
        setAudienceChatWidth(constrainedWidth);
        localStorage.setItem('activeDeckAudienceChatWidth', constrainedWidth.toString());
      }

      // 4. Notes & Slide Preview Split Dragging
      if (isDraggingNotesSplitRef.current && notesContainerRef.current) {
        const rect = notesContainerRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          const relativeX = clientX - rect.left;
          const calculatedRatio = (relativeX / rect.width) * 100;
          const constrainedRatio = Math.max(20, Math.min(80, calculatedRatio));
          setNotesSplitRatio(constrainedRatio);
          localStorage.setItem('activeDeckNotesSplitRatio', constrainedRatio.toString());
        }
      }
    };

    const handleDragEnd = () => {
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
      if (isDraggingAudienceChatRef.current) {
        isDraggingAudienceChatRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      if (isDraggingNotesSplitRef.current) {
        isDraggingNotesSplitRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX);
    };

    const handleMouseUp = () => {
      handleDragEnd();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (
        isDraggingProjectorRef.current ||
        isDraggingPresenterRef.current ||
        isDraggingAudienceChatRef.current ||
        isDraggingNotesSplitRef.current
      ) {
        if (e.cancelable) {
          e.preventDefault();
        }
        if (e.touches.length > 0) {
          handleDragMove(e.touches[0].clientX);
        }
      }
    };

    const handleTouchEnd = () => {
      handleDragEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
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
            const data = docSnap.data();
            
            // If presentation has ended or is inactive, force student/viewer back to Join Screen
            if (data.isEnded === true || data.active === false) {
              console.log('AppContent - Active presentation has ended. Forcing student to Join Screen for new session.');
              const endingId = activePresentationId || docSnap.id || localStorage.getItem('activeDeckJoinedPresentationId');
              if (endingId) {
                localStorage.setItem('activeDeckLastSessionId', endingId);
              }
              if (data.pinCode || presentation?.pinCode) {
                localStorage.setItem('activeDeckLastSessionPin', data.pinCode || presentation?.pinCode);
              }
              if (data.presenterEmail || presentation?.presenterEmail) {
                localStorage.setItem('activeDeckLastPresenterEmail', data.presenterEmail || presentation?.presenterEmail);
              }
              localStorage.removeItem('activeDeckJoined');
              localStorage.removeItem('activeDeckJoinedPresentationId');
              setHasJoinedChat(false);
              setPresentation(null);
              setActivePresentationId(null);
              if (isChatOnly) {
                window.location.href = window.location.origin + '/chat?session_ended=true';
              }
              setPresentationLoaded(true);
              return;
            }

            console.log('AppContent - Presentation data received:', docSnap.id);
            setPresentation({ id: docSnap.id, ...data } as Presentation);
            if (docSnap.id) {
              localStorage.setItem('activeDeckLastSessionId', docSnap.id);
            }
            if (data.pinCode) {
              localStorage.setItem('activeDeckLastSessionPin', data.pinCode);
            }
            if (data.presenterEmail) {
              localStorage.setItem('activeDeckLastPresenterEmail', data.presenterEmail);
            }
            ensurePresentationHasPin(docSnap.id, data);
            const localEmail = sessionStorage.getItem('activePresenterEmail');
            if (localEmail && !data.presenterEmail) {
              updateDoc(docRef, { presenterEmail: localEmail }).catch(err => 
                console.error('Failed to sync local email to loaded presentation:', err)
              );
            }
          } else {
            console.warn('AppContent - Presentation not found or deleted:', activePresentationId);
            setPresentation(null);
            if (isChatOnly) {
              localStorage.removeItem('activeDeckJoined');
              localStorage.removeItem('activeDeckJoinedPresentationId');
              setHasJoinedChat(false);
              setActivePresentationId(null);
              window.location.href = window.location.origin + '/chat?session_ended=true';
            }
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
              const data = docSnap.data();
              if (data.isEnded === true || data.active === false) {
                console.warn('AppContent - Cached presentation was ended. Cleaning cache.');
                sessionStorage.removeItem('activePresenterPresentationId');
                setActivePresentationId(null);
                setPresentation(null);
                setPresentationLoaded(true);
                return;
              }

              console.log('AppContent - Cached presentation exists in Firestore. Setting active:', docSnap.id);
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
      <div className="flex flex-row h-full w-full overflow-hidden bg-slate-950 font-sans antialiased p-1.5 sm:p-2 gap-2 relative group">
        {/* Giant Slide Presentation Area */}
        <div className="flex-1 h-full min-w-0 rounded-xl overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl">
          <PresenterArea 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            isProjectorMode={true}
          />
        </div>

        {presentation?.chatEnabled !== false && (
          <>
            {/* Interactive Drag Splitter */}
            <div 
              onMouseDown={handleMouseDownProjector}
              onTouchStart={handleTouchStartProjector}
              onDoubleClick={handleDoubleClickProjector}
              className="w-3 h-full cursor-col-resize flex items-center justify-center flex-shrink-0 group/splitter select-none"
              title="Drag to resize sidebar (double-click to reset)"
            >
              <div className="w-[3px] h-20 bg-slate-800 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
            </div>

            {/* Expanded Read-Only Sidebar Q&A Display */}
            <div 
              style={{ width: `${sidebarWidth}px`, minWidth: '260px' }}
              className="h-full flex-shrink-0 rounded-xl overflow-hidden border-2 border-osu-orange bg-slate-900 shadow-2xl"
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
          </>
        )}

        {/* Floating Glassmorphic Fullscreen Toggle Button */}
        <div className="absolute bottom-6 left-6 z-[100] flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-auto">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-3 rounded-full bg-slate-900/80 hover:bg-osu-orange border border-slate-800 hover:border-osu-orange text-slate-400 hover:text-white shadow-2xl transition-all duration-300 backdrop-blur-md cursor-pointer flex items-center justify-center hover:scale-110 active:scale-95 outline-none"
            title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen (or press F11)"}
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>
    );
  }

  // Chat-only view for audience members who scanned the QR code
  if (isChatOnly) {
    if (isMobile) {
      const isLight = studentTheme === 'light';
      return (
        <>
          <div className={`h-full w-full flex flex-col font-sans antialiased overflow-hidden transition-colors duration-200 ${
            isLight ? 'light-mode bg-[#F8FAFC] text-slate-900' : 'dark-mode bg-[#0B0F19] text-slate-100'
          }`}>
            {/* Pinned Slide Preview Container at the Top of Viewport */}
            {true && (
              <div className={`w-full shrink-0 border-b relative z-20 shadow-lg ${
                isLight ? 'bg-white border-slate-200' : 'bg-slate-950 border-slate-900'
              }`}>
                <div 
                  className="w-full aspect-[16/9] max-h-[25vh] bg-black select-none relative group overflow-hidden"
                  onClick={() => {
                    const previewUrl = getSlidePreviewUrl(activeTab);
                    if (previewUrl) {
                      setLightboxImgUrl(previewUrl);
                      setIsLightboxOpen(true);
                    }
                  }}
                  title={getSlidePreviewUrl(activeTab) ? `Slide ${activeTab} Preview (Tap to Zoom)` : "No slide preview shared yet"}
                >
                  {getSlidePreviewUrl(activeTab) ? (
                    <div ref={mobilePreviewFrameRef} className="relative w-full h-full flex items-center justify-center cursor-zoom-in bg-black">
                      <img 
                        src={getSlidePreviewUrl(activeTab)} 
                        alt={`Slide ${activeTab} Preview`}
                        className="w-full h-full object-contain pointer-events-none"
                      />
                      {/* Drawing Overlay - positioned using calculated bounds */}
                      <div 
                        className="absolute pointer-events-none"
                        style={{
                          top: mobilePreviewBounds.offsetY,
                          left: mobilePreviewBounds.offsetX,
                          width: mobilePreviewBounds.renderedWidth > 0 ? mobilePreviewBounds.renderedWidth : '100%',
                          height: mobilePreviewBounds.renderedHeight > 0 ? mobilePreviewBounds.renderedHeight : '100%',
                        }}
                      >
                      {/* Presenter Live Slide Drawing Layer */}
                      {(() => {
                        const drawingsJson = presentation?.presenterDrawings?.[activeTab];
                        if (!drawingsJson) return null;
                        try {
                          const strokes: DrawingStroke[] = JSON.parse(drawingsJson);
                          if (!Array.isArray(strokes) || strokes.length === 0) return null;
                          return (
                            <svg
                              viewBox="0 0 1000 1000"
                              preserveAspectRatio="none"
                              className="w-full h-full pointer-events-none z-10"
                              style={{ filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
                            >
                              {strokes.map((stroke, idx) => {
                                if (stroke.text) {
                                  const pt = stroke.points[0];
                                  if (!pt) return null;
                                  const fontSize = Math.max(26, stroke.width * 5);
                                  return (
                                    <text
                                      key={`mobile-preview-text-${idx}`}
                                      x={pt.x}
                                      y={pt.y}
                                      fill={stroke.color}
                                      fontSize={fontSize}
                                      fontWeight="bold"
                                      fontFamily="sans-serif"
                                    >
                                      {stroke.text}
                                    </text>
                                  );
                                }
                                const pathD = getStrokePath(stroke);
                                if (!pathD) return null;
                                return (
                                  <path
                                    key={`mobile-preview-stroke-${idx}`}
                                    d={pathD}
                                    stroke={stroke.color}
                                    strokeWidth={stroke.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill="none"
                                    opacity={stroke.isHighlighter ? 0.25 : 1}
                                  />
                                );
                              })}
                            </svg>
                          );
                        } catch {
                          return null;
                        }
                      })()}
                      {/* Student Personal Slide Markings Layer */}
                      {(() => {
                        const studentJson = studentSlideDrawingsMap[activeTab];
                        if (!studentJson) return null;
                        try {
                          const strokes: DrawingStroke[] = JSON.parse(studentJson);
                          if (!Array.isArray(strokes) || strokes.length === 0) return null;
                          return (
                            <svg
                              viewBox="0 0 1000 1000"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none z-20"
                              style={{ filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
                            >
                              {strokes.map((stroke, idx) => {
                                if (stroke.text) {
                                  const pt = stroke.points[0];
                                  if (!pt) return null;
                                  const fontSize = Math.max(26, stroke.width * 5);
                                  return (
                                    <text
                                      key={`mobile-student-text-${idx}`}
                                      x={pt.x}
                                      y={pt.y}
                                      fill={stroke.color}
                                      fontSize={fontSize}
                                      fontWeight="bold"
                                      fontFamily="sans-serif"
                                    >
                                      {stroke.text}
                                    </text>
                                  );
                                }
                                const pathD = getStrokePath(stroke);
                                if (!pathD) return null;
                                return (
                                  <path
                                    key={`mobile-student-stroke-${idx}`}
                                    d={pathD}
                                    stroke={stroke.color}
                                    strokeWidth={stroke.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill="none"
                                    opacity={stroke.isHighlighter ? 0.25 : 1}
                                  />
                                );
                              })}
                            </svg>
                          );
                        } catch {
                          return null;
                        }
                      })()}
                      {/* Student Personal Slide Text Annotations Layer */}
                      {(() => {
                        const slideTextAnns = getSlideTextAnnotationsForSlide(studentSlideTextAnnotationsMap, activeTab);
                        if (!slideTextAnns || slideTextAnns.length === 0) return null;
                        const previewWidth = mobilePreviewBounds.renderedWidth || 320;
                        const scaleRatio = Math.max(0.28, Math.min(1, previewWidth / 960));
                        return (
                          <div className="absolute inset-0 w-full h-full pointer-events-none z-30 overflow-hidden">
                            {slideTextAnns.map((ann) => {
                              if (!ann.text || !ann.text.trim()) return null;
                              const isDarkInk = (ann.color || '').trim().toUpperCase() === '#000000';
                              const fontSizePx = Math.max(7, Math.round((ann.fontSize || 16) * scaleRatio));
                              return (
                                <div
                                  key={ann.id}
                                  style={{
                                    left: `${ann.xPct}%`,
                                    top: `${ann.yPct}%`,
                                    color: ann.color || '#EF4444',
                                    fontSize: `${fontSizePx}px`,
                                    lineHeight: 1.25,
                                  }}
                                  className={`absolute font-sans font-bold whitespace-pre-wrap break-words px-1 py-0.5 rounded shadow-md border max-w-[80%] ${
                                    isDarkInk
                                      ? 'bg-white/95 border-slate-400/90'
                                      : 'bg-slate-950/90 border-white/25'
                                  }`}
                                >
                                  {ann.text}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      </div>
                      {/* Floating badge */}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 border border-white/10 text-white text-[9px] font-bold">
                        Slide {activeTab}
                      </div>
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-osu-orange text-white text-[9px] font-bold uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-md">
                        <Pen className="w-2.5 h-2.5 shrink-0" />
                        <ZoomIn className="w-2.5 h-2.5 shrink-0" />
                        <span>Click Slide to Annotate &amp; Zoom</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-3 text-slate-500">
                      <Tv className="w-6 h-6 text-slate-700 mb-1" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-none">Slide {activeTab}</span>
                      <span className="text-[8px] font-bold text-slate-600 uppercase leading-none mt-1">No Preview Available</span>
                    </div>
                  )}
                </div>

                {/* Slide Out-of-Sync Alert for Mobile */}
                {presentation && presentation.currentSlide !== undefined && presentation.currentSlide !== null && String(presentation.currentSlide) !== activeTab && (
                  <div className={`flex items-center justify-between p-2 border-t text-[9px] ${
                    isLight ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-orange-500/10 border-orange-500/20 text-orange-200'
                  }`}>
                    <span className="flex items-center gap-1 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                      Presenter is on Slide {presentation.currentSlide}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab(String(presentation.currentSlide))}
                      className="px-2 py-0.5 rounded bg-osu-orange text-white font-bold uppercase tracking-wider text-[8px] hover:bg-[#c03900] active:scale-95 transition-all cursor-pointer"
                    >
                      Sync Slide {presentation.currentSlide}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Dual Tab Switcher Button Group */}
            {presentation?.chatEnabled !== false && (
              <div className={`flex border-b shrink-0 p-1 relative z-20 shadow-sm ${
                isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
              }`}>
                <button
                  type="button"
                  onClick={() => setMobileTab('chat')}
                  className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mobileTab === 'chat'
                      ? 'bg-osu-orange text-white shadow-md'
                      : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setMobileTab('notes')}
                  className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mobileTab === 'notes'
                      ? 'bg-osu-orange text-white shadow-md'
                      : isLight ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <NotebookPen className="w-3.5 h-3.5" />
                  Notes
                </button>
              </div>
            )}

            {/* Content Area Underneath Switcher */}
            <div className={`flex-1 min-h-0 flex flex-col relative z-10 ${isLight ? 'bg-[#F8FAFC]' : 'bg-[#0B0F19]'}`}>
              {mobileTab === 'chat' && presentation?.chatEnabled !== false ? (
                <div className={`w-full h-full relative flex-1 flex flex-col min-h-0 ${isLight ? 'bg-[#FFFFFF]' : 'bg-[#111827]'}`}>
                  <ChatSidebar 
                    isChatOnly={true} 
                    presentation={presentation} 
                    logoUrl={settings?.theme.logoUrl} 
                    presentationLoaded={presentationLoaded} 
                    showAttendance={settings?.showAttendance}
                    onJoinChange={setHasJoinedChat}
                    themeMode={studentTheme}
                  />
                </div>
              ) : (
                <div className={`flex-1 flex flex-col min-h-0 p-2.5 overflow-y-auto custom-scrollbar ${
                  isLight ? 'bg-[#F8FAFC]' : 'bg-gradient-to-br from-slate-900 via-[#0B0F19] to-slate-900'
                }`}>
                  {!hasJoinedChat && presentation?.chatEnabled !== false ? (
                    <div className={`flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 rounded-2xl border ${
                      isLight ? 'bg-[#FFFFFF] border-slate-200' : 'bg-slate-900/40 border-slate-800'
                    }`}>
                      <div className="w-12 h-12 rounded-2xl bg-osu-orange/10 border border-osu-orange/20 flex items-center justify-center text-osu-orange shadow-lg">
                        <Lock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="space-y-1.5 max-w-xs">
                        <h3 className={`text-sm font-black uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>Notes Locked</h3>
                        <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                          Join the discussion by entering your name and email in the Chat tab to unlock real-time, slide-by-slide note-taking.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex-1 flex flex-col space-y-2 min-h-0 p-2.5 rounded-2xl border ${
                      isLight ? 'bg-[#FFFFFF] border-slate-200 shadow-sm' : 'bg-transparent border-transparent'
                    }`}>
                      {/* Compact Consolidated Mobile Notes Header */}
                      <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 border rounded-xl shrink-0 ${
                        isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/90 border-slate-800'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {isEditingNotesTitle ? (
                            <input
                              type="text"
                              autoFocus
                              value={notesTitle}
                              onChange={(e) => setNotesTitle(e.target.value)}
                              onBlur={() => setIsEditingNotesTitle(false)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  setIsEditingNotesTitle(false);
                                }
                              }}
                              placeholder="Untitled Notes"
                              className={`h-7 px-2 text-xs font-bold border border-osu-orange rounded-md focus:outline-none min-w-0 flex-1 ${
                                isLight ? 'bg-white text-slate-900 placeholder-slate-400' : 'bg-slate-800 text-slate-100 placeholder-slate-500'
                              }`}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setIsEditingNotesTitle(true)}
                              className={`group flex items-center gap-1.5 px-1.5 py-1 rounded-md transition-colors text-left min-w-0 max-w-full cursor-pointer ${
                                isLight ? 'hover:bg-slate-200/70' : 'hover:bg-slate-800'
                              }`}
                              title="Click to rename notes"
                            >
                              <span className={`text-xs font-bold truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                                {notesTitle.trim() || 'Untitled Notes'}
                              </span>
                              <Edit3 className="w-3 h-3 text-slate-500 group-hover:text-osu-orange shrink-0" />
                            </button>
                          )}
                          {saveStatus && (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 transition-all duration-300 ${
                              saveStatus === 'saving'
                                ? 'text-slate-400 animate-pulse'
                                : isLight
                                  ? 'text-green-700 bg-green-100 border border-green-300'
                                  : 'text-green-400 bg-green-500/10 border border-green-500/20'
                            }`}>
                              {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={toggleStudentTheme}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
                              isLight
                                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                            }`}
                            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                          >
                            {isLight ? <Moon className="w-3 h-3 text-slate-700" /> : <Sun className="w-3 h-3 text-amber-400" />}
                          </button>
                          <button
                            type="button"
                            onClick={handleAddCustomTab}
                            className={`flex items-center gap-1 px-2 py-1 text-[9px] font-bold border rounded-lg transition-all cursor-pointer active:scale-95 ${
                              isLight
                                ? 'text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-200'
                                : 'text-purple-300 bg-purple-950/80 hover:bg-purple-900 border-purple-500/40 hover:border-purple-400'
                            }`}
                            title="Add a new blank note tab"
                          >
                            <Plus className="w-2.5 h-2.5 text-purple-500" />
                            <span>Blank Note</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleDownloadNotes}
                            disabled={isNotesEmpty(notesTextMap, studentSlideDrawingsMap, studentSlideTextAnnotationsMap) && Object.keys(pushedSlidesMap).length === 0}
                            className={`flex items-center gap-1 px-2 py-1 text-[9px] font-bold disabled:opacity-40 disabled:cursor-not-allowed border hover:border-osu-orange/50 rounded-lg transition-all cursor-pointer ${
                              isLight
                                ? 'text-slate-800 bg-white hover:bg-slate-100 border-slate-200'
                                : 'text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 border-slate-700'
                            }`}
                            title="Export notes as Word document (.docx)"
                          >
                            <Download className="w-3 h-3 text-osu-orange" />
                            <span>Export</span>
                          </button>
                        </div>
                      </div>

                      {/* Compact Slides Overview Bar for Mobile */}
                      {(() => {
                        const slidesWithNotes = Array.from(new Set([
                          ...Object.keys(notesTextMap),
                          ...Object.keys(studentSlideDrawingsMap),
                          ...Object.keys(studentSlideTextAnnotationsMap).map(String)
                        ])).filter(slide => {
                          const html = notesTextMap[slide];
                          const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';

                          const slideDrawingJson = studentSlideDrawingsMap[slide];
                          let hasSlideDrawing = false;
                          try {
                            if (slideDrawingJson) {
                              const strokes = JSON.parse(slideDrawingJson);
                              hasSlideDrawing = Array.isArray(strokes) && strokes.length > 0;
                            }
                          } catch {}

                          const slideTextAnns = getSlideTextAnnotationsForSlide(studentSlideTextAnnotationsMap, slide);
                          const hasSlideTextAnns = slideTextAnns.some(a => a.text && a.text.trim() !== '');
                          
                          return hasText || hasSlideDrawing || hasSlideTextAnns;
                        });
                        
                        const presenterSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
                          ? String(presentation.currentSlide) 
                          : '1';
                        
                        const maxSlide = Math.max(
                          1,
                          maxSlideSeen,
                          presentation?.currentSlide || 1,
                          ...Object.keys(notesTextMap).map(Number).filter(n => !isNaN(n)),
                          ...Object.keys(studentSlideDrawingsMap).map(Number).filter(n => !isNaN(n)),
                          ...Object.keys(studentSlideTextAnnotationsMap).map(Number).filter(n => !isNaN(n)),
                          ...Object.keys(pushedSlidesMap).map(Number).filter(n => !isNaN(n))
                        );

                        const allTabs: Array<{ id: string; label: string; position: number; isCustom: boolean }> = [];
                        for (let i = 1; i <= maxSlide; i++) {
                          allTabs.push({
                            id: String(i),
                            label: `Slide ${i}`,
                            position: i,
                            isCustom: false
                          });
                        }

                        customTabs.forEach(ct => {
                          allTabs.push({
                            id: ct.id,
                            label: ct.label,
                            position: ct.position,
                            isCustom: true
                          });
                        });

                        allTabs.sort((a, b) => a.position - b.position);

                        return (
                          <div className="w-full max-h-16 overflow-y-auto px-1 custom-scrollbar shrink-0">
                            <div className="flex flex-row flex-wrap items-center gap-1 py-0.5 select-none">
                              {allTabs.map(tab => {
                                const isCurrentTab = tab.id === activeTab;
                                const isPresenterSlide = tab.id === presenterSlide;
                                const hasContent = slidesWithNotes.includes(tab.id);

                                if (tab.isCustom) {
                                  return (
                                    <button
                                      key={tab.id}
                                      type="button"
                                      onClick={() => setActiveTab(tab.id)}
                                      className={`px-2 py-0.5 text-[9px] font-bold rounded border transition-all flex items-center gap-1 cursor-pointer shrink-0 group ${
                                        isCurrentTab 
                                          ? 'bg-purple-600 border-purple-500 text-white shadow-sm font-bold'
                                          : isLight
                                            ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
                                            : 'bg-purple-950/80 border-purple-500/40 text-purple-200 hover:bg-purple-900 hover:border-purple-400 hover:text-white'
                                      }`}
                                      title={`Custom Note Tab: ${tab.label}`}
                                    >
                                      <FileText className="w-2.5 h-2.5 text-purple-400 shrink-0" />
                                      <span>{tab.label}</span>
                                      {hasContent && !isCurrentTab && (
                                        <span className="w-0.5 h-0.5 rounded-full bg-purple-400/80" />
                                      )}
                                      <span 
                                        onClick={(e) => handleDeleteCustomTab(tab.id, e)}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-purple-800/80 rounded transition-opacity ml-0.5 cursor-pointer"
                                        title="Delete note tab"
                                      >
                                        <X className="w-2 h-2 text-purple-300 hover:text-white" />
                                      </span>
                                    </button>
                                  );
                                }

                                return (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-2 py-0.5 text-[9px] font-bold rounded border transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                                      isCurrentTab 
                                        ? 'bg-osu-orange border-osu-orange text-white shadow-sm'
                                        : isLight
                                          ? 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    <span>{tab.label}</span>
                                    {isPresenterSlide && (
                                      <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse border border-green-300" />
                                    )}
                                    {!isPresenterSlide && hasContent && (
                                      <span className="w-0.5 h-0.5 rounded-full bg-orange-400/80" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Editor Area (Permanently locked to Typed Notes RichTextEditor) */}
                      <div className="flex-1 min-h-[200px] flex flex-col">
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
                          placeholder={`Type notes for Slide ${activeTab}...`}
                          className="flex-1"
                          editorTheme={studentTheme}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <ImageLightboxModal 
            isOpen={isLightboxOpen} 
            onClose={() => setIsLightboxOpen(false)} 
            imageUrl={lightboxImgUrl} 
            title={`Slide ${activeTab} Preview`} 
            drawingStrokesJson={presentation?.presenterDrawings?.[activeTab]}
            allowStudentDrawing={true}
            studentStrokesJson={studentSlideDrawingsMap[activeTab] || ''}
            onStudentStrokesChange={(newJson) => {
              setStudentSlideDrawingsMap(prev => ({
                ...prev,
                [activeTab]: newJson
              }));
            }}
            textAnnotations={getSlideTextAnnotationsForSlide(studentSlideTextAnnotationsMap, activeTab)}
            onTextAnnotationsChange={(newAnns) => handleUpdateSlideTextAnnotations(activeTab, newAnns)}
            onCompositePreviewUpdate={(dataUrl) => {
              setCompositedSlidePreviewsMap(prev => ({
                ...prev,
                [activeTab]: dataUrl
              }));
            }}
          />
        </>
      );
    }

    const isChatCollapsedEffective = isStudentChatCollapsed && hasJoinedChat;
    const isLight = studentTheme === 'light';

    return (
      <>
        <div className={`h-full w-full flex flex-col ${chatLayoutDirection === 'right' ? 'md:flex-row-reverse' : 'md:flex-row'} font-sans antialiased overflow-hidden transition-colors duration-200 ${
          isLight ? 'light-mode bg-[#F8FAFC] text-slate-900' : 'dark-mode bg-[#0B0F19] text-slate-100'
        }`}>
          {/* Chat Sidebar / Collapsible Vertical Rail */}
          {presentation?.chatEnabled !== false && (
            <>
              {isChatCollapsedEffective && (
                <div
                  onClick={() => toggleStudentChatCollapsed(false)}
                  className={`hidden md:flex w-11 h-full ${
                    chatLayoutDirection === 'right' ? 'border-l' : 'border-r'
                  } ${
                    isLight
                      ? 'bg-[#FFFFFF] hover:bg-slate-50 border-slate-200'
                      : 'bg-[#111827] hover:bg-slate-900 border-slate-800'
                  } flex-col items-center py-3 justify-between shrink-0 cursor-pointer select-none transition-colors group z-20`}
                  title="Expand ActiveDeck Chat"
                >
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStudentChatCollapsed(false);
                      }}
                      className={`p-1.5 rounded-lg group-hover:bg-osu-orange group-hover:text-white border group-hover:border-osu-orange transition-colors relative cursor-pointer ${
                        isLight
                          ? 'bg-slate-100 text-slate-600 border-slate-200'
                          : 'bg-slate-800/90 text-slate-300 border-slate-700'
                      }`}
                      title="Expand Chat"
                    >
                      {chatLayoutDirection === 'left' ? (
                        <ChevronsRight className="w-4 h-4" />
                      ) : (
                        <ChevronsLeft className="w-4 h-4" />
                      )}
                    </button>

                    {(chatUnreadInfo.unreadCount > 0 || chatUnreadInfo.hasActiveActivity) && (
                      <span
                        className="min-w-[20px] h-5 px-1.5 rounded-full bg-osu-orange text-white text-[10px] font-black flex items-center justify-center shadow-lg shadow-orange-500/30 animate-bounce"
                        title={chatUnreadInfo.hasActiveActivity ? 'Active Poll or Question in Chat!' : `${chatUnreadInfo.unreadCount} unread`}
                      >
                        {chatUnreadInfo.unreadCount > 0 ? chatUnreadInfo.unreadCount : '!'}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex items-center gap-2 -rotate-90 whitespace-nowrap">
                      <MessageSquare className="w-3.5 h-3.5 text-osu-orange shrink-0" />
                      <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
                        isLight ? 'text-slate-500 group-hover:text-slate-900' : 'text-slate-400 group-hover:text-slate-200'
                      }`}>
                        ActiveDeck Chat
                      </span>
                    </div>
                  </div>

                  <div className="w-2 h-2 rounded-full bg-green-500/80" title="Connected to Live Chat" />
                </div>
              )}

              <div 
                style={{ width: !hasJoinedChat ? '660px' : `${audienceChatWidth}px` }}
                className={`${isChatCollapsedEffective ? 'hidden' : 'w-full md:w-auto'} h-full ${
                  isLight ? 'bg-[#FFFFFF]' : 'bg-[#111827]'
                } relative flex-shrink-0 transition-all duration-300`}
              >
                <ChatSidebar 
                  isChatOnly={true} 
                  presentation={presentation} 
                  logoUrl={settings?.theme.logoUrl} 
                  presentationLoaded={presentationLoaded} 
                  showAttendance={settings?.showAttendance}
                  onJoinChange={setHasJoinedChat}
                  onCollapseChat={hasJoinedChat ? () => toggleStudentChatCollapsed(true) : undefined}
                  chatLayoutDirection={chatLayoutDirection}
                  isCollapsedRail={isChatCollapsedEffective}
                  onUnreadActivityChange={setChatUnreadInfo}
                  themeMode={studentTheme}
                />
              </div>

              {/* Interactive Drag Splitter */}
              {!isChatCollapsedEffective && (
                <div 
                  onMouseDown={handleMouseDownAudienceChat}
                  onTouchStart={handleTouchStartAudienceChat}
                  onDoubleClick={handleDoubleClickAudienceChat}
                  className={`hidden md:flex w-2.5 h-full cursor-col-resize items-center justify-center flex-shrink-0 group/splitter select-none border-l border-r ${
                    isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#0B0F19] border-slate-900'
                  }`}
                  title="Drag to resize chat (double-click to reset)"
                >
                  <div className={`w-[3px] h-20 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200 ${
                    isLight ? 'bg-slate-300' : 'bg-slate-800'
                  }`} />
                </div>
              )}
            </>
          )}

          {/* Main Notes & Slide Preview Workspace */}
          <div className={`hidden md:flex flex-1 h-full flex-col ${
            isLight
              ? `bg-[#F8FAFC] ${presentation?.chatEnabled !== false ? 'border-l border-slate-200' : ''}`
              : `bg-gradient-to-br from-slate-900 via-[#0B0F19] to-slate-900 ${presentation?.chatEnabled !== false ? 'border-l border-slate-800/80' : ''}`
          } p-3 md:p-4 relative overflow-hidden`}>
          {/* Ambient lighting glow */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-osu-orange/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="w-full space-y-2.5 relative z-10 animate-in fade-in zoom-in-95 duration-500 flex flex-col h-full min-h-0">
            {/* Consolidated Top Header Bar (Logo, Inline Click-to-Edit Notes Title, Save Status, Session Info, Theme Toggle, Export .docx) */}
            <div className={`flex items-center justify-between gap-3 px-3.5 py-2 border rounded-xl shrink-0 select-none ${
              isLight ? 'bg-[#FFFFFF] border-slate-200 shadow-sm' : 'bg-slate-900/90 border-slate-800/90 shadow-md'
            }`}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-6 h-6 p-1 rounded-lg border flex items-center justify-center shrink-0 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800/90 border-slate-700/80'
                }`}>
                  <img 
                    src={settings?.theme.logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
                    alt="Logo" 
                    className="max-w-full max-h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <span className={`text-[11px] font-black uppercase tracking-wider shrink-0 hidden lg:inline ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}>
                  ActiveDeck Notes
                </span>
                <span className={`hidden lg:inline ${isLight ? 'text-slate-300' : 'text-slate-700'}`}>/</span>

                {/* Inline Click-to-Edit Notes Title (Google Docs style) */}
                {hasJoinedChat || presentation?.chatEnabled === false ? (
                  <div className="flex items-center gap-2 min-w-0 flex-1 max-w-md">
                    {isEditingNotesTitle ? (
                      <input
                        type="text"
                        autoFocus
                        value={notesTitle}
                        onChange={(e) => setNotesTitle(e.target.value)}
                        onBlur={() => setIsEditingNotesTitle(false)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            setIsEditingNotesTitle(false);
                          }
                        }}
                        placeholder="Untitled Lecture Notes"
                        className={`h-7 px-2.5 text-xs font-bold border border-osu-orange rounded-lg focus:outline-none w-full max-w-[260px] ${
                          isLight ? 'bg-white text-slate-900 placeholder-slate-400' : 'bg-slate-800 text-slate-100 placeholder-slate-500'
                        }`}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsEditingNotesTitle(true)}
                        className={`group flex items-center gap-1.5 px-2 py-1 rounded-lg border border-transparent transition-all text-left min-w-0 max-w-[280px] cursor-pointer ${
                          isLight
                            ? 'hover:bg-slate-100 hover:border-slate-200'
                            : 'hover:bg-slate-800/90 hover:border-slate-700/80'
                        }`}
                        title="Click to rename notes title"
                      >
                        <span className={`text-xs font-bold truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {notesTitle.trim() || 'Untitled Lecture Notes'}
                        </span>
                        <Edit3 className="w-3 h-3 text-slate-500 group-hover:text-osu-orange shrink-0 transition-colors" />
                      </button>
                    )}

                    {saveStatus && (
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md shrink-0 transition-all duration-300 ${
                        saveStatus === 'saving'
                          ? 'text-slate-400 animate-pulse'
                          : isLight
                            ? 'text-green-700 bg-green-100 border border-green-300'
                            : 'text-green-400 bg-green-500/10 border border-green-500/20'
                      }`}>
                        {saveStatus === 'saving' ? 'Saving...' : 'Auto-saved'}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className={`text-xs font-black uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-white'}`}>ActiveDeck Notes</span>
                )}
              </div>

              {/* Right Controls: Session PIN, Current Slide, Light/Dark Toggle, Swap Sides, Export (.docx) */}
              <div className="flex items-center gap-2 shrink-0">
                {presentation && (
                  <div className={`hidden xl:flex items-center gap-3 text-[10px] px-2.5 py-1 rounded-lg border ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800/80'
                  }`}>
                    <div>
                      <span className="text-slate-500 uppercase font-black tracking-wider text-[8px] mr-1.5">PIN</span>
                      <span className="font-mono font-bold text-osu-orange text-xs">{presentation.pinCode || 'N/A'}</span>
                    </div>
                    <div className={`h-3.5 w-px ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} />
                    <div>
                      <span className="text-slate-500 uppercase font-black tracking-wider text-[8px] mr-1.5">Slide</span>
                      <span className={`font-bold text-xs ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                        {presentation.currentSlide !== undefined && presentation.currentSlide !== null 
                          ? presentation.currentSlide 
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Subtle Sun/Moon Light/Dark Mode Toggle Button */}
                <button
                  type="button"
                  onClick={toggleStudentTheme}
                  className={`p-1.5 rounded-lg border transition-all flex items-center justify-center cursor-pointer outline-none active:scale-95 ${
                    isLight
                      ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200 hover:border-slate-300'
                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80 hover:border-slate-600'
                  }`}
                  title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                  aria-label={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                >
                  {isLight ? (
                    <Moon className="w-3.5 h-3.5 text-slate-700" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const nextDir = chatLayoutDirection === 'left' ? 'right' : 'left';
                    setChatLayoutDirection(nextDir);
                    localStorage.setItem('activeDeckChatLayoutDirection', nextDir);
                  }}
                  className={`p-1.5 rounded-lg border transition-all flex items-center justify-center cursor-pointer outline-none active:scale-95 ${
                    isLight
                      ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200 hover:border-slate-300'
                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80 hover:border-slate-600'
                  }`}
                  title={chatLayoutDirection === 'left' ? "Move Chat to Right / Notes to Left" : "Move Chat to Left / Notes to Right"}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>

                {(hasJoinedChat || presentation?.chatEnabled === false) && (
                  <button
                    type="button"
                    onClick={handleDownloadNotes}
                    disabled={isNotesEmpty(notesTextMap, studentSlideDrawingsMap, studentSlideTextAnnotationsMap) && Object.keys(pushedSlidesMap).length === 0}
                    className={`h-8 px-3 rounded-lg border hover:border-osu-orange/60 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold tracking-wide transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-sm ${
                      isLight
                        ? 'bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-900 border-slate-200'
                        : 'bg-slate-800/90 hover:bg-slate-800 text-slate-100 hover:text-white border-slate-700'
                    }`}
                    title="Export notes & slides to Word (.docx)"
                  >
                    <Download className="w-3.5 h-3.5 text-osu-orange" />
                    <span>Export (.docx)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Note-Taking Section */}
            <div className={`flex-1 flex flex-col min-h-0 border rounded-2xl p-3 space-y-2.5 transition-colors duration-200 ${
              isLight
                ? 'bg-[#FFFFFF] border-slate-200 shadow-sm'
                : 'bg-slate-900/30 border-slate-800/80 shadow-xl backdrop-blur-sm'
            }`}>
              {!hasJoinedChat && presentation?.chatEnabled !== false ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in duration-305">
                  <div className="w-12 h-12 rounded-2xl bg-osu-orange/10 border border-osu-orange/20 flex items-center justify-center text-osu-orange shadow-lg shadow-orange-500/5">
                    <Lock className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h3 className={`text-sm font-black uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>Notes Locked</h3>
                    <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      Join the discussion by entering your name and email in the Chat panel to unlock real-time, slide-by-slide note-taking.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Compact Single-Row Slide Tabs Bar + Blank Note Button */}
                  {(() => {
                    const slidesWithNotes = Array.from(new Set([
                      ...Object.keys(notesTextMap),
                      ...Object.keys(studentSlideDrawingsMap),
                      ...Object.keys(studentSlideTextAnnotationsMap)
                    ])).filter(slide => {
                      const html = notesTextMap[slide];
                      const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';

                      const slideDrawingJson = studentSlideDrawingsMap[slide];
                      let hasSlideDrawing = false;
                      try {
                        if (slideDrawingJson) {
                          const strokes = JSON.parse(slideDrawingJson);
                          hasSlideDrawing = Array.isArray(strokes) && strokes.length > 0;
                        }
                      } catch {}

                      const slideTextAnns = studentSlideTextAnnotationsMap[slide];
                      const hasSlideText = Array.isArray(slideTextAnns) && slideTextAnns.some(ann => ann.text && ann.text.trim() !== '');
                      
                      return hasText || hasSlideDrawing || hasSlideText;
                    });
                    
                    const presenterSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
                      ? String(presentation.currentSlide) 
                      : '1';
                    
                    const maxSlide = Math.max(
                      1,
                      maxSlideSeen,
                      presentation?.currentSlide || 1,
                      ...Object.keys(notesTextMap).map(Number).filter(n => !isNaN(n)),
                      ...Object.keys(studentSlideDrawingsMap).map(Number).filter(n => !isNaN(n)),
                      ...Object.keys(studentSlideTextAnnotationsMap).map(Number).filter(n => !isNaN(n)),
                      ...Object.keys(pushedSlidesMap).map(Number).filter(n => !isNaN(n))
                    );

                    const allTabs: Array<{ id: string; label: string; position: number; isCustom: boolean }> = [];
                    for (let i = 1; i <= maxSlide; i++) {
                      allTabs.push({
                        id: String(i),
                        label: `Slide ${i}`,
                        position: i,
                        isCustom: false
                      });
                    }

                    customTabs.forEach(ct => {
                      allTabs.push({
                        id: ct.id,
                        label: ct.label,
                        position: ct.position,
                        isCustom: true
                      });
                    });

                    allTabs.sort((a, b) => a.position - b.position);

                    return (
                      <div className="flex items-center justify-between gap-2 w-full shrink-0">
                        <div className="flex-1 min-w-0 max-h-20 overflow-y-auto pr-1 custom-scrollbar">
                          <div className="flex flex-row flex-wrap items-center gap-1.5 py-0.5 select-none">
                            {allTabs.map(tab => {
                              const isCurrentTab = tab.id === activeTab;
                              const isPresenterSlide = tab.id === presenterSlide;
                              const hasContent = slidesWithNotes.includes(tab.id);

                              if (tab.isCustom) {
                                return (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 group ${
                                      isCurrentTab 
                                        ? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-500/20 font-bold'
                                        : isLight
                                          ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 hover:border-purple-300'
                                          : 'bg-purple-950/80 border-purple-500/40 text-purple-200 hover:bg-purple-900 hover:border-purple-400 hover:text-white'
                                    }`}
                                    title={`Custom Blank Note Tab: ${tab.label}`}
                                  >
                                    <FileText className="w-3 h-3 text-purple-400 shrink-0" />
                                    <span>{tab.label}</span>
                                    {hasContent && !isCurrentTab && (
                                      <span className="w-1 h-1 rounded-full bg-purple-400/80" title="Has notes" />
                                    )}
                                    <span 
                                      onClick={(e) => handleDeleteCustomTab(tab.id, e)}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-purple-800/80 rounded transition-opacity ml-0.5 cursor-pointer"
                                      title="Delete note tab"
                                    >
                                      <X className="w-2.5 h-2.5 text-purple-300 hover:text-white" />
                                    </span>
                                  </button>
                                );
                              }

                              return (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => setActiveTab(tab.id)}
                                  className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                                    isCurrentTab 
                                      ? 'bg-osu-orange border-osu-orange text-white shadow-md shadow-orange-500/10'
                                      : isLight
                                        ? 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 hover:border-slate-300'
                                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                                  }`}
                                >
                                  <span>{tab.label}</span>
                                  {isPresenterSlide && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse border border-green-300" title="Presenter is currently on this slide" />
                                  )}
                                  {!isPresenterSlide && hasContent && (
                                    <span className="w-1 h-1 rounded-full bg-orange-400/80" title="Has notes" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleAddCustomTab}
                          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold border rounded-lg transition-all cursor-pointer active:scale-95 shadow-sm shrink-0 ${
                            isLight
                              ? 'text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-200 hover:border-purple-300'
                              : 'text-purple-300 bg-purple-950/80 hover:bg-purple-900 border-purple-500/40 hover:border-purple-400'
                          }`}
                          title="Add a new blank note tab for website or non-PPT content"
                        >
                          <Plus className="w-3 h-3 text-purple-500" />
                          <span>+ Blank Note</span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* Slide Out-of-Sync Alert */}
                  {presentation && presentation.currentSlide !== undefined && presentation.currentSlide !== null && String(presentation.currentSlide) !== activeTab && (
                    <div className={`flex items-center justify-between px-3 py-1.5 rounded-xl border text-[10px] shrink-0 animate-in fade-in slide-in-from-top-2 duration-300 ${
                      isLight ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-orange-500/10 border-orange-500/20 text-orange-200'
                    }`}>
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                        Presenter is on Slide {presentation.currentSlide} (You are on {getTabTitle(activeTab)})
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

                   {(() => {
                    console.log(`[SlidePreview Render] activeTab: "${activeTab}" (type: ${typeof activeTab}), pushedSlidesMapKeys:`, Object.keys(pushedSlidesMap), `resolvedUrl:`, pushedSlidesMap[activeTab]);
                    return null;
                  })()}
                   {/* Split-screen Side-by-Side Editor and Slide Preview Container */}
                  <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 relative" ref={notesContainerRef}>
                    
                    {/* Notes Writing Area (Permanently locked to Typed Notes RichTextEditor) */}
                    <div 
                      className="flex flex-col min-w-0 min-h-0"
                      style={{ flex: `1 1 ${notesSplitRatio}%`, minWidth: '150px' }}
                    >
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
                        placeholder={`Type your notes for ${getTabTitle(activeTab)} here...`}
                        className="flex-1 min-h-[120px]"
                        editorTheme={studentTheme}
                      />
                    </div>

                    {/* Interactive Drag Splitter between Notes and Preview */}
                    {true && (
                      <div 
                        onMouseDown={handleMouseDownNotesSplit}
                        onTouchStart={handleTouchStartNotesSplit}
                        onDoubleClick={handleDoubleClickNotesSplit}
                        className="hidden md:flex w-2 h-full cursor-col-resize items-center justify-center flex-shrink-0 group/notes-splitter select-none bg-transparent hover:bg-white/[0.01] transition-colors rounded-lg"
                        title="Drag to resize notes and slide preview (double-click to reset)"
                      >
                        <div className={`w-[3px] h-20 group-hover/notes-splitter:bg-osu-orange/70 group-active/notes-splitter:bg-osu-orange rounded-full transition-all duration-200 ${
                          isLight ? 'bg-slate-300' : 'bg-slate-800/80'
                        }`} />
                      </div>
                    )}

                    {/* Premium Large Slide Preview (Right/Bottom) */}
                    {true && (
                      <div 
                        className={`flex flex-col min-w-0 min-h-[200px] md:min-h-0 rounded-xl border select-none group shadow-xl relative overflow-hidden ${
                          isLight ? 'border-slate-200 bg-slate-950' : 'border-slate-800 bg-slate-950'
                        }`}
                        style={{ flex: `1 1 ${100 - notesSplitRatio}%`, minWidth: '150px' }}
                        title={getSlidePreviewUrl(activeTab) ? `${getTabTitle(activeTab)} Preview (Click Slide to Annotate & Zoom)` : "No slide preview shared yet"}
                      >
                        {getSlidePreviewUrl(activeTab) ? (
                          <div className="w-full h-full relative flex flex-col h-full justify-between">
                            <div 
                              onClick={() => {
                                const previewUrl = getSlidePreviewUrl(activeTab);
                                if (previewUrl) {
                                  setLightboxImgUrl(previewUrl);
                                  setIsLightboxOpen(true);
                                }
                              }}
                              className="flex-1 relative overflow-hidden bg-black flex items-center justify-center min-h-0 cursor-zoom-in group/preview"
                              title="Click slide to annotate & zoom"
                            >
                              <div ref={desktopPreviewFrameRef} className="absolute inset-0">
                                <img 
                                  src={getSlidePreviewUrl(activeTab)} 
                                  alt={`${getTabTitle(activeTab)} Preview`}
                                  className="w-full h-full object-contain transition-transform duration-300 group-hover/preview:scale-[1.01] pointer-events-none"
                                />
                              </div>
                              {/* Drawing Overlay - positioned using calculated bounds */}
                              <div 
                                className="absolute pointer-events-none"
                                style={{
                                  top: desktopPreviewBounds.offsetY,
                                  left: desktopPreviewBounds.offsetX,
                                  width: desktopPreviewBounds.renderedWidth > 0 ? desktopPreviewBounds.renderedWidth : '100%',
                                  height: desktopPreviewBounds.renderedHeight > 0 ? desktopPreviewBounds.renderedHeight : '100%',
                                }}
                              >
                              {/* Presenter Live Slide Drawing Layer */}
                              {(() => {
                                const drawingsJson = presentation?.presenterDrawings?.[activeTab];
                                if (!drawingsJson) return null;
                                try {
                                  const strokes: DrawingStroke[] = JSON.parse(drawingsJson);
                                  if (!Array.isArray(strokes) || strokes.length === 0) return null;
                                  return (
                                    <svg
                                      viewBox="0 0 1000 1000"
                                      preserveAspectRatio="none"
                                      className="w-full h-full pointer-events-none z-10"
                                      style={{ filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
                                    >
                                      {strokes.map((stroke, idx) => {
                                        if (stroke.text) {
                                          const pt = stroke.points[0];
                                          if (!pt) return null;
                                          const fontSize = Math.max(26, stroke.width * 5);
                                          return (
                                            <text
                                              key={`desktop-preview-text-${idx}`}
                                              x={pt.x}
                                              y={pt.y}
                                              fill={stroke.color}
                                              fontSize={fontSize}
                                              fontWeight="bold"
                                              fontFamily="sans-serif"
                                            >
                                              {stroke.text}
                                            </text>
                                          );
                                        }
                                        const pathD = getStrokePath(stroke);
                                        if (!pathD) return null;
                                        return (
                                          <path
                                            key={`desktop-preview-stroke-${idx}`}
                                            d={pathD}
                                            stroke={stroke.color}
                                            strokeWidth={stroke.width}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            fill="none"
                                            opacity={stroke.isHighlighter ? 0.25 : 1}
                                          />
                                        );
                                      })}
                                    </svg>
                                  );
                                } catch {
                                  return null;
                                }
                              })()}
                              {/* Student Personal Slide Markings Layer */}
                              {(() => {
                                const studentJson = studentSlideDrawingsMap[activeTab];
                                if (!studentJson) return null;
                                try {
                                  const strokes: DrawingStroke[] = JSON.parse(studentJson);
                                  if (!Array.isArray(strokes) || strokes.length === 0) return null;
                                  return (
                                    <svg
                                      viewBox="0 0 1000 1000"
                                      preserveAspectRatio="none"
                                      className="absolute inset-0 w-full h-full pointer-events-none z-20"
                                      style={{ filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
                                    >
                                      {strokes.map((stroke, idx) => {
                                        if (stroke.text) {
                                          const pt = stroke.points[0];
                                          if (!pt) return null;
                                          const fontSize = Math.max(26, stroke.width * 5);
                                          return (
                                            <text
                                              key={`desktop-student-text-${idx}`}
                                              x={pt.x}
                                              y={pt.y}
                                              fill={stroke.color}
                                              fontSize={fontSize}
                                              fontWeight="bold"
                                              fontFamily="sans-serif"
                                            >
                                              {stroke.text}
                                            </text>
                                          );
                                        }
                                        const pathD = getStrokePath(stroke);
                                        if (!pathD) return null;
                                        return (
                                          <path
                                            key={`desktop-student-stroke-${idx}`}
                                            d={pathD}
                                            stroke={stroke.color}
                                            strokeWidth={stroke.width}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            fill="none"
                                            opacity={stroke.isHighlighter ? 0.25 : 1}
                                          />
                                        );
                                      })}
                                    </svg>
                                  );
                                } catch {
                                  return null;
                                }
                              })()}
                              {/* Student Personal Slide Text Annotations Layer */}
                              {(() => {
                                const textAnns = studentSlideTextAnnotationsMap[activeTab];
                                if (!Array.isArray(textAnns) || textAnns.length === 0) return null;
                                const previewWidth = desktopPreviewBounds.renderedWidth || 400;
                                const scaleRatio = Math.max(0.22, previewWidth / 1000);
                                return (
                                  <div className="absolute inset-0 w-full h-full pointer-events-none z-30 overflow-hidden">
                                    {textAnns.map(ann => {
                                      if (!ann.text || !ann.text.trim()) return null;
                                      const baseFontSize = ann.fontSize || 24;
                                      const scaledFontSize = Math.max(8, Math.round(baseFontSize * scaleRatio));
                                      const isDarkInk = (ann.color || '').trim().toUpperCase() === '#000000';
                                      return (
                                        <div
                                          key={ann.id}
                                          style={{
                                            left: `${ann.xPct}%`,
                                            top: `${ann.yPct}%`,
                                            color: ann.color,
                                            fontSize: `${scaledFontSize}px`,
                                            lineHeight: 1.25,
                                          }}
                                          className={`absolute font-bold font-sans whitespace-pre-wrap break-words px-1.5 py-0.5 rounded-md border shadow-md max-w-[90%] ${
                                            isDarkInk
                                              ? 'bg-white/95 border-slate-400/90'
                                              : 'bg-slate-950/90 border-white/25'
                                          }`}
                                        >
                                          {ann.text}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              </div>
                              {/* Floating Glassmorphic Expand Icon */}
                              <div className="absolute top-2.5 right-2.5 p-2 rounded-lg bg-black/60 border border-white/10 text-white/70 group-hover/preview:text-white group-hover/preview:bg-osu-orange group-hover/preview:border-osu-orange/50 shadow-lg backdrop-blur-md opacity-0 group-hover/preview:opacity-100 transition-all duration-300 transform scale-95 group-hover/preview:scale-100 flex items-center justify-center gap-1">
                                <Pen className="w-3.5 h-3.5" />
                                <Maximize className="w-3.5 h-3.5" />
                              </div>
                            </div>
                            <div className={`py-2 px-3 flex items-center justify-between border-t text-[10px] font-black uppercase tracking-wider shrink-0 ${
                              isLight
                                ? 'bg-slate-50 border-slate-200 text-slate-700'
                                : 'bg-slate-900/90 backdrop-blur-sm border-slate-800 text-slate-300'
                            }`}>
                              <span className={isLight ? 'text-slate-600' : 'text-slate-400'}>{getTabTitle(activeTab)}</span>
                              <span className={`text-osu-orange font-black animate-pulse flex items-center gap-1.5 ${
                                isLight ? 'group-hover:text-[#c03900]' : 'group-hover:text-white'
                              }`}>
                                <Pen className="w-3 h-3 shrink-0" />
                                <ZoomIn className="w-3 h-3 shrink-0" />
                                <span>CLICK SLIDE TO ANNOTATE &amp; ZOOM</span>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className={`w-full h-full flex flex-col items-center justify-center p-4 text-center min-h-[150px] md:min-h-0 ${
                            isLight ? 'bg-slate-50 text-slate-500' : 'bg-slate-950 text-slate-500'
                          }`}>
                            <Tv className={`w-8 h-8 mb-2 ${isLight ? 'text-slate-400' : 'text-slate-700'}`} />
                            <span className="text-xs font-black uppercase tracking-widest text-slate-500 leading-none">{getTabTitle(activeTab)}</span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase leading-none mt-2">No Preview Available</span>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <ImageLightboxModal 
        isOpen={isLightboxOpen} 
        onClose={() => setIsLightboxOpen(false)} 
        imageUrl={lightboxImgUrl} 
        title={`${getTabTitle(activeTab)} Preview`} 
        drawingStrokesJson={presentation?.presenterDrawings?.[activeTab]}
        allowStudentDrawing={true}
        studentStrokesJson={studentSlideDrawingsMap[activeTab] || ''}
        onStudentStrokesChange={(newJson) => {
          setStudentSlideDrawingsMap(prev => ({
            ...prev,
            [activeTab]: newJson
          }));
        }}
        textAnnotations={studentSlideTextAnnotationsMap[activeTab] || []}
        onTextAnnotationsChange={(newAnnotations) => {
          setStudentSlideTextAnnotationsMap(prev => ({
            ...prev,
            [activeTab]: newAnnotations
          }));
        }}
        onCompositePreviewUpdate={(compositeDataUrl) => {
          setCompositedSlidePreviewsMap(prev => ({
            ...prev,
            [activeTab]: compositeDataUrl
          }));
        }}
      />
    </>
  );
}

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-100 font-sans antialiased">
      {viewingAsEmail && (
        <div className="bg-amber-500 text-slate-950 font-black text-xs px-4 py-2 flex items-center justify-between z-[999] shadow-md shrink-0 border-b border-amber-600/30">
          <div className="flex items-center gap-2">
            <span className="bg-slate-950 text-white text-[10px] uppercase font-black px-2 py-0.5 rounded tracking-wider">
              Superuser View As
            </span>
            <span>
              Viewing app workspace as: <span className="font-mono underline">{viewingAsEmail}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={handleExitViewAs}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-950 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Exit View As & Return to Admin</span>
          </button>
        </div>
      )}
      <Header 
        presentationId={presentation?.id || activePresentationId} 
        showAttendance={settings?.showAttendance}
        onNewSession={handleStartNewSession}
        pinCode={presentation?.pinCode}
        isSharingPresentation={isPresentationSharing}
      />
      
      <div className="flex flex-row flex-1 p-6 pb-2 gap-3 bg-slate-100 min-h-0 overflow-hidden">
        {/* Presenter View (Flexible, but takes most space) */}
        <div className="flex-1 h-full min-w-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border border-slate-300 bg-black">
          <PresenterArea 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            onCreatePresentation={handleCreatePresentationForArea} 
            onStreamStateChange={setIsPresentationSharing}
          />
        </div>

        {presentation?.chatEnabled !== false && (
          <>
            {/* Interactive Drag Splitter */}
            <div 
              onMouseDown={handleMouseDownPresenter}
              onTouchStart={handleTouchStartPresenter}
              onDoubleClick={handleDoubleClickPresenter}
              className="w-3 h-full cursor-col-resize flex items-center justify-center flex-shrink-0 group/splitter select-none"
              title="Drag to resize sidebar (double-click to reset)"
            >
              <div className="w-[3px] h-20 bg-slate-300 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
            </div>

            {/* Audience Chat (Resizable sidebar) */}
            <div 
              style={{ width: `${presenterSidebarWidth}px`, minWidth: '280px' }}
              className="h-full flex-shrink-0 rounded-xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.24)] border-2 border-osu-orange bg-white flex flex-col"
            >
              <ChatSidebar 
                presentation={presentation} 
                logoUrl={settings?.theme.logoUrl} 
                presentationLoaded={presentationLoaded} 
                showAttendance={settings?.showAttendance}
              />
            </div>
          </>
        )}
      </div>

      <footer className="px-6 pb-3 pt-1 flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase select-none">
        <span>v2.0</span>
        <span className="opacity-65">ActiveDeck &copy; {new Date().getFullYear()}</span>
      </footer>

      <ImageLightboxModal 
        isOpen={isLightboxOpen} 
        onClose={() => setIsLightboxOpen(false)} 
        imageUrl={lightboxImgUrl} 
        title={`Slide ${activeTab} Preview`} 
        drawingStrokesJson={presentation?.presenterDrawings?.[activeTab]}
        allowStudentDrawing={true}
        studentStrokesJson={studentSlideDrawingsMap[activeTab] || ''}
        onStudentStrokesChange={(newJson) => {
          setStudentSlideDrawingsMap(prev => ({
            ...prev,
            [activeTab]: newJson
          }));
        }}
        textAnnotations={studentSlideTextAnnotationsMap[activeTab] || []}
        onTextAnnotationsChange={(newAnnotations) => {
          setStudentSlideTextAnnotationsMap(prev => ({
            ...prev,
            [activeTab]: newAnnotations
          }));
        }}
        onCompositePreviewUpdate={(compositeDataUrl) => {
          setCompositedSlidePreviewsMap(prev => ({
            ...prev,
            [activeTab]: compositeDataUrl
          }));
        }}
      />
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
