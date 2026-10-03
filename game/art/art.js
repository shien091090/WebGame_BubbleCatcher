/* 捕泡手 art.js (spec v16)
 * 全域物件 window.Art, 不用 ES module。純 Canvas 2D 幾何繪製, 不引外部資源。
 * 一組函式畫三套風格: 每個 draw 函式的 state.level(1 / 2 / 3)決定用哪一套。
 * 只負責「給狀態就畫」, 不算規則、不管輸入。每個函式自己 save / restore。
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 常數
  var W = 1280, H = 720, CX = 640, CY = 360;
  var ARENA_R = 210, BUBBLE_R = 20, FLOOR_R = 24, FLOOR_RING = 140;
  var WALL_APO = 300, WALL_R = WALL_APO / Math.cos(Math.PI / 8); // 約 324.7
  var GATE_WIDEN = 12;               // 光門判定加寬(朝內圈); 亮邊畫面內緣 = 邊中線往內 12 = 距圓心 288
  var HP_R = 221, HP_TRACK = 14, HP_FILL = 10; // 血量環: 中心半徑 221, 軌 214~228, 弧 216~226
  var BEAT_IN = 234, BEAT_OUT = 266; // 拍子提示: 從 266 收到 234(血量環外側), 到拍時在 234 閃
  var RING_C = 19, RING_TRACK = 4, RING_W = 3; // 氣泡壽命環 = 氣泡外緣: 軌 17~21, 弧 17.5~20.5
  var BODY = { circle: 16, square: 14.4, triangle: 12.8 }; // 氣泡本體(形狀路徑參數), 收在壽命環內
  var TAU = Math.PI * 2, OCT = Math.PI / 4, DEG = Math.PI / 180;
  var FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Heiti TC", sans-serif';

  // 各演出時長(秒)。RD 依這張表決定何時停止呼叫對應函式, t 從 0 走到時長
  var TIMING = {
    spawn: 0.3,       // 氣泡冒出(spawnT 0→1 用的總長)
    batchCue: 0.6,    // 出批提示
    stickFx: 0.8,     // 沾上 / 已鎖定回饋(規格初始值)
    missFx: 0.6,      // 沾錯消失回饋
    beatFx: 0.55,     // 踩拍回饋
    chainFx: 0.9,     // 整串回饋
    catchFx: 0.45,    // 一般觸發(碰網)回饋
    netHint: 0.6,     // 光門剛亮起的換位提示
    floorIntro: 2.0,  // 地板出場提示(規格 2 秒)
    hpFx: 0.6         // 血量環 / 血條上「加減了一段」的亮段
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
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
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
  // 形狀路徑: 氣泡本體、網條件符號、賦形地板圖樣、賦形回饋共用同一套(P3)
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
  // 骨(三關都一樣, 辨識靠它): 氣泡 = 立體漸層 + 高光 + 落影 + 外緣壽命環; 地板 = 平塗無影;
  //   無色 = 空心玻璃; 有色 = 實心; 亮邊 = 粗 + 條件色 + 內緣白芯 + 黑襯底; 拍子 = 該關專屬色(只給拍子用);
  //   血量 = 該關血量色(不與 4 色同色相、不用危險紅), 環與左上血條同色。
  //   4 色 = 4 個明度階(暗 / 中暗 / 中亮 / 亮), 色相兩兩至少差約 65°。
  // 皮(每關換): 色溫(暖 / 冷霓虹 / 無彩)、質感(柔圓 / 發光管 / 硬塊)、
  //   背景動態(緩慢漂浮 / 隨拍脈動的舞池格線 / 每 2 小節轉一圈的雷達掃描)、網牆造型(珠串 / 雙霓虹管 / 分節鋼塊)。
  var THEMES = {
    1: { // 第 1 首: 夕照沙洲(暖、柔、圓)
      id: 1, name: 'sunset', style: 'soft',
      bgTop: '#f08a4b', bgMid: '#c4506a', bgBottom: '#3e1a3c',
      ground: '#163f4a', groundLine: '#1f5662', rim: '#ffd9a8',
      wallDim: '#5a2a4a', wallJoint: '#3a1832',
      colors: { A: '#e83ad8', B: '#ffe03a', C: '#2a48e8', D: '#52e07a' },
      beat: '#5ff6ff', danger: '#ff3048', hp: '#8fd94a',
      ink: '#fff4e6', inkDim: '#ecc9b8', hudPlate: 'rgba(48,18,40,0.84)',
      glass: '#fffaf0', lifeRing: '#fff0c8',
      shapeFloorBase: '#0c2a33', shapeFloorGlyph: '#fff4e0'
    },
    2: { // 第 2 首: 霓虹舞池(冷、亮、發光管); 關卡特色 = 光門跳位
      id: 2, name: 'neon', style: 'neon',
      bgTop: '#060821', bgMid: '#0d0a33', bgBottom: '#170838',
      ground: '#100c34', groundLine: '#1b1652', rim: '#36d6ff',
      wallDim: '#4b5bd6', wallJoint: '#8fa0ff',
      colors: { A: '#ff8a1f', B: '#1e9be0', C: '#8cff3a', D: '#9a1ee0' },
      beat: '#ff4fc8', danger: '#ff2a4a', hp: '#3ee0a0',
      ink: '#eef4ff', inkDim: '#9fb0e8', hudPlate: 'rgba(6,8,30,0.84)',
      glass: '#e8fbff', lifeRing: '#d8e8ff',
      shapeFloorBase: '#0a0826', shapeFloorGlyph: '#eaf2ff'
    },
    3: { // 第 3 首: 黑白警戒(無彩、硬角、分節); 關卡特色 = 染色區輪轉
      id: 3, name: 'mono', style: 'hard',
      bgTop: '#0b0b0b', bgMid: '#101010', bgBottom: '#161616',
      ground: '#1a1a1a', groundLine: '#2c2c2c', rim: '#e6e6e6',
      wallDim: '#6e6e6e', wallJoint: '#b0b0b0',
      colors: { A: '#ff5ea8', B: '#e6ff3a', C: '#00a88a', D: '#3b2bd8' },
      beat: '#3dff6e', danger: '#ff2020', hp: '#4aa8ff',
      ink: '#ffffff', inkDim: '#a8a8a8', hudPlate: 'rgba(0,0,0,0.88)',
      glass: '#ffffff', lifeRing: '#d0d0d0',
      shapeFloorBase: '#0a0a0a', shapeFloorGlyph: '#ffffff'
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
    credits: { x: 40, y: 604, w: 1200, h: 106 }, // 署名可佔範圍(不可點), 與所有按鈕判定框不重疊
    guide: {
      close: { x: 1150, y: 20, w: 110, h: 48 },
      prev: { x: 20, y: 652, w: 140, h: 48 },
      next: { x: 1120, y: 652, w: 140, h: 48 }
    }
  };

  // ---------------------------------------------------------------- 背景
  // state: { level, time?(秒, 暫停凍結), beat?(浮點拍數 = 關內拍序號 + 拍內進度, 預備拍可為負) }
  // 不傳 time / beat 時畫靜止版(說明頁、標題)。
  var BOKEH = [[120, 140, 90, 9], [260, 600, 70, 6], [1080, 560, 110, 7], [1180, 300, 60, 11], [380, 520, 50, 8], [930, 120, 80, 5], [60, 470, 60, 10], [820, 650, 50, 12], [520, 80, 64, 7]];
  function drawBackground(ctx, state) {
    var s = state || {}, L = lv(s.level), t = THEMES[L];
    var time = num(s.time, 0), beat = num(s.beat, 0), ph = beat - Math.floor(beat);
    var i, k;
    ctx.save();
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.bgTop); g.addColorStop(0.55, t.bgMid); g.addColorStop(1, t.bgBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (L === 1) {
      // 暖: 內圈背後一輪夕陽柔光 + 緩慢橫向漂浮的柔光圓斑(只給氛圍, 不隨拍)
      var sg = ctx.createRadialGradient(CX, CY - 20, 120, CX, CY - 20, 560);
      sg.addColorStop(0, 'rgba(255,214,140,0.42)'); sg.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
      for (i = 0; i < BOKEH.length; i++) {
        var b = BOKEH[i], span = W + 2 * b[2];
        var bx = ((b[0] + time * b[3]) % span + span) % span - b[2];
        var by = b[1] + 8 * Math.sin(time * 0.4 + i);
        circle(ctx, bx, by, b[2]);
        ctx.fillStyle = 'rgba(255,240,205,' + (i % 2 ? 0.10 : 0.07) + ')'; ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,220,180,0.10)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (k = 0; k < 5; k++) {
        var wy = 600 + k * 22, off = (time * 10 + k * 70) % 160;
        for (var wx = -160 + off; wx < W; wx += 160) line(ctx, wx, wy, wx + 70, wy);
      }
    } else if (L === 2) {
      // 冷霓虹: 上下透視格線舞池, 橫線每拍往外推一格、到拍時整片亮一下; 兩道緩慢擺動的聚光(都在內圈與網牆外)
      var pulse = Math.pow(1 - ph, 3);
      ctx.strokeStyle = 'rgba(54,214,255,' + (0.13 + 0.16 * pulse) + ')'; ctx.lineWidth = 1.5;
      for (var side = -1; side <= 1; side += 2) {
        for (k = -12; k <= 12; k++) line(ctx, CX + k * 30, CY + side * 140, CX + k * 160, side > 0 ? H : 0);
        for (k = 0; k < 8; k++) {
          var yy = CY + side * (140 + Math.pow(k + ph, 1.7) * 14);
          line(ctx, 0, yy, W, yy);
        }
      }
      var sw = Math.sin(time * 0.7) * 0.35, beams = [[0, '#ff4fc8', 1], [W, '#36d6ff', -1]];
      for (k = 0; k < 2; k++) {
        var bxx = beams[k][0], dir = beams[k][2], ang = Math.PI / 2 - dir * (0.55 + sw * dir);
        var len = 1100, wdt = 0.13;
        ctx.beginPath(); ctx.moveTo(bxx, 0);
        ctx.lineTo(bxx + len * Math.cos(ang - wdt), len * Math.sin(ang - wdt));
        ctx.lineTo(bxx + len * Math.cos(ang + wdt), len * Math.sin(ang + wdt)); ctx.closePath();
        ctx.fillStyle = rgba(beams[k][1], 0.06 + 0.04 * pulse); ctx.fill();
      }
    } else {
      // 無彩: 往下捲的掃描線 + 兩側黑白警示斜紋 + 刻度環 + 雷達掃描(每 2 小節 = 8 拍轉一圈, 對應第 3 關染色區輪轉的週期)
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      var so = (time * 24) % 4;
      for (var y = so - 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, 64, H); ctx.rect(W - 64, 150, 64, H - 150); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 14;
      for (var st = -H; st < W + H; st += 40) line(ctx, st, 0, st + H, H);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
      for (k = 0; k < 64; k++) {
        var ta = k * TAU / 64, r1 = 346, r2 = k % 8 === 0 ? 366 : 354;
        line(ctx, CX + r1 * Math.cos(ta), CY + r1 * Math.sin(ta), CX + r2 * Math.cos(ta), CY + r2 * Math.sin(ta));
      }
      var ra = (beat / 8) * TAU - Math.PI / 2;
      for (k = 0; k < 10; k++) {
        ctx.beginPath(); ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, 820, ra - (k + 1) * 0.05, ra - k * 0.05);
        ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,' + (0.055 * (1 - k / 10)) + ')'; ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 內圈(場地)
  function drawArena(ctx, state) {
    var L = lv(state && state.level), t = THEMES[L], i;
    ctx.save();
    // 內圈外一圈深色襯底, 讓內圈與血量環從任何背景浮出
    circle(ctx, CX, CY, HP_R + HP_TRACK / 2 + 3); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    circle(ctx, CX, CY, ARENA_R); ctx.fillStyle = t.ground; ctx.fill();
    ctx.save();
    circle(ctx, CX, CY, ARENA_R); ctx.clip();
    if (L === 1) {
      ctx.strokeStyle = t.groundLine; ctx.lineWidth = 3;
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
        line(ctx, CX + 40 * Math.cos(a), CY + 40 * Math.sin(a), CX + ARENA_R * Math.cos(a), CY + ARENA_R * Math.sin(a));
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
      ctx.lineWidth = 4; ctx.strokeStyle = rgba(t.rim, 0.9);
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
    } else if (L === 2) {
      ctx.shadowColor = t.rim; ctx.shadowBlur = 10;
      ctx.lineWidth = 2; ctx.strokeStyle = t.rim;
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
      circle(ctx, CX, CY, ARENA_R - 6); ctx.strokeStyle = rgba(t.rim, 0.5); ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(t.rim, 0.85);
      circle(ctx, CX, CY, ARENA_R); ctx.stroke();
      for (i = 0; i < 24; i++) {
        var b = i * TAU / 24;
        line(ctx, CX + (ARENA_R - 9) * Math.cos(b), CY + (ARENA_R - 9) * Math.sin(b), CX + ARENA_R * Math.cos(b), CY + ARENA_R * Math.sin(b));
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 血量環(內圈外緣) + 危險紅光
  // state: { level, hp(0~100), danger(bool), time(任意遞增秒數, 紅光脈動用; 暫停凍結), hpFx?(陣列, 同 drawHud) }
  // 起點 12 點鐘、順時針; 弧長 = hp ÷ 100。弧頭一道亮刻 = 「血量走到這裡」。
  // 危險: 內圈邊緣往內一圈紅光, 以 1.3 秒週期脈動(與拍子無關, 位置在內圈內側; 拍子提示在血量環外側)
  function hpArcFx(ctx, t, rad, width, fx) {
    var list = fx || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i] || {}, fp = clamp01(num(f.t, 0) / TIMING.hpFx), fa = 1 - fp * fp;
      var from = Math.max(0, Math.min(100, num(f.from, 0))), to = Math.max(0, Math.min(100, num(f.to, 0)));
      var lo = Math.min(from, to), hi = Math.max(from, to);
      var minSpan = 9 / rad * 100 / TAU; // 至少 9 像素弧長
      if (hi - lo < minSpan) { if (to >= from) lo = hi - minSpan; else hi = lo + minSpan; }
      var a0 = -Math.PI / 2 + TAU * lo / 100, a1 = -Math.PI / 2 + TAU * hi / 100;
      var kind = f.kind || 'catch';
      var col = kind === 'beat' || kind === 'chain' ? t.beat : ((kind === 'expire' || kind === 'miss') ? t.danger : '#ffffff');
      var grow = kind === 'chain' ? 6 : (kind === 'expire' ? 3 : 0);
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineWidth = width + 2 * grow + 3; ctx.strokeStyle = 'rgba(0,0,0,' + (0.6 * fa) + ')';
      ctx.beginPath(); ctx.arc(CX, CY, rad, a0, a1); ctx.stroke();
      if (kind === 'chain' || kind === 'beat') { ctx.shadowColor = t.beat; ctx.shadowBlur = kind === 'chain' ? 16 : 8; }
      ctx.lineWidth = width + 2 * grow; ctx.strokeStyle = rgba(col, 0.95 * fa);
      ctx.beginPath(); ctx.arc(CX, CY, rad, a0, a1); ctx.stroke();
      ctx.restore();
    }
  }
  function drawHpRing(ctx, state) {
    var s = state || {}, L = lv(s.level), t = THEMES[L];
    var hp = Math.max(0, Math.min(100, num(s.hp, 0))), time = num(s.time, 0);
    ctx.save();
    if (s.danger) {
      var pu = 0.5 + 0.5 * Math.sin(time * TAU / 1.3);
      var g = ctx.createRadialGradient(CX, CY, ARENA_R - 36, CX, CY, ARENA_R + 1);
      g.addColorStop(0, rgba(t.danger, 0)); g.addColorStop(1, rgba(t.danger, 0.16 + 0.28 * pu));
      ctx.beginPath(); ctx.arc(CX, CY, ARENA_R + 1, 0, TAU); ctx.arc(CX, CY, ARENA_R - 36, 0, TAU, true);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 3 + 2 * pu; ctx.strokeStyle = rgba(t.danger, 0.55 + 0.4 * pu);
      circle(ctx, CX, CY, ARENA_R - 1); ctx.stroke();
    }
    // 軌: 深色整圈(空的部分看得出「本來有多長」)
    ctx.lineCap = 'butt';
    ctx.lineWidth = HP_TRACK; ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    circle(ctx, CX, CY, HP_R); ctx.stroke();
    ctx.lineWidth = HP_FILL; ctx.strokeStyle = rgba(t.hp, 0.12);
    circle(ctx, CX, CY, HP_R); ctx.stroke();
    var a0 = -Math.PI / 2, a1 = a0 + TAU * hp / 100;
    if (hp > 0.05) {
      ctx.lineWidth = HP_FILL; ctx.strokeStyle = t.hp;
      ctx.beginPath(); ctx.arc(CX, CY, HP_R, a0, a1); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(lighten(t.hp, 0.5), 0.7);
      ctx.beginPath(); ctx.arc(CX, CY, HP_R + 2.5, a0, a1); ctx.stroke();
      // 弧頭亮刻
      var hx = Math.cos(a1), hy = Math.sin(a1);
      ctx.lineWidth = 3.5; ctx.strokeStyle = lighten(t.hp, 0.75);
      line(ctx, CX + (HP_R - 7) * hx, CY + (HP_R - 7) * hy, CX + (HP_R + 7) * hx, CY + (HP_R + 7) * hy);
    }
    hpArcFx(ctx, t, HP_R, HP_FILL, s.hpFx);
    // 起點刻(12 點鐘): 讓「滿 / 快滿」與「空」有參考點
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.ink, 0.75);
    line(ctx, CX, CY - HP_R - HP_TRACK / 2 - 3, CX, CY - HP_R + HP_TRACK / 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 拍子提示
  // phase: 距上一拍已過的比例 0~1(0 = 剛到拍, 接近 1 = 下一拍快到)。
  // 收攏元素從 266 收到 234(緊貼血量環外側), phase = 1 時到位 = 下一拍; 到拍時在 234 閃一圈。整個在血量環之外, 不碰它
  function drawBeatCue(ctx, state) {
    state = state || {};
    var L = lv(state.level), t = THEMES[L];
    var p = clamp01(num(state.phase, 0));
    var r = BEAT_IN + (BEAT_OUT - BEAT_IN) * (1 - p);
    var a = 0.2 + 0.5 * p;
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
    // 到拍那一刻, 終點那一圈閃一下(在血量環外, 細線; 血量環本身不閃)
    var f = 1 - p / 0.22;
    if (f > 0) {
      ctx.shadowColor = t.beat; ctx.shadowBlur = 12 * f;
      ctx.lineWidth = 2 + 4 * f; ctx.strokeStyle = rgba(t.beat, 0.9 * f);
      circle(ctx, CX, CY, BEAT_IN); ctx.stroke();
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
  // 邊上參數 u(0~1 沿邊)、法向偏移 d(正 = 往外, 負 = 往內圈)的點
  function edgePt(e, u, d) { var p = lerpPt(e, u); return [p[0] + d * Math.cos(e.m), p[1] + d * Math.sin(e.m)]; }
  function segLine(ctx, e, u0, u1) { var p1 = lerpPt(e, u0), p2 = lerpPt(e, u1); line(ctx, p1[0], p1[1], p2[0], p2[1]); }
  // 沿邊畫一條帶: 法向從 d0 到 d1, 沿邊從 u0 到 u1, 兩端垂直截斷(butt)
  function band(ctx, e, d0, d1, u0, u1) {
    var dm = (d0 + d1) / 2, a = edgePt(e, u0, dm), b = edgePt(e, u1, dm);
    ctx.lineCap = 'butt'; ctx.lineWidth = Math.abs(d1 - d0);
    line(ctx, a[0], a[1], b[0], b[1]);
  }
  // 只留法向偏移 ≥ dMin 的那一側(外光不往內圈滲, 亮邊內緣保持銳利)
  function clipOut(ctx, e, dMin) {
    var p1 = edgePt(e, -1, dMin), p2 = edgePt(e, 2, dMin), p3 = edgePt(e, 2, dMin + 400), p4 = edgePt(e, -1, dMin + 400);
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
    ctx.clip();
  }

  function drawDimEdge(ctx, t, L, e) {
    if (L === 1) {
      for (var k = 0; k < 15; k++) {
        var p = lerpPt(e, (k + 0.5) / 15);
        circle(ctx, p[0], p[1], 6.5); ctx.fillStyle = rgba(t.wallDim, 0.92); ctx.fill();
        circle(ctx, p[0] - 1.6, p[1] - 1.8, 2); ctx.fillStyle = 'rgba(255,220,200,0.25)'; ctx.fill();
      }
    } else if (L === 2) {
      var nx = Math.cos(e.m) * 4, ny = Math.sin(e.m) * 4;
      ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.wallDim, 0.9);
      ctx.shadowColor = t.wallDim; ctx.shadowBlur = 8;
      line(ctx, e.x1 - nx, e.y1 - ny, e.x2 - nx, e.y2 - ny);
      line(ctx, e.x1 + nx, e.y1 + ny, e.x2 + nx, e.y2 + ny);
      ctx.shadowBlur = 0;
    } else {
      ctx.lineCap = 'butt'; ctx.lineWidth = 11;
      for (var j = 0; j < 6; j++) {
        ctx.strokeStyle = j % 2 ? '#3a3a3a' : rgba(t.wallDim, 0.95);
        segLine(ctx, e, (j + 0.06) / 6, (j + 0.94) / 6);
      }
    }
  }
  function drawJoints(ctx, t, L) {
    for (var k = 0; k < 8; k++) {
      var a = Math.PI / 8 + k * OCT, x = CX + WALL_R * Math.cos(a), y = CY + WALL_R * Math.sin(a);
      if (L === 3) { ctx.fillStyle = t.wallJoint; ctx.fillRect(x - 7, y - 7, 14, 14); }
      else if (L === 1) { circle(ctx, x, y, 10); ctx.fillStyle = t.wallJoint; ctx.fill(); }
      else { circle(ctx, x, y, 3.5); ctx.fillStyle = rgba(t.wallJoint, 0.85); ctx.fill(); }
    }
  }
  function drawCondShape(ctx, e, col, shape, pending) {
    if (shape !== 'square' && shape !== 'triangle') return;
    var c = edgePt(e, 0.5, 14);
    circle(ctx, c[0], c[1], 16); ctx.fillStyle = pending ? 'rgba(16,16,24,0.85)' : '#101018'; ctx.fill();
    if (pending) ctx.setLineDash([4, 3]);
    ctx.lineWidth = pending ? 2 : 3; ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
    shapePath(ctx, shape, c[0], c[1], 9); ctx.fillStyle = pending ? 'rgba(255,255,255,0.5)' : '#ffffff'; ctx.fill();
  }
  // 亮邊: 條件色帶的內緣 = 邊中線往內 12(= 判定加寬後的位置), 內緣是一條白芯; 外光只往外放
  // core: 白芯保留的長度比例(1 = 全長; 跳位預告中「即將熄滅」由兩端往中間縮)
  function drawLitEdge(ctx, t, L, e, col, shape, core) {
    core = core == null ? 1 : clamp01(core);
    var dIn = -GATE_WIDEN, dOut = L === 2 ? 4 : 10;
    // 內側極淡柔光(只幫視線找到這一邊; 不構成邊線)
    var wc = edgePt(e, 0.5, 0);
    var wg = ctx.createRadialGradient(wc[0], wc[1], 10, wc[0], wc[1], 140);
    wg.addColorStop(0, rgba(col, L === 3 ? 0.09 : 0.12)); wg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = wg; circle(ctx, wc[0], wc[1], 140); ctx.fill();
    // 黑襯底: 往內只多 2 像素(不改變看到的內緣), 往外多 6
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    band(ctx, e, dIn - 2, dOut + 6, 0, 1);
    ctx.save();
    clipOut(ctx, e, dIn);
    ctx.shadowColor = col; ctx.shadowBlur = L === 3 ? 12 : 22;
    ctx.strokeStyle = col;
    if (L === 3) {
      for (var k = 0; k < 6; k++) band(ctx, e, dIn, dOut, (k + 0.04) / 6, (k + 0.96) / 6);
    } else {
      band(ctx, e, dIn, dOut, 0, 1);
      if (L === 2) { ctx.shadowBlur = 34; band(ctx, e, dIn, dOut, 0, 1); }
    }
    ctx.shadowBlur = 0;
    if (core > 0.01) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      band(ctx, e, dIn, dIn + 4, 0.5 - 0.5 * core, 0.5 + 0.5 * core);
    }
    ctx.restore();
    drawCondShape(ctx, e, col, shape, false);
  }
  // 跳位預告「即將亮起」: 同一個帶的位置, 虛線 + 由中點往兩端長的填色, 長滿那一刻 = 亮起(字典: 虛線 + 長大 = 還沒生效)
  function drawPendingEdge(ctx, t, L, e, col, shape, p) {
    var dIn = -GATE_WIDEN, dOut = L === 2 ? 4 : 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    band(ctx, e, dIn - 2, dOut + 6, 0, 1);
    ctx.save();
    ctx.setLineDash([14, 9]); ctx.strokeStyle = rgba(col, 0.85);
    band(ctx, e, dIn + 3, dOut - 3, 0, 1); ctx.setLineDash([]);
    if (p > 0.01) { ctx.strokeStyle = col; band(ctx, e, dIn, dOut, 0.5 - 0.5 * p, 0.5 + 0.5 * p); }
    ctx.restore();
    drawCondShape(ctx, e, col, shape, true);
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
      var jump = lit.jump && lit.jump.to >= 1 && lit.jump.to <= 8 && lit.jump.to !== lit.slot ? lit.jump : null;
      var jp = jump ? clamp01(num(jump.p, 0)) : 0;
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
      // 第 2 關跳位預告: 目標邊「即將亮起」
      if (jump) drawPendingEdge(ctx, t, L, edgeOf(jump.to), col, lit.shape, jp);
      // 亮邊; 跳位預告中「即將熄滅」= 白芯由兩端往中間縮(仍是完整條件色帶 = 照常收)
      drawLitEdge(ctx, t, L, e, col, lit.shape, jump ? 1 - jp : 1);
      if (hintT < TIMING.netHint) {
        var ba = hintT > TIMING.netHint - 0.2 ? (TIMING.netHint - hintT) / 0.2 : 1;
        var pull = 6 * (1 - easeOut(hintT / 0.25));
        var fc = edgePt(e, 0.5, 6);
        corners(ctx, fc[0], fc[1], 134 + pull, 18 + pull, e.m + Math.PI / 2, 18, '#ffffff', ba, 3);
      }
    }
    // 一般觸發(碰網)回饋: 舊邊整條白閃 + 碰網點內側的白細環與勾; 畫在狀態分支外, 舊邊已熄滅也照畫
    var cf = state.catchFx;
    if (cf && cf.slot >= 1 && cf.slot <= 8) {
      var ce = edgeOf(cf.slot), cp = clamp01(num(cf.t, 0) / TIMING.catchFx);
      var fl = clamp01(1 - cp / 0.6);
      if (fl > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * fl) + ')';
        band(ctx, ce, -GATE_WIDEN, -GATE_WIDEN + 2 + 8 * fl, 0, 1);
      }
      var hx = num(cf.x, ce.mx - GATE_WIDEN * Math.cos(ce.m)), hy = num(cf.y, ce.my - GATE_WIDEN * Math.sin(ce.m));
      var ix = hx - 34 * Math.cos(ce.m), iy = hy - 34 * Math.sin(ce.m);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - cp) + ')';
      circle(ctx, ix, iy, 16 + 22 * easeOut(cp)); ctx.stroke();
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
      circle(ctx, x, y, r + 1); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(lighten(color, 0.45), 0.8); ctx.stroke();
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
        ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, TAU); ctx.arc(x, y, toR, 0, TAU, true);
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

  // ---------------------------------------------------------------- 第 3 關輪轉預告
  // 每塊地板往順時針下一個位置畫一段弧: 虛線軌 = 要去的路, 實線由起點往前長、長滿 = 輪轉那一刻; 弧用該地板自己的色
  // state: { level, p(0~1: 2 拍預告已過的比例), r?(地板半徑, 預設 24), floors: [{ angle(度, 目前位置), color?('A'~'D') | shape?('square'/'triangle') }] }
  function drawRotateCue(ctx, state) {
    var s = state || {}, L = lv(s.level), t = THEMES[L];
    var p = clamp01(num(s.p, 0)), list = s.floors || [];
    var fr = num(s.r, FLOOR_R), half = Math.asin(Math.min(0.9, (fr + 7) / FLOOR_RING));
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < list.length; i++) {
      var f = list[i] || {};
      var col = f.color ? condColor(L, f.color) : (f.shape ? t.shapeFloorGlyph : null);
      if (!col) continue;
      var a0 = num(f.angle, 0) * DEG + half, a1 = (num(f.angle, 0) + 60) * DEG - half;
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(CX, CY, FLOOR_RING, a0, a1); ctx.stroke();
      ctx.setLineDash([5, 6]); ctx.lineWidth = 3; ctx.strokeStyle = rgba(col, 0.6);
      ctx.beginPath(); ctx.arc(CX, CY, FLOOR_RING, a0, a1); ctx.stroke(); ctx.setLineDash([]);
      var tip = a0 + (a1 - a0) * Math.max(0.12, p);
      ctx.lineWidth = 4.5; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(CX, CY, FLOOR_RING, a0, tip); ctx.stroke();
      var hx = CX + FLOOR_RING * Math.cos(tip), hy = CY + FLOOR_RING * Math.sin(tip);
      var dir = tip + Math.PI / 2, hs = 9;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(dir) * hs, hy + Math.sin(dir) * hs);
      ctx.lineTo(hx + Math.cos(dir + 2.4) * hs, hy + Math.sin(dir + 2.4) * hs);
      ctx.lineTo(hx + Math.cos(dir - 2.4) * hs, hy + Math.sin(dir - 2.4) * hs); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 出批提示(輕量)
  function drawBatchCue(ctx, state) {
    var s = state || {}, L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), p = clamp01(num(s.t, 0) / TIMING.batchCue);
    ctx.save();
    ctx.lineWidth = 2;
    for (var k = 0; k < 2; k++) {
      var q = clamp01(p * 1.25 - k * 0.25);
      if (q <= 0 || q >= 1) continue;
      var rr = 30 + 60 * easeOut(q);
      ctx.beginPath(); ctx.ellipse(x, y + 12, rr, rr * 0.36, 0, 0, TAU);
      ctx.strokeStyle = rgba(t.glass, 0.5 * (1 - q)); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 氣泡
  // 外緣 = 壽命環 = 判定圓(半徑 20): 任何狀態都不放大、不位移。本體收在環內。
  // beatPhase(0~1, 距上一拍已過的比例): 隨拍原地變化 = 本體內緣一圈用自己的邊色向內加粗 + 高光往上跳一下再落回,
  //   只在本體裡、不改色相與明度階、不碰壽命環。
  function bodyPath(ctx, shape, x, y, inset) { shapePath(ctx, shape, x, y, BODY[shape] - (inset || 0)); }
  function drawBubble(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L], pal = theme(s.paletteLevel || L);
    var x = num(s.x, CX), y = num(s.y, CY), st = s.status || 'idle';
    var color = s.color ? (pal.colors[s.color] || null) : null;
    var shape = (s.shape === 'square' || s.shape === 'triangle') ? s.shape : 'circle';
    var spawn = s.spawnT == null ? 1 : clamp01(s.spawnT);
    var lifted = (st === 'dragging' || st === 'carried');
    var br = BODY.circle;
    var k = 0;
    if (typeof s.beatPhase === 'number' && isFinite(s.beatPhase)) {
      var q = s.beatPhase - Math.floor(s.beatPhase);
      k = q < 0.4 ? Math.pow(1 - q / 0.4, 2) : 0;
    }
    ctx.save();
    if (st === 'returning') ctx.globalAlpha = 0.45;
    if (spawn < 1) {
      var rr = 18 + 22 * spawn;
      ctx.beginPath(); ctx.ellipse(x, y + 12, rr, rr * 0.36, 0, 0, TAU);
      ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.glass, 0.7 * (1 - spawn)); ctx.stroke();
      ctx.globalAlpha *= easeOut(spawn);
    }
    // 落影(常駐; 拿起時影子拉遠變淡 = 浮起)
    ctx.beginPath();
    if (lifted) ctx.ellipse(x + 9, y + 24, 21, 8.4, 0, 0, TAU);
    else ctx.ellipse(x + 3, y + 14, 19, 8, 0, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,' + (lifted ? 0.26 : 0.42) + ')'; ctx.fill();
    // 本體
    var edgeCol;
    if (color) {
      var g = ctx.createRadialGradient(x - br * 0.35, y - br * 0.42, br * 0.08, x, y, br * 1.2);
      g.addColorStop(0, lighten(color, 0.6)); g.addColorStop(0.45, color); g.addColorStop(1, darken(color, 0.38));
      bodyPath(ctx, shape, x, y); ctx.fillStyle = g;
      if (t.style === 'neon') { ctx.shadowColor = color; ctx.shadowBlur = 6; }
      ctx.fill(); ctx.shadowBlur = 0;
      edgeCol = t.style === 'neon' ? lighten(color, 0.5) : lighten(color, 0.35);
      ctx.lineWidth = 2; ctx.strokeStyle = edgeCol; ctx.stroke();
    } else {
      bodyPath(ctx, shape, x, y); ctx.fillStyle = rgba(t.glass, 0.1); ctx.fill();
      var gg = ctx.createRadialGradient(x, y, br * 0.55, x, y, br);
      gg.addColorStop(0, rgba(t.glass, 0)); gg.addColorStop(1, rgba(t.glass, 0.32));
      ctx.fillStyle = gg; ctx.fill();
      edgeCol = t.glass;
      ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(t.glass, 0.92); ctx.stroke();
    }
    // 高光 + 反光弧(剪在本體內); 隨拍: 內緣加粗 + 高光上跳
    ctx.save();
    bodyPath(ctx, shape, x, y); ctx.clip();
    if (k > 0.01) {
      // 內緣向內加粗(最寬 2.5 像素)+ 一道細波紋從本體邊往中心收(像鼓皮被敲了一下)
      bodyPath(ctx, shape, x, y);
      ctx.lineWidth = 5 * k; ctx.strokeStyle = rgba(edgeCol, 0.8); ctx.stroke();
      var wq = 1 - k; // 0 → 1 隨拍內進度
      bodyPath(ctx, shape, x, y, (BODY[shape] * 0.65) * Math.sqrt(wq));
      ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(edgeCol, 0.85 * k); ctx.stroke();
    }
    var hop = -5 * k;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    if (t.style === 'hard') {
      ctx.beginPath();
      ctx.moveTo(x - br * 0.62, y + hop - br * 0.1); ctx.lineTo(x - br * 0.25, y + hop - br * 0.62);
      ctx.lineTo(x + br * 0.05, y + hop - br * 0.66); ctx.lineTo(x - br * 0.4, y + hop - br * 0.05); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(x - br * 0.32, y + hop - br * 0.4, br * (t.style === 'neon' ? 0.26 : 0.34), br * 0.19, -0.6, 0, TAU); ctx.fill();
    }
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath(); ctx.arc(x, y + hop * 0.5, br * 0.72, 0.25, 1.35); ctx.stroke();
    ctx.restore();
    // 外緣 = 壽命環(判定圓上)。軌 = 深色外描; 弧 = 剩餘比例
    ctx.lineCap = 'butt';
    circle(ctx, x, y, RING_C); ctx.lineWidth = RING_TRACK; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
    if (!s.noLife) {
      var life = clamp01(num(s.life, 1)), frozen = (st === 'held' || lifted);
      if (life > 0.001) {
        ctx.beginPath(); ctx.arc(x, y, RING_C, -Math.PI / 2, -Math.PI / 2 + TAU * life);
        ctx.lineWidth = frozen ? RING_W + 0.4 : RING_W;
        ctx.strokeStyle = frozen ? '#ffffff' : (life < 0.25 ? t.danger : t.lifeRing);
        if (frozen) { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 4; }
        ctx.stroke(); ctx.shadowBlur = 0;
      }
    } else {
      circle(ctx, x, y, RING_C); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(color ? lighten(color, 0.35) : t.glass, 0.7); ctx.stroke();
    }
    if (s.hover && st === 'idle') {
      circle(ctx, x, y, BUBBLE_R + 3); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 沾地板回饋(沾上 / 已鎖定)
  // 長在氣泡本身: 沾上 = 從氣泡外緣往外擴的一圈粗光(沾色 = 該色圓環; 賦形 = 該形狀的白框); 已鎖定 = 灰虛線兩圈往內收回氣泡
  // state: { level, x, y, kind('stick'/'locked'), attr('color'/'shape'), value, t(秒), stack?(0/1), paletteLevel? }
  function drawStickFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level);
    var x = num(s.x, CX), y = num(s.y, CY), tt = num(s.t, 0);
    var stack = num(s.stack, 0) ? 1 : 0;
    var p = clamp01((tt - stack * 0.08) / TIMING.stickFx);
    if (tt < stack * 0.08) return;
    var kind = s.kind === 'locked' ? 'locked' : 'stick', attr = s.attr === 'shape' ? 'shape' : 'color';
    var fade = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
    ctx.save();
    ctx.globalAlpha = clamp01(fade);
    if (kind === 'stick') {
      var e = easeOut(clamp01(p / 0.5));
      var rr = 23 + 4 * stack + 34 * e, w = 9 * (1 - e) + 2.5;
      if (attr === 'color') {
        var col = condColor(s.paletteLevel || L, s.value);
        ctx.lineWidth = w + 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; circle(ctx, x, y, rr); ctx.stroke();
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        ctx.lineWidth = w; ctx.strokeStyle = col; circle(ctx, x, y, rr); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2; ctx.strokeStyle = rgba(col, 0.6 * (1 - e)); circle(ctx, x, y, rr - 9 * e); ctx.stroke();
      } else {
        var sh = s.value === 'triangle' ? 'triangle' : 'square';
        var rp = sh === 'triangle' ? rr * 0.85 : rr * 0.98;
        ctx.lineJoin = 'round';
        shapePath(ctx, sh, x, y, rp); ctx.lineWidth = w + 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
        ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14;
        ctx.lineWidth = w; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (p < 0.16) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - p / 0.16) + ')'; circle(ctx, x, y, 22); ctx.stroke(); }
    } else {
      // 已鎖定: 灰虛線往內收(方向、線型、顏色都與沾上相反)
      ctx.setLineDash([5, 4]); ctx.lineWidth = 3;
      for (var i = 0; i < 2; i++) {
        var q = clamp01(p * 1.4 - i * 0.25);
        if (q <= 0) continue;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 5; circle(ctx, x, y, 50 - 27 * easeOut(q)); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,205,215,' + (0.95 * (1 - q * 0.5)) + ')'; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 沾錯消失回饋
  var SHARD = [[-0.3, 1.0], [0.75, 0.8], [1.8, 1.1], [2.75, 0.9], [3.8, 1.05], [5.0, 0.85]];
  function drawMissFx(ctx, state) {
    var s = state || {}, L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), p = clamp01(num(s.t, 0) / TIMING.missFx), e = easeOut(p);
    var col = s.color ? condColor(s.paletteLevel || L, s.color) : t.glass;
    var a = 1 - p * p;
    ctx.save();
    for (var i = 0; i < SHARD.length; i++) {
      var ang = SHARD[i][0], sp = SHARD[i][1];
      var d = 14 + 30 * e * sp, sx = x + d * Math.cos(ang), sy = y + d * Math.sin(ang) + 26 * p * p;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang + p * 3);
      ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(8, -2); ctx.lineTo(-2, 7); ctx.closePath();
      ctx.fillStyle = rgba(col, 0.95 * a); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,' + (0.6 * a) + ')'; ctx.stroke();
      ctx.restore();
    }
    var xs = 11 * (p < 0.15 ? easeOutBack(p / 0.15) : 1);
    ctx.lineCap = 'round';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,' + (0.7 * a) + ')';
    line(ctx, x - xs, y - xs, x + xs, y + xs); line(ctx, x + xs, y - xs, x - xs, y + xs);
    ctx.lineWidth = 4.5; ctx.strokeStyle = rgba(t.danger, a);
    line(ctx, x - xs, y - xs, x + xs, y + xs); line(ctx, x + xs, y - xs, x - xs, y + xs);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 踩拍回饋(3 級)
  // 長在氣泡本身: 氣泡周身亮起拍子色光暈, 外緣貼著幾圈「共鳴輪廓」原地震動; 輪廓圈數 = 級數, 級數越高光越強、
  //   第 3 級最內圈為白色。不在旁邊另放圖示或拍點。中心不蓋(氣泡顏色照樣看得到)。
  // onBubble = false(送進光門): 氣泡已消失, 在碰網位置爆成一團拍子色光 + 輪廓往外擴(圈數 = 級數)
  var CONTOUR = [26, 32, 38];
  function drawBeatFx(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    var x = num(s.x, CX), y = num(s.y, CY), tier = Math.max(1, Math.min(3, Math.round(num(s.tier, 1))));
    var p = clamp01(num(s.t, 0) / TIMING.beatFx), a = 1 - p * p;
    var onBubble = s.onBubble !== false, col = t.beat;
    var outer = CONTOUR[tier - 1] + 10;
    ctx.save();
    if (onBubble) {
      // 只畫在氣泡外緣之外: 光暈不准染到氣泡本體(顏色是辨識通道)
      ctx.beginPath(); ctx.arc(x, y, 200, 0, TAU); ctx.arc(x, y, BUBBLE_R + 1.5, 0, TAU, true); ctx.clip();
    }
    // 光暈: 從氣泡外緣起往外, 內側透明(不蓋氣泡本體)
    var gr = ctx.createRadialGradient(x, y, BUBBLE_R, x, y, outer + 6 * tier);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.18, rgba(col, (0.25 + 0.15 * tier) * a)); gr.addColorStop(1, rgba(col, 0));
    ctx.beginPath(); ctx.arc(x, y, outer + 6 * tier, 0, TAU); ctx.arc(x, y, BUBBLE_R, 0, TAU, true);
    ctx.fillStyle = gr; ctx.fill();
    if (!onBubble) {
      // 被觸發消失那一下: 氣泡大小的一團拍子色光, 白芯
      var cg = ctx.createRadialGradient(x, y, 0, x, y, BUBBLE_R + 6 * easeOut(p));
      cg.addColorStop(0, 'rgba(255,255,255,' + (0.95 * (1 - p)) + ')');
      cg.addColorStop(0.55, rgba(col, 0.8 * (1 - p))); cg.addColorStop(1, rgba(col, 0));
      circle(ctx, x, y, BUBBLE_R + 6 * easeOut(p)); ctx.fillStyle = cg; ctx.fill();
    }
    ctx.shadowColor = col; ctx.shadowBlur = 6 + 7 * tier;
    for (var i = 0; i < tier; i++) {
      var base = CONTOUR[i];
      var r = onBubble
        ? base + 1.6 * Math.sin(p * TAU * 3 + i) * (1 - p) + 3 * easeOut(p)
        : base - 4 + (14 + 8 * i) * easeOut(p);
      var lw = 3.6 + 0.5 * tier - 0.5 * i;
      ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 * a) + ')';
      circle(ctx, x, y, r); ctx.stroke();
      ctx.lineWidth = lw;
      ctx.strokeStyle = (tier === 3 && i === 0) ? 'rgba(255,255,255,' + a + ')' : rgba(col, a * (1 - i * 0.1));
      ctx.stroke();
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
    roundRect(ctx, CX - 110, CY - 128, 220, 52, 26); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.beat, 0.9); ctx.stroke();
    text(ctx, '第 ' + L + ' 首', CX, CY - 102, 30, t.ink);
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD
  // 左上血條: 與血量環同色(同一個量一種長相); 最亮的白與拍子色留給「剛變化的那一段」; 危險 = 紅框脈動
  function drawHpBar(ctx, t, x, y, w, h, hp, danger, fx, time) {
    var v = Math.max(0, Math.min(100, num(hp, 0)));
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    if (v > 0) {
      ctx.save(); roundRect(ctx, x, y, w, h, h / 2); ctx.clip();
      ctx.fillStyle = t.hp;
      ctx.fillRect(x, y, w * v / 100, h);
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x, y, w * v / 100, h * 0.35);
      ctx.restore();
    }
    var list = fx || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i], fp = clamp01(num(f.t, 0) / TIMING.hpFx), fa = 1 - fp * fp;
      var from = Math.max(0, Math.min(100, num(f.from, 0))), to = Math.max(0, Math.min(100, num(f.to, 0)));
      var x0 = x + w * Math.min(from, to) / 100, x1 = x + w * Math.max(from, to) / 100;
      if (x1 - x0 < 8) { var gain = to >= from, edge = x + w * to / 100; x0 = gain ? edge - 8 : edge; x1 = x0 + 8; }
      var kind = f.kind || 'catch';
      var col = kind === 'beat' || kind === 'chain' ? t.beat : ((kind === 'expire' || kind === 'miss') ? t.danger : '#ffffff');
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
      ctx.lineWidth = 2.5 + 1.5 * (0.5 + 0.5 * Math.sin(num(time, 0) * TAU / 1.3));
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
  function drawHud(ctx, state) {
    var s = state || {};
    var L = lv(s.level), t = THEMES[L];
    ctx.save();
    var hl = LAYOUT.hudLeft, hr = LAYOUT.hudRight;
    roundRect(ctx, hl.x, hl.y, hl.w, hl.h, L === 3 ? 2 : 12); ctx.fillStyle = t.hudPlate; ctx.fill();
    text(ctx, '血量', hl.x + 12, hl.y + 24, 16, s.danger ? t.danger : t.ink, 'left');
    drawHpBar(ctx, t, hl.x + 52, hl.y + 14, 176, 20, s.hp, !!s.danger, s.hpFx, s.time);
    text(ctx, '存活', hl.x + 12, hl.y + 60, 13, t.inkDim, 'left');
    text(ctx, num(s.survival, 0).toFixed(1) + ' 秒', hl.x + 48, hl.y + 60, 18, t.ink, 'left');
    if (s.songProgress != null) {
      // 歌曲進度: 細譜線 + 沿線滑動的音符(播放頭), 不是填滿長條, 不會讀成血量
      var sp = clamp01(num(s.songProgress, 0)), x0 = hl.x + 150, x1 = hl.x + 226, ly = hl.y + 64;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(t.inkDim, 0.45); line(ctx, x0, ly, x1, ly);
      ctx.lineWidth = 1; line(ctx, x1, ly - 5, x1, ly + 5);
      if (sp > 0) { ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(t.rim, 0.9); line(ctx, x0, ly, x0 + (x1 - x0) * sp, ly); }
      drawNote(ctx, x0 + (x1 - x0) * sp - 2, ly - 7, t.ink);
    }
    roundRect(ctx, hr.x, hr.y, hr.w, hr.h, L === 3 ? 2 : 12); ctx.fillStyle = t.hudPlate; ctx.fill();
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
    ctx.fillStyle = opts.primary ? (hover ? lighten(t.rim, 0.2) : t.rim) : (hover ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.35)');
    ctx.fill();
    ctx.lineWidth = hover ? 3 : 2; ctx.strokeStyle = hover ? '#ffffff' : rgba(t.ink, 0.5); ctx.stroke();
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
    overlay(ctx, 0.2);
    var deco = [[420, 230, 'A', 'circle'], [860, 210, 'C', 'circle'], [330, 470, null, 'circle'], [950, 480, 'B', 'circle']];
    for (var i = 0; i < deco.length; i++) drawBubble(ctx, { level: 1, x: deco[i][0], y: deco[i][1], color: deco[i][2], shape: deco[i][3], life: 1 });
    text(ctx, '捕泡手', CX, 230, 76, t.ink, 'center', { stroke: 'rgba(40,10,30,0.7)', strokeWidth: 9 });
    text(ctx, '把氣泡染色、送進光門、對上拍子', CX, 304, 20, t.ink, 'center', { stroke: 'rgba(40,10,30,0.6)', strokeWidth: 5 });
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
  function endCard(ctx, t, x, y, w, survival) {
    roundRect(ctx, x, y, w, 170, 18); ctx.fillStyle = 'rgba(20,16,34,0.94)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(t.rim, 0.6); ctx.stroke();
    text(ctx, '結束', x + w / 2, y + 50, 36, t.ink);
    text(ctx, '存活 ' + num(survival, 0).toFixed(1) + ' 秒', x + w / 2, y + 115, 28, t.ink);
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

  // 背景音樂署名: 標題與結束畫面底部, 小字低對比, 底下墊半透明暗帶保證可讀。
  function drawCredits(ctx, state) {
    var s = state || {}, t = THEMES[1];
    var lines = s.lines == null ? [] : (Array.isArray(s.lines) ? s.lines : [String(s.lines)]);
    if (!lines.length) return;
    var px = 13, lh = 18, yLast = num(s.y, 698), maxW = 1200;
    if (yLast - (lines.length - 1) * lh - lh / 2 < 604) lh = Math.max(14, (yLast - 604 - 7) / Math.max(1, lines.length - 1));
    ctx.save();
    ctx.font = font(px, 'normal');
    var wMax = 0, i;
    for (i = 0; i < lines.length; i++) wMax = Math.max(wMax, ctx.measureText(String(lines[i])).width);
    if (wMax > maxW) { px = Math.max(10, Math.floor(px * maxW / wMax)); ctx.font = font(px, 'normal'); wMax = Math.min(wMax, maxW); }
    var top = yLast - (lines.length - 1) * lh - lh / 2 - 3, h = (lines.length - 1) * lh + lh + 6;
    roundRect(ctx, CX - wMax / 2 - 12, top, wMax + 24, h, 8); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
    for (i = 0; i < lines.length; i++) {
      text(ctx, String(lines[i]), CX, yLast - (lines.length - 1 - i) * lh, px, t.inkDim, 'center', { weight: 'normal' });
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 說明頁(第 1 關風格)
  function inGame(ctx, ox, oy, sc, fn) {
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.translate(-CX, -CY); fn(); ctx.restore();
  }
  function toScreen(ox, oy, sc, gx, gy) { return [ox + (gx - CX) * sc, oy + (gy - CY) * sc]; }
  function gPanel(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 16); ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
  }
  function drawCursor(ctx, x, y, s) {
    s = s || 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.lineTo(6, 16); ctx.lineTo(10, 25); ctx.lineTo(14, 23); ctx.lineTo(10, 15); ctx.lineTo(17, 15); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = '#111111'; ctx.stroke();
    ctx.restore();
  }
  function drawArrow(ctx, pts, opts) {
    opts = opts || {};
    var col = opts.color || '#ffffff', w = opts.width || 4;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.outline !== false) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = w + 3;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
    }
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
  // 步驟徽章: 白底大圓 + 深色數字 + 旁邊短詞(說明頁專用, 圖中最先被看到的東西)
  function stepBadge(ctx, x, y, n, label, side) {
    ctx.save();
    circle(ctx, x, y, 25); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    circle(ctx, x, y, 21); ctx.fillStyle = '#ffffff'; ctx.fill();
    text(ctx, String(n), x, y + 1, 28, '#14141c');
    var lx = side === 'left' ? x - 32 : x + 32;
    text(ctx, label, lx, y + 1, 24, '#ffffff', side === 'left' ? 'right' : 'left', { stroke: 'rgba(0,0,0,0.75)', strokeWidth: 6 });
    ctx.restore();
  }
  var GUIDE = [
    { title: '怎麼玩', text: '把氣泡染成正確的顏色後送進光門' },
    { title: '染錯會消失', text: '染到光門不要的顏色, 氣泡會消失' },
    { title: '抓著不會消失', text: '抓著氣泡時氣泡不會消失' },
    { title: '血量', text: '觸發和對上拍子能補回血量' }
  ];
  var GUIDE_PAGES = GUIDE.length;

  // 第 1 頁: 完整場面; 1 抓氣泡 → 2 拉去染色區(到達處已是色 A)→ 3 送進光門(碰到時指標仍按著, 打勾)
  function guidePage1(ctx) {
    var ox = 640, oy = 398, sc = 0.74;
    var B1 = [552, 440], B2 = [744, 306], B3 = [908, 326];
    inGame(ctx, ox, oy, sc, function () {
      drawArena(ctx, { level: 1 });
      drawDyeFloor(ctx, { level: 1, x: 761, y: 290, color: 'A' });
      drawDyeFloor(ctx, { level: 1, x: 519, y: 290, color: 'B' });
      drawNetWall(ctx, { level: 1, lit: { slot: 1, color: 'A' } });
      drawArrow(ctx, [[578, 426], [650, 380], [718, 322]], { width: 5, color: 'rgba(255,255,255,0.9)' });
      drawArrow(ctx, [[772, 304], [830, 300], [880, 318]], { width: 5, color: 'rgba(255,255,255,0.9)' });
      drawBubble(ctx, { level: 1, x: B1[0], y: B1[1], color: null, status: 'held', noLife: true });
      drawCursor(ctx, B1[0] + 3, B1[1] + 4, 1.35);
      drawBubble(ctx, { level: 1, x: B2[0], y: B2[1], color: 'A', status: 'dragging', noLife: true });
      drawCursor(ctx, B2[0] + 3, B2[1] + 4, 1.35);
      drawBubble(ctx, { level: 1, x: B3[0], y: B3[1], color: 'A', status: 'dragging', noLife: true });
      drawCursor(ctx, B3[0] + 3, B3[1] + 4, 1.35);
      drawCheck(ctx, 902, 262, 26, '#ffffff', 1);
    });
    var p1 = toScreen(ox, oy, sc, B1[0], B1[1]), p2 = toScreen(ox, oy, sc, 761, 290), p3 = toScreen(ox, oy, sc, B3[0], B3[1]);
    stepBadge(ctx, p1[0] - 6, p1[1] + 62, 1, '抓氣泡', 'right');
    stepBadge(ctx, p2[0] - 70, p2[1] - 62, 2, '拉去染色區', 'left');
    stepBadge(ctx, p3[0] + 6, p3[1] + 76, 3, '送進光門', 'right');
  }
  function wallScene(ctx, ox, oy, sc, litSlot, litColor, hp, fn) {
    inGame(ctx, ox, oy, sc, function () {
      drawArena(ctx, { level: 1 });
      if (hp) drawHpRing(ctx, { level: 1, hp: hp.hp, hpFx: hp.fx });
      drawNetWall(ctx, { level: 1, lit: litSlot ? { slot: litSlot, color: litColor } : null });
      if (fn) fn();
    });
  }
  // 第 2 頁: 同一道要色 A 的光門左右對照; 左: 擦過 A → 變 A, 血量環沒少; 右: 擦過 B → 原地消失, 血量環少一小段
  function guidePage2(ctx) {
    var cx = [330, 950];
    for (var i = 0; i < 2; i++) {
      var ok = i === 0;
      gPanel(ctx, cx[i] - 280, 150, 560, 488);
      (function (good) {
        wallScene(ctx, cx[i], 400, 0.68, 1, 'A', { hp: good ? 64 : 61, fx: good ? null : [{ from: 64, to: 61, kind: 'miss', t: 0.12 }] }, function () {
          drawDyeFloor(ctx, { level: 1, x: 619, y: 290, color: 'A' });
          drawDyeFloor(ctx, { level: 1, x: 619, y: 430, color: 'B' });
          if (good) {
            drawBubble(ctx, { level: 1, x: 470, y: 290, color: null, status: 'dragging', noLife: true });
            drawArrow(ctx, [[498, 290], [544, 290]], { width: 5, color: 'rgba(255,255,255,0.9)' });
            drawBubble(ctx, { level: 1, x: 579, y: 290, color: 'A', status: 'dragging', noLife: true });
            drawStickFx(ctx, { level: 1, x: 579, y: 290, kind: 'stick', attr: 'color', value: 'A', t: 0.16 });
            drawCursor(ctx, 583, 294, 1.5);
          } else {
            drawBubble(ctx, { level: 1, x: 470, y: 430, color: null, status: 'dragging', noLife: true });
            drawArrow(ctx, [[498, 430], [544, 430]], { width: 5, color: 'rgba(255,255,255,0.9)' });
            drawMissFx(ctx, { level: 1, x: 577, y: 430, color: 'B', t: 0.22 });
            drawCursor(ctx, 581, 434, 1.5);
          }
        });
      })(ok);
    }
  }
  // 第 3 頁: 三格時間序; 被按住的環一直滿(白), 另一顆 滿 → 少一大段 → 走完消失
  function guidePage3(ctx) {
    var t = THEMES[1], cx = [235, 640, 1045], other = [1, 0.4, 0];
    for (var i = 0; i < 3; i++) {
      gPanel(ctx, cx[i] - 175, 210, 350, 320);
      roundRect(ctx, cx[i] - 155, 230, 310, 280, 20); ctx.fillStyle = t.ground; ctx.fill();
      (function (k) {
        ctx.save(); ctx.translate(cx[k], 370); ctx.scale(2.6, 2.6);
        drawBubble(ctx, { level: 1, x: -28, y: 0, color: null, status: 'held', life: 1 });
        if (other[k] > 0) drawBubble(ctx, { level: 1, x: 28, y: 0, color: null, status: 'idle', life: other[k] });
        drawCursor(ctx, -26, 2, 0.5);
        ctx.restore();
      })(i);
      if (i < 2) drawArrow(ctx, [[cx[i] + 182, 370], [cx[i] + 222, 370]], { width: 5 });
    }
  }
  // 第 4 頁: 四格, 每格主角是血量環。1 自己往下掉(同一圈兩個時刻) 2 觸發 → 變長 3 對上拍子染上 → 變長 4 縮到空 → 結束畫面
  function guidePage4(ctx) {
    var t = THEMES[1], px = [40, 342, 644, 946], pw = 292;
    for (var i = 0; i < 4; i++) gPanel(ctx, px[i], 140, pw, 500);
    var c0 = px[0] + pw / 2;
    inGame(ctx, c0, 262, 0.42, function () { drawArena(ctx, { level: 1 }); drawHpRing(ctx, { level: 1, hp: 72 }); });
    drawArrow(ctx, [[c0, 370], [c0, 404]], { width: 5 });
    inGame(ctx, c0, 518, 0.42, function () { drawArena(ctx, { level: 1 }); drawHpRing(ctx, { level: 1, hp: 58 }); });
    var c1 = px[1] + pw / 2;
    ctx.save(); roundRect(ctx, px[1] + 2, 142, pw - 4, 496, 15); ctx.clip();
    inGame(ctx, c1 - 16, 390, 0.47, function () {
      drawArena(ctx, { level: 1 });
      drawHpRing(ctx, { level: 1, hp: 62, hpFx: [{ from: 56, to: 62, kind: 'catch', t: 0.1 }] });
      drawNetWall(ctx, { level: 1, lit: { slot: 1, color: 'A' } });
      drawArrow(ctx, [[800, 372], [872, 362]], { width: 8 });
      drawBubble(ctx, { level: 1, x: 908, y: 360, color: 'A', status: 'dragging', noLife: true });
      drawCursor(ctx, 912, 364, 2.2);
      drawCheck(ctx, 880, 280, 34, '#ffffff', 1);
    });
    ctx.restore();
    var c2 = px[2] + pw / 2;
    ctx.save(); roundRect(ctx, px[2] + 2, 142, pw - 4, 496, 15); ctx.clip();
    inGame(ctx, c2, 390, 0.62, function () {
      drawArena(ctx, { level: 1 });
      drawHpRing(ctx, { level: 1, hp: 60, hpFx: [{ from: 56, to: 60, kind: 'beat', t: 0.1 }] });
      drawBeatCue(ctx, { level: 1, phase: 0.02, beat: 0 });
      drawDyeFloor(ctx, { level: 1, x: 700, y: 360, color: 'A' });
      drawArrow(ctx, [[500, 384], [580, 372], [622, 364]], { width: 7, color: 'rgba(255,255,255,0.85)' });
      drawBubble(ctx, { level: 1, x: 658, y: 360, color: 'A', status: 'dragging', noLife: true });
      drawBeatFx(ctx, { level: 1, x: 658, y: 360, tier: 1, t: 0.08, onBubble: true });
      drawCursor(ctx, 662, 364, 1.7);
    });
    ctx.restore();
    var c3 = px[3] + pw / 2;
    inGame(ctx, c3, 262, 0.42, function () { drawArena(ctx, { level: 1 }); drawHpRing(ctx, { level: 1, hp: 0, danger: true, time: 0.33 }); });
    drawArrow(ctx, [[c3, 370], [c3, 404]], { width: 5 });
    endCard(ctx, t, c3 - 125, 430, 250, 87.3);
  }
  var GUIDE_FNS = [guidePage1, guidePage2, guidePage3, guidePage4];
  function drawGuidePage(ctx, state) {
    var s = state || {}, t = THEMES[1], g = LAYOUT.guide;
    var page = Math.max(1, Math.min(GUIDE_PAGES, Math.round(num(s.page, 1))));
    var info = GUIDE[page - 1];
    ctx.save();
    drawBackground(ctx, { level: 1 });
    overlay(ctx, 0.45);
    text(ctx, info.title, 40, 46, 20, t.inkDim, 'left');
    text(ctx, page + ' / ' + GUIDE_PAGES, 40, 80, 16, t.inkDim, 'left');
    text(ctx, info.text, CX, 92, 34, t.ink, 'center', { stroke: 'rgba(0,0,0,0.6)', strokeWidth: 6 });
    GUIDE_FNS[page - 1](ctx);
    drawButton(ctx, t, g.close, '關閉', s.hover === 'close');
    if (page > 1) drawButton(ctx, t, g.prev, '上一頁', s.hover === 'prev');
    if (page < GUIDE_PAGES) drawButton(ctx, t, g.next, '下一頁', s.hover === 'next', { primary: true });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 匯出
  var palette = {};
  [1, 2, 3].forEach(function (L) {
    var t = THEMES[L];
    palette[L] = {
      bgTop: t.bgTop, bgMid: t.bgMid, bgBottom: t.bgBottom, ground: t.ground, rim: t.rim,
      wallDim: t.wallDim, colorA: t.colors.A, colorB: t.colors.B, colorC: t.colors.C, colorD: t.colors.D,
      beat: t.beat, danger: t.danger, hp: t.hp, glass: t.glass, lifeRing: t.lifeRing, frozen: '#ffffff',
      ink: t.ink, inkDim: t.inkDim, shapeFloorBase: t.shapeFloorBase, shapeFloorGlyph: t.shapeFloorGlyph,
      capture: '#ffffff'
    };
  });

  window.Art = {
    canvas: { width: W, height: H },
    palette: palette,
    timing: TIMING,
    layout: LAYOUT,
    guidePages: GUIDE_PAGES,
    geometry: { gateInnerApothem: WALL_APO - GATE_WIDEN, hpRingRadius: HP_R, bubbleOuterRadius: RING_C + RING_TRACK / 2 },
    drawBackground: drawBackground,
    drawArena: drawArena,
    drawHpRing: drawHpRing,
    drawBeatCue: drawBeatCue,
    drawNetWall: drawNetWall,
    drawDyeFloor: drawDyeFloor,
    drawShapeFloor: drawShapeFloor,
    drawRotateCue: drawRotateCue,
    drawBatchCue: drawBatchCue,
    drawBubble: drawBubble,
    drawStickFx: drawStickFx,
    drawMissFx: drawMissFx,
    drawBeatFx: drawBeatFx,
    drawChainFx: drawChainFx,
    drawCountIn: drawCountIn,
    drawLevelIntro: drawLevelIntro,
    drawHud: drawHud,
    drawPauseButton: drawPauseButton,
    drawMuteButton: drawMuteButton,
    drawPauseMenu: drawPauseMenu,
    drawTitle: drawTitle,
    drawDeviceSelect: drawDeviceSelect,
    drawGameOver: drawGameOver,
    drawCredits: drawCredits,
    drawGuidePage: drawGuidePage
  };
})();
