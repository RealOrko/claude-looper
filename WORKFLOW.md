# Claude Looper Workflow

This document describes the multi-agent workflow orchestrated by Claude Looper, including agent transitions, rejection handling, and replan triggers.

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
│       └───────────────────────────────────────────────┘         │
│                        rejection → replan                       │
└─────────────────────────────────────────────────────────────────┘
```

## Workflow Phases

### Phase 1: Planning
```
Goal ──▶ PLANNER ──▶ Plan (3-8 tasks)
```

The Planner breaks down the goal into discrete, actionable tasks with:
- Task descriptions
- Complexity ratings (simple/medium/complex)
- Dependencies between tasks
- Verification criteria

### Phase 2: Plan Review (if enabled)
```
Plan ──▶ SUPERVISOR ──▶ Approved? ──┬──▶ Yes: Continue to Execution
                                    │
                                    └──▶ No: Revise Plan (max 3 times)
```

**Supervisor scoring:**
- **70-100**: Approve - plan proceeds to execution
- **50-69**: Revise - plan returns to Planner with feedback
- **Below 50**: Reject - after max revisions, action depends on config

**On plan rejection after max revisions:**
- `skip_and_continue`: Proceed with current plan (default)
- `lower_threshold`: Reduce approval threshold to 50
- `abort`: Stop execution

### Phase 3: Execution

For each task in dependency order:

```
┌────────────────────────────────────────────────────────────────┐
│                     TASK EXECUTION LOOP                        │
│                                                                │
│  TASK ──▶ CODER ──▶ Implementation ──▶ TESTER ──▶ Test Result │
│              │                            │                    │
│              │                            ▼                    │
│              │                     ┌─────────────┐             │
│              │                     │   Passed?   │             │
│              │                     └─────────────┘             │
│              │                       │       │                 │
│              │                      Yes      No                │
│              │                       │       │                 │
│              │                       ▼       ▼                 │
│              │               [Verify with  FIX LOOP            │
│              │                Supervisor]  (max 3)             │
│              │                       │       │                 │
│              │                       │       ▼                 │
│              │                       │    CODER ──▶ Fix        │
│              │                       │       │                 │
│              │                       │       ▼                 │
│              │                       │    TESTER ──▶ Re-test   │
│              │                       │       │                 │
│              │                       ▼       │                 │
│              │               ┌───────────────┘                 │
│              │               │                                 │
│              ▼               ▼                                 │
│         [blocked]    [Task Complete]                           │
│              │               │                                 │
│              ▼               ▼                                 │
│         MARK FAILED    MARK COMPLETE                           │
└────────────────────────────────────────────────────────────────┘
```

### Phase 4: Final Verification
```
All Tasks ──▶ SUPERVISOR ──▶ Goal Achieved? ──┬──▶ Yes: SUCCESS
                                              │
                                              └──▶ No: FAILED
```

## Agent Transitions

### Normal Flow
```
PLANNER ──creates──▶ Task
                       │
                       ▼
                    CODER ──implements──▶ Implementation
                                              │
                                              ▼
                                          TESTER ──tests──▶ Result
                                                              │
                            ┌───────────────────────────────────
                            │
                            ▼
                    SUPERVISOR ──verifies──▶ Approved/Rejected
```

### Fix Loop (Coder ↔ Tester)
```
TESTER returns status: "failed"
         │
         ├──▶ fixCycle < maxFixCycles (3)?
         │         │
         │        Yes ──▶ CODER.applyFix() ──▶ TESTER.test()
         │         │                                │
         │         └────────────────────────────────┘
         │
         └──▶ No ──▶ Task marked FAILED
```

### Rejection Flow
```
SUPERVISOR returns: approved = false
         │
         ├──▶ Plan Review?
         │         │
         │        Yes ──▶ PLANNER revises plan with feedback
         │                        │
         │                        └──▶ Re-submit to SUPERVISOR
         │
         └──▶ Step Verification?
                   │
                   └──▶ Task marked FAILED ──▶ May trigger REPLAN
```

## Replan Triggers

A task is replanned when it fails after multiple attempts:

```
Task FAILED
     │
     ▼
attempts >= attemptsBeforeReplan (3)?
     │
    Yes ──▶ PLANNER.replan()
              │
              ├──▶ Analyzes failure reason
              ├──▶ Creates 2-3 subtasks
              └──▶ Original task marked BLOCKED
                          │
                          ▼
                   Subtasks become PENDING
                          │
                          ▼
                   Continue execution with subtasks
```

**Replan limits:**
- `maxReplanDepth`: 3 - maximum levels of task subdivision
- `maxGoalIterations`: 5 - maximum times to retry failed tasks

## State Transitions

### Task States
```
PENDING ──▶ IN_PROGRESS ──┬──▶ COMPLETED
                          │
                          ├──▶ FAILED ──▶ (retry or replan)
                          │
                          └──▶ BLOCKED (after replan, replaced by subtasks)
```

### Execution States
```
NOT_STARTED ──▶ RUNNING ──┬──▶ COMPLETED (goal verified)
                          │
                          ├──▶ FAILED (goal not achieved)
                          │
                          ├──▶ PAUSED (user interrupt)
                          │
                          └──▶ ABORTED (user abort or critical error)
```

## Configuration Defaults

| Setting | Default | Description |
|---------|---------|-------------|
| `maxFixCycles` | 3 | Fix attempts before task fails |
| `maxPlanRevisions` | 3 | Plan revision attempts |
| `attemptsBeforeReplan` | 3 | Task failures before replan |
| `maxReplanDepth` | 3 | Maximum subtask nesting |
| `maxGoalIterations` | 5 | Retry iterations for goal |
| `timeLimit` | 7200000ms (2h) | Maximum execution time |
| `approval threshold` | 70 | Minimum score to approve |
| `revision threshold` | 50 | Score range for revision |

## Supervisor Escalation Levels

| Level | Score Range | Action |
|-------|-------------|--------|
| `none` | 70+ | No issues, proceed |
| `remind` | 50-69 | Minor issue, gentle reminder |
| `correct` | 30-49 | Clear mistake needs fixing |
| `refocus` | 0-29 | Agent going off track |
| `critical` | N/A | Serious problem (>4 issues) |
| `abort` | N/A | Unrecoverable (>5 issues) |

## Termination Conditions

Execution stops when:

1. **Success**: All tasks completed AND goal verified by Supervisor
2. **Failure**: Goal verification fails after all tasks attempted
3. **Abort**:
   - User requests abort
   - Time budget exceeded
   - Supervisor escalates to "abort" level
   - More than 50% of tasks failed
4. **Max iterations**: `maxGoalIterations` reached with incomplete tasks

## Resumability

The orchestrator snapshots state after each task, allowing resume from:
- Failed executions
- Paused executions
- Interrupted sessions

Resume behavior:
1. Loads saved state from `.claude-looper/state.json`
2. Resets failed/in-progress tasks to pending
3. Continues execution from where it left off
4. Preserves Claude conversation context via executor sessions
