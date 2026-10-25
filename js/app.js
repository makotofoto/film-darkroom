'use strict';

// ══════════════════════════════════════════════
//  暗房 — 主程式
// ══════════════════════════════════════════════

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const GRADE_K = [0.44, 0.62, 0.82, 1.08, 1.48, 2.00];   // 相紙號數 0–5
const F_STOPS = [4, 5.6, 8, 11, 16, 22];
const MAX_EDGE = 4096;
const GRAIN_BASE = 1500;        // 顆粒的虛擬畫幅長邊，讓預覽與輸出一致

const S = {
  mode: 'color',
  filmId: 'portra400',
  tab: 'film',
  tools: { film: 'pick', room: 'time', out: 'border' },
  expert: true,

  // 底片階段
  push: 0, evComp: 0,
  grainMul: 1, haloMul: 1,
  leak: 0, vignette: 12,

  // 放大機 / 相紙
  time: 16, fstopIdx: 2,
  cy: 0, cm: 0, cc: 0,
  grade: 2,
  paperC: 'crystal-archive',
  paperB: 'mg-rc-neutral',
  toner: 'none', tonerAmt: 60, bleach: 0,

  // 簡易模式
  sBright: 0, sCon: 0, sWarm: 0, sTint: 0, sSat: 100,

  // 加光 / 遮光
  brush: false, brushMode: 'burn', brushSize: 38, brushK: 90,

  // 取景畫幅（相機模式）
  frame: '3:2',

  // 輸出
  border: 'none', stamp: false,

  seed: Math.random() * 100
};

let R = null;                   // Renderer
let src = { el: null, w: 0, h: 0 };
let live = false, stream = null, facing = 'environment', rafId = 0;
let maskCanvas = null, maskCtx = null, maskDirty = false, hasMask = false;
let frameNo = 1;

// ───────── 提示 ─────────
let toastTimer = 0;
function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ───────── 參數組裝 ─────────
function currentFilm() { return FILM_BY_ID[S.filmId] || FILMS[0]; }

const FRAMES = {
  '3:2':  { ar: 2 / 3,  label: '3:2' },
  '1:1':  { ar: 1,      label: '1:1' },
  'full': { ar: 0,      label: '滿版' }   // ar 0 = 跟著螢幕
};

// 取景畫幅的長寬比（寬/高）
function frameAspect() {
  const f = FRAMES[S.frame] || FRAMES['3:2'];
  if (f.ar) return f.ar;
  const st = document.querySelector('.stage');
  return Math.max(0.3, st.clientWidth / Math.max(1, st.clientHeight));
}

// 把原稿「填滿」目標畫幅所需的取樣裁切
function coverCrop(srcW, srcH, targetAR) {
  const sa = srcW / srcH;
  if (!isFinite(sa) || !isFinite(targetAR) || targetAR <= 0) {
    return { scale: [1, 1], offset: [0, 0] };
  }
  if (sa > targetAR) {
    const sx = targetAR / sa;
    return { scale: [sx, 1], offset: [(1 - sx) / 2, 0] };
  }
  const sy = sa / targetAR;
  return { scale: [1, sy], offset: [0, (1 - sy) / 2] };
}

// 相機模式才裁切；沖洗既有照片時整張都要看得到
function activeCrop() {
  if (!live || !src.w) return { scale: [1, 1], offset: [0, 0] };
  return coverCrop(src.w, src.h, frameAspect());
}

