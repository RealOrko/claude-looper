import React from 'react';
import { Activity, Wifi, WifiOff, Target, Zap } from 'lucide-react';

const statusColors = {
  idle: '#6b7280',
  initialized: '#3b82f6',
  planning: '#8b5cf6',
  executing: '#10b981',
  verifying: '#f59e0b',
  completed: '#22c55e',
  failed: '#ef4444',
};

const statusLabels = {
  idle: 'Idle',
  initialized: 'Initialized',
  planning: 'Planning',
  executing: 'Executing',
  verifying: 'Verifying',
  completed: 'Completed',
  failed: 'Failed',
};

export default function Header({ connected, status, goal, children }) {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <Zap className="logo-icon" />
          <span className="logo-text">Claude Runner</span>
        </div>
      </div>

      <div className="header-center">
        {goal && (
          <div className="current-goal">
            <Target size={16} />
            <span className="goal-text" title={goal}>
              {goal.length > 80 ? goal.substring(0, 80) + '...' : goal}
            </span>
          </div>
        )}
      </div>

      <div className="header-right">
        <div
          className="status-badge"
          style={{ backgroundColor: statusColors[status] || statusColors.idle }}
        >
          <Activity size={14} />
          <span>{statusLabels[status] || 'Unknown'}</span>
        </div>

        {children}
      </div>
    </header>
  );
}
