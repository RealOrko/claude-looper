import React, { useMemo, useState } from 'react';
import {
  Target, TrendingUp, Award, AlertTriangle, CheckCircle2, XCircle,
  Clock, Activity, Zap, RefreshCw, BarChart2, Gauge, Layers,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, Minus, History,
  PieChart, GitBranch, Play, Pause, FastForward
} from 'lucide-react';

const confidenceLevels = {
  HIGH: { color: '#22c55e', label: 'High', icon: CheckCircle2, value: 100 },
  MEDIUM: { color: '#f59e0b', label: 'Medium', icon: AlertTriangle, value: 60 },
  LOW: { color: '#ef4444', label: 'Low', icon: XCircle, value: 30 },
  UNKNOWN: { color: '#6b7280', label: 'Unknown', icon: Activity, value: 10 },
};

const statusConfig = {
  idle: { icon: Pause, color: '#6b7280', label: 'Idle' },
  initializing: { icon: Play, color: '#3b82f6', label: 'Initializing' },
  planning: { icon: GitBranch, color: '#8b5cf6', label: 'Planning' },
  executing: { icon: FastForward, color: '#22c55e', label: 'Executing' },
  verifying: { icon: CheckCircle2, color: '#f59e0b', label: 'Verifying' },
  completed: { icon: Award, color: '#22c55e', label: 'Completed' },
  failed: { icon: XCircle, color: '#ef4444', label: 'Failed' },
};

