import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./media-sessions.ps1', import.meta.url));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
export function normalizeSession(value) {
  const now = Date.now();
  const title = text(value.title).slice(0, 256), artist = text(value.artist).slice(0, 512);
  const durationMs = Math.max(0, Math.min(86400000, finite(value.durationMs)));
  const cover = decodeCover(value.cover);
  return { sourceId: text(value.sourceId).slice(0, 1024), name: text(value.name).slice(0, 256),
    title, artist, album: text(value.album).slice(0, 256),
    playback: ['Playing', 'Paused', 'Stopped', 'Closed', 'Opened', 'Changing'].includes(value.playback) ? value.playback : 'Stopped',
    positionMs: Math.max(0, finite(value.positionMs)), durationMs,
    updatedAt: Math.min(now, Math.max(0, finite(value.updatedAt, now))),
    sampledAt: Math.min(now, Math.max(0, finite(value.sampledAt, now))),
    rate: Math.max(0, Math.min(4, finite(value.rate, 1))),
    cover: cover ? { mime: cover.mime, data: cover.buffer.toString('base64') } : null };
}
export function decodeCover(value) {
  if (!value || typeof value.data !== 'string' || value.data.length > 2800000) return null;
  const buffer = Buffer.from(value.data, 'base64');
  if (!buffer.length || buffer.length > 2097152) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { buffer, mime: 'image/png', extension: 'png' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { buffer, mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { buffer, mime: 'image/webp', extension: 'webp' };
  return null;
}
export function selectSession(sessions, sourceId = '') {
  if (sourceId) return sessions.find(session => session.sourceId === sourceId) ?? null;
  // Never fall back to the Windows "current session": it may be a video or a different player.
  return sessions.find(session => /yandex.*music|music.*yandex|яндекс.*музык/i.test(`${session.sourceId} ${session.name}`)) ?? null;
}
export function trackPosition(track, now = Date.now()) {
  if (!track) return 0;
  const elapsed = track.playback === 'Playing' ? Math.max(0, now - (track.updatedAt || track.sampledAt || now)) * track.rate : 0;
  return Math.max(0, Math.min(track.durationMs || Infinity, track.positionMs + elapsed));
}
export function formatTime(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export class MediaMonitor extends EventEmitter {
  constructor() { super(); this.sessions = []; this.child = null; this.stopped = true; this.restart = null; this.failures = 0; }
  start() {
    if (this.child || !this.stopped) return;
    this.stopped = false; this.failures = 0; this.launch();
  }
  launch() {
    if (this.stopped) return;
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    let pending = '', errors = '', reported = false;
    const fail = message => { if (!reported && !this.stopped) { reported = true; this.emit('warning', message); } };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      if (pending.length > 12000000) { pending = ''; fail('Медиасессия вернула слишком большой ответ.'); child.kill(); return; }
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
        if (!line) continue;
        try {
          const packet = JSON.parse(line);
          if (packet.error) { fail(`Данные плеера недоступны: ${text(packet.error).slice(0, 300)}`); continue; }
          if (!Array.isArray(packet.sessions)) continue;
          this.failures = 0;
          this.sessions = packet.sessions.slice(0, 20).map(normalizeSession).filter(session => session.sourceId);
          this.emit('sessions', this.sessions);
        } catch { fail('Не удалось прочитать данные медиасессии Windows.'); }
      }
    });
    child.stderr.on('data', data => { errors = (errors + data).slice(-1000); });
    child.on('error', error => fail(error.message));
    child.on('close', code => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return;
      this.sessions = []; this.emit('sessions', []);
      fail(`Чтение плеера остановлено (${code}). ${errors.trim()}`);
      if (++this.failures <= 3) this.restart = setTimeout(() => this.launch(), 5000);
    });
  }
  stop() {
    this.stopped = true; clearTimeout(this.restart);
    const child = this.child; this.child = null; child?.kill(); this.sessions = [];
  }
}
