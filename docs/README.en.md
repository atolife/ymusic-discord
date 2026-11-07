<div align="center">
  <img src="assets/hero.png" width="100%" alt="YMusic — your player, your shared broadcast. Yandex Music to Discord with driverless audio capture.">
  <br><br>
  <h1>Your player. Your people.</h1>
  <p>Share your Yandex Music desktop player in a Discord voice channel.<br>One dedicated bot. Per-listener volume. No virtual audio cable required.</p>
  <a href="https://github.com/atolife/ymusic-discord/releases/latest"><b>Download for Windows →</b></a>
  <br><br>
  <a href="../README.md">Русский</a> · <b>English</b> · <a href="SETUP.md">Setup guide</a> · <a href="DEVELOPMENT.md">Development</a>
</div>

## Keep control in your music player

Pick tracks, change playlists, pause or seek in the Yandex Music desktop app. YMusic captures that application's audio on Windows and sends it through your own Discord bot. Everyone adjusts the bot's volume independently in Discord.

- **Driverless capture:** Windows WASAPI process-loopback includes the player and its child processes. It does not automatically fall back to system-wide audio.
- **Now playing:** a single message in the voice channel's text chat shows the track, artist, cover, playback state and progress.
- **Profile activity:** the bot's Listening activity follows the current broadcast track, including a pause marker.
- **Slash commands:** `/join`, `/leave`, `/status`, with owner/admin/DJ-role access.
- **Tray application:** close the window to keep broadcasting. Optional startup and auto-connect settings.
- **Recovery:** bounded reconnection attempts after network/audio interruptions and system sleep. Manual disconnects cancel automatic return.
- **Device fallback:** VB-CABLE remains available as an optional alternative.

<img src="assets/app-preview.png" width="100%" alt="The actual YMusic desktop interface with fictional demonstration data.">

<sub>The interface is real; the server, track and connection details in this illustration are fictional.</sub>

## Quick start

1. Download the ZIP from **[Releases](https://github.com/atolife/ymusic-discord/releases/latest)**, extract the entire folder and run `YMusic.exe`. A packaged release does not require Node.js.
2. Create a bot in the **[Discord Developer Portal](https://discord.com/developers/applications)**. Save its token locally in YMusic, then use the in-app invitation button to add it to your server.
3. Open the Yandex Music desktop player. Choose a server and voice channel in YMusic, keep direct application capture selected, and connect.

If you hear both the local player and the delayed bot, set **the bot's volume to 0 for yourself** in Discord. Other listeners are unaffected.

## Requirements and limits

- Windows x64, build **20348 or newer**, with process-loopback support. Windows 11 is the primary target.
- Yandex Music desktop application with working playback.
- Your own Discord bot and permission to add it to the server.
- The Windows PC, player and YMusic must remain running while listening.

This is a local audio bridge, not a cloud-hosted music service. Spotify and phone-only playback control are outside the current scope. Normal voice channels are supported; Stage channels are not.

YMusic reads track information from Windows media sessions. It does not need a Yandex account token or password. The Discord token is stored locally using Windows-backed encryption; YMusic does not write audio recordings to disk. Privileged Gateway Intents are not required.

The track card needs View Channel, Send Messages, Embed Links, Attach Files and Read Message History in the target channel. See the **[setup guide](SETUP.md)** for details. Use only audio you are allowed to share and follow your music service's terms.

## Build from source

```powershell
git clone https://github.com/atolife/ymusic-discord.git
cd ymusic-discord
npm ci
npm run desktop
```

Windows x64 and Node.js **22.12+** are required. The WASAPI helper is built from `native/ProcessAudio.cs` using the Windows .NET Framework compiler.

```powershell
npm run check
npm test
npm run build
```

See **[development](DEVELOPMENT.md)** and **[changelog](../CHANGELOG.md)**. Original code and artwork are **[MIT licensed](../LICENSE)**; dependencies retain their licenses as listed in **[third-party notices](../THIRD_PARTY_NOTICES.md)**. Independent project, not affiliated with Yandex or Discord.