export default function GoalProgress({ state }) {
  const {
    goal,
    subGoals,
    plan,
    verification,
    completedSteps,
    failedSteps,
    iteration,
    progress,
    timeElapsed,
    timeRemaining,
    timeLimit,
    status,
    retryMode,
    finalReport,
    stepChanges,
    metrics,
    iterationHistory = [],
    confidenceHistory = [],
  } = state;

  const [expandedSections, setExpandedSections] = useState(new Set(['progress', 'confidence']));
  const [showAllIterations, setShowAllIterations] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Calculate overall progress
  const totalSteps = plan?.steps?.length || 0;
  const completed = completedSteps?.length || 0;
  const failed = failedSteps?.length || 0;
  const progressPercent = totalSteps > 0 ? Math.round((completed / totalSteps) * 100) : (progress || 0);

  // Determine confidence level from verification or estimate
  const confidence = useMemo(() => {
    if (verification?.goal?.confidence) {
      return verification.goal.confidence;
    }
    if (verification?.confidence) {
      return verification.confidence;
    }
    if (finalReport?.finalVerification?.confidence) {
      return finalReport.finalVerification.confidence;
    }
    // Estimate based on progress and failures
    if (completed > 0 && failed === 0 && progressPercent >= 80) return 'HIGH';
    if (progressPercent >= 50 || (completed > failed)) return 'MEDIUM';
    if (failed > completed) return 'LOW';
    return 'UNKNOWN';
  }, [verification, finalReport, completed, failed, progressPercent]);

  const confidenceConfig = confidenceLevels[confidence] || confidenceLevels.UNKNOWN;
  const ConfidenceIcon = confidenceConfig.icon;

  // Goal achievement status
  const goalAchieved = verification?.goal?.achieved || verification?.passed || finalReport?.finalVerification?.goalAchieved;

  // Calculate time info
  const elapsedMs = timeElapsed || 0;
  const remainingMs = timeRemaining || 0;
  const totalTimeMs = elapsedMs + remainingMs;
  const timePercent = totalTimeMs > 0 ? Math.round((elapsedMs / totalTimeMs) * 100) : 0;

  // Step breakdown by status
  const stepBreakdown = useMemo(() => {
    if (!plan?.steps) return { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 };
    return plan.steps.reduce((acc, step) => {
      const status = step.status || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, { pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0 });
  }, [plan]);

  // Step complexity breakdown
  const complexityBreakdown = useMemo(() => {
    if (!plan?.steps) return { low: 0, medium: 0, high: 0 };
    return plan.steps.reduce((acc, step) => {
      const complexity = step.complexity || 'medium';
      acc[complexity] = (acc[complexity] || 0) + 1;
      return acc;
    }, { low: 0, medium: 0, high: 0 });
  }, [plan]);

  // Recent status transitions for live feed
  const recentTransitions = useMemo(() => {
    const transitions = stepChanges?.statusTransitions || [];
    return transitions.slice(-5).reverse();
  }, [stepChanges]);

  // Confidence trend (up, down, stable)
  const confidenceTrend = useMemo(() => {
    if (confidenceHistory.length < 2) return 'stable';
    const recent = confidenceHistory.slice(-2);
    const prev = confidenceLevels[recent[0]]?.value || 0;
    const curr = confidenceLevels[recent[1]]?.value || 0;
    if (curr > prev) return 'up';
    if (curr < prev) return 'down';
    return 'stable';
  }, [confidenceHistory]);

  const TrendIcon = confidenceTrend === 'up' ? ArrowUp : confidenceTrend === 'down' ? ArrowDown : Minus;

  // Status config for current status
  const currentStatusConfig = statusConfig[status] || statusConfig.idle;
  const StatusIcon = currentStatusConfig.icon;

  return (
    <div className="goal-progress">
      {/* Main Goal Status */}
      <section className="goal-status-section">
        <div className="goal-header">
          <Target className="goal-icon" />
          <h2>Goal Progress</h2>
          <div className="status-badge-animated" style={{ '--status-color': currentStatusConfig.color }}>
            <StatusIcon size={14} className="status-badge-icon" />
            <span>{currentStatusConfig.label}</span>
          </div>
        </div>

        <div className="goal-content">
          <p className="goal-text">{goal || 'No goal set'}</p>

          {/* Live status indicator */}
          {status === 'executing' && (
            <div className="live-indicator">
              <span className="live-dot" />
              <span>Live - Iteration {iteration || 0}</span>
            </div>
          )}

          {/* Sub-goals progress */}
          {subGoals && subGoals.length > 0 && (
            <div className="subgoals-list">
              <h4>Sub-goals</h4>
              {subGoals.map((sg, i) => (
                <div key={i} className="subgoal-item">
                  <span className="subgoal-number">{i + 1}</span>
                  <span className="subgoal-text">{sg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Progress Ring and Stats */}
      <section className="progress-overview">
        <div className="progress-ring-large">
          <svg viewBox="0 0 100 100">
            <circle
              className="ring-bg"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="8"
            />
            <circle
              className="ring-progress"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="8"
              strokeDasharray={`${progressPercent * 2.83} 283`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ stroke: getProgressColor(progressPercent) }}
            />
          </svg>
          <div className="ring-content">
            <span className="ring-percent">{progressPercent}%</span>
            <span className="ring-label">Complete</span>
          </div>
        </div>

        <div className="progress-stats">
          <div className="stat-row">
            <CheckCircle2 className="stat-icon success" />
            <span className="stat-label">Completed</span>
            <span className="stat-value">{completed} / {totalSteps}</span>
          </div>
          <div className="stat-row">
            <XCircle className="stat-icon error" />
            <span className="stat-label">Failed</span>
            <span className="stat-value">{failed}</span>
          </div>
          <div className="stat-row">
            <Activity className="stat-icon info" />
            <span className="stat-label">Iterations</span>
            <span className="stat-value">{iteration || 0}</span>
          </div>
          <div className="stat-row">
            <Clock className="stat-icon warning" />
            <span className="stat-label">Elapsed</span>
            <span className="stat-value">{formatDuration(elapsedMs)}</span>
          </div>
        </div>
      </section>

      {/* Step Breakdown */}
      {totalSteps > 0 && (
        <section className="step-breakdown-section">
          <button
            className="section-toggle"
            onClick={() => toggleSection('breakdown')}
          >
            <Layers size={18} />
            <span>Step Breakdown</span>
            {expandedSections.has('breakdown') ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>

          {expandedSections.has('breakdown') && (
            <div className="breakdown-content">
              {/* Status breakdown bar */}
              <div className="status-breakdown">
                <h4>By Status</h4>
                <div className="breakdown-bar">
                  {stepBreakdown.completed > 0 && (
                    <div
                      className="bar-segment completed"
                      style={{ width: `${(stepBreakdown.completed / totalSteps) * 100}%` }}
                      title={`Completed: ${stepBreakdown.completed}`}
                    />
                  )}
                  {stepBreakdown.in_progress > 0 && (
                    <div
                      className="bar-segment in-progress"
                      style={{ width: `${(stepBreakdown.in_progress / totalSteps) * 100}%` }}
                      title={`In Progress: ${stepBreakdown.in_progress}`}
                    />
                  )}
                  {stepBreakdown.blocked > 0 && (
                    <div
                      className="bar-segment blocked"
                      style={{ width: `${(stepBreakdown.blocked / totalSteps) * 100}%` }}
                      title={`Blocked: ${stepBreakdown.blocked}`}
                    />
                  )}
                  {stepBreakdown.failed > 0 && (
                    <div
                      className="bar-segment failed"
                      style={{ width: `${(stepBreakdown.failed / totalSteps) * 100}%` }}
                      title={`Failed: ${stepBreakdown.failed}`}
                    />
                  )}
                  {stepBreakdown.pending > 0 && (
                    <div
                      className="bar-segment pending"
                      style={{ width: `${(stepBreakdown.pending / totalSteps) * 100}%` }}
                      title={`Pending: ${stepBreakdown.pending}`}
                    />
                  )}
                </div>
                <div className="breakdown-legend">
                  <span className="legend-item completed">
                    <span className="legend-dot" /> Completed ({stepBreakdown.completed})
                  </span>
                  <span className="legend-item in-progress">
                    <span className="legend-dot" /> In Progress ({stepBreakdown.in_progress})
                  </span>
                  <span className="legend-item blocked">
                    <span className="legend-dot" /> Blocked ({stepBreakdown.blocked})
                  </span>
                  <span className="legend-item failed">
                    <span className="legend-dot" /> Failed ({stepBreakdown.failed})
                  </span>
                  <span className="legend-item pending">
                    <span className="legend-dot" /> Pending ({stepBreakdown.pending})
                  </span>
                </div>
              </div>

              {/* Complexity breakdown */}
              <div className="complexity-breakdown">
                <h4>By Complexity</h4>
                <div className="complexity-pills">
                  <div className="complexity-pill low">
                    <span className="pill-count">{complexityBreakdown.low}</span>
                    <span className="pill-label">Low</span>
                  </div>
                  <div className="complexity-pill medium">
                    <span className="pill-count">{complexityBreakdown.medium}</span>
                    <span className="pill-label">Medium</span>
                  </div>
                  <div className="complexity-pill high">
                    <span className="pill-count">{complexityBreakdown.high}</span>
                    <span className="pill-label">High</span>
                  </div>
                </div>
              </div>

              {/* Recent transitions */}
              {recentTransitions.length > 0 && (
                <div className="recent-transitions">
                  <h4>Recent Activity</h4>
                  <div className="transitions-list">
                    {recentTransitions.map((t, i) => (
                      <div key={i} className="transition-item">
                        <span className="transition-step">Step {t.stepNumber}</span>
                        <span className={`transition-from ${t.from}`}>{t.from}</span>
                        <ArrowRight size={12} />
                        <span className={`transition-to ${t.to}`}>{t.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Confidence Gauge */}
      <section className="confidence-section">
        <h3><Gauge size={18} /> Confidence Level</h3>
        <div className="confidence-gauge">
          <div className="gauge-display">
            <ConfidenceIcon
              className="confidence-icon"
              style={{ color: confidenceConfig.color }}
            />
            <span
              className="confidence-label"
              style={{ color: confidenceConfig.color }}
            >
              {confidenceConfig.label}
            </span>
            {confidenceTrend !== 'stable' && (
              <TrendIcon
                size={16}
                className={`confidence-trend ${confidenceTrend}`}
              />
            )}
          </div>
          <div className="confidence-meter">
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{
                  width: confidence === 'HIGH' ? '100%' :
                         confidence === 'MEDIUM' ? '60%' :
                         confidence === 'LOW' ? '30%' : '10%',
                  backgroundColor: confidenceConfig.color,
                }}
              />
            </div>
            <div className="meter-labels">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
            </div>
          </div>
        </div>

        {/* Verification details */}
        {(verification?.goal || verification?.gaps) && (
          <div className="verification-details">
            {verification.goal?.achieved !== undefined && (
              <div className={`verification-badge ${verification.goal.achieved ? 'achieved' : 'not-achieved'}`}>
                {verification.goal.achieved ? (
                  <><CheckCircle2 size={16} /> Goal Achieved</>
                ) : (
                  <><AlertTriangle size={16} /> Goal Not Yet Achieved</>
                )}
              </div>
            )}
            {verification.gaps && (
              <div className="gaps-info">
                <span className="gaps-label">Gaps:</span>
                <span className="gaps-text">{verification.gaps}</span>
              </div>
            )}
            {verification.goal?.recommendation && (
              <div className="recommendation">
                <Zap size={14} />
                <span>{verification.goal.recommendation}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Time Progress */}
      <section className="time-section">
        <h3><Clock size={18} /> Time Progress</h3>
        <div className="time-bar">
          <div
            className="time-fill"
            style={{ width: `${Math.min(timePercent, 100)}%` }}
          />
          <div className="time-marker" style={{ left: `${Math.min(timePercent, 100)}%` }} />
        </div>
        <div className="time-labels">
          <span>{formatDuration(elapsedMs)} elapsed</span>
          <span>{timeLimit || 'No limit'}</span>
          {remainingMs > 0 && <span>{formatDuration(remainingMs)} remaining</span>}
        </div>
      </section>

      {/* Iteration History */}
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
        {iteration > 0 && (
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
        )}

        {/* Retry mode info */}
        {retryMode?.enabled && (
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
        )}

        {/* Metrics summary */}
        {metrics && (metrics.tokensIn > 0 || metrics.tokensOut > 0) && (
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
        )}
      </section>

      {/* Final Report Summary */}
      {finalReport && (
        <section className="final-report-section">
          <h3><Award size={18} /> Final Report</h3>
          <div className={`final-status ${finalReport.status}`}>
            {finalReport.status === 'completed' ? (
              <CheckCircle2 className="final-icon" />
            ) : (
              <XCircle className="final-icon" />
            )}
            <span className="final-label">
              {finalReport.status === 'completed' ? 'Goal Completed' : 'Goal Incomplete'}
            </span>
          </div>

          {finalReport.finalVerification && (
            <div className="final-details">
              <div className="detail-row">
                <span>Goal Achieved:</span>
                <strong>{finalReport.finalVerification.goalAchieved ? 'Yes' : 'No'}</strong>
              </div>
              <div className="detail-row">
                <span>Confidence:</span>
                <strong>{finalReport.finalVerification.confidence || 'Unknown'}</strong>
              </div>
              <div className="detail-row">
                <span>Smoke Tests:</span>
                <strong>{finalReport.finalVerification.smokeTestsPassed ? 'Passed' : 'Failed'}</strong>
              </div>
            </div>
          )}

          {finalReport.abortReason && (
            <div className="abort-reason">
              <AlertTriangle size={14} />
              <span>{finalReport.abortReason}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function getProgressColor(percent) {
  if (percent >= 80) return '#22c55e';
  if (percent >= 50) return '#f59e0b';
  if (percent >= 20) return '#3b82f6';
  return '#6b7280';
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
