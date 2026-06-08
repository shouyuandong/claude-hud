// ---- Locale / i18n strings for Claude HUD ----

export interface LocaleStrings {
  header: {
    title: string;
    plan: string;
    settingsTitle: string;
    status: { idle: string; thinking: string; working: string; done: string; error: string };
  };
  modules: {
    tokenFlow: string;
    contextWindow: string;
    cost: string;
    agentStatus: string;
    todos: string;
    history: string;
    config: string;
    sessionTime: string;
  };
  chart: {
    '24h': string;
    '7d': string;
    candleToggle: string;
  };
  settings: {
    title: string;
    agentStatus: string;
    tokenFlow: string;
    contextWindow: string;
    historyChart: string;
    sessionTime: string;
    cost: string;
    config: string;
    todos: string;
  };
  agent: {
    noAgents: string;
  };
  tokenFlow: {
    tokensPerSec: string; // {rate} tokens/s {dir}
  };
  candlestick: {
    o: string;
    h: string;
    l: string;
    c: string;
    noData: string;
  };
  context: {
    used: string; // {used} / {limit} ({pct}%)
  };
  chartTotal: {
    today: string; // Today: {total} tokens
    week: string;  // This week: {total} tokens
  };
  todos: {
    noTodos: string;
  };
  cost: {
    in: string;
    out: string;
    cacheR: string;
    cacheW: string;
  };
  config: {
    claudeMd: string;
    rules: string;
    mcp: string;
    hooks: string;
  };
  footer: {
    session: string; // Session:
  };
}

const en: LocaleStrings = {
  header: {
    title: 'CLAUDE HUD',
    plan: 'PLAN',
    settingsTitle: 'Show/hide modules',
    status: { idle: 'idle', thinking: 'thinking', working: 'working', done: 'done', error: 'error' },
  },
  modules: {
    tokenFlow: 'Token Flow',
    contextWindow: 'Context Window',
    cost: 'Cost',
    agentStatus: 'Agent Status',
    todos: 'Todos',
    history: 'History',
    config: 'Config',
    sessionTime: 'Session',
  },
  chart: {
    '24h': '24h',
    '7d': '7d',
    candleToggle: 'Switch view mode (matrix/candle/balls)',
  },
  settings: {
    title: 'Display Modules',
    agentStatus: 'Agent Status',
    tokenFlow: 'Token Flow',
    contextWindow: 'Context Window',
    historyChart: 'History Chart',
    sessionTime: 'Session Timer',
    cost: 'Cost',
    config: 'Config',
    todos: 'Todos',
  },
  agent: {
    noAgents: 'No agents active',
  },
  tokenFlow: {
    tokensPerSec: '{rate} tokens/s {dir}',
  },
  candlestick: {
    o: 'O',
    h: 'H',
    l: 'L',
    c: 'C',
    noData: 'No candle data',
  },
  context: {
    used: '{used} / {limit} ({pct}%)',
  },
  chartTotal: {
    today: 'Today: {total} tokens',
    week: 'This week: {total} tokens',
  },
  todos: {
    noTodos: 'No todos',
  },
  cost: {
    in: 'IN',
    out: 'OUT',
    cacheR: 'CACHE R',
    cacheW: 'CACHE W',
  },
  config: {
    claudeMd: 'CLAUDE.md',
    rules: 'Rules',
    mcp: 'MCP',
    hooks: 'Hooks',
  },
  footer: {
    session: 'Session:',
  },
};

const zh: LocaleStrings = {
  header: {
    title: 'CLAUDE HUD',
    plan: '方案',
    settingsTitle: '显示/隐藏模块',
    status: { idle: '空闲', thinking: '思考中', working: '工作中', done: '完成', error: '错误' },
  },
  modules: {
    tokenFlow: 'Token 流',
    contextWindow: '上下文窗口',
    cost: '费用',
    agentStatus: 'Agent 状态',
    todos: '待办',
    history: '历史',
    config: '配置',
    sessionTime: '会话',
  },
  chart: {
    '24h': '24小时',
    '7d': '7天',
    candleToggle: '切换视图模式 (矩阵/K线/弹球)',
  },
  settings: {
    title: '显示模块',
    agentStatus: 'Agent 状态',
    tokenFlow: 'Token 流',
    contextWindow: '上下文窗口',
    historyChart: '历史图表',
    sessionTime: '会话计时',
    cost: '费用',
    config: '配置',
    todos: '待办',
  },
  agent: {
    noAgents: '没有活跃的 Agent',
  },
  tokenFlow: {
    tokensPerSec: '{rate} tokens/s {dir}',
  },
  candlestick: {
    o: '开',
    h: '高',
    l: '低',
    c: '收',
    noData: '暂无 K 线数据',
  },
  context: {
    used: '{used} / {limit} ({pct}%)',
  },
  chartTotal: {
    today: '今日: {total} tokens',
    week: '本周: {total} tokens',
  },
  todos: {
    noTodos: '暂无待办',
  },
  cost: {
    in: '输入',
    out: '输出',
    cacheR: '缓存读',
    cacheW: '缓存写',
  },
  config: {
    claudeMd: 'CLAUDE.md',
    rules: '规则',
    mcp: 'MCP',
    hooks: '钩子',
  },
  footer: {
    session: '会话:',
  },
};

const ja: LocaleStrings = {
  header: {
    title: 'CLAUDE HUD',
    plan: '計画',
    settingsTitle: 'モジュールの表示/非表示',
    status: { idle: '待機中', thinking: '思考中', working: '作業中', done: '完了', error: 'エラー' },
  },
  modules: {
    tokenFlow: 'Token フロー',
    contextWindow: 'コンテキスト',
    cost: 'コスト',
    agentStatus: 'Agent 状態',
    todos: 'TODO',
    history: '履歴',
    config: '設定',
    sessionTime: 'セッション',
  },
  chart: {
    '24h': '24時間',
    '7d': '7日',
    candleToggle: '表示切替 (マトリクス/ローソク/ボール)',
  },
  settings: {
    title: '表示モジュール',
    agentStatus: 'Agent 状態',
    tokenFlow: 'Token フロー',
    contextWindow: 'コンテキスト',
    historyChart: '履歴チャート',
    sessionTime: 'セッション時間',
    cost: 'コスト',
    config: '設定',
    todos: 'TODO',
  },
  agent: {
    noAgents: 'アクティブな Agent なし',
  },
  tokenFlow: {
    tokensPerSec: '{rate} tokens/s {dir}',
  },
  candlestick: {
    o: '始',
    h: '高',
    l: '低',
    c: '終',
    noData: 'ローソクデータなし',
  },
  context: {
    used: '{used} / {limit} ({pct}%)',
  },
  chartTotal: {
    today: '今日: {total} tokens',
    week: '今週: {total} tokens',
  },
  todos: {
    noTodos: 'TODO なし',
  },
  cost: {
    in: '入力',
    out: '出力',
    cacheR: 'キャッシュ読',
    cacheW: 'キャッシュ書',
  },
  config: {
    claudeMd: 'CLAUDE.md',
    rules: 'ルール',
    mcp: 'MCP',
    hooks: 'フック',
  },
  footer: {
    session: 'セッション:',
  },
};

export const LOCALES: Record<string, LocaleStrings> = {
  en,
  zh,
  ja,
};

/** Select the best matching locale for a given VS Code language string */
export function loadLocale(lang: string): LocaleStrings {
  const code = lang.toLowerCase().replace(/_/g, '-');
  if (code.startsWith('zh')) return zh;
  if (code.startsWith('ja')) return ja;
  return en;
}
