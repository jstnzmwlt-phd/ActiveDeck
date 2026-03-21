import { Timestamp } from 'firebase/firestore';

export interface Presentation {
  id: string;
  embedUrl: string;
  presenterId: string;
  createdAt: Timestamp;
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
