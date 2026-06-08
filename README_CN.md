# Claude HUD

> [🇬🇧 English](README.md)

VS Code 侧边栏中的 Claude Code **H**eads-**U**p **D**isplay（实时监控面板）。

实时查看 Token 用量、上下文窗口、Agent 状态和历史记录，无需终端，直接在活动栏中呈现。

![Claude HUD](media/icon.png)

---

## 功能特性

- **Token 流量** — 矩阵雨 / K 线 / 轨迹球实时展示 Token 速率
- **上下文窗口** — 进度条一目了然，当前用量 vs 上限
- **Token 明细** — 输入/输出 Token 按比例拆分展示
- **Agent 状态** — 多 Agent 树形结构，含任务、进度和 Token 统计
- **历史图表** — 24 小时或 7 天的 Token 走势
- **计划模式徽章** — 显示 Claude 是否处于计划模式
- **拖拽排序** — 按偏好调整模块顺序
- **自动主题** — 跟随 VS Code 亮色/暗色主题

## 环境要求

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (VS Code 扩展)
- VS Code 1.90+

## 使用方法

1. 点击活动栏（左侧边栏）中的 **Claude HUD** 图标
2. 面板会在 Claude Code 运行时实时展示各项指标
3. 点击**眼睛图标** (◈) 切换模块可见性
4. 拖拽模块标题进行排序

### 配置

通过 `settings.json` 中的 `claudeHud.modules` 开关各模块：

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

## 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npx tsc -p ./

# 启动 VS Code 扩展宿主 (F5)
```

### 项目结构

```
claude-hud/
├── src/
│   ├── extension.ts         # 入口
│   ├── hudPanel.ts          # WebviewViewProvider / Webview 面板
│   ├── dataProvider.ts      # 数据源（JSONL 解析）
│   ├── statusBar.ts         # 状态栏
│   ├── historyStore.ts      # Token 历史持久化
│   ├── configManager.ts     # 模块配置管理
│   ├── types.ts             # 共享类型
│   └── webview/
│       ├── script.js        # 前端渲染
│       └── styles.css       # 样式
├── media/icon.svg           # 扩展图标
└── package.json
```

## 致谢

本项目参考并改编了 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) 中的部分处理逻辑，感谢原作者带来的启发。

## 许可

MIT
