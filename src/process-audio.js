import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PcmMeter, listDevices, openCapture } from './audio.js';

export const helperPath = fileURLToPath(new URL('../native/ProcessAudio.exe', import.meta.url));
export function parseApplications(packet) {
  if (!packet || !Array.isArray(packet.applications)) throw new Error('Некорректный ответ помощника захвата звука.');
  return { supported: packet.supported === true, build: Number(packet.build) || 0,
    applications: packet.applications.filter(item => Number.isInteger(item.pid) && item.pid > 0 && item.pid <= 0xffffffff
      && /^\d{16,19}$/.test(item.startTicks) && typeof item.path === 'string' && !/[\0\r\n]/.test(item.path)
      && /(?:^|[\\/])(?:Яндекс Музыка|YandexMusic)\.exe$/i.test(item.path))
      .map(item => ({ pid: item.pid, startTicks: item.startTicks, path: item.path, name: 'Яндекс Музыка' })) };
}
export function listApplications() {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, ['--list'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, 8000);
    child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-200000); });
    child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-4000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (expired) { reject(new Error('Windows не ответила при поиске Яндекс Музыки.')); return; }
      if (code) { reject(new Error(errors.trim() || 'Не удалось найти приложение Яндекс Музыки.')); return; }
      try { resolve(parseApplications(JSON.parse(output.replace(/^\uFEFF/, '')))); }
      catch { reject(new Error('Не удалось прочитать список приложений захвата.')); }
    });
  });
}
export function selectApplication(info, executable = '') {
  if (!info.supported) throw new Error('Прямой захват требует Windows build 20348 или новее. Выберите аудиоустройство VB-CABLE.');
  const matches = executable ? info.applications.filter(item => item.path.toLowerCase() === executable.toLowerCase()) : info.applications;
  if (!matches.length) throw new Error('Откройте настольную Яндекс Музыку. Затем повторите подключение или обновите список приложений.');
  if (matches.length !== 1) throw new Error('Найдено несколько экземпляров Яндекс Музыки. Оставь запущенным один экземпляр.');
  return matches[0];
}
export function processCaptureArgs(application) {
  const safe = parseApplications({ supported: true, applications: [application] }).applications[0];
  if (!safe) throw new Error('Некорректный источник захвата приложения.');
  return ['--capture', String(safe.pid), safe.startTicks, safe.path];
}
export async function resolveCaptureSource(config, dependencies = {}) {
  if ((config.captureMode ?? 'process') === 'process') {
    const info = await (dependencies.listApplications ?? listApplications)();
    const application = selectApplication(info, config.applicationPath ?? '');
    return { mode: 'process', application, label: 'Яндекс Музыка · прямой захват' };
  }
  if (config.captureMode !== 'device') throw new Error('Неизвестный способ захвата звука.');
  const { devices } = await (dependencies.listDevices ?? listDevices)();
  if (!devices.includes(config.audioDevice)) throw new Error('Выбранное аудиоустройство недоступно. Проверьте его подключение.');
  return { mode: 'device', audioDevice: config.audioDevice, label: config.audioDevice };
}
export function openProcessCapture(application, onFailure) {
  const child = spawn(helperPath, processCaptureArgs(application), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const meter = new PcmMeter(); let errors = '', stopped = false, failed = false;
  const fail = error => { if (!stopped && !failed) { failed = true; onFailure(error); } };
  child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-4000); });
  child.once('error', fail);
  child.once('close', code => fail(new Error(`Прямой захват остановился (${code}). ${errors.replace(/^READY[^\r\n]*[\r\n]*/m, '').trim()}`)));
  child.stdout.on('error', fail); meter.on('error', fail); child.stdout.pipe(meter);
  return { meter, mode: 'process', stop() {
    if (stopped) return; stopped = true; child.stdout.unpipe(meter); meter.destroy(); child.kill();
  } };
}
export function openResolvedCapture(source, onFailure) {
  return source.mode === 'process' ? openProcessCapture(source.application, onFailure) : openCapture(source.audioDevice, onFailure);
}
