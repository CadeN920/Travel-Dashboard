// Wanderlog — a tiny travel tracker. Data lives in localStorage and, when
// signed in, is also synced to Supabase so every device sees the same trip.

const STORAGE_KEY = 'wanderlog-v1';
const DAY = 24 * 60 * 60 * 1000;

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);

// Line icons (no emojis): 24×24, drawn with the current text color.
const ICONS = {
  plane: '<path d="M12 2.5c.8 0 1.4.7 1.4 1.5v5.2l7.1 4.3v2.2l-7.1-2.3v5l2.3 1.8v1.4L12 20.8l-3.7.8v-1.4l2.3-1.8v-5l-7.1 2.3v-2.2l7.1-4.3V4c0-.8.6-1.5 1.4-1.5z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 14h.01M15 14h.01M8.5 21l2-4M15.5 21l-2-4"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2.5"/><path d="M4 11h16M8 14.5h.01M16 14.5h.01M7 18v2.5M17 18v2.5"/>',
  ferry: '<path d="M3 18.5c2 1.3 4 1.3 6 0s4-1.3 6 0 4 1.3 6 0M5 15.5 4 10h16l-1 5.5M8 10V6h8v4M12 3v3"/>',
  car: '<path d="M5 17h14v-4.5L17 7H7l-2 5.5zM5 12.5h14M7.5 17v2.5M16.5 17v2.5M8 14.5h.01M16 14.5h.01"/>',
  stay: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v2M14 11v2M14 15v2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.5 3.5 0 0 0 7 18.5z"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.5 2.3 3.5 5.2"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.ticket}</svg>`;
// Older saved trips stored transport as e.g. "✈️ Plane"; keep just the words.
const noEmoji = (t) => String(t ?? '')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}]/gu, '')
  .replace(/\s+/g, ' ').trim();
const transportIcon = (t) => icon({ plane: 'plane', flight: 'plane', train: 'train', bus: 'bus', ferry: 'ferry', boat: 'ferry', car: 'car' }[noEmoji(t).toLowerCase()] || 'plane');
const uid = () => Math.random().toString(36).slice(2, 10);
const toISO = (d) => d.toISOString().slice(0, 10);
const parseDate = (s) => new Date(s + 'T00:00:00');
const today = () => parseDate(toISO(new Date()));
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);
const fmtDate = (s) =>
  parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Great-circle distance in km
function haversine(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rough guess so the region field is usually right; it can always be changed.
function guessContinent(lat, lng) {
  const crete = lat > 34.8 && lng > 23;
  if (lat < 35.8 && lng > -18 && lng < 32 && !crete) return 'Africa';
  return lng > 29 ? 'Asia' : 'Europe';
}

// Country flags: from the code saved when a place is picked from search,
// or looked up by name for stops typed in by hand.
const COUNTRY_CODES = {
  albania: 'AL', austria: 'AT', belgium: 'BE', 'bosnia and herzegovina': 'BA', cambodia: 'KH', china: 'CN',
  croatia: 'HR', czechia: 'CZ', 'czech republic': 'CZ', denmark: 'DK', egypt: 'EG', france: 'FR',
  germany: 'DE', greece: 'GR', hungary: 'HU', iceland: 'IS', india: 'IN', indonesia: 'ID', ireland: 'IE',
  israel: 'IL', italy: 'IT', japan: 'JP', jordan: 'JO', laos: 'LA', malaysia: 'MY', mexico: 'MX',
  montenegro: 'ME', morocco: 'MA', nepal: 'NP', netherlands: 'NL', 'north macedonia': 'MK', norway: 'NO',
  philippines: 'PH', poland: 'PL', portugal: 'PT', serbia: 'RS', singapore: 'SG', slovakia: 'SK',
  slovenia: 'SI', 'south korea': 'KR', spain: 'ES', 'sri lanka': 'LK', sweden: 'SE', switzerland: 'CH',
  taiwan: 'TW', thailand: 'TH', turkey: 'TR', 'türkiye': 'TR', 'united arab emirates': 'AE',
  'united kingdom': 'GB', 'united states': 'US', vietnam: 'VN', 'viet nam': 'VN',
};
function countryCodeOf(s) {
  const code = COUNTRY_CODES[(s.country || '').trim().toLowerCase()] || (s.countryCode || '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}
// Flags were emojis; the design now uses region colors instead.
const flagFor = () => '';

// ---------- state ----------

function defaultState() {
  const start = today();
  return {
    trip: { name: 'My Trip', start: toISO(start), end: toISO(addDays(start, 137)), home: null },
    stops: [],
    bookings: [],
    todos: [],
    todoState: {},
    profile: {},
    wishlist: [],
    money: { budget: null, expenses: [], extras: [] },
    asiaPlan: null,
  };
}

// Fill in fields that older saves or imports may be missing, and coerce
// every field that ends up in page markup to the kind of value it should
// hold. Trips can arrive from an import file or another account, so a
// tampered value must never be able to inject markup or script.
const CONTINENTS = ['Europe', 'Africa', 'Asia'];
const STOP_STATUSES = ['booked', 'tentative', 'idea'];
const EXPENSE_CATS = { stay: 'Stays', food: 'Food & drink', local: 'Getting around', fun: 'Activities', travel: 'Travel between stops', extras: 'One-off costs', other: 'Other' };
const BOOKING_TYPE_IDS = ['flight', 'train', 'bus', 'ferry', 'stay', 'activity'];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (v == null ? '' : String(v));
function migrate(data) {
  data.trip ??= {};
  data.trip.name = str(data.trip.name) || 'My Trip';
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDate(d).getTime());
  if (!isDay(data.trip.start)) data.trip.start = toISO(today());
  if (!isDay(data.trip.end) || data.trip.end < data.trip.start) data.trip.end = toISO(addDays(parseDate(data.trip.start), 137));
  data.trip.home = data.trip.home
    ? { name: str(data.trip.home.name), lat: num(data.trip.home.lat), lng: num(data.trip.home.lng) }
    : null;
  data.stops = Array.isArray(data.stops) ? data.stops : [];
  data.stops.forEach((s) => {
    s.id = str(s.id) || uid();
    s.status = STOP_STATUSES.includes(s.status) ? s.status : 'booked';
    s.continent = CONTINENTS.includes(s.continent) ? s.continent : 'Europe';
    s.lat = num(s.lat);
    s.lng = num(s.lng);
    s.rating = Math.max(0, Math.min(5, Math.round(num(s.rating))));
    ['name', 'country', 'notes', 'photo', 'transport', 'leg', 'arrive', 'depart'].forEach((k) => { s[k] = str(s[k]); });
    s.transport = noEmoji(s.transport);
  });
  data.bookings = Array.isArray(data.bookings) ? data.bookings : [];
  data.bookings.forEach((b) => {
    b.id = str(b.id) || uid();
    if (!BOOKING_TYPE_IDS.includes(b.type)) b.type = 'activity';
  });
  data.wishlist = Array.isArray(data.wishlist) ? data.wishlist : [];
  data.wishlist.forEach((w) => {
    w.lat = w.lat == null ? null : num(w.lat);
    w.lng = w.lng == null ? null : num(w.lng);
  });
  data.todos ??= [];        // your own tasks
  data.todoState ??= {};    // suggested reminders you've ticked off or dismissed
  data.profile ??= {};      // travel-preferences quiz answers
  // Budget: an optional total (US$) and the spending log.
  const m = data.money && typeof data.money === 'object' ? data.money : {};
  data.money = {
    budget: m.budget == null || m.budget === '' ? null : Math.max(0, num(m.budget)),
    expenses: (Array.isArray(m.expenses) ? m.expenses : []).filter((e) => e && typeof e === 'object').slice(0, 5000).map((e) => ({
      id: str(e.id) || uid(),
      date: isDay(str(e.date)) ? str(e.date) : toISO(today()),
      amount: Math.max(0, num(e.amount)),
      currency: /^[A-Z]{3}$/.test(str(e.currency)) ? str(e.currency) : 'USD',
      usd: Math.max(0, num(e.usd)),
      category: Object.hasOwn(EXPENSE_CATS, e.category) ? e.category : 'other',
      stopId: str(e.stopId),
      note: str(e.note).slice(0, 200),
    })),
    // One-off costs the estimate can't see (insurance, visas, gear…), in US$.
    extras: (Array.isArray(m.extras) ? m.extras : []).filter((x) => x && typeof x === 'object').slice(0, 100).map((x) => ({
      id: str(x.id) || uid(), name: str(x.name).slice(0, 80) || 'Cost', usd: Math.max(0, num(x.usd)),
    })),
  };
  // Asia leg planner draft.
  const ap = data.asiaPlan;
  data.asiaPlan = ap && typeof ap === 'object' && Array.isArray(ap.stops) ? {
    start: isDay(str(ap.start)) ? str(ap.start) : '',
    end: isDay(str(ap.end)) ? str(ap.end) : '',
    stops: ap.stops.filter((x) => x && typeof x === 'object').slice(0, 40).map((x) => ({
      name: str(x.name).slice(0, 80), country: str(x.country).slice(0, 60), lat: num(x.lat), lng: num(x.lng),
      nights: Math.max(1, Math.min(60, Math.round(num(x.nights)) || 1)),
    })),
  } : null;
  return data;
}

// ---------- end-to-end encryption (optional) ----------
//
// With encryption on, the trip is sealed on this device with AES-256-GCM,
// using a key derived from a passphrase (PBKDF2-SHA256, 600k rounds), before
// it is stored in this browser or uploaded. Supabase only ever holds the
// sealed box. The passphrase never leaves the device; if it's forgotten the
// trip can't be recovered by anyone.
//
// The family link gets its own sealed snapshot (sensitive fields removed)
// under a separate random key that only exists in the link's #fragment,
// which browsers never send to a server.

const KDF_ROUNDS = 600000;
const vault = {
  salt: null,  // set when encryption is on (Uint8Array)
  iter: KDF_ROUNDS,
  key: null,   // CryptoKey while unlocked
  box: null,   // a sealed trip waiting to be unlocked
};
const isSealed = (d) => !!d && typeof d === 'object' && d.enc === 1 && typeof d.ct === 'string';
const encryptionOn = () => !!vault.salt;
const isLocked = () => encryptionOn() && !vault.key;

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64url = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}
async function sealWith(key, obj, extra = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { enc: 1, v: 1, ...extra, iv: toB64(iv), ct: toB64(ct) };
}
async function openWith(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
const sealTrip = (obj) => sealWith(vault.key, obj, { kdf: 'PBKDF2-SHA256', iter: vault.iter, salt: toB64(vault.salt) });

// The family link's snapshot: no booking codes, links or notes, no to-dos,
// profile, wishlist or the snapshot key itself.
function familySnapshot(s) {
  const { todos, todoState, profile, wishlist, shareKey, money, asiaPlan, ...rest } = s;
  return { ...rest, bookings: (s.bookings || []).map(({ confirmation, link, notes, ...b }) => b) };
}
const newShareKey = () => toB64url(crypto.getRandomValues(new Uint8Array(32)));
const shareCryptoKey = (k) => crypto.subtle.importKey('raw', fromB64url(k), 'AES-GCM', false, ['encrypt', 'decrypt']);

// "Remember on this device": the unlocked key is kept in IndexedDB as a
// non-extractable CryptoKey (its bytes can't be read back out, even by this app).
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wanderlog', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('keys', mode).objectStore('keys'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const rememberKey = (key, salt) => idbDo('readwrite', (s) => s.put({ key, salt: toB64(salt) }, 'trip-key')).catch(() => {});
const forgetKey = () => idbDo('readwrite', (s) => s.delete('trip-key')).catch(() => {});
const rememberedKey = () => idbDo('readonly', (s) => s.get('trip-key')).catch(() => null);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      // An encrypted trip stays sealed until it's unlocked (see unlockWith).
      if (isSealed(data)) {
        vault.salt = fromB64(data.salt);
        vault.iter = data.iter;
        vault.box = data;
        return defaultState();
      }
      return migrate(data);
    }
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return defaultState();
}

// A family "view only" link carries ?view=<token>. That mode never reads or
// writes this browser's saved trip.
const viewToken = new URLSearchParams(location.search).get('view');
const readOnly = !!viewToken;
// An encrypted trip's family link carries its key after '#': ?view=…#k=…
const shareKeyFromUrl = readOnly ? new URLSearchParams(location.hash.slice(1)).get('k') : null;

let state = readOnly ? defaultState() : load();
let filter = 'all';

let localWrites = 0;
function saveLocal() {
  if (readOnly || isLocked()) return; // never overwrite a sealed trip with a placeholder
  const seq = ++localWrites;
  const write = (value) => {
    if (seq !== localWrites) return; // a newer save already happened
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (e) { console.warn('Could not save', e); }
  };
  if (vault.key) sealTrip(state).then(write).catch((e) => console.warn('Could not encrypt', e));
  else write(state);
}

// Every edit goes through here: save on this device, then upload if signed in.
function save() {
  saveLocal();
  queueUpload();
}

// "Ideas" are places you're considering that don't have dates yet.
const isIdea = (s) => s.status === 'idea';
const sortedStops = () =>
  state.stops.filter((s) => !isIdea(s)).sort((a, b) => a.arrive.localeCompare(b.arrive));
const ideaStops = () =>
  state.stops.filter(isIdea).sort((a, b) => a.name.localeCompare(b.name));

function stopStatus(stop) {
  const t = toISO(today());
  if (t < stop.arrive) return 'upcoming';
  if (t >= stop.depart) return 'past';
  return 'current';
}

// ---------- map ----------

// minZoom 2 keeps the world from repeating side by side.
const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([40, 50], 3);
// Esri street tiles need no API key. If they fail to load, fall back to OpenStreetMap.
// A quiet gray basemap (light or dark to match the device) so the colored
// route and pins stand out; place names come from a separate label layer.
const canvas = 'Dark'; // the app is always dark
const esriUrl = (layer) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${canvas}_Gray_${layer}/MapServer/tile/{z}/{y}/{x}`;
const esriTiles = L.tileLayer(esriUrl('Base'), {
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  maxNativeZoom: 16, maxZoom: 18, crossOrigin: true, // CORS tiles can be cached for offline use
}).addTo(map);
const esriLabels = L.tileLayer(esriUrl('Reference'), { maxNativeZoom: 16, maxZoom: 18, crossOrigin: true }).addTo(map);

let tileErrors = 0;
esriTiles.on('tileerror', () => {
  if (++tileErrors !== 5) return;
  map.removeLayer(esriTiles);
  map.removeLayer(esriLabels);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18, crossOrigin: true,
  }).addTo(map);
});

const markerLayer = L.layerGroup().addTo(map);
const markersById = {};

map.on('click', async (e) => {
  if (readOnly) return;
  const latlng = e.latlng.wrap();
  openStopDialog(null, { lat: latlng.lat, lng: latlng.lng });
  reverseGeocode(latlng.lat, latlng.lng);
});

const pinIcon = (cls, label) => {
  // Wider pill for combined labels like "2·5".
  const width = String(label).startsWith('<svg') ? 26 : Math.max(26, 16 + String(label).length * 7);
  return L.divIcon({
    className: '',
    html: `<div class="pin ${cls}">${label}</div>`,
    iconSize: [width, 26],
    iconAnchor: [width / 2, 13],
  });
};

// Draw one leg of the route. Legs that are shorter going across the
// Pacific (e.g. Asia -> North America) are split at the date line.
function drawLeg(a, b, style) {
  const d = b.lng - a.lng;
  if (Math.abs(d) <= 180) {
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], style).addTo(markerLayer);
    return;
  }
  const edge = d > 0 ? -180 : 180;
  const bLng = b.lng + (d > 0 ? -360 : 360);
  const t = (edge - a.lng) / (bLng - a.lng);
  const lat = a.lat + t * (b.lat - a.lat);
  L.polyline([[a.lat, a.lng], [lat, edge]], style).addTo(markerLayer);
  L.polyline([[lat, -edge], [b.lat, b.lng]], style).addTo(markerLayer);
}

function popupHTML(s) {
  const when = isIdea(s) ? 'Idea — no dates yet' : `${fmtDate(s.arrive)} → ${fmtDate(s.depart)}`;
  return `<div class="popup-stop">
    ${flagFor(s)}<strong>${escapeHTML(s.name)}</strong>, ${escapeHTML(s.country)}<br/>
    ${when}${s.status === 'tentative' ? ' · tentative' : ''}
    ${s.notes ? `<p style="margin:6px 0 0">${escapeHTML(s.notes)}</p>` : ''}</div>`;
}

function renderMap(fit = false) {
  markerLayer.clearLayers();
  const stops = sortedStops();
  const ideas = ideaStops();
  const home = state.trip.home;

  // Stops at the same place (e.g. Madrid twice) share one pin labelled "2·5".
  const groups = new Map();
  stops.forEach((s, i) => {
    const key = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ s, n: i + 1 });
  });
  groups.forEach((group) => {
    const first = group[0].s;
    const statuses = group.map(({ s }) => stopStatus(s));
    const cls = [
      first.continent,
      statuses.includes('current') ? 'current' : statuses[0],
      group.every(({ s }) => s.status === 'booked') ? 'booked' : 'tentative',
    ].join(' ');
    const m = L.marker([first.lat, first.lng], { icon: pinIcon(cls, group.map((g) => g.n).join('·')) })
      .addTo(markerLayer)
      .bindPopup(group.map(({ s }) => popupHTML(s)).join(''));
    m.on('click', () => highlight(first.id));
    group.forEach(({ s }) => { markersById[s.id] = m; });
  });

  ideas.forEach((s) => {
    const m = L.marker([s.lat, s.lng], { icon: pinIcon(`${s.continent} idea`, '?') })
      .addTo(markerLayer).bindPopup(popupHTML(s));
    m.on('click', () => highlight(s.id));
    markersById[s.id] = m;
  });

  if (home) {
    L.marker([home.lat, home.lng], { icon: pinIcon('home', icon('stay')) })
      .addTo(markerLayer).bindPopup(`<strong>Home</strong> · ${escapeHTML(home.name)}`);
  }

  // Route: home -> stops -> home. Solid where you've been, dashed for what's ahead.
  const route = home && stops.length ? [home, ...stops, home] : stops;
  const offset = route === stops ? 0 : 1;
  const lastDone = stops.findLastIndex((s) => stopStatus(s) !== 'upcoming');
  const tripOver = toISO(today()) >= state.trip.end;
  const doneLegs = tripOver ? route.length : lastDone + offset;
  for (let i = 0; i < route.length - 1; i++) {
    drawLeg(route[i], route[i + 1], i < doneLegs
      ? { color: '#ff5fd8', weight: 3 }
      : { color: '#8f86b8', weight: 2, dashArray: '6 8' });
  }

  if (fit) {
    userMovedMap = false;
    fitToTrip();
  }
}

// Zoom the map to show the whole trip. Until the user pans or zooms it
// themselves, refit whenever the map's size changes (page still laying
// out, window resized, phone rotated) so it never stays zoomed out.
let userMovedMap = false;
function fitToTrip() {
  const all = [...sortedStops(), ...ideaStops()];
  if (!all.length) return;
  map.invalidateSize();
  map.fitBounds(all.map((s) => [s.lat, s.lng]), { padding: [40, 40], maxZoom: 6 });
}
['mousedown', 'wheel', 'touchstart', 'keydown'].forEach((type) =>
  map.getContainer().addEventListener(type, () => { userMovedMap = true; }, { passive: true }));
new ResizeObserver(() => {
  map.invalidateSize();
  if (!userMovedMap) fitToTrip();
}).observe(map.getContainer());

