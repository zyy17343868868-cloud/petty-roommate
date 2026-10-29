/* =========================================================
   app.js — 记仇室友 v2
   ---------------------------------------------------------
   这一版把"它"从"会说话的模型"改成了"会动手的代理"：
     · 主对话：可调只读工具（翻本子、看日历、加载技能）
     · 记账员：后台子代理，只有写权限，负责落记忆和改关系状态
   两套权限严格分开，见 tools.js。
   ========================================================= */

const CONFIG = {
  endpoint: 'https://petty-roommate.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_gm2wjBeJ7sDPwVmXahzkjR_Ltnx6wETfmmlG7pqiiV0MkYBnZi8wMJp'
};

const MODEL_PREFERENCE = ['deepseek-v4.1-flash', 'hunyuan-chat', 'glm-5.3-flash', 'minimax-m3.1-flash'];

const $ = id => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbg = (...a) => { if (DEBUG) console.log('[room]', ...a); };

let cloud = null;
let modelChain = [];
let modelIdx = 0;

const S = {
  petName: '', userName: '', nickname: '',
  dayCount: 1, affection: 12, mood: 'idle', impression: '',
  coldLeft: 0,
  memories: [], messages: [], events: [],
  gapHours: 0, firstSeen: Date.now(),
  skillBrief: '',
  ready: false,
  busy: false,
  filter: 'all',
  tab: 'mem'
};

const currentModel = () => modelChain[modelIdx] || null;

/* ================= 启动 ================= */
(async function boot() {
  mountOnboardCreature();
  bindUI();

  Room.mount($('scene'));

  await Skills.boot();
  S.skillBrief = Skills.brief();
  dbg('skills:', Skills.list().map(s => s.name));

  try {
    if (!window.WorkBuddyCloud) throw new Error('SDK_LOAD_FAILED');
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: CONFIG.endpoint,
      oauthRelayBaseUrl: CONFIG.oauthRelayBaseUrl,
      publishableKey: CONFIG.publishableKey
    });
    Store.init(cloud);
    await pickModels();
  } catch (err) {
    console.error(err);
    Store.init(null);
  }

  const data = await Store.boot();
  dbg('booted, online=', Store.online);

  if (!data || !data.room) {
    openOnboard();
    return;
  }
  await enterRoom(data);
})();

async function pickModels() {
  const models = await cloud.llm.models.list();
  if (!models || !models.length) throw new Error('NO_MODEL');
  const usable = models.filter(m => m.disabled !== true);
  const chain = [];
  MODEL_PREFERENCE.forEach(id => {
    const hit = usable.find(m => m.id === id);
    if (hit) chain.push(hit);
  });
  usable.forEach(m => {
    if (chain.some(o => o.id === m.id)) return;
    if (m.id === 'default') return;
    if (/video|image|embed/i.test(m.id)) return;
    chain.push(m);
  });
  modelChain = chain.slice(0, 5);
  modelIdx = 0;
  dbg('models:', modelChain.map(m => m.id));
  if (!modelChain.length) throw new Error('NO_MODEL');
}

/* ================= 工具执行上下文 ================= */
const toolCtx = {
  get S() { return S; },
  get Store() { return Store; },
  get Room() { return Room; },
  get Skills() { return Skills; },
  moodToFace,
  log: dbg,
  onMemory(m) {
    showMemChip(m.content);
    renderHUD();
    if (S.tab === 'mem') renderBook();
    // 攒到 3 条就该有一句画像了；之后每多 4 条重算一次
    if (S.memories.length >= 3 && (!S.impression || S.memories.length % 4 === 0)) refreshImpression();
  },
  onForget() {
    renderHUD();
    if (S.tab === 'mem') renderBook();
  },
  onAffection(d) {
    renderHUD();
    if (d) dbg('affection', d > 0 ? '+' + d : d);
  },
  onColdWar(turns) {
    renderColdBar();
    Room.setMood('annoyed');
    showSpeech('……');
  },
  onTimeline() {
    if (S.tab === 'line') renderTimeline();
  }
};

