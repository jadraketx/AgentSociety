# AI Social Scientist

[![VS Code Version](https://img.shields.io/badge/VS%20Code-1.120%2B-blue)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

AI Social Scientist 是 LLM 驱动的智能自主社会科学研究智能体，提供完整的 VSCode 插件支持。

## 核心能力

- **学术文献检索** - 经 MCP 网关的多源学术文献搜索与管理
- **Agent 模拟实验** - 基于 AgentSociety2 的智能体模拟
- **实验配置与执行** - 可视化配置、一键运行
- **数据总结与分析** - LLM 驱动的数据分析与报告生成

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    VSCode 插件                          │
├─────────────────────────────────────────────────────────┤
│  项目结构视图  │  技能市场  │  配置页面  │  回放视图   │
├─────────────────────────────────────────────────────────┤
│                 本地 FastAPI 后端服务                   │
├─────────────────────────────────────────────────────────┤
│         AgentSociety2 核心模拟框架                      │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- Node.js ^22.13.0 或 >=24（与 `package.json` 的 `engines.node`、`.nvmrc` 一致）
- Python >= 3.11
- uv (Python 包管理器)
- VSCode >= 1.120.0

### 安装步骤

1. **安装插件依赖**

   ```bash
   cd extension
   npm install
   ```

2. **编译插件**

   ```bash
   npm run build
   ```

3. **配置（推荐：在插件内完成）**

   启动扩展后，使用命令 **「AI Social Scientist: 打开配置」** 打开统一配置页：

   - **默认 LLM**（必填）：API Key / API Base / Model
   - **高级配置**：专用模型（Coder / Embedding）、Python 环境、学术文献检索（MCP）、Claude Code & Codex 网关路由
   - 顶部概览卡片显示后端与各项验证状态；点击「高级配置」可一键验证

   配置写入**当前工作区**的 `.env`（常见路径 `agentsociety/.env`）。

   Claude Code 与 Codex 网关配置通过 **「AI Social Scientist: Claude Code 配置（配置页）」** 直接打开同一页面的 Claude / Codex 路由面板。

   你也可以直接打开帮助页（命令 **「AI Social Scientist: 使用指南」**）查看快速入门。

4. **启动后端服务（推荐：状态栏一键）**

   建议正常启动后端，这样 Agent 技能管理、模块探测与预填参数、自定义模块扫描/测试、回放 API、API 文档等能力都能直接使用。若后端暂未启动，你仍然可以编辑实验配置、查看本地文件、整理文献索引，或通过 CLI / Claude Code 按工作区配置运行实验。

   ```bash
   cd packages/agentsociety2
   uv run python -m agentsociety2.backend.run
   ```

   更推荐在 VSCode 内点击状态栏 Backend 图标，或运行命令 **“AI Social Scientist: 后端状态菜单”** 进行启动/停止/查看日志。

   - 插件启动后端时会**优先使用工作区 `.env` 的 `BACKEND_PORT`**；若端口占用，会**自动选择一个可用端口**并写回 `.env`。
   - 如果你是**在终端手动启动**后端，请确保工作区 `.env` 中的 `BACKEND_PORT=port`，插件才会按该端口进行健康检查与连接。

5. **调试插件**

   - 在 VSCode 中打开 `extension` 文件夹
   - 按 `F5` 启动调试

## 功能特性

### 项目结构管理

```
workspace/
├── TOPIC.md                    # 研究话题
├── papers/                     # 论文目录
│   ├── literature_index.json   # 文献索引
│   ├── pdf/                    # PDF 文献
│   └── md/                     # Markdown 笔记
├── paper/                      # 论文工作区（paper-toolkit）
│   ├── sections/               # 论文章节
│   ├── reviews/                # 审稿意见（右键查看结构化 review）
│   └── compile_runs/           # 编译产物
├── hypothesis_xxx/             # 假设目录
│   ├── HYPOTHESIS.md          # 假设描述
│   └── experiment_xxx/        # 实验目录
│       ├── init/              # 初始化配置
│       └── run/               # 运行结果
└── .agentsociety/              # 分析 harness 机器状态
```

### 可视化文件查看器

| 文件类型              | 功能                                     |
| --------------------- | ---------------------------------------- |
| JSON                  | 语法高亮、折叠展开、搜索、复制           |
| YAML                  | 语法高亮、时间线视图                     |
| pid.json              | 实验状态监控、自动刷新                   |
| literature_index.json | 文献列表、搜索、批量操作                 |
| Paper Review          | 结构化审稿意见查看（维度、阻塞项、评分） |
| Evidence Graph        | 分析证据关系可视化                       |

### AI CLI Gateway

本地代理网关，将 Claude Code / Codex CLI 请求经第三方供应商路由转发。

**核心能力**：
- **多供应商管理**：统一管理 Anthropic 和 OpenAI 兼容供应商，支持 Claude Code 和 Codex 双路由
- **格式转换**：自动将 Anthropic Messages 请求转换为 OpenAI Chat Completions（支持 thinking/reasoning 和 tool_use），将 Codex Responses 请求转换为 Chat Completions
- **模型映射**：自动将 Claude 角色模型名（sonnet/opus/haiku/fable）映射为供应商模型名，剥离 `[1M]` 等本地标记
- **故障转移**：支持多供应商优先级排序和断路器保护，失败后自动切换
- **用量追踪**：按天展示请求趋势，区分 Claude 与 Codex 来源，支持 7/30/全部 天筛选
- **成本估算**：内置 + 远程 + 自定义模型定价，缓存读写费用独立计算
- **状态栏集成**：实时显示 Gateway 路由状态，支持一键重启 Codex

### 文件查看器

- **JSON 查看器**：语法高亮、可折叠树形、搜索、复制
- **YAML 查看器**：语法高亮、可折叠树形、搜索、复制为 JSON
- **CSV 查看器**：表头固定、列排序、搜索过滤、复制 CSV
- **Markdown 预览**：侧边栏点击 `.md` 文件直接预览
- **HTML 报告**：使用 Live Preview 或默认浏览器打开
- 论文工作区和分析工作区的文件均支持一键打开对应查看器

### 技能管理

- **Agent 技能** - 安装到 `custom/skills`
- **Claude 技能** - 安装到 `.claude/skills`
- 支持从 GitHub 仓库安装
- 支持本地自定义开发

### 后端服务管理

- 状态栏实时显示服务状态和端口
- 一键启动/停止/重启
- 快速打开 API 文档
- 复制服务 URL

建议在日常使用中启动后端，获得完整插件体验。需要本地 API 的交互功能依赖后端，例如 Agent 运行时技能管理、模块探测与预填参数、自定义模块扫描/测试、回放 Webview 和 API 文档。本地文件类能力不依赖后端，例如项目树浏览、Markdown/PDF/CSV/图片打开、配置文件编辑、文献索引预览、工作区导出。实验本身也可以由 AgentSociety2 CLI 或 Claude Code 在工作区中直接运行；此时关键依赖是 `.env`、Python 环境和实验配置。

## 配置说明

### 插件设置

| 设置项                                | 说明                                         | 默认值   |
| ------------------------------------- | -------------------------------------------- | -------- |
| `aiSocialScientist.backend.autoStart` | 插件启动时自动启动本地后端；日常使用建议开启 | `false`  |
| `aiSocialScientist.chat.viewColumn`   | Chat 面板位置                                | `beside` |
| `agentSkills.githubToken`             | GitHub Token (可选)                          | `""`     |
| `agentSkills.skillSources`            | Agent 技能源                                 | `[]`     |
| `agentSkills.claudeSkillSources`      | Claude 技能源                                | 内置列表 |

### 环境变量

工作区 `.env` 主要项（完整列表见 [ReadTheDocs](https://agentsociety2.readthedocs.io/zh_CN/latest/) 或配置页）：

| 变量 | 说明 |
| ---- | ---- |
| `AGENTSOCIETY_LLM_API_KEY` / `_BASE` / `_MODEL` | 默认 LLM（必填） |
| `LITERATURE_SEARCH_MCP_URL` | 学术文献检索 MCP 网关，如 `https://llmapi.fiblab.net/mcp/` |
| `LITERATURE_SEARCH_API_KEY` | 文献 MCP 鉴权 Key |
| `PYTHON_PATH` | Python 解释器（留空则自动检测） |
| `BACKEND_PORT` | 本地后端端口 |

Claude Code 的 API Key / Base URL / 模型映射在配置页 **高级 → Claude Code** 中编辑，保存到 `~/.claude/settings.json`。

## 开发指南

### 项目结构

```
extension/
├── src/
│   ├── extension.ts              # 扩展入口
│   ├── configPageViewProvider.ts  # 配置页 Webview 宿主
│   ├── projectStructureProvider.ts # 项目树视图
│   ├── services/                 # 服务层
│   │   ├── aiCliGateway.ts       # HTTP 代理核心（路由、格式转换、上游转发）
│   │   ├── aiCliGatewayManager.ts # 供应商生命周期、用量追踪、故障转移
│   │   ├── anthropicOpenAiBridge.ts # Anthropic Messages ↔ OpenAI Chat 格式转换
│   │   ├── codexResponsesBridge.ts # Codex Responses ↔ OpenAI Chat 格式转换
│   │   ├── anthropicModelMapping.ts # Claude 角色模型名 → 供应商模型名映射
│   │   ├── codexModelMapping.ts   # Codex 模型名 → 供应商模型名映射
│   │   ├── gatewayFailover.ts     # 故障转移：断路器、优先级排序
│   │   ├── gatewayUsageTracker.ts # Token 用量提取与聚合
│   │   ├── gatewayModelPricing.ts # 模型定价与成本计算
│   │   ├── gatewayRemotePricing.ts # 远程定价数据拉取与缓存
│   │   ├── gatewayProviderUsage.ts # 供应商配额查询（按供应商适配）
│   │   ├── claudeCodeSettings.ts  # ~/.claude/settings.json 读写
│   │   ├── claudeCodeModels.ts    # 模型列表拉取
│   │   ├── codexSettings.ts       # Codex 配置读写
│   │   ├── codexApiFormat.ts      # OpenAI API 格式检测
│   │   ├── backendService.ts      # 后端服务管理
│   │   └── llmValidator.ts        # LLM 连通性验证
│   ├── aiCli/                     # 供应商基础类型与工具（source of truth）
│   │   ├── officialEndpoints.ts   # 官方端点常量、apiKind 推断
│   │   ├── providerAuth.ts        # 认证模式判定
│   │   └── providerPresets.ts     # 内置供应商预设
│   └── webview/                   # Webview UI（独立 webpack 打包）
│       └── configPage/            # 配置页 React 组件
│           ├── AiCliProviderEditor.tsx   # 供应商添加/编辑表单
│           ├── AiCliProviderGroup.tsx    # 供应商列表与路由开关
│           ├── AiCliConfigSection.tsx    # 配置页主区域
│           ├── GatewayUsagePanel.tsx     # 用量统计面板
│           ├── GatewayUsageChart.tsx     # 用量趋势图表
│           ├── ClaudeModelSelect.tsx     # 模型选择器
│           └── officialEndpoints.ts      # aiCli/ 的 webview 副本
├── test-codex-responses-bridge.js # 格式转换与模型映射单元测试
├── scripts/                      # 构建与清理脚本
└── package.json
```

### 开发命令

按场景选用：

| 场景              | 命令                        | 说明                             |
| ----------------- | --------------------------- | -------------------------------- |
| 新 clone          | `npm ci && npm run build`   | 安装依赖并生产构建               |
| 日常开发          | `npm run dev` + F5          | TS watch + Webview watch，调试用 |
| 生产构建          | `npm run build`             | 编译 TS + 打包 Webview           |
| 构建异常          | `npm run rebuild`           | 清理后重新构建                   |
| 深度清理          | `npm run clean:deep`        | 删 out、node_modules 等          |
| 打包              | `npm run package`           | 生成 `.vsix`                     |
| 代码检查          | `npm run lint`              | ESLint                           |
| Codex Bridge 测试 | `npm run test:codex-bridge` | Codex 响应桥接单测               |

### “Preview/预览”插件（最短路径）

- 在 VSCode 里按 `F5`（Run Extension）启动 **Extension Development Host**，这就是“预览/调试插件”。  
- 开发时推荐边改边编译：

```bash
npm run watch         # TS 增量编译（out/extension.js）
npm run watch-webview # Webview 增量打包（out/webview）
```

也可以用一个命令同时启动两者：

```bash
npm run dev
```

### Node.js 版本

`package.json` 的 `engines.node` 为 **^22.13.0 或 >=24**；依赖链（如 `@ant-design/x`、`mermaid`）也需要较新 Node。仓库提供 `extension/.nvmrc`（与上述范围对齐），使用 nvm 时：

```bash
nvm install
nvm use
```

### 技术栈

- TypeScript
- React 18 + Ant Design 6
- Webpack
- VSCode Extension API

## 故障排除

### 后端连接问题

Agent 技能运行时管理、预填参数、模块扫描/测试、回放 Webview 和 API 文档需要后端。如果这些页面不可用，优先检查后端连接。普通文件查看、配置编辑、文献索引预览和通过 CLI/Claude Code 运行实验不会因为后端暂未启动而被阻断。

1. 检查后端服务是否运行（访问 `http://127.0.0.1:<port>/health` 应返回 200）
2. 检查当前工作区 `.env` 的 `BACKEND_HOST/BACKEND_PORT` 是否与实际一致
3. 在 VSCode 中打开 **“AI Social Scientist: 后端状态菜单”**：
   - 先点“查看日志”定位启动失败原因
   - 再点“打开配置”核对 Key/Base/Model 与 Python 路径

> 常见误区：以“插件调试”方式运行时，Extension Development Host 的**工作区可能不是你以为的目录**，导致插件读取到另一份 `.env`，从而出现“状态栏显示/配置页显示不一致、检测不到后端”等现象。请确认调试窗口打开的是正确的工作区目录。

### 编译错误

```bash
rm -rf out node_modules
npm install && npm run compile
```

### Webview 构建内存不足（OOM）

如果构建时出现 Node heap OOM，直接运行 `npm run build`（本项目已在脚本中设置了合适的 `NODE_OPTIONS`）；如果你在更低内存的环境中构建，建议关闭其它占用或提高可用内存。

## 相关链接

- [AgentSociety 项目](https://github.com/tsinghua-fib-lab/agentsociety)
- [问题反馈](https://github.com/tsinghua-fib-lab/agentsociety/issues)
- [开发指南](DEVELOPMENT.md)

## 许可证

[MIT License](LICENSE)
