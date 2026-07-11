## Configure LLM API

The config page opens a **setup wizard** on first use:

1. **Simulation LLM** — API URL, key, and model (presets + fetch models)
2. **Save config** — write workspace `.env`
3. **Start backend** — save and start the local service
4. **Literature MCP** (optional)
5. **CLI gateway** (optional) — Claude Code / Codex

Use **All settings** anytime to switch to the full tab layout.

---

### Required fields

| Field        | Description     | Example                     |
| ------------ | --------------- | --------------------------- |
| **API Key**  | Provider secret | `sk-...`                    |
| **API Base** | Endpoint URL    | `https://api.openai.com/v1` |

After filling in, **Validate** the connection, then **Save**.

[Open config page](command:aiSocialScientist.openConfigPage)