/* ================= 进屋子 ================= */
async function enterRoom(data) {
  const room = data.room;
  S.petName = room.pet_name;
  S.userName = room.user_name || '你';
  S.nickname = room.nickname || '';
  S.affection = room.affection ?? 12;
  S.mood = room.mood || 'idle';
  S.impression = room.impression || '';
  S.coldLeft = room.cold_left || 0;
  S.memories = (data.memories || []).map(normalizeMemory);
  S.messages = data.messages || [];
  S.events = data.events || [];

  const first = new Date(room.first_seen || Date.now()).getTime();
  const last = new Date(room.last_seen || Date.now()).getTime();
  S.firstSeen = first;
  const computedDay = Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1);
  S.dayCount = Math.max(computedDay, room.day_count || 1);
  S.gapHours = Math.max(0, (Date.now() - last) / 3600000);

  if (S.gapHours >= 24) {
    const days = Math.floor(S.gapHours / 24);
    S.affection = Math.max(4, S.affection - Math.min(18, days * 2));
  }

  Room.setMood(moodToFace(S.mood));
  renderHUD();
  renderMessages();
  renderColdBar();
  $('onboard').classList.add('hidden');
  S.ready = true;

  await Store.patchRoom({
    day_count: S.dayCount,
    affection: S.affection,
    last_seen: new Date().toISOString()
  });

  setTimeout(() => runGreeting(), 620);
  if (S.memories.length >= 3 && !S.impression) setTimeout(() => refreshImpression(), 2600);
}

function normalizeMemory(m) {
  return {
    id: m.id,
    kind: m.kind || 'fact',
    content: m.content,
    weight: m.weight || 3,
    mentions: m.mentions || 0,
    day_count: m.day_count || 1,
    created_at: m.created_at
  };
}

function moodToFace(m) {
  return { happy: 'happy', smug: 'smug', annoyed: 'annoyed', sad: 'sad', sleepy: 'sleepy' }[m] || 'idle';
}

/* ================= 领养 ================= */
function mountOnboardCreature() {
  const el = $('obCreature');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '142 128 116 114');
  svg.style.width = '100%';
  svg.style.height = '100%';
  el.appendChild(svg);
  Room.mount(svg, { bare: true });
  Room.setMood('idle');
  $('petNameInput').value = PET_NAMES[Math.floor(Math.random() * PET_NAMES.length)];
}

function openOnboard() {
  $('onboard').classList.remove('hidden');
  requestAnimationFrame(() => $('onboard').classList.add('show'));
  $('userNameInput').focus();
}

async function adopt() {
  const petName = ($('petNameInput').value || '').trim() || pick(PET_NAMES);
  const userName = ($('userNameInput').value || '').trim() || '你';

  const btn = $('adoptBtn');
  btn.disabled = true;
  btn.textContent = '开门中…';

  const room = await Store.createRoom({ petName, userName });
  $('onboard').classList.remove('show');
  setTimeout(() => $('onboard').classList.add('hidden'), 320);

  await enterRoom({ room, memories: [], messages: [], events: [] });
}

/* ================= 打招呼 ================= */
async function runGreeting() {
  if (!S.ready) return;

  if (!S.messages.length) {
    const text = await chatOnce({
      system: systemPrompt(buildPromptState()),
      user: `（你刚搬进来，这是你们第一次见面。他叫${S.userName}。用一句话打量他，不超过25字，不要热情，不要自我介绍式的客套。）`
    }).catch(() => null);
    say(text || `你就是${S.userName}。行吧。`, { save: true });
    return;
  }

  if (S.gapHours >= 8) {
    const top = [...S.memories].sort((a, b) => b.weight - a.weight)[0];
    let line = null;
    if (S.gapHours >= 20) {
      line = await chatOnce({
        system: '你说话很短，不超过 32 个字。',
        user: returnPrompt({
          petName: S.petName,
          userName: S.userName,
          hours: Math.round(S.gapHours),
          memory: top ? top.content : ''
        })
      }).catch(() => null);
    }
    say(line || backLine(S.gapHours) || `${Math.round(S.gapHours)} 小时。我数着呢。`, { save: true });
    Room.setMood(S.gapHours >= 24 ? 'annoyed' : 'idle');
  }
}

