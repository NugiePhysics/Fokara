// Tampilan Focus: ring timer, kontrol, timeline segmen, dan panel PDF.
import { load, save, on } from '../store.js';
import { dbAll } from '../db.js';
import { icon, esc } from '../ui.js';
import { fmtClock, fmtMin, dateKey } from '../utils/time.js';
import {
  getTimer, currentSegment, remainingMs, segmentProgress, sessionElapsedMin, planSummary,
  segmentBar, toggle, skip, stopSession, resetSegment, startSession, buildPlan, makePreset, PRESETS, SEGMENT_LABEL,
} from './pomodoro.js';
import { getSchedule, schedulesOn, scheduleItem, bindScheduleActions } from './schedule.js';
import { createPdfViewer, getLastPage } from './pdfViewer.js';
import { createDurationPicker } from './timePicker.js';
import { openWallpaperPicker } from './wallpaper.js';
import { toggleFullscreen, isFullscreen } from '../utils/fullscreen.js';
import { setTempSidebarHidden } from '../utils/sidebar.js';

const R = 130;
const CIRC = 2 * Math.PI * R;

let lastCompleted = null;
on('timer:complete', (s) => (lastCompleted = s));
on('timer:start', () => (lastCompleted = null));

// Panel PDF opsional: 'closed' (default) | 'open' | 'min' (diminimize jadi dock kecil).
const PANEL_STATES = ['closed', 'open', 'min'];
const panelState = () => {
  const v = load('focusPanel', 'closed');
  return PANEL_STATES.includes(v) ? v : 'closed';
};

const toolButtons = ({ pdf = true } = {}) => `
  <div class="focus-tools">
    <button class="icon-btn" data-act="wallpaper" aria-label="Wallpaper" title="Wallpaper">${icon('image')}</button>
    ${pdf ? `<button class="icon-btn ${panelState() !== 'closed' ? 'on' : ''}" data-act="pdf" aria-label="Referensi PDF" title="Referensi PDF">${icon('book')}</button>` : ''}
    <button class="icon-btn" data-act="fullscreen" aria-label="Layar penuh" title="Layar penuh (F)">${icon(isFullscreen() ? 'shrink' : 'maximize')}</button>
  </div>`;