function buildParams(outW, outH) {
  const f = currentFilm();
  const isBW = S.mode === 'bw';

  // 推拉顯影：推 → 反差升、顆粒粗、暗部掉；拉 → 反差降、階調長
  const p = S.push;
  const con = Math.max(0.35, f.con * (1 + p * 0.115));
  const toe = Math.max(0, f.toe * (1 - p * 0.14));
  const shoulder = Math.max(0.05, f.shoulder * (1 - Math.max(0, p) * 0.10));
  const grainAmt = f.grainAmt * (S.grainMul) * (1 + Math.max(0, p) * 0.26);

  // 底片曝光
  const filmEV = S.evComp + (S.expert ? 0 : 0);

  // 放大機曝光（正值 = 相紙吃光多 = 成品暗）
  let printEV;
  if (S.expert) {
    printEV = Math.log2(S.time / 16) - 2 * Math.log2(F_STOPS[S.fstopIdx] / 8);
  } else {
    printEV = -S.sBright;
  }

  // 相紙反差
  let paperCon;
  if (isBW) {
    paperCon = S.expert ? GRADE_K[S.grade] : (0.95 * (1 + S.sCon * 0.42));
  } else {
    const pc = PAPERS.color.find(x => x.id === S.paperC) || PAPERS.color[0];
    paperCon = S.expert ? pc.contrast : pc.contrast * (1 + S.sCon * 0.42);
  }

  // 紙基色
  let paperBase;
  if (isBW) {
    paperBase = (PAPERS.bw.find(x => x.id === S.paperB) || PAPERS.bw[1]).base;
  } else {
    paperBase = (PAPERS.color.find(x => x.id === S.paperC) || PAPERS.color[0]).base;
  }

  // CMY 濾鏡（減色法）
  let cmy;
  if (isBW) {
    cmy = [0, 0, 0];
  } else if (S.expert) {
    cmy = [S.cc / 100, S.cm / 100, S.cy / 100];
  } else {
    const w = S.sWarm;
    cmy = [Math.max(0, w) * 0.95, -S.sTint * 0.85, Math.max(0, -w) * 0.95];
  }

  // 調色
  const tn = TONERS.find(t => t.id === S.toner) || TONERS[0];
  const tonerAmt = isBW ? (S.toner === 'none' ? 0 : S.tonerAmt / 100) : 0;

  // 黑白光譜權重：黑白底片用自己的，彩色底片印黑白用標準全色片權重
  const bwMix = f.bwMix || [0.30, 0.59, 0.11];

  // 飽和度
  const sat = isBW ? 0 : f.sat * (S.expert ? 1 : S.sSat / 100);

  // 顆粒虛擬畫幅
  const longEdge = Math.max(outW, outH) || 1;
  const gScale = GRAIN_BASE / longEdge;
  const grainRes = [outW * gScale, outH * gScale];

  const crop = activeCrop();

  return {
    srcScale: new Float32Array(crop.scale),
    srcOffset: new Float32Array(crop.offset),
    mix: f.mix ? mat3(f.mix) : mat3([1,0,0, 0,1,0, 0,0,1]),
    bwMix: new Float32Array(bwMix),
    shTint: new Float32Array(f.shTint),
    hiTint: new Float32Array(f.hiTint),
    isBW: isBW ? 1 : 0,
    sat, con, toe, shoulder,
    grainAmt, grainSize: f.grainSize,
    grainRes: new Float32Array(grainRes),
    halation: (f.halation || 0) * S.haloMul,
    fog: f.fog || 0,
    sharpen: f.sharpen || 0,
    filmEV, printEV,
    cmy: new Float32Array(cmy),
    paperCon,
    paperBase: new Float32Array(paperBase),
    tonerSh: new Float32Array(tn.sh),
    tonerHi: new Float32Array(tn.hi),
    tonerAmt,
    hasMask: hasMask ? 1 : 0,
    burnK: S.brushK / 100 * 1.6,
    vignette: S.vignette / 100 * 0.75,
    leak: S.leak / 100 * 0.55,
    leakAngle: 0.55 + (S.seed % 1) * 2.0,
    seed: S.seed,
    bleach: S.bleach / 100,
    flipY: true
  };
}

// GLSL mat3 是 column-major，資料表裡是 row-major
function mat3(r) {
  return new Float32Array([
    r[0], r[3], r[6],
    r[1], r[4], r[7],
    r[2], r[5], r[8]
  ]);
}

// ───────── 渲染 ─────────
let renderQueued = false;
function requestRender() {
  if (live || renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); });
}

function fitCanvas() {
  const view = $('view');
  if (!src.w) return;
  const stage = document.querySelector('.stage');
  const pad = live ? 0 : 28;
  const availW = stage.clientWidth - pad;
  const availH = stage.clientHeight - (live ? 0 : 14);
  const ar = live ? frameAspect() : (src.w / src.h);
  let w = availW, h = w / ar;
  if (h > availH) { h = availH; w = h * ar; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(2, Math.round(w * dpr));
  const ch = Math.max(2, Math.round(h * dpr));
  if (view.width !== cw || view.height !== ch) { view.width = cw; view.height = ch; }
  view.style.width = Math.round(w) + 'px';
  view.style.height = Math.round(h) + 'px';
  const ml = $('maskLayer');
  ml.style.width = view.style.width;
  ml.style.height = view.style.height;
}

function draw() {
  if (!R || !src.el || !src.w) return;
  if (live) R.setSource(src.el, src.w, src.h);
  if (maskDirty) { R.setMask(maskCanvas); maskDirty = false; }
  const view = $('view');
  R.render(buildParams(view.width, view.height));
}

function loop() {
  if (!live) return;
  const v = $('video');
  if (v.readyState >= 2) {
    src.w = v.videoWidth; src.h = v.videoHeight;
    fitCanvas();
    draw();
  }
  rafId = requestAnimationFrame(loop);
}

// ───────── 影像載入 ─────────
async function loadBlob(blob) {
  let bmp = null;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(blob);
    });
  }
  const iw = bmp.width || bmp.naturalWidth;
  const ih = bmp.height || bmp.naturalHeight;
  const maxTex = Math.min(R.gl.getParameter(R.gl.MAX_TEXTURE_SIZE), MAX_EDGE);
  const scale = Math.min(1, maxTex / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();

  setStill(c, w, h);
}

function setStill(canvasEl, w, h) {
  stopCamera();
  src = { el: canvasEl, w, h };
  S.seed = Math.random() * 100;
  R.setSource(canvasEl, w, h);
  initMask(w, h);
  $('empty').hidden = true;
  $('tray').classList.add('has-image');
  $('bSave').disabled = false;
  fitCanvas();
  draw();
  const v = $('view');
  v.classList.remove('developing');
  void v.offsetWidth;
  v.classList.add('developing');
  updateBadge();
}

