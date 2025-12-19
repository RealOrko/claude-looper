/**
 * ErrorsSection Component
 * Shows error metrics, error timeline, and failed steps
 */
import React from 'react';
import { XCircle, Flame } from 'lucide-react';
import MetricCard from './MetricCard.jsx';
import { formatTime } from './utils.js';

export default function ErrorsSection({ errors, failedSteps, derivedMetrics }) {
  return (
    <section className="metrics-section">
      <h2><XCircle size={20} /> Errors & Issues</h2>
      <div className="metrics-grid">
        <MetricCard
          icon={<XCircle />}
          label="Total Errors"
          value={errors?.length || 0}
          subtext={`${derivedMetrics.errorsPerIteration} per iteration`}
          color="red"
        />
        <MetricCard
          icon={<Flame />}
          label="Failed Steps"
          value={derivedMetrics.failed}
          subtext={`${derivedMetrics.failureRate}% failure rate`}
          color={derivedMetrics.failed > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Error Timeline */}
      {errors && errors.length > 0 && (
        <div className="error-timeline">
          <h3>Recent Errors</h3>
          <ul className="error-list">
            {errors.slice(-5).reverse().map((err, i) => (
              <li key={i} className="error-item">
                <div className="error-icon">
                  <XCircle size={14} />
                </div>
                <div className="error-content">
                  <span className="error-message">{err.error}</span>
                  <div className="error-meta">
                    {err.retry && <span className="error-retry">Retry #{err.retry}</span>}
                    <span className="error-time">{formatTime(err.timestamp)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Failed Steps Details */}
      {failedSteps && failedSteps.length > 0 && (
        <div className="failed-steps">
          <h3>Failed Steps</h3>
          <ul className="failed-list">
            {failedSteps.slice(-5).reverse().map((step, i) => (
              <li key={i} className="failed-item">
                <span className="failed-number">Step {step.number}</span>
                <span className="failed-desc">{step.description}</span>
                {step.reason && <span className="failed-reason">{step.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