function highlight(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- header, progress, stats ----------

function renderHeader() {
  const { name, start, end } = state.trip;
  $('#trip-name').textContent = name;
  $('#trip-dates').textContent = `${fmtDate(start)} – ${fmtDate(end)} · ${daysBetween(start, end)} days`;
  document.title = `${name} · Wanderlog`;

  const total = daysBetween(start, end);
  const elapsed = daysBetween(start, toISO(today()));
  const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;
  // Under the timeline: a color key for the regions on this trip, plus days left once you're traveling.
  const regions = CONTINENTS.filter((c) => sortedStops().some((s) => s.continent === c));
  const left = elapsed >= 0 && elapsed < total ? `<span>${plural(total - elapsed - 1)} to go</span>` : '';
  $('#progress-label').innerHTML = regions.map((c) => `<span class="key ${c}">${c}</span>`).join('') + left;

  // Big countdown on the right of the header.
  const [num, label] = elapsed < 0 ? [-elapsed, elapsed === -1 ? 'day to go' : 'days to go']
    : elapsed >= total ? ['Done', 'trip complete']
    : [`Day ${elapsed + 1}`, `of ${total}`];
  $('#countdown-num').textContent = num;
  $('#countdown-label').textContent = label;
  const now = sortedStops().find((s) => stopStatus(s) === 'current');
  const next = sortedStops().find((s) => stopStatus(s) === 'upcoming');
  $('#hero-eyebrow').innerHTML = now ? `Now in ${flagFor(now)}${escapeHTML(now.name)}`
    : next ? `First stop · ${flagFor(next)}${escapeHTML(next.name)}` : 'Your trip';
  renderTimeline();
}

// The whole trip as one bar: a colored segment per stop (by region), month
// markers underneath, and a line for today.
function renderTimeline() {
  const { start, end } = state.trip;
  const total = Math.max(1, daysBetween(start, end));
  const pos = (day) => Math.min(100, Math.max(0, (daysBetween(start, day) / total) * 100));
  const t = toISO(today());
  const segments = sortedStops().map((s) => {
    const left = pos(s.arrive);
    const width = Math.max(0.6, pos(s.depart) - left);
    const cls = [s.continent, s.depart <= t && 'past', stopStatus(s) === 'current' && 'current'].filter(Boolean).join(' ');
    return `<span class="seg ${cls}" style="left:${left}%;width:${width}%"
      title="${escapeHTML(s.name)} · ${fmtDate(s.arrive)} – ${fmtDate(s.depart)}"></span>`;
  }).join('');
  const todayLine = t >= start && t <= end ? `<span class="today" style="left:${pos(t)}%"></span>` : '';
  const ticks = [];
  let [y, m] = start.split('-').map(Number);
  for (;;) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    if (first > end) break;
    const month = parseDate(first).toLocaleDateString(undefined, { month: 'short' });
    if (first >= start) ticks.push(`<span class="tick" style="left:${pos(first)}%">${month}</span>`);
    // Label the month the trip starts in, unless the next month's label would sit right on top of it.
    else if (pos(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`) > 8) {
      ticks.push(`<span class="tick start" style="left:0">${month}</span>`);
    }
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  $('#trip-timeline').innerHTML = `<div class="track">${segments}${todayLine}</div><div class="ticks">${ticks.join('')}</div>`;
}

function routeKm(stops) {
  const home = state.trip.home;
  const route = home && stops.length ? [home, ...stops, home] : stops;
  let km = 0;
  for (let i = 1; i < route.length; i++) km += haversine(route[i - 1], route[i]);
  return km;
}

function renderStats() {
  const stops = sortedStops();
  const countries = new Set(stops.map((s) => s.country.trim().toLowerCase()));
  const nights = stops.reduce((n, s) => n + Math.max(daysBetween(s.arrive, s.depart), 0), 0);
  const rated = stops.filter((s) => s.rating > 0);
  const fav = rated.sort((a, b) => b.rating - a.rating)[0];

  const tiles = [
    [stops.length, 'Stops'],
    [countries.size, 'Countries'],
    [new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(routeKm(stops)) + ' km', 'Distance'],
    [nights, 'Nights planned'],
    ideaStops().length && [ideaStops().length, 'Ideas to plan'],
    !readOnly && stops.length && [usdShort(tripEstimate().total), 'Est. trip cost'],
    fav && [escapeHTML(fav.name), 'Top rated'],
  ].filter(Boolean);
  $('#stats').innerHTML = tiles
    .map(([v, l]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`)
    .join('');
}

// ---------- itinerary list ----------

function addListItem(className, text, html = '') {
  const li = document.createElement('li');
  li.className = className;
  li.textContent = text;
  if (html) li.insertAdjacentHTML('afterbegin', html);
  $('#stop-list').appendChild(li);
}

function stopItem(s, label) {
  const status = isIdea(s) ? 'idea' : stopStatus(s);
  const li = document.createElement('li');
  li.className = `stop ${s.continent} ${status} ${s.status}`;
  li.dataset.id = s.id;
  const safePhoto = /^https?:\/\//i.test(s.photo || '') ? s.photo : '';
  const nights = isIdea(s) ? 0 : daysBetween(s.arrive, s.depart);
  const when = isIdea(s)
    ? 'No dates yet — double-click to schedule'
    : `${fmtDate(s.arrive)} → ${fmtDate(s.depart)} · ${nights} night${nights === 1 ? '' : 's'}`;
  const badges =
    (status === 'current' ? '<span class="badge">You are here</span>' : '') +
    (s.status === 'tentative' ? '<span class="badge soft">Tentative</span>' : '');
  li.innerHTML = `
    <div class="num">${label}</div>
    <div>
      <div class="title">${flagFor(s)}${escapeHTML(s.name)}${badges}</div>
      <div class="meta">${escapeHTML(s.country)} · ${when}</div>
      ${bookingChips(s)}
      ${s.rating ? `<div class="rating">${'★'.repeat(s.rating)}${'☆'.repeat(5 - s.rating)}</div>` : ''}
      ${s.notes ? `<div class="notes">${escapeHTML(s.notes)}</div>` : ''}
      ${safePhoto ? `<img src="${escapeHTML(safePhoto)}" alt="${escapeHTML(s.name)}" loading="lazy" />` : ''}
    </div>`;
  li.addEventListener('click', () => {
    userMovedMap = true;
    map.flyTo([s.lat, s.lng], isIdea(s) ? 5 : 8, { duration: 0.8 });
    markersById[s.id]?.openPopup();
  });
  li.addEventListener('dblclick', () => openStopDialog(s));
  li.querySelectorAll('.bchip').forEach((chip) => chip.addEventListener('click', (e) => {
    e.stopPropagation();
    showBooking(chip.dataset.booking);
  }));
  $('#stop-list').appendChild(li);
}

function renderList() {
  const stops = sortedStops();
  const ideas = ideaStops();
  const home = state.trip.home;
  const showLegs = filter === 'all';
  const km = (a, b) => Math.round(haversine(a, b)).toLocaleString() + ' km';
  $('#stop-list').innerHTML = '';
  $('#empty').hidden = stops.length + ideas.length > 0;

  if (home && stops.length && showLegs) {
    addListItem('leg', ` From ${home.name} · ${noEmoji(stops[0].transport) || 'Plane'} · ${km(home, stops[0])}`, transportIcon(stops[0].transport));
  }
  stops.forEach((s, i) => {
    if (filter !== 'all' && s.continent !== filter) return;
    if (s.leg && s.leg !== stops[i - 1]?.leg) addListItem('section-head', s.leg);
    if (i > 0 && showLegs) addListItem('leg', ` ${noEmoji(s.transport) || 'Travel'} · ${km(stops[i - 1], s)}`, transportIcon(s.transport));
    stopItem(s, i + 1);
  });
  if (home && stops.length && showLegs) {
    addListItem('leg', ` Plane · ${km(stops.at(-1), home)} · home to ${home.name}`, icon('plane'));
  }

  const shownIdeas = ideas.filter((s) => filter === 'all' || s.continent === filter);
  if (shownIdeas.length) {
    addListItem('section-head', `Ideas — not scheduled yet (${shownIdeas.length})`);
    shownIdeas.forEach((s) => stopItem(s, '?'));
  }
}

document.querySelectorAll('#filters .chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('#filters .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    filter = chip.dataset.filter;
    renderList();
  })
);

function render(fit = false) {
  renderHeader();
  renderNextUp();
  renderStats();
  renderList();
  renderBookings();
  renderTodos();
  renderHome();
  renderProfile();
  renderBudget();
  if (!$('#view-planner').hidden) renderPlanner();
  renderCryptoStatus();
  if (!$('#view-discover').hidden) renderDiscover();
  renderMap(fit);
}

// ---------- bookings: flights, trains, stays & confirmations ----------

const BOOKING_TYPES = {
  flight: { icon: 'plane', start: 'Departs', end: 'Arrives' },
  train: { icon: 'train', start: 'Departs', end: 'Arrives' },
  bus: { icon: 'bus', start: 'Departs', end: 'Arrives' },
  ferry: { icon: 'ferry', start: 'Departs', end: 'Arrives' },
  stay: { icon: 'stay', start: 'Check-in', end: 'Check-out' },
  activity: { icon: 'ticket', start: 'Starts', end: 'Ends' },
};
const bookingIcon = (b) => icon(BOOKING_TYPES[b.type]?.icon ?? 'ticket');

// Booking times are stored as typed ("2027-01-06T17:30"), in the local time
// of the place, and shown the same way.
function nowLocal() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ` +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
const sortedBookings = () => [...state.bookings].sort((a, b) => a.start.localeCompare(b.start));
const bookingsForStop = (s) => sortedBookings().filter((b) => b.stopId === s.id);

function bookingChips(s) {
  const list = bookingsForStop(s);
  if (!list.length) return '';
  return `<div class="booking-chips">${list.map((b) =>
    `<button type="button" class="bchip" data-booking="${b.id}">${bookingIcon(b)} ${escapeHTML(b.title)}</button>`
  ).join('')}</div>`;
}

// Pick the stop a booking belongs to: transport goes with the stop you arrive
// at (overnight flights land the next day); stays and activities with the
// stop whose dates include them.
function autoStopId(type, start, end) {
  const transport = !['stay', 'activity'].includes(type);
  const day = ((transport && end) || start).slice(0, 10);
  const stops = sortedStops();
  const match = (transport && stops.find((s) => s.arrive === day)) ||
    stops.find((s) => s.arrive <= day && day < s.depart);
  return match?.id ?? '';
}

function renderNextUp() {
  const now = nowLocal();
  const list = sortedBookings();
  const staying = list.find((b) => b.type === 'stay' && b.start <= now && now < (b.end || b.start));
  const next = list.find((b) => b.start > now);
  const card = (label, b, when) => `
    <button type="button" class="next-card" data-booking="${b.id}">
      <span class="next-label">${label}</span>
      <span class="next-title">${bookingIcon(b)} ${escapeHTML(b.title)}</span>
      <span class="muted">${when}${b.confirmation ? ` · Conf. <span class="conf">${escapeHTML(b.confirmation)}</span>` : ''}</span>
    </button>`;
  const parts = [];
  if (staying) parts.push(card('Staying at', staying, `until ${fmtDateTime(staying.end)}`));
  if (next) {
    const days = daysBetween(toISO(today()), next.start.slice(0, 10));
    const soon = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    parts.push(card('Next up', next, `${fmtDateTime(next.start)} · ${soon}`));
  }
  const el = $('#next-up');
  el.innerHTML = parts.join('');
  el.hidden = !parts.length;
  el.querySelectorAll('.next-card').forEach((c) =>
    c.addEventListener('click', () => showBooking(c.dataset.booking)));
}

function bookingItem(b) {
  const stop = state.stops.find((s) => s.id === b.stopId);
  const link = /^https?:\/\//i.test(b.link || '') ? b.link : '';
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address || '')}`;
  const li = document.createElement('li');
  li.className = `booking${(b.end || b.start) < nowLocal() ? ' past' : ''}`;
  li.dataset.id = b.id;
  li.innerHTML = `
    <div class="b-icon">${bookingIcon(b)}</div>
    <div>
      <div class="title">${escapeHTML(b.title)}</div>
      <div class="meta">${fmtDateTime(b.start)}${b.end ? ` → ${fmtDateTime(b.end)}` : ''}</div>
      ${b.provider || b.confirmation ? `<div class="meta">
        ${escapeHTML(b.provider || '')}${b.provider && b.confirmation ? ' · ' : ''}
        ${b.confirmation ? `Conf. <span class="conf">${escapeHTML(b.confirmation)}</span>
          <button type="button" class="copy">Copy</button>` : ''}
      </div>` : ''}
      ${b.details ? `<div class="notes">${escapeHTML(b.details)}</div>` : ''}
      ${b.address ? `<div class="notes"><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">${icon('pin')} ${escapeHTML(b.address)}</a></div>` : ''}
      ${link ? `<div class="notes"><a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">Open booking ↗</a></div>` : ''}
      ${b.notes ? `<div class="notes">${escapeHTML(b.notes)}</div>` : ''}
      ${stop ? `<div class="meta">For: ${escapeHTML(stop.name)}</div>` : ''}
    </div>`;
  li.querySelector('.copy')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(b.confirmation);
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    } catch { /* clipboard blocked: the number is visible to copy by hand */ }
  });
  li.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  li.addEventListener('click', () => openBookingDialog(b));
  return li;
}

function renderBookings() {
  const list = $('#booking-list');
  list.innerHTML = '';
  const all = sortedBookings();
  $('#bookings-empty').hidden = all.length > 0;
  const now = nowLocal();
  const upcoming = all.filter((b) => (b.end || b.start) >= now);
  const past = all.filter((b) => (b.end || b.start) < now);
  const head = (text) => {
    const li = document.createElement('li');
    li.className = 'section-head';
    li.textContent = text;
    list.appendChild(li);
  };
  if (upcoming.length) head(`Upcoming (${upcoming.length})`);
  upcoming.forEach((b) => list.appendChild(bookingItem(b)));
  if (past.length) head(`Past (${past.length})`);
  past.forEach((b) => list.appendChild(bookingItem(b)));
}

// ---------- views: Home · Trip · Bookings · To-dos · Profile ----------

const VIEWS = ['home', 'trip', 'discover', 'bookings', 'budget', 'todos', 'profile', 'planner'];
const PRIVATE_VIEWS = ['discover', 'budget', 'todos', 'profile', 'planner']; // not shown on the family link

function showView(name) {
  if (!VIEWS.includes(name) || (readOnly && PRIVATE_VIEWS.includes(name))) name = 'home';
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
  const navName = name === 'planner' ? 'trip' : name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === navName));
  window.scrollTo({ top: 0 });
  if (name === 'discover') openDiscover();
  if (name === 'budget') refreshRates();
  if (name === 'planner') renderPlanner();
}
// The URL hash remembers the tab (#trip, #todos, …) so back/forward and refresh work.
function goTo(name) {
  const target = shareKeyFromUrl ? `v=${name}&k=${shareKeyFromUrl}` : name;
  if (location.hash === `#${target}`) showView(name);
  else location.hash = target;
}
// On a family link the #fragment also holds its key, as "#v=trip&k=…".
function hashView() {
  const h = location.hash.slice(1);
  return h.includes('=') ? new URLSearchParams(h).get('v') || 'home' : h;
}
window.addEventListener('hashchange', () => showView(hashView()));
document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.view)));
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (link) goTo(link.dataset.goto);
});

