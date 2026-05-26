import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
  "projectId": "activedeck",
  "appId": "1:623901782998:web:a88ca060e95fbe70d9ea77",
  "apiKey": process.env.VITE_FIREBASE_API_KEY,
  "authDomain": "activedeck.firebaseapp.com",
  "storageBucket": "activedeck.firebasestorage.app",
  "messagingSenderId": "623901782998",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function run() {
  console.log("Attempting unauthenticated read of settings/global...");
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    console.log("Unauthenticated read succeeded! Data:", JSON.stringify(snap.data(), null, 2));
  } catch (err) {
    console.error("Unauthenticated read FAILED:", err.message);
  }

  console.log("Attempting anonymous authentication...");
  try {
    const userCred = await signInAnonymously(auth);
    console.log("Anonymous auth succeeded! UID:", userCred.user.uid);
    const snap = await getDoc(doc(db, 'settings', 'global'));
    console.log("Authenticated read succeeded! Data:", JSON.stringify(snap.data(), null, 2));
  } catch (err) {
    console.error("Authenticated read/auth FAILED:", err.message);
  }
}

run();
