# 音效素材出處

## 背景音樂(CC BY, 必須署名)

本版三首全換(decisions v26 老闆選曲)。三首都必須在遊戲中署名; CC BY 允許改作, 但要標明有修改, 所以前兩首的署名要寫「已調速」。

### 遊戲畫面要放的署名文字

建議放在說明頁最後或結束畫面(位置由製作人決定)。**上一版的 "Aerosol of my Love", "Disco Medusae", "EDM Detection Mode" 署名要整段換掉**:

```
音樂 / Music
第 1 關 "Voice Over Under" Kevin MacLeod (incompetech.com)
  Licensed under Creative Commons: By Attribution 4.0
  http://creativecommons.org/licenses/by/4.0/
  已調速(135 → 105 BPM)並截取 / tempo changed and excerpted
第 2 關 "Cluster Block" by FoxSynergy (opengameart.org)
  Licensed under CC-BY 3.0  https://creativecommons.org/licenses/by/3.0/
  已調速(133 → 115 BPM)並截取 / tempo changed and excerpted
第 3 關 "Metallic Mistress" by FoxSynergy (opengameart.org)
  Licensed under CC-BY 3.0  https://creativecommons.org/licenses/by/3.0/
  已截取並循環 / excerpted and looped
```

若畫面空間不夠, 最短版(仍含必要四項: 曲名、作者、授權、是否修改):

```
"Voice Over Under" Kevin MacLeod (incompetech.com), CC BY 4.0, 已調速
"Cluster Block", "Metallic Mistress" by FoxSynergy, CC-BY 3.0, 前者已調速
```

共同處理(三首都做過): 依量得的拍格截取整數小節、開頭 2 毫秒淡入、前面加 0.05 秒數位靜音(解碼校正用)、響度統一到 −19 dBFS RMS、超過 0.95 的少數峰值做峰值限制、44.1 kHz 立體聲 128 kbps mp3。同一份 mp3 另以 base64 內嵌在 `sound.js`。

| 檔名 | 對應事件 | 原曲 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| music_stage1.mp3 | 背景音樂 `stage1`(第 1 關) | Voice Over Under(原曲 135 BPM, 3:17) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600001 (檔案: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voice%20Over%20Under.mp3) | Kevin MacLeod | CC BY 4.0 | **已調速**: Rubber Band R3 保留音高的時間伸縮, 135 → 105 BPM(時間拉長 1.2857 倍); 截取原曲第 1~37 小節(原曲 0.0244~65.80 秒); 結尾 0.06 秒淡出; 共同處理 |
| music_stage2.mp3 | 背景音樂 `stage2`(第 2 關) | Cluster Block(檔名 Cluster Block v0_8.mp3, 原曲 133 BPM) | https://opengameart.org/content/cluster-block (檔案: https://opengameart.org/sites/default/files/Cluster%20Block%20v0_8.mp3) | FoxSynergy | CC-BY 3.0 | **已調速**: Rubber Band R3 保留音高的時間伸縮, 133 → 115 BPM(時間拉長 1.1565 倍); 截取原曲第 1~41 小節(原曲 0.0107~74.00 秒); 結尾 0.06 秒淡出; 共同處理 |
| music_stage3.mp3 | 背景音樂 `stage3`(第 3 關, 循環) | Metallic Mistress(原曲 125 BPM) | https://opengameart.org/content/metallic-mistress (檔案: https://opengameart.org/sites/default/files/Metallic%20Mistress.mp3) | FoxSynergy | CC-BY 3.0 | 原速; 截取原曲第 4~52 小節(5.7765~99.8565 秒, 49 小節); 循環接縫最後 30 毫秒交叉淡入原曲第 5 小節前的聲音; 尾端多接 0.5 秒原曲第 5 小節開頭(循環保險); 沒有疊加任何層; 共同處理 |

作者附註: FoxSynergy 在 OpenGameArt 頁面表示署名請寫 "FoxSynergy", 並歡迎告知使用的作品(非必要)。

## 短音效(CC0)

全部出自 Kenney(www.kenney.nl), 授權 Creative Commons Zero (CC0 1.0), 不需署名; 此處仍記錄出處供查核。授權原文見各包內 License.txt(http://creativecommons.org/publicdomain/zero/1.0/)。10 個檔全部沿用上一版(game-v17), 檔案未再改動。

共同處理(每個檔都做過): 轉單聲道、剪掉開頭靜音(峰值 1% 以下)、剪掉尾端(峰值 0.4% 以下)並加 15 毫秒淡出、10 kHz 低通後降取樣到 22050 Hz、峰值正規化到 0.89、輸出 mp3。同一份內容另以 16-bit PCM base64 內嵌在 `sound.js`(主要播放路徑), mp3 是沒有 Web Audio 時的退路。

| 檔名 | 對應事件 | 原始檔 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| count_in_pluck.mp3 | countIn(預備拍) | Interface Sounds / pluck_002.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依剩餘拍數變調 |
| on_beat_glass.mp3 | onBeat(踩拍); 也疊在 beatChain | Interface Sounds / glass_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依踩拍級數變調、疊層 |
| beat_chain_powerup.mp3 | beatChain(整串踩拍) | Digital Audio / powerUp9.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| catch_confirm.mp3 | catch(觸發) | Interface Sounds / confirmation_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理 |
| net_swap_phaser_up.mp3 | netSwap(光門換位) | Digital Audio / phaserUp7.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| expire_phaser_down.mp3 | expire(過期) | Digital Audio / phaserDown3.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| danger_jingle.mp3 | danger(血量危險) | Music Jingles / 8-Bit jingles / jingles_NES13.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
| stage_change_steel.mp3 | stageChange(換關) | Music Jingles / Steel jingles / jingles_STEEL02.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
| floor_rotate_switch.mp3 | floorRotate(第 3 關地板輪轉) | Interface Sounds / switch_002.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理 |
| wrong_dye_error.mp3 | wrongDye(沾錯消失) | Interface Sounds / error_005.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理 |
