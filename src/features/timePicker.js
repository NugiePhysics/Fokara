// Kontrol waktu minimalis: pemilih durasi (jam : menit) dan stepper angka kecil.
// Keduanya mendukung tahan-untuk-mengulang, roda mouse, keyboard, dan bunyi klik.
import { getSettings, updateSettings } from '../store.js';
import { icon } from '../ui.js';
import { fmtMin } from '../utils/time.js';
import { tick } from '../utils/sound.js';
import { t } from '../i18n.js';

const soundOn = () => getSettings().sliderSound !== false;

const roller = () =>
  `<span class="roll"><span class="roll-strip">${[...'0123456789'].map((d) => `<span>${d}</span>`).join('')}</span></span>`;

function setRollers(container, text) {
  container.querySelectorAll('.roll-strip').forEach((strip, i) => {
    strip.style.transform = `translateY(${-Number(text[i])}em)`;
  });
}

function shake(node) {
  node.classList.remove('shake');
  void node.offsetWidth;
  node.classList.add('shake');
}

/**
 * Tahan tombol [data-dir] untuk mengulang (makin lama makin cepat).
 * `onStep(button)` dipanggil untuk tiap langkah; klik keyboard (Enter/Space) juga didukung.
 */
function bindHold(root, onStep) {
  let delay = 0;
  let repeat = 0;
  const stop = () => {
    clearTimeout(delay);
    clearTimeout(repeat);
  };
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-dir]');
    if (!btn || e.button !== 0) return;
    e.preventDefault();
    onStep(btn);
    let interval = 120;
    const loop = () => {
      if (btn.disabled) return stop(); // sudah di batas
      onStep(btn);
      interval = Math.max(40, interval * 0.88);
      repeat = setTimeout(loop, interval);
    };
    delay = setTimeout(loop, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => root.addEventListener(t, stop));
  window.addEventListener('blur', stop, { once: true });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dir]');
    if (btn && e.detail === 0) onStep(btn); // aktivasi lewat keyboard
  });
}

// ---------------------------------------------------------------- Pemilih durasi