function showBooking(id) {
  goTo('bookings');
  const el = document.querySelector(`#booking-list [data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
}

function showStop(id) {
  const s = state.stops.find((x) => x.id === id);
  if (!s) return;
  goTo('trip');
  userMovedMap = true;
  // Wait a frame so the map has its size after the Trip tab appears.
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.setView([s.lat, s.lng], isIdea(s) ? 5 : 8);
    markersById[s.id]?.openPopup();
    highlight(s.id);
  });
}

// ---------- to-dos: reminders built from the trip, plus your own ----------

// Schengen area: 90 days in any 180 for visitors such as US passport holders.
const SCHENGEN = new Set(['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT',
  'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH']);

function schengenStatus() {
  const days = new Set();
  const countries = new Set();
  sortedStops().forEach((s) => {
    if (!SCHENGEN.has(countryCodeOf(s))) return;
    countries.add(s.country);
    for (let d = parseDate(s.arrive); toISO(d) <= s.depart; d = addDays(d, 1)) days.add(toISO(d));
  });
  if (!days.size) return null;
  const sorted = [...days].sort();
  let max = 0;
  let worstEnd = sorted[0];
  for (const end of sorted) {
    const from = toISO(addDays(parseDate(end), -179));
    const count = sorted.filter((d) => d >= from && d <= end).length;
    if (count > max) { max = count; worstEnd = end; }
  }
  return { max, worstEnd, countries: [...countries] };
}

const isTransport = (b) => ['flight', 'train', 'bus', 'ferry'].includes(b.type);
const dayOf = (dt) => (dt || '').slice(0, 10);
const daysBefore = (day, n) => toISO(addDays(parseDate(day), -n));

// Reminders worked out from the stops and bookings. Ids are stable so
// ticking one off (or dismissing it) is remembered.
function autoTodos() {
  const list = [];
  const add = (key, text, due, extra = {}) => list.push({ id: `auto:${key}`, auto: true, text, due, ...extra });
  const t = toISO(today());
  const stops = sortedStops();
  const bookings = sortedBookings();
  const home = state.trip.home;

  // Before you go
  if (t < state.trip.start) {
    [
      ['passport', 'Check your passport is valid for 6+ months after you get home', 90],
      ['insurance', 'Get travel insurance', 30],
      ['phone', 'Sort out an international phone plan or eSIM', 14],
      ['bank', "Tell your bank and card companies you'll be abroad", 7],
      ['docs', 'Save copies of your passport and bookings where you can reach them offline', 7],
    ].forEach(([key, text, days]) => add(`pre:${key}`, text, daysBefore(state.trip.start, days)));
  }

  // Entry rules: one reminder for the Schengen area, one per other country.
  const seen = new Set();
  stops.filter((s) => s.arrive >= t).forEach((s) => {
    const code = countryCodeOf(s) || s.country;
    const key = SCHENGEN.has(code) ? 'schengen' : code;
    if (seen.has(key)) return;
    seen.add(key);
    if (key === 'schengen') {
      add('entry:schengen', 'Check Schengen entry rules (passport, 90-day limit, ETIAS)', daysBefore(s.arrive, 45), {
        hint: 'Covers most of your Europe stops. Official info: travel-europe.europa.eu',
      });
    } else {
      add(`entry:${key}`, `Check entry & visa rules for ${s.country}`, daysBefore(s.arrive, 45), {
        hint: 'Look up the official government site: visa or e-visa, passport validity, arrival forms.',
        stopId: s.id,
      });
    }
  });

  // Getting to each stop, and a place to sleep there.
  stops.filter((s) => s.arrive >= t).forEach((s) => {
    const i = stops.indexOf(s);
    const from = i > 0 ? stops[i - 1].name : home?.name;
    const hasTransport = bookings.some((b) => isTransport(b) && (b.stopId === s.id || dayOf(b.end || b.start) === s.arrive));
    if (!hasTransport && from) {
      const how = noEmoji(s.transport).toLowerCase() || 'travel';
      add(`transport:${s.id}`, `Book ${how} to ${s.name}`, daysBefore(s.arrive, 30), {
        hint: `From ${from} · ${fmtDate(s.arrive)}`, stopId: s.id,
      });
    }
    const nights = daysBetween(s.arrive, s.depart);
    const hasStay = bookings.some((b) => b.type === 'stay' &&
      (b.stopId === s.id || (dayOf(b.start) <= s.arrive && s.arrive < dayOf(b.end || b.start))));
    if (nights > 0 && !hasStay) {
      add(`stay:${s.id}`, `Book a place to stay in ${s.name}`, daysBefore(s.arrive, 30), {
        hint: `${fmtDate(s.arrive)} – ${fmtDate(s.depart)} · ${nights} night${nights === 1 ? '' : 's'}`, stopId: s.id,
      });
    }
  });

  // Getting home.
  const last = stops.at(-1);
  if (home && last && last.depart >= t &&
      !bookings.some((b) => isTransport(b) && dayOf(b.start) >= last.depart)) {
    add('home', `Book your flight home to ${home.name}`, daysBefore(last.depart, 60), {
      hint: `From ${last.name} · ${fmtDate(last.depart)}`,
    });
  }

  // Booked things: online check-in and missing details.
  bookings.filter((b) => dayOf(b.start) >= t).forEach((b) => {
    if (b.type === 'flight') {
      add(`checkin:${b.id}`, `Check in online: ${b.title}`, daysBefore(dayOf(b.start), 1), {
        hint: 'Online check-in usually opens 24 hours before departure.', bookingId: b.id,
      });
    }
    const missing = [b.type === 'stay' && !b.address && 'address', !b.confirmation && 'confirmation code'].filter(Boolean);
    if (missing.length) {
      add(`details:${b.id}`, `Add the ${missing.join(' and ')} for ${b.title}`, daysBefore(dayOf(b.start), 14), { bookingId: b.id });
    }
  });

  return list;
}

function allTodos() {
  const marks = state.todoState;
  const auto = autoTodos()
    .filter((x) => marks[x.id] !== 'dismissed')
    .map((x) => ({ ...x, done: marks[x.id] === 'done' }));
  return [...auto, ...state.todos];
}
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
const openTodos = () => allTodos().filter((x) => !x.done).sort(byDue);

function dueInfo(due) {
  if (!due) return { text: '', cls: '' };
  const days = daysBetween(toISO(today()), due);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, cls: 'overdue' };
  if (days === 0) return { text: 'Due today', cls: 'soon' };
  if (days <= 7) return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, cls: 'soon' };
  return { text: `Due ${fmtDate(due)}`, cls: '' };
}

function todoItem(x, { compact = false } = {}) {
  const due = dueInfo(x.due);
  const li = document.createElement('li');
  li.className = `task ${x.done ? 'done' : due.cls}`;
  li.innerHTML = `
    <input type="checkbox" ${x.done ? 'checked' : ''} aria-label="Done" ${readOnly ? 'disabled' : ''} />
    <div class="task-body">
      <div class="task-text">${escapeHTML(x.text)}</div>
      <div class="task-meta">${[due.text, !compact && x.hint && escapeHTML(x.hint), x.auto && !compact && 'Suggested']
        .filter(Boolean).join(' · ')}</div>
    </div>
    ${compact || readOnly ? '' : `<button type="button" class="task-x" title="${x.auto ? 'Dismiss' : 'Delete'}">×</button>`}`;
  li.querySelector('input').addEventListener('change', (e) => setTodoDone(x, e.target.checked));
  li.querySelector('.task-x')?.addEventListener('click', () => removeTodo(x));
  li.querySelector('.task-body').addEventListener('click', () => {
    if (x.bookingId) showBooking(x.bookingId);
    else if (x.stopId) showStop(x.stopId);
  });
  if (x.bookingId || x.stopId) li.querySelector('.task-body').classList.add('clickable');
  return li;
}

function setTodoDone(x, done) {
  if (x.auto) {
    if (done) state.todoState[x.id] = 'done';
    else delete state.todoState[x.id];
  } else {
    state.todos = state.todos.map((t) => (t.id === x.id ? { ...t, done } : t));
  }
  save();
  render();
}

function removeTodo(x) {
  if (x.auto) state.todoState[x.id] = 'dismissed';
  else state.todos = state.todos.filter((t) => t.id !== x.id);
  save();
  render();
}

$('#todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const text = f.text.value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, due: f.due.value, done: false });
  e.target.reset();
  save();
  render();
});

function renderTodos() {
  const open = openTodos();
  const done = allTodos().filter((x) => x.done);
  const list = $('#todo-list');
  list.innerHTML = '';
  // Group under "Overdue", then one heading per month, so it reads like a calendar.
  const t = toISO(today());
  const groupOf = (x) => !x.due ? 'No date'
    : x.due < t ? 'Overdue'
      : parseDate(x.due).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  let current = null;
  open.forEach((x) => {
    const group = groupOf(x);
    if (group !== current) {
      current = group;
      const count = open.filter((y) => groupOf(y) === group).length;
      const head = document.createElement('li');
      head.className = `section-head${group === 'Overdue' ? ' overdue' : ''}`;
      head.textContent = `${group} · ${count}`;
      list.appendChild(head);
    }
    list.appendChild(todoItem(x));
  });
  $('#todos-empty').hidden = open.length > 0;
  $('#done-section').hidden = !done.length;
  $('#done-summary').textContent = `Done (${done.length})`;
  $('#done-list').innerHTML = '';
  done.forEach((x) => $('#done-list').appendChild(todoItem(x)));

  // Badge on the tab: things overdue or due within two weeks.
  const urgent = open.filter((x) => x.due && daysBetween(toISO(today()), x.due) <= 14).length;
  $('#todo-count').textContent = urgent;
  $('#todo-count').hidden = !urgent || readOnly;

  const sch = schengenStatus();
  const card = $('#schengen-card');
  card.hidden = !sch;
  if (sch) {
    const pct = Math.min(100, (sch.max / 90) * 100);
    const level = sch.max > 90 ? 'over' : sch.max > 80 ? 'close' : 'ok';
    card.innerHTML = `
      <div class="card-head"><h2>Schengen 90-day limit</h2><span class="pill ${level}">${sch.max} / 90 days</span></div>
      <div class="meter ${level}"><div style="width:${pct}%"></div></div>
      <p class="muted">${sch.max > 90
        ? `Your plan has you in the Schengen area for ${sch.max} days in one 180-day window. US passport holders can stay 90. Shorten some Schengen stops or move them outside the area.`
        : `Your busiest 180-day window (ending ${fmtDate(sch.worstEnd)}) has ${sch.max} Schengen days, so you're within the 90-day limit for US passport holders.`}
        Counted from ${escapeHTML(sch.countries.join(', '))}. Entry and exit days both count.</p>`;
  }
}

// ---------- Home ----------

function renderHome() {
  const attention = $('#attention-list');
  attention.innerHTML = '';
  const open = openTodos();
  open.slice(0, 5).forEach((x) => attention.appendChild(todoItem(x, { compact: true })));
  if (!open.length) attention.innerHTML = '<li class="empty">Nothing needs attention right now.</li>';
  else if (open.length > 5) {
    const more = document.createElement('li');
    more.innerHTML = `<button class="link" data-goto="todos">+ ${open.length - 5} more</button>`;
    attention.appendChild(more);
  }

  const t = toISO(today());
  const upcoming = sortedStops().filter((s) => s.depart > t).slice(0, 4);
  const list = $('#upcoming-list');
  list.innerHTML = upcoming.length ? '' : '<li class="empty">No upcoming stops.</li>';
  upcoming.forEach((s) => {
    const n = sortedStops().indexOf(s) + 1;
    const status = stopStatus(s);
    const li = document.createElement('li');
    li.className = `upcoming ${s.continent}`;
    li.innerHTML = `
      <span class="num">${n}</span>
      <span class="up-body">
        <span class="up-title">${flagFor(s)}${escapeHTML(s.name)}${status === 'current' ? '<span class="badge">Now</span>' : ''}</span>
        <span class="muted">${fmtDate(s.arrive)} → ${fmtDate(s.depart)} · ${daysBetween(s.arrive, s.depart)} nights${s.status === 'booked' ? ' · Booked' : ''}${wishlistFor(s.id).length ? ` · ★ ${wishlistFor(s.id).length} saved` : ''}</span>
      </span>
      <span class="up-when muted">${status === 'current' ? '' : `in ${daysBetween(t, s.arrive)}d`}</span>`;
    li.addEventListener('click', () => showStop(s.id));
    list.appendChild(li);
  });

  $('#quiz-banner').hidden = readOnly || profileAnswered() > 0;
  renderGauges();
  renderMonthChart();
  renderCountryBars();
  renderCalendar();
}

// ---------- Home dashboard: ring gauges, charts and calendar ----------

// Each night of the trip mapped to the stop you sleep at that night.
function nightMap() {
  const nights = new Map();
  sortedStops().forEach((s) => {
    for (let d = parseDate(s.arrive); toISO(d) < s.depart; d = addDays(d, 1)) nights.set(toISO(d), s);
  });
  return nights;
}

// The calendar months the trip touches, as { key: '2027-01', date }.
function tripMonths() {
  const { start, end } = state.trip;
  const out = [];
  let [y, m] = start.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= end.slice(0, 7) && out.length < 36) {
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, date: new Date(y, m - 1, 1) });
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

function ring(pct, tone) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const arc = p > 0
    ? `<circle cx="50" cy="50" r="${r}" class="ring-arc" stroke="url(#${tone === 'warn' ? 'warn' : 'neon'}-grad)"
        stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>`
    : '';
  return `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="ring-track"/>${arc}</svg>`;
}

function renderGauges() {
  const { start, end } = state.trip;
  const total = Math.max(1, daysBetween(start, end));
  const elapsed = daysBetween(start, toISO(today()));
  const stops = sortedStops();
  const share = (a, b) => (b ? a / b : 0);
  const pct = (p) => `${Math.round(p * 100)}<small>%</small>`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const gauge = ({ label, p, value, sub, tone = '', goto = '' }) => `
    <${goto ? `button data-goto="${goto}"` : 'div'} class="gauge ${tone}">
      <span class="gauge-ring">${ring(p, tone)}<span class="gauge-value">${value}</span></span>
      <span class="gauge-text"><span class="gauge-label">${label}</span><span class="gauge-sub">${sub}</span></span>
    </${goto ? 'button' : 'div'}>`;

  const tripP = Math.max(0, Math.min(1, elapsed / total));
  const cards = [{
    label: 'Trip progress', p: tripP, value: pct(tripP), goto: 'trip',
    sub: elapsed < 0 ? `Starts in ${plural(-elapsed, 'day')}` : elapsed >= total ? 'Trip complete' : `Day ${elapsed + 1} of ${total}`,
  }];
  if (stops.length) {
    const booked = stops.filter((s) => s.status === 'booked').length;
    cards.push({ label: 'Stops booked', p: share(booked, stops.length), value: pct(share(booked, stops.length)),
      sub: `${booked} of ${plural(stops.length, 'stop')}`, goto: 'trip' });
  }
  const sch = schengenStatus();
  if (sch) {
    const left = 90 - sch.max;
    cards.push({ label: 'Schengen days', p: sch.max / 90, value: `${sch.max}<small>/90</small>`,
      tone: left < 10 ? 'warn' : '', goto: readOnly ? '' : 'todos',
      sub: left < 0 ? `${plural(-left, 'day')} over the limit` : left < 10 ? `Only ${plural(left, 'day')} to spare` : `${plural(left, 'day')} to spare` });
  }
  if (!readOnly) {
    const all = allTodos();
    const done = all.filter((x) => x.done).length;
    if (all.length) {
      cards.push({ label: 'To-dos done', p: share(done, all.length), value: pct(share(done, all.length)),
        sub: `${done} of ${all.length} done`, goto: 'todos' });
    }
  }
  $('#gauges').innerHTML = cards.map(gauge).join('');
}

// Shared hover tooltip for the charts and calendar.
const chartTip = $('#chart-tip');
function showTip(e, html) {
  chartTip.innerHTML = html;
  chartTip.hidden = false;
  const r = chartTip.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  chartTip.style.left = `${Math.max(8, x)}px`;
  chartTip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { chartTip.hidden = true; };
const stopNames = (stops) => [...new Set(stops)].map((s) => `${flagFor(s)}${escapeHTML(s.name)}`).join(', ');

let monthData = [];
function renderMonthChart() {
  const el = $('#chart-months');
  const nights = nightMap();
  monthData = tripMonths().map((m) => {
    const list = [...nights].filter(([d]) => d.startsWith(m.key));
    return { ...m, n: list.length, stops: list.map(([, s]) => s) };
  });
  const totalNights = monthData.reduce((n, m) => n + m.n, 0);
  $('#nights-total').textContent = totalNights ? `${totalNights} nights planned` : '';
  if (!totalNights) {
    el.innerHTML = '<p class="empty">Add stops with dates to see your nights by month.</p>';
    return;
  }
  const W = Math.max(260, el.clientWidth || 560);
  const H = 250;
  const pad = { l: 30, r: 14, t: 22, b: 26 };
  const yMax = Math.max(10, Math.ceil(Math.max(...monthData.map((m) => m.n)) / 10) * 10);
  const n = monthData.length;
  const x = (i) => (n === 1 ? (W + pad.l - pad.r) / 2 : pad.l + 8 + (i * (W - pad.l - pad.r - 16)) / (n - 1));
  const y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const pts = monthData.map((m, i) => [x(i), y(m.n)]);
  // Smooth curve that never overshoots: horizontal control points halfway between months.
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    line += ` C${mx},${pts[i - 1][1]} ${mx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`;
  }
  const base = y(0);
  const area = `${line} L${pts.at(-1)[0]},${base} L${pts[0][0]},${base} Z`;
  const grid = [0, yMax / 2, yMax].map((v) => `
    <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const every = n > 8 ? 2 : 1;
  const labels = monthData.map((m, i) => (i % every ? '' : `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${m.date.toLocaleDateString(undefined, { month: 'short' })}</text>`)).join('');
  const peak = monthData.reduce((b, m, i) => (m.n > monthData[b].n ? i : b), 0);
  const colW = n === 1 ? W : (W - pad.l - pad.r) / (n - 1);
  const hits = monthData.map((m, i) => `<rect class="hit" data-i="${i}" x="${x(i) - colW / 2}" y="0" width="${colW}" height="${H}"/>`).join('');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Nights per month">
    <defs><linearGradient id="line-grad-live" gradientUnits="userSpaceOnUse" x1="${pad.l}" y1="0" x2="${W - pad.r}" y2="0">
      <stop offset="0" stop-color="#ff4fd8"/><stop offset=".55" stop-color="#a855f7"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    ${grid}
    <path class="area" d="${area}" fill="url(#area-grad)"/>
    <path class="line" d="${line}" stroke="url(#line-grad-live)"/>
    <line class="crosshair" x1="0" x2="0" y1="${pad.t - 6}" y2="${base}" hidden/>
    ${pts.map(([px, py], i) => `<circle class="dot" data-dot="${i}" cx="${px}" cy="${py}" r="4.5"/>`).join('')}
    <text class="peak" x="${pts[peak][0]}" y="${pts[peak][1] - 11}" text-anchor="middle">${monthData[peak].n}</text>
    ${labels}${hits}
  </svg>`;
}

$('#chart-months').addEventListener('pointermove', (e) => {
  const hit = e.target.closest('.hit');
  const svg = $('#chart-months svg');
  if (!hit || !svg) return hideTip();
  const i = Number(hit.dataset.i);
  const m = monthData[i];
  const dot = svg.querySelector(`[data-dot="${i}"]`);
  const cross = svg.querySelector('.crosshair');
  cross.removeAttribute('hidden');
  cross.setAttribute('x1', dot.getAttribute('cx'));
  cross.setAttribute('x2', dot.getAttribute('cx'));
  svg.querySelectorAll('.dot').forEach((d) => d.classList.toggle('on', d === dot));
  showTip(e, `<strong>${m.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
    <span>${m.n} night${m.n === 1 ? '' : 's'}</span>${m.stops.length ? `<span class="tip-sub">${stopNames(m.stops)}</span>` : ''}`);
});
$('#chart-months').addEventListener('pointerleave', () => {
  hideTip();
  $('#chart-months .crosshair')?.setAttribute('hidden', '');
  document.querySelectorAll('#chart-months .dot.on').forEach((d) => d.classList.remove('on'));
});
new ResizeObserver(() => { if (!$('#view-home').hidden) renderMonthChart(); }).observe($('#chart-months'));

const regionKey = (regions) => regions.map((c) => `<span class="key ${c}">${c}</span>`).join('');

let countryRows = [];
function renderCountryBars() {
  const byCountry = new Map();
  sortedStops().forEach((s) => {
    const name = s.country.trim() || 'Unknown';
    const row = byCountry.get(name.toLowerCase()) ?? { name, stop: s, nights: 0, stops: [] };
    row.nights += Math.max(0, daysBetween(s.arrive, s.depart));
    row.stops.push(s);
    byCountry.set(name.toLowerCase(), row);
  });
  let rows = [...byCountry.values()].filter((r) => r.nights > 0).sort((a, b) => b.nights - a.nights);
  // Show the top countries; the rest become one line of text instead of a giant bar.
  const rest = rows.length > 8 ? rows.slice(7) : [];
  if (rest.length) rows = rows.slice(0, 7);
  countryRows = rows;
  const max = Math.max(1, ...rows.map((r) => r.nights));
  $('#country-key').innerHTML = regionKey(CONTINENTS.filter((c) => rows.some((r) => r.stop?.continent === c)));
  $('#chart-countries').innerHTML = rows.length
    ? rows.map((r, i) => `
      <div class="bar-row" data-i="${i}">
        <span class="bar-label">${r.other ? '' : flagFor(r.stop)}${escapeHTML(r.name)}</span>
        <span class="bar-track"><span class="bar ${r.other ? 'other' : r.stop.continent}" style="width:${(r.nights / max) * 100}%"></span></span>
        <span class="bar-value">${r.nights}</span>
      </div>`).join('') + (rest.length
      ? `<p class="muted bars-more">+ ${rest.length} more countries · ${rest.reduce((n, r) => n + r.nights, 0)} nights (${rest.map((r) => escapeHTML(r.name)).join(', ')})</p>` : '')
    : '<p class="empty">No nights planned yet.</p>';
}
$('#chart-countries').addEventListener('pointermove', (e) => {
  const row = e.target.closest('.bar-row');
  if (!row) return hideTip();
  const r = countryRows[Number(row.dataset.i)];
  showTip(e, `<strong>${r.other ? '' : flagFor(r.stop)}${escapeHTML(r.name)}</strong>
    <span>${r.nights} night${r.nights === 1 ? '' : 's'}${r.other ? '' : ` · ${r.stop.continent}`}</span>
    <span class="tip-sub">${stopNames(r.stops)}</span>`);
});
$('#chart-countries').addEventListener('pointerleave', hideTip);

let calMonth = null; // 'YYYY-MM' shown in the calendar
function renderCalendar() {
  const months = tripMonths();
  const t = toISO(today());
  if (!months.some((m) => m.key === calMonth)) {
    calMonth = (months.find((m) => t.startsWith(m.key)) ?? (t < state.trip.start ? months[0] : months.at(-1)))?.key;
  }
  const i = months.findIndex((m) => m.key === calMonth);
  if (i < 0) return;
  const { date } = months[i];
  $('#cal-title').textContent = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#cal-prev').disabled = i === 0;
  $('#cal-next').disabled = i === months.length - 1;

  const nights = nightMap();
  const lead = (date.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const head = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="cal-dow">${d}</span>`).join('');
  const cells = Array.from({ length: lead }, () => '<span></span>');
  for (let d = 1; d <= days; d++) {
    const iso = `${calMonth}-${String(d).padStart(2, '0')}`;
    const s = nights.get(iso);
    const prev = nights.get(daysBefore(iso, 1));
    const inTrip = iso >= state.trip.start && iso <= state.trip.end;
    const cls = ['cal-day', s?.continent, s && 'stay', !s && inTrip && 'trip', iso === t && 'today', s && prev && prev !== s && 'move', s && iso < t && 'past']
      .filter(Boolean).join(' ');
    cells.push(`<button class="${cls}" data-day="${iso}"${s ? '' : ' tabindex="-1"'}>${d}</button>`);
  }
  $('#calendar').innerHTML = head + cells.join('');
  const regions = CONTINENTS.filter((c) => [...nights.values()].some((s) => s.continent === c && s.arrive.slice(0, 7) <= calMonth && s.depart.slice(0, 7) >= calMonth));
  $('#cal-key').innerHTML = `${regionKey(regions)}<span class="key move">Travel day</span>`;
}
$('#cal-prev').addEventListener('click', () => { const m = tripMonths(); calMonth = m[Math.max(0, m.findIndex((x) => x.key === calMonth) - 1)].key; renderCalendar(); });
$('#cal-next').addEventListener('click', () => { const m = tripMonths(); calMonth = m[Math.min(m.length - 1, m.findIndex((x) => x.key === calMonth) + 1)].key; renderCalendar(); });
$('#calendar').addEventListener('click', (e) => {
  const day = e.target.closest('.cal-day')?.dataset.day;
  const s = day && nightMap().get(day);
  if (s) { hideTip(); showStop(s.id); }
});
$('#calendar').addEventListener('pointermove', (e) => {
  const day = e.target.closest('.cal-day')?.dataset.day;
  if (!day) return hideTip();
  const nights = nightMap();
  const s = nights.get(day);
  const prev = nights.get(daysBefore(day, 1));
  const when = parseDate(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  showTip(e, `<strong>${when}</strong>${s ? `<span>${prev && prev !== s ? `${flagFor(prev)}${escapeHTML(prev.name)} → ` : ''}${flagFor(s)}${escapeHTML(s.name)}</span>`
    : `<span class="tip-sub">${day >= state.trip.start && day <= state.trip.end ? 'Travel / no stay planned' : 'Outside the trip'}</span>`}`);
});
$('#calendar').addEventListener('pointerleave', hideTip);

// ---------- Budget: a predicted trip cost, plus what you actually spend ----------
//
// The estimate uses typical daily costs (US$ per person) for a student
// traveler: shared apartments or private hostel rooms, eating out most meals,
// local transport and paid sights. It's adjusted by the budget answer in the
// travel profile, plus an estimate for each journey between stops.

const COUNTRY_COST = {
  ES: 80, PT: 70, MA: 45, IT: 95, CZ: 65, AT: 95, HU: 60, SI: 75, HR: 80, ME: 60, AL: 45,
  VN: 35, KH: 35, LA: 32, PH: 45, FR: 110, DE: 95, NL: 115, BE: 100, GR: 80, TR: 50, PL: 55,
  SK: 60, BA: 50, RS: 50, MK: 45, CH: 160, GB: 120, IE: 110, TH: 40, JP: 100, KR: 80, IN: 28,
  ID: 40, MY: 45, SG: 120, MX: 55, US: 150, CN: 55,
};
const REGION_COST = { Europe: 85, Africa: 45, Asia: 40 };
const EURO_ZONE = ['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PT', 'SK', 'SI', 'ES', 'ME', 'XK', 'AD', 'MC', 'SM', 'VA'];
const COUNTRY_CURRENCY = {
  MA: 'MAD', CZ: 'CZK', HU: 'HUF', AL: 'ALL', VN: 'VND', KH: 'USD', LA: 'LAK', PH: 'PHP', TR: 'TRY',
  PL: 'PLN', BA: 'BAM', RS: 'RSD', MK: 'MKD', CH: 'CHF', GB: 'GBP', TH: 'THB', JP: 'JPY', KR: 'KRW',
  IN: 'INR', ID: 'IDR', MY: 'MYR', SG: 'SGD', MX: 'MXN', US: 'USD', CA: 'CAD', CN: 'CNY',
};
// Approximate units per US$, used only until live rates have loaded once.
const FALLBACK_RATES = {
  USD: 1, EUR: 0.92, MAD: 10, CZK: 23, HUF: 360, ALL: 93, VND: 25400, KHR: 4100, LAK: 21500, PHP: 57,
  TRY: 34, PLN: 4, BAM: 1.8, RSD: 108, MKD: 57, CHF: 0.88, GBP: 0.78, THB: 35, JPY: 150, KRW: 1370,
  INR: 84, IDR: 15800, MYR: 4.5, SGD: 1.35, MXN: 18, CAD: 1.37, CNY: 7.2,
};
const DAILY_SPLIT = { stay: 0.42, food: 0.3, local: 0.1, fun: 0.18 };
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const usdShort = (n) => `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
const styleFactor = () => ({ Shoestring: 0.75, 'Happy to splurge sometimes': 1.35 }[state.profile.budget] ?? 1);
const currencyFor = (s) => {
  const code = s ? countryCodeOf(s) : '';
  return EURO_ZONE.includes(code) ? 'EUR' : COUNTRY_CURRENCY[code] || 'USD';
};
const dailyCost = (s) => (COUNTRY_COST[countryCodeOf(s)] ?? REGION_COST[s.continent] ?? 70) * styleFactor();

function travelMode(from, to, transport) {
  const mode = noEmoji(transport).toLowerCase();
  if (['plane', 'train', 'bus', 'ferry', 'car'].includes(mode)) return mode;
  return haversine(from, to) > 500 ? 'plane' : 'bus';
}
function journeyCost(from, to, transport) {
  const km = haversine(from, to);
  const mode = travelMode(from, to, transport);
  if (mode === 'train') return Math.max(15, km * 0.13);
  if (mode === 'bus') return Math.max(8, km * 0.06);
  if (mode === 'ferry') return 45;
  if (mode === 'car') return km * 0.12;
  return Math.max(60, 45 + km * 0.075);
}

function predictCost(stops, from = state.trip.home, backTo = state.trip.home) {
  const byCat = { stay: 0, food: 0, local: 0, fun: 0, travel: 0 };
  const rows = stops.map((s, i) => {
    const nights = Math.max(0, s.nights ?? daysBetween(s.arrive, s.depart));
    const daily = dailyCost(s);
    const prev = i ? stops[i - 1] : from;
    const travel = prev ? journeyCost(prev, s, s.transport) : 0;
    Object.entries(DAILY_SPLIT).forEach(([k, f]) => { byCat[k] += daily * nights * f; });
    byCat.travel += travel;
    return { stop: s, nights, daily, travel, cost: daily * nights + travel };
  });
  if (backTo && stops.length) byCat.travel += journeyCost(stops.at(-1), backTo, 'plane');
  return { rows, byCat, total: Object.values(byCat).reduce((a, b) => a + b, 0) };
}

// The whole-trip estimate: stops and travel, plus your one-off costs.
function tripEstimate() {
  const est = predictCost(sortedStops());
  const extras = state.money.extras.reduce((n, x) => n + x.usd, 0);
  if (extras) {
    est.byCat.extras = extras;
    est.total += extras;
  }
  return est;
}

const RATES_KEY = 'wanderlog-rates';
let liveRates = null;
try { liveRates = JSON.parse(localStorage.getItem(RATES_KEY))?.rates ? JSON.parse(localStorage.getItem(RATES_KEY)) : null; } catch { liveRates = null; }
const rateFor = (cur) => liveRates?.rates?.[cur] ?? FALLBACK_RATES[cur] ?? null;
async function refreshRates() {
  if (liveRates && Date.now() - liveRates.at < 12 * 3600e3) return;
  try {
    const r = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    if (r?.result !== 'success' || typeof r.rates !== 'object') return;
    const clean = {};
    Object.entries(r.rates).forEach(([k, v]) => { if (/^[A-Z]{3}$/.test(k) && Number(v) > 0) clean[k] = Number(v); });
    liveRates = { at: Date.now(), rates: clean };
    try { localStorage.setItem(RATES_KEY, JSON.stringify(liveRates)); } catch { /* private mode */ }
    updateExpensePreview();
  } catch { /* offline: keep the saved or built-in rates */ }
}

const stopOnDay = (day) => nightMap().get(day) ?? sortedStops().find((s) => s.depart === day) ?? null;
const expenseStop = (e) => state.stops.find((s) => s.id === e.stopId) ?? stopOnDay(e.date);

function renderBudget() {
  if (readOnly) return;
  const pred = tripEstimate();
  const { money } = state;
  const budget = money.budget ?? Math.round(pred.total);
  const spent = money.expenses.reduce((n, e) => n + e.usd, 0);
  const t = toISO(today());
  const { start, end } = state.trip;
  const before = t < start;
  const daysLeft = Math.max(0, daysBetween(before ? start : t, end));
  const left = budget - spent;
  const share = budget ? spent / budget : 0;
  const tip = left < 0
    ? `You're ${usd(-left)} over budget.`
    : daysLeft
      ? `That leaves about <strong>${usd(left / daysLeft)} a day</strong> for the ${before ? '' : 'remaining '}${daysLeft} days${before ? ' of the trip' : ''}.`
      : `${usd(left)} left.`;
  $('#budget-hero').innerHTML = `
    <span class="gauge-ring budget-ring">${ring(share, left < 0 ? 'warn' : '')}<span class="gauge-value">${Math.round(share * 100)}<small>%</small></span></span>
    <div class="budget-nums">
      <div class="budget-row"><span>Spent${before && spent ? ' (prepaid)' : ''}</span><strong>${usd(spent)}</strong></div>
      <div class="budget-row"><span>Budget</span><strong>${usd(budget)}</strong></div>
      <div class="budget-row ${left < 0 ? 'over' : ''}"><span>${left < 0 ? 'Over' : 'Left'}</span><strong>${usd(Math.abs(left))}</strong></div>
      <p class="budget-tip">${tip}</p>
    </div>`;
  const input = $('#budget-input');
  if (document.activeElement !== input) input.value = money.budget ?? '';
  input.placeholder = `${Math.round(pred.total)} (the estimate)`;

  $('#budget-estimate').textContent = usd(pred.total);
  $('#budget-style').innerHTML = `Based on <strong>${escapeHTML(state.profile.budget || 'Moderate')}</strong> spending (from your <button class="link" data-goto="profile">travel profile</button>).`;
  const catMax = Math.max(1, ...Object.values(pred.byCat));
  $('#budget-cats').innerHTML = Object.entries(pred.byCat).map(([k, v]) => `
    <div class="bar-row"><span class="bar-label">${EXPENSE_CATS[k]}</span>
      <span class="bar-track"><span class="bar neon" style="width:${(v / catMax) * 100}%"></span></span>
      <span class="bar-value wide">${usd(v)}</span></div>`).join('');

  // Each stop: the estimate (track) and what you've logged for it (fill).
  const spentBy = new Map();
  money.expenses.forEach((e) => { const s = expenseStop(e); if (s) spentBy.set(s.id, (spentBy.get(s.id) || 0) + e.usd); });
  const max = Math.max(1, ...pred.rows.map((r) => Math.max(r.cost, spentBy.get(r.stop.id) || 0)));
  $('#budget-stops').innerHTML = pred.rows.length ? pred.rows.map((r) => {
    const sp = spentBy.get(r.stop.id) || 0;
    return `<div class="bar-row stop-cost" title="${escapeHTML(r.stop.name)}: about ${usd(r.daily)}/day × ${r.nights} nights + ${usd(r.travel)} to get there">
      <span class="bar-label">${escapeHTML(r.stop.name)}</span>
      <span class="bar-track est" style="--est:${(r.cost / max) * 100}%"><span class="bar neon${sp > r.cost ? ' over' : ''}" style="width:${(sp / max) * 100}%"></span></span>
      <span class="bar-value wide">${sp ? `${usd(sp)} / ` : ''}${usd(r.cost)}</span></div>`;
  }).join('') : '<p class="empty">Add stops with dates to get an estimate.</p>';

  // The spending log, newest first.
  const list = $('#expense-list');
  const items = [...money.expenses].sort((a, b) => b.date.localeCompare(a.date) || 0);
  $('#expense-total').textContent = items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · ${usd(spent)}` : '';
  // Only rebuild the log when it changed, so a tap on × isn't lost to a redraw.
  const listKey = JSON.stringify(items.map((e) => [e.id, e.usd, e.note, expenseStop(e)?.name]));
  if (list.dataset.key === listKey) return finishBudgetForm(t);
  list.dataset.key = listKey;
  list.innerHTML = items.length ? '' : '<li class="empty">Nothing logged yet. Add what you spend above, in any currency.</li>';
  items.slice(0, 200).forEach((e) => {
    const s = expenseStop(e);
    const li = document.createElement('li');
    li.className = 'task expense';
    const orig = e.currency === 'USD' ? '' : ` · ${e.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${e.currency}`;
    li.innerHTML = `<span class="exp-cat">${EXPENSE_CATS[e.category].split(' ')[0]}</span>
      <div><div class="task-text">${escapeHTML(e.note || EXPENSE_CATS[e.category])}</div>
      <div class="task-meta">${fmtDate(e.date)}${s ? ` · ${escapeHTML(s.name)}` : ''}${orig}</div></div>
      <span class="exp-amt">${usd(e.usd)}<button class="task-x" aria-label="Delete">×</button></span>`;
    li.querySelector('.task-x').addEventListener('click', () => {
      state.money.expenses = state.money.expenses.filter((x) => x.id !== e.id);
      save();
      render();
    });
    list.appendChild(li);
  });
  finishBudgetForm(t);
}

// Form choices: currencies on this trip and the stops.
function finishBudgetForm(t) {
  const form = $('#expense-form').elements;
  const curs = [...new Set(['USD', 'EUR', ...sortedStops().map(currencyFor)])];
  if (form.currency.dataset.list !== curs.join()) {
    const keep = form.currency.value;
    form.currency.innerHTML = curs.map((c) => `<option>${c}</option>`).join('');
    form.currency.dataset.list = curs.join();
    if (curs.includes(keep)) form.currency.value = keep;
  }
  const stopOpts = `<option value="">Stop on that date</option>${sortedStops().map((s) => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)} · ${fmtDate(s.arrive)}</option>`).join('')}`;
  if (form.stop.dataset.list !== stopOpts) {
    const keep = form.stop.value;
    form.stop.innerHTML = stopOpts;
    form.stop.dataset.list = stopOpts;
    form.stop.value = keep;
  }
  if (!form.date.value) form.date.value = t;
  // The currency follows the stop on the chosen date, unless you picked one.
  if (!form.currency.dataset.manual) setExpenseDate(form.date.value);
  $('#budget-sql-note').hidden = !(user && !vault.key && serverVersion < 3);
  updateExpensePreview();
  renderExtras();
}

function renderExtras() {
  const { extras } = state.money;
  $('#extras-total').textContent = extras.length ? usd(extras.reduce((n, x) => n + x.usd, 0)) : '';
  const list = $('#extras-list');
  const key = JSON.stringify(extras);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = '';
  extras.forEach((x) => {
    const li = document.createElement('li');
    li.className = 'extra';
    li.innerHTML = `<span>${escapeHTML(x.name)}</span><span class="exp-amt">${usd(x.usd)}<button type="button" class="task-x" aria-label="Remove">×</button></span>`;
    li.querySelector('.task-x').addEventListener('click', () => {
      state.money.extras = state.money.extras.filter((y) => y.id !== x.id);
      save();
      render();
    });
    list.appendChild(li);
  });
}
$('#extras-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const amount = num(f.usd.value);
  if (!f.name.value.trim() || !(amount >= 0)) return;
  state.money.extras.push({ id: uid(), name: f.name.value.trim().slice(0, 80), usd: Math.round(amount * 100) / 100 });
  f.name.value = '';
  f.usd.value = '';
  save();
  render();
});

function setExpenseDate(day) {
  const form = $('#expense-form').elements;
  form.date.value = day;
  const cur = currencyFor(stopOnDay(day));
  if ([...form.currency.options].some((o) => o.value === cur)) form.currency.value = cur;
}
function updateExpensePreview() {
  const form = $('#expense-form')?.elements;
  if (!form) return;
  const amount = num(form.amount.value);
  const rate = rateFor(form.currency.value);
  $('#expense-preview').textContent = amount > 0 && form.currency.value !== 'USD' && rate
    ? `≈ ${usd(amount / rate)}${liveRates ? '' : ' (approximate rate until online)'}` : '';
}
$('#expense-form').addEventListener('input', (e) => {
  if (e.target.name === 'currency') e.target.dataset.manual = '1';
  if (e.target.name === 'date' && e.target.value) {
    delete e.target.form.elements.currency.dataset.manual;
    setExpenseDate(e.target.value);
  }
  updateExpensePreview();
});
$('#expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const amount = num(f.amount.value);
  const rate = rateFor(f.currency.value);
  if (!(amount > 0) || !rate) return;
  state.money.expenses.push({
    id: uid(), date: f.date.value || toISO(today()), amount, currency: f.currency.value,
    usd: Math.round((amount / rate) * 100) / 100, category: f.category.value, stopId: f.stop.value,
    note: f.note.value.trim().slice(0, 200),
  });
  f.amount.value = '';
  f.note.value = '';
  save();
  render();
  f.amount.focus();
});
$('#budget-input').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  state.money.budget = v === '' ? null : Math.max(0, Math.round(num(v)));
  save();
  render();
});

