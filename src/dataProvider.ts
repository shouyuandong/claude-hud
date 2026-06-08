import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HUDData, AgentStatus, HourlyTokenData, DailyTokenData, CandleData, ConfigCounts, TodoItem, PricingOverride } from './types';
import { ConfigManager } from './configManager';

/**
 * Real data provider that reads Claude Code session & conversation files
 * to extract actual token usage, agent status, and context data.
 *
 * File layout:
 *   ~/.claude/sessions/<pid>.json              — session metadata
 *   ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl  — conversation log
 *   ~/.claude/projects/<sanitized-cwd>/<sessionId>/subagents/  — subagent logs
 *   ~/.claude/ide/<pid>.lock                   — IDE connection info
 */

interface JsonlUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface JsonlAssistant {
  type: 'assistant';
  message?: {
    usage?: JsonlUsage;
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    model?: string;
  };
  timestamp?: string;
}

interface JsonlUser {
  type: 'user';
  message?: { content?: Array<{ type: string; text?: string }> };
  timestamp?: string;
}

interface ParsedSession {
  sessionId: string;
  cwd: string;
  projectDir: string;
  jsonlPath: string;
  startedAt: number;
  isActive: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheHitTokens: number;
  totalCacheWriteTokens: number;
  lastTask: string;
  lastActivity: number;
  lastTimestamp: number;
  agentList: AgentStatus[];
  currentTool: string;
  currentToolFile: string;
  // Tool & todo tracking
  toolActivity: Map<string, { count: number; lastUsed: number; lastFile?: string; agentCalls: Map<string, number> }>;
  todoItems: TodoItem[];
  // File tracking for incremental reads
  knownSize: number;
  knownLines: number;
}

export class DataProvider {
  private sessions: ParsedSession[] = [];
  private cwd = process.cwd();

  // Derived burst-rate state (same interface as before)
  private burstRate = 0;
  private burstHistory: number[] = [];
  private sessionTime = 0;
  private tickCount = 0;

  // Candlestick tracking
  private candleOpen = 0;
  private candleHigh = 0;
  private candleLow = 0;
  private candleClose = 0;
  private candleTicks = 0;
  private candleIndex = 0; // deterministic noise phase
  private candleHistory: CandleData[] = [];
  private readonly CANDLE_TICK_WINDOW = 20;
  private toolActiveDuringCandle = false;
  private candleSignalFlag = false; // alternate buy/sell
  private candleBaseline = 0;
  private readonly CANDLE_AMPLIFY = 10; // amplify burstRate deviations for visual drama

  // Token rate tracking
  private previousTokenTotal = 0;
  private tokenRateSamples: number[] = [];

  // Hourly / daily history (aggregated from real data)
  private hourlyHistory: HourlyTokenData[] = [];
  private dailyHistory: DailyTokenData[] = [];

  // Token totals
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheTokens = 0;
  private totalCacheHitTokens = 0;
  private totalCacheWriteTokens = 0;
  private tokenLimit = 200000;
  private isAnthropicModel = true; // distinguishes Anthropic from DeepSeek/Gemini API conventions
  private detectedModelName = '';  // actual model string from JSONL

  // ---- Pricing (USD per 1M tokens) ----
  private static readonly MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
    // Claude 4.x
    'claude-opus-4':       { input: 15,   output: 75,  cacheRead: 1.50, cacheWrite: 18.75 },
    'claude-sonnet-4':     { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
    'claude-haiku-4':      { input: 1,    output: 5,   cacheRead: 0.10, cacheWrite: 1.25 },
    // Claude 3.5
    'claude-sonnet-3-5':   { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
    'claude-haiku-3-5':    { input: 0.80, output: 4,   cacheRead: 0.08, cacheWrite: 1.00 },
    'claude-opus-3-5':     { input: 15,   output: 75,  cacheRead: 1.50, cacheWrite: 18.75 },
    // Claude 3
    'claude-opus-3':       { input: 15,   output: 75,  cacheRead: 1.50, cacheWrite: 18.75 },
    'claude-sonnet-3':     { input: 3,    output: 15,  cacheRead: 0.30, cacheWrite: 3.75 },
    'claude-haiku-3':      { input: 1,    output: 5,   cacheRead: 0.10, cacheWrite: 1.25 },
    // DeepSeek
    'deepseek-v4-flash':   { input: 0.15, output: 0.60, cacheRead: 0.015, cacheWrite: 0.15 },
    'deepseek-v3':         { input: 0.27, output: 1.10, cacheRead: 0.027, cacheWrite: 0.27 },
    'deepseek-r1':         { input: 0.55, output: 2.19, cacheRead: 0.055, cacheWrite: 0.55 },
    // Gemini
    'gemini-2-5':          { input: 1.25, output: 10,   cacheRead: 0.03,  cacheWrite: 1.25 },
    'gemini-2-0':          { input: 0.10, output: 0.40, cacheRead: 0.025, cacheWrite: 0.10 },
  };

  // Known model context windows (comprehensive)
  private static readonly MODEL_LIMITS: Record<string, number> = {
    // Claude 4.x — 200K
    'claude-opus-4-8': 200000,
    'claude-opus-4-7': 200000,
    'claude-opus-4-6': 200000,
    'claude-opus-4-5': 200000,
    'claude-opus-4': 200000,
    'claude-sonnet-4-8': 200000,
    'claude-sonnet-4-7': 200000,
    'claude-sonnet-4-6': 200000,
    'claude-sonnet-4-5': 200000,
    'claude-sonnet-4': 200000,
    'claude-haiku-4-5-20251001': 200000,
    'claude-haiku-4': 200000,
    // Claude 3.5 — 200K
    'claude-sonnet-3-5': 200000,
    'claude-sonnet-3-5-20241022': 200000,
    'claude-sonnet-3-5-20240620': 200000,
    'claude-haiku-3-5': 200000,
    'claude-haiku-3-5-20241022': 200000,
    'claude-opus-3-5': 200000,
    // Claude 3 — 200K
    'claude-opus-3': 200000,
    'claude-sonnet-3': 200000,
    'claude-haiku-3': 200000,
    // DeepSeek — 1M
    'deepseek-v4-flash': 1000000,
    'deepseek-v3': 1000000,
    'deepseek-r1': 1000000,
    // Gemini — 1M+
    'gemini-2-5': 1000000,
    'gemini-2-0': 1000000,
    // Generic fallback keys (used by some providers)
    'claude': 200000,
    'opusi': 200000,
    'sonnet': 200000,
    'haiku': 200000,
    'deepseek': 1000000,
  };

  // Current Plan Mode status
  private planMode = false;

  // Current context estimate (what's actually in the active window, not the session total)
  private currentContextTokens = 0;

  // File watcher interval
  private watchInterval: ReturnType<typeof setInterval> | undefined;

  private readonly claudeDir: string;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.discoverSessions();
  }

