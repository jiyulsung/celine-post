import { createStore, newId, countLocalMoments, wipeLocal, readLocalForMigration, clearLocalData } from './store.js';
import { FAMILIES, DEFAULT_FAMILY, BRAND, DEFAULT_FACES, PHOTO_CARDS, VOICES, CHEER_WHO } from './config.js';
import { DOMAINS, PLACES } from './missions/index.js';
import {
  dateKey, parseKey, prettyDate, pad, ageInfo, ageLabel, callName, fillName,
  pickMission, drawSticker, ALL_STICKERS, SHINY, isPhotoCard, isHolo, GOLDEN_CHANCE, REROLLS_PER_CAPSULE,
} from './engine.js';
import { drawCard, shareCanvas } from './card.js';
import { sfx, buzz, setSound, loadVoices, voice, hasVoice, setBgm, audioCtx } from './sound.js';
import { cropFace } from './avatar.js';
import { setupInstall, handleInApp } from './install.js';

const $ = id => document.getElementById(id);
const CAPSULE_COLORS = ['#FF7A6B', '#7FD6C2', '#9BD3F5', '#FFD66B', '#C9B4F5', '#FFA9C6'];
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('haru.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('haru.' + k, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮아요 */ } },
};

const state = {
  store: null,
  user: null,
  profile: null,
  moments: [],
  words: [],
  energy: LS.get('energy', 2),
  photo: null,           // { thumb, full } 오늘 넣은 사진
  current: null,         // { mission, golden, rerollsLeft }
  reaction: null,
  lastMoment: null,
  openMoment: null,
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  busy: false,
};
const thumbCache = new Map();

// ───────────────────────── 공통 UI ─────────────────────────
function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function loading(on, msg = '') { $('loading').hidden = !on; $('loadingMsg').textContent = on ? msg : ''; }

function confetti(count = 40, gold = false) {
  const box = $('confetti');
  const colors = gold ? ['#FFE38A', '#F5B83D', '#FFD35C', '#fff'] : CAPSULE_COLORS;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    p.style.animationDelay = Math.random() * 0.4 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
    setTimeout(() => p.remove(), 4000);
  }
}

const sheets = ['missionSheet', 'momentSheet', 'settingsSheet', 'avatarSheet', 'installSheet', 'letterSheet', 'whoSheet'];
function openSheet(id) {
  for (const s of sheets) $(s).hidden = s !== id;
  $('sheetBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  syncBack();
}

// 뒤로 가기: 앱이 꺼지지 않고 열린 창 → 우체국 탭 순서로 돌아가요
let curView = 'draw';
const needBack = () => sheets.some(s => !$(s).hidden) || curView !== 'draw';
function syncBack() {
  const has = history.state?.celine;
  if (needBack() && !has) history.pushState({ celine: 1 }, '');
  else if (!needBack() && has) history.back();
}
window.addEventListener('popstate', () => {
  if (sheets.some(s => !$(s).hidden)) closeSheets();
  else if (curView !== 'draw') switchView('draw');
});
function closeSheets() {
  try { $('momentVideo').pause(); } catch { /* 괜찮아요 */ }
  for (const s of sheets) $(s).hidden = true;
  $('iosArrow').hidden = true;
  $('sheetBackdrop').hidden = true;
  document.body.style.overflow = '';
  syncBack();
}

// ───────────────────────── 시작 ─────────────────────────
function familyFromUrl() {
  const code = new URLSearchParams(location.search).get('f');
  if (code && FAMILIES[code]) LS.set('family', code);
  const saved = LS.get('family') || DEFAULT_FAMILY;
  const fam = saved && FAMILIES[saved];
  return fam && fam.message ? { code: saved, ...fam } : null;
}

async function boot() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setSound(LS.get('sound', true));
  setBgm(false);
  document.addEventListener('pointerdown', () => { if (LS.get('bgm', true)) setBgm(true); }, { once: true });
  state.voicesReady = loadVoices(VOICES); // 셀린 목소리 (있으면)
  const family = familyFromUrl();
  state.family = family;

  state.store = createStore();
  state.install = setupInstall({ localMode: state.store.mode === 'local', openSheet, closeSheets, toast, onInstalled: freshInstall });
  handleInApp(); // 카카오톡 안에서 열면 크롬/사파리로 안내
  const startApp = () => {
    loading(true);
    state.store.init(onAuth).catch(err => {
      console.error(err);
      loading(false);
      toast('연결에 문제가 있어요. 인터넷을 확인해 주세요.', 4000);
    });
  };

  const begin = () => {
    // 로그인 버전은 아이디를 처음 만들고(처음 로그인하고) 나서 편지가 나와요
    if (state.store.mode !== 'cloud' && family && !LS.get('giftSeen.' + family.code)) showGift(family, startApp);
    else startApp();
  };

  // 브라우저로 링크를 열면 먼저 설치 안내 (홈 화면 아이콘으로 열면 바로 선물 상자)
  if (state.install.needsLanding()) state.install.showLanding(begin);
  else begin();
}

function showGift(family, next) {
  showScreen('gift');
  $('giftTo').textContent = family.to || `${callName(family.baby)}네 가족에게`;
  $('giftMsg').textContent = family.message;
  if (family.photo) { $('giftPhoto').src = family.photo; $('giftPhoto').hidden = false; }
  $('giftFrom').textContent = family.from ? `– ${family.from}` : '';
  $('giftBox').onclick = () => {
    if ($('giftBox').classList.contains('open')) return;
    sfx.pop();
    buzz(30);
    $('giftBox').classList.add('open');
    $('giftHint').hidden = true;
    setTimeout(() => { $('giftBox').hidden = true; $('giftLetter').hidden = false; confetti(60); sfx.yay(); }, 450);
  };
  $('giftNext').onclick = () => { LS.set('giftSeen.' + family.code, true); state.greetNow = true; next(); };
}

async function onAuth(user) {
  state.user = user;
  if (!user) { loading(false); showAuth(); return; }
  await migrateLocal();
  try {
    const cached = state.store.listCached ? await state.store.listCached().catch(() => null) : null;
    if (cached?.moments?.length) {
      // 이 휴대폰에 저장해 둔 지난 기록으로 바로 시작 → 최신 기록은 뒤에서 받아와요
      Object.assign(state, cached);
      Promise.all([state.store.getProfile(), state.store.listMoments(), state.store.listWords()])
        .then(([profile, moments, words]) => {
          state.profile = profile || state.profile; state.moments = moments; state.words = words;
          loadDayCards().then(refreshViews);
        }).catch(() => {});
    } else {
      loading(true);
      const [profile, moments, words] = await Promise.all([
        state.store.getProfile(), state.store.listMoments(), state.store.listWords(),
      ]);
      state.profile = profile;
      state.moments = moments;
      state.words = words;
    }
  } catch (e) {
    console.error(e);
    toast('기록을 불러오지 못했어요. 인터넷을 확인해 주세요.', 4000);
  } finally {
    loading(false);
  }
  // 하루 우표 그림은 화면을 먼저 보여 준 뒤 뒤에서 불러와요
  loadDayCards().then(refreshViews);
  if (state.profile?.birth !== BRAND.birth || !state.profile?.name) {
    const patch = { name: BRAND.baby, birth: BRAND.birth, level: state.profile?.level ?? 0 };
    state.profile = { ...(state.profile || {}), ...patch };
    state.store.saveProfile(patch).catch(() => {});
  }
  // 이 아이디로 처음 들어왔으면 유딩이모 편지부터 🎁
  if (state.store.mode === 'cloud' && state.family && !state.profile?.giftSeen) {
    showGift(state.family, () => {
      state.profile = { ...state.profile, giftSeen: true };
      state.store.saveProfile({ giftSeen: true }).catch(() => {});
      enterMain();
    });
    return;
  }
  enterMain();
}

// 로그인하기 전 이 휴대폰에만 있던 기록을 계정으로 옮겨요 (한 번만)
async function migrateLocal() {
  if (state.store.mode !== 'cloud') return;
  let data;
  try { data = await readLocalForMigration(); } catch { return; }
  if (!data || !data.moments?.length) return;
  loading(false);
  if (!confirm(`이 휴대폰에 셀린 우체국 기록이 ${data.moments.length}개 있어요.
지금 로그인한 아이디로 옮길까요?

[확인] 아이디로 옮기기 (어느 폰에서든 보여요)
[취소] 옮기지 않기`)) {
    if (confirm('옮기지 않은 기록은 이 휴대폰에서 지울까요?\n\n[확인] 지우기\n[취소] 그냥 두기 (다음에 로그인할 때 다시 물어봐요)')) await clearLocalData();
    return;
  }
  loading(true);
  try {
    await state.store.importAll(data, (i, n) => toast(`📦 기록을 아이디로 옮기는 중… ${Math.round((i / n) * 100)}%`, 60000));
    await clearLocalData();
    toast(`✅ 기록 ${data.moments.length}개를 아이디로 옮겼어요!`, 4000);
  } catch (e) {
    toast(e?.message || '기록을 다 옮기지 못했어요. 다음에 로그인할 때 다시 해 볼게요.', 5000);
  } finally {
    loading(false);
  }
}

// ───────────────────────── 로그인 ─────────────────────────
let authTab = 'login';
function showAuth() {
  showScreen('auth');
  setAuthTab(state.family ? 'signup' : 'login');
}
function setAuthTab(tab) {
  authTab = tab;
  for (const b of document.querySelectorAll('[data-auth-tab]')) b.classList.toggle('active', b.dataset.authTab === tab);
  const signup = tab === 'signup';
  $('authPw2Wrap').hidden = !signup;
  $('authNote').hidden = !signup;
  $('authSubmit').textContent = signup ? '아이디 만들기' : '로그인';
  $('authPw').autocomplete = signup ? 'new-password' : 'current-password';
  $('authError').textContent = '';
}
document.querySelectorAll('[data-auth-tab]').forEach(b => b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('authId').value.trim().toLowerCase();
  const pw = $('authPw').value;
  const err = $('authError');
  if (!/^[a-z0-9_]{4,20}$/.test(id)) { err.textContent = '아이디는 영문 소문자·숫자 4~20자로 해 주세요.'; return; }
  if (pw.length < 6) { err.textContent = '비밀번호는 6자 이상으로 해 주세요.'; return; }
  if (authTab === 'signup' && pw !== $('authPw2').value) { err.textContent = '비밀번호가 서로 달라요.'; return; }
  err.textContent = '';
  loading(true);
  try {
    if (authTab === 'signup') await state.store.signUp(id, pw);
    else await state.store.signIn(id, pw);
    // onAuth 가 이어서 화면을 바꿔요
  } catch (ex) {
    loading(false);
    err.textContent = ex.message;
  }
});

