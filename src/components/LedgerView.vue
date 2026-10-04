<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useLedgerStore, ROLE_LABELS, SAMPLE_TABLET_B, SAMPLE_TABLET_B_FIX, type Role, type LedgerExhibit } from '../stores/ledger';
import { fieldLabel, serializeHandoff, type HandoffKind } from '../services/handoff';

const store = useLedgerStore();
const { exhibitList, unresolvedConflicts, pendingReview, failedOps, queuedItems, cabinetStats, confirmedCount, logs } = storeToRefs(store);

const tab = ref<'import' | 'ledger' | 'ops' | 'cabinets'>('ledger');
const importText = ref('');
const detailCode = ref<string | null>(null);

const roles: { value: Role; label: string }[] = [
  { value: 'curator', label: '策展人' },
  { value: 'keeper', label: '保管员' },
  { value: 'lender', label: '借展方' },
  { value: 'installer', label: '布展负责人' }
];

const detail = computed<LedgerExhibit | null>(() =>
  detailCode.value ? store.exhibits[detailCode.value] ?? null : null
);
const detailDialog = computed({
  get: () => detailCode.value !== null,
  set: (v: boolean) => { if (!v) detailCode.value = null; }
});

const snackbar = computed({
  get: () => !!store.message,
  set: (v: boolean) => { if (!v) store.clearMessage(); }
});
const snackbarText = computed(() => store.message?.text ?? '');
const snackbarColor = computed(() => {
  const k = store.message?.kind;
  return k === 'err' ? 'red' : k === 'warn' ? 'orange' : 'green';
});

function stageLabel(s: string) {
  return { arrival: '到场点交', install: '布展核验', return: '闭展归还' }[s] ?? s;
}
function conclusionLabel(c: string) {
  return { none: '未确认', confirmed: '已确认', invalidated: '待复核' }[c] ?? c;
}
function conclusionColor(c: string) {
  return c === 'confirmed' ? 'green' : c === 'invalidated' ? 'orange' : 'grey';
}
function kindLabel(k: HandoffKind) {
  return { exhibit: '展品', reading: '读数', discrepancy: '差异项', cabinet: '柜位' }[k];
}
function severityLabel(s: string) {
  return s === 'major' ? '重大' : '轻微';
}

function conflictEntries(ex: LedgerExhibit) {
  return Object.entries(ex.conflicts).map(([field, conflict]) => ({ field, conflict }));
}

function loadSample(which: 'b' | 'bfix') {
  importText.value = which === 'b' ? SAMPLE_TABLET_B : SAMPLE_TABLET_B_FIX;
  tab.value = 'import';
}

function doImport() {
  if (!importText.value.trim()) { store.notify('warn', '请先粘贴交接文本'); return; }
  store.importHandoff(importText.value);
}

function exportCurrent() {
  const ops = store.opOrder
    .map((no) => store.ops[no])
    .filter((o) => o.status === 'posted')
    .map((o) => ({ opNo: o.opNo, kind: o.kind, exhibit: o.exhibit, fields: o.fields }));
  importText.value = serializeHandoff(ops, { source: 'this-device' });
  tab.value = 'import';
  store.notify('ok', `已导出 ${ops.length} 笔已入账操作为交接文本`);
}

function openDetail(ex: LedgerExhibit) { detailCode.value = ex.code; }

function canDo(action: Parameters<typeof store.can>[0], ex?: LedgerExhibit) {
  return store.can(action, ex);
}
</script>

