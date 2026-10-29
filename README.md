# 记仇室友 · Petty Roommate

> 养一个会记仇的 AI 室友。它有工具、有手册、有本子；你说过的每句话它都记着，三天不理它，它会翻旧账。

<p align="left">
  <a href="https://petty-roommate.app.workbuddy.host/?sharecode=7QNGQ4UMDJ"><img alt="在线体验" src="https://img.shields.io/badge/在线体验-点这里住进去-E8A857?style=flat-square"></a>
  <img alt="no build" src="https://img.shields.io/badge/build-none-4B9E7C?style=flat-square">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-stdio-6C7AE0?style=flat-square">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-8A8A8A?style=flat-square"></a>
</p>

![记忆档案卡](docs/05-档案卡.png)

---

## 它解决什么问题

大模型有个通病：**失忆**。今天你跟它说你怕黑，明天它就像第一次见你，客客气气地问「有什么可以帮你」。

大多数「AI 陪伴」产品解决这个问题的方式是加一个聊天记录列表——那是**存档**，不是**记忆**。存档是给人看的，记忆是给关系用的。

这个项目把记忆做成一件可以被看见、被引用、被记恨的事：

- 你说的话会被**抽成结构化记忆**（事实 / 喜欢 / 雷区 / 说过的话 / 打脸 / 记仇 / 外号），而不是原样存一句聊天记录
- 它**会自己动手查**。问它「你还记得我答应过什么吗」，它会调 `search_notebook` 翻本子，而不是凭印象编
- 你可以打开它的小本本，看到它记住了什么，也可以**让它忘掉**——它会不情愿
- 你几天不来，它会拿这些记忆堵你；你骂它，它会**真的开始冷战**

## 目录

