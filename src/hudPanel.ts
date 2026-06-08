import * as vscode from 'vscode';
import { HUDData, HUDModuleConfig, WebviewMessage } from './types';
import { ConfigManager } from './configManager';
import { loadLocale } from './locales';

/**
 * Webview view provider for the Claude HUD sidebar panel.
 */
export class HUDPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeHud.panel';

  private _view?: vscode.WebviewView;
  private _latestData?: HUDData;
  private _latestConfig?: HUDModuleConfig;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configManager: ConfigManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'webview')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // forward any buffered data / config
    if (this._latestData) {
      this.postData(this._latestData);
    }
    if (this._latestConfig) {
      this.postConfig(this._latestConfig);
    }

    // Send initial theme state to webview (authoritative source, bypasses CSS var detection)
    const initialIsLight = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
    webviewView.webview.postMessage({ type: 'themeChanged', isLight: initialIsLight } satisfies WebviewMessage);

    // Listen for VS Code color theme changes and propagate to webview
    const themeDisposable = vscode.window.onDidChangeActiveColorTheme((colorTheme) => {
      const isLight = colorTheme.kind === vscode.ColorThemeKind.Light;
      this._view?.webview.postMessage({ type: 'themeChanged', isLight } satisfies WebviewMessage);
    });
    webviewView.onDidDispose(() => themeDisposable.dispose());

    // listen for messages from the webview
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'getConfig':
          if (this._latestConfig) this.postConfig(this._latestConfig);
          break;
        case 'toggleModule':
          this.configManager.setModule(msg.module, msg.visible);
          break;
      }
    });
  }

  /** Push updated HUD data to the webview */
  postData(data: HUDData): void {
    this._latestData = data;
    this._view?.webview.postMessage({ type: 'update', data } satisfies WebviewMessage);
  }

  /** Push module config to the webview */
  postConfig(modules: HUDModuleConfig): void {
    this._latestConfig = modules;
    this._view?.webview.postMessage({ type: 'config', modules } satisfies WebviewMessage);
  }

  /** Reveal the HUD panel (called from command / status bar click) */
  reveal(): void {
    vscode.commands.executeCommand('claudeHud.panel.focus');
  }

  // ---- build webview HTML ----

  private getHtml(webview: vscode.Webview): string {
    const locale = loadLocale(this.configManager.getLocale());
    const l = locale;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'script.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'styles.css'),
    );

    return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Claude HUD</title>