/* ================= 说话（主代理） ================= */
async function send(text) {
  text = (text || '').trim();
  if (!text || S.busy || !S.ready) return;

  S.busy = true;
  $('sendBtn').disabled = true;
  $('input').value = '';

  pushMessage('me', text);
  Store.addMessage('me', text);

  const cold = S.coldLeft > 0;
  const traceEl = pushTrace();
  const bubble = pushPetBubble();

  let reply = '';
  try {
    if (cold) {
      reply = await runColdTurn(text, chunk => {
        reply += chunk;
        bubble.textContent = reply;
        scrollLog();
      });
      traceEl.remove();
    } else {
      const messages = buildChatMessages(text);
      const out = await Agent.run({
        messages,
        scope: 'main',
        ctx: toolCtx,
        temperature: 1.0,
        maxTurns: 3,
        onText: chunk => {
          bubble.classList.remove('thinking-bubble');
          bubble.textContent = reply + chunk;
          reply += chunk;
          scrollLog();
        },
        onTool: ev => renderTrace(traceEl, ev)
      });
      reply = out.text || reply;
      if (!reply) {
        bubble.textContent = '……';
        traceEl.remove();
      } else if (!out.toolCalls) {
        traceEl.remove();     // 没动用工具，就别留空壳
      }
    }
  } catch (err) {
    console.error(err);
    bubble.textContent = '（它张了张嘴，没出声。）';
    traceEl.remove();
    toast('它好像卡住了，再说一句试试');
    S.busy = false;
    $('sendBtn').disabled = false;
    return;
  }

  reply = clean(reply || '') || '……';
  bubble.textContent = reply;
  bubble.classList.remove('thinking-bubble');
  S.messages.push({ role: 'pet', content: reply, created_at: new Date().toISOString() });
  Store.addMessage('pet', reply);
  scrollLog();
  updateTip();

  showSpeech(reply);
  guessMood(reply);

  S.busy = false;
  $('sendBtn').disabled = false;
  $('input').focus();

  if (cold) {
    S.coldLeft = Math.max(0, S.coldLeft - 1);
    await Store.patchRoom({ cold_left: S.coldLeft });
    renderColdBar();
    if (S.coldLeft === 0) {
      setTimeout(() => {
        Room.setMood('sad');
        const line = pick(LINES.melted);
        showSpeech(line);
        pushMessage('pet', line);
        Store.addMessage('pet', line);
      }, 1400);
    }
    return;
  }

  // 后台记账员，不阻塞界面
  bookkeep(text, reply).catch(e => dbg('bookkeep failed', e));
}

/* 冷战轮：短、不带工具 */
async function runColdTurn(userText, onChunk) {
  const msgs = [
    { role: 'system', content: coldWarPrompt({ petName: S.petName, userName: S.userName, coldLeft: S.coldLeft }) },
    ...S.messages.slice(0, -1).slice(-4).map(m => ({
      role: m.role === 'pet' ? 'assistant' : 'user',
      content: m.content
    })),
    { role: 'user', content: userText }
  ];
  let full = '';
  const out = await Agent.streamTurn({
    messages: msgs,
    tools: [],
    temperature: 0.8,
    onText: c => { full += c; onChunk(c); }
  });
  return clean(out.text || full) || '嗯。';
}

/* ================= 后台记账员 ================= */
async function bookkeep(userText, petText) {
  const messages = [
    {
      role: 'system',
      content: bookkeeperPrompt({
        petName: S.petName,
        userName: S.userName,
        existing: S.memories.map(m => ({ id: m.id, kind: m.kind, content: m.content }))
      })
    },
    {
      role: 'user',
      content: `用户：${userText}\n${S.petName}：${petText}`
    }
  ];

  const traceEl = pushTrace({ book: true });

  const out = await Agent.run({
    messages,
    scope: 'book',
    ctx: toolCtx,
    temperature: 0.3,
    maxTurns: 2,
    onText: () => {},
    onTool: ev => renderTrace(traceEl, ev)
  });

  if (!out.toolCalls) traceEl.remove();
  else setTimeout(() => traceEl.classList.add('fade'), 6000);

  dbg('bookkeeper done, tools=', out.toolCalls);
}

