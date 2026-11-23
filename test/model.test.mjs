import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, sampleService, displayState, clocks, durationText, localTime, personFor, overrideKey } from '../src/model.mjs';
const start = Date.parse('2026-11-22T17:42:00Z'); // 10:42 BC Pacific, including November.
function fixture() {
  const state = initialState(); state.service = sampleService(start); state.auth = { hash: 'private' };
  return state;
}
test('10:42 acceptance example; later edit recalculates without changing live start', () => {
  const state = fixture();
  let value = clocks(displayState(state, start));
  assert.equal(value.remaining, 300);
  assert.equal(value.available, 180);
  assert.equal(localTime(start), '10:42 AM');
  assert.equal(localTime(value.projectedEnd), '11:02 AM');
  state.service.items[1].duration += 120;
  value = clocks(displayState(state, start));
  assert.equal(value.available, 60);
  assert.equal(localTime(value.projectedEnd), '11:04 AM');
  assert.equal(state.service.liveStart, new Date(start).toISOString());
});
test('regular overrun stays steady at exactly 10 percent and flashes strictly after', () => {
  const state = fixture();
  const at30 = clocks(displayState(state, start + 330000));
  assert.equal(at30.remaining, -30); assert.equal(at30.over, true); assert.equal(at30.flash, false);
  assert.equal(clocks(displayState(state, start + 331000)).flash, true);
  const later = clocks(displayState(state, start + 400000));
  assert.equal(later.projectedEnd, start + 400000 + 900000);
});
test('zero-duration regular item and end of service remain defined', () => {
  const state = fixture(); state.service.items[0].duration = 0;
  assert.equal(clocks(displayState(state, start)).flash, false);
  assert.equal(clocks(displayState(state, start + 1000)).flash, true);
  state.service.currentItemId = 'closing';
  assert.equal(clocks(displayState(state, start)).next, null);
});
test('video estimate holds at zero and never flashes, while end-on-time may overrun', () => {
  const state = fixture(); state.overrides[overrideKey(state.service.id, 'welcome')] = { video: true, source: 'auto', mediaId: '' };
  const value = clocks(displayState(state, start + 600000));
  assert.equal(value.label, 'Video estimate'); assert.equal(value.remaining, 0);
  assert.equal(value.over, false); assert.equal(value.flash, false); assert.ok(value.available < 0);
});
test('identified playback follows pause and seeks; loss falls back to original item start', () => {
  const state = fixture();
  state.overrides[overrideKey(state.service.id, 'welcome')] = { video: true, source: 'auto', mediaId: 'matched-media' };
  const observed = start + 180000;
  state.playback = { connected: true, identified: true, ambiguous: false, itemId: 'welcome', mediaId: 'matched-media', observedAt: new Date(observed).toISOString(), remaining: 80, playing: true };
  assert.equal(clocks(displayState(state, observed + 2000)).remaining, 78);
  state.playback.playing = false;
  assert.equal(clocks(displayState(state, observed + 2000)).remaining, 80);
  state.playback.remaining = 20;
  assert.equal(clocks(displayState(state, observed + 2000)).remaining, 20);
  state.playback.connected = false;
  let value = clocks(displayState(state, observed));
  assert.equal(value.label, 'Video estimate'); assert.equal(value.remaining, 120);
  state.playback.connected = true;
  assert.equal(clocks(displayState(state, observed)).remaining, 20);
  state.playback.remaining = 0;
  assert.equal(clocks(displayState(state, observed)).remaining, 0);
});
test('unrelated loops, ambiguous/stale playback and estimate-only cannot take over', () => {
  const state = fixture();
  state.overrides[overrideKey(state.service.id, 'welcome')] = { video: true, source: 'auto', mediaId: 'correct' };
  state.playback = { connected: true, identified: true, itemId: 'welcome', mediaId: 'loop', observedAt: new Date(start).toISOString(), remaining: 8, playing: true };
  assert.equal(clocks(displayState(state, start)).label, 'Video estimate');
  state.playback.mediaId = 'correct'; state.playback.ambiguous = true;
  assert.equal(clocks(displayState(state, start)).label, 'Video estimate');
  state.playback.ambiguous = false;
  assert.equal(clocks(displayState(state, start + 16000)).label, 'Video estimate');
  state.overrides[overrideKey(state.service.id, 'welcome')].source = 'estimate';
  assert.equal(clocks(displayState(state, start)).label, 'Video estimate');
});
test('overrides follow ID through renaming and reordering; new items are unchecked', () => {
  const state = fixture(); state.overrides[overrideKey(state.service.id, 'welcome')] = { video: true, source: 'estimate' };
  state.service.items[0].title = 'New title'; state.service.items.reverse();
  const view = displayState(state, start);
  assert.equal(view.overrides.welcome.video, true);
  assert.equal(view.overrides.closing.video, false);
  assert.equal(view.auth, undefined);
});
test('Now and Next resolve people independently for all modes', () => {
  const state = fixture();
  const [now, , next] = state.service.items;
  assert.equal(personFor(now, state.settings), 'Graham Caesar');
  assert.equal(personFor(next, state.settings), 'Campus Host');
  state.settings.personMode = 'scheduled';
  assert.equal(personFor(next, state.settings), '');
  state.settings.personMode = 'note'; state.settings.personNote = 'Another field';
  assert.equal(personFor(now, state.settings), '');
});
test('stale PCO data is detected; sample is always explicitly a separate source', () => {
  const state = fixture(); state.service.source = 'pco';
  assert.equal(clocks(displayState(state, start + 16000)).stale, true);
  state.service.lastSuccessAt = new Date(start + 16000).toISOString();
  assert.equal(clocks(displayState(state, start + 16000)).stale, false);
  state.service.connected = false;
  assert.equal(clocks(displayState(state, start + 16000)).stale, true);
});
test('BC offset is fixed in summer and winter, and digits do not round overrun early', () => {
  assert.equal(localTime(Date.parse('2026-07-01T17:42:00Z')), '10:42 AM');
  assert.equal(localTime(Date.parse('2026-12-01T17:42:00Z')), '10:42 AM');
  assert.equal(durationText(300), '5:00'); assert.equal(durationText(-30.9), '0:30');
  assert.equal(durationText(0), '0:00'); assert.equal(durationText(65.5), '1:06');
});
