/* =========================================================
   agent.js — 代理循环
   ---------------------------------------------------------
   一轮对话的真实流程：

     messages ──▶ 模型
                  ├─ 只出文字  ──▶ 完成
                  ├─ 只出 tool_calls ──▶ 本地执行工具 ──▶ 结果塞回 messages ──▶ 再来一轮
                  └─ 两者都有（少数模型）──▶ 保留文字，继续执行工具

   最多跑 maxTurns 轮，防止模型自己绕圈。
   每一轮都有看门狗：首字 22 秒、断流 15 秒。
   ========================================================= */

const Agent = (() => {

  const FIRST_CHUNK_TIMEOUT = 22000;
  const IDLE_TIMEOUT = 15000;
  const MAX_TOOL_RESULT = 1600;

  /* ---------- 单轮流式请求 ---------- */

  async function streamTurn({ messages, tools, temperature = 1, onText, signalOut }) {
    const controller = new AbortController();
    if (signalOut) signalOut.current = controller;

    let timer = null, gotFirst = false, done = false;
    const arm = ms => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!done) { dbg('watchdog'); controller.abort(); } }, ms);
    };
    arm(FIRST_CHUNK_TIMEOUT);

    let text = '';
    let finish = '';
    const callBuf = {};   // index -> {id, name, args}

    const params = {
      model: currentModel().id,
      messages,
      stream: true,
      temperature,
      signal: controller.signal
    };
    if (tools && tools.length) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    try {
      for await (const chunk of cloud.llm.chat.completions.create(params)) {
        const choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;

        const d = choice.delta;
        if (!d) continue;

        if (d.reasoning_content) {
          if (!gotFirst) { gotFirst = true; arm(IDLE_TIMEOUT); }
        }

        if (typeof d.content === 'string' && d.content) {
          if (!gotFirst) { gotFirst = true; arm(IDLE_TIMEOUT); }
          text += d.content;
          onText(d.content);
        }

        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            if (!gotFirst) { gotFirst = true; arm(IDLE_TIMEOUT); }
            const i = tc.index == null ? 0 : tc.index;
            const slot = callBuf[i] || (callBuf[i] = { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name += tc.function.name;
            if (tc.function && tc.function.arguments) slot.args += tc.function.arguments;
          }
        }
      }
    } finally {
      done = true;
      clearTimeout(timer);
      if (signalOut) signalOut.current = null;
    }

    const calls = Object.keys(callBuf)
      .sort((a, b) => Number(a) - Number(b))
      .map((k, i) => {
        const c = callBuf[k];
        return {
          id: c.id || `call_${Date.now()}_${i}`,
          name: c.name,
          args: safeJSON(c.args),
          raw: c.args
        };
      })
      .filter(c => c.name);

    return { text, calls, finish };
  }

  function safeJSON(s) {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return { _raw: String(s).slice(0, 200) }; }
  }

  /* ---------- 带换模型的单轮 ---------- */

  async function streamTurnWithFallback(opts) {
    const tries = Math.max(1, Math.min(2, modelChain.length));
    let lastErr = null;

    for (let t = 0; t < tries; t++) {
      if (!currentModel()) throw new Error('NO_MODEL');
      try {
        return await streamTurn(opts);
      } catch (err) {
        lastErr = err;
        dbg('turn failed on', currentModel().id, err && (err.code || err.message));
        if (t < tries - 1 && modelChain.length > 1) {
          modelIdx = (modelIdx + 1) % modelChain.length;
          dbg('switch model ->', currentModel().id);
        }
      }
    }
    throw lastErr || new Error('LLM_FAILED');
  }

  /* ---------- 多轮代理循环 ---------- */

  /**
   * @param {object} o
   * @param {Array}  o.messages   已经组装好的消息数组（会被就地修改）
   * @param {string} o.scope      'main' | 'book'
   * @param {object} o.ctx        工具执行上下文
   * @param {func}   o.onText     流式文字回调
   * @param {func}   o.onTool     工具事件回调 ({phase, name, args, result, ms})
   * @param {number} o.maxTurns
   */
  async function run(o) {
    const {
      messages, scope, ctx,
      onText = () => {},
      onTool = () => {},
      maxTurns = 3,
      temperature = 1
    } = o;

    const tools = Tools.defs(scope);
    let full = '';
    let usedTools = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      let out;
      try {
        out = await streamTurnWithFallback({
          messages, tools, temperature,
          onText: chunk => { full += chunk; onText(chunk); }
        });
      } catch (err) {
        if (usedTools > 0) {
          // 已经干过活了，模型这一轮挂了就到此为止，别把前面的成果丢了
          dbg('turn failed after tools, stop', err && err.message);
          break;
        }
        throw err;
      }

      if (!out.calls.length) break;

      // 把模型这一轮的 assistant 消息（含 tool_calls）补进历史
      messages.push({
        role: 'assistant',
        content: out.text || null,
        tool_calls: out.calls.map(c => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.raw || '{}' }
        }))
      });

      for (const c of out.calls) {
        usedTools++;
        const t0 = Date.now();
        onTool({ phase: 'start', name: c.name, args: c.args });

        const result = await Tools.call(c.name, c.args, ctx);

        onTool({
          phase: 'done', name: c.name, args: c.args,
          result, ms: Date.now() - t0
        });

        messages.push({
          role: 'tool',
          tool_call_id: c.id,
          content: clip(JSON.stringify(result))
        });
      }
    }

    return { text: full, toolCalls: usedTools };
  }

  function clip(s) {
    s = String(s == null ? '' : s);
    if (s.length <= MAX_TOOL_RESULT) return s;
    return s.slice(0, MAX_TOOL_RESULT) + '…（后略）';
  }

  return { run, streamTurn };
})();