/* ================= 消息渲染 ================= */
function pushMessage(role, content) {
  S.messages.push({ role, content, created_at: new Date().toISOString() });
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = content;
  $('log').appendChild(el);
  scrollLog();
  updateTip();
  return el;
}

function updateTip() {
  const el = $('logTip');
  if (el) el.classList.toggle('hide', S.messages.length >= 4);
}

function say(text, { save = true } = {}) {
  text = (text || '').trim();
  if (!text) return;
  pushMessage('pet', text);
  showSpeech(text);
  guessMood(text);
  if (save) Store.addMessage('pet', text);
}

function pushPetBubble() {
  const el = document.createElement('div');
  el.className = 'msg pet thinking-bubble';
  el.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span>';
  $('log').appendChild(el);
  scrollLog();
  return el;
}

/* ---------- 工具轨迹：让"它在动手"这件事看得见 ---------- */

const TOOL_UI = {
  search_notebook: { ico: '⌕', label: '翻小本子', done: r => r.found ? `找到 ${r.found} 条` : '没找到' },
  recall_day:      { ico: '☰', label: '回想那天', done: r => r.lines ? `${r.lines.length} 句` : '空白' },
  check_calendar:  { ico: '◷', label: '看了眼日历', done: r => r.day ? `第 ${r.day} 天` : '' },
  load_skill:      { ico: '✦', label: '翻手册', done: r => r.skill ? r.skill : '没这手册' },
  set_mood:        { ico: '☺', label: '换了表情', done: r => r.mood || '' },
  write_timeline:  { ico: '✎', label: '记进时间线', done: r => r.recorded ? '已记' : '' },
  remember:        { ico: '✎', label: '记下', done: r => r.content || '' },
  reinforce:       { ico: '＋', label: '加重', done: r => r.content || '' },
  forget_memory:   { ico: '⌫', label: '划掉', done: r => r.forgot || '' },
  set_nickname:    { ico: '❞', label: '起外号', done: r => r.nickname || '' },
  update_affection:{ ico: '♥', label: '亲密度', done: r => (r.changed > 0 ? '+' : '') + (r.changed ?? 0) },
  start_cold_war:  { ico: '❄', label: '决定不理他', done: r => r.turns ? `${r.turns} 轮` : '' }
};

function pushTrace({ book = false } = {}) {
  const el = document.createElement('div');
  el.className = 'trace' + (book ? ' book' : '');
  $('log').appendChild(el);
  scrollLog();
  return el;
}

function renderTrace(container, ev) {
  if (!container) return;
  const meta = TOOL_UI[ev.name] || { ico: '·', label: ev.name, done: () => '' };

  if (ev.phase === 'start') {
    const row = document.createElement('div');
    row.className = 'trace-row live';
    row.dataset.tool = ev.name;
    row.innerHTML = `<i>${meta.ico}</i><span>${meta.label}</span><em></em>`;
    container.appendChild(row);
    // 记住"这一句是哪个工具发起的"，done 事件按顺序认领
    (container._pending || (container._pending = [])).push(row);
    scrollLog();
    return;
  }

  const result = ev.result || {};
  const tail = result.error ? '失败' : (meta.done(result) || '');
  const row = (container._pending || []).shift();
  if (!row) return;
  row.classList.remove('live');
  row.classList.add(result.error ? 'err' : 'ok');
  row.querySelector('em').textContent = tail;
  container.classList.add('has-rows');
  scrollLog();
}

