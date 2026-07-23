import React, { useState, useEffect, useRef } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Pen, MoveRight, Highlighter, Eraser, Type, Undo2, Redo2, Trash2, Hand } from 'lucide-react';
import { DrawingStroke, DrawingPoint } from '../types';

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  drawingStrokesJson?: string; // Presenter drawings (read-only base layer)
  allowStudentDrawing?: boolean; // True when student is in Handwritten Notes mode
  studentStrokesJson?: string; // Student's personal drawings on this slide
  onStudentStrokesChange?: (newStrokesJson: string) => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title = "Pushed Slide View",
  drawingStrokesJson,
  allowStudentDrawing = false,
  studentStrokesJson = '',
  onStudentStrokesChange
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Student Drawing Tool States inside Lightbox
  const [interactionMode, setInteractionMode] = useState<'draw' | 'pan'>(allowStudentDrawing ? 'draw' : 'pan');
  const [studentPenTool, setStudentPenTool] = useState<'pen' | 'arrow' | 'highlighter' | 'text' | 'eraser'>('pen');
  const [studentPenColor, setStudentPenColor] = useState<string>('#EF4444'); // Default Red
  const [studentHighlighterColor, setStudentHighlighterColor] = useState<string>('#EAB308'); // Default Yellow
  const [studentPenWidth, setStudentPenWidth] = useState<number>(6);

  const [studentStrokes, setStudentStrokes] = useState<DrawingStroke[]>([]);
  const [activeStudentStroke, setActiveStudentStroke] = useState<DrawingStroke | null>(null);

  const activeStudentStrokeRef = useRef<DrawingStroke | null>(null);
  const isPointerDownRef = useRef<boolean>(false);

  const [undoStack, setUndoStack] = useState<DrawingStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<DrawingStroke[][]>([]);

  // Parse presenter drawings (read-only base layer)
  let presenterStrokes: DrawingStroke[] = [];
  if (drawingStrokesJson) {
    try {
      const parsed = JSON.parse(drawingStrokesJson);
      if (Array.isArray(parsed)) presenterStrokes = parsed;
    } catch {}
  }

  // Parse initial student strokes
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

  // Reset zoom and mode on open
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setInteractionMode(allowStudentDrawing ? 'draw' : 'pan');
    }
  }, [isOpen, imageUrl, allowStudentDrawing]);

  // Handle keyboard shortcuts (Escape to close, +/- to zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '=' || e.key === '+') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, scale]);

  if (!isOpen) return null;

  const saveStudentStrokes = (newStrokes: DrawingStroke[]) => {
    setStudentStrokes(newStrokes);
    if (onStudentStrokesChange) {
      onStudentStrokesChange(JSON.stringify(newStrokes));
    }
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
    if (interactionMode === 'draw') return; // Don't drag pan when drawing
    e.preventDefault();
    if (scale <= 1 && position.x === 0 && position.y === 0) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || interactionMode === 'draw') return;
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
      setUndoStack(prev => [...prev, studentStrokes]);
      saveStudentStrokes(remaining);
    }
  };

  const handleStudentPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (interactionMode !== 'draw' || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const coords = getCoordinates(e);
    if (!coords) return;

    isPointerDownRef.current = true;

    if (studentPenTool === 'eraser') {
      eraseStudentStrokeAtPoint(coords);
    } else if (studentPenTool === 'text') {
      const enteredText = window.prompt("Enter text for slide note:");
      if (enteredText && enteredText.trim()) {
        const textStroke: DrawingStroke = {
          points: [coords],
          color: studentPenColor,
          width: studentPenWidth,
          text: enteredText.trim()
        };
        const updated = [...studentStrokes, textStroke];
        setUndoStack(prev => [...prev, studentStrokes]);
        setRedoStack([]);
        saveStudentStrokes(updated);
      }
    } else if (studentPenTool === 'arrow') {
      const newStroke: DrawingStroke = {
        points: [coords, coords],
        color: studentPenColor,
        width: studentPenWidth,
        isArrow: true
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
    if (interactionMode !== 'draw' || !isPointerDownRef.current) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    if (studentPenTool === 'eraser') {
      eraseStudentStrokeAtPoint(coords);
    } else if (studentPenTool === 'arrow' && activeStudentStrokeRef.current) {
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
    if (interactionMode !== 'draw' || !isPointerDownRef.current) return;
    e.preventDefault();
    isPointerDownRef.current = false;

    const current = activeStudentStrokeRef.current;
    if (current && current.points.length > 0) {
      const updated = [...studentStrokes, current];
      setUndoStack(prev => [...prev, studentStrokes]);
      setRedoStack([]);
      saveStudentStrokes(updated);
    }
    activeStudentStrokeRef.current = null;
    setActiveStudentStroke(null);
  };

  const handleStudentUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, studentStrokes]);
    setUndoStack(u => u.slice(0, u.length - 1));
    saveStudentStrokes(prev);
  };

  const handleStudentRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, studentStrokes]);
    setRedoStack(r => r.slice(0, r.length - 1));
    saveStudentStrokes(next);
  };

  const handleStudentClear = () => {
    if (studentStrokes.length === 0) return;
    setUndoStack(u => [...u, studentStrokes]);
    setRedoStack([]);
    saveStudentStrokes([]);
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

        {/* Student Pen Function Menu (Visible when Handwritten Notes mode is active) */}
        {allowStudentDrawing && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 bg-slate-950/90 border border-slate-800 rounded-2xl shadow-xl">
            {/* Mode Switcher: Draw vs Pan */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800">
              <button
                onClick={() => setInteractionMode('draw')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  interactionMode === 'draw' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Draw mode: Write on slide"
              >
                <Pen className="w-3.5 h-3.5" />
                <span>Draw</span>
              </button>
              <button
                onClick={() => setInteractionMode('pan')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                  interactionMode === 'pan' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                title="Pan mode: Zoom and drag slide"
              >
                <Hand className="w-3.5 h-3.5" />
                <span>Pan/Zoom</span>
              </button>
            </div>

            {/* Tools (Only when interactionMode === 'draw') */}
            {interactionMode === 'draw' && (
              <>
                <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setStudentPenTool('pen')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      studentPenTool === 'pen' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Pen Tool"
                  >
                    <Pen className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setStudentPenTool('arrow')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      studentPenTool === 'arrow' ? 'bg-osu-orange text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Arrow Tool (Drag from start to tip)"
                  >
                    <MoveRight className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setStudentPenTool('highlighter')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      studentPenTool === 'highlighter' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Highlighter Tool"
                  >
                    <Highlighter className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setStudentPenTool('text')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      studentPenTool === 'text' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Text Tool (Click on slide to add text)"
                  >
                    <Type className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setStudentPenTool('eraser')}
                    className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      studentPenTool === 'eraser' ? 'bg-red-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Eraser Tool"
                  >
                    <Eraser className="w-3 h-3" />
                  </button>
                </div>

                {/* Color Swatches */}
                {studentPenTool === 'pen' || studentPenTool === 'arrow' || studentPenTool === 'text' ? (
                  <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
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
                        onClick={() => setStudentPenColor(c.color)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                          studentPenColor === c.color ? 'scale-125 border-white ring-2 ring-red-500' : 'border-slate-700 hover:scale-110'
                        }`}
                        style={{ backgroundColor: c.color }}
                        title={c.name}
                      />
                    ))}
                  </div>
                ) : studentPenTool === 'highlighter' ? (
                  <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
                    {[
                      { color: '#EAB308', name: 'Yellow' },
                      { color: '#EF4444', name: 'Red' },
                      { color: '#22C55E', name: 'Green' },
                      { color: '#3B82F6', name: 'Blue' }
                    ].map(c => (
                      <button
                        key={c.color}
                        onClick={() => setStudentHighlighterColor(c.color)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                          studentHighlighterColor === c.color ? 'scale-125 border-white ring-2 ring-amber-400' : 'border-slate-700 hover:scale-110'
                        }`}
                        style={{ backgroundColor: c.color }}
                        title={c.name}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Actions: Undo / Redo / Clear */}
                <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
                  <button
                    onClick={handleStudentUndo}
                    disabled={undoStack.length === 0}
                    className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Undo stroke"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleStudentRedo}
                    disabled={redoStack.length === 0}
                    className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Redo stroke"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleStudentClear}
                    disabled={studentStrokes.length === 0}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 hover:bg-red-900 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-bold transition-all cursor-pointer"
                    title="Clear my slide markings"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        
        <button
          onClick={onClose}
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
            : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
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
                    opacity={stroke.isHighlighter ? 0.45 : 1}
                  />
                );
              })}
            </svg>
          )}

          {/* Interactive Student Drawing Layer (Student's own private slide markings) */}
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className={`absolute inset-0 w-full h-full z-20 ${
              allowStudentDrawing && interactionMode === 'draw' ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
            }`}
            onPointerDown={allowStudentDrawing && interactionMode === 'draw' ? handleStudentPointerDown : undefined}
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
                  opacity={stroke.isHighlighter ? 0.45 : 1}
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
                opacity={activeStudentStroke.isHighlighter ? 0.45 : 1}
              />
            )}
          </svg>
        </div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center justify-center p-4 z-50">
        <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-900/90 border border-white/10 rounded-full shadow-2xl backdrop-blur-md">
          <button
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
            onClick={handleZoomIn}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90 cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-1" />
          
          <button
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
