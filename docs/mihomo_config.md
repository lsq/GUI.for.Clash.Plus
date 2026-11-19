# 参考

https://github.com/vernesong/mihomo
https://github.com/TanakaLun/mihomo
https://deepwiki.com/search/c77d4b21-b428-4554-8521-ca1ae787d46c

# DeepWiki Q&A with Code Context for Repository: TanakaLun/mihomo
## Q1
mihomo 的 PUT /configs?force=true 重载的是代理/规则/DNS 等运行配置，external-controller 的监听绑定是不是独立管理的，会不会因为 payload 里写了新地址就 rebind
### Answer
Search for external-controller handling in config reload.Key: `executor.ApplyConfig` comment says "without ExternalController". `applyRoute` in hub.go calls `route.ReCreateServer` — but is `applyRoute` called from `hub.ApplyConfig` only (startup), not from `executor.ApplyConfig`? Check hub.go ApplyConfig.Confirmed: PUT /configs calls `executor.ApplyConfig` (hub/route/configs.go:444), which explicitly excludes ExternalController. `applyRoute`/`ReCreateServer` only invoked via `hub.ApplyConfig` at startup (hub.Parse). So payload's external-controller is ignored on reload — no rebind. Answer in Chinese.是的，`external-controller` 的监听绑定是独立管理的，`PUT /configs`（无论是否 `force=true`）都不会触发 rebind。

**调用链：**

- `PUT /configs` 的 handler `updateConfigs` 解析 payload/path 后调用的是 `executor.ApplyConfig(cfg, force)` mihomo:444-445 
- `executor.ApplyConfig` 的注释明确写着 "dispatch configure to all parts **without ExternalController**"，其内部只更新 proxies/rules/DNS/listeners/tun 等，没有任何 controller 相关逻辑 mihomo:83-84 
- 真正负责 controller 监听的是 `hub.ApplyConfig` → `applyRoute` → `route.ReCreateServer`，它只在启动时经 `hub.Parse` 调用一次 mihomo:54-58 mihomo:64-82 

**结论：**

- payload 里写 `external-controller: 0.0.0.0:xxxx` 会被解析进 `cfg.Controller`，但 `executor.ApplyConfig` 不消费它，监听地址保持启动时的绑定不变。
- 同理 `secret`、`external-ui`、`external-controller-tls/unix/pipe` 也不会因 PUT /configs 生效。
- `PATCH /configs` 的 `configSchema` 里同样没有 controller 字段，也无法改 mihomo:36-60 
- 想改 controller 绑定只能重启进程（或走 `/restart` 端点重启后重新走 `hub.Parse` 路径）。

