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

推荐通过配置页的 **Claude / Codex** Tab 图形化配置（不再使用「高级配置」折叠）：

[打开配置页](command:aiSocialScientist.openConfigPage)

配置页提供 **统一的供应商管理面板** 与 **渐进式配置步骤**（仿真 LLM → 保存 → 启动后端 → 可选文献 MCP / CLI 网关）。

---

### 配置 MCP 连接外部服务

推荐在 **技能管理 → MCP 集成** Tab 管理 MCP（文献检索在配置页「文献 MCP」Tab 填 URL/Key）：

[打开技能管理](command:aiSocialScientist.openSkillMarketplace)

内置文献 MCP 与自定义 MCP 分开展示；添加自定义服务后点 **同步** 写入 `~/.claude.json` 与 `~/.codex/config.toml`。

### 验证连接

![编辑 Claude 设置示例](../images/gif/edit-claude-settings-json.gif)

1. 在项目根目录启动 `claude`。
2. 输入 `/status` 检查模型连接。
3. 输入 `/mcp` 检查 `agentsociety` MCP 服务状态。
4. 如果连接失败，先确认远程 MCP URL、认证 header 或本地后端端口是否正确。

配置完成后，重新打开终端或重启 Claude Code 会话即可生效。

[打开 Claude 技能源设置](command:aiSocialScientist.openClaudeSkillSourcesSettings)