function renderMessages() {
  const log = $('log');
  log.innerHTML = '';
  let lastDay = 0;

  S.messages.slice(-24).forEach(m => {
    const t = m.created_at ? new Date(m.created_at).getTime() : Date.now();
    const day = Math.max(1, Math.floor((t - S.firstSeen) / 86400000) + 1);
    if (day !== lastDay) {
      const d = document.createElement('div');
      d.className = 'msg sys';
      d.textContent = day === 1 ? '第 1 天 · 你们第一次见面' : `第 ${day} 天`;
      log.appendChild(d);
      lastDay = day;
    }
    const el = document.createElement('div');
    el.className = 'msg ' + (m.role === 'pet' ? 'pet' : 'me');
    el.textContent = m.content;
    log.appendChild(el);
  });

  if (!S.messages.length) {
    const d = document.createElement('div');
    d.className = 'msg sys';
    d.textContent = '第 1 天 · 你们第一次见面';
    log.appendChild(d);
  }
  updateTip();
  scrollLog();
}

function scrollLog() {
  const log = $('log');
  log.scrollTop = log.scrollHeight;
}

function showSpeech(text) {
  const sp = $('speech');
  sp.textContent = text;
  sp.classList.add('show');
  clearTimeout(showSpeech._t);
  showSpeech._t = setTimeout(() => sp.classList.remove('show'), Math.max(4200, text.length * 240));
}

/* 记忆写入时房间左上角的小提示 */
function showMemChip(text) {
  const chip = $('memChip');
  if (!chip) return;
  chip.innerHTML = `✎ 记下了：<b>${escapeHTML(text)}</b>`;
  chip.classList.add('show');
  clearTimeout(showMemChip._t);
  showMemChip._t = setTimeout(() => chip.classList.remove('show'), 4600);
}

function guessMood(text) {
  let face = 'idle';
  if (/[哼切]|少来|不在乎|随便/.test(text)) face = 'smug';
  if (/烦|闭嘴|滚|别问|懒得/.test(text)) face = 'annoyed';
  if (/[哈笑]|好耶|当然/.test(text)) face = 'happy';
  if (/……|\.\.\.|算了|随便你/.test(text)) face = 'sad';
  if (S.coldLeft > 0) face = 'annoyed';
  Room.setMood(face);
}

/* ================= 消息组装 ================= */
function buildPromptState() {
  return {
    petName: S.petName,
    userName: S.userName,
    nickname: S.nickname,
    dayCount: S.dayCount,
    affection: S.affection,
    mood: S.mood,
    memories: selectMemories(),
    skillBrief: S.skillBrief,
    gapNote: S.gapHours >= 24
      ? `对方已经 ${Math.round(S.gapHours)} 小时没来了，你心里有数，但别提"我等你"这种话。`
      : ''
  };
}

function buildChatMessages(userText) {
  const msgs = [{ role: 'system', content: systemPrompt(buildPromptState()) }];
  S.messages.slice(0, -1).slice(-8).forEach(m => {
    const role = m.role === 'pet' ? 'assistant' : 'user';
    // 太短的旧消息不值得占上下文
    if (role === 'user' && m.content.length < 4) return;
    msgs.push({ role, content: m.content });
  });
  msgs.push({ role: 'user', content: userText });
  return msgs;
}

function selectMemories(limit = 8) {
  const scored = S.memories.map(m => {
    const age = m.created_at ? (Date.now() - new Date(m.created_at).getTime()) / 86400000 : 0;
    return { m, score: m.weight * 10 - Math.min(10, m.mentions * 2) - Math.min(6, age * 0.3) };
  });
  scored.sort((a, b) => b.score - a.score);

  const out = [], used = {};
  for (const { m } of scored) {
    if (out.length >= limit) break;
    if (used[m.kind] >= 3) continue;
    used[m.kind] = (used[m.kind] || 0) + 1;
    out.push(m);
  }
  return out;
}

/* ================= 单次调用（非代理场景） ================= */
async function collect(messages, { temperature = 0.85 } = {}) {
  const out = await Agent.streamTurn({ messages, tools: [], temperature, onText: () => {} });
  if (!out.text) throw new Error('EMPTY');
  return out.text;
}