// ---------- Asia leg planner ----------
//
// Try different routes for the Southeast Asia leg, see how the nights,
// travel and cost add up, then put the one you like on the trip.

const ASIA_PLACES = {
  China: [['Chengdu', 30.5728, 104.0668, 'Giant pandas, Sichuan food, teahouses'],
    ['Kunming', 25.0389, 102.7183, '"Spring City", Stone Forest, train to Laos'],
    ['Dali', 25.6065, 100.2676, 'Old town by Erhai Lake, cycling'],
    ['Lijiang', 26.8721, 100.2299, 'Old town, Tiger Leaping Gorge hikes'],
    ['Yangshuo', 24.7781, 110.4964, 'Li River karst scenery, cycling, rafting'],
    ['Shanghai', 31.2304, 121.4737, 'The Bund, food, big-city energy'],
    ['Beijing', 39.9042, 116.4074, 'Great Wall, Forbidden City']],
  Thailand: [['Bangkok', 13.7563, 100.5018, 'Temples, street food, markets, rooftop views'],
    ['Chiang Mai', 18.7883, 98.9853, 'Old-city temples, night markets, cooking classes'],
    ['Chiang Rai', 19.9105, 99.8406, 'White Temple, gateway to the Laos border'],
    ['Chiang Khong', 20.2614, 100.4044, 'Mekong border town; cross to Huay Xai'],
    ['Koh Samui', 9.512, 100.0136, 'Gulf island beaches'],
    ['Koh Tao', 10.0956, 99.8404, 'Snorkeling and diving']],
  Vietnam: [['Ho Chi Minh City', 10.7769, 106.7009, 'Street food, Cu Chi tunnels, Mekong Delta day trips'],
    ['Da Lat', 11.9404, 108.4583, 'Cool highlands, waterfalls, canyoning'],
    ['Hoi An', 15.8801, 108.338, 'Lantern-lit old town, tailors, beaches by bike'],
    ['Hue', 16.4637, 107.5909, 'Imperial citadel and royal tombs'],
    ['Ninh Binh', 20.2506, 105.9745, 'River boat rides through karst cliffs'],
    ['Hanoi', 21.0278, 105.8342, 'Old Quarter, egg coffee, base for Ha Long'],
    ['Ha Long Bay', 20.9101, 107.1839, 'Overnight boat among limestone islands'],
    ['Sapa', 22.3364, 103.8438, 'Rice terraces and mountain treks']],
  Cambodia: [['Stung Treng', 13.5259, 105.9683, 'Mekong town by the Laos border'],
    ['Phnom Penh', 11.5564, 104.9282, 'Royal Palace, history museums, riverside'],
    ['Siem Reap', 13.3633, 103.8564, 'Angkor Wat temples at sunrise'],
    ['Kampot', 10.6104, 104.1815, 'Riverside town, pepper farms, Bokor mountain'],
    ['Koh Rong', 10.7105, 103.2394, 'Island beaches, glowing plankton at night']],
  Laos: [['Huay Xai', 20.2763, 100.4128, 'Border town; slow boat down the Mekong'],
    ['Luang Prabang', 19.8856, 102.1347, 'Temples, Kuang Si waterfalls, night market'],
    ['Vang Vieng', 18.9235, 102.4478, 'Tubing, caves, hot-air balloons'],
    ['Vientiane', 17.9757, 102.6331, 'Laid-back capital, Mekong sunsets'],
    ['Si Phan Don', 13.9661, 105.9203, '"4000 Islands": hammocks, cycling, Mekong falls']],
  Philippines: [['Manila', 14.5995, 120.9842, 'Intramuros, food scene, main flight hub'],
    ['El Nido', 11.1956, 119.4075, 'Island-hopping, lagoons, beaches'],
    ['Coron', 11.9986, 120.2043, 'Shipwreck snorkeling, Kayangan Lake'],
    ['Siargao', 9.8482, 126.0458, 'Surfing and an easygoing island scene'],
    ['Cebu', 10.3157, 123.8854, 'Canyoneering, waterfalls, whale sharks'],
    ['Bohol', 9.85, 124.1435, 'Chocolate Hills, tarsiers, Panglao beaches']],
};
const placeInfo = (name) => {
  for (const [country, list] of Object.entries(ASIA_PLACES)) {
    const p = list.find(([n]) => n === name);
    if (p) return { name: p[0], country, lat: p[1], lng: p[2], blurb: p[3] };
  }
  return null;
};
const ASIA_SEASON = {
  Thailand: 'April is the hottest month. Songkran, the Thai New Year water festival (Apr 13–15), is a huge nationwide party: expect water fights everywhere, closures and packed transport, so book rooms and buses ahead.',
  China: 'Spring is mild and pleasant in Yunnan and Sichuan. Avoid the May Day holiday (May 1–5), when trains and sights are packed. US passport holders can usually visit visa-free for up to 10 days when passing through to a third country (for example arriving from Europe and leaving for Laos), within approved regions and ports. Check the current rules before booking.',
  Vietnam: 'April–May is dry and hot in the center (Hoi An, Hue), which is great beach time. The north is pleasant in April and humid by May; the south\'s rains start mid-May. Apr 30 – May 1 holidays make domestic travel busy.',
  Cambodia: 'The hottest time of year (35°C+): see Angkor at sunrise and rest at midday. Khmer New Year (mid-April) brings closures and full buses. Rains begin in May.',
  Laos: 'Hot season, and March–April can be hazy from field burning in the north. Lao New Year (mid-April) is a huge water festival, especially in Luang Prabang, so book rooms ahead.',
  Philippines: 'Dry season runs through May: the best island-hopping weather, but very hot. Domestic flights and island transfers fill up, so book ahead.',
};
const ASIA_PRESETS = [
  { name: 'Your plan', note: 'Thailand → overland through Laos, Cambodia, Vietnam → Philippines',
    stops: [['Bangkok', 7], ['Chiang Khong', 2], ['Huay Xai', 1], ['Luang Prabang', 2], ['Vientiane', 1], ['Si Phan Don', 1],
      ['Stung Treng', 1], ['Siem Reap', 2], ['Phnom Penh', 1], ['Ho Chi Minh City', 3], ['Hoi An', 4], ['Hanoi', 3],
      ['Manila', 2], ['El Nido', 8]] },
  { name: 'China first', note: 'China → train to Laos → Cambodia → Vietnam → Philippines',
    stops: [['Chengdu', 3], ['Kunming', 2], ['Dali', 3], ['Luang Prabang', 4], ['Vang Vieng', 3], ['Siem Reap', 3], ['Phnom Penh', 2],
      ['Ho Chi Minh City', 3], ['Hoi An', 4], ['Hanoi', 3], ['El Nido', 5], ['Coron', 3], ['Manila', 2]] },
  { name: 'Slower pace', note: 'Fewer moves, longer stays',
    stops: [['Ho Chi Minh City', 4], ['Hoi An', 6], ['Siem Reap', 4], ['Luang Prabang', 6], ['El Nido', 8], ['Manila', 3]] },
  { name: 'More island time', note: 'Shorter mainland, longer Philippines',
    stops: [['Hoi An', 5], ['Hanoi', 3], ['Siem Reap', 3], ['Luang Prabang', 4], ['Siargao', 6], ['Bohol', 4], ['El Nido', 5], ['Manila', 2]] },
];

