/**
 * Time Section Component
 * Shows time progress bar and labels
 */
import React from 'react';
import { Clock } from 'lucide-react';
import { formatDuration } from './utils.js';

export default function TimeSection({ elapsedMs, remainingMs, timePercent, timeLimit }) {
  return (
    <section className="time-section">
      <h3><Clock size={18} /> Time Progress</h3>
      <div className="time-bar">
        <div
          className="time-fill"
          style={{ width: `${Math.min(timePercent, 100)}%` }}
        />
        <div className="time-marker" style={{ left: `${Math.min(timePercent, 100)}%` }} />
      </div>
      <div className="time-labels">
        <span>{formatDuration(elapsedMs)} elapsed</span>
        <span>{timeLimit || 'No limit'}</span>
        {remainingMs > 0 && <span>{formatDuration(remainingMs)} remaining</span>}
      </div>
    </section>
  );
}
