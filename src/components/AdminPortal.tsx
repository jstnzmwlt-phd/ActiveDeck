import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, addDoc, collection, onSnapshot, deleteDoc, query, orderBy, limit, Timestamp, getDocs, where, serverTimestamp, writeBatch, updateDoc } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref, listAll, deleteObject } from 'firebase/storage';
import { Theme, SavedTheme, Message, Poll, WordCloud, OpenEndedQuestion, Presentation } from '../types';
import { Palette, UserCheck, Download, ArrowLeft, Loader2, Calendar, Database, AlertCircle, Trash2, Monitor, Plus, Mail, History, Copy, Check, FileText, Send, X, Presentation as PresentationIcon } from 'lucide-react';

const formatHtmlTextWithLinks = (text: string): string => {
  if (!text) return '';
  const combinedRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
  const urlRegex = /^(https?:\/\/|www\.)/i;

  return text.replace(combinedRegex, (match) => {
    let cleanMatch = match;
    let trailingPunctuation = '';
    const matchTrailing = cleanMatch.match(/^(.*?)([.,;:!)]+)$/);
    if (matchTrailing) {
      const candidate = matchTrailing[1];
      if (emailRegex.test(candidate) || urlRegex.test(candidate)) {
        cleanMatch = candidate;
        trailingPunctuation = matchTrailing[2];
      }
    }

    if (emailRegex.test(cleanMatch)) {
      return `<a href="mailto:${cleanMatch}" style="color: #2563eb; text-decoration: underline; word-break: break-all;">${cleanMatch}</a>${trailingPunctuation}`;
    }

    const href = cleanMatch.startsWith('http://') || cleanMatch.startsWith('https://') 
      ? cleanMatch 
      : `https://${cleanMatch}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; word-break: break-all;">${cleanMatch}</a>${trailingPunctuation}`;
  });
};

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
  hasActivity?: boolean;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ presentationId }) => {
  const [activeTab, setActiveTab] = useState<'theme' | 'attendance' | 'presenters' | 'sessions'>('theme');
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
  const [showAttendance, setShowAttendance] = useState<boolean>(false);

  // Attendance Tracker States
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(presentationId || null);
  const [recentSessions, setRecentSessions] = useState<RecentPresentationRecord[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [attendanceList, setAttendanceList] = useState<StudentAttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [selectedSessionIdsForBulk, setSelectedSessionIdsForBulk] = useState<string[]>([]);
  const [isDeletingSessions, setIsDeletingSessions] = useState(false);
  const [isDownloadingChatLog, setIsDownloadingChatLog] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [downloadingSessionId, setDownloadingSessionId] = useState<string | null>(null);
  const [downloadModalSessionId, setDownloadModalSessionId] = useState<string | null>(null);

  // Presenter Management States
  const [selectedPresenterKeysForBulk, setSelectedPresenterKeysForBulk] = useState<string[]>([]);
  const [isDeletingPresenters, setIsDeletingPresenters] = useState(false);
  const [whitelistedPresenters, setWhitelistedPresenters] = useState<any[]>([]);
  const [loadingWhitelisted, setLoadingWhitelisted] = useState(false);
  const [newPresenterEmail, setNewPresenterEmail] = useState('');
  const [isAddingPresenter, setIsAddingPresenter] = useState(false);

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

  // Run automatic background storage and session cleanup once a day when AdminPortal loads
  useEffect(() => {
    const runAutoCleanup = async () => {
      if (recentSessions.length === 0) return;

      const lastCleanup = localStorage.getItem('activeDeckLastCleanup');
      const todayStr = new Date().toDateString();
      if (lastCleanup === todayStr) return;

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const oldSessions = recentSessions.filter(session => {
        if (!session.createdAt) return false;
        const createdAtDate = new Date(session.createdAt.seconds * 1000);
        return createdAtDate < thirtyDaysAgo && session.id !== presentationId;
      });

      if (oldSessions.length > 0) {
        console.log(`[Auto Cleanup] Found ${oldSessions.length} session(s) older than 30 days. Purging...`);
        try {
          for (const session of oldSessions) {
            await deleteSessionDoc(session.id);
          }
          console.log(`[Auto Cleanup] Successfully purged ${oldSessions.length} old session(s) and their storage files.`);
        } catch (err) {
          console.error("[Auto Cleanup] Error during automatic purge:", err);
        }
      }

      localStorage.setItem('activeDeckLastCleanup', todayStr);
    };

    runAutoCleanup();
  }, [recentSessions, presentationId]);

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

  // Filter out sessions without a presenter email, and sessions explicitly marked hasActivity === false (unless active session)
  const activeSessions = recentSessions.filter(s => {
    const email = s.presenterEmail || '';
    if (!email) return false;
    if (s.hasActivity === false && s.id !== presentationId) return false;
    return true;
  });

  // Derived filtered session list for the Sessions Tab search capability
  const filteredSessions = activeSessions.filter(s => {
    const email = s.presenterEmail || '';
    const name = email ? email.split('@')[0].replace(/[._]/g, ' ') : '';
    const queryStr = sessionSearch.toLowerCase();
    return s.id.toLowerCase().includes(queryStr) || 
           email.toLowerCase().includes(queryStr) || 
           name.toLowerCase().includes(queryStr);
  });

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
        setShowAttendance(data.showAttendance !== undefined ? data.showAttendance : false);
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
    if (activeTab !== 'attendance' && activeTab !== 'presenters' && activeTab !== 'sessions') return;

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
        presenterEmail: doc.data().presenterEmail || '',
        hasActivity: doc.data().hasActivity !== undefined ? doc.data().hasActivity : undefined
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

  // Real-Time Subscribe to Whitelisted Presenters
  useEffect(() => {
    if (activeTab !== 'presenters') return;

    setLoadingWhitelisted(true);
    const qWhitelisted = query(
      collection(db, 'whitelistedPresenters'),
      orderBy('addedAt', 'desc')
    );

    const unsubWhitelisted = onSnapshot(qWhitelisted, (snapshot) => {
      const list = snapshot.docs.map(docSnap => ({
        email: docSnap.id,
        ...docSnap.data()
      }));
      setWhitelistedPresenters(list);
      setLoadingWhitelisted(false);
    }, (error) => {
      console.error("Error loading whitelisted presenters:", error);
      setLoadingWhitelisted(false);
    });

    return () => unsubWhitelisted();
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
          activeInstitutionDomain: domainVal,
          showAttendance
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

  // Helper to delete session and all its subcollection documents, messages, and storage files
  const deleteSessionDoc = async (sessionId: string) => {
    console.log(`[deleteSessionDoc] Starting deletion sequence for session: ${sessionId}`);
    
    // 1. Fetch all attendance check-ins under the session
    let attendanceDocs: any[] = [];
    try {
      console.log(`[deleteSessionDoc] Fetching attendance check-ins for session ${sessionId}...`);
      const attendanceRef = collection(db, 'presentations', sessionId, 'attendance');
      const attendanceSnap = await getDocs(attendanceRef);
      attendanceDocs = attendanceSnap.docs;
      console.log(`[deleteSessionDoc] Found ${attendanceDocs.length} attendance check-ins.`);
    } catch (err: any) {
      console.error(`[deleteSessionDoc] Error fetching attendance check-ins:`, err);
      throw new Error(`Failed to fetch student attendance check-ins: ${err.message || err}`);
    }

    // 2. Fetch all attendance tokens under the session
    let tokenDocs: any[] = [];
    try {
      console.log(`[deleteSessionDoc] Fetching attendance tokens for session ${sessionId}...`);
      const tokensRef = collection(db, 'presentations', sessionId, 'attendance_tokens');
      const tokensSnap = await getDocs(tokensRef);
      tokenDocs = tokensSnap.docs;
      console.log(`[deleteSessionDoc] Found ${tokenDocs.length} attendance tokens.`);
    } catch (err: any) {
      console.error(`[deleteSessionDoc] Error fetching attendance tokens:`, err);
      throw new Error(`Failed to fetch presentation attendance tokens: ${err.message || err}`);
    }

    // 3. Fetch all chat messages associated with the session
    let messageDocs: any[] = [];
    try {
      console.log(`[deleteSessionDoc] Fetching chat messages for session ${sessionId}...`);
      const messagesQuery = query(collection(db, 'messages'), where('presentationId', '==', sessionId));
      const messagesSnap = await getDocs(messagesQuery);
      messageDocs = messagesSnap.docs;
      console.log(`[deleteSessionDoc] Found ${messageDocs.length} chat messages.`);
    } catch (err: any) {
      console.error(`[deleteSessionDoc] Error fetching chat messages:`, err);
      throw new Error(`Failed to fetch chat messages: ${err.message || err}`);
    }

    // 4. Delete all sub-documents in parallel using Promise.allSettled to prevent all-or-nothing batch failures
    const allDocRefs = [
      ...attendanceDocs.map(d => d.ref),
      ...tokenDocs.map(d => d.ref),
      ...messageDocs.map(d => d.ref)
    ];

    console.log(`[deleteSessionDoc] Total sub-documents to delete: ${allDocRefs.length}`);

    if (allDocRefs.length > 0) {
      const deletePromises = allDocRefs.map(async (docRef) => {
        try {
          await deleteDoc(docRef);
        } catch (e: any) {
          console.warn(`[deleteSessionDoc] Failed to delete sub-document ${docRef.path}:`, e);
          throw e;
        }
      });

      const results = await Promise.allSettled(deletePromises);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`[deleteSessionDoc] Purged sub-documents with ${failures.length} non-blocking failures (e.g. chat messages or check-ins with restricted permissions) out of ${allDocRefs.length} docs.`);
      } else {
        console.log(`[deleteSessionDoc] All ${allDocRefs.length} sub-documents deleted successfully.`);
      }
    }

    // 5. Delete associated files and slide snapshots in Firebase Storage
    try {
      console.log(`[deleteSessionDoc] Cleaning up files in Storage...`);
      const storageFolderRef = ref(storage, `presentations/${sessionId}/documents`);
      const storageList = await listAll(storageFolderRef);
      const storageDeletes = storageList.items.map(itemRef => deleteObject(itemRef));
      await Promise.all(storageDeletes);
      console.log(`[deleteSessionDoc] Storage cleanup completed.`);
    } catch (storageErr) {
      console.warn("[deleteSessionDoc] Storage cleanup failed (this is normal if no files were uploaded):", storageErr);
    }

    // 6. Delete the parent presentation document itself
    try {
      console.log(`[deleteSessionDoc] Deleting parent presentation document...`);
      const presentationRef = doc(db, 'presentations', sessionId);
      await deleteDoc(presentationRef);
      console.log(`[deleteSessionDoc] Session deletion fully complete!`);
    } catch (err: any) {
      console.error(`[deleteSessionDoc] Error deleting parent presentation document:`, err);
      throw new Error(`Failed to delete the main presentation session document: ${err.message || err}`);
    }
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
      // Delete all in parallel with individual error tracking
      const results = await Promise.allSettled(safeSelectedIds.map(async (id) => {
        await deleteSessionDoc(id);
        return id;
      }));

      const successfulIds: string[] = [];
      const failedIds: string[] = [];
      let lastError: any = null;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successfulIds.push(result.value);
        } else {
          failedIds.push(safeSelectedIds[index]);
          lastError = result.reason;
        }
      });

      // Clear successful IDs from the bulk selection, leaving only the failed ones selected
      setSelectedSessionIdsForBulk(prev => prev.filter(id => failedIds.includes(id)));

      // If the currently viewed session was deleted, switch to a remaining one
      if (selectedSessionId && successfulIds.includes(selectedSessionId)) {
        const remaining = recentSessions.filter(s => !successfulIds.includes(s.id));
        if (remaining.length > 0) {
          setSelectedSessionId(remaining[0].id);
        } else {
          setSelectedSessionId(null);
        }
      }

      if (failedIds.length === 0) {
        alert(`Successfully deleted all ${successfulIds.length} selected session(s).`);
      } else if (successfulIds.length === 0) {
        console.error("Error performing bulk deletion:", lastError);
        alert(`Failed to delete selected session(s). Firebase Error: ${lastError?.message || lastError}`);
      } else {
        console.warn(`${failedIds.length} session(s) failed to delete:`, failedIds);
        alert(`Partially completed: Successfully deleted ${successfulIds.length} session(s).\n\n${failedIds.length} session(s) could not be deleted (possibly due to Firestore permissions or missing files). The remaining failed sessions have been kept selected so you can try again.`);
      }
    } catch (e) {
      console.error("Unexpected error during bulk deletion:", e);
      alert("An unexpected error occurred: " + e);
    } finally {
      setIsDeletingSessions(false);
    }
  };

  const handleCleanupOldSessions = async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Filter sessions older than 30 days that are not the live presentation
    const oldSessions = recentSessions.filter(session => {
      if (!session.createdAt) return false;
      const createdAtDate = new Date(session.createdAt.seconds * 1000);
      return createdAtDate < thirtyDaysAgo && session.id !== presentationId;
    });

    if (oldSessions.length === 0) {
      alert("No sessions older than 30 days were found.");
      return;
    }

    const confirmMessage = `Found ${oldSessions.length} session(s) older than 30 days. Are you sure you want to permanently delete them along with their messages, student attendance, and slide image captures?`;
    if (!confirm(confirmMessage)) return;

    setIsDeletingSessions(true);
    try {
      let successCount = 0;
      for (const session of oldSessions) {
        await deleteSessionDoc(session.id);
        successCount++;
      }
      alert(`Successfully cleaned up ${successCount} old session(s) and their associated storage files.`);
    } catch (error) {
      console.error("Error during session cleanup:", error);
      alert("An error occurred during cleanup: " + error);
    } finally {
      setIsDeletingSessions(false);
    }
  };

  const handleAddPresenter = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPresenterEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }
    
    setIsAddingPresenter(true);
    try {
      const docRef = doc(db, 'whitelistedPresenters', trimmed);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        alert('This email is already whitelisted!');
        setIsAddingPresenter(false);
        return;
      }
      
      await setDoc(docRef, {
        addedAt: serverTimestamp(),
        usageCount: 0,
        lastUsedAt: null
      });
      
      setNewPresenterEmail('');
      alert('Presenter successfully added to whitelist!');
    } catch (err: any) {
      console.error('Error whitelisting presenter:', err);
      alert('Failed to add presenter: ' + err.message);
    } finally {
      setIsAddingPresenter(false);
    }
  };

  const handleDeletePresenters = async (keysToDelete: string[]) => {
    // Hardcode protection for justin.zumwalt@okstate.edu
    const containsCreator = keysToDelete.some(email => email.toLowerCase() === 'justin.zumwalt@okstate.edu');
    const filteredKeys = keysToDelete.filter(email => email.toLowerCase() !== 'justin.zumwalt@okstate.edu');

    if (containsCreator && filteredKeys.length === 0) {
      alert("justin.zumwalt@okstate.edu is the creator of the app and cannot be deleted from the whitelist.");
      return;
    }

    if (filteredKeys.length === 0) return;

    const confirmMessage = containsCreator
      ? `Are you sure you want to remove the ${filteredKeys.length} selected presenter(s) from the whitelist? (justin.zumwalt@okstate.edu is protected and will not be removed).`
      : `Are you sure you want to remove the ${filteredKeys.length} selected presenter(s) from the whitelist? They will immediately lose access to the presenter portal.`;

    if (!confirm(confirmMessage)) return;

    setIsDeletingPresenters(true);
    try {
      await Promise.all(filteredKeys.map(email => deleteDoc(doc(db, 'whitelistedPresenters', email))));
      setSelectedPresenterKeysForBulk([]);
      if (containsCreator) {
        alert(`Successfully removed ${filteredKeys.length} presenter(s) from the whitelist. justin.zumwalt@okstate.edu was skipped.`);
      } else {
        alert(`Successfully removed ${filteredKeys.length} presenter(s) from the whitelist.`);
      }
    } catch (e) {
      console.error("Error deleting presenters from whitelist:", e);
      alert("Error deleting presenters: " + e);
    } finally {
      setIsDeletingPresenters(false);
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
    link.click();
  };

  const compositeSlideWithAnnotations = (
    slideImgUrl: string,
    presenterDrawingsJson?: string
  ): Promise<Uint8Array | null> => {
    return new Promise(async (resolve) => {
      let localUrl = '';
      try {
        if (slideImgUrl.startsWith('data:')) {
          localUrl = slideImgUrl;
        } else {
          const isExternal = slideImgUrl.startsWith('http') && !slideImgUrl.includes(window.location.host);
          const fetchUrl = isExternal 
            ? `/api/proxy-image?url=${encodeURIComponent(slideImgUrl)}`
            : slideImgUrl;
            
          const response = await fetch(fetchUrl);
          if (!response.ok) {
            throw new Error(`Fetch failed: ${response.statusText}`);
          }
          const blob = await response.blob();
          localUrl = URL.createObjectURL(blob);
        }
      } catch (e) {
        console.error("compositeSlideWithAnnotations: Failed to fetch image", e);
        localUrl = slideImgUrl;
      }

      const img = new Image();
      if (!localUrl.startsWith('data:') && !localUrl.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1920;
        canvas.height = img.naturalHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
          resolve(null);
          return;
        }

        // Draw base slide image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const drawStrokeList = (strokes: any[]) => {
          strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length === 0) return;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const scaleX = canvas.width / 1000;
            const scaleY = canvas.height / 1000;
            const avgScale = (scaleX + scaleY) / 2;

            ctx.lineWidth = stroke.width * avgScale;

            if (stroke.isHighlighter) {
              ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
            } else {
              ctx.strokeStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
              ctx.fillStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
            }

            const pts = stroke.points.map((p: any) => ({
              x: p.x * scaleX,
              y: p.y * scaleY
            }));

            if (stroke.text && pts[0]) {
              const fontSize = Math.max(26, stroke.width * 5) * avgScale;
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.fillText(stroke.text, pts[0].x, pts[0].y);
            } else if (stroke.isArrow && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const angle = Math.atan2(dy, dx);
              const headLength = Math.max(25, stroke.width * 4) * avgScale;
              const arrowAngle = Math.PI / 6;

              const h1x = p2.x - headLength * Math.cos(angle - arrowAngle);
              const h1y = p2.y - headLength * Math.sin(angle - arrowAngle);
              const h2x = p2.x - headLength * Math.cos(angle + arrowAngle);
              const h2y = p2.y - headLength * Math.sin(angle + arrowAngle);

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h1x, h1y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h2x, h2y);
              ctx.stroke();
            } else if (stroke.isLine && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            } else if (stroke.isRectangle && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const x = Math.min(p1.x, p2.x);
              const y = Math.min(p1.y, p2.y);
              const w = Math.abs(p2.x - p1.x);
              const h = Math.abs(p2.y - p1.y);
              ctx.beginPath();
              ctx.rect(x, y, w, h);
              ctx.stroke();
            } else if (stroke.isCircle && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const cx = (p1.x + p2.x) / 2;
              const cy = (p1.y + p2.y) / 2;
              const rx = Math.abs(p2.x - p1.x) / 2;
              const ry = Math.abs(p2.y - p1.y) / 2;
              ctx.beginPath();
              if (typeof ctx.ellipse === 'function') {
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
              } else {
                const r = (rx + ry) / 2;
                ctx.arc(cx, cy, r, 0, 2 * Math.PI);
              }
              ctx.stroke();
            } else {
              ctx.beginPath();
              pts.forEach((p: any, i: number) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              });
              if (pts.length === 1) {
                ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
              }
              ctx.stroke();
            }
            ctx.restore();
          });
        };

        // Draw Presenter Drawings
        if (presenterDrawingsJson) {
          try {
            const pStrokes = JSON.parse(presenterDrawingsJson);
            if (Array.isArray(pStrokes)) drawStrokeList(pStrokes);
          } catch {}
        }

        try {
          const dataUrl = canvas.toDataURL('image/png');
          const parts = dataUrl.split(',');
          if (parts.length >= 2) {
            const binaryStr = window.atob(parts[1]);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
            resolve(bytes);
          } else {
            if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
            resolve(null);
          }
        } catch (e) {
          if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
          resolve(null);
        }
      };

      img.onerror = () => {
        if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
        // Fallback fetch
        fetch(slideImgUrl)
          .then(res => res.arrayBuffer())
          .then(buf => resolve(new Uint8Array(buf)))
          .catch(() => resolve(null));
      };

      img.src = localUrl;
    });
  };

  const handleDownloadPresentation = async (sessionId: string, includeChat = false) => {
    setIsDownloadingChatLog(true);
    setDownloadingSessionId(sessionId);
    try {
      const { collection, query, where, getDocs, doc, getDoc } = await import('firebase/firestore');
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle } = await import('docx');

      // Fetch the full presentation session document
      const sessionDocRef = doc(db, 'presentations', sessionId);
      const sessionDocSnap = await getDoc(sessionDocRef);
      if (!sessionDocSnap.exists()) {
        alert("Presentation session not found!");
        setIsDownloadingChatLog(false);
        setDownloadingSessionId(null);
        return;
      }
      const presentationData = sessionDocSnap.data() as Presentation;

      // Query slide preview messages
      const previewQuery = query(
        collection(db, 'messages'),
        where('presentationId', '==', sessionId),
        where('isBackgroundPreview', '==', true)
      );

      const querySnapshot = await getDocs(previewQuery);
      const previewsMap: Record<string, string> = {};
      querySnapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.slide !== undefined && data.slide !== null && data.fileUrl) {
          previewsMap[String(data.slide)] = data.fileUrl;
        }
      });

      const sortedSlides = Object.keys(previewsMap).sort((a, b) => {
        const numA = Number(a);
        const numB = Number(b);
        if (isNaN(numA) || isNaN(numB)) return a.localeCompare(b);
        return numA - numB;
      });

      const slideElements: any[] = [];

      for (const slide of sortedSlides) {
        const slideNum = Number(slide);
        const titleStr = isNaN(slideNum) ? slide : `Slide ${slide}`;
        slideElements.push(
          new Paragraph({
            text: titleStr,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 }
          })
        );

        const slideImgUrl = previewsMap[slide];
        if (slideImgUrl) {
          const presenterJson = presentationData.presenterDrawings?.[slide];
          const imgBytes = await compositeSlideWithAnnotations(slideImgUrl, presenterJson);
          if (imgBytes) {
            slideElements.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: imgBytes,
                    transformation: { width: 500, height: 280 },
                    type: 'png'
                  })
                ],
                spacing: { after: 180 }
              })
            );
          }
        }
      }

      const activityElements: any[] = [];
      if (includeChat) {
        // Query database for chat history and activities
        const msgsQuery = query(collection(db, 'messages'), where('presentationId', '==', sessionId));
        const msgsSnap = await getDocs(msgsQuery);
        const msgs = msgsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((m: any) => !m.isBackgroundPreview) as Message[];
        msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));

        const pollsQuery = query(collection(db, 'polls'), where('presentationId', '==', sessionId));
        const pollsSnap = await getDocs(pollsQuery);
        const ps = pollsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Poll[];
        ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const wcQuery = query(collection(db, 'wordClouds'), where('presentationId', '==', sessionId));
        const wcSnap = await getDocs(wcQuery);
        const wcs = wcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as WordCloud[];
        wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const oeqQuery = query(collection(db, 'openEndedQuestions'), where('presentationId', '==', sessionId));
        const oeqSnap = await getDocs(oeqQuery);
        const oeqs = oeqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as OpenEndedQuestion[];
        oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

        const combinedItems = [
          ...msgs.map(m => ({ ...m, type: 'message' as const })),
          ...ps.map(p => ({ ...p, type: 'poll' as const })),
          ...wcs.map(w => ({ ...w, type: 'wordCloud' as const })),
          ...oeqs.map(q => ({ ...q, type: 'openEnded' as const }))
        ].sort((a, b) => {
          const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
          const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
          return timeA - timeB;
        });

        activityElements.push(
          new Paragraph({
            text: "Session Activity & Chat Log",
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: true,
            spacing: { before: 240, after: 200 }
          })
        );

        if (combinedItems.length === 0) {
          activityElements.push(
            new Paragraph({
              text: "No chat messages or session activities recorded.",
              spacing: { before: 120, after: 120 }
            })
          );
        } else {
          let runningMessageRows: any[] = [];

          const flushMessages = () => {
            if (runningMessageRows.length > 0) {
              const tableHeader = new TableRow({
                children: [
                  new TableCell({ width: { size: 10, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Date", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 12, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Time", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Slide", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Email", bold: true, font: "Arial", size: 18 })] })] }),
                  new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Question / Message", bold: true, font: "Arial", size: 18 })] })] }),
                ]
              });
              activityElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [tableHeader, ...runningMessageRows]
                }),
                new Paragraph({ spacing: { after: 240 } })
              );
              runningMessageRows = [];
            }
          };

          for (const item of combinedItems) {
            if (item.type === 'message') {
              const m = item as Message;
              const dateObj = m.timestamp?.toDate() || new Date();
              const dateStr = dateObj.toLocaleDateString();
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const slideStr = m.slide !== undefined && m.slide !== null ? `Slide ${m.slide}` : '-';
              const nameStr = m.userName || '-';
              const emailStr = m.userEmail || '-';
              const textStr = m.text || '';
              const likesStr = m.likes ? ` (👍 ${m.likes})` : '';

              const cellBorders = {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" }
              };

              runningMessageRows.push(
                new TableRow({
                  children: [
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: dateStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: timeStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: slideStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: nameStr, font: "Arial", size: 18, bold: true })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: emailStr, font: "Arial", size: 18 })] })] }),
                    new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [
                      new TextRun({ text: textStr, font: "Arial", size: 18 }),
                      ...(likesStr ? [new TextRun({ text: likesStr, font: "Arial", size: 18, bold: true, color: "854D0E" })] : [])
                    ] })] }),
                  ]
                })
              );
            } else {
              flushMessages();

              const cellBorders = {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" }
              };

              if (item.type === 'poll') {
                const p = item as Poll;
                const dateObj = p.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = p.slide !== undefined ? ` [Slide ${p.slide}]` : '';
                const totalVotes = Object.values(p.votes || {}).reduce((sum, val) => sum + val, 0);

                activityElements.push(
                  new Paragraph({
                    text: "📊 MCQ POLL RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const pollRows = p.options.map(opt => {
                  const count = p.votes[opt] || 0;
                  const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                  const isCorrect = p.correctAnswer === opt;
                  return new TableRow({
                    children: [
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [new TextRun({ text: `Option ${opt}`, bold: true, font: "Arial", size: 18 })] })]
                      }),
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 40, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [new TextRun({ text: `${count} votes (${percentage}%)`, font: "Arial", size: 18 })] })]
                      }),
                      new TableCell({
                        borders: cellBorders,
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ children: [
                          ...(isCorrect ? [new TextRun({ text: "✓ CORRECT ANSWER", bold: true, color: "10B981", font: "Arial", size: 18 })] : [])
                        ] })]
                      })
                    ]
                  });
                });

                activityElements.push(
                  new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: pollRows
                  }),
                  new Paragraph({ spacing: { after: 120 } }),
                  new Paragraph({
                    children: [new TextRun({ text: `Total Votes: ${totalVotes}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { after: 240 }
                  })
                );

              } else if (item.type === 'wordCloud') {
                const w = item as WordCloud;
                const dateObj = w.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = w.slide !== undefined ? ` [Slide ${w.slide}]` : '';
                const totalWords = Object.values(w.words || {}).reduce((sum, val) => sum + val, 0);

                activityElements.push(
                  new Paragraph({
                    text: "☁️ WORD CLOUD RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true }),
                      new TextRun({ text: `\nPrompt: "${w.prompt}"`, bold: true, font: "Arial", size: 18 })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const wordRows = Object.entries(w.words || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([word, count]) => {
                    return new TableRow({
                      children: [
                        new TableCell({
                          borders: cellBorders,
                          width: { size: 70, type: WidthType.PERCENTAGE },
                          children: [new Paragraph({ children: [new TextRun({ text: word, bold: true, font: "Arial", size: 18 })] })]
                        }),
                        new TableCell({
                          borders: cellBorders,
                          width: { size: 30, type: WidthType.PERCENTAGE },
                          children: [new Paragraph({ children: [new TextRun({ text: `${count} submissions`, font: "Arial", size: 18 })] })]
                        })
                      ]
                    });
                  });

                activityElements.push(
                  new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: wordRows
                  }),
                  new Paragraph({ spacing: { after: 120 } }),
                  new Paragraph({
                    children: [new TextRun({ text: `Total Submissions: ${totalWords}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { after: 240 }
                  })
                );

              } else if (item.type === 'openEnded') {
                const q = item as OpenEndedQuestion;
                const dateObj = q.createdAt?.toDate() || new Date();
                const dateStr = dateObj.toLocaleDateString();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const slideStr = q.slide !== undefined ? ` [Slide ${q.slide}]` : '';
                const totalResponses = Object.values(q.responses || {}).length;

                activityElements.push(
                  new Paragraph({
                    text: "💬 OPEN ENDED RESULTS",
                    heading: HeadingLevel.HEADING_3,
                    spacing: { before: 240, after: 60 }
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true }),
                      new TextRun({ text: `\nQuestion: "${q.prompt}"`, bold: true, font: "Arial", size: 18 })
                    ],
                    spacing: { after: 120 }
                  })
                );

                const responseParagraphs = Object.values(q.responses || {}).map(resp => {
                  return new Paragraph({
                    children: [
                      new TextRun({ text: `• `, bold: true, font: "Arial", size: 18 }),
                      new TextRun({ text: `"${resp}"`, italics: true, font: "Arial", size: 18, color: "334155" })
                    ],
                    spacing: { before: 60, after: 60 }
                  });
                });

                activityElements.push(
                  ...responseParagraphs,
                  new Paragraph({
                    children: [new TextRun({ text: `Total Responses: ${totalResponses}`, bold: true, font: "Arial", size: 18 })],
                    spacing: { before: 120, after: 240 }
                  })
                );
              }
            }
          }

          flushMessages();
        }
      }

      const docFilename = `ActiveDeck_Presentation_${presentationData.pinCode || 'Export'}.docx`;

      const docxFile = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: "ActiveDeck Presentation Export",
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 200 }
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                left: { style: BorderStyle.SINGLE, size: 24, color: "EB5D00" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
              },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      shading: { fill: "F8F9FA" },
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Presenter Email: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: presentationData.presenterEmail || 'N/A', font: "Arial" }),
                          ],
                        }),
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Session PIN: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: presentationData.pinCode || 'N/A', font: "Arial" }),
                          ],
                        }),
                        new Paragraph({
                          children: [
                            new TextRun({ text: "Date: ", bold: true, color: "111111", font: "Arial" }),
                            new TextRun({ text: new Date().toLocaleDateString(), font: "Arial" }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ spacing: { after: 240 } }),
            ...slideElements,
            ...activityElements
          ]
        }]
      });

      const docBlob = await Packer.toBlob(docxFile);
      const docUrl = URL.createObjectURL(docBlob);
      const link = document.createElement('a');
      link.href = docUrl;
      link.download = docFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(docUrl);
    } catch (err) {
      console.error("Failed to compile presentation export:", err);
      alert("Failed to export presentation document.");
    } finally {
      setIsDownloadingChatLog(false);
      setDownloadingSessionId(null);
    }
  };

  const handleDownloadChatLog = async (sessionId?: string) => {
    const targetSessionId = sessionId || selectedSessionId;
    if (!targetSessionId) return;
    setIsDownloadingChatLog(true);
    setDownloadingSessionId(targetSessionId);

    try {
      // Query messages
      const msgsQuery = query(
        collection(db, 'messages'),
        where('presentationId', '==', targetSessionId)
      );
      const msgsSnap = await getDocs(msgsQuery);
      const msgs = msgsSnap.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter((m: any) => !m.isBackgroundPreview) as Message[];

      // Sort client-side
      msgs.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || 0;
        const timeB = b.timestamp?.toMillis() || 0;
        return timeA - timeB;
      });

      // Query polls
      const pollsQuery = query(
        collection(db, 'polls'),
        where('presentationId', '==', targetSessionId)
      );
      const pollsSnap = await getDocs(pollsQuery);
      const ps = pollsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Poll[];
      ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      // Query word clouds
      const wcQuery = query(
        collection(db, 'wordClouds'),
        where('presentationId', '==', targetSessionId)
      );
      const wcSnap = await getDocs(wcQuery);
      const wcs = wcSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WordCloud[];
      wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      // Query open ended questions
      const oeqQuery = query(
        collection(db, 'openEndedQuestions'),
        where('presentationId', '==', targetSessionId)
      );
      const oeqSnap = await getDocs(oeqQuery);
      const oeqs = oeqSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as OpenEndedQuestion[];
      oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

      // Construct HTML exactly matching optimized formatting in ChatSidebar.tsx
      const themeAccentColor = secondaryColor || '#ff3e00';

      const header = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>ActiveDeck Chat & Poll Log</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    margin: 40px;
    background-color: #f8fafc;
    line-height: 1.5;
  }
  .container {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    background-color: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    text-align: left;
  }
  .header {
    border-bottom: 3px solid ${themeAccentColor};
    padding-bottom: 20px;
    margin-bottom: 30px;
    text-align: center;
  }
  .header h1 {
    font-size: 26px;
    margin: 0 0 8px 0;
    color: #0f172a;
    font-weight: 800;
    text-align: center;
  }
  .header p {
    font-size: 13px;
    color: #64748b;
    margin: 0;
    text-align: center;
  }
  .log-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 30px;
    table-layout: fixed;
  }
  .log-table th {
    background-color: #f1f5f9;
    color: #475569;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 6px;
    border-bottom: 2px solid #cbd5e1;
  }
  .log-table td {
    padding: 12px 6px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 13px;
    vertical-align: top;
    color: #334155;
    word-break: break-word;
    word-wrap: break-word;
  }
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .badge-message {
    background-color: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }
  .badge-question {
    background-color: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fca5a5;
  }
  .badge-slide {
    background-color: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
  }
  .badge-likes {
    background-color: #fef08a;
    color: #854d0e;
    border: 1px solid #fde047;
    margin-left: 4px;
  }
  .card {
    width: 100%;
    border-collapse: collapse;
    margin: 24px 0;
    background-color: #ffffff;
  }
  .card-mcq {
    border: 1px solid #fca5a5;
    border-left: 6px solid ${themeAccentColor};
    background-color: #fff5f2;
  }
  .card-wordcloud {
    border: 1px solid #93c5fd;
    border-left: 6px solid #3b82f6;
    background-color: #eff6ff;
  }
  .card-openended {
    border: 1px solid #6ee7b7;
    border-left: 6px solid #10b981;
    background-color: #f0fdf4;
  }
  .card-title {
    font-weight: 800;
    font-size: 15px;
    margin: 0 0 4px 0;
    color: #0f172a;
    text-align: center;
  }
  .card-subtitle {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
    margin: 0 0 12px 0;
    text-align: center;
  }
  .card-meta {
    font-size: 11px;
    color: #64748b;
    margin: 0 0 16px 0;
    text-align: center;
  }
  .poll-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .poll-table td {
    padding: 6px 10px;
    border: none;
    font-size: 13px;
    word-break: break-word;
    word-wrap: break-word;
  }
  .word-pill {
    display: inline-block;
    padding: 5px 10px;
    background-color: #ffffff;
    color: #1e293b;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    margin-right: 6px;
    margin-bottom: 6px;
    font-size: 12px;
    word-break: break-all;
  }
  .response-box {
    padding: 10px 14px;
    background-color: #ffffff;
    border-left: 3px solid #10b981;
    border-radius: 0 4px 4px 0;
    margin-bottom: 8px;
    font-style: italic;
    font-size: 13px;
    color: #334155;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    word-break: break-word;
    word-wrap: break-word;
  }
