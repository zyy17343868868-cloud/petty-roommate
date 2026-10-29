/* =========================================================
   room.js — 房间场景与那个东西
   参数化 SVG：会眨眼、会呼吸、眼珠会跟着你动
   viewBox 400×280，与容器 400:280 等比例，坐标可精确映射
   ========================================================= */

const Room = (() => {

  const BODY = 'M200 156 C239 156 253 183 252 206 C251 228 231 237 200 237 C169 237 149 228 148 206 C147 183 161 156 200 156 Z';

  const MOUTH = {
    idle:    'M190 216 q10 6 20 0',
    happy:   'M185 213 q15 14 30 0',
    smug:    'M187 217 q13 5 26 -3',
    annoyed: 'M189 218 q11 -5 22 0',
    sad:     'M189 220 q11 -7 22 0',
    sleepy:  'M193 218 q7 5 14 0'
  };

  function sceneSVG() {
    return `
<defs>
  <linearGradient id="wallG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2c2226"/>
    <stop offset="0.66" stop-color="#1d1517"/>
    <stop offset="1" stop-color="#191113"/>
  </linearGradient>
  <linearGradient id="bodyG" x1="0.32" y1="0" x2="0.68" y2="1">
    <stop offset="0" stop-color="#3d3037"/>
    <stop offset="1" stop-color="#221920"/>
  </linearGradient>
  <radialGradient id="lampG" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#ffd9a8" stop-opacity="0.6"/>
    <stop offset="0.45" stop-color="#ffb46b" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#ffb46b" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="coneG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffcf96" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#ffcf96" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="bodyClip"><path d="${BODY}"/></clipPath>
</defs>

<rect x="0" y="0" width="400" height="280" fill="url(#wallG)"/>

<!-- 窗 -->
<g>
  <rect x="24" y="24" width="76" height="68" rx="2" fill="#0f0d1a"/>
  <rect x="24" y="24" width="76" height="68" rx="2" fill="none" stroke="#372c32" stroke-width="2"/>
  <line x1="62" y1="24" x2="62" y2="92" stroke="#372c32" stroke-width="2"/>
  <line x1="24" y1="58" x2="100" y2="58" stroke="#372c32" stroke-width="2"/>
  <circle cx="40" cy="40" r="1.3" fill="#9aa6e0" opacity="0.7"/>
  <circle cx="82" cy="46" r="1" fill="#9aa6e0" opacity="0.5"/>
  <circle cx="52" cy="78" r="1.1" fill="#9aa6e0" opacity="0.45"/>
  <circle cx="88" cy="72" r="1.5" fill="#cfd6f5" opacity="0.6"/>
</g>

<!-- 歪的画 -->
<g transform="rotate(-3 320 52)">
  <rect x="296" y="32" width="48" height="38" rx="2" fill="#241b21" stroke="#3f3238" stroke-width="1.5"/>
  <path d="M304 60 l9 -13 l7 8 l6 -5 l7 9" fill="none" stroke="#6b5a63" stroke-width="1.3" stroke-linecap="round"/>
  <circle cx="334" cy="42" r="2.6" fill="#6b5a63"/>
</g>

<!-- 吊灯 -->
<g>
  <line x1="352" y1="0" x2="352" y2="18" stroke="#3a2e34" stroke-width="2"/>
  <path d="M336 30 L368 30 L361 18 L343 18 Z" fill="#4c3b42"/>
  <circle cx="352" cy="33" r="15" fill="url(#lampG)"/>
  <circle cx="352" cy="32" r="3.4" fill="#ffe4c0"/>
  <path d="M336 30 L368 30 L398 190 L306 190 Z" fill="url(#coneG)"/>
</g>

<!-- 地板 -->
<rect x="0" y="190" width="400" height="90" fill="#150e10"/>
<line x1="0" y1="190" x2="400" y2="190" stroke="#0b0608" stroke-width="2"/>
<line x1="0" y1="222" x2="400" y2="222" stroke="#1e1418" stroke-width="1"/>
<line x1="0" y1="256" x2="400" y2="256" stroke="#1e1418" stroke-width="1"/>

<!-- 地毯 -->
<ellipse cx="200" cy="234" rx="82" ry="15" fill="#332528" opacity="0.85"/>
<ellipse cx="200" cy="234" rx="82" ry="15" fill="none" stroke="#43313a" stroke-width="1"/>

<!-- 还没拆的纸箱 -->
<g>
  <path d="M30 203 l30 -8 l30 8 l-30 8 Z" fill="#4b3d36"/>
  <path d="M30 203 l30 8 l0 26 l-30 -8 Z" fill="#392d27"/>
  <path d="M90 203 l-30 8 l0 26 l30 -8 Z" fill="#2f2520"/>
  <path d="M57 199 l6 1.6 l0 26 l-6 -1.6 Z" fill="#5d4c41" opacity="0.55"/>
</g>

<!-- 拖鞋（只有一只） -->
<g opacity="0.85">
  <ellipse cx="118" cy="252" rx="17" ry="7" fill="#3a2b30"/>
  <ellipse cx="118" cy="249" rx="17" ry="7" fill="#4b373d"/>
  <path d="M107 248 q11 -5 22 0" fill="none" stroke="#5f464e" stroke-width="1.4"/>
</g>

<!-- ===== 那个东西 ===== -->
<g id="creature">
  <ellipse id="cShadow" cx="200" cy="236" rx="44" ry="6" fill="#0a0607" opacity="0.55"/>

  <g id="cBody">
    <path d="M180 161 L173 141" stroke="#3d3037" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="173" cy="139" r="3.4" fill="#4c3b43"/>
    <path d="M220 161 L227 141" stroke="#3d3037" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="227" cy="139" r="3.4" fill="#4c3b43"/>

    <path d="${BODY}" fill="url(#bodyG)" stroke="#4b3b43" stroke-width="1.1"/>

    <g clip-path="url(#bodyClip)">
      <ellipse cx="243" cy="184" rx="34" ry="30" fill="#ffb46b" opacity="0.075"/>
      <ellipse cx="163" cy="214" rx="20" ry="26" fill="#0d0709" opacity="0.25"/>
    </g>

    <ellipse cx="152" cy="210" rx="8" ry="10.5" fill="#302429"/>
    <ellipse cx="248" cy="210" rx="8" ry="10.5" fill="#302429"/>

    <g id="cBlush" opacity="0">
      <ellipse cx="167" cy="211" rx="9.5" ry="4.4" fill="#ff7f72" opacity="0.22"/>
      <ellipse cx="233" cy="211" rx="9.5" ry="4.4" fill="#ff7f72" opacity="0.22"/>
    </g>

    <g id="eyesOpen">
      <ellipse id="eyeL" cx="181" cy="196" rx="11.6" ry="13" fill="#f6efe9"/>
      <ellipse id="eyeR" cx="219" cy="196" rx="11.6" ry="13" fill="#f6efe9"/>
      <g id="pupils">
        <circle cx="182" cy="198" r="5.2" fill="#1a1116"/>
        <circle cx="220" cy="198" r="5.2" fill="#1a1116"/>
        <circle cx="184" cy="195.4" r="1.6" fill="#fff" opacity="0.9"/>
        <circle cx="222" cy="195.4" r="1.6" fill="#fff" opacity="0.9"/>
      </g>
    </g>
    <g id="eyesHappy" display="none">
      <path d="M171 199 q10 -11 20 0" fill="none" stroke="#f6efe9" stroke-width="4.4" stroke-linecap="round"/>
      <path d="M209 199 q10 -11 20 0" fill="none" stroke="#f6efe9" stroke-width="4.4" stroke-linecap="round"/>
    </g>
    <g id="eyesClosed" display="none">
      <path d="M171 197 q10 6 20 0" fill="none" stroke="#f6efe9" stroke-width="4" stroke-linecap="round"/>
      <path d="M209 197 q10 6 20 0" fill="none" stroke="#f6efe9" stroke-width="4" stroke-linecap="round"/>
    </g>

    <g id="cBrows" display="none" stroke="#e8dcd6" stroke-width="2.6" stroke-linecap="round" opacity="0.85">
      <line x1="170" y1="180" x2="192" y2="176"/>
      <line x1="230" y1="180" x2="208" y2="176"/>
    </g>
    <!-- 生气：眉毛内侧压低，像压下来的那种。和"委屈"共用一条线会觉得它在撒娇 -->
    <g id="cBrowsAngry" display="none" stroke="#e8dcd6" stroke-width="2.8" stroke-linecap="round" opacity="0.9">
      <line x1="169" y1="176" x2="193" y2="184"/>
      <line x1="231" y1="176" x2="207" y2="184"/>
    </g>

    <path id="cMouth" d="${MOUTH.idle}" fill="none" stroke="#f0e6df" stroke-width="2.8" stroke-linecap="round"/>

    <text id="cSymbol" x="246" y="170" font-size="19" font-family="sans-serif" opacity="0">💢</text>
  </g>
</g>`;
  }

  const FACE = {
    idle:    { open: true,  mouth: 'idle',    brows: false, blush: 0,   sym: '',   tilt: 0 },
    happy:   { open: false, mouth: 'happy',   brows: false, blush: .8,  sym: '',   tilt: 0 },
    smug:    { open: true,  mouth: 'smug',    brows: false, blush: .3,  sym: '',   tilt: -2 },
    annoyed: { open: true,  mouth: 'annoyed', brows: 'angry', blush: .15, sym: '💢', tilt: -3 },
    sad:     { open: true,  mouth: 'sad',     brows: true,  blush: 0,   sym: '',   tilt: 2 },
    sleepy:  { open: false, mouth: 'sleepy',  brows: false, blush: 0,   sym: '💤', tilt: 3 }
  };

  let root = null, cur = 'idle', blinkTimer = null, dead = false;

  function mount(el, opts = {}) {
    el.innerHTML = sceneSVG();
    // 领养页只要那个东西本身，不要房间背景
    if (opts.bare) {
      [...el.children].forEach(ch => {
        if (ch.tagName.toLowerCase() === 'defs' || ch.id === 'creature') return;
        ch.remove();
      });
    }
    root = el.querySelector('#creature');
    cur = 'idle';
    apply('idle');
    scheduleBlink();
    breathe();
    return root;
  }

  function apply(mood) {
    const f = FACE[mood] || FACE.idle;
    root.querySelector('#eyesOpen').setAttribute('display', f.open ? 'inline' : 'none');
    root.querySelector('#eyesHappy').setAttribute('display', (!f.open && mood === 'happy') ? 'inline' : 'none');
    root.querySelector('#eyesClosed').setAttribute('display', (!f.open && mood !== 'happy') ? 'inline' : 'none');
    root.querySelector('#cMouth').setAttribute('d', MOUTH[f.mouth] || MOUTH.idle);
    root.querySelector('#cBrows').setAttribute('display', f.brows === true || f.brows === 'sad' ? 'inline' : 'none');
    const angry = root.querySelector('#cBrowsAngry');
    if (angry) angry.setAttribute('display', f.brows === 'angry' ? 'inline' : 'none');
    root.querySelector('#cBlush').setAttribute('opacity', String(f.blush));
    const sym = root.querySelector('#cSymbol');
    sym.textContent = f.sym;
    sym.setAttribute('opacity', f.sym ? '1' : '0');
    const body = root.querySelector('#cBody');
    body.style.transform = `rotate(${f.tilt}deg)`;
    body.style.transformOrigin = '200px 237px';
  }

  function setMood(mood) {
    if (!root) return;
    cur = FACE[mood] ? mood : 'idle';
    apply(cur);
  }

  function breathe() {
    if (!root) return;
    const body = root.querySelector('#cBody');
    let t = 0;
    setInterval(() => {
      if (dead) return;
      t += 0.045;
      body.style.translate = `0 ${(Math.sin(t) * 1.6).toFixed(2)}px`;
    }, 66);
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (dead || !root) return;
      if (FACE[cur] && FACE[cur].open) {
        const eo = root.querySelector('#eyesOpen');
        const ec = root.querySelector('#eyesClosed');
        eo.setAttribute('display', 'none');
        ec.setAttribute('display', 'inline');
        setTimeout(() => {
          if (dead || !root) return;
          eo.setAttribute('display', 'inline');
          ec.setAttribute('display', 'none');
        }, 110);
      }
      scheduleBlink();
    }, 2600 + Math.random() * 4200);
  }

  function follow(x, y) {
    if (!root || !FACE[cur] || FACE[cur].open === false) return;
    const svg = root.ownerSVGElement;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    // 生物中心在 viewBox 的 (200, 196)，换算成屏幕坐标
    const cx = box.left + box.width * 0.5;
    const cy = box.top + box.height * 0.7;
    const dx = Math.max(-3.4, Math.min(3.4, (x - cx) / 46));
    const dy = Math.max(-2.6, Math.min(2.6, (y - cy) / 52));
    root.querySelector('#pupils').style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  }

  return { mount, setMood, follow, MOUTH };
})();
