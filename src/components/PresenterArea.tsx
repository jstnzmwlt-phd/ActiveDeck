import React, { useState, useEffect, useRef } from 'react';
import { Presentation, Message, Poll, WordCloud, OpenEndedQuestion } from '../types';
import { ScreenCapture } from './ScreenCapture';
import { ChevronLeft, ChevronRight, Download, Info, ShieldAlert, Presentation as PresentationIcon, Monitor, MonitorPlay, MousePointer2, Play, X, Loader2, Tv, Minimize, Maximize, FileText, Square, Send, CheckCircle2, Check, Clock, Pen, Eraser, Highlighter, MoveRight, Type, Undo2, Redo2, Trash2, Minus, Circle } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';
import { auth, db, storage } from '../firebase';
import { doc, getDoc, updateDoc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  points: DrawingPoint[];
  color: string;
  width: number;
  isHighlighter?: boolean;
  isArrow?: boolean;
  isLine?: boolean;
  isCircle?: boolean;
  isRectangle?: boolean;
  text?: string;
}

export interface RenderedSlideBounds {
  offsetX: number;
  offsetY: number;
  renderedWidth: number;
  renderedHeight: number;
}

export const getRenderedSlideBounds = (container: HTMLElement | null): RenderedSlideBounds | null => {
  if (!container) return null;

  const containerRect = container.getBoundingClientRect();
  if (containerRect.width === 0 || containerRect.height === 0) return null;

  // Find active video or active slide image (specifically excluding watermark logo image)
  const video = container.querySelector('video') as HTMLVideoElement | null;
  const slideImg = container.querySelector('img[alt^="Slide"]') as HTMLImageElement | null;

  let intrinsicW = 0;
  let intrinsicH = 0;

  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    intrinsicW = video.videoWidth;
    intrinsicH = video.videoHeight;
  } else if (slideImg && slideImg.naturalWidth > 0 && slideImg.naturalHeight > 0) {
    intrinsicW = slideImg.naturalWidth;
    intrinsicH = slideImg.naturalHeight;
  }

  // Fallback to 16:9 if intrinsic dimensions are not yet loaded
  if (!intrinsicW || !intrinsicH) {
    intrinsicW = 16;
    intrinsicH = 9;
  }

  const containerW = containerRect.width;
  const containerH = containerRect.height;
  const mediaAR = intrinsicW / intrinsicH;
  const containerAR = containerW / containerH;

  let renderedWidth: number;
  let renderedHeight: number;

  if (mediaAR >= containerAR) {
    renderedWidth = containerW;
    renderedHeight = containerW / mediaAR;
  } else {
    renderedHeight = containerH;
    renderedWidth = containerH * mediaAR;
  }

  const offsetX = (containerW - renderedWidth) / 2;
  const offsetY = (containerH - renderedHeight) / 2;

  return { offsetX, offsetY, renderedWidth, renderedHeight };
};

