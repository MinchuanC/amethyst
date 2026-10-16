import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What broke, in the user's words, e.g. "The graph". */
  area: string;
  children: ReactNode;
  quiet?: boolean;
}

interface State {
  error: Error | null;
}

/** Keeps one broken panel from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.area} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="error-panel" role="alert">
        <p className="error-title">{this.props.area} stopped working.</p>
        <p className="error-detail">{this.state.error.message}</p>
        <button type="button" className="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
