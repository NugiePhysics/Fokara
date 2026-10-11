import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import { updateSettings, on, emit } from './store.js';
import { icon, isTyping } from './ui.js';
import { t, lang, setLang } from './i18n.js';
import { initTimer, getTimer, toggle, skip } from './features/pomodoro.js';
import { initSchedule, renderSchedule } from './features/schedule.js';
import { initTracking, renderTracking } from './features/tracking.js';
import { renderToday } from './features/today.js';
import { renderFocus } from './features/focus.js';
import { renderLibrary } from './features/library.js';
import { initMusic, toggleMusic } from './features/music.js';
import { initWallpaper } from './features/wallpaper.js';
import { setSidebarHidden, toggleSidebar } from './utils/sidebar.js';
import { initFullscreen, toggleFullscreen, isFullscreen, exitFullscreen } from './utils/fullscreen.js';

const ROUTES = {
  today: { label: t('Today'), icon: 'home', render: renderToday },
  schedule: { label: t('Schedule'), icon: 'calendar', render: renderSchedule },
  focus: { label: t('Focus'), icon: 'timer', render: renderFocus },
  tracking: { label: t('Tracking'), icon: 'chart', render: renderTracking },
  library: { label: t('Library'), icon: 'book', render: renderLibrary },
};

const nav = document.getElementById('nav');
nav.innerHTML = Object.entries(ROUTES)
  .map(([key, r]) => `<a href="#/${key}" data-route="${key}">${icon(r.icon)}<span>${r.label}</span><i class="nav-dot"></i></a>`)
  .join('');

let cleanup = null;
function router() {
  const [name, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES[name] ? name : 'today';
  cleanup?.();
  const view = document.getElementById('view');
  view.className = `view view-${route}`;
  view.innerHTML = '';
  cleanup = ROUTES[route].render(view, params) || null;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  // Layar penuh hanya untuk Focus; keluar otomatis saat pindah halaman.
  if (route !== 'focus' && isFullscreen()) exitFullscreen();
  document.documentElement.dataset.route = route;
  emit('route', route);
  window.scrollTo(0, 0);
}

// Tema
const themeBtn = document.getElementById('theme-toggle');
function paintThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
  themeBtn.title = dark ? t('Light mode') : t('Dark mode');
  themeBtn.setAttribute('aria-label', t('Toggle theme'));
}
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  updateSettings({ theme: next });
  paintThemeButton();
});
paintThemeButton();

// Sidebar bisa disembunyikan (desktop)
const hideBtn = document.getElementById('sidebar-hide');
const showBtn = document.getElementById('sidebar-show');
hideBtn.innerHTML = icon('sidebar');
showBtn.innerHTML = icon('menu');
hideBtn.title = `${t('Hide sidebar')} ( [ )`;
hideBtn.setAttribute('aria-label', t('Hide sidebar'));
showBtn.title = `${t('Show sidebar')} ( [ )`;
showBtn.setAttribute('aria-label', t('Show sidebar'));

// Bahasa: English (default) ↔ Bahasa Indonesia
document.documentElement.lang = lang();
const langBtn = document.getElementById('lang-toggle');
langBtn.textContent = lang().toUpperCase();
langBtn.title = lang() === 'en' ? 'Ganti ke Bahasa Indonesia' : 'Switch to English';
langBtn.setAttribute('aria-label', langBtn.title);
langBtn.addEventListener('click', () => setLang(lang() === 'en' ? 'id' : 'en'));
hideBtn.addEventListener('click', () => setSidebarHidden(true));
showBtn.addEventListener('click', () => setSidebarHidden(false));

// Shortcut keyboard global
document.addEventListener('keydown', (e) => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal-backdrop')) return;
  if (e.code === 'Space' && getTimer()) {
    e.preventDefault();
    toggle();
  } else if (e.key.toLowerCase() === 'n' && getTimer()) skip();
  else if (e.key.toLowerCase() === 'm') toggleMusic();
  else if (e.key === '[') toggleSidebar();
  else if (e.key.toLowerCase() === 'f' && document.documentElement.dataset.route === 'focus') toggleFullscreen();
});

// Titik indikator di menu Focus saat timer berjalan
function paintNavDot() {
  nav.querySelector('[data-route=focus]').classList.toggle('live', !!getTimer());
}

initTracking();
initSchedule();
initTimer();
initMusic();
initWallpaper();
initFullscreen();
paintNavDot();
on('timer', paintNavDot);

window.addEventListener('hashchange', router);
router();
