#
https://deepwiki.com/search/4d2b5faf-72bc-4ddd-8ae5-87131611033a?mode=deep

# DeepWiki Q&A with Code Context for Repository: GUI-for-Cores/GUI.for.Clash
## Q1
怎么判断运行时是windows平台还是linux
### Answer
Search for platform detection in the repo.I have enough. Answer: Go side uses runtime.GOOS stored in Env.OS; frontend uses useEnvStore().env.os compared with OS enum; also v-platform directive.这个项目分两层判断平台：

**Go 后端（bridge）**

在 `bridge/bridge.go` 中，`Env.OS` 直接取自 `runtime.GOOS`（别名 `sysruntime`），值为 `"windows"` / `"linux"` / `"darwin"`：

```go
Env = &EnvResult{
    OS:   sysruntime.GOOS,
    ARCH: sysruntime.GOARCH,
    ...
}
``` GUI.for.Clash:27-39 

之后用 `switch Env.OS` 或 `if Env.OS == "windows"` 做平台分支，例如 `defaultDataDir()` 按 OS 选择数据目录、`GetSystemProxy`/`SetSystemProxy` 分发到各平台实现： GUI.for.Clash:223-238 GUI.for.Clash:23-30 

另外 Go 侧也用编译期 build tag 区分平台，如 `bridge/exec_windows.go` 与 `bridge/exec_others.go`。 GUI.for.Clash:1-1 

**前端（Vue/TS）**

`Env.OS` 通过 `EnvResult` 的 `os` 字段暴露给前端，前端用 `useEnvStore().env.os` 与 `OS` 枚举比较：

```ts
export enum OS {
  Windows = 'windows',
  Linux = 'linux',
  Darwin = 'darwin',
}
``` GUI.for.Clash:1-5 GUI.for.Clash:14-26 

典型用法如 `env.os === OS.Windows ? ';' : ':'`： GUI.for.Clash:279-288 

模板里还可以用 `v-platform` 指令按平台显隐元素，内部同样判断 `envStore.env.os`： GUI.for.Clash:5-18 

总结：判断依据就是 `runtime.GOOS`（Go）→ `Env.OS` → 前端 `envStore.env.os`，取值 `"windows"`、`"linux"`、`"darwin"`。
### Citations
**File:** bridge/bridge.go (L27-39)
```go
var Env = &EnvResult{
	IsStartup:    true,
	PreventExit:  true,
	WebviewPath:  "",
	AppId:        "GUI.for.Clash",
	AppName:      "",
	AppVersion:   "v1.29.0",
	BasePath:     "",
	DataDir:      "",
	OS:           sysruntime.GOOS,
	ARCH:         sysruntime.GOARCH,
	IsPrivileged: false,
}
```
**File:** bridge/bridge.go (L223-238)
```go
func defaultDataDir() (string, error) {
	switch Env.OS {
	case "linux":
		if dataHome := os.Getenv("XDG_DATA_HOME"); filepath.IsAbs(dataHome) {
			return filepath.Join(dataHome, Env.AppId), nil
		}
		home, err := os.UserHomeDir()
		return filepath.Join(home, ".local", "share", Env.AppId), err
	case "windows":
		localAppData, err := os.UserCacheDir()
		return filepath.Join(localAppData, Env.AppId), err
	default:
		configDir, err := os.UserConfigDir()
		return filepath.Join(configDir, Env.AppId), err
	}
}
```
**File:** bridge/system_proxy.go (L23-30)
```go
	switch Env.OS {
	case "windows":
		proxy, err = getWindowsSystemProxy()
	case "darwin":
		proxy, err = getDarwinSystemProxy()
	case "linux":
		proxy, err = getLinuxSystemProxy()
	}
```
**File:** bridge/exec_windows.go (L1-1)
```go
//go:build windows
```
**File:** frontend/src/enums/app.ts (L1-5)
```typescript
export enum OS {
  Windows = 'windows',
  Linux = 'linux',
  Darwin = 'darwin',
}
```
**File:** frontend/src/types/app.d.ts (L14-26)
```typescript
  interface AppEnv {
    appId: string
    appName: string
    appVersion: string
    basePath: string
    dataDir: string
    args: string[]
    launchArgs: string[]
    appPath: string
    os: OS
    arch: string
    isPrivileged: boolean
  }
```
**File:** frontend/src/constant/kernel.ts (L279-288)
```typescript
export const DefaultCoreConfig = () => {
  const { env } = useEnvStore()
  const separator = env.os === OS.Windows ? ';' : ':'

  return {
    env: {
      SAFE_PATHS: ['$APP_DATA_PATH/subscribes', '$APP_DATA_PATH/rulesets'].join(separator),
    },
    args: ['-d', CoreWorkingDirectory.replace('data', '$APP_DATA_PATH')],
  }
```
**File:** frontend/src/directives/platform.ts (L5-18)
```typescript
export default {
  mounted(el, binding) {
    const envStore = useEnvStore()
    const supports = binding.value
    if (!supports.includes(envStore.env.os)) {
      el.style.display = 'none'
    }
  },
  updated(el, binding) {
    const envStore = useEnvStore()
    const supports = binding.value
    el.style.display = supports.includes(envStore.env.os) ? '' : 'none'
  },
} satisfies Directive<HTMLElement, App.OS[]>
```
## Q2
request.get请求是怎么初始化controller和secret的
### Answer
Search for request.get and controller/secret initialization.I have enough context. Explain: request is a Request instance in kernel.ts; beforeRequest hook calls setupCoreApi('http') which reads currentProfile's advancedConfig 'external-controller' and 'secret', sets request.base and request.bearer. Defaults come from AdvancedConfigDefaults (secret = generateSecureKey(), external-controller = '127.0.0.1:20113').`request` 是 `frontend/src/api/kernel.ts` 中创建的 `Request` 实例，controller 和 secret 不是在构造时传入的，而是通过 `beforeRequest` 钩子在**每次请求前**动态设置的：

```ts
const request = new Request({ beforeRequest: () => setupCoreApi('http'), timeout: 60 * 1000 })
``` GUI.for.Clash:91-92 

**初始化流程**

1. `request.get(...)` → 内部 `this.request()` 首先调用 `this.beforeRequest()`： GUI.for.Clash:34-38 

2. `setupCoreApi('http')` 从 `useProfilesStore().currentProfile` 读取当前配置：
   - `controller` 取 `profile.advancedConfig['external-controller']`，缺省 `'127.0.0.1:20113'`，经 `resolveController()` 解析出 host/port（支持 IPv6 `[::1]:port` 格式），拼成 `request.base`
   - `secret` 取 `profile.advancedConfig.secret`，赋给 `request.bearer` GUI.for.Clash:68-89 

3. 发请求时 `base` 拼到 URL 前，`bearer` 写入 `Authorization: Bearer <secret>` 头： GUI.for.Clash:45-52 

