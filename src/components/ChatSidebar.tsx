import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, getDocFromServer, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove, increment, where, writeBatch } from 'firebase/firestore';
import { Message, Presentation } from '../types';
import { useAuth } from './AuthProvider';
import { Send, HelpCircle, MessageSquare, QrCode, Trash2, LogIn, LogOut, ThumbsUp, Download, Mail } from 'lucide-react';
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

interface ChatSidebarProps {
  isChatOnly?: boolean;
  presentation?: Presentation | null;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isChatOnly = false, presentation = null }) => {
  const { user } = useAuth();
  const isPresenter = user?.uid === presentation?.presenterId;
  // Faculty/Moderators are guests in the main view (not isChatOnly)
  const isMainViewModerator = !isChatOnly;
  const canModerate = true; // Everyone can moderate (delete messages)

  console.log('ChatSidebar Render - User:', user?.email || 'Guest', 'isPresenter:', isPresenter, 'isMainViewModerator:', isMainViewModerator);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [showQR, setShowQR] = useState(!isChatOnly);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [hasJoined, setHasJoined] = useState(() => {
    return localStorage.getItem('activeDeckJoined') === 'true';
  });
  const [guestEmail, setGuestEmail] = useState(() => {
    return localStorage.getItem('activeDeckGuestEmail') || '';
  });
  const [joinEmailInput, setJoinEmailInput] = useState('');

  // Construct chat-only URL for QR code
  const baseUrl = window.location.origin + window.location.pathname;
  const chatOnlyUrl = presentation?.id ? `${baseUrl}?view=chat&id=${presentation.id}` : `${baseUrl}?view=chat`;

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

    return () => unsubscribe();
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
      const userName = user.isAnonymous 
        ? (guestEmail ? guestEmail.split('@')[0] : `Guest ${user.uid.slice(0, 4)}`) 
        : user.displayName || 'User';

      const messageData: any = {
        text: inputText,
        userId: user.uid,
        userName: userName,
        timestamp: serverTimestamp(),
        isQuestion: isQuestion,
        presentationId: presentation?.id || 'default',
        presenterId: presentation?.presenterId || 'default',
      };

      if (emailToSave) {
        messageData.userEmail = emailToSave;
      }

      await addDoc(collection(db, 'messages'), messageData);
      setInputText('');
      setIsQuestion(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'messages');
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setGuestEmail(joinEmailInput);
    setHasJoined(true);
    localStorage.setItem('activeDeckJoined', 'true');
    if (joinEmailInput) {
      localStorage.setItem('activeDeckGuestEmail', joinEmailInput);
    }
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
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Chat Log</title></head><body>";
    const footer = "</body></html>";
    const content = messages.map(m => {
      const time = m.timestamp?.toDate().toLocaleString() || '';
      const type = m.isQuestion ? '<b>[QUESTION]</b> ' : '';
      const likes = m.likes ? ` (Likes: ${m.likes})` : '';
      const email = m.userEmail ? ` &lt;${m.userEmail}&gt;` : '';
      return `<p><i>${time}</i> <b>${m.userName}${email}</b>: ${type}${m.text}${likes}</p>`;
    }).join('');
    
    const html = header + "<h1>ActiveDeck Chat Log</h1>" + content + footer;
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
    const content = messages.map(m => {
      const time = m.timestamp?.toDate().toLocaleString() || '';
      const type = m.isQuestion ? '[QUESTION] ' : '';
      const likes = m.likes ? ` (Likes: ${m.likes})` : '';
      const email = m.userEmail ? ` <${m.userEmail}>` : '';
      return `[${time}] ${m.userName}${email}: ${type}${m.text}${likes}`;
    }).join('\n\n');
    
    const subject = encodeURIComponent('ActiveDeck Chat Log');
    const body = encodeURIComponent('Here is the chat log from your presentation:\n\n' + content);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden bg-white shadow-xl border-l border-slate-200 relative">
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
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col items-center text-center animate-in slide-in-from-top duration-300">
          <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm mb-2">
            <QRCodeSVG 
              value={chatOnlyUrl} 
              size={120}
              level="M"
            />
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Scan to Join Chat</p>
          <p className="text-[9px] text-slate-400 font-mono truncate w-full px-4">{chatOnlyUrl}</p>
        </div>
      )}

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-white"
      >
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-xs font-medium">No messages yet</p>
          </div>
        )}
        {messages.map((msg) => (
          <div 
            key={msg.id}
            className={cn(
              "p-3 rounded-lg border transition-all",
              msg.isQuestion 
                ? "bg-orange-50 border-osu-orange/30 shadow-sm" 
                : "bg-slate-50 border-slate-100"
            )}
          >
            <div className="flex items-start justify-between mb-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                  {msg.userName}
                </span>
                {msg.isQuestion && (
                  <span className="flex items-center gap-1 text-[9px] font-black text-white uppercase bg-osu-orange px-1.5 py-0.5 rounded mt-1 self-start">
                    <HelpCircle className="w-2.5 h-2.5" />
                    Question
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLikeMessage(msg)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors",
                    msg.likedBy?.includes(user?.uid || '') 
                      ? "bg-indigo-100 text-indigo-600" 
                      : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
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
        ))}
      </div>

      {/* Input Area - Only visible for audience members (isChatOnly) */}
      {isChatOnly && (
        <div className="bg-white border-t border-slate-200">
          {user?.isAnonymous && !hasJoined ? (
            <form onSubmit={handleJoin} className="p-4 flex flex-col gap-3">
              <div className="text-center mb-1">
                <h3 className="text-sm font-bold text-slate-900">Join the Discussion</h3>
                <p className="text-xs text-slate-500 mt-1">Enter your email for follow-ups, or join anonymously.</p>
              </div>
              <input
                type="email"
                placeholder="Email address (optional)"
                value={joinEmailInput}
                onChange={(e) => setJoinEmailInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
              />
              <button
                type="submit"
                className="w-full bg-osu-orange text-white font-bold py-2 px-4 rounded-md hover:bg-[#c03900] transition-colors text-sm"
              >
                {joinEmailInput ? 'Join with Email' : 'Join Anonymously'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSendMessage} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setIsQuestion(!isQuestion)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all border",
                    isQuestion 
                      ? "bg-osu-orange text-white border-osu-orange" 
                      : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                  )}
                >
                  <HelpCircle className="w-2.5 h-2.5" />
                  Flag Question
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-osu-orange"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button
                  type="submit"
                  className="p-2 bg-osu-black text-white rounded-md hover:bg-slate-800 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
