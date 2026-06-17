import * as vscode from 'vscode';
import { HUDPanelProvider } from './hudPanel';
import { StatusBarManager } from './statusBar';
import { DataProvider } from './dataProvider';
import { ConfigManager } from './configManager';
import { HistoryStore } from './historyStore';

let tickTimer: ReturnType<typeof setInterval> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // ---- Init components ----
  const configManager = new ConfigManager();
  const historyStore = new HistoryStore(context);
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const dataProvider = new DataProvider(configManager, historyStore, workspaceFolders);
  const statusBar = new StatusBarManager();

  // ---- Register webview provider ----
  const provider = new HUDPanelProvider(context.extensionUri, configManager, context.globalState);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HUDPanelProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ---- Register command ----
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeHud.focus', () => {
      provider.reveal();
    }),
  );

  // ---- Push initial config to webview when it loads ----
  const pushConfig = () => {
    provider.postConfig(configManager.getModules());
  };
  pushConfig();

  // ---- Listen for config changes ----
  context.subscriptions.push(
    configManager.onDidChange(pushConfig),
  );

  // ---- Start tick loop (200 ms) ----
  tickTimer = setInterval(() => {
    const data = dataProvider.tickOnce();
    provider.postData(data);
    statusBar.update(data.contextTokens, data.tokenLimit);
  }, 200);

  context.subscriptions.push({
    dispose: () => {
      if (tickTimer) clearInterval(tickTimer);
    },
  });

  // ---- Cleanup status bar ----
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  if (tickTimer) clearInterval(tickTimer);
}
