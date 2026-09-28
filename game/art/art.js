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
    bubble0: '#f4d03f',     // 黃
    bubble1: '#36c275',     // 綠
    bubble2: '#3a86ff',     // 藍
    bubble3: '#8a3ccf',     // 紫
    danger: '#ff4d4d',      // 扣命 / 錯網 / 快過期, 全遊戲只給「危險」用
    ok: '#ffffff',          // 打勾、續命成立光環
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

  var BUBBLE_R = 20, NET_R = 60;

  var L = {
    inner: { x: 640, y: 360, r: 200 },
    bubbleR: BUBBLE_R,
    netR: NET_R,
    // 建議網色: 上黃、右綠、下藍、左紫
    nets: [
      { x: 640, y: 70, color: 0 },
      { x: 930, y: 360, color: 1 },
      { x: 640, y: 650, color: 2 },
      { x: 350, y: 360, color: 3 }
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

  // 打勾 / 打叉貼在網的右上緣, 不蓋住網中央的目標數字
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

  // 命: 實心紅心 = 還在, 空心 = 已失去; flash 0~1 標出剛失去的那一格
  function drawHearts(ctx, x, y, hp, max, size, flash) {
    ctx.save();
    var gap = size * 1.3;
    for (var i = 0; i < max; i++) {
      var cx = x + size / 2 + i * gap, cy = y;
      var justLost = flash > 0 && i === hp;
      if (i < hp) {
        heartPath(ctx, cx, cy, size);
        ctx.fillStyle = P.danger;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
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
    drawHearts(ctx, x + 42, y + 26, s.hp == null ? 4 : s.hp, s.hpMax || 4, 26, s.hpFlash || 0);
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

    // state: { x, y, color, target, targetFx, hot, flash, flashT }
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

      // 目標數字: 中央深色圓盤(擋掉網格) + 大白字
      if (s.target != null) {
        var tf = clamp01(s.targetFx || 0);
        var dr = 27 * (1 + tf * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, dr, 0, TAU);
        ctx.fillStyle = 'rgba(10,12,20,0.88)';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = col;
        ctx.stroke();
        if (tf > 0) {
          ctx.beginPath();
          ctx.arc(x, y, dr + 4 + (1 - tf) * 10, 0, TAU);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,' + tf + ')';
          ctx.stroke();
        }
        textO(ctx, String(s.target), x, y + 2, Math.round(34 * (1 + tf * 0.18)), '#ffffff', 'center', true);
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

    // state: { x, y, color, timer, renewCount, mode, renewFx, renewFailFx, showRenew }
    drawBubble: function (ctx, s) {
      var R = BUBBLE_R;
      var col = COLORS[s.color] || '#ffffff';
      var mode = s.mode || 'idle';
      var timer = Math.max(0, s.timer || 0);
      var rc = s.renewCount || 0;
      var shown = Math.max(1, Math.ceil(timer)); // 12 → 1, 不顯示 0
      var urgent = shown <= 3;
      ctx.save();
      ctx.translate(s.x, s.y);
      if (mode === 'drag') {
        ctx.beginPath();
        ctx.ellipse(3, 12, 20, 8, 0, 0, TAU);
        ctx.fillStyle = P.shadow;
        ctx.fill();
        ctx.scale(1.15, 1.15);
        ctx.translate(0, -3);
      } else if (mode === 'return') {
        ctx.globalAlpha = 0.45;
      }
      // 倒數環(以 12 秒為滿, 各氣泡可直接比長短)
      ctx.beginPath();
      ctx.arc(0, 0, R + 3.5, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();
      var frac = clamp01(timer / 12);
      if (frac > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, R + 3.5, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
        ctx.lineWidth = urgent ? 4.5 : 3;
        ctx.strokeStyle = urgent ? P.danger : 'rgba(255,255,255,0.85)';
        ctx.stroke();
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
      var showRenew = s.showRenew !== false;
      // 倒數數字(有續命圓點時略往上讓位)
      textO(ctx, String(shown), 0, showRenew ? -3 : 1, 18, '#ffffff', 'center', true);
      // 剩餘可續次數: 氣泡下緣兩顆圓點, 亮白 = 還能續, 暗 = 已用掉
      // 用可數的圓點而不用數字, 避免和倒數讀混
      if (showRenew) {
        var left = Math.max(0, 2 - rc);
        var fail = clamp01(s.renewFailFx || 0);
        var jx = fail > 0 ? Math.sin(fail * 28) * 3 * fail : 0;
        for (var i = 0; i < 2; i++) {
          var px = (i === 0 ? -6 : 6) + jx, py = 12.5;
          ctx.beginPath();
          ctx.arc(px, py, 3.3, 0, TAU);
          if (i < left) {
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.lineWidth = 1.3;
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = fail > 0 ? 'rgba(255,77,77,' + (0.4 + fail * 0.6) + ')' : 'rgba(0,0,0,0.6)';
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    },

    // state: { hp, hpMax, time, paused, score, combo, hpFlash }
    drawHud: function (ctx, s) {
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
        bigBubble(ctx, W / 2 - 150 + i * 100, 295, 1.5, { color: i, timer: 12, renewCount: 0, showRenew: false });
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

    // state: { time, score, hover: 'retry'|'toTitle'|null }
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
      drawButton(ctx, e.retry, '再玩一次', s.hover === 'retry', 'primary');
      drawButton(ctx, e.toTitle, '回標題', s.hover === 'toTitle', 'normal');
      ctx.restore();
    },

    // state: { page: 1~5, hover: 'close'|'prev'|'next'|null }
    drawGuidePage: function (ctx, s) {
      s = s || {};
      var page = Math.max(1, Math.min(5, s.page || 1));
      var g = L.guide;
      var info = GUIDE[page - 1];
      ctx.save();
      Art.drawBackground(ctx);
      textPlain(ctx, info.title, W / 2, 56, 34, P.text, 'center', true);
      textPlain(ctx, info.text, W / 2, 108, 26, P.text, 'center', false);
      info.draw(ctx);
      drawButton(ctx, g.close, '關閉', s.hover === 'close', 'normal');
      if (page > 1) drawButton(ctx, g.prev, '上一頁', s.hover === 'prev', 'normal');
      if (page < 5) drawButton(ctx, g.next, '下一頁', s.hover === 'next', 'primary');
      textPlain(ctx, page + ' / 5', W / 2, 674, 20, P.textDim, 'center', false);
      ctx.restore();
    }
  };


  // ---------- 說明頁內容 ----------
  // 說明頁示意用的網目標數字(4 張互不相同, 範圍 3~10)
  var GUIDE_TARGETS = [5, 7, 4, 9];

  function allNets(ctx, overrides) {
    for (var i = 0; i < 4; i++) {
      var n = L.nets[i];
      var st = { x: n.x, y: n.y, color: n.color, target: GUIDE_TARGETS[i] };
      var o = overrides && overrides[i];
      if (o) for (var k in o) st[k] = o[k];
      Art.drawNet(ctx, st);
    }
  }

  // 第 1~3 頁的氣泡不放續命圓點
  function gb(ctx, st) {
    st.showRenew = false;
    Art.drawBubble(ctx, st);
  }

  // 說明頁用的左上 HUD 縮影: 與遊戲內同一個畫法, 只畫命那一列
  function smallHudBox(ctx, x, y, hp, flash) {
    var r = { x: x, y: y, w: 176, h: 48 };
    panelBox(ctx, r, 'rgba(26,33,48,0.9)');
    textPlain(ctx, '命', x + 14, y + 25, 14, P.textDim, 'left', false);
    drawHearts(ctx, x + 38, y + 24, hp, 4, 24, flash || 0);
  }

  var PANEL_L = { x: 80, y: 150, w: 540, h: 480 };
  var PANEL_R = { x: 660, y: 150, w: 540, h: 480 };
  function sceneRectIn(p) { return { x: p.x + 16, y: p.y + 76, w: p.w - 32, h: p.h - 92 }; }
  // 第 3 頁: 一格裡的「之前 → 之後」兩個瞬間
  function subRects(p) {
    return [
      { x: p.x + 16, y: p.y + 80, w: 228, h: 384 },
      { x: p.x + 296, y: p.y + 80, w: 228, h: 384 }
    ];
  }
  var TIME_ARROW = { width: 3, color: 'rgba(141,153,176,0.9)', dash: [8, 8] };
  var DRAG_ARROW = { dash: [10, 8], width: 4 };

  var GUIDE = [
    {
      title: '抓泡泡', text: '把氣泡拖進同色的網',
      draw: function (ctx) {
        guideScene(ctx, { x: 360, y: 145, w: 560, h: 490 }, { x: 260, y: 0, w: 790, h: 720 }, function () {
          Art.drawInnerRing(ctx);
          allNets(ctx, { 1: { hot: true } });
          gb(ctx, { x: 575, y: 300, color: 0, timer: 8.2, renewCount: 0 });
          gb(ctx, { x: 610, y: 440, color: 3, timer: 10.6, renewCount: 0 });
          gb(ctx, { x: 520, y: 380, color: 2, timer: 5.5, renewCount: 0 });
          drawGhost(ctx, 700, 350, 1);
          drawArrow(ctx, 724, 360, 866, 398, DRAG_ARROW);
          // 氣泡停在網的判定範圍內但偏離中央, 讓網上的數字露出來
          gb(ctx, { x: 895, y: 405, color: 1, timer: 6.4, renewCount: 0, mode: 'drag' });
          drawCursor(ctx, 899, 407, 28);
          netMark(ctx, 930, 360, 'catch', 1);
        });
      }
    },
    {
      title: '扣命', text: '放錯色或數字倒完都扣命',
      draw: function (ctx) {
        panelBox(ctx, PANEL_L);
        panelBox(ctx, PANEL_R);
        // 左: 放錯色(數字刻意和那張網相同, 看得出扣命是因為顏色)
        smallHudBox(ctx, PANEL_L.x + 16, PANEL_L.y + 16, 3, 0.8);
        guideScene(ctx, sceneRectIn(PANEL_L), { x: 410, y: 0, w: 460, h: 350 }, function () {
          Art.drawInnerRing(ctx);
          allNets(ctx, { 0: { hot: true } });
          drawGhost(ctx, 615, 255, 3);
          drawArrow(ctx, 613, 230, 604, 146, DRAG_ARROW);
          gb(ctx, { x: 602, y: 112, color: 3, timer: 4.6, renewCount: 0, mode: 'drag' });
          drawCursor(ctx, 606, 114, 26);
          netMark(ctx, 640, 70, 'wrong', 1);
        });
        // 右: 數字倒到 1, 之後消失(不出現 0)
        smallHudBox(ctx, PANEL_R.x + 16, PANEL_R.y + 16, 3, 0.8);
        guideScene(ctx, sceneRectIn(PANEL_R), { x: 440, y: 210, w: 400, h: 300 }, function () {
          Art.drawInnerRing(ctx);
          gb(ctx, { x: 520, y: 360, color: 2, timer: 1.6, renewCount: 2 });
          drawArrow(ctx, 556, 360, 600, 360, TIME_ARROW);
          gb(ctx, { x: 640, y: 360, color: 2, timer: 0.6, renewCount: 2 });
          drawArrow(ctx, 676, 360, 720, 360, TIME_ARROW);
          drawPop(ctx, 760, 360, 2);
        });
      }
    },
    {
      title: '數字要對上', text: '數字跟網一樣才收得下',
      draw: function (ctx) {
        panelBox(ctx, PANEL_L);
        panelBox(ctx, PANEL_R);
        var view = { x: 740, y: 180, w: 260, h: 360 };
        var net = { x: 930, y: 360, color: 1, target: 6 };
        function withNet(o) { var st = {}, k; for (k in net) st[k] = net[k]; for (k in o) st[k] = o[k]; return st; }
        var rl = subRects(PANEL_L), rr = subRects(PANEL_R);
        var ay = PANEL_L.y + 80 + 192;

        // 左: 同色但數字 8 ≠ 6 → 彈回內圈, 命沒少
        smallHudBox(ctx, PANEL_L.x + 16, PANEL_L.y + 16, 4, 0);
        guideScene(ctx, rl[0], view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, withNet({ hot: true }));
          drawGhost(ctx, 790, 330, 1);
          drawArrow(ctx, 812, 342, 872, 392, DRAG_ARROW);
          gb(ctx, { x: 900, y: 408, color: 1, timer: 7.5, renewCount: 0, mode: 'drag' });
          drawCursor(ctx, 904, 410, 28);
        });
        drawArrow(ctx, PANEL_L.x + 252, ay, PANEL_L.x + 288, ay, TIME_ARROW);
        guideScene(ctx, rl[1], view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, withNet({ flash: 'bounce', flashT: 0.3 }));
          drawGhost(ctx, 900, 408, 1);
          drawArrow(ctx, 884, 426, 846, 380, { width: 4, cx: 850, cy: 440 });
          gb(ctx, { x: 820, y: 360, color: 1, timer: 7.4, renewCount: 0, mode: 'return' });
        });

        // 右: 抓起時 6, 放到網上仍是 6 → 打勾; 對照的黃泡沒被抓, 同一段時間 9 → 7
        smallHudBox(ctx, PANEL_R.x + 16, PANEL_R.y + 16, 4, 0);
        guideScene(ctx, rr[0], view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, withNet({}));
          gb(ctx, { x: 795, y: 320, color: 1, timer: 5.3, renewCount: 0, mode: 'drag' });
          drawCursor(ctx, 799, 322, 28);
          gb(ctx, { x: 785, y: 425, color: 0, timer: 8.3, renewCount: 0 });
        });
        drawArrow(ctx, PANEL_R.x + 252, ay, PANEL_R.x + 288, ay, TIME_ARROW);
        guideScene(ctx, rr[1], view, function () {
          Art.drawInnerRing(ctx);
          Art.drawNet(ctx, withNet({ hot: true }));
          drawGhost(ctx, 795, 320, 1);
          drawArrow(ctx, 818, 334, 872, 390, DRAG_ARROW);
          gb(ctx, { x: 900, y: 408, color: 1, timer: 5.3, renewCount: 0, mode: 'drag' });
          drawCursor(ctx, 904, 410, 28);
          netMark(ctx, 930, 360, 'catch', 1);
          gb(ctx, { x: 785, y: 425, color: 0, timer: 6.3, renewCount: 0 });
        });
      }
    },
    {
      title: '雙擊重來', text: '雙擊回到 12, 最多兩次',
      draw: function (ctx) {
        var y = 400, k = 2.6, xs = [230, 490, 750, 1010];
        panelBox(ctx, { x: 80, y: 170, w: 1120, h: 430 });
        var dbl = 'rgba(255,255,255,0.9)', dim = 'rgba(141,153,176,0.9)';
        // 箭頭與標籤
        drawArrow(ctx, xs[0] + 70, y, xs[1] - 70, y, { width: 4, color: dbl });
        textPlain(ctx, '雙擊', (xs[0] + xs[1]) / 2, y - 26, 22, P.text, 'center', true);
        drawArrow(ctx, xs[1] + 70, y, xs[2] - 70, y, { width: 3, color: dim, dash: [8, 8] });
        textPlain(ctx, '等待', (xs[1] + xs[2]) / 2, y - 26, 22, P.textDim, 'center', false);
        drawArrow(ctx, xs[2] + 70, y, xs[3] - 70, y, { width: 4, color: dbl });
        textPlain(ctx, '雙擊', (xs[2] + xs[3]) / 2, y - 26, 22, P.text, 'center', true);
        // 最後一顆: 再雙擊沒反應(自我迴圈)
        drawArrow(ctx, xs[3] - 40, y - 78, xs[3] + 28, y - 84, { width: 3, color: dim, cx: xs[3] - 10, cy: y - 170 });
        textPlain(ctx, '雙擊: 沒反應', xs[3], y - 160, 20, P.textDim, 'center', true);
        // 四個瞬間: 5 / 還能 2 → 12 / 還能 1 → 9 / 還能 1 → 12 / 還能 0
        bigBubble(ctx, xs[0], y, k, { color: 2, timer: 4.4, renewCount: 0 });
        bigBubble(ctx, xs[1], y, k, { color: 2, timer: 12, renewCount: 1, renewFx: 0.35 });
        bigBubble(ctx, xs[2], y, k, { color: 2, timer: 8.4, renewCount: 1 });
        bigBubble(ctx, xs[3], y, k, { color: 2, timer: 12, renewCount: 2, renewFx: 0.35 });
        // 圖例: 氣泡下緣的圓點 = 還能雙擊幾次
        var lx = 452, ly = 548;
        for (var i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(lx + i * 20, ly, 7, 0, TAU);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.stroke();
        }
        textPlain(ctx, '= 還能雙擊幾次', lx + 36, ly, 20, P.textDim, 'left', false);
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
