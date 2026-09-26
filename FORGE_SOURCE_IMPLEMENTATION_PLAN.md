# Forge/NeoForge 源码功能 — 最小化实现方案（开发文档）

> **状态（2026-09-27）：已实现并验证。** 7 个工具全部落地（NeoForge 1.21.1 与 Forge 1.20.1 的 NFRT 流水线均 E2E 5/5 通过，含 NFRT-forge 首测）。本文件保留为设计依据；实际代码见 §6 清单，运行方式见 §7（`npm run test:manual:forge`）。

> 基于 `FORGE_SOURCE_FEATURE_GUIDE.md`（下称「指南」）制定。
> 结论依据三路并行调研：本仓库代码勘察 ×2 + NFRT/Forge/NeoForge 外部调研（关键论断均附来源，见 §10）。
> **功能面按指南全量交付（7 个工具）；实现面最小化** —— 核心发现是指南中的重头组件（patch 应用器、MCPConfig 服务、独立缓存布局）**全部不需要**，因为 NFRT 一步产出「patched MC 源码 + loader 本体源码」的合并工件，而仓库现有 patched-JAR 流程已经能消费它。

---

## 0. 一句话结论

指南的 A（Forge-patched MC 源码）+ B（Forge/NeoForge 本体源码）两个目标，**唯一的真缺口是「自动获取 patched 工件」**——目前 `decompile_minecraft_version` 需要用户手动传 `jarPath`。补上一个 NFRT 流水线工具后，7 个新工具 = 2 个实体工具 + 5 个薄包装（懒加载 + 委托现有实现）。

### 关键事实（已核实）

1. **patched 反编译树天然包含 loader 本体源码**。manual 测试（`__tests__/manual/patched/patched-jar.test.ts:111-115`）已断言 `net.neoforged` / `net.minecraftforge` 包下存在 `.java`；FTS 索引与 compare 的 added 类均命中 loader 包。→ 指南里「loader 源码树」与「patched MC 源码树」在本仓库是**同一棵树**，五个 get/search/compare 工具不需要独立数据源。
2. **版本键全链路 opaque**。`getDecompiledPath(version, mapping)` → `decompiled/<version>/<mapping>/`，get/search/index/compare 对 `1.21.1-neoforge-21.1.72` 这类键零特殊分支（CLAUDE.md「Patched MC JARs」节明确记载此设计）。
3. **NFRT 官方支持 Forge 工件**。NFRT 仓库自己的 build.gradle IDE run 配置里有 `--neoforge net.minecraftforge:forge:1.17.1-37.1.1:userdev --add-repository https://maven.minecraftforge.net` 的现成示例；changelog 1.0.22 为 Forge 1.20.1 加 Side Annotation Stripping、1.0.26 修复 Forge 1.20/1.19/1.18 的 MDG-Legacy 问题。仓库内未实测（本方案用 manual 测试兜底，见 §8）。
4. **`gameSourcesWithNeoForge` 正是「IDE 里看到的源码」**：NFRT 用 InjectZipContentAction 把 loader 的 `-sources` 工件全量并入 patched MC 源码 zip（NFRT 源码 `createSourcesWithNeoForge()` 注释原话 "a sources-zip containing both Minecraft and NeoForge sources"）。注意纯 `gameSources` **不含** loader 源码。

### 与指南的差异总览

