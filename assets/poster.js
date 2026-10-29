/* =========================================================
   poster.js — 记忆档案卡 1080×1350
   先量高度、再顺序落笔，保证任何内容都不会叠在一起
   ========================================================= */

const Poster = (() => {

  const W = 1080, H = 1350, M = 84;
  const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",-apple-system,sans-serif';
  const SERIF = '"Songti SC","SimSun","Noto Serif SC",Georgia,serif';

  function wrap(ctx, text, maxW, maxLines) {
    const chars = Array.from(text);
    const lines = [];
    let cur = '';
    for (const ch of chars) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = ch;
        if (lines.length === maxLines) break;
      } else {
        cur = test;
      }
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    if (lines.length === maxLines) {
      // 判断是否还有剩余没画
      const used = lines.join('').length;
      if (used < chars.length) {
        let last = lines[maxLines - 1];
        while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
      }
    }
    return lines;
  }

  function fit(ctx, text, maxW, maxLines, sizes, weight) {
    for (const size of sizes) {
      ctx.font = `${weight} ${size}px ${SERIF}`;
      const lines = wrap(ctx, text, maxW, maxLines);
      const total = lines.join('').replace(/…$/, '').length;
      if (total >= Array.from(text).length || size === sizes[sizes.length - 1]) {
        return { lines, size };
      }
    }
    return { lines: [text], size: sizes[sizes.length - 1] };
  }

  function draw(data) {
    const cv = document.getElementById('posterCanvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    /* ---------- 背景 ---------- */
    const bg = ctx.createLinearGradient(0, 0, W * .4, H);
    bg.addColorStop(0, '#1f1517');
    bg.addColorStop(.55, '#170f11');
    bg.addColorStop(1, '#0e090a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 台灯暖光
    const glow = ctx.createRadialGradient(W * .86, 70, 20, W * .86, 70, 640);
    glow.addColorStop(0, 'rgba(255,180,107,.20)');
    glow.addColorStop(.5, 'rgba(255,180,107,.05)');
    glow.addColorStop(1, 'rgba(255,180,107,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // 极细的横纹（纸感）
    ctx.strokeStyle = 'rgba(255,255,255,.014)';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 6) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    /* ---------- 头部 ---------- */
    let y = 108;

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,180,107,.75)';
    ctx.font = `600 24px ${FONT}`;
    ctx.letterSpacing = '6px';
    ctx.fillText('它 的 小 本 本', M, y);
    ctx.letterSpacing = '0px';

    y += 92;
    ctx.fillStyle = '#f4eae4';
    ctx.font = `700 84px ${SERIF}`;
    ctx.fillText(data.petName, M, y);

    y += 52;
    ctx.fillStyle = '#8d7f84';
    ctx.font = `400 27px ${FONT}`;
    ctx.fillText(`和${data.userName}住在一起的第 ${data.dayCount} 天`, M, y);

    // 右上角：它记住的件数
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffb46b';
    ctx.font = `700 96px ${SERIF}`;
    ctx.fillText(String(data.total), W - M, 200);
    ctx.fillStyle = '#8d7f84';
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText('件事', W - M, 240);
    if (data.debts) {
      ctx.fillStyle = 'rgba(185,166,255,.75)';
      ctx.font = `400 22px ${FONT}`;
      ctx.fillText(`欠 ${data.debts} 笔`, W - M, 272);
    }
    ctx.textAlign = 'left';

    /* ---------- 分隔 ---------- */
    y += 46;
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    y += 66;

    /* ---------- 它对你的判断 ---------- */
    const im = fit(ctx, data.impression || '', W - M * 2 - 46, 2, [38, 34, 30], '500');
    ctx.fillStyle = 'rgba(255,180,107,.35)';
    ctx.font = `700 52px ${SERIF}`;
    ctx.fillText('“', M - 4, y + 6);

    ctx.fillStyle = '#e3d5cd';
    ctx.font = `500 ${im.size}px ${SERIF}`;
    const imLH = Math.round(im.size * 1.62);
    im.lines.forEach((line, i) => {
      ctx.fillText(line, M + 40, y + 32 + i * imLH);
    });
    y += 32 + imLH * im.lines.length + 54;

    /* ---------- 记忆条目 ---------- */
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.font = `500 22px ${FONT}`;
    ctx.letterSpacing = '4px';
    ctx.fillText('它 记 得', M, y);
    ctx.letterSpacing = '0px';
    y += 40;

    const FOOT_TOP = H - 176;

    /* 第一遍：量高度 */
    const rows = [];
    for (const m of data.memories.slice(0, 6)) {
      const kind = KIND[m.kind] || { label: '其他', color: '#8d7f84' };
      const body = fit(ctx, m.content, W - M * 2 - 52, 2, [33, 29], '400');
      const lh = Math.round(body.size * 1.56);
      rows.push({ m, kind, body, lh, h: 58 + (body.lines.length - 1) * lh + 22 });
    }

    /* 第二遍：先判断能放几条，再把富余的空白匀给间距（不会溢出） */
    const GAP = 15;
    const avail = FOOT_TOP - y;
    const need = k => rows.slice(0, k).reduce((s, r) => s + r.h, 0) + GAP * Math.max(0, k - 1);

    let n = rows.length;
    while (n > 0 && need(n) > avail) n--;
    const list = rows.slice(0, n);

    if (!n) {
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = `400 30px ${SERIF}`;
      ctx.fillText('还什么都没记。你也什么都没说。', M, y + 60);
    } else {
      const sumH = list.reduce((s, r) => s + r.h, 0);
      const slack = Math.max(0, avail - sumH);
      // 卡片少的时候（<=4）允许把间距撑得更开，否则底部会空出一大块
      const few = n <= 4;
      const gapCap = few ? 64 : 30;
      const gap = Math.min(gapCap, GAP + (slack / Math.max(1, n - 1)) * (few ? 0.85 : 0.6));
      const usedH = sumH + gap * (n - 1);
      let cy = y + Math.min(few ? 84 : 46, Math.max(0, (avail - usedH) / 2));

      for (const r of list) {
        ctx.fillStyle = 'rgba(255,255,255,.03)';
        roundRect(ctx, M, cy, W - M * 2, r.h, 14);
        ctx.fill();

        ctx.fillStyle = r.kind.color;
        roundRect(ctx, M, cy + 12, 4, r.h - 24, 2);
        ctx.fill();

        ctx.fillStyle = r.kind.color;
        ctx.font = `600 21px ${FONT}`;
        ctx.letterSpacing = '2px';
        ctx.fillText(r.kind.label, M + 30, cy + 36);
        ctx.letterSpacing = '0px';

        const lw = ctx.measureText(r.kind.label).width;
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.font = `400 20px ${FONT}`;
        ctx.fillText(`第${r.m.day_count}天`, M + 30 + lw + 22, cy + 36);

        ctx.fillStyle = '#e8dcd6';
        ctx.font = `400 ${r.body.size}px ${SERIF}`;
        r.body.lines.forEach((line, i) => {
          ctx.fillText(line, M + 30, cy + 72 + i * r.lh);
        });

        cy += r.h + gap;
      }
    }

    /* ---------- 页脚 ---------- */
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(M, H - 128); ctx.lineTo(W - M, H - 128); ctx.stroke();

    ctx.fillStyle = '#7d7075';
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText('它不会主动想起你。但它一条都没忘。', M, H - 78);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,180,107,.55)';
    ctx.font = `500 23px ${FONT}`;
    ctx.fillText('记仇室友 · petty-roommate', W - M, H - 78);
    ctx.textAlign = 'left';

    return cv.toDataURL('image/png');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { draw };
})();