// ───────────────────────── 태어난 날 고르기 (년 · 월 · 일 따로) ─────────────────────────
function datePicker(id) {
  const hidden = $(id);
  const box = $(id + 'Pick');
  const now = new Date();
  const mk = (label, unit) => {
    const s = document.createElement('select');
    s.setAttribute('aria-label', label);
    s.dataset.unit = unit;
    box.appendChild(s);
    return s;
  };
  const ys = mk('태어난 해', '년'), ms = mk('태어난 달', '월'), ds = mk('태어난 날짜', '일');
  const fill = (sel, values, cur) => {
    sel.innerHTML = `<option value="">${sel.dataset.unit}</option>` + values.map(v => `<option value="${v}">${v}${sel.dataset.unit}</option>`).join('');
    sel.value = values.includes(Number(cur)) ? String(cur) : '';
    sel.classList.toggle('empty', !sel.value);
  };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const update = () => {
    const y = Number(ys.value), m = Number(ms.value), d = Number(ds.value);
    // 미래 날짜는 고를 수 없게
    const maxM = y === now.getFullYear() ? now.getMonth() + 1 : 12;
    fill(ms, range(1, maxM), m);
    const mm = Number(ms.value);
    let maxD = y && mm ? new Date(y, mm, 0).getDate() : 31;
    if (y === now.getFullYear() && mm === now.getMonth() + 1) maxD = now.getDate();
    fill(ds, range(1, maxD), d);
    ys.classList.toggle('empty', !ys.value);
    hidden.value = ys.value && ms.value && ds.value ? `${ys.value}-${pad(ms.value)}-${pad(ds.value)}` : '';
  };
  const years = range(now.getFullYear() - 8, now.getFullYear()).reverse();
  [ys, ms, ds].forEach(s => s.addEventListener('change', update));
  return {
    set(v) {
      const [y, m, d] = (v || '').split('-').map(Number);
      fill(ys, years, y);
      fill(ms, range(1, 12), m);
      fill(ds, range(1, 31), d);
      update();
    },
  };
}
const birthPickers = { setup: datePicker('setupBirth') };

// ───────────────────────── 아기 정보 ─────────────────────────
function showSetup() {
  showScreen('setup');
  $('setupName').value = state.profile?.name || state.family?.baby || '';
  birthPickers.setup.set(state.profile?.birth || '');
  state.pendingAvatar = state.profile?.avatar || null;
  applyAvatar();
}
$('setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('setupName').value.trim();
  const birth = $('setupBirth').value;
  if (!name) return;
  if (!birth) { toast('태어난 해 · 달 · 날짜를 모두 골라 주세요 🙂'); return; }
  const patch = { name, birth, level: state.profile?.level ?? 0, family: state.family?.code || null };
  if (state.pendingAvatar) patch.avatar = state.pendingAvatar;
  loading(true);
  await state.store.saveProfile(patch);
  state.profile = { ...(state.profile || {}), ...patch };
  loading(false);
  sfx.yay();
  confetti(40);
  enterMain();
});

// ───────────────────────── 아기 얼굴 ─────────────────────────
function applyAvatar() {
  const src = state.profile?.avatar || state.pendingAvatar || DEFAULT_FACES.main || null;
  const pairs = [['topAvatarImg', 'topAvatarPh'], ['setupAvatarImg', 'setupAvatarPh'], ['setAvatarImg', 'setAvatarPh']];
  for (const [img, ph] of pairs) {
    $(img).hidden = !src;
    $(ph).hidden = !!src;
    if (src) $(img).src = src;
  }
  $('machineAvatar').hidden = !src;
  $('machineAvatar').parentElement.classList.toggle('has-avatar', !!src);
  if (src) $('machineAvatarImg').src = src;
}

// 사진 고르기 → 동그랗게 자르기 → dataURL
function pickFace() {
  return new Promise(resolve => {
    const input = $('avatarInput');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const back = sheets.find(s => !$(s).hidden && s !== 'avatarSheet');
      try {
        const face = await cropFace(file, {
          open: () => openSheet('avatarSheet'),
          close: () => (back ? openSheet(back) : closeSheets()),
        });
        resolve(face);
      } catch {
        toast('사진을 읽지 못했어요. 다른 사진으로 해 볼까요?');
        resolve(null);
      }
    };
    input.click();
  });
}

async function changeFace() {
  const face = await pickFace();
  if (!face) return;
  loading(true);
  await state.store.saveProfile({ avatar: face });
  state.profile = { ...state.profile, avatar: face };
  loading(false);
  applyAvatar();
  buildGlass();
  sfx.yay();
  confetti(40);
  toast('우리 아기 얼굴로 바뀌었어요! 🥰');
}

$('setupAvatarBtn').addEventListener('click', async () => {
  const face = await pickFace();
  if (!face) return;
  state.pendingAvatar = face;
  applyAvatar();
  sfx.pop();
});
$('setAvatarBtn').addEventListener('click', changeFace);
$('topAvatar').addEventListener('click', changeFace);

// ───── 반응 사진 (깔깔 · 좋아함 · 시큰둥 · 싫어함) ─────
const REACTIONS = [['😆', '깔깔'], ['🥰', '좋아함'], ['😐', '시큰둥'], ['😭', '싫어함']];
const reactFace = r => state.profile?.reactFaces?.[r] || DEFAULT_FACES[r] || null;

// 스티커 보여 주기: 이모지 또는 셀린 포토카드
const isDayCard = s => typeof s === 'string' && s.startsWith('mc:');
// 같은 사진을 또 넣었는지 알아보는 사진 지문 (작은 사진으로 계산)
function photoKey(str) {
  if (!str) return '';
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 7) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + '_' + str.length.toString(36);
}
const isAnyCard = s => isPhotoCard(s) || isDayCard(s);
const dayCardCache = new Map(); // 순간 id → 카드 그림
const dayCardTitle = s => {
  const mo = state.moments.find(m => m.id === s.slice(3));
  return mo ? `${parseKey(mo.date).getMonth() + 1}월 ${parseKey(mo.date).getDate()}일의 셀린` : '셀린의 하루';
};
const cardId = s => s.slice(3).replace(/h$/, '');
const cardSrc = s => `faces/${cardId(s)}.jpg`;
const cardTitle = s => (PHOTO_CARDS.find(c => c[0] === cardId(s))?.[1] || '셀린 우표') + (isHolo(s) ? ' ✨' : '');
function stickerHTML(s, cls = 'st-img') {
  if (isDayCard(s)) {
    const src = dayCardCache.get(s.slice(3));
    return src ? `<span class="daycard ${cls}-wrap"><img class="${cls}" src="${src}" alt="${dayCardTitle(s)}" /></span>` : '📷';
  }
  if (isPhotoCard(s)) {
    const img = `<img class="${cls}" src="${cardSrc(s)}" alt="${cardTitle(s)}" />`;
    return isHolo(s) ? `<span class="holo ${cls}-wrap">${img}</span>` : img;
  }
  return s || '';
}
const mainFace = () => state.profile?.avatar || DEFAULT_FACES.main || null;
// 카드에 그릴 때 쓰는 프로필 (기본 셀린 표정까지 합쳐서)
const cardProfile = () => ({
  ...state.profile,
  stickerSrc: s => (isDayCard(s) ? dayCardCache.get(s.slice(3)) : null),
  avatar: mainFace(),
  reactFaces: Object.fromEntries(['😆', '🥰', '😐', '😭'].map(r => [r, reactFace(r)])),
});

// 자판기 얼굴을 상황에 맞는 셀린 표정으로 바꿔요 (그 표정 사진이 없으면 메인 얼굴)
function setExpression(key) {
  const src = (key && reactFace(key)) || mainFace();
  if (src && $('machineAvatarImg').getAttribute('src') !== src) $('machineAvatarImg').src = src;
}

function applyReactFaces() {
  for (const btn of document.querySelectorAll('.react')) {
    const r = btn.dataset.react;
    const label = REACTIONS.find(x => x[0] === r)[1];
    const face = reactFace(r);
    btn.classList.toggle('has-face', !!face);
    btn.innerHTML = face
      ? `<img class="rface" src="${face}" alt="" /><span class="remoji">${r}</span><small>${label}</small>`
      : `${r}<small>${label}</small>`;
  }
}

function renderRfGrid() {
  const grid = $('rfGrid');
  grid.innerHTML = '';
  for (const [r, label] of [...REACTIONS, ['😮', '깜짝'], ['😴', '졸림'], ['🙈', '숨기'], ['🎉', '신남']]) {
    const face = reactFace(r);
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'rf-slot' + (face ? ' filled' : '');
    slot.innerHTML = `<span class="circle">${face ? `<img src="${face}" alt="" />` : r}</span>${face ? `<span class="remoji">${r}</span>` : ''}<span>${label}</span>`;
    slot.addEventListener('click', async () => {
      const picked = await pickFace();
      if (!picked) return;
      const reactFaces = { ...(state.profile?.reactFaces || {}), [r]: picked };
      loading(true);
      await state.store.saveProfile({ reactFaces });
      state.profile = { ...state.profile, reactFaces };
      loading(false);
      renderRfGrid();
      applyReactFaces();
      sfx.pop();
    });
    grid.appendChild(slot);
  }
}

// ───── 앱을 열 때 셀린 인사 ─────
// 휴대폰은 화면을 한 번 누르기 전엔 소리를 못 내서, 시작 화면을 톡 누르면 "안녕"이 나와요.
async function greet() {
  if (state.greetNow) { state.voicesReady.then(() => voice('hello', 0.2)); return; } // 선물 상자에서 막 들어왔을 때
  // 앱을 새로 켤 때마다 인사해요 (잠깐 다른 앱에 다녀온 건 새로 켠 게 아니라서 안 나와요)
  try { if (sessionStorage.getItem('haru.greeted')) return; sessionStorage.setItem('haru.greeted', '1'); } catch { /* 괜찮아요 */ }
  const box = $('helloSplash');
  $('helloFace').src = mainFace() || '';
  box.hidden = false;
  box.onclick = () => {
    state.voicesReady.then(() => voice('hello'));
    box.classList.add('bye');
    setTimeout(() => { box.hidden = true; box.classList.remove('bye'); }, 650);
  };
}

// ───────────────────────── 메인 ─────────────────────────
function enterMain() {
  showScreen('main');
  backupReminder();
  if (!enterMain.greeted) {
    enterMain.greeted = true;
    greet();
  }
  applyAvatar();
  applyReactFaces();
  renderHeader();
  renderWeek();
  buildGlass();
  setEnergy(state.energy, false);
  resetMachine();
  renderBday();
  switchView(LS.get('view', 'draw'));
  setTimeout(announceCheers, 2500);
}

// 기록이 새로 들어오면 지금 보고 있는 화면을 다시 그려요
function refreshViews() {
  if ($('screen-main').hidden) return;
  renderWeek();
  const v = LS.get('view', 'draw');
  if (v === 'diary') renderDiary();
  if (v === 'dex') renderDex();
  if (v === 'guest') renderGuest();
  if (v === 'words') renderWords();
}

