# Smooth Fade

一个 [Spicetify](https://spicetify.app) 扩展：在每首歌结尾慢慢降低音量，下一首开始时再慢慢升回来，让切歌不再生硬。

A Spicetify extension that fades the volume out at the end of each track and back in on the next one. Works on Spotify Free.

![Smooth Fade](preview.png)

## 为什么需要它

Spotify 的「交叉淡入淡出（Crossfade）」现在只对 Premium 开放。免费账号切歌时会直接硬切。

Spicetify 扩展运行在 Spotify 的界面层，拿不到音频流，没法让两首歌同时播放。所以这个扩展只调音量，不做真正的混音：两首歌不会重叠，中间会有一个很短的低音量谷底。它比硬切顺得多，但听起来和 Apple Music 的 crossfade 不一样。

如果你有 Premium，直接用 Spotify 自带的 Crossfade 或「混音歌单（Mix）」效果更好。

## 功能

- 结尾淡出 1–12 秒（默认 6 秒），开头淡入 0–8 秒（默认 3 秒）
- 同一张专辑连着播时不淡出，保留专辑本来的无缝衔接（可关闭）
- 淡出时拖动音量条，会取消这一首的淡出，用你新设的音量
- 淡出中途手动切歌，下一首照样淡入
- 暂停超过 1.5 秒会先把音量还原；淡出到一半关掉 Spotify，下次打开会自动恢复原来的音量
- 跳过广告和播客

## 安装

### 通过 Spicetify Marketplace

在 Marketplace 的 Extensions 里搜索 **Smooth Fade**，点 Install。

### 手动安装

1. 把 `smoothFade.js` 放进 Spicetify 的 Extensions 文件夹：
   - macOS / Linux：`~/.config/spicetify/Extensions/`
   - Windows：`%appdata%\spicetify\Extensions\`
2. 运行：

   ```sh
   spicetify config extensions smoothFade.js
   spicetify apply
   ```

Spotify 重启后，屏幕下方会弹出「Smooth Fade 已加载」的提示。

## 设置

按 `Ctrl+Option+F`（Windows/Linux 是 `Ctrl+Alt+F`）打开设置面板。

扩展也会尝试在顶栏、播放栏和头像菜单里加一个入口。在 Spotify 1.3.8 + Spicetify 2.46.4 上，这几个入口可能不显示，因为这版 Spicetify 官方只支持到 macOS 版 Spotify 1.3.7。快捷键不受影响。

## 卸载

```sh
spicetify config extensions smoothFade.js-
spicetify apply
```

## 实现方式

扩展每 100ms 读一次播放进度，按剩余时间算出音量系数（正弦曲线），再通过 `Spicetify.Player.setVolume` 写回音量。音量是根据播放进度算的，不是按计时器算的，所以暂停、拖进度条、单曲循环时都能对得上。

## License

MIT
