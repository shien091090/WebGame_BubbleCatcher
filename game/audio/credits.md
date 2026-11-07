# 音效素材出處

## 背景音樂(CC BY, 必須署名)

第 1 關沿用 v26; 本版第 2、3 關換成使用者選定的兩首 FoxSynergy 曲子(取代 Cluster Block 與 Metallic Mistress)。三首都必須在遊戲中署名; CC BY 允許改作, 但要標明有修改, 所以三首的署名都要寫「已調速並截取」。

### 遊戲畫面要放的署名文字

建議放在開始畫面或結束畫面(v20 已沒有說明頁; 位置由製作人決定)。**上一版的第 2 關 "Cluster Block"、第 3 關 "Metallic Mistress" 署名要換掉**(第 1 關不變):

```
音樂 / Music
第 1 關 "Voice Over Under" Kevin MacLeod (incompetech.com)
  Licensed under Creative Commons: By Attribution 4.0
  http://creativecommons.org/licenses/by/4.0/
  已調速(135 → 105 BPM)並截取 / tempo changed and excerpted
第 2 關 "Litany to the Datastream Goddess" by FoxSynergy (opengameart.org)
  Licensed under CC-BY 3.0  https://creativecommons.org/licenses/by/3.0/
  已調速(128 → 115 BPM)並截取 / tempo changed and excerpted
第 3 關 "Thy Steel Consumed" by FoxSynergy (opengameart.org)
  Licensed under CC-BY 3.0  https://creativecommons.org/licenses/by/3.0/
  已調速(120 → 125 BPM)並截取 / tempo changed and excerpted
```

若畫面空間不夠, 最短版(仍含必要四項: 曲名、作者、授權、是否修改):

```
"Voice Over Under" Kevin MacLeod (incompetech.com), CC BY 4.0, 已調速
"Litany to the Datastream Goddess", "Thy Steel Consumed" by FoxSynergy, CC-BY 3.0, 皆已調速
```

共同處理(三首都做過): 依量得的拍格截取整數小節、保留音高的時間伸縮(第 1 關用 Rubber Band R3; 第 2、3 關因本機不能執行 Rubber Band, 改用諧波 / 打擊分離後各自伸縮的方法: 諧波部分相位聲碼器、打擊部分短窗疊加, 左右聲道轉成中 / 側聲道分開處理以保持立體聲)、開頭 2 毫秒淡入、前面加 0.05 秒數位靜音(解碼校正用)、響度統一到 −19 dBFS RMS、超過 0.95 的少數峰值做峰值限制、44.1 kHz 立體聲 128 kbps mp3。同一份 mp3 另以 base64 內嵌在 `sound.js`。

| 檔名 | 對應事件 | 原曲 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| music_stage1.mp3 | 背景音樂 `stage1`(第 1 關) | Voice Over Under(原曲 135 BPM, 3:17) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600001 (檔案: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voice%20Over%20Under.mp3) | Kevin MacLeod | CC BY 4.0 | **已調速**: Rubber Band R3 保留音高的時間伸縮, 135 → 105 BPM(時間拉長 1.2857 倍); 截取原曲第 1~37 小節(原曲 0.0244~65.80 秒); 結尾 0.06 秒淡出; 共同處理 |
| music_stage2.mp3 | 背景音樂 `stage2`(第 2 關) | Litany to the Datastream Goddess v1.11(原曲 128 BPM, 4:00) | https://opengameart.org/content/datastream-goddess (檔案: https://opengameart.org/sites/default/files/Litany%20to%20the%20Datastream%20Goddess%20v1_11.mp3, 頁面上的 v1.11 鋼琴伴奏版) | FoxSynergy | CC-BY 3.0 | **已調速**: 保留音高的時間伸縮, 128 → 115 BPM(時間拉長 128/115 = 1.1130 倍); 截取原曲第 68~108 小節(原曲 125.64~202.52 秒, 41 小節); 結尾 0.06 秒淡出; 共同處理 |
| music_stage3.mp3 | 背景音樂 `stage3`(第 3 關, 不循環) | Thy Steel Consumed(原曲 120 BPM, 4:00) | https://opengameart.org/content/thy-steel-consumed (檔案: https://opengameart.org/sites/default/files/Thy%20Steel%20Consumed.mp3) | FoxSynergy | CC-BY 3.0 | **已調速**: 保留音高的時間伸縮, 120 → 125 BPM(時間縮短為 0.96 倍); 截取原曲第 64~112 小節(原曲 126.01~224.01 秒, 49 小節); 結尾 0.06 秒淡出; 沒有疊加任何層; 共同處理 |

作者附註: FoxSynergy 在 OpenGameArt 頁面表示署名請寫 "FoxSynergy", 並歡迎告知使用的作品(非必要)。 兩首新曲的頁面授權欄都只列 CC-BY 3.0(2026-11-07 查核)。

## 短音效(CC0)

全部出自 Kenney(www.kenney.nl), 授權 Creative Commons Zero (CC0 1.0), 不需署名; 此處仍記錄出處供查核。授權原文見各包內 License.txt(http://creativecommons.org/publicdomain/zero/1.0/)。前 10 個檔沿用上一版(game-v17), 檔案未再改動; v20 新增最後 2 個新手教學音(同一包 Interface Sounds)。

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
| tutorial_show_drop.mp3 | tutorialShow(新手教學提示彈出) | Interface Sounds / drop_002.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理(v20 新增) |
| tutorial_done_confirm.mp3 | tutorialDone(新手教學階段完成) | Interface Sounds / confirmation_003.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理(v20 新增) |
