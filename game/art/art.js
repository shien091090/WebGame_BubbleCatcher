/* 捕泡手 art.js (spec v14)
 * 全域物件 window.Art, 不用 ES module。純 Canvas 2D 幾何繪製, 不引外部資源。
 * 一組函式畫三套風格: 每個 draw 函式的 state.level(1 / 2 / 3)決定用哪一套。
 * 只負責「給狀態就畫」, 不算規則、不管輸入。每個函式自己 save / restore。
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 常數
  var W = 1280, H = 720, CX = 640, CY = 360;
  var ARENA_R = 210, BUBBLE_R = 20, FLOOR_R = 24;
  var WALL_APO = 300, WALL_R = WALL_APO / Math.cos(Math.PI / 8); // 約 324.7
  var TAU = Math.PI * 2, OCT = Math.PI / 4;
  var FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Heiti TC", sans-serif';

  // 各演出時長(秒)。RD 依這張表決定何時停止呼叫對應函式, t 從 0 走到時長
  var TIMING = {
    spawn: 0.3,       // 氣泡冒出(spawnT 0→1 用的總長)
    stickFx: 0.8,     // 沾上 / 已鎖定回饋(規格初始值)
    beatFx: 0.55,     // 踩拍回饋
    chainFx: 0.9,     // 整串回饋
    catchFx: 0.45,    // 一般捕捉回饋
    netHint: 0.6,     // 網剛亮起的換位提示
    clearFx: 1.2,     // 清場回饋
    floorIntro: 2.0,  // 地板出場提示(規格 2 秒)
    hpFx: 0.6         // 命條上「加減了一段」的亮段
  };

  // ---------------------------------------------------------------- 小工具
  function font(px, w) { return (w || 'bold') + ' ' + px + 'px ' + FONT; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function easeOut(t) { t = clamp01(t); return 1 - (1 - t) * (1 - t); }
  function easeOutBack(t) { t = clamp01(t); var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function hexRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { var c = hexRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(hex, target, amt) {
    var c = hexRgb(hex), t = hexRgb(target), out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.round(c[i] + (t[i] - c[i]) * amt);
      out += ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
    }
    return out;
  }
  function lighten(hex, a) { return mix(hex, '#ffffff', a); }
  function darken(hex, a) { return mix(hex, '#000000', a); }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); }
  function roundPoly(ctx, p, r) {
    var n = p.length;
    ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
    for (var i = 0; i < n; i++) {
      var a = p[i], b = p[(i + 1) % n];
      ctx.arcTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r);
    }
    ctx.closePath();
  }
  // 形狀路徑: 氣泡本體、網條件符號、賦形地板圖樣、沾上標籤共用同一套(P3)
  function shapePath(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'square') {
      var h = r * 0.86;
      roundRectPath(ctx, x - h, y - h, 2 * h, 2 * h, r * 0.26);
    } else if (shape === 'triangle') {
      var R = r * 1.2, cy = y + r * 0.17, p = [];
      for (var i = 0; i < 3; i++) {
        var a = -Math.PI / 2 + i * TAU / 3;
        p.push([x + R * Math.cos(a), cy + R * Math.sin(a)]);
      }
      roundPoly(ctx, p, r * 0.2);
    } else {
      ctx.arc(x, y, Math.max(0.01, r), 0, TAU);
    }
  }
  function text(ctx, str, x, y, px, color, align, opts) {
    opts = opts || {};
    ctx.font = font(px, opts.weight);
    ctx.textAlign = align || 'center';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = opts.strokeWidth || 4;
      ctx.strokeStyle = opts.stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  // ---------------------------------------------------------------- 三套風格
  // 不變層(三關都一樣, 辨識靠它): 氣泡 = 立體漸層 + 高光 + 落影 + 壽命環; 地板 = 平塗無影;
  // 無色 = 空心玻璃; 有色 = 實心; 亮邊 = 粗 + 發光 + 條件色; 拍子 = 該關專屬色(只給拍子用)。
  // 可變層(每關換): 背景、內圈地面紋理、網牆線型、色組、拍子提示的造型、HUD 配色。
  var THEMES = {
    1: { // 第 1 首: 晚霞池畔(放鬆、好跟)。圓潤、柔光
      id: 1, name: 'dusk', style: 'soft',
      bgTop: '#2a2346', bgBottom: '#5a3a5e',
      ground: '#1e4650', groundLine: '#2b5d67', rim: '#8fd3c7',
      wallDim: '#7d7fa8', wallJoint: '#a7a9cf',
      colors: { A: '#ff6a55', B: '#fff07a', C: '#7fd4ff', D: '#7a52e0' },
      beat: '#ff7ad9', danger: '#ff3b4f',
      ink: '#fff6ea', inkDim: '#cbbfd8', hudPlate: 'rgba(22,15,38,0.78)',
      barBody: '#6fb5aa', glass: '#eafcff', lifeRing: '#ffe2b8',
      shapeFloorBase: '#0f2a30', shapeFloorGlyph: '#e9fbf5'
    },
    2: { // 第 2 首: 霓虹迪斯可(加速、更忙)。霓虹雙線、棋盤舞池
      id: 2, name: 'disco', style: 'neon',
      bgTop: '#0d0626', bgBottom: '#2b0b45',
      ground: '#26124a', groundLine: '#341b62', rim: '#a77bff',
      wallDim: '#6a4ea8', wallJoint: '#b48cff',
      colors: { A: '#ff4fb0', B: '#c8ff3a', C: '#ff9a2e', D: '#3a5cff' },
      beat: '#36f5ff', danger: '#ff2a3d',
      ink: '#f6f0ff', inkDim: '#bba8e8', hudPlate: 'rgba(12,5,30,0.8)',
      barBody: '#8c79d8', glass: '#e8f7ff', lifeRing: '#f2d6ff',
      shapeFloorBase: '#120729', shapeFloorGlyph: '#efe4ff'
    },
    3: { // 第 3 首: 警報衝刺(緊張、壓力上升)。硬角、分節、掃描線
      id: 3, name: 'alarm', style: 'hard',
      bgTop: '#08080c', bgBottom: '#1c0a0f',
      ground: '#1b1d23', groundLine: '#2b2e38', rim: '#c8ccd6',
      wallDim: '#5a5f6d', wallJoint: '#8d93a3',
      colors: { A: '#8b3dff', B: '#14c8b4', C: '#ffb000', D: '#e6ff4a' },
      beat: '#ff3df2', danger: '#ff2020',
      ink: '#f2f4f8', inkDim: '#a0a6b3', hudPlate: 'rgba(6,6,10,0.84)',
      barBody: '#98a2b6', glass: '#eef6ff', lifeRing: '#d3d9e4',
      shapeFloorBase: '#0c0d11', shapeFloorGlyph: '#eef1f6'
    }
  };
  function lv(level) { return (level === 2 || level === 3) ? level : 1; }
  function theme(level) { return THEMES[lv(level)]; }
  function condColor(level, key) { var c = theme(level).colors[key]; return c || '#ffffff'; }

  // ---------------------------------------------------------------- 版位(按鈕判定框給 RD 用)
  var LAYOUT = {
    hudLeft: { x: 20, y: 20, w: 240, h: 80 },
    hudRight: { x: 960, y: 20, w: 220, h: 80 },
    pauseBtn: { x: 1206, y: 26, w: 48, h: 48 },
    muteBtn: { x: 1206, y: 86, w: 48, h: 48 },
    title: {
      start: { x: 540, y: 392, w: 200, h: 60 },
      guide: { x: 540, y: 470, w: 200, h: 52 },
      device: { x: 540, y: 540, w: 200, h: 52 }
    },
    device: {
      mouse: { x: 450, y: 370, w: 170, h: 70 },
      touchpad: { x: 660, y: 370, w: 170, h: 70 }
    },
    pauseMenu: {
      panel: { x: 470, y: 180, w: 340, h: 360 },
      resume: { x: 520, y: 250, w: 240, h: 52 },
      restart: { x: 520, y: 316, w: 240, h: 52 },
      quit: { x: 520, y: 382, w: 240, h: 52 },
      guide: { x: 520, y: 448, w: 240, h: 52 }
    },
    gameOver: {
      panel: { x: 400, y: 150, w: 480, h: 420 },
      again: { x: 450, y: 470, w: 180, h: 60 },
      title: { x: 650, y: 470, w: 180, h: 60 }
    },
    guide: {
      close: { x: 1150, y: 20, w: 110, h: 48 },
      prev: { x: 20, y: 652, w: 140, h: 48 },
      next: { x: 1120, y: 652, w: 140, h: 48 }
    }
  };

  // ---------------------------------------------------------------- 背景
  var BOKEH = [[120, 140, 90], [260, 600, 70], [1080, 560, 110], [1180, 300, 60], [380, 380, 50], [930, 140, 80], [60, 470, 60], [820, 650, 50]];
  function drawBackground(ctx, state) {
    var L = lv(state && state.level), t = THEMES[L];
    ctx.save();
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.bgTop); g.addColorStop(1, t.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (L === 1) {
      var hg = ctx.createRadialGradient(CX, CY + 40, 60, CX, CY + 40, 520);
      hg.addColorStop(0, 'rgba(255,170,120,0.20)'); hg.addColorStop(1, 'rgba(255,170,120,0)');
      ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
      var bc = ['#ffb38a', '#ff8fa3', '#ffd59e'];
      for (var i = 0; i < BOKEH.length; i++) {
        circle(ctx, BOKEH[i][0], BOKEH[i][1], BOKEH[i][2]);
        ctx.fillStyle = rgba(bc[i % 3], 0.07); ctx.fill();
      }
    } else if (L === 2) {
      // 上下對稱的透視格線舞池 + 兩道聚光
      ctx.strokeStyle = 'rgba(255,63,208,0.16)'; ctx.lineWidth = 1.5;
      var vy = CY, k, yy;
      for (var side = -1; side <= 1; side += 2) {
        for (k = -12; k <= 12; k++) {
          ctx.beginPath(); ctx.moveTo(CX + k * 30, vy + side * 140);
          ctx.lineTo(CX + k * 160, side > 0 ? H : 0); ctx.stroke();
        }
        for (k = 0; k < 7; k++) {
          yy = vy + side * (140 + Math.pow(k, 1.7) * 14);
          ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
        }
      }
      var spots = [[0, 0, 1], [W, 0, -1]];
      for (k = 0; k < 2; k++) {
        ctx.beginPath(); ctx.moveTo(spots[k][0], 0);
        ctx.lineTo(CX - spots[k][2] * 40, H); ctx.lineTo(CX + spots[k][2] * 260, H); ctx.closePath();
        ctx.fillStyle = 'rgba(54,245,255,0.045)'; ctx.fill();
      }
    } else {
      // 掃描線 + 兩側警示斜紋 + 紅色暗角
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (var y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, 70, H); ctx.rect(W - 70, 150, 70, H - 150); ctx.clip();
      ctx.strokeStyle = 'rgba(255,40,40,0.10)'; ctx.lineWidth = 14;
      for (var s = -H; s < W + H; s += 40) { ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s + H, H); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(200,204,214,0.06)'; ctx.lineWidth = 2;
      for (var c2 = 0; c2 < 4; c2++) {
        var off = 380 + c2 * 50;
        ctx.beginPath(); ctx.moveTo(CX - off - 60, CY - 120); ctx.lineTo(CX - off, CY); ctx.lineTo(CX - off - 60, CY + 120); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(CX + off + 60, CY - 120); ctx.lineTo(CX + off, CY); ctx.lineTo(CX + off + 60, CY + 120); ctx.stroke();
      }
      var vg = ctx.createRadialGradient(CX, CY, 300, CX, CY, 760);
      vg.addColorStop(0, 'rgba(120,0,0,0)'); vg.addColorStop(1, 'rgba(120,0,0,0.35)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 內圈(場地)
  function drawArena(ctx, state) {
    var L = lv(state && state.level), t = THEMES[L], i;
    ctx.save();
    // 外圈柔光讓內圈從背景浮出
    circle(ctx, CX, CY, ARENA_R + 10); ctx.fillStyle = rgba(t.rim, 0.08); ctx.fill();
    circle(ctx, CX, CY, ARENA_R); ctx.fillStyle = t.ground; ctx.fill();
    ctx.save();
    circle(ctx, CX, CY, ARENA_R); ctx.clip();
    if (L === 1) {
      ctx.strokeStyle = t.groundLine; ctx.lineWidth = 2;
      for (i = 1; i <= 4; i++) { circle(ctx, CX, CY, i * 46); ctx.stroke(); }
    } else if (L === 2) {
      ctx.fillStyle = t.groundLine;
      var cell = 35;
      for (var gx = -6; gx <= 6; gx++) for (var gy = -6; gy <= 6; gy++) {
        if ((gx + gy) % 2 === 0) ctx.fillRect(CX + gx * cell - cell / 2, CY + gy * cell - cell / 2, cell, cell);
      }
    } else {
      ctx.strokeStyle = t.groundLine; ctx.lineWidth = 2;
      for (i = 0; i < 12; i++) {
        var a = i * TAU / 12 + Math.PI / 12;
        ctx.beginPath(); ctx.moveTo(CX + 40 * Math.cos(a), CY + 40 * Math.sin(a));
        ctx.lineTo(CX + ARENA_R * Math.cos(a), CY + ARENA_R * Math.sin(a)); ctx.stroke();
      }
      ctx.setLineDash([10, 8]);
      circle(ctx, CX, CY, 70); ctx.stroke();
      circle(ctx, CX, CY, 175); ctx.stroke();
      ctx.setLineDash([]);
    }
    var vg = ctx.createRadialGradient(CX, CY, ARENA_R * 0.5, CX, CY, ARENA_R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vg; ctx.fillRect(CX - ARENA_R, CY - ARENA_R, ARENA_R * 2, ARENA_R * 2);
    ctx.restore();
    // 邊線
    if (L === 1) {
      ctx.lineWidth = 4; ctx.strokeStyle = rgba(t.rim, 0.85);
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
    } else if (L === 2) {
      ctx.shadowColor = t.rim; ctx.shadowBlur = 10;
      ctx.lineWidth = 2; ctx.strokeStyle = t.rim;
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
      circle(ctx, CX, CY, ARENA_R - 6); ctx.strokeStyle = rgba(t.rim, 0.5); ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(t.rim, 0.8);
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
      ctx.lineWidth = 3;
      for (i = 0; i < 24; i++) {
        var b = i * TAU / 24;
        ctx.beginPath(); ctx.moveTo(CX + (ARENA_R - 8) * Math.cos(b), CY + (ARENA_R - 8) * Math.sin(b));
        ctx.lineTo(CX + ARENA_R * Math.cos(b), CY + ARENA_R * Math.sin(b)); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 拍子提示
  // phase: 距上一拍已過的比例 0~1(0 = 剛到拍, 接近 1 = 下一拍快到)。收攏元素在 phase = 1 時正好貼上內圈邊線
  function drawBeatCue(ctx, state) {
    state = state || {};
    var L = lv(state.level), t = THEMES[L];
    var p = clamp01(num(state.phase, 0));
    var r = ARENA_R + 6 + 30 * (1 - p);
    var a = 0.18 + 0.5 * p;
    var i;
    ctx.save();
    ctx.strokeStyle = rgba(t.beat, a); ctx.fillStyle = rgba(t.beat, a);
    if (L === 1) {
      ctx.lineWidth = 3;
      circle(ctx, CX, CY, r); ctx.stroke();
    } else if (L === 2) {
      ctx.lineWidth = 4; ctx.lineCap = 'butt';
      var rot = (Math.floor(num(state.beat, 0)) % 2) * (TAU / 32);
      for (i = 0; i < 16; i++) {
        var s0 = rot + i * TAU / 16;
        ctx.beginPath(); ctx.arc(CX, CY, r, s0, s0 + TAU / 32); ctx.stroke();
      }
    } else {
      ctx.lineWidth = 1.5;
      circle(ctx, CX, CY, r); ctx.strokeStyle = rgba(t.beat, a * 0.5); ctx.stroke();
      for (i = 0; i < 8; i++) {
        var ang = Math.PI / 8 + i * OCT;
        var cx = Math.cos(ang), cy = Math.sin(ang), px = -cy, py = cx;
        var tipx = CX + r * cx, tipy = CY + r * cy;
        ctx.beginPath(); ctx.moveTo(tipx, tipy);
        ctx.lineTo(tipx + 12 * cx + 7 * px, tipy + 12 * cy + 7 * py);
        ctx.lineTo(tipx + 12 * cx - 7 * px, tipy + 12 * cy - 7 * py);
        ctx.closePath(); ctx.fill();
      }
    }
    // 到拍那一刻邊線閃一下
    var f = 1 - p / 0.22;
    if (f > 0) {
      ctx.shadowColor = t.beat; ctx.shadowBlur = 14 * f;
      ctx.lineWidth = 3 + 5 * f; ctx.strokeStyle = rgba(t.beat, 0.85 * f);
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 網牆
  function edgeOf(slot) {
    var m = (slot - 1) * OCT, a1 = m - OCT / 2, a2 = m + OCT / 2;
    return {
      m: m,
      x1: CX + WALL_R * Math.cos(a1), y1: CY + WALL_R * Math.sin(a1),
      x2: CX + WALL_R * Math.cos(a2), y2: CY + WALL_R * Math.sin(a2),
      mx: CX + WALL_APO * Math.cos(m), my: CY + WALL_APO * Math.sin(m)
    };
  }
  function octPoint(a, apo) {
    var d = a - Math.round(a / OCT) * OCT, r = apo / Math.cos(d);
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }
  function lerpPt(e, u) { return [e.x1 + (e.x2 - e.x1) * u, e.y1 + (e.y2 - e.y1) * u]; }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function drawDimEdge(ctx, t, L, e) {
    if (L === 1) {
      ctx.lineCap = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = rgba(t.wallDim, 0.5);
      line(ctx, e.x1, e.y1, e.x2, e.y2);
    } else if (L === 2) {
      var nx = Math.cos(e.m) * 4, ny = Math.sin(e.m) * 4;
      ctx.lineCap = 'butt'; ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.wallDim, 0.85);
      line(ctx, e.x1 - nx, e.y1 - ny, e.x2 - nx, e.y2 - ny);
      line(ctx, e.x1 + nx, e.y1 + ny, e.x2 + nx, e.y2 + ny);
    } else {
      ctx.lineCap = 'butt'; ctx.lineWidth = 9; ctx.strokeStyle = rgba(t.wallDim, 0.8);
      for (var k = 0; k < 5; k++) {
        var p1 = lerpPt(e, (k + 0.08) / 5), p2 = lerpPt(e, (k + 0.92) / 5);
        line(ctx, p1[0], p1[1], p2[0], p2[1]);
      }
    }
  }
  function drawJoints(ctx, t, L) {
    for (var k = 0; k < 8; k++) {
      var a = Math.PI / 8 + k * OCT, x = CX + WALL_R * Math.cos(a), y = CY + WALL_R * Math.sin(a);
      ctx.fillStyle = rgba(t.wallJoint, 0.75);
      if (L === 3) { ctx.fillRect(x - 5, y - 5, 10, 10); }
      else { circle(ctx, x, y, L === 1 ? 6 : 3.5); ctx.fill(); }
    }
  }
  function drawLitEdge(ctx, t, L, e, col, shape) {
    // 亮邊內側的柔光(無硬邊, 不畫扇區邊界)
    var wg = ctx.createRadialGradient(e.mx, e.my, 10, e.mx, e.my, 140);
    wg.addColorStop(0, rgba(col, 0.22)); wg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = wg; circle(ctx, e.mx, e.my, 140); ctx.fill();
    ctx.shadowColor = col; ctx.shadowBlur = 22;
    if (L === 3) {
      ctx.lineCap = 'butt'; ctx.lineWidth = 16; ctx.strokeStyle = col;
      for (var k = 0; k < 5; k++) {
        var p1 = lerpPt(e, (k + 0.06) / 5), p2 = lerpPt(e, (k + 0.94) / 5);
        line(ctx, p1[0], p1[1], p2[0], p2[1]);
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      line(ctx, e.x1, e.y1, e.x2, e.y2);
    } else {
      ctx.lineCap = L === 1 ? 'round' : 'butt';
      ctx.lineWidth = L === 1 ? 16 : 12; ctx.strokeStyle = col;
      line(ctx, e.x1, e.y1, e.x2, e.y2);
      if (L === 2) { ctx.shadowBlur = 34; line(ctx, e.x1, e.y1, e.x2, e.y2); }
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      line(ctx, e.x1, e.y1, e.x2, e.y2);
    }
    ctx.shadowBlur = 0;
    if (shape === 'square' || shape === 'triangle') {
      circle(ctx, e.mx, e.my, 19); ctx.fillStyle = '#101018'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
      shapePath(ctx, shape, e.mx, e.my, 10); ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }
  function corners(ctx, cx, cy, hw, hh, rot, arm, color, alpha, width) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = width || 3; ctx.lineCap = 'square';
    var sx = [-1, 1, 1, -1], sy = [-1, -1, 1, 1];
    for (var i = 0; i < 4; i++) {
      var x = sx[i] * hw, y = sy[i] * hh;
      ctx.beginPath(); ctx.moveTo(x - sx[i] * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy[i] * arm); ctx.stroke();
    }
    ctx.restore();
  }
  function drawCheck(ctx, x, y, s, color, alpha) {
    ctx.save();
    circle(ctx, x, y, s * 1.05); ctx.fillStyle = 'rgba(0,0,0,' + (0.55 * alpha) + ')'; ctx.fill();
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = Math.max(2, s * 0.28); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.02); ctx.lineTo(x - s * 0.12, y + s * 0.4); ctx.lineTo(x + s * 0.55, y - s * 0.38); ctx.stroke();
    ctx.restore();
  }

  function drawNetWall(ctx, state) {
    state = state || {};
    var L = lv(state.level), t = THEMES[L], lit = state.lit || null, s;
    ctx.save();
    for (s = 1; s <= 8; s++) if (!lit || lit.slot !== s) drawDimEdge(ctx, t, L, edgeOf(s));
    drawJoints(ctx, t, L);
    if (lit && lit.slot >= 1 && lit.slot <= 8) {
      var e = edgeOf(lit.slot);
      var col = condColor(lit.paletteLevel || L, lit.color);
      var hintT = num(lit.hintT, 99);
      // 換位掃光: 從舊邊沿網牆跑到新邊
      if (hintT < TIMING.netHint && lit.fromSlot >= 1 && lit.fromSlot <= 8 && lit.fromSlot !== lit.slot) {
        var a0 = (lit.fromSlot - 1) * OCT, d = e.m - a0;
        while (d > Math.PI) d -= TAU; while (d <= -Math.PI) d += TAU;
        var pr = easeOut(hintT / 0.42), fade = hintT > 0.42 ? 1 - (hintT - 0.42) / (TIMING.netHint - 0.42) : 1;
        for (var k = 0; k < 16; k++) {
          var u = pr - k * 0.03;
          if (u < 0) break;
          var pt = octPoint(a0 + d * u, WALL_APO);
          circle(ctx, pt[0], pt[1], 7 - k * 0.35);
          ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * fade * (1 - k / 16)) + ')'; ctx.fill();
        }
      }
      drawLitEdge(ctx, t, L, e, col, lit.shape);
      if (hintT < TIMING.netHint) {
        var ba = hintT > TIMING.netHint - 0.2 ? (TIMING.netHint - hintT) / 0.2 : 1;
        var pull = 6 * (1 - easeOut(hintT / 0.25));
        corners(ctx, e.mx, e.my, 134 + pull, 26 + pull, e.m + Math.PI / 2, 18, '#ffffff', ba, 3);
      }
    }
    var cf = state.catchFx;
    if (cf && cf.slot >= 1 && cf.slot <= 8) {
      var ce = edgeOf(cf.slot), cp = clamp01(num(cf.t, 0) / TIMING.catchFx);
      var ix = CX + (WALL_APO - 36) * Math.cos(ce.m), iy = CY + (WALL_APO - 36) * Math.sin(ce.m);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - cp) + ')';
      circle(ctx, ix, iy, 16 + 26 * easeOut(cp)); ctx.stroke();
      drawCheck(ctx, ix, iy, 13, '#ffffff', 1 - cp * cp);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 地板
  function paintFloor(ctx, t, L, kind, color, shape, x, y, r) {
    if (kind === 'dye') {
      circle(ctx, x, y, r); ctx.fillStyle = color; ctx.fill();
      ctx.save(); circle(ctx, x, y, r); ctx.clip();
      var dk = darken(color, 0.22);
      if (L === 1) {
        ctx.strokeStyle = dk; ctx.lineWidth = 2;
        circle(ctx, x, y, r * 0.64); ctx.stroke();
        circle(ctx, x, y, r * 0.3); ctx.stroke();
      } else if (L === 2) {
        ctx.fillStyle = dk;
        ctx.fillRect(x - r, y - r, r, r); ctx.fillRect(x, y, r, r);
      } else {
        ctx.strokeStyle = dk; ctx.lineWidth = 4;
        for (var s = -2 * r; s < 2 * r; s += 10) line(ctx, x + s - r, y + r, x + s + r, y - r);
      }
      ctx.restore();
      circle(ctx, x, y, r - 1.5); ctx.lineWidth = 3; ctx.strokeStyle = darken(color, 0.42); ctx.stroke();
    } else {
      circle(ctx, x, y, r); ctx.fillStyle = t.shapeFloorBase; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(t.shapeFloorGlyph, 0.55);
      circle(ctx, x, y, r - 1.5); ctx.stroke();
      if (L === 3) { ctx.lineWidth = 1.5; circle(ctx, x, y, r * 0.78); ctx.stroke(); }
      shapePath(ctx, shape, x, y, r * 0.5); ctx.fillStyle = t.shapeFloorGlyph; ctx.fill();
    }
  }
  function drawFloorCommon(ctx, s, kind) {
    s = s || {};
    var L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), r = num(s.r, FLOOR_R);
    var status = s.status || 'active', p = clamp01(num(s.t, 0));
    var color = kind === 'dye' ? condColor(L, s.color) : null;
    var shape = s.shape === 'triangle' ? 'triangle' : 'square';
    var edge = kind === 'dye' ? color : t.shapeFloorGlyph;
    ctx.save();
    if (status === 'preview' || status === 'standby') {
      // 還沒生效: 虛線外框 + 由中心長大的填色, 填滿那一刻 = 生效
      if (p > 0.01) {
        ctx.save(); circle(ctx, x, y, r * p); ctx.clip();
        paintFloor(ctx, t, L, kind, color, shape, x, y, r);
        ctx.restore();
      }
      circle(ctx, x, y, r);
      ctx.setLineDash([6, 5]); ctx.lineWidth = 2.5; ctx.strokeStyle = edge; ctx.stroke(); ctx.setLineDash([]);
      if (kind === 'shape') { shapePath(ctx, shape, x, y, r * 0.5); ctx.fillStyle = rgba(t.shapeFloorGlyph, 0.45); ctx.fill(); }
    } else {
      paintFloor(ctx, t, L, kind, color, shape, x, y, r);
      if (s.shrink) {
        var sp = clamp01(num(s.shrink.t, 0)), toR = num(s.shrink.toR, 20);
        ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, TAU); ctx.arc(x, y, toR, 0, TAU, true);
        ctx.fillStyle = rgba(t.ground, 0.75 * sp); ctx.fill();
        ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        circle(ctx, x, y, toR); ctx.stroke(); ctx.setLineDash([]);
      }
      if (status === 'intro') {
        var tt = num(s.t, 0) * TIMING.floorIntro; // t 為 0~1 比例
        var a = tt > TIMING.floorIntro - 0.5 ? (TIMING.floorIntro - tt) / 0.5 : 1;
        corners(ctx, x, y, r + 9, r + 9, 0, 8, '#ffffff', clamp01(a), 2.5);
      }
    }
    ctx.restore();
  }
  function drawDyeFloor(ctx, state) { drawFloorCommon(ctx, state, 'dye'); }
  function drawShapeFloor(ctx, state) { drawFloorCommon(ctx, state, 'shape'); }

  // ---------------------------------------------------------------- 氣泡
  function drawBubble(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L], pal = theme(s.paletteLevel || L);
    var x = num(s.x, CX), y = num(s.y, CY), st = s.status || 'idle';
    var color = s.color ? (pal.colors[s.color] || null) : null;
    var shape = (s.shape === 'square' || s.shape === 'triangle') ? s.shape : 'circle';
    var spawn = s.spawnT == null ? 1 : clamp01(s.spawnT);
    var lifted = (st === 'dragging' || st === 'carried');
    var sc = lifted ? 1.12 : (st === 'held' ? 1.06 : (s.hover && st === 'idle' ? 1.05 : 1));
    if (spawn < 1) sc *= Math.max(0, easeOutBack(spawn));
    var r = BUBBLE_R * sc;
    ctx.save();
    if (st === 'returning') ctx.globalAlpha = 0.45;
    if (spawn < 1) {
      var rr = 18 + 22 * spawn;
      ctx.beginPath(); ctx.ellipse(x, y + 12, rr, rr * 0.36, 0, 0, TAU);
      ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.glass, 0.7 * (1 - spawn)); ctx.stroke();
    }
    if (r < 0.5) { ctx.restore(); return; }
    // 落影(常駐; 拿起時影子拉遠變淡 = 浮起)
    ctx.beginPath();
    if (lifted) ctx.ellipse(x + 9, y + 24, r * 1.05, r * 0.42, 0, 0, TAU);
    else ctx.ellipse(x + 3, y + 14, r * 0.95, r * 0.4, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,' + (lifted ? 0.26 : 0.42) + ')'; ctx.fill();
    // 本體
    if (color) {
      var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.08, x, y, r * 1.2);
      g.addColorStop(0, lighten(color, 0.6)); g.addColorStop(0.45, color); g.addColorStop(1, darken(color, 0.38));
      shapePath(ctx, shape, x, y, r); ctx.fillStyle = g;
      if (t.style === 'neon') { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = 2; ctx.strokeStyle = t.style === 'neon' ? lighten(color, 0.5) : lighten(color, 0.35);
      ctx.stroke();
    } else {
      shapePath(ctx, shape, x, y, r); ctx.fillStyle = rgba(t.glass, 0.1); ctx.fill();
      var gg = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      gg.addColorStop(0, rgba(t.glass, 0)); gg.addColorStop(1, rgba(t.glass, 0.32));
      ctx.fillStyle = gg; ctx.fill();
      ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(t.glass, 0.92); ctx.stroke();
    }
    // 高光 + 反光弧(剪在形狀內)
    ctx.save();
    shapePath(ctx, shape, x, y, r); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    if (t.style === 'hard') {
      ctx.beginPath();
      ctx.moveTo(x - r * 0.62, y - r * 0.1); ctx.lineTo(x - r * 0.25, y - r * 0.62);
      ctx.lineTo(x + r * 0.05, y - r * 0.66); ctx.lineTo(x - r * 0.4, y - r * 0.05); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(x - r * 0.32, y - r * 0.4, r * (t.style === 'neon' ? 0.26 : 0.34), r * 0.19, -0.6, 0, TAU); ctx.fill();
    }
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0.25, 1.35); ctx.stroke();
    ctx.restore();
    if (s.hover && st === 'idle') {
      shapePath(ctx, shape, x, y, r + 3); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.stroke();
    }
    // 壽命環
    var life = clamp01(num(s.life, 1)), frozen = (st === 'held' || lifted);
    var ringR = r + 6.5;
    ctx.lineCap = 'butt';
    circle(ctx, x, y, ringR); ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    if (life > 0.001) {
      ctx.beginPath(); ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * life);
      ctx.lineWidth = frozen ? 4.5 : 3.5;
      ctx.strokeStyle = frozen ? '#ffffff' : (life < 0.25 ? t.danger : t.lifeRing);
      if (frozen) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 7; }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 沾地板回饋(沾上 / 已鎖定)
  function drawPadlock(ctx, x, y, s, color) {
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.fillRect(x - s * 0.55, y - s * 0.1, s * 1.1, s * 0.8);
    ctx.lineWidth = s * 0.22; ctx.beginPath(); ctx.arc(x, y - s * 0.1, s * 0.36, Math.PI, 0); ctx.stroke();
  }
  function drawStickFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L], pal = theme(s.paletteLevel || L);
    var x = num(s.x, CX), y = num(s.y, CY), tt = num(s.t, 0), p = clamp01(tt / TIMING.stickFx);
    var kind = s.kind === 'locked' ? 'locked' : 'stick', attr = s.attr === 'shape' ? 'shape' : 'color';
    var stack = num(s.stack, 0);
    var fade = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
    var col = (kind === 'stick' && attr === 'color') ? condColor(s.paletteLevel || L, s.value) : '#ffffff';
    ctx.save();
    ctx.globalAlpha = clamp01(fade);
    if (kind === 'stick') {
      // 氣泡外一圈粗光環(沾上的顏色; 賦形時白色), 中心挖空不蓋氣泡
      var hp = easeOut(Math.min(1, p * 2.2));
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.lineWidth = 7 * (1 - hp) + 2.5; ctx.strokeStyle = col;
      circle(ctx, x, y, 30 + 10 * hp); ctx.stroke();
      ctx.shadowBlur = 0;
      if (p < 0.18) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - p / 0.18) + ')'; circle(ctx, x, y, 29); ctx.stroke(); }
    } else {
      // 已鎖定: 灰色虛線環往內收(方向、線型、顏色都與沾上相反)
      ctx.setLineDash([5, 4]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(200,205,215,0.95)';
      circle(ctx, x, y, 44 - 14 * easeOut(p)); ctx.stroke(); ctx.setLineDash([]);
    }
    // 標籤: 浮在氣泡正上方, 寫「這顆剛沾上什麼」; 往上空間不夠時放到下方
    var pop = p < 0.16 ? Math.max(0.01, easeOutBack(p / 0.16)) : 1;
    var below = (y - 56 - stack * 34) < 18;
    var ty = below ? y + 58 + stack * 34 : y - 56 - stack * 34;
    var tw = 42, th = 30;
    ctx.save();
    ctx.translate(x, ty); ctx.scale(pop, pop);
    ctx.beginPath();
    roundRectPath(ctx, -tw / 2, -th / 2, tw, th, 8);
    var tipY = below ? -th / 2 - 9 : th / 2 + 9, baseY = below ? -th / 2 + 1 : th / 2 - 1;
    ctx.moveTo(-7, baseY); ctx.lineTo(0, tipY); ctx.lineTo(7, baseY); ctx.closePath();
    var fill = kind === 'locked' ? '#5b606b' : (attr === 'color' ? col : '#15151c');
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = kind === 'locked' ? '#c9ced8' : '#ffffff'; ctx.stroke();
    if (kind === 'locked') drawPadlock(ctx, 0, 0, 14, '#ffffff');
    else if (attr === 'shape') { shapePath(ctx, s.value === 'triangle' ? 'triangle' : 'square', 0, 1, 9); ctx.fillStyle = '#ffffff'; ctx.fill(); }
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 踩拍回饋(3 級)
  // 造型: 氣泡左右兩側的音波弧, 弧的組數 = 級數; 下方 3 個拍點, 亮幾個 = 第幾級
  function drawBeatFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), tier = Math.max(1, Math.min(3, Math.round(num(s.tier, 1))));
    var p = clamp01(num(s.t, 0) / TIMING.beatFx), a = 1 - p * p;
    var onBubble = s.onBubble !== false, col = t.beat;
    var inner = onBubble ? 47 : 20;
    ctx.save();
    ctx.lineCap = 'round';
    if (!onBubble) {
      circle(ctx, x, y, 14 + 16 * easeOut(p)); ctx.fillStyle = rgba(col, 0.55 * (1 - p)); ctx.fill();
    }
    ctx.shadowColor = col; ctx.shadowBlur = 6 + 8 * tier;
    var half = 0.42 + 0.14 * tier;
    for (var i = 0; i < tier; i++) {
      var rr = inner + 11 * i + (6 + 4 * tier) * easeOut(p);
      ctx.lineWidth = 3.5 + tier * 0.9 - i * 0.6;
      ctx.strokeStyle = rgba(i === 0 && tier === 3 ? '#ffffff' : col, a * (1 - i * 0.12));
      for (var side = 0; side < 2; side++) {
        var c = side * Math.PI;
        ctx.beginPath(); ctx.arc(x, y, rr, c - half, c + half); ctx.stroke();
      }
    }
    if (tier === 3) {
      ctx.lineWidth = 2; ctx.strokeStyle = rgba(col, 0.5 * a);
      circle(ctx, x, y, inner + 26 + 18 * easeOut(p)); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    var py = y + (onBubble ? 46 : 34);
    for (var k = 0; k < 3; k++) {
      circle(ctx, x + (k - 1) * 13, py, 4.2);
      if (k < tier) { ctx.fillStyle = rgba(col, a); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,' + (0.6 * a) + ')'; ctx.stroke(); }
      else { ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(col, 0.45 * a); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 整串回饋
  var EQ = [1, 0.45, 0.8, 0.35, 0.95, 0.5, 0.7, 0.3, 1, 0.55, 0.85, 0.4, 0.9, 0.35, 0.75, 0.5, 1, 0.45, 0.8, 0.35];
  function drawChainFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), p = clamp01(num(s.t, 0) / TIMING.chainFx), e = easeOut(p);
    var col = t.beat;
    ctx.save();
    var R = 30 + 90 * e;
    var g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.85 * (1 - p)) + ')');
    g.addColorStop(0.4, rgba(col, 0.6 * (1 - p)));
    g.addColorStop(1, rgba(col, 0));
    circle(ctx, x, y, R); ctx.fillStyle = g; ctx.fill();
    // 音浪圈: 20 根放射長條, 長短交錯
    ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 16;
    var r0 = 44 + 56 * e;
    for (var i = 0; i < EQ.length; i++) {
      var a = i * TAU / EQ.length, len = 8 + 30 * EQ[i] * (1 - 0.5 * p);
      ctx.lineWidth = 6;
      ctx.strokeStyle = i % 2 ? rgba(col, 1 - p) : 'rgba(255,255,255,' + (1 - p) + ')';
      line(ctx, x + r0 * Math.cos(a), y + r0 * Math.sin(a), x + (r0 + len) * Math.cos(a), y + (r0 + len) * Math.sin(a));
    }
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3 * (1 - p) + 0.5; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - p) + ')';
    circle(ctx, x, y, 96 + 60 * e); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 清場回饋
  function drawClearFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var p = clamp01(num(s.t, 0) / TIMING.clearFx);
    var a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
    ctx.save();
    var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, ARENA_R);
    g.addColorStop(0, rgba(t.ink, 0.42 * a)); g.addColorStop(1, rgba(t.rim, 0.55 * a));
    circle(ctx, CX, CY, ARENA_R); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = t.rim; ctx.shadowBlur = 24 * a;
    ctx.lineWidth = 8; ctx.strokeStyle = rgba(t.rim, 0.9 * a); circle(ctx, CX, CY, ARENA_R); ctx.stroke();
    ctx.shadowBlur = 0;
    var sc = 0.8 + 0.2 * easeOutBack(Math.min(1, p / 0.2));
    ctx.translate(CX, CY); ctx.scale(sc, sc);
    ctx.globalAlpha = clamp01(a);
    text(ctx, '清空', 0, 0, 64, t.ink, 'center', { stroke: 'rgba(0,0,0,0.75)', strokeWidth: 8 });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 預備拍 / 換關提示
  function drawCountIn(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var n = Math.max(1, Math.min(4, Math.round(num(s.beatsLeft, 4)))), p = clamp01(num(s.phase, 0));
    ctx.save();
    var sc = 1.25 - 0.25 * easeOut(p * 3);
    ctx.translate(CX, CY + 20); ctx.scale(sc, sc);
    ctx.globalAlpha = 0.9 - 0.35 * p;
    ctx.shadowColor = t.beat; ctx.shadowBlur = 18;
    text(ctx, String(n), 0, 0, 110, t.ink, 'center', { stroke: rgba(t.beat, 0.9), strokeWidth: 6 });
    ctx.restore();
    ctx.save();
    for (var i = 0; i < 4; i++) {
      circle(ctx, CX - 39 + i * 26, CY + 100, 6);
      if (i < n) { ctx.fillStyle = t.beat; ctx.fill(); }
      else { ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.beat, 0.5); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawLevelIntro(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var tt = num(s.t, 0), dur = num(s.dur, 2.4);
    var a = tt < 0.25 ? tt / 0.25 : (tt > dur - 0.4 ? Math.max(0, (dur - tt) / 0.4) : 1);
    ctx.save();
    ctx.globalAlpha = clamp01(a);
    roundRect(ctx, CX - 110, CY - 128, 220, 52, 26); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.beat, 0.9); ctx.stroke();
    text(ctx, '第 ' + L + ' 首', CX, CY - 102, 30, t.ink);
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  // 命條: 本體中明度, 最亮的白與拍子色留給「剛變化的那一段」
  function drawHpBar(ctx, t, x, y, w, h, hp, danger, fx, time) {
    var v = Math.max(0, Math.min(100, num(hp, 0)));
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    if (v > 0) {
      ctx.save(); roundRect(ctx, x, y, w, h, h / 2); ctx.clip();
      ctx.fillStyle = danger ? t.danger : t.barBody;
      ctx.fillRect(x, y, w * v / 100, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, w * v / 100, h * 0.35);
      ctx.restore();
    }
    var list = fx || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i], fp = clamp01(num(f.t, 0) / TIMING.hpFx), fa = 1 - fp * fp;
      var from = Math.max(0, Math.min(100, num(f.from, 0))), to = Math.max(0, Math.min(100, num(f.to, 0)));
      var x0 = x + w * Math.min(from, to) / 100, x1 = x + w * Math.max(from, to) / 100;
      if (x1 - x0 < 8) { var gain = to >= from, edge = x + w * to / 100; x0 = gain ? edge - 8 : edge; x1 = x0 + 8; }
      var kind = f.kind || 'catch';
      var col = kind === 'beat' || kind === 'chain' ? t.beat : (kind === 'expire' ? t.danger : '#ffffff');
      ctx.save();
      if (kind === 'chain') { ctx.shadowColor = t.beat; ctx.shadowBlur = 14; }
      var grow = kind === 'chain' ? 4 : (kind === 'expire' ? 2 : 0);
      ctx.fillStyle = rgba(col, 0.95 * fa);
      ctx.fillRect(x0, y - grow, x1 - x0, h + grow * 2);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,' + (0.6 * fa) + ')';
      ctx.strokeRect(x0, y - grow, x1 - x0, h + grow * 2);
      ctx.restore();
    }
    roundRect(ctx, x, y, w, h, h / 2);
    if (danger) {
      ctx.lineWidth = 2.5 + 1.5 * Math.sin(num(time, 0) * 8);
      ctx.strokeStyle = t.danger;
    } else { ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(t.ink, 0.3); }
    ctx.stroke();
  }
  function drawNote(ctx, x, y, color) {
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 4, 4, 3, -0.4, 0, TAU); ctx.fill();
    line(ctx, x + 3.5, y + 3, x + 3.5, y - 7);
    line(ctx, x + 3.5, y - 7, x + 8, y - 4);
  }
  function drawHpBlock(ctx, t, x, y, hp, danger, fx, time, w) {
    w = w || 188;
    text(ctx, '命', x, y + 12, 18, danger ? t.danger : t.ink, 'left');
    drawHpBar(ctx, t, x + 28, y, w, 24, hp, danger, fx, time);
  }
  function drawHud(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    ctx.save();
    var hl = LAYOUT.hudLeft, hr = LAYOUT.hudRight;
    roundRect(ctx, hl.x, hl.y, hl.w, hl.h, 12); ctx.fillStyle = t.hudPlate; ctx.fill();
    drawHpBlock(ctx, t, hl.x + 12, hl.y + 12, s.hp, !!s.danger, s.hpFx, s.time, 188);
    text(ctx, '存活', hl.x + 12, hl.y + 61, 13, t.inkDim, 'left');
    text(ctx, num(s.survival, 0).toFixed(1) + ' 秒', hl.x + 48, hl.y + 61, 18, t.ink, 'left');
    if (s.songProgress != null) {
      var sp = clamp01(num(s.songProgress, 0));
      drawNote(ctx, hl.x + 150, hl.y + 61, t.inkDim);
      roundRect(ctx, hl.x + 164, hl.y + 57, 64, 8, 4); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
      if (sp > 0) { roundRect(ctx, hl.x + 164, hl.y + 57, Math.max(8, 64 * sp), 8, 4); ctx.fillStyle = t.rim; ctx.fill(); }
    }
    roundRect(ctx, hr.x, hr.y, hr.w, hr.h, 12); ctx.fillStyle = t.hudPlate; ctx.fill();
    text(ctx, '分數', hr.x + 14, hr.y + 24, 13, t.inkDim, 'left');
    text(ctx, String(Math.round(num(s.score, 0))), hr.x + hr.w - 14, hr.y + 28, 30, t.ink, 'right');
    var combo = Math.round(num(s.combo, 0));
    if (combo > 0) {
      text(ctx, '連續', hr.x + 14, hr.y + 62, 13, t.inkDim, 'left');
      text(ctx, '×' + combo, hr.x + hr.w - 14, hr.y + 62, 22, t.ink, 'right');
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 按鈕
  function drawButton(ctx, t, r, label, hover, opts) {
    opts = opts || {};
    roundRect(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fillStyle = opts.primary ? (hover ? lighten(t.rim, 0.2) : t.rim) : (hover ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)');
    ctx.fill();
    ctx.lineWidth = hover ? 3 : 2; ctx.strokeStyle = hover ? '#ffffff' : rgba(t.ink, 0.45); ctx.stroke();
    text(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, opts.px || 22, opts.primary ? '#14141c' : t.ink);
  }
  function drawPauseButton(ctx, state) {
    var s = state || {}, t = theme(s.level), r = LAYOUT.pauseBtn;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fillStyle = s.hover ? 'rgba(255,255,255,0.22)' : t.hudPlate; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = s.hover ? '#ffffff' : rgba(t.ink, 0.45); ctx.stroke();
    ctx.fillStyle = t.ink;
    ctx.fillRect(r.x + 18, r.y + 9, 4, 13); ctx.fillRect(r.x + 26, r.y + 9, 4, 13);
    text(ctx, '暫停', r.x + r.w / 2, r.y + 36, 13, t.ink);
    ctx.restore();
  }
  function drawMuteButton(ctx, state) {
    var s = state || {}, t = theme(s.level), r = LAYOUT.muteBtn, muted = !!s.muted;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = muted ? rgba(t.danger, 0.4) : (s.hover ? 'rgba(255,255,255,0.22)' : t.hudPlate); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = s.hover ? '#ffffff' : (muted ? t.danger : rgba(t.ink, 0.45)); ctx.stroke();
    var ix = r.x + 17, iy = r.y + 15;
    ctx.fillStyle = t.ink;
    ctx.beginPath(); ctx.moveTo(ix - 4, iy - 3); ctx.lineTo(ix, iy - 3); ctx.lineTo(ix + 5, iy - 8); ctx.lineTo(ix + 5, iy + 8); ctx.lineTo(ix, iy + 3); ctx.lineTo(ix - 4, iy + 3); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    if (muted) {
      ctx.strokeStyle = '#ffffff';
      line(ctx, ix + 9, iy - 5, ix + 17, iy + 5); line(ctx, ix + 17, iy - 5, ix + 9, iy + 5);
    } else {
      ctx.strokeStyle = t.ink;
      ctx.beginPath(); ctx.arc(ix + 6, iy, 5, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(ix + 6, iy, 9, -0.9, 0.9); ctx.stroke();
    }
    text(ctx, '靜音', r.x + r.w / 2, r.y + 36, 13, t.ink);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 選單類畫面
  function overlay(ctx, a) { ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(0, 0, W, H); }
  function panelBox(ctx, t, r) {
    roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.fillStyle = 'rgba(20,16,34,0.94)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.rim, 0.6); ctx.stroke();
  }
  function drawPauseMenu(ctx, state) {
    var s = state || {}, t = theme(s.level), m = LAYOUT.pauseMenu;
    ctx.save();
    overlay(ctx, 0.55);
    panelBox(ctx, t, m.panel);
    text(ctx, '暫停中', CX, m.panel.y + 38, 26, t.ink);
    drawButton(ctx, t, m.resume, '繼續', s.hover === 'resume', { primary: true });
    drawButton(ctx, t, m.restart, '重開', s.hover === 'restart');
    drawButton(ctx, t, m.quit, '放棄', s.hover === 'quit');
    drawButton(ctx, t, m.guide, '說明', s.hover === 'guide');
    ctx.restore();
  }
  function drawTitle(ctx, state) {
    var s = state || {}, t = THEMES[1], b = LAYOUT.title;
    ctx.save();
    drawBackground(ctx, { level: 1 });
    // 標題裝飾: 幾顆遊戲內畫法的氣泡
    var deco = [[420, 230, 'A', 'circle'], [860, 210, 'C', 'circle'], [330, 470, null, 'circle'], [950, 480, 'B', 'circle']];
    for (var i = 0; i < deco.length; i++) drawBubble(ctx, { level: 1, x: deco[i][0], y: deco[i][1], color: deco[i][2], shape: deco[i][3], life: 1 });
    text(ctx, '捕泡手', CX, 230, 76, t.ink, 'center', { stroke: 'rgba(0,0,0,0.5)', strokeWidth: 8 });
    text(ctx, '沾色、送進亮著的網、對上拍子', CX, 304, 20, t.inkDim);
    drawButton(ctx, t, b.start, '開始', s.hover === 'start', { primary: true, px: 26 });
    drawButton(ctx, t, b.guide, '說明', s.hover === 'guide');
    drawButton(ctx, t, b.device, '輸入裝置', s.hover === 'device');
    ctx.restore();
  }
  function drawDeviceSelect(ctx, state) {
    var s = state || {}, t = THEMES[1], d = LAYOUT.device;
    ctx.save();
    overlay(ctx, 0.6);
    panelBox(ctx, t, { x: 400, y: 250, w: 480, h: 230 });
    text(ctx, '你用哪種裝置操作?', CX, 305, 26, t.ink);
    drawButton(ctx, t, d.mouse, '滑鼠', s.hover === 'mouse', { primary: s.selected === 'mouse', px: 24 });
    drawButton(ctx, t, d.touchpad, '觸控板', s.hover === 'touchpad', { primary: s.selected === 'touchpad', px: 24 });
    ctx.restore();
  }
  function endCard(ctx, t, x, y, w, survival, score, showScore) {
    roundRect(ctx, x, y, w, showScore ? 300 : 200, 18); ctx.fillStyle = 'rgba(20,16,34,0.94)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.rim, 0.6); ctx.stroke();
    text(ctx, '結束', x + w / 2, y + 50, 40, t.ink);
    text(ctx, '存活 ' + num(survival, 0).toFixed(1) + ' 秒', x + w / 2, y + 120, 32, t.ink);
    if (showScore) text(ctx, '分數 ' + Math.round(num(score, 0)), x + w / 2, y + 172, 24, t.inkDim);
  }
  function drawGameOver(ctx, state) {
    var s = state || {}, t = THEMES[1], g = LAYOUT.gameOver;
    ctx.save();
    overlay(ctx, 0.62);
    panelBox(ctx, t, g.panel);
    text(ctx, '結束', CX, g.panel.y + 60, 44, t.ink);
    text(ctx, '存活 ' + num(s.survival, 0).toFixed(1) + ' 秒', CX, g.panel.y + 150, 36, t.ink);
    text(ctx, '分數 ' + Math.round(num(s.score, 0)), CX, g.panel.y + 210, 26, t.inkDim);
    drawButton(ctx, t, g.again, '再玩一次', s.hover === 'again', { primary: true });
    drawButton(ctx, t, g.title, '回標題', s.hover === 'title');
    ctx.restore();
  }

  // ---------------------------------------------------------------- 說明頁(第 1 關風格)
  function inGame(ctx, ox, oy, sc, fn) {
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.translate(-CX, -CY); fn(); ctx.restore();
  }
  function gPanel(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 16); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.stroke();
  }
  function drawCursor(ctx, x, y, s) {
    s = s || 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(6, 16); ctx.lineTo(10, 25); ctx.lineTo(14, 23); ctx.lineTo(10, 15); ctx.lineTo(17, 15); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = '#111111'; ctx.stroke();
    ctx.restore();
  }
  // 箭頭沿點列畫平滑曲線, 尾端箭頭
  function drawArrow(ctx, pts, opts) {
    opts = opts || {};
    var col = opts.color || '#ffffff', w = opts.width || 4;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col; ctx.lineWidth = w;
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) ctx.lineTo(pts[1][0], pts[1][1]);
    else {
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        if (i === pts.length - 2) { mx = pts[i + 1][0]; my = pts[i + 1][1]; }
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
    var a = pts[pts.length - 2], b = pts[pts.length - 1];
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hs = w * 3.2;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(b[0] + Math.cos(ang) * hs * 0.4, b[1] + Math.sin(ang) * hs * 0.4);
    ctx.lineTo(b[0] + Math.cos(ang + 2.5) * hs, b[1] + Math.sin(ang + 2.5) * hs);
    ctx.lineTo(b[0] + Math.cos(ang - 2.5) * hs, b[1] + Math.sin(ang - 2.5) * hs);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  var GUIDE = [
    { title: '沾色', text: '擦過染色區就沾色, 沾過就不再變' },
    { title: '送進亮著的網', text: '只有亮著的網收, 顏色要對' },
    { title: '網會換地方', text: '收下後網換到別處' },
    { title: '抓著時環不走', text: '抓著時, 氣泡上的環停住不走' },
    { title: '命的增減', text: '命會一直掉, 收下就回' },
    { title: '對上拍子', text: '沾色、送進網對上拍子就回命' },
    { title: '結束', text: '命用完就結束, 撐越久越好' }
  ];
  function guidePage1(ctx) {
    gPanel(ctx, 340, 140, 600, 490);
    inGame(ctx, 640, 385, 1, function () {
      drawArena(ctx, { level: 1 });
      drawDyeFloor(ctx, { level: 1, x: 552, y: 400, color: 'A' });
      drawDyeFloor(ctx, { level: 1, x: 730, y: 400, color: 'B' });
      drawArrow(ctx, [[478, 345], [520, 400], [552, 400], [600, 378], [650, 362], [700, 390], [730, 400], [770, 400], [784, 386]], { width: 4, color: 'rgba(255,255,255,0.85)' });
      drawBubble(ctx, { level: 1, x: 470, y: 330, color: null, status: 'dragging', life: 1 });
      drawBubble(ctx, { level: 1, x: 640, y: 340, color: 'A', status: 'dragging', life: 1 });
      drawBubble(ctx, { level: 1, x: 800, y: 362, color: 'A', status: 'dragging', life: 1 });
      drawCursor(ctx, 804, 366, 1.1);
    });
  }
  function wallScene(ctx, ox, oy, sc, litSlot, litColor, fn) {
    inGame(ctx, ox, oy, sc, function () {
      drawArena(ctx, { level: 1 });
      drawNetWall(ctx, { level: 1, lit: litSlot ? { slot: litSlot, color: litColor } : null });
      if (fn) fn();
    });
  }
  function guidePage2(ctx) {
    var cx = [218, 640, 1062];
    for (var i = 0; i < 3; i++) gPanel(ctx, cx[i] - 205, 160, 410, 450);
    // 第 1 格: 色 A 往亮邊方向放開(放開點在內圈與亮邊之間) → 打勾
    wallScene(ctx, cx[0], 385, 0.6, 1, 'A', function () {
      drawArrow(ctx, [[790, 372], [840, 364]], { width: 6 });
      drawBubble(ctx, { level: 1, x: 880, y: 360, color: 'A', status: 'dragging', life: 1 });
      drawCursor(ctx, 884, 364, 1.6);
      drawCheck(ctx, 880, 296, 22, '#ffffff', 1);
    });
    // 第 2 格: 透明氣泡放在同一處 → 回到內圈
    wallScene(ctx, cx[1], 385, 0.6, 1, 'A', function () {
      ctx.save(); ctx.setLineDash([6, 6]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      circle(ctx, 880, 360, 22); ctx.stroke(); ctx.restore();
      drawArrow(ctx, [[790, 372], [840, 364]], { width: 6 });
      drawArrow(ctx, [[880, 330], [860, 290], [800, 300], [786, 334]], { width: 5, dash: [10, 8] });
      drawBubble(ctx, { level: 1, x: 790, y: 362, color: null, status: 'idle', life: 1 });
    });
    // 第 3 格: 色 A 往不亮的邊放開 → 回到內圈
    wallScene(ctx, cx[2], 385, 0.6, 1, 'A', function () {
      ctx.save(); ctx.setLineDash([6, 6]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      circle(ctx, 400, 360, 22); ctx.stroke(); ctx.restore();
      drawArrow(ctx, [[490, 372], [440, 364]], { width: 6 });
      drawArrow(ctx, [[400, 330], [420, 290], [480, 300], [494, 334]], { width: 5, dash: [10, 8] });
      drawBubble(ctx, { level: 1, x: 490, y: 362, color: 'A', status: 'idle', life: 1 });
    });
  }
  function guidePage3(ctx) {
    var t = THEMES[1];
    gPanel(ctx, 70, 170, 420, 430);
    wallScene(ctx, 280, 385, 0.6, 1, 'A', function () {
      drawBubble(ctx, { level: 1, x: 860, y: 360, color: 'A', status: 'dragging', life: 1 });
      drawCursor(ctx, 864, 364, 1.6);
    });
    drawArrow(ctx, [[510, 385], [580, 385]], { width: 6 });
    gPanel(ctx, 600, 190, 300, 390);
    gPanel(ctx, 955, 190, 300, 390);
    wallScene(ctx, 750, 385, 0.44, 4, 'A');
    wallScene(ctx, 1105, 385, 0.44, 7, 'B');
    text(ctx, '或', 927, 385, 24, t.ink);
  }
  function guidePage4(ctx) {
    var t = THEMES[1], cx = [235, 640, 1045], other = [1, 0.72, 0.44];
    for (var i = 0; i < 3; i++) {
      gPanel(ctx, cx[i] - 175, 210, 350, 320);
      roundRect(ctx, cx[i] - 155, 230, 310, 280, 20); ctx.fillStyle = t.ground; ctx.fill();
      (function (k) {
        ctx.save(); ctx.translate(cx[k], 370); ctx.scale(2.3, 2.3);
        drawBubble(ctx, { level: 1, x: -30, y: 0, color: null, status: 'held', life: 1 });
        drawBubble(ctx, { level: 1, x: 30, y: 0, color: null, status: 'idle', life: other[k] });
        drawCursor(ctx, -28, 2, 0.55);
        ctx.restore();
      })(i);
      if (i < 2) drawArrow(ctx, [[cx[i] + 182, 370], [cx[i] + 222, 370]], { width: 5 });
    }
  }
  function guidePage5(ctx) {
    var t = THEMES[1], cx = [230, 640, 1050];
    for (var i = 0; i < 3; i++) gPanel(ctx, cx[i] - 195, 150, 390, 470);
    // 左: 什麼都沒做, 命自己往下掉(同一條命前後兩刻)
    drawHpBlock(ctx, t, cx[0] - 175, 170, 66, false, null, 0, 150);
    drawArrow(ctx, [[cx[0] - 70, 206], [cx[0] - 70, 232]], { width: 4 });
    drawHpBlock(ctx, t, cx[0] - 175, 244, 56, false, null, 0, 150);
    inGame(ctx, cx[0], 450, 0.62, function () {
      drawArena(ctx, { level: 1 });
      drawBubble(ctx, { level: 1, x: 590, y: 330, color: null, life: 0.8 });
      drawBubble(ctx, { level: 1, x: 690, y: 400, color: 'B', life: 0.6 });
    });
    // 中: 送進亮著、要色 A 的網 → 命變長一段
    drawHpBlock(ctx, t, cx[1] - 175, 170, 64, false, [{ from: 56, to: 64, kind: 'catch', t: 0.05 }], 0, 150);
    inGame(ctx, cx[1], 420, 0.5, function () {
      drawArena(ctx, { level: 1 });
      drawNetWall(ctx, { level: 1, lit: { slot: 1, color: 'A' } });
      drawArrow(ctx, [[790, 372], [840, 364]], { width: 7 });
      drawBubble(ctx, { level: 1, x: 880, y: 360, color: 'A', status: 'dragging', life: 1 });
      drawCursor(ctx, 884, 364, 1.8);
      drawCheck(ctx, 880, 290, 26, '#ffffff', 1);
    });
    // 右: 壽命環走完、氣泡消失 → 命少一段
    drawHpBlock(ctx, t, cx[2] - 175, 170, 50, false, [{ from: 58, to: 50, kind: 'expire', t: 0.05 }], 0, 150);
    inGame(ctx, cx[2], 440, 0.62, function () {
      drawArena(ctx, { level: 1 });
      drawBubble(ctx, { level: 1, x: 560, y: 360, color: 'C', life: 0.02 });
      drawArrow(ctx, [[604, 360], [664, 360]], { width: 6 });
      ctx.save(); ctx.setLineDash([5, 6]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      circle(ctx, 720, 360, 22); ctx.stroke(); ctx.restore();
    });
  }
  function guidePage6(ctx) {
    var t = THEMES[1];
    var rows = [{ y: 150, phase: 0, beat: true }, { y: 400, phase: 0.5, beat: false }];
    for (var i = 0; i < 2; i++) {
      var R = rows[i];
      gPanel(ctx, 140, R.y, 1000, 228);
      drawHpBlock(ctx, t, 160, R.y + 18, R.beat ? 52 : 50, false, R.beat ? [{ from: 50, to: 52, kind: 'beat', t: 0.05 }] : null, 0, 150);
      // 放大看內圈右半: 染色區、氣泡與內圈邊線上的拍子提示
      ctx.save();
      roundRect(ctx, 372, R.y + 4, 764, 220, 14); ctx.clip();
      inGame(ctx, 560, R.y + 114, 1, function () {
        drawArena(ctx, { level: 1 });
        drawBeatCue(ctx, { level: 1, phase: R.phase, beat: 0 });
        drawDyeFloor(ctx, { level: 1, x: 700, y: 360, color: 'A' });
        drawArrow(ctx, [[560, 380], [650, 370], [700, 360], [742, 352]], { width: 4, color: 'rgba(255,255,255,0.8)' });
        drawBubble(ctx, { level: 1, x: 770, y: 350, color: 'A', status: 'dragging', life: 1 });
        drawStickFx(ctx, { level: 1, x: 770, y: 350, kind: 'stick', attr: 'color', value: 'A', t: 0.22 });
        if (R.beat) drawBeatFx(ctx, { level: 1, x: 770, y: 350, tier: 1, t: 0.1, onBubble: true });
        drawCursor(ctx, 774, 354, 1.1);
      });
      ctx.restore();
    }
  }
  function guidePage7(ctx) {
    var t = THEMES[1];
    gPanel(ctx, 150, 170, 420, 430);
    var vals = [30, 12, 0];
    for (var i = 0; i < 3; i++) {
      drawHpBlock(ctx, t, 220, 210 + i * 130, vals[i], true, null, 0, 260);
      if (i < 2) drawArrow(ctx, [[370, 250 + i * 130], [370, 316 + i * 130]], { width: 4 });
    }
    drawArrow(ctx, [[600, 385], [680, 385]], { width: 6 });
    endCard(ctx, t, 720, 285, 400, 87.3, 0, false);
  }
  function drawGuidePage(ctx, state) {
    var s = state || {}, t = THEMES[1], g = LAYOUT.guide;
    var page = Math.max(1, Math.min(7, Math.round(num(s.page, 1))));
    var info = GUIDE[page - 1];
    ctx.save();
    drawBackground(ctx, { level: 1 });
    overlay(ctx, 0.25);
    text(ctx, info.title, 40, 46, 20, t.inkDim, 'left');
    text(ctx, page + ' / 7', 40, 80, 16, t.inkDim, 'left');
    text(ctx, info.text, CX, 92, 34, t.ink, 'center', { stroke: 'rgba(0,0,0,0.5)', strokeWidth: 6 });
    [guidePage1, guidePage2, guidePage3, guidePage4, guidePage5, guidePage6, guidePage7][page - 1](ctx);
    drawButton(ctx, t, g.close, '關閉', s.hover === 'close');
    if (page > 1) drawButton(ctx, t, g.prev, '上一頁', s.hover === 'prev');
    if (page < 7) drawButton(ctx, t, g.next, '下一頁', s.hover === 'next', { primary: true });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 匯出
  var palette = {};
  [1, 2, 3].forEach(function (L) {
    var t = THEMES[L];
    palette[L] = {
      bgTop: t.bgTop, bgBottom: t.bgBottom, ground: t.ground, rim: t.rim,
      wallDim: t.wallDim, colorA: t.colors.A, colorB: t.colors.B, colorC: t.colors.C, colorD: t.colors.D,
      beat: t.beat, danger: t.danger, glass: t.glass, lifeRing: t.lifeRing, frozen: '#ffffff',
      ink: t.ink, inkDim: t.inkDim, barBody: t.barBody, shapeFloorBase: t.shapeFloorBase, shapeFloorGlyph: t.shapeFloorGlyph,
      capture: '#ffffff'
    };
  });

  window.Art = {
    canvas: { width: W, height: H },
    palette: palette,
    timing: TIMING,
    layout: LAYOUT,
    drawBackground: drawBackground,
    drawArena: drawArena,
    drawBeatCue: drawBeatCue,
    drawNetWall: drawNetWall,
    drawDyeFloor: drawDyeFloor,
    drawShapeFloor: drawShapeFloor,
    drawBubble: drawBubble,
    drawStickFx: drawStickFx,
    drawBeatFx: drawBeatFx,
    drawChainFx: drawChainFx,
    drawClearFx: drawClearFx,
    drawCountIn: drawCountIn,
    drawLevelIntro: drawLevelIntro,
    drawHud: drawHud,
    drawPauseButton: drawPauseButton,
    drawMuteButton: drawMuteButton,
    drawPauseMenu: drawPauseMenu,
    drawTitle: drawTitle,
    drawDeviceSelect: drawDeviceSelect,
    drawGameOver: drawGameOver,
    drawGuidePage: drawGuidePage
  };
})();
