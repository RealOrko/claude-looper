/**
 * StepsSummary Component
 * Header with step counts and view toggle
 */
import React from 'react';
import { GitBranch, List } from 'lucide-react';

export default function StepsSummary({
  steps, completed, inProgress, pending, failed, viewMode, setViewMode
}) {
  return (
    <div className="steps-summary">
      <div className="summary-item">
        <span className="summary-count">{steps.length}</span>
        <span className="summary-label">Total</span>
      </div>
      <div className="summary-item success">
        <span className="summary-count">{completed}</span>
        <span className="summary-label">Completed</span>
      </div>
      <div className="summary-item active">
        <span className="summary-count">{inProgress}</span>
        <span className="summary-label">In Progress</span>
      </div>
      <div className="summary-item pending">
        <span className="summary-count">{pending}</span>
        <span className="summary-label">Pending</span>
      </div>
      <div className="summary-item error">
        <span className="summary-count">{failed}</span>
        <span className="summary-label">Failed</span>
      </div>

      <div className="view-toggle">
        <button
          className={`toggle-btn ${viewMode === 'dag' ? 'active' : ''}`}
          onClick={() => setViewMode('dag')}
          title="DAG View"
        >
          <GitBranch size={16} />
        </button>
        <button
          className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
          title="List View"
        >
          <List size={16} />
        </button>
      </div>
    </div>
  );
}
