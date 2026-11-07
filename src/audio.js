import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';

export { ffmpegPath };
export const PCM_BYTES_PER_SECOND = 48000 * 2 * 2;

export function parseDevices(stderr) {
  const devices = [];
  let legacyAudioSection = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (/DirectShow audio devices/i.test(line)) legacyAudioSection = true;
    if (/DirectShow video devices/i.test(line)) legacyAudioSection = false;
    if (/Alternative name/.test(line)) continue;
    const match = line.match(/\]\s+"(.+)"\s+\(audio\)/)
      ?? (legacyAudioSection ? line.match(/\]\s+"(.+)"\s*$/) : null);
    if (match && !devices.includes(match[1])) devices.push(match[1]);
  }
  return devices;
}

export function runFfmpeg(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-24000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('FFmpeg не ответил вовремя. Проверьте аудиоустройство.'));
      else resolve({ code, stderr });
    });
  });
}

export async function listDevices() {
  const result = await runFfmpeg(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  // FFmpeg intentionally exits with a nonzero status when listing DirectShow devices.
  return { devices: parseDevices(result.stderr), diagnostic: result.stderr };
}

export function captureArgs(device) {
  // spawn receives separate arguments. Device names are never executed by a shell.
  return ['-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-f', 'dshow', '-audio_buffer_size', '50', '-rtbufsize', '4M',
    '-i', `audio=${device}`, '-vn', '-ac', '2', '-ar', '48000',
    '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'];
}

export class PcmMeter extends Transform {
  constructor() {
    super({ highWaterMark: 3840 * 10 });
    this.bytes = 0;
    this.peak = 0;
    this.lastDataAt = 0;
    this.pendingByte = null;
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    this.lastDataAt = Date.now();
    let offset = 0;
    if (this.pendingByte !== null && chunk.length) {
      const unsigned = this.pendingByte | (chunk[0] << 8);
      this.peak = Math.max(this.peak, Math.abs(unsigned >= 32768 ? unsigned - 65536 : unsigned));
      offset = 1;
      this.pendingByte = null;
    }
    for (; offset + 1 < chunk.length; offset += 2) {
      this.peak = Math.max(this.peak, Math.abs(chunk.readInt16LE(offset)));
    }
    if (offset < chunk.length) this.pendingByte = chunk[offset];
    callback(null, chunk);
  }

  takePeak() {
    const peak = this.peak / 32768;
    this.peak = 0;
    return peak;
  }
}

export function openCapture(device, onFailure) {
  const child = spawn(ffmpegPath, captureArgs(device), {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const meter = new PcmMeter();
  let stderr = '';
  let stopping = false;
  let failed = false;
  const fail = error => {
    if (!stopping && !failed) { failed = true; onFailure(error); }
  };
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
  child.once('error', fail);
  child.once('close', code => {
    fail(new Error(`Захват звука остановился (код ${code}). ${stderr.trim()}`));
  });
  child.stdout.on('error', fail);
  meter.on('error', fail);
  child.stdout.pipe(meter);
  return {
    meter,
    stop() {
      if (stopping) return;
      stopping = true;
      child.stdout.unpipe(meter);
      meter.destroy();
      child.kill();
    },
  };
}

export async function testAudio(device, seconds = 6) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const capture = openCapture(device, error => finish(error));
    // Consume bytes locally without writing a recording to disk or sending to Discord.
    capture.meter.resume();
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      capture.stop();
      if (error) reject(error);
      else if (!capture.meter.bytes) reject(new Error('Устройство открылось, но не передало аудиоданные.'));
      else resolve({ bytes: capture.meter.bytes, peak: capture.meter.takePeak() });
    }
    timer = setTimeout(() => finish(), seconds * 1000);
  });
}
