// Dashboard Today: ringkasan hari ini, sesi berjalan, dan jadwal hari ini.
import { on, getSettings } from '../store.js';
import { icon, esc } from '../ui.js';
import { dateKey, fmtDate, fmtMin, fmtClock } from '../utils/time.js';
import { getTimer, currentSegment, remainingMs, SEGMENT_LABEL } from './pomodoro.js';
import { schedulesOn, scheduleItem, bindScheduleActions, openScheduleForm } from './schedule.js';
import { dayStats, currentStreak, goalRing } from './tracking.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function renderToday(el) {
  const draw = () => {
    const key = dateKey();
    const stats = dayStats(key);
    const { dailyGoalMin } = getSettings();
    const list = schedulesOn(key);
    const doneCount = list.filter((s) => s.status === 'done').length;
    const plannedMin = list.reduce((a, s) => a + s.durationMin, 0);
    const t = getTimer();

    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">${fmtDate(key)}</p>
          <h1>${greeting()}.</h1>
        </div>
        <button class="btn btn-primary" data-new>${icon('plus', 16)} Jadwal baru</button>
      </header>
      ${
        t
          ? `<a class="live-card" href="#/focus" data-mode="${currentSegment().type === 'focus' ? 'focus' : 'break'}">
              <span class="live-dot"></span>
              <div><p class="eyebrow">${SEGMENT_LABEL[currentSegment().type]}${t.running ? '' : ' · dijeda'}</p><strong>${esc(t.title)}</strong></div>
              <span class="live-time" data-live-time>${fmtClock(remainingMs())}</span>
              ${icon('chevR')}
            </a>`
          : ''
      }
      <div class="today-grid">
        <section class="card goal-card">
          ${goalRing(stats.focusMin, dailyGoalMin)}
          <div>
            <h3>Target fokus</h3>
            <p class="muted small">${fmtMin(stats.focusMin)} dari ${fmtMin(dailyGoalMin)} hari ini</p>
            <a href="#/tracking" class="small">Lihat tracking →</a>
          </div>
        </section>
        <section class="card mini-stat"><span class="stat-label">${icon('flame', 14)} Streak</span><strong>${currentStreak()}</strong><span class="muted small">hari berturut-turut</span></section>
        <section class="card mini-stat"><span class="stat-label">${icon('check', 14)} Jadwal</span><strong>${doneCount}/${list.length}</strong><span class="muted small">${list.length ? `${fmtMin(plannedMin)} direncanakan` : 'belum ada jadwal'}</span></section>
        <section class="card mini-stat"><span class="stat-label">${icon('timer', 14)} Pomodoro</span><strong>${stats.sessions}</strong><span class="muted small">sesi selesai</span></section>
      </div>
      <section>
        <h3 class="group-title">Jadwal hari ini</h3>
        <div class="sched-list">
          ${
            list.length
              ? list.map(scheduleItem).join('')
              : `<div class="empty">
                  <div class="empty-icon">${icon('calendar', 28)}</div>
                  <p>Belum ada jadwal hari ini.</p>
                  <div class="row-center">
                    <button class="btn" data-new>${icon('plus', 16)} Buat jadwal</button>
                    <a class="btn btn-ghost" href="#/focus">Sesi cepat</a>
                  </div>
                </div>`
          }
        </div>
      </section>`;
  };

  const onClick = (e) => {
    if (e.target.closest('[data-new]')) openScheduleForm();
  };
  const onTick = () => {
    const live = el.querySelector('[data-live-time]');
    if (live) live.textContent = fmtClock(remainingMs());
  };
  el.addEventListener('click', onClick);
  const unbind = bindScheduleActions(el);
  let lastKey = '';
  const onTimer = (t) => {
    const key = t ? `${t.index}-${t.running}` : 'none';
    if (key !== lastKey) draw();
    lastKey = key;
  };
  const offs = [on('change:schedules', draw), on('change:tracking', draw), on('timer', onTimer), on('timer:tick', onTick)];
  draw();
  return () => {
    el.removeEventListener('click', onClick);
    unbind();
    offs.forEach((off) => off());
  };
}
