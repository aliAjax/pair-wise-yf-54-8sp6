# 借展点交核验账 · 交接文本去重合并台

针对"单台终端留痕、多块离线平板回传后同一件展品数据被后到版本覆盖"的核验工具。
展品、环境读数、差异项、柜位安排四类对象接入一本核验账；平板导出交接文本，
另一台终端按**操作编号去重合并字段**，同字段异值**两版并列、选定后才能推进**。

## 业务规则闭环

| 规则 | 实现 |
| --- | --- |
| 按操作编号幂等去重 | `postedOpIds` 已入账操作重放即跳过；排队中的操作同样不重复入队 |
| 同字段两版并列保留 | 回传值与台账定版值不一致时不覆盖，双版本（来源设备/操作/时间）挂入冲突，定版值不变 |
| 选定后才能推进 | 存在未选定冲突或未解决差异项时，"确认核验"直接拒绝 |
| 读数变化结论失效 | 核验确认时固化温/湿/照度基线；之后任一指标新读数不同即退回"待复核"并记录原因 |
| 差异项变化结论失效 | 已核验展品新增差异项、差异描述改述、差异被解决均触发退回待复核 |
| 导入失败只重试未入账 | "只重试上批未入账操作"按钮用 `filterUnposted` 过滤已入账/排队编号 |
| 柜满先排队 | PLACE 超容量不入 `postedOpIds`，进 FIFO 队列；VACATE 释放后自动入柜 |
| 越权确认直接拒绝 | 借展方任何定版/核验动作被拒绝并留痕；保管员只能处理管辖柜的冲突与展品 |

## 交接文本协议（平板导出）

行式文本，`#` 注释，`BATCH device=` 声明终端，每行一条操作：

```
BATCH device=PAD-A
OP|A-001|FIELD|exhibit=M001|field=name|value=青铜镜|actor=王保管|role=keeper|at=2026-10-01T09:30
OP|A-003|READING|exhibit=M001|metric=humidity|reading=58|tolerance=5|actor=..|role=keeper|at=..
OP|A-004|DISCREPANCY|exhibit=M001|dkey=D-SEAL|detail=封条编号不一致|severity=major|actor=..|role=keeper|at=..
OP|A-005|PLACEMENT|exhibit=M002|cabinet=A1|op=PLACE|actor=..|role=keeper|at=..
```

- `FIELD`：展品字段（name/lender/note），异值并列
- `READING`：环境读数 temperature/humidity/light，附容差
- `DISCREPANCY`：差异项 ADD/RESOLVE，描述异值同样并列
- `PLACEMENT`：柜位 PLACE/VACATE，满柜排队
- 解析失败的行进 malformed 报告，绝不入账

解析/导出见 `src/ledger/parser.ts`。

## 核心模块

- `src/ledger/types.ts` — 核验账类型
- `src/ledger/engine.ts` — 纯函数引擎：入账、冲突、失效、排队、权限门禁（不依赖框架，可单测）
- `src/ledger/parser.ts` — 交接文本解析与导出
- `src/ledger/samples.ts` — 四批演示数据（先回传 / 后到覆盖 / 失败重试 / 核验后变化）
- `src/stores/ledger.ts` — Pinia 状态 + localStorage 持久化
- `src/components/` — 六个标签页：交接导入、展品核验账、字段选定、读数与差异、柜位安排、审计留痕

顶栏可切换 **策展人（全局）/ 保管员（选择管辖柜）/ 借展方（无权）** 三种身份验证权限。

## 建议演示路径

1. 依次导入 `PAD-A`、`PAD-B`：M001 名称出现两版并列（台账版未被覆盖），A1 满柜 M003 排队。
2. 在"字段选定"页：切借展方点选定被拒；切 B2 保管员处理 A1 冲突被拒；切回 A1 保管员或策展人逐字段选定。
3. 导入 `PAD-C`：A-002/A-003 按操作编号重复跳过，坏行只报错不入账，C-002 出柜后 M003 自动入柜；
   点"只重试上批未入账操作"验证空重试。
4. 差异项解决后，策展人确认核验（基线读数固化）。
5. 导入 `PAD-D`：湿度变化，M001 立即退回待复核；审计留痕页可查看全部拒绝/失效/入账记录。

## 启动与校验

```bash
npm install
npm run dev            # 端口 62019
npm run test:rules     # 31 条业务规则端到端校验（纯引擎，esbuild 打包后 node 执行）
npm run build          # 类型检查 + 生产构建
```
