// 데이터 저장소
// - Firebase 설정이 있으면: 아이디 로그인 + 클라우드 저장 (기기 간 연동)
// - 없으면: 체험 모드 (이 기기의 IndexedDB 에만 저장)
import { FIREBASE_CONFIG, ID_DOMAIN } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// 앱을 새로 설치할 때: 이 휴대폰에 남은 예전 기록 수 / 전부 지우기
export async function countLocalMoments() {
  if (indexedDB.databases && !(await indexedDB.databases()).some(d => d.name === 'celine-post')) return 0;
  return new Promise(resolve => {
    const req = indexedDB.open('celine-post');
    req.onupgradeneeded = () => { req.transaction.abort(); };
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const c = db.transaction('moments').objectStore('moments').count();
        c.onsuccess = () => { db.close(); resolve(c.result); };
        c.onerror = () => { db.close(); resolve(0); };
      } catch { db.close(); resolve(0); }
    };
  });
}
export function wipeLocal(store, { keepSettings = false } = {}) {
  try { store?.db?.close?.(); } catch { /* 괜찮아요 */ }
  if (!keepSettings) try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('haru.')) localStorage.removeItem(k);
  } catch { /* 괜찮아요 */ }
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase('celine-post');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

// 로그인하기 전 이 휴대폰에만 있던 기록 → 계정으로 옮기기
export async function readLocalForMigration() {
  if ((await countLocalMoments()) === 0) return null;
  const local = new LocalStore();
  await local.init(() => {});
  local.db.onversionchange = null;
  const data = await local.exportAll();
  local.db.close();
  return data;
}
export const clearLocalData = () => wipeLocal(null, { keepSettings: true });

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function createStore() {
  // 개발용: 이 컴퓨터(localhost)에서 ?local=1 로 열면 로그인 없이 시험해요
  const devLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('local');
  return FIREBASE_CONFIG.apiKey && !devLocal ? new CloudStore() : new LocalStore();
}

// ───────────────────────── 체험 모드 ─────────────────────────
class LocalStore {
  mode = 'local';