// ───────── 相機 ─────────
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('這個瀏覽器不給用相機，請改用「相簿」', 3200); return;
  }
  try {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: facing,
        width: { ideal: 1920 }, height: { ideal: 1440 }
      }
    });
  } catch (e) {
    const why = e && e.name === 'NotAllowedError'
      ? '相機權限被拒。到 設定 → Safari → 相機 打開，或用「相簿」。'
      : '開不了相機：' + (e && e.message ? e.message : e);
    toast(why, 4000);
    return;
  }
  const v = $('video');
  v.srcObject = stream;
  try { await v.play(); } catch (e) {}
  live = true;
  src.el = v;
  hasMask = false;
  S.brush = false;
  document.body.dataset.live = 'on';
  $('tray').dataset.brush = 'off';
  $('empty').hidden = true;
  $('tray').classList.add('has-image');
  $('bShot').hidden = false;
  $('bFlip').hidden = false;
  $('bClose').hidden = false;
  $('bCam').hidden = true;
  $('bLib').hidden = true;
  $('bSave').hidden = true;
  buildFrameBar();
  $('view').style.transform = facing === 'user' ? 'scaleX(-1)' : '';
  cancelAnimationFrame(rafId);
  loop();
  updateBadge();
}

function stopCamera() {
  live = false;
  cancelAnimationFrame(rafId);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('video').srcObject = null;
  delete document.body.dataset.live;
  $('bShot').hidden = true;
  $('bFlip').hidden = true;
  $('bClose').hidden = true;
  $('bCam').hidden = false;
  $('bLib').hidden = false;
  $('bSave').hidden = false;
  $('view').style.transform = '';
  fitCanvas();
}

// 取景畫幅切換列（只在相機模式出現）
function buildFrameBar() {
  const bar = $('frameBar');
  bar.innerHTML = '';
  Object.entries(FRAMES).forEach(([k, f]) => {
    const b = document.createElement('button');
    b.textContent = f.label;
    b.setAttribute('aria-pressed', String(S.frame === k));
    b.onclick = () => {
      S.frame = k;
      buildFrameBar();
      fitCanvas();
    };
    bar.appendChild(b);
  });
}

// 離開相機，回到沖洗檯
function closeCamera() {
  stopCamera();
  if (!src.w || src.el === $('video')) {
    src = { el: null, w: 0, h: 0 };
    $('empty').hidden = false;
    $('tray').classList.remove('has-image');
    $('bSave').disabled = true;
    const gl = R.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  } else {
    fitCanvas(); draw();
  }
}

