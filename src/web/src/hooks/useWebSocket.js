import { useState, useEffect, useCallback, useRef } from 'react';

const initialState = {
  status: 'idle',
  goal: null,
  subGoals: [],
  timeLimit: null,
  plan: null,
  currentStep: null,
  completedSteps: [],
  failedSteps: [],
  logs: [],
  progress: 0,
  timeElapsed: 0,
  timeRemaining: null,
  iteration: 0,
  session: null,
  lastMessage: null,
  lastError: null,
  supervision: null,
  verification: null,
  retryMode: {
    enabled: false,
    currentAttempt: 0,
    maxAttempts: 0,
    attempts: [],
  },
  errors: [],
  // Track step changes for DAG animations
  stepChanges: {
    lastUpdated: null,
    changedSteps: new Set(),
    newSteps: new Set(),
    statusTransitions: [], // { stepNumber, from, to, timestamp }
  },
  // For backward compatibility with UI components
  metrics: {
    iterations: 0,
    tokensIn: 0,
    tokensOut: 0,
    startTime: null,
    elapsedTime: 0,
    stepsCompleted: 0,
    stepsFailed: 0,
    supervisionChecks: 0,
    interventions: 0,
  },
};

// Helper to detect step changes between old and new state
function detectStepChanges(prevPlan, newPlan) {
  const changes = {
    changedSteps: new Set(),
    newSteps: new Set(),
    statusTransitions: [],
  };

  if (!newPlan?.steps) return changes;

  const prevStepsMap = new Map(
    (prevPlan?.steps || []).map(s => [s.number, s])
  );

  for (const step of newPlan.steps) {
    const prevStep = prevStepsMap.get(step.number);

    if (!prevStep) {
      // New step added
      changes.newSteps.add(step.number);
      changes.changedSteps.add(step.number);
    } else if (prevStep.status !== step.status) {
      // Status changed
      changes.changedSteps.add(step.number);
      changes.statusTransitions.push({
        stepNumber: step.number,
        from: prevStep.status,
        to: step.status,
        timestamp: Date.now(),
      });
    }
  }

  return changes;
}

export function useWebSocket() {
  const [state, setState] = useState(initialState);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setReconnecting(true);

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setReconnecting(false);
        setError(null);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error');
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Auto-reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (e) {
      setError('Failed to connect');
      console.error('WebSocket connection failed:', e);
    }
  }, []);

  const handleMessage = useCallback((message) => {
    switch (message.type) {
      case 'init':
      case 'state':
        // Server sends full state in message.data
        setState(prev => {
          const newState = message.data || initialState;
          const stepChanges = detectStepChanges(prev.plan, newState.plan);
          return {
            ...newState,
            stepChanges: {
              lastUpdated: Date.now(),
              ...stepChanges,
            },
          };
        });
        break;

      case 'stateUpdate':
        // Server sends full state updates with step change tracking
        setState(prev => {
          const newState = message.data || initialState;
          const stepChanges = detectStepChanges(prev.plan, newState.plan);
          return {
            ...newState,
            stepChanges: {
              lastUpdated: Date.now(),
              ...stepChanges,
            },
          };
        });
        break;

      case 'history':
        // Server sends event history on connect
        // Process history events to rebuild logs
        if (Array.isArray(message.data)) {
          setState(prev => {
            const logs = message.data
              .filter(e => e.type === 'message' || e.type === 'progress')
              .map(e => ({
                id: e.timestamp + Math.random(),
                timestamp: e.timestamp,
                level: e.type === 'message' ? 'output' : 'info',
                message: e.data?.content?.substring(0, 200) || e.data?.message || '',
                full: e.data?.content,
              }));
            return {
              ...prev,
              logs: [...prev.logs, ...logs].slice(-1000),
            };
          });
        }
        break;

      case 'progress':
        // Real-time progress updates with step change tracking
        setState(prev => {
          const newData = message.data || {};
          const stepChanges = newData.plan
            ? detectStepChanges(prev.plan, newData.plan)
            : prev.stepChanges;

          return {
            ...prev,
            ...newData,
            stepChanges: newData.plan
              ? { lastUpdated: Date.now(), ...stepChanges }
              : prev.stepChanges,
          };
        });
        break;

      case 'message':
        // Add message to logs if not already there
        setState(prev => {
          const newLog = {
            id: Date.now() + Math.random(),
            timestamp: message.timestamp,
            level: 'output',
            message: message.data?.content?.substring(0, 500) || '',
            full: message.data?.content,
            iteration: message.data?.iteration,
          };
          return {
            ...prev,
            logs: [...prev.logs.slice(-999), newLog],
          };
        });
        break;

      case 'error':
        setState(prev => ({
          ...prev,
          errors: [...prev.errors, {
            error: message.data?.error,
            retry: message.data?.retry,
            timestamp: message.timestamp,
          }],
        }));
        break;

      case 'supervision':
        setState(prev => ({
          ...prev,
          supervision: message.data,
          metrics: {
            ...prev.metrics,
            supervisionChecks: prev.metrics.supervisionChecks + 1,
            interventions: message.data?.needsIntervention
              ? prev.metrics.interventions + 1
              : prev.metrics.interventions,
          },
        }));
        break;

      case 'escalation':
        setState(prev => {
          const newLog = {
            id: Date.now() + Math.random(),
            timestamp: message.timestamp,
            level: 'error',
            message: `Escalation (${message.data?.type}): ${message.data?.message || ''}`,
          };
          return {
            ...prev,
            logs: [...prev.logs.slice(-999), newLog],
          };
        });
        break;

      case 'verification':
        setState(prev => ({
          ...prev,
          verification: message.data,
        }));
        break;

      case 'complete':
        setState(prev => ({
          ...prev,
          status: message.data?.status === 'completed' ? 'completed' : 'failed',
          finalReport: message.data,
        }));
        break;

      case 'reset':
        setState(message.data || initialState);
        break;

      case 'pong':
        // Heartbeat response
        break;

      case 'metrics':
        setState(prev => ({
          ...prev,
          serverMetrics: message.data,
        }));
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Initial connection
  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Heartbeat
  useEffect(() => {
    const interval = setInterval(() => {
      sendMessage({ type: 'ping' });
    }, 30000);

    return () => clearInterval(interval);
  }, [sendMessage]);

  return {
    state,
    connected,
    reconnecting,
    error,
    reconnect,
    sendMessage,
  };
}
