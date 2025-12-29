# Claude Looper Workflow

This document describes the multi-agent workflow orchestrated by Claude Looper, including agent transitions, the intelligent diagnosis system, and how the system iterates until goals are achieved.

## Overview

Claude Looper uses four specialized agents coordinated by an orchestrator to achieve goals autonomously:

```
┌─────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR                            │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ PLANNER  │───▶│  CODER   │───▶│  TESTER  │───▶│SUPERVISOR│  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │              ▲                │               │         │
│       │              │                │               │         │
│       │              └────────────────┘               │         │
│       │                  fix loop                     │         │
│       │                                               │         │
│       │◀──────────────────────────────────────────────┘         │
│       │              diagnosis decisions                        │
└─────────────────────────────────────────────────────────────────┘
```

## Core Philosophy: Iterate Until Done

Claude Looper is designed to **never give up arbitrarily**. Instead of hard-coded limits that terminate execution, it uses an intelligent Supervisor agent to diagnose problems and decide how to proceed. The only valid terminations are:

1. **Goal achieved** - Success
2. **Goal impossible** - Supervisor explicitly determines the goal cannot be achieved
3. **Clarification needed** - User input required to proceed
4. **User abort** - Manual intervention

## Workflow Phases

### Phase 1: Planning
```
Goal ──▶ PLANNER ──▶ Plan (3-8 tasks)
```

The Planner breaks down the goal into discrete, actionable tasks.

### Phase 2: Plan Review (if enabled)
```
Plan ──▶ SUPERVISOR ──▶ Approved? ──┬──▶ Yes: Continue to Execution
                                    │
                                    └──▶ No: Revise Plan
```

### Phase 3: Execution with Diagnosis

The execution phase runs in a continuous loop until all tasks complete or the Supervisor decides to stop:

```
┌────────────────────────────────────────────────────────────────┐
│                     EXECUTION LOOP                             │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Get next pending task                                    │   │
│  │         │                                                │   │
│  │         ▼                                                │   │
│  │  ┌─────────────┐                                         │   │
│  │  │ CODER       │──▶ Implementation                       │   │
│  │  └─────────────┘         │                               │   │
│  │         │                ▼                               │   │
│  │         │         ┌─────────────┐                        │   │
│  │         │         │ TESTER      │──▶ Test Results        │   │
│  │         │         └─────────────┘         │              │   │
│  │         │                │                ▼              │   │
│  │         │               Pass?────────────Yes──▶ Complete │   │
│  │         │                │                               │   │
│  │         │               No                               │   │
│  │         │                ▼                               │   │
│  │         │         ┌─────────────┐                        │   │
│  │         │         │ FIX LOOP    │ (max 3 cycles)         │   │
│  │         │         └─────────────┘                        │   │
│  │         │                │                               │   │
│  │         │            Still failing                       │   │
│  │         │                │                               │   │
│  │         ▼                ▼                               │   │
│  │  ┌───────────────────────────────┐                       │   │
│  │  │        TASK FAILED            │                       │   │
│  │  └───────────────────────────────┘                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                     │
│                          ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SUPERVISOR DIAGNOSIS                        │   │
│  │                                                          │   │
│  │  Analyze failure pattern and decide:                     │   │
│  │                                                          │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌────┐│   │
│  │  │  RETRY  │ │ REPLAN  │ │  PIVOT  │ │IMPOSSIBLE│ │ASK ││   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘ └──┬─┘│   │
│  │       │           │           │           │          │   │   │
│  │       ▼           ▼           ▼           ▼          ▼   │   │
│  │    Reset to    Break into   Fresh      Stop with   Pause │   │
│  │    pending     subtasks     plan       reason      for   │   │
│  │                                                   input  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                     │
│                          ▼                                     │
│              Continue loop (unless stopped)                    │
└────────────────────────────────────────────────────────────────┘
```

### Phase 4: Final Verification
```
All Tasks ──▶ SUPERVISOR ──▶ Goal Achieved? ──┬──▶ Yes: SUCCESS
                                              │
                                              └──▶ No: FAILED
```

## Supervisor Diagnosis Decisions

When a task fails, the Supervisor analyzes the failure pattern and makes an intelligent decision:

