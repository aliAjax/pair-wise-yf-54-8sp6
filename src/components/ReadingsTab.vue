<script setup lang="ts">
import { computed } from 'vue';
import { useLedgerStore } from '../stores/ledger';

const store = useLedgerStore();

const METRIC_LABELS: Record<string, string> = { temperature: '温度', humidity: '湿度', light: '照度' };
const METRIC_UNIT: Record<string, string> = { temperature: '℃', humidity: '%', light: 'lx' };

const readingRows = computed(() =>
  [...store.readings]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((point) => {
      const exhibit = store.exhibits.find((item) => item.code === point.exhibit);
      const baseline = exhibit?.readingSnapshot[point.metric];
      return {
        ...point,
        invalidated: exhibit?.conclusion === 'review' && baseline !== undefined && baseline !== point.value,
        baseline
      };
    })
);

function shortAt(at: string) {
  return at.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <v-row>
    <v-col cols="12" md="6">
      <v-card height="100%">
        <v-card-item>
          <v-card-title>环境读数流水</v-card-title>
          <v-card-subtitle>读数按操作编号幂等入账；已核验展品的任一指标变化即令结论失效</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-table density="compact">
          <thead>
            <tr><th>时间</th><th>展品</th><th>指标</th><th>读数</th><th>容差</th><th>来源</th><th>核验基线</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in readingRows" :key="p.opId" :class="{ 'row-alert': p.invalidated }">
              <td class="text-caption">{{ shortAt(p.at) }}</td>
              <td>{{ p.exhibit }}</td>
              <td>{{ METRIC_LABELS[p.metric] }}</td>
              <td class="font-weight-bold">{{ p.value }} {{ METRIC_UNIT[p.metric] }}</td>
              <td>±{{ p.tolerance }}</td>
              <td class="text-caption">{{ p.device }} / {{ p.actor }}</td>
              <td>
                <span v-if="p.baseline !== undefined" :class="p.invalidated ? 'text-red' : 'text-green'">
                  {{ p.baseline }} {{ p.invalidated ? '⚠ 已变化' : '✓' }}
                </span>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </v-col>

    <v-col cols="12" md="6">
      <v-card height="100%">
        <v-card-item>
          <v-card-title>差异项核验账</v-card-title>
          <v-card-subtitle>未解决差异阻断核验确认；差异项新增/解决/改述均会让已出结论退回待复核</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-list v-if="store.discrepancies.length">
          <v-list-item v-for="d in store.discrepancies" :key="d.dkey">
            <template #prepend>
              <v-icon :color="d.resolved ? 'green' : d.severity === 'major' ? 'red' : 'orange'">
                {{ d.resolved ? 'mdi-check-decagram' : d.severity === 'major' ? 'mdi-alert-octagon' : 'mdi-alert' }}
              </v-icon>
            </template>
            <v-list-item-title>
              {{ d.exhibit }} · {{ d.dkey }}
              <v-chip size="x-small" class="ml-2" :color="d.resolved ? 'green' : 'red'" variant="tonal">
                {{ d.resolved ? '已解决' : '待处理' }}
              </v-chip>
              <v-chip size="x-small" :color="d.severity === 'major' ? 'red' : 'amber'" variant="text">
                {{ d.severity === 'major' ? '重大' : '轻微' }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>
              {{ d.currentDetail }}
              <template v-if="d.detail.length > 1">（{{ d.detail.length }} 个并列描述，见字段核验页）</template>
            </v-list-item-subtitle>
            <template #append>
              <div class="text-caption text-medium-emphasis text-right">
                {{ shortAt(d.createdAt) }}<br />{{ d.detail[d.detail.length - 1].device }}
              </div>
            </template>
          </v-list-item>
        </v-list>
        <v-empty-state v-else icon="mdi-clipboard-check-outline" title="暂无差异项" description="回传 DISCREPANCY 操作后在此登记" class="py-8" />
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.row-alert { background: #ffebee; }
</style>
