# 音效素材出處

## 背景音樂(CC BY 4.0, 必須署名)

三首都出自 Kevin MacLeod 的 incompetech.com, 授權 Creative Commons: By Attribution 4.0(https://creativecommons.org/licenses/by/4.0/), 免登入直接下載。授權須在作品中署名, 作者網站提供的署名文字如下(建議放在遊戲的說明頁或結束畫面, 由製作人決定位置):

```
"Aerosol of my Love", "Disco Medusae", "In a Heartbeat"
Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0
http://creativecommons.org/licenses/by/4.0/
```

共同處理(三首都做過): 依量得的拍格截取整數小節、開頭 2 毫秒淡入、前面加 0.05 秒數位靜音(給解碼校正用)、整段響度統一到 −19 dBFS RMS(增益 −1.5 / −5.8 / −4.2 dB)、44.1 kHz 立體聲 128 kbps mp3。同一份 mp3 另以 base64 內嵌在 `sound.js`。

| 檔名 | 對應事件 | 原曲 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| music_stage1.mp3 | 背景音樂 `stage1`(第 1 關) | Aerosol of my Love(100 BPM) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2000020 (檔案: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Aerosol%20of%20my%20Love.mp3) | Kevin MacLeod | CC BY 4.0 | 共同處理; 截取原曲 7.3715~96.1715 秒(第 4~40 小節, 37 小節), 結尾 0.06 秒淡出 |
| music_stage2.mp3 | 背景音樂 `stage2`(第 2 關) | Disco Medusae(115 BPM) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500041 (檔案: https://incompetech.com/music/royalty-free/mp3-royaltyfree/Disco%20Medusae.mp3) | Kevin MacLeod | CC BY 4.0 | 共同處理; 截取原曲 2.1042~87.669 秒(第 2~42 小節, 41 小節), 結尾 0.06 秒淡出 |
| music_stage3.mp3 | 背景音樂 `stage3`(第 3 關, 循環) | In a Heartbeat(130 BPM) | https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100197 (檔案: https://incompetech.com/music/royalty-free/mp3-royaltyfree/In%20a%20Heartbeat.mp3) | Kevin MacLeod | CC BY 4.0 | 共同處理; 截取原曲 5.566~96.028 秒(第 4~52 小節, 49 小節); 循環接縫最後 30 毫秒交叉淡入原曲第 5 小節前的聲音; 尾端多接 0.5 秒原曲第 5 小節開頭(循環保險) |

## 短音效(CC0)

全部出自 Kenney(www.kenney.nl), 授權 Creative Commons Zero (CC0 1.0), 不需署名; 此處仍記錄出處供查核。授權原文見各包內 License.txt(http://creativecommons.org/publicdomain/zero/1.0/)。前 8 個沿用上一版(v13)的檔案, 未再改動。

共同處理(每個檔都做過): 轉單聲道、剪掉開頭靜音(峰值 1% 以下)、剪掉尾端(峰值 0.4% 以下)並加 15 毫秒淡出、10 kHz 低通後降取樣到 22050 Hz、峰值正規化到 0.89、輸出 mp3。同一份內容另以 16-bit PCM base64 內嵌在 `sound.js`(主要播放路徑), mp3 是沒有 Web Audio 時的退路。

| 檔名 | 對應事件 | 原始檔 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| count_in_pluck.mp3 | countIn(預備拍) | Interface Sounds / pluck_002.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依剩餘拍數變調 |
| on_beat_glass.mp3 | onBeat(踩拍); 也疊在 beatChain | Interface Sounds / glass_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依踩拍級數變調、疊層 |
| beat_chain_powerup.mp3 | beatChain(整串踩拍) | Digital Audio / powerUp9.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| catch_confirm.mp3 | catch(捕捉) | Interface Sounds / confirmation_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理 |
| net_swap_phaser_up.mp3 | netSwap(網換位) | Digital Audio / phaserUp7.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| expire_phaser_down.mp3 | expire(過期) | Digital Audio / phaserDown3.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| clear_jingle.mp3 | clear(清場) | Music Jingles / 8-Bit jingles / jingles_NES12.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
| danger_jingle.mp3 | danger(血量危險) | Music Jingles / 8-Bit jingles / jingles_NES13.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
| stage_change_steel.mp3 | stageChange(換關, 本版新增) | Music Jingles / Steel jingles / jingles_STEEL02.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
