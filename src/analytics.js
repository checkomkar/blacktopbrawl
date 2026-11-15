// Google Analytics 4, loaded only when (a) a Measurement ID is configured, (b) the page is not running on a
// local dev host, and (c) the visitor has said yes. Until then nothing is requested from Google and no cookie
// is set. The Measurement ID is public (it is visible in any page that uses it), so it lives here;
// VITE_GA_ID in a `.env` file overrides it, and VITE_GA_ID=off switches analytics off.
const GA_ID = (import.meta.env.VITE_GA_ID || 'G-3R9NN8T82Y').replace(/^off$/i, '');
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname);
const enabled = !!GA_ID && (!LOCAL || new URLSearchParams(location.search).has('ga'));
const KEY = 'bb.consent';

let loaded = false;
function load() {
  if (loaded || !enabled) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }

/** Show the yes/no prompt if the visitor has not answered yet; start GA if they already said yes. */
export function initAnalytics() {
  const box = document.getElementById('consent');
  if (!enabled || !box) return;
  const answer = stored();
  if (answer === 'yes') { load(); return; }
  if (answer === 'no') return;
  box.classList.add('show');
  const done = (yes) => {
    try { localStorage.setItem(KEY, yes ? 'yes' : 'no'); } catch { /* ask again next visit */ }
    box.classList.remove('show');
    if (yes) load();
  };
  box.querySelector('[data-yes]').addEventListener('click', () => done(true));
  box.querySelector('[data-no]').addEventListener('click', () => done(false));
}

/** Record a gameplay event. Does nothing unless analytics is running. */
export function track(name, params = {}) {
  if (loaded) window.gtag('event', name, params);
}
