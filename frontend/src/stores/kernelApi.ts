import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  getConfigs,
  setConfigs,
  getProxies,
  onLogs,
  onMemory,
  onTraffic,
  onConnections,
  initWebsocket,
  destroyWebsocket,
  probeApiAvailability,
  getProviders,
  reloadConfigs,
  restartCoreApi,
  loadExternalApiConfig,
  getExternalApi,
  restoreExternalController,
  getVersion,
} from '@/api/kernel'
import { ProcessInfo, KillProcess, ExecBackground, ReadFile, RemoveFile } from '@/bridge'
import { CoreLogFilePath, CorePidFilePath, CoreWorkingDirectory, PanelProfileId,} from '@/constant/kernel'
// CoreConfigFilePath
import { Branch } from '@/enums/app'
import { RuleType } from '@/enums/kernel'
import {
  useAppSettingsStore,
  useProfilesStore,
  useLogsStore,
  useEnvStore,
  usePluginsStore,
  useSubscribesStore,
  useRulesetsStore,
} from '@/stores'
import {
  generateConfigFile,
  updateTrayAndMenus,
  getKernelFileName,
  normalizeProxyHost,
  message,
  getKernelRuntimeArgs,
  getKernelRuntimeEnv,
  eventBus,
  sleep,
  stringifyNoFolding,
  fixProviderPaths,
} from '@/utils'

import type { CoreApiConfig, CoreApiProxy, CoreApiProxyProvider, } from '@/types/kernel'

export type ProxyType = 'mixed' | 'http' | 'socks'
export type ProxyEndpoint = {
  schema: 'http' | 'socks5'
  host: string
  port: number
  username: string
  password: string
  proxyType: ProxyType
}

