/* =========================================================
   store.js — 记忆存在哪
   云数据库优先，本地镜像兜底。断网也别忘了它。
   ========================================================= */

const Store = (() => {

  let cloud = null;
  let key = '';
  let online = false;
  const LS_KEY = 'pr_key';

  /* ---------- 钥匙 ---------- */
  function makeKey() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 10; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  function loadKey() {
    try {
      let k = localStorage.getItem(LS_KEY);
      if (!k) { k = makeKey(); localStorage.setItem(LS_KEY, k); }
      return k;
    } catch { return makeKey(); }
  }

  function setKey(k) {
    key = k;
    try { localStorage.setItem(LS_KEY, k); } catch {}
  }

  /* ---------- 本地镜像 ---------- */
  function mirrorKey() { return 'pr_data_' + key; }

  function readMirror() {
    try {
      const raw = localStorage.getItem(mirrorKey());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeMirror(data) {
    try {
      const d = { ...data };
      if (d.messages) d.messages = d.messages.slice(-80);
      localStorage.setItem(mirrorKey(), JSON.stringify(d));
    } catch {}
  }

  /* ---------- 初始化 ---------- */
  function init(sdk) {
    cloud = sdk;
    key = loadKey();
  }

  async function boot() {
    // 1) 先拿本地镜像，保证秒开
    const local = readMirror();

    if (!cloud) { online = false; return local; }

    try {
      const { data, error } = await cloud.database
        .from('roommates').select('*').eq('owner_key', key).maybeSingle();
      if (error) throw error;

      if (!data) { online = true; return local ? { ...local, room: local.room } : null; }

      const [mem, msg, ev] = await Promise.all([
        cloud.database.from('memories').select('*').eq('owner_key', key)
          .order('weight', { ascending: false }).order('created_at', { ascending: false }).limit(80),
        cloud.database.from('messages').select('*').eq('owner_key', key)
          .order('created_at', { ascending: false }).limit(30),
        cloud.database.from('events').select('*').eq('owner_key', key)
          .order('created_at', { ascending: false }).limit(40)
          .then(r => r).catch(() => ({ data: [] }))
      ]);

      online = true;
      const out = {
        room: data,
        memories: (mem.data || []).reverse(),
        messages: (msg.data || []).reverse(),
        events: ev.data || []
      };
      writeMirror(out);
      return out;
    } catch (err) {
      console.warn('[store] 云端读取失败，用本地记忆', err && (err.message || err.code));
      online = false;
      return local;
    }
  }

  /* ---------- 室友 ---------- */
  async function createRoom({ petName, userName }) {
    const row = {
      owner_key: key,
      pet_name: petName,
      user_name: userName,
      day_count: 1,
      affection: 12,
      mood: 'idle'
    };
    let saved = { ...row, id: null, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() };

    if (cloud) {
      try {
        const { data, error } = await cloud.database.from('roommates').insert(row).select();
        if (error) throw error;
        if (data && data[0]) saved = data[0];
        online = true;
      } catch (err) {
        console.warn('[store] 建屋子失败，转本地', err && (err.message || err.code));
        online = false;
      }
    }
    writeMirror({ room: saved, memories: [], messages: [] });
    return saved;
  }

  async function patchRoom(patch, touch = true) {
    const body = { ...patch };
    if (touch) body.last_seen = new Date().toISOString();
    const local = readMirror() || {};
    local.room = { ...(local.room || {}), ...body };
    writeMirror(local);

    if (!cloud || !online) return local.room;
    try {
      const { error } = await cloud.database.from('roommates').update(body).eq('owner_key', key);
      if (error) throw error;
    } catch (err) {
      console.warn('[store] 更新屋子失败', err && (err.message || err.code));
    }
    return local.room;
  }

  /* ---------- 记忆 ---------- */
  async function addMemories(list, dayCount) {
    if (!list.length) return [];
    const rows = list.map(m => ({
      owner_key: key,
      kind: m.kind,
      content: m.content,
      weight: m.weight || 3,
      day_count: dayCount
    }));

    const local = readMirror() || { memories: [] };
    const stamped = rows.map((r, i) => ({
      ...r,
      id: 'local-' + Date.now() + '-' + i,
      mentions: 0,
      created_at: new Date().toISOString()
    }));
    local.memories = [...(local.memories || []), ...stamped];
    writeMirror(local);

    if (cloud && online) {
      try {
        const { data, error } = await cloud.database.from('memories').insert(rows).select();
        if (!error && data && data.length) {
          // 用云端 id 覆盖本地临时 id
          local.memories = local.memories.map(m => {
            const hit = data.find(d => d.content === m.content);
            return hit ? { ...m, id: hit.id } : m;
          });
          writeMirror(local);
          return data;
        }
      } catch (err) {
        console.warn('[store] 记忆上云失败', err && (err.message || err.code));
      }
    }
    return stamped;
  }

  async function reinforce(ids) {
    if (!ids || !ids.length) return;
    const local = readMirror() || { memories: [] };
    local.memories = (local.memories || []).map(m =>
      ids.includes(m.id) ? { ...m, mentions: (m.mentions || 0) + 1, weight: Math.min(5, (m.weight || 3) + 1) } : m
    );
    writeMirror(local);

    if (!cloud || !online) return;
    const realIds = ids.filter(i => typeof i === 'number');
    if (!realIds.length) return;
    try {
      for (const id of realIds) {
        const { data } = await cloud.database.from('memories').select('mentions').eq('id', id).maybeSingle();
        const next = ((data && data.mentions) || 0) + 1;
        await cloud.database.from('memories').update({ mentions: next }).eq('id', id);
      }
    } catch (err) {
      console.warn('[store] 记忆加权失败', err && err.message);
    }
  }

  async function markUsed(id) {
    if (!cloud || !online || typeof id !== 'number') return;
    try { await cloud.database.from('memories').update({ last_used: new Date().toISOString() }).eq('id', id); } catch {}
  }

  async function deleteMemory(id) {
    const local = readMirror() || { memories: [] };
    local.memories = (local.memories || []).filter(m => String(m.id) !== String(id));
    writeMirror(local);

    if (!cloud || !online || typeof id !== 'number') return;
    try {
      const { data } = await cloud.database.from('memories').delete().eq('id', id).select();
      if (!data || !data.length) console.warn('[store] 删除未生效，可能 id 不在云端');
    } catch (err) {
      console.warn('[store] 删除失败', err && err.message);
    }
  }

  /* ---------- 消息 ---------- */
  async function addMessage(role, content) {
    const local = readMirror() || { messages: [] };
    local.messages = [...(local.messages || []), { role, content, created_at: new Date().toISOString() }];
    writeMirror(local);

    if (!cloud || !online) return;
    try {
      await cloud.database.from('messages').insert({ owner_key: key, role, content });
    } catch (err) {
      console.warn('[store] 消息落库失败', err && err.message);
    }
  }

  /* ---------- 关系时间线 ---------- */
  async function addEvent(ev) {
    const row = { kind: ev.kind, text: ev.text, day_count: ev.day_count || 1 };
    const local = readMirror() || {};
    local.events = [{ ...row, created_at: new Date().toISOString() }, ...(local.events || [])].slice(0, 40);
    writeMirror(local);

    if (!cloud || !online) return row;
    try {
      await cloud.database.from('events').insert({ owner_key: key, ...row });
    } catch (err) {
      console.warn('[store] 时间线落库失败', err && err.message);
    }
    return row;
  }

  async function listEvents(limit = 40) {
    if (cloud && online) {
      try {
        const { data, error } = await cloud.database.from('events').select('*')
          .eq('owner_key', key).order('created_at', { ascending: false }).limit(limit);
        if (!error && data) return data;
      } catch (err) {
        console.warn('[store] 时间线读取失败', err && err.message);
      }
    }
    return (readMirror() || {}).events || [];
  }

  /* ---------- 重置 ---------- */
  async function reset() {
    try { localStorage.removeItem(mirrorKey()); } catch {}
    if (!cloud || !online) return;
    try {
      await cloud.database.from('memories').delete().eq('owner_key', key);
      await cloud.database.from('messages').delete().eq('owner_key', key);
      await cloud.database.from('events').delete().eq('owner_key', key);
      await cloud.database.from('roommates').delete().eq('owner_key', key);
    } catch (err) {
      console.warn('[store] 清空失败', err && err.message);
    }
  }

  return {
    init, boot, createRoom, patchRoom,
    addMemories, reinforce, markUsed, deleteMemory,
    addMessage, addEvent, listEvents, reset,
    get key() { return key; },
    setKey,
    get online() { return online; },
    readMirror
  };
})();