function shoot() {
  const v = $('video');
  if (!v.videoWidth) return;
  const vw = v.videoWidth, vh = v.videoHeight;
  const crop = coverCrop(vw, vh, frameAspect());
  const sx = Math.round(crop.offset[0] * vw);
  const sy = Math.round(crop.offset[1] * vh);
  const sw = Math.max(1, Math.round(crop.scale[0] * vw));
  const sh = Math.max(1, Math.round(crop.scale[1] * vh));

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  if (facing === 'user') { ctx.translate(sw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
  frameNo++;
  setStill(c, sw, sh);
  toast('曝光完成 — 進暗房沖洗吧');
}

// ───────── 加光 / 遮光遮罩 ─────────
function initMask(w, h) {
  const mw = 512, mh = Math.max(1, Math.round(512 * h / w));
  if (!maskCanvas) maskCanvas = document.createElement('canvas');
  maskCanvas.width = mw; maskCanvas.height = mh;
  maskCtx = maskCanvas.getContext('2d');
  maskCtx.fillStyle = '#000';
  maskCtx.fillRect(0, 0, mw, mh);
  hasMask = false; maskDirty = true;
  R.setMask(maskCanvas);
  syncMaskLayer();
}

function clearMask() {
  if (!maskCtx) return;
  maskCtx.fillStyle = '#000';
  maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  hasMask = false; maskDirty = true;
  syncMaskLayer();
  requestRender();
}

function paintMask(x, y) {
  if (!maskCtx) return;
  const r = S.brushSize / 100 * maskCanvas.width * 0.5;
  const px = x * maskCanvas.width, py = y * maskCanvas.height;
  const g = maskCtx.createRadialGradient(px, py, 0, px, py, Math.max(2, r));
  const col = S.brushMode === 'burn' ? '255,0,0' : '0,255,0';
  g.addColorStop(0, `rgba(${col},0.42)`);
  g.addColorStop(1, `rgba(${col},0)`);
  maskCtx.globalCompositeOperation = 'lighter';
  maskCtx.fillStyle = g;
  maskCtx.beginPath();
  maskCtx.arc(px, py, Math.max(2, r), 0, 6.2832);
  maskCtx.fill();
  maskCtx.globalCompositeOperation = 'source-over';
  hasMask = true; maskDirty = true;
  syncMaskLayer();
  requestRender();
}

function syncMaskLayer() {
  const ml = $('maskLayer');
  if (!maskCanvas) return;
  if (ml.width !== maskCanvas.width) { ml.width = maskCanvas.width; ml.height = maskCanvas.height; }
  const c = ml.getContext('2d');
  c.clearRect(0, 0, ml.width, ml.height);
  c.drawImage(maskCanvas, 0, 0);
}

function bindBrush() {
  const tray = $('tray');
  let painting = false;
  const pos = e => {
    const r = $('view').getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return [clamp((t.clientX - r.left) / r.width, 0, 1),
            clamp((t.clientY - r.top) / r.height, 0, 1)];
  };
  const down = e => {
    if (!S.brush || live || !src.w) return;
    e.preventDefault(); painting = true;
    const [x, y] = pos(e); paintMask(x, y);
  };
  const move = e => {
    if (!painting) return;
    e.preventDefault();
    const [x, y] = pos(e); paintMask(x, y);
  };
  const up = () => { painting = false; };
  tray.addEventListener('touchstart', down, { passive: false });
  tray.addEventListener('touchmove', move, { passive: false });
  tray.addEventListener('touchend', up);
  tray.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ───────── 輸出 ─────────
function renderFull() {
  const view = $('view');
  const keep = [view.width, view.height, view.style.width, view.style.height];
  view.width = src.w; view.height = src.h;
  R.render(buildParams(src.w, src.h));
  const out = document.createElement('canvas');
  out.width = src.w; out.height = src.h;
  out.getContext('2d').drawImage(view, 0, 0);
  view.width = keep[0]; view.height = keep[1];
  view.style.width = keep[2]; view.style.height = keep[3];
  draw();
  return out;
}

function stampDate(img) {
  const g = img.getContext('2d');
  const fs = Math.round(Math.max(img.width, img.height) * 0.030);
  const d = new Date();
  const txt = `${String(d.getFullYear()).slice(2)} ${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}`;
  g.font = `700 ${fs}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(255,120,0,.95)'; g.shadowBlur = fs * 0.55;
  g.fillStyle = 'rgba(255,172,44,.95)';
  g.fillText(txt, img.width - fs * 1.2, img.height - fs * 1.0);
  g.fillText(txt, img.width - fs * 1.2, img.height - fs * 1.0);
  g.shadowBlur = 0;
  return img;
}

function withBorder(img) {
  if (S.stamp) img = stampDate(img);
  if (S.border === 'none') return img;
  const f = currentFilm();
  const long = Math.max(img.width, img.height);

  if (S.border === 'film') {
    const pad = Math.round(long * 0.085);
    const side = Math.round(long * 0.022);
    const c = document.createElement('canvas');
    c.width = img.width + side * 2;
    c.height = img.height + pad * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#12100e';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, side, pad);

    // 齒孔
    const hw = Math.round(pad * 0.46), hh = Math.round(pad * 0.34);
    const r = Math.round(hw * 0.22);
    const step = Math.round(hw * 2.05);
    g.fillStyle = '#2a251f';
    for (let x = step * 0.35; x < c.width - hw; x += step) {
      roundRect(g, x, (pad - hh) / 2, hw, hh, r); g.fill();
      roundRect(g, x, c.height - pad + (pad - hh) / 2, hw, hh, r); g.fill();
    }
    // 片邊字樣
    const fs = Math.round(pad * 0.30);
    g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
    g.fillStyle = 'rgba(255,170,70,.88)';
    g.textBaseline = 'middle';
    const txt = `${f.brand} ${f.name}`.toUpperCase();
    g.fillText(txt, side + fs * 0.4, pad * 0.5);
    g.textAlign = 'right';
    g.fillText(String(frameNo).padStart(2, '0') + 'A', c.width - side - fs * 0.4, c.height - pad * 0.5);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.34)';
    g.fillText(`ISO ${f.iso}`, side + fs * 0.4, c.height - pad * 0.5);
    img = c;
  } else if (S.border === 'paper') {
    const pad = Math.round(long * 0.055);
    const bottom = Math.round(pad * 2.1);
    const base = S.mode === 'bw'
      ? (PAPERS.bw.find(x => x.id === S.paperB) || PAPERS.bw[1]).base
      : (PAPERS.color.find(x => x.id === S.paperC) || PAPERS.color[0]).base;
    const c = document.createElement('canvas');
    c.width = img.width + pad * 2;
    c.height = img.height + pad + bottom;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${Math.round(base[0] * 252)},${Math.round(base[1] * 252)},${Math.round(base[2] * 252)})`;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, pad, pad);
    g.strokeStyle = 'rgba(0,0,0,.14)';
    g.lineWidth = Math.max(1, long * 0.0012);
    g.strokeRect(pad, pad, img.width, img.height);
    const fs = Math.round(bottom * 0.30);
    g.font = `500 ${fs}px -apple-system, "PingFang TC", sans-serif`;
    g.fillStyle = 'rgba(30,26,22,.52)';
    g.textBaseline = 'middle';
    g.fillText(`${f.brand} ${f.name}`, pad, pad + img.height + bottom * 0.5);
    g.textAlign = 'right';
    g.fillText(S.mode === 'bw' ? `號數 ${S.grade}` : `${S.cc}C ${S.cm}M ${S.cy}Y`,
               c.width - pad, pad + img.height + bottom * 0.5);
    img = c;
  }

  return img;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function save() {
  if (!src.w || live) return;
  toast('正在定影…', 1200);
  await new Promise(r => setTimeout(r, 30));
  let out;
  try { out = withBorder(renderFull()); }
  catch (e) { toast('輸出失敗：' + e.message, 3500); return; }

  const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.94));
  if (!blob) { toast('輸出失敗', 2500); return; }

  const f = currentFilm();
  const name = `darkroom_${f.id}_${Date.now()}.jpg`;
  const file = new File([blob], name, { type: 'image/jpeg' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 6000);
  toast('已存檔');
}

// ══════════════════════════════════════════════
//  介面
// ══════════════════════════════════════════════

function updateBadge() {
  const f = currentFilm();
  const parts = [`${f.brand} ${f.name}`.toUpperCase()];
  if (S.push) parts.push(S.push > 0 ? `PUSH +${S.push}` : `PULL ${S.push}`);
  if (S.mode === 'bw' && S.expert) parts.push(`GR ${S.grade}`);
  $('badge').textContent = parts.join('  ·  ');
}

function setMode(m) {
  S.mode = m;
  document.body.dataset.mode = m;
  $('roomName').textContent = m === 'bw' ? '黑白暗房' : '彩色暗房';
  $('mColor').setAttribute('aria-pressed', m === 'color');
  $('mBw').setAttribute('aria-pressed', m === 'bw');
  const f = currentFilm();
  if (m === 'color' && f.type === 'bw') S.filmId = 'portra400';
  buildFilms();
  buildPanel();
  updateBadge();
  requestRender();
}

function buildFilms() {
  const wrap = $('films');
  wrap.innerHTML = '';
  const list = S.mode === 'bw'
    ? FILMS.filter(f => f.type === 'bw').concat(FILMS.filter(f => f.type !== 'bw'))
    : FILMS.filter(f => f.type !== 'bw');

  const chip = f => f.type === 'bw' ? '#8e8e8e'
    : f.type === 'slide' ? '#49b2d6' : '#d9823c';

  list.forEach(f => {
    const b = document.createElement('button');
    b.className = 'box';
    b.style.setProperty('--chip', chip(f));
    b.setAttribute('aria-pressed', f.id === S.filmId);
    const bwNote = S.mode === 'bw' && f.type !== 'bw' ? ' · 印黑白' : '';
    b.innerHTML =
      `<div class="brand">${f.brand}</div>` +
      `<div class="nm">${f.name}</div>` +
      `<div class="iso">ISO ${f.iso}${bwNote}</div>`;
    b.onclick = () => {
      S.filmId = f.id;
      S.seed = Math.random() * 100;
      buildFilms(); buildPanel(); updateBadge(); requestRender();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    };
    wrap.appendChild(b);
  });
  const sel = wrap.querySelector('[aria-pressed="true"]');
  if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// ── 控制元件 ──
function slider(o) {
  const el = document.createElement('div');
  el.className = 'ctl';
  el.innerHTML =
    `<div class="top"><span class="lab">${o.label}</span>` +
    `${o.hint ? `<span class="hint">${o.hint}</span>` : '<span class="hint"></span>'}` +
    `<span class="val"></span></div>` +
    `<input type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}">`;
  const input = el.querySelector('input');
  const val = el.querySelector('.val');
  const sync = () => {
    const v = parseFloat(input.value);
    val.textContent = o.fmt ? o.fmt(v) : String(v);
    input.style.setProperty('--pct', ((v - o.min) / (o.max - o.min) * 100) + '%');
  };
  input.value = o.get();
  sync();
  input.oninput = () => { o.set(parseFloat(input.value)); sync(); requestRender(); if (o.badge) updateBadge(); };
  return el;
}

function seg(o) {
  const el = document.createElement('div');
  el.className = 'ctl';
  const sub = o.label ? `<div class="top"><span class="lab">${o.label}</span>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>` : '';
  el.innerHTML = sub + `<div class="seg${o.cls ? ' ' + o.cls : ''}"></div>`;
  const box = el.querySelector('.seg');
  o.items.forEach(it => {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(o.get() === it.value));
    b.onclick = () => {
      o.set(it.value);
      box.querySelectorAll('button').forEach((x, i) =>
        x.setAttribute('aria-pressed', String(o.items[i].value === it.value)));
      if (o.rebuild) buildPanel();
      updateBadge(); requestRender();
    };
    box.appendChild(b);
  });
  return el;
}

function toggle(label, get, set, hint) {
  const el = document.createElement('label');
  el.className = 'toggle';
  el.innerHTML = `<input type="checkbox"><span class="sw"></span><span>${label}</span>` +
    (hint ? `<span class="hint" style="margin-left:auto;font-size:10.5px;color:var(--dim-2)">${hint}</span>` : '');
  const cb = el.querySelector('input');
  cb.checked = get();
  cb.onchange = () => { set(cb.checked); if (cb.dataset.rb) buildPanel(); requestRender(); };
  return { el, cb };
}

function note(text) {
  const d = document.createElement('div');
  d.className = 'note';
  d.textContent = text;
  return d;
}
function sub(text) {
  const d = document.createElement('div');
  d.className = 'sub';
  d.textContent = text;
  return d;
}
function sep() { const h = document.createElement('hr'); h.className = 'sep'; return h; }

// ── 面板：一次只顯示一個控制項，照片才留得住畫面 ──
//    [分頁] → [工具列（橫捲）] → [當下那一個控制項]

function toolsFor(tab) {
  const f = currentFilm();
  const isBW = S.mode === 'bw';

  if (tab === 'film') {
    const t = [
      { id: 'pick', label: '選底片', make: slotFilms },
      { id: 'push', label: '推拉顯影', make: () => slider({
          label: '推拉顯影', hint: '推 → 反差高、顆粒粗', min: -2, max: 3, step: 1,
          get: () => S.push, set: v => S.push = v, badge: true,
          fmt: v => v === 0 ? '標準' : (v > 0 ? `推 +${v}` : `拉 ${v}`) }) },
      { id: 'ev', label: '曝光補償', make: () => slider({
          label: '曝光補償', hint: '拍攝時的進光量', min: -2, max: 2, step: 0.1,
          get: () => S.evComp, set: v => S.evComp = v,
          fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' EV' }) },
      { id: 'grain', label: '顆粒', make: () => slider({
          label: '顆粒', min: 0, max: 220, step: 5,
          get: () => S.grainMul * 100, set: v => S.grainMul = v / 100,
          fmt: v => v + '%' }) }
    ];
    if (f.halation > 0.001 || !isBW) {
      t.push({ id: 'halo', label: '光暈', make: () => slider({
        label: '紅色光暈', hint: f.halation > 0.4 ? '這支底片天生會爆' : '高光溢出',
        min: 0, max: 250, step: 5,
        get: () => S.haloMul * 100, set: v => S.haloMul = v / 100,
        fmt: v => v + '%' }) });
    }
    t.push(
      { id: 'vig', label: '暗角', make: () => slider({
          label: '鏡頭暗角', min: 0, max: 100, step: 2,
          get: () => S.vignette, set: v => S.vignette = v, fmt: v => v + '%' }) },
      { id: 'leak', label: '漏光', make: () => slider({
          label: '漏光', hint: '片盒沒關緊', min: 0, max: 100, step: 2,
          get: () => S.leak, set: v => S.leak = v, fmt: v => v + '%' }) }
    );
    return t;
  }

  if (tab === 'room') {
    const mode = { id: 'how', label: '操作方式', make: () => seg({
      label: '操作方式', items: [{ label: '簡易', value: false }, { label: '專家暗房', value: true }],
      get: () => S.expert, set: v => S.expert = v, rebuild: true }) };

    if (!S.expert) {
      const t = [mode,
        { id: 'bright', label: '亮度', make: () => slider({
            label: '亮度', min: -2, max: 2, step: 0.05,
            get: () => S.sBright, set: v => S.sBright = v,
            fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) }) },
        { id: 'con', label: '反差', make: () => slider({
            label: '反差', min: -1, max: 1, step: 0.02,
            get: () => S.sCon, set: v => S.sCon = v,
            fmt: v => (v > 0 ? '+' : '') + v.toFixed(2) }) }
      ];
      if (!isBW) t.push(
        { id: 'warm', label: '色溫', make: () => slider({
            label: '色溫', hint: '左冷 → 右暖', min: -1, max: 1, step: 0.02,
            get: () => S.sWarm, set: v => S.sWarm = v,
            fmt: v => v === 0 ? '中性' : (v > 0 ? '暖 ' + v.toFixed(2) : '冷 ' + (-v).toFixed(2)) }) },
        { id: 'tint', label: '色調', make: () => slider({
            label: '色調', hint: '左綠 → 右洋紅', min: -1, max: 1, step: 0.02,
            get: () => S.sTint, set: v => S.sTint = v,
            fmt: v => v === 0 ? '中性' : (v > 0 ? '洋紅 ' + v.toFixed(2) : '綠 ' + (-v).toFixed(2)) }) },
        { id: 'sat', label: '飽和度', make: () => slider({
            label: '飽和度', min: 0, max: 200, step: 5,
            get: () => S.sSat, set: v => S.sSat = v, fmt: v => v + '%' }) }
      );
      else t.push({ id: 'toner', label: '調色', make: slotToner });
      t.push(brushTool());
      return t;
    }

    const t = [mode,
      { id: 'time', label: '曝光時間', make: () => slider({
          label: '曝光時間', hint: '時間愈長 → 照片愈暗', min: 2, max: 60, step: 1,
          get: () => S.time, set: v => S.time = v, fmt: v => v + ' 秒' }) },
      { id: 'fstop', label: '光圈', make: () => seg({
          label: '鏡頭光圈', hint: '縮光圈 → 照片變亮',
          items: F_STOPS.map((v, i) => ({ label: 'f/' + v, value: i })),
          get: () => S.fstopIdx, set: v => S.fstopIdx = v }) }
    ];

    if (!isBW) {
      t.push(
        { id: 'y', label: '黃 Y', make: () => slider({
            label: '黃 Yellow', hint: '→ 畫面偏藍', min: 0, max: 170, step: 5,
            get: () => S.cy, set: v => S.cy = v, fmt: v => String(v) }) },
        { id: 'm', label: '洋紅 M', make: () => slider({
            label: '洋紅 Magenta', hint: '→ 畫面偏綠', min: 0, max: 170, step: 5,
            get: () => S.cm, set: v => S.cm = v, fmt: v => String(v) }) },
        { id: 'c', label: '青 C', make: () => slider({
            label: '青 Cyan', hint: '→ 畫面偏紅', min: 0, max: 170, step: 5,
            get: () => S.cc, set: v => S.cc = v, fmt: v => String(v) }) },
        { id: 'preset', label: '光源', make: slotLightPresets },
        { id: 'paper', label: '相紙', make: () => seg({
            label: '相紙', items: PAPERS.color.map(p => ({ label: p.name, value: p.id })),
            get: () => S.paperC, set: v => S.paperC = v, rebuild: true }) }
      );
    } else {
      t.push(
        { id: 'grade', label: '號數', make: () => seg({
            label: '反差號數', hint: '0 最軟 · 5 最硬', cls: 'grades',
            items: [0, 1, 2, 3, 4, 5].map(g => ({ label: String(g), value: g })),
            get: () => S.grade, set: v => S.grade = v }) },
        { id: 'paper', label: '紙張', make: () => seg({
            label: '紙張', items: PAPERS.bw.map(p => ({ label: p.name.replace('Multigrade ', 'MG '), value: p.id })),
            get: () => S.paperB, set: v => S.paperB = v, rebuild: true }) },
        { id: 'toner', label: '調色', make: slotToner },
        { id: 'bleach', label: '減薄劑', make: () => slider({
            label: '減薄劑', hint: '弱化暗部', min: 0, max: 100, step: 5,
            get: () => S.bleach, set: v => S.bleach = v, fmt: v => v + '%' }) }
      );
    }
    t.push(brushTool());
    return t;
  }

  return [
    { id: 'border', label: '邊框', make: () => seg({
        label: '邊框', items: [
          { label: '無', value: 'none' },
          { label: '相紙白邊', value: 'paper' },
          { label: '底片齒孔', value: 'film' }],
        get: () => S.border, set: v => S.border = v }) },
    { id: 'stamp', label: '日期戳印', make: () => toggle(
        '日期戳印', () => S.stamp, v => S.stamp = v, '印在右下角').el },
    { id: 'info', make: slotInfo, label: '資訊' }
  ];
}

