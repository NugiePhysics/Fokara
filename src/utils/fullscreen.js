// Mode layar penuh. Jika Fullscreen API tidak tersedia (mis. iOS Safari),
// pakai "pseudo fullscreen": sembunyikan sidebar lewat CSS saja.
import { emit } from '../store.js';

let pseudo = false;

export const isFullscreen = () => !!document.fullscreenElement || pseudo;

function sync() {
  if (document.fullscreenElement) pseudo = false;
  document.documentElement.classList.toggle('is-fullscreen', isFullscreen());
  emit('fullscreen', isFullscreen());
}

export async function toggleFullscreen() {
  if (isFullscreen()) return exitFullscreen();
  try {
    const req = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Beberapa browser/webview tidak pernah menjawab permintaan; jangan menunggu selamanya.
    const ok = await Promise.race([req.then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 800))]);
    if (ok || document.fullscreenElement) return;
  } catch {
    /* ditolak atau tidak didukung */
  }
  pseudo = true;
  sync();
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (pseudo) {
    pseudo = false;
    sync();
  }
}

export function initFullscreen() {
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pseudo && !document.querySelector('.modal-backdrop')) exitFullscreen();
  });
}
