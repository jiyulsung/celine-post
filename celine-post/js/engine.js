import { BANDS, MISSIONS } from './missions/index.js';

// ───── 날짜 ─────
export const pad = n => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const prettyDate = key => { const d = parseKey(key); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEK[d.getDay()]})`; };

// ───── 나이 ─────
export function ageInfo(birthKey, on = new Date()) {
  if (!birthKey) return null;
  const b = parseKey(birthKey);
  const today = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  const days = Math.round((today - b) / 86400000) + 1; // 태어난 날 = 1일째
  let months = (today.getFullYear() - b.getFullYear()) * 12 + (today.getMonth() - b.getMonth());
  if (today.getDate() < b.getDate()) months -= 1;
  return { days, months: Math.max(0, months) };
}

export function ageLabel(info) {
  if (!info) return '';
  const { months, days } = info;
  const m = months < 36 ? `${months}개월` : `${Math.floor(months / 12)}살 ${months % 12}개월`;
  return `${m} · ${days.toLocaleString()}일째`;
}

export function bandIndex(months, level = 0) {
  let idx = BANDS.findIndex(b => months <= b.max);
  if (idx < 0) idx = BANDS.length - 1;
  return Math.min(BANDS.length - 1, Math.max(0, idx + level));
}

// ───── 이름 + 조사 ─────
function hasBatchim(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
// "민준" → "민준이", "하루" → "하루" (뒤에 가/랑/는 을 붙이기 좋게)
export const callName = name => (name && hasBatchim(name) ? `${name}이` : name || '우리 아기');
export const fillName = (text, name) => text.replaceAll('{아이}', callName(name));

// ───── 미션 뽑기 ─────
// energy: 1 녹초 · 2 보통 · 3 쌩쌩
export function pickMission({ months, level, energy, history, excludeId }) {
  const main = bandIndex(months, level);
  const hour = new Date().getHours();
  const night = hour >= 20 || hour < 6;
  const day = hour >= 7 && hour < 18;

  const twoWeeksAgo = Date.now() - 14 * 86400000;
  const recent = new Set(history.filter(m => m.ts > twoWeeksAgo).map(m => m.missionId));
  const disliked = new Set(history.filter(m => m.reaction === '😭').map(m => m.missionId));
  const likedDomains = {};
  const recentDomains = {};
  for (const m of history) {
    if (m.reaction === '😆' || m.reaction === '🥰') likedDomains[m.domain] = (likedDomains[m.domain] || 0) + 1;
    if (m.ts > twoWeeksAgo) recentDomains[m.domain] = (recentDomains[m.domain] || 0) + 1;
  }

  const build = strict => {
    const out = [];
    for (const m of MISSIONS) {
      if (m.id === excludeId) continue;
      const inMain = m.bandIdx === main;
      const inEasier = m.bandIdx === main - 1;
      if (!inMain && !inEasier) continue;
      if (energy === 1 && m.energy > 1) continue;
      if (energy === 2 && m.energy > 2) continue;
      if (night && m.place === 'o') continue;
      if (strict && (recent.has(m.id) || disliked.has(m.id))) continue;

      let w = inMain ? 1 : 0.35;
      if (energy === 3 && m.energy === 3) w *= 2.2;
      if (energy === 2 && m.energy === 2) w *= 1.4;
      if (night && (m.place === 'n' || m.place === 'b')) w *= 2;
      if (day && m.place === 'n') w *= 0.3;
      if (likedDomains[m.domain]) w *= 1 + Math.min(0.6, likedDomains[m.domain] * 0.1);
      if (!recentDomains[m.domain]) w *= 1.3;
      out.push([m, w]);
    }
    return out;
  };

  let pool = build(true);
  if (pool.length === 0) pool = build(false);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [m, w] of pool) { if ((r -= w) <= 0) return m; }
  return pool[pool.length - 1][0];
}

// ───── 스티커 ─────
// 일반 스티커 72종 (동물 · 바다 · 먹을거리 · 탈것 · 자연)
export const STICKERS = [
  '🐶', '🐱', '🐰', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵',
  '🐥', '🐧', '🦆', '🦉', '🐢', '🦋', '🐞', '🐝', '🦕', '🦖', '🦒', '🐘',
  '🦔', '🦊', '🐹', '🐿️', '🦩', '🦜', '🐳', '🐬', '🐙', '🦀', '🐠', '🦭',
  '🍓', '🍌', '🍎', '🍉', '🍑', '🍇', '🥕', '🌽', '🍙', '🍪', '🧁', '🍦',
  '🚗', '🚌', '🚂', '🚁', '⛵', '🚒', '🚜', '🛵', '🎈', '🪁', '🧸', '🪀',
  '🌻', '🌷', '🍀', '🍄', '🌙', '⭐', '☀️', '⛄', '🌸', '🍁', '🐚', '🐌',
];
// 반짝이 스티커 15종 (황금 캡슐)
export const SHINY = ['🦄', '🌈', '👑', '💎', '🚀', '🎠', '🍭', '🎂', '🌟', '🪐', '🏰', '🎡', '🐉', '🦚', '🎀'];
export const ALL_STICKERS = [...STICKERS, ...SHINY];

// 포토카드는 'pc:card01', 반짝이 버전은 'pc:card01h' 처럼 저장해요
export const isPhotoCard = s => typeof s === 'string' && s.startsWith('pc:');
export const isHolo = s => isPhotoCard(s) && s.endsWith('h');

export function drawSticker({ golden, owned, count, cardIds, noCards = false }) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const missingOf = arr => arr.filter(s => !owned[s]);
  const normal = cardIds.map(id => 'pc:' + id);
  const holo = cardIds.map(id => 'pc:' + id + 'h');
  // 희주 포토카드: 3번째 캡슐마다 + 황금 캡슐 + 가끔 깜짝!
  if (!noCards && normal.length && ((count + 1) % 3 === 0 || golden || Math.random() < 0.2)) {
    // 포토카드는 겹치지 않게: 아직 없는 카드만 나와요
    const holoFirst = golden || Math.random() < 0.15; // 특급 편지는 반짝이 우표부터!
    const m = missingOf(holoFirst ? holo : normal);
    const rest = missingOf(holoFirst ? normal : holo);
    if (m.length) return pick(m);
    if (rest.length) return pick(rest);
    return 'pc:done'; // 100장을 다 모았어요 → 매일 사진 카드나 스티커로 바꿔 줘요
  }
  const set = golden ? SHINY : STICKERS;
  const missing = missingOf(set);
  // 아직 없는 스티커가 나올 확률을 높여서 도감 채우는 재미를 줘요
  if (missing.length && Math.random() < 0.6) return pick(missing);
  return pick(set);
}

export const GOLDEN_CHANCE = 0.1;
export const REROLLS_PER_CAPSULE = 2;
