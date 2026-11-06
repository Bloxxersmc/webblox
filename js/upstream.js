(() => {
  const JAR_KEY = 'cobalt-cookies';
  const SESSION_DOMAINS = ['roblox.com', 'rbxcdn.com', 'robloxlabs.com'];
  const SESSION_CHECK_URL = 'https://users.roblox.com/v1/users/authenticated';
  const ROBLOX_HOST = /(^|\.)(roblox\.com|rbxcdn\.com|robloxlabs\.com)$/;
  const SKIP_RESPONSE_HEADERS = new Set([
    'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie',
    'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers',
    'access-control-allow-methods', 'access-control-expose-headers', 'cross-origin-opener-policy',
    'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'strict-transport-security',
  ]);

  function hasSession() {
    try { return JSON.parse(localStorage.getItem(JAR_KEY) || '[]').some(c => c.n === '.ROBLOSECURITY'); } catch { return false; }
  }

  function storeSession(value) {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(JAR_KEY) || '[]'); } catch {}
    all = all.filter(c => c.n !== '.ROBLOSECURITY');
    for (const d of SESSION_DOMAINS) {
      all.push({ n: '.ROBLOSECURITY', v: value, d, h: false, p: '/', s: true, o: true, e: 0, ss: 'none' });
    }
    localStorage.setItem(JAR_KEY, JSON.stringify(all));
  }

  const ROBLOSECURITY_PREFIX = '_|WARNING:-DO-NOT-SHARE-THIS.';
  const MARK = '<svg viewBox="157 157 710 710" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M307.201 157.281L157.281 716.799L716.799 866.719L866.719 307.201L307.201 157.281ZM569.242 611.157L412.893 569.242L454.807 412.893L611.219 454.807L569.242 611.157Z"/></svg>';

  function forgetSession() {
    try {
      const kept = JSON.parse(localStorage.getItem(JAR_KEY) || '[]').filter(c => c.n !== '.ROBLOSECURITY');
      localStorage.setItem(JAR_KEY, JSON.stringify(kept));
    } catch {}
  }

  async function sessionAccepted() {
    try {
      const r = await cb_fetch(SESSION_CHECK_URL, {
        method: 'GET',
        headers: { origin: 'https://www.roblox.com', referer: 'https://www.roblox.com/' },
        redirect: 'follow',
      });
      return r.status !== 401;
    } catch {
      return true;
    }
  }

  // ---- Native Roblox sign-in (username + password, 2-step verification) over the relay ----
  // The session cookie Roblox sets lands in the relay's cookie jar like any other cookie.
  let rbxCsrf = '';
  async function rbxApi(method, url, json, extra) {
    const send = async () => {
      const headers = { origin: 'https://www.roblox.com', referer: 'https://www.roblox.com/', accept: 'application/json', ...(extra || {}) };
      if (rbxCsrf) headers['x-csrf-token'] = rbxCsrf;
      const init = { method, headers, redirect: 'follow' };
      if (json !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = new TextEncoder().encode(JSON.stringify(json)).buffer;
      }
      const r = await cb_fetch(url, init);
      const text = new TextDecoder().decode(await r.arrayBuffer());
      let data = null;
      try { data = JSON.parse(text); } catch {}
      return { status: r.status, headers: r.headers, data, text };
    };
    let res = await send();
    const token = res.headers && res.headers.get && res.headers.get('x-csrf-token');
    if (res.status === 403 && token && token !== rbxCsrf) { rbxCsrf = token; res = await send(); }
    return res;
  }

  const apiMessage = res => (res.data && res.data.errors && res.data.errors[0] && res.data.errors[0].message) || ('Roblox replied with HTTP ' + res.status + '.');
  const b64json = text => { try { return JSON.parse(atob(text)); } catch { return null; } };

  const loginRequest = (user, password, challenge) => rbxApi('POST', 'https://auth.roblox.com/v2/login',
    { ctype: user.includes('@') ? 'Email' : 'Username', cvalue: user, password },
    challenge ? { 'rblx-challenge-id': challenge.id, 'rblx-challenge-type': challenge.type, 'rblx-challenge-metadata': challenge.metadata } : undefined);

  // Resolves to { ok: true } | { error } | { challenge } (a 2-step verification the person must complete).
  async function signInWithPassword(user, password) {
    const res = await loginRequest(user, password);
    if (res.status === 200) return { ok: true };
    const type = res.headers.get('rblx-challenge-type');
    const id = res.headers.get('rblx-challenge-id');
    if (id && type) {
      if (type === 'captcha') {
        const cm = b64json(res.headers.get('rblx-challenge-metadata') || '');
        if (!cm || !cm.unifiedCaptchaId || !cm.dataExchangeBlob) return { error: 'Roblox asked for a captcha but the details were unreadable. Use "Sign in with a code" above, or the cookie option below.', captcha: true };
        return { captcha: { outerId: id, unifiedCaptchaId: cm.unifiedCaptchaId, dataExchangeBlob: cm.dataExchangeBlob, actionType: cm.actionType || 'Login' } };
      }
      if (type !== 'twostepverification') return { error: 'Roblox asked for a "' + type + '" check, which can\u2019t be shown here. Use "Sign in with a code" above, or the cookie option below.', captcha: true };
      const meta = b64json(res.headers.get('rblx-challenge-metadata') || '');
      if (!meta || !meta.userId || !meta.challengeId) return { error: 'Roblox asked for 2-step verification but the details were unreadable. Use the cookie option below.' };
      return { challenge: { outerId: id, userId: meta.userId, challengeId: meta.challengeId, actionType: meta.actionType || 'Login' } };
    }
    return { error: apiMessage(res), status: res.status };
  }


  // ---- Roblox captcha (Arkose Labs FunCaptcha) ----
  const ARKOSE_LOGIN_KEY = '476068BF-9607-4799-B53D-966BE98E2B81';
  async function arkoseKey() {
    try {
      const r = await Promise.race([rbxApi('GET', 'https://apis.roblox.com/captcha/v1/metadata'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
      const k = r.data && r.data.funCaptchaPublicKeys;
      if (k) return k.ACTION_TYPE_WEB_LOGIN || k.ACTION_TYPE_LOGIN || ARKOSE_LOGIN_KEY;
    } catch {}
    return ARKOSE_LOGIN_KEY;
  }
  // Shows the Arkose puzzle and resolves to { token } | { error }.
  function runArkose(publicKey, blob, stage) {
    return new Promise(resolve => {
      let settled = false, ready = false;
      const finish = v => { if (!settled) { settled = true; clearTimeout(guard); console.log('[captcha] result', v.error || 'token received'); resolve(v); } };
      const guard = setTimeout(() => finish({ error: ready ? 'Captcha timed out.' : 'The captcha never started (stuck at: ' + lastStage + '). The browser is most likely blocking Arkose because this page is cross-origin isolated, or Arkose rejected this domain. Use "Sign in with a code" or the cookie option instead.' }), 25000);
      let lastStage = 'loading script';
      const mark = t => { lastStage = t; console.log('[captcha]', t); if (stage) stage(t); };
      mark('loading script');
      const cb = 'webbloxArkose' + Date.now();
      window[cb] = enforcement => {
        mark('script loaded');
        enforcement.setConfig({
          mode: 'lightbox',
          data: { blob },
          onReady: () => { ready = true; mark('showing puzzle'); enforcement.run(); },
          onShown: () => mark('puzzle shown'),
          onCompleted: r => finish({ token: r.token }),
          onError: r => finish({ error: 'The captcha failed to load' + (r && r.error && r.error.error ? ' (' + r.error.error + ')' : '') + '. Roblox may only allow its captcha on roblox.com. Use "Sign in with a code" or the cookie option instead.' }),
          onFailed: () => finish({ error: 'Captcha answer was wrong. Try again.' }),
          onSuppress: () => finish({ error: 'Captcha was suppressed. Try again.' }),
          onHide: () => setTimeout(() => finish({ error: 'Captcha was closed.' }), 500),
        });
      };
      const sc = document.createElement('script');
      sc.src = 'https://roblox-api.arkoselabs.com/v2/' + publicKey + '/api.js';
      sc.async = true;
      sc.onload = () => mark('script file loaded, starting');
      sc.setAttribute('data-callback', cb);
      sc.onerror = () => finish({ error: 'Couldn\u2019t load the captcha from Roblox\u2019s provider. Use "Sign in with a code" or the cookie option instead.' });
      document.head.appendChild(sc);
    });
  }
  // Solves the captcha, tells Roblox, then retries the login. Resolves to { ok } | { error } | { challenge }.
  async function solveCaptchaAndLogin(user, password, c, stage) {
    if (stage) stage('getting captcha key');
    const key = await arkoseKey();
    const solved = await runArkose(key, c.dataExchangeBlob, stage);
    if (solved.error) return { error: solved.error };
    if (stage) stage('sending answer to Roblox');
    const meta = { unifiedCaptchaId: c.unifiedCaptchaId, captchaToken: solved.token, actionType: c.actionType };
    const cont = await rbxApi('POST', 'https://apis.roblox.com/challenge/v1/continue', { challengeId: c.outerId, challengeType: 'captcha', challengeMetadata: JSON.stringify(meta) });
    if (cont.status !== 200) return { error: apiMessage(cont) };
    const res = await loginRequest(user, password, { id: c.outerId, type: 'captcha', metadata: btoa(JSON.stringify(meta)) });
    if (res.status === 200) return { ok: true };
    const type = res.headers.get('rblx-challenge-type'), id = res.headers.get('rblx-challenge-id');
    if (id && type === 'twostepverification') {
      const m = b64json(res.headers.get('rblx-challenge-metadata') || '');
      if (m && m.userId && m.challengeId) return { challenge: { outerId: id, userId: m.userId, challengeId: m.challengeId, actionType: m.actionType || 'Login' } };
    }
    if (id && type === 'captcha') return { error: 'Roblox asked for another captcha. Press Sign in to try again.' };
    return { error: apiMessage(res) };
  }

  const METHOD_PATH = { email: 'email', authenticator: 'authenticator', sms: 'sms', recoverycode: 'recovery-codes', recoverycodes: 'recovery-codes' };
  async function twoStepMethods(c) {
    const res = await rbxApi('GET', 'https://twostepverification.roblox.com/v1/users/' + c.userId + '/configuration?challengeId=' + encodeURIComponent(c.challengeId) + '&actionType=' + c.actionType);
    const list = res.data && Array.isArray(res.data.methods) ? res.data.methods.map(m => String(m.mediaType || '').toLowerCase()).filter(m => METHOD_PATH[m]) : [];
    return list.length ? list : ['authenticator', 'email'];
  }
  const sendTwoStepCode = (c, method) => rbxApi('POST', 'https://twostepverification.roblox.com/v1/users/' + c.userId + '/challenges/' + METHOD_PATH[method] + '/send-code', { challengeId: c.challengeId, actionType: c.actionType });

  async function finishTwoStep(user, password, c, method, code) {
    const verify = await rbxApi('POST', 'https://twostepverification.roblox.com/v1/users/' + c.userId + '/challenges/' + METHOD_PATH[method] + '/verify', { challengeId: c.challengeId, actionType: c.actionType, code });
    if (verify.status !== 200 || !verify.data || !verify.data.verificationToken) return { error: apiMessage(verify) };
    const meta = { rememberDevice: false, actionType: c.actionType, verificationToken: verify.data.verificationToken, challengeId: c.challengeId };
    const cont = await rbxApi('POST', 'https://apis.roblox.com/challenge/v1/continue', { challengeId: c.outerId, challengeType: 'twostepverification', challengeMetadata: JSON.stringify(meta) });
    if (cont.status !== 200) return { error: apiMessage(cont) };
    const res = await loginRequest(user, password, { id: c.outerId, type: 'twostepverification', metadata: btoa(JSON.stringify(meta)) });
    return res.status === 200 ? { ok: true } : { error: apiMessage(res) };
  }

  // Quick Sign-in: Roblox shows a code, the person approves it on a device that is already signed in.
  // No password and no captcha, which is why it works where the password form gets a captcha every time.
  const QUICK_BASE = 'https://apis.roblox.com/auth-token-service/v1/login/';
  const QUICK_STATUS_TEXT = {
    Created: 'Waiting for you to enter the code on your other device\u2026',
    UserLinked: 'Code entered. Confirm the sign-in on the other device.',
    Validated: 'Approved. Signing in\u2026',
  };
  async function quickSignIn(ctl) {
    const created = await rbxApi('POST', QUICK_BASE + 'create', {});
    if (created.status !== 200 || !created.data || !created.data.code || !created.data.privateKey) return { error: apiMessage(created) };
    const { code, privateKey } = created.data;
    ctl.onCode(code);
    const deadline = Date.now() + 5 * 60 * 1000;
    while (!ctl.cancelled && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      if (ctl.cancelled) break;
      const st = await rbxApi('POST', QUICK_BASE + 'status', { code, privateKey });
      const status = st.data && st.data.status;
      if (status && QUICK_STATUS_TEXT[status]) ctl.onStatus(QUICK_STATUS_TEXT[status]);
      if (status === 'Validated') {
        const res = await rbxApi('POST', 'https://auth.roblox.com/v2/login', { ctype: 'AuthToken', cvalue: code, password: privateKey });
        return res.status === 200 ? { ok: true } : { error: apiMessage(res) };
      }
      if (status === 'Cancelled') return { error: 'Quick Sign-in was cancelled on the other device. If it said it couldn\u2019t match your location, the other device has to be on the same Wi-Fi as this computer.' };
      if (status === 'CodeInvalid') return { error: 'That code expired. Start Quick Sign-in again.' };
    }
    if (ctl.cancelled) { rbxApi('POST', QUICK_BASE + 'cancel', { code, privateKey }).catch(() => {}); return { cancelled: true }; }
    return { error: 'The code timed out. Start Quick Sign-in again.' };
  }

  const askForSession = expired => new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'session-prompt';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-labelledby', 'session-title');
    root.innerHTML =
      '<header class="session-top">' +
        '<div class="session-logo" role="img" aria-label="WebBlox">' + MARK + '</div>' +
        (window.WEBLOX_SERVER ? '<a class="session-switch" href="/?mode=node">Use local server</a>' : '') +
      '</header>' +
      '<div class="session-body">' +
        '<h1 id="session-title">' + (expired ? 'Your session expired' : 'Sign in') + '</h1>' +
        '<button class="session-submit session-roblox" type="button">Sign in with Roblox</button>' +
        '<p class="session-or"><span>or</span></p>' +
        '<div class="session-quick">' +
          '<button class="session-submit session-quick-start" type="button">Sign in with a code</button>' +
          '<div class="session-quick-panel" hidden>' +
            '<p class="session-note">On a device that\u2019s already signed in to Roblox, open the Quick Log In page (roblox.com/crossdevicelogin/ConfirmCode, or Settings in the Roblox app) and enter this code:</p>' +
            '<p class="session-code-big" aria-live="polite">\u2026</p>' +
            '<p class="session-note session-quick-status"></p>' +
            '<p class="session-error session-quick-error" role="alert"></p>' +
            '<button class="session-link session-quick-cancel" type="button">Cancel</button>' +
          '</div>' +
        '</div>' +
        '<p class="session-or"><span>or use your password</span></p>' +
        '<form class="session-login" novalidate>' +
          '<div class="session-field"><label for="session-user">Username or email</label>' +
            '<input id="session-user" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false"></div>' +
          '<div class="session-field"><label for="session-pass">Password</label>' +
            '<input id="session-pass" name="password" type="password" autocomplete="current-password"></div>' +
          '<p class="session-error session-login-error" role="alert"></p>' +
          '<button class="session-submit" type="submit">Sign in</button>' +
        '</form>' +
        '<form class="session-2sv" novalidate hidden>' +
          '<p class="session-note">Roblox needs to verify it\u2019s you.</p>' +
          '<div class="session-field"><label for="session-method">Verify with</label><select id="session-method"></select></div>' +
          '<button class="session-submit session-secondary session-send" type="button">Send me a code</button>' +
          '<div class="session-field"><label for="session-code">Code</label>' +
            '<input id="session-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" spellcheck="false"></div>' +
          '<p class="session-error session-2sv-error" role="alert"></p>' +
          '<button class="session-submit" type="submit">Verify</button>' +
        '</form>' +
        '<p class="session-or"><span>or use a cookie</span></p>' +
        '<form class="session-cookie" novalidate>' +
          '<div class="session-field"><label for="session-cookie">.ROBLOSECURITY</label>' +
            '<input id="session-cookie" name="cookie" type="password" autocomplete="off" spellcheck="false" aria-describedby="session-error">' +
            '<p class="session-error" id="session-error" role="alert"></p></div>' +
          '<button class="session-submit session-secondary" type="submit">Sign in with cookie</button>' +
        '</form>' +
      '</div>';
    const $ = sel => root.querySelector(sel);
    const loginForm = $('.session-login'), twoForm = $('.session-2sv'), cookieForm = $('.session-cookie');
    const loginError = $('.session-login-error'), twoError = $('.session-2sv-error');
    const user = $('#session-user'), pass = $('#session-pass'), code = $('#session-code'), method = $('#session-method');

    const done = async fail => {
      // Roblox answered "signed in"; make sure the session really is usable before closing the prompt.
      if (!hasSession()) return fail('Roblox accepted the sign-in but the session wasn\u2019t saved. Use the cookie option below.');
      if (!(await sessionAccepted())) { forgetSession(); return fail('Roblox didn\u2019t accept the new session. Use the cookie option below.'); }
      try {
        Object.keys(localStorage).filter(key => /^webblox\.launcher\.(home|shell)/.test(key)).forEach(key => localStorage.removeItem(key));
      } catch {}
      root.remove();
      resolve();
    };

    let pending = null;
    loginForm.onsubmit = async e => {
      e.preventDefault();
      loginError.textContent = '';
      const u = user.value.trim(), pw = pass.value;
      if (!u || !pw) { loginError.textContent = 'Enter your username and password.'; return; }
      const button = loginForm.querySelector('button');
      button.disabled = true;
      button.textContent = 'Signing in\u2026';
      try {
        let result = await signInWithPassword(u, pw);
        if (result.captcha) {
          button.textContent = 'Waiting for captcha\u2026';
          result = await solveCaptchaAndLogin(u, pw, result.captcha, t => { button.textContent = 'Captcha: ' + t + '\u2026'; });
        }
        if (result.ok) return await done(m => { loginError.textContent = m; });
        if (result.challenge) {
          pending = result.challenge;
          const methods = await twoStepMethods(pending);
          method.replaceChildren(...methods.map(m => Object.assign(document.createElement('option'), { value: m, textContent: ({ email: 'Email', authenticator: 'Authenticator app', sms: 'Text message', recoverycode: 'Recovery code', recoverycodes: 'Recovery code' })[m] || m })));
          loginForm.hidden = true;
          twoForm.hidden = false;
          syncSend();
          code.focus();
          return;
        }
        loginError.textContent = result.error;
      } catch (err) {
        loginError.textContent = 'Couldn\u2019t reach Roblox (' + (err && err.message || 'network error') + '). Check the connection or use the cookie option.';
      } finally {
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    };

    const send = $('.session-send');
    const syncSend = () => { send.hidden = !/^(email|sms)$/.test(method.value); };
    method.addEventListener('change', syncSend);
    send.addEventListener('click', async () => {
      twoError.textContent = '';
      send.disabled = true;
      try {
        const res = await sendTwoStepCode(pending, method.value);
        twoError.textContent = res.status === 200 ? 'Code sent. Enter it below.' : apiMessage(res);
      } catch { twoError.textContent = 'Couldn\u2019t reach Roblox.'; }
      send.disabled = false;
    });
    twoForm.onsubmit = async e => {
      e.preventDefault();
      twoError.textContent = '';
      const value = code.value.trim();
      if (!value) { twoError.textContent = 'Enter the code.'; return; }
      const button = twoForm.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const result = await finishTwoStep(user.value.trim(), pass.value, pending, method.value, value);
        if (result.ok) return await done(m => { twoError.textContent = m; });
        twoError.textContent = result.error;
      } catch { twoError.textContent = 'Couldn\u2019t reach Roblox.'; }
      button.disabled = false;
    };

    const quickStart = $('.session-quick-start'), quickPanel = $('.session-quick-panel');
    const quickCode = $('.session-code-big'), quickStatus = $('.session-quick-status'), quickError = $('.session-quick-error');
    let quick = null;
    const quickReset = () => { quickPanel.hidden = true; quickStart.hidden = false; quick = null; };
    quickStart.addEventListener('click', async () => {
      quickError.textContent = '';
      quickStatus.textContent = '';
      quickCode.textContent = '\u2026';
      quickStart.hidden = true;
      quickPanel.hidden = false;
      const ctl = quick = { cancelled: false, onCode: c => { quickCode.textContent = c; }, onStatus: t => { quickStatus.textContent = t; } };
      let result;
      try { result = await quickSignIn(ctl); } catch (err) { result = { error: 'Couldn\u2019t reach Roblox (' + (err && err.message || 'network error') + ').' }; }
      if (result.cancelled) return;
      if (result.ok) return await done(m => { quickReset(); loginError.textContent = m; });
      quickReset();
      loginError.textContent = result.error;
    });
    $('.session-quick-cancel').addEventListener('click', () => { if (quick) quick.cancelled = true; quickReset(); });

    // .ROBLOSECURITY fallback
    const input = cookieForm.querySelector('input');
    const error = cookieForm.querySelector('.session-error');
    const fail = message => {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    const submit = cookieForm.querySelector('button');
    cookieForm.onsubmit = async e => {
      e.preventDefault();
      const v = input.value.trim().replace(/^\.ROBLOSECURITY=/, '');
      if (!v) return fail('Paste your .ROBLOSECURITY value.');
      if (!v.startsWith(ROBLOSECURITY_PREFIX)) return fail("That isn't a .ROBLOSECURITY value.");
      submit.disabled = true;
      storeSession(v);
      const accepted = await sessionAccepted();
      submit.disabled = false;
      if (!accepted) {
        forgetSession();
        return fail('Roblox rejected that session.');
      }
      try {
        Object.keys(localStorage).filter(key => /^webblox\.launcher\.(home|shell)/.test(key)).forEach(key => localStorage.removeItem(key));
      } catch {}
      root.remove();
      resolve();
    };

    // Roblox's own sign-in screen (the engine launcher, with Roblox's own security checks).
    $('.session-roblox').addEventListener('click', () => {
      if (window.webbloxSignIn) return window.webbloxSignIn();
      const next = new URLSearchParams({ launcher: 'roblox', signin: '1' });
      for (const name of ['mode', 'wisp', 'flagset', 'debug']) if (PAGE_PARAMS.has(name)) next.set(name, PAGE_PARAMS.get(name));
      location.href = '/?' + next;
    });

    const mount = () => {
      document.body.appendChild(root);
      user.focus();
    };
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = (self.__WB||'/')+'launcher/session.css';
    sheet.onload = sheet.onerror = () => document.body ? mount() : addEventListener('DOMContentLoaded', mount);
    document.head.appendChild(sheet);
  });

  // Roblox's own launcher is never held up by the cookie prompt: signed out, it shows Roblox's sign-in
  // screen, and the session Roblox sets lands in the relay's cookie jar like any other cookie.
  const PAGE_PARAMS = new URLSearchParams(location.search);
  const ROBLOX_LAUNCHER = PAGE_PARAMS.get('launcher') === 'roblox';
  const sessionReady = (async () => {
    const saved = hasSession();
    if (saved && await sessionAccepted()) return;
    if (saved) forgetSession();
    if (ROBLOX_LAUNCHER) return watchSignIn();
    await askForSession(saved);
  })();

  // Opened to sign in: once Roblox has set the session, go back to WebBlox's launcher. In the
  // single-file launcher's game frame that hands control back to the file, which reloads signed in.
  function watchSignIn() {
    if (PAGE_PARAMS.get('signin') !== '1') return;
    const timer = setInterval(() => {
      if (!hasSession()) return;
      clearInterval(timer);
      const back = new URLSearchParams();
      for (const name of ['mode', 'wisp', 'flagset', 'debug']) if (PAGE_PARAMS.has(name)) back.set(name, PAGE_PARAMS.get(name));
      setTimeout(() => location.replace((self.__WB||'/')+'launcher/' + (back.size ? '?' + back : '')), 400);
    }, 500);
  }

  window.webbloxSessionReady = sessionReady;

  const spoofNativeUa = headers => {
    const copy = { ...headers };
    if (copy['rbx-user-agent']) {
      copy['rbx-user-agent'] = copy['rbx-user-agent']
        .replace(/Roblox\/Web\s+(?:\w+\s+Desktop|Unknown)/, 'Roblox/WinInet')   // Chromebooks report "Unknown" instead of "<OS> Desktop"
        .replace(/\s*Browser\/\S+/, '');
    }
    return copy;
  };

  const cache = new Map();
  const CACHE_LIMIT = 512 * 1024 * 1024;
  const ENTRY_LIMIT = 64 * 1024 * 1024;
  let cacheBytes = 0;
  const CACHEABLE_HOST = /(^|\.)(rbxcdn\.com|assetdelivery\.roblox\.com|contentdelivery\.roblox\.com|thumbnails\.roblox\.com|assetgame\.roblox\.com|clientsettingscdn\.roblox\.com|clientsettings\.roblox\.com|users\.roblox\.com)$/i;

  async function cacheKey(method, url, body) {
    const u = new URL(url);
    if (!CACHEABLE_HOST.test(u.hostname)) return null;
    if (method === 'GET' && ASSET_HOST.test(u.hostname)) return null;
    if (method === 'GET' || method === 'HEAD') return `G ${url}`;
    if (method === 'POST' && (/\/v1\/assets\/batch$/.test(u.pathname) || /\/v1\/users$/.test(u.pathname))) {
      const digest = await crypto.subtle.digest('SHA-1', body || new ArrayBuffer(0));
      return `P ${url} ${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
    }
    return null;
  }

  function cacheTtl(method, headers) {
    const cc = headers.get('cache-control') || '';
    const m = cc.match(/max-age=(\d+)/i);
    if (m) return Math.min(Number(m[1]), 30 * 24 * 3600) * 1000;
    if (/no-store/i.test(cc)) return 0;
    if (method === 'POST') return 10 * 60 * 1000;
    if (/no-cache/i.test(cc)) return 60 * 1000;
    return 60 * 60 * 1000;
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) { cache.delete(key); cacheBytes -= hit.body.byteLength; return null; }
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function cacheSet(key, entry, ttl) {
    if (!ttl || entry.status !== 200 || entry.body.byteLength > ENTRY_LIMIT) return;
    if (cache.has(key)) { cacheBytes -= cache.get(key).body.byteLength; cache.delete(key); }
    cache.set(key, { ...entry, expires: Date.now() + ttl });
    cacheBytes += entry.body.byteLength;
    while (cacheBytes > CACHE_LIMIT && cache.size > 1) {
      const [k, v] = cache.entries().next().value;
      cache.delete(k);
      cacheBytes -= v.body.byteLength;
    }
  }

  const ASSET_CACHE = 'webblox-assets-2';
  const ASSET_HOST = /(^|\.)rbxcdn\.com$/i;
  const ASSET_MAX_AGE = 7 * 24 * 3600 * 1000;
  const ASSET_ENTRIES = 5000;
  const PREFETCH_CONCURRENCY = 16;
  let assetCache = null;
  let assetWrites = 0;
  const openAssets = () => (assetCache ??= caches.open(ASSET_CACHE));
  const isAsset = (method, target, headers) => method === 'GET' && ASSET_HOST.test(target.hostname) && !headers.range;
  const assetKey = href => {
    const m = new URL(href).pathname.match(/\/([0-9a-f]{32})$/i);
    return m ? `https://rbxcdn.webblox/${m[1].toLowerCase()}` : href;
  };

  function responseHeaders(headers) {
    const out = [];
    for (const [k, v] of headers) if (!SKIP_RESPONSE_HEADERS.has(k)) out.push([k, v]);
    return out;
  }

  async function storeAsset(href, r, resHeaders) {
    const key = assetKey(href);
    const ttl = key !== href ? ASSET_MAX_AGE : Math.min(cacheTtl('GET', r.headers), ASSET_MAX_AGE);
    if (r.status !== 200 || !ttl || r.body.byteLength > ENTRY_LIMIT) return;
    const body = r.body.slice(0);
    try {
      const cache = await openAssets();
      await cache.put(key, new Response(body, { status: 200, headers: [...resHeaders, ['x-webblox-expires', String(Date.now() + ttl)]] }));
      if (++assetWrites % 250 === 0) {
        const keys = await cache.keys();
        for (const req of keys.slice(0, Math.max(0, keys.length - ASSET_ENTRIES))) cache.delete(req);
      }
    } catch {}
  }

  async function cachedAsset(key) {
    try {
      const hit = await (await openAssets()).match(key);
      if (!hit || !(Number(hit.headers.get('x-webblox-expires')) > Date.now())) return null;
      return { status: hit.status, statusText: hit.statusText, headers: [...hit.headers], body: await hit.arrayBuffer() };
    } catch {
      return null;
    }
  }

  const prefetchQueue = [];
  const prefetchJobs = new Map();
  let prefetchActive = 0;

  function prefetchLocations(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const urls = [];
      if (typeof item.location === 'string') urls.push(item.location);
      if (Array.isArray(item.locations)) {
        for (const loc of item.locations) if (loc && typeof loc.location === 'string') urls.push(loc.location);
      }
      for (const href of urls) {
        let host;
        try { host = new URL(href).hostname; } catch { continue; }
        const key = assetKey(href);
        if (!ASSET_HOST.test(host) || prefetchJobs.has(key)) continue;
        const job = { href, key, started: false };
        job.promise = new Promise(resolve => { job.resolve = resolve; });
        prefetchJobs.set(key, job);
        prefetchQueue.push(job);
      }
    }
    pumpPrefetch();
  }

  async function prefetchJob(job) {
    try {
      const hit = await cachedAsset(job.key);
      if (hit) return hit;
      // Through the service worker, which fetches the CDN directly and caches the file, or asks
      // this page to relay it (with fallback set, so it does not wait on this job).
      const r = await fetch(job.href, { mode: 'cors', credentials: 'omit' });
      return { status: r.status, statusText: r.statusText, headers: [...r.headers], body: await r.arrayBuffer() };
    } catch {
      return null;
    }
  }

  function runPrefetch(job) {
    job.started = true;
    prefetchActive++;
    prefetchJob(job).then(job.resolve).finally(() => {
      prefetchActive--;
      prefetchJobs.delete(job.key);
      pumpPrefetch();
    });
  }

  function pumpPrefetch() {
    while (prefetchActive < PREFETCH_CONCURRENCY && prefetchQueue.length) {
      const job = prefetchQueue.shift();
      if (!job.started) runPrefetch(job);
    }
  }

  async function localAsset(href) {
    const key = assetKey(href);
    const job = prefetchJobs.get(key);
    if (!job) return cachedAsset(key);
    if (!job.started) runPrefetch(job);
    const r = await job.promise;
    return r && { status: r.status, statusText: r.statusText, headers: r.headers, body: r.body.slice(0) };
  }

  function qdmuxFqdn(joinScript) {
    const udmux = joinScript.UdmuxEndpoints && joinScript.UdmuxEndpoints[0];
    const nst = String(joinScript.NetStackTokenValue || '');
    if (!udmux || !nst || !joinScript.MachineAddress || !joinScript.NetStackPort) return null;
    let token = nst.toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(token)) {
      try { token = [...atob(nst)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); } catch { return null; }
    }
    if (token.length !== 32) return null;
    const octets = udmux.Address.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => !(n >= 0 && n <= 255))) return null;
    octets[3] += 1;
    const hex = list => list.map(n => n.toString(16).padStart(2, '0')).join('');
    const machine = joinScript.MachineAddress.split('.').map(Number);
    return `${token}-${hex(machine)}-${Number(joinScript.NetStackPort).toString(16)}.${hex(octets)}.qdmux.roblox.com`;
  }

  async function wisp(url, init) {
    const r = await cb_fetch(url, { ...init, redirect: 'follow' });
    return { status: r.status, statusText: r.statusText, headers: r.headers, body: await r.arrayBuffer() };
  }

  function jarNames(host) {
    try {
      return JSON.parse(localStorage.getItem(JAR_KEY) || '[]')
        .filter(c => host === c.d || (!c.h && host.endsWith('.' + c.d)))
        .map(c => c.n + '@' + c.d);
    } catch {
      return [];
    }
  }

  const LAUNCHER_JOIN = /(?:^|;\s*)launcher_join=(\d+):([gp]):([A-Za-z0-9-]+)(?::(\d+))?/;
  const LAUNCHER_JOIN_TTL = 120000;   // same lifetime as the launcher_join cookie

  function launcherJoin(url, body) {
    // The launcher leaves the chosen server in a cookie, or in sessionStorage when it runs from a file
    // and hands the game to a frame on another origin.
    let saved = '';
    try { saved = sessionStorage.getItem('webblox.launcherJoin') || ''; } catch {}
    // sessionStorage has no expiry of its own, so a server picked earlier in this tab would otherwise be
    // applied to every later join of that place (a stale private-server code is rejected as "not authorized").
    const savedAt = /:(\d+)$/.exec(saved);
    if (!savedAt || Date.now() - Number(savedAt[1]) > LAUNCHER_JOIN_TTL) saved = '';
    const match = /\/v1\/join-game$/.test(url) && (LAUNCHER_JOIN.exec(document.cookie) || (saved && LAUNCHER_JOIN.exec('launcher_join=' + saved)));
    if (!match) return { url, body };
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (String(parsed.placeId) !== match[1] || parsed.isTeleport) return { url, body };
      const server = match[2] === 'g' ? { gameId: match[3] } : { accessCode: match[3] };
      return {
        url: url.replace(/\/join-game$/, match[2] === 'g' ? '/join-game-instance' : '/join-private-game'),
        body: new TextEncoder().encode(JSON.stringify({ ...parsed, ...server })).buffer,
      };
    } catch {
      return { url, body };
    }
  }

  // Shows why Roblox refused a join right on the page, for browsers where the console is locked.
  async function reportJoin(status, json, url, body, headers, res) {
    const ok = !!(json && json.joinScript);
    let sent = {};
    try { sent = JSON.parse(new TextDecoder().decode(body)) || {}; } catch {}
    let who = 'unknown';
    try {
      const me = await wisp(SESSION_CHECK_URL, { method: 'GET', headers: spoofNativeUa({ origin: 'https://www.roblox.com', referer: 'https://www.roblox.com/' }) });
      if (me.status === 401) who = 'NOT signed in (no valid session)';
      else { const u = JSON.parse(new TextDecoder().decode(me.body)); who = u.name ? 'signed in as ' + u.name : 'status ' + me.status; }
    } catch { who = 'could not check (network problem reaching Roblox)'; }
    const mode = /join-private-game/.test(url) ? 'private server' : /join-game-instance/.test(url) ? 'specific server' : 'normal join';
    let exitIp = 'unknown';
    try { const ip = await wisp('https://api.ipify.org', { method: 'GET', headers: {} }); exitIp = new TextDecoder().decode(ip.body).trim().slice(0, 64); } catch {}
    const text = (ok ? 'Join OK. Roblox status: ' : 'Join refused. Roblox status: ') + (json && json.status != null ? json.status : r_(status)) +
      ' | message: ' + ((json && json.message) || 'none') + ' | ' + who + ' | join type: ' + mode +
      ' | placeId: ' + sent.placeId + ' | gameId: ' + (sent.gameId || 'none') + ' | teleport: ' + !!sent.isTeleport +
      '\nrelay exit IP: ' + exitIp + ' | page: ' + location.href +
      (ok ? '' : '\nHTTP ' + status + ' | challenge: ' + ((res && res.headers && res.headers.get && (res.headers.get('rblx-challenge-type') || '')) || 'none') +
        ' | reply: ' + (() => { try { return new TextDecoder().decode(res.body).replace(/\s+/g, ' ').slice(0, 300); } catch { return '?'; } })()) +
      '\nbody: ' + JSON.stringify(sent).slice(0, 600) +
      '\ncookie names: ' + jarNames(new URL(url).hostname).join(', ') +
      '\nheaders: ' + Object.keys(headers || {}).filter(k => !/^(cookie|authorization)$/i.test(k)).map(k => k + '=' + String(headers[k]).slice(0, 80)).join(' ; ');
    console.log(ok ? '[gamejoin-ok]' : '[gamejoin-failed]', text);
    try {
      let box = document.getElementById('webblox-join-error');
      if (!box) {
        box = document.createElement('div');
        box.id = 'webblox-join-error';
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;background:' + (ok ? '#030' : '#300') + ';color:#fff;font:13px/1.4 sans-serif;padding:10px 12px;border-radius:6px;white-space:pre-wrap;word-break:break-word;user-select:text;cursor:pointer';
        box.title = 'Tap to copy';
        box.addEventListener('click', () => copyBox(box));
        (document.body || document.documentElement).appendChild(box);
      }
      box.style.background = ok ? '#030' : '#300';
      box.style.display = (ok && !SHOW_DEBUG_BOXES) ? 'none' : '';
      box.textContent = text;
      if (ok) setTimeout(() => box.remove(), 30000);
    } catch {}
  }
  const r_ = status => 'HTTP ' + status;

  // The green (join OK) and orange (failed requests) boxes only show when the link has &debug=1 or &gpudebug=1.
  const SHOW_DEBUG_BOXES = /[?&](gpu)?debug\b/.test(location.search);

  function copyBox(box) {
    const text = box.textContent.replace(/^Copied\. /, '');
    const done = () => { box.textContent = 'Copied. ' + text; };
    try { navigator.clipboard.writeText(text).then(done, done); } catch { done(); }
  }

  // Shows the most recent failing requests on screen (server errors and relay failures), for when the console is unavailable.
  const netFailures = [];
  function noteFailure(code, method, where, detail) {
    try {
      netFailures.push(new Date().toLocaleTimeString() + '  ' + code + '  ' + method + ' ' + where + (detail ? '  ' + String(detail).replace(/\s+/g, ' ').slice(0, 900) : ''));
      if (netFailures.length > 8) netFailures.shift();
      let box = document.getElementById('webblox-net-log');
      if (!box) {
        box = document.createElement('div');
        box.id = 'webblox-net-log';
        box.style.cssText = 'position:fixed;left:8px;top:8px;max-width:calc(100% - 16px);z-index:2147483646;background:rgba(40,25,0,.92);color:#fff;font:11px/1.35 monospace;padding:6px 8px;border-radius:6px;white-space:pre-wrap;word-break:break-all;user-select:text;cursor:pointer';
        box.title = 'Tap to copy';
        box.addEventListener('click', () => copyBox(box));
        (document.body || document.documentElement).appendChild(box);
      }
      box.style.display = SHOW_DEBUG_BOXES ? '' : 'none';
      box.textContent = 'Failed requests (newest last):\n' + netFailures.join('\n');
      clearTimeout(box._t);
      box._t = setTimeout(() => box.remove(), 90000);
    } catch {}
  }

  // Also surface uncaught errors and error-level console output in the same on-screen box.
  window.addEventListener('error', e => { showContext(); noteFailure('JS', 'error', String(e.message || 'error'), (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', e => noteFailure('JS', 'promise', String((e.reason && (e.reason.message || e.reason)) || 'rejected'), ''));
  // Remember the last few ordinary log lines so a crash report shows what the engine was doing just before it.
  const recentLogs = [];
  let contextShown = false;
  for (const level of ['log', 'warn']) {
    const original = console[level];
    console[level] = function (...args) {
      try { recentLogs.push(args.map(x => String(x)).join(' ').replace(/\s+/g, ' ').slice(0, 130)); if (recentLogs.length > 12) recentLogs.shift(); } catch {}
      return original.apply(this, args);
    };
  }
  const showContext = () => { if (!contextShown) { contextShown = true; noteFailure('CTX', 'last logs', recentLogs.slice(-10).join('  ||  '), ''); } };
  const consoleError = console.error;
  console.error = function (...args) {
    try { noteFailure('LOG', 'error', args.map(x => (x && x.message) || String(x)).join(' ').slice(0, 220), ''); } catch {}
    return consoleError.apply(this, args);
  };

  // If the page had to fall back from WebGPU to WebGL, show why.
  try {
    const gpuWhy = (Date.now() - Number(sessionStorage.getItem('webblox.webgpuFailedAt') || 0) < 120000) ? sessionStorage.getItem('webblox.webgpuFailed') : '';
    if (gpuWhy) setTimeout(() => noteFailure('GPU', 'webgpu failed, fell back to webgl', gpuWhy, ''), 0);
    const savedFail = localStorage.getItem('webblox.lastGpuFail');
    if (savedFail) setTimeout(() => noteFailure('GPU', 'last saved webgpu failure', savedFail, ''), 0);
    const mode = new URLSearchParams(location.search).get('renderer') || (gpuWhy ? 'webgl (fallback)' : 'webgl (default)');
    setTimeout(() => noteFailure('BUILD', 'files live', 'index=' + (window.__webbloxIndexBuild || 'OLD') + '  gl-webgpu=' + (window.__webbloxGlBuild || 'OLD') + '  upstream=e', ''), 4000);
    setTimeout(() => noteFailure('GPU', 'renderer in use', mode, 'navigator.gpu=' + (navigator.gpu ? 'yes' : 'no')), 0);
  } catch {}

  async function handleGameJoin(url, method, headers, body) {
    ({ url, body } = launcherJoin(url, body));
    const r = await wisp(url, { method, headers: spoofNativeUa(headers), body });
    let json = null;
    try { json = JSON.parse(new TextDecoder().decode(r.body)); } catch {}
    console.log('[gamejoin]', url, r.status, JSON.stringify({
      status: json && json.status,
      message: json && json.message,
      hasJoinScript: !!(json && json.joinScript),
      cookies: jarNames(new URL(url).hostname),
    }));
    reportJoin(r.status, json, url, body, headers, r);
    if (r.status === 200 && json && json.joinScript && !json.joinScript.gameFqdn) {
      const fqdn = qdmuxFqdn(json.joinScript);
      if (fqdn) {
        json.joinScript.gameFqdn = fqdn;
        r.body = new TextEncoder().encode(JSON.stringify(json)).buffer;
      }
    }
    return r;
  }

  const APP_POLICY_URL = /^https:\/\/apis\.roblox\.com\/guac-v2\/v1\/bundles\/app-policy(?:[?#]|$)/;
  const APP_POLICY_OVERRIDES = { EnableWebViewSupport: true };
  function patchAppPolicy(r) {
    try {
      const policy = JSON.parse(new TextDecoder().decode(r.body));
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return r;
      Object.assign(policy, APP_POLICY_OVERRIDES);
      return { ...r, body: new TextEncoder().encode(JSON.stringify(policy)).buffer };
    } catch {
      return r;
    }
  }

  async function upstream({ url, method, headers, body, fallback }) {
    await sessionReady;
    const target = new URL(url);
    headers = { ...headers };
    delete headers.cookie;
    delete headers['content-length'];
    delete headers.referer;
    delete headers.origin;
    const isRoblox = ROBLOX_HOST.test(target.hostname);
    if (isRoblox) {
      headers.origin = 'https://www.roblox.com';
      headers.referer = 'https://www.roblox.com/';
      Object.assign(headers, spoofNativeUa(headers));
    } else {
      headers.origin = target.origin;
      headers.referer = target.origin + '/';
    }
    if (body && !body.byteLength) body = null;

    const asset = isAsset(method, target, headers);
    if (asset && !fallback) {
      const ready = await localAsset(url);
      if (ready) return ready;
    }

    const key = await cacheKey(method, url, body);
    if (key) {
      const hit = cacheGet(key);
      if (hit) return { status: hit.status, statusText: hit.statusText, headers: hit.headers, body: hit.body.slice(0) };
    }

    let r = (isRoblox && target.hostname === 'gamejoin.roblox.com' && method === 'POST')
      ? await handleGameJoin(url, method, headers, body)
      : await wisp(url, { method, headers, body });
    if (r.status === 200 && APP_POLICY_URL.test(url)) r = patchAppPolicy(r);

    const resHeaders = responseHeaders(r.headers);
    if (asset) storeAsset(url, r, resHeaders);
    if (r.status === 200 && method === 'POST' && /\/v1\/assets\/batch$/.test(target.pathname)) {
      try { prefetchLocations(JSON.parse(new TextDecoder().decode(r.body))); } catch {}
    }
    if (r.status >= 400) console.log(`[proxy] → ${r.status} ${method} ${target.hostname}${target.pathname}`);
    if (r.status >= 400 && r.status < 500 && /^(auth|twostepverification|apis|accountsettings)\.roblox\.com$/.test(target.hostname) && /login|auth|challenge|twostep|verif|ticket|token|captcha/i.test(target.pathname)) {
      const bodyText = (() => { try { return new TextDecoder().decode(r.body); } catch { return ''; } })();
      const isCsrfRetry = r.status === 403 && /Token Validation/i.test(bodyText);
      if (!isCsrfRetry) noteFailure('AUTH ' + r.status, method, target.hostname + target.pathname,
        'challenge=' + ((r.headers && r.headers.get && (r.headers.get('rblx-challenge-type') || '')) || 'none') + ' ' + bodyText);
    }
    if (r.status >= 500 || r.status === 429) noteFailure(r.status, method, target.hostname + target.pathname, (() => { try { return new TextDecoder().decode(r.body); } catch { return ''; } })());

    if (key) {
      let ttl = cacheTtl(method, r.headers);
      if (/\/v1\/(assets\/batch|users)$/.test(target.pathname) &&
          new TextDecoder().decode(r.body).includes('"errors"')) ttl = Math.min(ttl, 60 * 1000);
      cacheSet(key, { status: r.status, statusText: r.statusText, headers: resHeaders, body: r.body.slice(0) }, ttl);
    }
    return { status: r.status, statusText: r.statusText, headers: resHeaders, body: r.body };
  }

  // Used directly by the single-file launcher, which has no service worker of its own.
  window.webbloxUpstream = upstream;
  if (!navigator.serviceWorker || window.WEBBLOX_EMBED) return;

  navigator.serviceWorker.addEventListener('message', async event => {
    const msg = event.data;
    if (!msg || msg.type !== 'webblox-fetch') return;
    const port = event.ports[0];
    try {
      const r = await upstream(msg);
      port.postMessage({ ok: true, ...r }, [r.body]);
    } catch (err) {
      console.error('[proxy]', msg.method, msg.url, '-', err.message || err);
      try { const u = new URL(msg.url); noteFailure('ERR', msg.method, u.hostname + u.pathname, err.message || err); } catch {}
      port.postMessage({ ok: false, error: String(err.message || err) });
    }
  });
  navigator.serviceWorker.startMessages();
  // Tell the worker this window can relay. In a frame (the single-file launcher's game frame) it
  // cannot look for a top-level window to do it.
  const announce = () => navigator.serviceWorker.controller?.postMessage({ type: 'webblox-relay-ready' });
  announce();
  navigator.serviceWorker.addEventListener('controllerchange', announce);
})();
