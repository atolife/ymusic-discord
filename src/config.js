import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const configPath = path.join(root, 'config.json');

export function validateConfig(value, { requireToken = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config.json должен содержать объект с настройками.');
  }
  const config = {
    token: String(value.token ?? '').trim(),
    voiceChannelId: String(value.voiceChannelId ?? '').trim(),
    audioDevice: String(value.audioDevice ?? '').trim(),
    bitrate: value.bitrate ?? 128000,
  };
  if (requireToken && (!config.token || /PASTE_|[\s\r\n]/.test(config.token))) {
    throw new Error('Укажи токен бота через 01-setup.cmd.');
  }
  if (!/^\d{17,20}$/.test(config.voiceChannelId)) {
    throw new Error('Нужен ID голосового канала (17–20 цифр). Запусти 01-setup.cmd.');
  }
  if (!config.audioDevice || /[\r\n\0]/.test(config.audioDevice)) {
    throw new Error('Не выбрано корректное устройство захвата звука.');
  }
  if (!Number.isInteger(config.bitrate) || config.bitrate < 16000 || config.bitrate > 384000) {
    throw new Error('bitrate должен быть целым числом от 16000 до 384000.');
  }
  return config;
}

export function readConfig({ requireToken = true } = {}) {
  if (!fs.existsSync(configPath)) throw new Error('Сначала запусти 01-setup.cmd.');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Не удалось прочитать config.json. Запусти 01-setup.cmd заново.');
  }
  if (process.env.DISCORD_BOT_TOKEN) raw.token = process.env.DISCORD_BOT_TOKEN;
  return validateConfig(raw, { requireToken });
}

export function redact(message, token) {
  let safe = String(message);
  if (token) safe = safe.split(token).join('[ТОКЕН СКРЫТ]');
  return safe.replace(/(Bot|Bearer)\s+\S+/gi, '$1 [ТОКЕН СКРЫТ]');
}
