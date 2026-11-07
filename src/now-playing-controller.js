import { PermissionFlagsBits } from 'discord.js';
import { MediaMonitor, selectSession, trackPosition } from './media.js';
import { NowPlayingPublisher } from './now-playing.js';

export class NowPlayingController {
  constructor(service, { config, persist, monitor = new MediaMonitor() }) {
    this.service = service; this.config = config; this.monitor = monitor; this.track = null;
    this.phaseKey = ''; this.closed = false;
    this.publisher = new NowPlayingPublisher({
      records: config.nowPlayingMessages ?? {}, persist,
      getBotId: () => service.client?.user?.id,
      log: message => service.log(message),
      getChannel: async (channelId, guildId) => {
        const client = service.client;
        if (!client?.isReady()) throw new Error('Discord пока не подключён.');
        const channel = await client.channels.fetch(channelId);
        if (!channel || channel.guildId !== guildId || !channel.isTextBased() || typeof channel.send !== 'function') {
          throw new Error('Текстовый чат голосового канала недоступен.');
        }
        const me = await channel.guild.members.fetchMe();
        const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory];
        if (!channel.permissionsFor(me)?.has(needed)) {
          throw new Error('Нужны права View Channel, Send Messages, Embed Links, Attach Files и Read Message History. Нажми «Добавить бота на сервер» и обнови разрешения.');
        }
        return channel;
      },
    });
    this.onState = state => {
      const key = `${state.phase}|${state.guildId}|${state.channelId}`;
      if (key === this.phaseKey) return;
      this.phaseKey = key; this.publish();
    };
    this.onSessions = sessions => {
      this.track = selectSession(sessions, this.config.mediaSourceId);
      service.update({ nowPlaying: this.track?.title ? this.track : null,
        mediaSources: sessions.map(session => ({ id: session.sourceId, name: /yandex.*music/i.test(session.sourceId) ? 'Яндекс Музыка' : session.name })) });
      this.publish();
    };
    this.onWarning = message => service.log(message);
    service.on('state', this.onState);
    monitor.on('sessions', this.onSessions); monitor.on('warning', this.onWarning);
    this.configure(config);
  }
  configure(config) {
    this.config = config;
    // The monitor also powers the profile activity when the chat card is disabled.
    this.monitor.start(); this.onSessions(this.monitor.sessions);
  }
  publish() {
    if (this.closed) return;
    const state = this.service.state;
    const online = this.config.nowPlayingEnabled !== false && state.phase === 'online';
    const previous = this.publisher.latest;
    let track = this.track;
    if (!online) {
      track = previous?.track ?? null;
      if (previous?.online && track) track = { ...track, positionMs: trackPosition(track), playback: 'Stopped', updatedAt: Date.now() };
    }
    this.publisher.update({ channelId: state.channelId || this.publisher.latest?.channelId || '',
      guildId: state.guildId || this.publisher.latest?.guildId || '',
      online, track, statusText: this.config.nowPlayingEnabled === false ? 'Обновление карточки выключено'
        : state.phase === 'recovering' || state.phase === 'connecting' ? 'Восстановление соединения'
          : state.phase === 'sleeping' ? 'Эфир приостановлен: режим сна' : '' });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.monitor.stop(); this.service.off('state', this.onState);
    this.monitor.off('sessions', this.onSessions); this.monitor.off('warning', this.onWarning);
    await this.publisher.close();
  }
}
