import { EventEmitter } from 'node:events';
import {
  Client, Events, GatewayIntentBits, ChannelType, PermissionFlagsBits,
  MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import {
  joinVoiceChannel, entersState, VoiceConnectionStatus, VoiceConnectionDisconnectReason,
  createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, NoSubscriberBehavior,
} from '@discordjs/voice';
import { resolveCaptureSource, openResolvedCapture } from './process-audio.js';
import { redact } from './config.js';
import { RecoveryScheduler, canControl, inviteUrl } from './recovery.js';
import { ActivityUpdater } from './activity.js';

export const commandDefinitions = [
  ['join', 'Подключить бота к текущему голосовому каналу'],
  ['leave', 'Отключить музыкального бота от канала'],
  ['status', 'Показать состояние музыки и подключения'],
].map(([name, description]) => new SlashCommandBuilder().setName(name).setDescription(description).toJSON());

export class MusicService extends EventEmitter {
  constructor(config) {
    super();
    this.config = { ...config };
    this.state = { phase: 'offline', message: 'Готов к подключению', botName: '', applicationId: '',
      guildId: '', guildName: '', channelId: '', channelName: '', level: 0, retryAttempt: 0, commandsReady: false };
    this.logs = [];
    this.client = null; this.connection = null; this.capture = null;
    this.loginPromise = null; this.sessionAbort = null; this.serial = Promise.resolve();
    this.wantedChannel = ''; this.intent = 0; this.suspended = false; this.closed = false;
    this.recovery = new RecoveryScheduler();
    this.registeredGuilds = new Set();
    this.activity = new ActivityUpdater({ getClient: () => this.client, onError: error => this.log(`Активность бота: ${error.message}`) });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    this.player.on('error', error => this.failed(error));
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.capture && this.wantedChannel && !this.suspended) this.failed(new Error('Аудиопоток остановился.'));
    });
    this.meterTimer = setInterval(() => this.tick(), 180);
  }

  snapshot() { return { ...this.state, logs: this.logs.slice(-60) }; }
  update(patch) { Object.assign(this.state, patch); this.activity.update(this.state); this.emit('state', this.snapshot()); }
  log(message) {
    this.logs.push({ time: Date.now(), message: redact(message instanceof Error ? message.message : message, this.config.token) });
    if (this.logs.length > 100) this.logs.shift();
    this.emit('state', this.snapshot());
  }
  run(task) {
    const result = this.serial.then(task);
    this.serial = result.catch(() => {});
    return result;
  }

  async session() {
    if (this.closed) throw new Error('Приложение завершает работу.');
    if (this.client?.isReady()) return this.client;
    if (this.loginPromise) return this.loginPromise;
    if (!this.config.token) throw new Error('Сначала сохрани токен бота в настройках.');
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates], rest: { timeout: 15000, retries: 1 } });
    this.client = client;
    this.update({ phase: 'connecting', message: 'Подключение к Discord…' });
    client.on(Events.Error, error => this.log(error));
    client.on(Events.Warn, warning => this.log(warning));
    client.on(Events.InteractionCreate, interaction => { void this.interaction(interaction); });
    client.on(Events.VoiceStateUpdate, (oldState, newState) => this.onVoiceState(oldState, newState));
    client.on(Events.ShardDisconnect, () => {
      if (this.closed || !this.wantedChannel || this.suspended) return;
      this.stopAudio();
      this.update({ phase: 'recovering', message: 'Ожидание сети Discord…' });
    });
    client.on(Events.ShardResume, () => {
      if (this.wantedChannel && !this.suspended && !this.closed) this.failed(new Error('Сеть восстановлена. Переподключение…'));
    });
    this.sessionAbort = new AbortController();
    const ready = new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); client.off(Events.ClientReady, onReady);
        this.sessionAbort?.signal.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve();
      };
      const onReady = () => finish();
      const onAbort = () => finish(new Error('Подключение отменено.'));
      const timer = setTimeout(() => finish(new Error('Discord не ответил за 30 секунд. Проверьте интернет.')), 30000);
      client.once(Events.ClientReady, onReady);
      this.sessionAbort.signal.addEventListener('abort', onAbort, { once: true });
    });
    this.loginPromise = (async () => {
      try {
        await Promise.all([client.login(this.config.token), ready]);
        if (this.closed) throw new Error('Приложение закрывается.');
        await client.application.fetch();
        const owner = client.application.owner;
        this.applicationOwnerId = owner?.ownerId ?? owner?.id ?? '';
        this.update({ phase: 'idle', message: 'Выберите голосовой канал', botName: client.user.username, applicationId: client.user.id });
        this.log(`Вход выполнен: ${client.user.username}`);
        return client;
      } catch (error) {
        this.sessionAbort?.abort();
        await client.destroy();
        if (this.client === client) this.client = null;
        if (!this.closed) this.update({ phase: 'error', message: 'Не удалось войти в Discord. Проверьте сеть и токен.' });
        throw error;
      } finally { this.loginPromise = null; }
    })();
    return this.loginPromise;
  }

  async catalogue(guildId) {
    const client = await this.session();
    const guilds = [...client.guilds.cache.values()].map(g => ({ id: g.id, name: g.name }));
    if (!guilds.length) return { guilds: [], channels: [], roles: [], inviteUrl: inviteUrl(client.user.id) };
    let guild = client.guilds.cache.get(guildId || this.state.guildId);
    if (!guild && this.config.voiceChannelId) {
      const channel = await client.channels.fetch(this.config.voiceChannelId).catch(() => null);
      guild = channel?.guild;
    }
    guild ??= client.guilds.cache.first();
    const channels = await guild.channels.fetch();
    const me = await guild.members.fetchMe();
    const available = [...channels.values()].filter(c => c?.type === ChannelType.GuildVoice
      && c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
      .sort((a, b) => a.position - b.position).map(c => ({ id: c.id, name: c.name }));
    const roles = [...(await guild.roles.fetch()).values()].filter(role => role.id !== guild.id && !role.managed)
      .sort((a, b) => b.position - a.position).map(role => ({ id: role.id, name: role.name }));
    return { guilds, guildId: guild.id, channels: available, roles, inviteUrl: inviteUrl(client.user.id) };
  }

  async registerCommands(guild) {
    if (this.registeredGuilds.has(guild.id)) return;
    // Upsert only our three commands; preserve any other commands owned by this application.
    for (const definition of commandDefinitions) await guild.commands.create(definition);
    this.registeredGuilds.add(guild.id);
    this.update({ commandsReady: true });
    this.log('Команды /join, /leave, /status доступны на сервере.');
  }

  async prepareGuild(guildId) {
    const client = await this.session();
    const guild = await client.guilds.fetch(guildId);
    if (this.connection && this.state.guildId !== guild.id) await this.leave();
    this.update({ guildId: guild.id, guildName: guild.name, commandsReady: this.registeredGuilds.has(guild.id) });
    try { await this.registerCommands(guild); }
    catch (error) {
      this.log(`Не удалось зарегистрировать команды: ${redact(error.message, this.config.token)}. Обнови приглашение бота со scope applications.commands.`);
    }
    return guild;
  }

  async connect(channelId = this.config.voiceChannelId) {
    if (!/^\d{17,20}$/.test(channelId ?? '')) throw new Error('Выберите голосовой канал.');
    const epoch = ++this.intent;
    this.stopAudio();
    this.wantedChannel = channelId;
    this.recovery.reset();
    this.update({ phase: 'connecting', message: 'Подключение к голосовому каналу…', retryAttempt: 0 });
    return this.run(async () => {
      if (epoch !== this.intent || this.closed || this.suspended) return;
      try { await this.connectTarget(channelId, epoch); }
      catch (error) {
        if (epoch === this.intent && !this.closed && this.wantedChannel) this.failed(error);
        throw error;
      }
    });
  }

  async connectTarget(channelId, epoch) {
    const client = await this.session();
    if (epoch !== this.intent || this.suspended || this.closed) return;
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('Нужен обычный голосовой канал Discord.');
    const me = await channel.guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      throw new Error('Нет прав View Channel, Connect или Speak в этом канале.');
    }
    if (channel.full && !channel.members.has(me.id) && !channel.permissionsFor(me)?.has(PermissionFlagsBits.MoveMembers)) throw new Error('Голосовой канал заполнен.');
    const source = await resolveCaptureSource(this.config);
    if (epoch !== this.intent || this.suspended || this.closed) return;
    this.captureSource = source;
    if (this.connection && this.connection.joinConfig.guildId !== channel.guild.id) this.dropConnection();
    this.update({ phase: 'connecting', message: `Подключение к «${channel.name}»…`, guildId: channel.guild.id,
      guildName: channel.guild.name, channelId: channel.id, channelName: channel.name, sourceLabel: source.label });
    this.emit('target', { channelId: channel.id, guildId: channel.guild.id });
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    const isNew = this.connection !== connection;
    this.connection = connection;
    if (isNew) connection.on('error', error => { if (this.connection === connection) this.failed(error); });
    if (isNew) connection.on('stateChange', (_previous, next) => {
      if (this.connection !== connection || this.closed) return;
      if (next.status === VoiceConnectionStatus.Disconnected) {
        if (next.reason === VoiceConnectionDisconnectReason.Manual) return;
        // Close 4014 means the server revoked the voice session. Never rejoin after a kick.
        if (next.reason === VoiceConnectionDisconnectReason.WebSocketClose && next.closeCode === 4014) {
          this.manualDisconnect('Бота отключили от канала. Подключи его снова кнопкой или /join.');
        } else this.failed(new Error('Голосовое соединение прервалось.'));
      } else if (next.status === VoiceConnectionStatus.Ready) {
        if (!this.capture && this.wantedChannel && !this.suspended) {
          try { this.startAudio(client.channels.cache.get(this.wantedChannel)?.bitrate); }
          catch (error) { this.failed(error); }
        }
      } else this.stopAudio();
    });
    connection.subscribe(this.player);
    await entersState(connection, VoiceConnectionStatus.Ready, 25000);
    if (epoch !== this.intent || this.connection !== connection || this.closed || this.suspended) return;
    if (!this.capture) this.startAudio(channel.bitrate);
    // Reset the retry budget only after PCM actually arrives, not after a voice handshake.
    this.update({ phase: 'online', message: 'Трансляция активна', retryAttempt: this.recovery.attempt });
    try { await this.registerCommands(channel.guild); } catch (error) { this.log(`Команды: ${redact(error.message, this.config.token)}`); }
  }

  stopAudio() {
    const capture = this.capture; this.capture = null;
    capture?.stop();
    this.player.stop(true);
    this.update({ level: 0 });
  }
  dropConnection() {
    const connection = this.connection; this.connection = null;
    this.stopAudio();
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  }
  startAudio(bitrate) {
    this.stopAudio();
    if (!this.captureSource) throw new Error('Источник звука ещё не выбран.');
    const capture = openResolvedCapture(this.captureSource, error => { if (this.capture === capture) this.failed(error); });
    capture.startedAt = Date.now(); capture.goodSince = 0;
    this.capture = capture;
    try {
      const resource = createAudioResource(capture.meter, { inputType: StreamType.Raw });
      resource.encoder?.setBitrate(Math.min(this.config.bitrate ?? 128000, bitrate ?? 64000));
      this.player.play(resource);
    } catch (error) { this.stopAudio(); throw error; }
  }
  tick() {
    const capture = this.capture;
    if (!capture) return;
    const now = Date.now();
    if (now - (capture.meter.lastDataAt || capture.startedAt) > 12000) {
      this.failed(new Error('Аудиоустройство перестало передавать данные.')); return;
    }
    if (capture.meter.bytes && !capture.goodSince) capture.goodSince = now;
    if (capture.goodSince && now - capture.goodSince > 8000 && this.recovery.attempt) {
      this.recovery.reset(); this.update({ retryAttempt: 0 });
    }
    this.update({ level: capture.meter.takePeak() });
  }
  failed(error) {
    if (this.closed || this.suspended || !this.wantedChannel) return;
    this.log(error);
    this.stopAudio();
    if (/TokenInvalid|invalid token|токен|401\b/i.test(`${error.code ?? ''} ${error.message}`)) {
      this.wantedChannel = ''; this.recovery.cancel();
      this.dropConnection();
      this.update({ phase: 'error', message: 'Проверьте токен бота в настройках.' }); return;
    }
    const epoch = this.intent;
    const next = this.recovery.next(async () => {
      if (epoch !== this.intent || this.closed || this.suspended || !this.wantedChannel) return;
      await this.run(async () => {
        if (epoch !== this.intent || !this.wantedChannel || this.suspended || this.closed) return;
        try { await this.connectTarget(this.wantedChannel, epoch); }
        catch (again) { if (epoch === this.intent) this.failed(again); }
      });
    });
    if (!next) {
      this.dropConnection();
      this.update({ phase: 'error', message: 'Не удалось восстановить соединение. Проверьте сеть и аудиоустройство, затем нажмите «Подключиться».' });
    } else this.update({ phase: 'recovering', retryAttempt: next.attempt,
      message: `Восстановление соединения · попытка ${next.attempt}/${this.recovery.delays.length}` });
  }

  manualDisconnect(message = 'Трансляция отключена') {
    ++this.intent; this.wantedChannel = ''; this.recovery.reset(); this.dropConnection();
    this.update({ phase: this.client?.isReady() ? 'idle' : 'offline', message, channelId: '', channelName: '', retryAttempt: 0 });
  }
  async leave() { this.manualDisconnect(); }
  onVoiceState(oldState, newState) {
    if (newState.id !== this.client?.user?.id || !this.connection) return;
    if (oldState.channelId && !newState.channelId) {
      // Ignore transient gateway loss; an explicit server voice-state removal cancels retries.
      this.manualDisconnect('Бота отключили от канала. Автоподключение остановлено.');
    } else if (newState.channelId && newState.channelId !== this.wantedChannel) {
      this.wantedChannel = newState.channelId;
      this.update({ channelId: newState.channelId, channelName: newState.channel?.name ?? '' });
      this.emit('target', { channelId: newState.channelId, guildId: newState.guild.id });
    }
  }
  suspend() {
    if (this.suspended) return;
    this.suspended = true; ++this.intent; this.recovery.cancel(); this.dropConnection();
    this.update({ phase: 'sleeping', message: 'Компьютер спит. Подключение восстановится после пробуждения.' });
  }
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.wantedChannel) { this.recovery.reset(); this.failed(new Error('Выход из режима сна. Восстановление аудиотрансляции…')); }
    else this.update({ phase: this.client?.isReady() ? 'idle' : 'offline', message: 'Готов к подключению' });
  }

  async interaction(interaction) {
    if (!interaction.isChatInputCommand() || !['join', 'leave', 'status'].includes(interaction.commandName)) return;
    try {
      if (!interaction.inGuild() || interaction.guildId !== this.state.guildId) {
        await interaction.reply({ content: 'Этот сервер не выбран в приложении YMusic.', flags: MessageFlags.Ephemeral }); return;
      }
      const roles = interaction.member?.roles;
      const roleIds = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
      if (!canControl({ userId: interaction.user.id, applicationOwnerId: this.applicationOwnerId,
        guildOwnerId: interaction.guild?.ownerId, isAdministrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
        roleIds, djRoleId: this.config.djRoleId })) {
        await interaction.reply({ content: 'Управление доступно владельцу приложения, администраторам сервера и выбранной роли DJ.', flags: MessageFlags.Ephemeral }); return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.commandName === 'join') {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.voice.channelId) throw new Error('Сначала зайди в голосовой канал.');
        await this.connect(member.voice.channelId);
        await interaction.editReply(this.state.phase === 'online' ? `Трансляция активна: ${this.state.channelName}` : this.state.message);
      } else if (interaction.commandName === 'leave') {
        await this.leave(); await interaction.editReply('Трансляция отключена. Бот остаётся доступен для /join.');
      } else await interaction.editReply(`${this.state.message}${this.state.channelName ? `\nКанал: ${this.state.channelName}` : ''}\nИсточник: ${this.state.sourceLabel || this.config.audioDevice}`);
    } catch (error) {
      const message = redact(error.message, this.config.token);
      this.log(`Команда: ${message}`);
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(message);
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      } catch (replyError) { this.log(replyError); }
    }
  }

  async close() {
    if (this.closed) return;
    this.activity.close();
    this.closed = true; ++this.intent; this.wantedChannel = ''; this.recovery.cancel();
    clearInterval(this.meterTimer); this.dropConnection(); this.sessionAbort?.abort();
    await this.client?.destroy(); this.client = null;
    this.update({ phase: 'offline', message: 'Отключено' });
  }
}
