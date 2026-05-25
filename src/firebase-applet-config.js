const getEnvValue = (key, fallback) => {
  const val = import.meta.env[key] || (typeof window !== "undefined" ? window[key] : undefined);
  if (!val || val === "activedeck") return fallback;
  return val;
};

export default {
  "projectId": getEnvValue("VITE_FIREBASE_PROJECT_ID", "exam-genais-saas-7128815-eaacf"),
  "appId": getEnvValue("VITE_FIREBASE_APP_ID", "1:117214307994:web:0adb6140df1b13ae60a123"),
  "apiKey": getEnvValue("VITE_FIREBASE_API_KEY", "AIzaSyAERIULyxU8GXRVOyasFbMR0Gu_OlAFnK4"),
  "authDomain": getEnvValue("VITE_FIREBASE_AUTH_DOMAIN", "exam-genais-saas-7128815-eaacf.firebaseapp.com"),
  "firestoreDatabaseId": "(default)",
  "storageBucket": getEnvValue("VITE_FIREBASE_STORAGE_BUCKET", "exam-genais-saas-7128815-eaacf.firebasestorage.app"),
  "messagingSenderId": getEnvValue("VITE_FIREBASE_MESSAGING_SENDER_ID", "117214307994"),
  "measurementId": ""
};


