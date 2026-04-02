import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, getDocFromServer, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove, increment, where, writeBatch } from 'firebase/firestore';
import { Message, Presentation, Poll, WordCloud } from '../types';
import { useAuth } from './AuthProvider';
import { Send, HelpCircle, MessageSquare, QrCode, Trash2, LogIn, LogOut, ThumbsUp, Download, Mail, ToggleLeft, ToggleRight, BarChart2, CheckCircle2, XCircle, Cloud } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { QRCodeSVG } from 'qrcode.react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

interface WordCloudCardProps {
  cloud: WordCloud;
  user: any;
  isChatOnly: boolean;
  canModerate: boolean;
  onSubmit: (cloudId: string, word: string) => void;
  onToggleResults: (cloudId: string, currentShow: boolean) => void;
  onClose: (cloudId: string) => void;
  onDelete: (cloudId: string) => void;
}

const WordCloudCard: React.FC<WordCloudCardProps> = ({ cloud, user, isChatOnly, canModerate, onSubmit, onToggleResults, onClose, onDelete }) => {
  const [word, setWord] = useState('');
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

  return (
    <div className="p-4 rounded-xl border-2 border-blue-500 bg-white shadow-lg animate-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-blue-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Word Cloud</span>
        </div>
        <div className="flex items-center gap-2">
          {canModerate && (
            <>
              <button 
                onClick={() => onToggleResults(cloud.id, !!cloud.showResults)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors border",
                  cloud.showResults 
                    ? "bg-blue-500 text-white border-blue-500" 
                    : "bg-white text-slate-500 border-slate-200 hover:border-blue-500 hover:text-blue-500"
                )}
                title={cloud.showResults ? "Hide Results from Audience" : "Show Results to Audience"}
              >
                {cloud.showResults ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                {cloud.showResults ? "Results Visible" : "Results Hidden"}
              </button>
              {cloud.active ? (
                <button onClick={() => onClose(cloud.id)} className="p-1 text-slate-400 hover:text-red-500" title="Close Word Cloud">
                  <XCircle className="w-4 h-4" />
                </button>
              ) : (
                <span className="text-[8px] font-bold text-red-500 uppercase">Closed</span>
              )}
              <button onClick={() => onDelete(cloud.id)} className="p-1 text-slate-400 hover:text-red-500" title="Delete Word Cloud">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-4">
        <h4 className="font-bold text-slate-800 text-lg">{cloud.prompt}</h4>
      </div>

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
      
      <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{totalWords} Total Submissions</span>
        {!cloud.active && <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">Final Results</span>}
      </div>
    </div>
  );
};

interface ChatSidebarProps {
  isChatOnly?: boolean;
  presentation?: Presentation | null;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isChatOnly = false, presentation = null }) => {
  const { user } = useAuth();
  const isPresenter = user?.uid === presentation?.presenterId;
  // Faculty/Moderators are guests in the main view (not isChatOnly)
  const isMainViewModerator = !isChatOnly;
  const canModerate = isPresenter || isMainViewModerator; // Presenter or anyone in the main view can moderate (delete any message, clear chat, etc.)

  console.log('ChatSidebar Render - User:', user?.email || 'Guest', 'isPresenter:', isPresenter, 'isMainViewModerator:', isMainViewModerator);
  const [messages, setMessages] = useState<Message[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [wordClouds, setWordClouds] = useState<WordCloud[]>([]);
  const [inputText, setInputText] = useState('');
  const [showQR, setShowQR] = useState(!isChatOnly);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showWordCloudModal, setShowWordCloudModal] = useState(false);
  const [wordCloudPrompt, setWordCloudPrompt] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const [hasJoined, setHasJoined] = useState(() => {
    return localStorage.getItem('activeDeckJoined') === 'true';
  });
  const [guestEmail, setGuestEmail] = useState(() => {
    return localStorage.getItem('activeDeckGuestEmail') || '';
  });
  const [guestName, setGuestName] = useState(() => {
    return localStorage.getItem('activeDeckGuestName') || '';
  });
  const [joinEmailInput, setJoinEmailInput] = useState('');
  const [joinNameInput, setJoinNameInput] = useState('');
  const [isPostingAnonymously, setIsPostingAnonymously] = useState(false);
  const [shortUrl, setShortUrl] = useState('');

  // Construct chat-only URL for QR code
  const baseUrl = window.location.origin + window.location.pathname;
  const chatOnlyUrl = presentation?.id ? `${baseUrl}?view=chat&id=${presentation.id}` : `${baseUrl}?view=chat`;

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
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();

    const q = query(
      collection(db, 'messages'), 
      where('presentationId', '==', presentation?.id || 'default')
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
      where('presentationId', '==', presentation?.id || 'default')
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
      where('presentationId', '==', presentation?.id || 'default')
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

    return () => {
      unsubscribe();
      pUnsubscribe();
      wcUnsubscribe();
    };
  }, [presentation?.id]);

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

      if (isPostingAnonymously) {
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

      if (emailToSave) {
        messageData.userEmail = emailToSave;
      }

      await addDoc(collection(db, 'messages'), messageData);
      setInputText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'messages');
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setGuestEmail(joinEmailInput);
    setGuestName(joinNameInput);
    setHasJoined(true);
    localStorage.setItem('activeDeckJoined', 'true');
    if (joinEmailInput) {
      localStorage.setItem('activeDeckGuestEmail', joinEmailInput);
    }
    if (joinNameInput) {
      localStorage.setItem('activeDeckGuestName', joinNameInput);
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

  const handleDownloadWord = () => {
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Chat Log</title></head><body style='font-family: sans-serif;'>";
    const footer = "</body></html>";
    
    const combinedItems = [
      ...messages.map(m => ({ ...m, type: 'message' as const })),
      ...polls.map(p => ({ ...p, type: 'poll' as const })),
      ...wordClouds.map(w => ({ ...w, type: 'wordCloud' as const }))
    ].sort((a, b) => {
      const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
      const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
      return timeA - timeB;
    });

    const content = combinedItems.map(item => {
      if (item.type === 'message') {
        const m = item as Message;
        const dateObj = m.timestamp?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const type = m.isQuestion ? '<b>[QUESTION]</b> ' : '';
        const likes = m.likes ? ` (Likes: ${m.likes})` : '';
        const email = m.userEmail ? `, <a href="mailto:${m.userEmail}">${m.userEmail}</a>` : '';
        return `<p style="margin-bottom: 16px;">${dateStr}, ${timeStr}, <b>${m.userName}</b>${email}:<br>&nbsp;&nbsp;&nbsp;&nbsp;${type}${m.text}${likes}</p>`;
      } else if (item.type === 'poll') {
        const p = item as Poll;
        const dateObj = p.createdAt?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const totalVotes = Object.values(p.votes).reduce((a, b) => a + b, 0);
        
        let pollHtml = `<div style="margin-bottom: 24px; padding: 12px; border: 2px solid #ff3e00; background-color: #fff5f2; border-radius: 8px;">`;
        pollHtml += `<p style="margin-top: 0;"><b>[POLL RESULTS]</b> ${dateStr}, ${timeStr}</p>`;
        pollHtml += `<ul style="list-style-type: none; padding-left: 0;">`;
        p.options.forEach(opt => {
          const count = p.votes[opt] || 0;
          const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          pollHtml += `<li style="margin-bottom: 4px;">Option ${opt}: <b>${count} votes</b> (${percentage}%)</li>`;
        });
        pollHtml += `</ul>`;
        pollHtml += `<p style="margin-bottom: 0; font-size: 11px;">Total Votes: ${totalVotes}</p>`;
        pollHtml += `</div>`;
        return pollHtml;
      } else {
        const w = item as WordCloud;
        const dateObj = w.createdAt?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const totalWords = Object.values(w.words || {}).reduce((a, b) => a + b, 0);
        
        let wcHtml = `<div style="margin-bottom: 24px; padding: 12px; border: 2px solid #3b82f6; background-color: #eff6ff; border-radius: 8px;">`;
        wcHtml += `<p style="margin-top: 0;"><b>[WORD CLOUD]</b> ${dateStr}, ${timeStr}</p>`;
        wcHtml += `<p style="margin-bottom: 8px;"><b>Prompt:</b> ${w.prompt}</p>`;
        wcHtml += `<ul style="list-style-type: none; padding-left: 0;">`;
        Object.entries(w.words || {}).forEach(([word, count]) => {
          wcHtml += `<li style="margin-bottom: 4px;">${word}: <b>${count} submissions</b></li>`;
        });
        wcHtml += `</ul>`;
        wcHtml += `<p style="margin-bottom: 0; font-size: 11px;">Total Submissions: ${totalWords}</p>`;
        wcHtml += `</div>`;
        return wcHtml;
      }
    }).join('');
    
    const html = header + "<h1>ActiveDeck Chat & Poll Log</h1>" + content + footer;
    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chat-log.doc';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEmailChat = () => {
    const combinedItems = [
      ...messages.map(m => ({ ...m, type: 'message' as const })),
      ...polls.map(p => ({ ...p, type: 'poll' as const })),
      ...wordClouds.map(w => ({ ...w, type: 'wordCloud' as const }))
    ].sort((a, b) => {
      const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
      const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
      return timeA - timeB;
    });

    const content = combinedItems.map(item => {
      if (item.type === 'message') {
        const m = item as Message;
        const dateObj = m.timestamp?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const type = m.isQuestion ? '[QUESTION] ' : '';
        const likes = m.likes ? ` (Likes: ${m.likes})` : '';
        const email = m.userEmail ? `, ${m.userEmail}` : '';
        return `${dateStr}, ${timeStr}, ${m.userName}${email}:\n     ${type}${m.text}${likes}`;
      } else if (item.type === 'poll') {
        const p = item as Poll;
        const dateObj = p.createdAt?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const totalVotes = Object.values(p.votes).reduce((a, b) => a + b, 0);
        
        let pollText = `[POLL RESULTS] ${dateStr}, ${timeStr}\n`;
        p.options.forEach(opt => {
          const count = p.votes[opt] || 0;
          const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          pollText += `  Option ${opt}: ${count} votes (${percentage}%)\n`;
        });
        pollText += `Total Votes: ${totalVotes}`;
        return pollText;
      } else {
        const w = item as WordCloud;
        const dateObj = w.createdAt?.toDate();
        const dateStr = dateObj ? dateObj.toLocaleDateString() : '';
        const timeStr = dateObj ? dateObj.toLocaleTimeString() : '';
        const totalWords = Object.values(w.words || {}).reduce((a, b) => a + b, 0);
        
        let wcText = `[WORD CLOUD] ${dateStr}, ${timeStr}\n`;
        wcText += `Prompt: ${w.prompt}\n`;
        Object.entries(w.words || {}).forEach(([word, count]) => {
          wcText += `  ${word}: ${count} submissions\n`;
        });
        wcText += `Total Submissions: ${totalWords}`;
        return wcText;
      }
    }).join('\n\n');
    
    const subject = encodeURIComponent('ActiveDeck Chat & Poll Log');
    const body = encodeURIComponent('Here is the chat and poll log from your presentation:\n\n' + content);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleToggleAnonymousChat = async () => {
    if (!presentation?.id || !canModerate) return;
    try {
      await updateDoc(doc(db, 'presentations', presentation.id), {
        allowAnonymousChat: !presentation.allowAnonymousChat
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `presentations/${presentation.id}`);
    }
  };

  const handleCreateWordCloud = async () => {
    if (!presentation?.id || !canModerate || !wordCloudPrompt.trim()) return;
    try {
      await addDoc(collection(db, 'wordClouds'), {
        presentationId: presentation.id,
        prompt: wordCloudPrompt.trim(),
        words: {},
        participants: {},
        createdAt: serverTimestamp(),
        active: true,
        showResults: false
      });
      setShowWordCloudModal(false);
      setWordCloudPrompt('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'wordClouds');
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

  const handleCreatePoll = async () => {
    if (!presentation?.id || !canModerate) return;
    try {
      await addDoc(collection(db, 'polls'), {
        presentationId: presentation.id,
        options: ['A', 'B', 'C', 'D', 'E'],
        votes: { 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0 },
        voters: {},
        createdAt: serverTimestamp(),
        active: true,
        showResults: false
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'polls');
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

      {/* Chat Header */}
      <div className="p-4 bg-osu-black text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-osu-orange" />
          <div className="flex flex-col">
            <h2 className="font-bold tracking-tight uppercase text-sm leading-none">ActiveDeck Chat</h2>
            {canModerate && (
              <span className="text-[8px] font-black text-osu-orange uppercase tracking-[0.2em] mt-1">
                Moderator Mode Active
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canModerate && (
            <>
              <button 
                onClick={handleToggleAnonymousChat}
                className={cn(
                  "px-2 py-1 rounded transition-colors flex items-center gap-1.5 text-xs font-medium",
                  presentation?.allowAnonymousChat 
                    ? "text-yellow-500 hover:bg-slate-800 hover:text-yellow-400" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
                title={presentation?.allowAnonymousChat ? "Anonymous Chat Allowed" : "Email Required for Chat"}
              >
                {presentation?.allowAnonymousChat ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                <span className="hidden sm:inline">
                  {presentation?.allowAnonymousChat ? "Anon Allowed" : "Email Required"}
                </span>
              </button>
              <button 
                onClick={handleDownloadWord}
                className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white"
                title="Download as Word"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={handleEmailChat}
                className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white"
                title="Email Chat Log"
              >
                <Mail className="w-4 h-4" />
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
          <button 
            onClick={() => setShowQR(!showQR)}
            className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white"
            title="Toggle QR Code"
          >
            <QrCode className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Embedded QR Code Section */}
      {showQR && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-row items-start gap-3 animate-in slide-in-from-top duration-300">
          <div className="bg-white p-1.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
            <QRCodeSVG 
              value={chatOnlyUrl} 
              size={80}
              level="M"
            />
          </div>
          <div className="flex flex-col justify-center min-w-0 py-1">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Scan to Join Chat</p>
            <div className="bg-slate-200/50 rounded px-2 py-1 truncate mb-2">
              <p className="text-[11px] text-slate-700 font-mono font-bold select-all truncate">
                {shortUrl || chatOnlyUrl}
              </p>
            </div>
            {canModerate && (
              <div className="flex items-stretch gap-2 mt-2">
                <button 
                  onClick={handleCreatePoll}
                  className="flex-1 flex flex-col items-center justify-center px-3 py-2 bg-osu-orange text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-[#c03900] transition-all shadow-sm leading-tight"
                >
                  <span>New</span>
                  <span>Poll</span>
                </button>
                <button 
                  onClick={() => setShowWordCloudModal(true)}
                  className="flex-1 flex flex-col items-center justify-center px-3 py-2 bg-blue-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-blue-600 transition-all shadow-sm leading-tight"
                >
                  <span>Word</span>
                  <span>Cloud</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages Area Wrapper */}
      <div className="flex-1 relative overflow-hidden bg-white">
        {/* OSU Logo Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 z-0">
          <img 
            src="https://a.espncdn.com/i/teamlogos/ncaa/500/197.png" 
            alt="OSU Logo Watermark" 
            className="w-3/4 object-contain" 
            referrerPolicy="no-referrer" 
          />
        </div>

        {/* Messages Area */}
        <div 
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto p-4 space-y-4 z-10"
        >
          {messages.length === 0 && polls.length === 0 && wordClouds.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
              <MessageSquare className="w-8 h-8 mb-2" />
              <p className="text-xs font-medium">No messages yet</p>
            </div>
          )}

          {/* Render Polls, Word Clouds, and Messages interleaved by time */}
          {[...messages.map(m => ({ ...m, type: 'message' as const })), 
            ...polls.map(p => ({ ...p, type: 'poll' as const })),
            ...wordClouds.map(w => ({ ...w, type: 'wordCloud' as const }))]
            .sort((a, b) => {
              const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
              const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
              return timeA - timeB;
            })
            .map((item) => {
              if (item.type === 'poll') {
                const poll = item as Poll;
                const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
                const userVote = user && poll.voters ? poll.voters[user.uid] : null;

                return (
                  <div key={poll.id} className="p-4 rounded-xl border-2 border-osu-orange bg-white shadow-lg animate-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-4 h-4 text-osu-orange" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Multiple Choice Poll</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {canModerate && (
                          <>
                            <button 
                              onClick={() => handleToggleResults(poll.id, !!poll.showResults)}
                              className={cn(
                                "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors border",
                                poll.showResults 
                                  ? "bg-osu-orange text-white border-osu-orange" 
                                  : "bg-white text-slate-500 border-slate-200 hover:border-osu-orange hover:text-osu-orange"
                              )}
                              title={poll.showResults ? "Hide Results from Audience" : "Show Results to Audience"}
                            >
                              {poll.showResults ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                              {poll.showResults ? "Results Visible" : "Results Hidden"}
                            </button>
                            {poll.active ? (
                              <button onClick={() => handleClosePoll(poll.id)} className="p-1 text-slate-400 hover:text-red-500" title="Close Poll">
                                <XCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className="text-[8px] font-bold text-red-500 uppercase">Closed</span>
                            )}
                            <button onClick={() => handleDeletePoll(poll.id)} className="p-1 text-slate-400 hover:text-red-500" title="Delete Poll">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {poll.options.map(opt => {
                        const count = poll.votes[opt] || 0;
                        const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                        const isSelected = userVote === opt;

                        return (
                          <div key={opt} className="relative">
                            <button
                              disabled={!poll.active || !!userVote || !isChatOnly}
                              onClick={() => handleVote(poll.id, opt)}
                              className={cn(
                                "w-full relative overflow-hidden flex items-center justify-between px-4 py-2 rounded-lg border transition-all",
                                isSelected ? "border-osu-orange bg-orange-50" : "border-slate-200 hover:border-osu-orange/50 bg-white",
                                !poll.active && "opacity-80 cursor-default"
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
                                <span className={cn("w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold", isSelected ? "bg-osu-orange text-white" : "bg-slate-100 text-slate-600")}>
                                  {opt}
                                </span>
                                {isSelected && <CheckCircle2 className="w-3 h-3 text-osu-orange" />}
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
                    
                    <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{totalVotes} Total Votes</span>
                      {!poll.active && <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">Final Results</span>}
                    </div>
                  </div>
                );
              } else if (item.type === 'wordCloud') {
                return (
                  <WordCloudCard
                    key={item.id}
                    cloud={item as WordCloud}
                    canModerate={canModerate}
                    isChatOnly={isChatOnly}
                    user={user}
                    onToggleResults={handleToggleWordCloudResults}
                    onClose={handleCloseWordCloud}
                    onDelete={handleDeleteWordCloud}
                    onSubmit={handleWordCloudSubmit}
                  />
                );
              }

              const msg = item as Message;
              return (
                <div 
                  key={msg.id}
                  className="p-3 rounded-xl border border-orange-200 bg-orange-50 shadow-md transition-all relative"
                >
            <div className="flex items-start justify-between mb-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                  {msg.userName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLikeMessage(msg)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors border",
                    (msg.likes || 0) > 0 
                      ? "bg-yellow-400 text-slate-900 border-yellow-500 shadow-sm" 
                      : "bg-white/60 text-slate-500 border-transparent hover:bg-white hover:text-slate-700"
                  )}
                  title={msg.likedBy?.includes(user?.uid || '') ? "Unlike" : "Like"}
                >
                  <ThumbsUp className={cn("w-3 h-3", msg.likedBy?.includes(user?.uid || '') && "fill-current")} />
                  {msg.likes || 0}
                </button>
                {(user?.uid === msg.userId || canModerate) && (
                  <button
                    onClick={() => handleDeleteMessage(msg.id)}
                    className="p-1 text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                    title="Delete Message"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">
              {msg.text}
            </p>
            <div className="mt-2 text-[9px] text-slate-400 text-right">
              {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        );
      })}
    </div>
  </div>

      {/* Input Area - Only visible for audience members (isChatOnly) */}
      {isChatOnly && (
        <div className="bg-white border-t border-slate-200 shrink-0 pb-[env(safe-area-inset-bottom)]">
          {user?.isAnonymous && (!hasJoined || (!presentation?.allowAnonymousChat && !guestEmail)) ? (
            <form onSubmit={handleJoin} className="p-4 flex flex-col gap-3">
              <div className="text-center mb-1">
                <h3 className="text-sm font-bold text-slate-900">Join the Discussion</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {presentation?.allowAnonymousChat 
                    ? "Enter your details, or join anonymously." 
                    : "Enter your email to join the discussion."}
                </p>
              </div>
              <input
                type="text"
                placeholder="Your Name (optional)"
                value={joinNameInput}
                onChange={(e) => setJoinNameInput(e.target.value)}
                className="w-full px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
              />
              <input
                type="email"
                placeholder={presentation?.allowAnonymousChat ? "Email address (optional)" : "Email address (required)"}
                value={joinEmailInput}
                onChange={(e) => setJoinEmailInput(e.target.value)}
                required={!presentation?.allowAnonymousChat}
                className="w-full px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
              />
              <button
                type="submit"
                className="w-full bg-osu-orange text-white font-bold py-2 px-4 rounded-md hover:bg-[#c03900] transition-colors text-sm"
              >
                {!presentation?.allowAnonymousChat || joinEmailInput || joinNameInput ? 'Join Chat' : 'Join Anonymously'}
              </button>
            </form>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              {user?.isAnonymous && (
                <div className="flex justify-between items-start px-1">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-500">
                      Posting as: <span className="font-semibold text-slate-700">
                        {isPostingAnonymously 
                          ? `Anonymous ${user.uid.slice(0, 4)}` 
                          : (guestName || (guestEmail ? guestEmail.split('@')[0] : `Guest ${user.uid.slice(0, 4)}`))}
                      </span>
                    </span>
                    {(guestName || guestEmail) && (
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
                    Change
                  </button>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  className="flex-1 min-w-0 px-3 py-2 text-base border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button
                  type="submit"
                  className="shrink-0 p-2 bg-osu-black text-white rounded-md hover:bg-slate-800 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
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
                onClick={handleCreateWordCloud}
                disabled={!wordCloudPrompt.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Create Word Cloud
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
