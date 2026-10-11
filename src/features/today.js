// Dashboard Today: ringkasan hari ini, sesi berjalan, dan jadwal hari ini.
import { on, getSettings } from '../store.js';
import { icon, esc } from '../ui.js';
import { t } from '../i18n.js';
import { dateKey, fmtDate, fmtMin, fmtClock } from '../utils/time.js';
import { getTimer, currentSegment, remainingMs, SEGMENT_LABEL } from './pomodoro.js';
import { schedulesOn, scheduleItem, bindScheduleActions, openScheduleForm } from './schedule.js';
import { dayStats, currentStreak, goalRing } from './tracking.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return t('Good morning');
  if (h < 15) return t('Good afternoon');
  if (h < 18) return t('Good evening');
  return t('Good night');
}

export function renderToday(el) {
  const draw = () => {
    const key = dateKey();
    const stats = dayStats(key);
    const { dailyGoalMin } = getSettings();
    const list = schedulesOn(key);
    const doneCount = list.filter((s) => s.status === 'done').length;
    const plannedMin = list.reduce((a, s) => a + s.durationMin, 0);
    const timer = getTimer();

    el.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">${fmtDate(key)}</p>
          <h1>${greeting()}.</h1>
        </div>
        <button class="btn btn-primary" data-new>${icon('plus', 16)} ${t('New schedule')}</button>
      </header>
      ${
        timer
          ? `<a class="live-card" href="#/focus" data-mode="${currentSegment().type === 'focus' ? 'focus' : 'break'}">
              <span class="live-dot"></span>
              <div><p class="eyebrow">${SEGMENT_LABEL[currentSegment().type]}${timer.running ? '' : ` · ${t('paused')}`}</p><strong>${esc(timer.title)}</strong></div>
              <span class="live-time" data-live-time>${fmtClock(remainingMs())}</span>
              ${icon('chevR')}
            </a>`
          : ''
      }
      <div class="today-grid">
        <section class="card goal-card">
          ${goalRing(stats.focusMin, dailyGoalMin)}
          <div>
            <h3>${t('Focus goal')}</h3>
            <p class="muted small">${t('{done} of {goal} today', { done: fmtMin(stats.focusMin), goal: fmtMin(dailyGoalMin) })}</p>
            <a href="#/tracking" class="small">${t('View tracking →')}</a>
          </div>
        </section>
        <section class="card mini-stat"><span class="stat-label">${icon('flame', 14)} ${t('Streak')}</span><strong>${currentStreak()}</strong><span class="muted small">${t('days in a row')}</span></section>
        <section class="card mini-stat"><span class="stat-label">${icon('check', 14)} ${t('Schedules')}</span><strong>${doneCount}/${list.length}</strong><span class="muted small">${list.length ? t('{time} planned', { time: fmtMin(plannedMin) }) : t('no schedules yet')}</span></section>
        <section class="card mini-stat"><span class="stat-label">${icon('timer', 14)} ${t('Pomodoro')}</span><strong>${stats.sessions}</strong><span class="muted small">${t('sessions completed')}</span></section>
      </div>
      <section>
        <h3 class="group-title">${t("Today's schedule")}</h3>
        <div class="sched-list">
          ${
            list.length
              ? list.map(scheduleItem).join('')
              : `<div class="empty">
                  <div class="empty-icon">${icon('calendar', 28)}</div>
                  <p>${t('No schedules today yet.')}</p>
                  <div class="row-center">
                    <button class="btn" data-new>${icon('plus', 16)} ${t('Create schedule')}</button>
                    <a class="btn btn-ghost" href="#/focus">${t('Quick session')}</a>
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
  const onTimer = (timer) => {
    const key = timer ? `${timer.index}-${timer.running}` : 'none';
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
