import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { PlanningCenter } from '../src/pco.mjs';
import { LiveSync, collection } from '../src/pco-live.mjs';
import { clocks, displayState, overrideKey } from '../src/model.mjs';
import { PcoFixture, NOW, SELECTION } from './fixtures/pco.mjs';

async function setup(t, { automatic = false, select = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'foldback-live-'));
  const fixture = new PcoFixture(); const store = new Store(directory);
  const pco = new PlanningCenter(store, { fetchImpl: fixture.fetch, now: () => fixture.now });
  let publishes = 0;
  const sync = new LiveSync(store, pco, { now: () => fixture.now, automatic, publish: () => publishes++ });
  t.after(() => { sync.close(); pco.close(); rmSync(directory, { recursive: true, force: true }); });
  pco.save({ method: 'pat', clientId: 'fixture-id', clientSecret: 'fixture-private-credential', contactEmail: 'fixture@example.org' }, 'https://foldback.example');
  await pco.verify();
  if (select) await sync.select(SELECTION);
  return { directory, fixture, store, pco, sync, publications: () => publishes };
}
const view = ({ store, fixture }) => displayState(store.state, fixture.now);

test('real selection imports only the chosen service time, resolves direct/position people, and never writes PCO', async t => {
  const state = await setup(t); const { store, fixture } = state;
  assert.equal(store.state.service.source, 'pco');
  assert.deepEqual(store.state.service.items.map(item => item.id), ['1','2','3','4']);
  assert.equal(store.state.service.items[0].duration, 300);
  assert.equal(store.state.service.liveStart, new Date(NOW).toISOString());
  assert.equal(view(state).people['1'], 'Host One'); assert.equal(view(state).people['2'], 'Leader Early'); assert.equal(view(state).people['3'], 'Fallback 3');
  assert.equal(store.state.service.items[0].description, 'Welcome guests.\nInvite everyone to stand.');
  assert.ok(!JSON.stringify(view(state)).includes('private-note-never-display'));
  assert.ok(!JSON.stringify(view(state)).includes('private-email-never-display'));
  assert.ok(!JSON.stringify(view(state)).includes('fixture-private-credential'));
  assert.ok(fixture.calls.every(call => call.options.method === 'GET'));
  assert.ok(fixture.calls.every(call => call.options.headers['X-PCO-API-Version'] === '2018-11-01'));
});

test('10:42 clock example and later edits preserve the original start, video flags and playback', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  const first = clocks(view(state)); assert.equal(first.remaining, 300); assert.equal(first.available, 180); assert.equal(first.projectedEnd, Date.parse('2026-11-22T18:02:00Z'));
  store.update(state => { state.overrides[overrideKey(state.service.id,'1')] = { video:true, source:'estimate' }; state.playback = { marker:'preserve active context' }; });
  fixture.itemTimes.find(time => time.id === '302').attributes.length = 420;
  fixture.items[0].attributes.title = 'Renamed welcome';
  // Reorder a later pair without moving either before Now.
  fixture.items[2].attributes.sequence = 1.5;
  fixture.now += 10000; await sync.poll();
  assert.equal(store.state.service.liveStart, new Date(NOW).toISOString());
  assert.equal(store.state.playback.marker, 'preserve active context');
  assert.equal(view(state).overrides['1'].video, true);
  assert.equal(clocks(view(state)).available, 50); // 60 seconds at 10:42, minus ten elapsed.
  assert.equal(store.state.service.items[0].title, 'Renamed welcome');
});

test('skips and backtracking follow authoritative item starts instead of resetting to local polling time', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  fixture.now += 120000; fixture.advance('303', fixture.now - 10000); await sync.poll();
  assert.equal(store.state.service.currentItemId,'3'); assert.equal(clocks(view(state)).remaining,290);
  fixture.now += 30000; fixture.advance('301', fixture.now - 5000); await sync.poll();
  assert.equal(store.state.service.currentItemId,'1'); assert.equal(clocks(view(state)).remaining,295);
  assert.equal(store.state.service.liveStart,new Date(fixture.now-5000).toISOString());
});

test('a different gathering in the same plan cannot become the selected live service', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  fixture.advance('311'); await sync.poll();
  assert.equal(store.state.service.status,'other-service'); assert.equal(clocks(view(state)),null);
  await sync.select({ ...SELECTION, timeId:'31' });
  assert.equal(store.state.service.timeId,'31'); assert.equal(store.state.service.items[0].duration,600);
  assert.equal(view(state).people['2'],'Leader Late');
  assert.ok(store.state.service.items.some(item=>item.id==='8'));
});

