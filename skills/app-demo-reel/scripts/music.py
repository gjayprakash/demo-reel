#!/usr/bin/env python3
"""Generate an original, royalty-free instrumental bed for a reel.

    python3 music.py --dur 19.7 --mood upbeat --out music.wav [--bpm 112] [--key C] [--seed 1]

Moods: upbeat (pop pluck + four-on-floor), chill (lo-fi keys + soft beat),
corporate (bright piano-ish arps + light drums), cinematic (pads + pulses, no snare).
The track is exactly --dur seconds long, starts with a 1-bar intro, ends on the tonic
chord and fades out over the last 1.2s. Everything is synthesised here, so there are
no samples and no licensing issues. Prints the beat grid (seconds per beat and bar
start times) so scene cuts and cursor taps can land on beats.
"""
import argparse, json, wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
NOTES = {'C': 0, 'C#': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
MOODS = {
    #            bpm  progression (scale degrees, major key)        arp-div  drums
    'upbeat':    (112, [0, 4, 5, 3], 4, 'four'),     # I V vi IV
    'chill':     (86,  [5, 3, 0, 4], 2, 'lofi'),     # vi IV I V
    'corporate': (104, [0, 5, 3, 4], 4, 'light'),    # I vi IV V
    'cinematic': (92,  [5, 3, 0, 4], 2, 'pulse'),
}
MAJOR = [0, 2, 4, 5, 7, 9, 11]


def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)


