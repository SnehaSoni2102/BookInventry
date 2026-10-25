let ctx: AudioContext | null = null;

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.08) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio is a nicety; never break a scan because of it */
  }
}

/** Short success beep / error buzz, plus haptics where the device has them. */
export const feedback = {
  success() {
    tone(1200, 80);
    navigator.vibrate?.(30);
  },
  error() {
    tone(180, 260, 'sawtooth', 0.1);
    navigator.vibrate?.([60, 40, 60]);
  },
};