test('waiting, completion, and pre/post/header/excluded items show explicit non-ticking states', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  fixture.current=null; await sync.poll(); assert.equal(store.state.service.status,'waiting'); assert.equal(clocks(view(state)),null);
  for (const id of ['305','306','307','308']) {
    fixture.advance(id); await sync.poll(); assert.equal(store.state.service.status,'outside-service'); assert.equal(clocks(view(state)),null);
  }
  fixture.current=null; fixture.times[0].attributes.live_ends_at=new Date(fixture.now).toISOString(); fixture.now+=10000;
  await sync.poll(); assert.equal(store.state.service.status,'complete'); assert.equal(clocks(view(state)),null);
});

test('missing start never invents a local timestamp, but a cached start survives transient missing fields', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  fixture.itemTimes.find(time=>time.id==='301').attributes.live_start_at=null; await sync.poll();
  assert.equal(store.state.service.liveStart,new Date(NOW).toISOString());
  fixture.current='302'; await sync.poll();
  assert.equal(store.state.service.liveStart,null); assert.equal(clocks(view(state)),null);
});

test('network loss keeps clocks running from the saved start, sanitizes errors and recovers on reconnect', async t => {
  const state = await setup(t); const { fixture, store, sync } = state;
  fixture.failure={matches:()=>true,status:503}; fixture.now+=180000; await sync.poll();
  assert.equal(store.state.service.connected,false); assert.equal(clocks(view(state)).remaining,120); assert.equal(clocks(view(state)).stale,true);
  assert.ok(!JSON.stringify(view(state)).includes('upstream-secret'));
  fixture.failure=null; fixture.advance('302',fixture.now-30000); await sync.poll();
  assert.equal(store.state.service.connected,true); assert.equal(clocks(view(state)).remaining,270); assert.equal(clocks(view(state)).stale,false);
});

test('restart recovers persisted selection and original PCO start without a producer session', async t => {
  const { fixture, directory, sync, pco } = await setup(t); sync.close(); pco.close();
  fixture.now+=120000;
  const store=new Store(directory); const connection=new PlanningCenter(store,{fetchImpl:fixture.fetch,now:()=>fixture.now});
  const restarted=new LiveSync(store,connection,{automatic:false,now:()=>fixture.now});
  t.after(()=>{restarted.close();connection.close();});
  assert.equal(store.state.service.connected,false); await restarted.poll();
  assert.equal(store.state.service.connected,true); assert.equal(clocks(displayState(store.state,fixture.now)).remaining,180);
  assert.equal(store.state.pcoSelection.timeId,'30');
});

test('429 honors Retry-After across polling and manual requests, then resumes safely', async t => {
  const { fixture, store, sync } = await setup(t);
  fixture.failure={matches:()=>true,status:429,headers:{'Retry-After':'19'}};
  await sync.poll(); const count=fixture.calls.length; assert.ok(sync.delay()>=19000);
  fixture.failure=null; await sync.poll(); assert.equal(fixture.calls.length,count); assert.equal(store.state.service.connected,false);
  fixture.now+=20000; await sync.poll(); assert.equal(store.state.service.connected,true);
});

test('roster permission failure keeps timing live and uses the selected person note', async t => {
  const { fixture, store, sync } = await setup(t);
  fixture.failure={matches:url=>url.pathname.endsWith('/team_members'),status:403};fixture.now+=10000;await sync.poll();
  assert.equal(store.state.service.connected,true); assert.equal(displayState(store.state,fixture.now).people['1'],'Host One'); assert.equal(displayState(store.state,fixture.now).people['2'],'Fallback 2');
  assert.ok(store.state.service.warnings.length);
});

test('pagination follows every item page, rejects external URLs and detects loops', async t => {
  const { fixture, store, sync } = await setup(t);
  const path='/services/v2/service_types/10/plans/20/items';
  fixture.handlers.set(path,url=>{
    const all=fixture.bundle();const second=url.searchParams.has('offset');
    return new Response(JSON.stringify({...all,data:all.data.slice(second?4:0,second?undefined:4),links:{next:second?null:`https://api.planningcenteronline.com${path}?include=item_times,item_notes,item_assignments&offset=100`}}));
  });
  fixture.now+=10000;await sync.poll();assert.equal(store.state.service.items.length,4);
  let calls=0;
  await assert.rejects(collection(async()=>{calls++;return {data:[],links:{next:'https://evil.example/steal'}};},path),/unsafe/);assert.equal(calls,1);
  await assert.rejects(collection(async()=>({data:[],links:{next:`https://api.planningcenteronline.com${path}?per_page=100`}}),path),/unsafe/);
});

