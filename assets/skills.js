/* =========================================================
   skills.js — 技能包（渐进式披露）
   ---------------------------------------------------------
   技能不是 prompt 里的大段说明。它是一份 .md 操作手册：
     · 启动时只加载目录（名字 + 一句话用途），塞进系统提示
     · 模型判断场景对上了，主动调 load_skill 取正文
     · 正文加载后只对当前这一轮有效

   好处：常驻上下文很小（6 个技能只占 6 行），
   但需要时能拿到几百字的详细步骤。这就是"渐进式披露"。
   ========================================================= */

const Skills = (() => {

  let catalog = [];              // [{name, title, description, when}]
  const cache = new Map();       // name -> body
  let base = 'skills/';

  async function boot() {
    try {
      const res = await fetch(base + 'index.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      catalog = (json.skills || []).filter(s => s && s.name);
    } catch (err) {
      console.warn('[skills] 目录加载失败', err && err.message);
      catalog = [];
    }
    return catalog;
  }

  /** 塞进系统提示的那几行 */
  function brief() {
    if (!catalog.length) return '（暂时没有可用技能。）';
    return catalog.map(s => `- ${s.name}「${s.title}」：${s.description}`).join('\n');
  }

  /** 完整手册，带缓存 */
  async function load(name) {
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);

    const meta = catalog.find(s => s.name === name);
    if (!meta) return null;

    try {
      const res = await fetch(`${base}${name}.md`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.text();
      const body = stripFrontmatter(raw).trim();
      cache.set(name, body);
      return body;
    } catch (err) {
      console.warn('[skills] 手册加载失败', name, err && err.message);
      return null;
    }
  }

  function stripFrontmatter(md) {
    if (!md.startsWith('---')) return md;
    const end = md.indexOf('\n---', 3);
    if (end === -1) return md;
    return md.slice(md.indexOf('\n', end + 1) + 1);
  }

  function list() { return catalog.slice(); }
  function exists(name) { return catalog.some(s => s.name === name); }

  return { boot, brief, load, list, exists };
})();
