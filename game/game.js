// 捕泡手 遊戲邏輯(spec v8, 管道版位)。純傳統 script,不用 ES module。繪製一律呼叫 window.Art。
// v8 核心玩法與 v6/v7 完全不同: 沒有數字、沒有窗口、沒有續命/輪替; 氣泡一律生成為透明圓,
// 靠拖曳擦過染色/賦形區沾色賦形,擦到洗除區被抹回透明; 放開時放對啟用中的網才捕捉回命。
// 「待定」交 RD 的六項決定(回報同步列出):
//   1. 強制放置後的推開: 沿用一般碰撞推擠(不彈飛、不推出內圈),推不開時允許暫時重疊
//   2. 重疊中氣泡被按下: 已由規則明定「取中心離指標最近的那顆」,本檔直接實作
//   3. 彈回落點被佔: 比照強制放置,允許暫時重疊,交碰撞系統慢慢推開
//   4. 拖曳偏移: 氣泡中心 = 指標位置(無偏移);內圈內外一律用「中心點」判定,不看整顆是否出界
//   5. 彈回中的氣泡參與碰撞: 視為靜態障礙物(擋別顆、自己不被推動、不被夾限)
//   6. 同幀多次命變化: 一次 tick 內先處理完所有捕捉(含回血)才處理過期扣血,批次尾端才判定死亡
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var GUIDE_PAGES = L.guide.pages; // 6

  var BUILD_VERSION = 'demo-v8-0.1.0';

  var INNER = L.inner;                 // {x:330,y:360,r:160}
  var BUBBLE_R = L.bubbleR;            // 20
  var NET_R = L.netR;                  // 60
  var MOVE_R = INNER.r - BUBBLE_R;     // 140, 閒置氣泡可活動半徑
  var DRAG_B = L.dragBounds;           // {x:20,y:20,w:1240,h:680}
  var NETS_DEF = L.nets;               // 4 張網 {id,x,y,color,stage}
  var ZONES_DEF = L.zones;             // 25 塊區域
  var GAPS_DEF = L.gaps;               // 12 條窄縫

  var PARAMS = {
    bubbleR: BUBBLE_R, netR: NET_R, paintR: L.paintR, shapeR: L.shapeR, washR: L.washR,
    lifeMax: 12,
    hpMax: 4,
    spawnRate0: 0.22,
    spawnRateSlope: 0.003,
    spawnJitter: 0.4,
    minSpawnInterval: 0.25,
    maxSpawnInterval: 5,
    spawnGap: 4,
    spawnTries: 10,
    dragStartDist: 6,
    returnDuration: 0.2,
    scoreBase: 10,
    comboBonusPerStreak: 0.1,
    comboStreakCap: 20,
    sampleInterval: 1.0,
    segmentMs: 30000,
    stageTimesMs: [0, 45000, 90000, 135000, 180000, 225000],
    previewMs: 2000,
    introMs: 2000,
    hpLE2Threshold: 2
  };

  var NET_SHAPE_SCHEDULE = {
    1: [{ stage: 5, shape: 'square' }, { stage: 6, shape: 'triangle' }],
    2: [{ stage: 5, shape: 'square' }, { stage: 6, shape: 'triangle' }],
    3: [{ stage: 5, shape: 'square' }],
    4: [{ stage: 5, shape: 'square' }]
  };

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  function avgOf(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
  function ratio(num, den) { return den > 0 ? num / den : null; }
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function p90(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
  }
  function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : null; }

  // ---------- 玩家 ID 與局數(沿用同一瀏覽器; v8 版面全換, 用獨立 key 不與 v6 混) ----------
  var PLAYER_ID_KEY = 'bcv8_playerId';
  var GAME_COUNT_KEY = 'bcv8_gameCount';
  var DEVICE_KEY = 'bcv8_device';
  var SEEN_GUIDE_KEY = 'bcv8_seenGuide';

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
  var deviceType = loadDevice();
  var inputSelectFrom = null;
  var guideReturnTo = null;
  var guidePage = 1;
  var pendingAutoGuideClose = false;
  if (!hasSeenGuide()) {
    guideReturnTo = 'title';
    screen = SCREEN.GUIDE;
    pendingAutoGuideClose = true;
  }
  var endInfo = null;
  var lastGameEndWall = null;

  var titleHover = null, inputHover = null, pauseBtnHover = false, pauseMenuHover = null, guideHover = null, endHover = null;

  var game = null;

  // ==================================================================
  // 階段時機: stage 1~6, 預告 2 秒, 出場提示 2 秒(暫停時 elapsed 不走, 天生凍結)
  // ==================================================================
  function stageOf(elapsed) {
    var t = PARAMS.stageTimesMs, s = 1;
    for (var i = 1; i < t.length; i++) if (elapsed >= t[i]) s = i + 1;
    return s;
  }
  // 目前是否在「某次切換」的預告期間(2 秒內), 回傳 { inPreview, previewStage, previewT }
  function previewInfo(elapsed) {
    var t = PARAMS.stageTimesMs;
    for (var i = 1; i < t.length; i++) {
      var start = t[i] - PARAMS.previewMs;
      if (elapsed >= start && elapsed < t[i]) return { inPreview: true, previewStage: i + 1, previewT: clamp01((elapsed - start) / PARAMS.previewMs) };
    }
    return { inPreview: false, previewStage: null, previewT: 0 };
  }
  // 某物件在 stage(1~6) 出場: 回傳 { exists, status:'preview'|'on', previewT, introT }
  function stageTiming(stage, elapsed) {
    var t = PARAMS.stageTimesMs;
    var effectiveStart = t[stage - 1];
    if (stage === 1) return { exists: true, status: 'on', previewT: 0, introT: null };
    var previewStart = effectiveStart - PARAMS.previewMs;
    if (elapsed < previewStart) return { exists: false };
    if (elapsed < effectiveStart) return { exists: true, status: 'preview', previewT: clamp01((elapsed - previewStart) / PARAMS.previewMs) };
    var introT = (elapsed - effectiveStart) < PARAMS.introMs ? (elapsed - effectiveStart) / PARAMS.introMs : null;
    return { exists: true, status: 'on', introT: introT };
  }
  function netShapeState(schedule, elapsed) {
    var current = null, next = null, previewT = 0, introT = null;
    for (var i = 0; i < schedule.length; i++) {
      var item = schedule[i];
      var effectiveStart = PARAMS.stageTimesMs[item.stage - 1];
      var previewStart = effectiveStart - PARAMS.previewMs;
      if (elapsed >= effectiveStart) {
        current = item.shape;
        introT = (elapsed - effectiveStart) < PARAMS.introMs ? (elapsed - effectiveStart) / PARAMS.introMs : null;
      } else if (elapsed >= previewStart && next == null) {
        next = item.shape;
        previewT = clamp01((elapsed - previewStart) / PARAMS.previewMs);
      }
    }
    return { shape: current, nextShape: (next && next !== current) ? next : null, previewT: previewT, introT: introT };
  }
  // 網在某時刻的完整條件狀態: { status:'off'|'preview'|'on', color, shape, nextShape, previewT, introT }
  function netStateAt(netDef, elapsed) {
    var ex = stageTiming(netDef.stage, elapsed);
    if (!ex.exists) return { status: 'off', color: netDef.color, shape: null, nextShape: null, previewT: 0, introT: null };
    if (ex.status === 'preview') return { status: 'preview', color: netDef.color, shape: null, nextShape: null, previewT: ex.previewT, introT: null };
    var sh = netShapeState(NET_SHAPE_SCHEDULE[netDef.id] || [], elapsed);
    var introT = ex.introT != null ? ex.introT : sh.introT;
    return { status: 'on', color: netDef.color, shape: sh.shape, nextShape: sh.nextShape, previewT: sh.previewT, introT: introT };
  }
  // 區域在某時刻的狀態: { exists, status, previewT, introT }
  function zoneStateAt(zoneDef, elapsed) { return stageTiming(zoneDef.stage, elapsed); }

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
      elapsed: 0,
      hp: PARAMS.hpMax,
      score: 0,
      combo: 0,
      hpFlash: 0,
      hpGainFx: 0,
      netFx: { 1: { flash: null, flashT: 0 }, 2: { flash: null, flashT: 0 }, 3: { flash: null, flashT: 0 }, 4: { flash: null, flashT: 0 } },
      bubbles: [],
      nextBubbleId: 1,
      spawnTimer: 0,      // 第 0 秒起算, 立刻排定下一顆(下方 attemptSpawn 兩次預放後排程)
      sampleAcc: 0,
      events: [],
      paused: false,
      pauseCount: 0,
      openPauseRecord: null,
      lastDropElapsed: null,
      lastDropProcessableCount: null,
      lastPressElapsed: null,
      maxConcurrent: 0,
      forcedPlacementCount: 0,
      totals: { spawned: 0, captured: 0, expired: 0, bounceCond: 0, bounceOuter: 0, stayInner: 0, holdNoDrag: 0, swipe: 0, erase: 0, overlayIntentional: 0, overlayMistake: 0, gapCross: 0, totalHpGained: 0, fullHpCaptureCount: 0 },
      lastFullHpElapsedMs: null,       // 開局滿命, 但要等「從滿命掉下來那一刻」才記錄; 未發生前為 null(不得記 0)
      firstHpLE2ElapsedMs: null, firstHpLE2Stage: null,
      hpLE2OpenSince: null, hpLE2SecTotal: 0, hpLE2Entries: [],
      firstExpireElapsedMs: null, firstExpireRate: null, firstExpireStage: null,
      captureTimestamps: [],
      hpCurve: [],
      stageChanges: [],
      pendingDeathReasons: [],
      bubbleRec: {},     // id -> { spawnElapsed, spawnStage, outcome, outcomeElapsed }
      spawnSegOf: {},    // id -> 30 秒段序
      done: false
    };
    // 開局第 0 秒預放 2 顆(彼此不重疊); attemptSpawn 內會排定下一顆(從第 0 秒起算)
    attemptSpawn(g);
    attemptSpawn(g);
    return g;
  }

  function fieldCount(g) { return g.bubbles.length; }
  function processableCount(g) { return g.bubbles.filter(function (b) { return b.mode === 'idle'; }).length; }
  function nowElapsed(g) { return Math.round(g.elapsed); }
  function currentSpawnRate(g) { return PARAMS.spawnRate0 + PARAMS.spawnRateSlope * (g.elapsed / 1000); }

  function emit(g, type, fields) {
    var rec = { t: nowElapsed(g), gameId: g.id, type: type, stage: stageOf(g.elapsed) };
    for (var k in fields) rec[k] = fields[k];
    g.events.push(rec);
    return rec;
  }

  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }

  // ==================================================================
  // 生成: 一律透明圓; 開局預放 2 顆(第 0 秒); 生成不被內圈容量擋住
  // ==================================================================
  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) { return dist(b.x, b.y, INNER.x, INNER.y) <= INNER.r; });
  }
  function randomPointInInner() {
    var ang = Math.random() * Math.PI * 2;
    var r = Math.sqrt(Math.random()) * MOVE_R;
    return { x: INNER.x + Math.cos(ang) * r, y: INNER.y + Math.sin(ang) * r };
  }
  function findSpawnPosition(g) {
    var avoid = bubblesToAvoidForSpawn(g);
    var minGap = 2 * BUBBLE_R + PARAMS.spawnGap;
    var tries = [];
    for (var t = 0; t < PARAMS.spawnTries; t++) {
      var pos = randomPointInInner();
      var nearest = Infinity;
      for (var i = 0; i < avoid.length; i++) { var d = dist(pos.x, pos.y, avoid[i].x, avoid[i].y); if (d < nearest) nearest = d; }
      tries.push({ pos: pos, nearest: nearest });
      if (avoid.length === 0 || nearest >= minGap) return { pos: pos, forced: false, overlapCount: 0 };
    }
    var best = tries[0];
    for (var j = 1; j < tries.length; j++) if (tries[j].nearest > best.nearest) best = tries[j];
    var overlapCount = 0;
    for (var k = 0; k < avoid.length; k++) if (dist(best.pos.x, best.pos.y, avoid[k].x, avoid[k].y) < minGap) overlapCount++;
    return { pos: best.pos, forced: true, overlapCount: overlapCount };
  }
  function scheduleNextSpawn(g) {
    var rate = currentSpawnRate(g);
    var jitter = rand(-PARAMS.spawnJitter, PARAMS.spawnJitter);
    var interval = Math.min(PARAMS.maxSpawnInterval, Math.max(PARAMS.minSpawnInterval, (1 / rate) * (1 + jitter)));
    g.spawnTimer = interval;
  }
  function makeBubble(id, x, y, spawnElapsed, spawnStage) {
    return {
      id: id, color: null, shape: 'circle', x: x, y: y,
      life: PARAMS.lifeMax, lifeMax: PARAMS.lifeMax,
      mode: 'idle', swipeFx: 0, swipeKind: null,
      spawnElapsed: spawnElapsed, spawnStage: spawnStage,
      everGrabbed: false, everDyed: false,
      grabCount: 0, dragDistanceTotal: 0, freezeMsTotal: 0,
      totalErase: 0, totalOverlayIntentional: 0, totalOverlayMistake: 0,
      dragStartElapsed: null, dragPathLen: 0,
      zoneOverlap: {}, dragMinDist: {}, lastMandatoryElapsed: null,
      dragEraseCount: 0, dragOverlayCount: 0,
      swipeRecords: [], bounceCondRecords: [], overlayPending: [],
      returnFrom: null, returnTo: null, returnElapsed: 0,
      dead: false
    };
  }
  function attemptSpawn(g) {
    var found = findSpawnPosition(g);
    var id = g.nextBubbleId++;
    var spawnElapsed = nowElapsed(g);
    var spawnStage = stageOf(g.elapsed);
    var b = makeBubble(id, found.pos.x, found.pos.y, spawnElapsed, spawnStage);
    g.bubbles.push(b);
    g.totals.spawned++;
    if (found.forced) g.forcedPlacementCount++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    g.spawnSegOf[id] = Math.floor(spawnElapsed / PARAMS.segmentMs);
    g.bubbleRec[id] = { spawnElapsed: spawnElapsed, spawnStage: spawnStage, outcome: null, outcomeElapsed: null };
    emit(g, 'spawn', {
      bubbleId: id, x: found.pos.x, y: found.pos.y, countOnField: fieldCount(g),
      forcedPlacement: found.forced, overlapCountAtPlacement: found.overlapCount
    });
    scheduleNextSpawn(g);
  }

  // ==================================================================
  // 物理: 碰撞(idle/hold 互相碰撞、被 return 當障礙物; drag 不參與); 全部限制在內圈內(除 drag)
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
  function startReturn(b, fromX, fromY) {
    var ang = Math.atan2(fromY - INNER.y, fromX - INNER.x);
    if (fromX === INNER.x && fromY === INNER.y) ang = Math.random() * Math.PI * 2;
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = { x: INNER.x + Math.cos(ang) * MOVE_R, y: INNER.y + Math.sin(ang) * MOVE_R };
    b.returnElapsed = 0;
  }

  // ==================================================================
  // 幾何: 移動圓(半徑 BUBBLE_R)掃過固定圓(半徑 z.r)的相交區間; 回傳 [t0,t1](0~1)或 null
  // ==================================================================
  function sweepCircleInterval(p0, p1, cx, cy, combinedR) {
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var fx = p0.x - cx, fy = p0.y - cy;
    var a = dx * dx + dy * dy;
    var b = 2 * (fx * dx + fy * dy);
    var c = fx * fx + fy * fy - combinedR * combinedR;
    if (a < 1e-9) { return c <= 0 ? [0, 1] : null; }
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
    if (t2 < 0 || t1 > 1) return null;
    return [Math.max(0, t1), Math.min(1, t2)];
  }
  function closestDistanceOnSegment(p0, p1, cx, cy) {
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 < 1e-9 ? 0 : clamp01(((cx - p0.x) * dx + (cy - p0.y) * dy) / len2);
    var px = p0.x + dx * t, py = p0.y + dy * t;
    return dist(px, py, cx, cy);
  }
  // 線段-線段交點(參數 t 屬 p0->p1, s 屬 c1->c2), 皆須落在 [0,1] 內, 否則回 null
  function segSegIntersect(p0, p1, c1, c2) {
    var d1x = p1.x - p0.x, d1y = p1.y - p0.y;
    var d2x = c2.x - c1.x, d2y = c2.y - c1.y;
    var denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return null;
    var dx = c1.x - p0.x, dy = c1.y - p0.y;
    var t = (dx * d2y - dy * d2x) / denom;
    var s = (dx * d1y - dy * d1x) / denom;
    if (t < 0 || t > 1 || s < 0 || s > 1) return null;
    return { t: t, s: s };
  }

  // ==================================================================
  // 區域擦過分類(染色/賦形/洗除), 套用屬性覆蓋
  // ==================================================================
  function applyZoneSwipe(b, zone) {
    var before = { color: b.color, shape: b.shape };
    var cls;
    if (zone.kind === 'paint') {
      if (b.color === zone.color) cls = '無變化';
      else cls = (b.color == null) ? '生效' : '覆蓋';
      b.color = zone.color;
      if (b.color != null) b.everDyed = true;
    } else if (zone.kind === 'shape') {
      if (b.shape === zone.shape) cls = '無變化';
      else cls = (b.shape === 'circle') ? '生效' : '覆蓋';
      b.shape = zone.shape;
    } else { // wash
      if (b.color == null && b.shape === 'circle') cls = '無效擦';
      else cls = '錯擦';
      b.color = null; b.shape = 'circle';
    }
    return { classification: cls, before: before, after: { color: b.color, shape: b.shape } };
  }

  // ==================================================================
  // 拖曳中: 本幀移動路徑的區域擦過與窄縫穿越偵測(用限制後的位置, 支援一幀跨過不漏判)
  // ==================================================================
  function activeZonesAt(elapsed) {
    var list = [];
    for (var i = 0; i < ZONES_DEF.length; i++) {
      var z = ZONES_DEF[i];
      var st = zoneStateAt(z, elapsed);
      if (st.exists && st.status === 'on') list.push(z);
    }
    return list;
  }
  function initDragTracking(b, elapsed) {
    b.zoneOverlap = {}; b.dragMinDist = {};
    var zones = activeZonesAt(elapsed);
    var already = null;
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var d = dist(b.x, b.y, z.x, z.y);
      var overlap = d <= (BUBBLE_R + z.r);
      b.zoneOverlap[z.id] = overlap;
      b.dragMinDist[z.id] = d;
      if (overlap && already == null) already = z.id;
    }
    b.dragEraseCount = 0; b.dragOverlayCount = 0;
    return already;
  }
  // 階段切換生效時, 對「目前拖曳中」的氣泡, 針對新生效的區域補記「已相交」(不觸發擦過)
  function markZoneActiveForDragging(b, zone) {
    if (!b || b.mode !== 'drag') return;
    var d = dist(b.x, b.y, zone.x, zone.y);
    b.zoneOverlap[zone.id] = d <= (BUBBLE_R + zone.r);
    b.dragMinDist[zone.id] = d;
  }
  function currentStageNum(g) { return stageOf(g.elapsed); }

  function processDragSegment(g, b, p0, p1, elapsed) {
    var zones = activeZonesAt(elapsed);
    var enters = []; // {t, zone}
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var combinedR = BUBBLE_R + z.r;
      var wasOverlap = !!b.zoneOverlap[z.id];
      var interval = sweepCircleInterval(p0, p1, z.x, z.y, combinedR);
      var endInside = dist(p1.x, p1.y, z.x, z.y) <= combinedR;
      if (!wasOverlap && interval) enters.push({ t: interval[0], zone: z });
      b.zoneOverlap[z.id] = endInside;
      var closeD = closestDistanceOnSegment(p0, p1, z.x, z.y);
      if (b.dragMinDist[z.id] == null || closeD < b.dragMinDist[z.id]) b.dragMinDist[z.id] = closeD;
    }
    enters.sort(function (a, b2) {
      if (Math.abs(a.t - b2.t) > 1e-9) return a.t - b2.t;
      var aw = a.zone.kind === 'wash' ? 1 : 0, bw = b2.zone.kind === 'wash' ? 1 : 0;
      return aw - bw; // 同一點同時碰到: 洗除區最後套用
    });
    var globalInPreview = previewInfo(elapsed).inPreview;
    for (var e = 0; e < enters.length; e++) {
      var zone = enters[e].zone;
      var result = applyZoneSwipe(b, zone);
      b.swipeFx = 1;
      b.swipeKind = zone.kind === 'paint' ? 'paint' : (zone.kind === 'shape' ? 'shape' : 'wash');
      var rec = emit(g, 'swipe', {
        bubbleId: b.id, zoneId: zone.id, zoneKind: zone.kind,
        beforeColor: result.before.color, beforeShape: result.before.shape,
        afterColor: result.after.color, afterShape: result.after.shape,
        classification: result.classification, inPreview: globalInPreview
      });
      b.swipeRecords.push(rec);
      g.totals.swipe++;
      if (result.classification === '錯擦') { g.totals.erase++; b.totalErase++; b.dragEraseCount++; }
      if (result.classification === '覆蓋') {
        b.dragOverlayCount++;
        b.overlayPending = b.overlayPending || [];
        b.overlayPending.push({ record: rec, attr: zone.kind === 'paint' ? 'color' : 'shape', valueSet: zone.kind === 'paint' ? result.after.color : result.after.shape });
      }
      b.lastMandatoryElapsed = elapsed;
    }
    // 窄縫穿越(埋點用, 不影響玩法): 只在兩側區域已出場的階段之後才追蹤
    var stg = currentStageNum(g);
    for (var gi = 0; gi < GAPS_DEF.length; gi++) {
      var gap = GAPS_DEF[gi];
      if (stg < gap.stage) continue;
      var s0 = Art.layout.zoneById[gap.sides[0]], s1 = Art.layout.zoneById[gap.sides[1]];
      if (!s0 || !s1) continue;
      var hit = segSegIntersect(p0, p1, { x: s0.x, y: s0.y }, { x: s1.x, y: s1.y });
      if (!hit) continue;
      var len = dist(s0.x, s0.y, s1.x, s1.y);
      var offset = (0.5 - hit.s) * len;
      var px = p0.x + (p1.x - p0.x) * hit.t, py = p0.y + (p1.y - p0.y) * hit.t;
      var touch0 = dist(px, py, s0.x, s0.y) <= (BUBBLE_R + s0.r);
      var touch1 = dist(px, py, s1.x, s1.y) <= (BUBBLE_R + s1.r);
      var since = b.lastMandatoryElapsed == null ? (elapsed - (b.dragStartElapsed || elapsed)) : (elapsed - b.lastMandatoryElapsed);
      emit(g, 'gapCross', {
        bubbleId: b.id, gapName: gap.name, lateralOffset: offset,
        sinceLastMandatoryMs: since, touchingSide: touch0 || touch1
      });
      g.totals.gapCross++;
      b.lastMandatoryElapsed = elapsed;
    }
  }

  // ==================================================================
  // HP / 分數
  // ==================================================================
  function loseHp(g, reason) {
    var before = g.hp;
    g.hp = Math.max(0, g.hp - 1);
    g.combo = 0;
    g.hpFlash = 1;
    if (before === PARAMS.hpMax) g.lastFullHpElapsedMs = nowElapsed(g);
    if (g.hp <= PARAMS.hpLE2Threshold && g.hpLE2OpenSince == null) {
      g.hpLE2OpenSince = nowElapsed(g);
      if (g.firstHpLE2ElapsedMs == null) { g.firstHpLE2ElapsedMs = nowElapsed(g); g.firstHpLE2Stage = stageOf(g.elapsed); }
      g.hpLE2Entries.push({ enterElapsedMs: nowElapsed(g), durationSec: null, rateAtEnter: currentSpawnRate(g) });
    }
    emit(g, 'hpChange', { reason: reason, hp: g.hp, countOnField: fieldCount(g) });
    if (g.hp === 0) g.pendingDeathReasons.push(reason);
  }
  function gainHp(g) {
    if (g.hp >= PARAMS.hpMax) { g.totals.fullHpCaptureCount++; return; }
    g.hp = Math.min(PARAMS.hpMax, g.hp + 1);
    g.hpGainFx = 1;
    g.totals.totalHpGained++;
    if (g.hp > PARAMS.hpLE2Threshold && g.hpLE2OpenSince != null) {
      var entry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      entry.durationSec = (nowElapsed(g) - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += entry.durationSec;
      g.hpLE2OpenSince = null;
    }
    emit(g, 'hpChange', { reason: 'capture', hp: g.hp, countOnField: fieldCount(g) });
  }
  function checkDeath(g) {
    if (!g.done && g.hp <= 0 && g.pendingDeathReasons.length > 0) { g.done = true; endGame('hpZero'); }
  }
  function scoreForCombo(combo) {
    var bonus = Math.min(combo - 1, PARAMS.comboStreakCap) * PARAMS.comboBonusPerStreak;
    return Math.round(PARAMS.scoreBase * (1 + bonus));
  }

  // ==================================================================
  // 移除 / 終結一顆氣泡的收尾(覆蓋回填 / 錯擦回填 / 條件不符彈回回填)
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }
  function finalizeBubble(g, b, outcome, netConditionSnapshot) {
    var elapsed = nowElapsed(g);
    var rec = g.bubbleRec[b.id];
    if (rec) { rec.outcome = outcome; rec.outcomeElapsed = elapsed; }
    (b.overlayPending || []).forEach(function (o) {
      var stillSame = (o.attr === 'color') ? (b.color === o.valueSet) : (b.shape === o.valueSet);
      var intentional = false;
      if (stillSame && outcome === 'captured') {
        intentional = (o.attr === 'color') ? true : !!(netConditionSnapshot && netConditionSnapshot.shape);
      }
      o.record.overlayIntent = intentional ? '有意' : '失誤';
      if (intentional) g.totals.overlayIntentional++; else g.totals.overlayMistake++;
      b[intentional ? 'totalOverlayIntentional' : 'totalOverlayMistake']++;
    });
    b.swipeRecords.forEach(function (r) {
      if (r.classification === '錯擦' || r.overlayIntent === '失誤') {
        r.timeToCaptureFromThisMs = outcome === 'captured' ? (elapsed - r.t) : null;
      }
    });
    b.bounceCondRecords.forEach(function (r) {
      r.laterCaptured = (outcome === 'captured');
      r.timeToCaptureMs = outcome === 'captured' ? (elapsed - r.t) : null;
      r.dragsAfter = countEventsSince(g, b.id, 'grab', r.t);
      r.erasesAfter = countEventsSinceErase(g, b.id, r.t);
    });
  }
  function countEventsSince(g, bubbleId, type, sinceT) {
    var n = 0;
    for (var i = 0; i < g.events.length; i++) { var e = g.events[i]; if (e.bubbleId === bubbleId && e.type === type && e.t > sinceT) n++; }
    return n;
  }
  function countEventsSinceErase(g, bubbleId, sinceT) {
    var n = 0;
    for (var i = 0; i < g.events.length; i++) {
      var e = g.events[i];
      if (e.bubbleId === bubbleId && e.type === 'swipe' && e.classification === '錯擦' && e.t > sinceT) n++;
    }
    return n;
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    finalizeBubble(g, b, 'expired', null);
    var snap = { id: b.id, color: b.color, shape: b.shape, everDyed: b.everDyed, grabCount: b.grabCount, totalErase: b.totalErase };
    removeBubble(g, b); // 先移除, 讓「當下場上氣泡數/可處理的氣泡數」自然不含這顆
    emit(g, 'expire', {
      bubbleId: snap.id, color: snap.color, shape: snap.shape, everDyed: snap.everDyed, grabCount: snap.grabCount,
      totalErase: snap.totalErase, countOnField: fieldCount(g), processableCount: processableCount(g)
    });
    g.totals.expired++;
    if (g.firstExpireElapsedMs == null) { g.firstExpireElapsedMs = nowElapsed(g); g.firstExpireRate = currentSpawnRate(g); g.firstExpireStage = stageOf(g.elapsed); }
    loseHp(g, 'expire');
  }

  // ==================================================================
  // 網 / 落點
  // ==================================================================
  function findNetOnAt(elapsed, x, y) {
    for (var i = 0; i < NETS_DEF.length; i++) {
      var st = netStateAt(NETS_DEF[i], elapsed);
      if (st.status === 'on' && dist(x, y, NETS_DEF[i].x, NETS_DEF[i].y) <= NET_R) return NETS_DEF[i];
    }
    return null;
  }
  function nearestOnNetDistance(elapsed, x, y) {
    var best = null;
    for (var i = 0; i < NETS_DEF.length; i++) {
      var st = netStateAt(NETS_DEF[i], elapsed);
      if (st.status !== 'on') continue;
      var d = dist(x, y, NETS_DEF[i].x, NETS_DEF[i].y);
      if (best == null || d < best) best = d;
    }
    return best;
  }
  function isOnUiRegion(px, py) { return inRect(px, py, L.hudLeft) || inRect(px, py, L.hudRight) || inRect(px, py, L.pauseButton); }

  function emitDragEnd(g, b, reason) {
    var elapsed = nowElapsed(g);
    var nearestByZone = {};
    var zones = activeZonesAt(elapsed);
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var d = b.dragMinDist[z.id];
      nearestByZone[z.id] = d == null ? null : Math.max(0, d - BUBBLE_R - z.r);
    }
    emit(g, 'dragEnd', {
      bubbleId: b.id, reason: reason,
      pathLength: Math.round(b.dragPathLen), durationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
      eraseCount: b.dragEraseCount, overlayCount: b.dragOverlayCount, nearestEdgeDistanceByZone: nearestByZone
    });
  }

  function resolveRelease(g, b, px, py, reason) {
    var elapsed = nowElapsed(g);
    b.dragDistanceTotal += b.dragPathLen;
    emitDragEnd(g, b, reason);
    var inPreview = previewInfo(g.elapsed).inPreview;
    var outcome, netId = null, netCond = null, colorMatch = null, shapeMatch = null;
    var onUi = isOnUiRegion(px, py);
    var net = onUi ? null : findNetOnAt(g.elapsed, px, py);
    var captureInfo = null;
    if (net) {
      var st = netStateAt(net, g.elapsed);
      netId = net.id; netCond = { color: net.color, shape: st.shape };
      colorMatch = (b.color === net.color);
      shapeMatch = (st.shape == null) ? null : (b.shape === st.shape); // null = 不比對
      var allOk = colorMatch && (st.shape == null || shapeMatch);
      if (allOk) {
        outcome = 'captured';
        var newCombo = g.combo + 1;
        var pts = scoreForCombo(newCombo);
        g.score += pts; g.combo = newCombo;
        var hpBefore = g.hp;
        finalizeBubble(g, b, 'captured', netCond);
        g.captureTimestamps.push(elapsed);
        g.totals.captured++;
        captureInfo = {
          netId: net.id, conditionCount: st.shape != null ? 2 : 1, hpBefore: hpBefore,
          processingMs: elapsed - b.spawnElapsed, processingMsExFreeze: elapsed - b.spawnElapsed - b.freezeMsTotal,
          grabCount: b.grabCount, pathLength: Math.round(b.dragDistanceTotal),
          eraseCount: b.totalErase, overlayIntentionalCount: b.totalOverlayIntentional, overlayMistakeCount: b.totalOverlayMistake,
          spawnStage: b.spawnStage, inPreview: inPreview, points: pts
        };
        removeBubble(g, b);
        gainHp(g);
        g.netFx[net.id].flash = 'catch'; g.netFx[net.id].flashT = 0;
      } else {
        // 條件不符彈回: 氣泡尚未結束(之後可能又被捕捉或過期), 不在此做終結回填;
        // 回填欄位掛在下面統一送出的 'drop' 事件紀錄上(規格:「回填到原放下事件」)
        outcome = 'bounceCond';
        g.totals.bounceCond++;
        g.combo = 0;
        startReturn(b, px, py);
        g.netFx[net.id].flash = 'bounce'; g.netFx[net.id].flashT = 0;
      }
    } else {
      var dToCenter = dist(px, py, INNER.x, INNER.y);
      if (!onUi && dToCenter <= INNER.r) {
        outcome = 'stayInner';
        g.totals.stayInner++;
        b.mode = 'idle'; b.x = px; b.y = py; clampToCircle(b);
      } else {
        outcome = 'bounceOuter';
        g.totals.bounceOuter++;
        startReturn(b, px, py);
      }
    }
    var distToNet = nearestOnNetDistance(g.elapsed, px, py);
    var evt = {
      bubbleId: b.id, targetNetId: netId, color: b.color, shape: b.shape,
      netCondition: netCond, colorMatch: colorMatch, shapeMatch: shapeMatch === null ? '不比對' : shapeMatch,
      outcome: outcome, x: px, y: py, distanceToNearestOnNetCenter: distToNet,
      dragDurationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
      dragDistance: Math.round(b.dragPathLen), countOnField: fieldCount(g), inPreview: inPreview
    };
    if (captureInfo) { for (var k in captureInfo) evt[k] = captureInfo[k]; }
    var dropRec = emit(g, 'drop', evt);
    if (outcome === 'bounceCond') b.bounceCondRecords.push(dropRec);
    g.lastDropElapsed = elapsed;
    g.lastDropProcessableCount = processableCount(g);
    checkDeath(g);
  }

  // 系統事件強制結果(視窗外放開/失焦): 一律視為「其他位置」彈回, 不看當下座標判定, 走獨立路徑
  function forceBounceDrag(g, reason) {
    if (!(mouse.press && mouse.press.dragging)) return;
    var b = mouse.press.bubble;
    if (b && !b.dead) {
      var px = mouse.x, py = mouse.y;
      b.dragDistanceTotal += b.dragPathLen;
      emitDragEnd(g, b, reason);
      var elapsed = nowElapsed(g);
      var distToNet = nearestOnNetDistance(g.elapsed, px, py);
      startReturn(b, px, py);
      g.totals.bounceOuter++;
      emit(g, 'drop', {
        bubbleId: b.id, targetNetId: null, color: b.color, shape: b.shape, netCondition: null,
        colorMatch: null, shapeMatch: '不比對', outcome: 'bounceOuter', x: px, y: py,
        distanceToNearestOnNetCenter: distToNet,
        dragDurationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
        dragDistance: Math.round(b.dragPathLen), countOnField: fieldCount(g), inPreview: previewInfo(g.elapsed).inPreview
      });
      g.lastDropElapsed = elapsed;
      g.lastDropProcessableCount = processableCount(g);
    }
    mouse.press = null;
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
  // 階段切換偵測(每 tick 檢查一次; 同一幀的處理順序步驟 1: 先讓新區域/新網生效,
  // 再處理本幀拖曳路徑; 由於 mousemove 以事件驅動即時處理, 這裡的檢查發生在下一個 rAF
  // 的 tick 開頭, 早於該幀後續的滑鼠移動處理, 對 2 秒等級的預告窗口而言精度已足夠)
  // ==================================================================
  function checkStageTransitions(g, prevElapsed, newElapsed) {
    var t = PARAMS.stageTimesMs;
    for (var i = 1; i < t.length; i++) {
      if (prevElapsed < t[i] && newElapsed >= t[i]) {
        var newStage = i + 1;
        var newZones = ZONES_DEF.filter(function (z) { return z.stage === newStage; });
        var newNets = NETS_DEF.filter(function (n) { return n.stage === newStage; });
        var upgradedNets = [];
        for (var ni = 0; ni < NETS_DEF.length; ni++) {
          var sched = NET_SHAPE_SCHEDULE[NETS_DEF[ni].id] || [];
          var oldShape = null;
          for (var si = 0; si < sched.length; si++) {
            if (sched[si].stage === newStage) upgradedNets.push({ id: NETS_DEF[ni].id, oldShape: oldShape, newShape: sched[si].shape });
            else if (sched[si].stage < newStage) oldShape = sched[si].shape;
          }
        }
        var dragBubble = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
        var anyHeldOrDragging = !!mouse.press;
        var alreadyIntersecting = [];
        newZones.forEach(function (z) {
          markZoneActiveForDragging(dragBubble, z);
          if (dragBubble && dragBubble.zoneOverlap[z.id]) alreadyIntersecting.push(z.id);
        });
        var bubblesSnapshot = g.bubbles.map(function (b2) { return { id: b2.id, color: b2.color, shape: b2.shape }; });
        emit(g, 'stageChange', {
          previewStart: t[i] - PARAMS.previewMs, effectiveT: t[i], newStage: newStage,
          newZones: newZones.map(function (z) { return { id: z.id, kind: z.kind }; }),
          newNets: newNets.map(function (n) { return { id: n.id, color: n.color }; }),
          upgradedNets: upgradedNets,
          bubblesAtEffective: bubblesSnapshot,
          anyHeldOrDragging: anyHeldOrDragging,
          draggingBubbleId: dragBubble ? dragBubble.id : null,
          alreadyIntersectingZones: alreadyIntersecting
        });
        g.stageChanges.push({ stage: newStage, previewStart: t[i] - PARAMS.previewMs, effectiveT: t[i] });
      }
    }
  }

  // ==================================================================
  // 主更新
  // ==================================================================
  function emitSample(g) {
    var rate = currentSpawnRate(g);
    g.hpCurve.push({ t: nowElapsed(g), hp: g.hp });
    emit(g, 'sample', {
      countOnField: fieldCount(g), spawnRate: rate,
      anyHoldOrDrag: !!(mouse.press), processableCount: processableCount(g), hp: g.hp
    });
  }

  function tick(dt) {
    var g = game;
    var prevElapsed = g.elapsed;
    g.elapsed += dt * 1000;
    g.pendingDeathReasons = [];

    // 步驟 1: 階段切換生效
    checkStageTransitions(g, prevElapsed, g.elapsed);

    // 生成排程
    g.spawnTimer -= dt;
    var guardSpawn = 0;
    while (g.spawnTimer <= 0 && guardSpawn < 20) { attemptSpawn(g); guardSpawn++; }

    updatePhysics(g, dt);

    // 凍結時長累計(按住/拖曳中不遞減壽命, 但要累計供「處理時間扣凍結」用)
    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb = g.bubbles[fi];
      if (fb.mode === 'hold' || fb.mode === 'drag') fb.freezeMsTotal += dt * 1000;
    }

    // 壽命遞減與消失(對複本迭代)
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'hold' || b.mode === 'drag') continue;
      b.life -= dt;
      if (b.life <= 0) expireBubble(g, b);
    }

    // 回饋淡出
    for (var bi = 0; bi < g.bubbles.length; bi++) {
      var bb = g.bubbles[bi];
      if (bb.swipeFx > 0) bb.swipeFx = Math.max(0, bb.swipeFx - dt / 0.35);
    }
    if (g.hpFlash > 0) g.hpFlash = Math.max(0, g.hpFlash - dt / 0.6);
    if (g.hpGainFx > 0) g.hpGainFx = Math.max(0, g.hpGainFx - dt / 0.6);
    [1, 2, 3, 4].forEach(function (nid) {
      var fx = g.netFx[nid];
      if (fx.flash) { fx.flashT += dt / 0.5; if (fx.flashT >= 1) { fx.flash = null; fx.flashT = 0; } }
    });

    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));

    g.sampleAcc += dt;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleInterval && guard < 10) { g.sampleAcc -= PARAMS.sampleInterval; emitSample(g); guard++; }

    checkDeath(g);
  }

  // ==================================================================
  // 局末彙整(全部由事件記錄後製, 避免另存一份容易漂移的即時計數)
  // ==================================================================
  function segIndex(t) { return Math.floor(t / PARAMS.segmentMs); }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }

  function computeSummary(g) {
    var events = g.events;
    var spawns = byType(events, 'spawn');
    var drops = byType(events, 'drop');
    var expires = byType(events, 'expire');
    var swipes = byType(events, 'swipe');
    var gapCrosses = byType(events, 'gapCross');
    var samples = byType(events, 'sample');
    var presses = byType(events, 'press');
    var grabs = byType(events, 'grab');
    var stageChanges = byType(events, 'stageChange');
    var pauses = byType(events, 'pause');

    var captureDrops = drops.filter(function (d) { return d.outcome === 'captured'; });
    var bounceCondDrops = drops.filter(function (d) { return d.outcome === 'bounceCond'; });
    var bounceOuterDrops = drops.filter(function (d) { return d.outcome === 'bounceOuter'; });
    var eraseSwipes = swipes.filter(function (s) { return s.classification === '錯擦'; });
    var overlaySwipes = swipes.filter(function (s) { return s.classification === '覆蓋'; });

    var durationSec = g.elapsed / 1000;
    var segCount = Math.max(1, segIndex(g.elapsed) + 1);

    // ---- 各階段統計 ----
    var stageIds = [1, 2, 3, 4, 5, 6];
    var stageBoundsMs = PARAMS.stageTimesMs.concat([Infinity]);
    var stageStats = stageIds.map(function (s) {
      var startMs = stageBoundsMs[s - 1], endMs = stageBoundsMs[s];
      var dwellMs = Math.max(0, Math.min(g.elapsed, endMs) - startMs);
      var spawnedIds = Object.keys(g.bubbleRec).filter(function (id) { return g.bubbleRec[id].spawnStage === s; });
      var stageCaptures = captureDrops.filter(function (d) { return d.stage === s; });
      var stageExpires = expires.filter(function (d) { return d.stage === s; });
      var stageBounceCond = bounceCondDrops.filter(function (d) { return d.stage === s; });
      var stageSwipes = swipes.filter(function (d) { return d.stage === s; });
      var stageErase = stageSwipes.filter(function (d) { return d.classification === '錯擦'; });
      var stageOverlay = stageSwipes.filter(function (d) { return d.classification === '覆蓋'; });
      return {
        stage: s, dwellSec: dwellMs / 1000,
        spawnCount: spawnedIds.length, captureCount: stageCaptures.length, expireCount: stageExpires.length,
        bounceCondCount: stageBounceCond.length,
        avgProcessingMs: avgOf(stageCaptures.map(function (d) { return d.processingMs; })),
        avgPathLength: avgOf(stageCaptures.map(function (d) { return d.pathLength; })),
        eraseOverSwipe: ratio(stageErase.length, stageSwipes.length),
        overlayIntentional: stageOverlay.filter(function (d) { return d.overlayIntent === '有意'; }).length,
        overlayMistake: stageOverlay.filter(function (d) { return d.overlayIntent === '失誤'; }).length
      };
    });
    var netCaptureByStage = {};
    stageIds.forEach(function (s) {
      netCaptureByStage[s] = {};
      [1, 2, 3, 4].forEach(function (nid) {
        netCaptureByStage[s][nid] = captureDrops.filter(function (d) { return d.stage === s && d.netId === nid; }).length;
      });
    });

    // ---- 積壓期處理率(可處理氣泡數 >= 2 的秒數 vs 這些秒內的捕捉數), 全局與分階段 ----
    function busyRateFor(sampleSubset, captureSubset) {
      var busySecSet = {};
      var busySec = 0;
      sampleSubset.forEach(function (s) { if (s.processableCount >= 2) { busySecSet[Math.floor(s.t / 1000)] = true; busySec++; } });
      var busyCaptures = captureSubset.filter(function (d) { return busySecSet[Math.floor(d.t / 1000)]; }).length;
      return { busySeconds: busySec, rate: ratio(busyCaptures, busySec) };
    }
    var backlogGlobal = busyRateFor(samples, captureDrops);
    var backlogByStage = {};
    stageIds.forEach(function (s) {
      backlogByStage[s] = busyRateFor(samples.filter(function (sm) { return sm.stage === s; }), captureDrops.filter(function (d) { return d.stage === s; }));
    });

    // ---- 死前 60 秒每 10 秒的捕捉數與平均場上氣泡數(只限命歸零結束的局) ----
    var deathBy10s = null;
    if (g.deathReasons && g.deathReasons.indexOf('expire') !== -1) {
      deathBy10s = [];
      for (var w = 6; w >= 1; w--) {
        var winEnd = g.elapsed - (w - 1) * 10000, winStart = g.elapsed - w * 10000;
        var wc = captureDrops.filter(function (d) { return d.t >= winStart && d.t < winEnd; }).length;
        var wsamples = samples.filter(function (s) { return s.t >= winStart && s.t < winEnd; });
        deathBy10s.push({ startMs: Math.max(0, winStart), endMs: Math.max(0, winEnd), captureCount: wc, avgOnField: avgOf(wsamples.map(function (s) { return s.countOnField; })) });
      }
    }

    // ---- 命 <= 2 收尾 ----
    if (g.hpLE2OpenSince != null) {
      var tail = (g.elapsed - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += tail;
      var lastEntry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      if (lastEntry && lastEntry.durationSec == null) lastEntry.durationSec = tail;
      g.hpLE2OpenSince = null;
    }
    var hpLE2Ratio = durationSec > 0 ? g.hpLE2SecTotal / durationSec : null;

    // ---- 最長無捕捉間隔(從第一顆生成起算, 死前 30 秒以外) ----
    var longestGap = null;
    if (spawns.length) {
      var boundary = Math.max(spawns[0].t, g.elapsed - 30000);
      var capTimes = g.captureTimestamps.filter(function (t) { return t <= boundary; }).slice().sort(function (a, b) { return a - b; });
      var marks = [spawns[0].t].concat(capTimes, [boundary]);
      for (var mi = 0; mi < marks.length - 1; mi++) {
        var a0 = marks[mi], b0 = marks[mi + 1];
        if (b0 <= a0) continue;
        var handFreeSec = 0, handFreeAndProcessableSec = 0, maxField = 0;
        samples.forEach(function (sm) {
          if (sm.t >= a0 && sm.t < b0) {
            if (!sm.anyHoldOrDrag) handFreeSec++;
            if (!sm.anyHoldOrDrag && sm.processableCount >= 1) handFreeAndProcessableSec++;
            maxField = Math.max(maxField, sm.countOnField);
          }
        });
        var durSec = (b0 - a0) / 1000;
        if (!longestGap || durSec > longestGap.durationSec) longestGap = { startMs: a0, endMs: b0, durationSec: durSec, handFreeSec: handFreeSec, handFreeAndProcessableSec: handFreeAndProcessableSec, maxFieldCount: maxField };
      }
    }

    // ---- 手空且可處理氣泡數 = 0 / >= 1 的時間占比(0~60 秒與之後分開) ----
    function idleRatios(subsetSamples) {
      var zero = subsetSamples.filter(function (s) { return !s.anyHoldOrDrag && s.processableCount === 0; }).length;
      var atLeastOne = subsetSamples.filter(function (s) { return !s.anyHoldOrDrag && s.processableCount >= 1; }).length;
      return { zeroRatio: ratio(zero, subsetSamples.length), atLeastOneRatio: ratio(atLeastOne, subsetSamples.length) };
    }
    var samples0to60 = samples.filter(function (s) { return s.t < 60000; });
    var samplesAfter60 = samples.filter(function (s) { return s.t >= 60000; });
    var idle0to60 = idleRatios(samples0to60), idleAfter60 = idleRatios(samplesAfter60);

    // ---- 放下到下一次按下的間隔清單(只取上次放下時可處理氣泡數 >= 1 的樣本; 用 press 事件
    //      自帶的「距上次放下的間隔」與「上次放下那刻可處理的氣泡數」欄位, 不事後用時間戳配對) ----
    var dropToNextPressFiltered = grabsIntervalStat();
    function grabsIntervalStat() {
      var out = [];
      for (var i2 = 0; i2 < presses.length; i2++) {
        var pr = presses[i2];
        if (pr.processableAtLastDrop != null && pr.processableAtLastDrop >= 1 && pr.intervalSinceLastDropMs != null) {
          out.push(pr.intervalSinceLastDropMs);
        }
      }
      return out;
    }
    var indicator3aList = dropToNextPressFiltered;
    var indicator3a = {
      medianMs: median(indicator3aList), over2500Ratio: ratio(indicator3aList.filter(function (v) { return v > 2500; }).length, indicator3aList.length)
    };

    // ---- 每 30 秒分段 ----
    var segments = [];
    for (var s = 0; s < segCount; s++) {
      var segStart = s * PARAMS.segmentMs, segEnd = segStart + PARAMS.segmentMs;
      var within = function (a, b2) { return function (t) { return t >= a && t < b2; }; }(segStart, segEnd);
      var segSpawn = spawns.filter(function (e) { return within(e.t); }).length;
      var segCap = captureDrops.filter(function (e) { return within(e.t); }).length;
      var segExp = expires.filter(function (e) { return within(e.t); }).length;
      var segBounce = bounceCondDrops.filter(function (e) { return within(e.t); }).length;
      var segErase = eraseSwipes.filter(function (e) { return within(e.t); }).length;
      var segOverlayI = overlaySwipes.filter(function (e) { return within(e.t) && e.overlayIntent === '有意'; }).length;
      var segOverlayM = overlaySwipes.filter(function (e) { return within(e.t) && e.overlayIntent === '失誤'; }).length;
      segments.push({ index: s, startMs: segStart, endMs: segEnd, spawnCount: segSpawn, captureCount: segCap, expireCount: segExp, bounceCondCount: segBounce, eraseCount: segErase, overlayIntentional: segOverlayI, overlayMistake: segOverlayM });
    }
    // 每 30 秒生成批次最終去向
    var spawnBatchOutcome = segments.map(function (sg) {
      var ids = Object.keys(g.bubbleRec).filter(function (id) { return Math.floor(g.bubbleRec[id].spawnElapsed / PARAMS.segmentMs) === sg.index; });
      var captured = 0, expired = 0, residual = 0;
      ids.forEach(function (id) {
        var out = g.bubbleRec[id].outcome;
        if (out === 'captured') captured++; else if (out === 'expired') expired++; else residual++;
      });
      return { index: sg.index, spawnCount: ids.length, captured: captured, expired: expired, residual: residual, captureRate: ratio(captured, ids.length) };
    });

    // ---- 相鄰兩次捕捉間隔清單 ----
    var captureIntervals = [];
    for (var ci = 1; ci < g.captureTimestamps.length; ci++) captureIntervals.push(g.captureTimestamps[ci] - g.captureTimestamps[ci - 1]);
    var indicator5 = { medianMs: median(captureIntervals), p90Ms: p90(captureIntervals), maxMs: maxOf(captureIntervals) };

    // ---- 每次階段切換前後 30 秒 ----
    var stageWindowStats = g.stageChanges.map(function (sc) {
      var before = { start: sc.effectiveT - 30000, end: sc.effectiveT };
      var after = { start: sc.effectiveT, end: sc.effectiveT + 30000 };
      var previewWinAfter = { start: sc.previewStart, end: sc.previewStart + 30000 };
      var survived30 = g.elapsed >= sc.effectiveT + 30000;
      function countIn(arr, win) { return arr.filter(function (e) { return e.t >= win.start && e.t < win.end; }).length; }
      var res = {
        stage: sc.stage, effectiveT: sc.effectiveT,
        captureBefore: countIn(captureDrops, before), captureAfter: survived30 ? countIn(captureDrops, after) : null,
        expireBefore: countIn(expires, before), expireAfter: survived30 ? countIn(expires, after) : null,
        bounceCondBefore: countIn(bounceCondDrops, before), bounceCondAfter: survived30 ? countIn(bounceCondDrops, after) : null,
        spawnBefore: countIn(spawns, before), spawnAfterEffective: survived30 ? countIn(spawns, after) : null,
        spawnAfterFromPreview: survived30 ? countIn(spawns, previewWinAfter) : null,
        previewSpawnCount: countIn(spawns, { start: sc.previewStart, end: sc.effectiveT }),
        previewCaptureCount: countIn(captureDrops, { start: sc.previewStart, end: sc.effectiveT }),
        previewBounceCount: countIn(bounceCondDrops.concat(bounceOuterDrops), { start: sc.previewStart, end: sc.effectiveT })
      };
      if (survived30) {
        var idsInWin = Object.keys(g.bubbleRec).filter(function (id) { var r = g.bubbleRec[id]; return r.spawnElapsed >= after.start && r.spawnElapsed < after.end; });
        res.spawnedInWindowCapturedCount = idsInWin.filter(function (id) { return g.bubbleRec[id].outcome === 'captured'; }).length;
        var netBounceCounts = {};
        [1, 2, 3, 4].forEach(function (nid) { netBounceCounts[nid] = bounceCondDrops.filter(function (e) { return e.t >= after.start && e.t < after.end && e.targetNetId === nid; }).length; });
        res.netBounceCondCountsAfter = netBounceCounts;
        res.indicator6 = ratio(res.captureAfter, res.captureAfter + res.expireAfter + res.bounceCondAfter) - ratio(res.captureBefore, res.captureBefore + res.expireBefore + res.bounceCondBefore);
      }
      return res;
    });

    // ---- 主要指標 ----
    var indicator1_stage1 = ratio(
      captureDrops.filter(function (d) { return d.spawnStage === 1; }).length,
      Object.keys(g.bubbleRec).filter(function (id) { return g.bubbleRec[id].spawnStage === 1; }).length
    );
    var indicator1ByStage = stageIds.map(function (s) {
      var ids = Object.keys(g.bubbleRec).filter(function (id) { return g.bubbleRec[id].spawnStage === s; });
      var cap = ids.filter(function (id) { return g.bubbleRec[id].outcome === 'captured'; }).length;
      return { stage: s, captureRate: ratio(cap, ids.length), denom: ids.length };
    });
    var indicator2 = { firstElapsedMs: g.firstHpLE2ElapsedMs, firstStage: g.firstHpLE2Stage, ratio: hpLE2Ratio };
    var indicator4Global = {
      eraseOverCapture: ratio(eraseSwipes.length, captureDrops.length),
      overlayMistakeOverCapture: ratio(overlaySwipes.filter(function (s2) { return s2.overlayIntent === '失誤'; }).length, captureDrops.length),
      bounceCondRate: ratio(bounceCondDrops.length, captureDrops.length + bounceCondDrops.length)
    };
    var mainIndicators = {
      indicator1_stage1CaptureRate: indicator1_stage1, indicator1ByStage: indicator1ByStage,
      indicator2_hpLE2: indicator2,
      indicator3a: indicator3a,
      indicator3b: { ratio0to60: idle0to60.zeroRatio, ratioAfter60: idleAfter60.zeroRatio },
      indicator4: indicator4Global,
      indicator5: indicator5,
      indicator6ByStageChange: stageWindowStats.filter(function (s2) { return s2.indicator6 != null; }).map(function (s2) { return { stage: s2.stage, delta: s2.indicator6 }; })
    };

    var maxStageReached = stageOf(g.elapsed);
    var pauseSecTotal = pauses.reduce(function (a, p) { return a + (p.endRealMs != null ? (p.endRealMs - p.startRealMs) : 0); }, 0);

    return {
      durationSec: durationSec,
      maxStageReached: maxStageReached,
      stageStats: stageStats,
      netCaptureByStage: netCaptureByStage,
      backlogProcessingRate: { global: backlogGlobal, byStage: backlogByStage },
      deathBy10sWindow: deathBy10s,
      lastFullHpElapsedMs: g.lastFullHpElapsedMs,
      secFromLastFullHpToDeath: g.lastFullHpElapsedMs == null ? null : (g.elapsed - g.lastFullHpElapsedMs) / 1000,
      hpLE2: { firstElapsedMs: g.firstHpLE2ElapsedMs, firstStage: g.firstHpLE2Stage, ratio: hpLE2Ratio, entries: g.hpLE2Entries },
      firstExpire: { elapsedMs: g.firstExpireElapsedMs, rate: g.firstExpireRate, stage: g.firstExpireStage },
      hpCurve: g.hpCurve, totalHpGained: g.totals.totalHpGained, fullHpCaptureCount: g.totals.fullHpCaptureCount,
      longestNoCaptureGap: longestGap,
      idleTimeRatio: { r0to60: idle0to60, rAfter60: idleAfter60 },
      dropToNextPressIntervalsMs: indicator3aList,
      segments: segments, spawnBatchOutcome: spawnBatchOutcome,
      adjacentCaptureIntervalsMs: captureIntervals,
      stageWindowStats: stageWindowStats,
      pauseCount: g.pauseCount, pauseSecTotal: pauseSecTotal / 1000,
      maxConcurrent: g.maxConcurrent, forcedPlacementCount: g.forcedPlacementCount,
      totals: g.totals,
      spawnRatioVsLambdaIntegral: (function () {
        var tSec = durationSec;
        var integral = PARAMS.spawnRate0 * tSec + PARAMS.spawnRateSlope * tSec * tSec / 2;
        return integral > 0 ? g.totals.spawned / integral : null;
      })(),
      dragTimeRatio: null, // 由 events 'dragEnd' 累計時長 / 存活時長, 於下方補上
      mainIndicators: mainIndicators
    };
  }

  function finalizeAndDownload(g) {
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    if (mouse.press && mouse.press.dragging) {
      var db = mouse.press.bubble;
      if (db && !db.dead) emitDragEnd(g, db, '局結束中止');
    }
    if (mouse.press && !mouse.press.dragging) {
      var hb = mouse.press.bubble;
      if (hb && !hb.dead) emit(g, 'holdNoDrag', { bubbleId: hb.id, freezeDurationMs: nowElapsed(g) - mouse.press.downTime, endReason: '局結束' });
    }
    mouse.press = null;
    g.bubbles.slice().forEach(function (b) {
      finalizeBubble(g, b, 'residual', null);
      emit(g, 'fieldEnd', { bubbleId: b.id, color: b.color, shape: b.shape, spawnElapsedMs: b.spawnElapsed, spawnStage: b.spawnStage, life: Math.max(0, b.life), grabCount: b.grabCount });
    });
    var summary = computeSummary(g);
    var dragEndEvents = byType(g.events, 'dragEnd');
    var dragTotalMs = dragEndEvents.reduce(function (a, e) { return a + (e.durationMs || 0); }, 0);
    summary.dragTimeRatio = g.elapsed > 0 ? dragTotalMs / g.elapsed : null;
    var out = {
      playerId: PLAYER_ID, gameIndex: g.gameIndex, device: g.device, gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: { params: PARAMS, stageTable: L.zones.map(function (z) { return { id: z.id, kind: z.kind, x: z.x, y: z.y, r: z.r, stage: z.stage }; }), nets: L.nets, gaps: L.gaps },
      countedForMainStats: (g.deathReasons.indexOf('quit') === -1 && g.deathReasons.indexOf('restart') === -1),
      durationSec: Math.round(g.elapsed) / 1000, score: g.score, deathReasons: g.deathReasons,
      summary: summary, events: g.events
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
    } catch (e) { return false; }
  }

  function endGame(reason) {
    var g = game;
    if (reason === 'hpZero') {
      var uniq = [];
      g.pendingDeathReasons.forEach(function (r) { if (uniq.indexOf(r) === -1) uniq.push(r); });
      if (uniq.length === 0) uniq = ['expire'];
      g.deathReasons = uniq;
    } else {
      g.deathReasons = [reason]; // 'quit' | 'restart'
    }
    var downloadOk = finalizeAndDownload(g);
    endInfo = { time: g.elapsed / 1000, score: g.score, note: downloadOk ? '紀錄已下載' : '紀錄下載失敗' };
    lastGameEndWall = Date.now();
    if (reason === 'restart') { startNewGame(); screen = SCREEN.PLAYING; }
    else { screen = SCREEN.END; }
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
  function clampDrag(x, y) {
    return { x: clampNum(x, DRAG_B.x, DRAG_B.x + DRAG_B.w), y: clampNum(y, DRAG_B.y, DRAG_B.y + DRAG_B.h) };
  }

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
      if (deviceType) startNewGame();
      else { inputSelectFrom = 'start'; screen = SCREEN.INPUT; }
    } else if (key === 'help') { guideReturnTo = 'title'; guidePage = 1; screen = SCREEN.GUIDE; }
    else if (key === 'device') { inputSelectFrom = 'title'; screen = SCREEN.INPUT; }
  }
  function doInputAction(key) {
    deviceType = key; saveDevice(key);
    if (inputSelectFrom === 'start') startNewGame(); else screen = SCREEN.TITLE;
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
  function findBubbleUnderPoint(g, px, py) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.mode !== 'idle') continue;
      var d = dist(px, py, b.x, b.y);
      if (d <= BUBBLE_R && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  function handlePlayingMouseDown(p) {
    var g = game;
    if (pauseBtnLocate(p)) { mouse.uiDownKey = 'pauseBtn'; return; }
    mouse.uiDownKey = null;
    var target = findBubbleUnderPoint(g, p.x, p.y);
    if (!target) return;
    target.mode = 'hold';
    target.everGrabbed = true;
    var now = nowElapsed(g);
    var intervalSinceLastDrop = g.lastDropElapsed == null ? null : (now - g.lastDropElapsed);
    var rec = emit(g, 'press', {
      bubbleId: target.id, x: p.x, y: p.y, remainingLifeMs: Math.round(target.life * 1000), color: target.color, shape: target.shape,
      intervalSinceLastDropMs: intervalSinceLastDrop, processableAtLastDrop: g.lastDropProcessableCount
    });
    g.lastPressElapsed = now;
    mouse.press = { bubbleId: target.id, bubble: target, downPos: { x: p.x, y: p.y }, downTime: now, dragging: false };
  }

  function handlePlayingMouseMove(p) {
    var g = game;
    if (!mouse.press) return;
    var press = mouse.press;
    var b = press.bubble;
    if (!b || b.dead) return;
    if (!press.dragging) {
      var d0 = dist(p.x, p.y, press.downPos.x, press.downPos.y);
      if (d0 > PARAMS.dragStartDist) {
        press.dragging = true;
        b.mode = 'drag';
        b.grabCount++;
        var now = nowElapsed(g);
        b.dragStartElapsed = now;
        b.dragPathLen = 0;
        // 氣泡中心 = 指標位置(RD 決定 4, 無偏移); 先把位置搬到抓起點, 「已相交」判定才會用到正確位置
        var clamped = clampDrag(p.x, p.y);
        b.x = clamped.x; b.y = clamped.y;
        var already = initDragTracking(b, g.elapsed);
        b.lastMandatoryElapsed = now;
        emit(g, 'grab', {
          bubbleId: b.id, distanceAtDragStart: d0, msAtDragStart: now - press.downTime,
          color: b.color, shape: b.shape, remainingLifeMs: Math.round(b.life * 1000), countOnField: fieldCount(g),
          processableCount: processableCount(g), grabOrdinal: b.grabCount, alreadyIntersectingZoneId: already
        });
      }
    } else {
      var clamped2 = clampDrag(p.x, p.y);
      var prev = { x: b.x, y: b.y };
      var moved = dist(prev.x, prev.y, clamped2.x, clamped2.y);
      b.dragPathLen += moved;
      b.x = clamped2.x; b.y = clamped2.y;
      processDragSegment(g, b, prev, clamped2, g.elapsed);
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
      if (b && !b.dead) resolveRelease(g, b, p.x, p.y, '放開');
      return;
    }
    if (!b || b.dead) return;
    b.mode = 'idle';
    g.totals.holdNoDrag++;
    emit(g, 'holdNoDrag', { bubbleId: b.id, freezeDurationMs: nowElapsed(g) - press.downTime, endReason: '放開' });
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
  // 指標在瀏覽器視窗外放開仍要能收到 mouseup(視為在其他位置放開, 彈回內圈; 強制結果走獨立路徑,
  // 不借用 handlePlayingMouseUp 的一般座標判定)
  window.addEventListener('mouseup', function (e) {
    if (screen === SCREEN.PLAYING && mouse.press && mouse.press.dragging) {
      updateMousePos(e);
      var rect = canvas.getBoundingClientRect();
      var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) forceBounceDrag(game, '視窗外放開');
    } else if (screen === SCREEN.PLAYING && mouse.press) {
      handleGenericMouseUp(e);
    }
  });
  window.addEventListener('blur', function () {
    if (screen === SCREEN.PLAYING) {
      forceBounceDrag(game, '失焦');
      openPause(game, 'blur');
    }
  });

  // ==================================================================
  // 渲染
  // ==================================================================
  function bubbleRenderState(b) {
    return { x: b.x, y: b.y, color: b.color, shape: b.shape, life: Math.max(0, b.life), lifeMax: b.lifeMax, mode: b.mode, swipeFx: b.swipeFx, swipeKind: b.swipeKind };
  }
  function renderGame() {
    var g = game;
    Art.drawBackground(ctx);
    Art.drawInnerRing(ctx);
    var elapsed = g.elapsed;
    var dragBubble = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;

    for (var zi = 0; zi < ZONES_DEF.length; zi++) {
      var z = ZONES_DEF[zi];
      var zst = zoneStateAt(z, elapsed);
      if (!zst.exists) continue;
      var st = { x: z.x, y: z.y, status: zst.status, previewT: zst.previewT, introT: zst.introT };
      if (z.kind === 'paint') { st.color = z.color; Art.drawPaintZone(ctx, st); }
      else if (z.kind === 'shape') { st.shape = z.shape; Art.drawShapeZone(ctx, st); }
      else { Art.drawWashZone(ctx, st); }
    }
    for (var ni = 0; ni < NETS_DEF.length; ni++) {
      var net = NETS_DEF[ni];
      var nst = netStateAt(net, elapsed);
      var hot = !!(dragBubble && nst.status === 'on' && dist(dragBubble.x, dragBubble.y, net.x, net.y) <= NET_R);
      var fx = g.netFx[net.id];
      Art.drawNet(ctx, { x: net.x, y: net.y, color: net.color, status: nst.status, shape: nst.shape, nextShape: nst.nextShape, previewT: nst.previewT, introT: nst.introT, hot: hot, flash: fx.flash, flashT: fx.flashT });
    }
    var others = g.bubbles.filter(function (b) { return b.mode !== 'drag'; });
    for (var i = 0; i < others.length; i++) Art.drawBubble(ctx, bubbleRenderState(others[i]));
    if (dragBubble) Art.drawBubble(ctx, bubbleRenderState(dragBubble));

    Art.drawHud(ctx, { hp: g.hp, hpMax: PARAMS.hpMax, time: g.elapsed / 1000, paused: (screen === SCREEN.PAUSED), score: g.score, combo: g.combo, hpFlash: g.hpFlash, hpGainFx: g.hpGainFx });
    Art.drawPauseButton(ctx, { hover: pauseBtnHover });
    var pv = previewInfo(elapsed);
    if (pv.inPreview) Art.drawStageNotice(ctx, { t: pv.previewT });
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
    if (screen === SCREEN.PLAYING && game && !game.paused) tick(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