// ───── 기념일 카운트다운 ─────
function renderBday() {
  const box = $('bdayBanner');
  const b0 = parseKey(BRAND.birth), t0 = parseKey(dateKey());
  const dayN = Math.round((t0 - b0) / 86400000) + 1; // 태어난 날이 1일째
  const nth = n => ['첫돌', '두 돌', '세 돌', '네 돌', '다섯 돌'][n - 1] || `${n}번째 생일`;
  // 다가오는 생일
  let nb = new Date(t0.getFullYear(), b0.getMonth(), b0.getDate());
  if (nb < t0) nb = new Date(t0.getFullYear() + 1, b0.getMonth(), b0.getDate());
  const bDays = Math.round((nb - t0) / 86400000), bAge = nb.getFullYear() - b0.getFullYear();
  // 다가오는 100일 단위 기념일 (100일, 200일 … 1000일)
  const nextHundred = Math.ceil(dayN / 100) * 100, hDays = nextHundred - dayN;
  box.hidden = false;
  box.classList.remove('today');
  let html, party = '';
  if (bDays === 0) {
    html = `🎉 오늘은 ${BRAND.baby}의 ${nth(bAge)}! 🎂<small>태어나 줘서 고마워, 사랑해 💛</small>`; party = 'b' + nb.getFullYear();
  } else if (hDays === 0) {
    html = `🎉 오늘은 ${BRAND.baby}가 태어난 지 ${dayN}일! 🥳<small>${dayN}일 동안 무럭무럭 자라 줘서 고마워 💛</small>`; party = 'd' + dayN;
  } else if (bDays <= 60) {
    html = `🎂 ${BRAND.baby}의 ${nth(bAge)}까지 D-${bDays}<small>${nb.getMonth() + 1}월 ${nb.getDate()}일 · 오늘은 태어난 지 ${dayN}일째</small>`;
  } else {
    html = `🌟 ${BRAND.baby} 태어난 지 ${dayN}일째<small>${nextHundred}일까지 D-${hDays} · ${nth(bAge)}까지 D-${bDays}</small>`;
  }
  box.innerHTML = html;
  if (party) {
    box.classList.add('today');
    if (!LS.get('party.' + party)) {
      LS.set('party.' + party, true);
      setTimeout(() => { confetti(90, true); sfx.birthday(); setTimeout(() => voice('love'), 8500); }, 1200);
    }
  }
  return;
  const b = parseKey(BRAND.birth);
  const today = parseKey(dateKey());
  let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
  const days = Math.round((next - today) / 86400000);
  const age = next.getFullYear() - b.getFullYear();
  const what = age === 1 ? '첫돌' : `${age}번째 생일`;
  if (days > 60) { box.hidden = true; return; }
  box.hidden = false;
  box.classList.toggle('today', days === 0);
  box.innerHTML = days === 0
    ? `🎉 오늘은 ${BRAND.baby}의 ${what}! 🎂<small>태어나 줘서 고마워, 사랑해 💛</small>`
    : `🎂 ${BRAND.baby}의 ${what}까지 D-${days}<small>${next.getMonth() + 1}월 ${next.getDate()}일</small>`;
  if (days === 0 && !LS.get('bdayCheered.' + next.getFullYear())) {
    LS.set('bdayCheered.' + next.getFullYear(), true);
    setTimeout(() => { confetti(90, true); sfx.yay(); voice('love', 0.4); }, 1200);
  }
}

// ───── 가족 응원 💛 ─────
const myWho = () => LS.get('who', '');
function askWho(then) {
  const grid = $('whoGrid');
  grid.innerHTML = '';
  const back = sheets.find(id => id !== 'whoSheet' && !$(id).hidden); // 응원 보내던 화면으로 돌아가요
  const pick = name => {
    LS.set('who', name);
    if (back) openSheet(back); else closeSheets();
    toast(`이제 "${name}" 이름으로 응원을 보내요 💛`);
    then?.();
  };
  for (const name of CHEER_WHO) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => pick(name));
    grid.appendChild(b);
  }
  $('whoOtherForm').onsubmit = e => { e.preventDefault(); const v = $('whoOtherInput').value.trim(); if (v) pick(v); };
  openSheet('whoSheet');
}
$('changeWhoBtn').addEventListener('click', () => askWho());

function renderCheers(mo) {
  const list = $('cheerList');
  list.innerHTML = '';
  const cheers = mo.cheers || [];
  const hearts = {};
  for (const c of cheers) if (!c.text) hearts[c.who] = (hearts[c.who] || 0) + 1;
  for (const c of cheers.filter(c => c.text)) {
    const el = document.createElement('div');
    el.className = 'cheer';
    el.innerHTML = `<b></b><span></span><small></small>`;
    el.querySelector('b').textContent = c.who;
    el.querySelector('span').textContent = c.text;
    el.querySelector('small').textContent = `${new Date(c.ts).getMonth() + 1}/${new Date(c.ts).getDate()}`;
    list.appendChild(el);
  }
  const hs = Object.entries(hearts);
  if (hs.length) {
    const el = document.createElement('div');
    el.className = 'cheer-hearts';
    el.textContent = hs.map(([w, n]) => `${w} 💛×${n}`).join('  ·  ');
    list.appendChild(el);
  }
  $('cheerWhoLabel').textContent = myWho() ? `(${myWho()} 이름으로 보내요)` : '';
}

async function sendCheer(text) {
  const mo = state.openMoment;
  if (!mo) return;
  if (!myWho()) { askWho(() => sendCheer(text)); return; }
  const cheer = { who: myWho(), text: text || '', ts: Date.now() };
  mo.cheers = [...(mo.cheers || []), cheer];
  renderCheers(mo);
  try {
    await state.store.updateMoment(mo.id, { cheers: mo.cheers });
  } catch {
    toast('응원을 저장하지 못했어요. 인터넷을 확인해 주세요.');
  }
}
$('cheerHeart').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const h = document.createElement('span');
  h.className = 'heart-fly';
  h.textContent = '💛';
  Object.assign(h.style, { left: r.left + 6 + 'px', top: r.top + 'px' });
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 1000);
  sfx.heart();
  buzz(15);
  sendCheer('');
});
$('cheerForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('cheerInput').value.trim();
  if (!v) return;
  $('cheerInput').value = '';
  sfx.yay();
  sendCheer(v);
});

// ───── 방명록 💌 ─────
function renderGuest() {
  const chips = $('guestWhoChips');
  chips.innerHTML = '';
  const names = [...CHEER_WHO, ...(myWho() && !CHEER_WHO.includes(myWho()) ? [myWho()] : [])];
  for (const name of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-chip' + (myWho() === name ? ' active' : '');
    b.textContent = name;
    b.addEventListener('click', () => { LS.set('who', name); sfx.tap(); renderGuest(); });
    chips.appendChild(b);
  }
  const other = document.createElement('button');
  other.type = 'button';
  other.className = 'who-chip other';
  other.textContent = '+ 다른 이름';
  other.addEventListener('click', () => askWho(renderGuest));
  chips.appendChild(other);
  const list = $('guestList');
  list.innerHTML = '';
  const items = guestsOnly().sort((a, b) => b.ts - a.ts);
  $('guestCount').textContent = items.length ? `편지 ${items.length}통이 도착했어요 💛` : '아직 편지가 없어요. 첫 편지를 남겨 주세요!';
  for (const g of items) {
    const d = new Date(g.ts);
    const card = document.createElement('div');
    card.className = 'guest-card';
    card.innerHTML = `<div class="gc-top"><b></b><small>${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}</small></div><p></p>`;
    card.querySelector('b').textContent = `${g.who}의 편지`;
    card.querySelector('p').textContent = g.text;
    if (g.who === myWho()) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'gc-del';
      del.textContent = '지우기';
      del.addEventListener('click', async () => {
        if (!confirm('이 편지를 지울까요?')) return;
        await state.store.deleteWord(g.id).catch(() => {});
        state.words = state.words.filter(x => x.id !== g.id);
        renderGuest();
      });
      card.querySelector('.gc-top').appendChild(del);
    }
    list.appendChild(card);
  }
}
$('guestForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('guestInput').value.trim();
  if (!text) { toast('편지 내용을 적어 주세요 ✍️'); return; }
  if (!myWho()) { toast('✍️ 위에서 누가 쓰는 편지인지 먼저 골라 주세요'); return; }
  const g = { id: newId(), ts: Date.now(), date: dateKey(), type: 'guest', who: myWho(), text };
  try {
    await state.store.addWord(g);
    state.words.unshift(g);
    $('guestInput').value = '';
    sfx.whoosh();
    setTimeout(() => sfx.yay(), 400);
    confetti(30);
    toast('💌 편지를 보냈어요! 셀린이가 좋아할 거예요');
    renderGuest();
  } catch {
    toast('편지를 보내지 못했어요. 인터넷을 확인해 주세요.');
  }
});

// 앱을 열 때: 다른 가족이 보낸 새 응원이 있으면 알려 줘요
function announceCheers() {
  const seen = LS.get('cheerSeen', 0);
  const mine = myWho();
  const fresh = [
    ...state.moments.flatMap(m => (m.cheers || []).map(c => ({ ...c, m }))),
    ...guestsOnly().map(g => ({ who: g.who, text: g.text, ts: g.ts, guest: true })),
  ].filter(c => c.ts > seen && c.who !== mine);
  LS.set('cheerSeen', Date.now());
  if (!seen || !fresh.length) return;
  const who = [...new Set(fresh.map(c => c.who))].slice(0, 3).join(', ');
  const withText = fresh.find(c => c.text);
  const g = fresh.find(c => c.guest);
  toast(g ? `💌 ${g.who}의 방명록 편지가 도착했어요!` : withText ? `💛 ${withText.who}: "${withText.text}"` : `💛 ${who}이(가) 응원 하트를 보냈어요!`, 4500);
  voice('love', 0.2);
}

// 한 달에 한 번, 사진이 쌓였으면 살짝 백업 알림
function backupReminder() {
  try { if (sessionStorage.getItem('haru.backupNudged')) return; sessionStorage.setItem('haru.backupNudged', '1'); } catch { return; }
  const photos = state.moments.filter(m => m.hasPhoto).length;
  const last = LS.get('backupAt', 0) || Math.min(...state.moments.map(m => m.ts), Date.now());
  if (photos >= 5 && Date.now() - last > 30 * 86400000) {
    setTimeout(() => toast('💾 셀린이 사진이 많이 쌓였어요! 설정(⚙️)에서 백업해 둘까요?', 5000), 6000);
  }
}

