#!/usr/bin/env node
/* =========================================================
   server.mjs — 记仇室友 MCP Server
   ---------------------------------------------------------
   零依赖，走 MCP 的 stdio 传输（换行分隔的 JSON-RPC 2.0）。
   它把"那个室友"接到任何支持 MCP 的客户端上：Claude Desktop、
   Cursor、WorkBuddy、你自己写的 agent 都行。

   跑起来：
     ROOMMATE_KEY=48eps7gspz node mcp-server/server.mjs

   它会暴露：
     工具    ask_roommate / list_memories / search_memory /
             remember / forget / profile / timeline
     资源    roommate://notebook · roommate://profile · roommate://timeline

   注意：stdout 只能有 JSON-RPC。所有日志走 stderr。
   ========================================================= */

import { createRequire } from 'node:module';
import readline from 'node:readline';

import {
  getRoom, ensureRoom, patchRoom,
  listMemories, addMemory, deleteMemory,
  listEvents, addEvent,
  chat, searchMemory, promiseIntent
} from './cloud.mjs';

const require = createRequire(import.meta.url);
const brain = require('../assets/brain.js');

const PROTOCOL = '2024-11-05';
const SERVER = { name: 'petty-roommate', version: '2.0.0' };

/* ---------------- 参数 ---------------- */

const argKey = process.argv.find(a => a.startsWith('--key='));
const KEY = (argKey ? argKey.slice(6) : process.env.ROOMMATE_KEY || '').trim();
const NAME = process.env.ROOMMATE_PET_NAME || '';

const log = (...a) => console.error('[petty-roommate]', ...a);

function needKey() {
  if (KEY) return;
  throw new Error(
    '还没有记忆钥匙。启动时加 --key=<你的10位钥匙>，或设置环境变量 ROOMMATE_KEY。' +
    '钥匙在网页版「设置 → 记忆钥匙」里复制。'
  );
}

/* ---------------- 组装状态 ---------------- */

async function snapshot({ withSearch } = {}) {
  needKey();
  const room = await ensureRoom(KEY, NAME || '小北', '你');
  const memories = await listMemories(KEY, { limit: 80 });
  const events = await listEvents(KEY, 20);

  let picked = [...memories].sort((a, b) => (b.weight || 3) - (a.weight || 3)).slice(0, 8);
  if (withSearch) {
    const extra = searchMemory(memories, withSearch, 4);
    for (const m of extra) if (!picked.some(p => p.id === m.id)) picked.push(m);

    // "我答应过什么" 这类问法，关键词对不上任何一条，但意图很明确
    if (promiseIntent(withSearch)) {
      for (const m of memories) {
        if (m.kind === 'promise' && !picked.some(p => p.id === m.id)) picked.unshift(m);
      }
    }
  }

  return { room, memories, events, picked };
}

function promptState(room, picked, extra = {}) {
  const first = room.first_seen ? new Date(room.first_seen).getTime() : Date.now();
  const last = room.last_seen ? new Date(room.last_seen).getTime() : Date.now();
  const day = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1, room.day_count || 1);
  const gap = Math.max(0, (Date.now() - last) / 3600000);

  return {
    petName: room.pet_name,
    userName: room.user_name || '你',
    nickname: room.nickname || '',
    dayCount: day,
    affection: room.affection ?? 12,
    mood: room.mood || 'idle',
    memories: picked,
    skillBrief: '（MCP 通道不加载技能手册，直接用自己的判断。）',
    gapNote: gap >= 24 ? `对方已经 ${Math.round(gap)} 小时没来了。` : '',
    ...extra
  };
}

/* ---------------- 工具定义 ---------------- */

/* MCP 侧的 ask_roommate 只有一件工具可用：查它自己的本子。
   和网页端同一个权限哲学——说话的那个它，不能改记忆。 */
const ASK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_notebook',
      description: '在自己的小本本里按关键词检索关于对方的旧记忆。对方问起过去、你要翻旧账、或记不清细节时用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '要找的关键词' } },
        required: ['query']
      }
    }
  }
];