const asiaStops = () => sortedStops().filter((s) => s.continent === 'Asia');
function planWindow() {
  const plan = state.asiaPlan;
  const first = asiaStops()[0];
  const start = plan?.start || first?.arrive || toISO(addDays(parseDate(state.trip.end), -36));
  const end = plan?.end || state.trip.end;
  return { start, end: end > start ? end : state.trip.end };
}
function currentPlan() {
  if (!state.asiaPlan) {
    state.asiaPlan = {
      start: '', end: '',
      stops: asiaStops().map((s) => ({ name: s.name, country: s.country, lat: s.lat, lng: s.lng, nights: Math.max(1, daysBetween(s.arrive, s.depart)) })),
    };
  }
  return state.asiaPlan;
}
const RAIL_LAOS = ['Luang Prabang', 'Vang Vieng', 'Vientiane'];
function planMode(a, b) {
  const pair = [a.name, b.name].sort().join('|');
  if (pair === 'Huay Xai|Luang Prabang') return 'Ferry'; // the two-day Mekong slow boat
  // China's high-speed rail and the China–Laos railway (Kunming ↔ Luang Prabang ↔ Vientiane).
  const rail = (x) => x.country === 'China' || RAIL_LAOS.includes(x.name);
  if (rail(a) && rail(b) && haversine(a, b) < 1500) return 'Train';
  // Neighboring countries on the mainland are usually crossed overland.
  const mainland = ['Thailand', 'Laos', 'Cambodia', 'Vietnam'];
  if (a.country !== b.country && mainland.includes(a.country) && mainland.includes(b.country) && haversine(a, b) < 700) return 'Bus';
  if (a.country === b.country && a.country === 'Philippines') return haversine(a, b) > 150 ? 'Plane' : 'Ferry';
  return a.country !== b.country || haversine(a, b) > 450 ? 'Plane' : 'Bus';
}
function fitPlan() {
  const plan = currentPlan();
  const { start, end } = planWindow();
  const avail = daysBetween(start, end);
  const total = plan.stops.reduce((n, p) => n + p.nights, 0);
  if (!plan.stops.length || !total || avail < plan.stops.length) return;
  const exact = plan.stops.map((p) => (p.nights / total) * avail);
  plan.stops.forEach((p, i) => { p.nights = Math.max(1, Math.floor(exact[i])); });
  let diff = avail - plan.stops.reduce((n, p) => n + p.nights, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; diff !== 0 && k < 500; k++) {
    const i = order[k % order.length][1];
    if (diff > 0) { plan.stops[i].nights++; diff--; } else if (plan.stops[i].nights > 1) { plan.stops[i].nights--; diff++; }
  }
}

