import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  signInAnonymously, 
  onAuthStateChanged
} from 'firebase/auth';
import { auth } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  loading: true
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
      console.log('AuthProvider - Auth state changed:', currentUser?.uid || 'No user', 'isAnonymous:', currentUser?.isAnonymous);
      
      if (!currentUser) {
        // Try anonymous auth
        try {
          console.log('AuthProvider - No user found, attempting anonymous sign-in...');
          const result = await signInAnonymously(auth);
          console.log('AuthProvider - Anonymous sign-in successful:', result.user.uid);
          // onAuthStateChanged will fire again, so we don't need to setUser here
        } catch (error: any) {
          console.error("AuthProvider - Anonymous auth failed:", error.code, error.message);
          if (error.code === 'auth/admin-restricted-operation') {
            console.warn("AuthProvider - Anonymous auth is disabled in Firebase Console.");
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

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
