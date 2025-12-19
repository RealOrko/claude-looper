/**
 * RetryModeSection Component
 * Shows retry mode statistics and history
 */
import React from 'react';
import { RefreshCw, Target, History, Clock } from 'lucide-react';
import MetricCard from './MetricCard.jsx';
import { formatDuration } from './utils.js';

export default function RetryModeSection({ retryMode, derivedMetrics, retryHistory }) {
  if (!retryMode?.enabled) return null;

  return (
    <section className="metrics-section retry-section">
      <h2><RefreshCw size={20} /> Retry Mode</h2>
      <div className="metrics-grid">
        <MetricCard
          icon={<RefreshCw />}
          label="Current Attempt"
          value={`${retryMode.currentAttempt || 1}/${retryMode.maxAttempts || '?'}`}
          subtext="Attempt progress"
          color="purple"
        />
        <MetricCard
          icon={<Target />}
          label="Goal"
          value="HIGH"
          subtext="Confidence target"
          color="yellow"
        />
        <MetricCard
          icon={<History />}
          label="Attempts Made"
          value={derivedMetrics.retryAttempts}
          subtext={`${derivedMetrics.retrySuccessRate}% reached HIGH`}
          color="blue"
        />
        {retryMode.timeRemaining && (
          <MetricCard
            icon={<Clock />}
            label="Time Left"
            value={formatDuration(retryMode.timeRemaining)}
            subtext="For retries"
            color={retryMode.timeRemaining < 300000 ? 'red' : 'green'}
          />
        )}
      </div>

      {/* Retry History */}
      {retryHistory.length > 0 && (
        <div className="retry-history">
          <h3>Attempt History</h3>
          <div className="retry-timeline">
            {retryHistory.map((attempt, i) => (
              <div
                key={i}
                className={`retry-item ${attempt.confidence?.toLowerCase() || 'unknown'}`}
              >
                <div className="retry-number">#{attempt.number}</div>
                <div className="retry-details">
                  <span className={`confidence-badge ${attempt.confidence?.toLowerCase()}`}>
                    {attempt.confidence || 'Unknown'}
                  </span>
                  <span className="retry-stats">
                    {attempt.completedSteps} completed, {attempt.failedSteps} failed
                  </span>
                  <span className="retry-duration">{attempt.duration}s</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
