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

配置页提供一个 **统一的供应商管理面板**，所有供应商共享一个列表，无需重复添加：

- **三段式新建**：按“连接与认证 → 用途 → 模型映射”填写。保存前可以检测可用性或获取模型，系统会自动识别上游协议。
- **供应商共享池**：每个供应商只需添加一次。保存时可直接勾选设为 Claude Code 主供应商、Codex 主供应商，或同时服务两者。
- **路由开关**：面板顶部提供 Claude Code 和 Codex 各自的代理开关，网关会按请求格式自动转换。
- **模型映射**：默认模型用于 Codex 和 Claude 兜底；Sonnet / Opus / Haiku 用于 Claude Code 的角色模型热切换，不支持的角色可留空。
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

1. 在 **高级配置 → Claude / Codex 路由** 中添加供应商：选择预设或填写 Base URL，第三方 API 填 API Key，官方订阅选择登录模式。
2. 勾选该供应商要服务的工具：**设为 Claude Code 主供应商**、**设为 Codex 主供应商**，或两者都选。
3. 点击 **检测** 或 **获取模型** 自动识别协议；根据模型列表填写默认模型和 Claude 角色模型。
4. 保存后，API Key 供应商会经本地网关路由；网关自动写入 `~/.claude/settings.json` 和 `~/.codex/config.toml`。修改供应商或模型后，点击 **重启 Codex** 使新配置生效。

官方订阅（Anthropic Pro/Max、ChatGPT）使用 OAuth 直连，**不需要**启用本地网关——保持代理关闭即可。

> 💡 网关自动完成 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 之间的转换，并追踪用量、估算费用。当前已验证文本、system/instructions、max tokens、temperature/top_p、工具定义、工具调用、工具结果、流式事件和 usage 统计；供应商私有扩展字段会尽量透传或在不支持时忽略。点击配置页中的 **查看日志** 可查看路由详情。

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
