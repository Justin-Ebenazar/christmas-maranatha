import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow, cursorPosition, currentMonitor } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { load } from '@tauri-apps/plugin-store';
import { emit, listen } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import './App.css';

const STORE_KEY = 'settings.json';
const DEFAULTS = {
  taskbarHeight: 48,
  christmasDay: false,
  tree:      { side: 'left',  x: 24,  y: 0,  scale: 1 },
  snowman:   { side: 'right', x: 100, y: 0,  scale: 1 },
  fireplace: { side: 'right', x: 24,  y: 0,  scale: 1 },
  socks:     { side: 'left',  x: 80,  y: 6,  width: 240 },
  verse:     { side: 'left',  x: 360, y: 17, scale: 1 },
  timer:     { side: 'right', x: 170, y: 11, scale: 1 },
  gear:      { side: 'right', x: 4,   y: 30 },
  lights:    { show: true, spacing: 22, sag: 4 },
  angels:    { side: 'center', x: 0, y: 0, scale: 1, spacing: 0, count: 4, show: true },
  sleigh:    { scale: 1, x: 0, y: 0, pauseOnCursor: true },
  cuts: [],
};
const CONFIG = { snow: { flakes: 45 }, plow: { seconds: 34 } };

function mergeDeep(base, over) {
  const out = { ...base };
  Object.keys(over || {}).forEach((k) => {
    const o = over[k];
    const bv = base[k];
    out[k] =
      o && typeof o === 'object' && !Array.isArray(o) && bv && typeof bv === 'object' && !Array.isArray(bv)
        ? mergeDeep(bv, o)
        : o;
  });
  return out;
}

/* ================= Settings storage ================= */

let storePromise;
const getStore = () => (storePromise ??= load(STORE_KEY, { autoSave: false }));

function useSettingsReader() {
  const [s, setS] = useState(DEFAULTS);
  useEffect(() => {
    let un;
    let dead = false;
    (async () => {
      try {
        const st = await getStore();
        const saved = await st.get('settings');
        if (saved && !dead) setS(mergeDeep(DEFAULTS, saved));
      } catch (e) { console.warn('load failed', e); }
      const u = await listen('settings-updated', (e) => setS(mergeDeep(DEFAULTS, e.payload)));
      if (dead) u(); else un = u;
    })();
    return () => { dead = true; if (un) un(); };
  }, []);
  return s;
}

function useSettingsEditor() {
  const [s, setS] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const st = await getStore();
        const saved = await st.get('settings');
        if (saved) setS(mergeDeep(DEFAULTS, saved));
      } catch (e) { console.warn('load failed', e); }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready || !dirty) return;
    emit('settings-updated', s);
    const t = setTimeout(async () => {
      try {
        const st = await getStore();
        await st.set('settings', s);
        await st.save();
      } catch (e) { console.warn('save failed', e); }
    }, 200);
    return () => clearTimeout(t);
  }, [s, ready, dirty]);

  const touch = useCallback((fn) => { setDirty(true); setS(fn); }, []);
  const update = useCallback((k, f, v) => touch((p) => ({ ...p, [k]: { ...p[k], [f]: v } })), [touch]);
  const setTop = useCallback((k, v) => touch((p) => ({ ...p, [k]: v })), [touch]);
  const addCuts = useCallback((found) => touch((p) => ({ ...p, cuts: [...p.cuts, ...found] })), [touch]);
  const reset = useCallback(() => touch(() => DEFAULTS), [touch]);
  return { s, update, setTop, addCuts, reset };
}

function useVw() {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1920 : window.innerWidth));
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return vw;
}

/* ================= Window helpers ================= */

function useClickThrough() {
  useEffect(() => {
    const win = getCurrentWindow();
    let ignoring = null;
    const apply = async (v) => {
      if (ignoring === v) return;
      try { await win.setIgnoreCursorEvents(v); ignoring = v; } catch { /* ignore */ }
    };
    const tick = async () => {
      try {
        const [c, p, sf] = await Promise.all([cursorPosition(), win.innerPosition(), win.scaleFactor()]);
        const x = (c.x - p.x) / sf;
        const y = (c.y - p.y) / sf;
        const hit = Array.from(document.querySelectorAll('[data-hit]')).some((el) => {
          const r = el.getBoundingClientRect();
          return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
        });
        await apply(!hit);
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, []);
}

function useWindowFit(H) {
  useEffect(() => {
    if (!H) return;
    (async () => {
      try {
        const mon = await currentMonitor();
        if (!mon) return;
        const h = Math.round(H * mon.scaleFactor);
        const win = getCurrentWindow();
        await win.setSize(new PhysicalSize(mon.size.width, h));
        await win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y + mon.size.height - h));
      } catch (e) { console.warn('fit failed', e); }
    })();
  }, [H]);
}

function useStartupPrompt() {
  useEffect(() => {
    (async () => {
      try {
        const st = await getStore();
        if (await st.get('startupAsked')) return;
        await new Promise((r) => setTimeout(r, 2500));
        if (!(await isEnabled())) {
          const yes = await ask(
            'Would you like Maranatha to start automatically when you sign in to Windows?',
            { title: 'Maranatha', kind: 'info', okLabel: 'Yes, start with Windows', cancelLabel: 'Not now' }
          );
          if (yes) await enable();
        }
        await st.set('startupAsked', true);
        await st.save();
      } catch (e) { console.warn('startup prompt failed', e); }
    })();
  }, []);
}

function AutostartToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => { isEnabled().then(setOn).catch(() => {}); }, []);
  return (
    <label className="sp-check">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const v = e.target.checked;
          try { if (v) await enable(); else await disable(); setOn(v); } catch (err) { console.warn(err); }
        }}
      />
      Start Maranatha with Windows
    </label>
  );
}

/* ================= Art / data ================= */

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = [
  { c: '#ff3b30', l: '#ffa59c', d: '#8f0c06' },
  { c: '#33d65a', l: '#aef7c0', d: '#0a5e22' },
  { c: '#ffb81f', l: '#ffe7a3', d: '#9c5a00' },
  { c: '#3b8bff', l: '#b0d1ff', d: '#0a3a92' },
  { c: '#ff4fb3', l: '#ffbde2', d: '#8c0b5a' },
  { c: '#ff7a1a', l: '#ffc794', d: '#8f3400' },
  { c: '#e8b23a', l: '#fff1b8', d: '#6e4a0c' },
  { c: '#c9d3de', l: '#ffffff', d: '#5f6b78' },
];
const LIGHT_COLORS = PALETTE.slice(0, 6);

const TW = 140;
const TH = 190;
const CX = 70;
const NEEDLE_COLORS = ['#082c14', '#12482a', '#1c6334', '#2c8142', '#58ad69'];

const tree = (() => {
  const r = rng(42);
  const cfg = [
    { top: 108, bot: 166, half: 55 },
    { top: 82, bot: 138, half: 44 },
    { top: 56, bot: 108, half: 33 },
    { top: 34, bot: 78, half: 22 },
  ];

  const tiers = cfg.map(({ top, bot, half }) => {
    const left = [];
    const right = [];
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const spike = i % 2 ? 3.2 * (0.4 + r() * 0.6) : 0;
      const y = top + (bot - 6 - top) * f + (i % 2 ? 0 : 2);
      left.push([CX - half * f - spike, y]);
      right.push([CX + half * f + spike, y]);
    }
    const bottom = [];
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const tipX = CX - half + (2 * half * k) / n;
      bottom.push([tipX, bot + r() * 3]);
      if (k < n) bottom.push([tipX + half / n, bot - 5 - r() * 2]);
    }
    const pts = [[CX, top], ...left, ...bottom, ...right.reverse()];
    const path = 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z';

    const groups = NEEDLE_COLORS.map(() => '');
    const count = Math.round(half * 7);
    for (let i = 0; i < count; i++) {
      const y = top + 4 + r() * (bot - top - 2);
      const w = half * ((y - top) / (bot - top));
      const x = CX + (r() * 2 - 1) * w * 0.96;
      const side = x >= CX ? 1 : -1;
      const L = 3.5 + r() * 3.5;
      const dx = side * (0.5 + r()) * L * 0.8;
      const dy = L * 0.9;
      const lit = (x - CX) / half / 2 + 0.5;
      const idx = Math.min(4, Math.floor((r() * 0.62 + lit * 0.5) * 5));
      groups[idx] += `M${x.toFixed(1)} ${y.toFixed(1)}l${dx.toFixed(1)} ${dy.toFixed(1)}`;
    }
    return { path, groups };
  });

  const lights = [];
  cfg.forEach(({ top, bot, half }, ti) => {
    const n = 4 + (cfg.length - ti);
    for (let i = 0; i < n; i++) {
      const y = top + (bot - top) * (0.35 + r() * 0.6);
      const w = half * ((y - top) / (bot - top));
      lights.push({
        x: CX + (r() * 2 - 1) * w * 0.85,
        y,
        ci: lights.length % LIGHT_COLORS.length,
        delay: -r() * 3,
      });
    }
  });

  const ornaments = [
    { x: 58, y: 94, i: 0 }, { x: 84, y: 118, i: 3 }, { x: 44, y: 134, i: 6 },
    { x: 98, y: 150, i: 1 }, { x: 70, y: 70, i: 7 }, { x: 60, y: 154, i: 3 },
    { x: 78, y: 99, i: 6 }, { x: 30, y: 154, i: 0 },
  ];

  const star = Array.from({ length: 10 }, (_, k) => {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rad = k % 2 ? 4.7 : 11;
    return `${(CX + Math.cos(a) * rad).toFixed(1)},${(24 + Math.sin(a) * rad).toFixed(1)}`;
  }).join(' ');

  return { tiers, lights, ornaments, star };
})();

