// Synthesised engine + wind. Created lazily on the first key press (browser autoplay rules).
export function createAudio() {
  let ctx = null, noiseBuf = null, master, oscA, oscB, filter, engGain, windGain, windFilter, sirenGain;
  let muted = false;

  function start() {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.5;
    engGain = ctx.createGain();
    engGain.gain.value = 0;
    oscA = ctx.createOscillator(); oscA.type = 'sawtooth';
    oscB = ctx.createOscillator(); oscB.type = 'square';
    const subGain = ctx.createGain(); subGain.gain.value = 0.5;
    oscA.connect(filter); oscB.connect(subGain).connect(filter);
    filter.connect(engGain).connect(master);
    oscA.start(); oscB.start();

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    noise.connect(windFilter).connect(windGain).connect(master);
    noise.start();

    // police siren: a wailing tone, silent until a cop gives chase
    const wail = ctx.createOscillator(); wail.type = 'triangle'; wail.frequency.value = 780;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1.6;
    const depth = ctx.createGain(); depth.gain.value = 190;
    lfo.connect(depth).connect(wail.frequency);
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    wail.connect(sirenGain).connect(master);
    wail.start(); lfo.start();
  }

  return {
    start,
    /** Impact thump + crack. strength 0..1; miss = airy whoosh only. */
    hit(strength, miss = false) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = miss ? 'bandpass' : 'lowpass';
      f.frequency.setValueAtTime(miss ? 900 : 2600, t);
      f.frequency.exponentialRampToValueAtTime(miss ? 300 : 500, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime((miss ? 0.12 : 0.5) * (0.5 + strength), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (miss ? 0.2 : 0.16));
      n.connect(f).connect(g).connect(master);
      n.start(t, Math.random());
      n.stop(t + 0.25);
      if (miss) return;
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      og.gain.setValueAtTime(0.7 * (0.4 + strength), t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(og).connect(master);
      o.start(t);
      o.stop(t + 0.25);
    },
    toggleMute() {
      muted = !muted;
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.03);
      return muted;
    },
    /** rpm 0..1, throttle 0..1, speed 0..1, active = engine audible, siren 0..1 = police closeness */
    update(rpm, throttle, speed, active, siren = 0) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const f = 48 + rpm * 190;
      oscA.frequency.setTargetAtTime(f, t, 0.03);
      oscB.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      filter.frequency.setTargetAtTime(350 + rpm * 1500 + throttle * 1400, t, 0.05);
      engGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.13 : 0, t, 0.08);
      windFilter.frequency.setTargetAtTime(400 + speed * 1400, t, 0.1);
      windGain.gain.setTargetAtTime(active ? speed * speed * 0.35 : 0, t, 0.1);
      sirenGain.gain.setTargetAtTime(active ? siren * 0.16 : 0, t, 0.15);
    },
  };
}
