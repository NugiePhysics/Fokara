// Library referensi PDF: upload (drag & drop), daftar, buka, hapus.
import { uid, on, emit, load, save } from '../store.js';
import { dbAll, dbPut, dbDelete } from '../db.js';
import { icon, esc, toast, confirmDialog } from '../ui.js';
import { fmtBytes } from '../utils/time.js';
import { createPdfViewer, getLastPage, getThumbnail, forgetThumbnail } from './pdfViewer.js';
import { getSchedules } from './schedule.js';

export async function addPdfFiles(files) {
  const pdfs = [...files].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) return toast('Hanya file PDF yang didukung', { type: 'error' });
  navigator.storage?.persist?.().catch(() => {});
  let added = 0;
  for (const file of pdfs) {
    try {
      await dbPut('pdfs', { id: uid(), name: file.name.replace(/\.pdf$/i, ''), size: file.size, addedAt: Date.now(), blob: file });
      added++;
    } catch (err) {
      console.error(err);
      toast(`Gagal menyimpan ${file.name} (penyimpanan penuh?)`, { type: 'error' });
    }
  }
  if (added) {
    toast(`${added} PDF ditambahkan`);
    emit('pdfs:changed');
  }
}

async function removePdf(id) {
  await dbDelete('pdfs', id);
  await dbDelete('thumbs', id).catch(() => {});
  forgetThumbnail(id);
  const pages = load('pdfPages', {});
  delete pages[id];
  save('pdfPages', pages);
  // Lepas tautan dari jadwal.
  const schedules = getSchedules();
  if (schedules.some((s) => s.pdfIds?.includes(id))) {
    save('schedules', schedules.map((s) => ({ ...s, pdfIds: (s.pdfIds || []).filter((x) => x !== id) })));
  }
  emit('pdfs:changed');
}

export function renderLibrary(el, [openId] = []) {
  if (openId) return renderReader(el, openId);
  let urls = [];
  let drawId = 0;

  const releaseUrls = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  };

  // Isi cover satu per satu agar tidak membebani browser saat banyak PDF.
  const fillThumbs = async (id) => {
    for (const box of el.querySelectorAll('[data-thumb]')) {
      const blob = await getThumbnail(box.dataset.thumb);
      if (id !== drawId) return;
      if (!blob || !el.contains(box)) continue;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = new Image();
      img.alt = '';
      img.onload = () => box.classList.add('loaded');
      img.src = url;
      box.prepend(img);
    }
  };

  const draw = async () => {
    const id = ++drawId;
    const pdfs = (await dbAll('pdfs')).sort((a, b) => b.addedAt - a.addedAt);
    if (id !== drawId) return;
    releaseUrls();
    const usage = await navigator.storage?.estimate?.().catch(() => null);
    el.innerHTML = `
      <header class="page-head">
        <div><h1>Library</h1><p class="muted">Referensi PDF tersimpan di browser ini dan bisa dibuka saat fokus.</p></div>
      </header>
      <label class="dropzone" tabindex="0">
        <input type="file" accept="application/pdf,.pdf" multiple hidden />
        <div class="empty-icon">${icon('upload', 24)}</div>
        <strong>Seret PDF ke sini</strong>
        <span class="muted small">atau klik untuk memilih file</span>
      </label>
      ${
        pdfs.length
          ? `<div class="pdf-grid">${pdfs
              .map(
                (p) => `
            <article class="pdf-card" data-id="${p.id}">
              <a class="pdf-open" href="#/library/${p.id}">
                <div class="pdf-thumb" data-thumb="${p.id}">
                  <div class="pdf-thumb-ph">${icon('file', 30)}<span>PDF</span></div>
                </div>
                <div class="pdf-info">
                  <h4 title="${esc(p.name)}">${esc(p.name)}</h4>
                  <span class="muted small">${fmtBytes(p.size)} · hal. ${getLastPage(p.id)}</span>
                </div>
              </a>
              <button class="icon-btn pdf-del" data-del="${p.id}" aria-label="Hapus ${esc(p.name)}">${icon('trash', 16)}</button>
            </article>`,
              )
              .join('')}</div>`
          : '<p class="muted center small">Belum ada PDF yang diupload.</p>'
      }
      ${usage?.quota ? `<p class="muted small center">Penyimpanan terpakai ${fmtBytes(usage.usage)} dari ${fmtBytes(usage.quota)}</p>` : ''}`;
    fillThumbs(id);
  };

  const onChange = (e) => {
    if (e.target.type === 'file') addPdfFiles(e.target.files);
  };
  const onClick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    e.preventDefault();
    if (await confirmDialog('Hapus PDF ini dari library?', { okText: 'Hapus', danger: true })) {
      await removePdf(del.dataset.del);
      toast('PDF dihapus');
    }
  };
  const onDrag = (e) => {
    const zone = e.target.closest?.('.dropzone');
    if (!zone) return;
    e.preventDefault();
    zone.classList.toggle('over', e.type === 'dragover');
    if (e.type === 'drop') addPdfFiles(e.dataTransfer.files);
  };
  const onKey = (e) => {
    if (e.target.matches('.dropzone') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.target.querySelector('input').click();
    }
  };
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  ['dragover', 'dragleave', 'drop'].forEach((t) => el.addEventListener(t, onDrag));
  const off = on('pdfs:changed', draw);
  draw();
  return () => {
    el.removeEventListener('change', onChange);
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
    ['dragover', 'dragleave', 'drop'].forEach((t) => el.removeEventListener(t, onDrag));
    off();
    drawId++;
    releaseUrls();
  };
}

function renderReader(el, id) {
  el.innerHTML = `
    <div class="reader">
      <header class="reader-head">
        <a href="#/library" class="btn btn-ghost btn-sm">${icon('chevL', 16)} Library</a>
        <h2 class="reader-title">…</h2>
      </header>
      <div class="reader-body card"></div>
    </div>`;
  dbAll('pdfs').then((all) => {
    const p = all.find((x) => x.id === id);
    const title = el.querySelector('.reader-title');
    if (title) title.textContent = p ? p.name : 'PDF tidak ditemukan';
  });
  const viewer = createPdfViewer(el.querySelector('.reader-body'), id);
  return () => viewer.destroy();
}
