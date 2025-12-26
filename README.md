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
claude-looper "goal"      # Start new workflow
claude-looper --resume    # Resume interrupted workflow
claude-looper --status    # Check saved state
claude-looper --no-ui "goal"  # Run without terminal UI
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

## ⚙️ Configuration

Workflows are configured in `.claude-looper/configuration.json`:

```json
{
  "default-workflow": {
    "agents": {
      "supervisor": { "model": "opus", "subscribesTo": ["planner", "coder", "tester"] },
      "planner": { "model": "sonnet", "subscribesTo": ["supervisor", "coder", "tester"] },
      "coder": { "model": "opus", "subscribesTo": ["supervisor", "planner"] },
      "tester": { "model": "opus", "subscribesTo": ["supervisor", "planner"] }
    }
  }
}
```

## 🔧 Requirements

- Node.js >= 18.0.0
- Claude CLI installed and configured

## 📜 License

MIT