<template>
  <v-card>
    <v-card-text>
      <!-- 身份切换 -->
      <div class="d-flex align-center flex-wrap gap-3 mb-4">
        <span class="text-subtitle-2">当前身份：</span>
        <v-btn-toggle
          :model-value="store.role"
          mandatory
          density="comfortable"
          color="deep-purple"
          @update:model-value="(v: Role) => store.setRole(v)"
        >
          <v-btn v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</v-btn>
        </v-btn-toggle>
        <v-chip v-if="store.role === 'keeper'" color="deep-purple-lighten-4" size="small">
          本柜：{{ store.keeperCabinet }}（保管员只能处理本柜冲突）
        </v-chip>
        <v-spacer />
        <v-btn size="small" variant="text" prepend-icon="mdi-restore" @click="store.resetAll">重置演示</v-btn>
      </div>

      <!-- 指标 -->
      <v-row class="mb-2">
        <v-col cols="6" md="2"><v-card variant="outlined"><v-card-text class="pa-3"><div class="metric-label">待复核</div><div class="metric" :class="{ warn: pendingReview.length }">{{ pendingReview.length }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" md="2"><v-card variant="outlined"><v-card-text class="pa-3"><div class="metric-label">未解决冲突</div><div class="metric" :class="{ warn: unresolvedConflicts.length }">{{ unresolvedConflicts.length }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" md="2"><v-card variant="outlined"><v-card-text class="pa-3"><div class="metric-label">未入账操作</div><div class="metric" :class="{ warn: failedOps.length }">{{ failedOps.length }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" md="2"><v-card variant="outlined"><v-card-text class="pa-3"><div class="metric-label">排队候位</div><div class="metric">{{ queuedItems.length }}</div></v-card-text></v-card></v-col>
        <v-col cols="6" md="2"><v-card variant="outlined"><v-card-text class="pa-3"><div class="metric-label">已确认结论</div><div class="metric">{{ confirmedCount }}</div></v-card-text></v-card></v-col>
      </v-row>
    </v-card-text>

    <v-tabs v-model="tab" color="deep-purple" grow>
      <v-tab value="ledger">核验账</v-tab>
      <v-tab value="import">交接导入</v-tab>
      <v-tab value="ops">操作流水<v-badge v-if="failedOps.length" :content="failedOps.length" color="red" inline class="ml-1" /></v-tab>
      <v-tab value="cabinets">柜位安排</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <!-- 核验账 -->
      <v-window-item value="ledger">
        <v-card-text>
          <v-alert v-if="pendingReview.length" type="warning" variant="tonal" class="mb-3">
            有 {{ pendingReview.length }} 件展品因读数或差异项变化导致结论失效、退回待复核：
            <b v-for="ex in pendingReview" :key="ex.code" class="ml-1">{{ ex.code }}</b>
          </v-alert>
          <v-virtual-scroll :items="exhibitList" height="560" item-height="88">
            <template #default="{ item }">
              <v-list-item :key="item.code" class="exhibit-row" @click="openDetail(item)">
                <template #prepend>
                  <v-avatar :color="item.conclusion === 'invalidated' ? 'orange-lighten-3' : 'deep-purple-lighten-4'">{{ item.code.slice(1) }}</v-avatar>
                </template>
                <v-list-item-title>
                  {{ item.name || '（未命名）' }} · {{ item.code }}
                  <v-chip v-if="Object.values(item.conflicts).some((c) => c.selected === null)" size="x-small" color="red" class="ml-1">冲突待选定</v-chip>
                </v-list-item-title>
                <v-list-item-subtitle>
                  {{ item.lender }} · {{ item.cabinet || '未分配' }} · {{ stageLabel(item.stage) }}
                </v-list-item-subtitle>
                <template #append>
                  <v-chip size="small" :color="conclusionColor(item.conclusion)">{{ conclusionLabel(item.conclusion) }}</v-chip>
                </template>
              </v-list-item>
            </template>
          </v-virtual-scroll>
        </v-card-text>
      </v-window-item>

      <!-- 交接导入 -->
      <v-window-item value="import">
        <v-card-text>
          <div class="d-flex gap-2 mb-2 flex-wrap">
            <v-btn size="small" color="deep-purple" prepend-icon="mdi-import" @click="doImport">导入交接文本</v-btn>
            <v-btn size="small" variant="outlined" prepend-icon="mdi-tablet" @click="loadSample('b')">载入平板 B 导出（含冲突）</v-btn>
            <v-btn size="small" variant="outlined" prepend-icon="mdi-tablet" @click="loadSample('bfix')">载入平板 B 修正文本</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-export" @click="exportCurrent">导出本账交接文本</v-btn>
            <v-btn size="small" variant="text" @click="importText = ''">清空</v-btn>
          </div>
          <v-textarea
            v-model="importText"
            placeholder="粘贴平板导出的交接文本，格式：[操作编号] 类型 展品编号，下一行键 = 值"
            rows="14"
            auto-grow
            class="mono"
            variant="outlined"
          />
          <div class="text-caption text-grey mb-4">
            导入时按操作编号去重：已入账的操作直接跳过，只有未入账（失败）的操作会被重试。
          </div>

          <v-divider class="mb-3" />
          <div class="text-subtitle-2 mb-2">导入日志</div>
          <v-list v-if="logs.length" density="compact">
            <v-list-item v-for="(log, i) in logs" :key="i" class="mb-1">
              <v-list-item-title>
                <b>{{ log.source }}</b> · {{ new Date(log.at).toLocaleString() }}
              </v-list-item-title>
              <v-list-item-subtitle>
                共 {{ log.total }} 笔 · 入账 {{ log.posted }} · 跳过 {{ log.skipped }} ·
                <span :class="{ 'text-red': log.failed }">失败 {{ log.failed }}</span>
                <div v-if="log.errors.length" class="text-red mt-1" style="white-space: pre-wrap">{{ log.errors.join('\n') }}</div>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <v-empty-state v-else title="暂无导入记录" icon="mdi-clipboard-text-outline" />
        </v-card-text>
      </v-window-item>

      <!-- 操作流水 -->
      <v-window-item value="ops">
        <v-card-text>
          <div class="d-flex align-center mb-2 gap-2">
            <v-btn size="small" color="deep-purple" prepend-icon="mdi-refresh" :disabled="!failedOps.length" @click="store.retryFailed">
              重试未入账操作<v-badge v-if="failedOps.length" :content="failedOps.length" color="red" inline class="ml-1" />
            </v-btn>
            <span class="text-caption text-grey">只重跑失败操作，已入账操作不会重复执行</span>
          </div>
          <v-table density="compact">
            <thead><tr><th>操作编号</th><th>类型</th><th>展品</th><th>来源</th><th>状态</th><th>尝试</th><th>说明 / 错误</th></tr></thead>
            <tbody>
              <tr v-for="no in store.opOrder" :key="no">
                <td class="mono">{{ no }}</td>
                <td>{{ kindLabel(store.ops[no].kind) }}</td>
                <td>{{ store.ops[no].exhibit }}</td>
                <td>{{ store.ops[no].source }}</td>
                <td>
                  <v-chip size="x-small" :color="store.ops[no].status === 'posted' ? 'green' : 'red'">
                    {{ store.ops[no].status === 'posted' ? '已入账' : '失败' }}
                  </v-chip>
                </td>
                <td>{{ store.ops[no].attempts }}</td>
                <td class="text-caption">{{ store.ops[no].error || '—' }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-window-item>

      <!-- 柜位安排 -->
      <v-window-item value="cabinets">
        <v-card-text>
          <v-row>
            <v-col v-for="c in cabinetStats" :key="c.cab.id" cols="12" md="4">
              <v-card variant="outlined">
                <v-card-text>
                  <div class="d-flex align-center mb-1">
                    <b>{{ c.cab.name }}</b>
                    <v-spacer />
                    <v-chip size="small" :color="c.assigned >= c.cab.capacity ? 'red' : 'green'">{{ c.assigned }} / {{ c.cab.capacity }}</v-chip>
                  </div>
                  <v-progress-linear :model-value="(c.assigned / c.cab.capacity) * 100" :color="c.assigned >= c.cab.capacity ? 'red' : 'green'" class="mb-3" />
                  <div class="text-caption mb-1">在柜展品</div>
                  <v-chip
                    v-for="ex in exhibitList.filter((e) => e.cabinet === c.cab.id)"
                    :key="ex.code"
                    size="small"
                    class="mr-1 mb-1"
                    @click="openDetail(ex)"
                  >{{ ex.code }} {{ ex.name }}</v-chip>
                  <div v-if="!exhibitList.some((e) => e.cabinet === c.cab.id)" class="text-caption text-grey mb-1">暂无</div>
                  <v-divider class="my-2" />
                  <div class="text-caption mb-1">排队候位（{{ c.queued }}）</div>
                  <v-chip
                    v-for="q in queuedItems.filter((x) => x.q.cabinetId === c.cab.id)"
                    :key="q.q.exhibitId"
                    size="small"
                    color="orange"
                    class="mr-1 mb-1"
                    @click="openDetail(q.ex)"
                  >{{ q.ex.code }} {{ q.ex.name }}</v-chip>
                  <v-btn
                    size="small"
                    color="deep-purple"
                    variant="tonal"
                    class="mt-2"
                    block
                    :disabled="!c.queued || c.assigned >= c.cab.capacity"
                    @click="store.promoteQueue(c.cab.id)"
                  >补入排队展品</v-btn>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-window-item>
    </v-window>
  </v-card>

  <!-- 展品核验详情 -->
  <v-dialog v-model="detailDialog" max-width="780" scrollable>
    <v-card v-if="detail">
      <v-card-title class="d-flex align-center">
        <span>{{ detail.code }} · {{ detail.name || '（未命名）' }}</span>
        <v-spacer />
        <v-chip size="small" :color="conclusionColor(detail.conclusion)">{{ conclusionLabel(detail.conclusion) }}</v-chip>
      </v-card-title>
      <v-card-text>
        <!-- 读数 -->
        <div class="text-subtitle-2 mb-1">环境读数</div>
        <v-row class="mb-3">
          <v-col cols="4"><v-card variant="outlined"><v-card-text class="pa-2 text-center"><div class="text-caption">温度</div><b>{{ detail.readings.temperature }}℃</b></v-card-text></v-card></v-col>
          <v-col cols="4"><v-card variant="outlined"><v-card-text class="pa-2 text-center"><div class="text-caption">湿度</div><b>{{ detail.readings.humidity }}%</b></v-card-text></v-card></v-col>
          <v-col cols="4"><v-card variant="outlined"><v-card-text class="pa-2 text-center"><div class="text-caption">照度</div><b>{{ detail.readings.light }} lux</b></v-card-text></v-card></v-col>
        </v-row>

        <!-- 差异项 -->
        <div class="text-subtitle-2 mb-1">差异项</div>
        <v-list density="compact" class="mb-3" variant="outlined">
          <v-list-item v-for="d in detail.discrepancies" :key="d.id">
            <v-list-item-title>{{ d.title }}</v-list-item-title>
            <v-list-item-subtitle>
              <v-chip size="x-small" :color="d.severity === 'major' ? 'red' : 'orange'" class="mr-1">{{ severityLabel(d.severity) }}</v-chip>
              {{ d.resolved ? '已解决' : '未解决' }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn size="small" color="green" variant="text" :disabled="d.resolved || !canDo('resolveDiscrepancy', detail)" @click="store.resolveDiscrepancy(detail.code, d.id)">
                {{ canDo('resolveDiscrepancy', detail) ? '确认解决' : '无权处理' }}
              </v-btn>
            </template>
          </v-list-item>
          <v-list-item v-if="!detail.discrepancies.length"><v-list-item-subtitle>无差异项</v-list-item-subtitle></v-list-item>
        </v-list>

        <!-- 字段冲突：两版并列保留，选定后才能推进 -->
        <div class="text-subtitle-2 mb-1">字段版本（同字段两版并列，选定后才能推进）</div>
        <div v-for="entry in conflictEntries(detail)" :key="entry.field" class="mb-3">
          <div class="text-caption mb-1">
            <b>{{ fieldLabel(entry.field) }}</b>
            <v-chip v-if="entry.conflict.selected === null" size="x-small" color="red" class="ml-1">待选定</v-chip>
            <v-chip v-else size="x-small" color="green" class="ml-1">已选定{{ entry.conflict.resolvedBy ? ' · ' + ROLE_LABELS[entry.conflict.resolvedBy as Role] : '' }}</v-chip>
          </div>
          <v-row>
            <v-col v-for="(v, idx) in entry.conflict.versions" :key="idx" cols="6">
              <v-card
                variant="outlined"
                :color="entry.conflict.selected === idx ? 'green-lighten-5' : undefined"
                :class="{ 'version-selected': entry.conflict.selected === idx }"
              >
                <v-card-text class="pa-2">
                  <div class="text-caption text-grey">{{ v.source }} · {{ v.opNo }}</div>
                  <div class="text-body-1">{{ v.value }}</div>
                  <v-btn
                    size="small"
                    color="deep-purple"
                    variant="tonal"
                    block
                    class="mt-1"
                    :disabled="entry.conflict.selected !== null || !canDo('resolveConflict', detail)"
                    @click="store.resolveConflict(detail.code, entry.field, idx)"
                  >
                    {{ entry.conflict.selected === idx ? '已选用' : '选用此版' }}
                  </v-btn>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>
        <div v-if="!conflictEntries(detail).length" class="text-caption text-grey mb-3">无字段版本冲突</div>

        <!-- 结论 -->
        <v-alert :type="detail.conclusion === 'invalidated' ? 'warning' : detail.conclusion === 'confirmed' ? 'success' : 'info'" variant="tonal" class="mb-2">
          <template v-if="detail.conclusion === 'invalidated'">
            <b>结论已失效，退回待复核。</b> 读数或差异项在确认后发生变化，需重新确认结论才能推进。
          </template>
          <template v-else-if="detail.conclusion === 'confirmed'">
            <b>核验结论已确认。</b> 读数与差异项已快照，变化将自动判定失效。
          </template>
          <template v-else>尚未确认核验结论。</template>
        </v-alert>
        <div class="d-flex gap-2">
          <v-btn size="small" color="green" variant="outlined" :disabled="!canDo('confirmConclusion', detail)" @click="store.confirmConclusion(detail.code)">
            {{ canDo('confirmConclusion', detail) ? '确认结论' : '无权确认' }}
          </v-btn>
          <v-btn size="small" color="deep-purple" :disabled="!canDo('advance')" @click="store.advance(detail.code)">推进到下一阶段</v-btn>
          <v-btn size="small" variant="text" @click="detailCode = null">关闭</v-btn>
        </div>
        <div class="text-caption text-grey mt-1">
          推进门禁：字段冲突已选定 + 结论已确认且未失效；越权确认直接拒绝。
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-snackbar v-model="snackbar" :color="snackbarColor" timeout="4200" location="top">
    {{ snackbarText }}
  </v-snackbar>
</template>

<style scoped>
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.metric-label { color: #6b7280; font-size: 13px; }
.metric { font-size: 28px; font-weight: 750; color: #4c1d95; }
.metric.warn { color: #b91c1c; }
.exhibit-row { border-bottom: 1px solid #eee; cursor: pointer; }
.version-selected { border-color: #16a34a; }
</style>
