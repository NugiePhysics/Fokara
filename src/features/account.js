// Login Google opsional (Supabase) + sinkronisasi data kecil antar perangkat.
// Tanpa VITE_SUPABASE_URL/KEY, modul ini diam dan SDK tidak pernah dimuat.
import { load, save, on, emit } from '../store.js';
import { icon, esc, toast, openModal } from '../ui.js';
import { t, locale } from '../i18n.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = 'user_data';
// Hanya data JSON kecil; PDF, MP3, wallpaper (IndexedDB) tetap di perangkat.
const SYNC_KEYS = ['schedules', 'tracking', 'settings', 'music', 'quickDuration'];
const PUSH_DELAY = 2000;

let supabase = null;
let user = null;
let status = 'idle'; // idle | syncing | error | paused
let pushTimer = null;
let applying = false;

export const accountEnabled = () => !!(URL_ && KEY);
export const getAccount = () => ({ user, status, syncedAt: getSync()?.syncedAt || null });

// { userId, syncedAt, dirty } — syncedAt = updated_at baris cloud yang terakhir dicocokkan.
const getSync = () => load('sync', null);
const setSync = (patch) => save('sync', { ...getSync(), ...patch });

function setStatus(next) {
  status = next;
  emit('account', getAccount());
}

export async function initAccount() {
  if (!accountEnabled()) return;
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(URL_, KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
  });

  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user || null;
    const changed = next?.id !== user?.id;
    user = next;
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') cleanAuthUrl();
    if (changed) {
      emit('account', getAccount());
      // Jangan await panggilan Supabase di dalam callback auth (bisa deadlock).
      if (user) setTimeout(pull, 0);
    }
  });

  for (const key of SYNC_KEYS) on('change:' + key, onLocalChange);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) flush();
  });
}

function cleanAuthUrl() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error_description') || params.get('error');
  if (!params.has('code') && !error) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (error) toast(t('Sign-in failed: {msg}', { msg: error }), { type: 'error' });
}

function onLocalChange() {
  if (applying || !getSync()) return;
  if (!getSync().dirty) setSync({ dirty: true });
  if (!user || status === 'paused') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, PUSH_DELAY);
}

function flush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  return push();
}

const localData = () => Object.fromEntries(SYNC_KEYS.map((k) => [k, load(k, null)]));
const hasLocalData = () => load('schedules', []).length > 0 || Object.keys(load('tracking', {})).length > 0;

async function push() {
  if (!user) return;
  setStatus('syncing');
  const updated_at = new Date().toISOString();
  const { error } = await supabase.from(TABLE).upsert({ user_id: user.id, data: localData(), updated_at });
  if (error) return fail(error);
  setSync({ userId: user.id, syncedAt: updated_at, dirty: false });
  setStatus('idle');
}

function applyRemote(row) {
  applying = true;
  for (const key of SYNC_KEYS) save(key, row.data?.[key] ?? null);
  applying = false;
  setSync({ userId: user.id, syncedAt: row.updated_at, dirty: false });
  // Banyak modul menyimpan state di level modul; reload agar semuanya membaca ulang.
  location.reload();
}

function fail(error) {
  console.warn('[sync]', error);
  setStatus('error');
  toast(t('Sync failed. Your data is still saved on this device.'), { type: 'error' });
}

export async function pull() {
  if (!user) return;
  setStatus('syncing');
  const { data: row, error } = await supabase.from(TABLE).select('data, updated_at').eq('user_id', user.id).maybeSingle();
  if (error) return fail(error);

  const sync = getSync();
  const known = sync?.userId === user.id;
  if (!row) return push(); // akun baru: unggah data perangkat ini
  const remoteNewer = !known || new Date(row.updated_at) > new Date(sync.syncedAt);

  if (!remoteNewer) return sync.dirty ? push() : setStatus('idle');
  // Perangkat ini belum pernah sinkron dan kosong, atau tidak ada perubahan lokal: ambil cloud.
  if ((!known && !hasLocalData()) || (known && !sync.dirty)) return applyRemote(row);

  const choice = await chooseSource(row.updated_at);
  if (choice === 'cloud') applyRemote(row);
  else if (choice === 'local') push();
  else setStatus('paused'); // ditunda; ditanya lagi saat dibuka berikutnya
}

