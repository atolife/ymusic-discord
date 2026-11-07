<div align="center">
  <img src="docs/assets/hero.png" width="100%" alt="YMusic — локальная аудиотрансляция Яндекс Музыки в Discord Voice через WASAPI.">
  <br><br>
  <a href="https://github.com/atolife/ymusic-discord/releases/latest"><img src="docs/assets/download.svg" width="270" alt="Скачать Windows x64"></a>
  <br><br>
  <a href="https://github.com/atolife/ymusic-discord/actions/workflows/ci.yml"><img src="https://github.com/atolife/ymusic-discord/actions/workflows/ci.yml/badge.svg" alt="Windows checks"></a>
  <a href="https://github.com/atolife/ymusic-discord/releases"><img src="https://img.shields.io/github/v/release/atolife/ymusic-discord?color=c9ef91&amp;labelColor=253021&amp;label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c9ef91?labelColor=253021" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-9ebf80?labelColor=253021" alt="Windows x64">
  <br><br>
  <b>Русский</b> · <a href="docs/README.en.md">English</a> · <a href="docs/SETUP.md">Настройка</a> · <a href="docs/DEVELOPMENT.md">Разработка</a>
</div>

## Назначение

**YMusic — локальное Windows-приложение для передачи звука настольной Яндекс Музыки в Discord Voice.** Захват выполняется через WASAPI process loopback; аудио передаётся отдельным ботом. Управление воспроизведением остаётся в плеере. Каждый участник настраивает громкость бота независимо в клиенте Discord.

<img src="docs/assets/workflow.png" width="100%" alt="Яндекс Музыка → WASAPI / PCM → Opus / Discord Voice.">

## Возможности

| Компонент | Реализация |
| --- | --- |
| Захват звука | Дерево процессов Яндекс Музыки; проверка пути EXE, PID и времени создания процесса. |
| Аудиопоток | PCM16, 48 kHz, stereo → Opus → Discord Voice с DAVE. |
| Метаданные | Название, исполнитель, обложка, состояние и позиция из медиасессии Windows. |
| Публикация трека | Одно обновляемое сообщение в чате голосового канала; текстовая активность в профиле бота. |
| Команды | `/join`, `/leave`, `/status`; доступ владельцам, администраторам и выбранной роли DJ. |
| Фоновый режим | Системный трей, необязательный автозапуск и подключение при старте. |
| Восстановление | Ограниченные повторные попытки после сбоя сети, источника звука или сна Windows. |
| Альтернативный источник | DirectShow-аудиоустройство через FFmpeg, включая VB-CABLE. |

## Интерфейс

<img src="docs/assets/app-preview.png" width="100%" alt="Интерфейс YMusic: голосовой канал, параметры WASAPI, метаданные и индикатор сигнала.">

<sub>Скриншот интерфейса с демонстрационными метаданными. Токен и персональные настройки не используются.</sub>

## Установка

1. Скачать архив Windows x64 из [Releases](https://github.com/atolife/ymusic-discord/releases/latest), распаковать целиком и запустить `YMusic.exe`. Установка Node.js для готовой сборки не требуется.
2. Создать приложение и бота в [Discord Developer Portal](https://discord.com/developers/applications). Сохранить токен в YMusic и добавить бота на сервер через кнопку приглашения.
3. Запустить настольную Яндекс Музыку. В YMusic выбрать сервер, голосовой канал и источник **«Яндекс Музыка (WASAPI)»**, затем выполнить подключение.

[Полная инструкция и разрешения Discord](docs/SETUP.md)

При локальном прослушивании плеера громкость бота в собственном клиенте Discord рекомендуется установить на 0, чтобы исключить повторное воспроизведение с сетевой задержкой. Громкость для остальных участников не изменяется.

## Системные требования

- Windows x64 build **20348+** с поддержкой process loopback; основная платформа — Windows 11.
- Настольная Яндекс Музыка с доступным воспроизведением.
- Discord-бот с разрешениями на подключение и передачу звука в целевом канале.
- Работающие компьютер, плеер и YMusic в течение трансляции.

## Ограничения и хранение данных

- Поддерживается настольная Яндекс Музыка. Интеграция со Spotify и управление с телефона не реализованы.
- Поддерживаются обычные голосовые каналы. Stage Channels не поддерживаются.
- При отсутствии целевого процесса захват завершается ошибкой; автоматического переключения на системный звук нет.
- Авторизация в аккаунте Яндекса не требуется. Discord-токен хранится локально с шифрованием средствами Windows.
- Запись аудио на диск не производится. Привилегированные Gateway Intents не требуются.
- Карточка трека обновляется примерно раз в 10 секунд; активность бота — не чаще раза в 6 секунд. После отключения трансляции новые метаданные не публикуются.
- Готовая сборка не подписана цифровым сертификатом.

## Запуск из исходников

```powershell
git clone https://github.com/atolife/ymusic-discord.git
cd ymusic-discord
npm ci
npm run desktop
```

Требуются Windows x64 и Node.js **22.12+**. WASAPI-модуль компилируется из исходников штатным компилятором .NET Framework.

```powershell
npm run check   # Состав репозитория и известные шаблоны секретов
npm test        # Автоматические тесты
npm run build   # Windows-дистрибутив в dist/
```

[Архитектура](docs/DEVELOPMENT.md) · [История изменений](CHANGELOG.md) · [Отчёт об ошибке](https://github.com/atolife/ymusic-discord/issues/new/choose)

## Ресурсы Discord

[Иконка 1024 × 1024](docs/assets/discord-icon.png) · [Баннер 680 × 240](docs/assets/discord-banner.png). Формат PNG, размер каждого файла менее 10 MB.

## Credentials

**@Atolife** — Discord / [GitHub](https://github.com/atolife)

## Лицензия

Оригинальный код и графика распространяются по [MIT](LICENSE). Лицензии зависимостей перечислены в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Проект не связан с Яндексом или Discord. Передача аудио должна соответствовать условиям музыкального сервиса и правам на контент.
