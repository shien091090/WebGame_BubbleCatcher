// 捕泡手 美術: 全部 Canvas 2D 幾何繪製, 不引外部資源。
// 只負責「給狀態就畫」, 不含遊戲邏輯。規格與 state 欄位見 style.md。
(function () {
  'use strict';

  var W = 1280, H = 720;
  var FONT = "'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif";
  var TAU = Math.PI * 2;

  var P = {
    bg: '#10141f',          // 背景 = 內圈外區域(不可停放)
    ring: '#1d2536',        // 內圈地面
    ringEdge: '#6b7ea3',    // 內圈邊線
    bubble0: '#f4d03f',     // 黃(色 A)
    bubble1: '#36c275',     // 綠(色 B)
    bubble2: '#3a86ff',     // 藍(色 C)
    bubble3: '#8a3ccf',     // 紫(色 D)
    danger: '#ff4d4d',      // 扣命 / 錯網 / 快過期, 全遊戲只給「危險」用
    ok: '#ffffff',          // 打勾、續命成立光環、回命光環
    frozen: '#7fdcff',      // 被按住 / 拖曳中: 倒數凍結(秒環變冰藍)
    text: '#eef2f8',
    textDim: '#8d99b0',
    nextText: '#c3cddc',    // 網上「下一個」小數字
    panel: '#1a2130',
    panelEdge: '#3a4660',
    button: '#27314a',
    buttonHover: '#34405e',
    primary: '#e8edf5',
    primaryText: '#10141f',
    shadow: 'rgba(0,0,0,0.45)'
  };
  var COLORS = [P.bubble0, P.bubble1, P.bubble2, P.bubble3];

  var BUBBLE_R = 20, NET_R = 60;
  // 網上兩個數字的位置(相對網中心)
  var CUR_DY = -9, CUR_R = 25, CUR_FONT = 32;
  var NEXT_DY = 35, NEXT_R = 14, NEXT_FONT = 17;

  var L = {
    inner: { x: 640, y: 360, r: 200 },
    bubbleR: BUBBLE_R,
    netR: NET_R,
    // 網 1~8, 從正上方順時針; 網 1、2 色 0, 網 3、4 色 1, 網 5、6 色 2, 網 7、8 色 3
    nets: [
      { id: 1, x: 640, y: 70, color: 0 },
      { id: 2, x: 845, y: 155, color: 0 },
      { id: 3, x: 930, y: 360, color: 1 },
      { id: 4, x: 845, y: 565, color: 1 },
      { id: 5, x: 640, y: 650, color: 2 },
      { id: 6, x: 435, y: 565, color: 2 },
      { id: 7, x: 350, y: 360, color: 3 },
      { id: 8, x: 435, y: 155, color: 3 }
    ],
    hudLeft: { x: 20, y: 20, w: 240, h: 80 },
    hudRight: { x: 960, y: 20, w: 220, h: 80 },
    pauseButton: { x: 1206, y: 26, w: 48, h: 48 },
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

  // 描邊文字: 任何底色上都讀得到
  function textO(ctx, str, x, y, size, color, align, bold) {
    ctx.font = font(size, bold !== false);
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.18);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
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

  function drawCross(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineCap = 'round';
    var d = s * 0.4;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
    ctx.lineWidth = s * 0.3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();
    ctx.lineWidth = s * 0.18;
    ctx.strokeStyle = P.danger;
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

  // 說明頁用: 雙擊 = 指標 + 尖端左上兩道弧(兩下)
  function drawDoubleClick(ctx, x, y, size) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (var i = 0; i < 2; i++) {
      var rr = 9 + i * 8;
      ctx.beginPath();
      ctx.arc(x, y, rr, Math.PI * 1.05, Math.PI * 1.45);
      ctx.stroke();
    }
    ctx.restore();
    drawCursor(ctx, x, y, size);
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

  // 說明頁用: 氣泡原本的位置(虛線空圈)。只用虛線空圈表示「之前在這裡」,
  // 不用半透明, 因為半透明在遊戲內代表「彈回中」
  function drawGhost(ctx, x, y, color) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS[color];
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, BUBBLE_R, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // 打勾 / 打叉貼在網的右上緣, 不蓋住網上的兩個數字
  function netMark(ctx, x, y, kind, alpha) {
    var mx = x + NET_R * 0.72, my = y - NET_R * 0.72;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(mx, my, 20, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,20,0.85)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = kind === 'catch' ? P.ok : P.danger;
    ctx.stroke();
    ctx.restore();
    if (kind === 'catch') drawCheck(ctx, mx, my + 1, 28, alpha);
    else drawCross(ctx, mx, my, 30, alpha);
  }

  // 說明頁用: 氣泡過期消失
  function drawPop(ctx, x, y, color) {
    ctx.save();
    ctx.strokeStyle = COLORS[color];
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
    // (x, y) 為中心, s 為寬
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
    if (s.paused) {
      drawPauseIcon(ctx, x + r.w - 26, y + 60, 18, P.textDim);
    }
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

  // 網上的一個數字圓盤(當前 = 大, 下一個 = 小)
  function netDisc(ctx, x, y, r, col, edgeW, str, size, txtCol) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,20,0.88)';
    ctx.fill();
    ctx.lineWidth = edgeW;
    ctx.strokeStyle = col;
    ctx.stroke();
    textO(ctx, str, x, y + size * 0.06, size, txtCol, 'center', true);
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

    // state: { x, y, color, target, next, targetFx, hot, flash, flashT }
    drawNet: function (ctx, s) {
      var col = COLORS[s.color] || '#ffffff';
      var x = s.x, y = s.y, r = NET_R;
      var i;
      ctx.save();
      // 底
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 網格
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
      // 外框
      ctx.lineWidth = 5;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();

      var tf = clamp01(s.targetFx || 0);
      // 下一個數字: 當前的正下方, 小圓盤 + 小字 + 較暗的字色(權重低於當前)
      if (s.next != null) {
        var nr = NEXT_R * (1 + tf * 0.25);
        netDisc(ctx, x, y + NEXT_DY, nr, col, 1.5, String(s.next), Math.round(NEXT_FONT * (1 + tf * 0.25)), P.nextText);
      }
      // 當前數字: 全場最大的字
      if (s.target != null) {
        var dr = CUR_R * (1 + tf * 0.18);
        netDisc(ctx, x, y + CUR_DY, dr, col, 2.5, String(s.target), Math.round(CUR_FONT * (1 + tf * 0.18)), '#ffffff');
        if (tf > 0) {
          ctx.beginPath();
          ctx.arc(x, y + CUR_DY, dr + 4 + (1 - tf) * 10, 0, TAU);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,' + tf + ')';
          ctx.stroke();
        }
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
          netMark(ctx, x, y, 'catch', a);
        } else if (s.flash === 'wrong') {
          ctx.strokeStyle = P.danger;
          ctx.beginPath(); ctx.arc(x, y, r + 4 + t * 22, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          netMark(ctx, x, y, 'wrong', a);
        } else if (s.flash === 'bounce') {
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath(); ctx.arc(x, y, r + 4 + t * 10, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    },

    // state: { x, y, color, timer, mode: 'idle'|'hold'|'drag'|'return', renewFx }
    drawBubble: function (ctx, s) {
      var R = BUBBLE_R;
      var col = COLORS[s.color] || '#ffffff';
      var mode = s.mode || 'idle';
      var timer = Math.max(0, s.timer || 0);
      var shown = Math.max(1, Math.ceil(timer)); // 12 → 1, 不顯示 0
      var urgent = shown <= 3;
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
      // 秒環: 一圈 = 目前顯示的這一秒。滿圈 = 這個數字剛出現, 走空 = 數字要往下跳了。
      // 每秒歸零重跑; 被按住 / 拖曳中凍結(RD 停住 timer), 環變冰藍
      ctx.beginPath();
      ctx.arc(0, 0, R + 3.5, 0, TAU);
      ctx.lineWidth = frozen ? 5 : 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      var frac = timer > 0 ? clamp01(timer - (shown - 1)) : 0;
      if (frac > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, R + 3.5, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
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
      // 本體
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(-7, -9, 6.5, 3.5, -0.6, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fill();
      ctx.restore();
      // 續命成立回饋
      var fx = clamp01(s.renewFx || 0);
      if (fx > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,' + (fx * 0.45) + ')';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, R + 6 + (1 - fx) * 18, 0, TAU);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,' + fx + ')';
        ctx.stroke();
        ctx.restore();
      }
      // 倒數數字(氣泡上唯一的標示)
      textO(ctx, String(shown), 0, 1, 18, '#ffffff', 'center', true);
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
      // 按鈕上: 上半雙豎線圖示, 下半「暫停」字樣
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
      for (var i = 0; i < 4; i++) {
        bigBubble(ctx, W / 2 - 150 + i * 100, 295, 1.5, { color: i, timer: 12 });
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
      // 選用備註(例: 紀錄已下載): 卡片與按鈕之間, 小字低對比
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
      if (info.text && info.text !== info.title) {
        textPlain(ctx, info.title, W / 2, 56, 34, P.text, 'center', true);
        textPlain(ctx, info.text, W / 2, 108, 26, P.text, 'center', false);
      } else {
        textPlain(ctx, info.title, W / 2, 80, 34, P.text, 'center', true);
      }
      info.draw(ctx);
      drawButton(ctx, g.close, '關閉', s.hover === 'close', 'normal');
      if (page > 1) drawButton(ctx, g.prev, '上一頁', s.hover === 'prev', 'normal');
      if (page < n) drawButton(ctx, g.next, '下一頁', s.hover === 'next', 'primary');
      textPlain(ctx, page + ' / ' + n, W / 2, 674, 20, P.textDim, 'center', false);
      ctx.restore();
    }
  };


  // ---------- 說明頁內容 ----------
  // 說明頁示意用的網當前數字(網 1~8; 同色兩張互不相同, 範圍 3~10)
  var GUIDE_TARGETS = [5, 8, 6, 4, 7, 3, 9, 10];

  // 畫 8 張網; 說明頁第 1~3 頁只放當前數字(next 不傳)
  function allNets(ctx, overrides) {
    for (var i = 0; i < 8; i++) {
      var n = L.nets[i];
      var st = { x: n.x, y: n.y, color: n.color, target: GUIDE_TARGETS[i] };
      var o = overrides && overrides[i];
      if (o) for (var k in o) st[k] = o[k];
      Art.drawNet(ctx, st);
    }
  }
  function netAt(i, o) {
    var n = L.nets[i];
    var st = { x: n.x, y: n.y, color: n.color, target: GUIDE_TARGETS[i] };
    if (o) for (var k in o) st[k] = o[k];
    return st;
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
  var DRAG_ARROW = { dash: [10, 8], width: 4 };
  var FIELD_VIEW = { x: 275, y: 0, w: 730, h: 720 };

  var THREE = [
    { x: 60, y: 150, w: 360, h: 480 },
    { x: 460, y: 150, w: 360, h: 480 },
    { x: 860, y: 150, w: 360, h: 480 }
  ];

  var GUIDE = [
    {
      // 第 1 頁 收泡泡: 同一張綠網 6; 左 6 收下打勾, 右 8 彈回、命沒少
      title: '收泡泡', text: '同色、同數字才收得下',
      draw: function (ctx) {
        var PL = { x: 50, y: 140, w: 580, h: 500 }, PR = { x: 650, y: 140, w: 580, h: 500 };
        panelBox(ctx, PL);
        panelBox(ctx, PR);
        guideScene(ctx, inset(PL, 10), FIELD_VIEW, function () {
          Art.drawInnerRing(ctx);
          allNets(ctx, { 2: { hot: true } });
          drawGhost(ctx, 750, 316, 1);
          drawArrow(ctx, 774, 328, 862, 386, DRAG_ARROW);
          bigBubble(ctx, 898, 405, 1.3, { color: 1, timer: 5.5, mode: 'drag' });
          drawCursor(ctx, 916, 424, 32);
          netMark(ctx, 930, 360, 'catch', 1);
        });
        guideScene(ctx, inset(PR, 10), FIELD_VIEW, function () {
          Art.drawInnerRing(ctx);
          allNets(ctx, { 2: { flash: 'bounce', flashT: 0.3 } });
          bigBubble(ctx, 898, 405, 1.3, { color: 1, timer: 7.5, mode: 'drag' });
          drawCursor(ctx, 916, 424, 32);
          drawArrow(ctx, 872, 436, 812, 410, { width: 4, cx: 852, cy: 478 });
          bigBubble(ctx, 780, 392, 1.3, { color: 1, timer: 7.4, mode: 'return' });
        });
        // 右格左上角: 命 4 格沒少
        smallHudBox(ctx, PR.x + 18, PR.y + 18, 4, 0, 0);
      }
    },
    {
      // 第 2 頁: 三格時間序, 兩顆同色都從 9 起; 按住的那顆不走, 另一顆 9 → 8 → 7。圖上不加標注、不出現網
      title: '抓著時數字不走', text: '抓著時數字不走',
      draw: function (ctx) {
        var others = [8.6, 7.6, 6.6];
        for (var i = 0; i < 3; i++) {
          var p = { x: THREE[i].x, y: 170, w: 360, h: 430 };
          panelBox(ctx, p);
          guideScene(ctx, inset(p, 16), { x: 545, y: 290, w: 190, h: 140 }, function () {
            Art.drawInnerRing(ctx);
            Art.drawBubble(ctx, { x: 595, y: 360, color: 2, timer: 8.6, mode: 'hold' });
            drawCursor(ctx, 608, 373, 22);
            Art.drawBubble(ctx, { x: 685, y: 360, color: 2, timer: others[i] });
          });
          if (i < 2) drawArrow(ctx, p.x + p.w + 6, 385, p.x + p.w + 34, 385, TIME_ARROW);
        }
      }
    },
    {
      // 第 3 頁: 左 抓對 3 → 4 格; 中 錯色(數字刻意相同)少一格; 右 倒到 1 後消失少一格
      title: '命的增減', text: '抓對回命, 放錯或倒完扣命',
      draw: function (ctx) {
        var netView = { x: 520, y: 0, w: 240, h: 280 };
        var pL = THREE[0], pM = THREE[1], pR = THREE[2];
        panelBox(ctx, pL); panelBox(ctx, pM); panelBox(ctx, pR);

        smallHudBox(ctx, pL.x + 16, pL.y + 16, 4, 0, 0.8);
        guideScene(ctx, belowHud(pL), netView, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, netAt(0, { hot: true }));
          drawGhost(ctx, 612, 240, 0);
          drawArrow(ctx, 612, 216, 612, 142, DRAG_ARROW);
          Art.drawBubble(ctx, { x: 612, y: 112, color: 0, timer: 4.5, mode: 'drag' });
          drawCursor(ctx, 628, 127, 26);
          netMark(ctx, 640, 70, 'catch', 1);
        });

        smallHudBox(ctx, pM.x + 16, pM.y + 16, 3, 0.8, 0);
        guideScene(ctx, belowHud(pM), netView, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, netAt(0, { hot: true }));
          drawGhost(ctx, 612, 240, 3);
          drawArrow(ctx, 612, 216, 612, 142, DRAG_ARROW);
          Art.drawBubble(ctx, { x: 612, y: 112, color: 3, timer: 4.5, mode: 'drag' });
          drawCursor(ctx, 628, 127, 26);
          netMark(ctx, 640, 70, 'wrong', 1);
        });

        smallHudBox(ctx, pR.x + 16, pR.y + 16, 3, 0.8, 0);
        guideScene(ctx, belowHud(pR), { x: 495, y: 260, w: 290, h: 200 }, function () {
          Art.drawInnerRing(ctx);
          Art.drawBubble(ctx, { x: 540, y: 360, color: 1, timer: 1.6 });
          drawArrow(ctx, 568, 360, 610, 360, TIME_ARROW);
          Art.drawBubble(ctx, { x: 640, y: 360, color: 1, timer: 0.6 });
          drawArrow(ctx, 668, 360, 710, 360, TIME_ARROW);
          drawPop(ctx, 740, 360, 1);
        });
      }
    },
    {
      // 第 4 頁: 同一張網收下一顆前後; 前 6 / 小 9, 後 9 / 小 4
      title: '下一個數字', text: '網上小數字是下一個',
      draw: function (ctx) {
        var PL = { x: 80, y: 150, w: 500, h: 470 }, PR = { x: 700, y: 150, w: 500, h: 470 };
        var view = { x: 790, y: 230, w: 260, h: 260 };
        panelBox(ctx, PL);
        panelBox(ctx, PR);
        guideScene(ctx, inset(PL, 16), view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, netAt(2, { target: 6, next: 9, hot: true }));
          Art.drawBubble(ctx, { x: 878, y: 372, color: 1, timer: 5.5, mode: 'drag' });
          drawCursor(ctx, 893, 388, 24);
          netMark(ctx, 930, 360, 'catch', 1);
        });
        drawArrow(ctx, PL.x + PL.w + 18, 385, PR.x - 18, 385, { width: 4 });
        guideScene(ctx, inset(PR, 16), view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, netAt(2, { target: 9, next: 4 }));
        });
      }
    },
    {
      // 第 5 頁: 5 → 雙擊 → 12; 下方虛線回到左邊 = 走著走著又能再雙擊(不限次數), 不用字講。無網
      title: '雙擊重來', text: '雙擊回到 12',
      draw: function (ctx) {
        var y = 390, k = 2.6, x1 = 400, x2 = 880;
        panelBox(ctx, { x: 80, y: 160, w: 1120, h: 460 });
        // 上: 雙擊(實線)
        drawArrow(ctx, x1 + 60, y - 70, x2 - 60, y - 70, { width: 5, cx: 640, cy: y - 190 });
        drawDoubleClick(ctx, 640, y - 196, 44);
        // 下: 時間走回去(虛線), 形成循環 = 可以重複做
        drawArrow(ctx, x2 - 60, y + 70, x1 + 60, y + 70, { width: 3, color: 'rgba(141,153,176,0.9)', dash: [8, 8], cx: 640, cy: y + 190 });
        bigBubble(ctx, x1, y, k, { color: 2, timer: 4.4 });
        bigBubble(ctx, x2, y, k, { color: 2, timer: 12, renewFx: 0.35 });
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
