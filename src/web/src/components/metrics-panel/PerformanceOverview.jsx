/**
 * PerformanceOverview Component
 * Shows key performance metrics
 */
import React from 'react';
import { BarChart3, Clock, Activity, CheckCircle2, Target } from 'lucide-react';
import MetricCard from './MetricCard.jsx';
import { formatDuration } from './utils.js';

export default function PerformanceOverview({ metrics, derivedMetrics, timeElapsed, iteration }) {
  return (
    <section className="metrics-section">
      <h2><BarChart3 size={20} /> Performance Overview</h2>
      <div className="metrics-grid">
        <MetricCard
          icon={<Clock />}
          label="Total Time"
          value={formatDuration(metrics?.elapsedTime || timeElapsed || 0)}
          subtext={derivedMetrics.timeUsedPercent > 0 ? `${derivedMetrics.timeUsedPercent}% of limit` : 'Elapsed'}
          color="blue"
        />
        <MetricCard
          icon={<Activity />}
          label="Iterations"
          value={metrics?.iterations || iteration || 0}
          subtext={`${derivedMetrics.iterationsPerMinute}/min`}
          color="purple"
        />
        <MetricCard
          icon={<CheckCircle2 />}
          label="Completion"
          value={`${derivedMetrics.completionRate}%`}
          subtext={`${derivedMetrics.completed}/${derivedMetrics.totalSteps} steps`}
          color="green"
        />
        <MetricCard
          icon={<Target />}
          label="Success Rate"
          value={`${derivedMetrics.successRate}%`}
          subtext={`${derivedMetrics.failed} failed`}
          color={parseFloat(derivedMetrics.successRate) >= 80 ? 'green' : 'orange'}
        />
      </div>
    </section>
  );
}
