// 底片資料庫 — 每支底片的感光特性
//
// mix      : 3x3 線性光色彩響應矩陣（模擬染料層光譜交叉感光）
// sat      : 飽和度
// con      : 反差（S 曲線強度）
// toe      : 暗部趾部壓縮（愈大暗部愈軟）
// shoulder : 高光肩部壓縮（寬容度，愈大愈能救高光）
// shTint   : 暗部色偏 [r,g,b]
// hiTint   : 高光色偏 [r,g,b]
// grainAmt : 顆粒強度
// grainSize: 顆粒粗細（像素）
// halation : 紅色光暈（高光溢出）
// bwMix    : 黑白底片的光譜敏感度權重（null = 彩色底片）

const FILMS = [
  // ───────────── 彩色負片 ─────────────
  {
    id: 'portra400', brand: 'Kodak', name: 'Portra 400', iso: 400,
    type: 'cneg', label: '彩色負片',
    note: '人像王者。膚色暖而透，陰影帶青，反差柔和。',
    mix: [1.02, 0.02, -0.04,  -0.02, 0.99, 0.03,  0.00, -0.04, 1.04],
    sat: 0.88, con: 0.82, toe: 0.42, shoulder: 0.62,
    shTint: [-0.010, 0.004, 0.022], hiTint: [0.028, 0.014, -0.012],
    grainAmt: 0.30, grainSize: 1.9, halation: 0.10, bwMix: null
  },
  {
    id: 'gold200', brand: 'Kodak', name: 'Gold 200', iso: 200,
    type: 'cneg', label: '彩色負片',
    note: '週末下午的金黃。暖調厚實，綠偏黃，很懷舊。',
    mix: [1.06, 0.05, -0.08,  0.00, 1.00, 0.00,  -0.02, -0.05, 1.02],
    sat: 1.00, con: 0.90, toe: 0.36, shoulder: 0.50,
    shTint: [0.014, 0.004, -0.014], hiTint: [0.050, 0.028, -0.034],
    grainAmt: 0.36, grainSize: 2.1, halation: 0.12, bwMix: null
  },
  {
    id: 'ektar100', brand: 'Kodak', name: 'Ektar 100', iso: 100,
    type: 'cneg', label: '彩色負片',
    note: '世界上最細的彩色負片。紅得發豔，反差高，風景利器。',
    mix: [1.14, -0.08, -0.04,  -0.06, 1.10, -0.04,  -0.04, -0.08, 1.14],
    sat: 1.26, con: 1.10, toe: 0.24, shoulder: 0.38,
    shTint: [-0.008, 0.000, 0.012], hiTint: [0.016, 0.004, -0.010],
    grainAmt: 0.16, grainSize: 1.4, halation: 0.08, bwMix: null
  },
  {
    id: 'ultramax400', brand: 'Kodak', name: 'UltraMax 400', iso: 400,
    type: 'cneg', label: '彩色負片',
    note: '便利商店底片。對比直接、略帶洋紅，日常感最強。',
    mix: [1.08, 0.00, -0.06,  -0.04, 1.02, 0.00,  0.02, -0.04, 1.04],
    sat: 1.10, con: 1.00, toe: 0.30, shoulder: 0.44,
    shTint: [0.010, -0.006, 0.012], hiTint: [0.034, 0.012, -0.018],
    grainAmt: 0.44, grainSize: 2.3, halation: 0.14, bwMix: null
  },
  {
    id: 'pro400h', brand: 'Fujifilm', name: 'PRO 400H', iso: 400,
    type: 'cneg', label: '彩色負片',
    note: '已停產的淡雅。高光帶薄荷綠，低反差，婚禮御用。',
    mix: [0.96, 0.06, -0.02,  -0.02, 1.00, 0.02,  0.00, 0.04, 0.96],
    sat: 0.80, con: 0.72, toe: 0.50, shoulder: 0.68,
    shTint: [-0.006, 0.012, 0.014], hiTint: [-0.012, 0.024, 0.008],
    grainAmt: 0.26, grainSize: 1.8, halation: 0.08, bwMix: null
  },
  {
    id: 'superia400', brand: 'Fujifilm', name: 'Superia X-TRA 400', iso: 400,
    type: 'cneg', label: '彩色負片',
    note: '富士家傳的青綠。葉子偏青、天空通透，九〇年代的味道。',
    mix: [1.02, 0.02, -0.04,  -0.08, 1.12, -0.04,  -0.02, 0.04, 0.98],
    sat: 1.14, con: 1.02, toe: 0.30, shoulder: 0.46,
    shTint: [-0.014, 0.008, 0.020], hiTint: [0.006, 0.022, -0.004],
    grainAmt: 0.40, grainSize: 2.2, halation: 0.12, bwMix: null
  },
  {
    id: 'cinestill800t', brand: 'CineStill', name: '800T', iso: 800,
    type: 'cneg', label: '彩色負片',
    note: '電影底片去膜。鈷藍夜色，路燈會爆出紅色光暈。',
    mix: [0.88, 0.04, 0.08,  -0.02, 0.96, 0.06,  0.00, 0.02, 1.18],
    sat: 1.04, con: 0.92, toe: 0.44, shoulder: 0.56,
    shTint: [-0.020, -0.004, 0.044], hiTint: [0.010, 0.000, 0.030],
    grainAmt: 0.50, grainSize: 2.4, halation: 0.85, bwMix: null
  },
  {
    id: 'lomo400', brand: 'Lomography', name: 'Color Negative 400', iso: 400,
    type: 'cneg', label: '彩色負片',
    note: '不講道理的飽和。暗角重、反差硬，玩具相機的脾氣。',
    mix: [1.16, -0.04, -0.08,  -0.06, 1.08, -0.02,  0.02, -0.06, 1.08],
    sat: 1.34, con: 1.18, toe: 0.22, shoulder: 0.34,
    shTint: [0.016, -0.008, 0.016], hiTint: [0.040, 0.008, -0.012],
    grainAmt: 0.54, grainSize: 2.6, halation: 0.18, bwMix: null
  },

  // ───────────── 正片（反轉片） ─────────────
  {
    id: 'velvia50', brand: 'Fujifilm', name: 'Velvia 50', iso: 50,
    type: 'slide', label: '正片',
    note: '飽和度的極限。紅綠爆炸、暗部濃黑，風景攝影的毒藥。',
    mix: [1.22, -0.12, -0.06,  -0.10, 1.20, -0.08,  -0.04, -0.14, 1.20],
    sat: 1.55, con: 1.38, toe: 0.12, shoulder: 0.18,
    shTint: [-0.010, 0.000, 0.016], hiTint: [0.014, 0.004, -0.008],
    grainAmt: 0.14, grainSize: 1.3, halation: 0.06, bwMix: null
  },
  {
    id: 'provia100f', brand: 'Fujifilm', name: 'PROVIA 100F', iso: 100,
    type: 'slide', label: '正片',
    note: '乾淨中性，微帶冷青。要準就用這支。',
    mix: [1.06, -0.02, -0.02,  -0.04, 1.06, -0.02,  -0.02, 0.00, 1.04],
    sat: 1.14, con: 1.20, toe: 0.18, shoulder: 0.24,
    shTint: [-0.008, 0.002, 0.014], hiTint: [-0.004, 0.006, 0.006],
    grainAmt: 0.14, grainSize: 1.4, halation: 0.05, bwMix: null
  },
  {
    id: 'ektachrome100', brand: 'Kodak', name: 'Ektachrome E100', iso: 100,
    type: 'slide', label: '正片',
    note: '復活的經典。白是白、黑是黑，微反差銳利。',
    mix: [1.10, -0.04, -0.04,  -0.04, 1.06, -0.02,  -0.04, -0.02, 1.08],
    sat: 1.18, con: 1.26, toe: 0.16, shoulder: 0.22,
    shTint: [0.004, 0.000, 0.008], hiTint: [0.014, 0.008, -0.004],
    grainAmt: 0.13, grainSize: 1.3, halation: 0.06, bwMix: null
  },

  // ───────────── 黑白 ─────────────
  {
    id: 'trix400', brand: 'Kodak', name: 'Tri-X 400', iso: 400,
    type: 'bw', label: '黑白',
    note: '新聞攝影的骨頭。黑得濃、顆粒硬，推一格更有脾氣。',
    mix: null, sat: 0, con: 1.08, toe: 0.30, shoulder: 0.44,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.62, grainSize: 2.3, halation: 0.0,
    bwMix: [0.34, 0.52, 0.14]
  },
  {
    id: 'tmax100', brand: 'Kodak', name: 'T-MAX 100', iso: 100,
    type: 'bw', label: '黑白',
    note: 'T 顆粒科技。細緻平滑、階調長，像素級的乾淨。',
    mix: null, sat: 0, con: 1.00, toe: 0.26, shoulder: 0.40,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.20, grainSize: 1.4, halation: 0.0,
    bwMix: [0.30, 0.56, 0.14], sharpen: 0.35
  },
  {
    id: 'hp5', brand: 'Ilford', name: 'HP5 Plus 400', iso: 400,
    type: 'bw', label: '黑白',
    note: '最寬容的那支。曝光差兩格都還有救，顆粒看得見。',
    mix: null, sat: 0, con: 0.92, toe: 0.38, shoulder: 0.56,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.54, grainSize: 2.2, halation: 0.0,
    bwMix: [0.32, 0.54, 0.14]
  },
  {
    id: 'delta3200', brand: 'Ilford', name: 'Delta 3200', iso: 3200,
    type: 'bw', label: '黑白',
    note: '暗到不行才用。顆粒像砂紙，黑部灰霧，氣氛全靠它。',
    mix: null, sat: 0, con: 0.78, toe: 0.52, shoulder: 0.66,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 1.00, grainSize: 3.4, halation: 0.0,
    bwMix: [0.34, 0.50, 0.16], fog: 0.045
  },
  {
    id: 'panf50', brand: 'Ilford', name: 'Pan F Plus 50', iso: 50,
    type: 'bw', label: '黑白',
    note: '幾乎沒有顆粒。反差高、黑白分明，要腳架。',
    mix: null, sat: 0, con: 1.22, toe: 0.18, shoulder: 0.30,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.12, grainSize: 1.2, halation: 0.0,
    bwMix: [0.28, 0.58, 0.14], sharpen: 0.45
  },
  {
    id: 'fomapan100', brand: 'Foma', name: 'Fomapan 100 Classic', iso: 100,
    type: 'bw', label: '黑白',
    note: '捷克老派配方。反差略低、帶一層薄霧，像舊照片。',
    mix: null, sat: 0, con: 0.86, toe: 0.42, shoulder: 0.52,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.46, grainSize: 2.0, halation: 0.0,
    bwMix: [0.36, 0.50, 0.14], fog: 0.030
  },
  {
    id: 'doublex', brand: 'Kodak', name: 'Double-X 5222', iso: 250,
    type: 'bw', label: '黑白',
    note: '電影黑白底片。中間調厚、暗部有細節，很有戲。',
    mix: null, sat: 0, con: 0.96, toe: 0.36, shoulder: 0.50,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.48, grainSize: 2.1, halation: 0.0,
    bwMix: [0.33, 0.53, 0.14]
  },
  {
    id: 'rolleiIR', brand: 'Rollei', name: 'Infrared 400', iso: 400,
    type: 'bw', label: '黑白 · 紅外',
    note: '木頭效應。樹葉變雪白、天空變墨黑，世界翻過來。',
    mix: null, sat: 0, con: 1.16, toe: 0.26, shoulder: 0.40,
    shTint: [0, 0, 0], hiTint: [0, 0, 0],
    grainAmt: 0.50, grainSize: 2.2, halation: 0.0,
    bwMix: [0.52, 0.78, -0.30]
  }
];

