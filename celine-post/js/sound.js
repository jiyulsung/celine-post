// 파일 없이 만드는 귀여운 효과음 (Web Audio)
let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }
// 동영상 소리를 담을 때도 같은 소리 엔진을 써요 (이미 켜져 있어서 아이폰에서도 잘 돼요)
export const audioCtx = () => ac();

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const play = fn => (...args) => { if (enabled) try { fn(...args); } catch { /* 소리 실패는 무시 */ } };

// 잡음으로 만드는 소리 (종이 · 날갯짓 · 슝)
function noiseHit(start, dur, { type = 'bandpass', freq = 1200, to = 0, q = 1, vol = 0.15 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + start;
  const len = Math.ceil(a.sampleRate * (dur + 0.05));
  const b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = b; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(a.destination);
  s.start(t); s.stop(t + dur + 0.05);
}

export const sfx = {
  // 🐦 새가 날아와요: 파닥파닥 + 짹짹
  bird: play(() => {
    for (let i = 0; i < 5; i++) noiseHit(i * 0.11, 0.07, { freq: 700, q: 1.5, vol: 0.12 });
    [0.55, 0.68].forEach(s => tone(2600, s, 0.09, { type: 'sine', vol: 0.09, slide: 900 }));
  }),
  // 📮 엽서가 우체통에 쏙
  slot: play(() => { noiseHit(0, 0.18, { freq: 900, to: 2600, q: 2, vol: 0.1 }); tone(660, 0.14, 0.1, { type: 'triangle', vol: 0.1, slide: -260 }); }),
  // 💌 봉투를 열면 사락
  paper: play(() => { noiseHit(0, 0.22, { type: 'highpass', freq: 2500, vol: 0.09 }); noiseHit(0.12, 0.18, { type: 'highpass', freq: 3500, vol: 0.06 }); }),
  // 🔴 도장 꽝!
  stamp: play(() => { tone(110, 0, 0.22, { type: 'sine', vol: 0.32, slide: -60 }); noiseHit(0, 0.08, { freq: 1800, q: 0.7, vol: 0.2 }); }),
  // ✨ 우표 반짝
  sparkle: play(() => [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, i * 0.06, 0.25, { type: 'sine', vol: 0.07 }))),
  // 💛 하트 뿅
  heart: play(() => { tone(420, 0, 0.18, { type: 'sine', vol: 0.18, slide: 700 }); tone(1200, 0.12, 0.12, { type: 'triangle', vol: 0.06 }); }),
  // 💌 편지 슝~
  whoosh: play(() => noiseHit(0, 0.5, { freq: 400, to: 3000, q: 1.2, vol: 0.13 })),
  // 🏅 도장판 완성 빰빠밤
  fanfare: play(() => {
    [[523, 0], [523, 0.12], [523, 0.24], [659, 0.36], [784, 0.6], [1047, 0.84]].forEach(([f, s]) => {
      tone(f, s, s < 0.8 ? 0.16 : 0.6, { type: 'square', vol: 0.06 });
      tone(f, s, s < 0.8 ? 0.16 : 0.6, { type: 'triangle', vol: 0.1 });
    });
  }),
  // 🎂 생일 축하 노래 (오르골)
  birthday: play(() => {
    const N = { G4: 392, A4: 440, C5: 523, B4: 494, D5: 587, G5: 784, E5: 659, F5: 698 };
    const song = [['G4', .5], ['G4', .5], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2], ['G4', .5], ['G4', .5], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
      ['G4', .5], ['G4', .5], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2], ['F5', .5], ['F5', .5], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 2]];
    let t = 0;
    for (const [n, l] of song) { tone(N[n], t, l * 0.32 + 0.3, { type: 'sine', vol: 0.12 }); tone(N[n] * 2, t, 0.25, { type: 'sine', vol: 0.03 }); t += l * 0.32; }
  }),
  tap: play(() => tone(880, 0, 0.08, { type: 'triangle', vol: 0.12 })),
  insert: play(() => { tone(520, 0, 0.12, { type: 'triangle', slide: -200 }); tone(300, 0.1, 0.15, { type: 'triangle' }); }),
  clunk: play(() => {
    tone(140, 0, 0.18, { type: 'square', vol: 0.12, slide: -60 });
    for (let i = 0; i < 6; i++) tone(300 + Math.random() * 400, 0.1 + i * 0.09, 0.06, { type: 'triangle', vol: 0.08 });
  }),
  drop: play(() => { tone(700, 0, 0.25, { slide: -500, type: 'sine' }); tone(220, 0.25, 0.1, { type: 'square', vol: 0.1 }); tone(260, 0.42, 0.08, { type: 'square', vol: 0.06 }); }),
  pop: play(() => { tone(400, 0, 0.12, { slide: 900, type: 'sine', vol: 0.2 }); }),
  golden: play(() => [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.07, 0.3, { type: 'triangle', vol: 0.12 }))),
  yay: play(() => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.25, { type: 'triangle', vol: 0.14 }))),
};

