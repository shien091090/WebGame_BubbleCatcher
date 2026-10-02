// 捕泡手 美術(規格 v13: 中央圓形場地 + 波次生成 + 音樂拍子 / 踩拍回血 / 血條): 全部 Canvas 2D 幾何繪製, 不引外部資源。
// 只負責「給狀態就畫」, 不含遊戲邏輯。規格與 state 欄位見 style.md。
(function () {
  'use strict';

  var W = 1280, H = 720;
  var FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  var P = {
    bg: '#10141f',          // 背景 = 內圈外區域(不可停放)
    ring: '#1d2536',        // 內圈地面
    ringEdge: '#6b7ea3',    // 內圈邊線
    bubble0: '#f4d03f',     // 黃(色 A)
    bubble1: '#36c275',     // 綠(色 B)
    bubble2: '#3a86ff',     // 藍(色 C)
    bubble3: '#8a3ccf',     // 紫(色 D)
    clear: '#dfe7f3',       // 「無色」: 透明氣泡外框、賦形區(不帶顏色的地塊)
    clearFill: 'rgba(190,210,240,0.14)', // 透明氣泡的玻璃填色
    shapeFloor: '#2b3550',  // 賦形區地面
    netOff: '#4a5570',      // 不亮的網槽位(灰色虛線空槽)
    danger: '#ff4d4d',      // 危險 / 損失: 命危險狀態、扣命、快過期的壽命環、重開 / 放棄
    ok: '#ffffff',          // 打勾、捕捉回命那一段、拖曳目標外圈、出場提示角框、換位掃光
    frozen: '#7fdcff',      // 只給「壽命凍結」: 被按住 / 拖曳中的壽命環
    beat: '#ff6fd8',        // 只給「拍子」: 拍子提示、預備拍數字、踩拍 / 整串回饋、踩拍回命那一段
    hp: '#93a6c6',          // 命(血條)一般狀態的填色
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

  var HP_MAX = 100, HP_DANGER = 40;
  var BUBBLE_R = 20, RING_R = 26, NET_R = 60, ZONE_R = 24, ZONE_R_SMALL = 20;
  var CX = 640, CY = 360, INNER_R = 210, ORBIT_R = 300, ZONE_RING_R = 140;

  // ---------- 版位(座標全部照規格版位表) ----------
  var SLOTS = [
    [1, 0, 940, 360], [2, 45, 852, 572], [3, 90, 640, 660], [4, 135, 428, 572],
    [5, 180, 340, 360], [6, 225, 428, 148], [7, 270, 640, 60], [8, 315, 852, 148]
  ].map(function (a) { return { id: '槽 ' + a[0], no: a[0], angle: a[1], x: a[2], y: a[3], r: NET_R }; });
  var SLOT_MAP = {};
  SLOTS.forEach(function (s) { SLOT_MAP[s.id] = s; SLOT_MAP[s.no] = s; });

  var ZONES = [
    { id: '染 A', kind: 'paint', color: 0, angle: 210, x: 519, y: 290, stage: 1 },
    { id: '染 B', kind: 'paint', color: 1, angle: 330, x: 761, y: 290, stage: 1 },
    { id: '染 C', kind: 'paint', color: 2, angle: 90, x: 640, y: 500, stage: 1 },
    { id: '染 D', kind: 'paint', color: 3, angle: 270, x: 640, y: 220, stage: 2 },
    { id: '賦形 方', kind: 'shape', shape: 'square', angle: 150, x: 519, y: 430, stage: 3 },
    { id: '賦形 三角', kind: 'shape', shape: 'triangle', angle: 30, x: 761, y: 430, stage: 4 }
  ];
  var ZONE_MAP = {};
  ZONES.forEach(function (z) { z.r = ZONE_R; z.rSmall = ZONE_R_SMALL; ZONE_MAP[z.id] = z; });

  var L = {
    canvas: { x: 0, y: 0, w: W, h: H },
    // 拖曳中氣泡中心的限制範圍(x 20~1260, y 20~700)
    dragBounds: { x: 20, y: 20, w: 1240, h: 680 },
    inner: { x: CX, y: CY, r: INNER_R },
    bubbleR: BUBBLE_R,
    netR: NET_R,
    zoneR: ZONE_R,            // 階段 1~4 的染色、賦形區判定半徑
    zoneRSmall: ZONE_R_SMALL, // 階段 5 起(縮小生效後)
    zoneShrinkStage: 5,
    zoneRingR: ZONE_RING_R,
    slotOrbitR: ORBIT_R,
    // 網槽位 8 個: { id: '槽 1'~'槽 8'(埋點用), no: 1~8, angle(度, 右方 0、順時針), x, y, r: 判定半徑 60 }
    slots: SLOTS,
    slotById: SLOT_MAP,       // 可用 '槽 3' 或 3 查
    // 區域 6 塊: { id(規格名稱, 埋點共用), kind: 'paint'|'shape', color?, shape?, angle, x, y, r: 24, rSmall: 20, stage }
    zones: ZONES,
    zoneById: ZONE_MAP,
    hudLeft: { x: 20, y: 20, w: 240, h: 80 },
    hudRight: { x: 960, y: 20, w: 220, h: 80 },
    pauseButton: { x: 1206, y: 26, w: 48, h: 48 },
    // 靜音按鈕: 暫停按鈕正下方, 中心 (1230, 110)
    muteButton: { x: 1206, y: 86, w: 48, h: 48 },
    // 命(血條)本體在 HUD 裡的位置(純顯示)
    hpBar: { x: 62, y: 35, w: 182, h: 18 },
    // 階段切換預告條(純顯示, 不可點; 左上 HUD 正下方, 與內圈、所有槽位判定範圍不重疊)
    stageNotice: { x: 20, y: 112, w: 240, h: 40 },
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
      pages: 7,
      close: { x: 1130, y: 24, w: 120, h: 48 },
      prev: { x: 40, y: 648, w: 160, h: 52 },
      next: { x: 1080, y: 648, w: 160, h: 52 }
    }
  };

  // ---------- 共用小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  // 顏色混合: hex 往 (r,g,b) 靠 t(0~1), 回傳 rgb 字串
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, to, t) {
    var a = hexRgb(hex);
    return 'rgb(' + Math.round(a[0] + (to[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (to[1] - a[1]) * t) + ',' + Math.round(a[2] + (to[2] - a[2]) * t) + ')';
  }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0];
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

  // 命(血條): 連續 0~hpMax。
  // 一般 = 灰藍填色; 危險(≤ 40 進、≥ 50 出, 由 RD 判)= 填色與外框變紅 + 外框隨時間脈動 + 「命」字變紅。
  // 40 處一道小刻痕 = 危險線。回命: 新加的那一段亮起(捕捉 = 白、踩拍 / 整串 = 拍子粉), 扣命: 剛失去的那一段紅色殘影。
  // 溢出: 條的右端(滿)亮起一個帽。s 欄位同 drawHud。
  function drawHpBar(ctx, x, y, w, h, s) {
    var max = s.hpMax || HP_MAX;
    var hp = Math.max(0, Math.min(max, s.hp == null ? 60 : s.hp));
    var danger = !!s.danger;
    var f = hp / max;
    var rr = h / 2;
    ctx.save();
    // 底槽
    roundRectPath(ctx, x, y, w, h, rr);
    ctx.fillStyle = 'rgba(8,10,16,0.85)';
    ctx.fill();
    // 填色
    ctx.save();
    roundRectPath(ctx, x, y, w, h, rr);
    ctx.clip();
    if (hp > 0) {
      ctx.fillStyle = danger ? P.danger : P.hp;
      ctx.fillRect(x, y, w * f, h);
      // 上緣一條亮邊, 讓條有厚度(純平面, 不做漸層)
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x, y, w * f, h * 0.3);
    }
    // 扣命殘影: hp → hpLossFrom 這一段紅色, 隨 hpFlash 淡出
    var lf = clamp01(s.hpFlash || 0);
    if (lf > 0 && s.hpLossFrom != null && s.hpLossFrom > hp) {
      var l0 = w * f, l1 = w * Math.min(1, s.hpLossFrom / max);
      ctx.globalAlpha = lf;
      ctx.fillStyle = P.danger;
      ctx.fillRect(x + l0, y, l1 - l0, h);
      ctx.globalAlpha = lf * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + l0, y, l1 - l0, h * 0.3);
      ctx.globalAlpha = 1;
    }
    // 回命那一段: hpGainFrom → hp 亮起
    var gf = clamp01(s.hpGainFx || 0);
    if (gf > 0 && s.hpGainFrom != null && s.hpGainFrom < hp) {
      // 一次回 2 點只有幾個像素寬, 亮起的那段至少畫 6 像素(從條尖往回), 讓「加了一段」看得到
      var g1 = w * f, g0 = Math.min(w * Math.max(0, s.hpGainFrom / max), g1 - 6);
      var gcol = (s.hpGainKind === 'beat' || s.hpGainKind === 'chain') ? P.beat : P.ok;
      ctx.globalAlpha = 0.35 + 0.65 * gf;
      ctx.fillStyle = gcol;
      ctx.fillRect(x + g0, y, g1 - g0, h);
      ctx.globalAlpha = 1;
    }
    // 危險線刻痕(40)
    var tx = x + w * (HP_DANGER / max);
    ctx.fillStyle = 'rgba(10,12,20,0.9)';
    ctx.fillRect(tx - 1, y, 2, h);
    ctx.restore();
    // 外框
    roundRectPath(ctx, x, y, w, h, rr);
    if (danger) {
      var pulse = 0.5 + 0.5 * Math.sin((s.time || 0) * TAU * 1.25);
      ctx.save();
      ctx.shadowColor = P.danger;
      ctx.shadowBlur = 6 + 12 * pulse;
      ctx.lineWidth = 2.5 + pulse;
      ctx.strokeStyle = P.danger;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(141,153,176,0.7)';
      ctx.stroke();
    }
    // 回命那一段的外光(畫在框外, 一眼看得到「加了一段」)
    if (gf > 0 && s.hpGainFrom != null && s.hpGainFrom < hp) {
      var a1 = x + w * f, a0 = Math.min(x + w * Math.max(0, s.hpGainFrom / max), a1 - 6);
      var gc = (s.hpGainKind === 'beat' || s.hpGainKind === 'chain') ? P.beat : P.ok;
      var grow = (1 - gf) * 3;
      ctx.save();
      ctx.globalAlpha = gf;
      ctx.shadowColor = gc;
      ctx.shadowBlur = s.hpGainKind === 'chain' ? 22 : 14;
      ctx.lineWidth = s.hpGainKind === 'chain' ? 3.5 : 2.5;
      ctx.strokeStyle = gc;
      roundRectPath(ctx, a0 - 1 - grow, y - 3 - grow, Math.max(4, a1 - a0) + 2 + grow * 2, h + 6 + grow * 2, 5);
      ctx.stroke();
      ctx.restore();
    }
    // 溢出: 右端(滿)亮起一個帽, 表示多的命換成分數了
    var of = clamp01(s.overflowFx || 0);
    if (of > 0) {
      ctx.save();
      ctx.globalAlpha = of;
      ctx.shadowColor = P.ok;
      ctx.shadowBlur = 16;
      ctx.fillStyle = P.ok;
      ctx.beginPath();
      ctx.arc(x + w, y + h / 2, h * 0.55 + (1 - of) * 6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPauseIcon(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - s * 0.35, cy - s * 0.4, s * 0.25, s * 0.8);
    ctx.fillRect(cx + s * 0.1, cy - s * 0.4, s * 0.25, s * 0.8);
  }

  // 喇叭圖示; muted = 叉, 否則兩道聲波
  function drawSpeaker(ctx, cx, cy, s, color, muted) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.18);
    ctx.lineTo(cx - s * 0.25, cy - s * 0.18);
    ctx.lineTo(cx + s * 0.02, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.45);
    ctx.lineTo(cx - s * 0.25, cy + s * 0.18);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.6, s * 0.11);
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.18, cy - s * 0.2); ctx.lineTo(cx + s * 0.55, cy + s * 0.2);
      ctx.moveTo(cx + s * 0.55, cy - s * 0.2); ctx.lineTo(cx + s * 0.18, cy + s * 0.2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + s * 0.05, cy, s * 0.26, -0.8, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + s * 0.05, cy, s * 0.48, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 左上 HUD 區塊(命 + 存活時間), 左上角在 (x, y)
  function hudLeft(ctx, x, y, s) {
    var r = { x: x, y: y, w: L.hudLeft.w, h: L.hudLeft.h };
    panelBox(ctx, r, 'rgba(26,33,48,0.9)');
    textPlain(ctx, '命', x + 16, y + 25, 16, s.danger ? P.danger : P.textDim, 'left', true);
    drawHpBar(ctx, x + 42, y + 15, 182, 18, s);
    var t = (s.time || 0).toFixed(1) + ' 秒';
    textPlain(ctx, t, x + 16, y + 60, 24, s.paused ? P.textDim : P.text, 'left', true);
    if (s.paused) drawPauseIcon(ctx, x + r.w - 26, y + 60, 18, P.textDim);
  }

  // 說明頁用的命縮影: 與遊戲內同一個血條畫法, 只畫命那一列
  function smallHpBox(ctx, x, y, s) {
    var r = { x: x, y: y, w: 160, h: 40 };
    panelBox(ctx, r, 'rgba(26,33,48,0.9)');
    textPlain(ctx, '命', x + 12, y + 20, 15, s.danger ? P.danger : P.textDim, 'left', true);
    drawHpBar(ctx, x + 34, y + 12, 114, 16, s);
  }

  // 星芒(踩拍 / 整串回饋的長相): 尖刺外放 = 和所有圓環(屬性變了 / 被收下 / 沒變)不同形
  function starPath(ctx, x, y, n, rIn, rOut, rot) {
    ctx.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i * Math.PI / n;
      var rad = i % 2 === 0 ? rOut : rIn;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
  }

  // 菱形(整串回饋裡的「每個動作都對上」記號)
  function diamondPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.72, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.72, y);
    ctx.closePath();
  }

  function burst(ctx, x, y, t, o) {
    // o: { n, rOut, rIn, col, inner, lw }
    var e = 1 - Math.pow(1 - t, 3);
    var a = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    var ro = o.rOut * (0.35 + 0.65 * e), ri = o.rIn * (0.5 + 0.5 * e);
    ctx.save();
    ctx.globalAlpha = a;
    starPath(ctx, x, y, o.n, ri, ro, o.rot || -Math.PI / 2);
    // hole: 中心挖空(半徑 = 尖刺內緣的 0.85), 不蓋住正在操作的氣泡
    if (o.hole) { ctx.moveTo(x + ri * 0.85, y); ctx.arc(x, y, ri * 0.85, 0, TAU, true); }
    ctx.shadowColor = o.col;
    ctx.shadowBlur = o.glow || 18;
    ctx.fillStyle = o.fill || 'rgba(255,111,216,0.35)';
    ctx.fill('evenodd');
    if (o.hole) starPath(ctx, x, y, o.n, ri, ro, o.rot || -Math.PI / 2);
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.lw || 3;
    ctx.strokeStyle = o.col;
    ctx.stroke();
    ctx.restore();
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
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rimColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 縮小預告: 區域照舊大小生效, 一圈白色虛線由舊邊界往內收到新半徑, t = 1 那一刻 = 縮小生效
  function shrinkRing(ctx, x, y, r0, r1, t) {
    t = clamp01(t);
    var rr = r0 + (r1 - r0) * t;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.ok;
    ctx.stroke();
    ctx.restore();
  }

  // 出場提示: 四個白色角框(與氣泡、網的所有圓環不同形), t 0→1
  function introMarks(ctx, x, y, r, t) {
    if (t == null || t <= 0 || t >= 1) return;
    var a = t < 0.08 ? t / 0.08 : (t > 0.8 ? (1 - t) / 0.2 : 1);
    var snap = t < 0.15 ? (1 - t / 0.15) : 0;
    var h = (r + 9 + snap * 18) * (1 + 0.05 * Math.sin(t * TAU * 3));
    var len = Math.max(7, h * 0.36);
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

  // 網中央的形狀條件: 深色底盤 + 網色實心形狀 + 白框
  function netGlyph(ctx, x, y, shape, col, plateR, s) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, plateR, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,20,0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = col;
    ctx.stroke();
    glyph(ctx, shape, x, y, s, { fill: col, stroke: '#ffffff', lw: 2.5 });
    ctx.restore();
  }

  // 位置 → 以內圈圓心為原點的角度(弧度)
  function angleOf(x, y) { return Math.atan2(y - CY, x - CX); }

  // state.from 可為槽位編號、'槽 n' 或 {x, y}
  function slotPoint(from) {
    if (from == null) return null;
    if (typeof from === 'object') return from;
    return SLOT_MAP[from] || null;
  }

  // 換位掃光: 從上一張網沿槽位軌道(半徑 300)掃到新網, 讓視線從剛放下的地方被帶到新位置。
  // t 0→0.4 光點移動, 0.4→0.6 尾巴淡出
  function slotSweep(ctx, fromPt, toX, toY, t) {
    if (t <= 0 || t >= 0.6) return;
    var a0 = angleOf(fromPt.x, fromPt.y), a1 = angleOf(toX, toY);
    var d = a1 - a0;
    while (d > Math.PI + 1e-6) d -= TAU;
    while (d <= -Math.PI + 1e-6) d += TAU;
    var u = clamp01(t / 0.4);
    var head = 1 - (1 - u) * (1 - u);
    var fade = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.2;
    var tail = Math.max(0, head - 0.5);
    var N = 28;
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < N; i++) {
      var f0 = tail + (head - tail) * (i / N), f1 = tail + (head - tail) * ((i + 1) / N);
      var k = (i + 1) / N;
      ctx.beginPath();
      ctx.arc(CX, CY, ORBIT_R, a0 + d * f0, a0 + d * f1, d < 0);
      ctx.globalAlpha = fade * k * 0.9;
      ctx.lineWidth = 2 + 7 * k;
      ctx.strokeStyle = P.ok;
      ctx.stroke();
    }
    if (t < 0.45) {
      var ah = a0 + d * head;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(CX + Math.cos(ah) * ORBIT_R, CY + Math.sin(ah) * ORBIT_R, 9, 0, TAU);
      ctx.fillStyle = P.ok;
      ctx.shadowColor = P.ok;
      ctx.shadowBlur = 16;
      ctx.fill();
    }
    ctx.restore();
  }

  // 染色區 / 賦形區共用骨架。body(r) 畫生效外觀, pre(r, t) 畫預告外觀
  function drawZone(ctx, s, body, pre) {
    var x = s.x, y = s.y;
    var r = s.r || ZONE_R;
    ctx.save();
    if (s.status === 'preview') {
      pre(r, s.previewT || 0);
    } else {
      body(r);
      if (s.status === 'shrink') shrinkRing(ctx, x, y, r, s.shrinkTo || ZONE_R_SMALL, s.previewT || 0);
      else introMarks(ctx, x, y, r, s.introT);
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
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, INNER_R, 0, TAU);
      ctx.fillStyle = P.ring;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.ringEdge;
      ctx.stroke();
      ctx.restore();
    },

    // state: { x, y, color, r, status: 'preview'|'on'|'shrink', previewT, shrinkTo, introT }
    drawPaintZone: function (ctx, s) {
      var col = COLORS[s.color] || '#ffffff';
      var x = s.x, y = s.y;
      drawZone(ctx, s, function (r) {
        // 平的色池: 半飽和地面 + 實線色框 + 中央水滴(= 染色); 沒有高光與壽命環(那是氣泡)
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = col;
        ctx.stroke();
        dropPath(ctx, x, y + 1, r * 0.44);
        ctx.fillStyle = 'rgba(16,20,31,0.55)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.stroke();
      }, function (r, t) {
        previewDisc(ctx, x, y, r, t, function () {
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = col;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }, col);
        dropPath(ctx, x, y + 1, r * 0.44);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.stroke();
      });
    },

    // state: { x, y, shape: 'square'|'triangle', r, status: 'preview'|'on'|'shrink', previewT, shrinkTo, introT }
    drawShapeZone: function (ctx, s) {
      var x = s.x, y = s.y, shape = s.shape || 'square';
      drawZone(ctx, s, function (r) {
        // 無色地塊(中性灰白框)+ 中央空心形狀 = 「擦過變成這個形」
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = P.shapeFloor;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.clear;
        ctx.stroke();
        glyph(ctx, shape, x, y, r * 0.5, { stroke: P.clear, lw: 2.5 });
      }, function (r, t) {
        previewDisc(ctx, x, y, r, t, function () {
          ctx.fillStyle = P.shapeFloor;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }, P.clear);
        glyph(ctx, shape, x, y, r * 0.5, { stroke: P.clear, lw: 2, dash: [3, 3], alpha: 0.7 });
      });
    },

    // 網槽位(不亮 / 亮著 = 網 / 剛亮起)
    // state: { x, y, status: 'off'|'on', color, shape, lightT, from, hot, flash, flashT }
    drawNet: function (ctx, s) {
      var x = s.x, y = s.y, r = NET_R;
      var status = s.status === 'off' ? 'off' : 'on';
      var i;
      ctx.save();
      if (status === 'off') {
        // 不亮: 細灰虛線空槽, 看得出「這裡是槽位」, 但沒有顏色、網格與光 = 不收氣泡
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = 'rgba(74,85,112,0.07)';
        ctx.fill();
        ctx.setLineDash([6, 9]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(74,85,112,0.85)';
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        var col = COLORS[s.color] || '#ffffff';
        var lt = s.lightT > 0 && s.lightT < 1 ? s.lightT : 0;
        // 亮著: 淡色底 + 網格 + 5px 色框 + 同色外光(全場只有這一張有光)
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.22;
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
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = 18 + (lt ? 26 * (1 - lt) : 0);
        ctx.lineWidth = 5;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.restore();

        // 條件: 網的顏色 = 顏色條件; 有形狀條件時中央才放形狀(只畫網有列的項目)
        if (s.shape && s.shape !== 'circle') netGlyph(ctx, x, y, s.shape, col, 28, 17);

        if (s.hot) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, TAU);
          ctx.stroke();
        }

        if (s.flash && s.flash !== 'catch' && (s.flashT == null || s.flashT < 1)) {
          // 'bounce'(條件不符彈回): 白色虛線環、無符號 = 沒扣命
          var bt = clamp01(s.flashT || 0);
          ctx.globalAlpha = 1 - bt;
          ctx.lineWidth = 4;
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath(); ctx.arc(x, y, r + 4 + bt * 10, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }

        // 剛亮起(換位提示): 從上一張網掃過來的光 + 四個白角框收進來
        if (lt) {
          var fp = slotPoint(s.from);
          if (fp) slotSweep(ctx, fp, x, y, lt);
          introMarks(ctx, x, y, r, lt);
        }
      }

      // 捕捉成功: 捕捉當幀這個槽位就熄滅, 所以勾與白環在不亮的槽位上也照畫
      if (s.flash === 'catch' && (s.flashT == null || s.flashT < 1)) {
        var ct = clamp01(s.flashT || 0), ca = 1 - ct;
        ctx.globalAlpha = ca;
        ctx.lineWidth = 4;
        ctx.strokeStyle = P.ok;
        ctx.beginPath(); ctx.arc(x, y, r + 4 + ct * 22, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        netMark(ctx, x, y, ca);
      }
      ctx.restore();
    },

    // state: { x, y, color: null|0~3, shape: 'circle'|'square'|'triangle', life, lifeMax,
    //          mode: 'idle'|'hold'|'drag'|'return', hover, spawnT, swipeFx, swipeKind: 'paint'|'shape'|'locked' }
    // v12 外觀: 氣泡是「立在地上、可以拿起來的球」: 立體漸層 + 雙高光 + 反光弧 + 落影;
    // 地板(染色、賦形區)維持平塗、無影, 兩者靠「立體 / 平面」與「有影 / 無影」兩條通道分開
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
      var hover = !!s.hover && mode === 'idle';
      var spawning = s.spawnT != null && s.spawnT < 1;
      var u = spawning ? clamp01(s.spawnT) : 1;
      ctx.save();
      ctx.translate(s.x, s.y);

      // 冒出演出: 地面一圈扁橢圓水紋(從地面冒出) + 本體由下往上彈起(拉長 → 回彈)
      var grow = 1, sx = 1, sy = 1;
      if (spawning) {
        var rip = clamp01(u / 0.8);
        ctx.save();
        ctx.globalAlpha = (1 - rip) * 0.9;
        ctx.beginPath();
        ctx.ellipse(0, R * 0.75, 8 + rip * 26, 3 + rip * 9, 0, 0, TAU);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = P.clear;
        ctx.stroke();
        ctx.restore();
        if (u < 0.55) {
          var a = u / 0.55;
          grow = 1 - Math.pow(1 - a, 3) + Math.sin(a * Math.PI) * 0.1;
          var st = Math.sin(a * Math.PI);
          sx = 1 - 0.16 * st; sy = 1 + 0.26 * st;
        } else {
          var b = (u - 0.55) / 0.45;
          var wob = Math.sin(b * Math.PI) * 0.12 * (1 - b * 0.5);
          sx = 1 + wob; sy = 1 - wob;
        }
      }

      // 落影(永遠有: 氣泡是立在地上的東西; 地板沒有影)
      var lift = mode === 'drag' ? 3 : ((mode === 'hold' || hover) ? 1 : 0);
      ctx.save();
      if (spawning) ctx.globalAlpha = clamp01(u * 2);
      if (mode === 'return') ctx.globalAlpha = 0.45;
      ctx.beginPath();
      if (lift === 3) ctx.ellipse(6, 24, 22, 8.5, 0, 0, TAU);
      else if (lift === 1) ctx.ellipse(4, 21, 19, 7, 0, 0, TAU);
      else ctx.ellipse(3, 18.5, 17.5 * Math.max(0.01, grow), 6.5 * Math.max(0.01, grow), 0, 0, TAU);
      ctx.fillStyle = lift === 3 ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.5)';
      ctx.fill();
      ctx.restore();

      if (mode === 'drag') {
        ctx.scale(1.15, 1.15);
        ctx.translate(0, -3);
      } else if (mode === 'hold') {
        ctx.scale(1.06, 1.06);
        ctx.translate(0, -1);
      } else if (hover) {
        ctx.scale(1.04, 1.04);
        ctx.translate(0, -1);
      } else if (mode === 'return') {
        ctx.globalAlpha = 0.45;
      }

      // 壽命環: 12 秒總剩餘比例(氣泡上沒有數字, 環畫總量); 凍結時冰藍, 剩 3 秒內紅。冒出中淡入, 不跟著彈
      ctx.save();
      if (spawning) ctx.globalAlpha *= clamp01((u - 0.25) / 0.4);
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
      }
      ctx.restore();

      // 本體(冒出中以底部為錨點彈起)
      ctx.save();
      if (spawning) {
        ctx.translate(0, R);
        ctx.scale(Math.max(0.01, grow * sx), Math.max(0.01, grow * sy));
        ctx.translate(0, -R);
      }
      var g;
      shapePath(ctx, shape, 0, 0, R);
      if (col) {
        // 有色 = 實心球: 左上亮、右下暗的立體漸層
        g = ctx.createRadialGradient(-R * 0.38, -R * 0.42, R * 0.08, 0, 0, R * 1.2);
        g.addColorStop(0, mix(col, WHITE, hover ? 0.72 : 0.6));
        g.addColorStop(0.4, hover ? mix(col, WHITE, 0.12) : col);
        g.addColorStop(1, mix(col, BLACK, hover ? 0.3 : 0.48));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineJoin = 'round';
        ctx.stroke();
      } else {
        // 透明 = 空心玻璃球: 中央通透、邊緣變亮(玻璃的反光) + 灰白框
        ctx.fillStyle = 'rgba(16,20,31,0.6)';
        ctx.fill();
        g = ctx.createRadialGradient(-R * 0.1, -R * 0.12, R * 0.15, 0, 0, R);
        g.addColorStop(0, 'rgba(190,210,240,' + (hover ? 0.12 : 0.04) + ')');
        g.addColorStop(0.65, 'rgba(190,210,240,' + (hover ? 0.2 : 0.1) + ')');
        g.addColorStop(1, 'rgba(225,235,252,' + (hover ? 0.6 : 0.42) + ')');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = P.clear;
        ctx.stroke();
      }
      // 高光(都裁在形狀內): 左上主高光 + 小亮點 + 右下反光弧
      ctx.save();
      shapePath(ctx, shape, 0, 0, R);
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(-R * 0.36, -R * 0.42, 7, 4, -0.6, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (clear ? 0.8 : 0.75) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-R * 0.66, -R * 0.06, 1.9, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, R - 4, Math.PI * 0.12, Math.PI * 0.5);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,' + (clear ? 0.45 : 0.32) + ')';
      ctx.stroke();
      ctx.restore();
      ctx.restore();

      // 擦過回饋: 染色 = 新色環外擴; 賦形 = 灰白環外擴; 已鎖定、屬性沒變 = 灰虛線環往內收(沒變)
      var fx = clamp01(s.swipeFx || 0);
      if (fx > 0) {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.globalAlpha = fx;
        ctx.beginPath();
        if (s.swipeKind === 'locked') {
          ctx.arc(0, 0, RING_R + 3 + fx * 12, 0, TAU);
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = P.textDim;
        } else {
          ctx.arc(0, 0, RING_R + 3 + (1 - fx) * 16, 0, TAU);
          ctx.strokeStyle = s.swipeKind === 'shape' ? P.clear : (col || P.clear);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },

    // 清場回饋(v11): 場上清空那一刻。state: { t: 0→1(建議 1.2 秒, 暫停時凍結) }
    // 和捕捉回饋分開: 捕捉 = 槽位上的白線環 + 勾(一個點); 清場 = 整片內圈地面由中心往外亮起 + 內圈邊線發光 + 中央「清空 +50」
    // 只用「填色的地面」, 不用外擴線環(線環在字典裡 = 屬性變了 / 捕捉)
    drawClearFx: function (ctx, s) {
      s = s || {};
      var t = s.t == null ? 0 : s.t;
      if (t <= 0 || t >= 1) return;
      ctx.save();
      // 1) 地面亮起: 0~0.35 由中心擴到整個內圈, 之後淡出
      var spread = 1 - Math.pow(1 - clamp01(t / 0.35), 2);
      var fade = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      var rr = Math.max(1, INNER_R * spread);
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, INNER_R, 0, TAU);
      ctx.clip();
      var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, rr);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.1 * fade) + ')');
      g.addColorStop(0.8, 'rgba(255,255,255,' + (0.22 * fade) + ')');
      g.addColorStop(1, 'rgba(255,255,255,' + (0.34 * fade) + ')');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(CX, CY, rr, 0, TAU);
      ctx.fill();
      ctx.restore();
      // 2) 內圈邊線發光(地面擴到邊時最亮)
      var edge = t < 0.35 ? spread : fade;
      ctx.save();
      ctx.globalAlpha = edge;
      ctx.shadowColor = P.ok;
      ctx.shadowBlur = 24;
      ctx.lineWidth = 6;
      ctx.strokeStyle = P.ok;
      ctx.beginPath();
      ctx.arc(CX, CY, INNER_R, 0, TAU);
      ctx.stroke();
      ctx.restore();
      // 3) 中央字: 0~0.15 彈出, 0.75 起淡出
      var ta = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      var pop = t < 0.15 ? 0.6 + 0.55 * (t / 0.15) : (t < 0.25 ? 1.15 - 0.15 * ((t - 0.15) / 0.1) : 1);
      ctx.save();
      ctx.globalAlpha = ta;
      ctx.translate(CX, CY);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = font(40, true);
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(10,12,20,0.85)';
      ctx.strokeText('清空', 0, -22);
      ctx.fillStyle = P.ok;
      ctx.fillText('清空', 0, -22);
      ctx.font = font(30, true);
      ctx.strokeText('+50', 0, 22);
      ctx.fillStyle = P.text;
      ctx.fillText('+50', 0, 22);
      ctx.restore();
      ctx.restore();
    },

    // 命(血條)+ 存活時間 + 分數 + 連續數
    // state: { hp: 0~100, hpMax(預設 100), danger, time, paused, score, combo,
    //          hpGainFx: 1→0, hpGainFrom, hpGainKind: 'catch'|'beat'|'chain',
    //          hpFlash: 1→0(扣命), hpLossFrom, overflowFx: 1→0, overflowPts }
    drawHud: function (ctx, s) {
      s = s || {};
      ctx.save();
      hudLeft(ctx, L.hudLeft.x, L.hudLeft.y, s);
      var r = L.hudRight;
      panelBox(ctx, r, 'rgba(26,33,48,0.9)');
      textPlain(ctx, '分數', r.x + 16, r.y + 26, 14, P.textDim, 'left', false);
      var sc = String(Math.round(s.score || 0));
      textPlain(ctx, sc, r.x + r.w - 16, r.y + 28, 30, P.text, 'right', true);
      if ((s.combo || 0) > 0) {
        textPlain(ctx, '連續', r.x + 16, r.y + 60, 14, P.textDim, 'left', false);
        textPlain(ctx, String(s.combo), r.x + r.w - 16, r.y + 60, 22, P.text, 'right', true);
      }
      // 溢出轉分數: 分數左邊彈出「+N」(命那頭的滿格帽同時亮起)
      var of = clamp01(s.overflowFx || 0);
      if (of > 0 && s.overflowPts > 0) {
        ctx.font = font(30, true);
        var mw = ctx.measureText(sc);
        var sw = mw && mw.width ? mw.width : sc.length * 17;
        ctx.save();
        ctx.globalAlpha = of;
        ctx.font = font(18, true);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10,12,20,0.9)';
        var oy = r.y + 30 - (1 - of) * 10;
        ctx.strokeText('+' + Math.round(s.overflowPts), r.x + r.w - 24 - sw, oy);
        ctx.fillStyle = P.ok;
        ctx.fillText('+' + Math.round(s.overflowPts), r.x + r.w - 24 - sw, oy);
        ctx.restore();
      }
      ctx.restore();
    },

    // 拍子提示: 內圈邊線隨拍子亮起 + 一圈拍子粉的「收攏環」從外往內收, 收到內圈邊線那一刻 = 下一拍。
    // 玩家看收攏環離邊線多遠, 就知道下一拍還有多久。預備拍與局中都每幀呼叫; 暫停時 RD 停住 phase。
    // state: { phase: 0~1(距上一拍經過的比例, 0 = 正在拍點上, 接近 1 = 下一拍快到) }
    drawBeatCue: function (ctx, s) {
      s = s || {};
      var p = s.phase == null ? 0 : s.phase;
      p = p - Math.floor(p);
      ctx.save();
      // 1) 收攏環: 半徑 237 → 213(貼著內圈邊線外側), 越接近下一拍越亮
      if (p > 0.04) {
        var ar = INNER_R + 3 + 24 * (1 - p);
        var aa = p < 0.2 ? (p - 0.04) / 0.16 : 1;
        ctx.save();
        ctx.globalAlpha = aa * (0.25 + 0.6 * p);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = P.beat;
        ctx.beginPath();
        ctx.arc(CX, CY, ar, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      // 2) 拍點: 內圈邊線變成拍子粉並發光, 0.3 拍內退回
      var f = p < 0.3 ? Math.pow(1 - p / 0.3, 2) : 0;
      if (f > 0) {
        ctx.save();
        ctx.globalAlpha = 0.85 * f;
        ctx.shadowColor = P.beat;
        ctx.shadowBlur = 14 * f;
        ctx.lineWidth = 3 + 2.5 * f;
        ctx.strokeStyle = P.beat;
        ctx.beginPath();
        ctx.arc(CX, CY, INNER_R, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },

    // 預備拍: 內圈正中央「預備」+ 還剩幾拍的大數字(4 → 3 → 2 → 1)+ 4 顆點(亮的 = 還剩的拍)。
    // 只在預備拍期間呼叫(場上沒有氣泡); 拍子提示照常另外畫。
    // state: { beat: -4 ~ -1(目前所在的預備拍), phase: 0~1(同拍子提示) }
    drawCountIn: function (ctx, s) {
      s = s || {};
      var b = s.beat == null ? -4 : s.beat;
      var n = Math.max(1, Math.min(4, -b));
      var p = clamp01(s.phase || 0);
      ctx.save();
      textPlain(ctx, '預備', CX, CY - 78, 24, P.textDim, 'center', true);
      var k = p < 0.25 ? 1.3 - 0.3 * (p / 0.25) : 1;
      ctx.save();
      ctx.translate(CX, CY - 6);
      ctx.scale(k, k);
      ctx.font = font(96, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(10,12,20,0.85)';
      ctx.strokeText(String(n), 0, 0);
      ctx.shadowColor = P.beat;
      ctx.shadowBlur = 20 * (1 - p);
      ctx.fillStyle = P.beat;
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
      for (var i = 0; i < 4; i++) {
        var px = CX - 39 + i * 26, py = CY + 72;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, TAU);
        if (i < n) {
          ctx.fillStyle = P.beat;
          ctx.fill();
        } else {
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(141,153,176,0.6)';
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    // 踩拍回饋: 計次節點踩在拍上那一刻, 畫在動作發生處。拍子粉星芒(尖刺外放, 不是圓環)。
    // 中心挖空, 不蓋住正在拖的氣泡。比捕捉回饋(單條白線環)大一級。state: { x, y, t: 0→1(建議 0.45 秒, 暫停凍結) }
    drawBeatFx: function (ctx, s) {
      s = s || {};
      var t = s.t == null ? 0 : s.t;
      if (t <= 0 || t >= 1) return;
      ctx.save();
      burst(ctx, s.x, s.y, t, { n: 10, rOut: 72, rIn: 34, col: P.beat, lw: 3.5, glow: 20, hole: true, fill: 'rgba(255,111,216,0.45)' });
      ctx.restore();
    },

    // 整串回饋: 整串踩拍的捕捉那一刻, 畫在剛收下的網(原槽位)上。比踩拍回饋再大一級:
    // 雙層星芒(外粉 16 尖、內白 8 尖)+ 中心閃光 + 一排菱形(每個動作一顆, 全亮 = 每個都對上)依序彈出。
    // 這一刻送進網的那個節點不另畫 drawBeatFx(併進這裡)。
    // state: { x, y, t: 0→1(建議 0.9 秒, 暫停凍結), nodes: 該顆計次的節點數 3 或 4(預設 3) }
    drawChainFx: function (ctx, s) {
      s = s || {};
      var t = s.t == null ? 0 : s.t;
      if (t <= 0 || t >= 1) return;
      var x = s.x, y = s.y;
      var nodes = s.nodes === 4 ? 4 : 3;
      ctx.save();
      if (t < 0.3) {
        ctx.save();
        ctx.globalAlpha = 1 - t / 0.3;
        ctx.beginPath();
        ctx.arc(x, y, 64, 0, TAU);
        ctx.fillStyle = 'rgba(255,220,245,0.6)';
        ctx.fill();
        ctx.restore();
      }
      burst(ctx, x, y, t, { n: 16, rOut: 132, rIn: 58, col: P.beat, lw: 4.5, glow: 30 });
      burst(ctx, x, y, Math.min(1, t * 1.15), {
        n: 8, rOut: 76, rIn: 30, col: P.ok, lw: 3, glow: 16, rot: -Math.PI / 2 + Math.PI / 8,
        fill: 'rgba(255,255,255,0.3)'
      });
      // 菱形列: 網的上方(槽 7 太靠上時改放下方)
      var ry = y - 98 < 24 ? y + 98 : y - 98;
      var gap = 30;
      for (var i = 0; i < nodes; i++) {
        var d = t - 0.06 * i;
        if (d <= 0) continue;
        var pop = d < 0.12 ? 0.4 + 0.9 * (d / 0.12) : (d < 0.2 ? 1.3 - 0.3 * ((d - 0.12) / 0.08) : 1);
        var da = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        var dx = x - (nodes - 1) * gap / 2 + i * gap;
        ctx.save();
        ctx.globalAlpha = da;
        ctx.translate(dx, ry - (ry < y ? 1 : -1) * 6 * clamp01(t / 0.5));
        ctx.scale(pop, pop);
        diamondPath(ctx, 0, 0, 11);
        ctx.shadowColor = P.beat;
        ctx.shadowBlur = 12;
        ctx.fillStyle = P.beat;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = P.ok;
        ctx.stroke();
        ctx.restore();
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

    // 靜音按鈕: 暫停按鈕正下方, 兩種狀態都寫「靜音」。
    // 有聲 = 一般按鈕底 + 喇叭帶聲波; 靜音中 = 按鈕反白(亮底深字, 像被按下的開關)+ 喇叭打叉。
    // 暫停選單開著時要畫在暫停選單之後(不被暗罩蓋住)。state: { hover, muted }
    drawMuteButton: function (ctx, s) {
      s = s || {};
      var r = L.muteButton;
      var m = !!s.muted;
      ctx.save();
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      if (m) {
        ctx.fillStyle = s.hover ? '#ffffff' : P.primary;
        ctx.fill();
      } else {
        ctx.fillStyle = s.hover ? P.buttonHover : P.button;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.hover ? P.text : P.panelEdge;
        ctx.stroke();
      }
      var c = m ? P.primaryText : P.text;
      drawSpeaker(ctx, r.x + r.w / 2 - 2, r.y + 16, 20, c, m);
      textPlain(ctx, '靜音', r.x + r.w / 2, r.y + r.h - 12, 14, c, 'center', true);
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
    // 只顯示存活時間與分數(v13: 不顯示清場次數)
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
      // 說明頁第 7 頁專用(內部): 只示意存活時間, 卡片置中
      if (s._timeOnly) cards = [{ x: 520, label: cards[0].label, value: cards[0].value }];
      for (var i = 0; i < cards.length; i++) {
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

    // state: { page: 1~7, hover: 'close'|'prev'|'next'|null }
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
  // 整個場地(內圈 + 8 槽位, 其中 lit 那一個亮著); o: 亮著那張的其他 state, off: { 槽位編號: 額外 state }
  function field(ctx, lit, o, off) {
    Art.drawInnerRing(ctx);
    for (var i = 0; i < SLOTS.length; i++) {
      var sl = SLOTS[i];
      if (sl.no === lit) continue;
      var st = { x: sl.x, y: sl.y, status: 'off' };
      if (off && off[sl.no]) for (var k in off[sl.no]) st[k] = off[sl.no][k];
      Art.drawNet(ctx, st);
    }
    if (lit) {
      var ls = SLOT_MAP[lit];
      var s2 = { x: ls.x, y: ls.y, status: 'on', color: 0 };
      if (o) for (var k2 in o) s2[k2] = o[k2];
      Art.drawNet(ctx, s2);
    }
  }

  function inset(p, d) { return { x: p.x + d, y: p.y + d, w: p.w - d * 2, h: p.h - d * 2 }; }

  var FIELD_VIEW = { x: 258, y: -8, w: 764, h: 736 };
  var TIME_ARROW = { width: 3, color: 'rgba(141,153,176,0.9)', dash: [8, 8] };
  var DRAG = { dash: [14, 10], width: 7 };   // 說明頁在縮小的場地裡用的拖曳箭頭
  var BACK = { width: 7 };                   // 回到內圈

  var THREE = [
    { x: 60, y: 170, w: 360, h: 430 },
    { x: 460, y: 170, w: 360, h: 430 },
    { x: 860, y: 170, w: 360, h: 430 }
  ];
  var CELLS = [
    { x: 40, y: 146, w: 370, h: 484 },
    { x: 455, y: 146, w: 370, h: 484 },
    { x: 870, y: 146, w: 370, h: 484 }
  ];

  var GUIDE = [
    {
      // 第 1 頁: 內圈 + 染 A、染 B(實際位置); 同一顆氣泡三個時刻: 透明 → 擦過 A 變 A → 擦過 B 仍是 A。
      // 箭頭只到擦過 B; 無槽位、無其他區域
      title: '沾色', text: '擦過染色區就沾色, 沾過就不再變',
      draw: function (ctx) {
        var p = { x: 190, y: 140, w: 900, h: 490 };
        panelBox(ctx, p);
        guideScene(ctx, inset(p, 10), { x: 410, y: 140, w: 460, h: 320 }, function () {
          Art.drawInnerRing(ctx);
          var A = ZONE_MAP['染 A'], B = ZONE_MAP['染 B'];
          Art.drawPaintZone(ctx, { x: A.x, y: A.y, color: 0, status: 'on' });
          Art.drawPaintZone(ctx, { x: B.x, y: B.y, color: 1, status: 'on' });
          drawArrow(ctx, 486, 297, 768, 290, { dash: [10, 8], width: 4 });
          Art.drawBubble(ctx, { x: 463, y: 300, color: null, life: 12, mode: 'hold' });
          drawCursor(ctx, 472, 308, 24);
          Art.drawBubble(ctx, { x: 640, y: 292, color: 0, life: 12, mode: 'drag', swipeFx: 0.45, swipeKind: 'paint' });
          // 壓在染 B 右緣(兩圓相交), 仍是色 A; 灰虛線環往內收 = 擦到了但沒變
          Art.drawBubble(ctx, { x: 800, y: 290, color: 0, life: 12, mode: 'drag', swipeFx: 0.55, swipeKind: 'locked' });
        });
      }
    },
    {
      // 第 2 頁: 槽 1 亮著要色 A; 三格都不畫命。1 色 A 放上打勾; 2 透明放上 → 回內圈; 3 色 A 放不亮槽位 → 回內圈。
      // 只畫放開前最後一小段, 不畫擦區
      title: '送進亮著的網', text: '只有亮著的網收, 顏色要對',
      draw: function (ctx) {
        var c;
        c = CELLS[0];
        panelBox(ctx, c);
        guideScene(ctx, inset(c, 12), FIELD_VIEW, function () {
          field(ctx, 1, { hot: true });
          drawArrow(ctx, 790, 420, 896, 378, DRAG);
          bigBubble(ctx, 936, 356, 1.6, { color: 0, life: 9, mode: 'drag' });
          drawCursor(ctx, 950, 372, 44);
          netMark(ctx, 940, 360, 1);
        });
        c = CELLS[1];
        panelBox(ctx, c);
        guideScene(ctx, inset(c, 12), FIELD_VIEW, function () {
          field(ctx, 1, { flash: 'bounce', flashT: 0.3 });
          drawArrow(ctx, 870, 250, 922, 318, DRAG);
          bigBubble(ctx, 936, 356, 1.6, { color: null, life: 8.8, mode: 'drag' });
          drawCursor(ctx, 950, 372, 44);
          drawArrow(ctx, 912, 432, 836, 410, { width: 7, cx: 890, cy: 470 });
          bigBubble(ctx, 800, 380, 1.6, { color: null, life: 8.8, mode: 'idle' });
        });
        c = CELLS[2];
        panelBox(ctx, c);
        guideScene(ctx, inset(c, 12), FIELD_VIEW, function () {
          field(ctx, 1, {});
          drawArrow(ctx, 700, 118, 812, 140, DRAG);
          bigBubble(ctx, 848, 146, 1.6, { color: 0, life: 8.8, mode: 'drag' });
          drawCursor(ctx, 862, 162, 44);
          drawArrow(ctx, 900, 200, 800, 262, { width: 7, cx: 890, cy: 270 });
          bigBubble(ctx, 766, 240, 1.6, { color: 0, life: 8.8, mode: 'idle' });
        });
      }
    },
    {
      // 第 3 頁: 左 收下前(槽 1 亮著要色 A, 色 A 氣泡正放上); 右 兩種「之後」: 槽 1 熄滅,
      // 一種槽 3 亮起仍要色 A, 另一種槽 6 亮起要色 B(都不是槽 1 的隔壁)。不畫氣泡路線
      title: '網會換地方', text: '收下後網換到別處',
      draw: function (ctx) {
        var c = CELLS[0];
        panelBox(ctx, c);
        guideScene(ctx, inset(c, 12), FIELD_VIEW, function () {
          field(ctx, 1, { hot: true });
          bigBubble(ctx, 936, 356, 1.6, { color: 0, life: 9, mode: 'drag' });
          drawCursor(ctx, 950, 372, 44);
        });
        drawArrow(ctx, c.x + c.w + 6, 388, CELLS[1].x - 6, 388, { width: 4 });
        var afters = [[3, 0], [6, 1]];
        for (var i = 0; i < 2; i++) {
          c = CELLS[i + 1];
          panelBox(ctx, c);
          (function (a) {
            guideScene(ctx, inset(c, 12), FIELD_VIEW, function () {
              field(ctx, a[0], { color: a[1], lightT: 0.47, from: 1 }, { 1: { flash: 'catch', flashT: 0.35 } });
            });
          })(afters[i]);
        }
        textPlain(ctx, '或', (CELLS[1].x + CELLS[1].w + CELLS[2].x) / 2, 388, 24, P.textDim, 'center', true);
      }
    },
    {
      // 第 4 頁: 三格時間序; 兩顆環都從滿開始, 按住的那顆一直滿, 另一顆 12 → 9 → 6。無標注、無 HUD、無網與區域
      title: '抓著時環不走', text: '抓著時, 氣泡上的環停住不走',
      draw: function (ctx) {
        var others = [12, 9, 6];
        for (var i = 0; i < 3; i++) {
          var p = THREE[i];
          panelBox(ctx, p);
          (function (life) {
            guideScene(ctx, inset(p, 16), { x: 525, y: 300, w: 230, h: 120 }, function () {
              Art.drawInnerRing(ctx);
              bigBubble(ctx, 580, 360, 1.4, { color: 1, life: 12, mode: 'hold' });
              drawCursor(ctx, 592, 374, 26);
              bigBubble(ctx, 692, 360, 1.4, { color: 1, life: life, mode: 'idle' });
            });
          })(others[i]);
          if (i < 2) drawArrow(ctx, p.x + p.w + 6, 385, p.x + p.w + 34, 385, TIME_ARROW);
        }
      }
    },
    {
      // 第 5 頁: 三格, 每格上方一條命的「前 → 後」(都沒滿、都不在危險)。
      // 左 什麼都沒做, 命自己變短; 中 色 A 進亮著的色 A 網打勾, 命多一段(白); 右 環走完消失, 命少一段(紅殘影)
      title: '命的增減', text: '命會一直掉, 收下就回',
      draw: function (ctx) {
        function hpRow(c, a, b, arrowOpt) {
          smallHpBox(ctx, c.x + 12, c.y + 14, a);
          drawArrow(ctx, c.x + 176, c.y + 34, c.x + 194, c.y + 34, arrowOpt);
          smallHpBox(ctx, c.x + 198, c.y + 14, b);
        }
        function sceneRect(c) { return { x: c.x + 12, y: c.y + 68, w: c.w - 24, h: c.h - 80 }; }
        var c = CELLS[0];
        panelBox(ctx, c);
        hpRow(c, { hp: 64 }, { hp: 50 }, TIME_ARROW);
        guideScene(ctx, sceneRect(c), { x: 480, y: 200, w: 320, h: 374 }, function () {
          Art.drawInnerRing(ctx);
          Art.drawBubble(ctx, { x: 610, y: 340, color: null, life: 10, mode: 'idle' });
          Art.drawBubble(ctx, { x: 680, y: 420, color: 2, life: 8, mode: 'idle' });
        });
        c = CELLS[1];
        panelBox(ctx, c);
        hpRow(c, { hp: 50 }, { hp: 54, hpGainFx: 0.8, hpGainFrom: 50, hpGainKind: 'catch' }, { width: 3 });
        guideScene(ctx, sceneRect(c), { x: 770, y: 190, w: 290, h: 338 }, function () {
          field(ctx, 1, { hot: true });
          Art.drawBubble(ctx, { x: 930, y: 352, color: 0, life: 9, mode: 'drag' });
          drawCursor(ctx, 944, 368, 26);
          netMark(ctx, 940, 360, 1);
        });
        c = CELLS[2];
        panelBox(ctx, c);
        hpRow(c, { hp: 54 }, { hp: 48, hpFlash: 0.8, hpLossFrom: 54 }, { width: 3 });
        guideScene(ctx, sceneRect(c), { x: 480, y: 191, w: 290, h: 338 }, function () {
          Art.drawInnerRing(ctx);
          Art.drawBubble(ctx, { x: 540, y: 360, color: 1, life: 0.7, mode: 'idle' });
          drawArrow(ctx, 574, 360, 638, 360, TIME_ARROW);
          drawPop(ctx, 676, 360, 1);
        });
      }
    },
    {
      // 第 6 頁: 每格都有遊戲內的拍子提示(內圈邊線)與命。上排: 抓起、擦過染 A 沾上, 兩格都正在拍點上(邊線發光),
      // 動作處有踩拍回饋, 命多一段(拍子粉)。下排對照: 同樣抓起, 但在兩拍之間(收攏環在半路、邊線不亮),
      // 照樣抓起, 沒有回饋, 命沒多(不打叉、不畫失敗記號)。不畫送進網、不畫整串、不畫對拍方法
      title: '對上拍子', text: '動作對上拍子就回命',
      draw: function (ctx) {
        var cells = [
          { x: 40, y: 146, w: 590, h: 236 },
          { x: 650, y: 146, w: 590, h: 236 },
          { x: 345, y: 400, w: 590, h: 236 }
        ];
        var VIEW = { x: 420, y: 175, w: 300, h: 164 };
        var A = ZONE_MAP['染 A'];
        function hpCol(c, a, b) {
          smallHpBox(ctx, c.x + 14, c.y + 40, a);
          drawArrow(ctx, c.x + 94, c.y + 88, c.x + 94, c.y + 144, { width: 3 });
          smallHpBox(ctx, c.x + 14, c.y + 152, b);
        }
        function sceneRect(c) { return { x: c.x + 190, y: c.y + 12, w: c.w - 202, h: c.h - 24 }; }
        function grabScene(phase, onBeat) {
          Art.drawInnerRing(ctx);
          Art.drawBeatCue(ctx, { phase: phase });
          Art.drawPaintZone(ctx, { x: A.x, y: A.y, color: 0, status: 'on' });
          drawArrow(ctx, 586, 244, 548, 262, { dash: [8, 6], width: 4 });
          Art.drawBubble(ctx, { x: 604, y: 234, color: null, life: 11, mode: 'drag' });
          if (onBeat) Art.drawBeatFx(ctx, { x: 604, y: 234, t: 0.22 });
          drawCursor(ctx, 614, 244, 24);
        }
        var c = cells[0];
        panelBox(ctx, c);
        hpCol(c, { hp: 55 }, { hp: 57, hpGainFx: 0.85, hpGainFrom: 55, hpGainKind: 'beat' });
        guideScene(ctx, sceneRect(c), VIEW, function () { grabScene(0.03, true); });
        c = cells[1];
        panelBox(ctx, c);
        hpCol(c, { hp: 57 }, { hp: 59, hpGainFx: 0.85, hpGainFrom: 57, hpGainKind: 'beat' });
        guideScene(ctx, sceneRect(c), VIEW, function () {
          Art.drawInnerRing(ctx);
          Art.drawBeatCue(ctx, { phase: 0.03 });
          Art.drawPaintZone(ctx, { x: A.x, y: A.y, color: 0, status: 'on' });
          drawArrow(ctx, 640, 232, 556, 272, { dash: [8, 6], width: 4 });
          Art.drawBubble(ctx, { x: 530, y: 284, color: 0, life: 11, mode: 'drag', swipeFx: 0.5, swipeKind: 'paint' });
          Art.drawBeatFx(ctx, { x: 530, y: 284, t: 0.22 });
          drawCursor(ctx, 540, 294, 24);
        });
        c = cells[2];
        panelBox(ctx, c);
        hpCol(c, { hp: 55 }, { hp: 55 });
        guideScene(ctx, sceneRect(c), VIEW, function () { grabScene(0.5, false); });
      }
    },
    {
      // 第 7 頁: 命一路掉到空 → 結束畫面, 只示意存活時間(不畫分數與清場次數)
      title: '結束', text: '命用完就結束, 撐越久越好',
      draw: function (ctx) {
        hudLeft(ctx, 110, 190, { hp: 55, time: 120.0 });
        drawArrow(ctx, 230, 290, 230, 390, { width: 4, dash: [10, 8] });
        hudLeft(ctx, 110, 410, { hp: 0, danger: true, time: 187.4, hpFlash: 0.8, hpLossFrom: 5 });
        drawArrow(ctx, 370, 450, 470, 410, { width: 4 });
        guideScene(ctx, { x: 490, y: 190, w: 700, h: 394 }, { x: 0, y: 0, w: W, h: H }, function () {
          Art.drawEndScreen(ctx, { time: 187.4, _timeOnly: true });
        });
      }
    }
  ];

  window.Art = Art;
})();
