import { button, el, failed, image, toast, wantsRoom } from './core.js';

const POLL_MS = 1500;
const POLL_TRIES = 10;
const ROOM_WAIT_MS = 2500;
const VIEW_KEY = 'webblox.launcher.avatar3d';

const wants3d = () => {
  try {
    return localStorage.getItem(VIEW_KEY) !== '2d';
  } catch {
    return true;
  }
};

const remember = value => {
  try {
    localStorage.setItem(VIEW_KEY, value);
  } catch {}
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function previewStage({ src, alt, source3d, source2d, redraw, quiet = false, extras = [], room = false }) {
  const node = el('div', 'avatar-frame');
  const picture = image(src, alt);
  const holder = el('div', 'avatar-canvas');
  holder.tabIndex = 0;
  holder.setAttribute('aria-label', `${alt} in 3D. Drag to rotate, scroll to zoom, right-drag or use the arrow keys to move it.`);
  const modes = el('div', 'avatar-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Preview type');
  const flat = button('avatar-mode', '2D');
  const round = button('avatar-mode', '3D');
  modes.append(flat, round);
  node.append(picture, holder, modes, ...extras);
  let current3d = source3d;
  let current2d = source2d;
  let is3d = false;
  let model = null;
  let shownUrl = null;
  let token = 0;
  const paint = () => {
    flat.setAttribute('aria-pressed', String(!is3d));
    round.setAttribute('aria-pressed', String(is3d));
    holder.hidden = !is3d;
    modes.hidden = !current3d;
  };
  const clearModel = () => {
    model?.dispose();
    model = null;
    shownUrl = null;
    node.classList.remove('is-3d');
  };
  const load3d = async (mine, previous, tries) => {
    const viewer = await import('./avatar3d.js');
    for (let attempt = 0; attempt < tries && mine === token && node.isConnected; attempt++) {
      const latest = await current3d(previous, viewer);
      if (latest) {
        if (mine !== token || !node.isConnected) return false;
        const next = await viewer.mountAvatar3d(holder, latest.data, { room });
        if (mine !== token || !node.isConnected) {
          next.dispose();
          return false;
        }
        next.start();
        await new Promise(requestAnimationFrame);
        if (mine !== token || !node.isConnected) {
          next.dispose();
          return false;
        }
        holder.append(next.canvas);
        model?.dispose();
        model = next;
        shownUrl = latest.url;
        node.classList.add('is-3d');
        return true;
      }
      await pause(POLL_MS);
    }
    return false;
  };
  const load2d = async (mine, tries) => {
    for (let attempt = 0; attempt < tries && mine === token && node.isConnected; attempt++) {
      const fresh = await current2d?.().catch(() => null);
      if (fresh && picture.src !== fresh) {
        if (mine === token) picture.src = fresh;
        return true;
      }
      await pause(POLL_MS);
    }
    return false;
  };
  const stop3d = () => {
    is3d = false;
    clearModel();
    paint();
  };
  const show3d = async () => {
    const mine = ++token;
    is3d = true;
    paint();
    node.classList.toggle('awaiting-3d', room && wantsRoom());
    const stopWaiting = setTimeout(() => node.classList.remove('awaiting-3d'), ROOM_WAIT_MS);
    try {
      let done = await load3d(mine, null, POLL_TRIES);
      if (!done && mine === token && redraw && node.isConnected) {
        await redraw().catch(() => {});
        done = await load3d(mine, null, POLL_TRIES);
      }
      if (mine !== token || done || !node.isConnected) return;
      stop3d();
      if (!quiet) toast("Roblox hasn't finished the 3D view yet. Try again in a moment.", true);
    } catch (err) {
      if (mine !== token || !node.isConnected) return;
      stop3d();
      if (quiet) console.warn('[launcher] 3D preview failed:', err.message);
      else failed("The 3D view didn't load.", err);
    } finally {
      clearTimeout(stopWaiting);
      if (mine === token) node.classList.remove('awaiting-3d');
    }
  };
  const show2d = () => {
    const mine = ++token;
    node.classList.remove('awaiting-3d');
    stop3d();
    load2d(mine, 1);
  };
  flat.addEventListener('click', () => {
    if (!is3d) return;
    remember('2d');
    show2d();
  });
  round.addEventListener('click', () => {
    if (is3d) return;
    remember('3d');
    show3d();
  });
  paint();
  return {
    node,
    start: () => {
      if (current3d && wants3d()) show3d();
    },
    refresh: async () => {
      const mine = ++token;
      const attempt = () => (is3d ? load3d(mine, shownUrl, POLL_TRIES) : load2d(mine, POLL_TRIES));
      try {
        let done = await attempt();
        if (!done && mine === token && redraw && node.isConnected) {
          await redraw().catch(() => {});
          done = await attempt();
        }
        if (mine === token && node.isConnected && !done) toast('Saved. Roblox is still rendering the new preview.');
      } catch (err) {
        if (mine === token && node.isConnected) failed("The preview didn't update.", err);
      }
    },
    swap: async (next3d, next2d) => {
      current3d = next3d;
      current2d = next2d;
      paint();
      const mine = ++token;
      try {
        const done = await (is3d ? load3d(mine, null, POLL_TRIES * 2) : load2d(mine, POLL_TRIES * 2));
        return done;
      } catch (err) {
        console.warn('[launcher] preview swap failed:', err.message);
        return false;
      }
    },
  };
}
