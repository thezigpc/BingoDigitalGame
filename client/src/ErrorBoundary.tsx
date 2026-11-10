import { Component, type ReactNode } from "react";

/** Last-resort catch so a render bug shows a way back instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("UI crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="center-page">
        <div className="panel">
          <h2>Something went wrong</h2>
          <p className="muted">Reloading usually fixes it. You'll stay in your room.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
