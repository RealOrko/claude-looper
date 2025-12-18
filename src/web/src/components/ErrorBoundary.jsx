import React from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log error to console for debugging
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      const { fallback: Fallback } = this.props;

      if (Fallback) {
        return (
          <Fallback
            error={this.state.error}
            errorInfo={this.state.errorInfo}
            onReset={this.handleReset}
          />
        );
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-icon">
              <AlertTriangle size={64} />
            </div>
            <h1>Something went wrong</h1>
            <p className="error-message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>

            <div className="error-actions">
              <button className="error-btn primary" onClick={this.handleReset}>
                <RefreshCw size={16} />
                Try Again
              </button>
              <button className="error-btn secondary" onClick={this.handleReload}>
                <RefreshCw size={16} />
                Reload Page
              </button>
              <button className="error-btn secondary" onClick={this.handleGoHome}>
                <Home size={16} />
                Go Home
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="error-details">
                <summary>
                  <Bug size={14} />
                  Technical Details
                </summary>
                <pre>{this.state.error?.stack}</pre>
                <pre>{this.state.errorInfo.componentStack}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Mini error boundary for smaller sections
export function SectionErrorBoundary({ children, fallbackMessage = 'Failed to load this section' }) {
  return (
    <ErrorBoundary
      fallback={({ error, onReset }) => (
        <div className="section-error">
          <AlertTriangle size={20} />
          <span>{fallbackMessage}</span>
          <button onClick={onReset}>Retry</button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
