import { ActivityType } from 'discord.js';

const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const shorten = value => { const chars = Array.from(value); return chars.length > 128 ? chars.slice(0, 127).join('') + '…' : value; };

export function musicActivity(state) {
  if (state.phase !== 'online') return { activities: [] };
  const track = state.nowPlaying;
  if (!track?.title) return { activities: [{ name: 'Яндекс Музыку', type: ActivityType.Listening }] };
  if (['Stopped', 'Closed', 'Opened', 'Changing'].includes(track.playback)) return { activities: [] };
  const title = clean(track.title), artist = clean(track.artist);
  const name = `${track.playback === 'Paused' ? '⏸ Пауза · ' : ''}${title}${artist ? ` — ${artist}` : ''}`;
  return { activities: [{ name: shorten(name), type: ActivityType.Listening }] };
}

// Discord limits presence updates. Coalesce rapid track changes into the latest state.
export class ActivityUpdater {
  constructor({ getClient, onError = () => {}, now = Date.now, schedule = setTimeout, clear = clearTimeout, interval = 6000 }) {
    this.getClient = getClient; this.onError = onError; this.now = now; this.schedule = schedule; this.clear = clear;
    this.interval = interval; this.timer = null; this.latest = { activities: [] };
    this.lastKey = null; this.lastClient = null; this.lastAt = -Infinity; this.closed = false;
  }
  update(state) {
    if (this.closed) return;
    this.latest = musicActivity(state);
    this.apply();
  }
  apply() {
    if (this.closed) return;
    const client = this.getClient();
    if (!client?.isReady() || typeof client.user?.setPresence !== 'function') return;
    if (client !== this.lastClient) {
      this.lastClient = client; this.lastKey = null; this.lastAt = -Infinity;
    }
    const key = JSON.stringify(this.latest);
    if (key === this.lastKey) {
      if (this.timer !== null) this.clear(this.timer);
      this.timer = null; return;
    }
    const wait = this.lastAt + this.interval - this.now();
    if (wait > 0) {
      if (this.timer === null) this.timer = this.schedule(() => { this.timer = null; this.apply(); }, wait);
      return;
    }
    if (this.timer !== null) this.clear(this.timer);
    this.timer = null;
    this.lastAt = this.now();
    try { client.user.setPresence(this.latest); this.lastKey = key; }
    catch (error) { this.onError(error); }
  }
  close() { this.closed = true; if (this.timer !== null) this.clear(this.timer); this.timer = null; }
}
