# 🔄 Claude Looper Workflow

Multi-agent workflow orchestrated by Claude Looper with intelligent diagnosis and iteration until goals are achieved.

## 🎯 Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      🎯 ORCHESTRATOR                            │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │📝 PLANNER│───▶│💻 CODER  │───▶│🧪 TESTER │───▶│👁️SUPERVISOR│ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │              ▲                │               │         │
│       │              └────────────────┘               │         │
│       │                 🔧 fix loop                   │         │
│       │◀──────────────────────────────────────────────┘         │
│                      🔍 diagnosis decisions                     │
└─────────────────────────────────────────────────────────────────┘
```

## 💪 Core Philosophy: Autonomous Iteration Until Done

Claude Looper **runs autonomously** and **never gives up arbitrarily**. The only valid terminations are:

| Outcome | Description |
|---------|-------------|
| ✅ **Goal achieved** | Success! |
| ❌ **Goal impossible** | All recovery options exhausted (retries × replans) |
| 🛑 **User abort** | Manual intervention |

## 📋 Workflow Phases

### 1️⃣ Planning
```
🎯 Goal ──▶ 📝 PLANNER ──▶ 📋 Plan (3-8 tasks)
```

### 2️⃣ Plan Review
```
📋 Plan ──▶ 👁️ SUPERVISOR ──▶ Approved? ──┬──▶ ✅ Continue
                                          └──▶ 🔄 Revise
```

### 3️⃣ Execution Loop

```
┌────────────────────────────────────────────────────────────────┐
│                    ⚡ EXECUTION LOOP                            │
│                                                                │
│  📋 Get next pending task                                      │
│           │                                                    │
│           ▼                                                    │
│    ┌─────────────────────────────────────────────────────────┐ │
│    │  Task complexity = complex?                              │ │
│    │      YES → 📋 REPLAN into subtasks (proactive)          │ │
│    │      NO  → Continue to execution                        │ │
│    └─────────────────────────────────────────────────────────┘ │
│           │                                                    │
│           ▼                                                    │
│    ┌─────────────┐                                             │
│    │ 💻 CODER    │──▶ Implementation                           │
│    └─────────────┘         │                                   │
│                            ▼                                   │
│                     ┌─────────────┐                            │
│                     │ 🧪 TESTER   │──▶ Test Results            │
│                     └─────────────┘         │                  │
│                            │                ▼                  │
│                          Pass? ─────────── ✅ ──▶ Complete     │
│                            │                                   │
│                           ❌                                   │
│                            ▼                                   │
│                     ┌─────────────┐                            │
│                     │ 🔧 FIX LOOP │ (max 3 cycles)             │
│                     └─────────────┘                            │
│                            │                                   │
│                      Still failing                             │
│                            │                                   │
│                            ▼                                   │
│               ┌───────────────────────┐                        │
│               │    ❌ TASK FAILED     │                        │
│               └───────────────────────┘                        │
│                            │                                   │
│                            ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           👁️ SUPERVISOR DIAGNOSIS                        │   │
│  │                                                          │   │
│  │  ┌───────┐ ┌────────┐ ┌──────────┐                      │   │
│  │  │🔄RETRY│ │📋REPLAN│ │❌IMPOSSIBLE│                      │   │
│  │  └───┬───┘ └───┬────┘ └─────┬────┘                      │   │
│  │      ▼         ▼            ▼                           │   │
│  │   Reset to   Break        Stop                          │   │
│  │   pending    subtasks     execution                     │   │
│  │   (max 3)    (max 3)                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                   │
│              Continue loop (unless stopped)                    │
└────────────────────────────────────────────────────────────────┘
```

### 4️⃣ Final Verification
```
📋 All Tasks ──▶ 👁️ SUPERVISOR ──▶ Goal Achieved? ──┬──▶ ✅ SUCCESS
                                                    └──▶ ❌ FAILED
