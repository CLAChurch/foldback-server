import { CAMPUS_ZONE, localTime, STALE_AFTER_MS } from '/lib/model.mjs';

export function createServicePicker(element, { request, changed, toast }) {
  let data; let signature = ''; let generation = 0; let disposed = false;
  function status(view) {
    const service = view?.service;
    const target = element.querySelector('[data-sync-status]');
    if (!target) return;
    const stale = service?.source === 'pco' && (!service.connected || view.serverTime - Date.parse(service.lastSuccessAt) > STALE_AFTER_MS);
    target.textContent = service?.source === 'pco'
      ? stale ? service.syncMessage || 'PCO data is stale. Keeping the last known item while reconnecting.' : service.statusMessage || `Following PCO Live${service.timeName ? ' · ' + service.timeName : ''}. Advance items in Planning Center.`
      : 'Select a service below. The sample remains separate from Planning Center.';
    target.classList.toggle('sync-warning', Boolean(stale));
    const warnings = element.querySelector('[data-sync-warnings]');
    warnings.textContent = (service?.warnings ?? []).join(' ');
    warnings.hidden = !warnings.textContent;
  }
  function render() {
    const currentGeneration = ++generation;
    const ready = data.pco.configured && data.pco.verifiedAt && (data.pco.method === 'pat' || data.pco.authorized);
    element.innerHTML = `<div class="panel-heading"><div><div class="eyebrow">PLANNING CENTER LIVE</div><h2>Choose a service to follow</h2></div><button type="button" data-stop ${data.service?.source === 'pco' || data.pcoLive?.selection ? '' : 'disabled'}>Stop following</button></div>
      <p class="hint" data-sync-status role="status"></p><p class="hint sync-warning" data-sync-warnings hidden></p>
      ${ready ? `<form class="service-picker-form"><label>Service type<select name="serviceTypeId" required aria-label="Service type"></select></label><label>Plan<select name="planId" required aria-label="Plan"></select></label><label>Specific service time<select name="timeId" required aria-label="Specific service time"></select></label><label class="older-plans"><input type="checkbox" name="older"> Include plans from the past year</label><div class="pco-actions"><button type="submit" class="primary">Follow PCO Live</button><button type="button" data-reload>Refresh choices</button></div></form>` : '<p class="hint">Connect Planning Center and test Services access in <a href="#connections">Connections</a> to choose a real service.</p>'}`;
    status(data.view);
    const valid = () => !disposed && currentGeneration === generation;
    const form = element.querySelector('form');
    let busy = false;
    const enable = () => {
      if (!form) return;
      for (const select of form.querySelectorAll('select')) select.disabled = busy || select.options.length < 2;
      form.querySelector('[type=submit]').disabled = busy || !form.elements.timeId.value;
      form.querySelector('[data-reload]').disabled = busy;
      form.elements.older.disabled = busy;
      form.setAttribute('aria-busy', String(busy));
    };
    const run = async operation => {
      if (busy) return;
      busy = true; enable();
      try { await operation(); }
      catch (error) { if (valid()) toast(error.message, true); }
      finally { busy = false; if (valid()) enable(); }
    };
    element.querySelector('[data-stop]').onclick = () => run(async () => {
      const value = await request('/api/pco/stop', {});
      if (valid()) { changed(value); toast('Stopped following PCO on this server. Planning Center is unchanged.'); }
    });
    if (!form) return;
    const { serviceTypeId: types, planId: plans, timeId: times } = form.elements;
    const fill = (select, choices, placeholder, wanted = '') => {
      select.replaceChildren(new Option(placeholder, ''), ...choices.map(choice => new Option(choice.name, choice.id)));
      if (choices.some(choice => choice.id === wanted)) select.value = wanted;
      else if (choices.length === 1) select.value = choices[0].id;
    };
    const loadTimes = async (wanted = '') => {
      fill(times, [], 'Choose a plan first');
      if (!plans.value) return;
      const result = await request('/api/pco/times', { serviceTypeId: types.value, planId: plans.value });
      if (!valid()) return;
      const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
      fill(times, result.choices.map(choice => ({ ...choice, name: choice.startsAt && choice.endsAt ? `${dateFormat.format(Date.parse(choice.startsAt))} · ${localTime(Date.parse(choice.startsAt))}${choice.name ? ' · ' + choice.name : ''} · ends ${localTime(Date.parse(choice.endsAt))}` : `${choice.name || 'Service time'} · missing scheduled start/finish` })), result.choices.length ? 'Choose a service time' : 'No service times in this plan', wanted);
      for (const choice of result.choices) if (!choice.endsAt || !choice.startsAt) {
        const option = [...times.options].find(option => option.value === choice.id); option.disabled = true;
        if (times.value === choice.id) times.value = '';
      }
    };
    const loadPlans = async (wanted = '', wantedTime = '') => {
      fill(plans, [], 'Choose a service type first'); fill(times, [], 'Choose a plan first');
      if (!types.value) return;
      const result = await request('/api/pco/plans', { serviceTypeId: types.value, older: form.elements.older.checked });
      if (!valid()) return;
      if (wanted && !result.choices.some(choice => choice.id === wanted) && data.service?.planId === wanted) result.choices.push({ id: wanted, name: data.service.title });
      fill(plans, result.choices, result.choices.length ? 'Choose a plan' : 'No plans in this date range', wanted);
      await loadTimes(wantedTime);
    };
    const load = () => run(async () => {
      fill(types, [], 'Loading service types…'); fill(plans, [], 'Choose a service type first'); fill(times, [], 'Choose a plan first');
      const result = await request('/api/pco/service-types', {});
      if (!valid()) return;
      const selected = data.pcoLive?.selection;
      fill(types, result.choices, 'Choose a service type', selected?.serviceTypeId || data.settings.serviceTypeId);
      await loadPlans(selected?.planId, selected?.timeId);
    });
    types.onchange = () => run(() => loadPlans());
    plans.onchange = () => run(() => loadTimes());
    times.onchange = enable;
    form.elements.older.onchange = () => run(() => loadPlans(plans.value, times.value));
    form.querySelector('[data-reload]').onclick = load;
    form.onsubmit = event => {
      event.preventDefault();
      const values = { serviceTypeId: types.value, planId: plans.value, timeId: times.value };
      run(async () => { const value = await request('/api/pco/select', values); if (valid()) { changed(value); toast('Following Planning Center Live. Advance the service in PCO.'); } });
    };
    load();
  }
  return {
    update(value) {
      data = value;
      const next = JSON.stringify([data.pco.configured, data.pco.verifiedAt, data.pco.authorized, data.pcoLive?.selection, data.service?.source]);
      if (signature !== next) { signature = next; render(); }
      else status(data.view);
    },
    status,
    destroy() { disposed = true; generation++; },
  };
}