  async init(onAuth) {
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('celine-post', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        for (const name of ['moments', 'thumbs', 'photos', 'words', 'videos']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // 다른 창에서 기록을 지우려고 하면 이 창은 비켜 주고 새로 열어요 (안 그러면 지우기가 멈춰요)
    this.db.onversionchange = () => { this.db.close(); setTimeout(() => location.reload(), 200); };
    onAuth({ uid: 'local', label: '📱 기록은 이 휴대폰에 저장되고 있어요' });
  }

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  getProfile() { return this._tx('kv', 'readonly', s => s.get('profile')).then(p => p || null); }
  async saveProfile(patch) {
    const cur = (await this.getProfile()) || {};
    await this._tx('kv', 'readwrite', s => s.put({ ...cur, ...patch }, 'profile'));
  }

  async listMoments() {
    const all = await this._tx('moments', 'readonly', s => s.getAll());
    return all.sort((a, b) => b.ts - a.ts);
  }
  async addMoment(moment, thumb, full) {
    if (thumb) await this._tx('thumbs', 'readwrite', s => s.put({ id: moment.id, data: thumb }));
    if (full) await this._tx('photos', 'readwrite', s => s.put({ id: moment.id, data: full }));
    await this._tx('moments', 'readwrite', s => s.put(moment));
  }
  async deleteMoment(id) {
    for (const name of ['moments', 'thumbs', 'photos', 'videos']) await this._tx(name, 'readwrite', s => s.delete(id));
  }
  // 동영상 (줄인 파일 그대로)
  saveVideo(id, blob) { return this._tx('videos', 'readwrite', s => s.put({ id, blob })); }
  getVideo(id) { return this._tx('videos', 'readonly', s => s.get(id)).then(r => r?.blob || null); }
  // 기록 일부만 바꾸기 (가족 응원 등)
  async updateMoment(id, patch) {
    const cur = await this._tx('moments', 'readonly', s => s.get(id));
    if (cur) await this._tx('moments', 'readwrite', s => s.put({ ...cur, ...patch }));
  }
  getThumb(id) { return this._tx('thumbs', 'readonly', s => s.get(id)).then(r => r?.data || null); }
  getPhoto(id) { return this._tx('photos', 'readonly', s => s.get(id)).then(r => r?.data || null); }
  // 매일 사진으로 만든 포토카드 그림 (thumbs 저장소에 'mc_' 이름으로)
  saveCardImage(id, data) { return this._tx('thumbs', 'readwrite', s => s.put({ id: 'mc_' + id, data })); }
  getCardImage(id) { return this.getThumb('mc_' + id); }

  async listWords() {
    const all = await this._tx('words', 'readonly', s => s.getAll());
    return all.sort((a, b) => b.ts - a.ts);
  }
  addWord(word) { return this._tx('words', 'readwrite', s => s.put(word)); }
  deleteWord(id) { return this._tx('words', 'readwrite', s => s.delete(id)); }

  // ── 백업: 모든 기록을 파일 하나로 ──
  async exportAll() {
    const out = { app: 'celine-post', v: 1, at: Date.now(), profile: await this.getProfile() };
    for (const name of ['moments', 'thumbs', 'photos', 'words']) out[name] = await this._tx(name, 'readonly', s => s.getAll());
    return out;
  }
  // 백업 파일 불러오기 (지금 있는 기록과 합쳐요. 같은 기록은 덮어써요)
  async importAll(data) {
    if (!data || data.app !== 'celine-post') throw new Error('셀린 우체국 백업 파일이 아니에요.');
    if (data.profile) await this.saveProfile(data.profile);
    for (const name of ['moments', 'thumbs', 'photos', 'words']) {
      const rows = (data[name] || []).filter(r => r && r.id);
      if (!rows.length) continue;
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(name, 'readwrite');
        const st = tx.objectStore(name);
        for (const r of rows) st.put(r);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    return (data.moments || []).length;
  }

  async signIn() {}
  async signUp() {}
  async signOut() {}
}

// ───────────────────────── 클라우드 (Firebase) ─────────────────────────
const AUTH_ERRORS = {
  'auth/invalid-credential': '아이디나 비밀번호가 맞지 않아요.',
  'auth/wrong-password': '아이디나 비밀번호가 맞지 않아요.',
  'auth/user-not-found': '아이디나 비밀번호가 맞지 않아요.',
  'auth/email-already-in-use': '이미 있는 아이디예요. 다른 아이디를 써 주세요.',
  'auth/weak-password': '비밀번호는 6자 이상으로 해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/too-many-requests': '잠시 후 다시 시도해 주세요.',
};

// 오프라인이면 쓰기가 서버 응답을 기다리며 멈추므로, 잠깐만 기다리고 넘어가요 (나중에 자동 동기화)
const settle = (p, ms = 4000) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

class CloudStore {
  mode = 'cloud';

  async init(onAuth) {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    this.fs = fs;
    this.authMod = auth;
    const app = initializeApp(FIREBASE_CONFIG);
    this.auth = auth.getAuth(app);
    await auth.setPersistence(this.auth, auth.browserLocalPersistence);
    try {
      this.db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch {
      this.db = fs.getFirestore(app);
    }
    auth.onAuthStateChanged(this.auth, user => {
      this.uid = user?.uid || null;
      onAuth(user ? { uid: user.uid, label: `아이디: ${user.email.split('@')[0]}` } : null);
    });
  }

  _email(id) { return `${id.trim().toLowerCase()}@${ID_DOMAIN}`; }
  _err(e) { return new Error(AUTH_ERRORS[e.code] || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.'); }

  async signIn(id, pw) {
    try { await this.authMod.signInWithEmailAndPassword(this.auth, this._email(id), pw); }
    catch (e) { throw this._err(e); }
  }
  async signUp(id, pw) {
    try { await this.authMod.createUserWithEmailAndPassword(this.auth, this._email(id), pw); }
    catch (e) { throw this._err(e); }
  }
  signOut() { return this.authMod.signOut(this.auth); }

  _doc(...path) { return this.fs.doc(this.db, 'users', this.uid, ...path); }
  _col(name) { return this.fs.collection(this.db, 'users', this.uid, name); }

  async getProfile() {
    const snap = await this.fs.getDoc(this._doc());
    return snap.exists() ? snap.data() : null;
  }
  saveProfile(patch) { return settle(this.fs.setDoc(this._doc(), patch, { merge: true })); }

  async listMoments() {
    const snap = await this.fs.getDocs(this._col('moments'));
    return snap.docs.map(d => d.data()).sort((a, b) => b.ts - a.ts);
  }
  async addMoment(moment, thumb, full) {
    const writes = [this.fs.setDoc(this._doc('moments', moment.id), moment)];
    if (thumb) writes.push(this.fs.setDoc(this._doc('thumbs', moment.id), { data: thumb }));
    if (full) writes.push(this.fs.setDoc(this._doc('photos', moment.id), { data: full }));
    await settle(Promise.all(writes));
  }
  updateMoment(id, patch) { return settle(this.fs.setDoc(this._doc('moments', id), patch, { merge: true })); }
  async saveVideo(id, blob) {
    const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    const SIZE = 700000, parts = [];
    for (let i = 0; i < data.length; i += SIZE) parts.push(data.slice(i, i + SIZE));
    const wait = p => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('동영상을 올리지 못했어요. 와이파이에서 다시 해 주세요.')), 90000))]);
    for (const [i, part] of parts.entries()) {
      await wait(this.fs.setDoc(this._doc('videos', `${id}_${i}`), { data: part, i, n: parts.length }));
    }
  }
  async getVideo(id) {
    const first = await this.fs.getDoc(this._doc('videos', `${id}_0`));
    if (!first.exists()) return null;
    const n = first.data().n || 1;
    const rest = await Promise.all(Array.from({ length: n - 1 }, (_, k) => this.fs.getDoc(this._doc('videos', `${id}_${k + 1}`))));
    const data = [first, ...rest].map(d => d.data()?.data || '').join('');
    return fetch(data).then(r => r.blob());
  }
  async deleteMoment(id) {
    await settle(Promise.all([
      ...['moments', 'thumbs', 'photos'].map(c => this.fs.deleteDoc(this._doc(c, id))),
      ...Array.from({ length: 12 }, (_, k) => this.fs.deleteDoc(this._doc('videos', `${id}_${k}`))),
    ]));
  }
  async getThumb(id) {
    const s = await this.fs.getDoc(this._doc('thumbs', id));
    return s.exists() ? s.data().data : null;
  }
  saveCardImage(id, data) { return settle(this.fs.setDoc(this._doc('thumbs', 'mc_' + id), { data })); }
  getCardImage(id) { return this.getThumb('mc_' + id); }
  async getPhoto(id) {
    const s = await this.fs.getDoc(this._doc('photos', id));
    return s.exists() ? s.data().data : null;
  }

  // ── 백업 파일 만들기 / 불러오기 (기록 옮기기에도 써요) ──
  async exportAll() {
    const out = { app: 'celine-post', v: 1, at: Date.now(), profile: await this.getProfile() };
    for (const name of ['moments', 'words']) out[name] = (await this.fs.getDocs(this._col(name))).docs.map(d => d.data());
    for (const name of ['thumbs', 'photos']) {
      out[name] = (await this.fs.getDocs(this._col(name))).docs.map(d => ({ id: d.id, data: d.data().data }));
    }
    return out;
  }
  async importAll(data, onProgress) {
    if (!data || data.app !== 'celine-post') throw new Error('셀린 우체국 백업 파일이 아니에요.');
    // 서버에 다 올라갔는지 확인하면서 하나씩 (인터넷이 끊기면 멈추지 않고 알려 줘요)
    const put = (ref, val, opt = {}) => Promise.race([
      this.fs.setDoc(ref, val, opt),
      new Promise((_, no) => setTimeout(() => no(new Error('인터넷 연결이 약해서 다 옮기지 못했어요. 와이파이에서 다시 해 주세요.')), 60000)),
    ]);
    if (data.profile) await put(this._doc(), { ...data.profile }, { merge: true });
    const jobs = [];
    for (const r of data.thumbs || []) if (r?.id && r.data) jobs.push([this._doc('thumbs', r.id), { data: r.data }]);
    for (const r of data.photos || []) if (r?.id && r.data) jobs.push([this._doc('photos', r.id), { data: r.data }]);
    for (const m of data.moments || []) if (m?.id) jobs.push([this._doc('moments', m.id), m]);
    for (const w of data.words || []) if (w?.id) jobs.push([this._doc('words', w.id), w]);
    let done = 0;
    for (const [ref, val] of jobs) { await put(ref, val); onProgress?.(++done, jobs.length); }
    return (data.moments || []).length;
  }

  // 이 휴대폰에 저장해 둔 지난 기록 (인터넷 없이 바로)
  async listCached() {
    const [p, m, w] = await Promise.all([
      this.fs.getDocFromCache(this._doc()).catch(() => null),
      this.fs.getDocsFromCache(this._col('moments')),
      this.fs.getDocsFromCache(this._col('words')),
    ]);
    return {
      profile: p?.exists() ? p.data() : null,
      moments: m.docs.map(d => d.data()).sort((a, b) => b.ts - a.ts),
      words: w.docs.map(d => d.data()).sort((a, b) => b.ts - a.ts),
    };
  }

  async listWords() {
    const snap = await this.fs.getDocs(this._col('words'));
    return snap.docs.map(d => d.data()).sort((a, b) => b.ts - a.ts);
  }
  addWord(word) { return settle(this.fs.setDoc(this._doc('words', word.id), word)); }
  deleteWord(id) { return settle(this.fs.deleteDoc(this._doc('words', id))); }
}
