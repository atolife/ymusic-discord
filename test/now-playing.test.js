import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { normalizeSession, selectSession, trackPosition, decodeCover } from '../src/media.js';
import { NowPlayingPublisher, cardPayload } from '../src/now-playing.js';
import { NowPlayingController } from '../src/now-playing-controller.js';

const channelId = '123456789012345678', guildId = '223456789012345678';
const track = { sourceId: 'ru.yandex.desktop.music', name: 'Яндекс Музыка', title: 'Трек', artist: 'Исполнитель',
  album: 'Альбом', playback: 'Playing', positionMs: 10000, durationMs: 180000, updatedAt: 1000000, sampledAt: 1000000, rate: 1, cover: null };
const turn = () => new Promise(resolve => setImmediate(resolve));
function harness(records = {}) {
  let clock = 1000000, next = 0;
  const jobs = new Map(), edits = [], sends = [], saved = [], logs = [];
  const message = { id: '323456789012345678', author: { id: 'bot' }, async edit(payload) { edits.push(payload); return this; } };
  const channel = { messages: { fetch: async () => message }, async send(payload) { sends.push(payload); return message; } };
  const publisher = new NowPlayingPublisher({ records, getChannel: async () => channel, getBotId: () => 'bot',
    persist: value => saved.push(value), log: value => logs.push(value), now: () => clock,
    schedule(fn, delay) { jobs.set(++next, { fn, delay }); return next; }, clear(id) { jobs.delete(id); } });
  return { publisher, edits, sends, saved, logs, message, channel, jobs,
    advance(ms) { clock += ms; },
    async step() {
      const [id, job] = jobs.entries().next().value; jobs.delete(id); clock += job.delay; job.fn();
      await turn(); await turn();
    },
  };
}
const online = item => ({ online: true, guildId, channelId, track: item });

test('auto selection chooses Yandex and never leaks the active browser video into the card', () => {
  const browser = { ...track, sourceId: 'Chrome', name: 'Chrome', title: 'Private video' };
  assert.equal(selectSession([browser, track]), track);
  assert.equal(selectSession([browser]), null);
  assert.equal(selectSession([browser, track], 'missing'), null);
  assert.equal(selectSession([browser, track], 'Chrome'), browser);
});
test('timeline extrapolates playing, freezes paused and clamps to duration', () => {
  assert.equal(trackPosition(track, 1005000), 15000);
  assert.equal(trackPosition({ ...track, playback: 'Paused' }, 1005000), 10000);
  assert.equal(trackPosition(track, 999999999), 180000);
});
test('cover validation accepts Windows image data and rejects arbitrary payloads', () => {
  const png = fs.readFileSync(new URL('../desktop/icon.png', import.meta.url)).toString('base64');
  assert.equal(decodeCover({ data: png }).mime, 'image/png');
  assert.equal(decodeCover({ data: Buffer.from('<svg>not-a-cover</svg>').toString('base64') }), null);
  assert.equal(decodeCover({ data: 'a'.repeat(3000000) }), null);
  const session = normalizeSession({ ...track, cover: { data: png }, durationMs: Infinity, title: 'a\0b' });
  assert.equal(session.title, 'a b'); assert.equal(session.durationMs, 0);
});
test('the Discord card includes time, paused state, attachment and disables mentions', () => {
  const png = fs.readFileSync(new URL('../desktop/icon.png', import.meta.url)).toString('base64');
  const payload = cardPayload({ ...track, playback: 'Paused', cover: { data: png } }, { online: true, now: 1005000 });
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Пауза/); assert.equal(embed.fields[0].name, '0:10 / 3:00');
  assert.equal(embed.thumbnail.url, 'attachment://cover.png'); assert.equal(payload.files.length, 1);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(cardPayload(null, { online: true }).embeds[0].toJSON().title, 'Ожидаю Яндекс Музыку');
});
test('track changes and progress edit one message instead of sending a new card', async () => {
  const h = harness();
  h.publisher.update(online(track)); await h.step();
  h.advance(12000); h.publisher.update(online(track)); await h.step();
  h.advance(3000); h.publisher.update(online({ ...track, title: 'Следующий трек' })); await h.step();
  assert.equal(h.sends.length, 1); assert.equal(h.edits.length, 2);
  assert.equal(h.edits.at(-1).embeds[0].toJSON().title, 'Следующий трек');
  assert.equal(h.saved[0][channelId], h.message.id);
  await h.publisher.close();
});
test('restarting restores the saved message and deleted messages are replaced once', async () => {
  const h = harness({ [channelId]: '423456789012345678' });
  h.publisher.update(online(track)); await h.step();
  assert.equal(h.sends.length, 0); assert.equal(h.edits.length, 1);
  h.message.edit = async () => { const error = new Error('Unknown Message'); error.code = 10008; throw error; };
  h.advance(12000); h.publisher.update(online(track)); await h.step();
  assert.equal(h.sends.length, 1);
  await h.publisher.close();
});
test('permission errors throttle retries and do not create messages', async () => {
  const h = harness();
  h.publisher.getChannel = async () => { throw new Error('Нет прав отправки'); };
  h.publisher.update(online(track)); await h.step();
  assert.equal(h.sends.length, 0); assert.equal(h.logs.length, 1);
  assert.ok([...h.jobs.values()][0].delay >= 30000);
  await h.publisher.close(); assert.equal(h.jobs.size, 0);
});
test('closing during a pending channel fetch prevents a late message send', async () => {
  const h = harness(); let resolve;
  h.publisher.getChannel = () => new Promise(done => { resolve = done; });
  h.publisher.update(online(track));
  const flushing = h.publisher.flush();
  const closing = h.publisher.close();
  resolve(h.channel); await flushing; await closing;
  assert.equal(h.sends.length, 0);
});
test('disconnect freezes the old card even as local listening moves to another track', async () => {
  const service = new EventEmitter();
  service.state = { phase: 'offline', channelId: '', guildId };
  service.update = patch => { Object.assign(service.state, patch); service.emit('state', service.state); };
  service.log = () => {};
  const monitor = new EventEmitter(); monitor.sessions = []; monitor.start = () => {}; monitor.stop = () => {};
  const controller = new NowPlayingController(service, { config: {}, persist: () => {}, monitor });
  const h = harness(); await controller.publisher.close(); controller.publisher = h.publisher;
  monitor.emit('sessions', [track]); service.update({ phase: 'online', channelId }); await h.step();
  service.update({ phase: 'idle', channelId: '' }); await h.step();
  const editsBefore = h.edits.length;
  monitor.emit('sessions', [{ ...track, title: 'Личное прослушивание после эфира' }]);
  assert.equal(h.jobs.size, 0); assert.equal(h.edits.length, editsBefore);
  assert.equal(controller.publisher.latest.track.title, 'Трек');
  assert.equal(controller.publisher.latest.track.playback, 'Stopped');
  await controller.close();
});
