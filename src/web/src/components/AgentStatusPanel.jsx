import React, { useMemo } from 'react';
import {
  Bot, Activity, Cpu, CircleDot, Play, Pause, CheckCircle2, XCircle,
  AlertTriangle, Clock, Zap, RefreshCw, Target, Eye, MessageSquare,
  Loader2, Radio, Signal, SignalHigh, SignalLow, SignalMedium,
  Brain, Sparkles, Gauge, TrendingUp, ArrowRight
} from 'lucide-react';

const STATUS_CONFIG = {
  idle: { icon: CircleDot, color: '#6b7280', label: 'Idle', description: 'Waiting to start' },
  initializing: { icon: Loader2, color: '#3b82f6', label: 'Initializing', description: 'Setting up agent' },
  planning: { icon: Brain, color: '#8b5cf6', label: 'Planning', description: 'Creating execution plan' },
  executing: { icon: Zap, color: '#22c55e', label: 'Executing', description: 'Running steps' },
  verifying: { icon: Eye, color: '#f59e0b', label: 'Verifying', description: 'Checking results' },
  completed: { icon: CheckCircle2, color: '#22c55e', label: 'Completed', description: 'Task finished' },
  failed: { icon: XCircle, color: '#ef4444', label: 'Failed', description: 'Task failed' },
};

const PHASE_ORDER = ['idle', 'initializing', 'planning', 'executing', 'verifying', 'completed'];

