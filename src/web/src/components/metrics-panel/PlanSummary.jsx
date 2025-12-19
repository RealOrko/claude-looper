/**
 * PlanSummary Component
 * Shows plan overview and complexity distribution
 */
import React from 'react';
import { GitBranch } from 'lucide-react';
import { COMPLEXITY_LEVELS } from './constants.js';

export default function PlanSummary({ plan, derivedMetrics }) {
  if (!plan) return null;

  return (
    <section className="metrics-section">
      <h2><GitBranch size={20} /> Plan Summary</h2>
      <div className="plan-summary-grid">
        <div className="plan-stat">
          <span className="plan-stat-value">{plan.steps?.length || 0}</span>
          <span className="plan-stat-label">Total Steps</span>
        </div>
        <div className="plan-stat success">
          <span className="plan-stat-value">{derivedMetrics.completed}</span>
          <span className="plan-stat-label">Completed</span>
        </div>
        <div className="plan-stat pending">
          <span className="plan-stat-value">{derivedMetrics.pending}</span>
          <span className="plan-stat-label">Pending</span>
        </div>
        <div className="plan-stat error">
          <span className="plan-stat-value">{derivedMetrics.failed}</span>
          <span className="plan-stat-label">Failed</span>
        </div>
      </div>

      {/* Complexity Distribution */}
      <div className="complexity-distribution">
        <h3>Complexity Distribution</h3>
        <div className="distribution-bars">
          {COMPLEXITY_LEVELS.map(complexity => {
            const count = plan.steps?.filter(s => s.complexity === complexity).length || 0;
            const total = plan.steps?.length || 1;
            const percent = (count / total) * 100;
            return (
              <div key={complexity} className="distribution-item">
                <div className="distribution-label">
                  <span className={`complexity-dot ${complexity}`} />
                  <span>{complexity}</span>
                  <span className="distribution-count">{count}</span>
                </div>
                <div className="distribution-bar">
                  <div
                    className={`distribution-fill ${complexity}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="distribution-percent">{percent.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
