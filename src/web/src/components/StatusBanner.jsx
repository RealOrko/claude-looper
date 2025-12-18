import React from 'react';
import { AlertTriangle, Info, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

const typeConfig = {
  info: { icon: Info, className: 'info' },
  success: { icon: CheckCircle2, className: 'success' },
  warning: { icon: AlertTriangle, className: 'warning' },
  error: { icon: XCircle, className: 'error' },
};

export default function StatusBanner({ type = 'info', message, action, actionLabel }) {
  const config = typeConfig[type] || typeConfig.info;
  const Icon = config.icon;

  return (
    <div className={`status-banner ${config.className}`}>
      <Icon size={18} className="banner-icon" />
      <span className="banner-message">{message}</span>
      {action && (
        <button className="banner-action" onClick={action}>
          <RefreshCw size={14} />
          {actionLabel || 'Retry'}
        </button>
      )}
    </div>
  );
}
