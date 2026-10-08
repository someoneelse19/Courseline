import { Component, type ErrorInfo, type ReactNode } from 'react';

// Catches render-time crashes only. API failures are NOT thrown — they come back
// as `error` from useQuery and are shown with <ErrorMessage>.
// Error boundaries must be class components (React has no hook equivalent).
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // TODO: send to an error tracker (Sentry etc.)
    console.error('UI crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        <h2 className="text-lg font-semibold">This page crashed</h2>
        <p className="mt-1 text-sm">{this.state.error.message}</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }
}
