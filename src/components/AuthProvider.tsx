import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  signInAnonymously, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { auth } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  loading: true,
  signInWithGoogle: async () => {},
  logout: async () => {}
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthProvider - Initializing Auth listener');
    
    // Fallback timeout to prevent infinite loading wheel
    const timeout = setTimeout(() => {
      if (loading) {
        console.warn('AuthProvider - Auth listener timed out, forcing loading to false');
        setLoading(false);
      }
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      clearTimeout(timeout);
      console.log('AuthProvider - Auth state changed:', currentUser?.uid || 'No user');
      if (!currentUser) {
        // Try anonymous auth, but don't block if it fails (likely disabled in console)
        try {
          console.log('AuthProvider - Attempting anonymous sign-in');
          await signInAnonymously(auth);
        } catch (error: any) {
          if (error.code === 'auth/admin-restricted-operation') {
            console.warn("Anonymous auth is disabled in Firebase Console. Please enable it or use Google Sign-In.");
          } else {
            console.error("Anonymous auth failed:", error);
          }
          setLoading(false);
        }
      } else {
        setUser(currentUser);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google sign-in failed:", error);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
