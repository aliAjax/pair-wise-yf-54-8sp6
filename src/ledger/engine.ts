import type {
  Actor,
  CabinetRecord,
  Conflict,
  ExhibitFieldKey,
  ExhibitRecord,
  FieldVersion,
  HandoverOp,
  ImportReport,
  ImportReportItem,
  LedgerState,
  Metric,
  PostOutcome,
  ReadingPoint,
  AuditEntry
} from './types';

// ---------------------------------------------------------------------------
// 初始核验账
// ---------------------------------------------------------------------------

const SEED_AT = '2026-09-30T18:00:00+08:00';
const FIELD_KEYS: ExhibitFieldKey[] = ['name', 'lender', 'note'];

function seedVersion(value: string): FieldVersion {
  return { value, opId: 'SEED', device: 'LEDGER', actor: '建账', at: SEED_AT };
}

function makeExhibit(code: string, name: string, lender: string, note = ''): ExhibitRecord {
  const fields = {} as ExhibitRecord['fields'];
  const current = {} as ExhibitRecord['current'];
  for (const key of FIELD_KEYS) {
    const value = key === 'name' ? name : key === 'lender' ? lender : note;
    fields[key] = value === '' ? [] : [seedVersion(value)];
    current[key] = value;
  }
  return {
    code,
    fields,
    current,
    conclusion: 'none',
    readingSnapshot: {},
    discrepancySnapshot: {},
    invalidateReasons: [],
    createdAt: SEED_AT
  };
}

