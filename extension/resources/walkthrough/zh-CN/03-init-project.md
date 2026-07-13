## 初始化研究项目

在开始使用前，你需要一个研究项目目录。

---

### 方式一：初始化新项目

在已打开的工作区文件夹中运行 **Initialize Research Project** 命令。插件会创建基础目录并写入 `TOPIC.md`、`.env` 模板与文献索引（需先在 `.env` 中配置 LLM API Key）：

![初始化工作区示例](../images/gif/initialize-workspace.gif)

```text
workspace-root/
├── TOPIC.md                # 研究话题
├── .env                    # 工作区 LLM / 后端配置
├── papers/                 # 文献资料
│   └── literature_index.json
├── datasets/               # 数据集
├── user_data/              # 用户数据
├── custom/                 # 自定义 Agent / 环境模块与 Agent 技能
├── .claude/skills/         # Claude Code 开发技能（初始化时同步）
├── .agentsociety/          # 分析 harness 等机器状态（按需生成）
├── hypothesis_<id>/        # 研究假设（后续由工作流创建）
│   └── experiment_<id>/   # 实验与回放数据
├── paper/                  # 论文工作区（使用 paper-toolkit 时创建）
└── analysis/               # 分析工作区（使用分析技能时创建）
```

> 💡 上表中的 `workspace-root/` 表示你当前打开的工作区根目录，不是固定文件夹名。

### 方式二：打开已有项目

直接用 VS Code 打开一个已有的研究工作区文件夹即可，插件会自动识别目录结构。

如果还没有项目目录，可以先新建一个空文件夹，再用 VS Code 打开：

![新建项目文件夹示例](../images/gif/create-project-folder.gif)

---

### 🔧 什么是命令面板？

VS Code 的**命令面板**是执行各种操作的快捷入口：

- 按 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）打开
- 输入 `AI Social Scientist` 可以看到所有插件命令
- 常用命令也可以通过侧边栏按钮或状态栏直接触发

> 💡 推荐记住这个快捷键，很多操作都从这里发起。

[初始化项目](command:aiSocialScientist.initProject)
