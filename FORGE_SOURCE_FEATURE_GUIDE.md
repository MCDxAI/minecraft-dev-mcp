# Minecraft Dev MCP — Forge 源码功能实现指导文档

> 目标：为 [minecraft-dev-mcp](https://github.com/MCDxAI/minecraft-dev-mcp) 增加  
> **A. Forge-patched Minecraft 源码** + **B. Forge / NeoForge 本体源码** 的查看与搜索能力。  
> 版本范围：**Minecraft 1.14+**（1.17+ 优先完整支持）。

---

## 1. 背景与目标

### 1.1 现状

现有工具已覆盖：

- 原版 Minecraft 反编译 / 映射（Yarn、Mojmap）
- 第三方模组 JAR 分析与反编译
- Mixin / Access Widener / Access Transformer 校验

尚未覆盖：

| 类型 | 说明 |
|------|------|
| **Forge-patched MC** | 模组开发者在 IDE 中看到的、被 Forge 打过补丁的 Minecraft 源码 |
| **Forge 本体** | `net.minecraftforge.*` / `net.neoforged.*` 加载器与 API 源码 |

### 1.2 为什么需要 patched 源码

Forge 开发环境中的 Minecraft 源码流水线：

```
原版 JAR
  → 反编译
  → MCPConfig patches（修复 decompiler、保证可编译）
  → Access Transformers
  → Forge patches（注入事件、钩子、API）
  → 模组开发者看到的最终源码
```

仅看纯原版无法准确理解事件注入点、被修改的 vanilla 行为。

### 1.3 成功标准

1. 能按 MC 版本列出可用 Forge / NeoForge 版本  
2. 能读取任意 `net.minecraftforge.*`（及 NeoForge）类源码  
3. 能读取对应 Forge 版本下、已 patch 的 Minecraft 类源码  
4. 能搜索上述两类源码  
5. 首次生成后缓存，后续秒级读取  
6. 与现有 `get_minecraft_source` 等工具风格一致  

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Tools                             │
│  list_forge_versions                                         │
│  get_forge_source / search_forge_code                        │
│  decompile_forge_minecraft_version                           │
│  get_forge_minecraft_source / search_forge_minecraft_code    │
│  compare_vanilla_vs_forge (可选)                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     Services Layer                           │
│  ForgeVersionResolver   ForgeLoaderSourceService             │
│  McpConfigService       ForgePatchService                    │
│  PatchedMinecraftService  (编排反编译 + 补丁应用)            │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  Cache: CACHE_DIR/forge/... + 现有 decompiled/...            │
│  数据源: GitHub / Forge Maven / MCPConfig / NeoForge Maven   │
└─────────────────────────────────────────────────────────────┘
```

### 建议目录结构

```
src/
  tools/
    forge/
      list_versions.ts
      get_forge_source.ts
      search_forge_code.ts
      decompile_forge_minecraft.ts
      get_forge_minecraft_source.ts
      search_forge_minecraft_code.ts
      compare_vanilla_vs_forge.ts      # 可选 Phase 3
  services/
    forge/
      version_resolver.ts            # MC ↔ Forge/NeoForge 版本解析
      loader_source.ts               # Forge/NeoForge 本体源码
      mcpconfig.ts                   # MCPConfig 下载与解析
      patches.ts                     # patch 下载与应用
      patched_minecraft.ts           # 编排 patched MC 流水线
      types.ts
      constants.ts
  cache/
    forge_paths.ts                   # 缓存路径约定
```

---

## 3. 缓存布局

```
CACHE_DIR/
  forge/
    <loader>/                        # forge | neoforge
      <mcVersion>/
        <forgeVersion>/
          meta.json                  # 元数据、来源、时间戳
          loader-src/                # 本体源码树 (net/minecraftforge/...)
          patched-mc/
            mojmap/                  # 已 patch 的 Minecraft 源码
          patches/
            mcpconfig/               # 本版本用到的 MCPConfig patches 副本
            forge/                   # Forge patches 副本
          logs/
            patch-failures.json      # 应用失败的文件列表
  mcpconfig/
    <mcVersion>/
      config.json
      patches/                       # 从 MCPConfig 拉下来的补丁
  version-index/
    forge-metadata.json              # 缓存的版本列表，减少网络请求
    neoforge-metadata.json
```

`meta.json` 示例：

```json
{
  "loader": "forge",
  "mcVersion": "1.20.1",
  "forgeVersion": "47.3.0",
  "fullVersion": "1.20.1-47.3.0",
  "mapping": "mojmap",
  "loaderSource": "github",
  "loaderSourceRef": "1.20.1-47.3.0",
  "patchedMcStatus": "complete",
  "patchFailures": [],
  "createdAt": "2026-09-26T12:00:00.000Z",
  "updatedAt": "2026-09-26T12:05:00.000Z"
}
```

---

## 4. 数据源与获取策略

### 4.1 版本列表（list_forge_versions）

**Forge**

1. 优先：Forge Maven metadata  
   - `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
2. 解析 `<version>` 中形如 `1.20.1-47.3.0` 的条目，按 `mcVersion` 过滤
3. 备用：GitHub `MinecraftForge/MinecraftForge` tags API

**NeoForge**

1. `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`
2. 版本格式可能为 `20.1.x` / `21.1.x`（与 MC 大版本对应，需维护映射表或从 POM/元数据解析 MC 版本）

**缓存策略**

- 将解析结果写入 `version-index/*.json`，TTL 建议 12–24 小时
- 提供 `forceRefresh` 参数强制刷新

### 4.2 Forge / NeoForge 本体源码

**优先级**

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1 | Maven `-sources.jar` | 下载快、结构稳定 |
| 2 | GitHub tag + sparse/raw | sources 缺失时使用 |
| 3 | 反编译 userdev/universal JAR | 最后手段，质量差 |

**Maven 坐标示例**

```
net.minecraftforge:forge:1.20.1-47.3.0:sources
```

URL 形态：

```
https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-sources.jar
```

**GitHub**

- 仓库：`https://github.com/MinecraftForge/MinecraftForge`
- Tag：通常与 Maven 全版本一致，如 `1.20.1-47.3.0`
- 主要路径：`src/main/java`

实现建议：

1. 尝试下载 sources JAR → 解压到 `loader-src/`
2. 失败则用 GitHub API 按 tag 拉树，或 `git clone --depth 1 --branch <tag>`（注意服务器是否允许 git）
3. 单类读取：优先从已解压目录读文件；未缓存时也可按路径拼 raw URL（注意 rate limit）

### 4.3 MCPConfig patches

- 仓库：https://github.com/MinecraftForge/MCPConfig
- 典型路径：`versions/release/<mcVersion>/` 或 `versions/<mcVersion>/`
- 需要的内容：
  - `config.json`（流水线描述，可选）
  - `patches/`（client / server / joined / shared）

获取方式：

1. GitHub raw / archive API 按路径下载该版本目录
2. 或 clone 后只保留需要的 `versions/...`（体积较大，更适合开发机预热）

缓存到：`CACHE_DIR/mcpconfig/<mcVersion>/`

### 4.4 Forge patches（打在 MC 上的补丁）

**优先级**

1. **userdev 产物中的 patches**  
   - Forge userdev ZIP/JAR 内常有 `patches.zip` 或 `patches/`  
   - 坐标示例：`net.minecraftforge:forge:1.20.1-47.3.0:userdev`
2. **GitHub 仓库中的 patches 目录**（随 FG/版本结构变化）
3. **已发布的预构建 sources**（若存在完整 patched 源码树，可直接当结果用）

注意：不同大版本（FG3 / FG4 / FG5 / FG6）产物布局不同，`version_resolver` + `patches` 服务里要用版本分支逻辑。

---

## 5. Patched Minecraft 流水线

### 5.1 输入

- `mcVersion`（必填）
- `forgeVersion`（可选，默认该 MC 最新稳定）
- `loader`：`forge` | `neoforge`（默认 `forge`）
- `force`：是否强制重建

### 5.2 步骤

```
1. 解析完整版本号 (mc + forge)
2. 确保原版 mojmap 源码已存在
   → 调用现有 decompile / get 逻辑，映射固定为 mojmap
3. 下载并缓存 MCPConfig patches
4. 下载并缓存 Forge (或 NeoForge) patches
5. 复制原版 mojmap 源码树到工作目录
6. 按顺序应用 patches：
   a. MCPConfig (joined 优先，其次 client/server 策略见下)
   b. Forge patches
7. 记录成功/失败文件 → patch-failures.json
8. 将结果移入 patched-mc/mojmap/
9. 更新 meta.json
```

### 5.3 映射策略（1.14+）

| MC 版本 | 策略 |
|---------|------|
| **1.17+** | 仅 **mojmap**，完整支持 |
| **1.14–1.16** | Forge 本体完整支持；patched MC 标为 experimental，能 apply 多少算多少 |

不要强行对 Forge 环境做 Yarn；现代 Forge 工具链以 official/mojmap 为准。

### 5.4 Patch 应用实现要点

- 使用成熟库处理 **unified diff**（注意 `\ No newline at end of file`、路径前缀 `a/` `b/`、`---`/`+++`）
- 路径映射：patch 内路径可能是 `net/minecraft/...java`，需对齐到源码树根
- **fuzz**：允许少量上下文偏移，提高成功率
- 失败策略：
  - 单文件失败不中断整次任务
  - 失败列表写入 `patch-failures.json`
  - `get_forge_minecraft_source` 若目标文件失败，可回退原版并在结果中标注 `patched: false`

### 5.5 与原版缓存的关系

- **不要**覆盖 `decompiled/<version>/mojmap/`
- patched 结果独立存放在 `forge/.../patched-mc/mojmap/`
- 可选工具 `compare_vanilla_vs_forge`：对同一 class 做 unified diff

---

## 6. 工具接口规范

以下为 MCP tool 层建议契约（TypeScript 风格）。

### 6.1 list_forge_versions

```ts
Input: {
  mcVersion: string;                    // "1.20.1"
  loader?: "forge" | "neoforge";      // default "forge"
  forceRefresh?: boolean;
}
Output: {
  mcVersion: string;
  loader: "forge" | "neoforge";
  versions: Array<{
    forgeVersion: string;               // "47.3.0"
    fullVersion: string;                // "1.20.1-47.3.0"
    recommended?: boolean;
  }>;
  source: "maven" | "github" | "cache";
}
```

### 6.2 get_forge_source

```ts
Input: {
  mcVersion: string;
  forgeVersion?: string;
  loader?: "forge" | "neoforge";
  className: string;                    // "net.minecraftforge.event.entity.living.LivingHurtEvent"
  startLine?: number;
  endLine?: number;
  maxLines?: number;
}
Output: {
  className: string;
  path: string;
  source: string;
  loader: string;
  mcVersion: string;
  forgeVersion: string;
  fromCache: boolean;
}
```

### 6.3 search_forge_code

```ts
Input: {
  mcVersion: string;
  forgeVersion?: string;
  loader?: "forge" | "neoforge";
  query: string;
  searchType?: "class" | "method" | "field" | "content" | "all";
  limit?: number;
}
```

行为对齐现有 `search_minecraft_code`。

### 6.4 decompile_forge_minecraft_version

```ts
Input: {
  mcVersion: string;
  forgeVersion?: string;
  loader?: "forge" | "neoforge";
  force?: boolean;
}
Output: {
  status: "ready" | "built" | "partial";
  mcVersion: string;
  forgeVersion: string;
  mapping: "mojmap";
  patchFailures: string[];              // 相对路径列表
  cachePath: string;
  durationMs: number;
}
```

首次可能耗时数分钟，需在工具描述中说明。

### 6.5 get_forge_minecraft_source

```ts
Input: {
  mcVersion: string;
  forgeVersion?: string;
  loader?: "forge" | "neoforge";
  className: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
  showDiff?: boolean;                   // 与纯原版对比
}
Output: {
  className: string;
  source: string;
  patched: boolean;                     // 该文件是否成功应用了 patch
  diff?: string;                        // showDiff 时返回
  // ... 版本元数据同 get_forge_source
}
```

若尚未执行 `decompile_forge_minecraft_version`，本工具应 **自动触发** 流水线（与现有 `get_minecraft_source` 懒加载一致）。

### 6.6 search_forge_minecraft_code

参数与 `search_forge_code` 类似，目标目录为 `patched-mc/mojmap/`。

### 6.7 compare_vanilla_vs_forge（可选）

```ts
Input: {
  mcVersion: string;
  forgeVersion?: string;
  className: string;
}
Output: {
  className: string;
  vanillaPath: string;
  patchedPath: string;
  diff: string;                         // unified diff
  patched: boolean;
}
```

---

## 7. 实现阶段与优先级

### Phase 1 — Forge 本体（先交付价值）

**范围**

- [ ] `version_resolver.ts`（Forge Maven + 缓存）
- [ ] `list_forge_versions`
- [ ] `loader_source.ts`（sources JAR → 解压 → 读文件）
- [ ] `get_forge_source`
- [ ] `search_forge_code`（先做文件系统正则/简单扫描，FTS 可后置）
- [ ] 注册工具、文档、CLI flags
- [ ] 基础测试：1.20.1、1.21.1 各一个稳定版

**验收**

- 指定 `mcVersion` + `className` 能返回可读 Java 源码  
- 版本列表与 Maven 一致  

### Phase 2 — Patched MC（1.17+ 样板）

**范围**

- [ ] 复用现有 mojmap 反编译
- [ ] MCPConfig 下载与缓存
- [ ] Forge userdev / patches 下载
- [ ] patch 应用器 + 失败记录
- [ ] `decompile_forge_minecraft_version`
- [ ] `get_forge_minecraft_source`（含懒加载）
- [ ] 以 **1.20.1** 为黄金样板跑通，再扩 1.18 / 1.19 / 1.21

**验收**

- 至少一个被 Forge 修改过的类（如带 Event 调用的 Entity 相关类）与纯原版有可见 diff  
- 失败文件列表可查，不导致整次任务崩溃  

### Phase 3 — 搜索、对比、NeoForge、老版本

- [ ] patched MC 与 loader 的 FTS 索引（复用现有 SQLite FTS5 模式）
- [ ] `compare_vanilla_vs_forge`
- [ ] NeoForge 全流程对齐
- [ ] 1.14–1.16 best-effort + 文档标明限制
- [ ] 更多集成测试与错误信息打磨

### Phase 4 — 文档与体验

- [ ] 更新 `docs/tools.md`、README「Common Workflows」
- [ ] CLI：`minecraft-dev-cli list-tools` 可见新工具
- [ ] Troubleshooting：版本不存在、patch 部分失败、GitHub rate limit、磁盘空间

---

## 8. 关键实现细节

### 8.1 版本解析伪代码

```ts
async function resolveForgeVersion(mcVersion: string, forgeVersion?: string, loader = "forge") {
  const list = await getForgeVersionsForMc(mcVersion, loader); // 带缓存
  if (list.length === 0) throw new Error(`No ${loader} versions for MC ${mcVersion}`);
  if (!forgeVersion) {
    return list.find(v => v.recommended) ?? list[0];
  }
  const hit = list.find(v => v.forgeVersion === forgeVersion || v.fullVersion === forgeVersion);
  if (!hit) throw new Error(`Version not found: ${forgeVersion}`);
  return hit;
}
```

### 8.2 懒加载模式（与现有一致）

```ts
async function ensureLoaderSource(ctx) { /* 无则下载解压 */ }
async function ensurePatchedMc(ctx) {
  if (cacheReady && !force) return;
  await ensureVanillaMojmap(ctx.mcVersion);
  await ensureMcpConfigPatches(ctx.mcVersion);
  await ensureForgePatches(ctx);
  await applyPatches(ctx);
  writeMeta(ctx);
}
```

`get_*` 工具入口先 `ensure*`，再读文件。

### 8.3 错误类型（建议统一）

| 错误 | 含义 | 用户提示方向 |
|------|------|----------------|
| `VERSION_NOT_FOUND` | 无此 Forge/MC 组合 | 检查 list_forge_versions |
| `SOURCES_UNAVAILABLE` | 无 sources JAR 且 GitHub 失败 | 换版本或稍后重试 |
| `PATCH_PARTIAL` | 部分文件失败 | 结果仍可用，见 patch-failures |
| `VANILLA_REQUIRED` | 原版反编译失败 | 先修 Java/磁盘/网络 |
| `RATE_LIMITED` | GitHub API 限流 | 使用 Maven 或设置 token（可选 env） |

### 8.4 环境变量（可选扩展）

| 变量 | 用途 |
|------|------|
| `CACHE_DIR` | 已有，继续使用 |
| `GITHUB_TOKEN` | 提高 GitHub API 限额（可选） |
| `FORGE_MAVEN_URL` | 覆盖默认 Maven 地址（镜像） |
| `LOG_LEVEL` | 已有 |

### 8.5 性能与体积

- 每个 Forge 版本：本体源码约数十 MB；patched MC 与原版 decompiled 同量级（约数百 MB 级，视版本而定）
- 首次 patched 生成：下载补丁 + apply，可能 1–5+ 分钟，工具描述必须写明
- 并行：同一 `mc+forge` 的 ensure 加文件锁 / in-memory lock，避免重复构建

### 8.6 安全与合规

- 仅本地缓存，不向公网再分发 Mojang 源码
- MCPConfig / Forge 源码遵循其许可证使用
- 不执行不可信 patch 内容之外的脚本；只做文本 patch 应用

---

## 9. 测试计划

### 单元测试

- 版本字符串解析（`1.20.1-47.3.0`）
- unified diff 应用：正常 / 上下文偏移 / 失败回退
- 缓存路径与 `meta.json` 读写

### 集成测试（需网络 + Java，可标为 manual）

| 用例 | 期望 |
|------|------|
| list 1.20.1 | 返回多个 47.x 版本 |
| get_forge_source LivingHurtEvent | 返回含 package/class 的源码 |
| decompile_forge_minecraft 1.20.1 | status ready/partial，缓存目录有 java 文件 |
| get_forge_minecraft_source Entity | 与 get_minecraft_source 同路径类可对比 |
| 非法版本 | 明确错误码与消息 |

### 回归

- 现有 21 个工具行为不变
- 原版 `decompiled/` 不被写入 patch 结果

---

## 10. 文档应补充的用户工作流

在 README / tools 文档中增加：

**查看 Forge API**

```
list_forge_versions → get_forge_source(className)
```

**查看 Forge 修改过的 MC 代码**

```
get_forge_minecraft_source(mcVersion, className)
# 首次自动 decompile + patch，之后走缓存
```

**对比原版与 Forge**

```
get_minecraft_source + get_forge_minecraft_source
# 或 compare_vanilla_vs_forge
```

**分析模组 + Forge 行为**

```
analyze_mod_jar → get_forge_source / get_forge_minecraft_source
```

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 各年代 userdev 布局不一致 | 按 MC 大版本分支解析；先 1.20.1 样板 |
| Patch 大量失败 | partial 状态 + 失败列表 + 单文件回退原版 |
| GitHub rate limit | 优先 Maven；可选 GITHUB_TOKEN |
| 磁盘占用 | 文档说明；支持按版本清理缓存 |
| NeoForge 版本号与 MC 映射复杂 | Phase 3 单独做映射表 + 测试矩阵 |
| 1.14–1.16 映射混用 | 明确 experimental，不阻塞 1.17+ |

---

## 12. 建议开工顺序（执行清单）

1. 读现有 `src/tools` 与 decompile 服务的注册方式，照抄模式建 `tools/forge/`  
2. 实现 `version_resolver` + `list_forge_versions` + 缓存  
3. 实现 sources JAR 下载解压 + `get_forge_source`  
4. 简单 `search_forge_code`  
5. 接 CLI 与 MCP 注册、写最小文档  
6. 实现 patch 应用库封装 + MCPConfig/Forge patches 下载  
7. 打通 1.20.1 patched 流水线  
8. `get_forge_minecraft_source` 懒加载  
9. 扩展版本与 NeoForge、FTS、diff 工具  

---

## 13. 参考链接

- 本仓库：https://github.com/MCDxAI/minecraft-dev-mcp  
- 工具参考：仓库内 `docs/tools.md`  
- MCPConfig：https://github.com/MinecraftForge/MCPConfig  
- MinecraftForge：https://github.com/MinecraftForge/MinecraftForge  
- Forge Maven：https://maven.minecraftforge.net/  
- NeoForge Maven：https://maven.neoforged.net/  
- Forge 工具链说明（社区）：https://forge.gemwire.uk/（Toolchain 相关页面）  

---

## 14. 附录：类名与路径转换

```ts
function classNameToPath(className: string): string {
  // net.minecraftforge.event.ForgeEventFactory
  // → net/minecraftforge/event/ForgeEventFactory.java
  return className.replace(/\./g, "/") + ".java";
}
```

内部类：`Outer$Inner` → 通常仍在 `Outer.java` 中，搜索时按文件读全文件再定位，或按 decompiler 输出约定处理。

---

**文档版本**：1.0  
**适用项目**：MCDxAI/minecraft-dev-mcp  
**范围**：Forge + NeoForge 本体源码；Forge-patched Minecraft 源码（1.14+，1.17+ 优先）