export function createDurationPicker({ value = 60, min = 5, max = 480, step = 5, presets = [] } = {}) {
  const snap = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const hourDigits = Math.max(2, String(Math.floor(max / 60)).length);
  let current = snap(value);
  let anim = 0;

  const unit = (key, label, digits, stepLabel) => `
    <div class="tp-unit" data-unit="${key}">
      <button type="button" class="tp-arrow" data-dir="1" data-unit="${key}" aria-label="${t('Add {step}', { step: stepLabel })}">${icon('chevU', 18)}</button>
      <div class="tp-value" tabindex="0" role="spinbutton" aria-label="${label}" data-unit="${key}">
        <span class="tp-num">${Array.from({ length: digits }, roller).join('')}</span>
      </div>
      <button type="button" class="tp-arrow" data-dir="-1" data-unit="${key}" aria-label="${t('Subtract {step}', { step: stepLabel })}">${icon('chevD', 18)}</button>
      <span class="tp-label">${label}</span>
    </div>`;

  const el = document.createElement('div');
  el.className = 'tp';
  el.innerHTML = `
    <button type="button" class="icon-btn sm tp-sound" aria-label="${t('Sound')}"></button>
    <div class="tp-main">
      ${unit('h', t('hours'), hourDigits, t('{n} hour', { n: 1 }))}
      <span class="tp-sep" aria-hidden="true">:</span>
      ${unit('m', t('minutes'), 2, t('{n} minutes', { n: step }))}
    </div>
    ${
      presets.length
        ? `<div class="tp-presets">${presets.map((v) => `<button type="button" class="tp-chip" data-set="${v}">${fmtMin(v)}</button>`).join('')}</div>`
        : ''
    }
    <input type="hidden" data-tp-value />`;

  const hidden = el.querySelector('[data-tp-value]');
  const soundBtn = el.querySelector('.tp-sound');
  const paintSound = () => {
    soundBtn.innerHTML = icon(soundOn() ? 'volume' : 'mute', 14);
    soundBtn.classList.toggle('on', soundOn());
    soundBtn.title = soundOn() ? t('Mute sound') : t('Unmute sound');
  };

  function render(prev) {
    const h = Math.floor(current / 60);
    const m = current % 60;
    const [hUnit, mUnit] = ['h', 'm'].map((k) => el.querySelector(`.tp-unit[data-unit="${k}"]`));
    setRollers(hUnit, String(h).padStart(hourDigits, '0'));
    setRollers(mUnit, String(m).padStart(2, '0'));
    hUnit.classList.toggle('is-zero', h === 0);
    const hv = hUnit.querySelector('.tp-value');
    hv.setAttribute('aria-valuenow', h);
    hv.setAttribute('aria-valuemin', 0);
    hv.setAttribute('aria-valuemax', Math.floor(max / 60));
    const mv = mUnit.querySelector('.tp-value');
    mv.setAttribute('aria-valuenow', m);
    mv.setAttribute('aria-valuetext', t('{m} minutes, total {total}', { m, total: fmtMin(current) }));
    el.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('active', Number(b.dataset.set) === current));
    // Tombol panah redup saat sudah di batas.
    el.querySelectorAll('.tp-arrow').forEach((b) => {
      const size = b.dataset.unit === 'h' ? 60 : step;
      const next = current + Number(b.dataset.dir) * size;
      b.disabled = next < min || next > max;
    });
    if (prev != null && Math.floor(prev / 60) !== h) {
      hUnit.classList.remove('bump');
      void hUnit.offsetWidth;
      hUnit.classList.add('bump');
    }
    hidden.value = current;
  }

  function change(v, { sound = true } = {}) {
    v = snap(v);
    if (v === current) return false;
    const prev = current;
    current = v;
    render(prev);
    if (sound && soundOn()) tick({ level: (v - min) / (max - min), strong: v % 60 === 0 });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function stepUnit(key, dir) {
    cancelAnimationFrame(anim);
    const size = key === 'h' ? 60 : step;
    if (!change(current + dir * size)) shake(el.querySelector(`.tp-unit[data-unit="${key}"]`));
  }

  function animateTo(target) {
    target = snap(target);
    cancelAnimationFrame(anim);
    const from = current;
    const start = performance.now();
    const duration = Math.min(650, 220 + Math.abs(target - from) * 1.4);
    const frame = (t) => {
      const k = Math.min(1, (t - start) / duration);
      change(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }

  bindHold(el, (btn) => stepUnit(btn.dataset.unit, Number(btn.dataset.dir)));

  el.addEventListener('click', (e) => {
    const set = e.target.closest('[data-set]');
    if (set) animateTo(Number(set.dataset.set));
    if (e.target.closest('.tp-sound')) {
      updateSettings({ sliderSound: !soundOn() });
      paintSound();
      if (soundOn()) tick({ level: 0.6, strong: true });
    }
  });
  el.addEventListener('keydown', (e) => {
    const val = e.target.closest('.tp-value');
    if (!val) return;
    const keyMap = { ArrowUp: 1, ArrowDown: -1, PageUp: 1, PageDown: -1 };
    if (!(e.key in keyMap)) return;
    e.preventDefault();
    const key = e.key.startsWith('Page') ? 'h' : val.dataset.unit;
    stepUnit(key, keyMap[e.key]);
  });
  // Roda mouse di atas angka: gulir untuk mengubah nilai.
  let wheelAcc = 0;
  el.addEventListener(
    'wheel',
    (e) => {
      const val = e.target.closest('.tp-unit');
      if (!val) return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) < 40) return;
      stepUnit(val.dataset.unit, wheelAcc < 0 ? 1 : -1);
      wheelAcc = 0;
    },
    { passive: false },
  );

  paintSound();
  render();

  return {
    el,
    get value() {
      return current;
    },
    set(v, animate = true) {
      animate ? animateTo(v) : change(v, { sound: false });
    },
  };
}

// ---------------------------------------------------------------- Stepper kecil

export function createStepper({ name, label, value, min = 1, max = 99, step = 1, unit = t('min') }) {
  let current = Math.min(max, Math.max(min, Number(value) || min));
  const el = document.createElement('div');
  el.className = 'stp';
  el.innerHTML = `
    <span class="stp-label">${label}</span>
    <div class="stp-ctrl">
      <button type="button" class="stp-btn" data-dir="-1" aria-label="${t('Decrease {label}', { label })}">${icon('minus', 14)}</button>
      <span class="stp-val" role="spinbutton" tabindex="0" aria-label="${label}"><b>${current}</b><small>${unit}</small></span>
      <button type="button" class="stp-btn" data-dir="1" aria-label="${t('Increase {label}', { label })}">${icon('plus', 14)}</button>
    </div>
    <input type="hidden" name="${name}" value="${current}" />`;
  const hidden = el.querySelector('input');
  const num = el.querySelector('b');
  const val = el.querySelector('.stp-val');

  const render = () => {
    num.textContent = current;
    hidden.value = current;
    val.setAttribute('aria-valuenow', current);
    el.querySelector('[data-dir="-1"]').disabled = current <= min;
    el.querySelector('[data-dir="1"]').disabled = current >= max;
  };
  const stepBy = (dir) => {
    const next = Math.min(max, Math.max(min, current + dir * step));
    if (next === current) return shake(el.querySelector('.stp-ctrl'));
    current = next;
    render();
    num.classList.remove('pop-up', 'pop-down');
    void num.offsetWidth;
    num.classList.add(dir > 0 ? 'pop-up' : 'pop-down');
    if (soundOn()) tick({ level: (current - min) / Math.max(1, max - min) });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  bindHold(el, (btn) => stepBy(Number(btn.dataset.dir)));
  val.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') stepBy(1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') stepBy(-1);
    else return;
    e.preventDefault();
  });
  render();
  return { el, get value() { return current; } };
}
