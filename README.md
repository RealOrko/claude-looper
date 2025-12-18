# 🤖 Claude Autonomous Runner

🚀 Run Claude in continuous autonomous mode with intelligent planning, LLM-based supervision, and multi-layer verification. 🎯

## ✨ Features

- 🧠 **Intelligent Planning**: Opus-powered planner breaks down goals into executable steps
- 🔄 **Autonomous Execution**: Claude works continuously without user input
- 👁️ **LLM Supervision**: Sonnet-powered supervisor monitors progress and corrects drift
- ✅ **Step Verification**: Each step completion is verified before advancing
- 🔀 **Sub-plan Retry**: Blocked steps trigger alternative approach planning
- 🎯 **Final Verification**: Goal achievement verified with smoke tests
- 🐳 **Docker Support**: Run in isolated container with credential mounting

## 📦 Installation

⚡ Requires [Claude Code CLI](https://github.com/anthropics/claude-code) and an active Claude Max subscription.

```bash
# Clone the repository
git clone https://github.com/RealOrko/claude-looper.git
cd claude-looper

# Install dependencies
npm install

# Install globally
npm link
```

## 🚀 Usage

```bash
# Basic usage
claude-auto "Build a REST API for user management"

# With sub-goals and time limit
claude-auto -g "Build a todo app" \
  -s "Create the data model" \
  -s "Implement CRUD endpoints" \
  -s "Add authentication" \
  -t 4h

# With additional context
claude-auto "Fix the failing tests" -c "Focus on auth module" -t 1h

# Run in Docker container (recommended)
claude-auto --docker "Build a REST API" -t 4h

# Verbose mode (shows Claude's full output)
claude-auto -v "Refactor the codebase"
```

## 🐳 Docker Support

Run in an isolated container with your credentials automatically mounted:

```bash
# Build the Docker image (once)
npm run docker:build

# Run with --docker flag
claude-auto --docker "Your goal here" -t 4h
```

The container:
- 📁 Mounts your current directory to `/home/claude/workspace`
- 🔑 Mounts `~/.claude` for authentication
- 🛠️ Includes Python 3.12, Go 1.22, Node.js 20, and build tools

## ⚙️ CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--goal` | `-g` | Primary goal | - |
| `--sub-goal` | `-s` | Sub-goal (repeatable) | - |
| `--time-limit` | `-t` | Time limit (30m, 2h, 24h) | 2h |
| `--directory` | `-d` | Working directory | cwd |
| `--context` | `-c` | Additional context | - |
| `--verbose` | `-v` | Show full output | false |
| `--quiet` | `-q` | Minimal output | false |
| `--json` | `-j` | JSON output | false |
| `--docker` | - | Run in Docker container | false |

## 🔄 How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. 📋 Planning: Opus analyzes goal and creates execution steps     │
│  2. 🔍 Plan Review: Supervisor validates plan before execution      │
│  3. ⚡ Execution: Worker Claude executes steps autonomously         │
│  4. ✅ Step Verification: Each "STEP COMPLETE" claim is verified    │
│  5. 👁️ Supervision: Sonnet monitors progress, corrects drift        │
│  6. 🔀 Sub-plan Retry: Blocked steps trigger alternative approaches │
│  7. 🎯 Final Verification: Goal achievement + smoke tests           │
│  8. 🏁 Complete: Verified success, time expired, or aborted         │
└─────────────────────────────────────────────────────────────────────┘
```

## 🧠 Model Configuration

| Component | Model | Purpose |
|-----------|-------|---------|
| 📋 Planner | Opus | Creates execution plan from goal |
| ⚡ Worker | Opus | Executes steps autonomously |
| 👁️ Supervisor | Sonnet | Monitors progress, issues corrections |
| ✅ Step Verification | Sonnet | Validates step completion claims |
| 🔍 Plan Review | Sonnet | Validates plan before execution |
| 🎯 Goal Verification | Sonnet | Final goal achievement check |

## 🚨 Supervision & Escalation

The supervisor scores each response (0-100) for goal alignment and escalates when drift is detected:

| Level | Trigger | Action |
|-------|---------|--------|
| ✅ CONTINUE | Score 70+ | No intervention |
| 💭 REMIND | Score 50-69 | Gentle nudge |
| ⚠️ CORRECT | Score 30-49 or 2+ issues | Clear redirection |
| 🔄 REFOCUS | Score <30 or 3+ issues | Hard intervention |
| 🚨 CRITICAL | 4+ consecutive issues | Final warning |
| ❌ ABORT | 5+ consecutive issues | Session terminated |

## 🔐 Verification Layers

### ✅ Step Verification
When Claude claims "STEP COMPLETE", the supervisor verifies:
- 🔨 Concrete actions were taken (not just planning)
- 📄 Evidence the step's objective was achieved
- 📊 Actual output, file changes, or results

### 🔍 Completion Verification
When all steps complete, a 3-layer verification validates the claim:

1. 🧠 **LLM Challenge**: Claude must provide concrete evidence (files, code, commands)
2. 📁 **Artifact Inspection**: Verifies claimed files exist and aren't empty
3. 🧪 **Test Validation**: Runs test/build commands to validate the work

### 🎯 Final Goal Verification
After step completion, additional verification ensures:
- ✅ Original goal was achieved (not just steps completed)
- ⚡ Result is functional and complete
- 🧪 Smoke tests pass (npm test, pytest, go test, make test)

## 🔀 Sub-plan Retry

When a step is blocked, the planner creates an alternative approach:

```
❌ Step 3 blocked: "Cannot install dependency X"
  → 📋 Creating sub-plan with 3 alternative sub-steps
  → 1️⃣ Sub-step 1: Try alternative package Y
  → 2️⃣ Sub-step 2: Build from source
  → 3️⃣ Sub-step 3: Use Docker container
```

If the sub-plan also fails, the step is marked failed and execution continues. 💪

## 🏗️ Architecture

```
src/
├── cli-max.js               # 🚀 CLI entry point
├── autonomous-runner-cli.js # 🔄 Main execution loop
├── claude-code-client.js    # 🔌 Claude Code subprocess wrapper
├── supervisor.js            # 👁️ LLM-based assessment & escalation
├── completion-verifier.js   # ✅ Multi-layer verification system
├── planner.js               # 📋 Goal decomposition & sub-plans
├── goal-tracker.js          # 📊 Progress tracking
├── phase-manager.js         # ⏱️ Time & phase management
├── config.js                # ⚙️ Configuration
├── index.js                 # 📦 Module exports
└── ui/
    ├── ink-dashboard.js     # 🎨 React-based terminal UI
    ├── dashboard.js         # 📺 Alternative dashboard
    └── terminal.js          # 🖥️ Terminal utilities
```

## ⚙️ Configuration

Key settings in `src/config.js`:

```javascript
{
  // 🚨 Escalation thresholds (consecutive issues to trigger)
  escalationThresholds: {
    warn: 2,      // CORRECT
    intervene: 3, // REFOCUS
    critical: 4,  // Final warning
    abort: 5,     // Terminate
  },

  // ✅ Completion verification
  verification: {
    enabled: true,
    maxAttempts: 3,        // Max false claims before escalation
    requireArtifacts: true,
    runTests: true,
  },

  // ⏱️ Time management
  progressCheckInterval: 5 * 60 * 1000,  // 5 minutes
  stagnationThreshold: 15 * 60 * 1000,   // 15 minutes
}
```

## 💻 Programmatic Usage

```javascript
import { AutonomousRunnerCLI } from 'claude-autonomous-runner';

const runner = new AutonomousRunnerCLI({
  workingDirectory: '/path/to/project',
  onProgress: (data) => console.log('Progress:', data),
  onSupervision: (data) => console.log('Supervision:', data.assessment),
  onVerification: (data) => console.log('Verified:', data.passed),
  onComplete: (report) => console.log('Done:', report.status),
});

await runner.initialize({
  primaryGoal: 'Build a REST API',
  subGoals: ['Design schema', 'Implement endpoints', 'Add tests'],
  timeLimit: '2h',
});

const report = await runner.run();
// report.status: 'completed' | 'verification_failed' | 'time_expired' | 'aborted'
// report.finalVerification.overallPassed: true | false
```

## 📋 Requirements

- 📦 Node.js 18+
- 🤖 Claude Code CLI installed and authenticated
- 💳 Active Claude Max subscription
- 🐳 Docker (optional, for containerized execution)

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate (run once)
claude
```

## 📄 License

MIT ⚖️
