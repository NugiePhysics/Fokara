// Tracking harian: menit fokus, streak, grafik 7 hari, heatmap, per mata pelajaran.
import { load, save, on, getSettings, updateSettings } from '../store.js';
import { icon, esc } from '../ui.js';
import { dateKey, addDays, parseKey, fmtMin, fmtDate } from '../utils/time.js';
import { schedulesOn, updateSchedule } from './schedule.js';
import { createDurationPicker } from './timePicker.js';

export const getTracking = () => load('tracking', {});
const emptyDay = () => ({ focusMin: 0, sessions: 0, bySubject: {} });

export function dayStats(key = dateKey()) {
  return { ...emptyDay(), ...getTracking()[key] };
}

export function initTracking() {
  on('focus:logged', ({ min, completed, subject }) => {
    const all = getTracking();
    const key = dateKey();
    const day = (all[key] = { ...emptyDay(), ...all[key] });
    day.focusMin += min;
    if (completed) day.sessions += 1;
    const name = subject || 'Lainnya';
    day.bySubject[name] = (day.bySubject[name] || 0) + min;
    save('tracking', all);
  });
}

const activeDay = (all, key) => (all[key]?.focusMin || 0) >= 1;

export function currentStreak() {
  const all = getTracking();
  let d = new Date();
  if (!activeDay(all, dateKey(d))) d = addDays(d, -1);
  let count = 0;
  while (activeDay(all, dateKey(d))) {
    count++;
    d = addDays(d, -1);
  }
  return count;
}

