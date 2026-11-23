import { createStage } from '/stage.mjs';
import { durationText, localTime, overrideKey } from '/lib/model.mjs';
import { renderPlanningCenter } from '/pco.mjs';
const app = document.querySelector('#app');
let data;
let stage;
let events;
let refreshSignature = '';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth')) { await boot(); }
    throw new Error(value.error || 'Request failed.');
  }
  return value;
}
let toastTimer;
function toast(message, error = false) {
  const target = document.querySelector('#toast');
  target.textContent = message; target.hidden = false; target.classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { target.hidden = true; }, 6000);
}
async function action(button, operation) {
  button.disabled = true;
  try { await operation(); } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

function renderLogin(configured) {
  app.innerHTML = `<div class="login-shell"><section class="login-intro"><a class="brand" href="/admin"><span class="brand-icon">F</span> CAMPUS FOLDBACK</a><div><div class="eyebrow">ONE SERVICE. ONE CLEAR VIEW.</div><h1>Keep the host<br>in the moment.</h1><p>The next cue, the right person, and the time that matters. All on your campus network.</p></div><div class="login-meta">CAMPUS LOCAL <span>BC PACIFIC · UTC−7</span></div></section><section class="login-panel"><div class="eyebrow">${configured ? 'PRODUCER ACCESS' : 'FIRST-TIME SETUP'}</div><h2>${configured ? 'Welcome back.' : 'Set up this campus.'}</h2><p>${configured ? 'Enter this server’s control panel password.' : 'Use the pairing code shown on the server’s TV or in its startup console, then choose a control panel password.'}</p><form id="auth-form">${configured ? '' : '<label>Pairing code<input name="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="off" required></label>'}<label>${configured ? 'Password' : 'Create password'}<input name="password" type="password" autocomplete="${configured ? 'current-password' : 'new-password'}" minlength="12" maxlength="256" required></label>${configured ? '' : '<label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><div class="hint">Use at least 12 characters.</div>'}<p id="auth-error" class="form-error" role="alert"></p><button class="primary" type="submit">${configured ? 'Open control panel' : 'Create campus password'}</button></form><a class="subtle-link" href="/display" target="_blank" rel="noopener">Open the TV display</a></section></div>`;
  document.querySelector('#auth-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (!configured && values.password !== values.confirm) { document.querySelector('#auth-error').textContent = 'The passwords do not match.'; return; }
    action(form.querySelector('button'), async () => {
      try { await api(`/api/auth/${configured ? 'login' : 'setup'}`, values); await boot(); }
      catch (error) { document.querySelector('#auth-error').textContent = error.message; }
    });
  });
}

