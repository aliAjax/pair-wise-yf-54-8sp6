import { defineStore } from 'pinia';
import { parseHandoff, type HandoffKind } from '../services/handoff';

// ---------- 类型 ----------
export type Role = 'curator' | 'keeper' | 'lender' | 'installer';
export type OpStatus = 'posted' | 'failed';
export type ConclusionStatus = 'none' | 'confirmed' | 'invalidated';
export type Stage = 'arrival' | 'install' | 'return';
export type MessageKind = 'ok' | 'warn' | 'err';

export interface FieldVersion { value: string; source: string; opNo: string; at: number; }
export interface FieldConflict {
  field: string;
  versions: FieldVersion[];
  selected: number | null;
  resolvedBy?: string;
  resolvedAt?: number;
}
export interface LedgerDiscrepancy {
  id: string;
  title: string;
  severity: 'minor' | 'major';
  resolved: boolean;
  opNo: string;
}
export interface LedgerExhibit {
  code: string;
  name: string;
  lender: string;
  cabinet: string;
  era: string;
  material: string;
  note: string;
  readings: { temperature: number; humidity: number; light: number };
  discrepancies: LedgerDiscrepancy[];
  conclusion: ConclusionStatus;
  confirmedReadings: string;
  confirmedDiscrepancies: string;
  conflicts: Record<string, FieldConflict>;
  provenance: Record<string, { source: string; opNo: string; at: number }>;
  stage: Stage;
}
export interface LedgerOp {
  opNo: string;
  kind: HandoffKind;
  exhibit: string;
  fields: Record<string, string>;
  source: string;
  status: OpStatus;
  attempts: number;
  error?: string;
  postedAt?: number;
}
export interface Cabinet { id: string; name: string; capacity: number; }
export interface QueueItem { exhibitId: string; cabinetId: string; at: number; }
export interface ImportLog {
  at: number;
  source: string;
  total: number;
  posted: number;
  failed: number;
  skipped: number;
  errors: string[];
}
export interface LedgerMessage { kind: MessageKind; text: string; at: number; }

interface LedgerState {
  exhibits: Record<string, LedgerExhibit>;
  ops: Record<string, LedgerOp>;
  opOrder: string[];
  cabinets: Cabinet[];
  queue: QueueItem[];
  role: Role;
  keeperCabinet: string;
  logs: ImportLog[];
  message: LedgerMessage | null;
}

const SCALAR_FIELDS = ['name', 'lender', 'era', 'material', 'note'] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

// ---------- 角色 ----------
export const ROLE_LABELS: Record<Role, string> = {
  curator: '策展人',
  keeper: '保管员',
  lender: '借展方',
  installer: '布展负责人'
};

type Action = 'resolveConflict' | 'confirmConclusion' | 'resolveDiscrepancy' | 'adjustCabinet' | 'advance' | 'promoteQueue' | 'import';

function can(state: LedgerState, action: Action, ex?: LedgerExhibit): boolean {
  switch (action) {
    case 'import':
      return true;
    case 'advance':
    case 'promoteQueue':
      return state.role === 'curator' || action === 'promoteQueue' && state.role === 'installer';
    case 'adjustCabinet':
      return state.role === 'curator' || state.role === 'installer';
    case 'resolveConflict':
    case 'confirmConclusion':
    case 'resolveDiscrepancy':
      if (state.role === 'curator') return true;
      if (state.role === 'keeper') return !!ex && ex.cabinet === state.keeperCabinet;
      return false;
  }
}

// ---------- 状态变更纯函数（种子与导入共用，保证一致） ----------
function newExhibit(code: string): LedgerExhibit {
  return {
    code, name: '', lender: '', cabinet: '', era: '', material: '', note: '',
    readings: { temperature: 20, humidity: 50, light: 150 },
    discrepancies: [],
    conclusion: 'none',
    confirmedReadings: '',
    confirmedDiscrepancies: '',
    conflicts: {},
    provenance: {},
    stage: 'arrival'
  };
}

