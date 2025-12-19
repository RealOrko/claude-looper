/**
 * DAG Status Transition Feed Component
 * Shows recent status changes in a compact feed
 */
import React from 'react';
import { ArrowRight } from 'lucide-react';

export default function DAGStatusFeed({ transitions }) {
  if (!transitions || transitions.length === 0) return null;

  return (
    <div className="dag-transition-feed">
      <div className="feed-header">Recent Updates</div>
      <div className="feed-items">
        {transitions.slice(-5).reverse().map((transition, i) => (
          <div
            key={`${transition.stepNumber}-${transition.timestamp}-${i}`}
            className={`feed-item ${transition.to}`}
          >
            <span className="feed-step">Step {transition.stepNumber}</span>
            <span className="feed-transition">
              <span className={`status-dot ${transition.from || 'pending'}`} />
              <ArrowRight size={12} />
              <span className={`status-dot ${transition.to}`} />
            </span>
            <span className="feed-status">{transition.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
