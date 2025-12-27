# 🔄 Claude Looper

> Multi-agent framework for autonomous software development using Claude

## ✨ Features

- 🤖 **Four Specialized Agents** - Planner, Coder, Tester, Supervisor working in concert
- 📡 **Event-Driven Architecture** - Agents communicate via state changes and events
- 💾 **Persistent State** - Snapshot and resume workflows anytime
- 🖥️ **Terminal UI** - Real-time progress visualization
- ⚙️ **Configurable Workflows** - JSON-based agent configuration

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run with a goal
node cli.js "Add user authentication to the app"

# Or install globally
npm link
claude-looper "Your goal here"
```

## 📋 Commands

```bash
claude-looper "goal"           # Start new workflow
claude-looper --resume         # Resume interrupted workflow
claude-looper --status         # Check saved state
claude-looper --no-ui "goal"   # Run without terminal UI
claude-looper --docker "goal"  # Run inside Docker container
```

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐
│   Planner   │────▶│    Coder    │
└─────────────┘     └─────────────┘
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│  Supervisor │◀────│   Tester    │
└─────────────┘     └─────────────┘
```

| Agent | Role | Model |
|-------|------|-------|
| 📝 Planner | Breaks goals into tasks | Sonnet |
| 💻 Coder | Implements tasks | Opus |
| 🧪 Tester | Validates implementations | Opus |
| 👁️ Supervisor | Reviews and approves work | Opus |

## 📁 Project Structure

```
├── cli.js              # CLI entry point
├── agent-core.js       # Event-driven state management
├── agent-executor.js   # Claude CLI execution
├── agent-planner.js    # Task planning
├── agent-coder.js      # Implementation
├── agent-tester.js     # Testing
├── agent-supervisor.js # Quality verification
├── orchestrator.js     # Workflow coordination
├── terminal-ui.js      # Blessed-based UI
└── templates/          # Handlebars prompt templates
```

## 🔬 Architecture Deep Dive

### Event-Driven Design

Claude Looper uses an event-driven architecture with a **single centralized EventEmitter** in `agent-core.js`. This design provides:

- **Loose coupling**: Agents don't call each other directly
- **Observability**: All state changes are tracked and logged
- **Persistence**: Events enable automatic state snapshots
- **Extensibility**: New agents can subscribe to existing events

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentCore                                │
│                    (Single EventEmitter)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│   │ Planner  │    │  Coder   │    │  Tester  │    │Supervisor│  │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘  │
│        │               │               │               │         │
│        └───────────────┴───────────────┴───────────────┘         │
│                              │                                   │
│                    emit() / on() / off()                         │
│                              │                                   │
│                    ┌─────────▼─────────┐                         │
│                    │    Event Bus      │                         │
│                    │  (wildcard: '*')  │                         │
│                    └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Why Only One EventEmitter?

The EventEmitter is **only implemented in `agent-core.js`** for these reasons:

1. **Single Source of Truth**: All state changes flow through one place
2. **Simplified Debugging**: Event log captures all activity
3. **Consistent Persistence**: Snapshots capture complete state
4. **No Event Storms**: Prevents cascading event chains between emitters

Other modules (agent-executor.js, orchestrator.js) use callbacks and promises instead of their own EventEmitters, keeping the architecture clean.

### Event Types

All events are defined in the `EventTypes` constant:

```javascript
import { EventTypes } from './agent-core.js';

// Agent lifecycle
EventTypes.AGENT_REGISTERED   // 'agent:registered' - New agent registered

// State management
EventTypes.STATE_CHANGED      // 'state:changed' - Agent state updated

// Goal tracking
EventTypes.GOAL_SET           // 'goal:set' - New goal assigned
EventTypes.GOAL_UPDATED       // 'goal:updated' - Goal modified
EventTypes.GOAL_COMPLETED     // 'goal:completed' - Goal achieved

// Task management
EventTypes.TASK_ADDED         // 'task:added' - New task created
EventTypes.TASK_UPDATED       // 'task:updated' - Task modified
EventTypes.TASK_COMPLETED     // 'task:completed' - Task finished
EventTypes.TASK_FAILED        // 'task:failed' - Task failed

// Agent data
EventTypes.MEMORY_UPDATED     // 'memory:updated' - Memory added
EventTypes.OUTPUT_RECORDED    // 'output:recorded' - Claude response recorded
EventTypes.INTERACTION_LOGGED // 'interaction:logged' - Agent-to-agent message

// Persistence
EventTypes.SNAPSHOT_SAVED     // 'snapshot:saved' - State saved to disk
EventTypes.SNAPSHOT_LOADED    // 'snapshot:loaded' - State restored from disk

// Workflow
EventTypes.WORKFLOW_STARTED   // 'workflow:started' - Workflow began
EventTypes.WORKFLOW_COMPLETED // 'workflow:completed' - Workflow finished
```

