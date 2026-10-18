import m00 from './m00_12.js';
import m13 from './m13_18.js';
import m19 from './m19_24.js';
import m25 from './m25_30.js';
import m31 from './m31_36.js';
import m37 from './m37_plus.js';

export const BANDS = [
  { key: '0-12', label: '0~12개월', max: 12, list: m00 },
  { key: '13-18', label: '13~18개월', max: 18, list: m13 },
  { key: '19-24', label: '19~24개월', max: 24, list: m19 },
  { key: '25-30', label: '25~30개월', max: 30, list: m25 },
  { key: '31-36', label: '31~36개월', max: 36, list: m31 },
  { key: '37+', label: '3~4세', max: Infinity, list: m37 },
];

export const DOMAINS = {
  '몸': { label: '몸놀이', icon: '🏃' },
  '손': { label: '손놀이', icon: '✋' },
  '말': { label: '말놀이', icon: '💬' },
  '생각': { label: '생각놀이', icon: '🧩' },
  '마음': { label: '마음놀이', icon: '💛' },
  '감각': { label: '감각놀이', icon: '🌈' },
};

export const PLACES = {
  a: '🏠 어디서나',
  i: '🛋️ 집 안',
  o: '🌳 바깥',
  b: '🛁 목욕 시간',
  n: '🌙 잠자리',
};

// 제목으로 만든 짧은 해시 → 미션 순서를 바꿔도 기록이 유지돼요
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const MISSIONS = BANDS.flatMap((band, bandIdx) =>
  band.list.map(([energy, minutes, domain, place, title, how, why, safety]) => ({
    id: `${band.key}:${hash(title)}`,
    bandIdx, energy, minutes, domain, place, title, how, why, safety: safety || '',
  }))
);
