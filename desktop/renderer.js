const $ = id => document.getElementById(id);
let settings = {}, state = {}, busy = false, catalogue = null, lastLogs = '', loadingCatalogue = false, sourceListKey = '';
let noticeTimer;
const labels = { offline: 'Не подключён', idle: 'Ожидание подключения', connecting: 'Подключение…', online: 'Трансляция активна', recovering: 'Восстановление…', error: 'Ошибка', sleeping: 'Режим сна' };

async function call(method, data) {
  const result = await window.ymusic.call(method, data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function notice(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = false;
  if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
}
function render(next) {
  const previousChannel = state.channelId;
  state = next;
  $('status').className = `status ${state.phase}`;
  $('status-label').textContent = labels[state.phase] || state.phase;
  $('message').textContent = state.message;
  const track = state.nowPlaying;
  $('channel-name').textContent = track?.title || state.channelName || 'Канал не выбран';
  $('air-label').textContent = track ? (state.phase !== 'online' ? 'СЕЙЧАС В ПЛЕЕРЕ' : track.playback === 'Paused' ? 'ПАУЗА' : 'СЕЙЧАС ИГРАЕТ') : state.phase === 'online' ? 'ТРАНСЛЯЦИЯ АКТИВНА' : 'ОЖИДАНИЕ ПОДКЛЮЧЕНИЯ';
  $('track-artist').hidden = !track?.artist; $('track-artist').textContent = track?.artist || '';
  $('track-cover').hidden = !track?.cover; $('disc').hidden = Boolean(track?.cover);
  if (track?.cover) {
    const src = `data:${track.cover.mime};base64,${track.cover.data}`;
    if ($('track-cover').getAttribute('src') !== src) $('track-cover').src = src;
  } else $('track-cover').removeAttribute('src');
  $('track-time').hidden = !track?.durationMs;
  if (track?.durationMs) {
    const position = Math.max(0, Math.min(track.durationMs, track.positionMs + (track.playback === 'Playing' ? Math.max(0, Date.now() - (track.updatedAt || track.sampledAt)) * track.rate : 0)));
    const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    $('track-time').textContent = `${clock(position)} / ${clock(track.durationMs)}`;
  }
  const sources = state.mediaSources || [], sourcesKey = JSON.stringify(sources);
  if (sourceListKey !== sourcesKey) {
    sourceListKey = sourcesKey;
    const selected = $('media-source').value || settings.mediaSourceId || '';
    const items = [...sources];
    if (selected && !items.some(item => item.id === selected)) items.push({ id: selected, name: `${selected} — недоступно` });
    options($('media-source'), items, selected, 'Авто: Яндекс Музыка');
  }
  const level = Math.round(Math.min(1, state.level || 0) * 100);
  $('meter').value = level;
  $('level-label').textContent = state.phase === 'online' ? `${level}%` : '—';
  $('signal-hint').textContent = state.phase !== 'online' ? 'Измерение доступно после подключения'
    : level ? 'Звук поступает в Discord' : settings.captureMode === 'device' ? 'Тишина: пауза в плеере или не выбран CABLE Input' : 'Сигнал отсутствует: требуется проверить воспроизведение в Яндекс Музыке';
  $('commands-state').textContent = state.commandsReady ? 'Команды зарегистрированы · ответы доступны инициатору' : 'Требуется авторизация бота';
  $('connect').disabled = busy || ['connecting', 'sleeping'].includes(state.phase) || !$('channel').value;
  $('disconnect').disabled = !['online', 'connecting', 'recovering', 'sleeping', 'error'].includes(state.phase);
  if (state.channelId && state.channelId !== previousChannel && $('channel').querySelector(`option[value="${state.channelId}"]`)) $('channel').value = state.channelId;
  const logKey = JSON.stringify(state.logs);
  if (logKey !== lastLogs) {
    lastLogs = logKey;
    $('logs').replaceChildren(...(state.logs || []).slice().reverse().map(item => {
      const li = document.createElement('li'), time = document.createElement('time');
      time.textContent = new Date(item.time).toLocaleTimeString('ru-RU');
      li.append(time, document.createTextNode(item.message)); return li;
    }));
  }
}
function options(select, items, selected, placeholder) {
  const list = [];
  if (placeholder !== undefined) { const option = document.createElement('option'); option.value = ''; option.textContent = placeholder; list.push(option); }
  for (const item of items) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; list.push(option); }
  select.replaceChildren(...list);
  if (selected && items.some(item => item.id === selected)) select.value = selected;
}
async function devices() {
  const mode = $('capture-mode').value;
  $('device-group').hidden = mode !== 'device'; $('application-group').hidden = mode !== 'process';
  if (mode === 'process') {
    const selected = $('application').value || settings.applicationPath || '';
    const info = await call('applications');
    const items = info.applications.map(app => ({ id: app.path, name: app.name }));
    if (selected && !items.some(item => item.id === selected)) items.push({ id: selected, name: 'Сохранённая Яндекс Музыка — не запущена' });
    options($('application'), items, selected, 'Авто: запущенная Яндекс Музыка');
    if (!info.supported) notice('Текущая сборка Windows не поддерживает WASAPI process loopback. Доступен режим «Аудиоустройство (VB-CABLE)».', true);
    else if (!info.applications.length) notice('Процесс Яндекс Музыки не обнаружен. Требуется запустить плеер и обновить список источников.');
    return;
  }
  const selected = $('device').value || settings.audioDevice;
  const values = await call('devices');
  const items = values.map(name => ({ id: name, name }));
  if (selected && !values.includes(selected)) items.unshift({ id: selected, name: `${selected} — недоступно` });
  options($('device'), items, selected, items.length ? undefined : 'Устройства не найдены');
}
async function channels(guildId) {
  if (loadingCatalogue) return;
  loadingCatalogue = true;
  try {
    catalogue = await call('catalogue', { guildId });
    options($('guild'), catalogue.guilds, catalogue.guildId, catalogue.guilds.length ? undefined : 'Бот не добавлен на сервер');
    options($('channel'), catalogue.channels, state.channelId || settings.voiceChannelId, catalogue.channels.length ? undefined : 'Нет каналов с нужными правами');
    options($('dj-role'), catalogue.roles, settings.djRoleId, 'Только владелец и администраторы');
    if (!catalogue.guilds.length) notice('Бот не добавлен на сервер. Ссылка приглашения доступна в настройках.', true);
    else if (!catalogue.channels.length) notice('Доступные голосовые каналы не обнаружены. Необходимы права View Channel, Connect и Speak.', true);
    render(state);
  } finally { loadingCatalogue = false; }
}
async function action(task) {
  if (busy) return;
  busy = true; $('save').disabled = true; $('refresh').disabled = true; render(state);
  try { await task(); }
  catch (error) { notice(error.message, true); }
  finally { busy = false; $('save').disabled = false; $('refresh').disabled = false; render(state); }
}
async function save() {
  if ($('capture-mode').value === 'device' && $('device').value && !/CABLE Output/i.test($('device').value) && !window.confirm('Выбрано устройство, отличное от CABLE Output. Оно может передавать микрофон или другие звуки компьютера. Использовать этот источник?')) return false;
  settings = await call('save', { token: $('token').value.trim(),
    voiceChannelId: $('channel').value || settings.voiceChannelId || '', guildId: $('guild').value || settings.guildId || '',
    audioDevice: $('device').value || settings.audioDevice, djRoleId: $('dj-role').value,
    captureMode: $('capture-mode').value, applicationPath: $('application').value,
    autoConnect: $('auto-connect').checked, autoStart: $('auto-start').checked,
    nowPlayingEnabled: $('now-playing').checked, mediaSourceId: $('media-source').value });
  $('token').value = ''; $('token-state').textContent = settings.hasToken ? 'сохранён' : 'не сохранён';
  return true;
}
$('save').onclick = () => action(async () => { if (await save()) { notice('Настройки сохранены.'); await channels($('guild').value); } });
$('connect').onclick = () => action(async () => { if (await save()) await call('connect', { channelId: $('channel').value }); });
$('disconnect').onclick = async () => { try { await call('disconnect'); } catch (error) { notice(error.message, true); } };
$('refresh').onclick = () => action(() => channels($('guild').value));
$('refresh-devices').onclick = () => action(devices);
$('capture-mode').onchange = () => action(devices);
$('guild').onchange = () => action(() => channels($('guild').value));
$('channel').onchange = () => render(state);
for (const [id, method] of [['hide', 'hide'], ['quit', 'quit'], ['cable', 'help'], ['portal', 'portal'], ['invite', 'invite'], ['author-github', 'author-github']]) {
  $(id).onclick = async () => { try { await call(method); } catch (error) { notice(error.message, true); } };
}
window.ymusic.onState(render);
(async () => {
  const initial = await call('init'); settings = initial.settings;
  $('version').textContent = `v${initial.version}`;
  $('auto-connect').checked = settings.autoConnect; $('auto-start').checked = settings.autoStart;
  $('now-playing').checked = settings.nowPlayingEnabled !== false;
  $('capture-mode').value = settings.captureMode || 'process';
  $('auto-start').disabled = !initial.packaged;
  $('token-state').textContent = settings.hasToken ? 'сохранён' : 'не сохранён';
  $('account').open = !settings.hasToken;
  render(initial.state);
  await devices();
  if (settings.hasToken) await action(() => channels(settings.guildId));
})().catch(error => notice(error.message, true));
