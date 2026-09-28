// 捕泡手 遊戲邏輯。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art。
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

  var BUILD_VERSION = 'demo-0.1.0';

  var PARAMS = {
    bubbleRadius: BUBBLE_R,
    netRadius: NET_R,
    netCooldown: 2.0,
    innerCapacityK: 30,
    spawnGap: 4,
    spawnTries: 10,
    spawnRetryInterval: 0.25,
    firstSpawnDelay: 1.0,
    initialTimer: 12,
    renewSeq: [12, 7, 3],
    renewMax: 2,
    spawnRateBase: 0.38,
    spawnRateSlope: 0.004,
    spawnJitter: 0.4,
    minSpawnInterval: 0.25,
    sameColorStreakCap: 3,
    hpMax: 4,
    doubleClickTolerance: 20,
    expireHpLoss: 1,
    wrongNetHpLoss: 1,
    sameColorCooldownHpLoss: 0,
    doubleClickWindowMs: 350,
    dragStartDistance: 6,
    returnDuration: 0.2,
    scoreBase: 10,
    comboBonusPerStreak: 0.1,
    comboStreakCap: 20,
    cooldownStayOuter: 30,
    sampleInterval: 1.0
  };

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

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
  function loadDevice() {
    try { return localStorage.getItem(DEVICE_KEY) || null; } catch (e) { return null; }
  }
  function saveDevice(dev) {
    try { localStorage.setItem(DEVICE_KEY, dev); } catch (e) {}
  }
  function hasSeenGuide() {
    try { return localStorage.getItem(SEEN_GUIDE_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeenGuide() {
    try { localStorage.setItem(SEEN_GUIDE_KEY, '1'); } catch (e) {}
  }

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
  var endInfo = null;                     // {time, score}
  var lastGameEndWall = null;             // Date.now() 於上一局結束時

  var titleHover = null, inputHover = null, pauseBtnHover = false, pauseMenuHover = null, guideHover = null, endHover = null;

  var game = null; // 目前這一局的狀態(見 createGame)

  // ==================================================================
  // 建立新局
  // ==================================================================
  function createGame(idx) {
    var gapFromPrev = lastGameEndWall == null ? null : (Date.now() - lastGameEndWall);
    var nets = [];
    for (var i = 0; i < NETS_DEF.length; i++) {
      nets.push({ x: NETS_DEF[i].x, y: NETS_DEF[i].y, color: NETS_DEF[i].color, cooldown: 0, flash: null, flashT: 0 });
    }
    return {
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
      pendingClick: null,      // {bubbleId, downPos, downTime, bubblePosAtClick}
      sampleAcc: 0,
      events: [],
      paused: false,
      openPauseRecord: null,
      // 彙整用累計
      totals: { spawned: 0, caught: 0, expired: 0, wrongNet: 0, cooldownBounce: 0, outerBounce: 0, renewSuccess: 0, renewAttempt: 0 },
      maxConcurrent: 0,
      spawnBlockedCount: 0,
      firstHitElapsed: null,
      wrongBeforeFirstHit: 0,
      lastHpLossReason: null,
      firstExpireGenElapsed: null,
      firstExpireHappenedElapsed: null,
      firstExpireFieldCount: null,
      deathFieldCount: null,
      lastCaughtColor: null,
      sameColorCatchCount: 0,
      catchWithPrevCount: 0,
      busySecTotal: 0,
      busyActionsTotal: 0,
      busyActionsBefore: 0, busySecBefore: 0,
      busyActionsAfter: 0, busySecAfter: 0,
      renewBefore: 0, renewAfter: 0, renewTotalExtend: 0,
      lastDropElapsed: null,
      lastDropHadOthers: null,
      pendingBounceBackfills: [],
      totalDropEvents: 0,
      lastCaptureElapsed: null,
      deathReason: null
    };
  }

  function fieldCount(g) { return g.bubbles.length; }

  function nowElapsed(g) { return Math.round(g.elapsed); }

  function emit(g, type, fields) {
    var rec = { t: nowElapsed(g), gameId: g.id, type: type };
    for (var k in fields) rec[k] = fields[k];
    g.events.push(rec);
    return rec;
  }

  // ==================================================================
  // 生成
  // ==================================================================
  function pickColor(g) {
    var pool = [0, 1, 2, 3];
    if (g.lastSpawnColors.length >= 3) {
      var n = g.lastSpawnColors.length;
      var a = g.lastSpawnColors[n - 1], b = g.lastSpawnColors[n - 2], c = g.lastSpawnColors[n - 3];
      if (a === b && b === c) pool = pool.filter(function (x) { return x !== a; });
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 場上目前位於內圈附近、生成需避開的氣泡(含拖曳中若位於內圈內)
  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) {
      return dist(b.x, b.y, INNER.x, INNER.y) <= INNER.r;
    });
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
      g.spawnBlockedOpen = { reason: reason, startElapsed: g.elapsed, tries: 1, record: rec };
    } else {
      g.spawnBlockedOpen.tries++;
      g.spawnBlockedOpen.record.tries = g.spawnBlockedOpen.tries;
    }
    g.spawnTimer = PARAMS.spawnRetryInterval;
  }

  function finalizeSpawnBlocked(g) {
    if (!g.spawnBlockedOpen) return;
    g.spawnBlockedOpen.record.durationMs = nowElapsed(g) - g.spawnBlockedOpen.record.t;
    g.spawnBlockedCount++;
    g.spawnBlockedOpen = null;
  }

  function finalizeSpawnBlockedAtEnd(g) {
    if (!g.spawnBlockedOpen) return;
    g.spawnBlockedOpen.record.durationMs = nowElapsed(g) - g.spawnBlockedOpen.record.t;
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

  function attemptSpawn(g) {
    if (g.pendingSpawnColor == null) g.pendingSpawnColor = pickColor(g);
    var color = g.pendingSpawnColor;
    if (fieldCount(g) >= PARAMS.innerCapacityK) { onSpawnBlocked(g, 'capacityFull'); return; }
    var pos = findSpawnPosition(g);
    if (!pos) { onSpawnBlocked(g, 'placementFail'); return; }
    // 成功生成
    var id = g.nextBubbleId++;
    var b = makeBubble(id, color, pos.x, pos.y, g.elapsed);
    g.bubbles.push(b);
    g.lastSpawnColors.push(color);
    if (g.lastSpawnColors.length > 3) g.lastSpawnColors.shift();
    g.totals.spawned++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    emit(g, 'spawn', { bubbleId: id, color: color, initialTimer: PARAMS.initialTimer, x: pos.x, y: pos.y, countOnField: fieldCount(g) });
    g.pendingSpawnColor = null;
    if (g.spawnBlockedOpen) finalizeSpawnBlocked(g);
    scheduleNextSpawnInterval(g);
  }

  function makeBubble(id, color, x, y, spawnElapsed) {
    return {
      id: id, color: color, x: x, y: y,
      timer: PARAMS.initialTimer,
      renewCount: 0,
      mode: 'idle',
      spawnElapsed: spawnElapsed,
      everGrabbed: false,
      dead: false,
      dragStartTime: null,
      dragDistance: 0,
      dragCooldownStayMs: 0,
      renewFx: 0,
      renewFailFx: 0,
      returnFrom: null, returnTo: null, returnElapsed: 0
    };
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
    if (moveBoth) {
      a.x += ux * overlap / 2; a.y += uy * overlap / 2;
      b.x -= ux * overlap / 2; b.y -= uy * overlap / 2;
    } else {
      a.x += ux * overlap; a.y += uy * overlap;
    }
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
    // 彈回動畫
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
  function loseHp(g, reason, atCountOverride) {
    g.hp = Math.max(0, g.hp - 1);
    g.combo = 0;
    g.hpFlash = 1;
    g.lastHpLossReason = reason;
    if (g.firstHitElapsed == null) g.firstHitElapsed = nowElapsed(g);
    var cnt = atCountOverride == null ? fieldCount(g) : atCountOverride;
    emit(g, 'hpChange', { reason: reason, countOnField: cnt, hp: g.hp });
  }

  function scoreForCombo(combo) {
    var bonus = Math.min(combo - 1, PARAMS.comboStreakCap) * PARAMS.comboBonusPerStreak;
    return Math.round(PARAMS.scoreBase * (1 + bonus));
  }

  // ==================================================================
  // 移除 / 過期
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    var wasDragging = (b.mode === 'drag');
    removeBubble(g, b);
    b.wasDraggingWhenExpired = wasDragging;
    var cnt = fieldCount(g);
    emit(g, 'expire', { bubbleId: b.id, color: b.color, everGrabbed: b.everGrabbed, renewCount: b.renewCount, countOnField: cnt, draggingAtExpiry: wasDragging });
    g.totals.expired++;
    trackRenewLeftButExpired(g, b.renewCount < PARAMS.renewMax);
    if (g.firstExpireGenElapsed == null) {
      g.firstExpireGenElapsed = b.spawnElapsed;
      g.firstExpireHappenedElapsed = nowElapsed(g);
      g.firstExpireFieldCount = cnt;
    }
    loseHp(g, 'expire', cnt);
  }

  function trackRenewLeftButExpired(g, hadLeft) {
    if (!g.renewLeftButExpired) g.renewLeftButExpired = { had: 0, total: 0 };
    g.renewLeftButExpired.total++;
    if (hadLeft) g.renewLeftButExpired.had++;
  }

  // ==================================================================
  // 網 / 落點
  // ==================================================================
  function findNetAt(g, x, y) {
    for (var i = 0; i < g.nets.length; i++) {
      if (dist(x, y, g.nets[i].x, g.nets[i].y) <= NET_R) return g.nets[i];
    }
    return null;
  }
  function nearestNetDistance(g, x, y) {
    var best = Infinity;
    for (var i = 0; i < g.nets.length; i++) {
      var d = dist(x, y, g.nets[i].x, g.nets[i].y);
      if (d < best) best = d;
    }
    return best;
  }
  function matchingColorNet(g, color) {
    for (var i = 0; i < g.nets.length; i++) if (g.nets[i].color === color) return g.nets[i];
    return null;
  }

  function startReturn(b, fromX, fromY) {
    var ang = Math.atan2(fromY - INNER.y, fromX - INNER.x);
    if (fromX === INNER.x && fromY === INNER.y) ang = Math.random() * Math.PI * 2;
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = { x: INNER.x + Math.cos(ang) * MOVE_R, y: INNER.y + Math.sin(ang) * MOVE_R };
    b.returnElapsed = 0;
  }

  function resolveBounceBackfills(g, capturedBubbleId) {
    var list = g.pendingBounceBackfills;
    if (!list.length) return;
    var capT = nowElapsed(g);
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      rec.record.timeToNextCaptureMs = capT - rec.startElapsed;
      rec.record.catchIntervalAcrossBounceMs = rec.lastCaptureBeforeBounceElapsed == null ? null : (capT - rec.lastCaptureBeforeBounceElapsed);
      rec.record.isNextCaptureSameBubble = (rec.bubbleId === capturedBubbleId);
      rec.record.dropCountBetween = g.totalDropEvents - rec.dropCountAtBounceTime;
    }
    g.pendingBounceBackfills = [];
  }

  function doCapture(g, b, net) {
    var newCombo = g.combo + 1;
    var pts = scoreForCombo(newCombo);
    g.score += pts;
    g.combo = newCombo;
    net.cooldown = PARAMS.netCooldown;
    net.flash = 'catch'; net.flashT = 0;
    g.totals.caught++;
    if (g.lastCaughtColor != null) {
      g.catchWithPrevCount++;
      if (g.lastCaughtColor === b.color) g.sameColorCatchCount++;
    }
    g.lastCaughtColor = b.color;
    g.lastCapturedFieldCountAfter = null;
    resolveBounceBackfills(g, b.id);
    removeBubble(g, b);
  }

  // ==================================================================
  // 放開判定
  // ==================================================================
  function resolveRelease(g, b, px, py) {
    var wasDragging = true;
    var net = findNetAt(g, px, py);
    var outcome, targetNetColor = null, colorCorrect = null, netCooling = null;
    var distToNet = nearestNetDistance(g, px, py);
    var beforeCount = fieldCount(g); // 放開前
    if (net) {
      targetNetColor = net.color;
      colorCorrect = (b.color === net.color);
      netCooling = net.cooldown > 0;
      if (!colorCorrect) {
        outcome = 'wrong';
        net.flash = 'wrong'; net.flashT = 0;
        g.totals.wrongNet++;
        var wasBeforeFirstHit = (g.firstHitElapsed == null);
        removeBubble(g, b);
        loseHp(g, 'wrongNet');
        if (wasBeforeFirstHit) g.wrongBeforeFirstHit++;
      } else if (netCooling) {
        outcome = 'cooldownBounce';
        g.totals.cooldownBounce++;
        var rec = emit(g, 'cooldownBounce', { bubbleId: b.id, netColor: net.color, netCooldown: net.cooldown, timeToNextCaptureMs: null, catchIntervalAcrossBounceMs: null, isNextCaptureSameBubble: null, dropCountBetween: null });
        g.pendingBounceBackfills.push({
          bubbleId: b.id, startElapsed: nowElapsed(g),
          lastCaptureBeforeBounceElapsed: g.lastCaptureElapsed,
          dropCountAtBounceTime: g.totalDropEvents,
          record: rec
        });
        startReturn(b, px, py);
      } else {
        outcome = 'capture';
        g.lastCaptureElapsed = nowElapsed(g);
        doCapture(g, b, net);
      }
    } else {
      var dToCenter = dist(px, py, INNER.x, INNER.y);
      if (dToCenter <= INNER.r) {
        // 在內圈邊界內(含邊線與活動半徑間的窄環, 收進內圈; RD 待定項決定: 收進)
        outcome = 'stayInner';
        b.mode = 'idle';
        b.x = px; b.y = py;
        clampToCircle(b);
      } else {
        outcome = 'outerBounce';
        g.totals.outerBounce++;
        emit(g, 'outerBounce', { bubbleId: b.id, x: px, y: py });
        startReturn(b, px, py);
      }
    }
    var afterCount = fieldCount(g);
    emit(g, 'drop', {
      bubbleId: b.id, targetNetColor: targetNetColor, colorCorrect: colorCorrect, netCooling: netCooling,
      outcome: outcome, dragDurationMs: nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed),
      dragDistance: b.dragDistance, countOnField: afterCount, distanceToNearestNetCenter: distToNet,
      cooldownStayDurationMs: b.dragCooldownStayMs
    });
    g.totalDropEvents++;
    g.lastDropElapsed = nowElapsed(g);
    g.lastDropHadOthers = afterCount > 0;
    // 忙碌期處理速率分子: 只有捕捉與錯網讓氣泡離場才算
    if (outcome === 'capture' || outcome === 'wrong') {
      var busy = beforeCount >= 2;
      if (busy) {
        g.busyActionsTotal++;
        if (g.firstHitElapsed == null) g.busyActionsBefore++; else g.busyActionsAfter++;
      }
    }
  }

  // ==================================================================
  // 雙擊續命
  // ==================================================================
  function resolveDoubleClick(g, b, downPos, secondHitByTolerance, intervalMs, bubblePosAtFirstClick) {
    var attemptNo = b.renewCount + 1;
    var capBefore = PARAMS.renewSeq[b.renewCount];
    var nextCap = b.renewCount < PARAMS.renewMax ? PARAMS.renewSeq[b.renewCount + 1] : null;
    var eligible = (nextCap != null) && (b.timer < nextCap);
    var remainingBefore = b.timer;
    var displacement = bubblePosAtFirstClick ? dist(b.x, b.y, bubblePosAtFirstClick.x, bubblePosAtFirstClick.y) : 0;
    var resultTimer = remainingBefore;
    if (eligible) {
      b.timer = nextCap;
      b.renewCount++;
      resultTimer = nextCap;
      b.renewFx = 1;
      g.totals.renewSuccess++;
      if (g.firstHitElapsed == null) g.renewBefore++; else g.renewAfter++;
      g.renewTotalExtend += (nextCap - remainingBefore);
    } else {
      b.renewFailFx = 1;
    }
    g.totals.renewAttempt++;
    emit(g, 'renew', {
      bubbleId: b.id, remainingBefore: remainingBefore, capBefore: capBefore, attemptNo: attemptNo,
      success: eligible, resultTimer: resultTimer, intervalMs: intervalMs,
      secondHitByTolerance: !!secondHitByTolerance, displacementBetweenClicks: displacement
    });
  }

  // ==================================================================
  // 暫停 / 恢復
  // ==================================================================
  function openPause(g, reason) {
    if (g.paused) return;
    g.paused = true;
    var rec = emit(g, 'pause', { startTimeMs: Date.now() - g.startWall, endTimeMs: null, reason: reason });
    g.openPauseRecord = rec;
    screen = SCREEN.PAUSED;
  }
  function resumePause(g) {
    if (!g.paused) return;
    g.paused = false;
    if (g.openPauseRecord) { g.openPauseRecord.endTimeMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    screen = SCREEN.PLAYING;
  }

  // 拖曳中視窗失去焦點: 規格要求「當下立刻視為在其他位置放開, 彈回內圈」,
  // 不看指標當下實際位置是否剛好停在網上 —— 一律當外部彈回處理, 不能走 resolveRelease
  // 一般的落點判斷(那樣萬一指標正好停在網上會誤判成捕捉 / 錯網 / 冷卻彈回)。
  function forceBounceCurrentDrag(g) {
    if (!(mouse.press && mouse.press.dragging)) return;
    var b = mouse.press.bubble;
    if (b && !b.dead) {
      var px = mouse.x, py = mouse.y;
      var distToNet = nearestNetDistance(g, px, py);
      startReturn(b, px, py);
      g.totals.outerBounce++;
      emit(g, 'outerBounce', { bubbleId: b.id, x: px, y: py });
      emit(g, 'drop', {
        bubbleId: b.id, targetNetColor: null, colorCorrect: null, netCooling: null,
        outcome: 'outerBounce', dragDurationMs: nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed),
        dragDistance: b.dragDistance, countOnField: fieldCount(g), distanceToNearestNetCenter: distToNet,
        cooldownStayDurationMs: b.dragCooldownStayMs
      });
      g.totalDropEvents++;
      g.lastDropElapsed = nowElapsed(g);
      g.lastDropHadOthers = fieldCount(g) > 0;
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
    var netsState = g.nets.map(function (n) { return { color: n.color, cooldown: Math.round(n.cooldown * 10) / 10 }; });
    var sec = g.elapsed / 1000;
    var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * sec;
    emit(g, 'sample', { countOnField: fieldCount(g), nets: netsState, spawnRate: rate });
  }

  function tick(dt) {
    var g = game;
    g.elapsed += dt * 1000;

    // 生成排程
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) attemptSpawn(g);

    // 物理(彈回中的氣泡不算入下方拖曳排除, drag 本身在 updatePhysics 內天然被排除, 因為只挑 idle 做碰撞)
    updatePhysics(g, dt);

    // 拖曳中: 累計「停在冷卻網上的時長」
    if (mouse.press && mouse.press.dragging) {
      var db = findBubbleById(g, mouse.press.bubbleId);
      if (db) {
        var net = matchingColorNet(g, db.color);
        if (net && net.cooldown > 0 && dist(mouse.x, mouse.y, net.x, net.y) <= NET_R + PARAMS.cooldownStayOuter) {
          db.dragCooldownStayMs += dt * 1000;
        }
      }
    }

    // 倒數與消失(對 slice 複本迭代, 避免邊迭代邊刪)
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      b.timer -= dt;
      if (b.timer <= 0) expireBubble(g, b);
    }

    // 網冷卻與回饋淡出
    for (var n = 0; n < g.nets.length; n++) {
      var net2 = g.nets[n];
      if (net2.cooldown > 0) net2.cooldown = Math.max(0, net2.cooldown - dt);
      if (net2.flash) { net2.flashT += dt / 0.5; if (net2.flashT >= 1) { net2.flash = null; net2.flashT = 0; } }
    }
    // 氣泡回饋淡出
    for (var bi = 0; bi < g.bubbles.length; bi++) {
      var bb = g.bubbles[bi];
      if (bb.renewFx > 0) bb.renewFx = Math.max(0, bb.renewFx - dt / 0.4);
      if (bb.renewFailFx > 0) bb.renewFailFx = Math.max(0, bb.renewFailFx - dt / 0.3);
    }
    if (g.hpFlash > 0) g.hpFlash = Math.max(0, g.hpFlash - dt / 0.6);

    // 忙碌秒數累計
    var cnt = fieldCount(g);
    g.maxConcurrent = Math.max(g.maxConcurrent, cnt);
    if (cnt >= 2) {
      g.busySecTotal += dt;
      if (g.firstHitElapsed == null) g.busySecBefore += dt; else g.busySecAfter += dt;
    }

    // 每秒取樣
    g.sampleAcc += dt;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleInterval && guard < 10) {
      g.sampleAcc -= PARAMS.sampleInterval;
      emitSample(g);
      guard++;
    }

    if (g.hp <= 0) { endGame('hpZero'); }
  }

  // ==================================================================
  // 局末彙整與下載
  // ==================================================================
  function computeSummary(g) {
    var events = g.events;
    function byType(t) { return events.filter(function (e) { return e.type === t; }); }
    var grabs = byType('grab');
    var drops = byType('drop');
    var samples = byType('sample');

    // 累積量開始持續上升的時間(10 秒移動平均, 用每秒取樣)
    var riseStart = null;
    for (var i = 0; i < samples.length; i++) {
      var winStart = samples[i].t - 10000;
      var winVals = samples.filter(function (s) { return s.t <= samples[i].t && s.t > winStart; });
      var avg = winVals.reduce(function (a, s) { return a + s.countOnField; }, 0) / (winVals.length || 1);
      if (avg >= 3) {
        var stillOk = true;
        for (var j = i; j < samples.length; j++) {
          var ws = samples[j].t - 10000;
          var wv = samples.filter(function (s) { return s.t <= samples[j].t && s.t > ws; });
          var avg2 = wv.reduce(function (a, s) { return a + s.countOnField; }, 0) / (wv.length || 1);
          if (avg2 < 2) { stillOk = false; break; }
        }
        if (stillOk) { riseStart = samples[i].t; break; }
      }
    }

    // 循環時間(放下→下一次放下), 只計忙碌期, 排除冷卻彈回/拖曳中過期收尾, 扣掉冷卻停留
    var cycles = { b03: [], b47: [], b8p: [] };
    var reactionTimes = [];
    for (var d = 0; d < drops.length - 1; d++) {
      var cur = drops[d], nxt = drops[d + 1];
      if (nxt.outcome === 'cooldownBounce' || nxt.outcome === 'dragExpired') continue;
      if (cur.countOnField < 2) continue;
      var cycleMs = (nxt.t - cur.t) - (cur.cooldownStayDurationMs || 0);
      var bucket = cur.countOnField <= 3 ? cycles.b03 : (cur.countOnField <= 7 ? cycles.b47 : cycles.b8p);
      bucket.push(cycleMs);
    }
    for (var d2 = 0; d2 < drops.length; d2++) {
      var nextGrab = grabs.filter(function (gr) { return gr.t >= drops[d2].t; })[0];
      if (nextGrab) reactionTimes.push(nextGrab.t - drops[d2].t);
    }
    function stats(arr) {
      if (!arr.length) return { avg: null, p90: null, n: 0 };
      var sorted = arr.slice().sort(function (a, b) { return a - b; });
      var avg = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
      var p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
      return { avg: avg, p90: p90, n: arr.length };
    }

    // 判斷指標一
    var j1 = { beforeCooling: [], beforeFree: [], afterCooling: [], afterFree: [] };
    for (var gI = 0; gI < grabs.length; gI++) {
      var ge = grabs[gI];
      if (ge.fieldCount <= 1) continue;
      var val = (ge.rank - 1) / (ge.fieldCount - 1);
      var before = ge.t <= (g.firstHitElapsed == null ? Infinity : g.firstHitElapsed);
      var key = (before ? 'before' : 'after') + (ge.lowestNetCooling ? 'Cooling' : 'Free');
      j1[key].push(val);
    }
    function avgOf(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }

    // 判斷指標二
    var renews = byType('renew');
    var successRatios = [];
    var invalidCount = 0;
    renews.forEach(function (r) {
      if (r.success) successRatios.push(r.remainingBefore / r.capBefore);
      else invalidCount++;
    });
    var expiredWithRenewLeft = g.renewLeftButExpired ? g.renewLeftButExpired.had : 0;
    var expiredTotal = g.renewLeftButExpired ? g.renewLeftButExpired.total : 0;

    // 判斷指標三
    var j3Denominator = g.totals.caught + g.totals.cooldownBounce;
    var j3 = j3Denominator > 0 ? g.totals.cooldownBounce / j3Denominator : null;
    var bounceBackfills = byType('cooldownBounce');
    var sameBubbleCount = bounceBackfills.filter(function (b) { return b.isNextCaptureSameBubble === true; }).length;
    var resolvedBounces = bounceBackfills.filter(function (b) { return b.isNextCaptureSameBubble !== null; }).length;

    var totalActiveSec = g.elapsed / 1000;
    var lambdaIntegral = PARAMS.spawnRateBase * totalActiveSec + PARAMS.spawnRateSlope * totalActiveSec * totalActiveSec / 2;

    // 忙碌期處理速率(局末彙整的單一常數), 供 ρ(t) = 當下生成率 ÷ 這個常數 使用
    var busyRateOverall = g.busySecTotal > 0 ? g.busyActionsTotal / g.busySecTotal : null;
    var busyRateBefore = g.busySecBefore > 0 ? g.busyActionsBefore / g.busySecBefore : null;
    var busyRateAfter = g.busySecAfter > 0 ? g.busyActionsAfter / g.busySecAfter : null;
    // 壓力比 ρ(t) = 當下生成率(每秒取樣記的 spawnRate) ÷ 忙碌期處理速率(全局常數)
    // 忙碌期處理速率為 0 或無法算(busySecTotal 為 0) 時, ρ 無意義, 直接輸出 null
    var pressureLowAvgFieldCount = null;
    if (busyRateOverall) {
      var lowRhoCounts = [];
      for (var si = 0; si < samples.length; si++) {
        var rho = samples[si].spawnRate / busyRateOverall;
        if (rho < 0.9) lowRhoCounts.push(samples[si].countOnField);
      }
      if (lowRhoCounts.length) {
        pressureLowAvgFieldCount = lowRhoCounts.reduce(function (a, b) { return a + b; }, 0) / lowRhoCounts.length;
      }
    }

    return {
      riseStartElapsedMs: riseStart,
      busyRate: { overall: busyRateOverall, before: busyRateBefore, after: busyRateAfter },
      maxConcurrent: g.maxConcurrent,
      spawnBlockedCount: g.spawnBlockedCount,
      totals: g.totals,
      spawnRatioVsLambda: lambdaIntegral > 0 ? g.totals.spawned / lambdaIntegral : null,
      renewBefore: g.renewBefore, renewAfter: g.renewAfter, renewTotalExtendSec: g.renewTotalExtend,
      firstExpireGenElapsedMs: g.firstExpireGenElapsed,
      firstExpireHappenedElapsedMs: g.firstExpireHappenedElapsed,
      firstExpireFieldCount: g.firstExpireFieldCount,
      deathFieldCount: g.deathFieldCount,
      sameColorCatchRatio: g.catchWithPrevCount > 0 ? g.sameColorCatchCount / g.catchWithPrevCount : null,
      pressureLowAvgFieldCount: pressureLowAvgFieldCount,
      handSpeed: {
        cycleMsBucket03: stats(cycles.b03), cycleMsBucket47: stats(cycles.b47), cycleMsBucket8p: stats(cycles.b8p),
        reactionMs: stats(reactionTimes)
      },
      judge1: {
        beforeCoolingAvg: avgOf(j1.beforeCooling), beforeFreeAvg: avgOf(j1.beforeFree),
        afterCoolingAvg: avgOf(j1.afterCooling), afterFreeAvg: avgOf(j1.afterFree)
      },
      judge2: {
        successRemainRatioAvg: avgOf(successRatios),
        invalidDoubleClickRate: renews.length ? invalidCount / renews.length : null,
        expiredWithRenewLeftRatio: expiredTotal > 0 ? expiredWithRenewLeft / expiredTotal : null
      },
      judge3: { cooldownBounceRatio: j3, sameBubbleNextCaptureRatio: resolvedBounces > 0 ? sameBubbleCount / resolvedBounces : null }
    };
  }

  function finalizeAndDownload(g) {
    finalizeSpawnBlockedAtEnd(g);
    if (g.openPauseRecord) { g.openPauseRecord.endTimeMs = Date.now() - g.startWall; g.openPauseRecord = null; }
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
      deathReason: g.deathReason,
      firstHitElapsedMs: g.firstHitElapsed,
      wrongBeforeFirstHit: g.wrongBeforeFirstHit,
      secFromFirstHitToDeath: g.firstHitElapsed == null ? null : (g.elapsed - g.firstHitElapsed) / 1000,
      summary: summary,
      events: g.events
    };
    downloadJson(out);
  }

  function downloadJson(obj) {
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
  }

  function endGame(reason) {
    var g = game;
    if (reason === 'hpZero') g.deathReason = g.lastHpLossReason;
    else g.deathReason = reason; // 'quit' | 'restart'
    finalizeAndDownload(g);
    endInfo = { time: g.elapsed / 1000, score: g.score };
    lastGameEndWall = Date.now();
    mouse.press = null;
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

  // ---- 通用 UI 按鈕: locate 回傳鍵名或 null ----
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
    }
    else if (key === 'prev') { if (guidePage > 1) guidePage--; }
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

  function rankAndFieldForGrab(g, target) {
    var catchable = catchableBubbles(g);
    var sorted = catchable.slice().sort(function (a, b) { return a.timer - b.timer; });
    var rank = 1;
    for (var i = 0; i < sorted.length; i++) if (sorted[i].id === target.id) { rank = i + 1; break; }
    var lowest = sorted[0];
    var lowestNet = lowest ? matchingColorNet(g, lowest.color) : null;
    return { rank: rank, fieldCount: catchable.length, lowestNetCooling: lowestNet ? lowestNet.cooldown > 0 : false };
  }

  function handlePlayingMouseDown(p) {
    var g = game;
    if (pauseBtnLocate(p)) { mouse.uiDownKey = 'pauseBtn'; return; }
    mouse.uiDownKey = null;
    var now = nowElapsed(g);
    var target = null, isSecondHit = false, secondHitByTolerance = false, pairInfo = null;
    if (g.pendingClick && (now - g.pendingClick.downTime) <= PARAMS.doubleClickWindowMs) {
      var pcBubble = findBubbleById(g, g.pendingClick.bubbleId);
      if (pcBubble && dist(p.x, p.y, g.pendingClick.downPos.x, g.pendingClick.downPos.y) <= PARAMS.doubleClickTolerance) {
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
        game.pendingClick = null; // 這個按壓已變成拖曳, 不再構成雙擊配對
        b.mode = 'drag';
        b.dragStartElapsed = nowElapsed(g);
        b.dragDistance = 0;
        b.dragCooldownStayMs = 0;
        b.everGrabbed = true;
        b._lastDragX = b.x; b._lastDragY = b.y;
        var rf = rankAndFieldForGrab(g, b);
        emit(g, 'grab', {
          bubbleId: b.id, remainingTimer: b.timer, x: p.x, y: p.y,
          rank: rf.rank, fieldCount: rf.fieldCount,
          netCooldownOfColor: matchingColorNet(g, b.color).cooldown,
          lowestNetCooling: rf.lowestNetCooling,
          sameColorAsLastCatch: g.lastCaughtColor == null ? null : (g.lastCaughtColor === b.color),
          intervalSinceLastDropMs: g.lastDropElapsed == null ? null : (nowElapsed(g) - g.lastDropElapsed),
          fieldHadOthersAtLastDrop: g.lastDropHadOthers
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
      if (b && !b.dead) { resolveRelease(g, b, p.x, p.y); }
      else if (b && b.dead) {
        // 拖曳中過期: 仍記一筆放下事件
        emit(g, 'drop', {
          bubbleId: b.id, targetNetColor: null, colorCorrect: null, netCooling: null,
          outcome: 'dragExpired', dragDurationMs: nowElapsed(g) - (b.dragStartElapsed || nowElapsed(g)),
          dragDistance: b.dragDistance, countOnField: fieldCount(g), distanceToNearestNetCenter: nearestNetDistance(g, p.x, p.y),
          cooldownStayDurationMs: b.dragCooldownStayMs
        });
        g.lastDropElapsed = nowElapsed(g);
        g.lastDropHadOthers = fieldCount(g) > 0;
      }
      return;
    }
    // 未拖曳 = 點擊
    if (!b || b.dead) { return; }
    if (press.isSecondHit && press.pairInfo) {
      var intervalMs = press.downTime - press.pairInfo.downTime;
      resolveDoubleClick(g, b, press.pairInfo.downPos, press.secondHitByTolerance, intervalMs, press.pairInfo.bubblePosAtClick);
      g.pendingClick = null;
    } else {
      g.pendingClick = { bubbleId: b.id, downPos: { x: press.downPos.x, y: press.downPos.y }, downTime: press.downTime, bubblePosAtClick: { x: b.x, y: b.y } };
    }
  }

  // ---- 事件綁定(只用滑鼠, 不掛鍵盤) ----
  canvas.addEventListener('mousedown', function (e) {
    e.preventDefault();
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (screen === SCREEN.TITLE) { /* 用 mouseup 處理點擊, mousedown 僅記錄 */ mouse.uiDownKey = titleLocate(p); }
    else if (screen === SCREEN.INPUT) { mouse.uiDownKey = inputLocate(p); }
    else if (screen === SCREEN.PLAYING) { handlePlayingMouseDown(p); }
    else if (screen === SCREEN.PAUSED) { mouse.uiDownKey = pauseMenuLocate(p); }
    else if (screen === SCREEN.GUIDE) { mouse.uiDownKey = guideLocate(p); }
    else if (screen === SCREEN.END) { mouse.uiDownKey = endLocate(p); }
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
    if (screen === SCREEN.PLAYING && mouse.press) { handleGenericMouseUp(e); }
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
    return { x: b.x, y: b.y, color: b.color, timer: Math.max(0, b.timer), renewCount: b.renewCount, mode: b.mode, renewFx: b.renewFx || 0, renewFailFx: b.renewFailFx || 0 };
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
      Art.drawNet(ctx, { x: net.x, y: net.y, color: net.color, cooldown: Math.round(net.cooldown * 10) / 10, cooldownMax: PARAMS.netCooldown, hot: hot, flash: net.flash, flashT: net.flashT });
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
    else if (screen === SCREEN.END) Art.drawEndScreen(ctx, { time: endInfo ? endInfo.time : 0, score: endInfo ? endInfo.score : 0, hover: endHover });
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
