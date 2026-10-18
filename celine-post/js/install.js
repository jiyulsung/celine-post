// 홈 화면에 추가 (갤럭시 · 아이폰 · 카카오톡 안 브라우저)
const $ = id => document.getElementById(id);
const ua = navigator.userAgent;

export const env = {
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1),
  android: /android/i.test(ua),
  kakao: /KAKAOTALK/i.test(ua),
  inapp: /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|everytimeApp/i.test(ua),
  iosChrome: /CriOS/i.test(ua),
  samsung: /SamsungBrowser/i.test(ua),
};

let deferred = null; // 안드로이드 크롬의 설치 신호
const DISMISS_KEY = 'haru.installDismissed';
const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 3 * 86400000; } catch { return false; }
};

// 카카오톡 등 앱 안 브라우저 → 크롬/사파리로 열기
export function handleInApp(onSkip) {
  if (!env.inapp || env.standalone) return false;
  const box = $('inappBox');
  box.hidden = false;
  const url = location.href;
  $('inappOpen').onclick = () => {
    if (env.kakao) {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    } else if (env.android) {
      location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
    } else {
      copy(url);
    }
  };
  $('inappCopy').onclick = () => copy(url);
  $('inappSkip').onclick = () => { box.hidden = true; onSkip?.(); };
  return true;
}

function copy(text) {
  const done = () => alert('주소를 복사했어요!\n사파리(아이폰)나 크롬(갤럭시)을 열고 주소창에 붙여 넣어 주세요.');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('이 주소를 복사해 주세요', text));
  else prompt('이 주소를 복사해 주세요', text);
}

