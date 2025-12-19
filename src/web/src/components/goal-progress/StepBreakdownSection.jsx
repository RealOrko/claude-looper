/**
 * Step Breakdown Section Component
 * Shows breakdown of steps by status and complexity
 */
import React from 'react';
import { Layers, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';

export default function StepBreakdownSection({
  totalSteps, stepBreakdown, complexityBreakdown, recentTransitions,
  isExpanded, onToggle
}) {
  if (totalSteps === 0) return null;

  return (
    <section className="step-breakdown-section">
      <button className="section-toggle" onClick={onToggle}>
        <Layers size={18} />
        <span>Step Breakdown</span>
        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>

      {isExpanded && (
        <div className="breakdown-content">
          {/* Status breakdown bar */}
          <div className="status-breakdown">
            <h4>By Status</h4>
            <div className="breakdown-bar">
              {stepBreakdown.completed > 0 && (
                <div
                  className="bar-segment completed"
                  style={{ width: `${(stepBreakdown.completed / totalSteps) * 100}%` }}
                  title={`Completed: ${stepBreakdown.completed}`}
                />
              )}
              {stepBreakdown.in_progress > 0 && (
                <div
                  className="bar-segment in-progress"
                  style={{ width: `${(stepBreakdown.in_progress / totalSteps) * 100}%` }}
                  title={`In Progress: ${stepBreakdown.in_progress}`}
                />
              )}
              {stepBreakdown.blocked > 0 && (
                <div
                  className="bar-segment blocked"
                  style={{ width: `${(stepBreakdown.blocked / totalSteps) * 100}%` }}
                  title={`Blocked: ${stepBreakdown.blocked}`}
                />
              )}
              {stepBreakdown.failed > 0 && (
                <div
                  className="bar-segment failed"
                  style={{ width: `${(stepBreakdown.failed / totalSteps) * 100}%` }}
                  title={`Failed: ${stepBreakdown.failed}`}
                />
              )}
              {stepBreakdown.pending > 0 && (
                <div
                  className="bar-segment pending"
                  style={{ width: `${(stepBreakdown.pending / totalSteps) * 100}%` }}
                  title={`Pending: ${stepBreakdown.pending}`}
                />
              )}
            </div>
            <div className="breakdown-legend">
              <span className="legend-item completed">
                <span className="legend-dot" /> Completed ({stepBreakdown.completed})
              </span>
              <span className="legend-item in-progress">
                <span className="legend-dot" /> In Progress ({stepBreakdown.in_progress})
              </span>
              <span className="legend-item blocked">
                <span className="legend-dot" /> Blocked ({stepBreakdown.blocked})
              </span>
              <span className="legend-item failed">
                <span className="legend-dot" /> Failed ({stepBreakdown.failed})
              </span>
              <span className="legend-item pending">
                <span className="legend-dot" /> Pending ({stepBreakdown.pending})
              </span>
            </div>
          </div>

          {/* Complexity breakdown */}
          <div className="complexity-breakdown">
            <h4>By Complexity</h4>
            <div className="complexity-pills">
              <div className="complexity-pill low">
                <span className="pill-count">{complexityBreakdown.low}</span>
                <span className="pill-label">Low</span>
              </div>
              <div className="complexity-pill medium">
                <span className="pill-count">{complexityBreakdown.medium}</span>
                <span className="pill-label">Medium</span>
              </div>
              <div className="complexity-pill high">
                <span className="pill-count">{complexityBreakdown.high}</span>
                <span className="pill-label">High</span>
              </div>
            </div>
          </div>

          {/* Recent transitions */}
          {recentTransitions.length > 0 && (
            <div className="recent-transitions">
              <h4>Recent Activity</h4>
              <div className="transitions-list">
                {recentTransitions.map((t, i) => (
                  <div key={i} className="transition-item">
                    <span className="transition-step">Step {t.stepNumber}</span>
                    <span className={`transition-from ${t.from}`}>{t.from}</span>
                    <ArrowRight size={12} />
                    <span className={`transition-to ${t.to}`}>{t.to}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
