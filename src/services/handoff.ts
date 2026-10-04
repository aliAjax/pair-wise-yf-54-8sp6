// 交接文本：离线平板导出、另一台核验设备导入的文本格式。
// 行格式：
//   # 开头为元数据注释
//   [操作编号] 类型 展品编号   —— 一条操作的起始
//     键 = 值                  —— 操作内字段（可多行）
// 空行分隔各操作块。

export type HandoffKind = 'exhibit' | 'reading' | 'discrepancy' | 'cabinet';

export interface HandoffOp {
  opNo: string;
  kind: HandoffKind;
  exhibit: string;
  fields: Record<string, string>;
}

export interface ParsedHandoff {
  source?: string;
  exportedAt?: string;
  ops: HandoffOp[];
  errors: string[];
}

const FIELD_KEY_MAP: Record<string, string> = {
  名称: 'name', name: 'name',
  借展方: 'lender', lender: 'lender',
  柜位: 'cabinet', cabinet: 'cabinet',
  年代: 'era', era: 'era',
  材质: 'material', material: 'material',
  说明: 'note', note: 'note',
  温度: 'temperature', temperature: 'temperature',
  湿度: 'humidity', humidity: 'humidity',
  照度: 'light', light: 'light',
  标题: 'title', title: 'title',
  严重: 'severity', severity: 'severity',
  状态: 'status', status: 'status'
};

const FIELD_LABELS: Record<string, string> = {
  name: '名称', lender: '借展方', cabinet: '柜位', era: '年代', material: '材质', note: '说明',
  temperature: '温度', humidity: '湿度', light: '照度',
  title: '标题', severity: '严重', status: '状态'
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export const KINDS: HandoffKind[] = ['exhibit', 'reading', 'discrepancy', 'cabinet'];

export function parseHandoff(text: string): ParsedHandoff {
  const lines = text.split(/\r?\n/);
  const ops: HandoffOp[] = [];
  const errors: string[] = [];
  let source: string | undefined;
  let exportedAt: string | undefined;
  let current: HandoffOp | null = null;

  const pushCurrent = () => { if (current) { ops.push(current); current = null; } };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const body = line.replace(/^#+\s?/, '');
      const sm = body.match(/^来源平板[:：]\s*(.+)$/);
      if (sm) { source = sm[1].trim(); continue; }
      const tm = body.match(/^导出时间[:：]\s*(.+)$/);
      if (tm) { exportedAt = tm[1].trim(); continue; }
      continue;
    }

    const head = line.match(/^\[([^\]]+)\]\s+([a-z]+)\s+(\S+)\s*$/);
    if (head) {
      pushCurrent();
      const [, opNo, kindRaw, exhibit] = head;
      const kind = kindRaw as HandoffKind;
      if (!KINDS.includes(kind)) {
        errors.push(`第 ${lineNo} 行：未知操作类型「${kindRaw}」`);
      }
      current = { opNo: opNo.trim(), kind: KINDS.includes(kind) ? kind : 'exhibit', exhibit: exhibit.trim(), fields: {} };
      continue;
    }

    const fm = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (fm && current) {
      const rawKey = fm[1].trim();
      const mapped = FIELD_KEY_MAP[rawKey];
      if (!mapped) {
        errors.push(`第 ${lineNo} 行：未知字段「${rawKey}」`);
      } else {
        current.fields[mapped] = fm[2].trim();
      }
      continue;
    }

    errors.push(`第 ${lineNo} 行：无法解析「${raw}」`);
  }
  pushCurrent();

  return { source, exportedAt, ops, errors };
}

export function serializeHandoff(ops: HandoffOp[], meta: { source: string; exportedAt?: string }): string {
  const lines: string[] = [
    '# 博物馆点交交接文本 v1',
    `# 来源平板：${meta.source}`,
    `# 导出时间：${meta.exportedAt ?? new Date().toISOString()}`
  ];
  for (const op of ops) {
    lines.push('');
    lines.push(`[${op.opNo}] ${op.kind} ${op.exhibit}`);
    for (const [key, value] of Object.entries(op.fields)) {
      lines.push(`  ${FIELD_LABELS[key] ?? key} = ${value}`);
    }
  }
  return lines.join('\n');
}