export function renderFocus(el) {
  let viewer = null;
  let viewerPdfId = null;
  let mainKey = '';
  let panelDrawn = false;
  let quickDuration = null;
  let pdfNames = {};
  const cleanups = [];

  const destroyViewer = () => {
    viewer?.destroy();
    viewer = null;
    viewerPdfId = null;
    panelDrawn = false;
  };

  const draw = () => {
    const t = getTimer();
    destroyViewer();
    mainKey = '';
    if (!t) {
      drawIdle();
      return syncReading();
    }
    const state = panelState();
    el.innerHTML = `
      <div class="focus-layout pdf-${state}">
        <section class="focus-main card"></section>
        <aside class="focus-panel card"></aside>
        <div class="pdf-dock" role="group" aria-label="PDF diminimize">
          <button class="dock-open" data-act="pdf-restore" title="Buka lagi">${icon('book', 16)}<span data-dock-label>Referensi PDF</span></button>
          <button class="icon-btn sm" data-act="pdf-close" aria-label="Tutup PDF">${icon('x', 14)}</button>
        </div>
      </div>`;
    drawMain();
    if (state !== 'closed') drawPanel();
    syncReading();
  };

  // ---- Mode baca: PDF terbuka saat sesi berjalan → sidebar disembunyikan sementara,
  // timer jadi ringkas & melayang, PDF melebar ±3/4 layar.
  const isReading = () => !!getTimer() && panelState() === 'open';

  const syncReading = () => {
    const reading = !!el.querySelector('.focus-layout') && isReading();
    if (reading) document.documentElement.dataset.reading = 'on';
    else delete document.documentElement.dataset.reading;
    setTempSidebarHidden(reading);
    applyPos();
  };

  // ---- Timer bisa digeser; posisi disimpan terpisah untuk mode normal & mode baca.
  const posKey = () => (isReading() ? 'timerPosReading' : 'timerPos');

  const clampMain = (main) => {
    const r = main.getBoundingClientRect();
    const x = Math.round(Math.min(Math.max(8, r.left), window.innerWidth - r.width - 8));
    const y = Math.round(Math.min(Math.max(8, r.top), window.innerHeight - Math.min(r.height, window.innerHeight - 16) - 8));
    main.style.left = `${x}px`;
    main.style.top = `${y}px`;
    return { x, y };
  };

  const applyPos = () => {
    const main = el.querySelector('.focus-main');
    if (!main) return;
    const pos = load(posKey(), null);
    main.classList.toggle('is-floating', !!pos || isReading());
    main.classList.toggle('is-moved', !!pos);
    if (pos) {
      main.style.right = main.style.bottom = 'auto';
      main.style.left = `${pos.x}px`;
      main.style.top = `${pos.y}px`;
      clampMain(main);
    } else {
      main.style.left = main.style.top = main.style.right = main.style.bottom = '';
    }
  };

  let drag = null;
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    const main = el.querySelector('.focus-main');
    if (!main) return;
    main.classList.remove('dragging');
    save(posKey(), clampMain(main));
    main.classList.add('is-moved');
  };
  const onPointerDown = (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle || e.button !== 0 || e.target.closest('button, a, input, select')) return;
    const main = el.querySelector('.focus-main');
    const before = main.getBoundingClientRect();
    main.classList.add('is-floating', 'dragging');
    main.style.right = main.style.bottom = 'auto';
    const width = main.getBoundingClientRect().width;
    drag = { dx: Math.min(e.clientX - before.left, width - 24), dy: Math.min(e.clientY - before.top, 48) };
    main.style.left = `${e.clientX - drag.dx}px`;
    main.style.top = `${e.clientY - drag.dy}px`;
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    if (e.buttons === 0) return endDrag();
    const main = el.querySelector('.focus-main');
    main.style.left = `${e.clientX - drag.dx}px`;
    main.style.top = `${e.clientY - drag.dy}px`;
    clampMain(main);
  };
  const onDblClick = (e) => {
    if (!e.target.closest('[data-drag]') || e.target.closest('button')) return;
    save(posKey(), null);
    applyPos();
  };
  const onResize = () => {
    const main = el.querySelector('.focus-main.is-moved');
    if (main) clampMain(main);
  };

  const setPanel = (next) => {
    save('focusPanel', next);
    const layout = el.querySelector('.focus-layout');
    if (!layout) return;
    layout.classList.remove(...PANEL_STATES.map((x) => `pdf-${x}`));
    layout.classList.add(`pdf-${next}`);
    el.querySelector('[data-act=pdf]')?.classList.toggle('on', next !== 'closed');
    if (next === 'closed') {
      destroyViewer();
      el.querySelector('.focus-panel').innerHTML = '';
    } else if (!panelDrawn) drawPanel();
    if (next === 'min') updateDock();
    syncReading();
  };

  const updateDock = () => {
    const label = el.querySelector('[data-dock-label]');
    if (!label) return;
    label.textContent = viewerPdfId ? `${pdfNames[viewerPdfId] || 'PDF'} · hal. ${getLastPage(viewerPdfId)}` : 'Referensi PDF';
  };

  // ---- Timer aktif
  const drawMain = () => {
    const t = getTimer();
    const main = el.querySelector('.focus-main');
    if (!t || !main) return;
    const seg = currentSegment();
    const key = `${t.index}-${t.running}`;
    if (key === mainKey) return updateLive();
    mainKey = key;
    const sum = planSummary(t.plan);
    const focusIdx = t.plan.slice(0, t.index + 1).filter((s) => s.type === 'focus').length;
    el.querySelector('.focus-layout').dataset.mode = seg.type === 'focus' ? 'focus' : 'break';
    main.innerHTML = `
      <div class="focus-head" data-drag title="Seret untuk memindahkan · klik dua kali untuk kembali ke posisi awal">
        <div class="focus-title">
          <p class="eyebrow"><span class="drag-grip">${icon('grip', 12)}</span>${t.subject ? esc(t.subject) : 'Sesi belajar'}</p>
          <h2>${esc(t.title)}</h2>
        </div>
        ${toolButtons()}
      </div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 300 300" aria-hidden="true">
          <circle cx="150" cy="150" r="${R}" class="ring-track" />
          <circle cx="150" cy="150" r="${R}" class="ring-fill" stroke-dasharray="${CIRC}" transform="rotate(-90 150 150)" />
        </svg>
        <div class="ring-center">
          <span class="ring-label">${SEGMENT_LABEL[seg.type]}</span>
          <span class="ring-time" data-live="time">${fmtClock(remainingMs())}</span>
          <span class="ring-sub">${seg.type === 'focus' ? `Fokus ${focusIdx} dari ${sum.focusCount}` : `Berikutnya: fokus ${focusIdx + 1}`}</span>
        </div>
      </div>
      <div class="controls">
        <button class="icon-btn lg" data-act="reset" title="Ulang segmen" aria-label="Ulang segmen">${icon('reset', 20)}</button>
        <button class="play-btn" data-act="toggle" aria-label="${t.running ? 'Jeda' : 'Lanjut'}">${icon(t.running ? 'pause' : 'play', 28)}</button>
        <button class="icon-btn lg" data-act="skip" title="Lewati (N)" aria-label="Lewati segmen">${icon('skip', 20)}</button>
      </div>
      <div class="timeline">
        <div data-live="bar">${segmentBar(t.plan, t.index, segmentProgress())}</div>
        <div class="timeline-meta">
          <span data-live="elapsed">${fmtMin(sessionElapsedMin())} / ${fmtMin(sum.totalMin)}</span>
          <span>Segmen ${t.index + 1} dari ${t.plan.length}</span>
        </div>
      </div>
      <div class="focus-foot">
        <span class="muted small"><kbd>Space</kbd> jeda · <kbd>N</kbd> lewati</span>
        <button class="btn btn-ghost btn-sm" data-act="stop">${icon('stop', 14)} Hentikan sesi</button>
      </div>`;
    updateLive();
  };

  const updateLive = () => {
    const t = getTimer();
    if (!t) return;
    const time = el.querySelector('[data-live=time]');
    if (!time) return;
    time.textContent = fmtClock(remainingMs());
    el.querySelector('.ring-fill').style.strokeDashoffset = String(CIRC * segmentProgress());
    const fill = el.querySelector('.seg.current > i');
    if (fill) fill.style.width = `${(segmentProgress() * 100).toFixed(2)}%`;
    el.querySelector('[data-live=elapsed]').textContent = `${fmtMin(sessionElapsedMin())} / ${fmtMin(planSummary(t.plan).totalMin)}`;
  };

  // ---- Panel PDF
  const drawPanel = async () => {
    const panel = el.querySelector('.focus-panel');
    if (!panel || panelDrawn) return;
    panelDrawn = true;
    const t = getTimer();
    const all = (await dbAll('pdfs')).sort((a, b) => b.addedAt - a.addedAt);
    if (!el.contains(panel)) return;
    pdfNames = Object.fromEntries(all.map((p) => [p.id, p.name]));
    const panelActions = `
      <div class="panel-actions">
        <button class="icon-btn sm" data-act="pdf-min" aria-label="Minimize PDF" title="Minimize">${icon('minus', 16)}</button>
        <button class="icon-btn sm" data-act="pdf-close" aria-label="Tutup PDF" title="Tutup">${icon('x', 16)}</button>
      </div>`;
    const linkedIds = (t?.scheduleId && getSchedule(t.scheduleId)?.pdfIds) || [];
    const linked = all.filter((p) => linkedIds.includes(p.id));
    const saved = load('focusPdf', null);
    let current = linked[0]?.id;
    if (saved && all.some((p) => p.id === saved) && (!linked.length || linkedIds.includes(saved))) current = saved;
    current ||= all[0]?.id;

    if (!all.length) {
      panel.innerHTML = `<div class="panel-head"><span class="muted small">Referensi PDF</span>${panelActions}</div><div class="empty">
        <div class="empty-icon">${icon('book', 28)}</div>
        <p>Belum ada referensi PDF.</p>
        <a class="btn" href="#/library">${icon('upload', 16)} Upload PDF</a></div>`;
      return;
    }
    const tabs = linked.length ? linked : [];
    panel.innerHTML = `
      <div class="panel-head">
        <div class="pdf-tabs">
          ${tabs.map((p) => `<button class="pdf-tab ${p.id === current ? 'active' : ''}" data-pdf="${p.id}" title="${esc(p.name)}">${icon('file', 13)}<span>${esc(p.name)}</span></button>`).join('')}
        </div>
        <select class="select-sm" data-pdf-select aria-label="Pilih PDF">
          <option value="">${tabs.length ? 'PDF lain…' : 'Pilih PDF…'}</option>
          ${all.map((p) => `<option value="${p.id}" ${!tabs.length && p.id === current ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        ${panelActions}
      </div>
      <div class="panel-viewer"></div>`;
    openPdf(current);
  };

  const openPdf = (id) => {
    if (!id || id === viewerPdfId) return;
    viewer?.destroy();
    viewerPdfId = id;
    save('focusPdf', id);
    el.querySelectorAll('.pdf-tab').forEach((b) => b.classList.toggle('active', b.dataset.pdf === id));
    viewer = createPdfViewer(el.querySelector('.panel-viewer'), id, { compact: true });
    updateDock();
  };

  // ---- Tidak ada timer
  const drawIdle = () => {
    const today = schedulesOn(dateKey()).filter((s) => s.status !== 'done');
    const done = lastCompleted;
    el.innerHTML = `
      ${
        done
          ? `<section class="card done-card">
              <div class="done-emoji">🎉</div>
              <h2>Sesi selesai!</h2>
              <p class="muted">${esc(done.title)} · ${fmtMin(done.focusDoneMin)} fokus dalam ${done.plan.filter((s) => s.type === 'focus').length} sesi pomodoro.</p>
              <div class="row-center"><a class="btn" href="#/tracking">Lihat tracking</a><button class="btn btn-ghost" data-dismiss>Tutup</button></div>
            </section>`
          : ''
      }
      <header class="page-head">
        <div><h1>Focus</h1><p class="muted">Pilih jadwal atau mulai sesi cepat.</p></div>
        ${toolButtons({ pdf: false })}
      </header>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>Jadwal hari ini</h3><a href="#/schedule" class="muted small">Semua jadwal</a></div>
          <div class="sched-list compact">${today.length ? today.map(scheduleItem).join('') : '<p class="muted small">Tidak ada jadwal tersisa hari ini.</p>'}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Sesi cepat</h3></div>
          <form class="form quick-form">
            <label class="field"><span>Judul (opsional)</span><input name="title" maxlength="80" placeholder="Belajar" /></label>
            <div class="field"><span>Durasi</span>
              <div data-duration></div>
            </div>
            <div class="field"><span>Preset</span>
              <div class="segmented">${Object.entries(PRESETS).map(([k, p], i) => `<label><input type="radio" name="preset" value="${k}" ${i === 0 ? 'checked' : ''}/><span>${p.label}</span></label>`).join('')}</div>
            </div>
            <button class="btn btn-primary">${icon('play', 14)} Mulai sekarang</button>
          </form>
        </section>
      </div>`;
    quickDuration = createDurationPicker({ value: load('quickDuration', 60), min: 5, max: 480, presets: [25, 50, 90, 120, 180] });
    el.querySelector('.quick-form [data-duration]').append(quickDuration.el);
  };

  // ---- Event
  const onClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') toggle();
    if (act === 'skip') skip();
    if (act === 'reset') resetSegment();
    if (act === 'stop') stopSession();
    if (act === 'wallpaper') openWallpaperPicker();
    if (act === 'fullscreen') toggleFullscreen();
    if (act === 'pdf') setPanel(panelState() === 'open' ? 'min' : 'open');
    if (act === 'pdf-min') setPanel('min');
    if (act === 'pdf-restore') setPanel('open');
    if (act === 'pdf-close') setPanel('closed');
    const tab = e.target.closest('[data-pdf]');
    if (tab) openPdf(tab.dataset.pdf);
    if (e.target.closest('[data-dismiss]')) {
      lastCompleted = null;
      draw();
    }
  };
  const onChange = (e) => {
    if (e.target.matches('[data-pdf-select]') && e.target.value) openPdf(e.target.value);
  };
  const onSubmit = (e) => {
    if (!e.target.matches('.quick-form')) return;
    e.preventDefault();
    const f = e.target.elements;
    const preset = makePreset(f.preset.value);
    const minutes = quickDuration?.value ?? 60;
    save('quickDuration', minutes);
    startSession({ title: f.title.value.trim() || 'Sesi cepat', plan: buildPlan(minutes, preset) });
  };

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', onDblClick);
  window.addEventListener('resize', onResize);
  cleanups.push(bindScheduleActions(el));
  cleanups.push(
    on('timer', (t) => (t && el.querySelector('.focus-main') ? drawMain() : draw())),
    on('timer:tick', updateLive),
    on('fullscreen', (full) => {
      const btn = el.querySelector('[data-act=fullscreen]');
      if (btn) btn.innerHTML = icon(full ? 'shrink' : 'maximize');
    }),
  );
  draw();

  return () => {
    el.removeEventListener('click', onClick);
    el.removeEventListener('change', onChange);
    el.removeEventListener('submit', onSubmit);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', endDrag);
    el.removeEventListener('pointercancel', endDrag);
    el.removeEventListener('dblclick', onDblClick);
    window.removeEventListener('resize', onResize);
    cleanups.forEach((fn) => fn());
    destroyViewer();
    delete document.documentElement.dataset.reading;
    setTempSidebarHidden(false);
  };
}
