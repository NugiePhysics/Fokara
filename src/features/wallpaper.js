// Wallpaper halaman Focus: preset live (CSS/canvas), gambar/GIF, atau video upload sendiri.
import { load, save, on, uid } from '../store.js';
import { dbAll, dbGet, dbPut, dbDelete } from '../db.js';
import { icon, esc, openModal, toast } from '../ui.js';
import { fmtBytes } from '../utils/time.js';
import { t } from '../i18n.js';

const PRESETS = {
  aurora: t('Aurora'),
  rain: t('Night rain'),
  stars: t('Stars'),
  dusk: t('Dusk'),
};
const DEFAULTS = { active: 'none', dim: 0.3, blur: 0 };
const MAX_SIZE = 300 * 1024 ** 2;

export const getWallpaper = () => ({ ...DEFAULTS, ...load('wallpaper', {}) });

let layer;
let onFocus = false;
let mounted = null; // { key, cleanup }
let applyToken = 0;

function setWallpaper(patch) {
  save('wallpaper', { ...getWallpaper(), ...patch });
  apply();
}

function applyVars({ dim, blur }) {
  const root = document.documentElement.style;
  root.setProperty('--wp-dim', dim);
  root.setProperty('--wp-blur', `${blur}px`);
}

function setActive(on) {
  if (on) document.documentElement.dataset.wallpaper = 'on';
  else delete document.documentElement.dataset.wallpaper;
}

function unmount() {
  mounted?.cleanup();
  mounted = null;
  layer.replaceChildren();
}

async function apply() {
  const wp = getWallpaper();
  applyVars(wp);
  const want = onFocus && wp.active !== 'none' ? wp.active : null;
  if (mounted?.key === want) return setActive(!!want);
  const token = ++applyToken;
  unmount();
  if (!want) return setActive(false);

  const stage = document.createElement('div');
  stage.className = 'wp-stage';
  let cleanup = () => {};
  if (want.startsWith('preset:')) {
    cleanup = mountPreset(stage, want.slice(7));
  } else {
    const rec = await dbGet('wallpapers', want);
    if (token !== applyToken) return;
    if (!rec) return setWallpaper({ active: 'none' });
    const url = URL.createObjectURL(rec.blob);
    stage.append(mediaEl(rec, url, true));
    cleanup = () => URL.revokeObjectURL(url);
  }
  layer.replaceChildren(stage);
  mounted = { key: want, cleanup };
  setActive(true);
}

function mediaEl(rec, url, live) {
  if (rec.type === 'video') {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = live;
    v.preload = live ? 'auto' : 'metadata';
    if (live) v.play().catch(() => {});
    return v;
  }
  const img = new Image();
  img.alt = '';
  img.src = url;
  return img;
}

// ---------------------------------------------------------------- Preset live

function mountPreset(stage, key) {
  if (key === 'aurora') {
    stage.innerHTML = '<div class="wp-aurora"><i></i><i></i><i></i></div>';
    return () => {};
  }
  if (key === 'dusk') {
    stage.innerHTML = '<div class="wp-dusk"></div>';
    return () => {};
  }
  if (key === 'rain') return canvasPreset(stage, rainSetup, rainDraw);
  if (key === 'stars') return canvasPreset(stage, starsSetup, starsDraw);
  return () => {};
}

function canvasPreset(stage, setup, draw) {
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h, state, raf;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = setup(ctx, w, h);
    if (reduce) draw(ctx, w, h, state, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    draw(ctx, w, h, state, dt, t / 1000);
    raf = requestAnimationFrame(loop);
  };
  if (!reduce) raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}

const rand = (a, b) => a + Math.random() * (b - a);

