import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityType } from 'discord.js';
import { ActivityUpdater, musicActivity } from '../src/activity.js';

const playing = { phase: 'online', nowPlaying: { title: 'X.O', artist: 'The Limba, ANDRO', playback: 'Playing' } };
function harness() {
  let clock = 0, next = 0;
  const sent = [], jobs = new Map();
  const client = { isReady: () => true, user: { setPresence: data => sent.push(data) } };
  const updater = new ActivityUpdater({ getClient: () => client, now: () => clock,
    schedule(fn, delay) { jobs.set(++next, { fn, delay }); return next; }, clear(id) { jobs.delete(id); } });
  return { updater, client, sent, jobs, step() { const [id, job] = jobs.entries().next().value; jobs.delete(id); clock += job.delay; job.fn(); } };
}
test('profile activity contains the track, artist and pause marker', () => {
  assert.deepEqual(musicActivity(playing), { activities: [{ name: 'X.O — The Limba, ANDRO', type: ActivityType.Listening }] });
  assert.match(musicActivity({ ...playing, nowPlaying: { ...playing.nowPlaying, playback: 'Paused' } }).activities[0].name, /^⏸ Пауза/);
  assert.deepEqual(musicActivity({ ...playing, phase: 'idle' }), { activities: [] });
  assert.deepEqual(musicActivity({ ...playing, phase: 'recovering' }), { activities: [] });
  assert.deepEqual(musicActivity({ ...playing, nowPlaying: { ...playing.nowPlaying, playback: 'Stopped' } }), { activities: [] });
});
test('progress updates do not resend presence; rapid changes publish only the latest track', () => {
  const h = harness(); h.updater.update(playing);
  h.updater.update({ ...playing, nowPlaying: { ...playing.nowPlaying, positionMs: 1000 } });
  assert.equal(h.sent.length, 1);
  h.updater.update({ ...playing, nowPlaying: { ...playing.nowPlaying, title: 'Second' } });
  h.updater.update({ ...playing, nowPlaying: { ...playing.nowPlaying, title: 'Third' } });
  assert.equal(h.jobs.size, 1); h.step();
  assert.equal(h.sent.length, 2); assert.match(h.sent[1].activities[0].name, /^Third/);
  h.updater.close();
});
test('disconnect replaces a pending song update with empty activity', () => {
  const h = harness(); h.updater.update(playing);
  h.updater.update({ ...playing, nowPlaying: { ...playing.nowPlaying, title: 'Second' } });
  h.updater.update({ phase: 'idle' }); h.step();
  assert.deepEqual(h.sent.at(-1), { activities: [] });
  h.updater.close();
});
test('shutdown cancels pending updates and Unicode titles are safely bounded', () => {
  const h = harness(); h.updater.update(playing);
  h.updater.update({ ...playing, nowPlaying: { ...playing.nowPlaying, playback: 'Paused' } });
  h.updater.close(); assert.equal(h.jobs.size, 0);
  const name = musicActivity({ ...playing, nowPlaying: { ...playing.nowPlaying, title: '🎵'.repeat(180) } }).activities[0].name;
  assert.equal(Array.from(name).length, 128); assert.ok(name.endsWith('…'));
});
