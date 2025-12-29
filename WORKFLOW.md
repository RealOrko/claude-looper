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

## 💪 Core Philosophy: Iterate Until Done

Claude Looper **never gives up arbitrarily**. The only valid terminations are:

| Outcome | Description |
|---------|-------------|
| ✅ **Goal achieved** | Success! |
| ❌ **Goal impossible** | Supervisor determines it can't be done |
| ❓ **Clarification needed** | User input required |
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
│  │  ┌───────┐ ┌────────┐ ┌───────┐ ┌──────────┐ ┌───────┐  │   │
│  │  │🔄RETRY│ │📋REPLAN│ │🔀PIVOT│ │❌IMPOSSIBLE│ │❓ASK  │  │   │
│  │  └───┬───┘ └───┬────┘ └───┬───┘ └─────┬────┘ └───┬───┘  │   │
│  │      ▼         ▼          ▼           ▼          ▼      │   │
│  │   Reset to   Break      Fresh       Stop       Pause    │   │
│  │   pending    subtasks   plan        with       for      │   │
│  │                                     reason     input    │   │
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

## 🔍 Supervisor Diagnosis Decisions

| Decision | When Used | Action |
|----------|-----------|--------|
| 🔄 **RETRY** | Transient error (network, timing) | Reset task, try again |
| 📋 **REPLAN** | Task too complex | Break into subtasks |
| 🔀 **PIVOT** | Approach is wrong | Fresh plan, new strategy |
| ❌ **IMPOSSIBLE** | Goal cannot be achieved | Stop with explanation |
| ❓ **CLARIFY** | Requirements ambiguous | Pause for user input |

### 📊 Diagnosis Context

The Supervisor receives:
- 🎯 Original goal
- 📝 Failed task description
- 📜 Complete attempt history
- 📊 Current state (completed/failed/pending)
- 🌳 Replan depth

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
| `maxFixCycles` | 3 | Fix attempts per task |
| `maxPlanRevisions` | 3 | Plan revision attempts |
| `maxReplanDepth` | 3 | Max subtask nesting |
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
