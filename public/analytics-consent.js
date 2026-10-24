/* Optional analytics and masked replay. No Umami request before an explicit choice. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || window.siteAnalyticsConsent) return;
  const id = script.dataset.websiteId;
  const hosts = (script.dataset.hosts || '').split(',');
  const onlyPath = script.dataset.onlyPath;
  const privacy = script.dataset.privacy || '/datenschutz';
  const key = 'analytics-consent-v1';
  const endpoint = 'https://umami.pdcd.net';
  const eligible = () => hosts.includes(location.hostname) &&
    (!onlyPath || location.pathname.replace(/\/$/, '') === onlyPath) &&
    (!location.search || (script.dataset.articleIds === 'true' && /^\?article_id=\d+$/.test(location.search))) && !location.hash &&
    !/^\/(wp-admin|wp-login\.php|redaxo|app|portal|login|api)(\/|$)/.test(location.pathname);
  if (!id || !eligible()) return;
  const en = document.documentElement.lang.startsWith('en');
  const words = en ? {
    title: 'Help improve this website?', text: 'With your permission, we measure visits and record a masked sample of clicks and scrolling. Forms are excluded. You can use the site without allowing this.',
    allow: 'Allow analytics and replay', reject: 'Reject', settings: 'Analytics settings', policy: 'Privacy policy', close: 'Close',
  } : {
    title: 'Diese Website verbessern?', text: 'Mit Ihrer Erlaubnis messen wir Besuche und zeichnen stichprobenartig maskierte Klicks und Scrollbewegungen auf. Formulare bleiben ausgeschlossen. Die Website funktioniert auch ohne Ihre Zustimmung.',
    allow: 'Analyse und Aufzeichnung erlauben', reject: 'Ablehnen', settings: 'Analyse-Einstellungen', policy: 'Datenschutz', close: 'Schließen',
  };
  let memoryChoice = null;
  const read = () => {
    try {
      const choice = JSON.parse(localStorage.getItem(key) || 'null');
      return choice && Date.now() - choice.at < 180 * 86400000 ? choice.value : memoryChoice;
    } catch { return memoryChoice; }
  };
  const optedIn = () => eligible() && read() === 'allow' &&
    navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl;
  // The upstream recorder has no public stop API. Gate its transport immediately
  // on withdrawal, then reload to remove rrweb observers and in-memory buffers.
  const originalFetch = window.fetch.bind(window);
  const isUmami = value => {
    try { return new URL(typeof value === 'string' || value instanceof URL ? value : value.url, location.href).origin === endpoint; }
    catch { return false; }
  };
  window.fetch = (url, options) => isUmami(url) && !optedIn()
    ? Promise.resolve(new Response('{}', { status: 403 })) : originalFetch(url, options);
  const originalBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => isUmami(url) && !optedIn() ? false : originalBeacon(url, data);
  window.siteAnalyticsSanitize = (_type, payload) => {
    if (!optedIn() || !payload) return null;
    // No query strings, fragments, custom event data, identifiers or page titles.
    return { website: id, hostname: location.hostname, url: script.dataset.articleIds === 'true' && location.search ? `/artikel/${new URLSearchParams(location.search).get('article_id')}` : location.pathname,
      referrer: '', title: '', language: payload.language, screen: payload.screen };
  };
  let loaded = false;
  function load() {
    if (loaded || !optedIn()) return;
    loaded = true;
    const tracker = document.createElement('script');
    tracker.src = `${endpoint}/script.js`;
    tracker.dataset.websiteId = id;
    tracker.dataset.doNotTrack = 'true';
    tracker.dataset.beforeSend = 'siteAnalyticsSanitize';
    tracker.onload = () => {
      if (!optedIn()) return;
      const recorder = document.createElement('script');
      recorder.src = `${endpoint}/recorder.js`;
      recorder.dataset.websiteId = id;
      document.head.append(recorder);
    };
    document.head.append(tracker);
  }
  const root = document.createElement('div');
  root.className = 'rr-block';
  root.id = 'site-analytics-consent';
  const style = document.createElement('style');
  style.textContent = '#site-analytics-consent{position:relative;z-index:2147483647;font:14px/1.5 system-ui,sans-serif;color:#17212c}#site-analytics-consent *{box-sizing:border-box}#site-analytics-consent button,#site-analytics-consent a{font:inherit;text-decoration:underline;color:inherit;cursor:pointer}#site-analytics-consent button{min-height:44px;padding:8px 12px;border:1px solid #536170;border-radius:5px;background:#fff}#site-analytics-consent [data-settings]{position:fixed;bottom:8px;left:8px;font-size:12px;background:#fff}#site-analytics-consent section{position:fixed;left:12px;right:12px;bottom:62px;margin:auto;max-width:650px;max-height:75vh;overflow:auto;padding:20px;background:#fff;border:1px solid #536170;border-radius:8px;box-shadow:0 6px 30px #0003}#site-analytics-consent h2{font:bold 18px/1.4 system-ui;margin:0 0 8px}#site-analytics-consent p{margin:0 0 12px}#site-analytics-consent nav{display:flex;gap:10px;flex-wrap:wrap;align-items:center}#site-analytics-consent [hidden]{display:none!important}';
  root.append(style);
  const settings = document.createElement('button');
  settings.type = 'button'; settings.dataset.settings = ''; settings.textContent = words.settings;
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', words.settings);
  const heading = document.createElement('h2'); heading.textContent = words.title;
  const text = document.createElement('p'); text.textContent = words.text;
  const nav = document.createElement('nav'); nav.setAttribute('aria-label', words.settings);
  const reject = document.createElement('button'); reject.type = 'button'; reject.textContent = words.reject;
  const allow = document.createElement('button'); allow.type = 'button'; allow.textContent = words.allow;
  const link = document.createElement('a'); link.href = privacy; link.textContent = words.policy;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = words.close;
  nav.append(reject, allow, link, close); panel.append(heading, text, nav); root.append(settings, panel);
  panel.hidden = read() !== null;
  function choose(value) {
    const wasLoaded = loaded;
    memoryChoice = value;
    try { localStorage.setItem(key, JSON.stringify({ value, at: Date.now() })); } catch { /* Fail closed across pages. */ }
    panel.hidden = true; settings.focus();
    if (wasLoaded) location.reload(); else load();
  }
  reject.onclick = () => choose('reject'); allow.onclick = () => choose('allow');
  settings.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) reject.focus(); };
  close.onclick = () => { panel.hidden = true; settings.focus(); };
  panel.onkeydown = event => { if (event.key === 'Escape') close.click(); };
  window.addEventListener('storage', event => { if (event.key === key && loaded) location.reload(); });
  window.siteAnalyticsConsent = { open: () => settings.click(), destroy: () => {
    root.remove(); delete window.siteAnalyticsConsent;
    if (loaded) location.reload();
    else { window.fetch = originalFetch; navigator.sendBeacon = originalBeacon; }
  } };
  document.body.append(root);
  load();
})();