export function createInitialState(): LedgerState {
  const readings: ReadingPoint[] = [
    { exhibit: 'M001', metric: 'temperature', value: 20.5, tolerance: 2, opId: 'SEED-R1', device: 'LEDGER', actor: '建账', at: SEED_AT },
    { exhibit: 'M001', metric: 'humidity', value: 50, tolerance: 5, opId: 'SEED-R2', device: 'LEDGER', actor: '建账', at: SEED_AT },
    { exhibit: 'M001', metric: 'light', value: 150, tolerance: 0, opId: 'SEED-R3', device: 'LEDGER', actor: '建账', at: SEED_AT }
  ];
  return {
    exhibits: [
      makeExhibit('M001', '青铜镜', '甘肃省博物馆'),
      makeExhibit('M002', '釉里红瓷瓶', '西北博物院'),
      makeExhibit('M003', '石雕佛首', '某寺文管处'),
      makeExhibit('M004', '鎏金香炉', '私人借展方')
    ],
    readings,
    discrepancies: [],
    cabinets: [
      { id: 'A1', name: 'A1 恒温恒湿展柜', capacity: 2, exhibits: ['M001'] },
      { id: 'B2', name: 'B2 独立展柜', capacity: 2, exhibits: [] }
    ],
    conflicts: [],
    placementQueue: [],
    postedOpIds: ['SEED-R1', 'SEED-R2', 'SEED-R3'],
    audit: []
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function clone(state: LedgerState): LedgerState {
  return structuredClone(state);
}

function audit(draft: LedgerState, entry: Omit<AuditEntry, 'at'> & { at?: string }) {
  draft.audit.unshift({ at: entry.at ?? new Date().toISOString(), ...entry });
  if (draft.audit.length > 300) draft.audit.length = 300;
}

function findExhibit(draft: LedgerState, code: string): ExhibitRecord | undefined {
  return draft.exhibits.find((item) => item.code === code);
}

function cabinetOf(draft: LedgerState, exhibit: string): string | undefined {
  return draft.cabinets.find((cabinet) => cabinet.exhibits.includes(exhibit))?.id;
}

function queuedOpIds(draft: LedgerState): Set<string> {
  return new Set(draft.placementQueue.map((item) => item.opId));
}

/** 已入账 = 已过账 或 已在柜位队列中等待（排队也算终端侧已接收，重传不重复排队） */
function isAccounted(draft: LedgerState, opId: string): boolean {
  return draft.postedOpIds.includes(opId) || queuedOpIds(draft).has(opId);
}

function invalidate(draft: LedgerState, exhibit: ExhibitRecord, reason: string, at: string) {
  if (exhibit.conclusion !== 'reviewed') return;
  exhibit.conclusion = 'review';
  exhibit.invalidateReasons.push(`${at.slice(0, 19).replace('T', ' ')} ${reason}`);
}

function toVersion(op: HandoverOp, value: string): FieldVersion {
  return { value, opId: op.opId, device: op.device, actor: op.actor, at: op.at };
}

/** 找该字段位上尚未选定的冲突 */
function openConflict(
  draft: LedgerState,
  kind: Conflict['kind'],
  exhibit: string,
  field: string,
  dkey?: string
): Conflict | undefined {
  return draft.conflicts.find(
    (item) => !item.resolved && item.kind === kind && item.exhibit === exhibit && item.field === field && item.dkey === dkey
  );
}

// ---------------------------------------------------------------------------
// 单条操作入账（内部在副本上原地修改）
// ---------------------------------------------------------------------------

function postField(draft: LedgerState, op: HandoverOp): PostOutcome {
  const field = op.field as ExhibitFieldKey;
  const value = op.value as string;
  let exhibit = findExhibit(draft, op.exhibit as string);
  if (!exhibit) {
    // 平板先于建账回传：以首条字段操作建账
    exhibit = makeExhibit(op.exhibit as string, field === 'name' ? value : '', field === 'lender' ? value : '', field === 'note' ? value : '');
    exhibit.createdAt = op.at;
    draft.exhibits.push(exhibit);
  }
  const versions = exhibit.fields[field];
  const ledgerValue = exhibit.current[field];

  // 账上该字段尚无值：首版即定版
  if (ledgerValue === '') {
    versions.push(toVersion(op, value));
    exhibit.current[field] = value;
    draft.postedOpIds.push(op.opId);
    audit(draft, { device: op.device, actor: op.actor, action: '字段入账', detail: `${op.exhibit}.${field} 首版定版「${value}」`, opId: op.opId, exhibit: op.exhibit });
    return { status: 'posted', opId: op.opId };
  }

  // 与台账定版值一致：幂等入账，绝不重复追加版本
  if (ledgerValue === value) {
    draft.postedOpIds.push(op.opId);
    audit(draft, { device: op.device, actor: op.actor, action: '字段入账', detail: `${op.exhibit}.${field} 与定版值一致，直接入账`, opId: op.opId, exhibit: op.exhibit });
    return { status: 'posted', opId: op.opId };
  }

  const incoming = toVersion(op, value);
  const cabinetId = cabinetOf(draft, exhibit.code) ?? 'UNASSIGNED';
  const existing = openConflict(draft, 'exhibit-field', exhibit.code, field);

  if (existing) {
    // 冲突挂起期间继续有回传：任何异值都不能覆盖，等待人工选定
    if (existing.incoming.value === value) {
      draft.postedOpIds.push(op.opId);
      audit(draft, { device: op.device, actor: op.actor, action: '字段入账', detail: `${op.exhibit}.${field} 与挂起中的回传版一致，入账待选定`, opId: op.opId, exhibit: op.exhibit });
      return { status: 'posted', opId: op.opId };
    }
    if (!versions.some((v) => v.opId === op.opId)) versions.push(incoming);
    existing.incoming = incoming;
    existing.createdAt = op.at;
    audit(draft, { device: op.device, actor: op.actor, action: '字段冲突刷新', detail: `${op.exhibit}.${field} 待选回传版更新为「${value}」，台账版仍为「${ledgerValue}」`, opId: op.opId, exhibit: op.exhibit });
    return { status: 'conflict', opId: op.opId, conflictId: existing.id };
  }

  // 首次出现异值：同字段两版并列，保留双版本并挂起
  versions.push(incoming);
  const conflict: Conflict = {
    id: `CF-${exhibit.code}-${field}-${op.opId}`,
    kind: 'exhibit-field',
    exhibit: exhibit.code,
    field,
    cabinetId,
    ledger: versions.find((v) => v.value === ledgerValue && v.opId !== op.opId) ?? versions[0],
    incoming,
    resolved: false,
    createdAt: op.at
  };
  draft.conflicts.push(conflict);
  audit(draft, { device: op.device, actor: op.actor, action: '字段冲突挂起', detail: `${op.exhibit}.${field} 台账「${ledgerValue}」 vs 回传「${value}」，待选定`, opId: op.opId, exhibit: op.exhibit });
  return { status: 'conflict', opId: op.opId, conflictId: conflict.id };
}

function postReading(draft: LedgerState, op: HandoverOp): PostOutcome {
  const exhibit = findExhibit(draft, op.exhibit as string);
  if (!exhibit) return { status: 'failed', opId: op.opId, reason: `展品 ${op.exhibit} 尚未建账` };
  const metric = op.metric as Metric;
  const value = op.reading as number;
  const point: ReadingPoint = {
    exhibit: exhibit.code,
    metric,
    value,
    tolerance: op.tolerance ?? 0,
    opId: op.opId,
    device: op.device,
    actor: op.actor,
    at: op.at
  };
  draft.readings.push(point);

  // 已核验结论：读数相对核验时快照发生变化即失效（基线在核验确认时固化）
  if (exhibit.conclusion === 'reviewed') {
    const baseline = exhibit.readingSnapshot[metric];
    if (baseline === undefined || baseline !== value) {
      invalidate(draft, exhibit, `环境读数 ${metric} 变化（${baseline ?? '—'} → ${value}），核验结论失效`, op.at);
    }
  }
  draft.postedOpIds.push(op.opId);
  audit(draft, { device: op.device, actor: op.actor, action: '读数入账', detail: `${op.exhibit} ${metric}=${value}`, opId: op.opId, exhibit: op.exhibit });
  return { status: 'posted', opId: op.opId };
}

function postDiscrepancy(draft: LedgerState, op: HandoverOp): PostOutcome {
  const exhibit = findExhibit(draft, op.exhibit as string);
  if (!exhibit) return { status: 'failed', opId: op.opId, reason: `展品 ${op.exhibit} 尚未建账` };
  const dkey = op.dkey as string;
  const existing = draft.discrepancies.find((item) => item.dkey === dkey && item.exhibit === exhibit.code);

  if (op.action === 'RESOLVE') {
    if (!existing) return { status: 'failed', opId: op.opId, reason: `差异项 ${dkey} 不存在` };
    if (existing.resolved) {
      draft.postedOpIds.push(op.opId);
      return { status: 'posted', opId: op.opId };
    }
    existing.resolved = true;
    existing.updatedAt = op.at;
    if (exhibit.conclusion === 'reviewed') {
      invalidate(draft, exhibit, `差异项 ${dkey} 被标记解决，与核验时状态不一致`, op.at);
    }
    draft.postedOpIds.push(op.opId);
    audit(draft, { device: op.device, actor: op.actor, action: '差异项解决', detail: `${op.exhibit} ${dkey}`, opId: op.opId, exhibit: op.exhibit });
    return { status: 'posted', opId: op.opId };
  }

  // ADD
  const detail = op.detail as string;
  if (!existing) {
    draft.discrepancies.push({
      dkey,
      exhibit: exhibit.code,
      detail: [toVersion(op, detail)],
      currentDetail: detail,
      severity: op.severity ?? 'minor',
      resolved: false,
      createdAt: op.at,
      updatedAt: op.at
    });
    if (exhibit.conclusion === 'reviewed') {
      invalidate(draft, exhibit, `新增差异项 ${dkey}：${detail}`, op.at);
    }
    draft.postedOpIds.push(op.opId);
    audit(draft, { device: op.device, actor: op.actor, action: '差异项登记', detail: `${op.exhibit} ${dkey} ${detail}`, opId: op.opId, exhibit: op.exhibit });
    return { status: 'posted', opId: op.opId };
  }

  if (existing.currentDetail === detail) {
    draft.postedOpIds.push(op.opId);
    return { status: 'posted', opId: op.opId };
  }

  // 同一差异项两版描述并列
  existing.detail.push(toVersion(op, detail));
  existing.updatedAt = op.at;
  const cabinetId = cabinetOf(draft, exhibit.code) ?? 'UNASSIGNED';
  const open = openConflict(draft, 'discrepancy-field', exhibit.code, 'detail', dkey);
  let conflict: Conflict;
  if (open) {
    open.incoming = toVersion(op, detail);
    conflict = open;
  } else {
    conflict = {
      id: `CF-${exhibit.code}-D-${dkey}-${op.opId}`,
      kind: 'discrepancy-field',
      exhibit: exhibit.code,
      dkey,
      field: 'detail',
      cabinetId,
      ledger: existing.detail.find((v) => v.value === existing.currentDetail) ?? existing.detail[0],
      incoming: toVersion(op, detail),
      resolved: false,
      createdAt: op.at
    };
    draft.conflicts.push(conflict);
  }
  audit(draft, { device: op.device, actor: op.actor, action: '差异描述冲突挂起', detail: `${op.exhibit} ${dkey} 台账「${existing.currentDetail}」 vs 回传「${detail}」`, opId: op.opId, exhibit: op.exhibit });
  return { status: 'conflict', opId: op.opId, conflictId: conflict.id };
}

/** 容量释放后，按 FIFO 尝试让排队操作入柜 */
function promoteQueue(draft: LedgerState, cabinetId: string) {
  const waiting = draft.placementQueue.filter((item) => item.cabinet === cabinetId);
  for (const item of waiting) {
    const cabinet = draft.cabinets.find((c) => c.id === cabinetId);
    if (!cabinet) {
      draft.placementQueue = draft.placementQueue.filter((q) => q.opId !== item.opId);
      continue;
    }
    if (cabinet.exhibits.includes(item.exhibit)) {
      // 排队期间已通过其他操作入柜：视为已满足
      draft.placementQueue = draft.placementQueue.filter((q) => q.opId !== item.opId);
      draft.postedOpIds.push(item.opId);
      audit(draft, { device: item.device, actor: item.actor, action: '排队完成', detail: `${item.exhibit} 已在柜 ${cabinetId}，排队操作 ${item.opId} 自动核销`, opId: item.opId, exhibit: item.exhibit });
      continue;
    }
    if (cabinet.exhibits.length >= cabinet.capacity) break;
    cabinet.exhibits.push(item.exhibit);
    draft.placementQueue = draft.placementQueue.filter((q) => q.opId !== item.opId);
    draft.postedOpIds.push(item.opId);
    audit(draft, { device: item.device, actor: item.actor, action: '排队入柜', detail: `${item.exhibit} 排入 ${cabinetId}（${cabinet.exhibits.length}/${cabinet.capacity}）`, opId: item.opId, exhibit: item.exhibit });
  }
}

function postPlacement(draft: LedgerState, op: HandoverOp): PostOutcome {
  const cabinetId = op.cabinet as string;
  const code = op.exhibit as string;
  const cabinet = draft.cabinets.find((item) => item.id === cabinetId);
  if (!cabinet) return { status: 'failed', opId: op.opId, reason: `柜位 ${cabinetId} 不存在` };
  if (!findExhibit(draft, code)) return { status: 'failed', opId: op.opId, reason: `展品 ${code} 尚未建账` };

  if (op.op === 'VACATE') {
    const from = draft.cabinets.find((c) => c.exhibits.includes(code));
    if (from) {
      from.exhibits = from.exhibits.filter((item) => item !== code);
      audit(draft, { device: op.device, actor: op.actor, action: '出柜', detail: `${code} 移出 ${from.id}`, opId: op.opId, exhibit: code });
      promoteQueue(draft, from.id);
    }
    draft.postedOpIds.push(op.opId);
    return { status: 'posted', opId: op.opId };
  }

  // PLACE
  if (cabinet.exhibits.includes(code)) {
    draft.postedOpIds.push(op.opId);
    return { status: 'posted', opId: op.opId };
  }
  const from = draft.cabinets.find((c) => c.exhibits.includes(code));
  const incoming = from ? cabinet.exhibits.length + 1 : cabinet.exhibits.length;
  if (incoming > cabinet.capacity || cabinet.exhibits.length >= cabinet.capacity) {
    // 容量满：先排队，不入账，待柜位释放后自动入柜
    draft.placementQueue.push({ opId: op.opId, cabinet: cabinetId, exhibit: code, device: op.device, actor: op.actor, at: op.at });
    audit(draft, { device: op.device, actor: op.actor, action: '柜满排队', detail: `${code} 等待 ${cabinetId}（${cabinet.exhibits.length}/${cabinet.capacity}）`, opId: op.opId, exhibit: code });
    return { status: 'queued', opId: op.opId };
  }
  if (from) from.exhibits = from.exhibits.filter((item) => item !== code);
  cabinet.exhibits.push(code);
  draft.postedOpIds.push(op.opId);
  audit(draft, { device: op.device, actor: op.actor, action: '入柜', detail: `${code} 入 ${cabinetId}（${cabinet.exhibits.length}/${cabinet.capacity}）`, opId: op.opId, exhibit: code });
  promoteQueue(draft, cabinetId);
  return { status: 'posted', opId: op.opId };
}

function postOne(draft: LedgerState, op: HandoverOp): PostOutcome {
  if (isAccounted(draft, op.opId)) {
    return { status: 'duplicate', opId: op.opId };
  }
  switch (op.type) {
    case 'FIELD':
      return postField(draft, op);
    case 'READING':
      return postReading(draft, op);
    case 'DISCREPANCY':
      return postDiscrepancy(draft, op);
    case 'PLACEMENT':
      return postPlacement(draft, op);
    default:
      return { status: 'failed', opId: op.opId, reason: '未知操作类型' };
  }
}

// ---------------------------------------------------------------------------
// 批次导入
// ---------------------------------------------------------------------------

export interface BatchResult {
  state: LedgerState;
  report: ImportReport;
}

export function applyBatch(state: LedgerState, device: string, ops: HandoverOp[], malformed: string[]): BatchResult {
  const draft = clone(state);
  const items: ImportReportItem[] = [];
  const counts = { posted: 0, conflict: 0, queued: 0, duplicate: 0, failed: 0 };
  for (const op of ops) {
    const outcome = postOne(draft, op);
    items.push({ opId: op.opId, type: op.type, raw: `${op.type} ${op.exhibit ?? ''}`, outcome });
    counts[outcome.status] += 1;
  }
  return { state: draft, report: { device, at: new Date().toISOString(), items, malformed, counts } };
}

/** 只挑出未入账（未过账、未排队）的操作，用于导入失败后的重试 */
export function filterUnposted(state: LedgerState, ops: HandoverOp[]): HandoverOp[] {
  const queued = queuedOpIds(state);
  return ops.filter((op) => !state.postedOpIds.includes(op.opId) && !queued.has(op.opId));
}

// ---------------------------------------------------------------------------
// 冲突选定（权限：策展人全局；保管员仅本柜；借展方无权）
// ---------------------------------------------------------------------------

export interface ActionResult {
  ok: boolean;
  state: LedgerState;
  message: string;
}

export function resolveConflict(state: LedgerState, conflictId: string, choice: 'ledger' | 'incoming', actor: Actor, scopeCabinet?: string): ActionResult {
  const draft = clone(state);
  const conflict = draft.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return { ok: false, state, message: '冲突不存在' };
  if (conflict.resolved) return { ok: false, state, message: '该冲突已选定' };
  if (actor.role === 'lender') {
    audit(draft, { actor: actor.name, action: '越权拒绝', detail: `借展方试图选定冲突 ${conflictId}`, exhibit: conflict.exhibit, denied: true });
    return { ok: false, state: draft, message: '越权确认已拒绝：借展方无字段定版权' };
  }
  if (actor.role === 'keeper' && conflict.cabinetId !== scopeCabinet) {
    audit(draft, { actor: actor.name, action: '越权拒绝', detail: `保管员试图处理非本柜冲突 ${conflictId}（冲突属 ${conflict.cabinetId}，管辖 ${scopeCabinet ?? '无'}）`, exhibit: conflict.exhibit, denied: true });
    return { ok: false, state: draft, message: `越权确认已拒绝：该冲突属于柜 ${conflict.cabinetId}，保管员只能处理本柜冲突` };
  }
  const chosen = choice === 'ledger' ? conflict.ledger : conflict.incoming;
  if (!chosen) return { ok: false, state, message: '所选版本不存在' };

  if (conflict.kind === 'exhibit-field') {
    const exhibit = findExhibit(draft, conflict.exhibit);
    if (exhibit) exhibit.current[conflict.field as ExhibitFieldKey] = chosen.value;
  } else {
    const discrepancy = draft.discrepancies.find((item) => item.dkey === conflict.dkey && item.exhibit === conflict.exhibit);
    if (discrepancy) discrepancy.currentDetail = chosen.value;
  }
  conflict.resolved = true;
  conflict.choice = choice;
  conflict.chosenBy = actor.name;
  conflict.chosenAt = new Date().toISOString();
  audit(draft, {
    actor: actor.name,
    device: 'TERMINAL',
    action: '冲突选定',
    detail: `${conflict.exhibit} ${conflict.field} 采用${choice === 'ledger' ? '台账版' : '回传版'}「${chosen.value}」（来源 ${chosen.device}/${chosen.opId}）`,
    exhibit: conflict.exhibit
  });
  return { ok: true, state: draft, message: '已选定并定版' };
}

// ---------------------------------------------------------------------------
// 核验确认：冲突全部选定且差异项关闭后才能推进；读数/差异变化后自动退回待复核
// ---------------------------------------------------------------------------

export function confirmConclusion(state: LedgerState, exhibitCode: string, actor: Actor, scopeCabinet?: string): ActionResult {
  const draft = clone(state);
  const exhibit = findExhibit(draft, exhibitCode);
  if (!exhibit) return { ok: false, state, message: '展品不存在' };

  if (actor.role === 'lender') {
    audit(draft, { actor: actor.name, action: '越权拒绝', detail: `借展方试图确认 ${exhibitCode} 核验结论`, exhibit: exhibitCode, denied: true });
    return { ok: false, state: draft, message: '越权确认已拒绝：借展方不能确认核验结论' };
  }
  const ownerCabinet = cabinetOf(draft, exhibitCode);
  if (actor.role === 'keeper' && ownerCabinet !== scopeCabinet) {
    audit(draft, { actor: actor.name, action: '越权拒绝', detail: `保管员试图确认非本柜展品 ${exhibitCode}（属 ${ownerCabinet ?? '未入柜'}，管辖 ${scopeCabinet ?? '无'}）`, exhibit: exhibitCode, denied: true });
    return { ok: false, state: draft, message: `越权确认已拒绝：保管员只能确认本柜（${scopeCabinet ?? '无'}）展品，该展品在 ${ownerCabinet ?? '未入柜'}` };
  }

  const openConflicts = draft.conflicts.filter((item) => !item.resolved && item.exhibit === exhibitCode);
  if (openConflicts.length) {
    return { ok: false, state: draft, message: `仍有 ${openConflicts.length} 个并列字段未选定，选定后才能推进` };
  }
  const openDiscrepancies = draft.discrepancies.filter((item) => item.exhibit === exhibitCode && !item.resolved);
  if (openDiscrepancies.length) {
    return { ok: false, state: draft, message: `仍有 ${openDiscrepancies.length} 个未解决差异项，关闭后才能推进` };
  }

  exhibit.conclusion = 'reviewed';
  exhibit.conclusionAt = new Date().toISOString();
  exhibit.invalidateReasons = [];
  // 记录核验时刻基线：读数与差异项状态
  const snapshot: ExhibitRecord['readingSnapshot'] = {};
  for (const metric of ['temperature', 'humidity', 'light'] as Metric[]) {
    const latest = [...draft.readings].reverse().find((p) => p.exhibit === exhibitCode && p.metric === metric);
    if (latest) snapshot[metric] = latest.value;
  }
  exhibit.readingSnapshot = snapshot;
  exhibit.discrepancySnapshot = Object.fromEntries(
    draft.discrepancies.filter((item) => item.exhibit === exhibitCode).map((item) => [item.dkey, item.resolved])
  );
  audit(draft, { actor: actor.name, device: 'TERMINAL', action: '核验确认', detail: `${exhibitCode} 核验通过，基线读数 ${JSON.stringify(snapshot)}`, exhibit: exhibitCode });
  return { ok: true, state: draft, message: '核验结论已确认' };
}
