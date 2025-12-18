import React, { useState, useMemo } from 'react';
import {
  X, Clock, CheckCircle2, XCircle, AlertTriangle, PlayCircle, Circle,
  ChevronDown, ChevronRight, ArrowRight, Copy, Check, Hash, Layers,
  FileText, Terminal, RefreshCw, GitBranch, Zap, Target, Timer,
  MessageSquare, Code, ExternalLink
} from 'lucide-react';

const statusConfig = {
  completed: { icon: CheckCircle2, color: '#22c55e', label: 'Completed' },
  failed: { icon: XCircle, color: '#ef4444', label: 'Failed' },
  blocked: { icon: AlertTriangle, color: '#f59e0b', label: 'Blocked' },
  in_progress: { icon: PlayCircle, color: '#3b82f6', label: 'In Progress' },
  pending: { icon: Circle, color: '#6b7280', label: 'Pending' },
};

const complexityConfig = {
  low: { color: '#22c55e', label: 'Low' },
  medium: { color: '#f59e0b', label: 'Medium' },
  high: { color: '#ef4444', label: 'High' },
};

export default function StepDetailView({ step, onClose, logs = [], retryHistory = [] }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedSections, setExpandedSections] = useState(new Set(['info', 'substeps']));
  const [copiedField, setCopiedField] = useState(null);

  if (!step) return null;

  const status = statusConfig[step.status] || statusConfig.pending;
  const complexity = complexityConfig[step.complexity] || complexityConfig.medium;
  const StatusIcon = status.icon;

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

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Filter logs related to this step
  const stepLogs = useMemo(() => {
    return logs.filter(log =>
      log.message?.includes(`Step ${step.number}`) ||
      log.message?.includes(`step ${step.number}`) ||
      log.stepNumber === step.number
    ).slice(-20);
  }, [logs, step.number]);

  // Get retry attempts for this step
  const stepRetries = useMemo(() => {
    return retryHistory.filter(r => r.stepNumber === step.number);
  }, [retryHistory, step.number]);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: FileText },
    { id: 'output', label: 'Output', icon: Terminal, count: stepLogs.length },
    { id: 'retries', label: 'Retries', icon: RefreshCw, count: stepRetries.length },
  ];

  return (
    <div className="step-detail-overlay" onClick={onClose}>
      <div className="step-detail-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="step-detail-header">
          <div className="step-detail-title">
            <div className="step-number-badge" style={{ backgroundColor: status.color }}>
              {step.number}
            </div>
            <div className="step-title-content">
              <h2>Step {step.number}</h2>
              <span className={`status-pill ${step.status || 'pending'}`}>
                <StatusIcon size={14} />
                {status.label}
              </span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="step-detail-tabs">
          {tabs.map(tab => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <TabIcon size={16} />
                <span>{tab.label}</span>
                {tab.count > 0 && <span className="tab-count">{tab.count}</span>}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="step-detail-content">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="tab-content">
              {/* Description Section */}
              <Section
                title="Description"
                icon={<FileText size={16} />}
                expanded={expandedSections.has('info')}
                onToggle={() => toggleSection('info')}
              >
                <div className="description-block">
                  <p className="step-description">{step.description}</p>
                  <button
                    className="copy-btn"
                    onClick={() => copyToClipboard(step.description, 'description')}
                  >
                    {copiedField === 'description' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </Section>

              {/* Quick Stats */}
              <div className="quick-stats">
                <div className="stat-item">
                  <span className="stat-icon" style={{ color: complexity.color }}>
                    <Zap size={16} />
                  </span>
                  <div className="stat-content">
                    <span className="stat-label">Complexity</span>
                    <span className="stat-value" style={{ color: complexity.color }}>
                      {complexity.label}
                    </span>
                  </div>
                </div>
                {step.duration && (
                  <div className="stat-item">
                    <span className="stat-icon">
                      <Timer size={16} />
                    </span>
                    <div className="stat-content">
                      <span className="stat-label">Duration</span>
                      <span className="stat-value">{formatDuration(step.duration)}</span>
                    </div>
                  </div>
                )}
                {step.startTime && (
                  <div className="stat-item">
                    <span className="stat-icon">
                      <Clock size={16} />
                    </span>
                    <div className="stat-content">
                      <span className="stat-label">Started</span>
                      <span className="stat-value">{formatTime(step.startTime)}</span>
                    </div>
                  </div>
                )}
                {step.retryCount > 0 && (
                  <div className="stat-item">
                    <span className="stat-icon warning">
                      <RefreshCw size={16} />
                    </span>
                    <div className="stat-content">
                      <span className="stat-label">Retries</span>
                      <span className="stat-value">{step.retryCount}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Dependencies Section */}
              {step.dependencies && step.dependencies.length > 0 && (
                <Section
                  title="Dependencies"
                  icon={<GitBranch size={16} />}
                  expanded={expandedSections.has('deps')}
                  onToggle={() => toggleSection('deps')}
                >
                  <div className="dependencies-list">
                    {step.dependencies.map(dep => (
                      <span key={dep} className="dep-chip">
                        <ArrowRight size={12} />
                        Step {dep}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Sub-steps Section */}
              {step.subSteps && step.subSteps.length > 0 && (
                <Section
                  title="Sub-steps"
                  icon={<Layers size={16} />}
                  expanded={expandedSections.has('substeps')}
                  onToggle={() => toggleSection('substeps')}
                  count={step.subSteps.length}
                >
                  <ul className="substeps-list">
                    {step.subSteps.map((subStep, i) => {
                      const subStatus = statusConfig[subStep.status] || statusConfig.pending;
                      const SubIcon = subStatus.icon;
                      return (
                        <li key={i} className={`substep-item ${subStep.status || 'pending'}`}>
                          <SubIcon size={14} style={{ color: subStatus.color }} />
                          <span className="substep-text">{subStep.description}</span>
                          {subStep.duration && (
                            <span className="substep-duration">{formatDuration(subStep.duration)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {/* Verification Section */}
              {step.verification && (
                <Section
                  title="Verification"
                  icon={<Target size={16} />}
                  expanded={expandedSections.has('verification')}
                  onToggle={() => toggleSection('verification')}
                >
                  <div className="verification-block">
                    <div className="verification-status">
                      <CheckCircle2 size={16} className="success" />
                      <span>Verified</span>
                    </div>
                    <p className="verification-text">{step.verification}</p>
                  </div>
                </Section>
              )}

              {/* Error Section */}
              {(step.failReason || step.error) && (
                <Section
                  title="Error Details"
                  icon={<XCircle size={16} />}
                  expanded={expandedSections.has('error')}
                  onToggle={() => toggleSection('error')}
                  variant="error"
                >
                  <div className="error-block">
                    <p className="error-message">{step.failReason || step.error}</p>
                    {step.errorStack && (
                      <pre className="error-stack">{step.errorStack}</pre>
                    )}
                    <button
                      className="copy-btn"
                      onClick={() => copyToClipboard(step.failReason || step.error, 'error')}
                    >
                      {copiedField === 'error' ? <Check size={14} /> : <Copy size={14} />}
                      Copy Error
                    </button>
                  </div>
                </Section>
              )}

              {/* Output/Result Section */}
              {step.output && (
                <Section
                  title="Output"
                  icon={<Code size={16} />}
                  expanded={expandedSections.has('output')}
                  onToggle={() => toggleSection('output')}
                >
                  <pre className="output-block">{step.output}</pre>
                </Section>
              )}
            </div>
          )}

          {/* Output Tab */}
          {activeTab === 'output' && (
            <div className="tab-content">
              {stepLogs.length === 0 ? (
                <div className="empty-state">
                  <Terminal size={48} />
                  <p>No output logs for this step</p>
                </div>
              ) : (
                <div className="output-logs">
                  {stepLogs.map((log, i) => (
                    <div key={i} className={`output-log-entry ${log.level}`}>
                      <div className="log-entry-header">
                        <span className="log-time">{formatTime(log.timestamp)}</span>
                        <span className={`log-level-badge ${log.level}`}>{log.level}</span>
                      </div>
                      <pre className="log-entry-content">{log.full || log.message}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Retries Tab */}
          {activeTab === 'retries' && (
            <div className="tab-content">
              {stepRetries.length === 0 && !step.retryCount ? (
                <div className="empty-state">
                  <RefreshCw size={48} />
                  <p>No retry history for this step</p>
                </div>
              ) : (
                <div className="retry-history">
                  {step.retryCount > 0 && (
                    <div className="retry-summary">
                      <div className="retry-stat">
                        <span className="retry-stat-value">{step.retryCount}</span>
                        <span className="retry-stat-label">Total Retries</span>
                      </div>
                      {step.lastRetryAt && (
                        <div className="retry-stat">
                          <span className="retry-stat-value">{formatTime(step.lastRetryAt)}</span>
                          <span className="retry-stat-label">Last Retry</span>
                        </div>
                      )}
                    </div>
                  )}

                  {stepRetries.length > 0 && (
                    <div className="retry-timeline">
                      <h3>Retry Attempts</h3>
                      {stepRetries.map((retry, i) => (
                        <div
                          key={i}
                          className={`retry-entry ${retry.success ? 'success' : 'failed'}`}
                        >
                          <div className="retry-entry-header">
                            <span className="retry-attempt">Attempt #{retry.attempt || i + 1}</span>
                            <span className={`retry-result ${retry.success ? 'success' : 'failed'}`}>
                              {retry.success ? (
                                <><CheckCircle2 size={14} /> Success</>
                              ) : (
                                <><XCircle size={14} /> Failed</>
                              )}
                            </span>
                          </div>
                          {retry.duration && (
                            <div className="retry-duration">
                              <Timer size={12} /> {formatDuration(retry.duration)}
                            </div>
                          )}
                          {retry.error && (
                            <div className="retry-error">
                              <AlertTriangle size={12} /> {retry.error}
                            </div>
                          )}
                          {retry.timestamp && (
                            <div className="retry-time">
                              <Clock size={12} /> {formatTime(retry.timestamp)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="step-detail-footer">
          <span className="step-id">Step #{step.number}</span>
          {step.startTime && step.endTime && (
            <span className="step-time-range">
              {formatTime(step.startTime)} - {formatTime(step.endTime)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Collapsible Section Component
function Section({ title, icon, expanded, onToggle, children, count, variant }) {
  return (
    <div className={`detail-section ${variant || ''} ${expanded ? 'expanded' : ''}`}>
      <button className="section-header" onClick={onToggle}>
        {icon}
        <span className="section-title">{title}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {expanded && <div className="section-content">{children}</div>}
    </div>
  );
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
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
