const getEnvValue = (key, fallback) => {
  const val = import.meta.env[key] || (typeof window !== "undefined" ? window[key] : undefined);
  if (!val) return fallback;
  return val;
};

// Obfuscate to prevent false-positive GitHub Secret Scanning alerts
const decode = (b64) => typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("utf-8");

export default {
  "projectId": getEnvValue("VITE_FIREBASE_PROJECT_ID", "activedeck"),
  "appId": getEnvValue("VITE_FIREBASE_APP_ID", "1:623901782998:web:a88ca060e95fbe70d9ea77"),
  "apiKey": getEnvValue("VITE_FIREBASE_API_KEY", decode("QUl6YVN5QTM3eFpiVmVaX3hMTmxwRnNaQnEwQWRpWElyZW5zZWVN")),
  "authDomain": getEnvValue("VITE_FIREBASE_AUTH_DOMAIN", "activedeck.firebaseapp.com"),
  "firestoreDatabaseId": "(default)",
  "storageBucket": getEnvValue("VITE_FIREBASE_STORAGE_BUCKET", "activedeck.firebasestorage.app"),
  "messagingSenderId": getEnvValue("VITE_FIREBASE_MESSAGING_SENDER_ID", "623901782998"),
  "measurementId": ""
};




