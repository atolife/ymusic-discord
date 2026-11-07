const fs = require('node:fs');
const path = require('node:path');

const defaults = { voiceChannelId: '', guildId: '', audioDevice: 'CABLE Output (VB-Audio Virtual Cable)',
  bitrate: 128000, djRoleId: '', autoConnect: false, autoStart: false,
  nowPlayingEnabled: true, mediaSourceId: '', nowPlayingMessages: {}, captureMode: 'process', applicationPath: '' };

class SettingsStore {
  constructor(directory, encryption) {
    this.directory = directory;
    this.file = path.join(directory, 'settings.json');
    this.encryption = encryption;
    this.value = { ...defaults, token: '' };
  }
  load(legacyPaths = []) {
    if (fs.existsSync(this.file)) {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const token = raw.encryptedToken ? this.encryption.decryptString(Buffer.from(raw.encryptedToken, 'base64')) : '';
      this.value = this.validate({ ...defaults, ...raw, token });
      return this.value;
    }
    for (const file of legacyPaths) {
      if (!fs.existsSync(file)) continue;
      const legacy = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      this.save({ ...defaults, ...legacy });
      return this.value;
    }
    return this.value;
  }
  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные настройки.');
    const next = { ...defaults };
    for (const key of ['voiceChannelId', 'guildId', 'djRoleId']) {
      next[key] = String(value[key] ?? '').trim();
      if (next[key] && !/^\d{17,20}$/.test(next[key])) throw new Error(`Некорректный ID: ${key}.`);
    }
    next.audioDevice = String(value.audioDevice ?? defaults.audioDevice).trim();
    if (!next.audioDevice || /[\0\r\n]/.test(next.audioDevice)) throw new Error('Выберите корректное аудиоустройство.');
    next.bitrate = value.bitrate ?? defaults.bitrate;
    if (!Number.isInteger(next.bitrate) || next.bitrate < 16000 || next.bitrate > 384000) throw new Error('Некорректный битрейт.');
    next.token = String(value.token ?? '').trim();
    if (/[\s\r\n]/.test(next.token) || /PASTE_/.test(next.token)) throw new Error('Некорректный токен бота.');
    next.autoConnect = value.autoConnect === true;
    next.autoStart = value.autoStart === true;
    next.captureMode = value.captureMode ?? 'process';
    if (!['process', 'device'].includes(next.captureMode)) throw new Error('Некорректный способ захвата звука.');
    next.applicationPath = String(value.applicationPath ?? '').trim();
    if (next.applicationPath && (!/(?:^|[\\/])(?:Яндекс Музыка|YandexMusic)\.exe$/i.test(next.applicationPath)
      || /[\0\r\n]/.test(next.applicationPath) || next.applicationPath.length > 4096)) throw new Error('Выберите приложение Яндекс Музыки из списка.');
    next.nowPlayingEnabled = value.nowPlayingEnabled !== false;
    next.mediaSourceId = String(value.mediaSourceId ?? '').trim();
    if (next.mediaSourceId.length > 1024 || /[\0\r\n]/.test(next.mediaSourceId)) throw new Error('Некорректный источник сведений о треке.');
    next.nowPlayingMessages = {};
    if (value.nowPlayingMessages && typeof value.nowPlayingMessages === 'object') {
      for (const [channel, message] of Object.entries(value.nowPlayingMessages).slice(-20)) {
        if (/^\d{17,20}$/.test(channel) && /^\d{17,20}$/.test(message)) next.nowPlayingMessages[channel] = message;
      }
    }
    return next;
  }
  save(patch) {
    const next = this.validate({ ...this.value, ...patch });
    if (next.token && !this.encryption.isEncryptionAvailable()) throw new Error('Windows не предоставила защищённое хранилище токена.');
    const { token, ...publicFields } = next;
    const raw = { ...publicFields, encryptedToken: token ? this.encryption.encryptString(token).toString('base64') : '' };
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(raw, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.value = next;
    return this.public();
  }
  public() { const { token, nowPlayingMessages, ...settings } = this.value; return { ...settings, hasToken: Boolean(token) }; }
}
module.exports = { SettingsStore };
