/**
 * Confidence Section Component
 * Shows confidence gauge and verification details
 */
import React from 'react';
import { Gauge, CheckCircle2, AlertTriangle, Zap, ArrowUp, ArrowDown, Minus } from 'lucide-react';

export default function ConfidenceSection({
  confidence, confidenceConfig, confidenceTrend, verification
}) {
  const ConfidenceIcon = confidenceConfig.icon;
  const TrendIcon = confidenceTrend === 'up' ? ArrowUp : confidenceTrend === 'down' ? ArrowDown : Minus;

  return (
    <section className="confidence-section">
      <h3><Gauge size={18} /> Confidence Level</h3>
      <div className="confidence-gauge">
        <div className="gauge-display">
          <ConfidenceIcon
            className="confidence-icon"
            style={{ color: confidenceConfig.color }}
          />
          <span
            className="confidence-label"
            style={{ color: confidenceConfig.color }}
          >
            {confidenceConfig.label}
          </span>
          {confidenceTrend !== 'stable' && (
            <TrendIcon
              size={16}
              className={`confidence-trend ${confidenceTrend}`}
            />
          )}
        </div>
        <div className="confidence-meter">
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{
                width: confidence === 'HIGH' ? '100%' :
                       confidence === 'MEDIUM' ? '60%' :
                       confidence === 'LOW' ? '30%' : '10%',
                backgroundColor: confidenceConfig.color,
              }}
            />
          </div>
          <div className="meter-labels">
            <span>Low</span>
            <span>Medium</span>
            <span>High</span>
          </div>
        </div>
      </div>

      {/* Verification details */}
      {(verification?.goal || verification?.gaps) && (
        <div className="verification-details">
          {verification.goal?.achieved !== undefined && (
            <div className={`verification-badge ${verification.goal.achieved ? 'achieved' : 'not-achieved'}`}>
              {verification.goal.achieved ? (
                <><CheckCircle2 size={16} /> Goal Achieved</>
              ) : (
                <><AlertTriangle size={16} /> Goal Not Yet Achieved</>
              )}
            </div>
          )}
          {verification.gaps && (
            <div className="gaps-info">
              <span className="gaps-label">Gaps:</span>
              <span className="gaps-text">{verification.gaps}</span>
            </div>
          )}
          {verification.goal?.recommendation && (
            <div className="recommendation">
              <Zap size={14} />
              <span>{verification.goal.recommendation}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