### Event Payload Structure

Every event includes a consistent payload:

```javascript
{
  type: 'task:completed',      // Event type from EventTypes
  timestamp: 1703123456789,    // Unix timestamp
  source: 'coder',             // Agent that triggered the event
  changeType: 'modified',      // 'added', 'modified', or 'removed'
  object: { ... },             // The changed object (task, goal, etc.)
  agentState: { ... }          // Full agent state at time of event
}
```

### Subscription Model

Agents subscribe to events using the `subscribesTo` configuration:

```javascript
// In configuration.json
{
  "agents": {
    "supervisor": {
      "subscribesTo": ["planner", "coder", "tester"]
    }
  }
}
```

This creates filtered subscriptions:

```javascript
// AgentCore filters events based on subscribesTo
agentCore.subscribeToAgents('supervisor', ['planner', 'coder', 'tester'], (event) => {
  // Only receives events where event.source is 'planner', 'coder', 'tester', or 'core'
  console.log(`${event.source} triggered ${event.type}`);
});
```

### Event Flow Example

Here's how events flow when the Coder completes a task:

```
1. Coder calls: agentCore.updateTask('coder', taskId, { status: 'completed' })
                                    │
                                    ▼
2. AgentCore updates internal state and emits:
   ┌─────────────────────────────────────────────────────────┐
   │ emit('task:completed', {                                │
   │   type: 'task:completed',                               │
   │   source: 'coder',                                      │
   │   object: { id: 'task-123', status: 'completed', ... }  │
   │ })                                                      │
   │                                                         │
   │ emit('*', event)  // Wildcard for catch-all listeners   │
   └─────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
3. Supervisor receives         Planner receives          UI updates
   (subscribed to coder)       (subscribed to coder)     (wildcard *)

4. Each listener processes the event independently
```

### Subscribing to Events

**Subscribe to specific event type:**
```javascript
import agentCore, { EventTypes } from './agent-core.js';

agentCore.on(EventTypes.TASK_COMPLETED, (event) => {
  console.log(`Task ${event.object.id} completed by ${event.source}`);
});
```

**Subscribe to all events (wildcard):**
```javascript
agentCore.on('*', (event) => {
  console.log(`[${event.type}] from ${event.source}`);
});
```

**Subscribe to events from specific agents:**
```javascript
const unsubscribe = agentCore.subscribeToAgents(
  'myListener',           // Subscriber name (for debugging)
  ['planner', 'coder'],   // Source agents to listen to
  (event) => {
    // Only events from planner, coder, or 'core'
    handleEvent(event);
  }
);

// Later: unsubscribe() to remove listener
```

### Agent Communication Patterns

**1. Task Delegation (Planner → Coder)**
```
Planner                          AgentCore                         Coder
   │                                 │                               │
   │ addTask('planner', task)        │                               │
   │────────────────────────────────▶│                               │
   │                                 │ emit('task:added')            │
   │                                 │──────────────────────────────▶│
   │                                 │                               │
   │                                 │              Coder picks up task
```

**2. Verification Request (Coder → Supervisor)**
```
Coder                            AgentCore                      Supervisor
   │                                 │                               │
   │ recordOutput('coder', result)   │                               │
   │────────────────────────────────▶│                               │
   │                                 │ emit('output:recorded')       │
   │                                 │──────────────────────────────▶│
   │                                 │                               │
   │                                 │         Supervisor reviews output
```

**3. Feedback Loop (Supervisor → Coder)**
```
Supervisor                       AgentCore                         Coder
   │                                 │                               │
   │ logInteraction(sup→coder, feedback)                             │
   │────────────────────────────────▶│                               │
   │                                 │ emit('interaction:logged')    │
   │                                 │──────────────────────────────▶│
   │                                 │                               │
   │                                 │           Coder receives feedback
```

