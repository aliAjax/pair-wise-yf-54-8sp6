<script setup lang="ts">
import { ref } from 'vue';
import { useLedgerStore } from '../stores/ledger';
import { SAMPLE_PAD_A, SAMPLE_PAD_B, SAMPLE_PAD_C, SAMPLE_PAD_D } from '../ledger/samples';
import type { PostOutcome } from '../ledger/types';

const store = useLedgerStore();
const text = ref('');

const samples: { label: string; value: string; color: string }[] = [
  { label: 'PAD-A 先回传', value: SAMPLE_PAD_A, color: 'primary' },
  { label: 'PAD-B 后回传（覆盖风险）', value: SAMPLE_PAD_B, color: 'orange-darken-2' },
  { label: 'PAD-C 失败重试批次', value: SAMPLE_PAD_C, color: 'amber-darken-2' },
  { label: 'PAD-D 核验后变化', value: SAMPLE_PAD_D, color: 'red-darken-2' }
];

const outcomeMeta: Record<PostOutcome['status'], { color: string; text: string }> = {
  posted: { color: 'green', text: '已入账' },
  conflict: { color: 'orange', text: '冲突挂起' },
  queued: { color: 'amber-darken-2', text: '柜满排队' },
  duplicate: { color: 'grey', text: '重复跳过' },
  failed: { color: 'red', text: '入账失败' }
};

function loadSample(value: string) {
  text.value = value;
}
function doImport() {
  if (!text.value.trim()) {
    store.notify('请先粘贴或选择交接文本', 'warning');
    return;
  }
  store.importText(text.value);
}
</script>

<template>
  <v-row>
    <v-col cols="12" md="5">
      <v-card>
        <v-card-item>
          <v-card-title>平板交接文本</v-card-title>
          <v-card-subtitle>
            OP 行式协议，按「操作编号」去重合并字段：已入账操作重复回传自动跳过，同字段异值则两版并列。
          </v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <div class="d-flex flex-wrap ga-2 mb-3">
            <v-btn v-for="s in samples" :key="s.label" size="small" :color="s.color" variant="tonal" class="mr-2 mb-2"
              @click="loadSample(s.value)">{{ s.label }}</v-btn>
          </div>
          <v-textarea
            v-model="text"
            rows="16"
            variant="outlined"
            placeholder="BATCH device=PAD-X&#10;OP|OP-0001|FIELD|exhibit=M001|field=name|value=...|actor=..|role=keeper|at=..."
            class="handover-input"
            spellcheck="false"
          />
          <v-btn color="deep-purple" prepend-icon="mdi-database-import" block class="mt-2" @click="doImport">
            去重合并入账
          </v-btn>
          <v-btn color="orange-darken-2" variant="tonal" prepend-icon="mdi-refresh-auto" block class="mt-2"
            @click="store.retryUnposted()">
            只重试上批未入账操作
          </v-btn>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="7">
      <v-card>
        <v-card-item>
          <v-card-title>入账报告</v-card-title>
          <v-card-subtitle v-if="store.lastReport">
            批次 {{ store.lastReport.device }} · {{ store.lastReport.at.slice(0, 19).replace('T', ' ') }}
          </v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text v-if="store.lastReport">
          <div class="d-flex flex-wrap ga-3 mb-3">
            <v-chip color="green" variant="flat" class="text-white">入账 {{ store.lastReport.counts.posted }}</v-chip>
            <v-chip color="orange" variant="flat" class="text-white">冲突 {{ store.lastReport.counts.conflict }}</v-chip>
            <v-chip color="amber-darken-2" variant="flat" class="text-white">排队 {{ store.lastReport.counts.queued }}</v-chip>
            <v-chip color="grey" variant="flat" class="text-white">重复 {{ store.lastReport.counts.duplicate }}</v-chip>
            <v-chip color="red" variant="flat" class="text-white">失败 {{ store.lastReport.counts.failed }}</v-chip>
          </div>

          <v-alert v-if="store.lastReport.malformed.length" type="error" density="compact" variant="tonal" class="mb-3"
            title="以下行解析失败，未入账（修正后连同未入账操作重试）">
            <div v-for="(line, i) in store.lastReport.malformed" :key="i" class="text-caption mono">{{ line }}</div>
          </v-alert>

          <v-table density="compact">
            <thead><tr><th>操作编号</th><th>类型</th><th>对象</th><th>结果</th></tr></thead>
            <tbody>
              <tr v-for="item in store.lastReport.items" :key="item.opId">
                <td class="mono">{{ item.opId }}</td>
                <td>{{ item.type }}</td>
                <td class="text-caption">{{ item.raw }}</td>
                <td>
                  <v-chip size="x-small" :color="outcomeMeta[item.outcome.status].color" variant="tonal">
                    {{ outcomeMeta[item.outcome.status].text }}
                  </v-chip>
                  <div v-if="item.outcome.status === 'failed'" class="text-caption text-red">{{ item.outcome.reason }}</div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
        <v-empty-state v-else icon="mdi-file-import-outline" title="尚未导入" description="从左侧选择示例批次，体验后到数据的去重、冲突与排队" class="py-8" />
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.handover-input :deep(textarea) { font-family: 'Roboto Mono', monospace; font-size: 12px; }
.mono { font-family: 'Roboto Mono', monospace; font-size: 12px; }
</style>
