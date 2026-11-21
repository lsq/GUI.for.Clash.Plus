<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CoreApiProxyProvider, } from '@/types/kernel'
import { getProxyDelay, healthCheckProvider, updateProvider, } from '@/api/kernel'
import { DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { formatBytes, formatRelativeTime, ignoredError, message } from '@/utils'

import ProxyList from './ProxyList.vue'

const props = defineProps<{
  provider: CoreApiProxyProvider
  expanded: boolean
  loadingSet: Set<string>
}>()

const emit = defineEmits<{
  toggle: []
  refresh: []
}>()

const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const updating = ref(false)
const checking = ref(false)

const aliveCount = computed(
  () =>
    props.provider.proxies?.filter(
      (p: any) => (p.history?.[p.history.length - 1]?.delay ?? 0) > 0,
    ).length ?? 0,
)
const total = computed(() => props.provider.proxies?.length ?? 0)
const updatedAt = computed(() =>
  props.provider.updatedAt ? new Date(props.provider.updatedAt).toLocaleString() : '',
)

const nodes = computed(() =>
  (props.provider.proxies ?? [])
    .map((p) => {
      const history = kernelApiStore.proxies[p.name]?.history ?? p.history ?? []
      const delay = history[history.length - 1]?.delay || 0
      return { ...kernelApiStore.proxies[p.name], ...p, delay }
    })
    .sort((a, b) => {
      if (!appSettings.app.kernel.sortByDelay || a.delay === b.delay) return 0
      if (!a.delay) return 1
      if (!b.delay) return -1
      return a.delay - b.delay
    }),
)

// 订阅信息：全 0 不显示
const subInfo = computed(() => {
  const info = props.provider.subscriptionInfo
  if (!info) return null
  const { Download = 0, Upload = 0, Total = 0, Expire = 0 } = info
  if (!Download && !Upload && !Total && !Expire) return null
  const used = Download + Upload
  const percent = Total > 0 ? Math.min(100, Math.round((used / Total) * 100)) : 0
  return { used, Total, percent, Expire }
})

const progressColor = computed(() => {
  const p = subInfo.value?.percent ?? 0
  if (p >= 90) return 'var(--error-color, red)'
  if (p >= 70) return 'var(--warning-color, orange)'
  return 'var(--primary-color)'
})

const handleTest = async (name: string) => {
  props.loadingSet.add(name)
  try {
    const proxy = kernelApiStore.proxies[name]
    const { delay = 0 } = await getProxyDelay(
      encodeURIComponent(props.provider.name),
      encodeURIComponent(name),
      appSettings.app.kernel.testUrl || DefaultTestURL,
      appSettings.app.kernel.testTimeout || DefaultTestTimeout,
    )
    proxy && proxy.history.push({ delay })
  } catch (error: any) {
    message.error(error + ': ' + name)
  }
  props.loadingSet.delete(name)
}

const handleHealthCheck = async () => {
  checking.value = true
  await healthCheckProvider(props.provider.name).catch((err) => message.error(err?.message || err))
  await ignoredError(kernelApiStore.refreshProviderProxies)
  checking.value = false
}

const handleUpdate = async () => {
  updating.value = true
  await updateProvider(props.provider.name).catch((err) => message.error(err?.message || err))
  await ignoredError(kernelApiStore.refreshProviderProxies)
  updating.value = false
}
</script>

<template>
  <div class="m-8">
    <div
      class="sticky z-2 flex gap-8 items-center p-8 rounded-8 backdrop-blur-sm"
      style="top: 52px; background-color: var(--card-bg)"
      @click="emit('toggle')"
    >
      <div class="text-14 flex items-center gap-2 text-nowrap overflow-hidden">
        <span class="font-bold text-18">{{ provider.name }}</span>
        <span class="mx-8">{{ provider.vehicleType }}</span>
        <span>{{ aliveCount }} / {{ total }}</span>
        <span v-if="updatedAt" class="text-12" style="color: var(--text-secondary-color, gray)">
          (更新于 {{ updatedAt }})
        </span>
        <!-- <span>:: {{ provider.proxies?.length ?? 0 }}</span> -->
      </div>
      <div class="ml-auto flex items-center" @click.stop>
        <Button
          v-tips="'home.provider.healthCheck'"
          :loading="checking"
          type="text"
          icon="speedTest"
          @click="handleHealthCheck"
        />
        <Button
          v-if="provider.vehicleType !== 'Inline'"
          v-tips="'home.provider.update'"
          :loading="updating"
          type="text"
          icon="update"
          @click="handleUpdate"
        />
        <Button type="text" @click="emit('toggle')">
          <Icon
            :class="{ 'action-expand-expanded': expanded }"
            class="action-expand origin-center duration-200"
            icon="arrowDown"
          />
        </Button>
      </div>
    </div>

    <!-- 订阅信息条 -->
    <div v-if="subInfo" class="mx-8 mt-4 text-12" style="color: var(--text-color-2, gray)">
      <div class="flex justify-between">
        <span>{{ formatBytes(subInfo.used) }} / {{ formatBytes(subInfo.Total) }}</span>
        <span v-if="subInfo.Expire">
          {{ formatRelativeTime(subInfo.Expire * 1000) }}
        </span>
      </div>
      <div class="h-4 rounded-4 mt-2" style="background: var(--level-0-color)">
        <div
          class="h-4 rounded-4"
          :style="{ width: subInfo.percent + '%', background: progressColor }"
        />
      </div>
    </div>

    <Transition name="expand">
      <div v-if="expanded" class="py-8 px-4">
        <Empty v-if="nodes.length === 0" />
        <ProxyList
          v-else
          :proxies="nodes"
          :loading-set="loadingSet"
          @test="handleTest"
        />
      </div>
    </Transition>
  </div>
</template>
