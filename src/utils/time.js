import { t, locale } from '../i18n.js';

export const pad = (n) => String(n).padStart(2, '0');

export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtMin(min) {
  if (min > 0 && min < 1) return `<${t('{m}m', { m: 1 })}`;
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return t('{m}m', { m });
  return m ? t('{h}h {m}m', { h, m }) : t('{h}h', { h });
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function fmtDate(key, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return parseKey(key).toLocaleDateString(locale(), opts);
}

export function relDayLabel(key) {
  const now = new Date();
  if (key === dateKey(now)) return t('Today');
  if (key === dateKey(addDays(now, 1))) return t('Tomorrow');
  if (key === dateKey(addDays(now, -1))) return t('Yesterday');
  return fmtDate(key);
}

export function addMinutesToTime(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