function renderAdmin() {
  app.innerHTML = `<div class="admin-shell"><aside class="sidebar"><a class="brand" href="/admin"><span class="brand-icon">F</span> FOLDBACK</a><div class="campus-chip"><span class="eyebrow">YOUR CAMPUS</span><strong id="campus-name"></strong></div><nav aria-label="Control panel"><a href="#service" class="active">Service preview</a><a href="#campus-settings">Campus setup</a><a href="#connections">Connections</a><a href="#access">Password</a></nav><div class="sidebar-bottom"><span>BC PACIFIC</span><strong>UTC−7, year-round</strong><button id="logout" class="text-button">Log out</button></div></aside><div class="workspace"><header><div><div class="eyebrow">PRODUCER CONTROL PANEL</div><h1>Service preview</h1></div><a class="button primary" href="/display" target="_blank" rel="noopener">Open TV display</a></header><section id="service" class="service-toolbar"><div><span class="status-pill">SAMPLE MODE</span><strong id="service-title">No service selected</strong><span id="service-end"></span></div><button id="load-sample">Load sample service</button></section><div class="preview-heading"><h2>What the host sees</h2><span>1920 × 1080 · scaled to fit</span></div><section class="preview-wrap"><div id="preview"></div></section><p class="overflow-warning" id="overflow-warning" role="status" hidden></p><p class="preview-note">The TV runs independently. Closing this control panel leaves the display running.</p><section class="panel run-panel"><div class="panel-heading"><div><div class="eyebrow">PREPARE THE SERVICE</div><h2>Running order</h2></div><span class="muted">Video flags follow the item</span></div><div id="running-order"></div></section><div class="settings-grid"><section class="panel" id="campus-settings"><div class="eyebrow">SAVED ON THIS SERVER</div><h2>Campus setup</h2><form id="settings-form"><label>Campus name<input name="campus" required maxlength="60"></label><label>Foldback output<select name="output"><option value="direct">Direct HDMI or DisplayPort</option><option value="propresenter">ProPresenter routing</option></select></label><p class="hint">On the installed appliance, the TV starts automatically in direct mode. ProPresenter mode stops the local renderer and keeps the display URL available.</p><label>Resolve item person from<select name="personMode"><option value="scheduled-fallback">Scheduled person, then item note</option><option value="scheduled">Scheduled person only</option><option value="note">Item note only</option></select></label><label>Person item-note field<input name="personNote" maxlength="80" placeholder="Person"></label><label>Preferred network<select name="networkPreference"><option value="ethernet">Wired Ethernet</option><option value="wifi">Wi-Fi</option></select></label><p class="hint">On the installed server, use the local console and sudo nmtui to connect Ethernet or Wi-Fi. The preference here is saved for campus setup.</p><div class="timezone-field"><span>Campus clock</span><strong>BC Pacific · UTC−7 year-round</strong></div><button class="primary" type="submit">Save campus settings</button></form></section><div class="right-stack"><section class="panel" id="connections"><div class="eyebrow">CAMPUS CONNECTIONS</div><h2>Service & display</h2><div id="pco-setup"></div><div class="connection-row"><strong>ProPresenter playback</strong><span class="status-tag">Optional</span></div><p class="hint">Current Mac and Windows releases are the target. Campus connection and media-identification testing are still needed. Until then, flagged videos use the planned-duration estimate.</p><label>Stable TV display URL<input id="display-url" readonly></label><button id="copy-url">Copy display URL</button><p class="hint">Use this server’s campus LAN address on another computer. This display URL requires no control panel password.</p></section><section class="panel" id="access"><div class="eyebrow">PRODUCER ACCESS</div><h2>Change password</h2><form id="password-form"><label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label><label>New password<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" minlength="12" maxlength="256" required></label><button type="submit">Update password</button></form></section></div></div><footer>Campus Foldback <span>Development application · PCO live sync and ProPresenter playback pending</span></footer></div></div>`;
  stage = createStage(document.querySelector('#preview'), { preview: true });
  const showPco = () => renderPlanningCenter(document.querySelector('#pco-setup'), {
    info: data.pco, request: api, toast,
    changed(value) { data = value; updateService(); showPco(); },
  });
  showPco();
  if (!data.pco.configured && !data.pco.deferred) requestAnimationFrame(() => document.querySelector('#connections').scrollIntoView());
  document.querySelector('#preview').addEventListener('overflowchange', event => {
    const warning = document.querySelector('#overflow-warning');
    warning.hidden = !event.detail;
    warning.textContent = `Text exceeds the TV layout: ${event.detail.replaceAll('-', ' ')}. Shorten the PCO content before service.`;
  });
  const form = document.querySelector('#settings-form');
  const outputLabel = document.createElement('label');
  outputLabel.textContent = 'Physical TV output';
  const outputSelect = document.createElement('select');
  outputSelect.name = 'connector';
  outputSelect.add(new Option('Automatic / primary output', 'auto'));
  for (const output of data.system.outputs) outputSelect.add(new Option(`${output.name}${output.connected ? '' : ' (disconnected)'}`, output.name));
  if (data.settings.connector && ![...outputSelect.options].some(option => option.value === data.settings.connector)) outputSelect.add(new Option(`${data.settings.connector} (saved)`, data.settings.connector));
  outputLabel.append(outputSelect);
  form.elements.output.parentElement.after(outputLabel);
  for (const [key, value] of Object.entries(data.settings)) if (form.elements[key]) form.elements[key].value = value;
  form.addEventListener('submit', event => {
    event.preventDefault();
    action(form.querySelector('button'), async () => {
      data = await api('/api/settings', Object.fromEntries(new FormData(form))); updateService(); toast('Campus settings saved.');
    });
  });
  const passwordForm = document.querySelector('#password-form');
  passwordForm.addEventListener('submit', event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(passwordForm));
    if (values.password !== values.confirm) { toast('The new passwords do not match.', true); return; }
    action(passwordForm.querySelector('button'), async () => { await api('/api/auth/password', values); passwordForm.reset(); toast('Password updated. Other control panel sessions have been logged out.'); });
  });
  document.querySelector('#display-url').value = new URL('/display', location.origin).href;
  document.querySelector('#copy-url').onclick = event => action(event.currentTarget, async () => {
    const input = document.querySelector('#display-url');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value);
    else { input.focus(); input.select(); toast('Display URL selected. Copy it with your keyboard.'); return; }
    toast('Display URL copied.');
  });
  document.querySelector('#logout').onclick = event => action(event.currentTarget, async () => { await api('/api/auth/logout', {}); await boot(); });
  document.querySelector('#load-sample').onclick = event => action(event.currentTarget, async () => { data = await api('/api/demo/load', {}); updateService(); toast('Sample service loaded. This is not connected to PCO.'); });
  document.querySelector('#running-order').addEventListener('click', event => {
    const button = event.target.closest('button[data-advance]');
    if (button) action(button, async () => { data = await api('/api/demo/advance', { itemId: button.dataset.advance }); updateService(); });
  });
  document.querySelector('#running-order').addEventListener('change', event => {
    const row = event.target.closest('[data-item]'); if (!row) return;
    const itemId = row.dataset.item;
    action(event.target, async () => {
      if (event.target.name === 'duration') {
        const minutes = Number(event.target.value);
        if (!Number.isFinite(minutes) || minutes < 0 || !Number.isInteger(minutes * 60)) throw new Error('Enter a duration in minutes, in whole seconds.');
        data = await api('/api/demo/duration', { itemId, duration: Math.round(minutes * 60) });
      } else {
        data = await api('/api/overrides', { itemId, video: row.querySelector('[name=video]').checked, source: row.querySelector('[name=source]').value, mediaId: '' });
      }
      updateService();
    });
  });
  updateService();
  events = new EventSource('/api/events');
  events.addEventListener('state', async event => {
    const view = JSON.parse(event.data); stage.update(view);
    const signature = JSON.stringify([view.service, view.overrides, view.people]);
    if (signature !== refreshSignature) {
      refreshSignature = signature;
      try { data = await api('/api/admin'); updateService(); } catch (error) { toast(error.message, true); }
    }
  });
  events.onerror = () => stage.disconnected();
}

