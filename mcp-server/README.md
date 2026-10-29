# 记仇室友 · MCP Server

把「记仇室友」接进任何支持 MCP 的客户端。它读的是网页版同一本记忆、同一份人格 —— 你在网页上跟它说的话，Claude Desktop 里它照样记得。

零依赖，只要 Node 18+。不需要 `npm install`。

## 跑起来

```bash
node mcp-server/server.mjs --key=你的10位记忆钥匙
```

钥匙在网页版「设置 → 记忆钥匙」复制。也可以用环境变量：

```bash
ROOMMATE_KEY=48eps7gspz node mcp-server/server.mjs
```

## 接到客户端

**Claude Desktop**（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "petty-roommate": {
      "command": "node",
      "args": [
        "/绝对路径/petty-roommate/mcp-server/server.mjs",
        "--key=48eps7gspz"
      ]
    }
  }
}
```

**Cursor / WorkBuddy**（`.mcp.json` 或 MCP 设置里）：

```json
{
  "mcpServers": {
    "petty-roommate": {
      "command": "node",
      "args": ["/绝对路径/petty-roommate/mcp-server/server.mjs"],
      "env": { "ROOMMATE_KEY": "48eps7gspz" }
    }
  }
}
```

## 它提供什么

### 工具

| 工具 | 干什么 |
|---|---|
| `ask_roommate` | 跟它说一句话，它用人设回答。内部会自己调 `search_notebook` 查旧账 |
| `list_memories` | 列出记忆本，可按类型筛 |
| `search_memory` | 按关键词检索（中文字/双字匹配，不需要分词） |
| `remember` | 往记忆本写一条 —— 写进去以后它就会拿这件事翻旧账 |
| `forget` | 删掉某条记忆 |
| `profile` | 第几天、亲密度、心情、它的判断、欠了几笔账 |
| `timeline` | 关系时间线：吵架、和好、冷战 |
| `log_event` | 往时间线记一笔 |

### 资源

| URI | 内容 |
|---|---|
| `roommate://notebook` | 记忆本全文（markdown） |
| `roommate://profile` | 关系档案 |
| `roommate://timeline` | 关系时间线 |

## 它怎么连到云端

不走 SDK，直接说平台的两条底层接口：

```
POST {endpoint}/.cloud/database/rest/<table>       # PostgREST
POST {endpoint}/.cloud/llm/chat/completions        # SSE 流式
Header: x-wb-webapp-access-key: <publishableKey>
```

代码在 `cloud.mjs`，一共 200 行，没有依赖。

## 已知限制

- **同一把钥匙只能一个人用**。表策略是公开读写，按 `owner_key` 分区，是 demo 级隔离。
- **`ask_roommate` 只有一件工具**（`search_notebook`）。能力比网页版窄，因为网页版有一套完整的前端工具执行器，MCP 侧刻意做薄。
- 模型通道**只支持流式**，非流式会报 `stream must be true`，所以 `cloud.mjs` 里所有调用都走 SSE 再拼。
