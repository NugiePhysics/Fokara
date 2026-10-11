// Engine pomodoro: membagi durasi jadwal menjadi segmen & menjalankan timer.
import { load, save, emit } from '../store.js';
import { chime } from '../utils/sound.js';
import { fmtClock, fmtMin } from '../utils/time.js';
import { toast } from '../ui.js';
import { t } from '../i18n.js';

export const PRESETS = {
  classic: { label: '25 / 5', focus: 25, short: 5, long: 15, longEvery: 4 },
  deep: { label: '50 / 10', focus: 50, short: 10, long: 20, longEvery: 3 },
};

export const SEGMENT_LABEL = { focus: t('Focus'), short: t('Short break'), long: t('Long break') };

export function makePreset(key, custom = {}) {
  if (key !== 'custom') return { key, ...PRESETS[key] };
  return {
    key: 'custom',
    focus: clampInt(custom.focus, 1, 240, 25),
    short: clampInt(custom.short, 1, 60, 5),
    long: clampInt(custom.long, 1, 90, 15),
    longEvery: clampInt(custom.longEvery, 1, 12, 4),
  };
}

export function presetLabel(p) {
  return p.key === 'custom' ? `${t('Custom')} ${p.focus} / ${p.short}` : PRESETS[p.key]?.label ?? '';
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Bagi total durasi (menit, termasuk istirahat) menjadi segmen fokus/istirahat.
 * Plan tidak pernah diakhiri istirahat; sisa waktu yang terlalu kecil digabung
 * ke segmen fokus terakhir agar totalnya tetap pas.
 */
export function buildPlan(totalMin, preset) {
  const plan = [];
  let remaining = Math.max(1, Math.round(totalMin));
  let focusCount = 0;
  const minTail = Math.min(5, preset.focus);

  while (remaining > 0) {
    const focus = Math.min(preset.focus, remaining);
    plan.push({ type: 'focus', min: focus });
    remaining -= focus;
    focusCount++;
    if (remaining <= 0) break;

    const isLong = focusCount % preset.longEvery === 0;
    const brk = isLong ? preset.long : preset.short;
    if (remaining - brk < minTail) {
      plan[plan.length - 1].min += remaining;
      break;
    }
    plan.push({ type: isLong ? 'long' : 'short', min: brk });
    remaining -= brk;
  }
  return plan;
}

export function planSummary(plan) {
  let focusMin = 0;
  let breakMin = 0;
  let focusCount = 0;
  for (const s of plan) {
    if (s.type === 'focus') {
      focusMin += s.min;
      focusCount++;
    } else breakMin += s.min;
  }
  return { focusMin, breakMin, focusCount, totalMin: focusMin + breakMin };
}

export function segmentBar(plan, current = -1, progress = 0) {
  return `<div class="segbar">${plan
    .map((s, i) => {
      const state = i < current ? 'done' : i === current ? 'current' : '';
      const fill = i === current ? `<i style="width:${(progress * 100).toFixed(2)}%"></i>` : '';
      return `<span class="seg seg-${s.type} ${state}" style="flex:${s.min}" title="${SEGMENT_LABEL[s.type]} · ${s.min}m">${fill}</span>`;
    })
    .join('')}</div>`;
}

// ---------------------------------------------------------------- Timer

// ?speed=60 mempercepat timer (1 menit = 1 detik) untuk testing.
const speed = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
const MINUTE_MS = 60000 / speed;

let state = load('activeTimer', null);

const persist = () => {
  save('activeTimer', state);
  emit('timer', state);
};

export const getTimer = () => state;
export const currentSegment = () => state?.plan[state.index] ?? null;
const segMs = (i) => state.plan[i].min * MINUTE_MS;

export function remainingMs() {
  if (!state) return 0;
  return state.running ? Math.max(0, state.endsAt - Date.now()) : state.remainingMs;
}

export function segmentProgress() {
  if (!state) return 0;
  const total = segMs(state.index);
  return Math.min(1, Math.max(0, 1 - remainingMs() / total));
}

/** Menit (skala rencana) yang sudah lewat di seluruh sesi. */
export function sessionElapsedMin() {
  if (!state) return 0;
  const before = state.plan.slice(0, state.index).reduce((a, s) => a + s.min, 0);
  return before + state.plan[state.index].min * segmentProgress();
}

export function startSession({ scheduleId = null, title, subject = '', plan }) {
  if (state) stopSession({ silent: true });
  const first = plan[0].min * MINUTE_MS;
  state = {
    scheduleId,
    title,
    subject,
    plan,
    index: 0,
    running: true,
    endsAt: Date.now() + first,
    remainingMs: first,
    startedAt: Date.now(),
    focusDoneMin: 0,
    segLoggedMin: 0,
  };
  requestNotifyPermission();
  persist();
  emit('timer:start', state);
  announce(false);
}

export function pause() {
  if (!state?.running) return;
  commitFocus();
  state.remainingMs = remainingMs();
  state.running = false;
  persist();
}

export function resume() {
  if (!state || state.running) return;
  state.endsAt = Date.now() + state.remainingMs;
  state.running = true;
  persist();
}

export const toggle = () => (state?.running ? pause() : resume());

export function skip() {
  if (!state) return;
  commitFocus();
  goTo(state.index + 1, Date.now());
  if (state) {
    persist();
    announce();
  }
}

export function resetSegment() {
  if (!state) return;
  commitFocus(); // waktu yang sudah dijalani tetap dihitung
  state.segLoggedMin = 0;
  state.remainingMs = segMs(state.index);
  state.endsAt = Date.now() + state.remainingMs;
  persist();
}

export function stopSession({ silent = false } = {}) {
  if (!state) return;
  commitFocus();
  const stopped = state;
  state = null;
  persist();
  emit('timer:stop', stopped);
  updateTitle();
  if (!silent) toast(t('Session stopped · {time} of focus logged', { time: fmtMin(stopped.focusDoneMin) }));
}

function elapsedInSegmentMin() {
  return (segMs(state.index) - remainingMs()) / MINUTE_MS;
}

/**
 * Catat menit fokus yang sudah dijalani tapi belum tercatat ke tracking.
 * Dipanggil berkala saat timer jalan, serta saat jeda/lewati/berhenti/tab ditutup,
 * sehingga fokus 30 menit dari segmen 50 menit tetap tercatat 30 menit.
 */
function commitFocus({ completed = false } = {}) {
  if (!state || currentSegment().type !== 'focus') return;
  const elapsed = completed ? currentSegment().min : elapsedInSegmentMin();
  const delta = Math.max(0, elapsed - (state.segLoggedMin || 0));
  if (delta < 0.01 && !completed) return;
  state.segLoggedMin = elapsed;
  state.focusDoneMin += delta;
  emit('focus:logged', { min: delta, completed, scheduleId: state.scheduleId, subject: state.subject });
}

function goTo(index, startAt) {
  if (index >= state.plan.length) return finish();
  state.index = index;
  state.segLoggedMin = 0;
  state.remainingMs = segMs(index);
  if (state.running) state.endsAt = startAt + state.remainingMs;
}

function finish() {
  const done = state;
  state = null;
  // Kirim 'timer:complete' dulu agar status jadwal sudah 'done' saat view dirender ulang.
  save('activeTimer', null);
  emit('timer:complete', done);
  emit('timer', null);
  chime('done');
  notify(t('Session complete 🎉'), t('{title}: {time} of focus', { title: done.title, time: fmtMin(done.focusDoneMin) }));
  updateTitle();
}

function announce(withSound = true) {
  const seg = currentSegment();
  emit('timer:segment', { index: state.index, segment: seg });
  if (!withSound) return;
  const isFocus = seg.type === 'focus';
  chime(isFocus ? 'focus' : 'break');
  notify(isFocus ? t('Time to focus') : t('Time for a break'), t('{label} · {n} minutes', { label: SEGMENT_LABEL[seg.type], n: seg.min }));
}

function tick() {
  if (state?.running && Date.now() >= state.endsAt) {
    // Kejar semua segmen yang terlewat (misal tab di background).
    while (state?.running && Date.now() >= state.endsAt) {
      const endedAt = state.endsAt;
      commitFocus({ completed: true });
      goTo(state.index + 1, endedAt);
    }
    if (state) {
      persist();
      announce();
    }
  } else if (state?.running && currentSegment().type === 'focus' && elapsedInSegmentMin() - (state.segLoggedMin || 0) >= 0.25) {
    commitFocus();
    save('activeTimer', state);
  }
  if (state) emit('timer:tick', state);
  updateTitle();
}

let lastTitle = '';
function updateTitle() {
  let title = 'Fokara';
  if (state) {
    const seg = currentSegment();
    title = `${state.running ? '' : '⏸ '}${fmtClock(remainingMs())} · ${SEGMENT_LABEL[seg.type]} · Fokara`;
  }
  if (title !== lastTitle) document.title = lastTitle = title;
}

function requestNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(title, { body, icon: '/favicon.svg', silent: true });
  } catch {
    /* beberapa browser butuh service worker */
  }
}

export function initTimer() {
  // Halaman ditutup saat timer berjalan dan segmennya sudah habis: hanya waktu yang
  // sempat tercatat yang dihitung, lalu timer dijeda di posisi terakhir itu.
  if (state?.running && Date.now() >= state.endsAt) {
    state.running = false;
    state.remainingMs = Math.max(0, segMs(state.index) - (state.segLoggedMin || 0) * MINUTE_MS);
    if (state.remainingMs < 1000) {
      commitFocus({ completed: true });
      goTo(state.index + 1, Date.now());
    }
    if (state) {
      persist();
      setTimeout(() => toast(t('Timer paused at its last position because the page was closed')), 400);
    }
  }
  const flush = () => {
    if (!state?.running) return;
    commitFocus();
    save('activeTimer', state);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  setInterval(tick, 250);
  tick();
}
