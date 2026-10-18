// 아기 얼굴 동그랗게 자르기 (끌어서 옮기기 · 두 손가락/막대로 확대)
const $ = id => document.getElementById(id);
const CIRCLE = 0.88; // 동그라미 지름 (상자 크기 대비)
const OUT = 320;     // 저장할 얼굴 사진 크기(px)

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// file → 잘라낸 얼굴(dataURL) / 취소하면 null
export async function cropFace(file, { open, close }) {
  const url = URL.createObjectURL(file);
  const img = await loadImg(url).catch(() => null);
  if (!img) { URL.revokeObjectURL(url); throw new Error('이미지를 읽지 못했어요'); }

  const box = $('cropBox');
  const el = $('cropImg');
  const zoom = $('cropZoom');
  el.src = url;
  open();
  await new Promise(r => requestAnimationFrame(r));

  const B = box.clientWidth;
  const W = img.naturalWidth, H = img.naturalHeight;
  const base = B / Math.min(W, H);
  let z = 1, s = base, tx = (B - W * s) / 2, ty = (B - H * s) / 2;

  const clamp = () => {
    tx = Math.min(0, Math.max(B - W * s, tx));
    ty = Math.min(0, Math.max(B - H * s, ty));
  };
  const apply = () => { el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; el.style.width = W + 'px'; el.style.height = H + 'px'; };
  const setZoom = (nz, cx = B / 2, cy = B / 2) => {
    nz = Math.min(4, Math.max(1, nz));
    const ix = (cx - tx) / s, iy = (cy - ty) / s; // 손가락 아래 지점을 고정한 채 확대
    z = nz; s = base * z;
    tx = cx - ix * s; ty = cy - iy * s;
    clamp(); apply();
    zoom.value = String(z);
  };
  zoom.value = '1';
  clamp(); apply();

  const pointers = new Map();
  let pinch = null;
  const onDown = e => {
    box.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z };
    }
  };
  const onMove = e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const rect = box.getBoundingClientRect();
      setZoom(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    } else if (pointers.size === 1) {
      tx += cur.x - prev.x; ty += cur.y - prev.y;
      clamp(); apply();
    }
  };
  const onUp = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  const onWheel = e => {
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    setZoom(z * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onZoom = () => setZoom(Number(zoom.value));

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onUp);
  box.addEventListener('wheel', onWheel, { passive: false });
  zoom.addEventListener('input', onZoom);

  const result = await new Promise(resolve => {
    $('cropSave').onclick = () => {
      const c = document.createElement('canvas');
      c.width = c.height = OUT;
      const pad = (1 - CIRCLE) / 2 * B;
      const size = CIRCLE * B / s;
      c.getContext('2d').drawImage(img, (pad - tx) / s, (pad - ty) / s, size, size, 0, 0, OUT, OUT);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    $('cropCancel').onclick = () => resolve(null);
  });

  box.removeEventListener('pointerdown', onDown);
  box.removeEventListener('pointermove', onMove);
  box.removeEventListener('pointerup', onUp);
  box.removeEventListener('pointercancel', onUp);
  box.removeEventListener('wheel', onWheel);
  zoom.removeEventListener('input', onZoom);
  URL.revokeObjectURL(url);
  close();
  return result;
}
