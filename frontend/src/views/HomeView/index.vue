<script setup lang="ts">
import {computed, ref, watch, useSlots, useTemplateRef, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

import logo from '@/assets/logo'
import { ControllerCloseMode } from '@/enums/app'
import { useAppSettingsStore, useProfilesStore, useKernelApiStore } from '@/stores'
import { APP_TITLE, message, debounce, modal } from '@/utils'

import GroupsController from './components/GroupsController.vue'
import ProvidersController from './components/ProvidersController.vue'
import KernelLogs from './components/KernelLogs.vue'
import OverView from './components/OverView.vue'
import QuickStart from './components/QuickStart.vue'

const controllerTab = ref('groups')
const controllerTabs = [
  { key: 'groups', tab: 'home.controller.groups',
    icon: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418',
    component: GroupsController },
  { key: 'providers', tab: 'home.controller.providers',
    icon: 'M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z',
    component: ProvidersController },
] as const

const sidebarCollapsed = ref(false)
const showController = ref(false)
const controllerRef = useTemplateRef('controllerRef')

type TabItemType = {
  key: string,
  tab: string
  icon?:string // svg path 的d属性值，折叠时显示
  component?: Component,
}
interface Props {
  activeKey: string
  items: readonly TabItemType[]
  tabPosition?: 'left' | 'top'
  tabWidth?: string
  contentWidth?: string
  collapsible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  tabPosition: 'left',
  tabWidth: '20%',
  contentWidth: '80%',
  collapsible: false,
})

const emits = defineEmits(['update:activeKey'])

const slots = useSlots()

const isTop = computed(() => props.tabPosition === 'top')
const collapsed = ref(false)

const handleChange = (key: string) => emits('update:activeKey', key)

const isActive = ({ key }: TabItemType) => key === props.activeKey

const currentComponent = computed(() => {
  const comp = props.items.find((i) => i.key === props.activeKey)?.component
  return comp ?? slots[props.activeKey]
})

// 折叠后内容区占满剩余宽度
const actualContentWidth = computed(() =>
  collapsed.value && !isTop.value ? 'auto' : props.contentWidth,
)

const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()
const profilesStore = useProfilesStore()
const kernelApiStore = useKernelApiStore()

