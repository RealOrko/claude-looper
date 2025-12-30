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
| ❌ **Goal impossible** | All recovery options exhausted (retries, replans, pivots) |
| 🛑 **User abort** | Manual intervention |

> **Note**: The system does not pause for clarification. If a task is ambiguous, it will try different approaches (PIVOT) until it succeeds or exhausts all options.

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
│  │  ┌───────┐ ┌────────┐ ┌───────┐ ┌──────────┐            │   │
│  │  │🔄RETRY│ │📋REPLAN│ │🔀PIVOT│ │❌IMPOSSIBLE│            │   │
│  │  └───┬───┘ └───┬────┘ └───┬───┘ └─────┬────┘            │   │
│  │      ▼         ▼          ▼           ▼                 │   │
│  │   Reset to   Break      Fresh       Stop                │   │
│  │   pending    subtasks   plan        execution           │   │
│  │   (max 3)    (depth 3)  (max 3)                         │   │
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

The system enforces hard limits to prevent infinite loops:

```
Task Fails
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  attempts < maxStepAttempts (3)?                        │
│     YES → Allow RETRY                                   │
│     NO  → Escalate to REPLAN                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  replanDepth < maxReplanDepth (5)?                      │
│     YES → Allow REPLAN                                  │
│     NO  → Escalate to PIVOT                            │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  pivotCount < maxPivots (3)?                            │
│     YES → Allow PIVOT                                   │
│     NO  → Mark as IMPOSSIBLE                           │
└─────────────────────────────────────────────────────────┘
```

### Maximum Attempts Before IMPOSSIBLE

Worst case: **3 retries × 3 replan depths × 3 pivots = 27 task execution attempts**

### Escalation Chain

| Exhausted | Escalates To |
|-----------|--------------|
| Retries (3) | REPLAN |
| Replan depth (3) | PIVOT |
| Pivots (3) | IMPOSSIBLE |

## 🔍 Supervisor Diagnosis Decisions

| Decision | When Used | Action |
|----------|-----------|--------|
| 🔄 **RETRY** | Transient error (network, timing) | Reset task, try again |
| 📋 **REPLAN** | Task too complex | Break into subtasks |
| 🔀 **PIVOT** | Approach is wrong | Fresh plan, new strategy |
| ❌ **IMPOSSIBLE** | Task cannot be achieved | Stop with explanation |

> **Note**: The system runs autonomously. If the LLM suggests CLARIFY, it's converted to PIVOT (try different approach) until pivots are exhausted, then IMPOSSIBLE.

### 📊 Diagnosis Context

The Supervisor receives:
- 🎯 Original goal (context only)
- 📝 Failed task/subtask description
- 👆 Parent task (for subtasks - this is the evaluation target)
- 📜 Complete attempt history
- 📊 Current state (completed/failed/pending)
- 🌳 Replan depth and max
- 🔀 Pivot count and max

## 🔀 State Transitions

### Task States
```
⏳ PENDING ──▶ 🔄 IN_PROGRESS ──┬──▶ ✅ COMPLETED
                                │
                                └──▶ ❌ FAILED ──▶ (diagnosis decides)
                                          │
                                          ├──▶ ⏳ PENDING (retry)
                                          ├──▶ 🚫 BLOCKED (replan)
                                          └──▶ 🔀 (pivot - new tasks)
```

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
| `maxReplanDepth` | 5 | Max subtask nesting before escalating to PIVOT |
| `maxPivots` | 3 | Fresh plan attempts before marking IMPOSSIBLE |
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

## 📖 Example Flow

```
🎯 Goal: "Add user authentication"

1️⃣ 📝 PLANNER creates tasks:
   [Setup DB, Create User model, Add login endpoint, Add tests]

2️⃣ 💻 CODER "Setup DB" ──▶ 🧪 TESTER passes ──▶ ✅

3️⃣ 💻 CODER "Create User model" ──▶ 🧪 TESTER fails
   └── 🔧 FIX: CODER fixes ──▶ 🧪 passes ──▶ ✅

4️⃣ 💻 CODER "Add login endpoint" ──▶ 🧪 TESTER fails (3x)
   └── 👁️ SUPERVISOR: "📋 REPLAN - too complex"
   └── 📝 PLANNER creates subtasks: [Add route, Add validation, Add session]
   └── Each subtask ──▶ ✅

5️⃣ 💻 CODER "Add tests" ──▶ 🧪 TESTER passes ──▶ ✅

6️⃣ 👁️ SUPERVISOR verifies goal ──▶ ✅ SUCCESS
```
