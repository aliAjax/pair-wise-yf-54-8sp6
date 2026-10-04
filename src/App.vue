<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useLedgerStore } from './stores/ledger';
import type { Actor, Role } from './ledger/types';
import LedgerTab from './components/LedgerTab.vue';
import ConflictsTab from './components/ConflictsTab.vue';
import ReadingsTab from './components/ReadingsTab.vue';
import CabinetsTab from './components/CabinetsTab.vue';
import ImportTab from './components/ImportTab.vue';
import AuditTab from './components/AuditTab.vue';

const store = useLedgerStore();
const tab = ref('import');

const ROLE_OPTIONS: { value: Role; title: string; name: string }[] = [
  { value: 'curator', title: '策展人（全局权限）', name: '周策展' },
  { value: 'keeper', title: '保管员（仅本柜）', name: '王保管' },
  { value: 'lender', title: '借展方（无权确认）', name: '赵借展' }
];

const metrics = computed(() => ({
  exhibits: store.exhibits.length,
  openConflicts: store.openConflicts.length,
  review: store.exhibits.filter((item) => item.conclusion === 'review').length,
  queued: store.queue.length
}));

function changeRole(role: Role) {
  const found = ROLE_OPTIONS.find((item) => item.value === role);
  if (!found) return;
  const actor: Actor = { name: found.name, role };
  store.setActor(actor);
  store.notify(`已切换身份：${found.title}`, 'info');
}

function dismissToast(v: boolean) {
  if (!v) store.toast = null;
}

const cabinetItems = computed(() => store.cabinets.map((c) => ({ title: `${c.id} ${c.name}`, value: c.id })));

watch(
  () => store.toast,
  (toast) => {
    if (toast) setTimeout(() => (store.toast = null), 3200);
  }
);
</script>

<template>
  <v-app>
    <v-app-bar color="deep-purple-darken-3" flat density="comfortable">
      <v-app-bar-title>借展点交核验账 · 交接文本去重合并台</v-app-bar-title>
      <v-btn-toggle mandatory color="white" variant="outlined" density="compact" :model-value="store.actor.role"
        class="mr-4" @update:model-value="changeRole">
        <v-btn value="curator" size="small">策展人</v-btn>
        <v-btn value="keeper" size="small">保管员</v-btn>
        <v-btn value="lender" size="small">借展方</v-btn>
      </v-btn-toggle>
      <v-select
        v-if="store.actor.role === 'keeper'"
        :model-value="store.scopeCabinet"
        :items="cabinetItems"
        density="compact" variant="outlined" hide-details color="white"
        style="max-width: 230px"
        @update:model-value="store.setScopeCabinet"
      />
      <v-chip class="ml-3" :color="store.actor.role === 'lender' ? 'red' : store.actor.role === 'keeper' ? 'orange' : 'green'"
        variant="flat" size="small">{{ store.actor.name }}</v-chip>
      <v-btn icon="mdi-restore" variant="text" class="ml-2" @click="store.resetAll()"></v-btn>
    </v-app-bar>

    <v-main class="bg-grey-lighten-4">
      <v-container fluid class="pa-5">
        <v-row class="mb-3">
          <v-col cols="6" md="3"><v-card><v-card-text><div class="metric-label">核验账展品</div><div class="metric">{{ metrics.exhibits }}</div></v-card-text></v-card></v-col>
          <v-col cols="6" md="3"><v-card><v-card-text><div class="metric-label">待选定并列字段</div><div class="metric warn">{{ metrics.openConflicts }}</div></v-card-text></v-card></v-col>
          <v-col cols="6" md="3"><v-card><v-card-text><div class="metric-label">退回待复核</div><div class="metric warn">{{ metrics.review }}</div></v-card-text></v-card></v-col>
          <v-col cols="6" md="3"><v-card><v-card-text><div class="metric-label">柜位排队 / 已入账操作</div><div class="metric">{{ metrics.queued }} <span class="metric-sub">/ {{ store.postedCount }}</span></div></v-card-text></v-card></v-col>
        </v-row>

        <v-card>
          <v-tabs v-model="tab" color="deep-purple" density="default">
            <v-tab value="import">交接导入 / 重试</v-tab>
            <v-tab value="ledger">展品核验账</v-tab>
            <v-tab value="conflicts">字段选定</v-tab>
            <v-tab value="readings">读数与差异</v-tab>
            <v-tab value="cabinets">柜位安排</v-tab>
            <v-tab value="audit">审计留痕</v-tab>
          </v-tabs>
          <v-divider />
          <v-window v-model="tab">
            <v-window-item value="import"><div class="tab-body"><ImportTab /></div></v-window-item>
            <v-window-item value="ledger"><div class="tab-body"><LedgerTab /></div></v-window-item>
            <v-window-item value="conflicts"><div class="tab-body"><ConflictsTab /></div></v-window-item>
            <v-window-item value="readings"><div class="tab-body"><ReadingsTab /></div></v-window-item>
            <v-window-item value="cabinets"><div class="tab-body"><CabinetsTab /></div></v-window-item>
            <v-window-item value="audit"><div class="tab-body"><AuditTab /></div></v-window-item>
          </v-window>
        </v-card>
      </v-container>
    </v-main>

    <v-snackbar :model-value="Boolean(store.toast)" :color="store.toast?.color ?? 'info'" timeout="3200" location="top right"
      @update:model-value="dismissToast">
      {{ store.toast?.text }}
    </v-snackbar>
  </v-app>
</template>

<style>
.metric-label { color: #6b7280; font-size: 13px; }
.metric { font-size: 30px; font-weight: 750; color: #4c1d95; line-height: 1.2; }
.metric.warn { color: #b91c1c; }
.metric-sub { font-size: 15px; color: #9e9e9e; font-weight: 500; }
.tab-body { padding: 20px; }
</style>
