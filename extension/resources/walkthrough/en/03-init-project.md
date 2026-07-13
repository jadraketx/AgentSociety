## Initialize a Research Project

Before you start, you need a research project directory.

---

### Option 1: Initialize a new project

With a workspace folder already open, run **Initialize Research Project**. The extension creates the base layout and writes `TOPIC.md`, a `.env` template, and the literature index (you need an LLM API key in `.env` first):

![Initialize workspace example](../images/gif/initialize-workspace.gif)

```text
workspace-root/
├── TOPIC.md                # Research topic
├── .env                    # Workspace LLM / backend settings
├── papers/                 # Literature
│   └── literature_index.json
├── datasets/               # Datasets
├── user_data/              # User data
├── custom/                 # Custom agents, env modules, and agent skills
├── .claude/skills/         # Claude Code dev skills (synced during init)
├── .agentsociety/          # Analysis harness state (created on demand)
├── hypothesis_<id>/        # Research hypotheses (created by later workflows)
│   └── experiment_<id>/   # Experiments and replay data
├── paper/                  # Paper workspace (created when using paper-toolkit)
└── analysis/               # Analysis workspace (created when using analysis skills)
```

> 💡 `workspace-root/` means the workspace folder you opened in VS Code, not a fixed directory name.

### Option 2: Open an existing project

Open an existing research workspace folder in VS Code. The extension recognizes the layout automatically.

If you do not have a project yet, create an empty folder first, then open it in VS Code:

![Create project folder example](../images/gif/create-project-folder.gif)

---

### 🔧 What is the Command Palette?

The VS Code **Command Palette** is the quick entry point for extension actions:

- Press `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)
- Type `AI Social Scientist` to list extension commands
- Many actions are also available from sidebar buttons or the status bar

> 💡 It is worth remembering this shortcut; many workflows start here.

[Initialize Project](command:aiSocialScientist.initProject)
