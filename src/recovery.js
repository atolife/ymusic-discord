export const RETRY_DELAYS = [1500, 3000, 6000, 10000, 20000, 30000];

// One recovery job at a time. Cancellation invalidates jobs already in flight.
export class RecoveryScheduler {
  constructor({ schedule = setTimeout, clear = clearTimeout, delays = RETRY_DELAYS } = {}) {
    this.schedule = schedule; this.clear = clear; this.delays = delays;
    this.attempt = 0; this.generation = 0; this.timer = null;
  }
  cancel() { this.generation++; if (this.timer !== null) this.clear(this.timer); this.timer = null; }
  reset() { this.cancel(); this.attempt = 0; }
  next(task) {
    if (this.timer !== null) return { pending: true, attempt: this.attempt };
    if (this.attempt >= this.delays.length) return null;
    const delay = this.delays[this.attempt++];
    const generation = this.generation;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (generation === this.generation) void task(generation);
    }, delay);
    return { attempt: this.attempt, delay };
  }
}

export function canControl({ userId, applicationOwnerId, guildOwnerId, isAdministrator, roleIds = [], djRoleId }) {
  return Boolean(userId && (userId === applicationOwnerId || userId === guildOwnerId
    || isAdministrator || (djRoleId && roleIds.includes(djRoleId))));
}

export function inviteUrl(applicationId) {
  if (!/^\d{17,20}$/.test(applicationId)) throw new Error('Некорректный ID приложения.');
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&permissions=3263488&scope=bot%20applications.commands`;
}
