<script setup lang="ts">
import { useLedgerStore } from '../stores/ledger';

const store = useLedgerStore();

function exhibitName(code: string) {
  return store.exhibits.find((item) => item.code === code)?.current.name ?? code;
}
function shortAt(at: string) {
  return at.slice(0, 16).replace('T', ' ');
}
</script>

<template>
  <v-row>
    <v-col v-for="cabinet in store.cabinets" :key="cabinet.id" cols="12" md="6">
      <v-card class="mb-4">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2">
            <v-icon>mdi-archive-outline</v-icon>{{ cabinet.name }}
            <v-spacer />
            <v-chip :color="cabinet.exhibits.length >= cabinet.capacity ? 'red' : 'green'" variant="flat" class="text-white">
              {{ cabinet.exhibits.length }} / {{ cabinet.capacity }}
            </v-chip>
          </v-card-title>
          <v-card-subtitle>容量满时新的 PLACE 操作先排队，出柜释放后按 FIFO 自动入柜</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-list lines="one">
          <v-list-item v-for="code in cabinet.exhibits" :key="code">
            <template #prepend><v-icon color="deep-purple">mdi-bullseye-arrow</v-icon></template>
            <v-list-item-title>{{ code }} · {{ exhibitName(code) }}</v-list-item-title>
            <template #append><v-chip size="x-small" variant="text" :color="cabinet.id === store.scopeCabinet ? 'green' : 'grey'">在柜</v-chip></template>
          </v-list-item>
          <v-list-item v-if="!cabinet.exhibits.length">
            <v-list-item-subtitle>当前为空柜</v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <template v-if="store.queue.some((q) => q.cabinet === cabinet.id)">
          <v-divider />
          <div class="queue-box">
            <div class="queue-title"><v-icon size="16" color="orange">mdi-clock-outline</v-icon> 排队等待本柜（FIFO）</div>
            <v-list density="compact" lines="two">
              <v-list-item v-for="q in store.queue.filter((item) => item.cabinet === cabinet.id)" :key="q.opId">
                <template #prepend><v-icon color="orange">mdi-timer-sand"></v-icon></template>
                <v-list-item-title>{{ q.exhibit }} · {{ exhibitName(q.exhibit) }}</v-list-item-title>
                <v-list-item-subtitle>操作 {{ q.opId }} · {{ q.device }}/{{ q.actor }} · {{ shortAt(q.at) }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </div>
        </template>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.queue-box { background: #fff8e1; padding: 8px 16px 4px; }
.queue-title { font-size: 13px; font-weight: 700; color: #8d6e00; display: flex; align-items: center; gap: 4px; }
</style>
