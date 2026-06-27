# AgentSociety: 社会中的 LLM 智能体

<p align="center">
  <a href="./README.md">English</a> · <a href="./README_zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/tsinghua-fib-lab/AgentSociety/stargazers">
    <img src="https://img.shields.io/github/stars/tsinghua-fib-lab/AgentSociety?style=social" alt="GitHub Stars">
  </a>
  <a href="https://github.com/tsinghua-fib-lab/AgentSociety/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License">
  </a>
  <a href="https://pypi.org/project/agentsociety2/">
    <img src="https://img.shields.io/pypi/v/agentsociety2.svg" alt="PyPI (v2)">
  </a>
  <a href="https://pypi.org/project/agentsociety/">
    <img src="https://img.shields.io/pypi/v/agentsociety.svg?label=pypi%20(v1)" alt="PyPI (v1)">
  </a>
</p>

<p align="center">
  <a href="https://agentsociety2.readthedocs.io/">
    <img src="https://img.shields.io/badge/docs-v2%20(recommended)-brightgreen" alt="Documentation v2">
  </a>
  <a href="https://agentsociety.readthedocs.io/">
    <img src="https://img.shields.io/badge/docs-v1%20(legacy)-lightgrey" alt="Documentation v1">
  </a>
</p>

---

AgentSociety 是用于构建 LLM 驱动智能体仿真、城市环境实验与科研工作流的开源框架。本仓库同时维护推荐使用的 **AgentSociety 2** 与旧版 **AgentSociety 1.x**。

论文见 [arXiv](https://arxiv.org/abs/2502.08691)：

```bibtex
@article{piao2025agentsociety,
  title={AgentSociety: Large-Scale Simulation of LLM-Driven Generative Agents Advances Understanding of Human Behaviors and Society},
  author={Piao, Jinghua and Yan, Yuwei and Zhang, Jun and Li, Nian and Yan, Junbo and Lan, Xiaochong and Lu, Zhihong and Zheng, Zhiheng and Wang, Jing Yi and Zhou, Di and others},
  journal={arXiv preprint arXiv:2502.08691},
  year={2025}
}
```

## Star History

<a href="https://www.star-history.com/#tsinghua-fib-lab/AgentSociety&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tsinghua-fib-lab/AgentSociety&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tsinghua-fib-lab/AgentSociety&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=tsinghua-fib-lab/AgentSociety&type=Date" />
 </picture>
</a>

## 包结构

### AgentSociety 2（推荐）

[![PyPI Version](https://img.shields.io/pypi/v/agentsociety2.svg)](https://pypi.org/project/agentsociety2/)

AgentSociety 2 是现代化的 LLM 原生智能体仿真与科研平台：

```bash
pip install agentsociety2
```

**主要特性：**

- **LLM 原生设计**：从底层为 LLM 驱动智能体构建
- **灵活的环境系统**：模块化环境组件，支持热插拔工具
- **多种推理模式**：CodeGen（默认）、ReAct、Plan-Execute、Two-Tier 和 Search 路由器
- **可扩展执行**：智能体为 workspace 绑定的无状态 record，由 Ray Task 驱动，通过单一 `ServiceProxy` 注入 env / LLM clients / trace / replay 句柄
- **科研技能**：文献检索、假设生成、实验设计、论文写作
- **实验回放**：Catalog-driven JSONL 回放，DuckDB 读侧 + 分布式 trace
- **MCP 支持**：Model Context Protocol 集成，扩展工具能力

**文档：** [agentsociety2.readthedocs.io](https://agentsociety2.readthedocs.io/)

**源码：** [packages/agentsociety2/](./packages/agentsociety2/)

### AgentSociety 1.x（旧版）

[![PyPI Version](https://img.shields.io/pypi/v/agentsociety.svg)](https://pypi.org/project/agentsociety/)

AgentSociety 1.x 是原始的城市仿真框架，包含 gRPC 环境集成。

```bash
pip install agentsociety
```

**主要特性：**

- 基于 Ray 分布式计算的城市级仿真
- 城市场景模块（出行、经济、社交）
- 多智能体协调与通信

**文档：** [agentsociety.readthedocs.io](https://agentsociety.readthedocs.io/)

**源码：** [packages/agentsociety/](./packages/agentsociety/)

## 其他包

- **[agentsociety-community](./packages/agentsociety-community/)**：社区贡献的自定义智能体与 Block
- **[agentsociety-benchmark](./packages/agentsociety-benchmark/)**：智能体评估基准工具

## 仓库目录

```
AgentSociety/
├── packages/
│   ├── agentsociety2/      # v2.x，当前推荐包
│   ├── agentsociety/       # v1.x，旧版城市仿真
│   ├── agentsociety-community/
│   └── agentsociety-benchmark/
├── frontend/               # React 前端
├── extension/              # VS Code 扩展
├── docs_v1/                # v1 文档
└── examples/               # 示例实验
```

## 快速开始

### AgentSociety 2

运行示例前请先配置 LLM 环境变量，例如：

```bash
export AGENTSOCIETY_LLM_API_KEY="your-api-key"
export AGENTSOCIETY_LLM_API_BASE="https://api.openai.com/v1"
export AGENTSOCIETY_LLM_MODEL="gpt-5.5"
```

```python
import asyncio
from datetime import datetime
from pathlib import Path

from agentsociety2.contrib.env import SimpleSocialSpace
from agentsociety2.env import CodeGenRouter
from agentsociety2.society import AgentSociety


async def main():
    # 智能体以 spec 元数据声明；AgentSociety 在 init 时批量创建 workspace
    agent_specs = [{"id": 1, "profile": {"name": "Alice"}, "config": {}}]
    env = CodeGenRouter(
        env_modules=[SimpleSocialSpace(agent_id_name_pairs=[(1, "Alice")])]
    )
    society = AgentSociety(
        agent_specs=agent_specs,
        agent_class_name="PersonAgent",
        env_router=env,
        start_t=datetime.now(),
        run_dir=Path("run"),
    )
    await society.init()
    print(await society.ask("What's your name?"))
    await society.close()


asyncio.run(main())
```

### AgentSociety 1.x

```python
from agentsociety import AgentSociety

# 详见 packages/agentsociety/README.md
```

## 环境要求

- Python >= 3.11
- LLM API Key（OpenAI、Anthropic 或任意 litellm 支持的供应商）

## 贡献者

感谢所有为本项目做出贡献的人：

<a href="https://github.com/tsinghua-fib-lab/AgentSociety/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=tsinghua-fib-lab/AgentSociety" alt="Contributors" />
</a>

## 许可证

AgentSociety 采用 Apache License 2.0，`packages/agentsociety/commercial` 目录除外。详见 [LICENSE](./LICENSE)。

## 引用

如果您在研究中使用了 AgentSociety，请引用：

```bibtex
@article{piao2025agentsociety,
  title={AgentSociety: Large-Scale Simulation of LLM-Driven Generative Agents Advances Understanding of Human Behaviors and Society},
  author={Piao, Jinghua and Yan, Yuwei and Zhang, Jun and Li, Nian and Yan, Junbo and Lan, Xiaochong and Lu, Zhihong and Zheng, Zhiheng and Wang, Jing Yi and Zhou, Di and others},
  journal={arXiv preprint arXiv:2502.08691},
  year={2025}
}
```

## 联系我们

- **Issues**：[GitHub Issues](https://github.com/tsinghua-fib-lab/AgentSociety/issues)
- **Discussions**：[GitHub Discussions](https://github.com/tsinghua-fib-lab/AgentSociety/discussions)
- **Email**：agentsociety.fiblab2025@gmail.com