function setScalar(ex: LedgerExhibit, key: string, value: string, opNo: string, source: string): void {
  if (!(SCALAR_FIELDS as readonly string[]).includes(key)) return;
  const field = key as ScalarField;
  if (ex[field] === undefined || ex[field] === '') {
    ex[field] = value;
    ex.provenance[field] = { source, opNo, at: Date.now() };
    return;
  }
  if (String(ex[field]) === value) return;
  let conflict = ex.conflicts[field];
  if (!conflict) {
    const prov = ex.provenance[field] ?? { source: 'seed', opNo: 'seed', at: 0 };
    conflict = {
      field,
      versions: [{ value: String(ex[field]), source: prov.source, opNo: prov.opNo, at: prov.at }],
      selected: null
    };
    ex.conflicts[field] = conflict;
  }
  if (!conflict.versions.some((v) => v.value === value)) {
    conflict.versions.push({ value, source, opNo, at: Date.now() });
  }
  if (conflict.selected !== null && conflict.versions[conflict.selected]?.value !== value) {
    conflict.selected = null; // 新版与已选定版本冲突，需重新选定
  }
}

function assignCabinetToState(state: LedgerState, ex: LedgerExhibit, cabinetId: string, opNo: string, source: string): 'assigned' | 'queued' {
  const cab = state.cabinets.find((c) => c.id === cabinetId);
  if (!cab) throw new Error(`未知柜位「${cabinetId}」`);
  const queued = state.queue.find((q) => q.exhibitId === ex.code);
  if (queued) { queued.cabinetId = cabinetId; return 'queued'; }
  const assigned = Object.values(state.exhibits).filter((e) => e.cabinet === cabinetId && e.code !== ex.code).length;
  if (assigned >= cab.capacity) {
    state.queue.push({ exhibitId: ex.code, cabinetId, at: Date.now() });
    return 'queued';
  }
  ex.cabinet = cabinetId;
  ex.provenance.cabinet = { source, opNo, at: Date.now() };
  return 'assigned';
}

