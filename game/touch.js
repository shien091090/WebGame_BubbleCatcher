'use strict';
/* 觸控層 + 網站訊息(PVD計畫網站)。發布階段由 RD 從 game-studio-lab 的 references/touch-template.js 複製, 新加時只改下面的 CONFIG;
   已有舊版觸控層要更新版面時, 照發布任務(prompts/release-game.md)的說明換掉版面段落。
   傳統 script, 在 game.js 之後載入。網站版與打磨版共用同一份。
   - 觸控模式(手機 / 網址帶 ?touch=1):
     鍵盤遊戲 → 畫面上層畫虛擬按鈕, 輸入走遊戲的 inputDown / inputUp(和鍵盤同一條路徑), 鍵帽字換成手機版;
     滑鼠遊戲 → 不畫按鈕, 點擊就等於觸控(需要時把觸控轉成滑鼠事件), 遊戲區拖曳不捲動頁面;
     直拿手機時蓋提示並暫停。手機不放任何聲音按鈕, 交給手機本身的靜音與音量
   - 電腦與手機都有: 收 pvd:pause / pvd:resume 暫停 / 繼續(含音效)、Esc 暫停(CONFIG.escPause)、PVDX.finish() 通知網站玩完一局
   遊戲要掛的鉤子(設計見 game-studio-lab docs/2026-10-31-release-mobile-design.md):
     每幀 `if (!(window.PVDX && PVDX.paused)) update(dt);`, 畫完 `if (window.PVDX) PVDX.draw(ctx);`;
     一局結束 `if (window.PVDX) PVDX.finish();`;
     鍵盤遊戲另有全域 inputDown(k) / inputUp(k) / inputReset(), inputDown 開頭 `if (window.PVDX && PVDX.paused) return;` */
