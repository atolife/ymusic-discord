import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createAudioResource, StreamType } from '@discordjs/voice';
import OpusScript from 'opusscript';
import { validateConfig, redact } from '../src/config.js';
import { parseDevices, PcmMeter, ffmpegPath, runFfmpeg } from '../src/audio.js';

const valid = { token: 'test-token', voiceChannelId: '123456789012345678', audioDevice: 'CABLE Output' };

test('rejects invalid channel IDs, tokens, bitrate and malformed input', () => {
  assert.equal(validateConfig(valid).bitrate, 128000);
  for (const value of [null, [], { ...valid, voiceChannelId: '../channel' },
    { ...valid, token: 'PASTE_BOT_TOKEN_HERE' }, { ...valid, bitrate: '128000' },
    { ...valid, bitrate: 999999 }, { ...valid, audioDevice: 'bad\0device' }]) {
    assert.throws(() => validateConfig(value));
  }
});

test('token is redacted even when repeated in an error', () => {
  const message = redact('test-token test-token Authorization: Bot private-token', valid.token);
  assert.ok(!message.includes('test-token'));
  assert.ok(!message.includes('private-token'));
});

test('DirectShow parser selects audio, excludes camera and alternative names', () => {
  const text = `[dshow @ 1] "Camera" (video)\n[dshow @ 1] "CABLE Output (VB-Audio Virtual Cable)" (audio)\n[dshow @ 1]   Alternative name "@device_cm_123"\n[dshow @ 1] "Микрофон (USB)" (audio)\n[dshow @ 1] "CABLE Output (VB-Audio Virtual Cable)" (audio)`;
  assert.deepEqual(parseDevices(text), ['CABLE Output (VB-Audio Virtual Cable)', 'Микрофон (USB)']);
});

test('DirectShow parser also handles legacy device lists', () => {
  assert.deepEqual(parseDevices('[dshow @ 1] DirectShow video devices\n[dshow @ 1] "Camera"\n[dshow @ 1] DirectShow audio devices\n[dshow @ 1] "CABLE Output"\n[dshow @ 1] Alternative name "@device"'), ['CABLE Output']);
});

test('PCM meter preserves bytes across odd chunk boundaries and measures signal', async () => {
  const pcm = Buffer.alloc(8);
  [-32768, 0, 16384, -12345].forEach((value, i) => pcm.writeInt16LE(value, i * 2));
  const meter = new PcmMeter();
  const chunks = [];
  meter.on('data', data => chunks.push(data));
  const ended = once(meter, 'end');
  meter.write(pcm.subarray(0, 1));
  meter.write(pcm.subarray(1, 4));
  meter.end(pcm.subarray(4));
  await ended;
  assert.deepEqual(Buffer.concat(chunks), pcm);
  assert.equal(meter.bytes, pcm.length);
  assert.equal(meter.takePeak(), 1);
  assert.equal(meter.takePeak(), 0);
});

test('bundled FFmpeg runs and supports DirectShow', async () => {
  const result = await runFfmpeg(['-hide_banner', '-devices']);
  // -devices prints to stdout, which runFfmpeg intentionally ignores.
  assert.equal(result.code, 0);
  const version = await runFfmpeg(['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy']);
  assert.ok(!/Unknown input format/.test(version.stderr));
});

test('real FFmpeg PCM passes through the production meter and Discord Opus encoder', { timeout: 15000 }, async () => {
  const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=48000:duration=0.12', '-ac', '2',
    '-ar', '48000', '-f', 's16le', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const meter = new PcmMeter();
  const resource = createAudioResource(meter, { inputType: StreamType.Raw });
  assert.ok(resource.encoder);
  resource.encoder.setBitrate(64000);
  child.stdout.pipe(meter);
  const packets = [];
  for await (const packet of resource.playStream) packets.push(packet);
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  assert.equal(meter.bytes, 48000 * 2 * 2 * 0.12);
  assert.ok(meter.takePeak() > 0.01);
  assert.equal(packets.length, 6);
  const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
    const decoded = packets.map(packet => decoder.decode(packet));
    assert.equal(Buffer.concat(decoded).length, meter.bytes);
  } finally { decoder.delete(); }
});
