// Read-only Services adapter. Live is advanced by the operator in Planning Center.
const BASE = 'https://api.planningcenteronline.com';
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
export function pcoId(value) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw fail('Choose a valid Planning Center service, plan and time.', 400);
  return value;
}
const rel = (resource, name) => resource?.relationships?.[name]?.data;
const text = value => typeof value === 'string' ? value.slice(0, 20000) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const key = resource => `${resource.type}:${resource.id}`;
const index = resources => new Map(resources.map(resource => [key(resource), resource]));
const collectionPath = selection => `/services/v2/service_types/${pcoId(selection.serviceTypeId)}/plans/${pcoId(selection.planId)}`;

export async function collection(get, path) {
  const first = new URL(path, BASE); first.searchParams.set('per_page', '100');
  const seen = new Set(); const ids = new Set(); const data = []; const included = new Map();
  let url = first;
  while (url) {
    if (url.origin !== BASE || url.username || url.password || url.hash || url.pathname !== first.pathname || seen.has(url.href) || seen.size >= 50) throw fail('Planning Center returned unsafe or excessive pagination.');
    seen.add(url.href);
    const page = await get(url.pathname + url.search);
    if (!Array.isArray(page.data)) throw fail('Planning Center returned an unexpected collection.');
    for (const resource of page.data) {
      if (!resource || typeof resource.id !== 'string' || typeof resource.type !== 'string' || ids.has(key(resource))) throw fail('Planning Center data changed during pagination. Retrying a fresh snapshot.');
      ids.add(key(resource)); data.push(resource);
    }
    for (const resource of page.included ?? []) included.set(key(resource), resource);
    url = page.links?.next ? new URL(page.links.next, BASE) : null;
  }
  return { data, included: [...included.values()] };
}

function children(bundle, resource, relation, type) {
  const references = rel(resource, relation);
  if (Array.isArray(references)) {
    const resources = index(bundle.included);
    return references.map(reference => {
      const found = resources.get(key(reference));
      if (!found || found.type !== type) throw fail('Planning Center returned incomplete related item data. Retrying.');
      return found;
    });
  }
  return bundle.included.filter(candidate => candidate.type === type && rel(candidate, 'item')?.id === resource.id);
}

function personName(resource) {
  const attrs = resource?.attributes ?? {};
  return text(attrs.full_name || attrs.name || [attrs.first_name, attrs.last_name].filter(Boolean).join(' ')).trim();
}
function scheduledFor(member, timeId) {
  const times = rel(member, 'service_times') ?? rel(member, 'times');
  const declined = rel(member, 'declined_plan_times') ?? [];
  return !['D', 'Declined'].includes(member.attributes?.status) && Array.isArray(times) && times.some(time => time.id === timeId) && !declined.some(time => time.id === timeId);
}

async function namesFor(get, selection, bundle, settings) {
  const names = new Map(); const warnings = new Set();
  if (settings.personMode === 'note') return { names, warnings: [] };
  const assignments = bundle.included.filter(resource => resource.type === 'ItemAssignment');
  if (!assignments.length) return { names, warnings: [] };
  let members = { data: [], included: [] };
  let positions = new Map();
  if (assignments.some(assignment => rel(assignment, 'assignable')?.type === 'TeamPosition')) {
    try {
      members = await collection(get, collectionPath(selection) + '/team_members?include=person,declined_plan_times');
      positions = index((await collection(get, `/services/v2/service_types/${selection.serviceTypeId}/team_positions`)).data);
    } catch (error) {
      if (error.upstreamStatus !== 403) throw error;
      warnings.add('This account cannot read some scheduled people. Person-note fallback remains available.');
    }
  }
  const people = index(members.included.filter(resource => resource.type === 'Person'));
  const peopleNeeded = new Set(assignments.filter(assignment => rel(assignment, 'assignable')?.type === 'Person').map(assignment => rel(assignment, 'assignable').id));
  for (const id of peopleNeeded) if (!people.has(`Person:${id}`)) {
    try {
      const result = await get(`/services/v2/people/${pcoId(id)}`);
      if (result.data?.type !== 'Person' || result.data.id !== id) throw fail('Planning Center returned an unexpected person.');
      people.set(key(result.data), result.data);
    } catch (error) {
      if (error.upstreamStatus !== 403) throw error;
      warnings.add('This account cannot read some assigned people. Person-note fallback remains available.');
    }
  }
  for (const assignment of assignments) {
    const assignable = rel(assignment, 'assignable');
    const resolved = [];
    if (assignable?.type === 'Person') resolved.push(personName(people.get(key(assignable))));
    else if (assignable?.type === 'TeamPosition') {
      const position = positions.get(key(assignable));
      const teamId = rel(position, 'team')?.id;
      if (teamId && position.attributes?.name) {
        for (const member of members.data) if (scheduledFor(member, selection.timeId) && rel(member, 'team')?.id === teamId && member.attributes?.team_position_name === position.attributes.name) {
          resolved.push(personName(people.get(key(rel(member, 'person') ?? {}))) || text(member.attributes?.name));
        }
      }
    }
    const value = [...new Set(resolved.filter(Boolean))].join(', ');
    if (!value) warnings.add('Some item assignments have no resolvable person for this service time. Person-note fallback remains available.');
    names.set(assignment.id, value);
  }
  return { names, warnings: [...warnings] };
}