// 앱을 지웠다가 다시 설치하면: 예전 기록을 지우고 처음부터 (실수로 지운 경우를 위해 한 번 물어봐요)
async function freshInstall() {
  if (state.store?.mode !== 'local') return;
  const n = await countLocalMoments();
  if (n > 0 && !confirm(`이 휴대폰에 예전 셀린 우체국 기록이 ${n}개 남아 있어요.

[확인] 지우고 처음부터 새로 시작
[취소] 예전 기록 그대로 쓰기`)) return;
  await wipeLocal(state.store);
  setTimeout(() => location.reload(), 300);
}

function months() { return ageInfo(state.profile?.birth)?.months ?? 0; }

function renderHeader() {
  const name = state.profile?.name;
  $('mainTitle').textContent = BRAND.title;
  $('mainAge').textContent = ageLabel(ageInfo(state.profile?.birth));
  document.title = BRAND.appName;
  void name;
}

function renderWeek() {
  const box = $('weekDots');
  box.innerHTML = '';
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dateKey(d);
    const m = state.moments.find(x => x.date === key);
    if (m) count++;
    const el = document.createElement('div');
    el.className = 'd' + (key === dateKey() ? ' today' : '');
    el.innerHTML = `<span class="dot ${m ? 'on' : ''}">${m ? stickerHTML(m.sticker) : ''}</span><span>${names[i]}</span>`;
    box.appendChild(el);
  }
  box.title = `이번 주 엽서 ${count}장`;
}

function buildGlass() {
  const glass = $('machineGlass');
  glass.innerHTML = '';
  const w = glass.clientWidth || 280;
  const rows = [[4, 6], [4, 40], [3, 74]];
  const stamps = PHOTO_CARDS.map(c => `faces/${c[0]}.jpg`);
  const colors = ['#FFF6E8', '#FFE9E4', '#EAF6FF', '#FFF4CF', '#F1EAFF', '#E9F8EE'];
  let n = 0;
  for (const [count, bottom] of rows) {
    const step = (w - 66) / Math.max(1, count - 1);
    for (let i = 0; i < count; i++) {
      const e = document.createElement('div');
      e.className = 'env-mini';
      e.style.setProperty('--c', colors[(n * 5) % colors.length]);
      e.style.left = Math.min(w - 66, 2 + i * step + (Math.random() * 10 - 5)) + 'px';
      e.style.bottom = bottom + Math.random() * 6 + 'px';
      e.style.transform = `rotate(${Math.random() * 24 - 12}deg)`;
      const st = stamps[Math.floor(Math.random() * stamps.length)];
      e.innerHTML = n % 3 === 0 && st ? `<b><img src="${st}" alt="" /></b>` : '<i></i>';
      glass.appendChild(e);
      n++;
    }
  }
}

function setEnergy(e, sound = true) {
  state.energy = e;
  LS.set('energy', e);
  for (const c of document.querySelectorAll('.chip')) {
    const on = Number(c.dataset.energy) === e;
    c.classList.toggle('active', on);
    c.setAttribute('aria-checked', on);
  }
  if (sound) {
    sfx.tap();
    buzz(10);
    // 컨디션에 따라 셀린 표정이 잠깐 바뀌어요
    setExpression(e === 1 ? '😴' : e === 3 ? '😆' : '🥰');
    clearTimeout(setEnergy.t);
    setEnergy.t = setTimeout(() => { if (!state.busy) setExpression(null); }, 1400);
  }
}
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => setEnergy(Number(c.dataset.energy))));

function resetMachine() {
  $('tray').innerHTML = '';
  $('tray').classList.remove('on');
  $('machineFace').classList.remove('happy');
  $('machineAvatar').classList.remove('happy');
  setExpression(null);
  const has = !!state.photo;
  $('bigButton').disabled = !has;
  $('photoSlot').classList.toggle('filled', has && !!state.photo.thumb);
  $('slotThumb').hidden = !(has && state.photo.thumb);
  $('videoBadge').hidden = !state.photo?.video;
  if (has && state.photo.thumb) $('slotThumb').src = state.photo.thumb;
  $('noPhotoBtn').hidden = has;
  const doneToday = state.moments.some(m => m.date === dateKey());
  $('machineHint').textContent = has
    ? (doneToday ? '한 통 더 받아 볼까요? 부치기를 눌러 주세요 💌' : '엽서 준비 완료! 부치기를 눌러 주세요 📮')
    : BRAND.tagline;
  state.busy = false;
}

// ───── 사진 넣기 ─────
$('photoSlot').addEventListener('click', () => { if (!state.busy) $('photoInput').click(); });
$('photoInput').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const isVideo = file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name);
  loading(true, isVideo ? '🎥 동영상을 엽서에 담는 중…' : '');
  try {
    const photo = isVideo ? await processVideo(file) : await processImage(file);
    loading(false);
    await flyPhotoIntoSlot(photo.thumb);
    state.photo = photo;
    sfx.insert();
    buzz([15, 40, 15]);
    resetMachine();
  } catch (err) {
    console.error(err);
    loading(false);
    toast('사진을 읽지 못했어요. 다른 사진으로 해 볼까요?');
  }
});
$('noPhotoBtn').addEventListener('click', () => {
  state.photo = { thumb: null, full: null };
  sfx.insert();
  resetMachine();
  $('machineHint').textContent = '부치기를 눌러 주세요! 📮';
});

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 캔버스로 다시 그리면 위치정보(EXIF)가 모두 사라져요
function resize(img, max, quality) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// 매일 사진으로 3:4 포토카드 만들기 (가운데를 잘라요)
async function makeDayCard(src) {
  const img = await loadImg(src);
  const W = img.naturalWidth, H = img.naturalHeight;
  let w = W, h = w * 4 / 3;
  if (h > H) { h = H; w = h * 3 / 4; }
  const c = document.createElement('canvas');
  c.width = 480; c.height = 640;
  c.getContext('2d').drawImage(img, (W - w) / 2, Math.max(0, (H - h) * 0.35), w, h, 0, 0, 480, 640);
  return c.toDataURL('image/jpeg', 0.82);
}

// 앱을 열 때 이미 모은 매일 사진 카드 그림을 불러와요
const dayStampIds = () => [...new Set(state.moments.flatMap(m => [
  ...(m.dayStamp ? [m.id] : []), ...(isDayCard(m.sticker) ? [m.sticker.slice(3)] : []),
]))];
async function loadDayCards() {
  const ids = dayStampIds();
  await Promise.all(ids.map(async id => {
    if (dayCardCache.has(id)) return;
    const d = await state.store.getCardImage(id).catch(() => null);
    if (d) dayCardCache.set(id, d);
  }));
}

async function processImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    let full = resize(img, 1280, 0.8);
    if (full.length > 900_000) full = resize(img, 1080, 0.7);
    if (full.length > 900_000) full = resize(img, 900, 0.6);
    const thumb = resize(img, 320, 0.7);
    return { thumb, full };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ───── 동영상: 15초까지 작게 줄여서 담아요 (가족 모두 어느 휴대폰에서나 볼 수 있게) ─────
const VIDEO_MAX = 15;
function pickRecorderType() {
  if (!window.MediaRecorder) return '';
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}
async function processVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.muted = true; v.preload = 'auto';
  v.setAttribute('playsinline', '');
  try {
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('video')); });
    const dur = Math.min(VIDEO_MAX, v.duration || VIDEO_MAX);
    // 대표 사진 (엽서 · 카드 · 우표에 쓰여요)
    v.currentTime = Math.min(0.5, dur / 3);
    await new Promise(ok => { v.onseeked = ok; });
    const W = v.videoWidth, H = v.videoHeight;
    const pc = document.createElement('canvas');
    const ps = Math.min(1, 1280 / Math.max(W, H));
    pc.width = Math.round(W * ps); pc.height = Math.round(H * ps);
    pc.getContext('2d').drawImage(v, 0, 0, pc.width, pc.height);
    const poster = await loadImg(pc.toDataURL('image/jpeg', 0.85));
    const thumb = resize(poster, 320, 0.7);
    const full = resize(poster, 1280, 0.8);

    // 작게 다시 녹화 (긴 쪽 480px · 15초까지)
    const type = pickRecorderType();
    let blob = null;
    if (type && HTMLCanvasElement.prototype.captureStream) {
      const s = Math.min(1, 480 / Math.max(W, H));
      const c = document.createElement('canvas');
      c.width = Math.round(W * s / 2) * 2; c.height = Math.round(H * s / 2) * 2;
      const g = c.getContext('2d');
      const stream = c.captureStream(24);
      // 소리는 파일에서 따로 꺼내서 함께 담아요 (스피커로는 안 나와요)
      let audioSrc = null;
      try {
        const a = audioCtx();
        if (a.state !== 'running') await a.resume();
        const abuf = await new Promise((ok, no) => file.arrayBuffer().then(ab => a.decodeAudioData(ab, ok, no), no));
        const dest = a.createMediaStreamDestination();
        audioSrc = a.createBufferSource();
        audioSrc.buffer = abuf;
        audioSrc.connect(dest);
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      } catch { audioSrc = null; /* 소리가 없는 동영상이면 그림만 담아요 */ }
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 650000, audioBitsPerSecond: 64000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise(ok => { rec.onstop = ok; });
      v.currentTime = 0;
      await new Promise(ok => { v.onseeked = ok; });
      g.drawImage(v, 0, 0, c.width, c.height);
      rec.start(500);
      await v.play();
      audioSrc?.start(audioSrc.context.currentTime, 0, dur);
      await new Promise(ok => {
        let done = false;
        const finish = () => { if (done) return; done = true; v.pause(); ok(); };
        v.addEventListener('ended', finish, { once: true });
        setTimeout(finish, (dur + 4) * 1000); // 혹시 멈춰도 끝나게
        const draw = () => {
          if (done) return;
          g.drawImage(v, 0, 0, c.width, c.height);
          $('loadingMsg').textContent = `🎥 동영상을 엽서에 담는 중… ${Math.min(dur, v.currentTime).toFixed(0)} / ${dur.toFixed(0)}초`;
          if (v.ended || v.currentTime >= dur) { finish(); return; }
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else setTimeout(draw, 33);
        };
        draw();
      });
      try { audioSrc?.stop(); } catch { /* 이미 끝났어요 */ }
      rec.stop();
      await stopped;
      blob = new Blob(chunks, { type: type.split(';')[0] });
    }
    // 줄이지 못하는 휴대폰: 작은 동영상만 그대로 담아요
    if (!blob || blob.size < 1000) {
      if (file.size <= 6 * 1024 * 1024 && v.duration <= VIDEO_MAX + 1) blob = file;
      else { toast('이 휴대폰에서는 긴 동영상을 줄일 수 없어서 사진만 담았어요 📷', 4000); return { thumb, full }; }
    }
    if (v.duration > VIDEO_MAX + 0.5) toast(`동영상은 앞에서부터 ${VIDEO_MAX}초까지만 담겨요 🎥`, 3500);
    return { thumb, full, video: blob };
  } finally {
    v.pause();
    URL.revokeObjectURL(url);
  }
}

