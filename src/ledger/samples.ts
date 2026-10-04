// 演示用离线平板交接文本（行式 OP 协议，见 parser.ts）

export const SAMPLE_PAD_A = `# PAD-A 到场点交批次（先回传）
BATCH device=PAD-A
OP|A-001|FIELD|exhibit=M001|field=name|value=青铜镜|actor=王保管|role=keeper|at=2026-10-01T09:30
OP|A-002|FIELD|exhibit=M001|field=lender|value=甘肃省博物馆|actor=王保管|role=keeper|at=2026-10-01T09:31
OP|A-003|READING|exhibit=M001|metric=humidity|reading=58|tolerance=5|actor=王保管|role=keeper|at=2026-10-01T09:32
OP|A-004|DISCREPANCY|exhibit=M001|dkey=D-SEAL|detail=封条编号与交接单不一致|severity=major|actor=王保管|role=keeper|at=2026-10-01T09:33
OP|A-005|PLACEMENT|exhibit=M002|cabinet=A1|op=PLACE|actor=王保管|role=keeper|at=2026-10-01T09:40`;

export const SAMPLE_PAD_B = `# PAD-B 另一台离线平板，后回传（字段与读数有重叠）
BATCH device=PAD-B
OP|B-001|FIELD|exhibit=M001|field=name|value=青铜规矩镜|actor=李保管|role=keeper|at=2026-10-02T10:00
OP|B-002|FIELD|exhibit=M001|field=lender|value=甘肃省博物馆|actor=李保管|role=keeper|at=2026-10-02T10:01
OP|B-003|DISCREPANCY|exhibit=M001|dkey=D-SEAL|detail=封条编号一致，疑为抄录笔误|severity=minor|actor=李保管|role=keeper|at=2026-10-02T10:02
OP|B-004|PLACEMENT|exhibit=M003|cabinet=A1|op=PLACE|actor=李保管|role=keeper|at=2026-10-02T10:05
OP|B-005|READING|exhibit=M001|metric=light|reading=165|tolerance=10|actor=李保管|role=keeper|at=2026-10-02T10:06`;

export const SAMPLE_PAD_C = `# PAD-C 导入中断后重试批次：含已入账重复操作与一行坏数据
BATCH device=PAD-C
OP|A-002|FIELD|exhibit=M001|field=lender|value=甘肃省博物馆|actor=王保管|role=keeper|at=2026-10-01T09:31
OP|A-003|READING|exhibit=M001|metric=humidity|reading=58|tolerance=5|actor=王保管|role=keeper|at=2026-10-01T09:32
OP|C-001|READING|exhibit=M002|metric=temperature|reading=21.2|tolerance=2|actor=赵借展|role=lender|at=2026-10-03T07:50
OP|C-900|FIELD|exhibit=M002|field=name|actor=赵借展|role=lender|at=2026-10-03T07:51
OP|C-002|PLACEMENT|exhibit=M001|cabinet=A1|op=VACATE|actor=王保管|role=keeper|at=2026-10-03T08:00`;

export const SAMPLE_PAD_D = `# PAD-D 核验后回传：差异项解决 + 读数变化，用于演示结论失效退回
BATCH device=PAD-D
OP|D-001|DISCREPANCY|exhibit=M001|dkey=D-SEAL|action=RESOLVE|actor=王保管|role=keeper|at=2026-10-03T11:00
OP|D-002|READING|exhibit=M001|metric=humidity|reading=62|tolerance=5|actor=王保管|role=keeper|at=2026-10-03T11:05`;
