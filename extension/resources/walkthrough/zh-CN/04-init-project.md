## 初始化研究项目

开始前需要一个研究工作区文件夹。

### 新建工作目录

若还没有项目目录，先新建空文件夹再用 VS Code / code-server 打开：

![新建工作目录](../images/gif/create-project-folder.gif)

### 初始化项目结构

在已打开的工作区中运行 **Initialize Research Project**。较长的分步演示托管在 GitHub，避免增大已安装扩展：

1. [初始化工作区并等待完成](https://github.com/tsinghua-fib-lab/agentsociety/blob/main/extension/resources/walkthrough/images/gif/init-01-workspace.gif)
2. [一键导入（可选）并确认配置](https://github.com/tsinghua-fib-lab/agentsociety/blob/main/extension/resources/walkthrough/images/gif/init-02-web-import.gif)
3. [仿真 LLM 与后续向导步骤](https://github.com/tsinghua-fib-lab/agentsociety/blob/main/extension/resources/walkthrough/images/gif/init-03-llm-wizard.gif)
4. [CLI Gateway 与完成](https://github.com/tsinghua-fib-lab/agentsociety/blob/main/extension/resources/walkthrough/images/gif/init-04-cli-finish.gif)

插件会创建基础目录并写入 `TOPIC.md`、`.env` 模板等：

```text
workspace-root/
├── TOPIC.md
├── .env
├── papers/
├── datasets/
├── user_data/
├── custom/
├── .claude/skills/
├── hypothesis_<id>/     # 后续由工作流创建
├── analysis/            # 使用分析技能时创建
└── paper/               # 使用 paper-toolkit 时创建
```

也可直接打开已有研究工作区，插件会识别目录结构。

### 命令面板

- `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`）
- 输入 `AI Social Scientist` 查看插件命令

[初始化项目](command:aiSocialScientist.initProject)
