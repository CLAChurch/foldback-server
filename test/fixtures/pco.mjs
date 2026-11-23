// Invented API records for read-only integration and browser tests. No church data.
export const NOW = Date.parse('2026-11-22T17:42:00Z');
export const SELECTION = { serviceTypeId: '10', planId: '20', timeId: '30' };
const resource = (type, id, attributes = {}, relationships = {}) => ({ type, id, attributes, relationships: Object.fromEntries(Object.entries(relationships).map(([name, data]) => [name, { data }])) });
const ref = (type, id) => ({ type, id });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

export class PcoFixture {
  constructor() {
    this.now = NOW; this.calls = []; this.current = '301'; this.failure = null; this.liveMissing = false; this.handlers = new Map();
    this.plan = resource('Plan', '20', { dates: 'November 22, 2026', title: 'Fixture gathering', can_view_order: true });
    this.times = [resource('PlanTime', '30', { time_type: 'service', name: 'Early gathering', starts_at: '2026-11-22T17:30:00Z', ends_at: '2026-11-22T18:00:00Z' }), resource('PlanTime', '31', { time_type: 'service', name: 'Later gathering', starts_at: '2026-11-22T19:00:00Z', ends_at: '2026-11-22T20:00:00Z' }), resource('PlanTime', '32', { time_type: 'rehearsal', name: 'Rehearsal' })];
    this.items = ['Welcome', 'Opening song', 'Campus video', 'Closing', 'Before service', 'Heading', 'After service', 'Excluded item'].map((title, i) => resource('Item', String(i + 1), { title, description: i ? '' : 'Welcome guests.\nInvite everyone to stand.', length: 500, sequence: i + 1, item_type: i === 5 ? 'header' : 'item', service_position: i === 4 ? 'pre' : i === 6 ? 'post' : 'during' }));
    this.itemTimes = this.times.filter(time => time.attributes.time_type === 'service').flatMap(time => this.items.map(item => resource('ItemTime', time.id + item.id, { length: time.id === '30' ? 300 : 600, length_offset: 0, exclude: time.id === '30' && item.id === '8', live_start_at: time.id === '30' && item.id === '1' ? new Date(NOW).toISOString() : null, live_end_at: null }, { item: ref('Item', item.id), plan_time: ref('PlanTime', time.id), plan: ref('Plan', '20') })));
    this.notes = this.items.flatMap(item => [resource('ItemNote', '9' + item.id, { category_name: 'Person', content: 'Fallback ' + item.id }, { item: ref('Item', item.id) }), resource('ItemNote', '8' + item.id, { category_name: 'Staff only', content: 'private-note-never-display' }, { item: ref('Item', item.id) })]);
    this.assignments = [resource('ItemAssignment', '401', { assignable_type: 'Person' }, { item: ref('Item', '1'), assignable: ref('Person', '201') }), resource('ItemAssignment', '402', { assignable_type: 'TeamPosition' }, { item: ref('Item', '2'), assignable: ref('TeamPosition', '101') })];
    this.positions = [resource('TeamPosition', '101', { name: 'Worship leader' }, { team: ref('Team', '501') })];
    this.people = [resource('Person', '201', { first_name: 'Host', last_name: 'One', email: 'private-email-never-display@example.org' }), resource('Person', '202', { first_name: 'Leader', last_name: 'Early' }), resource('Person', '203', { first_name: 'Leader', last_name: 'Late' }), resource('Person', '204', { first_name: 'Declined', last_name: 'Early' }), resource('Person', '205', { first_name: 'Different', last_name: 'Team' })];
    this.members = [this.member('601', '201', ['30', '31'], '501', 'Host'), this.member('602', '202', ['30']), this.member('603', '203', ['31']), this.member('604', '204', ['30'], '501', 'Worship leader', ['30']), this.member('605', '205', ['30'], '502')];
  }
  member(id, personId, times, team = '501', position = 'Worship leader', declined = []) {
    return resource('PlanPerson', id, { status: 'C', team_position_name: position }, { person: ref('Person', personId), team: ref('Team', team), service_times: times.map(id => ref('PlanTime', id)), declined_plan_times: declined.map(id => ref('PlanTime', id)) });
  }
  bundle() {
    return { data: this.items.map(item => ({ ...item, relationships: { ...item.relationships, ...Object.fromEntries([['item_times', this.itemTimes], ['item_notes', this.notes], ['item_assignments', this.assignments]].map(([name, values]) => [name, { data: values.filter(value => value.relationships.item.data.id === item.id).map(value => ref(value.type, value.id)) }])) } })), included: [...this.itemTimes, ...this.notes, ...this.assignments] };
  }
  advance(id, at = this.now) {
    const old = this.itemTimes.find(time => time.id === this.current);
    if (old) old.attributes.live_end_at = new Date(at).toISOString();
    this.current = id;
    const current = this.itemTimes.find(time => time.id === id);
    if (current) { current.attributes.live_start_at = new Date(at).toISOString(); current.attributes.live_end_at = null; }
  }
  fetch = async (url, options) => {
    const parsed = new URL(url); this.calls.push({ url, options });
    if (options.method !== 'GET' && parsed.pathname !== '/oauth/token') throw new Error('Test forbids writes to Planning Center');
    if (this.failure?.matches(parsed)) return new Response('upstream-secret-never-return', { status: this.failure.status, headers: this.failure.headers });
    if (this.handlers.has(parsed.pathname)) return this.handlers.get(parsed.pathname)(parsed, options);
    const path = '/services/v2/service_types/10/plans/20';
    if (parsed.pathname === '/oauth/token') return response({ access_token: 'fixture-new-access', refresh_token: 'fixture-new-refresh', token_type: 'bearer', expires_in: 3600, scope: 'services' });
    if (parsed.pathname === '/services/v2') return response({ data: resource('Organization', '900', { name: 'Fixture Church' }) });
    if (parsed.pathname === '/services/v2/service_types') return response({ data: [resource('ServiceType', '10', { name: 'Fixture campus' })] });
    if (parsed.pathname === '/services/v2/service_types/10/plans') return response({ data: [this.plan] });
    if (parsed.pathname === path) return response({ data: this.plan });
    if (parsed.pathname === path + '/plan_times') return response({ data: this.times });
    if (parsed.pathname === path + '/items') return response(this.bundle());
    if (parsed.pathname === path + '/live') {
      if (this.liveMissing) return new Response('', { status: 404 });
      const current = this.itemTimes.find(time => time.id === this.current);
      return response({ data: resource('Live', '40', {}, { current_item_time: current ? ref('ItemTime', current.id) : null }), included: current ? [current] : [] });
    }
    if (parsed.pathname === path + '/team_members') return response({ data: this.members, included: this.people });
    if (parsed.pathname === '/services/v2/service_types/10/team_positions') return response({ data: this.positions });
    const person = this.people.find(person => parsed.pathname === '/services/v2/people/' + person.id);
    if (person) return response({ data: person });
    return new Response('', { status: 404 });
  };
}
