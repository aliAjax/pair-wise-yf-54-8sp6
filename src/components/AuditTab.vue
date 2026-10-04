<script setup lang="ts">
import { useLedgerStore } from '../stores/ledger';

const store = useLedgerStore();
function shortAt(at: string) {
  return at.slice(0, 19).replace('T', ' ');
}
</script>

<template>
  <v-card>
    <v-card-item>
      <v-card-title>核验账审计留痕</v-card-title>
      <v-card-subtitle>入账、冲突选定、越权拒绝、结论确认与失效全部留痕（最近 300 条）</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-table density="compact">
      <thead><tr><th style="width:160px">时间</th><th style="width:110px">操作人</th><th style="width:120px">动作</th><th>说明</th><th style="width:90px">操作编号</th></tr></thead>
      <tbody>
        <tr v-for="(entry, i) in store.ledger.audit" :key="i" :class="{ 'row-denied': entry.denied }">
          <td class="text-caption">{{ shortAt(entry.at) }}</td>
          <td>{{ entry.actor }}</td>
          <td>
            <v-chip size="x-small" :color="entry.denied ? 'red' : 'deep-purple'" variant="tonal">
              {{ entry.action }}
            </v-chip>
          </td>
          <td class="text-caption">{{ entry.detail }}</td>
          <td class="mono text-caption">{{ entry.opId ?? '—' }}</td>
        </tr>
      </tbody>
    </v-table>
  </v-card>
</template>

<style scoped>
.row-denied { background: #ffebee; }
.mono { font-family: 'Roboto Mono', monospace; }
</style>
