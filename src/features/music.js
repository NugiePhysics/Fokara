// Musik belajar: upload MP3, suara ambient (Web Audio), dan YouTube.
// Mini player global yang otomatis mengikuti timer pomodoro.
import { load, save, on, uid } from '../store.js';
import { dbAll, dbPut, dbDelete } from '../db.js';
import { audioCtx } from '../utils/sound.js';
import { icon, esc, toast } from '../ui.js';
import { getTimer } from './pomodoro.js';

const DEFAULTS = {
  source: 'ambient',
  volume: 0.6,
  autoPlay: true,
  onBreak: 'duck', // duck | pause | keep
  shuffle: false,
  ambient: { rain: 0.6, ocean: 0, white: 0, pink: 0, brown: 0.2 },
};
const stored = load('music', {});
const settings = { ...DEFAULTS, ...stored, ambient: { ...DEFAULTS.ambient, ...stored.ambient } };
const persist = () => save('music', settings);

// Daftar link YouTube tersimpan (video, live, atau playlist).
const DEFAULT_YT = { id: 'lofi-girl', name: 'Lofi Girl · beats to relax/study to', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' };
if (!Array.isArray(settings.ytSaved)) {
  settings.ytSaved = [DEFAULT_YT];
  if (stored.ytUrl && stored.ytUrl !== DEFAULT_YT.url) settings.ytSaved.unshift({ id: uid(), name: 'YouTube', url: stored.ytUrl, autoName: true });
  settings.ytActive = settings.ytSaved[0].id;
}
delete settings.ytUrl;
const activeYt = () => settings.ytSaved.find((x) => x.id === settings.ytActive) || settings.ytSaved[0] || null;

let playing = false;
let duck = 1; // pengali volume saat istirahat
let root;

const outVolume = () => settings.volume * duck;

// ---------------------------------------------------------------- Upload

const audio = new Audio();
audio.preload = 'auto';
let tracks = [];
let trackIndex = 0;
let trackUrl = null;

async function loadTracks() {
  tracks = (await dbAll('tracks')).sort((a, b) => a.addedAt - b.addedAt);
  trackIndex = Math.min(trackIndex, Math.max(0, tracks.length - 1));
  renderTracks();
}

function setTrack(i) {
  if (!tracks.length) return;
  trackIndex = (i + tracks.length) % tracks.length;
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = URL.createObjectURL(tracks[trackIndex].blob);
  audio.src = trackUrl;
  renderTracks();
  renderStatus();
}

function nextTrack(dir = 1) {
  if (!tracks.length) return;
  const i = settings.shuffle && tracks.length > 1 ? (trackIndex + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length : trackIndex + dir;
  setTrack(i);
  if (playing) audio.play().catch(() => {});
}

audio.addEventListener('ended', () => nextTrack(1));

const uploadSource = {
  async play({ auto = false } = {}) {
    if (!tracks.length) {
      // Autoplay dari timer tidak boleh memunculkan panel; hanya saat diklik pengguna.
      if (!auto) {
        toast('Upload file musik terlebih dahulu');
        openPanel();
      }
      return false;
    }
    if (!audio.src) setTrack(trackIndex);
    audio.volume = outVolume();
    await audio.play();
    return true;
  },
  pause: () => audio.pause(),
  setVolume: (v) => (audio.volume = v),
};

// ---------------------------------------------------------------- Ambient

const CHANNELS = {
  rain: { label: 'Hujan', scale: 0.9 },
  ocean: { label: 'Ombak', scale: 1 },
  white: { label: 'White noise', scale: 0.18 },
  pink: { label: 'Pink noise', scale: 0.45 },
  brown: { label: 'Brown noise', scale: 0.9 },
};
let buffers = null;
let ambient = null;

function makeNoise(c, kind) {
  const len = c.sampleRate * 6;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        // Pink noise (Paul Kellet)
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // Crossfade ujung buffer agar loop tidak terdengar "klik".
    const fade = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return buf;
}

function startAmbient() {
  const c = audioCtx();
  buffers ||= { white: makeNoise(c, 'white'), pink: makeNoise(c, 'pink'), brown: makeNoise(c, 'brown') };
  const master = c.createGain();
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(outVolume(), c.currentTime + 0.8);
  master.connect(c.destination);
  const nodes = {};
  const lfo = (freq, depth, target) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = freq;
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  };

  for (const [key, ch] of Object.entries(CHANNELS)) {
    const src = c.createBufferSource();
    src.loop = true;
    const gain = c.createGain();
    gain.gain.value = settings.ambient[key] * ch.scale;
    const stops = [src];
    let tail = src;
    if (key === 'rain') {
      src.buffer = buffers.pink;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 450;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;
      const shimmer = c.createGain();
      shimmer.gain.value = 1;
      stops.push(lfo(0.23, 0.12, shimmer.gain));
      tail.connect(hp).connect(lp).connect(shimmer);
      tail = shimmer;
    } else if (key === 'ocean') {
      src.buffer = buffers.brown;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      stops.push(lfo(0.07, 500, lp.frequency));
      const swell = c.createGain();
      swell.gain.value = 0.55;
      stops.push(lfo(0.07, 0.45, swell.gain));
      tail.connect(lp).connect(swell);
      tail = swell;
    } else {
      src.buffer = buffers[key];
    }
    tail.connect(gain).connect(master);
    src.start(0, Math.random() * 5);
    nodes[key] = { gain, stops };
  }
  ambient = { master, nodes };
}

function stopAmbient() {
  if (!ambient) return;
  const c = audioCtx();
  const old = ambient;
  ambient = null;
  old.master.gain.cancelScheduledValues(c.currentTime);
  old.master.gain.setTargetAtTime(0, c.currentTime, 0.15);
  setTimeout(() => {
    Object.values(old.nodes).forEach((n) => n.stops.forEach((s) => s.stop()));
    old.master.disconnect();
  }, 800);
}

function setChannel(key, value) {
  settings.ambient[key] = value;
  persist();
  if (ambient) ambient.nodes[key].gain.gain.setTargetAtTime(value * CHANNELS[key].scale, audioCtx().currentTime, 0.1);
}

const ambientSource = {
  play() {
    if (Object.values(settings.ambient).every((v) => v <= 0)) {
      settings.ambient.rain = 0.6;
      persist();
      renderAmbient();
    }
    if (!ambient) startAmbient();
    return true;
  },
  pause: stopAmbient,
  setVolume: (v) => ambient?.master.gain.setTargetAtTime(v, audioCtx().currentTime, 0.2),
};

// ---------------------------------------------------------------- YouTube

let ytApi = null;
let ytPlayer = null;
let ytReady = null;

export function parseYouTube(input) {
  const text = String(input || '').trim();
  if (/^[\w-]{11}$/.test(text)) return { id: text };
  try {
    const u = new URL(text);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const list = u.searchParams.get('list');
    let id = u.searchParams.get('v');
    if (u.hostname.endsWith('youtu.be')) id = u.pathname.slice(1);
    const m = u.pathname.match(/^\/(live|embed|shorts)\/([\w-]{11})/);
    if (m) id = m[2];
    if (!id && !list) return null;
    return { id, list };
  } catch {
    return null;
  }
}

function loadYtApi() {
  ytApi ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytApi = null;
      reject(new Error('Tidak bisa memuat YouTube (offline?)'));
    };
    document.head.append(s);
  });
  return ytApi;
}

