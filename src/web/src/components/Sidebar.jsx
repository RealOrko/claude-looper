import React from 'react';
import { LayoutDashboard, Activity, Target, ListChecks, ScrollText, BarChart3, CheckCircle2, XCircle, Clock } from 'lucide-react';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+1' },
  { id: 'status', label: 'Status', icon: Activity, shortcut: 'Alt+2' },
  { id: 'goal', label: 'Goal', icon: Target, shortcut: 'Alt+3' },
  { id: 'steps', label: 'Steps', icon: ListChecks, shortcut: 'Alt+4' },
  { id: 'logs', label: 'Logs', icon: ScrollText, shortcut: 'Alt+5' },
  { id: 'metrics', label: 'Metrics', icon: BarChart3, shortcut: 'Alt+6' },
];

export default function Sidebar({ activeTab, onTabChange, state }) {
  const { metrics, plan, status, completedSteps: completedStepsArr, failedSteps: failedStepsArr, verification, progress } = state;
  const totalSteps = plan?.steps?.length || 0;
  const completedSteps = completedStepsArr?.length || metrics?.stepsCompleted || 0;
  const failedSteps = failedStepsArr?.length || metrics?.stepsFailed || 0;
  const confidence = verification?.goal?.confidence || verification?.confidence || null;

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              title={`${tab.label} (${tab.shortcut})`}
            >
              <Icon size={20} />
              <span className="nav-label">{tab.label}</span>
              {tab.id === 'goal' && confidence && (
                <span className={`nav-badge confidence-${confidence.toLowerCase()}`}>{confidence}</span>
              )}
              {tab.id === 'steps' && totalSteps > 0 && (
                <span className="nav-badge">{completedSteps}/{totalSteps}</span>
              )}
              {tab.id === 'logs' && state.logs?.length > 0 && (
                <span className="nav-badge">{state.logs.length}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-stats">
        <div className="stat-item">
          <CheckCircle2 size={16} className="stat-icon success" />
          <span className="stat-value">{completedSteps}</span>
          <span className="stat-label">Completed</span>
        </div>
        <div className="stat-item">
          <XCircle size={16} className="stat-icon error" />
          <span className="stat-value">{failedSteps}</span>
          <span className="stat-label">Failed</span>
        </div>
        <div className="stat-item">
          <Clock size={16} className="stat-icon info" />
          <span className="stat-value">{formatDuration(state.timeElapsed || metrics?.elapsedTime || 0)}</span>
          <span className="stat-label">Elapsed</span>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="progress-ring">
          <svg viewBox="0 0 36 36">
            <path
              className="progress-ring-bg"
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="progress-ring-fill"
              strokeDasharray={`${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}, 100`}
              d="M18 2.0845
                a 15.9155 15.9155 0 0 1 0 31.831
                a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span className="progress-text">
            {totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0}%
          </span>
        </div>
        <span className="status-text">{status}</span>
      </div>
    </aside>
  );
}

function formatDuration(ms) {
  if (!ms) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
