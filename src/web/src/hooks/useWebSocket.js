/**
 * WebSocket hook for real-time agent state updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { initialState } from './initialState.js';
import {
  handleStateMessage,
  handleHistoryMessage,
  handleProgressMessage,
  handleMessageMessage,
  handleErrorMessage,
  handleSupervisionMessage,
  handleEscalationMessage,
  handleVerificationMessage,
  handleCompleteMessage,
  handleMetricsMessage,
} from './messageHandlers.js';

/**
 * Custom hook for WebSocket connection with auto-reconnect
 * @returns {object} WebSocket state and controls
 */
export function useWebSocket() {
  const [state, setState] = useState(initialState);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const handleMessage = useCallback((message) => {
    switch (message.type) {
      case 'init':
      case 'state':
      case 'stateUpdate':
        setState(prev => handleStateMessage(prev, message.data));
        break;

      case 'history':
        setState(prev => handleHistoryMessage(prev, message.data));
        break;

      case 'progress':
        setState(prev => handleProgressMessage(prev, message.data, message.timestamp));
        break;

      case 'message':
        setState(prev => handleMessageMessage(prev, message.data, message.timestamp));
        break;

      case 'error':
        setState(prev => handleErrorMessage(prev, message.data, message.timestamp));
        break;

      case 'supervision':
        setState(prev => handleSupervisionMessage(prev, message.data));
        break;

      case 'escalation':
        setState(prev => handleEscalationMessage(prev, message.data, message.timestamp));
        break;

      case 'verification':
        setState(prev => handleVerificationMessage(prev, message.data));
        break;

      case 'complete':
        setState(prev => handleCompleteMessage(prev, message.data));
        break;

      case 'reset':
        setState(message.data || initialState);
        break;

      case 'pong':
        // Heartbeat response - no action needed
        break;

      case 'metrics':
        setState(prev => handleMetricsMessage(prev, message.data));
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, []);

  const connect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    setReconnecting(true);

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

      ws.onerror = () => {
        setError('Connection error');
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

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
  }, [handleMessage]);

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

export default useWebSocket;
