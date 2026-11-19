// 捕泡手 遊戲邏輯(spec v19)。純傳統 script, 不用 ES module。繪製一律呼叫 window.Art, 聲音一律呼叫 window.Sound。
// 本版(v20)相對 v19: 刪除說明畫面(5 頁、開場自動開、已看過說明標記)、標題與暫停選單的「說明」、形狀說明對話框整套; 新增開始畫面(只剩「開始」)與嵌入式新手教學(8 階段狀態機, 每幀呼叫 Art.drawTutorial; 這次開網頁期間不重置、不存本機); 埋點 tutorial_show / tutorial_done / tutorial_hide。舊的本機說明標記一律忽略。
// 本版(v19)相對 v18: 拿掉輸入裝置選擇(標題按鈕與選擇畫面刪除、舊本機設定一律忽略、紀錄無裝置欄)、第 1 → 2 換關的形狀說明對話框(換關第 1~5 步後、預備拍前停住; 0.6 秒防誤點; 本機只自動出現一次)、
// 看錯保底(同一張光門亮 >= N 秒且期間沾錯消失 + 條件不符碰網 >= 2 次 → 連條件一起換; 第 2 關在下一次跳位、第 1、3 關在嚴格晚於成立的第 2 個拍點)、說明畫面 5 頁、telemetry v19(錯色配對表、缺形狀彈回、同條件鎖住段、形狀說明期間核對等)、
// 第 2 關門檻後備改只計死在第 2 關後段的熟手局、踩拍分類最低樣本 12 筆。
// 本版(v18)相對 v17: 換關血量回滿(關末幀血量結算後、預備拍前; 歸零就結束不回滿; 不算溢出; 解除危險; 回滿後帶過那一顆的回血照常算溢出)、危險狀態每幀最後一步判、關末那一幀持續扣血只算到關末、
// 帶過的那一顆送進網用新關的拍點與補償、第 3 關扣血斜率 0.032、後備撤銷 / 重設 / 新增與優先序(讀數, 不自動改扣血數值)、送進網補償條件式(局首自動套用)、曲子設定一律讀 Sound.getMusicInfo(105 / 115 / 125 BPM, 不寫死拍速與關長)、
// 指標 5 改最後一次血量 >= 80 到死、telemetry v18(換關回滿事件、第 2 關門檻、死在第 2 關、存活公式對照、第 3 關血量走勢、死前 15 秒、分群)、署名換成三首新曲。
// 以下為 v17 沿革。本版(v17)相對 v16: 踩拍節點只算光門要的屬性(以染上那刻亮著的光門判; 沒要求的形狀照常染上、給 unasked 回饋、不計次 / 不判踩拍 / 不回血 / 不進整串 / 不影響漸強 / 不算染錯)、送進網判定窗 ±100 毫秒與補償 +20、染上補償各關 +15、
// 換位當下即判後備(PARAMS.swapJudgeFallbackOn, 預設關)、第 3 關輪轉預告 3 拍、v17 埋點(分類 60 / 85%、沒要求染上假想命中、反事實命中率表、差一點、掉拍標記、後備判定欄與跨局累積)。
// 以下為 v16 沿革: 光門判定帶(亮邊往內圈加寬 12 像素, 兩端垂直截斷並限亮扇區; 碰網 / 屬性相符必判 / 換位當下即判 / 離開再碰回一律用判定帶)、
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
  var CW = Art.canvas.width, H = Art.canvas.height;   // CW: 實際畫布寬(電腦 1280, 觸控裝置 1280~1680)
  var W = 1280, OX = (CW - W) / 2;                    // W: 設計區寬(玩法、HUD、選單都在裡面); OX: 設計區置中的位移
  var TAU = Math.PI * 2;
  var BUILD_VERSION = 'demo-v21-0.1.0';
  // 接住的例外一律印出(同一種訊息只印前 3 次, 避免每幀重複洗版)
  var ERR_SEEN = {};
  function logErr(e, where) {
    var msg = (where ? where + ': ' : '') + String(e && e.message ? e.message : e);
    ERR_SEEN[msg] = (ERR_SEEN[msg] || 0) + 1;
    if (ERR_SEEN[msg] <= 3 && window.console) console.error(msg, e);
  }

  var CX = 640, CY = 360;
  // v22: 場地幾何一律讀 Art.geom(電腦版值 = 原本常數; 觸控版放大)。讀不到時才用電腦版值
  var G = Art.geom || { touch: false, arenaR: 210, bubbleR: 20, floorR: 24, floorRSmall: 20, floorRing: 140, wallMid: 300, gateInner: 288, grabR: 20, scale: 1 };
  var SC = G.scale;                      // 內圈內以圓心為原點的版位換算倍率(電腦 1, 觸控 240 / 210)
  var INNER_R = G.arenaR;
  var BUBBLE_R = G.bubbleR;
  var MOVE_R = INNER_R - BUBBLE_R;       // 閒置氣泡可活動半徑(電腦 190)
  var WALL_APO = G.wallMid;              // 網牆每邊中點距圓心(電腦 300)
  var WALL_VERT_R = WALL_APO / Math.cos(22.5 * Math.PI / 180);   // 約 324.7
  var TAN225 = Math.tan(22.5 * Math.PI / 180);
  var BAND_IN = G.gateInner;             // 判定帶內緣距圓心(電腦 288)
  var GATE_WIDEN = WALL_APO - BAND_IN;   // 光門判定加寬(亮邊線段往內圈方向, 兩模式都 12)
  var DRAG_B = { x0: BUBBLE_R, y0: BUBBLE_R, x1: W - BUBBLE_R, y1: H - BUBBLE_R };   // 電腦 20 / 20 / 1260 / 700
  var FLOOR_RING = G.floorRing;
  var LIFE = 12;

  var PARAMS = {
    bubbleR: BUBBLE_R, floorR: G.floorR, floorRSmall: G.floorRSmall, floorRing: FLOOR_RING, innerR: INNER_R,
    lifeSec: LIFE, hpMax: 100, hpStart: 60,
    hpCatchGain: 6, hpBeatGain: 2, hpChainGain: 2, hpExpireLoss: 6, hpMissLoss: 3, overflowPerHp: 2,
    hpDangerEnter: 40, hpDangerExit: 50,
    beatWindowDeliverMs: 100, beatOffsetDeliverMs: 20, beatOffsetDeliverRaisedMs: 50, beatOffsetRaiseRawCenterMs: -60, beatOffsetRaiseConsecutive: 2,   // 送進網補償: 各關初始 +20; 條件式 換曲後某關連續 2 局原始中心 <= −60 毫秒 → 該關 +50(見 computeDeliverOffsets)
    beatWindowStickBeats: 0.22, beatOffsetStickMsByLevel: [0, 15, 15, 15],   // 索引 = 關(各關 +15)
    gateWiden: GATE_WIDEN, emptyPressRepressSec: 1.0, beatChangeShowFrac: 0.4,
    tierMax: 3,
    stickFxSec: 0.8, unaskedFxSec: 0.6,
    swapJudgeFallbackOn: false,          // 換位當下即判後備(spec 待定 22): 觸發條件成立後由製作人改 true; true 時換位當下即判的送進網仍計次判踩拍, 但不給踩拍回血 / 回饋 / 聲音, 整串成立也不給回血 / 回饋 / 聲音
    countInBeats: 4,
    previewBeats: 4, segSwitchBeat: 64,
    floorIntroSec: 2.0,
    lastNoBatchBeats: 2,
    gapBeatPoint: 2,                      // 批間等待: 嚴格晚於本批清完那一刻的第 2 個拍點
    autoSwapBeatPoint: 2,                 // 自動換位: 嚴格晚於卡住成立那一刻的第 2 個拍點
    rotateEveryBeats: 8, rotatePreviewBeats: 3,          // 第 3 關地板輪轉(循環不設上限)
    l2Jump: false,                                         // v25 使用者決定移除第 2 關光門跳位; 關掉後第 2 關改用第 1、3 關的卡住自動換位與看錯保底
    jumpEveryBeats: 8, jumpPreviewBeats: 1, jumpLastBeat: null,   // 第 2 關光門跳位(關末拍不跳, 關末前 1 拍不預告); 最後一次跳位拍 = 關末拍 − 8, 由曲子設定的關長推算(見 LEVELS 之後)
    formationMaxR: 180 * SC, formationFloorMin: 48 * SC, formationGap: 44 * SC,
    spawnGap: 4, spawnTries: 10, spawnFxSec: 0.3,
    dragStartDist: 6, returnDurationSec: 0.2,
    scoreBase: 10, comboBonusPerStreak: 0.1, comboStreakCap: 20,
    sampleIntervalSec: 1.0,
    relPassWindowMs: 150,
    drain: { l1f: 3.2, l1b: 3.8, l2f: 4.6, l2b: 5.2, l3base: 4.8, l3perSec: 0.008 },   // v25 第 3 關太難: 原 5.2 + 0.032 × 秒(關末約 8.1)
    shapeProb: { l2f: 0.25, l2b: 0.4, l3: 0.4 },
    levelIntroSec: 2.4,
    structCost: { rotate: 0.20, jump: 0.19 },             // 第 3 關撞上輪轉 0.20 秒 / 第 2 關撞上跳位 0.19 秒
    // 後備門檻(只用於判定欄的讀數, 不自動改任何數值; 觸發後由製作人改規格): spec 參數表「扣血後備」與待定 28 / 22
    // v18: 撤銷 v17 的三條扣血後備(第 2 關淨收支 5.5 / 第 3 關上限 255 秒 / 下限 215 秒); 新增 第 2 關門檻(熟手局死在第 2 關 >= 2 局 → 第 2 關後段 4.9)與第 3 關上下限(進第 3 關熟手局第 3 關停留秒數中位 > 95 → 斜率 0.040 / < 45 → 起點 4.9); 優先序: 第 2 關門檻成立那一輪, 第 3 關上下限記「成立但不執行」
    // v19: 第 2 關門檻後備只計「死在第 2 關後段(第 2 關已過 >= 3840 ÷ B2 秒)」的熟手局(l2ThresholdBackOnly); 看錯保底後備: 每局 >= 3 次, 或換後 6 秒內未觸發 >= 50%
    fallback: { l2ThresholdHandyDiedGames: 2, l2ThresholdBackOnly: true, l2BackDrain: 5.2, l2BackDrainAfter: 4.9, l3UpperStayOverSec: 95, l3LowerStayUnderSec: 45, l3MinGames: 2, l3SlopeAfterUpper: 0.040, l3StartAfterLower: 4.9, item28MinAccum: 10, item28HitRateMin: 0.65, item28PerGameMedianMin: 3, swapJudgeShareOver: 0.25, misreadPerGame: 3, misreadNoTriggerWithinSec: 6, misreadNoTriggerShare: 0.5 },
    beatClassMinSample: 12,               // v19: 第 2、3 關送進網計次不足 12 筆記「未分類」(原分類另欄記)
    misread: { l2Sec: 6, l13Sec: 8, minErrors: 2, l13BeatPoint: 2 },   // 看錯保底: 第 2 關 N = 6 秒 + 下一次跳位; 第 1、3 關 N = 8 秒 + 嚴格晚於成立的第 2 個拍點; 期間沾錯消失 + 條件不符碰網 >= 2 次
    tutorial: { appearSec: (Art.timing && Art.timing.tutorialShow) || 0.25, doneSec: (Art.timing && Art.timing.tutorialDone) || 0.8, gapSec: 0.5, hideSec: 12, grabStartSec: 0.5, beatAutoSec: 2.5, hpLowFrac: 0.5 },      // 新手教學: 彈出 0.25 秒、完成特效 0.8 秒、完成後隔 0.5 秒、條件式 12 秒收起、階段 1 在第 0 拍後 0.5 秒、階段 7 出現 2.5 秒自動完成、階段 6 血量低於上限 50%

    // 第 10 輪分布套 ±100 / +20 的基準踩拍率(常數, 各關; 送進網約 78 / 91 / 84%、染上約 90%, 待數值精算)
    baselineRound10: { deliver: { 1: 0.78, 2: 0.91, 3: 0.84 }, stick: { 1: 0.90, 2: 0.90, 3: 0.90 }, note: '約值, 待數值精算' },
    onBeatClass: { noBeatBelow: 0.6, halfBelow: 0.85, legacyNoBeatBelow: 0.5, legacyHalfBelow: 0.75 },
    inBeatNormalizedMin: 0.32                              // 「在對拍」門檻: 送進網標準化踩拍率(讀數用)
  };
  function stickOffsetMs(lvl) { return PARAMS.beatOffsetStickMsByLevel[lvl] || 0; }

  // 各關曲子設定一律從 Sound.getMusicInfo 讀入(實測 BPM、關長小節數 levelBars、循環 loop / loopBeats、曲檔、第一拍與關內第 0 拍在音檔中的位置、循環起訖); 程式不寫死拍速與關長。
  // 只有 Sound 載不進來(讀不到曲子設定)時才用緊急預設, 讓畫面不當掉並在 console 報錯; 正常載入一律走曲子設定。
  var SONG_TITLES = { stage1: 'Voice Over Under', stage2: 'Litany to the Datastream Goddess', stage3: 'Thy Steel Consumed' };
  var EMERGENCY_MUSIC = [null, { bpm: 120, levelBars: 36, loop: false }, { bpm: 120, levelBars: 40, loop: false }, { bpm: 120, levelBars: 48, loop: false }];
  function readMusicInfo(name, lvl) {
    var mi = null;
    try { mi = Sound.getMusicInfo(name); } catch (e) { logErr(e); }
    if (!mi || !(mi.bpm > 0) || !(mi.levelBars > 0)) {
      if (window.console) console.error('Sound.getMusicInfo 讀不到曲子設定, 改用緊急預設: ' + name);
      return { info: null, use: EMERGENCY_MUSIC[lvl] };
    }
    return { info: mi, use: mi };
  }
  var LEVELS = [null,
    { n: 1, music: 'stage1', N: [4, 5], drain: [3.2, 3.8], feature: '無' },
    { n: 2, music: 'stage2', N: [5, 6], drain: [4.6, 5.2], feature: '無(v25 移除光門跳位)' },
    { n: 3, music: 'stage3', N: [6, 6], drain: null, feature: '地板輪轉' }
  ];
  LEVELS.forEach(function (lv, i) {
    if (!lv) return;
    var r = readMusicInfo(lv.music, i), u = r.use;
    lv.info = r.info;
    lv.bpm = u.bpm;                                   // 實測 BPM(可為小數)
    lv.beatSec = 60 / lv.bpm;                         // 每拍秒數
    lv.bars = u.levelBars;                            // 關長小節數(第 3 首為一輪)
    lv.loopBeats = u.loop ? (u.loopBeats || u.levelBars * 4) : u.levelBars * 4;
    lv.endBeat = u.levelBars * 4;                     // 關末拍(第 3 關曲檔可循環, 但播完一輪就過關結束)
    lv.levelSec = u.levelBars * 240 / lv.bpm;         // 關長秒數(第 3 關為一輪)
    lv.title = SONG_TITLES[lv.music];
  });
  PARAMS.jumpLastBeat = LEVELS[2].endBeat - PARAMS.jumpEveryBeats;   // 第 2 關最後一次跳位拍 = 關末拍 − 8(關末拍本身不跳)
  // 約束(寫死): 0.65 + (N − 1) × (2.3 − 半拍秒數) < 12(壽命), 依實測拍速逐關核對
  LEVELS.forEach(function (lv) {
    if (!lv) return;
    lv.N.forEach(function (n) {
      var tight = 0.65 + (n - 1) * (2.3 - lv.beatSec / 2);
      if (!(tight < LIFE) && window.console) console.error('每批約束不成立: 第 ' + lv.n + ' 關 N=' + n + ' 值=' + tight);
    });
  });

  // ---------- 小工具 ----------
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function r3(v) { return v == null ? null : Math.round(v * 1000) / 1000; }
  function angleOf(x, y) { var a = Math.atan2(y - CY, x - CX) * 180 / Math.PI; return (a + 360) % 360; }
  function angleDiff180(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function angleDelta(a, mid) { var d = a - mid; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
  function uniqArr(arr) { var o = []; arr.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
  function byType(events, t) { return events.filter(function (e) { return e.type === t; }); }
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 本機狀態(鍵名 bubble-tempo:<用途>; 舊鍵 bcv19_ / bcv18_ ... 讀不到新鍵時搬進新鍵並刪掉自己的舊鍵; 輸入裝置設定一律忽略) ----------
  var GAME_COUNT_KEY = 'bubble-tempo:gameCount';
  var MUTED_KEY = 'bubble-tempo:muted';
  var HISTORY_KEY = 'bubble-tempo:history';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { logErr(e, 'localStorage 讀取'); return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { logErr(e); } }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) { logErr(e); } }
  var LS_V19 = ['bcv19_'];
  var LS_OLD_PREFIXES = ['bcv19_', 'bcv18_', 'bcv17_', 'bcv16_', 'bcv15_', 'bcv14_'];
  // 讀新鍵; 沒有值就依序找舊鍵, 找到的搬進新鍵, 並把這個用途的舊鍵全刪(只刪自己的舊鍵)
  function lsGetMig(k, prefixes) {
    var v = lsGet(k);
    for (var i = 0; v == null && i < prefixes.length; i++) {
      v = lsGet(k.replace('bubble-tempo:', prefixes[i]));
      if (v != null) { lsSet(k, v); for (var j = 0; j < prefixes.length; j++) lsRemove(k.replace('bubble-tempo:', prefixes[j])); }
    }
    return v;
  }
  // 局數、靜音、跨局紀錄沿用舊版各代的值(跨局紀錄只沿用 v19)
  function lsGetCompat(k) { return lsGetMig(k, LS_OLD_PREFIXES); }
  function nextGameIndex() {
    var n = parseInt(lsGetCompat(GAME_COUNT_KEY), 10) || 0;     // 第幾局沿用舊版累計
    n += 1; lsSet(GAME_COUNT_KEY, String(n));
    return n;
  }
  function loadMuted() { return lsGetCompat(MUTED_KEY) === '1'; }
  function saveMuted(m) { lsSet(MUTED_KEY, m ? '1' : '0'); }
  var SESSION_GAME_COUNT = 0;       // 同一次頁面載入期間的局數(重新整理 / 重開分頁歸零)

  // ---------- 聲音(全部包 try, 沒載入也不當掉) ----------
  var muted = loadMuted();
  try { if (window.Sound && Sound.setMuted) Sound.setMuted(muted); } catch (e) { logErr(e); }
  var soundInited = false;
  function ensureSoundInit() {
    if (!soundInited) { soundInited = true; try { Sound.init(); } catch (e) { logErr(e); } }
  }
  function snd(name, opts) { try { Sound.play(name, opts); } catch (e) { logErr(e); } }
  window.BubbleTempoMuted = function () { return muted; };   // 給觸控層暫停時還原靜音設定用
  function toggleMute() {
    muted = !muted;
    try { Sound.setMuted(muted); } catch (e) { logErr(e); }
    saveMuted(muted);
  }

  // ---------- 畫布 DPI ----------
  // 依容器(#stage, 即瀏覽器視窗或網站 iframe)算最大等比尺寸, 置中、多的留黑邊、不裁切不拉伸; 實際像素 = CSS 尺寸 × devicePixelRatio
  function fitCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var box = canvas.parentNode;
    var cw = (box && box.clientWidth) || window.innerWidth || CW;
    var ch = (box && box.clientHeight) || window.innerHeight || H;
    var scale = Math.min(cw / CW, ch / H);
    if (!(scale > 0)) scale = 1;
    var cssW = CW * scale, cssH = H * scale;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(canvas.width / CW, 0, 0, canvas.height / H, 0, 0);
  }
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', function () { fitCanvas(); setTimeout(fitCanvas, 200); });

  // ---------- 畫面狀態機 ----------
  var SCREEN = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', END: 'end' };
  var screen = SCREEN.TITLE;
  var endInfo = null;
  var hov = { title: null, pauseBtn: false, muteBtn: false, pauseMenu: null, confirm: null, end: null };
  var confirmKind = null;          // 暫停選單上的確認面板: null / 'restart' / 'quit'(只在 PAUSED 畫面有意義)
  var game = null;
  var animT = 0;                   // 背景 / HUD 動態用的遞增秒數(暫停凍結)
  // 署名: credits.md 的新署名(三首新曲; 前兩首已調速、第 3 首已截取並循環)。標題與結束畫面的署名區只有約 106 像素高, 所以把每首的「曲名 / 作者 / 授權 / 修改說明」併成一行, 授權網址放最後一行
  var CREDITS_LINES = [
    '音樂 / Music — Licensed under Creative Commons: By Attribution 4.0 / CC-BY 3.0',
    '第 1 關 "Voice Over Under" Kevin MacLeod (incompetech.com), CC BY 4.0, 已調速(135 → 105 BPM)並截取 / tempo changed and excerpted',
    '第 2 關 "Litany to the Datastream Goddess" by FoxSynergy (opengameart.org), CC-BY 3.0, 已調速(128 → 115 BPM)並截取 / tempo changed and excerpted',
    '第 3 關 "Thy Steel Consumed" by FoxSynergy (opengameart.org), CC-BY 3.0, 已調速(120 → 125 BPM)並截取 / tempo changed and excerpted',
    'creativecommons.org/licenses/by/4.0/  ·  creativecommons.org/licenses/by/3.0/'
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
      // 三分搜尋永遠到不了端點 t = 1: 指標整數座標剛好落在相切位置(軸對齊的槽 1 / 3 / 5 / 7, 氣泡中心距圓心恰 268)時, 最近點就是 t = 1 本身,
      // 搜尋回傳的 tmin 略小於 1 而距離略大於容差, 會誤判成沒碰到(但位置式的 touchesLit 判成碰到), 所以端點要單獨比
      if (f(1) <= f(tmin)) tmin = 1;
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
      return { x: CX + r.x * SC, y: CY + r.y * SC };   // 內圈內版位 × 換算倍率
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
    var bs = LEVELS[1].beatSec;
    var g = {
      id: 'g#' + idx, gameIndex: idx, startWall: Date.now(),
      lvl: 1, bs: bs, phase: 'countIn', lt: -PARAMS.countInBeats * bs, gt: -PARAMS.countInBeats * bs, surv: 0, beatIdx: -PARAMS.countInBeats,
      introT: 0, countInLen: PARAMS.countInBeats * bs, lastCountInBeat: null, curBack: false, previewLogged: false, previewStartGT: null,
      hp: PARAMS.hpStart, danger: false, score: 0, combo: 0,
      hpFx: [], stickFxs: [], beatFxs: [], chainFxs: [], missFxs: [], batchCues: [], catchFx: null, netHintT: 99, netFrom: null,
      bubbles: [], nextBubbleId: 1,
      wave: newWave(), batches: [], batchSeq: 0,
      net: null, netSeq: 0, netLevelSeq: 0, recent: [], pendingGuarantee: null, netAppearRec: null, netAppearList: [], netFirstPressDone: false, netApproached: false,
      carry: null, endFrame: false, holdStartGT: null,
      clipSec: 0, tutDone: [], pendingMisreadRecs: [], sampleCount: 0, l2Drift: { song: [], level: [] },
      stuck: null, stuckSeq: 0, stuckHint: '網輪替後', autoSwapCount: 0, rotateSeq: 0, jumpSeq: 0, rotatePreviewRec: null, jumpPreviewRec: null, lastRotateBeat: null, lastJumpBeat: null, lastRotateRec: null,
      pendingEmpty: [], lastDtMs: 0, multiBatchFrames: 0,
      events: [], spawnSegOf: {},
      paused: false, pauseCount: 0, openPauseRecord: null, pauseRealMs: 0,
      totals: {
        spawned: 0, captured: 0, expired: 0, missColor: 0, missShape: 0, levelCleared: 0, bounceCond: 0, bounceOuter: 0, stayInner: 0, putBack: 0,
        holdNoDrag: 0, swipeEffective: 0, swipeLocked: 0, batches: 0, nodeCounted: 0, nodeUncounted: 0, nodeOnBeat: 0, nodeByType: {},
        presses: 0, grabs: 0, drops: 0, heals: 0, netAppears: 0, levelSwitches: 0, carryCaptured: 0, carryCleared: 0, touches: 0,
        misreadEstablished: 0, misreadExecuted: 0, misreadCancelled: 0, misreadDeferrals: 0, swapJudged: 0, swapNoJudge: 0, touchGuard: 0, swipeUnasked: 0, jumpPreviewCaptures: 0, jumpOnlyCount: 0, jumpCondCount: 0, hitOffEdge: 0, emptyPresses: 0, suspects: 0, suspectsSure: 0, rotations: 0
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
      refillSeq: 0, refillTotal: 0, fullKind: null, firstFullByRefill: null, endOvershoot: 0, carryOverflowHp: 0, carryOverflowPts: 0,
      hp80: { ever: false, lastSurv: null, lastKey: null, lastLevel: null }, l3Hp: { peak: null, peakSec: null, lastNearPeakSec: null },
      resync: { 1: 0, 2: 0, 3: 0 }, driftMaxAbs: { 1: 0, 2: 0, 3: 0 }, deliverOffsets: computeDeliverOffsets(),
      lowHpSec: 0, lowHpWas: false, firstLowSurv: null, firstLowKey: null, lowEntries: [], dangerOpenSince: null, dangerSecTotal: 0,
      firstExpire: null, captureSurvTimes: [],
      pendingDeathReasons: [], deathBatchSeqs: [], deathReasons: [],
      levelRecs: [], levelEnterSurv: { 1: 0 }, levelStats: {}, musicDrift: { 1: [], 2: [], 3: [] }, lastDrift: null,
      pendingRelPass: [], stageChanges: [], done: false, maxLevel: 1, lvlSurvStart: 0,
      lastHpLossGT: null, segHp: {}, curSegKey: null, segAcc: {}, sessionIndex: ++SESSION_GAME_COUNT,
      chainStats: { tiers: {}, interrupts: {}, byNode: {} },
      nodeDiffs: {}
    };
    enterLevelStats(g, 1);
    try { g.audioOutputLatencySec = Sound.getOutputLatency() || 0; } catch (e) { logErr(e); }
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

  // 看錯保底的新條件: 用自動換位的抽法(只從場上至少一顆能滿足的條件中抽), 並排除舊網的顏色; 排除後沒得抽(兩類都沒有)才允許舊網的顏色。
  // 要不要疊形狀依當段疊形狀機率(該類留下 0 組時改抽另一類); 套「同一組條件最多連續 2 張」, 套用後沒有可抽的就不套
  function rollMisreadCondition(g, info, oldColor) {
    var origWithShape = info.shapes.length > 0 && Math.random() < info.shapeProb;
    function buildPool(ws, excludeOld) {
      var pool = [];
      if (!ws) info.colors.forEach(function (c) { pool.push({ color: c, shape: null }); });
      else info.colors.forEach(function (c) { info.shapes.forEach(function (s) { pool.push({ color: c, shape: s }); }); });
      return pool.filter(function (cd) { return (!excludeOld || cd.color !== oldColor) && g.bubbles.some(function (b) { return compatibleWithCond(b, cd); }); });
    }
    var withShape = origWithShape, switched = false, forcedOld = false;
    var pool = buildPool(withShape, true);
    if (!pool.length && info.shapes.length > 0) { withShape = !withShape; switched = true; pool = buildPool(withShape, true); }
    if (!pool.length) {
      // 排除舊顏色後兩類都沒得抽, 才允許舊網的顏色
      forcedOld = true; withShape = origWithShape; switched = false;
      pool = buildPool(withShape, false);
      if (!pool.length && info.shapes.length > 0) { withShape = !withShape; switched = true; pool = buildPool(withShape, false); }
    }
    if (!pool.length) pool = info.colors.map(function (c) { return { color: c, shape: null }; });     // 理論上不會發生(卡住成立時場上必有透明圓或可滿足的氣泡)
    var candCount = pool.length;
    var picked = pickRandom(pool), excluded = false;
    if (g.recent.length === 2 && sameCondition(g.recent[0], g.recent[1]) && sameCondition(picked, g.recent[1])) {
      var filtered = pool.filter(function (c) { return !sameCondition(c, picked); });
      if (filtered.length) { picked = pickRandom(filtered); excluded = true; }
    }
    return { cond: picked, isGuar: false, guarContent: null, candCount: candCount, candAfter: excluded ? candCount - 1 : candCount, note: { type: withShape ? '疊' : '不疊', switchedClass: switched, forcedOldColor: forcedOld } };
  }

  // ==================================================================
  // 看錯保底(spec「看錯保底」): 同一張光門亮起已 >= N 秒且還沒被捕捉, 而且期間「沾錯消失 + 條件不符碰網」合計 >= 2 次 → 光門連條件一起換
  //   第 2 關 N = 6 秒, 在成立後的下一次跳位那一刻(位置用跳位預告的目標槽位); 第 1、3 關 N = 8 秒, 在嚴格晚於成立那一刻的第 2 個拍點(位置照輪替第 2 步抽)
  //   延後: 執行那一刻若有拖曳中的氣泡已沾上的屬性全都符合舊網條件且至少已沾上一項 → 不換, 改到下一次跳位 / 下一個拍點再判
  //   取消: 這張網被捕捉、本關到達關末、換關; 與卡住同時成立只執行卡住(讓給卡住)。換上來的是新的一張網: 不是保底張、不用掉保底、不扣血不加分不改連續數
  //   秒數用局時間(g.gt)差, 暫停、預備拍、形狀說明對話框開著時 g.gt 都不走
  // ==================================================================
  function isJumpLvl(lvl) { return lvl === 2 && PARAMS.l2Jump; }   // 這關有沒有光門跳位(v25 起都沒有)
  function misreadN(lvl) { return isJumpLvl(lvl) ? PARAMS.misread.l2Sec : PARAMS.misread.l13Sec; }
  function noteMisread(g, kind, atLT) {
    var net = g.net;
    if (!net || net.closed || g.phase !== 'playing') return;
    if (kind === 'miss') net.misMiss++; else net.misBounce++;
    if (net.misMiss + net.misBounce === PARAMS.misread.minErrors) net.misSecondGT = gtAt(g, atLT == null ? g.lt : atLT);
  }
  function updateMisread(g) {
    if (g.phase !== 'playing' || !g.net || g.carry || g.endFrame) return;
    var net = g.net;
    if (net.misread || net.closed) return;
    if (net.misMiss + net.misBounce < PARAMS.misread.minErrors) return;
    var N = misreadN(g.lvl);
    if (g.gt - net.appearGT < N - 1e-9) return;
    var estGT = Math.min(g.gt, Math.max(net.misSecondGT == null ? g.gt : net.misSecondGT, net.appearGT + N));
    var estLT = g.lt - (g.gt - estGT);
    var sched = !isJumpLvl(g.lvl) ? Math.floor(estLT / g.bs + 1e-9) + PARAMS.misread.l13BeatPoint : null;
    var nextJump = isJumpLvl(g.lvl) ? (Math.floor(estLT / g.bs / PARAMS.jumpEveryBeats + 1e-9) + 1) * PARAMS.jumpEveryBeats : null;
    var rec = emit(g, 'misread', {
      netSeq: net.seq, netLevelSeq: net.levelSeq, slotId: slotByNo(net.slot).id, oldCondition: { color: net.cond.color, shape: net.cond.shape },
      establishedMs: Math.round(estGT * 1000), litSecAtEstablish: r3(estGT - net.appearGT), thresholdSec: N, missDuring: net.misMiss, bounceDuring: net.misBounce,
      scheduledBeat: sched, nextJumpBeatIfNoLaterChange: nextJump, executeRule: isJumpLvl(g.lvl) ? '成立後的下一次跳位' : '嚴格晚於成立的第 2 個拍點',
      deferrals: 0, outcome: null, execMs: null, execBeat: null, cancelReason: null, newCondition: null, forcedOldColor: null, newNetSeq: null, afterExecToCaptureSec: null
    }, estLT);
    net.misread = { pending: true, rec: rec, scheduledBeat: sched, deferrals: 0 };
    g.totals.misreadEstablished++;
  }
  // 拖曳中的氣泡已沾上的屬性全都符合舊網條件(不衝突)且至少已沾上一項 → 延後
  function misreadDeferNow(g) {
    var pr = mouse.press;
    var b = (pr && pr.dragging) ? pr.bubble : null;
    if (!b || b.dead || !g.net) return false;
    var acquired = b.color != null || b.shape !== 'circle';
    return acquired && compatibleWithCond(b, g.net.cond);
  }
  function cancelMisread(g, reason, net) {
    var mr = net && net.misread;
    if (!mr || !mr.pending) return;
    mr.pending = false;
    mr.rec.outcome = '取消'; mr.rec.cancelReason = reason; mr.rec.deferrals = mr.deferrals;
    mr.rec.afterExecToCaptureSec = null;
    g.totals.misreadCancelled++;
  }
  // 執行: 舊網結束(看錯保底)、亮起新的一張網(slotTo 有值 = 第 2 關跳位預告的目標槽位)
  function execMisread(g, net, k, slotTo) {
    var mr = net.misread, oldCond = { color: net.cond.color, shape: net.cond.shape };
    mr.pending = false;
    closeNetRec(net, '看錯保底');
    lightNet(g, 'misread', slotTo ? { slot: slotTo } : null);
    var nc = g.net.cond, an = g.netAppearRec && g.netAppearRec.autoCondNote;
    var rec = mr.rec;
    rec.outcome = '執行'; rec.execMs = gtMs(g); rec.execBeat = k; rec.deferrals = mr.deferrals; rec.oldCondition = oldCond;
    rec.newCondition = { color: nc.color, shape: nc.shape }; rec.forcedOldColor = !!(an && an.forcedOldColor); rec.newNetSeq = g.net.seq; rec.newSlotId = slotByNo(g.net.slot).id;
    g.pendingMisreadRecs.push({ rec: rec, execGT: g.gt });
    g.totals.misreadExecuted++;
  }
  // 第 1、3 關: 到時(拍點)執行
  function misreadSwapNow(g, k) {
    var net = g.net;
    if (!net || !net.misread || !net.misread.pending) return;
    var mr = net.misread, tK = k * g.bs;
    var stuckNow = fieldCount(g) >= 1 && fullSatisfiableCount(g) === 0;
    if (stuckNow) { cancelMisread(g, '讓給卡住', net); return; }       // 與卡住同時成立: 只執行卡住(自動換位照排定時刻執行)
    if (misreadDeferNow(g)) { mr.deferrals++; mr.rec.deferrals = mr.deferrals; g.totals.misreadDeferrals++; mr.scheduledBeat = k + 1; return; }
    execMisread(g, net, k, null);
    g.lastSwapJudgeInfo = null;
    judgeAfterSwap(g, tK);
  }

  // kind: 'first'(每關第一張)/ 'rotate'(捕捉輪替)/ 'autoswap'(第 1、2 關自動換位)/ 'jumpcond'(第 3 關卡住時跳位換條件)/ 'misread'(看錯保底); opts.slot 指定槽位
  function lightNet(g, kind, opts) {
    opts = opts || {};
    var prev = g.net;
    g.jumpWatch = null;
    // 舊網上還沒執行的看錯保底: 捕捉輪替 → 取消(捕捉); 自動換位 / 卡住時跳位換條件 → 讓給卡住; 每關第一張 → 換關
    if (prev && prev.misread && prev.misread.pending && kind !== 'misread') cancelMisread(g, kind === 'rotate' ? '捕捉' : (kind === 'first' ? '換關' : '讓給卡住'), prev);
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
      var draw = (kind === 'rotate') ? rollCondition(g, info) : (kind === 'misread' ? rollMisreadCondition(g, info, prev.cond.color) : rollAutoCondition(g, info));
      cond = draw.cond; isGuar = draw.isGuar; guarContent = draw.guarContent; candConds = draw.candAfter; note = draw.note;
    }
    g.recent.push(cond); if (g.recent.length > 2) g.recent.shift();
    g.netSeq++; g.netLevelSeq++;
    var net = { seq: g.netSeq, levelSeq: g.netLevelSeq, slot: slot, cond: cond, appearGT: g.gt, appearSurv: g.surv, appearLT: g.lt, kind: kind, isGuar: isGuar, level: g.lvl, jumpTo: null, rotations: 0, jumpsOnly: 0, jumpPreviewSkip: null, misMiss: 0, misBounce: 0, misSecondGT: null, misread: null, touchedDark: 0, featureCount: 0, firstFeatureGT: null, firstFeatureHand: null, closed: false };
    g.netFrom = prev ? prev.slot : null;
    var sd = slotByNo(slot);
    g.net = net;
    g.netHintT = 0;
    g.netApproached = false; g.netFirstPressDone = false;
    var needed = [];
    var cf = floorOfColor(cond.color);
    if (cf) { var cp = floorPos(cf, g.lvl, g.beatIdx); needed.push({ floorId: cf.id, attr: 'color', diffDeg: r1(angleDiff180(angleOf(cp.x, cp.y), sd.angle)) }); }
    if (cond.shape) { var sf = floorOfShape(cond.shape); var sp = floorPos(sf, g.lvl, g.beatIdx); needed.push({ floorId: sf.id, attr: 'shape', diffDeg: r1(angleDiff180(angleOf(sp.x, sp.y), sd.angle)) }); }
    var REASON = { first: '每關第一張', rotate: '捕捉輪替', autoswap: '自動換位', jumpcond: '跳位換條件', misread: '看錯保底' };
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
      prevNetEnd: prev ? (kind === 'rotate' ? '捕捉' : (kind === 'autoswap' ? '自動換位' : (kind === 'misread' ? '看錯保底' : '跳位換條件'))) : null,
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
    rec.missVanishDuring = net.misMiss; rec.bounceCondDuring = net.misBounce; rec.misreadEstablished = !!net.misread;
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
      lockedSame: 0, lockedDiff: 0, lockedSameThis: 0, lockedDiffThis: 0, unaskedCount: 0, unaskedThisDrag: 0, pendingDetour: null, dragLastActionPath: null, dragLastActionGT: null,
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
      captured: 0, missVanish: 0, expired: 0, bounceCond: 0, suspects: 0, suspectsSure: 0, twoCondNets: 0, twoCondCaptured: 0, rotations: 0, capturedNets: 0, capturedNetsHitRotate: 0, levelClearedCount: 0, clearPhase: null, clearToNextBeatMs: null,
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
  // 危險狀態(spec v18「同一幀的處理順序」第 8 步): 每幀只在最後一步判一次, 以第 1~7 步(含換關回滿)全部完成後的血量判進入(<= 40)或解除(>= 50 或換關回滿); 本幀有換關回滿時不會進入危險、也不響危險音效
  // silent = 局結束那一幀(只更新 <= 40 的紀錄, 不響音效)
  function updateDanger(g, silent) {
    if (!g.danger && g.hp <= PARAMS.hpDangerEnter) {
      g.danger = true;
      g.dangerOpenSince = g.surv;
      if (!silent) snd('danger');
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
  // 血量 >= 80 的最後時刻(telemetry 指標 5「最後一次血量 >= 80 到死」): 每次回血後與每幀最後都記, 換關回滿那一刻也記(存活時間; 換關預備拍不計)
  function noteHp80(g) {
    if (g.hp >= 80) { var h = g.hp80; h.ever = true; h.lastSurv = g.surv; h.lastKey = segKeyNow(g); h.lastLevel = g.lvl; }
  }
  // 第 3 關血量走勢(telemetry「第 3 關血量走勢」): 峰值與「最後一次血量 >= 峰值 − 0.1」的第 3 關已過秒數; 逐幀記, 峰值只增不減, 之後超過就整組改寫
  function trackL3Hp(g) {
    var s = g.l3Hp, t3 = Math.max(0, g.lt);
    if (s.peak == null || g.hp > s.peak) { s.peak = g.hp; s.peakSec = t3; s.lastNearPeakSec = t3; }
    else if (g.hp >= s.peak - 0.1) s.lastNearPeakSec = t3;
  }
  // 送進網偏移補償(毫秒): 各關初始 +20; 條件式(spec 參數表): 換曲後(= 同一 build)某關連續 2 局送進網原始時間差中心(中位數)<= −60 毫秒 → 該關改 +50
  function deliverOffsetMs(g, lvl) {
    var o = g && g.deliverOffsets && g.deliverOffsets.byLevel;
    return (o && o[lvl] != null) ? o[lvl] : PARAMS.beatOffsetDeliverMs;
  }
  // 局首依本機跨局紀錄(同一 build、以血量歸零結束的局, 取該關最近 2 個有原始中心的局)判條件式; 原始時間差不含補償, 所以判斷與當下補償無關
  function computeDeliverOffsets() {
    var out = { byLevel: {}, reasons: {} };
    var hist = loadHistory().filter(function (h) { return h.build === BUILD_VERSION && h.hpZero; });
    [1, 2, 3].forEach(function (l) {
      out.byLevel[l] = PARAMS.beatOffsetDeliverMs;
      var xs = hist.filter(function (h) { return h.deliverRawMedian && isNum(h.deliverRawMedian[l]); });
      var last = xs.slice(-PARAMS.beatOffsetRaiseConsecutive);
      if (last.length === PARAMS.beatOffsetRaiseConsecutive && last.every(function (h) { return h.deliverRawMedian[l] <= PARAMS.beatOffsetRaiseRawCenterMs; })) {
        out.byLevel[l] = PARAMS.beatOffsetDeliverRaisedMs;
        out.reasons[l] = { music: LEVELS[l].music, games: last.map(function (h) { return { gameIndex: h.gameIndex, medianRawMs: h.deliverRawMedian[l] }; }) };
      }
    });
    return out;
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
    var sa = segAcc(g); sa.heal[kind] += applied; sa.overflow += overflow;
    g.levelStats[g.lvl].healBySrc[kind] += amount; g.levelStats[g.lvl].overflow += overflow;
    if (before < 99.9) g.levelStats[g.lvl].nonFullHeal += applied;      // 非滿血期間的實得回血(各關「非滿血期間每秒收入」用)
    if (overflow > 1e-9) g.frame.overflow = true;
    pushHpFx(g, before, g.hp, kind);
    var rec = { source: KIND_NAME[kind], bubbleId: b ? b.id : null, due: amount, applied: applied, overflow: overflow, overflowPts: overflowPts, hpAfter: r1(g.hp), afterRefillCarry: !!(b && b.carried) };
    if (b && b.carried) { g.carryOverflowHp += overflow; g.carryOverflowPts += overflowPts; }      // 回滿後帶過的那一顆: 回血照常結算, 超過上限的部分照溢出換分(關卡切換事件回填)
    if (extra) for (var k in extra) rec[k] = extra[k];
    emit(g, 'heal', rec, atLT);
    noteHp80(g);
    tutNote(g, 'heal');
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
    tutNote(g, 'expire');
    if (!g.firstExpire) g.firstExpire = { surv: g.surv, key: segKeyNow(g), batchSeq: b.batchSeq, processable: processableCount(g) };
    snd('expire', { x: b.x });
    var before = g.hp;
    g.hp = Math.max(0, g.hp - PARAMS.hpExpireLoss);
    g.expireLossTotal += before - g.hp; g.levelStats[g.lvl].expireLoss += before - g.hp; segAcc(g).expire += before - g.hp;
    g.secExpire += before - g.hp;
    pushHpFx(g, before, g.hp, 'expire');
    g.combo = 0;
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
    g.missLossTotal += lost; g.levelStats[g.lvl].missLoss += lost; g.secMiss += lost; segAcc(g).miss += lost;
    pushHpFx(g, before, g.hp, 'miss');
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
  // 第 3 關輪轉預告中: 輪轉前 3 拍(第 k − 3、k − 2、k − 1 拍), k = 8 的倍數且 >= 8, 循環不設上限
  function inRotateCue(g) {
    if (g.lvl !== 3 || g.phase !== 'playing') return false;
    var beat = g.lt / g.bs, k = Math.ceil(beat / PARAMS.rotateEveryBeats - 1e-9) * PARAMS.rotateEveryBeats;
    if (k < PARAMS.rotateEveryBeats) k = PARAMS.rotateEveryBeats;
    return beat >= k - PARAMS.rotatePreviewBeats && beat < k;
  }
  // 第 2 關跳位預告中: 跳位前 1 拍(第 k − 1 拍), k = 8 的倍數、>= 8、<= 152(第 159 拍不預告)
  function inJumpCue(g) {
    if (!isJumpLvl(g.lvl) || g.phase !== 'playing') return false;
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
      beatChangeShowing: bpos.showing, beatPhase: bpos.phase, fullAtNode: g.hp >= 99.9,
      isWantedAttr: null, nearMiss: counted ? (!chk.on && (Math.abs(chk.adjMs) - windowMs) <= 40) : null,
      hypotheticalHit: type === '沒要求染上' ? chk.on : null,
      fallbackDeducted: !!(extra && extra.fallbackActive && counted && chk.on)
    };
    if (extra) for (var k in extra) { if (k !== 'fallbackActive') rec[k] = extra[k]; }
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
    resolveDetour(g, b, lt);
    var rec = emit(g, 'dragEnd', {
      bubbleId: b.id, dragSessionId: b.dragSessionId, reason: reason,
      pathLength: Math.round(b.dragPathLen), durationMs: b.pressGT == null ? null : Math.round((gnow - b.pressGT) * 1000),
      lockedSameThisDrag: b.lockedSameThis, lockedDiffThisDrag: b.lockedDiffThis, unaskedThisDrag: b.unaskedThisDrag, nearestEdgeDistanceByFloor: nearest,
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
      // 終點恰好落在相切位置(整數座標對上整數圓心)時, 二次方程式的根可能比 1 大一點點而回傳 null, 但 endInside 已把「已相交」記成 true, 這次擦過就整個漏掉; 終點在內就補一筆 t = 1
      if (!wasOverlap && (interval || endInside)) items.push({ kind: 'floor', t: interval ? interval[0] : 1, z: z, order: z.kind === 'dye' ? 0 : 1 });
      b.floorOverlap[z.id] = endInside;
      var closeD = closestDistanceOnSegment(p0, p1, z.x, z.y);
      if (b.dragMinDist[z.id] == null || closeD < b.dragMinDist[z.id]) b.dragMinDist[z.id] = closeD;
    }
    var net = g.net;
    if (net) {
      // 碰網未觸發嫌疑用: 本次拖曳(對當下這張網)氣泡圓離判定帶的最小距離、越過亮邊直線的最大深度、最接近那一刻的幀間隔
      // 第 2 關跳位只換位置、網序號不變, 所以量測起點要連槽位一起認(否則最小距離與越線深度會混到跳位前的舊亮邊)
      var mbKey = net.seq + '/' + net.slot;
      if (b.minBandNetSeq !== mbKey) { b.minBandNetSeq = mbKey; b.minBandDist = null; b.minBandFrameMs = null; b.maxLitDepth = 0; }
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
      if (len > 200 * FLOOR_RING / 140) continue;               // 只算相鄰兩個版位(間距 = 地板環半徑; 電腦 140 → 門檻 200)
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
    // 到這裡代表本段路徑沒有碰網。氣泡若已貼著亮邊(位置式判定), 代表路徑式的掃描與位置式判定不一致(例如剛好相切的邊界), 依規格「屬性相符、碰到判定帶一律必須判成捕捉」
    // 仍以本段終點判碰網(只在沒有被換位當下不符擋住時); 觸發過就在 resolveTouch 內結束拖曳
    if (g.net && !b.touchFlag && touchesLit(p1.x, p1.y, g.net.slot)) {
      g.totals.touchGuard++;
      resolveTouch(g, b, { x: p1.x, y: p1.y }, lt1, null, null, true);
      return;
    }
    // 目前是否仍貼在亮邊上: 旗標只會由「換位當下不符」設成 true, 這裡只負責在氣泡離開亮邊後解除, 絕不能因為位置貼著就自己設成 true(那會把之後整段碰網判定擋掉)
    if (b.touchFlag) b.touchFlag = !!g.net && touchesLit(p1.x, p1.y, g.net.slot);
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
  // 沒要求染上的「繞去形狀地板」: 下一個動作(下一次擦過、碰網或拖曳結束)發生時回填後半段的路徑長與時間
  function resolveDetour(g, b, lt) {
    var d = b.pendingDetour;
    if (!d) return;
    b.pendingDetour = null;
    d.rec.detourAfterPath = Math.round(b.dragPathLen - d.pathAt);
    d.rec.detourAfterSec = r3(gtAt(g, lt) - d.gtAt);
    d.rec.detourTotalPath = d.rec.detourBeforePath + d.rec.detourAfterPath;
    d.rec.detourTotalSec = r3(d.rec.detourBeforeSec + d.rec.detourAfterSec);
  }
  function swipeFloor(g, b, z, pos, nodeLT) {
    var net = g.net;
    resolveDetour(g, b, nodeLT);
    var prevActPath = b.dragLastActionPath == null ? 0 : b.dragLastActionPath;
    var prevActGT = b.dragLastActionGT == null ? gtAt(g, nodeLT) : b.dragLastActionGT;
    b.dragLastActionPath = b.dragPathLen; b.dragLastActionGT = gtAt(g, nodeLT);
    var before = attrOf(b);
    var attr = z.kind === 'dye' ? 'color' : 'shape';
    var value = attr === 'color' ? z.color : z.shape;
    var locked = attr === 'color' ? (b.color != null) : (b.shape !== 'circle');
    // 光門要的屬性: 以染上那一刻亮著的光門判(顏色一律是; 形狀只有光門有列形狀時才是)
    var wantedAttr = !!net && (attr === 'color' ? true : net.cond.shape != null);
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
      classification: cls, lockedSameAsExisting: null, floorValue: value, enterMs: Math.round(gtAt(g, nodeLT) * 1000),
      wantedClass: null, feedbackKind: null, detourBeforePath: null, detourBeforeSec: null, detourAfterPath: null, detourAfterSec: null, detourTotalPath: null, detourTotalSec: null,
      netCaresThisAttr: net ? (attr === 'color' ? true : (net.cond.shape != null)) : null,
      inPreview: inPreviewPeriod(g), inRotateCue: inRotateCue(g), beatsSinceRotate: g.lvl === 3 ? beatsSinceStructure(g) : null
    };
    if (cls === '已鎖定') {
      var same = (attr === 'color') ? (before.color === value) : (before.shape === value);
      evt.lockedSameAsExisting = same; evt.feedbackKind = '已鎖定';
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
        bubbleId: b.id, batchSeq: b.batchSeq, floorId: z.id, floorKind: z.kind === 'dye' ? '染色' : '賦形', floorAngle: z.ang, attr: attr, floorValue: value,
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
      noteMisread(g, 'miss', nodeLT);
      g.missFxs.push({ x: pos.x, y: pos.y, color: attr === 'color' ? value : null, t: 0, paletteLevel: b.carried && g.carry ? g.carry.oldLevel : null });
      snd('wrongDye', { x: pos.x });
      tutNote(g, 'wrong', { x: pos.x, y: pos.y });
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
    if (!wantedAttr) {
      // 光門沒要的屬性(光門沒列形狀時賦上形狀): 照常染上並鎖定, 不算染錯; 不是節點 —— 不計次、不判踩拍、不回血、不給踩拍回饋 / 聲音、不影響漸強級數、不算進整串
      evt.wantedClass = '沒要求染上'; evt.feedbackKind = '沾上(光門沒要)';
      if (attr === 'shape') tutNote(g, 'shape');
      evt.detourBeforePath = Math.round(b.dragPathLen - prevActPath); evt.detourBeforeSec = r3(gtAt(g, nodeLT) - prevActGT);
      g.totals.swipeUnasked++; b.unaskedCount++; b.unaskedThisDrag++;
      var swU = emit(g, 'swipe', evt, nodeLT);
      b.pendingDetour = { rec: swU, pathAt: b.dragPathLen, gtAt: gtAt(g, nodeLT) };
      pushStickFx(g, b, 'unasked', attr, value, b.carried && g.carry ? g.carry.oldLevel : null);
      emitNode(g, b, '沒要求染上', false, nodeLT, PARAMS.beatWindowStickBeats * g.bs * 1000, stickOffsetMs(g.lvl), { isWantedAttr: false, netSeq: net ? net.seq : null });
      return 'ok';
    }
    evt.wantedClass = '光門要的'; evt.feedbackKind = '沾上(光門要的)';
    tutNote(g, attr === 'shape' ? 'shape' : 'dye');
    emit(g, 'swipe', evt, nodeLT);
    pushStickFx(g, b, 'stick', attr, value, b.carried && g.carry ? g.carry.oldLevel : null);
    b.effSwipeCount++;
    var nodeType = b.effSwipeCount === 1 ? '第一次沾上' : '第二次沾上';
    var winMs = PARAMS.beatWindowStickBeats * g.bs * 1000;
    var chk = emitNode(g, b, nodeType, true, nodeLT, winMs, stickOffsetMs(g.lvl), { isWantedAttr: true });
    if (chk.on) {
      b.beatHealTotal += PARAMS.hpBeatGain;
      heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: nodeType, tier: chk.tier }, nodeLT);
      pushBeatFx(g, b, b.x, b.y, chk.tier, true);
      tutNote(g, 'beatHeal', { bubble: b, x: b.x, y: b.y });
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
    if (lr && lr.hadCarry && lr.carryResult == null) {
      lr.carryResult = result; lr.carryResultMs = Math.round(gtAt(g, lt) * 1000);
      if (result === '碰網捕捉') { lr.carryOverflowHp = r3(g.carryOverflowHp); lr.carryOverflowPts = g.carryOverflowPts; }   // 回滿後觸發的溢出血量與換到的分數
    }
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
    tutNote(g, 'capture');       // 新手教學: 在回血與網的輪替之前記(階段 3 / 5 完成; 之後的踩拍才看得到階段 3 已完成)
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
    // 換位當下即判後備(預設關): 開啟時換位當下即判的送進網仍計次、照常判踩拍與漸強, 但不給踩拍回血 / 回饋 / 聲音, 整串成立也不給
    var fallbackActive = !!PARAMS.swapJudgeFallbackOn && method === '換位當下即判';
    var deliverChk = emitNode(g, b, '送進網', true, lt, PARAMS.beatWindowDeliverMs, deliverOffsetMs(g, g.lvl), {
      netSeq: net.seq, judgedLevel: net.level, beatLevel: g.lvl, touchMethod: method, swapJudged: method === '換位當下即判', fallbackActive: fallbackActive
    });
    if (method === '換位當下即判') {
      var dk = '送進網|L' + g.lvl;
      if (g.nodeDiffs[dk]) g.nodeDiffs[dk].swapJudged.push(g.nodeDiffs[dk].raw.length - 1);
    }
    if (deliverChk.on && !fallbackActive) {
      b.beatHealTotal += PARAMS.hpBeatGain; healDue += PARAMS.hpBeatGain;
      heal(g, b, PARAMS.hpBeatGain, 'beat', { nodeType: '送進網', tier: deliverChk.tier }, lt);
    }
    var counted = b.nodes.length;
    var onCount = b.nodes.filter(function (n) { return n.onBeat; }).length;
    var chain = counted >= 1 && onCount === counted;
    if (chain && !fallbackActive) { healDue += PARAMS.hpChainGain; heal(g, b, PARAMS.hpChainGain, 'chain', null, lt); }
    var fxX = clampNum(pos.x, 0, W), fxY = clampNum(pos.y, 0, H);
    if (deliverChk.on && !fallbackActive) {
      pushBeatFx(g, b, fxX, fxY, deliverChk.tier, false);
      tutNote(g, 'beatHeal', { x: fxX, y: fxY });
      snd('onBeat', { step: deliverChk.tier, x: fxX });
    }
    if (chain && !fallbackActive) {
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
      isChain: chain, unaskedCount: b.unaskedCount, fallbackDeducted: fallbackActive && (deliverChk.on || chain), fallbackChainDeducted: fallbackActive && chain, totalHealDue: healDue, totalHealApplied: r1(g.hp - hpStartAll), isCarried: isCarried, judgedLevel: net.level
    };
    if (!isCarried) {
      var bt = batchOf(g, b);
      noteBubbleLeave(g, b, lt, 'capture');
      if (bt && cond.shape != null) bt.rec.twoCondCaptured++;
      if (bt) { bt.rec.capturedNets++; if (net.rotations > 0) bt.rec.capturedNetsHitRotate++; }
      extra.isLastOfBatch = bt ? (bt.allSpawned && bt.leftCount >= bt.n) : null;
    }
    removeBubble(g, b);
    return { extra: extra, deliverChk: deliverChk };
  }

  // 碰網: 拖曳中的氣泡碰到亮邊的那一刻立即判定, 拖曳結束
  function resolveTouch(g, b, pos, lt, method, swapWaitMs, viaGuard) {
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
      colorMatch: b.color === cond.color, shapeMatch: cond.shape == null ? '不比對' : (b.shape === cond.shape), bubbleColor: b.color, bubbleShape: b.shape,
      netSeq: net.seq, netLevelSeq: net.levelSeq, slotId: slotObj.id, netCondition: { color: cond.color, shape: cond.shape },
      inJumpCue: inJumpCue(g), netChangedDuringDrag: !!(b.netSeqAtGrab != null && b.netSeqAtGrab !== net.seq) || !!b.jumpDuringDrag,
      isCarried: isCarried, judgedLevel: net.level, releaseAfterMs: null, viaReleaseSweep: releaseSweeping,
      viaPositionGuard: !!viaGuard,        // 這一筆是路徑式掃描漏判、由位置式保險補判的(正常應為 0, 出現就代表兩種判定不一致)
      touchGuard: g.totals.touchGuard      // RD 加: 到這一筆為止位置式保險補判的累計次數(含本筆; 正常應為 0)
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
      if (g.pendingMisreadRecs.length) { g.pendingMisreadRecs.forEach(function (pm) { pm.rec.afterExecToCaptureSec = r3(gnow - pm.execGT); }); g.pendingMisreadRecs = []; crec.afterMisreadSwapFirstCapture = true; }
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
    if (!isCarried) noteMisread(g, 'bounce', lt);
    emitNode(g, b, '條件不符碰網', false, lt, PARAMS.beatWindowDeliverMs, deliverOffsetMs(g, g.lvl), { netSeq: net.seq, judgedLevel: net.level, touchMethod: method });
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
    var sure = !(a < BAND_IN - BUBBLE_R);   // 電腦 268
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
    var sbt = batchOf(g, b); if (sbt) { sbt.rec.suspects++; if (sure) sbt.rec.suspectsSure++; }
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

  // 系統事件強制結果(視窗外放開 / 失焦 / Esc 暫停): 一律「內圈外」彈回, 走獨立路徑, 不看座標
  function forceBounce(g, b, reason, lt) {
    b.dragPathTotal += b.dragPathLen;
    dragEndEvent(g, b, reason, lt);
    var px = b.x, py = b.y;
    if (!b.carried) g.totals.bounceOuter++;
    if (reason === '視窗外放開') checkSuspect(g, b, px, py, { x: mouse.x, y: mouse.y }, lt);   // 失焦與 Esc 暫停不在嫌疑定義內
    emitDrop(g, b, lt, { category: reason === '失焦' ? '失焦' : (reason === 'Esc 暫停' ? 'Esc 暫停' : '視窗外'), outcome: b.carried ? '帶過的那一顆清掉' : '彈回內圈', px: px, py: py, onUi: false, pointerSource: '系統事件' });
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
      if (d <= G.grabR && d < bestD) { best = b; bestD = d; }   // 抓取半徑(電腦 20 = 氣泡半徑, 觸控 40); 多顆取最近
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
      tutNote(g, 'grab', { x: b.x, y: b.y });
      var gnow = gtAt(g, lt);
      b.dragPathLen = 0; b.lockedSameThis = 0; b.lockedDiffThis = 0; b.touchedDarkThisDrag = 0; b.jumpDuringDrag = false; b.darkSince = {};
      b.netSeqAtGrab = g.net ? g.net.seq : null;
      b.dragLastSwipePathLen = null; b.dragLastSwipeGT = null; b.pathHistory = [];
      b.dragLastActionPath = 0; b.dragLastActionGT = gnow; b.pendingDetour = null; b.unaskedThisDrag = 0;
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
    var rec = emit(g, 'pause', { startRealMs: Date.now() - g.startWall, endRealMs: null, reason: reason === 'blur' ? '失焦' : (reason === 'esc' ? 'Esc' : '按鈕'), atSeg: segLabel(g) });
    g.openPauseRecord = rec;
    screen = SCREEN.PAUSED;
    confirmKind = null;
    mouse.btn = false;
    try { Sound.pauseMusic(); } catch (e) { logErr(e); }
  }
  function endPauseRecord(g) {
    var rec = g.openPauseRecord;
    if (!rec) return;
    rec.endRealMs = Date.now() - g.startWall;
    var ms = rec.endRealMs - rec.startRealMs;
    g.pauseRealMs += ms;
    g.openPauseRecord = null;
  }
  function resumePause(g) {
    if (!g.paused) return;
    g.paused = false;
    endPauseRecord(g);
    confirmKind = null;
    screen = SCREEN.PLAYING;
    try { Sound.resumeMusic(g.lt / g.bs); } catch (e) { logErr(e); }
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
    if (g.wave.cur) g.wave.cur.rec.rotations++;
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
    // 看錯保底(第 2 關: 成立後的下一次跳位那一刻位置與條件一起換; 與卡住同時成立只執行卡住; 拖曳中氣泡已沾上的屬性全符合舊網 → 延後到下一次跳位)
    var misreadExec = false;
    if (net.misread && net.misread.pending) {
      if (stuckNow) cancelMisread(g, '讓給卡住', net);
      else if (misreadDeferNow(g)) { net.misread.deferrals++; net.misread.rec.deferrals = net.misread.deferrals; g.totals.misreadDeferrals++; }
      else misreadExec = true;
    }
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
    } else if (misreadExec) {
      execMisread(g, net, k, to);
      rec.conditionChanged = true; rec.newCondition = { color: g.net.cond.color, shape: g.net.cond.shape }; rec.byMisread = true;
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
    // 看錯保底: 本關到達關末 → 取消(第 1、2 關)
    var eb = LEVELS[g.lvl].endBeat;
    if (eb != null && k >= eb && g.net && g.net.misread && g.net.misread.pending) cancelMisread(g, '關末', g.net);
    if (!g.curBack && k >= pb) segmentSwitch(g);
    if (g.lvl === 3) {
      // 輪轉: 第 8、16、24、… 拍, 關末拍(過關)本身不轉也不預告; 預告 = 輪轉前 3 拍
      var kr = k + PARAMS.rotatePreviewBeats;
      if (kr % PARAMS.rotateEveryBeats === 0 && kr >= PARAMS.rotateEveryBeats && kr < eb) startRotatePreview(g, kr);
      if (k >= PARAMS.rotateEveryBeats && k % PARAMS.rotateEveryBeats === 0 && k < eb) doRotate(g, k);
    } else if (isJumpLvl(g.lvl)) {
      // 跳位: 第 8、16、…、152 拍(第 160 拍關末不跳, 第 159 拍不預告); 預告 = 跳位前 1 拍
      var kj = k + PARAMS.jumpPreviewBeats;
      if (kj % PARAMS.jumpEveryBeats === 0 && kj >= PARAMS.jumpEveryBeats && kj <= PARAMS.jumpLastBeat) startJumpPreview(g, kj);
      if (k >= PARAMS.jumpEveryBeats && k % PARAMS.jumpEveryBeats === 0 && k <= PARAMS.jumpLastBeat) doJump(g, k);
    }
    if (!isJumpLvl(g.lvl) && !g.endFrame && g.stuck && g.stuck.scheduledBeat != null && k >= g.stuck.scheduledBeat) autoSwapNow(g, k);
    // 到時的看錯保底(第 1、3 關; 第 2 關併入跳位): 排在自動換位之後, 與卡住同時成立時讓給卡住
    if (!isJumpLvl(g.lvl) && !g.endFrame && g.net && g.net.misread && g.net.misread.pending && k >= g.net.misread.scheduledBeat) misreadSwapNow(g, k);
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
      var sched = !isJumpLvl(g.lvl) ? Math.floor(beat + 1e-9) + PARAMS.autoSwapBeatPoint : (Math.floor(beat / PARAMS.jumpEveryBeats + 1e-9) + 1) * PARAMS.jumpEveryBeats;
      g.stuck = {
        seq: g.stuckSeq, batchSeq: g.batchSeq, startGT: g.gt, startLT: g.lt, cause: g.stuckHint, countAtStart: cnt, bubbles: stuckBubbleList(g),
        netSeq: g.net.seq, condition: { color: g.net.cond.color, shape: g.net.cond.shape }, scheduledBeat: !isJumpLvl(g.lvl) ? sched : null, nextJumpBeat: isJumpLvl(g.lvl) ? sched : null,
        startedAfterLastJump: isJumpLvl(g.lvl) ? beat >= PARAMS.jumpLastBeat : null,
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
    if (g.net) cancelMisread(g, '換關', g.net);
    var w = g.wave;
    g.totals.levelSwitches++;
    var lr = {
      type: 'levelSwitch', gameId: g.id, t: gtMs(g), surv: survMs(g), level: oldLvl, seg: '後段', fromLevel: oldLvl, toLevel: newLvl,
      newMusic: LEVELS[newLvl].music, newMusicTitle: LEVELS[newLvl].title, newBpm: LEVELS[newLvl].bpm, newLevelSec: r3(LEVELS[newLvl].levelSec), newFeature: LEVELS[newLvl].feature, endGTms: gtMs(g), endSurvMs: survMs(g), endRealMs: Date.now() - g.startWall,
      hpBefore: r1(g.hp), score: g.score, combo: g.combo, danger: g.danger, waveStateAtEnd: waveStateName(g), stuckAtEnd: !!g.stuck,
      clearedCount: 0, clearedSatisfiable: { 可滿足: 0, 不能滿足: 0 }, clearedHoldNoDrag: 0, clearedRemainLife: [], processableAtEnd: processableCount(g),
      cancelledBatch: w.cur && w.cur.rec.nextBatchCancelled ? { had: true, originalBeat: w.cur.rec.cancelledOriginalBeat } : { had: !!(w.nextStartBeat != null), originalBeat: w.nextStartBeat },
      discardedGuarantee: g.pendingGuarantee ? { kind: g.pendingGuarantee.kind, value: g.pendingGuarantee.value } : null,
      hadCarry: false, carryMatchedOldNet: null, carryResult: null, carryResultMs: null, carryOverflowHp: null, carryOverflowPts: null, hpAfterRefill: null,
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
    // 血量回滿(spec v18「換關」第 2 步與「血量回滿的時刻」): 在關末那一幀血量結算(同一幀處理順序第 4 步)之後、清掉場上氣泡之後、預備拍之前; 關末幀血量歸零 → 局結束, 根本不會走到這裡。
    // 回滿不是回血: 不算溢出、不換分數、不改連續數、不進回血事件與每秒回血 / 淨血 / 收支; 回滿當下若在危險狀態立即解除(旗標在本幀最後一步依回滿後的血量判, 見 tick 第 8 步)
    var hpBeforeRefill = g.hp, dangerBeforeRefill = !!g.danger;
    var refillAmount = PARAMS.hpMax - hpBeforeRefill;
    g.hp = PARAMS.hpMax;
    g.refillSeq++; g.refillTotal += refillAmount;
    pushHpFx(g, hpBeforeRefill, g.hp, 'catch');          // 血量環上看得出回到整圈(增加的那一段, 加上傳 hp = 100 的整圈)
    if (!g.everFull) { g.everFull = true; g.firstFullSurv = g.surv; g.firstFullByRefill = true; }
    g.wasFull = true; g.fullKind = '回滿造成';           // 換關回滿後也算滿血
    noteHp80(g);
    g.carryOverflowHp = 0; g.carryOverflowPts = 0;
    if (newLvl === 3) g.l3Hp = { peak: PARAMS.hpMax, peakSec: 0, lastNearPeakSec: 0 };
    lr.hpAfterRefill = g.hp;
    emit(g, 'levelRefill', {
      fromLevel: oldLvl, toLevel: newLvl, gameMs: gtMs(g), survMs: survMs(g), refillSeq: g.refillSeq,
      hpBefore: r1(hpBeforeRefill), refillAmount: r1(refillAmount), dangerBefore: dangerBeforeRefill, releasedDanger: dangerBeforeRefill
    });
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
    if (window.PVDX) PVDX.levelClear(oldLvl);   // 單關通關: 過了舊的那關(換關每次只走一次)
    g.levelEnterSurv[newLvl] = g.surv;
    enterLevelStats(g, newLvl);
    // 5. 音樂與提示音(順序: 換關 → 新歌 → 預備拍第 −4 拍)
    snd('stageChange');
    try { Sound.playMusic(LEVELS[newLvl].music, { beat: g.lt / g.bs }); } catch (e) { logErr(e); }
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
    g.sampleCount++;
    g.hpCurve.push({ t: gtMs(g), surv: survMs(g), hp: r1(g.hp) });
    var driftMs = g.lastDrift == null ? null : Math.round(g.lastDrift * 1000);
    if (driftMs != null) g.musicDrift[g.lvl].push(driftMs);
    var net = g.net;
    emit(g, 'sample', {
      countOnField: fieldCount(g), hp: r1(g.hp), danger: g.danger, secDrain: r3(g.secDrain), secHeal: { catch: r3(g.secHeal.catch), beat: r3(g.secHeal.beat), chain: r3(g.secHeal.chain) },
      secMiss: r3(g.secMiss), secExpire: r3(g.secExpire), secOverflow: r3(g.secOverflow), secNet: r3(g.secHeal.catch + g.secHeal.beat + g.secHeal.chain - g.secDrain - g.secMiss - g.secExpire), secFull: g.secFull || g.hp >= 99.9,
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
    g.stickFxs = g.stickFxs.filter(function (f) { f.t += dt; return f.t < (f.kind === 'unasked' ? Art.timing.unaskedFx : Art.timing.stickFx) && !f.bubble.dead; });
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
      if (typeof d === 'number') {
        g.lastDrift = d;
        if (g.lvl === 2) { var bt0 = g.lt / g.bs; if (bt0 >= -4 && bt0 < 0) g.l2Drift.song.push(d * 1000); else if (bt0 >= 0 && bt0 < 4) g.l2Drift.level.push(d * 1000); }
        var ad = Math.abs(d);
        if (ad > g.driftMaxAbs[g.lvl]) g.driftMaxAbs[g.lvl] = ad;
        if (ad > 0.04) g.resync[g.lvl]++;      // sound.js 的容許值 0.04 秒: 超過就對回時鐘(對回次數)
      }
    } catch (e) { logErr(e); }
  }

  // ==================================================================
  // 主更新(一幀)。順序見 spec「同一幀的處理順序」
  // ==================================================================
  function tick(dt, rafTs) {
    var g0 = game;
    tickCore(dt, rafTs);
    if (g0 && game === g0) { try { tutUpdate(g0, dt); } catch (e) { if (window.console) console.error(e); } }
  }
  function tickCore(dt, rafTs) {
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
    var endBeat = LEVELS[g.lvl].endBeat;
    var endT = endBeat != null ? endBeat * g.bs : Infinity;
    g.endFrame = g.lt >= endT - 1e-9;
    // 關末那一幀(spec v18「血量回滿的時刻」): 持續扣血、存活時間與壽命只算到關末時刻, 該幀超過關末的時間屬預備拍, 不扣不計(超出的時間由 changeLevel 接進新關預備拍)
    g.endOvershoot = g.endFrame ? Math.max(0, g.lt - endT) : 0;
    if (g.endFrame) dtPlay = Math.max(0, dtPlay - g.endOvershoot);
    g.surv += dtPlay;
    syncMusicNow(g);
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
    g.drainTotal += drained; g.secDrain += drained; g.levelStats[g.lvl].drain += drained; segAcc(g).drain += drained;
    var drainKilled = hpB > 0 && g.hp <= 0;
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
    if (fullNow && !g.wasFull) g.fullKind = '自己回到滿';             // 這段滿血從回血使血量達上限開始(換關回滿開始的在 changeLevel 標「回滿造成」)
    if (g.wasFull && !fullNow) { g.lastFullToNot = { surv: g.surv, key: segKey, lvSec: g.lvl === 3 ? g.lt : null, field: fieldCount(g), kind: g.fullKind }; }
    if (fullNow) { g.everFull = true; if (g.firstFullSurv == null) { g.firstFullSurv = g.surv; g.firstFullByRefill = false; } g.fullSecBySeg[segKey] = (g.fullSecBySeg[segKey] || 0) + dtPlay; g.secFull = true; }
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
      updateDanger(g, true);
      endGame('hpZero');
      return;
    }

    noteHp80(g);
    if (g.lvl === 3) trackL3Hp(g);
    // 5. 波次: 判本批是否清完(清完則排定下一批), 本幀到時的出批 / 冒出照常執行
    if (!g.endFrame) checkBatchCleared(g);
    advanceWave(g, endT);
    // 6. 卡住判定(關末那幀跳過)
    if (!g.endFrame) { updateStuck(g); updateMisread(g); }
    // 總量核對: 同一時刻場上屬於 2 批以上(換關帶過的那一顆除外, 應為 0)
    (function () { var seq = null; for (var mi2 = 0; mi2 < g.bubbles.length; mi2++) { var mb = g.bubbles[mi2]; if (mb.carried) continue; if (seq == null) seq = mb.batchSeq; else if (mb.batchSeq !== seq) { g.multiBatchFrames++; return; } } })();

    g.sampleAcc += dtPlay;
    var guard = 0;
    while (g.sampleAcc >= PARAMS.sampleIntervalSec && guard < 10) { g.sampleAcc -= PARAMS.sampleIntervalSec; emitSample(g); guard++; }

    // 7. 換關(含血量回滿, 在關末那一幀血量結算之後); 第 3 關關末 = 過關, 這局結束
    if (g.endFrame) {
      if (g.lvl < 3) changeLevel(g);
      else { endGame('cleared'); return; }
    }
    // 8. 危險狀態: 以本幀第 1~7 步(含換關回滿)全部完成後的血量判進入 / 解除, 每幀只判一次
    updateDanger(g);
  }

  // ==================================================================
  // 跨局紀錄(只供「送進網補償」用: 局首依本機最近 2 個血量歸零局的送進網原始時間差中心判定)
  // ==================================================================
  function loadHistory() {
    try { var h = JSON.parse(lsGetMig(HISTORY_KEY, LS_V19) || '[]'); return Array.isArray(h) ? h : []; } catch (e) { logErr(e, '讀取跨局紀錄'); return []; }
  }
  function saveHistory(h) { lsSet(HISTORY_KEY, JSON.stringify(h.slice(-300))); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function segAcc(g) {
    var k = segKeyNow(g);
    return g.segAcc[k] || (g.segAcc[k] = { heal: { catch: 0, beat: 0, chain: 0 }, overflow: 0, drain: 0, miss: 0, expire: 0 });
  }
  // 局結束: 記下各關送進網計次節點(不含換位當下即判)的原始時間差中位數, 下一局的補償判定讀它
  function saveDeliverHistory(g, endReason) {
    try {
      var raws = { 1: [], 2: [], 3: [] };
      byType(g.events, 'node').forEach(function (n) { if (n.nodeType === '送進網' && n.counted && !n.swapJudged && raws[n.level]) raws[n.level].push(n.rawDiffMs); });
      var hr = { gameIndex: g.gameIndex, sessionIndex: g.sessionIndex, build: BUILD_VERSION, hpZero: endReason === 'hpZero', deliverRawMedian: { 1: median(raws[1]), 2: median(raws[2]), 3: median(raws[3]) } };
      saveHistory(loadHistory().filter(function (h) { return !(h.gameIndex === hr.gameIndex && h.sessionIndex === hr.sessionIndex && h.build === BUILD_VERSION); }).concat([hr]));
    } catch (e) { logErr(e, '跨局紀錄'); }
  }

  function endGame(reason) {
    var g = game;
    if (!g || g.done) return;
    g.done = true;
    confirmKind = null;
    if (reason === 'hpZero') {
      var uq = uniqArr(g.pendingDeathReasons);
      if (uq.length === 0) uq = ['持續扣血'];
      g.deathReasons = uq;
    } else if (reason === 'restart') g.deathReasons = ['重開'];
    else if (reason === 'quit') g.deathReasons = ['放棄'];
    else if (reason === 'cleared') g.deathReasons = ['過關'];
    else g.deathReasons = [reason];
    try { Sound.stopMusic(); } catch (e) { logErr(e); }
    if (reason === 'cleared') snd('stageChange');
    saveDeliverHistory(g, reason);
    endInfo = { time: g.surv, score: g.score, cleared: reason === 'cleared', wall0: Date.now() };
    if (window.PVDX && reason === 'cleared') { PVDX.levelClear(3); PVDX.gameClear(); }   // 過完第 3 關: 單關通關 3 + 全局通關; 死掉、重開、放棄都不送
    inputQueue = []; mouse.btn = false; mouse.press = null;
    if (reason === 'restart') { startNewGame(); }
    else { screen = SCREEN.END; }
  }
  function startNewGame() {
    var idx = nextGameIndex();
    mouse.press = null; mouse.lastDropPos = null; mouse.netSeqAtLastDrop = null; mouse.pathSinceDrop = 0; mouse.btn = false;
    confirmKind = null;
    inputQueue = [];
    game = createGame(idx);
    tutNewRun(game);
    endInfo = null;
    screen = SCREEN.PLAYING;
    try { Sound.playMusic(LEVELS[1].music, { beat: game.lt / game.bs }); } catch (e) { logErr(e); }
  }

  // ==================================================================
  // 新手教學(spec v20「新手教學」): 嵌在遊戲裡, 不暫停、不按下一步; 玩家做到才算完成。畫面一律交 Art.drawTutorial, 這裡只管狀態與錨點
  //   已完成階段存在 TUT.done(這次開網頁期間有效, 再玩 / 重開不重置, 不存本機); 每局的顯示狀態存在 TUT.run(新局重置)
  //   計時(0.5 秒起點、12 秒收起、完成後隔 0.5 秒、階段 7 的 2.5 秒)只在遊玩中(phase = playing)走; 暫停時 tick 不跑所以自然凍結; 完成特效(0.8 秒)在預備拍照播完
  // ==================================================================
  var TUT_DEFS = {
    grab: { text: '按住氣泡拖著走', icon: 'press', line: 'main' },
    dye: { text: '擦過顏色一樣的染色區', icon: null, line: 'main' },
    gate: { text: '碰到亮著的光門', icon: null, line: 'main' },
    hold: { text: '抓著的氣泡不會消失', icon: 'press', line: 'cond' },
    wrong: { text: '染到光門不要的, 氣泡會消失', icon: null, line: 'cond' },
    heal: { text: '送進光門、對上拍子能補血量', icon: null, line: 'cond' },
    beat: { text: '對上拍子了! 血量補回來了', icon: null, line: 'cond' },
    shape: { text: '光門要形狀時, 拖過形狀區變形', icon: null, line: 'shape' }
  };
  var TUT_MAIN = ['grab', 'dye', 'gate'];
  var TUT_COND = ['hold', 'wrong', 'heal', 'beat'];
  var TUT = { done: {}, run: null };

  // ---- 標示(mark): 被標示物件的判定幾何。格式集中在這幾個函式, 之後照 style.md 對齊只改這裡 ----
  function tutMarkFloor(x, y, r) { return { kind: 'floor', x: x, y: y, r: r }; }
  function tutMarkGate(s) { return { kind: 'gate', slot: s.no }; }
  function tutHpTop() { return (L.hpTop) || { x: CX, y: CY - ((Art.geometry && Art.geometry.hpRingRadius) || 221) }; }
  function tutMarkRing() { return { kind: 'hpRing' }; }

  function tutNewRun(g) {
    TUT.run = { gameId: g.id, cur: null, susp: null, fx: null, gap: 0, pend: { hold: false, wrong: null, heal: false, beat: null }, healLatched: false };
  }
  function tutActive(r, id) { return !!((r.cur && r.cur.id === id) || (r.susp && r.susp.id === id)); }

  // 錨點(每幀依當下狀態重算, 錨點是氣泡 / 光門 / 地板時跟著走); 找不到回 null(這幀不畫泡泡)
  function tutAnchor(g, c) {
    var id = c.id, i, b, best = null, d, fl, s;
    if (id === 'grab') {
      for (i = 0; i < g.bubbles.length; i++) {
        b = g.bubbles[i];
        if (b.mode !== 'idle' || b.color != null || b.carried) continue;
        d = dist(b.x, b.y, CX, CY);
        if (!best || d < best.d) best = { b: b, d: d };
      }
      return best ? { x: best.b.x, y: best.b.y, mark: null } : null;
    }
    if (id === 'hold') {
      for (i = 0; i < g.bubbles.length; i++) {
        b = g.bubbles[i];
        if ((b.mode !== 'idle' && b.mode !== 'return') || b.carried) continue;
        if (!best || b.life < best.b.life) best = { b: b };
      }
      return best ? { x: best.b.x, y: best.b.y, mark: null } : null;
    }
    if (id === 'dye') {
      if (!g.net) return null;
      fl = floorList(g, false);
      for (i = 0; i < fl.length; i++) if (fl[i].kind === 'dye' && fl[i].color === g.net.cond.color) return { x: fl[i].x, y: fl[i].y, mark: tutMarkFloor(fl[i].x, fl[i].y, fl[i].r) };
      return null;
    }
    if (id === 'gate') {
      if (!g.net) return null;
      s = slotByNo(g.net.slot);
      var gin = (Art.geom && Art.geom.touch && L.slots && L.slots[s.no - 1] && L.slots[s.no - 1].inner) || s;   // 觸控: 判定帶內緣中點; 電腦版維持原錨點(網牆邊心)
      return { x: gin.x, y: gin.y, mark: tutMarkGate(s) };
    }
    if (id === 'wrong') {
      if (!c.fixed) return null;
      return { x: c.fixed.x, y: c.fixed.y, mark: g.net ? tutMarkGate(slotByNo(g.net.slot)) : null };
    }
    if (id === 'heal') return { x: tutHpTop().x, y: tutHpTop().y, mark: tutMarkRing() };
    if (id === 'beat') {
      if (!c.fixed) return null;
      if (c.fixed.bubble && !c.fixed.bubble.dead) return { x: c.fixed.bubble.x, y: c.fixed.bubble.y, mark: null };
      return { x: c.fixed.x, y: c.fixed.y, mark: null };
    }
    if (id === 'shape') {
      if (g.lvl !== 2) return null;
      fl = floorList(g, false);
      for (i = 0; i < fl.length; i++) if (fl[i].kind === 'shape' && fl[i].shape === 'square') return { x: fl[i].x, y: fl[i].y, mark: tutMarkFloor(fl[i].x, fl[i].y, fl[i].r) };
      return null;
    }
    return null;
  }

  function tutShow(g, id) {
    var r = TUT.run, c = { id: id, appearT: 0, shownT: 0, fixed: null };
    if (id === 'wrong') { c.fixed = r.pend.wrong; r.pend.wrong = null; }
    else if (id === 'beat') { c.fixed = r.pend.beat; r.pend.beat = null; }
    else if (id === 'hold') r.pend.hold = false;
    else if (id === 'heal') r.pend.heal = false;
    r.cur = c;
    emit(g, 'tutorial_show', { stage: id, sinceStart: r3(g.gt + PARAMS.countInBeats * LEVELS[1].beatSec), level: g.lvl });
    snd('tutorialShow');
  }
  function tutComplete(g, d) {
    var r = TUT.run, c = r.cur;
    if (!c) return;
    var a = tutAnchor(g, c), x = CX, y = CY;
    if (d && d.x != null && (c.id === 'grab' || c.id === 'hold')) { x = d.x; y = d.y; }      // 抓起類: 特效播在被抓起的那顆上
    else if (a) { x = a.x; y = a.y; }
    TUT.done[c.id] = true; g.tutDone.push(c.id);
    emit(g, 'tutorial_done', { stage: c.id, shownFor: r3(c.shownT), level: g.lvl });
    r.sndDone = true;       // 完成音留到本幀最後再播(同一刻有捕捉 / 踩拍時, 先響遊戲回饋音、再響 tutorialDone)
    r.fx = { id: c.id, t: 0, x: x, y: y, mark: a ? a.mark : null, level: g.lvl };
    r.cur = null;
  }
  function tutMainReady(g, id) {
    if (id === 'grab') return g.lvl > 1 || g.lt >= PARAMS.tutorial.grabStartSec;      // 第 1 關第 0 拍後 0.5 秒(第一批已出現)
    return true;                                                                      // 階段 2 / 3: 前一階段完成後(依序進行)
  }

  // 遊戲事件進來: 記下條件式階段的觸發、判斷目前顯示中的階段是否完成。只在遊玩中判完成
  function tutNote(g, kind, d) {
    var r = TUT.run;
    if (!r || !g || r.gameId !== g.id || g.done) return;
    var D = TUT.done, pn = r.pend;
    if (kind === 'expire') { if (D.grab && !D.hold && !tutActive(r, 'hold')) pn.hold = true; }
    else if (kind === 'wrong') { if (!D.wrong && !tutActive(r, 'wrong')) pn.wrong = { x: d.x, y: d.y }; }
    else if (kind === 'beatHeal') { if (D.gate && !D.beat && !tutActive(r, 'beat')) pn.beat = { bubble: d.bubble || null, x: d.x, y: d.y }; }
    var c = r.cur;
    if (!c || g.phase !== 'playing') return;
    var ok = (c.id === 'grab' && kind === 'grab') || (c.id === 'hold' && kind === 'grab') || (c.id === 'dye' && kind === 'dye') ||
      (c.id === 'gate' && kind === 'capture') || (c.id === 'wrong' && kind === 'capture') || (c.id === 'heal' && kind === 'heal') || (c.id === 'shape' && kind === 'shape');
    if (ok) tutComplete(g, d);
  }

  // 每幀更新(在遊戲本幀之後)
  function tutUpdate(g, dt) {
    var r = TUT.run, T = PARAMS.tutorial, D = TUT.done;
    if (!r || r.gameId !== g.id || g.done) return;
    if (r.sndDone) { r.sndDone = false; snd('tutorialDone'); }
    if (r.fx) { r.fx.t += dt; if (r.fx.t >= T.doneSec) { r.fx = null; r.gap = T.gapSec; } }      // 完成特效 0.8 秒, 之後隔 0.5 秒才輪到下一個
    if (r.cur && r.cur.id === 'shape' && g.lvl !== 2) r.cur = null;                              // 階段 8 只在第 2 關; 離開第 2 關還沒完成就收掉(不記收起事件)
    if (g.phase !== 'playing') return;                                                           // 預備拍 / 換關預備拍: 不出新泡泡, 計時凍結
    if (r.gap > 0) r.gap -= dt;
    // 階段 6 的條件: 階段 3 完成後, 血量低於上限的 50%(進入條件的那一刻; 回到 50% 以上才會再成立)
    if (!(g.hp < PARAMS.hpMax * T.hpLowFrac)) r.healLatched = false;
    else if (D.gate && !D.heal && !r.healLatched) { r.healLatched = true; if (!tutActive(r, 'heal')) r.pend.heal = true; }
    // 階段 8: 第 2 關第 0 拍後(方形狀區生效)一出現就蓋過其他提示(其他提示暫藏、進度保留); 正在播的完成特效先播完, 不看完成後的 0.5 秒間隔
    if (!D.shape && g.lvl === 2 && !r.fx && !(r.cur && r.cur.id === 'shape')) {
      if (r.cur) { r.susp = r.cur; r.cur = null; }
      tutShow(g, 'shape');
    }
    var c = r.cur;
    if (c) {
      c.appearT += dt; c.shownT += dt;
      if (c.id === 'beat' && c.shownT >= T.beatAutoSec) tutComplete(g, null);                    // 階段 7: 出現 2.5 秒自動完成
      else if (TUT_DEFS[c.id].line === 'cond' && c.shownT >= T.hideSec) {                         // 條件式: 12 秒內沒完成就收起, 條件下次再成立時再出現
        emit(g, 'tutorial_hide', { stage: c.id, level: g.lvl });
        r.cur = null;
      }
    }
    if (!r.cur && !r.fx && r.gap <= 0) {
      if (r.susp) { r.cur = r.susp; r.susp = null; r.cur.appearT = 0; return; }                  // 階段 8 完成後回到被蓋過的提示(重新彈出, 不重記出現事件)
      var next = null, i;
      for (i = 0; i < TUT_MAIN.length; i++) { if (!D[TUT_MAIN[i]]) { if (tutMainReady(g, TUT_MAIN[i])) next = TUT_MAIN[i]; break; } }   // 主線依序: 前一階段完成才輪到下一個
      if (!next) for (i = 0; i < TUT_COND.length; i++) { var id = TUT_COND[i]; if (!D[id] && r.pend[id]) { next = id; break; } }                // 條件式不插隊: 主線有階段在等 / 在顯示時排在後面
      if (next) tutShow(g, next);
    }
  }

  // 給 Art.drawTutorial 的 state; 沒有東西要畫回 null。完成特效在預備拍照播; 結束畫面不畫
  function tutDrawState(g) {
    var r = TUT.run, T = PARAMS.tutorial, def;
    if (!r || r.gameId !== g.id || screen === SCREEN.END) return null;
    if (r.fx) {
      def = TUT_DEFS[r.fx.id];
      return { stage: r.fx.id, text: def.text, icon: def.icon, x: r.fx.x, y: r.fx.y, mark: r.fx.mark, appear: 1, done: Math.max(1e-4, clamp01(r.fx.t / T.doneSec)), level: r.fx.level, time: animT, litSlot: g.net ? g.net.slot : 0 };
    }
    if (r.cur && g.phase === 'playing') {
      var a = tutAnchor(g, r.cur);
      if (!a) return null;
      def = TUT_DEFS[r.cur.id];
      return { stage: r.cur.id, text: def.text, icon: def.icon, x: a.x, y: a.y, mark: a.mark, appear: clamp01(r.cur.appearT / T.appearSec), done: 0, level: g.lvl, time: animT, litSlot: g.net ? g.net.slot : 0 };
    }
    return null;
  }

  // ==================================================================
  // UI 命中與動作
  // ==================================================================
  // v26: 開始畫面沒有按鈕, 點畫面任一處(靜音按鈕除外, 由呼叫端先判斷)就開始
  function titleLocate(p) {
    return inCanvasPos(p) ? 'start' : null;
  }
  function pauseMenuLocate(p) {
    var m = L.pauseMenu;
    if (inRect(p.x, p.y, m.resume)) return 'resume';
    if (inRect(p.x, p.y, m.restart)) return 'restart';
    if (inRect(p.x, p.y, m.quit)) return 'quit';
    return null;
  }
  // 過關畫面(v24 方案 C): 「再玩一次」在過關後第幾秒出現; 出現前按不到, 過關畫面沒有回標題
  var CLEAR_BTN_SEC = 2.2;
  function endClearT() { return endInfo && endInfo.cleared ? (Date.now() - endInfo.wall0) / 1000 : null; }
  function endLocate(p) {
    var ct = endClearT();
    if (ct != null) return (ct >= CLEAR_BTN_SEC && inRect(p.x, p.y, L.gameOver.againClear)) ? 'again' : null;
    if (inRect(p.x, p.y, L.gameOver.again)) return 'again';
    if (inRect(p.x, p.y, L.gameOver.title)) return 'title';
    return null;
  }
  function pauseBtnLocate(p) { return inRect(p.x, p.y, L.pauseBtn); }
  // 靜音按鈕: 開始與結束畫面在最角落(muteBtnCorner), 遊戲中 / 暫停 / 確認面板在暫停按鈕正下方(muteBtn)
  function muteBtnLocate(p) { if (window.PVDX && PVDX.on) return false; return inRect(p.x, p.y, (screen === SCREEN.TITLE || screen === SCREEN.END) ? L.muteBtnCorner : L.muteBtn); }
  function confirmLocate(p) {
    if (inRect(p.x, p.y, L.confirm.yes)) return 'yes';
    if (inRect(p.x, p.y, L.confirm.no)) return 'no';
    return null;
  }
  function pausedLocate(p) { return confirmKind ? confirmLocate(p) : pauseMenuLocate(p); }

  function doTitleAction(key) {
    if (key === 'start') startNewGame();
  }
  // 暫停畫面上的按鈕: 暫停選單(繼續 / 重開 / 放棄)或確認面板(確定 / 取消)。重開與放棄的紀錄與死因都在「確定」那一刻才發生
  function doPauseMenuAction(key) {
    var g = game;
    if (confirmKind) {
      var kind = confirmKind;
      confirmKind = null;
      if (key === 'yes') endGame(kind);
      else hov.pauseMenu = pauseMenuLocate(mouse);
      return;
    }
    if (key === 'resume') resumePause(g);
    else if (key === 'restart' || key === 'quit') { confirmKind = key; hov.confirm = confirmLocate(mouse); }
  }
  function doEndAction(key) {
    if (key === 'again') startNewGame();
    else if (key === 'title') screen = SCREEN.TITLE;
  }

  // ==================================================================
  // 滑鼠事件(遊戲動作唯一輸入); 鍵盤只掛 Esc(暫停 / 繼續 / 取消確認)與開始畫面的「任意鍵開始」(v26), 不掛觸控事件(觸控由 touch.js 轉成滑鼠事件)
  // ==================================================================
  function logicalPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (CW / rect.width) - OX, y: (e.clientY - rect.top) * (H / rect.height) };
  }
  function inCanvasPos(p) { return p.x >= -OX && p.x < W + OX && p.y >= 0 && p.y < H; }   // 整個畫布(觸控寬畫面兩側有 HUD; 電腦 OX = 0 等於設計區)

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
      else mouse.uiDownKey = pausedLocate(p);
    } else if (screen === SCREEN.TITLE) {
      mouse.uiDownKey = muteBtnLocate(p) ? 'mute' : titleLocate(p);
    } else if (screen === SCREEN.END) mouse.uiDownKey = muteBtnLocate(p) ? 'mute' : endLocate(p);
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('mousemove', function (e) {
    var p = logicalPos(e);
    var px0 = mouse.x, py0 = mouse.y;
    mouse.x = p.x; mouse.y = p.y;
    var inside = inCanvasPos(p);
    mouse.inside = inside;
    if (screen === SCREEN.TITLE) hov.title = inside ? titleLocate(p) : null;
    else if (screen === SCREEN.PLAYING) {
      hov.pauseBtn = inside && pauseBtnLocate(p); hov.muteBtn = inside && muteBtnLocate(p);
      mouse.pathSinceDrop += dist(px0, py0, p.x, p.y);
      if (game && !game.paused) {
        if (mouse.btn && inputQueue.length < 4000) inputQueue.push({ k: 'move', x: p.x, y: p.y, ts: e.timeStamp });
        var gm = game;
        if (gm.net && !gm.netFirstPressDone && gm.phase === 'playing' && dist(p.x, p.y, CX, CY) > INNER_R && sectorOf(p.x, p.y) === gm.net.slot) gm.netApproached = true;
      }
    } else if (screen === SCREEN.PAUSED) {
      hov.pauseMenu = (inside && !confirmKind) ? pauseMenuLocate(p) : null;
      hov.confirm = (inside && confirmKind) ? confirmLocate(p) : null;
    }
    else if (screen === SCREEN.END) hov.end = inside ? endLocate(p) : null;
    if (screen !== SCREEN.PLAYING) hov.muteBtn = inside && muteBtnLocate(p);
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
    if (key === 'mute') { if (muteBtnLocate(p)) toggleMute(); return; }
    if (screen === SCREEN.PAUSED) {
      if (pausedLocate(p) === key) doPauseMenuAction(key);
    } else if (screen === SCREEN.TITLE) {
      if (titleLocate(p) === key) doTitleAction(key);
    } else if (screen === SCREEN.END) {
      if (endLocate(p) === key) doEndAction(key);
    }
  });

  // 視窗失去焦點: 拖曳中立刻視為在內圈外放開彈回(獨立路徑, 不看座標); 按住未拖比照放開; 接著自動暫停
  // 失焦與 Esc 共用: 拖曳中 → 獨立路徑彈回(結束方式與放下記該原因); 按住未拖 → 比照放開; 然後開暫停選單
  function interruptToPause(why) {
    var g = game;
    drainInputsNow(g);
    if (mouse.press) {
      var hb = mouse.press.bubble;
      if (hb && !hb.dead) {
        if (mouse.press.dragging) forceBounce(g, hb, why === 'esc' ? 'Esc 暫停' : '失焦', g.lt);
        else releaseHoldNoDrag(g, hb, '放開', g.lt);
      }
      mouse.press = null;
    }
    mouse.btn = false; mouse.uiDownKey = null;
    openPause(g, why);
  }
  window.addEventListener('blur', function () {
    if (screen !== SCREEN.PLAYING || !game || game.paused || game.done) return;
    interruptToPause('blur');
  });

  // v26: 開始畫面按任意鍵開始(Esc 維持無作用; 單按修飾鍵、帶 Ctrl / Alt / Meta 的組合鍵、F1~F12 不算, 留給瀏覽器)
  var TITLE_SKIP_KEYS = { Escape: 1, Esc: 1, Shift: 1, Control: 1, Alt: 1, Meta: 1, AltGraph: 1, CapsLock: 1, NumLock: 1, ScrollLock: 1, Fn: 1, OS: 1, ContextMenu: 1, Dead: 1, Unidentified: 1 };
  window.addEventListener('keydown', function (e) {
    if (screen !== SCREEN.TITLE || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (TITLE_SKIP_KEYS[e.key] || e.keyCode === 27 || /^F[0-9]{1,2}$/.test(e.key || '')) return;
    e.preventDefault();
    ensureSoundInit();
    doTitleAction('start');
  });

  // 通用鍵 Esc(只處理 Esc, 其他鍵一律不理也不 preventDefault): 遊戲中 → 暫停; 暫停選單 → 繼續; 確認面板 → 取消; 開始 / 結束畫面無作用
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    e.preventDefault();
    if (e.repeat) return;
    if (screen === SCREEN.PLAYING && game && !game.paused && !game.done) interruptToPause('esc');
    else if (screen === SCREEN.PAUSED && game) {
      if (confirmKind) { confirmKind = null; hov.pauseMenu = pauseMenuLocate(mouse); }
      else resumePause(game);
    }
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
  function renderGame(g, paused, noButtons) {
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
    // 第 3 關輪轉預告(3 拍; 第 61~63 拍與縮小預告同時, 縮小預告畫在地板本身、輪轉預告畫在地板間隙); 預告期間地板照原位置與大小
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
    if (g.phase === 'countIn' && !g.done) {
      var left = Math.max(1, Math.min(4, -fl));
      Art.drawCountIn(ctx, { level: lvl, beatsLeft: left, phase: phase });
      if (lvl > 1 && (g.introT || 0) < g.countInLen) Art.drawLevelIntro(ctx, { level: lvl, t: g.introT || 0, dur: g.countInLen });
    }
    var tst = tutDrawState(g);
    if (tst && Art.drawTutorial) Art.drawTutorial(ctx, tst);
    var endBeat = LEVELS[lvl].endBeat;
    var songProgress = (g.phase === 'playing' && endBeat != null) ? clamp01(beat / endBeat) : null;
    Art.drawHud(ctx, {
      level: lvl, hp: g.hp, danger: g.danger, hpFx: g.hpFx, time: animT, survival: g.surv, songProgress: songProgress, score: g.score, combo: g.combo
    });
    if (noButtons) return;
    Art.drawPauseButton(ctx, { level: lvl, hover: hov.pauseBtn && !paused });
    drawMute({ level: lvl, hover: hov.muteBtn, muted: muted });
  }
  // 觸控模式不畫聲音開關圖示(聲音交給手機本身)
  function drawMute(st) { if (!(window.PVDX && PVDX.on)) Art.drawMuteButton(ctx, st); }
  function render() {
    if (OX > 0 && !G.touch) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, H); }   // 觸控寬畫面兩側由美術的背景畫滿, 不塗黑
    ctx.save();
    ctx.translate(OX, 0);   // 設計區置中: 整個畫面最外層位移一次, 介面座標維持 1280 設計值
    try { renderScreens(); } finally { ctx.restore(); }
    if (window.PVDX) PVDX.draw(ctx);   // 觸控層: 兩側黑塊與暫停遮罩之外的疊層
  }
  function renderScreens() {
    if (screen === SCREEN.TITLE) {
      Art.drawTitle(ctx, { t: titleT });
      Art.drawCredits(ctx, { lines: CREDITS_LINES, px: 10, lh: 13 });
      drawMute({ level: 1, corner: true, hover: hov.muteBtn, muted: muted });
    } else if (screen === SCREEN.PLAYING) {
      renderGame(game, false);
    } else if (screen === SCREEN.PAUSED) {
      renderGame(game, true);
      Art.drawPauseMenu(ctx, { level: game.lvl, hover: confirmKind ? null : hov.pauseMenu });
      if (confirmKind) Art.drawConfirm(ctx, { kind: confirmKind, hover: hov.confirm, level: game.lvl });
      Art.drawPauseButton(ctx, { level: game.lvl, hover: false });
      drawMute({ level: game.lvl, hover: hov.muteBtn, muted: muted });
    } else if (screen === SCREEN.END) {
      if (game) renderGame(game, true, true);
      var ctD = endClearT();
      Art.drawGameOver(ctx, { survival: endInfo ? endInfo.time : 0, score: endInfo ? endInfo.score : 0, hover: hov.end, cleared: ctD != null, clearT: ctD, btnT: CLEAR_BTN_SEC });
      Art.drawCredits(ctx, { lines: CREDITS_LINES });
      drawMute({ level: 1, corner: true, hover: hov.muteBtn, muted: muted });
    }
  }

  // ==================================================================
  // 主迴圈
  // ==================================================================
  var lastTs = null, pvdxWas = false;
  var titleT = 0, titleWas = false;   // v26: 開始畫面演出的時鐘(每次進開始畫面從 0 起; 網站暫停時凍結)
  function frame(ts) {
    if (lastTs == null) lastTs = ts;
    var rawDt = ts - lastTs;
    lastTs = ts;
    var dt = Math.min(Math.max(rawDt, 0) / 1000, 1 / 30); // 切分頁回來不瞬移
    // 網站暫停(pvd:pause / 直拿手機): 遊戲中就比照失焦開自己的暫停選單(收掉拖曳、暫停音樂), 繼續後由玩家按「繼續」
    var pvdxP = !!(window.PVDX && PVDX.paused);
    if (pvdxP && !pvdxWas && screen === SCREEN.PLAYING && game && !game.paused && !game.done) {
      try { interruptToPause('blur'); } catch (e) { logErr(e); }
    }
    pvdxWas = pvdxP;
    if (screen === SCREEN.TITLE) { if (!titleWas) titleT = 0; else if (!pvdxP) titleT += dt; }
    titleWas = screen === SCREEN.TITLE;
    if (!pvdxP && screen === SCREEN.PLAYING && game && !game.paused && !game.done) {
      if (game.frameIntervalCount < 600) { game.frameIntervalSum += rawDt; game.frameIntervalCount++; }
      animT += dt; game.clipSec += Math.max(0, rawDt / 1000 - dt);       // 逐局時間核對用: dt 上限裁掉的秒數(切分頁、卡頓)
      try { tick(dt, ts); } catch (e) { if (window.console) console.error(e); }
    }
    try { render(); } catch (e) { if (window.console) console.error(e); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
