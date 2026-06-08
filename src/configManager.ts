import * as vscode from 'vscode';
import { HUDModuleConfig, PricingOverride } from './types';

const DEFAULT_MODULES: HUDModuleConfig = {
  agentStatus: true,
  tokenFlow: true,
  contextWindow: true,
  historyChart: true,
  sessionTime: true,
  cost: true,
  configStats: true,
  todos: true,
};

export class ConfigManager {
  private _onDidChange = new vscode.EventEmitter<HUDModuleConfig>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeHud.modules')) {
        this._onDidChange.fire(this.getModules());
      }
    });
  }

  /** Read current module visibility from VS Code settings */
  getModules(): HUDModuleConfig {
    const config = vscode.workspace.getConfiguration('claudeHud.modules');
    const raw = config.inspect<Record<string, boolean>>('');
    const value = raw?.globalValue ?? raw?.defaultValue ?? {};
    return { ...DEFAULT_MODULES, ...value };
  }

  /** Persist a single module toggle */
  async setModule(key: keyof HUDModuleConfig, visible: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeHud.modules');
    const current = this.getModules();
    current[key] = visible;
    await config.update('', current, vscode.ConfigurationTarget.Global);
  }

  /** Get language setting, resolving "auto" to VS Code language */
  getLocale(): string {
    const config = vscode.workspace.getConfiguration('claudeHud');
    const setting = config.get<string>('language') || 'auto';
    if (setting === 'auto') return vscode.env.language;
    return setting;
  }

  /** Get custom pricing overrides, or empty object for model-detected pricing */
  getPricingOverrides(): PricingOverride {
    const config = vscode.workspace.getConfiguration('claudeHud.pricing');
    const raw = config.inspect<Record<string, number>>('');
    const value = raw?.globalValue ?? {};
    // Return only fields that are non-zero (user intentionally set them)
    const result: PricingOverride = {};
    if (typeof value.input === 'number' && value.input > 0) result.input = value.input;
    if (typeof value.output === 'number' && value.output > 0) result.output = value.output;
    if (typeof value.cacheRead === 'number' && value.cacheRead > 0) result.cacheRead = value.cacheRead;
    if (typeof value.cacheWrite === 'number' && value.cacheWrite > 0) result.cacheWrite = value.cacheWrite;
    return result;
  }

  /** Get the list of visible modules as a Set of keys */
  getVisibleModules(): Set<keyof HUDModuleConfig> {
    const modules = this.getModules();
    const visible = new Set<keyof HUDModuleConfig>();
    for (const [key, val] of Object.entries(modules)) {
      if (val) visible.add(key as keyof HUDModuleConfig);
    }
    return visible;
  }
}
