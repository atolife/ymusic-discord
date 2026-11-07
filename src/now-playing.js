import { createHash } from 'node:crypto';
import { EmbedBuilder, AttachmentBuilder, escapeMarkdown } from 'discord.js';
import { trackPosition, formatTime, decodeCover } from './media.js';

const safe = (value, size) => escapeMarkdown(String(value || '').slice(0, size));
export function cardPayload(track, { online, now = Date.now(), statusText = '' } = {}) {
  const embed = new EmbedBuilder().setColor(online ? 0xc9ef91 : 0x7a8573)
    .setAuthor({ name: 'YMusic · Сейчас играет' })
    .setFooter({ text: online ? 'Управление — в Яндекс Музыке · прогресс обновляется каждые 10 секунд' : statusText || 'Эфир завершён' });
  const files = [];
  if (!track?.title) {
    embed.setTitle(online ? 'Ожидаю Яндекс Музыку' : statusText || 'Музыка отключена')
      .setDescription(online ? 'Включи трек в настольном плеере. Данные появятся автоматически.' : 'Бот отключён от голосового канала.');
    return { embeds: [embed], files, attachments: [], allowedMentions: { parse: [] } };
  }
  embed.setTitle(safe(track.title, 250));
  const status = !online ? statusText || '⏹ Эфир завершён' : track.playback === 'Playing' ? '▶ Играет' : track.playback === 'Paused' ? '⏸ Пауза' : '⏹ Остановлено';
  let description = `**${safe(track.artist || 'Исполнитель не указан', 500)}**\n${status}`;
  if (track.album) description += `\n${safe(track.album, 250)}`;
  embed.setDescription(description);
  if (track.durationMs > 0) {
    const position = trackPosition(track, now);
    const filled = Math.min(12, Math.max(0, Math.round(position / track.durationMs * 12)));
    embed.addFields({ name: `${formatTime(position)} / ${formatTime(track.durationMs)}`,
      value: `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}` });
  }
  const cover = decodeCover(track.cover);
  if (cover) {
    const name = `cover.${cover.extension}`;
    files.push(new AttachmentBuilder(cover.buffer, { name }));
    embed.setThumbnail(`attachment://${name}`);
  }
  return { embeds: [embed], files, attachments: [], allowedMentions: { parse: [] } };
}

function identity(track) {
  return track ? `${track.sourceId}\0${track.title}\0${track.artist}\0${track.album}` : '';
}
function fingerprint(value, now) {
  const cover = value.track?.cover?.data || '';
  return JSON.stringify([value.online, value.statusText, identity(value.track), value.track?.playback,
    Math.floor(trackPosition(value.track, now) / 10000), value.track?.durationMs,
    createHash('sha1').update(cover).digest('hex')]);
}

export class NowPlayingPublisher {
  constructor({ getChannel, getBotId, persist = () => {}, log = () => {}, records = {}, now = Date.now,
    schedule = setTimeout, clear = clearTimeout } = {}) {
    this.getChannel = getChannel; this.getBotId = getBotId; this.persist = persist; this.log = log;
    this.records = { ...records }; this.now = now; this.schedule = schedule; this.clear = clear;
    this.messages = new Map(); this.latest = null; this.timer = null; this.busy = false;
    this.sent = new Map(); this.lastAt = 0; this.retryAt = 0; this.closed = false;
    this.retiring = new Map(); this.completion = null;
  }
  update(value) {
    if (this.closed) return;
    const previous = this.latest;
    if (previous?.channelId && previous.channelId !== value.channelId) this.retiring.set(previous.channelId, previous.track);
    this.retiring.delete(value.channelId);
    this.latest = value;
    this.queue();
  }
  queue() {
    if (this.closed || this.busy || this.timer !== null || !this.latest?.channelId) return;
    const current = this.latest, now = this.now();
    if (!current.online && !this.records[current.channelId] && !this.messages.has(current.channelId)) return;
    const key = fingerprint(current, now);
    if (this.sent.get(current.channelId) === key) return;
    const wait = Math.max(0, this.lastAt + 2500 - now, this.retryAt - now);
    this.timer = this.schedule(() => { this.timer = null; void this.flush(); }, wait);
  }
  async findMessage(channelId, channel) {
    if (this.messages.has(channelId)) return this.messages.get(channelId);
    const id = this.records[channelId];
    if (!id) return null;
    try {
      const message = await channel.messages.fetch(id);
      if (message.author.id !== this.getBotId()) throw new Error('Сохранённая карточка принадлежит другому автору.');
      this.messages.set(channelId, message); return message;
    } catch (error) {
      if (error.code === 10008) { delete this.records[channelId]; this.persist({ ...this.records }); return null; }
      throw error;
    }
  }
  async flush() {
    if (this.closed || this.busy || !this.latest?.channelId) return;
    this.busy = true;
    let completed;
    this.completion = new Promise(resolve => { completed = resolve; });
    const current = this.latest;
    try {
      for (const [channelId, track] of this.retiring) {
        if (channelId !== this.latest?.channelId) await this.retire(channelId, track);
        this.retiring.delete(channelId);
      }
      const channel = await this.getChannel(current.channelId, current.guildId);
      let message = await this.findMessage(current.channelId, channel);
      if (this.closed || current !== this.latest) return;
      if (!message && !current.online) return;
      const payload = cardPayload(current.track, { online: current.online, statusText: current.statusText, now: this.now() });
      if (message) {
        try { await message.edit(payload); }
        catch (error) {
          if (error.code !== 10008) throw error;
          this.messages.delete(current.channelId); delete this.records[current.channelId]; message = null;
        }
      }
      if (!message && current.online && !this.closed) {
        message = await channel.send(payload);
        this.messages.set(current.channelId, message); this.records[current.channelId] = message.id;
        this.persist({ ...this.records });
      }
      this.sent.set(current.channelId, fingerprint(current, this.now()));
      this.lastAt = this.now(); this.retryAt = 0;
      if (message && this.latest !== current && current.channelId !== this.latest?.channelId) await this.retire(current.channelId, current.track);
    } catch (error) {
      const message = `Карточка трека: ${error.message}`;
      if (this.lastError !== message) { this.lastError = message; this.log(message); }
      this.retryAt = this.now() + 30000;
    } finally { this.busy = false; completed(); this.completion = null; this.queue(); }
  }
  async retire(channelId, track) {
    const message = this.messages.get(channelId);
    if (!message) return;
    try {
      await message.edit(cardPayload(track, { online: false, now: this.now() }));
      this.sent.delete(channelId);
    } catch (error) { this.log(`Карточка трека: ${error.message}`); }
  }
  async close() {
    if (this.closed) return;
    this.closed = true; if (this.timer !== null) this.clear(this.timer); this.timer = null;
    await this.completion;
    if (this.latest?.channelId) await this.retire(this.latest.channelId, this.latest.track);
  }
}