function brushTool() {
  return { id: 'brush', label: '加光 / 遮光', make: slotBrush };
}

// ── 各種控制項 ──
function slotFilms() {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  const f = currentFilm();
  wrap.innerHTML = `<div class="filmchips"></div>` +
    `<div class="filmnote">${f.brand} ${f.name} — ${f.note}</div>`;
  const box = wrap.querySelector('.filmchips');
  const list = S.mode === 'bw'
    ? FILMS.filter(x => x.type === 'bw').concat(FILMS.filter(x => x.type !== 'bw'))
    : FILMS.filter(x => x.type !== 'bw');
  list.forEach(x => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(x.id === S.filmId));
    b.innerHTML = `<span class="fc-n">${x.name}</span>` +
      `<span class="fc-b">${x.brand} · ISO ${x.iso}${S.mode === 'bw' && x.type !== 'bw' ? ' · 印黑白' : ''}</span>`;
    b.onclick = () => {
      S.filmId = x.id;
      S.seed = Math.random() * 100;
      buildPanel(); buildFilms(); updateBadge(); requestRender();
    };
    box.appendChild(b);
  });
  setTimeout(() => {
    const sel = box.querySelector('[aria-pressed="true"]');
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, 0);
  return wrap;
}

function slotToner() {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  wrap.appendChild(seg({
    items: TONERS.map(t => ({ label: t.name, value: t.id })),
    get: () => S.toner, set: v => S.toner = v, rebuild: true
  }));
  if (S.toner !== 'none') {
    wrap.appendChild(slider({
      label: '調色濃度', min: 0, max: 150, step: 5,
      get: () => S.tonerAmt, set: v => S.tonerAmt = v, fmt: v => v + '%'
    }));
  }
  return wrap;
}

