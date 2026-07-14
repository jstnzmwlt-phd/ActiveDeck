import React, { useRef, useState, useEffect } from 'react';
import { Pen, Eraser, Undo2, Redo2, Trash2, Highlighter } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
  isHighlighter?: boolean;
}

interface HandwrittenCanvasProps {
  value: string; // JSON string of Stroke[]
  onChange: (value: string) => void;
  placeholder?: string;
}

export function HandwrittenCanvas({ value, onChange, placeholder = "Draw your notes here..." }: HandwrittenCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Undo/Redo tracking
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);

  // Toolbar state
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [color, setColor] = useState<string>('#FF6600'); // Default OSU Orange
  const [width, setWidth] = useState<number>(5);

  const colors = [
    { value: '#FF6600', name: 'Orange' },
    { value: '#FFFFFF', name: 'White' },
    { value: '#3B82F6', name: 'Blue' },
    { value: '#10B981', name: 'Green' },
    { value: '#EAB308', name: 'Yellow' },
    { value: '#EC4899', name: 'Pink' },
  ];

  const widths = [
    { label: 'Thin', value: 3 },
    { label: 'Med', value: 6 },
    { label: 'Thick', value: 12 },
  ];

  // Adjust default widths and colors based on tool selection
  useEffect(() => {
    if (tool === 'highlighter') {
      setWidth(18);
      setColor('#EAB308'); // Highlighter yellow
    } else if (tool === 'pen') {
      setWidth(5);
      setColor('#FF6600'); // Default orange
    }
  }, [tool]);

  // Synchronize internal strokes state with prop value (slide change)
  useEffect(() => {
    try {
      const parsed = value ? JSON.parse(value) : [];
      if (Array.isArray(parsed)) {
        setStrokes(parsed);
        setUndoStack([parsed]);
        setRedoStack([]);
      } else {
        setStrokes([]);
        setUndoStack([[]]);
        setRedoStack([]);
      }
    } catch {
      setStrokes([]);
      setUndoStack([[]]);
      setRedoStack([]);
    }
  }, [value]);

  const getCoordinates = (e: React.PointerEvent<SVGSVGElement>): Point | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    
    // Normalize coordinates to 0-1000 range regardless of canvas size
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (e.button !== 0) return; // Only draw with main button (left click / primary touch)
    svgRef.current?.setPointerCapture(e.pointerId);

    const coords = getCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);

    if (tool === 'eraser') {
      eraseAt(coords.x, coords.y);
    } else {
      const isHighlighter = tool === 'highlighter';
      const newStroke: Stroke = {
        points: [coords],
        color,
        width,
        isHighlighter
      };
      setActiveStroke(newStroke);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    if (tool === 'eraser') {
      eraseAt(coords.x, coords.y);
    } else if (activeStroke) {
      // Limit frequency of points slightly for smoother SVG and smaller payload sizes
      const lastPoint = activeStroke.points[activeStroke.points.length - 1];
      if (lastPoint) {
        const dist = Math.hypot(coords.x - lastPoint.x, coords.y - lastPoint.y);
        if (dist < 2) return; // Ignore micro movements
      }

      setActiveStroke({
        ...activeStroke,
        points: [...activeStroke.points, coords]
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    svgRef.current?.releasePointerCapture(e.pointerId);
    setIsDrawing(false);

    if (tool !== 'eraser' && activeStroke && activeStroke.points.length > 0) {
      const updatedStrokes = [...strokes, activeStroke];
      setStrokes(updatedStrokes);
      
      const newHistory = [...undoStack, updatedStrokes].slice(-30); // Keep last 30 actions
      setUndoStack(newHistory);
      setRedoStack([]);
      
      onChange(JSON.stringify(updatedStrokes));
    }
    setActiveStroke(null);
  };

  const eraseAt = (x: number, y: number) => {
    let erased = false;
    // Eraser brush radius on our 1000x1000 scale
    const eraserRadius = 25; 

    const updatedStrokes = strokes.filter(stroke => {
      const hit = stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < eraserRadius);
      if (hit) erased = true;
      return !hit;
    });

    if (erased) {
      setStrokes(updatedStrokes);
      const newHistory = [...undoStack, updatedStrokes].slice(-30);
      setUndoStack(newHistory);
      setRedoStack([]);
      onChange(JSON.stringify(updatedStrokes));
    }
  };

  const handleUndo = () => {
    if (undoStack.length <= 1) return; // Nothing to undo (first state is empty or initial)
    const prevStates = [...undoStack];
    const currentState = prevStates.pop(); // Remove current state
    const targetState = prevStates[prevStates.length - 1] || [];

    setUndoStack(prevStates);
    if (currentState) {
      setRedoStack([...redoStack, currentState]);
    }
    setStrokes(targetState);
    onChange(JSON.stringify(targetState));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextStates = [...redoStack];
    const targetState = nextStates.pop() || [];

    setUndoStack([...undoStack, targetState]);
    setRedoStack(nextStates);
    setStrokes(targetState);
    onChange(JSON.stringify(targetState));
  };

  const handleClear = () => {
    if (strokes.length === 0) return;
    if (confirm("Clear all drawing notes on this slide?")) {
      const emptyState: Stroke[] = [];
      setStrokes(emptyState);
      setUndoStack([...undoStack, emptyState].slice(-30));
      setRedoStack([]);
      onChange(JSON.stringify(emptyState));
    }
  };

  return (
    <div className="flex-1 min-h-[300px] flex flex-col bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative select-none">
      {/* Sleek Floating Glassmorphic Drawing Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/90 border-b border-white/5 backdrop-blur-md shrink-0">
        
        {/* Tools */}
        <div className="flex items-center bg-slate-950/60 rounded-xl p-1 border border-white/5">
          <button
            type="button"
            onClick={() => setTool('pen')}
            className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${
              tool === 'pen'
                ? 'bg-osu-orange text-white'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Pen Stylus"
          >
            <Pen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pen</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('highlighter')}
            className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${
              tool === 'highlighter'
                ? 'bg-osu-orange text-white'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Highlighter"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Highlight</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('eraser')}
            className={`p-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${
              tool === 'eraser'
                ? 'bg-osu-orange text-white'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Stroke Eraser"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Eraser</span>
          </button>
        </div>

        {/* Dynamic Width / Colors controls - Hidden on Eraser mode */}
        {tool !== 'eraser' && (
          <div className="flex items-center gap-3">
            {/* Stroke Thickness Selector */}
            <div className="flex bg-slate-950/40 rounded-xl p-0.5 border border-white/5">
              {widths.map(w => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setWidth(tool === 'highlighter' ? w.value * 3 : w.value)}
                  className={`px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                    (tool === 'highlighter' ? width === w.value * 3 : width === w.value)
                      ? 'bg-slate-800 text-white font-black'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>

            {/* Colors */}
            <div className="flex items-center gap-1.5">
              {colors.map(c => {
                const isSelected = color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    style={{ backgroundColor: c.value }}
                    className={`w-5 h-5 rounded-full cursor-pointer transition-all border relative flex items-center justify-center ${
                      isSelected 
                        ? 'border-white scale-110 shadow-lg shadow-white/10 ring-2 ring-osu-orange/50' 
                        : 'border-white/10 hover:scale-105 hover:border-white/30'
                    }`}
                    title={c.name}
                  >
                    {isSelected && (
                      <span className="absolute w-1 h-1 rounded-full bg-slate-900 invert" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* History & Utility Actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length <= 1}
            className="p-2 rounded-xl bg-slate-950/40 hover:bg-slate-900 text-slate-400 hover:text-white border border-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Undo stroke"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-xl bg-slate-950/40 hover:bg-slate-900 text-slate-400 hover:text-white border border-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Redo stroke"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="p-2 rounded-xl bg-red-950/20 border border-red-500/10 text-red-400 hover:text-red-300 hover:bg-red-950/40 disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-all"
            title="Clear all drawings on slide"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>

      {/* SVG Vector Drawing Area */}
      <div className="flex-1 relative bg-[#030712] overflow-hidden cursor-crosshair">
        {strokes.length === 0 && !activeStroke && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none pointer-events-none opacity-30">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{placeholder}</p>
            <p className="text-[10px] text-slate-500 mt-1">Use your stylus or touch to draw notes on this slide.</p>
          </div>
        )}
        
        <svg
          ref={svgRef}
          viewBox="0 0 1000 1000"
          className="w-full h-full touch-none select-none absolute inset-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: 'none' }} // Prevents browser scrolling or zooming on mobile/tablets while drawing
        >
          {/* Render existing completed strokes */}
          {strokes.map((stroke, index) => {
            if (stroke.points.length === 0) return null;
            const pathData = stroke.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
              .join(' ');
              
            return (
              <path
                key={index}
                d={pathData}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={stroke.isHighlighter ? 0.35 : 1}
              />
            );
          })}

          {/* Render active current drawing stroke */}
          {activeStroke && activeStroke.points.length > 0 && (
            <path
              d={activeStroke.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                .join(' ')
              }
              fill="none"
              stroke={activeStroke.color}
              strokeWidth={activeStroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={activeStroke.isHighlighter ? 0.35 : 1}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
