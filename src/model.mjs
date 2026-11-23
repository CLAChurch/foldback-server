// Shared by the server, TV renderer, and acceptance tests. All timestamps are UTC.
export const CAMPUS_ZONE = 'Etc/GMT+7'; // IANA Etc/GMT signs are reversed: UTC−07:00.
export const STALE_AFTER_MS = 15000;

export function initialState() {
  return {
    version: 1,
    settings: {
      campus: 'My campus', output: 'direct', connector: 'auto', timezone: CAMPUS_ZONE,
      personMode: 'scheduled-fallback', personNote: 'Person',
      networkPreference: 'ethernet', serviceTypeId: '',
    },
    auth: null, service: null, overrides: {}, playback: null, pco: null, pcoDeferred: false, pcoSelection: null,
  };
}

export function sampleService(now = Date.now()) {
  return {
    id: 'sample-abby', source: 'sample', title: 'Sample service',
    timeId: 'sample-time', scheduledEnd: new Date(now + 18 * 60000).toISOString(),
    currentItemId: 'welcome', liveStart: new Date(now).toISOString(),
    lastSuccessAt: new Date(now).toISOString(), connected: true,
    items: [
      { id: 'welcome', title: 'Welcome', description: 'Welcome guests and online viewers.\nInvite everyone to stand for\nthe first song.', duration: 300, scheduledPerson: 'Graham Caesar', notes: { Person: 'Graham Caesar' } },
      { id: 'opening-song', title: 'Opening Song', description: '', duration: 300, scheduledPerson: 'Worship Team', notes: {} },
      { id: 'campus-video', title: 'Campus Update', description: 'Introduce this week’s campus update.', duration: 300, scheduledPerson: '', notes: { Person: 'Campus Host' } },
      { id: 'closing', title: 'Closing', description: 'Thank everyone for joining us.', duration: 300, scheduledPerson: 'Campus Host', notes: {} },
    ],
  };
}

export function overrideKey(serviceId, itemId) { return `${serviceId}:${itemId}`; }
export function itemOverride(state, itemId) {
  return state.overrides[overrideKey(state.service.id, itemId)] ?? { video: false, source: 'auto', mediaId: '' };
}
export function personFor(item, settings) {
  if (!item) return '';
  const note = item.notes && Object.hasOwn(item.notes, settings.personNote) && typeof item.notes[settings.personNote] === 'string' ? item.notes[settings.personNote] : '';
  if (settings.personMode === 'note') return note;
  if (settings.personMode === 'scheduled') return item.scheduledPerson ?? '';
  return item.scheduledPerson || note;
}

export function displayState(state, now = Date.now()) {
  const service = state.service;
  return {
    configured: Boolean(state.auth), serverTime: now,
    settings: { campus: state.settings.campus, timezone: state.settings.timezone },
    service: service ? structuredClone(service) : null,
    overrides: service ? Object.fromEntries(service.items.map(item => [item.id, itemOverride(state, item.id)])) : {},
    people: service ? Object.fromEntries(service.items.map(item => [item.id, personFor(item, state.settings)])) : {},
    playback: state.playback ? structuredClone(state.playback) : null,
  };
}

export function clocks(view, now = view.serverTime) {
  const service = view.service;
  if (!service) return null;
  const index = service.items.findIndex(item => item.id === service.currentItemId);
  const item = service.items[index];
  const started = Date.parse(service.liveStart);
  if (!item || !Number.isFinite(started)) return null;
  const elapsed = Math.max(0, (now - started) / 1000);
  const plannedRemaining = item.duration - elapsed;
  const laterSeconds = service.items.slice(index + 1).reduce((sum, next) => sum + next.duration, 0);
  const override = view.overrides[item.id] ?? { video: false };
  const playback = view.playback;
  // A producer mapping and a unique active media match are both mandatory.
  const actual = override.video && override.source !== 'estimate' && Boolean(override.mediaId) &&
    playback?.connected && playback.itemId === item.id && playback.mediaId === override.mediaId &&
    playback.identified === true && playback.ambiguous !== true &&
    Number.isFinite(playback.remaining) && Number.isFinite(Date.parse(playback.observedAt)) &&
    now - Date.parse(playback.observedAt) <= STALE_AFTER_MS && now >= Date.parse(playback.observedAt);
  const actualRemaining = actual ? Math.max(0, playback.remaining -
    (playback.playing ? (now - Date.parse(playback.observedAt)) / 1000 : 0)) : null;
  const remaining = actual ? actualRemaining : (override.video ? Math.max(0, plannedRemaining) : plannedRemaining);
  const available = (Date.parse(service.scheduledEnd) - now) / 1000 - laterSeconds;
  return {
    item, next: service.items[index + 1] ?? null, remaining, available,
    label: override.video ? (actual ? 'Video remaining' : 'Video estimate') : 'Item time left',
    video: override.video, over: !override.video && plannedRemaining < 0,
    flash: !override.video && plannedRemaining < -(item.duration * 0.1),
    projectedEnd: now + (Math.max(0, remaining) + laterSeconds) * 1000,
    stale: service.source !== 'sample' && (!service.connected || now - Date.parse(service.lastSuccessAt) > STALE_AFTER_MS),
  };
}

export function durationText(seconds) {
  const total = seconds < 0 ? Math.floor(Math.abs(seconds) + 1e-7) : Math.ceil(seconds - 1e-7);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function localTime(timestamp, timezone = CAMPUS_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(timestamp).replace(/a\.m\./i, 'AM').replace(/p\.m\./i, 'PM');
}
