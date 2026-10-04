import { createInitialState, applyBatch, filterUnposted, resolveConflict, confirmConclusion } from './engine';
import { parseHandover } from './parser';
import { SAMPLE_PAD_A, SAMPLE_PAD_B, SAMPLE_PAD_C, SAMPLE_PAD_D } from './samples';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${name} ${extra}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

const curator = { name: '周策展', role: 'curator' as const };
const keeperA1 = { name: '王保管', role: 'keeper' as const };
const keeperB2 = { name: '孙保管', role: 'keeper' as const };
const lender = { name: '赵借展', role: 'lender' as const };

// 1. PAD-A 导入
let r = applyBatch(createInitialState(), 'PAD-A', parseHandover(SAMPLE_PAD_A).ops, []);
let s = r.state;
const get = (code: string) => s.exhibits.find((e) => e.code === code)!;
check('A: name 与台账一致直接入账', get('M001').current.name === '青铜镜');
check('A: lender 与台账一致直接入账', get('M001').current.lender === '甘肃省博物馆');
check('A: 差异项登记', s.discrepancies.some((d) => d.dkey === 'D-SEAL' && !d.resolved));
check('A: M002 入 A1（1+1=2 满柜）', s.cabinets.find((c) => c.id === 'A1')!.exhibits.join() === 'M001,M002');
check('A: 全部入账无冲突无排队', r.report.counts.conflict === 0 && r.report.counts.queued === 0 && r.report.counts.failed === 0);

// 2. PAD-B 后回传：同字段异值两版并列（不覆盖）+ 柜满排队
r = applyBatch(s, 'PAD-B', parseHandover(SAMPLE_PAD_B).ops, []);
s = r.state;
check('B: name 异值产生冲突且台账值未被覆盖', s.conflicts.some((c) => c.exhibit === 'M001' && c.field === 'name' && !c.resolved) && get('M001').current.name === '青铜镜');
check('B: lender 与定版值一致幂等入账(不产生冲突)', !s.conflicts.some((c) => c.exhibit === 'M001' && c.field === 'lender'));
check('B: 差异描述两版并列产生冲突', s.conflicts.some((c) => c.kind === 'discrepancy-field' && c.dkey === 'D-SEAL' && !c.resolved));
check('B: A1 满柜 M003 排队不入账', s.placementQueue.some((q) => q.opId === 'B-004') && !s.cabinets.find((c) => c.id === 'A1')!.exhibits.includes('M003'));
check('B: 排队操作编号未进 postedOpIds', !s.postedOpIds.includes('B-004'));
check('B: name 两版均保留且不追加重复版', get('M001').fields.name.length === 2 && get('M001').fields.name.some((v) => v.value === '青铜规矩镜'));

// 3. 未选定冲突 / 未解决差异 阻断核验推进
let blocked = confirmConclusion(s, 'M001', curator);
check('门禁: 冲突未选定不能确认', !blocked.ok && /未选定/.test(blocked.message));
// 选定差异描述冲突（采用回传版）后，再尝试——仍有 name 冲突
const dConflict = s.conflicts.find((c) => c.kind === 'discrepancy-field' && !c.resolved)!;
let rr = resolveConflict(s, dConflict.id, 'incoming', curator);
s = rr.state;
blocked = confirmConclusion(s, 'M001', curator);
check('门禁: 选定描述后仍剩 name 冲突，不能确认', !blocked.ok && /未选定/.test(blocked.message));

// 4. 越权：借展方不能选定；B2 保管员不能处理 A1 冲突
const nameConflict = s.conflicts.find((c) => c.field === 'name' && c.kind === 'exhibit-field' && !c.resolved)!;
let denied = resolveConflict(s, nameConflict.id, 'incoming', lender);
check('权限: 借展方选定直接拒绝并留痕', !denied.ok && /越权/.test(denied.message) && denied.state.audit[0].denied === true);
denied = resolveConflict(s, nameConflict.id, 'incoming', keeperB2, 'B2');
check('权限: 非本柜保管员处理 A1 冲突被拒绝', !denied.ok && /本柜/.test(denied.message));
let allowed = resolveConflict(s, nameConflict.id, 'ledger', keeperA1, 'A1');
check('权限: 本柜保管员可处理 A1 冲突', allowed.ok && allowed.state.exhibits.find((e) => e.code === 'M001')!.current.name === '青铜镜');
s = allowed.state;