function chooseSource(remoteAt) {
  return new Promise((resolve) => {
    const modal = openModal({
      title: t('Choose which data to keep'),
      content: `<p class="muted">${esc(t('This device and your cloud account both have data (cloud updated {date}). Which one should be kept?', { date: fmtTime(remoteAt) }))}</p>
        <div class="modal-actions">
          <button class="btn" data-local>${icon('upload')}<span>${t("Upload this device's data")}</span></button>
          <button class="btn btn-primary" data-cloud>${icon('cloud')}<span>${t('Use cloud data')}</span></button>
        </div>`,
      onClose: (result) => resolve(result || null),
    });
    modal.body.querySelector('[data-local]').onclick = () => modal.close('local');
    modal.body.querySelector('[data-cloud]').onclick = () => modal.close('cloud');
  });
}

export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) toast(t('Sign-in failed: {msg}', { msg: error.message }), { type: 'error' });
}

export async function signOut() {
  if (pushTimer) await flush();
  await supabase.auth.signOut();
  setStatus('idle');
  toast(t('Signed out. Your data stays on this device.'));
}

const fmtTime = (iso) => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

export function avatarHtml(size = 22) {
  const src = user?.user_metadata?.avatar_url;
  if (!src) return icon('user', size > 24 ? 24 : 18);
  return `<img class="account-avatar" src="${esc(src)}" width="${size}" height="${size}" alt="" referrerpolicy="no-referrer" />`;
}

export function openAccountModal() {
  const modal = openModal({ title: t('Account'), content: '' });
  const paint = () => {
    if (!user) {
      modal.body.innerHTML = `
        <p class="muted">${t('Signing in is optional. Sign in to sync schedules, tracking and settings across devices.')}</p>
        <p class="muted small">${t('PDFs, music files and wallpapers stay on this device.')}</p>
        <div class="modal-actions">
          <button class="btn btn-google" data-signin>${GOOGLE_LOGO}<span>${t('Sign in with Google')}</span></button>
        </div>`;
      modal.body.querySelector('[data-signin]').onclick = signIn;
      return;
    }
    const { syncedAt } = getAccount();
    const name = user.user_metadata?.full_name || user.email;
    const statusText = {
      syncing: t('Syncing…'),
      error: t('Sync failed'),
      paused: t('Sync paused'),
      idle: syncedAt ? t('Last synced {time}', { time: fmtTime(syncedAt) }) : t('Not synced yet'),
    }[status];
    modal.body.innerHTML = `
      <div class="account-card">
        ${avatarHtml(44)}
        <div>
          <strong>${esc(name)}</strong>
          <div class="muted small">${esc(user.email || '')}</div>
          <div class="account-status is-${status}">${icon('cloud', 14)}<span>${esc(statusText)}</span></div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-signout>${icon('logout')}<span>${t('Sign out')}</span></button>
        <button class="btn btn-primary" data-sync ${status === 'syncing' ? 'disabled' : ''}>${icon('reset')}<span>${t('Sync now')}</span></button>
      </div>`;
    modal.body.querySelector('[data-signout]').onclick = async () => {
      await signOut();
      modal.close();
    };
    modal.body.querySelector('[data-sync]').onclick = () => (getSync()?.dirty ? flush() : pull());
  };
  paint();
  const off = on('account', paint);
  // Lepas listener saat modal hilang dari DOM.
  const mo = new MutationObserver(() => {
    if (!modal.el.isConnected) {
      off();
      mo.disconnect();
    }
  });
  mo.observe(document.getElementById('modal-root'), { childList: true });
}

const GOOGLE_LOGO = `<svg class="icon" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
