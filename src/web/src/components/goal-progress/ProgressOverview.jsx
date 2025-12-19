/**
 * Progress Overview Component
 * Shows the large progress ring and key stats
 */
import React from 'react';
import { CheckCircle2, XCircle, Activity, Clock } from 'lucide-react';
import { getProgressColor, formatDuration } from './utils.js';

export default function ProgressOverview({
  progressPercent, completed, failed, totalSteps, iteration, elapsedMs
}) {
  return (
    <section className="progress-overview">
      <div className="progress-ring-large">
        <svg viewBox="0 0 100 100">
          <circle
            className="ring-bg"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
          />
          <circle
            className="ring-progress"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
            strokeDasharray={`${progressPercent * 2.83} 283`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ stroke: getProgressColor(progressPercent) }}
          />
        </svg>
        <div className="ring-content">
          <span className="ring-percent">{progressPercent}%</span>
          <span className="ring-label">Complete</span>
        </div>
      </div>

      <div className="progress-stats">
        <div className="stat-row">
          <CheckCircle2 className="stat-icon success" />
          <span className="stat-label">Completed</span>
          <span className="stat-value">{completed} / {totalSteps}</span>
        </div>
        <div className="stat-row">
          <XCircle className="stat-icon error" />
          <span className="stat-label">Failed</span>
          <span className="stat-value">{failed}</span>
        </div>
        <div className="stat-row">
          <Activity className="stat-icon info" />
          <span className="stat-label">Iterations</span>
          <span className="stat-value">{iteration || 0}</span>
        </div>
        <div className="stat-row">
          <Clock className="stat-icon warning" />
          <span className="stat-label">Elapsed</span>
          <span className="stat-value">{formatDuration(elapsedMs)}</span>
        </div>
      </div>
    </section>
  );
}
