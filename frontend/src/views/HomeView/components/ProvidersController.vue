<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKernelApiStore } from '@/stores'
import { buildSmartRegExp, ignoredError, sleep } from '@/utils'

import ProxyProvider from './ProxyProvider.vue'

const expandedSet = ref<Set<string>>(new Set())
const loadingSet = ref<Set<string>>(new Set())
const keywords = ref('')
const loading = ref(false)

const { t } = useI18n()
const kernelApiStore = useKernelApiStore()

// 只按关键字过滤（支持匹配节点名），不排序、不处理隐藏
const providers = computed(() => {
  const list = kernelApiStore.proxyProviders
  if (!keywords.value) return list
  const reg = buildSmartRegExp(keywords.value, 'i')
  return list.filter(
    (p) => reg.test(p.name) || (p.proxies ?? []).some((n) => reg.test(n.name)),
  )
})

const toggleExpanded = (name: string) => {
  expandedSet.value.has(name) ? expandedSet.value.delete(name) : expandedSet.value.add(name)
}

const handleRefresh = async () => {
  loading.value = true
  await ignoredError(kernelApiStore.refreshProviderProxies)
  await sleep(100)
  loading.value = false
}

onActivated(() => {
  kernelApiStore.refreshProviderProxies()
})
</script>

<template>
  <div class="m-8 mt-0 sticky top-0 z-3">
    <div
      class="sticky flex gap-8 items-center p-8 rounded-8 backdrop-blur-sm"
      style="background-color: var(--card-bg)"
    >
      <Input v-model="keywords" :placeholder="t('common.keywords')" editable clearable />
      <div class="ml-auto flex items-center">
        <Button
          v-tips="'home.overview.refresh'"
          :loading="loading"
          icon="refresh"
          type="text"
          @click="handleRefresh"
        />
      </div>
    </div>
  </div>

  <Empty v-if="providers.length === 0" class="m-8" />
  <ProxyProvider
    v-for="p in providers"
    :key="p.name"
    :provider="p"
    :expanded="expandedSet.has(p.name)"
    :loading-set="loadingSet"
    @toggle="toggleExpanded(p.name)"
    @refresh="handleRefresh"
  />
</template>