function renderPlanner() {
  if (readOnly) return;
  const plan = currentPlan();
  const { start, end } = planWindow();
  const avail = daysBetween(start, end);
  const planned = plan.stops.reduce((n, p) => n + p.nights, 0);
  const f = $('#plan-window').elements;
  if (document.activeElement !== f.start) f.start.value = start;
  if (document.activeElement !== f.end) f.end.value = end;
  const diff = avail - planned;
  $('#plan-fit-note').innerHTML = `<strong>${avail}</strong> nights available · <strong>${planned}</strong> planned${diff ? ` · <span class="${diff < 0 ? 'over' : ''}">${diff < 0 ? `${-diff} too many` : `${diff} unplanned`}</span>` : ' · fits exactly'}`;
  $('#plan-fit').hidden = !diff || !plan.stops.length;

  $('#plan-presets').innerHTML = ASIA_PRESETS.map((p, i) => `
    <button type="button" class="preset" data-preset="${i}"><strong>${p.name}</strong><span>${p.note} · ${p.stops.length} stops</span></button>`).join('')
    + '<button type="button" class="preset" data-preset="current"><strong>Current trip</strong><span>Start from the stops on your trip now</span></button>';

  const list = $('#plan-list');
  let cursor = parseDate(start);
  list.innerHTML = plan.stops.length ? '' : '<li class="empty">No places yet. Pick a starting route above or add places below.</li>';
  plan.stops.forEach((p, i) => {
    if (i > 0) {
      const prev = plan.stops[i - 1];
      const mode = planMode(prev, p);
      const leg = document.createElement('li');
      leg.className = 'leg';
      leg.innerHTML = `${transportIcon(mode)} ${mode} · ${Math.round(haversine(prev, p)).toLocaleString()} km`;
      list.appendChild(leg);
    }
    const arrive = toISO(cursor);
    cursor = addDays(cursor, p.nights);
    const info = placeInfo(p.name);
    const li = document.createElement('li');
    li.className = 'plan-row';
    li.dataset.i = i;
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="plan-body">
        <div class="title">${escapeHTML(p.name)} <span class="muted plan-country">${escapeHTML(p.country)}</span></div>
        <div class="meta">${fmtDate(arrive)} → ${fmtDate(toISO(cursor))}${info ? ` · ${escapeHTML(info.blurb)}` : ''}</div>
      </div>
      <div class="plan-ctrl">
        <div class="stepper"><button type="button" data-act="minus" aria-label="One night less">−</button><span>${p.nights}<small> n</small></span><button type="button" data-act="plus" aria-label="One night more">+</button></div>
        <button type="button" class="ghost" data-act="up" aria-label="Move earlier"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ghost" data-act="down" aria-label="Move later"${i === plan.stops.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ghost" data-act="remove" aria-label="Remove">×</button>
      </div>`;
    list.appendChild(li);
  });

  const add = $('#plan-add-place');
  if (!add.options.length) {
    add.innerHTML = Object.entries(ASIA_PLACES).map(([country, places]) => `<optgroup label="${country}">${places.map(([n]) => `<option>${n}</option>`).join('')}</optgroup>`).join('');
  }

  const legs = plan.stops.map((p) => ({ ...p, continent: 'Asia' }));
  legs.forEach((p, i) => { p.transport = i ? planMode(plan.stops[i - 1], p) : 'Plane'; });
  const lastEurope = sortedStops().filter((s) => s.continent !== 'Asia' && s.depart <= start).at(-1);
  const cost = predictCost(legs, lastEurope ?? state.trip.home, state.trip.home);
  const flights = legs.filter((p, i) => i && p.transport === 'Plane').length;
  const countries = [...new Set(plan.stops.map((p) => p.country))];
  $('#plan-summary').innerHTML = plan.stops.length
    ? `<div><span class="muted">Estimated cost</span><strong>${usd(cost.total)}</strong></div>
       <div><span class="muted">Countries</span><strong>${countries.length}</strong></div>
       <div><span class="muted">Flights inside Asia</span><strong>${flights}</strong></div>
       <div><span class="muted">Stops</span><strong>${plan.stops.length}</strong></div>` : '';
  $('#plan-season').innerHTML = countries.filter((c) => ASIA_SEASON[c])
    .map((c) => `<div class="season"><strong>${c}</strong><p>${ASIA_SEASON[c]}</p></div>`).join('')
    || '<p class="muted">Add places to see what to expect in April and May.</p>';
  $('#plan-apply').disabled = !plan.stops.length || diff < 0;
  $('#plan-apply-note').textContent = diff < 0 ? `Trim ${-diff} night${diff === -1 ? '' : 's'} (or tap Fit to dates) before putting this on your trip.` : '';
}

$('#plan-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('.plan-row');
  if (!btn || !row) return;
  const stops = currentPlan().stops;
  const i = Number(row.dataset.i);
  const act = btn.dataset.act;
  if (act === 'plus') stops[i].nights = Math.min(60, stops[i].nights + 1);
  if (act === 'minus') stops[i].nights = Math.max(1, stops[i].nights - 1);
  if (act === 'up' && i > 0) [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]];
  if (act === 'down' && i < stops.length - 1) [stops[i + 1], stops[i]] = [stops[i], stops[i + 1]];
  if (act === 'remove') stops.splice(i, 1);
  save();
  renderPlanner();
});
$('#plan-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  const plan = currentPlan();
  if (btn.dataset.preset === 'current') {
    const { start, end } = plan;
    state.asiaPlan = null;
    Object.assign(currentPlan(), { start, end });
  } else {
    plan.stops = ASIA_PRESETS[Number(btn.dataset.preset)].stops.map(([name, nights]) => {
      const p = placeInfo(name);
      return { name: p.name, country: p.country, lat: p.lat, lng: p.lng, nights };
    });
    fitPlan();
  }
  save();
  renderPlanner();
});
$('#plan-add').addEventListener('click', () => {
  const p = placeInfo($('#plan-add-place').value);
  if (!p) return;
  currentPlan().stops.push({ name: p.name, country: p.country, lat: p.lat, lng: p.lng, nights: 3 });
  save();
  renderPlanner();
});
$('#plan-window').addEventListener('change', (e) => {
  const f = e.currentTarget.elements;
  if (!f.start.value || !f.end.value || f.end.value <= f.start.value) return;
  Object.assign(currentPlan(), { start: f.start.value, end: f.end.value });
  save();
  renderPlanner();
});
$('#plan-fit').addEventListener('click', () => { fitPlan(); save(); renderPlanner(); });
$('#plan-apply').addEventListener('click', () => {
  const plan = currentPlan();
  const { start } = planWindow();
  const old = asiaStops().filter((s) => s.depart > start);
  const keep = old.filter((s) => s.status === 'booked');
  const replaced = old.length - keep.length;
  if (!confirm(`Put this ${plan.stops.length}-stop route on your trip as tentative stops?${replaced ? ` It replaces ${replaced} tentative Asia stop${replaced === 1 ? '' : 's'}.` : ''}${keep.length ? ` Booked stops (${keep.map((s) => s.name).join(', ')}) stay as they are.` : ''}`)) return;
  placePlanOnTrip(plan.stops, start);
  save();
  render(true);
  goTo('trip');
});

// Replace the tentative Asia stops from `start` on with planned places (booked stops stay).
function placePlanOnTrip(planStops, start) {
  const old = asiaStops().filter((s) => s.depart > start);
  const leg = old.find((s) => s.leg)?.leg || 'Southeast Asia';
  state.stops = state.stops.filter((s) => !(s.continent === 'Asia' && s.depart > start && s.status !== 'booked' && !isIdea(s)));
  let cursor = parseDate(start);
  planStops.forEach((p, i) => {
    const arrive = toISO(cursor);
    cursor = addDays(cursor, p.nights);
    state.stops.push({
      id: uid(), name: p.name, country: p.country, lat: p.lat, lng: p.lng, arrive, depart: toISO(cursor),
      continent: 'Asia', transport: i ? planMode(planStops[i - 1], p) : 'Plane', status: 'tentative',
      rating: 0, notes: '', photo: '', leg,
    });
  });
}

// ---------- Discover: free recommendations from Wikivoyage ----------
//
// Wikivoyage is the free, traveler-written guide (CC BY-SA). Its city
// articles list places as templates like {{see | name=... | content=...}}
// under See / Do / Eat / Drink / Buy. We read those lists through the public
// MediaWiki API (no key, no account) and rank them with the travel profile.

const WV_API = 'https://en.wikivoyage.org/w/api.php';
const WV_CACHE_DAYS = 7;
const LISTING_TYPES = ['see', 'do', 'eat', 'drink', 'buy'];
const TYPE_LABEL = { see: 'See', do: 'Do', eat: 'Eat', drink: 'Drink', buy: 'Shop' };
const discover = { stopId: null, place: '', listings: [], cat: 'all', shown: 20, loading: false, error: '' };

async function wvFetch(titles) {
  const url = `${WV_API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1` +
    `&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(titles.join('|'))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikivoyage responded ${res.status}`);
  const data = await res.json();
  return (data.query?.pages ?? [])
    .filter((p) => !p.missing && p.revisions)
    .map((p) => ({ title: p.title, text: p.revisions[0].slots.main.content }));
}

// Split a template body on top-level "|" (ignoring ones inside {{ }} or [[ ]]).
function templateParams(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let k = 0; k < body.length; k++) {
    const two = body.slice(k, k + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; k++; continue; }
    if (two === '}}' || two === ']]') { depth--; cur += two; k++; continue; }
    if (body[k] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[k];
  }
  parts.push(cur);
  const params = {};
  parts.slice(1).forEach((p) => {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  });
  return params;
}

// Wiki markup → plain text.
function cleanWiki(s = '') {
  let out = s;
  for (let i = 0; i < 3; i++) out = out.replace(/\{\{[^{}]*\}\}/g, ''); // nested templates
  return out
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]\s]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseListings(text, source) {
  const out = [];
  let heading = '';
  const re = /^(={2,4})\s*([^=\n]+?)\s*\1\s*$|\{\{\s*(see|do|eat|drink|buy|listing)\s*(?=[\n|}])/gim;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { heading = m[2]; continue; }
    // Find the matching "}}" for this template.
    let depth = 0;
    let j = m.index;
    for (; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') { depth++; j++; }
      else if (text[j] === '}' && text[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
    }
    const p = templateParams(text.slice(m.index + 2, j - 1));
    re.lastIndex = j + 1;
    let type = m[3].toLowerCase();
    if (type === 'listing') type = (p.type || '').toLowerCase();
    const name = cleanWiki(p.name);
    if (!LISTING_TYPES.includes(type) || !name) continue;
    out.push({
      type, name, source,
      section: heading,
      content: cleanWiki(p.content || p.description),
      alt: cleanWiki(p.alt),
      price: cleanWiki(p.price),
      hours: cleanWiki(p.hours),
      address: cleanWiki(p.address),
      url: /^https?:\/\//.test(p.url || '') ? p.url.trim() : '',
      lat: parseFloat(p.lat) || null,
      lng: parseFloat(p.long ?? p.lon) || null,
    });
  }
  return out;
}

// Load a city's listings (and its district pages, for big cities that
// split their listings by neighborhood). Cached in this browser for a week.
async function loadGuide(place) {
  const key = `wv:${place.toLowerCase()}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.at < WV_CACHE_DAYS * 86400000) return cached;
  } catch { /* no cache */ }

  const [page] = await wvFetch([place]);
  if (!page) return { title: place, listings: [], missing: true };
  let listings = parseListings(page.text, page.title);
  const core = listings.filter((l) => l.type !== 'buy').length;
  const escaped = page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const districts = [...new Set([...page.text.matchAll(new RegExp(`\\[\\[(${escaped}/[^\\]|#]+)`, 'g'))]
    .map((d) => d[1].trim()))].slice(0, 12);
  if (core < 15 && districts.length) {
    const pages = await wvFetch(districts);
    pages.forEach((d) => { listings = listings.concat(parseListings(d.text, d.title)); });
  }
  // The same place can appear on the city page and a district page.
  const seen = new Set();
  listings = listings.filter((l) => {
    const k = `${l.type}:${l.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const result = { at: Date.now(), title: page.title, listings };
  try { localStorage.setItem(key, JSON.stringify(result)); } catch { /* storage full: skip cache */ }
  return result;
}

// Which Wikivoyage article to use for a stop: the city in its name, else the
// city its notes say it's pinned at ("pinned at Lisbon", "Fly into Hanoi").
function guidePlaceFor(s) {
  if (s.guidePlace) return s.guidePlace;
  if (s.name.trim().toLowerCase() !== s.country.trim().toLowerCase()) return s.name;
  const m = (s.notes || '').match(/pinned at ([^).]+)/i) || (s.notes || '').match(/fly into ([A-Z][^.,]+)/i);
  return m ? m[1].trim() : s.name;
}

// ---- ranking by the travel profile ----

const INTEREST_MATCH = {
  'Food & restaurants': { types: ['eat'], words: ['restaurant', 'tapas', 'dish', 'cuisine', 'food', 'tasting'] },
  'Cafés': { words: ['café', 'cafe', 'coffee', 'bakery', 'pastry', 'pastéis', 'brunch'] },
  'Nightlife': { types: ['drink'], words: ['bar', 'club', 'nightlife', 'cocktail', 'party', 'late'] },
  'Live music': { words: ['music', 'jazz', 'fado', 'flamenco', 'concert', 'live band', 'dj', 'gig'] },
  'Festivals & events': { words: ['festival', 'carnival', 'fiesta', 'celebration', 'event', 'parade'] },
  'Museums & history': { words: ['museum', 'history', 'historic', 'castle', 'palace', 'ruins', 'fortress', 'archaeolog', 'medieval', 'roman'] },
  'Architecture': { words: ['cathedral', 'church', 'basilica', 'architecture', 'tower', 'mosque', 'temple', 'gaudí', 'gothic', 'baroque'] },
  'Art': { words: ['art', 'gallery', 'painting', 'mural', 'street art', 'exhibition'] },
  'Local culture': { words: ['traditional', 'local', 'craft', 'neighbourhood', 'neighborhood', 'souk', 'medina', 'cooking class'] },
  'Hiking & nature': { words: ['hike', 'hiking', 'trail', 'park', 'garden', 'mountain', 'nature', 'lake', 'waterfall', 'canyon', 'cave'] },
  'Beaches': { words: ['beach', 'coast', 'swim', 'island', 'bay'] },
  'Sports': { words: ['football', 'stadium', 'surf', 'bike', 'cycling', 'kayak', 'climb', 'dive', 'diving'] },
  'Markets & shopping': { types: ['buy'], words: ['market', 'shop', 'shopping', 'bazaar', 'souk', 'boutique'] },
  'Photography': { words: ['viewpoint', 'view', 'panoram', 'sunset', 'sunrise', 'miradouro', 'lookout', 'rooftop'] },
  'Wellness': { words: ['spa', 'bath', 'thermal', 'hammam', 'yoga', 'massage', 'hot spring'] },
};

function scoreListing(l, profile) {
  const text = `${l.name} ${l.alt} ${l.content} ${l.section}`.toLowerCase();
  const reasons = [];
  let score = l.type === 'see' || l.type === 'do' ? 1 : 0;
  if (l.content.length > 60) score += 0.5; // a real description usually means a notable place

  (profile.interests || []).forEach((interest) => {
    const rule = INTEREST_MATCH[interest];
    if (!rule) return;
    const hit = (rule.types || []).includes(l.type) || rule.words.some((w) => text.includes(w));
    if (hit) { score += 3; reasons.push(interest); }
  });
  if (profile.rhythm === 'Night owl' && (l.type === 'drink' || /\bnight|late\b/.test(text))) score += 1;
  if (profile.rhythm === 'Early bird' && /sunrise|morning|breakfast/.test(text)) score += 1;
  const tier = l.section.toLowerCase();
  if (profile.budget === 'Shoestring') {
    if (tier.includes('budget') || /\bfree\b/.test(text)) { score += 2; reasons.push('Budget-friendly'); }
    if (tier.includes('splurge')) score -= 2;
  }
  if (profile.budget === 'Happy to splurge sometimes' && tier.includes('splurge')) score += 1;
  if (profile.food === 'Try anything once' && l.type === 'eat' && /traditional|local|street food|market/.test(text)) score += 1;

  // Words from your goals and must-dos (e.g. "Sahara", "cooking class").
  const goalWords = `${profile.goals || ''} ${profile.mustDos || ''}`.toLowerCase()
    .split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 5);
  if (goalWords.some((w) => text.includes(w))) { score += 3; reasons.push('Your goals'); }

  return { score, reasons: [...new Set(reasons)] };
}

// ---- wishlist ----

const wishlistFor = (stopId) => state.wishlist.filter((w) => w.stopId === stopId);
const isSaved = (stopId, name) => state.wishlist.some((w) => w.stopId === stopId && w.name === name);

function toggleSaved(l) {
  const id = discover.stopId;
  if (isSaved(id, l.name)) {
    state.wishlist = state.wishlist.filter((w) => !(w.stopId === id && w.name === l.name));
  } else {
    state.wishlist.push({
      id: uid(), stopId: id, done: false,
      name: l.name, type: l.type, content: l.content, lat: l.lat, lng: l.lng, url: l.url,
      place: discover.place,
    });
  }
  save();
  render();
}

const mapsLink = (l, place) => l.lat && l.lng
  ? `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.name}, ${place}`)}`;

// ---- rendering ----

function discoverStops() {
  return sortedStops().filter((s) => s.depart >= toISO(today()));
}

function renderDiscover() {
  const stops = discoverStops().length ? discoverStops() : sortedStops();
  const select = $('#discover-stop');
  if (!stops.some((s) => s.id === discover.stopId)) discover.stopId = stops[0]?.id ?? null;
  select.innerHTML = stops.map((s) =>
    `<option value="${s.id}">${sortedStops().indexOf(s) + 1}. ${escapeHTML(s.name)} · ${fmtDate(s.arrive)} – ${fmtDate(s.depart)}</option>`
  ).join('');
  select.value = discover.stopId ?? '';
  const stop = state.stops.find((s) => s.id === discover.stopId);
  if (!stop) {
    $('#discover-status').hidden = false;
    $('#discover-status').textContent = 'Add some stops to your trip to get recommendations.';
    $('#discover-list').innerHTML = '';
    return;
  }
  if (document.activeElement !== $('#discover-place')) $('#discover-place').value = discover.place || guidePlaceFor(stop);
  $('#discover-profile-hint').hidden = profileAnswered() > 0;

  // Wishlist for this stop
  const wish = wishlistFor(stop.id);
  $('#wishlist-card').hidden = !wish.length;
  $('#wishlist-title').textContent = `★ Your wishlist for ${stop.name} · ${wish.filter((w) => w.done).length}/${wish.length} done`;
  const wl = $('#wishlist-list');
  wl.innerHTML = '';
  wish.forEach((w) => {
    const li = document.createElement('li');
    li.className = `task${w.done ? ' done' : ''}`;
    li.innerHTML = `
      <input type="checkbox" ${w.done ? 'checked' : ''} aria-label="Done" />
      <div class="task-body">
        <div class="task-text">${escapeHTML(w.name)}</div>
        <div class="task-meta">${TYPE_LABEL[w.type] ?? ''} · <a href="${mapsLink(w, w.place || stop.name)}" target="_blank" rel="noopener noreferrer">Map</a></div>
      </div>
      <button type="button" class="task-x" title="Remove">×</button>`;
    li.querySelector('input').addEventListener('change', (e) => {
      w.done = e.target.checked;
      save();
      render();
    });
    li.querySelector('.task-x').addEventListener('click', () => {
      state.wishlist = state.wishlist.filter((x) => x.id !== w.id);
      save();
      render();
    });
    wl.appendChild(li);
  });

  // Recommendations
  const status = $('#discover-status');
  const list = $('#discover-list');
  list.innerHTML = '';
  $('#discover-more').hidden = true;
  if (discover.loading) {
    status.hidden = false;
    status.textContent = `Finding things to do in ${discover.place}…`;
    return;
  }
  if (discover.error) {
    status.hidden = false;
    status.textContent = discover.error;
    return;
  }
  const ranked = discover.listings
    .filter((l) => discover.cat === 'all' || l.type === discover.cat)
    .map((l) => ({ l, ...scoreListing(l, state.profile) }))
    .sort((a, b) => b.score - a.score);
  status.hidden = ranked.length > 0;
  if (!ranked.length) status.textContent = 'Nothing listed in this category. Try another one.';

  ranked.slice(0, discover.shown).forEach(({ l, reasons }) => {
    const saved = isSaved(stop.id, l.name);
    const meta = [l.section && !LISTING_TYPES.includes(l.section.toLowerCase()) && l.section, l.price, l.hours]
      .filter(Boolean).map(escapeHTML).join(' · ');
    const li = document.createElement('li');
    li.className = 'rec';
    li.innerHTML = `
      <div class="rec-main">
        <div class="rec-top"><span class="rec-type">${TYPE_LABEL[l.type]}</span>
          ${reasons.length ? `<span class="match">✓ ${escapeHTML(reasons.slice(0, 2).join(' · '))}</span>` : ''}</div>
        <div class="rec-title">${escapeHTML(l.name)}</div>
        ${l.content ? `<p class="rec-text">${escapeHTML(l.content)}</p>` : ''}
        ${meta ? `<div class="rec-meta">${meta}</div>` : ''}
      </div>
      <div class="rec-actions">
        <button type="button" class="star${saved ? ' on' : ''}">${saved ? '★ Saved' : '☆ Save'}</button>
        <a class="button ghost small" href="${mapsLink(l, discover.place)}" target="_blank" rel="noopener noreferrer">Map</a>
        ${l.url ? `<a class="button ghost small" href="${escapeHTML(l.url)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}
      </div>`;
    li.querySelector('.star').addEventListener('click', () => toggleSaved(l));
    list.appendChild(li);
  });
  $('#discover-more').hidden = ranked.length <= discover.shown;
  $('#discover-source').href = `https://en.wikivoyage.org/wiki/${encodeURIComponent((discover.title || discover.place).replace(/ /g, '_'))}`;
}

async function loadDiscover(place) {
  if (!place) return;
  Object.assign(discover, { place, loading: true, error: '', listings: [], shown: 20 });
  renderDiscover();
  try {
    const guide = await loadGuide(place);
    if (discover.place !== place) return; // a newer search started meanwhile
    discover.title = guide.title;
    discover.listings = guide.listings;
    if (guide.missing) discover.error = `Wikivoyage doesn't have a guide called "${place}". Try a nearby city's name.`;
    else if (!guide.listings.length) discover.error = `The ${guide.title} guide doesn't list specific places yet. Try a nearby city.`;
  } catch (e) {
    console.warn(e);
    discover.error = "Couldn't reach Wikivoyage. Check your connection and try again.";
  }
  discover.loading = false;
  renderDiscover();
}

function openDiscover() {
  const stops = discoverStops().length ? discoverStops() : sortedStops();
  if (!stops.some((s) => s.id === discover.stopId)) discover.stopId = stops[0]?.id ?? null;
  const stop = state.stops.find((s) => s.id === discover.stopId);
  // Reload when the stop's city changed, or retry if the last attempt failed.
  if (stop && (discover.place !== guidePlaceFor(stop) || discover.error)) loadDiscover(guidePlaceFor(stop));
  else renderDiscover();
}

$('#discover-stop').addEventListener('change', (e) => {
  discover.stopId = e.target.value;
  const stop = state.stops.find((s) => s.id === discover.stopId);
  loadDiscover(guidePlaceFor(stop));
});
function searchDiscoverPlace() {
  const place = $('#discover-place').value.trim();
  const stop = state.stops.find((s) => s.id === discover.stopId);
  if (!place || !stop) return;
  // Remember the chosen city for this stop (e.g. "Porto" for Portugal).
  if (place !== guidePlaceFor(stop)) {
    stop.guidePlace = place;
    save();
  }
  loadDiscover(place);
}
$('#discover-go').addEventListener('click', searchDiscoverPlace);
$('#discover-place').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); searchDiscoverPlace(); }
});
document.querySelectorAll('#discover-filters .chip').forEach((chip) => chip.addEventListener('click', () => {
  document.querySelectorAll('#discover-filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
  discover.cat = chip.dataset.cat;
  discover.shown = 20;
  renderDiscover();
}));
$('#discover-more').addEventListener('click', () => {
  discover.shown += 20;
  renderDiscover();
});

// ---------- Profile: the travel-preferences quiz ----------

const PROFILE_QUESTIONS = [
  { key: 'rhythm', label: 'Early bird or night owl?', type: 'single',
    options: ['Early bird', 'Somewhere in between', 'Night owl'] },
  { key: 'interests', label: 'What do you love doing when you travel?', hint: 'Pick as many as you like.', type: 'multi',
    options: ['Food & restaurants', 'Cafés', 'Nightlife', 'Live music', 'Festivals & events', 'Museums & history',
      'Architecture', 'Art', 'Local culture', 'Hiking & nature', 'Beaches', 'Sports', 'Markets & shopping',
      'Photography', 'Wellness'] },
  { key: 'food', label: 'How adventurous are you with food?', type: 'single',
    options: ['Keep it familiar', 'Open to new things', 'Try anything once'] },
  { key: 'pace', label: 'What pace do you like?', type: 'single',
    options: ['Slow and deep', 'Balanced', 'See as much as possible'] },
  { key: 'budget', label: 'Day-to-day budget?', type: 'single',
    options: ['Shoestring', 'Moderate', 'Happy to splurge sometimes'] },
  { key: 'social', label: 'How do you like to spend your time?', type: 'single',
    options: ['With my travel crew', 'Meeting new people', 'Mix in some solo time'] },
  { key: 'diet', label: 'Any dietary needs or allergies?', type: 'text', placeholder: 'e.g. vegetarian, no shellfish' },
  { key: 'goals', label: 'What do you want to get out of this trip?', type: 'textarea',
    placeholder: 'e.g. get comfortable speaking Spanish, see the Sahara, make friends from other countries' },
  { key: 'mustDos', label: 'Anything you already know you have to do?', type: 'textarea',
    placeholder: 'e.g. a cooking class in Italy, the night markets in Hanoi' },
];

const profileAnswered = () => PROFILE_QUESTIONS.filter((q) => {
  const v = state.profile[q.key];
  return Array.isArray(v) ? v.length : v;
}).length;

function buildProfileForm() {
  const form = $('#profile-form');
  form.innerHTML = PROFILE_QUESTIONS.map((q) => {
    const field = q.type === 'text'
      ? `<input name="${q.key}" placeholder="${escapeHTML(q.placeholder)}" />`
      : q.type === 'textarea'
        ? `<textarea name="${q.key}" rows="3" placeholder="${escapeHTML(q.placeholder)}"></textarea>`
        : `<div class="opts">${q.options.map((o) => `
            <label class="opt"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="${q.key}" value="${escapeHTML(o)}" /><span>${escapeHTML(o)}</span></label>`).join('')}
          </div>`;
    return `<fieldset class="q">
      <legend>${escapeHTML(q.label)}${q.hint ? ` <span class="muted">${escapeHTML(q.hint)}</span>` : ''}</legend>
      ${field}
    </fieldset>`;
  }).join('');

  let savedTimer;
  form.addEventListener('input', () => {
    const f = form.elements;
    const profile = {};
    PROFILE_QUESTIONS.forEach((q) => {
      if (q.type === 'multi') profile[q.key] = [...form.querySelectorAll(`[name="${q.key}"]:checked`)].map((i) => i.value);
      else if (q.type === 'single') profile[q.key] = form.querySelector(`[name="${q.key}"]:checked`)?.value ?? '';
      else profile[q.key] = f[q.key].value;
    });
    state.profile = profile;
    save();
    renderHome();
    $('#profile-saved').hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('#profile-saved').hidden = true; }, 1500);
  });
}

// Fill the quiz from saved answers (e.g. after syncing from another device),
// without touching the field you're typing in.
function renderProfile() {
  const form = $('#profile-form');
  PROFILE_QUESTIONS.forEach((q) => {
    const v = state.profile[q.key];
    if (q.type === 'text' || q.type === 'textarea') {
      const el = form.elements[q.key];
      if (el !== document.activeElement) el.value = v ?? '';
    } else {
      form.querySelectorAll(`[name="${q.key}"]`).forEach((i) => {
        i.checked = Array.isArray(v) ? v.includes(i.value) : v === i.value;
      });
    }
  });
}
buildProfileForm();

// ---------- add / edit booking dialog ----------

const bookingDialog = $('#booking-dialog');
const bookingForm = $('#booking-form');
let editingBookingId = null;

function syncBookingLabels() {
  const t = BOOKING_TYPES[bookingForm.elements.type.value];
  $('#booking-start-label').textContent = t.start;
  $('#booking-end-label').textContent = t.end;
}
bookingForm.elements.type.addEventListener('change', syncBookingLabels);

function openBookingDialog(b) {
  if (readOnly) return;
  editingBookingId = b?.id ?? null;
  bookingForm.reset();
  $('#booking-dialog-title').textContent = b ? 'Edit booking' : 'Add booking';
  $('#btn-delete-booking').hidden = !b;
  bookingForm.elements.stopId.innerHTML =
    '<option value="">Auto (match by date)</option>' +
    sortedStops().map((s, i) =>
      `<option value="${s.id}">${i + 1}. ${escapeHTML(s.name)} (${fmtDate(s.arrive)} – ${fmtDate(s.depart)})</option>`
    ).join('');
  const data = b ?? { type: 'flight' };
  for (const [k, v] of Object.entries(data)) {
    if (bookingForm.elements[k]) bookingForm.elements[k].value = v ?? '';
  }
  syncBookingLabels();
  bookingDialog.showModal();
}

$('#btn-add-booking').addEventListener('click', () => openBookingDialog(null));
$('#btn-cancel-booking').addEventListener('click', () => bookingDialog.close());

$('#btn-delete-booking').addEventListener('click', () => {
  if (!confirm('Delete this booking?')) return;
  state.bookings = state.bookings.filter((b) => b.id !== editingBookingId);
  save();
  bookingDialog.close();
  render();
});

bookingForm.addEventListener('submit', (e) => {
  const f = bookingForm.elements;
  if (f.end.value && f.end.value < f.start.value) {
    e.preventDefault();
    alert(`${$('#booking-end-label').textContent} must be after ${$('#booking-start-label').textContent.toLowerCase()}.`);
    return;
  }
  const field = (k) => f[k].value.trim();
  const booking = {
    id: editingBookingId ?? uid(),
    type: f.type.value,
    title: field('title'),
    start: f.start.value,
    end: f.end.value,
    provider: field('provider'),
    confirmation: field('confirmation'),
    details: field('details'),
    address: field('address'),
    link: field('link'),
    notes: field('notes'),
    stopId: f.stopId.value || autoStopId(f.type.value, f.start.value, f.end.value),
  };
  const idx = state.bookings.findIndex((b) => b.id === booking.id);
  if (idx >= 0) state.bookings[idx] = booking;
  else state.bookings.push(booking);
  save();
  render();
});

// ---------- add / edit stop dialog ----------

const stopDialog = $('#stop-dialog');
const stopForm = $('#stop-form');
let editingId = null;

function setStars(n) {
  stopForm.elements.rating.value = n;
  document.querySelectorAll('#star-input button').forEach((b, i) =>
    b.classList.toggle('on', i < n)
  );
}

$('#star-input').innerHTML = [1, 2, 3, 4, 5]
  .map((n) => `<button type="button" data-n="${n}" aria-label="${n} stars">★</button>`)
  .join('');
$('#star-input').addEventListener('click', (e) => {
  const n = Number(e.target.dataset.n);
  if (n) setStars(Number(stopForm.elements.rating.value) === n ? 0 : n);
});

function openStopDialog(stop, preset = {}) {
  if (readOnly) return;
  editingId = stop?.id ?? null;
  stopForm.reset();
  $('#search-results').innerHTML = '';
  $('#stop-dialog-title').textContent = stop ? 'Edit stop' : 'Add stop';
  $('#btn-delete').hidden = !stop;

  const last = sortedStops().at(-1);
  const data = stop ?? {
    status: 'tentative',
    leg: last?.leg ?? '',
    continent: last?.continent ?? 'Europe',
    ...defaultDates(),
    ...preset,
  };
  if (!stop && preset.lng != null) data.continent = guessContinent(preset.lat, preset.lng);

  for (const [k, v] of Object.entries(data)) {
    if (stopForm.elements[k] && k !== 'rating') stopForm.elements[k].value = v ?? '';
  }
  setStars(data.rating || 0);
  syncDateFields();
  // Shortening or lengthening a stop can push the rest of the trip along with it.
  $('#shift-later-row').hidden = !(stop && !isIdea(stop) && sortedStops().some((s) => s.id !== stop.id && s.arrive >= stop.depart));
  stopForm.elements.shiftLater.checked = true;
  stopDialog.showModal();
  if (!stop && preset.lat == null) $('#place-search').focus();
}