**值的来源（默认值）**

`external-controller` 和 `secret` 的默认值在 `AdvancedConfigDefaults()` 中定义：`external-controller: '127.0.0.1:20113'`，`secret: generateSecureKey()`（随机生成）。用户可在 Profiles 页面的 AdvancedConfig 表单中修改，secret 旁的刷新按钮也会重新调用 `generateSecureKey()`。 GUI.for.Clash:34-40 GUI.for.Clash:33-49 

WebSocket 走同样逻辑，`beforeConnect` 调 `setupCoreApi('ws')` 设置 `websocket.base`/`websocket.bearer`。 GUI.for.Clash:85-92
### Citations
**File:** frontend/src/api/kernel.ts (L68-92)
```typescript
const setupCoreApi = (protocol: 'http' | 'ws') => {
  const { currentProfile: profile } = useProfilesStore()

  let base = `${protocol}://127.0.0.1:20113`
  let bearer = ''

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
```
**File:** frontend/src/api/request.ts (L34-38)
```typescript
  private request = async <T>(
    url: string,
    options: { method: Method; body?: Record<string, any> },
  ) => {
    this.beforeRequest()
```
**File:** frontend/src/api/request.ts (L45-52)
```typescript
    if (this.base) {
      url = this.base + url
    }

    if (this.bearer) {
      if (!init.headers) init.headers = {}
      Object.assign(init.headers, { Authorization: `Bearer ${this.bearer}` })
    }
```
**File:** frontend/src/constant/profile.ts (L34-40)
```typescript
export const AdvancedConfigDefaults = (): App.Profile['advancedConfig'] => ({
  port: 0,
  'socks-port': 0,
  secret: generateSecureKey(),
  'external-controller': '127.0.0.1:20113',
  'external-ui': '',
  'keep-alive-interval': 30,
```
**File:** frontend/src/views/ProfilesView/components/AdvancedConfig.vue (L33-49)
```vue
    {{ t('kernel.external-controller') }}
    <Input v-model="fields['external-controller']" placeholder="127.0.0.1:9090" editable />
  </div>
  <div class="form-item">
    {{ t('kernel.secret') }}
    <div class="flex items-center">
      <Input v-model="fields.secret" editable>
        <template #suffix>
          <Button
            type="text"
            size="small"
            icon="refresh"
            @click="() => (fields.secret = generateSecureKey())"
          />
        </template>
      </Input>
    </div>
```
## Q3
为什么“使用订阅内的策略和分流规则” 不生效
### Answer
Search for "使用订阅内的策略和分流规则" — likely a profile option like "useSubRules" or similar.The option is `useInternal` ("使用订阅内的策略组和分流规则"). Why doesn't it take effect? Conditions in `_doUpdateSub`: `if (s.useInternal && s.type !== 'Manual' && haveRules)`. `haveRules = !!config.rules` — only true if subscription body is valid YAML with `rules` field. So reasons: subscription isn't full Clash YAML (base64 node list), no `rules` field, type Manual, or the profile generated isn't the currently selected one — the restored profile is added/edited with id = s.id, but user must select that profile. Also rules referencing missing proxies/rule-providers get skipped. Also note: it only runs during updateSubscribe — toggling the switch requires re-updating the subscription.

Also check: profile generated gets `id: subID` — the profile must be selected as current profile. Let me answer concisely.这个开关对应订阅的 `useInternal` 字段（`frontend/src/lang/locale/zh.ts:386`），生效逻辑在 `_doUpdateSub` 里，条件很苛刻：

```ts
if (s.useInternal && s.type !== 'Manual' && haveRules) {
  ...
  const _profile = restoreProfile(config!, s.id, NameIdMap, IdNameMap)
  ...
}
``` GUI.for.Clash:180-197 

常见不生效原因：

1. **订阅内容不是完整的 Clash YAML**。`haveRules = !!config.rules`，只有 `isValidSubYAML(body)` 且解析结果含 `rules` 字段才为 true。如果订阅返回的是 base64 节点列表或只有 `proxies` 没有 `rules`，整个分支直接跳过。 GUI.for.Clash:131-145 

2. **订阅类型是 Manual**。条件里明确排除 `s.type !== 'Manual'`，手动订阅即使开了开关也不会还原策略组/规则。

3. **打开开关后没有重新更新订阅**。还原只发生在 `updateSubscribe` 流程中，改开关本身不触发，需要再点一次更新。

4. **生成的配置不是当前使用的配置**。还原出的 profile `id` 等于订阅 id（`restoreProfile` 中 `id: subID`），会新增或覆盖同 id 的 profile；如果你当前选中的是另一个 profile，界面上看不到变化。 GUI.for.Clash:52-55 

5. **规则/策略组被静默丢弃**。`restoreProfile` 里规则引用的 proxy 解析不到（被 include/exclude 过滤、插件删掉、或引用了不存在的策略组）时 `return` 跳过；`RULE-SET` 规则若 `rule-providers` 里找不到对应 provider 也跳过。所以即使分支执行了，部分规则也可能缺失。 GUI.for.Clash:170-182 

6. **proxy-providers 不还原**。`restoreProfile` 只处理 `proxy-groups`、`rules`、`rule-providers` 等字段，订阅里的 `proxy-providers` 不会变成 profile 的代理来源——策略组里 `use` 引用的 provider 只会映射为名字，节点仍来自订阅本身的 `proxies`。 GUI.for.Clash:88-121 

排查建议：确认订阅返回的是带 `rules` 的完整 YAML、类型为 Http/File、重新触发更新，并检查生成的 profile（id 与订阅相同）是否被选中。
### Citations
**File:** frontend/src/stores/subscribes.ts (L131-145)
```typescript
    if (isValidSubYAML(body)) {
      config = parse(body) as Record<string, any>
      proxies = config.proxies
      haveRules = !!config.rules
      if (haveRules) {
        proxies.forEach((proxy, index) => {
          proxy.__tmp__id__ = index
          NameIdMap[proxy.name] = proxy.__tmp__id__
        })
      }
    } else if (isValidBase64(body)) {
      proxies = [{ base64: body }]
    } else {
      throw 'Not a valid subscription data'
    }
```
**File:** frontend/src/stores/subscribes.ts (L180-197)
```typescript
    if (s.useInternal && s.type !== 'Manual' && haveRules) {
      proxies.forEach((proxy: any) => {
        IdNameMap[proxy.__tmp__id__] = proxy.name
      })
      const profilesStore = useProfilesStore()
      const profile = profilesStore.getProfileById(s.id)
      const _profile = restoreProfile(config!, s.id, NameIdMap, IdNameMap)
      if (profile) {
        _profile.name = profile.name
        _profile.advancedConfig.secret = profile.advancedConfig.secret
        _profile.mixinConfig = profile.mixinConfig
        _profile.scriptConfig = profile.scriptConfig
        profilesStore.editProfile(profile.id, _profile)
      } else {
        _profile.name = s.name
        profilesStore.addProfile(_profile)
      }
    }
```
**File:** frontend/src/utils/restorer.ts (L52-55)
```typescript
  const profile: App.Profile = {
    // The same ID indicates that this profile was generated by this subscription
    id: subID,
    name: subID,
```
**File:** frontend/src/utils/restorer.ts (L88-121)
```typescript
  config['proxy-groups'] = config['proxy-groups'] || []
  config['rule-providers'] = config['rule-providers'] || {}

  config['proxy-groups'].forEach((group: any) => {
    const id = sampleID()
    GroupNameIdMap[group.name] = id
    GroupIdNameMap[id] = group.name
  })

  function isBuiltIn(proxy: string) {
    return BuiltInOutbound.includes(proxy)
  }

  config['proxy-groups'].forEach((group: any) => {
    const _group: App.Profile['proxyGroupsConfig'][number] = {
      id: GroupNameIdMap[group.name]!,
      name: group.name,
      type: group.type,
      proxies: (group.proxies || [])
        .map((proxy: string) => ({
          id: GroupNameIdMap[proxy] || NameIdMap[proxy] || proxy,
          type: GroupNameIdMap[proxy] || isBuiltIn(proxy) ? 'Built-In' : subID,
          name: GroupNameIdMap[proxy]
            ? GroupIdNameMap[GroupNameIdMap[proxy]]
            : IdNameMap[NameIdMap[proxy]!] || (isBuiltIn(proxy) && proxy),
        }))
        // The absence of a 'name' attribute indicates that this proxy has been excluded after processing by filters or plugins.
        .filter((v: any) => v.name),
      url: group.url ?? 'https://www.gstatic.com/generate_204',
      interval: group.interval ?? 300,
      strategy: group.strategy ?? 'consistent-hashing',
      use: (group.use || []).map((use: string) => {
        return GroupNameIdMap[use] || use
      }),
```
**File:** frontend/src/utils/restorer.ts (L170-182)
```typescript
        const _proxy = getRuleProxy(proxy)

        // Skip invalid rules：proxy missing
        if (!_proxy) {
          return
        }

        if (type === RuleType.RuleSet) {
          const provider = config['rule-providers'][payload]
          // Skip invalid rules：rule-provider missing
          if (!provider) {
            return
          }
```
## Q4
说下useInternal 打开后，重新更新订阅，配置文件的生成逻辑，有哪些部分被覆盖或者更新，哪些部分丢弃
### Answer
Need to read restorer.ts fully and subscribes.ts update flow.I have enough. Explain the generation logic: restoreProfile builds a fresh profile from defaults, then overlays subscription fields. Covered: generalConfig fields present in YAML, advancedConfig fields present, dns, tun, hosts, proxy-groups, rules, rule-providers (via RULE-SET), geodata-mode. Preserved from old profile: name, secret, mixinConfig, scriptConfig. Discarded: everything else in YAML not matching (proxies handled separately, proxy-providers, listeners, etc.), and old profile's generalConfig/advancedConfig/dnsConfig/tunConfig/sniffer/proxyGroupsConfig/rulesConfig are fully replaced.`useInternal` 打开且更新订阅时，走的是 `subscribes.ts` 里的这段分支：解析出的完整 YAML `config` 交给 `restoreProfile()` 生成一个**全新的 profile 对象**（id = 订阅 id），然后整体 `editProfile` 覆盖旧配置。 GUI.for.Clash:180-197 

## 生成逻辑（`frontend/src/utils/restorer.ts`）

**1. 先建一个全默认的 profile**

`generalConfig`、`advancedConfig`、`dnsConfig`、`tunConfig`、`sniffer`、`mixinConfig`、`scriptConfig` 全部用 `*Defaults()` 初始化；`proxyGroupsConfig` 为空；`rulesConfig` 只放一条 `InsertionPoint` 占位规则。 GUI.for.Clash:52-83 

**2. 还原 proxy-groups**

订阅里每个 `proxy-groups` 项映射为 `proxyGroupsConfig` 条目：`proxies` 按名字解析成组 id / 节点临时 id / 内置出站（`DIRECT`、`REJECT` 等），解析不到 `name` 的被过滤掉；`use`、`url`、`interval`、`strategy`、`tolerance`、`lazy`、`disable-udp`、`filter`、`exclude-filter`、`hidden`、`icon` 带默认值拷贝。 GUI.for.Clash:101-132 

**3. 遍历 YAML 顶层字段做覆盖**

- 字段名命中 `generalConfig` 或 `advancedConfig` 的 key → 直接覆盖对应字段（如 `port`、`mixed-port`、`allow-lan`、`external-controller`、`mode`、`log-level` 等） GUI.for.Clash:142-146 
- `dns` → `deepAssign` 进 `dnsConfig`，`nameserver-policy` 数组值转成逗号字符串 GUI.for.Clash:147-155 
- `tun` → `deepAssign` 进 `tunConfig` GUI.for.Clash:156-157 
- `hosts` → 写入 `dnsConfig.hosts` GUI.for.Clash:158-165 
- `rules` → 逐条 `parseRule` 后 push 进 `rulesConfig`；`RULE-SET` 会查 `rule-providers` 还原成 ruleset 规则（inline provider 序列化 payload，http 取 url）；`GEOIP`/`GEOSITE` 出现则置 `geodata-mode = true` GUI.for.Clash:166-222 

**4. 写回时保留旧 profile 的 4 个字段**

若同 id profile 已存在，只保留 `name`、`advancedConfig.secret`、`mixinConfig`、`scriptConfig`，其余整体替换；不存在则以订阅名新增。 GUI.for.Clash:187-196 

## 被覆盖 / 更新的部分

- `proxyGroupsConfig`：完全由订阅 `proxy-groups` 重建（旧的手动改动丢失）
- `rulesConfig`：完全由订阅 `rules` + `rule-providers` 重建
- `generalConfig` / `advancedConfig`：订阅 YAML 中出现的同名字段被覆盖，未出现的字段**重置为默认值**（不是保留旧值）
- `dnsConfig`、`tunConfig`、`sniffer`：先重置为默认，再 deepAssign 订阅的 `dns`/`tun`；`sniffer` 不读订阅，始终默认
- `advancedConfig['geodata-mode']`：按是否含 GEOIP/GEOSITE 规则自动设置

## 被保留的部分

仅 `name`、`secret`、`mixinConfig`、`scriptConfig` 四项从旧 profile 继承。

## 被丢弃的部分

- 订阅 YAML 中所有不匹配上述字段的顶层键：`proxies`（走订阅节点列表而非 profile）、`proxy-providers`、`listeners`、`sub-rules`、`sniffer`、`external-ui` 之外的 UI 字段等——注意 `sub-rules` 里的 `SUB-RULE` 规则虽能解析类型，但引用的子规则表本身不还原
- 规则中 proxy 解析失败的整条规则被跳过；`RULE-SET` 找不到对应 `rule-providers` 条目也跳过 GUI.for.Clash:170-182 
- 策略组里被 include/exclude 过滤或插件删掉的节点引用（`name` 为空被 filter 掉） GUI.for.Clash:114-115 
- 旧 profile 中用户手动加的规则、策略组、DNS/tun 调整——只要不是 mixin/script 里的，全部丢失

关键点是：这个机制是"重建"而非"合并"——除了 name/secret/mixin/script，整个 profile 每次都从订阅 YAML 重新生成，所以手动改 profile 的常规配置在下次更新时会被冲掉，持久化自定义只能靠 mixin 或 script。
### Citations
**File:** frontend/src/stores/subscribes.ts (L180-197)
```typescript
    if (s.useInternal && s.type !== 'Manual' && haveRules) {
      proxies.forEach((proxy: any) => {
        IdNameMap[proxy.__tmp__id__] = proxy.name
      })
      const profilesStore = useProfilesStore()
      const profile = profilesStore.getProfileById(s.id)
      const _profile = restoreProfile(config!, s.id, NameIdMap, IdNameMap)
      if (profile) {
        _profile.name = profile.name
        _profile.advancedConfig.secret = profile.advancedConfig.secret
        _profile.mixinConfig = profile.mixinConfig
        _profile.scriptConfig = profile.scriptConfig
        profilesStore.editProfile(profile.id, _profile)
      } else {
        _profile.name = s.name
        profilesStore.addProfile(_profile)
      }
    }
```
**File:** frontend/src/utils/restorer.ts (L52-83)
```typescript
  const profile: App.Profile = {
    // The same ID indicates that this profile was generated by this subscription
    id: subID,
    name: subID,
    generalConfig: GeneralConfigDefaults(),
    advancedConfig: AdvancedConfigDefaults(),
    dnsConfig: Object.assign(DnsConfigDefaults(), {
      nameserver: [],
      'nameserver-policy': {},
    }),
    tunConfig: TunConfigDefaults(),
    sniffer: SnifferDefaults(),
    proxyGroupsConfig: [],
    rulesConfig: [
      {
        id: RuleType.InsertionPoint,
        type: RuleType.InsertionPoint,
        enable: true,
        payload: '',
        proxy: '',
        'no-resolve': false,
        'ruleset-name': '',
        'ruleset-type': 'file',
        'ruleset-behavior': RulesetBehavior.Domain,
        'ruleset-format': RulesetFormat.Mrs,
        'ruleset-proxy': '',
        'ruleset-interval': 0,
      },
    ],
    mixinConfig: MixinConfigDefaults(),
    scriptConfig: ScriptConfigDefaults(),
  }
```
**File:** frontend/src/utils/restorer.ts (L101-132)
```typescript
  config['proxy-groups'].forEach((group: any) => {
    const _group: App.Profile['proxyGroupsConfig'][number] = {
      id: GroupNameIdMap[group.name]!,
      name: group.name,
      type: group.type,
      proxies: (group.proxies || [])
        .map((proxy: string) => ({
          id: GroupNameIdMap[proxy] || NameIdMap[proxy] || proxy,
          type: GroupNameIdMap[proxy] || isBuiltIn(proxy) ? 'Built-In' : subID,
          name: GroupNameIdMap[proxy]
            ? GroupIdNameMap[GroupNameIdMap[proxy]]
            : IdNameMap[NameIdMap[proxy]!] || (isBuiltIn(proxy) && proxy),
        }))
        // The absence of a 'name' attribute indicates that this proxy has been excluded after processing by filters or plugins.
        .filter((v: any) => v.name),
      url: group.url ?? 'https://www.gstatic.com/generate_204',
      interval: group.interval ?? 300,
      strategy: group.strategy ?? 'consistent-hashing',
      use: (group.use || []).map((use: string) => {
        return GroupNameIdMap[use] || use
      }),
      tolerance: group.tolerance ?? 150,
      lazy: group.lazy ?? true,
      'disable-udp': group['disable-udp'] ?? false,
      filter: group.filter ?? '',
      'exclude-filter': group['exclude-filter'] ?? '',
      hidden: group.hidden ?? false,
      icon: group.icon ?? '',
    }

    profile.proxyGroupsConfig.push(_group)
  })
```
**File:** frontend/src/utils/restorer.ts (L142-146)
```typescript
  Object.entries(config).forEach(([field, value]) => {
    if (Object.hasOwnProperty.call(profile.generalConfig, field)) {
      ;(profile.generalConfig as any)[field] = value
    } else if (Object.hasOwnProperty.call(profile.advancedConfig, field)) {
      ;(profile.advancedConfig as any)[field] = value
```
**File:** frontend/src/utils/restorer.ts (L147-155)
```typescript
    } else if (field === 'dns') {
      profile.dnsConfig = deepAssign(profile.dnsConfig, value)
      // Like hosts, the profile keeps a list of nameservers as a comma-separated string
      const policy = profile.dnsConfig['nameserver-policy']
      Object.entries<string | string[]>(policy).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          policy[key] = value.join(',')
        }
      })
```
**File:** frontend/src/utils/restorer.ts (L156-157)
```typescript
    } else if (field === 'tun') {
      profile.tunConfig = deepAssign(profile.tunConfig, value)
```
**File:** frontend/src/utils/restorer.ts (L158-165)
```typescript
    } else if (field === 'hosts') {
      Object.entries<string | string[]>(value).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          profile.dnsConfig.hosts[key] = value.join(',')
        } else {
          profile.dnsConfig.hosts[key] = value
        }
      })
```
**File:** frontend/src/utils/restorer.ts (L166-222)
```typescript
    } else if (field === 'rules') {
      config[field].forEach((rule: string, index: number) => {
        const { type, payload, proxy, noResolve } = parseRule(rule)

        const _proxy = getRuleProxy(proxy)

        // Skip invalid rules：proxy missing
        if (!_proxy) {
          return
        }

        if (type === RuleType.RuleSet) {
          const provider = config['rule-providers'][payload]
          // Skip invalid rules：rule-provider missing
          if (!provider) {
            return
          }
          profile.rulesConfig.push({
            id: index.toString(),
            type: type,
            enable: true,
            payload: provider.type == 'inline' ? stringify(provider.payload) : provider.url,
            proxy: _proxy,
            'no-resolve': noResolve,
            'ruleset-behavior': provider.behavior,
            'ruleset-format': provider.format || RulesetFormat.Yaml,
            'ruleset-type': provider.type || 'http',
            'ruleset-name': payload,
            'ruleset-proxy': 'DIRECT',
            'ruleset-interval': provider.interval ?? 0,
          })
          return
        }

        if (type === RuleType.Geoip || type === RuleType.Geosite) {
          isGeoModeEnabled = true
        }

        profile.rulesConfig.push({
          id: index.toString(),
          type: type as RuleType,
          enable: true,
          payload,
          proxy: _proxy,
          'no-resolve': noResolve,
          'ruleset-behavior': RulesetBehavior.Domain,
          'ruleset-format': RulesetFormat.Mrs,
          'ruleset-type': 'http',
          'ruleset-name': '',
          'ruleset-proxy': '',
          'ruleset-interval': 0,
        })
      })
    }
  })

  profile.advancedConfig['geodata-mode'] = isGeoModeEnabled
```
## Q5
为什么原来订阅中的proxies被清空了，没有被保留，需要怎么添加
### Answer
Need to check how proxies from subscription are stored — likely in subscribe store's proxies list, not in profile. Profile references nodes by subID. Check subscribes.ts update flow and how profile gets proxies (useSubProxies?). Search.User asks: why subscription's proxies got emptied/not preserved, how to add them. Likely they mean in the generated profile, proxies list is empty — because profile doesn't store proxies; nodes live in subscription (s.proxies + file at s.path). Proxy groups reference nodes via type: subID. To add nodes to a group, edit the subscription's proxies or add via group editing UI which pulls from subscriptions. Check generator.ts lines 74-91 and how proxies are resolved.User asks: why subscription's proxies got emptied/not preserved, how to add. Likely they mean in the generated profile, proxies list is empty — because profile doesn't store proxies; nodes live in subscription (s.proxies + file at s.path). Proxy groups reference nodes via type: subID. To add nodes to a group, edit the subscription's proxies or add via group editing UI which pulls from subscriptions. Check generator.ts lines 74-91 and how proxies are resolved.`proxies` 没有被"清空"——它们本来就不存在 profile 里。这个应用的设计是：**profile 不保存节点，节点保存在订阅里**，profile 的策略组只存对节点的引用。

## 数据流向

更新订阅时，节点走了两条路：

1. `s.proxies` 只保存 `{id, name, type}` 的摘要列表（用于 UI 展示和 id 保持） GUI.for.Clash:204-204 
2. 完整节点配置写入订阅自己的缓存文件 `s.path`（`data/subscribes/{id}.yaml`），格式是 `{proxies: [...]}` GUI.for.Clash:220-223 

而 `restoreProfile` 生成的 profile 里**根本没有 proxies 字段**——策略组里的节点引用是 `{id, type: subID, name}`，`type` 就是订阅 id： GUI.for.Clash:101-115 

## 生成最终配置时怎么找回节点

`generateProxies` 收集所有策略组里 `type !== 'Built-In'` 的订阅 id，逐个 `ReadFile(sub.path)` 读回完整节点，再按 `name` 匹配策略组引用的节点组装进 `proxies`： GUI.for.Clash:71-115 

所以如果你看到"proxies 是空的"，实际是以下情况之一：

- **看的是 profile 文件**：正常，profile 里就是没有 proxies，节点在 `data/subscribes/{订阅id}.yaml`
- **生成的内核配置里 proxies 为空**：说明策略组引用的节点名在订阅缓存文件里找不到——常见原因是 include/exclude 过滤把节点删了、订阅脚本改了节点名、或 `proxyPrefix` 加了前缀导致 `name` 对不上（`proxyMap[type].find(v => v.name === name)` 匹配失败就跳过）

## 怎么添加节点

- **加进策略组**：在 profile 编辑页编辑策略组，节点来源选对应订阅（`type` = 订阅 id），从该订阅的 `s.proxies` 摘要里挑节点
- **加进订阅本身**：手动改 `data/subscribes/{id}.yaml` 的 `proxies` 列表（下次更新会被覆盖），或在订阅的 `script`（`onSubscribe` 钩子）里往 `proxies` 数组 push 节点——这是持久化添加的正确方式 GUI.for.Clash:206-218 
- **加内置/其他订阅节点**：策略组的 `proxies` 里 `type` 可以是 `'Built-In'`（DIRECT/REJECT）或另一个订阅的 id，实现跨订阅混用

注意 `useInternal` 还原的策略组里，节点引用 `type` 固定为生成它的那个订阅 id（`subID`），所以节点必须存在于该订阅的缓存文件中才能被 `generateProxies` 找到。
### Citations
**File:** frontend/src/stores/subscribes.ts (L204-204)
```typescript
    s.proxies = proxies.map(({ name, type, __id__ }) => ({ id: __id__, name, type }))
```
**File:** frontend/src/stores/subscribes.ts (L206-218)
```typescript
    const fn = new window.AsyncFunction(
      'proxies',
      'subscription',
      `${s.script}; return await ${PluginTriggerEvent.OnSubscribe}(proxies, subscription)`,
    ) as (
      proxies: Recordable[],
      subscription: App.Subscription,
    ) => Promise<{ proxies: Recordable[]; subscription: App.Subscription }>

    const { proxies: _proxies, subscription } = await fn(proxies, s)

    Object.assign(s, subscription)
    s.proxies = _proxies.map(({ name, type, __id__ }) => ({ id: __id__, name, type }))
```
**File:** frontend/src/stores/subscribes.ts (L220-223)
```typescript
    if (s.type === 'Http' || (s.type === 'File' && s.url !== s.path)) {
      proxies = omitArray(_proxies, ['__id__', '__tmp__id__'])
      await WriteFile(s.path, stringifyNoFolding({ proxies }))
    }
```
**File:** frontend/src/utils/restorer.ts (L101-115)
```typescript
  config['proxy-groups'].forEach((group: any) => {
    const _group: App.Profile['proxyGroupsConfig'][number] = {
      id: GroupNameIdMap[group.name]!,
      name: group.name,
      type: group.type,
      proxies: (group.proxies || [])
        .map((proxy: string) => ({
          id: GroupNameIdMap[proxy] || NameIdMap[proxy] || proxy,
          type: GroupNameIdMap[proxy] || isBuiltIn(proxy) ? 'Built-In' : subID,
          name: GroupNameIdMap[proxy]
            ? GroupIdNameMap[GroupNameIdMap[proxy]]
            : IdNameMap[NameIdMap[proxy]!] || (isBuiltIn(proxy) && proxy),
        }))
        // The absence of a 'name' attribute indicates that this proxy has been excluded after processing by filters or plugins.
        .filter((v: any) => v.name),
```
**File:** frontend/src/utils/generator.ts (L71-115)
```typescript
export const generateProxies = async (groups: App.Profile['proxyGroupsConfig']) => {
  const subscribesStore = useSubscribesStore()

  const subIDsMap = new Set(
    groups.reduce(
      (p, c) => [
        ...p,
        ...c.proxies.filter(({ type }) => type !== 'Built-In').map(({ type }) => type),
      ],
      [] as string[],
    ),
  )

  const proxyMap: Record<string, ProxiesType[]> = {}

  for (const subID of subIDsMap) {
    const sub = subscribesStore.getSubscribeById(subID)
    if (sub) {
      try {
        const subStr = await ReadFile(sub.path)
        const { proxies = [] } = parse(subStr)
        proxyMap[sub.id] = proxies
      } catch (error) {
        console.log(error)
      }
    }
  }

  const proxies = groups.reduce((p, c) => [...p, ...c.proxies], [] as ProxiesType[])

  const proxiesList: any = []

  proxies.forEach(({ type, name }) => {
    if (proxyMap[type]) {
      const proxy = proxyMap[type].find((v) => v.name === name)
      if (proxy) {
        const isExist = proxiesList.find((v: any) => v.name === proxy.name)
        !isExist && proxiesList.push(proxy)
        // TODO: Handle proxy with the same name
        // No processing required, can be implemented using proxy prefixes
      }
    }
  })

  return proxiesList
```
## Q6
- name: 🇭🇰 香港节点
    include-all: true
    filter: (?i)港|HK|hk|Hong Kong|HongKong|hongkong
    type: url-test
    interval: 300
    tolerance: 50
上面是原来的配置
下面是生成的配置
id: ID_20l5io1c
      name: 🇭🇰 香港节点
      type: url-test
      proxies: []
      url: https://www.gstatic.com/generate_204
      interval: 300
      strategy: consistent-hashing
      use: []
      tolerance: 50
      lazy: true
      disable-udp: false
      filter: (?i)港|HK|hk|Hong Kong|HongKong|hongkong
      exclude-filter: ""
      hidden: false
      icon: ""
为什么proxies是空，而且use也是空
- name: 🚀 手动切换
    include-all: true
    type: select
生成
- id: ID_0vyilckk
      name: 🚀 手动切换
      type: select
      proxies: []
      url: https://www.gstatic.com/generate_204
      interval: 300
      strategy: consistent-hashing
      use: []
      tolerance: 150
      lazy: true
      disable-udp: false
      filter: ""
      exclude-filter: ""
      hidden: false
      icon: ""
同样手动也是这个问题，
需要怎么设置自动给use设置 订阅id，还是只能重新在界面选择后配置
### Answer
The issue: `include-all: true` groups have no `proxies` and no `use` — restorer only maps `group.proxies` and `group.use`, ignoring `include-all`/`include-all-proxies`. So generated group has empty proxies/use. Need to check how generator handles `use` and whether GUI supports include-all semantics. Search for include-all in codebase.Check generator.ts around line 322 and how `use` is consumed, plus how group editing UI sets `use`.Check generateProxyProviders and generateProxyGroup to see how `use` works, and ProxyGroupForm for UI.I have enough. Explain: `include-all: true` is a mihomo feature meaning "use all proxies + all providers". The restorer doesn't handle `include-all`/`include-all-proxies` — it only maps `group.proxies` and `group.use`. Since the original group has neither `proxies` nor `use` lists, both come out empty. `use` in this GUI maps to subscription ids (proxy-providers generated from subscriptions), not arbitrary provider names — original config had no `use` anyway.

Fix: in the group edit UI, under "use & proxies" section, select the subscription (groupID 'Subscribes' toggles `use` with subscription id). That generates `proxy-providers` + `use` in output, which combined with `filter` replicates include-all behavior. No auto-setting; must manually select subscription in UI, or use mixin/script to inject `include-all: true` into generated groups.原因：`include-all: true` 是 mihomo 的语法（表示"使用所有节点+所有 provider"），但 `restoreProfile` 完全不认识这个字段——它只映射 `group.proxies` 和 `group.use` 两个列表。你原配置里这两个字段都没有，所以还原出来 `proxies: []`、`use: []`，`include-all` 本身被直接丢弃。 GUI.for.Clash:101-132 

## 这个 GUI 里 `use` 的语义

`use` 不是任意 provider 名字，而是**订阅 id 列表**。生成配置时：

- `generateProxyProviders` 收集所有组的 `use`，把每个订阅 id 转成一个 `proxy-providers` 条目（指向订阅缓存文件） GUI.for.Clash:190-200 
- `generateProxyGroup` 里 `use` 非空才输出 `group.use` GUI.for.Clash:141-143 

所以 `use: [订阅id]` + `filter` 就是这个 GUI 等价于 `include-all + filter` 的表达方式——provider 包含订阅全部节点，filter 再筛一遍。

## 怎么设置

**没有自动设置**，`useInternal` 还原不会帮你填 `use`。两种方式：

1. **界面手动配**：编辑策略组 → 底部 "use & proxies" 区域 → 展开 `Subscribes` 分组，勾选对应订阅。勾选逻辑就是把订阅 id push 进 `group.use`： GUI.for.Clash:46-65 

   对 `🇭🇰 香港节点` 组：勾选订阅 + 保留 `filter` 即可复刻原行为。对 `🚀 手动切换`（select 无 filter）：勾选订阅后 `use` 引入全部节点，等价于 `include-all`。

2. **用 mixin/script 持久化**：手动配的 `use` 会在下次 `useInternal` 更新时被重建冲掉（只有 name/secret/mixin/script 被保留）。要长期生效，在 profile 的 `mixinConfig` 或 `scriptConfig`（`onGenerate` 钩子）里给对应组注入 `use` 或直接把 `include-all: true` 写回生成的 YAML——mixin 是生成后合并的，可以补回 restorer 丢掉的字段。

注意：方式 1 每次更新订阅都要重配；要一劳永逸用方式 2。
### Citations
**File:** frontend/src/utils/restorer.ts (L101-132)
```typescript
  config['proxy-groups'].forEach((group: any) => {
    const _group: App.Profile['proxyGroupsConfig'][number] = {
      id: GroupNameIdMap[group.name]!,
      name: group.name,
      type: group.type,
      proxies: (group.proxies || [])
        .map((proxy: string) => ({
          id: GroupNameIdMap[proxy] || NameIdMap[proxy] || proxy,
          type: GroupNameIdMap[proxy] || isBuiltIn(proxy) ? 'Built-In' : subID,
          name: GroupNameIdMap[proxy]
            ? GroupIdNameMap[GroupNameIdMap[proxy]]
            : IdNameMap[NameIdMap[proxy]!] || (isBuiltIn(proxy) && proxy),
        }))
        // The absence of a 'name' attribute indicates that this proxy has been excluded after processing by filters or plugins.
        .filter((v: any) => v.name),
      url: group.url ?? 'https://www.gstatic.com/generate_204',
      interval: group.interval ?? 300,
      strategy: group.strategy ?? 'consistent-hashing',
      use: (group.use || []).map((use: string) => {
        return GroupNameIdMap[use] || use
      }),
      tolerance: group.tolerance ?? 150,
      lazy: group.lazy ?? true,
      'disable-udp': group['disable-udp'] ?? false,
      filter: group.filter ?? '',
      'exclude-filter': group['exclude-filter'] ?? '',
      hidden: group.hidden ?? false,
      icon: group.icon ?? '',
    }

    profile.proxyGroupsConfig.push(_group)
  })
```
**File:** frontend/src/utils/generator.ts (L141-143)
```typescript
  if (use.length !== 0) {
    group.use = use
  }
```
**File:** frontend/src/utils/generator.ts (L190-200)
```typescript
export const generateProxyProviders = async (groups: App.Profile['proxyGroupsConfig']) => {
  const providers: Record<string, any> = {}
  const subs = new Set<string>()
  groups.forEach((group) => {
    group.use.forEach((use) => subs.add(use))
  })
  const subscribesStore = useSubscribesStore()
  subs.forEach((id) => {
    const sub = subscribesStore.getSubscribeById(id)
    if (sub) {
      providers[sub.id] = {
```
**File:** frontend/src/views/ProfilesView/components/ProxyGroupForm.vue (L46-65)
```vue
const handleAddProxy = (groupID: string, proxyID: string, proxyName: string) => {
  if (groupID === 'Built-In' && proxyID === group.value.id) return

  if (groupID === 'Subscribes') {
    const idx = group.value.use.findIndex((v) => v === proxyID)
    if (idx !== -1) {
      group.value.use.splice(idx, 1)
    } else {
      group.value.use.push(proxyID)
    }
    return
  }

  const idx = group.value.proxies.findIndex((v) => v.id === proxyID)
  if (idx !== -1) {
    group.value.proxies.splice(idx, 1)
  } else {
    group.value.proxies.push({ id: proxyID, type: groupID, name: proxyName })
  }
}
```
## Q7
有几个问题
1. 手动配置更新后要重配，
2. 策略组很多的时候，工作量很大
3. 如果用mixin，每个策略组都要配置
### Answer
User wants a better solution: avoid reconfiguring every group. Options: scriptConfig onGenerate hook can iterate all groups and inject `use`/`include-all` automatically — one script covers all groups. Check script hook signature in codebase.Check generator.ts script hook usage and MixinAndScriptConfig to confirm onGenerate signature.Answer: scriptConfig's onGenerate receives final config object — one script can loop all proxy-groups and inject `use`/`include-all` automatically. scriptConfig is preserved across useInternal updates. Provide example code.这三个问题其实可以用**一段 scriptConfig 脚本统一解决**——`scriptConfig` 是 `useInternal` 更新时会被保留的四个字段之一，而且它的 `onGenerate` 钩子拿到的是**生成后的完整 config 对象**，可以遍历所有策略组批量处理，不用逐个配。 GUI.for.Clash:187-196 GUI.for.Clash:382-398 

## 推荐方案：scriptConfig 批量注入

在 profile 的脚本配置里写（默认模板就是 `onGenerate`）： GUI.for.Clash:450-451 

```js
const onGenerate = async (config) => {
  // 给所有策略组补回 include-all（等价于原订阅行为）
  config['proxy-groups'].forEach((group) => {
    group['include-all'] = true
  })
  return config
}
```

或者按条件精细控制：

```js
const onGenerate = async (config) => {
  config['proxy-groups'].forEach((group) => {
    // 只给原本就没有显式 proxies/use 的组补 include-all
    if (!group.proxies?.length && !group.use?.length) {
      group['include-all'] = true
    }
    // 或者按名字匹配
    // if (group.name.includes('香港')) group['include-all'] = true
  })
  return config
}
```

这样：

1. **更新后不用重配**——`scriptConfig` 在 `useInternal` 重建 profile 时被保留，每次生成配置都会执行
2. **策略组再多也是一段代码**——遍历 `config['proxy-groups']` 批量处理，工作量与组数量无关
3. **不用 mixin 逐个配**——mixin 是静态 YAML/JSON 合并，确实要枚举每个组；脚本是动态代码，直接操作生成结果

## 执行顺序确认

`generateConfig` 的流程是：GUI 配置生成 → 插件 `onGenerate` → mixin 合并 → **scriptConfig 的 `onGenerate` 最后执行**，所以脚本看到的是最终 config，改 `proxy-groups` 一定生效。 GUI.for.Clash:370-398 

## 备选：直接注入 `use`

如果你更想用 GUI 的 `use` 机制（生成 `proxy-providers` 指向订阅文件）而不是 `include-all`，脚本里也可以同时补两者：

```js
const onGenerate = async (config) => {
  const subId = '你的订阅id'
  config['proxy-providers'] = config['proxy-providers'] || {}
  config['proxy-providers'][subId] = {
    type: 'file',
    path: `./subscribes/${subId}.yaml`,  // 相对内核工作目录
  }
  config['proxy-groups'].forEach((group) => {
    if (!group.use?.length && !group.proxies?.length) {
      group.use = [subId]
    }
  })
  return config
}
```

注意 `path` 要按内核实际工作目录调整（可用 `generateProxyProviders` 生成的格式作参考）。 GUI.for.Clash:190-200 

总结：`include-all` 方案最简单（一行字段，mihomo 原生支持），`use` 方案更贴合 GUI 的数据模型但要自己维护 provider 路径。两者都用 scriptConfig 一处配置、永久生效。
### Citations
**File:** frontend/src/stores/subscribes.ts (L187-196)
```typescript
      if (profile) {
        _profile.name = profile.name
        _profile.advancedConfig.secret = profile.advancedConfig.secret
        _profile.mixinConfig = profile.mixinConfig
        _profile.scriptConfig = profile.scriptConfig
        profilesStore.editProfile(profile.id, _profile)
      } else {
        _profile.name = s.name
        profilesStore.addProfile(_profile)
      }
```
**File:** frontend/src/utils/generator.ts (L190-200)
```typescript
export const generateProxyProviders = async (groups: App.Profile['proxyGroupsConfig']) => {
  const providers: Record<string, any> = {}
  const subs = new Set<string>()
  groups.forEach((group) => {
    group.use.forEach((use) => subs.add(use))
  })
  const subscribesStore = useSubscribesStore()
  subs.forEach((id) => {
    const sub = subscribesStore.getSubscribeById(id)
    if (sub) {
      providers[sub.id] = {
```
**File:** frontend/src/utils/generator.ts (L370-398)
```typescript
  // step 2
  const pluginsStore = usePluginsStore()
  const _config = await pluginsStore.onGenerateTrigger(config, originalProfile)

  // step 3
  const { priority, config: mixin } = originalProfile.mixinConfig
  if (priority === 'mixin') {
    deepAssign(_config, parse(mixin))
  } else if (priority === 'gui') {
    deepAssign(_config, deepAssign(parse(mixin), _config))
  }

  // step 4
  const fn = new window.AsyncFunction(
    'config',
    `${originalProfile.scriptConfig.code}; return await onGenerate(config)`,
  )
  let result
  try {
    result = await fn(_config)
  } catch (error: any) {
    throw error.message || error
  }

  if (typeof result !== 'object') {
    throw 'Wrong result'
  }

  return result
```
**File:** frontend/src/constant/profile.ts (L450-451)
```typescript
export const ScriptConfigDefaults = (): App.Profile['scriptConfig'] => {
  return { code: `const onGenerate = async (config) => {\n  return config\n}` }
```
## Q8
- name: 🚀 手动切换
    type: select
    filter: ""
    exclude-filter: ""
    hidden: false
    icon: ""
    disable-udp: false
    use:
      - ID_nx9jxfvb- name: 🚀 手动切换
    type: select
    filter: ""
    exclude-filter: ""
    hidden: false
    icon: ""
    disable-udp: false
    use:
      - ID_nx9jxfvb
按上述脚本方案，最终生成的配置如上，但是界面中显示“手动切换”只有COMPATIBLE选项
### Answer
The generated config has `use: [ID_nx9jxfvb]` but UI shows only COMPATIBLE. Need to check how the UI displays group proxies — probably it reads from profile's proxyGroupsConfig (the GUI model), not the generated YAML. The script modifies generated config only; the profile's group still has empty proxies/use, so UI shows nothing/COMPATIBLE. Also check how proxies list in UI is built — maybe from running core API /proxies. COMPATIBLE is a mihomo built-in for groups with no proxies? Actually mihomo adds COMPATIBLE fallback when a select group has no proxies. So the generated config's `use` references provider ID_nx9jxfvb — but was proxy-providers generated? If script added `use` but provider path wrong, mihomo shows COMPATIBLE. Need to check generateProxyProviders path format and whether script ran before/after. Script runs after generation, so if script added use + provider, check path. Let me look at generator.ts provider generation and where COMPATIBLE comes from.COMPATIBLE at kernel.ts:238 — check. Also the UI shows group members from core API /proxies probably. COMPATIBLE is mihomo's built-in outbound shown when group empty. Check kernel.ts:238 and how UI lists group proxies.Check line 322 context and where generateProxyProviders output is assigned to config['proxy-providers'].Key insight: `config['proxy-providers']` is generated at line 322 from `profile.proxyGroupsConfig` — i.e., from the GUI model's `use` fields, BEFORE the script runs. If the script only injected `use` into `config['proxy-groups']` but the provider wasn't added (or added with wrong path), mihomo can't resolve the provider → group falls back to COMPATIBLE.

Also COMPATIBLE is mihomo's built-in placeholder shown when a select group ends up with no proxies. The UI shows group members from the running core's /proxies API, not the YAML.

So the answer: the generated group has `use: [ID_nx9jxfvb]` but `proxy-providers` likely missing or path wrong. If user used the second script variant, they must add proxy-providers with correct path `../subscribes/{id}.yaml` (sub.path.replace('data/','../')). If they only set `use` without provider, mihomo ignores it → empty → COMPATIBLE. Also check: does the generated config actually contain proxy-providers? Ask them to verify. Also note `use` in generated YAML references provider name = sub.id.

Also alternative: include-all approach avoids providers entirely.

Answer concisely.问题在于：`use` 引用的 provider 必须存在于 `proxy-providers` 里，否则 mihomo 解析不到节点，select 组为空时就只显示内置的 `COMPATIBLE` 占位出站。 GUI.for.Clash:238-238 

## 为什么会是空的

`config['proxy-providers']` 是在脚本执行**之前**、由 `generateProxyProviders(profile.proxyGroupsConfig)` 生成的——它读的是 **GUI 数据模型**里各组的 `use` 字段，而不是生成后 YAML 里的 `use`： GUI.for.Clash:322-322 GUI.for.Clash:190-208 

所以如果你的脚本只做了 `group.use = [subId]`，生成的 YAML 里组有 `use`，但 `proxy-providers` 是空的（或你脚本里补的 provider 路径不对），mihomo 找不到名为 `ID_nx9jxfvb` 的 provider → 组内无节点 → 显示 COMPATIBLE。

## 修复

**方案 A（推荐）：脚本里同时补 provider，且路径格式要对**

GUI 自己的格式是 `sub.path.replace('data/', '../')`，即 `data/subscribes/xxx.yaml` → `../subscribes/xxx.yaml`（相对内核工作目录 `data/mihomo`）： GUI.for.Clash:200-203 

```js
const onGenerate = async (config) => {
  const subId = 'ID_nx9jxfvb'
  config['proxy-providers'] = config['proxy-providers'] || {}
  config['proxy-providers'][subId] = {
    type: 'file',
    path: `../subscribes/${subId}.yaml`,   // 注意是 ../ 不是 ./
  }
  config['proxy-groups'].forEach((group) => {
    if (!group.use?.length && !group.proxies?.length) {
      group.use = [subId]
    }
  })
  return config
}
```

先打开生成的 YAML 确认 `proxy-providers` 段里确实有 `ID_nx9jxfvb` 且 path 指向真实存在的文件。

**方案 B（更简单）：用 `include-all`，完全绕开 provider**

```js
const onGenerate = async (config) => {
  config['proxy-groups'].forEach((group) => {
    if (!group.use?.length && !group.proxies?.length) {
      group['include-all'] = true
    }
  })
  return config
}
```

`include-all` 是 mihomo 原生字段，直接引用 `proxies` 里的全部节点，不需要 provider。但注意：`config['proxies']` 由 `generateProxies` 生成，只包含**被策略组显式引用的节点**——如果所有组都没有显式 proxies，`proxies` 本身也是空的，`include-all` 依然没节点可用。 GUI.for.Clash:346-346 

所以对你这个场景（节点全在订阅文件里、组里没有显式节点），**方案 A 才是对的**——必须走 `proxy-providers` + `use` 这条路，关键是把 provider 路径写对。
### Citations
**File:** frontend/src/constant/kernel.ts (L238-238)
```typescript
export const BuiltInOutbound = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']
```
**File:** frontend/src/utils/generator.ts (L190-208)
```typescript
export const generateProxyProviders = async (groups: App.Profile['proxyGroupsConfig']) => {
  const providers: Record<string, any> = {}
  const subs = new Set<string>()
  groups.forEach((group) => {
    group.use.forEach((use) => subs.add(use))
  })
  const subscribesStore = useSubscribesStore()
  subs.forEach((id) => {
    const sub = subscribesStore.getSubscribeById(id)
    if (sub) {
      providers[sub.id] = {
        type: 'file',
        path: sub.path.replace('data/', '../'),
      }
    }
  })

  return providers
}
```
**File:** frontend/src/utils/generator.ts (L322-322)
```typescript
  config['proxy-providers'] = await generateProxyProviders(profile.proxyGroupsConfig)
```
**File:** frontend/src/utils/generator.ts (L346-346)
```typescript
  config['proxies'] = await generateProxies(profile.proxyGroupsConfig)
```
