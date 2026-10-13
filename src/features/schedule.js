// Jadwal belajar: CRUD, form, dan integrasi otomatis ke timer pomodoro.
import { load, save, on, uid } from '../store.js';
import { dbAll } from '../db.js';
import { icon, esc, openModal, confirmDialog, toast } from '../ui.js';
import { t } from '../i18n.js';
import { dateKey, relDayLabel, fmtMin, addMinutesToTime, pad } from '../utils/time.js';
import { createDurationPicker, createStepper } from './timePicker.js';
import { buildPlan, planSummary, segmentBar, makePreset, presetLabel, PRESETS, getTimer, startSession } from './pomodoro.js';

export const getSchedules = () => load('schedules', []);
const setSchedules = (list) => save('schedules', list);

export function getSchedule(id) {
  return getSchedules().find((s) => s.id === id);
}

export function updateSchedule(id, patch) {
  setSchedules(getSchedules().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

function deleteSchedule(id) {
  setSchedules(getSchedules().filter((s) => s.id !== id));
}

/** Label mata pelajaran tersimpan; sebelum pernah diubah, diturunkan dari jadwal yang sudah ada. */
const getSubjects = () => load('subjects', null) ?? uniqueLabels(getSchedules().map((x) => x.subject));
const uniqueLabels = (list) => {
  const seen = new Set();
  return list.filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

const sortSchedules = (a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime);

export function schedulesOn(key) {
  return getSchedules().filter((s) => s.date === key).sort(sortSchedules);
}

export function initSchedule() {
  on('focus:logged', ({ min, scheduleId }) => {
    const s = scheduleId && getSchedule(scheduleId);
    if (s) updateSchedule(s.id, { progressMin: (s.progressMin || 0) + min });
  });
  on('timer:start', ({ scheduleId }) => scheduleId && updateSchedule(scheduleId, { status: 'active' }));
  on('timer:stop', ({ scheduleId }) => {
    const s = scheduleId && getSchedule(scheduleId);
    if (s && s.status === 'active') updateSchedule(s.id, { status: 'planned' });
  });
  on('timer:complete', ({ scheduleId }) => scheduleId && updateSchedule(scheduleId, { status: 'done' }));
}

/** Mulai jadwal: bangun plan pomodoro dari durasi & preset, lalu buka Focus. */
export async function startSchedule(id) {
  const s = getSchedule(id);
  if (!s) return;
  const timer = getTimer();
  if (timer?.scheduleId === id) {
    location.hash = '#/focus';
    return;
  }
  if (timer && !(await confirmDialog(t('Session "{title}" is still running. Stop it and start "{next}"?', { title: timer.title, next: s.title }), { okText: t('Start') }))) return;
  if (s.status === 'done' && !(await confirmDialog(t('"{title}" is already done. Repeat this session?', { title: s.title }), { okText: t('Repeat') }))) return;
  startSession({ scheduleId: s.id, title: s.title, subject: s.subject, plan: buildPlan(s.durationMin, s.preset) });
  location.hash = '#/focus';
}

// ---------------------------------------------------------------- Item

export function scheduleItem(s) {
  const plan = buildPlan(s.durationMin, s.preset);
  const sum = planSummary(plan);
  const pct = Math.min(100, ((s.progressMin || 0) / sum.focusMin) * 100);
  const active = getTimer()?.scheduleId === s.id;
  const done = s.status === 'done';
  const startLabel = active ? t('Open') : done ? t('Repeat') : t('Start');
  return `
    <article class="sched ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}" data-id="${s.id}">
      <div class="sched-time">
        <strong>${esc(s.startTime)}</strong>
        <span>${addMinutesToTime(s.startTime, s.durationMin)}</span>
      </div>
      <div class="sched-main">
        <div class="sched-title">
          ${done ? `<span class="badge badge-done">${icon('check', 12)} ${t('Done')}</span>` : ''}
          ${active ? `<span class="badge badge-live">${t('Running')}</span>` : ''}
          <h4>${esc(s.title)}</h4>
        </div>
        <div class="sched-meta">
          ${s.subject ? `<span class="chip">${esc(s.subject)}</span>` : ''}
          <span>${icon('clock', 13)} ${fmtMin(s.durationMin)}</span>
          <span>${icon('timer', 13)} ${presetLabel(s.preset)} · ${t('{n} sessions', { n: sum.focusCount })}</span>
          ${s.pdfIds?.length ? `<span>${icon('file', 13)} ${s.pdfIds.length} PDF</span>` : ''}
        </div>
        <div class="progress" title="${t('{done} of {total} focus', { done: fmtMin(s.progressMin || 0), total: fmtMin(sum.focusMin) })}"><i style="width:${pct}%"></i></div>
      </div>
      <div class="sched-actions">
        <button class="btn btn-primary btn-sm" data-action="start">${icon(active ? 'timer' : 'play', 14)} ${startLabel}</button>
        <button class="icon-btn" data-action="edit" aria-label="${t('Edit')}">${icon('edit', 16)}</button>
        <button class="icon-btn" data-action="delete" aria-label="${t('Delete')}">${icon('trash', 16)}</button>
      </div>
    </article>`;
}

export function bindScheduleActions(container) {
  const handler = async (e) => {
    const btn = e.target.closest('[data-action]');
    const item = e.target.closest('.sched');
    if (!btn || !item) return;
    const id = item.dataset.id;
    const action = btn.dataset.action;
    if (action === 'start') startSchedule(id);
    if (action === 'edit') openScheduleForm(getSchedule(id));
    if (action === 'delete') {
      const s = getSchedule(id);
      if (getTimer()?.scheduleId === id) return toast(t('Stop the running session first'));
      if (await confirmDialog(t('Delete schedule "{title}"?', { title: s.title }), { okText: t('Delete'), danger: true })) {
        deleteSchedule(id);
        toast(t('Schedule deleted'));
      }
    }
  };
  container.addEventListener('click', handler);
  return () => container.removeEventListener('click', handler);
}

// ---------------------------------------------------------------- Form

function nextHalfHour() {
  const d = new Date();
  const m = d.getMinutes() < 30 ? 30 : 60;
  d.setMinutes(m, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function openScheduleForm(existing = null, defaults = {}) {
  const pdfs = (await dbAll('pdfs')).sort((a, b) => b.addedAt - a.addedAt);
  const s = existing || {
    title: '',
    subject: '',
    date: defaults.date || dateKey(),
    startTime: nextHalfHour(),
    durationMin: 120,
    preset: makePreset('classic'),
    pdfIds: [],
  };
  let subjects = uniqueLabels([...getSubjects(), s.subject]);
  let subject = s.subject || '';
  const custom = s.preset.key === 'custom' ? s.preset : { focus: 30, short: 5, long: 15, longEvery: 4 };

  const form = document.createElement('form');
  form.className = 'form';
  form.innerHTML = `
    <label class="field">
      <span>${t('Title')}</span>
      <input name="title" required maxlength="80" placeholder="${t('e.g. Thermodynamics practice problems')}" value="${esc(s.title)}" />
    </label>
    <div class="row">
      <div class="field">
        <span>${t('Subject')}</span>
        <input type="hidden" name="subject" value="${esc(subject)}" />
        <div class="label-picker" data-subjects></div>
      </div>
    </div>
    <div class="row">
      <label class="field"><span>${t('Date')}</span><input type="date" name="date" required value="${s.date}" /></label>
      <label class="field"><span>${t('Start time')}</span><input type="time" name="startTime" required value="${s.startTime}" /></label>
    </div>
    <div class="field">
      <span>${t('Duration')}</span>
      <div data-duration></div>
    </div>
    <div class="field">
      <span>${t('Pomodoro preset')}</span>
      <div class="segmented" role="radiogroup">
        ${Object.entries(PRESETS)
          .map(([k, p]) => `<label><input type="radio" name="preset" value="${k}" ${s.preset.key === k ? 'checked' : ''} /><span>${p.label}</span></label>`)
          .join('')}
        <label><input type="radio" name="preset" value="custom" ${s.preset.key === 'custom' ? 'checked' : ''} /><span>${t('Custom')}</span></label>
      </div>
      <div class="custom-preset" ${s.preset.key === 'custom' ? '' : 'hidden'}>

      </div>
    </div>
    <div class="plan-preview" aria-live="polite"></div>
    <div class="field">
      <span>${t('PDF references')}</span>
      ${
        pdfs.length
          ? `<div class="pdf-pick">${pdfs
              .map(
                (p) => `<label class="check"><input type="checkbox" name="pdf" value="${p.id}" ${s.pdfIds?.includes(p.id) ? 'checked' : ''} />
                  ${icon('file', 14)}<span>${esc(p.name)}</span></label>`,
              )
              .join('')}</div>`
          : `<p class="muted small">${t('No PDFs yet. Upload one in the <a href="#/library">Library</a> first.')}</p>`
      }
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>${t('Cancel')}</button>
      <button type="submit" class="btn" data-mode="save">${t('Save')}</button>
      <button type="submit" class="btn btn-primary" data-mode="start">${icon('play', 14)} ${t('Save & start')}</button>
    </div>`;

  const duration = createDurationPicker({ value: s.durationMin, min: 5, max: 720, presets: [30, 60, 120, 180, 240] });
  form.querySelector('[data-duration]').append(duration.el);
  form.querySelector('.custom-preset').append(
    createStepper({ name: 'c_focus', label: t('Focus'), value: custom.focus, min: 5, max: 240, step: 5 }).el,
    createStepper({ name: 'c_short', label: t('Break'), value: custom.short, min: 1, max: 60 }).el,
    createStepper({ name: 'c_long', label: t('Long brk.'), value: custom.long, min: 1, max: 90 }).el,
    createStepper({ name: 'c_longEvery', label: t('Long every'), value: custom.longEvery, min: 1, max: 12, unit: t('sessions') }).el,
  );

  const modal = openModal({ title: existing ? t('Edit schedule') : t('New schedule'), content: form, wide: true });
  const $ = (name) => form.elements[name];

  const read = () => {
    const durationMin = duration.value;
    const key = form.querySelector('input[name=preset]:checked').value;
    const preset = makePreset(key, {
      focus: $('c_focus').value,
      short: $('c_short').value,
      long: $('c_long').value,
      longEvery: $('c_longEvery').value,
    });
    return { durationMin, preset };
  };

  // Pemilih label: klik untuk memilih/melepas, "+ New label" untuk membuat, × untuk menghapus dari daftar.
  const picker = form.querySelector('[data-subjects]');
  const saveSubjects = () => save('subjects', subjects);
  const drawSubjects = (adding = false) => {
    $('subject').value = subject;
    picker.innerHTML = `
      ${subjects
        .map(
          (x) => `<span class="label-chip ${x === subject ? 'active' : ''}">
            <button type="button" class="label-pick" data-pick="${esc(x)}" aria-pressed="${x === subject}">${esc(x)}</button>
            <button type="button" class="label-del" data-del="${esc(x)}" aria-label="${t('Delete label')}">${icon('x', 12)}</button>
          </span>`,
        )
        .join('')}
      ${
        adding
          ? `<input class="label-input" maxlength="40" placeholder="${t('Label name')}" />`
          : `<button type="button" class="chip-btn label-add" data-add>${icon('plus', 14)} ${t('New label')}</button>`
      }`;
    if (adding) picker.querySelector('.label-input').focus();
  };
  const addLabel = (raw) => {
    const name = raw.trim();
    if (name) {
      subject = subjects.find((x) => x.toLowerCase() === name.toLowerCase()) || name;
      if (!subjects.includes(subject)) {
        subjects = [...subjects, subject];
        saveSubjects();
      }
    }
    drawSubjects();
  };
  picker.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    const del = e.target.closest('[data-del]');
    if (pick) {
      subject = subject === pick.dataset.pick ? '' : pick.dataset.pick;
      drawSubjects();
    } else if (del) {
      subjects = subjects.filter((x) => x !== del.dataset.del);
      if (subject === del.dataset.del) subject = '';
      saveSubjects();
      drawSubjects();
    } else if (e.target.closest('[data-add]')) drawSubjects(true);
  });
  picker.addEventListener('keydown', (e) => {
    if (!e.target.matches('.label-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      addLabel(e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      drawSubjects();
    }
  });
  picker.addEventListener('focusout', (e) => {
    if (e.target.matches('.label-input') && e.target.isConnected && !picker.contains(e.relatedTarget)) addLabel(e.target.value);
  });
  drawSubjects();

  const preview = form.querySelector('.plan-preview');
  const updatePreview = () => {
    const { durationMin, preset } = read();
    form.querySelector('.custom-preset').hidden = preset.key !== 'custom';
    const plan = buildPlan(durationMin, preset);
    const sum = planSummary(plan);
    preview.innerHTML = `
      <div class="plan-head">
        <span>${t('Automatic split for <strong>{time}</strong>', { time: fmtMin(durationMin) })}${$('startTime').value ? t(' · ends at <strong>{time}</strong>', { time: addMinutesToTime($('startTime').value, durationMin) }) : ''}</span>
        <span class="muted small">${t('{n} focus sessions · {focus} focus · {brk} break', { n: sum.focusCount, focus: fmtMin(sum.focusMin), brk: fmtMin(sum.breakMin) })}</span>
      </div>
      ${segmentBar(plan)}
      <div class="plan-legend"><span class="lg lg-focus">${t('Focus')}</span><span class="lg lg-short">${t('Break')}</span><span class="lg lg-long">${t('Long break')}</span></div>`;
  };

  form.addEventListener('input', updatePreview);
  form.querySelector('[data-cancel]').onclick = () => modal.close();
  updatePreview();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || 'save';
    const { durationMin, preset } = read();
    const data = {
      title: $('title').value.trim(),
      subject,
      date: $('date').value,
      startTime: $('startTime').value,
      durationMin,
      preset,
      pdfIds: [...form.querySelectorAll('input[name=pdf]:checked')].map((i) => i.value),
    };
    let id;
    if (existing) {
      id = existing.id;
      updateSchedule(id, data);
    } else {
      id = uid();
      setSchedules([...getSchedules(), { id, status: 'planned', progressMin: 0, createdAt: Date.now(), ...data }]);
    }
    modal.close();
    if (mode === 'start') startSchedule(id);
    else toast(existing ? t('Schedule updated') : t('Schedule added'));
  });
}

// ---------------------------------------------------------------- View

const FILTERS = { upcoming: t('Upcoming'), today: t('Today'), done: t('Completed'), all: t('All') };

export function renderSchedule(el) {
  let filter = load('scheduleFilter', 'upcoming');

  const draw = () => {
    const today = dateKey();
    let list = getSchedules().sort(sortSchedules);
    if (filter === 'upcoming') list = list.filter((s) => s.date >= today && s.status !== 'done');
    if (filter === 'today') list = list.filter((s) => s.date === today);
    if (filter === 'done') list = list.filter((s) => s.status === 'done').reverse();

    const groups = new Map();
    for (const s of list) {
      if (!groups.has(s.date)) groups.set(s.date, []);
      groups.get(s.date).push(s);
    }

    el.innerHTML = `
      <header class="page-head">
        <div>
          <h1>${t('Schedule')}</h1>
          <p class="muted">${t('Set the duration and the pomodoro split is calculated automatically.')}</p>
        </div>
        <button class="btn btn-primary" data-new>${icon('plus', 16)} ${t('New schedule')}</button>
      </header>
      <div class="tabs" role="tablist">
        ${Object.entries(FILTERS)
          .map(([k, label]) => `<button role="tab" class="tab ${k === filter ? 'active' : ''}" data-filter="${k}">${label}</button>`)
          .join('')}
      </div>
      <div class="sched-groups">
        ${
          groups.size
            ? [...groups]
                .map(
                  ([date, items]) => `
            <section class="sched-group">
              <h3 class="group-title">${relDayLabel(date)}
                <span class="muted small">${fmtMin(items.reduce((a, s) => a + s.durationMin, 0))}</span></h3>
              <div class="sched-list">${items.map(scheduleItem).join('')}</div>
            </section>`,
                )
                .join('')
            : `<div class="empty">
                <div class="empty-icon">${icon('calendar', 28)}</div>
                <p>${t('No schedules here yet.')}</p>
                <button class="btn" data-new>${icon('plus', 16)} ${t('Create your first schedule')}</button>
              </div>`
        }
      </div>`;
  };

  const onClick = (e) => {
    if (e.target.closest('[data-new]')) openScheduleForm();
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      save('scheduleFilter', filter);
      draw();
    }
  };
  el.addEventListener('click', onClick);
  const unbind = bindScheduleActions(el);
  const offs = [on('change:schedules', draw), on('timer:start', draw), on('timer:stop', draw), on('timer:complete', draw)];
  draw();
  return () => {
    el.removeEventListener('click', onClick);
    unbind();
    offs.forEach((off) => off());
  };
}
