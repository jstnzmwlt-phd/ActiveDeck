import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

interface BridgeContextType {
  isBridgeConnected: boolean;
  useWithoutBridge: boolean;
  setUseWithoutBridge: (value: boolean) => void;
  sendSlideCommand: (direction: 'next' | 'prev') => void;
}

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [isBridgeConnected, setIsBridgeConnected] = useState(false);
  const [useWithoutBridge, setUseWithoutBridge] = useState(false);

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

  const sendSlideCommand = (direction: 'next' | 'prev') => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`ActiveDeck: Sending '${direction}' command via WebSocket...`);
      wsRef.current.send(direction);
    } else {
      console.warn(`ActiveDeck: WebSocket not connected. Falling back to background trigger for ${direction}...`);
      // Fallback to Image trick if WebSocket is unavailable
      const img = new Image();
      img.src = `http://127.0.0.1:5000/${direction}?t=${new Date().getTime()}`;
    }
  };

  return (
    <BridgeContext.Provider value={{ 
      isBridgeConnected, 
      useWithoutBridge, 
      setUseWithoutBridge, 
      sendSlideCommand 
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