</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; margin: 40px; background-color: #f8fafc; line-height: 1.5;">
  <!-- Centering Outer Layout Table with 100% width for Word compatibility -->
  <table align="center" width="100%" style="width: 100%; max-width: 720px; margin: 0 auto; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); text-align: left;">
    <tr>
      <td style="padding: 40px; border: none; vertical-align: top; background-color: #ffffff;">
        <div class="header" style="border-bottom: 3px solid ${themeAccentColor}; padding-bottom: 20px; margin-bottom: 30px; text-align: center;">
          <h1 style="font-size: 26px; margin: 0 0 8px 0; color: #0f172a; font-weight: 800; text-align: center;">ActiveDeck Session Activity Log</h1>
          <p style="font-size: 13px; color: #64748b; margin: 0; text-align: center;">Generated on ${new Date().toLocaleString()}</p>
          <p style="font-size: 10px; font-family: monospace; color: #94a3b8; margin-top: 4px; text-align: center;">Session ID: ${targetSessionId}</p>
        </div>`;

      const footer = "</td></tr></table></body></html>";

      const combinedItems = [
        ...msgs.map(m => ({ ...m, type: 'message' as const })),
        ...ps.map(p => ({ ...p, type: 'poll' as const })),
        ...wcs.map(w => ({ ...w, type: 'wordCloud' as const })),
        ...oeqs.map(q => ({ ...q, type: 'openEnded' as const }))
      ].sort((a, b) => {
        const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
        const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
        return timeA - timeB;
      });

      let htmlContent = '';
      let isTableOpen = false;

      combinedItems.forEach(item => {
        if (item.type === 'message') {
          const m = item as Message;
          const dateObj = m.timestamp?.toDate() || new Date();
          const dateStr = dateObj.toLocaleDateString();
          const timeStr = dateObj.toLocaleTimeString();

          if (!isTableOpen) {
            htmlContent += `<table class="log-table" style="width: 100%; border-collapse: collapse; margin-bottom: 30px; table-layout: fixed;">
              <thead>
                <tr style="background-color: #f1f5f9;">
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 10%;">Date</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 12%;">Time</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: center; width: 8%;">Slide</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 13%;">Name</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 17%;">Email</th>
                  <th style="background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 6px; border-bottom: 2px solid #cbd5e1; text-align: left; width: 40%;">Question / Message</th>
                </tr>
              </thead>
              <tbody>`;
            isTableOpen = true;
          }

          const slideBadge = m.slide !== undefined && m.slide !== null
            ? `<span class="badge badge-slide" style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">Slide ${m.slide}</span>`
            : `-`;

          const likesBadge = m.likes 
            ? `<span class="badge badge-likes" style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; background-color: #fef08a; color: #854d0e; border: 1px solid #fde047; margin-left: 4px;">👍 ${m.likes}</span>`
            : '';

          const emailLink = m.userEmail
            ? `<a href="mailto:${m.userEmail}" style="color: #2563eb; text-decoration: none; border-bottom: 1px dotted #2563eb; word-break: break-all;">${m.userEmail}</a>`
            : '-';

          htmlContent += `<tr>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${dateStr}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${timeStr}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: center; word-break: break-word; word-wrap: break-word;">${slideBadge}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; font-weight: 600; text-align: left; word-break: break-word; word-wrap: break-word;">${m.userName}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-all; word-wrap: break-word;">${emailLink}</td>
            <td style="padding: 12px 6px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; color: #334155; text-align: left; word-break: break-word; word-wrap: break-word;"><strong>${formatHtmlTextWithLinks(m.text)}</strong>${likesBadge}</td>
          </tr>`;
        } else {
          if (isTableOpen) {
            htmlContent += `</tbody></table>`;
            isTableOpen = false;
          }

          if (item.type === 'poll') {
            const p = item as Poll;
            const dateObj = p.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = p.slide !== undefined ? ` [Slide ${p.slide}]` : '';
            const totalVotes = Object.values(p.votes || {}).reduce((a, b) => a + b, 0);

            let pollOptionsHtml = '';
            p.options.forEach(opt => {
              const count = p.votes[opt] || 0;
              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isCorrect = p.correctAnswer === opt;
              const correctBadge = isCorrect 
                ? `<span style="color: #10b981; font-weight: bold; margin-left: 8px; font-size: 12px;">✓ CORRECT ANSWER</span>` 
                : '';

              pollOptionsHtml += `<tr>
                <td style="width: 15%; font-weight: bold; padding: 6px 10px; border: none; font-size: 13px;">Option ${opt}</td>
                <td style="width: 50%; padding: 6px 10px; border: none;">
                  <table style="width: 100%; border: 1px solid #cbd5e1; border-collapse: collapse; height: 16px;">
                    <tr>
                      <td style="width: ${percentage}%; background-color: ${themeAccentColor}; border: none; padding: 0; height: 16px;"></td>
                      <td style="width: ${100 - percentage}%; background-color: #f1f5f9; border: none; padding: 0; height: 16px;"></td>
                    </tr>
                  </table>
                </td>
                <td style="width: 35%; padding: 6px 10px; border: none; font-size: 13px; word-break: break-word; word-wrap: break-word;">
                  <strong>${count} votes</strong> (${percentage}%)${correctBadge}
                </td>
              </tr>`;
            });

            htmlContent += `<table class="card card-mcq" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #fff5f2; border: 1px solid #fca5a5; border-left: 6px solid ${themeAccentColor}; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">📊 MCQ POLL RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <table class="poll-table" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                    ${pollOptionsHtml}
                  </table>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Votes: ${totalVotes}</p>
                </td>
              </tr>
            </table>`;

          } else if (item.type === 'wordCloud') {
            const w = item as WordCloud;
            const dateObj = w.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = w.slide !== undefined ? ` [Slide ${w.slide}]` : '';
            const totalWords = Object.values(w.words || {}).reduce((a, b) => a + b, 0);

            let wordPillsHtml = '';
            Object.entries(w.words || {}).sort((a, b) => b[1] - a[1]).forEach(([word, count]) => {
              wordPillsHtml += `<span class="word-pill" style="display: inline-block; padding: 5px 10px; background-color: #ffffff; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 16px; margin-right: 6px; margin-bottom: 6px; font-size: 12px; word-break: break-all;">
                <strong>${word}</strong> (${count})
              </span>`;
            });

            htmlContent += `<table class="card card-wordcloud" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #eff6ff; border: 1px solid #93c5fd; border-left: 6px solid #3b82f6; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">☁️ WORD CLOUD RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <h4 class="card-subtitle" style="font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 12px 0; text-align: center;">Prompt: "${w.prompt}"</h4>
                  <div style="margin-top: 12px; margin-bottom: 12px; text-align: center;">
                    ${wordPillsHtml || '<p style="font-size: 13px; color: #64748b; font-style: italic; text-align: center;">No entries recorded</p>'}
                  </div>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Submissions: ${totalWords}</p>
                </td>
              </tr>
            </table>`;

          } else if (item.type === 'openEnded') {
            const q = item as OpenEndedQuestion;
            const dateObj = q.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const slideStr = q.slide !== undefined ? ` [Slide ${q.slide}]` : '';
            const totalResponses = Object.values(q.responses || {}).length;

            let responsesHtml = '';
            Object.values(q.responses || {}).forEach(response => {
              responsesHtml += `<div class="response-box" style="padding: 10px 14px; background-color: #ffffff; border-left: 3px solid #10b981; border-radius: 0 4px 4px 0; margin-bottom: 8px; font-style: italic; font-size: 13px; color: #334155; border-top: none; border-right: none; border-bottom: none; word-break: break-word; word-wrap: break-word;">
                "${response}"
              </div>`;
            });

            htmlContent += `<table class="card card-openended" style="width: 100%; border-collapse: collapse; margin: 24px 0; background-color: #f0fdf4; border: 1px solid #6ee7b7; border-left: 6px solid #10b981; border-radius: 8px;">
              <tr>
                <td style="padding: 20px; border: none; text-align: left; vertical-align: top;">
                  <h3 class="card-title" style="font-weight: 800; font-size: 15px; margin: 0 0 4px 0; color: #0f172a; text-align: center;">💬 OPEN ENDED RESULTS</h3>
                  <p class="card-meta" style="font-size: 11px; color: #64748b; margin: 0 0 16px 0; text-align: center;">Triggered on ${dateStr} at ${timeStr}${slideStr}</p>
                  <h4 class="card-subtitle" style="font-size: 13px; font-weight: 600; color: #334155; margin: 0 0 12px 0; text-align: center;">Question: "${q.prompt}"</h4>
                  <div style="margin-top: 12px; margin-bottom: 12px;">
                    ${responsesHtml || '<p style="font-size: 13px; color: #64748b; font-style: italic; text-align: center;">No responses recorded</p>'}
                  </div>
                  <p style="margin-top: 12px; margin-bottom: 0; font-size: 12px; font-weight: bold; color: #475569; text-align: center;">Total Responses: ${totalResponses}</p>
                </td>
              </tr>
            </table>`;
          }
        }
      });

      if (isTableOpen) {
        htmlContent += `</tbody></table>`;
      }

      const html = header + htmlContent + footer;
      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat-log-session-${targetSessionId.substring(0, 8)}.doc`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading chat log:", err);
      alert("Failed to download chat log: " + err);
    } finally {
      setIsDownloadingChatLog(false);
      setDownloadingSessionId(null);
    }
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
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      
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
          <button
            onClick={() => setActiveTab('sessions')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === 'sessions' 
                ? 'bg-osu-orange text-white shadow-lg shadow-orange-500/10' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            Sessions
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
        <div className={`w-full transition-all duration-300 ${activeTab === 'attendance' ? 'max-w-[1450px]' : (activeTab === 'presenters' || activeTab === 'sessions') ? 'max-w-[1100px]' : 'max-w-5xl'}`}>

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

                {/* Feature Toggles */}
                <div className="border-t border-slate-800/80 pt-6 mt-6 space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Feature Configurations
                  </h3>
                  <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div>
                      <div className="text-sm font-bold text-white">Enable Attendance Registry</div>
                      <div className="text-[11px] text-slate-500">Show the attendance features and download options in the chat and header.</div>
                    </div>
                    <button
                      onClick={async () => {
                        const newShow = !showAttendance;
                        setShowAttendance(newShow);
                        try {
                          await setDoc(doc(db, 'settings', 'global'), {
                            showAttendance: newShow
                          }, { merge: true });
                          if (newShow && presentationId) {
                            await updateDoc(doc(db, 'presentations', presentationId), {
                              disableAttendance: false
                            });
                          }
                        } catch (err) {
                          console.error("AdminPortal: Error updating showAttendance setting:", err);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        showAttendance ? 'bg-osu-orange' : 'bg-slate-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          showAttendance ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
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
            !showAttendance ? (
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center min-h-[400px] max-w-2xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
                <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/5">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-white uppercase tracking-wider">Attendance Registry Disabled</h3>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                    The Attendance Registry features are currently turned off. Historical session logs and live roster tracking are deactivated.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('theme')}
                  className="px-6 py-3 bg-osu-orange hover:bg-[#c03900] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-500/10 active:scale-[0.98] cursor-pointer"
                >
                  Enable in Configurations
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-300 pb-12">
              
              {/* Left Column: Chronological Session Logs */}
              <div className="lg:col-span-3 flex flex-col gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col h-[650px] overflow-hidden">
                  
                  {/* Sidebar Header with Bulk Actions */}
                  <div className="border-b border-slate-800 pb-3 mb-4 flex-shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {activeSessions.filter(s => s.id !== presentationId).length > 0 && (
                        <input
                          type="checkbox"
                          checked={
                            activeSessions.filter(s => s.id !== presentationId).length > 0 &&
                            activeSessions.filter(s => s.id !== presentationId).every(s => selectedSessionIdsForBulk.includes(s.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const eligibleIds = activeSessions
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
                    {loadingSessions && activeSessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-24">
                        <Loader2 className="w-8 h-8 text-osu-orange animate-spin mb-3" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Loading sessions...</span>
                      </div>
                    ) : activeSessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                        <AlertCircle className="w-8 h-8 text-slate-600 mb-3" />
                        <p className="text-xs text-slate-500 italic">No presentation sessions found.</p>
                      </div>
                    ) : (
                      activeSessions.map((session) => {
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
              <div className="lg:col-span-9">
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
                  <div className="flex flex-col gap-6 h-[650px] overflow-hidden">
                    {/* Dashboard header card */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
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
                          title={filteredAttendance.length === 0 ? "No attendance records to export for this session" : "Download Attendance CSV Sheet"}
                        >
                          <Download className="w-4 h-4" />
                          Download Attendance CSV
                        </button>
                      </div>
                    </div>

                    {/* Real-Time Live Roster Table Card */}
                    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden flex-1 flex flex-col min-h-0">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2 flex-shrink-0">
                        <UserCheck className="w-4 h-4 text-green-500" />
                        {selectedSessionId === presentationId ? 'Live Attendance Roster' : 'Attendance Roster Log'}
                      </h3>

                      <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40 flex-1 flex flex-col min-h-0">
                        <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 sticky top-0 z-10">
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
          )
        )}

          {/* ========================================================
              TAB 3: PRESENTERS WORKSPACE
              ======================================================== */}
          {activeTab === 'presenters' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Add Whitelisted Presenter Form Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-sm font-black uppercase tracking-wider text-white mb-4 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-osu-orange" />
                  Whitelist Authorized Presenter
                </h3>
                <form onSubmit={handleAddPresenter} className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1 space-y-1.5 w-full">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-400">Presenter Email Address</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-4 top-3.5" />
                      <input 
                        type="email" 
                        value={newPresenterEmail}
                        onChange={(e) => setNewPresenterEmail(e.target.value)}
                        placeholder="e.g. name@institution.edu"
                        required
                        className="w-full h-11 rounded-xl bg-slate-950 border border-slate-800 text-sm pl-11 pr-4 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isAddingPresenter}
                    className="h-11 px-6 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-800 disabled:text-slate-650 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-orange-500/10 flex items-center gap-2 cursor-pointer w-full md:w-auto justify-center"
                  >
                    {isAddingPresenter ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    Add To Whitelist
                  </button>
                </form>
              </div>

              {/* Whitelisted Directory Table Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
                  <div className="space-y-1">
                    <h2 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2.5">
                      <Monitor className="w-5 h-5 text-osu-orange" />
                      Whitelisted Presenters Directory
                    </h2>
                    <p className="text-xs text-slate-400">
                      Authorized presenter accounts allowed to create and host presentation sessions.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {selectedPresenterKeysForBulk.length > 0 && (
                      <button
                        onClick={() => handleDeletePresenters(selectedPresenterKeysForBulk)}
                        disabled={isDeletingPresenters}
                        className="flex items-center gap-1.5 h-11 px-4 bg-red-950/40 hover:bg-red-900 border border-red-500/30 text-xs font-black uppercase tracking-wider text-red-400 hover:text-white rounded-xl transition-all cursor-pointer"
                      >
                        {isDeletingPresenters ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Remove Selected ({selectedPresenterKeysForBulk.length})
                      </button>
                    )}
                    <div className="bg-slate-950 px-4 py-2 border border-slate-800 rounded-xl text-right">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Whitelisted Presenters</span>
                      <span className="text-lg font-black text-osu-orange">{whitelistedPresenters.length}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                          <th className="py-3 px-5 text-center w-12">
                            <input
                              type="checkbox"
                              checked={whitelistedPresenters.length > 0 && whitelistedPresenters.filter(p => p.email.toLowerCase() !== 'justin.zumwalt@okstate.edu').every(p => selectedPresenterKeysForBulk.includes(p.email))}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPresenterKeysForBulk(
                                    whitelistedPresenters
                                      .filter(p => p.email.toLowerCase() !== 'justin.zumwalt@okstate.edu')
                                      .map(p => p.email)
                                  );
                                } else {
                                  setSelectedPresenterKeysForBulk([]);
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-700 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer"
                            />
                          </th>
                          <th className="py-3 px-5">Presenter Display Name</th>
                          <th className="py-3 px-5">Presenter Email Address</th>
                          <th className="py-3 px-5">Date Whitelisted</th>
                          <th className="py-3 px-5 text-center">Sessions Hosted</th>
                          <th className="py-3 px-5">Latest Session Date & Time</th>
                          <th className="py-3 px-5 text-right w-20">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingWhitelisted && whitelistedPresenters.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-16 text-center">
                              <Loader2 className="w-8 h-8 text-osu-orange animate-spin mx-auto mb-2" />
                              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Loading whitelist directory...</span>
                            </td>
                          </tr>
                        ) : whitelistedPresenters.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-16 text-center text-slate-500 text-xs italic">
                              No presenter accounts have been whitelisted yet. Enter an email address above to add one.
                            </td>
                          </tr>
                        ) : (
                          whitelistedPresenters.map((presenter, i) => {
                            const displayHandle = presenter.email.split('@')[0];
                            const addedDateString = presenter.addedAt 
                              ? new Date(presenter.addedAt.seconds * 1000).toLocaleDateString()
                              : '—';
                            const lastUsedDateString = presenter.lastUsedAt
                              ? new Date(presenter.lastUsedAt.seconds * 1000).toLocaleString()
                              : 'Never Used';
                            const isCreator = presenter.email.toLowerCase() === 'justin.zumwalt@okstate.edu';
                            
                            return (
                              <tr key={i} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40 text-sm transition-colors">
                                <td className="py-4 px-5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedPresenterKeysForBulk.includes(presenter.email)}
                                    disabled={isCreator}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedPresenterKeysForBulk(prev => [...prev, presenter.email]);
                                      } else {
                                        setSelectedPresenterKeysForBulk(prev => prev.filter(k => k !== presenter.email));
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-slate-700 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                                  />
                                </td>
                                <td className="py-4 px-5 font-bold text-white capitalize">{displayHandle}</td>
                                <td className="py-4 px-5 text-slate-300 font-mono text-xs">{presenter.email}</td>
                                <td className="py-4 px-5 text-slate-400 text-xs">{addedDateString}</td>
                                <td className="py-4 px-5 text-center font-black text-osu-orange">
                                  <span className="bg-osu-orange/10 px-3 py-1 rounded-full border border-osu-orange/20">
                                    {presenter.usageCount || 0} sessions
                                  </span>
                                </td>
                                <td className="py-4 px-5 text-slate-400 font-mono text-xs font-semibold">
                                  {lastUsedDateString}
                                </td>
                                <td className="py-4 px-5 text-right">
                                  {isCreator ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/20" title="Creator account: Protected from removal">
                                      Owner
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleDeletePresenters([presenter.email])}
                                      disabled={isDeletingPresenters}
                                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 cursor-pointer disabled:opacity-50"
                                      title="Remove Presenter Whitelist"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
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

            </div>
          )}

          {/* ========================================================
              TAB 4: SESSIONS WORKSPACE
              ======================================================== */}
          {activeTab === 'sessions' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Sessions Search and Header Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2.5">
                      <History className="w-5 h-5 text-osu-orange" />
                      Hosted Sessions Directory
                    </h2>
                    <p className="text-xs text-slate-400">
                      View all active and historic presentation sessions and export their chat/activity logs.
                    </p>
                  </div>
                  
                  {/* Actions & Search */}
                  <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                    {selectedSessionIdsForBulk.length > 0 && (
                      <button
                        onClick={handleBulkDelete}
                        disabled={isDeletingSessions}
                        className="flex items-center gap-1.5 h-11 px-4 bg-red-950/40 hover:bg-red-900 border border-red-500/30 text-xs font-black uppercase tracking-wider text-red-400 hover:text-white rounded-xl transition-all cursor-pointer shrink-0 animate-in zoom-in-95 duration-205"
                      >
                        {isDeletingSessions ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Delete Selected ({selectedSessionIdsForBulk.length})
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleCleanupOldSessions}
                      disabled={isDeletingSessions}
                      className="flex items-center gap-1.5 h-11 px-4 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-xs font-black uppercase tracking-wider text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer shrink-0"
                      title="Permanently clean up all sessions and slide storage files older than 30 days"
                    >
                      {isDeletingSessions ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Database className="w-4 h-4 text-osu-orange" />
                      )}
                      Clean Up (Older than 30d)
                    </button>
                    
                    <div className="relative w-full sm:w-64">
                      <input 
                        type="text"
                        value={sessionSearch}
                        onChange={(e) => setSessionSearch(e.target.value)}
                        placeholder="Search sessions..."
                        className="w-full h-11 rounded-xl bg-slate-950 border border-slate-800 text-xs pl-4 pr-10 text-white placeholder-slate-600 focus:outline-none focus:border-osu-orange transition-all"
                      />
                      {sessionSearch && (
                        <button 
                          onClick={() => setSessionSearch('')}
                          className="absolute right-3 top-3.5 text-[10px] uppercase tracking-wider font-black text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="bg-slate-950 px-4 py-1.5 border border-slate-800 rounded-xl text-center shrink-0">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 block leading-none">Sessions</span>
                      <span className="text-sm font-black text-osu-orange leading-normal">{activeSessions.length}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sessions List Table Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 overflow-hidden">
                <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-950/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-black tracking-widest text-slate-400">
                          <th className="py-3 px-5 text-center w-12">
                            <input
                              type="checkbox"
                              checked={
                                filteredSessions.length > 0 &&
                                filteredSessions
                                  .filter(s => s.id !== presentationId)
                                  .every(s => selectedSessionIdsForBulk.includes(s.id))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedSessionIdsForBulk(
                                    filteredSessions
                                      .filter(s => s.id !== presentationId)
                                      .map(s => s.id)
                                  );
                                } else {
                                  setSelectedSessionIdsForBulk([]);
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-700 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer"
                            />
                          </th>
                          <th className="py-3 px-5">Session ID</th>
                          <th className="py-3 px-5">Presenter Name</th>
                          <th className="py-3 px-5">Presenter Email</th>
                          <th className="py-3 px-5">Date Hosted</th>
                          <th className="py-3 px-5">Time Hosted</th>
                          <th className="py-3 px-5 text-right w-48">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingSessions && activeSessions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-16 text-center">
                              <Loader2 className="w-8 h-8 text-osu-orange animate-spin mx-auto mb-2" />
                              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Loading sessions directory...</span>
                            </td>
                          </tr>
                        ) : filteredSessions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-16 text-center text-slate-500 text-xs italic">
                              No presentation sessions matched your search criteria.
                            </td>
                          </tr>
                        ) : (
                          filteredSessions.map((session, i) => {
                            const presenterEmail = session.presenterEmail || '—';
                            const displayHandle = session.presenterEmail 
                              ? session.presenterEmail.split('@')[0].replace(/[._]/g, ' ') 
                              : '—';
                            
                            const dateObj = session.createdAt ? new Date(session.createdAt.seconds * 1000) : null;
                            const dateStr = dateObj ? dateObj.toLocaleDateString() : '—';
                            const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                            const isDownloadingThis = downloadingSessionId === session.id;
                            const isActiveSession = session.id === presentationId;

                            return (
                              <tr key={session.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40 text-sm transition-colors">
                                <td className="py-4 px-5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedSessionIdsForBulk.includes(session.id)}
                                    disabled={isActiveSession}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedSessionIdsForBulk(prev => [...prev, session.id]);
                                      } else {
                                        setSelectedSessionIdsForBulk(prev => prev.filter(id => id !== session.id));
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-slate-700 text-osu-orange focus:ring-osu-orange/20 bg-slate-950 cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                                  />
                                </td>
                                <td className="py-4 px-5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-osu-orange font-bold select-all">{session.id}</span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(session.id);
                                      }}
                                      className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                                      title="Copy Session ID"
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                                <td className="py-4 px-5 font-bold text-white capitalize">{displayHandle}</td>
                                <td className="py-4 px-5 text-slate-300 font-mono text-xs">{presenterEmail}</td>
                                <td className="py-4 px-5 text-slate-400 text-xs">{dateStr}</td>
                                <td className="py-4 px-5 text-slate-400 text-xs font-semibold">{timeStr}</td>
                                <td className="py-4 px-5 text-right flex items-center justify-end gap-2.5">
                                  <button
                                    type="button"
                                    onClick={() => setDownloadModalSessionId(session.id)}
                                    disabled={isDownloadingChatLog}
                                    className="flex items-center gap-1.5 h-9 px-3.5 bg-slate-800 hover:bg-slate-750 disabled:bg-slate-900 disabled:text-slate-650 text-slate-200 text-xs font-black uppercase tracking-wider rounded-xl transition-all border border-slate-700/50 cursor-pointer"
                                    title="Download Session Options"
                                  >
                                    {isDownloadingThis ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5 text-osu-orange" />
                                    )}
                                    Download Options
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSession(session.id)}
                                    disabled={isDeletingSessions || isActiveSession}
                                    className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                                    title={isActiveSession ? "Active Live Presentation Session (Cannot Delete)" : "Delete Session"}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
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

            </div>
          )}
        </div>
      </main>
      {/* Download Options Modal Overlay for Admins */}
      {downloadModalSessionId && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-205"
          onClick={() => setDownloadModalSessionId(null)}
        >
          <div 
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full text-center relative animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button 
              onClick={() => setDownloadModalSessionId(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer border-0 bg-transparent"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-10 h-10 bg-indigo-600/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Download className="w-5 h-5 text-indigo-600" />
            </div>
            
            <h2 className="text-lg font-black text-slate-900 mb-2">Download Session Data</h2>
            <p className="text-slate-500 text-xs mb-6 leading-relaxed text-center text-slate-600">
              Choose how you would like to download the data for presentation session <span className="font-mono font-bold text-slate-800">{downloadModalSessionId.substring(0, 8)}</span>.
            </p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={async () => {
                  const sid = downloadModalSessionId;
                  setDownloadModalSessionId(null);
                  await handleDownloadPresentation(sid, true);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md border-0"
              >
                <FileText className="w-4.5 h-4.5 text-white" />
                <span>Presentation + Chat Log (.docx)</span>
              </button>

              <button
                onClick={async () => {
                  const sid = downloadModalSessionId;
                  setDownloadModalSessionId(null);
                  await handleDownloadPresentation(sid, false);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer shadow-md border-0"
              >
                <PresentationIcon className="w-4.5 h-4.5 text-white" />
                <span>Presentation Only (.docx)</span>
              </button>

              <button
                onClick={() => {
                  const sid = downloadModalSessionId;
                  setDownloadModalSessionId(null);
                  handleDownloadChatLog(sid);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-bold transition-all active:scale-[0.98] cursor-pointer border border-slate-200 shadow-sm"
              >
                <Send className="w-4.5 h-4.5 text-slate-500" />
                <span>Chat Log Only (.doc)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
