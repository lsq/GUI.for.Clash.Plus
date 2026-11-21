<script setup lang="ts">
import { useAppSettingsStore } from '@/stores'

const props = defineProps<{
  proxies: any[]
  selected?: string
  loadingSet: Set<string>
  selectable?: boolean
}>()

const emit = defineEmits<{
  select: [proxy: any]
  test: [name: string]
}>()

const appSettings = useAppSettingsStore()

const delayColor = (delay = 0) => {
  if (delay === 0) return 'var(--level-0-color)'
  if (delay < 200) return 'var(--level-1-color)'
  if (delay < 500) return 'var(--level-2-color)'
  if (delay < 1200) return 'var(--level-3-color)'
  return 'var(--level-4-color)'
}

const isLoading = (name: string) => props.loadingSet.has(name)

const onClick = (proxy: any) => {
  if (props.selectable) {
    emit('select', proxy)
  } else {
    emit('test', proxy.name)
  }
}
</script>

<template>
  <div
    v-if="appSettings.app.kernel.cardMode"
    :class="`grid-cols-${appSettings.app.kernel.cardColumns}`"
    class="grid gap-8"
  >
    <Card
      v-for="proxy in proxies"
      :key="proxy.name"
      :title="proxy.name"
      :selected="selectable && proxy.name === selected"
      class="cursor-pointer"
      @click="onClick(proxy)"
    >
      <Button
        :style="{ color: delayColor(proxy.delay) }"
        :loading="isLoading(proxy.name)"
        type="text"
        size="small"
        style="margin-left: -2px; padding-left: 2px"
        @click.stop="emit('test', proxy.name)"
      >
        <div class="text-12">
          {{ proxy.delay && proxy.delay + 'ms' }}
        </div>
      </Button>
      <div class="text-12 my-2">{{ proxy.type }} {{ proxy.udp ? ':: udp' : '' }}</div>
    </Card>
  </div>
  <div v-else class="grid grid-cols-32 gap-8">
    <div
      v-for="proxy in proxies"
      :key="proxy.name"
      v-tips.fast="proxy.name"
      :style="{ background: delayColor(proxy.delay) }"
      :class="selectable && proxy.name === selected ? 'rounded-full shadow' : ''"
      class="w-12 h-12 rounded-4 flex items-center justify-center"
      @click="onClick(proxy)"
    >
      <Icon v-if="isLoading(proxy.name)" icon="loading" :size="12" class="rotation" />
    </div>
  </div>
</template>
