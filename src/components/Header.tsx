import React, { useState, useEffect } from 'react';
import { Monitor, Clock, Maximize, Minimize, Link2, Link2Off, Sun, Moon, Loader2, AlertCircle, Eye, EyeOff, Download, ShieldAlert, Mail, FileText, X } from 'lucide-react';
import { useBridge } from '../contexts/BridgeContext';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthProvider';

interface HeaderProps {
  presentationId?: string | null;
}

export const Header: React.FC<HeaderProps> = ({ presentationId }) => {
  const { isBridgeConnected, setUseWithoutBridge } = useBridge();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [isWakeLockLoading, setIsWakeLockLoading] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [presenterEmail, setPresenterEmail] = useState('');
  const { user } = useAuth();

  // Prefill email when user state loads or modal opens
  useEffect(() => {
    if (user?.email) {
      setPresenterEmail(user.email);
    }
  }, [user]);

  const fetchAttendanceRecords = async () => {
    if (!presentationId) return null;
    const attendanceRef = collection(db, 'presentations', presentationId, 'attendance');
    const qAttendance = query(attendanceRef, orderBy('checkedInAt', 'desc'));
    const querySnapshot = await getDocs(qAttendance);

    const records = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];

    if (records.length === 0) {
      throw new Error("NO_RECORDS");
    }

    const headers = ["Student Name", "Email Address", "Checked-In Timestamp", "Join Method", "Slide", "Institution", "Verification Status"];
    const rows = records.map(record => {
      const timestampString = record.checkedInAt 
        ? new Date(record.checkedInAt.seconds * 1000).toLocaleString() 
        : 'Pending Server Timestamp...';
      const slideString = record.slide !== null && record.slide !== undefined ? `Slide ${record.slide}` : '—';
      return [
        `"${(record.name || '').replace(/"/g, '""')}"`,
        `"${(record.email || '').replace(/"/g, '""')}"`,
        `"${timestampString}"`,
        `"${record.authMethod || 'QR'}"`,
        `"${slideString}"`,
        `"${(record.institutionName || 'Custom / Active Theme').replace(/"/g, '""')}"`,
        `"Verified Check-In"`
      ];
    });

    const csvText = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    return csvText;
  };

  const handleDownloadAttendance = async () => {
    setIsDownloading(true);
    try {
      const csvText = await fetchAttendanceRecords();
      if (!csvText) return;

      const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvText);
      const link = document.createElement("a");
      link.setAttribute("href", csvContent);
      link.setAttribute("download", `activedeck_attendance_session_${presentationId.substring(0, 8)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsExportModalOpen(false);
    } catch (err: any) {
      if (err.message === "NO_RECORDS") {
        alert("No students have checked in yet for this session.");
      } else {
        console.error("Error downloading attendance CSV:", err);
        alert("Failed to download attendance: " + (err?.message || err));
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleEmailAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presenterEmail.trim()) {
      alert("Please enter a valid email address.");
      return;
    }
    setIsEmailing(true);
    try {
      const csvText = await fetchAttendanceRecords();
      if (!csvText) return;

      const now = new Date();
      const dateString = now.toLocaleDateString();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const subject = `Attendance for ${dateString}, ${timeString}`;
      const fileName = `activedeck_attendance_session_${presentationId!.substring(0, 8)}.csv`;

      // Try using modern Web Share API if supported for files (attaches the CSV file directly)
      const csvFile = new File([csvText], fileName, { type: 'text/csv' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [csvFile] })) {
        try {
          await navigator.share({
            files: [csvFile],
            title: subject,
            text: `Please find attached the student attendance CSV file for session ${presentationId!.substring(0, 8)}.`
          });
          setIsExportModalOpen(false);
          return;
        } catch (shareErr: any) {
          if (shareErr.name === 'AbortError') {
            console.log("Web Share cancelled by user.");
            return;
          }
          console.warn("Web Share failed, falling back to mailto link:", shareErr);
        }
      }

      // Fallback: Copy to clipboard and open mailto link
      try {
        await navigator.clipboard.writeText(csvText);
      } catch (clipErr) {
        console.warn("Clipboard copy failed:", clipErr);
      }

      const body = `Hi,

Here is the student attendance CSV data for the presentation session ${presentationId!.substring(0, 8)}.

Note: Because browser security restricts directly attaching local files in client-side links, the attendance CSV content has also been automatically copied to your clipboard.

You can paste (Ctrl+V) the clipboard contents directly below, or paste them into a text editor (like Notepad) and save as a .csv file.

--------------------------------------------------
${csvText}
--------------------------------------------------`;

      const mailtoUrl = `mailto:${encodeURIComponent(presenterEmail.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      
      // Directly assign window.location.href to invoke Outlook or default client
      window.location.href = mailtoUrl;
      
      setIsExportModalOpen(false);
    } catch (err: any) {
      if (err.message === "NO_RECORDS") {
        alert("No students have checked in yet for this session.");
      } else {
        console.error("Error emailing attendance CSV:", err);
        alert("Failed to email attendance: " + (err?.message || err));
      }
    } finally {
      setIsEmailing(false);
    }
  };

  const handleNewSession = () => {
    const confirmNew = window.confirm("Are you sure you want to start a new session? This will redirect to a new URL, clear the chat, and reset the attendance list.");
    if (confirmNew) {
      sessionStorage.removeItem('activePresenterPresentationId');
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const hours = currentTime.getHours();
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');
  const minutes = currentTime.getMinutes().toString().padStart(2, '0');
  const seconds = currentTime.getSeconds().toString().padStart(2, '0');
  const amPm = hours >= 12 ? 'PM' : 'AM';

  // Centralized state cleanup and default-to-hidden behavior when modal is closed
  useEffect(() => {
    if (!isAdminModalOpen) {
      setAdminPassword('');
      setShowPassword(false);
      setPasswordError(null);
    }
  }, [isAdminModalOpen]);

  // Handle closing modal via Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAdminModalOpen(false);
      }
    };
    if (isAdminModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAdminModalOpen]);

  useEffect(() => {
    console.log('Header - Component mounted');
    return () => console.log('Header - Component unmounted');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.error("Error attempting to enable fullscreen:", err);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      console.warn("Wake Lock API not supported in this browser.");
      return;
    }

    if (isWakeLockLoading) return;
    setWakeLockError(null);

    try {
      setIsWakeLockLoading(true);
      if (!isWakeLockActive) {
        console.log("Header - Attempting to acquire Wake Lock...");
        const lock = await (navigator as any).wakeLock.request('screen');
        console.log("Header - Wake Lock acquired successfully");
        
        setWakeLock(lock);
        setIsWakeLockActive(true);
        
        lock.addEventListener('release', () => {
          console.log("Header - Wake Lock was released by the system");
          setIsWakeLockActive(false);
          setWakeLock(null);
        });
      } else {
        if (wakeLock) {
          console.log("Header - Releasing Wake Lock manually...");
          await wakeLock.release();
          setWakeLock(null);
          setIsWakeLockActive(false);
        }
      }
    } catch (err: any) {
      console.error("Header - Wake Lock error details:", {
        name: err.name,
        message: err.message,
        stack: err.stack
      });
      
      if (err.name === 'NotAllowedError') {
        setWakeLockError("Blocked by browser policy. Try opening in a new tab.");
      } else {
        setWakeLockError("Failed to activate wake lock.");
      }
      
      setIsWakeLockActive(false);
      setWakeLock(null);
    } finally {
      setIsWakeLockLoading(false);
    }
  };

  // Re-acquire wake lock if it was active and visibility changes
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (isWakeLockActive && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
        } catch (err: any) {
          if (err.name !== 'NotAllowedError') {
            console.error("Re-acquiring Wake Lock error:", err);
          }
          setIsWakeLockActive(false);
          setWakeLock(null);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isWakeLockActive]);

  return (
    <div className={`p-4 bg-white border-b border-slate-200 h-12 py-1 relative w-full flex-shrink-0 ${(isAdminModalOpen || isExportModalOpen) ? 'z-[200]' : 'z-50'}`}>
      <div className="flex items-center justify-between relative h-full">
        <div className="flex items-center gap-4 z-10">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-osu-orange" />
            Screen Presentation
          </h2>
          
          <button 
            onClick={() => !isBridgeConnected && setUseWithoutBridge(false)}
            disabled={isBridgeConnected}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ${
              isBridgeConnected 
                ? 'bg-green-50 border-green-200 text-green-600 cursor-default' 
                : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300 cursor-pointer'
            }`}
            title={!isBridgeConnected ? "Click to setup bridge" : "Bridge is connected"}
          >
            {isBridgeConnected ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            {isBridgeConnected ? 'Bridge Online' : 'Bridge Offline'}
          </button>

          {presentationId && (
            <button
              onClick={handleNewSession}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
              title="Start a new presentation session (Resets chat & attendance)"
            >
              <Monitor className="w-3.5 h-3.5 text-osu-orange" />
              <span>New Session</span>
            </button>
          )}
        </div>

        {/* Centered ActiveDeck Logo */}
        <div className="absolute inset-0 flex items-center justify-center">
            <h1 
              className="text-xl font-black tracking-tight text-slate-800 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => {
                console.log('Header - Admin click');
                setIsAdminModalOpen(true);
              }}
            >
              Active<span className="text-osu-orange">Deck</span>
            </h1>
        </div>

        <div className="flex items-center gap-4 z-10">
          {presentationId && (
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-osu-orange hover:bg-[#c03900] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-orange-500/10 active:scale-95 cursor-pointer"
              title="Export or Email Student Attendance"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Attendance</span>
            </button>
          )}

          <div className="flex items-center gap-2 text-lg font-mono font-bold text-slate-800 bg-white px-3 py-1 rounded-lg border-2 border-osu-orange shadow-sm">
            <Clock className="w-4 h-4 text-osu-orange" />
            <div className="flex items-baseline">
              <span>{displayHours}:{minutes}</span>
              <span className="text-[0.7em] opacity-60 ml-0.5">:{seconds}</span>
              <span className="text-[0.8em] ml-1.5 font-sans font-black text-osu-orange">{amPm}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-4 relative">
            {wakeLockError && (
              <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-red-600 text-white text-[10px] rounded shadow-lg animate-in fade-in slide-in-from-bottom-1">
                {wakeLockError}
              </div>
            )}
            <button 
              onClick={toggleWakeLock}
              disabled={isWakeLockLoading}
              className={`p-1.5 rounded-md transition-colors ${
                isWakeLockActive 
                  ? 'bg-amber-50 text-amber-600' 
                  : wakeLockError
                    ? 'bg-red-50 text-red-600'
                    : 'hover:bg-slate-100 text-slate-600'
              } ${isWakeLockLoading ? 'opacity-50 cursor-wait' : ''}`}
              title={isWakeLockActive ? "Screen Wake Lock Active" : wakeLockError || "Keep Screen Awake"}
            >
              {isWakeLockLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isWakeLockActive ? (
                <Sun className="w-5 h-5 animate-pulse" />
              ) : wakeLockError ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>
            <button 
              onClick={toggleFullscreen}
              className="p-1.5 hover:bg-slate-100 rounded-md transition-colors text-slate-600"
              title={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Admin Password Modal */}
      {isAdminModalOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setIsAdminModalOpen(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 max-w-sm w-full text-slate-100 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-2">Admin Portal Access</h3>
            <p className="text-xs text-slate-400 mb-4">Please enter the administrator password to access the portal.</p>
            
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (adminPassword === '@dm1N') {
                  console.log('Header - Password correct, setting hash');
                  setIsAdminModalOpen(false);
                  window.location.hash = '#admin';
                  window.dispatchEvent(new Event('hashchange'));
                } else {
                  setPasswordError('Invalid password');
                }
              }} 
              className="space-y-4"
            >
              <div className="space-y-1 relative">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    placeholder="••••••••"
                    required
                    autoFocus
                    className="w-full h-10 rounded px-3 pr-10 text-sm text-white bg-slate-800 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-osu-orange"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-red-500 font-bold mt-1 animate-in slide-in-from-top-1 duration-200">{passwordError}</p>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold text-white bg-osu-orange hover:bg-[#c03900] rounded-lg transition-colors shadow-lg shadow-orange-500/15"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance Export Modal */}
      {isExportModalOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setIsExportModalOpen(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 max-w-md w-full text-slate-100 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500 animate-pulse" />
                FERPA Security Alert
              </h3>
              <button 
                onClick={() => setIsExportModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300/90 leading-relaxed mb-6">
              <strong>Warning:</strong> Displaying student names, emails, or check-in records on a screen visible to others (such as a projector or screen share) violates FERPA privacy protections. Please pause or turn off your screen sharing before viewing or exporting attendance.
            </div>

            <div className="space-y-6">
              {/* Option 1: Direct CSV Download */}
              <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl flex items-center justify-between gap-4">
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-osu-orange" />
                    Download CSV file
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                    Download the attendance spreadsheet directly to your device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadAttendance}
                  disabled={isDownloading || isEmailing}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-700 hover:bg-slate-650 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  {isDownloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-osu-orange" />
                  )}
                  <span>Download</span>
                </button>
              </div>

              {/* Option 2: Email CSV */}
              <form onSubmit={handleEmailAttendance} className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-osu-orange" />
                    Email Attendance
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                    Send the attendance data directly to your inbox.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Presenter Email Address</label>
                  <input
                    type="email"
                    required
                    value={presenterEmail}
                    onChange={(e) => setPresenterEmail(e.target.value)}
                    placeholder="presenter@osu.edu"
                    className="w-full h-9 bg-slate-950 border border-slate-800 rounded px-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-osu-orange"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isDownloading || isEmailing || !presenterEmail.trim()}
                  className="w-full h-9 bg-osu-orange hover:bg-[#c03900] disabled:bg-slate-850 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-widest rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isEmailing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  <span>Email Attendance</span>
                </button>
              </form>
            </div>
            
            <div className="flex justify-end mt-6 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
