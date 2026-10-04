// 借展点交核验账核心类型定义

/** 终端角色：保管员只能处理本柜冲突，借展方无确认权，策展/核验人全局权限 */
export type Role = 'curator' | 'keeper' | 'lender';

export interface Actor {
  name: string;
  role: Role;
}

/** 可被两版并列的展品字段（同字段冲突时逐字段定版） */
export type ExhibitFieldKey = 'name' | 'lender' | 'note';

/** 环境读数指标 */
export type Metric = 'temperature' | 'humidity' | 'light';

/** 操作类型：字段更新 / 环境读数 / 差异项 / 柜位安排 */
export type OpType = 'FIELD' | 'READING' | 'DISCREPANCY' | 'PLACEMENT';

export type DiscrepancyAction = 'ADD' | 'RESOLVE';

/** 平板交接文本里的单条操作（操作编号全局幂等） */
export interface HandoverOp {
  opId: string;
  type: OpType;
  exhibit?: string; // 展品业务编号，如 M001
  field?: ExhibitFieldKey;
  value?: string;
  metric?: Metric;
  reading?: number;
  tolerance?: number;
  action?: DiscrepancyAction;
  dkey?: string;
  detail?: string;
  severity?: 'minor' | 'major';
  cabinet?: string;
  op?: 'PLACE' | 'VACATE';
  device: string;
  actor: string;
  role: Role;
  at: string;
}

/** 字段版本：入账时保留全量版本，current 指向定版值 */
export interface FieldVersion {
  value: string;
  opId: string;
  device: string;
  actor: string;
  at: string;
}

export interface ExhibitRecord {
  code: string;
  fields: Record<ExhibitFieldKey, FieldVersion[]>;
  current: Record<ExhibitFieldKey, string>;
  /** 核验结论：未定 / 已核验 / 退回待复核 */
  conclusion: 'none' | 'reviewed' | 'review';
  conclusionAt?: string;
  /** 结论所依据的读数快照（指标→末次值） */
  readingSnapshot: Partial<Record<Metric, number>>;
  /** 结论时差异项集合：dkey→已解决，用于事后变化比对 */
  discrepancySnapshot: Record<string, boolean>;
  invalidateReasons: string[];
  createdAt: string;
}

export interface ReadingPoint {
  exhibit: string;
  metric: Metric;
  value: number;
  tolerance: number;
  opId: string;
  device: string;
  actor: string;
  at: string;
}

export interface DiscrepancyRecord {
  dkey: string;
  exhibit: string;
  detail: FieldVersion[];
  currentDetail: string;
  severity: 'minor' | 'major';
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CabinetRecord {
  id: string;
  name: string;
  capacity: number;
  /** 已占柜位的展品编号（按入柜先后） */
  exhibits: string[];
}

/** 冲突域：同字段两版并列，等待选定 */
export interface Conflict {
  id: string;
  kind: 'exhibit-field' | 'discrepancy-field';
  exhibit: string;
  dkey?: string;
  field: string;
  cabinetId: string;
  /** 台账既有版（null 表示首版就是冲突，一般不会发生） */
  ledger: FieldVersion | null;
  incoming: FieldVersion;
  resolved: boolean;
  /** 选定结果：保留台账版 / 采用回传版 */
  choice?: 'ledger' | 'incoming';
  chosenBy?: string;
  chosenAt?: string;
  createdAt: string;
}

/** 柜位容量满时的排队操作 */
export interface QueuedPlacement {
  opId: string;
  cabinet: string;
  exhibit: string;
  device: string;
  actor: string;
  at: string;
}

/** 操作入账状态：成功 / 冲突 / 排队 / 失败 / 重复跳过 */
export type PostOutcome =
  | { status: 'posted'; opId: string }
  | { status: 'conflict'; opId: string; conflictId: string }
  | { status: 'queued'; opId: string }
  | { status: 'duplicate'; opId: string }
  | { status: 'failed'; opId?: string; reason: string };

export interface AuditEntry {
  at: string;
  device?: string;
  actor: string;
  action: string;
  detail: string;
  opId?: string;
  exhibit?: string;
  denied?: boolean;
}

export interface LedgerState {
  exhibits: ExhibitRecord[];
  readings: ReadingPoint[];
  discrepancies: DiscrepancyRecord[];
  cabinets: CabinetRecord[];
  conflicts: Conflict[];
  placementQueue: QueuedPlacement[];
  postedOpIds: string[];
  audit: AuditEntry[];
}

/** 导入交接文本的逐条结果 */
export interface ImportReportItem {
  opId: string;
  type: string;
  raw: string;
  outcome: PostOutcome;
}

export interface ImportReport {
  device: string;
  at: string;
  items: ImportReportItem[];
  /** 原文中无法解析的行（导入失败、未入账） */
  malformed: string[];
  counts: { posted: number; conflict: number; queued: number; duplicate: number; failed: number };
}
