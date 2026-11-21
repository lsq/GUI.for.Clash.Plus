import { Request } from '@/api/request'
import { WebSockets } from '@/api/websocket'
import { HttpGet, HttpPost } from '@/bridge'
import { useAppSettingsStore, useProfilesStore } from '@/stores'
import { formatProxyHost, normalizeProxyHost, sleep } from '@/utils'
import { parse } from 'yaml'
import { ReadFile, Requests, GetEnv } from '@/bridge'

import type {
  CoreApiConfig,
  CoreApiProxies,
  CoreApiConnections,
  CoreApiWsDataMap,
  CoreApiProxyProvider,
} from '@/types/kernel'

type WsKey = keyof CoreApiWsDataMap
type WsChannel<K extends WsKey> = {
  url: string
  params?: Recordable
  handlers: Array<(data: CoreApiWsDataMap[K]) => void>
  isActive: boolean
  connect?: () => void
  disconnect?: () => void
}

export enum Api {
  Configs = '/configs',
  Memory = '/memory',
  Restart = '/restart',
  Proxies = '/proxies',
  Providers = '/providers/proxies',
  ProxyDelay = '/proxies/{0}/delay',
  ProviderProxyDelay = '/providers/proxies/{0}/{1}/healthcheck',
  Connections = '/connections',
  Traffic = '/traffic',
  Logs = '/logs',
  GEO = '/configs/geo',
}

// 面板模式：从外部配置文件解析出的 API 地址/密钥
let externalApi: { controller:string; host: string; port: number; bearer: string } | null = null

export const getExternalApi = () => externalApi

export const loadExternalApiConfig = async () => {
  externalApi = null
  let { externalConfigPath } = useAppSettingsStore().app.kernel
  if (!externalConfigPath) return

  if (externalConfigPath.startsWith('~')) {
    const home = await GetEnv('HOME').catch(() => GetEnv('USERPROFILE').catch(() => ''))
    if (home) externalConfigPath = home + externalConfigPath.slice(1)
  }

  const content = await ReadFile(externalConfigPath)
  const conf = parse(content) ?? {}

  const controller = conf['external-controller'] || '127.0.0.1:9090'
  const { host, port } = resolveController(controller, 9090)  // 外部 mihomo 默认端口是 9090，不是 20113
  externalApi = {
    controller,
    host: formatProxyHost(host),
    port,
    bearer: conf.secret ?? '',
  }
}

const resolveController = (controller: string, defaultPort: number) => {
  const trimmed = controller.trim()
  if (!trimmed) {
    return {
      host: '127.0.0.1',
      port: defaultPort,
    }
  }

  if (trimmed.startsWith('[')) {
    const match = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/)
    return {
      host: normalizeProxyHost(match?.[1] || ''),
      port: Number(match?.[2] || defaultPort),
    }
  }

  const separatorIndex = trimmed.lastIndexOf(':')
  if (separatorIndex === -1) {
    return {
      host: normalizeProxyHost(trimmed),
      port: defaultPort,
    }
  }

  return {
    host: normalizeProxyHost(trimmed.slice(0, separatorIndex).trim()),
    port: Number(trimmed.slice(separatorIndex + 1)) || defaultPort,
  }
}

const setupCoreApi = (protocol: 'http' | 'ws') => {
  const { currentProfile: profile } = useProfilesStore()
  const { panelOnlyMode } = useAppSettingsStore().app.kernel

  let base = `${protocol}://127.0.0.1:20113`
  let bearer = ''

  if (panelOnlyMode && externalApi) {
    base = `${protocol}://${externalApi.host}:${externalApi.port}`
    bearer = externalApi.bearer
  } else
  if (profile) {
    const controller = profile.advancedConfig['external-controller'] || '127.0.0.1:20113'
    const { host, port } = resolveController(controller, 20113)
    // TODO: tls
    base = `${protocol}://${formatProxyHost(host)}:${port}`
    bearer = profile.advancedConfig.secret
  }

  if (protocol === 'http') {
    request.base = base
    request.bearer = bearer
  } else {
    websocket.base = base
    websocket.bearer = bearer
  }
}

const request = new Request({ beforeRequest: () => setupCoreApi('http'), timeout: 60 * 1000 })
const websocket = new WebSockets({ beforeConnect: () => setupCoreApi('ws') })

const wsChannels: {
  [K in WsKey]: WsChannel<K>
} = {
  logs: { url: Api.Logs, isActive: false, handlers: [], params: { level: 'debug' } },
  memory: { url: Api.Memory, isActive: false, handlers: [] },
  traffic: { url: Api.Traffic, isActive: false, handlers: [] },
  connections: { url: Api.Connections, isActive: false, handlers: [] },
}

const createCoreWSHandlerRegister = <K extends WsKey>(key: K) => {
  const channel = wsChannels[key]

  return (cb: (data: CoreApiWsDataMap[K]) => void) => {
    channel.handlers.push(cb)

    if (!channel.isActive && channel.connect) {
      channel.connect()
      channel.isActive = true
    }

    const unregister = () => {
      const idx = channel.handlers.indexOf(cb)
      idx !== -1 && channel.handlers.splice(idx, 1)
      if (channel.isActive && channel.disconnect && channel.handlers.length === 0) {
        channel.disconnect()
        channel.isActive = false
      }
    }
    return unregister
  }
}

