import React, { useState, useEffect, useRef } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { DrawingStroke } from '../types';

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
  drawingStrokesJson?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title = "Pushed Slide View",
  drawingStrokesJson
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse drawing strokes if provided
  let strokes: DrawingStroke[] = [];
  if (drawingStrokesJson) {
    try {
      const parsed = JSON.parse(drawingStrokesJson);
      if (Array.isArray(parsed)) strokes = parsed;
    } catch {}
  }

  // Reset zoom and panning when opened/closed or image changes
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl]);

  // Handle keyboard events (Escape to close, +/- to zoom)
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
    e.preventDefault();
    if (scale <= 1 && position.x === 0 && position.y === 0) {
      // Don't drag if not zoomed in or translated
      return;
    }
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom via mouse wheel
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = 0.1;
    if (e.deltaY < 0) {
      // Zoom in
      setScale(prev => Math.min(prev + zoomFactor, 4));
    } else {
      // Zoom out
      setScale(prev => Math.max(prev - zoomFactor, 0.5));
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-200">
      {/* Top Header Panel */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-900/40 border-b border-white/5 z-50">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-osu-orange uppercase tracking-wider">ActiveDeck Inspection</span>
          <span className="text-sm font-bold text-white truncate max-w-xs md:max-w-md">{title}</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Download option disabled */}
          
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-red-600 hover:bg-red-750 text-white transition-colors flex items-center justify-center cursor-pointer"
            title="Close Lightbox"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Image Container */}
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden flex items-center justify-center p-4 cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
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
          className="relative max-w-full max-h-[75vh] flex items-center justify-center duration-150"
        >
          <img
            src={imageUrl}
            alt="Pushed Slide Details"
            className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl border border-white/10 pointer-events-none select-none"
            draggable={false}
          />
          {strokes.length > 0 && (
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            >
              {strokes.map((stroke, idx) => {
                if (!stroke.points || stroke.points.length === 0) return null;
                const pathD = stroke.points.length === 1
                  ? `M ${stroke.points[0].x} ${stroke.points[0].y} L ${stroke.points[0].x + 0.1} ${stroke.points[0].y + 0.1}`
                  : stroke.points.reduce((acc, pt, i) => i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`, '');
                return (
                  <path
                    key={`lightbox-stroke-${idx}`}
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
        </div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center justify-center p-6 z-50">
        <div className="flex items-center gap-3 px-6 py-3 bg-slate-900/90 border border-white/10 rounded-full shadow-2xl backdrop-blur-md">
          <button
            onClick={handleZoomOut}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          
          <span className="text-xs font-mono font-bold text-white w-12 text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          
          <button
            onClick={handleZoomIn}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-1" />
          
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-350 hover:text-white text-[10px] font-black uppercase tracking-widest rounded-full transition-all active:scale-95 border border-white/5"
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