const FLAKES = (() => {
  const r = rng(5);
  return Array.from({ length: CONFIG.snow.flakes }, () => ({
    left: r() * 100,
    size: 1.2 + r() * 2.2,
    dur: 4 + r() * 5,
    delay: -r() * 9,
    drift: (r() * 2 - 1) * 14,
    op: 0.55 + r() * 0.45,
  }));
})();

const GROUND = (() => {
  const r = rng(11);
  let d = 'M0 8 V4';
  for (let x = 0; x < 600; x += 15) {
    d += ` Q${x + 7.5} ${(1 + r() * 3).toFixed(1)} ${x + 15} ${(3 + r() * 1.5).toFixed(1)}`;
  }
  return d + ' V8 Z';
})();

/* ================= Season ================= */

function isSeasonActive(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const start = new Date(y, 10, 15).getTime();
  const end = new Date(y + 1, 0, 1).getTime();
  return now >= start && now < end;
}

/* ================= Countdown ================= */

const DAY = 864e5;
function getCountdown(now) {
  let y = new Date(now).getFullYear();
  let start = new Date(y, 11, 25).getTime();
  let end = new Date(y, 11, 26).getTime();
  if (now >= end) {
    y += 1;
    start = new Date(y, 11, 25).getTime();
    end = new Date(y, 11, 26).getTime();
  }
  if (now >= start && now < end) return { isDay: true };
  const diff = start - now;
  return {
    isDay: false,
    d: Math.floor(diff / DAY),
    h: Math.floor((diff % DAY) / 36e5),
    m: Math.floor((diff % 36e5) / 6e4),
    s: Math.floor((diff % 6e4) / 1e3),
  };
}
function useCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return getCountdown(now);
}
const pad = (n) => String(n).padStart(2, '0');

/* ================= Cursor hooks ================= */

// True while the system cursor is inside the element's current on-screen rect.
function useCursorInRect(ref, padPx = 6, enabled = true) {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    if (!enabled) { setInside(false); return; }
    const win = getCurrentWindow();
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const el = ref.current;
      if (!el) { setInside((p) => (p ? false : p)); return; }
      try {
        const [c, p, sf] = await Promise.all([
          cursorPosition(),
          win.innerPosition(),
          win.scaleFactor(),
        ]);
        const x = (c.x - p.x) / sf;
        const y = (c.y - p.y) / sf;
        const r = el.getBoundingClientRect();
        const hit =
          x >= r.left - padPx && x <= r.right + padPx &&
          y >= r.top  - padPx && y <= r.bottom + padPx;
        if (alive) setInside((prev) => (prev === hit ? prev : hit));
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 50);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [ref, padPx, enabled]);
  return inside;
}

// Pauses every CSS animation on the element (and its children) while `paused`
// is true, and resumes them the moment it becomes false. Uses the Web
// Animations API so it works regardless of how the CSS is written.
function usePauseAnimations(ref, paused) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      let list = [];
      try { list = el.getAnimations({ subtree: true }); } catch { /* ignore */ }
      list.forEach((a) => {
        try {
          if (paused) { if (a.playState === 'running') a.pause(); }
          else if (a.playState === 'paused') a.play();
        } catch { /* ignore */ }
      });
    };
    apply();
    // Re-apply for a moment in case animations start/restart right after render.
    const id = setInterval(apply, 150);
    return () => clearInterval(id);
  }, [ref, paused]);
}

/* ================= Lights / garland ================= */

function LightString({ spacing, sag, cuts, vw }) {
  const { d, bulbs } = useMemo(() => {
    const r = rng(3);
    const SWAG = 120;
    const yAt = (x) => 1.5 + sag * Math.sin(Math.PI * ((x % SWAG) / SWAG));
    const cut = (x, p = 0) => cuts.some((c) => x >= c.from - p && x <= c.to + p);
    let path = '';
    let pen = false;
    for (let x = 0; x <= vw; x += 2) {
      if (cut(x)) { pen = false; continue; }
      path += `${pen ? ' L' : ' M'}${x} ${yAt(x).toFixed(1)}`;
      pen = true;
    }
    const list = [];
    let n = 0;
    for (let x = spacing / 2; x < vw; x += spacing, n++) {
      const delay = -r() * 3;
      if (cut(x, 3)) continue;
      list.push({ x, y: yAt(x), ci: n % LIGHT_COLORS.length, delay });
    }
    return { d: path, bulbs: list };
  }, [vw, spacing, sag, cuts]);

  return (
    <svg className="mini-lights" width={vw} height={sag + 14}>
      <defs>
        {LIGHT_COLORS.map((p, i) => (
          <g key={i}>
            <radialGradient id={`mlg-${i}`}>
              <stop offset="0" stopColor={p.c} stopOpacity="0.65" />
              <stop offset="1" stopColor={p.c} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`mlb-${i}`} cx="0.36" cy="0.3" r="0.85">
              <stop offset="0" stopColor={p.l} /><stop offset="0.5" stopColor={p.c} /><stop offset="1" stopColor={p.d} />
            </radialGradient>
          </g>
        ))}
      </defs>
      <path className="ml-wire" d={d} />
      {bulbs.map((b, i) => (
        <g key={i} className="ml-bulb" style={{ '--d': `${b.delay}s` }}>
          <circle className="ml-glow" cx={b.x} cy={b.y + 4.5} r="6.5" fill={`url(#mlg-${b.ci})`} />
          <rect x={b.x - 1} y={b.y - 0.4} width="2" height="2.4" rx="0.4" fill="#1d3a23" />
          <path
            d={`M${b.x - 1.2} ${b.y + 2} C${b.x - 2.5} ${b.y + 4.5} ${b.x - 2.1} ${b.y + 7} ${b.x} ${b.y + 8} C${b.x + 2.1} ${b.y + 7} ${b.x + 2.5} ${b.y + 4.5} ${b.x + 1.2} ${b.y + 2} Z`}
            fill={`url(#mlb-${b.ci})`}
          />
          <ellipse cx={b.x - 0.7} cy={b.y + 4.2} rx="0.35" ry="1" fill="#fff" opacity="0.85" />
        </g>
      ))}
    </svg>
  );
}

const SW = 300;
const SH = 44;
const SAGS = 7;
const SWAGS = 3;
const SWAG_W = (SW - 4) / SWAGS;
const SOCK_STYLES = [
  { body: '#c4222d', trim: '#f4f1e8', stripe: null },
  { body: '#1f7a3a', trim: '#f4f1e8', stripe: null },
  { body: '#f4f1e8', trim: '#c4222d', stripe: '#c4222d' },
];
const sockGarland = (() => {
  const r = rng(21);
  let d = 'M2 2';
  const socks = [];
  const berries = [];
  const nails = [];
  for (let w = 0; w < SWAGS; w++) {
    const x0 = 2 + w * SWAG_W;
    d += ` Q${(x0 + SWAG_W / 2).toFixed(1)} ${2 + 2 * SAGS} ${(x0 + SWAG_W).toFixed(1)} 2`;
    nails.push(x0);
    [0.22, 0.5, 0.78].forEach((t, k) => {
      socks.push({
        x: x0 + SWAG_W * t,
        y: 2 + 4 * SAGS * t * (1 - t),
        st: SOCK_STYLES[(w * 3 + k) % 3],
        flip: (w + k) % 2 === 1,
        delay: -r() * 3.6,
      });
    });
    for (let t = 0.08; t < 1; t += 0.12) {
      berries.push({ x: x0 + SWAG_W * t, y: 2 + 4 * SAGS * t * (1 - t) - 1.6 });
    }
  }
  nails.push(2 + SWAGS * SWAG_W);
  return { d, socks, berries, nails };
})();