### Event Log

AgentCore maintains an event log for debugging and replay:

```javascript
// Get recent events
const events = agentCore.getEventLog(50);  // Last 50 events

// Log is automatically bounded to 500 events
// Older events are discarded to prevent memory growth
```

The event log is also persisted in snapshots, enabling:
- Post-mortem debugging of failed workflows
- Understanding agent decision history
- Replaying events for testing

### Change Types

Events include a `changeType` field indicating the nature of the change:

```javascript
import { ChangeTypes } from './agent-core.js';

ChangeTypes.ADDED    // New entity created (task, goal, memory)
ChangeTypes.MODIFIED // Existing entity updated
ChangeTypes.REMOVED  // Entity deleted (rarely used)
```

## ⚙️ Configuration

Claude Looper uses a JSON configuration file to define workflow behavior. On first run, it copies the default configuration to `.claude-looper/default-workflow.json` in your project directory.

### Configuration File Location

```
.claude-looper/
├── default-workflow.json   # Main workflow configuration
├── configuration.json      # Active configuration (copied from default)
├── state.json              # Saved state for resume functionality
└── templates/              # Handlebars prompt templates
```

### Configuration Structure Overview

```json
{
  "default-workflow": {
    "name": "Standard Development Workflow",
    "description": "Multi-agent workflow for autonomous software development",
    "version": "1.0.0",
    "agents": { ... },
    "execution": { ... },
    "timeBudget": { ... },
    "escalation": { ... },
    "planReviewFailure": { ... }
  }
}
```

### Agent Configuration

Each agent is configured with the following properties:

