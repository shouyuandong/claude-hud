# Claude HUD

> **English** · [中文](README_CN.md)

A **H**eads-**U**p **D**isplay for Claude Code in VS Code sidebar.

Real-time visibility into token usage, context window, agent status, and history — all from the Activity Bar, no terminal needed.

![Claude HUD](media/icon.png)

---

## Features

- **Token Flow** — Matrix rain / candlestick / tracer-ball visualization of real-time token rate
- **Context Window** — At-a-glance progress bar showing current vs limit
- **Token Usage** — IN/OUT token breakdown with proportional bar
- **Agent Status** — Multi-agent tree with tasks, progress, and token counts
- **History Chart** — Token usage over 24h or 7d
- **Plan Mode Badge** — Shows when Claude is in Plan Mode
- **Drag & Reorder** — Move modules to your preferred order
- **Auto Theme** — Matches VS Code color theme (light / dark)

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (VS Code extension)
- VS Code 1.90+

## Usage

1. Click the **Claude HUD** icon in the Activity Bar (left sidebar)
2. The panel shows real-time metrics while Claude Code is active
3. Click the **eye icon** (◈) to toggle module visibility
4. Drag module headers to reorder

### Configuration

Toggle individual modules via `claudeHud.modules` in settings.json:

```json
{
  "claudeHud.modules": {
    "tokenFlow": true,
    "contextWindow": true,
    "tokenUsage": true,
    "agentStatus": true,
    "historyChart": true,
    "sessionTime": true
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npx tsc -p ./

# Launch VS Code extension host (F5)
```

### Project Structure

```
claude-hud/
├── src/
│   ├── extension.ts         # Entry point
│   ├── hudPanel.ts          # WebviewViewProvider
│   ├── dataProvider.ts      # Data source (JSONL parsing)
│   ├── statusBar.ts         # Status bar item
│   ├── historyStore.ts      # Token history persistence
│   ├── configManager.ts     # Module config management
│   ├── types.ts             # Shared types
│   └── webview/
│       ├── script.js         # Frontend rendering
│       └── styles.css        # Styling
├── media/icon.svg            # Extension icon
└── package.json
```

## Acknowledgements

This project references and adapts processing logic from [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud). Thanks to the original author for the inspiration.

## License

MIT
