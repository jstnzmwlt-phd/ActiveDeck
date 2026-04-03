import { Timestamp } from 'firebase/firestore';

export interface Presentation {
  id: string;
  embedUrl: string;
  presenterId: string;
  createdAt: Timestamp;
  allowAnonymousChat?: boolean;
  hideComments?: boolean;
}

export interface Message {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userEmail?: string;
  timestamp: Timestamp;
  isQuestion: boolean;
  likes?: number;
  likedBy?: string[];
}

export interface Poll {
  id: string;
  presentationId: string;
  options: string[];
  votes: Record<string, number>;
  voters: Record<string, string>;
  createdAt: Timestamp;
  expiresAt?: Timestamp;
  duration?: number;
  active: boolean;
  showResults?: boolean;
}

export interface WordCloud {
  id: string;
  presentationId: string;
  prompt: string;
  words: Record<string, number>;
  participants: Record<string, boolean>;
  createdAt: Timestamp;
  active: boolean;
  showResults?: boolean;
}

declare global {
  interface Window {
    Office: any;
  }
}
