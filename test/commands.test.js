import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicService } from '../src/service.js';
import { MessageFlags } from 'discord.js';
const guildId = '123456789012345678', channelId = '223456789012345678';
function interaction(command, userId = 'owner', server = guildId) {
  const responses = [];
  return { commandName: command, responses, user: { id: userId }, guildId: server,
    isChatInputCommand: () => true, inGuild: () => true,
    member: { roles: [] }, memberPermissions: { has: () => false },
    guild: { ownerId: 'server-owner', members: { fetch: async () => ({ voice: { channelId } }) } },
    async reply(data) { responses.push(data); this.replied = true; },
    async deferReply(data) { responses.push(data); this.deferred = true; },
    async editReply(data) { responses.push(data); } };
}
function service() {
  const value = new MusicService({ token: 'dummy-token', audioDevice: 'CABLE Output' });
  value.state.guildId = guildId; value.applicationOwnerId = 'owner'; return value;
}
test('a listener or another server cannot redirect or stop the bot', async () => {
  const bot = service(); let called = false;
  bot.connect = async () => { called = true; };
  bot.leave = async () => { called = true; };
  const listener = interaction('join', 'listener');
  await bot.interaction(listener);
  const otherGuild = interaction('leave', 'owner', '323456789012345678');
  await bot.interaction(otherGuild);
  assert.equal(called, false);
  assert.equal(listener.responses[0].flags, MessageFlags.Ephemeral);
  assert.equal(otherGuild.responses[0].flags, MessageFlags.Ephemeral);
  await bot.close();
});
test('/join follows the authorized caller current voice channel', async () => {
  const bot = service(); let target;
  bot.connect = async value => { target = value; bot.state.phase = 'online'; bot.state.channelName = 'Music'; };
  const request = interaction('join');
  await bot.interaction(request);
  assert.equal(target, channelId);
  assert.equal(request.responses[0].flags, MessageFlags.Ephemeral);
  assert.match(request.responses.at(-1), /Music/);
  await bot.close();
});
test('/leave cancels the desired channel while retaining the Discord session', async () => {
  const bot = service(); let destroyed = false;
  bot.client = { isReady: () => true, destroy: async () => { destroyed = true; } };
  bot.wantedChannel = channelId;
  await bot.interaction(interaction('leave'));
  assert.equal(bot.wantedChannel, '');
  assert.equal(bot.state.phase, 'idle');
  assert.equal(destroyed, false);
  await bot.close();
});