(function () {
  // ───────── 每款遊戲要改的設定 ─────────
  var CONFIG = {
    // 'keys': 鍵盤遊戲(虛擬按鈕) / 'mouse': 滑鼠遊戲(點擊即觸控) / 'none': 直式遊戲(不做觸控, 只做網站訊息與 Esc 暫停)
    mode: 'mouse',
    // 滑鼠遊戲: 遊戲聽 mousedown / mousemove / mouseup / click → true(觸控轉成滑鼠事件); 只聽 pointer 事件 → false(瀏覽器本來就會送)
    mouseEvents: true,
    // 遊戲自己沒有 Esc 暫停 → true, 由這裡提供暫停遮罩; 遊戲已有 → false
    escPause: false,
    // 方向鍵與 A / B / 第三鍵送進 inputDown 的鍵名(照 game.js 的鍵名); 用不到的設 null(不畫也不能按)
    // d: 功能鍵(例: 開圖鑑), 畫在設計區右上角(電腦版聲音開關圖示的位置); 沒有就設 null
    keys: { up: 'up', down: 'down', left: 'left', right: 'right', a: 'z', b: 'x', c: 'space', d: null },
    // B 與第三鍵永遠不會同時有用(例: B 只在選單裡、第三鍵只在自由走動時)→ true, 兩者共用同一格, 由 visible() 決定這格現在顯示哪個
    shareBC: false,
    // 遊戲裡畫的鍵帽字 → 觸控模式換成什麼: 字串 = 換成那個字, 'icon' = 改畫第三鍵圖示
    keycaps: { 'Z': 'A', 'X': 'B', '空白': 'icon' },
    // 每幀呼叫: 哪些按鈕要顯示(同時決定能不能按)。不能操作的畫面(自動翻頁、演出中)全部 false; 只收某個鍵的畫面只開那個鍵
    visible: function () { return { dpad: true, a: true, b: true, c: true, d: false }; },
    // 每幀呼叫: 方向鍵現在能不能斜走(按在兩段交界附近時同時按兩個方向)
    diagonal: function () { return false; },
    // 第三鍵圖示: 在 (x, y) 畫大小約 s 的圖案, color 是線色(按鈕與鍵帽共用)。換成玩家一看就懂動作的圖(例: 開商店 = 購物袋, 不用金幣這類要猜的符號);
    // 畫成按鈕時(s ≥ 40)圖下方加兩字動作名(例「購買」), 鍵帽尺寸只畫圖。文字用 origFill(未被鍵帽替換的 fillText)
    drawIcon: function (ctx, x, y, s, color) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.6, s * 0.14);
      ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    },
    // 功能鍵(d)圖示, 同上規則(例: 圖鑑 = 打開的書)
    drawIconD: function (ctx, x, y, s, color) { },
    // 暫停時整個聲音靜音(true), 繼續時還原成遊戲自己的靜音設定(false); 不動遊戲自己的靜音開關
    setAudioPaused: function (paused) { if (window.Sound && Sound.setMuted) Sound.setMuted(paused || !!(window.BubbleTempoMuted && BubbleTempoMuted())); },
    // 觸控時解鎖聲音(做遊戲第一次輸入時的聲音初始化); iOS 要在 touchend 才解得開, 這裡兩個時間點都會呼叫
    initAudio: function () { if (window.Sound && Sound.init) Sound.init(); },
  };

  // ───────── 版面: 設計區 1280×720 置中、上下貼邊不縮小(縮小後 HUD 字太小); 兩側多出來的寬度塗黑, 按鈕靠兩側擺 ─────────
  // 黑塊夠寬時按鈕置中在黑塊裡, 不夠寬(一般手機、1280 寬平板)就貼著畫面外緣, 壓到設計區邊緣一點
  var CW = (window.Art && Art.canvas && Art.canvas.width) || 1280, CH = (window.Art && Art.canvas && Art.canvas.height) || 720;
  var SW = (CW - 1280) / 2, RO = 124, BR = 72;   // SW: 一側黑塊寬; RO: 方向鍵外圈半徑; BR: A 鈕半徑
  var DX = Math.max(SW / 2, RO + 16), AX = CW - Math.max(SW / 2, BR + 20);
  var LAYOUT = {
    // 圓弧方向鍵: 中心 (x, y), 外圈半徑 Ro、內圈半徑 Ri, 四段相連不留縫(gap 0, 方便斜按時同時壓到兩段; 要留縫才調大); 可按範圍半徑 R(比外圈大, 手指偏出去也算), 中心 dead 內不算
    dpad: { x: DX, y: CH - RO - 80, Ro: RO, Ri: RO * 0.36, gap: 0, R: RO + 24, dead: 20 },
    a: { x: AX, y: CH - BR - 80, r: BR, hit: BR + 16 },
    b: { x: AX, y: CH - BR * 3 - 104, r: BR * 0.8, hit: BR * 0.8 + 16 },
    c: { x: AX, y: CH - BR * 5 - 128, r: BR * 0.8, hit: BR * 0.8 + 16 },
    // 功能鍵: 設計區右上角(設計座標約 (1240, 92), 頂端資訊列下方)
    d: { x: SW + 1240, y: 92, r: 30, hit: 44 },
  };
  if (CONFIG.shareBC) LAYOUT.c = LAYOUT.b;

  // ───────── 是不是觸控模式 ─────────
  var forced = /[?&]touch=1(&|$)/.test(location.search);
  var coarse = false, hover = false;
  try { coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { /* 略過 */ }
  try { hover = !!(window.matchMedia && matchMedia('(hover: hover)').matches); } catch (e) { /* 略過 */ }
  var hasTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
  var ON = CONFIG.mode !== 'none' && (forced || coarse || (hasTouch && !hover));
  var KEYS = CONFIG.mode === 'keys';

  var PVDX = { on: ON, paused: false, held: {}, draw: function () { }, finish: function () { } };
  window.PVDX = PVDX;
  function call(fn, arg) { try { fn(arg); } catch (e) { console.error(e); } }

  // ───────── 虛擬按鈕的畫法 ─────────
  var Pad = {
    body: function (ctx, lit) {
      ctx.fillStyle = lit ? 'rgba(255,210,74,0.85)' : 'rgba(26,32,48,0.5)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = lit ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)'; ctx.stroke();
    },
    arrow: function (ctx, x, y, rot, s, lit) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, 1.5); ctx.lineTo(3, 1.5); ctx.lineTo(3, 9); ctx.lineTo(-3, 9); ctx.lineTo(-3, 1.5); ctx.lineTo(-8, 1.5); ctx.closePath();
      ctx.fillStyle = lit ? '#1a2030' : 'rgba(255,255,255,0.88)'; ctx.fill();
      ctx.restore();
    },
    draw: function (ctx, held, vis) {
      var d = LAYOUT.dpad, K = CONFIG.keys, i;
      ctx.save();
      if (vis.dpad) {
        // 圓弧方向鍵: 一圈切成上右下左四段, 段與段相連, 只靠各段外框分界
        var dirs = [['up', -Math.PI / 2], ['right', 0], ['down', Math.PI / 2], ['left', Math.PI]], q = Math.PI / 4;
        for (i = 0; i < dirs.length; i++) {
          var c = dirs[i][1], lit = !!held[K[dirs[i][0]]], go = d.gap / 2 / d.Ro, gi = d.gap / 2 / d.Ri;
          if (!K[dirs[i][0]]) continue;
          ctx.beginPath(); ctx.arc(d.x, d.y, d.Ro, c - q + go, c + q - go); ctx.arc(d.x, d.y, d.Ri, c + q - gi, c - q + gi, true); ctx.closePath();
          this.body(ctx, lit);
          var mr = (d.Ro + d.Ri) / 2 + 4;
          this.arrow(ctx, d.x + Math.cos(c) * mr, d.y + Math.sin(c) * mr, c + Math.PI / 2, 2.4, lit);
        }
        ctx.beginPath(); ctx.arc(d.x, d.y, d.Ri - d.gap, 0, Math.PI * 2); ctx.fillStyle = 'rgba(26,32,48,0.3)'; ctx.fill();
      }
      var btns = [['a', 'A', Math.round(LAYOUT.a.r * 0.8)], ['b', 'B', Math.round(LAYOUT.b.r * 0.8)], ['c', null, 0], ['d', null, 0]];
      for (i = 0; i < btns.length; i++) {
        var id = btns[i][0], b = LAYOUT[id];
        if (!vis[id] || !K[id]) continue;
        var on = !!held[K[id]], fg = on ? '#1a2030' : 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); this.body(ctx, on);
        if (btns[i][1]) {
          ctx.font = 'bold ' + btns[i][2] + 'px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = fg;
          origFill.call(ctx, btns[i][1], b.x, b.y + 2);
        } else if (id === 'd') call(function () { CONFIG.drawIconD(ctx, b.x, b.y, b.r * 1.5, fg); });
        else call(function () { CONFIG.drawIcon(ctx, b.x, b.y, b.r * 1.15, fg); });
      }
      ctx.restore();
    },
  };
  var proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  var origFill = proto && proto.fillText;

  // ───────── 暫停(網站訊息、直拿、Esc) ─────────
  var sitePause = false, needTap = false, portrait = false, keyPause = false, audioHeld = false, ov = null, ovKey = '';
  function showOverlay(big, small) {
    if (!ov) {
      ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;flex-direction:column;' +
        'background:rgba(8,10,16,0.9);color:#fff;z-index:99;text-align:center;font-family:"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif;' +
        'user-select:none;-webkit-user-select:none;padding:20px;box-sizing:border-box;';
      document.body.appendChild(ov);
    }
    var key = big + '|' + small;
    if (key !== ovKey) {
      ovKey = key; ov.innerHTML = '';
      var a = document.createElement('div'); a.style.cssText = 'font-size:26px;font-weight:bold;line-height:1.5;'; a.textContent = big; ov.appendChild(a);
      if (small) { var b = document.createElement('div'); b.style.cssText = 'font-size:16px;color:#9aa6bd;margin-top:8px;'; b.textContent = small; ov.appendChild(b); }
    }
    ov.style.display = 'flex';
  }
  function hideOverlay() { if (ov) { ov.style.display = 'none'; ovKey = ''; } }
  function applyPause() {
    var p = sitePause || needTap || portrait || keyPause;
    if (p && !PVDX.paused) {
      releaseAll();   // 暫停那一刻放開所有按住的鍵(含鍵盤)
      if (KEYS && typeof inputReset === 'function') call(inputReset);
    }
    PVDX.paused = p;
    if (p !== audioHeld) { audioHeld = p; call(CONFIG.setAudioPaused, p); }
    if (!p) hideOverlay();
    else if (portrait) showOverlay('請把手機轉成橫向', '轉成橫向後遊戲會繼續');
    else if (needTap) showOverlay(ON ? '點一下繼續' : '點擊或按任意鍵繼續', '');
    else if (keyPause) showOverlay('遊戲暫停中', '按 Esc 繼續');
    else showOverlay('遊戲暫停中', '');
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'pvd:pause') { sitePause = true; needTap = false; applyPause(); }
    else if (d.type === 'pvd:resume') { if (sitePause) { sitePause = false; needTap = true; applyPause(); } }
  });
  // 等「點一下繼續」: 這一下只拿來解除暫停, 不傳給遊戲
  function tapResume() {
    if (!needTap || sitePause) return false;
    needTap = false; applyPause();
    call(CONFIG.initAudio);
    return true;
  }
  window.addEventListener('keydown', function (e) {
    var esc = CONFIG.escPause && (e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape');
    if (esc) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat || sitePause || portrait) return;
      if (!tapResume()) { keyPause = !keyPause; applyPause(); }
      return;
    }
    if (!PVDX.paused) return;
    e.preventDefault(); e.stopImmediatePropagation();
    tapResume();
  }, true);
  window.addEventListener('keyup', function (e) { if (PVDX.paused) e.stopImmediatePropagation(); }, true);
  // 暫停中滑鼠 / 觸控事件不進遊戲(捕獲階段在遊戲自己的監聽之前); 等點一下繼續時, 按下那一下用來解除暫停
  ['mousedown', 'mouseup', 'mousemove', 'click', 'pointerdown', 'pointerup', 'pointermove', 'wheel'].forEach(function (t) {
    window.addEventListener(t, function (e) {
      if (!PVDX.paused) return;
      e.stopImmediatePropagation();
      if (t === 'mousedown' || t === 'pointerdown') tapResume();
    }, true);
  });

  // 玩完一局: 通知上層網站(不在 iframe 裡就不送)
  PVDX.finish = function () {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'pvd:finish' }, location.origin); } catch (e) { /* 本機 file:// 開啟時略過 */ }
  };

  // ───────── 觸控模式 ─────────
  var held = {}, cur = {}, touches = {};   // held: 目前要按住的鍵; cur: 已經送進遊戲的; touches: id → {x, y}(邏輯座標)
  function releaseAll() {
    var k;
    if (KEYS) for (k in cur) { if (cur[k] && typeof inputUp === 'function') call(inputUp, k); }
    cur = {}; held = {}; touches = {}; PVDX.held = held; mouseId = null;
  }

  if (!ON) return;

  // 頁面設定: 固定視窗、不捲動 / 縮放 / 選取
  (function () {
    var meta = document.querySelector('meta[name=viewport]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    var st = document.createElement('style');
    st.textContent = 'html,body{position:fixed;left:0;top:0;width:100%;height:100%;touch-action:none;overscroll-behavior:none;' +
      '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}' +
      'canvas{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}';
    document.head.appendChild(st);
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('selectstart', function (e) { e.preventDefault(); });
  })();

  var cv = document.querySelector('canvas');
  function toLogical(t) {
    var r = cv.getBoundingClientRect();
    return { x: (t.clientX - r.left) * CW / (r.width || 1), y: (t.clientY - r.top) * CH / (r.height || 1) };
  }
  // 一根手指對應到哪些鍵
  function keysAt(p, out, vis) {
    var d = LAYOUT.dpad, K = CONFIG.keys, dx = p.x - d.x, dy = p.y - d.y, dd = Math.hypot(dx, dy);
    if (!p.btn && vis.dpad && dd <= d.R && dd >= d.dead) {
      var ax = Math.abs(dx), ay = Math.abs(dy), ratio = ax > 0 ? ay / ax : 99, h = K[dx < 0 ? 'left' : 'right'], v = K[dy < 0 ? 'up' : 'down'];
      if (CONFIG.diagonal() && ratio > 0.58 && ratio < 1.73) { if (h) out[h] = true; if (v) out[v] = true; }
      else if (ax >= ay) { if (h) out[h] = true; }
      else if (v) out[v] = true;
      return;
    }
    // 手指碰到哪顆按鈕就綁定那顆, 放開前只認它: 共用位置的按鈕(shareBC)按下後換了用途, 按住的手指不會接著觸發新的那顆
    var best = p.btn || null, bd = 1e9;
    if (!best) ['a', 'b', 'c', 'd'].forEach(function (id) {
      if (!vis[id] || !K[id]) return;
      var b = LAYOUT[id], dist = Math.hypot(p.x - b.x, p.y - b.y);
      if (dist <= b.hit && dist < bd) { bd = dist; best = id; }
    });
    if (!best) return;
    p.btn = best;
    var bb = LAYOUT[best];
    if (vis[best] && K[best] && Math.hypot(p.x - bb.x, p.y - bb.y) <= bb.hit) out[K[best]] = true;
  }
  function recompute() {
    var want = {}, id, k, vis = CONFIG.visible();
    if (!PVDX.paused) for (id in touches) keysAt(touches[id], want, vis);
    for (k in want) if (!cur[k]) { cur[k] = true; call(inputDown, k); }
    for (k in cur) if (cur[k] && !want[k]) { cur[k] = false; call(inputUp, k); }
    held = want; PVDX.held = held;
  }
  // 滑鼠遊戲: 第一根手指當成滑鼠
  var mouseId = null;
  function fireMouse(type, t) {
    if (!CONFIG.mouseEvents) return;
    var ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1 });
    (document.elementFromPoint(t.clientX, t.clientY) || cv).dispatchEvent(ev);
  }
  function onTouch(e) {
    e.preventDefault();
    var list = e.changedTouches, i, t, end = e.type === 'touchend' || e.type === 'touchcancel';
    if (e.type === 'touchstart' && !PVDX.paused) call(CONFIG.initAudio);
    if (e.type === 'touchend') { call(CONFIG.initAudio); if (needTap) { tapResume(); return; } }
    if (PVDX.paused) return;
    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (KEYS) { if (end) delete touches[t.identifier]; else { var o = touches[t.identifier], q = toLogical(t); if (o) { o.x = q.x; o.y = q.y; } else touches[t.identifier] = q; } continue; }
      if (e.type === 'touchstart' && mouseId === null) { mouseId = t.identifier; fireMouse('mousemove', t); fireMouse('mousedown', t); }
      else if (t.identifier === mouseId) {
        if (e.type === 'touchmove') fireMouse('mousemove', t);
        else if (end) { mouseId = null; fireMouse('mouseup', t); if (e.type === 'touchend') fireMouse('click', t); }
      }
    }
    if (KEYS) recompute();
  }
  var opt = { passive: false };
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) { window.addEventListener(t, onTouch, opt); });
  window.addEventListener('blur', function () { releaseAll(); mouseId = null; });

  // 直拿提示
  function checkOrient() {
    var p = window.innerHeight > window.innerWidth;
    if (p !== portrait) { portrait = p; applyPause(); }
  }
  window.addEventListener('resize', checkOrient);
  window.addEventListener('orientationchange', function () { setTimeout(checkOrient, 100); });
  checkOrient();

  // 鍵帽換成手機版: 遊戲裡用 fillText 畫的鍵帽字照 CONFIG.keycaps 換字或改畫第三鍵圖示
  if (KEYS && proto && origFill) {
    proto.fillText = function (str, x, y, mw) {
      var to = Object.prototype.hasOwnProperty.call(CONFIG.keycaps, str) ? CONFIG.keycaps[str] : null;
      if (to === 'icon') {
        var m = /([0-9.]+)px/.exec(this.font), size = m ? parseFloat(m[1]) : 16, ctx = this;
        call(function () { CONFIG.drawIcon(ctx, x, y, size * 1.5, ctx.fillStyle); });
        return;
      }
      if (to !== null) str = to;
      return mw === undefined ? origFill.call(this, str, x, y) : origFill.call(this, str, x, y, mw);
    };
  }

  // 每幀畫在遊戲畫面上層
  PVDX.draw = function (ctx) {
    checkOrient();
    // 兩側黑塊(只有鍵盤遊戲): 遊戲畫到設計區外的背景、壓暗、HUD 延伸一律蓋掉; 滑鼠遊戲沒有按鈕, 兩側留給遊戲往外延伸的背景
    if (SW > 0 && CONFIG.mode === 'keys') { ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SW, CH); ctx.fillRect(CW - SW, 0, SW, CH); ctx.restore(); }
    if (!KEYS) return;
    for (var id in touches) { recompute(); break; }   // 場景換了(按鈕顯示變了)而手指還按著: 重新判定
    Pad.draw(ctx, held, CONFIG.visible());
  };
})();