function flyPhotoIntoSlot(src) {
  return new Promise(resolve => {
    const slot = $('photoSlot').getBoundingClientRect();
    const img = document.createElement('img');
    img.className = 'flying-photo';
    img.src = src;
    const size = Math.min(window.innerWidth * 0.6, 260);
    Object.assign(img.style, {
      width: size + 'px', height: size + 'px',
      left: (window.innerWidth - size) / 2 + 'px', top: (window.innerHeight - size) / 2 + 'px',
      transform: 'rotate(-8deg)',
    });
    document.body.appendChild(img);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Object.assign(img.style, {
        width: slot.width * 0.5 + 'px', height: slot.width * 0.5 + 'px',
        left: slot.left + slot.width * 0.25 + 'px', top: slot.top - 10 + 'px',
        transform: 'rotate(0deg) scale(.6)', opacity: '0.2',
      });
    }));
    setTimeout(() => { img.remove(); resolve(); }, 720);
  });
}

// ───── 부치기! ─────
// 엽서가 우체통으로 쏙 → 덜컹 → 새가 편지를 물고 와요
function postcardIntoMailbox() {
  return new Promise(resolve => {
    const from = $('photoSlot').getBoundingClientRect();
    const to = document.querySelector('.mailbox-slot').getBoundingClientRect();
    const card = document.createElement('div');
    card.className = 'flying-photo';
    const thumb = state.photo?.thumb;
    Object.assign(card.style, {
      width: from.width * 0.8 + 'px', height: from.height * 0.8 + 'px', left: from.left + from.width * 0.1 + 'px', top: from.top + 'px',
      background: thumb ? `#fff url(${thumb}) center / cover` : '#FFFDF8', border: '5px solid #fff', borderRadius: '8px',
    });
    if (!thumb) card.textContent = '💌';
    document.body.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      Object.assign(card.style, {
        width: to.width * 0.7 + 'px', height: '18px', left: to.left + to.width * 0.15 + 'px', top: to.top - 4 + 'px',
        transform: 'rotate(0deg)', opacity: '0.3',
      });
    }));
    setTimeout(() => { card.remove(); resolve(); }, 720);
  });
}

$('bigButton').addEventListener('click', async () => {
  if (state.busy || !state.photo) return;
  state.busy = true;
  $('bigButton').disabled = true;
  $('machineHint').textContent = '엽서를 부치는 중… 📮';
  const machine = $('machine');
  machine.classList.add('gulp');
  await postcardIntoMailbox();
  sfx.slot();
  voice('send');
  machine.classList.remove('gulp');
  sfx.clunk();
  buzz([30, 60, 30, 60, 30]);
  machine.classList.remove('shake');
  void machine.offsetWidth;
  machine.classList.add('shake');
  $('machineGlass').classList.add('jiggle');
  $('machineFace').classList.add('happy');
  $('machineAvatar').classList.add('happy');
  setExpression('😮'); // 덜컹! 깜짝 놀란 셀린
  $('machineHint').textContent = '덜컹덜컹… 답장이 오고 있어요!';

  // 도장판 10칸째 편지는 무조건 특급 편지!
  const golden = Math.random() < GOLDEN_CHANCE || state.moments.length % 10 === 9;
  const mission = pickMission({
    months: months(), level: state.profile?.level || 0, energy: state.energy, history: state.moments,
  });
  state.current = { mission, golden, rerollsLeft: REROLLS_PER_CAPSULE };

  setTimeout(() => {
    $('machineGlass').classList.remove('jiggle');
    machine.classList.remove('shake');
    deliverLetter(golden);
  }, 1000);
});

