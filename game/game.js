// 捕泡手 遊戲邏輯(spec v16)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art, 聲音一律呼叫 window.Sound。
// 本版相對 v15: 光門判定帶(亮邊往內圈加寬 12 像素, 兩端垂直截斷並限亮扇區; 碰網 / 屬性相符必判 / 換位當下即判 / 離開再碰回一律用判定帶)、
// 第 2 關光門跳位與第 3 關染色區輪轉對調(第 3 關輪轉不設上限、循環照轉)、卡住時第 2 關等跳位而第 1、3 關自動換位、
// 偏移補償(送進網 +50、沾上第 1 關 +40)、氣泡隨拍原地變化(beatPhase)、血量環、空按事件、碰網未觸發嫌疑偵測、說明 4 頁、v16 埋點。
// 交 RD 的「待定」項目與本版做法:
//   3. 一般碰撞推開: idle/hold 氣泡互推(3 pass, 不彈飛), 另疊加「推出已出場地板」; 推不開允許暫時重疊
//   4. 彈回落點: 內圈邊上最近點往圓心退一個氣泡半徑; 與地板相交時沿同半徑換角度找第一個不相交的, 全失敗用預設落點
//   5. 拖曳時氣泡中心 = 指標位置(無偏移); 放開在內圈內外一律以「指標位置」判(指標在畫面外但在視窗內改用氣泡中心)
//   6. 彈回中的氣泡視為靜態障礙物(擋別顆、自己不被推)
//   7. 同一幀順序: 拍點觸發(段切換 → 第 3 關輪轉 → 第 2 關跳位 → 第 1、3 關自動換位)→ 本幀輸入路徑(擦過 / 碰網 / 捕捉 / 輪替)→ 回血 → 持續扣血 → 沾錯扣血 → 過期扣血 → 波次 → 卡住 → 換關
//   碰網判定帶: 亮邊(距圓心 300)往內圈加寬到 288, 兩端在線段端點垂直截斷並限亮扇區 = 梯形 {288 <= a <= 300, |b| <= a × tan 22.5°}(a 沿法線、b 沿邊); 氣泡圓與它相交 = 氣泡中心離帶 <= 20, 沿法線直衝時中心距圓心 268 即碰到
//   8. 滑鼠事件先進佇列, 在 tick 內依事件時刻換算成關內時間後處理; 擦過與碰網以兩幀間路徑掃描(碰網取路徑上第一個符合的點); 段切換 / 輪轉那幀以「幀結束位置」判已相交
//   14. 判定偏移補償: 送進網 +50 毫秒、沾上第 1 關 +40 / 第 2、3 關 0 毫秒(見 PARAMS), 加在節點時刻上; 音樂輸出延遲交 sound.js 內建補償, 判定端不再補
(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var L = Art.layout;
  var W = Art.canvas.width, H = Art.canvas.height;
  var GUIDE_PAGES = Art.guidePages || 4;
  var TAU = Math.PI * 2;
  var BUILD_VERSION = 'demo-v16-0.1.0';

  var CX = 640, CY = 360;
  var INNER_R = 210;
  var BUBBLE_R = 20;
  var MOVE_R = INNER_R - BUBBLE_R;       // 190, 閒置氣泡可活動半徑
  var WALL_APO = 300;                    // 網牆每邊中點距圓心
  var WALL_VERT_R = WALL_APO / Math.cos(22.5 * Math.PI / 180);   // 約 324.7
  var TAN225 = Math.tan(22.5 * Math.PI / 180);
  var GATE_WIDEN = 12;                   // 光門判定加寬(亮邊線段往內圈方向)
  var BAND_IN = WALL_APO - GATE_WIDEN;   // 判定帶內緣距圓心 288(= Art.geometry.gateInnerApothem)
  var DRAG_B = { x0: 20, y0: 20, x1: 1260, y1: 700 };
  var FLOOR_RING = 140;
  var LIFE = 12;

  var PARAMS = {
    bubbleR: BUBBLE_R, floorR: 24, floorRSmall: 20, floorRing: FLOOR_RING, innerR: INNER_R,
    lifeSec: LIFE, hpMax: 100, hpStart: 60,
    hpCatchGain: 6, hpBeatGain: 2, hpChainGain: 2, hpExpireLoss: 6, hpMissLoss: 3, overflowPerHp: 2,
    hpDangerEnter: 40, hpDangerExit: 50,
    beatWindowDeliverMs: 80, beatOffsetDeliverMs: 50,
    beatWindowStickBeats: 0.22, beatOffsetStickMsByLevel: [0, 40, 0, 0],   // 索引 = 關(第 1 關 +40, 第 2、3 關 0)
    gateWiden: GATE_WIDEN, emptyPressRepressSec: 1.0, beatChangeShowFrac: 0.4,
    tierMax: 3,
    stickFxSec: 0.8,
    countInBeats: 4,
    previewBeats: 4, segSwitchBeat: 64,
    floorIntroSec: 2.0,
    lastNoBatchBeats: 2,
    gapBeatPoint: 2,                      // 批間等待: 嚴格晚於本批清完那一刻的第 2 個拍點
    autoSwapBeatPoint: 2,                 // 自動換位: 嚴格晚於卡住成立那一刻的第 2 個拍點
    rotateEveryBeats: 8, rotatePreviewBeats: 2,          // 第 3 關地板輪轉(循環不設上限)
    jumpEveryBeats: 8, jumpPreviewBeats: 1, jumpLastBeat: 152,   // 第 2 關光門跳位(第 160 拍關末不跳, 第 159 拍不預告)
    formationMaxR: 180, formationFloorMin: 48, formationGap: 44,
    spawnGap: 4, spawnTries: 10, spawnFxSec: 0.3,
    dragStartDist: 6, returnDurationSec: 0.2,
    scoreBase: 10, comboBonusPerStreak: 0.1, comboStreakCap: 20,
    sampleIntervalSec: 1.0,
    relPassWindowMs: 150,
    drain: { l1f: 3.2, l1b: 3.8, l2f: 4.6, l2b: 5.2, l3base: 5.2, l3perSec: 0.025 },
    shapeProb: { l2f: 0.25, l2b: 0.4, l3: 0.4 },
    levelIntroSec: 2.4,
    structCost: { rotate: 0.20, jump: 0.19 }              // 第 3 關撞上輪轉 0.20 秒 / 第 2 關撞上跳位 0.19 秒
  };
  function stickOffsetMs(lvl) { return PARAMS.beatOffsetStickMsByLevel[lvl] || 0; }

  // 各關: bpm 一律取 Sound.getMusicInfo 的實際值(三首 = 100 / 115 / 128), 取不到才退回備用值
  var FALLBACK_BPM = [0, 100, 115, 128];
  function musicBpm(name, lvl) {
    try { var mi = Sound.getMusicInfo(name); if (mi && mi.bpm > 0) return mi.bpm; } catch (e) {}
    return FALLBACK_BPM[lvl];
  }
  var LEVELS = [null,
    { n: 1, bpm: 100, bars: 36, endBeat: 144, music: 'stage1', N: [4, 5], drain: [3.2, 3.8], feature: '無' },
    { n: 2, bpm: 115, bars: 40, endBeat: 160, music: 'stage2', N: [5, 6], drain: [4.6, 5.2], feature: '光門跳位' },
    { n: 3, bpm: 128, bars: 48, endBeat: null, music: 'stage3', N: [6, 6], drain: null, feature: '地板輪轉' }
  ];
  LEVELS.forEach(function (lv, i) {
    if (!lv) return;
    lv.bpm = musicBpm(lv.music, i);
    lv.beatSec = 60 / lv.bpm;
    lv.loopBeats = lv.bars * 4;
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
  function angleDelta(a, mid) { var d = a - mid; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
  function uniqArr(arr) { var o = []; arr.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function countBy(arr, fn) { var o = {}; arr.forEach(function (x) { var k = fn(x); o[k] = (o[k] || 0) + 1; }); return o; }

  // ---------- 本機狀態(命名空間 bcv16_; 玩家 ID、輸入裝置、靜音沿用 v15 的值) ----------
  var PLAYER_ID_KEY = 'bcv16_playerId';
  var GAME_COUNT_KEY = 'bcv16_gameCount';
  var DEVICE_KEY = 'bcv16_device';
  var SEEN_GUIDE_KEY = 'bcv16_seenGuide';
  var MUTED_KEY = 'bcv16_muted';
  var MAXLEVEL_KEY = 'bcv16_maxLevel';
  var FIRST_REACH_KEY = 'bcv16_firstReach';
  var LAST_END_KEY = 'bcv16_lastEndWall';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getPlayerId() {
    var id = lsGet(PLAYER_ID_KEY) || lsGet('bcv15_playerId') || lsGet('bcv14_playerId');   // 玩家 ID 沿用舊版
    if (!id) id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    lsSet(PLAYER_ID_KEY, id);
    return id;
  }
  function nextGameIndex() {
    var n = parseInt(lsGet(GAME_COUNT_KEY), 10) || 0;
    n += 1; lsSet(GAME_COUNT_KEY, String(n));
    return n;
  }
  function loadDevice() { return lsGet(DEVICE_KEY) || lsGet('bcv15_device') || null; }
  function saveDevice(dev) { lsSet(DEVICE_KEY, dev); }
  function hasSeenGuide() { return lsGet(SEEN_GUIDE_KEY) === '1'; }
  function markSeenGuide() { lsSet(SEEN_GUIDE_KEY, '1'); }
  function loadMuted() { var v = lsGet(MUTED_KEY); if (v == null) v = lsGet('bcv15_muted'); return v === '1'; }
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
  var animT = 0;                   // 背景 / HUD 動態用的遞增秒數(暫停凍結)
  var CREDITS_LINES = [
    '"Aerosol of my Love", "Disco Medusae", "EDM Detection Mode"',
    'Kevin MacLeod (incompetech.com)',
    'Licensed under Creative Commons: By Attribution 4.0',
    'http://creativecommons.org/licenses/by/4.0/'
  ];

  // ==================================================================
  // 關 / 段 / 地板
  // ==================================================================
  function beatSecOf(lvl) { return LEVELS[lvl].beatSec; }
  function isBackBeat(beat) { return beat >= PARAMS.segSwitchBeat; }
  function segKeyOf(lvl, back) { return lvl + (back ? 'b' : 'f'); }
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

  // 地板: 角度依關對稱變換(第 1 關原樣、第 2 關轉 180°、第 3 關左右鏡射); appear: start = 關內第 0 拍; back = 後段
  var FLOORS = [
    { id: '染A', kind: 'dye', color: 'A', ang: [210, 30, 330], appear: ['start', 'start', 'start'] },
    { id: '染B', kind: 'dye', color: 'B', ang: [330, 150, 210], appear: ['start', 'start', 'start'] },
    { id: '染C', kind: 'dye', color: 'C', ang: [90, 270, 90], appear: ['start', 'start', 'start'] },
    { id: '染D', kind: 'dye', color: 'D', ang: [270, 90, 270], appear: ['back', 'start', 'start'] },
    { id: '賦形方', kind: 'shape', shape: 'square', ang: [150, 330, 30], appear: [null, 'start', 'start'] },
    { id: '賦形三角', kind: 'shape', shape: 'triangle', ang: [30, 210, 150], appear: [null, 'back', 'start'] }
  ];
  // 第 3 關輪轉次數: 關內拍序號 8 的倍數且 >= 8 各轉一格(+60°); 第 3 關循環不中斷、不設上限(一輪 192 拍為 8 的倍數, 接縫照轉)
  function rotationCount(lvl, beatIdx) {
    if (lvl !== 3) return 0;
    return Math.floor(Math.max(0, beatIdx) / PARAMS.rotateEveryBeats);
  }
  function floorAngle(f, lvl, beatIdx) {
    return (f.ang[lvl - 1] + 60 * rotationCount(lvl, beatIdx)) % 360;
  }
  function polarAt(angDeg) {
    var a = angDeg * Math.PI / 180;
    return { x: CX + FLOOR_RING * Math.cos(a), y: CY + FLOOR_RING * Math.sin(a) };
  }
  function floorPos(f, lvl, beatIdx) { return polarAt(floorAngle(f, lvl, beatIdx)); }
  // 版位環上 6 個固定版位(陣型避讓用, 不論有沒有地板)
  var RING_SPOTS = [30, 90, 150, 210, 270, 330].map(function (d) { return polarAt(d); });
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
    var backNow = !!g.curBack;
    var rr = (g.lvl === 3 && backNow) ? PARAMS.floorRSmall : PARAMS.floorR;
    var sinceSeg = g.lt - PARAMS.segSwitchBeat * bs;
    var it = sinceSeg / PARAMS.floorIntroSec;
    if (a === 'back') {
      if (beat < PARAMS.segSwitchBeat - PARAMS.previewBeats) return { exists: false };
      if (!backNow) return { exists: true, active: false, status: 'preview', r: PARAMS.floorR, t: clamp01((beat - (PARAMS.segSwitchBeat - PARAMS.previewBeats)) / PARAMS.previewBeats) };
      return { exists: true, active: true, status: it < 1 ? 'intro' : 'active', r: rr, t: it < 1 ? clamp01(it) : 0 };
    }
    var out = { exists: true, active: true, status: 'active', r: rr, t: 0 };
    if (g.lvl === 3) {
      if (!backNow && beat >= PARAMS.segSwitchBeat - PARAMS.previewBeats) {
        out.shrink = { t: clamp01((beat - (PARAMS.segSwitchBeat - PARAMS.previewBeats)) / PARAMS.previewBeats), toR: PARAMS.floorRSmall };
      } else if (backNow && it < 1) { out.status = 'intro'; out.t = clamp01(it); }
    }
    return out;
  }
  function floorList(g, onlyActive) {
    var list = [];
    for (var i = 0; i < FLOORS.length; i++) {
      var f = FLOORS[i], st = floorState(g, f);
      if (!st.exists) continue;
      if (onlyActive && !st.active) continue;
      var ang = floorAngle(f, g.lvl, g.beatIdx);
      var p = polarAt(ang);
      list.push({ id: f.id, kind: f.kind, color: f.color, shape: f.shape, x: p.x, y: p.y, r: st.r, ang: ang, active: st.active, st: st, def: f });
    }
    return list;
  }

  // ==================================================================
  // 網牆槽位、扇區、亮邊幾何
  // ==================================================================
  var SLOTS = [];
  (function () {
    for (var k = 1; k <= 8; k++) {
      var ang = (k - 1) * 45, a = ang * Math.PI / 180;
      var a1 = (ang - 22.5) * Math.PI / 180, a2 = (ang + 22.5) * Math.PI / 180;
      SLOTS.push({
        no: k, id: '槽' + k, angle: ang, x: CX + WALL_APO * Math.cos(a), y: CY + WALL_APO * Math.sin(a),
        nx: Math.cos(a), ny: Math.sin(a), mx: -Math.sin(a), my: Math.cos(a),
        v1: { x: CX + WALL_VERT_R * Math.cos(a1), y: CY + WALL_VERT_R * Math.sin(a1) },
        v2: { x: CX + WALL_VERT_R * Math.cos(a2), y: CY + WALL_VERT_R * Math.sin(a2) }
      });
    }
    // 亮邊判定帶: 亮邊線段(距圓心 300)往內圈方向加寬到 288, 兩端在線段端點處沿法線垂直截斷, 並限在亮扇區(中線 ±22.5°)內。
    // 局部座標 (a, b): a = 沿法線(離圓心距離), b = 沿邊(順時針為正)。扇區限制在 a <= 300 時一律比端點截斷更緊,
    // 所以判定帶 = 梯形 {288 <= a <= 300, |b| <= a × tan 22.5°}。
    SLOTS.forEach(function (s) {
      var pts = [[BAND_IN, -BAND_IN * TAN225], [BAND_IN, BAND_IN * TAN225], [WALL_APO, WALL_APO * TAN225], [WALL_APO, -WALL_APO * TAN225]];
      s.band = pts.map(function (p) { return { x: CX + p[0] * s.nx + p[1] * s.mx, y: CY + p[0] * s.ny + p[1] * s.my }; });
    });
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

  // 點到線段距離
  function distToSeg(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 < 1e-9 ? 0 : clamp01(((px - a.x) * dx + (py - a.y) * dy) / len2);
    return dist(px, py, a.x + dx * t, a.y + dy * t);
  }
  // 亮邊外側: 亮邊所屬扇區內、且越過亮邊所在直線(往遠離圓心那一側)
  function inLitOutside(px, py, slot) {
    var s = slotByNo(slot);
    var vx = px - CX, vy = py - CY;
    var a = vx * s.nx + vy * s.ny, b = vx * s.mx + vy * s.my;
    return a > WALL_APO && b >= -a * TAN225 && b < a * TAN225;
  }
  // 點到亮邊判定帶(凸梯形)的距離: 在帶內回 0, 在帶外回到四條邊的最短距離
  function distToBand(px, py, slot) {
    var s = slotByNo(slot);
    var vx = px - CX, vy = py - CY;
    var a = vx * s.nx + vy * s.ny, b = vx * s.mx + vy * s.my;
    if (a >= BAND_IN && a <= WALL_APO && Math.abs(b) <= a * TAN225) return 0;
    var q = s.band, d = Infinity;
    for (var i = 0; i < 4; i++) { var di = distToSeg(px, py, q[i], q[(i + 1) % 4]); if (di < d) d = di; }
    return d;
  }
  // 氣泡圓與亮邊判定帶相交, 或中心已在亮邊外側
  function touchesLit(px, py, slot) {
    return distToBand(px, py, slot) <= BUBBLE_R + 1e-9 || inLitOutside(px, py, slot);
  }
  // 路徑 p0 -> p1 上到判定帶的最短距離(距離對 t 為凸函數, 三分搜尋); 埋點「最接近亮邊」用
  function minBandDistOnPath(p0, p1, slot) {
    var l = 0, h = 1;
    function f(t) { return distToBand(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, slot); }
    for (var k = 0; k < 24; k++) {
      var m1 = l + (h - l) / 3, m2 = h - (h - l) / 3;
      if (f(m1) < f(m2)) h = m2; else l = m1;
    }
    return Math.min(f((l + h) / 2), f(0), f(1));
  }
  // 路徑 p0 -> p1 上第一個「碰網」: 回 { t: 比例 0~1, method: '亮邊判定帶' | '進入亮邊外側' }, 沒有回 null。取判定帶相交與進入外側兩者先發生的
  function firstLitTouch(p0, p1, slot) {
    var s = slotByNo(slot);
    var best = null, bestMethod = null;
    // (a) 外側: 三條線性不等式夾出區間
    var v0x = p0.x - CX, v0y = p0.y - CY, v1x = p1.x - CX, v1y = p1.y - CY;
    var a0 = v0x * s.nx + v0y * s.ny, a1 = v1x * s.nx + v1y * s.ny;
    var b0 = v0x * s.mx + v0y * s.my, b1 = v1x * s.mx + v1y * s.my;
    var cons = [
      [a0 - WALL_APO, a1 - WALL_APO],
      [b0 + a0 * TAN225, b1 + a1 * TAN225],
      [a0 * TAN225 - b0, a1 * TAN225 - b1]
    ];
    var lo = 0, hi = 1, ok = true;
    for (var i = 0; i < cons.length; i++) {
      var f0 = cons[i][0], f1 = cons[i][1];
      if (f0 >= 0 && f1 >= 0) continue;
      if (f0 < 0 && f1 < 0) { ok = false; break; }
      var tc = f0 / (f0 - f1);
      if (f0 < 0) lo = Math.max(lo, tc); else hi = Math.min(hi, tc);
    }
    if (ok && lo <= hi + 1e-9) { best = lo; bestMethod = '進入亮邊外側'; }
    // (b) 氣泡圓與亮邊判定帶相交: 到判定帶(凸集合)的距離對 t 為凸函數
    function f(t) { return distToBand(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, slot); }
    var tSeg = null, LIM = BUBBLE_R + 1e-9;
    if (f(0) <= LIM) tSeg = 0;
    else {
      var l2 = 0, h2 = 1;
      for (var k = 0; k < 40; k++) {
        var m1 = l2 + (h2 - l2) / 3, m2 = h2 - (h2 - l2) / 3;
        if (f(m1) < f(m2)) h2 = m2; else l2 = m1;
      }
      var tmin = (l2 + h2) / 2;
      if (f(tmin) <= LIM) {
        var lb = 0, hb = tmin;
        for (var k2 = 0; k2 < 40; k2++) {
          var mid = (lb + hb) / 2;
          if (f(mid) <= LIM) hb = mid; else lb = mid;
        }
        tSeg = hb;
      }
    }
    if (tSeg != null && (best == null || tSeg <= best + 1e-9)) { best = tSeg; bestMethod = '亮邊判定帶'; }
    return best == null ? null : { t: best, method: bestMethod };
  }

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
  var releaseSweeping = false;           // 正在處理「放開前最後一段路徑」(埋點用)
  var releaseSweepPxForDrop = 0;         // 放開時補掃的那一段長度(埋點用)

  // ==================================================================
  // 建立新局
  // ==================================================================
  function newWave() {
    return { phase: 'pre', cur: null, nextStartBeat: null, cancelled: false, lastFormation: null, lastLeaveLT: null };
  }
  function createGame(idx) {
    var prevEnd = lastGameEndWall != null ? lastGameEndWall : (parseInt(lsGet(LAST_END_KEY), 10) || null);
    var gapFromPrev = prevEnd == null ? null : (Date.now() - prevEnd);
    var bs = LEVELS[1].beatSec;
    var g = {
      id: PLAYER_ID + '#' + idx, gameIndex: idx, device: deviceType, startWall: Date.now(), gapFromPrev: gapFromPrev,
      lvl: 1, bs: bs, phase: 'countIn', lt: -PARAMS.countInBeats * bs, gt: -PARAMS.countInBeats * bs, surv: 0, beatIdx: -PARAMS.countInBeats,
      introT: 0, countInLen: PARAMS.countInBeats * bs, lastCountInBeat: null, curBack: false, previewLogged: false, previewStartGT: null,
      hp: PARAMS.hpStart, danger: false, score: 0, combo: 0,
      hpFx: [], stickFxs: [], beatFxs: [], chainFxs: [], missFxs: [], batchCues: [], catchFx: null, netHintT: 99, netFrom: null,
      bubbles: [], nextBubbleId: 1,
      wave: newWave(), batches: [], batchSeq: 0,
      net: null, netSeq: 0, netLevelSeq: 0, recent: [], pendingGuarantee: null, netAppearRec: null, netAppearList: [], netFirstPressDone: false, netApproached: false,
      carry: null, endFrame: false, holdStartGT: null,
      stuck: null, stuckSeq: 0, stuckHint: '網輪替後', autoSwapCount: 0, rotateSeq: 0, jumpSeq: 0, rotatePreviewRec: null, jumpPreviewRec: null, lastRotateBeat: null, lastJumpBeat: null, lastRotateRec: null,
      pendingEmpty: [], lastDtMs: 0, multiBatchFrames: 0,
      events: [], spawnSegOf: {},
      paused: false, pauseCount: 0, openPauseRecord: null, pauseRealMs: 0,
      totals: {
        spawned: 0, captured: 0, expired: 0, missColor: 0, missShape: 0, levelCleared: 0, bounceCond: 0, bounceOuter: 0, stayInner: 0, putBack: 0,
        holdNoDrag: 0, swipeEffective: 0, swipeLocked: 0, batches: 0, nodeCounted: 0, nodeUncounted: 0, nodeOnBeat: 0, nodeByType: {},
        presses: 0, grabs: 0, drops: 0, heals: 0, netAppears: 0, levelSwitches: 0, carryCaptured: 0, carryCleared: 0, touches: 0,
        swapJudged: 0, swapNoJudge: 0, jumpPreviewCaptures: 0, jumpOnlyCount: 0, jumpCondCount: 0, hitOffEdge: 0, emptyPresses: 0, suspects: 0, suspectsSure: 0, rotations: 0
      },
      frame: { rotated: false, expired: false, overflow: false, expireCount: 0, expiredBatchSeqs: [], misses: [] },
      lastDropGT: null, lastDropProcessable: null, lastPressGT: null, lastDropRec: null,
      maxConcurrent: 0, forcedPlacementCount: 0, muteSecAcc: 0, frameIntervalSum: 0, frameIntervalCount: 0, audioOutputLatencySec: 0,
      lastExpireGT: null,
      segSec: {}, fullSecBySeg: {}, noWorkSec: [0, 0], noWorkAvail: [0, 0], waveSec: { out: 0, proc: 0, gap: 0, endHold: 0 },
      sampleAcc: 0, secDrain: 0, secHeal: { catch: 0, beat: 0, chain: 0 }, secMiss: 0, secExpire: 0, secOverflow: 0, secFull: false,
      drainTotal: 0, expireLossTotal: 0, missLossTotal: 0,
      healGross: { catch: 0, beat: 0, chain: 0 }, overflowBy: { catch: 0, beat: 0, chain: 0 }, overflowByLevel: { 1: 0, 2: 0, 3: 0 }, healGrossByLevel: { 1: 0, 2: 0, 3: 0 },
      overflowPtsTotal: 0, captureScoreTotal: 0,
      hpCurve: [], wasFull: false, lastFullToNot: null, everFull: false, firstFullSurv: null,
      lowHpSec: 0, lowHpWas: false, firstLowSurv: null, firstLowKey: null, lowEntries: [], dangerOpenSince: null, dangerSecTotal: 0,
      firstExpire: null, captureSurvTimes: [],
      pendingDeathReasons: [], deathBatchSeqs: [], deathReasons: [],
      levelRecs: [], levelEnterSurv: { 1: 0 }, levelStats: {}, musicDrift: { 1: [], 2: [], 3: [] }, lastDrift: null,
      pendingRelPass: [], stageChanges: [], done: false, maxLevel: 1, lvlSurvStart: 0,
      lastHpLossGT: null, segHp: {}, curSegKey: null,
      chainStats: { tiers: {}, interrupts: {}, byNode: {} },
      nodeDiffs: {}
    };
    enterLevelStats(g, 1);
    try { g.audioOutputLatencySec = Sound.getOutputLatency() || 0; } catch (e) {}
    return g;
  }
  function enterLevelStats(g, lvl) {
    g.levelStats[lvl] = g.levelStats[lvl] || {
      enterSurv: g.surv, enterHp: g.hp, exitHp: null, exitSurv: null, captures: 0, expires: 0, miss: 0, bounceCond: 0, batches: 0, stuckSegs: 0,
      healBySrc: { catch: 0, beat: 0, chain: 0 }, overflow: 0, drain: 0, expireLoss: 0, missLoss: 0, lowSec: 0, clearedByLevelEnd: 0, nonFullSec: 0, nonFullHeal: 0, suspects: 0
    };
  }

  function gtMs(g) { return Math.round(g.gt * 1000); }
  function survMs(g) { return Math.round(g.surv * 1000); }
  // 關內時刻 lt 在當下這一拍內的位置: 相位 0~1、離下一拍毫秒、離最近拍毫秒(帶正負, 晚於拍為正); showing = 氣泡隨拍變化是否在顯示中(每拍開頭 40%)
  function beatPos(g, lt) {
    var bs = g.bs, beat = lt / bs, fl = Math.floor(beat + 1e-9);
    var phase = clamp01(beat - fl), nearest = Math.round(beat);
    return { phase: r3(phase), toNextMs: Math.round(((fl + 1) * bs - lt) * 1000), nearestDiffMs: r1((lt - nearest * bs) * 1000), nearestBeat: nearest, showing: phase < PARAMS.beatChangeShowFrac };
  }
  function segLabel(g) {
    if (g.phase === 'countIn') return '預備拍';
    return g.curBack ? '後段' : '前段';
  }
  function segKeyNow(g) { return segKeyOf(g.lvl, !!g.curBack); }
  function emit(g, type, fields, atLT) {
    var dl = atLT == null ? 0 : (g.lt - atLT);
    var rec = { t: Math.round((g.gt - dl) * 1000), surv: Math.max(0, Math.round((g.surv - dl) * 1000)), gameId: g.id, type: type, level: g.lvl, seg: segLabel(g), beatNo: r3((g.lt - dl) / g.bs) };
    for (var k in fields) rec[k] = fields[k];
    if (fields && fields.bubbleId != null && rec.batchSeq == null) {
      var bb = findBubbleById(g, fields.bubbleId);
      if (bb) rec.batchSeq = bb.batchSeq;
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
  var WAVE_NAME = { pre: '預備拍', out: '出批中', proc: '處理中', gap: '批間等待', endHold: '關末停批' };
  function waveStateName(g) { return WAVE_NAME[g.wave.phase] || null; }
  function findBubbleById(g, id) {
    for (var i = 0; i < g.bubbles.length; i++) if (g.bubbles[i].id === id) return g.bubbles[i];
    return null;
  }
  function batchOf(g, b) { return g.batches[b.batchSeq - 1] || null; }
  function attrOf(b) { return { color: b.color, shape: b.shape }; }

  // ---------- 網條件比對 ----------
  // 可滿足: 透明圓一律算; 已沾上的屬性與條件有任一衝突就不能
  function compatibleWithCond(b, cond) {
    if (!cond) return false;
    var colorOk = (b.color == null) || (b.color === cond.color);
    var shapeOk = (cond.shape == null) || (b.shape === 'circle') || (b.shape === cond.shape);
    return colorOk && shapeOk;
  }
  function compatibleWithNet(b, net) { return !!net && compatibleWithCond(b, net.cond); }
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
  // 網: 亮起 / 輪替(spec「網與條件」「網的輪替」「卡住與自動換位」)
  // ==================================================================
  function slotCandidates(prevSlot) {
    var ex = [prevSlot, wrapSlot(prevSlot - 1), wrapSlot(prevSlot + 1)];
    var cands = [];
    for (var i = 1; i <= 8; i++) if (ex.indexOf(i) === -1) cands.push(i);
    return cands;
  }
  // 捕捉輪替的新條件(保底、同條件連續上限)
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
      if (filtered.length) { picked = pickRandom(filtered); excluded = true; }
    }
    var guarContent = gu ? { kind: gu.kind, value: gu.value } : null;
    if (isGuar) g.pendingGuarantee = null;
    return { cond: picked, isGuar: isGuar, guarContent: guarContent, candCount: candCount, candAfter: excluded ? candCount - 1 : candCount, note: null };
  }
  // 自動換位 / 第 3 關卡住跳位的新條件: 只從「場上至少一顆能滿足」的條件中抽; 不是保底張也不用掉保底
  function rollAutoCondition(g, info) {
    var withShape = info.shapes.length > 0 && Math.random() < info.shapeProb;
    function buildPool(ws) {
      var pool = [];
      if (!ws) info.colors.forEach(function (c) { pool.push({ color: c, shape: null }); });
      else info.colors.forEach(function (c) { info.shapes.forEach(function (s) { pool.push({ color: c, shape: s }); }); });
      return pool.filter(function (cd) { return g.bubbles.some(function (b) { return compatibleWithCond(b, cd); }); });
    }
    var pool = buildPool(withShape), switched = false;
    if (!pool.length) {
      var other = !withShape;
      if (other && info.shapes.length === 0) { /* 沒有形狀可疊: 維持 */ }
      else { pool = buildPool(other); switched = true; withShape = other; }
    }
    if (!pool.length) {
      // 理論上不會發生(卡住成立時場上必有氣泡, 透明圓一律可滿足; 已沾色的氣泡至少有一個條件能滿足)
      pool = info.colors.map(function (c) { return { color: c, shape: null }; });
    }
    var candCount = pool.length;
    var picked = pickRandom(pool), excluded = false;
    if (g.recent.length === 2 && sameCondition(g.recent[0], g.recent[1]) && sameCondition(picked, g.recent[1])) {
      var filtered = pool.filter(function (c) { return !sameCondition(c, picked); });
      if (filtered.length) { picked = pickRandom(filtered); excluded = true; }
    }
    return { cond: picked, isGuar: false, guarContent: null, candCount: candCount, candAfter: excluded ? candCount - 1 : candCount, note: { type: withShape ? '疊' : '不疊', switchedClass: switched } };
  }

  // kind: 'first'(每關第一張)/ 'rotate'(捕捉輪替)/ 'autoswap'(第 1、2 關自動換位)/ 'jumpcond'(第 3 關卡住時跳位換條件); opts.slot 指定槽位
  function lightNet(g, kind, opts) {
    opts = opts || {};
    var prev = g.net;
    g.jumpWatch = null;
    var back = !!g.curBack;
    var info = segInfo(g.lvl, back);
    var slot, cond, candSlots, candConds, isGuar = false, guarContent = null, note = null;
    if (kind === 'first' || !prev) {
      slot = 1 + Math.floor(Math.random() * 8); candSlots = 8;
      cond = { color: pickRandom(info.colors), shape: null }; candConds = info.colors.length;
      prev = null;
    } else {
      if (opts.slot) { slot = opts.slot; candSlots = 1; }
      else { var cands = slotCandidates(prev.slot); slot = pickRandom(cands); candSlots = cands.length; }
      var draw = (kind === 'rotate') ? rollCondition(g, info) : rollAutoCondition(g, info);
      cond = draw.cond; isGuar = draw.isGuar; guarContent = draw.guarContent; candConds = draw.candAfter; note = draw.note;
    }
    g.recent.push(cond); if (g.recent.length > 2) g.recent.shift();
    g.netSeq++; g.netLevelSeq++;
    var net = { seq: g.netSeq, levelSeq: g.netLevelSeq, slot: slot, cond: cond, appearGT: g.gt, appearSurv: g.surv, appearLT: g.lt, kind: kind, isGuar: isGuar, level: g.lvl, jumpTo: null, rotations: 0, jumpsOnly: 0, jumpPreviewSkip: null, touchedDark: 0, featureCount: 0, firstFeatureGT: null, firstFeatureHand: null, closed: false };
    g.netFrom = prev ? prev.slot : null;
    var sd = slotByNo(slot);
    g.net = net;
    g.netHintT = 0;
    g.netApproached = false; g.netFirstPressDone = false;
    var needed = [];
    var cf = floorOfColor(cond.color);
    if (cf) { var cp = floorPos(cf, g.lvl, g.beatIdx); needed.push({ floorId: cf.id, attr: 'color', diffDeg: r1(angleDiff180(angleOf(cp.x, cp.y), sd.angle)) }); }
    if (cond.shape) { var sf = floorOfShape(cond.shape); var sp = floorPos(sf, g.lvl, g.beatIdx); needed.push({ floorId: sf.id, attr: 'shape', diffDeg: r1(angleDiff180(angleOf(sp.x, sp.y), sd.angle)) }); }
    var REASON = { first: '每關第一張', rotate: '捕捉輪替', autoswap: '自動換位', jumpcond: '跳位換條件' };
    var rec = emit(g, 'netAppear', {
      netSeq: net.seq, netLevelSeq: net.levelSeq, reason: g.netSeq === 1 ? '開局' : REASON[kind], reasonDetail: REASON[kind], slotId: sd.id, condition: { color: cond.color, shape: cond.shape },
      conditionItemCount: cond.shape != null ? 2 : 1, isGuarantee: isGuar, guaranteeContent: isGuar ? guarContent : null,
      slotDiff: prev ? slotDiff(prev.slot, slot) : null,
      condDiff: (prev && prev.level === g.lvl) ? condDiff(prev.cond, cond) : null,
      candidateSlotCount: candSlots, candidateConditionCount: candConds, autoCondNote: note,
      satisfiedCountAtAppear: alreadyMatchCount(g), satisfiableCountAtAppear: satisfiableCount(g), fullSatisfiableCountAtAppear: fullSatisfiableCount(g),
      countOnFieldAtAppear: fieldCount(g), processableCountAtAppear: processableCount(g), hpAtAppear: r1(g.hp),
      anyHeldOrDraggingAtAppear: !!mouse.press, neededFloorSlotAngleDiffs: needed,
      approachedBeforeFirstPress: null, firstPressDelayMs: null, waveStateAtAppear: waveStateName(g),
      prevNetEnd: prev ? (kind === 'rotate' ? '捕捉' : (kind === 'autoswap' ? '自動換位' : '跳位換條件')) : null,
      rotationsDuring: null, jumpOnlyDuring: null,
      featureCount: null, endKind: null, inFieldSec: null, inFieldBeats: null, appearToFirstFeatureMs: null, firstFeatureToEndMs: null, handAtFirstFeature: null
    });
    net.rec = rec;
    g.netAppearRec = rec;
    g.netAppearList.push(rec);
    g.totals.netAppears++;
    var bt = g.wave.cur;
    if (bt && cond.shape != null) bt.rec.twoCondNets++;
    g.stuckHint = '網輪替後';          // 新網亮起後才卡住的成因(捕捉輪替 / 自動換位 / 跳位換條件 / 每關第一張)
    snd('netSwap', { x: sd.x });
    return net;
  }
  // 舊網結束時回填「在場期間經歷的特色次數(第 2 關只換位置的跳位 / 第 3 關輪轉)、網在場時間、亮起到第一次撞上特色的時間」等; endKind = 捕捉 / 自動換位 / 跳位換條件 / 換關 / 局結束
  function closeNetRec(net, endKind) {
    if (!net || net.closed) return;
    net.closed = true;
    var g = game, rec = net.rec;
    if (!rec) return;
    rec.rotationsDuring = net.rotations; rec.jumpOnlyDuring = net.jumpsOnly;
    rec.featureCount = net.featureCount; rec.endKind = endKind || null;
    if (g) {
      var inSec = g.gt - net.appearGT;
      rec.inFieldSec = r3(inSec);
      var lv = LEVELS[net.level];
      rec.inFieldBeats = lv ? r3(inSec / lv.beatSec) : null;
      if (net.firstFeatureGT != null) {
        rec.appearToFirstFeatureMs = Math.round((net.firstFeatureGT - net.appearGT) * 1000);
        rec.firstFeatureToEndMs = endKind === '捕捉' ? Math.round((g.gt - net.firstFeatureGT) * 1000) : (endKind || '未捕捉');
        rec.handAtFirstFeature = net.firstFeatureHand;
      }
    }
  }
  // 這張網在場期間第一次經歷關卡特色(第 2 關只換位置的跳位 / 第 3 關輪轉): 記次數、第一次的時刻與當下手上那顆
  function noteNetFeature(g, net, hand) {
    if (!net) return;
    net.featureCount++;
    if (net.firstFeatureGT == null) { net.firstFeatureGT = g.gt; net.firstFeatureHand = hand || null; }
  }
  // 手上那顆(按住或拖曳中)的狀態; needsFloors = 它還有尚未染上 / 賦形的所需項目對應的地板(依當下亮著的網)
  function handInfoNow(g) {
    var pr = mouse.press;
    if (!pr || !pr.bubble || pr.bubble.dead) return { state: '無' };
    var b = pr.bubble, net = g.net, needs = [];
    if (net) {
      if (b.color == null) { var cf = floorOfColor(net.cond.color); if (cf) needs.push(cf); }
      if (net.cond.shape != null && b.shape === 'circle') { var sf = floorOfShape(net.cond.shape); if (sf) needs.push(sf); }
    }
    var info = { state: pr.dragging ? '拖曳中' : '按住', bubbleId: b.id, color: b.color, shape: b.shape, matched: net ? fullyMatchesNet(b, net) : null, needFloorIds: needs.map(function (f) { return f.id; }), hasUnstainedNeeded: needs.length > 0, needDist: null };
    if (needs.length) {
      info.needDist = needs.map(function (f) { var p = floorPos(f, g.lvl, g.beatIdx); return r1(dist(b.x, b.y, p.x, p.y)); });
    }
    return info;
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
      pressGT: null, pressLT: null, downInfo: null, firstPressGT: null,
      floorOverlap: {}, dragMinDist: {}, pathHistory: [], touchFlag: false, touchedDarkThisDrag: 0,
      lastSwipeFloorId: null, lastSwipeGT: null, dragLastSwipePathLen: null, dragLastSwipeGT: null, lastMoveLT: null,
      lockedSame: 0, lockedDiff: 0, lockedSameThis: 0, lockedDiffThis: 0,
      putBack: false, bounced: false, bounceRecords: [], missRecord: null,
      returnFrom: null, returnTo: null, returnElapsed: 0,
      effSwipeCount: 0, nodes: [], streak: 0, lastNodeLT: null, lastCountedNodeLT: null, beatHealTotal: 0,
      lastExitInnerLT: null, lastEnterLitLT: null,
      suspectRecs: [], suspect: false, minBandDist: null, minBandFrameMs: null, maxLitDepth: 0,
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

  // ==================================================================
  // 波次: 出批 → 處理中 → 本批清完 → 批間等待 → 下一批(場上同時只有一批)
  // ==================================================================
  function flushBatch(g, bt, endedBy) {
    if (bt.flushed) return;
    bt.flushed = true;
    var rec = bt.rec;
    rec.t = gtMs(g); rec.surv = survMs(g); rec.endedBy = endedBy;
    if (rec.clearMs == null) rec.clearNote = (endedBy === '換關' ? '換關清掉' : (endedBy === '局結束' ? '未清完' : null));
    g.events.push(rec);
  }

  function startBatch(g, startBeat) {
    var w = g.wave, bs = g.bs;
    var back = isBackBeat(startBeat);
    var info = segInfo(g.lvl, back);
    var n = info.N;
    var startT = startBeat * bs;
    var startGT = g.gt - (g.lt - startT);
    if (w.cur) {
      var pr = w.cur.rec;
      pr.batchDurSec = startGT - pr.startGTs; pr.batchDurBeats = r3(pr.batchDurSec / bs);
      if (pr.clearGTs != null) { pr.actualGapSec = startGT - pr.clearGTs; pr.actualGapBeats = r3(pr.actualGapSec / bs); }
      if (pr.firstPressDelayMs != null && pr.actualGapSec != null) { pr.perItemSec = (pr.batchDurSec - pr.firstPressDelayMs / 1000 - pr.actualGapSec) / pr.n; pr.perItemBeats = r3(pr.perItemSec / bs); }
      flushBatch(g, w.cur, '下一批出現');
    }
    var seq = g.batchSeq + 1;
    var pick = pickFormation(g, n, info.idx);
    w.lastFormation = pick.key;
    var rec = {
      type: 'wave', gameId: g.id, t: null, surv: null, level: g.lvl, seg: back ? '後段' : '前段', batchSeq: seq, endedBy: null,
      formation: FORMATIONS[pick.key].name, direction: pick.dir * FORMATIONS[pick.key].dirStep, n: n,
      startMs: Math.round(startGT * 1000), startSurvMs: survMs(g), startGTs: startGT, startBeat: startBeat, outDoneMs: null,
      spawnOffsetMs: [], placement: { formationPoint: 0, backup: 0, forced: 0 },
      firstPressDelayMs: null, clearMs: null, clearGTs: null, clearNote: null, actualGapSec: null, actualGapBeats: null, batchDurSec: null, perItemSec: null,
      captured: 0, missVanish: 0, expired: 0, bounceCond: 0, suspects: 0, twoCondNets: 0, twoCondCaptured: 0, levelClearedCount: 0, clearPhase: null, clearToNextBeatMs: null,
      hpStart: r1(g.hp), hpClear: null, netHp: null,
      tailFirstMs: null, tailLastMs: null, tailSpanMs: null, hpBeforeTail: null, fullBeforeTail: null,
      stuckSegs: 0, autoSwaps: 0, nextBatchCancelled: false, cancelledOriginalBeat: null
    };
    var bt = { rec: rec, n: n, pts: pick.pts, idx: 0, startBeat: startBeat, nextSpawnT: startT, leftCount: 0, allSpawned: false, flushed: false };
    g.batchSeq = seq; w.cur = bt; w.phase = 'out'; w.cancelled = false; w.nextStartBeat = null;
    g.batches.push(bt);
    g.totals.batches++;
    g.levelStats[g.lvl].batches++;
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
    var beatNo = tSpawn / bs;
    bt.rec.spawnOffsetMs.push(Math.round((beatNo * 2 - Math.round(beatNo * 2)) * 0.5 * bs * 1000));
    emit(g, 'spawn', {
      inPreview: inPreviewPeriod(g), bubbleId: id, batchSeq: g.batchSeq, indexInBatch: i + 1, formation: bt.rec.formation, direction: bt.rec.direction,
      x: Math.round(pos.x), y: Math.round(pos.y), placement: placement, countOnField: fieldCount(g),
      overlapCountAtPlacement: overlap, intersectsFloorAtForce: intersects, beatIndex: r3(beatNo)
    }, tSpawn);
    if (i === 0) g.batchCues.push({ x: pos.x, y: pos.y, t: lag });
    if (bt.idx >= bt.n) {
      bt.allSpawned = true;
      w.phase = 'proc';
      bt.rec.outDoneMs = Math.round((g.gt - (g.lt - tSpawn)) * 1000);
    } else bt.nextSpawnT = (bt.startBeat + bt.idx * 0.5) * bs;
  }

  // 一顆氣泡離場(捕捉 / 過期 / 沾錯消失)時呼叫; lt = 離場時刻(關內秒)
  function noteBubbleLeave(g, b, lt, how) {
    var bt = batchOf(g, b);
    if (!bt) return;
    bt.leftCount++;
    g.wave.lastLeaveLT = lt;
    var rec = bt.rec;
    if (how === 'capture') rec.captured++;
    else if (how === 'miss') rec.missVanish++;
    else if (how === 'expire') {
      var nowMs = gtMs(g);
      if (rec.expired === 0) { rec.hpBeforeTail = r1(g.hp); rec.fullBeforeTail = (g.hp >= 99.9 || g.frame.overflow); rec.tailFirstMs = nowMs; }
      rec.expired++; rec.tailLastMs = nowMs; rec.tailSpanMs = nowMs - rec.tailFirstMs;
    }
  }

  // 本批清完(第 4 步之後判): 排定下一批 = 嚴格晚於清完那一刻的第 2 個拍點; 歌曲最後 2 拍內的取消
  function checkBatchCleared(g) {
    var w = g.wave, bt = w.cur;
    if ((w.phase !== 'out' && w.phase !== 'proc') || !bt || !bt.allSpawned || bt.leftCount < bt.n) return;
    var bs = g.bs;
    var tClear = w.lastLeaveLT == null ? g.lt : w.lastLeaveLT;
    var beat = Math.floor(tClear / bs + 1e-9) + PARAMS.gapBeatPoint;
    var rec = bt.rec;
    rec.clearGTs = g.gt - (g.lt - tClear); rec.clearMs = Math.round(rec.clearGTs * 1000);
    var cpos = beatPos(g, tClear); rec.clearPhase = cpos.phase; rec.clearToNextBeatMs = cpos.toNextMs;
    rec.hpClear = r1(g.hp); rec.netHp = r1(g.hp - rec.hpStart);
    var endBeat = LEVELS[g.lvl].endBeat;
    if (endBeat != null && beat >= endBeat - PARAMS.lastNoBatchBeats) {
      w.nextStartBeat = null; w.cancelled = true; w.phase = 'endHold';
      rec.nextBatchCancelled = true; rec.cancelledOriginalBeat = beat;
      g.holdStartGT = rec.clearGTs;
    } else { w.nextStartBeat = beat; w.phase = 'gap'; }
  }

  // 本幀到時的出批 / 冒出照常執行(endT = 本關關末時刻, 第 3 關為 Infinity)
  function advanceWave(g, endT) {
    var w = g.wave, bs = g.bs, guard = 0;
    while (guard++ < 400) {
      var evT = Infinity, kind = null;
      if (w.phase === 'out' && w.cur) { evT = w.cur.nextSpawnT; kind = 'spawn'; }
      else if (w.phase === 'gap' && w.nextStartBeat != null) { evT = w.nextStartBeat * bs; kind = 'batch'; }
      if (kind == null || evT > g.lt + 1e-9 || evT >= endT - 1e-9) break;
      if (kind === 'batch') startBatch(g, w.nextStartBeat);
      else spawnNext(g, evT);
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
  // 彈回: 從氣泡當下位置出發, 落點依 (aimX, aimY) 的方向取內圈邊上退一個氣泡半徑
  function startReturn(g, b, aimX, aimY) {
    b.mode = 'return';
    b.returnFrom = { x: b.x, y: b.y };
    b.returnTo = pickReturnTarget(g, aimX, aimY);
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
  // 命(血條, 0~100): 持續扣血 / 回血(含溢出轉分數) / 沾錯與過期扣血 / 危險狀態
  // ==================================================================
  function pushHpFx(g, from, to, kind) { g.hpFx.push({ from: from, to: to, kind: kind, t: 0 }); }
  function updateDanger(g) {
    if (!g.danger && g.hp <= PARAMS.hpDangerEnter) {
      g.danger = true;
      g.dangerOpenSince = g.surv;
      snd('danger');
    } else if (g.danger && g.hp >= PARAMS.hpDangerExit) {
      g.danger = false;
      if (g.dangerOpenSince != null) { g.dangerSecTotal += g.surv - g.dangerOpenSince; g.dangerOpenSince = null; }
    }
    // 血量 <= 40 的進出紀錄(telemetry 指標 5)
    var low = g.hp <= PARAMS.hpDangerEnter;
    if (low && !g.lowHpWas) {
      g.lowEntries.push({ enterSurvMs: survMs(g), durationSec: null, seg: segKeyNow(g), level: g.lvl, batchSeq: g.batchSeq, startSurv: g.surv });
      if (g.firstLowSurv == null) { g.firstLowSurv = g.surv; g.firstLowKey = segKeyNow(g); }
    } else if (!low && g.lowHpWas) {
      var le = g.lowEntries[g.lowEntries.length - 1];
      if (le && le.durationSec == null) le.durationSec = g.surv - le.startSurv;
    }
    g.lowHpWas = low;
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
    if (before < 99.9) g.levelStats[g.lvl].nonFullHeal += applied;      // 非滿血期間的實得回血(各關「非滿血期間每秒收入」用)
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
  // 氣泡收尾
  // ==================================================================
  function removeBubble(g, b) {
    b.dead = true;
    var idx = g.bubbles.indexOf(b);
    if (idx >= 0) g.bubbles.splice(idx, 1);
  }
  // outcome: captured / expired / levelCleared / residual / missed; 回填「條件不符彈回」紀錄
  function setJumpHandFate(g, b, fate) {
    if (g.jumpHandRec && g.jumpHandRec.bubble === b) { g.jumpHandRec.rec.handFate = fate; g.jumpHandRec.rec.handFateAfterMs = Math.round((g.gt - g.jumpHandRec.rec.t / 1000) * 1000); g.jumpHandRec = null; }
  }
  function finalizeBubble(g, b, outcome, lt) {
    var nowMs = gtMs(g);
    setJumpHandFate(g, b, { captured: '捕捉', expired: '過期', levelCleared: '換關清掉', residual: '局結束殘留', missed: '沾錯消失' }[outcome]);
    b.bounceRecords.forEach(function (r) {
      r.laterCaptured = (outcome === 'captured');
      r.timeToCaptureMs = outcome === 'captured' ? (nowMs - r.t) : null;
      r.dragsAfter = Math.max(0, b.grabCount - r.grabOrdinalAtBounce);
      r.finalFate = { captured: '捕捉', expired: '過期', levelCleared: '換關清掉', residual: '局結束殘留', missed: '沾錯消失' }[outcome];
    });
    // 碰網未觸發嫌疑的回填: 之後沒再碰網就記去向
    b.suspectRecs.forEach(function (r) {
      if (r.nextTouchMs == null && r.fate == null) {
        r.fate = { captured: '捕捉', expired: '過期', levelCleared: '換關清掉', residual: '局結束殘留', missed: '沾錯消失' }[outcome];
        r.fateMs = Math.round(nowMs - r.releaseGT * 1000);
      }
    });
  }

  function expireBubble(g, b) {
    if (b.dead) return;
    finalizeBubble(g, b, 'expired');
    removeBubble(g, b);
    var bt = batchOf(g, b);
    noteBubbleLeave(g, b, g.lt, 'expire');
    var last = bt ? (bt.allSpawned && bt.leftCount >= bt.n) : false;
    var expRec = emit(g, 'expire', {
      bubbleId: b.id, batchSeq: b.batchSeq, color: b.color, shape: b.shape, everColored: b.color != null, putBack: b.putBack,
      grabCount: b.grabCount, freezeSecTotal: r3(b.freezeSecTotal), beatHealTotal: b.beatHealTotal, maxTier: b.nodes.reduce(function (m, n) { return Math.max(m, n.tier || 0); }, 0),
      countOnField: fieldCount(g), processableCount: processableCount(g),
      netMatchAtExpire: fullyMatchesNet(b, g.net), waveState: waveStateName(g), isLastOfBatch: last, inStuck: !!g.stuck,
      spawnToFirstPressMs: b.firstPressGT == null ? '未按' : Math.round((b.firstPressGT - b.spawnGT) * 1000)
    });
    g.frame.expired = true; g.frame.expireCount++; g.stuckHint = '過期後';
    g.totals.expired++;
    g.levelStats[g.lvl].expires++;
    if (!g.firstExpire) g.firstExpire = { surv: g.surv, key: segKeyNow(g), batchSeq: b.batchSeq, processable: processableCount(g) };
    snd('expire', { x: b.x });
    var before = g.hp;
    g.hp = Math.max(0, g.hp - PARAMS.hpExpireLoss);
    g.expireLossTotal += before - g.hp; g.levelStats[g.lvl].expireLoss += before - g.hp;
    g.secExpire += before - g.hp;
    pushHpFx(g, before, g.hp, 'expire');
    g.combo = 0;
    updateDanger(g);
    emit(g, 'hpLoss', {
      reason: 'expire', amount: PARAMS.hpExpireLoss, hpBefore: r1(before), hpAfter: r1(g.hp), countOnField: fieldCount(g), expiredBatchSeq: b.batchSeq,
      sinceLastExpireMs: g.lastExpireGT == null ? null : Math.round((g.gt - g.lastExpireGT) * 1000)
    });
    g.lastExpireGT = g.gt;
    g.frame.expiredBatchSeqs.push(b.batchSeq);
  }

  // 沾錯消失的血量扣除(同一幀順序: 回血 → 持續扣血 → 沾錯 → 過期)
  function applyMissLoss(g, m) {
    var before = g.hp;
    g.hp = Math.max(0, g.hp - PARAMS.hpMissLoss);
    var lost = before - g.hp;
    g.missLossTotal += lost; g.levelStats[g.lvl].missLoss += lost; g.secMiss += lost;
    pushHpFx(g, before, g.hp, 'miss');
    updateDanger(g);
    if (m.rec) { m.rec.hpLoss = PARAMS.hpMissLoss; m.rec.hpAfter = r1(g.hp); }
  }

  // ==================================================================
  // 擦過地板 + 節點(第一次 / 第二次沾上)與踩拍
  // ==================================================================
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
    var p = floorPos(f, g.lvl, g.beatIdx);
    return Math.max(0, dist(b.x, b.y, p.x, p.y) - BUBBLE_R - st.r);
  }
  function inPreviewPeriod(g) {
    var beat = g.lt / g.bs;
    return g.phase === 'playing' && !g.curBack && beat >= PARAMS.segSwitchBeat - PARAMS.previewBeats;
  }
  // 第 3 關輪轉預告中: 輪轉前 2 拍(第 k − 2、k − 1 拍), k = 8 的倍數且 >= 8, 循環不設上限
  function inRotateCue(g) {
    if (g.lvl !== 3 || g.phase !== 'playing') return false;
    var beat = g.lt / g.bs, k = Math.ceil(beat / PARAMS.rotateEveryBeats - 1e-9) * PARAMS.rotateEveryBeats;
    if (k < PARAMS.rotateEveryBeats) k = PARAMS.rotateEveryBeats;
    return beat >= k - PARAMS.rotatePreviewBeats && beat < k;
  }
  // 第 2 關跳位預告中: 跳位前 1 拍(第 k − 1 拍), k = 8 的倍數、>= 8、<= 152(第 159 拍不預告)
  function inJumpCue(g) {
    if (g.lvl !== 2 || g.phase !== 'playing') return false;
    var beat = g.lt / g.bs, k = Math.ceil(beat / PARAMS.jumpEveryBeats - 1e-9) * PARAMS.jumpEveryBeats;
    if (k < PARAMS.jumpEveryBeats) k = PARAMS.jumpEveryBeats;
    return k <= PARAMS.jumpLastBeat && beat >= k - PARAMS.jumpPreviewBeats && beat < k;
  }
  // 距上次關卡特色(第 2 關跳位 / 第 3 關輪轉)的拍數; 第 1 關沒有特色記空
  function beatsSinceStructure(g) {
    var beat = g.lt / g.bs;
    if (g.lvl === 2 || g.lvl === 3) return r3(beat - Math.floor(Math.max(0, beat) / PARAMS.rotateEveryBeats) * PARAMS.rotateEveryBeats);
    return null;
  }

  // 節點(第一次 / 第二次沾上 / 送進網 / 已鎖定擦過 / 條件不符碰網)共用: 埋點 + 踩拍判定
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
    var bpos = beatPos(g, ltSec);
    var rec = {
      nodeType: type, bubbleId: b.id, counted: counted, nodeLevelSec: r3(ltSec), bpm: LEVELS[g.lvl].bpm, nearestBeat: chk.nearestBeat,
      rawDiffMs: r1(chk.rawMs), rawDiffBeats: r3(chk.rawBeats), compMs: compMs, adjDiffMs: r1(chk.adjMs), windowMs: r1(windowMs),
      onBeat: counted ? chk.on : null, tier: counted ? tier : null, interrupted: counted ? interrupted : null, interruptPos: interruptPos,
      prevCountedGapMs: prevCountedGap == null ? null : Math.round(prevCountedGap * 1000),
      prevCountedGapBeats: prevCountedGap == null ? null : r3(prevCountedGap / g.bs),
      prevAnyGapMs: prevAnyGap == null ? null : Math.round(prevAnyGap * 1000),
      isCarried: !!b.carried, judgedLevel: g.lvl,
      beatChangeShowing: bpos.showing, beatPhase: bpos.phase, fullAtNode: g.hp >= 99.9
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
      cs.byNode[kk] = cs.byNode[kk] || { counted: 0, onBeat: 0 };
      cs.byNode[kk].counted++; if (chk.on) cs.byNode[kk].onBeat++;
      var dk = type + '|L' + g.lvl;
      (g.nodeDiffs[dk] = g.nodeDiffs[dk] || { raw: [], adj: [], rawBeats: [], swapJudged: [] });
      g.nodeDiffs[dk].raw.push(chk.rawMs); g.nodeDiffs[dk].adj.push(chk.adjMs); g.nodeDiffs[dk].rawBeats.push(chk.rawBeats);
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
  function gtAt(g, lt) { return g.gt - (g.lt - lt); }
  function clampDrag(x, y) { return { x: clampNum(x, DRAG_B.x0, DRAG_B.x1), y: clampNum(y, DRAG_B.y0, DRAG_B.y1) }; }
  function isOnUiRegion(px, py) { return inRect(px, py, L.hudLeft) || inRect(px, py, L.hudRight) || inRect(px, py, L.pauseBtn) || inRect(px, py, L.muteBtn); }

  // 拖曳結束事件(含碰網、沾錯消失、換關中止、局結束中止; 此事件不等於放下)
  function dragEndEvent(g, b, reason, lt) {
    var floors = floorList(g, true);
    var nearest = {};
    for (var i = 0; i < floors.length; i++) {
      var d = b.dragMinDist[floors[i].id];
      nearest[floors[i].id] = d == null ? null : Math.max(0, r1(d - BUBBLE_R - floors[i].r));
    }
    var gnow = gtAt(g, lt);
    var rec = emit(g, 'dragEnd', {
      bubbleId: b.id, dragSessionId: b.dragSessionId, reason: reason,
      pathLength: Math.round(b.dragPathLen), durationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      lockedSameThisDrag: b.lockedSameThis, lockedDiffThisDrag: b.lockedDiffThis, nearestEdgeDistanceByFloor: nearest,
      darkEdgeTouchesThisDrag: b.touchedDarkThisDrag, isCarried: !!b.carried, isSuspect: false,
      intervalToNextPressMs: null, pathToNextPress: null
    }, lt);
    g.lastDragEndRec = rec;
    g.lastDragEndGT = gnow;
    g.lastDropProcessable = processableCount(g) + ((reason === '放開' || reason === '碰網彈回') ? 1 : 0);
    mouse.lastDropPos = { x: b.x, y: b.y };
    mouse.pathSinceDrop = 0;
    mouse.netSeqAtLastDrop = g.netSeq;
    return rec;
  }

  // 本幀拖曳路徑(p0->p1, 關內時間 lt0->lt1)上依先後判: 擦過地板、碰網; 並記路過相鄰地板之間、衝出內圈
  function processDragSegment(g, b, p0, p1, lt0, lt1) {
    var floors = floorList(g, true);
    var items = [];
    for (var i = 0; i < floors.length; i++) {
      var z = floors[i];
      var combinedR = BUBBLE_R + z.r;
      var wasOverlap = !!b.floorOverlap[z.id];
      var interval = sweepCircleInterval(p0, p1, z.x, z.y, combinedR);
      var endInside = dist(p1.x, p1.y, z.x, z.y) <= combinedR;
      if (!wasOverlap && interval) items.push({ kind: 'floor', t: interval[0], z: z, order: z.kind === 'dye' ? 0 : 1 });
      b.floorOverlap[z.id] = endInside;
      var closeD = closestDistanceOnSegment(p0, p1, z.x, z.y);
      if (b.dragMinDist[z.id] == null || closeD < b.dragMinDist[z.id]) b.dragMinDist[z.id] = closeD;
    }
    var net = g.net;
    if (net) {
      // 碰網未觸發嫌疑用: 本次拖曳(對當下這張網)氣泡圓離判定帶的最小距離、越過亮邊直線的最大深度、最接近那一刻的幀間隔
      if (b.minBandNetSeq !== net.seq) { b.minBandNetSeq = net.seq; b.minBandDist = null; b.minBandFrameMs = null; b.maxLitDepth = 0; }
      var mdist = Math.max(0, minBandDistOnPath(p0, p1, net.slot) - BUBBLE_R);
      if (b.minBandDist == null || mdist < b.minBandDist) { b.minBandDist = mdist; b.minBandFrameMs = g.lastDtMs; }
      var sl = slotByNo(net.slot);
      var dep0 = (p0.x - CX) * sl.nx + (p0.y - CY) * sl.ny - WALL_APO, dep1 = (p1.x - CX) * sl.nx + (p1.y - CY) * sl.ny - WALL_APO;
      b.maxLitDepth = Math.max(b.maxLitDepth, dep0, dep1);
    }
    if (net && !b.touchFlag) {
      var tt = firstLitTouch(p0, p1, net.slot);
      if (tt != null) items.push({ kind: 'net', t: tt.t, method: tt.method, order: 2 });
    }
    // 不亮的邊: 碰到不亮邊的次數(只計數, 沒有任何作用)
    countDarkTouches(g, b, p0, p1, net, lt1);
    items.sort(function (a, c) { return Math.abs(a.t - c.t) < 1e-9 ? a.order - c.order : a.t - c.t; });
    var nowMs = gtMs(g);
    var pathBefore = b.dragPathLen;
    var segLen = dist(p0.x, p0.y, p1.x, p1.y);
    for (var e = 0; e < items.length; e++) {
      var it = items[e], frac = it.t;
      var px = p0.x + (p1.x - p0.x) * frac, py = p0.y + (p1.y - p0.y) * frac;
      var nodeLT = lt0 + (lt1 - lt0) * frac;
      b.dragPathLen = pathBefore - segLen + segLen * frac;   // 路徑長只算到事件點
      b.x = px; b.y = py;
      if (it.kind === 'floor') {
        var res = swipeFloor(g, b, it.z, { x: px, y: py }, nodeLT);
        if (res === 'gone') return;
      } else {
        resolveTouch(g, b, { x: px, y: py }, nodeLT, it.method, null);
        return;
      }
    }
    b.dragPathLen = pathBefore; b.x = p1.x; b.y = p1.y;
    pushPathHistory(b, nowMs);
    // 路過相鄰地板之間(兩塊中心連線段)
    var fl = floors.slice().sort(function (a, c) { return a.ang - c.ang; });
    for (var pi = 0; pi < fl.length; pi++) {
      var za = fl[pi], zb = fl[(pi + 1) % fl.length];
      if (za === zb) continue;
      var hit = segSegIntersect(p0, p1, { x: za.x, y: za.y }, { x: zb.x, y: zb.y });
      if (!hit) continue;
      var len = dist(za.x, za.y, zb.x, zb.y);
      if (len > 200) continue;                                 // 只算相鄰兩個版位(間距 140)
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
      b.lastExitInnerLT = lt1;
      emit(g, 'exitInner', {
        bubbleId: b.id, angleDeg: r1(angleOf(crossOut.x, crossOut.y)), sector: '槽' + sectorOf(crossOut.x, crossOut.y), litSlot: g.net ? g.net.slot : null,
        lastSwipeFloorId: b.lastSwipeFloorId, lastSwipeGT: b.lastSwipeGT == null ? null : Math.round(b.lastSwipeGT * 1000),
        alreadySatisfied: fullyMatchesNet(b, g.net)
      }, lt1);
    }
    if (g.net) {
      var inLit = dist(p1.x, p1.y, CX, CY) > INNER_R && sectorOf(p1.x, p1.y) === g.net.slot;
      var wasLit = dist(p0.x, p0.y, CX, CY) > INNER_R && sectorOf(p0.x, p0.y) === g.net.slot;
      if (inLit && !wasLit) b.lastEnterLitLT = lt1;
    }
    // 目前是否貼在亮邊上(換位當下不符時要先離開再碰回才判)
    b.touchFlag = g.net ? touchesLit(p1.x, p1.y, g.net.slot) : false;
  }
  // 拖曳中碰到不亮邊: 沒有任何作用, 只記次數(埋點)
  function countDarkTouches(g, b, p0, p1, litNet, lt1) {
    if (!b.darkSince) b.darkSince = {};
    for (var s = 1; s <= 8; s++) {
      if (litNet && s === litNet.slot) { b.darkSince[s] = null; continue; }
      var f0 = touchesLit(p0.x, p0.y, s), f1 = touchesLit(p1.x, p1.y, s);
      if (!f0 && f1) { b.touchedDarkThisDrag++; if (litNet && litNet.touchedDark != null) litNet.touchedDark++; }
      if (f1) { if (b.darkSince[s] == null) b.darkSince[s] = lt1; } else b.darkSince[s] = null;
    }
    if (g.jumpWatch && g.jumpWatch.oldSlot != null && g.jumpWatch.oldSlot !== (litNet && litNet.slot)) {
      if (!touchesLit(p0.x, p0.y, g.jumpWatch.oldSlot) && touchesLit(p1.x, p1.y, g.jumpWatch.oldSlot)) g.jumpWatch.rec.oldEdgeTouches++;
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

  // 擦過一塊生效地板: 回傳 'gone'(沾錯消失, 拖曳已結束)或 'ok'
  function swipeFloor(g, b, z, pos, nodeLT) {
    var net = g.net;
    var before = attrOf(b);
    var attr = z.kind === 'dye' ? 'color' : 'shape';
    var value = attr === 'color' ? z.color : z.shape;
    var locked = attr === 'color' ? (b.color != null) : (b.shape !== 'circle');
    var cls;
    if (locked) cls = '已鎖定';
    else {
      var conflict = !!net && (attr === 'color' ? (value !== net.cond.color) : (net.cond.shape != null && value !== net.cond.shape));
      cls = conflict ? '沾錯消失' : '生效';
    }
    var within1BeatAfterRotate = g.lvl === 3 && g.lastRotateRec && g.lastRotateBeat != null && (nodeLT / g.bs - g.lastRotateBeat) <= 1 + 1e-9 && (nodeLT / g.bs - g.lastRotateBeat) >= 0;
    if (within1BeatAfterRotate) g.lastRotateRec.swipesWithin1Beat.push(cls);
    b.lastSwipeFloorId = z.id; b.lastSwipeGT = gtAt(g, nodeLT);
    b.dragLastSwipePathLen = b.dragPathLen; b.dragLastSwipeGT = gtAt(g, nodeLT);
    var evt = {
      bubbleId: b.id, floorId: z.id, floorKind: z.kind === 'dye' ? '染色' : '賦形', floorLevel: g.lvl, floorAngle: z.ang, enterBeat: r3(nodeLT / g.bs),
      pathLenSinceDragStart: Math.round(b.dragPathLen),
      beforeColor: before.color, beforeShape: before.shape, afterColor: before.color, afterShape: before.shape,
      classification: cls, lockedSameAsExisting: null,
      netCaresThisAttr: net ? (attr === 'color' ? true : (net.cond.shape != null)) : null,
      inPreview: inPreviewPeriod(g), inRotateCue: inRotateCue(g), beatsSinceRotate: g.lvl === 3 ? beatsSinceStructure(g) : null
    };
    if (cls === '已鎖定') {
      var same = (attr === 'color') ? (before.color === value) : (before.shape === value);
      evt.lockedSameAsExisting = same;
      g.totals.swipeLocked++;
      if (same) { b.lockedSame++; b.lockedSameThis++; } else { b.lockedDiff++; b.lockedDiffThis++; }
      emit(g, 'swipe', evt, nodeLT);
      pushStickFx(g, b, 'locked', attr, value, b.carried && g.carry ? g.carry.oldLevel : null);
      emitNode(g, b, '已鎖定擦過', false, nodeLT, PARAMS.beatWindowStickBeats * g.bs * 1000, stickOffsetMs(g.lvl));
      return 'ok';
    }
    if (cls === '沾錯消失') {
      evt.afterColor = '消失'; evt.afterShape = '消失';
      if (attr === 'shape') evt.shapeCondition = net.cond.shape ? '網要的' : '網沒列形狀';
      var swRec = emit(g, 'swipe', evt, nodeLT);
      g.totals.swipeEffective += 0;
      if (attr === 'color') g.totals.missColor++; else g.totals.missShape++;
      var distNeeded = neededFloorDistance(g, b, attr === 'color' ? 'color' : 'shape', net);
      var neededDistColor = null;
      if (net) { var nf = floorOfColor(net.cond.color); if (nf) neededDistColor = r1(neededFloorDistance(g, b, 'color', net)); }
      var bt = batchOf(g, b);
      var mrec = emit(g, 'missVanish', {
        bubbleId: b.id, batchSeq: b.batchSeq, floorId: z.id, floorKind: z.kind === 'dye' ? '染色' : '賦形', floorAngle: z.ang,
        netSeq: net ? net.seq : null, netCondition: net ? { color: net.cond.color, shape: net.cond.shape } : null,
        beforeColor: before.color, beforeShape: before.shape,
        pressToVanishMs: b.pressGT == null ? null : Math.round((gtAt(g, nodeLT) - b.pressGT) * 1000),
        grabToVanishPath: Math.round(b.dragPathLen),
        distToNeededFloor: attr === 'color' ? neededDistColor : (distNeeded == null ? null : r1(distNeeded)),
        beatsSinceStructure: beatsSinceStructure(g), inRotateCue: inRotateCue(g), inJumpCue: inJumpCue(g),
        withinOneBeatAfterRotate: g.lvl === 3 && beatsSinceStructure(g) != null && beatsSinceStructure(g) <= 1 && g.beatIdx >= 8,
        floorRadius: z.r, floorCurrentAngle: z.ang,
        hpLoss: null, hpAfter: null,
        batchRemaining: bt ? (bt.n - bt.leftCount - 1) : null, isLastOfBatch: bt ? (bt.allSpawned && bt.leftCount + 1 >= bt.n) : null,
        countOnField: fieldCount(g)
      }, nodeLT);
      var cur = g.wave.cur;
      if (within1BeatAfterRotate) g.lastRotateRec.missRadiiWithin1Beat.push(z.r);
      g.missFxs.push({ x: pos.x, y: pos.y, color: attr === 'color' ? value : null, t: 0, paletteLevel: b.carried && g.carry ? g.carry.oldLevel : null });
      snd('wrongDye', { x: pos.x });
      g.combo = 0;
      g.stuckHint = '沾錯消失後';
      g.levelStats[g.lvl].miss++;
      g.frame.misses.push({ rec: mrec, bubble: b });
      b.dragPathTotal += b.dragPathLen;
      dragEndEvent(g, b, '沾錯消失', nodeLT);
      finalizeBubble(g, b, 'missed');
      removeBubble(g, b);
      noteBubbleLeave(g, b, nodeLT, 'miss');
      g.stickFxs = g.stickFxs.filter(function (f) { return f.bubble !== b; });
      g.beatFxs = g.beatFxs.filter(function (f) { return f.bubble !== b; });
      mouse.press = null;
      void swRec; void cur;
      return 'gone';
    }
    // 生效
    if (attr === 'color') b.color = value; else b.shape = value;
    evt.afterColor = b.color; evt.afterShape = b.shape;
    if (attr === 'shape') evt.shapeCondition = (net && net.cond.shape) ? '網要的' : '網沒列形狀';
    g.totals.swipeEffective++;
    emit(g, 'swipe', evt, nodeLT);
    pushStickFx(g, b, 'stick', attr, value, b.carried && g.carry ? g.carry.oldLevel : null);
    b.effSwipeCount++;
    var nodeType = b.effSwipeCount === 1 ? '第一次沾上' : '第二次沾上';
    var winMs = PARAMS.beatWindowStickBeats * g.bs * 1000;
    var chk = emitNode(g, b, nodeType, true, nodeLT, winMs, stickOffsetMs(g.lvl));
    if (chk.on) {
      b.beatHealTotal += PARAMS.hpBeatGain;
      heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: nodeType, tier: chk.tier }, nodeLT);
      pushBeatFx(g, b, b.x, b.y, chk.tier, true);
      snd('onBeat', { step: chk.tier, x: pos.x });
    }
    return 'ok';
  }

  // ==================================================================
  // 碰網(捕捉 / 條件不符彈回 / 換位當下即判)
  // ==================================================================
  function levelRecOpen(g) { return g.levelRecs.length ? g.levelRecs[g.levelRecs.length - 1] : null; }
  function setCarryResult(g, result, lt) {
    var lr = levelRecOpen(g);
    if (lr && lr.hadCarry && lr.carryResult == null) { lr.carryResult = result; lr.carryResultMs = Math.round(gtAt(g, lt) * 1000); }
  }
  // 帶過的那一顆非捕捉結果: 直接清掉(不彈回、不扣血), 舊網熄滅
  function clearCarried(g, b, result, lt) {
    finalizeBubble(g, b, 'levelCleared');
    removeBubble(g, b);
    g.totals.levelCleared++; g.totals.carryCleared++;
    setCarryResult(g, result, lt);
    if (g.net) closeNetRec(g.net, '換關');
    g.net = null; g.carry = null; g.stickFxs = g.stickFxs.filter(function (f) { return f.bubble !== b; });
    mouse.press = null;
  }

  // 捕捉(一般與帶過的那一顆共用): 得分、連續數、回血、送進網節點(踩拍、漸強、整串); 回傳摘要供碰網 / 捕捉事件使用
  function captureBubble(g, b, lt, net, isCarried, pos, method) {
    var gnow = gtAt(g, lt);
    var newCombo = g.combo + 1;
    var pts = scoreForCombo(newCombo);
    g.score += pts; g.captureScoreTotal += pts; g.combo = newCombo;
    var hpBefore = g.hp;
    var cond = net.cond;
    var conditionCount = cond.shape != null ? 2 : 1;
    finalizeBubble(g, b, 'captured');
    g.captureSurvTimes.push(Math.max(0, g.surv - (g.lt - lt)));
    g.totals.captured++;
    g.levelStats[g.lvl].captures++;
    if (isCarried) g.totals.carryCaptured++;
    var hpStartAll = g.hp;
    var healDue = PARAMS.hpCatchGain + b.beatHealTotal;
    heal(g, b, PARAMS.hpCatchGain, 'catch', null, lt);
    var deliverChk = emitNode(g, b, '送進網', true, lt, PARAMS.beatWindowDeliverMs, PARAMS.beatOffsetDeliverMs, {
      netSeq: net.seq, judgedLevel: net.level, beatLevel: g.lvl, touchMethod: method, swapJudged: method === '換位當下即判'
    });
    if (method === '換位當下即判') {
      var dk = '送進網|L' + g.lvl;
      if (g.nodeDiffs[dk]) g.nodeDiffs[dk].swapJudged.push(g.nodeDiffs[dk].raw.length - 1);
    }
    if (deliverChk.on) {
      b.beatHealTotal += PARAMS.hpBeatGain; healDue += PARAMS.hpBeatGain;
      heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: '送進網', tier: deliverChk.tier }, lt);
    }
    var counted = b.nodes.length;
    var onCount = b.nodes.filter(function (n) { return n.onBeat; }).length;
    var chain = counted >= 1 && onCount === counted;
    if (chain) { healDue += PARAMS.hpChainGain; heal(g, b, PARAMS.hpChainGain, 'chain', null, lt); }
    var fxX = clampNum(pos.x, 0, W), fxY = clampNum(pos.y, 0, H);
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
      netSeq: net.seq, netLevelSeq: net.levelSeq, slotId: slotByNo(net.slot).id, conditionCount: conditionCount,
      netInFieldMs: Math.round((gnow - net.appearGT) * 1000), netInFieldBeats: r3((gnow - net.appearGT) / (LEVELS[net.level] ? LEVELS[net.level].beatSec : g.bs)), hpBefore: r1(hpBefore),
      processingMs: Math.round((gnow - b.spawnGT) * 1000), processingMsExFreeze: Math.round((gnow - b.spawnGT - b.freezeSecTotal) * 1000),
      freezeSecTotal: r3(b.freezeSecTotal), pressToDragMs: b.downInfo ? b.downInfo.msAtDragStart : null,
      grabCount: b.grabCount, pathLength: Math.round(b.dragPathTotal), lockedSame: b.lockedSame, lockedDiff: b.lockedDiff,
      putBack: b.putBack, bouncedBefore: b.bounced, spawnSegKey: b.spawnSegKey, spawnLevel: b.spawnLevel, points: pts,
      countedNodes: counted, onBeatNodes: onCount, nodeResults: b.nodes.map(function (n) { return n.onBeat ? n.tier : 0; }),
      maxTier: b.nodes.reduce(function (m, n) { return Math.max(m, n.tier || 0); }, 0),
      interruptPos: (function () { for (var i = 0; i < b.nodes.length; i++) if (b.nodes[i].interrupted) return i + 1; return null; })(),
      isChain: chain, totalHealDue: healDue, totalHealApplied: r1(g.hp - hpStartAll), isCarried: isCarried, judgedLevel: net.level
    };
    if (!isCarried) {
      var bt = batchOf(g, b);
      noteBubbleLeave(g, b, lt, 'capture');
      if (bt && cond.shape != null) bt.rec.twoCondCaptured++;
      extra.isLastOfBatch = bt ? (bt.allSpawned && bt.leftCount >= bt.n) : null;
    }
    removeBubble(g, b);
    return { extra: extra, deliverChk: deliverChk };
  }

  // 碰網: 拖曳中的氣泡碰到亮邊的那一刻立即判定, 拖曳結束
  function resolveTouch(g, b, pos, lt, method, swapWaitMs) {
    var net = g.net;
    if (!net) return;
    var isCarried = !!b.carried;
    var ok = fullyMatchesNet(b, net);
    var slotObj = slotByNo(net.slot);
    if (!method) method = distToBand(pos.x, pos.y, net.slot) <= BUBBLE_R + 0.01 ? '亮邊判定帶' : '進入亮邊外側';
    g.totals.touches++;
    // 碰網未觸發嫌疑回填: 該顆之後再次碰網的時間與結果
    var tchGT = gtAt(g, lt);
    b.suspectRecs.forEach(function (r) { if (r.nextTouchMs == null) { r.nextTouchMs = Math.round((tchGT - r.releaseGT) * 1000); r.nextTouchResult = ok ? '捕捉' : '條件不符'; } });
    // 第 2 關跳位: 手上那顆跳位後到碰網的時間(回填)
    if (g.jumpHandRec && g.jumpHandRec.bubble === b && g.jumpHandRec.rec.touchAfterJumpMs == null) g.jumpHandRec.rec.touchAfterJumpMs = Math.round(tchGT * 1000 - g.jumpHandRec.rec.jumpMs);
    b.dragPathTotal += b.dragPathLen;
    b.x = pos.x; b.y = pos.y;
    var gnow = gtAt(g, lt);
    var dc = dist(pos.x, pos.y, CX, CY);
    var cond = net.cond;
    var base = {
      bubbleId: b.id, touchMs: Math.round(gnow * 1000), x: Math.round(pos.x), y: Math.round(pos.y), distFromCenter: r1(dc),
      angleToLitMid: r1(angleDelta(angleOf(pos.x, pos.y), slotObj.angle)), method: method, swapWaitMs: swapWaitMs == null ? null : Math.round(swapWaitMs),
      exitInnerToTouchMs: b.lastExitInnerLT == null ? null : Math.round((lt - b.lastExitInnerLT) * 1000),
      enterLitToTouchMs: b.lastEnterLitLT == null ? null : Math.round((lt - b.lastEnterLitLT) * 1000),
      speed: (function () { var s = speedBefore(b, gtMs(g), 150); return s == null ? null : Math.round(s); })(),
      pointerToBubble: r1(dist(mouse.x, mouse.y, b.x, b.y)),
      colorMatch: b.color === cond.color, shapeMatch: cond.shape == null ? '不比對' : (b.shape === cond.shape),
      netSeq: net.seq, netLevelSeq: net.levelSeq, slotId: slotObj.id, netCondition: { color: cond.color, shape: cond.shape },
      inJumpCue: inJumpCue(g), netChangedDuringDrag: !!(b.netSeqAtGrab != null && b.netSeqAtGrab !== net.seq) || !!b.jumpDuringDrag,
      isCarried: isCarried, judgedLevel: net.level, releaseAfterMs: null, viaReleaseSweep: releaseSweeping
    };
    var touchRec;
    if (ok) {
      dragEndEvent(g, b, '碰網捕捉', lt);
      var cap = captureBubble(g, b, lt, net, isCarried, pos, method);
      base.result = '捕捉'; base.deliverRawDiffMs = cap.deliverChk ? r1(cap.deliverChk.rawMs) : null; base.deliverAdjDiffMs = cap.deliverChk ? r1(cap.deliverChk.adjMs) : null;
      touchRec = emit(g, 'netTouch', base, lt);
      var capEvt = {
        bubbleId: b.id, waveState: waveStateName(g), distFromCenter: base.distFromCenter, angleToLitMid: base.angleToLitMid, touchMethod: method,
        exitInnerToTouchMs: base.exitInnerToTouchMs, inPreview: inPreviewPeriod(g), inRotateCue: inRotateCue(g), inJumpCue: inJumpCue(g),
        countOnField: fieldCount(g) + 1, pathToNextPress: null, afterSwapFirstCapture: false, hadSuspect: !!b.suspect
      };
      for (var k in cap.extra) capEvt[k] = cap.extra[k];
      var crec = emit(g, 'capture', capEvt, lt);
      g.lastCaptureRec = crec;
      if (g.pendingSwapRec) { g.pendingSwapRec.firstCaptureAfterMs = Math.round((gnow - g.pendingSwapRec.swapGT) * 1000); g.pendingSwapRec = null; crec.afterSwapFirstCapture = true; }
      g.catchFx = { slot: net.slot, t: 0, x: pos.x, y: pos.y };
      if (isCarried) {
        setCarryResult(g, '碰網捕捉', lt);
        closeNetRec(net, '捕捉');
        g.net = null; g.carry = null;
      } else if (!g.endFrame) {
        var tgt = net.jumpTo;
        if (tgt) { g.totals.jumpPreviewCaptures++; if (g.jumpPreviewRec) { g.jumpPreviewRec.captureDuringPreview = true; } }
        closeNetRec(net, '捕捉');
        lightNet(g, 'rotate', tgt ? { slot: tgt } : null);
        g.frame.rotated = true;
        crec.rotatedToNet = g.net.seq;
      } else closeNetRec(net, '捕捉');          // 關末那一幀的捕捉不執行網的輪替, 舊網在換關時熄滅
      mouse.press = null;
      g.pendingTouchRec = { rec: touchRec, gt: gnow };
      return;
    }
    // 條件不符
    dragEndEvent(g, b, '碰網彈回', lt);
    g.combo = 0;
    emitNode(g, b, '條件不符碰網', false, lt, PARAMS.beatWindowDeliverMs, PARAMS.beatOffsetDeliverMs, { netSeq: net.seq, judgedLevel: net.level, touchMethod: method });
    if (isCarried) {
      base.result = '條件不符清掉';
      touchRec = emit(g, 'netTouch', base, lt);
      clearCarried(g, b, '碰網條件不符清掉', lt);
    } else {
      base.result = '條件不符彈回';
      g.totals.bounceCond++; g.levelStats[g.lvl].bounceCond++;
      var bt2 = batchOf(g, b);
      if (bt2) bt2.rec.bounceCond++;
      b.bounced = true;
      touchRec = emit(g, 'netTouch', base, lt);
      touchRec.grabOrdinalAtBounce = b.grabCount;
      b.bounceRecords.push(touchRec);
      setJumpHandFate(g, b, '彈回');
      startReturn(g, b, pos.x, pos.y);
    }
    mouse.press = null;
    g.pendingTouchRec = { rec: touchRec, gt: gnow };
  }

  // 亮網換位那一刻(第 1、3 關自動換位、第 2 關跳位): 拖曳中的氣泡已與新亮邊判定帶相交(已貼著亮邊, 用加寬後的位置判)或中心在其外側 → 相符即判碰網捕捉, 不符不判(要先離開再碰回)
  function judgeAfterSwap(g, lt) {
    var db = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
    if (!db || db.dead || !g.net) return;
    db.jumpDuringDrag = true;
    if (touchesLit(db.x, db.y, g.net.slot)) {
      var since = db.darkSince ? db.darkSince[g.net.slot] : null;
      var waitMs = since != null ? Math.max(0, (lt - since) * 1000) : 0;
      if (fullyMatchesNet(db, g.net)) {
        g.totals.swapJudged++;
        if (g.lastSwapJudgeInfo) g.lastSwapJudgeInfo.swapJudge = '換位當下即判捕捉';
        resolveTouch(g, db, { x: db.x, y: db.y }, lt, '換位當下即判', waitMs);
      } else {
        g.totals.swapNoJudge++;
        db.touchFlag = true;
        emit(g, 'swapNoJudge', { bubbleId: db.id, netSeq: g.net.seq, slotId: slotByNo(g.net.slot).id, color: db.color, shape: db.shape, waitMs: Math.round(waitMs) }, lt);
        if (g.lastSwapJudgeInfo) g.lastSwapJudgeInfo.swapJudge = '不符未判';
      }
    } else db.touchFlag = false;
  }

  // ==================================================================
  // 放下位置(碰網以外) / 系統事件強制結果
  // ==================================================================
  function emitDrop(g, b, lt, o) {
    var gnow = gtAt(g, lt);
    var evt = {
      bubbleId: b.id, category: o.category, sectorSlotId: o.sectorSlotId || null, sectorIsLit: o.sectorIsLit == null ? null : o.sectorIsLit,
      color: b.color, shape: b.shape,
      netSeq: g.net ? g.net.seq : null, litSlotId: g.net ? slotByNo(g.net.slot).id : null, netCondition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null,
      outcome: o.outcome, isCarried: !!b.carried, judgedLevel: g.net ? g.net.level : g.lvl,
      x: Math.round(o.px), y: Math.round(o.py), distFromCenter: r1(dist(o.px, o.py, CX, CY)),
      pointerOnUi: !!o.onUi, pointerSource: o.pointerSource || '指標', putBackIn: !!o.putBack,
      dragDurationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      dragDistance: Math.round(b.dragPathTotal),
      lastSwipeToDropPathLen: b.dragLastSwipePathLen == null ? null : Math.round(b.dragPathLen - b.dragLastSwipePathLen),
      lastSwipeToDropMs: b.dragLastSwipeGT == null ? null : Math.round((gnow - b.dragLastSwipeGT) * 1000),
      countOnField: fieldCount(g), inPreview: inPreviewPeriod(g), releaseSweepPx: Math.round(releaseSweepPxForDrop)
    };
    var rec = emit(g, 'drop', evt, lt);
    g.totals.drops++;
    return rec;
  }

  // 碰網未觸發嫌疑: 放開(含視窗外放開)結束、沒有碰網的拖曳, 放開當下屬性已符合亮網全部條件、放開點(視窗外 / 畫面外以氣泡中心)在亮扇區且在內圈外、結果彈回內圈。
  // 依規則這類拖曳應已判成捕捉, 修好後應為 0。a(放開點沿亮邊法線的投影距離)< 268 標「疑似」, 其餘「確定」
  function checkSuspect(g, b, px, py, ptr, lt) {
    var net = g.net;
    if (!net || b.carried || b.dead) return;
    if (!fullyMatchesNet(b, net)) return;
    if (dist(px, py, CX, CY) <= INNER_R) return;
    if (sectorOf(px, py) !== net.slot) return;
    var s = slotByNo(net.slot);
    var a = (px - CX) * s.nx + (py - CY) * s.ny;
    var sure = !(a < 268);
    var gnow = gtAt(g, lt);
    var rec = emit(g, 'netMissSuspect', {
      bubbleId: b.id, kind: sure ? '確定' : '疑似', netSeq: net.seq, slotId: s.id, netCondition: { color: net.cond.color, shape: net.cond.shape },
      color: b.color, shape: b.shape, releaseX: Math.round(px), releaseY: Math.round(py), releaseSector: '槽' + sectorOf(px, py),
      pointerDistFromCenter: r1(dist(ptr.x, ptr.y, CX, CY)), projectionA: r1(a), bubbleDistFromCenter: r1(dist(b.x, b.y, CX, CY)),
      pointerToBubble: r1(dist(ptr.x, ptr.y, b.x, b.y)),
      minBandDistance: b.minBandDist == null ? null : r1(b.minBandDist), maxDepthPastLitLine: r1(b.maxLitDepth), frameMsAtClosest: b.minBandFrameMs,
      pathLength: Math.round(b.dragPathLen), dragDurationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      releaseGT: gnow, nextTouchMs: null, nextTouchResult: null, fate: null
    }, lt);
    b.suspect = true; b.suspectRecs.push(rec);
    g.totals.suspects++; if (sure) g.totals.suspectsSure++;
    g.levelStats[g.lvl].suspects++;
    var sbt = batchOf(g, b); if (sbt) sbt.rec.suspects++;
    if (g.lastDragEndRec) g.lastDragEndRec.isSuspect = true;
  }

  // 拖曳中放開(尚未碰網)
  function resolveRelease(g, b, ev, lt) {
    if (ev.outWin) { forceBounce(g, b, '視窗外放開', lt); return; }
    var px = ev.x, py = ev.y, usedCenter = false;
    if (ev.outCanvas) { px = b.x; py = b.y; usedCenter = true; }
    var isCarried = !!b.carried;
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, '放開', lt);
    var onUi = !usedCenter && isOnUiRegion(px, py);
    var dc = dist(px, py, CX, CY);
    var category, outcome, sectorSlotId = null, sectorIsLit = null, putBack = false;
    var pointerSource = usedCenter ? '氣泡中心' : '指標';
    if (dc <= INNER_R) {
      category = '內圈內';
      if (isCarried) outcome = '帶過的那一顆清掉';
      else {
        outcome = '留在內圈';
        g.totals.stayInner++;
        b.mode = 'idle'; b.x = px; b.y = py; clampToCircle(b);
        if (b.color != null || b.shape !== 'circle') { putBack = true; b.putBack = true; g.totals.putBack++; }
      }
    } else {
      category = '內圈外';
      var sec = sectorOf(px, py);
      sectorSlotId = '槽' + sec; sectorIsLit = !!(g.net && g.net.slot === sec);
      if (isCarried) outcome = '帶過的那一顆清掉';
      else { outcome = '彈回內圈'; g.totals.bounceOuter++; checkSuspect(g, b, px, py, { x: ev.x, y: ev.y }, lt); }
    }
    if (outcome === '彈回內圈') startReturn(g, b, px, py);
    if (!isCarried) setJumpHandFate(g, b, outcome === '彈回內圈' ? '彈回' : (putBack ? '放回內圈' : '留在內圈'));
    emitDrop(g, b, lt, { category: category, sectorSlotId: sectorSlotId, sectorIsLit: sectorIsLit, outcome: outcome, px: px, py: py, onUi: onUi, pointerSource: pointerSource, putBack: putBack });
    if (isCarried) clearCarried(g, b, category === '內圈內' ? '放開清掉(內圈內)' : '放開清掉', lt);
  }

  // 系統事件強制結果(視窗外放開 / 失焦): 一律「內圈外」彈回, 走獨立路徑, 不看座標
  function forceBounce(g, b, reason, lt) {
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, reason, lt);
    var px = b.x, py = b.y;
    if (!b.carried) g.totals.bounceOuter++;
    if (reason === '視窗外放開') checkSuspect(g, b, px, py, { x: mouse.x, y: mouse.y }, lt);   // 失焦不在嫌疑定義內
    emitDrop(g, b, lt, { category: reason === '失焦' ? '失焦' : '視窗外', outcome: b.carried ? '帶過的那一顆清掉' : '彈回內圈', px: px, py: py, onUi: false, pointerSource: '系統事件' });
    if (b.carried) clearCarried(g, b, '視窗外或失焦清掉', lt);
    else startReturn(g, b, px, py);
    mouse.press = null;
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

  var MODE_NAME = { idle: '閒置', hold: '被按住', drag: '拖曳中', 'return': '彈回中' };
  // 空按: 遊戲中(非暫停)左鍵在可按氣泡以外、按鈕以外的地方按下(含按在彈回中的氣泡上); 不凍結任何氣泡、不算按下
  function handleEmptyPress(g, ev, lt) {
    var nearest = null, nd = Infinity;
    for (var i = 0; i < g.bubbles.length; i++) {
      var d = dist(ev.x, ev.y, g.bubbles[i].x, g.bubbles[i].y);
      if (d < nd) { nd = d; nearest = g.bubbles[i]; }
    }
    var bp = beatPos(g, lt);
    g.totals.emptyPresses++;
    var rec = emit(g, 'emptyPress', {
      x: Math.round(ev.x), y: Math.round(ev.y), nearestBubbleId: nearest ? nearest.id : null, nearestDist: nearest ? r1(nd) : null,
      beatPhase: bp.phase, toNextBeatMs: bp.toNextMs, nearestBeatDiffMs: bp.nearestDiffMs,
      nearestState: nearest ? MODE_NAME[nearest.mode] : null, nearestRemainingLifeMs: nearest ? Math.round(nearest.life * 1000) : null,
      repressSameWithin1sMs: null, countOnField: fieldCount(g)
    }, lt);
    g.pendingEmpty.push({ rec: rec, bubbleId: nearest ? nearest.id : null, gt: gtAt(g, lt) });
  }

  function handleDown(g, ev, lt) {
    if (mouse.press) return;
    var target = g.phase === 'playing' ? findBubbleUnder(g, ev.x, ev.y) : null;
    if (!target) { handleEmptyPress(g, ev, lt); return; }
    target.mode = 'hold';
    var gnow = gtAt(g, lt);
    var interval = g.lastDragEndGT == null ? null : Math.round((gnow - g.lastDragEndGT) * 1000);
    g.totals.presses++;
    var net = g.net;
    // 空按回填: 1 秒內重按到同一顆
    g.pendingEmpty = g.pendingEmpty.filter(function (pe) {
      var dtS = gnow - pe.gt;
      if (dtS > PARAMS.emptyPressRepressSec) return false;
      if (pe.bubbleId === target.id && pe.rec.repressSameWithin1sMs == null) { pe.rec.repressSameWithin1sMs = Math.round(dtS * 1000); return false; }
      return true;
    });
    var pbp = beatPos(g, lt);
    emit(g, 'press', Object.assign({
      bubbleId: target.id, x: Math.round(ev.x), y: Math.round(ev.y), remainingLifeMs: Math.round(target.life * 1000), color: target.color, shape: target.shape,
      distToBubbleCenter: r1(dist(ev.x, ev.y, target.x, target.y)), beatPhase: pbp.phase, toNextBeatMs: pbp.toNextMs, nearestBeatDiffMs: pbp.nearestDiffMs,
      intervalSinceLastDragEndMs: interval, pathLenSinceLastDragEnd: g.lastDragEndGT == null ? null : Math.round(mouse.pathSinceDrop),
      processableAtLastDragEnd: g.lastDropProcessable,
      timeSinceNetAppearedMs: net ? Math.round((gnow - net.appearGT) * 1000) : null
    }, netFields(g)), lt);
    if (g.netAppearRec && !g.netFirstPressDone) {
      g.netAppearRec.approachedBeforeFirstPress = g.netApproached;
      g.netAppearRec.firstPressDelayMs = net ? Math.round((gnow - net.appearGT) * 1000) : null;
      g.netFirstPressDone = true;
    }
    if (g.lastDragEndRec && g.lastDragEndRec.intervalToNextPressMs == null) { g.lastDragEndRec.intervalToNextPressMs = interval; g.lastDragEndRec.pathToNextPress = Math.round(mouse.pathSinceDrop); }
    if (g.lastCaptureRec && g.lastCaptureRec.pathToNextPress == null) g.lastCaptureRec.pathToNextPress = Math.round(mouse.pathSinceDrop);
    if (target.firstPressGT == null) target.firstPressGT = gnow;
    target.pressGT = gnow; target.pressLT = lt;
    target.spawnAge = PARAMS.spawnFxSec;
    var wv = g.wave;
    if (wv.cur && wv.cur.rec.firstPressDelayMs == null && target.batchSeq === wv.cur.rec.batchSeq) wv.cur.rec.firstPressDelayMs = Math.round((gnow - wv.cur.rec.startGTs) * 1000);
    g.lastPressGT = gnow;
    mouse.pathSinceDrop = 0;
    target.downInfo = { intervalSinceLastDragEndMs: interval, fieldAtPress: fieldCount(g), waveStateAtPress: waveStateName(g), msAtDragStart: null };
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
      b.dragPathLen = 0; b.lockedSameThis = 0; b.lockedDiffThis = 0; b.touchedDarkThisDrag = 0; b.jumpDuringDrag = false; b.darkSince = {};
      b.netSeqAtGrab = g.net ? g.net.seq : null;
      b.dragLastSwipePathLen = null; b.dragLastSwipeGT = null; b.pathHistory = [];
      b.lastEnterLitLT = null; b.lastExitInnerLT = null;
      b.minBandNetSeq = null; b.minBandDist = null; b.minBandFrameMs = null; b.maxLitDepth = 0;
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
      b.touchFlag = false;   // 抓起時一律從「沒貼著亮邊」起算(只有換位當下不符才會設成 true, 等離開再碰回); 若第一筆移動就已越過亮邊, 下一筆移動立即判碰網
      var colorMatch = net ? (b.color === net.cond.color) : null;
      var shapeMatch = net ? (net.cond.shape == null ? '不比對' : (b.shape === net.cond.shape)) : null;
      var neededDist = function (attr) {
        if (!net) return null;
        if (attr === 'color') {
          if (b.color === net.cond.color) return '不需要';
          if (b.color != null) return '無法符合';
          return r1(neededFloorDistance(g, b, 'color', net));
        }
        if (net.cond.shape == null) return null;
        if (b.shape === net.cond.shape) return '不需要';
        if (b.shape !== 'circle') return '無法符合';
        return r1(neededFloorDistance(g, b, 'shape', net));
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
        satisfiedCountAtGrab: alreadyMatchCount(g), putBackBefore: b.putBack
      }, netFields(g)), lt);
      return;
    }
    var c2 = clampDrag(ev.x, ev.y);
    var prev = { x: b.x, y: b.y };
    b.dragPathLen += dist(prev.x, prev.y, c2.x, c2.y);
    b.x = c2.x; b.y = c2.y;
    var lt0 = b.lastMoveLT == null ? lt : b.lastMoveLT;
    if (lt < lt0) lt = lt0;
    var pathAfter = b.dragPathLen;
    processDragSegment(g, b, prev, c2, lt0, lt);
    if (!b.dead && mouse.press && mouse.press.bubble === b && mouse.press.dragging) {
      b.dragPathLen = pathAfter;
      b.lastMoveLT = lt;
    }
  }

  function releaseHoldNoDrag(g, b, endKind, lt) {
    b.mode = 'idle';
    g.totals.holdNoDrag++;
    var gnow = gtAt(g, lt);
    emit(g, 'holdNoDrag', { bubbleId: b.id, freezeDurationMs: Math.round((gnow - (b.pressGT == null ? gnow : b.pressGT)) * 1000), endReason: endKind }, lt);
  }

  // 放開事件自帶的指標位置, 可能比最後一筆被處理的移動更遠(瀏覽器每幀只合併送一筆移動, 放開又是即時送出)。
  // 拖曳中放開時, 先把「氣泡最後處理位置 → 放開位置」這一段當成一次移動掃過(擦過 / 碰網照路徑判),
  // 否則一記快速甩過亮邊的放開會整段漏判, 氣泡明明已越過亮邊卻被當成「放在內圈外」彈回。
  // 視窗外放開走獨立的強制路徑(不看座標), 不掃。
  function sweepToReleasePos(g, press, ev, lt) {
    if (!press || !press.dragging || ev.outWin) return 0;
    var b = press.bubble;
    if (!b || b.dead) return 0;
    var endPos = clampDrag(ev.x, ev.y);
    var gap = dist(b.x, b.y, endPos.x, endPos.y);
    if (gap <= 0.5) return 0;
    releaseSweeping = true;
    try { handleMove(g, { k: 'move', x: ev.x, y: ev.y, ts: ev.ts }, lt); } finally { releaseSweeping = false; }
    return gap;
  }

  function handleUp(g, ev, lt) {
    var press = mouse.press;
    var sweptPx = sweepToReleasePos(g, press, ev, lt);
    if (g.pendingTouchRec) {
      var ptr = g.pendingTouchRec; g.pendingTouchRec = null;
      ptr.rec.releaseAfterMs = Math.max(0, Math.round((gtAt(g, lt) - ptr.gt) * 1000));
    }
    if (!press) return;
    if (mouse.press !== press) return;          // 放開前的最後一段路徑上已碰網 / 沾錯消失, 拖曳已結束, 放開不產生事件
    mouse.press = null;
    var b = press.bubble;
    if (!b || b.dead) return;
    if (!press.dragging) { releaseHoldNoDrag(g, b, '放開', lt); return; }
    if (b.lastMoveLT != null && lt < b.lastMoveLT) lt = b.lastMoveLT;
    releaseSweepPxForDrop = sweptPx;
    resolveRelease(g, b, ev, lt);
    releaseSweepPxForDrop = 0;
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
  // 「已相交」: 段切換 / 輪轉那一刻, 拖曳中的氣泡以這幀結束時的位置判; 相交者不算擦過, 要先離開再擦回
  // ==================================================================
  function dragEndPosThisFrame(b) {
    var pos = { x: b.x, y: b.y };
    for (var qi = 0; qi < inputQueue.length; qi++) if (inputQueue[qi].k === 'move') pos = clampDrag(inputQueue[qi].x, inputQueue[qi].y);
    return pos;
  }
  function markAlreadyIntersect(g, isChanged) {
    var dragB = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
    var out = { bubble: dragB, ids: [] };
    if (!dragB) return out;
    var endPos = dragEndPosThisFrame(dragB);
    floorList(g, true).forEach(function (z) {
      if (!isChanged(z)) return;
      var overlap = dist(endPos.x, endPos.y, z.x, z.y) <= BUBBLE_R + z.r;
      dragB.floorOverlap[z.id] = overlap;
      if (overlap) out.ids.push(z.id);
    });
    return out;
  }

  // ==================================================================
  // 段切換(同一關前段 → 後段; 預告開始記錄)
  // ==================================================================
  function segmentSwitch(g) {
    g.curBack = true;
    var L2 = LEVELS[g.lvl];
    var info = segInfo(g.lvl, true);
    var newFloors = [], shrink = null;
    FLOORS.forEach(function (f) {
      if (f.appear[g.lvl - 1] === 'back') newFloors.push({ id: f.id, kind: f.kind === 'dye' ? '染色' : '賦形', angle: floorAngle(f, g.lvl, g.beatIdx) });
    });
    if (g.lvl === 3) shrink = { from: PARAMS.floorR, to: PARAMS.floorRSmall };
    // 保底: 第 1 關後段 → 色 D; 第 2 關後段 → 三角; 第 3 關後段沒有
    var discarded = null, kept = null;
    var hadPending = g.pendingGuarantee;
    if (g.lvl === 1) g.pendingGuarantee = { kind: 'color', value: 'D' };
    else if (g.lvl === 2) g.pendingGuarantee = { kind: 'shape', value: 'triangle' };
    if (g.lvl !== 3) discarded = hadPending ? { kind: hadPending.kind, value: hadPending.value } : null;
    else kept = hadPending ? { kind: hadPending.kind, value: hadPending.value } : null;
    var ai = markAlreadyIntersect(g, function (z) { return !!shrink || newFloors.some(function (nf) { return nf.id === z.id; }); });
    emit(g, 'stageChange', Object.assign({
      previewStartMs: g.previewStartGT == null ? null : Math.round(g.previewStartGT * 1000), effectiveMs: gtMs(g), newFloors: newFloors, shrink: shrink, sameBeatRotate: g.lvl === 3,
      conditionPoolSize: info.colors.length * (info.shapes.length + 1), shapeProb: info.shapeProb, newBatchN: info.N,
      drainRate: g.lvl === 3 ? { base: PARAMS.drain.l3base, perSec: PARAMS.drain.l3perSec } : L2.drain[1],
      unlockedForms: FORM_ORDER.filter(function (k) { return FORMATIONS[k].unlockSeg === info.idx; }).map(function (k) { return FORMATIONS[k].name; }),
      litCondition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null,
      bubblesAtEffective: g.bubbles.map(function (b2) { return { id: b2.id, color: b2.color, shape: b2.shape }; }),
      anyHeldOrDragging: !!mouse.press, draggingBubbleId: ai.bubble ? ai.bubble.id : null, alreadyIntersectingFloors: ai.ids,
      discardedGuarantee: discarded, keptGuarantee: g.lvl === 3 ? kept : g.pendingGuarantee,
      waveState: waveStateName(g), hpAtEffective: r1(g.hp)
    }, netFields(g)));
    g.stageChanges.push({ level: g.lvl, effectiveGT: g.gt, previewGT: g.previewStartGT, seg: info.key });
  }

  // ==================================================================
  // 第 3 關地板輪轉 / 第 2 關光門跳位 / 自動換位(拍點觸發)
  // ==================================================================
  function startRotatePreview(g, k) {
    var hand = handInfoNow(g);
    g.rotatePreviewRec = { startGT: g.gt, startLT: g.lt, effBeat: k, hand: hand };
    var db = hand.state === '拖曳中' ? mouse.press.bubble : null;
    g.rotatePreviewRec.dragAtStart = db ? { bubbleId: db.id, colorLocked: db.color != null, shapeLocked: db.shape !== 'circle', needFloorIds: hand.needFloorIds } : null;
  }
  function doRotate(g, k) {
    g.rotateSeq++;
    g.lastRotateBeat = k;
    var pv = g.rotatePreviewRec;
    var handNow = handInfoNow(g);      // beatIdx 已進到 k, 地板已在新位置: 這裡的距離 = 轉後
    var featHand = Object.assign({}, handNow, { needDistBefore: pv && pv.hand ? pv.hand.needDist : null, needDistAfter: handNow.needDist });
    if (g.net) { g.net.rotations++; noteNetFeature(g, g.net, featHand); }
    var angles = {}, radii = {};
    FLOORS.forEach(function (f) { var st = floorState(g, f); if (st.exists) { angles[f.id] = floorAngle(f, g.lvl, g.beatIdx); radii[f.id] = st.r; } });
    var ai = markAlreadyIntersect(g, function () { return true; });
    var db = ai.bubble;
    var rec = emit(g, 'rotate', {
      rotateSeq: g.rotateSeq, previewStartMs: pv ? Math.round(pv.startGT * 1000) : null, effectiveMs: gtMs(g), effectiveBeat: k, previewBeats: PARAMS.rotatePreviewBeats,
      anglesAfter: angles, radiiAfter: radii, sameBeatAsShrink: k === PARAMS.segSwitchBeat,
      dragAtPreviewStart: pv ? pv.dragAtStart : null,
      draggingAtEffective: db ? { bubbleId: db.id, colorLocked: db.color != null, shapeLocked: db.shape !== 'circle', needFloorIds: handNow.needFloorIds } : null,
      handAtPreviewStart: pv ? pv.hand : null, handAtEffective: handNow,
      alreadyIntersect: ai.ids, swipesWithin1Beat: [], missRadiiWithin1Beat: [], netSeq: g.net ? g.net.seq : null, netCondition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null
    });
    g.rotatePreviewRec = null;
    g.lastRotateRec = rec;
    g.totals.rotations++;
    snd('floorRotate');
  }
  function startJumpPreview(g, k) {
    if (!g.net) return;
    var cands = slotCandidates(g.net.slot);
    g.net.jumpTo = pickRandom(cands);
    var db = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
    g.jumpPreviewRec = { startGT: g.gt, startLT: g.lt, from: g.net.slot, to: g.net.jumpTo, captureDuringPreview: false, handAtStart: db ? '拖曳中' : (mouse.press ? '按住' : '無') };
  }
  function doJump(g, k) {
    var net = g.net;
    if (!net || net.jumpTo == null) {
      var pv0 = g.jumpPreviewRec;
      if (pv0 && pv0.captureDuringPreview) {
        g.jumpSeq++;
        emit(g, 'jump', { jumpSeq: g.jumpSeq, previewStartMs: Math.round(pv0.startGT * 1000), jumpMs: gtMs(g), jumpBeat: k, previewBeats: PARAMS.jumpPreviewBeats, oldSlotId: slotByNo(pv0.from).id, newSlotId: slotByNo(pv0.to).id, slotDiff: slotDiff(pv0.from, pv0.to), conditionChanged: false, usedByPreviewCapture: true, hand: null, swapJudge: null, handFate: null, oldEdgeTouches: 0 });
      }
      // 預告中捕捉讓這次不跳: 卡住中的話, 下一次跳位順延 2 小節(最長約 9 拍)
      if (g.stuck && g.stuck.nextJumpBeat != null && g.stuck.nextJumpBeat <= k) { g.stuck.nextJumpBeat = k + PARAMS.jumpEveryBeats; g.stuck.skippedJumps = (g.stuck.skippedJumps || 0) + 1; }
      g.jumpPreviewRec = null; return;
    }
    var tK = k * g.bs;
    var to = net.jumpTo, from = net.slot;
    var stuckNow = fieldCount(g) >= 1 && fullSatisfiableCount(g) === 0;
    g.jumpSeq++;
    g.lastJumpBeat = k;
    var pv = g.jumpPreviewRec;
    var db = mouse.press ? mouse.press.bubble : null;
    if (db && db.dead) db = null;
    var handInfo = db ? {
      state: (mouse.press && mouse.press.dragging) ? '拖曳中' : '按住', bubbleId: db.id, color: db.color, shape: db.shape, matched: fullyMatchesNet(db, net),
      distToOldEdge: r1(distToBand(db.x, db.y, from)), distToNewEdge: r1(distToBand(db.x, db.y, to)),
      angleToNewEdgeDeg: r1(angleDelta(angleOf(db.x, db.y), slotByNo(to).angle))
    } : { state: '無' };
    var rec = emit(g, 'jump', {
      jumpSeq: g.jumpSeq, previewStartMs: pv ? Math.round(pv.startGT * 1000) : null, jumpMs: gtMs(g), jumpBeat: k, previewBeats: PARAMS.jumpPreviewBeats,
      oldSlotId: slotByNo(from).id, newSlotId: slotByNo(to).id, slotDiff: slotDiff(from, to), conditionChanged: stuckNow, newCondition: null,
      usedByPreviewCapture: false, hand: handInfo, swapJudge: null, handFate: null, oldEdgeTouches: 0, touchAfterJumpMs: null, netInFieldMs: Math.round((g.gt - net.appearGT) * 1000)
    });
    g.jumpPreviewRec = null;
    g.jumpWatch = { oldSlot: from, rec: rec };
    g.lastSwapJudgeInfo = rec;
    g.jumpHandRec = (handInfo.state === '拖曳中') ? { rec: rec, bubble: db } : null;
    if (stuckNow) {
      // 卡住時跳位: 位置用預告中的目標槽位, 條件換成「自動換位」抽法的新條件; 算新的一張網(不是保底張)
      closeNetRec(net, '跳位換條件');
      lightNet(g, 'jumpcond', { slot: to });
      rec.newCondition = { color: g.net.cond.color, shape: g.net.cond.shape };
      g.totals.jumpCondCount++;
      var jc = g.net.cond;
      closeStuck(g, '第2關跳位換條件', { newSlotId: slotByNo(g.net.slot).id, newCondition: { color: jc.color, shape: jc.shape }, satisfiableByNewCond: g.bubbles.filter(function (b) { return compatibleWithCond(b, jc); }).length, candidateConditionCount: g.netAppearRec.candidateConditionCount, autoCondNote: g.netAppearRec.autoCondNote });
    } else {
      net.slot = to; net.jumpTo = null; net.jumpsOnly++;
      noteNetFeature(g, net, handInfo);
      g.netFrom = from; g.netHintT = 0;
      g.totals.jumpOnlyCount++;
      g.stuckHint = '第2關只換位置的跳位後';
      snd('netSwap', { x: slotByNo(to).x });
    }
    g.jumpWatch = { oldSlot: from, rec: rec };
    judgeAfterSwap(g, tK);
  }
  function autoSwapNow(g, k) {
    var tK = k * g.bs;
    if (!(fieldCount(g) >= 1 && fullSatisfiableCount(g) === 0)) { closeStuck(g, '卡住已解除'); return; }
    closeNetRec(g.net, '自動換位');
    lightNet(g, 'autoswap');
    g.autoSwapCount++;
    var bt = g.wave.cur; if (bt) bt.rec.autoSwaps++;
    var newCond = g.net.cond;
    var sat = g.bubbles.filter(function (b) { return compatibleWithCond(b, newCond); }).length;
    closeStuck(g, '自動換位', { newSlotId: slotByNo(g.net.slot).id, newCondition: { color: newCond.color, shape: newCond.shape }, satisfiableByNewCond: sat, candidateConditionCount: g.netAppearRec.candidateConditionCount, autoCondNote: g.netAppearRec.autoCondNote });
    g.lastSwapJudgeInfo = null;
    judgeAfterSwap(g, tK);
  }

  // 拍點觸發(第 1 步): 段切換 → 第 3 關輪轉 → 第 2 關跳位 → 第 1、3 關自動換位
  function onBeatTick(g, k) {
    var pb = PARAMS.segSwitchBeat;
    if (!g.previewLogged && k >= pb - PARAMS.previewBeats) {
      g.previewLogged = true;
      g.previewStartGT = g.gt - (g.lt - (pb - PARAMS.previewBeats) * g.bs);
    }
    if (!g.curBack && k >= pb) segmentSwitch(g);
    if (g.lvl === 3) {
      // 輪轉: 第 8、16、24、… 拍, 循環不設上限; 預告 = 輪轉前 2 拍
      var kr = k + PARAMS.rotatePreviewBeats;
      if (kr % PARAMS.rotateEveryBeats === 0 && kr >= PARAMS.rotateEveryBeats) startRotatePreview(g, kr);
      if (k >= PARAMS.rotateEveryBeats && k % PARAMS.rotateEveryBeats === 0) doRotate(g, k);
    } else if (g.lvl === 2) {
      // 跳位: 第 8、16、…、152 拍(第 160 拍關末不跳, 第 159 拍不預告); 預告 = 跳位前 1 拍
      var kj = k + PARAMS.jumpPreviewBeats;
      if (kj % PARAMS.jumpEveryBeats === 0 && kj >= PARAMS.jumpEveryBeats && kj <= PARAMS.jumpLastBeat) startJumpPreview(g, kj);
      if (k >= PARAMS.jumpEveryBeats && k % PARAMS.jumpEveryBeats === 0 && k <= PARAMS.jumpLastBeat) doJump(g, k);
    }
    if (g.lvl !== 2 && !g.endFrame && g.stuck && g.stuck.scheduledBeat != null && k >= g.stuck.scheduledBeat) autoSwapNow(g, k);
  }

  // ==================================================================
  // 卡住與自動換位
  // ==================================================================
  function stuckBubbleList(g) {
    return g.bubbles.map(function (b) { return { id: b.id, color: b.color, shape: b.shape, mode: b.mode }; });
  }
  function updateStuck(g) {
    if (g.phase !== 'playing' || !g.net) return;
    var cnt = fieldCount(g);
    var stuckNow = cnt >= 1 && fullSatisfiableCount(g) === 0;
    if (stuckNow && !g.stuck) {
      var bs = g.bs, beat = g.lt / bs;
      g.stuckSeq++;
      // 第 1、3 關: 嚴格晚於卡住成立那一刻的第 2 個拍點自動換位; 第 2 關沒有獨立的自動換位, 等下一次跳位(第 152 拍之後不再跳, 只能等換關)
      var sched = g.lvl !== 2 ? Math.floor(beat + 1e-9) + PARAMS.autoSwapBeatPoint : (Math.floor(beat / PARAMS.jumpEveryBeats + 1e-9) + 1) * PARAMS.jumpEveryBeats;
      g.stuck = {
        seq: g.stuckSeq, batchSeq: g.batchSeq, startGT: g.gt, startLT: g.lt, cause: g.stuckHint, countAtStart: cnt, bubbles: stuckBubbleList(g),
        netSeq: g.net.seq, condition: { color: g.net.cond.color, shape: g.net.cond.shape }, scheduledBeat: g.lvl !== 2 ? sched : null, nextJumpBeat: g.lvl === 2 ? sched : null,
        startedAfterLastJump: g.lvl === 2 ? beat >= PARAMS.jumpLastBeat : null,
        waveStates: [], expiredDuring: false
      };
      g.levelStats[g.lvl].stuckSegs++;
      var bt = g.wave.cur; if (bt) bt.rec.stuckSegs++;
    } else if (!stuckNow && g.stuck) {
      closeStuck(g, cnt === 0 ? '場上清空' : '新氣泡冒出');
    }
    if (g.stuck) {
      var ws = waveStateName(g);
      if (g.stuck.waveStates.indexOf(ws) === -1) g.stuck.waveStates.push(ws);
      if (g.frame.expired) g.stuck.expiredDuring = true;
    }
  }
  function closeStuck(g, reason, extra) {
    var s = g.stuck;
    if (!s) return;
    var lengthSec = g.gt - s.startGT;
    var rec = emit(g, 'stuck', Object.assign({
      stuckSeq: s.seq, batchSeq: s.batchSeq, startMs: Math.round(s.startGT * 1000), cause: s.cause, countAtStart: s.countAtStart, bubbles: s.bubbles,
      netSeq: s.netSeq, condition: s.condition, scheduledBeat: s.scheduledBeat, nextJumpBeat: s.nextJumpBeat, skippedJumps: s.skippedJumps || 0, startedAfterLastJump: s.startedAfterLastJump,
      endMs: gtMs(g), lengthSec: r3(lengthSec), waitedBeats: r3(lengthSec / g.bs), endReason: reason, waveStates: s.waveStates, expiredDuring: s.expiredDuring,
      firstCaptureAfterMs: null
    }, extra || {}));
    rec.swapGT = g.gt;
    if (reason === '自動換位' || reason === '第2關跳位換條件') g.pendingSwapRec = rec;
    g.stuck = null;
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
      newMusic: LEVELS[newLvl].music, newBpm: LEVELS[newLvl].bpm, newFeature: LEVELS[newLvl].feature, endGTms: gtMs(g), endSurvMs: survMs(g), endRealMs: Date.now() - g.startWall,
      hpBefore: r1(g.hp), score: g.score, combo: g.combo, danger: g.danger, waveStateAtEnd: waveStateName(g), stuckAtEnd: !!g.stuck,
      clearedCount: 0, clearedSatisfiable: { 可滿足: 0, 不能滿足: 0 }, clearedHoldNoDrag: 0, clearedRemainLife: [], processableAtEnd: processableCount(g),
      cancelledBatch: w.cur && w.cur.rec.nextBatchCancelled ? { had: true, originalBeat: w.cur.rec.cancelledOriginalBeat } : { had: !!(w.nextStartBeat != null), originalBeat: w.nextStartBeat },
      discardedGuarantee: g.pendingGuarantee ? { kind: g.pendingGuarantee.kind, value: g.pendingGuarantee.value } : null,
      hadCarry: false, carryMatchedOldNet: null, carryResult: null, carryResultMs: null,
      countInStartMs: Math.round((g.gt - overshoot) * 1000), countInEndMs: null, newFirstNet: null,
      idleBeforeEndBeats: null, batchFromStartToEndBeats: null
    };
    // 換關乾等: 從本批清完或關末停批開始(取較晚者)到關末的拍數; 關末當下場上仍有氣泡記 0
    if (fieldCount(g) > 0) lr.idleBeforeEndBeats = 0;
    else {
      var cand = [];
      if (w.lastLeaveLT != null && w.cur) cand.push(w.lastLeaveLT);
      if (w.cancelled && LEVELS[oldLvl].endBeat != null) cand.push((LEVELS[oldLvl].endBeat - PARAMS.lastNoBatchBeats) * oldBs);
      lr.idleBeforeEndBeats = cand.length ? r3(Math.max(0, (g.lt - Math.max.apply(null, cand)) / oldBs)) : null;
    }
    if (w.cur) lr.batchFromStartToEndBeats = r3((g.lt - w.cur.startBeat * oldBs) / oldBs);
    g.levelRecs.push(lr);
    g.events.push(lr);
    // 1. 場上氣泡清掉, 只有拖曳中那一顆例外
    var carried = (mouse.press && mouse.press.dragging) ? mouse.press.bubble : null;
    g.bubbles.slice().forEach(function (b) {
      if (b === carried) return;
      if (b.mode === 'hold') {
        if (mouse.press && mouse.press.bubble === b) { releaseHoldNoDrag(g, b, '換關', g.lt); mouse.press = null; lr.clearedHoldNoDrag++; }
        b.mode = 'idle';
      }
      lr.clearedCount++;
      if (compatibleWithNet(b, g.net)) lr.clearedSatisfiable['可滿足']++; else lr.clearedSatisfiable['不能滿足']++;
      lr.clearedRemainLife.push(r3(b.life));
      var bt = batchOf(g, b);
      if (bt) bt.rec.levelClearedCount++;
      finalizeBubble(g, b, 'levelCleared');
      removeBubble(g, b);
      g.totals.levelCleared++;
    });
    g.stickFxs = g.stickFxs.filter(function (f) { return f.bubble === carried; });
    g.beatFxs = g.beatFxs.filter(function (f) { return !f.bubble || f.bubble === carried; });
    g.missFxs = []; g.batchCues = [];
    // 2. 波次重置、卡住與預告結束
    closeStuck(g, '換關');
    if (w.cur) flushBatch(g, w.cur, '換關');
    g.wave = newWave();
    g.rotatePreviewRec = null; g.jumpPreviewRec = null; g.jumpWatch = null; g.jumpHandRec = null;
    // 3. 網與保底、同條件連續計數
    g.levelStats[oldLvl].exitHp = g.hp; g.levelStats[oldLvl].exitSurv = g.surv;
    if (g.curSegKey && g.segHp[g.curSegKey]) g.segHp[g.curSegKey].exitHp = g.hp;
    g.curSegKey = null;
    g.recent = []; g.netLevelSeq = 0;
    g.pendingGuarantee = (newLvl === 2) ? { kind: 'shape', value: 'square' } : { kind: 'shape', value: pickRandom(['square', 'triangle']) };
    if (carried) {
      carried.carried = true;
      lr.hadCarry = true;
      lr.carryMatchedOldNet = fullyMatchesNet(carried, g.net);
      g.carry = { bubble: carried, oldLevel: oldLvl };
      if (g.net) g.net.jumpTo = null;
    } else { if (g.net) closeNetRec(g.net, '換關'); g.net = null; g.carry = null; }
    // 4. 換成新關
    var oldLtNow = g.lt;
    g.lvl = newLvl; g.bs = LEVELS[newLvl].beatSec; g.phase = 'countIn';
    g.lt = -PARAMS.countInBeats * g.bs + overshoot;
    var ltShift = g.lt - oldLtNow;
    g.beatIdx = Math.floor(g.lt / g.bs + 1e-9);
    g.curBack = false; g.previewLogged = false; g.previewStartGT = null; g.holdStartGT = null;
    g.introT = overshoot; g.countInLen = PARAMS.countInBeats * g.bs;
    g.lastCountInBeat = -PARAMS.countInBeats;
    g.lastRotateBeat = null; g.lastRotateRec = null; g.lastJumpBeat = null;
    if (carried) {
      // 帶過去的物件身上快取的關內時間改成新軸(關內時間軸在換關時重置)
      carried.lastMoveLT = g.lt;
      ['lastNodeLT', 'lastCountedNodeLT', 'lastEnterLitLT', 'lastExitInnerLT', 'pressLT'].forEach(function (k) { if (carried[k] != null) carried[k] += ltShift; });
      if (carried.darkSince) Object.keys(carried.darkSince).forEach(function (k) { if (carried.darkSince[k] != null) carried.darkSince[k] += ltShift; });
    }
    g.netHintT = 99; g.netFrom = null;
    g.maxLevel = newLvl;
    g.levelEnterSurv[newLvl] = g.surv;
    enterLevelStats(g, newLvl);
    var prevMax = parseInt(lsGet(MAXLEVEL_KEY), 10) || 1;
    if (newLvl > prevMax) { lsSet(MAXLEVEL_KEY, String(newLvl)); lsSet(FIRST_REACH_KEY + newLvl, String(g.gameIndex)); }
    // 5. 音樂與提示音(順序: 換關 → 新歌 → 預備拍第 −4 拍)
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
    g.beatIdx = 0;
    var lr = levelRecOpen(g);
    if (lr && lr.toLevel === g.lvl) lr.countInEndMs = gtMs(g);
    g.wave.phase = 'out';
    startBatch(g, 0);
    var net = lightNet(g, 'first');
    if (lr && lr.toLevel === g.lvl) lr.newFirstNet = { slot: net.slot, condition: { color: net.cond.color, shape: net.cond.shape } };
  }

  // ==================================================================
  // 每秒取樣
  // ==================================================================
  function emitSample(g) {
    g.hpCurve.push({ t: gtMs(g), surv: survMs(g), hp: r1(g.hp) });
    var driftMs = g.lastDrift == null ? null : Math.round(g.lastDrift * 1000);
    if (driftMs != null) g.musicDrift[g.lvl].push(driftMs);
    var net = g.net;
    emit(g, 'sample', {
      countOnField: fieldCount(g), hp: r1(g.hp), danger: g.danger, secDrain: r3(g.secDrain), secHeal: { catch: r3(g.secHeal.catch), beat: r3(g.secHeal.beat), chain: r3(g.secHeal.chain) },
      secMiss: r3(g.secMiss), secExpire: r3(g.secExpire), secOverflow: r3(g.secOverflow), secNet: r3(g.secHeal.catch + g.secHeal.beat + g.secHeal.chain - g.secDrain - g.secMiss - g.secExpire), secFull: g.secFull,
      waveState: waveStateName(g), isGapWait: g.wave.phase === 'gap', isStuck: !!g.stuck, inRotateCue: inRotateCue(g), inJumpCue: inJumpCue(g), batchSeq: g.batchSeq,
      anyHoldOrDrag: !!mouse.press, processableCount: processableCount(g),
      satisfiableCount: g.net ? satisfiableCount(g) : null, fullSatisfiableCount: g.net ? fullSatisfiableCount(g) : null,
      litNetSeq: net ? net.seq : null, litSlot: net ? net.slot : null, satisfiedCount: net ? alreadyMatchCount(g) : null,
      musicDriftMs: driftMs, muted: muted
    });
    g.secDrain = 0; g.secHeal = { catch: 0, beat: 0, chain: 0 }; g.secMiss = 0; g.secExpire = 0; g.secOverflow = 0; g.secFull = false;
  }

  function updateFx(g, dt) {
    g.hpFx = g.hpFx.filter(function (f) { f.t += dt; return f.t < Art.timing.hpFx; });
    g.stickFxs = g.stickFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.stickFx && !f.bubble.dead; });
    g.beatFxs = g.beatFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.beatFx; });
    g.chainFxs = g.chainFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.chainFx; });
    g.missFxs = g.missFxs.filter(function (f) { f.t += dt; return f.t < Art.timing.missFx; });
    g.batchCues = g.batchCues.filter(function (f) { f.t += dt; return f.t < Art.timing.batchCue; });
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
    g.frame = { rotated: false, expired: false, overflow: false, expireCount: 0, expiredBatchSeqs: [], misses: [] };
    g.endFrame = false;
    g.lastDtMs = Math.round(dt * 1000);
    if (g.pendingEmpty.length) g.pendingEmpty = g.pendingEmpty.filter(function (pe) { return g.gt - pe.gt <= PARAMS.emptyPressRepressSec; });
    updateFx(g, dt);
    var dtPlay = dt, skipInputs = false;

    // ---------- 預備拍 ----------
    if (g.phase === 'countIn') {
      var beat0 = g.lt / g.bs;
      var fb = Math.floor(beat0 + 1e-9);
      g.beatIdx = fb;
      if (fb >= -PARAMS.countInBeats && fb <= -1 && fb !== g.lastCountInBeat) {
        g.lastCountInBeat = fb;
        snd('countIn', { left: -fb });
      }
      g.introT = (g.introT || 0) + dt;
      processInputs(g, ltPrev, rafTs);
      syncMusicNow(g);
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
    g.surv += dtPlay;
    syncMusicNow(g);
    var endBeat = LEVELS[g.lvl].endBeat;
    var endT = endBeat != null ? endBeat * g.bs : Infinity;
    g.endFrame = g.lt >= endT - 1e-9;
    var segKey = segKeyNow(g);
    g.segSec[segKey] = (g.segSec[segKey] || 0) + dtPlay;
    if (g.curSegKey !== segKey) {
      if (g.curSegKey && g.segHp[g.curSegKey]) g.segHp[g.curSegKey].exitHp = g.hp;
      g.segHp[segKey] = { enterHp: g.hp, exitHp: null, enterSurv: g.surv };
      g.curSegKey = segKey;
    }
    if (w.phase === 'out' || w.phase === 'proc') {
      var bk = g.surv < 60 ? 0 : 1;
      g.noWorkAvail[bk] += dtPlay;
      if (!mouse.press && satisfiableCount(g) === 0) g.noWorkSec[bk] += dtPlay;
    }
    if (g.waveSec[w.phase] != null) g.waveSec[w.phase] += dtPlay;
    if (g.hp <= PARAMS.hpDangerEnter) { g.lowHpSec += dtPlay; g.levelStats[g.lvl].lowSec += dtPlay; }

    // 1. 拍點觸發的變化: 段切換 → 第 3 關輪轉 → 第 2 關跳位 → 第 1、3 關自動換位
    if (!skipInputs) {
      var newIdx = Math.floor(g.lt / g.bs + 1e-9);
      var guardB = 0;
      while (g.beatIdx < newIdx && guardB++ < 4) { g.beatIdx++; onBeatTick(g, g.beatIdx); }
      g.beatIdx = Math.max(g.beatIdx, newIdx);
    }
    // 2~3. 本幀輸入(擦過 / 碰網 / 放開 / 捕捉 / 輪替 / 回血)
    if (!skipInputs) processInputs(g, ltPrev, rafTs);

    // 4. 血量: 回血已在輸入處理中完成 → 持續扣血 → 沾錯消失 → 過期
    updatePhysics(g, dtPlay);
    for (var fi = 0; fi < g.bubbles.length; fi++) {
      var fb2 = g.bubbles[fi];
      if (fb2.mode === 'hold' || fb2.mode === 'drag') fb2.freezeSecTotal += dtPlay;
      if (fb2.spawnAge < PARAMS.spawnFxSec) fb2.spawnAge += dtPlay;
    }
    var backNow = !!g.curBack;
    var rate = drainRate(g.lvl, backNow, g.lt);
    var hpB = g.hp;
    g.hp = Math.max(0, g.hp - rate * dtPlay);
    var drained = hpB - g.hp;
    g.drainTotal += drained; g.secDrain += drained; g.levelStats[g.lvl].drain += drained;
    var drainKilled = hpB > 0 && g.hp <= 0;
    updateDanger(g);
    var missKilled = false;
    for (var mi = 0; mi < g.frame.misses.length; mi++) {
      var hpM = g.hp;
      applyMissLoss(g, g.frame.misses[mi]);
      if (hpM > 0 && g.hp <= 0) missKilled = true;
    }
    var hpBeforeExpiry = g.hp;
    var list = g.bubbles.slice();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.dead) continue;
      if (b.mode === 'hold' || b.mode === 'drag') continue;
      b.life -= dtPlay;
      if (b.life <= 0) expireBubble(g, b);
    }
    var expireKilled = hpBeforeExpiry > 0 && g.hp <= 0;
    finalizePendingRelPass(g);
    var fullNow = g.hp >= 99.9 || g.frame.overflow;
    if (g.wasFull && !fullNow) { g.lastFullToNot = { surv: g.surv, key: segKey, lvSec: g.lvl === 3 ? g.lt : null, field: fieldCount(g) }; }
    if (fullNow) { g.everFull = true; if (g.firstFullSurv == null) g.firstFullSurv = g.surv; g.fullSecBySeg[segKey] = (g.fullSecBySeg[segKey] || 0) + dtPlay; g.secFull = true; }
    if (!fullNow) g.levelStats[g.lvl].nonFullSec += dtPlay;       // 非滿血秒數(各關「非滿血期間每秒收入」用)
    g.wasFull = fullNow;
    g.maxConcurrent = Math.max(g.maxConcurrent, fieldCount(g));
    if (g.hp <= 0) {
      g.hp = 0;
      if (drainKilled) g.pendingDeathReasons = ['持續扣血'];
      else if (missKilled) g.pendingDeathReasons = ['沾錯消失'];
      else if (expireKilled) { g.pendingDeathReasons = ['過期']; g.deathBatchSeqs = g.frame.expiredBatchSeqs.slice(); }
      else g.pendingDeathReasons = ['持續扣血'];
      g.sampleAcc += dtPlay;
      endGame('hpZero');
      return;
    }

    // 5. 波次: 判本批是否清完(清完則排定下一批), 本幀到時的出批 / 冒出照常執行
    if (!g.endFrame) checkBatchCleared(g);
    advanceWave(g, endT);
    // 6. 卡住判定(關末那幀跳過)
    if (!g.endFrame) updateStuck(g);
    // 總量核對: 同一時刻場上屬於 2 批以上(換關帶過的那一顆除外, 應為 0)
    (function () { var seq = null; for (var mi2 = 0; mi2 < g.bubbles.length; mi2++) { var mb = g.bubbles[mi2]; if (mb.carried) continue; if (seq == null) seq = mb.batchSeq; else if (mb.batchSeq !== seq) { g.multiBatchFrames++; return; } } })();

    g.sampleAcc += dtPlay;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleIntervalSec && guard < 10) { g.sampleAcc -= PARAMS.sampleIntervalSec; emitSample(g); guard++; }

    // 7. 換關
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
  function histogram10ms(arr) {
    var h = {};
    arr.forEach(function (v) { var k = Math.floor(v / 10) * 10; h[k] = (h[k] || 0) + 1; });
    return h;
  }
  var SEGS = ['1f', '1b', '2f', '2b', '3f', '3b'];

  function computeSummary(g, endReason) {
    var E = g.events;
    var spawns = byType(E, 'spawn'), caps = byType(E, 'capture'), expires = byType(E, 'expire'), drops = byType(E, 'drop');
    var swipes = byType(E, 'swipe'), nodes = byType(E, 'node'), nets = byType(E, 'netAppear'), samples = byType(E, 'sample');
    var presses = byType(E, 'press'), waves = byType(E, 'wave'), stuckEv = byType(E, 'stuck'), grabs = byType(E, 'grab');
    var levelSw = byType(E, 'levelSwitch'), stageCh = byType(E, 'stageChange'), relPasses = byType(E, 'relPass');
    var touches = byType(E, 'netTouch'), misses = byType(E, 'missVanish'), rotates = byType(E, 'rotate'), jumps = byType(E, 'jump');
    var fieldEnds = byType(E, 'fieldEnd'), heals = byType(E, 'heal');
    var survEnd = g.surv;
    var survMsEnd = survEnd * 1000;
    var capsReal = caps.filter(function (c) { return !c.isCarried; });
    var effSwipes = swipes.filter(function (s) { return s.classification === '生效'; });
    var lockedSwipes = swipes.filter(function (s) { return s.classification === '已鎖定'; });
    var missSwipes = swipes.filter(function (s) { return s.classification === '沾錯消失'; });

    // ----- 總量核對 -----
    var spawnedN = spawns.length;
    var accounted = g.totals.captured + g.totals.expired + (g.totals.missColor + g.totals.missShape) + (g.totals.levelCleared) + fieldEnds.length;
    var wavesFinished = waves.filter(function (w) { return w.endedBy === '下一批出現'; });
    var totalsCheck = {
      spawned: spawnedN, captured: g.totals.captured, expired: g.totals.expired, missVanish: g.totals.missColor + g.totals.missShape, levelCleared: g.totals.levelCleared,
      residualAtEnd: fieldEnds.length, spawnedEqualsOutcomes: spawnedN === accounted,
      bounceCond: g.totals.bounceCond, bounceOuter: g.totals.bounceOuter, holdNoDrag: g.totals.holdNoDrag,
      swipeEffective: g.totals.swipeEffective, swipeMiss: missSwipes.length, swipeLocked: g.totals.swipeLocked, putBack: g.totals.putBack,
      netAppears: g.totals.netAppears, batches: g.totals.batches, stuckSegments: stuckEv.length, autoSwaps: g.autoSwapCount, rotations: rotates.length, jumps: jumps.length,
      touches: g.totals.touches, nodesCounted: g.totals.nodeCounted, nodesUncounted: g.totals.nodeUncounted, heals: g.totals.heals, levelSwitches: g.totals.levelSwitches,
      spawnedVsBatchN: (function () {
        var done = wavesFinished.filter(function (w) { return w.spawnOffsetMs.length === w.n; });
        return done.length === wavesFinished.length ? 1 : null;
      })(),
      batchesOnFieldTwoOrMore: g.multiBatchFrames,
      emptyPresses: g.totals.emptyPresses, netMissSuspects: g.totals.suspects, netMissSuspectsSure: g.totals.suspectsSure
    };

    // ----- 各關段 -----
    var segStats = SEGS.map(function (k) {
      var inS = function (e) { return evSeg(e) === k; };
      var capS = caps.filter(inS), expS = expires.filter(inS), dropS = drops.filter(inS), swS = swipes.filter(inS);
      var effS = swS.filter(function (s) { return s.classification === '生效'; });
      var lockS = swS.filter(function (s) { return s.classification === '已鎖定'; });
      var dwell = g.segSec[k] || 0;
      var touchS = touches.filter(inS);
      return {
        seg: k, dwellSec: r3(dwell), batchCount: waves.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k; }).length,
        spawnCount: spawns.filter(inS).length, captureCount: capS.length, expireCount: expS.length,
        missVanishCount: misses.filter(inS).length,
        bounceCondCount: touchS.filter(function (d) { return d.result === '條件不符彈回'; }).length,
        outerBounceCount: dropS.filter(function (d) { return d.outcome === '彈回內圈'; }).length, dropTotalCount: dropS.length,
        stayInnerCount: dropS.filter(function (d) { return d.outcome === '留在內圈'; }).length,
        putBackCount: dropS.filter(function (d) { return d.putBackIn; }).length,
        avgProcessingMs: avgOf(capS.map(function (d) { return d.processingMs; }).filter(function (v) { return v != null; })),
        avgPathLength: avgOf(capS.map(function (d) { return d.pathLength; })),
        effectiveSwipeCount: effS.length,
        lockedSameCount: lockS.filter(function (s) { return s.lockedSameAsExisting === true; }).length,
        lockedDiffCount: lockS.filter(function (s) { return s.lockedSameAsExisting === false; }).length,
        stuckSegCount: stuckEv.filter(inS).length,
        autoSwapCount: stuckEv.filter(function (s) { return inS(s) && s.endReason === '自動換位'; }).length,
        capturePerMinute: dwell > 0 ? capS.length / (dwell / 60) : null,
        fullHpShare: dwell > 0 ? (g.fullSecBySeg[k] || 0) / dwell : null
      };
    });
    // 沾錯率: 顏色 / 形狀分開 = 沾錯 ÷(生效擦過 + 沾錯)
    function missRate(filterFn, attr) {
      var isColor = function (s) { return s.floorKind === '染色'; };
      var attrFn = attr === 'color' ? isColor : function (s) { return !isColor(s); };
      var eff = effSwipes.filter(function (s) { return filterFn(s) && attrFn(s); }).length;
      var ms = missSwipes.filter(function (s) { return filterFn(s) && attrFn(s); }).length;
      return { eff: eff, miss: ms, rate: ratio(ms, eff + ms) };
    }
    var missBy = {
      overall: { color: missRate(function () { return true; }, 'color'), shape: missRate(function () { return true; }, 'shape') },
      bySeg: SEGS.map(function (k) { return { seg: k, color: missRate(function (s) { return evSeg(s) === k; }, 'color'), shape: missRate(function (s) { return evSeg(s) === k; }, 'shape') }; })
    };
    var missCost = misses.map(function (m) {
      var rate = drainRate(m.level, m.seg === '後段', 0);
      return PARAMS.hpMissLoss + (m.pressToVanishMs || 0) / 1000 * (m.level === 3 ? PARAMS.drain.l3base : rate);
    });
    var missInfo = {
      byLevel: [1, 2, 3].map(function (l) { var ms = misses.filter(function (m) { return m.level === l; }); return { level: l, n: ms.length, withinOneBeatAfterRotate: ms.filter(function (m) { return m.withinOneBeatAfterRotate; }).length, inRotateCue: ms.filter(function (m) { return m.inRotateCue; }).length, medianPressToVanishMs: median(ms.map(function (m) { return m.pressToVanishMs; }).filter(function (v) { return v != null; })), medianDistToNeeded: median(ms.map(function (m) { return m.distToNeededFloor; }).filter(function (v) { return v != null; })) }; }),
      realCostAvg: avgOf(missCost), realCostMedian: median(missCost)
    };

    // ----- 網在場時間(指標 1) -----
    var netCapMs = {};
    caps.forEach(function (c) { if (!c.isCarried && c.netSeq != null) netCapMs[c.netSeq] = c.netInFieldMs; });
    function netMsList(filterFn) { return nets.filter(filterFn).map(function (n) { return netCapMs[n.netSeq]; }).filter(function (v) { return v != null; }); }
    var qualNets = function (n) { return n.satisfiableCountAtAppear >= 1 && !(n.reasonDetail === '自動換位'); };
    var allQualMs = netMsList(qualNets);
    var oneMs = netMsList(function (n) { return qualNets(n) && n.conditionItemCount === 1; });
    var twoMs = netMsList(function (n) { return qualNets(n) && n.conditionItemCount === 2; });
    var netBySlotDiff = {};
    [2, 3, 4].forEach(function (d) { netBySlotDiff[d] = netMsList(function (n) { return qualNets(n) && n.slotDiff === d; }); });
    var netBySeg = {};
    SEGS.forEach(function (k) { netBySeg[k] = netMsList(function (n) { return qualNets(n) && evSeg(n) === k && n.conditionItemCount === 1; }); });
    var indicator1 = {
      oneCondMedianMs: median(oneMs), twoCondMedianMs: median(twoMs), p90OverMedian: (median(allQualMs) > 0 ? p90(allQualMs) / median(allQualMs) : null),
      risePct1fTo2b: (median(netBySeg['1f']) > 0 && median(netBySeg['2b']) != null) ? (median(netBySeg['2b']) / median(netBySeg['1f']) - 1) : null,
      slotDiff4MedianMs: median(netBySlotDiff[4]), slotDiff2MedianMs: median(netBySlotDiff[2]),
      bySegOneCond: SEGS.map(function (k) { return { seg: k, n: netBySeg[k].length, medianMs: median(netBySeg[k]), p90Ms: p90(netBySeg[k]) }; }),
      byLevelCond: [1, 2, 3].map(function (l) {
        var one = netMsList(function (n) { return n.level === l && qualNets(n) && n.conditionItemCount === 1; });
        var two = netMsList(function (n) { return n.level === l && qualNets(n) && n.conditionItemCount === 2; });
        return { level: l, oneN: one.length, oneMedianMs: median(one), oneP90Ms: p90(one), twoN: two.length, twoMedianMs: median(two), twoP90Ms: p90(two) };
      })
    };

    // ----- 指標 2 / 3 / 4 / 5 -----
    var indicator2 = {
      noWorkShare0to60: ratio(g.noWorkSec[0], g.noWorkAvail[0] + 0) , noWorkSec: [r3(g.noWorkSec[0]), r3(g.noWorkSec[1])], baseSec: [r3(g.noWorkAvail[0]), r3(g.noWorkAvail[1])],
      note: '分母為出批中 + 處理中的時間(已扣除批間等待與關末停批); 0~60 秒與之後分開',
      shareOfSurvival: [ratio(g.noWorkSec[0], Math.min(60, survEnd)), ratio(g.noWorkSec[1], Math.max(0, survEnd - 60))],
      waveSec: { out: r3(g.waveSec.out), proc: r3(g.waveSec.proc), gap: r3(g.waveSec.gap), endHold: r3(g.waveSec.endHold) }
    };
    var longestGap = { sec: 0, from: 0, to: 0 };
    (function () {
      var ts = g.captureSurvTimes.slice().sort(function (a, b) { return a - b; });
      var prev = 0, limit = survEnd - 30;
      ts.concat([survEnd]).forEach(function (t, idx) {
        var isFinal = idx === ts.length;
        if (t <= limit || (isFinal && limit > prev)) {
          var endAt = isFinal ? Math.min(t, limit) : t;
          if (endAt - prev > longestGap.sec) longestGap = { sec: endAt - prev, from: prev, to: endAt };
        }
        prev = t;
      });
    })();
    var bounceCondAll = touches.filter(function (t) { return t.result === '條件不符彈回'; });
    var indicator4 = {
      bounceCondRate: ratio(bounceCondAll.length, capsReal.length + bounceCondAll.length),
      outerBounceRate: ratio(g.totals.bounceOuter, drops.length + touches.length),
      byLevel: [1, 2, 3].map(function (l) {
        var cs = capsReal.filter(function (c) { return c.level === l; }).length, bc = bounceCondAll.filter(function (d) { return d.level === l; }).length;
        return { level: l, bounceCondRate: ratio(bc, cs + bc) };
      })
    };
    if (g.dangerOpenSince != null) { g.dangerSecTotal += survEnd - g.dangerOpenSince; g.dangerOpenSince = null; }
    var lastLow = g.lowEntries[g.lowEntries.length - 1];
    if (lastLow && lastLow.durationSec == null) lastLow.durationSec = survEnd - lastLow.startSurv;
    var indicator5 = {
      lowHpShare: ratio(g.lowHpSec, survEnd), lowHpSec: r3(g.lowHpSec), firstLowSurvSec: g.firstLowSurv == null ? null : r3(g.firstLowSurv), firstLowAtShareOfRun: (g.firstLowSurv != null && survEnd > 0) ? g.firstLowSurv / survEnd : null,
      firstLowSeg: g.firstLowKey, lowEntries: g.lowEntries.map(function (e) { return { enterSurvMs: e.enterSurvMs, durationSec: r3(e.durationSec), seg: e.seg, batchSeq: e.batchSeq }; }),
      lastFullToDeath: (function () {
        if (endReason !== 'hpZero') return null;
        if (!g.everFull) return '未滿血';
        if (g.wasFull) return { note: '死亡當下仍為滿血', sec: 0 };
        var lf = g.lastFullToNot;
        return lf ? { sec: r3(survEnd - lf.surv), seg: lf.key, lvSec: lf.lvSec == null ? null : r3(lf.lvSec), field: lf.field } : '未滿血';
      })(),
      firstFullSurvSec: g.firstFullSurv == null ? null : r3(g.firstFullSurv)
    };

    // ----- 踩拍讀數 -----
    var beatBase = {};
    [1, 2, 3].forEach(function (l) {
      var bms = LEVELS[l].beatSec * 1000;
      beatBase[l] = { deliver: 2 * PARAMS.beatWindowDeliverMs / bms, stick: 2 * PARAMS.beatWindowStickBeats };
    });
    var NODE_TYPES = ['第一次沾上', '第二次沾上', '送進網'];
    var beatStats = [];
    [1, 2, 3].forEach(function (l) {
      NODE_TYPES.forEach(function (nt) {
        var cs = g.chainStats.byNode[nt + '|L' + l];
        var dk = g.nodeDiffs[nt + '|L' + l];
        if (!cs && !dk) return;
        var raw = dk ? dk.raw : [], adj = dk ? dk.adj : [], rb = dk ? dk.rawBeats : [];
        var swapSet = dk ? dk.swapJudged : [];
        var adjNoSwap = adj.filter(function (v, i) { return swapSet.indexOf(i) === -1; });
        var rate = cs ? ratio(cs.onBeat, cs.counted) : null;
        var base = nt === '送進網' ? beatBase[l].deliver : beatBase[l].stick;
        var onNoSwap = nt === '送進網' ? adjNoSwap.filter(function (v) { return Math.abs(v) <= PARAMS.beatWindowDeliverMs; }).length : null;
        var ratNoSwap = nt === '送進網' ? ratio(onNoSwap, adjNoSwap.length) : null;
        var useRate = nt === '送進網' && ratNoSwap != null ? ratNoSwap : rate;
        beatStats.push({
          level: l, nodeType: nt, counted: cs ? cs.counted : 0, onBeat: cs ? cs.onBeat : 0, onBeatRate: rate, onBeatRateExcludingSwapJudged: ratNoSwap,
          randomBaseline: r3(base), normalizedRate: useRate == null ? null : r3((useRate - base) / (1 - base)),
          rawDiffMedianMs: median(raw), rawDiffIqrMs: iqr(raw), adjDiffMedianMs: median(adj), adjDiffIqrMs: iqr(adj),
          adjDiffMedianBeats: median(rb), iqrBeatsCircular: circularIqrBeats(rb),
          hypotheticalRateIfCompZeroedToMedian: (nt === '送進網' && raw.length) ? (function () { var m = median(raw); return ratio(raw.filter(function (v) { return Math.abs(v - m) <= PARAMS.beatWindowDeliverMs; }).length, raw.length); })() : null,
          histogram10ms: histogram10ms(raw)
        });
      });
    });
    // 踩拍分類: 本局送進網計次節點的踩拍率(換位當下即判的送進網不計): < 50% 不踩拍型 / 50~75% 半數型 / >= 75% 大部分型; 新手 = 不踩拍型、熟手 = 半數型與大部分型
    var deliverRateAll = (function () {
      var c = 0, o = 0;
      [1, 2, 3].forEach(function (l) {
        var dk = g.nodeDiffs['送進網|L' + l];
        if (!dk) return;
        dk.adj.forEach(function (v, i) { if (dk.swapJudged.indexOf(i) !== -1) return; c++; if (Math.abs(v) <= PARAMS.beatWindowDeliverMs) o++; });
      });
      return ratio(o, c);
    })();
    var beatClass = deliverRateAll == null ? null : (deliverRateAll < 0.5 ? '不踩拍型' : (deliverRateAll < 0.75 ? '半數型' : '大部分型'));
    var skillClass = beatClass == null ? null : (beatClass === '不踩拍型' ? '新手' : '熟手');
    var tierCounts = g.chainStats.tiers, interruptCounts = g.chainStats.interrupts;
    var capMaxTier = { level: {} };
    [1, 2, 3].forEach(function (l) {
      var cl = capsReal.filter(function (c) { return c.level === l; });
      capMaxTier.level[l] = {
        captures: cl.length, twoNodeCaps: cl.filter(function (c) { return c.countedNodes === 2; }).length, threeNodeCaps: cl.filter(function (c) { return c.countedNodes === 3; }).length,
        reachedTier2: cl.filter(function (c) { return c.countedNodes === 2 && c.maxTier >= 2; }).length, reachedTier3: cl.filter(function (c) { return c.countedNodes === 3 && c.maxTier >= 3; }).length,
        chainCount: cl.filter(function (c) { return c.isChain; }).length, avgHealApplied: avgOf(cl.map(function (c) { return c.totalHealApplied; })), avgHealDue: avgOf(cl.map(function (c) { return c.totalHealDue; }))
      };
    });
    var netTimeByBeatCount = (function () {
      var o = {};
      capsReal.forEach(function (c) { var k = (c.onBeatNodes || 0) + '|' + (c.conditionCount === 2 ? '兩項' : '一項'); (o[k] = o[k] || []).push(c.netInFieldMs); });
      var res = {}; Object.keys(o).forEach(function (k) { res[k] = { n: o[k].length, medianMs: median(o[k]) }; });
      return res;
    })();

    // ----- 血量收支 -----
    var hpFlow = {
      healGross: g.healGross, overflowBy: g.overflowBy, overflowByLevel: g.overflowByLevel, healGrossByLevel: g.healGrossByLevel,
      overflowShareByLevel: [1, 2, 3].map(function (l) { return { level: l, share: ratio(g.overflowByLevel[l], g.healGrossByLevel[l]) }; }),
      drainTotal: r3(g.drainTotal), missLossTotal: r3(g.missLossTotal), expireLossTotal: r3(g.expireLossTotal), overflowPtsTotal: g.overflowPtsTotal, captureScoreTotal: g.captureScoreTotal,
      scoreEqualsParts: g.score === g.captureScoreTotal + g.overflowPtsTotal
    };
    var segFlow = SEGS.map(function (k) {
      var sh = g.segHp[k], dw = g.segSec[k] || 0;
      if (!sh) return { seg: k, dwellSec: 0 };
      var exitHp = sh.exitHp == null ? g.hp : sh.exitHp;
      return { seg: k, dwellSec: r3(dw), enterHp: r1(sh.enterHp), exitHp: r1(exitHp), netPerSec: dw > 0 ? r3((exitHp - sh.enterHp) / dw) : null };
    });

    // ----- 批 -----
    var wavesAll = waves;
    var gapBeats = wavesAll.map(function (w) { return w.actualGapBeats; }).filter(function (v) { return v != null; });
    var gapSecs = wavesAll.map(function (w) { return w.actualGapSec; }).filter(function (v) { return v != null; });
    var waveByLevel = [1, 2, 3].map(function (l) {
      var ws = wavesAll.filter(function (w) { return w.level === l; });
      var gb = ws.map(function (w) { return w.actualGapBeats; }).filter(function (v) { return v != null; });
      var gs = ws.map(function (w) { return w.actualGapSec; }).filter(function (v) { return v != null; });
      var fp = ws.map(function (w) { return w.firstPressDelayMs; }).filter(function (v) { return v != null; });
      var bd = ws.map(function (w) { return w.batchDurSec; }).filter(function (v) { return v != null; });
      var empties = (avgOf(gs) || 0) + (avgOf(fp) || 0) / 1000;
      return {
        level: l, batches: ws.length, avgGapBeats: avgOf(gb), avgGapSec: avgOf(gs), medianFirstPressMs: median(fp), medianBatchDurSec: median(bd),
        gapShareOfSurvival: l && g.levelStats[l] ? ratio(sumOf(gs) + sumOf(fp) / 1000, ((g.levelStats[l].exitSurv == null ? survEnd : g.levelStats[l].exitSurv) - g.levelStats[l].enterSurv)) : null,
        avgEmptyPerBatchSec: r3(empties), withTail: ws.filter(function (w) { return w.expired > 0; }).length
      };
    });
    var gapOutOfRange = wavesAll.filter(function (w) { return w.actualGapBeats != null && (w.actualGapBeats <= 1 + 1e-6 || w.actualGapBeats > 2 + 1e-6); }).length;
    var zeroExpireBySeg = SEGS.map(function (k) {
      var ws = wavesAll.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k && w.endedBy === '下一批出現' || ((w.level + (w.seg === '前段' ? 'f' : 'b')) === k && w.clearMs != null); });
      return { seg: k, batches: ws.length, zeroExpire: ws.filter(function (w) { return w.expired === 0; }).length, rate: ratio(ws.filter(function (w) { return w.expired === 0; }).length, ws.length) };
    });
    function twoShareClass(w) {
      var cap = w.captured; if (!cap) return '0';
      var s = w.twoCondCaptured / cap;
      return s === 0 ? '0' : (s < 0.5 ? '0~50%' : '>=50%');
    }
    var perItemBySeg = SEGS.map(function (k) {
      var ws = wavesAll.filter(function (w) { return (w.level + (w.seg === '前段' ? 'f' : 'b')) === k && w.perItemSec != null; });
      var res = { seg: k, n: ws.length, medianSec: median(ws.map(function (w) { return w.perItemSec; })), p90Sec: p90(ws.map(function (w) { return w.perItemSec; })), byTwoShare: {} };
      ['0', '0~50%', '>=50%'].forEach(function (c) { var xs = ws.filter(function (w) { return twoShareClass(w) === c; }).map(function (w) { return w.perItemSec; }); res.byTwoShare[c] = { n: xs.length, medianSec: median(xs), p90Sec: p90(xs) }; });
      return res;
    });
    var l2bItems = wavesAll.filter(function (w) { return w.level === 2 && w.seg === '後段' && w.perItemSec != null; });
    var l2bMedian = median(l2bItems.map(function (w) { return w.perItemSec; }));
    var playerClass = l2bMedian == null ? '未分類' : (l2bMedian >= 1.98 ? '新手' : (l2bMedian <= 1.88 ? '熟手' : '中間'));   // 輔助分類(處理時間)
    var waveInfo = {
      gapBeatsAll: { avg: avgOf(gapBeats), min: minOf(gapBeats), max: maxOf(gapBeats), outOfRangeCount: gapOutOfRange }, avgGapSec: avgOf(gapSecs), byLevel: waveByLevel,
      zeroExpireBySeg: zeroExpireBySeg, perItemBySeg: perItemBySeg, level2BackBatchPerItem: l2bItems.map(function (w) { return { batchSeq: w.batchSeq, perItemSec: r3(w.perItemSec), twoCondNets: w.twoCondNets }; }),
      tailCountsByBatch: wavesAll.map(function (w) { return { batchSeq: w.batchSeq, level: w.level, seg: w.seg, expired: w.expired, netHp: w.netHp, batchDurSec: r3(w.batchDurSec) }; }),
      spawnOffsetMsMaxAbs: maxOf(wavesAll.reduce(function (a, w) { return a.concat(w.spawnOffsetMs.map(Math.abs)); }, [])),
      placement: wavesAll.reduce(function (a, w) { a.formationPoint += w.placement.formationPoint; a.backup += w.placement.backup; a.forced += w.placement.forced; return a; }, { formationPoint: 0, backup: 0, forced: 0 }),
      cancelledNextBatch: wavesAll.filter(function (w) { return w.nextBatchCancelled; }).length
    };

    // ----- 卡住與自動換位 -----
    var stuckLens = stuckEv.map(function (s) { return s.lengthSec; });
    var stuckInfo = {
      count: stuckEv.length, medianSec: median(stuckLens), maxSec: maxOf(stuckLens), shareOfSurvival: ratio(sumOf(stuckLens), survEnd),
      byCause: countBy(stuckEv, function (s) { return s.cause; }), byEndReason: countBy(stuckEv, function (s) { return s.endReason; }),
      autoSwapCount: g.autoSwapCount, jumpCondCount: g.totals.jumpCondCount,
      newCondSatisfiableAtLeastOne: (function () { var sw = stuckEv.filter(function (s) { return s.satisfiableByNewCond != null; }); return { n: sw.length, ok: sw.filter(function (s) { return s.satisfiableByNewCond >= 1; }).length }; })(),
      firstCaptureAfterSwapMedianMs: median(stuckEv.map(function (s) { return s.firstCaptureAfterMs; }).filter(function (v) { return v != null; })),
      level2: stuckEv.filter(function (s) { return s.level === 2; }).map(function (s) { return { lengthSec: s.lengthSec, waitedBeats: s.waitedBeats, drainHpDuring: r3(s.lengthSec * drainRate(2, s.seg === '後段', 0)), expiredDuring: s.expiredDuring, endReason: s.endReason, startedAfterLastJump: s.startedAfterLastJump }; })
    };
    // ----- 第 3 關輪轉 / 第 2 關跳位 -----
    var rotateInfo = {
      count: rotates.length,
      hadUnlockedDragAtEffective: rotates.filter(function (r) { return r.draggingAtEffective && (!r.draggingAtEffective.colorLocked || !r.draggingAtEffective.shapeLocked); }).length,
      handNeedAtPreview: rotates.filter(function (r) { return r.handAtPreviewStart && r.handAtPreviewStart.hasUnstainedNeeded; }).length,
      alreadyIntersectCount: rotates.filter(function (r) { return r.alreadyIntersect && r.alreadyIntersect.length; }).length,
      missWithinOneBeat: misses.filter(function (m) { return m.level === 3 && m.withinOneBeatAfterRotate; }).length, missLevel3: misses.filter(function (m) { return m.level === 3; }).length,
      missWithinOneBeatByRadius: countBy(rotates.reduce(function (a, r) { return a.concat(r.missRadiiWithin1Beat || []); }, []), function (x) { return x; }),
      swipesWithin1Beat: rotates.reduce(function (a, r) { (r.swipesWithin1Beat || []).forEach(function (c) { a[c] = (a[c] || 0) + 1; }); return a; }, {}),
      netsHitByRotate: nets.filter(function (n) { return n.level === 3 && n.featureCount > 0; }).length, netsLevel3: nets.filter(function (n) { return n.level === 3; }).length
    };
    var l2caps = capsReal.filter(function (c) { return c.level === 2; });
    var l2deliver = (g.chainStats.byNode['送進網|L2'] || { counted: 0 }).counted;
    var swapJudgedL2 = touches.filter(function (t) { return t.level === 2 && t.method === '換位當下即判' && t.result === '捕捉'; }).length;
    var jumpInfo = {
      count: jumps.length, onlyPosition: jumps.filter(function (j) { return j.conditionChanged === false && !j.usedByPreviewCapture; }).length, withCondChange: jumps.filter(function (j) { return j.conditionChanged; }).length,
      usedByPreviewCapture: jumps.filter(function (j) { return j.usedByPreviewCapture; }).length,
      handDragging: jumps.filter(function (j) { return j.hand && j.hand.state === '拖曳中'; }).length,
      oldEdgeTouches: sumOf(jumps.map(function (j) { return j.oldEdgeTouches || 0; })),
      swapJudgedAllLevels: g.totals.swapJudged, swapJudgedLevel2: swapJudgedL2, swapJudgedShareOfLevel2Captures: ratio(swapJudgedL2, l2caps.length), swapJudgedShareOfLevel2Deliveries: ratio(swapJudgedL2, l2deliver),
      swapJudgedShareOfJumps: ratio(swapJudgedL2, jumps.length), swapNoJudge: g.totals.swapNoJudge,
      fallbackTriggered: ratio(swapJudgedL2, l2deliver) != null && ratio(swapJudgedL2, l2deliver) > 0.25,
      onlyPositionCausedStuck: stuckEv.filter(function (s) { return s.cause === '第2關只換位置的跳位後' && s.level === 2; }).length,
      netsHitByJump: nets.filter(function (n) { return n.level === 2 && n.featureCount > 0; }).length, netsLevel2: nets.filter(function (n) { return n.level === 2; }).length
    };
    // ----- 第 3 關每 8 小節 -----
    var level3Blocks = (function () {
      var o = {};
      function key(e) { return Math.floor((e.beatNo == null ? 0 : e.beatNo) / 32); }
      function slot(e) { return o[key(e)] = o[key(e)] || { batches: 0, captures: 0, expires: 0, miss: 0, bounce: 0, fieldSum: 0, fieldN: 0 }; }
      waves.filter(function (w) { return w.level === 3; }).forEach(function (w) { slot({ beatNo: w.startBeat }).batches++; });
      caps.filter(function (e) { return e.level === 3 && !e.isCarried; }).forEach(function (e) { slot(e).captures++; });
      expires.filter(function (e) { return e.level === 3; }).forEach(function (e) { slot(e).expires++; });
      misses.filter(function (e) { return e.level === 3; }).forEach(function (e) { slot(e).miss++; });
      bounceCondAll.filter(function (e) { return e.level === 3; }).forEach(function (e) { slot(e).bounce++; });
      samples.filter(function (e) { return e.level === 3 && e.seg !== '預備拍'; }).forEach(function (e) { var s = slot(e); s.fieldSum += e.countOnField; s.fieldN++; });
      return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (k) { var s = o[k]; return { block8Bars: +k, batches: s.batches, captures: s.captures, expires: s.expires, miss: s.miss, bounceCond: s.bounce, avgField: s.fieldN ? s.fieldSum / s.fieldN : null }; });
    })();

    // ----- 積壓期處理率 -----
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
    var backlogInfo = { global: backlog(realSamples, caps), bySeg: {}, byLevel: {} };
    SEGS.forEach(function (k) { backlogInfo.bySeg[k] = backlog(realSamples.filter(function (s) { return evSeg(s) === k; }), caps.filter(function (c) { return evSeg(c) === k; })); });
    [1, 2, 3].forEach(function (l) { backlogInfo.byLevel[l] = backlog(realSamples.filter(function (s) { return s.level === l; }), caps.filter(function (c) { return c.level === l; })); });

    // ----- 新鮮不變迷失(換關前後 30 秒校正網在場時間) -----
    var freshness = levelSw.map(function (lr) {
      var endSurv = lr.endSurvMs / 1000;
      var winAfter = lr.toLevel === 3 ? PARAMS.segSwitchBeat * LEVELS[3].beatSec : 30;      // 進第 3 關取前段 16 小節的長度(依實際 BPM)
      function corrected(n) {
        var ms = netCapMs[n.netSeq];
        var cost = 0;
        var lvl = n.level;
        if (lvl === 2 && n.jumpOnlyDuring >= 1) cost = PARAMS.structCost.jump * 1000;       // 第 2 關撞上跳位 0.19 秒
        if (lvl === 3 && n.rotationsDuring >= 1) cost = PARAMS.structCost.rotate * 1000;    // 第 3 關撞上輪轉 0.20 秒
        return ms - cost;
      }
      var before = nets.filter(function (n) { return n.level === lr.fromLevel && n.conditionItemCount === 1 && n.satisfiableCountAtAppear >= 1 && netCapMs[n.netSeq] != null && n.surv / 1000 >= endSurv - 30 && n.surv / 1000 <= endSurv && n.reasonDetail !== '自動換位'; });
      var after = nets.filter(function (n) { return n.level === lr.toLevel && n.conditionItemCount === 1 && n.satisfiableCountAtAppear >= 1 && netCapMs[n.netSeq] != null && n.surv / 1000 > endSurv && n.surv / 1000 <= endSurv + winAfter && n.reasonDetail !== '自動換位'; });
      var bRaw = before.map(function (n) { return netCapMs[n.netSeq]; }), aRaw = after.map(function (n) { return netCapMs[n.netSeq]; });
      var bCor = before.map(corrected), aCor = after.map(corrected);
      var mb = median(bCor), ma = median(aCor);
      var allAfter = nets.filter(function (n) { return n.level === lr.toLevel && netCapMs[n.netSeq] != null; }).slice(0, 3);
      return {
        fromLevel: lr.fromLevel, toLevel: lr.toLevel, beforeN: before.length, afterN: after.length, beforeMedianRawMs: median(bRaw), afterMedianRawMs: median(aRaw),
        beforeMedianCorrectedMs: mb, afterMedianCorrectedMs: ma, correctedRisePct: (mb > 0 && ma != null) ? (ma - mb) / mb : null, rawRisePct: (median(bRaw) > 0 && median(aRaw) != null) ? (median(aRaw) - median(bRaw)) / median(bRaw) : null,
        firstThreeAfter: allAfter.map(function (n, idx) { return { netSeq: n.netSeq, levelSeq: n.netLevelSeq, rawMs: netCapMs[n.netSeq], correctedMs: corrected(n), extraOverBeforeMedianMs: mb == null ? null : corrected(n) - mb, twoCond: n.conditionItemCount === 2, guarantee: n.isGuarantee }; })
      };
    });
    var firstThreeNets = [];
    [{ kind: '開局第1關', level: 1, afterMs: 0 }].concat(levelSw.map(function (lr) { return { kind: '換關進入第' + lr.toLevel + '關', level: lr.toLevel, afterMs: lr.countInEndMs }; })).concat(stageCh.map(function (sc) { return { kind: '第' + sc.level + '關後段切換', level: sc.level, afterMs: sc.effectiveMs }; })).forEach(function (m) {
      var after = nets.filter(function (n) { return n.t >= m.afterMs && n.level === m.level; }).slice(0, 3);
      firstThreeNets.push({ marker: m.kind, nets: after.map(function (n) { return { netSeq: n.netSeq, levelSeq: n.netLevelSeq, inFieldMs: netCapMs[n.netSeq] == null ? null : netCapMs[n.netSeq], firstPressDelayMs: n.firstPressDelayMs, twoCond: n.conditionItemCount === 2, guarantee: n.isGuarantee }; }) });
    });

    // ----- 換關、關、死亡 -----
    var levelInfo = [1, 2, 3].filter(function (l) { return g.levelStats[l]; }).map(function (l) {
      var ls = g.levelStats[l];
      var stay = (ls.exitSurv == null ? survEnd : ls.exitSurv) - ls.enterSurv;
      return {
        level: l, staySec: r3(stay), enterHp: r1(ls.enterHp), exitHp: ls.exitHp == null ? r1(g.hp) : r1(ls.exitHp), captures: ls.captures, expires: ls.expires, missVanish: ls.miss, bounceCond: ls.bounceCond,
        batches: ls.batches, stuckSegs: ls.stuckSegs, healBySrc: ls.healBySrc, overflow: r3(ls.overflow), drain: r3(ls.drain), missLoss: r3(ls.missLoss), expireLoss: r3(ls.expireLoss), lowHpSec: r3(ls.lowSec),
        onBeatRates: NODE_TYPES.map(function (nt) { var cs = g.chainStats.byNode[nt + '|L' + l]; return { nodeType: nt, rate: cs ? ratio(cs.onBeat, cs.counted) : null }; }),
        netPerSec: stay > 0 ? r3(((ls.exitHp == null ? g.hp : ls.exitHp) - ls.enterHp) / stay) : null,
        // 每秒淨收支(含溢出) = 本關應得回血(含溢出) − 持續扣血 − 沾錯扣血 − 過期扣血; 非滿血期間每秒收入 = 非滿血期間實得回血 ÷ 非滿血秒數
        netPerSecInclOverflow: stay > 0 ? r3((ls.healBySrc.catch + ls.healBySrc.beat + ls.healBySrc.chain - ls.drain - ls.missLoss - ls.expireLoss) / stay) : null,
        nonFullSec: r3(ls.nonFullSec), nonFullIncomePerSec: ls.nonFullSec > 0 ? r3(ls.nonFullHeal / ls.nonFullSec) : null, netMissSuspects: ls.suspects
      };
    });
    var deathInfo = null;
    if (endReason === 'hpZero') {
      var lastWave = waves.length ? waves[waves.length - 1] : null;
      var batchSeqs = g.deathBatchSeqs.length ? uniqArr(g.deathBatchSeqs) : (lastWave ? [lastWave.batchSeq] : []);
      var dseq = batchSeqs.length ? batchSeqs[0] : null;
      var dw = waves.filter(function (w) { return w.batchSeq === dseq; })[0] || null;
      deathInfo = {
        seg: segKeyNow(g), level: g.lvl, deathBatchSeq: dseq, deathBatchN: dw ? dw.n : null, deathBatchCaptured: dw ? dw.captured : null, deathBatchMissVanish: dw ? dw.missVanish : null,
        prevThreeBatches: waves.filter(function (w) { return dseq != null && w.batchSeq < dseq && w.batchSeq >= dseq - 3; }).map(function (w) { return { batchSeq: w.batchSeq, tail: w.expired, batchDurSec: r3(w.batchDurSec), netHp: w.netHp }; }),
        last30sNetPerSec: samples.filter(function (s) { return s.surv >= survMsEnd - 30000 && s.seg !== '預備拍'; }).map(function (s) { return s.secNet; }),
        last60sBy10s: (function () {
          var res = [];
          for (var q = 0; q < 6; q++) {
            var from = survMsEnd - (q + 1) * 10000, to = survMsEnd - q * 10000;
            res.push({ fromSec: r1(from / 1000), captures: caps.filter(function (c) { return c.surv > from && c.surv <= to; }).length, avgField: avgOf(realSamples.filter(function (s) { return s.surv > from && s.surv <= to; }).map(function (s) { return s.countOnField; })) });
          }
          return res;
        })()
      };
    }
    var buckets30 = (function () {
      var o = {};
      function slot(e) { var k = Math.floor((e.surv || 0) / 30000); return o[k] = o[k] || { spawn: 0, capture: 0, expire: 0, miss: 0, bounceCond: 0, putBack: 0, netInField: [], stuckSec: 0 }; }
      spawns.forEach(function (e) { slot(e).spawn++; });
      caps.forEach(function (e) { var s = slot(e); s.capture++; if (!e.isCarried) s.netInField.push(e.netInFieldMs); });
      expires.forEach(function (e) { slot(e).expire++; });
      misses.forEach(function (e) { slot(e).miss++; });
      bounceCondAll.forEach(function (e) { slot(e).bounceCond++; });
      drops.forEach(function (e) { if (e.putBackIn) slot(e).putBack++; });
      stuckEv.forEach(function (e) { slot(e).stuckSec += e.lengthSec || 0; });
      return Object.keys(o).sort(function (a, b) { return a - b; }).map(function (k) { var s = o[k]; return { fromSec: k * 30, spawn: s.spawn, capture: s.capture, expire: s.expire, missVanish: s.miss, bounceCond: s.bounceCond, putBack: s.putBack, avgNetInFieldMs: avgOf(s.netInField), stuckSec: r3(s.stuckSec) }; });
    })();
    var levelWindows30 = levelSw.concat(stageCh.map(function (sc) { return { type: 'stageChange', endSurvMs: sc.surv, fromLevel: sc.level, toLevel: sc.level }; })).map(function (m) {
      var at = m.endSurvMs;
      function win(from, to) {
        return {
          captures: caps.filter(function (c) { return c.surv > from && c.surv <= to; }).length, expires: expires.filter(function (c) { return c.surv > from && c.surv <= to; }).length,
          miss: misses.filter(function (c) { return c.surv > from && c.surv <= to; }).length, bounceCond: bounceCondAll.filter(function (c) { return c.surv > from && c.surv <= to; }).length,
          avgNetInFieldMs: avgOf(caps.filter(function (c) { return !c.isCarried && c.surv > from && c.surv <= to; }).map(function (c) { return c.netInFieldMs; }))
        };
      }
      return { kind: m.type === 'stageChange' ? '段切換' : '換關', level: m.fromLevel, atSurvMs: at, before30s: win(at - 30000, at), after30s: win(at, at + 30000) };
    });
    // 衝刺: 第 1、2 關關末前 15 秒每顆處理時間 ÷ 同關後段平均
    var sprint = levelSw.map(function (lr) {
      var endMs = lr.endSurvMs;
      var inLast = capsReal.filter(function (c) { return c.level === lr.fromLevel && c.surv > endMs - 15000 && c.surv <= endMs; });
      var backAll = capsReal.filter(function (c) { return c.level === lr.fromLevel && c.seg === '後段'; });
      var perLast = inLast.length ? 15 / inLast.length : null;
      var spanBack = (g.segSec[lr.fromLevel + 'b'] || 0);
      var perBack = backAll.length ? spanBack / backAll.length : null;
      return { fromLevel: lr.fromLevel, lastCaptures15s: inLast.length, perItemRatio: (perLast != null && perBack) ? perLast / perBack : null, isSprint: (perLast != null && perBack) ? (perLast / perBack <= 0.9) : null };
    });
    var musicSync = { byLevel: [1, 2, 3].map(function (l) { var d = g.musicDrift[l].map(Math.abs); return { level: l, n: d.length, medianAbsMs: median(d), maxAbsMs: maxOf(d) }; }), audioOutputLatencySec: r3(g.audioOutputLatencySec) };
    var longestIdleBetweenDrags = (function () {
      var ends = byType(E, 'dragEnd').filter(function (d) { return d.intervalToNextPressMs != null && d.intervalToNextPressMs !== '局結束'; }).map(function (d) { return d.intervalToNextPressMs; });
      return { n: ends.length, medianMs: median(ends), p90Ms: p90(ends) };
    })();
    var touchInfo = [1, 2, 3].map(function (l) {
      var ts = touches.filter(function (t) { return t.level === l; });
      return {
        level: l, touches: ts.length, bounceRate: ratio(ts.filter(function (t) { return t.result !== '捕捉'; }).length, ts.length),
        distFromCenterMedian: median(ts.map(function (t) { return t.distFromCenter; })), distFromCenterP90: p90(ts.map(function (t) { return t.distFromCenter; })),
        angleDiffAbsMedian: median(ts.map(function (t) { return Math.abs(t.angleToLitMid); })), angleDiffAbsP90: p90(ts.map(function (t) { return Math.abs(t.angleToLitMid); })),
        enterLitToTouchMedianMs: median(ts.map(function (t) { return t.enterLitToTouchMs; }).filter(function (v) { return v != null; })),
        enterLitToTouchP90Ms: p90(ts.map(function (t) { return t.enterLitToTouchMs; }).filter(function (v) { return v != null; })),
        methodShare: countBy(ts, function (t) { return t.method; }),
        releaseAfterMedianMs: median(ts.map(function (t) { return t.releaseAfterMs; }).filter(function (v) { return v != null; }))
      };
    });
    var grabStats = {
      grabs: grabs.length, pressToDragMedianMs: median(grabs.map(function (x) { return x.msAtDragStart; })), over200msShare: ratio(grabs.filter(function (x) { return x.msAtDragStart > 200; }).length, grabs.length),
      alreadyIntersectingShare: ratio(grabs.filter(function (x) { return x.alreadyIntersectingFloorId != null; }).length, grabs.length)
    };
    var relInfo = (function () {
      var o = {};
      relPasses.forEach(function (r) { var k = r.level + '|' + r.floorAId + '-' + r.floorBId; o[k] = o[k] || { n: 0, touched: 0, ratios: [] }; o[k].n++; if (r.touchedEither) o[k].touched++; if (r.speedRatio != null) o[k].ratios.push(r.speedRatio); });
      return Object.keys(o).map(function (k) { return { key: k, n: o[k].n, touched: o[k].touched, speedRatioMedian: median(o[k].ratios) }; });
    })();

    // ----- 碰網未觸發嫌疑(修好後應為 0)-----
    var suspectEv = byType(E, 'netMissSuspect');
    var suspectInfo = {
      count: suspectEv.length, sure: suspectEv.filter(function (s) { return s.kind === '確定'; }).length, doubtful: suspectEv.filter(function (s) { return s.kind === '疑似'; }).length,
      byLevel: [1, 2, 3].map(function (l) { return { level: l, n: suspectEv.filter(function (s) { return s.level === l; }).length }; }),
      nextTouchMedianMs: median(suspectEv.map(function (s) { return s.nextTouchMs; }).filter(function (v) { return v != null; })),
      list: suspectEv.map(function (s) { return { t: s.t, level: s.level, kind: s.kind, projectionA: s.projectionA, minBandDistance: s.minBandDistance, maxDepthPastLitLine: s.maxDepthPastLitLine, nextTouchMs: s.nextTouchMs, fate: s.fate }; })
    };
    // ----- 空按(對照組: 沒對上氣泡的按下)-----
    var emptyEv = byType(E, 'emptyPress');
    var emptyInfo = {
      count: emptyEv.length, byLevel: [1, 2, 3].map(function (l) { return { level: l, n: emptyEv.filter(function (e) { return e.level === l; }).length }; }),
      nearestDistMedian: median(emptyEv.map(function (e) { return e.nearestDist; }).filter(function (v) { return v != null; })),
      phaseQuartiles: [0, 0.25, 0.5, 0.75].map(function (q) { return emptyEv.filter(function (e) { return e.beatPhase >= q && e.beatPhase < q + 0.25; }).length; }),
      repressSameWithin1sShare: ratio(emptyEv.filter(function (e) { return e.repressSameWithin1sMs != null; }).length, emptyEv.filter(function (e) { return e.nearestBubbleId != null; }).length),
      pressPhaseQuartiles: [0, 0.25, 0.5, 0.75].map(function (q) { return presses.filter(function (e) { return e.beatPhase >= q && e.beatPhase < q + 0.25; }).length; })
    };
    // ----- 非滿血期間送進網踩拍率(熟手前段多半滿血, 改讀非滿血期間; 換位當下即判不計)-----
    var nonFullDeliver = [1, 2, 3].map(function (l) {
      var ns = nodes.filter(function (n) { return n.nodeType === '送進網' && n.counted && n.level === l && !n.fullAtNode && !n.swapJudged; });
      return { level: l, n: ns.length, onBeatRate: ratio(ns.filter(function (n) { return n.onBeat; }).length, ns.length), nonFullSec: g.levelStats[l] ? r3(g.levelStats[l].nonFullSec) : null };
    });
    // ----- 各關淨血拆解: 特色沾錯(血量)/ 特色時間(秒)/ bug 時間(秒); 時間 × 該關非滿血期間每秒收入 換成血量 -----
    var netBreakdown = [1, 2, 3].filter(function (l) { return g.levelStats[l]; }).map(function (l) {
      var ls = g.levelStats[l];
      var stay = (ls.exitSurv == null ? survEnd : ls.exitSurv) - ls.enterSurv;
      var oneMed = median(netMsList(function (n) { return n.level === l && qualNets(n) && n.conditionItemCount === 1; }));
      var income = ls.nonFullSec > 0 ? ls.nonFullHeal / ls.nonFullSec : null;
      var featMissHp = 0;
      misses.forEach(function (m, i) { if (m.level === l && l === 3 && m.withinOneBeatAfterRotate) featMissHp += missCost[i]; });
      var featNets = nets.filter(function (n) { return n.level === l && n.featureCount > 0; }).length;
      var cost = l === 2 ? PARAMS.structCost.jump : (l === 3 ? PARAMS.structCost.rotate : 0);
      var featTimeSec = featNets * cost;
      var bugSec = 0;
      suspectEv.forEach(function (s) {
        if (s.level !== l) return;
        var ms = s.nextTouchMs != null ? s.nextTouchMs : s.fateMs;
        if (ms == null) return;
        bugSec += Math.min(ms, oneMed == null ? ms : oneMed) / 1000;
      });
      return {
        level: l, netPerSec: stay > 0 ? r3(((ls.exitHp == null ? g.hp : ls.exitHp) - ls.enterHp) / stay) : null,
        featureMissHp: r3(featMissHp), featureTimeSec: r3(featTimeSec), featureTimeHp: income == null ? null : r3(featTimeSec * income),
        bugTimeSec: r3(bugSec), bugTimeHp: income == null ? null : r3(bugSec * income), nonFullIncomePerSec: income == null ? null : r3(income), featureNets: featNets
      };
    });
    // ----- 逐局「補償基準對照」: 第 9 輪分布套 +50 的基準踩拍率(各關、送進網與沾上分開)值待數值離線算, 這裡只列實測 -----
    var compBaseline = [1, 2, 3].map(function (l) {
      var bsF = beatStats.filter(function (b) { return b.level === l; });
      return { level: l, measured: bsF.map(function (b) { return { nodeType: b.nodeType, onBeatRate: b.onBeatRate }; }), baselineRound9Plus50: null, diff: null };
    });

    // ----- 單局時長對預測(spec 預測: 不踩拍型約 194~198 / 半數型 252~260 / 大部分型 290~292 秒; 取區間中點); 處理時間分類另列一次 -----
    var PRED_BY_CLASS = { '不踩拍型': 196, '半數型': 256, '大部分型': 291 };
    var PRED_BY_SKILL = { '新手': 196, '熟手': 256 };
    var durationVsPrediction = {
      durationSec: r3(survEnd), beatClass: beatClass, predictedByBeatClassSec: beatClass ? PRED_BY_CLASS[beatClass] : null,
      diffByBeatClassSec: beatClass ? r3(survEnd - PRED_BY_CLASS[beatClass]) : null,
      processClass: playerClass, predictedByProcessClassSec: PRED_BY_SKILL[playerClass] == null ? null : PRED_BY_SKILL[playerClass],
      diffByProcessClassSec: PRED_BY_SKILL[playerClass] == null ? null : r3(survEnd - PRED_BY_SKILL[playerClass]),
      classesAgree: (skillClass != null && (playerClass === '新手' || playerClass === '熟手')) ? (skillClass === playerClass) : null
    };
    // ----- 死亡時距下一次換關(第 1、2 關)或第 3 關下一次循環接縫的秒數(存活時間, 限血量歸零結束的局)-----
    var deathToNextSeam = null;
    if (endReason === 'hpZero' && g.phase === 'playing') {
      var lvD = LEVELS[g.lvl], beatD = g.lt / g.bs, nextB = lvD.endBeat != null ? lvD.endBeat : (Math.floor(beatD / lvD.loopBeats) + 1) * lvD.loopBeats;
      deathToNextSeam = { level: g.lvl, kind: lvD.endBeat != null ? '換關' : '循環接縫', sec: r3((nextB - beatD) * g.bs) };
    }
    // ----- 到達的最高關段與在最高關停留的秒數; 每局到達的最高關、停留秒數、踩拍分類、處理時間分類 -----
    var lsMax = g.levelStats[g.maxLevel];
    var maxLevelInfo = {
      maxLevel: g.maxLevel, maxSeg: segKeyNow(g), staySecAtMaxLevel: lsMax ? r3((lsMax.exitSurv == null ? survEnd : lsMax.exitSurv) - lsMax.enterSurv) : null,
      beatClass: beatClass, processClass: playerClass, deathSegment: endReason === 'hpZero' ? segKeyNow(g) : null
    };
    // ----- 預告期間(每次段切換預告開始到生效): 生成數、捕捉數、彈回數 -----
    var previewWindows = stageCh.map(function (sc) {
      var a = sc.previewStartMs, b2 = sc.effectiveMs;
      function inW(e) { return a != null && e.t >= a && e.t < b2 && e.level === sc.level; }
      return { level: sc.level, previewStartMs: a, effectiveMs: b2, spawns: spawns.filter(inW).length, captures: caps.filter(inW).length, bounces: touches.filter(function (t) { return inW(t) && t.result !== '捕捉'; }).length + drops.filter(function (d) { return inW(d) && d.outcome === '彈回內圈'; }).length };
    });

    return {
      endReason: endReason, playerClass: playerClass, beatClass: beatClass, skillClass: skillClass, deliverRateAll: deliverRateAll,
      durationVsPrediction: durationVsPrediction, deathToNextSeam: deathToNextSeam, maxLevelInfo: maxLevelInfo, previewWindows: previewWindows,
      suspectInfo: suspectInfo, emptyPressInfo: emptyInfo, nonFullDeliverRate: nonFullDeliver, netBreakdown: netBreakdown, compBaseline: compBaseline,
      totalsCheck: totalsCheck, segStats: segStats, missBy: missBy, missInfo: missInfo,
      indicator1: indicator1, indicator2: indicator2, indicator3LongestNoCapture: { sec: r3(longestGap.sec), fromSurvSec: r3(longestGap.from), toSurvSec: r3(longestGap.to), capturePerMinuteBySeg: segStats.map(function (s) { return { seg: s.seg, v: s.capturePerMinute }; }) },
      indicator4: indicator4, indicator5: indicator5,
      beatStats: beatStats, tierCounts: tierCounts, interruptCounts: interruptCounts, captureTierSummary: capMaxTier, netTimeByBeatCount: netTimeByBeatCount,
      hpFlow: hpFlow, segFlow: segFlow, hpCurve: g.hpCurve, waveInfo: waveInfo, stuckInfo: stuckInfo, rotateInfo: rotateInfo, jumpInfo: jumpInfo, level3Blocks8Bars: level3Blocks,
      backlog: backlogInfo, freshness: freshness, firstThreeNets: firstThreeNets, levelInfo: levelInfo, deathInfo: deathInfo, buckets30s: buckets30, windows30AroundChanges: levelWindows30,
      sprint: sprint, musicSync: musicSync, dragGapBetween: longestIdleBetweenDrags, touchInfo: touchInfo, grabStats: grabStats, relPassSummary: relInfo,
      firstExpire: g.firstExpire, maxConcurrent: g.maxConcurrent, forcedPlacementCount: g.forcedPlacementCount,
      muteShare: ratio(g.muteSecAcc, Math.max(1e-6, g.gt + PARAMS.countInBeats * LEVELS[1].beatSec)), avgFrameIntervalMs: g.frameIntervalCount ? g.frameIntervalSum / g.frameIntervalCount : null,
      pauseCount: g.pauseCount, dangerSecTotal: r3(g.dangerSecTotal),
      heldSecShare: ratio(sumOf(byType(E, 'dragEnd').map(function (d) { return (d.durationMs || 0) / 1000; })), survEnd)
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
    if (g.lastDragEndRec && g.lastDragEndRec.intervalToNextPressMs == null) g.lastDragEndRec.intervalToNextPressMs = '局結束';
    if (g.lastCaptureRec && g.lastCaptureRec.pathToNextPress == null) g.lastCaptureRec.pathToNextPress = '局結束';
    if (g.pendingSwapRec && g.pendingSwapRec.firstCaptureAfterMs == null) g.pendingSwapRec.firstCaptureAfterMs = '局結束';
    g.bubbles.slice().forEach(function (b) {
      finalizeBubble(g, b, 'residual');
      emit(g, 'fieldEnd', {
        bubbleId: b.id, batchSeq: b.batchSeq, color: b.color, shape: b.shape, putBack: b.putBack, spawnLevel: b.spawnLevel, spawnSegKey: b.spawnSegKey,
        life: r3(Math.max(0, b.life)), grabCount: b.grabCount, countedNodes: b.nodes.map(function (n) { return { type: n.type, onBeat: n.onBeat }; }), tier: b.streak
      });
    });
    closeStuck(g, '局結束');
    if (g.wave.cur) flushBatch(g, g.wave.cur, '局結束');
    if (g.net) closeNetRec(g.net, '局結束');
    emit(g, 'netFinal', Object.assign({
      netInFieldMsAtEnd: g.net ? Math.round((g.gt - g.net.appearGT) * 1000) : null, condition: g.net ? { color: g.net.cond.color, shape: g.net.cond.shape } : null,
      waveState: waveStateName(g), batchSeq: g.batchSeq, isStuck: !!g.stuck
    }, netFields(g)));
    if (g.curSegKey && g.segHp[g.curSegKey] && g.segHp[g.curSegKey].exitHp == null) g.segHp[g.curSegKey].exitHp = g.hp;
    var summary = computeSummary(g, endReason);
    var out = {
      playerId: PLAYER_ID, gameIndex: g.gameIndex, device: g.device, gapFromPrevGameMs: g.gapFromPrev,
      buildVersion: BUILD_VERSION,
      paramsSnapshot: {
        params: PARAMS,
        levels: [1, 2, 3].map(function (l) {
          var lv = LEVELS[l];
          return {
            level: l, music: lv.music, bpmActual: lv.bpm, beatSec: lv.beatSec, bars: lv.bars, endBeat: lv.endBeat, segSwitchBeat: PARAMS.segSwitchBeat, previewBeats: PARAMS.previewBeats, batchN: lv.N, drain: lv.drain,
            musicInfo: (function () { try { return Sound.getMusicInfo(lv.music); } catch (e) { return null; } })()
          };
        }),
        floorTransforms: { level1: '原樣', level2: '轉 180°', level3: '左右鏡射' },
        floors: FLOORS.map(function (f) { return { id: f.id, kind: f.kind, color: f.color, shape: f.shape, anglesByLevel: f.ang, positionsByLevel: [1, 2, 3].map(function (l) { var p = floorPos(f, l, 0); return { x: Math.round(p.x), y: Math.round(p.y) }; }), appearByLevel: f.appear }; }),
        featureLevels: { jump: 2, rotate: 3 },
        rotation: { level: 3, everyBeats: PARAMS.rotateEveryBeats, previewBeats: PARAMS.rotatePreviewBeats, lastRotateBeat: null, loops: true },
        jump: { level: 2, everyBeats: PARAMS.jumpEveryBeats, previewBeats: PARAMS.jumpPreviewBeats, lastJumpBeat: PARAMS.jumpLastBeat },
        autoSwapLevels: [1, 3], autoSwapBeatPoint: PARAMS.autoSwapBeatPoint,
        gate: { widenPx: PARAMS.gateWiden, bandInnerApothem: BAND_IN, edgeApothem: WALL_APO, truncation: '兩端在亮邊線段端點垂直截斷並限亮扇區(梯形)', bandVertices: SLOTS.map(function (s) { return { id: s.id, pts: s.band.map(function (p) { return { x: r1(p.x), y: r1(p.y) }; }) }; }) },
        sectors: SLOTS.map(function (s) { return { id: s.id, midAngle: s.angle, range: [((s.angle - 22.5) + 360) % 360, (s.angle + 22.5) % 360], edgeVertices: [{ x: Math.round(s.v1.x), y: Math.round(s.v1.y) }, { x: Math.round(s.v2.x), y: Math.round(s.v2.y) }] }; }),
        slots: SLOTS.map(function (s) { return { id: s.id, angle: s.angle, x: Math.round(s.x), y: Math.round(s.y) }; }),
        netRule: { excludeSelfAndNeighbors: true, candidateSlots: 5, sameConditionMaxRun: 2, levelFirstNetColorOnly: true, guaranteePositions: '段切換: 生效後第一張; 換關: 該關第二張; 第 3 關後段無', shapeProb: PARAMS.shapeProb },
        waveRule: { gapBeatPoint: PARAMS.gapBeatPoint, halfBeatSpawn: true, lastNoBatchBeats: PARAMS.lastNoBatchBeats, constraint: '0.65 + (N-1) × (2.3 − 半拍) < 12', batchN: { l1: [4, 5], l2: [5, 6], l3: [6, 6] } },
        formations: FORM_ORDER.map(function (k) { var f = FORMATIONS[k]; return { key: k, name: f.name, unlockSegIndex: f.unlockSeg, directions: f.dirs, supportedN: [3, 4, 5, 6, 7, 8, 9, 10, 11].filter(function (n) { return f.supports(n); }) }; }),
        beatWindows: { deliverMs: PARAMS.beatWindowDeliverMs, stickBeats: PARAMS.beatWindowStickBeats, stickMsByLevel: [1, 2, 3].map(function (l) { return Math.round(PARAMS.beatWindowStickBeats * LEVELS[l].beatSec * 1000); }), offsetDeliverMs: PARAMS.beatOffsetDeliverMs, offsetStickMsByLevel: { l1: stickOffsetMs(1), l2: stickOffsetMs(2), l3: stickOffsetMs(3) }, baselineRound9Plus50: null, baselineNote: '第 9 輪分布套 +50 的基準踩拍率(常數, 各關、送進網與沾上分開)值待數值離線算' },
        beatChange: { form: '外緣以內: 本體內緣加粗 + 細波紋 + 高光上跳(art.js 每拍開頭 40%)', showFraction: PARAMS.beatChangeShowFrac, bubbleOuterRadius: Art.geometry ? Art.geometry.bubbleOuterRadius : null },
        tierMax: PARAMS.tierMax, stickFxSec: PARAMS.stickFxSec,
        hp: { max: PARAMS.hpMax, start: PARAMS.hpStart, catchGain: PARAMS.hpCatchGain, beatGain: PARAMS.hpBeatGain, chainGain: PARAMS.hpChainGain, expireLoss: PARAMS.hpExpireLoss, missLoss: PARAMS.hpMissLoss, overflowPerHp: PARAMS.overflowPerHp, dangerEnter: PARAMS.hpDangerEnter, dangerExit: PARAMS.hpDangerExit },
        structCost: { level2JumpSec: PARAMS.structCost.jump, level3RotateSec: PARAMS.structCost.rotate },
        buildNotes: { sorting: 'rd v16', eventKeys: 'type 欄為英文代號, 欄位值為中文', touchRule: '碰網即觸發(判定帶 + 外側); 不亮的邊無作用', specVersion: 'spec v16 / telemetry v16' }
      },
      countedForMainStats: (g.deathReasons.indexOf('放棄') === -1 && g.deathReasons.indexOf('重開') === -1),
      durationSec: r3(g.surv), score: g.score, deathReasons: g.deathReasons, maxLevelReached: g.maxLevel, pauseCount: g.pauseCount,
      crossGame: { maxLevelEver: parseInt(lsGet(MAXLEVEL_KEY), 10) || 1, firstReachLevel2Game: lsGet(FIRST_REACH_KEY + 2), firstReachLevel3Game: lsGet(FIRST_REACH_KEY + 3) },
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
    lastGameEndWall = Date.now(); lsSet(LAST_END_KEY, String(lastGameEndWall));
    inputQueue = []; mouse.btn = false; mouse.press = null;
    if (reason === 'restart') { startNewGame(); }
    else { screen = SCREEN.END; }
  }
  function startNewGame() {
    var idx = nextGameIndex();
    mouse.press = null; mouse.lastDropPos = null; mouse.netSeqAtLastDrop = null; mouse.pathSinceDrop = 0; mouse.btn = false;
    inputQueue = [];
    game = createGame(idx);
    endInfo = null;
    screen = SCREEN.PLAYING;
    try { Sound.playMusic(LEVELS[1].music, { beat: game.lt / game.bs }); } catch (e) {}
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

  // 視窗失去焦點: 拖曳中立刻視為在內圈外放開彈回(獨立路徑, 不看座標); 按住未拖比照放開; 接著自動暫停
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
  function bubbleRenderState(g, b, hoverId, beatPhase) {
    var status = 'idle';
    if (b.mode === 'hold') status = 'held';
    else if (b.mode === 'drag') status = b.carried ? 'carried' : 'dragging';
    else if (b.mode === 'return') status = 'returning';
    // beatPhase: 場上每一顆氣泡(含被按住、拖曳中、彈回中、帶過的那一顆)每幀都傳當下拍相位(同拍子提示的 phase; 暫停時時鐘凍結所以不推進)
    var st = { level: g.lvl, x: b.x, y: b.y, color: b.color, shape: b.shape, status: status, life: clamp01(b.life / LIFE), beatPhase: beatPhase };
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
    Art.drawBackground(ctx, { level: lvl, time: animT, beat: beat });
    Art.drawArena(ctx, { level: lvl });
    Art.drawHpRing(ctx, { level: lvl, hp: g.hp, danger: g.danger, time: animT, hpFx: g.hpFx });   // 血量環 + 危險紅光(預備拍起就畫)
    Art.drawBeatCue(ctx, { level: lvl, phase: phase, beat: fl });
    // 地板
    var floors = floorList(g, false);
    for (var i = 0; i < floors.length; i++) {
      var z = floors[i], st = z.st;
      var fs = { level: lvl, x: z.x, y: z.y, r: st.r, status: st.status, t: st.t || 0 };
      if (st.shrink) fs.shrink = st.shrink;
      if (z.kind === 'dye') { fs.color = z.color; Art.drawDyeFloor(ctx, fs); }
      else { fs.shape = z.shape; Art.drawShapeFloor(ctx, fs); }
    }
    // 第 3 關輪轉預告(2 拍; 第 62、63 拍與縮小預告同時, 縮小預告畫在地板本身、輪轉預告畫在地板間隙); 預告期間地板照原位置與大小
    if (lvl === 3 && g.phase === 'playing' && inRotateCue(g)) {
      var kRot = Math.ceil(beat / PARAMS.rotateEveryBeats - 1e-9) * PARAMS.rotateEveryBeats;
      var cueFloors = floors.map(function (z) {
        var o = { angle: z.ang };
        if (z.kind === 'dye') o.color = z.color; else o.shape = z.shape;
        return o;
      });
      Art.drawRotateCue(ctx, { level: lvl, p: clamp01((beat - (kRot - PARAMS.rotatePreviewBeats)) / PARAMS.rotatePreviewBeats), r: g.curBack ? PARAMS.floorRSmall : PARAMS.floorR, floors: cueFloors });
    }
    // 出批提示
    for (var bc = 0; bc < g.batchCues.length; bc++) { var c = g.batchCues[bc]; Art.drawBatchCue(ctx, { level: lvl, x: c.x, y: c.y, t: c.t }); }
    // 網牆
    var lit = null;
    if (g.net) {
      lit = { slot: g.net.slot, color: g.net.cond.color, shape: g.net.cond.shape };
      if (g.carry) lit.paletteLevel = g.carry.oldLevel;
      else {
        lit.hintT = g.netHintT; if (g.netFrom != null) lit.fromSlot = g.netFrom;
        if (g.net.jumpTo != null && g.phase === 'playing') lit.jump = { to: g.net.jumpTo, p: clamp01(phase) };
      }
    }
    var wall = { level: lvl, lit: lit };
    if (g.catchFx) wall.catchFx = { slot: g.catchFx.slot, t: g.catchFx.t, x: g.catchFx.x, y: g.catchFx.y };
    Art.drawNetWall(ctx, wall);
    // 氣泡: 閒置 / 彈回中 → 被按住 → 拖曳中 / 帶過的那一顆
    var hoverId = null;
    if (!paused && !mouse.btn && mouse.inside && g.phase === 'playing') { var hb = findBubbleUnder(g, mouse.x, mouse.y); if (hb) hoverId = hb.id; }
    var order = { idle: 0, 'return': 0, hold: 1, drag: 2 };
    var sorted = g.bubbles.slice().sort(function (a, b) { return (order[a.mode] || 0) - (order[b.mode] || 0); });
    for (var bi = 0; bi < sorted.length; bi++) Art.drawBubble(ctx, bubbleRenderState(g, sorted[bi], hoverId, phase));
    // 回饋
    for (var si = 0; si < g.stickFxs.length; si++) {
      var sf = g.stickFxs[si];
      var sst = { level: lvl, x: sf.bubble.x, y: sf.bubble.y, kind: sf.kind, attr: sf.attr, value: sf.value, t: sf.t, stack: sf.stack };
      if (sf.paletteLevel) sst.paletteLevel = sf.paletteLevel;
      Art.drawStickFx(ctx, sst);
    }
    for (var mf = 0; mf < g.missFxs.length; mf++) {
      var mx = g.missFxs[mf];
      var mst = { level: lvl, x: mx.x, y: mx.y, t: mx.t };
      if (mx.color) mst.color = mx.color;
      if (mx.paletteLevel) mst.paletteLevel = mx.paletteLevel;
      Art.drawMissFx(ctx, mst);
    }
    for (var bf = 0; bf < g.beatFxs.length; bf++) {
      var fx = g.beatFxs[bf];
      var bx = fx.x, by = fx.y;
      if (fx.bubble && !fx.bubble.dead) { bx = fx.bubble.x; by = fx.bubble.y; }
      Art.drawBeatFx(ctx, { level: lvl, x: bx, y: by, tier: fx.tier, t: fx.t, onBubble: fx.onBubble });
    }
    for (var cf = 0; cf < g.chainFxs.length; cf++) { var cfx = g.chainFxs[cf]; Art.drawChainFx(ctx, { level: lvl, x: cfx.x, y: cfx.y, t: cfx.t }); }
    if (g.phase === 'countIn') {
      var left = Math.max(1, Math.min(4, -fl));
      Art.drawCountIn(ctx, { level: lvl, beatsLeft: left, phase: phase });
      if (lvl > 1 && (g.introT || 0) < g.countInLen) Art.drawLevelIntro(ctx, { level: lvl, t: g.introT || 0, dur: g.countInLen });
    }
    var endBeat = LEVELS[lvl].endBeat;
    var songProgress = (g.phase === 'playing' && endBeat != null) ? clamp01(beat / endBeat) : null;
    Art.drawHud(ctx, {
      level: lvl, hp: g.hp, danger: g.danger, hpFx: g.hpFx, time: animT, survival: g.surv, songProgress: songProgress, score: g.score, combo: g.combo
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
      animT += dt;
      try { tick(dt, ts); } catch (e) { if (window.console) console.error(e); }
    }
    try { render(); } catch (e) { if (window.console) console.error(e); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