export default function AgentStatusPanel({ state, connected }) {
  const {
    status,
    goal,
    currentStep,
    plan,
    iteration,
    supervision,
    retryMode,
    timeElapsed,
    timeRemaining,
    completedSteps,
    failedSteps,
    lastMessage,
    logs,
  } = state;

  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const StatusIcon = statusConfig.icon;

  // Calculate health indicators
  const healthIndicators = useMemo(() => {
    const completed = completedSteps?.length || 0;
    const failed = failedSteps?.length || 0;
    const total = plan?.steps?.length || 0;

    // Success rate
    const attempted = completed + failed;
    const successRate = attempted > 0 ? (completed / attempted) * 100 : 100;

    // Supervision health
    const supervisionOk = !supervision?.needsIntervention;
    const consecutiveIssues = supervision?.consecutiveIssues || 0;

    // Time health
    const timePercent = timeElapsed && timeRemaining
      ? (timeElapsed / (timeElapsed + timeRemaining)) * 100
      : 0;
    const timeHealthy = timePercent < 80;

    // Overall health score (0-100)
    let healthScore = 100;
    if (failed > 0) healthScore -= Math.min(50, failed * 15);
    if (consecutiveIssues > 0) healthScore -= consecutiveIssues * 10;
    if (timePercent > 80) healthScore -= 15;
    if (!connected) healthScore -= 30;
    healthScore = Math.max(0, healthScore);

    return {
      successRate: successRate.toFixed(0),
      supervisionOk,
      consecutiveIssues,
      timeHealthy,
      timePercent,
      healthScore,
      level: healthScore >= 80 ? 'good' : healthScore >= 50 ? 'warning' : 'critical',
    };
  }, [completedSteps, failedSteps, plan, supervision, timeElapsed, timeRemaining, connected]);

  // Current phase index for progress indicator
  const currentPhaseIndex = PHASE_ORDER.indexOf(status);

  // Recent activity log
  const recentActivity = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    return logs
      .slice(-5)
      .reverse()
      .map(log => ({
        ...log,
        timeAgo: getTimeAgo(log.timestamp),
      }));
  }, [logs]);

  return (
    <div className="agent-status-panel">
      {/* Main Status Card */}
      <section className="status-hero">
        <div className="status-hero-content">
          <div className={`status-icon-container ${status}`}>
            <StatusIcon
              className={`status-icon ${status === 'initializing' || status === 'planning' ? 'spinning' : ''}`}
              size={48}
              style={{ color: statusConfig.color }}
            />
          </div>
          <div className="status-info">
            <h1 className="status-label" style={{ color: statusConfig.color }}>
              {statusConfig.label}
            </h1>
            <p className="status-description">{statusConfig.description}</p>
            {goal && (
              <div className="status-goal">
                <Target size={14} />
                <span>{goal.length > 80 ? goal.substring(0, 80) + '...' : goal}</span>
              </div>
            )}
          </div>
          <div className="connection-indicator">
            {connected ? (
              <div className="connection-badge connected">
                <Radio size={14} />
                <span>Connected</span>
              </div>
            ) : (
              <div className="connection-badge disconnected">
                <Radio size={14} />
                <span>Disconnected</span>
              </div>
            )}
          </div>
        </div>

        {/* Phase Progress */}
        <div className="phase-progress">
          {PHASE_ORDER.slice(0, -1).map((phase, index) => {
            const isActive = index === currentPhaseIndex;
            const isCompleted = index < currentPhaseIndex || status === 'completed';
            const config = STATUS_CONFIG[phase];
            const PhaseIcon = config.icon;

            return (
              <React.Fragment key={phase}>
                <div className={`phase-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                  <div className="phase-icon">
                    {isCompleted ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <PhaseIcon size={20} className={isActive ? 'pulse' : ''} />
                    )}
                  </div>
                  <span className="phase-label">{config.label}</span>
                </div>
                {index < PHASE_ORDER.length - 2 && (
                  <div className={`phase-connector ${isCompleted ? 'completed' : ''}`}>
                    <ArrowRight size={16} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* Health Indicators */}
      <section className="health-section">
        <h2><Activity size={18} /> System Health</h2>
        <div className="health-grid">
          <HealthCard
            icon={<Gauge />}
            label="Overall Health"
            value={`${healthIndicators.healthScore}%`}
            level={healthIndicators.level}
            description="System health score"
          />
          <HealthCard
            icon={<TrendingUp />}
            label="Success Rate"
            value={`${healthIndicators.successRate}%`}
            level={parseFloat(healthIndicators.successRate) >= 80 ? 'good' :
                   parseFloat(healthIndicators.successRate) >= 50 ? 'warning' : 'critical'}
            description="Step success rate"
          />
          <HealthCard
            icon={<Eye />}
            label="Supervision"
            value={healthIndicators.supervisionOk ? 'OK' : 'Issues'}
            level={healthIndicators.supervisionOk ? 'good' : 'warning'}
            description={`${healthIndicators.consecutiveIssues} consecutive issues`}
          />
          <HealthCard
            icon={<Clock />}
            label="Time Budget"
            value={healthIndicators.timePercent > 0 ? `${healthIndicators.timePercent.toFixed(0)}%` : 'N/A'}
            level={healthIndicators.timeHealthy ? 'good' : 'warning'}
            description={healthIndicators.timeHealthy ? 'On track' : 'Running low'}
          />
        </div>
      </section>

      {/* Current Operation */}
      <section className="operation-section">
        <h2><Cpu size={18} /> Current Operation</h2>
        {status === 'executing' && currentStep ? (
          <div className="current-operation">
            <div className="operation-header">
              <div className="operation-badge">
                <Zap size={16} />
                <span>Step {currentStep.number || '?'}</span>
              </div>
              {currentStep.complexity && (
                <span className={`complexity-tag ${currentStep.complexity}`}>
                  {currentStep.complexity}
                </span>
              )}
            </div>
            <p className="operation-description">
              {currentStep.description || 'Executing current step...'}
            </p>
            {currentStep.subSteps && currentStep.subSteps.length > 0 && (
              <div className="operation-substeps">
                <h4>Sub-steps</h4>
                <ul>
                  {currentStep.subSteps.map((sub, i) => (
                    <li key={i}>{sub}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : status === 'planning' ? (
          <div className="current-operation planning">
            <div className="operation-header">
              <div className="operation-badge planning">
                <Brain size={16} className="pulse" />
                <span>Planning</span>
              </div>
            </div>
            <p className="operation-description">
              Analyzing goal and creating execution plan...
            </p>
          </div>
        ) : status === 'verifying' ? (
          <div className="current-operation verifying">
            <div className="operation-header">
              <div className="operation-badge verifying">
                <Eye size={16} className="pulse" />
                <span>Verifying</span>
              </div>
            </div>
            <p className="operation-description">
              Running verification checks on completed work...
            </p>
          </div>
        ) : (
          <div className="no-operation">
            <CircleDot size={24} />
            <span>No active operation</span>
          </div>
        )}
      </section>

      {/* Retry Mode Status */}
      {retryMode?.enabled && (
        <section className="retry-mode-section">
          <h2><RefreshCw size={18} /> Retry Mode Active</h2>
          <div className="retry-status">
            <div className="retry-attempt">
              <span className="attempt-current">{retryMode.currentAttempt || 1}</span>
              <span className="attempt-separator">/</span>
              <span className="attempt-max">{retryMode.maxAttempts || '?'}</span>
              <span className="attempt-label">attempts</span>
            </div>
            <div className="retry-target">
              <Target size={16} />
              <span>Target: <strong>HIGH</strong> confidence</span>
            </div>
            {retryMode.attempts?.length > 0 && (
              <div className="attempt-history">
                {retryMode.attempts.slice(-5).map((attempt, i) => (
                  <div
                    key={i}
                    className={`attempt-dot ${attempt.confidence?.toLowerCase() || 'unknown'}`}
                    title={`Attempt ${attempt.number}: ${attempt.confidence}`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Live Stats */}
      <section className="live-stats-section">
        <h2><Activity size={18} /> Live Statistics</h2>
        <div className="live-stats-grid">
          <div className="live-stat">
            <span className="stat-value">{iteration || 0}</span>
            <span className="stat-label">Iterations</span>
          </div>
          <div className="live-stat">
            <span className="stat-value">{completedSteps?.length || 0}</span>
            <span className="stat-label">Steps Done</span>
          </div>
          <div className="live-stat">
            <span className="stat-value">{failedSteps?.length || 0}</span>
            <span className="stat-label">Steps Failed</span>
          </div>
          <div className="live-stat">
            <span className="stat-value">{formatDuration(timeElapsed || 0)}</span>
            <span className="stat-label">Elapsed</span>
          </div>
        </div>
      </section>

      {/* Recent Activity */}
      <section className="activity-section">
        <h2><MessageSquare size={18} /> Recent Activity</h2>
        {recentActivity.length > 0 ? (
          <div className="activity-list">
            {recentActivity.map((activity, i) => (
              <div key={i} className={`activity-item ${activity.level}`}>
                <div className="activity-indicator">
                  {activity.level === 'success' && <CheckCircle2 size={14} />}
                  {activity.level === 'error' && <XCircle size={14} />}
                  {activity.level === 'warning' && <AlertTriangle size={14} />}
                  {activity.level === 'info' && <Activity size={14} />}
                  {!['success', 'error', 'warning', 'info'].includes(activity.level) && <CircleDot size={14} />}
                </div>
                <span className="activity-message">
                  {activity.message?.length > 100
                    ? activity.message.substring(0, 100) + '...'
                    : activity.message}
                </span>
                <span className="activity-time">{activity.timeAgo}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-activity">
            <CircleDot size={20} />
            <span>No recent activity</span>
          </div>
        )}
      </section>
    </div>
  );
}

function HealthCard({ icon, label, value, level, description }) {
  return (
    <div className={`health-card ${level}`}>
      <div className="health-icon">{icon}</div>
      <div className="health-content">
        <span className="health-value">{value}</span>
        <span className="health-label">{label}</span>
        {description && <span className="health-description">{description}</span>}
      </div>
      <div className={`health-indicator ${level}`} />
    </div>
  );
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

function getTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
