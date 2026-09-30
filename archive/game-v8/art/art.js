// 捕泡手 美術(規格 v8, 管道版位): 全部 Canvas 2D 幾何繪製, 不引外部資源。
// 只負責「給狀態就畫」, 不含遊戲邏輯。規格與 state 欄位見 style.md。
(function () {
  'use strict';

  var W = 1280, H = 720;
  var FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";
  var TAU = Math.PI * 2;

  var P = {
    bg: '#10141f',          // 背景 = 內圈外區域(不可停放; 含中庭與牆後空地)
    ring: '#1d2536',        // 內圈地面
    ringEdge: '#6b7ea3',    // 內圈邊線
    bubble0: '#f4d03f',     // 黃(色 A)
    bubble1: '#36c275',     // 綠(色 B)
    bubble2: '#3a86ff',     // 藍(色 C)
    bubble3: '#8a3ccf',     // 紫(色 D)
    clear: '#dfe7f3',       // 「無色」: 透明氣泡外框、賦形區(不帶顏色的地塊)
    clearFill: 'rgba(190,210,240,0.14)', // 透明氣泡的玻璃填色
    shapeFloor: '#2b3550',  // 賦形區地面
    washFloor: '#2c151b',   // 洗除區地面
    netOff: '#4a5570',      // 未啟用的網(空槽)
    danger: '#ff4d4d',      // 危險 / 損失: 命、洗除區、快過期的壽命環、重開 / 放棄
    ok: '#ffffff',          // 打勾、回命光環、拖曳目標外圈、出場提示角框
    frozen: '#7fdcff',      // 只給「壽命凍結」: 被按住 / 拖曳中的壽命環
    text: '#eef2f8',
    textDim: '#8d99b0',
    panel: '#1a2130',
    panelEdge: '#3a4660',
    button: '#27314a',
    buttonHover: '#34405e',
    primary: '#e8edf5',
    primaryText: '#10141f',
    shadow: 'rgba(0,0,0,0.45)'
  };
  var COLORS = [P.bubble0, P.bubble1, P.bubble2, P.bubble3];

  var BUBBLE_R = 20, RING_R = 26, NET_R = 60, PAINT_R = 30, SHAPE_R = 30, WASH_R = 40;

  // ---------- 版位(座標全部照規格版位表) ----------
  var ZONES = [];
  function zone(id, kind, x, y, stage, extra) {
    var z = { id: id, kind: kind, x: x, y: y, r: kind === 'wash' ? WASH_R : (kind === 'paint' ? PAINT_R : SHAPE_R), stage: stage };
    if (extra) for (var k in extra) z[k] = extra[k];
    ZONES.push(z);
  }
  zone('染 A', 'paint', 330, 110, 1, { color: 0 });
  zone('染 B', 'paint', 330, 610, 1, { color: 1 });
  zone('染 C', 'paint', 570, 360, 3, { color: 2 });
  zone('染 D', 'paint', 658, 360, 4, { color: 3 });
  zone('賦形 方', 'shape', 900, 360, 5, { shape: 'square' });
  zone('賦形 三角', 'shape', 1113, 420, 6, { shape: 'triangle' });
  (function () {
    var w = [
      [780, 70, 2], [780, 175, 2], [780, 280, 2], [780, 440, 2], [780, 545, 2], [780, 650, 2],
      [702, 212, 2], [600, 221, 2], [702, 508, 2], [600, 499, 2],
      [1220, 160, 3], [1115, 190, 3], [1030, 250, 3], [1000, 340, 3], [1000, 500, 3], [1015, 600, 3], [1000, 680, 3],
      [1158, 550, 4], [1240, 515, 4]
    ];
    for (var i = 0; i < w.length; i++) zone('洗 ' + (i + 1), 'wash', w[i][0], w[i][1], w[i][2]);
  })();
  var ZONE_MAP = {};
  for (var zi = 0; zi < ZONES.length; zi++) ZONE_MAP[ZONES[zi].id] = ZONES[zi];

  var L = {
    canvas: { x: 0, y: 0, w: W, h: H },
    // 拖曳中氣泡中心的限制範圍(x 20~1260, y 20~700)
    dragBounds: { x: 20, y: 20, w: 1240, h: 680 },
    inner: { x: 330, y: 360, r: 160 },
    bubbleR: BUBBLE_R,
    netR: NET_R,
    paintR: PAINT_R,
    shapeR: SHAPE_R,
    washR: WASH_R,
    // 網 1~4; color = 該網條件的顏色(色號 0~3 = 色 A~D, 整局不變); stage = 啟用階段
    nets: [
      { id: 1, x: 900, y: 190, color: 0, stage: 1 },
      { id: 2, x: 900, y: 530, color: 1, stage: 1 },
      { id: 3, x: 1180, y: 300, color: 2, stage: 3 },
      { id: 4, x: 1195, y: 650, color: 3, stage: 4 }
    ],
    // 區域 25 塊: { id(規格名稱, 埋點共用), kind: 'paint'|'shape'|'wash', x, y, r, stage, color?, shape? }
    zones: ZONES,
    zoneById: ZONE_MAP,
    // 窄縫: sides 第一個為橫向偏移的正側(規格窄縫餘裕表「兩側」先列者)
    gaps: [
      { name: '出口窗', sides: ['洗 3', '洗 4'], stage: 2 },
      { name: '染 C 上縫', sides: ['染 C', '洗 8'], stage: 3 },
      { name: '染 C 下縫', sides: ['染 C', '洗 10'], stage: 3 },
      { name: '第二道窗', sides: ['洗 14', '洗 15'], stage: 3 },
      { name: '染 D 上縫', sides: ['染 D', '洗 3'], stage: 4 },
      { name: '染 D 下縫', sides: ['染 D', '洗 4'], stage: 4 },
      { name: '小袋口', sides: ['洗 16', '洗 18'], stage: 4 },
      { name: '方上縫', sides: ['賦形 方', '洗 3'], stage: 5 },
      { name: '方下縫', sides: ['賦形 方', '洗 4'], stage: 5 },
      { name: '三角上縫', sides: ['賦形 三角', '洗 14'], stage: 6 },
      { name: '三角下縫', sides: ['賦形 三角', '洗 15'], stage: 6 },
      { name: '三角側縫', sides: ['賦形 三角', '洗 18'], stage: 6 }
    ],
    hudLeft: { x: 20, y: 20, w: 240, h: 80 },
    hudRight: { x: 960, y: 20, w: 220, h: 80 },
    pauseButton: { x: 1206, y: 26, w: 48, h: 48 },
    // 階段切換預告條(純顯示, 不可點; 與任何區域、網、HUD 不重疊)
    stageNotice: { x: 400, y: 16, w: 320, h: 40 },
    pauseMenu: {
      panel: { x: 460, y: 140, w: 360, h: 440 },
      resume: { x: 500, y: 232, w: 280, h: 56 },
      restart: { x: 500, y: 304, w: 280, h: 56 },
      quit: { x: 500, y: 376, w: 280, h: 56 },
      help: { x: 500, y: 472, w: 280, h: 56 }
    },
    title: {
      start: { x: 500, y: 380, w: 280, h: 60 },
      help: { x: 500, y: 456, w: 280, h: 60 },
      device: { x: 500, y: 532, w: 280, h: 60 }
    },
    inputSelect: {
      mouse: { x: 380, y: 280, w: 240, h: 220 },
      touchpad: { x: 660, y: 280, w: 240, h: 220 }
    },
    end: {
      retry: { x: 390, y: 500, w: 240, h: 64 },
      toTitle: { x: 650, y: 500, w: 240, h: 64 }
    },
    guide: {
      pages: 6,
      close: { x: 1130, y: 24, w: 120, h: 48 },
      prev: { x: 40, y: 648, w: 160, h: 52 },
      next: { x: 1080, y: 648, w: 160, h: 52 }
    }
  };

  // ---------- 共用小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function font(size, bold) { return (bold ? 'bold ' : '') + size + 'px ' + FONT; }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // 圓角多邊形
  function polyRoundPath(ctx, pts, r) {
    var n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      ctx.arcTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2, r);
    }
    ctx.closePath();
  }

  // 形狀路徑: s = 名義半徑(氣泡為 20)。形狀只是外觀, 判定一律是半徑 20 的圓
  function shapePath(ctx, shape, x, y, s) {
    if (shape === 'square') {
      var h = s * 0.86;
      roundRectPath(ctx, x - h, y - h, h * 2, h * 2, s * 0.24);
    } else if (shape === 'triangle') {
      var R = s * 1.12, dy = R * 0.12, pts = [];
      for (var i = 0; i < 3; i++) {
        var a = -Math.PI / 2 + i * TAU / 3;
        pts.push({ x: x + Math.cos(a) * R, y: y + dy + Math.sin(a) * R });
      }
      polyRoundPath(ctx, pts, s * 0.2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
    }
  }

  // 形狀符號(網條件、賦形區): o { fill, stroke, lw, dash, alpha }
  function glyph(ctx, shape, x, y, s, o) {
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    shapePath(ctx, shape, x, y, s);
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
    if (o.stroke) {
      ctx.setLineDash(o.dash || []);
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.lw || 2;
      ctx.strokeStyle = o.stroke;
      ctx.stroke();
    }
    ctx.restore();
  }

  function textPlain(ctx, str, x, y, size, color, align, bold) {
    ctx.font = font(size, !!bold);
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panelBox(ctx, r, fill, edge) {
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fillStyle = fill || P.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = edge || P.panelEdge;
    ctx.stroke();
  }

  // kind: 'primary' | 'normal' | 'danger'
  function drawButton(ctx, r, label, hover, kind) {
    ctx.save();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
    var txt = P.text;
    if (kind === 'primary') {
      ctx.fillStyle = hover ? '#ffffff' : P.primary;
      ctx.fill();
      txt = P.primaryText;
    } else {
      ctx.fillStyle = hover ? P.buttonHover : P.button;
      ctx.fill();
      ctx.lineWidth = kind === 'danger' ? 2.5 : 2;
      ctx.strokeStyle = kind === 'danger' ? P.danger : (hover ? P.text : P.panelEdge);
      ctx.stroke();
      if (kind === 'danger') txt = '#ffb8b8';
    }
    textPlain(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, Math.min(26, Math.round(r.h * 0.42)), txt, 'center', true);
    ctx.restore();
  }

  function drawCheck(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.45, y + s * 0.02);
    ctx.lineTo(x - s * 0.12, y + s * 0.35);
    ctx.lineTo(x + s * 0.5, y - s * 0.38);
    ctx.lineWidth = s * 0.3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();
    ctx.lineWidth = s * 0.18;
    ctx.strokeStyle = P.ok;
    ctx.stroke();
    ctx.restore();
  }

  // 說明頁用: 滑鼠指標, 尖端在 (x, y)
  function drawCursor(ctx, x, y, size) {
    var k = (size || 22) / 20;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(8, 20);
    ctx.lineTo(10.5, 19); ctx.lineTo(7, 12.2); ctx.lineTo(12.5, 12.2); ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.restore();
  }

  // 箭頭: opt { dash, color, width, cx, cy(二次曲線控制點) }
  function drawArrow(ctx, x1, y1, x2, y2, opt) {
    opt = opt || {};
    var col = opt.color || 'rgba(255,255,255,0.85)';
    var w = opt.width || 3;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    if (opt.dash) ctx.setLineDash(opt.dash);
    var hl = w * 3.5;
    var ax, ay;
    if (opt.cx != null) { ax = opt.cx; ay = opt.cy; } else { ax = x1; ay = y1; }
    var ang = Math.atan2(y2 - ay, x2 - ax);
    var ex = x2 - Math.cos(ang) * hl * 0.8, ey = y2 - Math.sin(ang) * hl * 0.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (opt.cx != null) ctx.quadraticCurveTo(opt.cx, opt.cy, ex, ey); else ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.45) * hl, y2 - Math.sin(ang - 0.45) * hl);
    ctx.lineTo(x2 - Math.cos(ang + 0.45) * hl, y2 - Math.sin(ang + 0.45) * hl);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 打勾貼在網的右上緣, 不蓋住網中央的條件
  function netMark(ctx, x, y, alpha) {
    var mx = x + NET_R * 0.72, my = y - NET_R * 0.72;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(mx, my, 20, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,20,0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.ok;
    ctx.stroke();
    ctx.restore();
    drawCheck(ctx, mx, my + 1, 28, alpha);
  }

  // 說明頁用: 氣泡過期消失
  function drawPop(ctx, x, y, color) {
    ctx.save();
    ctx.strokeStyle = color == null ? P.clear : COLORS[color];
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * TAU + 0.2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
      ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24);
      ctx.stroke();
    }
    ctx.restore();
  }

  function heartPath(ctx, x, y, s) {
    var h = s / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.85);
    ctx.bezierCurveTo(x - h * 1.3, y - h * 0.1, x - h * 0.75, y - h * 1.15, x, y - h * 0.45);
    ctx.bezierCurveTo(x + h * 0.75, y - h * 1.15, x + h * 1.3, y - h * 0.1, x, y + h * 0.85);
    ctx.closePath();
  }

  // 命: 實心紅心 = 還在, 空心 = 已失去
  // flash 0~1 標出剛失去的那一格(紅框放大); gain 0~1 標出剛加回的那一格(放大 + 白環外擴)
  function drawHearts(ctx, x, y, hp, max, size, flash, gain) {
    ctx.save();
    var gap = size * 1.3;
    for (var i = 0; i < max; i++) {
      var cx = x + size / 2 + i * gap, cy = y;
      var justLost = flash > 0 && i === hp;
      var justGained = gain > 0 && i === hp - 1;
      if (i < hp) {
        var kg = justGained ? 1 + gain * 0.35 : 1;
        if (justGained) {
          ctx.beginPath();
          ctx.arc(cx, cy, size * 0.62 + (1 - gain) * 10, 0, TAU);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(255,255,255,' + gain + ')';
          ctx.stroke();
        }
        heartPath(ctx, cx, cy, size * kg);
        ctx.fillStyle = P.danger;
        ctx.fill();
        ctx.lineWidth = justGained ? 2.5 : 1.5;
        ctx.strokeStyle = justGained ? 'rgba(255,255,255,' + (0.4 + gain * 0.6) + ')' : 'rgba(0,0,0,0.5)';
        ctx.stroke();
      } else {
        var k = justLost ? 1 + flash * 0.35 : 1;
        heartPath(ctx, cx, cy, size * k);
        ctx.lineWidth = justLost ? 3 : 2;
        ctx.strokeStyle = justLost ? P.danger : 'rgba(141,153,176,0.6)';
        ctx.stroke();
        if (justLost) {
          ctx.globalAlpha = flash * 0.45;
          ctx.fillStyle = P.danger;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  function drawPauseIcon(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - s * 0.35, cy - s * 0.4, s * 0.25, s * 0.8);
    ctx.fillRect(cx + s * 0.1, cy - s * 0.4, s * 0.25, s * 0.8);
  }

  // 左上 HUD 區塊(命 + 存活時間), 左上角在 (x, y)
  function hudLeft(ctx, x, y, s) {
    var r = { x: x, y: y, w: L.hudLeft.w, h: L.hudLeft.h };
    panelBox(ctx, r, 'rgba(26,33,48,0.9)');
    textPlain(ctx, '命', x + 16, y + 27, 14, P.textDim, 'left', false);
    drawHearts(ctx, x + 42, y + 26, s.hp == null ? 4 : s.hp, s.hpMax || 4, 26, s.hpFlash || 0, s.hpGainFx || 0);
    var t = (s.time || 0).toFixed(1) + ' 秒';
    textPlain(ctx, t, x + 16, y + 60, 24, s.paused ? P.textDim : P.text, 'left', true);
    if (s.paused) drawPauseIcon(ctx, x + r.w - 26, y + 60, 18, P.textDim);
  }

  // 預告中: 虛線外框 + 由中心長大的填色, 填滿的那一刻 = 生效。
  // 不用半透明: 半透明在遊戲內只代表「彈回中」
  function previewDisc(ctx, x, y, r, t, fillFn, rimColor) {
    t = clamp01(t);
    if (t > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * t, 0, TAU);
      ctx.clip();
      fillFn();
      ctx.restore();
    }
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rimColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 出場提示: 四個白色角框(與氣泡、網的所有圓環不同形), t 0→1(建議 2 秒)
  function introMarks(ctx, x, y, r, t) {
    if (t == null || t <= 0 || t >= 1) return;
    var a = t < 0.08 ? t / 0.08 : (t > 0.8 ? (1 - t) / 0.2 : 1);
    var snap = t < 0.15 ? (1 - t / 0.15) : 0;
    var h = (r + 9 + snap * 18) * (1 + 0.05 * Math.sin(t * TAU * 3));
    var len = Math.max(8, h * 0.36);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sy = -1; sy <= 1; sy += 2) {
        ctx.moveTo(x + sx * h, y + sy * (h - len));
        ctx.lineTo(x + sx * h, y + sy * h);
        ctx.lineTo(x + sx * (h - len), y + sy * h);
      }
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.ok;
    ctx.stroke();
    ctx.restore();
  }

  // 水滴(染色區符號), 尖端朝上, h = 半高
  function dropPath(ctx, x, y, h) {
    var w = h * 0.72;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.bezierCurveTo(x + w * 0.35, y - h * 0.45, x + w, y - h * 0.05, x + w, y + h * 0.35);
    ctx.arc(x, y + h * 0.35, w, 0, Math.PI, false);
    ctx.bezierCurveTo(x - w, y - h * 0.05, x - w * 0.35, y - h * 0.45, x, y - h);
    ctx.closePath();
  }

  function washStripes(ctx, x, y, r, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = P.washFloor;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = P.danger;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (var d = -2 * r; d <= 2 * r; d += 13) {
      ctx.moveTo(x + d - r, y + r);
      ctx.lineTo(x + d + r, y - r);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 網中央的形狀條件: 深色底盤 + 網色實心形狀 + 白框; preview = 虛線白框 + 長大中的填色
  function netGlyph(ctx, x, y, shape, col, plateR, s, preview, t) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, plateR, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,20,0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = col;
    ctx.stroke();
    if (!preview) {
      glyph(ctx, shape, x, y, s, { fill: col, stroke: '#ffffff', lw: 2.5 });
    } else {
      t = clamp01(t || 0);
      if (t > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, s * 1.3 * t, 0, TAU);
        ctx.clip();
        glyph(ctx, shape, x, y, s, { fill: col });
        ctx.restore();
      }
      glyph(ctx, shape, x, y, s, { stroke: '#ffffff', lw: 2, dash: [4, 3] });
    }
    ctx.restore();
  }

  // 說明頁示意: 把遊戲座標 view 映射到畫面 rect 裡, 用遊戲內畫法畫
  function guideScene(ctx, rect, view, fn) {
    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fillStyle = P.bg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    var s = Math.min(rect.w / view.w, rect.h / view.h);
    var ox = rect.x + (rect.w - view.w * s) / 2 - view.x * s;
    var oy = rect.y + (rect.h - view.h * s) / 2 - view.y * s;
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    fn();
    ctx.restore();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.panelEdge;
    ctx.stroke();
    ctx.restore();
  }

  function bigBubble(ctx, x, y, k, st) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    st.x = 0; st.y = 0;
    Art.drawBubble(ctx, st);
    ctx.restore();
  }

  // ---------- 匯出 ----------
  var Art = {
    canvas: { width: W, height: H },
    palette: P,
    bubbleColors: COLORS,
    layout: L,

    drawBackground: function (ctx) {
      ctx.save();
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    },

    // state 可省略
    drawInnerRing: function (ctx, state) {
      var c = L.inner;
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, TAU);
      ctx.fillStyle = P.ring;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.ringEdge;
      ctx.stroke();
      ctx.restore();
    },

    // state: { x, y, color, status: 'preview'|'on', previewT, introT }
    drawPaintZone: function (ctx, s) {
      var col = COLORS[s.color] || '#ffffff';
      var x = s.x, y = s.y, r = PAINT_R;
      ctx.save();
      if (s.status === 'preview') {
        previewDisc(ctx, x, y, r, s.previewT || 0, function () {
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = col;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }, col);
        dropPath(ctx, x, y + 1, 13);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.stroke();
      } else {
        // 平的色池: 半飽和地面 + 實線色框 + 中央水滴符號(= 染色); 沒有高光與壽命環(那是氣泡)
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = col;
        ctx.stroke();
        dropPath(ctx, x, y + 1, 13);
        ctx.fillStyle = 'rgba(16,20,31,0.55)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
        introMarks(ctx, x, y, r, s.introT);
      }
      ctx.restore();
    },

    // state: { x, y, shape: 'square'|'triangle', status: 'preview'|'on', previewT, introT }
    drawShapeZone: function (ctx, s) {
      var x = s.x, y = s.y, r = SHAPE_R, shape = s.shape || 'square';
      ctx.save();
      if (s.status === 'preview') {
        previewDisc(ctx, x, y, r, s.previewT || 0, function () {
          ctx.fillStyle = P.shapeFloor;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }, P.clear);
        glyph(ctx, shape, x, y, 15, { stroke: P.clear, lw: 2, dash: [4, 3], alpha: 0.7 });
      } else {
        // 無色地塊(中性灰白框)+ 中央空心形狀 = 「擦過變成這個形」
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = P.shapeFloor;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.clear;
        ctx.stroke();
        glyph(ctx, shape, x, y, 15, { stroke: P.clear, lw: 3 });
        introMarks(ctx, x, y, r, s.introT);
      }
      ctx.restore();
    },

    // state: { x, y, status: 'preview'|'on', previewT, introT }
    drawWashZone: function (ctx, s) {
      var x = s.x, y = s.y, r = WASH_R;
      ctx.save();
      if (s.status === 'preview') {
        previewDisc(ctx, x, y, r, s.previewT || 0, function () {
          washStripes(ctx, x, y, r, 0.3);
        }, 'rgba(255,77,77,0.85)');
      } else {
        // 警示帶: 深酒紅地面 + 同方向紅斜紋 + 紅框; 一排排起來斜紋連成一道牆
        washStripes(ctx, x, y, r, 0.3);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,77,77,0.62)';
        ctx.stroke();
        introMarks(ctx, x, y, r, s.introT);
      }
      ctx.restore();
    },

    // state: { x, y, color, shape, nextShape, status: 'off'|'preview'|'on', previewT, introT, hot, flash, flashT }
    drawNet: function (ctx, s) {
      var col = COLORS[s.color] || '#ffffff';
      var x = s.x, y = s.y, r = NET_R;
      var status = s.status || 'on';
      var i;
      ctx.save();
      if (status === 'off' || status === 'preview') {
        // 空槽: 灰色虛線圈, 沒有網格、沒有顏色 = 不收氣泡
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(74,85,112,0.08)';
        ctx.fill();
        if (status === 'off') {
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.strokeStyle = P.netOff;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          previewDisc(ctx, x, y, r, s.previewT || 0, function () {
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = col;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }, col);
          if (s.shape) netGlyph(ctx, x, y, s.shape, col, 28, 17, true, s.previewT);
        }
        ctx.restore();
        return;
      }
      // 啟用中: 淡色底 + 網格 + 5px 色框(網的顏色 = 顏色條件)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r - 2, 0, TAU);
      ctx.clip();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (i = -r; i <= r; i += 12) {
        ctx.moveTo(x + i, y - r); ctx.lineTo(x + i, y + r);
        ctx.moveTo(x - r, y + i); ctx.lineTo(x + r, y + i);
      }
      ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();

      // 形狀條件: 只畫網有列的項目; 只要顏色時中央不放任何符號
      var ns = s.nextShape && s.nextShape !== s.shape ? s.nextShape : null;
      if (s.shape && ns) {
        netGlyph(ctx, x - 22, y, s.shape, col, 20, 12, false);
        ctx.save();
        ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 5); ctx.lineTo(x + 2, y); ctx.lineTo(x - 3, y + 5);
        ctx.stroke();
        ctx.restore();
        netGlyph(ctx, x + 23, y, ns, col, 20, 12, true, s.previewT);
      } else if (s.shape) {
        netGlyph(ctx, x, y, s.shape, col, 28, 17, false);
      } else if (ns) {
        netGlyph(ctx, x, y, ns, col, 28, 17, true, s.previewT);
      }

      if (s.hot) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, TAU);
        ctx.stroke();
      }

      if (s.flash && (s.flashT == null || s.flashT < 1)) {
        var t = clamp01(s.flashT || 0), a = 1 - t;
        ctx.globalAlpha = a;
        ctx.lineWidth = 4;
        if (s.flash === 'catch') {
          ctx.strokeStyle = P.ok;
          ctx.beginPath(); ctx.arc(x, y, r + 4 + t * 22, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          netMark(ctx, x, y, a);
        } else {
          // 'bounce'(條件不符彈回; 舊值 'wrong' 視同 bounce): 白色虛線環、無符號 = 沒扣命
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath(); ctx.arc(x, y, r + 4 + t * 10, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
      }
      introMarks(ctx, x, y, r, s.introT);
      ctx.restore();
    },

    // state: { x, y, color: null|0~3, shape: 'circle'|'square'|'triangle', life, lifeMax,
    //          mode: 'idle'|'hold'|'drag'|'return', swipeFx, swipeKind: 'paint'|'shape'|'wash' }
    drawBubble: function (ctx, s) {
      var R = BUBBLE_R;
      var clear = s.color == null || s.color < 0 || !COLORS[s.color];
      var col = clear ? null : COLORS[s.color];
      var shape = s.shape || 'circle';
      var mode = s.mode || 'idle';
      var max = s.lifeMax || 12;
      var life = Math.max(0, s.life == null ? max : s.life);
      var frac = clamp01(life / max);
      var urgent = life <= 3;
      var frozen = mode === 'hold' || mode === 'drag';
      ctx.save();
      ctx.translate(s.x, s.y);
      if (mode === 'drag') {
        ctx.beginPath();
        ctx.ellipse(3, 12, 20, 8, 0, 0, TAU);
        ctx.fillStyle = P.shadow;
        ctx.fill();
        ctx.scale(1.15, 1.15);
        ctx.translate(0, -3);
      } else if (mode === 'hold') {
        ctx.scale(1.06, 1.06);
      } else if (mode === 'return') {
        ctx.globalAlpha = 0.45;
      }
      // 壽命環: 12 秒總剩餘比例(氣泡上沒有數字, 環畫總量); 凍結時冰藍, 剩 3 秒內紅
      ctx.beginPath();
      ctx.arc(0, 0, RING_R, 0, TAU);
      ctx.lineWidth = frozen ? 5 : 4.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      if (frac > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, RING_R, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
        if (frozen) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = P.frozen;
        } else {
          ctx.lineWidth = urgent ? 4.5 : 3;
          ctx.strokeStyle = urgent ? P.danger : 'rgba(255,255,255,0.85)';
        }
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      // 本體: 有色 = 實心; 透明 = 空心玻璃(淡填 + 灰白框), 一眼看出「還沒沾色」
      shapePath(ctx, shape, 0, 0, R);
      if (col) {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(16,20,31,0.55)';
        ctx.fill();
        ctx.fillStyle = P.clearFill;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = P.clear;
        ctx.stroke();
      }
      ctx.save();
      shapePath(ctx, shape, 0, 0, R);
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(-7, -8, 6.5, 3.5, -0.6, 0, TAU);
      ctx.fillStyle = clear ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.4)';
      ctx.fill();
      ctx.restore();
      // 擦過回饋: 染色 = 新色環外擴; 賦形 = 灰白環外擴; 洗除 = 紅虛線環外擴(損失)
      var fx = clamp01(s.swipeFx || 0);
      if (fx > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, RING_R + 3 + (1 - fx) * 16, 0, TAU);
        ctx.lineWidth = 3;
        ctx.globalAlpha = fx;
        if (s.swipeKind === 'wash') {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = P.danger;
        } else if (s.swipeKind === 'shape') {
          ctx.strokeStyle = P.clear;
        } else {
          ctx.strokeStyle = col || P.clear;
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },

    // state: { hp, hpMax, time, paused, score, combo, hpFlash, hpGainFx }
    drawHud: function (ctx, s) {
      s = s || {};
      ctx.save();
      hudLeft(ctx, L.hudLeft.x, L.hudLeft.y, s);
      var r = L.hudRight;
      panelBox(ctx, r, 'rgba(26,33,48,0.9)');
      textPlain(ctx, '分數', r.x + 16, r.y + 26, 14, P.textDim, 'left', false);
      textPlain(ctx, String(Math.round(s.score || 0)), r.x + r.w - 16, r.y + 28, 30, P.text, 'right', true);
      if ((s.combo || 0) > 0) {
        textPlain(ctx, '連續', r.x + 16, r.y + 60, 14, P.textDim, 'left', false);
        textPlain(ctx, String(s.combo), r.x + r.w - 16, r.y + 60, 22, P.text, 'right', true);
      }
      ctx.restore();
    },

    // 階段切換預告條, 只在預告期間呼叫。state: { t: 0→1(預告 2 秒的進度) }
    drawStageNotice: function (ctx, s) {
      s = s || {};
      var r = L.stageNotice, t = clamp01(s.t || 0);
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fillStyle = 'rgba(26,33,48,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.panelEdge;
      ctx.stroke();
      textPlain(ctx, '場地即將改變', r.x + r.w / 2, r.y + 15, 16, P.text, 'center', true);
      var bx = r.x + 40, bw = r.w - 80, by = r.y + 28;
      roundRectPath(ctx, bx, by, bw, 5, 2.5);
      ctx.fillStyle = 'rgba(141,153,176,0.35)';
      ctx.fill();
      if (t > 0) {
        roundRectPath(ctx, bx, by, Math.max(5, bw * t), 5, 2.5);
        ctx.fillStyle = P.text;
        ctx.fill();
      }
      ctx.restore();
    },

    // state: { hover }
    drawPauseButton: function (ctx, s) {
      s = s || {};
      var r = L.pauseButton;
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fillStyle = s.hover ? P.buttonHover : P.button;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = s.hover ? P.text : P.panelEdge;
      ctx.stroke();
      drawPauseIcon(ctx, r.x + r.w / 2, r.y + 16, 16, P.text);
      textPlain(ctx, '暫停', r.x + r.w / 2, r.y + r.h - 12, 14, P.text, 'center', true);
      ctx.restore();
    },

    // state: { hover: 'resume'|'restart'|'quit'|'help'|null }
    drawPauseMenu: function (ctx, s) {
      s = s || {};
      var m = L.pauseMenu;
      ctx.save();
      ctx.fillStyle = 'rgba(5,7,12,0.7)';
      ctx.fillRect(0, 0, W, H);
      panelBox(ctx, m.panel);
      textPlain(ctx, '暫停', W / 2, m.panel.y + 46, 32, P.text, 'center', true);
      drawButton(ctx, m.resume, '繼續', s.hover === 'resume', 'primary');
      drawButton(ctx, m.restart, '重開', s.hover === 'restart', 'danger');
      drawButton(ctx, m.quit, '放棄', s.hover === 'quit', 'danger');
      drawButton(ctx, m.help, '說明', s.hover === 'help', 'normal');
      ctx.restore();
    },

    // state: { hover: 'start'|'help'|'device'|null, device: null|'mouse'|'touchpad' }
    drawTitleScreen: function (ctx, s) {
      s = s || {};
      var t = L.title;
      ctx.save();
      Art.drawBackground(ctx);
      textPlain(ctx, '捕泡手', W / 2, 190, 76, P.text, 'center', true);
      var deco = [
        { color: null, shape: 'circle' }, { color: 0, shape: 'circle' },
        { color: 1, shape: 'square' }, { color: 2, shape: 'triangle' }
      ];
      for (var i = 0; i < 4; i++) {
        bigBubble(ctx, W / 2 - 150 + i * 100, 295, 1.5, { color: deco[i].color, shape: deco[i].shape, life: 12 });
      }
      drawButton(ctx, t.start, '開始', s.hover === 'start', 'primary');
      drawButton(ctx, t.help, '說明', s.hover === 'help', 'normal');
      var dev = s.device === 'mouse' ? '輸入裝置: 滑鼠' : (s.device === 'touchpad' ? '輸入裝置: 觸控板' : '輸入裝置');
      drawButton(ctx, t.device, dev, s.hover === 'device', 'normal');
      ctx.restore();
    },

    // state: { selected: null|'mouse'|'touchpad', hover: 'mouse'|'touchpad'|null }
    drawInputSelect: function (ctx, s) {
      s = s || {};
      var q = L.inputSelect;
      ctx.save();
      Art.drawBackground(ctx);
      textPlain(ctx, '你用什麼操作?', W / 2, 190, 36, P.text, 'center', true);
      var items = [['mouse', '滑鼠'], ['touchpad', '觸控板']];
      for (var i = 0; i < 2; i++) {
        var key = items[i][0], r = q[key];
        var sel = s.selected === key, hov = s.hover === key;
        roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
        ctx.fillStyle = hov ? P.buttonHover : P.button;
        ctx.fill();
        ctx.lineWidth = sel ? 4 : 2;
        ctx.strokeStyle = sel ? '#ffffff' : (hov ? P.text : P.panelEdge);
        ctx.stroke();
        var cx = r.x + r.w / 2, cy = r.y + 88;
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.text;
        if (key === 'mouse') {
          roundRectPath(ctx, cx - 30, cy - 46, 60, 92, 28);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy - 46); ctx.lineTo(cx, cy - 12);
          ctx.moveTo(cx - 30, cy - 12); ctx.lineTo(cx + 30, cy - 12);
          ctx.stroke();
        } else {
          roundRectPath(ctx, cx - 58, cy - 40, 116, 80, 10);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - 58, cy + 20); ctx.lineTo(cx + 58, cy + 20);
          ctx.moveTo(cx, cy + 20); ctx.lineTo(cx, cy + 40);
          ctx.stroke();
        }
        textPlain(ctx, items[i][1], cx, r.y + r.h - 40, 28, P.text, 'center', true);
        if (sel) drawCheck(ctx, r.x + r.w - 28, r.y + 28, 26, 1);
      }
      ctx.restore();
    },

    // state: { time, score, note, hover: 'retry'|'toTitle'|null }
    drawEndScreen: function (ctx, s) {
      s = s || {};
      var e = L.end;
      ctx.save();
      Art.drawBackground(ctx);
      textPlain(ctx, '結束', W / 2, 150, 56, P.text, 'center', true);
      var cards = [
        { x: 390, label: '存活時間', value: (s.time || 0).toFixed(1) + ' 秒' },
        { x: 650, label: '分數', value: String(Math.round(s.score || 0)) }
      ];
      for (var i = 0; i < 2; i++) {
        var c = cards[i];
        panelBox(ctx, { x: c.x, y: 250, w: 240, h: 170 });
        textPlain(ctx, c.label, c.x + 120, 292, 22, P.textDim, 'center', false);
        textPlain(ctx, c.value, c.x + 120, 360, 44, P.text, 'center', true);
      }
      if (s.note) textPlain(ctx, String(s.note), W / 2, 460, 18, P.textDim, 'center', false);
      drawButton(ctx, e.retry, '再玩一次', s.hover === 'retry', 'primary');
      drawButton(ctx, e.toTitle, '回標題', s.hover === 'toTitle', 'normal');
      ctx.restore();
    },

    // state: { page: 1~6, hover: 'close'|'prev'|'next'|null }
    drawGuidePage: function (ctx, s) {
      s = s || {};
      var n = GUIDE.length;
      var page = Math.max(1, Math.min(n, s.page || 1));
      var g = L.guide;
      var info = GUIDE[page - 1];
      ctx.save();
      Art.drawBackground(ctx);
      textPlain(ctx, info.title, W / 2, 56, 34, P.text, 'center', true);
      textPlain(ctx, info.text, W / 2, 108, 26, P.text, 'center', false);
      info.draw(ctx);
      drawButton(ctx, g.close, '關閉', s.hover === 'close', 'normal');
      if (page > 1) drawButton(ctx, g.prev, '上一頁', s.hover === 'prev', 'normal');
      if (page < n) drawButton(ctx, g.next, '下一頁', s.hover === 'next', 'primary');
      textPlain(ctx, page + ' / ' + n, W / 2, 674, 20, P.textDim, 'center', false);
      ctx.restore();
    }
  };

  // ---------- 說明頁內容 ----------
  // 說明第 2、5 頁的示意網: 放在內圈旁(示意位置, 不是遊戲內版位), 要色 A、不帶形狀
  var GNET = { x: 610, y: 300 };
  var NET_VIEW = { x: 370, y: 190, w: 320, h: 340 };
  function guideNet(ctx, o) {
    var st = { x: GNET.x, y: GNET.y, color: 0, status: 'on' };
    if (o) for (var k in o) st[k] = o[k];
    Art.drawNet(ctx, st);
  }

  // 說明頁用的左上 HUD 縮影: 與遊戲內同一個畫法, 只畫命那一列
  function smallHudBox(ctx, x, y, hp, flash, gain) {
    var r = { x: x, y: y, w: 176, h: 48 };
    panelBox(ctx, r, 'rgba(26,33,48,0.9)');
    textPlain(ctx, '命', x + 14, y + 25, 14, P.textDim, 'left', false);
    drawHearts(ctx, x + 38, y + 24, hp, 4, 24, flash || 0, gain || 0);
  }

  function inset(p, d) { return { x: p.x + d, y: p.y + d, w: p.w - d * 2, h: p.h - d * 2 }; }
  function belowHud(p) { return { x: p.x + 16, y: p.y + 76, w: p.w - 32, h: p.h - 92 }; }

  var TIME_ARROW = { width: 3, color: 'rgba(141,153,176,0.9)', dash: [8, 8] };

  var THREE = [
    { x: 60, y: 170, w: 360, h: 430 },
    { x: 460, y: 170, w: 360, h: 430 },
    { x: 860, y: 170, w: 360, h: 430 }
  ];

  var GUIDE = [
    {
      // 第 1 頁: 實際位置的內圈與染 A; 透明氣泡從內圈拖出, 箭頭只到擦過染 A 為止
      title: '沾色', text: '拖著擦過染色區就沾色',
      draw: function (ctx) {
        var p = { x: 190, y: 140, w: 900, h: 490 };
        panelBox(ctx, p);
        guideScene(ctx, inset(p, 10), { x: 110, y: 50, w: 440, h: 480 }, function () {
          Art.drawInnerRing(ctx);
          Art.drawPaintZone(ctx, { x: 330, y: 110, color: 0, status: 'on' });
          Art.drawBubble(ctx, { x: 300, y: 268, color: null, shape: 'circle', life: 12, mode: 'idle' });
          // 擦過之後的氣泡只壓住染 A 的右下緣(兩圓相交), 染 A 本體仍看得到
          drawArrow(ctx, 306, 242, 346, 158, { dash: [10, 8], width: 4, cx: 312, cy: 186 });
          Art.drawBubble(ctx, { x: 374, y: 142, color: 0, shape: 'circle', life: 12, mode: 'drag', swipeFx: 0.5, swipeKind: 'paint' });
          drawCursor(ctx, 386, 154, 26);
        });
      }
    },
    {
      // 第 2 頁: 同一張色 A 網; 左 色 A 收下打勾; 右 前後對照, 透明氣泡放上去 → 回到內圈, 命前後都 3 格
      title: '送進網', text: '顏色對上網才收得下',
      draw: function (ctx) {
        var PL = { x: 40, y: 150, w: 560, h: 480 };
        var PA = { x: 640, y: 150, w: 275, h: 480 }, PB = { x: 955, y: 150, w: 275, h: 480 };
        panelBox(ctx, PL);
        guideScene(ctx, inset(PL, 12), NET_VIEW, function () {
          Art.drawInnerRing(ctx);
          guideNet(ctx, { hot: true });
          Art.drawBubble(ctx, { x: 600, y: 318, color: 0, life: 9, mode: 'drag' });
          drawCursor(ctx, 614, 334, 26);
          netMark(ctx, GNET.x, GNET.y, 1);
        });
        panelBox(ctx, PA);
        smallHudBox(ctx, PA.x + 14, PA.y + 14, 3);
        guideScene(ctx, belowHud(PA), NET_VIEW, function () {
          Art.drawInnerRing(ctx);
          guideNet(ctx, { hot: true });
          bigBubble(ctx, 600, 318, 1.3, { color: null, life: 9, mode: 'drag' });
          drawCursor(ctx, 618, 338, 32);
        });
        drawArrow(ctx, PA.x + PA.w + 6, 400, PB.x - 6, 400, { width: 4 });
        panelBox(ctx, PB);
        smallHudBox(ctx, PB.x + 14, PB.y + 14, 3);
        guideScene(ctx, belowHud(PB), NET_VIEW, function () {
          Art.drawInnerRing(ctx);
          guideNet(ctx, { flash: 'bounce', flashT: 0.35 });
          drawArrow(ctx, 566, 352, 462, 380, { width: 4, cx: 530, cy: 430 });
          bigBubble(ctx, 428, 372, 1.3, { color: null, life: 8.8, mode: 'idle' });
        });
      }
    },
    {
      // 第 3 頁: 三格時間序; 兩顆環都從滿開始, 按住的那顆一直滿, 另一顆 12 → 9 → 6。無標注、無 HUD、無網與區域
      title: '抓著時環不走', text: '抓著時, 氣泡上的環停住不走',
      draw: function (ctx) {
        var others = [12, 9, 6];
        for (var i = 0; i < 3; i++) {
          var p = THREE[i];
          panelBox(ctx, p);
          (function (life) {
            guideScene(ctx, inset(p, 16), { x: 245, y: 300, w: 230, h: 120 }, function () {
              Art.drawInnerRing(ctx);
              bigBubble(ctx, 300, 360, 1.4, { color: 1, life: 12, mode: 'hold' });
              drawCursor(ctx, 312, 374, 26);
              bigBubble(ctx, 412, 360, 1.4, { color: 1, life: life, mode: 'idle' });
            });
          })(others[i]);
          if (i < 2) drawArrow(ctx, p.x + p.w + 6, 385, p.x + p.w + 34, 385, TIME_ARROW);
        }
      }
    },
    {
      // 第 4 頁: 第一道牆的一段(洗 1~6, 洗 3 與洗 4 之間有空隙); 色 A 氣泡擦過洗 5 變回透明。
      // 箭頭只畫擦過洗 5 那一小段, 不從空隙過; 無網與染色區
      title: '洗除區', text: '有些地塊擦到會洗掉顏色',
      draw: function (ctx) {
        var p = { x: 190, y: 140, w: 900, h: 490 };
        panelBox(ctx, p);
        guideScene(ctx, inset(p, 10), { x: 600, y: 120, w: 360, h: 480 }, function () {
          for (var i = 1; i <= 6; i++) {
            var z = ZONE_MAP['洗 ' + i];
            Art.drawWashZone(ctx, { x: z.x, y: z.y, status: 'on' });
          }
          bigBubble(ctx, 686, 545, 1.15, { color: 0, life: 10, mode: 'drag' });
          drawArrow(ctx, 716, 545, 846, 545, { dash: [10, 8], width: 4 });
          bigBubble(ctx, 878, 545, 1.15, { color: null, life: 10, mode: 'drag', swipeFx: 0.5, swipeKind: 'wash' });
          drawCursor(ctx, 892, 560, 28);
        });
      }
    },
    {
      // 第 5 頁: 左 色 A 進色 A 網打勾, 命 3 → 4; 右 環走完消失, 命 4 → 3
      title: '命的增減', text: '收下回命, 環走完扣命',
      draw: function (ctx) {
        var PL = { x: 40, y: 150, w: 580, h: 480 }, PR = { x: 660, y: 150, w: 580, h: 480 };
        function hudRow(p, a, b, flash, gain) {
          smallHudBox(ctx, p.x + 40, p.y + 18, a, 0, 0);
          drawArrow(ctx, p.x + 232, p.y + 42, p.x + 292, p.y + 42, { width: 4 });
          smallHudBox(ctx, p.x + 310, p.y + 18, b, flash, gain);
        }
        function sceneRect(p) { return { x: p.x + 16, y: p.y + 86, w: p.w - 32, h: p.h - 102 }; }
        panelBox(ctx, PL);
        hudRow(PL, 3, 4, 0, 0.8);
        guideScene(ctx, sceneRect(PL), NET_VIEW, function () {
          Art.drawInnerRing(ctx);
          guideNet(ctx, { hot: true });
          Art.drawBubble(ctx, { x: 600, y: 318, color: 0, life: 9, mode: 'drag' });
          drawCursor(ctx, 614, 334, 26);
          netMark(ctx, GNET.x, GNET.y, 1);
        });
        panelBox(ctx, PR);
        hudRow(PR, 4, 3, 0.8, 0);
        guideScene(ctx, sceneRect(PR), { x: 170, y: 280, w: 330, h: 160 }, function () {
          Art.drawInnerRing(ctx);
          Art.drawBubble(ctx, { x: 240, y: 360, color: 1, life: 0.7, mode: 'idle' });
          drawArrow(ctx, 274, 360, 338, 360, TIME_ARROW);
          drawPop(ctx, 376, 360, 1);
        });
      }
    },
    {
      title: '結束', text: '命用完就結束, 撐越久越好',
      draw: function (ctx) {
        hudLeft(ctx, 110, 190, { hp: 4, hpMax: 4, time: 12.0 });
        drawArrow(ctx, 230, 290, 230, 390, { width: 4, dash: [10, 8] });
        hudLeft(ctx, 110, 410, { hp: 0, hpMax: 4, time: 187.4, hpFlash: 0.8 });
        drawArrow(ctx, 370, 450, 470, 410, { width: 4 });
        guideScene(ctx, { x: 490, y: 190, w: 700, h: 394 }, { x: 0, y: 0, w: W, h: H }, function () {
          Art.drawEndScreen(ctx, { time: 187.4, score: 1460 });
        });
      }
    }
  ];

  window.Art = Art;
})();
