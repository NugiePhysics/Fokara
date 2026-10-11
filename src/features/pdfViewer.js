// Viewer PDF berbasis pdf.js: scroll kontinu, zoom, ingat halaman terakhir, dan cover.
import { dbGet, dbPut } from '../db.js';
import { load, save } from '../store.js';
import { icon } from '../ui.js';

let pdfjsPromise;
function getPdfjs() {
  pdfjsPromise ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjsPromise;
}

export const getLastPage = (id) => load('pdfPages', {})[id] || 1;
const setLastPage = (id, page) => save('pdfPages', { ...load('pdfPages', {}), [id]: page });

// ---------------------------------------------------------------- Cover

const thumbJobs = new Map();

/** Kembalikan Blob gambar cover (halaman 1), dibuat sekali lalu disimpan di IndexedDB. */
export function getThumbnail(pdfId) {
  if (!thumbJobs.has(pdfId)) {
    const job = (async () => {
      const cached = await dbGet('thumbs', pdfId);
      if (cached) return cached.blob;
      const record = await dbGet('pdfs', pdfId);
      if (!record) return null;
      const lib = await getPdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await record.blob.arrayBuffer()) }).promise;
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 420 / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
        if (blob) await dbPut('thumbs', { id: pdfId, blob });
        return blob;
      } finally {
        doc.destroy();
      }
    })().catch((err) => {
      console.warn('Gagal membuat cover', err);
      thumbJobs.delete(pdfId);
      return null;
    });
    thumbJobs.set(pdfId, job);
  }
  return thumbJobs.get(pdfId);
}

export function forgetThumbnail(pdfId) {
  thumbJobs.delete(pdfId);
}

// ---------------------------------------------------------------- Viewer

