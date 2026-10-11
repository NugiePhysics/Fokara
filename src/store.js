// Penyimpanan localStorage + event bus sederhana.
// Prefix lama dipertahankan agar data pengguna tidak hilang setelah ganti nama ke Fokara.
const PREFIX = 'studyplan:';
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(data);
    } catch (err) {
      console.error(`[${event}]`, err);
    }
  });
}

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.warn('Gagal menyimpan', key, err);
  }
  emit('change:' + key, value);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const SETTINGS_DEFAULT = { dailyGoalMin: 120, theme: null };

export function getSettings() {
  return { ...SETTINGS_DEFAULT, ...load('settings', {}) };
}

export function updateSettings(patch) {
  save('settings', { ...getSettings(), ...patch });
}