// 相紙 ─────────────────────────────────────────
const PAPERS = {
  bw: [
    { id: 'mg-fb-warm', brand: 'Ilford', name: 'Multigrade FB Warmtone',
      base: [1.000, 0.982, 0.930], note: '纖維基暖調，白裡帶奶油色' },
    { id: 'mg-rc-neutral', brand: 'Ilford', name: 'Multigrade RC Deluxe',
      base: [1.000, 0.998, 0.994], note: '樹脂塗佈中性白，最標準' },
    { id: 'mg-fb-classic', brand: 'Ilford', name: 'Multigrade FB Classic',
      base: [0.998, 1.000, 0.998], note: '纖維基冷中性，黑最深' },
    { id: 'foma-variant', brand: 'Foma', name: 'Fomabrom Variant 111',
      base: [1.000, 0.990, 0.962], note: '捷克紙，略暖、階調厚' }
  ],
  color: [
    { id: 'crystal-archive', brand: 'Fujifilm', name: 'Crystal Archive',
      base: [0.998, 1.000, 0.996], contrast: 1.00, note: '中性冷白，富士沖印店標配' },
    { id: 'endura-premier', brand: 'Kodak', name: 'Endura Premier',
      base: [1.000, 0.994, 0.978], contrast: 1.06, note: '略暖，膚色討喜' },
    { id: 'metallic', brand: 'Kodak', name: 'Endura Metallic',
      base: [1.000, 0.998, 1.000], contrast: 1.20, note: '金屬珠光，高反差高飽和' }
  ]
};

// 調色（黑白化學調色） ─────────────────────────
const TONERS = [
  { id: 'none',     name: '不調色',  sh: [0, 0, 0],            hi: [0, 0, 0] },
  { id: 'selenium', name: '硒調',    sh: [0.050, -0.010, 0.046], hi: [0.012, 0.000, 0.008] },
  { id: 'sepia',    name: '棕褐',    sh: [0.090, 0.030, -0.070], hi: [0.120, 0.062, -0.052] },
  { id: 'blue',     name: '藍調',    sh: [-0.070, -0.016, 0.100], hi: [-0.030, 0.000, 0.060] },
  { id: 'gold',     name: '金調',    sh: [0.070, 0.020, -0.030], hi: [0.090, 0.050, -0.056] },
  { id: 'copper',   name: '銅調',    sh: [0.100, 0.014, -0.040], hi: [0.080, 0.020, -0.010] },
  { id: 'cyanotype',name: '鐵藍',    sh: [-0.100, -0.030, 0.140], hi: [-0.060, 0.010, 0.110] }
];

const FILM_BY_ID = Object.fromEntries(FILMS.map(f => [f.id, f]));
