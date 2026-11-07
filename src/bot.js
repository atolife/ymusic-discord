import { Client, Events, GatewayIntentBits, ChannelType, PermissionFlagsBits, ActivityType } from 'discord.js';
import {
  joinVoiceChannel, entersState, VoiceConnectionStatus,
  createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, NoSubscriberBehavior,
} from '@discordjs/voice';
import { openCapture } from './audio.js';
import { redact } from './config.js';

export async function startBot(config) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
  let connection;
  let capture;
  let stopping = false;
  let recoveryRunning = false;
  let watchdog;
  let restartTimer;
  let readiness;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const safe = error => redact(error instanceof Error ? error.message : error, config.token);
  const log = message => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${safe(message)}`);

  function stopAudio() {
    clearTimeout(restartTimer);
    const previous = capture;
    capture = undefined;
    previous?.stop();
    player.stop(true);
  }

  async function shutdown(error) {
    if (stopping) return;
    stopping = true;
    clearInterval(watchdog);
    stopAudio();
    if (error) {
      console.error(`\nОшибка: ${safe(error)}`);
      process.exitCode = 1;
    }
    if (connection?.state.status !== VoiceConnectionStatus.Destroyed) connection?.destroy();
    await client.destroy();
    finish();
  }

  function startAudio() {
    if (stopping || capture || connection?.state.status !== VoiceConnectionStatus.Ready) return;
    try {
      capture = openCapture(config.audioDevice, error => { void shutdown(error); });
      const resource = createAudioResource(capture.meter, { inputType: StreamType.Raw });
      resource.encoder?.setBitrate(Math.min(config.bitrate, connection.joinConfig.channelId
        ? (client.channels.cache.get(connection.joinConfig.channelId)?.bitrate ?? 64000) : 64000));
      player.play(resource);
      log(`Звук передаётся: ${config.audioDevice}`);
    } catch (error) { void shutdown(error); }
  }

  async function recover() {
    if (recoveryRunning || stopping) return;
    recoveryRunning = true;
    try {
      // A server/channel move can temporarily disconnect the voice WebSocket.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    } catch {
      await shutdown(new Error('Голосовое соединение прервано. Проверьте сеть и права бота, затем запустите 02-start.cmd.'));
    } finally { recoveryRunning = false; }
  }

  const onSignal = () => { log('Остановка…'); void shutdown(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  client.on(Events.Error, error => { void shutdown(error); });
  client.on(Events.Warn, warning => log(`Discord: ${warning}`));
  player.on('error', error => { void shutdown(new Error(`Ошибка аудиопотока: ${safe(error)}`)); });
  player.on(AudioPlayerStatus.Idle, () => {
    if (stopping || connection?.state.status !== VoiceConnectionStatus.Ready) return;
    // Rebuild from live input instead of replaying buffered audio after an interruption.
    const previous = capture;
    capture = undefined;
    previous?.stop();
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startAudio, 1000);
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!connection || newState.id !== client.user?.id) return;
    if (oldState.channelId && !newState.channelId) {
      void shutdown(new Error('Бота отключили от голосового канала. Для подключения снова запустите 02-start.cmd.'));
    }
  });

  try {
    readiness = entersClientReady(client);
    await Promise.race([
      Promise.all([client.login(config.token), readiness.promise]),
      finished,
    ]);
    if (stopping) return await finished;
    const channel = await client.channels.fetch(config.voiceChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Указанный ID должен принадлежать обычному голосовому каналу сервера.');
    }
    const me = await channel.guild.members.fetchMe();
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
    if (!channel.permissionsFor(me)?.has(needed)) {
      throw new Error('Боту нужны права View Channel, Connect и Speak в выбранном канале.');
    }
    if (channel.full && !channel.permissionsFor(me)?.has(PermissionFlagsBits.MoveMembers)) {
      throw new Error('Голосовой канал заполнен. Освободи место или увеличь лимит участников.');
    }
    log(`Вход выполнен: ${client.user.tag}. Канал: ${channel.name}`);
    client.user.setActivity('Яндекс Музыку', { type: ActivityType.Listening });
    connection = joinVoiceChannel({
      channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true, selfMute: false,
    });
    connection.on('error', error => { void shutdown(error); });
    connection.on('stateChange', (_oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Ready) startAudio();
      else {
        stopAudio();
        if (newState.status === VoiceConnectionStatus.Disconnected) {
          log('Восстанавливаю голосовое соединение…');
          void recover();
        }
      }
    });
    connection.subscribe(player);
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    startAudio();
    let silentTicks = 0;
    watchdog = setInterval(() => {
      if (!capture) return;
      const age = Date.now() - (capture.meter.lastDataAt || Date.now());
      if ((!capture.meter.bytes && ++silentTicks >= 2) || age > 15000) {
        void shutdown(new Error('Устройство перестало передавать аудио. Проверьте VB-CABLE и запустите бота снова.'));
        return;
      }
      if (capture.meter.takePeak() < 0.0001) {
        log('На входе тишина. Если музыка играет, проверьте выход Яндекс Музыки: CABLE Input.');
      } else silentTicks = 0;
    }, 15000);
    log('Готово. Управление воспроизведением доступно в плеере. Для остановки нажмите Ctrl+C.');
    await finished;
  } catch (error) { await shutdown(error); }
  finally {
    clearInterval(watchdog);
    clearTimeout(restartTimer);
    readiness?.cancel();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

function entersClientReady(client) {
  let timer;
  let onReady;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(() => { client.off(Events.ClientReady, onReady); reject(new Error('Discord не ответил за 30 секунд.')); }, 30000);
    onReady = () => { clearTimeout(timer); resolve(); };
    client.once(Events.ClientReady, onReady);
  });
  // login can fail before the caller reaches `await promise`.
  promise.catch(() => {});
  return { promise, cancel() { clearTimeout(timer); client.off(Events.ClientReady, onReady); } };
}
