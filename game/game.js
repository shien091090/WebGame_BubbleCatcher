// 捕泡手 遊戲邏輯(spec v10, 中央圓形場地)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art。
// v10 核心差異(相對 v8): 場地換成內圈 + 周邊 8 槽位, 同時只有 1 張網亮著, 捕捉後輪替到別的槽位、
// 重抽條件; 屬性只沾一次(不再有「最後擦過覆蓋」), 沒有洗除區、沒有窄縫/管道。
// 「待定」交 RD 的項目(回報同步列出):
//   3. 強制放置後的推開/一般碰撞推開去處/重疊氣泡按下: 一般碰撞沿用 3-pass 推擠(不彈飛),
//      額外對 idle/hold 氣泡疊加「推出生效中區域」的力, 讓推擠自然偏向避開區域, 推不開允許暫時重疊;
//      重疊氣泡按下取中心離指標最近的那顆
//   4. 彈回落點被佔/與區域相交: 以預設落點(內圈邊上最近點退一個半徑)為準, 用角度偏移表在同半徑上
//      找第一個不與生效中區域相交的位置, 全部失敗則用預設落點(允許重疊)
//   5. 拖曳指標偏移與內圈邊緣判定: 氣泡中心 = 指標位置(無偏移); 內外圈一律用「氣泡中心點」到
//      內圈圓心的距離判定, 不看整顆是否出界
//   6. 彈回中的氣泡參與碰撞: 視為靜態障礙物(擋別顆、自己不被推動)
//   7. 同幀多次命變化與網輪替順序: tick() 內先完成階段切換與物理/過期(過期批次尾端才判死);
//      捕捉(含輪替、回血)由滑鼠放開即時處理, 其後立即 checkDeath; HP 恆 clamp 在 0~上限
//   8. 一幀跨區不漏判/同幀階段切換又拖曳: 用移動圓掃描(sweepCircleInterval)以兩幀間路徑判斷,
//      同幀多區依路徑先後排序; 階段切換在該幀 tick 開頭處理, 早於同幀後續 mousemove 的擦過判定
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var GUIDE_PAGES = L.guide.pages; // 6
  var TAU = Math.PI * 2;

  var BUILD_VERSION = 'demo-v10-0.1.0';

  var INNER = L.inner;                 // {x:640,y:360,r:210}
  var BUBBLE_R = L.bubbleR;             // 20
  var NET_R = L.netR;                   // 60
  var MOVE_R = INNER.r - BUBBLE_R;      // 190, 閒置氣泡可活動半徑
  var DRAG_B = L.dragBounds;            // {x:20,y:20,w:1240,h:680}
  var SLOTS = L.slots;                  // 8 槽位
  var SLOT_BY_NO = {};
  SLOTS.forEach(function (s) { SLOT_BY_NO[s.no] = s; });
  var ZONES = L.zones;                  // 6 塊區域

  var PARAMS = {
    bubbleR: BUBBLE_R, netR: NET_R, zoneR: L.zoneR, zoneRSmall: L.zoneRSmall,
    lifeMax: 12,
    hpMax: 4,
    spawnRate0: 0.50,
    spawnRateSlope: 0.0042,
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
    stageTimesMs: [0, 40000, 80000, 120000, 160000],
    previewMs: 2000,
    introMs: 2000,
    hpLE2Threshold: 2,
    netLightDurationS: 1.2,
    flashDurationS: 0.5,
    swipeFxDurationS: 0.35,
    hpFlashDurationS: 0.6,
    hpGainFxDurationS: 0.6,
    relPassWindowMs: 150
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
  function angleOf(x, y) { var a = Math.atan2(y - INNER.y, x - INNER.x) * 180 / Math.PI; return (a + 360) % 360; }
  function angleDiff180(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // ---------- 玩家 ID 與局數(新命名空間, 不與舊版混) ----------
  var PLAYER_ID_KEY = 'bcv10_playerId';
  var GAME_COUNT_KEY = 'bcv10_gameCount';
  var DEVICE_KEY = 'bcv10_device';
  var SEEN_GUIDE_KEY = 'bcv10_seenGuide';

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
  // 階段時機: stage 1~5, 預告 2 秒, 出場提示 2 秒(暫停時 elapsed 不走, 天生凍結)
  // ==================================================================
  var STAGE_MS = PARAMS.stageTimesMs;
  var SHRINK_STAGE = L.zoneShrinkStage; // 5
  var SHRINK_START = STAGE_MS[SHRINK_STAGE - 1]; // 160000

  function stageOf(elapsed) {
    var s = 1;
    for (var i = 1; i < STAGE_MS.length; i++) if (elapsed >= STAGE_MS[i]) s = i + 1;
    return s;
  }
  // 目前是否在「某次切換」的預告期間(2 秒內), 回傳 { inPreview, previewStage, previewT }
  function previewInfo(elapsed) {
    for (var i = 1; i < STAGE_MS.length; i++) {
      var start = STAGE_MS[i] - PARAMS.previewMs;
      if (elapsed >= start && elapsed < STAGE_MS[i]) return { inPreview: true, previewStage: i + 1, previewT: clamp01((elapsed - start) / PARAMS.previewMs) };
    }
    return { inPreview: false, previewStage: null, previewT: 0 };
  }

  // 區域在某時刻的狀態(生效/預告/出場提示/縮小預告, 見 style.md 狀態對照表)
  function zoneStateAt(z, elapsedMs) {
    var appearMs = STAGE_MS[z.stage - 1];
    if (z.stage > 1) {
      var previewStart = appearMs - PARAMS.previewMs;
      if (elapsedMs < previewStart) return { exists: false };
      if (elapsedMs < appearMs) {
        return { exists: true, active: false, status: 'preview', r: L.zoneR, previewT: clamp01((elapsedMs - previewStart) / PARAMS.previewMs) };
      }
    }
    var ownIntroT = null;
    if (z.stage > 1) {
      var ownIntroEnd = appearMs + PARAMS.introMs;
      ownIntroT = elapsedMs < ownIntroEnd ? clamp01((elapsedMs - appearMs) / PARAMS.introMs) : null;
    }
    var shrinkPrevStart = SHRINK_START - PARAMS.previewMs;
    if (elapsedMs < shrinkPrevStart) {
      return { exists: true, active: true, status: 'on', r: L.zoneR, introT: ownIntroT };
    } else if (elapsedMs < SHRINK_START) {
      return { exists: true, active: true, status: 'shrink', r: L.zoneR, shrinkTo: L.zoneRSmall, previewT: clamp01((elapsedMs - shrinkPrevStart) / PARAMS.previewMs) };
    } else {
      var shrinkIntroEnd = SHRINK_START + PARAMS.introMs;
      var shrinkIntroT = elapsedMs < shrinkIntroEnd ? clamp01((elapsedMs - SHRINK_START) / PARAMS.introMs) : null;
      return { exists: true, active: true, status: 'on', r: L.zoneRSmall, introT: (ownIntroT != null ? ownIntroT : shrinkIntroT) };
    }
  }
  function activeZonesAt(elapsedMs) {
    var list = [];
    for (var i = 0; i < ZONES.length; i++) {
      var st = zoneStateAt(ZONES[i], elapsedMs);
      if (st.exists && st.active) list.push({ id: ZONES[i].id, kind: ZONES[i].kind, color: ZONES[i].color, shape: ZONES[i].shape, angle: ZONES[i].angle, x: ZONES[i].x, y: ZONES[i].y, r: st.r });
    }
    return list;
  }
  function spawnAvoidZonesAt(elapsedMs) {
    var list = [];
    for (var i = 0; i < ZONES.length; i++) {
      var st = zoneStateAt(ZONES[i], elapsedMs);
      if (st.exists) list.push({ id: ZONES[i].id, x: ZONES[i].x, y: ZONES[i].y, r: st.r });
    }
    return list;
  }
  function zoneForColor(c) { for (var i = 0; i < ZONES.length; i++) if (ZONES[i].kind === 'paint' && ZONES[i].color === c) return ZONES[i]; return null; }
  function zoneForShape(s) { for (var i = 0; i < ZONES.length; i++) if (ZONES[i].kind === 'shape' && ZONES[i].shape === s) return ZONES[i]; return null; }

  // 相鄰區域對(依角度排序後循環相鄰), 供「路過相鄰區域之間」判定
  var ADJ_PAIRS = (function () {
    var sorted = ZONES.slice().sort(function (a, b) { return a.angle - b.angle; });
    var pairs = [];
    for (var i = 0; i < sorted.length; i++) pairs.push([sorted[i], sorted[(i + 1) % sorted.length]]);
    return pairs;
  })();

  // ==================================================================
  // 網的輪替: 條件池 / 抽法(見 spec「網與條件」「網的輪替」)
  // ==================================================================
  function stageConditionInfo(stage) {
    if (stage <= 1) return { colors: [0, 1, 2], shapes: [], shapeProb: 0 };
    if (stage === 2) return { colors: [0, 1, 2, 3], shapes: [], shapeProb: 0 };
    if (stage === 3) return { colors: [0, 1, 2, 3], shapes: ['square'], shapeProb: 0.25 };
    return { colors: [0, 1, 2, 3], shapes: ['square', 'triangle'], shapeProb: 0.40 };
  }
  function sameCondition(a, b) { return a.color === b.color && a.shape === b.shape; }
  function slotDiff(a, b) { var d = Math.abs(a - b); return Math.min(d, 8 - d); }
  function condDiff(a, b) {
    var d = 0;
    if (a.color !== b.color) d++;
    var as = a.shape, bs = b.shape;
    if ((as == null) !== (bs == null)) d++;
    else if (as != null && bs != null && as !== bs) d++;
    return d;
  }
  function wrapSlot(n) { return ((n - 1 + 8) % 8) + 1; }
  function pickNextSlot(prevSlotNo) {
    if (prevSlotNo == null) return 1 + Math.floor(Math.random() * 8);
    var excluded = [prevSlotNo, wrapSlot(prevSlotNo - 1), wrapSlot(prevSlotNo + 1)];
    var candidates = [];
    for (var i = 1; i <= 8; i++) if (excluded.indexOf(i) === -1) candidates.push(i);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  // 依當下階段、保底與「同條件最多連 2 張」規則抽下一組條件
  function rollCondition(g) {
    var info = stageConditionInfo(g.stage);
    var guarantee = g.pendingGuarantee;
    var isPilot = false, forced = null, withShape;
    if (guarantee && guarantee.stage <= g.stage) {
      isPilot = true;
      if (guarantee.kind === 'shape') { withShape = true; forced = { shape: guarantee.value }; }
      else { withShape = info.shapes.length > 0 && Math.random() < info.shapeProb; forced = { color: guarantee.value }; }
    } else {
      withShape = info.shapes.length > 0 && Math.random() < info.shapeProb;
    }
    var pool;
    if (!withShape) pool = info.colors.map(function (c) { return { color: c, shape: null }; });
    else {
      pool = [];
      info.colors.forEach(function (c) { info.shapes.forEach(function (s) { pool.push({ color: c, shape: s }); }); });
    }
    if (forced) {
      pool = pool.filter(function (c) {
        if (forced.color != null) return c.color === forced.color;
        if (forced.shape != null) return c.shape === forced.shape;
        return true;
      });
    }
    var candidateCount = pool.length;
    var picked = pool[Math.floor(Math.random() * pool.length)];
    var excluded = false;
    if (!isPilot && g.recentConditions.length === 2 &&
        sameCondition(g.recentConditions[0], g.recentConditions[1]) &&
        sameCondition(picked, g.recentConditions[1])) {
      var filtered = pool.filter(function (c) { return !sameCondition(c, picked); });
      picked = filtered[Math.floor(Math.random() * filtered.length)];
      excluded = true;
    }
    if (isPilot) g.pendingGuarantee = null;
    return {
      condition: picked, isPilot: isPilot,
      candidateCount: candidateCount,
      candidateCountAfterExclude: excluded ? candidateCount - 1 : candidateCount
    };
  }

  function isProcessable(b) { return b.mode === 'idle'; }
  function isNonDragNonReturn(b) { return b.mode === 'idle' || b.mode === 'hold'; }
  function currentNetCond(g) { return g.netCondition; }
  function compatibleWithNet(b, net) {
    var colorOk = (b.color == null) || (b.color === net.color);
    var shapeOk = (net.shape == null) || (b.shape === 'circle') || (b.shape === net.shape);
    return colorOk && shapeOk;
  }
  function fullyMatchesNet(b, net) {
    var colorOk = b.color === net.color;
    var shapeOk = (net.shape == null) || (b.shape === net.shape);
    return colorOk && shapeOk;
  }
  function satisfiableCount(g) {
    var net = currentNetCond(g);
    return g.bubbles.filter(isProcessable).filter(function (b) { return compatibleWithNet(b, net); }).length;
  }
  function alreadyMatchCount(g) {
    var net = currentNetCond(g);
    return g.bubbles.filter(isNonDragNonReturn).filter(function (b) { return fullyMatchesNet(b, net); }).length;
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
      elapsed: 0,
      stage: 1,
      hp: PARAMS.hpMax,
      score: 0,
      combo: 0,
      hpFlash: 0,
      hpGainFx: 0,
      bubbles: [],
      nextBubbleId: 1,
      spawnTimer: 0,
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
      totals: {
        spawned: 0, captured: 0, expired: 0, bounceCond: 0, bounceOuter: 0, bounceSlotOff: 0, stayInner: 0,
        holdNoDrag: 0, swipeEffective: 0, swipeLocked: 0, mistakeColor: 0, mistakeShape: 0, supply: 0
      },
      // 網狀態
      netSeq: 0, netSlot: null, netCondition: null, netFrom: null,
      netLightT: 1, netAppearedAtElapsed: 0, netApproached: false, netFirstPressDone: false, netAppearRecord: null,
      catchFlash: null, bounceFlash: null,
      recentConditions: [],
      pendingGuarantee: null,
      netAppearList: [], // 供逐局彙整用
      lastFullHpElapsedMs: null,
      firstHpLE2ElapsedMs: null, firstHpLE2Stage: null,
      hpLE2OpenSince: null, hpLE2SecTotal: 0, hpLE2Entries: [],
      firstExpireElapsedMs: null, firstExpireRate: null, firstExpireStage: null,
      captureTimestamps: [],
      hpCurve: [],
      stageChanges: [],
      pendingDeathReasons: [],
      pendingRelPass: [],
      bubbleRec: {},
      spawnSegOf: {},
      done: false,
      deathReasons: []
    };
    // 開局第 0 秒預放 2 顆(彼此不重疊); attemptSpawn 內會排定下一顆(從第 0 秒起算)
    attemptSpawn(g);
    attemptSpawn(g);
    // 開局亮第一張網
    lightNewNet(g);
    return g;
  }

  function fieldCount(g) { return g.bubbles.length; }
  function processableCount(g) { return g.bubbles.filter(isProcessable).length; }
  function nowElapsed(g) { return Math.round(g.elapsed); }
  function currentSpawnRate(g) { return PARAMS.spawnRate0 + PARAMS.spawnRateSlope * (g.elapsed / 1000); }

  function emit(g, type, fields) {
    var rec = { t: nowElapsed(g), gameId: g.id, type: type, stage: stageOf(g.elapsed) };
    for (var k in fields) rec[k] = fields[k];
    g.events.push(rec);
    return rec;
  }

  // ==================================================================
  // 網的輪替執行
  // ==================================================================
  function lightNewNet(g) {
    var prevSlot = g.netSlot;
    var prevCondition = g.netCondition;
    var slot = pickNextSlot(prevSlot);
    var draw = rollCondition(g);
    g.recentConditions.push(draw.condition);
    if (g.recentConditions.length > 2) g.recentConditions.shift();
    g.netSeq = g.netSeq + 1;
    g.netSlot = slot;
    g.netCondition = draw.condition;
    g.netFrom = prevSlot;
    g.netLightT = 0;
    g.netAppearedAtElapsed = g.elapsed;
    g.netApproached = false;
    g.netFirstPressDone = false;

    var slotDef = SLOT_BY_NO[slot];
    var neededZones = [{ attr: 'color', zone: zoneForColor(draw.condition.color) }];
    if (draw.condition.shape) neededZones.push({ attr: 'shape', zone: zoneForShape(draw.condition.shape) });
    var angleDiffs = neededZones.map(function (nz) {
      return { zoneId: nz.zone ? nz.zone.id : null, attr: nz.attr, diffDeg: nz.zone ? angleDiff180(nz.zone.angle, slotDef.angle) : null };
    });

    var rec = emit(g, 'netAppear', {
      netSeq: g.netSeq, slotId: slotDef.id, condition: { color: draw.condition.color, shape: draw.condition.shape },
      slotDiff: prevSlot == null ? null : slotDiff(prevSlot, slot),
      condDiff: prevCondition == null ? null : condDiff(prevCondition, draw.condition),
      isPilot: draw.isPilot,
      candidateSlotCount: prevSlot == null ? 8 : 5,
      candidateConditionCount: draw.candidateCountAfterExclude,
      satisfiedCountAtAppear: alreadyMatchCount(g),
      satisfiableCountAtAppear: satisfiableCount(g),
      countOnFieldAtAppear: fieldCount(g), processableCountAtAppear: processableCount(g),
      anyHeldOrDraggingAtAppear: !!mouse.press,
      zoneSlotAngleDiffs: angleDiffs,
      approachedBeforeFirstPress: null
    });
    g.netAppearRecord = rec;
    g.netAppearList.push(rec);
  }

  // ==================================================================
  // 生成: 一律透明圓; 開局預放 2 顆(第 0 秒); 生成不被內圈容量擋住
  // ==================================================================
  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) { return dist(b.x, b.y, INNER.x, INNER.y) <= INNER.r; });
  }
  function randomPointInInner() {
    var ang = Math.random() * TAU;
    var r = Math.sqrt(Math.random()) * MOVE_R;
    return { x: INNER.x + Math.cos(ang) * r, y: INNER.y + Math.sin(ang) * r };
  }
  function findSpawnPosition(g) {
    var avoidBubbles = bubblesToAvoidForSpawn(g);
    var avoidZones = spawnAvoidZonesAt(g.elapsed);
    var minGapBubble = 2 * BUBBLE_R + PARAMS.spawnGap;
    var tries = [];
    for (var t = 0; t < PARAMS.spawnTries; t++) {
      var pos = randomPointInInner();
      var nearest = Infinity, badZone = false;
      for (var i = 0; i < avoidBubbles.length; i++) { var d = dist(pos.x, pos.y, avoidBubbles[i].x, avoidBubbles[i].y); if (d < nearest) nearest = d; }
      for (var zi = 0; zi < avoidZones.length; zi++) {
        var z = avoidZones[zi];
        if (dist(pos.x, pos.y, z.x, z.y) < z.r + BUBBLE_R + PARAMS.spawnGap) { badZone = true; break; }
      }
      tries.push({ pos: pos, nearest: nearest });
      if (!badZone && (avoidBubbles.length === 0 || nearest >= minGapBubble)) return { pos: pos, forced: false, overlapCount: 0, intersectsZone: false };
    }
    var best = tries[0];
    for (var j = 1; j < tries.length; j++) if (tries[j].nearest > best.nearest) best = tries[j];
    var overlapCount = 0;
    for (var k = 0; k < avoidBubbles.length; k++) if (dist(best.pos.x, best.pos.y, avoidBubbles[k].x, avoidBubbles[k].y) < minGapBubble) overlapCount++;
    var intersectsZone = false;
    for (var z2 = 0; z2 < avoidZones.length; z2++) if (dist(best.pos.x, best.pos.y, avoidZones[z2].x, avoidZones[z2].y) < avoidZones[z2].r + BUBBLE_R) intersectsZone = true;
    return { pos: best.pos, forced: true, overlapCount: overlapCount, intersectsZone: intersectsZone };
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
      grabCount: 0, dragSessionId: 0,
      dragPathLen: 0, dragDistanceTotal: 0, freezeMsTotal: 0,
      dragStartElapsed: null,
      zoneOverlap: {}, dragMinDist: {}, pathHistory: [],
      lastSwipeZoneId: null, lastSwipeElapsed: null,
      dragLastSwipePathLen: null, dragLastSwipeElapsed: null,
      lockedSameCount: 0, lockedDiffCount: 0,
      isSupply: false, isMistake: false,
      mistakeRecords: [], bounceCondRecords: [], supplyRecords: [],
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
      forcedPlacement: found.forced, overlapCountAtPlacement: found.overlapCount,
      intersectsZoneAtForce: found.forced ? found.intersectsZone : null
    });
    scheduleNextSpawn(g);
  }

  // ==================================================================
  // 物理: 碰撞(idle/hold 互相碰撞、被 return 與生效中區域當靜態障礙物; drag 不參與)
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
    if (d < 1e-6) { ang = Math.random() * TAU; d = 0.01; } else { ang = Math.atan2(a.y - b.y, a.x - b.x); }
    var overlap = minD - d;
    var ux = Math.cos(ang), uy = Math.sin(ang);
    if (moveBoth) { a.x += ux * overlap / 2; a.y += uy * overlap / 2; b.x -= ux * overlap / 2; b.y -= uy * overlap / 2; }
    else { a.x += ux * overlap; a.y += uy * overlap; }
  }
  function pushOutOfZone(b, z) {
    var d = dist(b.x, b.y, z.x, z.y);
    var minD = BUBBLE_R + z.r;
    if (d >= minD) return;
    var ang = d < 1e-6 ? Math.random() * TAU : Math.atan2(b.y - z.y, b.x - z.x);
    var push = minD - d;
    b.x += Math.cos(ang) * push;
    b.y += Math.sin(ang) * push;
  }
  function updatePhysics(g, dt, zones) {
    var idle = g.bubbles.filter(function (b) { return b.mode === 'idle' || b.mode === 'hold'; });
    var obstacles = g.bubbles.filter(function (b) { return b.mode === 'return'; });
    var passes = 3;
    for (var p = 0; p < passes; p++) {
      for (var i = 0; i < idle.length; i++) {
        for (var j = i + 1; j < idle.length; j++) resolveOverlap(idle[i], idle[j], true);
        for (var k = 0; k < obstacles.length; k++) resolveOverlap(idle[i], obstacles[k], false);
        for (var zi = 0; zi < zones.length; zi++) pushOutOfZone(idle[i], zones[zi]);
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
  function pointIntersectsAnyZone(x, y, zones) {
    for (var i = 0; i < zones.length; i++) if (dist(x, y, zones[i].x, zones[i].y) < zones[i].r + BUBBLE_R) return true;
    return false;
  }
  var RETURN_ANGLE_TRIES = [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  function pickReturnTarget(g, px, py) {
    var ang0 = (px === INNER.x && py === INNER.y) ? Math.random() * TAU : Math.atan2(py - INNER.y, px - INNER.x);
    var zones = activeZonesAt(g.elapsed);
    for (var i = 0; i < RETURN_ANGLE_TRIES.length; i++) {
      var ang = ang0 + RETURN_ANGLE_TRIES[i] * Math.PI / 180;
      var tx = INNER.x + Math.cos(ang) * MOVE_R, ty = INNER.y + Math.sin(ang) * MOVE_R;
      if (!pointIntersectsAnyZone(tx, ty, zones)) return { x: tx, y: ty };
    }
    return { x: INNER.x + Math.cos(ang0) * MOVE_R, y: INNER.y + Math.sin(ang0) * MOVE_R };
  }
  function startReturn(g, b, fromX, fromY) {
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = pickReturnTarget(g, fromX, fromY);
    b.returnElapsed = 0;
  }

  // ==================================================================
  // 幾何: 移動圓(半徑 BUBBLE_R)掃過固定圓(半徑 z.r)的相交區間
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
  function findInnerCrossing(p0, p1) {
    var d0 = dist(p0.x, p0.y, INNER.x, INNER.y) - INNER.r;
    var d1 = dist(p1.x, p1.y, INNER.x, INNER.y) - INNER.r;
    if (d0 <= 0 && d1 > 0) {
      var t = d0 / (d0 - d1);
      return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    }
    return null;
  }

  // ==================================================================
  // 區域擦過分類(染色/賦形; 每種屬性只沾一次, 不再有覆蓋)
  // ==================================================================
  function applyZoneSwipe(b, zone) {
    var before = { color: b.color, shape: b.shape };
    var result = { before: before };
    if (zone.kind === 'paint') {
      result.attr = 'color';
      if (b.color == null) { b.color = zone.color; result.classification = '生效'; }
      else { result.classification = '已鎖定'; result.lockedSameValue = (before.color === zone.color); }
    } else {
      result.attr = 'shape';
      if (b.shape === 'circle') { b.shape = zone.shape; result.classification = '生效'; }
      else { result.classification = '已鎖定'; result.lockedSameValue = (before.shape === zone.shape); }
    }
    result.after = { color: b.color, shape: b.shape };
    return result;
  }

  function pushPathHistory(b, elapsedMs) {
    b.pathHistory.push({ t: elapsedMs, len: b.dragPathLen });
    var cutoff = elapsedMs - 500;
    while (b.pathHistory.length > 2 && b.pathHistory[0].t < cutoff) b.pathHistory.shift();
  }
  function speedBefore(b, elapsedMs, windowMs) {
    if (!b.pathHistory.length) return null;
    var target = elapsedMs - windowMs;
    var base = b.pathHistory[0];
    for (var i = 0; i < b.pathHistory.length; i++) { if (b.pathHistory[i].t <= target) base = b.pathHistory[i]; else break; }
    var dtSec = (elapsedMs - base.t) / 1000;
    if (dtSec <= 0) return null;
    return (b.dragPathLen - base.len) / dtSec;
  }
  function neededZoneDistance(b, net, attr) {
    var zone = attr === 'color' ? zoneForColor(net.color) : zoneForShape(net.shape);
    if (!zone) return null;
    return Math.max(0, dist(b.x, b.y, zone.x, zone.y) - BUBBLE_R - zone.r);
  }

  function currentStageNum(g) { return stageOf(g.elapsed); }

  // 本幀拖曳路徑(p0->p1)上的區域擦過、路過相鄰區域之間、衝出內圈偵測
  function processDragSegment(g, b, p0, p1, elapsed) {
    var zones = activeZonesAt(elapsed);
    var enters = [];
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
    enters.sort(function (a, bb) { return a.t - bb.t; });
    var globalInPreview = previewInfo(elapsed).inPreview;
    var net = currentNetCond(g);
    for (var e = 0; e < enters.length; e++) {
      var zone = enters[e].zone;
      var px = p0.x + (p1.x - p0.x) * enters[e].t, py = p0.y + (p1.y - p0.y) * enters[e].t;
      var result = applyZoneSwipe(b, zone);
      b.swipeFx = 1;
      b.swipeKind = result.classification === '已鎖定' ? 'locked' : (zone.kind === 'paint' ? 'paint' : 'shape');
      b.lastSwipeZoneId = zone.id; b.lastSwipeElapsed = elapsed;
      b.dragLastSwipePathLen = b.dragPathLen; b.dragLastSwipeElapsed = elapsed;
      var netCares = zone.kind === 'paint' ? true : (net.shape != null);
      var evt = {
        bubbleId: b.id, zoneId: zone.id, zoneKind: zone.kind, enterElapsed: elapsed,
        pathLenSinceDragStart: Math.round(b.dragPathLen),
        beforeColor: result.before.color, beforeShape: result.before.shape,
        afterColor: result.after.color, afterShape: result.after.shape,
        classification: result.classification,
        lockedSameAsExisting: result.classification === '已鎖定' ? result.lockedSameValue : null,
        netCaresThisAttr: netCares, inPreview: globalInPreview
      };
      if (result.classification === '生效') {
        var matches = result.attr === 'color'
          ? (zone.color === net.color ? '網要的' : '網要別色')
          : (net.shape == null ? '網沒列形狀' : (zone.shape === net.shape ? '網要的' : '網要別形'));
        evt.firstAttrMatch = matches;
        g.totals.swipeEffective++;
        if (matches === '網要別色' || matches === '網要別形') {
          b.isMistake = true;
          if (result.attr === 'color') g.totals.mistakeColor++; else g.totals.mistakeShape++;
          evt.mistakeDistanceToNeeded = neededZoneDistance(b, net, result.attr);
        }
      } else {
        g.totals.swipeLocked++;
        if (result.lockedSameValue) b.lockedSameCount++; else b.lockedDiffCount++;
      }
      var rec = emit(g, 'swipe', evt);
      if (result.classification === '生效' && (evt.firstAttrMatch === '網要別色' || evt.firstAttrMatch === '網要別形')) {
        b.mistakeRecords.push({ record: rec, attr: result.attr, atElapsed: elapsed, dragSessionId: b.dragSessionId, netSeqAtMistake: g.netSeq });
      }
    }
    // 路過相鄰區域之間(不論有沒有擦到)
    pushPathHistory(b, elapsed);
    for (var pi = 0; pi < ADJ_PAIRS.length; pi++) {
      var za = ADJ_PAIRS[pi][0], zb = ADJ_PAIRS[pi][1];
      var sa = zoneStateAt(za, elapsed), sb = zoneStateAt(zb, elapsed);
      if (!(sa.exists && sa.active && sb.exists && sb.active)) continue;
      var hit = segSegIntersect(p0, p1, { x: za.x, y: za.y }, { x: zb.x, y: zb.y });
      if (!hit) continue;
      var len = dist(za.x, za.y, zb.x, zb.y);
      var lateral = (hit.s - 0.5) * len; // 正 = 偏向 zb
      var beforeSpeed = speedBefore(b, elapsed, PARAMS.relPassWindowMs);
      var touchedEither = !!(b.zoneOverlap[za.id] || b.zoneOverlap[zb.id]);
      var relRec = emit(g, 'relPass', {
        bubbleId: b.id, zoneAId: za.id, zoneBId: zb.id, lateralOffset: lateral,
        touchedEither: touchedEither, beforeSpeed: beforeSpeed, afterSpeed: null, speedRatio: null
      });
      g.pendingRelPass.push({ bubbleId: b.id, record: relRec, crossElapsed: elapsed, crossPathLen: b.dragPathLen, beforeSpeed: beforeSpeed });
    }
    // 衝出內圈(可能一次拖曳多次)
    var crossOut = findInnerCrossing(p0, p1);
    if (crossOut) {
      emit(g, 'exitInner', {
        bubbleId: b.id, angleDeg: angleOf(crossOut.x, crossOut.y), litSlot: g.netSlot,
        lastSwipeZoneId: b.lastSwipeZoneId, lastSwipeElapsed: b.lastSwipeElapsed,
        alreadySatisfied: fullyMatchesNet(b, net)
      });
    }
  }
  function finalizePendingRelPass(g) {
    var elapsed = g.elapsed;
    g.pendingRelPass = g.pendingRelPass.filter(function (item) {
      var b = findBubbleById(g, item.bubbleId);
      var dtMs = elapsed - item.crossElapsed;
      var stillDragging = b && mouse.press && mouse.press.bubbleId === item.bubbleId && mouse.press.dragging;
      if (dtMs >= PARAMS.relPassWindowMs || !stillDragging) {
        if (b && dtMs > 0) {
          var after = (b.dragPathLen - item.crossPathLen) / (dtMs / 1000);
          item.record.afterSpeed = after;
          item.record.speedRatio = (item.beforeSpeed && item.beforeSpeed > 1e-6) ? (after / item.beforeSpeed) : null;
        }
        return false;
      }
      return true;
    });
  }

  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }
  function countGrabsSince(g, bubbleId, sinceElapsed) {
    var n = 0;
    for (var i = 0; i < g.events.length; i++) { var e = g.events[i]; if (e.type === 'grab' && e.bubbleId === bubbleId && e.t > sinceElapsed) n++; }
    return n;
  }
  function hasEffectiveSwipeAfter(g, bubbleId, sinceElapsed) {
    for (var i = 0; i < g.events.length; i++) { var e = g.events[i]; if (e.type === 'swipe' && e.bubbleId === bubbleId && e.t > sinceElapsed && e.classification === '生效') return true; }
    return false;
  }
  function findDragEndForSession(g, bubbleId, sessionId) {
    for (var i = g.events.length - 1; i >= 0; i--) {
      var e = g.events[i];
      if (e.type === 'dragEnd' && e.bubbleId === bubbleId && e.dragSessionId === sessionId) return e;
    }
    return null;
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
    if (g.hp >= PARAMS.hpMax) return false;
    g.hp = Math.min(PARAMS.hpMax, g.hp + 1);
    g.hpGainFx = 1;
    if (g.hp > PARAMS.hpLE2Threshold && g.hpLE2OpenSince != null) {
      var entry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      entry.durationSec = (nowElapsed(g) - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += entry.durationSec;
      g.hpLE2OpenSince = null;
    }
    emit(g, 'hpChange', { reason: 'capture', hp: g.hp, countOnField: fieldCount(g) });
    return true;
  }
  function checkDeath(g) {
    if (!g.done && g.hp <= 0 && g.pendingDeathReasons.length > 0) { g.done = true; endGame('hpZero'); }
  }
  function scoreForCombo(combo) {
    var bonus = Math.min(combo - 1, PARAMS.comboStreakCap) * PARAMS.comboBonusPerStreak;
    return Math.round(PARAMS.scoreBase * (1 + bonus));
  }

  // ==================================================================
  // 移除 / 終結一顆氣泡的收尾(沾錯回填 / 條件不符彈回回填 / 備料回填)
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }
  function finalizeBubble(g, b, outcome, captureSnap) {
    var elapsed = nowElapsed(g);
    var rec = g.bubbleRec[b.id];
    if (rec) { rec.outcome = outcome; rec.outcomeElapsed = elapsed; }
    b.mistakeRecords.forEach(function (m) {
      var dragEndRec = findDragEndForSession(g, b.id, m.dragSessionId);
      m.record.mistakeFollowUp = {
        fate: outcome,
        dragEndReason: dragEndRec ? dragEndRec.reason : null,
        captureNetSeq: captureSnap ? captureSnap.netSeq : null,
        captureCondition: captureSnap ? captureSnap.condition : null,
        timeToCaptureMs: outcome === 'captured' ? (elapsed - m.atElapsed) : null,
        netsPassedUntilCapture: outcome === 'captured' ? (g.netSeq - m.netSeqAtMistake) : null,
        dragsAfter: countGrabsSince(g, b.id, m.atElapsed)
      };
    });
    b.bounceCondRecords.forEach(function (r) {
      r.laterCaptured = (outcome === 'captured');
      r.timeToCaptureMs = outcome === 'captured' ? (elapsed - r.t) : null;
      r.dragsAfter = countGrabsSince(g, b.id, r.t);
    });
    b.supplyRecords.forEach(function (r) {
      var fate;
      if (outcome === 'captured') fate = '被捕捉';
      else if (outcome === 'expired') fate = '過期';
      else fate = hasEffectiveSwipeAfter(g, b.id, r.t) ? '又被拖去賦形或染色' : '局結束殘留';
      r.supplyFollowUp = {
        fate: fate,
        captureNetSeq: outcome === 'captured' ? captureSnap.netSeq : null,
        captureCondition: outcome === 'captured' ? captureSnap.condition : null,
        timeToCaptureMs: outcome === 'captured' ? (elapsed - r.t) : null,
        netsPassedUntilCapture: outcome === 'captured' ? (g.netSeq - r.netSeqAtSupply) : null
      };
    });
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    finalizeBubble(g, b, 'expired', null);
    var snap = { id: b.id, color: b.color, shape: b.shape, isSupply: b.isSupply, isMistake: b.isMistake, grabCount: b.grabCount };
    removeBubble(g, b);
    emit(g, 'expire', {
      bubbleId: snap.id, color: snap.color, shape: snap.shape, isSupply: snap.isSupply, isMistake: snap.isMistake,
      grabCount: snap.grabCount, countOnField: fieldCount(g), processableCount: processableCount(g),
      netMatchAtExpire: fullyMatchesNet({ color: snap.color, shape: snap.shape }, currentNetCond(g))
    });
    g.totals.expired++;
    if (g.firstExpireElapsedMs == null) { g.firstExpireElapsedMs = nowElapsed(g); g.firstExpireRate = currentSpawnRate(g); g.firstExpireStage = stageOf(g.elapsed); }
    loseHp(g, 'expire');
  }

  // ==================================================================
  // 放下位置分類 / 捕捉判定
  // ==================================================================
  function isOnUiRegion(px, py) { return inRect(px, py, L.hudLeft) || inRect(px, py, L.hudRight) || inRect(px, py, L.pauseButton); }
  function slotAt(px, py) {
    for (var i = 0; i < SLOTS.length; i++) if (dist(px, py, SLOTS[i].x, SLOTS[i].y) <= NET_R) return SLOTS[i];
    return null;
  }
  function litNetCenter(g) { return SLOT_BY_NO[g.netSlot]; }

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
      bubbleId: b.id, dragSessionId: b.dragSessionId, reason: reason,
      pathLength: Math.round(b.dragPathLen), durationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
      lockedSameCountThisDrag: null, lockedDiffCountThisDrag: null,
      nearestEdgeDistanceByZone: nearestByZone
    });
  }

  function resolveRelease(g, b, px, py, reason) {
    var elapsed = nowElapsed(g);
    b.dragDistanceTotal += b.dragPathLen;
    emitDragEnd(g, b, reason);
    var inPreview = previewInfo(g.elapsed).inPreview;
    var net = currentNetCond(g);
    var onUi = isOnUiRegion(px, py);
    var category, outcome;
    var slotHit = onUi ? null : slotAt(px, py);
    var colorMatch = null, shapeMatch = '不比對';
    var captureExtra = null;
    var isSupplyThisDrop = false;
    if (!onUi && slotHit && slotHit.no === g.netSlot) {
      category = 'net';
      colorMatch = (b.color === net.color);
      shapeMatch = (net.shape == null) ? '不比對' : (b.shape === net.shape);
      var allOk = colorMatch && (net.shape == null || shapeMatch === true);
      if (allOk) {
        outcome = 'captured';
        var newCombo = g.combo + 1;
        var pts = scoreForCombo(newCombo);
        g.score += pts; g.combo = newCombo;
        var hpBefore = g.hp;
        var conditionCount = net.shape != null ? 2 : 1;
        var captureSnap = { netSeq: g.netSeq, condition: { color: net.color, shape: net.shape } };
        finalizeBubble(g, b, 'captured', captureSnap);
        g.captureTimestamps.push(elapsed);
        g.totals.captured++;
        captureExtra = {
          netSeq: g.netSeq, slotId: SLOT_BY_NO[g.netSlot].id, conditionCount: conditionCount,
          netInFieldMs: elapsed - g.netAppearedAtElapsed, hpBefore: hpBefore,
          processingMs: elapsed - b.spawnElapsed, processingMsExFreeze: elapsed - b.spawnElapsed - b.freezeMsTotal,
          grabCount: b.grabCount, pathLength: Math.round(b.dragDistanceTotal),
          lockedSameCount: b.lockedSameCount, lockedDiffCount: b.lockedDiffCount,
          isSupply: b.isSupply, isMistake: b.isMistake, spawnStage: b.spawnStage, inPreview: inPreview, points: pts
        };
        removeBubble(g, b);
        g.catchFlash = { slotNo: g.netSlot, t: 0 };
        var gained = gainHp(g);
        captureExtra.hpGained = gained;
        lightNewNet(g);
      } else {
        outcome = 'bounceCond';
        g.totals.bounceCond++;
        g.combo = 0;
        startReturn(g, b, px, py);
        g.bounceFlash = { t: 0 };
      }
    } else if (!onUi && slotHit) {
      category = 'slotOff';
      outcome = 'bounceOuter';
      g.totals.bounceSlotOff++;
      g.totals.bounceOuter++;
      startReturn(g, b, px, py);
    } else {
      var dToCenter = dist(px, py, INNER.x, INNER.y);
      if (!onUi && dToCenter <= INNER.r) {
        category = 'inner';
        outcome = 'stayInner';
        g.totals.stayInner++;
        b.mode = 'idle'; b.x = px; b.y = py; clampToCircle(b);
        if (b.color != null || b.shape !== 'circle') {
          isSupplyThisDrop = true;
          b.isSupply = true;
          g.totals.supply++;
        }
      } else {
        category = 'other';
        outcome = 'bounceOuter';
        g.totals.bounceOuter++;
        startReturn(g, b, px, py);
      }
    }
    var lastSwipeGapLen = null, lastSwipeGapMs = null;
    if (b.dragLastSwipeElapsed != null) {
      lastSwipeGapLen = Math.round(b.dragPathLen - b.dragLastSwipePathLen);
      lastSwipeGapMs = elapsed - b.dragLastSwipeElapsed;
    }
    var distToLitNetCenter = dist(px, py, litNetCenter(g).x, litNetCenter(g).y);
    var netSeqForEvt = (outcome === 'captured') ? captureExtra.netSeq : g.netSeq;
    var evt = {
      bubbleId: b.id, category: category, slotId: (category === 'slotOff' && slotHit) ? slotHit.id : null,
      color: b.color, shape: b.shape,
      netSeq: netSeqForEvt,
      netCondition: { color: net.color, shape: net.shape },
      colorMatch: colorMatch, shapeMatch: shapeMatch,
      outcome: outcome, isSupply: isSupplyThisDrop,
      x: px, y: py, distanceToLitNetCenter: distToLitNetCenter,
      dragDurationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
      dragDistance: Math.round(b.dragDistanceTotal),
      lastSwipeToDropPathLen: lastSwipeGapLen, lastSwipeToDropMs: lastSwipeGapMs,
      countOnField: fieldCount(g), inPreview: inPreview
    };
    if (captureExtra) for (var k in captureExtra) evt[k] = captureExtra[k];
    var dropRec = emit(g, 'drop', evt);
    if (outcome === 'bounceCond') b.bounceCondRecords.push(dropRec);
    if (isSupplyThisDrop) { dropRec.netSeqAtSupply = g.netSeq; b.supplyRecords.push(dropRec); }
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
      var net = currentNetCond(g);
      startReturn(g, b, px, py);
      g.totals.bounceOuter++;
      var evt = {
        bubbleId: b.id, category: 'other', slotId: null, color: b.color, shape: b.shape,
        netSeq: g.netSeq, netCondition: { color: net.color, shape: net.shape },
        colorMatch: null, shapeMatch: '不比對', outcome: 'bounceOuter', isSupply: false,
        x: px, y: py, distanceToLitNetCenter: dist(px, py, litNetCenter(g).x, litNetCenter(g).y),
        dragDurationMs: elapsed - (b.dragStartElapsed == null ? elapsed : b.dragStartElapsed),
        dragDistance: Math.round(b.dragDistanceTotal),
        lastSwipeToDropPathLen: null, lastSwipeToDropMs: null,
        countOnField: fieldCount(g), inPreview: previewInfo(g.elapsed).inPreview
      };
      emit(g, 'drop', evt);
      g.lastDropElapsed = elapsed;
      g.lastDropProcessableCount = processableCount(g);
      mouse.netSeqAtLastDrop = g.netSeq;
      mouse.pathLenSinceLastDrop = 0;
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
  // 階段切換偵測(見規則「同一幀的處理順序」步驟 1)
  // ==================================================================
  function checkStageTransitions(g, prevElapsed, newElapsed) {
    for (var i = 1; i < STAGE_MS.length; i++) {
      if (prevElapsed < STAGE_MS[i] && newElapsed >= STAGE_MS[i]) {
        var newStage = i + 1;
        g.stage = newStage;
        var isShrinkStage = newStage === SHRINK_STAGE;
        var newZones = isShrinkStage ? [] : ZONES.filter(function (z) { return z.stage === newStage; });
        var shrinkList = isShrinkStage ? ZONES.map(function (z) { return { id: z.id, from: L.zoneR, to: L.zoneRSmall }; }) : [];
        var hadPending = g.pendingGuarantee;
        if (newStage === 2) g.pendingGuarantee = { stage: 2, kind: 'color', value: 3 };
        else if (newStage === 3) g.pendingGuarantee = { stage: 3, kind: 'shape', value: 'square' };
        else if (newStage === 4) g.pendingGuarantee = { stage: 4, kind: 'shape', value: 'triangle' };
        // 階段 5: 不設也不清除保底
        var discardedPending = (newStage !== SHRINK_STAGE && hadPending != null) ? hadPending : null;

        var dragBubble = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
        var anyHeldOrDragging = !!mouse.press;
        var alreadyIntersecting = [];
        var zonesToMark = isShrinkStage ? ZONES : newZones;
        zonesToMark.forEach(function (z) {
          if (!dragBubble) return;
          var st = zoneStateAt(z, newElapsed);
          if (!st.exists || !st.active) return;
          var d = dist(dragBubble.x, dragBubble.y, z.x, z.y);
          var overlap = d <= (BUBBLE_R + st.r);
          dragBubble.zoneOverlap[z.id] = overlap;
          dragBubble.dragMinDist[z.id] = d;
          if (overlap) alreadyIntersecting.push(z.id);
        });
        var bubblesSnapshot = g.bubbles.map(function (b2) { return { id: b2.id, color: b2.color, shape: b2.shape }; });
        emit(g, 'stageChange', {
          previewStart: STAGE_MS[i] - PARAMS.previewMs, effectiveT: STAGE_MS[i], newStage: newStage,
          newZones: newZones.map(function (z) { return { id: z.id, kind: z.kind }; }),
          shrinkZones: shrinkList,
          conditionPoolSize: stageConditionInfo(newStage).colors.length * (stageConditionInfo(newStage).shapes.length ? (stageConditionInfo(newStage).shapes.length + 1) : 1),
          shapeProb: stageConditionInfo(newStage).shapeProb,
          litNetSeqAtEffective: g.netSeq, litNetConditionAtEffective: g.netCondition ? { color: g.netCondition.color, shape: g.netCondition.shape } : null,
          bubblesAtEffective: bubblesSnapshot,
          anyHeldOrDragging: anyHeldOrDragging, draggingBubbleId: dragBubble ? dragBubble.id : null,
          alreadyIntersectingZones: alreadyIntersecting,
          discardedPendingGuarantee: discardedPending, keptPendingGuarantee: g.pendingGuarantee
        });
        g.stageChanges.push({ stage: newStage, previewStart: STAGE_MS[i] - PARAMS.previewMs, effectiveT: STAGE_MS[i] });
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
      anyHoldOrDrag: !!(mouse.press), processableCount: processableCount(g),
      satisfiableCount: satisfiableCount(g), litNetSeq: g.netSeq, litSlot: g.netSlot, hp: g.hp
    });
  }

  function tick(dt) {
    var g = game;
    var prevElapsed = g.elapsed;
    g.elapsed += dt * 1000;
    g.pendingDeathReasons = [];

    checkStageTransitions(g, prevElapsed, g.elapsed);

    g.spawnTimer -= dt;
    var guardSpawn = 0;
    while (g.spawnTimer <= 0 && guardSpawn < 20) { attemptSpawn(g); guardSpawn++; }

    var zones = activeZonesAt(g.elapsed);
    updatePhysics(g, dt, zones);

    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb = g.bubbles[fi];
      if (fb.mode === 'hold' || fb.mode === 'drag') fb.freezeMsTotal += dt * 1000;
    }

    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'hold' || b.mode === 'drag') continue;
      b.life -= dt;
      if (b.life <= 0) expireBubble(g, b);
    }

    for (var bi = 0; bi < g.bubbles.length; bi++) {
      var bb = g.bubbles[bi];
      if (bb.swipeFx > 0) bb.swipeFx = Math.max(0, bb.swipeFx - dt / PARAMS.swipeFxDurationS);
    }
    if (g.hpFlash > 0) g.hpFlash = Math.max(0, g.hpFlash - dt / PARAMS.hpFlashDurationS);
    if (g.hpGainFx > 0) g.hpGainFx = Math.max(0, g.hpGainFx - dt / PARAMS.hpGainFxDurationS);
    if (g.netLightT < 1) g.netLightT = Math.min(1, g.netLightT + dt / PARAMS.netLightDurationS);
    if (g.catchFlash) { g.catchFlash.t += dt / PARAMS.flashDurationS; if (g.catchFlash.t >= 1) g.catchFlash = null; }
    if (g.bounceFlash) { g.bounceFlash.t += dt / PARAMS.flashDurationS; if (g.bounceFlash.t >= 1) g.bounceFlash = null; }

    finalizePendingRelPass(g);

    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));

    g.sampleAcc += dt;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleInterval && guard < 10) { g.sampleAcc -= PARAMS.sampleInterval; emitSample(g); guard++; }

    checkDeath(g);
  }

  // ==================================================================
  // 局末彙整
  // ==================================================================
  function segIndex(t) { return Math.floor(t / PARAMS.segmentMs); }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }

  function computeSummary(g) {
    var events = g.events;
    var spawns = byType(events, 'spawn');
    var drops = byType(events, 'drop');
    var expires = byType(events, 'expire');
    var swipes = byType(events, 'swipe');
    var relPasses = byType(events, 'relPass');
    var netAppears = byType(events, 'netAppear');
    var samples = byType(events, 'sample');
    var presses = byType(events, 'press');
    var pauses = byType(events, 'pause');

    var captureDrops = drops.filter(function (d) { return d.outcome === 'captured'; });
    var bounceCondDrops = drops.filter(function (d) { return d.outcome === 'bounceCond'; });
    var bounceOuterDrops = drops.filter(function (d) { return d.outcome === 'bounceOuter'; });
    var stayInnerDrops = drops.filter(function (d) { return d.outcome === 'stayInner'; });
    var slotOffDrops = drops.filter(function (d) { return d.category === 'slotOff'; });
    var effectiveSwipes = swipes.filter(function (s) { return s.classification === '生效'; });
    var lockedSwipes = swipes.filter(function (s) { return s.classification === '已鎖定'; });
    var mistakeSwipes = effectiveSwipes.filter(function (s) { return s.firstAttrMatch === '網要別色' || s.firstAttrMatch === '網要別形'; });
    var mistakeColorSwipes = mistakeSwipes.filter(function (s) { return s.firstAttrMatch === '網要別色'; });
    var mistakeShapeSwipes = mistakeSwipes.filter(function (s) { return s.firstAttrMatch === '網要別形'; });

    var durationSec = g.elapsed / 1000;
    var segCount = Math.max(1, segIndex(g.elapsed) + 1);

    var stageIds = [1, 2, 3, 4, 5];
    var stageBoundsMs = STAGE_MS.concat([Infinity]);
    var stageStats = stageIds.map(function (s) {
      var startMs = stageBoundsMs[s - 1], endMs = stageBoundsMs[s];
      var dwellMs = Math.max(0, Math.min(g.elapsed, endMs) - startMs);
      var spawnedIds = Object.keys(g.bubbleRec).filter(function (id) { return g.bubbleRec[id].spawnStage === s; });
      var stageCaptures = captureDrops.filter(function (d) { return d.stage === s; });
      var stageExpires = expires.filter(function (d) { return d.stage === s; });
      var stageBounceCond = bounceCondDrops.filter(function (d) { return d.stage === s; });
      var stageSlotOff = slotOffDrops.filter(function (d) { return d.stage === s; });
      var stageDrops = drops.filter(function (d) { return d.stage === s; });
      var stageStayInner = stayInnerDrops.filter(function (d) { return d.stage === s; });
      var stageSwipes = swipes.filter(function (d) { return d.stage === s; });
      var stageEffective = stageSwipes.filter(function (d) { return d.classification === '生效'; });
      var stageLocked = stageSwipes.filter(function (d) { return d.classification === '已鎖定'; });
      var stageMistakeColor = stageEffective.filter(function (d) { return d.firstAttrMatch === '網要別色'; });
      var stageMistakeShape = stageEffective.filter(function (d) { return d.firstAttrMatch === '網要別形'; });
      return {
        stage: s, dwellSec: dwellMs / 1000,
        spawnCount: spawnedIds.length, captureCount: stageCaptures.length, expireCount: stageExpires.length,
        bounceCondCount: stageBounceCond.length, slotOffCount: stageSlotOff.length,
        dropTotalCount: stageDrops.length, stayInnerCount: stageStayInner.length,
        avgProcessingMs: avgOf(stageCaptures.map(function (d) { return d.processingMs; })),
        avgPathLength: avgOf(stageCaptures.map(function (d) { return d.pathLength; })),
        effectiveSwipeCount: stageEffective.length,
        mistakeColorCount: stageMistakeColor.length, mistakeShapeCount: stageMistakeShape.length,
        lockedSameCount: stageLocked.filter(function (d) { return d.lockedSameAsExisting === true; }).length,
        lockedDiffCount: stageLocked.filter(function (d) { return d.lockedSameAsExisting === false; }).length
      };
    });

    var slotCaptureCounts = {}, slotNetInFieldMs = {};
    for (var sn = 1; sn <= 8; sn++) { slotCaptureCounts[sn] = 0; slotNetInFieldMs[sn] = []; }
    captureDrops.forEach(function (d) {
      var no = null;
      SLOTS.forEach(function (s) { if (s.id === d.slotId) no = s.no; });
      if (no == null && d.netSeq != null) {
        var na = netAppears.filter(function (n) { return n.netSeq === d.netSeq; })[0];
        if (na) SLOTS.forEach(function (s) { if (s.id === na.slotId) no = s.no; });
      }
      if (no != null) { slotCaptureCounts[no] = (slotCaptureCounts[no] || 0) + 1; slotNetInFieldMs[no].push(d.netInFieldMs); }
    });
    var netInFieldBySlotDiff = { 2: [], 3: [], 4: [] };
    var netInFieldByCondCount = { 1: [], 2: [] };
    netAppears.forEach(function (na) {
      var captured = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0];
      if (!captured) return;
      if (na.slotDiff != null && netInFieldBySlotDiff[na.slotDiff]) netInFieldBySlotDiff[na.slotDiff].push(captured.netInFieldMs);
      var cc = na.condition && na.condition.shape != null ? 2 : 1;
      netInFieldByCondCount[cc].push(captured.netInFieldMs);
    });

    var firstThreeAfterStageChange = g.stageChanges.map(function (sc) {
      var relevantNets = netAppears.filter(function (na) { return na.t >= sc.effectiveT; }).slice(0, 3);
      return {
        stage: sc.stage,
        netInFieldMs: relevantNets.map(function (na) {
          var cap = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0];
          return cap ? cap.netInFieldMs : null;
        })
      };
    });

    function busyRateFor(sampleSubset, captureSubset) {
      var busySecSet = {}; var busySec = 0;
      sampleSubset.forEach(function (s) { if (s.processableCount >= 2) { busySecSet[Math.floor(s.t / 1000)] = true; busySec++; } });
      var busyCaptures = captureSubset.filter(function (d) { return busySecSet[Math.floor(d.t / 1000)]; }).length;
      return { busySeconds: busySec, rate: ratio(busyCaptures, busySec) };
    }
    var backlogGlobal = busyRateFor(samples, captureDrops);
    var backlogByStage = {};
    stageIds.forEach(function (s) { backlogByStage[s] = busyRateFor(samples.filter(function (sm) { return sm.stage === s; }), captureDrops.filter(function (d) { return d.stage === s; })); });

    var deathBy10s = null;
    if (g.deathReasons.indexOf('expire') !== -1) {
      deathBy10s = [];
      for (var w = 6; w >= 1; w--) {
        var winEnd = g.elapsed - (w - 1) * 10000, winStart = g.elapsed - w * 10000;
        var wc = captureDrops.filter(function (d) { return d.t >= winStart && d.t < winEnd; }).length;
        var wsamples = samples.filter(function (s) { return s.t >= winStart && s.t < winEnd; });
        deathBy10s.push({ startMs: Math.max(0, winStart), endMs: Math.max(0, winEnd), captureCount: wc, avgOnField: avgOf(wsamples.map(function (s) { return s.countOnField; })) });
      }
    }

    if (g.hpLE2OpenSince != null) {
      var tail = (g.elapsed - g.hpLE2OpenSince) / 1000;
      g.hpLE2SecTotal += tail;
      var lastEntry = g.hpLE2Entries[g.hpLE2Entries.length - 1];
      if (lastEntry && lastEntry.durationSec == null) lastEntry.durationSec = tail;
      g.hpLE2OpenSince = null;
    }
    var hpLE2Ratio = durationSec > 0 ? g.hpLE2SecTotal / durationSec : null;

    var longestGap = null;
    if (spawns.length) {
      var boundary = Math.max(spawns[0].t, g.elapsed - 30000);
      var capTimes = g.captureTimestamps.filter(function (t) { return t <= boundary; }).slice().sort(function (a, b) { return a - b; });
      var marks = [spawns[0].t].concat(capTimes, [boundary]);
      for (var mi = 0; mi < marks.length - 1; mi++) {
        var a0 = marks[mi], b0 = marks[mi + 1];
        if (b0 <= a0) continue;
        var handFreeSec = 0, handFreeAndSatisfiableSec = 0, maxField = 0;
        samples.forEach(function (sm) {
          if (sm.t >= a0 && sm.t < b0) {
            if (!sm.anyHoldOrDrag) handFreeSec++;
            if (!sm.anyHoldOrDrag && sm.satisfiableCount >= 1) handFreeAndSatisfiableSec++;
            maxField = Math.max(maxField, sm.countOnField);
          }
        });
        var durSec = (b0 - a0) / 1000;
        if (!longestGap || durSec > longestGap.durationSec) longestGap = { startMs: a0, endMs: b0, durationSec: durSec, handFreeSec: handFreeSec, handFreeAndSatisfiableSec: handFreeAndSatisfiableSec, maxFieldCount: maxField };
      }
    }

    function idleRatios(subsetSamples) {
      var zero = subsetSamples.filter(function (s) { return !s.anyHoldOrDrag && s.satisfiableCount === 0; }).length;
      var atLeastOne = subsetSamples.filter(function (s) { return !s.anyHoldOrDrag && s.satisfiableCount >= 1; }).length;
      return { zeroRatio: ratio(zero, subsetSamples.length), atLeastOneRatio: ratio(atLeastOne, subsetSamples.length) };
    }
    var samples0to60 = samples.filter(function (s) { return s.t < 60000; });
    var samplesAfter60 = samples.filter(function (s) { return s.t >= 60000; });
    var idle0to60 = idleRatios(samples0to60), idleAfter60 = idleRatios(samplesAfter60);

    var dropToNextPress = [];
    presses.forEach(function (pr) {
      if (pr.intervalSinceLastDropMs != null) {
        dropToNextPress.push({ ms: pr.intervalSinceLastDropMs, processableAtLastDrop: pr.processableAtLastDrop, netChangedDuring: pr.netChangedSinceLastDrop, pathLen: pr.pathLenSinceLastDrop });
      }
    });
    // 放下到局結束都沒再按下的, 記「局結束」(由 drops 反推: 找最後一筆 drop 之後沒有對應 press)
    var lastDrop = drops.length ? drops[drops.length - 1] : null;
    var lastPress = presses.length ? presses[presses.length - 1] : null;
    var noMorePress = lastDrop && (!lastPress || lastPress.t < lastDrop.t);

    var segments = [];
    for (var s = 0; s < segCount; s++) {
      var segStart = s * PARAMS.segmentMs, segEnd = segStart + PARAMS.segmentMs;
      var within = function (a, b2) { return function (t) { return t >= a && t < b2; }; }(segStart, segEnd);
      var segSpawn = spawns.filter(function (e) { return within(e.t); }).length;
      var segCap = captureDrops.filter(function (e) { return within(e.t); }).length;
      var segExp = expires.filter(function (e) { return within(e.t); }).length;
      var segBounce = bounceCondDrops.filter(function (e) { return within(e.t); }).length;
      var segMistake = mistakeSwipes.filter(function (e) { return within(e.t); }).length;
      var segSupply = drops.filter(function (e) { return within(e.t) && e.isSupply; }).length;
      var segNets = netAppears.filter(function (e) { return within(e.t); });
      var segNetCaptured = segNets.map(function (na) { var c = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return c ? c.netInFieldMs : null; }).filter(function (v) { return v != null; });
      segments.push({ index: s, startMs: segStart, endMs: segEnd, spawnCount: segSpawn, captureCount: segCap, expireCount: segExp, bounceCondCount: segBounce, mistakeCount: segMistake, supplyCount: segSupply, avgNetInFieldMs: avgOf(segNetCaptured) });
    }
    var spawnBatchOutcome = segments.map(function (sg) {
      var ids = Object.keys(g.bubbleRec).filter(function (id) { return Math.floor(g.bubbleRec[id].spawnElapsed / PARAMS.segmentMs) === sg.index; });
      var captured = 0, expired = 0, residual = 0;
      ids.forEach(function (id) {
        var out = g.bubbleRec[id].outcome;
        if (out === 'captured') captured++; else if (out === 'expired') expired++; else residual++;
      });
      return { index: sg.index, spawnCount: ids.length, captured: captured, expired: expired, residual: residual, captureRate: ratio(captured, ids.length) };
    });

    var captureIntervals = [];
    for (var ci = 1; ci < g.captureTimestamps.length; ci++) captureIntervals.push(g.captureTimestamps[ci] - g.captureTimestamps[ci - 1]);
    var indicator3 = { medianMs: median(captureIntervals), p90Ms: p90(captureIntervals), maxMs: maxOf(captureIntervals) };

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
      }
      return res;
    });

    var indicator1ByStage = stageIds.map(function (s) {
      var stNets = netAppears.filter(function (na) { return na.stage === s && na.satisfiableCountAtAppear >= 1; });
      var msList = stNets.map(function (na) { var c = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return c ? c.netInFieldMs : null; }).filter(function (v) { return v != null; });
      return { stage: s, medianMs: median(msList), p90Ms: p90(msList), count: msList.length };
    });
    var allQualNets = netAppears.filter(function (na) { return na.satisfiableCountAtAppear >= 1; });
    var allQualMs = allQualNets.map(function (na) { var c = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return c ? c.netInFieldMs : null; }).filter(function (v) { return v != null; });
    var oneCondMs = allQualNets.filter(function (na) { return na.condition.shape == null; }).map(function (na) { var c = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return c ? c.netInFieldMs : null; }).filter(function (v) { return v != null; });
    var twoCondMs = allQualNets.filter(function (na) { return na.condition.shape != null; }).map(function (na) { var c = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return c ? c.netInFieldMs : null; }).filter(function (v) { return v != null; });
    var indicator1 = {
      oneCondMedianMs: median(oneCondMs), twoCondMedianMs: median(twoCondMs),
      p90OverMedian: (median(allQualMs) > 0 ? p90(allQualMs) / median(allQualMs) : null),
      stage1MedianMs: indicator1ByStage[0].medianMs, stage4MedianMs: indicator1ByStage[3].medianMs,
      slotDiff4MedianMs: median(netInFieldBySlotDiff[4]), slotDiff2MedianMs: median(netInFieldBySlotDiff[2]),
      byStage: indicator1ByStage
    };
    var indicator2 = { firstElapsedMs: g.firstHpLE2ElapsedMs, firstStage: g.firstHpLE2Stage, ratio: hpLE2Ratio, firstRatioOfDuration: durationSec > 0 && g.firstHpLE2ElapsedMs != null ? (g.firstHpLE2ElapsedMs / 1000) / durationSec : null };
    var indicator4 = {
      bounceCondRate: ratio(bounceCondDrops.length, captureDrops.length + bounceCondDrops.length),
      slotOffRate: ratio(slotOffDrops.length, drops.length)
    };
    var indicator6 = {
      mistakeColorRate: ratio(mistakeColorSwipes.length, effectiveSwipes.filter(function (s) { return s.zoneKind === 'paint'; }).length),
      mistakeShapeRate: ratio(mistakeShapeSwipes.length, effectiveSwipes.filter(function (s) { return s.zoneKind === 'shape'; }).length)
    };
    var lastFullHpToDeathSec = g.lastFullHpElapsedMs == null ? null : (g.elapsed - g.lastFullHpElapsedMs) / 1000;
    var mainIndicators = {
      indicator1_netInFieldTime: indicator1,
      indicator2_hpLE2: indicator2,
      indicator3_longestNoCaptureGap: indicator3,
      indicator4_bounceCond: indicator4,
      indicator5_hpLE2AndDeath: { ratio: hpLE2Ratio, firstEnterRatio: indicator2.firstRatioOfDuration, lastFullHpToDeathSec: lastFullHpToDeathSec },
      indicator6_mistakeRate: indicator6
    };

    var maxStageReached = stageOf(g.elapsed);
    var pauseSecTotal = pauses.reduce(function (a, p) { return a + (p.endRealMs != null ? (p.endRealMs - p.startRealMs) : 0); }, 0);

    var supplyDrops = drops.filter(function (d) { return d.isSupply; });
    var supplyByStage = {};
    stageIds.forEach(function (s) { supplyByStage[s] = supplyDrops.filter(function (d) { return d.stage === s; }).length; });
    var supplyCaptured = captureDrops.filter(function (d) { return d.isSupply; });
    var relPassByPair = {};
    relPasses.forEach(function (rp) {
      var key = rp.zoneAId + '-' + rp.zoneBId;
      relPassByPair[key] = relPassByPair[key] || { count: 0, touched: 0, ratios: [] };
      relPassByPair[key].count++;
      if (rp.touchedEither) relPassByPair[key].touched++;
      if (rp.speedRatio != null) relPassByPair[key].ratios.push(rp.speedRatio);
    });
    Object.keys(relPassByPair).forEach(function (k) { relPassByPair[k].medianSpeedRatio = median(relPassByPair[k].ratios); });

    return {
      durationSec: durationSec,
      maxStageReached: maxStageReached,
      stageStats: stageStats,
      slotCaptureCounts: slotCaptureCounts,
      netInFieldBySlotDiffMedian: { 2: median(netInFieldBySlotDiff[2]), 3: median(netInFieldBySlotDiff[3]), 4: median(netInFieldBySlotDiff[4]) },
      netInFieldByCondCountMedian: { 1: median(netInFieldByCondCount[1]), 2: median(netInFieldByCondCount[2]) },
      firstThreeAfterStageChange: firstThreeAfterStageChange,
      backlogProcessingRate: { global: backlogGlobal, byStage: backlogByStage },
      deathBy10sWindow: deathBy10s,
      lastFullHpElapsedMs: g.lastFullHpElapsedMs, secFromLastFullHpToDeath: lastFullHpToDeathSec,
      hpLE2: { firstElapsedMs: g.firstHpLE2ElapsedMs, firstStage: g.firstHpLE2Stage, ratio: hpLE2Ratio, entries: g.hpLE2Entries },
      firstExpire: { elapsedMs: g.firstExpireElapsedMs, rate: g.firstExpireRate, stage: g.firstExpireStage },
      hpCurve: g.hpCurve, totalHpGained: byType(events, 'hpChange').filter(function (h) { return h.reason === 'capture'; }).length,
      longestNoCaptureGap: longestGap,
      idleTimeRatio: { r0to60: idle0to60, rAfter60: idleAfter60 },
      dropToNextPressIntervals: dropToNextPress, lastDropNoMorePress: noMorePress,
      segments: segments, spawnBatchOutcome: spawnBatchOutcome,
      adjacentCaptureIntervalsMs: captureIntervals,
      stageWindowStats: stageWindowStats,
      pauseCount: g.pauseCount, pauseSecTotal: pauseSecTotal / 1000,
      maxConcurrent: g.maxConcurrent, forcedPlacementCount: g.forcedPlacementCount,
      totals: g.totals,
      supply: { total: supplyDrops.length, byStage: supplyByStage, capturedCount: supplyCaptured.length, captureShareOfTotal: ratio(supplyCaptured.length, g.totals.captured) },
      mistake: {
        colorRate: indicator6.mistakeColorRate, shapeRate: indicator6.mistakeShapeRate,
        colorCount: mistakeColorSwipes.length, shapeCount: mistakeShapeSwipes.length
      },
      relPass: { byPair: relPassByPair, total: relPasses.length, touchedCount: relPasses.filter(function (r) { return r.touchedEither; }).length },
      spawnRatioVsRateIntegral: (function () {
        var tSec = durationSec;
        var integral = PARAMS.spawnRate0 * tSec + PARAMS.spawnRateSlope * tSec * tSec / 2;
        return integral > 0 ? g.totals.spawned / integral : null;
      })(),
      eventCountTotals: {
        spawn: spawns.length, captured: captureDrops.length, expired: expires.length, bounceCond: bounceCondDrops.length,
        slotOff: slotOffDrops.length, holdNoDrag: g.totals.holdNoDrag, swipeEffective: g.totals.swipeEffective,
        swipeLocked: g.totals.swipeLocked, mistake: mistakeSwipes.length, supply: supplyDrops.length, netAppear: netAppears.length
      },
      dragTimeRatio: null,
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
    finalizePendingRelPass(g);
    g.bubbles.slice().forEach(function (b) {
      finalizeBubble(g, b, 'residual', null);
      emit(g, 'fieldEnd', {
        bubbleId: b.id, color: b.color, shape: b.shape, isSupply: b.isSupply, isMistake: b.isMistake,
        spawnElapsedMs: b.spawnElapsed, spawnStage: b.spawnStage, life: Math.max(0, b.life), grabCount: b.grabCount
      });
    });
    emit(g, 'stageChange', { note: 'final-net-in-field', litNetSeq: g.netSeq, litNetCondition: g.netCondition, netInFieldMsAtEnd: nowElapsed(g) - g.netAppearedAtElapsed });
    var summary = computeSummary(g);
    var dragEndEvents = byType(g.events, 'dragEnd');
    var dragTotalMs = dragEndEvents.reduce(function (a, e) { return a + (e.durationMs || 0); }, 0);
    summary.dragTimeRatio = g.elapsed > 0 ? dragTotalMs / g.elapsed : null;
    var out = {
      playerId: PLAYER_ID, gameIndex: g.gameIndex, device: g.device, gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: {
        params: PARAMS, stageTimesMs: STAGE_MS,
        zones: ZONES.map(function (z) { return { id: z.id, kind: z.kind, color: z.color, shape: z.shape, angle: z.angle, x: z.x, y: z.y, r: z.r, rSmall: z.rSmall, stage: z.stage }; }),
        slots: SLOTS.map(function (s) { return { id: s.id, no: s.no, angle: s.angle, x: s.x, y: s.y, r: s.r }; })
      },
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
      g.deathReasons = [reason];
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
    var now = nowElapsed(g);
    var intervalSinceLastDrop = g.lastDropElapsed == null ? null : (now - g.lastDropElapsed);
    emit(g, 'press', {
      bubbleId: target.id, x: p.x, y: p.y, remainingLifeMs: Math.round(target.life * 1000), color: target.color, shape: target.shape,
      litNetSeq: g.netSeq,
      intervalSinceLastDropMs: intervalSinceLastDrop, processableAtLastDrop: g.lastDropProcessableCount,
      pathLenSinceLastDrop: mouse.pathLenSinceLastDrop || null, netChangedSinceLastDrop: mouse.netSeqAtLastDrop != null ? (mouse.netSeqAtLastDrop !== g.netSeq) : null,
      timeSinceNetAppearedMs: now - g.netAppearedAtElapsed
    });
    if (g.netAppearRecord && !g.netFirstPressDone) {
      g.netAppearRecord.approachedBeforeFirstPress = g.netApproached;
      g.netFirstPressDone = true;
    }
    g.lastPressElapsed = now;
    mouse.pathLenSinceLastDrop = 0;
    mouse.press = { bubbleId: target.id, bubble: target, downPos: { x: p.x, y: p.y }, downTime: now, dragging: false };
  }

  function handlePlayingMouseMove(p) {
    var g = game;
    if (g.netAppearRecord && !g.netFirstPressDone) {
      var d2 = dist(p.x, p.y, SLOT_BY_NO[g.netSlot].x, SLOT_BY_NO[g.netSlot].y);
      if (d2 <= NET_R) g.netApproached = true;
    }
    if (mouse.pathLenSinceLastDrop != null) mouse.pathLenSinceLastDrop += dist(p.x, p.y, mouse.x, mouse.y);
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
        b.dragSessionId++;
        var now = nowElapsed(g);
        b.dragStartElapsed = now;
        b.dragPathLen = 0;
        b.dragLastSwipePathLen = null; b.dragLastSwipeElapsed = null;
        b.pathHistory = [];
        var clamped = clampDrag(p.x, p.y);
        b.x = clamped.x; b.y = clamped.y;
        b.zoneOverlap = {}; b.dragMinDist = {};
        var zones = activeZonesAt(g.elapsed);
        var already = null;
        for (var i = 0; i < zones.length; i++) {
          var z = zones[i];
          var d = dist(b.x, b.y, z.x, z.y);
          var overlap = d <= (BUBBLE_R + z.r);
          b.zoneOverlap[z.id] = overlap;
          b.dragMinDist[z.id] = d;
          if (overlap && already == null) already = z.id;
        }
        var net = currentNetCond(g);
        function matchField(attr) {
          if (attr === 'color') return b.color === net.color;
          return net.shape == null ? '不比對' : (b.shape === net.shape);
        }
        function neededDist(attr) {
          if (attr === 'color') {
            if (b.color === net.color) return '不需要';
            if (b.color != null) return '無法符合';
            return neededZoneDistance(b, net, 'color');
          }
          if (net.shape == null) return null;
          if (b.shape === net.shape) return '不需要';
          if (b.shape !== 'circle') return '無法符合';
          return neededZoneDistance(b, net, 'shape');
        }
        emit(g, 'grab', {
          bubbleId: b.id, distanceAtDragStart: d0, msAtDragStart: now - press.downTime,
          color: b.color, shape: b.shape, remainingLifeMs: Math.round(b.life * 1000), countOnField: fieldCount(g),
          processableCount: processableCount(g), grabOrdinal: b.grabCount, alreadyIntersectingZoneId: already,
          litNetSeq: g.netSeq, litSlot: g.netSlot, litCondition: { color: net.color, shape: net.shape },
          colorMatch: matchField('color'), shapeMatch: matchField('shape'),
          neededDistanceColor: neededDist('color'), neededDistanceShape: net.shape != null ? neededDist('shape') : null,
          satisfiedCountAtGrab: alreadyMatchCount(g), isSupply: b.isSupply, isMistake: b.isMistake
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
      // 只有「放下」(完成一次拖曳的釋放)才重設「放下到下次按下」的量測起點, 按住未拖不算放下
      mouse.netSeqAtLastDrop = g.netSeq;
      mouse.pathLenSinceLastDrop = 0;
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
  function zoneRenderState(z, st) {
    var s2 = { x: z.x, y: z.y, status: st.status, r: st.r };
    if (st.status === 'preview' || st.status === 'shrink') s2.previewT = st.previewT;
    if (st.status === 'shrink') s2.shrinkTo = st.shrinkTo;
    if (st.status === 'on') s2.introT = st.introT;
    return s2;
  }
  function renderGame() {
    var g = game;
    Art.drawBackground(ctx);
    Art.drawInnerRing(ctx);
    var elapsed = g.elapsed;
    var dragBubble = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;

    for (var zi = 0; zi < ZONES.length; zi++) {
      var z = ZONES[zi];
      var zst = zoneStateAt(z, elapsed);
      if (!zst.exists) continue;
      var st = zoneRenderState(z, zst);
      if (z.kind === 'paint') { st.color = z.color; Art.drawPaintZone(ctx, st); }
      else { st.shape = z.shape; Art.drawShapeZone(ctx, st); }
    }

    var pv = previewInfo(elapsed);
    // 先畫 7 個不亮的, 最後畫亮著的那張(換位掃光要蓋在其他槽位上)
    for (var i = 0; i < SLOTS.length; i++) {
      var sl = SLOTS[i];
      if (sl.no === g.netSlot) continue;
      var st2 = { x: sl.x, y: sl.y, status: 'off' };
      if (g.catchFlash && g.catchFlash.slotNo === sl.no) { st2.flash = 'catch'; st2.flashT = clamp01(g.catchFlash.t); }
      Art.drawNet(ctx, st2);
    }
    if (g.netSlot != null) {
      var litDef = SLOT_BY_NO[g.netSlot];
      var hot = !!(dragBubble && dist(dragBubble.x, dragBubble.y, litDef.x, litDef.y) <= NET_R);
      var litState = { x: litDef.x, y: litDef.y, status: 'on', color: g.netCondition.color, shape: g.netCondition.shape, hot: hot };
      if (g.netLightT > 0 && g.netLightT < 1) { litState.lightT = g.netLightT; if (g.netFrom != null) litState.from = g.netFrom; }
      if (g.bounceFlash) { litState.flash = 'bounce'; litState.flashT = clamp01(g.bounceFlash.t); }
      Art.drawNet(ctx, litState);
    }

    var others = g.bubbles.filter(function (b) { return b.mode !== 'drag'; });
    for (var oi = 0; oi < others.length; oi++) Art.drawBubble(ctx, bubbleRenderState(others[oi]));
    if (dragBubble) Art.drawBubble(ctx, bubbleRenderState(dragBubble));

    Art.drawHud(ctx, { hp: g.hp, hpMax: PARAMS.hpMax, time: g.elapsed / 1000, paused: (screen === SCREEN.PAUSED), score: g.score, combo: g.combo, hpFlash: g.hpFlash, hpGainFx: g.hpGainFx });
    Art.drawPauseButton(ctx, { hover: pauseBtnHover });
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