// ───── 셀린 목소리 ─────
const voices = {};
export async function loadVoices(map) {
  const a = ac();
  if (!a) return;
  await Promise.all(Object.entries(map).map(async ([key, url]) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return;
      const ab = await res.arrayBuffer();
      voices[key] = await new Promise((ok, fail) => a.decodeAudioData(ab, ok, fail));
    } catch { /* 없는 목소리는 건너뛰어요 */ }
  }));
}

export const hasVoice = key => !!voices[key];
// 목소리별 크기 (1 = 원래 크기). 앱 열 때 "안녕"은 조금 작게
const VOICE_GAIN = { hello: 0.5 };
export function voice(key, delay = 0) {
  if (!enabled || !voices[key]) return false;
  try {
    const a = ac();
    const src = a.createBufferSource();
    src.buffer = voices[key];
    const g = a.createGain();
    g.gain.value = VOICE_GAIN[key] ?? 1;
    src.connect(g).connect(a.destination);
    src.start(a.currentTime + delay);
    duckBgm(delay + voices[key].duration + 0.2);
    return true;
  } catch { return false; }
}

// ───── 배경 음악: 동화 속 왈츠 (직접 만든 곡 · 파일 없이 실시간 연주) ─────
// D장조 · 3박자 왈츠 · 16마디 반복
// 첼레스타(반짝 멜로디) + 하프(펼침화음) + 피치카토(쿵) + 현악기(짝짝 · 은은한 바탕) + 마디 끝 반짝 글리산도
const QUARTER = 60 / 176;
const EIGHTH = QUARTER / 2;
const STEPS = 6; // 한 마디 = 8분음표 6개
const CH = { // [베이스, 화음]
  D: [38, [62, 66, 69]], Bm: [35, [59, 62, 66]], G: [31, [59, 62, 67]], A: [33, [61, 64, 69]],
  Fm: [30, [61, 66, 69]], A7: [33, [61, 64, 67]], Em: [28, [59, 64, 67]],
};
const PROG = ['D', 'Bm', 'G', 'A', 'D', 'Fm', 'G', 'A7', 'Bm', 'G', 'D', 'A', 'G', 'A7', 'D', 'D'];
const MELODY = [ // 마디마다 8분음표 6개 (null = 쉼표)
  [74, null, 78, null, 81, null],
  [83, null, 81, null, 78, null],
  [79, null, 83, null, 86, 83],
  [81, null, null, null, 76, 78],
  [78, null, 81, null, 86, null],
  [85, null, 81, null, 78, null],
  [79, 81, 83, null, 86, null],
  [88, null, 85, null, 81, null],
  [83, null, 86, null, 90, null],
  [91, null, 86, null, 83, null],
  [86, null, 81, null, 78, 81],
  [85, null, null, null, 81, 83],
  [83, null, 79, null, 86, null],
  [85, null, 88, null, 85, null],
  [86, null, null, null, 81, null],
  [74, null, null, null, null, null],
];
const hz = m => 440 * 2 ** ((m - 69) / 12);
let bgmOn = true, bgmBus = null, bgmTimer = null, nextTime = 0, step = 0;

