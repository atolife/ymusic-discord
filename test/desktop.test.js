import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RecoveryScheduler, canControl, inviteUrl } from '../src/recovery.js';
import { MusicService, commandDefinitions } from '../src/service.js';
const require = createRequire(import.meta.url);
const { SettingsStore } = require('../desktop/settings.cjs');
const channelId = '123456789012345678';
const config = { token: 'dummy-token', voiceChannelId: channelId, audioDevice: 'CABLE Output', bitrate: 64000 };
function fakeClock() {
  const jobs = new Map(); let count = 0;
  return { jobs, schedule(fn) { jobs.set(++count, fn); return count; }, clear(id) { jobs.delete(id); },
    async next() { const [id, job] = jobs.entries().next().value; jobs.delete(id); await job(); } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('recovery deduplicates retries and cancels callbacks already handed to a timer', async () => {
  const clock = fakeClock(), retry = new RecoveryScheduler(clock); let called = 0;
  retry.next(() => called++); retry.next(() => called++);
  assert.equal(clock.jobs.size, 1);
  const stale = [...clock.jobs.values()][0];
  retry.cancel(); stale();
  assert.equal(called, 0);
  retry.reset(); retry.next(() => called++); await clock.next();
  assert.equal(called, 1);
});

test('command control requires owner, admin or explicitly selected DJ role', () => {
  const base = { userId: 'listener', applicationOwnerId: 'app-owner', guildOwnerId: 'server-owner', djRoleId: 'dj', roleIds: [] };
  assert.equal(canControl(base), false);
  assert.equal(canControl({ ...base, userId: 'app-owner' }), true);
  assert.equal(canControl({ ...base, userId: 'server-owner' }), true);
  assert.equal(canControl({ ...base, isAdministrator: true }), true);
  assert.equal(canControl({ ...base, roleIds: ['dj'] }), true);
  assert.equal(canControl({ ...base, roleIds: ['other-role'] }), false);
  assert.deepEqual(commandDefinitions.map(command => command.name), ['join', 'leave', 'status']);
  assert.match(inviteUrl(channelId), /applications.commands/);
});

test('leave cancels an in-flight join before it can fetch or enter a channel', async () => {
  const service = new MusicService(config);
  let resolveSession, fetches = 0;
  service.session = () => new Promise(resolve => { resolveSession = resolve; });
  const connecting = service.connect(channelId);
  await turn();
  await service.leave();
  resolveSession({ channels: { fetch() { fetches++; } } });
  await connecting;
  assert.equal(fetches, 0);
  assert.equal(service.wantedChannel, '');
  await service.close();
});

test('repeated failures stop at the retry budget and leave cancels remaining work', async () => {
  const service = new MusicService(config), clock = fakeClock();
  service.recovery = new RecoveryScheduler(clock);
  service.wantedChannel = channelId;
  let attempts = 0;
  service.connectTarget = async () => { attempts++; throw new Error('Нет сети'); };
  service.failed(new Error('Нет сети'));
  while (clock.jobs.size) { await clock.next(); await turn(); }
  assert.equal(attempts, 6);
  assert.equal(service.state.phase, 'error');
  await service.leave();
  assert.equal(service.wantedChannel, '');
  assert.equal(clock.jobs.size, 0);
  await service.close();
});

test('resume restores intended playback but never rejoins after a moderator disconnect', async () => {
  const service = new MusicService(config), clock = fakeClock();
  service.recovery = new RecoveryScheduler(clock);
  service.wantedChannel = channelId;
  service.suspend(); service.resume();
  assert.equal(clock.jobs.size, 1);
  service.client = { user: { id: 'bot' }, isReady: () => true, destroy: async () => {} };
  service.connection = { state: { status: 'ready' }, destroy() {} };
  service.onVoiceState({ channelId }, { id: 'bot', channelId: null });
  assert.equal(service.wantedChannel, '');
  assert.equal(clock.jobs.size, 0);
  service.suspend(); service.resume();
  assert.equal(clock.jobs.size, 0);
  await service.close();
});

test('retry budget resets only after sustained PCM, including silent music pauses', async () => {
  const service = new MusicService(config);
  service.recovery.attempt = 3;
  service.capture = { startedAt: Date.now(), goodSince: 0,
    meter: { bytes: 0, lastDataAt: Date.now(), takePeak: () => 0 }, stop() {} };
  service.tick(); assert.equal(service.recovery.attempt, 3);
  service.capture.meter.bytes = 192000;
  service.capture.goodSince = Date.now() - 9000;
  service.tick(); assert.equal(service.recovery.attempt, 0);
  await service.close();
});

test('settings migrate once, encrypt tokens and never expose them to the renderer', () => {
  const scratch = path.join(os.tmpdir(), 'ymusic-tests');
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, 'settings-test-'));
  const encryption = { isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`), decryptString: value => value.toString().slice(7) };
  const legacy = path.join(directory, 'legacy.json');
  fs.writeFileSync(legacy, JSON.stringify(config));
  const store = new SettingsStore(path.join(directory, 'app'), encryption);
  store.load([legacy]);
  assert.equal(store.value.token, config.token);
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(config.token));
  assert.equal('token' in store.public(), false);
  assert.equal(store.public().hasToken, true);
  assert.equal(store.public().autoStart, false);
  store.save({ djRoleId: channelId });
  const reloaded = new SettingsStore(path.join(directory, 'app'), encryption);
  reloaded.load([legacy]);
  assert.equal(reloaded.value.djRoleId, channelId);
  assert.equal(reloaded.value.token, config.token);
  assert.throws(() => store.save({ voiceChannelId: 'bad' }));
  assert.throws(() => store.save({ audioDevice: 'bad\0device' }));
});
