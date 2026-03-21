# Implementation Plan: Vibe-Coded Presentation Hub

## 1. Firebase Schema (Firestore)

### Collection: `presentations`
- `id`: string (document ID)
- `embedUrl`: string (Microsoft Office Web Viewer URL)
- `presenterId`: string (UID of the presenter)
- `createdAt`: timestamp

### Collection: `messages`
- `id`: string (document ID)
- `text`: string
- `userId`: string (UID of the sender)
- `userName`: string
- `timestamp`: timestamp
- `isQuestion`: boolean (flag for audience questions)

## 2. Component Structure

- `App.tsx`: Main layout container (80/20 split).
- `PresenterArea.tsx`: Handles the PowerPoint iframe and URL input.
- `ChatSidebar.tsx`: Real-time chat interface with auto-scroll.
- `ChatMessage.tsx`: Individual message component with question styling.
- `FirebaseProvider.tsx`: Context provider for Firebase auth and DB instances.

## 3. Technical Details
- **Aesthetic**: Medical Academic (Slate/Navy/Deep Orange).
- **Auth**: Firebase Anonymous Auth for quick audience participation.
- **Real-time**: `onSnapshot` for chat messages, ordered by `timestamp`.
- **Auto-scroll**: `useRef` and `useEffect` to scroll to the bottom of the chat container.

## 4. Security Rules
- `messages`: Anyone authenticated can read and create.
- `presentations`: Anyone authenticated can read; only the owner can update.