</head>
<body>
  <!-- Header -->
  <header class="hud-header">
    <span class="hud-logo">
      <svg class="hud-logo-svg" width="16" height="16" viewBox="0 0 32 32" fill="none">
        <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" stroke="currentColor" stroke-width="1.5" fill="none"/>
        <polygon points="16,8 24,16 16,24 8,16" fill="currentColor" opacity="0.4"/>
        <circle cx="16" cy="16" r="3" fill="currentColor"/>
      </svg>
    </span>
    <span class="hud-title">${l.header.title}</span>
    <span class="model-badge" id="modelBadge">--</span>
    <span class="plan-badge hidden" id="planBadge">${l.header.plan}</span>
    <span class="hud-status" id="headerStatus">${l.header.status.idle}</span>
    <button class="hud-settings-btn" id="settingsBtn" title="${l.header.settingsTitle}">
      <svg class="settings-btn-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1"/>
      </svg>
    </button>
  </header>

  <div class="hud-body" id="hudBody">
    <!-- Real-time Token Flow -->
    <section class="hud-module" id="mod-tokenFlow" data-module="tokenFlow" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span>${l.modules.tokenFlow}</span>
        <button class="candle-toggle" id="candleToggle" title="${l.chart.candleToggle}">
          <svg class="candle-toggle-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="6" width="3" height="12" rx="0.5"/>
            <rect x="10.5" y="3" width="3" height="18" rx="0.5"/>
            <rect x="17" y="8" width="3" height="8" rx="0.5"/>
            <line x1="5.5" y1="2" x2="5.5" y2="6"/>
            <line x1="5.5" y1="18" x2="5.5" y2="22"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="22"/>
            <line x1="18.5" y1="4" x2="18.5" y2="8"/>
            <line x1="18.5" y1="16" x2="18.5" y2="20"/>
          </svg>
        </button>
      </div>
      <div class="burst-bars" id="burstBars">
        <canvas id="burstCanvas" width="240" height="160"></canvas>
      </div>
      <div class="burst-label" id="burstLabel">-- t/s</div>
    </section>

    <!-- Context Window -->
    <section class="hud-module" id="mod-contextWindow" data-module="contextWindow" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span class="title-text">${l.modules.contextWindow}</span>
        <span class="title-spacer"></span>
      </div>
      <div class="context-bar-track">
        <div class="context-bar-fill" id="contextFill"></div>
      </div>
      <div class="context-label" id="contextLabel">-- / -- chars (--%)</div>
    </section>

    <!-- Cost -->
    <section class="hud-module" id="mod-cost" data-module="cost" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span class="title-text">${l.modules.cost}</span>
        <span class="title-spacer"></span>
      </div>
      <div class="cost-body" id="costBody">
        <div class="cost-total">
          <span id="costTokens">--</span>
          <span class="cost-sep-dot">·</span>
          <span id="costTotal">$0.0000</span>
        </div>
        <div class="cost-detail">
          <span class="cost-detail-item">
            <span class="detail-label">${l.cost.in}</span>
            <span class="detail-value" id="costIn">--</span>
          </span>
          <span class="section-detail-divider"></span>
          <span class="cost-detail-item">
            <span class="detail-label">${l.cost.out}</span>
            <span class="detail-value" id="costOut">--</span>
          </span>
          <span class="section-detail-divider"></span>
          <span class="cost-detail-item">
            <span class="detail-label">${l.cost.cacheR}</span>
            <span class="detail-value" id="costCacheR">--</span>
          </span>
          <span class="section-detail-divider"></span>
          <span class="cost-detail-item">
            <span class="detail-label">${l.cost.cacheW}</span>
            <span class="detail-value" id="costCacheW">--</span>
          </span>
        </div>
      </div>
    </section>

    <!-- Agent Status -->
    <section class="hud-module" id="mod-agentStatus" data-module="agentStatus" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span class="title-text">${l.modules.agentStatus}</span>
        <span class="title-spacer"></span>
      </div>
      <div class="agent-tree" id="agentTree"></div>
    </section>

    <!-- Todos -->
    <section class="hud-module" id="mod-todos" data-module="todos" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span class="title-text">${l.modules.todos}</span>
        <span class="todo-progress" id="todoProgress"></span>
        <span class="title-spacer"></span>
      </div>
      <div class="todos-body" id="todosBody">
        <div class="todos-placeholder" id="todosPlaceholder">${l.todos.noTodos}</div>
        <div class="todos-list" id="todosList"></div>
      </div>
    </section>

    <!-- History Chart -->
    <section class="hud-module" id="mod-historyChart" data-module="historyChart" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span>${l.modules.history}</span>
        <span class="chart-tabs">
          <button class="chart-tab active" data-mode="24h">${l.chart['24h']}</button>
          <button class="chart-tab" data-mode="7d">${l.chart['7d']}</button>
        </span>
      </div>
      <div class="chart-canvas-wrap">
        <canvas id="historyCanvas" width="240" height="80"></canvas>
      </div>
      <div class="chart-total" id="chartTotal">--</div>
    </section>

    <!-- Config Stats -->
    <section class="hud-module" id="mod-configStats" data-module="configStats" draggable="true">
      <div class="module-title">
        <span class="drag-handle">⠿</span>
        <span class="title-text">${l.modules.config}</span>
        <span class="title-spacer"></span>
      </div>
      <div class="config-grid" id="configGrid">
        <div class="config-card" id="configClaudeMd">
          <span class="config-card-value" id="configClaudeMdValue">0</span>
          <span class="config-card-label">${l.config.claudeMd}</span>
        </div>
        <div class="config-card" id="configRules">
          <span class="config-card-value" id="configRulesValue">0</span>
          <span class="config-card-label">${l.config.rules}</span>
        </div>
        <div class="config-card" id="configMcp">
          <span class="config-card-value" id="configMcpValue">0</span>
          <span class="config-card-label">${l.config.mcp}</span>
        </div>
        <div class="config-card" id="configHooks">
          <span class="config-card-value" id="configHooksValue">0</span>
          <span class="config-card-label">${l.config.hooks}</span>
        </div>
      </div>
    </section>
  </div>

  <!-- Footer -->
  <footer class="hud-footer" id="mod-sessionTime" data-module="sessionTime">
    ${l.footer.session} <span id="sessionTime">00:00:00</span>
  </footer>

  <!-- Settings overlay -->
  <div class="settings-overlay hidden" id="settingsOverlay">
    <div class="settings-panel">
      <div class="settings-title">${l.settings.title}</div>
      <label class="settings-item"><input type="checkbox" data-key="agentStatus" checked/> ${l.settings.agentStatus}</label>
      <label class="settings-item"><input type="checkbox" data-key="tokenFlow" checked/> ${l.settings.tokenFlow}</label>
      <label class="settings-item"><input type="checkbox" data-key="contextWindow" checked/> ${l.settings.contextWindow}</label>
      <label class="settings-item"><input type="checkbox" data-key="historyChart" checked/> ${l.settings.historyChart}</label>
      <label class="settings-item"><input type="checkbox" data-key="sessionTime" checked/> ${l.settings.sessionTime}</label>
      <label class="settings-item"><input type="checkbox" data-key="cost" checked/> ${l.settings.cost}</label>
      <label class="settings-item"><input type="checkbox" data-key="configStats" checked/> ${l.settings.config}</label>
      <label class="settings-item"><input type="checkbox" data-key="todos" checked/> ${l.settings.todos}</label>
    </div>
  </div>

  <script>window.__LOCALE__ = ${JSON.stringify(locale)};</script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
