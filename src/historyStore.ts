import * as vscode from 'vscode';
import { HourlyTokenData, DailyTokenData, TokenHistoryRecord } from './types';

const STORAGE_KEY = 'claudeHud.tokenHistory';

export class HistoryStore {
  private record: TokenHistoryRecord;

  constructor(private context: vscode.ExtensionContext) {
    this.record = context.globalState.get<TokenHistoryRecord>(STORAGE_KEY) ?? {
      hourly: {},
      daily: {},
    };
  }

  /** Manually add a token sample at the current clock hour */
  recordSample(tokens: number): void {
    const now = new Date();
    const hourKey = `${String(now.getHours()).padStart(2, '0')}:00`;
    const dayKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

    this.record.hourly[hourKey] = (this.record.hourly[hourKey] ?? 0) + tokens;
    this.record.daily[dayKey] = (this.record.daily[dayKey] ?? 0) + tokens;

    // persist
    this.context.globalState.update(STORAGE_KEY, this.record);
  }

  /** Return the last 24 hourly buckets */
  getHourlyHistory(): HourlyTokenData[] {
    const now = new Date();
    const result: HourlyTokenData[] = [];
    for (let i = 23; i >= 0; i--) {
      const h = (now.getHours() - i + 24) % 24;
      const key = `${String(h).padStart(2, '0')}:00`;
      const tokens = this.record.hourly[key] ?? 0;
      result.push({ hour: key, tokens, count: tokens > 0 ? 1 : 0 });
    }
    return result;
  }

  /** Return the last 7 daily buckets */
  getDailyHistory(): DailyTokenData[] {
    const now = new Date();
    const result: DailyTokenData[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      const tokens = this.record.daily[key] ?? 0;
      result.push({ day: key, tokens, count: tokens > 0 ? 1 : 0 });
    }
    return result;
  }

  // --- Mock data generators for Phase 1 ---

  /** Seed mock data for the past 24 hours */
  seedMockHourly(): void {
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const h = (now.getHours() - i + 24) % 24;
      const key = `${String(h).padStart(2, '0')}:00`;
      // realistic variation: quiet at night, busy during day
      const hourFactor = (h >= 9 && h <= 18) ? 1 : 0.3;
      this.record.hourly[key] = Math.round((5000 + Math.random() * 15000) * hourFactor);
    }
    this.context.globalState.update(STORAGE_KEY, this.record);
  }

  /** Seed mock data for the past 7 days */
  seedMockDaily(): void {
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      this.record.daily[key] = Math.round(isWeekend
        ? 10000 + Math.random() * 20000
        : 30000 + Math.random() * 50000);
    }
    this.context.globalState.update(STORAGE_KEY, this.record);
  }

  /** Seed all mock data */
  seedAll(): void {
    this.seedMockHourly();
    this.seedMockDaily();
  }
}
