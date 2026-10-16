import React, { useState, useEffect, useRef } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Pen, MoveRight, Highlighter, Eraser, Type, Undo2, Redo2, Trash2, Hand, Minus, Circle, Square, GripVertical } from 'lucide-react';
import { DrawingStroke, DrawingPoint, SlideTextAnnotation } from '../types';
import { generateCompositeSlideBase64 } from '../utils/exportNotesDocx';

interface HistorySnapshot {
  strokes: DrawingStroke[];
  textAnnotations: SlideTextAnnotation[];
}

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  drawingStrokesJson?: string; // Presenter drawings (read-only base layer)
  allowStudentDrawing?: boolean; // True when student can annotate slides
  studentStrokesJson?: string; // Student's personal freehand drawings on this slide
  onStudentStrokesChange?: (newStrokesJson: string) => void;
  textAnnotations?: SlideTextAnnotation[]; // Student's persistent per-slide text annotations
  onTextAnnotationsChange?: (newAnnotations: SlideTextAnnotation[]) => void;
  onCompositePreviewUpdate?: (compositeDataUrl: string) => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title = "Pushed Slide View",
  drawingStrokesJson,
  allowStudentDrawing = true,
  studentStrokesJson = '',
  onStudentStrokesChange,
  textAnnotations: propTextAnnotations = [],
  onTextAnnotationsChange,
  onCompositePreviewUpdate
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const slideWrapperRef = useRef<HTMLDivElement>(null);

  // Student Annotation Mode & Tool States inside Lightbox
  const [interactionMode, setInteractionMode] = useState<'draw' | 'text' | 'pan'>(allowStudentDrawing ? 'draw' : 'pan');
  const [studentPenTool, setStudentPenTool] = useState<'pen' | 'arrow' | 'line' | 'circle' | 'rectangle' | 'highlighter' | 'text' | 'eraser'>('pen');
  const [studentPenColor, setStudentPenColor] = useState<string>('#EF4444'); // Default Red
  const [studentHighlighterColor, setStudentHighlighterColor] = useState<string>('#EAB308'); // Default Yellow
  const [studentPenWidth] = useState<number>(6);

  const [studentStrokes, setStudentStrokes] = useState<DrawingStroke[]>([]);
  const [activeStudentStroke, setActiveStudentStroke] = useState<DrawingStroke | null>(null);
  const [localTextAnnotations, setLocalTextAnnotations] = useState<SlideTextAnnotation[]>(propTextAnnotations);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [draggingAnnotationId, setDraggingAnnotationId] = useState<string | null>(null);

  const activeStudentStrokeRef = useRef<DrawingStroke | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Dragging state for text annotations
  const textDragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    initialXPct: number;
    initialYPct: number;
    hasMoved: boolean;
    preDragSnapshot: HistorySnapshot;
  } | null>(null);

  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  // Parse presenter drawings (read-only base layer)
  let presenterStrokes: DrawingStroke[] = [];
  if (drawingStrokesJson) {
    try {
      const parsed = JSON.parse(drawingStrokesJson);
      if (Array.isArray(parsed)) presenterStrokes = parsed;
    } catch {}
  }

  // Sync student strokes from props (and migrate any legacy stroke.text into textAnnotations)
  useEffect(() => {
    if (studentStrokesJson) {
      try {
        const parsed = JSON.parse(studentStrokesJson);
        if (Array.isArray(parsed)) {
          setStudentStrokes(parsed);
        }
      } catch {}
    } else {
      setStudentStrokes([]);
    }
  }, [studentStrokesJson, isOpen]);

  // Sync text annotations from props
  useEffect(() => {
    setLocalTextAnnotations(Array.isArray(propTextAnnotations) ? propTextAnnotations : []);
  }, [propTextAnnotations, isOpen]);

  // Auto-focus newly selected/created text annotation
  useEffect(() => {
    if (editingAnnotationId) {
      const el = textareaRefs.current[editingAnnotationId];
      if (el) {
        el.focus();
      }
    }
  }, [editingAnnotationId]);

  // Reset zoom and mode on open
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setInteractionMode(allowStudentDrawing ? 'draw' : 'pan');
      if (studentPenTool === 'text') {
        setStudentPenTool('pen');
      }
      setEditingAnnotationId(null);
      setDraggingAnnotationId(null);
    }
  }, [isOpen, imageUrl, allowStudentDrawing]);

  const triggerCompositeUpdate = async (
    strokesToUse: DrawingStroke[],
    annotationsToUse: SlideTextAnnotation[]
  ) => {
    if (!onCompositePreviewUpdate || !imageUrl) return;
    const cleanedAnns = annotationsToUse.filter(a => a.text && a.text.trim() !== '');
    const dataUrl = await generateCompositeSlideBase64(
      imageUrl,
      drawingStrokesJson,
      JSON.stringify(strokesToUse),
      cleanedAnns
    );
    if (dataUrl) {
      onCompositePreviewUpdate(dataUrl);
    }
  };

  const handleModalClose = () => {
    // Clean up any empty text annotations on close and update composite preview
    const cleaned = localTextAnnotations.filter(a => a.text && a.text.trim() !== '');
    if (cleaned.length !== localTextAnnotations.length) {
      setLocalTextAnnotations(cleaned);
      onTextAnnotationsChange?.(cleaned);
    }
    triggerCompositeUpdate(studentStrokes, cleaned);
    setEditingAnnotationId(null);
    onClose();
  };

  // Handle keyboard shortcuts (Escape to blur or close, +/- to zoom when not typing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isTypingInInput = activeTag === 'textarea' || activeTag === 'input';

      if (e.key === 'Escape') {
        if (isTypingInInput || editingAnnotationId) {
          (document.activeElement as HTMLElement | null)?.blur();
          setEditingAnnotationId(null);
        } else {
          handleModalClose();
        }
      } else if (!isTypingInInput && (e.key === '=' || e.key === '+')) {
        handleZoomIn();
      } else if (!isTypingInInput && e.key === '-') {
        handleZoomOut();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, scale, editingAnnotationId, localTextAnnotations, studentStrokes]);

  // Global pointer move / up listeners for dragging text annotations smoothly
  useEffect(() => {
    if (!draggingAnnotationId) return;

    const handleGlobalPointerMove = (e: PointerEvent) => {
      const dragInfo = textDragRef.current;
      const wrapper = slideWrapperRef.current;
      if (!dragInfo || !wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dxPx = e.clientX - dragInfo.startClientX;
      const dyPx = e.clientY - dragInfo.startClientY;

      if (!dragInfo.hasMoved && Math.hypot(dxPx, dyPx) > 3) {
        dragInfo.hasMoved = true;
        setUndoStack(prev => [...prev, dragInfo.preDragSnapshot]);
        setRedoStack([]);
      }

      if (dragInfo.hasMoved) {
        const dxPct = (dxPx / rect.width) * 100;
        const dyPct = (dyPx / rect.height) * 100;
        const nextXPct = Number(Math.max(0, Math.min(95, dragInfo.initialXPct + dxPct)).toFixed(2));
        const nextYPct = Number(Math.max(0, Math.min(95, dragInfo.initialYPct + dyPct)).toFixed(2));

        setLocalTextAnnotations(prev => {
          const updated = prev.map(ann =>
            ann.id === dragInfo.id ? { ...ann, xPct: nextXPct, yPct: nextYPct } : ann
          );
          onTextAnnotationsChange?.(updated);
          return updated;
        });
      }
    };

    const handleGlobalPointerUp = () => {
      const dragInfo = textDragRef.current;
      textDragRef.current = null;
      setDraggingAnnotationId(null);
      if (dragInfo?.hasMoved) {
        setLocalTextAnnotations(current => {
          triggerCompositeUpdate(studentStrokes, current);
          return current;
        });
      }
    };

    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [draggingAnnotationId, studentStrokes]);

  if (!isOpen) return null;

  const isTextModeActive = interactionMode === 'text' || (interactionMode === 'draw' && studentPenTool === 'text');

  const saveStudentStrokes = (newStrokes: DrawingStroke[]) => {
    setStudentStrokes(newStrokes);
    if (onStudentStrokesChange) {
      onStudentStrokesChange(JSON.stringify(newStrokes));
    }
    triggerCompositeUpdate(newStrokes, localTextAnnotations);
  };

  const saveTextAnnotations = (newAnnotations: SlideTextAnnotation[], updateComposite = false) => {
    setLocalTextAnnotations(newAnnotations);
    if (onTextAnnotationsChange) {
      onTextAnnotationsChange(newAnnotations);
    }
    if (updateComposite) {
      triggerCompositeUpdate(studentStrokes, newAnnotations);
    }
  };

  const pushUndoSnapshot = () => {
    setUndoStack(prev => [
      ...prev,
      {
        strokes: studentStrokes,
        textAnnotations: localTextAnnotations.filter(a => a.text.trim() !== '')
      }
    ]);
    setRedoStack([]);
  };

  const renderStrokePath = (stroke: DrawingStroke): string => {
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
    return stroke.points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 4));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactionMode !== 'pan') return; // Only drag-pan in Pan/Zoom mode
    e.preventDefault();
    if (scale <= 1 && position.x === 0 && position.y === 0) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || interactionMode !== 'pan') return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = 0.1;
    if (e.deltaY < 0) {
      setScale(prev => Math.min(prev + zoomFactor, 4));
    } else {
      setScale(prev => Math.max(prev - zoomFactor, 0.5));
    }
  };

  // Student Drawing Pointer Handlers
  const getCoordinates = (e: React.PointerEvent<SVGSVGElement>): DrawingPoint | null => {
    const svgElem = e.currentTarget;
    if (!svgElem) return null;
    const rect = svgElem.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  };

  const eraseStudentStrokeAtPoint = (point: DrawingPoint) => {
    const eraserRadius = 35;
    const remaining = studentStrokes.filter(stroke => {
      return !stroke.points.some(p => {
        const dx = p.x - point.x;
        const dy = p.y - point.y;
        return Math.sqrt(dx * dx + dy * dy) < eraserRadius;
      });
    });

    if (remaining.length !== studentStrokes.length) {
      pushUndoSnapshot();
      saveStudentStrokes(remaining);
    }
  };

  const handleCreateTextAnnotationAtPointer = (clientX: number, clientY: number) => {
    const wrapper = slideWrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const rawXPct = ((clientX - rect.left) / rect.width) * 100;
    const rawYPct = ((clientY - rect.top) / rect.height) * 100;
    const xPct = Number(Math.max(1, Math.min(90, rawXPct)).toFixed(2));
    const yPct = Number(Math.max(1, Math.min(90, rawYPct)).toFixed(2));

    // Remove any previously created empty annotation before spawning the new one
    const nonEmpty = localTextAnnotations.filter(a => a.text.trim() !== '');

    const newAnnotation: SlideTextAnnotation = {
      id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      xPct,
      yPct,
      text: '',
      color: studentPenColor,
      fontSize: 16
    };

    setUndoStack(prev => [
      ...prev,
      { strokes: studentStrokes, textAnnotations: nonEmpty }
    ]);
    setRedoStack([]);

    const updated = [...nonEmpty, newAnnotation];
    saveTextAnnotations(updated, false);
    setEditingAnnotationId(newAnnotation.id);
  };

  const handleStudentPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!allowStudentDrawing || interactionMode === 'pan' || (e.pointerType === 'mouse' && e.button !== 0)) return;

    if (isTextModeActive) {
      e.preventDefault();
      e.stopPropagation();
      handleCreateTextAnnotationAtPointer(e.clientX, e.clientY);
      return;
    }

    // If user was editing a text box and clicked on the canvas in Draw mode, blur it first
    if (editingAnnotationId) {
      setEditingAnnotationId(null);
    }

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const coords = getCoordinates(e);
    if (!coords) return;

    isPointerDownRef.current = true;

    if (studentPenTool === 'eraser') {
      eraseStudentStrokeAtPoint(coords);
    } else if (studentPenTool === 'arrow' || studentPenTool === 'line' || studentPenTool === 'circle' || studentPenTool === 'rectangle') {
      const newStroke: DrawingStroke = {
        points: [coords, coords],
        color: studentPenColor,
        width: studentPenWidth,
        isArrow: studentPenTool === 'arrow',
        isLine: studentPenTool === 'line',
        isCircle: studentPenTool === 'circle',
        isRectangle: studentPenTool === 'rectangle'
      };
      activeStudentStrokeRef.current = newStroke;
      setActiveStudentStroke(newStroke);
    } else {
      const newStroke: DrawingStroke = {
        points: [coords],
        color: studentPenTool === 'highlighter' ? studentHighlighterColor : studentPenColor,
        width: studentPenTool === 'highlighter' ? 24 : studentPenWidth,
        isHighlighter: studentPenTool === 'highlighter'
      };
      activeStudentStrokeRef.current = newStroke;
      setActiveStudentStroke(newStroke);
    }
  };

  const handleStudentPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (interactionMode !== 'draw' || isTextModeActive || !isPointerDownRef.current) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    if (studentPenTool === 'eraser') {
      eraseStudentStrokeAtPoint(coords);
    } else if ((studentPenTool === 'arrow' || studentPenTool === 'line' || studentPenTool === 'circle' || studentPenTool === 'rectangle') && activeStudentStrokeRef.current) {
      const startPt = activeStudentStrokeRef.current.points[0];
      const updated: DrawingStroke = {
        ...activeStudentStrokeRef.current,
        points: [startPt, coords]
      };
      activeStudentStrokeRef.current = updated;
      setActiveStudentStroke(updated);
    } else if (activeStudentStrokeRef.current) {
      const updated: DrawingStroke = {
        ...activeStudentStrokeRef.current,
        points: [...activeStudentStrokeRef.current.points, coords]
      };
      activeStudentStrokeRef.current = updated;
      setActiveStudentStroke(updated);
    }
  };

  const handleStudentPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (interactionMode !== 'draw' || isTextModeActive || !isPointerDownRef.current) return;
    e.preventDefault();
    isPointerDownRef.current = false;

    const current = activeStudentStrokeRef.current;
    if (current && current.points.length > 0) {
      const updated = [...studentStrokes, current];
      pushUndoSnapshot();
      saveStudentStrokes(updated);
    }
    activeStudentStrokeRef.current = null;
    setActiveStudentStroke(null);
  };

  const handleStartTextAnnotationDrag = (e: React.PointerEvent, ann: SlideTextAnnotation) => {
    if (!allowStudentDrawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();

    textDragRef.current = {
      id: ann.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      initialXPct: ann.xPct,
      initialYPct: ann.yPct,
      hasMoved: false,
      preDragSnapshot: {
        strokes: studentStrokes,
        textAnnotations: localTextAnnotations.filter(a => a.text.trim() !== '')
      }
    };
    setDraggingAnnotationId(ann.id);
  };

  const handleTextAnnotationChange = (id: string, newText: string) => {
    const updated = localTextAnnotations.map(ann =>
      ann.id === id ? { ...ann, text: newText } : ann
    );
    saveTextAnnotations(updated, false);
  };

  const handleTextAnnotationBlur = (id: string) => {
    const target = localTextAnnotations.find(a => a.id === id);
    let finalAnnotations = localTextAnnotations;
    if (target && target.text.trim() === '') {
      finalAnnotations = localTextAnnotations.filter(a => a.id !== id);
    }
    if (editingAnnotationId === id) {
      setEditingAnnotationId(null);
    }
    saveTextAnnotations(finalAnnotations, true);
  };

  const handleDeleteTextAnnotation = (id: string, e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    const updated = localTextAnnotations.filter(a => a.id !== id);
    if (editingAnnotationId === id) {
      setEditingAnnotationId(null);
    }
    saveTextAnnotations(updated, true);
  };

  const handleColorSelect = (color: string) => {
    setStudentPenColor(color);
    // If a text box is currently focused, update its color immediately as well
    if (editingAnnotationId) {
      const updated = localTextAnnotations.map(ann =>
        ann.id === editingAnnotationId ? { ...ann, color } : ann
      );
      saveTextAnnotations(updated, true);
    }
  };

  const handleStudentUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [
      ...r,
      {
        strokes: studentStrokes,
        textAnnotations: localTextAnnotations.filter(a => a.text.trim() !== '')
      }
    ]);
    setUndoStack(u => u.slice(0, u.length - 1));
    setEditingAnnotationId(null);
    setStudentStrokes(prev.strokes);
    onStudentStrokesChange?.(JSON.stringify(prev.strokes));
    setLocalTextAnnotations(prev.textAnnotations);
    onTextAnnotationsChange?.(prev.textAnnotations);
    triggerCompositeUpdate(prev.strokes, prev.textAnnotations);
  };

  const handleStudentRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [
      ...u,
      {
        strokes: studentStrokes,
        textAnnotations: localTextAnnotations.filter(a => a.text.trim() !== '')
      }
    ]);
    setRedoStack(r => r.slice(0, r.length - 1));
    setEditingAnnotationId(null);
    setStudentStrokes(next.strokes);
    onStudentStrokesChange?.(JSON.stringify(next.strokes));
    setLocalTextAnnotations(next.textAnnotations);
    onTextAnnotationsChange?.(next.textAnnotations);
    triggerCompositeUpdate(next.strokes, next.textAnnotations);
  };

  const handleStudentClear = () => {
    if (studentStrokes.length === 0 && localTextAnnotations.length === 0) return;
    pushUndoSnapshot();
    setEditingAnnotationId(null);
    setStudentStrokes([]);
    onStudentStrokesChange?.(JSON.stringify([]));
    setLocalTextAnnotations([]);
    onTextAnnotationsChange?.([]);
    triggerCompositeUpdate([], []);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-200">
      {/* Top Header Panel */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-white/10 z-50 gap-2">
        <div className="flex flex-col shrink-0">
          <span className="text-[10px] font-black text-osu-orange uppercase tracking-wider">
            {allowStudentDrawing ? 'My Personal Study Note Slide Annotations' : 'ActiveDeck Slide Inspection'}
          </span>
          <span className="text-sm font-bold text-white truncate max-w-xs md:max-w-md">{title}</span>
        </div>

        {/* Student Annotation Toolbar */}
        {allowStudentDrawing && (
          <div className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 bg-slate-955 border border-slate-800 rounded-2xl shadow-xl">
            {/* Mode Switcher: Draw vs Text vs Pan/Zoom */}
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-900 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setInteractionMode('draw');
                  if (studentPenTool === 'text') {
                    setStudentPenTool('pen');
                  }
                }}
                className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  interactionMode === 'draw' && studentPenTool !== 'text'
                    ? 'bg-osu-orange text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Draw mode: Sketch and highlight on slide"
              >
                <Pen className="w-4 h-4" />
                <span>Draw</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInteractionMode('text');
                  setStudentPenTool('text');
                }}
                className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isTextModeActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Text mode: Click anywhere on slide to add a persistent, draggable text box"
              >
                <Type className="w-4 h-4" />
                <span>Text</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInteractionMode('pan');
                  setEditingAnnotationId(null);
                }}
                className={`px-3.5 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  interactionMode === 'pan'
                    ? 'bg-osu-orange text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Pan mode: Zoom and drag slide"
              >
                <Hand className="w-4 h-4" />
                <span>Pan/Zoom</span>
              </button>
            </div>

            {/* Drawing Sub-Tools (Visible in Draw Mode) */}
            {interactionMode === 'draw' && !isTextModeActive && (
              <div className="flex items-center gap-1.5 p-1.5 bg-slate-900 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setStudentPenTool('pen')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'pen' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Pen Tool"
                >
                  <Pen className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('line')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'line' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Line Tool (Drag straight line)"
                >
                  <Minus className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('arrow')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'arrow' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Arrow Tool (Drag from start to tip)"
                >
                  <MoveRight className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('rectangle')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'rectangle' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Rectangle / Square Tool"
                >
                  <Square className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('circle')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'circle' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Circle / Ellipse Tool"
                >
                  <Circle className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('highlighter')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'highlighter' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Highlighter Tool"
                >
                  <Highlighter className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInteractionMode('text');
                    setStudentPenTool('text');
                  }}
                  className="px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer text-slate-400 hover:text-white"
                  title="Text Tool (Click on slide to add text box)"
                >
                  <Type className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStudentPenTool('eraser')}
                  className={`px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    studentPenTool === 'eraser' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Eraser Tool"
                >
                  <Eraser className="w-4.5 h-4.5" />
                </button>
              </div>
            )}

            {/* Color Swatches & History Actions (Visible in Draw or Text mode) */}
            {(interactionMode === 'draw' || interactionMode === 'text') && (
              <>
                {isTextModeActive || studentPenTool === 'pen' || studentPenTool === 'arrow' || studentPenTool === 'line' || studentPenTool === 'circle' || studentPenTool === 'rectangle' || studentPenTool === 'text' ? (
                  <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                    {[
                      { color: '#EF4444', name: 'Red' },
                      { color: '#eb5d00', name: 'Orange' },
                      { color: '#EAB308', name: 'Yellow' },
                      { color: '#22C55E', name: 'Green' },
                      { color: '#3B82F6', name: 'Blue' },
                      { color: '#FFFFFF', name: 'White' },
                      { color: '#000000', name: 'Black' }
                    ].map(c => (
                      <button
                        key={c.color}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleColorSelect(c.color)}
                        className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer ${
                          studentPenColor === c.color ? 'scale-125 border-white ring-2 ring-red-500' : 'border-slate-700 hover:scale-110'
                        }`}
                        style={{ backgroundColor: c.color }}
                        title={c.name}
                      />
                    ))}
                  </div>
                ) : studentPenTool === 'highlighter' ? (
                  <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                    {[
                      { color: '#EAB308', name: 'Yellow' },
                      { color: '#EF4444', name: 'Red' },
                      { color: '#22C55E', name: 'Green' },
                      { color: '#3B82F6', name: 'Blue' }
                    ].map(c => (
                      <button
                        key={c.color}
                        type="button"
                        onClick={() => setStudentHighlighterColor(c.color)}
                        className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer ${
                          studentHighlighterColor === c.color ? 'scale-125 border-white ring-2 ring-amber-400' : 'border-slate-700 hover:scale-110'
                        }`}
                        style={{ backgroundColor: c.color }}
                        title={c.name}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Actions: Undo / Redo / Clear */}
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <button
                    type="button"
                    onClick={handleStudentUndo}
                    disabled={undoStack.length === 0}
                    className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Undo"
                  >
                    <Undo2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleStudentRedo}
                    disabled={redoStack.length === 0}
                    className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Redo"
                  >
                    <Redo2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleStudentClear}
                    disabled={studentStrokes.length === 0 && localTextAnnotations.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-950/60 border border-red-800/60 text-red-300 hover:bg-red-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold transition-all cursor-pointer"
                    title="Clear all slide strokes and text boxes"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        
        <button
          type="button"
          onClick={handleModalClose}
          className="p-2 rounded-lg bg-red-600 hover:bg-red-750 text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
          title="Close Lightbox"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Image & Interactive Canvas Container */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden flex items-center justify-center p-4 ${
          interactionMode === 'pan'
            ? `cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`
            : isTextModeActive
            ? 'cursor-text'
            : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={slideWrapperRef}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
          }}
          className="relative max-w-full max-h-[75vh] flex items-center justify-center duration-150 select-none"
        >
          <img
            src={imageUrl}
            alt="Pushed Slide Details"
            className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl border border-white/10 pointer-events-none select-none"
            draggable={false}
          />

          {/* Presenter Drawings Layer (Read-only Base Layer) */}
          {presenterStrokes.length > 0 && (
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              style={{ filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
            >
              {presenterStrokes.map((stroke, idx) => {
                if (stroke.text) {
                  const pt = stroke.points[0];
                  if (!pt) return null;
                  const fontSize = Math.max(26, stroke.width * 5);
                  return (
                    <text
                      key={`presenter-text-${idx}`}
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
                    key={`presenter-base-stroke-${idx}`}
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
          )}

          {/* Interactive Student Drawing Layer (Student's own private slide markings) */}
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            style={{ touchAction: 'none', filter: 'drop-shadow(0px 0px 1.5px rgba(0,0,0,0.75)) drop-shadow(0px 0px 1.5px rgba(255,255,255,0.55))' }}
            className={`absolute inset-0 w-full h-full z-20 ${
              allowStudentDrawing && (interactionMode === 'draw' || interactionMode === 'text')
                ? isTextModeActive
                  ? 'pointer-events-auto cursor-text'
                  : 'pointer-events-auto cursor-crosshair'
                : 'pointer-events-none'
            }`}
            onPointerDown={allowStudentDrawing && (interactionMode === 'draw' || interactionMode === 'text') ? handleStudentPointerDown : undefined}
            onPointerMove={allowStudentDrawing && interactionMode === 'draw' ? handleStudentPointerMove : undefined}
            onPointerUp={allowStudentDrawing && interactionMode === 'draw' ? handleStudentPointerUp : undefined}
            onPointerLeave={allowStudentDrawing && interactionMode === 'draw' ? handleStudentPointerUp : undefined}
          >
            {studentStrokes.map((stroke, idx) => {
              if (stroke.text) {
                const pt = stroke.points[0];
                if (!pt) return null;
                const fontSize = Math.max(26, stroke.width * 5);
                return (
                  <text
                    key={`student-text-${idx}`}
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
                  key={`student-stroke-${idx}`}
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

            {activeStudentStroke && (
              <path
                d={renderStrokePath(activeStudentStroke)}
                stroke={activeStudentStroke.color}
                strokeWidth={activeStudentStroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={activeStudentStroke.isHighlighter ? 0.25 : 1}
              />
            )}
          </svg>

          {/* Interactive Draggable & Editable Student Text Annotations Layer */}
          <div className="absolute inset-0 w-full h-full pointer-events-none z-30">
            {localTextAnnotations.map((ann) => {
              const isEditing = editingAnnotationId === ann.id;
              const isBeingDragged = draggingAnnotationId === ann.id;
              const isDarkInk = (ann.color || '').trim().toUpperCase() === '#000000';
              const fontSizePx = ann.fontSize || 16;

              return (
                <div
                  key={ann.id}
                  style={{
                    left: `${ann.xPct}%`,
                    top: `${ann.yPct}%`,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className={`group/textann absolute pointer-events-auto flex items-stretch rounded-lg shadow-lg backdrop-blur-[2px] border transition-shadow ${
                    isDarkInk
                      ? 'bg-slate-50/90 border-slate-400/80'
                      : 'bg-slate-900/85 border-white/25'
                  } ${
                    isEditing
                      ? 'ring-2 ring-osu-orange border-osu-orange z-40'
                      : 'hover:border-osu-orange/80'
                  } ${isBeingDragged ? 'opacity-90 scale-[1.02] z-50 cursor-grabbing' : ''}`}
                >
                  {/* Drag Handle */}
                  {allowStudentDrawing && (
                    <div
                      onPointerDown={(e) => handleStartTextAnnotationDrag(e, ann)}
                      className={`flex items-center justify-center px-1 cursor-grab active:cursor-grabbing rounded-l-lg border-r transition-colors select-none ${
                        isDarkInk
                          ? 'border-slate-300/70 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
                          : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                      }`}
                      title="Drag to reposition text box"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  )}

                  {/* Auto-resizing Inline Textarea Container */}
                  <div
                    className="inline-grid items-center px-2 py-1 min-w-[72px] max-w-[380px]"
                    onClick={() => {
                      if (allowStudentDrawing && editingAnnotationId !== ann.id) {
                        setEditingAnnotationId(ann.id);
                      }
                    }}
                  >
                    {/* Hidden mirror span for automatic width & height sizing */}
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: `${fontSizePx}px`,
                        lineHeight: 1.3,
                      }}
                      className="col-start-1 row-start-1 invisible whitespace-pre-wrap break-words font-sans font-bold pointer-events-none min-h-[1.3em]"
                    >
                      {(ann.text || 'Type note...') + ' '}
                    </span>

                    <textarea
                      ref={(el) => {
                        textareaRefs.current[ann.id] = el;
                      }}
                      value={ann.text}
                      readOnly={!allowStudentDrawing}
                      placeholder="Type note..."
                      rows={1}
                      onFocus={() => {
                        if (allowStudentDrawing) {
                          setEditingAnnotationId(ann.id);
                        }
                      }}
                      onBlur={() => handleTextAnnotationBlur(ann.id)}
                      onChange={(e) => handleTextAnnotationChange(ann.id, e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                          e.currentTarget.blur();
                        }
                      }}
                      style={{
                        color: ann.color || '#EF4444',
                        fontSize: `${fontSizePx}px`,
                        lineHeight: 1.3,
                      }}
                      className={`col-start-1 row-start-1 w-full h-full bg-transparent resize-none overflow-hidden focus:outline-none font-sans font-bold whitespace-pre-wrap break-words ${
                        isDarkInk ? 'placeholder-slate-400' : 'placeholder-slate-400/70'
                      } ${allowStudentDrawing ? 'cursor-text' : 'cursor-default'}`}
                    />
                  </div>

                  {/* Corner Delete (×) Button */}
                  {allowStudentDrawing && (
                    <button
                      type="button"
                      onPointerDown={(e) => handleDeleteTextAnnotation(ann.id, e)}
                      onClick={(e) => handleDeleteTextAnnotation(ann.id, e)}
                      className={`absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white border border-white/40 shadow-md flex items-center justify-center transition-opacity cursor-pointer z-50 ${
                        isEditing ? 'opacity-100' : 'opacity-0 group-hover/textann:opacity-100'
                      }`}
                      title="Delete text annotation"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center justify-center p-4 z-50">
        <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-900/90 border border-white/10 rounded-full shadow-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90 cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          
          <span className="text-xs font-mono font-bold text-white w-12 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90 cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-1" />
          
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-350 hover:text-white text-[10px] font-black uppercase tracking-widest rounded-full transition-all active:scale-95 border border-white/5 cursor-pointer"
            title="Reset Zoom & Position"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
};