```

## 🏛️ Hierarchical Verification Scope

The Supervisor evaluates work at each level against its **immediate parent**, not the overall goal:

```
🎯 Goal
   └── verified against: Goal's success criteria
       │
📋 Plan
   └── verified against: Does it achieve the goal?
       │
📝 Task
   └── verified against: Task's own criteria (goal is context only)
       │
📝 Subtask
   └── verified against: Parent Task's criteria (goal is irrelevant)
```

### Why Hierarchical Scope Matters

| Wrong Approach | Correct Approach |
|---------------|------------------|
| Subtask rejected because "goal not achieved" | Subtask approved because it satisfies parent task |
| Task rejected because "other tasks incomplete" | Task approved because it meets its own criteria |
| Endless retry loops | Clean progression through task hierarchy |

### Scope Rules

| Level | Evaluate Against | Ignore |
|-------|-----------------|--------|
| Subtask | Parent task's requirements | Overall goal |
| Task | Task's own verification criteria | Other tasks, overall goal completion |
| Plan | Goal requirements | Individual task details |

## 🔒 Hard Escalation Limits

The system enforces hard limits to prevent infinite loops. **Clamp-down logic** ensures we always exhaust lower-level options before escalating:

```
Task Fails
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  attempts < maxStepAttempts (3)?                        │
│     YES → RETRY (even if supervisor suggests otherwise) │
│     NO  → Escalate to REPLAN                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  replanDepth < maxReplanDepth (5)?                      │
│     YES → REPLAN (even if supervisor suggests otherwise)│
│     NO  → Mark as IMPOSSIBLE                           │
└─────────────────────────────────────────────────────────┘
```

### Escalation Chain

```
RETRY (3x) → REPLAN (depth 1) → RETRY (3x) → REPLAN (depth 2) → ... → REPLAN (depth 5) → RETRY (3x) → IMPOSSIBLE
```

### Maximum Attempts Before IMPOSSIBLE

Worst case per task: **3 retries × 5 replan depths = 15 task execution attempts**

| Exhausted | Escalates To |
|-----------|--------------|
| Retries (3) | REPLAN (break into subtasks) |
| Replan depth (5) | IMPOSSIBLE |

### Clamp-Down Rules

The orchestrator **enforces** the escalation chain regardless of what the supervisor suggests:

| Supervisor Says | Retries Left? | Replans Left? | Actual Action |
|-----------------|---------------|---------------|---------------|
| REPLAN | Yes | - | **RETRY** (clamped down) |
| IMPOSSIBLE | Yes | - | **RETRY** (clamped down) |
| IMPOSSIBLE | No | Yes | **REPLAN** (clamped down) |
| RETRY | No | Yes | **REPLAN** (escalated up) |
| REPLAN | No | No | **IMPOSSIBLE** (escalated up) |

## 🔍 Supervisor Diagnosis Decisions

| Decision | When Used | Action |
|----------|-----------|--------|
| 🔄 **RETRY** | Transient error, minor fix needed | Reset task to pending, try again |
| 📋 **REPLAN** | Task too complex, needs breakdown | Create subtasks |
| ❌ **IMPOSSIBLE** | Task cannot be achieved | Stop with explanation |

> **Note**: The supervisor provides recommendations, but the orchestrator enforces the escalation chain. The supervisor cannot skip retry attempts or jump to impossible.

### 📊 Diagnosis Context

The Supervisor receives:
- 🎯 Original goal (context only)
- 📝 Failed task/subtask description
- 👆 Parent task (for subtasks - this is the evaluation target)
- 📜 Complete attempt history
- 📊 Current state (completed/failed/pending)
- 🌳 Replan depth and max

## 🔀 State Transitions

### Task States
```
⏳ PENDING ──▶ 🔄 IN_PROGRESS ──┬──▶ ✅ COMPLETED
                                │
                                └──▶ ❌ FAILED ──▶ (diagnosis decides)
                                          │
                                          ├──▶ ⏳ PENDING (retry)
                                          └──▶ 🚫 BLOCKED (replan into subtasks)
