/**
 * DAG Details Panel Component
 * Shows detailed information about a selected node
 */
import React from 'react';
import { X, CheckCircle2, AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import { complexityColors } from './constants.js';
import { formatDuration } from './utils.js';

export default function DAGDetailsPanel({ node, onClose }) {
  if (!node) return null;

  const status = node.status || 'pending';

  return (
    <div className="dag-details-panel">
      <div className="details-header">
        <h3>Step {node.number}</h3>
        <button className="close-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="details-content">
        <DetailRow label="Description" value={node.description} />

        <div className="detail-row">
          <span className="detail-label">Status</span>
          <span className={`status-badge ${status}`}>{status}</span>
        </div>

        {node.complexity && (
          <div className="detail-row">
            <span className="detail-label">Complexity</span>
            <span className="complexity-badge" style={{ color: complexityColors[node.complexity] }}>
              {node.complexity}
            </span>
          </div>
        )}

        {node.duration && (
          <div className="detail-row">
            <span className="detail-label">Duration</span>
            <span className="detail-value">
              <Clock size={14} /> {formatDuration(node.duration)}
            </span>
          </div>
        )}

        {node.dependencies && node.dependencies.length > 0 && (
          <div className="detail-row">
            <span className="detail-label">Dependencies</span>
            <div className="dep-list">
              {node.dependencies.map((dep) => (
                <span key={dep} className="dep-chip">Step {dep}</span>
              ))}
            </div>
          </div>
        )}

        {node.failReason && (
          <div className="detail-row error">
            <span className="detail-label">
              <AlertTriangle size={14} /> Failure Reason
            </span>
            <span className="detail-value">{node.failReason}</span>
          </div>
        )}

        {node.verification && (
          <div className="detail-row success">
            <span className="detail-label">
              <CheckCircle2 size={14} /> Verification
            </span>
            <span className="detail-value">{node.verification}</span>
          </div>
        )}

        {node.subSteps && node.subSteps.length > 0 && (
          <div className="detail-row">
            <span className="detail-label">Sub-steps</span>
            <ul className="substep-list">
              {node.subSteps.map((sub, i) => (
                <li key={i} className={sub.status || 'pending'}>
                  <ArrowRight size={12} />
                  <span>{sub.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}
