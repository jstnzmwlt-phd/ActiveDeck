import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, onSnapshot, deleteDoc, query, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Theme, SavedTheme } from '../types';
import { Palette, UserCheck, Download, ArrowLeft, Loader2, Calendar, Database, Search } from 'lucide-react';

interface AdminPortalProps {
  presentationId?: string | null;
}

interface StudentAttendanceRecord {
  id: string;
  name: string;
  email: string;
  checkedInAt: Timestamp | null;
  scannedToken: string;
}

interface RecentPresentationRecord {
  id: string;
  createdAt: Timestamp | null;
  presenterId: string;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ presentationId }) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'attendance'>('theme');
  const [primaryColor, setPrimaryColor] = useState('#FF6600');
  const [secondaryColor, setSecondaryColor] = useState('#000000');
  const [logoUrl, setLogoUrl] = useState('');
  const [loadingTheme, setLoadingTheme] = useState(true);
  const [savedThemes, setSavedThemes] = useState<SavedTheme[]>([]);
  const [newThemeName, setNewThemeName] = useState('');

  // Attendance Tracker States
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(presentationId || null);
  const [recentSessions, setRecentSessions] = useState<RecentPresentationRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [attendanceList, setAttendanceList] = useState<StudentAttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [customSessionInput, setCustomSessionInput] = useState('');

  // Fetch Global Theme and Saved Themes (Initial Load)
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
      setLoadingTheme(false);
    };
    
    const unsub = onSnapshot(collection(db, 'savedThemes'), (snapshot) => {
      const themes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SavedTheme[];
      setSavedThemes(themes);
    });
    
    fetchSettings();
    return () => unsub();
  }, []);

  // Attendance Tracker: Fetch recent presentation sessions if no active presentation is bound
  useEffect(() => {
    if (activeTab !== 'attendance' || selectedSessionId) return;

    setLoadingSessions(true);
    const qSessions = query(
      collection(db, 'presentations'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const sessions = snapshot.docs.map(doc => ({
        id: doc.id,
        createdAt: doc.data().createdAt || null,
        presenterId: doc.data().presenterId || ''
      })) as RecentPresentationRecord[];
      setRecentSessions(sessions);
      setLoadingSessions(false);
    }, (error) => {
      console.error("Error loading recent sessions:", error);
      setLoadingSessions(false);
    });

    return () => unsubSessions();
  }, [activeTab, selectedSessionId]);

  // Attendance Tracker: Subscribe to real-time check-ins for the active presentation session
  useEffect(() => {
    if (!selectedSessionId || activeTab !== 'attendance') {
      setAttendanceList([]);
      return;
    }

    setLoadingAttendance(true);
    const attendanceRef = collection(db, 'presentations', selectedSessionId, 'attendance');
    const qAttendance = query(attendanceRef, orderBy('checkedInAt', 'desc'));

    const unsubAttendance = onSnapshot(qAttendance, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || '',
        email: doc.data().email || '',
        checkedInAt: doc.data().checkedInAt || null,
        scannedToken: doc.data().scannedToken || ''
      })) as StudentAttendanceRecord[];
      setAttendanceList(list);
      setLoadingAttendance(false);
    }, (error) => {
      console.error("Error listening to attendance snapshot:", error);
      setLoadingAttendance(false);
    });

    return () => unsubAttendance();
  }, [selectedSessionId, activeTab]);

  // Handle saving the global active theme or a custom user theme
  const handleSaveTheme = async (isNew: boolean = false) => {
    const themeData = { primaryColor, secondaryColor, logoUrl };
    
    try {
      if (isNew) {
        if (!newThemeName.trim()) return alert('Theme Name is required');
        await addDoc(collection(db, 'savedThemes'), { name: newThemeName.trim(), theme: themeData });
        setNewThemeName(''); 
        alert('Theme saved!');
      } else {
        await setDoc(doc(db, 'settings', 'global'), { theme: themeData }, { merge: true });
        alert('Active Theme successfully updated!');
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

  const handleDeleteTheme = async (themeId: string) => {
    if (!confirm('Are you sure you want to delete this theme?')) return;
    try {
      await deleteDoc(doc(db, 'savedThemes', themeId));
    } catch (e) {
      console.error("Error deleting theme:", e);
      alert("Error deleting theme: " + e);
    }
  };

  // CSV Exporter for attendance sheet
  const handleDownloadCSV = () => {
    if (attendanceList.length === 0 || !selectedSessionId) return;

    const headers = ["Student Name", "Email Address", "Check-In Timestamp", "Scanned Token ID"];
    const rows = attendanceList.map(record => {
      const timestampString = record.checkedInAt 
        ? new Date(record.checkedInAt.seconds * 1000).toLocaleString() 
        : 'Pending Server Timestamp...';
      return [
        `"${record.name.replace(/"/g, '""')}"`,
        `"${record.email.replace(/"/g, '""')}"`,
        `"${timestampString}"`,
        `"${record.scannedToken}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `activedeck_attendance_session_${selectedSessionId.substring(0, 8)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loadingTheme) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <Loader2 className="w-10 h-10 text-osu-orange animate-spin mb-4" />
        <p className="text-xs font-black uppercase tracking-wider opacity-60">Loading Admin Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      
      {/* Premium Top Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6 text-osu-orange" />
          <h1 className="text-xl font-black tracking-wide uppercase">ActiveDeck Admin</h1>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === 'theme' 
                ? 'bg-osu-orange text-white shadow-lg shadow-orange-500/10' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-4 h-4" />
            Theme Builder
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === 'attendance' 
                ? 'bg-osu-orange text-white shadow-lg shadow-orange-500/10' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            Attendance Tracker
          </button>
        </div>

        {/* Return to App Button */}
        <button 
          onClick={() => {
            window.location.hash = '';
            window.dispatchEvent(new Event('hashchange'));
          }}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to App
        </button>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 p-8 flex justify-center overflow-y-auto">
        <div className="w-full max-w-4xl">

          {/* ========================================================
              TAB 1: THEME BUILDER WORKSPACE
              ======================================================== */}
          {activeTab === 'theme' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in duration-300">
              
              {/* Left Column: Color Controls */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6">
                <h2 className="text-lg font-black uppercase tracking-wider border-b border-slate-800 pb-3 text-white flex items-center gap-2">
                  <Palette className="w-5 h-5 text-osu-orange" />
                  Color Customizer
                </h2>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Primary Color (OSU Orange)</label>
                    <div className="flex gap-3">
                      <input 
                        type="color" 
                        value={primaryColor} 
                        onChange={(e) => setPrimaryColor(e.target.value)} 
                        className="w-14 h-11 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer p-1" 
                      />
                      <input 
                        type="text" 
                        value={primaryColor} 
                        onChange={(e) => setPrimaryColor(e.target.value)} 
                        className="flex-1 h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 uppercase font-mono text-white" 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Secondary Color (Navy/Black)</label>
                    <div className="flex gap-3">
                      <input 
                        type="color" 
                        value={secondaryColor} 
                        onChange={(e) => setSecondaryColor(e.target.value)} 
                        className="w-14 h-11 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer p-1" 
                      />
                      <input 
                        type="text" 
                        value={secondaryColor} 
                        onChange={(e) => setSecondaryColor(e.target.value)} 
                        className="flex-1 h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 uppercase font-mono text-white" 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Logo URL</label>
                    <input 
                      type="text" 
                      value={logoUrl} 
                      onChange={(e) => setLogoUrl(e.target.value)} 
                      placeholder="https://example.com/logo.png"
                      className="w-full h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 text-white placeholder-slate-600" 
                    />
                  </div>
                </div>

                <button 
                  onClick={() => handleSaveTheme(false)} 
                  className="w-full h-11 bg-osu-orange text-white font-black uppercase tracking-widest rounded-xl hover:bg-[#c03900] shadow-lg shadow-orange-500/10 transition-colors"
                >
                  Apply Active Global Theme
                </button>
              </div>

              {/* Right Column: Preset Themes list */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-wider border-b border-slate-800 pb-3 text-white mb-6">
                    Saved Themes & Presets
                  </h2>

                  <div className="flex gap-3 mb-6">
                    <input 
                      type="text" 
                      value={newThemeName} 
                      onChange={(e) => setNewThemeName(e.target.value)} 
                      placeholder="Custom Preset Name" 
                      className="flex-1 h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange" 
                    />
                    <button 
                      onClick={() => handleSaveTheme(true)} 
                      className="px-6 h-11 bg-slate-800 hover:bg-slate-750 text-slate-100 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors border border-slate-700/50"
                    >
                      Save Preset
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {savedThemes.length === 0 ? (
                      <p className="text-xs text-slate-500 italic text-center py-8">No custom presets saved yet.</p>
                    ) : (
                      savedThemes.map(t => (
                        <div key={t.id} className="flex justify-between items-center bg-slate-950/80 border border-slate-800/80 p-3 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="flex gap-1">
                              <span className="w-3.5 h-3.5 rounded-full border border-white/10" style={{ backgroundColor: t.theme.primaryColor }} />
                              <span className="w-3.5 h-3.5 rounded-full border border-white/10" style={{ backgroundColor: t.theme.secondaryColor }} />
                            </div>
                            <span className="text-slate-200 text-sm font-bold">{t.name}</span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => loadTheme(t.theme)} 
                              className="px-3.5 py-1.5 bg-osu-orange hover:bg-[#c03900] text-[10px] font-black uppercase tracking-wider text-white rounded-lg transition-colors"
                            >
                              Load
                            </button>
                            <button 
                              onClick={() => handleDeleteTheme(t.id)} 
                              className="px-3.5 py-1.5 bg-red-950/20 hover:bg-red-900 border border-red-500/25 hover:border-red-500/50 text-[10px] font-black uppercase tracking-wider text-red-400 hover:text-white rounded-lg transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="pt-6 border-t border-slate-800 mt-6 text-[10px] text-slate-500 text-center leading-relaxed">
                  Saving a Theme updates the dynamic layout variables of all active presentation interfaces in real-time.
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              TAB 2: ATTENDANCE TRACKER WORKSPACE
              ======================================================== */}
          {activeTab === 'attendance' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* CASE A: No presentation selected - Render Presentation Selector */}
              {!selectedSessionId ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-xl mx-auto space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-12 h-12 bg-osu-orange/10 border border-osu-orange/20 text-osu-orange rounded-2xl flex items-center justify-center mx-auto mb-2">
                      <UserCheck className="w-6 h-6" />
                    </div>
                    <h2 className="text-xl font-black text-white">Select a Presentation Session</h2>
                    <p className="text-xs text-slate-400">Choose a session to display live check-ins and export the attendance list.</p>
                  </div>

                  {/* Manual Session ID input */}
                  <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Search Session ID Manually</label>
                    <div className="flex gap-3">
                      <div className="relative flex-1">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-500">
                          <Search className="w-4 h-4" />
                        </span>
                        <input 
                          type="text" 
                          value={customSessionInput} 
                          onChange={(e) => setCustomSessionInput(e.target.value)} 
                          placeholder="Paste Presentation Session ID..." 
                          className="w-full h-11 bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-osu-orange transition-colors" 
                        />
                      </div>
                      <button 
                        onClick={() => {
                          if (customSessionInput.trim()) {
                            setSelectedSessionId(customSessionInput.trim());
                          }
                        }}
                        className="px-6 h-11 bg-osu-orange hover:bg-[#c03900] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                      >
                        Monitor
                      </button>
                    </div>
                  </div>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-800"></div>
                    <span className="flex-shrink mx-4 text-[10px] uppercase font-bold tracking-widest text-slate-600 bg-slate-900 px-1">Or Choose Recent</span>
                    <div className="flex-grow border-t border-slate-800"></div>
                  </div>

                  {/* List of Recent Presentations */}
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">Recent Sessions</h3>
                    
                    {loadingSessions ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 text-osu-orange animate-spin mb-2" />
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest">Fetching active sessions...</span>
                      </div>
                    ) : recentSessions.length === 0 ? (
                      <p className="text-xs text-slate-500 italic text-center py-8">No recent presentations found. Create one by clicking "Back to App".</p>
                    ) : (
                      <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                        {recentSessions.map(session => (
                          <button
                            key={session.id}
                            onClick={() => setSelectedSessionId(session.id)}
                            className="w-full flex items-center justify-between p-3.5 bg-slate-950/80 hover:bg-slate-950 border border-slate-800/80 hover:border-osu-orange/40 rounded-2xl text-left transition-all"
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-black text-white font-mono">{session.id}</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                <Calendar className="w-3 h-3" />
                                <span>
                                  {session.createdAt 
                                    ? new Date(session.createdAt.seconds * 1000).toLocaleString() 
                                    : 'N/A'}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-osu-orange bg-osu-orange/10 px-3 py-1.5 rounded-lg border border-osu-orange/20">
                              View Sheet
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (

                // CASE B: Presentation selected - Monitor Live Attendance
                <div className="space-y-6">
                  
                  {/* Dashboard header card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monitoring Session</span>
                      </div>
                      <h2 className="text-lg font-black text-white font-mono break-all">{selectedSessionId}</h2>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span>Total Scanned:</span>
                        <span className="text-white font-bold text-sm bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800">{attendanceList.length} students</span>
                      </div>
                    </div>

                    {/* Dashboard controls */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={handleDownloadCSV}
                        disabled={attendanceList.length === 0}
                        className="flex items-center gap-2 h-11 px-5 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-orange-500/10"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV Sheet
                      </button>
                      
                      <button
                        onClick={() => setSelectedSessionId(null)}
                        className="flex items-center gap-1.5 h-11 px-4 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-bold rounded-xl transition-colors"
                      >
                        Change Session
                      </button>
                    </div>
                  </div>

                  {/* Real-Time Live Roster Table Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-green-500" />
                      Live Attendance Roster
                    </h3>

                    <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                              <th className="py-3 px-4">Student Name</th>
                              <th className="py-3 px-4">Email Address</th>
                              <th className="py-3 px-4">Checked-In Timestamp</th>
                              <th className="py-3 px-4 text-right">Verification Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loadingAttendance ? (
                              <tr>
                                <td colSpan={4} className="py-16 text-center">
                                  <Loader2 className="w-8 h-8 text-osu-orange animate-spin mx-auto mb-2" />
                                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Retrieving check-ins...</span>
                                </td>
                              </tr>
                            ) : attendanceList.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-16 text-center text-slate-500 text-xs italic">
                                  No students have scanned in yet. Ask your class to scan the QR code to check in.
                                </td>
                              </tr>
                            ) : (
                              attendanceList.map((record) => (
                                <tr key={record.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40 text-sm transition-colors">
                                  <td className="py-3.5 px-4 font-bold text-white">{record.name}</td>
                                  <td className="py-3.5 px-4 text-slate-300 font-medium">{record.email}</td>
                                  <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">
                                    {record.checkedInAt 
                                      ? new Date(record.checkedInAt.seconds * 1000).toLocaleString() 
                                      : 'Registering on server...'}
                                  </td>
                                  <td className="py-3.5 px-4 text-right">
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-green-400 bg-green-500/10 px-2.5 py-1 rounded border border-green-500/20">
                                      Verified Check-In
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
