// 捕泡手 遊戲邏輯(spec v6)。純傳統 script,不用 ES module。繪製一律呼叫 window.Art。
// v6 相對 v4 的規則重點: 網由 4 張改 8 張(每色 2 張,各掛當前+下一個數字,捕捉後輪替);
// 捕捉回 1 命、續命不限次數且無末命保護;倒數凍結從「按下」那一刻就開始(不必等拖曳);
// 生成不被內圈容量擋住(找位失敗就強制放在最空位置,推開靠碰撞);新增最大生成間隔;
// 埋點整段重寫,「命」改稱「輪」(輪 = 續命次數 + 1)。
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
  var NETS_DEF = L.nets;              // 8 張網定義 {id,x,y,color}
  var GUIDE_PAGES = L.guide.pages;    // 6

  var BUILD_VERSION = 'demo-v6-0.1.0';

  var PARAMS = {
    bubbleRadius: BUBBLE_R,
    netRadius: NET_R,
    spawnGap: 4,
    spawnTries: 10,
    firstSpawnDelay: 1.0,
    initialTimer: 12,
    renewResetValue: 12,
    spawnRateBase: 0.15,
    spawnRateSlope: 0.0068,
    spawnJitter: 0.4,
    minSpawnInterval: 0.25,
    maxSpawnInterval: 5,
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
  function fullTargetRange() {
    var arr = [];
    for (var v = PARAMS.targetMin; v <= PARAMS.targetMax; v++) arr.push(v);
    return arr;
  }
  // 候選 = 範圍內排除 selfCurrent / otherCurrent / otherNext(otherNext 若不存在傳 null 不排除)
  function nextCandidates(selfCurrent, otherCurrent, otherNext) {
    var excl = [selfCurrent, otherCurrent];
    if (otherNext != null) excl.push(otherNext);
    return fullTargetRange().filter(function (v) { return excl.indexOf(v) === -1; });
  }

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
  // 網: 建立與輪替(每色 2 張, 各掛當前 + 下一個)
  // ==================================================================
  function buildInitialNets(g) {
    var byColor = {};
    for (var i = 0; i < NETS_DEF.length; i++) {
      var d = NETS_DEF[i];
      if (!byColor[d.color]) byColor[d.color] = [];
      byColor[d.color].push(d);
    }
    var nets = [];
    var colors = Object.keys(byColor).map(Number).sort();
    for (var c = 0; c < colors.length; c++) {
      var pair = byColor[colors[c]].sort(function (a, b) { return a.id - b.id; });
      var defA = pair[0], defB = pair[1];
      var targetA = pickFrom(fullTargetRange());
      var targetB = pickFrom(fullTargetRange().filter(function (v) { return v !== targetA; }));
      var nextA = pickFrom(nextCandidates(targetA, targetB, null));
      var nextB = pickFrom(nextCandidates(targetB, targetA, nextA));
      var netA = { id: defA.id, x: defA.x, y: defA.y, color: defA.color, target: targetA, next: nextA, targetFx: 1, hot: false, flash: null, flashT: 0 };
      var netB = { id: defB.id, x: defB.x, y: defB.y, color: defB.color, target: targetB, next: nextB, targetFx: 1, hot: false, flash: null, flashT: 0 };
      nets.push(netA, netB);
    }
    nets.sort(function (a, b) { return a.id - b.id; });
    return nets;
  }

  function siblingNet(g, net) {
    for (var i = 0; i < g.nets.length; i++) {
      if (g.nets[i].color === net.color && g.nets[i].id !== net.id) return g.nets[i];
    }
    return null;
  }
  function netById(g, id) {
    for (var i = 0; i < g.nets.length; i++) if (g.nets[i].id === id) return g.nets[i];
    return null;
  }
  function netsOfColor(g, color) {
    return g.nets.filter(function (n) { return n.color === color; });
  }

  // 可達 = 顯示倒數 >= 該色任一張網的當前數字或下一個數字(規格「校正推算用」定義, 逐步/逐局共用)
  function isReachable(g, b) {
    var disp = displayOf(b.timer);
    var nets = netsOfColor(g, b.color);
    for (var i = 0; i < nets.length; i++) if (disp >= nets[i].target || disp >= nets[i].next) return true;
    return false;
  }

  // ==================================================================
  // 建立新局
  // ==================================================================
  function createGame(idx) {
    var gapFromPrev = lastGameEndWall == null ? null : (Date.now() - lastGameEndWall);
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
      hpGainFx: 0,
      bubbles: [],
      nextBubbleId: 1,
      nets: [],
      spawnTimer: PARAMS.firstSpawnDelay,
      lastSpawnColors: [],
      pendingClick: null,      // {bubble, downPos, downTime}
      sampleAcc: 0,
      events: [],
      paused: false,
      openPauseRecord: null,
      pauseCount: 0,
      totals: {
        spawned: 0, captured: 0, expired: 0, wrongColor: 0, numberBounce: 0, outerBounce: 0, stayInner: 0,
        renew: 0, windowOpen: 0, forcedPlacement: 0, fullHpCapture: 0, totalHpGained: 0
      },
      maxConcurrent: 0,
      maxOverlapPairs: 0,
      firstHitElapsedMs: null,
      firstExpireElapsedMs: null,
      firstExpireRate: null,
      wrongBeforeFirstHpLE2: 0,
      firstHpLE2ElapsedMs: null,
      hpLE2Entries: [],           // {enterElapsed, durationSec, rateAtEnter}
      hpLE2OpenSince: null,
      hpLE2SecTotal: 0,
      lastFullHpElapsedMs: 0,
      deathReasons: [],
      busySecTotal: 0,
      openWindowCount: 0,
      lastDropElapsed: null,
      lastDropOtherWindowOpen: null,
      pendingNumberBounceBackfills: [],
      dragTotalMs: 0,
      rounds: [],           // 每顆氣泡每一輪的結算紀錄
      spawnOutcome: {},     // bubbleId -> 'captured'/'expired'/'wrongColor'/'fieldEnd'
      spawnSegOf: {},       // bubbleId -> 30秒段序(依生成時間)
      firstWindowOpenElapsed: null,
      captureTimestamps: [],
      hpCurve: [],
      maxRenewBubble: { id: null, count: 0 },
      done: false
    };
    g.nets = buildInitialNets(g);
    // 開局抽數字: 每張網各記一筆輪替事件, 原因=開局, 舊當前留空
    for (var ni = 0; ni < g.nets.length; ni++) {
      var n0 = g.nets[ni];
      emit(g, 'retarget', {
        netId: n0.id, oldTarget: null, newTarget: n0.target, newNext: n0.next, reason: 'start',
        perColorSnapshot: [], becameUnreachableCount: null
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

  // 生成找位需要避開的氣泡: 場上所有氣泡(不分模式), 只要當下位置落在內圈內就要避開
  // (含拖曳中若剛好還在內圈內的情況)
  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) { return dist(b.x, b.y, INNER.x, INNER.y) <= INNER.r; });
  }

  function randomPointInInner() {
    var ang = Math.random() * Math.PI * 2;
    var r = Math.sqrt(Math.random()) * MOVE_R;
    return { x: INNER.x + Math.cos(ang) * r, y: INNER.y + Math.sin(ang) * r };
  }

  // 找位: 10 次都失敗時強制放在「最空位置」(這 10 個試過的位置裡, 離最近現有氣泡中心距最大的那個),
  // 不因內圈容量擋住生成, 也不重試排程(下一次照常排定)
  function findSpawnPosition(g) {
    var avoid = bubblesToAvoidForSpawn(g);
    var minGap = 2 * BUBBLE_R + PARAMS.spawnGap;
    var tries = [];
    for (var t = 0; t < PARAMS.spawnTries; t++) {
      var pos = randomPointInInner();
      var nearest = Infinity;
      for (var i = 0; i < avoid.length; i++) {
        var d = dist(pos.x, pos.y, avoid[i].x, avoid[i].y);
        if (d < nearest) nearest = d;
      }
      tries.push({ pos: pos, nearest: nearest });
      if (avoid.length === 0 || nearest >= minGap) return { pos: pos, forced: false, overlapCount: 0 };
    }
    // 全失敗: 挑最空位置強制放置
    var best = tries[0];
    for (var j = 1; j < tries.length; j++) if (tries[j].nearest > best.nearest) best = tries[j];
    var overlapCount = 0;
    for (var k = 0; k < avoid.length; k++) if (dist(best.pos.x, best.pos.y, avoid[k].x, avoid[k].y) < minGap) overlapCount++;
    return { pos: best.pos, forced: true, overlapCount: overlapCount };
  }

  function scheduleNextSpawnInterval(g) {
    var sec = g.elapsed / 1000;
    var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * sec;
    var jitter = rand(-PARAMS.spawnJitter, PARAMS.spawnJitter);
    var interval = Math.min(PARAMS.maxSpawnInterval, Math.max(PARAMS.minSpawnInterval, (1 / rate) * (1 + jitter)));
    g.spawnTimer = interval;
  }

  function makeBubble(id, color, x, y) {
    return {
      id: id, color: color, x: x, y: y,
      timer: PARAMS.initialTimer,
      renewCount: 0,
      mode: 'idle',
      spawnElapsed: nowElapsed(game),
      totalFreezeMs: 0,
      everGrabbed: false,
      dead: false,
      dragStartElapsed: null,
      dragDistance: 0,
      renewFx: 0,
      returnFrom: null, returnTo: null, returnElapsed: 0,
      windowOpen: false,
      windowNetId: null,
      windowMeta: null,
      windowOpenCount: 0,
      firstWindowOpenElapsed: null,
      roundStartElapsed: nowElapsed(game),
      roundWindowOpened: false,
      roundLastWindowCloseReason: null
    };
  }

  function attemptSpawn(g) {
    var color = pickColor(g);
    var found = findSpawnPosition(g);
    var id = g.nextBubbleId++;
    var b = makeBubble(id, color, found.pos.x, found.pos.y);
    g.bubbles.push(b);
    g.lastSpawnColors.push(color);
    if (g.lastSpawnColors.length > PARAMS.sameColorStreakCap) g.lastSpawnColors.shift();
    g.totals.spawned++;
    if (found.forced) g.totals.forcedPlacement++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    g.spawnSegOf[id] = Math.floor(nowElapsed(g) / PARAMS.segmentMs);
    emit(g, 'spawn', {
      bubbleId: id, color: color, initialTimer: PARAMS.initialTimer, x: found.pos.x, y: found.pos.y,
      countOnField: fieldCount(g), forcedPlacement: found.forced, overlapCountAtPlacement: found.overlapCount
    });
    scheduleNextSpawnInterval(g);
  }

  // ==================================================================
  // 窗口(視窗)追蹤: 顯示倒數等於該色某張網的當前數字時開窗, 記對上的是哪張網
  // ==================================================================
  function matchedNetForBubble(g, b) {
    var disp = displayOf(b.timer);
    var nets = netsOfColor(g, b.color);
    for (var i = 0; i < nets.length; i++) if (nets[i].target === disp) return nets[i];
    return null;
  }

  function currentOpenWindowCount(g, excludeId) {
    var n = 0;
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.windowOpen && b.id !== excludeId) n++;
    }
    return n;
  }

  function isAnyHoldingOrDragging() { return !!mouse.press; }

  function otherReachableWithLowerDisplay(g, b) {
    var disp = displayOf(b.timer);
    for (var i = 0; i < g.bubbles.length; i++) {
      var o = g.bubbles[i];
      if (o.id === b.id || o.color !== b.color || o.dead) continue;
      if (isReachable(g, o) && displayOf(o.timer) < disp) return true;
    }
    return false;
  }

  function openWindow(g, b, netId, isReopen) {
    if (b.windowOpen) return;
    b.windowOpen = true;
    b.windowNetId = netId;
    b.roundWindowOpened = true;
    b.windowOpenCount++;
    var other = currentOpenWindowCount(g, b.id);
    var draggingAny = isAnyHoldingOrDragging();
    b.windowMeta = {
      openT: nowElapsed(g),
      isReopen: !!isReopen,
      wasHandFreeAtOpen: !draggingAny && other === 0,
      dragMsDuring: 0,
      grabElapsedDuring: null
    };
    if (b.firstWindowOpenElapsed == null) b.firstWindowOpenElapsed = nowElapsed(g);
    if (g.firstWindowOpenElapsed == null) g.firstWindowOpenElapsed = nowElapsed(g);
    g.totals.windowOpen++;
    g.openWindowCount = currentOpenWindowCount(g, null);
    emit(g, 'windowOpen', {
      bubbleId: b.id, netId: netId, round: b.renewCount + 1, isReopen: !!isReopen,
      otherOpenWindowCount: other, playerDraggingNow: draggingAny, thisBubbleReturning: b.mode === 'return'
    });
  }

  function closeWindow(g, b, reason) {
    if (!b.windowOpen) return;
    var meta = b.windowMeta;
    var netId = b.windowNetId;
    var durationMs = nowElapsed(g) - meta.openT;
    var delayToGrabMs = meta.grabElapsedDuring != null ? (meta.grabElapsedDuring - meta.openT) : null;
    var otherReachableLower = otherReachableWithLowerDisplay(g, b);
    b.windowOpen = false;
    b.windowNetId = null;
    b.roundLastWindowCloseReason = reason;
    b.windowMeta = null;
    g.openWindowCount = currentOpenWindowCount(g, null);
    emit(g, 'windowClose', {
      bubbleId: b.id, netId: netId, reason: reason, durationMs: durationMs, delayToGrabMs: delayToGrabMs,
      wasHandFreeAtOpen: meta.wasHandFreeAtOpen, dragMsDuringWindow: Math.round(meta.dragMsDuring),
      otherReachableWithLowerDisplayAtClose: otherReachableLower
    });
    return { durationMs: durationMs, reason: reason };
  }

  // 自然狀態同步(每 tick 非凍結的氣泡倒數遞減後呼叫)
  function syncWindowNatural(g, b) {
    if (b.dead) return;
    var matched = matchedNetForBubble(g, b);
    if (b.windowOpen && (!matched || matched.id !== b.windowNetId)) closeWindow(g, b, 'timerPassed');
    else if (!b.windowOpen && matched) openWindow(g, b, matched.id, false);
  }

  // 某網輪替後, 對該色所有氣泡重新核對窗口狀態(舊窗口若掛在剛換掉的網上要關閉, 記「網換數字」)
  function syncWindowsForColor(g, color) {
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.color !== color || b.dead) continue;
      var matched = matchedNetForBubble(g, b);
      if (b.windowOpen && (!matched || matched.id !== b.windowNetId)) closeWindow(g, b, 'redrawn');
      else if (!b.windowOpen && matched) openWindow(g, b, matched.id, false);
    }
  }

  function finalizeRound(g, b, endReason, wasWasteful) {
    g.rounds.push({
      bubbleId: b.id, color: b.color, round: b.renewCount + 1,
      hadWindowOpened: b.roundWindowOpened, lastWindowCloseReason: b.roundLastWindowCloseReason,
      endReason: endReason, wasWastefulRenew: !!wasWasteful,
      endElapsed: nowElapsed(g)
    });
  }

  function newRoundState(b) {
    b.roundWindowOpened = false;
    b.roundLastWindowCloseReason = null;
    b.roundStartElapsed = nowElapsed(game);
  }

  // ==================================================================
  // 物理: 碰撞與夾限(idle 與 hold 互相碰撞; return 只當障礙物; drag 完全不參與)
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
    var idle = g.bubbles.filter(function (b) { return b.mode === 'idle' || b.mode === 'hold'; });
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
  var pendingDeathReasons = [];

  function loseHp(g, reason) {
    g.hp = Math.max(0, g.hp - 1);
    g.combo = 0;
    g.hpFlash = 1;
    if (g.firstHitElapsedMs == null) g.firstHitElapsedMs = nowElapsed(g);
    if (g.hp <= 2 && g.hpLE2OpenSince == null) {
      g.hpLE2OpenSince = nowElapsed(g);
      if (g.firstHpLE2ElapsedMs == null) {
        g.firstHpLE2ElapsedMs = nowElapsed(g);
        g.wrongBeforeFirstHpLE2 = g.totals.wrongColor;
      }
      var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * (nowElapsed(g) / 1000);
      g.hpLE2Entries.push({ enterElapsedMs: nowElapsed(g), durationSec: null, rateAtEnter: rate });
    }
    emit(g, 'hpChange', { reason: reason, countOnField: fieldCount(g), hp: g.hp });
    if (g.hp === 0) pendingDeathReasons.push(reason);
  }

  function gainHp(g) {
    if (g.hp >= PARAMS.hpMax) { g.totals.fullHpCapture++; return; }
    g.hp = Math.min(PARAMS.hpMax, g.hp + 1);
    g.hpGainFx = 1;
    g.totals.totalHpGained++;
    if (g.hp >= PARAMS.hpMax) {
      if (g.hpLE2OpenSince != null) {
        var entry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
        entry.durationSec = (nowElapsed(g) - g.hpLE2OpenSince) / 1000;
        g.hpLE2SecTotal += entry.durationSec;
        g.hpLE2OpenSince = null;
      }
      g.lastFullHpElapsedMs = nowElapsed(g);
    } else if (g.hp <= 2 && g.hpLE2OpenSince != null) {
      // 還在 <=2 區間, 不結束
    } else if (g.hp > 2 && g.hpLE2OpenSince != null) {
      var e2 = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      e2.durationSec = (nowElapsed(g) - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += e2.durationSec;
      g.hpLE2OpenSince = null;
    }
    emit(g, 'hpChange', { reason: 'captureGain', countOnField: fieldCount(g), hp: g.hp });
  }

  // 死亡判定收在批次結尾呼叫(tick 一次可能有多顆過期), 讓同批次的其餘事件先 emit 完
  function checkDeath(g) {
    if (!g.done && g.hp <= 0 && pendingDeathReasons.length > 0) {
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

  function finalizeNumberBounceBackfill(g, bubbleId, caught, captureElapsed) {
    for (var i = g.pendingNumberBounceBackfills.length - 1; i >= 0; i--) {
      var it = g.pendingNumberBounceBackfills[i];
      if (it.bubbleId === bubbleId) {
        it.record.laterCaught = caught;
        it.record.timeToCaptureMs = caught ? (captureElapsed - it.startElapsed) : null;
        g.pendingNumberBounceBackfills.splice(i, 1);
      }
    }
  }

  function lastWindowMissReason(b) {
    if (!b.roundWindowOpened) return 'neverOpened';
    if (b.roundLastWindowCloseReason === 'redrawn') return 'redrawn';
    return 'timerPassed';
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    if (b.windowOpen) closeWindow(g, b, 'timerPassed');
    var missReason = lastWindowMissReason(b);
    finalizeRound(g, b, 'expired', false);
    var wasDragging = (b.mode === 'drag');
    var netsSnap = netsOfColor(g, b.color).map(function (n) { return { netId: n.id, target: n.target }; });
    removeBubble(g, b);
    g.spawnOutcome[b.id] = 'expired';
    var cnt = fieldCount(g);
    emit(g, 'expire', {
      bubbleId: b.id, color: b.color, everGrabbed: b.everGrabbed, renewCount: b.renewCount,
      countOnField: cnt, sameColorNets: netsSnap, lastWindowCloseReason: missReason, draggingAtExpiry: wasDragging
    });
    g.totals.expired++;
    if (g.firstExpireElapsedMs == null) {
      g.firstExpireElapsedMs = nowElapsed(g);
      g.firstExpireRate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * (nowElapsed(g) / 1000);
    }
    finalizeNumberBounceBackfill(g, b.id, false, null);
    loseHp(g, 'expire');
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

  // 彈回落點: 內圈邊上離放開點最近的位置, 往圓心退一個氣泡半徑(RD 決定: 不特別避讓其他氣泡,
  // 落點若剛好被佔, 交給碰撞系統推開, 允許暫時重疊)
  function startReturn(b, fromX, fromY) {
    var ang = Math.atan2(fromY - INNER.y, fromX - INNER.x);
    if (fromX === INNER.x && fromY === INNER.y) ang = Math.random() * Math.PI * 2;
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = { x: INNER.x + Math.cos(ang) * MOVE_R, y: INNER.y + Math.sin(ang) * MOVE_R };
    b.returnElapsed = 0;
  }

  // 輪替: 只改被捕捉的那張網; 當前 = 舊下一個, 下一個依候選規則(排除本網新當前/同色另一網當前/同色另一網下一個)重抽
  function retargetNet(g, net) {
    var sibling = siblingNet(g, net);
    var oldTarget = net.target;
    var oldNext = net.next;
    // 輪替前: 對同色所有氣泡算一次可達狀態(供 becameUnreachableCount)
    var sameColor = g.bubbles.filter(function (b) { return b.color === net.color && !b.dead; });
    var beforeReach = {};
    sameColor.forEach(function (b) { beforeReach[b.id] = isReachable(g, b); });

    var newTarget = oldNext;
    var newNext = pickFrom(nextCandidates(newTarget, sibling.target, sibling.next));
    net.target = newTarget;
    net.next = newNext;
    net.targetFx = 1;

    var becameUnreachable = 0;
    sameColor.forEach(function (b) {
      if (beforeReach[b.id] && !isReachable(g, b)) becameUnreachable++;
    });

    var snapshot = sameColor.map(function (b) { return { bubbleId: b.id, display: displayOf(b.timer), renewCount: b.renewCount }; });
    emit(g, 'retarget', {
      netId: net.id, oldTarget: oldTarget, newTarget: newTarget, newNext: newNext, reason: 'capture',
      perColorSnapshot: snapshot, becameUnreachableCount: becameUnreachable
    });
    syncWindowsForColor(g, net.color);
    return becameUnreachable;
  }

  function doCapture(g, b, net) {
    closeWindow(g, b, 'capture');
    finalizeRound(g, b, 'captured', false);
    var newCombo = g.combo + 1;
    var pts = scoreForCombo(newCombo);
    g.score += pts;
    g.combo = newCombo;
    net.flash = 'catch'; net.flashT = 0;
    g.totals.captured++;
    var hpBefore = g.hp;
    var capElapsed = nowElapsed(g);
    var secToCapture = (capElapsed - b.spawnElapsed - b.totalFreezeMs) / 1000;
    var windowOrdinal = b.windowOpenCount;
    finalizeNumberBounceBackfill(g, b.id, true, capElapsed);
    removeBubble(g, b);
    g.spawnOutcome[b.id] = 'captured';
    g.captureTimestamps.push(capElapsed);
    gainHp(g);
    var becameUnreachable = retargetNet(g, net);
    return {
      points: pts, netId: net.id, hpBefore: hpBefore, secToCapture: secToCapture,
      windowOrdinal: windowOrdinal, becameUnreachable: becameUnreachable
    };
  }

  // ==================================================================
  // 放開判定
  // ==================================================================
  function resolveRelease(g, b, px, py) {
    var net = findNetAt(g, px, py);
    var outcome, targetNetId = null, colorCorrect = null, netTarget = null, numberMatches = null;
    var disp = displayOf(b.timer);
    var distToNet = nearestNetDistance(g, px, py);
    var wasWindowOpen = b.windowOpen;
    var captureInfo = null;

    if (net) {
      targetNetId = net.id;
      colorCorrect = (b.color === net.color);
      netTarget = net.target;
      if (!colorCorrect) {
        outcome = 'wrong';
        net.flash = 'wrong'; net.flashT = 0;
        g.totals.wrongColor++;
        if (wasWindowOpen) closeWindow(g, b, 'wrongColorGone');
        finalizeRound(g, b, 'wrongColorRemoved', false);
        removeBubble(g, b);
        g.spawnOutcome[b.id] = 'wrongColor';
        finalizeNumberBounceBackfill(g, b.id, false, null);
        loseHp(g, 'wrong');
      } else {
        numberMatches = (disp === net.target);
        if (numberMatches) {
          outcome = 'capture';
          captureInfo = doCapture(g, b, net);
        } else {
          outcome = 'numberBounce';
          g.totals.numberBounce++;
          net.flash = 'bounce'; net.flashT = 0;
          var rec = emit(g, 'numberBounce', { bubbleId: b.id, netId: net.id, display: disp, target: net.target, laterCaught: null, timeToCaptureMs: null });
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

    // 被抓取未捕捉: 窗口原本開著、結果不是捕捉也不是錯色(錯色已在上面單獨結算並關窗)
    var reopened = false;
    if (outcome !== 'capture' && outcome !== 'wrong' && wasWindowOpen) {
      closeWindow(g, b, 'grabbedNotCaptured');
      var matched = matchedNetForBubble(g, b);
      if (matched) { openWindow(g, b, matched.id, true); reopened = true; }
    }

    var afterCount = fieldCount(g);
    var otherOpenAtDrop = currentOpenWindowCount(g, b.id) > 0;
    var dragMs = nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed);
    var evt = {
      bubbleId: b.id, targetNetId: targetNetId, colorCorrect: colorCorrect,
      display: disp, netTarget: netTarget, numberMatches: numberMatches, outcome: outcome,
      x: px, y: py, dragDurationMs: dragMs, dragDistance: b.dragDistance, countOnField: afterCount,
      distanceToNearestNetCenter: distToNet, reopenedAsNewWindow: reopened
    };
    if (outcome === 'capture') {
      evt.netId = captureInfo.netId;
      evt.hpBefore = captureInfo.hpBefore;
      evt.secFromSpawnToCaptureExcludingFreeze = captureInfo.secToCapture;
      evt.windowOrdinal = captureInfo.windowOrdinal;
      evt.becameUnreachableCount = captureInfo.becameUnreachable;
    }
    emit(g, 'drop', evt);
    g.lastDropElapsed = nowElapsed(g);
    g.lastDropOtherWindowOpen = otherOpenAtDrop;

    checkDeath(g);
  }

  // 拖曳中視窗失去焦點: 規格要求「當下立刻視為在其他位置放開, 彈回內圈」, 不看指標當下座標是否
  // 剛好停在網上 —— 走獨立路徑, 不借用一般的 resolveRelease(那樣萬一指標正好停在網上,
  // 會被重新判成捕捉/錯色, 與規格「一律強制彈回」矛盾)
  function forceBounceCurrentDrag(g) {
    if (!(mouse.press && mouse.press.dragging)) return;
    var b = mouse.press.bubble;
    if (b && !b.dead) {
      var px = mouse.x, py = mouse.y;
      var distToNet = nearestNetDistance(g, px, py);
      var wasWindowOpen = b.windowOpen;
      startReturn(b, px, py);
      g.totals.outerBounce++;
      var reopened = false;
      if (wasWindowOpen) {
        closeWindow(g, b, 'grabbedNotCaptured');
        var matched = matchedNetForBubble(g, b);
        if (matched) { openWindow(g, b, matched.id, true); reopened = true; }
      }
      emit(g, 'drop', {
        bubbleId: b.id, targetNetId: null, colorCorrect: null, display: displayOf(b.timer), netTarget: null,
        numberMatches: null, outcome: 'outerBounce', x: px, y: py,
        dragDurationMs: nowElapsed(g) - (b.dragStartElapsed == null ? nowElapsed(g) : b.dragStartElapsed),
        dragDistance: b.dragDistance, countOnField: fieldCount(g), distanceToNearestNetCenter: distToNet,
        reopenedAsNewWindow: reopened
      });
      g.lastDropElapsed = nowElapsed(g);
      g.lastDropOtherWindowOpen = currentOpenWindowCount(g, null) > 0;
    }
    mouse.press = null;
  }

  // ==================================================================
  // 雙擊續命(不限次數、無門檻; 放開時生效; 成立後點擊計數歸零 —— 皆為 RD 決定, 見規格「待定」)
  // ==================================================================
  function resolveDoubleClick(g, b, secondHitByTolerance, intervalMs, displacement) {
    var round = b.renewCount + 1;
    var remainingBefore = displayOf(b.timer);
    var nets = netsOfColor(g, b.color).map(function (n) { return { netId: n.id, target: n.target }; });
    var wasteful = nets.some(function (n) { return remainingBefore >= n.target; });
    var windowMidRenew = nets.some(function (n) { return remainingBefore === n.target; });
    var roundState = b.windowOpen ? 'open' : (b.roundWindowOpened ? ('closed:' + b.roundLastWindowCloseReason) : 'neverOpened');
    var hadOpenWindowAtLastAction = g.lastDropOtherWindowOpen;
    var intervalSinceLastAction = g.lastDropElapsed == null ? null : (nowElapsed(g) - g.lastDropElapsed);
    var openWindowsNow = currentOpenWindowCount(g, null);

    if (b.windowOpen) closeWindow(g, b, 'renewed');
    finalizeRound(g, b, 'renewed', wasteful);
    b.timer = PARAMS.renewResetValue;
    b.renewCount++;
    b.renewFx = 1;
    newRoundState(b);
    g.totals.renew++;
    if (b.renewCount > g.maxRenewBubble.count) g.maxRenewBubble = { id: b.id, count: b.renewCount };

    emit(g, 'doubleClick', {
      bubbleId: b.id, remainingBefore: remainingBefore, round: round,
      intervalMs: intervalMs, secondHitByTolerance: !!secondHitByTolerance, displacementBetweenClicks: displacement,
      sameColorNets: nets, intervalSinceLastActionMs: intervalSinceLastAction,
      hadOpenWindowAtLastAction: hadOpenWindowAtLastAction, currentOpenWindowCount: openWindowsNow,
      wasteful: wasteful, windowMidRenew: windowMidRenew, roundStateAtRenew: roundState
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

  // ==================================================================
  // 主更新
  // ==================================================================
  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }

  function overlapPairCount(g) {
    var n = 0, list = g.bubbles;
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (dist(list[i].x, list[i].y, list[j].x, list[j].y) < 2 * BUBBLE_R) n++;
    }
    return n;
  }

  function emitSample(g) {
    var sec = g.elapsed / 1000;
    var rate = PARAMS.spawnRateBase + PARAMS.spawnRateSlope * sec;
    var openCnt = currentOpenWindowCount(g, null);
    var overlaps = overlapPairCount(g);
    g.maxOverlapPairs = Math.max(g.maxOverlapPairs, overlaps);
    g.hpCurve.push({ t: nowElapsed(g), hp: g.hp });
    emit(g, 'sample', {
      countOnField: fieldCount(g), spawnRate: rate, anyHoldOrDrag: isAnyHoldingOrDragging(),
      openWindowCount: openCnt, overlapPairCount: overlaps, hp: g.hp
    });
  }

  function tick(dt) {
    var g = game;
    g.elapsed += dt * 1000;
    pendingDeathReasons = [];

    g.spawnTimer -= dt;
    var guardSpawn = 0;
    while (g.spawnTimer <= 0 && guardSpawn < 20) { attemptSpawn(g); guardSpawn++; }

    updatePhysics(g, dt);

    // 凍結時長累計(供「生成到捕捉的秒數(扣除凍結時長)」用), 與窗口內拖曳時長累計
    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb = g.bubbles[fi];
      if (fb.mode === 'hold' || fb.mode === 'drag') fb.totalFreezeMs += dt * 1000;
    }
    if (mouse.press && mouse.press.dragging) {
      g.dragTotalMs += dt * 1000;
      var db = findBubbleById(g, mouse.press.bubbleId);
      if (db && db.windowOpen) db.windowMeta.dragMsDuring += dt * 1000;
    }

    // 倒數與消失(對複本迭代, 避免邊迭代邊刪); 只有非凍結(idle/return)氣泡才走自然倒數與窗口同步
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'hold' || b.mode === 'drag') continue; // 倒數凍結
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
    }
    if (g.hpFlash > 0) g.hpFlash = Math.max(0, g.hpFlash - dt / 0.6);
    if (g.hpGainFx > 0) g.hpGainFx = Math.max(0, g.hpGainFx - dt / 0.6);

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
  function avgOf(arr) { return arr.length ? arr.reduce(function (a, b2) { return a + b2; }, 0) / arr.length : null; }
  function ratio(num, den) { return den > 0 ? num / den : null; }
  function stats(arr) {
    if (!arr.length) return { avg: null, p90: null, n: 0 };
    var sorted = arr.slice().sort(function (a, b2) { return a - b2; });
    return { avg: avgOf(arr), p90: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))], n: arr.length };
  }

  function computeSummary(g) {
    var events = g.events;
    function byType(t) { return events.filter(function (e) { return e.type === t; }); }
    var drops = byType('drop');
    var grabs = byType('grab');
    var doubleClicks = byType('doubleClick');
    var expires = byType('expire');
    var windowCloses = byType('windowClose');
    var windowOpens = byType('windowOpen');
    var retargets = byType('retarget');
    var spawns = byType('spawn');
    var samples = byType('sample');

    var captureDrops = drops.filter(function (d) { return d.outcome === 'capture'; });
    var wrongDrops = drops.filter(function (d) { return d.outcome === 'wrong'; });

    // ---- 手速 ----
    var grabDelays = windowCloses.filter(function (w) { return w.wasHandFreeAtOpen && w.delayToGrabMs != null && w.reason !== 'timerPassed'; }).map(function (w) { return w.delayToGrabMs; });
    // 只取放下時「下一顆已開窗」的循環(nextOpenAtLastDrop 記在下一次 grab 事件上, 讀該欄位判斷)
    var cycles = [];
    for (var d = 0; d < drops.length; d++) {
      var cur = drops[d];
      var nextGrab = null;
      for (var gi = 0; gi < grabs.length; gi++) { if (grabs[gi].t >= cur.t) { nextGrab = grabs[gi]; break; } }
      if (!nextGrab || !nextGrab.nextOpenAtLastDrop) continue;
      cycles.push({ t: cur.t, ms: cur.dragDurationMs + (nextGrab.t - cur.t) });
    }
    var cycleMsList = cycles.map(function (c) { return c.ms; });

    // ---- 續命用法 ----
    var renewDiffs = doubleClicks.map(function (r) {
      var nearest = r.sameColorNets.reduce(function (a, n) { return Math.abs(r.remainingBefore - n.target) < Math.abs(r.remainingBefore - a.target) ? n : a; }, r.sameColorNets[0]);
      return nearest ? (r.remainingBefore - nearest.target) : null;
    }).filter(function (v) { return v != null; });
    var wastefulRatio = ratio(doubleClicks.filter(function (r) { return r.wasteful; }).length, doubleClicks.length);
    var windowMidRenewRatio = ratio(doubleClicks.filter(function (r) { return r.windowMidRenew; }).length, doubleClicks.length);

    // ---- 輪的分母(撞窗損失 / 重抽錯失共用) ----
    var denomRounds = g.rounds.filter(function (r) {
      return r.endReason !== 'wrongColorRemoved' && r.endReason !== 'gameEnd' && !(r.endReason === 'renewed' && r.wasWastefulRenew);
    });
    var timerPassedRounds = denomRounds.filter(function (r) { return r.lastWindowCloseReason === 'timerPassed'; });
    var intentionalLetCount = 0;
    timerPassedRounds.forEach(function (r) {
      var wc = windowCloses.filter(function (w) { return w.bubbleId === r.bubbleId && w.reason === 'timerPassed'; }).pop();
      if (wc && wc.wasHandFreeAtOpen && wc.otherReachableWithLowerDisplayAtClose) intentionalLetCount++;
    });
    var busyLossRatio = ratio(timerPassedRounds.length - intentionalLetCount, denomRounds.length);
    var redrawnOrNeverRounds = denomRounds.filter(function (r) { return r.lastWindowCloseReason === 'redrawn' || !r.hadWindowOpened; });
    var redrawLossRatio = ratio(redrawnOrNeverRounds.length, denomRounds.length);

    // ---- 生成到第一次開窗 / 每顆平均壽命 / 拖曳占比 ----
    var firstWindowDelays = [];
    var lifespans = [];
    var spawnMap = {};
    spawns.forEach(function (e) { spawnMap[e.bubbleId] = e.t; });
    var seenFirstWindow = {};
    windowOpens.forEach(function (e) {
      if (seenFirstWindow[e.bubbleId]) return;
      seenFirstWindow[e.bubbleId] = true;
      if (spawnMap[e.bubbleId] != null) firstWindowDelays.push(e.t - spawnMap[e.bubbleId]);
    });
    events.filter(function (e) { return e.type === 'expire' || (e.type === 'drop' && (e.outcome === 'capture' || e.outcome === 'wrong')); }).forEach(function (e) {
      var sT = spawnMap[e.bubbleId];
      if (sT != null) lifespans.push(e.t - sT);
    });
    var dragRatio = g.elapsed > 0 ? g.dragTotalMs / g.elapsed : null;

    // ---- 「等不到」死局分類 ----
    var lastExpireRound = null;
    for (var li = g.rounds.length - 1; li >= 0; li--) { if (g.rounds[li].endReason === 'expired') { lastExpireRound = g.rounds[li]; break; } }
    var deathTimeoutClass = null;
    if (g.deathReasons.indexOf('expire') !== -1 && lastExpireRound) {
      deathTimeoutClass = lastExpireRound.lastWindowCloseReason === 'redrawn' ? 'redrawCaused' : 'playerMissed';
    }

    // ---- 每 30 秒生成批次去向(指標 1 用) ----
    var segCount = Math.max(1, segmentIndex(g.elapsed) + 1);
    var spawnBatches = [];
    for (var sIdx = 0; sIdx < segCount; sIdx++) {
      var idsInSeg = Object.keys(g.spawnSegOf).filter(function (id) { return g.spawnSegOf[id] === sIdx; });
      var captured = 0, expiredC = 0, wrongC = 0, residual = 0;
      idsInSeg.forEach(function (idStr) {
        var id = Number(idStr);
        var out = g.spawnOutcome[id] || 'fieldEnd';
        if (out === 'captured') captured++;
        else if (out === 'expired') expiredC++;
        else if (out === 'wrongColor') wrongC++;
        else residual++;
      });
      spawnBatches.push({ segment: sIdx, spawnCount: idsInSeg.length, captured: captured, expired: expiredC, wrongColor: wrongC, residual: residual, captureRate: ratio(captured, idsInSeg.length) });
    }
    var indicator1_0to60 = (function () {
      var seg0 = spawnBatches[0] || { captured: 0, spawnCount: 0 };
      var seg1 = spawnBatches[1] || { captured: 0, spawnCount: 0 };
      return ratio(seg0.captured + seg1.captured, seg0.spawnCount + seg1.spawnCount);
    })();

    // ---- 每 30 秒分段(通用: 生成/捕捉/錯色/過期/續命/滿命捕捉/錯過率) ----
    var segments = [];
    for (var s = 0; s < segCount; s++) {
      var segStart = s * PARAMS.segmentMs, segEnd = segStart + PARAMS.segmentMs;
      var inSeg = (function (a, b2) { return function (t) { return t >= a && t < b2; }; })(segStart, segEnd);
      var segSpawn = spawns.filter(function (e) { return inSeg(e.t); }).length;
      var segCatch = captureDrops.filter(function (e) { return inSeg(e.t); }).length;
      var segWrong = wrongDrops.filter(function (e) { return inSeg(e.t); }).length;
      var segExpire = expires.filter(function (e) { return inSeg(e.t); }).length;
      var segRenew = doubleClicks.filter(function (e) { return inSeg(e.t); }).length;
      // 滿命捕捉(回命被上限吃掉的次數): 沒有 hpChange 事件可查(規格定案不記), 改由捕捉當下的 hpBefore 反推
      var segFullHpCatch = captureDrops.filter(function (e) { return inSeg(e.t) && e.hpBefore === PARAMS.hpMax; }).length;
      var segRoundsEnded = g.rounds.filter(function (r) { return inSeg(r.endElapsed); });
      var segDenom = segRoundsEnded.filter(function (r) { return r.endReason !== 'wrongColorRemoved' && r.endReason !== 'gameEnd' && !(r.endReason === 'renewed' && r.wasWastefulRenew); });
      var segTimerPassed = segDenom.filter(function (r) { return r.lastWindowCloseReason === 'timerPassed'; }).length;
      var segRedrawn = segDenom.filter(function (r) { return r.lastWindowCloseReason === 'redrawn' || !r.hadWindowOpened; }).length;
      var segIndicator4Denom = segCatch + segExpire + segWrong;
      segments.push({
        index: s, startMs: segStart, endMs: segEnd,
        spawnCount: segSpawn, captureCount: segCatch, wrongCount: segWrong, expireCount: segExpire, renewCount: segRenew,
        fullHpCaptureCount: segFullHpCatch,
        renewToCatchRatio: ratio(segRenew, segCatch),
        indicator4: ratio(segCatch, segIndicator4Denom),
        timerPassedLossRatio: ratio(segTimerPassed, segDenom.length), redrawnLossRatio: ratio(segRedrawn, segDenom.length),
        spawnBatch: spawnBatches[s] || null
      });
    }

    // ---- 飽和段處理率: 30 秒段內「開啟中窗口數 >= 1」的取樣秒數占比 >= 90% ----
    var saturatedSegments = [];
    segments.forEach(function (sg) {
      var segSamples = samples.filter(function (sm) { return sm.t >= sg.startMs && sm.t < sg.endMs; });
      if (!segSamples.length) return;
      var busyCount = segSamples.filter(function (sm) { return sm.openWindowCount >= 1; }).length;
      var occupancy = busyCount / segSamples.length;
      if (occupancy >= 0.9) {
        saturatedSegments.push({ index: sg.index, occupancy: occupancy, captureCount: sg.captureCount, rate: ratio(sg.captureCount, segSamples.length) });
      }
    });
    var saturatedProcessingRate = avgOf(saturatedSegments.map(function (s3) { return s3.rate; }).filter(function (v) { return v != null; }));

    // ---- 指標 2: 命 <= 2 占比與首次時點(已在 loseHp/gainHp 累計 g.hpLE2Entries / g.hpLE2SecTotal) ----
    if (g.hpLE2OpenSince != null) {
      var tailDur = (g.elapsed - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += tailDur;
      var lastEntry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      if (lastEntry && lastEntry.durationSec == null) lastEntry.durationSec = tailDur;
    }
    var hpLE2Ratio = g.elapsed > 0 ? g.hpLE2SecTotal / (g.elapsed / 1000) : null;

    // ---- 指標 3: 每 30 秒續命/捕捉(死前 30 秒以外) ----
    var lastSegIdx = segCount - 1;
    var indicator3Segments = segments.filter(function (sg) { return sg.index !== lastSegIdx; });
    var indicator3 = avgOf(indicator3Segments.map(function (sg) { return sg.renewToCatchRatio; }).filter(function (v) { return v != null; }));

    // ---- 指標 4(全局, 首次命<=2之前) ----
    var beforeLE2 = g.firstHpLE2ElapsedMs;
    var catchBefore = captureDrops.filter(function (e) { return beforeLE2 == null || e.t < beforeLE2; }).length;
    var expireBefore = expires.filter(function (e) { return beforeLE2 == null || e.t < beforeLE2; }).length;
    var wrongBefore = wrongDrops.filter(function (e) { return beforeLE2 == null || e.t < beforeLE2; }).length;
    var indicator4Global = ratio(catchBefore, catchBefore + expireBefore + wrongBefore);

    // ---- 指標 5: 最長無捕捉間隔(從第一次開窗起, 死前 30 秒以外) ----
    var indicator5 = null;
    if (g.firstWindowOpenElapsed != null) {
      var boundary = Math.max(g.firstWindowOpenElapsed, g.elapsed - 30000);
      var capTimes = g.captureTimestamps.filter(function (t) { return t <= boundary; }).slice().sort(function (a, b2) { return a - b2; });
      var marks = [g.firstWindowOpenElapsed].concat(capTimes, [boundary]);
      var longest = null;
      for (var mi = 0; mi < marks.length - 1; mi++) {
        var a0 = marks[mi], b0 = marks[mi + 1];
        if (b0 <= a0) continue;
        var noWindowSec = 0, maxField = 0;
        samples.forEach(function (sm) {
          if (sm.t >= a0 && sm.t < b0) {
            if (sm.openWindowCount === 0) noWindowSec++;
            maxField = Math.max(maxField, sm.countOnField);
          }
        });
        var durSec = (b0 - a0) / 1000;
        if (!longest || durSec > longest.durationSec) longest = { startMs: a0, endMs: b0, durationSec: durSec, noWindowSec: noWindowSec, maxFieldCount: maxField };
      }
      indicator5 = longest;
    }

    return {
      handSpeed: { grabDelay: stats(grabDelays), cycleS: stats(cycleMsList) },
      renewUsage: { diffDistribution: renewDiffs, wastefulRatio: wastefulRatio, windowMidRenewRatio: windowMidRenewRatio },
      busyRate: { secTotal: g.busySecTotal, rate: ratio(g.totals.captured + g.totals.wrongColor, g.busySecTotal) },
      saturatedSegments: saturatedSegments,
      saturatedProcessingRate: saturatedProcessingRate,
      maxConcurrent: g.maxConcurrent,
      maxOverlapPairs: g.maxOverlapPairs,
      forcedPlacementCount: g.totals.forcedPlacement,
      totals: g.totals,
      spawnRatioVsLambda: (function () {
        var totalActiveSec = g.elapsed / 1000;
        var lambdaIntegral = PARAMS.spawnRateBase * totalActiveSec + PARAMS.spawnRateSlope * totalActiveSec * totalActiveSec / 2;
        return lambdaIntegral > 0 ? g.totals.spawned / lambdaIntegral : null;
      })(),
      firstWindowDelayAvgMs: avgOf(firstWindowDelays),
      avgLifespanMs: avgOf(lifespans),
      dragTimeRatio: dragRatio,
      deathTimeoutClass: deathTimeoutClass,
      busyLossRatioByRound: busyLossRatio,
      redrawLossRatioByRound: redrawLossRatio,
      roundDenominator: denomRounds.length,
      pauseCount: g.pauseCount,
      segments: segments,
      spawnBatches: spawnBatches,
      hpLE2: { ratio: hpLE2Ratio, entries: g.hpLE2Entries, firstElapsedMs: g.firstHpLE2ElapsedMs },
      firstHitElapsedMs: g.firstHitElapsedMs,
      wrongBeforeFirstHpLE2: g.wrongBeforeFirstHpLE2,
      firstExpireElapsedMs: g.firstExpireElapsedMs,
      firstExpireRate: g.firstExpireRate,
      lastFullHpElapsedMs: g.lastFullHpElapsedMs,
      secFromLastFullHpToDeath: (g.elapsed - g.lastFullHpElapsedMs) / 1000,
      hpCurve: g.hpCurve,
      totalHpGained: g.totals.totalHpGained,
      maxRenewBubble: g.maxRenewBubble,
      mainIndicators: {
        indicator1_captureRate0to60: indicator1_0to60,
        indicator2_hpLE2Ratio: hpLE2Ratio,
        indicator2_firstHpLE2ElapsedMs: g.firstHpLE2ElapsedMs,
        indicator3_renewToCatch: indicator3,
        indicator4_captureRateBeforeFirstHpLE2: indicator4Global,
        indicator5_longestNoCaptureGap: indicator5
      }
    };
  }

  function finalizeAndDownload(g) {
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    // 局結束: 對所有還開著的窗口與尚未結算的輪收尾, 並記局結束殘留
    g.bubbles.slice().forEach(function (b) {
      if (b.windowOpen) closeWindow(g, b, 'gameEnd');
      finalizeRound(g, b, 'gameEnd', false);
      if (g.spawnOutcome[b.id] == null) g.spawnOutcome[b.id] = 'fieldEnd';
      emit(g, 'fieldEnd', { bubbleId: b.id, color: b.color, spawnElapsedMs: b.spawnElapsed, display: displayOf(b.timer), renewCount: b.renewCount });
    });
    g.pendingNumberBounceBackfills.forEach(function (it) { it.record.laterCaught = false; it.record.timeToCaptureMs = null; });
    g.pendingNumberBounceBackfills = [];
    var summary = computeSummary(g);
    var out = {
      playerId: PLAYER_ID,
      gameIndex: g.gameIndex,
      device: g.device,
      gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: PARAMS,
      countedForMainStats: (g.deathReasons.indexOf('quit') === -1 && g.deathReasons.indexOf('restart') === -1),
      durationSec: Math.round(g.elapsed) / 1000,
      deathReasons: g.deathReasons,
      score: g.score,
      summary: summary,
      events: g.events
    };
    return downloadJson(out);
  }

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
      pendingDeathReasons.forEach(function (r) { if (uniq.indexOf(r) === -1) uniq.push(r); });
      if (uniq.length === 0) uniq = ['expire'];
      // 同幀多種原因時以錯色為主, 兩者都記
      if (uniq.indexOf('wrong') !== -1) { uniq = ['wrong'].concat(uniq.filter(function (r) { return r !== 'wrong'; })); }
      g.deathReasons = uniq;
    } else {
      g.deathReasons = [reason]; // 'quit' | 'restart'
    }
    // 拖曳中局結束: 立刻中止拖曳, 不記「放下」事件
    mouse.press = null;
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
    if (guidePage < GUIDE_PAGES && inRect(p.x, p.y, g2.next)) return 'next';
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
    else if (key === 'next') { if (guidePage < GUIDE_PAGES) guidePage++; }
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
      var pcBubble = g.pendingClick.bubble;
      if (pcBubble && !pcBubble.dead && pcBubble.mode === 'idle' && dist(p.x, p.y, g.pendingClick.downPos.x, g.pendingClick.downPos.y) <= PARAMS.doubleClickTolerance) {
        target = pcBubble;
        isSecondHit = true;
        secondHitByTolerance = dist(p.x, p.y, pcBubble.x, pcBubble.y) > BUBBLE_R;
        pairInfo = g.pendingClick;
      }
    }
    if (!target) target = findBubbleUnderPoint(g, p.x, p.y);
    if (!target) return;
    target.mode = 'hold';
    target.everGrabbed = true;
    emit(g, 'press', { bubbleId: target.id, x: p.x, y: p.y, display: displayOf(target.timer) });
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
        if (b.windowOpen) b.windowMeta.grabElapsedDuring = nowElapsed(g);
        b._lastDragX = b.x; b._lastDragY = b.y;

        var disp = displayOf(b.timer);
        var nets = netsOfColor(g, b.color);
        var candidates = [];
        nets.forEach(function (n) {
          candidates.push({ netId: n.id, kind: 'target', value: n.target });
          candidates.push({ netId: n.id, kind: 'next', value: n.next });
        });
        var best = candidates.reduce(function (a, c) { return Math.abs(disp - c.value) < Math.abs(disp - a.value) ? c : a; }, candidates[0]);
        var openSameColor = g.bubbles.filter(function (o) { return o.color === b.color && o.windowOpen; });
        var minDisp = openSameColor.length ? Math.min.apply(null, openSameColor.map(function (o) { return displayOf(o.timer); })) : null;
        emit(g, 'grab', {
          bubbleId: b.id, display: disp,
          sameColorNets: nets.map(function (n) { return { netId: n.id, target: n.target, next: n.next }; }),
          diff: disp - best.value, diffAgainstNetId: best.netId, diffAgainstKind: best.kind,
          fieldCount: fieldCount(g), allOpenWindowCount: currentOpenWindowCount(g, null),
          sameColorOpenCount: openSameColor.length, selectedIsOneOfOpen: b.windowOpen,
          selectedIsLowestDisplayAmongOpen: b.windowOpen && minDisp != null && disp === minDisp,
          intervalSinceLastDropMs: g.lastDropElapsed == null ? null : (nowElapsed(g) - g.lastDropElapsed),
          nextOpenAtLastDrop: g.lastDropOtherWindowOpen,
          distanceAtDragStart: d, msAtDragStart: nowElapsed(g) - press.downTime
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
    b.mode = 'idle'; // 沒判成拖曳: 倒數恢復
    if (press.isSecondHit && press.pairInfo) {
      var intervalMs = press.downTime - press.pairInfo.downTime;
      var displacement = dist(press.pairInfo.downPos.x, press.pairInfo.downPos.y, p.x, p.y);
      resolveDoubleClick(g, b, press.secondHitByTolerance, intervalMs, displacement);
      g.pendingClick = null; // 雙擊成立後點擊計數歸零(RD 決定, 見規格「待定」)
    } else {
      emit(g, 'holdRelease', { bubbleId: b.id, freezeDurationMs: nowElapsed(g) - press.downTime });
      g.pendingClick = { bubble: b, downPos: { x: press.downPos.x, y: press.downPos.y }, downTime: press.downTime };
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
    return { x: b.x, y: b.y, color: b.color, timer: Math.max(0, b.timer), mode: b.mode, renewFx: b.renewFx || 0 };
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
      Art.drawNet(ctx, { x: net.x, y: net.y, color: net.color, target: net.target, next: net.next, targetFx: net.targetFx, hot: hot, flash: net.flash, flashT: net.flashT });
    }
    var others = g.bubbles.filter(function (b) { return b.mode !== 'drag'; });
    for (var j = 0; j < others.length; j++) Art.drawBubble(ctx, bubbleState(others[j]));
    if (dragBubble) Art.drawBubble(ctx, bubbleState(dragBubble));
    Art.drawHud(ctx, { hp: g.hp, hpMax: PARAMS.hpMax, time: g.elapsed / 1000, paused: (screen === SCREEN.PAUSED), score: g.score, combo: g.combo, hpFlash: g.hpFlash, hpGainFx: g.hpGainFx });
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