export function createPdfViewer(container, pdfId, { compact = false } = {}) {
  let destroyed = false;
  let doc = null;
  let record = null;
  let zoom = 1;
  let baseSize = { w: 612, h: 792 };
  let current = 1;
  let loaded = false;
  let pages = [];
  let observer;
  let resizeObs;
  let saveTimer;

  container.innerHTML = `
    <div class="pdfv ${compact ? 'pdfv-compact' : ''}">
      <div class="pdfv-toolbar">
        <div class="pdfv-group">
          <button class="icon-btn" data-pv="prev" aria-label="Halaman sebelumnya">${icon('chevL')}</button>
          <span class="pdfv-page"><input type="number" min="1" value="1" aria-label="Nomor halaman" /> / <span data-pv-total>–</span></span>
          <button class="icon-btn" data-pv="next" aria-label="Halaman berikutnya">${icon('chevR')}</button>
        </div>
        <div class="pdfv-group">
          <button class="icon-btn" data-pv="out" aria-label="Perkecil">${icon('zoomOut')}</button>
          <button class="btn btn-ghost btn-sm" data-pv="fit" title="Sesuaikan lebar"><span data-pv-zoom>100%</span></button>
          <button class="icon-btn" data-pv="in" aria-label="Perbesar">${icon('zoomIn')}</button>
          <button class="icon-btn" data-pv="open" aria-label="Buka di tab baru" title="Buka di tab baru">${icon('external')}</button>
        </div>
      </div>
      <div class="pdfv-stage" tabindex="0"><div class="pdfv-loading">Memuat PDF…</div><div class="pdfv-pages"></div></div>
    </div>`;

  const stage = container.querySelector('.pdfv-stage');
  const pagesEl = container.querySelector('.pdfv-pages');
  const pageInput = container.querySelector('.pdfv-page input');

  const scale = () => (Math.max(200, stage.clientWidth - 24) / baseSize.w) * zoom;

  function sizePage(p) {
    const s = scale();
    const size = p.size || baseSize;
    p.el.style.width = `${Math.floor(size.w * s)}px`;
    p.el.style.height = `${Math.floor(size.h * s)}px`;
  }

  function layout() {
    pages.forEach(sizePage);
    container.querySelector('[data-pv-zoom]').textContent = `${Math.round(zoom * 100)}%`;
  }

  function clearPage(p) {
    p.task?.cancel();
    p.task = null;
    p.el.querySelector('canvas')?.remove();
    p.renderedScale = 0;
    p.pendingScale = 0;
  }

  async function renderPage(p) {
    const s = scale();
    if (destroyed || p.renderedScale === s || p.pendingScale === s) return;
    p.pendingScale = s;
    p.task?.cancel();
    try {
      const page = await doc.getPage(p.num);
      if (destroyed || p.pendingScale !== s) return;
      const base = page.getViewport({ scale: 1 });
      p.size = { w: base.width, h: base.height };
      sizePage(p);
      const viewport = page.getViewport({ scale: s });
      const dpr = window.devicePixelRatio || 1;
      // Canvas baru per render: pdf.js menolak dua render bersamaan di canvas yang sama.
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      p.task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await p.task.promise;
      if (destroyed || p.pendingScale !== s) return;
      p.el.querySelector('canvas')?.remove();
      p.el.append(canvas);
      p.renderedScale = s;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.error(err);
    } finally {
      if (p.pendingScale === s) p.pendingScale = 0;
    }
  }

  function observeAll() {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = pages[Number(e.target.dataset.page) - 1];
          if (e.isIntersecting) renderPage(p);
          else if (p.renderedScale || p.pendingScale) clearPage(p);
        }
      },
      { root: stage, rootMargin: '1200px 0px' },
    );
    pages.forEach((p) => observer.observe(p.el));
  }

  // .pdfv-stage diberi position:relative sehingga offsetTop halaman = posisi scroll-nya.
  function pageFromScroll() {
    const line = stage.scrollTop + stage.clientHeight * 0.35;
    let found = 1;
    for (const p of pages) {
      if (p.el.offsetTop > line) break;
      found = p.num;
    }
    return found;
  }

  function setCurrent(n) {
    if (n === current) return;
    current = n;
    pageInput.value = n;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setLastPage(pdfId, current), 400);
  }

  let scrollRaf = 0;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      setCurrent(pageFromScroll());
    });
  };

  function scrollToPage(n, smooth = true) {
    if (!pages.length) return;
    const target = pages[Math.min(pages.length, Math.max(1, n)) - 1];
    stage.scrollTo({ top: target.el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
    setCurrent(target.num);
  }

  function setZoom(z) {
    const ratio = stage.scrollTop / Math.max(1, stage.scrollHeight);
    zoom = Math.min(4, Math.max(0.4, Math.round(z * 10) / 10));
    layout();
    stage.scrollTop = ratio * stage.scrollHeight;
    observeAll();
  }

  const onClick = (e) => {
    const act = e.target.closest('[data-pv]')?.dataset.pv;
    if (act === 'prev') scrollToPage(current - 1);
    if (act === 'next') scrollToPage(current + 1);
    if (act === 'in') setZoom(zoom + 0.2);
    if (act === 'out') setZoom(zoom - 0.2);
    if (act === 'fit') setZoom(1);
    if (act === 'open' && record) {
      const url = URL.createObjectURL(record.blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') scrollToPage(current + 1);
    if (e.key === 'ArrowLeft') scrollToPage(current - 1);
  };
  container.addEventListener('click', onClick);
  stage.addEventListener('keydown', onKey);
  stage.addEventListener('scroll', onScroll, { passive: true });
  pageInput.addEventListener('change', () => scrollToPage(Number(pageInput.value) || 1));

  (async () => {
    try {
      record = await dbGet('pdfs', pdfId);
      if (!record) throw new Error('PDF tidak ditemukan');
      const lib = await getPdfjs();
      const data = new Uint8Array(await record.blob.arrayBuffer());
      if (destroyed) return;
      doc = await lib.getDocument({ data }).promise;
      if (destroyed) return doc.destroy();
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      baseSize = { w: first.width, h: first.height };
      container.querySelector('[data-pv-total]').textContent = doc.numPages;
      pageInput.max = doc.numPages;
      container.querySelector('.pdfv-loading')?.remove();

      const frag = document.createDocumentFragment();
      pages = Array.from({ length: doc.numPages }, (_, i) => {
        const el = document.createElement('div');
        el.className = 'pdfv-pagebox';
        el.dataset.page = i + 1;
        frag.append(el);
        return { num: i + 1, el, size: null, renderedScale: 0, pendingScale: 0, task: null };
      });
      pagesEl.append(frag);
      layout();
      const last = Math.min(doc.numPages, getLastPage(pdfId));
      current = 0;
      scrollToPage(last, false);
      observeAll();
      loaded = true;

      let lastWidth = stage.clientWidth;
      let timer;
      resizeObs = new ResizeObserver(() => {
        if (Math.abs(stage.clientWidth - lastWidth) < 8) return;
        lastWidth = stage.clientWidth;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const keep = current;
          layout();
          scrollToPage(keep, false);
          observeAll();
        }, 150);
      });
      resizeObs.observe(stage);
    } catch (err) {
      console.error(err);
      const loading = container.querySelector('.pdfv-loading');
      if (loading) loading.textContent = `Gagal membuka PDF: ${err.message}`;
    }
  })();

  return {
    destroy() {
      destroyed = true;
      clearTimeout(saveTimer);
      if (loaded) setLastPage(pdfId, current);
      observer?.disconnect();
      resizeObs?.disconnect();
      pages.forEach((p) => p.task?.cancel());
      container.removeEventListener('click', onClick);
      doc?.destroy();
    },
  };
}