// 5. 差异仍未解决 → 仍阻断；借展方/非本柜不能确认核验
blocked = confirmConclusion(s, 'M001', curator);
check('门禁: 冲突全选定但差异未解决仍不能确认', !blocked.ok && /差异/.test(blocked.message));
denied = confirmConclusion(s, 'M001', lender);
check('权限: 借展方确认核验被拒绝', !denied.ok && /越权/.test(denied.message));
denied = confirmConclusion(s, 'M001', keeperB2, 'B2');
check('权限: B2 保管员确认 A1 展品被拒绝', !denied.ok);

// 6. PAD-C 首次导入（坏数据行 + 重复操作 + 一条新读数）
const parsedC = parseHandover(SAMPLE_PAD_C);
r = applyBatch(s, 'PAD-C', parsedC.ops, parsedC.malformed);
s = r.state;
check('C: 坏行进入 malformed 未入账', r.report.malformed.length === 1 && r.report.counts.failed === 0);
check('C: A-002/A-003 已入账按操作编号去重跳过', r.report.items.filter((i) => i.outcome.status === 'duplicate').length === 2);
check('C: 新读数 C-001 入账', r.report.counts.posted >= 1 && s.postedOpIds.includes('C-001'));
check('C: 出柜 C-002 入账并触发排队的 B-004 自动入柜', s.cabinets.find((c) => c.id === 'A1')!.exhibits.includes('M003') && !s.placementQueue.some((q) => q.opId === 'B-004') && s.postedOpIds.includes('B-004'));

// 7. 导入失败后只重试未入账操作：重新应用 C 批次，全部应为 duplicate/已入账
const unposted = filterUnposted(s, parsedC.ops);
check('重试: C 批除坏行外所有操作均已入账，未入账清单为空', unposted.length === 0);
const again = applyBatch(s, 'PAD-C', parsedC.ops, []);
check('重试: 整批重放全部重复跳过，不产生重复数据', again.report.counts.posted === 0 && again.report.counts.duplicate === 4);

// 8. 核验通过：策展人确认 M001（差异 D-SEAL 仍未解决，先用 RESOLVE 入账）
// 直接手工补一个 RESOLVE 操作
const resolveOps = parseHandover('BATCH device=PAD-X\nOP|X-1|DISCREPANCY|exhibit=M001|dkey=D-SEAL|action=RESOLVE|actor=王保管|role=keeper|at=2026-10-03T10:00');
r = applyBatch(s, 'PAD-X', resolveOps.ops, []);
s = r.state;
check('核验前: 差异 RESOLVE 入账', s.discrepancies.find((d) => d.dkey === 'D-SEAL')!.resolved);
const confirmed = confirmConclusion(s, 'M001', curator);
s = confirmed.state;
check('核验: 条件满足后确认通过', confirmed.ok && s.exhibits.find((e) => e.code === 'M001')!.conclusion === 'reviewed');
check('核验: 基线读数被固化', (s.exhibits.find((e) => e.code === 'M001')!.readingSnapshot.humidity ?? -1) === 58);

// 9. PAD-D：核验后差异解决状态变化（已解决再 RESOLVE 无变化）+ 读数湿度 62 变化 → 结论失效退回
r = applyBatch(s, 'PAD-D', parseHandover(SAMPLE_PAD_D).ops, []);
s = r.state;
const after = s.exhibits.find((e) => e.code === 'M001')!;
check('失效: 读数变化导致结论退回待复核', after.conclusion === 'review' && after.invalidateReasons.some((x) => x.includes('humidity')));
check('失效: 退回后再次确认因读数基线不阻断（无未决项），可重新核验', confirmConclusion(s, 'M001', curator).ok);

// 10. 解析器：缺字段/坏行不入账
const bad = parseHandover('BATCH device=BAD\nOP|Z-1|FIELD|exhibit=M001|field=name|actor=a|role=keeper|at=2026-10-01T00:00\nOP|Z-2|BOGUS|x=1\nnot-an-op-line');
check('解析: value 缺失/类型非法/非 OP 行均进 malformed，ops 为空', bad.malformed.length === 3 && bad.ops.length === 0);

console.log(failures === 0 ? '\n全部规则校验通过' : `\n${failures} 条校验失败`);
if (failures) {
  const proc = (globalThis as { process?: { exit: (code: number) => never } }).process;
  proc?.exit(1);
  throw new Error('规则校验失败');
}
