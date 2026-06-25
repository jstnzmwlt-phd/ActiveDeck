import React, { useEffect, useRef, useState } from 'react';
import { auth, db, storage } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, getDoc, getDocFromServer, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove, increment, where, writeBatch, Timestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Message, Presentation, Poll, WordCloud, OpenEndedQuestion, GlobalSettings } from '../types';
import { useAuth } from './AuthProvider';
import { useBridge } from '../contexts/BridgeContext';
import { Send, HelpCircle, MessageSquare, Trash2, ThumbsUp, Download, ToggleLeft, ToggleRight, BarChart2, CheckCircle2, XCircle, Cloud, Eye, EyeOff, Timer, Users, ChevronDown, ChevronUp, Pin, Loader2, AlertCircle, Presentation as PresentationIcon, Paperclip, Maximize2, Minimize2, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { MEDICAL_ICONS, MedicalIcon, generateIconGrid } from './MedicalIcon';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const renderTextWithLinks = (text: string) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      const href = part.startsWith('http://') || part.startsWith('https://') 
        ? part 
        : `https://${part}`;
      return (
        <a 
          key={index} 
          href={href} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline break-all font-bold"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};

const formatHtmlTextWithLinks = (text: string): string => {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  return text.replace(urlRegex, (url) => {
    const href = url.startsWith('http://') || url.startsWith('https://') 
      ? url 
      : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; word-break: break-all;">${url}</a>`;
  });
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface LocalTokenTracker {
  id: string;
  createdAt: number;
}

interface OpenEndedQuestionCardProps {
  q: OpenEndedQuestion;
  user: any;
  canModerate: boolean;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
  onStart: (id: string, duration: number) => void;
  onSubmit: (id: string, response: string) => void;
  onToggleResults: (id: string, visible: boolean) => void;
  onAdjustDuration: (id: string, duration: number) => void;
  initialCollapsed?: boolean;
  isInitiallyNew?: boolean;
  secondaryColor?: string;
}

const OpenEndedQuestionCard: React.FC<OpenEndedQuestionCardProps> = ({ q, user, canModerate, onClose, onDelete, onStart, onSubmit, onToggleResults, onAdjustDuration, initialCollapsed = false, isInitiallyNew = false, secondaryColor }) => {
  const [response, setResponse] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyNew ? false : initialCollapsed);
  const prevInitialCollapsedRef = useRef(initialCollapsed);
  const responsesData = q.responses || {};
  const isDraft = q.started === false || (!q.started && !q.active && Object.values(q.responses || {}).length === 0);
  const showResults = !!q.showResults;
  const myResponse = user ? responsesData[user.uid] : null;
  const totalResponses = Object.values(responsesData).length;
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (!q.active || !q.expiresAt) return null;
    const now = Date.now();
    let expiresMs = 0;
    const exp = q.expiresAt;
    if (typeof exp.toMillis === 'function') {
      expiresMs = exp.toMillis();
    } else if (typeof exp.toDate === 'function') {
      expiresMs = exp.toDate().getTime();
    } else if (exp.seconds !== undefined) {
      expiresMs = exp.seconds * 1000;
    } else {
      expiresMs = new Date(exp as any).getTime();
    }
    return Math.max(0, Math.floor((expiresMs - now) / 1000));
  });

  useEffect(() => {
    if (!q.active || !q.expiresAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      let expiresMs = 0;
      const exp = q.expiresAt!;
      if (typeof exp.toMillis === 'function') {
        expiresMs = exp.toMillis();
      } else if (typeof exp.toDate === 'function') {
        expiresMs = exp.toDate().getTime();
      } else if (exp.seconds !== undefined) {
        expiresMs = exp.seconds * 1000;
      } else {
        expiresMs = new Date(exp as any).getTime();
      }
      const remaining = Math.max(0, Math.floor((expiresMs - now) / 1000));
      setTimeLeft(remaining);
    };

    updateTimer();

    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [q.active, q.expiresAt, q.id, canModerate]);

  useEffect(() => {
    if (prevInitialCollapsedRef.current !== initialCollapsed) {
      setIsCollapsed(initialCollapsed);
      prevInitialCollapsedRef.current = initialCollapsed;
    }
  }, [initialCollapsed]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!response.trim()) return;
    onSubmit(q.id, response.trim());
    setResponse('');
  };

  return (
    <div className="p-4 rounded-xl border-2 border-green-500 bg-white shadow-lg animate-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 -ml-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-green-500"
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <MessageSquare className="w-4 h-4 text-green-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Open Question</span>
        </div>
        <div className="flex items-center gap-2">
          {isCollapsed && q.active && timeLeft !== null && (
            <div className={`flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-100 rounded-lg text-xs font-mono font-black ${timeLeft > 10 ? 'text-slate-700' : 'text-red-500 animate-pulse'}`}>
              <Timer className="w-3.5 h-3.5" />
              <span>Time Left: </span>
              {Math.floor(timeLeft / 60)}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          )}
          {canModerate && (
            <>
              {q.active ? (
                <button onClick={() => onClose(q.id)} className="p-1 text-slate-400 hover:text-red-500" title="Close Question">
                  <XCircle className="w-4 h-4" />
                </button>
              ) : isDraft ? (
                <span className="text-[8px] font-bold text-green-500 uppercase">Draft</span>
              ) : (
                <span className="text-[8px] font-bold text-red-500 uppercase">Closed</span>
              )}
                <button 
                  onClick={() => onToggleResults(q.id, !!q.showResults)}                
                  className={`p-1 ${q.showResults ? 'text-green-500' : 'text-slate-400'} hover:text-green-500`}
                  title={q.showResults ? "Hide Results from Audience" : "Show Results to Audience"}
                >
                  {q.showResults ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              {isDraft && (
                <button onClick={() => onDelete(q.id)} className="p-1 text-slate-400 hover:text-red-500" title="Delete Question">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="mb-4">
            <h4 className="font-bold text-slate-800 text-lg">{q.prompt}</h4>
          </div>

          {q.active && timeLeft !== null && (
            <div className="mb-4 flex items-center justify-center gap-2.5 py-3 px-4 bg-green-50 border border-green-200/40 rounded-2xl shadow-sm animate-pulse">
              <Timer className={`w-6 h-6 ${timeLeft > 10 ? 'text-green-600' : 'text-red-500 animate-spin'}`} />
              <span className="text-xs uppercase font-black tracking-widest text-slate-500">Time Remaining:</span>
              <span className={`text-2xl font-black font-mono tracking-wider ${timeLeft > 10 ? 'text-slate-800' : 'text-red-600'}`}>
                {Math.floor(timeLeft / 60)}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}

          {isDraft && canModerate ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Set Duration</span>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => onAdjustDuration(q.id, Math.max(15, (q.duration || 60) - 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    -
                  </button>
                  <span className="text-2xl font-black text-slate-800 font-mono w-20 text-center">
                    {Math.floor((q.duration || 60) / 60)}:{((q.duration || 60) % 60).toString().padStart(2, '0')}
                  </span>
                  <button 
                    onClick={() => onAdjustDuration(q.id, Math.min(180, (q.duration || 60) + 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-2 mt-1">
                  <button 
                    onClick={() => onAdjustDuration(q.id, 60)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    1:00
                  </button>
                  <button 
                    onClick={() => onAdjustDuration(q.id, 120)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    2:00
                  </button>
                  <button 
                    onClick={() => onAdjustDuration(q.id, 180)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    3:00
                  </button>
                </div>
              </div>
              <button 
                onClick={() => onStart(q.id, q.duration || 60)}
                className="w-full py-3 bg-green-500 text-white font-black uppercase tracking-widest rounded-xl hover:bg-green-600 transition-all shadow-lg shadow-green-500/20 active:scale-95"
              >
                Start Question Now
              </button>
            </div>
          ) : (
            <>
              {q.active && !canModerate ? (
                <form onSubmit={handleSubmit} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={response}
                    onChange={e => setResponse(e.target.value)}
                    placeholder="Type your response..."
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-green-500"
                  />
                  <button type="submit" className="px-4 py-2 bg-green-500 text-white rounded-md text-sm font-bold hover:bg-green-600">
                    Submit
                  </button>
                </form>
              ) : null}
              
              {showResults ? (
                <div className="mt-4 space-y-2">
                  {Object.values(responsesData).map((r, i) => (
                    <div key={i} className="p-2 bg-slate-50 text-sm rounded shadow-sm text-slate-700">
                      {r}
                    </div>
                  ))}
                  {totalResponses === 0 && <span className="text-xs text-slate-400 italic">No responses yet.</span>}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {myResponse && !canModerate && (
                    <div className="p-2 bg-green-50 border border-green-100 text-sm rounded shadow-sm text-slate-700">
                      <span className="font-bold text-green-600">Your response:</span> {myResponse}
                    </div>
                  )}
                  <div className="p-3 bg-slate-100 text-slate-500 text-xs rounded-lg text-center italic border border-slate-200">
                      {canModerate ? (
                        <>
                          Responses are currently hidden from audience (<span style={{ color: secondaryColor }} className="text-sm font-black transition-colors duration-300">{totalResponses}</span> received)
                        </>
                      ) : "Results will be revealed by the presenter"}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

interface PollCardProps {
  poll: Poll;
  user: any;
  isChatOnly: boolean;
  canModerate: boolean;
  onVote: (pollId: string, option: string) => void;
  onToggleResults: (pollId: string, currentShow: boolean) => void;
  onClose: (pollId: string) => void;
  onDelete: (pollId: string) => void;
  onStart: (pollId: string, duration: number) => void;
  onAdjustDuration: (pollId: string, newDuration: number) => void;
  onMarkCorrect: (pollId: string, option: string) => void;
  initialCollapsed?: boolean;
  isInitiallyNew?: boolean;
  secondaryColor?: string;
}

const PollCard: React.FC<PollCardProps> = ({ poll, user, isChatOnly, canModerate, onVote, onToggleResults, onClose, onDelete, onStart, onAdjustDuration, onMarkCorrect, initialCollapsed = false, isInitiallyNew = false, secondaryColor }) => {
  const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
  const userVote = user && poll.voters ? poll.voters[user.uid] : null;
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (!poll.active || !poll.expiresAt) return null;
    const now = Date.now();
    let expiresMs = 0;
    const exp = poll.expiresAt;
    if (typeof exp.toMillis === 'function') {
      expiresMs = exp.toMillis();
    } else if (typeof exp.toDate === 'function') {
      expiresMs = exp.toDate().getTime();
    } else if (exp.seconds !== undefined) {
      expiresMs = exp.seconds * 1000;
    } else {
      expiresMs = new Date(exp as any).getTime();
    }
    return Math.max(0, Math.floor((expiresMs - now) / 1000));
  });
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyNew ? false : initialCollapsed);
  const prevInitialCollapsedRef = useRef(initialCollapsed);

  useEffect(() => {
    if (prevInitialCollapsedRef.current !== initialCollapsed) {
      setIsCollapsed(initialCollapsed);
      prevInitialCollapsedRef.current = initialCollapsed;
    }
  }, [initialCollapsed]);

  useEffect(() => {
    if (!poll.active || !poll.expiresAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      let expiresMs = 0;
      const exp = poll.expiresAt!;
      if (typeof exp.toMillis === 'function') {
        expiresMs = exp.toMillis();
      } else if (typeof exp.toDate === 'function') {
        expiresMs = exp.toDate().getTime();
      } else if (exp.seconds !== undefined) {
        expiresMs = exp.seconds * 1000;
      } else {
        expiresMs = new Date(exp as any).getTime();
      }
      const remaining = Math.max(0, Math.floor((expiresMs - now) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0 && poll.active && canModerate) {
        onClose(poll.id);
      }
    };

    updateTimer();

    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [poll.active, poll.expiresAt, poll.id, canModerate, onClose]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isDraft = poll.started === false || (!poll.started && !poll.active && !poll.expiresAt);
  const isClosed = !poll.active && (poll.expiresAt || poll.started);

  return (
    <div className="p-4 rounded-xl border-2 border-osu-orange bg-white shadow-lg animate-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 -ml-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-osu-orange"
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <BarChart2 className="w-4 h-4 text-osu-orange" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Poll</span>
          {isCollapsed && timeLeft !== null && (
            <div className="flex items-center gap-1.5 ml-2 px-2 py-1 bg-red-50 border border-red-100 rounded-lg text-xs font-mono font-black text-red-600">
              <Timer className="w-3.5 h-3.5" />
              {formatTime(timeLeft)}
            </div>
          )}
          {isDraft && canModerate && (
            <div className="flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-orange-50 border border-orange-100 rounded text-[10px] font-bold text-osu-orange">
              <Timer className="w-3 h-3" />
              {formatTime(poll.duration || 60)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canModerate && (
            <>
              <button 
                onClick={() => onToggleResults(poll.id, !!poll.showResults)}
                className={cn(
                  "p-1 rounded transition-colors",
                  poll.showResults 
                    ? "text-green-600 hover:text-green-700" 
                    : "text-red-500 hover:text-red-600"
                )}
                title={poll.showResults ? "Hide Results from Audience" : "Show Results to Audience"}
              >
                {poll.showResults ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              {poll.active ? (
                <button onClick={() => onClose(poll.id)} className="p-1 text-slate-400 hover:text-red-500" title="Close Poll">
                  <XCircle className="w-4 h-4" />
                </button>
              ) : isDraft ? (
                <span className="text-[8px] font-bold text-orange-500 uppercase">Draft</span>
              ) : (
                <span className="text-[8px] font-bold text-red-500 uppercase">Closed</span>
              )}
              {isDraft && (
                <button onClick={() => onDelete(poll.id)} className="p-1 text-slate-400 hover:text-red-500" title="Delete Poll">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {isDraft && canModerate ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Set Duration</span>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => onAdjustDuration(poll.id, Math.max(15, (poll.duration || 60) - 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    -
                  </button>
                  <span className="text-2xl font-black text-slate-800 font-mono w-20 text-center">
                    {formatTime(poll.duration || 60)}
                  </span>
                  <button 
                    onClick={() => onAdjustDuration(poll.id, Math.min(180, (poll.duration || 60) + 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-2 mt-1">
                  <button 
                    onClick={() => onAdjustDuration(poll.id, 60)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    1:00
                  </button>
                  <button 
                    onClick={() => onAdjustDuration(poll.id, 120)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    2:00
                  </button>
                  <button 
                    onClick={() => onAdjustDuration(poll.id, 180)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    3:00
                  </button>
                </div>
              </div>
              <button 
                onClick={() => onStart(poll.id, poll.duration || 60)}
                className="w-full py-3 bg-osu-orange text-white font-black uppercase tracking-widest rounded-xl hover:bg-[#c03900] transition-all shadow-lg shadow-orange-500/20 active:scale-95"
              >
                Start Poll Now
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {poll.active && timeLeft !== null && (
                <div className="flex items-center justify-center gap-2.5 py-3 px-4 bg-orange-50 border border-orange-200/40 rounded-2xl shadow-sm animate-pulse">
                  <Timer className={`w-6 h-6 ${timeLeft > 10 ? 'text-osu-orange' : 'text-red-500 animate-spin'}`} />
                  <span className="text-xs uppercase font-black tracking-widest text-slate-500">Time Remaining:</span>
                  <span className={`text-2xl font-black font-mono tracking-wider ${timeLeft > 10 ? 'text-slate-800' : 'text-red-600'}`}>
                    {formatTime(timeLeft)}
                  </span>
                </div>
              )}
              {poll.options.map(opt => {
                const count = poll.votes[opt] || 0;
                const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                const isSelected = userVote === opt;
                const isCorrect = poll.correctAnswer === opt;
                const hasCorrectAnswer = !!poll.correctAnswer;
                const canMarkCorrect = canModerate && !poll.active && poll.showResults;

                return (
                  <div key={opt} className="relative">
                    <button
                      disabled={(!poll.active && !canMarkCorrect) || (poll.active && (!!userVote || !isChatOnly))}
                      onClick={() => {
                        if (canMarkCorrect) {
                          onMarkCorrect(poll.id, opt);
                        } else {
                          onVote(poll.id, opt);
                        }
                      }}
                      className={cn(
                        "w-full relative overflow-hidden flex items-center justify-between px-4 py-2 rounded-lg border transition-all",
                        isSelected ? "border-osu-orange bg-orange-50" : "border-slate-200 hover:border-osu-orange/50 bg-white",
                        !poll.active && !canMarkCorrect && "opacity-80 cursor-default",
                        hasCorrectAnswer && isCorrect && "border-green-500 bg-green-50/30 ring-2 ring-green-500/20",
                        hasCorrectAnswer && !isCorrect && "border-red-500/50 grayscale-[0.5] opacity-70",
                        canMarkCorrect && !hasCorrectAnswer && "hover:border-green-500 cursor-pointer"
                      )}
                    >
                      {/* Result Bar */}
                      {poll.showResults && (
                        <div 
                          className="absolute inset-y-0 left-0 bg-osu-orange/35 transition-all duration-700 z-0" 
                          style={{ width: `${percentage}%` }}
                        />
                      )}
                      
                      <div className="flex items-center gap-3 relative z-10">
                        <span className={cn(
                          "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors", 
                          isSelected ? "bg-osu-orange text-white" : "bg-slate-100 text-slate-600",
                          hasCorrectAnswer && isCorrect && "bg-green-500 text-white",
                          hasCorrectAnswer && !isCorrect && "bg-slate-100 text-slate-400"
                        )}>
                          {opt}
                        </span>
                        {isSelected && <CheckCircle2 className="w-3 h-3 text-osu-orange" />}
                        {hasCorrectAnswer && isCorrect && <CheckCircle2 className="w-3 h-3 text-green-600 ml-1" />}
                      </div>
                      
                      {poll.showResults && (
                        <div className="flex items-center gap-2 relative z-10">
                          <span className="text-[10px] font-bold text-slate-400">{Math.round(percentage)}%</span>
                          <span className="text-xs font-bold text-slate-700">{count}</span>
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          
          {!isDraft && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span style={{ color: secondaryColor }} className="text-sm font-black transition-colors duration-300">{totalVotes}</span> Total Votes
              </span>
              {!poll.active && (
                <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">
                  {poll.correctAnswer ? "Correct Answer Set" : "Final Results"}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface WordCloudCardProps {
  cloud: WordCloud;
  user: any;
  isChatOnly: boolean;
  canModerate: boolean;
  onSubmit: (cloudId: string, word: string) => void;
  onToggleResults: (cloudId: string, currentShow: boolean) => void;
  onClose: (cloudId: string) => void;
  onDelete: (cloudId: string) => void;
  onStart: (cloudId: string, duration: number) => void;
  onAdjustDuration: (cloudId: string, newDuration: number) => void;
  initialCollapsed?: boolean;
  isInitiallyNew?: boolean;
  secondaryColor?: string;
}

const WordCloudCard: React.FC<WordCloudCardProps> = ({ cloud, user, isChatOnly, canModerate, onSubmit, onToggleResults, onClose, onDelete, onStart, onAdjustDuration, initialCollapsed = false, isInitiallyNew = false, secondaryColor }) => {
  const [word, setWord] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyNew ? false : initialCollapsed);
  const prevInitialCollapsedRef = useRef(initialCollapsed);
  const [timeLeft, setTimeLeft] = useState<number | null>(() => {
    if (!cloud.active || !cloud.expiresAt) return null;
    const now = Date.now();
    let expiresMs = 0;
    const exp = cloud.expiresAt;
    if (typeof exp.toMillis === 'function') {
      expiresMs = exp.toMillis();
    } else if (typeof exp.toDate === 'function') {
      expiresMs = exp.toDate().getTime();
    } else if (exp.seconds !== undefined) {
      expiresMs = exp.seconds * 1000;
    } else {
      expiresMs = new Date(exp as any).getTime();
    }
    return Math.max(0, Math.floor((expiresMs - now) / 1000));
  });

  useEffect(() => {
    if (prevInitialCollapsedRef.current !== initialCollapsed) {
      setIsCollapsed(initialCollapsed);
      prevInitialCollapsedRef.current = initialCollapsed;
    }
  }, [initialCollapsed]);

  useEffect(() => {
    if (!cloud.active || !cloud.expiresAt) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      let expiresMs = 0;
      const exp = cloud.expiresAt!;
      if (typeof exp.toMillis === 'function') {
        expiresMs = exp.toMillis();
      } else if (typeof exp.toDate === 'function') {
        expiresMs = exp.toDate().getTime();
      } else if (exp.seconds !== undefined) {
        expiresMs = exp.seconds * 1000;
      } else {
        expiresMs = new Date(exp as any).getTime();
      }
      const remaining = Math.max(0, Math.floor((expiresMs - now) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0 && cloud.active && canModerate) {
        onClose(cloud.id);
      }
    };

    updateTimer();

    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [cloud.active, cloud.expiresAt, cloud.id, canModerate, onClose]);

  const hasParticipated = user && cloud.participants ? cloud.participants[user.uid] : false;
  const totalWords = Object.values(cloud.words || {}).reduce((a, b) => a + b, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    onSubmit(cloud.id, word.trim().toLowerCase());
    setWord('');
  };

  const maxCount = Math.max(...Object.values(cloud.words || { _: 0 }), 0);
  const getFontSize = (count: number) => {
    const minSize = 14;
    const maxSize = 40;
    if (maxCount <= 1) return minSize + (maxSize - minSize) / 2;
    return minSize + ((count - 1) / (maxCount - 1)) * (maxSize - minSize);
  };

  const colors = ['#ff3e00', '#1e293b', '#334155', '#ea580c', '#c2410c', '#0f172a'];
  const getWordColor = (wordStr: string) => {
    let hash = 0;
    for (let i = 0; i < wordStr.length; i++) {
      hash = wordStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const isDraft = cloud.started === false || (!cloud.started && !cloud.active && !cloud.expiresAt);

  return (
    <div className="p-4 rounded-xl border-2 border-blue-500 bg-white shadow-lg animate-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 -ml-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-blue-500"
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <Cloud className="w-4 h-4 text-blue-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Word Cloud</span>
        </div>
        <div className="flex items-center gap-2">
          {isCollapsed && cloud.active && timeLeft !== null && (
            <div className={`flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-100 rounded-lg text-xs font-mono font-black ${timeLeft > 10 ? 'text-slate-700' : 'text-red-500 animate-pulse'}`}>
              <Timer className="w-3.5 h-3.5" />
              <span>Time Left: </span>
              {Math.floor(timeLeft / 60)}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          )}
          {canModerate && (
            <>
              <button 
                onClick={() => onToggleResults(cloud.id, !!cloud.showResults)}
                className={cn(
                  "p-1 rounded transition-colors",
                  cloud.showResults 
                    ? "text-green-600 hover:text-green-700" 
                    : "text-red-500 hover:text-red-600"
                )}
                title={cloud.showResults ? "Hide Results from Audience" : "Show Results to Audience"}
              >
                {cloud.showResults ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              {cloud.active ? (
                <button onClick={() => onClose(cloud.id)} className="p-1 text-slate-400 hover:text-red-500" title="Close Word Cloud">
                  <XCircle className="w-4 h-4" />
                </button>
              ) : isDraft ? (
                <span className="text-[8px] font-bold text-blue-500 uppercase">Draft</span>
              ) : (
                <span className="text-[8px] font-bold text-red-500 uppercase">Closed</span>
              )}
              {isDraft && (
                <button onClick={() => onDelete(cloud.id)} className="p-1 text-slate-400 hover:text-red-500" title="Delete Word Cloud">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="mb-4">
            <h4 className="font-bold text-slate-800 text-lg">{cloud.prompt}</h4>
          </div>

          {cloud.active && timeLeft !== null && (
            <div className="mb-4 flex items-center justify-center gap-2.5 py-3 px-4 bg-blue-50 border border-blue-200/40 rounded-2xl shadow-sm animate-pulse">
              <Timer className={`w-6 h-6 ${timeLeft > 10 ? 'text-blue-500' : 'text-red-500 animate-spin'}`} />
              <span className="text-xs uppercase font-black tracking-widest text-slate-500">Time Remaining:</span>
              <span className={`text-2xl font-black font-mono tracking-wider ${timeLeft > 10 ? 'text-slate-800' : 'text-red-600'}`}>
                {Math.floor(timeLeft / 60)}:{Math.floor(timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}

          {isDraft && canModerate ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Set Duration</span>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => onAdjustDuration(cloud.id, Math.max(15, (cloud.duration || 60) - 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    -
                  </button>
                  <span className="text-2xl font-black text-slate-800 font-mono w-20 text-center">
                    {Math.floor((cloud.duration || 60) / 60)}:{((cloud.duration || 60) % 60).toString().padStart(2, '0')}
                  </span>
                  <button 
                    onClick={() => onAdjustDuration(cloud.id, Math.min(120, (cloud.duration || 60) + 15))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full text-slate-600 transition-colors"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-2 mt-1">
                  <button 
                    onClick={() => onAdjustDuration(cloud.id, 60)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    1:00
                  </button>
                  <button 
                    onClick={() => onAdjustDuration(cloud.id, 120)}
                    className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors border border-slate-200"
                  >
                    2:00
                  </button>
                </div>
              </div>
              <button 
                onClick={() => onStart(cloud.id, cloud.duration || 60)}
                className="w-full py-3 bg-blue-500 text-white font-black uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
              >
                Start Word Cloud Now
              </button>
            </div>
          ) : (
            <>
              {cloud.active && !hasParticipated && isChatOnly && (
                <form onSubmit={handleSubmit} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={word}
                    onChange={e => setWord(e.target.value)}
                    placeholder="Enter a word or short phrase..."
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:border-blue-500"
                    maxLength={30}
                  />
                  <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md text-sm font-bold hover:bg-blue-600">
                    Submit
                  </button>
                </form>
              )}

              {hasParticipated && cloud.active && isChatOnly && (
                <div className="text-xs text-slate-500 italic mb-2">You have submitted your response.</div>
              )}

              {cloud.showResults && (
                <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100 min-h-[150px] flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                  {Object.keys(cloud.words || {}).length === 0 ? (
                    <span className="text-sm text-slate-400">No words submitted yet.</span>
                  ) : (
                    Object.entries(cloud.words || {}).map(([w, count]) => (
                      <span 
                        key={w} 
                        style={{ 
                          fontSize: `${getFontSize(count)}px`,
                          color: getWordColor(w),
                          opacity: 0.8 + (count / maxCount) * 0.2
                        }} 
                        className="font-bold leading-none text-center transition-all duration-500"
                      >
                        {w}
                      </span>
                    ))
                  )}
                </div>
              )}
            </>
          )}
          
          {!isDraft && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <span style={{ color: secondaryColor }} className="text-sm font-black transition-colors duration-300">{totalWords}</span> Total Submissions
              </span>
              {!cloud.active && <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">Final Results</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const formatFileSize = (bytes?: number) => {
  if (bytes === undefined || bytes === null) return '';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

interface MessageCardProps {
  msg: Message;
  user: any;
  canModerate: boolean;
  onLike: (msg: Message) => void;
  onDelete: (msgId: string) => void;
  onTogglePin?: (msg: Message) => void;
  initialCollapsed?: boolean;
  isInitiallyNew?: boolean;
  isPresenter?: boolean;
  onFocus?: (msg: Message) => void;
  forceCollapsed?: boolean;
}

const MessageCard: React.FC<MessageCardProps> = ({ 
  msg, 
  user, 
  canModerate, 
  onLike, 
  onDelete, 
  onTogglePin, 
  initialCollapsed = false, 
  isInitiallyNew = false,
  isPresenter = false,
  onFocus,
  forceCollapsed = false
}) => {
  const [isCollapsed, setIsCollapsed] = useState(isInitiallyNew ? false : initialCollapsed);
  const prevInitialCollapsedRef = useRef(initialCollapsed);

  useEffect(() => {
    if (prevInitialCollapsedRef.current !== initialCollapsed) {
      setIsCollapsed(initialCollapsed);
      prevInitialCollapsedRef.current = initialCollapsed;
    }
  }, [initialCollapsed]);

  useEffect(() => {
    if (forceCollapsed) {
      setIsCollapsed(true);
    }
  }, [forceCollapsed]);

  // Determine if this is a "new" message (within last 10 seconds) to trigger pulsation
  const isPulsingNew = !msg.timestamp || (Date.now() - msg.timestamp.toMillis() < 10000);

  const handleCardClick = () => {
    if (canModerate) {
      onFocus?.(msg);
    }
  };

  return (
    <motion.div 
      initial={isPulsingNew ? { scale: 1, borderColor: isPresenter ? "rgb(199, 210, 254)" : "rgb(254, 215, 170)" } : false}
      animate={isPulsingNew ? { 
        scale: [1, 1.04, 1, 1.04, 1],
        borderColor: isPresenter 
          ? [
              "rgb(199, 210, 254)", 
              "rgb(79, 70, 229)", 
              "rgb(199, 210, 254)", 
              "rgb(79, 70, 229)", 
              "rgb(199, 210, 254)"
            ]
          : [
              "rgb(254, 215, 170)", 
              "rgb(255, 62, 0)", 
              "rgb(254, 215, 170)", 
              "rgb(255, 62, 0)", 
              "rgb(254, 215, 170)"
            ],
        boxShadow: isPresenter
          ? [
              "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              "0 0 15px rgba(79, 70, 229, 0.4)",
              "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              "0 0 15px rgba(79, 70, 229, 0.4)",
              "0 4px 6px -1px rgb(0 0 0 / 0.1)"
            ]
          : [
              "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              "0 0 15px rgba(255, 62, 0, 0.4)",
              "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              "0 0 15px rgba(255, 62, 0, 0.4)",
              "0 4px 6px -1px rgb(0 0 0 / 0.1)"
            ]
      } : false}
      transition={{ duration: 2, ease: "easeInOut" }}
      onClick={handleCardClick}
      title={canModerate ? "Click to spotlight / enlarge" : undefined}
      className={cn(
        "transition-all relative duration-300",
        canModerate && "cursor-pointer select-none",
        isPresenter
          ? "p-3 rounded-xl border-2 border-indigo-500 bg-indigo-50 shadow-md hover:border-indigo-600 hover:shadow-lg"
          : "p-3 rounded-xl border border-orange-200 bg-orange-50 shadow-md hover:border-orange-400 hover:shadow-lg",
        isCollapsed && "py-2"
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button 
            onClick={(e) => { e.stopPropagation(); setIsCollapsed(!isCollapsed); }}
            className={cn(
              "p-1 -ml-1 rounded transition-colors text-slate-400 focus:outline-none",
              isPresenter 
                ? "hover:bg-indigo-100 hover:text-indigo-600" 
                : "hover:bg-orange-100 hover:text-osu-orange"
            )}
          >
            {isCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
          <div className="flex flex-col min-w-0 flex-1">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 flex-wrap transition-all duration-300",
              isPresenter ? "text-indigo-700" : "text-slate-500"
            )}>
              <span className="truncate max-w-[120px]">{msg.userName}</span>
              {isPresenter && (
                <span className="inline-flex items-center gap-0.5 bg-indigo-600 text-white font-black rounded-full uppercase tracking-wider shrink-0 text-[8px] px-1.5 py-0.5">
                  Presenter
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={(e) => { e.stopPropagation(); onLike(msg); }}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors border focus:outline-none",
              (msg.likes || 0) > 0 
                ? "bg-yellow-400 text-slate-900 border-yellow-500 shadow-sm" 
                : "bg-white/60 text-slate-500 border-transparent hover:bg-white hover:text-slate-700"
            )}
            title={msg.likedBy?.includes(user?.uid || '') ? "Unlike" : "Like"}
          >
            <ThumbsUp className={cn("w-3 h-3", msg.likedBy?.includes(user?.uid || '') && "fill-current")} />
            {msg.likes || 0}
          </button>
          {canModerate && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin?.(msg); }}
              className={cn(
                "p-1 rounded-md transition-colors flex-shrink-0 focus:outline-none hover:bg-black/5",
                msg.isPinned 
                  ? "text-amber-500 hover:text-amber-600" 
                  : "text-slate-350 hover:text-slate-500"
              )}
              title={msg.isPinned ? "Unpin Message" : "Pin Message"}
            >
              <Pin className={cn("w-3.5 h-3.5", msg.isPinned && "fill-current")} />
            </button>
          )}
          {(user?.uid === msg.userId || canModerate) && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(msg.id); }}
              className="p-1 rounded-md text-slate-350 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 focus:outline-none"
              title="Delete Message"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {!isCollapsed && (
        <>
          <div className="text-slate-800 leading-relaxed transition-all duration-300 text-sm">
            {msg.text && (
              <span className="font-bold">
                {renderTextWithLinks(msg.text)}
              </span>
            )}
            {msg.fileUrl && (
              <div className="mt-2.5 p-3 bg-white/95 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all group/doc">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg group-hover/doc:bg-indigo-100 group-hover/doc:text-indigo-700 transition-colors flex items-center justify-center shrink-0">
                    <Download className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex flex-col items-start">
                    <span className="font-bold text-slate-800 truncate block w-full text-xs max-w-[130px]" title={msg.fileName}>
                      {msg.fileName || "Shared Document"}
                    </span>
                    {msg.fileSize !== undefined && msg.fileSize !== null && (
                      <span className="text-[9px] text-slate-500 font-semibold mt-0.5 block">
                        {formatFileSize(msg.fileSize)}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={msg.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={msg.fileName || "download"}
                  className="shrink-0 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-white rounded-lg transition-all shadow-sm flex items-center justify-center gap-1 text-[10px] font-extrabold uppercase tracking-wide select-none"
                  title="Download Document"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-3 h-3" />
                  <span>Get</span>
                </a>
              </div>
            )}
            {(msg.slide !== undefined && msg.slide !== null) && (
              <span className={cn(
                "inline-flex items-center ml-1.5 px-2.5 py-1 rounded-full text-[11px] font-normal text-white border-2 border-white uppercase tracking-wider transition-all duration-300",
                isPresenter 
                  ? "bg-indigo-600 shadow-[0_2px_4px_rgba(79,70,229,0.3)]"
                  : "bg-[#ff3e00] shadow-[0_2px_4px_rgba(255,62,0,0.3)]"
              )}>
                Slide {msg.slide}
              </span>
            )}
            {/* Diagnostic for missing slide */}
            {(msg.slide === undefined || msg.slide === null) && (
              <span className="text-[8px] text-slate-400 ml-1 italic">
                (No slide data)
              </span>
            )}
          </div>
          <div className="mt-2 text-slate-450 text-[9px] text-right">
            {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </>
      )}
    </motion.div>
  );
};

interface ChatSidebarProps {
  isChatOnly?: boolean;
  presentation?: Presentation | null;
  logoUrl?: string;
  presentationLoaded?: boolean;
  showAttendance?: boolean;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isChatOnly = false, presentation = null, logoUrl, presentationLoaded = true, showAttendance = false }) => {
  const [internalLogoUrl, setInternalLogoUrl] = useState<string | undefined | null>(null);
  const [secondaryColor, setSecondaryColor] = useState<string>('#ff3e00');

  useEffect(() => {
    if (logoUrl !== undefined) {
      setInternalLogoUrl(logoUrl);
    } else {
      const unsub = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as GlobalSettings;
          setInternalLogoUrl(data.theme.logoUrl);
          if (data.theme.secondaryColor) {
            setSecondaryColor(data.theme.secondaryColor);
          }
        } else {
          setInternalLogoUrl(undefined);
        }
      });

      return () => unsub();
    }
  }, [logoUrl]);

  const { user } = useAuth();
  const { currentSlide } = useBridge();
  const canModerate = !isChatOnly; // Only the person in the main view (presenter) can moderate
  const canModerateChat = !isChatOnly; // Only the person in the main view can moderate chat

  console.log('ChatSidebar Render - User:', user?.email || 'Guest');
  const [messages, setMessages] = useState<Message[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [wordClouds, setWordClouds] = useState<WordCloud[]>([]);
  const [openEndedQuestions, setOpenEndedQuestions] = useState<OpenEndedQuestion[]>([]);
  const [inputText, setInputText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isAllCollapsed, setIsAllCollapsed] = useState(false);
  const [isQRExpanded, setIsQRExpanded] = useState(false);
  const [showWordCloudModal, setShowWordCloudModal] = useState(false);
  const [showOpenEndedQuestionModal, setShowOpenEndedQuestionModal] = useState(false);
  const [wordCloudPrompt, setWordCloudPrompt] = useState('');
  const [openEndedQuestionPrompt, setOpenEndedQuestionPrompt] = useState('');
  const [pollDuration, setPollDuration] = useState(60); // Default 60 seconds
  const [participantCount, setParticipantCount] = useState(0);
  const [focusedMessage, setFocusedMessage] = useState<Message | null>(null);
  const [collapsedMessageIds, setCollapsedMessageIds] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPosition((prev) => ({
        x: prev.x + e.clientX - dragStart.x,
        y: prev.y + e.clientY - dragStart.y,
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      setDragPosition((prev) => ({
        x: prev.x + touch.clientX - dragStart.x,
        y: prev.y + touch.clientY - dragStart.y,
      }));
      setDragStart({ x: touch.clientX, y: touch.clientY });
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, dragStart]);

  // Reset drag position back to centered when focused message changes
  useEffect(() => {
    if (focusedMessage === null) {
      setDragPosition({ x: 0, y: 0 });
    }
  }, [focusedMessage]);

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    e.preventDefault(); // Prevent text highlighting while dragging
  };

  const handleDragTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 0) return;
    setIsDragging(true);
    setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  const hasActiveInteractive = 
    openEndedQuestions.some(q => q.active) || 
    polls.some(p => p.active) || 
    wordClouds.some(w => w.active);

  const pinnedMessages = messages.filter(m => m.isPinned);

  // ... (some code)

  const handleCreateOpenEndedQuestion = async (customPrompt?: string) => {
    const promptToUse = customPrompt || openEndedQuestionPrompt.trim();
    if (!presentation?.id || !canModerate || !promptToUse) return;
    try {
      await addDoc(collection(db, 'openEndedQuestions'), {
        presentationId: presentation.id,
        prompt: promptToUse,
        responses: {},
        showResults: false,
        active: false,
        createdAt: serverTimestamp(),
        slide: currentSlide !== null ? currentSlide : (presentation.currentSlide || 0)
      });
      setShowOpenEndedQuestionModal(false);
      setOpenEndedQuestionPrompt('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'openEndedQuestions');
    }
  };

  const [hasJoined, setHasJoined] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlPresId = urlParams.get('id');
    const savedPresId = localStorage.getItem('activeDeckJoinedPresentationId');
    const savedJoined = localStorage.getItem('activeDeckJoined') === 'true';
    if (urlPresId && savedPresId !== urlPresId) {
      localStorage.removeItem('activeDeckJoined');
      localStorage.removeItem('activeDeckGuestEmail');
      localStorage.removeItem('activeDeckGuestName');
      localStorage.removeItem('activeDeckJoinedPresentationId');
      return false;
    }
    return savedJoined;
  });
  const [guestEmail, setGuestEmail] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlPresId = urlParams.get('id');
    const savedPresId = localStorage.getItem('activeDeckJoinedPresentationId');
    if (urlPresId && savedPresId !== urlPresId) return '';
    return localStorage.getItem('activeDeckGuestEmail') || '';
  });
  const [guestName, setGuestName] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlPresId = urlParams.get('id');
    const savedPresId = localStorage.getItem('activeDeckJoinedPresentationId');
    if (urlPresId && savedPresId !== urlPresId) return '';
    return localStorage.getItem('activeDeckGuestName') || '';
  });
  const [joinEmailInput, setJoinEmailInput] = useState('');
  const [joinNameInput, setJoinNameInput] = useState('');
  const [isPostingAnonymously, setIsPostingAnonymously] = useState(false);
  const [shortUrl, setShortUrl] = useState('');

  // Presenter states for token rotation
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [loadingToken, setLoadingToken] = useState(true);
  const lastTokenGenerationTimeRef = useRef<number>(Date.now());


  // Student states for token validation & check-in
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  const [isValidatingToken, setIsValidatingToken] = useState(false);
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);
  const [tokenTimeLeft, setTokenTimeLeft] = useState<number | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<'none' | 'success' | 'expired' | 'error'>('none');
  const [verifiedTokenData, setVerifiedTokenData] = useState<any>(null);
  const [showAttendanceBanner, setShowAttendanceBanner] = useState(true);
  const [iconTimeLeft, setIconTimeLeft] = useState<number | null>(null);

  // States for guest manual attendance check-in
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconGrid, setIconGrid] = useState<string[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [ipAddress, setIpAddress] = useState('127.0.0.1');

  // Fetch client-side IP address on mount for manual check-ins
  useEffect(() => {
    if (!isChatOnly) return;
    const fetchIp = async () => {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
          const data = await res.json();
          if (data.ip) {
            setIpAddress(data.ip);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch client-side IP in ChatSidebar, using default fallback.', err);
      }
    };
    fetchIp();
  }, [isChatOnly]);

  // Student manual check-in heartbeat removed to allow unconditional 10s rotation

  // Ref for tracking tokens to clean up
  const generatedTokensRef = useRef<LocalTokenTracker[]>([]);

      // Sync bridge slide to Firestore (Only if in main view)
      useEffect(() => {
        if (!isChatOnly && presentation?.id && currentSlide !== null) {
          console.log('ChatSidebar: Syncing bridge slide to Firestore:', currentSlide);
          updateDoc(doc(db, 'presentations', presentation.id), {
            currentSlide: currentSlide
          }).catch(err => console.error('Failed to sync slide to Firestore:', err));
        }
      }, [currentSlide, presentation?.id, isChatOnly]);

  // Presenter Token Generation & Rotation Logic
  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const cleanExpiredTokens = async (currentTime: number) => {
    if (!presentation?.id) return;
    const tokensToClean = generatedTokensRef.current.filter(t => currentTime - t.createdAt >= 50000);
    
    for (const token of tokensToClean) {
      try {
        const expiredTokenRef = doc(db, 'presentations', presentation.id, 'attendance_tokens', token.id);
        await deleteDoc(expiredTokenRef);
        generatedTokensRef.current = generatedTokensRef.current.filter(t => t.id !== token.id);
      } catch (err) {
        console.error(`Failed to clean up expired token ${token.id}:`, err);
      }
    }
  };





  // Student Token Reset Effect when urlToken changes
  useEffect(() => {
    if (isChatOnly && urlToken) {
      setAttendanceStatus('none');
      setShowAttendanceBanner(true);
      setIsTokenValid(null);
      setTokenTimeLeft(null);
      setVerifiedTokenData(null);
    }
  }, [urlToken, isChatOnly]);

  // Student Token Validation Effect
  useEffect(() => {
    if (!isChatOnly || !urlToken || !presentation?.id || !showAttendance) return;

    const validateUrlToken = async () => {
      setIsValidatingToken(true);
      try {
        const tokenRef = doc(db, 'presentations', presentation.id, 'attendance_tokens', urlToken);
        const tokenSnap = await getDoc(tokenRef);

        if (!tokenSnap.exists()) {
          setIsTokenValid(false);
          setAttendanceStatus('expired');
          setIsValidatingToken(false);
          return;
        }

        const data = tokenSnap.data();
        const createdAt = data.createdAt as Timestamp;

        if (!createdAt) {
          setIsTokenValid(true);
          setVerifiedTokenData({ createdAt: Timestamp.now() });
          setTokenTimeLeft(45);
          setIsValidatingToken(false);
          return;
        }

        const tokenTime = createdAt.toMillis();
        const elapsed = (Date.now() - tokenTime) / 1000;

        if (elapsed >= 45) {
          setIsTokenValid(false);
          setAttendanceStatus('expired');
        } else {
          setIsTokenValid(true);
          setVerifiedTokenData(data);
          setTokenTimeLeft(Math.max(0, Math.ceil(45 - elapsed)));
        }
      } catch (err) {
        console.error('Error validating token in ChatSidebar:', err);
        setIsTokenValid(false);
      } finally {
        setIsValidatingToken(false);
      }
    };

    validateUrlToken();
  }, [isChatOnly, urlToken, presentation?.id]);

  // Student countdown timer for valid token
  useEffect(() => {
    if (!isTokenValid || tokenTimeLeft === null || !verifiedTokenData || attendanceStatus === 'success') return;

    const interval = setInterval(() => {
      const createdAt = verifiedTokenData.createdAt as Timestamp;
      if (!createdAt) return;

      const tokenTime = createdAt.toMillis();
      const elapsed = (Date.now() - tokenTime) / 1000;
      const remaining = Math.max(0, Math.ceil(45 - elapsed));

      setTokenTimeLeft(remaining);

      if (remaining <= 0) {
        setIsTokenValid(false);
        setAttendanceStatus(prev => prev === 'success' ? 'success' : 'expired');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isTokenValid, tokenTimeLeft, verifiedTokenData, attendanceStatus]);

  // Student background auto-check-in when already joined
  useEffect(() => {
    if (isChatOnly && hasJoined && isTokenValid && attendanceStatus === 'none' && guestEmail && presentation?.id) {
      const autoCheckIn = async () => {
        try {
          let activeInstitutionId = 'custom';
          let activeInstitutionName = 'Custom / Active Theme';
          let activeInstitutionDomain = '';
          try {
            const globalSnap = await getDoc(doc(db, 'settings', 'global'));
            if (globalSnap.exists()) {
              const gd = globalSnap.data();
              if (gd.activeInstitutionId) activeInstitutionId = gd.activeInstitutionId;
              if (gd.activeInstitutionName) activeInstitutionName = gd.activeInstitutionName;
              if (gd.activeInstitutionDomain) activeInstitutionDomain = gd.activeInstitutionDomain;
            }
          } catch (err) {
            console.error(err);
          }

          const studentEmail = guestEmail.trim().toLowerCase();

          // Strict domain restriction check
          if (activeInstitutionDomain && activeInstitutionDomain.trim() !== '') {
            const requiredDomain = activeInstitutionDomain.trim().toLowerCase();
            if (!studentEmail.endsWith(`@${requiredDomain}`) && !studentEmail.endsWith(`.${requiredDomain}`)) {
              console.warn(`Blocking background auto-check-in: email ${studentEmail} does not match required domain ${requiredDomain}`);
              setAttendanceStatus('error');
              // Clear invalid session guest info so they are forced to re-join with a proper email
              setHasJoined(false);
              setGuestEmail('');
              setGuestName('');
              localStorage.removeItem('activeDeckJoined');
              localStorage.removeItem('activeDeckGuestEmail');
              localStorage.removeItem('activeDeckGuestName');
              localStorage.removeItem('activeDeckJoinedPresentationId');
              alert(`Access Denied: This session is restricted to verified email addresses ending with @${requiredDomain}.`);
              return;
            }
          }

          const attendanceRef = doc(db, 'presentations', presentation.id, 'attendance', studentEmail);
          await setDoc(attendanceRef, {
            name: guestName.trim(),
            email: studentEmail,
            checkedInAt: serverTimestamp(),
            scannedToken: urlToken,
            institutionId: activeInstitutionId,
            institutionName: activeInstitutionName
          });

          setAttendanceStatus('success');
          setShowAttendanceBanner(true);
        } catch (err) {
          console.error('Auto check-in error:', err);
          setAttendanceStatus('error');
        }
      };

      autoCheckIn();
    }
  }, [isChatOnly, hasJoined, isTokenValid, attendanceStatus, guestEmail, guestName, presentation?.id, urlToken]);

  // Check if session ID changed or ended, and log out if it does not match or if the presentation is null
  useEffect(() => {
    if (isChatOnly && presentationLoaded) {
      const savedPresId = localStorage.getItem('activeDeckJoinedPresentationId');
      const savedJoined = localStorage.getItem('activeDeckJoined') === 'true';
      if (presentation === null || (presentation && savedPresId !== presentation.id)) {
        if (savedJoined) {
          setHasJoined(false);
          setGuestEmail('');
          setGuestName('');
          setJoinEmailInput('');
          setJoinNameInput('');
          localStorage.removeItem('activeDeckJoined');
          localStorage.removeItem('activeDeckGuestEmail');
          localStorage.removeItem('activeDeckGuestName');
          localStorage.removeItem('activeDeckJoinedPresentationId');
        }
      }
    }
  }, [presentation, presentationLoaded, isChatOnly]);

  // Construct chat-only URL for QR code
  const baseUrl = window.location.origin + window.location.pathname;
  const chatOnlyUrl = presentation?.id ? `${baseUrl}?view=chat&id=${presentation.id}` : `${baseUrl}?view=chat`;
  const dynamicChatUrl = presentation?.id && activeToken && !presentation?.disableAttendance && showAttendance
    ? `${window.location.origin}${window.location.pathname}?view=chat&id=${presentation.id}&token=${activeToken}`
    : chatOnlyUrl;

  useEffect(() => {
    if (!chatOnlyUrl) return;
    
    const fetchShortUrl = async () => {
      try {
        const response = await fetch(`/api/shorten?url=${encodeURIComponent(chatOnlyUrl)}`);
        if (response.ok) {
          const text = await response.text();
          setShortUrl(text);
        }
      } catch (error) {
        console.error("Failed to generate short URL:", error);
      }
    };
    
    fetchShortUrl();
  }, [chatOnlyUrl]);

  useEffect(() => {
    if (!presentation?.id) return;

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        // Silently fail connection test
      }
    };
    testConnection();

    const q = query(
      collection(db, 'messages'), 
      where('presentationId', '==', presentation.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' })
      })) as Message[];
      
      // Sort client-side to avoid requiring a composite index
      msgs.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || 0;
        return timeA - timeB;
      });
      
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'messages');
    });

    // Listen to polls
    const pq = query(
      collection(db, 'polls'), 
      where('presentationId', '==', presentation.id)
    );
    const pUnsubscribe = onSnapshot(pq, (snapshot) => {
      const ps = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' })
      })) as Poll[];
      ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      setPolls(ps);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'polls');
    });

    // Listen to word clouds
    const wcq = query(
      collection(db, 'wordClouds'), 
      where('presentationId', '==', presentation.id)
    );
    const wcUnsubscribe = onSnapshot(wcq, (snapshot) => {
      const wcs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' })
      })) as WordCloud[];
      wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      setWordClouds(wcs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'wordClouds');
    });

    // Listen to open-ended questions
    const oeqq = query(
      collection(db, 'openEndedQuestions'), 
      where('presentationId', '==', presentation.id)
    );
    const oeqUnsubscribe = onSnapshot(oeqq, (snapshot) => {
      const oeqs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' })
      })) as OpenEndedQuestion[];
      oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      setOpenEndedQuestions(oeqs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'openEndedQuestions');
    });

    // Listen to participant count
    const pq_count = query(
      collection(db, 'participants'),
      where('presentationId', '==', presentation.id)
    );
    const pCountUnsubscribe = onSnapshot(pq_count, (snapshot) => {
      setParticipantCount(snapshot.size);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'participants');
    });

    return () => {
      unsubscribe();
      pUnsubscribe();
      wcUnsubscribe();
      oeqUnsubscribe();
      pCountUnsubscribe();
    };
  }, [presentation?.id]);

  // Update hasActivity to true if there is activity (messages, interactive elements, or participants)
  useEffect(() => {
    if (!canModerate || !presentation?.id || presentation.hasActivity) return;

    if (messages.length > 0 || polls.length > 0 || wordClouds.length > 0 || openEndedQuestions.length > 0 || participantCount > 0) {
      const presRef = doc(db, 'presentations', presentation.id);
      updateDoc(presRef, { hasActivity: true }).catch(err => {
        console.error('Failed to mark presentation active:', err);
      });
    }
  }, [canModerate, presentation?.id, presentation?.hasActivity, messages.length, polls.length, wordClouds.length, openEndedQuestions.length, participantCount]);

  // Register participant when joined
  // Register participant when joined (students only, not the presenter)
  useEffect(() => {
    if (hasJoined && user && presentation?.id && !canModerate) {
      const registerParticipant = async () => {
        try {
          const participantId = `${presentation.id}_${user.uid}`;
          await setDoc(doc(db, 'participants', participantId), {
            presentationId: presentation.id,
            userId: user.uid,
            joinedAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Failed to register participant:", error);
        }
      };
      registerParticipant();
    }
  }, [hasJoined, user, presentation?.id, canModerate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    try {
      const emailToSave = user.isAnonymous ? guestEmail : user.email;
      let userName = user.isAnonymous 
        ? (guestName || (guestEmail ? guestEmail.split('@')[0] : `Guest ${user.uid.slice(0, 4)}`)) 
        : user.displayName || 'User';

      if (!isChatOnly) {
        const presenterEmail = sessionStorage.getItem('activePresenterEmail');
        userName = presenterEmail ? presenterEmail.split('@')[0] : (user.displayName || 'Host');
      } else if (isPostingAnonymously) {
        userName = `Anonymous ${user.uid.slice(0, 4)}`;
      }

      const messageData: any = {
        text: inputText,
        userId: user.uid,
        userName: userName,
        timestamp: serverTimestamp(),
        isQuestion: true,
        presentationId: presentation?.id || 'default',
        presenterId: presentation?.presenterId || 'default',
      };

      console.log('ChatSidebar: Preparing to send message. Bridge currentSlide:', currentSlide, 'Presentation currentSlide:', presentation?.currentSlide);

      // Use bridge slide (presenter) or presentation slide (audience)
      const slideToSend = currentSlide !== null ? currentSlide : presentation?.currentSlide;
      
      if (slideToSend !== undefined && slideToSend !== null) {
        messageData.slide = slideToSend;
      }

      if (emailToSave) {
        messageData.userEmail = emailToSave;
      }

      await addDoc(collection(db, 'messages'), messageData);
      setInputText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'messages');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // 50MB file size limit
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert("File is too large. Maximum size is 50MB.");
      return;
    }

    try {
      setIsUploadingFile(true);

      const presentationId = presentation?.id || 'default';
      const fileId = generateUUID();
      const storagePath = `presentations/${presentationId}/documents/${fileId}_${file.name}`;
      const storageRef = ref(storage, storagePath);

      // Upload file to Firebase Storage
      await uploadBytes(storageRef, file);

      // Get public download URL
      const downloadUrl = await getDownloadURL(storageRef);

      const emailToSave = user.isAnonymous ? guestEmail : user.email;
      let userName = user.isAnonymous 
        ? (guestName || (guestEmail ? guestEmail.split('@')[0] : `Guest ${user.uid.slice(0, 4)}`)) 
        : (user.displayName || user.email?.split('@')[0] || 'Presenter');

      if (!isChatOnly) {
        const presenterEmail = sessionStorage.getItem('activePresenterEmail');
        userName = presenterEmail ? presenterEmail.split('@')[0] : (user.displayName || 'Host');
      }


      // Create special document share message in Firestore messages collection
      const messageData: any = {
        text: `Shared a document: ${file.name}`,
        userId: user.uid,
        userName: userName,
        timestamp: serverTimestamp(),
        isQuestion: false,
        presentationId: presentationId,
        presenterId: presentation?.presenterId || 'default',
        fileUrl: downloadUrl,
        fileName: file.name,
        fileSize: file.size,
      };

      const slideToSend = currentSlide !== null ? currentSlide : presentation?.currentSlide;
      if (slideToSend !== undefined && slideToSend !== null) {
        messageData.slide = slideToSend;
      }

      if (emailToSave) {
        messageData.userEmail = emailToSave;
      }

      await addDoc(collection(db, 'messages'), messageData);

      // Reset file input element
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error("Error uploading document:", error);
      alert("Failed to upload document. Please try again.");
    } finally {
      setIsUploadingFile(false);
    }
  };

  const generateNewToken = async () => {
    if (!presentation?.id) return;

    try {
      const newTokenId = generateUUID();
      const now = Date.now();
      lastTokenGenerationTimeRef.current = now;

      // Select a new random medical icon, avoiding the current one to ensure a visible change
      const prevIcon = presentation?.currentIcon || null;
      const availableIcons = prevIcon 
        ? MEDICAL_ICONS.filter(icon => icon !== prevIcon) 
        : MEDICAL_ICONS;
      const newIcon = availableIcons[Math.floor(Math.random() * availableIcons.length)];

      // Save token directly to the presentation document along with rotating icon details (merge true to not touch screen codes)
      const presRef = doc(db, 'presentations', presentation.id);
      await setDoc(presRef, {
        attendanceToken: newTokenId,
        currentIcon: newIcon,
        previousIcon: prevIcon || null,
        iconRotatedAt: now
      }, { merge: true });

      const tokenRef = doc(db, 'presentations', presentation.id, 'attendance_tokens', newTokenId);
      await setDoc(tokenRef, {
        createdAt: serverTimestamp()
      });

      setActiveToken(newTokenId);
      setLoadingToken(false);

      generatedTokensRef.current.push({ id: newTokenId, createdAt: now });
      cleanExpiredTokens(now);
    } catch (err) {
      console.error('Error generating attendance token in ChatSidebar:', err);
      setLoadingToken(false);
    }
  };

  // Regenerate student manual-join 20-icon grid unconditionally on currentIcon change to ensure immediate re-shuffle
  useEffect(() => {
    const currentVal = presentation?.currentIcon;
    const prevVal = presentation?.previousIcon;

    if (currentVal) {
      const grid = generateIconGrid(currentVal, prevVal);
      setIconGrid(grid);
    }
  }, [presentation?.currentIcon, presentation?.previousIcon]);

  // Reset student selected icon if it becomes completely invalid on icon rotation
  useEffect(() => {
    const currentVal = presentation?.currentIcon;
    const prevVal = presentation?.previousIcon;

    if (currentVal && selectedIcon) {
      if (selectedIcon !== currentVal && selectedIcon !== prevVal) {
        setSelectedIcon(null);
      }
    }
  }, [presentation?.currentIcon, presentation?.previousIcon, selectedIcon]);

  // Student-side live countdown timer for manual icon rotation (rotates every 10s in perfect sync with QR)
  useEffect(() => {
    if (!isChatOnly || presentation?.disableAttendance || urlToken) return;

    const currentIcon = presentation?.currentIcon;
    if (!currentIcon) {
      setIconTimeLeft(10);
      return;
    }

    const rotatedAt = presentation?.iconRotatedAt;
    let initialRemaining = 10;
    
    if (rotatedAt) {
      const elapsed = (Date.now() - rotatedAt) / 1000;
      if (elapsed >= 0 && elapsed <= 10) {
        initialRemaining = 10 - elapsed;
      }
    }
    
    setIconTimeLeft(Math.max(0.1, initialRemaining));
    const startTime = Date.now() - (10 - initialRemaining) * 1000;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, 10 - elapsed);
      setIconTimeLeft(remaining);
    }, 40);

    return () => clearInterval(interval);
  }, [isChatOnly, presentation?.currentIcon, presentation?.iconRotatedAt, presentation?.disableAttendance, urlToken]);

  // Presenter Token Rotation and countdown effect (every 10s unified loop)
  useEffect(() => {
    if (isChatOnly || !presentation?.id || !showAttendance || presentation?.disableAttendance) {
      setActiveToken(null);
      return;
    }

    generateNewToken();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTokenGenerationTimeRef.current) / 1000;

      if (elapsed >= 10) {
        generateNewToken();
        setTimeLeft(10);
      } else {
        setTimeLeft(Number((10 - elapsed).toFixed(1)));
      }
    }, 100);

    return () => {
      clearInterval(interval);
      const now = Date.now();
      cleanExpiredTokens(now + 100000);
    };
  }, [presentation?.id, isChatOnly, presentation?.disableAttendance]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    
    const emailToSave = joinEmailInput.trim().toLowerCase();
    const nameToSave = joinNameInput.trim();

    setIsValidatingToken(true);

    // Fetch active institution details from settings/global first
    let activeInstitutionId = 'custom';
    let activeInstitutionName = 'Custom / Active Theme';
    let activeInstitutionDomain = '';
    try {
      const globalSnap = await getDoc(doc(db, 'settings', 'global'));
      if (globalSnap.exists()) {
        const globalData = globalSnap.data();
        if (globalData.activeInstitutionId) {
          activeInstitutionId = globalData.activeInstitutionId;
        }
        if (globalData.activeInstitutionName) {
          activeInstitutionName = globalData.activeInstitutionName;
        }
        if (globalData.activeInstitutionDomain) {
          activeInstitutionDomain = globalData.activeInstitutionDomain;
        }
      }
    } catch (err) {
      console.error('Error fetching global settings for institution info:', err);
    }

    // Strict domain restriction check right at entry
    if (activeInstitutionDomain && activeInstitutionDomain.trim() !== '') {
      const requiredDomain = activeInstitutionDomain.trim().toLowerCase();
      if (!emailToSave.endsWith(`@${requiredDomain}`) && !emailToSave.endsWith(`.${requiredDomain}`)) {
        setJoinError(`Access Denied: This session is restricted to verified email addresses ending with @${requiredDomain}.`);
        setIsValidatingToken(false);
        return;
      }
    }

    // If manual attendance check is required
    const isAttendanceJoin = showAttendance && !presentation?.disableAttendance;
    if (isAttendanceJoin && !urlToken) {
      if (!presentation?.id) {
        setIsValidatingToken(false);
        return;
      }
      if (!selectedIcon) {
        setJoinError("Please select a Screen Icon.");
        setIsValidatingToken(false);
        return;
      }

      try {
        // Fetch presentation doc and validate screen icon
        const presRef = doc(db, 'presentations', presentation.id);
        const presSnap = await getDoc(presRef);
        if (!presSnap.exists()) {
          setJoinError("This presentation session is no longer active.");
          setIsValidatingToken(false);
          return;
        }
        const presData = presSnap.data();
        const currentIconVal = presData.currentIcon || '';
        const previousIconVal = presData.previousIcon || '';

        if (!selectedIcon || (selectedIcon !== currentIconVal && selectedIcon !== previousIconVal)) {
          setJoinError("Incorrect icon selected. Please look at the presenter's screen and choose the matching medical icon.");
          setIsValidatingToken(false);
          return;
        }

        // Write check-in directly to Firestore subcollection using the email as document ID
        const attendanceRef = doc(db, 'presentations', presentation.id, 'attendance', emailToSave);
        await setDoc(attendanceRef, {
          name: nameToSave,
          email: emailToSave,
          checkedInAt: serverTimestamp(),
          scannedToken: null,
          institutionId: activeInstitutionId,
          institutionName: activeInstitutionName,
          authMethod: 'URL',
          slide: presentation?.currentSlide !== undefined ? presentation.currentSlide : 0,
          ipAddress: ipAddress
        });

        // Set attendance states
        setAttendanceStatus('success');
        setShowAttendanceBanner(true);
      } catch (err: any) {
        console.error('Error recording manual attendance on join:', err);
        setJoinError("Failed to record attendance. Please try again.");
        setIsValidatingToken(false);
        return;
      } finally {
        setIsValidatingToken(false);
      }
    }

    // Now proceed with joining the chat
    setGuestEmail(emailToSave);
    setGuestName(nameToSave);
    setHasJoined(true);
    localStorage.setItem('activeDeckJoined', 'true');
    localStorage.setItem('activeDeckGuestEmail', emailToSave);
    localStorage.setItem('activeDeckGuestName', nameToSave);
    if (presentation?.id) {
      localStorage.setItem('activeDeckJoinedPresentationId', presentation.id);
    }

    // If they joined with a urlToken, validate it (this is the original QR code track)
    if (urlToken && presentation?.id && showAttendance && !presentation?.disableAttendance) {
      setIsValidatingToken(true);
      try {
        const tokenRef = doc(db, 'presentations', presentation.id, 'attendance_tokens', urlToken);
        const tokenSnap = await getDoc(tokenRef);
        
        if (!tokenSnap.exists()) {
          setAttendanceStatus('expired');
          setShowAttendanceBanner(true);
          return;
        }

        const data = tokenSnap.data();
        const createdAt = data.createdAt as Timestamp;

        const tokenTime = createdAt ? createdAt.toMillis() : Date.now();
        const elapsed = (Date.now() - tokenTime) / 1000;

        if (elapsed >= 45) {
          setAttendanceStatus('expired');
          setShowAttendanceBanner(true);
          return;
        }

        const attendanceRef = doc(db, 'presentations', presentation.id, 'attendance', emailToSave);
        await setDoc(attendanceRef, {
          name: nameToSave,
          email: emailToSave,
          checkedInAt: serverTimestamp(),
          scannedToken: urlToken,
          institutionId: activeInstitutionId,
          institutionName: activeInstitutionName,
          authMethod: 'QR',
          slide: presentation?.currentSlide !== undefined ? presentation.currentSlide : 0,
          ipAddress: ipAddress
        });

        setAttendanceStatus('success');
        setShowAttendanceBanner(true);
      } catch (err) {
        console.error('Error recording attendance on join:', err);
        setAttendanceStatus('error');
        setShowAttendanceBanner(true);
      } finally {
        setIsValidatingToken(false);
      }
    } else {
      // If we don't have QR validation to run, stop the validating spinner
      setIsValidatingToken(false);
    }
  };

  const handleLeave = () => {
    setHasJoined(false);
    setGuestEmail('');
    setGuestName('');
    setJoinEmailInput('');
    setJoinNameInput('');
    localStorage.removeItem('activeDeckJoined');
    localStorage.removeItem('activeDeckGuestEmail');
    localStorage.removeItem('activeDeckGuestName');
    localStorage.removeItem('activeDeckJoinedPresentationId');
  };

  const handleDeleteMessage = async (id: string) => {
    console.log('Attempting to delete message:', id, 'User:', user?.email, 'UID:', user?.uid);
    try {
      await deleteDoc(doc(db, 'messages', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `messages/${id}`);
    }
  };

  const handleClearChat = async () => {
    try {
      const batch = writeBatch(db);
      messages.forEach((msg) => {
        batch.delete(doc(db, 'messages', msg.id));
      });
      await batch.commit();
      setShowClearConfirm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'messages');
    }
  };

  const handleLikeMessage = async (msg: Message) => {
    if (!user) return;
    
    const messageRef = doc(db, 'messages', msg.id);
    const hasLiked = msg.likedBy?.includes(user.uid);

    try {
      if (hasLiked) {
        await updateDoc(messageRef, {
          likes: increment(-1),
          likedBy: arrayRemove(user.uid)
        });
      } else {
        await updateDoc(messageRef, {
          likes: increment(1),
          likedBy: arrayUnion(user.uid)
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${msg.id}`);
    }
  };

  const handleTogglePinMessage = async (msg: Message) => {
    if (!user || !canModerateChat) return;

    const messageRef = doc(db, 'messages', msg.id);
    const isPinned = msg.isPinned || false;

    try {
      if (isPinned) {
        // Unpinning the message. Update its timestamp to current server time
        // so it reappears as a new message at the bottom of the active chat.
        await updateDoc(messageRef, {
          isPinned: false,
          timestamp: serverTimestamp()
        });
      } else {
        // Pinning the message.
        await updateDoc(messageRef, {
          isPinned: true
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${msg.id}`);
    }
  };

  const handleDownloadWord = () => {
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
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .badge-message {
    background-color: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }
  .badge-question {
    background-color: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fca5a5;
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
    background-color: #ffffff;
  }
  .card-mcq {
    border: 1px solid #fca5a5;
    border-left: 6px solid ${themeAccentColor};
    background-color: #fff5f2;
  }
  .card-wordcloud {
    border: 1px solid #93c5fd;
    border-left: 6px solid #3b82f6;
    background-color: #eff6ff;
  }
  .card-openended {
    border: 1px solid #6ee7b7;
    border-left: 6px solid #10b981;
    background-color: #f0fdf4;
  }
  .card-title {
    font-weight: 800;
    font-size: 15px;
    margin: 0 0 4px 0;
    color: #0f172a;
    text-align: center;
  }
  .card-subtitle {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
    margin: 0 0 12px 0;
    text-align: center;
  }
  .card-meta {
    font-size: 11px;
    color: #64748b;
    margin: 0 0 16px 0;
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
    word-break: break-word;
    word-wrap: break-word;
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
  <!-- Centering Outer Layout Table with 100% width for Word compatibility -->
  <table align="center" width="100%" style="width: 100%; max-width: 720px; margin: 0 auto; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); text-align: left;">
    <tr>
      <td style="padding: 40px; border: none; vertical-align: top; background-color: #ffffff;">
        <div class="header" style="border-bottom: 3px solid ${themeAccentColor}; padding-bottom: 20px; margin-bottom: 30px; text-align: center;">
          <h1 style="font-size: 26px; margin: 0 0 8px 0; color: #0f172a; font-weight: 800; text-align: center;">ActiveDeck Session Activity Log</h1>
          <p style="font-size: 13px; color: #64748b; margin: 0; text-align: center;">Generated on ${new Date().toLocaleString()}</p>
        </div>`;

    const footer = "</td></tr></table></body></html>";
    
    const combinedItems = [
      ...messages.map(m => ({ ...m, type: 'message' as const })),
      ...polls.map(p => ({ ...p, type: 'poll' as const })),
      ...wordClouds.map(w => ({ ...w, type: 'wordCloud' as const })),
      ...openEndedQuestions.map(q => ({ ...q, type: 'openEnded' as const }))
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
        
        // Open table if not already open
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

        htmlContent += `<tr>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${dateStr}</td>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${timeStr}</td>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${slideBadge}</td>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; font-weight: 600; text-align: left; word-break: break-word; word-wrap: break-word;">${m.userName}</td>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-all; word-wrap: break-word;">${emailLink}</td>
          <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-word; word-wrap: break-word;"><strong>${formatHtmlTextWithLinks(m.text)}</strong>${likesBadge}</td>
        </tr>`;
      } else {
        // Close table if it was open
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
    link.download = 'chat-log.doc';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleToggleDisableAttendance = async () => {
    if (!presentation?.id || !canModerate) {
      console.warn('ChatSidebar - Cannot toggle disable attendance:', { hasId: !!presentation?.id, canModerate });
      return;
    }
    const newValue = !presentation.disableAttendance;
    console.log('ChatSidebar - Toggling disable attendance to:', newValue);
    try {
      await updateDoc(doc(db, 'presentations', presentation.id), {
        disableAttendance: newValue
      });
    } catch (error) {
      console.error('ChatSidebar - Error toggling disable attendance:', error);
      handleFirestoreError(error, OperationType.UPDATE, `presentations/${presentation.id}`);
    }
  };

  const handleToggleHideComments = async () => {
    if (!presentation?.id || !canModerate) {
      console.warn('ChatSidebar - Cannot toggle hide comments:', { hasId: !!presentation?.id, canModerate });
      return;
    }
    const newValue = !presentation.hideComments;
    console.log('ChatSidebar - Toggling hide comments to:', newValue);
    try {
      await updateDoc(doc(db, 'presentations', presentation.id), {
        hideComments: newValue
      });
    } catch (error) {
      console.error('ChatSidebar - Error toggling hide comments:', error);
      handleFirestoreError(error, OperationType.UPDATE, `presentations/${presentation.id}`);
    }
  };

  const handleCreateWordCloud = async (customPrompt?: string) => {
    const promptToUse = customPrompt || wordCloudPrompt.trim();
    if (!presentation?.id || !canModerate || !promptToUse) return;
    try {
      await addDoc(collection(db, 'wordClouds'), {
        presentationId: presentation.id,
        prompt: promptToUse,
        words: {},
        participants: {},
        createdAt: serverTimestamp(),
        active: false,
        started: false,
        showResults: false,
        slide: currentSlide !== null ? currentSlide : (presentation.currentSlide || 0)
      });
      setShowWordCloudModal(false);
      setWordCloudPrompt('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'wordClouds');
    }
  };

  const handleStartWordCloud = async (cloudId: string, duration: number) => {
    if (!canModerate) return;
    try {
      const expiresAt = new Date(Date.now() + duration * 1000);
      await updateDoc(doc(db, 'wordClouds', cloudId), {
        active: true,
        started: true,
        duration: duration,
        expiresAt: Timestamp.fromDate(expiresAt)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `wordClouds/${cloudId}`);
    }
  };

  const handleAdjustWordCloudDuration = async (cloudId: string, newDuration: number) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'wordClouds', cloudId), {
        duration: newDuration
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `wordClouds/${cloudId}`);
    }
  };

  const handleWordCloudSubmit = async (cloudId: string, word: string) => {
    if (!user) return;
    const cloud = wordClouds.find(c => c.id === cloudId);
    if (!cloud || !cloud.active || (cloud.participants && cloud.participants[user.uid])) return;

    try {
      const cloudRef = doc(db, 'wordClouds', cloudId);
      await updateDoc(cloudRef, {
        [`words.${word}`]: increment(1),
        [`participants.${user.uid}`]: true
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `wordClouds/${cloudId}`);
    }
  };

  const handleToggleWordCloudResults = async (cloudId: string, currentShow: boolean) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'wordClouds', cloudId), { showResults: !currentShow });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `wordClouds/${cloudId}`);
    }
  };

  const handleCloseWordCloud = async (cloudId: string) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'wordClouds', cloudId), { active: false });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `wordClouds/${cloudId}`);
    }
  };

  const handleDeleteWordCloud = async (cloudId: string) => {
    if (!canModerate) return;
    try {
      await deleteDoc(doc(db, 'wordClouds', cloudId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `wordClouds/${cloudId}`);
    }
  };

  const handleStartOpenEndedQuestion = async (id: string, duration: number) => {
    if (!canModerate) return;
    try {
      const expiresAt = new Date(Date.now() + duration * 1000);
      await updateDoc(doc(db, 'openEndedQuestions', id), { 
        active: true, 
        started: true,
        expiresAt: Timestamp.fromDate(expiresAt)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `openEndedQuestions/${id}`);
    }
  };

  const handleCloseOpenEndedQuestion = async (id: string) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'openEndedQuestions', id), { active: false });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `openEndedQuestions/${id}`);
    }
  };

  const handleDeleteOpenEndedQuestion = async (id: string) => {
    if (!canModerate) return;
    try {
      await deleteDoc(doc(db, 'openEndedQuestions', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `openEndedQuestions/${id}`);
    }
  };

  const handleOpenEndedQuestionSubmit = async (id: string, response: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'openEndedQuestions', id), {
        [`responses.${user.uid}`]: response
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `openEndedQuestions/${id}`);
    }
  };

  const handleAdjustOpenEndedDuration = async (id: string, newDuration: number) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'openEndedQuestions', id), { duration: newDuration });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `openEndedQuestions/${id}`);
    }
  };

  const handleToggleOpenEndedResults = async (questionId: string, currentShow: boolean) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'openEndedQuestions', questionId), { showResults: !currentShow });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `openEndedQuestions/${questionId}`);
    }
  };


  const handleCreatePoll = async () => {
    if (!presentation?.id || !canModerate) return;
    try {
      await addDoc(collection(db, 'polls'), {
        presentationId: presentation.id,
        options: ['A', 'B', 'C', 'D', 'E'],
        votes: { 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0 },
        voters: {},
        createdAt: serverTimestamp(),
        duration: pollDuration,
        active: false,
        started: false,
        showResults: false,
        slide: currentSlide !== null ? currentSlide : (presentation.currentSlide || 0)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'polls');
    }
  };

  const handleStartPoll = async (pollId: string, duration: number) => {
    if (!canModerate) return;
    try {
      const expiresAt = new Date(Date.now() + duration * 1000);
      await updateDoc(doc(db, 'polls', pollId), {
        active: true,
        started: true,
        expiresAt: Timestamp.fromDate(expiresAt)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleAdjustPollDuration = async (pollId: string, newDuration: number) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'polls', pollId), {
        duration: newDuration
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleVote = async (pollId: string, option: string) => {
    if (!user) return;
    const poll = polls.find(p => p.id === pollId);
    if (!poll || !poll.active || (poll.voters && poll.voters[user.uid])) return;

    try {
      const pollRef = doc(db, 'polls', pollId);
      await updateDoc(pollRef, {
        [`votes.${option}`]: increment(1),
        [`voters.${user.uid}`]: option
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleMarkCorrect = async (pollId: string, option: string) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'polls', pollId), {
        correctAnswer: option
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleToggleResults = async (pollId: string, currentShow: boolean) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'polls', pollId), { showResults: !currentShow });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleClosePoll = async (pollId: string) => {
    if (!canModerate) return;
    try {
      await updateDoc(doc(db, 'polls', pollId), { active: false });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `polls/${pollId}`);
    }
  };

  const handleDeletePoll = async (pollId: string) => {
    if (!canModerate) return;
    try {
      await deleteDoc(doc(db, 'polls', pollId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `polls/${pollId}`);
    }
  };

  if (isChatOnly && presentationLoaded && presentation === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[100dvh] bg-slate-950 text-white p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 bg-osu-orange/10 text-osu-orange rounded-full flex items-center justify-center mb-6 border border-osu-orange/20 animate-pulse">
            <PresentationIcon className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-white">Session Ended</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            The presenter has ended this session. Thank you for participating!
          </p>
        </div>
      </div>
    );
  }

  if (isChatOnly && user?.isAnonymous && !hasJoined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-950 text-white p-4 md:p-8 relative overflow-y-auto w-screen">
        {/* OSU Logo Watermark */}
        {internalLogoUrl !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5 z-0">
            <img 
              src={internalLogoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
              alt="Logo Watermark" 
              className="w-1/2 object-contain animate-pulse duration-[8000ms]" 
              referrerPolicy="no-referrer" 
            />
          </div>
        )}

        <div className="w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-10 shadow-2xl z-10 animate-in fade-in zoom-in-95 duration-300 relative max-w-md md:max-w-5xl">
          <form onSubmit={handleJoin} className="space-y-6">
            
            {/* If we need manual attendance check, show responsive 2-column grid */}
            {!presentation?.disableAttendance && !urlToken ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                
                {/* Left Column: Information and Inputs */}
                <div className="space-y-5 flex flex-col justify-between h-full">
                  <div>
                    <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">Join & Check-In</h2>
                    <p className="text-slate-400 text-xs md:text-sm mt-2 leading-relaxed">
                      Enter your name, email, and select the matching screen icon to register attendance and join the chat.
                    </p>
                  </div>

                  {joinError && (
                    <div className="p-4 bg-red-950/30 border border-red-500/20 rounded-2xl flex gap-3 text-xs text-red-300 items-start">
                      <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5 text-red-400" />
                      <p className="leading-relaxed">{joinError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Full Name</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        value={joinNameInput}
                        onChange={(e) => setJoinNameInput(e.target.value)}
                        required
                        className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Email Address</label>
                      <input
                        type="email"
                        placeholder="john.doe@example.com"
                        value={joinEmailInput}
                        onChange={(e) => setJoinEmailInput(e.target.value)}
                        required
                        className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isValidatingToken || !joinNameInput.trim() || !joinEmailInput.trim() || !selectedIcon}
                    className="w-full h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/10 flex items-center justify-center gap-2 mt-4"
                  >
                    {isValidatingToken ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Checking In...</span>
                      </>
                    ) : (
                      <span>Join Chat & Check-In</span>
                    )}
                  </button>
                </div>

                {/* Right Column: Icon Grid and Countdown Timer */}
                <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">
                      Verify Screen Icon
                    </label>
                    {iconTimeLeft !== null && (
                      <div className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black tracking-wider uppercase transition-colors",
                        iconTimeLeft <= 3 
                          ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse" 
                          : "bg-osu-orange/10 text-osu-orange border-osu-orange/20"
                      )}>
                        <Timer className="w-3.5 h-3.5" />
                        <span>Icon: {Math.ceil(iconTimeLeft)}s</span>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-xs text-slate-500 leading-normal">
                    Select the medical icon shown on the presenter's screen to verify attendance:
                  </p>

                  {/* Premium Progress Bar */}
                  {iconTimeLeft !== null && (
                    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden relative border border-slate-900/50">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-100 ease-linear",
                          iconTimeLeft <= 3 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : "bg-osu-orange"
                        )}
                        style={{ width: `${(iconTimeLeft / 10) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* Icon grid 4 columns wide, 5 columns deep (4x5) with overflow-hidden and no scrollbar */}
                  <div className="grid grid-cols-4 gap-2.5 p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                    {iconGrid.map((iconName, idx) => {
                      const isSelected = selectedIcon === iconName;
                      return (
                        <button
                          key={`${iconName}-${idx}`}
                          type="button"
                          onClick={() => setSelectedIcon(iconName)}
                          className={cn(
                            "h-12 rounded-lg flex items-center justify-center transition-all duration-200 border cursor-pointer",
                            isSelected
                              ? "bg-osu-orange/20 border-osu-orange text-osu-orange shadow-[0_0_8px_rgba(235,93,0,0.4)] scale-95 font-bold"
                              : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-white hover:border-slate-700 hover:bg-slate-900"
                          )}
                          title={iconName}
                        >
                          <MedicalIcon name={iconName} className="w-6 h-6" />
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>
            ) : (
              /* If no manual attendance or scanning QR code, show centered single column form */
              <div className="max-w-md mx-auto space-y-6">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-white tracking-tight">
                    {urlToken ? "Register Attendance" : "Join the Discussion"}
                  </h2>
                  <p className="text-slate-400 text-sm mt-2 leading-relaxed">
                    {urlToken 
                      ? "Enter your name and email to register attendance and join the chat." 
                      : "Enter your name and email to join the discussion."}
                  </p>
                  
                  {urlToken && tokenTimeLeft !== null && isTokenValid && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-osu-orange/10 border border-osu-orange/20 rounded-xl text-xs font-black text-osu-orange animate-pulse">
                      <Timer className="w-3.5 h-3.5" />
                      <span>Time left to check-in: {tokenTimeLeft}s</span>
                    </div>
                  )}
                </div>

                {joinError && (
                  <div className="p-4 bg-red-950/30 border border-red-500/20 rounded-2xl flex gap-3 text-xs text-red-300 items-start">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <p className="leading-relaxed">{joinError}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">
                      Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="John Doe"
                      value={joinNameInput}
                      onChange={(e) => setJoinNameInput(e.target.value)}
                      required
                      className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">
                      Email Address
                    </label>
                    <input
                      type="email"
                      placeholder="john.doe@example.com"
                      value={joinEmailInput}
                      onChange={(e) => setJoinEmailInput(e.target.value)}
                      required
                      className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl px-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange focus:ring-1 focus:ring-osu-orange transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isValidatingToken || !joinNameInput.trim() || !joinEmailInput.trim()}
                  className="w-full h-12 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/10 flex items-center justify-center gap-2"
                >
                  {isValidatingToken ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Checking In...</span>
                    </>
                  ) : (
                    <span>{urlToken ? "Register & Join Chat" : "Join Chat"}</span>
                  )}
                </button>
              </div>
            )}

          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden bg-white relative">
      {/* Clear Chat Confirmation Modal */}
      {showClearConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Clear Chat?</h3>
            <p className="text-sm text-slate-600 mb-6">
              This will permanently delete all messages in this presentation session. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearChat}
                className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                Clear All Messages
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Code Bar - Only for Presenter/Main View */}
      {!isChatOnly && (
        <div className="bg-slate-900 text-white px-3.5 py-3.5 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex flex-col min-w-0 flex-1 gap-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-osu-orange animate-pulse" />
                <span className="text-xs font-black text-osu-orange uppercase tracking-wider">
                  Join Code:
                </span>
              </div>
              {presentation?.pinCode && (
                <div className="mt-1.5">
                  <span className="text-[26px] font-mono font-black tracking-tight text-osu-orange bg-osu-orange/10 border border-osu-orange/20 px-3 py-1.5 rounded-xl leading-none select-all shadow-sm inline-block whitespace-nowrap">
                    {presentation.pinCode.replace(/(\d{3})(\d{3})/, '$1 $2')}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {/* Rotating Dynamic Icon Badge */}
              {showAttendance && !presentation?.disableAttendance && (
                <div className="flex flex-col items-center bg-slate-950 px-2 py-1.5 rounded-xl border border-slate-800 shadow-inner">
                  <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">ICON</span>
                  <div className="w-8 h-8 flex items-center justify-center mt-1 bg-slate-900/50 rounded-lg border border-slate-800/30">
                    {presentation?.currentIcon ? (
                      <MedicalIcon name={presentation.currentIcon} className="w-5 h-5 text-osu-orange" />
                    ) : (
                      <span className="text-slate-600 text-[10px] font-bold">---</span>
                    )}
                  </div>
                </div>
              )}

              {/* Clickable QR Code Thumbnail */}
              <div 
                onClick={() => setIsQRExpanded(!isQRExpanded)}
                className="bg-white p-1 rounded-xl border border-slate-800 shadow-sm flex flex-col items-center justify-center cursor-pointer hover:border-osu-orange hover:shadow-md transition-all group/qr"
                title={isQRExpanded ? "Click to minimize QR code" : "Click to expand QR code"}
              >
                <QRCodeSVG 
                  value={dynamicChatUrl} 
                  size={85}
                  level="M"
                  includeMargin={false}
                  imageSettings={{
                    src: internalLogoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png",
                    x: undefined,
                    y: undefined,
                    height: 20,
                    width: 20,
                    excavate: true,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat Header */}
      <div className="p-4 bg-osu-black text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-osu-orange" />
          <div className="flex flex-col">
            <h2 className="font-bold tracking-tight uppercase text-sm leading-none">ActiveDeck Chat</h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canModerate && (
            <>
              {showAttendance && (
                <button 
                  onClick={handleToggleDisableAttendance}
                  className={cn(
                    "px-2 py-1 rounded transition-colors flex items-center gap-1.5 text-xs font-medium",
                    presentation?.disableAttendance 
                      ? "text-red-400 hover:bg-slate-800 hover:text-red-300" 
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  )}
                  title={presentation?.disableAttendance ? "Attendance Disabled (QR displays static join link)" : "Attendance Enabled (QR rotates dynamic tokens)"}
                >
                  {presentation?.disableAttendance ? <ToggleRight className="w-4 h-4 text-red-400" /> : <ToggleLeft className="w-4 h-4" />}
                  <span className="hidden sm:inline">
                    {presentation?.disableAttendance ? "Attendance Off" : "Attendance On"}
                  </span>
                </button>
              )}
              <button 
                onClick={handleToggleHideComments}
                className={cn(
                  "p-1 hover:bg-slate-800 rounded transition-colors",
                  presentation?.hideComments 
                    ? "text-red-500 hover:text-red-400" 
                    : "text-slate-400 hover:text-white"
                )}
                title={presentation?.hideComments ? "Comments Hidden from Audience" : "Comments Visible to Audience"}
              >
                {presentation?.hideComments ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button 
                onClick={handleDownloadWord}
                className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white"
                title="Download as Word"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setShowClearConfirm(true)}
                className="p-1 hover:bg-red-900/50 rounded transition-colors text-slate-400 hover:text-red-400"
                title="Clear Chat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Attendance Status Banner for Student/Audience view */}
      {isChatOnly && showAttendanceBanner && showAttendance && (urlToken || attendanceStatus === 'success' || attendanceStatus === 'error') && (
        <div className={cn(
          "px-4 py-2 border-b text-xs flex items-start gap-2.5 transition-all duration-300 animate-in slide-in-from-top z-40",
          attendanceStatus === 'success' && "bg-green-50 text-green-800 border-green-200",
          attendanceStatus === 'expired' && "bg-amber-50 text-amber-800 border-amber-200",
          attendanceStatus === 'error' && "bg-red-50 text-red-800 border-red-200",
          attendanceStatus === 'none' && isValidatingToken && "bg-slate-50 text-slate-700 border-slate-200"
        )}>
          {attendanceStatus === 'success' && (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="font-bold">Attendance Checked-In!</p>
                  <p className="opacity-80">Checked in as <span className="font-semibold">{guestName || joinNameInput}</span> ({guestEmail || joinEmailInput})</p>
                </div>
                <span className="text-osu-orange font-bold uppercase tracking-wider text-[8px] bg-osu-orange/10 px-2 py-0.5 rounded border border-osu-orange/20 self-center">
                  {urlToken ? 'Secure QR Scan' : 'Screen Icon Match'}
                </span>
              </div>
            </>
          )}
          {attendanceStatus === 'expired' && (
            <>
              <XCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold">Attendance QR Expired</p>
                <p className="opacity-80">You're in chat, but checking in failed (45s limit expired). Scan the latest QR code on presenter's screen to check-in.</p>
              </div>
            </>
          )}
          {attendanceStatus === 'error' && (
            <>
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold">Check-In Error</p>
                <p className="opacity-80">Failed to register attendance. Please try scanning again or contact the presenter.</p>
              </div>
            </>
          )}
          {attendanceStatus === 'none' && isValidatingToken && (
            <>
              <Loader2 className="w-4 h-4 text-osu-orange shrink-0 mt-0.5 animate-spin" />
              <div className="flex-1 min-w-0">
                <p className="font-bold">Verifying Attendance Ticket...</p>
              </div>
            </>
          )}
          {attendanceStatus === 'none' && !isValidatingToken && !isTokenValid && (
            <>
              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-bold">Invalid Attendance Token</p>
                <p className="opacity-80">The scanned token is invalid. Please scan the current code from the presenter's screen.</p>
              </div>
            </>
          )}
          <button 
            onClick={() => setShowAttendanceBanner(false)}
            className="text-slate-400 hover:text-slate-600 font-bold px-1 rounded transition-colors shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Embedded QR Code Section */}
      {!isChatOnly && (
        isQRExpanded ? (
          /* Expanded Card View */
          <div 
            onClick={() => setIsQRExpanded(false)}
            className="p-5 bg-white border-b border-slate-200 flex flex-col items-center justify-center gap-3.5 cursor-pointer animate-in fade-in duration-300 select-none h-[380px]"
            title="Click to minimize QR code"
          >
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-md flex flex-col items-center gap-2 animate-in zoom-in-95 duration-300">
              <QRCodeSVG 
                value={dynamicChatUrl} 
                size={230}
                level="M"
                includeMargin={true}
                imageSettings={{
                  src: internalLogoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png",
                  x: undefined,
                  y: undefined,
                  height: 38,
                  width: 38,
                  excavate: true,
                }}
              />
              {/* Progress countdown bar */}
              {!presentation?.disableAttendance && (
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden relative">
                  <div 
                    className="h-full bg-osu-orange transition-all duration-100 ease-linear"
                    style={{ width: `${(timeLeft / 10) * 100}%` }}
                  />
                </div>
              )}
            </div>
            
            <div className="text-center space-y-1 w-full max-w-[270px]">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-tight">
                {presentation?.disableAttendance ? "Scan to Join Chat" : "Scan to Mark Attendance and Join Chat"}
              </p>
              <p className="text-xs font-bold text-slate-700 font-mono select-all truncate">
                {shortUrl || chatOnlyUrl}
              </p>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded border border-slate-200 text-[10px] font-black text-slate-650 mt-1">
                <Users className="w-3.5 h-3.5 text-osu-orange" />
                <span>{participantCount} Joined</span>
              </div>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-2.5 animate-pulse">
                (Click anywhere to minimize)
              </p>
            </div>
          </div>
        ) : (
          /* Minimized Horizontal View */
          <div className="p-2 bg-slate-50 border-b border-slate-200 flex flex-col gap-1.5 animate-in slide-in-from-top duration-300">
            <div className="flex flex-col justify-center min-w-0 w-full">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate mr-1">
                  Session Controls
                </p>
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-slate-200/50 rounded-lg text-[10px] font-black text-slate-700 shadow-sm shrink-0">
                  <Users className="w-3.5 h-3.5 text-osu-orange" />
                  <span>{participantCount} Joined</span>
                </div>
              </div>
              
              {canModerate && (
                <div className="flex flex-col gap-1.5 mt-1.5">
                  <div className="flex items-stretch gap-1.5">
                    <button 
                      onClick={handleCreatePoll}
                      className="flex-1 flex items-center justify-center py-2.5 bg-osu-orange text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-[#c03900] transition-all shadow-sm border-0 cursor-pointer"
                    >
                      <span>MCQ</span>
                    </button>
                    <button 
                      onClick={() => handleCreateWordCloud('Word Cloud')}
                      className="flex-1 flex items-center justify-center py-2.5 bg-blue-500 text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-blue-600 transition-all shadow-sm border-0 cursor-pointer"
                    >
                      <span>Word</span>
                    </button>
                    <button                
                      onClick={() => handleCreateOpenEndedQuestion('Open question')}
                      className="flex-1 flex items-center justify-center py-2.5 bg-green-500 text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-green-600 transition-all shadow-sm border-0 cursor-pointer"
                    >                
                      <span>Open ?</span>
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsAllCollapsed(!isAllCollapsed)}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border shadow-sm cursor-pointer",
                      isAllCollapsed 
                        ? "bg-slate-800 text-osu-orange border-slate-700" 
                        : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                    )}
                  >
                    {isAllCollapsed ? <ChevronDown className="w-3 h-3 animate-bounce" /> : <ChevronUp className="w-3 h-3" />}
                    <span>{isAllCollapsed ? "Expand All Content" : "Collapse All Content"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* Messages Area Wrapper */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
        {/* OSU Logo Watermark */}
        {internalLogoUrl !== null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 z-0">
            <img 
              src={internalLogoUrl || "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png"} 
              alt="Logo Watermark" 
              className="w-3/4 object-contain" 
              referrerPolicy="no-referrer" 
            />
          </div>
        )}

        {/* Sticky Pinned Messages Banner */}
        {pinnedMessages.length > 0 && !presentation?.hideComments && (
          <div className="bg-blue-100/80 border-b border-blue-200 p-2.5 space-y-2 shrink-0 z-20 shadow-sm relative max-h-[350px] overflow-y-auto">
            <div className="flex items-center gap-1.5 px-1 mb-1">
              <Pin className="w-3 h-3 text-blue-600 fill-current rotate-45" />
              <span className="text-[9px] font-black uppercase tracking-wider text-blue-800">Pinned Messages</span>
            </div>
            {pinnedMessages.map((msg) => (
              <MessageCard
                key={`pinned-${msg.id}`}
                msg={msg}
                user={user}
                canModerate={canModerateChat}
                onLike={handleLikeMessage}
                onDelete={handleDeleteMessage}
                onTogglePin={handleTogglePinMessage}
                initialCollapsed={isAllCollapsed}
                isInitiallyNew={false}
                isPresenter={msg.userId === presentation?.presenterId}
                onFocus={(msg) => {
                  const isAlreadyFocused = focusedMessage?.id === msg.id;
                  if (isAlreadyFocused) {
                    setCollapsedMessageIds(prev => ({ ...prev, [msg.id]: true }));
                    setFocusedMessage(null);
                  } else {
                    setCollapsedMessageIds(prev => ({ ...prev, [msg.id]: false }));
                    setFocusedMessage(msg);
                  }
                }}
                forceCollapsed={!!collapsedMessageIds[msg.id]}
              />
            ))}
          </div>
        )}

        {/* Messages Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 z-10"
        >
          {presentation?.hideComments && (
            <div className="flex flex-col items-center justify-center p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 animate-in fade-in duration-500">
              <EyeOff className="w-8 h-8 text-slate-400 mb-3" />
              <h3 className="text-sm font-bold text-slate-700">
                {canModerate ? "Comments Hidden from Audience" : "Comments are Hidden"}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {canModerate 
                  ? `Currently collecting responses (${messages.length} received). Toggle the eye icon in the header to reveal them.`
                  : "The presenter has hidden responses for now. They will be visible once the discussion begins."}
              </p>
            </div>
          )}
          {messages.length === 0 && polls.length === 0 && wordClouds.length === 0 && openEndedQuestions.length === 0 && !presentation?.hideComments && (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
              <MessageSquare className="w-8 h-8 mb-2" />
              <p className="text-xs font-medium">No messages yet</p>
            </div>
          )}

          {/* Render Polls, Word Clouds, and Messages interleaved chronologically by time (pinned messages are excluded from the main feed) */}
          {[...messages.filter(m => !m.isPinned).map(m => ({ ...m, type: 'message' as const })), 
            ...polls.map(p => ({ ...p, type: 'poll' as const })),
            ...wordClouds.map(w => ({ ...w, type: 'wordCloud' as const })),
            ...openEndedQuestions.map(q => ({ ...q, type: 'openEndedQuestion' as const }))]
            .sort((a, b) => {
              const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
              const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
              return timeA - timeB;
            })
            .map((item) => {
              const createdAt = (item as any).timestamp || (item as any).createdAt;
              const isInitiallyNew = createdAt && (Date.now() - createdAt.toMillis() < 5000);

              if (item.type === 'poll') {
                const poll = item as Poll;
                // Audience only sees active or closed polls, not drafts
                if (isChatOnly && !poll.active && !poll.expiresAt) return null;

                return (
                  <PollCard
                    key={item.id}
                    poll={poll}
                    user={user}
                    isChatOnly={isChatOnly}
                    canModerate={canModerateChat}
                    onVote={handleVote}
                    onMarkCorrect={handleMarkCorrect}
                    onToggleResults={handleToggleResults}
                    onClose={handleClosePoll}
                    onDelete={handleDeletePoll}
                    onStart={handleStartPoll}
                    onAdjustDuration={handleAdjustPollDuration}
                    initialCollapsed={isAllCollapsed}
                    isInitiallyNew={isInitiallyNew}
                    secondaryColor={secondaryColor}
                  />
                );
              } else if (item.type === 'wordCloud') {
                const cloud = item as WordCloud;
                // Audience only sees active or closed word clouds, not drafts
                if (isChatOnly && !cloud.active && !cloud.started) return null;

                return (
                  <WordCloudCard
                    key={item.id}
                    cloud={cloud}
                    canModerate={canModerateChat}
                    isChatOnly={isChatOnly}
                    user={user}
                    onToggleResults={handleToggleWordCloudResults}
                    onClose={handleCloseWordCloud}
                    onDelete={handleDeleteWordCloud}
                    onStart={handleStartWordCloud}
                    onAdjustDuration={handleAdjustWordCloudDuration}
                    onSubmit={handleWordCloudSubmit}
                    initialCollapsed={isAllCollapsed}
                    isInitiallyNew={isInitiallyNew}
                    secondaryColor={secondaryColor}
                  />
                );
              } else if (item.type === 'openEndedQuestion') {
                const q = item as OpenEndedQuestion;
                // Audience only sees active or closed questions, not drafts
                if (isChatOnly && !q.active && !q.started) return null;

                return (
                  <OpenEndedQuestionCard
                    key={item.id}
                    q={q}
                    user={user}
                    canModerate={canModerateChat}
                    onClose={handleCloseOpenEndedQuestion}
                    onDelete={handleDeleteOpenEndedQuestion}
                    onStart={handleStartOpenEndedQuestion}
                    onSubmit={handleOpenEndedQuestionSubmit}
                    onToggleResults={handleToggleOpenEndedResults}
                    onAdjustDuration={handleAdjustOpenEndedDuration}
                    initialCollapsed={isAllCollapsed}
                    isInitiallyNew={isInitiallyNew}
                    secondaryColor={secondaryColor}
                  />
                );
              }

              const msg = item as Message;
              
              // Hide messages if hideComments is true
              if (presentation?.hideComments) {
                return null;
              }

              return (
                <MessageCard
                  key={msg.id}
                  msg={msg}
                  user={user}
                  canModerate={canModerateChat}
                  onLike={handleLikeMessage}
                  onDelete={handleDeleteMessage}
                  onTogglePin={handleTogglePinMessage}
                  initialCollapsed={isAllCollapsed}
                  isInitiallyNew={isInitiallyNew}
                  isPresenter={msg.userId === presentation?.presenterId}
                  onFocus={(msg) => {
                    const isAlreadyFocused = focusedMessage?.id === msg.id;
                    if (isAlreadyFocused) {
                      setCollapsedMessageIds(prev => ({ ...prev, [msg.id]: true }));
                      setFocusedMessage(null);
                    } else {
                      setCollapsedMessageIds(prev => ({ ...prev, [msg.id]: false }));
                      setFocusedMessage(msg);
                    }
                  }}
                  forceCollapsed={!!collapsedMessageIds[msg.id]}
                />
              );
            })}
    </div>
  </div>

      {/* Input Area - Only visible for audience members (isChatOnly) */}
      {isChatOnly && (
        <div className="bg-white border-t border-slate-200 shrink-0 pb-[env(safe-area-inset-bottom)]">
          {!user ? (
            <div className="p-4 text-center">
              <p className="text-xs text-slate-500 mb-3">Connecting to chat...</p>
              <button 
                onClick={() => window.location.reload()}
                className="text-xs text-osu-orange hover:underline font-bold"
              >
                Refresh Page
              </button>
            </div>
          ) : user.isAnonymous && !hasJoined ? (
            <form onSubmit={handleJoin} className="p-4 flex flex-col gap-3">
              <div className="text-center mb-1">
                <h3 className="text-sm font-bold text-slate-900">
                  {!presentation?.disableAttendance ? "Join & Check-In" : "Join the Discussion"}
                </h3>
                <p className="text-xs text-slate-500 mt-1 mb-2">
                  {!presentation?.disableAttendance
                    ? (urlToken 
                        ? "Enter your name and email to register attendance and join the chat." 
                        : "Enter your name, email, and select the matching screen icon to register attendance and join the chat.")
                    : "Enter your name and email to join the discussion."}
                </p>
                {urlToken && tokenTimeLeft !== null && isTokenValid && (
                  <div className="mt-2 py-1 px-3 bg-orange-50 border border-orange-100 rounded-lg inline-flex items-center gap-1.5 text-xs font-bold text-osu-orange animate-pulse">
                    <Timer className="w-3.5 h-3.5" />
                    <span>Time left to check-in: {tokenTimeLeft}s</span>
                  </div>
                )}
                {!urlToken && !presentation?.disableAttendance && iconTimeLeft !== null && (
                  <div className="mt-2 py-1 px-3 bg-orange-50 border border-orange-100 rounded-lg inline-flex items-center gap-1.5 text-xs font-bold text-osu-orange animate-pulse">
                    <Timer className="w-3.5 h-3.5" />
                    <span>Screen Icon rotates in: {Math.ceil(iconTimeLeft)}s</span>
                  </div>
                )}
              </div>

              {joinError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-semibold text-center flex items-center justify-center gap-1.5 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span>{joinError}</span>
                </div>
              )}

              {!presentation?.disableAttendance && !urlToken && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex justify-between items-baseline">
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Verify Screen Icon
                    </label>
                    {iconTimeLeft !== null && (
                      <span className={cn(
                        "text-[9px] font-black tracking-wider",
                        iconTimeLeft <= 3 ? "text-red-500 animate-pulse" : "text-osu-orange"
                      )}>
                        Rotates in {Math.ceil(iconTimeLeft)}s
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal mb-1">
                    Select the medical icon shown on the presenter's screen to verify attendance:
                  </p>

                  {/* Visual Progress Bar */}
                  {iconTimeLeft !== null && (
                    <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden relative border border-slate-900/50">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-100 ease-linear",
                          iconTimeLeft <= 3 ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" : "bg-osu-orange"
                        )}
                        style={{ width: `${(iconTimeLeft / 10) * 100}%` }}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2.5 p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner">
                    {iconGrid.map((iconName, idx) => {
                      const isSelected = selectedIcon === iconName;
                      return (
                        <button
                          key={`${iconName}-${idx}`}
                          type="button"
                          onClick={() => setSelectedIcon(iconName)}
                          className={cn(
                            "h-10 rounded-lg flex items-center justify-center transition-all duration-200 border cursor-pointer",
                            isSelected
                              ? "bg-osu-orange/20 border-osu-orange text-osu-orange shadow-[0_0_8px_rgba(235,93,0,0.4)] scale-95"
                              : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-white hover:border-slate-700 hover:bg-slate-900"
                          )}
                          title={iconName}
                        >
                          <MedicalIcon name={iconName} className="w-5 h-5" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <input
                type="text"
                placeholder="Your Name (required)"
                value={joinNameInput}
                onChange={(e) => setJoinNameInput(e.target.value)}
                required
                className="w-full px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
              />
              <input
                type="email"
                placeholder="Email address (required)"
                value={joinEmailInput}
                onChange={(e) => setJoinEmailInput(e.target.value)}
                required
                className="w-full px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
              />
              <button
                type="submit"
                disabled={isValidatingToken || !joinNameInput.trim() || !joinEmailInput.trim() || (!presentation?.disableAttendance && !urlToken && !selectedIcon)}
                className="w-full bg-osu-orange disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md hover:bg-[#c03900] transition-colors text-sm flex items-center justify-center gap-1.5 shadow-sm"
              >
                {isValidatingToken ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Checking In...</span>
                  </>
                ) : (
                  <span>{!presentation?.disableAttendance ? "Join Chat & Check-In" : "Join Chat"}</span>
                )}
              </button>
            </form>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              {user.isAnonymous && (
                <div className="flex justify-between items-start px-1">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-500">
                      Posting as: <span className="font-semibold text-slate-700">
                        {isPostingAnonymously
                          ? `Anonymous ${user.uid.slice(0, 4)}` 
                          : (guestName || (guestEmail ? guestEmail.split('@')[0] : `Guest ${user.uid.slice(0, 4)}`))}
                      </span>
                    </span>
                    {(guestName || guestEmail || presentation?.allowAnonymousChat || presentation?.disableAttendance) && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={isPostingAnonymously}
                          onChange={(e) => setIsPostingAnonymously(e.target.checked)}
                          className="rounded border-slate-300 text-osu-orange focus:ring-osu-orange"
                        />
                        Post Anonymously
                      </label>
                    )}
                  </div>
                  <button 
                    onClick={handleLeave}
                    className="text-xs text-osu-orange hover:underline mt-0.5"
                  >
                    {hasJoined ? "Change" : "Add Name"}
                  </button>
                </div>
              )}
              {hasActiveInteractive && (
                <div className="mb-2 px-1 py-1.5 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-tight">Active Activity: Chat Paused</p>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  placeholder={hasActiveInteractive ? "Chat paused for active activity..." : "Type a message..."}
                  disabled={hasActiveInteractive}
                  className={`flex-1 min-w-0 px-3 py-2 text-base border rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange transition-all ${
                    hasActiveInteractive 
                      ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed italic" 
                      : "border-slate-300 bg-white"
                  }`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={hasActiveInteractive || !inputText.trim()}
                  className={`shrink-0 p-2 rounded-md transition-colors ${
                    hasActiveInteractive || !inputText.trim()
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                      : "bg-osu-black text-white hover:bg-slate-800 shadow-sm"
                  }`}
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Presenter-only Bottom Chat Input Area */}
      {!isChatOnly && user && (
        <div className="bg-white border-t border-slate-200 shrink-0 p-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingFile}
              className={`shrink-0 p-1.5 rounded-md border border-slate-300 transition-colors flex items-center justify-center ${
                isUploadingFile 
                  ? "bg-slate-50 cursor-not-allowed" 
                  : "bg-white hover:bg-slate-50 text-slate-600 hover:text-indigo-600"
              }`}
              title="Upload Document"
            >
              {isUploadingFile ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              type="text"
              placeholder="Post as presenter..."
              className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange bg-white text-slate-800"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className={`shrink-0 p-1.5 rounded-md transition-colors ${
                !inputText.trim() 
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                  : "bg-osu-black text-white hover:bg-slate-800 shadow-sm"
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Word Cloud Creation Modal */}
      {showWordCloudModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-500" />
              Create Word Cloud
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Prompt / Question</label>
                <input
                  type="text"
                  value={wordCloudPrompt}
                  onChange={(e) => setWordCloudPrompt(e.target.value)}
                  placeholder="e.g., Describe this topic in one word"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowWordCloudModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCreateWordCloud()}
                disabled={!wordCloudPrompt.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Create Word Cloud
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open-Ended Question Creation Modal */}
      {showOpenEndedQuestionModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-500" />
              Create Open-Ended Question
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Prompt / Question</label>
                <input
                  type="text"
                  value={openEndedQuestionPrompt}
                  onChange={(e) => setOpenEndedQuestionPrompt(e.target.value)}
                  placeholder="e.g., What are your thoughts on this?"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowOpenEndedQuestionModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCreateOpenEndedQuestion()}
                disabled={!openEndedQuestionPrompt.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Create Question
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight Floating Draggable Panel */}
      {focusedMessage !== null && canModerate && (
        <motion.div 
          initial={{ scale: 0.9, opacity: 0, x: "-50%", y: "-50%" }} 
          animate={{ scale: 1, opacity: 1, x: "-50%", y: "-50%" }} 
          transition={{ type: "spring", duration: 0.4 }} 
          style={{
            left: `calc(50% + ${dragPosition.x}px)`,
            top: `calc(50% + ${dragPosition.y}px)`,
          }}
          className={cn(
            "fixed z-[9999] bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border-4 overflow-hidden text-slate-800 max-w-xl w-[90vw] md:w-full flex flex-col p-6 select-none",
            focusedMessage.userId === presentation?.presenterId ? "border-indigo-600/90 shadow-indigo-500/15" : "border-orange-500/90 shadow-orange-500/15"
          )}
        >
          {/* Drag Handle Top Bar */}
          <div 
            onMouseDown={handleDragMouseDown}
            onTouchStart={handleDragTouchStart}
            className={cn(
              "w-full pt-1 pb-4 flex flex-col items-center justify-center cursor-grab border-b border-slate-100 active:cursor-grabbing shrink-0",
              isDragging && "cursor-grabbing"
            )}
            title="Drag to reposition spotlight window"
          >
            <div className="w-12 h-1.5 bg-slate-300 hover:bg-slate-400 transition-colors rounded-full mb-1.5" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Floating Spotlight (Drag)
            </span>
          </div>

          {/* Close Button */}
          <button 
            onClick={() => {
              if (focusedMessage) {
                setCollapsedMessageIds(prev => ({ ...prev, [focusedMessage.id]: true }));
              }
              setFocusedMessage(null);
            }}
            className="absolute top-4 right-4 p-2 bg-red-500 hover:bg-red-600 text-white hover:rotate-90 rounded-full transition-all duration-200 shadow-md focus:outline-none z-10 active:scale-95"
            title="Close Spotlight"
          >
            <X className="w-6 h-6 stroke-[3]" />
          </button>

          {/* Scrollable Content Wrapper */}
          <div className="pt-6 overflow-y-auto max-h-[60vh]">
            {/* Streamlined Sender Metadata Subtitle (Circular Avatar Removed) */}
            <div className="flex items-center justify-center gap-1.5 mb-4 text-center">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                Sent by:
              </span>
              <h4 className="text-sm font-black text-slate-700 uppercase tracking-tight flex items-center gap-1.5">
                {focusedMessage.userName || "Guest Participant"}
                {focusedMessage.userId === presentation?.presenterId && (
                  <span className="bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Presenter
                  </span>
                )}
              </h4>
            </div>

            {/* Message Body */}
            {focusedMessage.text && (
              <div className="text-2xl md:text-3xl font-black text-slate-900 leading-relaxed text-center my-6 md:my-8 break-words select-text">
                {renderTextWithLinks(focusedMessage.text)}
              </div>
            )}

            {/* File Upload / Shared Document inside Spotlight */}
            {focusedMessage.fileUrl && (
              <div className="p-4 rounded-2xl bg-indigo-50/40 border-2 border-indigo-100/70 flex items-center justify-between gap-4 max-w-md mx-auto my-4 transition-all shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center shrink-0">
                    <Download className="w-5 h-5 animate-pulse" />
                  </div>
                  <div className="min-w-0 flex flex-col items-start text-left">
                    <span className="font-extrabold text-slate-800 truncate block text-sm max-w-[200px]" title={focusedMessage.fileName}>
                      {focusedMessage.fileName || "Shared Document"}
                    </span>
                    {focusedMessage.fileSize !== undefined && focusedMessage.fileSize !== null && (
                      <span className="text-[10px] text-slate-500 font-bold mt-0.5 block">
                        {formatFileSize(focusedMessage.fileSize)}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={focusedMessage.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={focusedMessage.fileName || "download"}
                  className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wide select-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </a>
              </div>
            )}

            {/* Metadata Footer */}
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-slate-100 pt-6 mt-6">
              {(focusedMessage.slide !== undefined && focusedMessage.slide !== null) && (
                <span className={cn(
                  "inline-flex items-center gap-1 px-4 py-1.5 rounded-full text-xs font-black text-white uppercase tracking-wider shadow-md",
                  focusedMessage.userId === presentation?.presenterId ? "bg-indigo-600 shadow-indigo-600/20" : "bg-[#ff3e00] shadow-[#ff3e00]/20"
                )}>
                  Slide {focusedMessage.slide}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black bg-yellow-400 text-slate-900 shadow-md">
                <ThumbsUp className="w-3.5 h-3.5 fill-current" />
                {focusedMessage.likes || 0} Likes
              </span>
              <span className="inline-flex items-center gap-1 px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                {focusedMessage.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
