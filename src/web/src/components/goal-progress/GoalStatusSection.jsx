/**
 * Goal Status Section Component
 * Shows the main goal, status badge, and sub-goals
 */
import React from 'react';
import { Target } from 'lucide-react';
import { statusConfig } from './icons.js';

export default function GoalStatusSection({ goal, subGoals, status, iteration }) {
  const currentStatusConfig = statusConfig[status] || statusConfig.idle;
  const StatusIcon = currentStatusConfig.icon;

  return (
    <section className="goal-status-section">
      <div className="goal-header">
        <Target className="goal-icon" />
        <h2>Goal Progress</h2>
        <div className="status-badge-animated" style={{ '--status-color': currentStatusConfig.color }}>
          <StatusIcon size={14} className="status-badge-icon" />
          <span>{currentStatusConfig.label}</span>
        </div>
      </div>

      <div className="goal-content">
        <p className="goal-text">{goal || 'No goal set'}</p>

        {/* Live status indicator */}
        {status === 'executing' && (
          <div className="live-indicator">
            <span className="live-dot" />
            <span>Live - Iteration {iteration || 0}</span>
          </div>
        )}

        {/* Sub-goals progress */}
        {subGoals && subGoals.length > 0 && (
          <div className="subgoals-list">
            <h4>Sub-goals</h4>
            {subGoals.map((sg, i) => (
              <div key={i} className="subgoal-item">
                <span className="subgoal-number">{i + 1}</span>
                <span className="subgoal-text">{sg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