async function chatOnce({ system, user }) {
  const raw = await collect([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]);
  return clean(raw);
}

function clean(t) {
  return (t || '')
    .replace(/^["“「]|["”」]$/g, '')
    .replace(/^[^\s：:]{1,6}[：:]\s*/, '')
    .replace(/\n+/g, ' ')
    .trim();
}

/* ================= 画像刷新 ================= */
async function refreshImpression() {
  if (S.memories.length < 3) return;
  const text = await chatOnce({
    system: '你只输出一句话，不要引号，不要解释。',
    user: impressionPrompt({ userName: S.userName, memories: S.memories })
  }).catch(() => null);
  if (!text) return;
  S.impression = text.slice(0, 40);
  await Store.patchRoom({ impression: S.impression });
  if (S.tab === 'mem') renderBook();
}

/* ================= HUD ================= */
function renderHUD() {
  $('hudName').textContent = S.petName;
  $('dayNum').textContent = S.dayCount;
  $('memCount').textContent = S.memories.length;
  $('memCount').classList.toggle('zero', S.memories.length === 0);
  $('affFill').style.width = S.affection + '%';

  const debts = S.memories.filter(m => m.kind === 'promise').length;
  $('affText').textContent = debts
    ? `亲密度 ${S.affection} · 欠 ${debts} 笔`
    : `亲密度 ${S.affection}`;

  const tag = $('nickTag');
  if (tag) {
    tag.textContent = S.nickname ? `叫你「${S.nickname}」` : '';
    tag.classList.toggle('hidden', !S.nickname);
  }
}

function renderColdBar() {
  const bar = $('coldBar');
  if (!bar) return;
  if (S.coldLeft > 0) {
    bar.classList.add('show');
    $('coldText').textContent = `它正在跟你冷战 · 还剩 ${S.coldLeft} 句`;
  } else {
    bar.classList.remove('show');
  }
}

/* ================= 记忆本 ================= */
function openBook() {
  $('bookSheet').classList.add('show');
  $('bookBtn').classList.add('on');
  renderFilters();
  renderBook();
}

function closeSheet(el) {
  el.classList.remove('show');
  $('bookBtn').classList.remove('on');
}

function switchTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
  $('memList').classList.toggle('hidden', tab !== 'mem');
  $('filters').classList.toggle('hidden', tab !== 'mem');
  $('timeline').classList.toggle('hidden', tab !== 'line');
  if (tab === 'mem') { renderFilters(); renderBook(); }
  else renderTimeline();
}

function renderFilters() {
  const kinds = ['all', ...Object.keys(KIND)];
  const box = $('filters');
  box.innerHTML = '';
  kinds.forEach(k => {
    const n = k === 'all' ? S.memories.length : S.memories.filter(m => m.kind === k).length;
    if (k !== 'all' && n === 0) return;
    const b = document.createElement('button');
    b.className = 'chip' + (S.filter === k ? ' on' : '');
    b.textContent = k === 'all' ? `全部 ${n}` : `${KIND[k].label} ${n}`;
    b.onclick = () => { S.filter = k; renderFilters(); renderBook(); };
    box.appendChild(b);
  });
}

function renderBook() {
  $('memCount').textContent = S.memories.length;
  $('impression').textContent = S.impression || '它还没想好怎么形容你。再多说几句。';

  const list = $('memList');
  list.innerHTML = '';

  let items = S.memories.slice();
  if (S.filter !== 'all') items = items.filter(m => m.kind === S.filter);
  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  if (!items.length) {
    list.innerHTML = `<div class="empty">${S.memories.length ? '这一类是空的。' : '本子还是白的。<br>你没说什么值得记的话。'}</div>`;
    return;
  }

  items.forEach(m => {
    const k = KIND[m.kind] || KIND.fact;
    const card = document.createElement('div');
    card.className = 'memcard';
    card.style.setProperty('--k', k.color);
    card.innerHTML = `
      <div class="mtext">${escapeHTML(m.content)}</div>
      <div class="mmeta">
        <span class="mkind">${k.label}</span>
        <span>第 ${m.day_count} 天</span>
        ${m.mentions ? `<span>提起过 ${m.mentions} 次</span>` : ''}
        <button class="forget">让它忘掉</button>
      </div>`;
    card.querySelector('.forget').onclick = () => forgetMemory(m);
    list.appendChild(card);
  });
}

