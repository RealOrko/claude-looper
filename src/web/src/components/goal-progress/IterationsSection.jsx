/**
 * Iterations Section Component
 * Shows iteration tracking, retry mode, and token usage
 */
import React from 'react';
import { RefreshCw, BarChart2, Clock } from 'lucide-react';
import { formatDuration, formatNumber } from './utils.js';

export default function IterationsSection({ iteration, elapsedMs, retryMode, metrics }) {
  return (
    <section className="iterations-section">
      <h3><RefreshCw size={18} /> Iteration Tracking</h3>
      <div className="iteration-display">
        <div className="iteration-count">
          <span className="count-value">{iteration || 0}</span>
          <span className="count-label">Total Iterations</span>
        </div>

        {/* Iteration rate */}
        {elapsedMs > 0 && iteration > 0 && (
          <div className="iteration-rate">
            <BarChart2 size={16} />
            <span>{((iteration / (elapsedMs / 60000)) || 0).toFixed(1)}</span>
            <span className="rate-label">iter/min</span>
          </div>
        )}

        {/* Avg time per iteration */}
        {iteration > 0 && (
          <div className="iteration-avg">
            <Clock size={16} />
            <span>{formatDuration(elapsedMs / iteration)}</span>
            <span className="rate-label">avg/iter</span>
          </div>
        )}
      </div>

      {/* Iteration Timeline Visual */}
      {iteration > 0 && <IterationTimeline iteration={iteration} />}

      {/* Retry mode info */}
      {retryMode?.enabled && <RetryModeDisplay retryMode={retryMode} />}

      {/* Metrics summary */}
      {metrics && (metrics.tokensIn > 0 || metrics.tokensOut > 0) && (
        <TokenUsageDisplay metrics={metrics} />
      )}
    </section>
  );
}

function IterationTimeline({ iteration }) {
  return (
    <div className="iteration-timeline-visual">
      <h4>Iteration Progress</h4>
      <div className="iteration-dots">
        {Array.from({ length: Math.min(iteration, 20) }, (_, i) => (
          <div
            key={i}
            className={`iteration-dot ${i === iteration - 1 ? 'current' : 'completed'}`}
            title={`Iteration ${i + 1}`}
          >
            {i + 1}
          </div>
        ))}
        {iteration > 20 && (
          <div className="iteration-more">+{iteration - 20}</div>
        )}
      </div>
    </div>
  );
}

function RetryModeDisplay({ retryMode }) {
  return (
    <div className="retry-info">
      <h4>Retry Mode Active</h4>
      <div className="retry-progress-bar">
        <div
          className="retry-fill"
          style={{ width: `${(retryMode.currentAttempt / retryMode.maxAttempts) * 100}%` }}
        />
        <span className="retry-text">
          Attempt {retryMode.currentAttempt} of {retryMode.maxAttempts}
        </span>
      </div>
      {retryMode.attempts?.length > 0 && (
        <div className="retry-attempts">
          {retryMode.attempts.map((attempt, i) => (
            <div
              key={i}
              className={`attempt-badge ${attempt.confidence?.toLowerCase() || 'unknown'}`}
              title={`Attempt ${attempt.number}: ${attempt.confidence}`}
            >
              <span className="attempt-num">#{attempt.number}</span>
              <span className="attempt-conf">{attempt.confidence}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenUsageDisplay({ metrics }) {
  return (
    <div className="metrics-summary">
      <h4>Token Usage</h4>
      <div className="token-stats">
        <div className="token-stat">
          <span className="token-label">Input</span>
          <span className="token-value">{formatNumber(metrics.tokensIn)}</span>
        </div>
        <div className="token-stat">
          <span className="token-label">Output</span>
          <span className="token-value">{formatNumber(metrics.tokensOut)}</span>
        </div>
        <div className="token-stat">
          <span className="token-label">Total</span>
          <span className="token-value">{formatNumber(metrics.tokensIn + metrics.tokensOut)}</span>
        </div>
      </div>
    </div>
  );
}
