const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function renderPlanningCenter(element, { info, request, changed, toast }) {
  const privateTransport = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const status = info.verifiedAt ? 'Services access verified' : info.authorized ? 'Signed in · test access' : info.configured ? 'Saved · not verified' : 'Not connected';
  element.innerHTML = `
    <div class="connection-row"><strong>Planning Center</strong><span class="status-tag">${esc(status)}</span></div>
    ${!info.configured && !info.deferred ? '<p class="setup-callout"><strong>Setup: connect your church</strong><br>Connect now, or skip this step and try the sample service.</p>' : ''}
    ${info.organization ? `<p class="pco-organization">${esc(info.organization.name)}</p>` : ''}
    ${info.verifiedAt ? `<p class="hint">Last checked ${esc(new Date(info.verifiedAt).toLocaleString())}. <a href="#service-picker">Choose a plan and service time</a> to follow PCO Live.</p>` : ''}
    <form id="pco-form">
      <label>Connection method<select name="method"><option value="oauth" ${info.method === 'oauth' ? 'selected' : ''}>OAuth sign-in</option><option value="pat" ${info.method === 'pat' ? 'selected' : ''}>Personal token · own church only</option></select></label>
      <p class="hint" id="pco-method-help"></p>
      <p class="hint"><a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noopener noreferrer">Open Planning Center developer settings</a></p>
      <div id="pco-callback"><label>OAuth callback URL<input readonly value="${esc(new URL('/auth/pco/callback', location.origin).href)}"></label><p class="hint">Register this exact URL in your OAuth application. Each self-hosted installation uses its own application details.</p></div>
      <label>Application ID<input name="clientId" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="256" ${info.configured ? 'placeholder="Saved — leave both fields blank to keep"' : ''}></label>
      <label>Secret<input name="clientSecret" type="password" autocomplete="off" maxlength="2048" ${info.configured ? 'placeholder="Saved — enter only to replace"' : ''}></label>
      <label>Integration contact email<input name="contactEmail" type="email" autocomplete="email" maxlength="254" value="${esc(info.contactEmail)}" required></label>
      <p class="hint">Planning Center requires an application contact on API requests. Credentials stay on this campus server and are never shown on the TV.</p>
      ${!privateTransport ? '<p class="form-error">Open this panel using HTTPS, or on the server itself, to enter connection details.</p>' : ''}
      <div class="pco-actions"><button type="submit" class="primary" ${privateTransport ? '' : 'disabled'} id="pco-save">Save application details</button>${!info.configured ? '<button type="button" id="pco-skip">Connect later</button>' : ''}</div>
    </form>
    ${info.configured ? `<div class="pco-actions">${info.method === 'oauth' ? `<button type="button" id="pco-sign-in" ${privateTransport ? '' : 'disabled'}>${info.authorized ? 'Sign in again' : 'Sign in with Planning Center'}</button>` : ''}<button type="button" id="pco-test" ${privateTransport && (info.method === 'pat' || info.authorized) ? '' : 'disabled'}>Test connection</button><button type="button" id="pco-disconnect">Remove saved connection</button></div><p class="hint">Removing the saved connection only removes it from this server. It leaves other campuses connected.</p>` : ''}`;
  const form = element.querySelector('#pco-form');
  const methodHelp = () => {
    const oauth = form.elements.method.value === 'oauth';
    element.querySelector('#pco-callback').hidden = !oauth;
    element.querySelector('#pco-method-help').textContent = oauth
      ? 'Use OAuth for an app distributed to multiple churches. Sign in at Planning Center and approve access to Services.'
      : 'For an internal integration within your own church organization. Planning Center requires OAuth for apps distributed to multiple churches.';
    element.querySelector('#pco-save').textContent = oauth ? 'Save application details' : 'Save & test connection';
  };
  form.elements.method.addEventListener('change', methodHelp); methodHelp();
  let busy = false;
  const run = async operation => {
    if (busy) return;
    busy = true;
    const controls = [...element.querySelectorAll('button, input, select')];
    const disabledBefore = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await operation(); }
    catch (error) { toast(error.message, true); }
    finally { controls.forEach((control, i) => { control.disabled = disabledBefore[i]; }); busy = false; }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    // Capture before disabling controls, so FormData includes every field.
    const values = Object.fromEntries(new FormData(form));
    run(async () => {
      const saved = await request('/api/pco/save', values);
      form.elements.clientId.value = ''; form.elements.clientSecret.value = '';
      if (values.method === 'pat') {
        try { changed(await request('/api/pco/test', {})); toast('Planning Center Services access verified.'); }
        catch (error) { changed(saved); throw error; }
      } else { changed(saved); toast('Application details saved. Sign in with Planning Center to continue.'); }
    });
  });
  element.querySelector('#pco-skip')?.addEventListener('click', () => run(async () => {
    changed(await request('/api/pco/defer', {})); toast('You can connect Planning Center here later.');
    document.querySelector('#service')?.scrollIntoView();
  }));
  element.querySelector('#pco-test')?.addEventListener('click', () => run(async () => {
    try { changed(await request('/api/pco/test', {})); toast('Planning Center Services access verified.'); }
    catch (error) { changed(await request('/api/admin')); throw error; }
  }));
  element.querySelector('#pco-sign-in')?.addEventListener('click', () => run(async () => {
    const { authorizeUrl } = await request('/api/pco/authorize', {});
    location.assign(authorizeUrl);
  }));
  element.querySelector('#pco-disconnect')?.addEventListener('click', () => run(async () => {
    changed(await request('/api/pco/disconnect', {})); toast('Saved connection removed from this server.');
  }));
}
