// Sidebar: preferensi tersimpan + penyembunyian sementara (mode baca PDF) yang tidak disimpan.
import { getSettings, updateSettings } from '../store.js';

let tempHidden = false;

function paint() {
  if (getSettings().sidebarHidden || tempHidden) document.documentElement.dataset.sidebar = 'hidden';
  else delete document.documentElement.dataset.sidebar;
}

export function setSidebarHidden(hidden) {
  tempHidden = false; // pilihan manual pengguna mengalahkan mode baca
  updateSettings({ sidebarHidden: hidden });
  paint();
}

export const toggleSidebar = () => setSidebarHidden(document.documentElement.dataset.sidebar !== 'hidden');

export function setTempSidebarHidden(hidden) {
  if (tempHidden === hidden) return;
  tempHidden = hidden;
  paint();
}