const handleStartKernel = async () => {
  try {
    if (appSettingsStore.app.kernel.panelOnlyMode) {
      await kernelApiStore.restartCore()
    } else {
    await kernelApiStore.startCore()
    }
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleShowQuickStart = () => {
  modal({ title: 'subscribes.enterLink' }).setContent(QuickStart).open()
}

const handleShowKernelLogs = () => {
  const m = modal({
    title: 'home.overview.viewlog',
    width: '90',
    height: '90',
    submit: false,
    cancelText: 'common.close',
    maskClosable: true,
  })
  m.setContent(KernelLogs).open()
}

let scrollEventCount = 0
const resetScrollEventCount = debounce(() => (scrollEventCount = 0), 100)

const onMouseWheel = (e: WheelEvent) => {
  if (!kernelApiStore.running) return

  const isScrollingDown = e.deltaY > 0

  if (
    isScrollingDown ||
    appSettingsStore.app.kernel.controllerCloseMode === ControllerCloseMode.All
  ) {
    const currentScrollTop = controllerRef.value?.scrollTop ?? 0
    if (isScrollingDown || currentScrollTop === 0) {
      scrollEventCount += 1
    }
    if (scrollEventCount >= appSettingsStore.app.kernel.controllerSensitivity) {
      showController.value = isScrollingDown || currentScrollTop !== 0
    }
  }

  resetScrollEventCount()
}

watch(showController, (v) => {
  if (v) {
    kernelApiStore.refreshProviderProxies()
  } else {
    kernelApiStore.refreshConfig()
  }
})
</script>

<template>
  <div class="home-view relative overflow-hidden h-full" @wheel.passive="onMouseWheel">
    <div
      v-if="(!kernelApiStore.running && !kernelApiStore.stopping) || kernelApiStore.starting"
      class="w-full h-[90%] flex flex-col items-center justify-center"
    >
      <img :src="logo" draggable="false" class="w-128 mb-16" />

      <template v-if="profilesStore.profiles.length === 0">
        <p>{{ t('home.noProfile', [APP_TITLE]) }}</p>
        <Button type="primary" @click="handleShowQuickStart">{{ t('home.quickStart') }}</Button>
      </template>

      <template v-else>
        <div class="flex gap-8 mb-32">
          <Card
            v-for="p in profilesStore.profiles.slice(0, profilesStore.profiles.length > 4 ? 3 : 4)"
            :key="p.id"
            :selected="appSettingsStore.app.kernel.profile === p.id"
            @click="appSettingsStore.app.kernel.profile = p.id"
          >
            <div
              class="w-128 h-full flex items-center justify-center py-24 text-center cursor-pointer font-bold text-12"
            >
              {{ p.name }}
            </div>
          </Card>
          <Dropdown v-if="profilesStore.profiles.length > 4" placement="top">
            <Card class="h-full">
              <div
                class="w-128 h-full flex items-center justify-center py-24 text-center cursor-pointer font-bold text-12"
              >
                ...
              </div>
            </Card>
            <template #overlay>
              <div class="flex flex-col py-8">
                <Button
                  v-for="p in profilesStore.profiles.slice(3)"
                  :key="p.id"
                  @click="appSettingsStore.app.kernel.profile = p.id"
                >
                  <div class="min-w-32 w-full flex items-center justify-between">
                    {{ p.name }}
                    <Icon v-if="appSettingsStore.app.kernel.profile === p.id" icon="selected" />
                  </div>
                </Button>
              </div>
            </template>
          </Dropdown>
          <Card @click="handleShowQuickStart">
            <div
              class="w-128 h-full flex items-center justify-center py-24 text-center cursor-pointer font-bold text-12"
            >
              {{ t('home.quickStart') }}
            </div>
          </Card>
        </div>
        <Button :loading="kernelApiStore.starting || kernelApiStore.restarting" type="primary" @click="handleStartKernel">
          {{ appSettingsStore.app.kernel.panelOnlyMode ? t('home.overview.connect') : t('home.overview.start') }}
        </Button>
        <Button v-if="!appSettingsStore.app.kernel.panelOnlyMode" type="link" size="small" class="mt-4" @click="handleShowKernelLogs">
          {{ t('home.overview.viewlog') }}
        </Button>
      </template>
    </div>

    <template v-else-if="!kernelApiStore.coreStateLoading">
      <div :class="{ 'blur-3xl': showController }">
        <OverView />
        <Divider class="controller-trigger">
          <Button type="link" size="small" @click="showController = true">
            {{ t('home.controller.name') }}
          </Button>
        </Divider>
      </div>

      <div
        ref="controllerRef"
        :class="showController ? 'translate-y-0' : 'translate-y-full'"
        class="controller-panel absolute inset-0 pb-32 duration-400"
      >
        <!-- <div class="flex h-full"> -->
          <!-- 可折叠侧边栏 -->
          <!-- <div v-show="!sidebarCollapsed" class="flex flex-col shrink-0 w-120 pt-8"> -->
          <!--   <Button -->
          <!--     v-for="tab in controllerTabs" -->
          <!--     :key="tab.key" -->
          <!--     :type="controllerTab === tab.key ? 'link' : 'text'" -->
          <!--     @click="controllerTab = tab.key" -->
          <!--   > -->
          <!--     {{ t(tab.tab) }} -->
          <!--   </Button> -->
          <!-- </div> -->
          <!-- 折叠/展开按钮 -->
          <!-- <Button -->
          <!--   type="text" -->
          <!--   size="small" -->
          <!--   class="self-start mt-8" -->
          <!--   @click="sidebarCollapsed = !sidebarCollapsed" -->
          <!-- > -->
          <!--   <Icon :icon="sidebarCollapsed ? 'arrowRight' : 'arrowLeft'" /> -->
          <!-- </Button> -->
          <!-- 内容区 -->
        <!--   <div class="flex-1 overflow-y-auto"> -->
        <!--     <KeepAlive> -->
        <!--       <component :is="controllerTabs.find(t2 => t2.key === controllerTab)!.component" /> -->
        <!--     </KeepAlive> -->
        <!--   </div> -->
        <!-- </div> -->

        <!-- <GroupsController /> -->

        <Tabs v-model:active-key="controllerTab" :items="controllerTabs" collapsible class="h-full" />
      </div>
      <!-- <Button -->
      <!--   v-show="showController" -->
      <!--   class="controller-close absolute left-1/2 -translate-x-1/2 bottom-12 z-2" -->
      <!--   style="background-color: var(--card-bg)" -->
      <!--   type="text" -->
      <!--   size="small" -->
      <!--   icon="close" -->
      <!--   @click="showController = false" -->
      <!-- /> -->
    </template>
  </div>
</template>
