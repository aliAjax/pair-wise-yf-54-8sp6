import { defineStore } from 'pinia';
import type { Actor, CabinetRecord, Conflict, ExhibitRecord, HandoverOp, ImportReport, LedgerState, ReadingPoint, DiscrepancyRecord } from '../ledger/types';
import { applyBatch, confirmConclusion, createInitialState, filterUnposted, resolveConflict } from '../ledger/engine';
import { parseHandover } from '../ledger/parser';

const STORAGE_KEY = 'yf54-ledger-v1';

interface Toast {
  text: string;
  color: 'success' | 'error' | 'warning' | 'info';
}

interface State {
  ledger: LedgerState;
  actor: Actor;
  /** 保管员当前管辖柜（切换模拟不同保管员终端） */
  scopeCabinet: string;
  lastReport: ImportReport | null;
  lastImportText: string;
  lastImportOps: HandoverOp[];
  lastImportMalformed: string[];
  toast: Toast | null;
}

function load(): LedgerState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as LedgerState;
    } catch {
      // 落盘损坏则重建
    }
  }
  return createInitialState();
}

export const useLedgerStore = defineStore('ledger', {
  state: (): State => ({
    ledger: load(),
    actor: { name: '王保管', role: 'keeper' },
    scopeCabinet: 'A1',
    lastReport: null,
    lastImportText: '',
    lastImportOps: [],
    lastImportMalformed: [],
    toast: null
  }),
  getters: {
    exhibits: (s): ExhibitRecord[] => s.ledger.exhibits,
    cabinets: (s): CabinetRecord[] => s.ledger.cabinets,
    conflicts: (s): Conflict[] => s.ledger.conflicts,
    openConflicts: (s): Conflict[] => s.ledger.conflicts.filter((item) => !item.resolved),
    discrepancies: (s): DiscrepancyRecord[] => s.ledger.discrepancies,
    readings: (s): ReadingPoint[] => s.ledger.readings,
    queue: (s) => s.ledger.placementQueue,
    postedCount: (s) => s.ledger.postedOpIds.length,
    latestReading(): (exhibit: string, metric: string) => ReadingPoint | undefined {
      return (exhibit: string, metric: string) =>
        [...this.readings].reverse().find((p) => p.exhibit === exhibit && p.metric === metric);
    },
    exhibitOpenConflictCount: (s) => (code: string) => s.ledger.conflicts.filter((item) => !item.resolved && item.exhibit === code).length,
    exhibitOpenDiscrepancyCount: (s) => (code: string) => s.ledger.discrepancies.filter((item) => item.exhibit === code && !item.resolved).length
  },
  actions: {
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ledger));
    },
    notify(text: string, color: Toast['color'] = 'info') {
      this.toast = { text, color };
    },
    setActor(actor: Actor) {
      this.actor = actor;
    },
    setScopeCabinet(id: string) {
      this.scopeCabinet = id;
    },
    importText(text: string) {
      const batch = parseHandover(text);
      const { state, report } = applyBatch(this.ledger, batch.device, batch.ops, batch.malformed);
      this.ledger = state;
      this.lastReport = report;
      // 记住原文与解析结果，供"只重试未入账操作"
      this.lastImportText = text;
      this.lastImportOps = batch.ops;
      this.lastImportMalformed = batch.malformed;
      this.persist();
      const c = report.counts;
      const headline = `${report.device}：入账 ${c.posted} · 冲突挂起 ${c.conflict} · 排队 ${c.queued} · 重复跳过 ${c.duplicate} · 失败 ${c.failed}`;
      this.notify(headline, c.failed ? 'warning' : c.conflict || c.queued ? 'warning' : 'success');
    },
    /** 导入失败后：仅重放未入账操作，已入账/已排队的按操作编号跳过 */
    retryUnposted() {
      if (!this.lastImportOps.length) {
        this.notify('没有可重试的批次', 'warning');
        return;
      }
      const unposted = filterUnposted(this.ledger, this.lastImportOps);
      if (!unposted.length) {
        this.notify('所有操作均已入账或排队，无需重试（按操作编号去重）', 'success');
        return;
      }
      const { state, report } = applyBatch(this.ledger, this.lastReport?.device ?? 'RETRY', unposted, []);
      this.ledger = state;
      this.lastReport = report;
      this.persist();
      this.notify(`重试 ${unposted.length} 条未入账操作：入账 ${report.counts.posted} · 冲突 ${report.counts.conflict} · 排队 ${report.counts.queued} · 失败 ${report.counts.failed}`, report.counts.failed ? 'warning' : 'success');
    },
    chooseConflict(conflictId: string, choice: 'ledger' | 'incoming') {
      const result = resolveConflict(this.ledger, conflictId, choice, this.actor, this.scopeCabinet);
      this.ledger = result.state;
      this.persist();
      this.notify(result.message, result.ok ? 'success' : 'error');
    },
    confirm(code: string) {
      const result = confirmConclusion(this.ledger, code, this.actor, this.scopeCabinet);
      this.ledger = result.state;
      this.persist();
      this.notify(result.message, result.ok ? 'success' : 'error');
    },
    resetAll() {
      this.ledger = createInitialState();
      this.lastReport = null;
      this.lastImportText = '';
      this.lastImportOps = [];
      this.lastImportMalformed = [];
      this.persist();
      this.notify('核验账已重置为初始状态', 'info');
    }
  }
});
