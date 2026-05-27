import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, onSnapshot, deleteDoc, query, orderBy, limit, Timestamp, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Theme, SavedTheme } from '../types';
import { Palette, UserCheck, Download, ArrowLeft, Loader2, Calendar, Database, AlertCircle, Trash2 } from 'lucide-react';

interface AdminPortalProps {
  presentationId?: string | null;
}

interface StudentAttendanceRecord {
  id: string;
  name: string;
  email: string;
  checkedInAt: Timestamp | null;
  scannedToken: string;
  institutionId?: string;
  institutionName?: string;
  authMethod?: string;
  slide?: number | null;
}

interface RecentPresentationRecord {
  id: string;
  createdAt: Timestamp | null;
  presenterId: string;
  presenterEmail?: string;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ presentationId }) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'attendance' | 'presenters'>('theme');
  const [primaryColor, setPrimaryColor] = useState('#FF6600');
  const [secondaryColor, setSecondaryColor] = useState('#000000');
  const [logoUrl, setLogoUrl] = useState('');
  const [institutionDomain, setInstitutionDomain] = useState('');
  const [loadingInstitution, setLoadingInstitution] = useState(true);
  const [savedInstitutions, setSavedInstitutions] = useState<SavedTheme[]>([]);
  const [newInstitutionName, setNewInstitutionName] = useState('');
  const [activeInstitutionId, setActiveInstitutionId] = useState<string>('custom');
  const [activeInstitutionName, setActiveInstitutionName] = useState<string>('Custom / Active Theme');
  const [attendanceFilter, setAttendanceFilter] = useState<string>('all');

  // Attendance Tracker States
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(presentationId || null);
  const [recentSessions, setRecentSessions] = useState<RecentPresentationRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [attendanceList, setAttendanceList] = useState<StudentAttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [selectedSessionIdsForBulk, setSelectedSessionIdsForBulk] = useState<string[]>([]);
  const [isDeletingSessions, setIsDeletingSessions] = useState(false);

  // Sync selected session with active presentation prop
  useEffect(() => {
    if (presentationId) {
      setSelectedSessionId(presentationId);
    }
  }, [presentationId]);

  // Default attendance filter to active institution once it loads
  useEffect(() => {
    if (activeInstitutionId) {
      setAttendanceFilter(activeInstitutionId);
    }
  }, [activeInstitutionId]);

  // Derived session info for the selected session in history
  const selectedSession = recentSessions.find(s => s.id === selectedSessionId);
  const selectedPresenterEmail = selectedSession?.presenterEmail || '';
  const selectedSessionDate = selectedSession?.createdAt 
    ? new Date(selectedSession.createdAt.seconds * 1000) 
    : null;
  const formattedSelectedDate = selectedSessionDate 
    ? selectedSessionDate.toLocaleString(undefined, { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      })
    : selectedSessionId === presentationId
      ? 'Current Active Session'
      : 'Retrieving Date...';

  // Fetch Global Settings (Institution colors/logo) and Saved Institutions (Initial Load)
  useEffect(() => {
    const fetchSettings = async () => {
      const docRef = doc(db, 'settings', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const theme = data.theme as Theme;
        setPrimaryColor(theme.primaryColor);
        setSecondaryColor(theme.secondaryColor);
        setLogoUrl(theme.logoUrl);
        setActiveInstitutionId(data.activeInstitutionId || 'custom');
        setActiveInstitutionName(data.activeInstitutionName || 'Custom / Active Theme');
        setInstitutionDomain(data.activeInstitutionDomain || '');
      }
      setLoadingInstitution(false);
    };
    
    const unsub = onSnapshot(collection(db, 'savedThemes'), (snapshot) => {
      const themes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SavedTheme[];
      setSavedInstitutions(themes);
    });
    
    fetchSettings();
    return () => unsub();
  }, []);

  // Attendance & Presenter Stats: Fetch recent presentation sessions chronologically
  useEffect(() => {
    if (activeTab !== 'attendance' && activeTab !== 'presenters') return;

    setLoadingSessions(true);
    const qSessions = query(
      collection(db, 'presentations'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );

    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const sessions = snapshot.docs.map(doc => ({
        id: doc.id,
        createdAt: doc.data().createdAt || null,
        presenterId: doc.data().presenterId || '',
        presenterEmail: doc.data().presenterEmail || ''
      })) as RecentPresentationRecord[];
      setRecentSessions(sessions);
      setLoadingSessions(false);

      // Automatically select the most recent session if none is selected yet
      setSelectedSessionId(current => {
        if (current) return current;
        return sessions.length > 0 ? sessions[0].id : null;
      });
    }, (error) => {
      console.error("Error loading recent sessions:", error);
      setLoadingSessions(false);
    });

    return () => unsubSessions();
  }, [activeTab]);

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
        scannedToken: doc.data().scannedToken || '',
        institutionId: doc.data().institutionId || 'custom',
        institutionName: doc.data().institutionName || 'Custom / Active Theme',
        authMethod: doc.data().authMethod || (doc.data().scannedToken ? 'QR' : 'URL'),
        slide: doc.data().slide !== undefined ? doc.data().slide : null
      })) as StudentAttendanceRecord[];
      setAttendanceList(list);
      setLoadingAttendance(false);
    }, (error) => {
      console.error("Error listening to attendance snapshot:", error);
      setLoadingAttendance(false);
    });

    return () => unsubAttendance();
  }, [selectedSessionId, activeTab]);

  // Handle saving the global active institution or a custom user institution
  const handleSaveInstitution = async (isNew: boolean = false) => {
    const themeData = { primaryColor, secondaryColor, logoUrl };
    const domainVal = institutionDomain.trim().toLowerCase();
    
    try {
      if (isNew) {
        if (!newInstitutionName.trim()) return alert('Institution Name is required');
        const docRef = await addDoc(collection(db, 'savedThemes'), { 
          name: newInstitutionName.trim(), 
          theme: themeData,
          domain: domainVal
        });
        setNewInstitutionName(''); 
        alert('Institution saved!');
        setActiveInstitutionId(docRef.id);
        setActiveInstitutionName(newInstitutionName.trim());
      } else {
        await setDoc(doc(db, 'settings', 'global'), { 
          theme: themeData,
          activeInstitutionId,
          activeInstitutionName,
          activeInstitutionDomain: domainVal
        }, { merge: true });
        alert('Active Institution applied successfully! A new presentation session will now start.');
        sessionStorage.removeItem('activePresenterPresentationId');
        window.location.href = window.location.origin + window.location.pathname + '#admin';
      }
    } catch (e) {
      console.error("Error saving institution:", e);
      alert("Error saving institution: " + e);
    }
  };

  const loadInstitution = async (theme: Theme, name: string, id: string, domain?: string) => {
    setPrimaryColor(theme.primaryColor);
    setSecondaryColor(theme.secondaryColor);
    setLogoUrl(theme.logoUrl);
    setActiveInstitutionId(id);
    setActiveInstitutionName(name);
    setInstitutionDomain(domain || '');
  };

  const handleDeleteInstitution = async (themeId: string) => {
    if (!confirm('Are you sure you want to delete this institution?')) return;
    try {
      await deleteDoc(doc(db, 'savedThemes', themeId));
      if (activeInstitutionId === themeId) {
        setActiveInstitutionId('custom');
        setActiveInstitutionName('Custom / Active Theme');
      }
    } catch (e) {
      console.error("Error deleting institution:", e);
      alert("Error deleting institution: " + e);
    }
  };

  // Helper to delete session and all its subcollection documents
  const deleteSessionDoc = async (sessionId: string) => {
    // 1. Delete all attendance check-ins under the session
    const attendanceRef = collection(db, 'presentations', sessionId, 'attendance');
    const attendanceSnap = await getDocs(attendanceRef);
    const attendanceDeletes = attendanceSnap.docs.map(doc => deleteDoc(doc.ref));

    // 2. Delete all attendance tokens under the session
    const tokensRef = collection(db, 'presentations', sessionId, 'attendance_tokens');
    const tokensSnap = await getDocs(tokensRef);
    const tokensDeletes = tokensSnap.docs.map(doc => deleteDoc(doc.ref));

    // Run subcollection deletions in parallel
    await Promise.all([...attendanceDeletes, ...tokensDeletes]);

    // 3. Delete the parent presentation document
    await deleteDoc(doc(db, 'presentations', sessionId));
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (sessionId === presentationId) {
      alert("This is the active live presentation session and cannot be deleted.");
      return;
    }

    if (!confirm('Are you sure you want to delete this session? This will permanently erase the session and all its student attendance check-ins.')) {
      return;
    }

    setIsDeletingSessions(true);
    try {
      await deleteSessionDoc(sessionId);

      // Clean up selection state
      setSelectedSessionIdsForBulk(prev => prev.filter(id => id !== sessionId));

      // If we deleted the currently viewed session, switch to another remaining one
      if (selectedSessionId === sessionId) {
        const remaining = recentSessions.filter(s => s.id !== sessionId);
        if (remaining.length > 0) {
          setSelectedSessionId(remaining[0].id);
        } else {
          setSelectedSessionId(null);
        }
      }
      alert('Session successfully deleted.');
    } catch (e) {
      console.error("Error deleting session:", e);
      alert("Error deleting session: " + e);
    } finally {
      setIsDeletingSessions(false);
    }
  };

  const handleBulkDelete = async () => {
    // Exclude the active presentation ID just to be absolutely safe
    const safeSelectedIds = selectedSessionIdsForBulk.filter(id => id !== presentationId);

    if (safeSelectedIds.length === 0) {
      alert("No eligible sessions selected for deletion. Note: The active live presentation session cannot be deleted.");
      return;
    }

    const confirmMessage = `Are you sure you want to delete the ${safeSelectedIds.length} selected session(s)? This will permanently erase all selected sessions and their student attendance check-ins.`;
    if (!confirm(confirmMessage)) return;

    setIsDeletingSessions(true);
    try {
      // Delete all in parallel
      await Promise.all(safeSelectedIds.map(id => deleteSessionDoc(id)));

      // If the currently viewed session was deleted, switch to a remaining one
      if (selectedSessionId && safeSelectedIds.includes(selectedSessionId)) {
        const remaining = recentSessions.filter(s => !safeSelectedIds.includes(s.id));
        if (remaining.length > 0) {
          setSelectedSessionId(remaining[0].id);
        } else {
          setSelectedSessionId(null);
        }
      }

      // Clear selection states
      setSelectedSessionIdsForBulk([]);
      alert(`Successfully deleted ${safeSelectedIds.length} session(s).`);
    } catch (e) {
      console.error("Error performing bulk deletion:", e);
      alert("Error performing bulk deletion: " + e);
    } finally {
      setIsDeletingSessions(false);
    }
  };

  // Derived state to filter attendance records by selected institution
  const filteredAttendance = attendanceList.filter(record => {
    if (attendanceFilter === 'all') return true;
    return record.institutionId === attendanceFilter;
  });

  // Generate unique options for filter dropdown
  const filterOptions = [
    { id: 'all', name: 'All Check-Ins' }
  ];
  if (activeInstitutionId && activeInstitutionId !== 'custom') {
    filterOptions.push({
      id: activeInstitutionId,
      name: `Active: ${activeInstitutionName}`
    });
  }
  savedInstitutions.forEach(inst => {
    if (inst.id !== activeInstitutionId) {
      filterOptions.push({
        id: inst.id,
        name: inst.name
      });
    }
  });
  filterOptions.push({
    id: 'custom',
    name: 'Custom / Other Themes'
  });

  // CSV Exporter for attendance sheet
  const handleDownloadCSV = () => {
    if (filteredAttendance.length === 0 || !selectedSessionId) return;

     const headers = ["Student Name", "Email Address", "Presenter Email", "Checked-In Timestamp", "Join Method", "Slide", "Institution", "Verification Status"];
     const rows = filteredAttendance.map(record => {
       const timestampString = record.checkedInAt 
         ? new Date(record.checkedInAt.seconds * 1000).toLocaleString() 
         : 'Pending Server Timestamp...';
       const slideString = record.slide !== null && record.slide !== undefined ? `Slide ${record.slide}` : '—';
       return [
         `"${record.name.replace(/"/g, '""')}"`,
         `"${record.email.replace(/"/g, '""')}"`,
         `"${(selectedPresenterEmail || '—').replace(/"/g, '""')}"`,
         `"${timestampString}"`,
         `"${record.authMethod || 'QR'}"`,
         `"${slideString}"`,
         `"${(record.institutionName || 'Custom / Active Theme').replace(/"/g, '""')}"`,
         `"Verified Check-In"`
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

  if (loadingInstitution) {
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
            Institutions
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
          <button
            onClick={() => setActiveTab('presenters')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === 'presenters' 
                ? 'bg-osu-orange text-white shadow-lg shadow-orange-500/10' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
            Presenters
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
        <div className={`w-full transition-all duration-300 ${activeTab === 'attendance' ? 'max-w-[1450px]' : activeTab === 'presenters' ? 'max-w-[1100px]' : 'max-w-5xl'}`}>

          {/* ========================================================
              TAB 1: INSTITUTIONS WORKSPACE
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
                        onChange={(e) => {
                          setPrimaryColor(e.target.value);
                          setActiveInstitutionId('custom');
                          setActiveInstitutionName('Custom / Active Theme');
                        }} 
                        className="w-14 h-11 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer p-1" 
                      />
                      <input 
                        type="text" 
                        value={primaryColor} 
                        onChange={(e) => {
                          setPrimaryColor(e.target.value);
                          setActiveInstitutionId('custom');
                          setActiveInstitutionName('Custom / Active Theme');
                        }} 
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
                        onChange={(e) => {
                          setSecondaryColor(e.target.value);
                          setActiveInstitutionId('custom');
                          setActiveInstitutionName('Custom / Active Theme');
                        }} 
                        className="w-14 h-11 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer p-1" 
                      />
                      <input 
                        type="text" 
                        value={secondaryColor} 
                        onChange={(e) => {
                          setSecondaryColor(e.target.value);
                          setActiveInstitutionId('custom');
                          setActiveInstitutionName('Custom / Active Theme');
                        }} 
                        className="flex-1 h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 uppercase font-mono text-white" 
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Logo URL</label>
                    <input 
                      type="text" 
                      value={logoUrl} 
                      onChange={(e) => {
                        setLogoUrl(e.target.value);
                        setActiveInstitutionId('custom');
                        setActiveInstitutionName('Custom / Active Theme');
                      }} 
                      placeholder="https://example.com/logo.png"
                      className="w-full h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange" 
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Institutional Email Domain</label>
                    <input 
                      type="text" 
                      value={institutionDomain} 
                      onChange={(e) => {
                        setInstitutionDomain(e.target.value);
                        setActiveInstitutionId('custom');
                        setActiveInstitutionName('Custom / Active Theme');
                      }} 
                      placeholder="osu.edu (Optional)"
                      className="w-full h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange" 
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Preset Themes list */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-wider border-b border-slate-800 pb-3 text-white mb-6">
                    Saved Institutions
                  </h2>

                  <div className="flex gap-3 mb-6">
                    <input 
                      type="text" 
                      value={newInstitutionName} 
                      onChange={(e) => setNewInstitutionName(e.target.value)} 
                      placeholder="Custom Institution Name" 
                      className="flex-1 h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm px-4 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange" 
                    />
                    <button 
                      onClick={() => handleSaveInstitution(true)} 
                      className="px-6 h-11 bg-slate-800 hover:bg-slate-750 text-slate-100 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors border border-slate-700/50"
                    >
                      Save Institution
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                    {savedInstitutions.length === 0 ? (
                      <p className="text-xs text-slate-500 italic text-center py-8">No custom institutions saved yet.</p>
                    ) : (
                      savedInstitutions.map(t => (
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
                              onClick={() => loadInstitution(t.theme, t.name, t.id, t.domain)} 
                              className="px-3.5 py-1.5 bg-osu-orange hover:bg-[#c03900] text-[10px] font-black uppercase tracking-wider text-white rounded-lg transition-colors"
                            >
                              Load
                            </button>
                            <button 
                              onClick={() => handleDeleteInstitution(t.id)} 
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

                <div className="pt-4 border-t border-slate-800 mt-4">
                  <button 
                    onClick={() => handleSaveInstitution(false)} 
                    className="w-full h-11 bg-osu-orange text-white font-black uppercase tracking-widest rounded-xl hover:bg-[#c03900] shadow-lg shadow-orange-500/10 transition-colors"
                  >
                    Apply Institution
                  </button>
                </div>

                <div className="pt-6 border-t border-slate-800 mt-6 text-[10px] text-slate-500 text-center leading-relaxed">
                  Saving or applying an Institution updates the dynamic layout variables of all active presentation interfaces in real-time.
                </div>
              </div>
            </div>
          )}

          {/* ========================================================
              TAB 2: ATTENDANCE TRACKER WORKSPACE
              ======================================================== */}
          {activeTab === 'attendance' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-300">
              
              {/* Left Column: Chronological Session Logs */}
              <div className="lg:col-span-4 flex flex-col gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col h-[650px] overflow-hidden">
                  
                  {/* Sidebar Header with Bulk Actions */}
                  <div className="border-b border-slate-800 pb-3 mb-4 flex-shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {recentSessions.filter(s => s.id !== presentationId).length > 0 && (
                        <input
                          type="checkbox"
                          checked={
                            recentSessions.filter(s => s.id !== presentationId).length > 0 &&
                            recentSessions.filter(s => s.id !== presentationId).every(s => selectedSessionIdsForBulk.includes(s.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const eligibleIds = recentSessions
                                .filter(s => s.id !== presentationId)
                                .map(s => s.id);
                              setSelectedSessionIdsForBulk(eligibleIds);
                            } else {
                              setSelectedSessionIdsForBulk([]);
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-700 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer"
                          title="Select / Deselect All Eligible Sessions"
                        />
                      )}
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-osu-orange" />
                        Session Logs
                      </h3>
                    </div>

                    {selectedSessionIdsForBulk.length > 0 && (
                      <button
                        onClick={handleBulkDelete}
                        disabled={isDeletingSessions}
                        className="flex items-center gap-1 px-2.5 py-1 bg-red-950/40 hover:bg-red-900 border border-red-500/30 text-[10px] font-black uppercase tracking-wider text-red-400 hover:text-white rounded-lg transition-all"
                      >
                        {isDeletingSessions ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Delete ({selectedSessionIdsForBulk.length})
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {loadingSessions && recentSessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 className="w-8 h-8 text-osu-orange animate-spin mb-3" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Loading sessions...</span>
                      </div>
                    ) : recentSessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                        <AlertCircle className="w-8 h-8 text-slate-600 mb-3" />
                        <p className="text-xs text-slate-500 italic">No presentation sessions found.</p>
                      </div>
                    ) : (
                      recentSessions.map((session) => {
                        const isSelected = selectedSessionId === session.id;
                        const sessionDate = session.createdAt 
                          ? new Date(session.createdAt.seconds * 1000) 
                          : null;
                        const formattedDate = sessionDate 
                          ? sessionDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Unknown Date';
                        const formattedTime = sessionDate
                          ? sessionDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                          : 'Unknown Time';

                        return (
                          <div
                            key={session.id}
                            onClick={() => setSelectedSessionId(session.id)}
                            className={`w-full p-3 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer group relative overflow-hidden ${
                              isSelected 
                                ? 'bg-osu-orange/15 border-osu-orange text-white shadow-md shadow-orange-500/5' 
                                : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700/80 text-slate-300 hover:text-white'
                            }`}
                          >
                            {/* Checkbox for bulk select */}
                            <input
                              type="checkbox"
                              checked={selectedSessionIdsForBulk.includes(session.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.checked) {
                                  setSelectedSessionIdsForBulk(prev => [...prev, session.id]);
                                } else {
                                  setSelectedSessionIdsForBulk(prev => prev.filter(id => id !== session.id));
                                }
                              }}
                              disabled={session.id === presentationId}
                              className="w-4 h-4 rounded border-slate-750 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                            />

                            {/* Session details */}
                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <div className="flex items-center justify-between w-full">
                                <span className={`text-[11px] font-black tracking-wide ${isSelected ? 'text-osu-orange' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                  {formattedDate}
                                </span>
                                <span className="text-[9px] font-mono opacity-50">
                                  {formattedTime}
                                </span>
                              </div>
                              <div className="text-[9px] font-mono opacity-70 break-all flex items-center justify-between mt-0.5">
                                <span>ID: {session.id.substring(0, 10)}...</span>
                                {session.id === presentationId && (
                                  <span className="text-[8px] font-black uppercase bg-osu-orange text-white px-1.5 py-0.5 rounded scale-90 origin-right">Active</span>
                                )}
                              </div>
                              {session.presenterEmail && (
                                <div className="text-[9px] text-indigo-400 font-bold truncate mt-0.5">
                                  Presenter: {session.presenterEmail}
                                </div>
                              )}
                            </div>

                            {/* Individual Delete Button on Hover */}
                            {session.id !== presentationId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSession(session.id);
                                }}
                                disabled={isDeletingSessions}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 disabled:opacity-0 transition-all duration-200 cursor-pointer flex-shrink-0"
                                title="Delete Session"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Attendance Monitor */}
              <div className="lg:col-span-8">
                {!selectedSessionId ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center h-[650px]">
                    <div className="w-12 h-12 bg-osu-orange/10 border border-osu-orange/20 text-osu-orange rounded-2xl flex items-center justify-center mb-4">
                      <UserCheck className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-black text-white uppercase tracking-wide">Select a Session Log</h3>
                    <p className="text-xs text-slate-400 max-w-sm mt-2 leading-relaxed">
                      Choose an attendance session from the historical logs on the left to review checked-in students and export the roster.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Dashboard header card */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${selectedSessionId === presentationId ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`} />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {selectedSessionId === presentationId ? 'Monitoring Live Session' : 'Reviewing Closed Session'}
                          </span>
                        </div>
                        <h2 className="text-base font-black text-white font-mono break-all">{selectedSessionId}</h2>
                        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-slate-300 font-bold">{formattedSelectedDate}</span>
                          <span className="text-slate-600">|</span>
                          <span>Total Check-Ins: <span className="text-white font-bold text-xs bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800">{filteredAttendance.length} students</span></span>
                          {selectedPresenterEmail && (
                            <>
                              <span className="text-slate-600">|</span>
                              <span>Presenter: <span className="text-indigo-400 font-bold text-xs bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800">{selectedPresenterEmail}</span></span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Dashboard controls */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <select
                          value={attendanceFilter}
                          onChange={(e) => setAttendanceFilter(e.target.value)}
                          className="h-11 px-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-osu-orange cursor-pointer"
                        >
                          {filterOptions.map(option => (
                            <option key={option.id} value={option.id} className="bg-slate-900 text-slate-200">
                              {option.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleDownloadCSV}
                          disabled={filteredAttendance.length === 0}
                          className="flex items-center gap-2 h-11 px-5 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-orange-500/10 cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV Sheet
                        </button>
                      </div>
                    </div>

                    {/* Real-Time Live Roster Table Card */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-green-500" />
                        {selectedSessionId === presentationId ? 'Live Attendance Roster' : 'Attendance Roster Log'}
                      </h3>

                      <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                <th className="py-3 px-4">Student Name</th>
                                <th className="py-3 px-4">Email Address</th>
                                <th className="py-3 px-4">Presenter Email</th>
                                <th className="py-3 px-4">Checked-In Timestamp</th>
                                <th className="py-3 px-4 text-center">Join Method</th>
                                <th className="py-3 px-4 text-center">Slide</th>
                                <th className="py-3 px-4">Institution</th>
                                <th className="py-3 px-4 text-right">Verification Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loadingAttendance ? (
                                <tr>
                                  <td colSpan={8} className="py-16 text-center">
                                    <Loader2 className="w-8 h-8 text-osu-orange animate-spin mx-auto mb-2" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Retrieving check-ins...</span>
                                  </td>
                                </tr>
                              ) : filteredAttendance.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="py-16 text-center text-slate-500 text-xs italic">
                                    {attendanceList.length === 0
                                      ? (selectedSessionId === presentationId 
                                          ? 'No students have scanned in yet. Ask your class to scan the QR code to check in.' 
                                          : 'No check-in records were logged for this presentation session.')
                                      : 'No check-in records matched the selected institution filter.'}
                                  </td>
                                </tr>
                              ) : (
                                filteredAttendance.map((record) => (
                                  <tr key={record.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40 text-sm transition-colors">
                                    <td className="py-3.5 px-4 font-bold text-white">{record.name}</td>
                                    <td className="py-3.5 px-4 text-slate-300 font-medium">{record.email}</td>
                                    <td className="py-3.5 px-4 text-slate-400 font-medium text-xs truncate max-w-[150px]">{selectedPresenterEmail || '—'}</td>
                                    <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">
                                      {record.checkedInAt 
                                        ? new Date(record.checkedInAt.seconds * 1000).toLocaleString() 
                                        : 'Registering on server...'}
                                    </td>
                                    <td className="py-3.5 px-4 text-center">
                                      <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide px-2.5 py-0.5 rounded border ${
                                        record.authMethod === 'QR' 
                                          ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' 
                                          : 'text-sky-400 bg-sky-500/10 border-sky-500/20'
                                      }`}>
                                        {record.authMethod || 'QR'}
                                      </span>
                                    </td>
                                    <td className="py-3.5 px-4 text-center text-slate-300 font-mono font-bold text-xs">
                                      {record.slide !== null && record.slide !== undefined ? `Slide ${record.slide}` : '—'}
                                    </td>
                                    <td className="py-3.5 px-4 text-slate-300 font-medium">
                                      {record.institutionName || 'Custom / Active Theme'}
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

            </div>
          )}

          {/* ========================================================
              TAB 3: PRESENTERS WORKSPACE
              ======================================================== */}
          {activeTab === 'presenters' && (() => {
            // Group presentations by presenter email/id
            const presenterStatsMap: Record<string, { email: string; sessionsCount: number; lastPresentedAt: Date | null }> = {};
            
            recentSessions.forEach(session => {
              // Graceful fallback for older sessions that didn't have presenterEmail
              const emailKey = session.presenterEmail ? session.presenterEmail.trim().toLowerCase() : `anonymous_presenter_${session.presenterId}`;
              const displayName = session.presenterEmail || `Anonymous (ID: ${session.presenterId.substring(0,6)})`;
              const sessionDate = session.createdAt ? new Date(session.createdAt.seconds * 1000) : null;
              
              if (!presenterStatsMap[emailKey]) {
                presenterStatsMap[emailKey] = {
                  email: displayName,
                  sessionsCount: 0,
                  lastPresentedAt: null
                };
              }
              
              presenterStatsMap[emailKey].sessionsCount += 1;
              
              if (sessionDate) {
                if (!presenterStatsMap[emailKey].lastPresentedAt || sessionDate > presenterStatsMap[emailKey].lastPresentedAt) {
                  presenterStatsMap[emailKey].lastPresentedAt = sessionDate;
                }
              }
            });

            const statsList = Object.values(presenterStatsMap).sort((a, b) => {
              if (!a.lastPresentedAt) return 1;
              if (!b.lastPresentedAt) return -1;
              return b.lastPresentedAt.getTime() - a.lastPresentedAt.getTime();
            });

            return (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden animate-in fade-in duration-300">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                  <div className="space-y-1">
                    <h2 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2.5">
                      <Monitor className="w-5 h-5 text-osu-orange" />
                      Presenter Analytics Directory
                    </h2>
                    <p className="text-xs text-slate-400">
                      Detailed overview of all presenter accounts, login/session frequency, and their latest presentation times.
                    </p>
                  </div>
                  <div className="bg-slate-950 px-4 py-2 border border-slate-800 rounded-xl text-right">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Total Active Presenters</span>
                    <span className="text-lg font-black text-osu-orange">{statsList.length}</span>
                  </div>
                </div>

                <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                          <th className="py-3 px-5">Presenter Name / Display Handle</th>
                          <th className="py-3 px-5">Presenter Email Address</th>
                          <th className="py-3 px-5 text-center">Sessions Logged</th>
                          <th className="py-3 px-5 text-right">Last Session Date & Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingSessions && statsList.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-16 text-center">
                              <Loader2 className="w-8 h-8 text-osu-orange animate-spin mx-auto mb-2" />
                              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Compiling presenter stats...</span>
                            </td>
                          </tr>
                        ) : statsList.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-16 text-center text-slate-500 text-xs italic">
                              No presenter accounts have logged or hosted presentation sessions yet.
                            </td>
                          </tr>
                        ) : (
                          statsList.map((presenter, i) => {
                            const hasDomain = presenter.email.includes('@');
                            const displayHandle = hasDomain ? presenter.email.split('@')[0] : 'Anonymous Host';
                            
                            return (
                              <tr key={i} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40 text-sm transition-colors">
                                <td className="py-4 px-5 font-bold text-white capitalize">{displayHandle}</td>
                                <td className="py-4 px-5 text-slate-300 font-mono text-xs">{presenter.email}</td>
                                <td className="py-4 px-5 text-center font-black text-osu-orange">
                                  <span className="bg-osu-orange/10 px-3 py-1 rounded-full border border-osu-orange/20">
                                    {presenter.sessionsCount} sessions
                                  </span>
                                </td>
                                <td className="py-4 px-5 text-right text-slate-400 font-mono text-xs font-semibold">
                                  {presenter.lastPresentedAt 
                                    ? presenter.lastPresentedAt.toLocaleString() 
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
};