function slotLightPresets() {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  wrap.innerHTML = '<div class="top"><span class="lab">光源預設</span>' +
    '<span class="hint">一次設好三個濾鏡</span></div><div class="seg"></div>';
  const box = wrap.querySelector('.seg');
  [['日光', 0, 0, 0], ['鎢絲燈', 0, 15, 75], ['陰天', 25, 10, 0],
   ['螢光燈', 10, 45, 0], ['黃昏', 45, 20, 0]].forEach(([n, c, m, y]) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.setAttribute('aria-pressed', String(S.cc === c && S.cm === m && S.cy === y));
    b.onclick = () => { S.cc = c; S.cm = m; S.cy = y; buildPanel(); requestRender(); };
    box.appendChild(b);
  });
  return wrap;
}

function slotBrush() {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  if (live) {
    wrap.appendChild(note('先拍一張，才能在相紙上加減光。'));
    return wrap;
  }
  const row = seg({
    items: [{ label: '加光（變暗）', value: 'burn' }, { label: '遮光（變亮）', value: 'dodge' }],
    get: () => S.brushMode, set: v => S.brushMode = v
  });
  const clr = document.createElement('button');
  clr.textContent = '洗掉';
  clr.onclick = clearMask;
  row.querySelector('.seg').appendChild(clr);
  wrap.appendChild(row);
  wrap.appendChild(slider({
    label: '筆刷大小', min: 8, max: 80, step: 2,
    get: () => S.brushSize, set: v => S.brushSize = v, fmt: v => v + '%'
  }));
  wrap.appendChild(slider({
    label: '力道', min: 10, max: 200, step: 5,
    get: () => S.brushK, set: v => S.brushK = v, fmt: v => v + '%'
  }));
  return wrap;
}