  init(hourly: HourlyTokenData[], daily: DailyTokenData[]): void {
    this.hourlyHistory = hourly;
    this.dailyHistory = daily;
  }

  /**
   * Scan ~/.claude/sessions/ and ~/.claude/projects/ to discover active sessions.
   */
  private discoverSessions(): void {
    const sessionsDir = path.join(this.claudeDir, 'sessions');
    const projectsDir = path.join(this.claudeDir, 'projects');

    if (!fs.existsSync(sessionsDir)) return;

    try {
      const sessionFiles = fs.readdirSync(sessionsDir);

      for (const sf of sessionFiles) {
        if (!sf.endsWith('.json')) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, sf), 'utf8'));
          const sessionId: string = raw.sessionId || '';
          const sessionCwd: string = raw.cwd || '';
          const startedAt: number = raw.startedAt || 0;
          const pid: number = raw.pid || 0;

          // Check if PID is still alive (session is active)
          let isActive = false;
          try {
            // On Windows, process.kill with signal 0 checks existence
            process.kill(pid, 0);
            isActive = true;
          } catch {
            isActive = false;
          }

          // Find matching project directory
          const projectName = this.cwdToProjectName(sessionCwd);
          const projectDir = path.join(projectsDir, projectName);
          const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);

          if (!fs.existsSync(jsonlPath)) {
            // Try direct lookup
            continue;
          }

          // Defer full JSONL parsing to first tick — just discover the session path.
          // This saves ~1-3 full file reads on extension activation.
          this.sessions.push({
            sessionId,
            cwd: sessionCwd,
            projectDir,
            jsonlPath,
            startedAt,
            isActive,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheHitTokens: 0,
            totalCacheWriteTokens: 0,
            lastTask: 'Idle',
            lastActivity: 0,
            lastTimestamp: 0,
            currentTool: '',
            currentToolFile: '',
            agentList: [],
            toolActivity: new Map<string, { count: number; lastUsed: number; lastFile?: string; agentCalls: Map<string, number> }>(),
            todoItems: [],
            knownSize: 0, // 0 triggers full incremental read on first tick
            knownLines: 0,
          });
        } catch {
          // Skip malformed files
        }
      }

      // FALLBACK: If no sessions were discovered (all PIDs dead),
      // find the most recently modified JSONL for the current project.
      if (this.sessions.length === 0) {
        this.addFallbackSession(projectsDir);
      }
    } catch {
      // Ignore directory read errors
    }
  }

  /**
   * Fallback: when no sessions have alive PIDs, find the most recent JSONL
   * for the current working directory and create a synthetic session.
   * This handles the case where VS Code reconnects to a Claude process
   * whose PID doesn't match the session file.
   */
  private addFallbackSession(projectsDir: string): void {
    const currentProjectName = this.cwdToProjectName(this.cwd);
    const projectDir = path.join(projectsDir, currentProjectName);
    if (!fs.existsSync(projectDir)) return;

    try {
      // Find the most recently modified .jsonl file in this project directory
      const files = fs.readdirSync(projectDir);
      const jsonlFiles = files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          fullPath: path.join(projectDir, f),
          mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (jsonlFiles.length === 0) return;

      const latest = jsonlFiles[0];
      const sessionId = latest.name.replace('.jsonl', '');
      const jsonlPath = latest.fullPath;

      // Try to find matching session metadata in ~/.claude/sessions/
      let startedAt = Date.now();
      const sessionsDir = path.join(this.claudeDir, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const sessionFiles = fs.readdirSync(sessionsDir);
        for (const sf of sessionFiles) {
          if (!sf.endsWith('.json')) continue;
          try {
            const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, sf), 'utf8'));
            if (raw.sessionId === sessionId) {
              startedAt = raw.startedAt || Date.now();
              break;
            }
          } catch { /* skip malformed */ }
        }
      }

      // Defer parsing to first tick
      this.sessions.push({
        sessionId,
        cwd: this.cwd,
        projectDir,
        jsonlPath,
        startedAt,
        isActive: true, // Assume active since we found a recent JSONL
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheHitTokens: 0,
        totalCacheWriteTokens: 0,
        lastTask: 'Idle',
        lastActivity: 0,
        lastTimestamp: 0,
        agentList: [],
        toolActivity: new Map<string, { count: number; lastUsed: number; lastFile?: string; agentCalls: Map<string, number> }>(),
        todoItems: [],
        knownSize: 0, // 0 triggers full read on first tick
        knownLines: 0,
        currentTool: '',
        currentToolFile: '',
      });
    } catch {
      // Fallback failed silently
    }
  }

  /**
   * Sanitize a cwd path to match Claude's project folder naming convention.
   * e.g., D:\shouyuan.dong\Workspace\Claude-HUD → d--shouyuan-dong-Workspace-Claude-HUD
   */
  private cwdToProjectName(cwdPath: string): string {
    let name = cwdPath
      .replace(/\\/g, '/')             // normalize separators
      .replace(/[^a-zA-Z0-9/]/g, '-') // replace special chars (: , .) with -
      .replace(/[/]+/g, '-')           // collapse slashes to single dash
      // NOTE: do NOT collapse multiple dashes — Claude preserves `--` for
      // colon & dot separators (e.g. `d--shouyuan-dong-Workspace-Repo-Sync`)
      .replace(/^-|-$/g, '');          // trim leading/trailing dashes
    return name.toLowerCase();
  }

  /**
   * Parse a JSONL conversation file, extracting token usage, task name, and subagents.
   */
  private parseJsonlFile(
    filePath: string,
    _cwdPath: string,
    _startedAt: number,
    sessionId: string,
  ): { inputTokens: number; outputTokens: number; cacheHitTokens: number; cacheWriteTokens: number; lastTask: string; lastActivity: number; lastTimestamp: number; agents: AgentStatus[]; lineCount: number; toolActivity: Map<string, { count: number; lastUsed: number; lastFile?: string; agentCalls: Map<string, number> }>; todoItems: TodoItem[] } {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheHitTokens = 0;
    let cacheWriteTokens = 0;
    let lastTask = 'Idle';
    let lastActivity = 0;
    let lastTimestamp = 0;
    let lineCount = 0;
    let lastToolName = '';       // track most recent tool_use in this file
    let lastToolFile = '';
    const toolActivity = new Map<string, { count: number; lastUsed: number; lastFile?: string; agentCalls: Map<string, number> }>();
    const todoItems: TodoItem[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      lineCount = lines.length;

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);

          if (obj.type === 'assistant' && obj.message?.usage) {
            const u = obj.message.usage;
            inputTokens += u.input_tokens || 0;
            outputTokens += u.output_tokens || 0;
            cacheHitTokens += u.cache_read_input_tokens || 0;
            cacheWriteTokens += u.cache_creation_input_tokens || 0;
            lastActivity = Date.now();
            if (obj.timestamp) {
              lastTimestamp = new Date(obj.timestamp).getTime();
            }
          }

          // Extract tool_use blocks from assistant message content
          if (obj.type === 'assistant' && obj.message?.content) {
            // Clear current tool — will be re-set if tool_use found below
            lastToolName = '';
            lastToolFile = '';
            const content = Array.isArray(obj.message.content) ? obj.message.content : [];
            for (const block of content) {
              if (block.type === 'tool_use' && block.name) {
                const toolName = block.name;
                const existing = toolActivity.get(toolName);
                const now = Date.now();
                const input = block.input as Record<string, unknown> | undefined;
                const filePath = typeof input?.file_path === 'string' ? input.file_path
                  : typeof input?.path === 'string' ? input.path
                  : typeof input?.file === 'string' ? input.file
                  : undefined;
                // For Bash, store the command instead of file path
                const bashCommand = toolName === 'Bash' && typeof input?.command === 'string'
                  ? input.command : undefined;
                if (existing) {
                  existing.count++;
                  existing.lastUsed = now;
                  if (filePath) existing.lastFile = filePath;
                  // Track main agent call
                  const agentCount = existing.agentCalls.get('Main Agent') || 0;
                  existing.agentCalls.set('Main Agent', agentCount + 1);
                } else {
                  const agentCalls = new Map<string, number>();
                  agentCalls.set('Main Agent', 1);
                  toolActivity.set(toolName, { count: 1, lastUsed: now, lastFile: filePath, agentCalls });
                }
                lastToolName = toolName;
                lastToolFile = bashCommand || filePath || '';

                // Extract todos from TodoWrite tool calls — authoritative full state
                if (toolName === 'TodoWrite' && input) {
                  todoItems.length = 0;
                  const todos = Array.isArray(input.todos) ? input.todos : [];
                  for (const todo of todos) {
                    const content = typeof todo.content === 'string' ? todo.content : '';
                    const statusRaw = typeof todo.status === 'string' ? todo.status : 'pending';
                    const status = statusRaw === 'completed' ? 'completed' : statusRaw === 'in_progress' ? 'in_progress' : 'pending';
                    if (!content) continue;
                    todoItems.push({ description: content, status, file: undefined, agentId: 'main' });
                  }
                }
              }
            }
          }

          if (obj.type === 'user' && obj.message?.content) {
            const texts = obj.message.content
              .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
              .map((c: { type: string; text?: string }) => c.text || '');
            if (texts.length > 0) {
              // Use first text content as task name, truncated
              const fullText = texts.join(' ');
              lastTask = fullText.length > 80 ? fullText.substring(0, 77) + '...' : fullText;
            }
            if (obj.timestamp) {
              const ts = new Date(obj.timestamp).getTime();
              if (ts > lastTimestamp) lastTimestamp = ts;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // File may not exist or be unreadable
    }

    // Discover subagents
    const { agents, todos: subTodos } = this.discoverSubAgents(filePath, sessionId, inputTokens + outputTokens);

    // Merge subagent todos (dedup by description)
    const mainTodoDescs = new Set(todoItems.map(t => t.description));
    for (const st of subTodos) {
      if (!mainTodoDescs.has(st.description)) {
        todoItems.push(st);
        mainTodoDescs.add(st.description);
      }
    }

    // Add main agent
    const mainAgent: AgentStatus = {
      id: 'main',
      name: 'Main Agent',
      type: 'main',
      status: lastActivity > 0 ? 'working' : 'idle',
      taskName: lastTask,
      progress: 0,
      tokensUsed: inputTokens + outputTokens,
      currentTool: lastToolName || undefined,
      currentToolFile: lastToolFile || undefined,
    };
    agents.unshift(mainAgent);

    return {
      inputTokens,
      outputTokens,
      cacheHitTokens,
      cacheWriteTokens,
      lastTask,
      lastActivity: lastActivity || Date.now(),
      lastTimestamp,
      agents,
      lineCount,
      toolActivity,
      todoItems,
    };
  }

  /**
   * Scan the entire JSONL for the model name and set tokenLimit accordingly.
   * Starts from the end (most recent messages) and walks backwards,
   * so the latest model declaration wins. Caches once found so subsequent
   * calls are no-ops.
   */
  private detectModelFromJsonl(jsonlPath: string, force = false): void {
    if (this.tokenLimit !== 200000 && !force) return; // already detected
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      // Walk backwards — most recent model declaration is most accurate
      for (let i = lines.length - 1; i >= 0; i--) {
        const obj = JSON.parse(lines[i]);

        // Try message.model first (standard format)
        const modelName = obj.message?.model || obj.tool_use?.input?.model;
        if (modelName && typeof modelName === 'string') {
          // Exact match
          if (DataProvider.MODEL_LIMITS[modelName]) {
            this.tokenLimit = DataProvider.MODEL_LIMITS[modelName];
            this.isAnthropicModel = modelName.startsWith('claude-') || modelName.startsWith('claude');
            this.detectedModelName = modelName;
            return;
          }
          // Prefix match: "claude-sonnet-4-6-20250514" → match "claude-sonnet-4-6"
          const sortedKeys = Object.keys(DataProvider.MODEL_LIMITS).sort((a, b) => b.length - a.length);
          for (const key of sortedKeys) {
            if (modelName.startsWith(key)) {
              this.tokenLimit = DataProvider.MODEL_LIMITS[key];
              this.isAnthropicModel = key.startsWith('claude');
              this.detectedModelName = modelName;
              return;
            }
          }
        }
      }
    } catch {
      // best effort — keep current limit
    }
  }

  /**
   * Detect whether Claude is currently in Plan Mode by scanning the JSONL
   * backwards for plan_mode / plan_mode_exit / plan_mode_reentry attachment entries.
   */
  private detectPlanModeFromJsonl(jsonlPath: string): boolean {
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n').filter((l: string) => l.trim());

      // Scan backwards to find the most recent plan mode entry
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.type === 'attachment' && obj.attachment?.type) {
            const attachType: string = obj.attachment.type;
            if (attachType === 'plan_mode' || attachType === 'plan_mode_reentry') {
              return true;
            }
            if (attachType === 'plan_mode_exit') {
              return false;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file read error
    }
    return false;
  }

  /**
   * Read subagent data from the session's subagents directory.
   */
  private discoverSubAgents(
    jsonlPath: string,
    sessionId: string,
    _totalTokens: number,
  ): { agents: AgentStatus[]; todos: TodoItem[] } {
    const baseDir = path.dirname(jsonlPath);
    const sessionDir = path.join(baseDir, sessionId);
    const subagentsDir = path.join(sessionDir, 'subagents');
    const agents: AgentStatus[] = [];
    const todos: TodoItem[] = [];

    if (!fs.existsSync(subagentsDir)) return { agents, todos };

    try {
      const files = fs.readdirSync(subagentsDir);
      const agentFiles = files.filter((f: string) => f.endsWith('.jsonl') && f.startsWith('agent-'));

      // First pass: collect all agent info and count per type
      const raw: Array<{
        agentId: string;
        agentType: string;
        description: string;
        agentTokens: number;
        agentStatus: 'idle' | 'thinking' | 'working' | 'done' | 'error';
        agentTask: string;
        subToolName: string;
        subToolFile: string;
        agentTodos: TodoItem[];
      }> = [];

      for (const af of agentFiles) {
        try {
          const agentId = af.replace('.jsonl', '');
          const metaPath = path.join(subagentsDir, agentId + '.meta.json');
          let agentType = 'sub';
          let description = '';

          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              agentType = meta.agentType || 'sub';
              description = meta.description || '';
            } catch {
              // ignore
            }
          }

          // Read the agent JSONL to get last status and token usage
          const agentContent = fs.readFileSync(path.join(subagentsDir, af), 'utf8');
          const lines = agentContent.split('\n').filter(l => l.trim());

          let agentTokens = 0;
          let agentStatus: 'idle' | 'thinking' | 'working' | 'done' | 'error' = 'idle';
          let agentTask = description || 'sub-task';
          let lastAssistantIsError = false;
          let lastAssistantStopReason = '';
          let lastAssistantHasToolUse = false;
          let subToolName = '';
          let subToolFile = '';
          const agentTodos: TodoItem[] = [];

          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === 'assistant') {
                // Track error signals
                if (obj.isApiErrorMessage || obj.error) {
                  lastAssistantIsError = true;
                }
                // Track stop reason
                if (obj.message?.stop_reason) {
                  lastAssistantStopReason = obj.message.stop_reason;
                }
                // Detect tool_use blocks (agent still working)
                const content = obj.message?.content ?? [];
                lastAssistantHasToolUse = Array.isArray(content) && content.some((c: any) => c.type === 'tool_use');

                // Extract last tool_use for this agent
                if (Array.isArray(content)) {
                  for (const c of content) {
                    if (c.type === 'tool_use' && c.name) {
                      subToolName = c.name;
                      const input = c.input as Record<string, unknown> | undefined;
                      subToolFile = typeof input?.file_path === 'string' ? input.file_path
                        : typeof input?.path === 'string' ? input.path
                        : typeof input?.file === 'string' ? input.file
                        : '';
                    }

                    // Extract todos from TodoWrite tool calls
                    if (c.name === 'TodoWrite' && c.input) {
                      const todoInput = c.input as Record<string, unknown> | undefined;
                      agentTodos.length = 0;
                      const todoList = Array.isArray(todoInput?.todos) ? todoInput.todos : [];
                      for (const todo of todoList) {
                        const todoContent = typeof todo.content === 'string' ? todo.content : '';
                        const statusRaw = typeof todo.status === 'string' ? todo.status : 'pending';
                        const status = statusRaw === 'completed' ? 'completed' : statusRaw === 'in_progress' ? 'in_progress' : 'pending';
                        if (!todoContent) continue;
                        agentTodos.push({ description: todoContent, status, file: undefined });
                      }
                    }
                  }
                }

                // Accumulate tokens
                if (obj.message?.usage) {
                  agentTokens += (obj.message.usage.output_tokens || 0);
                }
              }
              if (obj.type === 'user' && obj.message?.content?.[0]?.text) {
                agentTask = obj.message.content[0].text.substring(0, 60);
              }
            } catch {
              // ignore
            }
          }

          // Determine final status based on last assistant message
          if (lastAssistantIsError) {
            agentStatus = 'error';
          } else if (lastAssistantHasToolUse) {
            agentStatus = 'working';
          } else if (agentTokens > 0) {
            agentStatus = 'done';
          } else {
            agentStatus = 'idle';
          }

          raw.push({ agentId, agentType, description, agentTokens, agentStatus, agentTask, subToolName, subToolFile, agentTodos });
        } catch {
          // skip malformed agent files
        }
      }

      // Compute display names for ALL raw entries (active + done/error)
      // so completed/errored agents' todos are still tagged with agentId
      const typeCounts = new Map<string, number>();
      for (const r of raw) {
        typeCounts.set(r.agentType, (typeCounts.get(r.agentType) || 0) + 1);
      }

      const typeCounter = new Map<string, number>();
      for (const r of raw) {
        const idx = (typeCounter.get(r.agentType) || 0) + 1;
        typeCounter.set(r.agentType, idx);
        const totalOfType = typeCounts.get(r.agentType) || 1;
        const name = totalOfType > 1
          ? `${r.agentType} Agent ${idx}/${totalOfType}`
          : `${r.agentType} Agent`;

        // Tag each todo with this agent's display name and collect
        for (const todo of r.agentTodos) {
          todos.push({ ...todo, agentId: name });
        }
      }

      // Filter out completed / errored agents — only show active ones
      const active = raw.filter(r => r.agentStatus !== 'done' && r.agentStatus !== 'error');

      typeCounter.clear();
      for (const r of active) {
        const idx = (typeCounter.get(r.agentType) || 0) + 1;
        typeCounter.set(r.agentType, idx);
        const totalOfType = typeCounts.get(r.agentType) || 1;
        const name = totalOfType > 1
          ? `${r.agentType} Agent ${idx}/${totalOfType}`
          : `${r.agentType} Agent`;

        agents.push({
          id: r.agentId,
          name,
          type: 'sub' as const,
          status: r.agentStatus,
          taskName: r.agentTask,
          progress: r.agentStatus === 'idle' ? 0 : 50,
          tokensUsed: r.agentTokens,
          subTask: r.description || undefined,
          currentTool: r.subToolName || undefined,
          currentToolFile: r.subToolFile || undefined,
        });
      }
    } catch {
      // agents directory read error
    }

    return { agents, todos };
  }

  /**
   * Re-read all session JSONL files to get updated token counts.
   * On each tick we recompute per-session totals and aggregate them,
   * updating sess.totalInputTokens when we detect file growth.
   */
  private refreshAllSessions(): void {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheHit = 0;
    let totalCacheWrite = 0;
    let latestActivity = 0;
    let latestTask = 'Idle';
    let allAgents: AgentStatus[] = [];

    // Re-detect model if still at default — picks up models from new sessions
    if (this.tokenLimit === 200000) {
      for (const sess of this.sessions) {
        if (fs.existsSync(sess.jsonlPath)) {
          this.detectModelFromJsonl(sess.jsonlPath);
          if (this.tokenLimit !== 200000) break;
        }
      }
    }

    for (const sess of this.sessions) {
      if (!fs.existsSync(sess.jsonlPath)) continue;

      try {
        const stats = fs.statSync(sess.jsonlPath);
        const newSize = stats.size;

        console.log(`[HUD DEBUG] Processing session ${sess.sessionId.substring(0, 8)}: knownSize=${sess.knownSize} newSize=${newSize}`);

        if (newSize > sess.knownSize) {
          // Read only the new bytes since last check
          const fd = fs.openSync(sess.jsonlPath, 'r');
          const buf = Buffer.alloc(newSize - sess.knownSize);
          fs.readSync(fd, buf, 0, buf.length, sess.knownSize);
          fs.closeSync(fd);

          const newContent = buf.toString('utf8');
          const newLines = newContent.split('\n').filter((l: string) => l.trim());

          let newInput = 0;
          let newOutput = 0;
          let newCacheHit = 0;
          let newCacheWrite = 0;

          for (const line of newLines) {
            try {
              const obj = JSON.parse(line);

              if (obj.type === 'assistant' && obj.message?.usage) {
                const u = obj.message.usage;
                newInput += u.input_tokens || 0;
                newOutput += u.output_tokens || 0;
                newCacheHit += u.cache_read_input_tokens || 0;
                newCacheWrite += u.cache_creation_input_tokens || 0;
                if (obj.timestamp) {
                  latestActivity = new Date(obj.timestamp).getTime();
                } else {
                  latestActivity = Date.now();
                }
              }

              if (obj.type === 'user' && obj.message?.content) {
                const texts = obj.message.content
                  .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
                  .map((c: { text?: string }) => c.text || '');
                if (texts.length > 0) {
                  const fullText = texts.join(' ');
                  latestTask = fullText.length > 80 ? fullText.substring(0, 77) + '...' : fullText;
                  sess.lastTask = latestTask;
                }
              }

              // Extract tool_use blocks from new lines (incremental)
              if (obj.type === 'assistant' && obj.message?.content) {
                // Clear current tool — will be re-set if tool_use found below
                sess.currentTool = '';
                sess.currentToolFile = '';
                const content = Array.isArray(obj.message.content) ? obj.message.content : [];
                for (const block of content) {
                  if (block.type === 'tool_use' && block.name) {
                    const toolName = block.name;
                    const existing = sess.toolActivity.get(toolName);
                    const now = Date.now();
                    const input = block.input as Record<string, unknown> | undefined;
                    const filePath = typeof input?.file_path === 'string' ? input.file_path
                      : typeof input?.path === 'string' ? input.path
                      : typeof input?.file === 'string' ? input.file
                      : undefined;
                    const bashCommand = toolName === 'Bash' && typeof input?.command === 'string'
                      ? input.command : undefined;
                    if (existing) {
                      existing.count++;
                      existing.lastUsed = now;
                      if (filePath) existing.lastFile = filePath;
                    } else {
                      sess.toolActivity.set(toolName, { count: 1, lastUsed: now, lastFile: filePath, agentCalls: new Map() });
                    }

                    sess.currentTool = toolName;
                    sess.currentToolFile = bashCommand || filePath || '';

                    // Extract todos from TodoWrite tool calls — authoritative full state
                    if (toolName === 'TodoWrite' && input) {
                      sess.todoItems.length = 0;
                      const todos = Array.isArray(input.todos) ? input.todos : [];
                      console.log(`[HUD DEBUG] TodoWrite in incremental: found ${todos.length} items:`, JSON.stringify(todos.map((t: any) => ({c: t.content, s: t.status}))));
                      for (const todo of todos) {
                        const content = typeof todo.content === 'string' ? todo.content : '';
                        const statusRaw = typeof todo.status === 'string' ? todo.status : 'pending';
                        const status = statusRaw === 'completed' ? 'completed' : statusRaw === 'in_progress' ? 'in_progress' : 'pending';
                        if (!content) {
                          console.log(`[HUD DEBUG] TodoWrite skipping item with empty content`);
                          continue;
                        }
                        sess.todoItems.push({ description: content, status, file: undefined, agentId: 'main' });
                      }
                      console.log(`[HUD DEBUG] sess.todoItems now has ${sess.todoItems.length} items for session ${sess.sessionId.substring(0, 8)}`);
                    }
                  }
                }
              }
            } catch {
              // skip malformed lines
            }
          }

          // Update session totals to include new tokens
          sess.totalInputTokens += newInput;
          sess.totalOutputTokens += newOutput;
          sess.totalCacheHitTokens += newCacheHit;
          sess.totalCacheWriteTokens += newCacheWrite;
          if (latestActivity > (sess.lastActivity || 0)) {
            sess.lastActivity = latestActivity;
          }
          sess.knownSize = newSize;
          sess.knownLines += newLines.length;
        } else if (newSize < sess.knownSize) {
          // File was truncated or replaced — full re-parse
          const parsed = this.parseJsonlFile(
            sess.jsonlPath,
            sess.cwd,
            sess.startedAt,
            sess.sessionId,
          );
          sess.totalInputTokens = parsed.inputTokens;
          sess.totalOutputTokens = parsed.outputTokens;
          sess.totalCacheHitTokens = parsed.cacheHitTokens;
          sess.totalCacheWriteTokens = parsed.cacheWriteTokens;
          sess.lastTask = parsed.lastTask;
          sess.lastActivity = parsed.lastActivity;
          sess.lastTimestamp = parsed.lastTimestamp;
          sess.toolActivity = parsed.toolActivity;
          sess.todoItems = parsed.todoItems;
          sess.currentTool = parsed.agents[0]?.currentTool || '';
          sess.currentToolFile = parsed.agents[0]?.currentToolFile || '';
          sess.knownSize = newSize;
          sess.knownLines = parsed.lineCount;
        }

        // Aggregate this session's totals
        totalInput += sess.totalInputTokens;
        totalOutput += sess.totalOutputTokens;
        totalCacheHit += sess.totalCacheHitTokens;
        totalCacheWrite += sess.totalCacheWriteTokens;

        if (sess.lastActivity > latestActivity) {
          latestActivity = sess.lastActivity;
        }

        // Re-discover subagents and store them on the session
        const { agents, todos: subTodos } = this.discoverSubAgents(
          sess.jsonlPath, sess.sessionId,
          sess.totalInputTokens + sess.totalOutputTokens,
        );
        sess.agentList = agents;

        // Merge subagent todos into session todoItems (dedup by description)
        const existingDescs = new Set(sess.todoItems.map(t => t.description));
        console.log(`[HUD DEBUG] Subagent merge: ${subTodos.length} subagent todos, ${sess.todoItems.length} existing items`);
        let mergedCount = 0;
        for (const st of subTodos) {
          if (!existingDescs.has(st.description)) {
            sess.todoItems.push(st);
            existingDescs.add(st.description);
            mergedCount++;
          }
        }
        if (mergedCount > 0) console.log(`[HUD DEBUG] Merged ${mergedCount} subagent todos, sess.todoItems now ${sess.todoItems.length}`);

        // Add subagents to the flat list
        for (const agent of agents) {
          allAgents.push(agent);
        }

        // Add main agent for this session to the flat list
        allAgents.push({
          id: `main-${sess.sessionId.substring(0, 8)}`,
          name: 'Main Agent',
          type: 'main',
          status: 'idle', // real status comes from subagents + burstRate
          taskName: sess.lastTask,
          progress: 0,
          tokensUsed: sess.totalInputTokens + sess.totalOutputTokens,
          subTask: sess.cwd ? `in ${path.basename(sess.cwd)}` : undefined,
          currentTool: sess.currentTool || undefined,
          currentToolFile: sess.currentToolFile || undefined,
        });
      } catch {
        // File read error — skip this session
      }
    }

    this.totalInputTokens = totalInput;
    this.totalOutputTokens = totalOutput;
    this.totalCacheTokens = totalCacheHit + totalCacheWrite;
    this.totalCacheHitTokens = totalCacheHit;
    this.totalCacheWriteTokens = totalCacheWrite;

    // Update hourly/daily history from real data
    const combinedTokens = totalInput + totalOutput;
    const now = new Date();

    // Use date+hour key so each hourly slot is uniquely identified (e.g. "06/09 09:00")
    const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const hourKey = `${monthDay} ${String(now.getHours()).padStart(2, '0')}:00`;
    const dayKey = monthDay;

    // Check if we need to update hourly
    let updatedHourly = false;
    for (const h of this.hourlyHistory) {
      if (h.hour === hourKey) {
        // Record the delta from last known, cap at combined tokens
        h.tokens = Math.max(h.tokens, combinedTokens);
        updatedHourly = true;
        break;
      }
    }
    if (!updatedHourly && combinedTokens > 0) {
      this.hourlyHistory.push({ hour: hourKey, tokens: combinedTokens, count: 1 });
    }

    let updatedDaily = false;
    for (const d of this.dailyHistory) {
      if (d.day === dayKey) {
        d.tokens = Math.max(d.tokens, combinedTokens);
        updatedDaily = true;
        break;
      }
    }
    if (!updatedDaily && combinedTokens > 0) {
      this.dailyHistory.push({ day: dayKey, tokens: combinedTokens, count: 1 });
    }

    // Update latest task
    if (latestTask !== 'Idle') {
      for (const sess of this.sessions) {
        sess.lastTask = latestTask;
      }
    }

    // Detect Plan Mode from the first active/live session
    if (this.sessions.length > 0) {
      this.planMode = this.detectPlanModeFromJsonl(this.sessions[0].jsonlPath);
    }

    // Build last-24-hours series from actual date+hour keys (fill missing with 0)
    const hourlyMap = new Map(this.hourlyHistory.map(h => [h.hour, h]));
    const padded: typeof this.hourlyHistory = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(d.getHours() - i, 0, 0, 0);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      padded.push(hourlyMap.get(key) || { hour: key, tokens: 0, count: 0 });
    }
    this.hourlyHistory = padded;
  }

  /** Return a HUDData snapshot built from real Claude Code data */
  tickOnce(): HUDData {
    this.tickCount++;
    this.sessionTime += 0.2;

    // Refresh data from files
    this.refreshAllSessions();

    const combinedTokens = this.totalInputTokens + this.totalOutputTokens;

    // Compute burst rate from token delta
    const delta = this.previousTokenTotal === 0 ? 0 : combinedTokens - this.previousTokenTotal;
    this.previousTokenTotal = combinedTokens;

    // Smooth burst rate: tokens per second (200ms tick = 5 ticks/sec = delta * 5)
    const instantRate = delta * 5;
    this.burstRate += (instantRate - this.burstRate) * 0.3;
    this.burstRate = Math.max(0, Math.round(this.burstRate));

    // Track burst history (for flowing bars)
    this.burstHistory.push(this.burstRate);
    if (this.burstHistory.length > 60) this.burstHistory.shift();

    // Track token rate samples for candle data
    this.tokenRateSamples.push(instantRate);
    if (this.tokenRateSamples.length > 10) this.tokenRateSamples.shift();

    // Candlestick tracking
    this.trackCandle();

    // Track tool activity for candlestick buy/sell signals
    const anyToolActive = this.sessions.some(s => !!s.currentTool);
    if (anyToolActive) {
      this.toolActiveDuringCandle = true;
    }

    // Estimate context window tokens (what's actually in the ~200K window)
    this.currentContextTokens = this.estimateContextTokens();

    // Estimate context length from CONTEXT tokens (not session total)
    const contextChars = this.currentContextTokens * 4;
    const contextPct = Math.min(100, (this.currentContextTokens / this.tokenLimit) * 100);

    // Aggregate agents from all sessions
    const allAgents: AgentStatus[] = [];
    for (const sess of this.sessions) {
      // Add main agent
      const mainTask = sess.lastTask || 'Idle';
      allAgents.push({
        id: `main-${sess.sessionId.substring(0, 8)}`,
        name: 'Main Agent',
        type: 'main',
        status: 'idle', // real status comes from subagents + burstRate
        taskName: mainTask,
        progress: 0,
        tokensUsed: sess.totalInputTokens + sess.totalOutputTokens,
        subTask: undefined,
          currentTool: sess.currentTool || undefined,
          currentToolFile: sess.currentToolFile || undefined,
      });
      // Add subagents
      for (const agent of sess.agentList) {
        if (agent.type === 'sub') {
          allAgents.push(agent);
        }
      }
    }

    // Task progress estimation (based on whether we're in an active conversation)
    const isActive = this.sessions.some(s => s.isActive);
    const hasActiveAgents = allAgents.some(a => a.status === 'working' || a.status === 'thinking');
    // Also consider recent activity within the last 30 seconds (burstRate decays too fast)
    const now = Date.now();
    const hasRecentActivity = this.burstRate > 0 || hasActiveAgents ||
      this.sessions.some(s => (now - s.lastActivity) < 30000);
    const taskStatus: 'idle' | 'thinking' | 'working' | 'done' | 'error' =
      allAgents.some(a => a.status === 'working') ? 'working' :
      allAgents.some(a => a.status === 'thinking') ? 'thinking' :
      isActive && hasRecentActivity ? 'working' : 'idle';

    // Get current task from the most recently active session
    let currentTask = 'Idle';
    let latestTs = 0;
    for (const sess of this.sessions) {
      if (sess.lastTimestamp > latestTs && sess.lastTask) {
        latestTs = sess.lastTimestamp;
        currentTask = sess.lastTask;
      }
    }

    // Aggregate todos from all sessions
    const combinedTodos: TodoItem[] = [];
    const seenTodoDescs = new Set<string>();
    for (const sess of this.sessions) {
      console.log(`[HUD DEBUG] Session ${sess.sessionId.substring(0, 8)} has ${sess.todoItems.length} todoItems in tickOnce():`, JSON.stringify(sess.todoItems.map((t: {description: string; status: string}) => ({d: t.description, s: t.status}))));
      for (const todo of sess.todoItems) {
        if (!seenTodoDescs.has(todo.description)) {
          seenTodoDescs.add(todo.description);
          combinedTodos.push(todo);
        } else {
          console.log(`[HUD DEBUG] Skipped dedup todo: "${todo.description.substring(0, 40)}..."`);
        }
      }
    }
    console.log(`[HUD DEBUG] combinedTodos has ${combinedTodos.length} items, this.sessions.length = ${this.sessions.length}`);

    return {
      tokensUsed: combinedTokens,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      cacheHitTokens: this.totalCacheHitTokens,
      cacheWriteTokens: this.totalCacheWriteTokens,
      tokenLimit: this.tokenLimit,
      contextTokens: this.currentContextTokens,
      contextLength: contextChars,
      contextPercentage: Math.round(contextPct),
      taskName: currentTask,
      taskProgress: null,
      taskStatus,
      modelName: this.detectedModelName || 'unknown',
      estimatedCost: this.estimateCost(),
      planMode: this.planMode,
      sessionTime: this.sessionTime,
      tokenBurstRate: this.burstRate,
      burstHistory: [...this.burstHistory],
      candleHistory: [...this.candleHistory],
      hourlyHistory: this.hourlyHistory,
      dailyHistory: this.dailyHistory,
      agents: allAgents.slice(0, 20),
      configCounts: this.scanConfig(),
      todos: combinedTodos,
    };
  }

  /**
   * Estimate the actual token count in Claude's current context window.
   *
   * API conventions differ by provider:
   *   Anthropic — each message.usage.input_tokens is per-exchange (the uncached portion).
   *               Real context = input + cache_read + cache_creation for the latest exchange.
   *   DeepSeek/Gemini — each message.usage.input_tokens is CUMULATIVE (grows with each
   *               exchange). The latest message's input_tokens IS the total context fill.
   *
   * We use isAnthropicModel (set by detectModelFromJsonl) to decide the strategy.
   */
  private estimateContextTokens(): number {
    const activeSessions = this.sessions.filter(s => s.isActive);
    if (activeSessions.length === 0) {
      // Fallback: no active session → use total session tokens (capped by limit)
      return Math.min(this.totalInputTokens + this.totalOutputTokens, this.tokenLimit);
    }

    const sess = activeSessions[0];
    if (!fs.existsSync(sess.jsonlPath)) {
      return Math.min(this.totalInputTokens + this.totalOutputTokens, this.tokenLimit);
    }

    try {
      const content = fs.readFileSync(sess.jsonlPath, 'utf8');
      const lines = content.split('\n').filter((l: string) => l.trim());

      // Walk backwards to find the last TWO assistant messages with usage.
      let lastUsage: JsonlUsage | null = null;
      let secondLastUsage: JsonlUsage | null = null;

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.type === 'assistant' && obj.message?.usage?.input_tokens != null) {
            if (lastUsage === null) {
              lastUsage = obj.message.usage;
            } else if (secondLastUsage === null) {
              secondLastUsage = obj.message.usage;
              break;
            }
          }
        } catch {
          // skip malformed
        }
      }

      if (lastUsage !== null) {
        if (this.isAnthropicModel) {
          // === Anthropic: per-exchange input_tokens ===
          // input_tokens only covers the uncached portion of this exchange.
          // Real context fill = input + cache_read + cache_creation for the latest exchange.
          // If we have two messages, use the delta between them (the exchange's actual input).
          if (secondLastUsage !== null) {
            const lastIn = this.resolveInputTokens(lastUsage);
            const prevIn = this.resolveInputTokens(secondLastUsage);
            const deltaIn = lastIn - prevIn;
            if (deltaIn > 0 && deltaIn < this.tokenLimit * 1.5) {
              return Math.min(deltaIn, this.tokenLimit);
            }
          }
          // Single-message fallback: use the resolve value directly
          return Math.min(this.resolveInputTokens(lastUsage), this.tokenLimit);
        } else {
          // === DeepSeek/Gemini: cumulative input_tokens ===
          // The last message's input_tokens is cumulative for the uncached portion,
          // and cache_read_input_tokens represents the cached portion of the context.
          // Together they form the total context fill (output_tokens do not fill context).
          const cacheRead = lastUsage.cache_read_input_tokens || 0;
          const cacheCreate = lastUsage.cache_creation_input_tokens || 0;
          const totalContext = (lastUsage.input_tokens || 0) + cacheRead + cacheCreate;
          return Math.min(totalContext, this.tokenLimit);
        }
      }
    } catch {
      // file read error — fall through
    }

    // Ultimate fallback: use session input tokens capped to limit
    return Math.min(this.totalInputTokens, this.tokenLimit);
  }

  /**
   * Resolve input tokens accounting for provider API conventions.
   */
  private resolveInputTokens(usage: JsonlUsage): number {
    if (this.isAnthropicModel) {
      // Anthropic: cache values are additive to input_tokens
      return (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
    }
    // DeepSeek/Gemini: input_tokens is the full prompt
    return usage.input_tokens || 0;
  }

  /**
   * Resolve pricing for the detected model using prefix matching.
   * Fallback to Claude Sonnet 4 pricing if unknown.
   */
  private resolvePricing(): { input: number; output: number; cacheRead: number; cacheWrite: number } {
    // Check for custom pricing overrides first
    const overrides: PricingOverride = this.configManager.getPricingOverrides();
    if (overrides.input || overrides.output || overrides.cacheRead || overrides.cacheWrite) {
      // Use model-detected pricing as base, then overlay custom values
      const model = this.resolveModelPricing();
      return {
        input: overrides.input ?? model.input,
        output: overrides.output ?? model.output,
        cacheRead: overrides.cacheRead ?? model.cacheRead,
        cacheWrite: overrides.cacheWrite ?? model.cacheWrite,
      };
    }
    return this.resolveModelPricing();
  }

  /**
   * Resolve pricing from model detection (without custom overrides).
   */
  private resolveModelPricing(): { input: number; output: number; cacheRead: number; cacheWrite: number } {
    if (!this.detectedModelName) {
      return { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 }; // Sonnet 4 default
    }
    // Exact match
    if (DataProvider.MODEL_PRICING[this.detectedModelName]) {
      return DataProvider.MODEL_PRICING[this.detectedModelName];
    }
    // Prefix match (same pattern as MODEL_LIMITS)
    const sortedKeys = Object.keys(DataProvider.MODEL_PRICING).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (this.detectedModelName.startsWith(key)) {
        return DataProvider.MODEL_PRICING[key];
      }
    }
    // Claude 4 series fallback by prefix
    if (this.detectedModelName.startsWith('claude-opus')) return DataProvider.MODEL_PRICING['claude-opus-4'];
    if (this.detectedModelName.startsWith('claude-sonnet')) return DataProvider.MODEL_PRICING['claude-sonnet-4'];
    if (this.detectedModelName.startsWith('claude-haiku')) return DataProvider.MODEL_PRICING['claude-haiku-4'];
    if (this.detectedModelName.startsWith('deepseek')) return DataProvider.MODEL_PRICING['deepseek-v4-flash'];
    if (this.detectedModelName.startsWith('gemini')) return DataProvider.MODEL_PRICING['gemini-2-5'];
    return { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };
  }

  /**
   * Estimate total cost in USD based on accumulated token usage and model pricing.
   */
  private estimateCost(): number {
    const pricing = this.resolvePricing();
    const cost =
      (this.totalInputTokens / 1_000_000) * pricing.input +
      (this.totalOutputTokens / 1_000_000) * pricing.output +
      (this.totalCacheHitTokens / 1_000_000) * pricing.cacheRead +
      (this.totalCacheWriteTokens / 1_000_000) * pricing.cacheWrite;
    return Math.round(cost * 10000) / 10000; // 4 decimal places
  }

  /**
   * Scan the project directory for config files.
   * Looks at:
   *   ~/.claude/projects/<sanitized-cwd>/CLAUDE.md
   *   ~/.claude/projects/<sanitized-cwd>/rules/ directory
   *   ~/.claude/claude.json for MCP server count
   *   .claude/ directory in the project root for hooks/settings
   */
  private scanConfig(): ConfigCounts {
    const counts: ConfigCounts = { claudeMdFiles: 0, rulesFiles: 0, mcpServers: 0, hooks: 0 };

    if (this.sessions.length === 0) return counts;

    const sess = this.sessions[0];
    const projectDir = sess.projectDir;

    try {
      // CLAUDE.md in the project config dir
      const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
      if (fs.existsSync(claudeMdPath)) {
        counts.claudeMdFiles = 1;
      }

      // rules/ directory
      const rulesDir = path.join(projectDir, 'rules');
      if (fs.existsSync(rulesDir)) {
        try {
          const files = fs.readdirSync(rulesDir);
          counts.rulesFiles = files.filter(f => f.endsWith('.md') || f.endsWith('.txt')).length;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    // MCP servers from claude.json
    try {
      const claudeJsonPath = path.join(this.claudeDir, 'claude.json');
      if (fs.existsSync(claudeJsonPath)) {
        const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
        const mcpServers = claudeJson.mcpServers || claudeJson.mcp_config || claudeJson.mcp;
        if (typeof mcpServers === 'object' && mcpServers !== null) {
          counts.mcpServers = Object.keys(mcpServers).length;
        }
      }
    } catch {
      // ignore
    }

    // Hooks: check ~/.claude/settings.json for hook configuration
    try {
      const settingsPath = path.join(this.claudeDir, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const hooks = settings.hooks;
        if (typeof hooks === 'object' && hooks !== null) {
          const hookCount = Object.keys(hooks).length;
          if (hookCount > 0) counts.hooks = hookCount;
        }
      }
      // Also check .claude/ in the current workspace
      const localClaudeDir = path.join(path.dirname(this.cwd), '.claude');
      if (fs.existsSync(localClaudeDir)) {
        const hooksDir = path.join(localClaudeDir, 'hooks');
        if (fs.existsSync(hooksDir)) {
          try {
            const hookFiles = fs.readdirSync(hooksDir);
            counts.hooks += hookFiles.filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs')).length;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    return counts;
  }

  // ---- Candlestick tracking — natural OHLC with alternating up/down ----
  private trackCandle(): void {
    if (this.candleTicks === 0) {
      // Continuity: this candle opens at previous candle's close
      const prevClose = this.candleHistory.length > 0
        ? this.candleHistory[this.candleHistory.length - 1].close
        : 50;

      // Drifting baseline follows burstRate slowly
      this.candleBaseline += (this.burstRate - this.candleBaseline) * 0.05;

      // Synthetic direction oscillator — natural reversal every ~8 candles
      const dir = Math.sin(this.candleIndex * 0.8) * 18;

      // burstRate influence (real signal mixed in)
      const burstSignal = (this.burstRate - this.candleBaseline) * this.CANDLE_AMPLIFY * 0.2;

      // Combined movement for this candle
      const move = Math.round(dir + burstSignal);
      this.candleOpen = prevClose;
      this.candleClose = prevClose + move;

      // Wicks: 30–50% of body size, minimum 3px for visual presence
      const body = Math.abs(this.candleClose - this.candleOpen);
      const wickRatio = 0.3 + Math.sin(this.candleIndex * 1.1) * 0.15;
      const wick = Math.max(3, Math.round(body * wickRatio));

      this.candleHigh = Math.max(this.candleOpen, this.candleClose) + wick;
      this.candleLow = Math.min(this.candleOpen, this.candleClose) - wick;

      this.toolActiveDuringCandle = false;
    }

    // Within-candle micro jitter (tiny, won't flip direction)
    const jitter = Math.round(Math.sin(this.tickCount * 0.7 + this.candleIndex) * 2);
    this.candleClose += jitter;
    this.candleHigh = Math.max(this.candleHigh, this.candleClose);
    this.candleLow = Math.min(this.candleLow, this.candleClose);
    this.candleTicks++;

    if (this.candleTicks >= this.CANDLE_TICK_WINDOW) {
      let signal: 'buy' | 'sell' | undefined;
      if (this.toolActiveDuringCandle) {
        this.candleSignalFlag = !this.candleSignalFlag;
        signal = this.candleSignalFlag ? 'buy' : 'sell';
        // Boost movement on signal candles
        if (signal === 'buy') this.candleClose += 14;
        else this.candleClose -= 14;
        this.candleHigh = Math.max(this.candleHigh, this.candleClose);
        this.candleLow = Math.min(this.candleLow, this.candleClose);
      }
      this.candleHistory.push({
        open: this.candleOpen,
        high: this.candleHigh,
        low: this.candleLow,
        close: this.candleClose,
        label: `${this.candleTicks * 200}ms`,
        signal,
      });
      if (this.candleHistory.length > 40) this.candleHistory.shift();
      this.candleTicks = 0;
      this.candleIndex++;
    }
  }
}