function SockGarland({ cfg, cuts, vw }) {
  const w = cfg.width;
  const left = cfg.side === 'left' ? cfg.x : vw - cfg.x - w;
  return (
    <svg
      className="sock-garland"
      viewBox={`0 0 ${SW} ${SH}`}
      style={{ left, top: cfg.y, width: w, height: (w * SH) / SW }}
    >
      <defs>
        <mask id="sockCutMask" maskUnits="userSpaceOnUse" x="-100" y="-100" width={SW + 200} height={SH + 200}>
          <rect x="-100" y="-100" width={SW + 200} height={SH + 200} fill="#fff" />
          {cuts.map((c, i) => (
            <rect
              key={i}
              x={((c.from - left) * SW) / w}
              y="-100"
              width={Math.max(0, ((c.to - c.from) * SW) / w)}
              height={SH + 200}
              fill="#000"
            />
          ))}
        </mask>
      </defs>
      <g mask="url(#sockCutMask)">
        <path d={sockGarland.d} fill="none" stroke="#14401f" strokeWidth="4.2" strokeLinecap="round" />
        <path d={sockGarland.d} fill="none" stroke="#4aa35a" strokeWidth="3" strokeDasharray="1 1.6" />
        {sockGarland.berries.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r="1" fill="#d6283a" />
        ))}
        {sockGarland.socks.map((k, i) => (
          <g key={i} transform={`translate(${k.x.toFixed(1)} ${k.y.toFixed(1)})${k.flip ? ' scale(-1 1)' : ''}`}>
            <g className="sock-sway" style={{ '--d': `${k.delay}s` }}>
              <path
                d="M-4.5 2 H4.5 V15 C4.5 18 10 18 10.5 22.5 C10.8 26 7.5 27 4.5 26.5 C-1 26.5 -4.5 24 -4.5 18 Z"
                fill={k.st.body}
              />
              {k.st.stripe && (
                <g fill={k.st.stripe}>
                  <rect x="-4.5" y="7" width="9" height="1.8" />
                  <rect x="-4.5" y="11" width="9" height="1.8" />
                </g>
              )}
              <rect x="-4.5" y="4" width="2" height="13" fill="#000" opacity="0.16" />
              <circle cx="3.6" cy="17" r="2" fill={k.st.trim} opacity="0.95" />
              <path d="M6.5 22.5 C8.5 22 10.4 23 10.4 24.4 C9.5 26.4 7.5 26.8 6.2 26.4 Z" fill={k.st.trim} />
              <rect x="-5.6" y="0" width="11.2" height="4.8" rx="2.4" fill="#f6f3ec" />
              <rect x="-5.6" y="0" width="11.2" height="2" rx="1" fill="#fff" />
              <rect x="-5.6" y="3" width="11.2" height="1.8" rx="0.9" fill="#c9c3b6" opacity="0.7" />
            </g>
          </g>
        ))}
        {sockGarland.nails.map((x, i) => (
          <circle key={i} cx={x} cy="2" r="1.6" fill="#d9b24a" />
        ))}
      </g>
    </svg>
  );
}

function Snowman() {
  return (
    <svg className="snowman-svg" viewBox="0 0 60 100" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id="snowBall" cx="0.62" cy="0.35" r="0.85">
          <stop offset="0" stopColor="#fffdf7" /><stop offset="0.55" stopColor="#e4eef9" /><stop offset="1" stopColor="#9fb7d1" />
        </radialGradient>
      </defs>
      <ellipse cx="30" cy="98" rx="25" ry="3" fill="#000" opacity="0.25" />
      <path d="M16 46 L3 38 M8 41 L4 46 M8 41 L5 36" stroke="#4a2f1b" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <g className="sm-arm">
        <path d="M44 46 L57 33 M52 39 L58 40 M52 39 L53 33" stroke="#4a2f1b" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
      <circle cx="30" cy="78" r="21" fill="url(#snowBall)" />
      <circle cx="30" cy="48" r="15.5" fill="url(#snowBall)" />
      <circle cx="30" cy="24" r="11.5" fill="url(#snowBall)" />
      <ellipse cx="38" cy="62" rx="5" ry="9" fill="#ff9a40" opacity="0.1" />
      {[44, 51, 58, 72, 80].map((y) => (
        <circle key={y} cx="30" cy={y} r="1.6" fill="#1b1b1f" />
      ))}
      <circle cx="26" cy="22" r="1.4" fill="#16161a" />
      <circle cx="34" cy="22" r="1.4" fill="#16161a" />
      <circle cx="23.5" cy="27" r="2" fill="#ff8aa0" opacity="0.28" />
      <circle cx="36.5" cy="27" r="2" fill="#ff8aa0" opacity="0.28" />
      <polygon points="30,25 42,27.4 30,28.8" fill="#ff8a1f" />
      <polygon points="30,27 42,27.4 30,28.8" fill="#d8650a" />
      {[[24.6, 29.8], [26.8, 31.5], [30, 32.2], [33.2, 31.5], [35.4, 29.8]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.85" fill="#16161a" />
      ))}
      <ellipse cx="30" cy="14.6" rx="13" ry="2.6" fill="#1b1b1f" />
      <rect x="21" y="2" width="18" height="12.6" rx="1.6" fill="#26262c" />
      <rect x="21" y="9.6" width="18" height="3.2" fill="#c4222d" />
      <rect x="23" y="3" width="2" height="9" fill="#fff" opacity="0.13" />
      <path d="M18.5 34 Q30 40.5 41.5 34 L42 38.6 Q30 45 18 38.6 Z" fill="#c4222d" />
      <path d="M22 37.5 L22.6 41.6 M28 39.4 L28.4 43.6 M34 39.4 L33.6 43.6 M39 37.5 L38.4 41.6" stroke="#fff" strokeWidth="1.2" opacity="0.85" />
      <g className="sm-scarf">
        <path d="M35 40 L42 39 L45 56 L37.5 55 Z" fill="#c4222d" />
        <path d="M36.2 46 L43.6 45.2 M37 51 L44.4 50.4" stroke="#fff" strokeWidth="1.3" opacity="0.85" />
        <path d="M37.5 55 L45 56 M38.2 55 v3 M40.4 55.3 v3 M42.6 55.6 v3 M44.8 56 v3" stroke="#c4222d" strokeWidth="0.9" />
      </g>
      <ellipse cx="22" cy="68" rx="4" ry="7" fill="#fff" opacity="0.35" />
      <ellipse cx="24" cy="42" rx="2.6" ry="4.6" fill="#fff" opacity="0.35" />
    </svg>
  );
}

function MangerScene() {
  return (
    <svg viewBox="0 0 180 140" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="mgThatch" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6bd58" /><stop offset="1" stopColor="#9a6f24" />
        </linearGradient>
        <linearGradient id="mgWood" x1="0" x2="1">
          <stop offset="0" stopColor="#4d3119" /><stop offset="0.5" stopColor="#8f6034" /><stop offset="1" stopColor="#472c15" />
        </linearGradient>
        <radialGradient id="mgInner" cx="0.5" cy="0.85" r="0.85">
          <stop offset="0" stopColor="#ffbf62" /><stop offset="0.45" stopColor="#7d4720" /><stop offset="1" stopColor="#1e1109" />
        </radialGradient>
        <radialGradient id="mgHalo">
          <stop offset="0" stopColor="#fff6cc" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#ffd066" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffb300" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mgStar">
          <stop offset="0" stopColor="#fff2a8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd34d" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="90" cy="134" rx="76" ry="5" fill="#000" opacity="0.3" />
      <rect x="40" y="50" width="100" height="82" fill="url(#mgInner)" />
      <circle className="coals" cx="90" cy="108" r="28" fill="url(#mgHalo)" />

      <ellipse cx="90" cy="131" rx="64" ry="5" fill="#cfa94c" />
      <path d="M36 130 L44 126 M52 133 L60 128 M120 133 L128 128 M136 130 L144 125 M72 135 L80 131 M104 135 L112 131" stroke="#e8c866" strokeWidth="1.3" strokeLinecap="round" />

      <ellipse cx="76.5" cy="77" rx="1.7" ry="5.2" fill="#7b8089" transform="rotate(-12 76.5 77)" />
      <ellipse cx="87.5" cy="77" rx="1.7" ry="5.2" fill="#7b8089" transform="rotate(12 87.5 77)" />
      <ellipse cx="82" cy="87" rx="5.4" ry="7.6" fill="#8c919a" />
      <ellipse cx="82" cy="93" rx="3.4" ry="2.6" fill="#cfd2d8" />
      <circle cx="79.6" cy="85" r="0.7" fill="#222" />
      <circle cx="84.4" cy="85" r="0.7" fill="#222" />
      <path d="M95.5 82 C92 79 92 75 94.5 74 M107.5 82 C111 79 111 75 108.5 74" stroke="#efe6cf" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <ellipse cx="94" cy="85" rx="2.4" ry="1.4" fill="#6a3f22" />
      <ellipse cx="108" cy="85" rx="2.4" ry="1.4" fill="#6a3f22" />
      <ellipse cx="101" cy="88" rx="6.2" ry="7.4" fill="#7a4a2a" />
      <ellipse cx="101" cy="93.5" rx="3.8" ry="2.7" fill="#dbbca2" />
      <circle cx="98.6" cy="86" r="0.7" fill="#222" />
      <circle cx="103.4" cy="86" r="0.7" fill="#222" />

      <path d="M56 128 C52 112 56 100 66 96 C76 98 82 110 80 128 Z" fill="#2f66b5" />
      <path d="M62 112 C66 118 74 118 78 112" stroke="#244f8c" strokeWidth="1.2" fill="none" />
      <circle cx="67" cy="90" r="5.2" fill="#f0c8a0" />
      <path d="M60 91 C59 82 75 82 74 92 C74 98 71 102 69 108 C63 104 60 98 60 91 Z" fill="#e8edf7" />
      <path d="M60.5 90 C61 84 73 84 73.5 90" fill="none" stroke="#2f66b5" strokeWidth="1.4" />
      <circle cx="77" cy="107" r="2" fill="#f0c8a0" />

      <path d="M122 128 C120 108 124 98 132 94 C140 98 144 110 142 128 Z" fill="#8a5a2b" />
      <path d="M122 106 H142" stroke="#d6b46a" strokeWidth="1.6" />
      <circle cx="131" cy="88" r="5.2" fill="#f0c8a0" />
      <path d="M124.4 87 C124 79 138 79 137.6 88 C135.6 84.6 126.4 84.6 124.4 87 Z" fill="#c9b27a" />
      <path d="M127.2 91 C128.4 97 134 97 135 91 Z" fill="#4a3320" />
      <path d="M118 72 L118 130" stroke="#6b4a2a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M118 74 C118 66 125 66 125 71" stroke="#6b4a2a" strokeWidth="1.8" fill="none" strokeLinecap="round" />

      <path d="M80 126 L74 134 M100 126 L106 134" stroke="#5a3a1c" strokeWidth="2" strokeLinecap="round" />
      <polygon points="72,112 108,112 102,126 78,126" fill="url(#mgWood)" />
      <ellipse cx="90" cy="112" rx="17" ry="3.4" fill="#e6c25a" />
      <ellipse cx="91" cy="110.6" rx="8" ry="3.2" fill="#f7f3e8" />
      <circle cx="83.5" cy="109.2" r="3.6" fill="#f4cfa8" />
      <path d="M82 109.6 q1.2 0.8 2.4 0" stroke="#7a4a2a" strokeWidth="0.5" fill="none" />

      <rect x="36" y="52" width="6" height="80" fill="url(#mgWood)" />
      <rect x="138" y="52" width="6" height="80" fill="url(#mgWood)" />
      <rect x="34" y="62" width="112" height="4" fill="url(#mgWood)" />

      <polygon points="10,66 90,14 90,28 22,74" fill="url(#mgThatch)" stroke="#7a5518" strokeWidth="0.6" />
      <polygon points="170,66 90,14 90,28 158,74" fill="url(#mgThatch)" stroke="#7a5518" strokeWidth="0.6" />
      <path d="M22 66 L90 22 M30 70 L90 29 M16 62 L88 16 M158 66 L90 22 M150 70 L90 29 M164 62 L92 16" stroke="#8a6422" strokeWidth="0.6" opacity="0.65" />

      <g className="star-glow">
        <circle cx="90" cy="8" r="14" fill="url(#mgStar)" />
        <polygon points="90,-3 92,6 101,8 92,10 90,19 88,10 79,8 88,6" fill="#fff3b0" />
        <polygon points="84,2 90,6.4 96,2 93.6,8 96,14 90,9.6 84,14 86.4,8" fill="#ffe27a" opacity="0.8" />
      </g>
    </svg>
  );
}

