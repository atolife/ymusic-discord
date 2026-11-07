import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseApplications, selectApplication, processCaptureArgs, resolveCaptureSource } from '../src/process-audio.js';
const require = createRequire(import.meta.url);
const { SettingsStore } = require('../desktop/settings.cjs');
const application = { pid: 22568, startTicks: '639296479947931550', path: 'C:\\Apps\\YandexMusic\\Яндекс Музыка.exe', name: 'Яндекс Музыка' };
const supported = { supported: true, build: 26200, applications: [application] };

test('native source parser only accepts Yandex and exact process identities', () => {
  const parsed = parseApplications({ ...supported, applications: [application,
    { ...application, path: 'C:\\Apps\\Discord.exe' }, { ...application, startTicks: 'bad' },
    { ...application, pid: -1 }, { ...application, path: 'bad\0Яндекс Музыка.exe' }] });
  assert.equal(parsed.applications.length, 1);
  assert.deepEqual(processCaptureArgs(parsed.applications[0]), ['--capture', '22568', application.startTicks, application.path]);
  assert.throws(() => processCaptureArgs({ ...application, path: 'cmd.exe' }));
});
test('missing or ambiguous targets fail without falling back to system sound', () => {
  assert.throws(() => selectApplication({ ...supported, supported: false }));
  assert.throws(() => selectApplication({ ...supported, applications: [] }));
  assert.throws(() => selectApplication({ ...supported, applications: [application, { ...application, pid: 99 }] }));
  assert.throws(() => selectApplication(supported, 'C:\\Another\\Яндекс Музыка.exe'));
  assert.equal(selectApplication(supported, application.path.toUpperCase()).pid, 22568);
});
test('process capture does not require an audio cable or enumerate recording devices', async () => {
  let deviceQueries = 0;
  const source = await resolveCaptureSource({ captureMode: 'process' }, {
    listApplications: async () => supported,
    listDevices: async () => { deviceQueries++; throw new Error('No audio cable'); },
  });
  assert.equal(source.mode, 'process'); assert.equal(source.application.pid, application.pid);
  assert.equal(deviceQueries, 0);
});
test('each reconnect resolves the current PID while preserving the selected executable', async () => {
  let calls = 0;
  const dependencies = { listApplications: async () => ({ ...supported,
    applications: [{ ...application, pid: ++calls === 1 ? 10 : 20 }] }) };
  const config = { captureMode: 'process', applicationPath: application.path };
  assert.equal((await resolveCaptureSource(config, dependencies)).application.pid, 10);
  assert.equal((await resolveCaptureSource(config, dependencies)).application.pid, 20);
});
test('device mode retains the previous cable source and refuses missing devices', async () => {
  const source = await resolveCaptureSource({ captureMode: 'device', audioDevice: 'CABLE Output' }, {
    listDevices: async () => ({ devices: ['CABLE Output'] }), listApplications: async () => { throw new Error('Should not run'); },
  });
  assert.equal(source.mode, 'device'); assert.equal(source.audioDevice, 'CABLE Output');
  await assert.rejects(resolveCaptureSource({ captureMode: 'device', audioDevice: 'Missing' }, { listDevices: async () => ({ devices: [] }) }));
});
test('settings migrate to direct capture while keeping the old cable for rollback', () => {
  const store = new SettingsStore('unused', {});
  const next = store.validate({ audioDevice: 'CABLE Output', voiceChannelId: '123456789012345678' });
  assert.equal(next.captureMode, 'process'); assert.equal(next.audioDevice, 'CABLE Output');
  assert.equal(store.validate({ ...next, captureMode: 'device' }).captureMode, 'device');
  assert.throws(() => store.validate({ ...next, captureMode: 'system' }));
  assert.throws(() => store.validate({ ...next, applicationPath: 'C:\\Apps\\Discord.exe' }));
});
