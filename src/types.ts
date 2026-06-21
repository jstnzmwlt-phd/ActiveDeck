import { Timestamp } from 'firebase/firestore';

export interface Theme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
}

export interface SavedTheme {
  id: string;
  name: string;
  theme: Theme;
  domain?: string;
}

export interface GlobalSettings {
  theme: Theme;
  activeInstitutionId?: string;
  activeInstitutionName?: string;
  activeInstitutionDomain?: string;
  showAttendance?: boolean;
}

export interface Presentation {
  id: string;
  embedUrl: string;
  presenterId: string;
  createdAt: Timestamp;
  allowAnonymousChat?: boolean;
  disableAttendance?: boolean;
  pinCode?: string;
  hideComments?: boolean;
  currentSlide?: number;
  theme?: Theme;
  currentIcon?: string;
  previousIcon?: string;
  iconRotatedAt?: number;
  lastManualActivityAt?: number;
  hasActivity?: boolean;
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
  slide?: number;
  isPinned?: boolean;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
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
  started?: boolean;
  showResults?: boolean;
  slide?: number;
  correctAnswer?: string;
}

export interface OpenEndedQuestion {
  id: string;
  presentationId: string;
  prompt: string;
  responses: Record<string, string>;
  createdAt: Timestamp;
  active: boolean;
  started?: boolean;
  showResults?: boolean;
  expiresAt?: Timestamp;
  duration?: number;
  slide?: number;
}

export interface WordCloud {
  id: string;
  presentationId: string;
  prompt: string;
  words: Record<string, number>;
  participants: Record<string, boolean>;
  createdAt: Timestamp;
  active: boolean;
  started?: boolean;
  showResults?: boolean;
  slide?: number;
}

export interface WhitelistedPresenter {
  email: string;
  addedAt: Timestamp;
  usageCount: number;
  lastUsedAt: Timestamp | null;
}

declare global {
  interface Window {
    Office: any;
  }
}
