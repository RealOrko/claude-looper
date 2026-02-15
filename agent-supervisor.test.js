/**
 * Supervisor Agent Tests
 *
 * Comprehensive test suite for the SupervisorAgent class covering:
 * - Constructor and initialization
 * - Verification result parsing
 * - Progress assessment parsing
 * - Text fallback parsing
 * - Escalation level determination
 * - Quality thresholds
 * - State management
 * - Statistics
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import agentCore from './agent-core.js';
import { SupervisorAgent, QUALITY_THRESHOLDS, ESCALATION_LEVELS, VERIFICATION_TYPES, DIAGNOSIS_DECISIONS } from './agent-supervisor.js';

describe('SupervisorAgent - Constants', () => {
  it('should export QUALITY_THRESHOLDS constants', () => {
    assert.strictEqual(QUALITY_THRESHOLDS.APPROVE, 70);
    assert.strictEqual(QUALITY_THRESHOLDS.REVISE, 50);
    assert.strictEqual(QUALITY_THRESHOLDS.REJECT, 30);
  });

  it('should export ESCALATION_LEVELS constants', () => {
    assert.strictEqual(ESCALATION_LEVELS.NONE, 'none');
    assert.strictEqual(ESCALATION_LEVELS.REMIND, 'remind');
    assert.strictEqual(ESCALATION_LEVELS.CORRECT, 'correct');
    assert.strictEqual(ESCALATION_LEVELS.REFOCUS, 'refocus');
    assert.strictEqual(ESCALATION_LEVELS.CRITICAL, 'critical');
    assert.strictEqual(ESCALATION_LEVELS.ABORT, 'abort');
  });

  it('should export VERIFICATION_TYPES constants', () => {
    assert.strictEqual(VERIFICATION_TYPES.PLAN, 'plan');
    assert.strictEqual(VERIFICATION_TYPES.CODE, 'code');
    assert.strictEqual(VERIFICATION_TYPES.TEST, 'test');
    assert.strictEqual(VERIFICATION_TYPES.STEP, 'step');
    assert.strictEqual(VERIFICATION_TYPES.GOAL, 'goal');
    assert.strictEqual(VERIFICATION_TYPES.PROGRESS, 'progress');
  });
});

describe('SupervisorAgent - Constructor and Initialization', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should create instance with default options', () => {
    const supervisor = new SupervisorAgent();

    assert.strictEqual(supervisor.name, 'supervisor');
    assert.strictEqual(supervisor.model, 'opus');
    assert.strictEqual(supervisor.fallbackModel, 'sonnet');
  });

  it('should create instance with custom options', () => {
    const supervisor = new SupervisorAgent({
      model: 'sonnet',
      fallbackModel: 'haiku',
      allowExisting: true
    });

    assert.strictEqual(supervisor.model, 'sonnet');
    assert.strictEqual(supervisor.fallbackModel, 'haiku');
  });

  it('should register agent with agent core', () => {
    const supervisor = new SupervisorAgent();

    const agent = agentCore.getAgent('supervisor');
    assert.ok(agent);
    assert.strictEqual(agent.name, 'supervisor');
    assert.strictEqual(agent.model, 'opus');
  });

  it('should initialize agent state correctly', () => {
    const supervisor = new SupervisorAgent();

    assert.strictEqual(supervisor.agent.state.verificationsPerformed, 0);
    assert.strictEqual(supervisor.agent.state.approvalsGiven, 0);
    assert.strictEqual(supervisor.agent.state.rejectionsGiven, 0);
    assert.strictEqual(supervisor.agent.state.escalationCount, 0);
  });

  it('should set up subscriptions to other agents', () => {
    const supervisor = new SupervisorAgent({
      subscribesTo: ['planner', 'coder', 'tester']
    });

    assert.deepStrictEqual(supervisor.agent.subscribesTo, ['planner', 'coder', 'tester']);
  });

  it('should register supervisor tools', () => {
    const supervisor = new SupervisorAgent();

    assert.ok(supervisor.agent.tools.some(t => t.name === 'verificationComplete'));
    assert.ok(supervisor.agent.tools.some(t => t.name === 'progressAssessment'));
  });
});

describe('SupervisorAgent - Verification Result Parsing', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should parse verification from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'verificationComplete',
          arguments: {
            score: 85,
            approved: true,
            completeness: 'complete',
            issues: [],
            missingElements: [],
            risks: [],
            recommendation: 'approve',
            feedback: 'Good work',
            escalationLevel: 'none'
          }
        }
      }
    };

    const parsed = supervisor._parseVerificationResult(result);

    assert.strictEqual(parsed.score, 85);
    assert.strictEqual(parsed.approved, true);
    assert.strictEqual(parsed.completeness, 'complete');
    assert.strictEqual(parsed.recommendation, 'approve');
    assert.strictEqual(parsed.escalationLevel, 'none');
  });

  it('should parse verification from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'verificationComplete',
          arguments: {
            score: 60,
            approved: false,
            recommendation: 'revise',
            feedback: 'Needs improvement'
          }
        }
      ]
    };

    const parsed = supervisor._parseVerificationResult(result);

    assert.strictEqual(parsed.score, 60);
    assert.strictEqual(parsed.approved, false);
    assert.strictEqual(parsed.recommendation, 'revise');
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: 'Score: 75. Approved: yes. The implementation looks good.'
    };

    const parsed = supervisor._parseVerificationResult(result);

    assert.ok(parsed.score !== undefined);
    assert.ok(parsed.approved !== undefined);
  });
});

describe('SupervisorAgent - Progress Result Parsing', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should parse progress from structuredOutput.toolCall.arguments', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'progressAssessment',
          arguments: {
            onTrack: true,
            percentComplete: 60,
            healthScore: 75,
            concerns: ['Minor delay'],
            recommendations: ['Speed up'],
            continueExecution: true
          }
        }
      }
    };

    const parsed = supervisor._parseProgressResult(result);

    assert.strictEqual(parsed.onTrack, true);
    assert.strictEqual(parsed.percentComplete, 60);
    assert.strictEqual(parsed.healthScore, 75);
    assert.strictEqual(parsed.continueExecution, true);
  });

  it('should parse progress from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'progressAssessment',
          arguments: {
            onTrack: false,
            percentComplete: 30,
            healthScore: 40,
            continueExecution: true,
            concerns: ['Behind schedule']
          }
        }
      ]
    };

    const parsed = supervisor._parseProgressResult(result);

    assert.strictEqual(parsed.onTrack, false);
    assert.strictEqual(parsed.percentComplete, 30);
    assert.strictEqual(parsed.healthScore, 40);
  });

  it('should fallback to text parsing when structured output unavailable', () => {
    const result = {
      response: 'Progress is good. Score: 80.'
    };

    const parsed = supervisor._parseProgressResult(result);

    assert.ok(parsed.healthScore !== undefined);
    assert.ok(parsed.continueExecution !== undefined);
  });
});

describe('SupervisorAgent - Text Response Parsing', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should extract score from text', () => {
    const response = 'The score: 85 for this work';

    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.score, 85);
  });

  it('should detect approved status from text', () => {
    const response = 'Approved: yes';

    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, true);
  });

  it('should detect not approved status from text', () => {
    const response = 'Approved: no';

    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, false);
  });

  it('should detect passed status from text', () => {
    const response = 'Passed: true';

    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, true);
  });

  it('should never auto-approve on fallback when approval not explicit', () => {
    const response = 'Score: 75';

    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, false); // Fallback never auto-approves
  });

  it('should determine completeness based on score', () => {
    const highScore = supervisor._parseTextResponse('Score: 80', 'verification');
    assert.strictEqual(highScore.completeness, 'complete');

    const mediumScore = supervisor._parseTextResponse('Score: 60', 'verification');
    assert.strictEqual(mediumScore.completeness, 'partial');

    const lowScore = supervisor._parseTextResponse('Score: 40', 'verification');
    assert.strictEqual(lowScore.completeness, 'insufficient');
  });

  it('should determine recommendation based on score', () => {
    const approved = supervisor._parseTextResponse('Score: 75', 'verification');
    assert.strictEqual(approved.recommendation, 'approve');

    const revise = supervisor._parseTextResponse('Score: 55', 'verification');
    assert.strictEqual(revise.recommendation, 'revise');

    const reject = supervisor._parseTextResponse('Score: 25', 'verification');
    assert.strictEqual(reject.recommendation, 'reject');
  });

  it('should truncate feedback with fallback warning prefix', () => {
    const longResponse = 'A'.repeat(1000);

    const parsed = supervisor._parseTextResponse(longResponse, 'verification');

    assert.ok(parsed.feedback.startsWith('FALLBACK PARSING:'));
    assert.ok(parsed.feedback.length < 600, 'Feedback should be truncated well below original length');
    assert.ok(parsed.feedback.length < longResponse.length, 'Feedback should be shorter than input');
  });

  it('should handle progress type parsing', () => {
    const response = 'Score: 60';

    const parsed = supervisor._parseTextResponse(response, 'progress');

    assert.ok(parsed.onTrack !== undefined);
    assert.ok(parsed.percentComplete !== undefined);
    assert.ok(parsed.healthScore !== undefined);
    assert.ok(parsed.continueExecution !== undefined);
  });

  it('should set onTrack based on score for progress', () => {
    const goodProgress = supervisor._parseTextResponse('Score: 60', 'progress');
    assert.strictEqual(goodProgress.onTrack, true);

    const badProgress = supervisor._parseTextResponse('Score: 40', 'progress');
    assert.strictEqual(badProgress.onTrack, false);
  });

  it('should set continueExecution based on threshold', () => {
    const continueExec = supervisor._parseTextResponse('Score: 40', 'progress');
    assert.strictEqual(continueExec.continueExecution, true);

    const abortExec = supervisor._parseTextResponse('Score: 25', 'progress');
    assert.strictEqual(abortExec.continueExecution, false);
    assert.ok(abortExec.abortReason);
  });
});

describe('SupervisorAgent - Escalation Level Determination', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should return NONE for score >= 70 with no issues', () => {
    const level = supervisor._determineEscalation(75, []);
    assert.strictEqual(level, ESCALATION_LEVELS.NONE);
  });

  it('should return REMIND for score 50-69', () => {
    const level = supervisor._determineEscalation(60, []);
    assert.strictEqual(level, ESCALATION_LEVELS.REMIND);
  });

  it('should return CORRECT for score 30-49', () => {
    const level = supervisor._determineEscalation(40, []);
    assert.strictEqual(level, ESCALATION_LEVELS.CORRECT);
  });

  it('should return REFOCUS for score < 30', () => {
    const level = supervisor._determineEscalation(20, []);
    assert.strictEqual(level, ESCALATION_LEVELS.REFOCUS);
  });

  it('should return ABORT for 5+ issues', () => {
    const issues = ['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4', 'Issue 5'];
    const level = supervisor._determineEscalation(80, issues);
    assert.strictEqual(level, ESCALATION_LEVELS.ABORT);
  });

  it('should return CRITICAL for 4 issues', () => {
    const issues = ['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4'];
    const level = supervisor._determineEscalation(80, issues);
    assert.strictEqual(level, ESCALATION_LEVELS.CRITICAL);
  });

  it('should return REFOCUS for 3 issues even with high score', () => {
    const issues = ['Issue 1', 'Issue 2', 'Issue 3'];
    const level = supervisor._determineEscalation(80, issues);
    assert.strictEqual(level, ESCALATION_LEVELS.REFOCUS);
  });

  it('should return CORRECT for 2 issues even with high score', () => {
    const issues = ['Issue 1', 'Issue 2'];
    const level = supervisor._determineEscalation(80, issues);
    assert.strictEqual(level, ESCALATION_LEVELS.CORRECT);
  });

  it('should handle null/undefined issues', () => {
    const nullLevel = supervisor._determineEscalation(75, null);
    assert.strictEqual(nullLevel, ESCALATION_LEVELS.NONE);

    const undefinedLevel = supervisor._determineEscalation(75, undefined);
    assert.strictEqual(undefinedLevel, ESCALATION_LEVELS.NONE);
  });
});

describe('SupervisorAgent - Statistics', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should return agent statistics', () => {
    const stats = supervisor.getStats();

    assert.strictEqual(stats.name, 'supervisor');
    assert.strictEqual(stats.verificationsPerformed, 0);
    assert.strictEqual(stats.approvalsGiven, 0);
    assert.strictEqual(stats.rejectionsGiven, 0);
    assert.strictEqual(stats.escalationCount, 0);
    assert.strictEqual(stats.approvalRate, 'N/A');
  });

  it('should calculate approval rate when verifications performed', () => {
    agentCore.updateAgentState('supervisor', {
      verificationsPerformed: 10,
      approvalsGiven: 8
    });

    const stats = supervisor.getStats();

    assert.strictEqual(stats.approvalRate, '80.0%');
  });

  it('should reflect updated state in statistics', () => {
    agentCore.updateAgentState('supervisor', {
      verificationsPerformed: 20,
      approvalsGiven: 15,
      rejectionsGiven: 5,
      escalationCount: 3
    });

    const stats = supervisor.getStats();

    assert.strictEqual(stats.verificationsPerformed, 20);
    assert.strictEqual(stats.approvalsGiven, 15);
    assert.strictEqual(stats.rejectionsGiven, 5);
    assert.strictEqual(stats.escalationCount, 3);
  });
});

describe('SupervisorAgent - Tool Definitions', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should have verificationComplete tool with correct params', () => {
    const verifyTool = supervisor.agent.tools.find(t => t.name === 'verificationComplete');

    assert.ok(verifyTool);
    assert.ok(verifyTool.params.some(p => p.name === 'score'));
    assert.ok(verifyTool.params.some(p => p.name === 'approved'));
    assert.ok(verifyTool.params.some(p => p.name === 'completeness'));
    assert.ok(verifyTool.params.some(p => p.name === 'issues'));
    assert.ok(verifyTool.params.some(p => p.name === 'missingElements'));
    assert.ok(verifyTool.params.some(p => p.name === 'risks'));
    assert.ok(verifyTool.params.some(p => p.name === 'recommendation'));
    assert.ok(verifyTool.params.some(p => p.name === 'feedback'));
    assert.ok(verifyTool.params.some(p => p.name === 'escalationLevel'));
  });

  it('should have progressAssessment tool with correct params', () => {
    const progressTool = supervisor.agent.tools.find(t => t.name === 'progressAssessment');

    assert.ok(progressTool);
    assert.ok(progressTool.params.some(p => p.name === 'onTrack'));
    assert.ok(progressTool.params.some(p => p.name === 'percentComplete'));
    assert.ok(progressTool.params.some(p => p.name === 'healthScore'));
    assert.ok(progressTool.params.some(p => p.name === 'concerns'));
    assert.ok(progressTool.params.some(p => p.name === 'recommendations'));
    assert.ok(progressTool.params.some(p => p.name === 'continueExecution'));
    assert.ok(progressTool.params.some(p => p.name === 'abortReason'));
  });
});

describe('SupervisorAgent - Allow Existing Registration', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should allow re-registration with allowExisting option', () => {
    new SupervisorAgent();

    // Should not throw
    assert.doesNotThrow(() => {
      new SupervisorAgent({ allowExisting: true });
    });
  });

  it('should throw when re-registering without allowExisting', () => {
    new SupervisorAgent();

    assert.throws(() => {
      new SupervisorAgent();
    }, /already registered/);
  });
});

describe('SupervisorAgent - Subscription Setup', () => {
  beforeEach(() => {
    agentCore.reset();
  });

  it('should set up subscriptions on construction', () => {
    const supervisor = new SupervisorAgent();

    assert.ok(supervisor.agent.subscribesTo);
    assert.ok(supervisor.agent.subscribesTo.length > 0);
  });

  it('should use custom subscribesTo when provided', () => {
    const supervisor = new SupervisorAgent({
      subscribesTo: ['planner']
    });

    assert.deepStrictEqual(supervisor.agent.subscribesTo, ['planner']);
  });

  it('should default to subscribing to planner, coder, and tester', () => {
    const supervisor = new SupervisorAgent();

    assert.ok(supervisor.agent.subscribesTo.includes('planner'));
    assert.ok(supervisor.agent.subscribesTo.includes('coder'));
    assert.ok(supervisor.agent.subscribesTo.includes('tester'));
  });
});

describe('SupervisorAgent - Quality Threshold Boundaries', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should handle score at APPROVE boundary (70) but not auto-approve on fallback', () => {
    const response = 'Score: 70';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, false); // Fallback never auto-approves
    assert.strictEqual(parsed.recommendation, 'approve');
    assert.strictEqual(parsed.completeness, 'complete');
  });

  it('should handle score just below APPROVE (69)', () => {
    const response = 'Score: 69';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.approved, false);
    assert.strictEqual(parsed.recommendation, 'revise');
    assert.strictEqual(parsed.completeness, 'partial');
  });

  it('should handle score at REVISE boundary (50)', () => {
    const response = 'Score: 50';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.recommendation, 'revise');
  });

  it('should handle score just below REVISE (49)', () => {
    const response = 'Score: 49';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.recommendation, 'reject');
  });

  it('should handle score at REJECT boundary (30)', () => {
    const response = 'Score: 30';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.recommendation, 'reject');
  });

  it('should handle zero score', () => {
    const response = 'Score: 0';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.score, 0);
    assert.strictEqual(parsed.approved, false);
    assert.strictEqual(parsed.recommendation, 'reject');
    assert.strictEqual(parsed.completeness, 'insufficient');
    assert.ok(parsed.issues.length > 0, 'Fallback should inject warning into issues');
  });

  it('should default to 35 when no score found (conservative fallback)', () => {
    const response = 'No score mentioned';
    const parsed = supervisor._parseTextResponse(response, 'verification');

    assert.strictEqual(parsed.score, 35);
  });
});

describe('SupervisorAgent - Edge Cases', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should handle empty response gracefully', () => {
    const result = { response: '' };

    const parsed = supervisor._parseVerificationResult(result);

    assert.ok(parsed);
    assert.strictEqual(typeof parsed.score, 'number');
  });

  it('should handle missing toolCalls gracefully', () => {
    const result = {
      toolCalls: [],
      response: 'Score: 60'
    };

    const parsed = supervisor._parseVerificationResult(result);

    // Should fall back to text parsing
    assert.ok(parsed);
    assert.strictEqual(parsed.score, 60);
  });

  it('should handle wrong tool name in toolCalls', () => {
    const result = {
      toolCalls: [
        {
          name: 'wrongTool',
          arguments: { score: 100 }
        }
      ],
      response: 'Score: 55'
    };

    const parsed = supervisor._parseVerificationResult(result);

    // Should fall back to text parsing
    assert.ok(parsed);
    assert.strictEqual(parsed.score, 55);
  });
});

// =============================================================================
// Diagnosis Tests
// =============================================================================

describe('SupervisorAgent - Diagnosis Constants', () => {
  it('should export DIAGNOSIS_DECISIONS constants', () => {
    assert.strictEqual(DIAGNOSIS_DECISIONS.RETRY, 'retry');
    assert.strictEqual(DIAGNOSIS_DECISIONS.REPLAN, 'replan');
    assert.strictEqual(DIAGNOSIS_DECISIONS.IMPOSSIBLE, 'impossible');
    // PIVOT and CLARIFY removed - simplified to retry/replan/impossible only
    assert.strictEqual(DIAGNOSIS_DECISIONS.PIVOT, undefined);
    assert.strictEqual(DIAGNOSIS_DECISIONS.CLARIFY, undefined);
  });
});

describe('SupervisorAgent - Diagnosis Result Parsing', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should parse structured diagnosis result', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'diagnosisComplete',
          arguments: {
            decision: 'replan',
            reasoning: 'Task is too complex',
            blockers: null
          }
        }
      }
    };

    const parsed = supervisor._parseDiagnosisResult(result);

    assert.strictEqual(parsed.decision, 'replan');
    assert.strictEqual(parsed.reasoning, 'Task is too complex');
  });

  it('should parse diagnosis from toolCalls array', () => {
    const result = {
      toolCalls: [
        {
          name: 'diagnosisComplete',
          arguments: {
            decision: 'replan',
            reasoning: 'Task needs to be broken down'
          }
        }
      ]
    };

    const parsed = supervisor._parseDiagnosisResult(result);

    assert.strictEqual(parsed.decision, 'replan');
    assert.strictEqual(parsed.reasoning, 'Task needs to be broken down');
  });

  it('should parse impossible diagnosis with blockers', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'diagnosisComplete',
          arguments: {
            decision: 'impossible',
            reasoning: 'Cannot be done',
            blockers: ['Missing API', 'No permissions']
          }
        }
      }
    };

    const parsed = supervisor._parseDiagnosisResult(result);

    assert.strictEqual(parsed.decision, 'impossible');
    assert.deepStrictEqual(parsed.blockers, ['Missing API', 'No permissions']);
  });

  it('should parse retry diagnosis', () => {
    const result = {
      structuredOutput: {
        toolCall: {
          name: 'diagnosisComplete',
          arguments: {
            decision: 'retry',
            reasoning: 'Transient network error'
          }
        }
      }
    };

    const parsed = supervisor._parseDiagnosisResult(result);

    assert.strictEqual(parsed.decision, 'retry');
    assert.strictEqual(parsed.reasoning, 'Transient network error');
  });
});

describe('SupervisorAgent - Text Diagnosis Parsing', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should detect retry from text', () => {
    const response = 'We should try again as this appears to be a transient error';
    const parsed = supervisor._parseTextDiagnosis(response);

    assert.strictEqual(parsed.decision, 'retry');
  });

  it('should default to replan for different approach text (pivot removed)', () => {
    // Previously this would return 'pivot', now defaults to 'replan'
    const response = 'We need a different approach to solve this problem';
    const parsed = supervisor._parseTextDiagnosis(response);

    assert.strictEqual(parsed.decision, 'replan');
  });

  it('should detect impossible from text', () => {
    const response = 'This goal cannot be achieved with current constraints';
    const parsed = supervisor._parseTextDiagnosis(response);

    assert.strictEqual(parsed.decision, 'impossible');
  });

  it('should default to replan for clarification text (clarify removed)', () => {
    // Previously this would return 'clarify', now defaults to 'replan'
    const response = 'We need more information and clarification on requirements';
    const parsed = supervisor._parseTextDiagnosis(response);

    assert.strictEqual(parsed.decision, 'replan');
  });

  it('should default to replan when no clear decision', () => {
    const response = 'The task has some issues that need addressing';
    const parsed = supervisor._parseTextDiagnosis(response);

    assert.strictEqual(parsed.decision, 'replan');
  });
});

describe('SupervisorAgent - Diagnosis State', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should initialize diagnosesPerformed to 0', () => {
    assert.strictEqual(supervisor.agent.state.diagnosesPerformed, 0);
  });

  it('should include diagnosesPerformed in stats', () => {
    const stats = supervisor.getStats();
    assert.ok('diagnosesPerformed' in stats);
  });
});

// =============================================================================
// Pre-Check Tests
// =============================================================================

describe('SupervisorAgent - Pre-Checks (CODE/STEP)', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should flag complete status with empty filesModified', () => {
    const issues = supervisor._runPreChecks('code', {
      agentOutput: JSON.stringify({ status: 'complete', filesModified: [] })
    });

    assert.ok(issues.some(i => i.severity === 'VIOLATION' && i.message.includes('filesModified is empty')));
  });

  it('should flag test count mismatch', () => {
    const issues = supervisor._runPreChecks('step', {
      agentOutput: JSON.stringify({ testsRun: 10, testsPassed: 7, testsFailed: 2 })
    });

    assert.ok(issues.some(i => i.severity === 'VIOLATION' && i.message.includes('Test count mismatch')));
  });

  it('should flag passed status with zero tests', () => {
    const issues = supervisor._runPreChecks('code', {
      agentOutput: JSON.stringify({ status: 'passed', testsRun: 0 })
    });

    assert.ok(issues.some(i => i.severity === 'VIOLATION' && i.message.includes('zero tests')));
  });

  it('should return no issues for valid code output', () => {
    const issues = supervisor._runPreChecks('code', {
      agentOutput: JSON.stringify({
        status: 'complete',
        filesModified: ['src/index.js'],
        testsRun: 5,
        testsPassed: 5,
        testsFailed: 0
      })
    });

    assert.strictEqual(issues.length, 0);
  });

  it('should handle non-JSON agentOutput gracefully', () => {
    const issues = supervisor._runPreChecks('code', {
      agentOutput: 'just some plain text output'
    });

    assert.strictEqual(issues.length, 0);
  });
});

describe('SupervisorAgent - Pre-Checks (PLAN)', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should flag tasks without verification criteria', () => {
    const issues = supervisor._runPreChecks('plan', {
      agentOutput: JSON.stringify({
        tasks: [{ title: 'Do stuff' }]
      })
    });

    assert.ok(issues.some(i => i.severity === 'WARNING' && i.message.includes('no verification criteria')));
  });

  it('should flag vague verification criteria', () => {
    const issues = supervisor._runPreChecks('plan', {
      agentOutput: JSON.stringify({
        tasks: [{ title: 'Build feature', verificationCriteria: ['works correctly'] }]
      })
    });

    assert.ok(issues.some(i => i.severity === 'WARNING' && i.message.includes('Vague criterion')));
  });

  it('should accept tasks with specific verification criteria', () => {
    const issues = supervisor._runPreChecks('plan', {
      agentOutput: JSON.stringify({
        tasks: [{ title: 'Add login', verificationCriteria: ['POST /login returns 200 with valid credentials'] }]
      })
    });

    assert.strictEqual(issues.length, 0);
  });
});

describe('SupervisorAgent - Pre-Checks (GOAL)', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should flag incomplete tasks at goal gate', () => {
    const issues = supervisor._runPreChecks('goal', {
      agentOutput: JSON.stringify({
        tasks: [
          { title: 'Task A', status: 'completed' },
          { title: 'Task B', status: 'in_progress' }
        ]
      })
    });

    assert.ok(issues.some(i => i.severity === 'VIOLATION' && i.message.includes('still incomplete')));
  });

  it('should pass when all tasks are complete', () => {
    const issues = supervisor._runPreChecks('goal', {
      agentOutput: JSON.stringify({
        tasks: [
          { title: 'Task A', status: 'completed' },
          { title: 'Task B', status: 'done' }
        ]
      })
    });

    assert.strictEqual(issues.length, 0);
  });
});

describe('SupervisorAgent - Fallback Warning Injection', () => {
  let supervisor;

  beforeEach(() => {
    agentCore.reset();
    supervisor = new SupervisorAgent();
  });

  it('should inject fallback warning into verification issues', () => {
    const parsed = supervisor._parseTextResponse('Some response', 'verification');

    assert.ok(parsed.issues.some(i => i.includes('FALLBACK PARSING')));
  });

  it('should inject fallback warning into verification feedback', () => {
    const parsed = supervisor._parseTextResponse('Some response', 'verification');

    assert.ok(parsed.feedback.includes('FALLBACK PARSING'));
  });

  it('should inject fallback warning into progress concerns', () => {
    const parsed = supervisor._parseTextResponse('Score: 60', 'progress');

    assert.ok(parsed.concerns.some(c => c.includes('FALLBACK PARSING')));
  });

  it('should never auto-approve on fallback even with high explicit score', () => {
    const parsed = supervisor._parseTextResponse('Score: 95', 'verification');

    assert.strictEqual(parsed.approved, false);
    assert.strictEqual(parsed.recommendation, 'approve'); // recommendation still reflects score
  });
});