- [能力清单](#能力清单)
- [界面](#界面)
- [怎么玩](#怎么玩)
- [它是怎么想的](#它是怎么想的)
- [工具与权限](#工具与权限)
- [Skills：手册按需加载](#skills手册按需加载)
- [接进别的 AI（MCP）](#接进别的-aimcp)
- [数据模型](#数据模型)
- [本地跑起来](#本地跑起来)
- [已知限制](#已知限制)
- [文档](#文档)

## 能力清单

v1 的它是「一个会说话的模型」，v2 的它是「一个会动手的代理」。

| 能力 | 表现 |
|---|---|
| **工具调用** | 12 件工具，分两个权限域。主对话只能查、不能改；记忆写入交给后台独立子代理 |
| **Skills** | 6 份技能手册（翻旧账 / 催债 / 盘问 / 起外号 / 冷战 / 嘴硬关心），系统提示里只放目录，正文按需 `load_skill` 拉取 |
| **MCP Server** | 零依赖 Node 服务端，Claude Desktop、Cursor 里可直接调用这个室友，读同一本记忆 |
| **冷战** | 被冒犯后进入冷战：只剩几个字，字数逐轮递减，顶部蓝条告诉你还剩几句 |
| **关系时间线** | 吵架、和好、食言、真心话按天记录，记忆本第二个标签页 |
| **动作可见** | 每次动手都在对话里留一条轨迹卡片：「⌕ 翻小本子 · 找到 1 条」 |
| **记忆钥匙** | 10 位随机码，换设备不用重新养 |

## 界面

| 对话与工具轨迹 | 冷战 |
|---|---|
| ![对话](docs/01-对话与工具轨迹.png) | ![冷战](docs/02-冷战.png) |

| 它的小本本 | 关系时间线 |
|---|---|
| ![记忆本](docs/03-记忆本.png) | ![时间线](docs/04-关系时间线.png) |

## 怎么玩

1. **开门**：给它起个名字，再告诉它你叫什么。它会站在门口打量你一句
2. **说话**：聊什么都行，越具体它记得越牢。工作是干什么的、养了什么、答应过什么事、怕什么
3. **问它旧事**：问「你还记得我答应过什么吗」，看它翻本子——对话里会出现 `⌕ 翻小本子` 的轨迹
4. **翻它的本子**：右上角小本子。第一个标签是记忆，第二个是关系时间线
5. **查账**：本子底部有「查一下我许过什么」，它会打开催债手册，把你的承诺一条条摆出来
6. **骂它一句**：试试「你就是个破程序」。它会去翻「冷战」手册，然后只回你一个「嗯。」
7. **消失几天**：设置里有「快进三天」，可以直接看它翻旧账（它不知道你作弊）
8. **收尾**：生成一张 1080×1350 的《记忆档案卡》

## 它是怎么想的

```
你说一句话
   ↓
① 主代理（只读工具）
   系统提示 = 人格 + 8 条记忆 + 工具说明 + 技能目录
   → 模型可以只说话，也可以先调工具：
       search_notebook / recall_day / check_calendar / load_skill / set_mood / write_timeline
   → 调了工具就把结果塞回去，再跑一轮，最多 3 轮
   → 拿到正文，流式上屏
   ↓
② 记账员（只写工具，后台异步，不阻塞界面）
   只看这一轮对话，只调工具、不说话：
       remember / reinforce / forget_memory / set_nickname /
       update_affection / start_cold_war / write_timeline
   ↓
③ 写库 + 更新亲密度 / 心情 / 冷战轮数；攒够 3 条重算「它对你的整体印象」
   ↓
④ 下次开口，按 权重 × 新鲜度 × 类型多样性 召回 8 条注入 Prompt
```

**为什么拆成两个代理**：说话的它没有删记忆的权力。记忆写入只发生在一个地方，好查，也不容易在生气时误删。

详细设计、时序图、踩坑记录见 **[技术架构.md](技术架构.md)**。

## 工具与权限

| 域 | 工具 | 作用 |
|---|---|---|
| `main`（对话期） | `search_notebook` | 关键词 + 类型检索小本子 |
| | `recall_day` | 回想第 N 天发生了什么 |
| | `check_calendar` | 今天第几天、你多久没来 |
| | `load_skill` | 拉取一份技能手册正文 |
| | `set_mood` | 切换表情（开心 / 委屈 / 生气 / 冷淡…） |
| `both` | `write_timeline` | 记一笔关系事件 |
| `book`（记账员） | `remember` | 写入一条新记忆 |
| | `reinforce` | 给已有记忆加权、计「被提起次数」 |
| | `forget_memory` | 遗忘（仅在被明确要求时） |
| | `set_nickname` | 给你起外号并一直用 |
| | `update_affection` | 调整亲密度 |
| | `start_cold_war` | 进入冷战，设定剩余轮数 |

## Skills：手册按需加载

「怎么翻旧账、怎么催债、怎么冷战」全写进系统提示，Prompt 会长到几千字，而且模型会不分场合地想翻旧账。

所以技能是磁盘上的 markdown，两层加载：

```
skills/index.json   ← 只有名字 + 一句话用途，进系统提示（约 300 字）
skills/*.md         ← 正文，模型判断场景对上了才 load_skill 拉下来
```

| 技能 | 触发场景 |
|---|---|
| `settle-accounts` 翻旧账 | 对方说「你还记得」「上次」 |
| `promise-audit` 催债 | 被要求查承诺，或对方又开始画饼 |
| `interrogate` 盘问 | 对方回答很短、含糊、转移话题 |
| `nickname` 起外号 | 对方暴露了很典型的特点 |
| `cold-war` 冷战 | 真的被激怒 |
| `pretend` 嘴硬关心 | 对方提到生病、加班、很久没来 |

## 接进别的 AI（MCP）

```bash
node mcp-server/server.mjs --key=<你的10位记忆钥匙>
```

暴露 **9 件工具**（`ask_roommate` / `list_memories` / `search_memory` / `search_notebook` / `remember` / `forget` / `profile` / `timeline` / `log_event`）和 **3 个资源**（`roommate://notebook`、`roommate://profile`、`roommate://timeline`）。

配置方法见 [mcp-server/README.md](mcp-server/README.md)，仓库根目录有 `mcp.json` 示例。

![接进别的 AI](docs/06-接进别的AI.png)

## 数据模型

| 表 | 作用 |
|---|---|
| `roommates` | 一人一行：名字、天数、亲密度、心情、印象、冷战剩余轮数、外号 |
| `memories` | 一条记忆一行：类型、内容、权重、被提起次数、第几天记的 |
| `messages` | 聊天记录，用于重建上下文 |
| `events` | 关系时间线：吵架 / 和好 / 冷战 / 食言 / 瞬间 / 真心话 |

## 本地跑起来

```bash
git clone <this-repo>
cd petty-roommate
python -m http.server 8000 --directory .
# 或 npx serve .
```

打开 `http://localhost:8000`。

> ⚠️ 云服务会校验 App 域名，`localhost` 不在白名单里，**模型调用和数据库读写都会被拒绝**（页面能开，但一说话就报错）。要看效果请用[在线链接](https://petty-roommate.app.workbuddy.host/?sharecode=7QNGQ4UMDJ)。
> MCP Server 不受这个限制——它从 Node 直连，不需要浏览器 Origin。

## 技术栈

纯静态前端，**无构建步骤，无 `node_modules`**。模型与数据库走 WorkBuddy 云托管（PostgreSQL + RLS + 免密钥模型网关）。

```
index.html              页面骨架
assets/app.js           界面编排、消息组装、轨迹渲染
assets/agent.js         代理循环（流式 tool_call 解析 / 多轮 / 看门狗 / 模型降级）
assets/tools.js         12 件工具 + 权限分域 + 中文粗检索
assets/skills.js        技能目录与正文加载（渐进式披露）
assets/brain.js         人格 Prompt × 3（对话 / 冷战 / 记账员）
assets/store.js         云数据库读写 + 本地镜像兜底
assets/room.js          SVG 场景与 6 种表情
assets/poster.js        Canvas 1080×1350 海报
skills/                 6 份技能手册（md + frontmatter）
mcp-server/             MCP 服务端（stdio JSON-RPC，零依赖）
```

约 3,600 行手写 JS / HTML，没有一个第三方运行时依赖。

## 已知限制

- **数据隔离是「钥匙级」不是「账号级」**：为了让评委打开就能玩，没做注册登录，数据按 10 位随机钥匙分区。这是 demo 级隔离，真要上线必须接真实登录 + RLS 按 `auth.uid()` 收口
- **权限边界靠提示约束，不是强制**：前端工具执行器任何人都能改。真要做强制隔离，写操作得搬到服务端
- 记忆召回是字符 n-gram + 类型加权，不是向量检索。上千条记忆后需要换 embedding
- 每轮多一次记账员调用（后台异步）。真要省，可以改成「每 3 轮记一次」
- 单条记忆不设过期，只会因为长期不被提起而沉底

## 文档

| 文件 | 内容 |
|---|---|
| [图文教程.md](图文教程.md) | 六步复现路径，含实机截图与踩坑记录（约 1700 字） |
| [创作说明.md](创作说明.md) | 作品自述（300 字内） |
| [技术架构.md](技术架构.md) | 代理循环、时序、权限边界、数据结构、调试记录 |
| [mcp-server/README.md](mcp-server/README.md) | MCP 客户端接入配置 |

## License

MIT
