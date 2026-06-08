// ---- Types for the Claude HUD extension ----

export interface HUDData {
  // current session
  tokensUsed: number;           // total session tokens (all-time)
  inputTokens: number;          // total input tokens
  outputTokens: number;         // total output tokens
  cacheHitTokens: number;       // total cache read (hit) tokens
  cacheWriteTokens: number;     // total cache creation (write) tokens
  tokenLimit: number;           // Claude context window limit (default 200K)
  contextTokens: number;        // estimated tokens in the current context window
  contextLength: number;        // current context length (chars)
  contextPercentage: number;    // 0–100
  taskName: string;
  taskProgress: number | null; // 0–100
  taskStatus: 'idle' | 'thinking' | 'working' | 'done' | 'error';
  sessionTime: number;         // seconds
  planMode: boolean;           // whether Claude is in Plan Mode
  modelName: string;           // detected model name (e.g. "claude-sonnet-4-6")
  estimatedCost: number;       // total estimated cost in USD

  // short-term real-time (for flowing bars / candlesticks)
  tokenBurstRate: number;      // tokens/s
  burstHistory: number[];      // recent N samples
  candleHistory: CandleData[]; // candlestick data for K-line view

  // long-term history (for charts)
  hourlyHistory: HourlyTokenData[];
  dailyHistory: DailyTokenData[];

  // multi-agent
  agents: AgentStatus[];

  // config stats
  configCounts: ConfigCounts;

  // todo items
  todos: TodoItem[];
}

export interface ConfigCounts {
  claudeMdFiles: number;
  rulesFiles: number;
  mcpServers: number;
  hooks: number;
}

export interface TodoItem {
  description: string;
  status: 'pending' | 'completed' | 'in_progress';
  file?: string;
  agentId?: string;   // 'main' or subagent name like 'Explore Agent 1/2'
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  label: string;  // time label
  signal?: 'buy' | 'sell';  // simulated buy/sell when tool activity detected
}

export interface AgentStatus {
  id: string;
  name: string;
  type: 'main' | 'sub';
  status: 'idle' | 'thinking' | 'working' | 'done' | 'error';
  taskName: string;
  progress: number;   // 0–100
  tokensUsed: number;
  subTask?: string;
  currentTool?: string;       // tool name if agent is currently calling a tool
  currentToolFile?: string;   // file path or command the tool is operating on
}

export interface HourlyTokenData {
  hour: string;   // "10:00"
  tokens: number;
  count: number;
}

export interface DailyTokenData {
  day: string;    // "06/08"
  tokens: number;
  count: number;
}

export interface TokenHistoryRecord {
  hourly: Record<string, number>;
  daily: Record<string, number>;
}

export interface HUDModuleConfig {
  agentStatus: boolean;
  tokenFlow: boolean;
  contextWindow: boolean;
  historyChart: boolean;
  sessionTime: boolean;
  cost: boolean;
  configStats: boolean;
  todos: boolean;
}

/** Custom pricing overrides (per 1M tokens, USD) */
export interface PricingOverride {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type WebviewMessage =
  | { type: 'update'; data: HUDData }
  | { type: 'config'; modules: HUDModuleConfig }
  | { type: 'toggleModule'; module: keyof HUDModuleConfig; visible: boolean }
  | { type: 'switchChart'; mode: '24h' | '7d' }
  | { type: 'getConfig' }
  | { type: 'themeChanged'; isLight: boolean };
