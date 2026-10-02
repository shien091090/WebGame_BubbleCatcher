// 捕泡手 遊戲邏輯(spec v13)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art, 聲音一律呼叫 window.Sound。
// 本版相對 v12 的差異: 拍子時鐘(以存活時間為權威) + 預備拍 + 踩拍回血 + 整串回饋 + 靜音 + 命改連續血條(持續扣血/回血/溢出轉分數/危險狀態)。
// 「待定」交 RD 的項目(回報同步列出):
//   3. 強制放置後的推開/一般碰撞推開去處/重疊氣泡按下: 一般碰撞沿用 3-pass 推擠(不彈飛),
//      額外對 idle/hold 氣泡疊加「推出生效中區域」的力, 推不開允許暫時重疊; 重疊氣泡按下取中心離指標最近的那顆
//   4. 彈回落點被佔/與區域相交: 以預設落點(內圈邊上最近點退一個半徑)為準, 用角度偏移表在同半徑上
//      找第一個不與生效中區域相交的位置, 全部失敗則用預設落點(允許重疊)
//   5. 拖曳指標偏移與內圈邊緣判定: 氣泡中心 = 指標位置(無偏移); 內外圈一律用「氣泡中心點」到內圈圓心的距離判定
//   6. 彈回中的氣泡參與碰撞: 視為靜態障礙物(擋別顆、自己不被推動)
//   7. 同幀多次命變化與網輪替順序: tick() 內先完成階段切換與物理/過期(過期批次尾端才判死);
//      捕捉(含輪替、回血)由滑鼠放開即時處理, 其後立即 checkDeath; HP 恆 clamp 在 0~上限
//   8. 一幀跨區不漏判/同幀階段切換又拖曳: 用移動圓掃描(sweepCircleInterval)以兩幀間路徑判斷,
//      同幀多區依路徑先後排序; 階段切換在該幀 tick 開頭處理, 早於同幀後續 mousemove 的擦過判定
//   16. 判定偏移補償與音訊延遲: 判定偏移補償初始 0 毫秒(見 PARAMS.beatOffsetMs), 只在埋點「離最近拍時間差」
//      這一處生效; 音樂的輸出延遲補償交給 sound.js 內建的 getOutputLatency() 自動處理(預設開啟),
//      RD 端不另外對判定時刻加這段延遲, 避免「補兩次」。音訊延遲值由 Sound.getOutputLatency() 取樣存進埋點
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var GUIDE_PAGES = L.guide.pages; // 7
  var TAU = Math.PI * 2;

  var BUILD_VERSION = 'demo-v13-0.1.0';

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
    hpMax: 100, hpStart: 60,
    drainRate: [1.8, 2.1, 2.3, 2.5],            // 階段 1~4 每秒扣血
    drain5Start: 2.7, drain5PerSec: 0.02,        // 階段 5: 2.7 + 0.02 * (t - 160)
    hpCatchGain: 4, hpBeatGain: 2, hpChainGain: 4, hpExpireLoss: 6,
    overflowPerHp: 2,
    hpDangerEnter: 40, hpDangerExit: 50,
    // 拍子(spec v13「拍子與音樂」)
    bpm: 150, beatSec: 0.4, barBeats: 4, countInBeats: 4,
    beatWindowEdge: 70,   // 抓起 / 送進網
    beatWindowMid: 90,    // 第一次 / 第二次沾上
    beatOffsetMs: 0,      // 判定偏移補償(初始 0; 見待定 16)
    // 波次(spec v12/v13)
    batchN: [4, 5, 5, 6, 6],                         // 階段 1~5 每批顆數
    gapHead: [9.5, 10.8, 10.3, 9.7],                 // 階段 1~4 空檔階段頭
    gapTail: [8.7, 9.0, 7.5, 7.2],                   // 階段 1~4 空檔階段尾
    gap5Start: 9.6, gap5PerSec: 0.025, gap5Floor: 2.2, // 階段 5: max(下限, 起值 - 遞減 × (t - 160))
    stageLenS: 40,
    outDuration: 0.8,                                // 出完時長
    clearGapBeats: 3, stuckGapBeats: 3,              // 清場後 / 卡死縮短後: 嚴格晚於那一刻的第 3 個拍點
    clearScore: 50,
    windowOpenFrom: 3, windowOpenTo: 2,              // 清場窗口: 場上氣泡數由 >=3 降到 <=2 開啟
    formationMaxR: 180, formationZoneMin: 48, formationGap: 44,
    spawnFxS: 0.4,
    clearFxS: 1.2,
    beatFxS: 0.45, chainFxS: 0.9,
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
    netLightDurationS: 1.2,
    flashDurationS: 0.5,
    swipeFxDurationS: 0.35,
    hpFlashDurationS: 0.6,
    hpGainFxDurationS: 0.6,
    overflowFxDurationS: 0.8,
    relPassWindowMs: 150
  };

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
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
  function uniqArr(arr) { var o = []; arr.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }

  // ---------- 本機狀態: 玩家 ID / 局數 / 已看過說明 / 靜音(新命名空間 bcv13_) ----------
  var PLAYER_ID_KEY = 'bcv13_playerId';
  var GAME_COUNT_KEY = 'bcv13_gameCount';
  var DEVICE_KEY = 'bcv13_device';
  var SEEN_GUIDE_KEY = 'bcv13_seenGuide';
  var MUTED_KEY = 'bcv13_muted';

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
  function loadMuted() { try { return localStorage.getItem(MUTED_KEY) === '1'; } catch (e) { return false; } }
  function saveMuted(m) { try { localStorage.setItem(MUTED_KEY, m ? '1' : '0'); } catch (e) {} }

  var PLAYER_ID = getPlayerId();

  // 靜音狀態: 立刻套用(init 前呼叫也有效)
  var muted = loadMuted();
  if (window.Sound && Sound.setMuted) Sound.setMuted(muted);
  var soundInited = false;
  function ensureSoundInit() {
    if (!soundInited) { soundInited = true; try { Sound.init(); } catch (e) {} }
  }
  function toggleMute() {
    muted = !muted;
    try { Sound.setMuted(muted); } catch (e) {}
    saveMuted(muted);
  }

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

  var titleHover = null, inputHover = null, pauseBtnHover = false, muteHover = false, pauseMenuHover = null, guideHover = null, endHover = null;

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
  function previewInfo(elapsed) {
    for (var i = 1; i < STAGE_MS.length; i++) {
      var start = STAGE_MS[i] - PARAMS.previewMs;
      if (elapsed >= start && elapsed < STAGE_MS[i]) return { inPreview: true, previewStage: i + 1, previewT: clamp01((elapsed - start) / PARAMS.previewMs) };
    }
    return { inPreview: false, previewStage: null, previewT: 0 };
  }

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

  var ADJ_PAIRS = (function () {
    var sorted = ZONES.slice().sort(function (a, b) { return a.angle - b.angle; });
    var pairs = [];
    for (var i = 0; i < sorted.length; i++) pairs.push([sorted[i], sorted[(i + 1) % sorted.length]]);
    return pairs;
  })();

  // ==================================================================
  // 網的輪替: 條件池 / 抽法
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
  function fullSatisfiableCount(g) {
    var net = currentNetCond(g);
    if (!net) return 0;
    return g.bubbles.filter(function (b) { return compatibleWithNet(b, net); }).length;
  }
  var WAVE_STATE_NAME = { out: '出批中', gap: '空檔', stuck: '卡死縮短後空檔', clear: '清場後空檔' };
  function waveStateName(g) { return g.wave ? WAVE_STATE_NAME[g.wave.phase] : null; }

  // ==================================================================
  // 陣型
  // ==================================================================
  function rotPt(p, deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    return { x: p.x * c - p.y * sn, y: p.x * sn + p.y * c };
  }
  function polarPt(r, deg) { var a = deg * Math.PI / 180; return { x: r * Math.cos(a), y: r * Math.sin(a) }; }
  var FORM_ORDER = ['line', 'arc', 'ring', 'cross', 'triangle', 'double'];
  var FORMATIONS = {
    line: {
      name: '一直線', unlock: 1, dirs: 3, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 9; },
      pts: function (n) {
        var s2 = Math.min(60, 360 / (n - 1)), out = [];
        for (var i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * s2, y: 0 });
        return out;
      }
    },
    arc: {
      name: '弧', unlock: 1, dirs: 6, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 10; },
      pts: function (n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(polarPt(85, (i - (n - 1) / 2) * 32));
        return out;
      }
    },
    ring: {
      name: '圓環', unlock: 1, dirs: 6, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 11; },
      pts: function (n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(polarPt(85, i * 360 / n));
        return out;
      }
    },
    cross: {
      name: '十字', unlock: 2, dirs: 3, dirStep: 60,
      supports: function (n) { return n === 5 || n === 7 || n === 9; },
      pts: function (n) {
        var out = [{ x: 0, y: 0 }, { x: 0, y: -60 }, { x: 0, y: 60 }];
        var pairs = (n - 3) / 2;
        for (var k = 1; k <= pairs; k++) { out.push({ x: -60 * k, y: 0 }); out.push({ x: 60 * k, y: 0 }); }
        return out;
      }
    },
    triangle: {
      name: '三角', unlock: 4, dirs: 2, dirStep: 60,
      supports: function (n) { return n === 3 || n === 4 || n === 6 || n === 7 || n === 9; },
      pts: function (n) {
        var k = Math.floor(n / 3), withCenter = (n % 3 === 1);
        var v = [polarPt(120, 0), polarPt(120, 120), polarPt(120, 240)];
        var out = [v[0], v[1], v[2]];
        for (var e = 0; e < 3; e++) {
          var a = v[e], b = v[(e + 1) % 3];
          for (var m = 1; m < k; m++) out.push({ x: a.x + (b.x - a.x) * m / k, y: a.y + (b.y - a.y) * m / k });
        }
        if (withCenter) out.push({ x: 0, y: 0 });
        return out;
      }
    },
    double: {
      name: '雙排', unlock: 4, dirs: 3, dirStep: 60,
      supports: function (n) { return n === 4 || n === 6 || n === 8; },
      pts: function (n) {
        var rows = n / 2, out = [];
        [-40, 40].forEach(function (y) {
          for (var i = 0; i < rows; i++) out.push({ x: (i - (rows - 1) / 2) * 54, y: y });
        });
        return out;
      }
    }
  };
  function formationPoints(key, n, d) {
    var f = FORMATIONS[key];
    return f.pts(n).map(function (p) {
      var r = rotPt(p, d * f.dirStep);
      return { x: INNER.x + r.x, y: INNER.y + r.y };
    });
  }

  function gapForTime(tSec) {
    var stage = Math.min(5, Math.floor(tSec / PARAMS.stageLenS) + 1);
    if (stage <= 4) {
      var head = PARAMS.gapHead[stage - 1], tail = PARAMS.gapTail[stage - 1];
      return head + (tail - head) * (tSec - (stage - 1) * PARAMS.stageLenS) / PARAMS.stageLenS;
    }
    return Math.max(PARAMS.gap5Floor, PARAMS.gap5Start - PARAMS.gap5PerSec * (tSec - 160));
  }
  function periodBeats(gapSec) { return Math.round((PARAMS.outDuration + gapSec) / PARAMS.beatSec); }

  // ==================================================================
  // 拍子時鐘: clockMs 從預備拍開始(第 -4 拍)連續累計, 暫停凍結。
  // beat = clockMs / 400 - 4; elapsed(存活 ms) = max(0, clockMs - 1600)
  // ==================================================================
  function beatOf(clockMs) { return clockMs / (PARAMS.beatSec * 1000) - PARAMS.countInBeats; }
  function clockMsOfBeat(beat) { return (beat + PARAMS.countInBeats) * PARAMS.beatSec * 1000; }
  function beatCheck(clockMs, windowMs) {
    var beat = beatOf(clockMs);
    var nearest = Math.round(beat);
    var nearestMs = clockMsOfBeat(nearest);
    var diffMs = clockMs - nearestMs; // 原始值, 未套偏移補償
    var adjusted = diffMs - PARAMS.beatOffsetMs;
    return { nearestBeat: nearest, diffMs: diffMs, onBeat: Math.abs(adjusted) <= windowMs };
  }
  function beatPointClockMs(beatIdx) { return clockMsOfBeat(beatIdx); }

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
      phase: 'countIn', // countIn -> playing
      clockMs: 0,
      elapsed: 0,
      stage: 1,
      hp: PARAMS.hpStart,
      danger: false, dangerSoundPlayed: false,
      score: 0,
      combo: 0,
      hpFlash: 0, hpLossFrom: PARAMS.hpStart,
      hpGainFx: 0, hpGainFrom: PARAMS.hpStart, hpGainKind: 'catch',
      overflowFx: 0, overflowPts: 0,
      lastCountInBeatPlayed: null,
      beatFxList: [], chainFxList: [],
      bubbles: [],
      nextBubbleId: 1,
      wave: { phase: 'out', batchSeq: 0, cur: null, gapLeft: 0, gapScheduled: 0, windowOpened: false, lastCount: 0, lastFormation: null, nextStartBeat: null },
      batches: [],
      clearFx: null,
      openWindow: null, windowSeq: 0,
      zs: null, zsHint: '過期後',
      frameRotated: false, frameExpired: false,
      lastExpireRec: null, lastLeaveRec: null,
      phaseSec: { out: [0, 0], gap: [0, 0], stuck: [0, 0], clear: [0, 0] },
      sinceFull: { batchSeqs: [], hadGain: false },
      deathBatchSeqs: [],
      lastHpLossMs: null,
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
      muteSecAcc: 0,
      frameIntervalSum: 0, frameIntervalCount: 0,
      audioOutputLatencySec: 0,
      totals: {
        spawned: 0, captured: 0, expired: 0, bounceCond: 0, bounceOuter: 0, bounceSlotOff: 0, stayInner: 0,
        holdNoDrag: 0, swipeEffective: 0, swipeLocked: 0, mistakeColor: 0, mistakeShape: 0, supply: 0,
        batches: 0, clears: 0, stuckShortens: 0, clearsWithExpiry: 0,
        nodeCounted: 0, nodeOnBeat: 0, nodeByType: {}
      },
      netSeq: 0, netSlot: null, netCondition: null, netFrom: null,
      netLightT: 1, netAppearedAtElapsed: 0, netApproached: false, netFirstPressDone: false, netAppearRecord: null,
      catchFlash: null, bounceFlash: null,
      recentConditions: [],
      pendingGuarantee: null,
      netAppearList: [],
      lastFullHpElapsedMs: null,
      firstDangerElapsedMs: null, firstDangerStage: null,
      dangerOpenSince: null, dangerSecTotal: 0, dangerEntries: [],
      firstExpireElapsedMs: null, firstExpireBatchSeq: null, firstExpireBatchesOnField: null, firstExpireStage: null,
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
    try { g.audioOutputLatencySec = Sound.getOutputLatency() || 0; } catch (e) {}
    try { Sound.playMusic('main'); } catch (e) {}
    return g;
  }

  function fieldCount(g) { return g.bubbles.length; }
  function processableCount(g) { return g.bubbles.filter(isProcessable).length; }
  function nowElapsed(g) { return Math.round(g.elapsed); }

  function emit(g, type, fields) {
    var rec = { t: nowElapsed(g), gameId: g.id, type: type, stage: stageOf(g.elapsed) };
    for (var k in fields) rec[k] = fields[k];
    if (fields && fields.bubbleId != null && rec.batchSeq == null) {
      var br = g.bubbleRec[fields.bubbleId];
      if (br) rec.batchSeq = br.batchSeq;
    }
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
      approachedBeforeFirstPress: null,
      fullSatisfiableCountAtAppear: fullSatisfiableCount(g),
      waveStateAtAppear: waveStateName(g),
      conditionItemCount: draw.condition.shape != null ? 2 : 1
    });
    if (g.wave.cur && draw.condition.shape != null) g.wave.cur.rec.cycleTwoCondNets++;
    g.zsHint = '網輪替後';
    g.netAppearRecord = rec;
    g.netAppearList.push(rec);
    if (prevSlot != null) { try { Sound.play('netSwap', { x: slotDef.x }); } catch (e) {} }
  }

  // ==================================================================
  // 生成: 一律透明圓
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
  function stageAtSec(tSec) { return Math.min(5, Math.floor(tSec / PARAMS.stageLenS) + 1); }
  function momentMs(g, left) { return Math.round(g.elapsed - (left || 0) * 1000); }

  function makeBubble(id, x, y, spawnElapsed, spawnStage, batchSeq, idxInBatch) {
    return {
      id: id, color: null, shape: 'circle', x: x, y: y,
      life: PARAMS.lifeMax, lifeMax: PARAMS.lifeMax,
      mode: 'idle', swipeFx: 0, swipeKind: null,
      batchSeq: batchSeq, idxInBatch: idxInBatch, spawnAge: 0, pressInfo: null,
      spawnElapsed: spawnElapsed, spawnStage: spawnStage,
      grabCount: 0, dragSessionId: 0,
      dragPathLen: 0, dragDistanceTotal: 0, freezeMsTotal: 0,
      dragStartElapsed: null, pressElapsed: null, pressClockMs: null,
      zoneOverlap: {}, dragMinDist: {}, pathHistory: [],
      lastSwipeZoneId: null, lastSwipeElapsed: null,
      dragLastSwipePathLen: null, dragLastSwipeElapsed: null,
      lockedSameCount: 0, lockedDiffCount: 0,
      isSupply: false, isMistake: false,
      mistakeRecords: [], bounceCondRecords: [], supplyRecords: [],
      returnFrom: null, returnTo: null, returnElapsed: 0,
      effectiveSwipeCount: 0,
      beatNode: {}, lastNodeClockMs: null, onBeatStepCount: 0,
      dead: false
    };
  }

  function pickFormation(g, n, stage) {
    var w = g.wave;
    var pool = FORM_ORDER.filter(function (k) { var f = FORMATIONS[k]; return f.unlock <= stage && f.supports(n); });
    var ex = pool.filter(function (k) { return k !== w.lastFormation; });
    if (ex.length) pool = ex;
    var key = pool[Math.floor(Math.random() * pool.length)];
    var f = FORMATIONS[key];
    var avoid = bubblesToAvoidForSpawn(g);
    var best = [], bestCount = Infinity;
    for (var d = 0; d < f.dirs; d++) {
      var pts = formationPoints(key, n, d);
      var cnt = 0;
      for (var pi = 0; pi < pts.length; pi++) {
        for (var ai = 0; ai < avoid.length; ai++) {
          if (dist(pts[pi].x, pts[pi].y, avoid[ai].x, avoid[ai].y) < PARAMS.formationGap) { cnt++; break; }
        }
      }
      if (cnt < bestCount) { bestCount = cnt; best = [d]; } else if (cnt === bestCount) best.push(d);
    }
    var dir = best[Math.floor(Math.random() * best.length)];
    return { key: key, dir: dir, pts: formationPoints(key, n, dir) };
  }

  function flushBatch(g, bt, endedBy) {
    if (bt.flushed) return;
    bt.flushed = true;
    var rec = bt.rec;
    rec.t = nowElapsed(g); rec.stage = stageOf(g.elapsed); rec.endedBy = endedBy;
    g.events.push(rec);
  }

  function startBatch(g, left) {
    var w = g.wave;
    var tSec = Math.max(0, g.elapsed / 1000 - (left || 0));
    var stage = stageAtSec(tSec);
    var n = PARAMS.batchN[stage - 1];
    var nowMs = momentMs(g, left);
    closeWindow(g, 'nextBatch');
    if (w.cur) {
      if (w.cur.rec.outDoneMs != null) w.cur.rec.actualGapSec = (nowMs - w.cur.rec.outDoneMs) / 1000;
      flushBatch(g, w.cur, '下一批出現');
    }
    var seq = w.batchSeq + 1;
    var resPrev = 0, resOlder = 0, seqSet = {};
    for (var i = 0; i < g.bubbles.length; i++) {
      var bb = g.bubbles[i];
      seqSet[bb.batchSeq] = true;
      if (bb.batchSeq === w.batchSeq) resPrev++; else resOlder++;
    }
    var pick = pickFormation(g, n, stage);
    w.lastFormation = pick.key;
    var rec = {
      type: 'wave', gameId: g.id, t: null, stage: null, batchSeq: seq, endedBy: null,
      startStage: stage, formation: FORMATIONS[pick.key].name, direction: pick.dir * FORMATIONS[pick.key].dirStep, n: n,
      startMs: nowMs, outDoneMs: null, scheduledGapSec: null, gapCalcAtSec: null, actualGapSec: null,
      startBeat: (w.nextStartBeat != null ? w.nextStartBeat : Math.round(beatOf(g.clockMs - (left || 0) * 1000))),
      placement: { formationPoint: 0, backup: 0, forced: 0 },
      residualAtStart: { prevBatch: resPrev, olderBatches: resOlder }, batchesOnFieldAtStart: Object.keys(seqSet).length,
      cleared: false, clearMs: null, clearAfterOutMs: null, gapRemainBeforeClear: null, gapAfterClear: null, clearHp: null,
      clearHadExpiry: null, clearExpiredBatchDiffs: null,
      stuckShortened: false, stuckAtMs: null,
      handFreeZeroSatSec: 0, firstPressDelayMs: null,
      lastLeaveMs: null, lastLeaveAfterStartMs: null,
      batchExpiredCount: 0, expiredSinceStartCount: 0, tailFirstMs: null, tailLastMs: null, tailSpanMs: null,
      cycleCaptures: 0, cycleTwoCondNets: 0, hpBeforeTail: null, fullBeforeTail: null
    };
    // 批內間隔固定半拍(0.2 秒), 與 N 無關; 出完時長 = (N-1) × 0.2 秒(由 interval 乘上 N-1 推得, 不用 PARAMS.outDuration)
    var bt = { rec: rec, n: n, pts: pick.pts, idx: 0, interval: PARAMS.beatSec / 2, t: 0, leftCount: 0, expiredDiffs: [], flushed: false };
    w.batchSeq = seq; w.cur = bt; w.phase = 'out';
    g.batches.push(bt);
    g.totals.batches++;
    spawnNext(g, left || 0);
  }

  function spawnNext(g, left) {
    var w = g.wave, bt = w.cur;
    var i = bt.idx++;
    var pt = bt.pts[i];
    var avoid = bubblesToAvoidForSpawn(g);
    var free = true;
    for (var k = 0; k < avoid.length; k++) {
      if (dist(pt.x, pt.y, avoid[k].x, avoid[k].y) < PARAMS.formationGap) { free = false; break; }
    }
    var pos, placement, overlap = 0, intersects = null;
    if (free) { pos = { x: pt.x, y: pt.y }; placement = '陣型點位'; bt.rec.placement.formationPoint++; }
    else {
      var found = findSpawnPosition(g);
      pos = found.pos; overlap = found.overlapCount;
      if (found.forced) { placement = '強制放置'; intersects = found.intersectsZone; bt.rec.placement.forced++; g.forcedPlacementCount++; }
      else { placement = '點位被佔改備用找位'; bt.rec.placement.backup++; }
    }
    var id = g.nextBubbleId++;
    var spawnElapsed = momentMs(g, left);
    var spawnStage = stageOf(spawnElapsed);
    var b = makeBubble(id, pos.x, pos.y, spawnElapsed, spawnStage, w.batchSeq, i + 1);
    b.life = PARAMS.lifeMax - left; b.spawnAge = left;
    g.bubbles.push(b);
    g.totals.spawned++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    g.spawnSegOf[id] = Math.floor(spawnElapsed / PARAMS.segmentMs);
    g.bubbleRec[id] = { spawnElapsed: spawnElapsed, spawnStage: spawnStage, batchSeq: w.batchSeq, outcome: null, outcomeElapsed: null };
    emit(g, 'spawn', {
      bubbleId: id, batchSeq: w.batchSeq, indexInBatch: i + 1, formation: bt.rec.formation, direction: bt.rec.direction,
      x: pos.x, y: pos.y, placement: placement, countOnField: fieldCount(g),
      overlapCountAtPlacement: overlap, intersectsZoneAtForce: intersects
    });
  }

  // 空檔長度只在出批完那一刻算一次, 但下一批出批時刻必須落在整數拍上(週期拍數 × 0.4 秒 = 本批出批開始到下一批出批開始)
  function enterGap(g, left) {
    var w = g.wave, rec = w.cur.rec;
    var tSec = g.elapsed / 1000 - left;
    var baseGap = gapForTime(tSec);
    var period = periodBeats(baseGap);
    var nextBeat = rec.startBeat + period;
    var nowClockMs = g.clockMs - left * 1000;
    var gap = Math.max(0, (clockMsOfBeat(nextBeat) - nowClockMs) / 1000);
    w.phase = 'gap'; w.gapLeft = gap; w.gapScheduled = gap; w.nextStartBeat = nextBeat;
    w.windowOpened = false; w.lastCount = fieldCount(g);
    rec.outDoneMs = momentMs(g, left); rec.scheduledGapSec = gap; rec.gapCalcAtSec = tSec;
    rec.periodBeats = period; rec.nextStartBeat = nextBeat;
  }

  function advanceWave(g, dt) {
    var w = g.wave, left = dt, guard = 0;
    while (left > 0 && guard++ < 60) {
      var bt = w.cur;
      if (w.phase === 'out') {
        var need = bt.idx * bt.interval - bt.t;
        if (need < 0) need = 0;
        if (need <= left) {
          left -= need; bt.t += need;
          spawnNext(g, left);
          if (bt.idx >= bt.n) enterGap(g, left);
        } else { bt.t += left; left = 0; }
      } else {
        if (w.gapLeft <= left) { left -= w.gapLeft; w.gapLeft = 0; startBatch(g, left); }
        else { w.gapLeft -= left; left = 0; }
      }
    }
  }

  // 清場: 空檔中(含卡死縮短後)場上氣泡數為 0; 下一批改到嚴格晚於該刻的第 3 個拍點
  function checkClear(g) {
    var w = g.wave;
    if (w.phase !== 'gap' && w.phase !== 'stuck') return false;
    if (fieldCount(g) !== 0) return false;
    var rec = w.cur.rec, nowMs = nowElapsed(g);
    rec.cleared = true; rec.clearMs = nowMs; rec.clearAfterOutMs = nowMs - rec.outDoneMs;
    rec.gapRemainBeforeClear = w.gapLeft;
    var nb = nthBeatAfter(g.clockMs, PARAMS.clearGapBeats);
    if (w.gapLeft > nb.sec) { w.gapLeft = nb.sec; w.nextStartBeat = nb.beat; }
    rec.gapAfterClear = w.gapLeft;
    rec.clearHp = g.hp;
    rec.clearHadExpiry = rec.expiredSinceStartCount > 0;
    rec.clearExpiredBatchDiffs = w.cur.expiredDiffs.slice();
    w.phase = 'clear';
    g.score += PARAMS.clearScore;
    g.totals.clears++;
    if (rec.clearHadExpiry) g.totals.clearsWithExpiry++;
    g.clearFx = { t: 0 };
    if (g.lastLeaveRec) g.lastLeaveRec.causedClear = true;
    emit(g, 'clear', {
      batchSeq: w.batchSeq, afterOutMs: rec.clearAfterOutMs, gapRemainBefore: rec.gapRemainBeforeClear, gapAfter: rec.gapAfterClear,
      hadExpiry: rec.clearHadExpiry, expiredBatchSeqDiffs: rec.clearExpiredBatchDiffs, hp: g.hp, points: PARAMS.clearScore,
      wasStuckShortened: rec.stuckShortened
    });
    closeWindow(g, 'clear');
    try { Sound.play('clear'); } catch (e) {}
    return true;
  }

  // 嚴格晚於 fromClockMs 那一刻的第 n 個拍點: 回傳 {beat, sec}(sec = 距現在的秒數); fromClockMs 剛好在拍點上該拍不算
  function nthBeatAfter(fromClockMs, n) {
    var beat = beatOf(fromClockMs);
    var startBeat = (Math.abs(beat - Math.round(beat)) < 1e-6) ? Math.round(beat) + 1 : Math.ceil(beat);
    var targetBeat = startBeat + (n - 1);
    var targetMs = clockMsOfBeat(targetBeat);
    return { beat: targetBeat, sec: Math.max(0, (targetMs - fromClockMs) / 1000) };
  }

  function checkStuck(g, trigger) {
    var w = g.wave;
    if (w.phase !== 'gap') return false;
    if (fieldCount(g) < 1) return false;
    if (fullSatisfiableCount(g) > 0) return false;
    var nb = nthBeatAfter(g.clockMs, PARAMS.stuckGapBeats);
    if (!(w.gapLeft > nb.sec)) return false;
    var rec = w.cur.rec, before = w.gapLeft;
    w.gapLeft = nb.sec; w.nextStartBeat = nb.beat;
    w.phase = 'stuck';
    rec.stuckShortened = true; rec.stuckAtMs = nowElapsed(g);
    g.totals.stuckShortens++;
    if (trigger === '過期' && g.lastExpireRec) g.lastExpireRec.causedStuck = true;
    var supply = g.bubbles.filter(function (b) { return b.isSupply; }).length;
    emit(g, 'stuckShorten', {
      batchSeq: w.batchSeq, trigger: trigger, remainBeforeSec: before, countOnField: fieldCount(g), supplyCount: supply,
      netSeq: g.netSeq, netCondition: { color: g.netCondition.color, shape: g.netCondition.shape }
    });
    return true;
  }

  function updateWindow(g) {
    var w = g.wave;
    if (w.phase !== 'gap') return;
    var cnt = fieldCount(g);
    if (!w.windowOpened && !g.openWindow && w.lastCount >= PARAMS.windowOpenFrom && cnt <= PARAMS.windowOpenTo) {
      g.windowSeq++;
      var net = currentNetCond(g);
      var supplies = g.bubbles.filter(function (b) { return b.isSupply; });
      g.openWindow = emit(g, 'clearWindow', {
        windowSeq: g.windowSeq, batchSeq: w.batchSeq, openMs: nowElapsed(g), countAtOpen: cnt,
        satisfiableAtOpen: satisfiableCount(g), supplyCount: supplies.length,
        supplyUnsatisfiableCount: supplies.filter(function (b) { return !compatibleWithNet(b, net); }).length,
        gapLeftAtOpen: w.gapLeft,
        closeMs: null, closeReason: null, countAtClose: null, offByOne: null, offByOneIsUnsatisfiableSupply: null
      });
      w.windowOpened = true;
    }
    w.lastCount = cnt;
  }
  function closeWindow(g, reason) {
    var rec = g.openWindow;
    if (!rec) return;
    var cnt = fieldCount(g);
    rec.closeMs = nowElapsed(g);
    rec.closeReason = reason === 'clear' ? '清場' : (reason === 'nextBatch' ? '下一批出現' : '局結束');
    rec.countAtClose = cnt;
    rec.offByOne = (reason === 'nextBatch' && cnt === 1);
    rec.offByOneIsUnsatisfiableSupply = null;
    if (rec.offByOne) {
      var only = g.bubbles[0], net = currentNetCond(g);
      rec.offByOneIsUnsatisfiableSupply = !!(only.isSupply && !compatibleWithNet(only, net));
    }
    g.openWindow = null;
  }

  function updateZeroSat(g) {
    if (!g.netCondition) return;
    var cnt = fieldCount(g);
    var active = cnt >= 1 && fullSatisfiableCount(g) === 0;
    if (active && !g.zs) {
      g.zs = {
        startMs: nowElapsed(g), cause: g.zsHint, waveStates: [], hadStuckShorten: false,
        countAtStart: cnt, supplyAtStart: g.bubbles.filter(function (b) { return b.isSupply; }).length
      };
    }
    if (g.zs) {
      var ws = waveStateName(g);
      if (g.zs.waveStates.indexOf(ws) === -1) g.zs.waveStates.push(ws);
      if (g.wave.phase === 'stuck') g.zs.hadStuckShorten = true;
    }
    if (!active && g.zs) closeZeroSat(g, cnt === 0 ? '場上清空' : '新一批冒出');
  }
  function closeZeroSat(g, endReason) {
    var z = g.zs;
    if (!z) return;
    var endMs = nowElapsed(g);
    emit(g, 'zeroSatSegment', {
      startMs: z.startMs, endMs: endMs, lengthSec: (endMs - z.startMs) / 1000, cause: z.cause, endReason: endReason,
      waveStates: z.waveStates, hadStuckShorten: z.hadStuckShorten, countAtStart: z.countAtStart, supplyAtStart: z.supplyAtStart
    });
    g.zs = null;
  }

  function noteBubbleLeave(g, b) {
    var bt = g.batches[b.batchSeq - 1];
    if (!bt) return;
    bt.leftCount++;
    if (bt.leftCount === bt.n) {
      bt.rec.lastLeaveMs = nowElapsed(g);
      bt.rec.lastLeaveAfterStartMs = bt.rec.lastLeaveMs - bt.rec.startMs;
    }
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
  // 區域擦過分類(染色/賦形; 每種屬性只沾一次, 不再有覆蓋) + 計次節點(第一次/第二次沾上)與踩拍
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

  // ---- 節點(抓起 / 第一次沾上 / 第二次沾上 / 送進網 / 已鎖定擦過 / 條件不符放開)共用: 埋點 + 踩拍判定 ----
  function emitNode(g, b, type, counted, clockMs, windowMs) {
    var chk = beatCheck(clockMs, windowMs);
    var prevMs = b.lastNodeClockMs;
    emit(g, 'node', {
      nodeType: type, bubbleId: b.id, counted: counted, nodeClockMs: Math.round(clockMs),
      nearestBeat: chk.nearestBeat, diffMs: Math.round(chk.diffMs),
      onBeat: counted ? chk.onBeat : null, appliedWindowMs: windowMs,
      prevNodeGapMs: prevMs == null ? null : Math.round(clockMs - prevMs),
      prevNodeGapBeats: prevMs == null ? null : (clockMs - prevMs) / (PARAMS.beatSec * 1000)
    });
    b.lastNodeClockMs = clockMs;
    g.totals.nodeByType[type] = (g.totals.nodeByType[type] || 0) + 1;
    if (counted) {
      g.totals.nodeCounted++;
      if (chk.onBeat) g.totals.nodeOnBeat++;
    }
    return chk;
  }
  // 計次且踩拍節點的獨立回饋(抓起 / 第一次沾上 / 第二次沾上; 送進網在捕捉流程一併處理)
  function rewardBeatNode(g, b, x, y) {
    var r = heal(g, b, PARAMS.hpBeatGain, 'beat');
    g.hpGainFx = 1; g.hpGainFrom = r.before; g.hpGainKind = 'beat';
    if (r.overflowPts > 0) { g.overflowFx = 1; g.overflowPts = r.overflowPts; }
    b.onBeatStepCount++;
    pushBeatFx(g, x, y);
    try { Sound.play('onBeat', { step: b.onBeatStepCount, x: x }); } catch (e) {}
  }

  // 本幀拖曳路徑(p0->p1)上的區域擦過、路過相鄰區域之間、衝出內圈偵測
  function processDragSegment(g, b, p0, p1, elapsed, clockMs0, clockMs1) {
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
      var frac = enters[e].t;
      var px = p0.x + (p1.x - p0.x) * frac, py = p0.y + (p1.y - p0.y) * frac;
      var nodeClockMs = clockMs0 + (clockMs1 - clockMs0) * frac;
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
      // 計次節點: 第一次 / 第二次沾上(生效)、已鎖定擦過(不計次)
      if (result.classification === '生效') {
        b.effectiveSwipeCount++;
        var nodeType = b.effectiveSwipeCount === 1 ? '第一次沾上' : '第二次沾上';
        var windowMs = PARAMS.beatWindowMid;
        var chk = emitNode(g, b, nodeType, true, nodeClockMs, windowMs);
        var key = b.effectiveSwipeCount === 1 ? 'paint1' : 'paint2';
        b.beatNode[key] = chk.onBeat;
        if (chk.onBeat) rewardBeatNode(g, b, px, py);
      } else {
        emitNode(g, b, '已鎖定擦過', false, nodeClockMs, PARAMS.beatWindowMid);
      }
    }
    if (enters.length) { g.zsHint = '擦過後'; updateZeroSat(g); }
    pushPathHistory(b, elapsed);
    for (var pi = 0; pi < ADJ_PAIRS.length; pi++) {
      var za = ADJ_PAIRS[pi][0], zb = ADJ_PAIRS[pi][1];
      var sa = zoneStateAt(za, elapsed), sb = zoneStateAt(zb, elapsed);
      if (!(sa.exists && sa.active && sb.exists && sb.active)) continue;
      var hit = segSegIntersect(p0, p1, { x: za.x, y: za.y }, { x: zb.x, y: zb.y });
      if (!hit) continue;
      var len = dist(za.x, za.y, zb.x, zb.y);
      var lateral = (hit.s - 0.5) * len;
      var beforeSpeed = speedBefore(b, elapsed, PARAMS.relPassWindowMs);
      var touchedEither = !!(b.zoneOverlap[za.id] || b.zoneOverlap[zb.id]);
      var relRec = emit(g, 'relPass', {
        bubbleId: b.id, zoneAId: za.id, zoneBId: zb.id, lateralOffset: lateral,
        touchedEither: touchedEither, beforeSpeed: beforeSpeed, afterSpeed: null, speedRatio: null
      });
      g.pendingRelPass.push({ bubbleId: b.id, record: relRec, crossElapsed: elapsed, crossPathLen: b.dragPathLen, beforeSpeed: beforeSpeed });
    }
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
  // 命(血條, 0~100 連續): 持續扣血 / 回血(含溢出轉分數) / 過期扣血 / 危險狀態
  // ==================================================================
  function pushBeatFx(g, x, y) { g.beatFxList.push({ x: x, y: y, t: 0 }); }
  function pushChainFx(g, x, y, nodes) { g.chainFxList.push({ x: x, y: y, t: 0, nodes: nodes }); }

  function batchesOnFieldCount(g) {
    var seen = {}, n = 0;
    for (var i = 0; i < g.bubbles.length; i++) { var s = g.bubbles[i].batchSeq; if (!seen[s]) { seen[s] = true; n++; } }
    return n;
  }
  function drainRatePerSec(g) {
    var stage = g.stage;
    if (stage <= 4) return PARAMS.drainRate[stage - 1];
    return PARAMS.drain5Start + PARAMS.drain5PerSec * (g.elapsed / 1000 - 160);
  }
  function updateDanger(g) {
    var nowMs = nowElapsed(g);
    if (!g.danger && g.hp <= PARAMS.hpDangerEnter) {
      g.danger = true;
      g.dangerOpenSince = nowMs;
      if (g.firstDangerElapsedMs == null) { g.firstDangerElapsedMs = nowMs; g.firstDangerStage = stageOf(g.elapsed); }
      g.dangerEntries.push({ enterElapsedMs: nowMs, durationSec: null, stage: stageOf(g.elapsed), batchSeq: g.wave.batchSeq, batchesOnField: batchesOnFieldCount(g) });
      if (!g.dangerSoundPlayed) { try { Sound.play('danger'); } catch (e) {} g.dangerSoundPlayed = true; }
    } else if (g.danger && g.hp >= PARAMS.hpDangerExit) {
      g.danger = false;
      g.dangerSoundPlayed = false;
      if (g.dangerOpenSince != null) {
        var entry = g.dangerEntries[g.dangerEntries.length - 1];
        entry.durationSec = (nowMs - g.dangerOpenSince) / 1000;
        g.dangerSecTotal += entry.durationSec;
        g.dangerOpenSince = null;
      }
    }
  }
  // 單一來源回血(應得 amount), 處理溢出轉分數; 回傳 {before, applied, overflow, overflowPts, after}
  function applyHealRaw(g, amount) {
    var before = g.hp;
    var room = PARAMS.hpMax - before;
    var applied = Math.min(amount, room);
    var overflow = amount - applied;
    g.hp = before + applied;
    var overflowPts = overflow > 0 ? Math.round(overflow * PARAMS.overflowPerHp) : 0;
    if (overflowPts > 0) g.score += overflowPts;
    return { before: before, applied: applied, overflow: overflow, overflowPts: overflowPts, after: g.hp };
  }
  function heal(g, b, amount, kind) {
    var r = applyHealRaw(g, amount);
    g.sinceFull.hadGain = true;
    emit(g, 'heal', { bubbleId: b ? b.id : null, source: kind, due: amount, applied: r.applied, overflow: r.overflow, overflowPts: r.overflowPts, hpAfter: r.after });
    updateDanger(g);
    return r;
  }
  function applyPersistentDrain(g, dt) {
    var rate = drainRatePerSec(g);
    var amt = rate * dt;
    if (amt <= 0) return;
    var before = g.hp;
    g.hp = Math.max(0, g.hp - amt);
    g.secDrainAcc = (g.secDrainAcc || 0) + (before - g.hp);
    if (before > 0 && g.hp <= 0) { g.pendingDeathReasons.push('持續扣血'); }
    updateDanger(g);
  }
  function applyExpireLoss(g, b) {
    var before = g.hp;
    g.hp = Math.max(0, g.hp - PARAMS.hpExpireLoss);
    g.hpFlash = 1; g.hpLossFrom = before;
    g.combo = 0;
    if (before === PARAMS.hpMax) { g.lastFullHpElapsedMs = nowElapsed(g); g.sinceFull = { batchSeqs: [], hadGain: false }; }
    g.sinceFull.batchSeqs.push(b.batchSeq);
    updateDanger(g);
    emit(g, 'hpLoss', { reason: 'expire', amount: PARAMS.hpExpireLoss, hpBefore: before, hpAfter: g.hp, countOnField: fieldCount(g), expiredBatchSeq: b.batchSeq, sinceLastLossMs: g.lastHpLossMs == null ? null : nowElapsed(g) - g.lastHpLossMs });
    g.lastHpLossMs = nowElapsed(g);
    if (g.hp <= 0) { g.pendingDeathReasons.push('過期'); g.deathBatchSeqs.push(b.batchSeq); }
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
    var snap = { id: b.id, color: b.color, shape: b.shape, isSupply: b.isSupply, isMistake: b.isMistake, grabCount: b.grabCount, beatGainTotal: b.onBeatStepCount * PARAMS.hpBeatGain };
    removeBubble(g, b);
    var nowMs = nowElapsed(g);
    var ownBt = g.batches[b.batchSeq - 1], curBt = g.wave.cur;
    if (ownBt) {
      var r = ownBt.rec;
      if (r.batchExpiredCount === 0) { r.hpBeforeTail = g.hp; r.fullBeforeTail = (g.hp === PARAMS.hpMax); r.tailFirstMs = nowMs; }
      r.batchExpiredCount++; r.tailLastMs = nowMs; r.tailSpanMs = nowMs - r.tailFirstMs;
    }
    if (curBt) { curBt.rec.expiredSinceStartCount++; curBt.expiredDiffs.push(curBt.rec.batchSeq - b.batchSeq); }
    noteBubbleLeave(g, b);
    var expRec = emit(g, 'expire', {
      bubbleId: snap.id, color: snap.color, shape: snap.shape, everPainted: snap.color != null, isSupply: snap.isSupply, isMistake: snap.isMistake,
      grabCount: snap.grabCount, beatGainTotal: snap.beatGainTotal, countOnField: fieldCount(g), processableCount: processableCount(g),
      netMatchAtExpire: fullyMatchesNet({ color: snap.color, shape: snap.shape }, currentNetCond(g)),
      waveState: waveStateName(g), causedClear: false, causedStuck: false
    });
    g.lastExpireRec = expRec; g.lastLeaveRec = expRec;
    g.frameExpired = true; g.zsHint = '過期後';
    g.totals.expired++;
    if (g.firstExpireElapsedMs == null) {
      g.firstExpireElapsedMs = nowMs; g.firstExpireStage = stageOf(g.elapsed);
      g.firstExpireBatchSeq = b.batchSeq; g.firstExpireBatchesOnField = batchesOnFieldCount(g) + 1;
    }
    try { Sound.play('expire', { x: b.x }); } catch (e) {}
    applyExpireLoss(g, b);
  }

  // ==================================================================
  // 放下位置分類 / 捕捉判定
  // ==================================================================
  function isOnUiRegion(px, py) { return inRect(px, py, L.hudLeft) || inRect(px, py, L.hudRight) || inRect(px, py, L.pauseButton) || inRect(px, py, L.muteButton); }
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
      pathLength: Math.round(b.dragPathLen), durationMs: elapsed - (b.pressElapsed == null ? elapsed : b.pressElapsed),
      lockedSameCountThisDrag: null, lockedDiffCountThisDrag: null,
      nearestEdgeDistanceByZone: nearestByZone
    });
  }

  var HEAL_KIND_RANK = { catch: 1, beat: 2, chain: 3 };

  function resolveRelease(g, b, px, py, reason) {
    var elapsed = nowElapsed(g);
    var clockMs = g.clockMs;
    b.dragDistanceTotal += b.dragPathLen;
    emitDragEnd(g, b, reason);
    var inPreview = previewInfo(g.elapsed).inPreview;
    var net = currentNetCond(g);
    var windowWasOpen = !!g.openWindow;
    var waveAtRelease = waveStateName(g);
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

        // ---- 送進網節點 + 捕捉回血 + 踩拍 / 整串回血(spec「踩拍」「計分」) ----
        var hpStartAll = g.hp;
        var bestKind = 'catch';
        var overflowSum = 0;
        var r1 = heal(g, b, PARAMS.hpCatchGain, 'catch'); overflowSum += r1.overflowPts;
        var deliverChk = emitNode(g, b, '送進網', true, clockMs, PARAMS.beatWindowEdge);
        b.beatNode.deliver = deliverChk.onBeat;
        var nodeKeys = Object.keys(b.beatNode);
        var chainEligible = nodeKeys.length > 0 && nodeKeys.every(function (k) { return b.beatNode[k] === true; });
        if (deliverChk.onBeat) {
          var r2 = heal(g, b, PARAMS.hpBeatGain, 'beat'); overflowSum += r2.overflowPts;
          if (HEAL_KIND_RANK.beat > HEAL_KIND_RANK[bestKind]) bestKind = 'beat';
          b.onBeatStepCount++;
        }
        if (chainEligible) {
          var r3 = heal(g, b, PARAMS.hpChainGain, 'chain'); overflowSum += r3.overflowPts;
          bestKind = 'chain';
        }
        g.hpGainFx = 1; g.hpGainFrom = hpStartAll; g.hpGainKind = bestKind;
        if (overflowSum > 0) { g.overflowFx = 1; g.overflowPts = overflowSum; }
        var litCenter = SLOT_BY_NO[g.netSlot];
        if (chainEligible) {
          pushChainFx(g, litCenter.x, litCenter.y, nodeKeys.length === 4 ? 4 : 3);
          try { Sound.play('beatChain', { x: litCenter.x }); } catch (e) {}
        } else if (deliverChk.onBeat) {
          pushBeatFx(g, litCenter.x, litCenter.y);
          try { Sound.play('onBeat', { step: b.onBeatStepCount, x: litCenter.x }); } catch (e) {}
        }
        try { Sound.play('catch', { x: litCenter.x }); } catch (e) {}

        captureExtra = {
          netSeq: g.netSeq, slotId: SLOT_BY_NO[g.netSlot].id, conditionCount: conditionCount,
          netInFieldMs: elapsed - g.netAppearedAtElapsed, hpBefore: hpBefore,
          processingMs: elapsed - b.spawnElapsed, processingMsExFreeze: elapsed - b.spawnElapsed - b.freezeMsTotal,
          grabCount: b.grabCount, pathLength: Math.round(b.dragDistanceTotal),
          lockedSameCount: b.lockedSameCount, lockedDiffCount: b.lockedDiffCount,
          isSupply: b.isSupply, isMistake: b.isMistake, spawnStage: b.spawnStage, inPreview: inPreview, points: pts,
          nodeCountedTotal: nodeKeys.length, nodeOnBeatTotal: nodeKeys.filter(function (k) { return b.beatNode[k]; }).length,
          isChain: chainEligible, totalHeal: (g.hp - hpStartAll) + overflowSum / PARAMS.overflowPerHp
        };
        removeBubble(g, b);
        noteBubbleLeave(g, b);
        if (g.wave.cur) g.wave.cur.rec.cycleCaptures++;
        updateWindow(g);
        g.catchFlash = { slotNo: g.netSlot, t: 0 };
        lightNewNet(g);
        g.frameRotated = true;
        updateZeroSat(g);
      } else {
        outcome = 'bounceCond';
        g.totals.bounceCond++;
        g.combo = 0;
        emitNode(g, b, '條件不符放開', false, clockMs, PARAMS.beatWindowEdge);
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
      dragDurationMs: elapsed - (b.pressElapsed == null ? elapsed : b.pressElapsed),
      dragDistance: Math.round(b.dragDistanceTotal),
      lastSwipeToDropPathLen: lastSwipeGapLen, lastSwipeToDropMs: lastSwipeGapMs,
      countOnField: fieldCount(g), inPreview: inPreview
    };
    if (captureExtra) for (var k in captureExtra) evt[k] = captureExtra[k];
    evt.waveState = waveAtRelease;
    evt.causedClear = false;
    var dropRec = emit(g, 'drop', evt);
    if (outcome === 'captured') {
      g.lastLeaveRec = dropRec;
      if (windowWasOpen) {
        var dragSec = (elapsed - (b.pressElapsed == null ? elapsed : b.pressElapsed)) / 1000;
        var pi2 = b.pressInfo || {};
        emit(g, 'windowCapture', {
          bubbleId: b.id, windowSeq: g.windowSeq, netSeq: captureExtra.netSeq, netInFieldMs: captureExtra.netInFieldMs,
          intervalLastDropToPressMs: pi2.intervalSinceLastDropMs == null ? null : pi2.intervalSinceLastDropMs,
          dragSpeed: dragSec > 0 ? b.dragPathLen / dragSec : null,
          gapLeftAtPressSec: pi2.gapLeftAtPress == null ? null : pi2.gapLeftAtPress, countOnFieldAtPress: pi2.fieldAtPress == null ? null : pi2.fieldAtPress
        });
      }
    }
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
        dragDurationMs: elapsed - (b.pressElapsed == null ? elapsed : b.pressElapsed),
        dragDistance: Math.round(b.dragDistanceTotal),
        lastSwipeToDropPathLen: null, lastSwipeToDropMs: null,
        countOnField: fieldCount(g), inPreview: previewInfo(g.elapsed).inPreview,
        waveState: waveStateName(g), causedClear: false
      };
      emit(g, 'drop', evt);
      g.lastDropElapsed = elapsed;
      g.lastDropProcessableCount = processableCount(g);
      mouse.netSeqAtLastDrop = g.netSeq;
      mouse.pathLenSinceLastDrop = 0;
      mouse.lastDropPos = { x: px, y: py };
    }
    mouse.press = null;
  }

  // ==================================================================
  // 暫停 / 恢復(拍子時鐘、背景音樂隨暫停凍結)
  // ==================================================================
  function openPause(g, reason) {
    if (g.paused) return;
    g.paused = true;
    g.pauseCount++;
    var rec = emit(g, 'pause', { startRealMs: Date.now() - g.startWall, endRealMs: null, reason: reason });
    g.openPauseRecord = rec;
    screen = SCREEN.PAUSED;
    try { Sound.pauseMusic(); } catch (e) {}
  }
  function resumePause(g) {
    if (!g.paused) return;
    g.paused = false;
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.openPauseRecord = null; }
    screen = SCREEN.PLAYING;
    try { Sound.resumeMusic(beatOf(g.clockMs)); } catch (e) {}
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
          newBatchN: PARAMS.batchN[newStage - 1],
          gapParams: newStage <= 4 ? { head: PARAMS.gapHead[newStage - 1], tail: PARAMS.gapTail[newStage - 1] } : { start: PARAMS.gap5Start, perSec: PARAMS.gap5PerSec, floor: PARAMS.gap5Floor },
          drainRate: newStage <= 4 ? PARAMS.drainRate[newStage - 1] : { start: PARAMS.drain5Start, perSec: PARAMS.drain5PerSec },
          unlockedFormations: FORM_ORDER.filter(function (k) { return FORMATIONS[k].unlock === newStage; }).map(function (k) { return FORMATIONS[k].name; }),
          waveStateAtEffective: waveStateName(g),
          litNetSeqAtEffective: g.netSeq, litNetConditionAtEffective: g.netCondition ? { color: g.netCondition.color, shape: g.netCondition.shape } : null,
          bubblesAtEffective: bubblesSnapshot,
          anyHeldOrDragging: anyHeldOrDragging, draggingBubbleId: dragBubble ? dragBubble.id : null,
          alreadyIntersectingZones: alreadyIntersecting,
          discardedPendingGuarantee: discardedPending, keptPendingGuarantee: g.pendingGuarantee,
          hpAtEffective: g.hp
        });
        g.stageChanges.push({ stage: newStage, previewStart: STAGE_MS[i] - PARAMS.previewMs, effectiveT: STAGE_MS[i] });
      }
    }
  }

  // ==================================================================
  // 主更新
  // ==================================================================
  function emitSample(g) {
    g.hpCurve.push({ t: nowElapsed(g), hp: g.hp });
    emit(g, 'sample', {
      countOnField: fieldCount(g), hp: g.hp, danger: g.danger, waveState: waveStateName(g), batchSeq: g.wave.batchSeq, batchesOnField: batchesOnFieldCount(g),
      anyHoldOrDrag: !!(mouse.press), processableCount: processableCount(g),
      satisfiableCount: satisfiableCount(g), fullSatisfiableCount: fullSatisfiableCount(g),
      litNetSeq: g.netSeq, litSlot: g.netSlot, satisfiedCount: alreadyMatchCount(g),
      secDrain: g.secDrainAcc || 0, muted: muted
    });
    g.secDrainAcc = 0;
  }

  function advanceCountIn(g, dt) {
    g.clockMs += dt * 1000;
    var beat = beatOf(g.clockMs);
    var floorBeat = Math.floor(beat + 1e-9);
    // 剛跨過(或一開始就落在)第 -4~-1 拍的拍點 → 各響一次預備拍音效
    if (floorBeat >= -PARAMS.countInBeats && floorBeat <= -1 && floorBeat !== g.lastCountInBeatPlayed) {
      g.lastCountInBeatPlayed = floorBeat;
      try { Sound.play('countIn', { left: -floorBeat }); } catch (e) {}
    }
    try { Sound.syncMusic(beat); } catch (e) {}
    if (g.clockMs >= PARAMS.countInBeats * PARAMS.beatSec * 1000) {
      g.phase = 'playing';
      g.elapsed = g.clockMs - PARAMS.countInBeats * PARAMS.beatSec * 1000;
      startBatch(g, 0);
      lightNewNet(g);
    }
  }

  function tick(dt) {
    var g = game;
    if (muted) g.muteSecAcc += dt;
    if (g.phase === 'countIn') { advanceCountIn(g, dt); return; }

    var prevElapsed = g.elapsed;
    g.clockMs += dt * 1000;
    g.elapsed = g.clockMs - PARAMS.countInBeats * PARAMS.beatSec * 1000;
    try { Sound.syncMusic(beatOf(g.clockMs)); } catch (e) {}
    g.pendingDeathReasons = [];
    g.frameExpired = false;

    checkStageTransitions(g, prevElapsed, g.elapsed);

    var w = g.wave;
    g.phaseSec[w.phase][g.elapsed < 60000 ? 0 : 1] += dt;
    if ((w.phase === 'gap' || w.phase === 'stuck') && !mouse.press && fieldCount(g) >= 1 && fullSatisfiableCount(g) === 0) w.cur.rec.handFreeZeroSatSec += dt;

    var zones = activeZonesAt(g.elapsed);
    updatePhysics(g, dt, zones);

    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb = g.bubbles[fi];
      if (fb.mode === 'hold' || fb.mode === 'drag') fb.freezeMsTotal += dt * 1000;
      if (fb.spawnAge < PARAMS.spawnFxS) fb.spawnAge += dt;
    }

    // 同一幀的處理順序步驟 5: 本幀所有回血已在滑鼠事件當下處理完畢(早於這一幀的 tick); 這裡先扣持續扣血, 最後才扣過期
    applyPersistentDrain(g, dt);

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
    if (g.overflowFx > 0) g.overflowFx = Math.max(0, g.overflowFx - dt / PARAMS.overflowFxDurationS);
    if (g.netLightT < 1) g.netLightT = Math.min(1, g.netLightT + dt / PARAMS.netLightDurationS);
    if (g.catchFlash) { g.catchFlash.t += dt / PARAMS.flashDurationS; if (g.catchFlash.t >= 1) g.catchFlash = null; }
    if (g.bounceFlash) { g.bounceFlash.t += dt / PARAMS.flashDurationS; if (g.bounceFlash.t >= 1) g.bounceFlash = null; }
    if (g.clearFx) { g.clearFx.t += dt / PARAMS.clearFxS; if (g.clearFx.t >= 1) g.clearFx = null; }
    g.beatFxList = g.beatFxList.filter(function (fx) { fx.t += dt / PARAMS.beatFxS; return fx.t < 1; });
    g.chainFxList = g.chainFxList.filter(function (fx) { fx.t += dt / PARAMS.chainFxS; return fx.t < 1; });

    finalizePendingRelPass(g);

    var dying = g.hp <= 0 && g.pendingDeathReasons.length > 0;
    updateWindow(g);
    if (!dying) {
      var cleared = checkClear(g);
      if (!cleared && (g.frameRotated || g.frameExpired)) checkStuck(g, g.frameRotated ? '網輪替' : '過期');
      advanceWave(g, dt);
    }
    updateZeroSat(g);
    g.frameRotated = false;

    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));

    g.sampleAcc += dt;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleInterval && guard < 10) { g.sampleAcc -= PARAMS.sampleInterval; emitSample(g); guard++; }

    checkDeath(g);
  }

  // ==================================================================
  // 局末彙整(逐局)
  // ==================================================================
  function segIndex(t) { return Math.floor(t / PARAMS.segmentMs); }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }

  function computeSummary(g) {
    var events = g.events;
    var spawns = byType(events, 'spawn');
    var drops = byType(events, 'drop');
    var expires = byType(events, 'expire');
    var swipes = byType(events, 'swipe');
    var nodes = byType(events, 'node');
    var heals = byType(events, 'heal');
    var relPasses = byType(events, 'relPass');
    var netAppears = byType(events, 'netAppear');
    var samples = byType(events, 'sample');
    var presses = byType(events, 'press');
    var pauses = byType(events, 'pause');
    var waves = byType(events, 'wave');
    var clearsEv = byType(events, 'clear');
    var stuckEv = byType(events, 'stuckShorten');

    var captureDrops = drops.filter(function (d) { return d.outcome === 'captured'; });
    var bounceCondDrops = drops.filter(function (d) { return d.outcome === 'bounceCond'; });
    var bounceOuterDrops = drops.filter(function (d) { return d.outcome === 'bounceOuter'; });
    var stayInnerDrops = drops.filter(function (d) { return d.outcome === 'stayInner'; });
    var slotOffDrops = drops.filter(function (d) { return d.category === 'slotOff'; });
    var effectiveSwipes = swipes.filter(function (s) { return s.classification === '生效'; });
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
        lockedDiffCount: stageLocked.filter(function (d) { return d.lockedSameAsExisting === false; }).length,
        batchCount: waves.filter(function (w2) { return w2.startStage === s; }).length,
        clearCount: clearsEv.filter(function (d) { return d.stage === s; }).length,
        stuckShortenCount: stuckEv.filter(function (d) { return d.stage === s; }).length,
        capturePerMinute: dwellMs > 0 ? stageCaptures.length / (dwellMs / 60000) : null
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

    function busyRateFor(sampleSubset, captureSubset) {
      var busySecSet = {}; var busySec = 0;
      sampleSubset.forEach(function (s) { if (s.processableCount >= 2) { busySecSet[Math.floor(s.t / 1000)] = true; busySec++; } });
      var busyCaptures = captureSubset.filter(function (d) { return busySecSet[Math.floor(d.t / 1000)]; }).length;
      return { busySeconds: busySec, rate: ratio(busyCaptures, busySec) };
    }
    var backlogGlobal = busyRateFor(samples, captureDrops);
    var backlogByStage = {};
    stageIds.forEach(function (s) { backlogByStage[s] = busyRateFor(samples.filter(function (sm) { return sm.stage === s; }), captureDrops.filter(function (d) { return d.stage === s; })); });

    if (g.dangerOpenSince != null) {
      var tail = (g.elapsed - g.dangerOpenSince) / 1000;
      g.dangerSecTotal += tail;
      var lastEntry = g.dangerEntries[g.dangerEntries.length - 1];
      if (lastEntry && lastEntry.durationSec == null) lastEntry.durationSec = tail;
      g.dangerOpenSince = null;
    }
    var dangerRatio = durationSec > 0 ? g.dangerSecTotal / durationSec : null;

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
        if (!longestGap || durSec > longestGap.durationSec) longestGap = { startMs: a0, endMs: b0, durationSec: durSec, handFreeSec: handFreeSec, handFreeAndSatisfiableSec: handFreeAndSatisfiableSec, maxFieldCount: maxField, hadStuckShorten: stuckEv.some(function (e) { return e.t >= a0 && e.t < b0; }) };
      }
    }

    function idleRatios(subsetSamples) {
      var zero = subsetSamples.filter(function (s) { return !s.anyHoldOrDrag && s.satisfiableCount === 0 && s.waveState !== '清場後空檔' && s.waveState !== '卡死縮短後空檔'; }).length;
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
      var segSpawnIds = Object.keys(g.bubbleRec).filter(function (id) { return within(g.bubbleRec[id].spawnElapsed); });
      segments.push({
        index: s, startMs: segStart, endMs: segEnd, spawnCount: segSpawn, captureCount: segCap, expireCount: segExp, bounceCondCount: segBounce, mistakeCount: segMistake, supplyCount: segSupply, avgNetInFieldMs: avgOf(segNetCaptured),
        clearCount: clearsEv.filter(function (e) { return within(e.t); }).length,
        stuckShortenCount: stuckEv.filter(function (e) { return within(e.t); }).length,
        batchCount: waves.filter(function (e) { return within(e.startMs); }).length,
        spawnOutcome: {
          captured: segSpawnIds.filter(function (id) { return g.bubbleRec[id].outcome === 'captured'; }).length,
          expired: segSpawnIds.filter(function (id) { return g.bubbleRec[id].outcome === 'expired'; }).length,
          residual: segSpawnIds.filter(function (id) { return g.bubbleRec[id].outcome == null || g.bubbleRec[id].outcome === 'residual'; }).length
        }
      });
    }
    var spawnBatchOutcome = segments.map(function (sg) { return { index: sg.index, spawnCount: sg.spawnCount, captured: sg.spawnOutcome.captured, expired: sg.spawnOutcome.expired, residual: sg.spawnOutcome.residual, captureRate: ratio(sg.spawnOutcome.captured, sg.spawnCount) }; });

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
        clearBefore: countIn(clearsEv, before), clearAfter: survived30 ? countIn(clearsEv, after) : null,
        batchesBefore: waves.filter(function (e) { return e.startMs >= before.start && e.startMs < before.end; }).length,
        batchesAfter: survived30 ? waves.filter(function (e) { return e.startMs >= after.start && e.startMs < after.end; }).length : null,
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
    var indicator2 = { firstElapsedMs: g.firstDangerElapsedMs, firstStage: g.firstDangerStage, ratio: dangerRatio, firstRatioOfDuration: durationSec > 0 && g.firstDangerElapsedMs != null ? (g.firstDangerElapsedMs / 1000) / durationSec : null };
    var indicator4 = {
      bounceCondRate: ratio(bounceCondDrops.length, captureDrops.length + bounceCondDrops.length),
      slotOffRate: ratio(slotOffDrops.length, drops.length)
    };
    var indicator6 = {
      mistakeColorRate: ratio(mistakeColorSwipes.length, effectiveSwipes.filter(function (s) { return s.zoneKind === 'paint'; }).length),
      mistakeShapeRate: ratio(mistakeShapeSwipes.length, effectiveSwipes.filter(function (s) { return s.zoneKind === 'shape'; }).length)
    };
    var lastFullHpToDeathSec = g.lastFullHpElapsedMs == null ? null : (g.elapsed - g.lastFullHpElapsedMs) / 1000;

    function shareOf(phase) {
      var secFirst60 = Math.min(60, durationSec), secAfter60 = Math.max(0, durationSec - 60);
      return { r0to60: ratio(g.phaseSec[phase][0], secFirst60), rAfter60: ratio(g.phaseSec[phase][1], secAfter60) };
    }
    var endedWaves = waves.filter(function (w2) { return w2.endedBy === '下一批出現'; });
    function clearRateOf(list) { return ratio(list.filter(function (w2) { return w2.cleared; }).length, list.length); }
    var clearByStage = stageIds.map(function (s) {
      var l = endedWaves.filter(function (w2) { return w2.startStage === s; });
      var cl = l.filter(function (w2) { return w2.cleared; });
      var ts = cl.map(function (w2) { return w2.clearAfterOutMs; });
      return { stage: s, endedBatches: l.length, cleared: cl.length, clearRate: ratio(cl.length, l.length), afterOutMedianMs: median(ts), afterOutP90Ms: p90(ts) };
    });
    var clearBy30 = segments.map(function (sg) {
      var l = endedWaves.filter(function (w2) { return w2.startMs >= sg.startMs && w2.startMs < sg.endMs; });
      return { index: sg.index, endedBatches: l.length, cleared: l.filter(function (w2) { return w2.cleared; }).length, clearRate: clearRateOf(l) };
    });
    var firstNoClear = endedWaves.filter(function (w2) { return !w2.cleared; })[0] || null;
    var streak = 0, longestStreak = 0;
    endedWaves.forEach(function (w2) { if (w2.cleared) { streak++; if (streak > longestStreak) longestStreak = streak; } else streak = 0; });
    var clearedWithExpiry = waves.filter(function (w2) { return w2.cleared && w2.clearHadExpiry; });
    var expDiffs = [];
    waves.forEach(function (w2) { if (w2.cleared && w2.clearExpiredBatchDiffs) expDiffs = expDiffs.concat(w2.clearExpiredBatchDiffs); });
    var clearSummary = {
      clearCount: g.totals.clears, batchCount: g.totals.batches, endedBatchCount: endedWaves.length, clearRate: clearRateOf(endedWaves),
      byStage: clearByStage, by30s: clearBy30,
      withExpiryCount: clearedWithExpiry.length, withExpiryShare: ratio(clearedWithExpiry.length, g.totals.clears), expiredBatchSeqDiffs: expDiffs,
      clearScoreTotal: g.totals.clears * PARAMS.clearScore, longestClearStreak: longestStreak,
      firstNotClearedBatch: firstNoClear ? { batchSeq: firstNoClear.batchSeq, startMs: firstNoClear.startMs } : null,
      clearGapShareOfDuration: shareOf('clear')
    };
    var stuckSummary = {
      count: stuckEv.length,
      byTrigger: { networkRotation: stuckEv.filter(function (e) { return e.trigger === '網輪替'; }).length, expire: stuckEv.filter(function (e) { return e.trigger === '過期'; }).length },
      remainBeforeSec: stuckEv.map(function (e) { return e.remainBeforeSec; }),
      countOnFieldAtTrigger: stuckEv.map(function (e) { return e.countOnField; }),
      supplyCountAtTrigger: stuckEv.map(function (e) { return e.supplyCount; }),
      stuckGapShareOfDuration: shareOf('stuck')
    };
    var zsEv = byType(events, 'zeroSatSegment');
    function zsStats(list) { var ls = list.map(function (e) { return e.lengthSec; }); return { count: list.length, maxSec: maxOf(ls), medianSec: median(ls), totalSec: ls.reduce(function (a, b) { return a + b; }, 0) }; }
    var zeroSatSummary = {
      all: zsStats(zsEv), shareOfDuration: ratio(zsStats(zsEv).totalSec, durationSec),
      byCause: { afterRotation: zsStats(zsEv.filter(function (e) { return e.cause === '網輪替後'; })), afterExpire: zsStats(zsEv.filter(function (e) { return e.cause === '過期後'; })), afterSwipe: zsStats(zsEv.filter(function (e) { return e.cause === '擦過後'; })) }
    };
    var winEv = byType(events, 'clearWindow'), winCaps = byType(events, 'windowCapture');
    function gapBucket(v) { return v == null ? 'none' : (v <= 3 ? '<=3' : (v <= 6 ? '3~6' : '>6')); }
    var capGroups = {};
    winCaps.forEach(function (c) {
      var key = c.stage + '|' + c.countOnFieldAtPress + '|' + gapBucket(c.gapLeftAtPressSec);
      var gr = capGroups[key] = capGroups[key] || { stage: c.stage, countOnFieldAtPress: c.countOnFieldAtPress, gapLeftBucket: gapBucket(c.gapLeftAtPressSec), intervals: [], speeds: [] };
      if (c.intervalLastDropToPressMs != null) gr.intervals.push(c.intervalLastDropToPressMs);
      if (c.dragSpeed != null) gr.speeds.push(c.dragSpeed);
    });
    var chaseSummary = {
      windowCount: winEv.length, convertedToClearShare: ratio(winEv.filter(function (e) { return e.closeReason === '清場'; }).length, winEv.length),
      offByOneCount: winEv.filter(function (e) { return e.offByOne; }).length,
      offByOneBlockedBySupplyCount: winEv.filter(function (e) { return e.offByOneIsUnsatisfiableSupply; }).length,
      gameIndex: g.gameIndex,
      captureGroups: Object.keys(capGroups).map(function (k) {
        var gr = capGroups[k];
        return { stage: gr.stage, countOnFieldAtPress: gr.countOnFieldAtPress, gapLeftBucket: gr.gapLeftBucket, n: gr.intervals.length, intervalMedianMs: median(gr.intervals), dragSpeedMedian: median(gr.speeds) };
      })
    };
    var cycleSums = waves.map(function (w2, wi) {
      var endMs = wi + 1 < waves.length ? waves[wi + 1].startMs : Infinity;
      var caps = captureDrops.filter(function (d) { return d.t >= w2.startMs && d.t < endMs; });
      return { stage: w2.startStage, sumMs: caps.reduce(function (a, d) { return a + (d.netInFieldMs || 0); }, 0), captures: caps.length };
    });
    function stdOf(arr) { if (arr.length < 2) return null; var m = avgOf(arr); return Math.sqrt(arr.reduce(function (a, v) { return a + (v - m) * (v - m); }, 0) / arr.length); }
    var cycleNetTimeByStage = stageIds.map(function (s) {
      var v = cycleSums.filter(function (c) { return c.stage === s; }).map(function (c) { return c.sumMs; });
      return { stage: s, cycles: v.length, avgMs: avgOf(v), stdMs: stdOf(v) };
    });
    function fieldGroup(n) { return n <= 2 ? '1~2' : (n <= 6 ? String(n) : (n <= 8 ? '7~8' : '9+')); }
    function netTimeByField(stageFilter) {
      var out = {};
      netAppears.forEach(function (na) {
        if (stageFilter != null && na.stage !== stageFilter) return;
        var cap = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0];
        if (!cap) return;
        var key = fieldGroup(na.countOnFieldAtAppear) + (na.condition && na.condition.shape != null ? '|兩項' : '|一項');
        (out[key] = out[key] || []).push(cap.netInFieldMs);
      });
      var res = {};
      Object.keys(out).forEach(function (k) { res[k] = { n: out[k].length, medianMs: median(out[k]) }; });
      return res;
    }
    var netTimeByFieldCount = { global: netTimeByField(null) };
    stageIds.forEach(function (s) { netTimeByFieldCount['stage' + s] = netTimeByField(s); });
    var twoCondByStage = [3, 4, 5].map(function (s) {
      var ms = netAppears.filter(function (na) { return na.stage === s && na.condition && na.condition.shape != null; }).map(function (na) {
        var cap = captureDrops.filter(function (d) { return d.netSeq === na.netSeq; })[0]; return cap ? cap.netInFieldMs : null;
      }).filter(function (v) { return v != null; });
      return { stage: s, n: ms.length, medianMs: median(ms), p90Ms: p90(ms) };
    });
    var s4rate = backlogByStage[4] ? backlogByStage[4].rate : null;
    var s4item = (s4rate != null && s4rate > 0) ? 1 / s4rate : null;
    var playerClass = { stage4ItemTimeSec: s4item, result: s4item == null ? '未分類' : (s4item >= 2.5 ? '新手' : (s4item <= 2.0 ? '熟手' : '中間')) };
    var finishByStage = stageIds.map(function (s) {
      var l = waves.filter(function (w2) { return w2.startStage === s; });
      var ts = l.filter(function (w2) { return w2.lastLeaveAfterStartMs != null; }).map(function (w2) { return w2.lastLeaveAfterStartMs; });
      return { stage: s, batches: l.length, medianMs: median(ts), p90Ms: p90(ts), notLeftCount: l.length - ts.length };
    });
    var placementTotals = { formationPoint: 0, backup: 0, forced: 0 };
    waves.forEach(function (w2) { placementTotals.formationPoint += w2.placement.formationPoint; placementTotals.backup += w2.placement.backup; placementTotals.forced += w2.placement.forced; });
    var byFormation = {};
    waves.forEach(function (w2) {
      var f = byFormation[w2.formation] = byFormation[w2.formation] || { batches: 0, endedBatches: 0, cleared: 0 };
      f.batches++;
      if (w2.endedBy === '下一批出現') { f.endedBatches++; if (w2.cleared) f.cleared++; }
    });
    Object.keys(byFormation).forEach(function (k) { byFormation[k].clearRate = ratio(byFormation[k].cleared, byFormation[k].endedBatches); });
    var residualByStage = stageIds.map(function (s) {
      return { stage: s, residualAtBatchStart: waves.filter(function (w2) { return w2.startStage === s; }).map(function (w2) { return w2.residualAtStart.prevBatch + w2.residualAtStart.olderBatches; }) };
    });
    var batchShare = { one: ratio(samples.filter(function (s) { return s.batchesOnField <= 1; }).length, samples.length), two: ratio(samples.filter(function (s) { return s.batchesOnField === 2; }).length, samples.length), threePlus: ratio(samples.filter(function (s) { return s.batchesOnField >= 3; }).length, samples.length) };
    var diedByExpire = g.deathReasons.indexOf('過期') !== -1;
    var multiBatchSecBeforeDeath = null;
    if (diedByExpire) {
      multiBatchSecBeforeDeath = 0;
      for (var si = samples.length - 1; si >= 0 && samples[si].batchesOnField >= 2; si--) multiBatchSecBeforeDeath++;
    }
    var fullWaves = waves.filter(function (w2) { return w2.placement.formationPoint + w2.placement.backup + w2.placement.forced === w2.n; });
    var spawnedOverBatchN = ratio(fullWaves.reduce(function (a, w2) { return a + w2.placement.formationPoint + w2.placement.backup + w2.placement.forced; }, 0), fullWaves.reduce(function (a, w2) { return a + w2.n; }, 0));
    var deathAnalysis = null, oneBatchDeath = null;
    if (diedByExpire) {
      var dseqs = uniqArr(g.deathBatchSeqs);
      deathAnalysis = dseqs.map(function (seq) {
        var bt = g.batches[seq - 1];
        return {
          batchSeq: seq, n: bt ? bt.n : null, capturedCount: captureDrops.filter(function (d) { return d.batchSeq === seq; }).length,
          prev3Batches: [1, 2, 3].map(function (k) { var pb = g.batches[seq - 1 - k]; return pb ? { batchSeq: pb.rec.batchSeq, tailCount: pb.rec.batchExpiredCount, cycleCaptures: pb.rec.cycleCaptures } : null; })
        };
      });
      var sf = uniqArr(g.sinceFull.batchSeqs);
      oneBatchDeath = { value: g.lastFullHpElapsedMs != null && !g.sinceFull.hadGain && sf.length === 1, batchSeq: sf.length === 1 ? sf[0] : null };
    }
    var stage5 = null;
    if (stageOf(g.elapsed) >= 5) {
      var s5item = (backlogByStage[5] && backlogByStage[5].rate > 0) ? 1 / backlogByStage[5].rate : null;
      var s5samples = samples.filter(function (s) { return s.stage === 5; });
      var crashWindow = null;
      for (var wstart = 0; wstart + 10000 <= g.elapsed && !crashWindow; wstart += 10000) {
        var inWin = s5samples.filter(function (s) { return s.t >= wstart && s.t < wstart + 10000; });
        if (!inWin.length) continue;
        var capIn = captureDrops.filter(function (d) { return d.t >= wstart && d.t < wstart + 10000; }).length;
        var avgField = avgOf(inWin.map(function (s) { return s.countOnField; }));
        if (capIn <= 2 && avgField != null && avgField >= 7) crashWindow = { startMs: wstart };
      }
      stage5 = {
        gaps: waves.filter(function (w2) { return w2.gapCalcAtSec != null && w2.gapCalcAtSec >= 160; }).map(function (w2) { return { batchSeq: w2.batchSeq, scheduledSec: w2.scheduledGapSec, actualSec: w2.actualGapSec, cleared: w2.cleared, stuckShortened: w2.stuckShortened }; }),
        stage5ItemTimeSec: s5item,
        crash: crashWindow ? {
          atMs: crashWindow.startMs,
          fieldAtCrash: avgOf(s5samples.filter(function (s) { return s.t >= crashWindow.startMs && s.t < crashWindow.startMs + 10000; }).map(function (s) { return s.countOnField; })),
          hpAtCrash: (s5samples.filter(function (s) { return s.t >= crashWindow.startMs; })[0] || {}).hp,
          stage5ElapsedSec: (crashWindow.startMs - SHRINK_START) / 1000
        } : { note: '未崩盤' }
      };
      if (diedByExpire) {
        var lastW = waves[waves.length - 1];
        var gapAtDeath = lastW && lastW.scheduledGapSec != null ? lastW.scheduledGapSec : (waves.length > 1 ? waves[waves.length - 2].scheduledGapSec : null);
        if (lastW && gapAtDeath != null) {
          stage5.scheduledSpawnRateAtDeath = lastW.n / (PARAMS.outDuration + gapAtDeath);
          stage5.cycleOverItemTimeAtDeath = s5item ? (PARAMS.outDuration + gapAtDeath) / s5item : null;
        }
        stage5.spawnedLast30sOver30 = spawns.filter(function (e) { return e.t >= g.elapsed - 30000; }).length / 30;
      }
    }
    var genOverProcess = stageIds.map(function (s) {
      var st = stageStats[s - 1], r = backlogByStage[s] ? backlogByStage[s].rate : null;
      var genRate = st.dwellSec > 0 ? st.spawnCount / st.dwellSec : null;
      return { stage: s, spawnRate: genRate, backlogProcessRate: r, ratio: (genRate != null && r > 0) ? genRate / r : null };
    });
    var waveSummary = {
      clear: clearSummary, stuck: stuckSummary, zeroSat: zeroSatSummary, chase: chaseSummary,
      cycleNetTimeByStage: cycleNetTimeByStage, netTimeByFieldCount: netTimeByFieldCount, twoConditionNetTimeByStage: twoCondByStage,
      isFirstGame: g.gameIndex === 1,
      playerClass: playerClass, finishBatchTimeByStage: finishByStage, placementTotals: placementTotals, byFormation: byFormation,
      residualByStage: residualByStage, batchesOnFieldShare: batchShare, multiBatchSecBeforeDeath: multiBatchSecBeforeDeath,
      spawnedOverBatchN: spawnedOverBatchN, deathAnalysis: deathAnalysis, oneBatchDeath: oneBatchDeath, stage5: stage5,
      generationOverProcessRate: genOverProcess,
      phaseSeconds: g.phaseSec,
      firstExpire: { batchSeq: g.firstExpireBatchSeq, batchesOnField: g.firstExpireBatchesOnField }
    };

    // ================= 踩拍 / 拍子讀數(v13 新增) =================
    var countedNodes = nodes.filter(function (n) { return n.counted; });
    var nodeTypes = ['抓起', '第一次沾上', '第二次沾上', '送進網'];
    var beatByType = {};
    nodeTypes.forEach(function (ty) {
      var list = countedNodes.filter(function (n) { return n.nodeType === ty; });
      var onBeatList = list.filter(function (n) { return n.onBeat; });
      beatByType[ty] = { count: list.length, onBeatCount: onBeatList.length, rate: ratio(onBeatList.length, list.length), diffs: list.map(function (n) { return n.diffMs; }) };
    });
    var beatByTypeStage = {};
    stageIds.forEach(function (s) {
      beatByTypeStage[s] = {};
      nodeTypes.forEach(function (ty) {
        var list = countedNodes.filter(function (n) { return n.nodeType === ty && n.stage === s; });
        var onBeatList = list.filter(function (n) { return n.onBeat; });
        beatByTypeStage[s][ty] = { count: list.length, rate: ratio(onBeatList.length, list.length) };
      });
    });
    function iqr(arr) {
      if (arr.length < 4) return null;
      var s = arr.slice().sort(function (a, b) { return a - b; });
      var q1 = s[Math.floor(s.length * 0.25)], q3 = s[Math.floor(s.length * 0.75)];
      return q3 - q1;
    }
    var timeDiffConcentration = {};
    nodeTypes.forEach(function (ty) {
      var d = beatByType[ty].diffs;
      timeDiffConcentration[ty] = { medianMs: median(d), iqrMs: iqr(d) };
    });
    var edgeNodes = countedNodes.filter(function (n) { return n.nodeType === '抓起' || n.nodeType === '送進網'; });
    var onBeatRateMain = ratio(edgeNodes.filter(function (n) { return n.onBeat; }).length, edgeNodes.length);
    var beatClass = onBeatRateMain == null ? '未知' : (onBeatRateMain < 0.5 ? '不踩拍' : (onBeatRateMain <= 0.7 ? '半數' : '大部分'));
    var chainCaptures = captureDrops.filter(function (d) { return d.isChain; });
    var captureByOnBeatCount = [0, 1, 2, 3, 4].map(function (n) {
      var list = captureDrops.filter(function (d) { return d.nodeOnBeatTotal === n; });
      return { onBeatCount: n, n: list.length, medianNetInFieldMs: median(list.map(function (d) { return d.netInFieldMs; })) };
    });
    var bucket10 = {};
    for (var bk = -200; bk <= 190; bk += 10) bucket10[bk] = 0;
    countedNodes.forEach(function (n) {
      var v = Math.max(-200, Math.min(199, n.diffMs));
      var k = Math.floor(v / 10) * 10;
      bucket10[k] = (bucket10[k] || 0) + 1;
    });
    var healSummary = {
      byKindTotal: { catch: 0, beat: 0, chain: 0 }, overflowByKind: { catch: 0, beat: 0, chain: 0 },
      overflowByStagePhase: { s1to4: 0, s5: 0 }
    };
    heals.forEach(function (h) {
      healSummary.byKindTotal[h.source] = (healSummary.byKindTotal[h.source] || 0) + h.applied;
      healSummary.overflowByKind[h.source] = (healSummary.overflowByKind[h.source] || 0) + h.overflowPts;
      if (h.stage <= 4) healSummary.overflowByStagePhase.s1to4 += h.overflowPts; else healSummary.overflowByStagePhase.s5 += h.overflowPts;
    });
    var beatReading = {
      byType: beatByType, byTypeByStage: beatByTypeStage, timeDiffConcentration: timeDiffConcentration,
      onBeatRateMainNodes: onBeatRateMain, beatClass: beatClass,
      chainCaptureCount: chainCaptures.length, chainShareOfCaptures: ratio(chainCaptures.length, captureDrops.length),
      captureByOnBeatCount: captureByOnBeatCount, timeDiffHistogram10ms: bucket10,
      healSummary: healSummary
    };

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

    var capturePerMinuteByStage = stageStats.map(function (st) { return { stage: st.stage, capturePerMinute: st.capturePerMinute }; });
    var mainIndicators = {
      indicator1_netInFieldTime: indicator1,
      indicator2_dangerShare: { r0to60: idle0to60, rAfter60: idleAfter60, clearGapShare: shareOf('clear'), stuckGapShare: shareOf('stuck') },
      indicator3_longestNoCaptureGap: { longestGap: longestGap, captureIntervals: indicator3, capturePerMinuteByStage: capturePerMinuteByStage },
      indicator4_bounceCond: indicator4,
      indicator5_dangerAndDeath: { ratio: dangerRatio, firstEnter: indicator2, lastFullHpToDeathSec: lastFullHpToDeathSec, oneBatchDeath: oneBatchDeath, multiBatchSecBeforeDeath: multiBatchSecBeforeDeath },
      indicator6_clear: clearSummary,
      auxiliary_mistakeRate: indicator6,
      chaseClear: chaseSummary,
      beatReading: beatReading
    };

    return {
      durationSec: durationSec,
      maxStageReached: stageOf(g.elapsed),
      stageStats: stageStats,
      slotCaptureCounts: slotCaptureCounts,
      netInFieldBySlotDiffMedian: { 2: median(netInFieldBySlotDiff[2]), 3: median(netInFieldBySlotDiff[3]), 4: median(netInFieldBySlotDiff[4]) },
      netInFieldByCondCountMedian: { 1: median(netInFieldByCondCount[1]), 2: median(netInFieldByCondCount[2]) },
      backlogProcessingRate: { global: backlogGlobal, byStage: backlogByStage },
      lastFullHpElapsedMs: g.lastFullHpElapsedMs, secFromLastFullHpToDeath: lastFullHpToDeathSec,
      danger: { firstElapsedMs: g.firstDangerElapsedMs, firstStage: g.firstDangerStage, ratio: dangerRatio, entries: g.dangerEntries },
      hpCurve: g.hpCurve, totalHpGainedEvents: heals.length,
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
      mistake: { colorRate: indicator6.mistakeColorRate, shapeRate: indicator6.mistakeShapeRate, colorCount: mistakeColorSwipes.length, shapeCount: mistakeShapeSwipes.length },
      relPass: { byPair: relPassByPair, total: relPasses.length, touchedCount: relPasses.filter(function (r) { return r.touchedEither; }).length },
      wave: waveSummary,
      eventCountTotals: {
        spawn: spawns.length, captured: captureDrops.length, expired: expires.length, bounceCond: bounceCondDrops.length,
        slotOff: slotOffDrops.length, holdNoDrag: g.totals.holdNoDrag, swipeEffective: g.totals.swipeEffective,
        swipeLocked: g.totals.swipeLocked, mistake: mistakeSwipes.length, supply: supplyDrops.length, netAppear: netAppears.length,
        batches: g.totals.batches, clears: g.totals.clears, stuckShortens: g.totals.stuckShortens,
        nodeCounted: g.totals.nodeCounted, nodeOnBeat: g.totals.nodeOnBeat
      },
      dragTimeRatio: null,
      sound: {
        mutedSecRatio: durationSec > 0 ? g.muteSecAcc / durationSec : null,
        audioOutputLatencySec: g.audioOutputLatencySec,
        avgFrameIntervalMs: g.frameIntervalCount > 0 ? (g.frameIntervalSum / g.frameIntervalCount) : null
      },
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
        spawnElapsedMs: b.spawnElapsed, spawnStage: b.spawnStage, life: Math.max(0, b.life), grabCount: b.grabCount,
        beatNodes: b.beatNode
      });
    });
    closeWindow(g, 'end');
    closeZeroSat(g, '局結束');
    if (g.wave.cur) flushBatch(g, g.wave.cur, '局結束');
    g.batches.forEach(function (bt) { if (bt.leftCount < bt.n) bt.rec.lastLeaveNote = '未離場'; });
    emit(g, 'stageChange', { note: 'final-net-in-field', litNetSeq: g.netSeq, litNetCondition: g.netCondition, netInFieldMsAtEnd: g.netCondition ? (nowElapsed(g) - g.netAppearedAtElapsed) : null });
    var summary = computeSummary(g);
    var dragEndEvents = byType(g.events, 'dragEnd');
    var dragTotalMs = dragEndEvents.reduce(function (a, e) { return a + (e.durationMs || 0); }, 0);
    summary.dragTimeRatio = g.elapsed > 0 ? dragTotalMs / g.elapsed : null;
    var out = {
      playerId: PLAYER_ID, gameIndex: g.gameIndex, device: g.device, gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: {
        params: PARAMS, stageTimesMs: STAGE_MS,
        formations: FORM_ORDER.map(function (k) {
          var f = FORMATIONS[k];
          return { key: k, name: f.name, unlockStage: f.unlock, directions: f.dirs, supportedN: [3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (n) { return f.supports(n); }) };
        }),
        zones: ZONES.map(function (z) { return { id: z.id, kind: z.kind, color: z.color, shape: z.shape, angle: z.angle, x: z.x, y: z.y, r: z.r, rSmall: z.rSmall, stage: z.stage }; }),
        slots: SLOTS.map(function (s) { return { id: s.id, no: s.no, angle: s.angle, x: s.x, y: s.y, r: s.r }; })
      },
      countedForMainStats: (g.deathReasons.indexOf('放棄') === -1 && g.deathReasons.indexOf('重開') === -1),
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
      var uq = [];
      g.pendingDeathReasons.forEach(function (r) { if (uq.indexOf(r) === -1) uq.push(r); });
      if (uq.length === 0) uq = ['持續扣血'];
      g.deathReasons = uq;
    } else if (reason === 'restart') {
      g.deathReasons = ['重開'];
    } else if (reason === 'quit') {
      g.deathReasons = ['放棄'];
    } else {
      g.deathReasons = [reason];
    }
    try { Sound.stopMusic(); } catch (e) {}
    var downloadOk = finalizeAndDownload(g);
    endInfo = { time: g.elapsed / 1000, score: g.score, note: downloadOk ? '紀錄已下載' : '紀錄下載失敗' };
    lastGameEndWall = Date.now();
    if (reason === 'restart') { startNewGame(); screen = SCREEN.PLAYING; }
    else { screen = SCREEN.END; }
  }
  function startNewGame() {
    var idx = nextGameIndex();
    mouse.press = null; mouse.lastDropPos = null; mouse.netSeqAtLastDrop = null; mouse.pathLenSinceLastDrop = null;
    game = createGame(idx);
    endInfo = null;
    screen = SCREEN.PLAYING;
  }

  // ==================================================================
  // 輸入: 滑鼠(唯一操作方式, 守則 R1, 不掛鍵盤事件)
  // ==================================================================
  var mouse = { x: 0, y: 0, press: null, uiDownKey: null, inside: false, lastDropPos: null };

  function updateMousePos(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.inside = true;
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
  function muteBtnLocate(p) { return inRect(p.x, p.y, L.muteButton); }

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
    if (pauseBtnLocate(p)) { mouse.uiDownKey = 'pauseBtn'; return; } // 暫停按鈕遊戲中常駐, 預備拍期間也能按
    mouse.uiDownKey = null;
    if (g.phase !== 'playing') return; // 預備拍期間場上沒有氣泡, 不需處理抓取
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
    target.pressElapsed = now;
    target.pressClockMs = g.clockMs;
    target.spawnAge = PARAMS.spawnFxS;
    var wv = g.wave;
    target.pressInfo = {
      intervalSinceLastDropMs: intervalSinceLastDrop,
      gapLeftAtPress: wv.phase === 'out' ? null : wv.gapLeft,
      fieldAtPress: fieldCount(g), waveStateAtPress: waveStateName(g)
    };
    if (wv.cur && wv.cur.rec.firstPressDelayMs == null) wv.cur.rec.firstPressDelayMs = now - wv.cur.rec.startMs;
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
        var originX = b.x, originY = b.y;
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
        var rankList = g.bubbles.filter(function (o) { return o === b || o.mode === 'idle'; });
        var lifeRank = 1 + rankList.filter(function (o) { return o !== b && o.life < b.life; }).length;
        var distRank = null;
        if (mouse.lastDropPos) {
          var myD = dist(mouse.lastDropPos.x, mouse.lastDropPos.y, originX, originY);
          distRank = 1 + rankList.filter(function (o) { return o !== b && dist(mouse.lastDropPos.x, mouse.lastDropPos.y, o.x, o.y) < myD; }).length;
        }
        emit(g, 'grab', {
          bubbleId: b.id, distanceAtDragStart: d0, msAtDragStart: now - press.downTime,
          color: b.color, shape: b.shape, remainingLifeMs: Math.round(b.life * 1000), countOnField: fieldCount(g),
          processableCount: processableCount(g), lifeRank: lifeRank, distanceRank: distRank, grabOrdinal: b.grabCount, alreadyIntersectingZoneId: already,
          litNetSeq: g.netSeq, litSlot: g.netSlot, litCondition: { color: net.color, shape: net.shape },
          colorMatch: matchField('color'), shapeMatch: matchField('shape'),
          neededDistanceColor: neededDist('color'), neededDistanceShape: net.shape != null ? neededDist('shape') : null,
          satisfiedCountAtGrab: alreadyMatchCount(g), isSupply: b.isSupply, isMistake: b.isMistake
        });
        // 抓起節點(只在這顆第一次被拖曳時計次; 判定用按下那一刻的拍子時鐘)
        var isFirstGrab = (b.grabCount === 1);
        var chk = emitNode(g, b, '抓起', isFirstGrab, b.pressClockMs == null ? g.clockMs : b.pressClockMs, PARAMS.beatWindowEdge);
        if (isFirstGrab) {
          b.beatNode.grab = chk.onBeat;
          if (chk.onBeat) rewardBeatNode(g, b, b.x, b.y);
        }
      }
    } else {
      var clamped2 = clampDrag(p.x, p.y);
      var prev = { x: b.x, y: b.y };
      var moved = dist(prev.x, prev.y, clamped2.x, clamped2.y);
      b.dragPathLen += moved;
      b.x = clamped2.x; b.y = clamped2.y;
      processDragSegment(g, b, prev, clamped2, g.elapsed, g.clockMs, g.clockMs);
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
      mouse.netSeqAtLastDrop = g.netSeq;
      mouse.pathLenSinceLastDrop = 0;
      mouse.lastDropPos = { x: p.x, y: p.y };
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
    ensureSoundInit();
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if ((screen === SCREEN.PLAYING || screen === SCREEN.PAUSED) && muteBtnLocate(p)) { mouse.uiDownKey = 'muteBtn'; return; }
    if (screen === SCREEN.TITLE) mouse.uiDownKey = titleLocate(p);
    else if (screen === SCREEN.INPUT) mouse.uiDownKey = inputLocate(p);
    else if (screen === SCREEN.PLAYING) handlePlayingMouseDown(p);
    else if (screen === SCREEN.PAUSED) mouse.uiDownKey = pauseMenuLocate(p);
    else if (screen === SCREEN.GUIDE) mouse.uiDownKey = guideLocate(p);
    else if (screen === SCREEN.END) mouse.uiDownKey = endLocate(p);
  });
  canvas.addEventListener('mouseleave', function () { mouse.inside = false; titleHover = null; inputHover = null; pauseBtnHover = false; muteHover = false; pauseMenuHover = null; guideHover = null; endHover = null; });
  canvas.addEventListener('mousemove', function (e) {
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (screen === SCREEN.TITLE) titleHover = titleLocate(p);
    else if (screen === SCREEN.INPUT) inputHover = inputLocate(p);
    else if (screen === SCREEN.PLAYING) { pauseBtnHover = pauseBtnLocate(p); muteHover = muteBtnLocate(p); handlePlayingMouseMove(p); }
    else if (screen === SCREEN.PAUSED) { pauseMenuHover = pauseMenuLocate(p); muteHover = muteBtnLocate(p); }
    else if (screen === SCREEN.GUIDE) guideHover = guideLocate(p);
    else if (screen === SCREEN.END) endHover = endLocate(p);
  });
  function handleGenericMouseUp(e) {
    updateMousePos(e);
    var p = { x: mouse.x, y: mouse.y };
    if (mouse.uiDownKey === 'muteBtn') {
      if ((screen === SCREEN.PLAYING || screen === SCREEN.PAUSED) && muteBtnLocate(p)) toggleMute();
      mouse.uiDownKey = null;
      return;
    }
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
      if (mouse.press && !mouse.press.dragging) {
        // 按住未拖時失焦: 比照放開, 該顆留在原地、不算抓起節點, 記一筆「按住未拖」
        var hb = mouse.press.bubble;
        if (hb && !hb.dead) {
          hb.mode = 'idle';
          game.totals.holdNoDrag++;
          emit(game, 'holdNoDrag', { bubbleId: hb.id, freezeDurationMs: nowElapsed(game) - mouse.press.downTime, endReason: '放開' });
        }
        mouse.press = null;
      } else {
        forceBounceDrag(game, '失焦');
      }
      openPause(game, 'blur');
    }
  });

  // ==================================================================
  // 渲染
  // ==================================================================
  function bubbleRenderState(b, hoverId) {
    var st = { x: b.x, y: b.y, color: b.color, shape: b.shape, life: Math.max(0, b.life), lifeMax: b.lifeMax, mode: b.mode, swipeFx: b.swipeFx, swipeKind: b.swipeKind };
    if (b.spawnAge < PARAMS.spawnFxS) st.spawnT = clamp01(b.spawnAge / PARAMS.spawnFxS);
    if (hoverId != null && b.id === hoverId && b.mode === 'idle') st.hover = true;
    return st;
  }
  function zoneRenderState(z, st) {
    var s2 = { x: z.x, y: z.y, status: st.status, r: st.r };
    if (st.status === 'preview' || st.status === 'shrink') s2.previewT = st.previewT;
    if (st.status === 'shrink') s2.shrinkTo = st.shrinkTo;
    if (st.status === 'on') s2.introT = st.introT;
    return s2;
  }
  function currentBeatPhase(g) {
    var beat = beatOf(g.clockMs);
    var p = beat - Math.floor(beat);
    return p;
  }
  function renderGame() {
    var g = game;
    Art.drawBackground(ctx);
    Art.drawInnerRing(ctx);
    Art.drawBeatCue(ctx, { phase: currentBeatPhase(g) });
    if (g.clearFx) Art.drawClearFx(ctx, { t: clamp01(g.clearFx.t) });
    var elapsed = g.elapsed;
    var dragBubble = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;

    if (g.phase === 'playing') {
      for (var zi = 0; zi < ZONES.length; zi++) {
        var z = ZONES[zi];
        var zst = zoneStateAt(z, elapsed);
        if (!zst.exists) continue;
        var st = zoneRenderState(z, zst);
        if (z.kind === 'paint') { st.color = z.color; Art.drawPaintZone(ctx, st); }
        else { st.shape = z.shape; Art.drawShapeZone(ctx, st); }
      }
    }

    for (var i = 0; i < SLOTS.length; i++) {
      var sl = SLOTS[i];
      if (g.phase === 'playing' && sl.no === g.netSlot) continue;
      var st2 = { x: sl.x, y: sl.y, status: 'off' };
      if (g.catchFlash && g.catchFlash.slotNo === sl.no) { st2.flash = 'catch'; st2.flashT = clamp01(g.catchFlash.t); }
      Art.drawNet(ctx, st2);
    }
    if (g.phase === 'playing' && g.netSlot != null) {
      var litDef = SLOT_BY_NO[g.netSlot];
      var hot = !!(dragBubble && dist(dragBubble.x, dragBubble.y, litDef.x, litDef.y) <= NET_R);
      var litState = { x: litDef.x, y: litDef.y, status: 'on', color: g.netCondition.color, shape: g.netCondition.shape, hot: hot };
      if (g.netLightT > 0 && g.netLightT < 1) { litState.lightT = g.netLightT; if (g.netFrom != null) litState.from = g.netFrom; }
      if (g.bounceFlash) { litState.flash = 'bounce'; litState.flashT = clamp01(g.bounceFlash.t); }
      Art.drawNet(ctx, litState);
    }

    var hoverB = (screen === SCREEN.PLAYING && !mouse.press && mouse.inside && g.phase === 'playing') ? findBubbleUnderPoint(g, mouse.x, mouse.y) : null;
    var hoverId = hoverB ? hoverB.id : null;
    var others = g.bubbles.filter(function (b) { return b.mode !== 'drag'; });
    for (var oi = 0; oi < others.length; oi++) Art.drawBubble(ctx, bubbleRenderState(others[oi], hoverId));
    if (dragBubble) Art.drawBubble(ctx, bubbleRenderState(dragBubble, null));

    for (var bf = 0; bf < g.beatFxList.length; bf++) { var fx = g.beatFxList[bf]; Art.drawBeatFx(ctx, { x: fx.x, y: fx.y, t: clamp01(fx.t) }); }
    for (var cf = 0; cf < g.chainFxList.length; cf++) { var cfx = g.chainFxList[cf]; Art.drawChainFx(ctx, { x: cfx.x, y: cfx.y, t: clamp01(cfx.t), nodes: cfx.nodes }); }

    if (g.phase === 'countIn') {
      var beat = beatOf(g.clockMs);
      var floorBeat = Math.max(-PARAMS.countInBeats, Math.min(-1, Math.floor(beat + 1e-9)));
      Art.drawCountIn(ctx, { beat: floorBeat, phase: currentBeatPhase(g) });
    }

    Art.drawHud(ctx, {
      hp: g.hp, hpMax: PARAMS.hpMax, danger: g.danger, time: g.phase === 'countIn' ? 0 : g.elapsed / 1000, paused: (screen === SCREEN.PAUSED), score: g.score, combo: g.combo,
      hpFlash: g.hpFlash, hpGainFx: g.hpGainFx, hpGainFrom: g.hpGainFrom, hpGainKind: g.hpGainKind,
      hpLossFrom: g.hpLossFrom, overflowFx: g.overflowFx, overflowPts: g.overflowPts
    });
    Art.drawPauseButton(ctx, { hover: pauseBtnHover });
    if (g.phase === 'playing') {
      var pv = previewInfo(elapsed);
      if (pv.inPreview) Art.drawStageNotice(ctx, { t: pv.previewT });
    }
  }
  function render() {
    if (screen === SCREEN.TITLE) Art.drawTitleScreen(ctx, { hover: titleHover, device: deviceType });
    else if (screen === SCREEN.INPUT) Art.drawInputSelect(ctx, { selected: deviceType, hover: inputHover });
    else if (screen === SCREEN.PLAYING) { renderGame(); Art.drawMuteButton(ctx, { muted: muted, hover: muteHover }); }
    else if (screen === SCREEN.PAUSED) { renderGame(); Art.drawPauseMenu(ctx, { hover: pauseMenuHover }); Art.drawMuteButton(ctx, { muted: muted, hover: muteHover }); }
    else if (screen === SCREEN.GUIDE) Art.drawGuidePage(ctx, { page: guidePage, hover: guideHover });
    else if (screen === SCREEN.END) Art.drawEndScreen(ctx, { time: endInfo ? endInfo.time : 0, score: endInfo ? endInfo.score : 0, note: endInfo ? endInfo.note : '', hover: endHover });
  }

  // ==================================================================
  // 主迴圈
  // ==================================================================
  var lastTs = null;
  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    var rawDt = ts - lastTs;
    lastTs = ts;
    var dt = Math.min(rawDt / 1000, 1 / 30); // 切分頁回來不瞬移
    if (screen === SCREEN.PLAYING && game && !game.paused) {
      if (game.frameIntervalCount < 600) { game.frameIntervalSum += rawDt; game.frameIntervalCount++; }
      tick(dt);
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