export const useRenderedSlideBounds = (
  frameRef: React.RefObject<HTMLDivElement | null>,
  deps: any[] = []
): RenderedSlideBounds => {
  const [bounds, setBounds] = useState<RenderedSlideBounds>({
    offsetX: 0,
    offsetY: 0,
    renderedWidth: 0,
    renderedHeight: 0,
  });

  useEffect(() => {
    const update = () => {
      const container = frameRef.current;
      if (!container) return;
      const b = getRenderedSlideBounds(container);
      if (b) setBounds(b);
    };

    update();

    const elem = frameRef.current;
    if (!elem) return;

    const ro = new ResizeObserver(update);
    ro.observe(elem);
    window.addEventListener('resize', update);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [frameRef, ...deps]);

  return bounds;
};

interface PresenterAreaProps {
  presentation: Presentation | null;
  logoUrl?: string;
  onCreatePresentation?: () => Promise<string>;
  isProjectorMode?: boolean;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation, logoUrl, onCreatePresentation, isProjectorMode = false }) => {
  const { 
    currentSlide, 
    sendSlideCommand, 
    isBridgeConnected, 
    useWithoutBridge, 
    setUseWithoutBridge,
    currentSlideBase64,
    nextSlide,
    nextSlideBase64,
    totalSlides,
    notes,
    clearNotesState
  } = useBridge();
  const [activeTab, setActiveTab] = useState<'single' | 'dual' | 'manual'>('dual');
  const [secondaryColor, setSecondaryColor] = useState<string>('#ff3e00');
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [laserEnabled, setLaserEnabled] = useState(true);
  const [presentWithNotes, setPresentWithNotes] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isDownloadingPresentation, setIsDownloadingPresentation] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [furthestSlide, setFurthestSlide] = useState<number>(1);
  const [visitedSlides, setVisitedSlides] = useState<Record<number, boolean>>({});

  // Sync furthest slide reached & visited slides
  useEffect(() => {
    if (currentSlide !== null) {
      setVisitedSlides(prev => {
        if (prev[currentSlide]) return prev;
        return { ...prev, [currentSlide]: true };
      });
      if (currentSlide > furthestSlide) {
        setFurthestSlide(currentSlide);
      }
    }
  }, [currentSlide, furthestSlide]);

  // Update live clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Presenter Live Slide Drawing State
  const [isPenActive, setIsPenActive] = useState<boolean>(false);
  const [penTool, setPenTool] = useState<'pen' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'highlighter' | 'text' | 'eraser'>('pen');
  const [penColor, setPenColor] = useState<string>('#EF4444'); // Default Red
  const [highlighterColor, setHighlighterColor] = useState<string>('#EAB308'); // Default Yellow
  const [penWidth, setPenWidth] = useState<number>(6);
  const [presenterStrokesMap, setPresenterStrokesMap] = useState<Record<string, DrawingStroke[]>>({});
  const [activeDrawingStroke, setActiveDrawingStroke] = useState<DrawingStroke | null>(null);
  const [isDrawingPointerDown, setIsDrawingPointerDown] = useState<boolean>(false);

  // Refs for tracking active stroke during pointermove events to prevent React state closure lag
  const activeDrawingStrokeRef = useRef<DrawingStroke | null>(null);
  const isDrawingPointerDownRef = useRef<boolean>(false);

  const [drawingUndoStack, setDrawingUndoStack] = useState<Record<string, DrawingStroke[][]>>({});
  const [drawingRedoStack, setDrawingRedoStack] = useState<Record<string, DrawingStroke[][]>>({});

  const activeSlideKey = String(currentSlide !== null ? currentSlide : (presentation?.currentSlide || 1));
  const currentSlideStrokes = isCapturing ? (presenterStrokesMap[activeSlideKey] || []) : [];

  const lastActiveStrokeBroadcastRef = useRef<number>(0);

  const renderStrokePath = (stroke: DrawingStroke): string => {
    if (!stroke.points || stroke.points.length === 0) return '';
    if (stroke.isArrow && stroke.points.length >= 2) {
      const p1 = stroke.points[0];
      const p2 = stroke.points[stroke.points.length - 1]; // tip point
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
    return stroke.points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');
  };

  const broadcastActiveStrokeLive = (stroke: DrawingStroke | null) => {
    // Local BroadcastChannel for instant <16ms projector popout sync
    try {
      const channel = new BroadcastChannel('activedeck-presenter-drawing');
      channel.postMessage({
        type: 'active-stroke-update',
        presentationId: presentation?.id,
        slide: activeSlideKey,
        activeStroke: stroke
      });
      channel.close();
    } catch (e) {}

    // Throttled Firebase update for remote projector windows (every 50ms)
    const now = Date.now();
    if (presentation?.id && (now - lastActiveStrokeBroadcastRef.current > 50 || stroke === null)) {
      lastActiveStrokeBroadcastRef.current = now;
      updateDoc(doc(db, 'presentations', presentation.id), {
        activeDrawingStrokeJSON: stroke ? JSON.stringify(stroke) : null
      }).catch(err => {
        console.warn("Failed to update active drawing stroke in Firebase:", err);
      });
    }
  };

  // Sync presenter drawings from Firestore
  useEffect(() => {
    if (!isCapturing) {
      setPresenterStrokesMap({});
      return;
    }
    if (presentation?.presenterDrawings) {
      const parsedMap: Record<string, DrawingStroke[]> = {};
      Object.entries(presentation.presenterDrawings).forEach(([slideKey, jsonStr]) => {
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            parsedMap[slideKey] = parsed;
          }
        } catch {}
      });
      setPresenterStrokesMap(parsedMap);
    } else {
      setPresenterStrokesMap({});
    }
  }, [presentation?.presenterDrawings, isCapturing]);

  // Sync live active drawing stroke on Projector Mode from Firebase
  useEffect(() => {
    if (!isProjectorMode) return;
    if (!presentation?.activeDrawingStrokeJSON) {
      setActiveDrawingStroke(null);
      return;
    }
    try {
      const parsed = JSON.parse(presentation.activeDrawingStrokeJSON);
      setActiveDrawingStroke(parsed);
    } catch {
      setActiveDrawingStroke(null);
    }
  }, [isProjectorMode, presentation?.activeDrawingStrokeJSON]);

  // Fast local multi-window sync via BroadcastChannel (e.g. Presenter -> Projector mode popup)
  useEffect(() => {
    const channel = new BroadcastChannel('activedeck-presenter-drawing');
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'slide-drawing-update' && e.data.presentationId === presentation?.id) {
        setPresenterStrokesMap(prev => ({
          ...prev,
          [e.data.slide]: e.data.strokes
        }));
      } else if (e.data && e.data.type === 'active-stroke-update' && e.data.presentationId === presentation?.id) {
        if (isProjectorMode && e.data.slide === activeSlideKey) {
          setActiveDrawingStroke(e.data.activeStroke);
        }
      } else if (e.data && e.data.type === 'clear-all-drawings' && e.data.presentationId === presentation?.id) {
        setPresenterStrokesMap({});
        setActiveDrawingStroke(null);
        activeDrawingStrokeRef.current = null;
      }
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [presentation?.id, isProjectorMode, activeSlideKey]);

  const updatePresenterStrokes = async (slideKey: string, newStrokes: DrawingStroke[]) => {
    setPresenterStrokesMap(prev => ({
      ...prev,
      [slideKey]: newStrokes
    }));

    try {
      const channel = new BroadcastChannel('activedeck-presenter-drawing');
      channel.postMessage({
        type: 'slide-drawing-update',
        presentationId: presentation?.id,
        slide: slideKey,
        strokes: newStrokes
      });
      channel.close();
    } catch (e) {
      console.warn("Failed to broadcast presenter drawing update:", e);
    }

    if (presentation?.id) {
      try {
        await updateDoc(doc(db, 'presentations', presentation.id), {
          [`presenterDrawings.${slideKey}`]: JSON.stringify(newStrokes)
        });
      } catch (err) {
        console.error("Error updating presenter drawings in Firebase:", err);
      }
    }
  };

  const getDrawingCoordinates = (e: React.PointerEvent<SVGSVGElement>): DrawingPoint | null => {
    const svgElem = e.currentTarget;
    if (!svgElem) return null;
    const rect = svgElem.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  };

  const eraseStrokeAtPoint = (point: DrawingPoint) => {
    const eraserRadius = 35;
    const remainingStrokes = currentSlideStrokes.filter(stroke => {
      return !stroke.points.some(p => {
        const dx = p.x - point.x;
        const dy = p.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < eraserRadius;
      });
    });

    if (remainingStrokes.length !== currentSlideStrokes.length) {
      setDrawingUndoStack(prev => ({
        ...prev,
        [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
      }));
      updatePresenterStrokes(activeSlideKey, remainingStrokes);
    }
  };

  const handleDrawingPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPenActive || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const coords = getDrawingCoordinates(e);
    if (!coords) return;

    isDrawingPointerDownRef.current = true;
    setIsDrawingPointerDown(true);

    if (penTool === 'eraser') {
      eraseStrokeAtPoint(coords);
    } else if (penTool === 'text') {
      const enteredText = window.prompt("Enter text to display on slide:");
      if (enteredText && enteredText.trim()) {
        const textStroke: DrawingStroke = {
          points: [coords],
          color: penColor,
          width: penWidth,
          text: enteredText.trim()
        };
        const updatedStrokes = [...currentSlideStrokes, textStroke];
        setDrawingUndoStack(prev => ({
          ...prev,
          [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
        }));
        setDrawingRedoStack(prev => ({
          ...prev,
          [activeSlideKey]: []
        }));
        updatePresenterStrokes(activeSlideKey, updatedStrokes);
      }
    } else if (penTool === 'arrow' || penTool === 'line' || penTool === 'circle' || penTool === 'rectangle') {
      const newStroke: DrawingStroke = {
        points: [coords, coords],
        color: penColor,
        width: penWidth,
        isArrow: penTool === 'arrow',
        isLine: penTool === 'line',
        isCircle: penTool === 'circle',
        isRectangle: penTool === 'rectangle'
      };
      activeDrawingStrokeRef.current = newStroke;
      setActiveDrawingStroke(newStroke);
      broadcastActiveStrokeLive(newStroke);
    } else {
      const newStroke: DrawingStroke = {
        points: [coords],
        color: penTool === 'highlighter' ? highlighterColor : penColor,
        width: penTool === 'highlighter' ? 24 : penWidth,
        isHighlighter: penTool === 'highlighter'
      };
      activeDrawingStrokeRef.current = newStroke;
      setActiveDrawingStroke(newStroke);
      broadcastActiveStrokeLive(newStroke);
    }
  };

  const handleDrawingPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPenActive || !isDrawingPointerDownRef.current) return;
    e.preventDefault();

    const coords = getDrawingCoordinates(e);
    if (!coords) return;

    if (penTool === 'eraser') {
      eraseStrokeAtPoint(coords);
    } else if ((penTool === 'arrow' || penTool === 'line' || penTool === 'circle' || penTool === 'rectangle') && activeDrawingStrokeRef.current) {
      const startPoint = activeDrawingStrokeRef.current.points[0];
      const updatedStroke: DrawingStroke = {
        ...activeDrawingStrokeRef.current,
        points: [startPoint, coords]
      };
      activeDrawingStrokeRef.current = updatedStroke;
      setActiveDrawingStroke(updatedStroke);
      broadcastActiveStrokeLive(updatedStroke);
    } else if (activeDrawingStrokeRef.current) {
      const updatedStroke: DrawingStroke = {
        ...activeDrawingStrokeRef.current,
        points: [...activeDrawingStrokeRef.current.points, coords]
      };
      activeDrawingStrokeRef.current = updatedStroke;
      setActiveDrawingStroke(updatedStroke);
      broadcastActiveStrokeLive(updatedStroke);
    }
  };

  const handleDrawingPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPenActive || !isDrawingPointerDownRef.current) return;
    e.preventDefault();
    isDrawingPointerDownRef.current = false;
    setIsDrawingPointerDown(false);

    const currentStroke = activeDrawingStrokeRef.current;
    if (currentStroke && currentStroke.points.length > 0) {
      const updatedStrokes = [...currentSlideStrokes, currentStroke];
      setDrawingUndoStack(prev => ({
        ...prev,
        [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
      }));
      setDrawingRedoStack(prev => ({ ...prev, [activeSlideKey]: [] }));

      updatePresenterStrokes(activeSlideKey, updatedStrokes);
    }
    activeDrawingStrokeRef.current = null;
    setActiveDrawingStroke(null);
    broadcastActiveStrokeLive(null);
  };

  const handleUndoDrawing = () => {
    const stack = drawingUndoStack[activeSlideKey] || [];
    if (stack.length === 0) return;
    const previousState = stack[stack.length - 1];
    const newStack = stack.slice(0, stack.length - 1);

    setDrawingRedoStack(prev => ({
      ...prev,
      [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
    }));
    setDrawingUndoStack(prev => ({
      ...prev,
      [activeSlideKey]: newStack
    }));

    updatePresenterStrokes(activeSlideKey, previousState);
  };

  const handleRedoDrawing = () => {
    const stack = drawingRedoStack[activeSlideKey] || [];
    if (stack.length === 0) return;
    const nextState = stack[stack.length - 1];
    const newStack = stack.slice(0, stack.length - 1);

    setDrawingUndoStack(prev => ({
      ...prev,
      [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
    }));
    setDrawingRedoStack(prev => ({
      ...prev,
      [activeSlideKey]: newStack
    }));

    updatePresenterStrokes(activeSlideKey, nextState);
  };

  const handleClearSlideDrawing = () => {
    if (currentSlideStrokes.length === 0) return;
    setDrawingUndoStack(prev => ({
      ...prev,
      [activeSlideKey]: [...(prev[activeSlideKey] || []), currentSlideStrokes]
    }));
    setDrawingRedoStack(prev => ({ ...prev, [activeSlideKey]: [] }));
    updatePresenterStrokes(activeSlideKey, []);
  };

  const [currentSlidePreviewUrl, setCurrentSlidePreviewUrl] = useState<string | null>(null);
  const [nextSlidePreviewUrl, setNextSlidePreviewUrl] = useState<string | null>(null);
  const [isUploadingPreview, setIsUploadingPreview] = useState(false);
  const [slidePreviewsMap, setSlidePreviewsMap] = useState<Record<number, string>>({});
  const [localImageErrors, setLocalImageErrors] = useState<Record<number, boolean>>({});

  // Subscribe to all slide background previews for this presentation
  useEffect(() => {
    if (!presentation?.id) {
      setSlidePreviewsMap({});
      return;
    }
    const q = query(
      collection(db, 'messages'),
      where('presentationId', '==', presentation.id),
      where('isBackgroundPreview', '==', true)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const map: Record<number, string> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.slide !== undefined && data.slide !== null && data.fileUrl) {
          map[data.slide] = data.fileUrl;
        }
      });
      setSlidePreviewsMap(map);
    }, (err) => {
      console.warn("ActiveDeck: Error loading all slide previews:", err);
    });
    return () => unsub();
  }, [presentation?.id]);

  useEffect(() => {
    if (!presentation?.id || currentSlide === null) {
      setCurrentSlidePreviewUrl(null);
      return;
    }
    const docId = `${presentation.id}_preview_slide_${currentSlide}`;
    const unsub = onSnapshot(doc(db, 'messages', docId), (docSnap) => {
      if (docSnap.exists()) {
        setCurrentSlidePreviewUrl(docSnap.data().fileUrl || null);
      } else {
        setCurrentSlidePreviewUrl(null);
      }
    }, (err) => {
      console.warn("ActiveDeck: Error loading current slide preview:", err);
    });
    return () => unsub();
  }, [presentation?.id, currentSlide]);

  useEffect(() => {
    if (!presentation?.id || nextSlide === null) {
      setNextSlidePreviewUrl(null);
      return;
    }
    const docId = `${presentation.id}_preview_slide_${nextSlide}`;
    const unsub = onSnapshot(doc(db, 'messages', docId), (docSnap) => {
      if (docSnap.exists()) {
        setNextSlidePreviewUrl(docSnap.data().fileUrl || null);
      } else {
        setNextSlidePreviewUrl(null);
      }
    }, (err) => {
      console.warn("ActiveDeck: Error loading next slide preview:", err);
    });
    return () => unsub();
  }, [presentation?.id, nextSlide]);

  const [localSlidesCount, setLocalSlidesCount] = useState<number>(0);
  const [nextSlideImageError, setNextSlideImageError] = useState<boolean>(false);

  const effectiveCurrentSlide = currentSlide !== null ? currentSlide : (presentation?.currentSlide ?? 1);
  const mapSlidesCount = Object.keys(slidePreviewsMap).length;
  
  const explicitTotal = (totalSlides !== null && totalSlides > 0) 
    ? totalSlides 
    : (presentation?.totalSlides && presentation.totalSlides > 0) 
      ? presentation.totalSlides 
      : 0;

  const knownTotal = Math.max(explicitTotal, localSlidesCount, mapSlidesCount);

  // Use known total slides if available; otherwise default to at least 20 (or currentSlide + 3) so full deck selector is always accessible
  const effectiveTotalSlides = knownTotal > 0 
    ? knownTotal 
    : Math.max(effectiveCurrentSlide + 3, 20);

  const effectiveNextSlide = (nextSlide !== null && nextSlide > 0)
    ? nextSlide
    : (effectiveCurrentSlide < effectiveTotalSlides ? effectiveCurrentSlide + 1 : null);

  const nextSlideLocalUrl = effectiveNextSlide !== null ? `http://127.0.0.1:5000/slides/${effectiveNextSlide}.jpg` : null;
  const nextSlideFirestoreUrl = effectiveNextSlide !== null ? (slidePreviewsMap[effectiveNextSlide] || null) : null;
  const nextSlideImgUrl = (isBridgeConnected && nextSlideBase64)
    ? nextSlideBase64
    : (effectiveNextSlide !== null && !nextSlideImageError && (isBridgeConnected || localSlidesCount >= effectiveNextSlide || localSlidesCount === 0))
      ? nextSlideLocalUrl
      : (nextSlideFirestoreUrl || null);

  useEffect(() => {
    setNextSlideImageError(false);
  }, [effectiveNextSlide]);

  useEffect(() => {
    let intervalId: any;

    const checkLocalExport = () => {
      if (isBridgeConnected) {
        fetch('http://127.0.0.1:5000/export')
          .then(res => res.json())
          .then(data => {
            if (data && data.success && typeof data.count === 'number' && data.count > 0) {
              console.log(`ActiveDeck: Successfully pre-exported ${data.count} slide previews locally.`);
              setLocalSlidesCount(data.count);
            }
          })
          .catch(err => {
            console.warn("ActiveDeck: Failed to pre-export slides via bridge:", err);
          });
      } else {
        setLocalSlidesCount(0);
      }
    };

    checkLocalExport();

    if (isBridgeConnected && localSlidesCount === 0 && totalSlides === null) {
      intervalId = setInterval(checkLocalExport, 2000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isBridgeConnected, localSlidesCount, totalSlides]);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number>(16 / 9);

  const effectiveAspectRatio = presentation?.slideAspectRatio || videoAspectRatio || (16 / 9);

  const presenterFrameRef = useRef<HTMLDivElement | null>(null);
  const projectorFrameRef = useRef<HTMLDivElement | null>(null);
  const actualProjectorFrameRef = useRef<HTMLDivElement | null>(null);

  const presenterBounds = useRenderedSlideBounds(presenterFrameRef, [isCapturing, isProjectorMode, presentWithNotes, videoAspectRatio]);
  const projectorBounds = useRenderedSlideBounds(projectorFrameRef, [isCapturing, isProjectorMode, videoAspectRatio]);
  const actualProjectorBounds = useRenderedSlideBounds(actualProjectorFrameRef, [isCapturing, isProjectorMode, videoAspectRatio]);


  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(62); // Default starting width percentage for left panel
  const [isResizingNotes, setIsResizingNotes] = useState(false);

  const [leftTopHeightPercent, setLeftTopHeightPercent] = useState<number>(55); // Default starting height percentage for left top panel
  const [isResizingLeftSplit, setIsResizingLeftSplit] = useState(false);

  const [rightTopHeightPercent, setRightTopHeightPercent] = useState<number>(45); // Default starting height percentage for right top panel
  const [isResizingRightSplit, setIsResizingRightSplit] = useState(false);

  const handleMouseDownPresenterNotesSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingNotes(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartPresenterNotesSplit = (e: React.TouchEvent) => {
    setIsResizingNotes(true);
  };

  const handleMouseDownLeftSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeftSplit(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartLeftSplit = (e: React.TouchEvent) => {
    setIsResizingLeftSplit(true);
  };

  const handleMouseDownRightSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRightSplit(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTouchStartRightSplit = (e: React.TouchEvent) => {
    setIsResizingRightSplit(true);
  };

  useEffect(() => {
    if (!isResizingNotes) return;

    const handleMouseMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const clientX = 'touches' in moveEvent ? (moveEvent as TouchEvent).touches[0].clientX : (moveEvent as MouseEvent).clientX;
      
      // Calculate position relative to container
      const relativeX = clientX - containerRect.left;
      let percent = (relativeX / containerRect.width) * 100;
      
      // Apply boundaries (minimum 45%, maximum 85% to prevent complete squishing)
      if (percent < 45) percent = 45;
      if (percent > 85) percent = 85;
      
      setLeftWidthPercent(percent);
    };

    const handleMouseUp = () => {
      setIsResizingNotes(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizingNotes]);

  useEffect(() => {
    if (!isResizingLeftSplit) return;

    const handleMouseMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const clientY = 'touches' in moveEvent ? (moveEvent as TouchEvent).touches[0].clientY : (moveEvent as MouseEvent).clientY;
      
      // Calculate position relative to container
      const relativeY = clientY - containerRect.top;
      let percent = (relativeY / containerRect.height) * 100;
      
      // Apply boundaries (minimum 20%, maximum 80% to prevent complete squishing of top or bottom)
      if (percent < 20) percent = 20;
      if (percent > 80) percent = 80;
      
      setLeftTopHeightPercent(percent);
    };

    const handleMouseUp = () => {
      setIsResizingLeftSplit(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizingLeftSplit]);

  useEffect(() => {
    if (!isResizingRightSplit) return;

    const handleMouseMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const clientY = 'touches' in moveEvent ? (moveEvent as TouchEvent).touches[0].clientY : (moveEvent as MouseEvent).clientY;
      
      // Calculate position relative to container
      const relativeY = clientY - containerRect.top;
      let percent = (relativeY / containerRect.height) * 100;
      
      // Apply boundaries (minimum 20%, maximum 80% to prevent complete squishing of top or bottom)
      if (percent < 20) percent = 20;
      if (percent > 80) percent = 80;
      
      setRightTopHeightPercent(percent);
    };

    const handleMouseUp = () => {
      setIsResizingRightSplit(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizingRightSplit]);

  const updateSlideAspectRatioInFirebase = async (ratio: number) => {
    if (!presentation?.id) return;
    try {
      if (!presentation.slideAspectRatio || Math.abs(presentation.slideAspectRatio - ratio) > 0.005) {
        await updateDoc(doc(db, 'presentations', presentation.id), {
          slideAspectRatio: Number(ratio.toFixed(4))
        });
      }
    } catch (err) {
      console.warn("ActiveDeck: Error updating slide aspect ratio in Firebase:", err);
    }
  };

  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video && video.videoWidth && video.videoHeight) {
      const ratio = video.videoWidth / video.videoHeight;
      console.log(`[PresenterArea] Video metadata loaded: ${video.videoWidth}x${video.videoHeight}, aspect ratio: ${ratio}`);
      setVideoAspectRatio(ratio);
      updateSlideAspectRatioInFirebase(ratio);
    }
  };

  const handleSlideImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img && img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (Math.abs(ratio - effectiveAspectRatio) > 0.005) {
        console.log(`[PresenterArea] Slide image natural aspect ratio loaded: ${img.naturalWidth}x${img.naturalHeight} (${ratio})`);
        setVideoAspectRatio(ratio);
        updateSlideAspectRatioInFirebase(ratio);
      }
    }
  };

  const lastUpdateRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCoordsRef = useRef<{ x: number; y: number } | null>(null);

  // Track manual advances or animation builds to trigger slide recaptures
  const [captureTrigger, setCaptureTrigger] = useState(0);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

  // Background 2-Stage Automatic Slide Preview Capture & Upload Effect (Immediate + Delayed Animation Capture)
  useEffect(() => {
    if (!presentation?.id || !isCapturing) return;

    const activeSlideNum = currentSlide !== null ? currentSlide : (presentation?.currentSlide || 1);
    setIsUploadingPreview(true);

    const captureAndUpload = async (stageName: string) => {
      try {
        let blob: Blob | null = null;

        // 1. Try to use WebSocket currentSlideBase64 if connected, matching activeSlideNum, and available
        if (isBridgeConnected && currentSlideBase64 && activeSlideNum === currentSlide) {
          try {
            const response = await fetch(currentSlideBase64);
            if (response.ok) {
              blob = await response.blob();
              console.log(`[SlidePreview 2-Stage] ${stageName} retrieved clean slide image from currentSlideBase64 for slide ${activeSlideNum}`);
            }
          } catch (base64Err) {
            console.warn(`[SlidePreview 2-Stage] ${stageName} failed to get blob from currentSlideBase64, falling back to bridge fetch:`, base64Err);
          }
        }

        // 2. Try to fetch clean, static slide image exported by the PowerPoint bridge if connected
        if (!blob && isBridgeConnected) {
          try {
            const slideUrl = `http://127.0.0.1:5000/slides/${activeSlideNum}.jpg`;
            const response = await fetch(slideUrl);
            if (response.ok) {
              blob = await response.blob();
              console.log(`[SlidePreview 2-Stage] ${stageName} fetched clean slide image from local bridge for slide ${activeSlideNum}`);
            } else {
              console.warn(`[SlidePreview 2-Stage] Local bridge returned status ${response.status} for slide ${activeSlideNum}`);
            }
          } catch (fetchErr) {
            console.warn(`[SlidePreview 2-Stage] ${stageName} failed to fetch clean slide image from bridge, falling back to video capture:`, fetchErr);
          }
        }

        // 3. Fallback to capturing the live screen shared video element if bridge image is unavailable
        if (!blob) {
          const video = containerRef.current?.querySelector('video') || videoRef.current;
          if (!video || !video.videoWidth || !video.videoHeight) {
            setIsUploadingPreview(false);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setIsUploadingPreview(false);
            return;
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          blob = await new Promise<Blob | null>((resolveBlob) => {
            canvas.toBlob((b) => resolveBlob(b), 'image/jpeg', 0.65);
          });
        }

        if (!blob) {
          setIsUploadingPreview(false);
          return;
        }

        try {
          const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
          const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

          const fileId = Math.random().toString(36).substring(2, 11);
          const fileName = `Slide_Preview_Slide_${activeSlideNum}_${Date.now()}.jpg`;
          const storagePath = `presentations/${presentation.id}/documents/${fileId}_${fileName}`;
          const storageRef = ref(storage, storagePath);

          await uploadBytes(storageRef, blob);
          const downloadUrl = await getDownloadURL(storageRef);

          const docId = `${presentation.id}_preview_slide_${activeSlideNum}`;
          await setDoc(doc(db, 'messages', docId), {
            presentationId: presentation.id,
            slide: activeSlideNum,
            fileUrl: downloadUrl,
            isBackgroundPreview: true,
            isPushedSlide: false,
            timestamp: serverTimestamp()
          });

          console.log(`[SlidePreview 2-Stage] ${stageName} upload complete for slide ${activeSlideNum}!`);
        } catch (uploadErr) {
          console.error(`[SlidePreview 2-Stage] ${stageName} upload failed:`, uploadErr);
        } finally {
          setIsUploadingPreview(false);
        }
      } catch (err) {
        console.error(`[SlidePreview 2-Stage] Error in ${stageName}:`, err);
        setIsUploadingPreview(false);
      }
    };

    // Stage 1: Delayed push (1500ms) so transitions are finished before capture
    const immediateTimeoutId = setTimeout(() => {
      captureAndUpload('Stage 1 (Delayed)');
    }, 1500);

    // Stage 2: Updated push after animations/build-ins complete (4000ms)
    const delayedTimeoutId = setTimeout(() => {
      captureAndUpload('Stage 2 (Animation Complete)');
    }, 4000);

    return () => {
      clearTimeout(immediateTimeoutId);
      clearTimeout(delayedTimeoutId);
    };
  }, [currentSlide, presentation?.currentSlide, isCapturing, presentation?.id, captureTrigger]);

  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);



  const [isPushingToNotes, setIsPushingToNotes] = useState(false);

  const handlePushImageToNotes = async () => {
    if (!presentation?.id || isPushingToNotes) return;

    try {
      setIsPushingToNotes(true);
      const video = containerRef.current?.querySelector('video') || videoRef.current;
      if (!video) {
        alert("No active display stream found to capture. Please start presenting first.");
        setIsPushingToNotes(false);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsPushingToNotes(false);
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          setIsPushingToNotes(false);
          return;
        }

        try {
          const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
          const { collection, addDoc, doc, setDoc, serverTimestamp } = await import('firebase/firestore');

          const timestamp = Date.now();
          const customTabId = `note_pushed_${timestamp}`;
          const fileId = Math.random().toString(36).substring(2, 11);
          const fileName = `Pushed_Notes_Image_${timestamp}.jpg`;
          const storagePath = `presentations/${presentation.id}/documents/${fileId}_${fileName}`;
          const storageRef = ref(storage, storagePath);

          await uploadBytes(storageRef, blob);
          const downloadUrl = await getDownloadURL(storageRef);

          const currentSlideNum = currentSlide !== null ? currentSlide : (presentation?.currentSlide || 1);

          await addDoc(collection(db, 'messages'), {
            presentationId: presentation.id,
            slide: customTabId,
            fileUrl: downloadUrl,
            isBackgroundPreview: true,
            isCustomNoteTab: true,
            position: currentSlideNum + 0.1,
            timestamp: serverTimestamp()
          });

          // Also set standard slide preview doc for active slide so indicator turns green immediately
          const previewDocId = `${presentation.id}_preview_slide_${currentSlideNum}`;
          await setDoc(doc(db, 'messages', previewDocId), {
            presentationId: presentation.id,
            slide: currentSlideNum,
            fileUrl: downloadUrl,
            isBackgroundPreview: true,
            isPushedSlide: true,
            timestamp: serverTimestamp()
          });

          console.log(`[Push Image to Notes] Successfully pushed display image for tab ${customTabId}!`);
        } catch (err) {
          console.error("[Push Image to Notes] Upload error:", err);
          alert("Failed to push image to notes. Please try again.");
        } finally {
          setIsPushingToNotes(false);
        }
      }, 'image/jpeg', 0.85);

    } catch (err) {
      console.error("[Push Image to Notes] Capture error:", err);
      setIsPushingToNotes(false);
    }
  };

  const updateLaserPositionInFirebase = async (x: number, y: number, active: boolean) => {
    if (!presentation?.id) return;
    try {
      await updateDoc(doc(db, 'presentations', presentation.id), {
        laserX: Number(x.toFixed(2)),
        laserY: Number(y.toFixed(2)),
        laserActive: active
      });
    } catch (err) {
      console.warn("Error updating laser position in Firebase:", err);
    }
  };

  const updateLaserPosition = (x: number, y: number, active: boolean) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (!active) {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      pendingCoordsRef.current = null;
      lastUpdateRef.current = now;
      updateLaserPositionInFirebase(x, y, false);
      return;
    }

    if (timeSinceLastUpdate >= 40) {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      pendingCoordsRef.current = null;
      lastUpdateRef.current = now;
      updateLaserPositionInFirebase(x, y, true);
    } else {
      pendingCoordsRef.current = { x, y };

      if (!throttleTimeoutRef.current) {
        const remaining = 40 - timeSinceLastUpdate;
        throttleTimeoutRef.current = setTimeout(() => {
          throttleTimeoutRef.current = null;
          if (pendingCoordsRef.current) {
            const { x: px, y: py } = pendingCoordsRef.current;
            pendingCoordsRef.current = null;
            lastUpdateRef.current = Date.now();
            updateLaserPositionInFirebase(px, py, true);
          }
        }, remaining);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isProjectorMode || !presentation?.id || !isCapturing || !laserEnabled) return;

    const container = e.currentTarget;
    const b = getRenderedSlideBounds(container);
    if (!b || b.renderedWidth === 0 || b.renderedHeight === 0) return;

    const rect = container.getBoundingClientRect();
    const contentX = e.clientX - rect.left - b.offsetX;
    const contentY = e.clientY - rect.top - b.offsetY;

    const clampedX = Math.max(0, Math.min(b.renderedWidth, contentX));
    const clampedY = Math.max(0, Math.min(b.renderedHeight, contentY));

    const x = (clampedX / b.renderedWidth) * 100;
    const y = (clampedY / b.renderedHeight) * 100;

    updateLaserPosition(x, y, true);
  };

  const handleMouseLeave = () => {
    if (isProjectorMode || !presentation?.id) return;
    updateLaserPosition(0, 0, false);
  };

  useEffect(() => {
    const fetchTheme = async () => {
      const docSnap = await getDoc(doc(db, 'settings', 'global'));
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.theme?.secondaryColor) {
          setSecondaryColor(data.theme.secondaryColor);
        }
      }
    };
    fetchTheme();
  }, []);

  // Auto-scroll the active slide button in the deck navigator into view only when out of bounds
  useEffect(() => {
    if (currentSlide !== null) {
      const container = document.getElementById('deck-navigator-scroll-container');
      const element = document.getElementById(`nav-slide-${currentSlide}`);
      if (container && element) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const elementTop = element.offsetTop;
        const elementBottom = elementTop + element.clientHeight;

        if (elementTop < containerTop) {
          container.scrollTo({
            top: elementTop,
            behavior: 'smooth'
          });
        } else if (elementBottom > containerBottom) {
          container.scrollTo({
            top: elementBottom - container.clientHeight,
            behavior: 'smooth'
          });
        }
      }
    }
  }, [currentSlide]);

  const handleSlideMove = (direction: 'next' | 'prev') => {
    sendSlideCommand(direction);
    setCaptureTrigger(prev => prev + 1);
  };

  // Keyboard navigation listener to capture animations/slides via remote clicker or keyboard
  useEffect(() => {
    if (!isCapturing) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when focusing inputs or textareas
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'Space') {
        e.preventDefault();
        handleSlideMove('next');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSlideMove('prev');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isCapturing, currentSlide, presentation?.currentSlide]);

  const compositeSlideWithAnnotations = (
    slideImgUrl: string,
    presenterDrawingsJson?: string
  ): Promise<Uint8Array | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1920;
        canvas.height = img.naturalHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        // Draw base slide image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const drawStrokeList = (strokes: any[]) => {
          strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length === 0) return;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const scaleX = canvas.width / 1000;
            const scaleY = canvas.height / 1000;
            const avgScale = (scaleX + scaleY) / 2;

            ctx.lineWidth = stroke.width * avgScale;

            if (stroke.isHighlighter) {
              ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
            } else {
              ctx.strokeStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
              ctx.fillStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
            }

            const pts = stroke.points.map((p: any) => ({
              x: p.x * scaleX,
              y: p.y * scaleY
            }));

            if (stroke.text && pts[0]) {
              const fontSize = Math.max(26, stroke.width * 5) * avgScale;
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.fillText(stroke.text, pts[0].x, pts[0].y);
            } else if (stroke.isArrow && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const angle = Math.atan2(dy, dx);
              const headLength = Math.max(25, stroke.width * 4) * avgScale;
              const arrowAngle = Math.PI / 6;

              const h1x = p2.x - headLength * Math.cos(angle - arrowAngle);
              const h1y = p2.y - headLength * Math.sin(angle - arrowAngle);
              const h2x = p2.x - headLength * Math.cos(angle + arrowAngle);
              const h2y = p2.y - headLength * Math.sin(angle + arrowAngle);

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h1x, h1y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h2x, h2y);
              ctx.stroke();
            } else {
              ctx.beginPath();
              pts.forEach((p: any, i: number) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              });
              if (pts.length === 1) {
                ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
              }
              ctx.stroke();
            }
            ctx.restore();
          });
        };

        // Draw Presenter Drawings
        if (presenterDrawingsJson) {
          try {
            const pStrokes = JSON.parse(presenterDrawingsJson);
            if (Array.isArray(pStrokes)) drawStrokeList(pStrokes);
          } catch {}
        }

        // Convert base64 dataUri to Uint8Array directly
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const parts = dataUrl.split(',');
          if (parts.length >= 2) {
            const binaryStr = window.atob(parts[1]);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            resolve(bytes);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      };

      img.onerror = () => {
        // Fallback fetch
        fetch(slideImgUrl)
          .then(res => res.arrayBuffer())
          .then(buf => resolve(new Uint8Array(buf)))
          .catch(() => resolve(null));
      };

      img.src = slideImgUrl;
    });
  };

  const handleDownloadPresentation = async (includeChat = false) => {
    if (!presentation?.id) return;
    setIsDownloadingPresentation(true);
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle } = await import('docx');

      const q = query(
        collection(db, 'messages'),
        where('presentationId', '==', presentation.id),
        where('isBackgroundPreview', '==', true)
      );

      const querySnapshot = await getDocs(q);
      const previewsMap: Record<string, string> = {};
      querySnapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.slide !== undefined && data.slide !== null && data.fileUrl) {
          previewsMap[String(data.slide)] = data.fileUrl;
        }
      });

      const sortedSlides = Object.keys(previewsMap).sort((a, b) => {
        const numA = Number(a);
        const numB = Number(b);
        if (isNaN(numA) || isNaN(numB)) return a.localeCompare(b);
        return numA - numB;
      });

      if (sortedSlides.length === 0) {
        alert("No slides have been captured yet for this presentation. Present slides first!");
        setIsDownloadingPresentation(false);
        return;
      }

      const slideElements: any[] = [];

      for (const slide of sortedSlides) {
        const slideNum = Number(slide);
        const titleStr = isNaN(slideNum) ? slide : `Slide ${slide}`;
        slideElements.push(
          new Paragraph({
            text: titleStr,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 }
          })
        );

        const slideImgUrl = previewsMap[slide];
        if (slideImgUrl) {
          const presenterJson = presentation?.presenterDrawings?.[slide];
          const imgBytes = await compositeSlideWithAnnotations(slideImgUrl, presenterJson);
          if (imgBytes) {
            slideElements.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imgBytes,
                    transformation: { width: 500, height: 280 },
                    type: 'png'
                  })
                ],
                spacing: { after: 180 }
              })
            );
          }
        }
      }

      const activityElements: any[] = [];
      if (includeChat) {
        // Query database for chat history and activities
        const msgsQuery = query(collection(db, 'messages'), where('presentationId', '==', presentation.id));
        const msgsSnap = await getDocs(msgsQuery);
        const msgs = msgsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((m: any) => !m.isBackgroundPreview) as Message[];
        msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));

        const pollsQuery = query(collection(db, 'polls'), where('presentationId', '==', presentation.id));
        const pollsSnap = await getDocs(pollsQuery);
        const ps = pollsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Poll[];
        ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const wcQuery = query(collection(db, 'wordClouds'), where('presentationId', '==', presentation.id));
        const wcSnap = await getDocs(wcQuery);
        const wcs = wcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as WordCloud[];
        wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const oeqQuery = query(collection(db, 'openEndedQuestions'), where('presentationId', '==', presentation.id));
        const oeqSnap = await getDocs(oeqQuery);
        const oeqs = oeqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as OpenEndedQuestion[];
        oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const combinedItems = [
          ...msgs.map(m => ({ ...m, type: 'message' as const })),
          ...ps.map(p => ({ ...p, type: 'poll' as const })),
          ...wcs.map(w => ({ ...w, type: 'wordCloud' as const })),
          ...oeqs.map(q => ({ ...q, type: 'openEnded' as const }))
        ].sort((a, b) => {
          const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
          const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
          return timeA - timeB;
        });

        activityElements.push(
          new Paragraph({
            text: "Session Activity & Chat Log",
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: true,
            spacing: { before: 240, after: 200 }
          })
        );

        if (combinedItems.length === 0) {
          activityElements.push(
            new Paragraph({
              text: "No chat messages or session activities recorded.",
              spacing: { before: 120, after: 120 }
            })
          );
        } else {
          let runningMessageRows: any[] = [];

          const flushMessages = () => {
            if (runningMessageRows.length > 0) {
              const tableHeader = new TableRow({
                children: [
                  new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Date", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Time", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Slide", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Email", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Question / Message", bold: true, font: "Arial", size: 18 })] })] }),
                ]
              });
              activityElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [tableHeader, ...runningMessageRows]
                }),
                new Paragraph({ spacing: { after: 240 } })
              );
              runningMessageRows = [];
            }
          };

          for (const item of combinedItems) {
            if (item.type === 'message') {
              const m = item as Message;
              const dateObj = m.timestamp?.toDate() || new Date();
              const dateStr = dateObj.toLocaleDateString();
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const slideStr = m.slide !== undefined && m.slide !== null ? `Slide ${m.slide}` : '-';
              const nameStr = m.userName || '-';
              const emailStr = m.userEmail || '-';
              const textStr = m.text || '';
              const likesStr = m.likes ? ` (👍 ${m.likes})` : '';

              const cellBorders = {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" }
              };

              runningMessageRows.push(
                new TableRow({
                  children: [
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: dateStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: timeStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: slideStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: nameStr, font: "Arial", size: 18, bold: true })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: emailStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [
                      new TextRun({ text: textStr, font: "Arial", size: 18 }),
                      ...(likesStr ? [new TextRun({ text: likesStr, font: "Arial", size: 18, bold: true, color: "854D0E" })] : [])
                    ] })] }),
                  ]
                })
              );
            } else {
              flushMessages();

              const cellBorders = {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" }
              };

              if (item.type === 'poll') {
                const p = item as Poll;
                const dateObj = p.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = p.slide !== undefined ? ` [Slide ${p.slide}]` : '';
                const totalVotes = Object.values(p.votes || {}).reduce((sum, val) => sum + val, 0);

                activityElements.push(
                  new Paragraph({
                    text: "📊 MCQ POLL RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const pollRows = p.options.map(opt => {
                  const count = p.votes[opt] || 0;
                  const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                  const isCorrect = p.correctAnswer === opt;
                  return new TableRow({
                    children: [
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [new TextRun({ text: `Option ${opt}`, bold: true, font: "Arial", size: 18 })] })]
                      }),
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 40, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [new TextRun({ text: `${count} votes (${percentage}%)`, font: "Arial", size: 18 })] })]
                      }),
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [
                          ...(isCorrect ? [new TextRun({ text: "✓ CORRECT ANSWER", bold: true, color: "10B981", font: "Arial", size: 18 })] : [])
                        ] })]
                      })
                    ]
                  });
                });

                activityElements.push(
                  new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: pollRows
                  }),
                  new Paragraph({ spacing: { after: 120 } }),
                  new Paragraph({
                    children: [new TextRun({ text: `Total Votes: ${totalVotes}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { after: 240 }
                  })
                );

              } else if (item.type === 'wordCloud') {
                const w = item as WordCloud;
                const dateObj = w.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = w.slide !== undefined ? ` [Slide ${w.slide}]` : '';
                const totalWords = Object.values(w.words || {}).reduce((sum, val) => sum + val, 0);

                activityElements.push(
                  new Paragraph({
                    text: "☁️ WORD CLOUD RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true }),
                      new TextRun({ text: `\nPrompt: "${w.prompt}"`, bold: true, font: "Arial", size: 18 })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const wordRows = Object.entries(w.words || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([word, count]) => {
                    return new TableRow({
                      children: [
                        new TableCell({
                          borders: cellBorders,
                          width: { size: 70, type: WidthType.PERCENTAGE },
                          children: [new Paragraph({ children: [new TextRun({ text: word, bold: true, font: "Arial", size: 18 })] })]
                        }),
                        new TableCell({
                          borders: cellBorders,
                          width: { size: 30, type: WidthType.PERCENTAGE },
                          children: [new Paragraph({ children: [new TextRun({ text: `${count} submissions`, font: "Arial", size: 18 })] })]
                        })
                      ]
                    });
                  });

                activityElements.push(
                  new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: wordRows
                  }),
                  new Paragraph({ spacing: { after: 120 } }),
                  new Paragraph({
                    children: [new TextRun({ text: `Total Submissions: ${totalWords}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { after: 240 }
                  })
                );

              } else if (item.type === 'openEnded') {
                const q = item as OpenEndedQuestion;
                const dateObj = q.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = q.slide !== undefined ? ` [Slide ${q.slide}]` : '';
                const totalResponses = Object.values(q.responses || {}).length;

                activityElements.push(
                  new Paragraph({
                    text: "💬 OPEN ENDED RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true }),
                      new TextRun({ text: `\nQuestion: "${q.prompt}"`, bold: true, font: "Arial", size: 18 })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const responseParagraphs = Object.values(q.responses || {}).map(resp => {
                  return new Paragraph({
                    children: [
                      new TextRun({ text: `• `, bold: true, font: "Arial", size: 18 }),
                      new TextRun({ text: `"${resp}"`, italics: true, font: "Arial", size: 18, color: "334155" })
                    ],
                    spacing: { before: 60, after: 60 }
                  });
                });

                activityElements.push(
                  ...responseParagraphs,
                  new Paragraph({
                    children: [new TextRun({ text: `Total Responses: ${totalResponses}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { before: 120, after: 240 }
                  })
                );
              }
            }
          }

          flushMessages();
        }
      }

      const docFilename = `ActiveDeck_Presentation_${presentation.pinCode || 'Export'}.docx`;

      const docxFile = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: "ActiveDeck Presentation Export",
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 200 }
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                left: { style: BorderStyle.SINGLE, size: 24, color: "EB5D00" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
              },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      shading: { fill: "F8F9FA" },
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Presenter Email: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: presentation.presenterEmail || 'N/A', font: "Arial" }),
                          ],
                        }),
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Session PIN: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: presentation.pinCode || 'N/A', font: "Arial" }),
                          ],
                        }),
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Date: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: new Date().toLocaleDateString(), font: "Arial" }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ spacing: { after: 240 } }),
            ...slideElements,
            ...activityElements
          ]
        }]
      });

      const docBlob = await Packer.toBlob(docxFile);
      const docUrl = URL.createObjectURL(docBlob);
      const link = document.createElement('a');
      link.href = docUrl;
      link.download = docFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(docUrl);
    } catch (err) {
      console.error("Failed to compile presentation export:", err);
      alert("Failed to export presentation document.");
    } finally {
      setIsDownloadingPresentation(false);
    }
  };

  const handleDownloadOnlyChat = async () => {
    if (!presentation?.id) return;
    setIsDownloadingPresentation(true);
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');

      const msgsQuery = query(
        collection(db, 'messages'),
        where('presentationId', '==', presentation.id)
      );
      const msgsSnap = await getDocs(msgsQuery);
      const msgs = msgsSnap.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter((m: any) => !m.isBackgroundPreview) as Message[];

      msgs.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || 0;
        return timeA - timeB;
      });

      const pollsQuery = query(
        collection(db, 'polls'),
        where('presentationId', '==', presentation.id)
      );
      const pollsSnap = await getDocs(pollsQuery);
      const ps = pollsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Poll[];
      ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      const wcQuery = query(
        collection(db, 'wordClouds'),
        where('presentationId', '==', presentation.id)
      );
      const wcSnap = await getDocs(wcQuery);
      const wcs = wcSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WordCloud[];
      wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      const oeqQuery = query(
        collection(db, 'openEndedQuestions'),
        where('presentationId', '==', presentation.id)
      );
      const oeqSnap = await getDocs(oeqQuery);
      const oeqs = oeqSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as OpenEndedQuestion[];
      oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      const themeAccentColor = secondaryColor || '#ff3e00';

      const header = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>ActiveDeck Chat & Poll Log</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    margin: 40px;
    background-color: #f8fafc;
    line-height: 1.5;
  }
  .container {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    background-color: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    text-align: left;
  }
  .header {
    border-bottom: 3px solid ${themeAccentColor};
    padding-bottom: 20px;
    margin-bottom: 30px;
    text-align: center;
  }
  .header h1 {
    font-size: 26px;
    margin: 0 0 8px 0;
    color: #0f172a;
    font-weight: 800;
    text-align: center;
  }
  .header p {
    font-size: 13px;
    color: #64748b;
    margin: 0;
    text-align: center;
  }
  .log-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 30px;
    table-layout: fixed;
  }
  .log-table th {
    background-color: #f1f5f9;
    color: #475569;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 6px;
    border-bottom: 2px solid #cbd5e1;
    text-align: left;
  }
  .log-table td {
    padding: 12px 6px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 13px;
    vertical-align: top;
    color: #334155;
    word-break: break-word;
    word-wrap: break-word;
  }
  .badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .badge-slide {
    background-color: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
  }
  .badge-likes {
    background-color: #fef08a;
    color: #854d0e;
    border: 1px solid #fde047;
    margin-left: 4px;
  }
  .card {
    width: 100%;
    border-collapse: collapse;
    margin: 24px 0;
    border-radius: 8px;
  }
  .card td {
    padding: 20px;
    border: none;
    text-align: left;
    vertical-align: top;
  }
  .card-title {
    font-weight: 800;
    font-size: 15px;
    margin: 0 0 4px 0;
    color: #0f172a;
    text-align: center;
  }
  .card-meta {
    font-size: 11px;
    color: #64748b;
    margin: 0 0 16px 0;
    text-align: center;
  }
  .card-subtitle {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
    margin: 0 0 12px 0;
    text-align: center;
  }
  .poll-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .poll-table td {
    padding: 6px 10px;
    border: none;
    font-size: 13px;
  }
  .word-pill {
    display: inline-block;
    padding: 5px 10px;
    background-color: #ffffff;
    color: #1e293b;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    margin-right: 6px;
    margin-bottom: 6px;
    font-size: 12px;
    word-break: break-all;
  }
  .response-box {
    padding: 10px 14px;
    background-color: #ffffff;
    border-left: 3px solid #10b981;
    border-radius: 0 4px 4px 0;
    margin-bottom: 8px;
    font-style: italic;
    font-size: 13px;
    color: #334155;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    word-break: break-word;
    word-wrap: break-word;
  }
</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 40px; background-color: #f8fafc; line-height: 1.5;">
  <table align="center" width="100%" style="width: 100%; max-width: 720px; margin: 0 auto; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); text-align: left;">
    <tr>
      <td style="padding: 40px; border: none; vertical-align: top; background-color: #ffffff;">
        <div class="header" style="border-bottom: 3px solid ${themeAccentColor}; padding-bottom: 20px; margin-bottom: 30px; text-align: center;">
          <h1 style="font-size: 26px; margin: 0 0 8px 0; color: #0f172a; font-weight: 800; text-align: center;">ActiveDeck Session Activity Log</h1>
          <p style="font-size: 13px; color: #64748b; margin: 0; text-align: center;">Generated on ${new Date().toLocaleString()}</p>
        </div>`;

      const footer = "</td></tr></table></body></html>";

      const combinedItems = [
        ...msgs.map(m => ({ ...m, type: 'message' as const })),
        ...ps.map(p => ({ ...p, type: 'poll' as const })),
        ...wcs.map(w => ({ ...w, type: 'wordCloud' as const })),
        ...oeqs.map(q => ({ ...q, type: 'openEnded' as const }))
      ].sort((a, b) => {
        const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
        const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
        return timeA - timeB;
      });

      let htmlContent = '';
      let isTableOpen = false;

      combinedItems.forEach(item => {
        if (item.type === 'message') {
          const m = item as Message;
          const dateObj = m.timestamp?.toDate() || new Date();
          const dateStr = dateObj.toLocaleDateString();
          const timeStr = dateObj.toLocaleTimeString();

          if (!isTableOpen) {
            htmlContent += `<table class="log-table" style="width: 100%; border-collapse: collapse; margin-bottom: 30px; table-layout: fixed;">
              <thead>
                <tr style="background-color: #f1f5f9;">
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 10%;">Date</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 12%;">Time</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 8%;">Slide</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 13%;">Name</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 17%;">Email</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 40%;">Question / Message</th>
                </tr>
              </thead>
              <tbody>`;
            isTableOpen = true;
          }

          const slideBadge = m.slide !== undefined && m.slide !== null
            ? `<span class="badge badge-slide" style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">Slide ${m.slide}</span>`
            : `-`;

          const likesBadge = m.likes 
            ? `<span class="badge badge-likes" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; background-color: #fef08a; color: #854d0e; border: 1px solid #fde047; margin-left: 4px;">👍 ${m.likes}</span>`
            : '';

          const emailLink = m.userEmail
            ? `<a href="mailto:${m.userEmail}" style="color: #2563eb; text-decoration: none; border-bottom: 1px dotted #2563eb; word-break: break-all;">${m.userEmail}</a>`
            : '-';

          const cleanText = m.text ? m.text.replace(/(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, (match) => {
            if (match.includes('@')) return `<a href="mailto:${match}" style="color: #2563eb; text-decoration: underline;">${match}</a>`;
            const url = match.startsWith('http') ? match : `https://${match}`;
            return `<a href="${url}" target="_blank" style="color: #2563eb; text-decoration: underline;">${match}</a>`;
          }) : '';

          htmlContent += `<tr>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${dateStr}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${timeStr}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${slideBadge}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; font-weight: 600; text-align: left; word-break: break-word; word-wrap: break-word;">${m.userName}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-all; word-wrap: break-word;">${emailLink}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-word; word-wrap: break-word;"><strong>${cleanText}</strong>${likesBadge}</td>
          </tr>`;
        } else {
          if (isTableOpen) {
            htmlContent += `</tbody></table>`;
            isTableOpen = false;
          }

          if (item.type === 'poll') {
            const p = item as Poll;
            const dateObj = p.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = p.slide !== undefined ? ` [Slide ${p.slide}]` : '';
            const totalVotes = Object.values(p.votes || {}).reduce((a, b) => a + b, 0);

            let pollOptionsHtml = '';
            p.options.forEach(opt => {
              const count = p.votes[opt] || 0;
              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isCorrect = p.correctAnswer === opt;
              const correctBadge = isCorrect 
                ? `<span style="color: #10b981; font-weight: bold; margin-left: 8px; font-size: 12px;">✓ CORRECT ANSWER</span>` 
                : '';

              pollOptionsHtml += `<tr>
                <td style="width: 15%; font-weight: bold; padding: 6px 10px; border: none; font-size: 13px;">Option ${opt}</td>
                <td style="width: 50%; padding: 6px 10px; border: none;">
                  <table style="width: 100%; border: 1px solid #cbd5e1; border-collapse: collapse; height: 16px;">
                    <tr>
                      <td style="width: ${percentage}%; background-color: ${themeAccentColor}; border: none; padding: 0; height: 16px;"></td>
                      <td style="width: ${100 - percentage}%; background-color: #f1f5f9; border: none; padding: 0; height: 16px;"></td>
                    </tr>
                  </table>
                </td>
                <td style="width: 35%; padding: 6px 10px; border: none; font-size: 13px; word-break: break-word; word-wrap: break-word;">
                  <strong>${count} votes</strong> (${percentage}%)${correctBadge}
                </td>
              </tr>`;
            });

            htmlContent += `<table class="card card-mcq" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #fff5f2; border: 1px solid #fca5a5; border-left: 6px solid ${themeAccentColor}; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">📊 MCQ POLL RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <table class="poll-table" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                    ${pollOptionsHtml}
                  </table>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Votes: ${totalVotes}</p>
                </td>
              </tr>
            </table>`;

          } else if (item.type === 'wordCloud') {
            const w = item as WordCloud;
            const dateObj = w.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = w.slide !== undefined ? ` [Slide ${w.slide}]` : '';
            const totalWords = Object.values(w.words || {}).reduce((a, b) => a + b, 0);

            let wordPillsHtml = '';
            Object.entries(w.words || {}).sort((a, b) => b[1] - a[1]).forEach(([word, count]) => {
              wordPillsHtml += `<span class="word-pill" style="display: inline-block; padding: 5px 10px; background-color: #ffffff; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 16px; margin-right: 6px; margin-bottom: 6px; font-size: 12px; word-break: break-all;">
                <strong>${word}</strong> (${count})
              </span>`;
            });

            htmlContent += `<table class="card card-wordcloud" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #eff6ff; border: 1px solid #93c5fd; border-left: 6px solid #3b82f6; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">☁️ WORD CLOUD RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <h4 class="card-subtitle" style="font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 12px 0; text-align: center;">Prompt: "${w.prompt}"</h4>
                  <div style="margin-top: 12px; margin-bottom: 12px; text-align: center;">
                    ${wordPillsHtml || '<p style="font-size: 13px; color: #64748b; font-style: italic; text-align: center;">No entries recorded</p>'}
                  </div>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Submissions: ${totalWords}</p>
                </td>
              </tr>
            </table>`;

          } else if (item.type === 'openEnded') {
            const q = item as OpenEndedQuestion;
            const dateObj = q.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = q.slide !== undefined ? ` [Slide ${q.slide}]` : '';
            const totalResponses = Object.values(q.responses || {}).length;

            let responsesHtml = '';
            Object.values(q.responses || {}).forEach(response => {
              responsesHtml += `<div class="response-box" style="padding: 10px 14px; background-color: #ffffff; border-left: 3px solid #10b981; border-radius: 0 4px 4px 0; margin-bottom: 8px; font-style: italic; font-size: 13px; color: #334155; border-top: none; border-right: none; border-bottom: none; word-break: break-word; word-wrap: break-word;">
                "${response}"
              </div>`;
            });

            htmlContent += `<table class="card card-openended" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #f0fdf4; border: 1px solid #6ee7b7; border-left: 6px solid #10b981; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">💬 OPEN ENDED RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <h4 class="card-subtitle" style="font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 12px 0; text-align: center;">Question: "${q.prompt}"</h4>
                  <div style="margin-top: 12px; margin-bottom: 12px;">
                    ${responsesHtml || '<p style="font-size: 13px; color: #64748b; font-style: italic; text-align: center;">No responses recorded</p>'}
                  </div>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Responses: ${totalResponses}</p>
                </td>
              </tr>
            </table>`;
          }
        }
      });

      if (isTableOpen) {
        htmlContent += `</tbody></table>`;
      }

      const html = header + htmlContent + footer;
      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat-log-${presentation.pinCode || 'Export'}.doc`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download chat log:", err);
      alert("Failed to download chat log.");
    } finally {
      setIsDownloadingPresentation(false);
    }
  };

  const startCapture = () => {
    setError(null);
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      .then(async (mediaStream) => {
        setError(null);
        setStream(mediaStream);
        setIsCapturing(true);

        // Expose mediaStream globally so the projector window can access it
        (window as any).activeDeckStream = mediaStream;

        // Broadcast that stream has started
        try {
          const channel = new BroadcastChannel('activedeck-stream');
          channel.postMessage({ type: 'stream-started' });
          channel.close();
        } catch (bcErr) {
          console.error("ActiveDeck: Error broadcasting stream-started:", bcErr);
        }
        // Only create a new presentation session if one doesn't exist yet
        let activePresentationId = presentation?.id;
        if (!presentation && onCreatePresentation) {
          try {
            activePresentationId = await onCreatePresentation();
          } catch (createErr) {
            console.error("ActiveDeck: Error creating presentation session:", createErr);
            mediaStream.getTracks().forEach(track => track.stop());
            setStream(null);
            setIsCapturing(false);
            setError("Failed to initialize presentation session in database.");
            return;
          }
        }

        // Set the current slide in database to 1 as soon as the presentation starts
        if (activePresentationId) {
          try {
            await updateDoc(doc(db, 'presentations', activePresentationId), {
              currentSlide: 1
            });
            console.log("ActiveDeck: Automatically set currentSlide to 1 in Firebase upon starting presentation.");
          } catch (updateErr) {
            console.error("ActiveDeck: Failed to set initial slide to 1 in Firebase:", updateErr);
          }
        }

        mediaStream.getVideoTracks()[0].onended = () => {
          stopCapture();
        };
      })
      .catch((err: any) => {
        console.error("ActiveDeck: Error starting screen capture:", err);
        if (err.name === 'NotAllowedError' && err.message.includes('permissions policy')) {
          setError("Browser Security: Screen capture is blocked inside the editor's preview window. Please use the 'Shared App URL' or the 'Open in New Tab' icon in the top right to present.");
        } else if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          // Gracefully return to the main instructions screen if the user cancels or denies the request
          setError(null);
        } else {
          setError("Failed to start screen capture. Please ensure your browser supports screen sharing.");
        }
        setIsCapturing(false);
      });
  };

  const stopCapture = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCapturing(false);
    (window as any).activeDeckStream = null;

    // Reset drawings locally and exit pen mode
    setIsPenActive(false);
    setPresenterStrokesMap({});
    setActiveDrawingStroke(null);
    activeDrawingStrokeRef.current = null;
    setDrawingUndoStack({});
    setDrawingRedoStack({});

    // Erase drawings in Firebase and broadcast clear-all-drawings to student & projector screens
    if (presentation?.id) {
      updateDoc(doc(db, 'presentations', presentation.id), {
        presenterDrawings: {},
        activeDrawingStrokeJSON: null
      }).catch(err => {
        console.error("ActiveDeck: Error clearing drawings in Firebase on stop capture:", err);
      });
    }

    try {
      const channel = new BroadcastChannel('activedeck-presenter-drawing');
      channel.postMessage({
        type: 'clear-all-drawings',
        presentationId: presentation?.id
      });
      channel.close();
    } catch (e) {}

    // Broadcast that stream has stopped
    try {
      const channel = new BroadcastChannel('activedeck-stream');
      channel.postMessage({ type: 'stream-stopped' });
      channel.close();
    } catch (bcErr) {
      console.error("ActiveDeck: Error broadcasting stream-stopped:", bcErr);
    }
  };

  useEffect(() => {
    if (stream) {
      (window as any).activeDeckStream = stream;
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        (window as any).activeDeckStream = null;
        try {
          const channel = new BroadcastChannel('activedeck-stream');
          channel.postMessage({ type: 'stream-stopped' });
          channel.close();
        } catch (e) {}
      }
    };
  }, [stream]);

  // Synchronize stream for projector mode
  useEffect(() => {
    if (!isProjectorMode) return;

    console.log("ActiveDeck Projector: Sync stream effect mounted");
    const channel = new BroadcastChannel('activedeck-stream');

    const checkParentStream = () => {
      console.log("ActiveDeck Projector: checkParentStream invoked");
      try {
        console.log("ActiveDeck Projector: window.opener =", window.opener);
        if (window.opener) {
          console.log("ActiveDeck Projector: window.opener.closed =", window.opener.closed);
          if (!window.opener.closed) {
            const parentStream = window.opener.activeDeckStream;
            console.log("ActiveDeck Projector: window.opener.activeDeckStream =", parentStream);
            if (parentStream) {
              console.log("ActiveDeck Projector: Stream found. Active tracks:", parentStream.getTracks().map((t: any) => ({ label: t.label, enabled: t.enabled, readyState: t.readyState })));
              
              setStream(parentStream);

              setIsCapturing(true);
              setError(null);
            } else {
              console.log("ActiveDeck Projector: Opener exists but activeDeckStream is null or undefined");
              setStream(null);
              setIsCapturing(false);
            }
          } else {
            console.log("ActiveDeck Projector: window.opener is closed");
            setStream(null);
            setIsCapturing(false);
          }
        } else {
          console.log("ActiveDeck Projector: window.opener is NULL/undefined");
          setStream(null);
          setIsCapturing(false);
        }
      } catch (err) {
        console.error("ActiveDeck Projector: Error accessing presenter window memory:", err);
      }
    };

    // 1. Check parent stream immediately on mount (or reload)
    checkParentStream();

    // 2. Set up BroadcastChannel listener for real-time start/stop
    channel.onmessage = (event) => {
      console.log("ActiveDeck Projector: BroadcastChannel message received:", event.data);
      if (event.data?.type === 'stream-started') {
        checkParentStream();
      } else if (event.data?.type === 'stream-stopped') {
        console.log("ActiveDeck Projector: Stream stopped message received");
        setStream(null);
        setIsCapturing(false);
      } else if (event.data?.type === 'close-projector') {
        console.log("ActiveDeck Projector: Close projector message received. Closing window.");
        window.close();
      }
    };

    // 3. Fallback interval check (polling every 1 second) in case of missed events or parent closing
    const intervalId = setInterval(checkParentStream, 1000);

    return () => {
      console.log("ActiveDeck Projector: Sync stream effect unmounting");
      channel.close();
      clearInterval(intervalId);
    };
  }, [isProjectorMode]);

  return (
    <div className="flex flex-col h-full bg-black relative group">
      {/* Presenter Control Bar - Displays off the slide area */}
      {isCapturing && !isProjectorMode && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between z-[70] shrink-0 select-none relative">
          {/* Left Side: Status & Controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600/90 text-white text-[9px] font-black uppercase tracking-widest rounded-lg border border-red-500/20 shadow-lg shadow-red-500/5 animate-in fade-in duration-300">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Live
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">
              Active Display
            </span>
            <button
              onClick={stopCapture}
              className="flex items-center gap-1.5 ml-4 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg border border-red-500/25 shadow-lg shadow-red-500/10 transition-all hover:scale-105 active:scale-95 cursor-pointer border-0"
              title="Stop Presentation"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
              Stop Presentation
            </button>

            {/* Present with Notes Toggle Switch */}
            <button
              onClick={() => {
                setPresentWithNotes(!presentWithNotes);
              }}
              className={`flex items-center gap-1.5 ml-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all duration-200 shadow-lg cursor-pointer hover:scale-105 active:scale-95 ${
                presentWithNotes 
                  ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 hover:border-emerald-600 shadow-emerald-500/10' 
                  : 'bg-red-600 border-red-500 text-white hover:bg-red-700 hover:border-red-600 shadow-red-500/10'
              }`}
              title="Toggle Present with Notes"
            >
              <FileText className="w-3 h-3" />
              <span>Notes {presentWithNotes ? 'ON' : 'OFF'}</span>
            </button>

            {/* Laser Pointer Toggle Switch */}
            <button
              onClick={() => {
                const newEnabled = !laserEnabled;
                setLaserEnabled(newEnabled);
                if (!newEnabled) {
                  updateLaserPosition(0, 0, false);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-wider transition-all duration-200 shadow-lg cursor-pointer hover:scale-105 active:scale-95 ${
                laserEnabled 
                  ? 'bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 hover:border-emerald-600 shadow-emerald-500/10' 
                  : 'bg-red-600 border-red-500 text-white hover:bg-red-700 hover:border-red-600 shadow-red-500/10'
              }`}
              title="Toggle Laser Pointer"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${laserEnabled ? 'bg-white animate-pulse' : 'bg-white/60'}`} />
              <span>Laser {laserEnabled ? 'ON' : 'OFF'}</span>
            </button>


          </div>

          {/* Slide Number (Slightly to the right to make some distance) */}
          <div className="absolute left-[58%] -translate-x-1/2 z-50">
            {(currentSlide !== null || presentation?.currentSlide !== undefined) && (
              <div className="bg-[#ff3e00]/90 text-white px-2.5 py-1 rounded-lg border border-white/20 shadow-lg flex items-center gap-1.5 animate-in fade-in duration-300">
                <span className="text-[9px] font-black uppercase tracking-wider opacity-85">Slide</span>
                <span className="text-sm font-black font-mono">
                  {currentSlide !== null ? currentSlide : presentation?.currentSlide}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div 
        ref={containerRef}
        className="flex-1 relative bg-black overflow-hidden flex items-center justify-center transition-all duration-300"
      >
        {!isProjectorMode ? (
          <div className={`w-full h-full p-4 flex flex-col ${isCapturing ? 'md:flex-row gap-0 items-stretch justify-between max-w-[1650px]' : 'items-center justify-center max-w-[1450px]'} mx-auto select-none overflow-y-auto custom-scrollbar`}>
            {isCapturing ? (
              <>
                {/* SPLIT SCREEN LAYOUT */}
                {/* Left Column (Current Slide + Optional Presenter Notes below it) */}
                <div 
                  className="flex flex-col gap-2 w-full md:flex-shrink-0 h-full"
                  style={{ width: `calc(${leftWidthPercent}% - 9px)` }}
                >
                  {/* Top container: Slide Preview */}
                  <div 
                    className="flex flex-col gap-2 min-h-0 w-full flex-1 justify-center items-center overflow-hidden"
                    style={{ height: presentWithNotes ? `calc(${leftTopHeightPercent}% - 6px)` : '100%' }}
                  >
                    <div className="relative flex justify-center items-center w-full h-full min-h-0 min-w-0">
                      <div 
                        ref={presenterFrameRef}
                        onMouseMove={!isProjectorMode ? handleMouseMove : undefined}
                        onMouseLeave={!isProjectorMode ? handleMouseLeave : undefined}
                        className="relative w-full h-full bg-black border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center mx-auto"
                      >
                      <ScreenCapture 
                        isCapturing={isCapturing} 
                        stream={stream} 
                        error={error} 
                        onStart={startCapture} 
                        onStop={stopCapture} 
                        logoUrl={logoUrl}
                        isProjectorMode={isProjectorMode}
                        videoRef={videoRef}
                        onLoadedMetadata={handleVideoLoadedMetadata}
                        onSlideImageLoad={handleSlideImageLoad}
                        isBridgeConnected={isBridgeConnected}
                        currentSlideBase64={currentSlideBase64}
                        currentSlide={currentSlide}
                        currentSlidePreviewUrl={currentSlidePreviewUrl}
                        isPenActive={isPenActive}
                        onTogglePen={() => setIsPenActive(!isPenActive)}
                      />

                      {/* Real-time Presenter Live Slide Content Layer (Drawings + Laser Dot) */}
                      <div 
                        className="absolute pointer-events-none z-70"
                        style={{
                          top: presenterBounds.offsetY,
                          left: presenterBounds.offsetX,
                          width: presenterBounds.renderedWidth > 0 ? presenterBounds.renderedWidth : '100%',
                          height: presenterBounds.renderedHeight > 0 ? presenterBounds.renderedHeight : '100%',
                        }}
                      >
                        {/* Drawing SVG */}
                        <svg
                          viewBox="0 0 1000 1000"
                          preserveAspectRatio="none"
                          style={{ touchAction: 'none' }}
                          className={`w-full h-full ${
                            isPenActive && !isProjectorMode ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
                          }`}
                          onPointerDown={isPenActive && !isProjectorMode ? handleDrawingPointerDown : undefined}
                          onPointerMove={isPenActive && !isProjectorMode ? handleDrawingPointerMove : undefined}
                          onPointerUp={isPenActive && !isProjectorMode ? handleDrawingPointerUp : undefined}
                          onPointerLeave={isPenActive && !isProjectorMode ? handleDrawingPointerUp : undefined}
                        >
                          {currentSlideStrokes.map((stroke, idx) => {
                            if (stroke.text) {
                              const pt = stroke.points[0];
                              if (!pt) return null;
                              const fontSize = Math.max(26, stroke.width * 5);
                              return (
                                <text
                                  key={`split-text-stroke-${idx}`}
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
                            const pathD = renderStrokePath(stroke);
                            if (!pathD) return null;
                            return (
                              <path
                                key={`split-stroke-${idx}`}
                                d={pathD}
                                stroke={stroke.color}
                                strokeWidth={stroke.width}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                                opacity={stroke.isHighlighter ? 0.45 : 1}
                              />
                            );
                          })}
                          {activeDrawingStroke && (
                            <path
                              d={renderStrokePath(activeDrawingStroke)}
                              stroke={activeDrawingStroke.color}
                              strokeWidth={activeDrawingStroke.width}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                              opacity={activeDrawingStroke.isHighlighter ? 0.45 : 1}
                            />
                          )}
                        </svg>

                        {/* Laser dot */}
                        {presentation?.laserActive && presentation.laserX !== undefined && presentation.laserY !== undefined && (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${presentation.laserX}%`,
                              top: `${presentation.laserY}%`,
                              transform: 'translate(-50%, -50%)',
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              backgroundColor: '#ef4444',
                              boxShadow: '0 0 10px 4px rgba(239,68,68,0.9), 0 0 20px 8px rgba(239,68,68,0.5)',
                              pointerEvents: 'none',
                              zIndex: 80,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                  {/* Interactive Drag Splitter & Presenter Notes Panel (Only visible when Notes ON) */}
                  {presentWithNotes && (
                    <>
                      <div 
                        onMouseDown={handleMouseDownLeftSplit}
                        onTouchStart={handleTouchStartLeftSplit}
                        onDoubleClick={() => setLeftTopHeightPercent(55)}
                        className="h-2.5 w-full cursor-row-resize flex items-center justify-center flex-shrink-0 group/left-splitter select-none bg-transparent hover:bg-white/[0.02] active:bg-white/[0.04] transition-all rounded-lg my-0.5"
                        title="Drag to resize panels (double-click to reset)"
                      >
                        <div className="h-[3px] w-24 bg-slate-800/85 group-hover/left-splitter:bg-osu-orange/70 group-active/left-splitter:bg-osu-orange rounded-full transition-all duration-200" />
                      </div>

                      {/* Bottom container: Confined Presenter Notes UI panel */}
                      <div 
                        className="flex flex-col bg-slate-100 border border-slate-300 rounded-2xl px-5 py-3 select-none animate-in slide-in-from-bottom duration-300 shadow-md min-h-0 w-full"
                        style={{ height: `calc(${100 - leftTopHeightPercent}% - 6px)` }}
                      >
                        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200 select-none">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-osu-orange" />
                            <span className="text-xs font-black uppercase tracking-wider text-slate-800">Presenter Notes</span>
                          </div>
                          {effectiveTotalSlides > 0 && (
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Slide {effectiveCurrentSlide} of {effectiveTotalSlides}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 bg-white/70 border border-slate-200 rounded-xl p-4 overflow-y-auto text-base md:text-[16px] text-slate-700 font-semibold leading-relaxed pr-2 custom-scrollbar select-text cursor-not-allowed">
                          {notes ? (
                            <div className="whitespace-pre-wrap select-text cursor-text">{notes.replace(/\r/g, '\n')}</div>
                          ) : (
                            <div className="text-sm text-slate-400 italic flex items-center justify-center h-full select-none">
                              No notes available for this slide.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Interactive Drag Splitter between Current Slide + Notes (Left) and Next Slide Preview (Right) */}
                <div 
                  onMouseDown={handleMouseDownPresenterNotesSplit}
                  onTouchStart={handleTouchStartPresenterNotesSplit}
                  onDoubleClick={() => setLeftWidthPercent(62)}
                  className="hidden md:flex w-2.5 self-stretch cursor-col-resize items-center justify-center flex-shrink-0 group/notes-splitter select-none bg-transparent hover:bg-white/[0.02] active:bg-white/[0.04] transition-all rounded-lg mx-1"
                  title="Drag to resize panels (double-click to reset)"
                >
                  <div className="w-[3px] h-24 bg-slate-800/85 group-hover/notes-splitter:bg-osu-orange/70 group-active/notes-splitter:bg-osu-orange rounded-full transition-all duration-200" />
                </div>

                {/* Right Column (Next Slide): smaller preview */}
                <div 
                  className="flex flex-col gap-2 w-full md:flex-shrink-0 ml-auto h-full"
                  style={{ width: `calc(${100 - leftWidthPercent}% - 9px)` }}
                >
                  {/* Top container: Next Slide Preview + Clock */}
                  <div 
                    className="flex flex-col gap-2 min-h-0 w-full"
                    style={{ height: `calc(${rightTopHeightPercent}% - 6px)` }}
                  >
                    <div className="flex items-center justify-between px-1 flex-shrink-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Next Slide</span>
                      {effectiveNextSlide !== null && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                          Slide {effectiveNextSlide}
                        </span>
                      )}
                    </div>
                    
                    {/* Changed aspect-video to flex-1 min-h-0 to resize dynamically */}
                    <div className="relative w-full flex-1 min-h-0 bg-black border border-slate-850 rounded-2xl overflow-hidden p-1 flex items-center justify-center shadow-lg">
                      {nextSlideImgUrl ? (
                        <img 
                          src={nextSlideImgUrl} 
                          alt="Next Slide Preview" 
                          className="w-full h-full object-contain bg-black animate-in fade-in duration-300"
                          key={`next-preview-${effectiveNextSlide}-${nextSlideImgUrl}`}
                          onError={() => setNextSlideImageError(true)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 text-center p-4">
                          <Monitor className="w-8 h-8 mb-2 opacity-20" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {effectiveNextSlide !== null ? `Slide ${effectiveNextSlide}` : 'No Next Slide'}
                          </span>
                          <span className="text-[9px] text-slate-600 mt-1">
                            {effectiveNextSlide !== null ? 'Waiting for slide capture...' : 'End of presentation'}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Clock Display under Next Slide Preview */}
                    <div className="mt-1 flex items-center justify-center gap-2.5 px-4 py-1.5 bg-slate-950/95 border border-slate-800 rounded-xl shadow-xl text-slate-100 select-none w-fit mx-auto shrink-0">
                      <Clock className="w-5 h-5 text-osu-orange shrink-0 animate-pulse" />
                      <div className="flex items-baseline font-mono font-black text-xl md:text-2xl lg:text-3xl tracking-tight leading-none">
                        <span>{(currentTime.getHours() % 12 || 12).toString().padStart(2, '0')}:{currentTime.getMinutes().toString().padStart(2, '0')}</span>
                        <span className="text-[0.6em] text-slate-400 font-semibold ml-0.5">:{currentTime.getSeconds().toString().padStart(2, '0')}</span>
                        <span className="text-[0.65em] ml-1.5 font-sans font-black text-osu-orange uppercase">{currentTime.getHours() >= 12 ? 'PM' : 'AM'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Drag Splitter between Next Slide Preview (Top) and Slide Selector (Bottom) */}
                  <div 
                    onMouseDown={handleMouseDownRightSplit}
                    onTouchStart={handleTouchStartRightSplit}
                    onDoubleClick={() => setRightTopHeightPercent(45)}
                    className="h-2.5 w-full cursor-row-resize flex items-center justify-center flex-shrink-0 group/right-splitter select-none bg-transparent hover:bg-white/[0.02] active:bg-white/[0.04] transition-all rounded-lg my-0.5"
                    title="Drag to resize panels (double-click to reset)"
                  >
                    <div className="h-[3px] w-24 bg-slate-800/85 group-hover/right-splitter:bg-osu-orange/70 group-active/right-splitter:bg-osu-orange rounded-full transition-all duration-200" />
                  </div>

                  {/* Bottom container: Scrollable Slide Selector */}
                  <div 
                    className="flex flex-col min-h-0 w-full"
                    style={{ height: `calc(${100 - rightTopHeightPercent}% - 6px)` }}
                  >
                    {effectiveTotalSlides > 0 && (
                      <div className="flex flex-col gap-2 w-full h-full bg-slate-950/40 border border-slate-900 rounded-2xl p-3 shadow-lg min-h-0 overflow-hidden">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 pb-1.5 border-b border-slate-900/60 mb-1 flex items-center justify-between animate-in fade-in">
                          <span>Jump to Slide</span>
                          {furthestSlide !== null && (
                            <span className="text-[9px] text-slate-500 font-medium normal-case font-mono">
                              Furthest: Slide {furthestSlide}
                            </span>
                          )}
                        </div>
                        
                        <div 
                          id="deck-navigator-scroll-container"
                          className="relative grid grid-cols-3 gap-2 overflow-y-auto pr-0.5 custom-scrollbar flex-1 min-h-0"
                        >
                          {Array.from({ length: effectiveTotalSlides }, (_, i) => i + 1).map((sNum) => {
                            const isCurrent = sNum === effectiveCurrentSlide;
                            const isFurthest = sNum === furthestSlide;
                            const isUnshown = !visitedSlides[sNum];
                            
                            const hasLocalError = localImageErrors[sNum];
                            const localUrl = `http://127.0.0.1:5000/slides/${sNum}.jpg`;
                            const firestoreUrl = slidePreviewsMap[sNum];
                            const imgUrl = (isBridgeConnected || localSlidesCount >= sNum) && !hasLocalError ? localUrl : (firestoreUrl || null);

                            return (
                              <button
                                id={`nav-slide-${sNum}`}
                                key={`nav-slide-${sNum}`}
                                onClick={() => sendSlideCommand(sNum)}
                                className={`flex flex-col items-center gap-1 group/tile cursor-pointer transition-opacity duration-150 ${
                                  isUnshown ? 'opacity-40 hover:opacity-80' : 'opacity-100'
                                }`}
                                title={isFurthest ? "Where you left off (furthest slide)" : isUnshown ? "Slide not yet shown to audience (Click to jump)" : `Jump to Slide ${sNum}`}
                              >
                                <div className={`relative w-full aspect-video bg-slate-950 rounded-lg overflow-hidden flex items-center justify-center border transition-all ${
                                  isCurrent
                                    ? 'border-osu-orange ring-2 ring-osu-orange/20 scale-[1.03]'
                                    : 'border-slate-800 group-hover/tile:border-slate-600'
                                }`}>
                                  {imgUrl ? (
                                    <img
                                      src={imgUrl}
                                      alt={`Slide ${sNum}`}
                                      className="w-full h-full object-cover bg-black"
                                      loading="lazy"
                                      onError={() => setLocalImageErrors(prev => ({ ...prev, [sNum]: true }))}
                                    />
                                  ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-slate-700 bg-slate-950">
                                      <Monitor className="w-4 h-4 opacity-30" />
                                    </div>
                                  )}
                                  
                                  {/* Slide Number Badge */}
                                  <span className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded font-mono font-black text-[9px] border leading-none ${
                                    isCurrent
                                      ? 'bg-osu-orange text-white border-orange-500/30 shadow-md'
                                      : 'bg-slate-950/85 text-slate-300 border-slate-850'
                                  }`}>
                                    {sNum}
                                  </span>

                                  {/* Furthest slide dot */}
                                  {isFurthest && (
                                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {furthestSlide !== null && furthestSlide !== effectiveCurrentSlide && (
                          <button
                            onClick={() => sendSlideCommand(furthestSlide)}
                            className="w-full mt-1.5 py-1.5 bg-osu-orange hover:bg-[#c03900] text-white text-[10px] font-black uppercase tracking-wider rounded-lg border border-orange-500/30 shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1 shrink-0"
                          >
                            <span>Resume from Slide {furthestSlide}</span>
                            <span className="text-[8px]">➜</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full p-4 relative overflow-hidden">
                <div className="relative flex justify-center items-center w-full h-full max-h-[calc(100%-40px)] min-h-0 min-w-0">
                  <div 
                    ref={projectorFrameRef}
                    className="relative w-full h-full bg-black border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center mx-auto"
                  >
                  <ScreenCapture 
                    isCapturing={isCapturing} 
                    stream={stream} 
                    error={error} 
                    onStart={startCapture} 
                    onStop={stopCapture} 
                    logoUrl={logoUrl}
                    isProjectorMode={isProjectorMode}
                    videoRef={videoRef}
                    onLoadedMetadata={handleVideoLoadedMetadata}
                    onSlideImageLoad={handleSlideImageLoad}
                    isBridgeConnected={isBridgeConnected}
                    currentSlideBase64={currentSlideBase64}
                    currentSlide={currentSlide}
                    currentSlidePreviewUrl={currentSlidePreviewUrl}
                  />

                  {/* Real-time Presenter Live Slide Content Layer for Projector Screen (Drawings + Laser Dot) */}
                  <div 
                    className="absolute pointer-events-none z-70"
                    style={{
                      top: projectorBounds.offsetY,
                      left: projectorBounds.offsetX,
                      width: projectorBounds.renderedWidth > 0 ? projectorBounds.renderedWidth : '100%',
                      height: projectorBounds.renderedHeight > 0 ? projectorBounds.renderedHeight : '100%',
                    }}
                  >
                    <svg
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                      className="w-full h-full pointer-events-none"
                    >
                      {currentSlideStrokes.map((stroke, idx) => {
                        if (stroke.text) {
                          const pt = stroke.points[0];
                          if (!pt) return null;
                          const fontSize = Math.max(26, stroke.width * 5);
                          return (
                            <text
                              key={`projector-text-stroke-${idx}`}
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
                        const pathD = renderStrokePath(stroke);
                        if (!pathD) return null;
                        return (
                          <path
                            key={`projector-stroke-${idx}`}
                            d={pathD}
                            stroke={stroke.color}
                            strokeWidth={stroke.width}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                            opacity={stroke.isHighlighter ? 0.45 : 1}
                          />
                        );
                      })}
                      {activeDrawingStroke && (
                        <path
                          d={renderStrokePath(activeDrawingStroke)}
                          stroke={activeDrawingStroke.color}
                          strokeWidth={activeDrawingStroke.width}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                          opacity={activeDrawingStroke.isHighlighter ? 0.45 : 1}
                        />
                      )}
                    </svg>

                    {/* Real-time Virtual Laser Pointer Dot */}
                    {presentation?.laserActive && presentation.laserX !== undefined && presentation.laserY !== undefined && (
                      <div 
                        style={{
                          left: `${presentation.laserX}%`,
                          top: `${presentation.laserY}%`,
                          transform: 'translate(-50%, -50%)',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: '#ef4444',
                          boxShadow: '0 0 14px 5px rgba(239, 68, 68, 0.95), 0 0 28px 10px rgba(239, 68, 68, 0.6)',
                          position: 'absolute',
                          pointerEvents: 'none',
                          zIndex: 80
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

            {/* Unobtrusive Centered Slide Number under slide display in Projector Mode */}
            {isCapturing && (
              <div className="mt-2.5 flex items-center justify-center shrink-0 z-20">
                <div className="px-3.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-800/80 text-slate-300 shadow-xl flex items-center gap-1.5 text-xs font-semibold tracking-wide select-none">
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Slide</span>
                  <span className="font-mono font-bold text-osu-orange text-sm">
                    {currentSlide !== null ? currentSlide : (presentation?.currentSlide ?? 1)}
                  </span>
                  {totalSlides ? (
                    <span className="text-slate-500 text-xs font-mono">/ {totalSlides}</span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Floating Setup Instructions Bubble - Shown in the top-left when not capturing */}
        {!isCapturing && !error && !isProjectorMode && (
          <button 
            onClick={() => setShowInstructions(true)}
            className="absolute top-4 left-4 z-[70] flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/50 text-white text-xs font-bold rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-sm"
            title="Show Presentation Setup Instructions"
          >
            <Info className="w-4 h-4 text-osu-orange" />
            <span>Setup Instructions</span>
          </button>
        )}

        {/* Setup Bridge Card - Shown when not capturing and no error */}
        {!isCapturing && !error && !isProjectorMode && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center flex flex-col items-center justify-center relative">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-500 shadow-lg ${
                isBridgeConnected 
                  ? 'bg-green-500/10 border border-green-500/35 text-green-400 shadow-green-500/5 animate-pulse' 
                  : 'bg-osu-orange/10 border border-osu-orange/30 text-osu-orange shadow-orange-500/5'
              }`}>
                <PresentationIcon className="w-7 h-7" />
              </div>
              
              <h2 className="text-xl font-black text-white mb-1 tracking-tight">Ready to Present?</h2>
              
              <div className="flex items-center gap-1.5 justify-center mb-6">
                <span className={`w-2 h-2 rounded-full ${isBridgeConnected ? 'bg-green-500 animate-pulse' : 'bg-osu-orange'}`} />
                <span className={`text-[11px] font-black uppercase tracking-wider ${isBridgeConnected ? 'text-green-500' : 'text-osu-orange'}`}>
                  {isBridgeConnected ? 'ActiveDeck Bridge Connected' : 'ActiveDeck Bridge Offline'}
                </span>
              </div>
              
              <div className="w-full space-y-3.5">
                {isBridgeConnected ? (
                  <>
                    <button
                      onClick={startCapture}
                      className="flex items-center justify-center gap-2.5 w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-650/20 text-sm cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Start Presentation
                    </button>
                    <p className="text-[10px] text-slate-500 leading-normal font-medium">
                      Ensure your PowerPoint is in Slide Show mode (F5) before sharing.
                    </p>
                  </>
                ) : (
                  <>
                    <a 
                      href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/activedeck_bridge.2.0.zip"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2.5 w-full py-3.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Download ActiveDeck Bridge
                    </a>
                    
                    <div className="pt-2">
                      <button
                        onClick={() => {
                          setUseWithoutBridge(true);
                          startCapture();
                        }}
                        className="text-xs text-slate-400 hover:text-white transition-colors underline font-bold cursor-pointer bg-transparent border-0 p-0"
                      >
                        Start Presentation in Manual Mode (No Bridge)
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stunning Classroom Welcome & Join Hub - Shown in projector mode when offline */}
        {!isCapturing && isProjectorMode && (
          <div className="absolute inset-0 z-[65] flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-white overflow-hidden">
            <div className="max-w-xl w-full flex flex-col items-center gap-5 md:gap-6 animate-in fade-in zoom-in-95 duration-500">
              {/* Logo / Brand Header */}
              <div className="flex flex-col items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="ActiveDeck" className="h-12 md:h-14 object-contain max-h-[56px]" />
                ) : (
                  <div className="flex items-center gap-2.5 text-2xl md:text-3xl font-black uppercase tracking-wider text-osu-orange">
                    <MonitorPlay className="w-8 h-8 md:w-9 md:h-9" />
                    <span>ActiveDeck</span>
                  </div>
                )}
                <p className="text-slate-400 text-sm md:text-base font-semibold tracking-wide mt-1">
                  Welcome! The presentation is about to begin.
                </p>
              </div>

               {/* QR Code Card */}
              <div className="bg-white p-4 rounded-2xl shadow-xl flex flex-col items-center justify-center border-2 border-osu-orange/20 hover:scale-102 transition-transform duration-300">
                <QRCodeSVG
                  value={`https://active-deck.app/chat?pin=${presentation?.pinCode || ''}`}
                  size={190}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* PIN & Connection Info */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="text-slate-500 text-xs md:text-sm font-black uppercase tracking-widest">
                    Scan to Join, or Go to:
                  </div>
                  <div className="text-2xl md:text-3xl font-black text-white bg-slate-900 border border-slate-800 px-7 py-3 rounded-2xl inline-block tracking-wider shadow-inner">
                    active-deck.app/chat
                  </div>
                </div>
                
                <div className="flex flex-col items-center gap-0.5 pt-1">
                  <div className="text-slate-500 text-[10px] md:text-xs font-black uppercase tracking-widest">
                    Enter Join Code (PIN):
                  </div>
                  <div className="text-5xl md:text-6xl font-black tracking-wider text-osu-orange select-all font-mono">
                    {presentation?.pinCode ? presentation.pinCode.replace(/(\d{3})(?=\d)/g, '$1 ') : '--- ---'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Download Options Modal Overlay */}
        {showDownloadModal && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-205"
            onClick={() => setShowDownloadModal(false)}
          >
            <div 
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full text-center relative animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                onClick={() => setShowDownloadModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer border-0 bg-transparent"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-10 h-10 bg-indigo-600/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Download className="w-5 h-5 text-indigo-600" />
              </div>
              
              <h2 className="text-lg font-black text-slate-900 mb-2">Download Presentation / Chat Log</h2>
              <p className="text-slate-500 text-xs mb-6 leading-relaxed text-center">
                Choose how you would like to download your presentation session data. You can download the slides with drawings, include all chat and activities, or download only the chat log.
              </p>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    setShowDownloadModal(false);
                    await handleDownloadPresentation(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md border-0"
                >
                  <FileText className="w-4.5 h-4.5 text-white" />
                  <span>Presentation + Chat Log (.docx)</span>
                </button>

                <button
                  onClick={async () => {
                    setShowDownloadModal(false);
                    await handleDownloadPresentation(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md border-0"
                >
                  <PresentationIcon className="w-4.5 h-4.5 text-white" />
                  <span>Presentation Only (.docx)</span>
                </button>

                <button
                  onClick={() => {
                    setShowDownloadModal(false);
                    handleDownloadOnlyChat();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer border border-slate-200 shadow-sm"
                >
                  <Send className="w-4.5 h-4.5 text-slate-500" />
                  <span>Chat Log Only (.doc)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Detailed Instructions Modal Overlay */}
        {showInstructions && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-205"
            onClick={() => setShowInstructions(false)}
          >
            <div 
              className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full text-center relative animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button 
                onClick={() => setShowInstructions(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer border-0 bg-transparent"
                title="Close Instructions"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-10 h-10 bg-osu-orange/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <PresentationIcon className="w-5 h-5 text-osu-orange" />
              </div>
              
              <h2 className="text-lg font-black text-slate-900 mb-0.5">Ready to Present?</h2>
              <div className="text-slate-500 text-xs mb-4">
                {isBridgeConnected ? (
                  <span className="text-green-600 font-bold flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    Bridge Connected & Ready
                  </span>
                ) : (
                  <span>Follow the steps below to set up your presentation.</span>
                )}
              </div>
              
              {/* Tabbed Interface - Hidden to only show Dual Screen */}
              {/*
              <div className="flex p-1 bg-slate-100 rounded-xl mb-4">
                <button
                  onClick={() => setActiveTab('single')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'single' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Single Screen
                </button>
                <button
                  onClick={() => setActiveTab('dual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'dual' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MonitorPlay className="w-3.5 h-3.5" />
                  Dual Screen
                </button>
                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer border-0 ${
                    activeTab === 'manual' ? 'bg-white text-osu-orange shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <MousePointer2 className="w-3.5 h-3.5" />
                  Manual Mode
                </button>
              </div>
              */}

              <div className="text-left mb-4 min-h-[380px] flex flex-col">
                {/* Single Screen - Hidden to only show Dual Screen */}
                {/*
                {activeTab === 'single' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario 1: Control & Sync</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Download <span className="font-bold">ActiveDeck Bridge (.zip)</span> below to computer.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Unzip file (right click and <span className="font-bold">"Extract All"</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Install file (<span className="font-bold">activedeck_bridge.exe</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">4</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Open PowerPoint and <span className="font-bold">start show (F5)</span>.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">5</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Press <span className="font-bold">Windows key</span> on keyboard and select browser.</p>
                        </div>
                        <div 
                          className="mt-1.5 p-2 bg-slate-50 rounded-lg border-2" 
                          style={{ borderColor: secondaryColor }}
                        >
                          <p className="text-[10px] text-slate-500 italic text-center leading-normal">
                            Advance slides using the <span className="font-bold">Prev/Next</span> button in ActiveDeck, not the PowerPoint.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      {!isBridgeConnected ? (
                        <>
                          <a 
                            href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/activedeck_bridge.2.0.zip"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2.5 w-full py-2.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                          >
                            <Download className="w-4 h-4" />
                            Download ActiveDeck Bridge
                          </a>
                          <div className="flex gap-2.5 p-2 bg-amber-50 rounded-xl border border-amber-100">
                            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-700 leading-relaxed">
                              If Windows shows a protection warning, click <span className="font-bold">"More Info"</span> and then <span className="font-bold">"Run Anyway"</span>.
                            </p>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setShowInstructions(false);
                            startCapture();
                          }}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base cursor-pointer border-0"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Start Your Presentation
                        </button>
                      )}
                    </div>
                  </div>
                )}
                */}

                {activeTab === 'dual' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario: Dual Screen Setup</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Download <span className="font-bold">ActiveDeck Bridge (.zip)</span> below to computer.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Unzip file (right click and <span className="font-bold">"Extract All"</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Install file (<span className="font-bold">activedeck_bridge.exe</span>).</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">4</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Open PPT and start <span className="font-bold">Slide Show (F5)</span> on your computer.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">5</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Click the <span className="font-bold">Projector Mode</span> button in the top bar to launch the audience screen window.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-osu-orange text-white rounded-full flex items-center justify-center text-[10px] font-bold">6</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Drag the new <span className="font-bold">Projector Mode</span> window to the projector or audience display screen.</p>
                        </div>
                        <div 
                          className="mt-1.5 p-2 bg-slate-50 rounded-lg border-2" 
                          style={{ borderColor: secondaryColor }}
                        >
                          <p className="text-[10px] text-slate-500 italic text-center leading-normal">
                            Advance slides using the <span className="font-bold">Prev/Next</span> button in ActiveDeck, not the PowerPoint.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      {!isBridgeConnected ? (
                        <>
                          <a 
                            href="https://github.com/jstnzmwlt-phd/ActiveDeck/releases/download/v1.0.0/activedeck_bridge.2.0.zip"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2.5 w-full py-2.5 bg-osu-orange hover:bg-[#c03900] text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 text-sm"
                          >
                            <Download className="w-4 h-4" />
                            Download ActiveDeck Bridge
                          </a>
                          <div className="flex gap-2.5 p-2 bg-amber-50 rounded-xl border border-amber-100">
                            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-700 leading-relaxed">
                              If Windows shows a protection warning, click <span className="font-bold">"More Info"</span> and then <span className="font-bold">"Run Anyway"</span>.
                            </p>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setShowInstructions(false);
                            startCapture();
                          }}
                          className="flex items-center justify-center gap-2.5 w-full py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-green-500/30 text-base cursor-pointer border-0"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Start Your Presentation
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Manual Mode - Hidden to only show Dual Screen */}
                {/*
                {activeTab === 'manual' && (
                  <div className="flex-1 flex flex-col space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div>
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2">Scenario 3: Manual Mode</h3>
                      <div className="space-y-1.5">
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Click <span className="font-bold">'Start Presentation'</span> below.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Use your <span className="font-bold">clicker/keyboard</span> to move slides manually.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <div className="flex-shrink-0 w-5 h-5 bg-slate-200 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                          <p className="text-xs text-slate-600 leading-relaxed">Use <span className="font-bold">ActiveDeck</span> on a secondary screen with your PPT on the main screen. Advance the main screen PPT.</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-auto space-y-2">
                      <button
                        onClick={() => {
                          setShowInstructions(false);
                          setUseWithoutBridge(true);
                          startCapture();
                        }}
                        className="flex items-center justify-center gap-2.5 w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl shadow-slate-900/30 text-base cursor-pointer border-0"
                      >
                        <Play className="w-5 h-5 fill-current" />
                        Start Presentation
                      </button>
                      <div className="flex gap-2.5 p-2 bg-blue-50 rounded-xl border border-blue-100">
                        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-blue-700 leading-relaxed">
                          <span className="font-bold">Note:</span> There will be no slide stamp on chat messages when not using the ActiveDeck Bridge.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                */}
              </div>
              
              <div className="pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-slate-400">
                <div className={`w-2 h-2 rounded-full animate-pulse ${isBridgeConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {isBridgeConnected 
                    ? 'Bridge Online & Ready' 
                    : 'Waiting for ActiveDeck connection...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    ) : (
      /* PROJECTOR MODE SCREEN VIEW */
      <div className="w-full flex flex-col h-full p-4 gap-3 bg-black">
        {/* Header space above slide area for Join URL */}
        <div className="w-full flex items-center justify-between px-2 shrink-0 select-none relative">
          <div className="flex items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="Logo" className="h-6 md:h-7 object-contain" />}
          </div>
          
          {/* Centered Faded ActiveDeck Label */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20 pointer-events-none">
            <span className="text-sm md:text-base font-black uppercase tracking-[0.25em] text-white">
              ActiveDeck
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-3.5">
            <span className="text-[10px] md:text-xs font-black tracking-widest text-slate-500 uppercase">JOIN CHAT AT:</span>
            <span className="text-lg sm:text-xl md:text-2xl font-mono font-black text-osu-orange select-all bg-osu-orange/10 border border-osu-orange/25 px-4 py-1.5 rounded-xl shadow-lg shadow-orange-500/5">
              https://active-deck.app/chat
            </span>
          </div>
        </div>

        <div 
          ref={actualProjectorFrameRef}
          className="relative w-full flex-1 bg-black border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center mx-auto min-h-0"
        >
          <ScreenCapture 
            isCapturing={isCapturing} 
            stream={stream} 
            error={error} 
            onStart={startCapture} 
            onStop={stopCapture} 
            logoUrl={logoUrl}
            isProjectorMode={isProjectorMode}
            videoRef={videoRef}
            onLoadedMetadata={handleVideoLoadedMetadata}
            onSlideImageLoad={handleSlideImageLoad}
            isBridgeConnected={isBridgeConnected}
            currentSlideBase64={currentSlideBase64}
            currentSlide={currentSlide}
            currentSlidePreviewUrl={currentSlidePreviewUrl}
            isPenActive={isPenActive}
            onTogglePen={() => setIsPenActive(!isPenActive)}
          />

          {/* Real-time Presenter Live Slide Content Layer for Projector Screen (Drawings + Laser Dot) */}
          <div 
            className="absolute pointer-events-none z-70"
            style={{
              top: actualProjectorBounds.offsetY,
              left: actualProjectorBounds.offsetX,
              width: actualProjectorBounds.renderedWidth > 0 ? actualProjectorBounds.renderedWidth : '100%',
              height: actualProjectorBounds.renderedHeight > 0 ? actualProjectorBounds.renderedHeight : '100%',
            }}
          >
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="w-full h-full pointer-events-none"
            >
              {currentSlideStrokes.map((stroke, idx) => {
                if (stroke.text) {
                  const pt = stroke.points[0];
                  if (!pt) return null;
                  const fontSize = Math.max(26, stroke.width * 5);
                  return (
                    <text
                      key={`projector-text-stroke-${idx}`}
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
                const pathD = renderStrokePath(stroke);
                if (!pathD) return null;
                return (
                  <path
                    key={`projector-stroke-${idx}`}
                    d={pathD}
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={stroke.isHighlighter ? 0.45 : 1}
                  />
                );
              })}
              {activeDrawingStroke && (
                <path
                  d={renderStrokePath(activeDrawingStroke)}
                  stroke={activeDrawingStroke.color}
                  strokeWidth={activeDrawingStroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={activeDrawingStroke.isHighlighter ? 0.45 : 1}
                />
              )}
            </svg>

            {/* Real-time Virtual Laser Pointer Dot */}
            {presentation?.laserActive && presentation.laserX !== undefined && presentation.laserY !== undefined && (
              <div 
                style={{
                  position: 'absolute',
                  left: `${presentation.laserX}%`,
                  top: `${presentation.laserY}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  boxShadow: '0 0 14px 5px rgba(239, 68, 68, 0.95), 0 0 28px 10px rgba(239, 68, 68, 0.6)',
                  pointerEvents: 'none',
                  zIndex: 80
                }}
              />
            )}
          </div>
        </div>

        {/* Unobtrusive Centered Slide Number under slide display in Projector Mode */}
        {isCapturing && (
          <div className="mt-2.5 flex items-center justify-center shrink-0 z-20">
            <div className="px-3.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-800/80 text-slate-300 shadow-xl flex items-center gap-1.5 text-xs font-semibold tracking-wide select-none">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Slide</span>
              <span className="font-mono font-bold text-osu-orange text-sm">
                {currentSlide !== null ? currentSlide : (presentation?.currentSlide ?? 1)}
              </span>
              {totalSlides ? (
                <span className="text-slate-500 text-xs font-mono">/ {totalSlides}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    )}
  </div>




      {/* Footer Navigation Bar - Always visible when presenting */}
      {isCapturing && !isProjectorMode && (
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-3 flex items-center justify-center z-[70] shrink-0 select-none relative">
          
          {/* Left Side: Decoupled Fullscreen Toggle */}
          <div className="absolute left-4">
            <button
              onClick={toggleFullscreen}
              className="flex items-center justify-center w-10 h-10 bg-slate-950/40 hover:bg-slate-850 text-slate-400 hover:text-white rounded-xl transition-all active:scale-95 border border-slate-800 cursor-pointer shadow-lg hover:scale-105"
              title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>

          {/* Mid-Left: Download Presentation Button */}
          <div className="absolute left-[25%] -translate-x-1/2">
            <button
              onClick={() => setShowDownloadModal(true)}
              disabled={isDownloadingPresentation}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-955/40 hover:bg-slate-850 disabled:bg-slate-800/20 disabled:text-slate-600 text-slate-400 hover:text-white rounded-xl transition-all active:scale-95 border border-slate-800 cursor-pointer shadow-lg hover:scale-105 text-[10px] font-black uppercase tracking-wider whitespace-nowrap"
              title="Download presentation or session logs"
            >
              {isDownloadingPresentation ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-osu-orange" />
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Presentation</span>
                </>
              )}
            </button>
          </div>

          {/* Center: Slide Navigation Cluster */}
          <div className="flex items-center gap-3 p-1 bg-slate-950/60 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => handleSlideMove('prev')}
              className="flex items-center justify-center w-10 h-10 bg-slate-900/80 hover:bg-slate-800 text-white rounded-lg transition-all active:scale-95 border border-slate-800 group/btn cursor-pointer"
              title="Previous Slide"
            >
              <ChevronLeft className="w-5 h-5 group-hover/btn:-translate-x-0.5 transition-transform" />
            </button>
            
            {totalSlides !== null && currentSlide !== null ? (
              <>
                <div className="w-px h-6 bg-slate-800/80" />
                <div
                  className="px-4 py-1 text-[11px] font-black uppercase tracking-widest text-slate-400 bg-slate-950/40 rounded-lg border border-slate-850/30 min-w-[125px] text-center font-mono select-none"
                >
                  Slide {currentSlide} of {totalSlides}
                </div>
                <div className="w-px h-6 bg-slate-800/80" />
              </>
            ) : null}

            <button
              onClick={() => handleSlideMove('next')}
              className="flex items-center justify-center w-10 h-10 bg-osu-orange hover:bg-[#c03900] text-white rounded-lg transition-all active:scale-95 border border-orange-600/30 group/btn shadow-lg shadow-orange-500/10 cursor-pointer"
              title="Next Slide"
            >
              <ChevronRight className="w-5 h-5 group-hover/btn:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Right Side: Audience Slide Preview Pushed Status Indicator & Push Action */}
          <div className="absolute right-4 flex items-center gap-2">
            {/* Push Image to Notes Button */}
            <button
              onClick={handlePushImageToNotes}
              disabled={isPushingToNotes}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-500 text-white text-[11px] font-bold uppercase tracking-wider rounded-xl border border-orange-500/30 shadow-lg shadow-orange-500/15 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              title="Push current display window image to audience notes as a new note tab"
            >
              {isPushingToNotes ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Send className="w-3.5 h-3.5 text-white" />
              )}
              <span>{isPushingToNotes ? 'Pushing...' : 'Push Image to Notes'}</span>
            </button>
            {currentSlidePreviewUrl ? (
              <div 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-[11px] font-bold rounded-xl shadow-lg animate-in fade-in duration-200"
                title="Current slide image preview is live and displayed on audience chat/notes page"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="tracking-wide">Audience Preview Pushed</span>
              </div>
            ) : isUploadingPreview || isPushingToNotes ? (
              <div 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/80 border border-amber-500/40 text-amber-400 text-[11px] font-bold rounded-xl shadow-lg animate-pulse"
                title="Capturing and pushing slide image preview to audience page..."
              >
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                <span className="tracking-wide">Pushing Preview...</span>
              </div>
            ) : (
              <div 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/80 border border-slate-800 text-slate-400 text-[11px] font-medium rounded-xl shadow-sm"
                title="Waiting for slide image preview to push to audience page"
              >
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="tracking-wide">Preview Pending</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Popped-out Full Preview Display with Pen Function Menu */}
      {isPenActive && !isProjectorMode && (
        <div className="fixed inset-0 z-[150] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-3 animate-in fade-in duration-200 select-none">
          
          {/* Floating Top Pen Function Menu */}
          <div className="mb-3 px-5 py-3 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-wrap items-center justify-center gap-4 z-50 text-slate-100 max-w-full">
            
            {/* Tool Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-850">
              <button
                onClick={() => setPenTool('pen')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'pen' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Freehand Pen Tool"
              >
                <Pen className="w-5 h-5" />
                <span>Pen</span>
              </button>
              <button
                onClick={() => setPenTool('line')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'line' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Line Tool (Drag straight line)"
              >
                <Minus className="w-5 h-5" />
                <span>Line</span>
              </button>
              <button
                onClick={() => setPenTool('arrow')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'arrow' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Arrow Tool (Drag from start to tip)"
              >
                <MoveRight className="w-5 h-5" />
                <span>Arrow</span>
              </button>
              <button
                onClick={() => setPenTool('rectangle')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'rectangle' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Rectangle / Square Tool"
              >
                <Square className="w-5 h-5" />
                <span>Square</span>
              </button>
              <button
                onClick={() => setPenTool('circle')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'circle' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Circle / Ellipse Tool"
              >
                <Circle className="w-5 h-5" />
                <span>Circle</span>
              </button>
              <button
                onClick={() => setPenTool('highlighter')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'highlighter' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Highlighter Tool"
              >
                <Highlighter className="w-5 h-5" />
                <span>Highlighter</span>
              </button>
              <button
                onClick={() => setPenTool('text')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'text' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Text Tool (Click on slide to add text)"
              >
                <Type className="w-5 h-5" />
                <span>Text</span>
              </button>
              <button
                onClick={() => setPenTool('eraser')}
                className={`px-4.5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  penTool === 'eraser' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Eraser Tool"
              >
                <Eraser className="w-5 h-5" />
                <span>Eraser</span>
              </button>
            </div>

            {/* Color Palette (Pen / Line / Arrow / Circle / Rectangle / Text vs Highlighter) */}
            {penTool === 'pen' || penTool === 'arrow' || penTool === 'line' || penTool === 'circle' || penTool === 'rectangle' || penTool === 'text' ? (
              <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
                {[
                  { color: '#EF4444', name: 'Red (Default)' },
                  { color: '#eb5d00', name: 'OSU Orange' },
                  { color: '#EAB308', name: 'Yellow' },
                  { color: '#22C55E', name: 'Green' },
                  { color: '#3B82F6', name: 'Blue' },
                  { color: '#FFFFFF', name: 'White' },
                  { color: '#000000', name: 'Black' }
                ].map(c => (
                  <button
                    key={c.color}
                    onClick={() => setPenColor(c.color)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform cursor-pointer ${
                      penColor === c.color
                        ? 'scale-125 border-white ring-2 ring-red-500'
                        : 'border-slate-700 hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.color }}
                    title={c.name}
                  />
                ))}
              </div>
            ) : penTool === 'highlighter' ? (
              <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
                {[
                  { color: '#EAB308', name: 'Yellow Highlighter' },
                  { color: '#EF4444', name: 'Red Highlighter' },
                  { color: '#22C55E', name: 'Green Highlighter' },
                  { color: '#3B82F6', name: 'Blue Highlighter' }
                ].map(c => (
                  <button
                    key={c.color}
                    onClick={() => setHighlighterColor(c.color)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform cursor-pointer ${
                      highlighterColor === c.color
                        ? 'scale-125 border-white ring-2 ring-amber-400'
                        : 'border-slate-700 hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.color }}
                    title={c.name}
                  />
                ))}
              </div>
            ) : null}

            {/* Stroke Thickness */}
            {penTool !== 'eraser' && (
              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-4 bg-slate-950 p-1.5 rounded-xl">
                {[
                  { label: 'Fine', value: 3 },
                  { label: 'Med', value: 6 },
                  { label: 'Bold', value: 12 }
                ].map(w => (
                  <button
                    key={w.value}
                    onClick={() => setPenWidth(w.value)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                      penWidth === w.value ? 'bg-slate-800 text-osu-orange border border-osu-orange/40' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            )}

            {/* Actions: Undo / Redo / Clear */}
            <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
              <button
                onClick={handleUndoDrawing}
                disabled={!(drawingUndoStack[activeSlideKey]?.length > 0)}
                className="p-2.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Undo Stroke"
              >
                <Undo2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleRedoDrawing}
                disabled={!(drawingRedoStack[activeSlideKey]?.length > 0)}
                className="p-2.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                title="Redo Stroke"
              >
                <Redo2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleClearSlideDrawing}
                disabled={currentSlideStrokes.length === 0}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-950/60 border border-red-800/60 text-red-300 hover:bg-red-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-sm font-bold transition-all cursor-pointer"
                title="Clear all drawings on this slide"
              >
                <Trash2 className="w-4.5 h-4.5" />
                <span>Clear Slide</span>
              </button>
            </div>

            {/* Close Pen Mode */}
            <button
              onClick={() => setIsPenActive(false)}
              className="flex items-center gap-2 px-4.5 py-2.5 bg-osu-orange hover:bg-[#c03900] text-white rounded-xl text-sm font-bold transition-all ml-auto cursor-pointer shadow-lg"
              title="Exit Pen Drawing Mode"
            >
              <X className="w-5 h-5" />
              <span>Exit Pen</span>
            </button>

          </div>
          <div 
            style={{
              aspectRatio: `${videoAspectRatio}`,
              width: '100%',
              height: 'auto',
              maxWidth: `calc((100vh - 160px) * ${videoAspectRatio})`,
              maxHeight: 'calc(100vh - 160px)'
            }}
            className="relative bg-black border border-slate-800 rounded-2xl overflow-hidden p-1.5 flex items-center justify-center shadow-2xl mx-auto"
          >
            <ScreenCapture 
              isCapturing={isCapturing} 
              stream={stream} 
              error={error} 
              onStart={startCapture} 
              onStop={stopCapture} 
              logoUrl={logoUrl}
              isProjectorMode={isProjectorMode}
              videoRef={videoRef}
              onLoadedMetadata={handleVideoLoadedMetadata}
              isBridgeConnected={isBridgeConnected}
              currentSlideBase64={currentSlideBase64}
              currentSlide={currentSlide}
              currentSlidePreviewUrl={currentSlidePreviewUrl}
            />

            {/* Interactive SVG Drawing Layer */}
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full cursor-crosshair pointer-events-auto z-70"
              onPointerDown={handleDrawingPointerDown}
              onPointerMove={handleDrawingPointerMove}
              onPointerUp={handleDrawingPointerUp}
              onPointerLeave={handleDrawingPointerUp}
            >
              {currentSlideStrokes.map((stroke, idx) => {
                if (stroke.text) {
                  const pt = stroke.points[0];
                  if (!pt) return null;
                  const fontSize = Math.max(26, stroke.width * 5);
                  return (
                    <text
                      key={`popped-text-stroke-${idx}`}
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
                const pathD = renderStrokePath(stroke);
                if (!pathD) return null;
                return (
                  <path
                    key={`popped-stroke-${idx}`}
                    d={pathD}
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={stroke.isHighlighter ? 0.45 : 1}
                  />
                );
              })}
              {activeDrawingStroke && (
                <path
                  d={renderStrokePath(activeDrawingStroke)}
                  stroke={activeDrawingStroke.color}
                  strokeWidth={activeDrawingStroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={activeDrawingStroke.isHighlighter ? 0.45 : 1}
                />
              )}
            </svg>

            {/* Virtual Laser Dot inside popped-out display */}
            {presentation?.laserActive && presentation.laserX !== undefined && presentation.laserY !== undefined && (
              <div 
                style={{
                  left: `${presentation.laserX}%`,
                  top: `${presentation.laserY}%`,
                  transform: 'translate(-50%, -50%)',
                  width: '15px',
                  height: '15px',
                  borderRadius: '50%',
                  backgroundColor: 'red',
                  boxShadow: '0 0 8px 3px rgba(255, 0, 0, 0.8), 0 0 15px 5px rgba(255, 0, 0, 0.4)',
                  position: 'absolute',
                  pointerEvents: 'none',
                  zIndex: 80,
                }}
              />
            )}
          </div>
        </div>
      )}

    </div>
);
};
