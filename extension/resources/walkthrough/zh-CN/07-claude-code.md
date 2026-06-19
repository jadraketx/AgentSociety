## 连接 Claude Code

**Claude Code** 是 AI Social Scientist 推荐的默认编码与研究协作入口。连接后，它可以读取本项目的研究技能，并通过 MCP 访问本地后端，帮助你生成配置、检查实验、分析结果或修改自定义模块。

> 💡 如果你主要使用图形界面，也可以先完成基础配置；但建议保留 Claude Code 连接，后续排查实验和扩展技能时会更顺手。

---

### Claude Code 会读取哪些内容？

初始化项目后，插件会把内置开发技能同步到工作区：

```text
your-project/
├── .claude/skills/      # Claude Code 使用的开发技能
├── CLAUDE.md            # 面向 Claude Code 的项目说明
└── AGENTS.md            # 面向通用编码助手的项目说明
```

这些文件是项目级配置，适合随项目一起维护。涉及个人密钥的配置建议放在用户目录或本地忽略文件中。

![Claude 技能管理页面示例](../images/claude-skill-management.png)

[打开 Claude 技能源设置](command:aiSocialScientist.openClaudeSkillSourcesSettings)

---

### 配置 Claude Code 使用的模型服务

Claude Code 默认使用 Anthropic 服务。推荐通过插件配置页 **高级配置 → Claude / Codex 路由** 进行图形化配置：

[打开 Claude Code 配置（配置页）](command:aiSocialScientist.openClaudeCodeConfig)

配置页支持：

- **共享供应商池**：供应商只保存一份；在供应商卡片上点击 **应用到 Claude** 或 **应用到 Codex**，即可决定它服务哪个 CLI。OpenAI 兼容 API 可同时应用到 Claude（经网关转换）和 Codex。
- **Claude Code**：支持 Anthropic 原生供应商，也支持 OpenAI 兼容供应商经本地网关转换为 Anthropic Messages。
- **Codex CLI**：支持 OpenAI 或第三方供应商（如智谱、DeepSeek）。经本地网关路由时，会自动将 `/v1/responses` 转换为 Chat Completions 协议，兼容仅支持 Chat 协议的供应商。
- **Gateway 状态栏**：启用本地路由后，状态栏显示 `AI Gateway: Claude + Codex`（或当前路由的工具）。点击可打开配置页。

你也可以手动编辑 `~/.claude/settings.json`（Mac/Linux）或 `用户目录/.claude/settings.json`（Windows）：

![创建 Claude 设置文件示例](../images/gif/create-claude-settings-json.gif)

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-api-endpoint.com",
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

> 💡 插件配置页写入 `ANTHROPIC_AUTH_TOKEN`（Bearer）与 `ANTHROPIC_BASE_URL`。若服务商要求 `X-Api-Key`，可在 `settings.json` 中手动设置 `ANTHROPIC_API_KEY`。

### 使用本地 AI CLI Gateway

配置页内置 **AI CLI Gateway**，可将 Claude Code 和 Codex CLI 的请求经第三方供应商代理转发：

1. 在 **高级配置 → Claude/Codex 路由** 中添加供应商（填写 Base URL 和 API Key）。
2. 切换 Claude 和/或 Codex 的 **启用本地代理** 开关。
3. 网关自动启动，并将上游配置写入 `~/.claude/settings.json` 和 `~/.codex/config.toml`。
4. 修改供应商或模型后，点击 Codex 标签页中的 **重启 Codex** 使新配置生效。

官方订阅（Anthropic Pro/Max、ChatGPT）使用 OAuth 直连，**不需要**启用本地网关——保持代理关闭即可。

> 💡 网关还提供用量追踪和费用估算。费用会分别计算输入、输出、缓存读取和缓存写入；OpenAI/Codex 记录会扣除缓存命中的可计费输入。点击配置页中的 **查看日志** 可查看路由详情。

---

### 配置 MCP 连接外部服务

**MCP**（Model Context Protocol）让 Claude Code 能连接外部工具、数据库、知识库和远程服务。推荐优先接入远程 HTTP MCP 服务；如果服务商只提供 SSE 端点，也可以使用 SSE。只有在开发本地工具或需要访问本机资源时，才使用本地 stdio 服务。

常见接入方式：

| 类型       | 适合场景                                       | 配置方式                               |
| ---------- | ---------------------------------------------- | -------------------------------------- |
| 远程 HTTP  | 云端 MCP、团队共享服务、外部平台集成           | `claude mcp add --transport http ...`  |
| 远程 SSE   | 旧版或特定服务只提供 SSE 端点                  | `claude mcp add --transport sse ...`   |
| 本地 stdio | 本地脚本、开发调试、需要访问本机文件或内网资源 | `claude mcp add --transport stdio ...` |

推荐用命令添加远程 MCP，而不是手写配置：

```bash
# 个人当前项目使用，默认写入本地 Claude Code 配置
claude mcp add --transport http agentsociety https://your-mcp-server.example.com/mcp

# 团队共享，写入项目根目录 .mcp.json
claude mcp add --transport http agentsociety --scope project https://your-mcp-server.example.com/mcp

# 如果服务商只提供 SSE 端点
claude mcp add --transport sse agentsociety-sse https://your-mcp-server.example.com/sse
```

如果远程 MCP 需要 Token，可以通过 header 传入：

```bash
claude mcp add --transport http agentsociety https://your-mcp-server.example.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

如果你希望把团队共享配置提交到仓库，也可以在项目根目录创建或编辑 `.mcp.json`。适合共享的配置里不要写死个人密钥，使用环境变量：

```json
{
  "mcpServers": {
    "agentsociety": {
      "type": "http",
      "url": "${AGENTSOCIETY_MCP_URL:-https://your-mcp-server.example.com/mcp}",
      "headers": {
        "Authorization": "Bearer ${AGENTSOCIETY_MCP_TOKEN}"
      }
    }
  }
}
```

本地后端开发时，也可以保留 stdio 方式。确保后端服务已启动，然后在项目根目录创建或编辑 `.mcp.json`：

```json
{
  "mcpServers": {
    "agentsociety": {
      "command": "uv",
      "args": ["run", "python", "-m", "agentsociety2.mcp"],
      "env": {
        "AGENTSOCIETY_BACKEND_URL": "http://localhost:8001"
      }
    }
  }
}
```

> 💡 `.mcp.json` 是项目级 MCP 配置，适合团队共享；个人密钥建议放到环境变量或用户级配置中。Claude Code 会在首次使用项目级 MCP 时要求确认，这是正常的安全检查。

---

### 验证连接

![编辑 Claude 设置示例](../images/gif/edit-claude-settings-json.gif)

1. 在项目根目录启动 `claude`。
2. 输入 `/status` 检查模型连接。
3. 输入 `/mcp` 检查 `agentsociety` MCP 服务状态。
4. 如果连接失败，先确认远程 MCP URL、认证 header 或本地后端端口是否正确。

配置完成后，重新打开终端或重启 Claude Code 会话即可生效。

[打开 Claude 技能源设置](command:aiSocialScientist.openClaudeSkillSourcesSettings)