// New stops start where the last dated stop ended.
function defaultDates() {
  const last = sortedStops().at(-1);
  const arrive = last ? last.depart : state.trip.start;
  return { arrive, depart: toISO(addDays(parseDate(arrive), 3)) };
}

// Ideas don't need dates, so hide the date fields for them.
function syncDateFields() {
  const f = stopForm.elements;
  const idea = f.status.value === 'idea';
  document.querySelectorAll('.date-field').forEach((el) => { el.hidden = idea; });
  f.arrive.required = f.depart.required = !idea;
  if (!idea && !f.arrive.value) {
    const d = defaultDates();
    f.arrive.value = d.arrive;
    f.depart.value = d.depart;
  }
}
stopForm.elements.status.addEventListener('change', syncDateFields);

$('#btn-add').addEventListener('click', () => openStopDialog(null));
$('#btn-cancel').addEventListener('click', () => stopDialog.close());

$('#btn-delete').addEventListener('click', () => {
  if (!confirm('Delete this stop?')) return;
  state.stops = state.stops.filter((s) => s.id !== editingId);
  save();
  stopDialog.close();
  render();
});

stopForm.addEventListener('submit', (e) => {
  const f = stopForm.elements;
  const idea = f.status.value === 'idea';
  if (!idea && f.depart.value < f.arrive.value) {
    e.preventDefault();
    alert('Depart date must be on or after arrive date.');
    return;
  }
  const stop = {
    id: editingId ?? uid(),
    name: f.name.value.trim(),
    country: f.country.value.trim(),
    lat: Number(f.lat.value),
    lng: Number(f.lng.value),
    status: f.status.value,
    leg: f.leg.value.trim(),
    arrive: idea ? '' : f.arrive.value,
    depart: idea ? '' : f.depart.value,
    continent: f.continent.value,
    transport: f.transport.value,
    rating: Number(f.rating.value),
    notes: f.notes.value.trim(),
    photo: f.photo.value.trim(),
    countryCode: f.countryCode.value,
  };
  const idx = state.stops.findIndex((s) => s.id === stop.id);
  const before = idx >= 0 ? state.stops[idx] : null;
  if (before && !isIdea(before) && !idea && !$('#shift-later-row').hidden && f.shiftLater.checked) {
    shiftStopsAfter(before.depart, daysBetween(before.depart, stop.depart), stop.id);
  }
  if (idx >= 0) state.stops[idx] = stop;
  else state.stops.push(stop);
  save();
  render(idx < 0);
});

// Move every dated stop that starts on/after `from` by `delta` days.
function shiftStopsAfter(from, delta, exceptId) {
  if (!delta) return;
  state.stops.forEach((s) => {
    if (s.id === exceptId || isIdea(s) || s.arrive < from) return;
    s.arrive = toISO(addDays(parseDate(s.arrive), delta));
    s.depart = toISO(addDays(parseDate(s.depart), delta));
  });
}

// ---------- place search (OpenStreetMap Nominatim, free, no key) ----------

async function searchPlaces() {
  const q = $('#place-search').value.trim();
  const results = $('#search-results');
  if (!q) return;
  results.innerHTML = '<li class="muted">Searching…</li>';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    const data = await (await fetch(url)).json();
    if (!data.length) {
      results.innerHTML = '<li class="muted">No matches — try another spelling, or click the map.</li>';
      return;
    }
    results.innerHTML = '';
    data.forEach((place) => {
      const li = document.createElement('li');
      li.textContent = place.display_name;
      li.addEventListener('click', () => applyPlace(place));
      results.appendChild(li);
    });
  } catch {
    results.innerHTML = '<li class="muted">Search unavailable — enter coordinates or click the map.</li>';
  }
}

