# 暗房 Darkroom

底片模擬暗房 — 選一支底片，進彩色或黑白暗房把照片沖出來。
為 iPhone 做的網頁 App（加到主畫面後全螢幕、可離線）。

## 怎麼用

在 iPhone 用 Safari 打開網址 → 分享 → **加入主畫面**。
之後從主畫面開，就跟一般 App 一樣，而且相機才能正常運作。

## 裡面有什麼

**19 支底片**，彩色負片／正片／黑白：
Kodak Portra 400・Gold 200・Ektar 100・UltraMax 400・Ektachrome E100・Tri-X 400・T-MAX 100・Double-X 5222／
Fujifilm PRO 400H・Superia X-TRA 400・Velvia 50・PROVIA 100F／
Ilford HP5 Plus・Delta 3200・Pan F Plus 50／
CineStill 800T・Lomography Color 400・Foma Fomapan 100・Rollei Infrared 400

每支底片都有自己的光譜響應矩陣、特性曲線、顆粒大小與強度。
CineStill 800T 會在高光爆紅暈，Rollei Infrared 會把樹葉變白、天空變黑。

**彩色暗房** — 放大機曝光時間與光圈、減色法 CMY 濾鏡盤（0–170，真實刻度與反向邏輯：加黃偏藍）、
三種相紙、五組光源預設。

**黑白暗房** — 相紙反差號數 0–5、四種相紙、七種化學調色（硒／棕褐／藍調／金調／銅調／鐵藍）、
減薄劑，以及用手指做的局部加光與遮光。

兩個暗房都可以切「簡易」滑桿模式。黑白暗房也收得下彩色底片 —— 彩色負片印黑白相紙是真的做法。

**輸出** — 原始解析度重新沖洗，可加底片齒孔邊框或相紙白邊，日期戳印。
存檔走系統分享選單，選「儲存影像」就進相簿。

## 技術

純前端，沒有相依套件。全部效果在一支 WebGL fragment shader 裡算完，
相機即時預覽也走同一條管線，所以看到什麼就拍到什麼。

```
原稿 → 底片（曝光・光譜響應・特性曲線・光暈）
     → 放大機（曝光時間・CMY 濾鏡・加光遮光）
     → 相紙（反差號數・紙基色・調色）
     → 顆粒・暗角・漏光 → 成品
```

## 本機開發

```sh
python3 -m http.server 4870
```

然後開 http://localhost:4870 。相機在 localhost 和 HTTPS 下才能用。