export async function loadSnapshot(get, selection, settings, now) {
  const path = collectionPath(selection);
  const plan = (await get(path)).data;
  if (plan?.type !== 'Plan' || plan.id !== selection.planId) throw fail('Planning Center returned an unexpected plan.');
  if (plan.attributes?.can_view_order === false) throw fail('This Planning Center account cannot view the selected running order.', 403);
  const times = await collection(get, path + '/plan_times');
  const time = times.data.find(time => time.id === selection.timeId && time.type === 'PlanTime');
  if (!time || time.attributes?.time_type !== 'service' || !date(time.attributes?.ends_at)) throw fail('The selected service time is missing or has no scheduled finish. Choose a service time again.', 400);
  const bundle = await collection(get, path + '/items?include=item_times,item_notes,item_assignments');
  if (bundle.data.some(resource => resource.type !== 'Item')) throw fail('Planning Center returned an unexpected running order.');
  const people = await namesFor(get, selection, bundle, settings);
  return { plan, time, bundle, ...people, loadedAt: now };
}

export async function readLive(get, selection) {
  const path = collectionPath(selection) + '/live';
  const document = await get(path + '?include=current_item_time', { allowMissing: true });
  const lives = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
  if (lives.length > 1 || lives.some(live => live.type !== 'Live')) throw fail('Planning Center returned an ambiguous Live state.');
  const reference = rel(lives[0], 'current_item_time');
  if (!reference) return { current: null, authoritative: Boolean(lives[0]?.relationships && Object.hasOwn(lives[0].relationships, 'current_item_time')) };
  let current = (document.included ?? []).find(resource => resource.type === 'ItemTime' && resource.id === reference.id);
  if (!current) current = (await get(`${path}/${pcoId(lives[0].id)}/current_item_time`)).data;
  if (current?.type !== 'ItemTime' || current.id !== reference.id) throw fail('Planning Center returned incomplete Live timing.');
  return { current, authoritative: true };
}

