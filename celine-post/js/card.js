// 오늘의 카드 (1080×1350) 그리기
import { prettyDate, ageLabel, ageInfo, callName } from './engine.js';

const INK = '#4A3428';
const SOFT = '#8C7262';
const TITLE_FONT = (px) => `${px}px "Bagel Fat One", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
const BODY_FONT = (px) => `bold ${px}px Gaegu, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
const EMOJI_FONT = (px) => `${px}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

let fontsReady = null;
function loadFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      document.fonts.load(TITLE_FONT(56), '하루캡슐'),
      document.fonts.load(BODY_FONT(36), '하루캡슐'),
    ]).catch(() => {});
  }
  return fontsReady;
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of [...text]) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join('').length < [...text].length) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

function pill(ctx, x, y, text, bg) {
  ctx.font = BODY_FONT(32);
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, 58, 29);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 22, y + 31);
  return w;
}

export async function drawCard(canvas, { moment, photo, profile }) {
  await loadFonts();
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // 배경
  ctx.fillStyle = '#FFF3E4';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FBE3C8';
  for (let y = 13; y < H; y += 40) for (let x = 13; x < W; x += 40) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }

  // 폴라로이드
  ctx.save();
  ctx.shadowColor = 'rgba(140,90,60,.22)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#fff';
  roundRect(ctx, 56, 56, W - 112, H - 112, 44);
  ctx.fill();
  ctx.restore();
  if (moment.golden) {
    ctx.lineWidth = 10;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#FFE38A'); g.addColorStop(0.5, '#F5B83D'); g.addColorStop(1, '#FFD35C');
    ctx.strokeStyle = g;
    roundRect(ctx, 61, 61, W - 122, H - 122, 40);
    ctx.stroke();
  }

  // 사진
  const px = 100, py = 100, pw = W - 200, ph = 740;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 30);
  ctx.clip();
  const img = await loadImage(photo);
  if (img) {
    const s = Math.max(pw / img.width, ph / img.height);
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, px + (pw - iw) / 2, py + (ph - ih) / 2, iw, ih);
  } else {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
    g.addColorStop(0, '#FFE1DB'); g.addColorStop(1, '#DDF3EE');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.font = EMOJI_FONT(200);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎈', px + pw / 2, py + ph / 2);
  }
  ctx.restore();

  // 스티커 (왼쪽 위)
  if (moment.sticker) {
    ctx.save();
    ctx.translate(px + 40, py + 40);
    ctx.rotate(-0.18);
    ctx.fillStyle = moment.shiny ? '#FFE9A6' : '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    if (moment.sticker.startsWith('pc:') || moment.sticker.startsWith('mc:')) {
      // 셀린 포토카드 스티커 (mc: 는 엄마가 넣은 매일 사진 카드)
      const pc = await loadImage(moment.sticker.startsWith('mc:')
        ? profile?.stickerSrc?.(moment.sticker)
        : `faces/${moment.sticker.slice(3).replace(/h$/, '')}.jpg`);
      if (pc) {
        ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(pc, -58, -78, 116, 155);
        if (moment.sticker.endsWith('h')) {
          // 반짝이 카드: 무지개 빛
          const g = ctx.createLinearGradient(-58, -58, 58, 58);
          ['rgba(255,0,170,.35)', 'rgba(255,230,0,.35)', 'rgba(0,255,200,.35)', 'rgba(80,120,255,.35)'].forEach((c, i) => g.addColorStop(i / 3, c));
          ctx.globalCompositeOperation = 'overlay';
          ctx.fillStyle = g;
          ctx.fillRect(-58, -58, 116, 116);
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    } else {
      ctx.font = EMOJI_FONT(80);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(moment.sticker, 0, 6);
    }
    ctx.restore();
  }

  // 반응 (오른쪽 아래)
  if (moment.reaction) {
    const rx = px + pw - 70, ry = py + ph - 60;
    const rface = await loadImage(profile?.reactFaces?.[moment.reaction]);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(rx, ry, rface ? 84 : 66, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (rface) {
      ctx.save();
      ctx.beginPath(); ctx.arc(rx, ry, 76, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(rface, rx - 76, ry - 76, 152, 152);
      ctx.restore();
      ctx.font = EMOJI_FONT(52);
      ctx.fillText(moment.reaction, rx + 58, ry - 58);
    } else {
      ctx.font = EMOJI_FONT(80);
      ctx.fillText(moment.reaction, rx, ry + 6);
    }
  }

  // 날짜 · 나이
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let y = py + ph + 64;
  const age = ageLabel(ageInfo(profile?.birth, new Date(moment.ts)));
  ctx.font = BODY_FONT(32);
  ctx.fillStyle = SOFT;
  ctx.fillText(`${prettyDate(moment.date)}${age ? '  ·  ' + age : ''}`, px + 4, y);

  // 미션 제목
  y += 72;
  ctx.font = TITLE_FONT(56);
  ctx.fillStyle = INK;
  for (const line of wrap(ctx, moment.title, pw - 8, 2)) { ctx.fillText(line, px + 4, y); y += 68; }

  // 한 줄 일기
  if (moment.diary) {
    y += 2;
    ctx.font = BODY_FONT(36);
    ctx.fillStyle = INK;
    for (const line of wrap(ctx, `“${moment.diary}”`, pw - 8, 2)) { ctx.fillText(line, px + 4, y); y += 50; }
  }

  // 처음 해낸 일 / 새 말
  y += 6;
  let x = px;
  if (moment.firstText || moment.first) x += pill(ctx, x, y - 36, `⭐ 처음! ${moment.firstText || ''}`.trim(), '#FFF1CC') + 12;
  if (moment.word) {
    ctx.font = BODY_FONT(32);
    const text = `💬 "${moment.word}"`;
    if (x + ctx.measureText(text).width + 44 > px + pw) { x = px; y += 70; }
    pill(ctx, x, y - 36, text, '#EAF8F4');
  }

  // 바닥 글씨
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = TITLE_FONT(30);
  ctx.fillStyle = '#E8695B';
  const footer = `셀린 우체국 · ${callName(profile?.name)}의 하루`;
  const face = await loadImage(profile?.avatar);
  if (face) {
    const tw = ctx.measureText(footer).width;
    const cx = W / 2 - tw / 2 - 34, cy = H - 102;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.clip();
    ctx.drawImage(face, cx - 24, cy - 24, 48, 48);
    ctx.restore();
    ctx.fillText(footer, W / 2 + 14, H - 92);
  } else {
    ctx.fillText(`📮 ${footer}`, W / 2, H - 92);
  }
}

export async function shareCanvas(canvas, fileName) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '셀린 우체국' });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
