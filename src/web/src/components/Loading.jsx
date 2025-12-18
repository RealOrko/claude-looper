import React from 'react';
import { Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';

// Spinner component
export function Spinner({ size = 24, className = '' }) {
  return (
    <Loader2
      size={size}
      className={`spinner ${className}`}
    />
  );
}

// Full page loading overlay
export function LoadingOverlay({ message = 'Loading...' }) {
  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <Spinner size={48} />
        <p>{message}</p>
      </div>
    </div>
  );
}

// Skeleton loader for text
export function SkeletonText({ width = '100%', height = '1rem', className = '' }) {
  return (
    <div
      className={`skeleton skeleton-text ${className}`}
      style={{ width, height }}
    />
  );
}

// Skeleton loader for circular elements
export function SkeletonCircle({ size = 40, className = '' }) {
  return (
    <div
      className={`skeleton skeleton-circle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// Skeleton loader for rectangular blocks
export function SkeletonBlock({ width = '100%', height = '100px', className = '' }) {
  return (
    <div
      className={`skeleton skeleton-block ${className}`}
      style={{ width, height }}
    />
  );
}

// Skeleton card placeholder
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`skeleton-card ${className}`}>
      <div className="skeleton-card-header">
        <SkeletonCircle size={32} />
        <div className="skeleton-card-title">
          <SkeletonText width="60%" height="1rem" />
          <SkeletonText width="40%" height="0.75rem" />
        </div>
      </div>
      <SkeletonBlock height="60px" />
    </div>
  );
}

// Connection status indicator
export function ConnectionStatus({ connected, reconnecting, onReconnect }) {
  if (connected) {
    return (
      <div className="connection-status connected">
        <Wifi size={16} />
        <span>Connected</span>
      </div>
    );
  }

  return (
    <div className="connection-status disconnected">
      <WifiOff size={16} />
      <span>{reconnecting ? 'Reconnecting...' : 'Disconnected'}</span>
      {!reconnecting && onReconnect && (
        <button className="reconnect-btn" onClick={onReconnect}>
          <RefreshCw size={14} />
          Reconnect
        </button>
      )}
    </div>
  );
}

// Empty state component
export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={48} className="empty-icon" />}
      {title && <h3>{title}</h3>}
      {message && <p>{message}</p>}
      {action && (
        <button className="empty-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// Inline loading indicator
export function InlineLoading({ text = 'Loading' }) {
  return (
    <span className="inline-loading">
      <Spinner size={14} />
      <span>{text}</span>
    </span>
  );
}

export default {
  Spinner,
  LoadingOverlay,
  SkeletonText,
  SkeletonCircle,
  SkeletonBlock,
  SkeletonCard,
  ConnectionStatus,
  EmptyState,
  InlineLoading,
};