一个附带影响：`ReCreateServer` 里 `IsDebug` 取决于 `LogLevel == DEBUG`，但既然 reload 不重建 server，运行时改 log-level 也不会挂载 `/debug` 路由 mihomo:77-77
### Citations
**File:** hub/route/configs.go (L36-60)
```go
type configSchema struct {
	Port              *int                     `json:"port"`
	SocksPort         *int                     `json:"socks-port"`
	RedirPort         *int                     `json:"redir-port"`
	TProxyPort        *int                     `json:"tproxy-port"`
	MixedPort         *int                     `json:"mixed-port"`
	Tun               *tunSchema               `json:"tun"`
	TuicServer        *tuicServerSchema        `json:"tuic-server"`
	ShadowSocksConfig *string                  `json:"ss-config"`
	VmessConfig       *string                  `json:"vmess-config"`
	TcptunConfig      *string                  `json:"tcptun-config"`
	UdptunConfig      *string                  `json:"udptun-config"`
	AllowLan          *bool                    `json:"allow-lan"`
	SkipAuthPrefixes  *[]netip.Prefix          `json:"skip-auth-prefixes"`
	LanAllowedIPs     *[]netip.Prefix          `json:"lan-allowed-ips"`
	LanDisAllowedIPs  *[]netip.Prefix          `json:"lan-disallowed-ips"`
	BindAddress       *string                  `json:"bind-address"`
	Mode              *tunnel.TunnelMode       `json:"mode"`
	LogLevel          *log.LogLevel            `json:"log-level"`
	IPv6              *bool                    `json:"ipv6"`
	Sniffing          *bool                    `json:"sniffing"`
	TcpConcurrent     *bool                    `json:"tcp-concurrent"`
	FindProcessMode   *process.FindProcessMode `json:"find-process-mode"`
	InterfaceName     *string                  `json:"interface-name"`
}
```
**File:** hub/route/configs.go (L444-445)
```go
	executor.ApplyConfig(cfg, force)
	render.NoContent(w, r)
```
**File:** hub/executor/executor.go (L83-84)
```go
// ApplyConfig dispatch configure to all parts without ExternalController
func ApplyConfig(cfg *config.Config, force bool) {
```
**File:** hub/hub.go (L54-58)
```go
// ApplyConfig dispatch configure to all parts include ExternalController
func ApplyConfig(cfg *config.Config) {
	applyRoute(cfg)
	executor.ApplyConfig(cfg, true)
}
```
**File:** hub/hub.go (L64-82)
```go
	route.ReCreateServer(&route.Config{
		Addr:           cfg.Controller.ExternalController,
		TLSAddr:        cfg.Controller.ExternalControllerTLS,
		UnixAddr:       cfg.Controller.ExternalControllerUnix,
		PipeAddr:       cfg.Controller.ExternalControllerPipe,
		RoutingMark:    cfg.Controller.ExternalControllerRoutingMark,
		Secret:         cfg.Controller.Secret,
		Certificate:    cfg.TLS.Certificate,
		PrivateKey:     cfg.TLS.PrivateKey,
		ClientAuthType: cfg.TLS.ClientAuthType,
		ClientAuthCert: cfg.TLS.ClientAuthCert,
		EchKey:         cfg.TLS.EchKey,
		DohServer:      cfg.Controller.ExternalDohServer,
		IsDebug:        cfg.General.LogLevel == log.DEBUG,
		Cors: route.Cors{
			AllowOrigins:        cfg.Controller.Cors.AllowOrigins,
			AllowPrivateNetwork: cfg.Controller.Cors.AllowPrivateNetwork,
		},
	})
```
## Q2
restart接口会改变吗
### Answer
Check /restart endpoint implementation.Restart re-execs the binary with same args → full startup → hub.Parse → applyRoute → ReCreateServer with config file values. So yes, restart rebinds external-controller, but only to whatever is in the config file on disk (not the PUT payload, unless payload had path that wrote to file — actually PUT /configs with path reloads from file; payload without path doesn't persist). Answer concisely.会。`POST /restart` 不是进程内重载，而是直接 `syscall.Exec` 重新执行自身二进制（Windows 上是 `exec.Command` 起新进程再 `os.Exit(0)`） mihomo:45-66 。

这意味着：

- 新进程走完整启动流程：`main` → `hub.Parse` → `hub.ApplyConfig` → `applyRoute` → `route.ReCreateServer`，`external-controller` 会按**配置文件**里的值重新绑定 mihomo:54-58 
- 但注意来源是磁盘上的配置文件，不是之前 PUT /configs 的内存 payload。PUT 时如果带了 `path` 参数会从该文件重读，但 payload 本身不会写回文件——所以想让新 controller 地址在 restart 后生效，必须先把它写进配置文件
- 重启用的是 `os.Args` 原样重放，如果启动时通过 `-f`/`-d` 指定了配置路径，新进程读的还是同一份文件 mihomo:63-63 

另外 `executor.Shutdown()` 在 exec 前调用做清理，但旧进程被 exec 替换后监听 socket 会短暂断开重绑，controller 端口有瞬间不可用窗口 mihomo:47-47 。
### Citations
**File:** hub/route/restart.go (L45-66)
```go
func restartExecutable(execPath string) {
	var err error
	executor.Shutdown()
	if runtime.GOOS == "windows" {
		cmd := exec.Command(execPath, os.Args[1:]...)
		log.Infoln("restarting: %q %q", execPath, os.Args[1:])
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		err = cmd.Start()
		if err != nil {
			log.Fatalln("restarting: %s", err)
		}

		os.Exit(0)
	}

	log.Infoln("restarting: %q %q", execPath, os.Args[1:])
	err = syscall.Exec(execPath, os.Args, os.Environ())
	if err != nil {
		log.Fatalln("restarting: %s", err)
	}
```
**File:** hub/hub.go (L54-58)
```go
// ApplyConfig dispatch configure to all parts include ExternalController
func ApplyConfig(cfg *config.Config) {
	applyRoute(cfg)
	executor.ApplyConfig(cfg, true)
}
```
## Q3
如果 一个配置改变的内容较大，是通过config patch好，还是 用restart的方式通过指定新的配置 文件的来更换配置好
### Answer
Question: for large config changes, PATCH /configs vs restart with new config file. Need to check what PATCH supports and what PUT does. PATCH only supports limited schema fields (configSchema above). PUT /configs reloads full config from file or payload. Restart re-execs. For large changes, PUT /configs with path or payload is the designed path; restart needed only for controller fields. Answer based on known code; maybe quickly verify PATCH handler and PUT payload handling.Answer: for large changes, PATCH is wrong tool — it only supports a small subset of fields. Use PUT /configs with path or payload (full reload, in-place, no downtime of controller). Restart only needed for controller fields or when you want clean state. Compare tradeoffs.改动大时，PATCH 其实不是候选——`PATCH /configs` 的 `configSchema` 只支持约 20 个 general 字段（端口、mode、log-level、allow-lan 等），不含 proxies/rules/dns/listeners，大改动根本表达不了 mihomo:36-60 。

真正的选择是 **PUT /configs（带 `path` 或 `payload`）vs /restart**：

**PUT /configs 适合绝大多数大改动**

- 它做的就是全量重载：`executor.ApplyConfig` 会依次更新 proxies、rules、sniffer、hosts、general、DNS、NTP、listeners、tun、iptables、tunnels，并重载 providers mihomo:84-123 
- 支持 `path`（绝对路径且需通过 `IsSafePath` 校验）或直接传 `payload` 字符串，等价于"换一份新配置文件"的效果 mihomo:412-441 
- 进程不退出，controller 连接不断，没有 exec 窗口期
- 整个过程在 `mux.Lock()` 下原子完成，还有 `tunnel.OnSuspend()`/`OnRunning()` 做流量挂起恢复 mihomo:85-119 

**必须用 /restart 的场景**

- 改动涉及 `external-controller*`、`secret`、`external-ui`、TLS 证书等 controller 字段——PUT 完全不消费这些 mihomo:83-84 
- 想要彻底干净的状态（PUT 是增量式替换，某些内部状态如已建立的连接、缓存可能保留；restart 是全量重建）

**注意点**

- PUT 用 `path` 时新配置必须落盘且路径安全校验通过；用 `payload` 则不落盘，restart 后会回到旧文件
- restart 走 `syscall.Exec` 重放 `os.Args`，新进程读的是启动参数指定的配置文件，所以要换文件得改 `-f` 参数或先替换磁盘文件 mihomo:63-63 
- PUT 失败有明确 HTTP 错误返回；restart 后新进程配置解析失败会直接退出，没有回滚保护

结论：大改动优先用 `PUT /configs` + `path`/`payload`，只有动 controller 相关字段或需要完全干净状态时才用 restart。
### Citations
**File:** hub/route/configs.go (L36-60)
```go
type configSchema struct {
	Port              *int                     `json:"port"`
	SocksPort         *int                     `json:"socks-port"`
	RedirPort         *int                     `json:"redir-port"`
	TProxyPort        *int                     `json:"tproxy-port"`
	MixedPort         *int                     `json:"mixed-port"`
	Tun               *tunSchema               `json:"tun"`
	TuicServer        *tuicServerSchema        `json:"tuic-server"`
	ShadowSocksConfig *string                  `json:"ss-config"`
	VmessConfig       *string                  `json:"vmess-config"`
	TcptunConfig      *string                  `json:"tcptun-config"`
	UdptunConfig      *string                  `json:"udptun-config"`
	AllowLan          *bool                    `json:"allow-lan"`
	SkipAuthPrefixes  *[]netip.Prefix          `json:"skip-auth-prefixes"`
	LanAllowedIPs     *[]netip.Prefix          `json:"lan-allowed-ips"`
	LanDisAllowedIPs  *[]netip.Prefix          `json:"lan-disallowed-ips"`
	BindAddress       *string                  `json:"bind-address"`
	Mode              *tunnel.TunnelMode       `json:"mode"`
	LogLevel          *log.LogLevel            `json:"log-level"`
	IPv6              *bool                    `json:"ipv6"`
	Sniffing          *bool                    `json:"sniffing"`
	TcpConcurrent     *bool                    `json:"tcp-concurrent"`
	FindProcessMode   *process.FindProcessMode `json:"find-process-mode"`
	InterfaceName     *string                  `json:"interface-name"`
}
```
**File:** hub/route/configs.go (L412-441)
```go
	if req.Payload != "" {
		cfg, err = executor.ParseWithBytes([]byte(req.Payload))
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, newError(err.Error()))
			return
		}
	} else {
		if req.Path == "" { // default path unneeded any safe check
			req.Path = C.Path.Config()
		} else {
			if !filepath.IsAbs(req.Path) {
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, newError("path is not a absolute path"))
				return
			}

			if !C.Path.IsSafePath(req.Path) {
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, newError(C.Path.ErrNotSafePath(req.Path).Error()))
				return
			}
		}

		cfg, err = executor.ParseWithPath(req.Path)
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, newError(err.Error()))
			return
		}
```
**File:** hub/executor/executor.go (L83-123)
```go
// ApplyConfig dispatch configure to all parts without ExternalController
func ApplyConfig(cfg *config.Config, force bool) {
	mux.Lock()
	defer mux.Unlock()
	log.SetLevel(cfg.General.LogLevel)

	tunnel.OnSuspend()

	ca.ResetCertificate()
	for _, c := range cfg.TLS.CustomTrustCert {
		if err := ca.AddCertificate(c); err != nil {
			log.Warnln("%s\nadd error: %s", c, err.Error())
		}
	}

	updateExperimental(cfg.Experimental)
	updateUsers(cfg.Users)
	updateProxies(cfg.Proxies, cfg.Providers)
	updateRules(cfg.Rules, cfg.SubRules, cfg.RuleProviders)
	updateSniffer(cfg.Sniffer)
	updateHosts(cfg.Hosts)
	updateGeneral(cfg.General, true)
	updateDNS(cfg.DNS, cfg.General.IPv6)
	updateNTP(cfg.NTP) // initialize NTP after DNS because an NTP server may be a hostname.
	updateListeners(cfg.General, cfg.Listeners, force)
	updateTun(cfg.General) // tun should not care "force"
	updateIPTables(cfg)
	updateTunnels(cfg.Tunnels)

	tunnel.OnInnerLoading()

	initInnerTcp()
	loadProvider(cfg.Providers)
	updateProfile(cfg)
	loadProvider(cfg.RuleProviders)
	runtime.GC()
	tunnel.OnRunning()
	updateUpdater(cfg)

	resolver.ResetConnection()
}
```
**File:** hub/route/restart.go (L63-63)
```go
	err = syscall.Exec(execPath, os.Args, os.Environ())
```
## Q4
SafePath只支持环境变量吗，配置 文件是否可以t候
### Answer
User asks: does IsSafePath only support env vars, can config file be used? Search for IsSafePath / safe paths implementation.User asks: does SafePath only support env vars, can config file be used? Answer: yes, only env vars — SAFE_PATHS env var and SKIP_SAFE_PATH_CHECK, plus homeDir always allowed. No config file option. Check config.go line 808 for any config field? Quick check.Answer: only env vars — SAFE_PATHS (list) and SKIP_SAFE_PATH_CHECK; homeDir always allowed; CMFA feature flag bypasses. No config file option.是的，只能通过环境变量控制，配置文件里没有对应字段。

`IsSafePath` 的判定来源有三个，全部在进程启动时初始化，与配置文件无关：

- **`SAFE_PATHS` 环境变量**：用 `filepath.SplitList` 分隔的目录列表（Unix 用 `:`，Windows 用 `;`），解析进 `path.safePaths` mihomo:42-49 
- **`SKIP_SAFE_PATH_CHECK` 环境变量**：设为 true 时 `allowUnsafePath` 直接放行所有路径 mihomo:33-33 mihomo:89-91 
- **homeDir 永远安全**：`SafePaths()` 返回 `homeDir + safePaths`，即 `$HOME/.config/mihomo`（或 `-d` 指定的目录）下的文件天然允许 mihomo:103-105 

另外 `features.CMFA` 构建标志也会绕过检查 mihomo:89-89 。

配置文件里没有任何 `safe-paths` 之类的字段——`RawConfig` 不解析它，`configSchema` 也没有。而且 `Path` 是包级 `var` 在 init 时一次性读取环境变量，运行中改环境变量也不会生效 mihomo:28-52 。

所以 `PUT /configs` 的 `path` 想指向 homeDir 以外的文件，只能在启动前设置 `SAFE_PATHS` 或 `SKIP_SAFE_PATH_CHECK=1`，无法通过配置热更。
### Citations
**File:** constant/path.go (L28-52)
```go
var Path = func() *path {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir, _ = os.Getwd()
	}
	allowUnsafePath, _ := strconv.ParseBool(os.Getenv("SKIP_SAFE_PATH_CHECK"))
	homeDir = P.Join(homeDir, ".config", Name)

	if _, err = os.Stat(homeDir); err != nil {
		if configHome, ok := os.LookupEnv("XDG_CONFIG_HOME"); ok {
			homeDir = P.Join(configHome, Name)
		}
	}

	var safePaths []string
	for _, safePath := range filepath.SplitList(os.Getenv("SAFE_PATHS")) {
		safePath = strings.TrimSpace(safePath)
		if len(safePath) == 0 {
			continue
		}
		safePaths = append(safePaths, safePath)
	}

	return &path{homeDir: homeDir, configFile: "config.yaml", allowUnsafePath: allowUnsafePath, safePaths: safePaths}
}()
```
**File:** constant/path.go (L89-91)
```go
	if p.allowUnsafePath || features.CMFA {
		return true
	}
```
**File:** constant/path.go (L103-105)
```go
func (p *path) SafePaths() []string {
	return append([]string{p.homeDir}, p.safePaths...) // add homedir to safePaths
}
```