| 指南组件 | 本方案 | 理由 |
|---|---|---|
| `McpConfigService` + patch 下载/缓存 | **砍** | NFRT 内部完成整条流水线（下载 MC → 反编译 → MCPConfig patch → Forge patch → 产物） |
| unified diff patch 应用器（fuzz、失败回退、`patch-failures.json`） | **砍** | 同上；NFRT 失败 = 整次失败（原子性），不存在"部分文件失败" |
| 独立缓存布局 `forge/<loader>/<mc>/<ver>/` + `meta.json` | **砍** | 沿用现有 `decompiled/<version>/<mapping>/`；"缓存就绪" = 目录存在，无需元数据文件 |
| loader 源码单独获取（`-sources.jar` 下载 / GitHub 回退 / 反编译 universal） | **砍** | 已在 patched 树内（关键事实 1、4） |
| `version-index/*.json` 落盘缓存 | 降级为进程内 TTL | 一次 GET 而已，重启重拉可接受（`documentation-service.ts:141` 现成模式） |
| GITHUB_TOKEN、错误码表 | **砍** | 全程只碰 Maven，无 GitHub API、无限流 |
| `showDiff` 参数（get_* 内嵌文本 diff） | 移到 `compare_vanilla_vs_forge`；文本 unified diff 用现有 **AST 结构化 diff** 替代 | 结构化 diff 对 LLM 更省 token；纯文本 diff 需新增 `diff` 依赖，明确不做 |
| 版本范围 1.14+ | **1.17+ 优先**（neoforge 20.2+ / forge 1.17+） | NFRT 对更老版本支持未验证；指南 5.3 本就将 1.14–1.16 标 experimental，本方案直接不承诺 |
| NeoForge MC 1.20.1 | **跳过** | 早期 NeoForge 1.20.1 发布在 `net.neoforged:forge` 工件下，不在 `net.neoforged:neoforge` 元数据中；1.20.1 请用 Forge |
| yarn 映射 | 永远 `mojmap` | 与现有 patched 流程一致（Forge/NeoForge 1.17+ 工具链 mojmap-only，schema 已强制） |

### 指南 §1.3 成功标准逐条核对

| 标准 | 满足方式 |
|---|---|
| 1. 按 MC 版本列出 Forge/NeoForge 版本 | `list_forge_versions`（§5.1） |
| 2. 读取任意 `net.minecraftforge.*` / `net.neoforged.*` 源码 | `get_forge_source`（§5.3），树内含 loader 源码 |
| 3. 读取对应 Forge 版本下 patched MC 类 | `get_forge_minecraft_source`（§5.4） |
| 4. 搜索两类源码 | `search_forge_code` / `search_forge_minecraft_code`（§5.5） |
| 5. 首次生成后缓存、后续秒级 | nfrt 工件缓存 + `decompiled/` 目录缓存（§4.4） |
| 6. 与现有 `get_minecraft_source` 风格一致 | 全部薄包装，复用现有 handler/返回结构 |

---

## 1. 现状盘点（直接复用，不新写）

| 能力 | 位置 | 说明 |
|---|---|---|
| patched JAR 消费 | `src/services/decompile-service.ts:100-179` `decompileLocalJar(jarPath, version, mapping, onProgress)` | sources JAR → `extractSourcesJar` 直接解压；compiled JAR → VineFlower。**本方案产出的 sources zip 走解压 fast path（秒级、无反编译损耗）** |
| bytecode 注册 | `decompile-service.ts:200-214` `registerAsRemappedJar(jarPath, version, mapping)` | 把 compiled jar 拷到 `remapped/<version>-<mapping>.jar`，使 `validate_access_transformer` 走与 vanilla 完全相同的 bytecode 路径 |
| sources/compiled 判定 | `src/utils/jar-inspector.ts` | central-directory 扫描，`.class`→compiled、`.java`→sources |
| 读取/搜索/索引/对比 | tools.ts 各 handler | 对 patched 键透明（关键事实 2） |
| 强制重建 | `decompileService.forceClear(version, mapping)` | 已存在，`decompile_minecraft_version` 的 `force` 在用 |
| maven-metadata 解析 | `src/downloaders/fabric-maven.ts:106-124` | `/<version>([^<]+)<\/version>/g` 正则，无 XML 依赖，照抄即可 |
| HTTP 下载/重试 | `src/downloaders/http-client.ts` | `downloadFile` / `fetchText` / `fetchJson` |
| 工具 JAR 下载缓存 | `src/downloaders/java-resources.ts` | 版本常量 + `existsSync` + `downloadLocks`（进程内并发锁）模式；加一个 nfrt 条目即可 |
| Java CLI 包装模板 | `src/java/vineflower.ts` + `src/java/java-process.ts:44` `executeJavaProcess` | `nfrt.ts` 照 vineflower 结构抄；超时/内存/stderr/WSL 路径归一全现成 |
| TTL 元数据缓存模式 | `src/services/documentation-service.ts:141` | in-memory Map + `cachedAt` 时间戳 |
| 错误类 | `src/utils/errors.ts` | 统一继承 `MinecraftDevError` |
| CI 先例 | `.github/workflows/patched-jars.yml` | NeoForge 矩阵（1.20.4/1.21.1/1.21.4）已用 nfrt 1.0.30 跑通 `--dist joined --neoforge ...:userdev --write-result`（旧版 result 名 `compiledWithNeoForge`） |

