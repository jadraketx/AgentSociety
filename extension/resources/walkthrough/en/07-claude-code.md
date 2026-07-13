## Connect Claude Code

**Claude Code** is the recommended default coding and research collaboration entry point for AI Social Scientist. Once connected, it can read this project's research skills and reach the local backend through MCP, which makes it useful for generating configs, checking experiments, analyzing results, or editing custom modules.

> 💡 If you mostly use the graphical interface, you can finish the basic setup first; keeping Claude Code connected will still make experiment debugging and skill extension much smoother later.

---

### What Claude Code reads from this project

After project initialization, the extension syncs bundled development skills into your workspace:

```text
workspace-root/
├── .claude/skills/      # Development skills used by Claude Code
├── CLAUDE.md            # Project instructions for Claude Code
└── AGENTS.md            # Project instructions for general coding assistants
```

> 💡 `workspace-root/` is the workspace folder you opened in VS Code.

These are project-level files and are safe to maintain with the project. Put personal secrets in user-level or local ignored configuration files.

![Claude skill management page example](../images/claude-skill-management.png)

[Open Claude Skill Sources Settings](command:aiSocialScientist.openClaudeSkillSourcesSettings)

---

### Configure Claude Code and Codex providers

Use the config page **Claude / Codex** tab (no separate legacy advanced panel):

[Open configuration page](command:aiSocialScientist.openConfigPage)

The page provides a **unified provider list** and a **step-by-step wizard** (simulation LLM → save `.env` → start backend → optional literature MCP / CLI gateway).

---

### Configure MCP for external services

Manage MCP under **Skill Management → MCP Integration** (literature MCP credentials live on the config page **Literature MCP** tab):

[Open skill management](command:aiSocialScientist.openSkillMarketplace)

Built-in literature MCP and custom MCP servers are listed separately. After adding a custom server, click **Sync** to write `~/.claude.json` and `~/.codex/config.toml`.

### Verify the connection

![Edit Claude settings example](../images/gif/edit-claude-settings-json.gif)

1. Start `claude` from the project root.
2. Run `/status` to check the model connection.
3. Run `/mcp` to check the `agentsociety` MCP server.
4. If it fails, verify the remote MCP URL, auth header, or local backend port.

Restart the terminal or Claude Code session after changing configuration.

[Open Claude Skill Sources Settings](command:aiSocialScientist.openClaudeSkillSourcesSettings)
