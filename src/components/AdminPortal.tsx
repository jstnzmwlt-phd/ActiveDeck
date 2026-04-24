import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Theme, SavedTheme } from '../types';

export const AdminPortal: React.FC = () => {
  const [primaryColor, setPrimaryColor] = useState('#FF6600');
  const [secondaryColor, setSecondaryColor] = useState('#000000');
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [savedThemes, setSavedThemes] = useState<SavedTheme[]>([]);
  const [newThemeName, setNewThemeName] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      const docRef = doc(db, 'settings', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data().theme as Theme;
        setPrimaryColor(data.primaryColor);
        setSecondaryColor(data.secondaryColor);
        setLogoUrl(data.logoUrl);
      }
      setLoading(false);
    };
    
    const unsub = onSnapshot(collection(db, 'savedThemes'), (snapshot) => {
      const themes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SavedTheme[];
      setSavedThemes(themes);
    });
    
    fetchSettings();
    return () => unsub();
  }, []);

  const handleSave = async (isNew: boolean = false) => {
    const themeData = { primaryColor, secondaryColor, logoUrl };
    
    try {
      if (isNew) {
        if (!newThemeName.trim()) return alert('Name required');
        await addDoc(collection(db, 'savedThemes'), { name: newThemeName.trim(), theme: themeData });
        setNewThemeName(''); 
        alert('Theme saved!');
      } else {
        await setDoc(doc(db, 'settings', 'global'), { theme: themeData }, { merge: true });
        alert('Theme saved!');
        window.location.reload();
      }
    } catch (e) {
      console.error("Error saving theme:", e);
      alert("Error saving theme: " + e);
    }
  };

  const loadTheme = async (theme: Theme) => {
    setPrimaryColor(theme.primaryColor);
    setSecondaryColor(theme.secondaryColor);
    setLogoUrl(theme.logoUrl);
  };

  const handleDelete = async (themeId: string) => {
    if (!confirm('Are you sure you want to delete this theme?')) return;
    try {
      await deleteDoc(doc(db, 'savedThemes', themeId));
    } catch (e) {
      console.error("Error deleting theme:", e);
      alert("Error deleting theme: " + e);
    }
  };

  if (loading) return null;

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-6">
      <h1 className="text-4xl font-black mb-8 text-white">Admin Portal</h1>
      <div className="bg-slate-900 p-6 rounded-lg w-full max-w-md space-y-4 border border-slate-800">
        <div className="space-y-1">
          <label className="block text-sm text-slate-300">Primary Color</label>
          <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-full h-10 rounded bg-slate-800" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-300">Secondary Color</label>
          <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="w-full h-10 rounded bg-slate-800" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm text-slate-300">Logo URL</label>
          <input type="text" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="w-full h-10 rounded px-2 text-white bg-slate-800 border border-slate-700" />
        </div>
        <button onClick={() => handleSave(false)} className="w-full py-2 bg-osu-orange text-white font-bold rounded-lg hover:bg-[#c03900]">
          Set As Active Theme
        </button>
      </div>
      
      <div className="bg-slate-900 p-6 rounded-lg w-full max-w-md space-y-4 mt-6 border border-slate-800">
        <h2 className="text-xl font-bold text-white">Saved Themes</h2>
        <div className="flex gap-2">
            <input type="text" value={newThemeName} onChange={(e) => setNewThemeName(e.target.value)} placeholder="Theme Name" className="flex-1 h-10 rounded px-2 text-white bg-slate-800 border border-slate-700" />
            <button onClick={() => handleSave(true)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-100">Save</button>
        </div>
        <div className="space-y-2">
          {savedThemes.map(t => (
            <div key={t.id} className="flex justify-between items-center bg-slate-800 p-2 rounded">
              <span className="text-slate-200">{t.name}</span>
              <div className="flex gap-2">
                <button onClick={() => loadTheme(t.theme)} className="px-2 py-1 bg-osu-orange hover:bg-[#c03900] rounded text-xs text-white">Load</button>
                <button onClick={() => handleDelete(t.id)} className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button 
        onClick={() => {
          window.location.hash = '';
          window.dispatchEvent(new Event('hashchange'));
        }}
        className="mt-6 px-6 py-2 bg-slate-800 text-slate-200 font-bold rounded-lg hover:bg-slate-700"
      >
        Back to App
      </button>
    </div>
  );
};