function Sheep({ x, y, s = 1, flip = false }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <path d="M-4 4 V8 M3 4 V8" stroke="#3b3a3a" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="-5" cy="0" r="4.6" fill="#f4f2ec" />
      <circle cx="0" cy="-2" r="5" fill="#fbfaf6" />
      <circle cx="5" cy="0" r="4.6" fill="#f4f2ec" />
      <circle cx="0" cy="2" r="4.6" fill="#e8e6df" />
      <ellipse cx="9.5" cy="-0.5" rx="3" ry="3.3" fill="#3b3a3a" />
      <ellipse cx="8" cy="-3.4" rx="1.4" ry="0.8" fill="#2c2b2b" transform="rotate(-30 8 -3.4)" />
      <circle cx="10.4" cy="-1.2" r="0.5" fill="#fff" />
    </g>
  );
}

const SHEPHERD_STYLES = [
  { robe: '#3b5b8c', sash: '#d6b46a', skin: '#e7b88e', hat: '#efe3c6' },
  { robe: '#8a4b2a', sash: '#d6b46a', skin: '#e7b88e', hat: '#e8dcc0' },
  { robe: '#6b2e5e', sash: '#e0c86a', skin: '#c8916b', hat: '#e6d4a8' },
  { robe: '#2f6b4a', sash: '#c9a24a', skin: '#e7b88e', hat: '#f0e6cc' },
  { robe: '#a0432a', sash: '#d6b46a', skin: '#d9a880', hat: '#e8dcc0' },
  { robe: '#385a7a', sash: '#e0c86a', skin: '#f0c8a0', hat: '#efe3c6' },
  { robe: '#7a4a2a', sash: '#c9a24a', skin: '#e7b88e', hat: '#e8dcc0' },
];

function ShepherdFigure({ x, style, s = 1 }) {
  return (
    <g transform={`translate(${x} 0) scale(${s})`}>
      <line x1={0} y1={16} x2={0} y2={112} stroke="#6b4a2a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M0 18 C0 9 10 9 10 16" fill="none" stroke="#6b4a2a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M-16 110 C-18 84 -14 66 -4 60 C6 66 10 84 8 110 Z" fill={style.robe} />
      <rect x="-15" y="88" width="23" height="2.4" fill={style.sash} />
      <path d="M5 74 L16 78" stroke={style.robe} strokeWidth="4" strokeLinecap="round" />
      <circle cx="16.4" cy="78.4" r="2.2" fill={style.skin} />
      <circle cx="-4" cy="50" r="5.4" fill={style.skin} />
      <path d="M-10.8 49 C-11 40.5 3 40.5 2.8 49 C1 45.5 -9 45.5 -10.8 49 Z" fill={style.hat} />
      <path d="M-11 49 L-12 57 M3 49 L4 57" stroke={style.hat} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M-7.8 54 C-7 59.5 -1 59.5 -0.2 54 Z" fill="#5a3a22" />
      <path d="M-10.5 47 Q-4 49 2.5 47" stroke="#6b4a2a" strokeWidth="1" fill="none" />
    </g>
  );
}

function Shepherds() {
  return (
    <svg viewBox="0 0 340 120" width="100%" height="100%" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="shHill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f5f3c" /><stop offset="1" stopColor="#1f3320" />
        </linearGradient>
        <radialGradient id="shGlow" cx="0.5" cy="0.6">
          <stop offset="0" stopColor="#ffa24a" stopOpacity="0.7" /><stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="shFlame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5a12" /><stop offset="0.6" stopColor="#ffab2e" /><stop offset="1" stopColor="#ffe27a" />
        </linearGradient>
      </defs>

      <path d="M0 120 C40 100 100 96 170 100 C240 96 300 100 340 120 Z" fill="url(#shHill)" />
      <path d="M22 108 C62 99 112 97 170 100 C224 97 274 100 318 108" fill="none"
            stroke="#eef5fa" strokeWidth="2" opacity="0.65" strokeLinecap="round" />
      <circle className="coals" cx="170" cy="104" r="34" fill="url(#shGlow)" />

      <ShepherdFigure x={38} style={SHEPHERD_STYLES[0]} s={0.95} />
      <ShepherdFigure x={78} style={SHEPHERD_STYLES[1]} s={0.9} />
      <ShepherdFigure x={118} style={SHEPHERD_STYLES[2]} s={0.92} />

      <path d="M150 112 L190 108 M152 108 L190 112" stroke="#3a2312" strokeWidth="3" strokeLinecap="round" />
      <g className="flame f2"><path d="M160 109 C158 102 163 98 165 90 C167 97 173 100 171 109 Z" fill="url(#shFlame)" /></g>
      <g className="flame f3"><path d="M166 109 C165 104 168 102 168.5 98 C170 102 173 105 171.5 109 Z" fill="#ffd45a" /></g>

      <ShepherdFigure x={218} style={SHEPHERD_STYLES[3]} s={0.92} />
      <ShepherdFigure x={256} style={SHEPHERD_STYLES[4]} s={0.95} />
      <ShepherdFigure x={294} style={SHEPHERD_STYLES[5]} s={0.9} />
      <ShepherdFigure x={324} style={SHEPHERD_STYLES[6]} s={0.88} />

      <Sheep x={130} y={108} s={1.1} />
      <Sheep x={205} y={111} s={1} flip />
      <Sheep x={300} y={110} s={0.95} />
      <Sheep x={240} y={112} s={0.9} flip />
    </svg>
  );
}

function FlameLayer({ scale, fill, cls }) {
  return (
    <g className={`flame ${cls}`}>
      <g transform={`translate(75 114) scale(${scale}) translate(-75 -114)`} fill={fill}>
        <use href="#tongueC" />
        <use href="#tongueL" />
        <use href="#tongueR" />
      </g>
    </g>
  );
}

function Stocking({ x, body, trim, flip }) {
  return (
    <g transform={`translate(${x} 24)${flip ? ' scale(-1 1)' : ''}`}>
      <g className="stocking-sway">
        <path d="M0 -4 L0 -22" stroke="#d9b24a" strokeWidth="0.8" fill="none" />
        <path d="M0 0 H12 V20 C12 24 20 25 22 30 C23 35 19 37 14 36 C6 36 0 32 0 25 Z" fill={body} />
        <path d="M0 0 H4 V26 C4 30 8 33 12 34 C6 34 0 31 0 25 Z" fill="#000" opacity="0.22" />
        <path d="M12 21 C16 24 20 25 22 30 C21 27 17 25 12 23 Z" fill="#fff" opacity="0.15" />
        <path d="M13 30 C16 29 21 31 21.5 33 C20 36 16 36.5 13 35.5 Z" fill={trim} />
        <path d="M0 22 C3 22 6 25 8 30 C5 31 1 29 0 25 Z" fill={trim} />
        <rect x="-1.2" y="-3.6" width="14.4" height="6" rx="3" fill="#f6f3ec" />
        <rect x="-1.2" y="-3.6" width="14.4" height="2.4" rx="1.2" fill="#fff" />
        <rect x="-1.2" y="0" width="14.4" height="2.4" rx="1.2" fill="#c9c3b6" opacity="0.7" />
      </g>
    </g>
  );
}

