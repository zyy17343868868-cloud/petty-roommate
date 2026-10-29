/* =========================================================
   tools.js — 它能做的事（工具注册表）
   ---------------------------------------------------------
   两类工具，权限严格分开：
     scope = 'main'  对话时可用：查本子、看日历、加载技能、换表情、记事件
     scope = 'book'  记账员可用：写记忆、加权、忘记、起外号、改亲密度、开冷战

   核心理由：说话的那个"它"不该有篡改自己记忆的权力。
   记忆写入交给独立的记账员子代理，出问题也好查。
   ========================================================= */

const Tools = (() => {

  const reg = new Map();

  function define(spec) {
    reg.set(spec.name, spec);
    return spec;
  }

  /** 给模型看的 schema（OpenAI function calling 格式） */
  function defs(scope) {
    return [...reg.values()]
      .filter(t => [].concat(t.scope).includes(scope))
      .map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
  }

  /** 执行一个工具调用 */
  async function call(name, args, ctx) {
    const t = reg.get(name);
    if (!t) return { error: 'unknown_tool', name };
    try {
      const out = await t.run(args || {}, ctx);
      return out === undefined ? { ok: true } : out;
    } catch (err) {
      console.warn('[tool] 失败', name, err && err.message);
      return { error: String((err && err.message) || err).slice(0, 160) };
    }
  }

  function has(name) { return reg.has(name); }
  function names(scope) { return [...reg.values()].filter(t => t.scope === scope).map(t => t.name); }

  /* ================= 检索小工具 ================= */

  const STOP = ['的', '了', '是', '我', '你', '他', '她', '在', '有', '和', '就', '都', '也', '还', '吗', '呢', '吧', '啊', '这', '那'];

  /** 无分词库的中文粗检索：单字 + 双字 + 全串 */
  function grams(s) {
    const clean = String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    const set = new Set();
    for (const ch of clean) if (!STOP.includes(ch)) set.add(ch);
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    if (clean.length > 1) set.add(clean);
    return [...set];
  }

  function score(text, qs) {
    const t = String(text || '');
    let s = 0;
    for (const g of qs) {
      if (!g) continue;
      if (t.includes(g)) s += g.length >= 2 ? 2 : 0.6;
    }
    return s;
  }

  /* ================= main scope（对话期） ================= */

  define({
    name: 'search_notebook',
    scope: 'main',
    description: '翻自己的小本本，按关键词找关于对方的旧记忆。当对方提到过去的事、你要翻旧账、或者需要确认某个细节时用。不要每次说话都调用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要找的关键词，比如"早睡""面试""猫"' },
        kind: {
          type: 'string',
          description: '可选，只看某一类',
          enum: ['fact', 'like', 'hate', 'promise', 'lie', 'grudge', 'nickname']
        }
      },
      required: ['query']
    },
    run(args, ctx) {
      const qs = grams(args.query);
      let pool = ctx.S.memories.slice();
      if (args.kind) pool = pool.filter(m => m.kind === args.kind);

      const hits = pool
        .map(m => ({ m, s: score(m.content, qs) + (args.kind && m.kind === args.kind ? 1 : 0) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);

      // "我答应过什么" 这类问法关键词一个都对不上，靠意图路由到 promise 类
      let out = hits;
      if (/答应|承诺|说过|许过|保证|讲好的|说好/.test(args.query || '')) {
        const proms = pool
          .filter(m => m.kind === 'promise' && !hits.some(h => h.m === m))
          .map(m => ({ m, s: 1 }));
        out = [...hits, ...proms].slice(0, 5);
      }

      if (!out.length) return { found: 0, note: '本子里没有相关的。这件事它没记过。' };

      return {
        found: out.length,
        hits: out.map(h => ({ id: h.m.id, kind: h.m.kind, day: h.m.day_count, content: h.m.content }))
      };
    }
  });

  define({
    name: 'recall_day',
    scope: 'main',
    description: '回想第 N 天你们聊了什么。当对方说"前两天""上次"这类模糊时间时用。',
    parameters: {
      type: 'object',
      properties: { day: { type: 'number', description: '第几天，1 起算' } },
      required: ['day']
    },
    run(args, ctx) {
      const day = Math.max(1, Math.round(args.day || 1));
      const base = ctx.S.firstSeen || Date.now();
      const inDay = (ctx.S.messages || []).filter(m => {
        const t = m.created_at ? new Date(m.created_at).getTime() : Date.now();
        return Math.floor((t - base) / 86400000) + 1 === day;
      }).slice(-8);

      const events = (ctx.S.events || []).filter(e => e.day_count === day);

      if (!inDay.length && !events.length) {
        return { day, note: `第 ${day} 天它什么都没记下来。` };
      }
      return {
        day,
        lines: inDay.map(m => `${m.role === 'pet' ? ctx.S.petName : ctx.S.userName}：${m.content}`),
        events: events.map(e => e.text)
      };
    }
  });

  define({
    name: 'check_calendar',
    scope: 'main',
    description: '看今天第几天、对方多久没来、亲密度多少、有没有还没兑现的承诺、自己是不是在冷战。心里没数的时候用。',
    parameters: { type: 'object', properties: {}, required: [] },
    run(args, ctx) {
      const S = ctx.S;
      const pending = S.memories.filter(m => m.kind === 'promise');
      return {
        day: S.dayCount,
        hours_since_last_visit: Math.round(S.gapHours || 0),
        affection: S.affection,
        memory_count: S.memories.length,
        pending_promises: pending.slice(0, 3).map(m => `第${m.day_count}天：${m.content}`),
        cold_war_left: S.coldLeft || 0
      };
    }
  });

  define({
    name: 'load_skill',
    scope: 'main',
    description: '加载一份技能的操作手册。系统只给了你技能的名字和用途，正文要用这个工具取。当对话正好落进某个技能的适用场景时，先加载它再行动。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '技能名，见系统提示里的技能目录' } },
      required: ['name']
    },
    async run(args, ctx) {
      const body = await ctx.Skills.load(args.name);
      if (!body) return { error: 'no_such_skill', name: args.name };
      ctx.log('skill loaded', args.name);
      return { skill: args.name, manual: body };
    }
  });

  define({
    name: 'set_mood',
    scope: 'main',
    description: '改自己此刻的表情/情绪。心情真的变了才调用，别每句话都改。',
    parameters: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: ['idle', 'happy', 'smug', 'annoyed', 'sad', 'sleepy'] }
      },
      required: ['mood']
    },
    run(args, ctx) {
      const ok = ['idle', 'happy', 'smug', 'annoyed', 'sad', 'sleepy'];
      if (!ok.includes(args.mood)) return { error: 'bad_mood' };
      ctx.S.mood = args.mood;
      ctx.Room.setMood(ctx.moodToFace(args.mood));
      ctx.Store.patchRoom({ mood: args.mood });
      return { mood: args.mood };
    }
  });

  define({
    name: 'write_timeline',
    scope: ['main', 'book'],
    description: '往你们的关系时间线上记一笔。只在真的发生了什么的时候用：吵了一架、和好了、它决定不理你了、对方食言了。一次对话最多记一笔。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fight', 'makeup', 'cold', 'broken', 'moment', 'confess'],
          description: 'fight吵架 makeup和好 cold冷战 broken食言 moment值得记住的瞬间 confess说了真心话'
        },
        text: { type: 'string', description: '一句话，第三人称，不超过 24 字，比如"他嫌我烦，我三天没理他"' }
      },
      required: ['kind', 'text']
    },
    async run(args, ctx) {
      const text = String(args.text || '').slice(0, 40);
      if (!text) return { error: 'empty' };
      const ev = {
        kind: args.kind || 'moment',
        text,
        day_count: ctx.S.dayCount,
        created_at: new Date().toISOString()
      };
      ctx.S.events.unshift(ev);
      await ctx.Store.addEvent({ kind: ev.kind, text, day_count: ev.day_count });
      ctx.onTimeline(ev);
      return { recorded: true, day: ev.day_count };
    }
  });

  /* ================= book scope（记账员） ================= */

  define({
    name: 'remember',
    scope: 'book',
    description: '把一条关于用户的长期事实写进小本本。只记用户明确说过的稳定信息，不推测。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fact', 'like', 'hate', 'promise', 'lie', 'grudge', 'nickname']
        },
        content: { type: 'string', description: '一句干净的中文陈述，不带"用户"、不写"他说"。比如"在成都做会计"' },
        weight: { type: 'number', description: '1 随口一提 / 3 一般 / 5 身份级' }
      },
      required: ['kind', 'content']
    },
    async run(args, ctx) {
      const kind = args.kind, content = String(args.content || '').trim();
      if (!KIND[kind]) return { error: 'bad_kind', got: kind };
      if (!content) return { error: 'empty_content' };
      if (ctx.S.memories.some(m => m.content === content)) {
        const dup = ctx.S.memories.find(m => m.content === content);
        return { skipped: 'duplicate', id: dup.id };
      }
      const weight = Math.min(5, Math.max(1, Math.round(args.weight || 3)));
      const saved = await ctx.Store.addMemories([{ kind, content, weight }], ctx.S.dayCount);
      const row = (saved && saved[0]) || {};
      const mem = {
        id: row.id,
        kind, content, weight,
        mentions: 0,
        day_count: ctx.S.dayCount,
        created_at: row.created_at || new Date().toISOString()
      };
      ctx.S.memories.push(mem);
      ctx.onMemory(mem);
      return { ok: true, id: mem.id, content };
    }
  });

  define({
    name: 'reinforce',
    scope: 'book',
    description: '用户又说了一遍已经记过的事，把那条记忆的权重加重。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' }, note: { type: 'string' } },
      required: ['id']
    },
    async run(args, ctx) {
      const m = ctx.S.memories.find(x => String(x.id) === String(args.id));
      if (!m) return { error: 'not_found' };
      m.mentions = (m.mentions || 0) + 1;
      m.weight = Math.min(5, (m.weight || 3) + 1);
      await ctx.Store.reinforce([m.id]);
      return { ok: true, content: m.content, mentions: m.mentions };
    }
  });

  define({
    name: 'forget_memory',
    scope: 'book',
    description: '用户明确要求忘掉某件事时，删掉那条记忆。不要自己判断"这条不重要"就删。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id']
    },
    async run(args, ctx) {
      const m = ctx.S.memories.find(x => String(x.id) === String(args.id));
      if (!m) return { error: 'not_found' };
      ctx.S.memories = ctx.S.memories.filter(x => x !== m);
      await ctx.Store.deleteMemory(m.id);
      ctx.onForget(m);
      return { forgot: m.content };
    }
  });

  define({
    name: 'set_nickname',
    scope: 'book',
    description: '给用户起一个外号并记住。只在用户真的说了让你想给他起外号的话时用。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '2-4 个字的外号' } },
      required: ['name']
    },
    async run(args, ctx) {
      const name = String(args.name || '').trim().slice(0, 6);
      if (!name) return { error: 'empty' };
      ctx.S.nickname = name;
      await ctx.Store.patchRoom({ nickname: name });
      await ctx.Store.addMemories([{ kind: 'nickname', content: `管他叫「${name}」`, weight: 3 }], ctx.S.dayCount);
      return { ok: true, nickname: name };
    }
  });

  define({
    name: 'update_affection',
    scope: 'book',
    description: '这一轮让亲密度变了多少。被夸、被认真对待就加；被敷衍、被骂、被无视就减。',
    parameters: {
      type: 'object',
      properties: {
        delta: { type: 'number', description: '-6 到 +5 之间' },
        reason: { type: 'string', description: '一句原因，写给你自己看' }
      },
      required: ['delta']
    },
    async run(args, ctx) {
      let d = Math.round(args.delta || 0);
      d = Math.max(-6, Math.min(5, d));
      const next = Math.max(0, Math.min(100, ctx.S.affection + d));
      const real = next - ctx.S.affection;
      ctx.S.affection = next;
      await ctx.Store.patchRoom({ affection: next });
      ctx.onAffection(real, args.reason);
      return { affection: next, changed: real };
    }
  });

  define({
    name: 'start_cold_war',
    scope: 'book',
    description: '用户冒犯了你，或说了很伤人的话，你决定开始冷战。冷战期间你只会说几个字。',
    parameters: {
      type: 'object',
      properties: {
        turns: { type: 'number', description: '冷战持续几轮，3-5' },
        reason: { type: 'string', description: '为什么' }
      },
      required: ['turns']
    },
    async run(args, ctx) {
      const turns = Math.max(2, Math.min(6, Math.round(args.turns || 3)));
      ctx.S.coldLeft = turns;
      ctx.S.mood = 'annoyed';
      await ctx.Store.patchRoom({ cold_left: turns, mood: 'annoyed' });
      ctx.Room.setMood('annoyed');

      const ev = {
        kind: 'cold',
        text: args.reason ? `它决定不理他了：${String(args.reason).slice(0, 20)}` : '它决定不理他了',
        day_count: ctx.S.dayCount,
        created_at: new Date().toISOString()
      };
      ctx.S.events.unshift(ev);
      await ctx.Store.addEvent({ kind: ev.kind, text: ev.text, day_count: ev.day_count });
      ctx.onTimeline(ev);
      ctx.onColdWar(turns, args.reason);

      return { cold_war_started: true, turns };
    }
  });

  return { define, defs, call, has, names, score, grams };
})();
