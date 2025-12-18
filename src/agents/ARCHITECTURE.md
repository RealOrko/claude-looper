# Multi-Agent Orchestration Architecture

## Overview

This document describes the comprehensive multi-agent orchestration system that mimics a real-world software development workflow. The system continuously loops through planning, implementation, testing, and verification phases until either the goal is achieved or time runs out.

## Core Design Principles

1. **Supervisor Oversight**: ALL outputs from ALL agents are verified by the Supervisor
2. **Recursive Planning**: Up to 3 levels of nested sub-plans when steps are blocked
3. **Test-Driven Development**: Every implementation must include working tests
4. **Continuous Feedback Loop**: Tester provides fix plans that loop back to Coder
5. **Time-Bounded Execution**: System terminates gracefully when time expires

## Agent Roles & Responsibilities

### 1. Supervisor Agent (Sonnet)
- **Pre-execution verification**: Reviews plans before execution begins
- **Post-execution verification**: Validates all outputs from Planner, Coder, Tester
- **Real-time monitoring**: Assesses progress and goal alignment
- **Escalation management**: Issues corrections at graduated severity levels
- **Quality gates**: Can reject work and request re-implementation

### 2. Planner Agent (Opus)
- **Goal decomposition**: Breaks goals into 2-15 actionable steps
- **Complexity estimation**: Rates each step (simple/medium/complex)
- **Dependency mapping**: Identifies step dependencies
- **Recursive re-planning**: Creates sub-plans for blocked steps (3 levels max)
- **Adaptive planning**: Adjusts plans based on execution feedback

### 3. Coder Agent (Opus)
- **Step implementation**: Implements one step at a time
- **Test writing**: Creates tests for every implementation
- **Fix application**: Applies fixes based on Tester feedback
- **Inline re-planning**: Can request sub-plan when encountering blockers
- **Code quality**: Follows project patterns and best practices

### 4. Tester Agent (Sonnet)
- **Automated testing**: Runs project test suites
- **Exploratory testing**: LLM-based code analysis for edge cases
- **Issue detection**: Identifies bugs, security issues, code smells
- **Fix plan generation**: Creates detailed fix plans for Coder
- **Coverage assessment**: Evaluates test coverage quality

## Message Protocol

### Message Types
```
PLAN_REQUEST      → Planner: Create initial plan
PLAN_RESPONSE     ← Planner: Returns ExecutionPlan
REPLAN_REQUEST    → Planner: Create sub-plan for blocked step
SUBPLAN_RESPONSE  ← Planner: Returns sub-plan

CODE_REQUEST      → Coder: Implement a step
CODE_RESPONSE     ← Coder: Returns CodeOutput
CODE_FIX_REQUEST  → Coder: Apply fixes from Tester

TEST_REQUEST      → Tester: Validate implementation
TEST_RESPONSE     ← Tester: Returns TestResult with fix plan
FIX_PLAN          ← Tester: Detailed fix instructions

VERIFY_REQUEST    → Supervisor: Verify any output
VERIFY_RESPONSE   ← Supervisor: Returns VerificationResult
CORRECTION        ← Supervisor: Course correction message
ESCALATION        ← Supervisor: Escalation notification

STEP_COMPLETE     → Orchestrator: Step finished
STEP_BLOCKED      → Orchestrator: Step cannot proceed
GOAL_COMPLETE     → Orchestrator: All steps done
ABORT             → All: Terminate execution
```