// restful api
export const probeApiAvailability = () => request.get('/version')
export const getConfigs = () => request.get<CoreApiConfig>(Api.Configs)
export const setConfigs = (body = {}) => request.patch<null>(Api.Configs, body)
export const getProxies = () => request.get<CoreApiProxies>(Api.Proxies)
// export const getProviders = () => request.get<any>(Api.Providers)
export const getConnections = () => request.get<CoreApiConnections>(Api.Connections)
export const getMemory = () => request.get<CoreApiWsDataMap['memory']>(Api.Memory)
export const getVersion = () =>
  request.get<{ version: string; meta?: boolean;}>('/version')

export const reloadConfigs = (body: {path?: string; payload?: string}) =>
  request.put<null>(Api.Configs + '?force=true', body)

// POST /restart 需要识别 404，Request 封装不暴露 status，用 HttpGet 风格手动发
export const restartCoreApi = async () => {
  setupCoreApi('http')
  const headers: Record<string, string> = {}
  if (request.bearer) {
    headers['Authorization'] = `Bearer ${request.bearer}`
  }
  const { status, body } = await HttpPost<any>(`${request.base}${Api.Restart}`, headers, {}, {
    Proxy: '',
    Timeout: request.timeout / 1000,
  })
  if (status === 404) {
    throw 'kernel.restartNotSupported' // i18n key，调用处 message.error(t(...))
  }
  if (status >= 400) {
    throw body?.message ?? body ?? `HTTP ${status}`
  }
}
export const deleteConnection = (id: string) => request.delete<null>(Api.Connections + '/' + id)
export const deleteGroupFixed = (group: string) => request.delete(Api.Proxies + '/' + group)
export const useProxy = (group: string, proxy: string) => {
  return request.put<null>(Api.Proxies + '/' + group, { name: proxy })
}
export const getProxyDelay = async (
  provider: string,
  proxy: string,
  url: string,
  timeout: number,
  cancelId = '',
) => {
  setupCoreApi('http')
  const query = new URLSearchParams({ url, timeout: String(timeout) }).toString()
  const path = provider
    ? Api.ProviderProxyDelay.replace('{0}', provider).replace('{1}', proxy)
    : Api.ProxyDelay.replace('{0}', proxy)
  const headers: Record<string, string> = {}
  if (request.bearer) {
    headers['Authorization'] = `Bearer ${request.bearer}`
  }
  const { status, body } = await HttpGet<any>(`${request.base}${path}?${query}`, headers, {
    Proxy: '',
    Timeout: request.timeout / 1000,
    CancelId: cancelId,
  })
  if (status === 204) {
    return null as unknown as Record<string, number>
  }
  if ([504, 401, 503].includes(status)) {
    throw body?.message ?? body
  }
  return body as Record<string, number>
}
export const updateGEO = () => request.post<{ message: string } | null>(Api.GEO)

// websocket api
export const onLogs = createCoreWSHandlerRegister('logs')
export const onMemory = createCoreWSHandlerRegister('memory')
export const onTraffic = createCoreWSHandlerRegister('traffic')
export const onConnections = createCoreWSHandlerRegister('connections')
export const initWebsocket = () => {
  Object.values(wsChannels).forEach((channel) => {
    const { connect, disconnect } = websocket.createWS({
      url: channel.url,
      params: channel.params,
      cb: (data) => channel.handlers.forEach((cb) => cb(data)),
    })
    channel.connect = connect
    channel.disconnect = disconnect
    channel.isActive = false
    if (channel.handlers.length > 0) {
      channel.connect()
      channel.isActive = true
    }
  })
}
export const destroyWebsocket = () => {
  Object.values(wsChannels).forEach((channel) => {
    channel.disconnect?.()
    channel.connect = undefined
    channel.disconnect = undefined
    channel.isActive = false
  })
}

const rawRequest = (method: 'GET' | 'PATCH', base: string, bearer: string, path: string, body?: any) => {
  const headers: Record<string, string> & { 'Content-Type': 'application/json' } = {
    'Content-Type': 'application/json',
  }
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`
  }
  return Requests({
    method,
    url: base + path,
    headers,
    body: body ? JSON.stringify(body) : '',
    options: { Timeout: 10 },
  })
}

export const restoreExternalController = async (
  profileController: string,
  profileSecret: string,
) => {
  const ext = externalApi
  if (!ext) return
  const { host, port } = resolveController(profileController || '127.0.0.1:9090', 9090)
  const profileBase = `http://${formatProxyHost(host)}:${port}`

  // 等内核在新 controller 上就绪（PUT force 后 rebind 有延迟）
  const start = Date.now()
  let up = false
  while (Date.now() - start < 10_000) {
    const res = await rawRequest('GET', profileBase, profileSecret, '/version').catch((e) => { console.log('probe /version failed:', e); return null})
    if (res?.status === 200) { up = true; break }
    await sleep(300)
  }
  if (!up) throw '内核加载配置后 API 未就绪'

  // 改回 externalConfigPath 的 controller/secret
  await rawRequest('PATCH', profileBase, profileSecret, Api.Configs, {
    'external-controller': ext.controller,
    secret: ext.bearer,
  })
}

export const getProviders = () =>
  request.get<{ providers: Record<string, CoreApiProxyProvider> }>(Api.Providers)

// 更新订阅（Inline 不支持，调用方控制不显示）
export const updateProvider = (name: string) =>
  request.put<null>(Api.Providers + '/' + encodeURIComponent(name))

// 健康检查
export const healthCheckProvider = (name: string) =>
  request.get<null>(Api.Providers + '/' + encodeURIComponent(name) + '/healthcheck')
