<script setup lang="ts">
import { computed } from 'vue';
import { useLedgerStore } from '../stores/ledger';
import type { ExhibitRecord, FieldVersion } from '../ledger/types';

const store = useLedgerStore();

const FIELD_LABELS: Record<string, string> = { name: '名称', lender: '借展方', note: '备注' };
const METRIC_LABELS: Record<string, string> = { temperature: '温度', humidity: '湿度', light: '照度' };

const conclusionMeta = {
  none: { color: 'grey', text: '未核验' },
  reviewed: { color: 'green', text: '已核验' },
  review: { color: 'red', text: '退回待复核' }
} as const;

const rows = computed(() =>
  store.exhibits.map((exhibit) => ({
    exhibit,
    openConflicts: store.exhibitOpenConflictCount(exhibit.code),
    openDiscrepancies: store.exhibitOpenDiscrepancyCount(exhibit.code)
  }))
);

function versions(exhibit: ExhibitRecord, field: string): FieldVersion[] {
  return exhibit.fields[field as keyof ExhibitRecord['fields']];
}
function shortAt(v: FieldVersion) {
  return v.at.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <v-row>
    <v-col v-for="row in rows" :key="row.exhibit.code" cols="12" md="6">
      <v-card class="exhibit-card" :class="{ 'needs-review': row.exhibit.conclusion === 'review' }">
        <v-card-title class="d-flex align-center ga-2 flex-wrap">
          <span class="text-h6">{{ row.exhibit.code }}</span>
          <v-chip size="small" :color="conclusionMeta[row.exhibit.conclusion].color" variant="flat" class="text-white">
            {{ conclusionMeta[row.exhibit.conclusion].text }}
          </v-chip>
          <v-chip v-if="row.openConflicts" size="small" color="orange-darken-2" class="text-white">
            {{ row.openConflicts }} 个字段待选定
          </v-chip>
          <v-chip v-if="row.openDiscrepancies" size="small" color="red-darken-2" class="text-white">
            {{ row.openDiscrepancies }} 个差异未关闭
          </v-chip>
          <v-spacer />
          <v-btn size="small" color="deep-purple" variant="tonal" @click="store.confirm(row.exhibit.code)">确认核验</v-btn>
        </v-card-title>

        <v-card-text>
          <v-table density="compact" class="field-table">
            <thead>
              <tr><th style="width:84px">字段</th><th>定版值</th><th style="width:150px">并列版本</th></tr>
            </thead>
            <tbody>
              <tr v-for="field in ['name', 'lender', 'note']" :key="field">
                <td class="text-medium-emphasis">{{ FIELD_LABELS[field] }}</td>
                <td>
                  <span :class="{ 'field-chosen': versions(row.exhibit, field).length > 1 }">
                    {{ row.exhibit.current[field] || '—' }}
                  </span>
                </td>
                <td>
                  <v-tooltip v-for="v in versions(row.exhibit, field)" :key="v.opId" location="top">
                    <template #activator="{ props }">
                      <v-chip v-bind="props" size="x-small" class="mr-1"
                        :color="v.value === row.exhibit.current[field] ? 'green' : 'orange'" variant="tonal">
                        {{ v.device }}/{{ v.opId.slice(0, 6) }}
                      </v-chip>
                    </template>
                    <span>「{{ v.value }}」 · {{ v.actor }} · {{ shortAt(v) }}</span>
                  </v-tooltip>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div class="reading-row mt-2">
            <v-chip v-for="m in ['temperature', 'humidity', 'light']" :key="m" size="small" variant="text" class="reading-chip">
              {{ METRIC_LABELS[m] }}
              {{ store.latestReading(row.exhibit.code, m)?.value ?? '—' }}{{ m === 'temperature' ? '℃' : m === 'humidity' ? '%' : 'lx' }}
              <span v-if="store.latestReading(row.exhibit.code, m)" class="text-caption text-medium-emphasis ml-1">
                ±{{ store.latestReading(row.exhibit.code, m)?.tolerance }}
              </span>
            </v-chip>
          </div>

          <v-alert
            v-if="row.exhibit.conclusion === 'review'"
            type="error" density="compact" variant="tonal" class="mt-3 mb-0"
            title="核验结论已失效，退回待复核"
          >
            <div v-for="(reason, i) in row.exhibit.invalidateReasons" :key="i" class="text-caption">· {{ reason }}</div>
          </v-alert>
          <v-alert
            v-else-if="row.exhibit.conclusion === 'reviewed'"
            type="success" density="compact" variant="tonal" class="mt-3 mb-0"
            :title="`已核验于 ${(row.exhibit.conclusionAt ?? '').slice(0, 16).replace('T', ' ')}`"
          >
            基线读数：
            <span v-for="m in ['temperature', 'humidity', 'light']" :key="m" class="mr-2">
              {{ METRIC_LABELS[m] }}={{ row.exhibit.readingSnapshot[m as keyof typeof row.exhibit.readingSnapshot] ?? '—' }}
            </span>
          </v-alert>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.exhibit-card { margin-bottom: 12px; }
.exhibit-card.needs-review { border: 1px solid #ef5350; }
.field-chosen { font-weight: 700; }
.reading-chip { font-variant-numeric: tabular-nums; }
</style>