test('invalid selections and incomplete snapshots leave the active service intact; stop only changes local state', async t => {
  const { fixture, store, sync } = await setup(t);const before=structuredClone(store.state.service);
  await assert.rejects(sync.select({...SELECTION,timeId:'999'}),/missing/); assert.deepEqual(store.state.service,before);
  await assert.rejects(sync.select({...SELECTION,planId:'../oauth/token'}),/valid/);
  fixture.itemTimes=fixture.itemTimes.filter(time=>time.id!=='302');fixture.now+=10000;await sync.poll();
  assert.equal(store.state.service.connected,false);assert.equal(store.state.service.currentItemId,'1');
  const calls=fixture.calls.length;sync.stop();assert.equal(store.state.pcoSelection,null);assert.equal(store.state.service,null);await sync.poll();assert.equal(fixture.calls.length,calls);
});

test('404 Live can recover a unique open ItemTime; ambiguous records are never guessed', async t => {
  const { fixture, store, sync } = await setup(t);fixture.liveMissing=true;await sync.poll();assert.equal(store.state.service.currentItemId,'1');
  fixture.itemTimes.find(time=>time.id==='302').attributes.live_start_at=new Date(NOW).toISOString();fixture.now+=10000;await sync.poll();
  assert.equal(store.state.service.connected,false);assert.match(store.state.service.syncMessage,/multiple/);
});

test('OAuth refresh during live polling persists rotated tokens and exposes no credentials', async t => {
  const { fixture, store, sync } = await setup(t);
  store.update(state=>{state.pco.method='oauth';state.pco.tokens={accessToken:'old',refreshToken:'old-refresh',expiresAt:fixture.now};});
  await sync.poll();assert.equal(store.state.pco.tokens.refreshToken,'fixture-new-refresh');
  assert.ok(!JSON.stringify(displayState(store.state,fixture.now)).includes('fixture-new'));
  assert.ok(fixture.calls.some(call=>call.url.endsWith('/oauth/token')));
});

test('credential changes cancel the previous selection, and unchanged saves preserve it', async t => {
  const { pco, store } = await setup(t);const selection=structuredClone(store.state.pcoSelection);
  pco.save({method:'pat',clientId:'',clientSecret:'',contactEmail:'fixture@example.org'},'https://foldback.example');assert.deepEqual(store.state.pcoSelection,selection);
  pco.save({method:'pat',clientId:'new',clientSecret:'new-secret',contactEmail:'fixture@example.org'},'https://foldback.example');assert.equal(store.state.pcoSelection,null);assert.equal(store.state.service.connected,false);
});

test('automatic synchronization runs independently without an admin browser', {timeout:5000}, async t => {
  const { fixture, store, pco, sync } = await setup(t);sync.close();fixture.advance('303',fixture.now-20000);
  let updated;
  const complete=new Promise(resolve=>{updated=resolve;});
  const automatic=new LiveSync(store,pco,{now:()=>fixture.now,publish:()=>updated()});t.after(()=>automatic.close());
  await complete;assert.equal(store.state.service.currentItemId,'3');assert.equal(store.state.service.liveStart,new Date(fixture.now-20000).toISOString());
});

test('catalogs paginate service types and exclude rehearsal/other plan times', async t => {
  const { fixture, sync } = await setup(t);
  fixture.handlers.set('/services/v2/service_types',url=>new Response(JSON.stringify({data:[{type:'ServiceType',id:url.searchParams.has('offset')?'11':'10',attributes:{name:'Campus'}}],links:{next:url.searchParams.has('offset')?null:'https://api.planningcenteronline.com/services/v2/service_types?offset=100'}})));
  assert.deepEqual((await sync.browse('service-types')).choices.map(type=>type.id),['10','11']);
  assert.deepEqual((await sync.browse('times',SELECTION)).choices.map(time=>time.id),['30','31']);
  await sync.browse('plans',SELECTION);
  const query=new URL(fixture.calls.at(-1).url).searchParams;assert.equal(query.get('filter'),'after');assert.ok(query.has('after'));
});

test('closing during an in-flight fetch aborts it and prevents late state writes', async t => {
  const { fixture, store, sync, pco, directory } = await setup(t);
  let reached;const called=new Promise(resolve=>{reached=resolve;});
  fixture.handlers.set('/services/v2/service_types/10/plans/20/live',async (url,options)=>{
    reached();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')), {once:true}));
  });
  const before=readFileSync(join(directory,'state.json'));
  const poll=sync.poll();await called;sync.close();pco.close();await poll;
  assert.deepEqual(readFileSync(join(directory,'state.json')),before);assert.equal(store.state.service.currentItemId,'1');
});

test('an OAuth sign-in into another organization invalidates the previous selection', async t => {
  const { fixture, store, sync, pco } = await setup(t);
  fixture.handlers.set('/services/v2',()=>new Response(JSON.stringify({data:{type:'Organization',id:'901',attributes:{name:'Another fixture church'}}})));
  await pco.verify();assert.equal(store.state.pcoSelection,null);assert.equal(store.state.service.connected,false);
  const calls=fixture.calls.length;await sync.poll();assert.equal(fixture.calls.length,calls);
});