function deliverLetter(golden) {
  const tray = $('tray');
  tray.innerHTML = '';
  tray.classList.add('on');
  const bird = document.createElement('div');
  bird.className = 'bird';
  bird.textContent = '🐦';
  tray.appendChild(bird);
  sfx.bird();
  setTimeout(() => tray.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  setTimeout(() => {
    const letter = document.createElement('button');
    letter.type = 'button';
    letter.className = 'letter drop' + (golden ? ' golden' : '');
    letter.setAttribute('aria-label', '편지 열기');
    const st = PHOTO_CARDS[Math.floor(Math.random() * PHOTO_CARDS.length)]?.[0];
    letter.innerHTML = `<span class="body"></span><span class="paper">${golden ? '✨ 특급 ✨' : '💌'}</span>`
      + `<span class="flap"></span><span class="seal">${golden ? '★' : '♥'}</span>`
      + (st ? `<span class="ltr-stamp"><img src="faces/${st}.jpg" alt="" /></span>` : '');
    tray.appendChild(letter);
    sfx.drop();
    buzz(40);
    bird.classList.add('away');
    setTimeout(() => bird.remove(), 900);
    setTimeout(() => {
      letter.classList.remove('drop');
      letter.classList.add('idle');
      const label = document.createElement('span');
      label.className = 'tap-label';
      label.textContent = golden ? '✨ 특급 편지! 톡 눌러 열기' : '톡 눌러서 편지 열기';
      tray.appendChild(label);
      $('machineHint').textContent = golden ? `와! ${BRAND.baby}에게 특급 편지가 왔어요 ✨` : `${BRAND.baby}에게 편지가 왔어요! 💌`;
      setExpression('🙈'); // 두근두근
      if (golden) { sfx.golden(); confetti(30, true); voice('golden'); }
      letter.addEventListener('click', () => openLetter(letter, label), { once: true });
    }, 720);
  }, 900);
}

function openLetter(letter, label) {
  label.remove();
  letter.classList.remove('idle');
  letter.classList.add('open');
  sfx.paper();
  sfx.pop();
  buzz(25);
  confetti(state.current.golden ? 70 : 24, state.current.golden);
  setExpression('😆');
  voice('open');
  $('machineHint').textContent = '오늘의 놀이 편지예요! 💌';
  setTimeout(() => { if (state.current) showMission(); }, 650);
}

// 미션 성공 도장 꽝!
function stampPostmark() {
  const pm = $('postmark');
  const d = new Date();
  const n = state.moments.length;
  pm.innerHTML = `셀린 우체국<b>참 잘했어요</b>${d.getMonth() + 1}.${d.getDate()} · ${n}번째`;
  pm.classList.remove('stamp');
  void pm.offsetWidth;
  setTimeout(() => { pm.classList.add('stamp'); buzz([10, 30, 60]); sfx.stamp(); }, 250);
  setTimeout(() => sfx.sparkle(), 700);
  if (n > 0 && n % 10 === 0) setTimeout(() => { sfx.fanfare(); confetti(70, true); toast('🎉 도장판 한 장 완성! 다음 편지는 특급 편지예요 ✨', 4000); }, 1400);
  else if (n % 10 === 9) setTimeout(() => toast('도장 한 칸만 더 모으면 특급 편지가 와요! ✨', 3500), 1400);
}

// ───── 미션 시트 ─────
function showMission() {
  const { mission, golden } = state.current;
  const name = state.profile?.name;
  $('stepMission').hidden = false;
  $('stepDiary').hidden = true;
  $('stepCard').hidden = true;
  const pf = reactFace('😆') || mainFace();
  $('pickFace').hidden = !pf;
  if (pf) $('pickFace').src = pf;
  $('mGolden').hidden = !golden;
  const d = DOMAINS[mission.domain];
  $('mDomain').textContent = `${d.icon} ${d.label}`;
  $('mTime').textContent = `⏱ ${mission.minutes}분`;
  $('mPlace').textContent = PLACES[mission.place];
  $('missionTitle').textContent = fillName(mission.title, name);
  $('mHow').textContent = fillName(mission.how, name);
  $('mWhy').textContent = fillName(mission.why, name);
  $('mSafety').hidden = !mission.safety;
  $('mSafety').textContent = mission.safety ? `⚠️ ${mission.safety}` : '';
  if ($('missionSheet').hidden) openSheet('missionSheet');
}

$('rerollBtn').addEventListener('click', () => {
  const cur = state.current;
  if (!cur) return;
  cur.mission = pickMission({
    months: months(), level: state.profile?.level || 0, energy: state.energy,
    history: state.moments, excludeId: cur.mission.id,
  });
  sfx.pop();
  buzz(15);
  const title = $('missionTitle');
  title.style.animation = 'none';
  void title.offsetWidth;
  title.style.animation = 'pop .45s ease';
  showMission();
});

$('laterBtn').addEventListener('click', () => {
  closeSheets();
  state.current = null;
  resetMachine();
  setExpression('😴');
  voice('rest');
  setTimeout(() => setExpression(null), 2500);
  toast('오늘도 충분히 잘하고 있어요 💛', 3000);
});

$('doneBtn').addEventListener('click', () => {
  sfx.yay();
  buzz([20, 40, 20]);
  confetti(30);
  state.reaction = null;
  document.querySelectorAll('.react').forEach(r => r.classList.remove('active'));
  $('stepMission').hidden = true;
  $('stepDiary').hidden = false;
  $('missionSheet').scrollTop = 0;
});

// 셀린 기분을 톡 누르면 바로 카드가 만들어져요
document.querySelectorAll('.react').forEach(r => r.addEventListener('click', () => {
  if (state.saving) return;
  state.reaction = r.dataset.react;
  document.querySelectorAll('.react').forEach(x => x.classList.toggle('active', x === r));
  sfx.tap();
  buzz(10);
  saveMoment();
}));

async function saveMoment() {
  const cur = state.current;
  if (!cur || state.saving) return;
  state.saving = true;
  const owned = stickerCounts();
  let sticker = drawSticker({ golden: cur.golden, owned, count: state.moments.length, cardIds: PHOTO_CARDS.map(c => c[0]) });
  // 엄마가 그동안 넣은 사진(오늘 사진 포함) 중 아직 카드가 안 된 사진이 있으면, 포토카드의 절반은 그 사진으로!
  const newId_ = newId();
  let dayCardSrc = null;
  // 사진(동영상 대표 사진 포함)을 부치면 그 사진은 무조건 '하루 우표'가 돼요 (같은 사진을 또 넣으면 빼고)
  const usedKeys = new Set(state.moments.filter(m => m.photoKey && (m.dayStamp || isDayCard(m.sticker))).map(m => m.photoKey));
  const todayKey = photoKey(state.photo?.thumb);
  if (state.photo?.full && !(todayKey && usedKeys.has(todayKey))) dayCardSrc = await makeDayCard(state.photo.full).catch(() => null);
  if (sticker === 'pc:done') {
    sticker = drawSticker({ golden: cur.golden, owned, count: state.moments.length, cardIds: [], noCards: true });
  }
  const isNew = !owned[sticker];
  const info = ageInfo(state.profile?.birth);
  const moment = {
    id: newId_,
    ts: Date.now(),
    date: dateKey(),
    missionId: cur.mission.id,
    title: fillName(cur.mission.title, state.profile?.name),
    domain: cur.mission.domain,
    energy: state.energy,
    golden: cur.golden,
    reaction: state.reaction || '',
    diary: '',
    word: '',
    first: false,
    firstText: '',
    sticker,
    shiny: SHINY.includes(sticker) || isAnyCard(sticker),
    months: info?.months ?? null,
    hasPhoto: !!state.photo?.full,
    hasVideo: !!state.photo?.video,
    dayStamp: !!dayCardSrc,
    photoKey: state.photo?.thumb ? photoKey(state.photo.thumb) : '',
  };

  // 저장은 뒤에서 조용히 하고, 카드는 바로 보여 줘요
  const video = state.photo?.video;
  if (dayCardSrc) dayCardCache.set(moment.id, dayCardSrc);
  (async () => {
    await state.store.addMoment(moment, state.photo?.thumb, state.photo?.full);
    if (dayCardSrc) await state.store.saveCardImage(moment.id, dayCardSrc);
    if (video) {
      try { await state.store.saveVideo(moment.id, video); toast('🎥 동영상도 가족 우체통에 잘 올라갔어요!'); }
      catch (err) { toast(err?.message || '동영상을 올리지 못했어요. 사진은 잘 저장됐어요!', 4000); }
    }
  })().catch(e => { console.error(e); toast('인터넷이 연결되면 자동으로 저장돼요 📮', 4000); });
  if (state.photo?.thumb) thumbCache.set(moment.id, state.photo.thumb);
  state.moments.unshift(moment);
  state.lastMoment = { moment, photo: state.photo?.full };
  state.current = null;

  if (isDayCard(sticker)) {
    $('stickerGet').innerHTML = `<span class="big photo-card-get">${stickerHTML(sticker, 'pc-big')}</span>📷 ${isNew ? '셀린의 하루 우표 획득!' : '하루 우표 한 장 더!'}<small class="pc-name">「${dayCardTitle(sticker)}」</small>`;
  } else if (isPhotoCard(sticker)) {
    $('stickerGet').innerHTML = `<span class="big photo-card-get">${stickerHTML(sticker, 'pc-big')}</span>${isHolo(sticker) ? '✨' : '📸'} ${isNew ? (isHolo(sticker) ? '반짝이 우표 획득!!' : '셀린 우표 획득!') : '우표 한 장 더!'}<small class="pc-name">「${cardTitle(sticker)}」</small>`;
  } else {
    $('stickerGet').innerHTML = `<span class="big ${moment.shiny ? 'shiny' : ''}">${sticker}</span>${isNew ? (moment.shiny ? '✨ 반짝이 스티커 획득!' : '🎉 새 스티커 획득!') : '스티커 +1'}`;
  }
  setExpression('🎉');
  if (moment.dayStamp) {
    $('stickerGet').insertAdjacentHTML('beforeend', `<div class="day-stamp-get">${stickerHTML('mc:' + moment.id, 'pc-big')}<small>📷 오늘 사진이 <b>하루 우표</b>가 됐어요!</small></div>`);
  }
  stampPostmark();
  voice('card', 0.3);
  $('stepDiary').hidden = true;
  $('stepCard').hidden = false;
  $('missionSheet').scrollTop = 0;
  await drawCard($('cardCanvas'), { moment: withNote(moment), photo: state.photo?.full, profile: cardProfile() });
  loading(false);
  state.saving = false;
  sfx.golden();
  confetti(isNew ? 80 : 40, moment.shiny);
  buzz([30, 50, 30]);
  renderWeek();
}

$('shareCardBtn').addEventListener('click', async () => {
  const m = state.lastMoment?.moment;
  const r = await shareCanvas($('cardCanvas'), `셀린우체국_${m?.date || dateKey()}.jpg`);
  if (r === 'downloaded') toast('카드를 저장했어요 💾');
});
$('closeCardBtn').addEventListener('click', () => { closeSheets(); resetMachine(); });

// ───────────────────────── 탭 전환 ─────────────────────────
function switchView(view) {
  if (!['draw', 'diary', 'dex', 'guest', 'words'].includes(view)) view = 'draw';
  LS.set('view', view);
  curView = view;
  syncBack();
  for (const b of document.querySelectorAll('.tabbar-btn')) b.classList.toggle('active', b.dataset.view === view);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  if (view === 'diary') renderDiary();
  if (view === 'dex') renderDex();
  if (view === 'words') renderWords();
  if (view === 'guest') renderGuest();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar-btn').forEach(b => b.addEventListener('click', () => { sfx.tap(); switchView(b.dataset.view); }));

// ───────────────────────── 기록 ─────────────────────────
async function thumbOf(id) {
  if (thumbCache.has(id)) return thumbCache.get(id);
  const t = await state.store.getThumb(id).catch(() => null);
  thumbCache.set(id, t);
  return t;
}

let diaryMode = 'cal';
document.querySelectorAll('[data-diary-mode]').forEach(b => b.addEventListener('click', () => {
  diaryMode = b.dataset.diaryMode;
  sfx.tap();
  renderDiary();
}));

let albumFilter = 'all';
document.querySelectorAll('[data-af]').forEach(b => b.addEventListener('click', () => {
  albumFilter = b.dataset.af;
  sfx.tap();
  renderAlbum();
}));
function renderAlbum() {
  const grid = $('albumGrid');
  grid.innerHTML = '';
  for (const b of document.querySelectorAll('[data-af]')) b.classList.toggle('active', b.dataset.af === albumFilter);
  const withPhoto = state.moments.filter(m => m.hasPhoto && (albumFilter === 'all' || (albumFilter === 'video' ? m.hasVideo : !m.hasVideo)));
  $('albumCount').textContent = withPhoto.length
    ? (albumFilter === 'video' ? `동영상 ${withPhoto.length}개가 모였어요 🎥` : albumFilter === 'photo' ? `사진 ${withPhoto.length}장이 모였어요 📷` : `사진·동영상 ${withPhoto.length}개가 날짜별로 모였어요 💌`)
    : (albumFilter === 'video' ? '엽서에 동영상을 붙여 부치면 여기에 날짜별로 모여요 🎥' : '엽서로 부친 셀린이 사진이 여기에 날짜별로 차곡차곡 모여요 💌');
  // 날짜별로 정리: 최근 날짜가 위로, 달이 바뀌면 달 제목
  const byDate = new Map();
  for (const mo of [...withPhoto].sort((a, b) => (b.date === a.date ? b.ts - a.ts : b.date < a.date ? -1 : 1))) {
    if (!byDate.has(mo.date)) byDate.set(mo.date, []);
    byDate.get(mo.date).push(mo);
  }
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  let lastMonth = '';
  for (const [date, list] of byDate) {
    const d = parseKey(date);
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      const mh = document.createElement('h3');
      mh.className = 'album-month';
      mh.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      grid.appendChild(mh);
    }
    const age = ageLabel(ageInfo(state.profile?.birth, d));
    const head = document.createElement('p');
    head.className = 'album-day';
    head.innerHTML = `<b>${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})</b>${age ? ` <span>· ${age}</span>` : ''}`;
    grid.appendChild(head);
    const row = document.createElement('div');
    row.className = 'album-row';
    for (const mo of list) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'album-cell';
      cell.innerHTML = `<img alt="" /><span class="ar">${mo.first ? '⭐' : mo.reaction || ''}</span>${mo.hasVideo ? '<span class="av">🎥</span>' : ''}`;
      thumbOf(mo.id).then(src => { if (src) cell.querySelector('img').src = src; });
      cell.addEventListener('click', () => openMoment(mo));
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

// ───── 셀린이 취향 리포트 ─────
// 반응 점수: 좋아할수록 높아요
const REACT_SCORE = { '😆': 3, '🥰': 3, '🎉': 3, '😮': 2, '🙈': 2, '😐': 1, '😴': 1, '😭': 0 };
function renderTaste() {
  const box = $('tasteBox');
  const done = state.moments.filter(m => m.reaction && m.domain && REACT_SCORE[m.reaction] != null);
  if (done.length < 3) {
    box.innerHTML = `<div class="taste-card"><h3>📊 ${BRAND.baby}이 취향 리포트</h3><p>편지 미션을 하고 반응을 3번 이상 남기면,<br />${BRAND.baby}이가 어떤 놀이를 좋아하는지 알려 드릴게요! (지금 ${done.length}번)</p></div>`;
    return;
  }
  const by = {};
  for (const m of done) (by[m.domain] ||= []).push(REACT_SCORE[m.reaction]);
  const rows = Object.entries(by).map(([d, xs]) => ({ d, n: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n);
  const top = rows.filter(r => r.avg >= 2).slice(0, 2);
  const best = [...done].filter(m => REACT_SCORE[m.reaction] >= 3).sort((a, b) => b.ts - a.ts).slice(0, 5);
  const low = rows.filter(r => r.avg < 1.5);
  const name = d => `${DOMAINS[d]?.icon || ''} ${DOMAINS[d]?.label || d}`;
  box.innerHTML = `
    <div class="taste-card">
      <h3>📊 ${BRAND.baby}이 취향 리포트</h3>
      <p>지금까지 ${done.length}번의 반응으로 살펴봤어요</p>
      <div class="taste-top">${top.length ? `${BRAND.baby}이는 <b>${top.map(r => name(r.d)).join('</b>와 <b>')}</b>를<br />제일 좋아해요! 💛` : '아직은 고르게 좋아하고 있어요 🙂'}</div>
      ${rows.map(r => `<div class="taste-row"><span>${name(r.d)}</span><div class="taste-bar"><i style="width:${Math.round(r.avg / 3 * 100)}%"></i></div><span>${r.n}번</span></div>`).join('')}
      ${low.length ? `<p style="margin-top:10px">${low.map(r => name(r.d)).join(', ')}는 아직 조금 낯설어해요. 천천히 해 봐요 🌱</p>` : ''}
    </div>
    ${best.length ? `<div class="taste-card"><h3>😆 최근에 제일 좋아한 놀이</h3><div class="taste-best">${best.map(m => `<div>${m.reaction} ${m.title}<br /><small>${prettyDate(m.date)}</small></div>`).join('')}</div></div>` : ''}`;
}

function renderDiary() {
  renderMemory();
  for (const b of document.querySelectorAll('[data-diary-mode]')) b.classList.toggle('active', b.dataset.diaryMode === diaryMode);
  $('albumBox').hidden = diaryMode !== 'album';
  $('calBox').hidden = diaryMode !== 'cal';
  $('tasteBox').hidden = diaryMode !== 'taste';
  if (diaryMode === 'album') { renderAlbum(); return; }
  if (diaryMode === 'taste') { renderTaste(); return; }
  const month = state.calMonth;
  const y = month.getFullYear(), m = month.getMonth();
  $('calTitle').textContent = `${y}년 ${m + 1}월`;
  const grid = $('calGrid');
  grid.innerHTML = '';
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const todayKey = dateKey();
  for (let i = 0; i < first; i++) grid.appendChild(Object.assign(document.createElement('div'), { className: 'cal-cell empty' }));
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const dayMoments = state.moments.filter(x => x.date === key);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell' + (key === todayKey ? ' today' : '') + (dayMoments.length ? ' has' : '');
    cell.innerHTML = `<span class="n">${d}</span>`;
    if (dayMoments.length) {
      const top = dayMoments.find(x => x.hasPhoto) || dayMoments[0];
      if (dayMoments.some(x => x.first)) cell.insertAdjacentHTML('beforeend', '<span class="star">⭐</span>');
      if (dayMoments.some(x => x.hasVideo)) cell.insertAdjacentHTML('beforeend', '<span class="cal-vid">🎥</span>');
      if (top.hasPhoto) {
        thumbOf(top.id).then(src => { if (src) cell.insertAdjacentHTML('afterbegin', `<img src="${src}" alt="" />`); });
      } else {
        // 사진 없이 부친 날은 그날 반응 얼굴(없으면 메인 얼굴) 사진으로
        const face = reactFace(top.reaction) || mainFace();
        if (face) cell.insertAdjacentHTML('afterbegin', `<img src="${face}" alt="" class="cal-face" />`);
      }
      cell.addEventListener('click', () => openMoment(top));
    }
    grid.appendChild(cell);
  }

  const list = $('momentList');
  list.innerHTML = '';
  const inMonth = state.moments.filter(x => x.date.startsWith(`${y}-${pad(m + 1)}`));
  if (!inMonth.length) {
    list.innerHTML = '<div class="empty-note">이번 달은 아직 편지가 없어요.<br />우체국 탭에서 첫 엽서를 부쳐 볼까요? 📮</div>';
    return;
  }
  for (const mo of inMonth) list.appendChild(momentItem(mo));
}

function momentItem(mo) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'moment-item';
  btn.innerHTML = `
    <img alt="" />
    <div class="mi-body">
      <div class="mi-date">${prettyDate(mo.date)}${mo.first ? ' · ⭐ 처음!' : ''}${mo.golden ? ' · ✨' : ''}</div>
      <div class="mi-title"></div>
      <div class="mi-text"></div>
    </div>
    <div class="mi-react">${reactFace(mo.reaction) ? `<img src="${reactFace(mo.reaction)}" alt="${mo.reaction}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.12)" />` : mo.reaction || stickerHTML(mo.sticker || '')}</div>`;
  btn.querySelector('.mi-title').textContent = mo.title;
  btn.querySelector('.mi-text').textContent = mo.diary || mo.firstText || (mo.word ? `💬 "${mo.word}"` : '');
  const img = btn.querySelector('img');
  if (mo.hasPhoto) thumbOf(mo.id).then(src => { if (src) img.src = src; });
  else if (mainFace()) img.src = mainFace(); // 사진 없이 부친 날도 셀린이 얼굴로
  btn.addEventListener('click', () => openMoment(mo));
  return btn;
}

function renderMemory() {
  const box = $('memoryBox');
  const now = new Date();
  const candidates = [
    [new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), '1년 전 오늘'],
    [new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()), '한 달 전 오늘'],
    [new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7), '일주일 전 오늘'],
  ];
  for (const [d, label] of candidates) {
    const mo = state.moments.find(x => x.date === dateKey(d));
    if (!mo) continue;
    box.hidden = false;
    box.innerHTML = `<button type="button" class="memory"><img alt="" hidden /><div><b>🕰️ ${label}</b><span class="mi-title"></span></div></button>`;
    box.querySelector('.mi-title').textContent = mo.title;
    if (mo.hasPhoto) thumbOf(mo.id).then(src => { if (src) { const i = box.querySelector('img'); i.src = src; i.hidden = false; } });
    box.querySelector('button').addEventListener('click', () => openMoment(mo));
    return;
  }
  box.hidden = true;
}

