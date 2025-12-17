# Claude Autonomous Runner

Run Claude in continuous autonomous mode with LLM-based supervision, escalation, and completion verification.

## Installation

Requires [Claude Code CLI](https://github.com/anthropics/claude-code) and an active Claude Max subscription.

```bash
# Clone the repository
git clone <repository-url>
cd claude-autonomous-runner

# Install dependencies
npm install

# Install globally (makes claude-auto available system-wide)
npm install -g .
```

## Usage

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

# Verbose mode (shows Claude's full output)
claude-auto -v "Refactor the codebase"

# Run in specific directory
claude-auto -d /path/to/project "Add dark mode support"
```

## CLI Options

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

## Features

### LLM-Based Supervision

A separate Claude session monitors the worker Claude's progress, scoring each response (0-100) for goal alignment.

### Escalation System

When Claude drifts off-task, the supervisor escalates through increasingly strict interventions:

| Level | Trigger | Action |
|-------|---------|--------|
| CONTINUE | Score 70+ | No intervention |
| REMIND | Score 50-69 | Gentle nudge |
| CORRECT | Score 30-49 or 2+ issues | Clear redirection |
| REFOCUS | Score <30 or 3+ issues | Hard intervention |
| CRITICAL | 4+ consecutive issues | Final warning |
| ABORT | 5+ consecutive issues | Session terminated |

### Completion Verification

When Claude claims "TASK COMPLETE", a 3-layer verification system validates the claim:

1. **LLM Challenge**: Claude must provide concrete evidence (files created, code written, test commands)
2. **Artifact Inspection**: Verifies claimed files exist and aren't empty
3. **Test Validation**: Runs test/build commands to validate the work

If verification fails, Claude receives a rejection prompt and must continue working.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. Initialize: Parse goals, start timer                    │
│  2. Claude works autonomously in a loop                     │
│  3. Supervisor scores each response for goal alignment      │
│  4. Escalate if Claude drifts (REMIND → CORRECT → ABORT)    │
│  5. When Claude claims completion, verify with 3 layers     │
│  6. Stop when: verified complete, time expires, or aborted  │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Key settings in `src/config.js`:

```javascript
{
  // Escalation thresholds (consecutive issues to trigger)
  escalationThresholds: {
    warn: 2,      // CORRECT
    intervene: 3, // REFOCUS
    critical: 4,  // Final warning
    abort: 5,     // Terminate
  },

  // Completion verification
  verification: {
    enabled: true,
    maxAttempts: 3,        // Max false claims before escalation
    requireArtifacts: true,
    runTests: true,
    testCommands: ['npm test', 'pytest', 'go test ./...', 'cargo test'],
  },

  // Time management
  progressCheckInterval: 5 * 60 * 1000,  // 5 minutes
  stagnationThreshold: 15 * 60 * 1000,   // 15 minutes
}
```

## Programmatic Usage

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
// report.status: 'completed' | 'time_expired' | 'aborted' | 'stopped'
// report.verification.finalStatus: 'verified' | 'unverified'
```

## Architecture

```
src/
├── cli-max.js              # CLI entry point
├── autonomous-runner-cli.js # Main execution loop
├── claude-code-client.js    # Claude Code subprocess wrapper
├── supervisor.js            # LLM-based assessment & escalation
├── completion-verifier.js   # 3-layer verification system
├── goal-tracker.js          # Progress tracking
├── phase-manager.js         # Time & phase management
├── planner.js               # Goal decomposition
├── config.js                # Configuration
└── index.js                 # Module exports
```

## Output Example

```
╔════════════════════════════════════════════════════════════════╗
║     CLAUDE AUTONOMOUS RUNNER (Max Subscription Edition)        ║
╚════════════════════════════════════════════════════════════════╝

Goal: Build a REST API for user management
Time Limit: 2h

▶ Starting autonomous execution...

[████████████████████░░░░░░░░░░] 65% | Iteration 15 | 48m remaining

┌─────────────────────────────────────────────────────────────────┐
│                  COMPLETION VERIFICATION                        │
└─────────────────────────────────────────────────────────────────┘
  Layer 1 (LLM Challenge): ✓ PASSED
  Layer 2 (Artifacts): ✓ PASSED
  Layer 3 (Validation): ✓ PASSED

  ✓ VERIFIED - Completion accepted

╔════════════════════════════════════════════════════════════════╗
║                     EXECUTION COMPLETE                         ║
╚════════════════════════════════════════════════════════════════╝

Status: COMPLETED
Progress: 100%
Time Used: 1h 12m (60% of limit)

Supervision Stats:
  Assessments: 15
  Corrections issued: 1
  Average score: 85/100

Verification:
  Final status: VERIFIED
```

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated
- Active Claude Max subscription

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Authenticate (run once)
claude
```

## License

MIT
