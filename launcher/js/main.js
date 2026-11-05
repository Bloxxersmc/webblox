const params = new URLSearchParams(location.search);
const wisp = !window.WEBLOX_SERVER || params.get('mode') === 'wisp';
window.WEBLOX_MODE = wisp ? 'wisp' : 'node';

const WORKER_WAIT_MS = 4000;
const RELOAD_FLAG = 'launcher-worker-reloaded';

const loadScript = src => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = src;
  script.onload = resolve;
  script.onerror = () => reject(new Error(`${src} did not load`));
  document.head.append(script);
});

async function useWorker(mode) {
  const worker = navigator.serviceWorker;
  const controlled = () => worker.controller?.scriptURL.includes(`mode=${mode}`);
  await worker.register(`/sw.js?mode=${mode}`, { scope: '/' });
  if (controlled()) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), WORKER_WAIT_MS);
    worker.addEventListener('controllerchange', function check() {
      if (!controlled()) return;
      worker.removeEventListener('controllerchange', check);
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function reloadOnce() {
  if (sessionStorage.getItem(RELOAD_FLAG)) throw new Error('the service worker did not take control of this page');
  sessionStorage.setItem(RELOAD_FLAG, '1');
  location.reload();
  await new Promise(() => {});
}

async function leaveWisp() {
  if (await useWorker('node')) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  await registration?.unregister();
  await reloadOnce();
}

async function startWisp() {
  // The single-file launcher has no service worker: it calls the relay directly (see webbloxUpstream).
  if (!window.WEBBLOX_EMBED) {
    if (!('serviceWorker' in navigator)) throw new Error('Wisp mode needs a service worker, which this browser only allows on https or localhost');
    if (!await useWorker('wisp')) await reloadOnce();
  }
  await loadScript((self.__WB||'/')+'cobalt/wisps.js');
  if (typeof window.cb_fetch !== 'function') await loadScript((self.__WB||'/')+'cobalt/cobalt.js');
  const relay = params.get('wisp');
  if (relay && /^wss?:\/\//i.test(relay)) window.COBALT_WISP_URLS = [relay];
  if (window.CobaltIframe) window.CobaltIframe.wispUrl = window.COBALT_WISP_URLS?.[0];
  await loadScript((self.__WB||'/')+'js/upstream.js');
  await window.webbloxSessionReady;
}

try {
  if (wisp) await startWisp();
  else if (navigator.serviceWorker?.controller && !navigator.serviceWorker.controller.scriptURL.includes('mode=node')) await leaveWisp();
  sessionStorage.removeItem(RELOAD_FLAG);
  await import('./app.js');
} catch (err) {
  const { loadFailure } = await import('./core.js');
  loadFailure(document.getElementById('content'), err, () => location.reload());
}
