// Injected first into every page the hosted service worker serves.
// The app was written for a site root, so absolute paths (/launcher/, /engine/, /__frame__/) are
// moved into the folder the app is served from. On a shared CDN origin it also keeps the Roblox
// cookie out of localStorage unless the user asks to stay signed in.
(function () {
  var BASE = (window.__WEBBLOX_BASE || '/').replace(/\/$/, '');
  var CDN_PATHS = /^\/(gh|npm|wp|combine|esm)\//;
  function inBase(path) { return !BASE || path === BASE || path.indexOf(BASE + '/') === 0; }
  function fix(value) {
    if (!BASE || value == null) return value;
    try {
      var url = new URL(String(value), location.href);
      if (url.origin !== location.origin || inBase(url.pathname) || CDN_PATHS.test(url.pathname)) return value;
      url.pathname = BASE + url.pathname;
      return url.href;
    } catch (e) { return value; }
  }

  // In the single-file launcher this page is the game frame. Its parent shows the launcher, so a game
  // that ends (or a page that would open the launcher) hands control back to the parent instead.
  var EMBEDDED = window.parent !== window;
  var parentOrigin = '*';
  try { var ancestor = location.ancestorOrigins && location.ancestorOrigins[0]; if (ancestor && /^https?:/.test(ancestor)) parentOrigin = ancestor; } catch (e) {}
  function toParent(message) { try { window.parent.postMessage(message, parentOrigin); } catch (e) {} }
  function leavesGame(href) {
    var url = new URL(href, location.href);
    if (url.origin !== location.origin) return false;
    var path = url.pathname.slice(BASE.length) || '/';
    if (path.indexOf('/launcher/') === 0) return true;
    return (path === '/' || path === '/index.html') && !/[?&](placeId|launcher|flag)=/.test(url.search);
  }
  if (EMBEDDED) {
    window.webbloxEmbedded = true;
    toParent({ type: 'webblox-game-page', isolated: self.crossOriginIsolated, url: location.href });
  }

  if (BASE) {
    if (window.navigation) {
      navigation.addEventListener('navigate', function (event) {
        var target = event.destination && event.destination.url;
        if (!target || !event.cancelable) return;
        if (EMBEDDED && leavesGame(fix(target))) {
          event.preventDefault();
          toParent({ type: 'webblox-leave' });
          return;
        }
        var fixed = fix(target);
        if (fixed === target) return;
        event.preventDefault();
        if (event.navigationType === 'replace') location.replace(fixed); else location.assign(fixed);
      });
    }
    var open = window.open;
    window.open = function (url) { var args = [].slice.call(arguments); args[0] = fix(url); return open.apply(this, args); };
    [['Worker', window.Worker], ['SharedWorker', window.SharedWorker]].forEach(function (pair) {
      var Native = pair[1];
      if (!Native) return;
      var Wrapped = function (url, options) { return new Native(fix(url), options); };
      Wrapped.prototype = Native.prototype;
      window[pair[0]] = Wrapped;
    });
    var frameSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true, enumerable: true,
      get: function () { return frameSrc.get.call(this); },
      set: function (value) { frameSrc.set.call(this, fix(value)); }
    });
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'src') value = fix(value);
      return setAttribute.call(this, name, value);
    };
    if (navigator.serviceWorker) {
      var sw = navigator.serviceWorker;
      // The hosted worker is already in charge of this folder; the app's own /sw.js is not used.
      var hosted = BASE + '/sw.js?mode=wisp';         // the app checks for mode=wisp in the URL
      var register = sw.register.bind(sw), getRegistration = sw.getRegistration.bind(sw);
      sw.register = function () { return register(hosted, { scope: BASE + '/' }); };
      sw.getRegistration = function () { return getRegistration(BASE + '/'); };
    }
  }

  // On the launcher, have the worker prepare the engine files a game starts with, once the launcher
  // itself has loaded, so pressing Play doesn't wait for them.
  if (location.pathname.indexOf(BASE + '/launcher/') === 0 && navigator.serviceWorker && !(navigator.connection && navigator.connection.saveData)) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        var worker = navigator.serviceWorker.controller;
        if (worker) worker.postMessage({ type: 'webblox-warm' });
      }, 2500);
    });
  }

  // jsDelivr serves every GitHub repo and npm package from one origin, so anything in localStorage
  // there can be read by any other page on it. The Roblox cookie jar stays in this tab's
  // sessionStorage unless the user chose to stay signed in.
  if (BASE && (EMBEDDED || /(^|\.)jsdelivr\.net$/.test(location.hostname))) {
    var JAR = 'cobalt-cookies', REMEMBER = 'webblox.rememberSession';
    var remember = function () { if (EMBEDDED) return false; try { return localStorage.getItem(REMEMBER) === '1'; } catch (e) { return false; } };
    var proto = Storage.prototype, get = proto.getItem, set = proto.setItem, remove = proto.removeItem;
    var redirect = function (storage, key) { return storage === window.localStorage && key === JAR && !remember(); };
    proto.getItem = function (key) { return redirect(this, key) ? get.call(sessionStorage, key) : get.call(this, key); };
    proto.setItem = function (key, value) {
      if (redirect(this, key)) {
        remove.call(localStorage, key);
        if (EMBEDDED) toParent({ type: 'webblox-jar', jar: value });   // the parent keeps the session
        return set.call(sessionStorage, key, value);
      }
      return set.call(this, key, value);
    };
    proto.removeItem = function (key) { if (redirect(this, key)) remove.call(sessionStorage, key); return remove.call(this, key); };
    new MutationObserver(function () {
      var form = document.querySelector('form.session-prompt');
      if (EMBEDDED || !form || form.querySelector('.webblox-remember')) return;
      var label = document.createElement('label');
      label.className = 'webblox-remember';
      label.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin:10px 0;font-size:13px;line-height:1.4;opacity:.85';
      label.innerHTML = '<input type="checkbox" style="margin-top:2px"> <span>Keep me signed in on this browser. Other pages on cdn.jsdelivr.net could read the saved cookie, so leave this off on shared or untrusted computers.</span>';
      var box = label.querySelector('input');
      box.checked = remember();
      box.addEventListener('change', function () {
        try {
          if (box.checked) { set.call(localStorage, REMEMBER, '1'); var jar = get.call(sessionStorage, JAR); if (jar) set.call(localStorage, JAR, jar); }
          else { remove.call(localStorage, REMEMBER); remove.call(localStorage, JAR); }
        } catch (e) {}
      });
      var submit = form.querySelector('.session-submit, [type=submit]');
      if (submit) submit.parentNode.insertBefore(label, submit); else form.appendChild(label);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
