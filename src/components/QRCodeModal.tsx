import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, QrCode } from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ isOpen, onClose, url }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 relative animate-in zoom-in duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-slate-100 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-slate-400" />
        </button>

        <div className="text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <QrCode className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">JOIN THE CHAT</h2>
          <p className="text-slate-500 mb-8 text-sm">Scan this code with your phone to participate in the real-time discussion.</p>
          
          <div className="bg-white p-4 rounded-xl border-2 border-slate-100 inline-block mb-6 shadow-sm">
            <QRCodeSVG 
              value={url} 
              size={300}
              level="H"
              includeMargin={false}
              className="mx-auto"
            />
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 tracking-widest">Direct Link</p>
            <p className="text-xs font-mono text-indigo-600 break-all">{url}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