**工具注册三件套**（全在 `src/server/tools.ts`，无 src/tools/ 目录）：zod schema（文件头）+ `tools` 数组手写 JSON Schema（与 zod 描述保持一致）+ handler + `handleToolCall` switch case。`index.ts` 与 CLI（`minecraft-dev-cli`）从同一 `tools` 数组自动派生，**不需要改**。

---

## 2. 数据源与版本解析

### 2.1 Forge

- 版本列表：`https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
  条目形如 `1.20.1-47.3.0` → `{mc: '1.20.1', build: '47.3.0'}`。用正则 `^(\d+(?:\.\d+){1,2})-(\d+\.\d+\.\d+)$` 过滤掉遗留怪条目，再按 `mc` 精确匹配过滤。
- recommended/latest：`https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`（2026-09 实测可用），形如 `"1.20.1-recommended": "47.4.10"`。
- 默认版本选择：`recommended ?? latest ?? 按 build 号最大`。

### 2.2 NeoForge

- 版本列表：`https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`（20.2.12-beta 起至 26.x）
- **版本 → MC 映射**（官方规则 docs.neoforged.net/docs/gettingstarted/versioning/），写成纯函数 + 单测：

```ts
// '20.2.12-beta' → '1.20.2'   '21.0.103-beta' → '1.21'   '21.1.72' → '1.21.1'
// '26.1.0.5-beta' → '26.1'    （Mojang calver 后 4 段）
function neoforgeToMc(v: string): string | null {
  const m = v.match(/^(\d+)\.(\d+)(?:\.\d+)?(?:\.\d+)?(?:-beta)?$/);
  if (!m) return null;                        // 3 段或 4 段
  const [, major, minor] = m;
  const seg4 = (v.match(/\./g) ?? []).length >= 3;
  if (seg4) return `${major}.${minor}`;       // calver：26.1.0.x → 26.1
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`;  // 21.0 → 1.21
}
```
  单测用已知对覆盖：`20.2.12-beta↔1.20.2`、`20.6.147↔1.20.6`、`21.0.103-beta↔1.21`、`21.1.72↔1.21.1`、`21.4.123↔1.21.4`、`26.1.0.5-beta↔26.1`。
- `-beta` 后缀 = 预发布，列表中标注 `prerelease: true`；默认版本取**最高稳定版**。
- 局限：早期 NeoForge（MC 1.20.1，`net.neoforged:forge:1.20.1-47.1.x` 工件）不在本元数据中 → 文档与工具描述注明「1.20.1 请用 Forge」。

### 2.3 NFRT 本体

- 坐标：`net.neoforged:neoform-runtime`（注意不是 `NeoFormRuntime`），fat jar 直链：
  `https://maven.neoforged.net/releases/net/neoforged/neoform-runtime/2.0.31/neoform-runtime-2.0.31-all.jar`
- 版本以 `NFRT_VERSION` 常量锁定（同 VineFlower/tiny-remapper 的做法）；自身需 **Java 21**（与 MC 1.21+ 的现有要求一致）。

---

## 3. NFRT 流水线（新工具 `decompile_forge_minecraft_version` 的核心）

### 3.1 命令

```
java -jar <nfrt.jar> run \
  --dist joined \
  --neoforge <完整GAV>:userdev \
  [--add-repository https://maven.minecraftforge.net] \        # 仅 Forge 需要
  --write-result=gameSourcesWithNeoForge:<out>-sources.jar \
  --write-result=gameJarWithNeoForge:<out>-recomp.jar
```

- NeoForge GAV：`net.neoforged:neoforge:<ver>:userdev`
- Forge GAV：`net.minecraftforge:forge:<mc>-<build>:userdev`
- result 名是 2.0.x 新名（1.x 叫 `sourcesWithNeoForge` / `compiledWithNeoForge`，CI 现用 1.0.30——若沿用 1.x 需换旧名；本方案锁定 2.0.31 用新名）。
- `gameSourcesWithNeoForge` 与 `gameJarWithNeoForge` 在 2.0.1 起标 deprecated 但仍存在——它们恰是唯一「loader 与 MC 合并」的结果，非 deprecated 的 `gameSources`/`gameJar` 不含 loader。风险见 §8。

### 3.2 产出消费（零新代码路径）

```
sources jar  → decompileLocalJar(sourcesJar, cacheKey, 'mojmap')   → extractSourcesJar 解压到 decompiled/<key>/mojmap/
recomp jar   → registerAsRemappedJar(recompJar, cacheKey, 'mojmap') → remapped/<key>-mojmap.jar（AT 校验可用）
```

`cacheKey = ${mcVersion}-${loader}-${loaderVersion}`（沿用现有约定，如 `1.21.1-neoforge-21.1.72`、`1.20.1-forge-47.3.0`）。

### 3.3 编排（`forge-source-service.ts`）

```
ensurePatchedSource(mc, loaderVer?, loader, force?):
  key = `${mc}-${loader}-${ver}`（ver 缺省经 §2 规则解析）
  if hasDecompiledSource(key,'mojmap') && !force → return 'ready'
  工件 = jars/patched/<key>/ 下的两个 jar
  if 工件缺失 → 跑 nfrt（executeJavaProcess：timeout 60min、maxMemory 4G、stderr 全量收集）
  force 时先 forceClear(key,'mojmap')
  decompileLocalJar(sourcesJar, ...) + registerAsRemappedJar(recompJar, ...)
  return 'built'
```

- **并发锁**：模块级 `Map<string, Promise>`（照抄 java-resources `downloadLocks`），同一 key 并发调用复用同一 in-flight promise，防止重复跑 nfrt。
- **force 语义**：清 `decompiled/` 目录后**优先从已缓存的 nfrt 工件重新解压**（秒级）；工件缺失才重跑 nfrt（分钟级）。nfrt 自身缓存在 `~/.neoformruntime`，二次构建也快。

### 3.4 失败处理

nfrt 非零退出 → `executeJavaProcess` 抛 `JavaProcessError`（含 stderr）→ 包装为带明确提示的错误：*"patched 源码生成失败（NeoForge/Forge 流水线）。可先用 decompile_minecraft_version 的 jarPath 手动路径"*。不存在"部分失败"状态（对比指南的 `partial`/`patchFailures`）。

---

## 4. 缓存布局（全部沿用现有结构，仅加一个子目录）

```
CACHE_DIR/
  decompiled/<mc>-<loader>-<loaderVer>/mojmap/   # patched 树（含 loader 源码）—— 现有约定
  remapped/<mc>-<loader>-<loaderVer>-mojmap.jar   # AT 校验用 bytecode —— 现有约定
  jars/patched/<mc>-<loader>-<loaderVer>/         # 新增：nfrt 双工件（sources + recomp jar）
    gameSourcesWithNeoForge.jar
    gameJarWithNeoForge.jar
  resources/neoform-runtime-2.0.31-all.jar        # 现有 resources/ 目录，新条目
```

版本列表缓存：进程内 TTL 24h（+ `forceRefresh` 参数），不落盘。
磁盘成本：每 patched 变体 ~250–400 MB（CLAUDE.md 已记载）+ nfrt 自身缓存 `~/.neoformruntime`。

---

## 5. 工具接口规格（7 个，注册进 `src/server/tools.ts` 三件套）

### 5.1 `list_forge_versions`（实体工具）

```ts
Input:  { mcVersion: string; loader?: 'forge'|'neoforge' /* default 'forge' */; forceRefresh?: boolean }
Output: { mcVersion, loader, versions: Array<{ loaderVersion: string /* '47.3.0'|'21.1.72' */;
          fullVersion: string /* cacheKey 形态 '1.20.1-forge-47.3.0' */; recommended?: boolean;
          prerelease?: boolean }>, source: 'maven'|'cache' }
```
实现：§2 的 forge-maven 服务。注意返回 `fullVersion` 直接就是下游工具要传的版本键，降低 LLM 用错率。

### 5.2 `decompile_forge_minecraft_version`（实体工具）

```ts
Input:  { mcVersion: string; loaderVersion?: string; loader?: 'forge'|'neoforge'; force?: boolean }
Output: { status: 'ready'|'built'; cacheKey; mapping: 'mojmap'; mode: 'extracted';
          outputDir; durationMs; loader; loaderVersion; mcVersion }
```
行为 = §3.3 编排。工具描述写明：首次运行需下载并执行 NFRT（Java 21，分钟级），之后缓存秒级。

### 5.3 `get_forge_source`（薄包装）

```ts
Input:  { mcVersion; loaderVersion?; loader?; className; startLine?; endLine?; maxLines? }
```
行为：解析 key → `ensurePatchedSource`（**懒加载：首次自动触发整条流水线**）→ `getClassSource(key, className, 'mojmap')`。
用途定位：读 `net.minecraftforge.*` / `net.neoforged.*` loader 类。
> 注：与指南不同，本工具读的就是 patched 树本身（loader 源码在其中），没有独立的 loader-src 数据源，也因此没有 `fromCache` 之外的 `patched: false` 回退语义。

### 5.4 `get_forge_minecraft_source`（薄包装）

输入/行为与 5.3 完全相同（同一内部函数），用途定位：读被 Forge/NeoForge patch 过的 `net.minecraft.*` 类。保留独立工具名是为了 LLM 调用意图清晰（指南契约）。

### 5.5 `search_forge_code` / `search_forge_minecraft_code`（薄包装 ×2）

```ts
Input:  { mcVersion; loaderVersion?; loader?; query: string; searchType?: 'class'|'method'|'field'|'content'|'all'; limit? }
```
行为：ensure → 委托 `search_minecraft_code` 的实现（handler `handleSearchMinecraftCode`，tools.ts:1268-1410；若不便直接复用，抽公共内部函数 `searchDecompiledTree(version, mapping, ...)` 供两者调用——这是本方案**唯一**的轻重构点）。两工具同树同实现，描述区分用途。

### 5.6 `compare_vanilla_vs_forge`（薄包装）

```ts
Input:  { mcVersion; loaderVersion?; loader?; className?: string }
```
行为：ensure → 无 `className` → 委托 `compare_versions`（from = mcVersion vanilla，to = cacheKey，category 'classes'）；有 `className` → 委托 `compare_versions_detailed`（AST 级）。
> 与指南差异：不输出文本 unified diff，用现有 AST 结构化 diff（对 LLM 更省 token）。需要纯文本 diff 时后续再评估 `diff` 依赖。

### 5.7 同步清单（新增工具必改）

- `__tests__/tools/cli.e2e.test.ts:32`：工具数断言 21 → **28**
- `docs/tools.md`（含首行计数与分组表）、`skills/minecraft-dev/references/tools.md`、`skills/minecraft-dev/SKILL.md`、`CLAUDE.md`（MCP Tools Reference）、`AGENTS.md`、`CHANGELOG.md`
- 顺带修一个已发现的不同步：docs/tools.md 的 `decompile_minecraft_version` 行未列 `jarPath` 参数

---

## 6. 文件级改动清单

| 文件 | 动作 | 预估 |
|---|---|---|
| `src/downloaders/forge-maven.ts` | **新增**：两 loader 的 maven-metadata 拉取/解析、neoforgeToMc 纯函数、promotions_slim、进程内 TTL、单例 `getForgeMaven()` | ~220 行 |
| `src/java/nfrt.ts` | **新增**：`NeoFormRuntimeWrapper`（ensureJar → executeJavaProcess，参数组装 §3.1），照 vineflower.ts 结构 | ~120 行 |
| `src/services/forge-source-service.ts` | **新增**：resolve / ensurePatchedSource / 并发锁 / force 语义，调用 decompileLocalJar + registerAsRemappedJar | ~170 行 |
| `src/downloaders/java-resources.ts` | 修改：`NFRT_VERSION='2.0.31'` + `getNfrtJar()`（锁 key `'nfrt'`） | +15 行 |
| `src/utils/paths.ts` | 修改：`paths` 对象加 `patchedJars: () => join(cacheDir, 'jars', 'patched')` | +2 行 |
| `src/utils/errors.ts` | 修改：`ForgeSourceError extends MinecraftDevError`（版本不存在/流水线失败） | +10 行 |
| `src/server/tools.ts` | 修改：7 组「zod schema + JSON Schema + handler + switch case」 | +~400 行 |
| `__tests__/services/forge-maven.test.ts` | **新增**：纯单测（fixture XML 字符串、neoforgeToMc 已知对表、forge 条目过滤、promotions 解析）——无网络 | ~150 行 |
| `__tests__/manual/forge/forge-pipeline.test.ts` | **新增**：env 门控（`FORGE_E2E=1`）E2E，见 §7 | ~220 行 |
| `__tests__/tools/cli.e2e.test.ts` | 修改：21 → 28 | 1 行 |
| 文档六处 | 修改：见 §5.7 | — |

新增代码合计约 **1300 行**（指南原方案含 patch 应用器、MCPConfig 服务、五套独立 get/search 逻辑与独立缓存布局，估计 3000+ 行）。所有本地 import 带 `.js` 后缀、保持 ESM（CLAUDE.md 约束）。

---

## 7. 测试计划

### 单元测试（无网络，`npm test` 自动拾取）
`__tests__/services/forge-maven.test.ts`：
- neoforgeToMc 已知对（§2.2 全表）+ 非法输入返回 null
- Forge metadata fixture：`1.20.1-47.3.0` 拆分、按 mc 过滤、遗留条目（如 `1.7.10_pre4-…`）被剔除
- promotions_slim fixture：recommended/latest 提取
- 默认版本选择（recommended ?? latest ?? 最高稳定）

### Manual E2E（需网络 + Java 21，`vitest --config vitest.manual.config.ts`，env 门控 `FORGE_E2E=1`；结构照抄 `__tests__/manual/patched/`）

| 用例 | 期望 |
|---|---|
| `decompile_forge_minecraft_version('1.21.1', loaderVersion '21.1.72', 'neoforge')` | status built/ready；`decompiled/1.21.1-neoforge-21.1.72/mojmap/` 有 >500 个 .java；`remapped/…jar` 存在 |
| `get_forge_source` 读 `net.neoforged.neoforge.event.entity.LivingHurtEvent` | 返回含 package 声明的源码 |
| `get_forge_minecraft_source` 读 `net.minecraft.world.entity.Entity` | 成功；且与 vanilla `get_minecraft_source('1.21.1', …)` 内容**存在可见 diff**（事件钩子） |
| `search_forge_code('LivingHurtEvent')` | 命中 loader 包 |
| `validate_access_transformer`（patched key + `public net.minecraft.world.entity.Entity`） | 走 bytecode 通过（复用 patched 套件已验证路径） |
| Forge 同构：`1.20.1` / `47.3.0`（读 `net.minecraftforge.event.entity.living.LivingHurtEvent`） | **首次实测 NFRT-forge 路径**；失败则按 §8 风险预案处理 |
| 非法版本组合 | `ForgeSourceError`，消息提示先调 `list_forge_versions` |

### 回归
现有 29 个集成测试不受影响（不触碰任何现有工具行为）；`decompile_minecraft_version` 的手动 `jarPath` 路径与 CI patched 套件**原样保留**（永久兜底）。

---

## 8. 风险与预案

| 风险 | 预案 |
|---|---|
| **NFRT-forge 路径仓库内未实测**（官方 build.gradle 示例 + changelog 背书） | 执行清单第 7 步专门实测；若失败：Forge 报错并提示手动 `jarPath` 路径，NeoForge 不受影响；绝不引入 Gradle/FG6 进 MCP server |
| `*WithNeoForge` 结果 2.0.1 起标 deprecated | `NFRT_VERSION` 常量锁定 2.0.31；升级时 manual 测试把关；NFRT 3.0 若移除再迁移 |
| nfrt 首跑分钟级、磁盘占用大 | 工具描述与 README 写明（~250–400MB/变体 + `~/.neoformruntime`）；`jars/patched/` 工件支持秒级 force 重建 |
| NeoForge 版本映射规则遇到未知新形态 | 纯函数返回 null → 该条目跳过并在列表 source 注记；规则更新有官方文档背书 + 单测已知对表 |
| nfrt 需 Java 21 | 启动时已有 `verifyJavaVersion`；工具描述注明 |
| `searchDecompiledTree` 轻重构影响现有 `search_minecraft_code` | 行为不变、现有集成测试覆盖 |

---

## 9. 实施顺序（执行清单）

1. `forge-maven.ts` + 单测（纯函数先行，无网络即可全绿）
2. `java-resources.ts` 加 nfrt 条目 + `nfrt.ts` 包装
3. `forge-source-service.ts`（编排 + 锁 + force）
4. tools.ts 注册 `list_forge_versions` + `decompile_forge_minecraft_version`；更新 cli.e2e 计数（21→23 此刻改一次，第 6 步再改到 28——或最后一次性改，避免两次碰同一断言）
5. Manual 实测 NeoForge 1.21.1 全链路（§7 表前 5 行）
6. 5 个薄包装工具（含懒加载与 `searchDecompiledTree` 抽取）+ 计数 28
7. Manual 实测 Forge 1.20.1（NFRT-forge 首测）
8. 文档六处同步 + CHANGELOG + README「Common Workflows」新增：`list_forge_versions → decompile_forge_minecraft_version → get_forge_source` / `compare_vanilla_vs_forge`
9. （可选后续）CI：`.github/workflows/patched-jars.yml` 增加新工具直跑路径，评估用其替代 FG6 fixture

---

## 10. 参考链接（调研来源）

- NFRT 仓库/README/changelog：https://github.com/neoforged/NeoFormRuntime ；https://maven.neoforged.net/releases/net/neoforged/neoform-runtime/2.0.31/neoform-runtime-2.0.31-changelog.txt
- NFRT 官方 Forge 工件示例（其 build.gradle IDE run 配置，含 `--add-repository` 与 `--write-result` 用法）：https://raw.githubusercontent.com/neoforged/NeoFormRuntime/main/build.gradle
- NFRT CLI 源码（result 注入逻辑 `createSourcesWithNeoForge`）：src/main/java/net/neoforged/neoform/runtime/cli/RunNeoFormCommand.java
- NeoForge 版本规则：https://docs.neoforged.net/docs/gettingstarted/versioning/
- NeoForge Maven 元数据：https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml
- Forge promotions：https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json
- NeoForge moddev-config（单版本→MC 映射的机器可读佐证，如 `--fml.mcVersion`）：https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.72/neoforge-21.1.72-moddev-config.json
- 本仓库既有 patched 流程文档：CLAUDE.md「Patched MC JARs」「Sources-vs-compiled detection」节、`.github/workflows/patched-jars.yml`、`__tests__/manual/patched/`

---

**文档版本**：1.0（2026-09-26）
**范围**：Forge + NeoForge patched MC 源码与 loader 本体源码的查看/搜索/对比；MC 1.17+（NeoForge 20.2+），mojmap-only
**前置要求**：Java 21；首跑需网络访问 maven.neoforged.net / maven.minecraftforge.net / piston-meta.mojang.com