```json
{
  "agents": {
    "supervisor": {
      "model": "opus",
      "fallbackModel": "sonnet",
      "subscribesTo": ["planner", "coder", "tester"],
      "role": "Critique and verify output from other agents",
      "tools": [...],
      "thresholds": { "approval": 70, "revision": 50, "rejection": 30 }
    },
    "planner": {
      "model": "sonnet",
      "fallbackModel": "haiku",
      "subscribesTo": ["supervisor", "coder", "tester"],
      "settings": { "minTasks": 2, "maxTasks": 15, "maxReplanDepth": 3 }
    },
    "coder": {
      "model": "opus",
      "fallbackModel": "sonnet",
      "subscribesTo": ["supervisor", "planner"],
      "settings": { "timeout": 900000, "maxFixCycles": 3 }
    },
    "tester": {
      "model": "opus",
      "fallbackModel": "sonnet",
      "subscribesTo": ["supervisor", "planner"],
      "settings": { "requireTests": true, "minCoverage": 60 }
    }
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `model` | string | Primary Claude model: `opus`, `sonnet`, or `haiku` |
| `fallbackModel` | string | Backup model if primary fails or is overloaded |
| `subscribesTo` | array | List of agent names whose events this agent receives |
| `role` | string | Description of the agent's responsibility |
| `tools` | array | Custom tool definitions for structured responses |
| `settings` | object | Agent-specific configuration (varies by agent type) |
| `thresholds` | object | Score thresholds for approval decisions (supervisor only) |

#### Agent-Specific Settings

**Planner Settings:**
- `minTasks`: Minimum number of tasks to create (default: 2)
- `maxTasks`: Maximum number of tasks to create (default: 15)
- `maxReplanDepth`: Maximum levels of subtask decomposition (default: 3)
- `attemptsBeforeReplan`: Failures before triggering re-planning (default: 3)

**Coder Settings:**
- `timeout`: Maximum execution time in milliseconds (default: 900000 = 15 min)
- `maxFixCycles`: Maximum fix attempts per task (default: 3)

**Tester Settings:**
- `requireTests`: Whether to require tests for all implementations (default: true)
- `minCoverage`: Minimum code coverage percentage (default: 60)

**Supervisor Thresholds:**
- `approval`: Minimum score to approve work (default: 70)
- `revision`: Score below which revision is requested (default: 50)
- `rejection`: Score below which work is rejected (default: 30)

### Event Subscriptions

Agents communicate through an event-driven architecture. The `subscribesTo` array determines which events an agent receives:

```
┌──────────────────────────────────────────────────────────────┐
│                     Event Flow                               │
├──────────────────────────────────────────────────────────────┤
│  Supervisor ◀───── subscribes to ────▶ [planner, coder, tester]
│  Planner    ◀───── subscribes to ────▶ [supervisor, coder, tester]
│  Coder      ◀───── subscribes to ────▶ [supervisor, planner]
│  Tester     ◀───── subscribes to ────▶ [supervisor, planner]
└──────────────────────────────────────────────────────────────┘
```

When an agent updates its state, completes a task, or records output, subscribed agents receive notifications. This enables:
- **Supervisor** to monitor all agent activity
- **Planner** to react to implementation results
- **Coder/Tester** to receive task assignments and feedback

### Execution Settings

```json
{
  "execution": {
    "phases": ["planning", "plan_review", "execution", "verification"],
    "maxStepAttempts": 3,
    "maxFixCycles": 3,
    "requirePrePlanReview": true,
    "maxPlanRevisions": 3,
    "verifyAllOutputs": true,
    "progressCheckInterval": 300000,
    "timeLimit": 7200000
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `phases` | array | See above | Workflow phases executed in order |
| `maxStepAttempts` | number | 3 | Retries per task before failure |
| `maxFixCycles` | number | 3 | Test-fix iterations before giving up |
| `requirePrePlanReview` | boolean | true | Supervisor reviews plan before execution |
| `maxPlanRevisions` | number | 3 | Maximum plan revision attempts |
| `verifyAllOutputs` | boolean | true | Supervisor verifies each task output |
| `progressCheckInterval` | number | 300000 | Progress check interval (5 min) |
| `timeLimit` | number | 7200000 | Total time limit in ms (2 hours) |

### Time Budget

Allocate time across workflow phases (values must sum to 1.0):

```json
{
  "timeBudget": {
    "planning": 0.1,
    "execution": 0.8,
    "verification": 0.1
  }
}
```

### Escalation Settings

Configure how the supervisor handles quality issues:

```json
{
  "escalation": {
    "levels": ["none", "remind", "correct", "refocus", "critical", "abort"],
    "scoreThresholds": {
      "none": 70,
      "remind": 50,
      "correct": 30,
      "refocus": 0
    },
    "maxIssuesBeforeCritical": 4,
    "maxIssuesBeforeAbort": 5
  }
}
```

| Level | Score Range | Action |
|-------|-------------|--------|
| `none` | 70-100 | Work proceeds normally |
| `remind` | 50-69 | Gentle reminder to stay on track |
| `correct` | 30-49 | Correction guidance provided |
| `refocus` | 0-29 | Strong redirection needed |
| `critical` | 4+ issues | Major intervention required |
| `abort` | 5+ issues | Workflow terminated |

### Plan Review Failure Handling

Configure behavior when plan review fails:

```json
{
  "planReviewFailure": {
    "action": "skip_and_continue",
    "options": ["skip_and_continue", "lower_threshold", "abort"],
    "lowerThresholdTo": 50
  }
}
```

| Action | Description |
|--------|-------------|
| `skip_and_continue` | Proceed with plan despite review failure |
| `lower_threshold` | Retry with reduced approval threshold |
| `abort` | Terminate the workflow |

### Example: Custom Configuration

Here's an example of a faster, less strict workflow:

```json
{
  "default-workflow": {
    "name": "Quick Development",
    "agents": {
      "supervisor": {
        "model": "sonnet",
        "thresholds": { "approval": 60, "revision": 40, "rejection": 20 }
      },
      "planner": {
        "model": "haiku",
        "settings": { "maxTasks": 5 }
      },
      "coder": {
        "model": "sonnet",
        "settings": { "timeout": 300000, "maxFixCycles": 2 }
      },
      "tester": {
        "model": "sonnet",
        "settings": { "requireTests": false, "minCoverage": 40 }
      }
    },
    "execution": {
      "requirePrePlanReview": false,
      "maxStepAttempts": 2,
      "timeLimit": 3600000
    }
  }
}
```

## 💾 Resume Functionality

Claude Looper automatically saves workflow state to disk, allowing you to resume interrupted workflows. This is useful for:
- Recovering from crashes or network issues
- Pausing work and continuing later
- Retrying failed tasks with fresh context

### State Persistence

State is automatically saved to `.claude-looper/state.json` after each significant operation:
- Task completion or failure
- Phase transitions
- Agent state updates
- Workflow pauses or interruptions

### What Gets Saved

The state file contains a complete snapshot of workflow progress:

```json
{
  "version": 1,
  "timestamp": 1703123456789,
  "agents": {
    "planner": {
      "name": "planner",
      "model": "sonnet",
      "state": { ... },
      "memory": [...],
      "goals": [...],
      "tasks": [...],
      "outputs": [...],
      "interactions": [...]
    },
    "coder": { ... },
    "tester": { ... },
    "supervisor": { ... }
  },
  "workflow": {
    "active": true,
    "name": "default-workflow",
    "goal": "Add user authentication to the app",
    "startTime": 1703123400000,
    "status": "running"
  },
  "eventLog": [...],
  "executorSessions": {
    "planner": "session-abc123",
    "coder": "session-def456"
  },
  "currentPhase": "execution"
}
```

| Saved Data | Description |
|------------|-------------|
| `agents` | Complete state of all agents including tasks, goals, memory, and outputs |
| `workflow` | Current workflow status, goal, and timing information |
| `eventLog` | Last 100 events for debugging and context |
| `executorSessions` | Claude CLI session IDs for conversation continuity |
| `currentPhase` | Which phase the workflow was in when saved |

### Per-Agent State

Each agent's state includes:
- **tasks**: All tasks with status (pending, in_progress, completed, failed)
- **goals**: Goals set for the agent
- **memory**: Agent memories and observations (max 100 entries)
- **outputs**: Recorded outputs from Claude (max 50 entries)
- **interactions**: Inter-agent communication log (max 100 entries)
- **state**: Custom agent-specific state data

### Using the Resume Flag

```bash
# Check if there's a workflow to resume
claude-looper --status

# Resume an interrupted workflow
claude-looper --resume

# Resume in Docker
claude-looper --docker --resume
```

### Status Output

The `--status` flag shows what can be resumed:

```
Saved Workflow Status
─────────────────────
Goal: Add user authentication to the app
Status: running
Started: 2024-01-15 14:30:00
Elapsed: 45m 23s

Tasks:
  Total: 8
  Completed: 5
  Failed: 1
  Pending: 2

Can resume: Yes
```

### Resume vs. Starting Fresh

| Scenario | Action | Command |
|----------|--------|---------|
| Workflow was interrupted mid-task | Resume | `--resume` |
| Some tasks failed, want to retry | Resume | `--resume` |
| Want to start over with same goal | Start fresh | Delete `.claude-looper/state.json` |
| Want a completely new goal | Start fresh | Run with new goal (will prompt to confirm) |
| API rate limits interrupted work | Resume | `--resume` |

### What Happens on Resume

1. **State is loaded** from `.claude-looper/state.json`
2. **Agents are re-initialized** with their saved state
3. **Sessions are restored** for conversation continuity
4. **Failed/in-progress tasks are reset** to pending status
5. **Workflow continues** from where it left off

### Automatic Recovery

When resuming, the orchestrator:
- Resets failed tasks to `pending` status
- Clears attempt counters for retry
- Re-activates the workflow
- Continues from the last successful phase

### Example: Handling Failures

```bash
# Start a workflow
claude-looper "Implement user dashboard"

# If it fails or you interrupt with Ctrl+C...

# Check what happened
claude-looper --status

# Resume and retry failed tasks
claude-looper --resume
```

### Troubleshooting Resume Issues

**"No saved state to resume from"**
```bash
# No state.json exists - start a new workflow
claude-looper "Your goal here"
```

**"State file is corrupted"**
```bash
# Remove the corrupted state and start fresh
rm .claude-looper/state.json
claude-looper "Your goal here"
```

**"Session expired" or context issues**
```bash
# Sessions may expire after long pauses
# The workflow will start new sessions automatically
claude-looper --resume
```

**Resume shows stale data**
```bash
# View the raw state file
cat .claude-looper/state.json | jq .

# If needed, delete and restart
rm .claude-looper/state.json
```

**Tasks stuck in "in_progress"**
```bash
# Resume will automatically reset in_progress tasks to pending
claude-looper --resume
```

### Clearing State

To start completely fresh:

```bash
# Remove all saved state
rm -rf .claude-looper/state.json

# Or remove the entire config directory
rm -rf .claude-looper/
```

Note: Removing `.claude-looper/` also removes your configuration. The next run will recreate it from defaults.

## 🐳 Docker Usage

Claude Looper can run inside a Docker container for isolated, reproducible execution environments. The container includes Claude Code CLI, Node.js, Python, Go, and all necessary development tools.

### Building the Docker Image

```bash
# Build the image (tagged as 'claude')
npm run docker

# Or manually:
docker build -t claude .
```

### Running with Docker

There are two ways to run Claude Looper with Docker:

#### Option 1: Using the `--docker` Flag (Recommended)

The simplest way - the CLI handles all Docker configuration automatically:

```bash
# Run a workflow in Docker
claude-looper --docker "Add user authentication to the app"

# Resume a workflow in Docker
claude-looper --docker --resume

# Check status in Docker
claude-looper --docker --status

# Disable UI in Docker
claude-looper --docker --no-ui "Your goal"
```

This automatically:
- Mounts your current directory as `/home/claude/workspace`
- Mounts `~/.claude` for API credentials
- Mounts `~/.ssh` (read-only) if it exists
- Mounts `/tmp` for temporary files
- Uses host networking for API access

#### Option 2: Manual Docker Run

For more control over the container configuration:

```bash
# Basic run with workspace mount
docker run --rm -it \
  -v "$(pwd):/home/claude/workspace" \
  -v "$HOME/.claude:/home/claude/.claude" \
  -w /home/claude/workspace \
  --network=host \
  claude claude-looper "Your goal here"

# With SSH keys for git operations
docker run --rm -it \
  -v "$(pwd):/home/claude/workspace" \
  -v "$HOME/.claude:/home/claude/.claude" \
  -v "$HOME/.ssh:/home/claude/.ssh:ro" \
  -w /home/claude/workspace \
  --network=host \
  claude claude-looper "Your goal here"

# Interactive shell inside the container
docker run --rm -it \
  -v "$(pwd):/home/claude/workspace" \
  -v "$HOME/.claude:/home/claude/.claude" \
  -w /home/claude/workspace \
  --network=host \
  claude bash
```

### Volume Mounts Explained

| Mount | Purpose |
|-------|---------|
| `-v "$(pwd):/home/claude/workspace"` | Your project directory - where code changes are made |
| `-v "$HOME/.claude:/home/claude/.claude"` | Claude API credentials and config (read-write for debug logs) |
| `-v "$HOME/.ssh:/home/claude/.ssh:ro"` | SSH keys for git operations (read-only, optional) |
| `-v "/tmp:/tmp"` | Shared temp directory for large file operations |

### API Key Configuration

Claude Looper uses the Claude Code CLI which expects credentials in `~/.claude/`. Before running:

1. **Install Claude Code locally** (if not already):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Authenticate** (creates `~/.claude/` config):
   ```bash
   claude
   # Follow the authentication prompts
   ```

3. **Run in Docker** - credentials are automatically mounted:
   ```bash
   claude-looper --docker "Your goal"
   ```

### What's Included in the Container

The Docker image is built on Ubuntu 24.04 and includes:

- **Node.js 20.x LTS** - For running Claude Looper
- **Python 3.12** - For Python projects
- **Go 1.22** - For Go projects
- **Build tools** - gcc, g++, make, cmake
- **Git** - For version control operations
- **Claude Code CLI** - Pre-installed globally
- **Claude Looper** - Pre-installed globally as `claude-looper`

### Container User and Permissions

The container runs as user `claude` (UID 1000) with sudo access. This UID matches typical Linux desktop users, making volume permissions seamless.

**Understanding UID 1000:**
- Most Linux distributions create the first user with UID 1000
- macOS users typically have UID 501 or 502
- When your host UID differs from 1000, you may see permission issues

**Checking your UID:**
```bash
id -u
# If output is 1000, you're all set
# If different, see permission fixes below
```

### Best Practices for Volume Mounting

**1. Use Absolute Paths for Reliability**
```bash
# Good - explicit absolute path
docker run -v /home/user/projects/myapp:/home/claude/workspace claude ...

# Good - $(pwd) expands to absolute path
docker run -v "$(pwd):/home/claude/workspace" claude ...

# Avoid - relative paths can cause issues
docker run -v ./myapp:/home/claude/workspace claude ...  # May not work
```

**2. Mount Credentials Read-Only When Possible**
```bash
# SSH keys should be read-only
-v "$HOME/.ssh:/home/claude/.ssh:ro"

# Claude credentials need read-write for session logs
-v "$HOME/.claude:/home/claude/.claude"
```

**3. Avoid Mounting Sensitive Directories**
```bash
# Never mount these
-v "/:/mnt"           # Root filesystem - dangerous
-v "$HOME:/home"      # Entire home directory - excessive
-v "/etc:/etc"        # System configs - dangerous

# Mount only what's needed
-v "$(pwd):/home/claude/workspace"
-v "$HOME/.claude:/home/claude/.claude"
```

**4. Use Consistent Working Directory**
```bash
# Always set -w to match the workspace mount
docker run -v "$(pwd):/home/claude/workspace" \
           -w /home/claude/workspace \
           claude ...
```

**5. Handle Git Configuration**
```bash
# If git commits fail, mount git config
docker run -v "$HOME/.gitconfig:/home/claude/.gitconfig:ro" \
           -v "$(pwd):/home/claude/workspace" \
           claude ...
```

### Performance Considerations

**File System Performance:**
- On macOS: Docker Desktop uses file sharing which can be slower for large projects
- On Linux: Native performance with bind mounts
- On Windows WSL2: Near-native performance

**Optimizing Large Projects:**
```bash
# Exclude node_modules by using .dockerignore or targeted mounts
# Instead of mounting entire project with heavy dependencies:

# Option 1: Install dependencies inside container
docker run ... claude bash -c "npm install && claude-looper 'Your goal'"

# Option 2: Use named volumes for node_modules
docker volume create myapp_node_modules
docker run -v myapp_node_modules:/home/claude/workspace/node_modules \
           -v "$(pwd):/home/claude/workspace" \
           claude ...
```

**Memory and CPU:**
```bash
# Limit resources if needed
docker run --memory=4g --cpus=2 \
           -v "$(pwd):/home/claude/workspace" \
           claude claude-looper "Your goal"
```

### CI/CD Integration

Claude Looper can be integrated into CI/CD pipelines for automated code tasks.

**GitHub Actions Example:**
```yaml
name: Claude Looper Task
on:
  workflow_dispatch:
    inputs:
      goal:
        description: 'Goal for Claude Looper'
        required: true
        type: string

jobs:
  run-claude:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Claude credentials
        run: |
          mkdir -p ~/.claude
          echo '${{ secrets.CLAUDE_CREDENTIALS }}' > ~/.claude/credentials.json

      - name: Run Claude Looper
        run: |
          docker run --rm \
            -v "${{ github.workspace }}:/home/claude/workspace" \
            -v "$HOME/.claude:/home/claude/.claude" \
            -w /home/claude/workspace \
            claude claude-looper --no-ui "${{ inputs.goal }}"

      - name: Commit changes
        run: |
          git config user.name "Claude Looper"
          git config user.email "claude@example.com"
          git add -A
          git diff --staged --quiet || git commit -m "Claude Looper: ${{ inputs.goal }}"
          git push
```

**GitLab CI Example:**
```yaml
claude-task:
  image: claude:latest
  script:
    - mkdir -p ~/.claude
    - echo "$CLAUDE_CREDENTIALS" > ~/.claude/credentials.json
    - claude-looper --no-ui "$GOAL"
  variables:
    GOAL: "Add input validation to API endpoints"
  only:
    - manual
```

**Jenkins Pipeline Example:**
```groovy
pipeline {
    agent {
        docker {
            image 'claude:latest'
            args '-v $HOME/.claude:/home/claude/.claude'
        }
    }
    parameters {
        string(name: 'GOAL', description: 'Goal for Claude Looper')
    }
    stages {
        stage('Run Claude Looper') {
            steps {
                sh 'claude-looper --no-ui "${GOAL}"'
            }
        }
    }
}
```

**Best Practices for CI/CD:**
1. Always use `--no-ui` flag in non-interactive environments
2. Store Claude credentials securely (secrets manager, vault)
3. Set appropriate timeouts for long-running workflows
4. Review Claude's changes before merging (use draft PRs)
5. Run in isolated environments to prevent credential leakage

### Troubleshooting Docker

**Permission denied on mounted files:**
```bash
# Check your UID
id -u

# If not 1000, fix ownership after container runs
sudo chown -R $(id -u):$(id -g) .

# Or run container with your UID (may have limitations)
docker run --user $(id -u):$(id -g) \
           -v "$(pwd):/home/claude/workspace" \
           claude ...
```

**Files created as root:**
```bash
# This happens when running without proper user mapping
# Fix with chown after the run
sudo chown -R $(id -u):$(id -g) .

# Prevent by ensuring container user matches host
# The default UID 1000 works for most Linux users
```

**Can't connect to Docker daemon:**
```bash
# Linux: Ensure Docker is running
sudo systemctl start docker

# Check if you're in the docker group
groups | grep docker

# Add yourself to docker group (logout required)
sudo usermod -aG docker $USER

# macOS/Windows: Launch Docker Desktop application
```

**Network connection failures:**
```bash
# If API calls fail, check network mode
# Use host networking for simplest setup
docker run --network=host ...

# For bridge networking, ensure DNS works
docker run --dns 8.8.8.8 ...
```

**API authentication errors:**
```bash
# Verify credentials exist on host
ls -la ~/.claude/

# Re-authenticate Claude Code
claude
# Follow prompts, then retry docker command

# Check credentials are mounted
docker run -v "$HOME/.claude:/home/claude/.claude" \
           claude ls -la /home/claude/.claude
```

**Container exits immediately:**
```bash
# Run with interactive terminal
docker run -it ...

# Check for errors in logs
docker logs <container_id>

# Debug with shell access
docker run -it --entrypoint bash claude
```

**Out of disk space:**
```bash
# Clean up Docker resources
docker system prune -a

# Remove unused volumes
docker volume prune

# Check available space
df -h
```

**Slow file operations (especially macOS):**
```bash
# Use delegated consistency for better performance
docker run -v "$(pwd):/home/claude/workspace:delegated" ...

# Consider using named volumes for heavy I/O directories
docker volume create app_cache
docker run -v app_cache:/home/claude/workspace/.cache ...
```

**Git operations fail:**
```bash
# Mount SSH keys for private repos
docker run -v "$HOME/.ssh:/home/claude/.ssh:ro" ...

# Mount git config for identity
docker run -v "$HOME/.gitconfig:/home/claude/.gitconfig:ro" ...

# For HTTPS repos, set credentials
docker run -e GIT_AUTHOR_NAME="Your Name" \
           -e GIT_AUTHOR_EMAIL="you@example.com" ...
```

**Claude CLI not found:**
```bash
# Verify the image has claude-looper installed
docker run claude which claude-looper

# If missing, rebuild the image
docker build --no-cache -t claude .
```

## 🧪 Testing

The project includes comprehensive test coverage using Node.js's built-in test runner.

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests with coverage thresholds
npm run test:coverage:check
```

### Test Coverage

| Module | Lines | Branches | Functions |
|--------|-------|----------|-----------|
| agent-core.js | 92% | 75% | 88% |
| agent-executor.js | 88% | 94% | 95% |
| orchestrator.js | 86% | 81% | 91% |
| agent-tester.js | 73% | 96% | 90% |
| agent-planner.js | 62% | 95% | 88% |
| agent-coder.js | 61% | 100% | 80% |
| agent-supervisor.js | 57% | 100% | 77% |
| **Overall** | **78%** | **90%** | **89%** |

### Test Organization

- **Unit tests**: Test individual agent classes (`agent-*.test.js`)
- **Integration tests**: Test end-to-end workflows (`integration.test.js`)
- **Orchestrator tests**: Test workflow phases (`orchestrator.test.js`)

For detailed testing documentation, see [TESTING.md](./TESTING.md).

## 🔧 Requirements

- Node.js >= 18.0.0
- Claude CLI installed and configured
- Docker (optional, for containerized execution)

## 📜 License

MIT
