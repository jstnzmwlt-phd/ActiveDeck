import React, { useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, getDocFromServer, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove, increment } from 'firebase/firestore';
import { Message, Presentation } from '../types';
import { useAuth } from './AuthProvider';
import { Send, HelpCircle, MessageSquare, QrCode, Trash2, LogIn, LogOut, ThumbsUp } from 'lucide-react';
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Construct chat-only URL for QR code
  const baseUrl = window.location.origin + window.location.pathname;
  const chatOnlyUrl = `${baseUrl}?view=chat`;

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

    const q = query(collection(db, 'messages'), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data({ serverTimestamps: 'estimate' })
      })) as Message[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'messages');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    try {
      await addDoc(collection(db, 'messages'), {
        text: inputText,
        userId: user.uid,
        userName: user.isAnonymous ? `Guest ${user.uid.slice(0, 4)}` : user.displayName || 'User',
        timestamp: serverTimestamp(),
        isQuestion: isQuestion,
        presentationId: presentation?.id || 'default',
        presenterId: presentation?.presenterId || 'default',
      });
      setInputText('');
      setIsQuestion(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'messages');
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

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden bg-white shadow-xl border-l border-slate-200">
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
        <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200">
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
  );
};