function applyPlace(place) {
  const a = place.address || {};
  stopForm.elements.name.value = a.city || a.town || a.village || a.state || place.name || place.display_name.split(',')[0];
  stopForm.elements.country.value = a.country || '';
  stopForm.elements.countryCode.value = a.country_code || '';
  stopForm.elements.lat.value = Number(place.lat).toFixed(4);
  stopForm.elements.lng.value = Number(place.lon).toFixed(4);
  stopForm.elements.continent.value = guessContinent(Number(place.lat), Number(place.lon));
  $('#search-results').innerHTML = '';
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`;
    const place = await (await fetch(url)).json();
    if (place && !place.error) applyPlace({ ...place, lat, lon: lng });
  } catch { /* user can type it in */ }
}

$('#btn-search').addEventListener('click', searchPlaces);
$('#place-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); searchPlaces(); }
});

// ---------- "⋯" menu (trip settings, export, import) ----------

const moreMenu = $('#more-menu');
function setMenu(open) {
  moreMenu.hidden = !open;
  $('#btn-more').setAttribute('aria-expanded', String(open));
}
$('#btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(moreMenu.hidden);
});
moreMenu.addEventListener('click', (e) => { if (e.target.closest('button')) setMenu(false); });
$('#file-import').addEventListener('change', () => setMenu(false));
document.addEventListener('click', (e) => { if (!e.target.closest('.more')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

// ---------- trip settings ----------

const settingsDialog = $('#settings-dialog');
const settingsForm = $('#settings-form');

$('#btn-settings').addEventListener('click', () => {
  settingsForm.elements.name.value = state.trip.name;
  settingsForm.elements.start.value = state.trip.start;
  settingsForm.elements.end.value = state.trip.end;
  const home = state.trip.home;
  settingsForm.elements.homeName.value = home?.name ?? '';
  settingsForm.elements.homeLat.value = home?.lat ?? '';
  settingsForm.elements.homeLng.value = home?.lng ?? '';
  settingsDialog.showModal();
});
$('#btn-settings-cancel').addEventListener('click', () => settingsDialog.close());
settingsForm.addEventListener('submit', () => {
  const f = settingsForm.elements;
  // Home is optional: the route starts and ends there when it's set.
  const hasHome = f.homeName.value.trim() && f.homeLat.value !== '' && f.homeLng.value !== '';
  state.trip = {
    name: f.name.value.trim(),
    start: f.start.value,
    end: f.end.value,
    home: hasHome
      ? { name: f.homeName.value.trim(), lat: Number(f.homeLat.value), lng: Number(f.homeLng.value) }
      : null,
  };
  save();
  render();
});

function replaceTrip(newState, label) {
  if (state.stops.length && !confirm(`Replace your current stops with ${label}?`)) return;
  state = migrate(newState);
  save();
  settingsDialog.close();
  render(true);
}
$('#btn-demo').addEventListener('click', () => replaceTrip(sampleTrip(), 'the sample trip'));

// ---------- export / import ----------

$('#btn-export').addEventListener('click', () => {
  if (encryptionOn() && !confirm('This backup file is NOT encrypted: anyone who opens it can read your trip. Keep it somewhere private. Download it?')) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wanderlog-${toISO(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.trip || !Array.isArray(data.stops)) throw new Error('bad format');
    state = migrate(data);
    save();
    render(true);
  } catch {
    alert("That file doesn't look like a Wanderlog backup.");
  }
  e.target.value = '';
});

// ---------- sample data ----------

function sampleTrip() {
  // Start 40 days ago so the demo shows a trip in progress.
  const start = addDays(today(), -40);
  let cursor = start;
  const leg = (name, country, lat, lng, nights, continent, transport, extra = {}) => {
    const arrive = toISO(cursor);
    cursor = addDays(cursor, nights);
    return { id: uid(), name, country, lat, lng, arrive, depart: toISO(cursor), continent, transport, status: 'booked', rating: 0, notes: '', photo: '', ...extra };
  };
  const stops = [
      leg('Lisbon', 'Portugal', 38.7223, -9.1393, 5, 'Europe', 'Plane', { rating: 5, notes: 'Pastéis de nata every morning. Sunset at Miradouro da Senhora do Monte.' }),
      leg('Barcelona', 'Spain', 41.3874, 2.1686, 5, 'Europe', 'Plane', { rating: 4, notes: 'Sagrada Família blew my mind.' }),
      leg('Paris', 'France', 48.8566, 2.3522, 4, 'Europe', 'Train', { rating: 4 }),
      leg('Amsterdam', 'Netherlands', 52.3676, 4.9041, 4, 'Europe', 'Train', { rating: 4, notes: 'Biked everywhere.' }),
      leg('Berlin', 'Germany', 52.52, 13.405, 5, 'Europe', 'Train', { rating: 5 }),
      leg('Prague', 'Czechia', 50.0755, 14.4378, 4, 'Europe', 'Bus', { rating: 4 }),
      leg('Vienna', 'Austria', 48.2082, 16.3738, 3, 'Europe', 'Train', { rating: 3 }),
      leg('Budapest', 'Hungary', 47.4979, 19.0402, 5, 'Europe', 'Train', { notes: 'Thermal baths tomorrow!' }),
      leg('Istanbul', 'Türkiye', 41.0082, 28.9784, 6, 'Europe', 'Plane'),
      leg('Delhi', 'India', 28.6139, 77.209, 4, 'Asia', 'Plane'),
      leg('Jaipur', 'India', 26.9124, 75.7873, 3, 'Asia', 'Train'),
      leg('Bangkok', 'Thailand', 13.7563, 100.5018, 6, 'Asia', 'Plane'),
      leg('Chiang Mai', 'Thailand', 18.7883, 98.9853, 6, 'Asia', 'Train'),
      leg('Hanoi', 'Vietnam', 21.0278, 105.8342, 5, 'Asia', 'Plane'),
      leg('Hoi An', 'Vietnam', 15.8801, 108.338, 5, 'Asia', 'Train'),
      leg('Seoul', 'South Korea', 37.5665, 126.978, 7, 'Asia', 'Plane'),
      leg('Tokyo', 'Japan', 35.6762, 139.6503, 8, 'Asia', 'Plane'),
      leg('Kyoto', 'Japan', 35.0116, 135.7681, 5, 'Asia', 'Train'),
  ];
  const istanbul = stops[8];
  const delhi = stops[9];
  const booking = (type, title, startTime, endTime, stop, extra) => ({
    id: uid(), type, title, start: startTime, end: endTime, stopId: stop.id,
    provider: '', confirmation: '', details: '', address: '', link: '', notes: '', ...extra,
  });
  return {
    trip: { name: 'Sample: Europe & Asia', start: toISO(start), end: toISO(addDays(start, 137)), home: null },
    stops,
    bookings: [
      booking('stay', 'Hostel in Sultanahmet', `${istanbul.arrive}T15:00`, `${istanbul.depart}T11:00`, istanbul, {
        provider: 'Hostelworld', confirmation: 'HW-48213', address: 'Sultanahmet, Istanbul',
      }),
      booking('flight', 'Istanbul → Delhi', `${istanbul.depart}T14:10`, `${delhi.arrive}T22:55`, delhi, {
        provider: 'Turkish Airlines', confirmation: 'TK7Q2P', details: 'TK 716 · Seat 31A · Istanbul Airport (IST)',
        notes: '1 checked bag included. Online check-in opens 24h before.',
      }),
    ],
  };
}

// ---------- cloud sync (Supabase, optional) ----------

const PENDING_KEY = 'wanderlog-pending'; // set while this device has edits the cloud hasn't seen
const TRIP_ID_KEY = 'wanderlog-trip-id';
const cfg = window.WANDERLOG_CONFIG || {};
const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : null;

let user = null;
let turningOff = false; // the user chose to turn encryption off, so a readable upload may replace the encrypted copy
let serverVersion = 0; // which supabase/*-update.sql files the database has
let serverReady = false; // the database has the encryption update (share_data column)
async function checkServer() {
  try {
    const { data: version } = await sb.rpc('wanderlog_schema_version');
    serverVersion = Number(version) || 0;
    serverReady = serverVersion >= 2;
  } catch {
    serverReady = false; // offline: checked again on the next sign-in or reload
  }
}
let trip = null;         // { id, owner_id, share_token } of the cloud trip this device follows
let busy = false;        // a sync is in flight
let editVersion = 0;     // bumps on every local edit
let lastCloudUpdate = null;
let uploadTimer = null;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* nothing to do */ }
}
const hasPending = () => storageGet(PENDING_KEY) === '1';
const setPending = (on) => storageSet(PENDING_KEY, on ? '1' : null);

function rememberTrip(t) {
  trip = t;
  storageSet(TRIP_ID_KEY, t?.id ?? null);
}

// The database may reorder object keys, so compare trips with sorted keys.
function sameTrip(a, b) {
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const SYNC_LABELS = {
  'signed-out': ['Sign in to sync', ''],
  saving: ['Saving…', ''],
  synced: ['Synced', 'synced'],
  offline: ['Offline — will sync', 'problem'],
  error: ['Sync problem', 'problem'],
};

function setSyncState(name) {
  const [label, cls] = SYNC_LABELS[name];
  const btn = $('#btn-sync');
  // Icon stays visible on phones; the words hide on narrow screens.
  btn.innerHTML = `${icon(name === 'error' ? 'alert' : 'cloud')} <span class="label">${label}</span>`;
  btn.title = label;
  btn.className = `ghost ${cls}`;
  $('#btn-share').hidden = !user;
  $('#auth-status').textContent = {
    saving: 'Saving your latest changes…',
    synced: 'All changes are saved to your account.',
    offline: "You're offline. Changes are saved on this device and will upload when you're back online.",
    error: "Couldn't reach the server. Changes are saved on this device; try Sync now.",
  }[name] ?? '';
}

function syncFailed(e) {
  console.warn('Sync failed', e);
  setSyncState(navigator.onLine ? 'error' : 'offline');
}

// The trip this account follows: the one used last on this device, otherwise
// the most recently updated trip it owns or was added to as an editor.
async function fetchCloudTrip() {
  const { data, error } = await sb.from('trips')
    .select('id, owner_id, share_token, data, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const lastUsed = storageGet(TRIP_ID_KEY);
  return data.find((t) => t.id === lastUsed) ?? data[0] ?? null;
}

async function uploadTrip() {
  if (isLocked()) return; // nothing to upload until the trip is unlocked
  const version = editVersion;
  const row = { data: state, updated_at: new Date().toISOString() };
  if (vault.key) {
    row.data = await sealTrip(state);
    row.share_data = state.shareKey
      ? await sealWith(await shareCryptoKey(state.shareKey), familySnapshot(state))
      : null;
  } else if (serverReady) {
    row.share_data = null; // the database filters the readable trip for the family link
  }
  setSyncState('saving');
  const cols = 'id, owner_id, share_token';
  // After a reload only the trip's id is known, so fall back to the saved one.
  const id = trip?.id ?? storageGet(TRIP_ID_KEY);
  // Safety: if the trip in the cloud is encrypted and this device isn't
  // unlocked, never replace it with a readable copy.
  if (!vault.key && id && !turningOff) {
    const { data: current } = await sb.from('trips').select('enc:data->enc').eq('id', id).maybeSingle();
    if (current?.enc) {
      setPending(false); // the encrypted cloud copy wins; it opens once unlocked
      return 'cloud-sealed';
    }
  }
  let result = id
    ? await sb.from('trips').update(row).eq('id', id).select(cols).single()
    : null;
  // No trip yet, or it's gone (deleted, or no longer shared with us): start one.
  if (!result || result.error?.code === 'PGRST116') {
    result = await sb.from('trips').insert(row).select(cols).single();
  }
  const { data, error } = result;
  if (error) throw error;
  rememberTrip(data);
  lastCloudUpdate = row.updated_at;
  if (!vault.key) turningOff = false; // the readable copy is now in the cloud
  // Only clear the flag if nothing changed while we were uploading.
  if (version === editVersion) {
    setPending(false);
    setSyncState('synced');
  }
}

// Called after every edit: upload shortly after the user stops typing.
function queueUpload() {
  if (!user) return;
  editVersion++;
  setPending(true);
  setSyncState('saving');
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    if (busy) return queueUpload();
    busy = true;
    let result;
    try { result = await uploadTrip(); } catch (e) { syncFailed(e); } finally { busy = false; }
    if (result === 'cloud-sealed') reconcile(); // fetch and open (or ask to unlock) the encrypted copy
  }, 800);
}

// Make this device and the cloud agree. Unsynced edits here win; otherwise
// the cloud copy (possibly edited on another device or by a travel partner)
// replaces this one.
async function reconcile({ justSignedIn = false } = {}) {
  if (!user || busy) return;
  busy = true;
  try {
    if (hasPending() && !isLocked() && (await uploadTrip()) !== 'cloud-sealed') return;

    const cloud = await fetchCloudTrip();
    if (!cloud) {
      rememberTrip(null);
      if (state.stops.length) await uploadTrip();
      else setSyncState('synced');
      return;
    }
    rememberTrip(cloud);
    if (lastCloudUpdate && Date.parse(cloud.updated_at) === Date.parse(lastCloudUpdate)) {
      return setSyncState('synced');
    }
    const cloudTrip = await openCloudTrip(cloud.data);
    if (!cloudTrip) return setSyncState('synced'); // encrypted: waiting for the passphrase
    if (!sameTrip(cloudTrip, state)) {
      const keepThisDevice = justSignedIn && state.stops.length && !confirm(
        `Your account already has a trip ("${cloudTrip.trip.name}", ${cloudTrip.stops.length} stops).\n\n` +
        `OK: show that trip on this device.\n` +
        `Cancel: replace it with the trip on this device ("${state.trip.name}", ${state.stops.length} stops).`
      );
      if (keepThisDevice) return await uploadTrip();
      state = migrate(cloudTrip);
      saveLocal();
      render(justSignedIn);
    }
    lastCloudUpdate = cloud.updated_at;
    setSyncState('synced');
  } catch (e) {
    syncFailed(e);
  } finally {
    busy = false;
  }
}

// ---------- sign in / out ----------

const authDialog = $('#auth-dialog');
const authForm = $('#auth-form');

function showError(id, msg) {
  $(id).textContent = msg;
  $(id).hidden = !msg;
}

$('#btn-sync').addEventListener('click', () => {
  $('#auth-signed-out').hidden = !!user;
  $('#auth-signed-in').hidden = !user;
  $('#auth-email').textContent = user?.email ?? '';
  showError('#auth-error', '');
  authDialog.showModal();
});
$('#btn-auth-cancel').addEventListener('click', () => authDialog.close());
$('#btn-auth-close').addEventListener('click', () => authDialog.close());
$('#btn-sync-now').addEventListener('click', () => reconcile());

async function signIn(create) {
  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  if (!email || !password) return showError('#auth-error', 'Enter your email and a password.');
  if (create && password.length < 8) return showError('#auth-error', 'Use a password of at least 8 characters.');
  showError('#auth-error', '');
  try {
    const { data, error } = create
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) return showError('#auth-error', error.message);
    if (!data.session) {
      return showError('#auth-error', 'Almost done: check your email and click the confirmation link. It brings you back here signed in.');
    }
    user = data.session.user;
    authForm.elements.password.value = '';
    authDialog.close();
    await checkServer();
    await reconcile({ justSignedIn: true });
  } catch (e) {
    showError('#auth-error', "Couldn't reach the server. Check your connection and try again.");
  }
}

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  signIn(false);
});
$('#btn-signup').addEventListener('click', () => signIn(true));

$('#btn-signout').addEventListener('click', async () => {
  if (hasPending() && !confirm("Some changes haven't uploaded yet and will be lost. Sign out anyway?")) return;
  try { await sb.auth.signOut(); } catch { /* still clear this device */ }
  user = null;
  lastCloudUpdate = null;
  rememberTrip(null);
  setPending(false);
  Object.assign(vault, { salt: null, key: null, box: null, iter: KDF_ROUNDS });
  await forgetKey();
  state = defaultState();
  saveLocal();
  closeLockScreen();
  authDialog.close();
  render(true);
  setSyncState('signed-out');
});

// ---------- sharing ----------

const shareDialog = $('#share-dialog');
const shareUrl = (token) => `${location.origin}${location.pathname}?view=${token}` +
  (vault.key && state.shareKey ? `#k=${state.shareKey}` : '');

async function renderShareDialog() {
  const isOwner = trip?.owner_id === user.id;
  $('#share-owner').hidden = !isOwner;
  $('#share-not-owner').hidden = isOwner;
  if (!isOwner) return;

  $('#share-link-on').hidden = !trip.share_token;
  $('#btn-make-link').hidden = !!trip.share_token;
  $('#share-link').value = trip.share_token ? shareUrl(trip.share_token) : '';

  const { data, error } = await sb.from('trip_editors').select('email').eq('trip_id', trip.id).order('email');
  if (error) throw error;
  const list = $('#editor-list');
  list.innerHTML = data.length ? '' : '<li class="muted">No travel partners added yet.</li>';
  data.forEach(({ email }) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHTML(email)}</span>`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => shareAction(async () => {
      if (!confirm(`Stop sharing this trip with ${email}?`)) return;
      const { error } = await sb.from('trip_editors').delete().eq('trip_id', trip.id).eq('email', email);
      if (error) throw error;
    }));
    li.appendChild(remove);
    list.appendChild(li);
  });
}

// Run a sharing change, then refresh the dialog; show any error inline.
async function shareAction(fn) {
  showError('#share-error', '');
  try {
    await fn();
    await renderShareDialog();
  } catch (e) {
    console.warn(e);
    showError('#share-error', e.message || "Couldn't reach the server. Try again.");
  }
}

$('#btn-share').addEventListener('click', () => {
  shareDialog.showModal();
  shareAction(async () => {
    // A brand-new trip may not be in the cloud yet.
    if (!trip) await uploadTrip();
  });
});
$('#btn-share-close').addEventListener('click', () => shareDialog.close());

$('#btn-add-editor').addEventListener('click', () => shareAction(async () => {
  const email = $('#editor-email').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter your travel partner\'s email address.');
  const { error } = await sb.from('trip_editors').insert({ trip_id: trip.id, email });
  if (error) throw new Error(error.code === '23505' ? `${email} is already added.` : error.message);
  $('#editor-email').value = '';
}));

async function makeShareLink() {
  const { data, error } = await sb.rpc('new_share_link', { trip: trip.id });
  if (error) throw error;
  trip.share_token = data;
  if (vault.key) {
    // A fresh key too, so the old link can't read new snapshots.
    state.shareKey = newShareKey();
    saveLocal();
    await uploadTrip();
  }
}
$('#btn-make-link').addEventListener('click', () => shareAction(makeShareLink));
$('#btn-reset-link').addEventListener('click', () => shareAction(async () => {
  if (confirm('Make a new link? The current link will stop working.')) await makeShareLink();
}));
$('#btn-stop-link').addEventListener('click', () => shareAction(async () => {
  if (!confirm('Turn off the family link? Anyone using it will no longer see the trip.')) return;
  const { error } = await sb.rpc('stop_share_link', { trip: trip.id });
  if (error) throw error;
  trip.share_token = null;
  if (state.shareKey) {
    delete state.shareKey;
    save();
  }
}));
$('#btn-copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#share-link').value);
    $('#btn-copy-link').textContent = 'Copied!';
  } catch {
    $('#share-link').select();
    $('#btn-copy-link').textContent = 'Press Ctrl/Cmd+C';
  }
  setTimeout(() => { $('#btn-copy-link').textContent = 'Copy'; }, 2000);
});

// ---------- encryption: unlock screen and settings ----------

const lockDialog = $('#lock-dialog');
const lockForm = $('#lock-form');
lockDialog.addEventListener('cancel', (e) => e.preventDefault()); // Esc can't skip the lock

function showLockScreen() {
  document.body.classList.add('locked');
  showError('#lock-error', '');
  if (!lockDialog.open) lockDialog.showModal();
  lockForm.elements.pass.focus();
}
function closeLockScreen() {
  document.body.classList.remove('locked');
  if (lockDialog.open) lockDialog.close();
}

// Open a trip from the cloud. Returns the readable trip, or null when it's
// sealed with a passphrase this device doesn't have yet (then asks for it).
async function openCloudTrip(data) {
  if (!isSealed(data)) {
    if (vault.key) { // encryption was turned off on another device
      Object.assign(vault, { salt: null, key: null, box: null, iter: KDF_ROUNDS });
      await forgetKey();
    }
    return data;
  }
  if (vault.key && toB64(vault.salt) === data.salt) {
    try { return await openWith(vault.key, data); } catch { /* the passphrase changed elsewhere */ }
  }
  Object.assign(vault, { salt: fromB64(data.salt), iter: data.iter, key: null, box: data });
  await forgetKey();
  // Replace any readable copy on this device with the sealed one right away.
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
  state = defaultState();
  render(true);
  showLockScreen();
  return null;
}

async function unlockWith(key, remember) {
  const box = vault.box;
  const plain = await openWith(key, box); // throws if the passphrase is wrong
  Object.assign(vault, { key, salt: fromB64(box.salt), iter: box.iter, box: null });
  if (remember) await rememberKey(key, vault.salt);
  state = migrate(plain);
  saveLocal();
  closeLockScreen();
  render(true);
  if (user) reconcile();
}

lockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = lockForm.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    const key = await deriveKey(lockForm.elements.pass.value, fromB64(vault.box.salt), vault.box.iter);
    await unlockWith(key, lockForm.elements.remember.checked);
    lockForm.elements.pass.value = '';
  } catch {
    showError('#lock-error', "That passphrase didn't unlock the trip. Check it and try again.");
  }
  btn.disabled = false;
  btn.textContent = 'Unlock';
});

// Opening the app on a device that remembers the key: unlock silently.
async function autoUnlock() {
  const saved = await rememberedKey();
  if (saved && saved.salt === vault.box.salt) {
    try { return await unlockWith(saved.key, false); } catch { await forgetKey(); }
  }
  showLockScreen();
}

$('#btn-lock-reset').addEventListener('click', async () => {
  if (!confirm('Remove the encrypted trip from this device? You can sign in again later, but without the passphrase the trip stays unreadable.')) return;
  if (user) {
    $('#btn-signout').click();
  } else {
    Object.assign(vault, { salt: null, key: null, box: null, iter: KDF_ROUNDS });
    await forgetKey();
    state = defaultState();
    saveLocal();
    closeLockScreen();
    render(true);
  }
});

async function lockNow() {
  if (!vault.key) return;
  if (user && hasPending()) await uploadTrip().catch(() => {});
  const box = await sealTrip(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(box)); } catch { /* storage full */ }
  await forgetKey();
  Object.assign(vault, { key: null, box });
  state = defaultState();
  cryptoDialog.close();
  render(true);
  showLockScreen();
}

const cryptoDialog = $('#crypto-dialog');
const cryptoForm = $('#crypto-form');
const PASS_MIN = 10;

function checkNewPassphrase(a, b) {
  if (a.length < PASS_MIN) throw new Error(`Use at least ${PASS_MIN} characters. Four random words works well.`);
  if (a !== b) throw new Error("The two passphrases don't match.");
}

function renderCryptoDialog() {
  $('#crypto-off').hidden = encryptionOn();
  $('#crypto-on').hidden = !encryptionOn();
  $('#crypto-change').hidden = true;
  showError('#crypto-error', '');
  cryptoForm.reset();
}

$('#btn-crypto').addEventListener('click', () => {
  renderCryptoDialog();
  cryptoDialog.showModal();
});
$('#btn-crypto-cancel').addEventListener('click', () => cryptoDialog.close());
$('#btn-crypto-close').addEventListener('click', () => cryptoDialog.close());
$('#btn-crypto-lock').addEventListener('click', lockNow);
$('#btn-lock').addEventListener('click', lockNow);

async function cryptoAction(btn, fn) {
  showError('#crypto-error', '');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    await fn();
  } catch (e) {
    showError('#crypto-error', e.message);
  }
  btn.disabled = false;
  btn.textContent = label;
}

async function setPassphrase(pass, remember) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt, KDF_ROUNDS);
  Object.assign(vault, { salt, key, iter: KDF_ROUNDS, box: null });
  if (remember) await rememberKey(key, salt);
  else await forgetKey();
}

$('#btn-crypto-on').addEventListener('click', (e) => cryptoAction(e.target, async () => {
  const f = cryptoForm.elements;
  checkNewPassphrase(f.pass1.value, f.pass2.value);
  if (user && !serverReady) {
    throw new Error('Your Supabase project needs the encryption update first (supabase/encryption-update.sql). Run it, refresh this page, then try again.');
  }
  await setPassphrase(f.pass1.value, f.remember.checked);
  if (trip?.share_token) state.shareKey = newShareKey(); // keep the family link working
  save();
  render();
  renderCryptoDialog();
}));

$('#btn-crypto-change').addEventListener('click', () => { $('#crypto-change').hidden = false; });
$('#btn-crypto-save').addEventListener('click', (e) => cryptoAction(e.target, async () => {
  const f = cryptoForm.elements;
  checkNewPassphrase(f.newpass1.value, f.newpass2.value);
  await setPassphrase(f.newpass1.value, true);
  save(); // re-sealed with the new passphrase; other devices will ask for it
  renderCryptoDialog();
}));

$('#btn-crypto-off').addEventListener('click', (e) => cryptoAction(e.target, async () => {
  if (!confirm('Turn off encryption? Your trip will be stored readable again on this device and in Supabase.')) return;
  Object.assign(vault, { salt: null, key: null, box: null, iter: KDF_ROUNDS });
  await forgetKey();
  turningOff = true;
  delete state.shareKey;
  save();
  render();
  renderCryptoDialog();
}));

function renderCryptoStatus() {
  $('#btn-lock').hidden = readOnly || !vault.key;
  $('#crypto-status').textContent = encryptionOn() ? 'On' : 'Off';
}

// ---------- startup ----------

async function startSync() {
  if (!sb) return; // sync not configured: the app works on this device only
  $('#btn-sync').hidden = false;
  try {
    const { data } = await sb.auth.getSession();
    user = data.session?.user ?? null;
  } catch {
    user = null;
  }
  setSyncState(user ? 'saving' : 'signed-out');
  if (user) {
    await checkServer();
    await reconcile();
  }

  // Pick up changes made elsewhere when coming back to the app.
  const refresh = () => { if (user && !document.hidden) reconcile(); };
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
}

// Family link (?view=…): show the shared trip read-only, without touching
// this browser's own saved trip.
async function startViewOnly() {
  document.body.classList.add('readonly');
  const banner = $('#view-banner');
  banner.hidden = false;
  let first = true;
  const load = async () => {
    try {
      if (!sb) throw new Error('not configured');
      let { data, error } = await sb.rpc('get_shared_trip', { token: viewToken });
      if (error) throw error;
      if (!data) {
        banner.textContent = 'This link is no longer active. Ask for a new one.';
        return;
      }
      if (isSealed(data)) {
        if (!shareKeyFromUrl) {
          banner.textContent = 'This link is missing its key. Ask for the full link (it ends with #k=…).';
          return;
        }
        try {
          data = await openWith(await shareCryptoKey(shareKeyFromUrl), data);
        } catch {
          banner.textContent = "This link's key doesn't match. Ask for a new link.";
          return;
        }
      }
      banner.textContent = 'View only — this trip was shared with you.';
      if (first || !sameTrip(data, state)) {
        state = migrate(data);
        render(first);
        first = false;
      }
    } catch (e) {
      console.warn(e);
      banner.textContent = "Couldn't load the trip. Check your connection and refresh.";
    }
  };
  await load();
  const refresh = () => { if (!document.hidden) load(); };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
}

// ---------- go ----------

showView(hashView());
render(true);
(async () => {
  if (vault.box) await autoUnlock(); // encrypted trip on this device
  if (readOnly) startViewOnly();
  else startSync();
})();

// ---------- works offline: installable app ----------
// The service worker keeps the app's files (and map tiles you've viewed) so
// it opens without a connection; your trip itself is already saved on the
// device. Skipped on localhost so local development always loads fresh files.
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
const installDialog = $('#install-dialog');
$('#btn-install').addEventListener('click', () => {
  setMenu(false);
  $('#btn-install-now').hidden = !installPrompt;
  installDialog.showModal();
});
$('#btn-install-now').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  installDialog.close();
});
$('#btn-install-close').addEventListener('click', () => installDialog.close());

// ---------- Paste changes ----------
//
// A block of changes (written by you, or by Claude in a chat) that the app
// previews and then applies on this device. Nothing is sent anywhere until
// you tap Apply; then it syncs like any other edit (encrypted if that's on).
//
// {"wanderlog-changes": 1,
//  "stops": [{"find": "Italy", "depart": "2027-03-02", "shiftLater": true}],
//  "asiaRoute": "Your plan",
//  "budget": 12000,
//  "extras": [{"name": "Visas", "usd": 60}],
//  "expenses": [{"date": "2027-01-06", "amount": 459.8, "currency": "USD", "category": "travel", "note": "Flight"}]}

const isDayStr = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDate(d).getTime());

function parseChanges(text) {
  let data;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, ''));
  } catch {
    throw new Error("That doesn't look like a changes block. Copy the whole thing, from the first { to the last }.");
  }
  if (!data || typeof data !== 'object' || data['wanderlog-changes'] !== 1) throw new Error("That isn't a Wanderlog changes block.");
  return data;
}

// Work out the changes on a copy of the trip, so they can be previewed first.
function planChanges(data) {
  const draft = migrate(JSON.parse(JSON.stringify(state)));
  const lines = [];
  const real = state;
  state = draft; // the helpers below work on `state`
  try {
    (Array.isArray(data.stops) ? data.stops : []).slice(0, 50).forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const name = str(c.find).trim().toLowerCase();
      const matches = sortedStops().filter((s) => s.name.toLowerCase() === name && (!c.arrivedOn || s.arrive === c.arrivedOn));
      const s = matches[Math.max(0, Math.round(num(c.nth)) - 1)] ?? matches[0];
      if (!s) { lines.push(`Skipped: no stop called "${str(c.find)}"`); return; }
      const was = `${fmtDate(s.arrive)} → ${fmtDate(s.depart)}`;
      const [oldArrive, oldDepart] = [s.arrive, s.depart];
      if (isDayStr(c.arrive)) s.arrive = c.arrive;
      if (isDayStr(c.depart)) s.depart = c.depart;
      if (s.depart < s.arrive) {
        lines.push(`Skipped ${s.name}: depart would be before arrive`);
        [s.arrive, s.depart] = [oldArrive, oldDepart];
        return;
      }
      if (STOP_STATUSES.includes(c.status) && c.status !== 'idea') s.status = c.status;
      let note = '';
      if (c.shiftLater && s.depart !== oldDepart) {
        const delta = daysBetween(oldDepart, s.depart);
        shiftStopsAfter(oldDepart, delta, s.id);
        note = ` (later stops move ${Math.abs(delta)} day${Math.abs(delta) === 1 ? '' : 's'} ${delta < 0 ? 'earlier' : 'later'})`;
      }
      const now = `${fmtDate(s.arrive)} → ${fmtDate(s.depart)}`;
      if (now !== was || c.status) lines.push(`${s.name}: ${was} becomes ${now}${c.status ? ` · ${s.status}` : ''}${note}`);
    });

    if (typeof data.asiaRoute === 'string') {
      const preset = ASIA_PRESETS.find((p) => p.name.toLowerCase() === data.asiaRoute.toLowerCase());
      const first = asiaStops()[0];
      if (!preset) lines.push(`Skipped: no Asia route called "${data.asiaRoute}"`);
      else if (!first) lines.push('Skipped the Asia route: there are no Asia stops to start from');
      else {
        const start = isDayStr(data.asiaStart) ? data.asiaStart : first.arrive;
        state.asiaPlan = {
          start, end: state.trip.end,
          stops: preset.stops.map(([n, nights]) => { const p = placeInfo(n); return { name: p.name, country: p.country, lat: p.lat, lng: p.lng, nights }; }),
        };
        fitPlan();
        const sig = () => JSON.stringify(asiaStops().map((s) => [s.name, s.arrive, s.depart]));
        const beforeAsia = sig();
        placePlanOnTrip(state.asiaPlan.stops, start);
        const countries = [...new Set(state.asiaPlan.stops.map((p) => p.country))].join(', ');
        lines.push(sig() === beforeAsia ? `Already set: "${preset.name}" Asia route`
          : `Asia: "${preset.name}" route, ${state.asiaPlan.stops.length} stops from ${fmtDate(start)} to ${fmtDate(state.trip.end)} (${countries})`);
      }
    }

    if (data.budget != null && num(data.budget) > 0) {
      const was = state.money.budget;
      state.money.budget = Math.round(num(data.budget));
      lines.push(was === state.money.budget ? `Already set: budget ${usd(was)}` : `Budget: ${usd(state.money.budget)}`);
    }
    (Array.isArray(data.extras) ? data.extras : []).slice(0, 50).forEach((x) => {
      const name = str(x?.name).trim().slice(0, 80);
      if (!name || !(num(x.usd) >= 0)) return;
      if (state.money.extras.some((y) => y.name.toLowerCase() === name.toLowerCase())) { lines.push(`Already listed: ${name}`); return; }
      state.money.extras.push({ id: uid(), name, usd: Math.round(num(x.usd) * 100) / 100 });
      lines.push(`One-off cost: ${name} ${usd(num(x.usd))}`);
    });
    (Array.isArray(data.expenses) ? data.expenses : []).slice(0, 200).forEach((e) => {
      const amount = num(e?.amount);
      const currency = /^[A-Z]{3}$/.test(str(e?.currency)) ? e.currency : 'USD';
      const rate = rateFor(currency);
      if (!(amount > 0) || !rate) return;
      const date = isDayStr(e.date) ? e.date : toISO(today());
      const note = str(e.note).slice(0, 200);
      if (state.money.expenses.some((x) => x.date === date && x.amount === amount && x.note === note)) { lines.push(`Already logged: ${note || 'expense'} on ${fmtDate(date)}`); return; }
      state.money.expenses.push({
        id: uid(), date, amount, currency, usd: Math.round((amount / rate) * 100) / 100,
        category: Object.hasOwn(EXPENSE_CATS, e.category) ? e.category : 'other', stopId: '', note,
      });
      lines.push(`Spent: ${note || EXPENSE_CATS[e.category] || 'expense'} · ${amount.toLocaleString('en-US')} ${currency} on ${fmtDate(date)}`);
    });
  } finally {
    state = real;
  }
  return { draft, lines };
}

const changesDialog = $('#changes-dialog');
let pendingChanges = null;
$('#btn-changes').addEventListener('click', () => {
  setMenu(false);
  $('#changes-text').value = '';
  $('#changes-preview').innerHTML = '';
  $('#btn-changes-apply').hidden = true;
  showError('#changes-error', '');
  pendingChanges = null;
  changesDialog.showModal();
});
$('#btn-changes-close').addEventListener('click', () => changesDialog.close());
$('#btn-changes-preview').addEventListener('click', () => {
  showError('#changes-error', '');
  try {
    if (isLocked()) throw new Error('Unlock your trip first.');
    pendingChanges = planChanges(parseChanges($('#changes-text').value));
    const { lines } = pendingChanges;
    $('#changes-preview').innerHTML = lines.length
      ? `<p class="muted">This will change:</p><ul>${lines.map((l) => `<li>${escapeHTML(l)}</li>`).join('')}</ul>`
      : '<p class="muted">Nothing to change: it all matches already.</p>';
    $('#btn-changes-apply').hidden = !lines.some((l) => !/^(Skipped|Already)/.test(l));
  } catch (err) {
    pendingChanges = null;
    $('#btn-changes-apply').hidden = true;
    $('#changes-preview').innerHTML = '';
    showError('#changes-error', err.message);
  }
});
$('#btn-changes-apply').addEventListener('click', () => {
  if (!pendingChanges) return;
  state = pendingChanges.draft;
  pendingChanges = null;
  save();
  render(true);
  changesDialog.close();
});