export function normalizeService(selection, snapshot, live, settings, previous, now) {
  const { plan, time, bundle, names, warnings } = snapshot;
  const records = new Map();
  const items = bundle.data.filter(item => item.type === 'Item' && item.attributes?.item_type !== 'header' && item.attributes?.service_position === 'during')
    .sort((a, b) => (a.attributes.sequence ?? 0) - (b.attributes.sequence ?? 0)).flatMap(item => {
      const matches = children(bundle, item, 'item_times', 'ItemTime').filter(record => rel(record, 'plan_time')?.id === selection.timeId);
      if (matches.length !== 1) throw fail('Planning Center returned missing or ambiguous item timing for this service time.');
      const timing = matches[0];
      if (timing.attributes?.exclude === true) return [];
      const duration = timing.attributes?.length ?? (item.attributes.length + (timing.attributes?.length_offset ?? 0));
      if (!Number.isInteger(duration) || duration < 0 || duration > 86400) throw fail('Planning Center returned an invalid item duration.');
      records.set(timing.id, timing);
      const notes = children(bundle, item, 'item_notes', 'ItemNote').filter(note => note.attributes?.category_name === settings.personNote);
      return [{ id: item.id, title: text(item.attributes.title), description: text(item.attributes.description), duration,
        scheduledPerson: [...new Set(children(bundle, item, 'item_assignments', 'ItemAssignment').map(assignment => names.get(assignment.id)).filter(Boolean))].join(', '),
        notes: Object.fromEntries(notes.length ? [[settings.personNote, notes.map(note => text(note.attributes.content)).join('\n')]] : []),
      }];
    });
  const ended = Boolean(date(time.attributes.live_ends_at));
  let active = live.current;
  if (active && !rel(active, 'plan_time')?.id) throw fail('Planning Center did not identify the live service time.');
  let status = 'waiting';
  let message = 'Waiting for PCO Live to start this service time.';
  if (active && rel(active, 'plan_time')?.id !== selection.timeId) {
    active = null; status = ended ? 'complete' : 'other-service';
    message = ended ? 'This service time has finished.' : 'PCO Live is on a different service time. Waiting for the selected time.';
  } else if (!active && !live.authoritative && !ended) {
    const open = [...records.values()].filter(record => date(record.attributes?.live_start_at) && !date(record.attributes?.live_end_at));
    if (open.length > 1) throw fail('Planning Center reports multiple live items for this service time. Keeping the last known item.');
    active = open[0] ?? null;
  }
  let currentItemId = null; let liveStart = null; let activeItemTimeId = null;
  if (active && !date(active.attributes?.live_end_at)) {
    const itemId = rel(active, 'item')?.id;
    if (!itemId) throw fail('Planning Center did not identify the live item.');
    const selected = items.find(item => item.id === itemId);
    if (selected) {
      currentItemId = itemId; activeItemTimeId = active.id;
      liveStart = date(active.attributes?.live_start_at);
      if (!liveStart && previous?.timeId === selection.timeId && previous.currentItemId === itemId && previous.activeItemTimeId === active.id) liveStart = previous.liveStart;
      status = liveStart ? 'live' : 'waiting';
      message = liveStart ? '' : 'Waiting for PCO to record this item’s original live start.';
    } else {
      const sourceItem = bundle.data.find(item => item.id === itemId);
      if (!sourceItem) throw fail('PCO advanced to an item outside this snapshot. Refreshing the running order.');
      status = 'outside-service'; message = 'PCO Live is on a heading, excluded item, or pre/post-service item.';
    }
  } else if (status === 'waiting' && (ended || (records.size > 0 && [...records.values()].every(record => date(record.attributes?.live_end_at))))) {
    status = 'complete'; message = 'This service time has finished.';
  }
  return {
    id: `pco:${selection.organizationId}:${selection.serviceTypeId}:${selection.planId}`, source: 'pco',
    serviceTypeId: selection.serviceTypeId, planId: selection.planId, timeId: selection.timeId,
    title: [text(plan.attributes?.dates), text(plan.attributes?.title)].filter(Boolean).join(' · ') || 'Planning Center service',
    timeName: text(time.attributes.name), scheduledStart: date(time.attributes.starts_at), scheduledEnd: date(time.attributes.ends_at),
    currentItemId, liveStart, activeItemTimeId, status, statusMessage: message, warnings,
    lastSuccessAt: new Date(now).toISOString(), connected: true, syncMessage: '', items,
  };
}