function ensureYt() {
  ytReady ||= (async () => {
    const YT = await loadYtApi();
    const parsed = parseYouTube(activeYt()?.url) || parseYouTube(DEFAULT_YT.url);
    return new Promise((resolve) => {
      ytPlayer = new YT.Player('yt-player', {
        width: '100%',
        height: '100%',
        // Jangan kirim videoId kosong: API melempar "Invalid video id" untuk link playlist.
        ...(parsed.id ? { videoId: parsed.id } : {}),
        playerVars: {
          ...(parsed.list ? { listType: 'playlist', list: parsed.list } : {}),
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            ytPlayer.setVolume(outVolume() * 100);
            resolve(ytPlayer);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) adoptVideoTitle();
            if (settings.source !== 'youtube') return;
            if (e.data === YT.PlayerState.PLAYING && !playing) setPlaying(true);
            if (e.data === YT.PlayerState.PAUSED && playing) setPlaying(false);
          },
        },
      });
    });
  })().catch((err) => {
    ytReady = null;
    toast(err.message, { type: 'error' });
    return null;
  });
  return ytReady;
}

// Link video tanpa nama: pakai judul video dari player setelah diputar.
function adoptVideoTitle() {
  const item = activeYt();
  if (!item?.autoName || parseYouTube(item.url)?.list) return;
  const title = ytPlayer?.getVideoData?.().title;
  if (!title) return;
  item.name = title;
  item.autoName = false;
  persist();
  renderYtList();
  renderStatus();
}