function renderTimeline() {
  const box = $('timeline');
  box.innerHTML = '';
  const list = S.events.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  if (!list.length) {
    box.innerHTML = '<div class="empty">什么都没发生过。<br>你们还只是住在一个屋子里的两个东西。</div>';
    return;
  }

  let lastDay = 0;
  list.forEach(ev => {
    const meta = EVENT_META[ev.kind] || EVENT_META.moment;
    if (ev.day_count !== lastDay) {
      const d = document.createElement('div');
      d.className = 'tl-day';
      d.textContent = `第 ${ev.day_count} 天`;
      box.appendChild(d);
      lastDay = ev.day_count;
    }
    const row = document.createElement('div');
    row.className = 'tl-row';
    row.style.setProperty('--c', meta.color);
    row.innerHTML = `<i></i><div><b>${meta.label}</b><span>${escapeHTML(ev.text)}</span></div>`;
    box.appendChild(row);
  });
}

async function forgetMemory(m) {
  S.memories = S.memories.filter(x => x !== m);
  await Store.deleteMemory(m.id);
  renderBook();
  renderHUD();
  const line = pick(LINES.forget);
  showSpeech(line);
  pushMessage('pet', line);
  Store.addMessage('pet', line);
  Room.setMood('sad');
  toast('它说它不在意。');
}

/* ================= 显式技能调用：查账 ================= */
async function runAudit() {
  if (!S.ready || S.busy) return;
  closeSheet($('bookSheet'));

  const manual = await Skills.load('promise-audit');
  const line = '把你记的、我答应过的事，念出来。';

  S.busy = true;
  $('sendBtn').disabled = true;

  pushMessage('me', line);
  Store.addMessage('me', line);

  const traceEl = pushTrace();
  const bubble = pushPetBubble();

  let reply = '';
  try {
    const messages = [
      {
        role: 'system',
        content: systemPrompt(buildPromptState()) +
          `\n\n## 本轮任务手册（界面已强制加载，不必再调 load_skill）\n${manual || '（手册缺失，按你自己的想法做）'}`
      },
      { role: 'user', content: line }
    ];

    const out = await Agent.run({
      messages,
      scope: 'main',
      ctx: toolCtx,
      temperature: 0.85,
      maxTurns: 3,
      onText: chunk => {
        reply += chunk;
        bubble.classList.remove('thinking-bubble');
        bubble.textContent = reply;
        scrollLog();
      },
      onTool: ev => renderTrace(traceEl, ev)
    });

    reply = out.text || reply;
  } catch (err) {
    console.error(err);
    reply = '';
  }

  S.busy = false;
  $('sendBtn').disabled = false;

  if (!reply) {
    bubble.textContent = '（它翻了两页，把本子合上了。）';
    traceEl.remove();
    return;
  }
  bubble.textContent = reply;
  bubble.classList.remove('thinking-bubble');
  S.messages.push({ role: 'pet', content: reply, created_at: new Date().toISOString() });
  Store.addMessage('pet', reply);
  showSpeech(reply);
  guessMood(reply);
  scrollLog();
}

/* ================= 海报 ================= */
function openPoster() {
  if (!S.memories.length) { toast('它还没记住任何事，先聊几句'); return; }

  const top = [...S.memories].sort((a, b) => b.weight - a.weight).slice(0, 6);

  Poster.draw({
    petName: S.petName,
    userName: S.userName,
    nickname: S.nickname,
    dayCount: S.dayCount,
    affection: S.affection,
    total: S.memories.length,
    debts: S.memories.filter(m => m.kind === 'promise').length,
    impression: S.impression || '这个人话不多，但每句都留着。',
    memories: top
  });

  $('posterModal').classList.remove('hidden');
  requestAnimationFrame(() => $('posterModal').classList.add('show'));
}

