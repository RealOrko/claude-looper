/**
 * Report Display - Console output for final execution report
 */

/**
 * Display the final execution report to console
 * @param {object} report - Execution report object
 */
export function displayReport(report) {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log(`  Status: ${report?.status?.toUpperCase() || 'UNKNOWN'}`);
  console.log(`  Progress: ${report?.goal?.progress || 0}%`);
  console.log(`  Iterations: ${report?.session?.iterations || 0}`);
  console.log(`  Time: ${report?.time?.elapsed || 'N/A'}`);

  if (report?.plan) {
    displayPlanSummary(report.plan);
  }

  if (report?.finalVerification) {
    displayFinalVerification(report.finalVerification);
  }

  if (report?.abortReason) {
    console.log('─'.repeat(60));
    console.log(`  Abort Reason: ${report.abortReason}`);
  }
  console.log('═'.repeat(60));
  console.log('\n');
}

/**
 * Display plan summary
 * @param {object} plan - Plan object
 */
function displayPlanSummary(plan) {
  console.log('─'.repeat(60));
  console.log(`  Plan: ${plan.completed}/${plan.totalSteps} steps completed`);
  if (plan.failed > 0) {
    console.log(`  Failed Steps: ${plan.failed}`);
  }
  console.log('  Steps:');
  for (const step of plan.steps || []) {
    const icon = step.status === 'completed' ? '✓' :
                 step.status === 'failed' ? '✗' : ' ';
    const color = step.status === 'completed' ? '\x1b[32m' :
                  step.status === 'failed' ? '\x1b[31m' : '\x1b[90m';
    console.log(`    ${color}${icon} ${step.number}. ${step.description}\x1b[0m`);
    if (step.status === 'failed' && step.failReason) {
      console.log(`       \x1b[31m└─ ${step.failReason}\x1b[0m`);
    }
  }
}

/**
 * Display final verification results
 * @param {object} fv - Final verification object
 */
function displayFinalVerification(fv) {
  console.log('─'.repeat(60));
  console.log('  \x1b[1mFinal Verification:\x1b[0m');

  const goalIcon = fv.goalAchieved ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`    ${goalIcon} Goal Achieved: ${fv.goalAchieved ? 'Yes' : 'No'}`);
  console.log(`      Confidence: ${fv.confidence || 'Unknown'}`);
  console.log(`      Functional: ${fv.functional || 'Unknown'}`);
  console.log(`      Recommendation: ${fv.recommendation || 'Unknown'}`);

  if (fv.gaps) {
    console.log(`    \x1b[33m⚠\x1b[0m Gaps: ${fv.gaps}`);
  }

  const overallIcon = fv.overallPassed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const overallColor = fv.overallPassed ? '\x1b[32m' : '\x1b[31m';
  console.log(`    ${overallIcon} ${overallColor}Overall: ${fv.overallPassed ? 'PASSED' : 'FAILED'}\x1b[0m`);
}

export default { displayReport };
