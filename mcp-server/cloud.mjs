/* =========================================================
   cloud.mjs — MCP server 的数据与模型通道
   ---------------------------------------------------------
   这里不走 SDK，直接说平台的两条底层接口：
     · PostgREST： POST {endpoint}/.cloud/database/rest/<table>
     · Chat：      POST {endpoint}/.cloud/llm/chat/completions （SSE）
   认证头只有一个：x-wb-webapp-access-key = publishableKey

   为什么不引 SDK：MCP server 是长驻进程，越少依赖越好；
   而且这两条接口本身就是 HTTP，没必要为了包一层再装几百个包。
   ========================================================= */

export const ENDPOINT = process.env.ROOMMATE_ENDPOINT || 'https://petty-roommate.app.workbuddy.host';
export const PUBLISHABLE_KEY = process.env.ROOMMATE_PUBLISHABLE_KEY ||
  'wbpk_gm2wjBeJ7sDPwVmXahzkjR_Ltnx6wETfmmlG7pqiiV0MkYBnZi8wMJp';

const REST = ENDPOINT + '/.cloud/database/rest';
const CHAT = ENDPOINT + '/.cloud/llm/chat/completions';

function headers(extra = {}) {
  return {
    'x-wb-webapp-access-key': PUBLISHABLE_KEY,
    ...extra
  };
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const h = headers();
  if (body !== undefined) h['content-type'] = 'application/json';
  if (prefer) h['prefer'] = prefer;

  const res = await fetch(`${REST}/${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DB ${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  }
  return text ? JSON.parse(text) : null;
}

/* ---------------- 数据 ---------------- */

export async function getRoom(key) {
  const rows = await rest(`roommates?select=*&owner_key=eq.${encodeURIComponent(key)}`);
  return rows && rows[0] ? rows[0] : null;
}

export async function ensureRoom(key, petName = '小北', userName = '你') {
  const room = await getRoom(key);
  if (room) return room;
  const rows = await rest('roommates?select=*', {
    method: 'POST',
    body: { owner_key: key, pet_name: petName, user_name: userName, day_count: 1, affection: 12, mood: 'idle' },
    prefer: 'return=representation'
  });
  return rows && rows[0];
}

export async function patchRoom(key, patch) {
  return rest(`roommates?owner_key=eq.${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation'
  });
}

export async function listMemories(key, { kind, limit = 80 } = {}) {
  let q = `memories?select=*&owner_key=eq.${encodeURIComponent(key)}&order=weight.desc,created_at.desc&limit=${limit}`;
  if (kind) q += `&kind=eq.${encodeURIComponent(kind)}`;
  return (await rest(q)) || [];
}

export async function addMemory(key, { kind = 'fact', content, weight = 3, day_count = 1 }) {
  const rows = await rest('memories?select=*', {
    method: 'POST',
    body: { owner_key: key, kind, content, weight, day_count },
    prefer: 'return=representation'
  });
  return rows && rows[0];
}

export async function deleteMemory(key, id) {
  const rows = await rest(
    `memories?id=eq.${encodeURIComponent(id)}&owner_key=eq.${encodeURIComponent(key)}&select=*`,
    { method: 'DELETE', prefer: 'return=representation' }
  );
  return rows && rows.length ? rows[0] : null;
}

export async function listEvents(key, limit = 40) {
  return (await rest(
    `events?select=*&owner_key=eq.${encodeURIComponent(key)}&order=created_at.desc&limit=${limit}`
  )) || [];
}

export async function addEvent(key, { kind = 'moment', text, day_count = 1 }) {
  const rows = await rest('events?select=*', {
    method: 'POST',
    body: { owner_key: key, kind, text, day_count },
    prefer: 'return=representation'
  });
  return rows && rows[0];
}

/* ---------------- 模型（这条通道只支持流式） ---------------- */

export const MODELS = ['deepseek-v4.1-flash', 'hunyuan-chat', 'glm-5.3-flash', 'minimax-m3.1-flash'];

/**
 * 流式请求，收完当整体用。
 * @returns {Promise<{text:string, calls:Array<{id,name,args}>}>}
 */
export async function chat(messages, { model, temperature = 1, maxTokens, tools } = {}) {
  const body = { model: model || MODELS[0], messages, stream: true, temperature };
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }

  const res = await fetch(CHAT, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status} ${t.slice(0, 160)}`);
  }

  let full = '';
  let buf = '';
  const callBuf = {};
  const decoder = new TextDecoder();

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) continue;
        if (typeof d.content === 'string') full += d.content;
        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            const i = tc.index == null ? 0 : tc.index;
            const slot = callBuf[i] || (callBuf[i] = { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name += tc.function.name;
            if (tc.function && tc.function.arguments) slot.args += tc.function.arguments;
          }
        }
      } catch { /* 心跳或半包，丢掉 */ }
    }
  }

  const calls = Object.entries(callBuf)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([i, c]) => {
      let args = {};
      try { args = JSON.parse(c.args || '{}'); } catch { args = {}; }
      return { id: c.id || `call_${i}`, name: c.name, args, raw: c.args || '{}' };
    })
    .filter(c => c.name);

  return { text: stripToolText(full.trim()), calls };
}

/** 有些模型在没有 tools 参数时会把手写的 <tool_call> 塞进正文，兜底剥掉 */
function stripToolText(s) {
  return String(s)
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/<\|[^>]*\|>/g, '')
    .trim();
}

/* ---------------- 检索（服务端自己的一份） ---------------- */

const STOP = new Set('的了是我你他她在有和就都也还吗呢吧啊这那'.split(''));

export function grams(s) {
  const clean = String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const set = new Set();
  for (const ch of clean) if (!STOP.has(ch)) set.add(ch);
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  if (clean.length > 1) set.add(clean);
  return [...set];
}

/** "我答应过什么" 这类问法，关键词往往一个都对不上，得靠意图路由到 promise 类 */
export function promiseIntent(q) {
  return /答应|承诺|说过|许过|保证|讲好的|说好/.test(String(q || ''));
}

export function searchMemory(memories, query, limit = 6) {
  const qs = grams(query);
  return memories
    .map(m => {
      const t = m.content || '';
      let s = 0;
      for (const g of qs) if (g && t.includes(g)) s += g.length >= 2 ? 2 : 0.6;
      return { m, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.m);
}