| Decision | When Used | Action |
|----------|-----------|--------|
| **RETRY** | Transient error (network, timing, flaky test) | Reset task to pending, try again |
| **REPLAN** | Task too complex or poorly defined | Break into smaller subtasks |
| **PIVOT** | Fundamental approach is wrong | Create fresh plan with different strategy |
| **IMPOSSIBLE** | Goal cannot be achieved | Stop with explanation |
| **CLARIFY** | Requirements ambiguous | Pause for user input |

### Diagnosis Context

The Supervisor receives:
- Original goal
- Failed task description
- Complete attempt history (what was tried, what failed)
- Current state (completed/failed/pending counts)
- Replan depth (how many times we've subdivided)

This context enables intelligent decisions rather than blind retries.

## State Transitions

### Task States
```
PENDING ──▶ IN_PROGRESS ──┬──▶ COMPLETED
                          │
                          └──▶ FAILED ──▶ (diagnosis decides next state)
                                   │
                                   ├──▶ PENDING (retry)
                                   ├──▶ BLOCKED (replan - replaced by subtasks)
                                   └──▶ (pivot - new tasks created)
```

### Execution States
```
NOT_STARTED ──▶ RUNNING ──┬──▶ COMPLETED (goal verified)
                          │
                          ├──▶ FAILED (goal impossible)
                          │
                          ├──▶ PAUSED (clarification needed)
                          │
                          └──▶ ABORTED (user abort)
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxFixCycles` | 3 | Fix attempts within a single task execution |
| `maxPlanRevisions` | 3 | Plan revision attempts during review |
| `maxReplanDepth` | 3 | Maximum subtask nesting depth |
| `timeLimit` | 7200000ms (2h) | Maximum execution time (0 = unlimited) |
| `approval threshold` | 70 | Minimum score to approve |

Note: These are safety rails, not termination triggers. The Supervisor can still decide to continue beyond these limits if appropriate.

## Supervisor Thresholds

### Verification Scoring
- **70-100**: Approve - work proceeds
- **50-69**: Revise - returns to agent with feedback
- **Below 50**: Reject - triggers diagnosis

### Escalation Levels
| Level | Description |
|-------|-------------|
| `none` | No issues |
| `remind` | Minor issue, gentle reminder |
| `correct` | Clear mistake needs fixing |
| `refocus` | Agent going off track |
| `critical` | Serious problem |
| `abort` | Unrecoverable issue |

## Key Differences from Traditional Approaches

| Traditional | Claude Looper |
|-------------|---------------|
| Fixed retry limits | Intelligent diagnosis |
| Silent failures | Explicit decisions with reasoning |
| Hard-coded escalation | Context-aware escalation |
| Terminate on limit | Pivot to new approach |
| No learning | Attempt history informs decisions |

## Resumability

The orchestrator snapshots state after each task, allowing resume from:
- Failed executions
- Paused executions (waiting for clarification)
- Interrupted sessions

Resume behavior:
1. Loads saved state
2. Restores attempt history
3. Continues from where it left off
4. Preserves Claude conversation context

## Example Flow

```
Goal: "Add user authentication"

1. PLANNER creates tasks: [Setup DB, Create User model, Add login endpoint, Add tests]

2. CODER implements "Setup DB" ──▶ TESTER passes ──▶ Complete

3. CODER implements "Create User model" ──▶ TESTER fails (missing field)
   ├── FIX LOOP: CODER fixes ──▶ TESTER passes ──▶ Complete

4. CODER implements "Add login endpoint" ──▶ TESTER fails (3x)
   ├── SUPERVISOR DIAGNOSES: "REPLAN - endpoint too complex"
   ├── PLANNER creates subtasks: [Add route, Add validation, Add session]
   ├── Each subtask executes successfully

5. CODER implements "Add tests" ──▶ TESTER passes ──▶ Complete

6. SUPERVISOR verifies goal ──▶ APPROVED ──▶ SUCCESS
```

If at any point the Supervisor determines the goal is impossible (e.g., "requires external API we don't have access to"), it returns `IMPOSSIBLE` with blockers, and execution stops with a clear explanation rather than silently failing.
