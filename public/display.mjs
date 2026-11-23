import { createStage } from '/stage.mjs';
const stage = createStage(document.querySelector('#stage'));
const events = new EventSource('/api/events');
events.addEventListener('state', event => stage.update(JSON.parse(event.data)));
events.onerror = () => stage.disconnected();
fetch('/api/pairing').then(response => response.ok ? response.json() : {}).then(result => stage.pairing(result.code)).catch(() => {});
// The installed kiosk must also disable OS sleep. Browser wake lock is supplemental.
let wake;
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
keepAwake();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