function longestStreak() {
  const keys = Object.keys(getTracking())
    .filter((k) => activeDay(getTracking(), k))
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev && dateKey(addDays(parseKey(prev), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

export function goalRing(value, goal, size = 120) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, goal ? value / goal : 0);
  return `<svg class="goal-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${Math.round(pct * 100)}% dari target">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="8" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fill" stroke-width="8" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/>
    <text x="50%" y="47%" text-anchor="middle" class="ring-value">${Math.round(pct * 100)}%</text>
    <text x="50%" y="63%" text-anchor="middle" class="ring-sub">${fmtMin(value)}</text>
  </svg>`;
}

function weekChart(all, goal) {
  const days = Array.from({ length: 7 }, (_, i) => dateKey(addDays(new Date(), i - 6)));
  const values = days.map((k) => all[k]?.focusMin || 0);
  const max = Math.max(goal, ...values, 30);
  const W = 560;
  const H = 200;
  const pad = { t: 24, b: 28, l: 8, r: 8 };
  const bw = (W - pad.l - pad.r) / 7;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const today = dateKey();
  const bars = days
    .map((k, i) => {
      const v = values[i];
      const x = pad.l + i * bw + bw * 0.22;
      const w = bw * 0.56;
      const h = Math.max(v > 0 ? 3 : 0, H - pad.b - y(v));
      const label = parseKey(k).toLocaleDateString('id-ID', { weekday: 'short' });
      return `<g class="${k === today ? 'is-today' : ''}">
        <title>${fmtDate(k)}: ${fmtMin(v)}</title>
        <rect class="bar-bg" x="${x}" y="${pad.t}" width="${w}" height="${H - pad.t - pad.b}" rx="6"/>
        <rect class="bar" x="${x}" y="${H - pad.b - h}" width="${w}" height="${h}" rx="6"/>
        ${v > 0 ? `<text class="bar-val" x="${x + w / 2}" y="${H - pad.b - h - 6}" text-anchor="middle">${fmtMin(v)}</text>` : ''}
        <text class="bar-label" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${label}</text>
      </g>`;
    })
    .join('');
  const gy = y(goal);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Menit fokus 7 hari terakhir">
    ${bars}
    <line class="goal-line" x1="${pad.l}" x2="${W - pad.r}" y1="${gy}" y2="${gy}"/>
    <text class="goal-text" x="${W - pad.r}" y="${gy - 5}" text-anchor="end">target ${fmtMin(goal)}</text>
  </svg>`;
}

function heatmap(all, goal) {
  const weeks = 18;
  const today = new Date();
  const dow = (today.getDay() + 6) % 7; // Senin = 0
  const start = addDays(today, -(weeks - 1) * 7 - dow);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > today) {
        cells.push('<span class="hm-cell hm-future"></span>');
        continue;
      }
      const k = dateKey(date);
      const v = all[k]?.focusMin || 0;
      const lvl = v <= 0 ? 0 : v < goal * 0.25 ? 1 : v < goal * 0.6 ? 2 : v < goal ? 3 : 4;
      cells.push(`<span class="hm-cell hm-${lvl}" title="${fmtDate(k, { day: 'numeric', month: 'short' })}: ${fmtMin(v)}"></span>`);
    }
    cols.push(`<div class="hm-col">${cells.join('')}</div>`);
  }
  return `<div class="heatmap">${cols.join('')}</div>
    <div class="hm-legend muted small">Sedikit ${[0, 1, 2, 3, 4].map((l) => `<span class="hm-cell hm-${l}"></span>`).join('')} Target</div>`;
}

function subjectBreakdown(all) {
  const totals = {};
  for (let i = 0; i < 7; i++) {
    const day = all[dateKey(addDays(new Date(), -i))];
    for (const [s, m] of Object.entries(day?.bySubject || {})) totals[s] = (totals[s] || 0) + m;
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted small">Belum ada data minggu ini.</p>';
  const max = entries[0][1];
  return `<div class="hbars">${entries
    .map(
      ([s, m]) => `<div class="hbar"><span class="hbar-label">${esc(s)}</span>
        <span class="hbar-track"><i style="width:${(m / max) * 100}%"></i></span>
        <span class="hbar-val">${fmtMin(m)}</span></div>`,
    )
    .join('')}</div>`;
}

const GOAL_PRESETS = [60, 90, 120, 180, 240, 300];
const GOAL_MIN = 15;
const GOAL_MAX = 720;

function goalPanel(all, goal, todayMin) {
  const days = Array.from({ length: 7 }, (_, i) => dateKey(addDays(new Date(), i - 6)));
  const hits = days.filter((k) => (all[k]?.focusMin || 0) >= goal).length;
  const left = goal - todayMin;
  return `
    <section class="card span-2 goal-panel">
      <div class="goal-panel-ring">${goalRing(todayMin, goal, 156)}</div>
      <div class="goal-panel-body">
        <div class="goal-panel-head">
          <div>
            <p class="eyebrow">Target harian</p>
            <p class="goal-status">${left <= 0 ? '🎉 Target hari ini tercapai!' : `Sisa <strong>${fmtMin(left)}</strong> lagi untuk hari ini`}</p>
          </div>
        </div>
        <div data-goal-picker></div>
        <div class="goal-week">
          <div class="goal-week-days">
            ${days
              .map((k) => {
                const v = all[k]?.focusMin || 0;
                const ratio = Math.min(1, v / goal);
                const label = parseKey(k).toLocaleDateString('id-ID', { weekday: 'short' });
                return `<div class="wd ${ratio >= 1 ? 'hit' : ''} ${k === dateKey() ? 'today' : ''}" title="${fmtDate(k)}: ${fmtMin(v)}">
                  <span class="wd-dot" style="--p:${ratio}">${ratio >= 1 ? icon('check', 12) : ''}</span><span>${label}</span></div>`;
              })
              .join('')}
          </div>
          <span class="muted small">Tercapai <strong>${hits}</strong> dari 7 hari terakhir</span>
        </div>
      </div>
    </section>`;
}

export function renderTracking(el) {
  let editing = false;
  let saveTimer = 0;
  const draw = () => {
    const all = getTracking();
    const { dailyGoalMin: goal } = getSettings();
    const today = dayStats();
    let weekTotal = 0;
    let weekSessions = 0;
    for (let i = 0; i < 7; i++) {
      const d = all[dateKey(addDays(new Date(), -i))];
      weekTotal += d?.focusMin || 0;
      weekSessions += d?.sessions || 0;
    }
    const todays = schedulesOn(dateKey());

    el.innerHTML = `
      <header class="page-head">
        <div><h1>Tracking</h1><p class="muted">Konsistensi kecil setiap hari lebih penting daripada maraton.</p></div>
      </header>
      <div class="stats">
        <div class="stat"><span class="stat-label">${icon('target', 14)} Hari ini</span><strong>${fmtMin(today.focusMin)}</strong><span class="muted small">dari ${fmtMin(goal)}</span></div>
        <div class="stat"><span class="stat-label">${icon('chart', 14)} 7 hari</span><strong>${fmtMin(weekTotal)}</strong><span class="muted small">rata-rata ${fmtMin(weekTotal / 7)}/hari</span></div>
        <div class="stat"><span class="stat-label">${icon('flame', 14)} Streak</span><strong>${currentStreak()} hari</strong><span class="muted small">terpanjang ${longestStreak()} hari</span></div>
        <div class="stat"><span class="stat-label">${icon('timer', 14)} Pomodoro</span><strong>${weekSessions}</strong><span class="muted small">sesi selesai minggu ini</span></div>
      </div>
      <div class="grid-2">
        ${goalPanel(all, goal, today.focusMin)}
        <section class="card span-2">
          <div class="card-head"><h3>7 hari terakhir</h3></div>
          ${weekChart(all, goal)}
        </section>
        <section class="card">
          <div class="card-head"><h3>Checklist hari ini</h3></div>
          ${
            todays.length
              ? `<ul class="checklist">${todays
                  .map(
                    (s) => `<li><label class="check">
                      <input type="checkbox" data-done="${s.id}" ${s.status === 'done' ? 'checked' : ''} />
                      <span class="${s.status === 'done' ? 'strike' : ''}">${esc(s.startTime)} · ${esc(s.title)}</span></label></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted small">Tidak ada jadwal hari ini. <a href="#/schedule">Buat jadwal</a></p>'
          }
        </section>
        <section class="card">
          <div class="card-head"><h3>Per mata pelajaran</h3><span class="muted small">7 hari</span></div>
          ${subjectBreakdown(all)}
        </section>
        <section class="card span-2">
          <div class="card-head"><h3>Aktivitas</h3><span class="muted small">18 minggu terakhir</span></div>
          ${heatmap(all, goal)}
        </section>
      </div>`;
    const picker = createDurationPicker({ value: goal, min: GOAL_MIN, max: GOAL_MAX, step: 15, presets: GOAL_PRESETS });
    el.querySelector('[data-goal-picker]').append(picker.el);
    // Simpan langsung; render ulang panel setelah pengguna berhenti mengubah nilai.
    picker.el.addEventListener('input', () => {
      editing = true;
      updateSettings({ dailyGoalMin: picker.value });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        editing = false;
        draw();
      }, 900);
    });
  };

  const onChange = (e) => {
    const id = e.target.dataset.done;
    if (id) updateSchedule(id, { status: e.target.checked ? 'done' : 'planned' });
  };
  const redraw = () => !editing && draw();
  el.addEventListener('change', onChange);
  const offs = [on('change:tracking', redraw), on('change:schedules', redraw)];
  draw();
  return () => {
    el.removeEventListener('change', onChange);
    clearTimeout(saveTimer);
    offs.forEach((off) => off());
  };
}
