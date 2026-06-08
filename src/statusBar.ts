import * as vscode from 'vscode';

/**
 * Status bar item showing token usage at a glance.
 * Green (<60%), Amber (60–85%), Red (>85%).
 * Click to reveal the HUD panel.
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.text = '$(pulse) Claude HUD';
    this.item.tooltip = 'Click to open Claude HUD panel';
    this.item.command = 'claudeHud.focus';
    this.item.show();
  }

  update(tokensUsed: number, tokenLimit: number): void {
    const pct = tokenLimit > 0 ? (tokensUsed / tokenLimit) * 100 : 0;
    const formatted = tokensUsed >= 1000
      ? `${(tokensUsed / 1000).toFixed(1)}k`
      : String(tokensUsed);
    const limitFormatted = tokenLimit >= 1000
      ? `${(tokenLimit / 1000).toFixed(0)}k`
      : String(tokenLimit);

    this.item.text = `$(pulse) ${formatted}/${limitFormatted} (${Math.round(pct)}%)`;

    // colour
    if (pct < 60) {
      this.item.color = '#34d399';   // Emerald-400
    } else if (pct < 85) {
      this.item.color = '#fbbf24';   // Amber-400
    } else {
      this.item.color = '#f87171';   // Red-400
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
