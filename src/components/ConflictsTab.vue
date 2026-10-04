<script setup lang="ts">
import { computed } from 'vue';
import { useLedgerStore } from '../stores/ledger';
import type { Conflict } from '../ledger/types';

const store = useLedgerStore();

const FIELD_LABELS: Record<string, string> = { name: '名称', lender: '借展方', note: '备注', detail: '差异描述' };

const list = computed(() =>
  store.conflicts
    .slice()
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.createdAt.localeCompare(b.createdAt))
);

function kindLabel(c: Conflict) {
  return c.kind === 'exhibit-field' ? `展品字段 · ${c.exhibit} · ${FIELD_LABELS[c.field]}` : `差异项描述 · ${c.exhibit} · ${c.dkey}`;
}
function shortAt(at: string) {
  return at.slice(0, 16).replace('T', ' ');
}
function scopeNote(c: Conflict) {
  if (store.actor.role === 'curator') return '策展人：全局权限';
  if (store.actor.role === 'lender') return '借展方：无权选定（点击将被拒绝）';
  return c.cabinetId === store.scopeCabinet
    ? `本柜（${store.scopeCabinet}）冲突，可处理`
    : `属 ${c.cabinetId}，非本柜（${store.scopeCabinet}），将被拒绝`;
}
</script>

<template>
  <v-card>
    <v-card-item>
      <v-card-title>字段核验 · 两版并列，选定后才能推进</v-card-title>
      <v-card-subtitle>
        同字段两版均保留；借展方确认直接拒绝，保管员仅能处理本柜冲突。当前身份：
        <b>{{ store.actor.name }}</b>（{{ { curator: '策展人', keeper: '保管员', lender: '借展方' }[store.actor.role] }}）
        <template v-if="store.actor.role === 'keeper'">，管辖柜 {{ store.scopeCabinet }}</template>
      </v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-list v-if="list.length">
      <template v-for="c in list" :key="c.id">
        <v-list-item class="conflict-row">
          <template #prepend>
            <v-icon :color="c.resolved ? 'green' : 'orange'" size="28">
              {{ c.resolved ? 'mdi-check-circle' : 'mdi-source-merge' }}
            </v-icon>
          </template>
          <v-list-item-title class="font-weight-bold">{{ kindLabel(c) }}</v-list-item-title>
          <v-list-item-subtitle>
            <v-chip v-if="c.resolved" size="x-small" color="green" class="mr-2">{{ c.choice === 'ledger' ? '已保留台账版' : '已采用回传版' }} · {{ c.chosenBy }}</v-chip>
            <span v-else>{{ scopeNote(c) }}</span>
          </v-list-item-subtitle>
        </v-list-item>
        <div class="version-grid">
          <div class="version-col" :class="{ chosen: c.resolved && c.choice === 'ledger' }">
            <div class="version-head">
              <v-icon size="16" class="mr-1">mdi-book-open-variant</v-icon>台账版
            </div>
            <div class="version-value">{{ c.ledger?.value ?? '（无）' }}</div>
            <div class="version-meta">{{ c.ledger?.device }}/{{ c.ledger?.opId }} · {{ c.ledger?.actor }} · {{ c.ledger ? shortAt(c.ledger.at) : '' }}</div>
            <v-btn size="small" block color="deep-purple" variant="tonal" class="mt-2"
              :disabled="c.resolved" @click="store.chooseConflict(c.id, 'ledger')">保留台账版</v-btn>
          </div>
          <div class="vs">VS</div>
          <div class="version-col" :class="{ chosen: c.resolved && c.choice === 'incoming' }">
            <div class="version-head">
              <v-icon size="16" class="mr-1">mdi-tablet-cellphone</v-icon>回传版
            </div>
            <div class="version-value">{{ c.incoming.value }}</div>
            <div class="version-meta">{{ c.incoming.device }}/{{ c.incoming.opId }} · {{ c.incoming.actor }} · {{ shortAt(c.incoming.at) }}</div>
            <v-btn size="small" block color="orange-darken-2" variant="tonal" class="mt-2"
              :disabled="c.resolved" @click="store.chooseConflict(c.id, 'incoming')">采用回传版</v-btn>
          </div>
        </div>
        <v-divider />
      </template>
    </v-list>
    <v-empty-state v-else icon="mdi-file-sync-outline" title="暂无冲突" description="导入回传数据后，同字段不同版本会在此并列" class="py-8" />
  </v-card>
</template>

<style scoped>
.conflict-row { align-items: flex-start; }
.version-grid { display: grid; grid-template-columns: 1fr 48px 1fr; gap: 8px; padding: 0 24px 16px 64px; align-items: stretch; }
.version-col { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; background: #fafafa; }
.version-col.chosen { border-color: #4caf50; background: #f1f8e9; }
.version-head { font-size: 12px; color: #6b7280; display: flex; align-items: center; }
.version-value { font-weight: 650; margin: 6px 0; min-height: 20px; }
.version-meta { font-size: 11px; color: #9e9e9e; }
.vs { align-self: center; text-align: center; font-weight: 800; color: #9c27b0; font-size: 13px; }
</style>
