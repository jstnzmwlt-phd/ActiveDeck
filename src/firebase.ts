import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.js';

let app: any;
let authInstance: any;
let dbInstance: any;

export const getFirebase = () => {
    if (!app) {
        app = initializeApp(firebaseConfig);
        authInstance = getAuth(app);
        dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
    return { app, auth: authInstance, db: dbInstance };
};

export const { auth, db } = (() => {
    // This is still needed for existing imports, but they might need to be refactored.
    // For now, let's keep it working as it was but lazy-initialize on first access if possible,
    // although this pattern is tricky for top-level exports.
    // Let's stick with the lazy getter for better practice.
    return {
        get auth() { return getFirebase().auth; },
        get db() { return getFirebase().db; }
    };
})();
