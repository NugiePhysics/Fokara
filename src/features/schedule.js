// Jadwal belajar: CRUD, form, dan integrasi otomatis ke timer pomodoro.
import { load, save, on, uid } from '../store.js';
import { dbAll } from '../db.js';
import { icon, esc, openModal, confirmDialog, toast } from '../ui.js';
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
  if (timer && !(await confirmDialog(`Sesi "${timer.title}" masih berjalan. Hentikan dan mulai "${s.title}"?`, { okText: 'Mulai' }))) return;
  if (s.status === 'done' && !(await confirmDialog(`"${s.title}" sudah selesai. Ulangi sesi ini?`, { okText: 'Ulangi' }))) return;
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
  const startLabel = active ? 'Buka' : done ? 'Ulangi' : 'Mulai';
  return `
    <article class="sched ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}" data-id="${s.id}">
      <div class="sched-time">
        <strong>${esc(s.startTime)}</strong>
        <span>${addMinutesToTime(s.startTime, s.durationMin)}</span>
      </div>
      <div class="sched-main">
        <div class="sched-title">
          ${done ? `<span class="badge badge-done">${icon('check', 12)} Selesai</span>` : ''}
          ${active ? '<span class="badge badge-live">Berjalan</span>' : ''}
          <h4>${esc(s.title)}</h4>
        </div>
        <div class="sched-meta">
          ${s.subject ? `<span class="chip">${esc(s.subject)}</span>` : ''}
          <span>${icon('clock', 13)} ${fmtMin(s.durationMin)}</span>
          <span>${icon('timer', 13)} ${presetLabel(s.preset)} · ${sum.focusCount} sesi</span>
          ${s.pdfIds?.length ? `<span>${icon('file', 13)} ${s.pdfIds.length} PDF</span>` : ''}
        </div>
        <div class="progress" title="${fmtMin(s.progressMin || 0)} dari ${fmtMin(sum.focusMin)} fokus"><i style="width:${pct}%"></i></div>
      </div>
      <div class="sched-actions">
        <button class="btn btn-primary btn-sm" data-action="start">${icon(active ? 'timer' : 'play', 14)} ${startLabel}</button>
        <button class="icon-btn" data-action="edit" aria-label="Edit">${icon('edit', 16)}</button>
        <button class="icon-btn" data-action="delete" aria-label="Hapus">${icon('trash', 16)}</button>
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
      if (getTimer()?.scheduleId === id) return toast('Hentikan sesi yang berjalan dulu');
      if (await confirmDialog(`Hapus jadwal "${s.title}"?`, { okText: 'Hapus', danger: true })) {
        deleteSchedule(id);
        toast('Jadwal dihapus');
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
  const subjects = [...new Set(getSchedules().map((x) => x.subject).filter(Boolean))];
  const custom = s.preset.key === 'custom' ? s.preset : { focus: 30, short: 5, long: 15, longEvery: 4 };

  const form = document.createElement('form');
  form.className = 'form';
  form.innerHTML = `
    <label class="field">
      <span>Judul</span>
      <input name="title" required maxlength="80" placeholder="mis. Latihan soal termodinamika" value="${esc(s.title)}" />
    </label>
    <div class="row">
      <label class="field">
        <span>Mata pelajaran</span>
        <input name="subject" list="subject-list" maxlength="40" placeholder="mis. Fisika" value="${esc(s.subject)}" />
        <datalist id="subject-list">${subjects.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      </label>
    </div>
    <div class="row">
      <label class="field"><span>Tanggal</span><input type="date" name="date" required value="${s.date}" /></label>
      <label class="field"><span>Jam mulai</span><input type="time" name="startTime" required value="${s.startTime}" /></label>
    </div>
    <div class="field">
      <span>Durasi</span>
      <div data-duration></div>
    </div>
    <div class="field">
      <span>Preset pomodoro</span>
      <div class="segmented" role="radiogroup">
        ${Object.entries(PRESETS)
          .map(([k, p]) => `<label><input type="radio" name="preset" value="${k}" ${s.preset.key === k ? 'checked' : ''} /><span>${p.label}</span></label>`)
          .join('')}
        <label><input type="radio" name="preset" value="custom" ${s.preset.key === 'custom' ? 'checked' : ''} /><span>Custom</span></label>
      </div>
      <div class="custom-preset" ${s.preset.key === 'custom' ? '' : 'hidden'}>

      </div>
    </div>
    <div class="plan-preview" aria-live="polite"></div>
    <div class="field">
      <span>Referensi PDF</span>
      ${
        pdfs.length
          ? `<div class="pdf-pick">${pdfs
              .map(
                (p) => `<label class="check"><input type="checkbox" name="pdf" value="${p.id}" ${s.pdfIds?.includes(p.id) ? 'checked' : ''} />
                  ${icon('file', 14)}<span>${esc(p.name)}</span></label>`,
              )
              .join('')}</div>`
          : `<p class="muted small">Belum ada PDF. Upload dulu di <a href="#/library">Library</a>.</p>`
      }
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Batal</button>
      <button type="submit" class="btn" data-mode="save">Simpan</button>
      <button type="submit" class="btn btn-primary" data-mode="start">${icon('play', 14)} Simpan & mulai</button>
    </div>`;

  const duration = createDurationPicker({ value: s.durationMin, min: 5, max: 720, presets: [30, 60, 120, 180, 240] });
  form.querySelector('[data-duration]').append(duration.el);
  form.querySelector('.custom-preset').append(
    createStepper({ name: 'c_focus', label: 'Fokus', value: custom.focus, min: 5, max: 240, step: 5 }).el,
    createStepper({ name: 'c_short', label: 'Istirahat', value: custom.short, min: 1, max: 60 }).el,
    createStepper({ name: 'c_long', label: 'Ist. panjang', value: custom.long, min: 1, max: 90 }).el,
    createStepper({ name: 'c_longEvery', label: 'Panjang tiap', value: custom.longEvery, min: 1, max: 12, unit: 'sesi' }).el,
  );

  const modal = openModal({ title: existing ? 'Edit jadwal' : 'Jadwal baru', content: form, wide: true });
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

  const preview = form.querySelector('.plan-preview');
  const updatePreview = () => {
    const { durationMin, preset } = read();
    form.querySelector('.custom-preset').hidden = preset.key !== 'custom';
    const plan = buildPlan(durationMin, preset);
    const sum = planSummary(plan);
    preview.innerHTML = `
      <div class="plan-head">
        <span>Pembagian otomatis untuk <strong>${fmtMin(durationMin)}</strong>${$('startTime').value ? ` · selesai pukul <strong>${addMinutesToTime($('startTime').value, durationMin)}</strong>` : ''}</span>
        <span class="muted small">${sum.focusCount} sesi fokus · ${fmtMin(sum.focusMin)} fokus · ${fmtMin(sum.breakMin)} istirahat</span>
      </div>
      ${segmentBar(plan)}
      <div class="plan-legend"><span class="lg lg-focus">Fokus</span><span class="lg lg-short">Istirahat</span><span class="lg lg-long">Istirahat panjang</span></div>`;
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
      subject: $('subject').value.trim(),
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
    else toast(existing ? 'Jadwal diperbarui' : 'Jadwal ditambahkan');
  });
}

// ---------------------------------------------------------------- View

const FILTERS = { upcoming: 'Mendatang', today: 'Hari ini', done: 'Selesai', all: 'Semua' };

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
          <h1>Jadwal</h1>
          <p class="muted">Atur durasinya, pomodoro akan dibagi otomatis.</p>
        </div>
        <button class="btn btn-primary" data-new>${icon('plus', 16)} Jadwal baru</button>
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
                <p>Belum ada jadwal di sini.</p>
                <button class="btn" data-new>${icon('plus', 16)} Buat jadwal pertama</button>
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
