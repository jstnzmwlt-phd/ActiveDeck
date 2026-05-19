export default {
  "projectId": import.meta.env.VITE_FIREBASE_PROJECT_ID || (typeof window !== "undefined" ? window.VITE_FIREBASE_PROJECT_ID : undefined),
  "appId": import.meta.env.VITE_FIREBASE_APP_ID || (typeof window !== "undefined" ? window.VITE_FIREBASE_APP_ID : undefined),
  "apiKey": import.meta.env.VITE_FIREBASE_API_KEY || (typeof window !== "undefined" ? window.VITE_FIREBASE_API_KEY : undefined),
  "authDomain": import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (typeof window !== "undefined" ? window.VITE_FIREBASE_AUTH_DOMAIN : undefined),
  "firestoreDatabaseId": "(default)",
  "storageBucket": import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (typeof window !== "undefined" ? window.VITE_FIREBASE_STORAGE_BUCKET : undefined),
  "messagingSenderId": import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof window !== "undefined" ? window.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined),
  "measurementId": ""
};