function downloadPoster() {
  const url = $('posterCanvas').toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${S.petName}的记忆本-第${S.dayCount}天.png`;
  a.click();
}

/* ================= 设置 ================= */
function openSettings() {
  $('memKey').textContent = Store.key;
  const cmd = $('mcpCmd');
  if (cmd) cmd.textContent = `node mcp-server/server.mjs --key=${Store.key}`;
  $('setSheet').classList.add('show');
}

function mcpCommand() {
  return `node mcp-server/server.mjs --key=${Store.key}`;
}

async function skipDays() {
  const back = new Date(Date.now() - 3 * 86400000).toISOString();
  await Store.patchRoom({ last_seen: back, day_count: S.dayCount + 3 }, false);
  showSpeech('……你终于回来了。');
  toast('时间已快进三天');
  setTimeout(() => location.reload(), 900);
}

async function endColdWar() {
  S.coldLeft = 0;
  await Store.patchRoom({ cold_left: 0 });
  renderColdBar();
  toast('冷战已结束（它不知道是你按的）');
  location.reload();
}

async function resetAll() {
  if (!confirm('它会把你说过的每句话都忘掉，包括你。确定？')) return;
  await Store.reset();
  location.reload();
}

/* ================= 绑定 ================= */
function bindUI() {
  $('composer').addEventListener('submit', e => {
    e.preventDefault();
    send($('input').value);
  });
  $('adoptBtn').onclick = adopt;
  $('haveKeyBtn').onclick = () => $('obKeyBox').classList.toggle('hidden');
  $('enterKeyBtn').onclick = () => {
    const k = ($('keyInput').value || '').trim().toLowerCase();
    if (k.length < 6) { toast('这把钥匙太短了'); return; }
    Store.setKey(k);
    location.reload();
  };
  $('bookBtn').onclick = openBook;
  $('setBtn').onclick = openSettings;
  $('posterBtn').onclick = openPoster;
  $('downloadBtn').onclick = downloadPoster;
  $('auditBtn').onclick = runAudit;

  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.onclick = () => {
      const sheet = btn.closest('.sheet');
      if (sheet) closeSheet(sheet);
      const ov = btn.closest('.overlay');
      if (ov) {
        ov.classList.remove('show');
        setTimeout(() => ov.classList.add('hidden'), 300);
      }
    };
  });

  document.querySelectorAll('.sheet').forEach(sh => {
    sh.addEventListener('click', e => { if (e.target === sh) closeSheet(sh); });
  });

  let pressTimer = null;
  $('hudName').addEventListener('pointerdown', () => {
    pressTimer = setTimeout(() => {
      $('memKey').textContent = Store.key;
      $('setSheet').classList.add('show');
    }, 620);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    $('hudName').addEventListener(ev, () => clearTimeout(pressTimer))
  );

  $('copyKeyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(Store.key); toast('钥匙复制好了'); }
    catch { toast('复制失败，手动记一下吧'); }
  };
  $('copyMcpBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(mcpCommand()); toast('命令复制好了'); }
    catch { toast('复制失败，手动记一下吧'); }
  };
  $('skipBtn').onclick = skipDays;
  $('coldBtn').onclick = endColdWar;
  $('resetBtn').onclick = resetAll;

  document.addEventListener('pointermove', e => Room.follow(e.clientX, e.clientY));
  $('input').addEventListener('focus', () => setTimeout(scrollLog, 260));
}

/* ================= 小工具 ================= */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/* 调试入口：只在 ?debug 时挂出去，供自动化验收用。放在文件末尾，
   确保所有 const 都已经初始化完（曾经因为放在 bindUI 里踩过 TDZ）。 */
if (DEBUG) {
  window.__dbg = {
    S, Tools, Skills, Store, Agent, toolCtx,
    get model() { return currentModel(); },
    get chain() { return modelChain; }
  };
}
