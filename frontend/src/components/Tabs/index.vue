<script setup lang="ts">
import { computed, ref, useSlots, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

type TabItemType = {
  key: string
  tab: string
  icon?: string // svg path的d属性值，折叠时显示
  component?: Component
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
  collapsible: false
})

const emits = defineEmits(['update:activeKey'])

const { t } = useI18n()
const slots = useSlots()

const isTop = computed(() => props.tabPosition === 'top')
const collapsed = ref(true)

const handleChange = (key: string) => emits('update:activeKey', key)

const isActive = ({ key }: TabItemType) => key === props.activeKey

// NOTE:
// - component tabs are cached via KeepAlive
// - slot tabs are rendered as functional components and NOT cached
const currentComponent = computed(() => {
  const comp = props.items.find((i) => i.key === props.activeKey)?.component
  return comp ?? slots[props.activeKey]
})

// 折叠后内容区占满剩余宽度
const actualContentWidth = computed(() =>
  collapsed.value && !isTop.value ? 'auto' : props.contentWidth,
)
</script>

<template>
  <div :class="{ 'flex-col': isTop }" class="gui-tabs flex">
    <div
      :class="{ 'justify-center mb-8': isTop, 'flex-col': !isTop }"
      :style="{ width: isTop ? 'auto' : collapsed ? '48px' : tabWidth }"
      class="gui-tabs-tab flex"
      role="tablist"
    >
      <Button
        v-for="tab in items"
        :key="tab.key"
        :aria-selected="isActive(tab)"
        :type="isActive(tab) ? 'link' : 'text'"
        :title="collapsed ? t(tab.tab) : ''"
        role="tab"
        @click="handleChange(tab.key)"
      >
        <!-- {{ t(tab.tab) }} -->
        <svg
          v-if="collapsed && tab.icon"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          aria-hidden="true"
          class="tab-icon"
        >
          <path stroke-linecap="round" stroke-linejoin="round" :d="tab.icon" />
        </svg>
        <template v-else>{{ t(tab.tab) }}</template>
      </Button>

      <slot name="extra"></slot>

      <!-- 折叠按钮：mt-auto 顶到侧栏最底部 -->
      <Button
        v-if="collapsible && !isTop"
        type="text"
        class="mt-auto"
        :title="collapsed ? t('common.expand') : t('common.collapse')"
        @click="collapsed = !collapsed"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          aria-hidden="true"
          class="tab-icon collapse-icon"
          :class="{ collapsed }"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </Button>
    </div>

    <div class="flex flex-col flex-1 min-w-0" :style="{ width: isTop ? 'auto' : contentWidth }">
      <ScrollView :pt="0" :pr="24" :pb="8" :pl="8">
        <KeepAlive>
          <component :is="currentComponent" />
        </KeepAlive>
      </ScrollView>
    </div>
  </div>
</template>

<style lang="less" scoped>
.tab-icon {
  width: 20px;
  height: 20px;
}

.collapse-icon {
  transition: transform 0.2s;
  &.collapsed {
    transform: rotate(180deg);
  }
}
</style>
