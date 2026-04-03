import React, { useEffect, useRef, useState } from 'react';
import { Presentation } from '../types';
import { ScreenCapture } from './ScreenCapture';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PresenterAreaProps {
  presentation: Presentation | null;
}

export const PresenterArea: React.FC<PresenterAreaProps> = ({ presentation }) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      console.log('ActiveDeck: Connecting to local bridge via WebSocket (ws://127.0.0.1:5000/ws)...');
      
      try {
        socket = new WebSocket('ws://127.0.0.1:5000/ws');

        socket.onopen = () => {
          console.log('ActiveDeck: WebSocket connection established.');
          setIsConnected(true);
        };

        socket.onclose = () => {
          console.log('ActiveDeck: WebSocket connection closed. Attempting to reconnect in 3s...');
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        socket.onerror = (error) => {
          console.error('ActiveDeck: WebSocket connection error. Ensure your bridge is running.');
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

  const handleSlideMove = (direction: 'next' | 'prev') => {
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
    <div className="flex flex-col h-full bg-black relative group">
      {/* Main Content Area */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <ScreenCapture />
      </div>

      {/* Professional Remote Control Overlay */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 p-2 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-700/50 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 translate-y-4 group-hover:translate-y-0 z-50">
        <button
          onClick={() => handleSlideMove('prev')}
          className="flex items-center justify-center w-14 h-14 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-all active:scale-95 border border-slate-700 group/btn"
          title="Previous Slide"
        >
          <ChevronLeft className="w-8 h-8 group-hover/btn:-translate-x-0.5 transition-transform" />
        </button>
        
        <div className="w-px h-8 bg-slate-700 mx-1" />

        <button
          onClick={() => handleSlideMove('next')}
          className="flex items-center justify-center w-14 h-14 bg-osu-orange hover:bg-[#c03900] text-white rounded-xl transition-all active:scale-95 border border-orange-600 group/btn shadow-[0_0_15px_rgba(255,62,0,0.3)]"
          title="Next Slide"
        >
          <ChevronRight className="w-8 h-8 group-hover/btn:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
};
