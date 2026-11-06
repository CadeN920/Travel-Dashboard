// Wanderlog — a tiny travel tracker. Data lives in localStorage and, when
// signed in, is also synced to Supabase so every device sees the same trip.

const STORAGE_KEY = 'wanderlog-v1';
const DAY = 24 * 60 * 60 * 1000;

// ---------- helpers ----------

const $ = (sel) => document.querySelector(sel);
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
function flagFor(s) {
  const code = countryCodeOf(s);
  if (!code) return '';
  const flag = String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  return `<span class="flag">${flag}</span>`;
}

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
  };
}

// Fill in fields that older saves or imports may be missing, and coerce
// every field that ends up in page markup to the kind of value it should
// hold. Trips can arrive from an import file or another account, so a
// tampered value must never be able to inject markup or script.
const CONTINENTS = ['Europe', 'Africa', 'Asia'];
const STOP_STATUSES = ['booked', 'tentative', 'idea'];
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
  const { todos, todoState, profile, wishlist, shareKey, ...rest } = s;
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
  maxNativeZoom: 16, maxZoom: 18,
}).addTo(map);
const esriLabels = L.tileLayer(esriUrl('Reference'), { maxNativeZoom: 16, maxZoom: 18 }).addTo(map);

let tileErrors = 0;
esriTiles.on('tileerror', () => {
  if (++tileErrors !== 5) return;
  map.removeLayer(esriTiles);
  map.removeLayer(esriLabels);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
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
  const width = Math.max(26, 16 + String(label).length * 7);
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
    L.marker([home.lat, home.lng], { icon: pinIcon('home', '🏠') })
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
    : elapsed >= total ? ['🎉', 'trip complete']
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
    [Math.round(routeKm(stops)).toLocaleString() + ' km', 'Distance'],
    [nights, 'Nights planned'],
    ideaStops().length && [ideaStops().length, 'Ideas to plan'],
    fav && [escapeHTML(fav.name), 'Top rated'],
  ].filter(Boolean);
  $('#stats').innerHTML = tiles
    .map(([v, l]) => `<div class="stat"><div class="value">${v}</div><div class="label">${l}</div></div>`)
    .join('');
}

// ---------- itinerary list ----------

function addListItem(className, text) {
  const li = document.createElement('li');
  li.className = className;
  li.textContent = text;
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
    addListItem('leg', `🏠 ${home.name} → ${stops[0].transport || '✈️'} ${km(home, stops[0])}`);
  }
  stops.forEach((s, i) => {
    if (filter !== 'all' && s.continent !== filter) return;
    if (s.leg && s.leg !== stops[i - 1]?.leg) addListItem('section-head', s.leg);
    if (i > 0 && showLegs) addListItem('leg', `${s.transport || '↓'} ${km(stops[i - 1], s)}`);
    stopItem(s, i + 1);
  });
  if (home && stops.length && showLegs) {
    addListItem('leg', `✈️ ${km(stops.at(-1), home)} → 🏠 Home to ${home.name}`);
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
  renderCryptoStatus();
  if (!$('#view-discover').hidden) renderDiscover();
  renderMap(fit);
}

// ---------- bookings: flights, trains, stays & confirmations ----------

const BOOKING_TYPES = {
  flight: { icon: '✈️', start: 'Departs', end: 'Arrives' },
  train: { icon: '🚆', start: 'Departs', end: 'Arrives' },
  bus: { icon: '🚌', start: 'Departs', end: 'Arrives' },
  ferry: { icon: '⛴️', start: 'Departs', end: 'Arrives' },
  stay: { icon: '🏠', start: 'Check-in', end: 'Check-out' },
  activity: { icon: '🎟️', start: 'Starts', end: 'Ends' },
};
const bookingIcon = (b) => BOOKING_TYPES[b.type]?.icon ?? '🎟️';

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
      ${b.address ? `<div class="notes"><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">📍 ${escapeHTML(b.address)}</a></div>` : ''}
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

const VIEWS = ['home', 'trip', 'discover', 'bookings', 'todos', 'profile'];
const PRIVATE_VIEWS = ['discover', 'todos', 'profile']; // not shown on the family link

function showView(name) {
  if (!VIEWS.includes(name) || (readOnly && PRIVATE_VIEWS.includes(name))) name = 'home';
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo({ top: 0 });
  if (name === 'discover') openDiscover();
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
      const how = (s.transport || '').replace(/^\S+\s/, '').toLowerCase() || 'travel';
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
  if (!open.length) attention.innerHTML = '<li class="empty">Nothing needs attention right now. 🎉</li>';
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
    sub: elapsed < 0 ? `Starts in ${plural(-elapsed, 'day')}` : elapsed >= total ? 'Trip complete 🎉' : `Day ${elapsed + 1} of ${total}`,
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
      sub: left < 0 ? `⚠ ${plural(-left, 'day')} over the limit` : left < 10 ? `⚠ Only ${plural(left, 'day')} to spare` : `${plural(left, 'day')} to spare` });
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
  if (rows.length > 8) {
    const rest = rows.slice(7);
    rows = [...rows.slice(0, 7), { name: `${rest.length} more`, other: true, nights: rest.reduce((n, r) => n + r.nights, 0), stops: rest.flatMap((r) => r.stops) }];
  }
  countryRows = rows;
  const max = Math.max(1, ...rows.map((r) => r.nights));
  $('#country-key').innerHTML = regionKey(CONTINENTS.filter((c) => rows.some((r) => r.stop?.continent === c)));
  $('#chart-countries').innerHTML = rows.length
    ? rows.map((r, i) => `
      <div class="bar-row" data-i="${i}">
        <span class="bar-label">${r.other ? '' : flagFor(r.stop)}${escapeHTML(r.name)}</span>
        <span class="bar-track"><span class="bar ${r.other ? 'other' : r.stop.continent}" style="width:${(r.nights / max) * 100}%"></span></span>
        <span class="bar-value">${r.nights}</span>
      </div>`).join('')
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

