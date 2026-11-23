import { clocks, durationText, localTime, STALE_AFTER_MS } from '/lib/model.mjs';

export function createStage(element, { preview = false } = {}) {
  element.classList.add('stage');
  element.innerHTML = `<div class="canvas">
    <div class="stage-notice" hidden></div>
    <section class="now-band"><div class="now-main"><div class="stage-label">NOW</div><div class="now-title stage-text"></div><div class="now-person stage-text"></div></div><div class="now-description stage-text"></div></section>
    <section class="next-band"><div class="stage-label">NEXT</div><div class="next-main"><div class="next-title stage-text"></div><div class="next-details stage-text"></div></div></section>
    <section class="clock-band"><div class="clock"><div class="clock-label item-label"></div><div class="clock-value item-clock"></div><div class="over-label item-over"></div></div><div class="clock"><div class="clock-label">To end on time</div><div class="clock-value available-clock"></div><div class="over-label available-over"></div></div><div class="clock"><div class="clock-label">Current time</div><div class="clock-value current-clock"></div><div class="over-label"></div></div><div class="clock"><div class="clock-label">Projected end</div><div class="clock-value projected-clock"></div><div class="over-label"></div></div></section>
    <div class="stage-empty" hidden><div class="stage-label">CAMPUS FOLDBACK</div><h1>Ready when you are.</h1><p>Choose a service in the control panel.</p><p class="pairing"></p></div>
  </div>`;
  const canvas = element.querySelector('.canvas');
  const q = selector => element.querySelector(selector);
  const set = (selector, value) => { const target = q(selector); if (target.textContent !== value) target.textContent = value; };
  const resize = () => { const scale = Math.min(element.clientWidth / 1920, element.clientHeight / 1080); canvas.style.transform = `scale(${scale})`; };
  const observer = new ResizeObserver(resize); observer.observe(element); resize();
  let view = null;
  let transportLost = false;
  let syncNow = Date.now();
  let syncAt = performance.now();
  let signature = '';
  let lastOverflow = '';
  const render = () => {
    if (!view) return;
    const now = syncNow + (performance.now() - syncAt);
    const timing = clocks(view, now);
    q('.stage-empty').hidden = Boolean(timing);
    q('.now-band').hidden = !timing; q('.next-band').hidden = !timing; q('.clock-band').hidden = !timing;
    const notice = q('.stage-notice');
    const notices = [];
    if (view.service?.source === 'sample') notices.push('SAMPLE SERVICE');
    if (transportLost) notices.push('SERVER CONNECTION LOST · TIMING CONTINUES');
    else if (view.service?.source === 'pco' && (!view.service.connected || now - Date.parse(view.service.lastSuccessAt) > STALE_AFTER_MS)) notices.push('PCO DATA STALE · LAST KNOWN ITEM');
    notice.hidden = notices.length === 0; notice.textContent = notices.join('  /  ');
    if (!timing) {
      set('.stage-empty h1', view.service?.source === 'pco' ? view.service.status === 'complete' ? 'Service complete.' : 'Waiting for PCO Live.' : 'Ready when you are.');
      set('.stage-empty p:not(.pairing)', view.service?.source === 'pco' ? view.service.statusMessage || 'Waiting for the selected service time.' : 'Choose a service in the control panel.');
      return;
    }
    const { item, next } = timing;
    set('.now-title', item.title);
    set('.now-person', view.people[item.id] || '');
    set('.now-description', item.description || '');
    q('.now-band').classList.toggle('no-description', !item.description);
    set('.next-title', next?.title || 'End of service');
    const nextPerson = next ? view.people[next.id] || '' : '';
    const planned = next ? `${durationText(next.duration)} planned` : '';
    set('.next-details', nextPerson ? `${nextPerson} · ${planned}` : planned);
    set('.item-label', timing.label);
    set('.item-clock', durationText(timing.remaining));
    set('.item-over', timing.over ? 'OVER' : '');
    q('.item-clock').classList.toggle('over', timing.over);
    q('.item-over').classList.toggle('over', timing.over);
    q('.item-clock').classList.toggle('flashing', timing.flash);
    set('.available-clock', durationText(timing.available));
    set('.available-over', timing.available < 0 ? 'OVER' : '');
    q('.available-clock').classList.toggle('over', timing.available < 0);
    q('.available-over').classList.toggle('over', timing.available < 0);
    set('.current-clock', localTime(now, view.settings.timezone));
    set('.projected-clock', localTime(timing.projectedEnd, view.settings.timezone));
    const newSignature = [item.title, item.description, view.people[item.id], next?.title, nextPerson, planned].join('|');
    if (preview && signature !== newSignature) {
      signature = newSignature;
      requestAnimationFrame(() => {
        const overflow = [...element.querySelectorAll('.stage-text')].filter(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
        const message = overflow.map(node => node.className.split(' ')[0]).join(', ');
        if (lastOverflow !== message) { lastOverflow = message; element.dispatchEvent(new CustomEvent('overflowchange', { detail: message })); }
      });
    }
  };
  document.fonts.ready.then(() => { signature = ''; render(); });
  const timer = setInterval(render, 200);
  return {
    update(value) { view = value; syncNow = value.serverTime; syncAt = performance.now(); transportLost = false; render(); },
    disconnected() { transportLost = true; render(); },
    pairing(code) { set('.pairing', code ? `Setup code: ${code}` : 'Open /admin on your campus server to get started.'); },
    destroy() { clearInterval(timer); observer.disconnect(); },
  };
}
