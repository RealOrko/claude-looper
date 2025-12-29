# 🔄 Claude Looper

> 🤖 Multi-agent framework for autonomous software development using Claude

## ✨ Features

- 🧠 **4 Specialized Agents** — Planner, Coder, Tester, Supervisor
- 📡 **Event-Driven** — Agents communicate via state changes
- 💾 **Persistent State** — Snapshot and resume anytime
- 🖥️ **Terminal UI** — Real-time progress visualization

## 🚀 Quick Start

```bash
npm install
node cli.js "Add user authentication"

# Or install globally
npm link
claude-looper "Your goal here"
```

## 📋 Commands

```bash
claude-looper "goal"           # 🆕 Start new workflow
claude-looper --resume         # ▶️  Resume interrupted workflow
claude-looper --status         # 📊 Check saved state
claude-looper --no-ui "goal"   # 🔇 Run without terminal UI
claude-looper --docker "goal"  # 🐳 Run in Docker container
```

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐
│  📝 Planner │────▶│  💻 Coder   │
└─────────────┘     └─────────────┘
       │                   │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│ 👁️ Supervisor│◀────│  🧪 Tester  │
└─────────────┘     └─────────────┘
```

| Agent | Role | Model |
|-------|------|-------|
| 📝 Planner | Breaks goals into tasks | Sonnet |
| 💻 Coder | Implements tasks | Opus |
| 🧪 Tester | Validates implementations | Opus |
| 👁️ Supervisor | Reviews and approves | Opus |

## 📁 Project Structure

```
├── cli.js                      # 🚀 CLI entry point
├── agent-core.js               # 🧠 Event-driven state management
├── agent-executor.js           # ⚡ Claude CLI execution
├── agent-planner.js            # 📝 Task planning
├── agent-coder.js              # 💻 Implementation
├── agent-tester.js             # 🧪 Testing
├── agent-supervisor.js         # 👁️ Quality verification
├── orchestrator.js             # 🎯 Workflow coordination
├── terminal-ui-multiview.js    # 🖥️ Blessed-based UI
└── templates/                  # 📄 Handlebars prompts
```

## ⚙️ Configuration

Config lives in `.claude-looper/default-workflow.json`:

```json
{
  "agents": {
    "supervisor": { "model": "opus", "subscribesTo": ["planner", "coder", "tester"] },
    "planner": { "model": "sonnet", "settings": { "maxTasks": 15 } },
    "coder": { "model": "opus", "settings": { "maxFixCycles": 3 } },
    "tester": { "model": "opus", "settings": { "requireTests": true } }
  },
  "execution": {
    "phases": ["planning", "plan_review", "execution", "verification"],
    "maxStepAttempts": 3,
    "timeLimit": 7200000
  }
}
```

## 💾 Resume Workflows

State auto-saves to `.claude-looper/state.json`. Resume anytime:

```bash
claude-looper --status   # 📊 See what can be resumed
claude-looper --resume   # ▶️  Continue where you left off
```

## 🐳 Docker

```bash
# Build image
npm run docker

# Run in container
claude-looper --docker "Your goal"

# Or manually
docker run --rm -it \
  -v "$(pwd):/home/claude/workspace" \
  -v "$HOME/.claude:/home/claude/.claude" \
  --network=host \
  claude claude-looper "Your goal"
```

## 🧪 Testing

```bash
npm test                    # 🏃 Run all tests
npm run test:coverage       # 📊 With coverage report
npm run test:coverage:check # ✅ With thresholds
```

See [TESTING.md](./TESTING.md) for details.

## 🔧 Requirements

- 📦 Node.js >= 18.0.0
- 🤖 Claude CLI installed and authenticated
- 🐳 Docker (optional)

## 📜 License

MIT