function slotInfo() {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  wrap.appendChild(note('存檔會用原始解析度重新沖洗一次，然後開啟分享選單 — 選「儲存影像」就會進相簿。'));
  const info = document.createElement('div');
  info.className = 'sub';
  info.textContent = src.w ? `原稿 ${src.w} × ${src.h}` : '還沒有影像';
  wrap.appendChild(info);
  return wrap;
}

// ── 組裝 ──
function buildPanel() {
  $('tFilm').setAttribute('aria-selected', S.tab === 'film');
  $('tRoom').setAttribute('aria-selected', S.tab === 'room');
  $('tOut').setAttribute('aria-selected', S.tab === 'out');

  const tools = toolsFor(S.tab);
  let cur = S.tools[S.tab];
  if (!tools.some(t => t.id === cur)) cur = S.tools[S.tab] = tools[0].id;

  // 只有停在「加光 / 遮光」時，手指才在照片上畫
  S.brush = (cur === 'brush' && !live);
  $('tray').dataset.brush = S.brush ? 'on' : 'off';

  const row = $('toolrow');
  row.innerHTML = '';
  tools.forEach(t => {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.setAttribute('aria-pressed', String(t.id === cur));
    b.onclick = () => {
      S.tools[S.tab] = t.id;
      buildPanel();
      b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    };
    row.appendChild(b);
  });
  setTimeout(() => {
    const sel = row.querySelector('[aria-pressed="true"]');
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, 0);

  const slot = $('slot');
  slot.innerHTML = '';
  const tool = tools.find(t => t.id === cur);
  if (tool) slot.appendChild(tool.make());

  requestAnimationFrame(() => { fitCanvas(); if (!live) draw(); });
}

// ───────── 啟動 ─────────
function init() {
  try {
    R = new Renderer($('view'));
  } catch (e) {
    $('empty').innerHTML = '<p>' + e.message + '</p>';
    return;
  }

  $('mColor').onclick = () => setMode('color');
  $('mBw').onclick = () => setMode('bw');
  $('tFilm').onclick = () => { S.tab = 'film'; buildPanel(); };
  $('tRoom').onclick = () => { S.tab = 'room'; buildPanel(); };
  $('tOut').onclick = () => { S.tab = 'out'; buildPanel(); };
  const togglePanel = () => {
    $('panel').classList.toggle('collapsed');
    setTimeout(() => { fitCanvas(); if (!live) draw(); }, 200);
  };
  $('chev').onclick = togglePanel;
  // 點照片本身也能收合，看大圖
  $('tray').addEventListener('click', () => {
    if (live || S.brush || !src.w) return;
    togglePanel();
  });

  $('bLib').onclick = () => $('file').click();
  $('file').onchange = e => {
    const fl = e.target.files && e.target.files[0];
    if (fl) loadBlob(fl).catch(err => toast('讀不到這張圖：' + err.message, 3500));
    e.target.value = '';
  };
  $('bCam').onclick = startCamera;
  $('bShot').onclick = shoot;
  $('bFlip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); };
  $('bClose').onclick = closeCamera;
  $('bSave').onclick = save;

  bindBrush();
  setMode('color');
  buildFilms();
  buildPanel();

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { fitCanvas(); if (!live) draw(); }, 120);
  });
  // 切到背景就放開相機；切回來自動接上，不會留一張死畫面
  let resumeCam = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (live) { resumeCam = true; stopCamera(); }
    } else if (resumeCam) {
      resumeCam = false;
      startCamera();
    }
  });
  window.addEventListener('gesturestart', e => e.preventDefault());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
