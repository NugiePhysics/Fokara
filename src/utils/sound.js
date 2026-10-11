// AudioContext bersama untuk chime & suara ambient.
let ctx;

export function audioCtx() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const CHIMES = {
  focus: [523.25, 659.25, 783.99],
  break: [783.99, 659.25, 523.25],
  done: [523.25, 659.25, 783.99, 1046.5],
};

export function chime(kind = 'focus') {
  try {
    const c = audioCtx();
    const t0 = c.currentTime + 0.05;
    CHIMES[kind].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const t = t0 + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 1.05);
    });
  } catch {
    /* audio tidak tersedia */
  }
}

// Bunyi "klik" mekanis untuk slider. `level` 0..1 menaikkan nada sedikit;
// `strong` untuk kelipatan jam. Dibatasi agar geseran cepat tidak menumpuk.
let lastTick = 0;
export function tick({ level = 0.5, strong = false } = {}) {
  try {
    // Pakai jam dinding: currentTime diam di 0 selama AudioContext masih suspended.
    const wall = performance.now();
    if (wall - lastTick < 28) return;
    lastTick = wall;
    const c = audioCtx();
    const now = c.currentTime;
    const pitch = 0.85 + level * 0.35;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime((strong ? 1300 : 2000) * pitch, now);
    osc.frequency.exponentialRampToValueAtTime((strong ? 520 : 900) * pitch, now + 0.035);
    filter.type = 'highpass';
    filter.frequency.value = 300;
    gain.gain.setValueAtTime(strong ? 0.14 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (strong ? 0.09 : 0.045));
    osc.connect(filter).connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    /* audio tidak tersedia */
  }
}