const signature = service => service ? JSON.stringify({ ...service, lastSuccessAt: null }) : '';
export class LiveSync {
  constructor(store, pco, { publish = () => {}, now = Date.now, automatic = true } = {}) {
    this.store = store; this.pco = pco; this.publish = publish; this.now = now; this.automatic = automatic;
    this.closed = false; this.timer = null; this.inflight = null; this.manualCount = 0; this.failures = 0; this.cache = null;
    this.nextAttemptAt = null;
    if (store.state.service?.source === 'pco') store.state.service.connected = false;
    this.kick(0);
  }
  ready() {
    const { pco, pcoSelection } = this.store.state;
    return Boolean(pcoSelection && pco?.verifiedAt && pco.organization?.id === pcoSelection.organizationId && (pco.method === 'pat' || pco.tokens));
  }
  info() {
    return { selection: this.store.state.pcoSelection ?? null, enabled: this.ready(), syncing: Boolean(this.inflight), nextAttemptAt: this.nextAttemptAt };
  }
  kick(milliseconds = 2000) {
    clearTimeout(this.timer); this.timer = null;
    this.nextAttemptAt = null;
    if (this.closed || !this.automatic || this.manualCount || !this.ready()) return;
    // Long Retry-After windows are checked in bounded chunks; the client still refuses early HTTP requests.
    const wait = Math.min(60000, Math.max(0, milliseconds));
    this.nextAttemptAt = new Date(this.now() + wait).toISOString();
    this.timer = setTimeout(() => { this.poll().finally(() => this.kick(this.delay())); }, wait);
    this.timer.unref();
  }
  delay() {
    return Math.max(this.pco.pollDelay, this.pco.retryAt - this.now(), this.failures ? Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5)) : 2000);
  }
  async manual(operation) {
    this.manualCount++; clearTimeout(this.timer);
    try { await this.inflight; return await operation(); }
    finally { this.manualCount--; this.kick(); }
  }
  async browse(kind, body = {}) {
    return this.pco.read(async get => {
      if (kind === 'service-types') {
        const result = await collection(get, '/services/v2/service_types');
        return { choices: result.data.map(value => ({ id: value.id, name: text(value.attributes?.name) })) };
      }
      const serviceTypeId = pcoId(body.serviceTypeId);
      if (kind === 'plans') {
        const after = new Date(this.now() - (body.older ? 366 : 7) * 86400000).toISOString();
        const result = await collection(get, `/services/v2/service_types/${serviceTypeId}/plans?filter=after&after=${encodeURIComponent(after)}&order=sort_date`);
        return { choices: result.data.map(value => ({ id: value.id, name: [text(value.attributes?.dates), text(value.attributes?.title)].filter(Boolean).join(' · ') || 'Untitled plan' })) };
      }
      const planId = pcoId(body.planId);
      const result = await collection(get, `/services/v2/service_types/${serviceTypeId}/plans/${planId}/plan_times`);
      return { choices: result.data.filter(value => value.attributes?.time_type === 'service').map(value => ({ id: value.id, name: text(value.attributes.name), startsAt: date(value.attributes.starts_at), endsAt: date(value.attributes.ends_at) })) };
    });
  }
  async select(body) {
    const organizationId = this.store.state.pco?.organization?.id;
    if (!this.store.state.pco?.verifiedAt || !organizationId) throw fail('Test the Planning Center connection before selecting a service.', 400);
    const selection = { organizationId, serviceTypeId: pcoId(body.serviceTypeId), planId: pcoId(body.planId), timeId: pcoId(body.timeId) };
    return this.pco.read(async get => {
      const snapshot = await loadSnapshot(get, selection, this.store.state.settings, this.now());
      const live = await readLive(get, selection);
      const service = normalizeService(selection, snapshot, live, this.store.state.settings, this.store.state.service, this.now());
      if (this.closed) return;
      this.store.update(state => { state.pcoSelection = selection; state.settings.serviceTypeId = selection.serviceTypeId; state.service = service; state.playback = null; });
      this.cache = { selection: JSON.stringify(selection), snapshot }; this.failures = 0; this.publish();
    });
  }
  stop() {
    this.store.update(state => { state.pcoSelection = null; if (state.service?.source === 'pco') { state.service = null; state.playback = null; } });
    this.cache = null; clearTimeout(this.timer); this.nextAttemptAt = null; this.publish();
  }
  invalidate() { this.cache = null; this.kick(0); }
  commit(service) {
    const previous = this.store.state.service;
    if (signature(previous) !== signature(service)) this.store.update(state => {
      state.service = service;
      if (previous?.id !== service.id || previous?.timeId !== service.timeId || previous?.currentItemId !== service.currentItemId || previous?.liveStart !== service.liveStart) state.playback = null;
    });
    else this.store.state.service.lastSuccessAt = service.lastSuccessAt; // Persist meaningful changes, not every polling heartbeat.
    this.publish();
  }
  async poll() {
    if (this.closed || this.inflight || this.manualCount || !this.ready() || this.pco.busy) return;
    const selection = structuredClone(this.store.state.pcoSelection);
    this.inflight = this.pco.read(async get => {
      let snapshot = this.cache?.selection === JSON.stringify(selection) ? this.cache.snapshot : null;
      if (!snapshot || this.now() - snapshot.loadedAt >= 10000) snapshot = await loadSnapshot(get, selection, this.store.state.settings, this.now());
      const live = await readLive(get, selection);
      if (this.closed) return;
      this.commit(normalizeService(selection, snapshot, live, this.store.state.settings, this.store.state.service, this.now()));
      this.cache = { selection: JSON.stringify(selection), snapshot }; this.failures = 0;
    }).catch(error => {
      if (this.closed) return;
      this.cache = null; this.failures++;
      if (this.store.state.service?.source === 'pco') {
        this.store.state.service.connected = false;
        this.store.state.service.syncMessage = error.status ? error.message : 'Planning Center synchronization failed. Retrying.';
      }
      this.publish();
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
  close() { this.closed = true; clearTimeout(this.timer); }
}