function bgmTone(a, t, midi, { type = 'sine', vol = 0.1, dur = 0.4, attack = 0.005, cutoff = 0, release = 0 } = {}) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz(midi), t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  if (release) { g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + release); }
  else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (cutoff) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
  node.connect(g).connect(bgmBus);
  o.start(t); o.stop(t + dur + release + 0.05);
}
// 첼레스타: 맑은 종소리 (기본음 + 4배음 살짝)
function celesta(a, t, m, vol = 0.1) {
  bgmTone(a, t, m, { vol, dur: 0.9 });
  bgmTone(a, t, m + 24, { vol: vol * 0.18, dur: 0.25 });
  bgmTone(a, t, m + 12, { type: 'triangle', vol: vol * 0.25, dur: 0.5 });
}
// 하프: 톡 튕기는 소리
const harp = (a, t, m, vol = 0.045) => bgmTone(a, t, m, { type: 'triangle', vol, dur: 0.7, attack: 0.003 });
// 피치카토 베이스
const pizz = (a, t, m) => bgmTone(a, t, m, { type: 'triangle', vol: 0.17, dur: 0.28, attack: 0.004 });
// 현악기: 부드럽게 퍼지는 바탕
function strings(a, t, notes, len) {
  for (const n of notes) bgmTone(a, t, n, { type: 'sawtooth', vol: 0.011, dur: len * 0.85, attack: len * 0.35, cutoff: 1300, release: len * 0.3 });
}

function scheduleStep(a, t) {
  const bar = Math.floor(step / STEPS) % PROG.length, s = step % STEPS;
  const [bass, chord] = CH[PROG[bar]];
  const m = MELODY[bar][s];
  if (s === 0) {
    pizz(a, t, bass + 12);
    strings(a, t, chord, QUARTER * 3);
    bgmTone(a, t, 105, { vol: 0.012, dur: 0.12 }); // 트라이앵글 '딩'
  }
  if (s === 2 || s === 4) chord.forEach(n => harp(a, t, n + 12, 0.03)); // 짝 · 짝
  if (s % 2 === 1 && bar % 2 === 0) harp(a, t, chord[(s - 1) / 2 % 3] + 24, 0.022); // 펼침화음 반짝
  if (m) celesta(a, t, m, 0.085);
  // 4마디마다 끝에서 반짝 글리산도
  if (bar % 4 === 3 && s === 5) [0, 1, 2, 3, 4, 5].forEach(i => harp(a, t + i * 0.035, chord[i % 3] + 24 + 12 * Math.floor(i / 3), 0.03));
  step++;
}
function bgmTick() {
  const a = ac();
  if (!a || a.state !== 'running') return;
  if (nextTime < a.currentTime) nextTime = a.currentTime + 0.05;
  while (nextTime < a.currentTime + 0.25) { scheduleStep(a, nextTime); nextTime += EIGHTH; }
}
export function startBgm() {
  if (!bgmOn || bgmTimer) return;
  const a = ac();
  if (!a) return;
  if (!bgmBus) { bgmBus = a.createGain(); bgmBus.gain.value = 0.3; bgmBus.connect(a.destination); }
  bgmBus.gain.setTargetAtTime(0.3, a.currentTime, 0.4);
  nextTime = a.currentTime + 0.1;
  bgmTimer = setInterval(bgmTick, 40);
}
export function stopBgm() {
  clearInterval(bgmTimer);
  bgmTimer = null;
  if (bgmBus && ctx) bgmBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
}
export function setBgm(on) { bgmOn = on; on ? startBgm() : stopBgm(); }
// 셀린 목소리가 나올 때는 음악을 잠깐 작게
function duckBgm(sec) {
  if (!bgmBus || !ctx || !bgmTimer) return;
  const t = ctx.currentTime;
  bgmBus.gain.setTargetAtTime(0.07, t, 0.05);
  bgmBus.gain.setTargetAtTime(0.3, t + sec, 0.3);
}
// 앱을 내려 두면 음악도 쉬어요
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(bgmTimer); bgmTimer = null; }
  else if (bgmOn && bgmBus) startBgm();
});

export function buzz(pattern = 20) {
  if (enabled && navigator.vibrate) try { navigator.vibrate(pattern); } catch { /* 지원 안 하면 무시 */ }
}