## Orchestration Loop

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MAIN ORCHESTRATION LOOP                          │
│                                                                         │
│  START ──► TIME CHECK ──► PLANNING ──► PLAN REVIEW ──► EXECUTION       │
│              │                              │              │            │
│              │                              ▼              │            │
│              │                        [Supervisor         │            │
│              │                         Approves?]         │            │
│              │                          │    │            │            │
│              │                         YES   NO──►REPLAN  │            │
│              │                          │                 │            │
│              │                          ▼                 │            │
│              │            ┌─────────────────────────────┐ │            │
│              │            │     STEP EXECUTION LOOP     │ │            │
│              │            │                             │ │            │
│              │            │  ┌──────┐   ┌──────┐       │ │            │
│              │            │  │CODER │──►│TESTER│       │ │            │
│              │            │  └──────┘   └──────┘       │ │            │
│              │            │      ▲          │          │ │            │
│              │            │      │    [Tests Pass?]    │ │            │
│              │            │      │      │      │       │ │            │
│              │            │   Fix Plan  YES    NO      │ │            │
│              │            │      │      │      │       │ │            │
│              │            │      └──────┼──────┘       │ │            │
│              │            │             │              │ │            │
│              │            │             ▼              │ │            │
│              │            │       [Supervisor          │ │            │
│              │            │        Verifies]           │ │            │
│              │            │             │              │ │            │
│              │            │        [Approved?]         │ │            │
│              │            │         │      │           │ │            │
│              │            │        YES    NO──►Retry   │ │            │
│              │            │         │                  │ │            │
│              │            │         ▼                  │ │            │
│              │            │    NEXT STEP / COMPLETE    │ │            │
│              │            └─────────────────────────────┘ │            │
│              │                          │                 │            │
│              │                          ▼                 │            │
│              │                   VERIFICATION             │            │
│              │                          │                 │            │
│              │                   [Goal Achieved?]         │            │
│              │                    │           │           │            │
│              │                   YES          NO          │            │
│              │                    │           │           │            │
│              │                    ▼           ▼           │            │
│              │                 SUCCESS    CONTINUE        │            │
│              │                              │             │            │
│              └──────────────────────────────┘             │            │
│                                                           │            │
│  TIME EXPIRED ──► GRACEFUL SHUTDOWN ──► REPORT           │            │
└─────────────────────────────────────────────────────────────────────────┘
```

## State Management

### OrchestrationState
```javascript
{
  id: string,
  primaryGoal: string,
  status: 'initializing' | 'planning' | 'executing' | 'testing' |
          'verifying' | 'completed' | 'failed' | 'aborted' | 'time_expired',
  currentPlan: ExecutionPlan,
  planStack: ExecutionPlan[],  // For recursive sub-plans
  currentAgent: AgentRole,
  iteration: number,
  startTime: number,
  endTime: number | null,
  timeLimit: number,

  agents: {
    planner: { status, lastOutput, metrics },
    coder: { status, lastOutput, metrics },
    tester: { status, lastOutput, metrics },
    supervisor: { status, lastOutput, metrics }
  },

  metrics: {
    totalSteps: number,
    completedSteps: number,
    failedSteps: number,
    replanCount: number,
    fixCycles: number,
    verificationsPassed: number,
    verificationsFailed: number
  },

  eventLog: Event[]
}
```

### ExecutionPlan
```javascript
{
  id: string,
  goal: string,
  analysis: string,
  steps: PlanStep[],
  depth: 0 | 1 | 2 | 3,  // Nesting level
  parentPlanId: string | null,
  status: 'pending' | 'in_progress' | 'completed' | 'failed',
  currentStepIndex: number
}
```

### PlanStep
```javascript
{
  id: string,
  number: number,
  description: string,
  complexity: 'simple' | 'medium' | 'complex',
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked',
  depth: number,
  parentStepId: string | null,
  subSteps: PlanStep[],
  attempts: number,
  maxAttempts: 3,
  codeOutput: CodeOutput | null,
  testResults: TestResult | null,
  verificationResult: VerificationResult | null,
  failReason: string | null
}
```

## Time-Based Termination

### Time Checks
- Before each phase transition
- Before each step execution
- During long-running operations (with timeout)

### Graceful Shutdown
1. Complete current atomic operation if possible
2. Save state for potential resume
3. Generate comprehensive final report
4. Return control to caller

### Time Allocation Strategy
```
Total Time Budget: T

Planning Phase:     min(10%, T) or max 15 minutes
Execution Phase:    80% of T
Verification Phase: min(10%, T) or max 10 minutes

Per-Step Budget:    (Execution Time) / (Number of Steps)
Fix Cycle Budget:   30% of Per-Step Budget
```

## Escalation Levels

| Level    | Trigger                    | Action                    |
|----------|----------------------------|---------------------------|
| NONE     | Score 70+                  | Continue normally         |
| REMIND   | Score 50-69                | Gentle guidance           |
| CORRECT  | Score 30-49 or 2+ issues   | Clear redirection         |
| REFOCUS  | Score <30 or 3+ issues     | Hard intervention         |
| CRITICAL | 4+ consecutive issues      | Final warning             |
| ABORT    | 5+ consecutive issues      | Terminate session         |

## Quality Gates

### Plan Approval Gate
- All steps must be actionable
- Dependencies must be satisfiable
- Complexity estimates must be reasonable
- Score >= 70 required

### Code Approval Gate
- Implementation must address step requirements
- Tests must be included
- No critical security issues
- Score >= 60 required

### Step Completion Gate
- Tests must pass
- Supervisor verification required
- Evidence of completion needed
- Score >= 70 required

### Goal Achievement Gate
- All steps completed (or acceptable failures)
- Final integration tests pass
- Supervisor confirms goal met
- Score >= 80 required

## Error Recovery

### Blocked Step Recovery
1. Attempt step up to maxAttempts times
2. If still blocked, create sub-plan (if depth < 3)
3. Execute sub-plan steps
4. If sub-plan fails, mark step failed and continue
5. If too many failures, escalate

### Test Failure Recovery
1. Generate fix plan from test results
2. Apply fix via Coder
3. Re-run tests
4. Repeat up to maxFixCycles times
5. If still failing, mark step as failed

### Agent Error Recovery
1. Retry with backoff (up to 3 times)
2. If persistent, use fallback response
3. Log error and continue with degraded quality
4. Never block indefinitely
