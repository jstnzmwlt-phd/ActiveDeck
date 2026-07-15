import React, { useRef, useEffect, useState } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Strikethrough, 
  List, 
  ListOrdered, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  Trash2,
  Undo,
  Redo,
  Baseline,
  Highlighter,
  ChevronDown
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const FONT_COLORS = [
  { name: 'Default', value: '#0f172a' }, // Slate-900 (matches editor default text-slate-900)
  { name: 'Red', value: '#ef4444' },     // Red-500
  { name: 'Orange', value: '#f97316' },  // Orange-500
  { name: 'Yellow', value: '#eab308' },  // Yellow-500
  { name: 'Green', value: '#22c55e' },   // Green-500
  { name: 'Blue', value: '#3b82f6' },    // Blue-500
  { name: 'Purple', value: '#a855f7' },  // Purple-500
  { name: 'Pink', value: '#ec4899' },    // Pink-500
  { name: 'Gray', value: '#64748b' },    // Slate-500
];

const HIGHLIGHT_COLORS = [
  { name: 'None', value: 'transparent' }, // Transparent / Clear
  { name: 'Yellow', value: '#fef08a' },   // Yellow-200
  { name: 'Green', value: '#bbf7d0' },    // Green-200
  { name: 'Blue', value: '#bfdbfe' },     // Blue-200
  { name: 'Pink', value: '#fbcfe8' },     // Pink-200
  { name: 'Purple', value: '#e9d5ff' },   // Purple-200
  { name: 'Orange', value: '#fed7aa' },   // Orange-200
  { name: 'Red', value: '#fecaca' },      // Red-200
];

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Type your notes here...',
  className = '',
  onFocus,
  onBlur
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const textColorRef = useRef<HTMLDivElement>(null);
  const highlightColorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  const [isTextColorOpen, setIsTextColorOpen] = useState(false);
  const [isHighlightColorOpen, setIsHighlightColorOpen] = useState(false);
  const [selectedTextColor, setSelectedTextColor] = useState('#0f172a');
  const [selectedHighlightColor, setSelectedHighlightColor] = useState('transparent');

  // Sync internal innerHTML with outer value, but only if it's different from current state
  // to avoid resetting selection/caret position on every keystroke
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  // Click away listener to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (textColorRef.current && !textColorRef.current.contains(e.target as Node)) {
        setIsTextColorOpen(false);
      }
      if (highlightColorRef.current && !highlightColorRef.current.contains(e.target as Node)) {
        setIsHighlightColorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      }
    }
  };

  const execFormat = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    handleInput();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const handleColorClick = (command: 'foreColor' | 'hiliteColor', color: string) => {
    restoreSelection();
    execFormat(command, color);
    
    if (command === 'foreColor') {
      setSelectedTextColor(color);
      setIsTextColorOpen(false);
    } else {
      setSelectedHighlightColor(color);
      setIsHighlightColorOpen(false);
    }
  };

  return (
    <div className={`flex flex-col border border-slate-200 rounded-xl bg-white text-slate-900 shadow-sm overflow-hidden transition-all focus-within:ring-1 focus-within:ring-osu-orange focus-within:border-osu-orange ${className}`}>
      {/* Rich Text Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-1 bg-slate-50 border-b border-slate-100 select-none shrink-0">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('bold');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Bold (Ctrl+B)"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('italic');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Italic (Ctrl+I)"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('underline');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Underline (Ctrl+U)"
        >
          <Underline className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('strikeThrough');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Strikethrough"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        {/* Text Color Dropdown */}
        <div className="relative" ref={textColorRef}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
              setIsTextColorOpen(!isTextColorOpen);
              setIsHighlightColorOpen(false);
            }}
            className="flex items-center gap-0.5 p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
            title="Text Color"
          >
            <div className="relative flex flex-col items-center">
              <Baseline className="w-3.5 h-3.5" />
              <div 
                className="absolute bottom-[-2px] left-0 right-0 h-[3px] rounded-sm"
                style={{ backgroundColor: selectedTextColor }}
              />
            </div>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {isTextColorOpen && (
            <div 
              className="absolute left-0 mt-1 p-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[140px]"
              onMouseDown={(e) => e.preventDefault()} // Keep focus on contentEditable
            >
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">
                Text Color
              </div>
              <div className="grid grid-cols-5 gap-1">
                {FONT_COLORS.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => handleColorClick('foreColor', color.value)}
                    className="w-5 h-5 rounded-full border border-slate-200 cursor-pointer flex items-center justify-center hover:scale-110 transition-transform"
                    style={{ backgroundColor: color.value === 'transparent' ? '#ffffff' : color.value }}
                    title={color.name}
                  >
                    {selectedTextColor === color.value && (
                      <div className={`w-1.5 h-1.5 rounded-full ${color.value === '#0f172a' ? 'bg-white' : 'bg-slate-900'}`} />
                    )}
                  </button>
                ))}
              </div>

              {/* Custom Text Color Picker */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 mt-1.5 px-0.5">
                <span className="text-[10px] font-medium text-slate-500">Custom</span>
                <label className="relative flex items-center justify-center w-5 h-5 rounded border border-slate-200 cursor-pointer overflow-hidden bg-slate-50 hover:bg-slate-100 transition-colors">
                  <span className="text-[10px] font-bold text-slate-600">+</span>
                  <input
                    type="color"
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    onChange={(e) => handleColorClick('foreColor', e.target.value)}
                    onClick={saveSelection}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Highlight Color Dropdown */}
        <div className="relative" ref={highlightColorRef}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
              setIsHighlightColorOpen(!isHighlightColorOpen);
              setIsTextColorOpen(false);
            }}
            className="flex items-center gap-0.5 p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
            title="Highlight Color"
          >
            <div className="relative flex flex-col items-center">
              <Highlighter className="w-3.5 h-3.5" />
              <div 
                className="absolute bottom-[-2px] left-0 right-0 h-[3px] rounded-sm"
                style={{ backgroundColor: selectedHighlightColor === 'transparent' ? 'transparent' : selectedHighlightColor }}
              />
            </div>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {isHighlightColorOpen && (
            <div 
              className="absolute left-0 mt-1 p-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[140px]"
              onMouseDown={(e) => e.preventDefault()} // Keep focus on contentEditable
            >
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">
                Highlight Color
              </div>
              <div className="grid grid-cols-5 gap-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => handleColorClick('hiliteColor', color.value)}
                    className="w-5 h-5 rounded-full border border-slate-200 cursor-pointer flex items-center justify-center hover:scale-110 transition-transform overflow-hidden relative"
                    style={{ backgroundColor: color.value === 'transparent' ? '#ffffff' : color.value }}
                    title={color.name}
                  >
                    {color.value === 'transparent' && (
                      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-red-500/20 to-transparent rotate-45" style={{ borderTop: '1px solid #ef4444' }} />
                    )}
                    {selectedHighlightColor === color.value && (
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-900 z-10" />
                    )}
                  </button>
                ))}
              </div>

              {/* Custom Highlight Color Picker */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 mt-1.5 px-0.5">
                <span className="text-[10px] font-medium text-slate-500">Custom</span>
                <label className="relative flex items-center justify-center w-5 h-5 rounded border border-slate-200 cursor-pointer overflow-hidden bg-slate-50 hover:bg-slate-100 transition-colors">
                  <span className="text-[10px] font-bold text-slate-600">+</span>
                  <input
                    type="color"
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    onChange={(e) => handleColorClick('hiliteColor', e.target.value)}
                    onClick={saveSelection}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('insertUnorderedList');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Bullet List"
        >
          <List className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('insertOrderedList');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Numbered List"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('justifyLeft');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Align Left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('justifyCenter');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Align Center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('justifyRight');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Align Right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-4 bg-slate-200 mx-1" />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('undo');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Undo (Ctrl+Z)"
        >
          <Undo className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('redo');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Redo (Ctrl+Y)"
        >
          <Redo className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('removeFormat');
            setSelectedTextColor('#0f172a');
            setSelectedHighlightColor('transparent');
          }}
          className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 active:bg-slate-200 transition-colors cursor-pointer"
          title="Clear Formatting"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Editor Content Area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onFocus={onFocus}
        onBlur={onBlur}
        className="rich-text-editor flex-1 p-3 text-xs outline-none overflow-y-auto leading-relaxed focus:ring-0 focus:outline-none"
        style={{ minHeight: '120px' }}
        {...{ placeholder } as any}
      />
    </div>
  );
};
