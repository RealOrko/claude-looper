import React, { useMemo, useState } from 'react';
import {
  Activity, Clock, Zap, Eye, AlertTriangle, CheckCircle2,
  XCircle, TrendingUp, BarChart3, Timer, Cpu, MessageSquare,
  RefreshCw, Layers, Target, Gauge, ArrowRight, History,
  Flame, Database, HardDrive, GitBranch, Play, Pause
} from 'lucide-react';

export default function MetricsPanel({ state }) {
  const {
    metrics, plan, errors, supervision, completedSteps, failedSteps,
    retryMode, timeElapsed, timeRemaining, timeLimit, iteration, status
  } = state;

  const [selectedTimeRange, setSelectedTimeRange] = useState('all');

  // Calculate derived metrics
  const derivedMetrics = useMemo(() => {
    const totalSteps = plan?.steps?.length || 0;
    const completed = metrics?.stepsCompleted || completedSteps?.length || 0;
    const failed = metrics?.stepsFailed || failedSteps?.length || 0;
    const elapsed = metrics?.elapsedTime || timeElapsed || 0;
    const iterations = metrics?.iterations || iteration || 0;

    // Calculate success rate
    const attemptedSteps = completed + failed;
    const successRate = attemptedSteps > 0 ? ((completed / attemptedSteps) * 100).toFixed(1) : 100;

    // Time calculations
    const avgStepTime = completed > 0 ? Math.round(elapsed / completed / 1000) : 0;
    const estimatedRemaining = totalSteps > completed
      ? avgStepTime * (totalSteps - completed) * 1000
      : 0;

    // Throughput
    const stepsPerHour = elapsed > 0
      ? Math.round((completed / (elapsed / 3600000)) * 10) / 10
      : 0;
    const iterationsPerMinute = elapsed > 0
      ? ((iterations / (elapsed / 60000))).toFixed(2)
      : 0;

    // Error metrics
    const errorsPerIteration = iterations > 0
      ? ((errors?.length || 0) / iterations).toFixed(3)
      : 0;
    const errorRate = attemptedSteps > 0
      ? ((failed / attemptedSteps) * 100).toFixed(1)
      : 0;

    // Supervision metrics
    const interventionRate = metrics?.supervisionChecks > 0
      ? ((metrics?.interventions / metrics?.supervisionChecks) * 100).toFixed(1)
      : 0;

    // Retry metrics
    const retryAttempts = retryMode?.attempts?.length || 0;
    const retrySuccessRate = retryAttempts > 0
      ? ((retryMode?.attempts?.filter(a => a.confidence === 'HIGH').length / retryAttempts) * 100).toFixed(0)
      : 0;

    // Time efficiency
    const timeUsedPercent = timeLimit && elapsed > 0
      ? Math.min(100, (elapsed / parseDuration(timeLimit)) * 100).toFixed(1)
      : 0;

    return {
      completionRate: totalSteps > 0 ? ((completed / totalSteps) * 100).toFixed(1) : 0,
      failureRate: errorRate,
      successRate,
      avgStepTime,
      estimatedRemaining,
      stepsPerHour,
      iterationsPerMinute,
      errorsPerIteration,
      interventionRate,
      retryAttempts,
      retrySuccessRate,
      timeUsedPercent,
      totalSteps,
      completed,
      failed,
      pending: totalSteps - completed - failed,
    };
  }, [metrics, plan, errors, completedSteps, failedSteps, retryMode, timeElapsed, iteration, timeLimit]);

  // Step timing data for chart
  const stepTimings = useMemo(() => {
    if (!completedSteps || completedSteps.length === 0) return [];
    return completedSteps
      .filter(s => s.duration)
      .map(s => ({
        step: s.number,
        duration: s.duration / 1000,
        complexity: s.complexity,
        description: s.description,
      }))
      .slice(-10); // Last 10 steps
  }, [completedSteps]);

  // Calculate step performance by complexity
  const complexityStats = useMemo(() => {
    if (!completedSteps || completedSteps.length === 0) return [];

    const stats = { low: [], medium: [], high: [] };
    completedSteps.forEach(s => {
      if (s.duration && s.complexity) {
        stats[s.complexity]?.push(s.duration / 1000);
      }
    });

    return Object.entries(stats).map(([complexity, durations]) => ({
      complexity,
      count: durations.length,
      avgTime: durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      maxTime: durations.length > 0 ? Math.round(Math.max(...durations)) : 0,
      minTime: durations.length > 0 ? Math.round(Math.min(...durations)) : 0,
    }));
  }, [completedSteps]);

  // Retry attempt history
  const retryHistory = useMemo(() => {
    if (!retryMode?.attempts || retryMode.attempts.length === 0) return [];
    return retryMode.attempts.map(attempt => ({
      number: attempt.number,
      confidence: attempt.confidence,
      duration: Math.round((attempt.duration || 0) / 1000),
      completedSteps: attempt.completedSteps || 0,
      failedSteps: attempt.failedSteps || 0,
    }));
  }, [retryMode]);

  return (
    <div className="metrics-panel">
      {/* Performance Overview */}
      <section className="metrics-section">
        <h2><BarChart3 size={20} /> Performance Overview</h2>
        <div className="metrics-grid">
          <MetricCard
            icon={<Clock />}
            label="Total Time"
            value={formatDuration(metrics?.elapsedTime || timeElapsed || 0)}
            subtext={derivedMetrics.timeUsedPercent > 0 ? `${derivedMetrics.timeUsedPercent}% of limit` : 'Elapsed'}
            color="blue"
          />
          <MetricCard
            icon={<Activity />}
            label="Iterations"
            value={metrics?.iterations || iteration || 0}
            subtext={`${derivedMetrics.iterationsPerMinute}/min`}
            color="purple"
          />
          <MetricCard
            icon={<CheckCircle2 />}
            label="Completion"
            value={`${derivedMetrics.completionRate}%`}
            subtext={`${derivedMetrics.completed}/${derivedMetrics.totalSteps} steps`}
            color="green"
          />
          <MetricCard
            icon={<Target />}
            label="Success Rate"
            value={`${derivedMetrics.successRate}%`}
            subtext={`${derivedMetrics.failed} failed`}
            color={parseFloat(derivedMetrics.successRate) >= 80 ? 'green' : 'orange'}
          />
        </div>
      </section>

      {/* Time Analysis */}
      <section className="metrics-section">
        <h2><Timer size={20} /> Time Analysis</h2>
        <div className="metrics-grid">
          <MetricCard
            icon={<Zap />}
            label="Avg Step Time"
            value={`${derivedMetrics.avgStepTime}s`}
            subtext="Per completed step"
            color="yellow"
          />
          <MetricCard
            icon={<TrendingUp />}
            label="Throughput"
            value={`${derivedMetrics.stepsPerHour}`}
            subtext="Steps per hour"
            color="cyan"
          />
          <MetricCard
            icon={<Gauge />}
            label="ETA"
            value={derivedMetrics.estimatedRemaining > 0
              ? formatDuration(derivedMetrics.estimatedRemaining)
              : '--'}
            subtext="Estimated remaining"
            color="indigo"
          />
          <MetricCard
            icon={<Clock />}
            label="Time Remaining"
            value={timeRemaining ? formatDuration(timeRemaining) : '--'}
            subtext="Until deadline"
            color={timeRemaining && timeRemaining < 300000 ? 'red' : 'blue'}
          />
        </div>

        {/* Time Progress Bar */}
        {timeLimit && (
          <div className="time-progress">
            <div className="time-progress-header">
              <span>Time Budget Usage</span>
              <span>{derivedMetrics.timeUsedPercent}%</span>
            </div>
            <div className="time-progress-bar">
              <div
                className={`time-progress-fill ${parseFloat(derivedMetrics.timeUsedPercent) > 80 ? 'warning' : ''}`}
                style={{ width: `${Math.min(100, derivedMetrics.timeUsedPercent)}%` }}
              />
            </div>
            <div className="time-progress-labels">
              <span>0</span>
              <span>{timeLimit}</span>
            </div>
          </div>
        )}

        {/* Step Timing Chart */}
        {stepTimings.length > 0 && (
          <div className="timing-chart">
            <h3>Recent Step Durations</h3>
            <div className="chart-container">
              {stepTimings.map((step) => {
                const maxDuration = Math.max(...stepTimings.map(s => s.duration), 1);
                const barWidth = (step.duration / maxDuration) * 100;
                return (
                  <div key={step.step} className="chart-bar" title={step.description}>
                    <span className="bar-label">Step {step.step}</span>
                    <div className="bar-container">
                      <div
                        className={`bar-fill ${step.complexity || 'medium'}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="bar-value">{step.duration.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Complexity Breakdown */}
      {complexityStats.length > 0 && complexityStats.some(s => s.count > 0) && (
        <section className="metrics-section">
          <h2><Layers size={20} /> Complexity Analysis</h2>
          <div className="complexity-grid">
            {complexityStats.map(stat => (
              <div key={stat.complexity} className={`complexity-card ${stat.complexity}`}>
                <div className="complexity-header">
                  <span className="complexity-label">{stat.complexity}</span>
                  <span className="complexity-count">{stat.count} steps</span>
                </div>
                {stat.count > 0 && (
                  <div className="complexity-stats">
                    <div className="complexity-stat">
                      <span className="stat-label">Avg</span>
                      <span className="stat-value">{stat.avgTime}s</span>
                    </div>
                    <div className="complexity-stat">
                      <span className="stat-label">Min</span>
                      <span className="stat-value">{stat.minTime}s</span>
                    </div>
                    <div className="complexity-stat">
                      <span className="stat-label">Max</span>
                      <span className="stat-value">{stat.maxTime}s</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Retry Mode Stats */}
      {retryMode?.enabled && (
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
      )}

      {/* Supervision Metrics */}
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

      {/* Error Metrics */}
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

      {/* Plan Summary */}
      {plan && (
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
              {['low', 'medium', 'high'].map(complexity => {
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
      )}

      {/* System Status */}
      <section className="metrics-section">
        <h2><Cpu size={20} /> System Status</h2>
        <div className="system-status">
          <div className="status-indicator">
            <div className={`status-dot ${status || 'idle'}`} />
            <span className="status-label">{status || 'Idle'}</span>
          </div>
          <div className="system-stats">
            <div className="system-stat">
              <Database size={14} />
              <span>Events: {state.logs?.length || 0}</span>
            </div>
            <div className="system-stat">
              <MessageSquare size={14} />
              <span>Messages: {metrics?.messagesProcessed || 0}</span>
            </div>
            <div className="system-stat">
              <Activity size={14} />
              <span>Uptime: {formatDuration(metrics?.uptime || Date.now() - (metrics?.startTime || Date.now()))}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, subtext, color }) {
  return (
    <div className={`metric-card ${color}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-content">
        <span className="metric-value">{value}</span>
        <span className="metric-label">{label}</span>
        {subtext && <span className="metric-subtext">{subtext}</span>}
      </div>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function parseDuration(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/^(\d+)([hms])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'h': return value * 3600000;
    case 'm': return value * 60000;
    case 's': return value * 1000;
    default: return 0;
  }
}
