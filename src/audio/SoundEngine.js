/**
 * SoundEngine.js — Lenguaje Sonoro de Materia (LSM) v3
 *
 * Síntesis perceptual de audio desde propiedades físicas.
 * Aplica correcciones de percepción no-lineal (Stevens 1957,
 * Bujack et al. 2025) para que la materia suene musical, no caótica.
 *
 * Mejoras v3 (Velvet + Bujack):
 *   - Cuantización a escala pentatónica (suena armónico, no random)
 *   - Curva de Stevens para gain (retornos decrecientes)
 *   - Segundo armónico sutil (timbre orgánico)
 *   - Smoothing de frecuencia (sin saltos bruscos)
 *   - Bond flash: convergencia a acorde consonante
 */

const MAX_VOICES    = 12;
const FADE_IN       = 0.12;
const FADE_OUT      = 0.2;
const MIN_FREQ      = 65;    // C2
const MAX_FREQ      = 1760;  // A6
const BOND_BURST_MS = 250;

// ── Escala pentatónica menor (en semitonos desde la raíz) ──────────
// Suena agradable sin importar qué notas se combinen
const PENTATONIC = [0, 3, 5, 7, 10]; // C Eb F G Bb

/**
 * Cuantiza una frecuencia cruda a la nota pentatónica más cercana.
 * Base: A2 = 110 Hz. Cada nota = 110 × 2^(semitono/12).
 */
function quantizeToScale(rawFreq) {
    const BASE = 110; // A2
    // ¿Cuántos semitonos desde la base?
    const semitones = 12 * Math.log2(rawFreq / BASE);
    // Encontrar la nota pentatónica más cercana (en cualquier octava)
    const octave = Math.floor(semitones / 12);
    const inOctave = semitones - octave * 12;
    let bestNote = 0, bestDist = Infinity;
    for (const n of PENTATONIC) {
        const d = Math.abs(inOctave - n);
        if (d < bestDist) { bestDist = d; bestNote = n; }
    }
    const quantized = BASE * Math.pow(2, (octave * 12 + bestNote) / 12);
    return Math.max(MIN_FREQ, Math.min(MAX_FREQ, quantized));
}

/**
 * Pitch desde masa con cuantización pentatónica + micro-detune.
 * H (1u) → nota aguda, U (238u) → nota grave.
 * ±5 cents de detune para que suene vivo, no robótico.
 */
function pitchFromMass(mass) {
    const raw = 880 / Math.sqrt(Math.max(mass, 0.5));
    const quantized = quantizeToScale(raw);
    // Micro-detune: ±5 cents (1 cent = 2^(1/1200))
    const detune = Math.pow(2, (Math.random() - 0.5) * 10 / 1200);
    return quantized * detune;
}

function waveformFromEN(en) {
    if (!en || en <= 0) return 'sine';
    if (en > 2.8) return 'sawtooth';
    if (en > 1.8) return 'triangle';
    return 'sine';
}

/**
 * Gain con curva de Stevens (retornos decrecientes).
 * Stevens 1957: percepción = estímulo^0.3 para loudness.
 * Bujack 2025 Sec.7: aplica cross-modal.
 */
function gainFromIE(ie) {
    const t = Math.max(0, Math.min(1, ((ie || 7) - 3.89) / (24.58 - 3.89)));
    // Stevens power law: exponente ~0.3 para loudness
    const perceptual = Math.pow(t, 0.3);
    return 0.04 + perceptual * 0.14;
}

// ── Voice con armónico ───────────────────────────────────────────────

class Voice {
    constructor(ctx, master) {
        this.ctx = ctx;
        // Oscilador principal
        this.osc = null;
        // Segundo armónico (octava arriba, muy bajito)
        this.osc2 = null;
        this.gain = ctx.createGain();
        this.gain.connect(master);
        this.gain.gain.value = 0;
        this.atomId = -1;
        this.active = false;
        this._base = 0.1;
        this._targetFreq = 0;
    }

    assign(atom) {
        const now = this.ctx.currentTime;
        this.atomId = atom.id;
        this.active = true;

        const freq = pitchFromMass(atom.mass || 1);
        const wave = waveformFromEN(atom.electronegativity || 0);
        this._targetFreq = freq;

        // Oscilador principal
        this.osc = this.ctx.createOscillator();
        this.osc.frequency.value = freq;
        this.osc.type = wave;
        this.osc.connect(this.gain);
        this.osc.start(now);

        // Segundo armónico — octava arriba, -12dB (25% del volumen)
        this.osc2 = this.ctx.createOscillator();
        this.osc2.frequency.value = freq * 2;
        this.osc2.type = 'sine'; // siempre sine para el armónico
        const harm = this.ctx.createGain();
        harm.gain.value = 0.25;
        this.osc2.connect(harm);
        harm.connect(this.gain);
        this.osc2.start(now);
        this._harmGain = harm;

        // Gain con Stevens
        this._base = gainFromIE(atom.meta?.ionization_energy_eV);
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(0, now);
        this.gain.gain.linearRampToValueAtTime(this._base, now + FADE_IN);
    }

