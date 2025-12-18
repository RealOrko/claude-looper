import React from 'react';
import {
  Target, Clock, Zap, CheckCircle2, XCircle, AlertTriangle,
  Activity, Eye, TrendingUp, Layers
} from 'lucide-react';

export default function Dashboard({ state }) {
  const { goal, subGoals, plan, metrics, status, supervision, verification, currentStep, completedSteps, failedSteps, iteration, timeElapsed, progress } = state;

  // Get step counts from both server state and metrics (for compatibility)
  const stepsCompleted = completedSteps?.length || metrics?.stepsCompleted || 0;
  const stepsFailed = failedSteps?.length || metrics?.stepsFailed || 0;
  const iterations = iteration || metrics?.iterations || 0;
  const elapsed = timeElapsed || metrics?.elapsedTime || 0;

  return (
    <div className="dashboard">
      {/* Goal Section */}
      <section className="dashboard-section goal-section">
        <h2><Target size={20} /> Primary Goal</h2>
        <div className="goal-card">
          <p className="goal-text">{goal || 'No goal set'}</p>
          {subGoals && subGoals.length > 0 && (
            <div className="sub-goals">
              <h4>Sub-Goals</h4>
              <ul>
                {subGoals.map((sg, i) => (
                  <li key={i}>{sg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Stats Grid */}
      <section className="dashboard-section stats-section">
        <div className="stats-grid">
          <StatCard
            icon={<Layers />}
            label="Total Steps"
            value={plan?.steps?.length || 0}
            color="blue"
          />
          <StatCard
            icon={<CheckCircle2 />}
            label="Completed"
            value={stepsCompleted}
            color="green"
          />
          <StatCard
            icon={<XCircle />}
            label="Failed"
            value={stepsFailed}
            color="red"
          />
          <StatCard
            icon={<Activity />}
            label="Iterations"
            value={iterations}
            color="purple"
          />
          <StatCard
            icon={<Clock />}
            label="Elapsed"
            value={formatDuration(elapsed)}
            color="orange"
          />
          <StatCard
            icon={<Eye />}
            label="Supervisions"
            value={metrics?.supervisionChecks || 0}
            color="cyan"
          />
        </div>
      </section>

      {/* Current Step */}
      {currentStep && (
        <section className="dashboard-section current-step-section">
          <h2><Zap size={20} /> Current Step</h2>
          <div className="current-step-card">
            <div className="step-number">Step {currentStep.number || currentStep.current}</div>
            <div className="step-description">{currentStep.description || `Step ${currentStep.current} of ${currentStep.total}`}</div>
            {currentStep.complexity && (
              <span className={`complexity-badge ${currentStep.complexity}`}>
                {currentStep.complexity}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Progress Section */}
      {plan?.steps && plan.steps.length > 0 && (
        <section className="dashboard-section progress-section">
          <h2><TrendingUp size={20} /> Progress Overview</h2>
          <div className="progress-bar-container">
            <div className="progress-bar">
              <div
                className="progress-fill completed"
                style={{ width: `${(stepsCompleted / plan.steps.length) * 100}%` }}
              />
              <div
                className="progress-fill failed"
                style={{
                  width: `${(stepsFailed / plan.steps.length) * 100}%`,
                  left: `${(stepsCompleted / plan.steps.length) * 100}%`,
                }}
              />
            </div>
            <div className="progress-labels">
              <span>{stepsCompleted} completed</span>
              <span>{plan.steps.length - stepsCompleted - stepsFailed} remaining</span>
              <span>{stepsFailed} failed</span>
            </div>
          </div>
        </section>
      )}

      {/* Supervision Status */}
      {supervision && (
        <section className="dashboard-section supervision-section">
          <h2><Eye size={20} /> Latest Supervision</h2>
          <div className={`supervision-card ${supervision.needsIntervention ? 'warning' : 'ok'}`}>
            <div className="supervision-header">
              {supervision.needsIntervention ? (
                <AlertTriangle className="supervision-icon warning" />
              ) : (
                <CheckCircle2 className="supervision-icon ok" />
              )}
              <span className="supervision-action">
                {supervision.assessment?.action || 'continue'}
              </span>
            </div>
            {supervision.assessment?.reason && (
              <p className="supervision-reason">{supervision.assessment.reason}</p>
            )}
            <div className="supervision-meta">
              <span>Score: {supervision.assessment?.score || 'N/A'}</span>
              <span>Issues: {supervision.consecutiveIssues || 0}</span>
            </div>
          </div>
        </section>
      )}

      {/* Verification Status */}
      {verification && (
        <section className="dashboard-section verification-section">
          <h2><CheckCircle2 size={20} /> Verification</h2>
          <div className={`verification-card ${verification.passed ? 'passed' : 'failed'}`}>
            <div className="verification-result">
              {verification.passed ? (
                <CheckCircle2 className="verification-icon passed" />
              ) : (
                <XCircle className="verification-icon failed" />
              )}
              <span>{verification.passed ? 'Passed' : 'Failed'}</span>
            </div>
            {verification.confidence && (
              <div className="verification-confidence">
                <span>Confidence: </span>
                <strong>{verification.confidence}</strong>
              </div>
            )}
            {verification.gaps && (
              <div className="verification-gaps">
                <span>Gaps: </span>
                {verification.gaps}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms) return '0:00';
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
