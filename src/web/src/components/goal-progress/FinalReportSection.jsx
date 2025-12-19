/**
 * Final Report Section Component
 * Shows the final report summary when goal is completed
 */
import React from 'react';
import { Award, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export default function FinalReportSection({ finalReport }) {
  if (!finalReport) return null;

  return (
    <section className="final-report-section">
      <h3><Award size={18} /> Final Report</h3>
      <div className={`final-status ${finalReport.status}`}>
        {finalReport.status === 'completed' ? (
          <CheckCircle2 className="final-icon" />
        ) : (
          <XCircle className="final-icon" />
        )}
        <span className="final-label">
          {finalReport.status === 'completed' ? 'Goal Completed' : 'Goal Incomplete'}
        </span>
      </div>

      {finalReport.finalVerification && (
        <div className="final-details">
          <div className="detail-row">
            <span>Goal Achieved:</span>
            <strong>{finalReport.finalVerification.goalAchieved ? 'Yes' : 'No'}</strong>
          </div>
          <div className="detail-row">
            <span>Confidence:</span>
            <strong>{finalReport.finalVerification.confidence || 'Unknown'}</strong>
          </div>
        </div>
      )}

      {finalReport.abortReason && (
        <div className="abort-reason">
          <AlertTriangle size={14} />
          <span>{finalReport.abortReason}</span>
        </div>
      )}
    </section>
  );
}
