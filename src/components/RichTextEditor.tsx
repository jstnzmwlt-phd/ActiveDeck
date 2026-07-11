import React, { useRef, useEffect } from 'react';
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
  Redo
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Type your notes here...',
  className = ''
}) => {
  const editorRef = useRef<HTMLDivElement>(null);

  // Sync internal innerHTML with outer value, but only if it's different from current state
  // to avoid resetting selection/caret position on every keystroke
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execFormat = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    handleInput();
    if (editorRef.current) {
      editorRef.current.focus();
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
        className="rich-text-editor flex-1 p-3 text-xs outline-none overflow-y-auto leading-relaxed focus:ring-0 focus:outline-none"
        style={{ minHeight: '120px' }}
        {...{ placeholder } as any}
      />
    </div>
  );
};
