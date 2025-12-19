/**
 * SupervisionSection Component
 * Shows supervision metrics and latest assessment
 */
import React from 'react';
import { Eye, AlertTriangle, Play, ArrowRight, Pause } from 'lucide-react';
import MetricCard from './MetricCard.jsx';

export default function SupervisionSection({ metrics, derivedMetrics, supervision }) {
  return (
    <section className="metrics-section">
      <h2><Eye size={20} /> Supervision</h2>
      <div className="metrics-grid">
        <MetricCard
          icon={<Eye />}
          label="Checks"
          value={metrics?.supervisionChecks || 0}
          subtext="Total supervisions"
          color="indigo"
        />
        <MetricCard
          icon={<AlertTriangle />}
          label="Interventions"
          value={metrics?.interventions || 0}
          subtext={`${derivedMetrics.interventionRate}% rate`}
          color={parseInt(derivedMetrics.interventionRate) > 20 ? 'red' : 'orange'}
        />
      </div>

      {supervision && (
        <div className="supervision-details">
          <h3>Latest Assessment</h3>
          <div className={`assessment-card ${supervision.assessment?.action?.toLowerCase() || ''}`}>
            <div className="assessment-header">
              {supervision.assessment?.action === 'CONTINUE' ? (
                <Play size={16} className="assessment-icon success" />
              ) : supervision.assessment?.action === 'REDIRECT' ? (
                <ArrowRight size={16} className="assessment-icon warning" />
              ) : (
                <Pause size={16} className="assessment-icon error" />
              )}
              <span className="assessment-action">{supervision.assessment?.action || 'N/A'}</span>
            </div>
            <div className="assessment-body">
              <div className="assessment-row">
                <span className="assessment-label">Score</span>
                <span className="assessment-value">{supervision.assessment?.score || 'N/A'}</span>
              </div>
              <div className="assessment-row">
                <span className="assessment-label">Consecutive Issues</span>
                <span className={`assessment-value ${supervision.consecutiveIssues > 0 ? 'warning' : ''}`}>
                  {supervision.consecutiveIssues || 0}
                </span>
              </div>
              {supervision.assessment?.reason && (
                <div className="assessment-reason">
                  {supervision.assessment.reason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