$('calPrev').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); sfx.tap(); renderDiary(); });
$('calNext').addEventListener('click', () => { state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); sfx.tap(); renderDiary(); });

async function openMoment(mo) {
  state.openMoment = mo;
  renderCheers(mo);
  const mv = $('momentVideo');
  mv.pause();
  if (mv.src) { URL.revokeObjectURL(mv.src); mv.removeAttribute('src'); }
  mv.hidden = true;
  if (mo.hasVideo) {
    state.store.getVideo(mo.id).then(b => {
      if (!b || state.openMoment !== mo) return;
      mv.src = URL.createObjectURL(b);
      mv.hidden = false;
    }).catch(() => {});
  }
  openSheet('momentSheet');
  loading(true);
  let photo = null;
  if (mo.hasPhoto) photo = (await state.store.getPhoto(mo.id).catch(() => null)) || (await thumbOf(mo.id));
  await drawCard($('momentCanvas'), { moment: withNote(mo), photo, profile: cardProfile() });
  loading(false);
}
$('closeMomentBtn').addEventListener('click', closeSheets);
$('shareMomentBtn').addEventListener('click', async () => {
  const r = await shareCanvas($('momentCanvas'), `셀린우체국_${state.openMoment?.date || dateKey()}.jpg`);
  if (r === 'downloaded') toast('카드를 저장했어요 💾');
});
$('deleteMomentBtn').addEventListener('click', async () => {
  const mo = state.openMoment;
  if (!mo || !confirm('이 순간을 지울까요? 지우면 되돌릴 수 없어요.')) return;
  loading(true);
  await state.store.deleteMoment(mo.id);
  state.moments = state.moments.filter(x => x.id !== mo.id);
  thumbCache.delete(mo.id);
  loading(false);
  closeSheets();
  renderDiary();
  renderWeek();
  toast('지웠어요');
});

// ───────────────────────── 도감 ─────────────────────────
function stickerCounts() {
  const counts = {};
  for (const m of state.moments) if (m.sticker) counts[m.sticker] = (counts[m.sticker] || 0) + 1;
  return counts;
}

function renderStampBoard() {
  const n = state.moments.length;
  const filled = n % 10;
  const rounds = Math.floor(n / 10);
  const cells = Array.from({ length: 10 }, (_, i) => {
    const on = i < filled;
    return `<div class="sb-cell${on ? ' on' : ''}${i === 9 ? ' last' : ''}">${on ? '참<br>잘함' : i === 9 ? '✨' : i + 1}</div>`;
  }).join('');
  const asc = [...state.moments].sort((a, b) => a.ts - b.ts);
  const done = Array.from({ length: rounds }, (_, i) => asc[i * 10 + 9]).filter(Boolean);
  const shelf = done.length
    ? `<div class="sb-shelf-title">🏅 완성한 도장판 ${done.length}장 <small>(끝없이 모을 수 있어요)</small></div><div class="sb-shelf">${done.map((m, i) => `<div class="sb-mini"><b>${i + 1}</b><small>${parseKey(m.date).getMonth() + 1}.${parseKey(m.date).getDate()}</small></div>`).reverse().join('')}</div>`
    : '';
  $('stampBoard').innerHTML = `<h3>📮 지금 도장판 · ${filled} / 10</h3>
    <p>편지 미션을 끝낼 때마다 도장이 꽝! <b>10칸을 채울 때마다 계속</b> ✨특급 편지가 와요. 특급 편지에서는 <b>반짝이 우표</b>가 나와요!<br />
    ${filled === 9 ? '🎉 다음 편지가 바로 특급 편지예요!' : `다음 특급 편지까지 ${9 - filled}통 남았어요.`}</p>
    <div class="sb-grid">${cells}</div>${shelf}`;
}

function renderDex() {
  renderStampBoard();
  const counts = stickerCounts();
  const cards = [...PHOTO_CARDS.map(([id]) => 'pc:' + id), ...PHOTO_CARDS.map(([id]) => 'pc:' + id + 'h')];
  const ownedCards = cards.filter(s => counts[s]).length;
  const ownedStickers = ALL_STICKERS.filter(s => counts[s]).length;
  const dayCount = dayStampIds().length;
  $('dexCount').innerHTML = `💌 지금까지 모은 우표 <b>${dayCount + ownedCards}장</b> · 🧸 스티커 <b>${ownedStickers}개</b><br /><small>사진을 부칠 때마다 하루 우표가 한 장씩 끝없이 늘어나요!</small>`;
  requestAnimationFrame(() => { $('dexBar').style.width = (ownedCards / cards.length * 100) + '%'; });
  $('pcCount').textContent = `특별 우표 ${ownedCards} / ${cards.length}`;
  $('stCount').textContent = `${ownedStickers} / ${ALL_STICKERS.length}`;

  // 셀린의 하루 카드 (엄마가 넣은 매일 사진)
  const byId = new Map(state.moments.map(m => [m.id, m]));
  const dayCards = dayStampIds().map(id => 'mc:' + id).sort((a, b) => (byId.get(b.slice(3))?.ts || 0) - (byId.get(a.slice(3))?.ts || 0));
  $('dcCount').textContent = `${dayCards.length}장 · 계속 늘어나요`;
  $('dcHint').textContent = dayCards.length
    ? '엽서에 붙인 사진이 한 장 한 장 우표가 됐어요. 새 사진을 부칠 때마다 한 장씩 더 생겨요 📷'
    : '엽서에 셀린이 사진을 붙여 부치면, 그 사진이 바로 우표가 돼요!';
  const dcGrid = $('dcGrid');
  dcGrid.innerHTML = '';
  for (const s of dayCards) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pc-cell is-day';
    cell.innerHTML = `${stickerHTML(s)}<span class="pc-label">${dayCardTitle(s)}</span>`;
    cell.addEventListener('click', () => showPhotoCard(s));
    dcGrid.appendChild(cell);
  }

  // 셀린 포토카드
  const pcGrid = $('pcGrid');
  pcGrid.innerHTML = '';
  cards.forEach((s, i) => {
    if (i === PHOTO_CARDS.length) {
      const h = document.createElement('p');
      h.className = 'pc-divider';
      h.textContent = '✨ 반짝이 우표 — 잘 안 나와요!';
      pcGrid.appendChild(h);
    }
    const cell = document.createElement('button');
    cell.type = 'button';
    const holo = isHolo(s);
    if (counts[s]) {
      cell.className = 'pc-cell' + (holo ? ' is-holo' : '');
      cell.innerHTML = `${stickerHTML(s)}<span class="pc-label">${cardTitle(s)}</span>${counts[s] > 1 ? `<span class="cnt">×${counts[s]}</span>` : ''}`;
      cell.addEventListener('click', () => showPhotoCard(s));
    } else {
      cell.className = 'pc-cell locked' + (holo ? ' is-holo' : '');
      cell.innerHTML = `<span class="pc-q">${holo ? '✨' : '?'}</span><span class="pc-label">No.${String(i + 1).padStart(3, '0')}</span>`;
      cell.addEventListener('click', () => toast(holo ? '반짝이 우표는 특급 편지에서 잘 나와요 ✨' : '편지 3통마다, 특급 편지에서, 가끔 깜짝 선물로 나와요 💌'));
    }
    pcGrid.appendChild(cell);
  });

  const grid = $('dexGrid');
  grid.innerHTML = '';
  ALL_STICKERS.forEach((s, i) => {
    const cell = document.createElement('div');
    const shiny = SHINY.includes(s);
    if (counts[s]) {
      cell.className = 'dex-cell' + (shiny ? ' shiny' : '');
      cell.innerHTML = `${s}${counts[s] > 1 ? `<span class="cnt">×${counts[s]}</span>` : ''}`;
    } else {
      cell.className = 'dex-cell locked';
      cell.textContent = shiny ? '✨' : i + 1;
    }
    grid.appendChild(cell);
  });
}

