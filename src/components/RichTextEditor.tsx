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
  ChevronDown,
  Sun,
  Moon
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  editorTheme?: 'dark' | 'light' | 'paper';
  onEditorThemeChange?: (theme: 'dark' | 'paper') => void;
}

const FONT_COLORS = [
  { name: 'Default (Dark/Auto)', value: 'default' },
  { name: 'Red', value: '#ef4444' },     // Red-500
  { name: 'Orange', value: '#f97316' },  // Orange-500
  { name: 'Yellow', value: '#eab308' },  // Yellow-500
  { name: 'Green', value: '#22c55e' },   // Green-500
  { name: 'Blue', value: '#3b82f6' },    // Blue-500
  { name: 'Purple', value: '#a855f7' },  // Purple-500
  { name: 'Pink', value: '#ec4899' },    // Pink-500
  { name: 'Gray', value: '#94a3b8' },    // Slate-400
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
  onBlur,
  editorTheme = 'dark',
  onEditorThemeChange
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const textColorRef = useRef<HTMLDivElement>(null);
  const highlightColorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  const [isTextColorOpen, setIsTextColorOpen] = useState(false);
  const [isHighlightColorOpen, setIsHighlightColorOpen] = useState(false);
  const [selectedTextColor, setSelectedTextColor] = useState('default');
  const [selectedHighlightColor, setSelectedHighlightColor] = useState('transparent');

  const [fontSize, setFontSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('activedeck_editor_font_size');
      return saved ? parseInt(saved, 10) : 16;
    } catch {
      return 16;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('activedeck_editor_font_size', fontSize.toString());
    } catch (e) {
      console.warn("localStorage failed:", e);
    }
  }, [fontSize]);

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

  const execFormat = (command: string, val: string = '') => {
    document.execCommand(command, false, val);
    handleInput();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const isDarkSurface = editorTheme === 'dark';

  const handleColorClick = (command: 'foreColor' | 'hiliteColor', color: string) => {
    restoreSelection();
    if (command === 'foreColor' && color === 'default') {
      execFormat('foreColor', isDarkSurface ? '#f1f5f9' : '#0f172a');
    } else {
      execFormat(command, color);
    }
    
    if (command === 'foreColor') {
      setSelectedTextColor(color);
      setIsTextColorOpen(false);
    } else {
      setSelectedHighlightColor(color);
      setIsHighlightColorOpen(false);
    }
  };

  const resolvedSwatchBarColor = selectedTextColor === 'default'
    ? (isDarkSurface ? '#f1f5f9' : '#0f172a')
    : selectedTextColor;

  const toolBtnClass = isDarkSurface
    ? 'p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 active:bg-slate-700 transition-colors cursor-pointer'
    : 'p-1.5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 active:bg-slate-300 transition-colors cursor-pointer';

  const dividerClass = isDarkSurface
    ? 'w-px h-4 bg-slate-700/80 mx-1'
    : 'w-px h-4 bg-slate-200 mx-1';

  return (
    <div
      className={`flex flex-col border rounded-xl shadow-sm relative z-10 transition-all focus-within:ring-1 focus-within:ring-osu-orange focus-within:border-osu-orange ${
        isDarkSurface
          ? 'bg-[#1E293B] border-slate-700/80 text-slate-100'
          : 'bg-[#FFFFFF] border-slate-200 text-slate-900'
      } ${className}`}
    >
      {/* Rich Text Toolbar */}
      <div className={`flex flex-row flex-wrap items-center gap-0.5 px-2 py-1.5 border-b select-none shrink-0 rounded-t-xl relative z-20 ${
        isDarkSurface
          ? 'bg-slate-900 border-slate-700/80'
          : 'bg-slate-50 border-slate-200'
      }`}>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('bold');
          }}
          className={toolBtnClass}
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
          className={toolBtnClass}
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
          className={toolBtnClass}
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
          className={toolBtnClass}
          title="Strikethrough"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>

        <div className={dividerClass} />

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
            className={`flex items-center gap-0.5 ${toolBtnClass}`}
            title="Text Color"
          >
            <div className="relative flex flex-col items-center">
              <Baseline className="w-3.5 h-3.5" />
              <div 
                className="absolute bottom-[-2px] left-0 right-0 h-[3px] rounded-sm"
                style={{ backgroundColor: resolvedSwatchBarColor }}
              />
            </div>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {isTextColorOpen && (
            <div 
              className={`absolute left-0 top-full mt-1 p-2 border rounded-xl shadow-2xl z-[100] min-w-[150px] animate-in fade-in slide-in-from-top-1 duration-150 ${
                isDarkSurface ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
              }`}
              onMouseDown={(e) => e.preventDefault()} // Keep focus on contentEditable
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5 ${isDarkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
                Text Color
              </div>
              <div className="grid grid-cols-5 gap-1">
                {FONT_COLORS.map((color) => {
                  const swatchBg = color.value === 'default'
                    ? (isDarkSurface ? '#f1f5f9' : '#0f172a')
                    : color.value;
                  return (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => handleColorClick('foreColor', color.value)}
                      className={`w-5 h-5 rounded-full border cursor-pointer flex items-center justify-center hover:scale-110 transition-transform ${
                        isDarkSurface ? 'border-slate-600' : 'border-slate-300'
                      }`}
                      style={{ backgroundColor: swatchBg }}
                      title={color.name}
                    >
                      {selectedTextColor === color.value && (
                        <div className={`w-1.5 h-1.5 rounded-full ${swatchBg === '#0f172a' ? 'bg-white' : 'bg-slate-900'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom Text Color Picker */}
              <div className={`flex items-center justify-between border-t pt-1.5 mt-1.5 px-0.5 ${isDarkSurface ? 'border-slate-800' : 'border-slate-100'}`}>
                <span className={`text-[10px] font-medium ${isDarkSurface ? 'text-slate-400' : 'text-slate-500'}`}>Custom</span>
                <label className={`relative flex items-center justify-center w-5 h-5 rounded border cursor-pointer overflow-hidden transition-colors ${
                  isDarkSurface ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-slate-300 bg-slate-100 hover:bg-slate-200'
                }`}>
                  <span className={`text-[10px] font-bold ${isDarkSurface ? 'text-slate-300' : 'text-slate-600'}`}>+</span>
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
            className={`flex items-center gap-0.5 ${toolBtnClass}`}
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
              className={`absolute left-0 top-full mt-1 p-2 border rounded-xl shadow-2xl z-[100] min-w-[150px] animate-in fade-in slide-in-from-top-1 duration-150 ${
                isDarkSurface ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
              }`}
              onMouseDown={(e) => e.preventDefault()} // Keep focus on contentEditable
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 px-0.5 ${isDarkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
                Highlight Color
              </div>
              <div className="grid grid-cols-5 gap-1">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => handleColorClick('hiliteColor', color.value)}
                    className={`w-5 h-5 rounded-full border cursor-pointer flex items-center justify-center hover:scale-110 transition-transform overflow-hidden relative ${
                      isDarkSurface ? 'border-slate-600' : 'border-slate-300'
                    }`}
                    style={{ backgroundColor: color.value === 'transparent' ? (isDarkSurface ? '#1e293b' : '#f8fafc') : color.value }}
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
              <div className={`flex items-center justify-between border-t pt-1.5 mt-1.5 px-0.5 ${isDarkSurface ? 'border-slate-800' : 'border-slate-100'}`}>
                <span className={`text-[10px] font-medium ${isDarkSurface ? 'text-slate-400' : 'text-slate-500'}`}>Custom</span>
                <label className={`relative flex items-center justify-center w-5 h-5 rounded border cursor-pointer overflow-hidden transition-colors ${
                  isDarkSurface ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' : 'border-slate-300 bg-slate-100 hover:bg-slate-200'
                }`}>
                  <span className={`text-[10px] font-bold ${isDarkSurface ? 'text-slate-300' : 'text-slate-600'}`}>+</span>
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

        <div className={dividerClass} />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('insertUnorderedList');
          }}
          className={toolBtnClass}
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
          className={toolBtnClass}
          title="Numbered List"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>

        <div className={dividerClass} />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('justifyLeft');
          }}
          className={toolBtnClass}
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
          className={toolBtnClass}
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
          className={toolBtnClass}
          title="Align Right"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>

        <div className={dividerClass} />

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('undo');
          }}
          className={toolBtnClass}
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
          className={toolBtnClass}
          title="Redo (Ctrl+Y)"
        >
          <Redo className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            execFormat('removeFormat');
            setSelectedTextColor('default');
            setSelectedHighlightColor('transparent');
          }}
          className={toolBtnClass}
          title="Clear Formatting"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Font Size Adjusters */}
        <div className={`flex items-center gap-0.5 border-l pl-1.5 ml-1 ${isDarkSurface ? 'border-slate-700/80' : 'border-slate-200'}`}>
          <button
            type="button"
            onClick={() => setFontSize(prev => Math.max(12, prev - 1))}
            className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold ${toolBtnClass}`}
            title="Decrease Font Size"
          >
            A-
          </button>
          <span className={`text-[9px] font-black w-7 text-center select-none font-mono ${isDarkSurface ? 'text-slate-400' : 'text-slate-500'}`}>
            {fontSize}px
          </span>
          <button
            type="button"
            onClick={() => setFontSize(prev => Math.min(28, prev + 1))}
            className={`w-6 h-6 flex items-center justify-center text-xs font-bold ${toolBtnClass}`}
            title="Increase Font Size"
          >
            A+
          </button>
        </div>

        {/* Surface Theme Toggle (Dark Slate #1E293B vs Pure White #FFFFFF) */}
        {onEditorThemeChange && (
          <button
            type="button"
            onClick={() => onEditorThemeChange(isDarkSurface ? 'paper' : 'dark')}
            className={`ml-auto p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider ${
              isDarkSurface
                ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700/60'
                : 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200 shadow-xs'
            }`}
            title={isDarkSurface ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDarkSurface ? <Sun className="w-3 h-3 text-amber-400" /> : <Moon className="w-3 h-3 text-indigo-600" />}
            <span className="hidden sm:inline">{isDarkSurface ? 'Light' : 'Dark'}</span>
          </button>
        )}
      </div>

      {/* Editor Content Area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`rich-text-editor flex-1 p-3.5 outline-none overflow-y-auto leading-relaxed focus:ring-0 focus:outline-none rounded-b-xl ${
          isDarkSurface ? 'text-slate-100' : 'text-slate-900'
        }`}
        style={{ minHeight: '120px', fontSize: `${fontSize}px` }}
        {...{ placeholder } as any}
      />
    </div>
  );
};