function getSkyMask(cuts) {
  if (!cuts || cuts.length === 0) return {};
  const sorted = [...cuts].sort((a, b) => a.from - b.from);
  const stops = ['#fff 0px'];
  let lastX = 0;

  sorted.forEach((c) => {
    const from = Math.max(0, c.from);
    const to = Math.max(from, c.to);
    if (from > lastX) stops.push(`#fff ${from}px`);
    stops.push(`transparent ${from}px`);
    stops.push(`transparent ${to}px`);
    lastX = Math.max(lastX, to);
  });

  stops.push(`#fff ${lastX}px`);
  stops.push(`#fff 100%`);

  const val = `linear-gradient(to right, ${stops.join(', ')})`;
  return { maskImage: val, WebkitMaskImage: val };
}

/* ================= Sleigh ================= */

function Leg({ hx, color, d, k = 1, hy = 15, a = 6, b = 7 }) {
  return (
    <g className="rd-hip" style={{ transformOrigin: `${hx}px ${hy}px`, '--d': `${d}s` }}>
      <line x1={hx} y1={hy} x2={hx} y2={hy + a} stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <g className="rd-knee" style={{ transformOrigin: `${hx}px ${hy + a}px`, '--k': k }}>
        <line x1={hx} y1={hy + a} x2={hx} y2={hy + a + b} stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        <rect x={hx - 1.2} y={hy + a + b - 0.4} width="2.6" height="1.4" rx="0.6" fill="#1e1109" />
      </g>
    </g>
  );
}

function Reindeer({ x, y = 4, lead = false, phase = 0 }) {
  const body = lead ? '#8a5a34' : '#7a4c2c';
  const near = lead ? '#7a4a2a' : '#6a3f22';
  return (
    <svg x={x} y={y} width="32" height="30" viewBox="0 0 32 30" overflow="visible">
      <g className="rd-bob" style={{ '--d': `${-phase}s` }}>
        <Leg hx={17} color="#4a2d17" d={-0.12 - phase} />
        <Leg hx={10} color="#4a2d17" d={-0.47 - phase} k={-0.6} />
        <ellipse cx="4.6" cy="9" rx="1.6" ry="1.2" fill="#f4f1e8" />
        <ellipse cx="14" cy="12" rx="9.5" ry="5" fill={body} />
        <ellipse cx="15" cy="15" rx="6.5" ry="2.4" fill="#d9c3a0" opacity="0.55" />
        <path d="M20 9 C22 6 24.5 4.5 26.5 4 L28.5 7.5 C26 9 24 11.5 22.5 14 Z" fill={body} />
        <g className="rd-head">
          <path
            d="M27.4 2.6 L26 -2 M26.6 0 L24 -0.6 M26.1 -1.2 L24.6 -3.4 M28.4 2.2 L29.4 -2 M28.9 0 L31 -0.6"
            stroke="#e2d2a8" strokeWidth="0.8" strokeLinecap="round" fill="none"
          />
          <ellipse cx="28.6" cy="5.6" rx="3.3" ry="2.3" transform="rotate(20 28.6 5.6)" fill={body} />
          <ellipse cx="30.8" cy="7" rx="1.6" ry="1.2" fill="#d9c3a0" />
          <ellipse cx="26.6" cy="3.6" rx="1.8" ry="0.8" transform="rotate(-35 26.6 3.6)" fill="#5a3419" />
          <circle cx="29.2" cy="4.8" r="0.55" fill="#1b1209" />
          {lead ? (
            <>
              <circle className="nose-glow" cx="32" cy="6.8" r="3" fill="#ff3b30" opacity="0.4" />
              <circle cx="32" cy="6.8" r="1.1" fill="#ff3b30" />
            </>
          ) : (
            <circle cx="32" cy="6.8" r="0.8" fill="#2a1a0e" />
          )}
        </g>
        <Leg hx={20} color={near} d={-phase} />
        <Leg hx={7} color={near} d={-0.35 - phase} k={-0.6} />
        <path d="M19 7.5 C20 11 20.5 14 20.5 16.5" stroke="#c4222d" strokeWidth="1.1" fill="none" />
        <circle cx="20.5" cy="17" r="1" fill="#ffd34d" />
      </g>
    </svg>
  );
}

