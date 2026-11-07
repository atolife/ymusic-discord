const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerMonitor, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { SettingsStore } = require('./settings.cjs');

const liveSmoke = process.argv.includes('--live-smoke');
const mediaSmoke = process.argv.includes('--media-smoke');
const smoke = process.argv.includes('--smoke-test') || liveSmoke || mediaSmoke;
if (process.env.YMUSIC_USER_DATA) app.setPath('userData', path.resolve(process.env.YMUSIC_USER_DATA));
app.setAppUserModelId('local.ymusic.desktop');
app.setName('YMusic');
if (!process.env.YMUSIC_USER_DATA) app.setPath('userData', path.join(app.getPath('appData'), 'YMusic'));
if (!app.requestSingleInstanceLock()) { app.quit(); }
else boot().catch(error => { console.error(error.message); app.exit(1); });

let window, tray, store, service, listDevices, listApplications, MusicService, NowPlayingController, nowPlaying;
let quitting = false, quittingPending = false;
let lastTrayPhase = '';

function showWindow() { window?.show(); window?.focus(); }
function sendState(state) {
  if (window && !window.isDestroyed()) window.webContents.send('ymusic:state', state);
  if (tray && lastTrayPhase !== state.phase) {
    lastTrayPhase = state.phase;
    tray.setToolTip(`YMusic · ${state.message}`.slice(0, 120));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть YMusic', click: showWindow },
      { label: state.phase === 'online' ? 'Отключить музыку' : 'Подключить музыку', click: () => {
        const action = service.state.phase === 'online' ? service.leave() : service.connect(store.value.voiceChannelId);
        action.catch(error => service.log(error));
      } },
      { type: 'separator' }, { label: 'Выйти', click: () => app.quit() },
    ]));
  }
}
async function newService() {
  if (nowPlaying) await nowPlaying.close();
  if (service) { service.removeAllListeners(); await service.close(); }
  service = new MusicService(store.value);
  service.on('state', sendState);
  service.on('target', ({ channelId, guildId }) => {
    try { store.save({ voiceChannelId: channelId, guildId }); }
    catch (error) { service.log(error); }
  });
  if (!smoke || liveSmoke || mediaSmoke) nowPlaying = new NowPlayingController(service, { config: store.value,
    persist: records => { try { store.save({ nowPlayingMessages: records }); } catch (error) { service.log(error); } } });
  sendState(service.snapshot());
}

async function boot() {
  await app.whenReady();
  ({ MusicService } = await import('../src/service.js'));
  ({ listDevices } = await import('../src/audio.js'));
  ({ listApplications } = await import('../src/process-audio.js'));
  ({ NowPlayingController } = await import('../src/now-playing-controller.js'));
  store = new SettingsStore(app.getPath('userData'), safeStorage);
  let loadError = '';
  try {
    store.load(smoke && !liveSmoke ? [] : [path.join(app.getAppPath(), 'config.json'),
      path.resolve(path.dirname(process.execPath), '../discord-music-bot/config.json')]);
  } catch { loadError = 'Не удалось открыть сохранённые настройки. Проверь токен и источник звука в настройках.'; }
  await newService();
  if (loadError) service.log(loadError);
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon);
  tray.on('double-click', showWindow);
  sendState(service.snapshot());
  window = new BrowserWindow({ width: 1160, height: 960, minWidth: 900, minHeight: 730,
    title: 'YMusic', backgroundColor: '#101411', icon, show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, spellcheck: false } });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  ipcMain.handle('ymusic:call', async (event, method, data) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Доступ запрещён.');
    try { return { ok: true, value: await dispatch(method, data) }; }
    catch (error) {
      const { redact } = await import('../src/config.js');
      return { ok: false, error: redact(error.message, store.value.token) };
    }
  });
  powerMonitor.on('suspend', () => service.suspend());
  powerMonitor.on('resume', () => service.resume());
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    if (quittingPending) return;
    quittingPending = true;
    Promise.resolve(nowPlaying?.close()).then(() => service.close()).finally(() => { quitting = true; tray?.destroy(); app.quit(); });
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (!process.argv.includes('--hidden') && !smoke) showWindow();
  if (smoke) return smokeTest();
  if (store.value.autoConnect && store.value.voiceChannelId && store.value.token) {
    void service.connect(store.value.voiceChannelId).catch(error => service.log(error));
  }
}