// 메인 화면의 "홈 화면에 추가" 띠
export function setupInstall({ localMode, openSheet, closeSheets, toast, onInstalled }) {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    showBar();
    // 설치 안내 화면이 떠 있으면 "지금 바로 설치하기" 버튼을 보여 줘요
    $('instAndroidNow').hidden = false;
    $('instAndroidOr').hidden = false;
  });
  window.addEventListener('appinstalled', async () => {
    $('installBar').hidden = true;
    await onInstalled?.();
    if (env.android) showAfterInstall();
    else toast('셀린 우체국 설치 완료! 🎉');
  });

  // 갤럭시는 설치한 앱이 앱스(앱 목록)에만 들어갈 때가 많아요 → 홈 화면으로 꺼내는 방법 안내
  function showAfterInstall() {
    $('installTitle').textContent = '셀린 우체국 설치 완료! 🎉';
    $('installSteps').innerHTML = `
      <li><span>홈 화면을 위로 쓸어 올려 <b>앱스(앱 목록)</b>를 열어요</span></li>
      <li><span><b>셀린우체국</b> 아이콘을 <b>꾹</b> 눌러요</span></li>
      <li><span><b>"홈에 추가"</b>를 누르면 끝!<br /><small>(또는 꾹 누른 채로 홈 화면으로 끌어다 놓아도 돼요)</small></span></li>`;
    $('installNote').textContent = '💡 앞으로 설치하는 앱도 홈 화면에 바로 생기게 하려면: 설정 → 홈 화면 → "새 앱을 홈 화면에 추가" 켜기';
    $('installNow').hidden = true;
    $('installDone').textContent = '알겠어요';
    $('installSheet').classList.remove('top');
    $('iosArrow').hidden = true;
    openSheet('installSheet');
  }

  function showBar() {
    if (env.standalone || env.inapp || dismissedRecently()) return;
    $('installBar').hidden = false;
  }
  // 아이폰은 설치 신호가 없어서 바로 띄워요. 안드로이드는 신호가 늦게 올 수 있어 잠깐 기다려요.
  if (env.ios) showBar();
  else setTimeout(() => { if (!deferred && (env.android || env.samsung)) showBar(); }, 2500);

  async function installNow() {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') { $('installBar').hidden = true; closeGuide(); }
    return true;
  }
  $('installBtn').onclick = async () => { if (!(await installNow())) showGuide(); };
  $('installNow').onclick = async () => {
    if (!(await installNow())) toast('이미 설치돼 있을 수 있어요! 앱스(앱 목록)에서 셀린우체국을 찾아보거나, 아래 순서대로 해 주세요 👇', 6000);
  };
  $('installClose').onclick = () => {
    $('installBar').hidden = true;
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 괜찮아요 */ }
  };
  function closeGuide() {
    closeSheets();
    $('installSheet').classList.remove('top');
    $('iosArrow').hidden = true;
  }
  $('installDone').onclick = closeGuide;

  function showGuide() {
    const steps = $('installSteps');
    $('installTitle').textContent = '홈 화면에 셀린 우체국 추가하기';
    $('installDone').textContent = '나중에 할게요';
    if (env.ios && env.iosChrome) {
      steps.innerHTML = `
        <li><span>주소창 오른쪽 <span class="ico">⬆</span> 공유 버튼을 눌러요</span></li>
        <li><span><b>"홈 화면에 추가"</b>를 눌러요</span></li>
        <li><span>오른쪽 위 <b>"추가"</b>를 누르면 끝!</span></li>`;
    } else if (env.ios) {
      steps.innerHTML = `
        <li><span>화면 아래 <span class="ico">⬆</span> 공유 버튼을 눌러요<br /><small>(아이패드는 화면 위쪽에 있어요)</small></span></li>
        <li><span>목록을 조금 내려서 <b>"홈 화면에 추가"</b> <span class="ico">＋</span> 를 눌러요</span></li>
        <li><span>오른쪽 위 <b>"추가"</b>를 누르면 끝!</span></li>`;
    } else if (env.samsung) {
      steps.innerHTML = `
        <li><span>아래쪽 <span class="ico">≡</span> 메뉴를 눌러요</span></li>
        <li><span><b>"현재 페이지 추가"</b> → <b>"홈 화면"</b>을 눌러요</span></li>
        <li><span><b>"추가"</b>를 누르면 끝!</span></li>`;
    } else {
      steps.innerHTML = `
        <li><span>오른쪽 위 <span class="ico">⋮</span> 메뉴를 눌러요</span></li>
        <li><span><b>"홈 화면에 추가"</b> 또는 <b>"앱 설치"</b>를 눌러요</span></li>
        <li><span><b>"설치"</b>를 누르면 끝!</span></li>`;
    }
    $('installNote').textContent = env.ios && localMode
      ? '💡 추가한 뒤에는 홈 화면의 셀린우체국 아이콘으로 열어 주세요. 사파리에서 남긴 기록과 아이콘으로 연 앱의 기록은 따로 보관돼요.'
      : env.android
        ? '홈 화면에 아이콘이 안 보이면: 앱스(앱 목록)에서 셀린우체국을 꾹 → "홈에 추가" 📮'
        : '홈 화면에 생긴 셀린우체국 아이콘을 누르면 앱처럼 바로 열려요 📮';
    // 갤럭시 크롬: 바로 설치 버튼 (아래 순서는 버튼이 안 될 때를 위한 안내)
    $('installNow').hidden = !(deferred || env.android);
    // 아이폰 사파리: 공유 버튼이 화면 아래에 있으니 안내는 위에, 화살표는 아래에
    const iosSafari = env.ios && !env.iosChrome && !/ipad/i.test(ua) && !(/macintosh/i.test(ua));
    $('installSheet').classList.toggle('top', iosSafari);
    openSheet('installSheet');
    $('iosArrow').hidden = !iosSafari;
  }
  // 처음 열 때 한 번, 설치 안내를 크게 보여 줘요
  function offerOnce() {
    if (env.standalone || env.inapp) return;
    try { if (localStorage.getItem('haru.installOffered')) return; localStorage.setItem('haru.installOffered', '1'); } catch { /* 괜찮아요 */ }
    // 안드로이드는 설치 신호가 올 때까지 잠깐 기다려요
    setTimeout(showGuide, env.ios ? 900 : 2600);
  }
  // 링크를 열자마자 나오는 설치 안내 화면 (갤럭시 / 아이폰 따로)
  function needsLanding() {
    if (env.standalone || env.inapp) return false;
    try { return !sessionStorage.getItem('haru.instSkipped'); } catch { return true; }
  }
  function showLanding(onSkip) {
    const pick = which => {
      for (const t of document.querySelectorAll('[data-inst]')) t.classList.toggle('active', t.dataset.inst === which);
      for (const p of document.querySelectorAll('.inst-panel')) p.hidden = p.dataset.panel !== which;
      // 아이폰 사파리라면 화면 아래 공유 버튼을 화살표로 가리켜요
      $('iosArrow').hidden = !(which === 'ios' && env.ios && !env.iosChrome && !/ipad|macintosh/i.test(ua));
    };
    document.querySelectorAll('[data-inst]').forEach(t => { t.onclick = () => pick(t.dataset.inst); });
    pick(env.ios ? 'ios' : 'android');
    // 바로 설치 버튼은 항상 보여 줘요 (크롬이 아직 준비 안 됐으면 눌렀을 때 안내)
    $('instAndroidNow').hidden = false;
    $('instAndroidOr').hidden = false;
    $('instAndroidNow').onclick = async () => {
      if (await installNow()) {
        toast('설치하고 있어요! 잠시만 기다려 주세요 🎉', 4000);
      } else {
        toast(env.samsung
          ? '삼성 인터넷에서는 아래 순서대로 해 주세요 👇'
          : '이미 설치돼 있을 수 있어요! 앱스(앱 목록)에서 셀린우체국을 찾아보거나, 아래 순서대로 해 주세요 👇', 6000);
        document.querySelector('[data-panel="android"] .install-steps')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    $('instSkip').onclick = () => {
      try { sessionStorage.setItem('haru.instSkipped', '1'); } catch { /* 괜찮아요 */ }
      $('iosArrow').hidden = true;
      onSkip();
    };
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-install';
  }
  return { showGuide, offerOnce, needsLanding, showLanding };
}
