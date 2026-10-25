// WebGL 底片 / 暗房渲染引擎
//
// 流程：
//   原稿 → [底片階段] 曝光・光譜響應・特性曲線・顆粒
//        → [放大機]   曝光時間・CMY 濾鏡・加光遮光
//        → [相紙]     反差號數・紙基色・調色
//        → 成品
//
// Halation（紅色光暈）需要模糊，所以走三個 pass：
//   亮部擷取 → 橫向模糊 → 縱向模糊 → 主 pass 取用

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
uniform float uFlipY;
void main(){
  vUv = vec2(aPos.x * 0.5 + 0.5, (aPos.y * 0.5 + 0.5));
  vUv.y = mix(vUv.y, 1.0 - vUv.y, uFlipY);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// 亮部擷取
const FRAG_BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform float uThresh;
void main(){
  vec3 c = texture2D(uSrc, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float w = smoothstep(uThresh, 1.0, l);
  gl_FragColor = vec4(c * w, 1.0);
}`;

// 可分離高斯模糊
const FRAG_BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
void main(){
  vec3 sum = texture2D(uSrc, vUv).rgb * 0.227027;
  sum += texture2D(uSrc, vUv + uDir * 1.3846).rgb * 0.316216;
  sum += texture2D(uSrc, vUv - uDir * 1.3846).rgb * 0.316216;
  sum += texture2D(uSrc, vUv + uDir * 3.2308).rgb * 0.070270;
  sum += texture2D(uSrc, vUv - uDir * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}`;

const FRAG_MAIN = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uSrc;
uniform sampler2D uHalo;
uniform sampler2D uMask;
uniform vec2  uSrcTexel;

// ── 底片 ──
uniform mat3  uMix;
uniform vec3  uBwMix;
uniform vec3  uShTint, uHiTint;
uniform float uIsBW, uSat, uCon, uToe, uShoulder;
uniform float uGrainAmt, uGrainSize, uHalation, uFog, uSharpen;
uniform vec2  uGrainRes;
uniform float uFilmEV;

// ── 放大機 / 相紙 ──
uniform float uPrintEV;
uniform vec3  uCMY;
uniform float uPaperCon;
uniform vec3  uPaperBase;
uniform vec3  uTonerSh, uTonerHi;
uniform float uTonerAmt;
uniform float uHasMask, uBurnK;

// ── 鏡頭 / 意外 ──
uniform float uVignette, uLeak, uLeakAngle, uSeed, uBleach;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgbToLin(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linToSrgb(vec3 c){
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// 平滑反差函數：不會削掉兩端
float gain(float x, float k){
  x = clamp(x, 0.0, 1.0);
  float a = 0.5 * pow(2.0 * ((x < 0.5) ? x : 1.0 - x), k);
  return (x < 0.5) ? a : 1.0 - a;
}
vec3 gain3(vec3 v, float k){
  return vec3(gain(v.r, k), gain(v.g, k), gain(v.b, k));
}

float hash(vec2 p){
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
// 兩層雜訊 → 像銀鹽結晶的團塊
float grainNoise(vec2 p){
  float n1 = hash(floor(p) + uSeed);
  float n2 = hash(floor(p * 0.5) + uSeed * 1.7);
  return (n1 * 0.68 + n2 * 0.32) - 0.5;
}

void main(){
  vec2 uv = vUv;

  // ── 取樣（含銳利度：模擬 T 顆粒底片的解析力）──
  vec3 src = texture2D(uSrc, uv).rgb;
  if (uSharpen > 0.001) {
    vec3 blur = texture2D(uSrc, uv + vec2(uSrcTexel.x, 0.0)).rgb
              + texture2D(uSrc, uv - vec2(uSrcTexel.x, 0.0)).rgb
              + texture2D(uSrc, uv + vec2(0.0, uSrcTexel.y)).rgb
              + texture2D(uSrc, uv - vec2(0.0, uSrcTexel.y)).rgb;
    src += (src - blur * 0.25) * uSharpen;
  }

  // ═══ 底片階段 ═══
  vec3 lin = srgbToLin(max(src, 0.0));
  lin *= exp2(uFilmEV);                    // 相機曝光 + 推拉

  lin = uMix * lin;                        // 染料層光譜交叉響應
  lin = max(lin, 0.0);

  // 高光肩部：底片的寬容度
  float w = 1.0 + uShoulder * 4.0;
  lin = lin / (1.0 + lin / w) * ((w + 1.0) / w);

  vec3 v = linToSrgb(lin);

  // 特性曲線
  v = gain3(v, uCon);

  // 趾部：暗部抬起、失去分離
  float lv = dot(v, LUMA);
  v += uToe * 0.04 * (1.0 - smoothstep(0.0, 0.55, lv));
  v += uFog;                               // 片基灰霧

  // 色偏（暗部 / 高光分開）
  lv = clamp(dot(v, LUMA), 0.0, 1.0);
  v += uShTint * (1.0 - smoothstep(0.0, 0.62, lv));
  v += uHiTint * smoothstep(0.38, 1.0, lv);

  // 紅色光暈：高光從片基反射回來
  if (uHalation > 0.001) {
    vec3 halo = texture2D(uHalo, uv).rgb;
    v += halo * uHalation * vec3(1.0, 0.30, 0.16) * 0.9;
  }

  // 黑白：光譜敏感度 → 單色
  if (uIsBW > 0.5) {
    float g = dot(v, uBwMix);
    v = vec3(clamp(g, 0.0, 1.4));
  } else {
    float l = dot(v, LUMA);
    v = mix(vec3(l), v, uSat);
  }

  // ═══ 放大機階段 ═══
  float printEV = uPrintEV;

  // 加光 / 遮光：局部曝光
  if (uHasMask > 0.5) {
    vec2 m = texture2D(uMask, uv).rg;
    printEV += (m.r - m.g) * uBurnK;       // R = 加光(暗)，G = 遮光(亮)
  }

  v *= exp2(-printEV);                     // 曝光時間愈長 → 相紙愈暗

  // 減色法 CMY 濾鏡：濾鏡擋光 → 相紙該層吃光少 → 成品該色偏亮
  if (uIsBW < 0.5) {
    vec3 chanGain = exp2(uCMY * 0.42);
    v *= chanGain / max(dot(chanGain, LUMA), 0.001);
  }

  // ═══ 相紙階段 ═══
  v = gain3(clamp(v, 0.0, 1.6), uPaperCon);   // 反差號數 / 相紙反差
  v *= uPaperBase;                             // 紙基色

  // 漂白（弱化暗部，像用了減薄劑）
  if (uBleach > 0.001) {
    v = mix(v, 1.0 - (1.0 - v) * (1.0 - v), uBleach * 0.35);
  }

  // 化學調色
  if (uTonerAmt > 0.001) {
    float l = clamp(dot(v, LUMA), 0.0, 1.0);
    vec3 t = uTonerSh * (1.0 - smoothstep(0.0, 0.70, l))
           + uTonerHi * smoothstep(0.30, 1.0, l);
    v += t * uTonerAmt;
  }

  // ═══ 顆粒 ═══
  if (uGrainAmt > 0.001) {
    float l = clamp(dot(v, LUMA), 0.0, 1.0);
    float vis = 4.0 * l * (1.0 - l);                  // 中間調最明顯
    vis = pow(max(vis, 0.0), 0.65);
    float g = grainNoise(uv * uGrainRes / max(uGrainSize, 0.5));
    v += g * uGrainAmt * 0.19 * (vis * 0.85 + 0.15);
  }

  // ═══ 鏡頭 / 意外 ═══
  if (uVignette > 0.001) {
    vec2 d = uv - 0.5;
    float r = length(d * vec2(1.0, 1.0)) * 1.414;
    v *= 1.0 - uVignette * smoothstep(0.35, 1.05, r) * 0.9;
  }
  if (uLeak > 0.001) {
    vec2 dir = vec2(cos(uLeakAngle), sin(uLeakAngle));
    float d = dot(uv - 0.5, dir) + 0.5;
    float streak = smoothstep(0.78, 1.18, d);
    streak += smoothstep(0.90, 1.0, d) * 0.6;
    v += streak * uLeak * vec3(1.0, 0.52, 0.20);
  }

  gl_FragColor = vec4(clamp(v, 0.0, 1.0), 1.0);
}`;

class Renderer {
  constructor(canvas) {
    const opts = {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    };
    const gl = canvas.getContext('webgl', opts) ||
               canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('這台裝置不支援 WebGL');
    this.gl = gl;
    this.canvas = canvas;

    this.progMain   = this._program(VERT, FRAG_MAIN);
    this.progBright = this._program(VERT, FRAG_BRIGHT);
    this.progBlur   = this._program(VERT, FRAG_BLUR);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.srcTex  = this._tex();
    this.maskTex = this._tex();
    this.fbo = [this._fbo(), this._fbo()];
    this.srcSize = [1, 1];
    this.haloSize = [1, 1];
  }

  _shader(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  _program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  _tex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  _fbo() {
    const gl = this.gl;
    const tex = this._tex();
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w: 0, h: 0 };
  }

  _resizeFbo(f, w, h) {
    if (f.w === w && f.h === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, f.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    f.w = w; f.h = h;
  }

  _draw(prog, flipY) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (prog.u.uFlipY) gl.uniform1f(prog.u.uFlipY, flipY ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // 來源可以是 <img>、<video> 或 canvas
  setSource(el, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    } catch (e) { return false; }
    this.srcSize = [w, h];
    return true;
  }

  setMask(canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  render(P) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;

    // ── halation 預處理 ──
    if (P.halation > 0.001) {
      const bw = Math.max(32, W >> 2), bh = Math.max(32, H >> 2);
      this._resizeFbo(this.fbo[0], bw, bh);
      this._resizeFbo(this.fbo[1], bw, bh);
      gl.viewport(0, 0, bw, bh);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0].fb);
      gl.useProgram(this.progBright.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this.progBright.u.uSrc, 0);
      gl.uniform1f(this.progBright.u.uThresh, 0.68);
      this._draw(this.progBright, false);

      for (let i = 0; i < 2; i++) {
        const dir = i === 0 ? [2.2 / bw, 0] : [0, 2.2 / bh];
        const from = this.fbo[i], to = this.fbo[1 - i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
        gl.useProgram(this.progBlur.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform1i(this.progBlur.u.uSrc, 0);
        gl.uniform2f(this.progBlur.u.uDir, dir[0], dir[1]);
        this._draw(this.progBlur, false);
      }
      this.haloTex = this.fbo[1].tex;
    }

    // ── 主 pass ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const m = this.progMain, u = m.u;
    gl.useProgram(m.p);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(u.uSrc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (P.halation > 0.001 && this.haloTex) ? this.haloTex : this.srcTex);
    gl.uniform1i(u.uHalo, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(u.uMask, 2);

    gl.uniform2f(u.uSrcTexel, 1 / this.srcSize[0], 1 / this.srcSize[1]);
    gl.uniformMatrix3fv(u.uMix, false, P.mix);
    gl.uniform3fv(u.uBwMix, P.bwMix);
    gl.uniform3fv(u.uShTint, P.shTint);
    gl.uniform3fv(u.uHiTint, P.hiTint);
    gl.uniform1f(u.uIsBW, P.isBW);
    gl.uniform1f(u.uSat, P.sat);
    gl.uniform1f(u.uCon, P.con);
    gl.uniform1f(u.uToe, P.toe);
    gl.uniform1f(u.uShoulder, P.shoulder);
    gl.uniform1f(u.uGrainAmt, P.grainAmt);
    gl.uniform1f(u.uGrainSize, P.grainSize);
    gl.uniform2fv(u.uGrainRes, P.grainRes);
    gl.uniform1f(u.uHalation, P.halation);
    gl.uniform1f(u.uFog, P.fog);
    gl.uniform1f(u.uSharpen, P.sharpen);
    gl.uniform1f(u.uFilmEV, P.filmEV);
    gl.uniform1f(u.uPrintEV, P.printEV);
    gl.uniform3fv(u.uCMY, P.cmy);
    gl.uniform1f(u.uPaperCon, P.paperCon);
    gl.uniform3fv(u.uPaperBase, P.paperBase);
    gl.uniform3fv(u.uTonerSh, P.tonerSh);
    gl.uniform3fv(u.uTonerHi, P.tonerHi);
    gl.uniform1f(u.uTonerAmt, P.tonerAmt);
    gl.uniform1f(u.uHasMask, P.hasMask);
    gl.uniform1f(u.uBurnK, P.burnK);
    gl.uniform1f(u.uVignette, P.vignette);
    gl.uniform1f(u.uLeak, P.leak);
    gl.uniform1f(u.uLeakAngle, P.leakAngle);
    gl.uniform1f(u.uSeed, P.seed);
    gl.uniform1f(u.uBleach, P.bleach);

    this._draw(m, P.flipY);
  }
}