function showPhotoCard(s) {
  const box = $('pcView');
  box.innerHTML = `<div class="pc-view-card">${stickerHTML(s, 'pc-view-img')}<p>${isDayCard(s) ? '📷 ' + dayCardTitle(s) : '📸 ' + cardTitle(s)}</p></div>`;
  box.hidden = false;
  sfx.pop();
  box.onclick = () => { box.hidden = true; };
}

// ───────────────────────── 일기장 ─────────────────────────
const notesOnly = () => state.words.filter(w => w.type === 'note');
const wordsOnly = () => state.words.filter(w => w.type !== 'note' && w.type !== 'guest');
const guestsOnly = () => state.words.filter(w => w.type === 'guest');
// 그날 남긴 "오늘의 한 줄"을 카드에도 보여 줘요
function withNote(mo) {
  if (mo.diary) return mo;
  const n = notesOnly().filter(x => x.date === mo.date).sort((a, b) => a.ts - b.ts)[0];
  return n ? { ...mo, diary: n.text } : mo;
}

let noteMode = 'note';
document.querySelectorAll('[data-note-mode]').forEach(b => b.addEventListener('click', () => {
  noteMode = b.dataset.noteMode;
  sfx.tap();
  renderWords();
}));

function renderNotes() {
  const list = $('noteList');
  list.innerHTML = '';
  const notes = notesOnly();
  $('notesCount').textContent = notes.length
    ? `셀린이의 하루가 ${notes.length}줄 쌓였어요 📝`
    : '생각날 때 한 줄씩 남겨 두면 나중에 큰 보물이 돼요.';
  for (const n of notes) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'note';
    el.innerHTML = `<div class="nd"><span>${prettyDate(n.date)}</span><span>${n.months != null ? n.months + '개월' : ''}</span></div><p></p>`;
    el.querySelector('p').textContent = n.text;
    el.addEventListener('click', async () => {
      if (!confirm('이 한 줄을 지울까요?')) return;
      await state.store.deleteWord(n.id);
      state.words = state.words.filter(x => x.id !== n.id);
      renderNotes();
    });
    list.appendChild(el);
  }
}
$('noteAddForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('noteAddInput').value.trim();
  if (!text) return;
  const n = { id: newId(), type: 'note', text, ts: Date.now(), date: dateKey(), months: ageInfo(state.profile?.birth)?.months ?? null };
  $('noteAddInput').value = '';
  await state.store.addWord(n);
  state.words.unshift(n);
  sfx.pop();
  confetti(20);
  renderNotes();
});

function renderWords() {
  for (const b of document.querySelectorAll('[data-note-mode]')) b.classList.toggle('active', b.dataset.noteMode === noteMode);
  $('noteBox').hidden = noteMode !== 'note';
  $('wordBox').hidden = noteMode !== 'word';
  if (noteMode === 'note') { renderNotes(); return; }
  const cloud = $('wordCloud');
  cloud.innerHTML = '';
  const words = wordsOnly();
  $('wordsCount').textContent = words.length
    ? `지금까지 ${words.length}개의 말을 모았어요 💬`
    : '셀린이가 새로 한 말을 모아 두면 나중에 큰 보물이 돼요.';
  for (const w of words) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'word';
    const d = parseKey(w.date);
    el.innerHTML = `<b></b><small>${w.months != null ? w.months + '개월 · ' : ''}${d.getMonth() + 1}.${d.getDate()}</small>`;
    el.querySelector('b').textContent = w.text;
    el.addEventListener('click', async () => {
      if (!confirm(`"${w.text}"를 말 모음에서 지울까요?`)) return;
      await state.store.deleteWord(w.id);
      state.words = state.words.filter(x => x.id !== w.id);
      renderWords();
    });
    cloud.appendChild(el);
  }
}
$('wordAddForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('wordAddInput').value.trim();
  if (!text) return;
  const w = { id: newId(), text, ts: Date.now(), date: dateKey(), months: ageInfo(state.profile?.birth)?.months ?? null };
  $('wordAddInput').value = '';
  await state.store.addWord(w);
  state.words.unshift(w);
  sfx.pop();
  confetti(20);
  renderWords();
});

// ───────────────────────── 설정 ─────────────────────────
$('openSettings').addEventListener('click', () => {
  sfx.tap();
  $('setBgm').checked = LS.get('bgm', true);
  $('setLevel').value = String(state.profile?.level || 0);
  $('setSound').checked = LS.get('sound', true);
  $('accountInfo').textContent = state.user?.label || '';
  $('photoInfo').textContent = state.store.mode === 'cloud'
    ? '📷 사진은 우리 가족 아이디로만 볼 수 있어요. 사진 속 위치 정보는 자동으로 지워져요.'
    : '📷 사진은 이 휴대폰 안에만 저장되고, 사진 속 위치 정보는 자동으로 지워져요.';
  $('logoutBtn').hidden = state.store.mode === 'local';
  $('installTip').textContent = installTip();
  renderRfGrid();
  showBackupInfo();
  openSheet('settingsSheet');
});
$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const patch = { level: Number($('setLevel').value) };
  const sound = $('setSound').checked;
  LS.set('sound', sound);
  setSound(sound);
  const bgm = $('setBgm').checked;
  LS.set('bgm', bgm);
  setBgm(bgm);
  loading(true);
  await state.store.saveProfile(patch);
  state.profile = { ...state.profile, ...patch };
  loading(false);
  renderHeader();
  closeSheets();
  toast('저장했어요');
});
$('closeSettingsBtn').addEventListener('click', closeSheets);

// 유딩이모 편지 다시 보기
// ───── 기록 백업 (휴대폰 바꿀 때) ─────
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function showBackupInfo() {
  const at = LS.get('backupAt', 0);
  if (state.store.mode === 'cloud') {
    $('backupInfo').textContent = '☁️ 기록은 아이디에 자동으로 저장돼요. 휴대폰을 바꿔도 같은 아이디로 로그인하면 그대로예요! 백업 파일은 따로 한 번 더 보관하고 싶을 때만 쓰면 돼요.'
      + (at ? ` (마지막 백업: ${ymd(new Date(at))})` : '');
    return;
  }
  $('backupInfo').textContent = at
    ? `마지막 백업: ${ymd(new Date(at))} · 휴대폰을 바꾸면 새 휴대폰에서 "백업 불러오기"를 눌러 주세요.`
    : '셀린이 사진과 기록은 이 휴대폰에만 저장돼요. 가끔 백업 파일로 저장해 두세요!';
}
$('backupSave').addEventListener('click', async () => {
  if (!state.store.exportAll) return toast('지금은 백업할 수 없어요.');
  const btn = $('backupSave');
  btn.disabled = true;
  btn.textContent = '만드는 중…';
  try {
    const data = await state.store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `셀린우체국-백업-${ymd(new Date())}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '셀린 우체국 백업' }); done = true; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    if (!done) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    LS.set('backupAt', Date.now());
    showBackupInfo();
    toast(`💾 백업 완료! (기록 ${data.moments.length}개) 파일을 잘 보관해 주세요`, 4000);
  } catch {
    toast('백업 중에 문제가 생겼어요. 다시 해 주세요.');
  } finally {
    btn.disabled = false;
    btn.textContent = '백업 파일 저장';
  }
});
$('backupLoad').addEventListener('click', () => $('backupInput').click());
$('backupInput').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (!confirm('이 백업 파일의 기록을 불러올까요?\n지금 있는 기록은 지워지지 않고 합쳐져요.')) return;
  try {
    const n = await state.store.importAll(JSON.parse(await f.text()));
    toast(`✅ 기록 ${n}개를 불러왔어요!`, 3000);
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(err?.message?.includes('백업 파일') ? err.message : '파일을 읽지 못했어요. 셀린 우체국 백업 파일이 맞는지 확인해 주세요.', 4000);
  }
});

$('openLetterBtn').addEventListener('click', () => {
  const fam = state.family || { code: DEFAULT_FAMILY, ...FAMILIES[DEFAULT_FAMILY] };
  $('letterTo').textContent = fam.to || `${callName(fam.baby)}네 가족에게`;
  $('letterMsg').textContent = fam.message || '';
  $('letterFrom').textContent = fam.from ? `– ${fam.from}` : '';
  $('letterPhoto').hidden = !fam.photo;
  if (fam.photo) $('letterPhoto').src = fam.photo;
  sfx.pop();
  openSheet('letterSheet');
});
$('closeLetterBtn').addEventListener('click', closeSheets);
$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('로그아웃할까요? 기록은 그대로 남아 있어요.')) return;
  closeSheets();
  state.photo = null;
  state.moments = [];
  state.words = [];
  thumbCache.clear();
  await state.store.signOut();
});
$('sheetBackdrop').addEventListener('click', () => {
  if (!$('missionSheet').hidden) return; // 미션 중에는 실수로 닫히지 않게
  closeSheets();
});

function installTip() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return '📲 홈 화면에 추가하기: Safari 아래쪽 공유 버튼(□↑) → "홈 화면에 추가"';
  }
  if (/android/i.test(ua)) return '📲 홈 화면에 추가하기: 크롬 오른쪽 위 ⋮ → "홈 화면에 추가"';
  return '💻 PC에서는 주소창 오른쪽의 설치 아이콘으로 앱처럼 쓸 수 있어요.';
}

// 날짜가 바뀌면(자정이 지나면) 화면 새로 고침
let lastDay = dateKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.profile) return;
  if (dateKey() !== lastDay) {
    lastDay = dateKey();
    state.photo = null;
    renderHeader();
    renderWeek();
    resetMachine();
  }
});

boot();
