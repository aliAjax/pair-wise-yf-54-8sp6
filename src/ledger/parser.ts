import type { HandoverOp, Metric, OpType, Role, ExhibitFieldKey, DiscrepancyAction } from './types';

/**
 * 交接文本格式（行式，# 开头为注释）：
 *   BATCH device=PAD-A
 *   OP|opId|type|key=value|key=value...
 * 例：
 *   OP|OP-0001|FIELD|exhibit=M001|field=name|value=青铜镜|actor=王保管|role=keeper|at=2026-10-01T09:30
 */
export interface ParsedBatch {
  device: string;
  ops: HandoverOp[];
  malformed: string[];
}

const VALID_TYPES: OpType[] = ['FIELD', 'READING', 'DISCREPANCY', 'PLACEMENT'];
const VALID_ROLES: Role[] = ['curator', 'keeper', 'lender'];
const VALID_METRICS: Metric[] = ['temperature', 'humidity', 'light'];
const VALID_FIELDS: ExhibitFieldKey[] = ['name', 'lender', 'note'];

function parseKv(parts: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  // parts[0]=OP parts[1]=操作编号 parts[2]=类型，键值段从 parts[3] 开始
  for (let i = 3; i < parts.length; i += 1) {
    const seg = parts[i];
    const eq = seg.indexOf('=');
    if (eq <= 0) throw new Error(`段格式错误: ${seg}`);
    kv[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }
  return kv;
}

function requireKv(kv: Record<string, string>, key: string, opId: string): string {
  const v = kv[key];
  if (v === undefined || v === '') throw new Error(`操作 ${opId} 缺少 ${key}`);
  return v;
}

export function parseHandover(text: string): ParsedBatch {
  const deviceMatch = text.match(/^\s*BATCH\s+device=(\S+)/m);
  const device = deviceMatch ? deviceMatch[1] : 'UNKNOWN';
  const ops: HandoverOp[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('BATCH')) return;
    if (!line.startsWith('OP|')) {
      malformed.push(line);
      return;
    }
    try {
      const parts = line.split('|');
      if (parts.length < 3) throw new Error('段数不足');
      const opId = parts[1].trim();
      const type = parts[2].trim() as OpType;
      if (!opId) throw new Error('缺少操作编号');
      if (!VALID_TYPES.includes(type)) throw new Error(`未知操作类型 ${type}`);
      if (seen.has(opId)) throw new Error(`批次内操作编号重复 ${opId}`);
      seen.add(opId);
      const kv = parseKv(parts);

      const actor = requireKv(kv, 'actor', opId);
      const role = requireKv(kv, 'role', opId) as Role;
      if (!VALID_ROLES.includes(role)) throw new Error(`操作 ${opId} 角色非法 ${role}`);
      const at = requireKv(kv, 'at', opId);
      if (Number.isNaN(Date.parse(at))) throw new Error(`操作 ${opId} 时间非法 ${at}`);

      const base: HandoverOp = { opId, type, device, actor, role, at };

      if (type === 'FIELD') {
        const field = requireKv(kv, 'field', opId) as ExhibitFieldKey;
        if (!VALID_FIELDS.includes(field)) throw new Error(`操作 ${opId} 字段非法 ${field}`);
        base.exhibit = requireKv(kv, 'exhibit', opId);
        base.field = field;
        base.value = requireKv(kv, 'value', opId);
      } else if (type === 'READING') {
        base.exhibit = requireKv(kv, 'exhibit', opId);
        const metric = requireKv(kv, 'metric', opId) as Metric;
        if (!VALID_METRICS.includes(metric)) throw new Error(`操作 ${opId} 指标非法 ${metric}`);
        const reading = Number(requireKv(kv, 'reading', opId));
        if (!Number.isFinite(reading)) throw new Error(`操作 ${opId} 读数非法`);
        const tolerance = Number(kv.tolerance ?? '0');
        base.metric = metric;
        base.reading = reading;
        base.tolerance = Number.isFinite(tolerance) ? tolerance : 0;
      } else if (type === 'DISCREPANCY') {
        base.exhibit = requireKv(kv, 'exhibit', opId);
        base.dkey = requireKv(kv, 'dkey', opId);
        const action = (kv.action ?? 'ADD') as DiscrepancyAction;
        if (!['ADD', 'RESOLVE'].includes(action)) throw new Error(`操作 ${opId} 差异动作非法`);
        base.action = action;
        if (action === 'ADD') {
          base.detail = requireKv(kv, 'detail', opId);
          base.severity = kv.severity === 'major' ? 'major' : 'minor';
        }
      } else {
        // PLACEMENT
        base.cabinet = requireKv(kv, 'cabinet', opId);
        base.exhibit = requireKv(kv, 'exhibit', opId);
        const op = kv.op ?? 'PLACE';
        if (!['PLACE', 'VACATE'].includes(op)) throw new Error(`操作 ${opId} 柜位动作非法`);
        base.op = op as 'PLACE' | 'VACATE';
      }

      ops.push(base);
    } catch (err) {
      // 任何一条解析失败都不影响其他行，但该行绝不入账
      malformed.push(`${line}   <<< ${(err as Error).message}`);
    }
  });

  return { device, ops, malformed };
}

/** 平板导出：把一批操作序列化成交接文本 */
export function serializeHandover(device: string, ops: HandoverOp[]): string {
  const lines = [`BATCH device=${device}`, `# exported at ${new Date().toISOString()}`];
  for (const op of ops) {
    const parts = ['OP', op.opId, op.type];
    const push = (k: string, v: string | number | undefined) => {
      if (v !== undefined && v !== '') parts.push(`${k}=${v}`);
    };
    push('exhibit', op.exhibit);
    push('field', op.field);
    push('value', op.value);
    push('metric', op.metric);
    push('reading', op.reading);
    push('tolerance', op.tolerance);
    push('action', op.action);
    push('dkey', op.dkey);
    push('detail', op.detail);
    push('severity', op.severity);
    push('cabinet', op.cabinet);
    push('op', op.op);
    push('actor', op.actor);
    push('role', op.role);
    push('at', op.at);
    lines.push(parts.join('|'));
  }
  return lines.join('\n');
}