    update(dist, radius) {
        if (!this.active) return;
        const vol = Math.max(0, 1 - dist / radius) * this._base;
        this.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
    }

    release() {
        if (!this.active) return;
        const now = this.ctx.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setTargetAtTime(0, now, FADE_OUT);
        const o1 = this.osc, o2 = this.osc2;
        setTimeout(() => {
            try { o1?.stop(); } catch(e) {}
            try { o2?.stop(); } catch(e) {}
        }, FADE_OUT * 5000);
        this.osc = null;
        this.osc2 = null;
        this._harmGain = null;
        this.active = false;
        this.atomId = -1;
    }
}

// ── Engine ───────────────────────────────────────────────────────────

let _ctx = null, _master = null, _voices = [], _enabled = false, _muted = false, _radius = 500;

export const SoundEngine = {

    init(world, camera, opts = {}) {
        _radius = opts.radius || 500;
        console.log('[SoundEngine] 🎧 v3 perceptual (esperando gesto)');
    },

    enable() {
        if (_ctx) { _enabled = true; return; }
        try {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();

            // Compresor suave — evita picos (Velvet: "falta dinámica")
            const compressor = _ctx.createDynamicsCompressor();
            compressor.threshold.value = -20;
            compressor.knee.value = 10;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.15;
            compressor.connect(_ctx.destination);

            _master = _ctx.createGain();
            _master.gain.value = 0.3;
            _master.connect(compressor);

            _voices = [];
            for (let i = 0; i < MAX_VOICES; i++) _voices.push(new Voice(_ctx, _master));
            _enabled = true;
            console.log('[SoundEngine] 🎧 ON — ' + MAX_VOICES + ' voces + compressor');
        } catch (e) {
            console.warn('[SoundEngine] Error:', e);
        }
    },

    disable() {
        _enabled = false;
        for (const v of _voices) v.release();
    },

    toggleMute() {
        if (!_ctx) return false;
        _muted = !_muted;
        _master.gain.setTargetAtTime(_muted ? 0 : 0.3, _ctx.currentTime, 0.1);
        return _muted;
    },

    setVolume(v) {
        if (_master && !_muted) _master.gain.setTargetAtTime(v, _ctx.currentTime, 0.05);
    },

    setRadius(r) { _radius = r; },
    get enabled() { return _enabled; },
    get muted()   { return _muted; },

    tick(nearby) {
        if (!_enabled || !_ctx || _ctx.state === 'suspended') return;

        const limit = Math.min(nearby.length, MAX_VOICES);

        for (let i = 0; i < _voices.length; i++) {
            if (!_voices[i].active) continue;
            let found = false;
            for (let j = 0; j < limit; j++) {
                if (nearby[j].atom.id === _voices[i].atomId) { found = true; break; }
            }
            if (!found) _voices[i].release();
        }

        for (let i = 0; i < limit; i++) {
            const { atom, dist } = nearby[i];
            let voice = null;
            for (let j = 0; j < _voices.length; j++) {
                if (_voices[j].active && _voices[j].atomId === atom.id) { voice = _voices[j]; break; }
            }
            if (voice) { voice.update(dist, _radius); continue; }
            for (let j = 0; j < _voices.length; j++) {
                if (!_voices[j].active) { _voices[j].assign(atom); _voices[j].update(dist, _radius); break; }
            }
        }
    },

    /**
     * Bond flash sonoro perceptual.
     * Los dos tonos convergen a un intervalo consonante (quinta justa)
     * en vez de al promedio — suena como "resolución armónica".
     */
    bondFlash(atomA, atomB) {
        if (!_enabled || !_ctx) return;
        const now = _ctx.currentTime;
        const fA = pitchFromMass(atomA.mass || 1);
        const fB = pitchFromMass(atomB.mass || 1);
        // Converger a quinta justa (ratio 3:2) del tono más grave
        const fLow = Math.min(fA, fB);
        const fTarget1 = fLow;
        const fTarget2 = fLow * 1.5; // quinta justa
        const dur = BOND_BURST_MS / 1000;

        const g = _ctx.createGain();
        // Stevens: gain perceptual con decaimiento exponencial
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        g.connect(_master);

        const oA = _ctx.createOscillator();
        const oB = _ctx.createOscillator();
        oA.frequency.setValueAtTime(fA, now);
        oB.frequency.setValueAtTime(fB, now);
        // Convergen suavemente al acorde consonante
        oA.frequency.exponentialRampToValueAtTime(fTarget1, now + dur * 0.8);
        oB.frequency.exponentialRampToValueAtTime(fTarget2, now + dur * 0.8);
        oA.type = 'sine';
        oB.type = 'triangle'; // segundo tono con timbre diferente
        oA.connect(g);
        oB.connect(g);
        oA.start(now);
        oB.start(now);
        oA.stop(now + dur + 0.05);
        oB.stop(now + dur + 0.05);
    },
};
