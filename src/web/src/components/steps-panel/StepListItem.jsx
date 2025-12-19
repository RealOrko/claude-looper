/**
 * StepListItem Component
 * Single step item in list view
 */
import React from 'react';
import {
  ChevronDown, ChevronRight, Clock, AlertTriangle, CheckCircle2,
  ArrowRight, ExternalLink
} from 'lucide-react';
import { statusIcons } from './icons.js';
import { statusColors, complexityColors } from './constants.js';
import { formatDuration } from './utils.js';

export default function StepListItem({
  step, index, isExpanded, hasChanged, onToggle, onDetailClick
}) {
  const StatusIcon = statusIcons[step.status] || statusIcons.pending;
  const colorClass = statusColors[step.status] || 'pending';
  const hasDetails = step.failReason || step.verification || step.subSteps;

  return (
    <div className={`step-item ${colorClass} ${isExpanded ? 'expanded' : ''} ${hasChanged ? 'status-changed' : ''}`}>
      <div className="step-header" onClick={() => hasDetails && onToggle(step.number)}>
        <div className="step-status">
          <StatusIcon size={20} className={`status-icon ${colorClass}`} />
        </div>

        <div className="step-number">#{step.number || index + 1}</div>

        <div className="step-content">
          <div className="step-description">{step.description}</div>
          {step.complexity && (
            <span
              className="complexity-tag"
              style={{ backgroundColor: complexityColors[step.complexity] }}
            >
              {step.complexity}
            </span>
          )}
        </div>

        {hasDetails && (
          <div className="step-expand">
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </div>
        )}

        {step.duration && (
          <div className="step-duration">
            <Clock size={14} />
            <span>{formatDuration(step.duration)}</span>
          </div>
        )}

        <button
          className="step-detail-btn"
          onClick={(e) => { e.stopPropagation(); onDetailClick(step); }}
          title="View details"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {isExpanded && (
        <div className="step-details">
          {step.failReason && (
            <div className="detail-section error">
              <AlertTriangle size={16} />
              <span>{step.failReason}</span>
            </div>
          )}

          {step.verification && (
            <div className="detail-section verification">
              <CheckCircle2 size={16} />
              <span>Verification: {step.verification}</span>
            </div>
          )}

          {step.subSteps && step.subSteps.length > 0 && (
            <div className="sub-steps">
              <h4>Sub-steps</h4>
              <ul>
                {step.subSteps.map((subStep, i) => (
                  <li key={i} className={subStep.status || 'pending'}>
                    <ArrowRight size={14} />
                    <span>{subStep.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step.dependencies && step.dependencies.length > 0 && (
            <div className="dependencies">
              <span className="dep-label">Depends on:</span>
              {step.dependencies.map((dep, i) => (
                <span key={i} className="dep-tag">Step {dep}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
