/**
 * TimeAnalysis Component
 * Shows time-related metrics and step timing chart
 */
import React from 'react';
import { Timer, Zap, TrendingUp, Gauge, Clock } from 'lucide-react';
import MetricCard from './MetricCard.jsx';
import { formatDuration } from './utils.js';

export default function TimeAnalysis({
  derivedMetrics, timeRemaining, timeLimit, stepTimings
}) {
  return (
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
  );
}