// ---------- Discover: free recommendations from Wikivoyage ----------
//
// Wikivoyage is the free, traveler-written guide (CC BY-SA). Its city
// articles list places as templates like {{see | name=... | content=...}}
// under See / Do / Eat / Drink / Buy. We read those lists through the public
// MediaWiki API (no key, no account) and rank them with the travel profile.

const WV_API = 'https://en.wikivoyage.org/w/api.php';
const WV_CACHE_DAYS = 7;
const LISTING_TYPES = ['see', 'do', 'eat', 'drink', 'buy'];
const TYPE_LABEL = { see: '🏛 See', do: '🎟️ Do', eat: '🍽 Eat', drink: '🍷 Drink', buy: '🛍 Shop' };
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
  if (idx >= 0) state.stops[idx] = stop;
  else state.stops.push(stop);
  save();
  render(idx < 0);
});

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
      leg('Lisbon', 'Portugal', 38.7223, -9.1393, 5, 'Europe', '✈️ Plane', { rating: 5, notes: 'Pastéis de nata every morning. Sunset at Miradouro da Senhora do Monte.' }),
      leg('Barcelona', 'Spain', 41.3874, 2.1686, 5, 'Europe', '✈️ Plane', { rating: 4, notes: 'Sagrada Família blew my mind.' }),
      leg('Paris', 'France', 48.8566, 2.3522, 4, 'Europe', '🚆 Train', { rating: 4 }),
      leg('Amsterdam', 'Netherlands', 52.3676, 4.9041, 4, 'Europe', '🚆 Train', { rating: 4, notes: 'Biked everywhere.' }),
      leg('Berlin', 'Germany', 52.52, 13.405, 5, 'Europe', '🚆 Train', { rating: 5 }),
      leg('Prague', 'Czechia', 50.0755, 14.4378, 4, 'Europe', '🚌 Bus', { rating: 4 }),
      leg('Vienna', 'Austria', 48.2082, 16.3738, 3, 'Europe', '🚆 Train', { rating: 3 }),
      leg('Budapest', 'Hungary', 47.4979, 19.0402, 5, 'Europe', '🚆 Train', { notes: 'Thermal baths tomorrow!' }),
      leg('Istanbul', 'Türkiye', 41.0082, 28.9784, 6, 'Europe', '✈️ Plane'),
      leg('Delhi', 'India', 28.6139, 77.209, 4, 'Asia', '✈️ Plane'),
      leg('Jaipur', 'India', 26.9124, 75.7873, 3, 'Asia', '🚆 Train'),
      leg('Bangkok', 'Thailand', 13.7563, 100.5018, 6, 'Asia', '✈️ Plane'),
      leg('Chiang Mai', 'Thailand', 18.7883, 98.9853, 6, 'Asia', '🚆 Train'),
      leg('Hanoi', 'Vietnam', 21.0278, 105.8342, 5, 'Asia', '✈️ Plane'),
      leg('Hoi An', 'Vietnam', 15.8801, 108.338, 5, 'Asia', '🚆 Train'),
      leg('Seoul', 'South Korea', 37.5665, 126.978, 7, 'Asia', '✈️ Plane'),
      leg('Tokyo', 'Japan', 35.6762, 139.6503, 8, 'Asia', '✈️ Plane'),
      leg('Kyoto', 'Japan', 35.0116, 135.7681, 5, 'Asia', '🚆 Train'),
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
let serverReady = false; // the database has the encryption update (share_data column)
async function checkServer() {
  try {
    const { data: version } = await sb.rpc('wanderlog_schema_version');
    serverReady = version >= 2;
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
  'signed-out': ['☁︎ Sign in to sync', ''],
  saving: ['☁︎ Saving…', ''],
  synced: ['☁︎ Synced', 'synced'],
  offline: ['☁︎ Offline — will sync', 'problem'],
  error: ['⚠︎ Sync problem', 'problem'],
};

function setSyncState(name) {
  const [label, cls] = SYNC_LABELS[name];
  const btn = $('#btn-sync');
  // Icon stays visible on phones; the words hide on narrow screens.
  const [icon, ...words] = label.split(' ');
  btn.innerHTML = `${icon} <span class="label">${words.join(' ')}</span>`;
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
      banner.textContent = '👀 View only — this trip was shared with you.';
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
