import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary - Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      console.log('ErrorBoundary - Rendering error fallback. Error:', this.state.error);
      let errorMessage = this.state.error?.message || "Something went wrong.";
      let errorStack = this.state.error?.stack || "";
      
      try {
        const parsedError = JSON.parse(this.state.error?.message || "");
        if (parsedError.error && parsedError.error.includes("insufficient permissions")) {
          errorMessage = "You don't have permission to perform this action. Please sign in or contact the presenter.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8 text-center overflow-auto">
          <div className="max-w-2xl w-full bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
            <h2 className="text-2xl font-black text-osu-orange mb-4 uppercase tracking-tighter italic">Application Error</h2>
            <p className="text-slate-300 mb-6 font-medium">{errorMessage}</p>
            
            {errorStack && (
              <pre className="text-[10px] text-slate-500 bg-black/30 p-4 rounded-lg mb-8 text-left overflow-auto max-h-48 font-mono">
                {errorStack}
              </pre>
            )}

            <button
              className="px-8 py-3 bg-osu-orange text-white rounded-full font-black uppercase tracking-widest hover:bg-orange-500 transition-all active:scale-95"
              onClick={() => window.location.reload()}
            >
              Reload ActiveDeck
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
