/**
 * ComplexityAnalysis Component
 * Shows complexity breakdown statistics
 */
import React from 'react';
import { Layers } from 'lucide-react';

export default function ComplexityAnalysis({ complexityStats }) {
  if (complexityStats.length === 0 || !complexityStats.some(s => s.count > 0)) {
    return null;
  }

  return (
    <section className="metrics-section">
      <h2><Layers size={20} /> Complexity Analysis</h2>
      <div className="complexity-grid">
        {complexityStats.map(stat => (
          <div key={stat.complexity} className={`complexity-card ${stat.complexity}`}>
            <div className="complexity-header">
              <span className="complexity-label">{stat.complexity}</span>
              <span className="complexity-count">{stat.count} steps</span>
            </div>
            {stat.count > 0 && (
              <div className="complexity-stats">
                <div className="complexity-stat">
                  <span className="stat-label">Avg</span>
                  <span className="stat-value">{stat.avgTime}s</span>
                </div>
                <div className="complexity-stat">
                  <span className="stat-label">Min</span>
                  <span className="stat-value">{stat.minTime}s</span>
                </div>
                <div className="complexity-stat">
                  <span className="stat-label">Max</span>
                  <span className="stat-value">{stat.maxTime}s</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