function updateService() {
  document.querySelector('#campus-name').textContent = data.settings.campus;
  document.querySelector('#service-title').textContent = data.service?.title || 'No service selected';
  document.querySelector('#service-end').textContent = data.service ? `Scheduled finish ${localTime(Date.parse(data.service.scheduledEnd), data.settings.timezone)}` : 'Connect PCO after account verification, or try the sample below.';
  document.querySelector('#load-sample').textContent = data.service ? 'Restart sample service' : 'Load sample service';
  document.querySelector('.status-pill').textContent = data.service?.source === 'sample' ? 'SAMPLE MODE' : 'AWAITING PCO';
  stage.update(data.view);
  const container = document.querySelector('#running-order');
  if (!data.service) { container.innerHTML = '<div class="empty-order"><strong>Your running order will appear here.</strong><p>Load the sample service to check the layout, names, video estimates, and clocks.</p></div>'; return; }
  container.innerHTML = `<div class="table-scroll"><table><thead><tr><th>Item / person / description</th><th>Minutes</th><th>Video</th><th>Video source</th><th>Sample controls</th></tr></thead><tbody>${data.service.items.map((item, index) => {
    const current = item.id === data.service.currentItemId;
    const override = data.overrides[overrideKey(data.service.id, item.id)] || { video: false, source: 'auto' };
    return `<tr data-item="${escapeHTML(item.id)}" class="${current ? 'current-row' : ''}"><td><div class="row-title"><span class="order-number">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHTML(item.title)}</strong>${current ? '<span class="now-tag">NOW</span>' : ''}</div><div class="row-person">${escapeHTML(data.view.people[item.id] || 'No person assigned')}</div>${item.description ? `<p class="row-description">${escapeHTML(item.description)}</p>` : ''}</td><td><input type="number" name="duration" min="0" max="1440" step="any" aria-label="${escapeHTML(item.title)} duration in minutes" value="${item.duration / 60}" ${data.service.source !== 'sample' ? 'disabled' : ''}></td><td><input type="checkbox" name="video" aria-label="${escapeHTML(item.title)} is a video" ${override.video ? 'checked' : ''}></td><td><select name="source" aria-label="${escapeHTML(item.title)} video source" ${override.video ? '' : 'disabled'}><option value="auto" ${override.source === 'auto' ? 'selected' : ''}>Auto · estimate until linked</option><option value="estimate" ${override.source === 'estimate' ? 'selected' : ''}>Estimate only · external player</option></select></td><td><button data-advance="${escapeHTML(item.id)}" ${data.service.source !== 'sample' || current ? 'disabled' : ''}>${current ? 'Live in sample' : 'Take live in sample'}</button></td></tr>`;
  }).join('')}</tbody></table></div><p class="hint table-note">Sample controls affect this preview and TV display only. During a real service, the producer will advance items in PCO Live.</p>`;
}

async function boot() {
  events?.close(); events = null; stage?.destroy(); stage = null;
  const status = await api('/api/auth/status');
  if (!status.configured || !status.loggedIn) return renderLogin(status.configured);
  data = await api('/api/admin'); renderAdmin();
}
boot().catch(error => { app.textContent = `Could not open the control panel: ${error.message}`; });
