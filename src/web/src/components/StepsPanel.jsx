import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Circle, PlayCircle, Clock, ChevronDown, ChevronRight,
  AlertTriangle, ArrowRight, GitBranch, List, ExternalLink
} from 'lucide-react';
import DAGVisualization from './DAGVisualization';
import StepDetailView from './StepDetailView';

const statusIcons = {
  completed: CheckCircle2,
  failed: XCircle,
  blocked: AlertTriangle,
  in_progress: PlayCircle,
  pending: Circle,
};

const statusColors = {
  completed: 'success',
  failed: 'error',
  blocked: 'warning',
  in_progress: 'active',
  pending: 'pending',
};

const complexityColors = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

const statusColorValues = {
  completed: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  in_progress: '#3b82f6',
  pending: '#6b7280',
};

export default function StepsPanel({ state, logs = [], retryHistory = [] }) {
  const { plan, completedSteps, failedSteps, currentStep, stepChanges } = state;
  const steps = plan?.steps || [];
  const [expandedSteps, setExpandedSteps] = useState(new Set());
  const [viewMode, setViewMode] = useState('dag'); // 'dag' or 'list'
  const [recentlyChanged, setRecentlyChanged] = useState(new Set());
  const [statusTransitions, setStatusTransitions] = useState([]);
  const [selectedStep, setSelectedStep] = useState(null);
  const prevStepsRef = useRef([]);

  // Handle node click from DAG or list
  const handleStepClick = useCallback((step) => {
    setSelectedStep(step);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedStep(null);
  }, []);

  const toggleStep = (stepNumber) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  };

  // Track status changes for animations - use WebSocket stepChanges if available
  useEffect(() => {
    // If we have stepChanges from WebSocket, use those
    // Note: changedSteps is now an array (not a Set) for React state serialization
    if (stepChanges?.changedSteps?.length > 0) {
      setRecentlyChanged(new Set(stepChanges.changedSteps));
      setStatusTransitions(prev => [
        ...prev.slice(-20), // Keep last 20 transitions
        ...(stepChanges.statusTransitions || []),
      ]);

      // Clear the animation after it completes
      const timer = setTimeout(() => {
        setRecentlyChanged(new Set());
      }, 1500);
      return () => clearTimeout(timer);
    }

    // Fallback: detect changes locally
    const prevSteps = prevStepsRef.current;
    const changedStepNumbers = new Set();

    steps.forEach(step => {
      const prevStep = prevSteps.find(p => p.number === step.number);
      if (!prevStep || prevStep.status !== step.status) {
        changedStepNumbers.add(step.number);
      }
    });

    // Also detect new steps
    steps.forEach(step => {
      const prevStep = prevSteps.find(p => p.number === step.number);
      if (!prevStep) {
        changedStepNumbers.add(step.number);
      }
    });

    if (changedStepNumbers.size > 0) {
      setRecentlyChanged(changedStepNumbers);
      // Clear the animation after it completes
      const timer = setTimeout(() => {
        setRecentlyChanged(new Set());
      }, 1500);
      return () => clearTimeout(timer);
    }

    prevStepsRef.current = [...steps];
  }, [steps, stepChanges]);

  // Calculate stats
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed' || s.status === 'blocked').length;
  const inProgress = steps.filter(s => s.status === 'in_progress').length;
  const pending = steps.filter(s => s.status === 'pending' || !s.status).length;

  // Calculate DAG layout
  const dagLayout = useMemo(() => {
    if (steps.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

    // Build dependency graph
    const nodeMap = new Map();
    steps.forEach((step, index) => {
      nodeMap.set(step.number || index + 1, {
        ...step,
        number: step.number || index + 1,
        dependents: [],
        level: 0,
      });
    });

    // Calculate levels based on dependencies (topological order)
    steps.forEach(step => {
      const deps = step.dependencies || [];
      deps.forEach(depNum => {
        const parent = nodeMap.get(depNum);
        if (parent) {
          parent.dependents.push(step.number || steps.indexOf(step) + 1);
        }
      });
    });

    // Calculate levels using BFS
    const calculateLevels = () => {
      const levels = new Map();
      const visited = new Set();

      // Find root nodes (no dependencies)
      const roots = [];
      nodeMap.forEach((node, num) => {
        const deps = node.dependencies || [];
        const hasDeps = deps.some(d => nodeMap.has(d));
        if (!hasDeps) {
          roots.push(num);
          levels.set(num, 0);
        }
      });

      // BFS to calculate levels
      const queue = [...roots];
      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);

        const node = nodeMap.get(current);
        const currentLevel = levels.get(current) || 0;

        node.dependents.forEach(depNum => {
          const existingLevel = levels.get(depNum) || 0;
          levels.set(depNum, Math.max(existingLevel, currentLevel + 1));
          if (!visited.has(depNum)) {
            queue.push(depNum);
          }
        });
      }

      // Handle nodes without dependencies that weren't processed
      nodeMap.forEach((node, num) => {
        if (!levels.has(num)) {
          levels.set(num, 0);
        }
      });

      return levels;
    };

    const levels = calculateLevels();
    const maxLevel = Math.max(...levels.values(), 0);

    // Group nodes by level
    const levelGroups = new Map();
    levels.forEach((level, num) => {
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level).push(num);
    });

    // Calculate node positions
    const NODE_WIDTH = 180;
    const NODE_HEIGHT = 60;
    const LEVEL_GAP = 120;
    const NODE_GAP = 30;

    const nodes = [];
    const maxNodesInLevel = Math.max(...[...levelGroups.values()].map(g => g.length), 1);
    const totalWidth = Math.max(maxNodesInLevel * (NODE_WIDTH + NODE_GAP), 400);
    const totalHeight = (maxLevel + 1) * (NODE_HEIGHT + LEVEL_GAP) + 100;

    levelGroups.forEach((nodeNums, level) => {
      const levelWidth = nodeNums.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
      const startX = (totalWidth - levelWidth) / 2;

      nodeNums.forEach((num, i) => {
        const step = nodeMap.get(num);
        nodes.push({
          ...step,
          x: startX + i * (NODE_WIDTH + NODE_GAP) + NODE_WIDTH / 2,
          y: level * (NODE_HEIGHT + LEVEL_GAP) + NODE_HEIGHT / 2 + 40,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
      });
    });

    // Calculate edges
    const edges = [];
    nodes.forEach(node => {
      const deps = node.dependencies || [];
      deps.forEach(depNum => {
        const parent = nodes.find(n => n.number === depNum);
        if (parent) {
          edges.push({
            from: parent,
            to: node,
            status: parent.status,
          });
        }
      });
    });

    return { nodes, edges, width: totalWidth, height: totalHeight };
  }, [steps]);

  if (steps.length === 0) {
    return (
      <div className="steps-panel empty">
        <div className="empty-state">
          <Circle size={48} className="empty-icon" />
          <h3>No Plan Yet</h3>
          <p>Steps will appear here once a plan is created.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="steps-panel">
      {/* Summary Header */}
      <div className="steps-summary">
        <div className="summary-item">
          <span className="summary-count">{steps.length}</span>
          <span className="summary-label">Total</span>
        </div>
        <div className="summary-item success">
          <span className="summary-count">{completed}</span>
          <span className="summary-label">Completed</span>
        </div>
        <div className="summary-item active">
          <span className="summary-count">{inProgress}</span>
          <span className="summary-label">In Progress</span>
        </div>
        <div className="summary-item pending">
          <span className="summary-count">{pending}</span>
          <span className="summary-label">Pending</span>
        </div>
        <div className="summary-item error">
          <span className="summary-count">{failed}</span>
          <span className="summary-label">Failed</span>
        </div>

        {/* View Mode Toggle */}
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewMode === 'dag' ? 'active' : ''}`}
            onClick={() => setViewMode('dag')}
            title="DAG View"
          >
            <GitBranch size={16} />
          </button>
          <button
            className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List View"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* DAG View - Enhanced with pan/zoom/selection */}
      {viewMode === 'dag' && (
        <DAGVisualization
          nodes={dagLayout.nodes}
          edges={dagLayout.edges}
          width={dagLayout.width}
          height={dagLayout.height}
          currentStep={currentStep}
          recentlyChanged={recentlyChanged}
          statusTransitions={statusTransitions}
          onNodeClick={handleStepClick}
        />
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="steps-list">
          {steps.map((step, index) => {
            const StatusIcon = statusIcons[step.status] || Circle;
            const colorClass = statusColors[step.status] || 'pending';
            const isExpanded = expandedSteps.has(step.number);
            const hasDetails = step.failReason || step.verification || step.subSteps;
            const hasChanged = recentlyChanged.has(step.number);

            return (
              <div
                key={step.number || index}
                className={`step-item ${colorClass} ${isExpanded ? 'expanded' : ''} ${hasChanged ? 'status-changed' : ''}`}
              >
                <div
                  className="step-header"
                  onClick={() => hasDetails && toggleStep(step.number)}
                >
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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStepClick(step);
                    }}
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
          })}
        </div>
      )}

      {/* Timeline View */}
      <div className="steps-timeline">
        <h3>Timeline</h3>
        <div className="timeline">
          {steps.map((step, index) => {
            const colorClass = statusColors[step.status] || 'pending';
            const hasChanged = recentlyChanged.has(step.number);
            return (
              <div
                key={step.number || index}
                className={`timeline-item ${colorClass} ${hasChanged ? 'pulse' : ''}`}
                title={`Step ${step.number}: ${step.description}`}
                onClick={() => handleStepClick(step)}
                style={{ cursor: 'pointer' }}
              >
                <div className="timeline-marker" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Detail Modal */}
      {selectedStep && (
        <StepDetailView
          step={selectedStep}
          onClose={handleCloseDetail}
          logs={logs}
          retryHistory={retryHistory}
        />
      )}
    </div>
  );
}

function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

function formatDuration(ms) {
  if (!ms) return '';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