async function askLoop(messages, memories, model) {
  for (let turn = 0; turn < 3; turn++) {
    const out = await chat(messages, { model, temperature: 1, tools: ASK_TOOLS });
    if (!out.calls.length) return out.text;

    messages.push({
      role: 'assistant',
      content: out.text || null,
      tool_calls: out.calls.map(c => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.raw }
      }))
    });

    for (const c of out.calls) {
      let result;
      if (c.name === 'search_notebook') {
        const q = String(c.args.query || '');
        let hits = searchMemory(memories, q, 5);

        // "答应过什么" 这类问法，关键词一个都对不上，但意图明确。
        // 不补这一步，模型拿到空结果就会说"它没记过"，和提示里的记忆自相矛盾。
        if (promiseIntent(q)) {
          const proms = memories.filter(
            m => m.kind === 'promise' && !hits.some(h => h.id === m.id)
          );
          hits = [...hits, ...proms].slice(0, 5);
        }

        result = hits.length
          ? {
              found: hits.length,
              hits: hits.map(m => ({ kind: m.kind, day: m.day_count, content: m.content }))
            }
          : { found: 0, note: '本子里没有相关的。这件事它没记过。' };
      } else {
        result = { error: 'unknown_tool' };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  return '';
}

const TOOLS = [
  {
    name: 'ask_roommate',
    description: '跟这个室友说一句话，它会用自己的人设和记忆回答。答案通常很短、很冲，这是设计如此。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '要对它说的话' },
        model: { type: 'string', description: '可选，指定模型' }
      },
      required: ['message']
    },
    async handler({ message, model }) {
      if (!message) throw new Error('message 不能为空');
      const { room, memories, picked } = await snapshot({ withSearch: message });

      const messages = [
        { role: 'system', content: brain.systemPrompt(promptState(room, picked)) },
        { role: 'user', content: message }
      ];

      const text = await askLoop(messages, memories, model);

      // 谁跟它说话都算"来过"
      await patchRoom(KEY, { last_seen: new Date().toISOString() }).catch(() => {});

      return `${room.pet_name}：${text || '……'}`;
    }
  },
  {
    name: 'list_memories',
    description: '把它的记忆本列出来。可以按类型筛。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fact', 'like', 'hate', 'promise', 'lie', 'grudge', 'nickname'],
          description: '可选，只看某一类'
        },
        limit: { type: 'number', description: '最多几条，默认 30' }
      }
    },
    async handler({ kind, limit = 30 }) {
      needKey();
      const rows = await listMemories(KEY, { kind, limit });
      if (!rows.length) return '本子是空的。他没说过什么值得记的话。';
      return rows.map(m => {
        const k = (brain.KIND[m.kind] || {}).label || m.kind;
        const extra = [`第${m.day_count}天`, m.mentions ? `提起${m.mentions}次` : ''].filter(Boolean).join(' · ');
        return `#${m.id} [${k}] ${m.content}（${extra}）`;
      }).join('\n');
    }
  },
  {
    name: 'search_memory',
    description: '在记忆本里按关键词检索。中文按字和双字匹配，不需要分词。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    },
    async handler({ query, limit = 6 }) {
      needKey();
      const all = await listMemories(KEY, { limit: 200 });
      const hits = searchMemory(all, query, limit);
      if (!hits.length) return `没找到跟「${query}」有关的。`;
      return hits.map(m => `#${m.id} [${(brain.KIND[m.kind] || {}).label || m.kind}] ${m.content}`).join('\n');
    }
  },
  {
    name: 'remember',
    description: '替用户往记忆本里写一条。写进去之后，它以后就会拿这件事翻旧账。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fact', 'like', 'hate', 'promise', 'lie', 'grudge', 'nickname']
        },
        content: { type: 'string', description: '一句干净的中文陈述，比如"在成都做会计"' },
        weight: { type: 'number', description: '1 随口 / 3 一般 / 5 身份级，默认 3' }
      },
      required: ['kind', 'content']
    },
    async handler({ kind, content, weight = 3 }) {
      needKey();
      if (!content) throw new Error('content 不能为空');
      const room = await getRoom(KEY);
      const row = await addMemory(KEY, {
        kind, content, weight,
        day_count: (room && room.day_count) || 1
      });
      return `记下了：#${row.id} [${(brain.KIND[kind] || {}).label || kind}] ${content}`;
    }
  },
  {
    name: 'forget',
    description: '让它忘掉某一条记忆。不可撤销。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: '记忆的 id，先用 list_memories 查' } },
      required: ['id']
    },
    async handler({ id }) {
      needKey();
      const row = await deleteMemory(KEY, id);
      if (!row) return `没有 #${id} 这条。它本来就没记过。`;
      return `删掉了：#${id} ${row.content}`;
    }
  },
  {
    name: 'profile',
    description: '看它现在的状态：第几天、亲密度、心情、它对你的整体判断、欠了几笔账。',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      needKey();
      const { room, memories } = await snapshot();
      const first = room.first_seen ? new Date(room.first_seen).getTime() : Date.now();
      const day = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1, room.day_count || 1);
      const debts = memories.filter(m => m.kind === 'promise');
      const lines = [
        `名字：${room.pet_name}`,
        `你：${room.user_name || '你'}${room.nickname ? `（它管你叫「${room.nickname}」）` : ''}`,
        `第 ${day} 天 · 亲密度 ${room.affection ?? 12}/100 · 心情 ${room.mood || 'idle'}`,
        `记忆 ${memories.length} 条${room.cold_left ? ` · 正在冷战（还剩 ${room.cold_left} 句）` : ''}`,
        room.impression ? `它对你的判断：${room.impression}` : '它还没想好怎么形容你。',
        debts.length ? `欠账 ${debts.length} 笔：${debts.map(d => d.content).join('；')}` : '没有欠账。'
      ];
      return lines.join('\n');
    }
  },
  {
    name: 'timeline',
    description: '看你们的关系时间线：什么时候吵的架、什么时候和好的、什么时候它决定不理你。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } }
    },
    async handler({ limit = 20 }) {
      needKey();
      const rows = await listEvents(KEY, limit);
      if (!rows.length) return '什么都没发生过。你们还只是住在一个屋子里的两个东西。';
      return rows.map(e => {
        const meta = brain.EVENT_META[e.kind] || { label: e.kind };
        return `第${e.day_count}天 · ${meta.label}：${e.text}`;
      }).join('\n');
    }
  },
  {
    name: 'log_event',
    description: '往关系时间线上记一笔（吵架/和好/冷战/食言/瞬间/真心话）。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fight', 'makeup', 'cold', 'broken', 'moment', 'confess']
        },
        text: { type: 'string' }
      },
      required: ['kind', 'text']
    },
    async handler({ kind, text }) {
      needKey();
      const room = await getRoom(KEY);
      const row = await addEvent(KEY, { kind, text, day_count: (room && room.day_count) || 1 });
      return `已记入时间线：${text}（第${row.day_count}天）`;
    }
  }
];

