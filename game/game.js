// 捕泡手 遊戲邏輯(spec v4)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art。
// v4 相對 v2 的規則重點: 網冷卻整套刪除, 改成「目標數字對數捕捉」; 續命固定重設回 12, 無門檻,
// 最多 2 次; 拖曳中倒數凍結; 末命保護重抽; 埋點整段重寫(窗口 / 命 / 30 秒分段)。
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var INNER = L.inner;                // {x:640,y:360,r:200}
  var BUBBLE_R = L.bubbleR;           // 20
  var NET_R = L.netR;                 // 60
  var MOVE_R = INNER.r - BUBBLE_R;    // 180, 氣泡中心可活動半徑
  var NETS_DEF = L.nets;              // 4 張網定義 {x,y,color}

  var BUILD_VERSION = 'demo-v4-0.1.0';

  var PARAMS = {
    bubbleRadius: BUBBLE_R,
    netRadius: NET_R,
    innerCapacityK: 30,
    spawnGap: 4,
    spawnTries: 10,
    spawnRetryInterval: 0.25,
    firstSpawnDelay: 1.0,
    initialTimer: 12,
    renewMax: 2,
    renewResetValue: 12,
    spawnRateBase: 0.30,
    spawnRateSlope: 0.003,
    spawnJitter: 0.4,
    minSpawnInterval: 0.25,
    sameColorStreakCap: 3,
    hpMax: 4,
    doubleClickTolerance: 20,
    expireHpLoss: 1,
    wrongNetHpLoss: 1,
    sameColorMismatchHpLoss: 0,
    doubleClickWindowMs: 350,
    dragStartDistance: 6,
    returnDuration: 0.2,
    scoreBase: 10,
    comboBonusPerStreak: 0.1,
    comboStreakCap: 20,
    sampleInterval: 1.0,
    targetMin: 3,
    targetMax: 10,
    lastStandDisplayThreshold: 4,
    segmentMs: 30000
  };

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function displayOf(timer) { return Math.max(1, Math.ceil(timer)); }
  function pickFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 玩家 ID 與局數(沿用同一瀏覽器) ----------
  var PLAYER_ID_KEY = 'bubblecatcher_playerId';
  var GAME_COUNT_KEY = 'bubblecatcher_gameCount';
  var DEVICE_KEY = 'bubblecatcher_device';
  var SEEN_GUIDE_KEY = 'bubblecatcher_seenGuide';

  function getPlayerId() {
    var id = null;
    try { id = localStorage.getItem(PLAYER_ID_KEY); } catch (e) {}
    if (!id) {
      id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(PLAYER_ID_KEY, id); } catch (e) {}
    }
    return id;
  }
  function nextGameIndex() {
    var n = 0;
    try { n = parseInt(localStorage.getItem(GAME_COUNT_KEY), 10) || 0; } catch (e) {}
    n += 1;
    try { localStorage.setItem(GAME_COUNT_KEY, String(n)); } catch (e) {}
    return n;
  }
  function loadDevice() { try { return localStorage.getItem(DEVICE_KEY) || null; } catch (e) { return null; } }
  function saveDevice(dev) { try { localStorage.setItem(DEVICE_KEY, dev); } catch (e) {} }
  function hasSeenGuide() { try { return localStorage.getItem(SEEN_GUIDE_KEY) === '1'; } catch (e) { return false; } }
  function markSeenGuide() { try { localStorage.setItem(SEEN_GUIDE_KEY, '1'); } catch (e) {} }

  var PLAYER_ID = getPlayerId();

  // ---------- 畫布 DPI ----------
  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  // ---------- 畫面狀態機 ----------
  var SCREEN = { TITLE: 'title', INPUT: 'inputSelect', PLAYING: 'playing', PAUSED: 'paused', GUIDE: 'guide', END: 'end' };
  var screen = SCREEN.TITLE;
  var deviceType = loadDevice();          // null / 'mouse' / 'touchpad'
  var inputSelectFrom = null;             // 'start' | 'title'
  var guideReturnTo = null;               // 'title' | 'paused'
  var guidePage = 1;
  var pendingAutoGuideClose = false;      // 開場自動彈出的說明: 關閉時才寫入「已看過」標記
  if (!hasSeenGuide()) {
    guideReturnTo = 'title';
    screen = SCREEN.GUIDE;
    pendingAutoGuideClose = true;
  }
  var endInfo = null;                     // {time, score, note}
  var lastGameEndWall = null;             // Date.now() 於上一局結束時

  var titleHover = null, inputHover = null, pauseBtnHover = false, pauseMenuHover = null, guideHover = null, endHover = null;

  var game = null; // 目前這一局的狀態(見 createGame)

  // ==================================================================
  // 網: 目標數字
  // ==================================================================
  function fullTargetRange() {
    var arr = [];
    for (var v = PARAMS.targetMin; v <= PARAMS.targetMax; v++) arr.push(v);
    return arr;
  }

  function pickInitialTargets() {
    var pool = fullTargetRange();
    var targets = [];
    for (var i = 0; i < 4; i++) {
      var remain = pool.filter(function (v) { return targets.indexOf(v) === -1; });
      targets.push(pickFrom(remain));
    }
    return targets;
  }

  // ==================================================================
  // 建立新局
  // ==================================================================
  function createGame(idx) {
    var gapFromPrev = lastGameEndWall == null ? null : (Date.now() - lastGameEndWall);
    var initTargets = pickInitialTargets();
    var nets = [];
    for (var i = 0; i < NETS_DEF.length; i++) {
      nets.push({
        x: NETS_DEF[i].x, y: NETS_DEF[i].y, color: NETS_DEF[i].color,
        target: initTargets[i], targetFx: 1, flash: null, flashT: 0
      });
    }
    var g = {
      id: PLAYER_ID + '#' + idx,
      gameIndex: idx,
      device: deviceType,
      startWall: Date.now(),
      gapFromPrev: gapFromPrev,
      elapsed: 0,          // 存活毫秒(暫停不計)
      hp: PARAMS.hpMax,
      score: 0,
      combo: 0,
      hpFlash: 0,
      bubbles: [],
      nextBubbleId: 1,
      nets: nets,
      spawnTimer: PARAMS.firstSpawnDelay,
      pendingSpawnColor: null,
      spawnBlockedOpen: null,
      lastSpawnColors: [],
      pendingClick: null,      // {bubbleId, downPos, downTime}
      sampleAcc: 0,
      events: [],
      paused: false,
      openPauseRecord: null,
      pauseCount: 0,
      // 彙整用累計
      totals: {
        spawned: 0, caught: 0, expired: 0, wrongNet: 0, numberBounce: 0, outerBounce: 0, stayInner: 0,
        renewSuccess: 0, renewAttempt: 0, windowOpen: 0, lastStandTrigger: 0, lastStandTotal: 0
      },
      maxConcurrent: 0,
      spawnBlockedCount: 0,
      firstHitElapsed: null,
      wrongBeforeFirstHit: 0,
      deathReasonPrimary: null,
      deathReasons: [],
      pendingDeathReasons: [],
      firstExpireFieldCount: null,
      deathFieldCount: null,
      busySecTotal: 0,
      busyActionsTotal: 0,
      openWindowCount: 0,
      lastDropElapsed: null,
      lastDropOtherWindowOpen: null,
      pendingNumberBounceBackfills: [],
      dragTotalMs: 0,
      lives: [],           // 每顆氣泡每一命的結算紀錄
      retargets: [],        // 目標數字重抽事件(供局末彙整)
      done: false
    };
    // 開局抽數字: 每張網各記一筆「重抽」事件, 原因=開局, 舊數字留空
    for (var ni = 0; ni < g.nets.length; ni++) {
      var n0 = g.nets[ni];
      emit(g, 'retarget', {
        netColor: n0.color, oldTarget: null, newTarget: n0.target, reason: 'start',
        perColorSnapshot: [], becameUnreachableCount: null, protectedBubbleId: null,
        diffChosenVsDisplay: null, laterCaught: null
      });
    }
    return g;
  }

  function fieldCount(g) { return g.bubbles.length; }
  function nowElapsed(g) { return Math.round(g.elapsed); }

  function emit(g, type, fields) {
    var rec = { t: nowElapsed(g), gameId: g.id, type: type };
    for (var k in fields) rec[k] = fields[k];
    g.events.push(rec);
    return rec;
  }

  function netOfColor(g, color) {
    for (var i = 0; i < g.nets.length; i++) if (g.nets[i].color === color) return g.nets[i];
    return null;
  }

  function isReachable(b, target) { return displayOf(b.timer) >= target; }

  // ==================================================================
  // 生成
  // ==================================================================
  function pickColor(g) {
    var pool = [0, 1, 2, 3];
    if (g.lastSpawnColors.length >= PARAMS.sameColorStreakCap) {
      var n = g.lastSpawnColors.length;
      var a = g.lastSpawnColors[n - 1], b = g.lastSpawnColors[n - 2], c = g.lastSpawnColors[n - 3];
      if (a === b && b === c) pool = pool.filter(function (x) { return x !== a; });
    }
    return pickFrom(pool);
  }

  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) { return dist(b.x, b.y, INNER.x, INNER.y) <= INNER.r; });
  }

  function findSpawnPosition(g) {
    var avoid = bubblesToAvoidForSpawn(g);
    var minGap = 2 * BUBBLE_R + PARAMS.spawnGap;
    for (var t = 0; t < PARAMS.spawnTries; t++) {
      var ang = Math.random() * Math.PI * 2;
      var r = Math.sqrt(Math.random()) * MOVE_R;
      var x = INNER.x + Math.cos(ang) * r;
      var y = INNER.y + Math.sin(ang) * r;
      var ok = true;
      for (var i = 0; i < avoid.length; i++) {
        if (dist(x, y, avoid[i].x, avoid[i].y) < minGap) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return null;
  }

  function onSpawnBlocked(g, reason) {
    if (!g.spawnBlockedOpen) {
      var rec = emit(g, 'spawnBlocked', { reason: reason, countOnField: fieldCount(g), tries: 1, durationMs: null });
      g.spawnBlockedOpen = { reason: reason, startT: rec.t, tries: 1, record: rec };
    } else {
      g.spawnBlockedOpen.tries++;
      g.spawnBlockedOpen.record.tries = g.spawnBlockedOpen.tries;
    }
    g.spawnTimer = PARAMS.spawnRetryInterval;
  }

  function finalizeSpawnBlocked(g, atElapsed) {
    if (!g.spawnBlockedOpen) return;
    g.spawnBlockedOpen.record.durationMs = atElapsed - g.spawnBlockedOpen.startT;
    g.spawnBlockedCount++;
    g.spawnBlockedOpen = null;
  }

  function scheduleNextSpawnInterval(g) {
    var sec = g.elapsed / 1000;
    var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * sec;
    var jitter = rand(-PARAMS.spawnJitter, PARAMS.spawnJitter);
    var interval = Math.max(PARAMS.minSpawnInterval, (1 / rate) * (1 + jitter));
    g.spawnTimer = interval;
  }

  function newLifeState(b) {
    b.lifeWindowOpened = false;
    b.lifeLastWindowCloseReason = null;
    b.lifeStartElapsed = nowElapsed(game);
  }

  function attemptSpawn(g) {
    if (g.pendingSpawnColor == null) g.pendingSpawnColor = pickColor(g);
    var color = g.pendingSpawnColor;
    if (fieldCount(g) >= PARAMS.innerCapacityK) { onSpawnBlocked(g, 'capacityFull'); return; }
    var pos = findSpawnPosition(g);
    if (!pos) { onSpawnBlocked(g, 'placementFail'); return; }
    var id = g.nextBubbleId++;
    var b = makeBubble(id, color, pos.x, pos.y, g.elapsed);
    g.bubbles.push(b);
    g.lastSpawnColors.push(color);
    if (g.lastSpawnColors.length > PARAMS.sameColorStreakCap) g.lastSpawnColors.shift();
    g.totals.spawned++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    var net = netOfColor(g, color);
    emit(g, 'spawn', { bubbleId: id, color: color, initialTimer: PARAMS.initialTimer, x: pos.x, y: pos.y, countOnField: fieldCount(g), netTarget: net ? net.target : null });
    g.pendingSpawnColor = null;
    if (g.spawnBlockedOpen) finalizeSpawnBlocked(g, nowElapsed(g));
    scheduleNextSpawnInterval(g);
    // 生成後立刻檢查窗口(理論上不可能一生成就對上, 初始倒數 12 > 目標上限 10, 保留呼叫以求一致)
    syncWindowNatural(g, b);
  }

  function makeBubble(id, color, x, y, spawnElapsed) {
    var b = {
      id: id, color: color, x: x, y: y,
      timer: PARAMS.initialTimer,
      renewCount: 0,
      mode: 'idle',
      spawnElapsed: spawnElapsed,
      everGrabbed: false,
      dead: false,
      dragStartElapsed: null,
      dragDistance: 0,
      renewFx: 0,
      renewFailFx: 0,
      returnFrom: null, returnTo: null, returnElapsed: 0,
      windowOpen: false,
      windowMeta: null,
      firstWindowOpenElapsed: null,
      lastGrabElapsed: null,
      lastLifeEndReport: null
    };
    newLifeState(b);
    return b;
  }

  // ==================================================================
  // 窗口(視窗)追蹤
  // ==================================================================
  function currentOpenWindowCount(g, excludeId) {
    var n = 0;
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.windowOpen && b.id !== excludeId) n++;
    }
    return n;
  }

  function isAnyDragging() { return !!(mouse.press && mouse.press.dragging); }

  function otherReachableWithFewerRenewsLeft(g, b) {
    for (var i = 0; i < g.bubbles.length; i++) {
      var o = g.bubbles[i];
      if (o.id === b.id || o.color !== b.color || o.dead) continue;
      var net = netOfColor(g, o.color);
      if (!net) continue;
      if (isReachable(o, net.target) && o.renewCount > b.renewCount) return true;
    }
    return false;
  }

  function openWindow(g, b, isReopen) {
    if (b.windowOpen) return;
    b.windowOpen = true;
    b.lifeWindowOpened = true;
    var other = currentOpenWindowCount(g, b.id);
    var draggingAny = isAnyDragging();
    b.windowMeta = {
      openT: nowElapsed(g),
      isReopen: !!isReopen,
      wasHandFreeAtOpen: !draggingAny && other === 0,
      dragMsDuring: 0,
      grabElapsedDuring: null
    };
    if (b.firstWindowOpenElapsed == null) b.firstWindowOpenElapsed = nowElapsed(g);
    g.totals.windowOpen++;
    g.openWindowCount = currentOpenWindowCount(g, null);
    emit(g, 'windowOpen', {
      bubbleId: b.id, netColor: b.color, lifeIndex: b.renewCount + 1, isReopen: !!isReopen,
      otherOpenWindowCount: other, playerDraggingNow: draggingAny, thisBubbleReturning: b.mode === 'return'
    });
  }

  function closeWindow(g, b, reason) {
    if (!b.windowOpen) return;
    var meta = b.windowMeta;
    var durationMs = nowElapsed(g) - meta.openT;
    var delayToGrabMs = meta.grabElapsedDuring != null ? (meta.grabElapsedDuring - meta.openT) : null;
    var atCloseOtherReachableFewer = otherReachableWithFewerRenewsLeft(g, b);
    b.windowOpen = false;
    b.lifeLastWindowCloseReason = reason;
    b.windowMeta = null;
    g.openWindowCount = currentOpenWindowCount(g, null);
    emit(g, 'windowClose', {
      bubbleId: b.id, reason: reason, durationMs: durationMs, delayToGrabMs: delayToGrabMs,
      wasHandFreeAtOpen: meta.wasHandFreeAtOpen, dragMsDuringWindow: Math.round(meta.dragMsDuring),
      otherReachableWithFewerRenewsAtClose: atCloseOtherReachableFewer
    });
    return { durationMs: durationMs, atCloseOtherReachableFewer: atCloseOtherReachableFewer, reason: reason };
  }

  // 自然狀態同步(生成後 / 每 tick 非拖曳時倒數遞減後呼叫)
  function syncWindowNatural(g, b) {
    if (b.dead) return;
    var net = netOfColor(g, b.color);
    if (!net) return;
    var disp = displayOf(b.timer);
    var match = disp === net.target;
    if (b.windowOpen && !match) closeWindow(g, b, 'timerPassed');
    else if (!b.windowOpen && match) openWindow(g, b, false);
  }

  // 網重抽時呼叫: 對該色所有氣泡重新核對窗口狀態
  function syncWindowsForColor(g, color) {
    var net = netOfColor(g, color);
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.color !== color || b.dead) continue;
      var disp = displayOf(b.timer);
      var match = disp === net.target;
      if (b.windowOpen && !match) closeWindow(g, b, 'redrawn');
      else if (!b.windowOpen && match) openWindow(g, b, false);
    }
  }

  function finalizeLife(g, b, endReason, wasWasteful) {
    g.lives.push({
      bubbleId: b.id, color: b.color, lifeIndex: b.renewCount + 1,
      hadWindowOpened: b.lifeWindowOpened, lastWindowCloseReason: b.lifeLastWindowCloseReason,
      endReason: endReason, wasWastefulRenew: !!wasWasteful,
      endElapsed: nowElapsed(g)
    });
  }

  function lifeEndReasonForRenew(b) {
    if (b.windowOpen) return '窗口中續=浪費';
    if (!b.lifeWindowOpened) return '未到窗口就續';
    if (b.lifeLastWindowCloseReason === 'redrawn') return '重抽換掉';
    if (b.lifeLastWindowCloseReason === 'timerPassed') return '倒數走過';
    return '從未開窗';
  }

  function lastLifeMissReasonForExpire(b) {
    if (!b.lifeWindowOpened) return '從未開窗';
    if (b.lifeLastWindowCloseReason === 'redrawn') return '重抽換掉';
    return '倒數走過';
  }

  // ==================================================================
  // 物理: 碰撞與夾限
  // ==================================================================
  function clampToCircle(b) {
    var d = dist(b.x, b.y, INNER.x, INNER.y);
    if (d > MOVE_R) {
      var k = MOVE_R / (d || 1);
      b.x = INNER.x + (b.x - INNER.x) * k;
      b.y = INNER.y + (b.y - INNER.y) * k;
    }
  }

  function resolveOverlap(a, b, moveBoth) {
    var d = dist(a.x, a.y, b.x, b.y);
    var minD = 2 * BUBBLE_R;
    if (d >= minD) return;
    var ang;
    if (d < 1e-6) { ang = Math.random() * Math.PI * 2; d = 0.01; } else { ang = Math.atan2(a.y - b.y, a.x - b.x); }
    var overlap = minD - d;
    var ux = Math.cos(ang), uy = Math.sin(ang);
    if (moveBoth) { a.x += ux * overlap / 2; a.y += uy * overlap / 2; b.x -= ux * overlap / 2; b.y -= uy * overlap / 2; }
    else { a.x += ux * overlap; a.y += uy * overlap; }
  }

  function updatePhysics(g, dt) {
    var idle = g.bubbles.filter(function (b) { return b.mode === 'idle'; });
    var obstacles = g.bubbles.filter(function (b) { return b.mode === 'return'; });
    var passes = 3;
    for (var p = 0; p < passes; p++) {
      for (var i = 0; i < idle.length; i++) {
        for (var j = i + 1; j < idle.length; j++) resolveOverlap(idle[i], idle[j], true);
        for (var k = 0; k < obstacles.length; k++) resolveOverlap(idle[i], obstacles[k], false);
      }
      for (var m = 0; m < idle.length; m++) clampToCircle(idle[m]);
    }
    for (var r = 0; r < g.bubbles.length; r++) {
      var rb = g.bubbles[r];
      if (rb.mode !== 'return') continue;
      rb.returnElapsed += dt;
      var t = clamp01(rb.returnElapsed / PARAMS.returnDuration);
      rb.x = lerp(rb.returnFrom.x, rb.returnTo.x, t);
      rb.y = lerp(rb.returnFrom.y, rb.returnTo.y, t);
      if (t >= 1) { rb.mode = 'idle'; rb.x = rb.returnTo.x; rb.y = rb.returnTo.y; }
    }
  }

  // ==================================================================
  // HP / 分數
  // ==================================================================
  function loseHp(g, reason, fieldCountOverride) {
    g.hp = Math.max(0, g.hp - 1);
    g.combo = 0;
    g.hpFlash = 1;
    if (g.firstHitElapsed == null) g.firstHitElapsed = nowElapsed(g);
    var cnt = fieldCountOverride == null ? fieldCount(g) : fieldCountOverride;
    emit(g, 'hpChange', { reason: reason, countOnField: cnt, hp: g.hp });
    if (g.hp === 0) g.pendingDeathReasons.push(reason);
  }

  // 死亡判定收在「批次」結尾呼叫(tick 一次呼叫的多顆過期 / 一次放下的錯色),
  // 讓同一批次內的多筆扣血都先各自 emit 完, 再統一結算死因, 且該批次自己的
  // 收尾事件(如 drop)不會被下載搶在前面漏記。
  function checkDeath(g) {
    if (!g.done && g.hp <= 0 && g.pendingDeathReasons.length > 0) {
      g.done = true;
      endGame('hpZero');
    }
  }

  function scoreForCombo(combo) {
    var bonus = Math.min(combo - 1, PARAMS.comboStreakCap) * PARAMS.comboBonusPerStreak;
    return Math.round(PARAMS.scoreBase * (1 + bonus));
  }

  // ==================================================================
  // 移除
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    // 理論上窗口在顯示倒數降到目標以下時已關閉(目標下限 3), 這裡保險再關一次
    if (b.windowOpen) closeWindow(g, b, 'timerPassed');
    var hadRenewLeft = b.renewCount < PARAMS.renewMax;
    var missReason = lastLifeMissReasonForExpire(b);
    finalizeLife(g, b, 'expired', false);
    var wasDragging = (b.mode === 'drag');
    removeBubble(g, b);
    var cnt = fieldCount(g);
    var net = netOfColor(g, b.color);
    emit(g, 'expire', {
      bubbleId: b.id, color: b.color, everGrabbed: b.everGrabbed, renewCount: b.renewCount,
      countOnField: cnt, netTarget: net ? net.target : null, lastLifeMissReason: missReason,
      hadRenewLeft: hadRenewLeft, draggingAtExpiry: wasDragging
    });
    g.totals.expired++;
    if (g.firstExpireFieldCount == null) g.firstExpireFieldCount = cnt;
    finalizePendingNumberBounceBackfill(g, b.id, false, null);
    loseHp(g, 'expire', cnt);
  }

  // ==================================================================
  // 網 / 落點
  // ==================================================================
  function findNetAt(g, x, y) {
    for (var i = 0; i < g.nets.length; i++) if (dist(x, y, g.nets[i].x, g.nets[i].y) <= NET_R) return g.nets[i];
    return null;
  }
  function nearestNetDistance(g, x, y) {
    var best = Infinity;
    for (var i = 0; i < g.nets.length; i++) { var d = dist(x, y, g.nets[i].x, g.nets[i].y); if (d < best) best = d; }
    return best;
  }

  function startReturn(b, fromX, fromY) {
    var ang = Math.atan2(fromY - INNER.y, fromX - INNER.x);
    if (fromX === INNER.x && fromY === INNER.y) ang = Math.random() * Math.PI * 2;
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = { x: INNER.x + Math.cos(ang) * MOVE_R, y: INNER.y + Math.sin(ang) * MOVE_R };
    b.returnElapsed = 0;
  }

  function finalizePendingNumberBounceBackfill(g, bubbleId, caught, captureElapsed) {
    for (var i = g.pendingNumberBounceBackfills.length - 1; i >= 0; i--) {
      var it = g.pendingNumberBounceBackfills[i];
      if (it.bubbleId === bubbleId) {
        it.record.laterCaught = caught;
        it.record.timeToCaptureMs = caught ? (captureElapsed - it.startElapsed) : null;
        g.pendingNumberBounceBackfills.splice(i, 1);
      }
    }
  }

  // ---------- 目標數字重抽(含末命保護) ----------
  function retargetNet(g, net, reason, atCaptureFieldSnapshot) {
    var oldTarget = net.target;
    var others = g.nets.filter(function (n) { return n !== net; }).map(function (n) { return n.target; });
    var excluded = others.concat(oldTarget == null ? [] : [oldTarget]);
    var candidates = fullTargetRange().filter(function (v) { return excluded.indexOf(v) === -1; });

    var chosen = null, actualReason = reason, protectedBubble = null;
    if (reason === 'capture') {
      var lastStand = g.bubbles.filter(function (b) {
        return b.color === net.color && !b.dead && b.renewCount >= PARAMS.renewMax && displayOf(b.timer) >= PARAMS.lastStandDisplayThreshold;
      });
      if (lastStand.length > 0) {
        g.totals.lastStandTotal++;
        var d = Math.min.apply(null, lastStand.map(function (b) { return displayOf(b.timer); }));
        var maxDisp = Math.max.apply(null, lastStand.map(function (b) { return displayOf(b.timer); }));
        var tier1 = candidates.filter(function (v) { return v <= d - 1; });
        var tier2 = candidates.filter(function (v) { return v <= maxDisp - 1; });
        if (tier1.length > 0) {
          chosen = pickFrom(tier1);
          actualReason = 'lastStand';
          protectedBubble = lastStand.filter(function (b) { return displayOf(b.timer) === d; })[0];
        } else if (tier2.length > 0) {
          chosen = pickFrom(tier2);
          actualReason = 'lastStand';
          protectedBubble = lastStand.filter(function (b) { return displayOf(b.timer) === maxDisp; })[0];
        }
      }
    }
    if (chosen == null) chosen = pickFrom(candidates);
    net.target = chosen;
    net.targetFx = 1;

    if (actualReason === 'lastStand') g.totals.lastStandTrigger++;

    var becameUnreachable = 0;
    if (reason === 'capture') {
      for (var i = 0; i < g.bubbles.length; i++) {
        var b = g.bubbles[i];
        if (b.color !== net.color || b.dead) continue;
        var wasReach = oldTarget != null && isReachable(b, oldTarget);
        var nowReach = isReachable(b, chosen);
        if (wasReach && !nowReach) becameUnreachable++;
      }
    }

    var snapshot = g.bubbles.filter(function (b) { return b.color === net.color && !b.dead; }).map(function (b) {
      return { bubbleId: b.id, display: displayOf(b.timer), renewsLeft: PARAMS.renewMax - b.renewCount };
    });

    var rec = emit(g, 'retarget', {
      netColor: net.color, oldTarget: oldTarget, newTarget: chosen, reason: actualReason === 'lastStand' ? 'lastStand' : reason,
      perColorSnapshot: snapshot, becameUnreachableCount: becameUnreachable,
      protectedBubbleId: protectedBubble ? protectedBubble.id : null,
      diffChosenVsDisplay: protectedBubble ? (chosen - displayOf(protectedBubble.timer)) : null,
      laterCaught: null
    });
    if (protectedBubble) {
      g.retargets.push({ record: rec, bubbleId: protectedBubble.id, done: false });
    }
    syncWindowsForColor(g, net.color);
    return becameUnreachable;
  }

  function backfillRetargetProtection(g, bubbleId, caught) {
    for (var i = 0; i < g.retargets.length; i++) {
      var it = g.retargets[i];
      if (!it.done && it.bubbleId === bubbleId) { it.record.laterCaught = caught; it.done = true; }
    }
  }

  function doCapture(g, b, net) {
    closeWindow(g, b, 'capture');
    finalizeLife(g, b, 'captured', false);
    var newCombo = g.combo + 1;
    var pts = scoreForCombo(newCombo);
    g.score += pts;
    g.combo = newCombo;
    net.flash = 'catch'; net.flashT = 0;
    g.totals.caught++;
    var capElapsed = nowElapsed(g);
    finalizePendingNumberBounceBackfill(g, b.id, true, capElapsed);
    backfillRetargetProtection(g, b.id, true);
    removeBubble(g, b);
    var becameUnreachable = retargetNet(g, net, 'capture', null);
    return { points: pts, becameUnreachable: becameUnreachable };
  }

  // ==================================================================
  // 放開判定
  // ==================================================================
  function resolveRelease(g, b, px, py) {
    var net = findNetAt(g, px, py);
    var outcome, targetNetColor = null, colorCorrect = null, netTarget = null, numberMatches = null;
    var disp = displayOf(b.timer);
    var distToNet = nearestNetDistance(g, px, py);
    var wasWindowOpen = b.windowOpen;
    var becameUnreachable = 0;
    var wasBeforeFirstHit = (g.firstHitElapsed == null);

    if (net) {
      targetNetColor = net.color;
      colorCorrect = (b.color === net.color);
      netTarget = net.target;
      if (!colorCorrect) {
        outcome = 'wrong';
        net.flash = 'wrong'; net.flashT = 0;
        g.totals.wrongNet++;
        if (wasWindowOpen) closeWindow(g, b, 'wrongColorGone');
        finalizeLife(g, b, 'wrongColorRemoved', false);
        removeBubble(g, b);
        finalizePendingNumberBounceBackfill(g, b.id, false, null);
        loseHp(g, 'wrong');
        if (wasBeforeFirstHit) g.wrongBeforeFirstHit++;
      } else {
        numberMatches = (disp === net.target);
        if (numberMatches) {
          outcome = 'capture';
          var res = doCapture(g, b, net);
          becameUnreachable = res.becameUnreachable;
        } else {
          outcome = 'numberBounce';
          g.totals.numberBounce++;
          net.flash = 'bounce'; net.flashT = 0;
          var rec = emit(g, 'numberBounce', { bubbleId: b.id, netColor: net.color, display: disp, target: net.target, laterCaught: null, timeToCaptureMs: null });
          g.pendingNumberBounceBackfills.push({ bubbleId: b.id, startElapsed: nowElapsed(g), record: rec });
          startReturn(b, px, py);
        }
      }
    } else {
      var dToCenter = dist(px, py, INNER.x, INNER.y);
      if (dToCenter <= INNER.r) {
        outcome = 'stayInner';
        g.totals.stayInner++;
        b.mode = 'idle';
        b.x = px; b.y = py;
        clampToCircle(b);
      } else {
        outcome = 'outerBounce';
        g.totals.outerBounce++;
        startReturn(b, px, py);
      }
    }

    // 被抓取未捕捉: 窗口原本開著, 結果不是捕捉、也不是錯色(錯色已在上面單獨關閉並結算命)
    if (outcome !== 'capture' && outcome !== 'wrong' && wasWindowOpen) {
      closeWindow(g, b, 'grabbedNotCaptured');
      var net2 = netOfColor(g, b.color);
      if (net2 && displayOf(b.timer) === net2.target) openWindow(g, b, true);
    }

    var afterCount = fieldCount(g);
    var otherOpenAtDrop = currentOpenWindowCount(g, b.id) > 0;
    emit(g, 'drop', {
      bubbleId: b.id, targetNetColor: targetNetColor, colorCorrect: colorCorrect,
      display: disp, netTarget: netTarget, numberMatches: numberMatches, outcome: outcome,
      x: px, y: py, dragDurationMs: nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed),
      dragDistance: b.dragDistance, countOnField: afterCount, distanceToNearestNetCenter: distToNet,
      becameUnreachableCount: outcome === 'capture' ? becameUnreachable : null,
      otherWindowOpenAtDrop: otherOpenAtDrop
    });
    g.lastDropElapsed = nowElapsed(g);
    g.lastDropOtherWindowOpen = otherOpenAtDrop;

    if (outcome === 'capture' || outcome === 'wrong') {
      var busy = g.openWindowCount > 0;
      if (busy) g.busyActionsTotal++;
    }
    checkDeath(g);
  }

  // ==================================================================
  // 雙擊續命
  // ==================================================================
  function resolveDoubleClick(g, b, secondHitByTolerance, intervalMs, displacement) {
    var attemptNo = b.renewCount + 1;
    var remainingBefore = displayOf(b.timer);
    var net = netOfColor(g, b.color);
    var eligible = b.renewCount < PARAMS.renewMax;
    var wasWasteful = b.windowOpen;
    var lifeEndReason = lifeEndReasonForRenew(b);
    var hadOpenWindowAtLastAction = g.lastDropOtherWindowOpen;
    var intervalSinceLastAction = g.lastDropElapsed == null ? null : (nowElapsed(g) - g.lastDropElapsed);
    var openWindowsNow = currentOpenWindowCount(g, null);

    if (eligible) {
      if (b.windowOpen) closeWindow(g, b, 'renewed');
      finalizeLife(g, b, 'renewed', wasWasteful);
      b.timer = PARAMS.renewResetValue;
      b.renewCount++;
      b.renewFx = 1;
      newLifeState(b);
      g.totals.renewSuccess++;
    } else {
      b.renewFailFx = 1;
    }
    g.totals.renewAttempt++;
    emit(g, 'renew', {
      bubbleId: b.id, remainingBefore: remainingBefore, attemptNo: attemptNo, success: eligible,
      intervalMs: intervalMs, secondHitByTolerance: !!secondHitByTolerance, displacementBetweenClicks: displacement,
      netTarget: net ? net.target : null, intervalSinceLastActionMs: intervalSinceLastAction,
      hadOpenWindowAtLastAction: hadOpenWindowAtLastAction, currentOpenWindowCount: openWindowsNow,
      lifeEndReason: lifeEndReason, wasWasteful: wasWasteful
    });
  }

  // ==================================================================
  // 暫停 / 恢復
  // ==================================================================
  function openPause(g, reason) {
    if (g.paused) return;
    g.paused = true;
    g.pauseCount++;
    var rec = emit(g, 'pause', { startRealMs: Date.now() - g.startWall, endRealMs: null, reason: reason });
    g.openPauseRecord = rec;
    screen = SCREEN.PAUSED;
  }
  function resumePause(g) {
    if (!g.paused) return;
    g.paused = false;
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    screen = SCREEN.PLAYING;
  }

  // 拖曳中視窗失去焦點: 規格要求「當下立刻視為在其他位置放開, 彈回內圈」,
  // 不看指標當下實際位置是否剛好停在網上 —— 走獨立路徑, 不借用一般的 resolveRelease
  // (那樣萬一指標正好停在網上, 會被重新判成捕捉 / 錯色 / 數字不符, 與規格「一律強制彈回」矛盾)。
  function forceBounceCurrentDrag(g) {
    if (!(mouse.press && mouse.press.dragging)) return;
    var b = mouse.press.bubble;
    if (b && !b.dead) {
      var px = mouse.x, py = mouse.y;
      var distToNet = nearestNetDistance(g, px, py);
      var wasWindowOpen = b.windowOpen;
      startReturn(b, px, py);
      g.totals.outerBounce++;
      if (wasWindowOpen) {
        closeWindow(g, b, 'grabbedNotCaptured');
        var net2 = netOfColor(g, b.color);
        if (net2 && displayOf(b.timer) === net2.target) openWindow(g, b, true);
      }
      emit(g, 'drop', {
        bubbleId: b.id, targetNetColor: null, colorCorrect: null, display: displayOf(b.timer), netTarget: null,
        numberMatches: null, outcome: 'outerBounce', x: px, y: py,
        dragDurationMs: nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed),
        dragDistance: b.dragDistance, countOnField: fieldCount(g), distanceToNearestNetCenter: distToNet,
        becameUnreachableCount: null
      });
      g.lastDropElapsed = nowElapsed(g);
      g.lastDropOtherWindowOpen = currentOpenWindowCount(g, null) > 0;
    }
    mouse.press = null;
  }

  // ==================================================================
  // 主更新
  // ==================================================================
  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }

  function emitSample(g) {
    var netsState = g.nets.map(function (n) { return { color: n.color, target: n.target }; });
    var sec = g.elapsed / 1000;
    var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * sec;
    var lastStandCount = g.bubbles.filter(function (b) { return b.renewCount >= PARAMS.renewMax; }).length;
    emit(g, 'sample', {
      countOnField: fieldCount(g), nets: netsState, spawnRate: rate,
      anyDragging: isAnyDragging(), openWindowCount: g.openWindowCount, lastStandCount: lastStandCount
    });
  }

  function tick(dt) {
    var g = game;
    g.elapsed += dt * 1000;
    g.pendingDeathReasons = [];

    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) attemptSpawn(g);

    updatePhysics(g, dt);

    // 拖曳中氣泡: 倒數凍結, 累計拖曳總時長(供「拖曳占存活比例」用)
    if (mouse.press && mouse.press.dragging) {
      g.dragTotalMs += dt * 1000;
      var db = findBubbleById(g, mouse.press.bubbleId);
      if (db && db.windowOpen) db.windowMeta.dragMsDuring += dt * 1000;
    }
    // 所有開著窗口的氣泡, 若玩家正在拖(不論拖哪一顆), 累計「這1秒內拖曳中的時長」(近似: 累計整個窗口存續期)
    if (isAnyDragging()) {
      for (var wi = 0; wi < g.bubbles.length; wi++) {
        var wb = g.bubbles[wi];
        if (wb.windowOpen && !(mouse.press && mouse.press.bubbleId === wb.id)) wb.windowMeta.dragMsDuring += dt * 1000;
      }
    }

    // 倒數與消失(對複本迭代, 避免邊迭代邊刪); 非拖曳中的氣泡才走自然倒數與窗口同步
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'drag') continue; // 倒數凍結
      b.timer -= dt;
      if (b.timer <= 0) { expireBubble(g, b); continue; }
      syncWindowNatural(g, b);
    }

    // 網回饋淡出
    for (var n = 0; n < g.nets.length; n++) {
      var net2 = g.nets[n];
      if (net2.targetFx > 0) net2.targetFx = Math.max(0, net2.targetFx - dt / 0.4);
      if (net2.flash) { net2.flashT += dt / 0.5; if (net2.flashT >= 1) { net2.flash = null; net2.flashT = 0; } }
    }
    // 氣泡回饋淡出
    for (var bi = 0; bi < g.bubbles.length; bi++) {
      var bb = g.bubbles[bi];
      if (bb.renewFx > 0) bb.renewFx = Math.max(0, bb.renewFx - dt / 0.4);
      if (bb.renewFailFx > 0) bb.renewFailFx = Math.max(0, bb.renewFailFx - dt / 0.3);
    }
    if (g.hpFlash > 0) g.hpFlash = Math.max(0, g.hpFlash - dt / 0.6);

    // 忙碌秒數: 當下至少一個窗口開著
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    if (g.openWindowCount > 0) g.busySecTotal += dt;

    // 每秒取樣
    g.sampleAcc += dt;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleInterval && guard < 10) {
      g.sampleAcc -= PARAMS.sampleInterval;
      emitSample(g);
      guard++;
    }

    checkDeath(g);
  }

  // ==================================================================
  // 局末彙整與下載
  // ==================================================================
  function segmentIndex(t) { return Math.floor(t / PARAMS.segmentMs); }

  function computeSummary(g) {
    var events = g.events;
    function byType(t) { return events.filter(function (e) { return e.type === t; }); }
    var drops = byType('drop');
    var grabs = byType('grab');
    var renews = byType('renew');
    var expires = byType('expire');
    var windowCloses = byType('windowClose');
    var retargets = byType('retarget');
    var samples = byType('sample');

    function stats(arr) {
      if (!arr.length) return { avg: null, p90: null, n: 0 };
      var sorted = arr.slice().sort(function (a, b) { return a - b; });
      var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      var p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
      return { avg: avg, p90: p90, n: arr.length };
    }
    function avgOf(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
    function ratio(num, den) { return den > 0 ? num / den : null; }

    // ---- 手速指標 ----
    // (a) 開窗到抓取的延遲: 只算開窗時手是空的、且最後被抓取的窗口
    var grabDelays = windowCloses.filter(function (w) {
      return w.wasHandFreeAtOpen && w.delayToGrabMs != null && w.reason !== 'timerPassed';
    }).map(function (w) { return w.delayToGrabMs; });
    // (b)+(c) 捕捉循環 S = 拖曳時長 + 回程, 只取放下時「下一顆已開窗」的循環
    // 保留來源那筆 drop 的時間戳, 供之後 30 秒分段依時間切分(cycles 是 drops 的稀疏子集, 不能靠索引對齊)
    var cycles = [];
    for (var d = 0; d < drops.length; d++) {
      var cur = drops[d];
      var nextGrab = null;
      for (var gi = 0; gi < grabs.length; gi++) { if (grabs[gi].t >= cur.t) { nextGrab = grabs[gi]; break; } }
      if (!nextGrab) continue;
      if (!cur.otherWindowOpenAtDrop) continue;
      cycles.push({ t: cur.t, ms: cur.dragDurationMs + (nextGrab.t - cur.t) });
    }
    var cycleMsList = cycles.map(function (c) { return c.ms; });

    // ---- 判斷指標一: 先收哪顆 ----
    var onNetGrabs = grabs.filter(function (gr) { return gr.sameColorOpenCount >= 2; });
    var pickedLowestRenewRatio = ratio(onNetGrabs.filter(function (gr) { return gr.selectedIsOneOfOpen && !gr.anotherOpenWithFewerRenewsLeft; }).length, onNetGrabs.length);
    var becameUnreachableList = drops.filter(function (dp) { return dp.outcome === 'capture' && dp.becameUnreachableCount != null; }).map(function (dp) { return dp.becameUnreachableCount; });
    var intentionalLets = windowCloses.filter(function (w) { return w.reason === 'timerPassed' && w.wasHandFreeAtOpen && w.otherReachableWithFewerRenewsAtClose; });
    var diffZero = 0, diffPos = 0, diffNeg = 0;
    drops.forEach(function (dp) { if (dp.outcome === 'capture' && dp.numberMatches) diffZero++; });

    // ---- 判斷指標二: 續命用法 ----
    var renewDiffs = renews.map(function (r) { return r.remainingBefore - r.netTarget; });
    var belowTargetRatio = ratio(renews.filter(function (r) { return (r.remainingBefore - r.netTarget) < 0; }).length, renews.length);
    var windowPassedThenRenewRatio = ratio(renews.filter(function (r) { return r.lifeEndReason === '倒數走過'; }).length, renews.length);
    var invalidDoubleClickRate = ratio(renews.filter(function (r) { return !r.success; }).length, renews.length);
    var expiredWithRenewLeftRatio = ratio(expires.filter(function (e) { return e.hadRenewLeft; }).length, expires.length);

    // ---- 判斷指標三(續命浪費比例, 併入上面), 撞窗損失 / 重抽錯失(以命計) ----
    // 分母(製作人裁決統一): 所有已結束的命(含從未開窗的), 排除「錯色消失」「局結束」結束的命,
    // 與在窗口開著時被「續命重設」的命(=窗口中續, 浪費性續命)。
    var denomLives = g.lives.filter(function (l) {
      return l.endReason !== 'wrongColorRemoved' && l.endReason !== 'gameEnd' && !(l.endReason === 'renewed' && l.wasWastefulRenew);
    });
    var timerPassedLives = denomLives.filter(function (l) { return l.lastWindowCloseReason === 'timerPassed'; });
    var intentionalLetLivesCount = 0;
    timerPassedLives.forEach(function (l) {
      var wc = windowCloses.filter(function (w) { return w.bubbleId === l.bubbleId && w.reason === 'timerPassed'; }).pop();
      if (wc && wc.wasHandFreeAtOpen && wc.otherReachableWithFewerRenewsAtClose) intentionalLetLivesCount++;
    });
    // 撞窗損失分子 = 最後一個窗口結束原因為「倒數走過」的命數, 扣除故意讓過
    var busyLossRatio = ratio(timerPassedLives.length - intentionalLetLivesCount, denomLives.length);

    // 重抽錯失分子 = 最後一個窗口結束原因為「網重抽換掉」的命數 + 從未開窗的命數; 分母同上
    var redrawnOrNeverLives = denomLives.filter(function (l) {
      return l.lastWindowCloseReason === 'redrawn' || !l.hadWindowOpened;
    });
    var redrawLossRatio = ratio(redrawnOrNeverLives.length, denomLives.length);

    var lastStandRecs = retargets.filter(function (r) { return r.reason === 'lastStand'; });
    var totalCaptureRetargets = retargets.filter(function (r) { return r.reason === 'capture' || r.reason === 'lastStand'; }).length;
    var lastStandTriggerRatio = ratio(lastStandRecs.length, totalCaptureRetargets);
    var avgTarget = avgOf(retargets.filter(function (r) { return r.reason !== 'lastStand'; }).map(function (r) { return r.newTarget; }));
    var avgTargetLastStand = avgOf(lastStandRecs.map(function (r) { return r.newTarget; }));

    // ---- 生成到第一次開窗 / 每顆平均壽命 / 拖曳占比 ----
    var firstWindowDelays = [];
    var lifespans = [];
    var spawnMap = {};
    events.filter(function (e) { return e.type === 'spawn'; }).forEach(function (e) { spawnMap[e.bubbleId] = e.t; });
    var seenFirstWindow = {};
    events.filter(function (e) { return e.type === 'windowOpen'; }).forEach(function (e) {
      if (seenFirstWindow[e.bubbleId]) return;
      seenFirstWindow[e.bubbleId] = true;
      if (spawnMap[e.bubbleId] != null) firstWindowDelays.push(e.t - spawnMap[e.bubbleId]);
    });
    events.filter(function (e) { return e.type === 'expire' || (e.type === 'drop' && e.outcome === 'capture') || (e.type === 'drop' && e.outcome === 'wrong'); }).forEach(function (e) {
      var sT = spawnMap[e.bubbleId];
      if (sT != null) lifespans.push(e.t - sT);
    });

    var dragRatio = g.elapsed > 0 ? g.dragTotalMs / g.elapsed : null;

    // ---- 「等不到」死局拆兩類(只在死因含 expire 時有意義) ----
    var lastExpireLife = null;
    for (var li = g.lives.length - 1; li >= 0; li--) { if (g.lives[li].endReason === 'expired') { lastExpireLife = g.lives[li]; break; } }
    var deathTimeoutClass = null;
    if (g.deathReasons.indexOf('expire') !== -1 && lastExpireLife) {
      deathTimeoutClass = lastExpireLife.lastWindowCloseReason === 'redrawn' ? 'redrawCaused' : 'playerMissed';
    }
    var expiredWithRenewLeftCount = expires.filter(function (e) { return e.hadRenewLeft; }).length;

    // ---- 每 30 秒分段 ----
    var segCount = Math.max(1, segmentIndex(g.elapsed) + 1);
    var segments = [];
    for (var s = 0; s < segCount; s++) {
      var segStart = s * PARAMS.segmentMs, segEnd = segStart + PARAMS.segmentMs;
      var inSeg = function (t) { return t >= segStart && t < segEnd; };
      var segSpawn = events.filter(function (e) { return e.type === 'spawn' && inSeg(e.t); }).length;
      var segCatch = drops.filter(function (e) { return e.outcome === 'capture' && inSeg(e.t); }).length;
      var segWrong = drops.filter(function (e) { return e.outcome === 'wrong' && inSeg(e.t); }).length;
      var segExpire = expires.filter(function (e) { return inSeg(e.t); }).length;
      var segLivesEnded = g.lives.filter(function (l) { return inSeg(l.endElapsed); });
      var segDenom = segLivesEnded.filter(function (l) { return l.endReason !== 'wrongColorRemoved' && l.endReason !== 'gameEnd' && !(l.endReason === 'renewed' && l.wasWastefulRenew); });
      var segTimerPassed = segDenom.filter(function (l) { return l.lastWindowCloseReason === 'timerPassed'; }).length;
      var segRedrawn = segDenom.filter(function (l) { return l.lastWindowCloseReason === 'redrawn' || !l.hadWindowOpened; }).length;
      var segGrabDelays = windowCloses.filter(function (w) { return inSeg(w.t) && w.wasHandFreeAtOpen && w.delayToGrabMs != null; }).map(function (w) { return w.delayToGrabMs; });
      var segCycles = cycles.filter(function (c) { return inSeg(c.t); }).map(function (c) { return c.ms; });
      segments.push({
        index: s, startMs: segStart, endMs: segEnd,
        spawnCount: segSpawn, catchCount: segCatch, wrongCount: segWrong, expiredCount: segExpire,
        timerPassedLossRatio: ratio(segTimerPassed, segDenom.length), redrawnLossRatio: ratio(segRedrawn, segDenom.length),
        handSpeedGrabDelay: stats(segGrabDelays), cycleS: stats(segCycles)
      });
    }

    return {
      handSpeed: { grabDelay: stats(grabDelays), cycleS: stats(cycleMsList) },
      judge1: {
        pickedLowestRenewLeftRatio: pickedLowestRenewRatio, avgBecameUnreachableOnCapture: avgOf(becameUnreachableList),
        intentionalLetCount: intentionalLets.length, diffZeroCount: diffZero
      },
      judge2: {
        remainingMinusTargetDist: renewDiffs, belowTargetRatio: belowTargetRatio,
        windowPassedThenRenewRatio: windowPassedThenRenewRatio, invalidDoubleClickRate: invalidDoubleClickRate,
        expiredWithRenewLeftRatio: expiredWithRenewLeftRatio
      },
      busyRate: { secTotal: g.busySecTotal, actionsTotal: g.busyActionsTotal, rate: ratio(g.busyActionsTotal, g.busySecTotal) },
      maxConcurrent: g.maxConcurrent,
      spawnBlockedCount: g.spawnBlockedCount,
      totals: g.totals,
      spawnRatioVsLambda: (function () {
        var totalActiveSec = g.elapsed / 1000;
        var lambdaIntegral = PARAMS.spawnRateBase * totalActiveSec + PARAMS.spawnRateSlope * totalActiveSec * totalActiveSec / 2;
        return lambdaIntegral > 0 ? g.totals.spawned / lambdaIntegral : null;
      })(),
      firstWindowDelayAvgMs: avgOf(firstWindowDelays),
      avgLifespanMs: avgOf(lifespans),
      dragTimeRatio: dragRatio,
      dragTimeRatioOverThreshold: dragRatio != null ? dragRatio >= 0.45 : null,
      deathTimeoutClass: deathTimeoutClass,
      expiredWithRenewLeftCount: expiredWithRenewLeftCount,
      busyLossRatioByLife: busyLossRatio,
      redrawLossRatioByLife: redrawLossRatio,
      lastStandTriggerCount: g.totals.lastStandTrigger,
      lastStandTriggerRatio: lastStandTriggerRatio,
      avgTarget: avgTarget,
      avgTargetLastStand: avgTargetLastStand,
      pauseCount: g.pauseCount,
      segments: segments
    };
  }

  function finalizeAndDownload(g) {
    finalizeSpawnBlocked(g, nowElapsed(g));
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    // 局結束: 對所有還開著的窗口與尚未結算的命收尾
    g.bubbles.slice().forEach(function (b) {
      if (b.windowOpen) closeWindow(g, b, 'gameEnd');
      finalizeLife(g, b, 'gameEnd', false);
    });
    g.pendingNumberBounceBackfills.forEach(function (it) { it.record.laterCaught = false; it.record.timeToCaptureMs = null; });
    g.pendingNumberBounceBackfills = [];
    g.retargets.forEach(function (it) { if (!it.done) { it.record.laterCaught = false; it.done = true; } });
    g.deathFieldCount = fieldCount(g);
    var summary = computeSummary(g);
    var out = {
      playerId: PLAYER_ID,
      gameIndex: g.gameIndex,
      device: g.device,
      gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: PARAMS,
      durationSec: Math.round(g.elapsed) / 1000,
      deathReasonPrimary: g.deathReasonPrimary,
      deathReasons: g.deathReasons,
      firstHitElapsedMs: g.firstHitElapsed,
      wrongBeforeFirstHit: g.wrongBeforeFirstHit,
      secFromFirstHitToDeath: g.firstHitElapsed == null ? null : (g.elapsed - g.firstHitElapsed) / 1000,
      summary: summary,
      events: g.events
    };
    return downloadJson(out);
  }

  // 回傳是否成功觸發下載, 供結束畫面顯示「紀錄已下載 / 紀錄下載失敗」用
  function downloadJson(obj) {
    try {
      var now = new Date();
      var name = 'gamelog-WebGame_BubbleCatcher-' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
        '-' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) + '.json';
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function endGame(reason) {
    var g = game;
    if (reason === 'hpZero') {
      var uniq = [];
      g.pendingDeathReasons.forEach(function (r) { if (uniq.indexOf(r) === -1) uniq.push(r); });
      if (uniq.length === 0) uniq = ['expire'];
      g.deathReasons = uniq;
      g.deathReasonPrimary = uniq.indexOf('wrong') !== -1 ? 'wrong' : uniq[0];
    } else {
      g.deathReasonPrimary = reason; // 'quit' | 'restart'
      g.deathReasons = [reason];
    }
    if (mouse.press && mouse.press.dragging) { mouse.press = null; } // 局結束中止拖曳, 不記放下事件
    else mouse.press = null;
    var downloadOk = finalizeAndDownload(g);
    endInfo = { time: g.elapsed / 1000, score: g.score, note: downloadOk ? '紀錄已下載' : '紀錄下載失敗' };
    lastGameEndWall = Date.now();
    if (reason === 'restart') {
      startNewGame();
      screen = SCREEN.PLAYING;
    } else {
      screen = SCREEN.END;
    }
  }

  function startNewGame() {
    var idx = nextGameIndex();
    game = createGame(idx);
    endInfo = null;
    screen = SCREEN.PLAYING;
  }

  // ==================================================================
  // 輸入: 滑鼠(唯一操作方式, 守則 R1, 不掛鍵盤事件)
  // ==================================================================
  var mouse = { x: 0, y: 0, press: null, uiDownKey: null };

  function updateMousePos(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (W / rect.width);
    mouse.y = (e.clientY - rect.top) * (H / rect.height);
  }

  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

  function titleLocate(p) {
    if (inRect(p.x, p.y, L.title.start)) return 'start';
    if (inRect(p.x, p.y, L.title.help)) return 'help';
    if (inRect(p.x, p.y, L.title.device)) return 'device';
    return null;
  }
  function inputLocate(p) {
    if (inRect(p.x, p.y, L.inputSelect.mouse)) return 'mouse';
    if (inRect(p.x, p.y, L.inputSelect.touchpad)) return 'touchpad';
    return null;
  }
  function pauseMenuLocate(p) {
    var m = L.pauseMenu;
    if (inRect(p.x, p.y, m.resume)) return 'resume';
    if (inRect(p.x, p.y, m.restart)) return 'restart';
    if (inRect(p.x, p.y, m.quit)) return 'quit';
    if (inRect(p.x, p.y, m.help)) return 'help';
    return null;
  }
  function guideLocate(p) {
    var g2 = L.guide;
    if (inRect(p.x, p.y, g2.close)) return 'close';
    if (guidePage > 1 && inRect(p.x, p.y, g2.prev)) return 'prev';
    if (guidePage < 5 && inRect(p.x, p.y, g2.next)) return 'next';
    return null;
  }
  function endLocate(p) {
    if (inRect(p.x, p.y, L.end.retry)) return 'retry';
    if (inRect(p.x, p.y, L.end.toTitle)) return 'toTitle';
    return null;
  }
  function pauseBtnLocate(p) { return inRect(p.x, p.y, L.pauseButton); }

  function doTitleAction(key) {
    if (key === 'start') {
      if (deviceType) { startNewGame(); }
      else { inputSelectFrom = 'start'; screen = SCREEN.INPUT; }
    } else if (key === 'help') {
      guideReturnTo = 'title'; guidePage = 1; screen = SCREEN.GUIDE;
    } else if (key === 'device') {
      inputSelectFrom = 'title'; screen = SCREEN.INPUT;
    }
  }
  function doInputAction(key) {
    deviceType = key; saveDevice(key);
    if (inputSelectFrom === 'start') { startNewGame(); }
    else { screen = SCREEN.TITLE; }
    inputSelectFrom = null;
  }
  function doPauseMenuAction(key) {
    var g = game;
    if (key === 'resume') resumePause(g);
    else if (key === 'restart') endGame('restart');
    else if (key === 'quit') endGame('quit');
    else if (key === 'help') { guideReturnTo = 'paused'; guidePage = 1; screen = SCREEN.GUIDE; }
  }
  function doGuideAction(key) {
    if (key === 'close') {
      screen = guideReturnTo || SCREEN.TITLE; guideReturnTo = null;
      if (pendingAutoGuideClose) { markSeenGuide(); pendingAutoGuideClose = false; }
    } else if (key === 'prev') { if (guidePage > 1) guidePage--; }
    else if (key === 'next') { if (guidePage < 5) guidePage++; }
  }
  function doEndAction(key) {
    if (key === 'retry') startNewGame();
    else if (key === 'toTitle') screen = SCREEN.TITLE;
  }

  // ---- 氣泡互動(playing 畫面) ----
  function catchableBubbles(g) { return g.bubbles.filter(function (b) { return b.mode === 'idle'; }); }

  function findBubbleUnderPoint(g, px, py) {
    var list = catchableBubbles(g);
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = dist(px, py, list[i].x, list[i].y);
      if (d <= BUBBLE_R && d < bestD) { best = list[i]; bestD = d; }
    }
    return best;
  }

  function handlePlayingMouseDown(p) {
    var g = game;
    if (pauseBtnLocate(p)) { mouse.uiDownKey = 'pauseBtn'; return; }
    mouse.uiDownKey = null;
    var now = nowElapsed(g);
    var target = null, isSecondHit = false, secondHitByTolerance = false, pairInfo = null;
    if (g.pendingClick && (now - g.pendingClick.downTime) <= PARAMS.doubleClickWindowMs) {
      var pcBubble = findBubbleById(g, g.pendingClick.bubbleId);
      if (pcBubble && pcBubble.mode === 'idle' && dist(p.x, p.y, g.pendingClick.downPos.x, g.pendingClick.downPos.y) <= PARAMS.doubleClickTolerance) {
        target = pcBubble;
        isSecondHit = true;
        secondHitByTolerance = dist(p.x, p.y, pcBubble.x, pcBubble.y) > BUBBLE_R;
        pairInfo = g.pendingClick;
      }
    }
    if (!target) target = findBubbleUnderPoint(g, p.x, p.y);
    if (!target) return;
    mouse.press = {
      bubbleId: target.id, bubble: target, downPos: { x: p.x, y: p.y }, downTime: now,
      dragging: false, isSecondHit: isSecondHit, secondHitByTolerance: secondHitByTolerance, pairInfo: pairInfo
    };
  }

  function handlePlayingMouseMove(p) {
    var g = game;
    if (!mouse.press) return;
    var press = mouse.press;
    var b = press.bubble;
    if (!b || b.dead) return;
    if (!press.dragging) {
      var d = dist(p.x, p.y, press.downPos.x, press.downPos.y);
      if (d > PARAMS.dragStartDistance) {
        press.dragging = true;
        g.pendingClick = null;
        b.mode = 'drag';
        b.dragStartElapsed = nowElapsed(g);
        b.dragDistance = 0;
        b.everGrabbed = true;
        b.lastGrabElapsed = nowElapsed(g);
        if (b.windowOpen) b.windowMeta.grabElapsedDuring = nowElapsed(g);
        b._lastDragX = b.x; b._lastDragY = b.y;

        var openSameColor = g.bubbles.filter(function (o) { return o.color === b.color && o.windowOpen && o.id !== b.id; });
        var selectedIsOneOfOpen = b.windowOpen;
        var fullOpenSameColor = openSameColor.concat(selectedIsOneOfOpen ? [b] : []);
        var anotherFewer = openSameColor.some(function (o) { return o.renewCount > b.renewCount; });
        emit(g, 'grab', {
          bubbleId: b.id, display: displayOf(b.timer), diffToTarget: (function () { var net = netOfColor(g, b.color); return net ? displayOf(b.timer) - net.target : null; })(),
          fieldCount: fieldCount(g), sameColorOpenCount: fullOpenSameColor.length, selectedIsOneOfOpen: selectedIsOneOfOpen,
          selectedRenewsLeft: PARAMS.renewMax - b.renewCount, anotherOpenWithFewerRenewsLeft: anotherFewer,
          intervalSinceLastDropMs: g.lastDropElapsed == null ? null : (nowElapsed(g) - g.lastDropElapsed),
          otherWindowOpenAtLastDrop: g.lastDropOtherWindowOpen
        });
        b.x = p.x; b.y = p.y;
      }
    } else {
      var moved = dist(p.x, p.y, b._lastDragX, b._lastDragY);
      b.dragDistance += moved;
      b._lastDragX = p.x; b._lastDragY = p.y;
      b.x = p.x; b.y = p.y;
    }
  }

  function handlePlayingMouseUp(p) {
    var g = game;
    if (mouse.uiDownKey === 'pauseBtn') {
      if (pauseBtnLocate(p)) openPause(g, 'button');
      mouse.uiDownKey = null;
      return;
    }
    var press = mouse.press;
    if (!press) return;
    mouse.press = null;
    var b = press.bubble;
    if (press.dragging) {
      if (b && !b.dead) resolveRelease(g, b, p.x, p.y);
      return;
    }
    if (!b || b.dead) return;
    if (press.isSecondHit && press.pairInfo) {
      var intervalMs = press.downTime - press.pairInfo.downTime;
      var displacement = dist(press.pairInfo.downPos.x, press.pairInfo.downPos.y, p.x, p.y);
      resolveDoubleClick(g, b, press.secondHitByTolerance, intervalMs, displacement);
      g.pendingClick = null;
    } else {
      g.pendingClick = { bubbleId: b.id, downPos: { x: press.downPos.x, y: press.downPos.y }, downTime: press.downTime };
    }
  }

  // ---- 事件綁定(只用滑鼠, 不掛鍵盤) ----
  canvas.addEventListener('mousedown', function (e) {
    e.preventDefault();
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (screen === SCREEN.TITLE) mouse.uiDownKey = titleLocate(p);
    else if (screen === SCREEN.INPUT) mouse.uiDownKey = inputLocate(p);
    else if (screen === SCREEN.PLAYING) handlePlayingMouseDown(p);
    else if (screen === SCREEN.PAUSED) mouse.uiDownKey = pauseMenuLocate(p);
    else if (screen === SCREEN.GUIDE) mouse.uiDownKey = guideLocate(p);
    else if (screen === SCREEN.END) mouse.uiDownKey = endLocate(p);
  });

  canvas.addEventListener('mousemove', function (e) {
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (screen === SCREEN.TITLE) titleHover = titleLocate(p);
    else if (screen === SCREEN.INPUT) inputHover = inputLocate(p);
    else if (screen === SCREEN.PLAYING) { pauseBtnHover = pauseBtnLocate(p); handlePlayingMouseMove(p); }
    else if (screen === SCREEN.PAUSED) pauseMenuHover = pauseMenuLocate(p);
    else if (screen === SCREEN.GUIDE) guideHover = guideLocate(p);
    else if (screen === SCREEN.END) endHover = endLocate(p);
  });

  function handleGenericMouseUp(e) {
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (screen === SCREEN.TITLE) {
      var k = titleLocate(p);
      if (k && k === mouse.uiDownKey) doTitleAction(k);
      mouse.uiDownKey = null;
    } else if (screen === SCREEN.INPUT) {
      var k2 = inputLocate(p);
      if (k2 && k2 === mouse.uiDownKey) doInputAction(k2);
      mouse.uiDownKey = null;
    } else if (screen === SCREEN.PLAYING) {
      handlePlayingMouseUp(p);
    } else if (screen === SCREEN.PAUSED) {
      var k3 = pauseMenuLocate(p);
      if (k3 && k3 === mouse.uiDownKey) doPauseMenuAction(k3);
      mouse.uiDownKey = null;
    } else if (screen === SCREEN.GUIDE) {
      var k4 = guideLocate(p);
      if (k4 && k4 === mouse.uiDownKey) doGuideAction(k4);
      mouse.uiDownKey = null;
    } else if (screen === SCREEN.END) {
      var k5 = endLocate(p);
      if (k5 && k5 === mouse.uiDownKey) doEndAction(k5);
      mouse.uiDownKey = null;
    }
  }
  canvas.addEventListener('mouseup', function (e) { e.preventDefault(); handleGenericMouseUp(e); });
  // 指標在瀏覽器視窗外放開仍要能收到 mouseup(視為在其他位置放開, 彈回內圈)
  window.addEventListener('mouseup', function (e) {
    if (screen === SCREEN.PLAYING && mouse.press) handleGenericMouseUp(e);
  });
  window.addEventListener('blur', function () {
    if (screen === SCREEN.PLAYING) {
      forceBounceCurrentDrag(game);
      openPause(game, 'blur');
    }
  });

  // ==================================================================
  // 渲染
  // ==================================================================
  function bubbleState(b) {
    return {
      x: b.x, y: b.y, color: b.color, timer: Math.max(0, b.timer), renewCount: b.renewCount, mode: b.mode,
      renewFx: b.renewFx || 0, renewFailFx: b.renewFailFx || 0
    };
  }

  function renderGame() {
    var g = game;
    Art.drawBackground(ctx);
    Art.drawInnerRing(ctx);
    var dragging = mouse.press && mouse.press.dragging;
    var dragBubble = dragging ? findBubbleById(g, mouse.press.bubbleId) : null;
    for (var i = 0; i < g.nets.length; i++) {
      var net = g.nets[i];
      var hot = !!(dragBubble && dist(mouse.x, mouse.y, net.x, net.y) <= NET_R);
      Art.drawNet(ctx, { x: net.x, y: net.y, color: net.color, target: net.target, targetFx: net.targetFx, hot: hot, flash: net.flash, flashT: net.flashT });
    }
    var others = g.bubbles.filter(function (b) { return b.mode !== 'drag'; });
    for (var j = 0; j < others.length; j++) Art.drawBubble(ctx, bubbleState(others[j]));
    if (dragBubble) Art.drawBubble(ctx, bubbleState(dragBubble));
    Art.drawHud(ctx, { hp: g.hp, hpMax: PARAMS.hpMax, time: g.elapsed / 1000, paused: (screen === SCREEN.PAUSED), score: g.score, combo: g.combo, hpFlash: g.hpFlash });
    Art.drawPauseButton(ctx, { hover: pauseBtnHover });
  }

  function render() {
    if (screen === SCREEN.TITLE) Art.drawTitleScreen(ctx, { hover: titleHover, device: deviceType });
    else if (screen === SCREEN.INPUT) Art.drawInputSelect(ctx, { selected: deviceType, hover: inputHover });
    else if (screen === SCREEN.PLAYING) renderGame();
    else if (screen === SCREEN.PAUSED) { renderGame(); Art.drawPauseMenu(ctx, { hover: pauseMenuHover }); }
    else if (screen === SCREEN.GUIDE) Art.drawGuidePage(ctx, { page: guidePage, hover: guideHover });
    else if (screen === SCREEN.END) Art.drawEndScreen(ctx, { time: endInfo ? endInfo.time : 0, score: endInfo ? endInfo.score : 0, note: endInfo ? endInfo.note : '', hover: endHover });
  }

  // ==================================================================
  // 主迴圈
  // ==================================================================
  var lastTs = null;
  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(dt, 1 / 30); // 切分頁回來不瞬移
    if (screen === SCREEN.PLAYING) tick(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
