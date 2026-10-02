# 音效素材出處

全部素材出自 Kenney(www.kenney.nl), 授權 Creative Commons Zero (CC0 1.0), 不需署名; 此處仍記錄出處供查核。授權原文見各包內 License.txt(http://creativecommons.org/publicdomain/zero/1.0/)。

共同處理(每個檔都做過): 轉單聲道、剪掉開頭靜音(峰值 1% 以下)、剪掉尾端(峰值 0.4% 以下)並加 15 毫秒淡出、10 kHz 低通後降取樣到 22050 Hz、峰值正規化到 0.89、輸出 mp3。同一份內容另以 16-bit PCM base64 內嵌在 `sound.js`(主要播放路徑), mp3 是沒有 Web Audio 時的退路。

| 檔名 | 對應事件 | 原始檔 | 原始頁面 | 作者 | 授權 | 剪輯或調整 |
|---|---|---|---|---|---|---|
| count_in_pluck.mp3 | countIn(預備拍) | Interface Sounds / pluck_002.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依剩餘拍數變調 |
| on_beat_glass.mp3 | onBeat(踩拍); 也疊在 beatChain | Interface Sounds / glass_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理; 播放時依節點序變調 |
| beat_chain_powerup.mp3 | beatChain(整串踩拍) | Digital Audio / powerUp9.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| catch_confirm.mp3 | catch(捕捉) | Interface Sounds / confirmation_001.ogg | https://kenney.nl/assets/interface-sounds | Kenney | CC0 | 共同處理 |
| net_swap_phaser_up.mp3 | netSwap(網換位) | Digital Audio / phaserUp7.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| expire_phaser_down.mp3 | expire(過期) | Digital Audio / phaserDown3.ogg | https://kenney.nl/assets/digital-audio | Kenney | CC0 | 共同處理 |
| clear_jingle.mp3 | clear(清場) | Music Jingles / 8-Bit jingles / jingles_NES12.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |
| danger_jingle.mp3 | danger(血量危險) | Music Jingles / 8-Bit jingles / jingles_NES13.ogg | https://kenney.nl/assets/music-jingles | Kenney | CC0 | 共同處理 |

背景音樂 `main` 不是檔案: 由 `sound.js` 在 `Sound.init()` 時以 Web Audio 程式合成, 無外部素材。