```

### Blocked State

A task enters BLOCKED state when it is replanned into subtasks:
- The parent task is marked BLOCKED
- Subtasks are created as PENDING
- When ALL subtasks complete, parent transitions to COMPLETED
- Orphaned blocked tasks (no subtasks) are reset to PENDING on resume

### Execution States
```
⏳ NOT_STARTED ──▶ 🔄 RUNNING ──┬──▶ ✅ COMPLETED
                                ├──▶ ❌ FAILED
                                ├──▶ ⏸️ PAUSED
                                └──▶ 🛑 ABORTED
```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxStepAttempts` | 3 | Retry attempts per task before escalating to REPLAN |
| `maxFixCycles` | 3 | Fix attempts per task within coder/tester loop |
| `maxPlanRevisions` | 3 | Plan revision attempts |
| `maxReplanDepth` | 5 | Max subtask recursion depth before marking IMPOSSIBLE |
| `timeLimit` | 2h | Max execution time |
| `approval threshold` | 70 | Min score to approve |

## 📊 Supervisor Thresholds

### Verification Scoring
| Score | Action |
|-------|--------|
| 70-100 | ✅ Approve |
| 50-69 | 🔄 Revise |
| <50 | ❌ Reject → diagnosis |

### Escalation Levels
| Level | Description |
|-------|-------------|
| ✅ `none` | No issues |
| 💬 `remind` | Gentle reminder |
| 🔧 `correct` | Needs fixing |
| 🎯 `refocus` | Going off track |
| ⚠️ `critical` | Serious problem |
| 🛑 `abort` | Unrecoverable |

## 💾 Resumability

State snapshots after each task enable resume from:
- ❌ Failed executions
- ⏸️ Paused executions (waiting for input)
- 🔌 Interrupted sessions

On resume:
- Failed and in-progress tasks are reset to pending
- Orphaned blocked tasks (no subtasks) are reset to pending
- Blocked tasks with subtasks continue execution of subtasks

## 📖 Example Flow

```
🎯 Goal: "Add user authentication"

1️⃣ 📝 PLANNER creates tasks:
   [Setup DB, Create User model, Add login endpoint, Add tests]

2️⃣ 💻 CODER "Setup DB" ──▶ 🧪 TESTER passes ──▶ ✅

3️⃣ 💻 CODER "Create User model" ──▶ 🧪 TESTER fails
   └── 🔧 FIX: CODER fixes ──▶ 🧪 passes ──▶ ✅

4️⃣ 💻 CODER "Add login endpoint" (complexity: complex)
   └── 📋 PROACTIVE REPLAN: Break into subtasks
   └── Subtasks: [Add route, Add validation, Add session]
   └── Each subtask ──▶ ✅ (retried if needed)
   └── Parent task ──▶ ✅

5️⃣ 💻 CODER "Add tests" ──▶ 🧪 TESTER passes ──▶ ✅

6️⃣ 👁️ SUPERVISOR verifies goal ──▶ ✅ SUCCESS
```

### Failure Example

```
🎯 Goal: "Implement impossible feature"

1️⃣ 📝 PLANNER creates task: [Implement X]

2️⃣ 💻 CODER "Implement X" ──▶ 🧪 TESTER fails
   └── 🔄 RETRY 1, 2, 3 ──▶ fails (retries exhausted)
   └── 📋 REPLAN depth 1 ──▶ subtasks created
       └── Subtask fails after 3 retries
       └── 📋 REPLAN depth 2 ──▶ subtasks created
           └── Subtask fails after 3 retries
           └── 📋 REPLAN depth 3 ──▶ subtasks created
               └── Subtask fails after 3 retries
               └── 📋 REPLAN depth 4 ──▶ subtasks created
                   └── Subtask fails after 3 retries
                   └── 📋 REPLAN depth 5 ──▶ subtasks created
                       └── Subtask fails after 3 retries
                       └── ❌ IMPOSSIBLE (depth 5 exhausted)
```