export const useKernelApiStore = defineStore('kernelApi', () => {
  const envStore = useEnvStore()
  const logsStore = useLogsStore()
  const pluginsStore = usePluginsStore()
  const profilesStore = useProfilesStore()
  const subscribesStore = useSubscribesStore()
  const rulesetsStore = useRulesetsStore()
  const appSettingsStore = useAppSettingsStore()

  /** RESTful API */
  const config = ref<CoreApiConfig>({
    port: 0,
    'socks-port': 0,
    'mixed-port': 0,
    'interface-name': '',
    'allow-lan': false,
    mode: '',
    tun: {
      enable: false,
      stack: '',
      device: '',
    },
  })

  const proxies = ref<Record<string, CoreApiProxy>>({})
  const proxyProviders = ref<CoreApiProxyProvider[]>([])

  const refreshConfig = async () => {
    config.value = await getConfigs()
  }

  const resetConfig = () => {
    config.value.port = 0
    config.value['socks-port'] = 0
    config.value['mixed-port'] = 0
    config.value['interface-name'] = ''
    config.value['allow-lan'] = false
    config.value.mode = ''
    config.value.tun.enable = false
    config.value.tun.stack = ''
    config.value.tun.device = ''
  }

  const updateConfig = async (options: Record<string, any>) => {
    await setConfigs(options)
    await refreshConfig()
  }

  const refreshProviderProxies = async () => {
    const [a, { proxies: b }] = await Promise.all([getProviders(), getProxies()])

    // 过滤内置占位和内联节点产生的供应商，保持接口返回顺序
    proxyProviders.value = Object.values(a.providers ?? {}).filter(
      (p) => p.name !== 'default' && p.vehicleType !== 'Compatible',
    )

    // 给节点打 provider 标记并合并进 proxies（不覆盖已有节点）
    for (const provider of proxyProviders.value) {
      for (const proxy of provider.proxies ?? []) {
        proxy.provider ||= provider.name
        if (!b[proxy.name]) {
          b[proxy.name] = proxy
        }
      }
    }
    proxies.value = b
  }

 // const refreshProviderProxies = async () => {
 //    const [a, { proxies: b }] = await Promise.all([getProviders(), getProxies()])
 //    for (const provider in a.providers) {
 //      if (!b[provider]) {
 //        for (const proxy of a.providers[provider].proxies) {
 //          if (!b[proxy.name]) {
 //            proxy.provider = provider
 //            b[proxy.name] = proxy
 //          }
 //        }
 //      }
 //    }
 //    proxies.value = b
 //  }

  /* Bridge API */
  const corePid = ref(-1)
  const running = ref(false)
  const starting = ref(false)
  const stopping = ref(false)
  const restarting = ref(false)
  const needRestart = ref(false)
  const coreStateLoading = ref(true)
  let isCoreStartedByThisInstance = false
  let { promise: coreStoppedPromise, resolve: coreStoppedResolver } = Promise.withResolvers()

  watch(
    () => appSettingsStore.app.kernel.panelOnlyMode,
    async (enabled, prev) => {
      if (enabled === prev) return

      if (running.value) {
        if (enabled) {
          // 默认 → 面板：内核是 GUI 拉起的，正常停掉
          await stopCore().catch(() => {})
        } else {
          // 面板 → 默认：外部进程不归 GUI 管，只断开不杀
          await onCoreStopped()
        }
      }
      // 按新模式重新走初始化（面板=连接 extApi；默认=读 pid.txt / autoStartKernel）
      await initCoreState()
    },
  )

  const coreVersionDetail = ref('')

  const ensurePanelProfile = async () => {
    const { externalConfigPath } = appSettingsStore.app.kernel
    if (!externalConfigPath) return

    // 先解析外部文件，拿到真实的 controller/secret
    await loadExternalApiConfig()
    const ext = getExternalApi()

    let profile = profilesStore.getProfileById(PanelProfileId)
    if (!profile) {
      profile = profilesStore.getProfileTemplate('External Config')
      profile.id = PanelProfileId
      await profilesStore.addProfile(profile)
    }

    // 关键：把外部文件的 external-controller/secret 写进 profile 的 advancedConfig，
    // 保证默认模式启动该 profile 时 setupCoreApi 能连上正确的地址
    if (ext) {
      profile.advancedConfig['external-controller'] = ext.controller
      profile.advancedConfig.secret = ext.bearer
      await profilesStore.editProfile(PanelProfileId, profile)
    }
    if (!appSettingsStore.app.kernel.profile) {
      appSettingsStore.app.kernel.profile = PanelProfileId
    }
  }

  const connectExternal = async () => {
    await loadExternalApiConfig()
    await refreshConfig() // 失败抛错，由调用处提示
    await onCoreStarted(-1)
  }

  const reloadWithProfile = async (profile: App.Profile, cleanupTask?: () => Promise<any>) => {
    await loadExternalApiConfig()
    if (!getExternalApi()) throw 'kernel.externalConfigPathRequired'

    // 不再生成，直接复用
    // 要求4：生成配置保留 profile 自己的 external-controller/secret/cors，不替换
    // let payload = await ReadFile(CoreConfigFilePath).catch(() => '')
    let payload = ''
    if (!payload) {
      await generateConfigFile(profile, async (config) => {
        let cfg = await pluginsStore.onBeforeCoreStartTrigger(config, profile)
        if (appSettingsStore.app.kernel.panelOnlyMode) {
          payload = await fixProviderPaths({...cfg, 'proxy-providers': structuredClone(cfg['proxy-providers']), 'rule-providers': structuredClone(cfg['rule-providers']), })
        }
        payload = stringifyNoFolding(payload)
        return cfg
      })
    }
    await cleanupTask?.()

    // 要求3：PUT 走 request，setupCoreApi 面板分支已绑定 extApi 的地址/secret
    await reloadConfigs({ payload }).catch((err) => {
      throw `配置重载失败：${err?.message || err}`
    })

    const stillUp = await probeApiAvailability().then(() => true).catch(() => false)
    if (!stillUp) {
      throw '配置已加载，但 API 地址/secret 已变更，请检查 externalConfigPath 与生成配置的 external-controller 是否一致'
    }

    // 要求3：加载成功后把 controller/secret 改回 externalConfigPath 的值
    // await restoreExternalController(
    //   profile.advancedConfig['external-controller'],
    //   profile.advancedConfig.secret,
    // ).catch((err) => message.error(`恢复外部 API 地址失败：${err?.message || err}`))
    //
    if (!running.value) {
      await onCoreStarted(-1)
    } else {
      await Promise.all([refreshConfig(), refreshProviderProxies()])
    }
  }

  const initCoreState = async () => {
    const panelOnlyMode = appSettingsStore.app.kernel.panelOnlyMode

    if (panelOnlyMode) {
      /*
      await loadExternalApiConfig().catch((err) =>
        message.error(`读取外部配置失败：${err?.message || err}`),
      )
      // 面板模式：尝试一次 API 连接
      const ok = await refreshConfig()
        .then(() => true)
        // .catch(() => false)
        .catch((err) => {
        console.error('Panel mode connect failed: ', err)
        message.error(`无法连接外部内核 API：${err?.message || err}。请检查 profile 的 external-controller/secret`)
})
      coreStateLoading.value = false
      if (ok) {
        await onCoreStarted(-1)
      } else if (appSettingsStore.app.autoStartKernel) {
        // 自动连接：等同点一次"重载配置/连接"
        await restartCore().catch((err) => message.error(err))
      }
      */
      await ensurePanelProfile()
      coreStateLoading.value = false

      try {
        const profileId = appSettingsStore.app.kernel.profile
        if (profileId === PanelProfileId) {
          await connectExternal()
        } else {
          const profile = profilesStore.getProfileById(profileId)
          if (profile) {
            await reloadWithProfile(profile)
          } else {
            appSettingsStore.app.kernel.profile = PanelProfileId
            await connectExternal()
          }
        }
      } catch (err: any) {
        message.error(`面板模式连接失败：${err?.message || err}`)
      }

      return
    }

    corePid.value = Number(await ReadFile(CorePidFilePath).catch(() => -1))
    const processName = corePid.value === -1 ? '' : await ProcessInfo(corePid.value).catch(() => '')
    running.value = processName.startsWith('mihomo')

    coreStateLoading.value = false

    if (running.value) {
      initWebsocket()
      await Promise.all([refreshConfig(), refreshProviderProxies()])
      await envStore.updateSystemProxyStatus()
      // Trigger onCoreStarted for plugins when kernel is already running at app startup
      await pluginsStore.onCoreStartedTrigger()
    } else if (appSettingsStore.app.autoStartKernel) {
      await startCore()
    }
  }

  const runCoreProcess = async (isAlpha: boolean, tunEnabled: boolean) => {
    const { profile: profileID, externalConfigPath } = appSettingsStore.app.kernel
    const isPanelProfile = profileID === PanelProfileId && !!externalConfigPath

    // 面板配置：-f 指向外部文件，-d 指向其所在目录（保证相对路径 provider 正确解析）
    const overrides = isPanelProfile
      ? {
          configFile: externalConfigPath,
          homeDir: externalConfigPath ? externalConfigPath.slice(
            0,
            Math.max(externalConfigPath.lastIndexOf('/'), externalConfigPath.lastIndexOf('\\')),
          ) : '',
        }
      : undefined

    let stopped = false
    const pid = await ExecBackground(
      CoreWorkingDirectory + '/' + getKernelFileName(isAlpha),
      getKernelRuntimeArgs(isAlpha, overrides),
      undefined,
      async (end) => {
        stopped = true
        const logs = await ReadFile(CoreLogFilePath, { Range: '-4096' }).catch((err) => String(err))
        logs.split('\n').forEach((line) => line && logsStore.recordKernelLog(line))
        end && logsStore.recordKernelLog(end)
        onCoreStopped()
      },
      {
        PidFile: CorePidFilePath,
        LogFile: CoreLogFilePath,
        Env: getKernelRuntimeEnv(isAlpha),
      },
    )
    while (!stopped) {
      const ok = await probeApiAvailability().catch(() => false)
      if (ok) break
      if (stopped) throw 'Startup failed. Check logs for details.'
      await sleep(500)
    }
    const start = Date.now()
    while (tunEnabled) {
      const config = await getConfigs().catch(() => null)
      if (config?.tun?.enable) break
      if (Date.now() - start >= 5_000) {
        message.warn('TUN mode startup timed out.')
        break
      }
      await sleep(500)
    }
    return pid
  }

  const onCoreStarted = async (pid: number) => {
    corePid.value = pid
    running.value = true
    needRestart.value = false
    isCoreStartedByThisInstance = !appSettingsStore.app.kernel.panelOnlyMode
    coreStoppedPromise = new Promise((r) => (coreStoppedResolver = r))

    initWebsocket()
    const ver = await getVersion().catch(()=> null)
    coreVersionDetail.value = ver?.version ?? ''
    await Promise.all([refreshConfig(), refreshProviderProxies()])

    if (appSettingsStore.app.autoSetSystemProxy) {
      await envStore.setSystemProxy().catch((err) => message.error(err))
    }
    if (appSettingsStore.app.autoSetSystemDNS) {
      await envStore.setSystemDNS(true).catch((err) => message.error(err))
    }
    await envStore.updateSystemProxyStatus()

    await pluginsStore.onCoreStartedTrigger()
  }

  const onCoreStopped = async () => {
    if (!isCoreStartedByThisInstance) {
      await RemoveFile(CorePidFilePath)
    }

    corePid.value = -1
    running.value = false
    needRestart.value = false
    coreVersionDetail.value = ''

    destroyWebsocket()

    await envStore.updateSystemProxyStatus()
    if (envStore.systemProxy) {
      await envStore.clearSystemProxy().catch((err) => message.error(err))
    }
    if (appSettingsStore.app.autoSetSystemDNS || envStore.systemDNSSet) {
      await envStore.setSystemDNS(false).catch((err) => message.error(err))
    }

    resetConfig()

    await pluginsStore.onCoreStoppedTrigger()

    coreStoppedResolver(null)
  }

  const startCore = async () => {
    if (appSettingsStore.app.kernel.panelOnlyMode) return
    if (running.value) throw 'The core is already running'

    logsStore.clearKernelLog()

    const { profile: profileID, branch, externalConfigPath } = appSettingsStore.app.kernel
    const profile = profilesStore.getProfileById(profileID)
    if (!profile) throw 'Choose a profile first'

    const isPanelProfile = profile.id === PanelProfileId
    if (isPanelProfile && !externalConfigPath) throw 'kernel.externalConfigPathRequired'

    starting.value = true
    try {
      if (profileID === PanelProfileId && externalConfigPath) {
        // 面板配置：不生成，直接以 -f externalConfigPath 启动
        // 启动前再同步一次 controller/secret（外部文件可能被改过）
        await loadExternalApiConfig()
        const ext = getExternalApi()
        if (ext) {
          profile.advancedConfig['external-controller'] = ext.controller
          profile.advancedConfig.secret = ext.bearer
        }
      } else {
      await generateConfigFile(profile, (config) =>
        pluginsStore.onBeforeCoreStartTrigger(config, profile),
      )
      }
      const isAlpha = branch === Branch.Alpha
      const pid = await runCoreProcess(isAlpha, profile.tunConfig.enable)
      pid && (await onCoreStarted(pid))
    } finally {
      starting.value = false
    }
  }

  const stopCore = async () => {
    if (appSettingsStore.app.kernel.panelOnlyMode) {
      // 面板模式不允许杀进程，仅断开
      await onCoreStopped()
      return
    }
    if (!running.value) throw 'The core is not running'

    stopping.value = true
    try {
      await pluginsStore.onBeforeCoreStopTrigger()
      await KillProcess(corePid.value)
      await (isCoreStartedByThisInstance ? coreStoppedPromise : onCoreStopped())
    } finally {
      stopping.value = false
    }
  }

  const restartCore = async (cleanupTask?: () => Promise<any>) => {
    restarting.value = true
    try {
      if (appSettingsStore.app.kernel.panelOnlyMode) {
        // await reloadExternalCore(cleanupTask)
        const { profile: profileId, externalConfigPath } = appSettingsStore.app.kernel
        await loadExternalApiConfig();
        if (!getExternalApi()) throw 'kernel.externalConfigPathRequired'

        if (profileId === PanelProfileId) {
          // await connectExternal()
          // 面板配置：让内核重新加载 externalConfigPath 文件
          await reloadConfigs({ path: externalConfigPath }).catch((err) => {
            throw `加载外部配置失败：${err?.message || err}`
          })
        } else {
          const profile = profilesStore.getProfileById(profileId)
          if (!profile) throw 'Choose a profile first'
          await reloadWithProfile(profile, cleanupTask)
        }
        // 统一收尾：已连接则刷新，未连接则建立连接
        if (running.value) {
          await Promise.all([refreshConfig(), refreshProviderProxies()])
        } else {
          await onCoreStarted(-1)
        }
      } else {
      await stopCore()
      await cleanupTask?.()
      await startCore()
      }
    } finally {
      needRestart.value = false
      restarting.value = false
    }
  }

  // 面板模式：生成配置 → 写外部路径 → PUT /configs?force=true → 标记已连接
  const reloadExternalCore = async (cleanupTask?: () => Promise<any>) => {
    const { profile: profileID, externalConfigPath } = appSettingsStore.app.kernel
    const profile = profilesStore.getProfileById(profileID)
    if (!profile) throw 'Choose a profile first'
    if (!externalConfigPath) throw 'kernel.externalConfigPathRequired'

    // await generateConfigFile(
    //   profile,
    //   (config) => pluginsStore.onBeforeCoreStartTrigger(config, profile),
    //   externalConfigPath
    // )
    await cleanupTask?.()

    await reloadConfigs({path: externalConfigPath }).catch((err) => {
      throw `配置已写入但重载失败：${err?.message || err}。请检查 external-controller/secret 是否与外部进程一致。`
    })

    if (!running.value) {
      await onCoreStarted(-1)
    } else {
      await refreshConfig()
    }
  }

  // 面板模式次要按钮：POST /restart，404 兜底
  const restartExternalCore = async () => {
    restarting.value = true
    try {
      await restartCoreApi()
      // 重启后 API 短暂不可用，等待恢复
      const start = Date.now()
      while (Date.now() - start < 10_000) {
        const ok = await probeApiAvailability().catch(() => false)
        if (ok) {
          await onCoreStarted(-1)
          return
        }
        await sleep(500)
      }
      throw '重启后无法连接内核 API'
    } finally {
      restarting.value = false
    }
  }

  const getProxyProfileOptions = () => {
    const controller = profilesStore.currentProfile?.advancedConfig['external-controller']?.trim()
    const auth = profilesStore.currentProfile?.advancedConfig.authentication[0]?.trim()
    const rawHost = controller?.startsWith('[')
      ? controller.match(/^\[([^\]]+)\](?::\d+)?$/)?.[1]
      : controller?.slice(0, Math.max(controller.lastIndexOf(':'), 0)) || controller
    const host = normalizeProxyHost(rawHost?.trim() || '')

    if (!auth) return { host, username: '', password: '' }

    const [username, ...passwordParts] = auth.split(':')

    return {
      host,
      username: username || '',
      password: passwordParts.join(':'),
    }
  }

  const getProxyEndpoint = (): ProxyEndpoint | undefined => {
    const { port, 'socks-port': socksPort, 'mixed-port': mixedPort } = config.value
    const { host, username, password } = getProxyProfileOptions()
    let targetPort = 0
    let proxyType: ProxyType | undefined

    if (mixedPort) {
      targetPort = mixedPort
      proxyType = 'mixed'
    } else if (port) {
      targetPort = port
      proxyType = 'http'
    } else if (socksPort) {
      targetPort = socksPort
      proxyType = 'socks'
    } else {
      return undefined
    }

    const schema = proxyType === 'socks' ? 'socks5' : 'http'

    return {
      schema,
      host,
      port: targetPort,
      username,
      password,
      proxyType,
    }
  }

  eventBus.on('profileChange', ({ id }) => {
    if (running.value && id === appSettingsStore.app.kernel.profile) {
      needRestart.value = true
    }
  })

  eventBus.on('subscriptionChange', ({ id }) => {
    if (running.value && profilesStore.currentProfile) {
      const inUse = profilesStore.currentProfile.proxyGroupsConfig.some(
        (group) => group.use.includes(id) || group.proxies.some((proxy) => proxy.type === id),
      )
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  eventBus.on('subscriptionsChange', () => {
    if (running.value && profilesStore.currentProfile) {
      const enabledSubs = subscribesStore.subscribes.flatMap((v) => (v.disabled ? [] : v.id))
      const inUse = profilesStore.currentProfile.proxyGroupsConfig.some(
        (group) =>
          group.use.some((sub) => enabledSubs.includes(sub)) ||
          group.proxies.some((proxy) => enabledSubs.includes(proxy.type)),
      )
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  const collectRulesetIDs = () => {
    if (!profilesStore.currentProfile) return []
    const l1 = Object.keys(profilesStore.currentProfile.dnsConfig['nameserver-policy'] || {}).flatMap(
      (v) =>
        v.startsWith('rule-set:')
          ? v
              .slice('rule-set:'.length)
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          : [],
    )
    const l2 = (profilesStore.currentProfile.rulesConfig || []).flatMap((v) =>
      v.type === RuleType.RuleSet ? v.payload : [],
    )
    return [...l1, ...l2]
  }

  eventBus.on('rulesetChange', ({ id }) => {
    if (running.value && profilesStore.currentProfile) {
      const inUse = collectRulesetIDs().includes(id)
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  eventBus.on('rulesetsChange', () => {
    if (running.value && profilesStore.currentProfile) {
      const enabledRulesets = rulesetsStore.rulesets.flatMap((v) => (v.disabled ? [] : v.id))
      const inUse = collectRulesetIDs().some((v) => enabledRulesets.includes(v))
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  watch(needRestart, (v) => {
    if (v && appSettingsStore.app.autoRestartKernel) {
      restartCore()
    }
  })

  const watchSources = computed(() => {
    const source = [config.value.mode, config.value.tun.enable]
    if (!appSettingsStore.app.addGroupToMenu) return source.join('')

    const { unAvailable, sortByDelay } = appSettingsStore.app.kernel

    const proxySignature = Object.values(proxies.value)
      .map((group) => group.name + group.now)
      .sort()
      .join()

    return source.concat([proxySignature, unAvailable, sortByDelay]).join('')
  })

  watch([watchSources, running], updateTrayAndMenus)

  return {
    startCore,
    stopCore,
    restartCore,
    initCoreState,
    pid: corePid,
    coreVersionDetail,
    running,
    starting,
    stopping,
    restarting,
    restartExternalCore,
    needRestart,
    coreStateLoading,
    config,
    proxies,
    refreshConfig,
    updateConfig,
    refreshProviderProxies,
    proxyProviders,
    getProxyEndpoint,

    onLogs,
    onMemory,
    onTraffic,
    onConnections,
  }
})
