import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { generateDependencyReport } from '@discordjs/voice';
import { configPath, readConfig, validateConfig, redact } from './config.js';
import { ffmpegPath, listDevices, testAudio } from './audio.js';
import { startBot } from './bot.js';

let secret = process.env.DISCORD_BOT_TOKEN ?? '';

async function requireDevices() {
  if (process.platform !== 'win32') throw new Error('Эта сборка предназначена для Windows.');
  const { devices, diagnostic } = await listDevices();
  if (!devices.length) {
    throw new Error(`Нет доступных устройств записи. Установи VB-CABLE и перезагрузи Windows.\n${diagnostic.slice(-1500)}`);
  }
  return devices;
}

async function setup() {
  console.log('\nНастройка музыкального бота Discord\n');
  console.log('1. Создай приложение и бота: https://discord.com/developers/applications');
  console.log('2. На странице Bot нажми Reset Token / Copy. Токен вводится только здесь.');
  console.log('3. В Discord включи Режим разработчика, затем скопируй ID голосового канала.\n');
  const devices = await requireDevices();
  let existing = {};
  if (fs.existsSync(configPath)) {
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch { /* replace malformed config through the wizard */ }
  }
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  } });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  try {
    const reuse = existing.token ? await rl.question('Использовать сохранённый токен? [Y/n]: ') : 'n';
    let token = existing.token ?? '';
    if (/^(n|no|н|нет)$/i.test(reuse.trim())) {
      process.stdout.write('Токен бота (ввод скрыт): ');
      muted = true;
      try { token = (await rl.question('')).trim(); }
      finally { muted = false; process.stdout.write('\n'); }
    }
    secret = token;
    const voiceChannelId = (await rl.question(`ID голосового канала${existing.voiceChannelId ? ` [${existing.voiceChannelId}]` : ''}: `)).trim() || existing.voiceChannelId;
    console.log('\nУстройства захвата:');
    devices.forEach((device, index) => console.log(`  ${index + 1}. ${device}`));
    const cableIndex = devices.findIndex(name => /CABLE Output/i.test(name));
    const previousIndex = devices.indexOf(existing.audioDevice);
    const defaultIndex = previousIndex >= 0 ? previousIndex : cableIndex;
    const choice = (await rl.question(`Номер устройства${defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : ''}: `)).trim();
    const index = choice ? Number(choice) - 1 : defaultIndex;
    if (!Number.isInteger(index) || !devices[index]) throw new Error('Выбери номер устройства из списка.');
    const audioDevice = devices[index];
    if (!/CABLE Output/i.test(audioDevice)) {
      const answer = await rl.question('Выбрано устройство, отличное от CABLE Output. Оно может передавать микрофон или весь звук ПК. Продолжить? [y/N]: ');
      if (!/^(y|yes|д|да)$/i.test(answer.trim())) throw new Error('Настройка отменена. Выбери CABLE Output после установки VB-CABLE.');
    }
    const config = validateConfig({ token, voiceChannelId, audioDevice, bitrate: existing.bitrate ?? 128000 });
    console.log('\nПроверяю токен…');
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${config.token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Discord отклонил токен (HTTP ${response.status}). Нужен токен со страницы Bot.`);
    const bot = await response.json();
    if (!bot.bot) throw new Error('Нужен токен отдельного бота Discord.');
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    console.log(`\nНастройки сохранены. Бот: ${bot.username}`);
    console.log('Добавь бота на свой сервер по ссылке (View Channel, Connect, Speak):');
    console.log(`https://discord.com/oauth2/authorize?client_id=${bot.id}&permissions=3146752&scope=bot`);
    console.log('\nНаправь звук Яндекс Музыки в CABLE Input. У Discord оставь выход на наушники.');
    console.log('Потом запусти 02-start.cmd. Подробности — в README.md.');
  } finally { rl.close(); }
}

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === 'setup') return setup();
  if (command === 'devices') {
    (await requireDevices()).forEach((name, i) => console.log(`${i + 1}. ${name}`));
    return;
  }
  if (command === 'check') {
    console.log(`Node.js: ${process.version}\nFFmpeg: ${ffmpegPath}`);
    console.log(generateDependencyReport());
    const devices = await requireDevices();
    console.log('Устройства захвата:\n' + devices.map(d => `  ${d}`).join('\n'));
    if (!devices.some(d => /CABLE Output/i.test(d))) console.log('\nVB-CABLE не найден. Установи его: https://vb-audio.com/Cable/');
    if (fs.existsSync(configPath)) {
      const config = readConfig(); secret = config.token;
      console.log(`\nКанал: ${config.voiceChannelId}\nВыбранный вход: ${config.audioDevice}`);
      if (!devices.includes(config.audioDevice)) throw new Error('Сохранённое аудиоустройство не найдено. Запусти 01-setup.cmd.');
      console.log('Настройки корректны. Подключение к Discord проверяется при запуске бота.');
    } else console.log('\nНастройки ещё не сохранены. Запусти 01-setup.cmd.');
    return;
  }
  if (!['start', 'test-audio'].includes(command)) throw new Error('Команды: setup, start, devices, check, test-audio');
  const config = readConfig({ requireToken: command !== 'test-audio' });
  secret = config.token;
  const devices = await requireDevices();
  if (!devices.includes(config.audioDevice)) throw new Error('Выбранное аудиоустройство не найдено. Запусти 01-setup.cmd.');
  if (command === 'test-audio') {
    console.log(`Включи музыку. Проверяю ${config.audioDevice} в течение 6 секунд…`);
    const result = await testAudio(config.audioDevice);
    console.log(`Получено ${(result.bytes / 1024).toFixed(0)} КБ. Уровень сигнала: ${(result.peak * 100).toFixed(1)}%.`);
    console.log(result.peak > 0.0001 ? 'Звук поступает. Можно запускать бота.' : 'На входе тишина. Проверь музыку и выход плеера: CABLE Input.');
    return;
  }
  await startBot(config);
}

main().catch(error => {
  console.error(`\nОшибка: ${redact(error.message, secret)}`);
  process.exitCode = 1;
});