def chord(root_midi, degree):
    # triad + 7th built on a scale degree of the major key
    tones = [MAJOR[(degree + k) % 7] + 12 * ((degree + k) // 7) for k in (0, 2, 4, 6)]
    return [root_midi + t for t in tones]


def env(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    e = np.full(n, s, dtype=np.float64)
    a = min(a, n); e[:a] = np.linspace(0, 1, a, endpoint=False)
    dd = min(d, max(0, n - a)); e[a:a + dd] = np.linspace(1, s, dd, endpoint=False)
    rr = min(r, n); e[n - rr:] *= np.linspace(1, 0, rr)
    return e


def osc(f, n, shape='sine', detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    ph = 2 * np.pi * f * (1 + detune) * t + phase
    if shape == 'sine': return np.sin(ph)
    if shape == 'tri': return 2 / np.pi * np.arcsin(np.sin(ph))
    if shape == 'saw':  # band-limited-ish saw: first 8 harmonics
        return sum(np.sin(k * ph) / k for k in range(1, 9)) * 0.6
    raise ValueError(shape)


def lp(x, fc, order=2): return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x)
def hp(x, fc, order=2): return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)


def add(buf, sig, start):
    i = int(start * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig)); buf[i:j] += sig[:j - i]


def kick(): n = int(.35 * SR); t = np.arange(n) / SR; f = 45 + 75 * np.exp(-t * 28); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def snare(rng): n = int(.22 * SR); t = np.arange(n) / SR; return (bp(rng.standard_normal(n), 1500, 7000) * 0.7 + np.sin(2 * np.pi * 185 * t) * 0.5) * np.exp(-t * 22)
def hat(rng, open_=False): n = int((.18 if open_ else .05) * SR); t = np.arange(n) / SR; return hp(rng.standard_normal(n), 7000) * np.exp(-t * (18 if open_ else 70))


def reverb(x, mix=0.22):
    out = x.copy()
    for d, g in ((0.0297, .5), (0.0371, .45), (0.0411, .42), (0.0437, .4), (0.113, .3), (0.17, .22)):
        k = int(d * SR); y = np.zeros_like(x); y[k:] = x[:-k] * g
        out += lp(y, 5000) * mix
    return out


def build(dur, mood, bpm=None, key='C', seed=1):
    rng = np.random.default_rng(seed)
    base_bpm, prog, arp_div, drums = MOODS[mood]
    bpm = bpm or base_bpm
    beat = 60 / bpm; bar = beat * 4
    n = int(dur * SR)
    root = 48 + NOTES[key]  # C3
    pad, bass, arp, drm = (np.zeros(n) for _ in range(4))
    nbars = int(np.ceil(dur / bar)) + 1
    for b in range(nbars):
        t0 = b * bar
        if t0 >= dur: break
        last = t0 + bar >= dur - 0.01
        deg = 0 if last else prog[b % len(prog)]
        ch = chord(root, deg)
        # pad: 4 detuned voices, slow attack, whole bar
        m = int(bar * SR) + int(.4 * SR)
        voice = sum(osc(hz(p + 12), m, 'saw', d) for p in ch[:3] for d in (-.004, .004)) / 6
        add(pad, lp(voice, 1800 if mood != 'cinematic' else 1200) * env(m, .35, .3, .8, .5), t0)
        # bass: root on 8ths (upbeat/corporate) or half notes (chill/cinematic)
        step = beat / 2 if mood in ('upbeat', 'corporate') else beat * 2
        k = 0
        while k * step < bar - 1e-6:
            m2 = int(step * .9 * SR)
            note = ch[0] - 12
            add(bass, (osc(hz(note), m2) + .35 * osc(hz(note) * 2, m2)) * env(m2, .005, .08, .7, .05), t0 + k * step)
            k += 1
        # arp: plucked chord tones, skip in the intro bar for cinematic
        if b > 0 or mood != 'cinematic':
            astep = beat / arp_div
            order = [0, 1, 2, 3, 2, 1, 2, 3]
            for k in range(int(round(bar / astep))):
                p = ch[order[k % len(order)]] + 24
                m3 = int(.28 * SR)
                shape = 'tri' if mood != 'chill' else 'sine'
                add(arp, osc(hz(p), m3, shape) * env(m3, .002, .12, .15, .1) * (1 if k % 2 == 0 else .7), t0 + k * astep)
        # drums (none in intro bar, none in the last bar)
        if b == 0 or last: continue
        for q in range(4):
            tb = t0 + q * beat
            if drums in ('four', 'light', 'pulse') or q in (0, 2): add(drm, kick() * (1 if drums != 'light' else .8), tb)
            if drums in ('four', 'lofi', 'light') and q in (1, 3): add(drm, snare(rng) * (.55 if drums == 'lofi' else .7), tb)
            if drums != 'pulse':
                add(drm, hat(rng) * .35, tb + beat / 2)
                if drums == 'four': add(drm, hat(rng) * .2, tb)
    # sidechain-style pump on pad/bass from the kick grid
    t = np.arange(n) / SR
    pump = 1 - 0.35 * np.exp(-((t % beat) / 0.12)) if drums in ('four', 'pulse') else np.ones(n)
    pump[: int(bar * SR)] = 1
    mix = reverb(pad * .55 * pump + arp * .32) + bass * .5 * pump + drm * .6
    if mood == 'chill':  # lo-fi: gentle low-pass and vinyl hiss
        mix = lp(mix, 6500) + hp(rng.standard_normal(n), 3000) * .004
    fade = int(1.2 * SR); mix[-fade:] *= np.linspace(1, 0, fade) ** 1.5
    fin = int(.05 * SR); mix[:fin] *= np.linspace(0, 1, fin)
    mix /= np.max(np.abs(mix)) + 1e-9
    stereo = np.stack([mix, np.roll(mix, int(.012 * SR)) * .96 + mix * .04], 1) * 0.89
    grid = {'bpm': bpm, 'beat': round(beat, 4), 'bar': round(bar, 4), 'bars': [round(i * bar, 3) for i in range(int(dur / bar) + 1)]}
    return stereo, grid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dur', type=float, required=True)
    ap.add_argument('--mood', default='upbeat', choices=list(MOODS))
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--key', default='C', choices=list(NOTES))
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='music.wav')
    a = ap.parse_args()
    x, grid = build(a.dur, a.mood, a.bpm, a.key, a.seed)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(a.out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(json.dumps(grid))


if __name__ == '__main__':
    main()