function invalidateIfNeeded(state: LedgerState, ex: LedgerExhibit): boolean {
  if (ex.conclusion !== 'confirmed') return false;
  const rSnap = JSON.stringify(ex.readings);
  const dSnap = JSON.stringify(
    ex.discrepancies
      .map((d) => ({ title: d.title, severity: d.severity, resolved: d.resolved }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  );
  if (rSnap !== ex.confirmedReadings || dSnap !== ex.confirmedDiscrepancies) {
    ex.conclusion = 'invalidated';
    return true;
  }
  return false;
}

interface ApplyResult { invalidated: boolean; queued: boolean; }

function applyOpToState(
  state: LedgerState,
  p: { opNo: string; kind: HandoffKind; exhibit: string; fields: Record<string, string> },
  source: string
): ApplyResult {
  const code = p.exhibit.trim();
  if (!code) throw new Error('操作缺少展品编号');
  const isNew = !state.exhibits[code];
  let ex = state.exhibits[code];
  if (!ex) { ex = newExhibit(code); state.exhibits[code] = ex; }

  if (p.kind === 'exhibit') {
    if (isNew && !p.fields.name) throw new Error('新展品缺少名称');
    let queued = false;
    for (const [k, v] of Object.entries(p.fields)) {
      if (k === 'cabinet') {
        if (assignCabinetToState(state, ex, v, p.opNo, source) === 'queued') queued = true;
      } else {
        setScalar(ex, k, v, p.opNo, source);
      }
    }
    return { invalidated: false, queued };
  }

  if (p.kind === 'reading') {
    const r = { ...ex.readings };
    if (p.fields.temperature !== undefined) { const n = Number(p.fields.temperature); if (!Number.isFinite(n)) throw new Error('温度必须是数字'); r.temperature = n; }
    if (p.fields.humidity !== undefined) { const n = Number(p.fields.humidity); if (!Number.isFinite(n)) throw new Error('湿度必须是数字'); r.humidity = n; }
    if (p.fields.light !== undefined) { const n = Number(p.fields.light); if (!Number.isFinite(n)) throw new Error('照度必须是数字'); r.light = n; }
    ex.readings = r;
    return { invalidated: invalidateIfNeeded(state, ex), queued: false };
  }

  if (p.kind === 'discrepancy') {
    if (!p.fields.title) throw new Error('差异项缺少标题');
    const sev = p.fields.severity;
    if (sev !== undefined && sev !== 'minor' && sev !== 'major') throw new Error(`严重程度「${sev}」非法，应为 minor 或 major`);
    const severity = (sev as 'minor' | 'major') ?? 'minor';
    const existing = ex.discrepancies.find((d) => d.title === p.fields.title);
    if (existing) existing.severity = severity;
    else ex.discrepancies.push({ id: `d-${p.opNo}`, title: p.fields.title, severity, resolved: false, opNo: p.opNo });
    return { invalidated: invalidateIfNeeded(state, ex), queued: false };
  }

  // cabinet
  if (!p.fields.cabinet) throw new Error('柜位操作缺少柜位');
  return { invalidated: false, queued: assignCabinetToState(state, ex, p.fields.cabinet, p.opNo, source) === 'queued' };
}

// ---------- 种子 ----------
function buildSeedState(): LedgerState {
  const state: LedgerState = {
    exhibits: {},
    ops: {},
    opOrder: [],
    cabinets: [
      { id: 'A2', name: 'A2 温湿展柜', capacity: 4 },
      { id: 'B1', name: 'B1 开放展区', capacity: 6 },
      { id: 'C3', name: 'C3 书画柜', capacity: 2 }
    ],
    queue: [],
    role: 'curator',
    keeperCabinet: 'A2',
    logs: [],
    message: null
  };

  const seedOps: { opNo: string; kind: HandoffKind; exhibit: string; fields: Record<string, string> }[] = [
    { opNo: 'OP-A1', kind: 'exhibit', exhibit: 'M001', fields: { name: '青铜镜', lender: '西北博物馆', cabinet: 'A2', era: '商' } },
    { opNo: 'OP-A2', kind: 'reading', exhibit: 'M001', fields: { temperature: '22', humidity: '50', light: '180' } },
    { opNo: 'OP-A3', kind: 'exhibit', exhibit: 'M002', fields: { name: '釉里红瓷瓶', lender: '私人借展方', cabinet: 'A2', era: '元' } },
    { opNo: 'OP-A4', kind: 'reading', exhibit: 'M002', fields: { temperature: '24', humidity: '55', light: '200' } },
    { opNo: 'OP-A5', kind: 'exhibit', exhibit: 'M003', fields: { name: '石雕佛首', lender: '西北博物馆', cabinet: 'B1' } },
    { opNo: 'OP-A6', kind: 'reading', exhibit: 'M003', fields: { temperature: '21', humidity: '48', light: '150' } },
    { opNo: 'OP-A7', kind: 'exhibit', exhibit: 'M004', fields: { name: '手抄经卷', lender: '私人借展方', cabinet: 'C3' } },
    { opNo: 'OP-A8', kind: 'reading', exhibit: 'M004', fields: { temperature: '20', humidity: '45', light: '120' } },
    { opNo: 'OP-A9', kind: 'exhibit', exhibit: 'M005', fields: { name: '鎏金香炉', lender: '西北博物馆', cabinet: 'C3' } },
    { opNo: 'OP-A10', kind: 'reading', exhibit: 'M005', fields: { temperature: '22', humidity: '50', light: '155' } },
    { opNo: 'OP-A11', kind: 'exhibit', exhibit: 'M006', fields: { name: '青铜簋', lender: '私人借展方', cabinet: 'B1', material: '青铜' } },
    { opNo: 'OP-A12', kind: 'reading', exhibit: 'M006', fields: { temperature: '22', humidity: '50', light: '170' } },
    { opNo: 'OP-A13', kind: 'exhibit', exhibit: 'M007', fields: { name: '宋代书画', lender: '西北博物馆', cabinet: 'C3' } },
    { opNo: 'OP-A14', kind: 'reading', exhibit: 'M007', fields: { temperature: '20', humidity: '46', light: '130' } }
  ];

  for (const def of seedOps) {
    applyOpToState(state, def, 'tablet-A');
    state.ops[def.opNo] = {
      opNo: def.opNo, kind: def.kind, exhibit: def.exhibit,
      fields: { ...def.fields }, source: 'tablet-A',
      status: 'posted', attempts: 1, postedAt: Date.now()
    };
    state.opOrder.push(def.opNo);
  }

  const m1 = state.exhibits['M001'];
  if (m1) {
    m1.conclusion = 'confirmed';
    m1.confirmedReadings = JSON.stringify(m1.readings);
    m1.confirmedDiscrepancies = JSON.stringify([]);
  }
  for (const code of ['M003', 'M005']) {
    const ex = state.exhibits[code];
    if (ex) {
      ex.conclusion = 'confirmed';
      ex.confirmedReadings = JSON.stringify(ex.readings);
      ex.confirmedDiscrepancies = JSON.stringify([]);
    }
  }
  return state;
}

function loadState(): LedgerState {
  const saved = localStorage.getItem('yf54-ledger-state');
  if (saved) {
    try { return JSON.parse(saved) as LedgerState; } catch { /* 落回种子 */ }
  }
  return buildSeedState();
}

// ---------- 示例交接文本 ----------
export const SAMPLE_TABLET_B = `# 博物馆点交交接文本 v1
# 来源平板：tablet-B
# 导出时间：2026-10-04T09:30:00Z

[OP-B1] exhibit M001
  年代 = 周

[OP-B2] exhibit M003
  名称 = 石雕佛像

[OP-B3] discrepancy M003
  标题 = 封条开裂
  严重 = major

[OP-B4] reading M005
  温度 = 23
  湿度 = 52
  照度 = 160

[OP-B5] exhibit M006
  名称 = 青铜器
  材质 = 红铜

[OP-B6] discrepancy M002
  标题 = 包装破损
  严重 = critical

[OP-B7] reading M004
  温度 = 偏高`;

export const SAMPLE_TABLET_B_FIX = `# 博物馆点交交接文本 v1
# 来源平板：tablet-B
# 导出时间：2026-10-04T10:10:00Z

[OP-B6] discrepancy M002
  标题 = 包装破损
  严重 = major

[OP-B7] reading M004
  温度 = 22`;

// ---------- Store ----------
export const useLedgerStore = defineStore('ledger', {
  state: (): LedgerState => loadState(),

  getters: {
    exhibitList: (state) => Object.values(state.exhibits).sort((a, b) => a.code.localeCompare(b.code)),
    unresolvedConflicts: (state) =>
      Object.values(state.exhibits).flatMap((ex) =>
        Object.values(ex.conflicts).filter((c) => c.selected === null).map((c) => ({ ex, conflict: c }))
      ),
    pendingReview: (state) => Object.values(state.exhibits).filter((ex) => ex.conclusion === 'invalidated'),
    failedOps: (state) => Object.values(state.ops).filter((o) => o.status === 'failed'),
    queuedItems: (state) => state.queue.map((q) => ({ q, ex: state.exhibits[q.exhibitId] })).filter((x) => x.ex),
    cabinetStats: (state) =>
      state.cabinets.map((cab) => ({
        cab,
        assigned: Object.values(state.exhibits).filter((e) => e.cabinet === cab.id).length,
        queued: state.queue.filter((q) => q.cabinetId === cab.id).length
      })),
    confirmedCount: (state) => Object.values(state.exhibits).filter((e) => e.conclusion === 'confirmed').length,
    can: (state) => (action: Action, ex?: LedgerExhibit) => can(state, action, ex)
  },

  actions: {
    persist() { localStorage.setItem('yf54-ledger-state', JSON.stringify(this.$state)); },

    notify(kind: MessageKind, text: string) {
      this.message = { kind, text, at: Date.now() };
    },
    clearMessage() { this.message = null; },

    setRole(role: Role) {
      this.role = role;
      this.notify('ok', `当前身份：${ROLE_LABELS[role]}`);
      this.persist();
    },

    // 导入交接文本：按操作编号去重，已入账跳过，失败的落 failed 待重试
    importHandoff(text: string) {
      const parsed = parseHandoff(text);
      const log: ImportLog = {
        at: Date.now(), source: parsed.source ?? '未知',
        total: parsed.ops.length, posted: 0, failed: 0, skipped: 0,
        errors: [...parsed.errors]
      };
      let invalidated = 0;
      let queued = 0;

      for (const p of parsed.ops) {
        const existing = this.ops[p.opNo];
        if (existing && existing.status === 'posted') { log.skipped += 1; continue; }

        const op: LedgerOp = {
          opNo: p.opNo, kind: p.kind, exhibit: p.exhibit,
          fields: { ...p.fields }, source: parsed.source ?? existing?.source ?? '未知',
          status: 'failed', attempts: (existing?.attempts ?? 0) + 1
        };
        try {
          const res = applyOpToState(this.$state, p, op.source);
          op.status = 'posted';
          op.postedAt = Date.now();
          log.posted += 1;
          if (res.invalidated) invalidated += 1;
          if (res.queued) queued += 1;
        } catch (e) {
          op.status = 'failed';
          op.error = (e as Error).message;
          log.failed += 1;
          log.errors.push(`${p.opNo}：${(e as Error).message}`);
        }
        this.ops[p.opNo] = op;
        if (!this.opOrder.includes(p.opNo)) this.opOrder.push(p.opNo);
      }

      this.logs.unshift(log);
      this.persist();

      const parts = [`导入完成：${log.posted} 笔入账`];
      if (log.skipped) parts.push(`${log.skipped} 笔已入账跳过`);
      if (log.failed) parts.push(`${log.failed} 笔失败`);
      if (invalidated) parts.push(`${invalidated} 件展品结论失效退回待复核`);
      if (queued) parts.push(`${queued} 件柜位已满排队`);
      if (log.failed) this.notify('warn', parts.join('，') + '。可点「重试未入账」只补失败操作');
      else this.notify('ok', parts.join('，'));
    },

    // 只重试未入账（failed）操作，已入账的一律跳过
    retryFailed() {
      const failed = Object.values(this.ops).filter((o) => o.status === 'failed');
      if (!failed.length) { this.notify('ok', '没有未入账的失败操作'); return; }
      let posted = 0;
      let stillFailed = 0;
      for (const op of failed) {
        op.attempts += 1;
        op.error = undefined;
        try {
          applyOpToState(this.$state, { opNo: op.opNo, kind: op.kind, exhibit: op.exhibit, fields: op.fields }, op.source);
          op.status = 'posted';
          op.postedAt = Date.now();
          posted += 1;
        } catch (e) {
          op.status = 'failed';
          op.error = (e as Error).message;
          stillFailed += 1;
        }
      }
      this.persist();
      if (stillFailed) this.notify('warn', `重试未入账 ${failed.length} 笔：${posted} 笔入账，${stillFailed} 笔仍失败（已入账操作未重跑）`);
      else this.notify('ok', `重试未入账 ${failed.length} 笔全部入账`);
    },

    // 选定冲突版本后才能推进
    resolveConflict(exhibitCode: string, field: string, versionIndex: number) {
      const ex = this.exhibits[exhibitCode];
      const conflict = ex?.conflicts[field];
      if (!ex || !conflict) return;
      if (!can(this.$state, 'resolveConflict', ex)) {
        this.notify('err', `越权拒绝：${ROLE_LABELS[this.role]}只能处理本柜（${this.keeperCabinet}）冲突，${ex.code} 在 ${ex.cabinet || '未分配'} 柜`);
        return;
      }
      const version = conflict.versions[versionIndex];
      if (!version) return;
      (ex as unknown as Record<string, string>)[field] = version.value;
      ex.provenance[field] = { source: version.source, opNo: version.opNo, at: version.at };
      conflict.selected = versionIndex;
      conflict.resolvedBy = this.role;
      conflict.resolvedAt = Date.now();
      this.persist();
      this.notify('ok', `已为 ${ex.code}「${fieldLabel(field)}」选定版本：${version.value}`);
    },

    resolveDiscrepancy(exhibitCode: string, discId: string) {
      const ex = this.exhibits[exhibitCode];
      const disc = ex?.discrepancies.find((d) => d.id === discId);
      if (!ex || !disc) return;
      if (!can(this.$state, 'resolveDiscrepancy', ex)) {
        this.notify('err', `越权拒绝：${ROLE_LABELS[this.role]}只能处理本柜（${this.keeperCabinet}）差异，${ex.code} 在 ${ex.cabinet || '未分配'} 柜`);
        return;
      }
      disc.resolved = true;
      const invalidated = invalidateIfNeeded(this.$state, ex);
      this.persist();
      if (invalidated) this.notify('warn', `差异状态变化，${ex.code} 结论失效，退回待复核`);
      else this.notify('ok', `差异项已解决：${disc.title}`);
    },

    confirmConclusion(exhibitCode: string) {
      const ex = this.exhibits[exhibitCode];
      if (!ex) return;
      if (!can(this.$state, 'confirmConclusion', ex)) {
        this.notify('err', `越权拒绝：${ROLE_LABELS[this.role]}无权确认 ${ex.cabinet || '未分配'} 柜展品结论（保管员仅限本柜 ${this.keeperCabinet}）`);
        return;
      }
      ex.conclusion = 'confirmed';
      ex.confirmedReadings = JSON.stringify(ex.readings);
      ex.confirmedDiscrepancies = JSON.stringify(
        ex.discrepancies
          .map((d) => ({ title: d.title, severity: d.severity, resolved: d.resolved }))
          .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
      );
      this.persist();
      this.notify('ok', `${ex.code} 核验结论已确认并快照`);
    },

    advance(exhibitCode: string) {
      const ex = this.exhibits[exhibitCode];
      if (!ex) return;
      if (!can(this.$state, 'advance')) {
        this.notify('err', `越权拒绝：仅策展人可推进阶段，当前身份为${ROLE_LABELS[this.role]}`);
        return;
      }
      const unresolved = Object.values(ex.conflicts).filter((c) => c.selected === null);
      if (unresolved.length) {
        this.notify('err', `拒绝推进：${ex.code} 有 ${unresolved.length} 个字段冲突未选定版本`);
        return;
      }
      if (ex.conclusion === 'invalidated') {
        this.notify('err', `拒绝推进：${ex.code} 结论已失效，退回待复核，需重新确认`);
        return;
      }
      if (ex.conclusion !== 'confirmed') {
        this.notify('err', `拒绝推进：${ex.code} 尚未确认核验结论`);
        return;
      }
      ex.stage = ex.stage === 'arrival' ? 'install' : ex.stage === 'install' ? 'return' : 'return';
      this.persist();
      this.notify('ok', `${ex.code} 已推进到下一阶段`);
    },

    adjustCabinet(exhibitCode: string, cabinetId: string) {
      const ex = this.exhibits[exhibitCode];
      if (!ex) return;
      if (!can(this.$state, 'adjustCabinet')) {
        this.notify('err', `越权拒绝：${ROLE_LABELS[this.role]}无权调整柜位`);
        return;
      }
      try {
        const res = assignCabinetToState(this.$state, ex, cabinetId, 'manual', this.role);
        this.persist();
        if (res === 'queued') this.notify('warn', `柜位已满，${ex.code} 已排队候位`);
        else this.notify('ok', `${ex.code} 已安排到 ${cabinetId} 柜位`);
      } catch (e) {
        this.notify('err', (e as Error).message);
      }
    },

    promoteQueue(cabinetId: string) {
      if (!can(this.$state, 'promoteQueue')) {
        this.notify('err', `越权拒绝：${ROLE_LABELS[this.role]}无权安排排队展品入柜`);
        return;
      }
      const cab = this.cabinets.find((c) => c.id === cabinetId);
      if (!cab) return;
      const waiting = this.queue.filter((q) => q.cabinetId === cabinetId).sort((a, b) => a.at - b.at);
      if (!waiting.length) { this.notify('ok', `${cab.name} 无排队展品`); return; }
      const assigned = Object.values(this.exhibits).filter((e) => e.cabinet === cabinetId).length;
      if (assigned >= cab.capacity) { this.notify('warn', `${cab.name} 仍满（${assigned}/${cab.capacity}），无法入柜`); return; }
      const item = waiting[0];
      const ex = this.exhibits[item.exhibitId];
      if (!ex) { this.queue = this.queue.filter((q) => q !== item); return; }
      ex.cabinet = cabinetId;
      ex.provenance.cabinet = { source: 'queue', opNo: 'promote', at: Date.now() };
      this.queue = this.queue.filter((q) => q !== item);
      this.persist();
      this.notify('ok', `${ex.code} 已从排队补入 ${cab.name}`);
    },

    resetAll() {
      localStorage.removeItem('yf54-ledger-state');
      this.$state = buildSeedState();
      this.notify('ok', '已重置为演示数据');
    }
  }
});

function fieldLabel(field: string): string {
  const map: Record<string, string> = { name: '名称', lender: '借展方', cabinet: '柜位', era: '年代', material: '材质', note: '说明' };
  return map[field] ?? field;
}
