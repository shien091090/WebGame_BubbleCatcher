// 捕泡手 遊戲邏輯(spec v14)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art, 聲音一律呼叫 window.Sound。
// 本版相對 v13: 三關三首歌(關內時間 / 關內拍序號為拍子權威)、換關(清場地、帶過的那一顆、預備拍)、八邊形網牆扇區判定、
// 每關地板對稱變換、踩拍節點只剩「沾上 / 送進網」、漸強三級、沾地板回饋、歌曲進度、說明 7 頁、v16 埋點。
// 交 RD 的「待定」項目與本版做法:
//   3. 一般碰撞推開: idle/hold 氣泡互推(3 pass, 不彈飛), 另疊加「推出已出場地板」; 推不開允許暫時重疊
//   4. 彈回落點: 內圈邊上最近點往圓心退一個氣泡半徑; 與地板相交時沿同半徑換角度找第一個不相交的, 全失敗用預設落點
//   5. 拖曳時氣泡中心 = 指標位置(無偏移); 內圈內外一律以「指標位置」判(放開時指標在畫面外但在視窗內改用氣泡中心)
//   6. 彈回中的氣泡視為靜態障礙物(擋別顆、自己不被推)
//   7. 同一幀順序: 段切換 → 本幀輸入(擦過 / 放開 / 捕捉 / 輪替 / 回血) → 物理與持續扣血 → 過期 → 清場 → 卡死 → 波次 → 換關
//   8. 滑鼠事件先進佇列, 在 tick 內依事件時刻換算成關內時間後處理; 擦過以兩幀間路徑掃描; 段切換那幀以「幀結束位置」判已相交
//   14. 判定偏移補償: 送進網 −20 毫秒、沾上 0 毫秒(見 PARAMS), 加在節點時刻上; 音樂輸出延遲交 sound.js 內建補償, 判定端不再補
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var GUIDE_PAGES = 7;
  var TAU = Math.PI * 2;
  var BUILD_VERSION = 'demo-v14-0.1.0';

  var CX = 640, CY = 360;
  var INNER_R = 210;
  var BUBBLE_R = 20;
  var MOVE_R = INNER_R - BUBBLE_R;       // 190, 閒置氣泡可活動半徑
  var WALL_APO = 300;
  var DRAG_B = { x0: 20, y0: 20, x1: 1260, y1: 700 };
  var FLOOR_RING = 140;
  var LIFE = 12;

  var PARAMS = {
    bubbleR: BUBBLE_R, floorR: 24, floorRSmall: 20, floorRing: FLOOR_RING, innerR: INNER_R,
    lifeSec: LIFE, hpMax: 100, hpStart: 60,
    hpCatchGain: 4, hpBeatGain: 2, hpChainGain: 4, hpExpireLoss: 6, overflowPerHp: 2,
    hpDangerEnter: 40, hpDangerExit: 50,
    beatWindowDeliverMs: 80, beatOffsetDeliverMs: -20,
    beatWindowStickBeats: 0.22, beatOffsetStickMs: 0,
    tierMax: 3,
    stickFxSec: 0.8,
    countInBeats: 4,
    previewBeats: 4, segSwitchBeat: 64,
    floorIntroSec: 2.0,
    lastNoBatchBeats: 2,
    clearScore: 50,
    clearBeatPts: [0, 2, 2, 3],           // 當關拍點數(清場後 / 卡死縮短後)
    windowOpenFrom: 3, windowOpenTo: 2,
    formationMaxR: 180, formationFloorMin: 48, formationGap: 44,
    spawnGap: 4, spawnTries: 10, spawnFxSec: 0.3,
    dragStartDist: 6, returnDurationSec: 0.2,
    scoreBase: 10, comboBonusPerStreak: 0.1, comboStreakCap: 20,
    periodMaxSec: 11.6,
    sampleIntervalSec: 1.0,
    relPassWindowMs: 150,
    drain: { l1f: 1.8, l1b: 2.2, l2f: 2.6, l2b: 3.1, l3base: 3.3, l3perSec: 0.025 },
    shapeProb: { l2f: 0.25, l2b: 0.4, l3: 0.4 },
    levelIntroSec: 2.4
  };

  var LEVELS = [null,
    { n: 1, bpm: 100, bars: 36, endBeat: 144, music: 'stage1', N: [4, 5], p: [[17, 16], [19, 16]], drain: [1.8, 2.2] },
    { n: 2, bpm: 115, bars: 40, endBeat: 160, music: 'stage2', N: [5, 6], p: [[18, 16], [19, 15]], drain: [2.6, 3.1] },
    { n: 3, bpm: 130, bars: 48, endBeat: null, music: 'stage3', N: [6, 6], p: null, drain: null }
  ];
  LEVELS.forEach(function (lv) {
    if (!lv) return;
    lv.beatSec = 60 / lv.bpm;
    lv.loopBeats = lv.bars * 4;
    lv.lenBeats = lv.endBeat;
  });

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  function avgOf(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
  function sumOf(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function ratio(num, den) { return den > 0 ? num / den : null; }
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function pctile(arr, p) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  }
  function p90(arr) { return pctile(arr, 0.9); }
  function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : null; }
  function minOf(arr) { return arr.length ? Math.min.apply(null, arr) : null; }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function r3(v) { return v == null ? null : Math.round(v * 1000) / 1000; }
  function angleOf(x, y) { var a = Math.atan2(y - CY, x - CX) * 180 / Math.PI; return (a + 360) % 360; }
  function angleDiff180(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function uniqArr(arr) { var o = []; arr.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 本機狀態(命名空間 bcv14_) ----------
  var PLAYER_ID_KEY = 'bcv14_playerId';
  var GAME_COUNT_KEY = 'bcv14_gameCount';
  var DEVICE_KEY = 'bcv14_device';
  var SEEN_GUIDE_KEY = 'bcv14_seenGuide';
  var MUTED_KEY = 'bcv14_muted';
  var MAXLEVEL_KEY = 'bcv14_maxLevel';
  var FIRST_REACH_KEY = 'bcv14_firstReach';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getPlayerId() {
    var id = lsGet(PLAYER_ID_KEY);
    if (!id) { id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); lsSet(PLAYER_ID_KEY, id); }
    return id;
  }
  function nextGameIndex() {
    var n = parseInt(lsGet(GAME_COUNT_KEY), 10) || 0;
    n += 1; lsSet(GAME_COUNT_KEY, String(n));
    return n;
  }
  function loadDevice() { return lsGet(DEVICE_KEY) || null; }
  function saveDevice(dev) { lsSet(DEVICE_KEY, dev); }
  function hasSeenGuide() { return lsGet(SEEN_GUIDE_KEY) === '1'; }
  function markSeenGuide() { lsSet(SEEN_GUIDE_KEY, '1'); }
  function loadMuted() { return lsGet(MUTED_KEY) === '1'; }
  function saveMuted(m) { lsSet(MUTED_KEY, m ? '1' : '0'); }
  var PLAYER_ID = getPlayerId();

  // ---------- 聲音(全部包 try, 沒載入也不當掉) ----------
  var muted = loadMuted();
  try { if (window.Sound && Sound.setMuted) Sound.setMuted(muted); } catch (e) {}
  var soundInited = false;
  function ensureSoundInit() {
    if (!soundInited) { soundInited = true; try { Sound.init(); } catch (e) {} }
  }
  function snd(name, opts) { try { Sound.play(name, opts); } catch (e) {} }
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
  var SCREEN = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', GUIDE: 'guide', END: 'end' };
  var screen = SCREEN.TITLE;
  var deviceType = loadDevice();
  var deviceOpen = false;          // 輸入裝置選擇疊在標題上
  var deviceFrom = null;           // 'start' | 'title'
  var guideReturnTo = null;
  var guidePage = 1;
  var pendingAutoGuideClose = false;
  if (!hasSeenGuide()) { guideReturnTo = SCREEN.TITLE; screen = SCREEN.GUIDE; pendingAutoGuideClose = true; }
  var endInfo = null;
  var lastGameEndWall = null;
  var hov = { title: null, device: null, pauseBtn: false, muteBtn: false, pauseMenu: null, guide: null, end: null };
  var game = null;
  var CREDITS_LINES = [
    '"Aerosol of my Love", "Disco Medusae", "In a Heartbeat"',
    'Kevin MacLeod (incompetech.com)',
    'Licensed under Creative Commons: By Attribution 4.0',
    'http://creativecommons.org/licenses/by/4.0/'
  ];

  // ==================================================================
  // 關 / 段 / 地板
  // ==================================================================
  function beatSecOf(lvl) { return LEVELS[lvl].beatSec; }
  function isBackBeat(beat) { return beat >= PARAMS.segSwitchBeat; }
  function segKeyOf(lvl, back) { return lvl === 3 ? (back ? '3b' : '3f') : (lvl + (back ? 'b' : 'f')); }
  var SEG_ORDER = ['1f', '1b', '2f', '2b', '3f', '3b'];
  function segIdx(lvl, back) { return SEG_ORDER.indexOf(segKeyOf(lvl, back)); }

  // 段的要素: 顏色、形狀、疊形狀機率、每批顆數、已解鎖陣型
  function segInfo(lvl, back) {
    var colors = (lvl === 1 && !back) ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
    var shapes = [], prob = 0;
    if (lvl === 2 && !back) { shapes = ['square']; prob = PARAMS.shapeProb.l2f; }
    else if (lvl === 2 && back) { shapes = ['square', 'triangle']; prob = PARAMS.shapeProb.l2b; }
    else if (lvl === 3) { shapes = ['square', 'triangle']; prob = PARAMS.shapeProb.l3; }
    var N = LEVELS[lvl].N[back ? 1 : 0];
    return { colors: colors, shapes: shapes, shapeProb: prob, N: N, idx: segIdx(lvl, back), key: segKeyOf(lvl, back) };
  }
  function drainRate(lvl, back, lvSec) {
    if (lvl === 3) return PARAMS.drain.l3base + PARAMS.drain.l3perSec * Math.max(0, lvSec);
    return LEVELS[lvl].drain[back ? 1 : 0];
  }
  function segLenSec(lvl, back) {
    var bs = beatSecOf(lvl);
    return back ? (LEVELS[lvl].endBeat - PARAMS.segSwitchBeat) * bs : PARAMS.segSwitchBeat * bs;
  }
  function periodBeatsFor(lvl, startBeat) {
    var bs = beatSecOf(lvl);
    if (lvl === 3) {
      var bars = Math.floor(startBeat / 4);
      return { beats: Math.max(7, 20 - Math.floor(bars / 8)), elapsed: null, bars: bars };
    }
    var back = isBackBeat(startBeat);
    var pp = LEVELS[lvl].p[back ? 1 : 0];
    var segStart = back ? PARAMS.segSwitchBeat * bs : 0;
    var elapsed = startBeat * bs - segStart;
    var len = segLenSec(lvl, back);
    var beats = Math.round(pp[0] + (pp[1] - pp[0]) * elapsed / len);
    return { beats: beats, elapsed: elapsed, bars: null };
  }

  // 地板: 角度依關對稱變換(第 1 關原樣、第 2 關轉 180、第 3 關左右鏡射), appear: start = 關內第 0 拍; back = 後段
  var FLOORS = [
    { id: '染A', kind: 'dye', color: 'A', ang: [210, 30, 330], appear: ['start', 'start', 'start'] },
    { id: '染B', kind: 'dye', color: 'B', ang: [330, 150, 210], appear: ['start', 'start', 'start'] },
    { id: '染C', kind: 'dye', color: 'C', ang: [90, 270, 90], appear: ['start', 'start', 'start'] },
    { id: '染D', kind: 'dye', color: 'D', ang: [270, 90, 270], appear: ['back', 'start', 'start'] },
    { id: '賦形方', kind: 'shape', shape: 'square', ang: [150, 330, 30], appear: [null, 'start', 'start'] },
    { id: '賦形三角', kind: 'shape', shape: 'triangle', ang: [30, 210, 150], appear: [null, 'back', 'start'] }
  ];
  function floorPos(f, lvl) {
    var a = f.ang[lvl - 1] * Math.PI / 180;
    return { x: CX + FLOOR_RING * Math.cos(a), y: CY + FLOOR_RING * Math.sin(a) };
  }
  // 版位環上 6 個固定版位(陣型避讓用, 不論有沒有地板)
  var RING_SPOTS = [30, 90, 150, 210, 270, 330].map(function (d) {
    var a = d * Math.PI / 180; return { x: CX + FLOOR_RING * Math.cos(a), y: CY + FLOOR_RING * Math.sin(a) };
  });
  function floorOfColor(c) { for (var i = 0; i < FLOORS.length; i++) if (FLOORS[i].color === c) return FLOORS[i]; return null; }
  function floorOfShape(s) { for (var i = 0; i < FLOORS.length; i++) if (FLOORS[i].shape === s) return FLOORS[i]; return null; }

  // 地板狀態(依關內時間): exists / active(生效) / status(給 Art) / r / t / shrink
  function floorState(g, f) {
    var a = f.appear[g.lvl - 1];
    if (!a) return { exists: false };
    var bs = g.bs, beat = g.lt / bs;
    if (g.phase === 'countIn') {
      if (a === 'back') return { exists: false };
      return { exists: true, active: false, status: 'standby', r: PARAMS.floorR, t: clamp01((beat + PARAMS.countInBeats) / PARAMS.countInBeats) };
    }
    var rr = (g.lvl === 3 && beat >= PARAMS.segSwitchBeat) ? PARAMS.floorRSmall : PARAMS.floorR;
    var sinceSeg = g.lt - PARAMS.segSwitchBeat * bs;
    var it = sinceSeg / PARAMS.floorIntroSec;
    if (a === 'back') {
      if (beat < PARAMS.segSwitchBeat - PARAMS.previewBeats) return { exists: false };
      if (beat < PARAMS.segSwitchBeat) return { exists: true, active: false, status: 'preview', r: PARAMS.floorR, t: clamp01((beat - (PARAMS.segSwitchBeat - PARAMS.previewBeats)) / PARAMS.previewBeats) };
      return { exists: true, active: true, status: it < 1 ? 'intro' : 'active', r: rr, t: it < 1 ? clamp01(it) : 0 };
    }
    var out = { exists: true, active: true, status: 'active', r: rr, t: 0 };
    if (g.lvl === 3) {
      if (beat >= PARAMS.segSwitchBeat - PARAMS.previewBeats && beat < PARAMS.segSwitchBeat) {
        out.shrink = { t: clamp01((beat - (PARAMS.segSwitchBeat - PARAMS.previewBeats)) / PARAMS.previewBeats), toR: PARAMS.floorRSmall };
      } else if (beat >= PARAMS.segSwitchBeat && it < 1) { out.status = 'intro'; out.t = clamp01(it); }
    }
    return out;
  }
  function floorList(g, onlyActive) {
    var list = [];
    for (var i = 0; i < FLOORS.length; i++) {
      var f = FLOORS[i], st = floorState(g, f);
      if (!st.exists) continue;
      if (onlyActive && !st.active) continue;
      var p = floorPos(f, g.lvl);
      list.push({ id: f.id, kind: f.kind, color: f.color, shape: f.shape, x: p.x, y: p.y, r: st.r, active: st.active, st: st, def: f });
    }
    return list;
  }

  // ==================================================================
  // 網牆槽位與扇區
  // ==================================================================
  var SLOTS = [];
  (function () {
    for (var k = 1; k <= 8; k++) {
      var ang = (k - 1) * 45, a = ang * Math.PI / 180;
      SLOTS.push({ no: k, id: '槽' + k, angle: ang, x: CX + WALL_APO * Math.cos(a), y: CY + WALL_APO * Math.sin(a) });
    }
  })();
  function slotByNo(n) { return SLOTS[n - 1]; }
  // 扇區: 中線 ±22.5°, 區間 [中線 − 22.5, 中線 + 22.5), 角度先換算到 [0, 360)
  function sectorOf(px, py) {
    var a = angleOf(px, py);
    var idx = Math.floor(((a + 22.5) % 360) / 45);
    return idx + 1;
  }
  function slotDiff(a, b) { var d = Math.abs(a - b); return Math.min(d, 8 - d); }
  function wrapSlot(n) { return ((n - 1 + 8) % 8) + 1; }

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
      name: '一直線', unlockSeg: 0, dirs: 3, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 9; },
      pts: function (n) {
        var s2 = Math.min(60, 360 / (n - 1)), out = [];
        for (var i = 0; i < n; i++) out.push({ x: (i - (n - 1) / 2) * s2, y: 0 });
        return out;
      }
    },
    arc: {
      name: '弧', unlockSeg: 0, dirs: 6, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 10; },
      pts: function (n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(polarPt(85, (i - (n - 1) / 2) * 32));
        return out;
      }
    },
    ring: {
      name: '圓環', unlockSeg: 0, dirs: 6, dirStep: 60,
      supports: function (n) { return n >= 3 && n <= 11; },
      pts: function (n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(polarPt(85, i * 360 / n));
        return out;
      }
    },
    cross: {
      name: '十字', unlockSeg: 1, dirs: 3, dirStep: 60,
      supports: function (n) { return n === 5 || n === 7 || n === 9; },
      pts: function (n) {
        var out = [{ x: 0, y: 0 }, { x: 0, y: -60 }, { x: 0, y: 60 }];
        var pairs = (n - 3) / 2;
        for (var k = 1; k <= pairs; k++) { out.push({ x: -60 * k, y: 0 }); out.push({ x: 60 * k, y: 0 }); }
        return out;
      }
    },
    triangle: {
      name: '三角', unlockSeg: 3, dirs: 2, dirStep: 60,
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
      name: '雙排', unlockSeg: 3, dirs: 3, dirStep: 60,
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
      return { x: CX + r.x, y: CY + r.y };
    });
  }

  // ==================================================================
  // 滑鼠狀態(先宣告, 其餘函式會用到)
  // ==================================================================
  var mouse = { x: 0, y: 0, btn: false, press: null, uiDownKey: null, inside: false, lastDropPos: null, pathSinceDrop: 0, netSeqAtLastDrop: null };
  var inputQueue = [];

  // ==================================================================
  // 建立新局
  // ==================================================================
  function startBeatOfLevel() { return -PARAMS.countInBeats; }
  function createGame(idx) {
    var gapFromPrev = lastGameEndWall == null ? null : (Date.now() - lastGameEndWall);
    var bs = LEVELS[1].beatSec;
    var g = {
      id: PLAYER_ID + '#' + idx, gameIndex: idx, device: deviceType, startWall: Date.now(), gapFromPrev: gapFromPrev,
      lvl: 1, bs: bs, phase: 'countIn', lt: -PARAMS.countInBeats * bs, gt: -PARAMS.countInBeats * bs, surv: 0, lvSec: 0,
      levelStartGT: -PARAMS.countInBeats * bs, countInLen: PARAMS.countInBeats * bs, introShown: false,
      lastCountInBeat: null, curBack: false, previewLogged: false,
      hp: PARAMS.hpStart, danger: false, score: 0, combo: 0,
      hpFx: [], stickFxs: [], beatFxs: [], chainFxs: [], clearFx: null, catchFx: null, netHintT: 99, netFrom: null,
      bubbles: [], nextBubbleId: 1,
      wave: { phase: 'pre', cur: null, nextStartBeat: null, cancelled: false, clearedThisGap: false, stuckDone: false, windowOpened: false, lastCount: 0, lastFormation: null },
      batches: [], batchSeq: 0,
      net: null, netSeq: 0, netLevelSeq: 0, recent: [], pendingGuarantee: null, netAppearRec: null, netAppearList: [], netFirstPressDone: false, netApproached: false,
      carry: null,
      events: [], bubbleRec: {}, spawnSegOf: {},
      paused: false, pauseCount: 0, openPauseRecord: null, pauseRealMs: 0,
      totals: {
        spawned: 0, captured: 0, expired: 0, levelCleared: 0, bounceCond: 0, bounceOuter: 0, bounceSlotOff: 0, stayInner: 0,
        holdNoDrag: 0, swipeEffective: 0, swipeLocked: 0, mistakeColor: 0, mistakeShape: 0, supply: 0,
        batches: 0, clears: 0, stuckShortens: 0, clearsWithExpiry: 0, nodeCounted: 0, nodeUncounted: 0, nodeOnBeat: 0, nodeByType: {},
        presses: 0, grabs: 0, drops: 0, heals: 0, netAppears: 0, levelSwitches: 0, carryCaptured: 0, carryCleared: 0
      },
      frame: { rotated: false, expired: false, overflow: false, healBy: {}, expireCount: 0 },
      lastDropGT: null, lastDropProcessable: null, lastPressGT: null, lastDropPressNetSeq: null,
      maxConcurrent: 0, forcedPlacementCount: 0, muteSecAcc: 0, frameIntervalSum: 0, frameIntervalCount: 0, audioOutputLatencySec: 0,
      openWindow: null, windowSeq: 0, zs: null, zsHint: '過期後',
      lastExpireRec: null, lastLeaveRec: null,
      phaseSec: { out: [0, 0], gap: [0, 0], stuck: [0, 0], clear: [0, 0], endHold: [0, 0], pre: [0, 0] },
      sampleAcc: 0, secDrain: 0, secHeal: { catch: 0, beat: 0, chain: 0 }, secExpire: 0, secOverflow: 0, secFull: false,
      drainTotal: 0, expireLossTotal: 0, healGross: { catch: 0, beat: 0, chain: 0 }, overflowBy: { catch: 0, beat: 0, chain: 0 }, overflowByLevel: { 1: 0, 2: 0, 3: 0 }, healGrossByLevel: { 1: 0, 2: 0, 3: 0 },
      overflowPtsTotal: 0, captureScoreTotal: 0, clearScoreTotal: 0,
      hpCurve: [], wasFull: false, lastFullToNotGT: null, everFull: false, firstFullGT: null, lastFullStateGT: null,
      firstDangerGT: null, firstDangerKey: null, dangerOpenSince: null, dangerSecTotal: 0, dangerEntries: [],
      firstExpire: null, captureTimes: [],
      pendingDeathReasons: [], deathBatchSeqs: [], deathReasons: [],
      levelRecs: [], levelEnterGT: { 1: 0 }, levelStats: {}, musicDrift: { 1: [], 2: [], 3: [] }, lastDrift: null,
      pendingRelPass: [], stageChanges: [], done: false, maxLevel: 1,
      lastHpLossGT: null, sinceFull: { batchSeqs: [], hadGain: false }, lastFullHpGT: null,
      chainStats: { tiers: {}, interrupts: {} }
    };
    enterLevelStats(g, 1);
    try { g.audioOutputLatencySec = Sound.getOutputLatency() || 0; } catch (e) {}
    return g;
  }
  function enterLevelStats(g, lvl) {
    g.levelStats[lvl] = g.levelStats[lvl] || { enterGT: g.gt, enterSurv: g.surv, enterHp: g.hp, exitHp: null, exitGT: null, captures: 0, expires: 0, cleared: 0, clears: 0, dangerSec: 0, healBySrc: { catch: 0, beat: 0, chain: 0 }, overflow: 0, drain: 0, expireLoss: 0, bounceCond: 0 };
  }

  function gtMs(g) { return Math.round(g.gt * 1000); }
  function survMs(g) { return Math.round(g.surv * 1000); }
  function segLabel(g) {
    if (g.phase === 'countIn') return '預備拍';
    return isBackBeat(g.lt / g.bs) ? '後段' : '前段';
  }
  function segKeyNow(g) { return segKeyOf(g.lvl, isBackBeat(g.lt / g.bs)); }
  function emit(g, type, fields, atLT) {
    var dl = atLT == null ? 0 : (g.lt - atLT);
    var rec = { t: Math.round((g.gt - dl) * 1000), surv: Math.max(0, Math.round((g.surv - dl) * 1000)), gameId: g.id, type: type, level: g.lvl, seg: segLabel(g), lb: g.phase === 'playing' ? r3((g.lt - dl) / g.bs) : null };
    for (var k in fields) rec[k] = fields[k];
    if (fields && fields.bubbleId != null && rec.batchSeq == null) {
      var br = g.bubbleRec[fields.bubbleId];
      if (br) rec.batchSeq = br.batchSeq;
    }
    g.events.push(rec);
    return rec;
  }
  function netFields(g) {
    return g.net ? { netSeq: g.net.seq, netLevelSeq: g.net.levelSeq, slotId: slotByNo(g.net.slot).id } : { netSeq: null, netLevelSeq: null, slotId: null };
  }
  function fieldCount(g) { return g.bubbles.length; }
  function isProcessable(b) { return b.mode === 'idle'; }
  function processableCount(g) { return g.bubbles.filter(isProcessable).length; }
  function batchesOnFieldCount(g) {
    var seen = {}, n = 0;
    for (var i = 0; i < g.bubbles.length; i++) { var s = g.bubbles[i].batchSeq; if (!seen[s]) { seen[s] = true; n++; } }
    return n;
  }
  var WAVE_NAME = { pre: '預備拍', out: '出批中', gap: '空檔', stuck: '卡死縮短後空檔', clear: '清場後空檔', endHold: '關末停批' };
  function waveStateName(g) { return WAVE_NAME[g.wave.phase] || null; }

  // ---------- 網條件比對 ----------
  function compatibleWithNet(b, net) {
    if (!net) return false;
    var colorOk = (b.color == null) || (b.color === net.cond.color);
    var shapeOk = (net.cond.shape == null) || (b.shape === 'circle') || (b.shape === net.cond.shape);
    return colorOk && shapeOk;
  }
  function fullyMatchesNet(b, net) {
    if (!net) return false;
    var colorOk = b.color === net.cond.color;
    var shapeOk = (net.cond.shape == null) || (b.shape === net.cond.shape);
    return colorOk && shapeOk;
  }
  function satisfiableCount(g) { return g.bubbles.filter(isProcessable).filter(function (b) { return compatibleWithNet(b, g.net); }).length; }
  function fullSatisfiableCount(g) { if (!g.net) return 0; return g.bubbles.filter(function (b) { return compatibleWithNet(b, g.net); }).length; }
  function alreadyMatchCount(g) {
    return g.bubbles.filter(function (b) { return (b.mode === 'idle' || b.mode === 'hold') && fullyMatchesNet(b, g.net); }).length;
  }
  function sameCondition(a, b) { return a.color === b.color && a.shape === b.shape; }
  function condDiff(a, b) {
    var d = 0;
    if (a.color !== b.color) d++;
    if ((a.shape == null) !== (b.shape == null)) d++;
    else if (a.shape != null && a.shape !== b.shape) d++;
    return d;
  }

  // ==================================================================
  // 網: 亮起 / 輪替(spec「網與條件」「網的輪替」)
  // ==================================================================
  function rollCondition(g, info) {
    var gu = g.pendingGuarantee, isGuar = false, withShape, forcedColor = null, forcedShape = null;
    if (gu) {
      isGuar = true;
      if (gu.kind === 'shape') { withShape = true; forcedShape = gu.value; }
      else { withShape = info.shapes.length > 0 && Math.random() < info.shapeProb; forcedColor = gu.value; }
    } else {
      withShape = info.shapes.length > 0 && Math.random() < info.shapeProb;
    }
    var pool = [];
    if (!withShape) info.colors.forEach(function (c) { pool.push({ color: c, shape: null }); });
    else info.colors.forEach(function (c) { info.shapes.forEach(function (s) { pool.push({ color: c, shape: s }); }); });
    if (forcedColor) pool = pool.filter(function (c) { return c.color === forcedColor; });
    if (forcedShape) pool = pool.filter(function (c) { return c.shape === forcedShape; });
    var candCount = pool.length;
    var picked = pickRandom(pool), excluded = false;
    if (!isGuar && g.recent.length === 2 && sameCondition(g.recent[0], g.recent[1]) && sameCondition(picked, g.recent[1])) {
      var filtered = pool.filter(function (c) { return !sameCondition(c, picked); });
      picked = pickRandom(filtered); excluded = true;
    }
    if (isGuar) g.pendingGuarantee = null;
    return { cond: picked, isGuar: isGuar, candCount: candCount, candAfter: excluded ? candCount - 1 : candCount };
  }

  function lightNewNet(g, isLevelFirst) {
    var prev = g.net;
    var back = isBackBeat(g.lt / g.bs);
    var info = segInfo(g.lvl, back);
    var slot, cond, candSlots, candConds, isGuar = false, guarContent = null;
    if (isLevelFirst || !prev) {
      slot = 1 + Math.floor(Math.random() * 8); candSlots = 8;
      cond = { color: pickRandom(info.colors), shape: null }; candConds = info.colors.length;
      prev = null;
    } else {
      var ex = [prev.slot, wrapSlot(prev.slot - 1), wrapSlot(prev.slot + 1)];
      var cands = [];
      for (var i = 1; i <= 8; i++) if (ex.indexOf(i) === -1) cands.push(i);
      slot = pickRandom(cands); candSlots = cands.length;
      guarContent = g.pendingGuarantee ? { kind: g.pendingGuarantee.kind, value: g.pendingGuarantee.value } : null;
      var draw = rollCondition(g, info);
      cond = draw.cond; isGuar = draw.isGuar; candConds = draw.candAfter;
    }
    g.recent.push(cond); if (g.recent.length > 2) g.recent.shift();
    g.netSeq++; g.netLevelSeq++;
    var net = { seq: g.netSeq, levelSeq: g.netLevelSeq, slot: slot, cond: cond, appearGT: g.gt, appearSurv: g.surv, isLevelFirst: !!isLevelFirst, isGuar: isGuar, level: g.lvl };
    g.netFrom = prev ? prev.slot : null;
    g.net = net;
    g.netHintT = 0;
    g.netApproached = false; g.netFirstPressDone = false;
    var sd = slotByNo(slot);
    var needed = [];
    var cf = floorOfColor(cond.color);
    if (cf) { var cp = floorPos(cf, g.lvl); needed.push({ floorId: cf.id, attr: 'color', diffDeg: angleDiff180(angleOf(cp.x, cp.y), sd.angle) }); }
    if (cond.shape) { var sf = floorOfShape(cond.shape); var sp = floorPos(sf, g.lvl); needed.push({ floorId: sf.id, attr: 'shape', diffDeg: angleDiff180(angleOf(sp.x, sp.y), sd.angle) }); }
    var rec = emit(g, 'netAppear', {
      netSeq: net.seq, netLevelSeq: net.levelSeq, slotId: sd.id, condition: { color: cond.color, shape: cond.shape },
      conditionItemCount: cond.shape != null ? 2 : 1, isLevelFirst: !!isLevelFirst, isGuarantee: isGuar, guaranteeContent: isGuar ? guarContent : null,
      slotDiff: prev ? slotDiff(prev.slot, slot) : null,
      condDiff: prev ? condDiff(prev.cond, cond) : null,
      candidateSlotCount: candSlots, candidateConditionCount: candConds,
      satisfiedCountAtAppear: alreadyMatchCount(g), satisfiableCountAtAppear: satisfiableCount(g), fullSatisfiableCountAtAppear: fullSatisfiableCount(g),
      countOnFieldAtAppear: fieldCount(g), processableCountAtAppear: processableCount(g), hpAtAppear: r1(g.hp),
      anyHeldOrDraggingAtAppear: !!mouse.press, neededFloorSlotAngleDiffs: needed,
      approachedBeforeFirstPress: null, firstPressDelayMs: null, waveStateAtAppear: waveStateName(g)
    });
    g.netAppearRec = rec;
    g.netAppearList.push(rec);
    g.totals.netAppears++;
    if (g.wave.cur && cond.shape != null) g.wave.cur.rec.cycleTwoCondNets++;
    g.zsHint = '網輪替後';
    snd('netSwap', { x: sd.x });
    return net;
  }

  // ==================================================================
  // 生成: 一律透明圓
  // ==================================================================
  function bubblesToAvoidForSpawn(g) {
    return g.bubbles.filter(function (b) { return dist(b.x, b.y, CX, CY) <= INNER_R; });
  }
  function randomPointInInner() {
    var ang = Math.random() * TAU;
    var r = Math.sqrt(Math.random()) * MOVE_R;
    return { x: CX + Math.cos(ang) * r, y: CY + Math.sin(ang) * r };
  }
  function findSpawnPosition(g) {
    var avoidBubbles = bubblesToAvoidForSpawn(g);
    var avoidFloors = floorList(g, false);
    var minGapBubble = 2 * BUBBLE_R + PARAMS.spawnGap;
    var tries = [];
    for (var t = 0; t < PARAMS.spawnTries; t++) {
      var pos = randomPointInInner();
      var nearest = Infinity, badFloor = false;
      for (var i = 0; i < avoidBubbles.length; i++) { var d = dist(pos.x, pos.y, avoidBubbles[i].x, avoidBubbles[i].y); if (d < nearest) nearest = d; }
      for (var zi = 0; zi < avoidFloors.length; zi++) {
        var z = avoidFloors[zi];
        if (dist(pos.x, pos.y, z.x, z.y) < z.r + BUBBLE_R + PARAMS.spawnGap) { badFloor = true; break; }
      }
      tries.push({ pos: pos, nearest: nearest });
      if (!badFloor && (avoidBubbles.length === 0 || nearest >= minGapBubble)) return { pos: pos, forced: false, overlapCount: 0, intersectsFloor: false };
    }
    var best = tries[0];
    for (var j = 1; j < tries.length; j++) if (tries[j].nearest > best.nearest) best = tries[j];
    var overlapCount = 0;
    for (var k = 0; k < avoidBubbles.length; k++) if (dist(best.pos.x, best.pos.y, avoidBubbles[k].x, avoidBubbles[k].y) < minGapBubble) overlapCount++;
    var intersectsFloor = false;
    for (var z2 = 0; z2 < avoidFloors.length; z2++) if (dist(best.pos.x, best.pos.y, avoidFloors[z2].x, avoidFloors[z2].y) < avoidFloors[z2].r + BUBBLE_R) intersectsFloor = true;
    return { pos: best.pos, forced: true, overlapCount: overlapCount, intersectsFloor: intersectsFloor };
  }

  function makeBubble(id, x, y, g, batchSeq, idxInBatch, spawnLT) {
    return {
      id: id, color: null, shape: 'circle', x: x, y: y,
      life: LIFE, mode: 'idle', carried: false,
      batchSeq: batchSeq, idxInBatch: idxInBatch, spawnAge: 0,
      spawnLT: spawnLT, spawnGT: g.gt - (g.lt - spawnLT), spawnLevel: g.lvl, spawnSegKey: segKeyNow(g),
      grabCount: 0, dragSessionId: 0, dragPathLen: 0, dragPathTotal: 0, freezeSecTotal: 0,
      pressGT: null, pressLT: null, downInfo: null,
      floorOverlap: {}, dragMinDist: {}, pathHistory: [],
      lastSwipeFloorId: null, lastSwipeGT: null, dragLastSwipePathLen: null, dragLastSwipeGT: null, lastMoveLT: null,
      lockedSame: 0, lockedDiff: 0, lockedSameThis: 0, lockedDiffThis: 0,
      isSupply: false, isMistake: false, mistakeRecords: [], bounceCondRecords: [], supplyRecords: [],
      returnFrom: null, returnTo: null, returnElapsed: 0,
      effSwipeCount: 0, nodes: [], streak: 0, lastNodeLT: null, lastCountedNodeLT: null, beatHealTotal: 0,
      dead: false
    };
  }

  function unlockedForms(segIdxNow, n) {
    return FORM_ORDER.filter(function (k) { var f = FORMATIONS[k]; return f.unlockSeg <= segIdxNow && f.supports(n); });
  }
  function pickFormation(g, n, segIdxNow) {
    var w = g.wave;
    var pool = unlockedForms(segIdxNow, n);
    var ex = pool.filter(function (k) { return k !== w.lastFormation; });
    if (ex.length) pool = ex;
    var key = pickRandom(pool);
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
    var dir = pickRandom(best);
    return { key: key, dir: dir, pts: formationPoints(key, n, dir) };
  }

  function flushBatch(g, bt, endedBy) {
    if (bt.flushed) return;
    bt.flushed = true;
    var rec = bt.rec;
    rec.t = gtMs(g); rec.surv = survMs(g); rec.endedBy = endedBy;
    if (bt.leftCount < bt.n && rec.lastLeaveNote == null) rec.lastLeaveNote = (endedBy === '換關' ? '換關清掉' : (endedBy === '局結束' ? '未離場' : null));
    g.events.push(rec);
  }

  function startBatch(g, startBeat) {
    var w = g.wave, bs = g.bs;
    var back = isBackBeat(startBeat);
    var info = segInfo(g.lvl, back);
    var n = info.N;
    var startT = startBeat * bs;
    closeWindow(g, '下一批出現');
    if (w.cur) {
      if (w.cur.rec.outDoneGT != null) w.cur.rec.actualPeriodSec = (g.gt - (g.lt - startT)) - w.cur.rec.startGTs;
      flushBatch(g, w.cur, '下一批出現');
    }
    var seq = g.batchSeq + 1;
    var resPrev = 0, resOlder = 0, seqSet = {};
    for (var i = 0; i < g.bubbles.length; i++) {
      var bb = g.bubbles[i];
      seqSet[bb.batchSeq] = true;
      if (bb.batchSeq === g.batchSeq) resPrev++; else resOlder++;
    }
    var pick = pickFormation(g, n, info.idx);
    w.lastFormation = pick.key;
    var per = periodBeatsFor(g.lvl, startBeat);
    var perSec = per.beats * bs;
    var nowGTs = g.gt - (g.lt - startT);
    var rec = {
      type: 'wave', gameId: g.id, t: null, surv: null, level: g.lvl, seg: back ? '後段' : '前段', batchSeq: seq, endedBy: null,
      formation: FORMATIONS[pick.key].name, direction: pick.dir * FORMATIONS[pick.key].dirStep, n: n,
      startMs: Math.round(nowGTs * 1000), startSurvMs: survMs(g), startGTs: nowGTs, startBeat: startBeat, outDoneMs: null, outDoneGTs: null,
      periodBeats: per.beats, periodSec: perSec, periodCalcElapsedSec: per.elapsed, periodCalcBars: per.bars, periodOverLimit: perSec > PARAMS.periodMaxSec + 1e-9,
      actualPeriodSec: null, spawnLagMs: [],
      placement: { formationPoint: 0, backup: 0, forced: 0 },
      residualAtStart: { prevBatch: resPrev, olderBatches: resOlder }, batchesOnFieldAtStart: Object.keys(seqSet).length,
      cleared: false, clearMs: null, clearAfterOutMs: null, gapRemainBeforeClearSec: null, gapRemainAfterClearSec: null, clearHp: null,
      clearHadExpiry: null, clearExpiredBatchDiffs: null,
      stuckShortened: false, stuckAtMs: null,
      handFreeZeroSatSec: 0, firstPressDelayMs: null,
      lastLeaveMs: null, lastLeaveAfterStartMs: null, lastLeaveNote: null,
      batchExpiredCount: 0, expiredSinceStartCount: 0, tailFirstMs: null, tailLastMs: null, tailSpanMs: null,
      levelClearedCount: 0, nextBatchCancelled: false, cancelledOriginalBeat: null,
      cycleCaptures: 0, cycleTwoCondNets: 0, hpBeforeTail: null, fullBeforeTail: null
    };
    var bt = { rec: rec, n: n, pts: pick.pts, idx: 0, startBeat: startBeat, nextSpawnT: startT, leftCount: 0, expiredDiffs: [], flushed: false, lastSpawnT: null };
    g.batchSeq = seq; w.cur = bt; w.phase = 'out'; w.cancelled = false; w.clearedThisGap = false; w.stuckDone = false; w.windowOpened = false;
    w.nextStartBeat = startBeat + per.beats;
    g.batches.push(bt);
    g.totals.batches++;
    spawnNext(g, startT);
  }

  function spawnNext(g, tSpawn) {
    var w = g.wave, bt = w.cur, bs = g.bs;
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
      if (found.forced) { placement = '強制放置'; intersects = found.intersectsFloor; bt.rec.placement.forced++; g.forcedPlacementCount++; }
      else { placement = '點位被佔改備用找位'; bt.rec.placement.backup++; }
    }
    var id = g.nextBubbleId++;
    var b = makeBubble(id, pos.x, pos.y, g, g.batchSeq, i + 1, tSpawn);
    var lag = Math.max(0, g.lt - tSpawn);
    b.life = LIFE - lag; b.spawnAge = lag;
    g.bubbles.push(b);
    g.totals.spawned++;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    g.bubbleRec[id] = { spawnGT: b.spawnGT, spawnLevel: g.lvl, spawnSegKey: b.spawnSegKey, batchSeq: g.batchSeq, outcome: null, outcomeGT: null };
    bt.rec.spawnLagMs.push(Math.round(lag * 1000));
    bt.lastSpawnT = tSpawn;
    emit(g, 'spawn', {
      bubbleId: id, batchSeq: g.batchSeq, indexInBatch: i + 1, formation: bt.rec.formation, direction: bt.rec.direction,
      x: Math.round(pos.x), y: Math.round(pos.y), placement: placement, countOnField: fieldCount(g),
      overlapCountAtPlacement: overlap, intersectsFloorAtForce: intersects, beatIndex: tSpawn / bs
    }, tSpawn);
    if (bt.idx >= bt.n) enterGap(g, tSpawn);
    else bt.nextSpawnT = (bt.startBeat + bt.idx * 0.5) * bs;
  }

  function enterGap(g, tLast) {
    var w = g.wave, rec = w.cur.rec;
    w.windowOpened = false; w.lastCount = fieldCount(g); w.clearedThisGap = false; w.stuckDone = false;
    w.phase = w.cancelled ? 'endHold' : 'gap';
    var gtLast = g.gt - (g.lt - tLast);
    rec.outDoneMs = Math.round(gtLast * 1000); rec.outDoneGTs = gtLast;
    rec.scheduledGapSec = w.nextStartBeat != null ? (w.nextStartBeat * g.bs - tLast) : null;
  }

  // 嚴格晚於 fromT(關內秒)的第 n 個拍點: 回傳 {beat, sec}; 剛好在拍點上該拍不算
  function nthBeatAfter(g, fromT, n) {
    var bs = g.bs, beat = fromT / bs;
    var start = (Math.abs(beat - Math.round(beat)) < 1e-6) ? Math.round(beat) + 1 : Math.ceil(beat);
    var target = start + (n - 1);
    return { beat: target, sec: Math.max(0, target * bs - fromT) };
  }
  function cancelTimeOf(g) {
    var e = LEVELS[g.lvl].endBeat;
    return e == null ? null : (e - PARAMS.lastNoBatchBeats) * g.bs;
  }
  // 歌曲最後 2 拍不開新批: 到倒數第 2 拍那一刻才生效
  function cancelCheck(g) {
    var cT = cancelTimeOf(g);
    if (cT == null || g.lt < cT - 1e-9) return;
    var w = g.wave;
    if (w.nextStartBeat == null || w.phase === 'pre') return;
    if (w.nextStartBeat * g.bs >= cT - 1e-9) {
      if (w.cur) { w.cur.rec.nextBatchCancelled = true; w.cur.rec.cancelledOriginalBeat = w.nextStartBeat; }
      w.nextStartBeat = null; w.cancelled = true;
      if (w.phase !== 'out') w.phase = 'endHold';
    }
  }
  function advanceWave(g, endT) {
    var w = g.wave, bs = g.bs, guard = 0;
    while (guard++ < 400) {
      cancelCheck(g);
      var evT = Infinity, kind = null;
      if (w.phase === 'out' && w.cur) { evT = w.cur.nextSpawnT; kind = 'spawn'; }
      else if ((w.phase === 'gap' || w.phase === 'stuck' || w.phase === 'clear') && w.nextStartBeat != null) { evT = w.nextStartBeat * bs; kind = 'batch'; }
      if (kind == null || evT > g.lt + 1e-9 || evT >= endT - 1e-9) break;
      if (kind === 'batch') startBatch(g, w.nextStartBeat);
      else spawnNext(g, evT);
    }
    cancelCheck(g);
  }

  // ==================================================================
  // 清場 / 卡死縮短 / 清場窗口 / 可滿足 0 段
  // ==================================================================
  function checkClear(g, endFrame) {
    var w = g.wave;
    if (w.phase !== 'gap' && w.phase !== 'stuck' && w.phase !== 'endHold') return false;
    if (w.clearedThisGap) return false;
    if (fieldCount(g) !== 0) return false;
    var rec = w.cur ? w.cur.rec : null;
    var nowMs = gtMs(g);
    var before = (w.nextStartBeat != null) ? (w.nextStartBeat * g.bs - g.lt) : null;
    if (w.phase !== 'endHold' && !endFrame) {
      var nb = nthBeatAfter(g, g.lt, PARAMS.clearBeatPts[g.lvl]);
      if (w.nextStartBeat != null && w.nextStartBeat > nb.beat) w.nextStartBeat = nb.beat;
    }
    var after = (w.nextStartBeat != null) ? (w.nextStartBeat * g.bs - g.lt) : null;
    if (w.phase !== 'endHold') w.phase = 'clear';
    w.clearedThisGap = true;
    if (rec) {
      rec.cleared = true; rec.clearMs = nowMs; rec.clearAfterOutMs = rec.outDoneMs != null ? nowMs - rec.outDoneMs : null;
      rec.gapRemainBeforeClearSec = before; rec.gapRemainAfterClearSec = after; rec.clearHp = r1(g.hp);
      rec.clearHadExpiry = rec.expiredSinceStartCount > 0;
      rec.clearExpiredBatchDiffs = w.cur.expiredDiffs.slice();
      if (rec.clearHadExpiry) g.totals.clearsWithExpiry++;
    }
    g.score += PARAMS.clearScore; g.clearScoreTotal += PARAMS.clearScore;
    g.totals.clears++;
    g.levelStats[g.lvl].clears++;
    g.clearFx = { t: 0 };
    if (g.lastLeaveRec) g.lastLeaveRec.causedClear = true;
    emit(g, 'clear', {
      batchSeq: g.batchSeq, afterOutMs: rec ? rec.clearAfterOutMs : null, gapRemainBeforeSec: before, gapRemainAfterSec: after,
      hadExpiry: rec ? rec.clearHadExpiry : null, expiredBatchSeqDiffs: rec ? rec.clearExpiredBatchDiffs : null, hp: r1(g.hp),
      points: PARAMS.clearScore, wasStuckShortened: !!(rec && rec.stuckShortened), duringEndHold: w.phase === 'endHold', nextBatchShortened: !endFrame && w.phase !== 'endHold'
    });
    closeWindow(g, '清場');
    snd('clear');
    return true;
  }

  function checkStuck(g, trigger) {
    var w = g.wave;
    if (w.phase !== 'gap' || w.stuckDone) return false;
    if (fieldCount(g) < 1) return false;
    if (fullSatisfiableCount(g) > 0) return false;
    if (w.nextStartBeat == null) return false;
    var nb = nthBeatAfter(g, g.lt, PARAMS.clearBeatPts[g.lvl]);
    if (!(w.nextStartBeat > nb.beat)) return false;
    var rec = w.cur.rec, beforeSec = w.nextStartBeat * g.bs - g.lt;
    w.nextStartBeat = nb.beat;
    w.phase = 'stuck'; w.stuckDone = true;
    rec.stuckShortened = true; rec.stuckAtMs = gtMs(g);
    g.totals.stuckShortens++;
    if (trigger === '過期' && g.lastExpireRec) g.lastExpireRec.causedStuck = true;
    emit(g, 'stuckShorten', Object.assign({
      batchSeq: g.batchSeq, trigger: trigger, remainBeforeSec: beforeSec, beatPoints: PARAMS.clearBeatPts[g.lvl], countOnField: fieldCount(g),
      supplyCount: g.bubbles.filter(function (b) { return b.isSupply; }).length, condition: { color: g.net.cond.color, shape: g.net.cond.shape }
    }, netFields(g)));
    return true;
  }

  function updateWindow(g) {
    var w = g.wave;
    if (w.phase !== 'gap') return;
    var cnt = fieldCount(g);
    if (!w.windowOpened && !g.openWindow && w.lastCount >= PARAMS.windowOpenFrom && cnt <= PARAMS.windowOpenTo) {
      g.windowSeq++;
      var supplies = g.bubbles.filter(function (b) { return b.isSupply; });
      g.openWindow = emit(g, 'clearWindow', {
        windowSeq: g.windowSeq, batchSeq: g.batchSeq, openMs: gtMs(g), countAtOpen: cnt,
        satisfiableAtOpen: satisfiableCount(g), supplyCount: supplies.length,
        supplyUnsatisfiableCount: supplies.filter(function (b) { return !compatibleWithNet(b, g.net); }).length,
        gapRemainAtOpenSec: w.nextStartBeat != null ? (w.nextStartBeat * g.bs - g.lt) : null,
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
    rec.closeMs = gtMs(g); rec.closeReason = reason; rec.countAtClose = cnt;
    rec.offByOne = (reason === '下一批出現' && cnt === 1);
    rec.offByOneIsUnsatisfiableSupply = null;
    if (rec.offByOne) {
      var only = g.bubbles[0];
      rec.offByOneIsUnsatisfiableSupply = !!(only.isSupply && !compatibleWithNet(only, g.net));
    }
    g.openWindow = null;
  }

  function updateZeroSat(g) {
    if (!g.net) return;
    var cnt = fieldCount(g);
    var active = cnt >= 1 && fullSatisfiableCount(g) === 0;
    if (active && !g.zs) {
      g.zs = { startMs: gtMs(g), cause: g.zsHint, waveStates: [], hadStuckShorten: false, countAtStart: cnt, supplyAtStart: g.bubbles.filter(function (b) { return b.isSupply; }).length };
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
    var endMs = gtMs(g);
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
      bt.rec.lastLeaveMs = gtMs(g);
      bt.rec.lastLeaveAfterStartMs = bt.rec.lastLeaveMs - bt.rec.startMs;
    }
  }

  // ==================================================================
  // 物理: idle/hold 互推; 彈回中視為靜態障礙; 推出已出場地板; 拖曳中不參與
  // ==================================================================
  function clampToCircle(b) {
    var d = dist(b.x, b.y, CX, CY);
    if (d > MOVE_R) {
      var k = MOVE_R / (d || 1);
      b.x = CX + (b.x - CX) * k;
      b.y = CY + (b.y - CY) * k;
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
  function pushOutOfFloor(b, z) {
    var d = dist(b.x, b.y, z.x, z.y);
    var minD = BUBBLE_R + z.r;
    if (d >= minD) return;
    var ang = d < 1e-6 ? Math.random() * TAU : Math.atan2(b.y - z.y, b.x - z.x);
    var push = minD - d;
    b.x += Math.cos(ang) * push;
    b.y += Math.sin(ang) * push;
  }
  function updatePhysics(g, dt) {
    var floors = g.phase === 'playing' ? floorList(g, false) : [];
    var idle = g.bubbles.filter(function (b) { return b.mode === 'idle' || b.mode === 'hold'; });
    var obstacles = g.bubbles.filter(function (b) { return b.mode === 'return'; });
    for (var p = 0; p < 3; p++) {
      for (var i = 0; i < idle.length; i++) {
        for (var j = i + 1; j < idle.length; j++) resolveOverlap(idle[i], idle[j], true);
        for (var k = 0; k < obstacles.length; k++) resolveOverlap(idle[i], obstacles[k], false);
        for (var zi = 0; zi < floors.length; zi++) pushOutOfFloor(idle[i], floors[zi]);
      }
      for (var m = 0; m < idle.length; m++) clampToCircle(idle[m]);
    }
    for (var r = 0; r < g.bubbles.length; r++) {
      var rb = g.bubbles[r];
      if (rb.mode !== 'return') continue;
      rb.returnElapsed += dt;
      var t = clamp01(rb.returnElapsed / PARAMS.returnDurationSec);
      rb.x = lerp(rb.returnFrom.x, rb.returnTo.x, t);
      rb.y = lerp(rb.returnFrom.y, rb.returnTo.y, t);
      if (t >= 1) { rb.mode = 'idle'; rb.x = rb.returnTo.x; rb.y = rb.returnTo.y; }
    }
  }
  function pointIntersectsAnyFloor(x, y, floors) {
    for (var i = 0; i < floors.length; i++) if (dist(x, y, floors[i].x, floors[i].y) < floors[i].r + BUBBLE_R) return true;
    return false;
  }
  var RETURN_ANGLE_TRIES = [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180];
  function pickReturnTarget(g, px, py) {
    var ang0 = (px === CX && py === CY) ? Math.random() * TAU : Math.atan2(py - CY, px - CX);
    var floors = floorList(g, false);
    for (var i = 0; i < RETURN_ANGLE_TRIES.length; i++) {
      var ang = ang0 + RETURN_ANGLE_TRIES[i] * Math.PI / 180;
      var tx = CX + Math.cos(ang) * MOVE_R, ty = CY + Math.sin(ang) * MOVE_R;
      if (!pointIntersectsAnyFloor(tx, ty, floors)) return { x: tx, y: ty };
    }
    return { x: CX + Math.cos(ang0) * MOVE_R, y: CY + Math.sin(ang0) * MOVE_R };
  }
  function startReturn(g, b, fromX, fromY) {
    b.mode = 'return';
    b.returnFrom = { x: fromX, y: fromY };
    b.returnTo = pickReturnTarget(g, fromX, fromY);
    b.returnElapsed = 0;
  }

  // ==================================================================
  // 幾何: 移動圓掃過固定圓
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
    return dist(p0.x + dx * t, p0.y + dy * t, cx, cy);
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
    var d0 = dist(p0.x, p0.y, CX, CY) - INNER_R;
    var d1 = dist(p1.x, p1.y, CX, CY) - INNER_R;
    if (d0 <= 0 && d1 > 0) {
      var t = d0 / (d0 - d1);
      return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    }
    return null;
  }

  // ==================================================================
  // 拍子判定(依關內時間)
  // ==================================================================
  function beatCheck(g, ltSec, windowMs, compMs) {
    var beat = ltSec / g.bs;
    var nearest = Math.round(beat);
    var rawMs = (ltSec - nearest * g.bs) * 1000;
    var adj = rawMs + compMs;
    return { nearestBeat: nearest, rawMs: rawMs, rawBeats: rawMs / (g.bs * 1000), adjMs: adj, compMs: compMs, windowMs: windowMs, on: Math.abs(adj) <= windowMs };
  }

  // ==================================================================
  // 命(血條, 0~100): 持續扣血 / 回血(含溢出轉分數) / 過期扣血 / 危險狀態
  // ==================================================================
  function pushHpFx(g, from, to, kind) { g.hpFx.push({ from: from, to: to, kind: kind, t: 0 }); }
  function updateDanger(g) {
    var now = g.gt;
    if (!g.danger && g.hp <= PARAMS.hpDangerEnter) {
      g.danger = true;
      g.dangerOpenSince = g.surv;
      if (g.firstDangerGT == null) { g.firstDangerGT = g.surv; g.firstDangerKey = segKeyNow(g); }
      g.dangerEntries.push({ enterSurvMs: survMs(g), durationSec: null, seg: segKeyNow(g), level: g.lvl, batchSeq: g.batchSeq, batchesOnField: batchesOnFieldCount(g) });
      snd('danger');
    } else if (g.danger && g.hp >= PARAMS.hpDangerExit) {
      g.danger = false;
      if (g.dangerOpenSince != null) {
        var entry = g.dangerEntries[g.dangerEntries.length - 1];
        entry.durationSec = g.surv - g.dangerOpenSince;
        g.dangerSecTotal += entry.durationSec;
        g.dangerOpenSince = null;
      }
    }
  }
  var KIND_NAME = { catch: '捕捉', beat: '踩拍', chain: '整串' };
  function heal(g, b, amount, kind, extra, atLT) {
    var before = g.hp;
    var room = PARAMS.hpMax - before;
    var applied = Math.min(amount, room);
    var overflow = amount - applied;
    g.hp = before + applied;
    var overflowPts = overflow > 1e-9 ? Math.round(overflow * PARAMS.overflowPerHp) : 0;
    if (overflowPts > 0) g.score += overflowPts;
    g.overflowPtsTotal += overflowPts;
    g.totals.heals++;
    g.healGross[kind] += amount;
    g.healGrossByLevel[g.lvl] += amount;
    g.overflowBy[kind] += overflow;
    g.overflowByLevel[g.lvl] += overflow;
    g.secHeal[kind] += applied; g.secOverflow += overflow;
    g.levelStats[g.lvl].healBySrc[kind] += amount; g.levelStats[g.lvl].overflow += overflow;
    if (overflow > 1e-9) g.frame.overflow = true;
    pushHpFx(g, before, g.hp, kind);
    var rec = { source: KIND_NAME[kind], bubbleId: b ? b.id : null, due: amount, applied: applied, overflow: overflow, overflowPts: overflowPts, hpAfter: r1(g.hp) };
    if (extra) for (var k in extra) rec[k] = extra[k];
    emit(g, 'heal', rec, atLT);
    updateDanger(g);
    return { before: before, applied: applied, overflow: overflow, overflowPts: overflowPts, after: g.hp };
  }
  function scoreForCombo(combo) {
    var bonus = Math.min(combo - 1, PARAMS.comboStreakCap) * PARAMS.comboBonusPerStreak;
    return Math.round(PARAMS.scoreBase * (1 + bonus));
  }

  // ==================================================================
  // 氣泡收尾(沾錯回填 / 條件不符回填 / 備料回填)
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }
  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }
  function countGrabsSince(g, bubbleId, sinceMs) {
    var n = 0;
    for (var i = 0; i < g.events.length; i++) { var e = g.events[i]; if (e.type === 'grab' && e.bubbleId === bubbleId && e.t > sinceMs) n++; }
    return n;
  }
  function hasEffectiveSwipeAfter(g, bubbleId, sinceMs) {
    for (var i = 0; i < g.events.length; i++) { var e = g.events[i]; if (e.type === 'swipe' && e.bubbleId === bubbleId && e.t > sinceMs && e.classification === '生效') return true; }
    return false;
  }
  function findDragEndForSession(g, bubbleId, sessionId) {
    for (var i = g.events.length - 1; i >= 0; i--) {
      var e = g.events[i];
      if (e.type === 'dragEnd' && e.bubbleId === bubbleId && e.dragSessionId === sessionId) return e;
    }
    return null;
  }
  // outcome: captured / expired / levelCleared / residual
  function finalizeBubble(g, b, outcome, captureSnap) {
    var nowMs = gtMs(g);
    var rec = g.bubbleRec[b.id];
    if (rec) { rec.outcome = outcome; rec.outcomeGT = g.gt; }
    b.mistakeRecords.forEach(function (m) {
      var dragEndRec = findDragEndForSession(g, b.id, m.dragSessionId);
      m.record.mistakeFollowUp = {
        fate: outcome === 'captured' ? '捕捉' : (outcome === 'expired' ? '過期' : (outcome === 'levelCleared' ? '換關清掉' : '局結束殘留')),
        dragEndReason: dragEndRec ? dragEndRec.reason : null, dragEndKind: dragEndRec ? dragEndRec.endKind : null,
        captureNetSeq: captureSnap ? captureSnap.netSeq : null,
        captureCondition: captureSnap ? captureSnap.condition : null,
        timeToCaptureMs: outcome === 'captured' ? (nowMs - m.atMs) : null,
        netsPassedUntilCapture: outcome === 'captured' ? (g.netSeq - m.netSeqAtMistake) : null,
        dragsAfter: countGrabsSince(g, b.id, m.atMs)
      };
    });
    b.bounceCondRecords.forEach(function (r) {
      r.laterCaptured = (outcome === 'captured');
      r.timeToCaptureMs = outcome === 'captured' ? (nowMs - r.t) : null;
      r.dragsAfter = countGrabsSince(g, b.id, r.t);
    });
    b.supplyRecords.forEach(function (r) {
      var fate;
      if (outcome === 'captured') fate = '被捕捉';
      else if (outcome === 'expired') fate = '過期';
      else if (outcome === 'levelCleared') fate = '換關清掉';
      else fate = hasEffectiveSwipeAfter(g, b.id, r.t) ? '又被拖去賦形或染色' : '局結束殘留';
      r.supplyFollowUp = {
        fate: fate,
        captureNetSeq: outcome === 'captured' ? captureSnap.netSeq : null,
        captureCondition: outcome === 'captured' ? captureSnap.condition : null,
        supplyNetSeq: r.netSeqAtSupply,
        timeToCaptureMs: outcome === 'captured' ? (nowMs - r.t) : null,
        netsPassedUntilCapture: outcome === 'captured' ? (g.netSeq - r.netSeqAtSupply) : null
      };
    });
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    finalizeBubble(g, b, 'expired', null);
    removeBubble(g, b);
    var ownBt = g.batches[b.batchSeq - 1], curBt = g.wave.cur;
    var nowMs = gtMs(g);
    var hpBefore = g.hp;
    if (ownBt) {
      var rr = ownBt.rec;
      if (rr.batchExpiredCount === 0) { rr.hpBeforeTail = r1(g.hp); rr.fullBeforeTail = (g.hp >= 99.9 || g.frame.overflow); rr.tailFirstMs = nowMs; }
      rr.batchExpiredCount++; rr.tailLastMs = nowMs; rr.tailSpanMs = nowMs - rr.tailFirstMs;
    }
    if (curBt) { curBt.rec.expiredSinceStartCount++; curBt.expiredDiffs.push(curBt.rec.batchSeq - b.batchSeq); }
    noteBubbleLeave(g, b);
    var expRec = emit(g, 'expire', {
      bubbleId: b.id, color: b.color, shape: b.shape, everPainted: b.color != null, isSupply: b.isSupply, isMistake: b.isMistake,
      grabCount: b.grabCount, freezeSecTotal: r3(b.freezeSecTotal), beatHealTotal: b.beatHealTotal, maxTier: b.nodes.reduce(function (m, n) { return Math.max(m, n.tier); }, 0),
      countOnField: fieldCount(g), processableCount: processableCount(g),
      netMatchAtExpire: fullyMatchesNet(b, g.net), waveState: waveStateName(g), causedClear: false, causedStuck: false
    });
    g.lastExpireRec = expRec; g.lastLeaveRec = expRec;
    g.frame.expired = true; g.frame.expireCount++; g.zsHint = '過期後';
    g.totals.expired++;
    g.levelStats[g.lvl].expires++;
    if (!g.firstExpire) g.firstExpire = { surv: g.surv, key: segKeyNow(g), batchSeq: b.batchSeq, batchesOnField: batchesOnFieldCount(g) + 1, processable: processableCount(g) };
    snd('expire', { x: b.x });
    // 扣血
    var before = g.hp;
    g.hp = Math.max(0, g.hp - PARAMS.hpExpireLoss);
    g.expireLossTotal += before - g.hp; g.levelStats[g.lvl].expireLoss += before - g.hp;
    g.secExpire += before - g.hp;
    pushHpFx(g, before, g.hp, 'expire');
    g.combo = 0;
    updateDanger(g);
    emit(g, 'hpLoss', {
      reason: 'expire', amount: PARAMS.hpExpireLoss, hpBefore: r1(before), hpAfter: r1(g.hp), countOnField: fieldCount(g), expiredBatchSeq: b.batchSeq,
      sinceLastLossMs: g.lastHpLossGT == null ? null : Math.round((g.gt - g.lastHpLossGT) * 1000)
    });
    g.lastHpLossGT = g.gt;
    g.frame.expiredBatchSeqs = g.frame.expiredBatchSeqs || [];
    g.frame.expiredBatchSeqs.push(b.batchSeq);
  }

  // ==================================================================
  // 區域擦過 + 節點(第一次 / 第二次沾上)與踩拍
  // ==================================================================
  function applyFloorSwipe(b, f) {
    var before = { color: b.color, shape: b.shape };
    var result = { before: before };
    if (f.kind === 'dye') {
      result.attr = 'color';
      if (b.color == null) { b.color = f.color; result.classification = '生效'; }
      else { result.classification = '已鎖定'; result.lockedSameValue = (before.color === f.color); }
    } else {
      result.attr = 'shape';
      if (b.shape === 'circle') { b.shape = f.shape; result.classification = '生效'; }
      else { result.classification = '已鎖定'; result.lockedSameValue = (before.shape === f.shape); }
    }
    result.after = { color: b.color, shape: b.shape };
    return result;
  }
  function pushPathHistory(b, ms) {
    b.pathHistory.push({ t: ms, len: b.dragPathLen });
    var cutoff = ms - 500;
    while (b.pathHistory.length > 2 && b.pathHistory[0].t < cutoff) b.pathHistory.shift();
  }
  function speedBefore(b, ms, windowMs) {
    if (!b.pathHistory.length) return null;
    var target = ms - windowMs;
    var base = b.pathHistory[0];
    for (var i = 0; i < b.pathHistory.length; i++) { if (b.pathHistory[i].t <= target) base = b.pathHistory[i]; else break; }
    var dtSec = (ms - base.t) / 1000;
    if (dtSec <= 0) return null;
    return (b.dragPathLen - base.len) / dtSec;
  }
  function neededFloorDistance(g, b, attr, net) {
    var f = attr === 'color' ? floorOfColor(net.cond.color) : floorOfShape(net.cond.shape);
    if (!f) return null;
    var st = floorState(g, f);
    if (!st.exists) return null;
    var p = floorPos(f, g.lvl);
    return Math.max(0, dist(b.x, b.y, p.x, p.y) - BUBBLE_R - st.r);
  }
  function inPreviewPeriod(g) {
    var beat = g.lt / g.bs;
    return g.phase === 'playing' && beat >= PARAMS.segSwitchBeat - PARAMS.previewBeats && beat < PARAMS.segSwitchBeat;
  }

  // 節點(第一次 / 第二次沾上 / 送進網 / 已鎖定擦過 / 條件不符放開)共用: 埋點 + 踩拍判定
  // counted: 是否計次; 回傳 chk(含 on / tier / interrupted)
  function emitNode(g, b, type, counted, ltSec, windowMs, compMs, extra) {
    var chk = beatCheck(g, ltSec, windowMs, compMs);
    var tier = null, interrupted = null, interruptPos = null;
    if (counted) {
      if (chk.on) { b.streak++; tier = b.streak; interrupted = false; }
      else {
        interrupted = b.streak > 0; interruptPos = interrupted ? (b.nodes.length + 1) : null;
        b.streak = 0; tier = 0;
      }
    }
    var prevCountedGap = (counted && b.lastCountedNodeLT != null) ? (ltSec - b.lastCountedNodeLT) : null;
    var prevAnyGap = b.lastNodeLT != null ? (ltSec - b.lastNodeLT) : null;
    var rec = {
      nodeType: type, bubbleId: b.id, counted: counted, nodeLevelSec: r3(ltSec), bpm: LEVELS[g.lvl].bpm, nearestBeat: chk.nearestBeat,
      rawDiffMs: r1(chk.rawMs), rawDiffBeats: r3(chk.rawBeats), compMs: compMs, adjDiffMs: r1(chk.adjMs), windowMs: r1(windowMs),
      onBeat: counted ? chk.on : null, tier: counted ? tier : null, interrupted: counted ? interrupted : null, interruptPos: interruptPos,
      prevCountedGapMs: prevCountedGap == null ? null : Math.round(prevCountedGap * 1000),
      prevCountedGapBeats: prevCountedGap == null ? null : r3(prevCountedGap / g.bs),
      prevAnyGapMs: prevAnyGap == null ? null : Math.round(prevAnyGap * 1000),
      isCarried: !!b.carried, judgedLevel: g.lvl
    };
    if (extra) for (var k in extra) rec[k] = extra[k];
    emit(g, 'node', rec, ltSec);
    b.lastNodeLT = ltSec;
    if (counted) {
      b.lastCountedNodeLT = ltSec;
      b.nodes.push({ type: type, onBeat: chk.on, tier: tier, interrupted: interrupted });
      g.totals.nodeCounted++;
      if (chk.on) g.totals.nodeOnBeat++;
      var cs = g.chainStats;
      var kk = type + '|L' + g.lvl;
      cs[kk] = cs[kk] || { counted: 0, onBeat: 0 };
      cs[kk].counted++; if (chk.on) cs[kk].onBeat++;
      if (chk.on) { var tk = 'L' + g.lvl + '|nodes' + (b.effSwipeCount + (type === '送進網' ? 1 : 0)) + '|tier' + tier; cs.tiers[tk] = (cs.tiers[tk] || 0) + 1; }
      if (interrupted) { var ik = 'L' + g.lvl + '|pos' + interruptPos + '|' + type; cs.interrupts[ik] = (cs.interrupts[ik] || 0) + 1; }
    } else g.totals.nodeUncounted++;
    g.totals.nodeByType[type] = (g.totals.nodeByType[type] || 0) + 1;
    chk.tier = tier; chk.interrupted = interrupted;
    return chk;
  }

  function pushBeatFx(g, b, x, y, tier, onBubble) { g.beatFxs.push({ bubble: onBubble ? b : null, x: x, y: y, tier: tier, onBubble: onBubble, t: 0 }); }
  function pushStickFx(g, b, kind, attr, value, paletteLevel) {
    var stack = 0;
    for (var i = 0; i < g.stickFxs.length; i++) if (g.stickFxs[i].bubble === b && g.stickFxs[i].t < PARAMS.stickFxSec) stack = 1;
    g.stickFxs.push({ bubble: b, kind: kind, attr: attr, value: value, t: 0, stack: stack, paletteLevel: paletteLevel || null });
  }

  // 本幀拖曳路徑(p0->p1, 關內時間 lt0->lt1)上的區域擦過、路過相鄰區域之間、衝出內圈
  function processDragSegment(g, b, p0, p1, lt0, lt1) {
    var floors = floorList(g, true);
    var enters = [];
    for (var i = 0; i < floors.length; i++) {
      var z = floors[i];
      var combinedR = BUBBLE_R + z.r;
      var wasOverlap = !!b.floorOverlap[z.id];
      var interval = sweepCircleInterval(p0, p1, z.x, z.y, combinedR);
      var endInside = dist(p1.x, p1.y, z.x, z.y) <= combinedR;
      if (!wasOverlap && interval) enters.push({ t: interval[0], z: z, order: z.kind === 'dye' ? 0 : 1 });
      b.floorOverlap[z.id] = endInside;
      var closeD = closestDistanceOnSegment(p0, p1, z.x, z.y);
      if (b.dragMinDist[z.id] == null || closeD < b.dragMinDist[z.id]) b.dragMinDist[z.id] = closeD;
    }
    enters.sort(function (a, c) { return Math.abs(a.t - c.t) < 1e-9 ? a.order - c.order : a.t - c.t; });
    var net = g.net;
    var nowMs = gtMs(g);
    var preview = inPreviewPeriod(g);
    for (var e = 0; e < enters.length; e++) {
      var z2 = enters[e].z, frac = enters[e].t;
      var px = p0.x + (p1.x - p0.x) * frac, py = p0.y + (p1.y - p0.y) * frac;
      var nodeLT = lt0 + (lt1 - lt0) * frac;
      var result = applyFloorSwipe(b, z2);
      b.lastSwipeFloorId = z2.id; b.lastSwipeGT = g.gt;
      b.dragLastSwipePathLen = b.dragPathLen; b.dragLastSwipeGT = g.gt;
      var attrName = result.attr;
      var value = attrName === 'color' ? z2.color : z2.shape;
      var effective = result.classification === '生效';
      var evt = {
        bubbleId: b.id, floorId: z2.id, floorKind: z2.kind === 'dye' ? '染色' : '賦形', floorLevel: g.lvl, enterBeat: r3(nodeLT / g.bs),
        pathLenSinceDragStart: Math.round(b.dragPathLen),
        beforeColor: result.before.color, beforeShape: result.before.shape, afterColor: result.after.color, afterShape: result.after.shape,
        classification: result.classification,
        lockedSameAsExisting: effective ? null : result.lockedSameValue,
        netCaresThisAttr: net ? (attrName === 'color' ? true : (net.cond.shape != null)) : null, inPreview: preview
      };
      if (effective) {
        var matches = null;
        if (net) {
          matches = attrName === 'color' ? (z2.color === net.cond.color ? '網要的' : '網要別色')
            : (net.cond.shape == null ? '網沒列形狀' : (z2.shape === net.cond.shape ? '網要的' : '網要別形'));
        }
        evt.firstAttrMatch = matches;
        g.totals.swipeEffective++;
        if (matches === '網要別色' || matches === '網要別形') {
          b.isMistake = true;
          if (attrName === 'color') g.totals.mistakeColor++; else g.totals.mistakeShape++;
          evt.mistakeDistanceToNeeded = neededFloorDistance(g, b, attrName, net);
        }
      } else {
        g.totals.swipeLocked++;
        if (result.lockedSameValue) { b.lockedSame++; b.lockedSameThis++; } else { b.lockedDiff++; b.lockedDiffThis++; }
      }
      var srec = emit(g, 'swipe', evt, nodeLT);
      if (effective && (evt.firstAttrMatch === '網要別色' || evt.firstAttrMatch === '網要別形')) {
        b.mistakeRecords.push({ record: srec, attr: attrName, atMs: srec.t, dragSessionId: b.dragSessionId, netSeqAtMistake: g.netSeq });
      }
      // 沾地板回饋
      pushStickFx(g, b, effective ? 'stick' : 'locked', attrName, value, b.carried ? g.carry && g.carry.oldLevel : null);
      // 計次節點
      if (effective) {
        b.effSwipeCount++;
        var nodeType = b.effSwipeCount === 1 ? '第一次沾上' : '第二次沾上';
        var winMs = PARAMS.beatWindowStickBeats * g.bs * 1000;
        var chk = emitNode(g, b, nodeType, true, nodeLT, winMs, PARAMS.beatOffsetStickMs);
        if (chk.on) {
          b.beatHealTotal += PARAMS.hpBeatGain;
          heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: nodeType, tier: chk.tier }, nodeLT);
          pushBeatFx(g, b, b.x, b.y, chk.tier, true);
          snd('onBeat', { step: chk.tier, x: px });
        }
      } else {
        emitNode(g, b, '已鎖定擦過', false, nodeLT, PARAMS.beatWindowStickBeats * g.bs * 1000, PARAMS.beatOffsetStickMs);
      }
    }
    if (enters.length) { g.zsHint = '擦過後'; updateZeroSat(g); }
    pushPathHistory(b, nowMs);
    // 路過相鄰地板之間(兩塊中心連線段)
    var fl = floors.slice().sort(function (a, c) { return angleOf(a.x, a.y) - angleOf(c.x, c.y); });
    for (var pi = 0; pi < fl.length; pi++) {
      var za = fl[pi], zb = fl[(pi + 1) % fl.length];
      if (za === zb) continue;
      var hit = segSegIntersect(p0, p1, { x: za.x, y: za.y }, { x: zb.x, y: zb.y });
      if (!hit) continue;
      var len = dist(za.x, za.y, zb.x, zb.y);
      var lateral = (hit.s - 0.5) * len;
      var beforeSpeed = speedBefore(b, nowMs, PARAMS.relPassWindowMs);
      var touchedEither = !!(b.floorOverlap[za.id] || b.floorOverlap[zb.id]);
      var relRec = emit(g, 'relPass', {
        bubbleId: b.id, floorAId: za.id, floorBId: zb.id, lateralOffset: r1(lateral), touchedEither: touchedEither,
        beforeSpeed: beforeSpeed, afterSpeed: null, speedRatio: null
      });
      g.pendingRelPass.push({ bubbleId: b.id, bubble: b, record: relRec, crossMs: nowMs, crossPathLen: b.dragPathLen, beforeSpeed: beforeSpeed });
    }
    var crossOut = findInnerCrossing(p0, p1);
    if (crossOut) {
      b.lastExitInnerGT = g.gt; b.lastExitInnerLT = lt1;
      emit(g, 'exitInner', {
        bubbleId: b.id, angleDeg: r1(angleOf(crossOut.x, crossOut.y)), sector: 'S' + sectorOf(crossOut.x, crossOut.y), litSlot: g.net ? g.net.slot : null,
        lastSwipeFloorId: b.lastSwipeFloorId, lastSwipeGT: b.lastSwipeGT == null ? null : Math.round(b.lastSwipeGT * 1000),
        alreadySatisfied: fullyMatchesNet(b, g.net)
      }, lt1);
    }
    // 進入亮扇區的時刻(最後一次進入亮扇區到放開的時間)
    if (g.net) {
      var inLit = dist(p1.x, p1.y, CX, CY) > INNER_R && sectorOf(p1.x, p1.y) === g.net.slot;
      var wasLit = dist(p0.x, p0.y, CX, CY) > INNER_R && sectorOf(p0.x, p0.y) === g.net.slot;
      if (inLit && !wasLit) b.lastEnterLitLT = lt1;
    }
  }
  function finalizePendingRelPass(g) {
    var nowMs = gtMs(g);
    g.pendingRelPass = g.pendingRelPass.filter(function (item) {
      var b = item.bubble;
      var dtMs = nowMs - item.crossMs;
      var stillDragging = b && !b.dead && b.mode === 'drag';
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

  // ==================================================================
  // 放下位置 / 拖曳結束 / 捕捉
  // ==================================================================
  function isOnUiRegion(px, py) { return inRect(px, py, L.hudLeft) || inRect(px, py, L.hudRight) || inRect(px, py, L.pauseBtn) || inRect(px, py, L.muteBtn); }
  function clampDrag(x, y) { return { x: clampNum(x, DRAG_B.x0, DRAG_B.x1), y: clampNum(y, DRAG_B.y0, DRAG_B.y1) }; }
  function gtAt(g, lt) { return g.gt - (g.lt - lt); }

  function dragEndEvent(g, b, reason, lt) {
    var floors = floorList(g, true);
    var nearest = {};
    for (var i = 0; i < floors.length; i++) {
      var d = b.dragMinDist[floors[i].id];
      nearest[floors[i].id] = d == null ? null : Math.max(0, r1(d - BUBBLE_R - floors[i].r));
    }
    var gnow = gtAt(g, lt);
    return emit(g, 'dragEnd', {
      bubbleId: b.id, dragSessionId: b.dragSessionId, reason: reason,
      pathLength: Math.round(b.dragPathLen), durationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      lockedSameThisDrag: b.lockedSameThis, lockedDiffThisDrag: b.lockedDiffThis, nearestEdgeDistanceByFloor: nearest, isCarried: !!b.carried
    }, lt);
  }

  function slotCenterOf(net) { return net ? slotByNo(net.slot) : null; }

  // 捕捉(一般與帶過的那一顆共用): 得分、連續數、回血、踩拍、整串; 回傳 captureExtra
  function captureBubble(g, b, lt, netAtRelease, isCarried, ev, locInfo) {
    var gnow = gtAt(g, lt);
    var newCombo = g.combo + 1;
    var pts = scoreForCombo(newCombo);
    g.score += pts; g.captureScoreTotal += pts; g.combo = newCombo;
    var hpBefore = g.hp;
    var cond = netAtRelease.cond;
    var conditionCount = cond.shape != null ? 2 : 1;
    var snap = { netSeq: netAtRelease.seq, condition: { color: cond.color, shape: cond.shape } };
    finalizeBubble(g, b, 'captured', snap);
    g.captureTimes.push(gnow);
    g.totals.captured++;
    g.levelStats[g.lvl].captures++;
    if (isCarried) g.totals.carryCaptured++;
    var hpStartAll = g.hp;
    var healDue = PARAMS.hpCatchGain + b.beatHealTotal;
    heal(g, b, PARAMS.hpCatchGain, 'catch', null, lt);
    var deliverChk = emitNode(g, b, '送進網', true, lt, PARAMS.beatWindowDeliverMs, PARAMS.beatOffsetDeliverMs, {
      netSeq: netAtRelease.seq, judgedLevel: netAtRelease.level, beatLevel: g.lvl
    });
    if (deliverChk.on) {
      b.beatHealTotal += PARAMS.hpBeatGain; healDue += PARAMS.hpBeatGain;
      heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: '送進網', tier: deliverChk.tier }, lt);
    }
    var counted = b.nodes.length;
    var onCount = b.nodes.filter(function (n) { return n.onBeat; }).length;
    var chain = counted >= 1 && onCount === counted;
    if (chain) { healDue += PARAMS.hpChainGain; heal(g, b, PARAMS.hpChainGain, 'chain', null, lt); }
    var fxX = clampNum(b.x, 0, W), fxY = clampNum(b.y, 0, H);
    if (deliverChk.on) {
      pushBeatFx(g, b, fxX, fxY, deliverChk.tier, false);
      snd('onBeat', { step: deliverChk.tier, x: fxX });
    }
    if (chain) {
      g.chainFxs.push({ x: fxX, y: fxY, t: 0 });
      snd('beatChain', { x: fxX });
    }
    snd('catch', { x: fxX });
    var extra = {
      netSeq: netAtRelease.seq, netLevelSeq: netAtRelease.levelSeq, slotId: slotByNo(netAtRelease.slot).id, conditionCount: conditionCount,
      netInFieldMs: Math.round((gnow - netAtRelease.appearGT) * 1000), hpBefore: r1(hpBefore),
      processingMs: Math.round((gnow - b.spawnGT) * 1000), processingMsExFreeze: Math.round((gnow - b.spawnGT - b.freezeSecTotal) * 1000),
      freezeSecTotal: r3(b.freezeSecTotal), pressToDragMs: b.downInfo ? b.downInfo.msAtDragStart : null,
      grabCount: b.grabCount, pathLength: Math.round(b.dragPathTotal), lockedSame: b.lockedSame, lockedDiff: b.lockedDiff,
      isSupply: b.isSupply, isMistake: b.isMistake, spawnSegKey: b.spawnSegKey, spawnLevel: b.spawnLevel, points: pts,
      countedNodes: counted, onBeatNodes: onCount, nodeResults: b.nodes.map(function (n) { return n.onBeat ? n.tier : 0; }),
      maxTier: b.nodes.reduce(function (m, n) { return Math.max(m, n.tier || 0); }, 0),
      interruptPos: (function () { for (var i = 0; i < b.nodes.length; i++) if (b.nodes[i].interrupted) return i + 1; return null; })(),
      isChain: chain, totalHealDue: healDue, totalHealApplied: r1(g.hp - hpStartAll), isCarried: isCarried, judgedLevel: netAtRelease.level
    };
    removeBubble(g, b);
    noteBubbleLeave(g, b);
    if (g.wave.cur) g.wave.cur.rec.cycleCaptures++;
    return extra;
  }

  // 放下事件
  function emitDrop(g, b, lt, o) {
    var gnow = gtAt(g, lt);
    var evt = {
      bubbleId: b.id, category: o.category, notLitSlotId: o.notLitSlotId || null, notLitDiff: o.notLitDiff == null ? null : o.notLitDiff,
      color: b.color, shape: b.shape,
      netSeq: o.net ? o.net.seq : null, netLevelSeq: o.net ? o.net.levelSeq : null, litSlotId: o.net ? slotByNo(o.net.slot).id : null,
      netCondition: o.net ? { color: o.net.cond.color, shape: o.net.cond.shape } : null,
      colorMatch: o.colorMatch === undefined ? null : o.colorMatch, shapeMatch: o.shapeMatch === undefined ? '不比對' : o.shapeMatch,
      outcome: o.outcome, isSupply: !!o.isSupplyDrop, isCarried: !!b.carried, judgedLevel: o.net ? o.net.level : g.lvl,
      x: Math.round(o.px), y: Math.round(o.py), distFromCenter: r1(dist(o.px, o.py, CX, CY)),
      angleToLitMid: (o.net && dist(o.px, o.py, CX, CY) > 0) ? r1(angleDelta(angleOf(o.px, o.py), slotByNo(o.net.slot).angle)) : null,
      pointerOnUi: !!o.onUi, pointerSource: o.pointerSource || '指標',
      distToLitNetMid: o.net ? r1(dist(o.px, o.py, slotByNo(o.net.slot).x, slotByNo(o.net.slot).y)) : null,
      dragDurationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      dragDistance: Math.round(b.dragPathTotal),
      lastSwipeToDropPathLen: b.dragLastSwipePathLen == null ? null : Math.round(b.dragPathLen - b.dragLastSwipePathLen),
      lastSwipeToDropMs: b.dragLastSwipeGT == null ? null : Math.round((gnow - b.dragLastSwipeGT) * 1000),
      countOnField: fieldCount(g), inPreview: inPreviewPeriod(g), waveState: waveStateName(g), causedClear: false,
      intervalToNextPressMs: null
    };
    if (o.extra) for (var k in o.extra) evt[k] = o.extra[k];
    var rec = emit(g, 'drop', evt, lt);
    g.totals.drops++;
    g.lastDropRec = rec;
    g.lastDropGT = gnow;
    g.lastDropProcessable = processableCount(g);
    mouse.lastDropPos = { x: o.px, y: o.py };
    mouse.pathSinceDrop = 0;
    mouse.netSeqAtLastDrop = g.netSeq;
    return rec;
  }
  function angleDelta(a, mid) { var d = a - mid; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }

  function captureEvents(g, b, lt, extra, ev, px, py, netAtRelease, windowWasOpen, dropRec) {
    var gnow = gtAt(g, lt);
    var dc = dist(px, py, CX, CY);
    var litSlot = slotByNo(netAtRelease.slot);
    var cap = {
      bubbleId: b.id, waveState: dropRec.waveState, causedClear: false,
      distFromCenter: r1(dc), angleToLitMid: r1(angleDelta(angleOf(px, py), litSlot.angle)),
      inOldNetRange: dist(px, py, litSlot.x, litSlot.y) <= 60,
      exitInnerToReleaseMs: b.lastExitInnerLT == null ? null : Math.round((lt - b.lastExitInnerLT) * 1000),
      enterLitToReleaseMs: b.lastEnterLitLT == null ? null : Math.round((lt - b.lastEnterLitLT) * 1000),
      inPreview: inPreviewPeriod(g), countOnField: fieldCount(g) + 1
    };
    for (var k in extra) cap[k] = extra[k];
    var crec = emit(g, 'capture', cap, lt);
    g.lastLeaveRec = crec;
    if (windowWasOpen) {
      var dragSec = b.pressGT == null ? 0 : (gnow - b.pressGT);
      var pi2 = b.downInfo || {};
      emit(g, 'windowCapture', {
        bubbleId: b.id, windowSeq: g.windowSeq, netSeq: extra.netSeq, netInFieldMs: extra.netInFieldMs,
        intervalLastDropToPressMs: pi2.intervalSinceLastDropMs == null ? null : pi2.intervalSinceLastDropMs,
        dragSpeed: dragSec > 0 ? b.dragPathLen / dragSec : null,
        gapRemainAtPressSec: pi2.gapRemainAtPress == null ? null : pi2.gapRemainAtPress, countOnFieldAtPress: pi2.fieldAtPress == null ? null : pi2.fieldAtPress
      }, lt);
    }
    return crec;
  }

  function levelRecOpen(g) { return g.levelRecs.length ? g.levelRecs[g.levelRecs.length - 1] : null; }
  function setCarryResult(g, result, lt) {
    var lr = levelRecOpen(g);
    if (lr && lr.hadCarry && lr.carryResult == null) { lr.carryResult = result; lr.carryResultMs = Math.round(gtAt(g, lt) * 1000); }
  }

  // 帶過的那一顆非捕捉結果: 直接清掉
  function clearCarried(g, b, result, lt) {
    finalizeBubble(g, b, 'levelCleared', null);
    removeBubble(g, b);
    var cbt = g.batches[b.batchSeq - 1];
    if (cbt) cbt.rec.levelClearedCount++;
    g.totals.levelCleared++; g.totals.carryCleared++;
    setCarryResult(g, result, lt);
    g.net = null; g.carry = null; g.stickFxs = g.stickFxs.filter(function (f) { return f.bubble !== b; });
    mouse.press = null;
  }

  // ---- 放開(正常路徑) ----
  function resolveRelease(g, b, ev, lt) {
    if (ev.outWin) { forceBounce(g, b, '視窗外放開', lt); return; }
    var px = ev.x, py = ev.y, usedCenter = false;
    if (ev.outCanvas) { px = b.x; py = b.y; usedCenter = true; }
    var gnow = gtAt(g, lt);
    var isCarried = !!b.carried;
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, '放開', lt);
    var netAtRelease = g.net;
    var onUi = !usedCenter && isOnUiRegion(px, py);
    var dc = dist(px, py, CX, CY);
    var windowWasOpen = !!g.openWindow;
    var category, outcome, colorMatch = null, shapeMatch = '不比對', isSupplyDrop = false, notLitSlotId = null, notLitDiff = null;
    var extraCap = null;
    var pointerSource = usedCenter ? '氣泡中心' : '指標';
    if (dc <= INNER_R) {
      category = '內圈內';
      if (isCarried) { outcome = '帶過的那一顆清掉'; }
      else {
        outcome = '留在內圈';
        g.totals.stayInner++;
        b.mode = 'idle'; b.x = px; b.y = py; clampToCircle(b);
        if (b.color != null || b.shape !== 'circle') { isSupplyDrop = true; b.isSupply = true; g.totals.supply++; }
      }
    } else {
      var sec = sectorOf(px, py);
      if (netAtRelease && sec === netAtRelease.slot) {
        category = '亮扇區';
        var cond = netAtRelease.cond;
        colorMatch = (b.color === cond.color);
        shapeMatch = (cond.shape == null) ? '不比對' : (b.shape === cond.shape);
        var allOk = colorMatch && (cond.shape == null || shapeMatch === true);
        if (allOk) outcome = '捕捉';
        else {
          outcome = isCarried ? '帶過的那一顆清掉' : '條件不符彈回';
          g.totals.bounceCond++; g.levelStats[g.lvl].bounceCond++;
          g.combo = 0;
          emitNode(g, b, '條件不符放開', false, lt, PARAMS.beatWindowDeliverMs, PARAMS.beatOffsetDeliverMs, { netSeq: netAtRelease.seq, judgedLevel: netAtRelease.level });
        }
      } else {
        category = '不亮扇區';
        notLitSlotId = slotByNo(sec).id;
        notLitDiff = netAtRelease ? slotDiff(sec, netAtRelease.slot) : null;
        outcome = isCarried ? '帶過的那一顆清掉' : '不亮扇區彈回';
        g.totals.bounceSlotOff++; g.totals.bounceOuter++;
      }
    }
    var dropRec;
    if (outcome === '捕捉') {
      var capExtra = captureBubble(g, b, lt, netAtRelease, isCarried, ev, null);
      dropRec = emitDrop(g, b, lt, { category: category, notLitSlotId: notLitSlotId, notLitDiff: notLitDiff, net: netAtRelease, colorMatch: colorMatch, shapeMatch: shapeMatch, outcome: outcome, isSupplyDrop: false, px: px, py: py, onUi: onUi, pointerSource: pointerSource, extra: { points: capExtra.points } });
      var crec = captureEvents(g, b, lt, capExtra, ev, px, py, netAtRelease, windowWasOpen, dropRec);
      updateWindow(g);
      if (isCarried) {
        setCarryResult(g, '捕捉', lt);
        g.catchFx = { slot: netAtRelease.slot, t: 0 };
        g.net = null; g.carry = null;
      } else {
        g.catchFx = { slot: netAtRelease.slot, t: 0 };
        if (!g.endFrame) {
          lightNewNet(g, false);
          g.frame.rotated = true;
          dropRec.rotatedTo = g.net.seq;
        }
        updateZeroSat(g);
      }
    } else {
      if (outcome === '條件不符彈回' || outcome === '不亮扇區彈回') startReturn(g, b, px, py);
      dropRec = emitDrop(g, b, lt, { category: category, notLitSlotId: notLitSlotId, notLitDiff: notLitDiff, net: netAtRelease, colorMatch: colorMatch, shapeMatch: shapeMatch, outcome: outcome, isSupplyDrop: isSupplyDrop, px: px, py: py, onUi: onUi, pointerSource: pointerSource });
      if (isCarried) {
        var res = category === '內圈內' ? '內圈內清掉' : (category === '亮扇區' ? '條件不符清掉' : '不亮扇區清掉');
        clearCarried(g, b, res, lt);
      } else {
        if (outcome === '條件不符彈回') b.bounceCondRecords.push(dropRec);
        if (isSupplyDrop) { dropRec.netSeqAtSupply = g.netSeq; b.supplyRecords.push(dropRec); }
      }
    }
  }

  // 系統事件強制結果(視窗外放開 / 失焦): 一律「其他位置」彈回, 走獨立路徑, 不看座標
  function forceBounce(g, b, reason, lt) {
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, reason, lt);
    var net = g.net;
    var px = b.x, py = b.y;
    g.totals.bounceOuter++;
    var dropRec = emitDrop(g, b, lt, {
      category: reason === '失焦' ? '失焦' : '視窗外', net: net, outcome: b.carried ? '帶過的那一顆清掉' : '彈回內圈', px: px, py: py, onUi: false, pointerSource: '系統事件'
    });
    if (b.carried) clearCarried(g, b, '視窗外或失焦清掉', lt);
    else startReturn(g, b, px, py);
    mouse.press = null;
    return dropRec;
  }

  // ==================================================================
  // 輸入處理(佇列在 tick 內消化)
  // ==================================================================
  function findBubbleUnder(g, px, py) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < g.bubbles.length; i++) {
      var b = g.bubbles[i];
      if (b.mode !== 'idle') continue;
      var d = dist(px, py, b.x, b.y);
      if (d <= BUBBLE_R && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  function handleDown(g, ev, lt) {
    if (g.phase !== 'playing') return;
    if (mouse.press) return;
    var target = findBubbleUnder(g, ev.x, ev.y);
    if (!target) return;
    target.mode = 'hold';
    var gnow = gtAt(g, lt);
    var interval = g.lastDropGT == null ? null : Math.round((gnow - g.lastDropGT) * 1000);
    g.totals.presses++;
    var net = g.net;
    var rec = emit(g, 'press', Object.assign({
      bubbleId: target.id, x: Math.round(ev.x), y: Math.round(ev.y), remainingLifeMs: Math.round(target.life * 1000), color: target.color, shape: target.shape,
      intervalSinceLastDropMs: interval, processableAtLastDrop: g.lastDropProcessable,
      pathLenSinceLastDrop: g.lastDropGT == null ? null : Math.round(mouse.pathSinceDrop),
      netChangedSinceLastDrop: mouse.netSeqAtLastDrop != null ? (mouse.netSeqAtLastDrop !== g.netSeq) : null,
      timeSinceNetAppearedMs: net ? Math.round((gnow - net.appearGT) * 1000) : null
    }, netFields(g)), lt);
    if (g.netAppearRec && !g.netFirstPressDone) {
      g.netAppearRec.approachedBeforeFirstPress = g.netApproached;
      g.netAppearRec.firstPressDelayMs = net ? Math.round((gnow - net.appearGT) * 1000) : null;
      g.netFirstPressDone = true;
    }
    if (g.lastDropRec && g.lastDropRec.intervalToNextPressMs == null) g.lastDropRec.intervalToNextPressMs = interval;
    target.pressGT = gnow; target.pressLT = lt;
    target.spawnAge = PARAMS.spawnFxSec;
    var wv = g.wave;
    var gapRemain = (wv.phase !== 'out' && wv.nextStartBeat != null) ? Math.max(0, wv.nextStartBeat * g.bs - lt) : null;
    target.downInfo = { intervalSinceLastDropMs: interval, gapRemainAtPress: gapRemain, fieldAtPress: fieldCount(g), waveStateAtPress: waveStateName(g), msAtDragStart: null };
    if (wv.cur && wv.cur.rec.firstPressDelayMs == null) wv.cur.rec.firstPressDelayMs = Math.round((gnow - wv.cur.rec.startGTs) * 1000);
    g.lastPressGT = gnow;
    mouse.pathSinceDrop = 0;
    mouse.press = { bubble: target, downPos: { x: ev.x, y: ev.y }, downGT: gnow, downLT: lt, dragging: false };
  }

  function handleMove(g, ev, lt) {
    var press = mouse.press;
    if (!press) return;
    var b = press.bubble;
    if (!b || b.dead) { mouse.press = null; return; }
    if (!press.dragging) {
      var d0 = dist(ev.x, ev.y, press.downPos.x, press.downPos.y);
      if (d0 <= PARAMS.dragStartDist) return;
      press.dragging = true;
      b.mode = 'drag';
      b.grabCount++; b.dragSessionId++;
      g.totals.grabs++;
      var gnow = gtAt(g, lt);
      b.dragPathLen = 0; b.lockedSameThis = 0; b.lockedDiffThis = 0;
      b.dragLastSwipePathLen = null; b.dragLastSwipeGT = null; b.pathHistory = [];
      b.lastEnterLitLT = null; b.lastExitInnerLT = null;
      var clamped = clampDrag(ev.x, ev.y);
      var originX = b.x, originY = b.y;
      b.x = clamped.x; b.y = clamped.y;
      b.lastMoveLT = lt;
      b.floorOverlap = {}; b.dragMinDist = {};
      var floors = floorList(g, true), already = null;
      for (var i = 0; i < floors.length; i++) {
        var z = floors[i];
        var d = dist(b.x, b.y, z.x, z.y);
        var overlap = d <= (BUBBLE_R + z.r);
        b.floorOverlap[z.id] = overlap; b.dragMinDist[z.id] = d;
        if (overlap && already == null) already = z.id;
      }
      var net = g.net;
      var colorMatch = net ? (b.color === net.cond.color) : null;
      var shapeMatch = net ? (net.cond.shape == null ? '不比對' : (b.shape === net.cond.shape)) : null;
      var neededDist = function (attr) {
        if (!net) return null;
        if (attr === 'color') {
          if (b.color === net.cond.color) return '不需要';
          if (b.color != null) return '無法符合';
          return neededFloorDistance(g, b, 'color', net);
        }
        if (net.cond.shape == null) return null;
        if (b.shape === net.cond.shape) return '不需要';
        if (b.shape !== 'circle') return '無法符合';
        return neededFloorDistance(g, b, 'shape', net);
      };
      var rankList = g.bubbles.filter(function (o) { return o === b || o.mode === 'idle'; });
      var lifeRank = 1 + rankList.filter(function (o) { return o !== b && o.life < b.life; }).length;
      var distRank = null;
      if (mouse.lastDropPos) {
        var myD = dist(mouse.lastDropPos.x, mouse.lastDropPos.y, originX, originY);
        distRank = 1 + rankList.filter(function (o) { return o !== b && dist(mouse.lastDropPos.x, mouse.lastDropPos.y, o.x, o.y) < myD; }).length;
      }
      b.downInfo = b.downInfo || {};
      b.downInfo.msAtDragStart = Math.round((gnow - press.downGT) * 1000);
      emit(g, 'grab', Object.assign({
        bubbleId: b.id, distanceAtDragStart: r1(d0), msAtDragStart: b.downInfo.msAtDragStart,
        color: b.color, shape: b.shape, remainingLifeMs: Math.round(b.life * 1000), countOnField: fieldCount(g),
        processableCount: processableCount(g), lifeRank: lifeRank, distanceRank: distRank, grabOrdinal: b.grabCount, alreadyIntersectingFloorId: already,
        litCondition: net ? { color: net.cond.color, shape: net.cond.shape } : null, litSlot: net ? net.slot : null,
        colorMatch: colorMatch, shapeMatch: shapeMatch,
        neededDistanceColor: neededDist('color'), neededDistanceShape: (net && net.cond.shape != null) ? neededDist('shape') : null,
        satisfiedCountAtGrab: alreadyMatchCount(g), isSupply: b.isSupply, isMistake: b.isMistake
      }, netFields(g)), lt);
      return;
    }
    var c2 = clampDrag(ev.x, ev.y);
    var prev = { x: b.x, y: b.y };
    b.dragPathLen += dist(prev.x, prev.y, c2.x, c2.y);
    b.x = c2.x; b.y = c2.y;
    var lt0 = b.lastMoveLT == null ? lt : b.lastMoveLT;
    if (lt < lt0) lt = lt0;
    processDragSegment(g, b, prev, c2, lt0, lt);
    b.lastMoveLT = lt;
  }

  function releaseHoldNoDrag(g, b, endKind, lt) {
    b.mode = 'idle';
    g.totals.holdNoDrag++;
    var gnow = gtAt(g, lt);
    var pr = mouse.press;
    emit(g, 'holdNoDrag', { bubbleId: b.id, freezeDurationMs: Math.round((gnow - (b.pressGT == null ? gnow : b.pressGT)) * 1000), endReason: endKind }, lt);
  }

  function handleUp(g, ev, lt) {
    var press = mouse.press;
    if (!press) return;
    mouse.press = null;
    var b = press.bubble;
    if (!b || b.dead) return;
    if (!press.dragging) { releaseHoldNoDrag(g, b, '放開', lt); return; }
    if (b.lastMoveLT != null && lt < b.lastMoveLT) lt = b.lastMoveLT;
    resolveRelease(g, b, ev, lt);
  }

  function processInputs(g, ltPrev, rafTs) {
    var q = inputQueue; inputQueue = [];
    for (var i = 0; i < q.length; i++) {
      var ev = q[i];
      var lt = g.lt;
      if (ev.ts != null && rafTs != null) lt = clampNum(g.lt - (rafTs - ev.ts) / 1000, ltPrev, g.lt);
      if (ev.k === 'down') handleDown(g, ev, lt);
      else if (ev.k === 'move') handleMove(g, ev, lt);
      else if (ev.k === 'up') handleUp(g, ev, lt);
    }
  }
  function drainInputsNow(g) {
    // 暫停 / 失焦前把佇列裡的輸入全部以當下時刻處理掉
    var q = inputQueue; inputQueue = [];
    for (var i = 0; i < q.length; i++) {
      var ev = q[i];
      if (ev.k === 'down') handleDown(g, ev, g.lt);
      else if (ev.k === 'move') handleMove(g, ev, g.lt);
      else if (ev.k === 'up') handleUp(g, ev, g.lt);
    }
  }

  // ==================================================================
  // 暫停 / 恢復
  // ==================================================================
  function openPause(g, reason) {
    if (g.paused) return;
    g.paused = true;
    g.pauseCount++;
    var rec = emit(g, 'pause', { startRealMs: Date.now() - g.startWall, endRealMs: null, reason: reason === 'blur' ? '失焦' : '按鈕', atSeg: segLabel(g) });
    g.openPauseRecord = rec;
    screen = SCREEN.PAUSED;
    mouse.btn = false;
    try { Sound.pauseMusic(); } catch (e) {}
  }
  function resumePause(g) {
    if (!g.paused) return;
    g.paused = false;
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.pauseRealMs += g.openPauseRecord.endRealMs - g.openPauseRecord.startRealMs; g.openPauseRecord = null; }
    screen = SCREEN.PLAYING;
    try { Sound.resumeMusic(g.lt / g.bs); } catch (e) {}
  }

  // ==================================================================
  // 段切換(同一關前段 → 後段; 預告開始記錄)
  // ==================================================================
  function checkSegmentEvents(g) {
    var beat = g.lt / g.bs;
    var L2 = LEVELS[g.lvl];
    if (!g.previewLogged && beat >= PARAMS.segSwitchBeat - PARAMS.previewBeats) {
      g.previewLogged = true;
      g.previewStartGT = g.gt - (g.lt - (PARAMS.segSwitchBeat - PARAMS.previewBeats) * g.bs);
    }
    if (!g.curBack && beat >= PARAMS.segSwitchBeat) {
      g.curBack = true;
      var info = segInfo(g.lvl, true);
      var newFloors = [], shrink = null;
      FLOORS.forEach(function (f) {
        if (f.appear[g.lvl - 1] === 'back') newFloors.push({ id: f.id, kind: f.kind === 'dye' ? '染色' : '賦形' });
      });
      if (g.lvl === 3) shrink = { from: PARAMS.floorR, to: PARAMS.floorRSmall };
      // 保底: 第 1 關後段 → 色 D; 第 2 關後段 → 三角; 第 3 關後段沒有
      var discarded = null, kept = null;
      var hadPending = g.pendingGuarantee;
      if (g.lvl === 1) g.pendingGuarantee = { kind: 'color', value: 'D' };
      else if (g.lvl === 2) g.pendingGuarantee = { kind: 'shape', value: 'triangle' };
      if (g.lvl !== 3) { discarded = hadPending ? { kind: hadPending.kind, value: hadPending.value } : null; }
      else kept = hadPending ? { kind: hadPending.kind, value: hadPending.value } : null;
      // 已相交: 以本幀結束位置判(拖曳中的氣泡)
      var dragB = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
      var alreadyIntersecting = [];
      if (dragB) {
        var endPos = { x: dragB.x, y: dragB.y };
        for (var qi = 0; qi < inputQueue.length; qi++) if (inputQueue[qi].k === 'move') endPos = clampDrag(inputQueue[qi].x, inputQueue[qi].y);
        var fl = floorList(g, true);
        fl.forEach(function (z) {
          var isNew = newFloors.some(function (nf) { return nf.id === z.id; }) || shrink;
          if (!isNew) return;
          var overlap = dist(endPos.x, endPos.y, z.x, z.y) <= BUBBLE_R + z.r;
          dragB.floorOverlap[z.id] = overlap;
          if (overlap) alreadyIntersecting.push(z.id);
        });
      }
      var rec = emit(g, 'stageChange', Object.assign({
        previewStartMs: g.previewStartGT == null ? null : Math.round(g.previewStartGT * 1000), effectiveMs: gtMs(g), newFloors: newFloors, shrink: shrink,
        conditionPoolSize: info.colors.length * (info.shapes.length + 1), shapeProb: info.shapeProb, newBatchN: info.N,
        periodHeadTail: g.lvl === 3 ? { formula: 'max(7, 20 - floor(bars/8))' } : { head: L2.p[1][0], tail: L2.p[1][1] },
        drainRate: g.lvl === 3 ? { base: PARAMS.drain.l3base, perSec: PARAMS.drain.l3perSec } : L2.drain[1],
        unlockedForms: FORM_ORDER.filter(function (k) { return FORMATIONS[k].unlockSeg === info.idx; }).map(function (k) { return FORMATIONS[k].name; }),
        litCondition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null,
        bubblesAtEffective: g.bubbles.map(function (b2) { return { id: b2.id, color: b2.color, shape: b2.shape }; }),
        anyHeldOrDragging: !!mouse.press, draggingBubbleId: dragB ? dragB.id : null, alreadyIntersectingFloors: alreadyIntersecting,
        discardedGuarantee: discarded, keptGuarantee: g.lvl === 3 ? kept : g.pendingGuarantee,
        waveState: waveStateName(g), hpAtEffective: r1(g.hp)
      }, netFields(g)));
      g.stageChanges.push({ level: g.lvl, effectiveGT: g.gt, previewGT: g.previewStartGT, seg: info.key });
    }
  }

  // ==================================================================
  // 換關(spec「關卡與歌曲」)
  // ==================================================================
  function changeLevel(g) {
    var oldLvl = g.lvl, newLvl = oldLvl + 1;
    var oldBs = g.bs;
    var endT = LEVELS[oldLvl].endBeat * oldBs;
    var overshoot = Math.max(0, g.lt - endT);
    var w = g.wave;
    g.totals.levelSwitches++;
    var lr = {
      type: 'levelSwitch', gameId: g.id, t: gtMs(g), surv: survMs(g), level: oldLvl, seg: '後段', fromLevel: oldLvl, toLevel: newLvl,
      newMusic: LEVELS[newLvl].music, newBpm: LEVELS[newLvl].bpm, endGTms: gtMs(g), endSurvMs: survMs(g), endRealMs: Date.now() - g.startWall,
      hpBefore: r1(g.hp), score: g.score, combo: g.combo, danger: g.danger, waveStateAtEnd: waveStateName(g),
      clearedCount: 0, clearedByBatch: {}, clearedSatisfiable: { 可滿足: 0, 不能滿足: 0 }, clearedSupply: 0, clearedMistake: 0, clearedHoldNoDrag: 0, clearedRemainLife: [],
      processableAtEnd: processableCount(g),
      cancelledBatch: w.cur && w.cur.rec.nextBatchCancelled ? { had: true, originalBeat: w.cur.rec.cancelledOriginalBeat } : { had: !!(w.nextStartBeat != null), originalBeat: w.nextStartBeat },
      discardedGuarantee: g.pendingGuarantee ? { kind: g.pendingGuarantee.kind, value: g.pendingGuarantee.value } : null,
      hadCarry: false, carryMatchedOldNet: null, carryResult: null, carryResultMs: null,
      countInStartMs: Math.round((g.gt - overshoot) * 1000), countInEndMs: null, newFirstNet: null,
      idleBeforeEndBeats: null
    };
    // 換關乾等: 從場上最後一顆可處理氣泡離場, 或關末停批開始(取較晚者), 到關末
    var lastLeave = null;
    for (var bi = g.batches.length - 1; bi >= 0; bi--) { if (g.batches[bi].rec.lastLeaveMs != null) { lastLeave = g.batches[bi].rec.lastLeaveMs; break; } }
    if (fieldCount(g) > 0) lr.idleBeforeEndBeats = 0;
    else {
      var holdStartGT = g.holdStartGT == null ? null : Math.round(g.holdStartGT * 1000);
      var later = Math.max(lastLeave == null ? -Infinity : lastLeave, holdStartGT == null ? -Infinity : holdStartGT);
      lr.idleBeforeEndBeats = isFinite(later) ? r3((gtMs(g) - later) / 1000 / oldBs) : null;
    }
    g.levelRecs.push(lr);
    g.events.push(lr);
    // 1. 清場地, 只有拖曳中那一顆例外
    var carried = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
    g.bubbles.slice().forEach(function (b) {
      if (b === carried) return;
      if (b.mode === 'hold') {
        if (mouse.press && mouse.press.bubble === b) { releaseHoldNoDrag(g, b, '換關', g.lt); mouse.press = null; lr.clearedHoldNoDrag++; }
        b.mode = 'idle';
      }
      lr.clearedCount++;
      lr.clearedByBatch[b.batchSeq] = (lr.clearedByBatch[b.batchSeq] || 0) + 1;
      if (compatibleWithNet(b, g.net)) lr.clearedSatisfiable['可滿足']++; else lr.clearedSatisfiable['不能滿足']++;
      if (b.isSupply) lr.clearedSupply++;
      if (b.isMistake) lr.clearedMistake++;
      lr.clearedRemainLife.push(r3(b.life));
      var bt = g.batches[b.batchSeq - 1];
      if (bt) bt.rec.levelClearedCount++;
      finalizeBubble(g, b, 'levelCleared', null);
      removeBubble(g, b);
      g.totals.levelCleared++;
    });
    g.stickFxs = g.stickFxs.filter(function (f) { return f.bubble === carried; });
    g.beatFxs = g.beatFxs.filter(function (f) { return !f.bubble || f.bubble === carried; });
    // 2. 波次重置
    closeWindow(g, '換關');
    closeZeroSat(g, '換關');
    if (w.cur) flushBatch(g, w.cur, '換關');
    g.wave = { phase: 'pre', cur: null, nextStartBeat: null, cancelled: false, clearedThisGap: false, stuckDone: false, windowOpened: false, lastCount: 0, lastFormation: null };
    // 3. 網與保底、同條件計數
    g.levelStats[oldLvl].exitHp = g.hp; g.levelStats[oldLvl].exitGT = g.gt;
    g.recent = []; g.netLevelSeq = 0;
    g.pendingGuarantee = (newLvl === 2) ? { kind: 'shape', value: 'square' } : { kind: 'shape', value: pickRandom(['square', 'triangle']) };
    if (carried) {
      carried.carried = true;
      lr.hadCarry = true;
      lr.carryMatchedOldNet = fullyMatchesNet(carried, g.net);
      g.carry = { bubble: carried, oldLevel: oldLvl };
      g.totals.carryTotal = (g.totals.carryTotal || 0) + 1;
    } else { g.net = null; g.carry = null; }
    // 4. 換成新關
    g.lvl = newLvl; g.bs = LEVELS[newLvl].beatSec; g.phase = 'countIn';
    g.lt = -PARAMS.countInBeats * g.bs + overshoot;
    g.lvSec = 0; g.curBack = false; g.previewLogged = false; g.previewStartGT = null; g.holdStartGT = null;
    g.introT = overshoot; g.countInLen = PARAMS.countInBeats * g.bs;
    g.lastCountInBeat = -PARAMS.countInBeats;
    if (carried) { carried.lastMoveLT = g.lt; carried.lastEnterLitLT = null; carried.lastExitInnerLT = null; }
    g.netHintT = 99; g.netFrom = null;
    g.maxLevel = newLvl;
    g.levelEnterGT[newLvl] = g.gt;
    enterLevelStats(g, newLvl);
    var prevMax = parseInt(lsGet(MAXLEVEL_KEY), 10) || 1;
    if (newLvl > prevMax) { lsSet(MAXLEVEL_KEY, String(newLvl)); lsSet(FIRST_REACH_KEY + newLvl, String(g.gameIndex)); }
    // 5. 音樂與提示音(建議順序: 換關 → 新歌 → 預備拍第 −4 拍)
    snd('stageChange');
    try { Sound.playMusic(LEVELS[newLvl].music, { beat: g.lt / g.bs }); } catch (e) {}
    snd('countIn', { left: 4 });
  }

  function abortCarried(g) {
    var c = g.carry;
    if (!c || !c.bubble || c.bubble.dead) { g.carry = null; return; }
    var b = c.bubble;
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, '換關中止', g.lt);
    clearCarried(g, b, '第 0 拍中止清掉', g.lt);
  }

  // 新關第 0 拍: 地板生效, 第 1 批與第一張網同時出現
  function beginLevelPlay(g) {
    if (g.carry) abortCarried(g);
    g.net = null; g.carry = null;
    g.phase = 'playing';
    g.curBack = false;
    var lr = levelRecOpen(g);
    if (lr && lr.toLevel === g.lvl) lr.countInEndMs = gtMs(g);
    g.wave.phase = 'out';
    startBatch(g, 0);
    var net = lightNewNet(g, true);
    if (lr && lr.toLevel === g.lvl) lr.newFirstNet = { slot: net.slot, condition: { color: net.cond.color, shape: net.cond.shape } };
    updateZeroSat(g);
  }

  // ==================================================================
  // 每秒取樣
  // ==================================================================
  function emitSample(g) {
    g.hpCurve.push({ t: gtMs(g), surv: survMs(g), hp: r1(g.hp) });
    var driftMs = g.lastDrift == null ? null : Math.round(g.lastDrift * 1000);
    if (driftMs != null && g.phase !== null) g.musicDrift[g.lvl].push(driftMs);
    var net = g.net;
    emit(g, 'sample', {
      countOnField: fieldCount(g), hp: r1(g.hp), danger: g.danger, secDrain: r3(g.secDrain), secHeal: { catch: r3(g.secHeal.catch), beat: r3(g.secHeal.beat), chain: r3(g.secHeal.chain) },
      secExpire: r3(g.secExpire), secOverflow: r3(g.secOverflow), secFull: g.secFull,
      waveState: waveStateName(g), batchSeq: g.batchSeq, batchesOnField: batchesOnFieldCount(g),
      anyHoldOrDrag: !!mouse.press, processableCount: processableCount(g),
      satisfiableCount: g.net ? satisfiableCount(g) : null, fullSatisfiableCount: g.net ? fullSatisfiableCount(g) : null,
      litNetSeq: net ? net.seq : null, litSlot: net ? net.slot : null, satisfiedCount: net ? alreadyMatchCount(g) : null,
      musicDriftMs: driftMs, muted: muted
    });
    g.secDrain = 0; g.secHeal = { catch: 0, beat: 0, chain: 0 }; g.secExpire = 0; g.secOverflow = 0; g.secFull = false;
  }

  function updateFx(g, dt) {
    g.hpFx = g.hpFx.filter(function (f) { f.t += dt; return f.t < Art.timing.hpFx; });
    g.stickFxs = g.stickFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.stickFx && !f.bubble.dead; });
    g.beatFxs = g.beatFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.beatFx; });
    g.chainFxs = g.chainFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.chainFx; });
    if (g.clearFx) { g.clearFx.t += dt; if (g.clearFx.t >= Art.timing.clearFx) g.clearFx = null; }
    if (g.catchFx) { g.catchFx.t += dt; if (g.catchFx.t >= Art.timing.catchFx) g.catchFx = null; }
    if (g.netHintT < 50) g.netHintT += dt;
  }

  function syncMusicNow(g) {
    try {
      var d = Sound.syncMusic(g.lt / g.bs);
      if (typeof d === 'number') g.lastDrift = d;
    } catch (e) {}
  }

  // ==================================================================
  // 主更新(一幀)。順序見 spec「同一幀的處理順序」
  // ==================================================================
  function tick(dt, rafTs) {
    var g = game;
    if (muted) g.muteSecAcc += dt;
    var ltPrev = g.lt;
    g.lt += dt; g.gt += dt;
    g.frame = { rotated: false, expired: false, overflow: false, expireCount: 0, expiredBatchSeqs: [] };
    g.endFrame = false;
    updateFx(g, dt);
    var dtPlay = dt, skipInputs = false;

    if (g.phase === 'countIn') {
      var beat0 = g.lt / g.bs;
      var fb = Math.floor(beat0 + 1e-9);
      if (fb >= -PARAMS.countInBeats && fb <= -1 && fb !== g.lastCountInBeat) {
        g.lastCountInBeat = fb;
        snd('countIn', { left: -fb });
      }
      g.introT = (g.introT || 0) + dt;
      processInputs(g, ltPrev, rafTs);
      syncMusicNow(g);
      g.phaseSec.pre[g.surv < 60 ? 0 : 1] += dt;
      if (g.lt < 0) {
        finalizePendingRelPass(g);
        g.sampleAcc += dt;
        var gd0 = 0;
        while (g.sampleAcc >= PARAMS.sampleIntervalSec && gd0 < 10) { g.sampleAcc -= PARAMS.sampleIntervalSec; emitSample(g); gd0++; }
        return;
      }
      dtPlay = g.lt;               // 越過第 0 拍的那一段才算存活時間
      skipInputs = true;
      beginLevelPlay(g);
    }

    // ---------- 進行中 ----------
    var w = g.wave;
    g.phaseSec[w.phase][g.surv < 60 ? 0 : 1] += dtPlay;
    if ((w.phase === 'gap' || w.phase === 'stuck' || w.phase === 'endHold') && !mouse.press && fieldCount(g) >= 1 && fullSatisfiableCount(g) === 0 && w.cur) w.cur.rec.handFreeZeroSatSec += dtPlay;
    g.surv += dtPlay; g.lvSec = g.lt;
    syncMusicNow(g);
    var endBeat = LEVELS[g.lvl].endBeat;
    var endT = endBeat != null ? endBeat * g.bs : Infinity;
    g.endFrame = g.lt >= endT - 1e-9;
    var segKey = segKeyNow(g);
    g.segSec = g.segSec || {}; g.segSec[segKey] = (g.segSec[segKey] || 0) + dtPlay;

    // 1. 段切換
    if (!skipInputs) checkSegmentEvents(g);
    // 2~4. 本幀輸入(擦過 / 放開 / 捕捉 / 輪替)
    if (!skipInputs) processInputs(g, ltPrev, rafTs);

    // 5. 物理、壽命、血量(先加回血已在輸入處理中完成, 再扣持續扣血, 最後扣過期)
    updatePhysics(g, dtPlay);
    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb2 = g.bubbles[fi];
      if (fb2.mode === 'hold' || fb2.mode === 'drag') fb2.freezeSecTotal += dtPlay;
      if (fb2.spawnAge < PARAMS.spawnFxSec) fb2.spawnAge += dtPlay;
    }
    var backNow = isBackBeat(g.lt / g.bs);
    var rate = drainRate(g.lvl, backNow, g.lvSec);
    var hpB = g.hp;
    g.hp = Math.max(0, g.hp - rate * dtPlay);
    var drained = hpB - g.hp;
    g.drainTotal += drained; g.secDrain += drained; g.levelStats[g.lvl].drain += drained;
    var drainKilled = hpB > 0 && g.hp <= 0;
    updateDanger(g);
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'hold' || b.mode === 'drag') continue;
      b.life -= dtPlay;
      if (b.life <= 0) expireBubble(g, b);
    }
    finalizePendingRelPass(g);
    var fullNow = g.hp >= 99.9 || g.frame.overflow;
    if (g.wasFull && !fullNow) { g.lastFullToNotGT = g.surv; g.lastFullToNotKey = segKey; g.lastFullToNotLvSec = g.lvl === 3 ? g.lvSec : null; g.lastFullToNotField = fieldCount(g); }
    if (fullNow) { g.everFull = true; if (g.firstFullGT == null) g.firstFullGT = g.surv; g.fullSecBySeg = g.fullSecBySeg || {}; g.fullSecBySeg[segKey] = (g.fullSecBySeg[segKey] || 0) + dtPlay; g.secFull = true; }
    g.wasFull = fullNow;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    if (g.hp <= 0) {
      g.hp = 0;
      if (drainKilled) { g.pendingDeathReasons = ['持續扣血']; }
      else { g.pendingDeathReasons = ['過期']; g.deathBatchSeqs = g.frame.expiredBatchSeqs.slice(); }
      g.sampleAcc += dtPlay;
      endGame('hpZero');
      return;
    }

    // 6. 清場(局未結束)
    updateWindow(g);
    var cleared = checkClear(g, g.endFrame);
    // 7. 卡死判定(本幀有輪替或過期; 關末那幀跳過)
    if (!cleared && !g.endFrame && (g.frame.rotated || g.frame.expired)) checkStuck(g, g.frame.rotated ? '網輪替' : '過期');
    // 8. 波次排程(歌曲最後 2 拍內的出批取消)
    advanceWave(g, endT);
    if (g.wave.phase === 'endHold' && g.holdStartGT == null) g.holdStartGT = g.gt - (g.lt - cancelTimeOf(g));
    updateZeroSat(g);

    g.sampleAcc += dtPlay;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleIntervalSec && guard < 10) { g.sampleAcc -= PARAMS.sampleIntervalSec; emitSample(g); guard++; }

    // 9. 換關
    if (g.endFrame) changeLevel(g);
  }

  // ==================================================================
  // 局末彙整(逐局)
  // ==================================================================
  function evSeg(e) { return e.seg === '預備拍' ? 'pre' : (e.level + (e.seg === '前段' ? 'f' : 'b')); }
  function iqr(arr) {
    if (arr.length < 4) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length * 0.75)] - s[Math.floor(s.length * 0.25)];
  }
  // 以中位數為中心取四分位距(超出 ± 半拍者繞回另一端)
  function circularIqrBeats(valsBeats) {
    if (valsBeats.length < 4) return null;
    var med = median(valsBeats);
    var shifted = valsBeats.map(function (v) { var d = v - med; while (d > 0.5) d -= 1; while (d < -0.5) d += 1; return d; });
    return iqr(shifted);
  }
  function stdOf(arr) { if (arr.length < 2) return null; var m = avgOf(arr); return Math.sqrt(arr.reduce(function (a, v) { return a + (v - m) * (v - m); }, 0) / arr.length); }

  function computeSummary(g, endReason) {
    var E = g.events;
    var spawns = byType(E, 'spawn'), drops = byType(E, 'drop'), caps = byType(E, 'capture'), expires = byType(E, 'expire');
    var swipes = byType(E, 'swipe'), nodes = byType(E, 'node'), heals = byType(E, 'heal'), nets = byType(E, 'netAppear');
    var samples = byType(E, 'sample'), presses = byType(E, 'press'), waves = byType(E, 'wave'), clearsEv = byType(E, 'clear');
    var stuckEv = byType(E, 'stuckShorten'), grabs = byType(E, 'grab'), holds = byType(E, 'holdNoDrag');
    var levelSw = byType(E, 'levelSwitch'), stageCh = byType(E, 'stageChange'), relPasses = byType(E, 'relPass'), zsEv = byType(E, 'zeroSatSegment');
    var survEnd = g.surv;
    var SEGS = ['1f', '1b', '2f', '2b', '3f', '3b'];
    var segSec = g.segSec || {}, fullSec = g.fullSecBySeg || {};

    var bounceCondDrops = drops.filter(function (d) { return d.outcome === '條件不符彈回'; });
    var slotOffDrops = drops.filter(function (d) { return d.category === '不亮扇區'; });
    var stayDrops = drops.filter(function (d) { return d.outcome === '留在內圈'; });
    var effSwipes = swipes.filter(function (s) { return s.classification === '生效'; });
    var lockedSwipes = swipes.filter(function (s) { return s.classification === '已鎖定'; });
    var mistakeSw = effSwipes.filter(function (s) { return s.firstAttrMatch === '網要別色' || s.firstAttrMatch === '網要別形'; });
    var mistakeColorSw = mistakeSw.filter(function (s) { return s.firstAttrMatch === '網要別色'; });
    var mistakeShapeSw = mistakeSw.filter(function (s) { return s.firstAttrMatch === '網要別形'; });
    var netCapMs = {};            // netSeq -> netInFieldMs
    caps.forEach(function (c) { if (!c.isCarried) netCapMs[c.netSeq] = c.netInFieldMs; });
    function netMsList(filterFn) {
      return nets.filter(filterFn).map(function (n) { return netCapMs[n.netSeq]; }).filter(function (v) { return v != null; });
    }
    var qualNets = function (n) { return n.satisfiableCountAtAppear >= 1; };

    // ----- 各關段 -----
    var segStats = SEGS.map(function (k) {
      var inS = function (e) { return evSeg(e) === k; };
      var capS = caps.filter(inS), expS = expires.filter(inS), dropS = drops.filter(inS), swS = swipes.filter(inS);
      var effS = swS.filter(function (s) { return s.classification === '生效'; });
      var lockS = swS.filter(function (s) { return s.classification === '已鎖定'; });
      var dwell = segSec[k] || 0;
      return {
        seg: k, dwellSec: r3(dwell), batchCount: waves.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k; }).length,
        clearCount: clearsEv.filter(inS).length, stuckShortenCount: stuckEv.filter(inS).length,
        spawnCount: spawns.filter(inS).length, captureCount: capS.length, expireCount: expS.length,
        bounceCondCount: dropS.filter(function (d) { return d.outcome === '條件不符彈回'; }).length,
        slotOffCount: dropS.filter(function (d) { return d.category === '不亮扇區'; }).length, dropTotalCount: dropS.length,
        stayInnerCount: dropS.filter(function (d) { return d.outcome === '留在內圈'; }).length,
        avgProcessingMs: avgOf(capS.map(function (d) { return d.processingMs; })), avgPathLength: avgOf(capS.map(function (d) { return d.pathLength; })),
        effectiveSwipeCount: effS.length,
        mistakeColorCount: effS.filter(function (s) { return s.firstAttrMatch === '網要別色'; }).length,
        mistakeShapeCount: effS.filter(function (s) { return s.firstAttrMatch === '網要別形'; }).length,
        lockedSameCount: lockS.filter(function (s) { return s.lockedSameAsExisting === true; }).length,
        lockedDiffCount: lockS.filter(function (s) { return s.lockedSameAsExisting === false; }).length,
        capturePerMinute: dwell > 0 ? capS.length / (dwell / 60) : null,
        fullHpShare: dwell > 0 ? (fullSec[k] || 0) / dwell : null
      };
    });

    // ----- 積壓期處理率(可處理氣泡數 >= 2 的秒內捕捉數 ÷ 這些秒數) -----
    function backlog(sampleSub, capSub) {
      var busy = 0, busyCaps = 0;
      sampleSub.forEach(function (s) {
        if (s.processableCount >= 2) {
          busy++;
          busyCaps += capSub.filter(function (c) { return c.surv > s.surv - 1000 && c.surv <= s.surv; }).length;
        }
      });
      return { busySeconds: busy, rate: ratio(busyCaps, busy), perItemSec: (busyCaps > 0 ? busy / busyCaps : null) };
    }
    var realSamples = samples.filter(function (s) { return s.seg !== '預備拍'; });
    var backlogGlobal = backlog(realSamples, caps);
    var backlogBySeg = {};
    SEGS.forEach(function (k) { backlogBySeg[k] = backlog(realSamples.filter(function (s) { return evSeg(s) === k; }), caps.filter(function (c) { return evSeg(c) === k; })); });
    var backlogByLevel = {};
    [1, 2, 3].forEach(function (l) { backlogByLevel[l] = backlog(realSamples.filter(function (s) { return s.level === l; }), caps.filter(function (c) { return c.level === l; })); });

    // ----- 指標 1: 網在場時間 -----
    var allQualMs = netMsList(qualNets);
    var oneMs = netMsList(function (n) { return qualNets(n) && n.conditionItemCount === 1; });
    var twoMs = netMsList(function (n) { return qualNets(n) && n.conditionItemCount === 2; });
    function netMsBy(fn) { return netMsList(function (n) { return qualNets(n) && fn(n); }); }
    var netBySlotDiff = {};
    [2, 3, 4].forEach(function (d) { netBySlotDiff[d] = netMsBy(function (n) { return n.slotDiff === d; }); });
    var netBySeg = {};
    SEGS.forEach(function (k) { netBySeg[k] = netMsBy(function (n) { return evSeg(n) === k && n.conditionItemCount === 1; }); });
    var indicator1 = {
      oneCondMedianMs: median(oneMs), twoCondMedianMs: median(twoMs), p90OverMedian: (median(allQualMs) > 0 ? p90(allQualMs) / median(allQualMs) : null),
      seg1fMedianMs: median(netBySeg['1f']), seg2bMedianMs: median(netBySeg['2b']),
      risePctSeg1fTo2b: (median(netBySeg['1f']) > 0 && median(netBySeg['2b']) != null) ? (median(netBySeg['2b']) / median(netBySeg['1f']) - 1) : null,
      slotDiff4MedianMs: median(netBySlotDiff[4]), slotDiff2MedianMs: median(netBySlotDiff[2]),
      bySegOneCond: SEGS.map(function (k) { return { seg: k, n: netBySeg[k].length, medianMs: median(netBySeg[k]), p90Ms: p90(netBySeg[k]) }; })
    };
    var netByLevelCond = [1, 2, 3].map(function (l) {
      var one = netMsList(function (n) { return n.level === l && qualNets(n) && n.conditionItemCount === 1; });
      var two = netMsList(function (n) { return n.level === l && qualNets(n) && n.conditionItemCount === 2; });
      return { level: l, oneN: one.length, oneMedianMs: median(one), oneP90Ms: p90(one), twoN: two.length, twoMedianMs: median(two), twoP90Ms: p90(two), twoMinusOneMs: (median(two) != null && median(one) != null) ? median(two) - median(one) : null };
    });
    function fieldGroup(n) { return n <= 2 ? '1~2' : (n <= 6 ? String(n) : (n <= 8 ? '7~8' : '9+')); }
    function netTimeByField(levelFilter) {
      var out = {};
      nets.forEach(function (na) {
        if (levelFilter != null && na.level !== levelFilter) return;
        var ms = netCapMs[na.netSeq]; if (ms == null) return;
        var key = fieldGroup(na.countOnFieldAtAppear) + (na.conditionItemCount === 2 ? '|兩項' : '|一項');
        (out[key] = out[key] || []).push(ms);
      });
      var res = {};
      Object.keys(out).forEach(function (k) { res[k] = { n: out[k].length, medianMs: median(out[k]) }; });
      return res;
    }
    var netTimeByFieldCount = { global: netTimeByField(null), level1: netTimeByField(1), level2: netTimeByField(2), level3: netTimeByField(3) };
    // 每關開頭與每次段切換後的前 3 張網
    var firstThreeNets = [];
    var markers = [];
    levelSw.forEach(function (lr) { markers.push({ kind: '換關進入第' + lr.toLevel + '關', level: lr.toLevel, netSeqFrom: null, afterGT: lr.countInEndMs }); });
    markers.unshift({ kind: '開局第1關', level: 1, afterGT: 0 });
    stageCh.forEach(function (sc) { markers.push({ kind: '第' + sc.level + '關後段切換', level: sc.level, afterGT: sc.effectiveMs }); });
    markers.forEach(function (m) {
      var after = nets.filter(function (n) { return n.t >= m.afterGT && (m.kind.indexOf('後段') > -1 ? n.level === m.level : n.level === m.level); }).slice(0, 3);
      firstThreeNets.push({
        marker: m.kind, nets: after.map(function (n) {
          return { netSeq: n.netSeq, levelSeq: n.netLevelSeq, inFieldMs: netCapMs[n.netSeq] == null ? null : netCapMs[n.netSeq], firstPressDelayMs: n.firstPressDelayMs, twoCond: n.conditionItemCount === 2, guarantee: n.isGuarantee };
        })
      });
    });

    // ----- 指標 4: 送錯彈回率 -----
    var indicator4 = {
      bounceCondRate: ratio(bounceCondDrops.length, caps.length + bounceCondDrops.length), slotOffRate: ratio(slotOffDrops.length, drops.length),
      byLevel: [1, 2, 3].map(function (l) {
        var cs = caps.filter(function (c) { return c.level === l; }).length, bc = bounceCondDrops.filter(function (d) { return d.level === l; }).length;
        return { level: l, bounceCondRate: ratio(bc, cs + bc) };
      })
    };

    // ----- 命 -----
    if (g.dangerOpenSince != null) {
      var tail = survEnd - g.dangerOpenSince;
      g.dangerSecTotal += tail;
      var le = g.dangerEntries[g.dangerEntries.length - 1];
      if (le && le.durationSec == null) le.durationSec = tail;
      g.dangerOpenSince = null;
    }
    var dangerRatio = survEnd > 0 ? g.dangerSecTotal / survEnd : null;
    var lastFullToDeath = null, lastFullNote = null;
    if (endReason === 'hpZero') {
      if (!g.everFull) lastFullNote = '未滿血';
      else if (g.lastFullToNotGT == null) lastFullNote = '滿血持續到死(不應發生)';
      else lastFullToDeath = survEnd - g.lastFullToNotGT;
    }
    var healSummary = {
      grossBySource: g.healGross, overflowBySource: g.overflowBy, overflowByLevel: g.overflowByLevel, grossByLevel: g.healGrossByLevel,
      overflowShareByLevel: [1, 2, 3].map(function (l) { return { level: l, share: ratio(g.overflowByLevel[l], g.healGrossByLevel[l]) }; }),
      drainTotal: g.drainTotal, expireLossTotal: g.expireLossTotal
    };
    var capHealGroups = [];
    [1, 2, 3].forEach(function (l) {
      [1, 2].forEach(function (cc) {
        var v = caps.filter(function (c) { return c.judgedLevel === l && c.conditionCount === cc && !c.isCarried; }).map(function (c) { return c.totalHealDue; });
        capHealGroups.push({ level: l, conditionCount: cc, n: v.length, avgDue: avgOf(v), medianDue: median(v) });
      });
    });

    // ----- 踩拍 -----
    var counted = nodes.filter(function (n) { return n.counted; });
    var nodeTypes = ['第一次沾上', '第二次沾上', '送進網'];
    function nodeStat(list) {
      var on = list.filter(function (n) { return n.onBeat; });
      var raw = list.map(function (n) { return n.rawDiffMs; }), adj = list.map(function (n) { return n.adjDiffMs; });
      var rawB = list.map(function (n) { return n.rawDiffBeats; }), adjB = list.map(function (n) { return n.rawDiffBeats + (n.compMs / ((60 / n.bpm) * 1000)); });
      return {
        count: list.length, onBeatCount: on.length, rate: ratio(on.length, list.length),
        rawMedianMs: median(raw), rawIqrMs: iqr(raw), adjMedianMs: median(adj), adjIqrMs: iqr(adj),
        rawMedianBeats: median(rawB), adjMedianBeats: median(adjB), adjCircularIqrBeats: circularIqrBeats(adjB)
      };
    }
    var beatByType = {}, beatByTypeLevel = {}, beatByTypeSeg = {};
    nodeTypes.forEach(function (ty) {
      beatByType[ty] = nodeStat(counted.filter(function (n) { return n.nodeType === ty; }));
      beatByTypeLevel[ty] = [1, 2, 3].map(function (l) { return Object.assign({ level: l }, nodeStat(counted.filter(function (n) { return n.nodeType === ty && n.level === l; }))); });
      beatByTypeSeg[ty] = SEGS.map(function (k) { var st = nodeStat(counted.filter(function (n) { return n.nodeType === ty && evSeg(n) === k; })); return { seg: k, count: st.count, rate: st.rate }; });
    });
    var chance = {};
    [1, 2, 3].forEach(function (l) {
      var bms = LEVELS[l].beatSec * 1000;
      chance[l] = { stick: Math.min(1, 2 * PARAMS.beatWindowStickBeats), deliver: Math.min(1, 2 * PARAMS.beatWindowDeliverMs / bms), beatMs: bms };
    });
    var deliverNodes = counted.filter(function (n) { return n.nodeType === '送進網' && !n.isCarried || n.nodeType === '送進網' && n.isCarried });
    var deliverRate = ratio(deliverNodes.filter(function (n) { return n.onBeat; }).length, deliverNodes.length);
    var beatClass = deliverRate == null ? '未知' : (deliverRate < 0.5 ? '不踩拍' : (deliverRate <= 0.7 ? '半數' : '大部分'));
    var hist = {};
    counted.forEach(function (n) {
      var v = Math.max(-350, Math.min(349, n.adjDiffMs)); var k = Math.floor(v / 10) * 10;
      var key = n.nodeType + '|L' + n.level;
      hist[key] = hist[key] || {};
      hist[key][k] = (hist[key][k] || 0) + 1;
    });
    var tierCount = { byLevel: g.chainStats.tiers, interrupts: g.chainStats.interrupts };
    var chainCaps = caps.filter(function (c) { return c.isChain; });
    var capMaxTier = { reach2: ratio(caps.filter(function (c) { return c.countedNodes === 2 && c.maxTier >= 2; }).length, caps.filter(function (c) { return c.countedNodes === 2; }).length), reach3: ratio(caps.filter(function (c) { return c.countedNodes === 3 && c.maxTier >= 3; }).length, caps.filter(function (c) { return c.countedNodes === 3; }).length) };
    var netTimeByOnBeat = [0, 1, 2, 3].map(function (n) {
      var one = caps.filter(function (c) { return c.onBeatNodes === n && c.conditionCount === 1; }).map(function (c) { return c.netInFieldMs; });
      var two = caps.filter(function (c) { return c.onBeatNodes === n && c.conditionCount === 2; }).map(function (c) { return c.netInFieldMs; });
      return { onBeatNodes: n, oneCond: { n: one.length, medianMs: median(one) }, twoCond: { n: two.length, medianMs: median(two) } };
    });
    var beatReading = {
      byType: beatByType, byTypeByLevel: beatByTypeLevel, byTypeBySeg: beatByTypeSeg, randomBaseline: chance,
      deliverRate: deliverRate, beatClass: beatClass, timeDiffHistogram10ms: hist, tiers: tierCount, captureTierReach: capMaxTier,
      chainCaptureCount: chainCaps.length, chainShareOfCaptures: ratio(chainCaps.length, caps.length), netTimeByOnBeatCount: netTimeByOnBeat,
      healSummary: healSummary, perCaptureHeal: capHealGroups, muteShare: survEnd > 0 ? g.muteSecAcc / Math.max(1, g.gt + 2.4) : null
    };

    // ----- 清場 / 卡死 / 可滿足 0 / 追清場 -----
    var endedWaves = waves.filter(function (w) { return w.endedBy === '下一批出現'; });
    function clearRateOf(list) { return ratio(list.filter(function (w) { return w.cleared; }).length, list.length); }
    var clearBySeg = SEGS.map(function (k) {
      var l = endedWaves.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k; });
      var cl = l.filter(function (w) { return w.cleared; });
      var ts = cl.map(function (w) { return w.clearAfterOutMs; });
      return { seg: k, endedBatches: l.length, cleared: cl.length, clearRate: ratio(cl.length, l.length), afterOutMedianMs: median(ts), afterOutP90Ms: p90(ts) };
    });
    var clearBy30 = [];
    for (var s30 = 0; s30 * 30000 <= survEnd * 1000; s30++) {
      var l30 = endedWaves.filter(function (w) { return w.startSurvMs != null ? (w.startSurvMs >= s30 * 30000 && w.startSurvMs < (s30 + 1) * 30000) : false; });
      clearBy30.push({ index: s30, endedBatches: l30.length, clearRate: clearRateOf(l30) });
    }
    var firstNoClear = endedWaves.filter(function (w) { return !w.cleared; })[0] || null;
    var streak = 0, longestStreak = 0;
    endedWaves.forEach(function (w) { if (w.cleared) { streak++; if (streak > longestStreak) longestStreak = streak; } else streak = 0; });
    var clearedWithExpiry = waves.filter(function (w) { return w.cleared && w.clearHadExpiry; });
    var expDiffs = [];
    waves.forEach(function (w) { if (w.cleared && w.clearExpiredBatchDiffs) expDiffs = expDiffs.concat(w.clearExpiredBatchDiffs); });
    function shareOf(phase) {
      var a = Math.min(60, survEnd), b2 = Math.max(0, survEnd - 60);
      return { r0to60: ratio(g.phaseSec[phase][0], a), rAfter60: ratio(g.phaseSec[phase][1], b2) };
    }
    var clearSummary = {
      clearCount: g.totals.clears, batchCount: g.totals.batches, endedBatchCount: endedWaves.length, clearRate: clearRateOf(endedWaves), bySeg: clearBySeg, by30s: clearBy30,
      withExpiryCount: clearedWithExpiry.length, withExpiryShare: ratio(clearedWithExpiry.length, g.totals.clears), expiredBatchSeqDiffs: expDiffs,
      clearScoreTotal: g.clearScoreTotal, longestClearStreak: longestStreak,
      firstNotClearedBatch: firstNoClear ? { batchSeq: firstNoClear.batchSeq, startMs: firstNoClear.startMs } : null,
      clearGapShareOfDuration: shareOf('clear')
    };
    var stuckSummary = {
      count: stuckEv.length, byTrigger: { networkRotation: stuckEv.filter(function (e) { return e.trigger === '網輪替'; }).length, expire: stuckEv.filter(function (e) { return e.trigger === '過期'; }).length },
      remainBeforeSec: stuckEv.map(function (e) { return r3(e.remainBeforeSec); }), countOnFieldAtTrigger: stuckEv.map(function (e) { return e.countOnField; }),
      supplyCountAtTrigger: stuckEv.map(function (e) { return e.supplyCount; }), stuckGapShareOfDuration: shareOf('stuck')
    };
    function zsStats(list) { var ls = list.map(function (e) { return e.lengthSec; }); return { count: list.length, maxSec: maxOf(ls), medianSec: median(ls), totalSec: sumOf(ls) }; }
    var zeroSatSummary = {
      all: zsStats(zsEv), shareOfDuration: ratio(zsStats(zsEv).totalSec, survEnd),
      byCause: { afterRotation: zsStats(zsEv.filter(function (e) { return e.cause === '網輪替後'; })), afterExpire: zsStats(zsEv.filter(function (e) { return e.cause === '過期後'; })), afterSwipe: zsStats(zsEv.filter(function (e) { return e.cause === '擦過後'; })) }
    };
    var winEv = byType(E, 'clearWindow'), winCaps = byType(E, 'windowCapture');
    function gapBucket(v) { return v == null ? 'none' : (v <= 3 ? '<=3' : (v <= 6 ? '3~6' : '>6')); }
    var capGroups = {};
    winCaps.forEach(function (c) {
      var key = c.level + '|' + c.seg + '|' + c.countOnFieldAtPress + '|' + gapBucket(c.gapRemainAtPressSec);
      var gr = capGroups[key] = capGroups[key] || { level: c.level, seg: c.seg, countOnFieldAtPress: c.countOnFieldAtPress, gapRemainBucket: gapBucket(c.gapRemainAtPressSec), intervals: [], speeds: [] };
      if (c.intervalLastDropToPressMs != null) gr.intervals.push(c.intervalLastDropToPressMs);
      if (c.dragSpeed != null) gr.speeds.push(c.dragSpeed);
    });
    var chaseSummary = {
      windowCount: winEv.length, convertedToClearShare: ratio(winEv.filter(function (e) { return e.closeReason === '清場'; }).length, winEv.filter(function (e) { return e.closeReason !== '換關'; }).length),
      offByOneCount: winEv.filter(function (e) { return e.offByOne; }).length, offByOneBlockedBySupplyCount: winEv.filter(function (e) { return e.offByOneIsUnsatisfiableSupply; }).length,
      gameIndex: g.gameIndex,
      captureGroups: Object.keys(capGroups).map(function (k) { var gr = capGroups[k]; return { level: gr.level, seg: gr.seg, countOnFieldAtPress: gr.countOnFieldAtPress, gapRemainBucket: gr.gapRemainBucket, n: gr.intervals.length, intervalMedianMs: median(gr.intervals), dragSpeedMedian: median(gr.speeds) }; })
    };
    // 每批清完時間 / 殘留 / 陣型
    var finishBySeg = SEGS.map(function (k) {
      var l = waves.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k; });
      var ts = l.filter(function (w) { return w.lastLeaveAfterStartMs != null; }).map(function (w) { return w.lastLeaveAfterStartMs; });
      var diffs = l.filter(function (w) { return w.lastLeaveAfterStartMs != null; }).map(function (w) { return w.lastLeaveAfterStartMs / 1000 - w.periodSec; });
      return { seg: k, batches: l.length, medianMs: median(ts), p90Ms: p90(ts), notLeftCount: l.filter(function (w) { return w.lastLeaveNote === '未離場'; }).length, levelClearedBatches: l.filter(function (w) { return w.lastLeaveNote === '換關清掉'; }).length, minusPeriodSecMedian: median(diffs) };
    });
    var placementTotals = { formationPoint: 0, backup: 0, forced: 0 };
    waves.forEach(function (w) { placementTotals.formationPoint += w.placement.formationPoint; placementTotals.backup += w.placement.backup; placementTotals.forced += w.placement.forced; });
    var byFormation = {};
    waves.forEach(function (w) {
      var f = byFormation[w.formation] = byFormation[w.formation] || { batches: 0, endedBatches: 0, cleared: 0 };
      f.batches++;
      if (w.endedBy === '下一批出現') { f.endedBatches++; if (w.cleared) f.cleared++; }
    });
    Object.keys(byFormation).forEach(function (k) { byFormation[k].clearRate = ratio(byFormation[k].cleared, byFormation[k].endedBatches); });
    var batchShare = { one: ratio(realSamples.filter(function (s) { return s.batchesOnField <= 1; }).length, realSamples.length), two: ratio(realSamples.filter(function (s) { return s.batchesOnField === 2; }).length, realSamples.length), threePlus: ratio(realSamples.filter(function (s) { return s.batchesOnField >= 3; }).length, realSamples.length) };
    var diedByHp = endReason === 'hpZero';
    var diedByExpire = g.deathReasons.indexOf('過期') !== -1;
    var multiBatchSecBeforeDeath = null;
    if (diedByHp) {
      multiBatchSecBeforeDeath = 0;
      for (var si = realSamples.length - 1; si >= 0 && realSamples[si].batchesOnField >= 2; si--) {
        if (si < realSamples.length - 1 && realSamples[si].level !== realSamples[si + 1].level) break;
        multiBatchSecBeforeDeath++;
      }
    }
    var deathAnalysis = null;
    if (diedByHp) {
      var dseqs = diedByExpire ? uniqArr(g.deathBatchSeqs) : [g.batchSeq];
      deathAnalysis = dseqs.map(function (seq) {
        var bt = g.batches[seq - 1];
        return {
          batchSeq: seq, level: bt ? bt.rec.level : null, seg: bt ? bt.rec.seg : null, n: bt ? bt.n : null, capturedCount: caps.filter(function (d) { return d.batchSeq === seq; }).length,
          prev3Batches: [1, 2, 3].map(function (k) { var pb = g.batches[seq - 1 - k]; return pb ? { batchSeq: pb.rec.batchSeq, tailCount: pb.rec.batchExpiredCount, cycleCaptures: pb.rec.cycleCaptures } : null; })
        };
      });
    }

    // ----- 最長無捕捉間隔(死前 30 秒以外, 存活時間, 預備拍不計) -----
    var longestGap = null;
    if (spawns.length) {
      var boundary = Math.max(spawns[0].surv, survEnd * 1000 - 30000);
      var capTimes = caps.map(function (c) { return c.surv; }).filter(function (t) { return t <= boundary; }).sort(function (a, b) { return a - b; });
      var marks = [spawns[0].surv].concat(capTimes, [boundary]);
      for (var mi = 0; mi < marks.length - 1; mi++) {
        var a0 = marks[mi], b0 = marks[mi + 1];
        if (b0 <= a0) continue;
        var handFree = 0, handFreeSat = 0, maxField = 0, crossLevel = false;
        realSamples.forEach(function (sm) {
          if (sm.surv >= a0 && sm.surv < b0) {
            if (!sm.anyHoldOrDrag) handFree++;
            if (!sm.anyHoldOrDrag && sm.satisfiableCount >= 1 && sm.processableCount >= 1) handFreeSat++;
            maxField = Math.max(maxField, sm.countOnField);
          }
        });
        var lvA = null, lvB = null;
        realSamples.forEach(function (sm) { if (sm.surv >= a0 && sm.surv < b0) { if (lvA == null) lvA = sm.level; lvB = sm.level; } });
        crossLevel = lvA != null && lvA !== lvB;
        var durSec = (b0 - a0) / 1000;
        if (!longestGap || durSec > longestGap.durationSec) longestGap = { startSurvMs: a0, endSurvMs: b0, durationSec: durSec, handFreeSec: handFree, handFreeAndProcessableSec: handFreeSat, maxFieldCount: maxField, hadStuckShorten: stuckEv.some(function (e) { return e.surv >= a0 && e.surv < b0; }), crossedLevel: crossLevel };
      }
    }
    // ----- 沒事做 -----
    function idleRatios(sub) {
      var zero = sub.filter(function (s) { return !s.anyHoldOrDrag && s.satisfiableCount === 0 && s.waveState !== '清場後空檔' && s.waveState !== '卡死縮短後空檔' && s.waveState !== '關末停批'; }).length;
      var atLeastOne = sub.filter(function (s) { return !s.anyHoldOrDrag && s.satisfiableCount >= 1; }).length;
      var clearGap = sub.filter(function (s) { return s.waveState === '清場後空檔'; }).length;
      var stuckGap = sub.filter(function (s) { return s.waveState === '卡死縮短後空檔'; }).length;
      var holdGap = sub.filter(function (s) { return s.waveState === '關末停批'; }).length;
      return { zeroRatio: ratio(zero, sub.length), atLeastOneRatio: ratio(atLeastOne, sub.length), clearGapRatio: ratio(clearGap, sub.length), stuckGapRatio: ratio(stuckGap, sub.length), endHoldRatio: ratio(holdGap, sub.length) };
    }
    var idle0to60 = idleRatios(realSamples.filter(function (s) { return s.surv <= 60000; }));
    var idleAfter60 = idleRatios(realSamples.filter(function (s) { return s.surv > 60000; }));

    // ----- 放下到下一次按下 -----
    var dropToNext = [];
    presses.forEach(function (pr) {
      if (pr.intervalSinceLastDropMs != null) dropToNext.push({ ms: pr.intervalSinceLastDropMs, processableAtLastDrop: pr.processableAtLastDrop, netChanged: pr.netChangedSinceLastDrop, pathLen: pr.pathLenSinceLastDrop, level: pr.level });
    });
    var lastDrop = drops.length ? drops[drops.length - 1] : null;
    var lastPress = presses.length ? presses[presses.length - 1] : null;
    var noMorePress = !!(lastDrop && (!lastPress || lastPress.t < lastDrop.t));

    // ----- 每 30 秒分段(存活時間) -----
    var segments = [];
    var nSeg = Math.max(1, Math.floor(survEnd / 30) + 1);
    for (var s = 0; s < nSeg; s++) {
      var within = (function (a, b2) { return function (e) { return e.surv >= a && e.surv < b2; }; })(s * 30000, (s + 1) * 30000);
      var segNets = nets.filter(within);
      var segNetMs = segNets.map(function (n) { return netCapMs[n.netSeq]; }).filter(function (v) { return v != null; });
      var segSpawnIds = spawns.filter(within).map(function (e) { return e.bubbleId; });
      segments.push({
        index: s, startSurvMs: s * 30000, spawnCount: spawns.filter(within).length, captureCount: caps.filter(within).length, expireCount: expires.filter(within).length,
        bounceCondCount: bounceCondDrops.filter(within).length, mistakeCount: mistakeSw.filter(within).length, supplyCount: drops.filter(function (e) { return within(e) && e.isSupply; }).length,
        avgNetInFieldMs: avgOf(segNetMs), clearCount: clearsEv.filter(within).length, stuckShortenCount: stuckEv.filter(within).length,
        spawnOutcome: {
          captured: segSpawnIds.filter(function (id) { return g.bubbleRec[id] && g.bubbleRec[id].outcome === 'captured'; }).length,
          expired: segSpawnIds.filter(function (id) { return g.bubbleRec[id] && g.bubbleRec[id].outcome === 'expired'; }).length,
          levelCleared: segSpawnIds.filter(function (id) { return g.bubbleRec[id] && g.bubbleRec[id].outcome === 'levelCleared'; }).length,
          residual: segSpawnIds.filter(function (id) { return g.bubbleRec[id] && (g.bubbleRec[id].outcome == null || g.bubbleRec[id].outcome === 'residual'); }).length
        }
      });
    }

    // ----- 每關 -----
    var perLevel = [1, 2, 3].filter(function (l) { return g.levelStats[l]; }).map(function (l) {
      var ls = g.levelStats[l];
      var dwell = (segSec[l + 'f'] || 0) + (segSec[l + 'b'] || 0);
      var lcap = caps.filter(function (c) { return c.level === l; });
      var nl = nodeTypes.map(function (ty) { var st = nodeStat(counted.filter(function (n) { return n.nodeType === ty && n.level === l; })); return { nodeType: ty, count: st.count, rate: st.rate }; });
      var lsw = levelSw.filter(function (x) { return x.fromLevel === l; })[0] || null;
      return {
        level: l, dwellSurvSec: r3(dwell), enterHp: r1(ls.enterHp), exitHp: ls.exitHp == null ? null : r1(ls.exitHp), captures: ls.captures, expires: ls.expires,
        backlogRate: backlogByLevel[l].rate, nodeRates: nl, healBySource: ls.healBySrc, overflow: ls.overflow, drainTotal: ls.drain, expireLossTotal: ls.expireLoss,
        clears: ls.clears, bounceCond: ls.bounceCond, levelClearedBubbles: lsw ? lsw.clearedCount : null, completed: !!lsw
      };
    });
    // ----- 換關前後 30 秒 -----
    function winStats(fromSurv, toSurv, lvFilter) {
      var inW = function (e) { return e.surv >= fromSurv && e.surv < toSurv && (lvFilter == null || e.level === lvFilter); };
      var oneN = nets.filter(function (n) { return inW(n) && n.conditionItemCount === 1 && netCapMs[n.netSeq] != null; }).map(function (n) { return netCapMs[n.netSeq]; });
      var ew = waves.filter(function (w) { return w.endedBy === '下一批出現' && w.startSurvMs != null && w.startSurvMs >= fromSurv && w.startSurvMs < toSurv; });
      return { captures: caps.filter(inW).length, expires: expires.filter(inW).length, bounceCond: bounceCondDrops.filter(inW).length, oneCondNetMedianMs: median(oneN), clearRate: clearRateOf(ew), spawns: spawns.filter(inW).length };
    }
    var aroundSwitch = levelSw.map(function (lr) {
      var sv = lr.endSurvMs;
      var win = lr.toLevel === 3 ? 29000 : 30000;
      return { fromLevel: lr.fromLevel, toLevel: lr.toLevel, before: winStats(sv - 30000, sv, lr.fromLevel), after: survEnd * 1000 >= sv + 1 ? winStats(sv, sv + win, lr.toLevel) : null, survivedAfter30s: survEnd * 1000 >= sv + 30000 };
    });
    var aroundSegSwitch = stageCh.map(function (sc) {
      var sv = sc.surv;
      return { level: sc.level, before: winStats(sv - 30000, sv, null), after: survEnd * 1000 >= sv + 30000 ? winStats(sv, sv + 30000, null) : null, previewSpawns: spawns.filter(function (e) { return e.t >= (sc.previewStartMs == null ? sc.effectiveMs : sc.previewStartMs) && e.t < sc.effectiveMs; }).length, previewCaptures: caps.filter(function (e) { return e.t >= (sc.previewStartMs == null ? sc.effectiveMs : sc.previewStartMs) && e.t < sc.effectiveMs; }).length, previewBounces: drops.filter(function (e) { return e.t >= (sc.previewStartMs == null ? sc.effectiveMs : sc.previewStartMs) && e.t < sc.effectiveMs && (e.outcome === '條件不符彈回' || e.category === '不亮扇區' || e.category === '視窗外' || e.category === '失焦'); }).length };
    });
    // 關末前 8 小節 / 15 秒
    var endRush = [1, 2].map(function (l) {
      var done = levelSw.some(function (x) { return x.fromLevel === l; });
      if (!done) return { level: l, completed: false };
      var endBeat = LEVELS[l].endBeat, bsl = LEVELS[l].beatSec;
      var inLast8 = function (e) { return e.level === l && e.lb != null && e.lb >= endBeat - 32 && e.lb < endBeat; };
      var restBack = function (e) { return e.level === l && e.seg === '後段' && e.lb != null && e.lb < endBeat - 32; };
      var last8Caps = caps.filter(inLast8), restCaps = caps.filter(restBack);
      var last8Secs = realSamples.filter(function (s) { return inLast8(s) && s.processableCount >= 2; }).length;
      var restSecs = realSamples.filter(function (s) { return restBack(s) && s.processableCount >= 2; }).length;
      var last15 = function (e) { return e.level === l && e.lb != null && e.lb * bsl >= endBeat * bsl - 15 && e.lb < endBeat; };
      var l15Caps = caps.filter(last15).length, l15Secs = realSamples.filter(function (s) { return last15(s) && s.processableCount >= 2; }).length;
      var restRate = ratio(restCaps.length, restSecs), l15Rate = ratio(l15Caps, l15Secs);
      var itemRest = backlogBySeg[l + 'b'] ? backlogBySeg[l + 'b'].perItemSec : null;
      var item15 = l15Caps > 0 ? l15Secs / l15Caps : null;
      return {
        level: l, completed: true, last8BacklogRate: ratio(last8Caps.length, last8Secs), restBackBacklogRate: restRate,
        last8NetInFieldMedianMs: median(nets.filter(function (n) { return inLast8(n) && netCapMs[n.netSeq] != null; }).map(function (n) { return netCapMs[n.netSeq]; })),
        restBackNetInFieldMedianMs: median(nets.filter(function (n) { return restBack(n) && netCapMs[n.netSeq] != null; }).map(function (n) { return netCapMs[n.netSeq]; })),
        last8DeliverOnBeatRate: ratio(counted.filter(function (n) { return n.nodeType === '送進網' && inLast8(n) && n.onBeat; }).length, counted.filter(function (n) { return n.nodeType === '送進網' && inLast8(n); }).length),
        last15ItemTimeRatio: (item15 != null && itemRest) ? item15 / itemRest : null, sprint: (item15 != null && itemRest) ? (item15 / itemRest <= 0.9) : null
      };
    });
    // ----- 第 3 關 -----
    var lvl3 = null;
    if (g.maxLevel >= 3) {
      var s3 = realSamples.filter(function (s) { return s.level === 3; });
      var per8 = {};
      spawns.filter(function (e) { return e.level === 3 && e.lb != null; }).forEach(function (e) { var k = Math.floor(e.lb / 32); (per8[k] = per8[k] || { spawn: 0, capture: 0, expire: 0, bounceCond: 0, fields: [], hpStart: null, hpEnd: null }).spawn++; });
      caps.filter(function (e) { return e.level === 3 && e.lb != null; }).forEach(function (e) { var k = Math.floor(e.lb / 32); (per8[k] = per8[k] || { spawn: 0, capture: 0, expire: 0, bounceCond: 0, fields: [], hpStart: null, hpEnd: null }).capture++; });
      expires.filter(function (e) { return e.level === 3 && e.lb != null; }).forEach(function (e) { var k = Math.floor(e.lb / 32); (per8[k] = per8[k] || { spawn: 0, capture: 0, expire: 0, bounceCond: 0, fields: [], hpStart: null, hpEnd: null }).expire++; });
      bounceCondDrops.filter(function (e) { return e.level === 3 && e.lb != null; }).forEach(function (e) { var k = Math.floor(e.lb / 32); (per8[k] = per8[k] || { spawn: 0, capture: 0, expire: 0, bounceCond: 0, fields: [], hpStart: null, hpEnd: null }).bounceCond++; });
      s3.forEach(function (e) { var k = Math.floor(e.lb / 32); var o = (per8[k] = per8[k] || { spawn: 0, capture: 0, expire: 0, bounceCond: 0, fields: [], hpStart: null, hpEnd: null }); o.fields.push(e.countOnField); if (o.hpStart == null) o.hpStart = e.hp; o.hpEnd = e.hp; });
      var bs3 = LEVELS[3].beatSec;
      var per8List = Object.keys(per8).map(function (k) {
        var o = per8[k], lenSec = 32 * bs3, midSec = (Number(k) * 32 + 16) * bs3;
        return { barsFrom: Number(k) * 8, spawnRate: o.spawn / lenSec, captureCount: o.capture, expireCount: o.expire, bounceCondCount: o.bounceCond, avgField: avgOf(o.fields), netHpChange: (o.hpStart != null && o.hpEnd != null) ? o.hpEnd - o.hpStart : null, drainRate: PARAMS.drain.l3base + PARAMS.drain.l3perSec * midSec };
      });
      var crash = null;
      var survStart3 = null;
      s3.length && (survStart3 = s3[0].surv);
      for (var ws = (survStart3 || 0); ws + 10000 <= survEnd * 1000 && !crash && survStart3 != null; ws += 1000) {
        var inWin = s3.filter(function (s) { return s.surv >= ws && s.surv < ws + 10000; });
        if (!inWin.length) continue;
        var capIn = caps.filter(function (d) { return d.level === 3 && d.surv >= ws && d.surv < ws + 10000; }).length;
        var avgField = avgOf(inWin.map(function (s) { return s.countOnField; }));
        if (capIn <= 2 && avgField >= 7) crash = { startSurvMs: ws, fieldAtCrash: avgField, hpAtCrash: inWin[0].hp, level3Sec: (ws - survStart3) / 1000 };
      }
      var beforeCrash = crash ? backlog(s3.filter(function (s) { return s.surv < crash.startSurvMs; }), caps.filter(function (c) { return c.level === 3 && c.surv < crash.startSurvMs; })) : null;
      var afterCrash = crash ? backlog(s3.filter(function (s) { return s.surv >= crash.startSurvMs; }), caps.filter(function (c) { return c.level === 3 && c.surv >= crash.startSurvMs; })) : null;
      var postCrashDeliver = crash ? ratio(counted.filter(function (n) { return n.level === 3 && n.nodeType === '送進網' && n.surv >= crash.startSurvMs && n.onBeat; }).length, counted.filter(function (n) { return n.level === 3 && n.nodeType === '送進網' && n.surv >= crash.startSurvMs; }).length) : null;
      var w3 = waves.filter(function (w) { return w.level === 3; });
      lvl3 = {
        periods: w3.map(function (w) { return { batchSeq: w.batchSeq, scheduledBeats: w.periodBeats, scheduledSec: r3(w.periodSec), actualSec: w.actualPeriodSec == null ? null : r3(w.actualPeriodSec), cleared: w.cleared, stuckShortened: w.stuckShortened }; }),
        per8Bars: per8List, crash: crash || { note: '未崩盤' }, backlogBeforeCrash: beforeCrash, backlogAfterCrash: afterCrash, postCrashDeliverOnBeatRate: postCrashDeliver
      };
      if (diedByHp) {
        var lastW = w3[w3.length - 1];
        if (lastW) {
          lvl3.scheduledSpawnRateAtDeath = lastW.n / lastW.periodSec;
          var item3 = backlogByLevel[3].perItemSec;
          lvl3.periodOverItemTimeAtDeath = item3 ? lastW.periodSec / item3 : null;
        }
        lvl3.spawnedLast30sOver30 = spawns.filter(function (e) { return e.surv >= survEnd * 1000 - 30000; }).length / 30;
      }
    }
    // ----- 扇區 -----
    var capD = caps.filter(function (c) { return !c.isCarried; });
    var sectorSummary = {
      distFromCenter: { median: median(capD.map(function (c) { return c.distFromCenter; })), p90: p90(capD.map(function (c) { return c.distFromCenter; })), max: maxOf(capD.map(function (c) { return c.distFromCenter; })) },
      angleToMid: { median: median(capD.map(function (c) { return Math.abs(c.angleToLitMid); })), p90: p90(capD.map(function (c) { return Math.abs(c.angleToLitMid); })), max: maxOf(capD.map(function (c) { return Math.abs(c.angleToLitMid); })) },
      outsideOldRangeShare: ratio(capD.filter(function (c) { return !c.inOldNetRange; }).length, capD.length),
      enterLitToReleaseMs: { median: median(capD.filter(function (c) { return c.enterLitToReleaseMs != null; }).map(function (c) { return c.enterLitToReleaseMs; })), p90: p90(capD.filter(function (c) { return c.enterLitToReleaseMs != null; }).map(function (c) { return c.enterLitToReleaseMs; })) },
      slotOffByDiff: [1, 2, 3, 4].map(function (d) { var n = slotOffDrops.filter(function (x) { return x.notLitDiff === d; }).length; return { diff: d, count: n, shareOfDrops: ratio(n, drops.length) }; })
    };
    // ----- 按下到判成拖曳 -----
    var pressDrag = [1, 2, 3].map(function (l) {
      var v = grabs.filter(function (x) { return x.level === l; }).map(function (x) { return x.msAtDragStart; });
      return { level: l, n: v.length, medianMs: median(v), over200Share: ratio(v.filter(function (m) { return m > 200; }).length, v.length) };
    });
    var freezeCap = caps.map(function (c) { return c.freezeSecTotal; });
    var freezeExp = expires.map(function (c) { return c.freezeSecTotal; });
    var freezeHold = holds.map(function (h) { return h.freezeDurationMs / 1000; });
    // ----- 備料 / 沾錯 -----
    var supplyDrops = drops.filter(function (d) { return d.isSupply; });
    var supplyCaps = caps.filter(function (c) { return c.isSupply; });
    var supplyFate = {};
    supplyDrops.forEach(function (d) { var f = d.supplyFollowUp ? d.supplyFollowUp.fate : '未知'; supplyFate[f] = (supplyFate[f] || 0) + 1; });
    var mistakeFate = {};
    mistakeSw.forEach(function (s) { var f = s.mistakeFollowUp ? s.mistakeFollowUp.fate : '未知'; mistakeFate[f] = (mistakeFate[f] || 0) + 1; });
    var mistakeSummary = {
      colorRate: ratio(mistakeColorSw.length, effSwipes.filter(function (s) { return s.floorKind === '染色'; }).length),
      shapeRate: ratio(mistakeShapeSw.length, effSwipes.filter(function (s) { return s.floorKind === '賦形'; }).length),
      bySeg: SEGS.map(function (k) { var e = effSwipes.filter(function (s) { return evSeg(s) === k; }); var m = e.filter(function (s) { return s.firstAttrMatch === '網要別色' || s.firstAttrMatch === '網要別形'; }); return { seg: k, effective: e.length, mistakes: m.length, rate: ratio(m.length, e.length) }; }),
      fate: mistakeFate, distanceToNeeded: { median: median(mistakeSw.map(function (s) { return s.mistakeDistanceToNeeded; }).filter(function (v) { return v != null; })) }
    };
    var alreadyIntersectGrabs = grabs.filter(function (x) { return x.alreadyIntersectingFloorId != null; }).length;
    // 玩家分類
    var item2b = backlogBySeg['2b'] ? backlogBySeg['2b'].perItemSec : null;
    var playerClass = { seg2bItemTimeSec: item2b, result: item2b == null ? '未分類' : (item2b >= 2.3 ? '新手' : (item2b <= 1.8 ? '熟手' : '中間')) };
    // 關卡切換與乾等
    var switchSummary = levelSw.map(function (lr) {
      var rl = lr.clearedRemainLife;
      return {
        from: lr.fromLevel, to: lr.toLevel, clearedCount: lr.clearedCount, remainLife: { median: median(rl), min: minOf(rl), max: maxOf(rl) }, processableAtEnd: lr.processableAtEnd,
        idleBeforeEndBeats: lr.idleBeforeEndBeats, countInBeats: PARAMS.countInBeats, totalBlankBeats: lr.idleBeforeEndBeats == null ? null : r3(lr.idleBeforeEndBeats + PARAMS.countInBeats),
        carry: lr.hadCarry ? { matchedOldNet: lr.carryMatchedOldNet, result: lr.carryResult } : null
      };
    });
    var carryTotal = g.totals.carryTotal || 0;

    var maxLevelEver = parseInt(lsGet(MAXLEVEL_KEY), 10) || 1;
    var crossRun = {
      maxLevelThisGame: g.maxLevel, maxLevelEverAtEnd: maxLevelEver, firstReachGameIndexLevel2: lsGet(FIRST_REACH_KEY + 2) ? parseInt(lsGet(FIRST_REACH_KEY + 2), 10) : null,
      firstReachGameIndexLevel3: lsGet(FIRST_REACH_KEY + 3) ? parseInt(lsGet(FIRST_REACH_KEY + 3), 10) : null,
      secondsAtMaxLevel: perLevel.length ? perLevel[perLevel.length - 1].dwellSurvSec : null
    };
    var drifts = {};
    [1, 2, 3].forEach(function (l) {
      var v = g.musicDrift[l];
      drifts[l] = { n: v.length, medianMs: median(v), maxAbsMs: v.length ? maxOf(v.map(function (x) { return Math.abs(x); })) : null, overToleranceCount: v.filter(function (x) { return Math.abs(x) > 40; }).length };
    });
    var gtTotal = g.gt + PARAMS.countInBeats * LEVELS[1].beatSec;
    var perSecondTotals = {
      generated: spawns.length, batchNSumRatio: (function () {
        var full = waves.filter(function (w) { return w.endedBy === '下一批出現'; });
        return ratio(full.reduce(function (a, w) { return a + w.placement.formationPoint + w.placement.backup + w.placement.forced; }, 0), full.reduce(function (a, w) { return a + w.n; }, 0));
      })()
    };
    var firstExp = g.firstExpire ? { survSec: r3(g.firstExpire.surv), seg: g.firstExpire.key, batchSeq: g.firstExpire.batchSeq, batchesOnField: g.firstExpire.batchesOnField, queue: g.firstExpire.processable } : null;
    var spawnCheck = {
      spawned: g.totals.spawned, captured: g.totals.captured, expired: g.totals.expired, levelCleared: g.totals.levelCleared,
      residualAtEnd: g.bubbles.length,
      identityHolds: g.totals.spawned === g.totals.captured + g.totals.expired + g.totals.levelCleared + g.bubbles.length,
      periodOverLimitCount: waves.filter(function (w) { return w.periodOverLimit; }).length
    };
    var totalsCheck = {
      spawn: spawns.length, captured: caps.length, expired: expires.length, levelCleared: g.totals.levelCleared, bounceCond: bounceCondDrops.length,
      bounceOuterNotLit: slotOffDrops.length, bounceOuterOther: drops.filter(function (d) { return d.category === '視窗外' || d.category === '失焦'; }).length,
      holdNoDrag: holds.length, swipeEffective: effSwipes.length, swipeLocked: lockedSwipes.length, mistake: mistakeSw.length, supply: supplyDrops.length,
      netAppear: nets.length, batches: g.totals.batches, clears: g.totals.clears, stuckShortens: g.totals.stuckShortens,
      nodeCounted: g.totals.nodeCounted, nodeUncounted: g.totals.nodeUncounted, heals: heals.length, levelSwitches: levelSw.length, periodOverLimit: spawnCheck.periodOverLimitCount
    };
    var dragEnds = byType(E, 'dragEnd');
    var dragTotalMs = dragEnds.reduce(function (a, e) { return a + (e.durationMs || 0); }, 0);

    return {
      durationSec: survEnd, maxLevelReached: g.maxLevel, segStats: segStats, perLevel: perLevel, crossRun: crossRun, playerClass: playerClass,
      backlogProcessingRate: { global: backlogGlobal, bySeg: backlogBySeg, byLevel: backlogByLevel },
      mainIndicators: {
        indicator1_netInFieldTime: indicator1, netByLevelCond: netByLevelCond,
        indicator2_idle: { r0to60: idle0to60, rAfter60: idleAfter60 },
        indicator3_longestNoCaptureGap: { longestGap: longestGap, capturePerMinuteBySeg: segStats.map(function (s) { return { seg: s.seg, capturePerMinute: s.capturePerMinute }; }) },
        indicator4_bounceCond: indicator4,
        indicator5_hp: {
          dangerRatio: dangerRatio, firstDangerSurvSec: g.firstDangerGT, firstDangerSeg: g.firstDangerKey, firstDangerShareOfDuration: (g.firstDangerGT != null && survEnd > 0) ? g.firstDangerGT / survEnd : null,
          dangerEntries: g.dangerEntries, lastFullToDeathSec: lastFullToDeath, lastFullNote: lastFullNote, firstFullSurvSec: g.firstFullGT,
          lastFullToNotAt: g.lastFullToNotGT == null ? null : { survSec: r3(g.lastFullToNotGT), seg: g.lastFullToNotKey, level3Sec: g.lastFullToNotLvSec, field: g.lastFullToNotField },
          multiBatchSecBeforeDeath: multiBatchSecBeforeDeath, fullShareBySeg: segStats.map(function (s) { return { seg: s.seg, share: s.fullHpShare }; })
        },
        indicator6_clear: clearSummary, chaseClear: chaseSummary, beatReading: beatReading,
        auxiliary: { mistake: mistakeSummary, supplyCaptureShare: ratio(supplyCaps.length, caps.length), forcedPlacementCount: g.forcedPlacementCount, grabsAlreadyIntersectingFloor: alreadyIntersectGrabs, grabsTotal: grabs.length }
      },
      hpCurve: g.hpCurve, stuck: stuckSummary, zeroSat: zeroSatSummary,
      wave: { finishBatchTimeBySeg: finishBySeg, placementTotals: placementTotals, byFormation: byFormation, batchesOnFieldShare: batchShare, deathAnalysis: deathAnalysis, firstExpire: firstExp, spawnedOverBatchN: perSecondTotals.batchNSumRatio },
      netTimeByFieldCount: netTimeByFieldCount, firstThreeNetsAfterMarkers: firstThreeNets,
      slots: {
        captureCounts: (function () { var o = {}; for (var i = 1; i <= 8; i++) o['槽' + i] = { count: 0, ms: [] }; capD.forEach(function (c) { if (o[c.slotId]) { o[c.slotId].count++; o[c.slotId].ms.push(c.netInFieldMs); } }); Object.keys(o).forEach(function (k) { o[k] = { count: o[k].count, avgNetInFieldMs: avgOf(o[k].ms) }; }); return o; })(),
        netBySlotDiffMedianMs: { 2: median(netBySlotDiff[2]), 3: median(netBySlotDiff[3]), 4: median(netBySlotDiff[4]) },
        netByCondCountMedianMs: { 1: median(oneMs), 2: median(twoMs) }
      },
      sector: sectorSummary, pressToDrag: pressDrag,
      freeze: { captured: { median: median(freezeCap), p90: p90(freezeCap) }, expired: { median: median(freezeExp), p90: p90(freezeExp) }, holdNoDrag: { median: median(freezeHold), p90: p90(freezeHold) } },
      supply: { total: supplyDrops.length, fate: supplyFate, capturedShare: ratio(supplyCaps.length, caps.length), netTimeSupplyMedianMs: median(supplyCaps.map(function (c) { return c.netInFieldMs; })), netTimeNonSupplyMedianMs: median(caps.filter(function (c) { return !c.isSupply; }).map(function (c) { return c.netInFieldMs; })) },
      levelSwitches: switchSummary, aroundLevelSwitch: aroundSwitch, aroundSegmentSwitch: aroundSegSwitch, endRush: endRush, level3: lvl3,
      carry: { carriedAtSwitch: carryTotal, captured: g.totals.carryCaptured, cleared: g.totals.carryCleared },
      idleTimeRatio: { r0to60: idle0to60, rAfter60: idleAfter60 },
      dropToNextPressIntervals: dropToNext, lastDropNoMorePress: noMorePress, segments30s: segments,
      pauseCount: g.pauseCount, maxConcurrent: g.maxConcurrent, forcedPlacementCount: g.forcedPlacementCount,
      totals: g.totals, totalsCheck: totalsCheck, spawnCheck: spawnCheck,
      scoreComposition: { capture: g.captureScoreTotal, clear: g.clearScoreTotal, overflow: g.overflowPtsTotal, total: g.score },
      sound: { mutedSecRatio: gtTotal > 0 ? g.muteSecAcc / gtTotal : null, audioOutputLatencySec: g.audioOutputLatencySec, avgFrameIntervalMs: g.frameIntervalCount > 0 ? g.frameIntervalSum / g.frameIntervalCount : null, musicDriftByLevel: drifts },
      dragTimeRatio: survEnd > 0 ? dragTotalMs / (survEnd * 1000) : null
    };
  }

  function finalizeAndDownload(g, endReason) {
    if (g.openPauseRecord) { g.openPauseRecord.endRealMs = Date.now() - g.startWall; g.pauseRealMs += g.openPauseRecord.endRealMs - g.openPauseRecord.startRealMs; g.openPauseRecord = null; }
    if (mouse.press) {
      var pb = mouse.press.bubble;
      if (pb && !pb.dead) {
        if (mouse.press.dragging) { pb.dragPathTotal += pb.dragPathLen; dragEndEvent(g, pb, '局結束中止', g.lt); }
        else emit(g, 'holdNoDrag', { bubbleId: pb.id, freezeDurationMs: Math.round((g.gt - (pb.pressGT == null ? g.gt : pb.pressGT)) * 1000), endReason: '局結束' });
      }
    }
    mouse.press = null;
    finalizePendingRelPass(g);
    g.bubbles.slice().forEach(function (b) {
      finalizeBubble(g, b, 'residual', null);
      emit(g, 'fieldEnd', {
        bubbleId: b.id, color: b.color, shape: b.shape, isSupply: b.isSupply, isMistake: b.isMistake, spawnLevel: b.spawnLevel, spawnSegKey: b.spawnSegKey,
        life: r3(Math.max(0, b.life)), grabCount: b.grabCount, countedNodes: b.nodes.map(function (n) { return { type: n.type, onBeat: n.onBeat }; }), tier: b.streak
      });
    });
    closeWindow(g, '局結束');
    closeZeroSat(g, '局結束');
    if (g.lastDropRec && g.lastDropRec.intervalToNextPressMs == null) g.lastDropRec.intervalToNextPressMs = '局結束';
    if (g.wave.cur) flushBatch(g, g.wave.cur, '局結束');
    emit(g, 'netFinal', Object.assign({ netInFieldMsAtEnd: g.net ? Math.round((g.gt - g.net.appearGT) * 1000) : null, condition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null }, netFields(g)));
    g.events.forEach(function (e) { if (e.type === 'wave' && e.startSurvMs == null) e.startSurvMs = null; });
    var summary = computeSummary(g, endReason);
    var out = {
      playerId: PLAYER_ID, gameIndex: g.gameIndex, device: g.device, gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: {
        params: PARAMS,
        levels: [1, 2, 3].map(function (l) { var lv = LEVELS[l]; return { level: l, music: lv.music, bpmTarget: lv.bpm, beatSec: lv.beatSec, bars: lv.bars, endBeat: lv.endBeat, segSwitchBeat: PARAMS.segSwitchBeat, previewBeats: PARAMS.previewBeats, batchN: lv.N, periodHeadTail: lv.p, drain: lv.drain, musicInfo: (function () { try { return Sound.getMusicInfo(lv.music); } catch (e) { return null; } })() }; }),
        floorTransforms: { level1: '原樣', level2: '轉 180°', level3: '左右鏡射' },
        floors: FLOORS.map(function (f) { return { id: f.id, kind: f.kind, color: f.color, shape: f.shape, anglesByLevel: f.ang, positionsByLevel: [1, 2, 3].map(function (l) { var p = floorPos(f, l); return { x: Math.round(p.x), y: Math.round(p.y) }; }), appearByLevel: f.appear }; }),
        sectors: SLOTS.map(function (s) { return { id: s.id, midAngle: s.angle, range: [((s.angle - 22.5) + 360) % 360, (s.angle + 22.5) % 360] }; }),
        slots: SLOTS,
        rotation: { excludeSelfAndNeighbors: true, candidateSlots: 5, sameConditionMaxRun: 2, levelFirstNetColorOnly: true, guaranteePositions: '段切換: 生效後第一張; 換關: 該關第二張; 第 3 關後段無' },
        formations: FORM_ORDER.map(function (k) { var f = FORMATIONS[k]; return { key: k, name: f.name, unlockSegIndex: f.unlockSeg, directions: f.dirs, supportedN: [3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (n) { return f.supports(n); }) }; }),
        beatWindows: { deliverMs: PARAMS.beatWindowDeliverMs, stickBeats: PARAMS.beatWindowStickBeats, stickMsByLevel: [1, 2, 3].map(function (l) { return Math.round(PARAMS.beatWindowStickBeats * LEVELS[l].beatSec * 1000); }), offsetDeliverMs: PARAMS.beatOffsetDeliverMs, offsetStickMs: PARAMS.beatOffsetStickMs },
        buildNotes: { sorting: 'rd v14', eventKeys: 'type 欄為英文代號, 欄位值為中文' }
      },
      countedForMainStats: (g.deathReasons.indexOf('放棄') === -1 && g.deathReasons.indexOf('重開') === -1),
      durationSec: r3(g.surv), score: g.score, deathReasons: g.deathReasons, maxLevelReached: g.maxLevel, pauseCount: g.pauseCount,
      summary: summary, events: g.events
    };
    return downloadJson(out);
  }

  function downloadJson(obj) {
    try {
      var now = new Date();
      var name = 'gamelog-WebGame_BubbleCatcher-' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
        '-' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) + '.json';
      var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
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
    if (!g || g.done) return;
    g.done = true;
    if (reason === 'hpZero') {
      var uq = uniqArr(g.pendingDeathReasons);
      if (uq.length === 0) uq = ['持續扣血'];
      g.deathReasons = uq;
    } else if (reason === 'restart') g.deathReasons = ['重開'];
    else if (reason === 'quit') g.deathReasons = ['放棄'];
    else g.deathReasons = [reason];
    try { Sound.stopMusic(); } catch (e) {}
    var ok = false;
    try { ok = finalizeAndDownload(g, reason); } catch (e) { ok = false; if (window.console) console.error(e); }
    endInfo = { time: g.surv, score: g.score, note: ok ? '紀錄已下載' : '紀錄下載失敗' };
    lastGameEndWall = Date.now();
    inputQueue = []; mouse.btn = false;
    if (reason === 'restart') { startNewGame(); }
    else { screen = SCREEN.END; }
  }
  function startNewGame() {
    var idx = nextGameIndex();
    mouse.press = null; mouse.lastDropPos = null; mouse.netSeqAtLastDrop = null; mouse.pathSinceDrop = 0; mouse.btn = false;
    inputQueue = [];
    var prevGame = game;
    game = createGame(idx);
    game.introT = 0;
    endInfo = null;
    screen = SCREEN.PLAYING;
    try { Sound.playMusic(LEVELS[1].music, { beat: game.lt / game.bs }); } catch (e) {}
    void prevGame;
  }

  // ==================================================================
  // UI 命中與動作
  // ==================================================================
  function titleLocate(p) {
    if (inRect(p.x, p.y, L.title.start)) return 'start';
    if (inRect(p.x, p.y, L.title.guide)) return 'guide';
    if (inRect(p.x, p.y, L.title.device)) return 'device';
    return null;
  }
  function inputLocate(p) {
    if (inRect(p.x, p.y, L.device.mouse)) return 'mouse';
    if (inRect(p.x, p.y, L.device.touchpad)) return 'touchpad';
    return null;
  }
  function pauseMenuLocate(p) {
    var m = L.pauseMenu;
    if (inRect(p.x, p.y, m.resume)) return 'resume';
    if (inRect(p.x, p.y, m.restart)) return 'restart';
    if (inRect(p.x, p.y, m.quit)) return 'quit';
    if (inRect(p.x, p.y, m.guide)) return 'guide';
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
    if (inRect(p.x, p.y, L.gameOver.again)) return 'again';
    if (inRect(p.x, p.y, L.gameOver.title)) return 'title';
    return null;
  }
  function pauseBtnLocate(p) { return inRect(p.x, p.y, L.pauseBtn); }
  function muteBtnLocate(p) { return inRect(p.x, p.y, L.muteBtn); }

  function doTitleAction(key) {
    if (key === 'start') {
      if (deviceType) startNewGame();
      else { deviceOpen = true; deviceFrom = 'start'; }
    } else if (key === 'guide') { guideReturnTo = SCREEN.TITLE; guidePage = 1; screen = SCREEN.GUIDE; }
    else if (key === 'device') { deviceOpen = true; deviceFrom = 'title'; }
  }
  function doInputAction(key) {
    deviceType = key; saveDevice(key);
    deviceOpen = false;
    if (deviceFrom === 'start') startNewGame();
    deviceFrom = null;
  }
  function doPauseMenuAction(key) {
    var g = game;
    if (key === 'resume') resumePause(g);
    else if (key === 'restart') endGame('restart');
    else if (key === 'quit') endGame('quit');
    else if (key === 'guide') { guideReturnTo = SCREEN.PAUSED; guidePage = 1; screen = SCREEN.GUIDE; }
  }
  function doGuideAction(key) {
    if (key === 'close') {
      screen = guideReturnTo || SCREEN.TITLE; guideReturnTo = null;
      if (pendingAutoGuideClose) { markSeenGuide(); pendingAutoGuideClose = false; }
    } else if (key === 'prev') { if (guidePage > 1) guidePage--; }
    else if (key === 'next') { if (guidePage < GUIDE_PAGES) guidePage++; }
  }
  function doEndAction(key) {
    if (key === 'again') startNewGame();
    else if (key === 'title') screen = SCREEN.TITLE;
  }

  // ==================================================================
  // 滑鼠事件(唯一輸入; 不掛鍵盤 / 觸控事件)
  // ==================================================================
  function logicalPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  }
  function inCanvasPos(p) { return p.x >= 0 && p.x < W && p.y >= 0 && p.y < H; }

  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    ensureSoundInit();
    var p = logicalPos(e);
    mouse.x = p.x; mouse.y = p.y; mouse.btn = true; mouse.inside = true;
    mouse.uiDownKey = null;
    if (screen === SCREEN.PLAYING) {
      if (pauseBtnLocate(p)) mouse.uiDownKey = 'pause';
      else if (muteBtnLocate(p)) mouse.uiDownKey = 'mute';
      else inputQueue.push({ k: 'down', x: p.x, y: p.y, ts: e.timeStamp });
    } else if (screen === SCREEN.PAUSED) {
      if (muteBtnLocate(p)) mouse.uiDownKey = 'mute';
      else mouse.uiDownKey = pauseMenuLocate(p);
    } else if (screen === SCREEN.TITLE) {
      mouse.uiDownKey = deviceOpen ? inputLocate(p) : titleLocate(p);
    } else if (screen === SCREEN.GUIDE) mouse.uiDownKey = guideLocate(p);
    else if (screen === SCREEN.END) mouse.uiDownKey = endLocate(p);
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('mousemove', function (e) {
    var p = logicalPos(e);
    var px0 = mouse.x, py0 = mouse.y;
    mouse.x = p.x; mouse.y = p.y;
    var inside = inCanvasPos(p);
    mouse.inside = inside;
    if (screen === SCREEN.TITLE) { if (deviceOpen) hov.device = inside ? inputLocate(p) : null; else hov.title = inside ? titleLocate(p) : null; }
    else if (screen === SCREEN.PLAYING) {
      hov.pauseBtn = inside && pauseBtnLocate(p); hov.muteBtn = inside && muteBtnLocate(p);
      mouse.pathSinceDrop += dist(px0, py0, p.x, p.y);
      if (game && !game.paused) {
        if (mouse.btn && inputQueue.length < 4000) inputQueue.push({ k: 'move', x: p.x, y: p.y, ts: e.timeStamp });
        var gm = game;
        if (gm.net && !gm.netFirstPressDone && gm.phase === 'playing' && dist(p.x, p.y, CX, CY) > INNER_R && sectorOf(p.x, p.y) === gm.net.slot) gm.netApproached = true;
      }
    } else if (screen === SCREEN.PAUSED) { hov.pauseMenu = inside ? pauseMenuLocate(p) : null; hov.muteBtn = inside && muteBtnLocate(p); }
    else if (screen === SCREEN.GUIDE) hov.guide = inside ? guideLocate(p) : null;
    else if (screen === SCREEN.END) hov.end = inside ? endLocate(p) : null;
  });

  window.addEventListener('mouseup', function (e) {
    if (e.button !== 0) return;
    var p = logicalPos(e);
    mouse.x = p.x; mouse.y = p.y;
    var inside = inCanvasPos(p);
    var inWindow = e.clientX >= 0 && e.clientX <= window.innerWidth && e.clientY >= 0 && e.clientY <= window.innerHeight;
    var wasDown = mouse.btn;
    mouse.btn = false;
    var key = mouse.uiDownKey;
    mouse.uiDownKey = null;
    if (screen === SCREEN.PLAYING) {
      if (key === 'pause') { if (inside && pauseBtnLocate(p) && game) { drainInputsNow(game); openPause(game, 'button'); } return; }
      if (key === 'mute') { if (inside && muteBtnLocate(p)) toggleMute(); return; }
      if (wasDown && game && !game.paused) inputQueue.push({ k: 'up', x: p.x, y: p.y, ts: e.timeStamp, outCanvas: !inside, outWin: !inWindow });
      return;
    }
    if (!inside || !key) return;
    if (screen === SCREEN.PAUSED) {
      if (key === 'mute') { if (muteBtnLocate(p)) toggleMute(); }
      else if (pauseMenuLocate(p) === key) doPauseMenuAction(key);
    } else if (screen === SCREEN.TITLE) {
      if (deviceOpen) { if (inputLocate(p) === key) doInputAction(key); }
      else if (titleLocate(p) === key) doTitleAction(key);
    } else if (screen === SCREEN.GUIDE) {
      if (guideLocate(p) === key) doGuideAction(key);
    } else if (screen === SCREEN.END) {
      if (endLocate(p) === key) doEndAction(key);
    }
  });

  // 視窗失去焦點: 拖曳中立刻視為在其他位置放開彈回; 按住未拖比照放開; 接著自動暫停
  window.addEventListener('blur', function () {
    if (screen !== SCREEN.PLAYING || !game || game.paused) return;
    var g = game;
    drainInputsNow(g);
    if (mouse.press) {
      var hb = mouse.press.bubble;
      if (hb && !hb.dead) {
        if (mouse.press.dragging) forceBounce(g, hb, '失焦', g.lt);
        else releaseHoldNoDrag(g, hb, '放開', g.lt);
      }
      mouse.press = null;
    }
    mouse.btn = false; mouse.uiDownKey = null;
    openPause(g, 'blur');
  });

  // ==================================================================
  // 渲染
  // ==================================================================
  function bubbleRenderState(g, b, hoverId) {
    var status = 'idle';
    if (b.mode === 'hold') status = 'held';
    else if (b.mode === 'drag') status = b.carried ? 'carried' : 'dragging';
    else if (b.mode === 'return') status = 'returning';
    var st = { level: g.lvl, x: b.x, y: b.y, color: b.color, shape: b.shape, status: status, life: clamp01(b.life / LIFE) };
    if (b.carried && g.carry) st.paletteLevel = g.carry.oldLevel;
    if (b.spawnAge < Art.timing.spawn) st.spawnT = clamp01(b.spawnAge / Art.timing.spawn);
    if (hoverId != null && b.id === hoverId && b.mode === 'idle') st.hover = true;
    return st;
  }
  function renderGame(g, paused) {
    var lvl = g.lvl, bs = g.bs;
    var beat = g.lt / bs;
    var fl = Math.floor(beat);
    var phase = beat - fl;
    Art.drawBackground(ctx, { level: lvl });
    Art.drawArena(ctx, { level: lvl });
    Art.drawBeatCue(ctx, { level: lvl, phase: phase, beat: fl });
    // 地板
    for (var i = 0; i < FLOORS.length; i++) {
      var f = FLOORS[i], st = floorState(g, f);
      if (!st.exists) continue;
      var p = floorPos(f, lvl);
      var fs = { level: lvl, x: p.x, y: p.y, r: st.r, status: st.status, t: st.t || 0 };
      if (st.shrink) fs.shrink = st.shrink;
      if (f.kind === 'dye') { fs.color = f.color; Art.drawDyeFloor(ctx, fs); }
      else { fs.shape = f.shape; Art.drawShapeFloor(ctx, fs); }
    }
    // 網牆
    var lit = null;
    if (g.net) {
      lit = { slot: g.net.slot, color: g.net.cond.color, shape: g.net.cond.shape };
      if (g.carry) lit.paletteLevel = g.carry.oldLevel;
      else { lit.hintT = g.netHintT; if (g.netFrom != null) lit.fromSlot = g.netFrom; }
    }
    var wall = { level: lvl, lit: lit };
    if (g.catchFx) wall.catchFx = { slot: g.catchFx.slot, t: g.catchFx.t };
    Art.drawNetWall(ctx, wall);
    // 氣泡: 閒置 / 彈回中 → 被按住 → 拖曳中 / 帶過的那一顆
    var hoverId = null;
    if (!paused && !mouse.btn && mouse.inside && g.phase === 'playing') { var hb = findBubbleUnder(g, mouse.x, mouse.y); if (hb) hoverId = hb.id; }
    var order = { idle: 0, 'return': 0, hold: 1, drag: 2 };
    var sorted = g.bubbles.slice().sort(function (a, b) { return (order[a.mode] || 0) - (order[b.mode] || 0); });
    for (var bi = 0; bi < sorted.length; bi++) Art.drawBubble(ctx, bubbleRenderState(g, sorted[bi], hoverId));
    // 回饋
    for (var si = 0; si < g.stickFxs.length; si++) {
      var sf = g.stickFxs[si];
      var sst = { level: lvl, x: sf.bubble.x, y: sf.bubble.y, kind: sf.kind, attr: sf.attr, value: sf.value, t: sf.t, stack: sf.stack };
      if (sf.paletteLevel) sst.paletteLevel = sf.paletteLevel;
      Art.drawStickFx(ctx, sst);
    }
    for (var bf = 0; bf < g.beatFxs.length; bf++) {
      var fx = g.beatFxs[bf];
      var bx = fx.x, by = fx.y;
      if (fx.bubble && !fx.bubble.dead) { bx = fx.bubble.x; by = fx.bubble.y; }
      Art.drawBeatFx(ctx, { level: lvl, x: bx, y: by, tier: fx.tier, t: fx.t, onBubble: fx.onBubble });
    }
    for (var cf = 0; cf < g.chainFxs.length; cf++) { var cfx = g.chainFxs[cf]; Art.drawChainFx(ctx, { level: lvl, x: cfx.x, y: cfx.y, t: cfx.t }); }
    if (g.clearFx) Art.drawClearFx(ctx, { level: lvl, t: g.clearFx.t });
    if (g.phase === 'countIn') {
      var left = Math.max(1, Math.min(4, -fl));
      Art.drawCountIn(ctx, { level: lvl, beatsLeft: left, phase: phase });
      if (lvl > 1 && (g.introT || 0) < g.countInLen) Art.drawLevelIntro(ctx, { level: lvl, t: g.introT || 0, dur: g.countInLen });
    }
    var endBeat = LEVELS[lvl].endBeat;
    var songProgress = (g.phase === 'playing' && endBeat != null) ? clamp01(beat / endBeat) : null;
    Art.drawHud(ctx, {
      level: lvl, hp: g.hp, danger: g.danger, hpFx: g.hpFx, time: g.gt, survival: g.surv, songProgress: songProgress, score: g.score, combo: g.combo
    });
    Art.drawPauseButton(ctx, { level: lvl, hover: hov.pauseBtn && !paused });
    Art.drawMuteButton(ctx, { level: lvl, hover: hov.muteBtn, muted: muted });
  }
  function render() {
    if (screen === SCREEN.TITLE) {
      Art.drawTitle(ctx, { hover: deviceOpen ? null : hov.title });
      Art.drawCredits(ctx, { lines: CREDITS_LINES });
      if (deviceOpen) Art.drawDeviceSelect(ctx, { hover: hov.device, selected: deviceType });
    } else if (screen === SCREEN.PLAYING) {
      renderGame(game, false);
    } else if (screen === SCREEN.PAUSED) {
      renderGame(game, true);
      Art.drawPauseMenu(ctx, { level: game.lvl, hover: hov.pauseMenu });
      Art.drawPauseButton(ctx, { level: game.lvl, hover: false });
      Art.drawMuteButton(ctx, { level: game.lvl, hover: hov.muteBtn, muted: muted });
    } else if (screen === SCREEN.GUIDE) {
      Art.drawGuidePage(ctx, { page: guidePage, hover: hov.guide });
    } else if (screen === SCREEN.END) {
      if (game) renderGame(game, true);
      Art.drawGameOver(ctx, { survival: endInfo ? endInfo.time : 0, score: endInfo ? endInfo.score : 0, hover: hov.end });
      Art.drawCredits(ctx, { lines: CREDITS_LINES });
    }
  }

  // ==================================================================
  // 主迴圈
  // ==================================================================
  var lastTs = null;
  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    var rawDt = ts - lastTs;
    lastTs = ts;
    var dt = Math.min(Math.max(rawDt, 0) / 1000, 1 / 30); // 切分頁回來不瞬移
    if (screen === SCREEN.PLAYING && game && !game.paused && !game.done) {
      if (game.frameIntervalCount < 600) { game.frameIntervalSum += rawDt; game.frameIntervalCount++; }
      tick(dt, ts);
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
