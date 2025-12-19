/**
 * Plan Components - Plan step and plan display components
 */

import React from 'react';
import { Box, Text } from 'ink';

const e = React.createElement;

/**
 * Single plan step component
 * @param {object} props - Component props
 * @param {object} props.step - Step object with number, description, status, complexity
 * @param {boolean} props.isCurrent - Whether this is the current step
 */
export const PlanStep = ({ step, isCurrent }) => {
  const statusIcon = step.status === 'completed' ? '✓' :
                     step.status === 'failed' ? '✗' :
                     isCurrent ? '→' : ' ';
  const statusColor = step.status === 'completed' ? 'green' :
                      step.status === 'failed' ? 'red' :
                      isCurrent ? 'cyan' : 'gray';

  return e(Box, { flexDirection: 'column' },
    e(Text, null,
      e(Text, { color: statusColor }, `${statusIcon} ${step.number}. `),
      e(Text, { color: isCurrent ? 'white' : 'gray' }, step.description),
      e(Text, { color: 'gray', dimColor: true }, ` [${step.complexity}]`)
    ),
    step.status === 'failed' && step.failReason && e(Text, null,
      e(Text, { color: 'gray' }, '   └─ '),
      e(Text, { color: 'red' }, step.failReason)
    )
  );
};

/**
 * Plan display component showing all steps
 * @param {object} props - Component props
 * @param {object} props.plan - Plan object with steps array
 * @param {number} props.currentStep - Current step number
 * @param {number} props.maxVisible - Maximum steps to show (default 6)
 */
export const PlanDisplay = ({ plan, currentStep, maxVisible = 6 }) => {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return null;
  }

  const progress = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;

  return e(Box, { flexDirection: 'column', marginTop: 0 },
    e(Box, { marginBottom: 0 },
      e(Text, { color: 'cyan', bold: true }, `Plan: `),
      e(Text, { color: 'white' }, `${progress}/${total} steps`)
    ),
    e(Box, { borderStyle: 'single', borderColor: 'gray', paddingX: 1, paddingY: 0, flexDirection: 'column' },
      ...plan.steps.slice(0, maxVisible).map((step, index) =>
        e(PlanStep, { key: index, step, isCurrent: step.number === currentStep })
      ),
      plan.steps.length > maxVisible && e(Text, { color: 'gray' }, `  ... and ${plan.steps.length - maxVisible} more`)
    )
  );
};

export default { PlanStep, PlanDisplay };
