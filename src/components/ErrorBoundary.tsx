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
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      
      try {
        const parsedError = JSON.parse(this.state.error?.message || "");
        if (parsedError.error && parsedError.error.includes("insufficient permissions")) {
          errorMessage = "You don't have permission to perform this action. Please sign in or contact the presenter.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="p-8 text-center bg-white rounded-xl shadow-lg border border-slate-200 m-4">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Application Error</h2>
          <p className="text-slate-600 mb-6">{errorMessage}</p>
          <button
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors"
            onClick={() => window.location.reload()}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