function SleighTeam() {
  return (
    <svg className="plow-svg" viewBox="0 0 112 34" width="100%" height="100%">
      <circle className="dust d1" cx="2" cy="30" r="0.9" fill="#fff6c2" />
      <circle className="dust d2" cx="2" cy="30" r="0.7" fill="#fff" />
      <circle className="dust d3" cx="2" cy="30" r="0.8" fill="#ffe27a" />
      <path d="M40 23 L64.5 20.5 L96.5 20.5" stroke="#5a3a1c" strokeWidth="0.7" fill="none" />
      <path d="M26 15 Q44 11 64.5 14" stroke="#c4222d" strokeWidth="0.5" fill="none" />
      <Reindeer x={44} phase={0.2} />
      <Reindeer x={76} lead />
      <path d="M6 19 C5 12 12 10 14 15 C15 17 14 19 14 19 Z" fill="#8a5a2b" />
      <path d="M9 12.5 L11 12" stroke="#d9b24a" strokeWidth="0.8" />
      <rect x="30" y="14.5" width="6" height="5" fill="#2f63c9" />
      <rect x="32.4" y="14.5" width="1.2" height="5" fill="#e9eef5" />
      <rect x="35" y="16.5" width="4.5" height="3" fill="#c8a032" />
      <ellipse cx="22" cy="16" rx="5" ry="5.5" fill="#c4222d" />
      <circle cx="22" cy="9" r="3" fill="#fde3c8" />
      <path d="M19.4 10 C19.5 14 24.5 14 24.6 10 C23 11.4 21 11.4 19.4 10Z" fill="#fff" />
      <path d="M19.2 7.2 C19.5 2.5 24 2 26 5 C25 4.6 24.4 4.8 24.8 7.2 Z" fill="#c4222d" />
      <rect x="18.8" y="6.4" width="6.4" height="1.6" rx="0.8" fill="#fff" />
      <circle cx="26" cy="5" r="1.1" fill="#fff" />
      <g className="sm-arm">
        <path d="M25.5 14.5 L30 9.5" stroke="#c4222d" strokeWidth="2" strokeLinecap="round" />
        <circle cx="30.4" cy="9" r="1.3" fill="#fff" />
      </g>
      <path d="M1 29 C1 31 3 32 6 32 H38 C42 32 43 28 40 26" stroke="#d9b24a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M10 32 V26 M30 32 V26" stroke="#8f6a1e" strokeWidth="1.2" />
      <path d="M3 14 C3 22 8 26 16 26 H36 C40 26 41 20 41 15 C38 18 36 19 33 19 H9 C6 19 4 17 3 14 Z" fill="#c4222d" />
      <path d="M3 14 C4 17 6 19 9 19 H33 C36 19 38 18 41 15" stroke="#e6c25a" strokeWidth="1" fill="none" />
      <path d="M3 14 C0 12 1 8 4 8" stroke="#e6c25a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ================= Settings UI ================= */

const ITEMS = [
  { key: 'tree', label: 'Tree / manger scene', scale: true },
  { key: 'snowman', label: 'Snowman', scale: true },
  { key: 'fireplace', label: 'Fireplace / shepherds', scale: true },
  { key: 'socks', label: 'Stocking garland', width: true, topY: true },
  { key: 'verse', label: 'Verse text', scale: true },
  { key: 'timer', label: 'Countdown timer', scale: true },
  { key: 'gear', label: 'Settings button' },
  { key: 'angels', label: 'Angels', scale: true, spacing: true },
  { key: 'sleigh', label: 'Sleigh / reindeer', scale: true, noSide: true, extraY: true },
];

function NumSlider({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="sp-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        className="sp-num"
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}

function SettingsPanel({ s, update, setTop, reset, vw, onClose, onAutoCut }) {
  const setCut = (i, k, v) => setTop('cuts', s.cuts.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <div className="settings-panel" data-hit>
      <div className="sp-head">
        <b>Overlay settings</b>
        <button className="sp-x" onClick={onClose} aria-label="Close settings">×</button>
      </div>
      <div className="sp-scroll">
        <section className="sp-sec">
          <div className="sp-title">View</div>
          <label className="sp-check">
            <input type="checkbox" checked={s.christmasDay} onChange={(e) => setTop('christmasDay', e.target.checked)} />
            Show the Christmas Day view
          </label>
          <AutostartToggle />
          <NumSlider label="Height" value={s.taskbarHeight} min={24} max={120} onChange={(v) => setTop('taskbarHeight', v)} />
          <div className="sp-hint">Height should match your taskbar height.</div>
        </section>

        {ITEMS.map((it) => {
          const v = s[it.key];
          return (
            <section className="sp-sec" key={it.key}>
              <div className="sp-title">{it.label}</div>

              {!it.noSide && (
                <div className="sp-seg">
                  {['left', 'right'].map((side) => (
                    <button key={side} className={v.side === side ? 'on' : ''} onClick={() => update(it.key, 'side', side)}>
                      From {side}
                    </button>
                  ))}
                </div>
              )}

              {!it.noSide && (
                <NumSlider label="X" value={v.x} min={0} max={vw} onChange={(n) => update(it.key, 'x', n)} />
              )}

              <NumSlider
                label={it.topY ? 'Y (top)' : 'Y'}
                value={v.y}
                min={it.extraY ? -20 : (it.topY ? 0 : -20)}
                max={it.extraY ? 60 : (it.topY ? 60 : 120)}
                onChange={(n) => update(it.key, 'y', n)}
              />

              {it.scale && (
                <NumSlider label="Size" value={v.scale} min={0.3} max={2.5} step={0.05} onChange={(n) => update(it.key, 'scale', n)} />
              )}

              {it.spacing && (
                <NumSlider label="Spacing" value={v.spacing ?? 0} min={-200} max={200} onChange={(n) => update(it.key, 'spacing', n)} />
              )}

              {it.key === 'angels' && (
                <label className="sp-check">
                  <input
                    type="checkbox"
                    checked={v.show !== false}
                    onChange={(e) => update('angels', 'show', e.target.checked)}
                  />
                  Show angels
                </label>
              )}

              {it.key === 'angels' && (
                <NumSlider label="Count" value={v.count ?? 4} min={3} max={5} onChange={(n) => update('angels', 'count', n)} />
              )}

              {it.key === 'sleigh' && (
                <label className="sp-check">
                  <input
                    type="checkbox"
                    checked={v.pauseOnCursor !== false}
                    onChange={(e) => update('sleigh', 'pauseOnCursor', e.target.checked)}
                  />
                  Pause when cursor is over the sleigh
                </label>
              )}

              {it.width && <NumSlider label="Width" value={v.width} min={60} max={700} onChange={(n) => update(it.key, 'width', n)} />}
            </section>
          );
        })}

        <section className="sp-sec">
          <div className="sp-title">Lights and garland cuts</div>
          <label className="sp-check">
            <input type="checkbox" checked={s.lights.show} onChange={(e) => update('lights', 'show', e.target.checked)} />
            Show the string lights
          </label>
          <NumSlider label="Gap" value={s.lights.spacing} min={10} max={60} onChange={(n) => update('lights', 'spacing', n)} />
          <NumSlider label="Sag" value={s.lights.sag} min={0} max={10} onChange={(n) => update('lights', 'sag', n)} />
          <div className="sp-hint">Cuts hide the lights and the stocking garland between two x positions (px from the left edge).</div>
          {s.cuts.map((c, i) => (
            <div className="sp-cut" key={i}>
              <span>From</span>
              <input type="number" value={c.from} onChange={(e) => setCut(i, 'from', Number(e.target.value) || 0)} />
              <span>to</span>
              <input type="number" value={c.to} onChange={(e) => setCut(i, 'to', Number(e.target.value) || 0)} />
              <button className="sp-x" onClick={() => setTop('cuts', s.cuts.filter((_, j) => j !== i))} aria-label="Remove cut">×</button>
            </div>
          ))}
          <div className="sp-btns">
            <button className="sp-btn" onClick={() => setTop('cuts', [...s.cuts, { from: 200, to: 300 }])}>Add cut</button>
            <button className="sp-btn alt" onClick={onAutoCut}>Cut around items</button>
            <button className="sp-btn alt" onClick={() => setTop('cuts', [])}>Clear cuts</button>
          </div>
        </section>

        <div className="sp-btns">
          <button className="sp-btn danger" onClick={reset}>Reset everything</button>
          <button className="sp-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SettingsWindow() {
  const { s, update, setTop, addCuts, reset } = useSettingsEditor();

  const autoCut = async () => {
    const un = await listen('autocut-result', (e) => {
      addCuts(e.payload);
      un();
    });
    await emit('autocut-request');
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#111816',
        color: '#f2efe6',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SettingsPanel
        s={s}
        update={update}
        setTop={setTop}
        reset={reset}
        vw={window.screen.width}
        onClose={() => getCurrentWindow().close()}
        onAutoCut={autoCut}
      />
    </div>
  );
}

/* ================= Overlay ================= */

function Overlay() {
  const s = useSettingsReader();
  const vw = useVw();
  const cd = useCountdown();
  const [panelOpen, setPanelOpen] = useState(false);

  const snowmanRef = useRef(null);
  const snowmanHover = useCursorInRect(snowmanRef, 6, true);

  // trackRef: wrapper that owns the animations (we pause them through it).
  // plowRef: the moving element whose on-screen rect we test the cursor against.
  const sleighTrackRef = useRef(null);
  const sleighPlowRef = useRef(null);
  const pauseEnabled = s.sleigh?.pauseOnCursor !== false;
  const cursorOnSleigh = useCursorInRect(sleighPlowRef, 10, pauseEnabled);
  const sleighPaused = pauseEnabled && cursorOnSleigh;
  usePauseAnimations(sleighTrackRef, sleighPaused);

  useClickThrough();
  useWindowFit(s.taskbarHeight);
  useStartupPrompt();

  useEffect(() => {
    const subs = [
      listen('settings-visible', (e) => setPanelOpen(!!e.payload)),
      listen('autocut-request', () => {
        const found = [];
        document
          .querySelectorAll('.tree-container, .snowman-container, .fireplace-container, .verse, .timer')
          .forEach((el) => {
            const r = el.getBoundingClientRect();
            found.push({ from: Math.max(0, Math.floor(r.left - 4)), to: Math.ceil(r.right + 4) });
          });
        emit('autocut-result', found);
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  const inSeason = isSeasonActive();
  const xmas = s.christmasDay || cd.isDay;
  const H = s.taskbarHeight;
  const u = H / 48;
  const MW = Math.round(H * 0.7 * (112 / 34));
  const fit = H - 2;
  const place = (it, w, h) => ({ height: h, width: w, bottom: it.y, [it.side]: it.x });
  const th = fit * s.tree.scale;
  const sh = fit * s.snowman.scale;
  const fh = fit * s.fireplace.scale;

  const treeStyle = place(s.tree, (th * 140) / 190, th);
  const mangerStyle = place(s.tree, (th * 180) / 140, th);
  const snowmanStyle = place(s.snowman, (sh * 60) / 100, sh);
  const fireStyle = place(s.fireplace, (fh * 150) / 130, fh);
  const shepStyle = place(s.fireplace, (fh * 340) / 120, fh);

  // Sleigh: scale adjusts both MW and height; x/y are pixel offsets from the track
  const sleighScale = s.sleigh?.scale ?? 1;
  const sleighX = s.sleigh?.x ?? 0;
  const sleighY = s.sleigh?.y ?? 0;
  const sleighW = Math.round(MW * sleighScale);
  const sleighH = Math.round((sleighW * 34) / 112);

  const hud = (it) => ({ bottom: it.y, [it.side]: it.x, '--u': u * it.scale });

  if (!inSeason) return null;

  return (
    <div
      className="root"
      style={{
        '--H': `${H}px`,
        '--u': u,
        '--mw': `${MW}px`,
        '--plow': `${CONFIG.plow.seconds}s`,
        '--sleigh-w': `${sleighW}px`,
        '--sleigh-h': `${sleighH}px`,
        '--sleigh-x': `${sleighX}px`,
        '--sleigh-y': `${sleighY}px`,
        '--sleigh-play': sleighPaused ? 'paused' : 'running',
      }}
    >
      <div className="world">

        {xmas && <div className="starry-sky" style={getSkyMask(s.cuts)} />}
        {xmas && s.angels.show !== false && (
          <Angels count={s.angels.count} H={H} cfg={s.angels} />
        )}

        {xmas ? (
          <div className="tree-container" style={mangerStyle}>
            <MangerScene />
          </div>
        ) : (
          <div className="tree-container" style={treeStyle}>
            <svg viewBox={`0 0 ${TW} ${TH}`} width="100%" height="100%">
              <defs>
                <linearGradient id="trunk" x1="0" x2="1">
                  <stop offset="0" stopColor="#2a170b" /><stop offset="0.5" stopColor="#5a3820" /><stop offset="1" stopColor="#24130a" />
                </linearGradient>
                <linearGradient id="tierFill" x1="0" x2="1">
                  <stop offset="0" stopColor="#06260f" />
                  <stop offset="0.5" stopColor="#10401f" />
                  <stop offset="0.85" stopColor="#1a5a2b" />
                  <stop offset="1" stopColor="#4a6a2a" />
                </linearGradient>
                <linearGradient id="tierShade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#000" stopOpacity="0" />
                  <stop offset="0.65" stopColor="#000" stopOpacity="0.1" />
                  <stop offset="1" stopColor="#000" stopOpacity="0.6" />
                </linearGradient>
                <linearGradient id="fireSide" x1="0" x2="1">
                  <stop offset="0.5" stopColor="#ff8a3a" stopOpacity="0" />
                  <stop offset="1" stopColor="#ff8a3a" stopOpacity="0.28" />
                </linearGradient>
                <linearGradient id="starFill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff8c4" /><stop offset="0.5" stopColor="#f5b823" /><stop offset="1" stopColor="#b06f00" />
                </linearGradient>
                <radialGradient id="starGlow">
                  <stop offset="0" stopColor="#ffd34d" stopOpacity="0.7" />
                  <stop offset="1" stopColor="#ffb300" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="skirt" cx="0.5" cy="0.4" r="0.7">
                  <stop offset="0" stopColor="#d12b34" /><stop offset="1" stopColor="#6e0e14" />
                </radialGradient>
                {PALETTE.map((p, i) => (
                  <radialGradient key={`og${i}`} id={`og-${i}`} cx="0.35" cy="0.3" r="0.8">
                    <stop offset="0" stopColor={p.l} /><stop offset="0.45" stopColor={p.c} /><stop offset="1" stopColor={p.d} />
                  </radialGradient>
                ))}
                {LIGHT_COLORS.map((p, i) => (
                  <radialGradient key={`tl${i}`} id={`tl-${i}`}>
                    <stop offset="0" stopColor={p.c} stopOpacity="0.8" />
                    <stop offset="1" stopColor={p.c} stopOpacity="0" />
                  </radialGradient>
                ))}
              </defs>

              <rect x="63" y="158" width="14" height="26" fill="url(#trunk)" />

              {tree.tiers.map((t, ti) => (
                <g key={ti}>
                  <path d={t.path} fill="url(#tierFill)" />
                  {t.groups.map((d, gi) => (
                    <path key={gi} d={d} stroke={NEEDLE_COLORS[gi]} strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  ))}
                  <path d={t.path} fill="url(#tierShade)" />
                  <path d={t.path} fill="url(#fireSide)" />
                </g>
              ))}

              {tree.lights.map((l, i) => (
                <g key={i} className="tl" style={{ '--d': `${l.delay}s` }}>
                  <circle className="tl-glow" cx={l.x} cy={l.y} r="6" fill={`url(#tl-${l.ci})`} />
                  <circle cx={l.x} cy={l.y} r="1.5" fill={LIGHT_COLORS[l.ci].l} />
                  <circle cx={l.x} cy={l.y} r="0.7" fill="#fff" />
                </g>
              ))}

              {tree.ornaments.map((o, i) => (
                <g key={i}>
                  <rect x={o.x - 1.1} y={o.y - 5.6} width="2.2" height="2" rx="0.5" fill="#c9a24a" />
                  <circle cx={o.x} cy={o.y} r="3.8" fill={`url(#og-${o.i})`} />
                  <ellipse cx={o.x - 1.3} cy={o.y - 1.4} rx="1" ry="0.7" fill="#fff" opacity="0.9" />
                </g>
              ))}

              <ellipse cx={CX} cy="180" rx="63" ry="8" fill="url(#skirt)" />
              <ellipse cx={CX} cy="177.5" rx="60" ry="5.5" fill="#fff" opacity="0.08" />
              <g transform="rotate(-6 24 176)">
                <rect x="14" y="168" width="20" height="16" fill="#2f63c9" />
                <rect x="14" y="168" width="20" height="3" fill="#fff" opacity="0.2" />
                <rect x="22" y="168" width="4" height="16" fill="#e9eef5" />
                <rect x="14" y="174" width="20" height="3.6" fill="#e9eef5" />
                <path d="M24 168 C19 162 15 166 24 168 C33 166 29 162 24 168Z" fill="#e9eef5" />
              </g>
              <g transform="rotate(5 114 176)">
                <rect x="104" y="166" width="20" height="18" fill="#c8a032" />
                <rect x="104" y="166" width="20" height="3" fill="#fff" opacity="0.25" />
                <rect x="112" y="166" width="4" height="18" fill="#c22a30" />
                <rect x="104" y="173" width="20" height="3.6" fill="#c22a30" />
                <path d="M114 166 C109 160 105 164 114 166 C123 164 119 160 114 166Z" fill="#c22a30" />
              </g>

              <circle className="star-glow" cx={CX} cy="24" r="22" fill="url(#starGlow)" />
              <polygon points={tree.star} fill="url(#starFill)" stroke="#ffe6a0" strokeWidth="0.5" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {xmas ? (
          <div className="fireplace-container" style={shepStyle}>
            <Shepherds />
          </div>
        ) : (
          <div className="fireplace-container" style={fireStyle}>
            <div className="fire-glow" />
            <svg viewBox="0 0 150 130" width="100%" height="100%">
              <defs>
                <pattern id="bricks" width="36" height="16" patternUnits="userSpaceOnUse">
                  <rect width="36" height="16" fill="#a79a8d" />
                  <rect x="1" y="1" width="16" height="6" fill="#8a4838" />
                  <rect x="19" y="1" width="16" height="6" fill="#7a3f31" />
                  <rect x="-8" y="9" width="16" height="6" fill="#7e4132" />
                  <rect x="10" y="9" width="16" height="6" fill="#944e3c" />
                  <rect x="28" y="9" width="16" height="6" fill="#85463a" />
                </pattern>
                <filter id="grain" x="0" y="0" width="100%" height="100%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="t" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8a5a34" /><stop offset="0.2" stopColor="#6b4125" /><stop offset="1" stopColor="#3b2213" />
                </linearGradient>
                <linearGradient id="bark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#5d3b22" /><stop offset="0.5" stopColor="#3a2312" /><stop offset="1" stopColor="#1e1109" />
                </linearGradient>
                <radialGradient id="boxGlow" cx="0.5" cy="1" r="0.95">
                  <stop offset="0" stopColor="#ff8a2a" stopOpacity="0.85" />
                  <stop offset="0.5" stopColor="#b8330a" stopOpacity="0.4" />
                  <stop offset="1" stopColor="#0f0706" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="coals">
                  <stop offset="0" stopColor="#ffb347" /><stop offset="0.45" stopColor="#d4400d" /><stop offset="1" stopColor="#6a1403" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="brickGlow" cx="75" cy="105" r="85" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#ff8a3a" stopOpacity="0.5" />
                  <stop offset="1" stopColor="#ff8a3a" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="fOuter" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#d9260a" /><stop offset="1" stopColor="#ff7a12" />
                </linearGradient>
                <linearGradient id="fMid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff8f1a" /><stop offset="1" stopColor="#ffc43f" />
                </linearGradient>
                <linearGradient id="fInner" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffc93d" /><stop offset="1" stopColor="#fff0a6" />
                </linearGradient>
                <filter id="flameFx" x="-30%" y="-30%" width="160%" height="160%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves="2" seed="3" result="n">
                    <animate attributeName="baseFrequency" dur="1.8s" repeatCount="indefinite"
                      values="0.035 0.09;0.045 0.13;0.035 0.09" />
                  </feTurbulence>
                  <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" />
                  <feGaussianBlur stdDeviation="0.7" />
                </filter>
                <clipPath id="boxClip">
                  <path d="M36 122 V62 Q36 40 75 40 Q114 40 114 62 V122 Z" />
                </clipPath>
                <path id="tongueC" d="M62 114 C56 100 66 92 70 80 C72 72 74 66 75 54 C78 68 86 76 86 90 C88 98 92 106 88 114 Z" />
                <path id="tongueL" d="M46 114 C42 104 50 98 53 88 C57 95 60 99 64 106 C66 110 66 112 66 114 Z" />
                <path id="tongueR" d="M84 114 C84 108 90 102 93 92 C98 99 102 108 101 114 Z" />
              </defs>

              <rect x="6" y="20" width="138" height="104" fill="url(#bricks)" />
              <rect x="6" y="20" width="138" height="104" filter="url(#grain)" opacity="0.3" style={{ mixBlendMode: 'multiply' }} />
              <rect className="brick-glow" x="6" y="20" width="138" height="104" fill="url(#brickGlow)" />

              <rect x="1" y="14" width="148" height="9" rx="2" fill="url(#wood)" />
              <rect x="1" y="14" width="148" height="1.6" rx="0.8" fill="#c08a58" opacity="0.7" />
              <rect x="5" y="23" width="140" height="4" fill="#4a2c17" />
              <rect x="5" y="27" width="140" height="3" fill="#000" opacity="0.28" />

              <path d="M36 124 V62 Q36 40 75 40 Q114 40 114 62 V124 Z" fill="#0d0605" stroke="#3e3631" strokeWidth="6" strokeLinejoin="round" />
              <path d="M33 124 V62 Q33 37 75 37 Q117 37 117 62 V124" fill="none" stroke="#6a5c52" strokeWidth="0.8" opacity="0.7" />
              <g clipPath="url(#boxClip)">
                <rect x="30" y="36" width="90" height="90" fill="url(#boxGlow)" className="box-glow" />
                <ellipse className="coals" cx="75" cy="117" rx="36" ry="7" fill="url(#coals)" />
                <g transform="rotate(-9 75 111)">
                  <rect x="44" y="106" width="62" height="10" rx="5" fill="url(#bark)" />
                  <path d="M48 109 H100 M50 113 H98" stroke="#000" strokeOpacity="0.45" strokeWidth="0.6" />
                </g>
                <g filter="url(#flameFx)">
                  <FlameLayer scale={1} fill="url(#fOuter)" cls="f1" />
                  <FlameLayer scale={0.74} fill="url(#fMid)" cls="f2" />
                  <FlameLayer scale={0.48} fill="url(#fInner)" cls="f3" />
                  <FlameLayer scale={0.26} fill="#fff8d6" cls="f4" />
                </g>
                <g transform="rotate(8 75 113)">
                  <rect x="44" y="108" width="62" height="10" rx="5" fill="url(#bark)" />
                  <path d="M48 111 H100 M50 115 H98" stroke="#000" strokeOpacity="0.45" strokeWidth="0.6" />
                  <rect x="44" y="114" width="62" height="4" rx="2" fill="#ff6a1a" opacity="0.35" className="coals" />
                </g>
                {[
                  { x: 66, dx: -8, t: 2.4, d: 0 }, { x: 82, dx: 10, t: 3.1, d: -1.2 },
                  { x: 74, dx: 3, t: 2.8, d: -0.6 }, { x: 90, dx: -4, t: 3.6, d: -2 },
                  { x: 60, dx: 6, t: 3.3, d: -1.7 },
                ].map((sp, i) => (
                  <circle key={i} className="spark" cx={sp.x} cy="100" r="0.9" fill="#ffd27a"
                    style={{ '--dx': `${sp.dx}px`, animationDuration: `${sp.t}s`, animationDelay: `${sp.d}s` }} />
                ))}
              </g>

              <rect x="22" y="121" width="106" height="8" rx="1.5" fill="#6d6761" />
              <rect x="22" y="121" width="106" height="2" fill="#a39b93" />
              <rect x="22" y="127" width="106" height="2" fill="#000" opacity="0.35" />

              <Stocking x={12} body="#c4222d" trim="#f2efe6" />
              <Stocking x={138} body="#1f7a3a" trim="#d8b04a" flip />
            </svg>
          </div>
        )}

        {s.lights.show && (
          <div className="mini-lights-wrap">
            <LightString spacing={s.lights.spacing} sag={s.lights.sag} cuts={s.cuts} vw={vw} />
          </div>
        )}

        {!xmas && <SockGarland cfg={s.socks} cuts={s.cuts} vw={vw} />}

        <div
          ref={snowmanRef}
          className={`snowman-container${snowmanHover ? ' warm' : ''}`}
          style={snowmanStyle}
        >
          <Snowman />
        </div>

        <div className="verse" style={hud(s.verse)}>
          <svg className="verse-cross" viewBox="0 0 10 14">
            <defs>
              <linearGradient id="crossG" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fff4c2" /><stop offset="1" stopColor="#e0a526" />
              </linearGradient>
            </defs>
            <rect x="4" y="0" width="2" height="14" rx="0.6" fill="url(#crossG)" />
            <rect x="0.6" y="3.8" width="8.8" height="2" rx="0.6" fill="url(#crossG)" />
          </svg>
          <span>{xmas ? 'Born is the King of Israel' : 'Jesus is the reason for the season'}</span>
        </div>

        <div className="timer" style={hud(s.timer)}>
          {xmas ? (
            <div className="t-digits">Merry Christmas!</div>
          ) : (
            <>
              <div className="t-label">Christmas in</div>
              <div className="t-digits">
                {cd.d}<i>d</i>{pad(cd.h)}<i>h</i>{pad(cd.m)}<i>m</i>{pad(cd.s)}<i>s</i>
              </div>
            </>
          )}
        </div>

        {panelOpen && s.cuts.map((c, i) => (
          <div key={i} className="cut-guide" style={{ left: c.from, width: Math.max(0, c.to - c.from) }} />
        ))}

        <div className="snow">
          {FLAKES.map((f, i) => (
            <div
              key={i}
              className="flake"
              style={{
                left: `${f.left}%`, width: f.size, height: f.size,
                animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s`,
                '--dx': `${f.drift}px`, '--o': f.op,
              }}
            />
          ))}
        </div>
        <svg className="ground" viewBox="0 0 600 8" preserveAspectRatio="none">
          <defs>
            <linearGradient id="snowG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#cfdff0" />
            </linearGradient>
          </defs>
          <path d={GROUND} fill="url(#snowG)" />
        </svg>

        {!xmas && (
          <div
            ref={sleighTrackRef}
            className="plow-track"
            style={{ bottom: `${sleighY}px` }}
          >
            <div ref={sleighPlowRef} className="plow" style={{ marginLeft: `${sleighX}px` }}>
              <SleighTeam />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= Angels ================= */

const ANGELS = (() => {
  const r = rng(77);
  return Array.from({ length: 5 }, () => ({
    jit: (r() - 0.5) * 0.07,
    s: 0.85 + r() * 0.3,
    t: r(),
    flap: 0.55 + r() * 0.3,
    fd: -r(),
    float: 3.4 + r() * 2,
    fld: -r() * 4,
    glow: 1.8 + r() * 1.2,
    gd: -r() * 2,
  }));
})();

function WingShape({ id }) {
  return (
    <>
      <path
        d="M17 24 C12 24 5 18 3 6 C5 8 7 9 9 9 C8 11 10 13 12 14 C11 16 13 18 15 19 C14.5 21 15.5 22.5 17 23 Z"
        fill={`url(#awing-${id})`} stroke="#9cc4f0" strokeWidth="0.4" strokeLinejoin="round"
      />
      <path d="M15 22 C11 19 7 14 5 9 M15.5 19.5 C12 17 10 14 8.5 11.5" stroke="#9cc4f0" strokeWidth="0.4" fill="none" />
    </>
  );
}

function Angel({ id, h, a }) {
  const w = (h * 40) / 44;
  return (
    <svg width={w} height={h} viewBox="0 0 40 44" overflow="visible"
         style={{ '--fs': `${a.flap}s`, '--fd': `${a.fd}s` }}>
      <defs>
        <radialGradient id={`aaura-${id}`}>
          <stop offset="0" stopColor="#fff2a8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd34d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`awing-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#bcdcff" />
        </linearGradient>
        <linearGradient id={`arobe-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d9e6f7" />
        </linearGradient>
      </defs>

      <circle className="ang-aura" cx="20" cy="22" r="21" fill={`url(#aaura-${id})`} />
      <g className="wing"><WingShape id={id} /></g>
      <g transform="translate(40 0) scale(-1 1)"><g className="wing"><WingShape id={id} /></g></g>

      <path d="M16.5 22 C15 28 12 34 11 41 Q20 44 29 41 C28 34 25 28 23.5 22 Z" fill={`url(#arobe-${id})`} />
      <ellipse cx="17" cy="26" rx="2" ry="3.2" fill="#fff" />
      <ellipse cx="23" cy="26" rx="2" ry="3.2" fill="#fff" />
      <circle cx="20" cy="28" r="1.2" fill="#fde3c8" />

      <circle cx="20" cy="16" r="4" fill="#fde3c8" />
      <path d="M16 15.5 C15.5 10.5 24.5 10.5 24 15.5 C23 13 17 13 16 15.5Z" fill="#f2c14e" />
      <path d="M18.2 16.4 q.8.6 1.6 0 M20.8 16.4 q.8.6 1.6 0 M19.2 18.2 q.8.5 1.6 0"
            stroke="#7a4a2a" strokeWidth="0.4" fill="none" strokeLinecap="round" />
      <circle cx="17.6" cy="17.8" r="0.8" fill="#ff9aa8" opacity="0.4" />
      <circle cx="22.4" cy="17.8" r="0.8" fill="#ff9aa8" opacity="0.4" />

      <ellipse className="halo" cx="20" cy="9.8" rx="5.4" ry="1.5" fill="none" stroke="#ffe27a" strokeWidth="1.3" />
      <path className="ang-spark" d="M35 10 l.7 1.8 1.8.7 -1.8.7 -.7 1.8 -.7-1.8 -1.8-.7 1.8-.7z" fill="#fff6c2" />
      <path className="ang-spark" style={{ animationDelay: '-0.8s' }} d="M4 30 l.6 1.5 1.5.6 -1.5.6 -.6 1.5 -.6-1.5 -1.5-.6 1.5-.6z" fill="#fff6c2" />
    </svg>
  );
}

function Angels({ count = 4, H, cfg }) {
  const n = Math.max(3, Math.min(5, cfg?.count ?? count));
  const spacing = cfg?.spacing ?? 0;
  return (
    <div
      className="angels"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '100%',
        pointerEvents: 'none',
        transform: `translateX(${cfg?.x ?? 0}px)`,
      }}
    >
      {ANGELS.slice(0, n).map((a, i) => {
        const h = H * 0.72 * a.s * (cfg?.scale ?? 1);
        const base = ((i + 0.5) / n) * 100;
        const offset = ((i - (n - 1) / 2) * spacing) / (window.innerWidth || 1) * 100;
        return (
          <div
            key={i}
            className="angel"
            style={{
              left: `${base + offset + a.jit * 100 / n}%`,
              top: (cfg?.y ?? 0) + a.t * Math.max(0, H - h - 6) + 1,
              '--fl': `${a.float}s`, '--fld': `${a.fld}s`,
              '--gl': `${a.glow}s`, '--gd': `${a.gd}s`,
            }}
          >
            <Angel id={i} h={h} a={a} />
          </div>
        );
      })}
    </div>
  );
}

/* ================= Entry ================= */

export default function App() {
  return getCurrentWindow().label === 'settings' ? <SettingsWindow /> : <Overlay />;
}