/* ---------------- 资源 ---------------- */

const RESOURCES = [
  { uri: 'roommate://notebook', name: '记忆本', description: '它记住的关于你的一切', mimeType: 'text/markdown' },
  { uri: 'roommate://profile', name: '关系档案', description: '第几天、亲密度、它的判断', mimeType: 'text/markdown' },
  { uri: 'roommate://timeline', name: '关系时间线', description: '吵架、和好、冷战的历史', mimeType: 'text/markdown' }
];

async function readResource(uri) {
  if (uri === 'roommate://notebook') {
    const rows = await listMemories(KEY, { limit: 200 });
    const md = rows.map(m => {
      const k = (brain.KIND[m.kind] || {}).label || m.kind;
      return `- **${k}**（第${m.day_count}天）${m.content}`;
    }).join('\n');
    return `# 它的小本本\n\n共 ${rows.length} 条\n\n${md || '（空白）'}`;
  }
  if (uri === 'roommate://profile') {
    const t = TOOLS.find(x => x.name === 'profile');
    return '# 关系档案\n\n' + await t.handler({});
  }
  if (uri === 'roommate://timeline') {
    const t = TOOLS.find(x => x.name === 'timeline');
    return '# 关系时间线\n\n' + await t.handler({ limit: 40 });
  }
  throw new Error('未知资源：' + uri);
}

/* ---------------- JSON-RPC ---------------- */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  // 通知不需要回复
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') log('client initialized');
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || PROTOCOL,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: SERVER,
          instructions:
            '这是一个嘴很硬的 AI 室友。用 ask_roommate 跟它说话；' +
            '先看 profile 和 list_memories 了解它记得什么。它的回答很短，那是人设，不是出错。'
        });

      case 'ping':
        return reply(id, {});

      case 'tools/list':
        return reply(id, {
          tools: TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        });

      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        const tool = TOOLS.find(t => t.name === name);
        if (!tool) return fail(id, -32602, '没有这个工具：' + name);
        try {
          const out = await tool.handler(args);
          return reply(id, { content: [{ type: 'text', text: String(out) }] });
        } catch (err) {
          return reply(id, {
            content: [{ type: 'text', text: '出错了：' + err.message }],
            isError: true
          });
        }
      }

      case 'resources/list':
        return reply(id, { resources: RESOURCES });

      case 'resources/read': {
        const uri = params && params.uri;
        try {
          const text = await readResource(uri);
          const res = RESOURCES.find(r => r.uri === uri);
          return reply(id, {
            contents: [{ uri, mimeType: (res && res.mimeType) || 'text/plain', text }]
          });
        } catch (err) {
          return fail(id, -32602, err.message);
        }
      }

      case 'prompts/list':
        return reply(id, { prompts: [] });

      case 'shutdown':
        return reply(id, {});

      default:
        return fail(id, -32601, '不支持的方法：' + method);
    }
  } catch (err) {
    log('handler error', method, err.message);
    return fail(id, -32603, err.message);
  }
}

/* ---------------- 启动 ---------------- */

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', line => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    log('收到非 JSON 内容，忽略');
    return;
  }
  handle(msg).catch(err => log('unhandled', err && err.message));
});

rl.on('close', () => process.exit(0));

if (!KEY) {
  log('⚠️ 没有记忆钥匙。工具调用会失败，直到你设置 ROOMMATE_KEY 或 --key=。');
} else {
  log(`已连接钥匙 ${KEY}${NAME ? ' · ' + NAME : ''}`);
}
