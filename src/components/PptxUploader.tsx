import React, { useState, useRef } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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

export const PptxUploader: React.FC<PptxUploaderProps> = ({
  presentationId,
  currentPptxUrl,
  currentFileName,
  onUploadSuccess,
  className = '',
  compact = false
}) => {
  const [isUploading, setIsUploading] = useState(false);
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
    setFileName(file.name);
    setIsSuccess(false);

    try {
      // 1. Upload to Firebase Storage under /presentations/{presentationId}/source.pptx
      const storagePath = `presentations/${presentationId}/source.pptx`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, file, {
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      });

      // 2. Retrieve public download URL
      const downloadUrl = await getDownloadURL(storageRef);

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
              <span>Uploading PPTX...</span>
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
        className={`group relative border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer select-none ${
          isUploading
            ? 'border-osu-orange/50 bg-osu-orange/5 cursor-wait'
            : currentPptxUrl || isSuccess
            ? 'border-emerald-500/40 bg-emerald-950/20 hover:border-emerald-500/60'
            : 'border-slate-700 hover:border-osu-orange/60 bg-slate-850/60 hover:bg-slate-800/60'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-2">
          {isUploading ? (
            <>
              <div className="w-10 h-10 rounded-full bg-osu-orange/10 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-osu-orange animate-spin" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-white">Uploading PowerPoint (.pptx)...</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[220px]">{fileName}</p>
              </div>
            </>
          ) : currentPptxUrl || isSuccess ? (
            <>
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-emerald-300">PowerPoint Uploaded</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[220px]">
                  {fileName || currentFileName || 'source.pptx'}
                </p>
                <p className="text-[9px] text-slate-500 underline hover:text-slate-400 pt-0.5">
                  Click to replace file
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-slate-800 group-hover:bg-osu-orange/10 flex items-center justify-center border border-slate-700 group-hover:border-osu-orange/40 transition-colors">
                <UploadCloud className="w-5 h-5 text-slate-400 group-hover:text-osu-orange transition-colors" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-200 group-hover:text-white transition-colors">
                  Upload PowerPoint (.pptx)
                </p>
                <p className="text-[10px] text-slate-400">
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