function loadIntoPlayer(player, autoplay) {
  const parsed = parseYouTube(activeYt()?.url);
  if (!parsed) return;
  const method = autoplay ? 'load' : 'cue';
  if (parsed.list) player[`${method}Playlist`]({ listType: 'playlist', list: parsed.list, index: 0 });
  else player[`${method}VideoById`](parsed.id);
  player.setVolume(outVolume() * 100);
}

async function fetchYtTitle(url, parsed) {
  try {
    const target = parsed.list ? `https://www.youtube.com/playlist?list=${parsed.list}` : url;
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target)}`, {
      signal: AbortSignal.timeout?.(4000),
    });
    if (!res.ok) return null;
    return (await res.json()).title || null;
  } catch {
    return null;
  }
}

const ytKey = (parsed) => parsed.list || parsed.id;

async function addYt(url, name) {
  const parsed = parseYouTube(url);
  if (!parsed) return toast('Link YouTube tidak valid', { type: 'error' });
  const existing = settings.ytSaved.find((x) => {
    const p = parseYouTube(x.url);
    return p && ytKey(p) === ytKey(parsed);
  });
  if (existing) {
    toast('Link ini sudah tersimpan');
    return selectYt(existing.id);
  }
  const title = name || (await fetchYtTitle(url, parsed));
  const item = {
    id: uid(),
    name: title || (parsed.list ? 'Playlist YouTube' : 'Video YouTube'),
    url,
    autoName: !title,
  };
  settings.ytSaved.push(item);
  persist();
  toast(parsed.list ? 'Playlist disimpan' : 'Video disimpan');
  selectYt(item.id);
}

async function selectYt(id) {
  settings.ytActive = id;
  persist();
  if (settings.source !== 'youtube') {
    if (playing) source().pause();
    settings.source = 'youtube';
    persist();
    render();
  }
  renderYtList();
  renderStatus();
  const player = await ensureYt();
  if (!player) return;
  loadIntoPlayer(player, true);
  setPlaying(true);
}

function removeYt(id) {
  settings.ytSaved = settings.ytSaved.filter((x) => x.id !== id);
  if (settings.ytActive === id) {
    settings.ytActive = settings.ytSaved[0]?.id ?? null;
    if (ytPlayer?.stopVideo) {
      ytPlayer.stopVideo();
      if (settings.source === 'youtube') setPlaying(false);
      if (activeYt()) loadIntoPlayer(ytPlayer, false);
    }
  }
  persist();
  renderYtList();
  renderStatus();
}

function renameYt(id, name) {
  const item = settings.ytSaved.find((x) => x.id === id);
  if (item && name.trim()) {
    item.name = name.trim().slice(0, 80);
    item.autoName = false;
    persist();
  }
  renderYtList();
  renderStatus();
}

const ytSource = {
  async play({ auto = false } = {}) {
    if (!activeYt()) {
      if (!auto) {
        toast('Simpan link YouTube terlebih dahulu');
        openPanel();
      }
      return false;
    }
    const p = await ensureYt();
    if (!p) return false;
    p.setVolume(outVolume() * 100);
    p.playVideo();
    return true;
  },
  pause: () => ytPlayer?.pauseVideo?.(),
  setVolume: (v) => ytPlayer?.setVolume?.(v * 100),
};

// ---------------------------------------------------------------- Kontrol utama

const SOURCES = { upload: uploadSource, ambient: ambientSource, youtube: ytSource };
const SOURCE_LABEL = { upload: 'Musikku', ambient: 'Ambient', youtube: 'YouTube' };
const source = () => SOURCES[settings.source];

function setPlaying(v) {
  playing = v;
  renderStatus();
}

export async function play(opts) {
  try {
    const ok = await source().play(opts);
    setPlaying(!!ok);
  } catch (err) {
    console.warn('Gagal memutar musik', err);
    setPlaying(false);
  }
}

export function pause() {
  source().pause();
  setPlaying(false);
}

export const toggleMusic = () => (playing ? pause() : play());

function applyVolume() {
  source().setVolume(outVolume());
}

function setSource(key) {
  if (key === settings.source) return;
  const wasPlaying = playing;
  if (wasPlaying) source().pause();
  settings.source = key;
  persist();
  if (key === 'youtube') ensureYt();
  render();
  if (wasPlaying) play();
}

// Ikuti timer: putar saat fokus, kecilkan/jeda saat istirahat, berhenti saat jeda/selesai.
let timerKey = null;
function timerStateKey() {
  const t = getTimer();
  return t ? `${t.running ? 'run' : 'pause'}:${t.plan[t.index].type === 'focus' ? 'focus' : 'break'}` : 'none';
}

function syncWithTimer() {
  const key = timerStateKey();
  if (key === timerKey) return;
  const prev = timerKey;
  timerKey = key;
  if (!settings.autoPlay) return;
  const [run, phase] = key.split(':');
  if (run !== 'run') {
    duck = 1;
    if (playing && prev?.startsWith('run')) pause();
    else applyVolume();
    return;
  }
  if (phase === 'break' && settings.onBreak === 'pause') {
    if (playing) pause();
    return;
  }
  duck = phase === 'break' && settings.onBreak === 'duck' ? 0.3 : 1;
  applyVolume();
  if (!playing) play({ auto: true });
}

// ---------------------------------------------------------------- UI

function openPanel() {
  root.classList.add('open');
}

function render() {
  root.querySelectorAll('[data-source]').forEach((b) => b.classList.toggle('active', b.dataset.source === settings.source));
  root.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== settings.source));
  renderStatus();
}

function renderStatus() {
  if (!root) return;
  root.classList.toggle('is-playing', playing);
  const btn = root.querySelector('[data-m=toggle]');
  btn.innerHTML = icon(playing ? 'pause' : 'play', 18);
  btn.setAttribute('aria-label', playing ? 'Jeda musik' : 'Putar musik');
  let now = SOURCE_LABEL[settings.source];
  if (settings.source === 'upload' && tracks[trackIndex]) now = tracks[trackIndex].name;
  if (settings.source === 'youtube' && activeYt()) now = activeYt().name;
  if (settings.source === 'ambient') {
    const on = Object.entries(settings.ambient).filter(([, v]) => v > 0).map(([k]) => CHANNELS[k].label);
    now = on.length ? on.join(' + ') : 'Ambient';
  }
  root.querySelector('[data-now]').textContent = now;
  root.querySelector('.player-fab-label').textContent = playing ? now : 'Musik';
}

function renderTracks() {
  const list = root?.querySelector('[data-tracks]');
  if (!list) return;
  list.innerHTML = tracks.length
    ? tracks
        .map(
          (t, i) => `<li class="${i === trackIndex ? 'active' : ''}">
            <button class="track" data-track="${i}">${icon(i === trackIndex && playing ? 'volume' : 'music', 14)}<span>${esc(t.name)}</span></button>
            <button class="icon-btn sm" data-del-track="${t.id}" aria-label="Hapus">${icon('x', 14)}</button>
          </li>`,
        )
        .join('')
    : '<li class="muted small empty-tracks">Belum ada lagu. Upload MP3/OGG/WAV dari komputermu.</li>';
}

function renderYtList() {
  const list = root?.querySelector('[data-yt-list]');
  if (!list) return;
  list.innerHTML = settings.ytSaved.length
    ? settings.ytSaved
        .map((x) => {
          const isList = !!parseYouTube(x.url)?.list;
          return `<li class="${x.id === settings.ytActive ? 'active' : ''}">
            <button class="track" data-yt="${x.id}" title="${esc(x.url)}">${icon(isList ? 'list' : 'youtube', 14)}<span>${esc(x.name)}</span>${isList ? '<em class="tag">Playlist</em>' : ''}</button>
            <button class="icon-btn sm" data-yt-edit="${x.id}" aria-label="Ganti nama">${icon('edit', 13)}</button>
            <button class="icon-btn sm" data-yt-del="${x.id}" aria-label="Hapus">${icon('x', 14)}</button>
          </li>`;
        })
        .join('')
    : '<li class="muted small empty-tracks">Belum ada link tersimpan. Tempel link video atau playlist di bawah.</li>';
}

function startRename(id) {
  const btn = root.querySelector(`[data-yt="${id}"]`);
  const item = settings.ytSaved.find((x) => x.id === id);
  if (!btn || !item) return;
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = item.name;
  input.maxLength = 80;
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    save ? renameYt(id, input.value) : renderYtList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function renderAmbient() {
  root.querySelectorAll('[data-ch]').forEach((input) => (input.value = settings.ambient[input.dataset.ch]));
}

async function addTracks(files) {
  const audioFiles = [...files].filter((f) => f.type.startsWith('audio/'));
  if (!audioFiles.length) return toast('Pilih file audio', { type: 'error' });
  for (const f of audioFiles) {
    try {
      await dbPut('tracks', { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), size: f.size, addedAt: Date.now(), blob: f });
    } catch {
      toast(`Gagal menyimpan ${f.name}`, { type: 'error' });
    }
  }
  await loadTracks();
  toast(`${audioFiles.length} lagu ditambahkan`);
}

function buildPlayer() {
  root = document.getElementById('player');
  root.className = 'player';
  root.innerHTML = `
    <div class="player-panel" role="dialog" aria-label="Musik">
      <header class="player-head">
        <strong>Musik belajar</strong>
        <button class="icon-btn sm" data-m="close" aria-label="Tutup">${icon('x', 16)}</button>
      </header>
      <div class="tabs tabs-sm">
        <button class="tab" data-source="ambient">${icon('waves', 14)} Ambient</button>
        <button class="tab" data-source="upload">${icon('music', 14)} Musikku</button>
        <button class="tab" data-source="youtube">${icon('youtube', 14)} YouTube</button>
      </div>
      <div class="player-body">
        <div data-pane="ambient">
          ${Object.entries(CHANNELS)
            .map(
              ([k, ch]) => `<label class="slider-row"><span>${ch.label}</span>
                <input type="range" min="0" max="1" step="0.05" data-ch="${k}" value="${settings.ambient[k]}" /></label>`,
            )
            .join('')}
        </div>
        <div data-pane="upload" hidden>
          <ul class="tracks" data-tracks></ul>
          <div class="row-between">
            <label class="btn btn-sm">${icon('upload', 14)} Upload lagu<input type="file" accept="audio/*" multiple hidden data-upload /></label>
            <div class="row-center">
              <button class="icon-btn sm ${settings.shuffle ? 'on' : ''}" data-m="shuffle" title="Acak" aria-label="Acak">${icon('shuffle', 15)}</button>
              <button class="icon-btn sm" data-m="prev" aria-label="Sebelumnya">${icon('prev', 15)}</button>
              <button class="icon-btn sm" data-m="next" aria-label="Berikutnya">${icon('skip', 15)}</button>
            </div>
          </div>
        </div>
        <div data-pane="youtube" hidden>
          <div class="yt-frame"><div id="yt-player"></div></div>
          <div class="row-between yt-bar">
            <span class="muted small">Tersimpan</span>
            <div class="row-center">
              <button class="icon-btn sm" data-m="prev" aria-label="Sebelumnya">${icon('prev', 15)}</button>
              <button class="icon-btn sm" data-m="next" aria-label="Berikutnya">${icon('skip', 15)}</button>
            </div>
          </div>
          <ul class="tracks" data-yt-list></ul>
          <form class="yt-form">
            <input name="url" required placeholder="Tempel link video / playlist YouTube" />
            <input name="name" maxlength="80" placeholder="Nama (opsional)" />
            <button class="btn btn-sm">${icon('plus', 14)} Simpan</button>
          </form>
        </div>
      </div>
      <div class="player-controls">
        <button class="play-btn sm" data-m="toggle"></button>
        <div class="now"><span class="muted small">Sedang diputar</span><span data-now></span></div>
        <label class="vol" title="Volume">${icon('volume', 15)}<input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-volume aria-label="Volume" /></label>
      </div>
      <div class="player-opts">
        <label class="check"><input type="checkbox" data-auto ${settings.autoPlay ? 'checked' : ''} /> Ikuti timer pomodoro</label>
        <label class="opt-break">Saat istirahat
          <select class="select-sm" data-break>
            <option value="duck" ${settings.onBreak === 'duck' ? 'selected' : ''}>Kecilkan</option>
            <option value="pause" ${settings.onBreak === 'pause' ? 'selected' : ''}>Jeda</option>
            <option value="keep" ${settings.onBreak === 'keep' ? 'selected' : ''}>Tetap</option>
          </select>
        </label>
      </div>
    </div>
    <button class="player-fab" data-m="fab" aria-label="Buka pemutar musik">
      <span class="eq"><i></i><i></i><i></i></span>
      <span class="fab-icon">${icon('music', 16)}</span>
      <span class="player-fab-label">Musik</span>
    </button>`;

  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'fab') root.classList.toggle('open');
    if (m === 'close') root.classList.remove('open');
    if (m === 'toggle') toggleMusic();
    if (m === 'next') settings.source === 'youtube' ? ytPlayer?.nextVideo?.() : nextTrack(1);
    if (m === 'prev') settings.source === 'youtube' ? ytPlayer?.previousVideo?.() : nextTrack(-1);
    const yt = e.target.closest('[data-yt]');
    if (yt) selectYt(yt.dataset.yt);
    const ytEdit = e.target.closest('[data-yt-edit]');
    if (ytEdit) startRename(ytEdit.dataset.ytEdit);
    const ytDel = e.target.closest('[data-yt-del]');
    if (ytDel) removeYt(ytDel.dataset.ytDel);
    if (m === 'shuffle') {
      settings.shuffle = !settings.shuffle;
      persist();
      e.target.closest('[data-m]').classList.toggle('on', settings.shuffle);
    }
    const src = e.target.closest('[data-source]')?.dataset.source;
    if (src) setSource(src);
    const tr = e.target.closest('[data-track]');
    if (tr) {
      setTrack(Number(tr.dataset.track));
      play();
    }
    const del = e.target.closest('[data-del-track]');
    if (del) {
      const id = del.dataset.delTrack;
      if (tracks[trackIndex]?.id === id) {
        audio.pause();
        audio.removeAttribute('src');
        if (settings.source === 'upload') setPlaying(false);
      }
      dbDelete('tracks', id).then(loadTracks);
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.ch) setChannel(e.target.dataset.ch, Number(e.target.value));
    if (e.target.matches('[data-volume]')) {
      settings.volume = Number(e.target.value);
      persist();
      applyVolume();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-upload]')) addTracks(e.target.files);
    if (e.target.matches('[data-auto]')) {
      settings.autoPlay = e.target.checked;
      persist();
    }
    if (e.target.matches('[data-break]')) {
      settings.onBreak = e.target.value;
      persist();
      timerKey = null;
      if (getTimer()?.running) syncWithTimer();
    }
    if (e.target.dataset.ch) renderStatus();
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    addYt(f.url.value.trim(), f.name.value.trim());
    e.target.reset();
  });
  document.addEventListener('mousedown', (e) => {
    if (root.classList.contains('open') && !root.contains(e.target) && !e.target.closest('.modal-backdrop')) root.classList.remove('open');
  });
  audio.addEventListener('play', renderTracks);
  audio.addEventListener('pause', renderTracks);
}

export function initMusic() {
  buildPlayer();
  render();
  renderYtList();
  loadTracks();
  if (settings.source === 'youtube') ensureYt();
  timerKey = timerStateKey(); // jangan autoplay saat halaman baru dibuka
  on('timer', syncWithTimer);
}
