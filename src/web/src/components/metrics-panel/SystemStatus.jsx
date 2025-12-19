/**
 * SystemStatus Component
 * Shows system status indicator and stats
 */
import React from 'react';
import { Cpu, Database, MessageSquare, Activity } from 'lucide-react';
import { formatDuration } from './utils.js';

export default function SystemStatus({ status, state, metrics }) {
  return (
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
  );
}
