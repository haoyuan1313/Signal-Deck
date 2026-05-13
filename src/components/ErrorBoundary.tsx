import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false
  };

  constructor(props: Props) {
    super(props);
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    const { hasError } = this.state;
    if (hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-zinc-900 border border-zinc-800 rounded-2xl text-center gap-4">
          <div className="p-4 bg-rose-500/10 text-rose-500 rounded-full">
            <AlertTriangle size={32} />
          </div>
          <div>
            <h3 className="text-xl font-bold">Something went wrong</h3>
            <p className="text-zinc-500 text-sm mt-2 max-w-sm">
              We encountered an error while rendering this section. Try refreshing the page.
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors font-bold text-sm"
          >
            <RefreshCcw size={16} />
            Reload Page
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
