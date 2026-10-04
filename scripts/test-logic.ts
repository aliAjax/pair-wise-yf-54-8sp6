import { createPinia, setActivePinia } from 'pinia';
import { useLedgerStore, SAMPLE_TABLET_B, SAMPLE_TABLET_B_FIX } from '../src/stores/ledger';

// 模拟 localStorage
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  length: mem.size
} as Storage;

setActivePinia(createPinia());
const s = useLedgerStore();

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}`); }
}

console.log('== 种子 ==');
check('M001 已确认', s.exhibits['M001'].conclusion === 'confirmed');
check('M003 已确认', s.exhibits['M003'].conclusion === 'confirmed');
check('M005 已确认', s.exhibits['M005'].conclusion === 'confirmed');
check('M007 在 C3 排队', s.queue.some((q) => q.exhibitId === 'M007' && q.cabinetId === 'C3'));
check('初始无冲突', s.unresolvedConflicts.length === 0);

console.log('== 导入平板 B ==');
s.importHandoff(SAMPLE_TABLET_B);
check('M001 年代冲突(商/周)', Object.keys(s.exhibits['M001'].conflicts).includes('era') && s.exhibits['M001'].conflicts.era.versions.length === 2);
check('M003 名称冲突(佛首/佛像)', s.exhibits['M003'].conflicts.name.versions.length === 2);
check('M006 名称+材质冲突', s.exhibits['M006'].conflicts.name.versions.length === 2 && s.exhibits['M006'].conflicts.material.versions.length === 2);
check('未解决冲突=4', s.unresolvedConflicts.length === 4);
check('M003 差异项导致失效', s.exhibits['M003'].conclusion === 'invalidated');
check('M005 读数导致失效', s.exhibits['M005'].conclusion === 'invalidated');
check('待复核=2', s.pendingReview.length === 2);
check('M002 无差异项(critical 失败未入账)', s.exhibits['M002'].discrepancies.length === 0);
check('失败操作=2', s.failedOps.length === 2);
check('M002 仍为未确认(失败未影响)', s.exhibits['M002'].conclusion === 'none');

console.log('== 保管员权限(本柜 A2) ==');
s.setRole('keeper');
s.resolveConflict('M003', 'name', 1);
check('保管员处理 B1 冲突被拒(仍未选定)', s.exhibits['M003'].conflicts.name.selected === null);
s.resolveConflict('M001', 'era', 1);
check('保管员处理 A2 冲突成功(年代=周)', s.exhibits['M001'].era === '周' && s.exhibits['M001'].conflicts.era.selected === 1);
s.confirmConclusion('M003');
check('保管员确认 B1 结论被拒(仍待复核)', s.exhibits['M003'].conclusion === 'invalidated');
s.advance('M001');
check('保管员推进被拒(阶段仍 arrival)', s.exhibits['M001'].stage === 'arrival');

console.log('== 策展人推进 ==');
s.setRole('curator');
s.resolveConflict('M003', 'name', 1);
check('策展人可选定 B1 冲突', s.exhibits['M003'].conflicts.name.selected === 1);
s.advance('M001');
check('M001 已推进到 install', s.exhibits['M001'].stage === 'install');
s.advance('M003');
check('M003 待复核被拒绝推进(仍 arrival)', s.exhibits['M003'].stage === 'arrival');

console.log('== 失败重试(只重试未入账) ==');
s.retryFailed();
check('重试后 OP-B6 仍失败', s.ops['OP-B6'].status === 'failed');
check('重试后 OP-B7 仍失败', s.ops['OP-B7'].status === 'failed');
check('OP-B1 已入账未重跑(attempts 仍 1)', s.ops['OP-B1'].attempts === 1);

console.log('== 去重：修正前重复导入平板 B ==');
s.importHandoff(SAMPLE_TABLET_B);
let lastLog = s.logs[0];
check('跳过 5 笔已入账', lastLog.skipped === 5);
check('失败 2 笔(未入账重跑)', lastLog.failed === 2);

console.log('== 导入修正文本 ==');
s.importHandoff(SAMPLE_TABLET_B_FIX);
check('OP-B6 已入账', s.ops['OP-B6'].status === 'posted');
check('OP-B7 已入账', s.ops['OP-B7'].status === 'posted');
check('M002 包装破损差异已入账', s.exhibits['M002'].discrepancies.some((d) => d.title === '包装破损'));
check('M004 温度=22', s.exhibits['M004'].readings.temperature === 22);
check('失败操作清零', s.failedOps.length === 0);

console.log('== 去重：修正后重复导入平板 B ==');
s.importHandoff(SAMPLE_TABLET_B);
lastLog = s.logs[0];
check('7 笔全部跳过(已入账)', lastLog.skipped === 7);
check('0 笔失败', lastLog.failed === 0);

console.log('== 柜位排队与补入 ==');
s.adjustCabinet('M005', 'B1');
check('M005 调到 B1', s.exhibits['M005'].cabinet === 'B1');
s.promoteQueue('C3');
check('M007 从排队补入 C3', s.exhibits['M007'].cabinet === 'C3' && !s.queue.some((q) => q.exhibitId === 'M007'));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
