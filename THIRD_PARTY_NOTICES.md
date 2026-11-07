# Third-party components

The MIT license at the repository root covers YMusic's original source and original artwork. Third-party components retain their own licenses; the licenses included in their distributions remain applicable.

| Component | Purpose | Upstream |
| --- | --- | --- |
| Electron 45.2.3 | Desktop application runtime | https://github.com/electron/electron |
| discord.js 14.28.1 | Discord Gateway and REST | https://github.com/discordjs/discord.js |
| @discordjs/voice 0.19.2 | Discord audio transport | https://github.com/discordjs/discord.js |
| @snazzah/davey | DAVE audio encryption | https://github.com/Snazzah/davey |
| opusscript 0.1.1 / Opus | Audio encoding | https://github.com/abalabahaha/opusscript |
| ffmpeg-static 5.3.0 | FFmpeg executable for the optional device-capture mode | https://github.com/eugeneware/ffmpeg-static |

## FFmpeg distribution

The optional VB-CABLE/device mode uses a separate FFmpeg executable. `ffmpeg-static` is licensed under GPL-3.0-or-later. Its Windows x64 download is FFmpeg `6.1.1-essentials_build-www.gyan.dev`, distributed under GPL v3. It is a separate executable, not YMusic's original source.

The package includes `ffmpeg.exe.LICENSE` and `ffmpeg.exe.README` beside the executable; these files must remain with redistributed builds. The upstream README includes the exact FFmpeg source reference, build configuration, component versions and component license information.

- Binary distribution and build inputs: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- FFmpeg source revision identified by the binary distributor: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- FFmpeg source archive for that revision: https://github.com/FFmpeg/FFmpeg/archive/e38092ef93.tar.gz
- Build distributor: https://www.gyan.dev/ffmpeg/builds/
- FFmpeg licensing information: https://ffmpeg.org/legal.html

Electron's `LICENSE` and `LICENSES.chromium.html`, and the dependency license files under `resources/app/node_modules`, are retained in packaged releases. See `package-lock.json` for the full dependency graph.

Yandex Music, Discord and their respective trademarks belong to their owners. YMusic is an independent community project and is not affiliated with either company. No music files or third-party album artwork are included in the repository's demonstration assets.
