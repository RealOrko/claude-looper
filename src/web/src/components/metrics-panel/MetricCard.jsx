/**
 * MetricCard Component
 * Displays a single metric with icon, value, and subtext
 */
import React from 'react';

export default function MetricCard({ icon, label, value, subtext, color }) {
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