async function dispatch(method, data) {
  if (method === 'init') return { settings: store.public(), state: service.snapshot(), packaged: app.isPackaged, version: app.getVersion() };
  if (method === 'devices') return (await listDevices()).devices;
  if (method === 'applications') return listApplications();
  if (method === 'catalogue') {
    const result = await service.catalogue(data?.guildId);
    if (result.guildId) await service.prepareGuild(result.guildId);
    return result;
  }
  if (method === 'connect') return service.connect(String(data?.channelId ?? store.value.voiceChannelId));
  if (method === 'disconnect') return service.leave();
  if (method === 'save') {
    if (!data || typeof data !== 'object') throw new Error('Нет настроек для сохранения.');
    const patch = Object.fromEntries(['voiceChannelId', 'guildId', 'audioDevice', 'bitrate', 'djRoleId', 'autoConnect', 'autoStart', 'nowPlayingEnabled', 'mediaSourceId', 'captureMode', 'applicationPath'].filter(k => k in data).map(k => [k, data[k]]));
    if (data.token) patch.token = data.token;
    const candidate = store.validate({ ...store.value, ...patch });
    const startupChanged = candidate.autoStart !== store.value.autoStart;
    if (startupChanged && !app.isPackaged) throw new Error('Автозапуск доступен в собранной версии YMusic.exe.');
    const old = { ...store.value };
    const result = store.save(candidate);
    if (startupChanged) {
      try { app.setLoginItemSettings({ openAtLogin: candidate.autoStart, path: process.execPath, args: ['--hidden'] }); }
      catch (error) { store.save(old); throw error; }
    }
    if (candidate.token !== old.token) await newService();
    else {
      const restartAudio = (candidate.audioDevice !== old.audioDevice || candidate.captureMode !== old.captureMode || candidate.applicationPath !== old.applicationPath) && service.wantedChannel;
      service.config = { ...store.value };
      nowPlaying?.configure(store.value);
      if (restartAudio) void service.connect(service.wantedChannel).catch(error => service.log(error));
    }
    return result;
  }
  if (method === 'help') return shell.openExternal('https://vb-audio.com/Cable/');
  if (method === 'portal') return shell.openExternal('https://discord.com/developers/applications');
  if (method === 'invite') {
    const client = await service.session();
    const { inviteUrl } = await import('../src/recovery.js');
    return shell.openExternal(inviteUrl(client.user.id));
  }
  if (method === 'hide') { window.hide(); return; }
  if (method === 'quit') { app.quit(); return; }
  throw new Error('Неизвестное действие.');
}

async function smokeTest() {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    let live;
    let media;
    if (mediaSmoke) {
      const started = Date.now();
      while (!service.state.nowPlaying?.title && Date.now() - started < 12000) await new Promise(resolve => setTimeout(resolve, 200));
      const track = service.state.nowPlaying;
      if (!track?.title || !track.cover) throw new Error('Медиасессия не передала трек с обложкой.');
      media = { title: track.title, artist: track.artist, cover: Boolean(track.cover), source: track.sourceId };
    }
    if (liveSmoke) {
      const catalogue = await service.catalogue();
      await service.prepareGuild(catalogue.guildId);
      await service.connect(store.value.voiceChannelId);
      await new Promise(resolve => setTimeout(resolve, 5500));
      live = { phase: service.state.phase, audioBytes: service.capture?.meter.bytes ?? 0,
        commandsReady: service.state.commandsReady, encryptedStorage: !fs.readFileSync(store.file, 'utf8').includes(store.value.token) };
      if (live.phase !== 'online' || !live.audioBytes || !live.commandsReady || !live.encryptedStorage) throw new Error(`Live check failed: ${JSON.stringify(live)}`);
    }
    const result = await window.webContents.executeJavaScript(`(async () => {
      const initial = await window.ymusic.call('init');
      const forbidden = await window.ymusic.call('not-a-method');
      return { initial: initial.ok, tokenExposed: 'token' in initial.value.settings,
        secure: typeof require === 'undefined', rejected: !forbidden.ok,
        heading: document.querySelector('h1').textContent, buttons: document.querySelectorAll('button').length,
        fits: document.documentElement.scrollWidth <= window.innerWidth };
    })()`);
    if (!result.initial || result.tokenExposed || !result.secure || !result.rejected || !result.fits) throw new Error(`UI smoke-test failed: ${JSON.stringify(result)}`);
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(app.getPath('userData'), 'smoke.png'), screenshot.toPNG());
    if (liveSmoke) {
      await service.leave();
      live.leaveKeepsCommands = service.client.isReady() && !service.wantedChannel && service.state.phase === 'idle';
      if (!live.leaveKeepsCommands) throw new Error('Leave did not preserve the command session.');
    }
    fs.writeFileSync(path.join(app.getPath('userData'), 'smoke.json'), JSON.stringify({ ...result, live, media }, null, 2));
    console.log(JSON.stringify({ ...result, live, media }));
    await nowPlaying?.close(); await service.close(); quitting = true; tray.destroy(); app.exit(0);
  } catch (error) { console.error(error); quitting = true; await nowPlaying?.close(); await service.close(); tray?.destroy(); app.exit(1); }
}
