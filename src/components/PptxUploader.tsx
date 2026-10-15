import React, { useState, useRef } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { storage, db } from '../firebase';
import { DeckItem } from '../types';
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';

interface PptxUploaderProps {
  presentationId: string;
  currentPptxUrl?: string;
  currentFileName?: string;
  onUploadSuccess?: (url: string, name?: string, size?: number) => void;
  className?: string;
  compact?: boolean;
}

const formatMB = (bytes?: number) => {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
};

export const PptxUploader: React.FC<PptxUploaderProps> = ({
  presentationId,
  currentPptxUrl,
  currentFileName,
  onUploadSuccess,
  className = '',
  compact = false
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pptx')) {
      setUploadError('Please select a valid PowerPoint (.pptx) file.');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadPercent(0);
    setUploadProgressText(`Uploading: 0% (0 MB / ${formatMB(file.size)})`);
    setFileName(file.name);
    setIsSuccess(false);

    try {
      // 1. Upload to Firebase Storage with a unique timestamped path to prevent collisions
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `presentations/${presentationId}/decks/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
              : 0;
            setUploadPercent(progress);
            setUploadProgressText(`Uploading: ${progress}% (${formatMB(snapshot.bytesTransferred)} / ${formatMB(snapshot.totalBytes)})`);
          },
          (error) => reject(error),
          () => resolve()
        );
      });

      // 2. Retrieve public download URL
      const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

      // 3. Save download URL and append to uploadedDecks
      const newDeck: DeckItem = {
        id: `deck_${Date.now()}`,
        name: file.name,
        url: downloadUrl,
        uploadedAt: Date.now(),
        size: file.size
      };

      const presDocRef = doc(db, 'presentations', presentationId);
      await updateDoc(presDocRef, {
        pptxUrl: downloadUrl,
        pptxFileName: file.name,
        selectedDeckId: newDeck.id,
        currentSlideBase64: null,
        current_slide_base64: null,
        currentSlide: 0,
        totalSlides: 0,
        uploadedDecks: arrayUnion(newDeck)
      });

      setIsSuccess(true);
      if (onUploadSuccess) {
        onUploadSuccess(downloadUrl, file.name, file.size);
      }
    } catch (err: any) {
      console.error('PptxUploader: Upload failed:', err);
      setUploadError(err?.message || 'Failed to upload PowerPoint file. Please try again.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (compact) {
    return (
      <div className={`relative ${className}`}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={handleFileChange}
          className="hidden"
          disabled={isUploading || !presentationId}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || !presentationId}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            isUploading
              ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
              : currentPptxUrl || isSuccess
              ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/80'
              : 'bg-slate-800/90 border border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white'
          }`}
          title="Upload .pptx presentation file"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-osu-orange" />
              <span>{uploadPercent > 0 ? `${uploadPercent}%` : 'Uploading...'}</span>
            </>
          ) : currentPptxUrl || isSuccess ? (
            <>
              <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="truncate max-w-[120px]">{fileName || currentFileName || 'PPTX Loaded'}</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-3.5 h-3.5 text-osu-orange" />
              <span>Upload PPTX</span>
            </>
          )}
        </button>
        {uploadError && (
          <p className="absolute top-full left-0 mt-1 text-[10px] text-red-400 bg-slate-900/90 px-2 py-0.5 rounded shadow z-10 whitespace-nowrap">
            {uploadError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={handleFileChange}
        className="hidden"
        disabled={isUploading || !presentationId}
      />

      <div
        onClick={() => !isUploading && presentationId && fileInputRef.current?.click()}
        className={`group relative border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer select-none h-[120px] min-h-[120px] max-h-[120px] flex items-center justify-center ${
          isUploading
            ? 'border-osu-orange/50 bg-osu-orange/5 cursor-wait'
            : currentPptxUrl || isSuccess
            ? 'border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-500/60'
            : 'border-slate-700 hover:border-osu-orange/60 bg-slate-850/60 hover:bg-slate-800/60'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-1.5 w-full min-w-0">
          {isUploading ? (
            <div className="w-full flex flex-col items-center justify-center gap-2 px-3">
              <div className="w-full flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Loader2 className="w-3.5 h-3.5 text-osu-orange animate-spin shrink-0" />
                  <span className="font-bold text-white truncate text-[11px] sm:text-xs">
                    {uploadProgressText || `Uploading: ${uploadPercent}%`}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-osu-orange font-black bg-slate-900 px-2 py-0.5 rounded border border-slate-750 shrink-0">
                  {uploadPercent}%
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800 p-0.5">
                <div 
                  className="bg-gradient-to-r from-amber-500 to-osu-orange h-full rounded-full transition-all duration-150 shadow"
                  style={{ width: `${Math.max(4, uploadPercent)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 truncate max-w-[280px] mx-auto block">{fileName}</p>
            </div>
          ) : currentPptxUrl || isSuccess ? (
            <>
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="w-full min-w-0 space-y-0.5">
                <p className="text-xs font-bold text-emerald-300 truncate">PowerPoint Uploaded</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[280px] mx-auto block" title={fileName || currentFileName || 'source.pptx'}>
                  {fileName || currentFileName || 'source.pptx'}
                </p>
                <p className="text-[9px] text-slate-500 underline hover:text-slate-400">
                  Click to replace file
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-slate-800 group-hover:bg-osu-orange/10 flex items-center justify-center border border-slate-700 group-hover:border-osu-orange/40 transition-colors shrink-0">
                <UploadCloud className="w-4 h-4 text-slate-400 group-hover:text-osu-orange transition-colors" />
              </div>
              <div className="w-full min-w-0 space-y-0.5">
                <p className="text-xs font-bold text-slate-200 group-hover:text-white transition-colors truncate">
                  Upload PowerPoint (.pptx)
                </p>
                <p className="text-[10px] text-slate-400 truncate max-w-[280px] mx-auto block">
                  Select your presentation file to sync with ActiveDeck
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="mt-2 flex items-center gap-1.5 p-2 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 text-[11px]">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="leading-tight">{uploadError}</span>
        </div>
      )}
    </div>
  );
};
