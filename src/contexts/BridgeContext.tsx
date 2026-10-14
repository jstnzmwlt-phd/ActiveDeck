import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

interface BridgeContextType {
  isBridgeConnected: boolean;
  useWithoutBridge: boolean;
  setUseWithoutBridge: (value: boolean) => void;
  sendSlideCommand: (direction: 'next' | 'prev' | number) => void;
  sendBridgeCommand: (payload: any) => void;
  currentSlide: number | null;
  currentSlideBase64: string | null;
  nextSlide: number | null;
  nextSlideBase64: string | null;
  totalSlides: number | null;
  notes: string | null;
  clearNotesState: () => void;
  slideThumbnails: Record<number, string>;
  requestThumbnails: () => void;
  clearThumbnails: () => void;
}

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [isBridgeConnected, setIsBridgeConnected] = useState(false);
  const [useWithoutBridge, setUseWithoutBridge] = useState(false);
  const [currentSlide, setCurrentSlide] = useState<number | null>(null);
  const [currentSlideBase64, setCurrentSlideBase64] = useState<string | null>(null);
  const [nextSlide, setNextSlide] = useState<number | null>(null);
  const [nextSlideBase64, setNextSlideBase64] = useState<string | null>(null);
  const [totalSlides, setTotalSlides] = useState<number | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [slideThumbnails, setSlideThumbnails] = useState<Record<number, string>>({});

  const clearNotesState = () => {
    setCurrentSlide(null);
    setCurrentSlideBase64(null);
    setNextSlide(null);
    setNextSlideBase64(null);
    setTotalSlides(null);
    setNotes(null);
    setSlideThumbnails({});
  };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      console.log('ActiveDeck: Connecting to local bridge via WebSocket (ws://127.0.0.1:5000/ws)...');
      
      try {
        socket = new WebSocket('ws://127.0.0.1:5000/ws');

        socket.onopen = () => {
          console.log('ActiveDeck: WebSocket connection established.');
          setIsBridgeConnected(true);
          try {
            socket.send('status');
            socket.send(JSON.stringify({ action: 'get_thumbnails' }));
          } catch (e) {}
        };

        socket.onmessage = (event) => {
          const messageData = event.data;
          console.log('ActiveDeck: WebSocket message received:', messageData, 'Type:', typeof messageData);
          
          // Handle string format 'SLIDE:X' (case-insensitive)
          const upperMessage = typeof messageData === 'string' ? messageData.toUpperCase() : '';
          if (upperMessage.startsWith('SLIDE:')) {
            const slideNum = parseInt(upperMessage.split(':')[1], 10);
            if (!isNaN(slideNum)) {
              console.log('ActiveDeck: Parsed slide number:', slideNum);
              setCurrentSlide(slideNum);
              return;
            }
          }

          // Parse JSON format from bridge
          try {
            const data = JSON.parse(messageData);
            if (data && data.type === 'THUMBNAILS' && data.thumbnails) {
              console.log('ActiveDeck: Received all slide thumbnails from bridge:', Object.keys(data.thumbnails).length);
              const formatted: Record<number, string> = {};
              for (const [k, v] of Object.entries(data.thumbnails)) {
                const num = parseInt(k, 10);
                if (!isNaN(num) && typeof v === 'string') {
                  formatted[num] = v;
                }
              }
              setSlideThumbnails((prev) => ({ ...prev, ...formatted }));
            } else if (data && typeof data.current_slide === 'number') {
              console.log('ActiveDeck: Rich payload received (JSON):', data);
              setCurrentSlide(data.current_slide);
              const currentB64 = typeof data.current_slide_base64 === 'string' ? data.current_slide_base64 : null;
              setCurrentSlideBase64(currentB64);
              if (currentB64) {
                setSlideThumbnails((prev) => ({ ...prev, [data.current_slide]: currentB64 }));
              }
              const nextSlideNum = typeof data.next_slide === 'number' && data.next_slide > 0 ? data.next_slide : null;
              setNextSlide(nextSlideNum);
              const nextB64 = typeof data.next_slide_base64 === 'string' ? data.next_slide_base64 : null;
              setNextSlideBase64(nextB64);
              if (nextSlideNum && nextB64) {
                setSlideThumbnails((prev) => ({ ...prev, [nextSlideNum]: nextB64 }));
              }
              setTotalSlides(typeof data.total_slides === 'number' ? data.total_slides : null);
              setNotes(typeof data.notes === 'string' ? data.notes.replace(/\r/g, '\n') : null);
            } else if (data && data.type === 'SLIDE_UPDATE' && typeof data.slide === 'number') {
              console.log('ActiveDeck: Slide update received (JSON):', data.slide);
              setCurrentSlide(data.slide);
            }
          } catch (err) {
            // Ignore non-JSON messages that aren't SLIDE: format
          }
        };

        socket.onclose = () => {
          console.log('ActiveDeck: WebSocket connection closed. Attempting to reconnect in 3s...');
          setIsBridgeConnected(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        socket.onerror = (error) => {
          // Use warn instead of error to reduce console noise when bridge isn't running
          console.warn('ActiveDeck: WebSocket connection error. Ensure your bridge is running.');
        };

        wsRef.current = socket;
      } catch (err) {
        console.error('ActiveDeck: Failed to initialize WebSocket:', err);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (socket) {
        socket.onclose = null; // Prevent reconnection on unmount
        socket.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, []);

  const sendSlideCommand = (direction: 'next' | 'prev' | number) => {
    // Optimistic UI update: advance the slide counter and next slide immediately for responsive feedback
    if (typeof direction === 'number') {
      setCurrentSlide(direction);
      setCurrentSlideBase64(null);
      if (totalSlides !== null && direction < totalSlides) {
        setNextSlide(direction + 1);
      } else {
        setNextSlide(null);
      }
    } else if (direction === 'next') {
      setCurrentSlide((prev) => {
        if (prev === null) return 1;
        if (totalSlides !== null && prev >= totalSlides) return prev;
        const next = prev + 1;
        setNextSlide(totalSlides !== null && next < totalSlides ? next + 1 : null);
        if (nextSlideBase64) {
          setCurrentSlideBase64(nextSlideBase64);
          setNextSlideBase64(null);
        } else {
          setCurrentSlideBase64(null);
        }
        return next;
      });
    } else if (direction === 'prev') {
      setCurrentSlide((prev) => {
        if (prev === null || prev <= 1) return 1;
        const prevNum = prev - 1;
        setNextSlide(prev);
        setCurrentSlideBase64(null);
        return prevNum;
      });
    }

    const cmd = String(direction);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`ActiveDeck: Sending '${cmd}' command via WebSocket...`);
      wsRef.current.send(JSON.stringify({ action: 'move', direction: cmd }));
    } else {
      console.warn(`ActiveDeck: WebSocket not connected. Falling back to background trigger for ${cmd}...`);
      // Fallback to Image trick if WebSocket is unavailable
      const img = new Image();
      img.src = `http://127.0.0.1:5000/${cmd}?t=${new Date().getTime()}`;
    }
  };

  const sendBridgeCommand = (payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
      console.log('ActiveDeck: Sending command to bridge via WebSocket:', msg);
      wsRef.current.send(msg);
    } else {
      console.warn('ActiveDeck: WebSocket bridge not connected. Cannot send payload:', payload);
    }
  };

  const requestThumbnails = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ action: 'get_thumbnails' }));
      } catch (e) {}
    }
  };

  const clearThumbnails = () => {
    setSlideThumbnails({});
  };

  return (
    <BridgeContext.Provider value={{ 
      isBridgeConnected, 
      useWithoutBridge, 
      setUseWithoutBridge, 
      sendSlideCommand,
      sendBridgeCommand,
      currentSlide,
      currentSlideBase64,
      nextSlide,
      nextSlideBase64,
      totalSlides,
      notes,
      clearNotesState,
      slideThumbnails,
      requestThumbnails,
      clearThumbnails
    }}>
      {children}
    </BridgeContext.Provider>
  );
};

export const useBridge = () => {
  const context = useContext(BridgeContext);
  if (context === undefined) {
    throw new Error('useBridge must be used within a BridgeProvider');
  }
  return context;
};
