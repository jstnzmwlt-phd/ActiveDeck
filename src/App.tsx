import React, { useEffect, useState, useRef } from 'react';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { PresenterArea } from './components/PresenterArea';
import { ChatSidebar } from './components/ChatSidebar';
import { Header } from './components/Header';
import { Presentation, GlobalSettings } from './types';
import { db } from './firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, addDoc, serverTimestamp, updateDoc, getDoc, setDoc, increment, where } from 'firebase/firestore';
import { Presentation as PresentationIcon, Loader2, AlertCircle, Maximize, Minimize, Lock, Keyboard, Pen, Tv, ArrowLeftRight, MessageSquare, NotebookPen } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BridgeProvider } from './contexts/BridgeContext';
import { AdminPortal } from './components/AdminPortal';
import { StudentAttendance } from './components/StudentAttendance';
import { JoinScreen } from './components/JoinScreen';
import { RichTextEditor } from './components/RichTextEditor';
import { HandwrittenCanvas } from './components/HandwrittenCanvas';
import { ImageLightboxModal } from './components/ImageLightboxModal';

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

const isNotesEmpty = (notesMap: Record<string, string>, drawingsMap?: Record<string, string>) => {
  const hasText = notesMap && Object.keys(notesMap).length > 0 && !Object.values(notesMap).every(html => {
    if (!html) return true;
    const cleanText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return cleanText === '';
  });
  
  const hasDrawings = drawingsMap && Object.keys(drawingsMap).length > 0 && !Object.values(drawingsMap).every(drawingJson => {
    if (!drawingJson) return true;
    try {
      const strokes = JSON.parse(drawingJson);
      return !Array.isArray(strokes) || strokes.length === 0;
    } catch {
      return true;
    }
  });

  return !hasText && !hasDrawings;
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
    
    // Broadcast message to close the projector window/tab
    try {
      const channel = new BroadcastChannel('activedeck-stream');
      channel.postMessage({ type: 'close-projector' });
      channel.close();
    } catch (err) {
      console.error('AppContent - Failed to broadcast close-projector:', err);
    }

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

    // 3. Clear cached presenter details to force re-authentication for the next presenter
    sessionStorage.removeItem('activePresenterEmail');
    sessionStorage.removeItem('activePresenterPresentationId');
    sessionStorage.removeItem('activeDeckForceNewSession');

    // 4. Clear local states
    setPresenterEmail('');
    setPresentation(null);
    setPresentationLoaded(false);

    // 5. Perform a clean full page reload/redirect to prompt for presenter login
    const cleanUrl = window.location.origin + window.location.pathname;
    console.log('AppContent - Redirecting cleanly to:', cleanUrl);
    window.location.href = cleanUrl;
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
  const [notesDrawingsMap, setNotesDrawingsMap] = useState<Record<string, string>>({});
  const [notesMode, setNotesMode] = useState<'text' | 'pen'>('text');
  const [activeTab, setActiveTab] = useState<string>('1');
  const [maxSlideSeen, setMaxSlideSeen] = useState<number>(1);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [lastTypedAt, setLastTypedAt] = useState<number>(0);
  const [notesTitle, setNotesTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | ''>('');

  const [pushedSlidesMap, setPushedSlidesMap] = useState<Record<string, string>>({});

  const [notesSplitRatio, setNotesSplitRatio] = useState<number>(() => {
    const saved = localStorage.getItem('activeDeckNotesSplitRatio');
    return saved ? parseFloat(saved) : 60; // Default: 60% notes, 40% preview
  });

  const [chatLayoutDirection, setChatLayoutDirection] = useState<'left' | 'right'>(() => {
    const saved = localStorage.getItem('activeDeckChatLayoutDirection');
    return (saved === 'left' ? 'left' : 'right');
  });

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxImgUrl, setLightboxImgUrl] = useState('');

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'notes'>('chat');

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
    Object.keys(notesDrawingsMap).forEach(k => {
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
  }, [presentation?.currentSlide, activeTab, notesTextMap, notesDrawingsMap, pushedSlidesMap, maxSlideSeen]);

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
      
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.isBackgroundPreview && data.fileUrl && data.slide !== undefined && data.slide !== null) {
          const slideNum = String(data.slide);
          newPreviewsMap[slideNum] = data.fileUrl;
        }
      });
      
      console.log("[SlidePreview] Updated background slidePreviewsMap:", newPreviewsMap);
      setPushedSlidesMap(newPreviewsMap);
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
    const savedDrawings = localStorage.getItem(`activeDeckDrawings_${activePresentationId}`);
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

    let parsedDrawingsMap: Record<string, string> = {};
    if (savedDrawings) {
      try {
        parsedDrawingsMap = JSON.parse(savedDrawings);
      } catch (e) {
        console.error('Failed to parse drawings map on load:', e);
      }
    }
    setNotesDrawingsMap(parsedDrawingsMap);

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
    const savedDrawings = localStorage.getItem(`activeDeckDrawings_${activePresentationId}`) || '';
    const savedTitle = localStorage.getItem(`activeDeckNotesTitle_${activePresentationId}`) || '';
    
    const currentNotesRaw = JSON.stringify(notesTextMap);
    const currentDrawingsRaw = JSON.stringify(notesDrawingsMap);
    
    // Check if anything actually changed to avoid redundant saves and flicker
    let isSameNotes = false;
    try {
      const parsedSaved = JSON.parse(savedNotes);
      isSameNotes = JSON.stringify(parsedSaved) === currentNotesRaw;
    } catch (e) {
      isSameNotes = false;
    }

    let isSameDrawings = false;
    try {
      const parsedSaved = JSON.parse(savedDrawings);
      isSameDrawings = JSON.stringify(parsedSaved) === currentDrawingsRaw;
    } catch (e) {
      isSameDrawings = false;
    }

    if (isSameNotes && isSameDrawings && notesTitle === savedTitle) {
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(() => {
      localStorage.setItem(`activeDeckNotes_${activePresentationId}`, currentNotesRaw);
      localStorage.setItem(`activeDeckDrawings_${activePresentationId}`, currentDrawingsRaw);
      localStorage.setItem(`activeDeckNotesTitle_${activePresentationId}`, notesTitle);
      setSaveStatus('saved');
      
      const resetTimer = setTimeout(() => setSaveStatus(''), 2000);
      return () => clearTimeout(resetTimer);
    }, 500);

    return () => clearTimeout(timer);
  }, [notesTextMap, notesDrawingsMap, notesTitle, activePresentationId]);

  const convertStrokesToPng = (drawingJson: string): string => {
    if (!drawingJson) return '';
    try {
      const strokes = JSON.parse(drawingJson);
      if (!Array.isArray(strokes) || strokes.length === 0) return '';
      
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      
      // Draw white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1000, 1000);
      
      // Draw light grid lines
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 2;
      const gridSize = 30;
      for (let x = 0; x < 1000; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 1000);
        ctx.stroke();
      }
      for (let y = 0; y < 1000; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1000, y);
        ctx.stroke();
      }
      
      // Draw strokes
      strokes.forEach(stroke => {
        if (!stroke.points || stroke.points.length === 0) return;
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke.width;
        
        if (stroke.isHighlighter) {
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.35)'; // yellow highlighter
        } else {
          ctx.strokeStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
        }
        
        stroke.points.forEach((p: any, i: number) => {
          if (i === 0) {
            ctx.moveTo(p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        });
        ctx.stroke();
      });
      
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error("Failed to rasterize drawing strokes:", e);
      return '';
    }
  };

  const handleDownloadNotes = () => {
    if (isNotesEmpty(notesTextMap, notesDrawingsMap) && Object.keys(pushedSlidesMap).length === 0) {
      alert("Nothing to export. Connect to a presentation or take some notes first!");
      return;
    }
    const title = notesTitle.trim() || `Session_${presentation?.pinCode || 'Notes'}`;
    const filename = `ActiveDeck_Notes_${title.replace(/[^a-z0-9_-]/gi, '_')}.doc`;
    
    const presenterName = presentation?.presenterEmail ? presentation.presenterEmail.split('@')[0] : 'Presenter';
    const pin = presentation?.pinCode || 'N/A';
    
    // Sort slides numerically and compile notes + drawings + slide images
    const sortedSlides = Array.from(new Set([
      ...Object.keys(notesTextMap),
      ...Object.keys(notesDrawingsMap),
      ...Object.keys(pushedSlidesMap)
    ]))
      .filter(slide => {
        const html = notesTextMap[slide] || '';
        const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
        
        const drawingJson = notesDrawingsMap[slide] || '';
        let hasDrawing = false;
        try {
          if (drawingJson) {
            const strokes = JSON.parse(drawingJson);
            hasDrawing = Array.isArray(strokes) && strokes.length > 0;
          }
        } catch {}
        
        const hasImg = !!pushedSlidesMap[slide];
        
        return hasText || hasDrawing || hasImg;
      })
      .sort((a, b) => Number(a) - Number(b));

    const notesContentHtml = sortedSlides.map(slide => {
      const htmlContent = notesTextMap[slide] ? `<div>${notesTextMap[slide]}</div>` : '';
      
      let slidePreviewHtml = '';
      const slideImgUrl = pushedSlidesMap[slide];
      if (slideImgUrl) {
        slidePreviewHtml = `
          <div style="margin-top: 10px; margin-bottom: 15px;">
            <h4 style="color: #475569; font-size: 10pt; margin-bottom: 5px; font-weight: bold;">Slide Image:</h4>
            <div style="padding: 5px; width: 500px; height: 280px; background-color: #000000; border-radius: 8px; text-align: center; vertical-align: middle;">
              <img src="${slideImgUrl}" width="500" height="280" style="border-radius: 8px; border: 1px solid #e2e8f0; object-fit: contain;" />
            </div>
          </div>
        `;
      }

      let drawingSvgHtml = '';
      const drawingJson = notesDrawingsMap[slide];
      if (drawingJson) {
        const pngDataUrl = convertStrokesToPng(drawingJson);
        if (pngDataUrl) {
          drawingSvgHtml = `
            <div style="margin-top: 15px; margin-bottom: 10px;">
              <h4 style="color: #475569; font-size: 10pt; margin-bottom: 5px; font-weight: bold;">Handwritten Drawing:</h4>
              <div style="padding: 5px; width: 500px; height: 350px;">
                <img src="${pngDataUrl}" width="500" height="350" style="border-radius: 8px; border: 1px solid #e2e8f0;" />
              </div>
            </div>
          `;
        }
      }

      return `
        <div style="margin-bottom: 25px; page-break-inside: avoid;">
          <h3 style="color: #eb5d00; border-bottom: 1px solid #f3eedd; padding-bottom: 3px; margin-bottom: 10px;">Slide ${slide}</h3>
          ${slidePreviewHtml}
          ${htmlContent}
          ${drawingSvgHtml}
        </div>
      `;
    }).join('');

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

  const [audienceChatWidth, setAudienceChatWidth] = useState(() => {
    const saved = localStorage.getItem('activeDeckAudienceChatWidth');
    return saved ? Math.max(250, parseInt(saved, 10)) : 380;
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

  // Listen for close-projector broadcast in Projector Mode
  useEffect(() => {
    if (!isProjector) return;
    console.log('AppContent - Projector Mode: Listening for close-projector broadcast');
    const channel = new BroadcastChannel('activedeck-stream');
    channel.onmessage = (event) => {
      if (event.data?.type === 'close-projector') {
        console.log('AppContent - Closing projector window as requested by presenter');
        window.close();
      }
    };
    return () => {
      channel.close();
    };
  }, [isProjector]);

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
  const chatLayoutDirectionRef = useRef(chatLayoutDirection);

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
    setPresenterSidebarWidth(300);
    localStorage.setItem('activeDeckPresenterSidebarWidth', '300');
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
        const constrainedWidth = Math.max(320, Math.min(600, calculatedWidth));
        setSidebarWidth(constrainedWidth);
        localStorage.setItem('activeDeckProjectorSidebarWidth', constrainedWidth.toString());
      }

      // 2. Presenter Sidebar Dragging
      if (isDraggingPresenterRef.current) {
        const containerPadding = 24; // p-6 is 24px
        const calculatedWidth = window.innerWidth - clientX - containerPadding;
        const constrainedWidth = Math.max(270, Math.min(500, calculatedWidth));
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
          onTouchStart={handleTouchStartProjector}
          onDoubleClick={handleDoubleClickProjector}
          className="w-3 h-full cursor-col-resize flex items-center justify-center flex-shrink-0 group/splitter select-none"
          title="Drag to resize sidebar (double-click to reset)"
        >
          <div className="w-[3px] h-20 bg-slate-800 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
        </div>

        {/* Expanded Read-Only Sidebar Q&A Display */}
        <div 
          style={{ width: `${sidebarWidth}px`, minWidth: '320px' }}
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
    if (isMobile) {
      return (
        <>
          <div className="h-full w-full flex flex-col bg-slate-950 font-sans antialiased overflow-hidden">
            {/* Pinned Slide Preview Container at the Top of Viewport */}
            {presentation?.showSlidePreview !== false && (
              <div className="w-full shrink-0 bg-slate-950 border-b border-slate-900 relative z-20 shadow-lg">
                <div 
                  className="w-full aspect-[16/9] max-h-[25vh] bg-black select-none relative group overflow-hidden"
                  onClick={() => {
                    if (pushedSlidesMap[activeTab]) {
                      setLightboxImgUrl(pushedSlidesMap[activeTab]);
                      setIsLightboxOpen(true);
                    }
                  }}
                  title={pushedSlidesMap[activeTab] ? `Slide ${activeTab} Preview (Tap to Zoom)` : "No slide preview shared yet"}
                >
                  {pushedSlidesMap[activeTab] ? (
                    <div className="w-full h-full relative cursor-zoom-in">
                      <img 
                        src={pushedSlidesMap[activeTab]} 
                        alt={`Slide ${activeTab} Preview`}
                        className="w-full h-full object-contain"
                      />
                      {/* Floating badge */}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 border border-white/10 text-white text-[9px] font-bold">
                        Slide {activeTab}
                      </div>
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-osu-orange text-white text-[9px] font-bold animate-pulse flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-white"></span>
                        Live
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
                  <div className="flex items-center justify-between p-2 bg-orange-500/10 border-t border-orange-500/20 text-[9px] text-orange-200">
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
            <div className="flex bg-slate-900 border-b border-slate-800 shrink-0 p-1 relative z-20 shadow-md">
              <button
                type="button"
                onClick={() => setMobileTab('chat')}
                className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mobileTab === 'chat'
                    ? 'bg-osu-orange text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
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
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <NotebookPen className="w-3.5 h-3.5" />
                Notes
              </button>
            </div>

            {/* Content Area Underneath Switcher */}
            <div className="flex-1 min-h-0 flex flex-col relative z-10 bg-slate-950">
              {mobileTab === 'chat' ? (
                <div className="w-full h-full bg-white relative flex-1 flex flex-col min-h-0">
                  <ChatSidebar 
                    isChatOnly={true} 
                    presentation={presentation} 
                    logoUrl={settings?.theme.logoUrl} 
                    presentationLoaded={presentationLoaded} 
                    showAttendance={settings?.showAttendance}
                    onJoinChange={setHasJoinedChat}
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 p-3 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 overflow-y-auto custom-scrollbar">
                  {!hasJoinedChat ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
                      <div className="w-12 h-12 rounded-2xl bg-osu-orange/10 border border-osu-orange/20 flex items-center justify-center text-osu-orange shadow-lg">
                        <Lock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="space-y-1.5 max-w-xs">
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-200">Notes Locked</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Join the discussion by entering your name and email in the Chat tab to unlock real-time, slide-by-slide note-taking.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col space-y-3 min-h-0">
                      <div className="flex items-center justify-between shrink-0">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">My Study Notes</span>
                        {saveStatus && (
                          <span className={`text-[8px] font-bold px-2 py-0.5 rounded transition-all duration-305 ${
                            saveStatus === 'saving' ? 'text-slate-400 animate-pulse' : 'text-green-400 bg-green-500/10 border border-green-500/20'
                          }`}>
                            {saveStatus === 'saving' ? 'Saving...' : 'Auto-saved'}
                          </span>
                        )}
                      </div>

                      {/* Title & Slides Overview for Mobile */}
                      <div className="flex flex-col gap-2 w-full shrink-0 bg-white/[0.02] border border-white/5 rounded-xl p-2.5">
                        {/* Notes Title */}
                        <div className="w-full flex flex-col space-y-1">
                          <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Notes Title</span>
                          <input 
                            type="text"
                            value={notesTitle}
                            onChange={(e) => setNotesTitle(e.target.value)}
                            placeholder="Notes Title (e.g. Lecture 1)"
                            className="w-full h-9 px-2.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-osu-orange focus:border-osu-orange transition-all"
                          />
                        </div>

                        {/* Slides Overview */}
                        {(() => {
                          const slidesWithNotes = Array.from(new Set([
                            ...Object.keys(notesTextMap),
                            ...Object.keys(notesDrawingsMap)
                          ])).filter(slide => {
                            const html = notesTextMap[slide];
                            const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
                            
                            const drawingJson = notesDrawingsMap[slide];
                            let hasDrawing = false;
                            try {
                              if (drawingJson) {
                                const strokes = JSON.parse(drawingJson);
                                hasDrawing = Array.isArray(strokes) && strokes.length > 0;
                              }
                            } catch {}
                            
                            return hasText || hasDrawing;
                          });
                          
                          const presenterSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
                            ? String(presentation.currentSlide) 
                            : '1';
                          
                          const maxSlide = Math.max(
                            1,
                            maxSlideSeen,
                            presentation?.currentSlide || 1,
                            ...Object.keys(notesTextMap).map(Number),
                            ...Object.keys(notesDrawingsMap).map(Number),
                            ...Object.keys(pushedSlidesMap).map(Number)
                          );

                          const allTabs: string[] = [];
                          for (let i = 1; i <= maxSlide; i++) {
                            allTabs.push(String(i));
                          }

                          return (
                            <div className="flex flex-col space-y-1 w-full">
                              <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Slides Overview</span>
                              <div className="w-full max-h-24 overflow-y-auto pr-0.5 custom-scrollbar">
                                <div className="flex flex-row flex-wrap items-center gap-1 py-0.5 select-none">
                                  {allTabs.map(slide => {
                                    const isCurrentTab = slide === activeTab;
                                    const isPresenterSlide = slide === presenterSlide;
                                    const hasContent = slidesWithNotes.includes(slide);

                                    return (
                                      <button
                                        key={slide}
                                        type="button"
                                        onClick={() => setActiveTab(slide)}
                                        className={`px-2.5 py-0.5 text-[9px] font-bold rounded border transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                                          isCurrentTab 
                                            ? 'bg-osu-orange border-osu-orange text-white shadow-sm'
                                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                                        }`}
                                      >
                                        <span>{presentation?.showSlidePreview !== false ? `Slide ${slide}` : `\u00A0\u00A0\u00A0\u00A0`}</span>
                                        {isPresenterSlide && (
                                          <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse border border-green-300" />
                                        )}
                                        {!isPresenterSlide && hasContent && (
                                          <span className="w-0.5 h-0.5 rounded-full bg-orange-300/60" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Mode Selector Toggle */}
                      <div className="flex items-center bg-slate-900/60 p-0.5 rounded-lg border border-white/5 shrink-0 select-none">
                        <button
                          type="button"
                          onClick={() => setNotesMode('text')}
                          className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            notesMode === 'text'
                              ? 'bg-osu-orange text-white shadow-sm font-bold'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <Keyboard className="w-3 h-3" />
                          Typed
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotesMode('pen')}
                          className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            notesMode === 'pen'
                              ? 'bg-osu-orange text-white shadow-sm font-bold'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <Pen className="w-3 h-3" />
                          Draw
                        </button>
                      </div>

                      {/* Editor Area (Fills remaining mobile viewport height) */}
                      <div className="flex-1 min-h-[160px] flex flex-col">
                        {notesMode === 'text' ? (
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
                          />
                        ) : (
                          <HandwrittenCanvas
                            value={notesDrawingsMap[activeTab] || ''}
                            onChange={(newVal) => {
                              setNotesDrawingsMap(prev => ({
                                ...prev,
                                [activeTab]: newVal
                              }));
                            }}
                            placeholder={`Draw notes for Slide ${activeTab}...`}
                          />
                        )}
                      </div>

                      {/* Export / Download Button */}
                      <div className="pt-1 shrink-0">
                        <button
                          type="button"
                          onClick={handleDownloadNotes}
                          disabled={isNotesEmpty(notesTextMap, notesDrawingsMap) && Object.keys(pushedSlidesMap).length === 0}
                          className="w-full h-9 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
                        >
                          Download (.doc)
                        </button>
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
          />
        </>
      );
    }

    return (
      <>
        <div className={`h-full w-full flex flex-col ${chatLayoutDirection === 'right' ? 'md:flex-row-reverse' : 'md:flex-row'} bg-slate-950 font-sans antialiased overflow-hidden`}>
          {/* Left Side: The Chat Sidebar */}
          <div 
            style={{ width: `${audienceChatWidth}px` }}
            className="w-full md:w-auto h-full bg-white relative flex-shrink-0"
          >
          <ChatSidebar 
            isChatOnly={true} 
            presentation={presentation} 
            logoUrl={settings?.theme.logoUrl} 
            presentationLoaded={presentationLoaded} 
            showAttendance={settings?.showAttendance}
            onJoinChange={setHasJoinedChat}
          />
        </div>

        {/* Interactive Drag Splitter */}
        <div 
          onMouseDown={handleMouseDownAudienceChat}
          onTouchStart={handleTouchStartAudienceChat}
          onDoubleClick={handleDoubleClickAudienceChat}
          className="hidden md:flex w-3 h-full cursor-col-resize items-center justify-center flex-shrink-0 group/splitter select-none bg-slate-950 border-l border-r border-slate-900"
          title="Drag to resize chat (double-click to reset)"
        >
          <div className="w-[3px] h-20 bg-slate-800 group-hover/splitter:bg-osu-orange/70 group-active/splitter:bg-osu-orange rounded-full transition-all duration-200" />
        </div>

        {/* Right Side: Premium Welcome Panel (Desktop/Laptop only) */}
        <div className="hidden md:flex flex-1 h-full flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-l border-slate-800/80 p-4 md:p-5 relative overflow-hidden">
          {/* Ambient lighting glow */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-osu-orange/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="w-full space-y-3.5 relative z-10 animate-in fade-in zoom-in-95 duration-500 flex flex-col h-full min-h-0">
            {/* Ultra-compact Header & Stats Bar */}
            <div className="flex items-center justify-between gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-2xl shrink-0 select-none">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 p-1 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0">
                  <img 
                    src={settings?.theme.logoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
                    alt="Logo" 
                    className="max-w-full max-h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="text-left">
                  <h1 className="text-xs font-black uppercase tracking-wider text-white leading-none">ActiveDeck Notes</h1>
                </div>
                <div className="h-4 w-px bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => {
                    const nextDir = chatLayoutDirection === 'left' ? 'right' : 'left';
                    setChatLayoutDirection(nextDir);
                    localStorage.setItem('activeDeckChatLayoutDirection', nextDir);
                  }}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-osu-orange hover:text-white border border-white/10 hover:border-osu-orange/30 text-osu-orange hover:text-white transition-all duration-300 flex items-center justify-center cursor-pointer outline-none active:scale-95 shadow-md"
                  title={chatLayoutDirection === 'left' ? "Move Chat to Right / Notes to Left" : "Move Chat to Left / Notes to Right"}
                >
                  <ArrowLeftRight className="w-[18px] h-[18px] transition-transform duration-300" />
                </button>
              </div>
              {presentation && (
                <div className="flex items-center gap-4 text-[10px] pr-1">
                  <div>
                    <span className="text-slate-500 uppercase font-black tracking-wider text-[8px] mr-1.5">Session PIN</span>
                    <span className="font-mono font-bold text-osu-orange text-xs">{presentation.pinCode || 'N/A'}</span>
                  </div>
                  <div className="h-4 w-px bg-white/5" />
                  <div>
                    <span className="text-slate-500 uppercase font-black tracking-wider text-[8px] mr-1.5">Current Slide</span>
                    <span className="font-bold text-slate-200 text-xs">
                      {presentation.currentSlide !== undefined && presentation.currentSlide !== null 
                        ? `Slide ${presentation.currentSlide}` 
                        : 'N/A'}
                    </span>
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

                  {/* Title & Slides Overview Row */}
                  <div className="flex flex-col md:flex-row gap-4 items-start w-full shrink-0">
                    {/* Notes Title */}
                    <div className="w-full md:w-64 flex flex-col space-y-1 shrink-0">
                      <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Notes Title</span>
                      <input 
                        type="text"
                        value={notesTitle}
                        onChange={(e) => setNotesTitle(e.target.value)}
                        placeholder="Notes Title (e.g. Lecture 1)"
                        className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-osu-orange focus:border-osu-orange transition-all shrink-0"
                      />
                    </div>

                    {/* Slide Tabs Bar */}
                    {(() => {
                      const slidesWithNotes = Array.from(new Set([
                        ...Object.keys(notesTextMap),
                        ...Object.keys(notesDrawingsMap)
                      ])).filter(slide => {
                        const html = notesTextMap[slide];
                        const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
                        
                        const drawingJson = notesDrawingsMap[slide];
                        let hasDrawing = false;
                        try {
                          if (drawingJson) {
                            const strokes = JSON.parse(drawingJson);
                            hasDrawing = Array.isArray(strokes) && strokes.length > 0;
                          }
                        } catch {}
                        
                        return hasText || hasDrawing;
                      });
                      
                      const presenterSlide = presentation?.currentSlide !== undefined && presentation.currentSlide !== null 
                        ? String(presentation.currentSlide) 
                        : '1';
                      
                      // Determine the highest slide index dynamically (never removing tabs once reached)
                      const maxSlide = Math.max(
                        1,
                        maxSlideSeen,
                        presentation?.currentSlide || 1,
                        ...Object.keys(notesTextMap).map(Number),
                        ...Object.keys(notesDrawingsMap).map(Number),
                        ...Object.keys(pushedSlidesMap).map(Number)
                      );

                      // Create a contiguous array of slide numbers from 1 to maxSlide
                      const allTabs: string[] = [];
                      for (let i = 1; i <= maxSlide; i++) {
                        allTabs.push(String(i));
                      }

                      return (
                        <div className="flex flex-col space-y-1 flex-1 min-w-0">
                          <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">Slides Overview</span>
                          <div className="w-full max-h-32 overflow-y-auto pr-1 custom-scrollbar">
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
                                    <span>{presentation?.showSlidePreview !== false ? `Slide ${slide}` : `\u00A0\u00A0\u00A0\u00A0`}</span>
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
                        </div>
                      );
                    })()}
                  </div>

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

                  {/* Mode Selector Toggle (Typed vs Handwritten) */}
                  <div className="flex items-center bg-slate-900/60 p-1 rounded-xl border border-white/5 shrink-0 select-none">
                    <button
                      type="button"
                      onClick={() => setNotesMode('text')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        notesMode === 'text'
                          ? 'bg-osu-orange text-white shadow-md shadow-orange-500/10 font-bold'
                          : 'text-slate-400 hover:text-white font-medium'
                      }`}
                    >
                      <Keyboard className="w-3.5 h-3.5" />
                      Typed Notes
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotesMode('pen')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        notesMode === 'pen'
                          ? 'bg-osu-orange text-white shadow-md shadow-orange-500/10 font-bold'
                          : 'text-slate-400 hover:text-white font-medium'
                      }`}
                    >
                      <Pen className="w-3.5 h-3.5" />
                      Handwritten Notes
                    </button>
                  </div>
                   {(() => {
                    console.log(`[SlidePreview Render] activeTab: "${activeTab}" (type: ${typeof activeTab}), pushedSlidesMapKeys:`, Object.keys(pushedSlidesMap), `resolvedUrl:`, pushedSlidesMap[activeTab]);
                    return null;
                  })()}
                   {/* Split-screen Side-by-Side Editor and Slide Preview Container */}
                  <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 relative" ref={notesContainerRef}>
                    
                    {/* Notes Writing Area (Left/Top) */}
                    <div 
                      className="flex flex-col min-w-0 min-h-0"
                      style={{ flex: presentation?.showSlidePreview !== false ? `1 1 ${notesSplitRatio}%` : '1 1 100%', minWidth: '150px' }}
                    >
                      {notesMode === 'text' ? (
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
                          placeholder={presentation?.showSlidePreview !== false ? `Type your notes for Slide ${activeTab} here...` : `Type your notes here...`}
                          className="flex-1 min-h-[120px]"
                        />
                      ) : (
                        <HandwrittenCanvas
                          value={notesDrawingsMap[activeTab] || ''}
                          onChange={(newVal) => {
                            setNotesDrawingsMap(prev => ({
                              ...prev,
                              [activeTab]: newVal
                            }));
                          }}
                          placeholder={presentation?.showSlidePreview !== false ? `Draw your notes for Slide ${activeTab} here...` : `Draw your notes here...`}
                        />
                      )}
                    </div>

                    {/* Interactive Drag Splitter between Notes and Preview */}
                    {presentation?.showSlidePreview !== false && (
                      <div 
                        onMouseDown={handleMouseDownNotesSplit}
                        onTouchStart={handleTouchStartNotesSplit}
                        onDoubleClick={handleDoubleClickNotesSplit}
                        className="hidden md:flex w-2.5 h-full cursor-col-resize items-center justify-center flex-shrink-0 group/notes-splitter select-none bg-transparent hover:bg-white/[0.01] transition-colors rounded-lg"
                        title="Drag to resize notes and slide preview (double-click to reset)"
                      >
                        <div className="w-[3px] h-20 bg-slate-800/80 group-hover/notes-splitter:bg-osu-orange/70 group-active/notes-splitter:bg-osu-orange rounded-full transition-all duration-200" />
                      </div>
                    )}

                    {/* Premium Large Slide Preview (Right/Bottom) */}
                    {presentation?.showSlidePreview !== false && (
                      <div 
                        className="flex flex-col min-w-0 min-h-[200px] md:min-h-0 rounded-xl border border-slate-800 bg-slate-950 select-none group shadow-xl relative overflow-hidden"
                        style={{ flex: `1 1 ${100 - notesSplitRatio}%`, minWidth: '150px' }}
                        title={pushedSlidesMap[activeTab] ? `Slide ${activeTab} Preview (Click to Zoom)` : "No slide preview shared yet"}
                      >
                        {pushedSlidesMap[activeTab] ? (
                          <div className="w-full h-full relative flex flex-col h-full justify-between">
                            <div 
                              onClick={() => {
                                setLightboxImgUrl(pushedSlidesMap[activeTab]);
                                setIsLightboxOpen(true);
                              }}
                              className="flex-1 relative overflow-hidden bg-black flex items-center justify-center min-h-0 cursor-zoom-in group/preview"
                              title="Click to zoom in"
                            >
                              <img 
                                src={pushedSlidesMap[activeTab]} 
                                alt={`Slide ${activeTab} Preview`}
                                className="absolute inset-0 w-full h-full object-contain transition-transform duration-300 group-hover/preview:scale-[1.01]"
                              />
                              {/* Floating Glassmorphic Expand Icon */}
                              <div className="absolute top-2.5 right-2.5 p-2 rounded-lg bg-black/60 border border-white/10 text-white/70 group-hover/preview:text-white group-hover/preview:bg-osu-orange group-hover/preview:border-osu-orange/50 shadow-lg backdrop-blur-md opacity-0 group-hover/preview:opacity-100 transition-all duration-300 transform scale-95 group-hover/preview:scale-100 flex items-center justify-center">
                                <Maximize className="w-4 h-4" />
                              </div>
                            </div>
                            <div className="bg-slate-900/90 backdrop-blur-sm py-2 px-3 flex items-center justify-between border-t border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-300 shrink-0">
                              <span className="text-slate-400">Slide {activeTab}</span>
                              <span className="text-osu-orange group-hover:text-white font-black animate-pulse flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-osu-orange inline-block"></span>
                                Live Preview (Click to Zoom)
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-950 text-slate-500 text-center min-h-[150px] md:min-h-0">
                            <Tv className="w-8 h-8 text-slate-700 mb-2" />
                            <span className="text-xs font-black uppercase tracking-widest text-slate-500 leading-none">Slide {activeTab}</span>
                            <span className="text-[9px] font-bold text-slate-600 uppercase leading-none mt-2">No Preview Available</span>
                          </div>
                        )}
                      </div>
                    )}

                  </div>

                  {/* Export Buttons */}
                  <div className="pt-1.5 shrink-0 select-none">
                    <button
                      type="button"
                      onClick={handleDownloadNotes}
                      disabled={isNotesEmpty(notesTextMap, notesDrawingsMap) && Object.keys(pushedSlidesMap).length === 0}
                      className="w-full h-10 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/15 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      Download (.doc)
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
      <ImageLightboxModal 
        isOpen={isLightboxOpen} 
        onClose={() => setIsLightboxOpen(false)} 
        imageUrl={lightboxImgUrl} 
        title={`Slide ${activeTab} Preview`} 
      />
    </>
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
          onTouchStart={handleTouchStartPresenter}
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

      <ImageLightboxModal 
        isOpen={isLightboxOpen} 
        onClose={() => setIsLightboxOpen(false)} 
        imageUrl={lightboxImgUrl} 
        title={`Slide ${activeTab} Preview`} 
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
