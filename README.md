# Wanderlog — Europe & Asia travel tracker

A no-build web app for tracking a 4.5-month trip through Europe and Asia.

## Features
The app is organized into tabs: **🏠 Home · 🗺️ Trip · ✨ Discover · 🎫 Bookings · ✅ To-dos · 👤 Profile** (along the top on a laptop, along the bottom on a phone).

- **Home:** trip countdown, Next up, what needs attention, the next few stops, and key stats
- **To-dos:** reminders worked out from your trip (book transport and stays, online check-in, entry and visa rules, pre-trip checklist), grouped by month, plus your own tasks with due dates; suggested ones can be ticked off or dismissed
- **Schengen 90/180 counter:** your busiest 180-day window in the Schengen area, for US passport holders
- **Travel profile:** a quick quiz (early bird or night owl, interests, food, pace, budget, goals) that personalizes Discover
- **Discover (free):** things to see, do, eat and drink at each stop from [Wikivoyage](https://en.wikivoyage.org), the free traveler-written guide (no API key or account), ranked by your travel profile with the reason shown ("✓ Live music · Budget-friendly"); save favorites to a per-stop wishlist and tick them off
- **Interactive map** (Leaflet + OpenStreetMap) with numbered stops, a solid line for where you've been and a dashed line for what's ahead
- **Itinerary timeline** with dates, nights, transport, star ratings, journal notes and photos; "You are here" badge on the current stop
- **Trip progress bar** and stats: stops, countries, km traveled, nights, booked count, ideas to plan, top-rated stop
- **Place search** (free OpenStreetMap geocoding), or click anywhere on the map to add a stop
- **Saves automatically** in your browser (localStorage); Export/Import JSON for backups
- **Booked, tentative, or idea:** ideas are places you're considering with no dates yet (shown as dashed "?" pins); double-click one to schedule it
- **Home city** (optional, under ⚙︎ Trip): the route starts and ends there, and those flights count toward distance
- **Regions:** Europe, Africa, Asia, with filters
- **Bookings wallet:** flights, trains, buses, ferries, stays and activities with times, confirmation numbers (one-tap copy), addresses (open in Maps), links and notes. A **Staying at / Next up** card shows where you're sleeping and your next departure; each stop shows its bookings as chips
- **Sample trip** under ⚙︎ Trip → "Load sample trip" shows a full example

Your own plan isn't stored in this repo: keep it as an Export file and use ⬆︎ Import to load it.

## Sync and sharing (optional)
With a free [Supabase](https://supabase.com) project, the app adds:
- **☁︎ Sign in to sync:** your trip stays the same on every device you sign in on.
- **👥 Share → Travel partners:** add someone's email; once they create an account with it, they can edit the same trip.
- **👥 Share → Family link:** a view-only link that needs no account. You can make a new one (the old one stops working) or turn it off.

Setup:
1. Create a Supabase project.
2. In **SQL Editor**, run [`supabase/setup.sql`](supabase/setup.sql).
3. Under **Authentication → Sign In / Providers → Email**, keep **Confirm email** on and set the minimum password length to 8. Under **Authentication → URL Configuration**, set **Site URL** to the site's address so email confirmation links come back to the app.
4. Put the project's URL and anon (publishable) key in [`config.js`](config.js).

The anon key is designed to be public: the database's row-level security only lets each account read the trips it owns or was added to, and the family link only reveals the one trip it belongs to. Without `config.js` values, the app works on a single device as before.

## Privacy & security
- **Optional end-to-end encryption (⋯ → 🔒 Encryption).** Pick a passphrase and the whole trip is encrypted in your browser (AES-256-GCM, key from PBKDF2-SHA256 with 600,000 rounds) before it is saved or synced. Supabase, GitHub and anyone with database access only ever see scrambled data. Each device asks for the passphrase once (you can choose not to remember it), and 🔒 locks the trip on the spot. There is no reset: if the passphrase is lost, the trip can't be recovered, so keep it in a password manager and keep an Export backup somewhere safe.
- **Encrypted family link.** With encryption on, the family link carries its own random key after `#k=` (the part of a link that browsers never send to a server), and only a trimmed copy of the trip (no confirmation numbers, booking links, booking notes, to-dos, profile or wishlist) is encrypted with it.
- **Your trip is private by default.** Database row-level security lets an account read and edit only trips it owns or was added to; partners can edit but can't take ownership, invite others, delete the trip or touch the family link.
- **The family link never carries sensitive details.** The database strips booking confirmation numbers, booking links and booking notes, plus to-dos, the travel profile and the wishlist, before anything is sent. Links are 256-bit random and can be reset or turned off.
- **Locked-down page:** a Content-Security-Policy limits where code can load from and which services the app can talk to; the CDN libraries are pinned with Subresource Integrity hashes; no referrer is ever sent, so the family link's secret can't leak through outgoing links.
- **Untrusted data is cleaned** on load (imports, sync, family link) so tampered values can't inject markup, and all text is escaped before display.
- **No secrets in this repo.** The Supabase publishable key is designed to be public; access is enforced by the database rules in `supabase/setup.sql`.

Existing projects created before the family-link filtering should run [`supabase/privacy-update.sql`](supabase/privacy-update.sql) once in the Supabase SQL Editor. Projects created before encryption should also run [`supabase/encryption-update.sql`](supabase/encryption-update.sql) once (safe to run again).

## Run it
Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Tip: double-click a stop in the itinerary to edit or delete it.