function rainSetup(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0a1020');
  bg.addColorStop(1, '#1c2a44');
  const drops = Array.from({ length: Math.round((w * h) / 7000) }, () => ({
    x: rand(0, w), y: rand(0, h), len: rand(10, 24), speed: rand(500, 900), a: rand(0.15, 0.45),
  }));
  const lights = Array.from({ length: 14 }, () => ({
    x: rand(0, w), y: rand(h * 0.45, h), r: rand(30, 90), hue: rand(20, 220), phase: rand(0, 6),
  }));
  return { bg, drops, lights, splashes: [] };
}

function rainDraw(ctx, w, h, s, dt, t) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, w, h);
  for (const l of s.lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    const a = 0.08 + 0.04 * Math.sin(t * 0.6 + l.phase);
    g.addColorStop(0, `hsla(${l.hue}, 80%, 65%, ${a})`);
    g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (const d of s.drops) {
    d.y += d.speed * dt;
    d.x -= d.speed * dt * 0.12;
    if (d.y > h) {
      if (Math.random() < 0.3) s.splashes.push({ x: d.x, y: h - rand(0, 40), r: 0, a: 0.35 });
      d.y = -d.len;
      d.x = rand(0, w * 1.1);
    }
    ctx.strokeStyle = `rgba(180, 205, 255, ${d.a})`;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x + d.len * 0.12, d.y - d.len);
    ctx.stroke();
  }
  s.splashes = s.splashes.filter((p) => p.a > 0.01);
  for (const p of s.splashes) {
    p.r += 30 * dt;
    p.a -= 0.8 * dt;
    ctx.strokeStyle = `rgba(180, 205, 255, ${Math.max(0, p.a)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function starsSetup(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, w * 0.3, h);
  bg.addColorStop(0, '#050816');
  bg.addColorStop(0.6, '#111338');
  bg.addColorStop(1, '#2a1846');
  const stars = Array.from({ length: Math.round((w * h) / 2500) }, () => ({
    x: rand(0, w), y: rand(0, h), r: rand(0.3, 1.5), phase: rand(0, 6.3), speed: rand(0.5, 2),
  }));
  return { bg, stars, shoot: null };
}

function starsDraw(ctx, w, h, s, dt, t) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, w, h);
  for (const st of s.stars) {
    st.x += dt * 3 * st.r;
    if (st.x > w) st.x = 0;
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.speed + st.phase));
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!s.shoot && Math.random() < dt * 0.15) s.shoot = { x: rand(w * 0.2, w), y: rand(0, h * 0.4), life: 1 };
  if (s.shoot) {
    const p = s.shoot;
    p.x -= 600 * dt;
    p.y += 250 * dt;
    p.life -= dt * 1.2;
    const g = ctx.createLinearGradient(p.x, p.y, p.x + 120, p.y - 50);
    g.addColorStop(0, `rgba(255, 255, 255, ${Math.max(0, p.life)})`);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 120, p.y - 50);
    ctx.stroke();
    if (p.life <= 0) s.shoot = null;
  }
}

// ---------------------------------------------------------------- Picker

export async function openWallpaperPicker() {
  let urls = [];
  const releaseUrls = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  };
  const wrap = document.createElement('div');
  wrap.className = 'wp-picker';
  const modal = openModal({ title: t('Study wallpaper'), content: wrap, wide: true, onClose: releaseUrls });

  const draw = async () => {
    const items = (await dbAll('wallpapers')).sort((a, b) => b.addedAt - a.addedAt);
    const wp = getWallpaper();
    releaseUrls();
    wrap.innerHTML = `
      <p class="muted small">${t('Shown on the Focus page. Upload an image, GIF, or video (MP4/WebM) for a live wallpaper.')}</p>
      <div class="wp-grid">
        <button class="wp-tile ${wp.active === 'none' ? 'active' : ''}" data-wp="none">
          <div class="wp-thumb wp-thumb-none">${icon('x', 20)}</div><span>${t('No wallpaper')}</span>
        </button>
        ${Object.entries(PRESETS)
          .map(
            ([k, label]) => `<button class="wp-tile ${wp.active === `preset:${k}` ? 'active' : ''}" data-wp="preset:${k}">
              <div class="wp-thumb wp-prev-${k}"><em class="wp-badge">Live</em></div><span>${label}</span></button>`,
          )
          .join('')}
        ${items
          .map(
            (it) => `<div class="wp-tile-wrap">
              <button class="wp-tile ${wp.active === it.id ? 'active' : ''}" data-wp="${it.id}" title="${esc(it.name)} · ${fmtBytes(it.size)}">
                <div class="wp-thumb" data-media="${it.id}">${it.type === 'video' ? '<em class="wp-badge">Live</em>' : ''}</div>
                <span>${esc(it.name)}</span>
              </button>
              <button class="icon-btn sm wp-del" data-wp-del="${it.id}" aria-label="${t('Delete wallpaper')}">${icon('trash', 14)}</button>
            </div>`,
          )
          .join('')}
        <label class="wp-tile wp-upload">
          <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden data-wp-upload />
          <div class="wp-thumb wp-thumb-none">${icon('upload', 20)}</div><span>${t('Upload')}</span>
        </label>
      </div>
      <div class="wp-sliders">
        <label class="slider-row"><span>${t('Dim')}</span><input type="range" min="0" max="0.85" step="0.05" value="${wp.dim}" data-wp-dim /></label>
        <label class="slider-row"><span>${t('Blur')}</span><input type="range" min="0" max="24" step="1" value="${wp.blur}" data-wp-blur /></label>
      </div>`;
    for (const it of items) {
      const box = wrap.querySelector(`[data-media="${it.id}"]`);
      const url = URL.createObjectURL(it.blob);
      urls.push(url);
      box.prepend(mediaEl(it, url, false));
    }
  };

  wrap.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-wp-del]');
    if (del) {
      const id = del.dataset.wpDel;
      await dbDelete('wallpapers', id);
      if (getWallpaper().active === id) setWallpaper({ active: 'none' });
      toast(t('Wallpaper deleted'));
      return draw();
    }
    const tile = e.target.closest('[data-wp]');
    if (tile) {
      setWallpaper({ active: tile.dataset.wp });
      wrap.querySelectorAll('[data-wp]').forEach((b) => b.classList.toggle('active', b === tile));
    }
  });
  wrap.addEventListener('input', (e) => {
    const wp = getWallpaper();
    if (e.target.matches('[data-wp-dim]')) applyVars({ ...wp, dim: Number(e.target.value) });
    if (e.target.matches('[data-wp-blur]')) applyVars({ ...wp, blur: Number(e.target.value) });
  });
  wrap.addEventListener('change', async (e) => {
    if (e.target.matches('[data-wp-dim]')) setWallpaper({ dim: Number(e.target.value) });
    if (e.target.matches('[data-wp-blur]')) setWallpaper({ blur: Number(e.target.value) });
    if (e.target.matches('[data-wp-upload]')) {
      const files = [...e.target.files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (!files.length) return toast(t('Choose an image or video file'), { type: 'error' });
      let lastId = null;
      for (const f of files) {
        if (f.size > MAX_SIZE) {
          toast(t('{name} is too large (max {max})', { name: f.name, max: fmtBytes(MAX_SIZE) }), { type: 'error' });
          continue;
        }
        try {
          lastId = uid();
          await dbPut('wallpapers', {
            id: lastId,
            name: f.name.replace(/\.[^.]+$/, ''),
            type: f.type.startsWith('video/') ? 'video' : 'image',
            size: f.size,
            addedAt: Date.now(),
            blob: f,
          });
        } catch {
          lastId = null;
          toast(t('Failed to save {name}', { name: f.name }), { type: 'error' });
        }
      }
      if (lastId) {
        setWallpaper({ active: lastId });
        toast(t('Wallpaper added'));
      }
      draw();
    }
  });

  await draw();
  return modal;
}

export function initWallpaper() {
  layer = document.getElementById('wallpaper');
  applyVars(getWallpaper());
  on('route', (route) => {
    onFocus = route === 'focus';
    apply();
  });
}
