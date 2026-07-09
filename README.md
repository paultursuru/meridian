# MeridianWay

Pedestrian navigation app that finds the **sunniest** and **shadiest** walking routes between two addresses, based on real-time sun position and building/tree shadows.

Live at [meridian-way.ch](https://meridian-way.ch), available in French, German, Italian and English.

---

## How it works

1. **Geocoding:** address autocomplete via Photon (komoot.io); the final address-to-coordinates lookup on search uses Nominatim (OSM). Reverse geocoding (for the geolocation buttons) also uses Nominatim.
2. **Sun position:** altitude and azimuth computed with [SunCalc](https://github.com/mourner/suncalc) for the chosen date, time and route midpoint. The date/time inputs are interpreted as wall-clock time at the destination (via `tz-lookup`), not the browser's local time. The sun is not frozen at departure: shadow scoring moves it along the walk (see 5).
3. **Route generation:** OpenRouteService (`foot-walking`, GeoJSON) returns up to 3 alternative routes per query (`alternative_routes`, capped by ORS itself), tuned for diversity with `weight_factor`/`share_factor`. Requests go through a Cloudflare Worker proxy (`ors-proxy/`) that holds the ORS API key server-side and caches responses in KV for 7 days, so the key never ships in the client bundle and repeat searches are free.
4. **Building & vegetation data:** the Overpass API (via a caching Cloudflare Worker, `overpass-cache/`, 30-day KV TTL) fetches all building footprints in the route bounding box, with real heights from OSM tags (`height`, `building:levels`) and per-type defaults otherwise (10 m for ordinary buildings, ~2.5 m for garages/sheds/huts, 22 m for churches and towers), plus trees (`natural=tree`, `natural=tree_row`) and forest polygons (`landuse=forest`, `natural=wood`) with seasonal leaf-coverage modelling (deciduous vs evergreen, based on the chosen date and hemisphere). Forest canopy counts as fractional shade (~85% dense), so a route through a wood scores shady in summer but mostly sunny under bare winter branches.
5. **Shadow scoring:** for each route segment (sampled at 25/50/75%), every building's and tree's shadow is evaluated with a geometrically exact model: the sun ray from the sample point toward the sun is tested against each polygon (point-in-polygon plus edge-intersection), correctly handling buildings anywhere between the ground point and the shadow-tip, not just at the exact shadow length. Each segment is scored with the sun at its **estimated arrival time** (cumulative distance ÷ walking pace, SunCalc memoized per minute of walking) — over a 45-min walk the sun moves ~11° of azimuth, enough to flip which side of a street is shaded, and a mid-route sunset shades the remaining segments.
6. **Ranking:** routes are deduplicated by geometry overlap (not by distance) so that two similar-length routes on different streets both survive, then sorted by sun fraction; the sunniest and shadiest are highlighted. At night (sun below the horizon) shadow scoring is skipped entirely and only the shortest route is shown.
7. **Display:** both routes are drawn with a per-segment orange-to-blue gradient matching the actual sun/shade pattern; the recommended tab is pre-selected using forecast temperature when available (Open-Meteo, up to 15 days out), falling back to a season/altitude heuristic otherwise.
8. **Elevation:** ORS returns elevation inline with each route (`elevation: true`), no separate API call. D+ and D- are computed from the coordinate elevation profile and shown in the results drawer; the displayed walking duration folds in a climb-time supplement (~4 min per 100 m of ascent, ascent only) rather than showing it as a separate figure.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | [Astro](https://astro.build) v6 |
| Map | [Leaflet](https://leafletjs.com) + [MapLibre GL](https://maplibre.org) (`@maplibre/maplibre-gl-leaflet`), Stadia Maps OSM Bright vector tiles |
| Pedestrian routing + elevation | [OpenRouteService](https://openrouteservice.org) `foot-walking`, proxied and cached through a Cloudflare Worker |
| Geocoding (autocomplete) | [Photon](https://photon.komoot.io) (komoot.io) |
| Geocoding (search / reverse) | [Nominatim](https://nominatim.org) (OSM) |
| Sun position | [SunCalc](https://github.com/mourner/suncalc) |
| Building & tree footprints | [Overpass API](https://overpass-api.de) (OSM), proxied and cached through a Cloudflare Worker |
| Weather (tab preselection) | [Open-Meteo](https://open-meteo.com) cloud cover / temperature forecast |
| Timezone resolution | `tz-lookup` |
| Error monitoring | [Sentry](https://sentry.io) (`@sentry/astro`) |
| Analytics | [Umami](https://umami.is) |

Nominatim, Photon, SunCalc, Overpass and Open-Meteo are free and require no API key. OpenRouteService requires a key, held server-side in the `ors-proxy` Worker and never exposed to the client.

---

## Project structure

```
meridian/
├── src/
│   ├── pages/
│   │   ├── index.astro          # French (default locale)
│   │   ├── about.astro / privacy.astro
│   │   └── {de,it,en}/          # per-locale routes (index, about, privacy)
│   ├── layouts/
│   │   ├── AppLayout.astro      # main app shell: map, search panel, results drawer, script orchestration
│   │   ├── AboutLayout.astro
│   │   └── PrivacyLayout.astro
│   ├── components/
│   │   ├── AboutContent.astro
│   │   └── PrivacyContent.astro
│   ├── lib/
│   │   ├── autocomplete.js   # address dropdown (Photon suggest, debounced)
│   │   ├── buildings.js      # building polygon parsing + bbox helper
│   │   ├── compass.js        # canvas compass showing sun direction
│   │   ├── geocode.js        # Photon autocomplete + Nominatim geocode/reverse geocode
│   │   ├── helpers.js        # haversine, bearing, fmtDist, fmtDur
│   │   ├── i18n.ts           # translations (fr/de/it/en)
│   │   ├── map.js            # Leaflet + MapLibre init, gradient route drawing, pins
│   │   ├── overpass.js       # Overpass proxy fetch with retry/backoff
│   │   ├── preselect.js      # sunny/shady tab preselection (temperature or season heuristic)
│   │   ├── routing.js        # ORS proxy fetch, alternative routes, dedup by geometry overlap
│   │   ├── season.js         # leaf-coverage fraction by date (deciduous vs evergreen)
│   │   ├── shadow.js         # per-segment shadow scoring (sun-ray vs polygon)
│   │   ├── share.js          # shareable-URL serialization (from/to/date/time query params)
│   │   ├── sun.js            # SunCalc wrapper -> {azDeg, altDeg} + memoized time sampler
│   │   ├── timezone.js       # IANA timezone lookup + wall-clock <-> UTC conversion
│   │   ├── trees.js          # tree footprint fetch + seasonal canopy shadow scoring
│   │   ├── ui.js             # status toast, tabs, swipeable results drawer
│   │   └── weather.js        # Open-Meteo cloud cover / temperature fetch
│   └── styles/main.css
├── tests/                    # Vitest unit tests
├── ors-proxy/                # Cloudflare Worker: ORS API key + response cache (KV)
├── overpass-cache/           # Cloudflare Worker: Overpass response cache (KV)
├── docs/                     # product review notes
├── Dockerfile, nginx.conf, fly.toml   # production build/deploy (Fly.io)
└── package.json
```

---

## Getting started

**Requires Node ≥ 22** (Astro 6 constraint). If you use nvm:

```sh
nvm install 22 && nvm use 22
```

```sh
cd meridian
npm install
npm run dev        # http://localhost:4321
```

```sh
npm run build      # production build → dist/
npm run preview    # preview the build locally
npm test           # run the Vitest suite
```

The Cloudflare Workers in `ors-proxy/` and `overpass-cache/` are separate deployables (each with its own `wrangler.toml` and KV namespace); they are not part of the Astro build and only need redeploying when their own code changes.

---

## Shadow model

The shadow cast by a building or tree of height `h` at solar altitude `α` extends in the direction opposite to the sun (azimuth + 180°) by `sLen = h / tan(α)` metres.

A route sample point is in shadow if the sun ray from that point toward the shadow tip crosses the building's ground-floor polygon or tree crown, tested with ray-casting (point-in-polygon) plus a segment-intersection check against every polygon edge. This is geometrically exact for flat-roofed buildings and correctly catches buildings that lie anywhere along the ray, not just exactly at the shadow-tip distance.

Trees add fractional shade on top of buildings: deciduous trees are weighted by a seasonal leaf-coverage fraction (bare in winter, full canopy May-September, shifted six months in the southern hemisphere), evergreen trees always score full shade.

The sun position itself is time-stepped: each segment is evaluated with the sun at the moment the walker is expected to reach it, derived from the route's own pace (`makeSunSampler` in `sun.js`, quantized to 60 s buckets and memoized). This costs a handful of extra SunCalc calls per route — the expensive polygon tests run exactly as often as with a fixed sun.

A conservative bounding-radius pre-filter (`|point - centroid| > sLen + radius`) skips buildings/trees that cannot possibly cast shadow on a given point, keeping per-route scoring fast even with hundreds of features.

---

## Geographic coverage

The app uses OSM-based services everywhere (Nominatim, Photon, ORS, Overpass), so it works for any city in the world, not just Switzerland. The core shadow model, sun position, and routing logic are fully geography-agnostic.

The main variable across regions is **building height data quality**: OSM coverage is excellent in dense European cities but sparse elsewhere. The table below shows the main limitations and how they could be improved.

## Results drawer

After a route search, a bottom drawer slides up from the map edge. The drawer has two states:

- **Peeked (default):** the active tab and its sun/shade ratio bar are visible at a glance without covering the map.
- **Expanded:** drag the handle upward (or tap it) to reveal the full detail panel: distance, walking duration, elevation D+/D-, and the shaded vs. sunny distance split. Drag down or tap to collapse.

The displayed walking duration includes a **climb-time supplement** when the route goes uphill: roughly `+4 min per 100 m of ascent` (Naismith-style, counting ascent only, strong walkers feel little of it) is added to the flat-walking time before formatting, so the duration shown is a single all-in figure rather than a base time plus a separate breakout.

A share button copies (or opens the native share sheet for) a URL that encodes the search: start/end coordinates and labels plus the destination-local date/time, so a route can be bookmarked or sent to someone else.

The drawer is driven by touch/mouse drag events and snaps to either state with a CSS `transform` transition (no layout reflow).

---

## Known limitations

| Limitation | Potential improvement |
|---|---|
| OSM building heights are incomplete in many areas | Integrate authoritative 3D building datasets per country (e.g. swisstopo swissBUILDINGS3D / swissSURFACE3D for Switzerland, IGN BD TOPO for France, OS Building Height Attribute for the UK) |
| ORS `alternative_routes` is capped at 3 by the API | No workaround short of a different routing backend for more variety |
| Route deduplication by geometry overlap may still merge or split edge cases | Tune the grid-cell resolution and overlap threshold in `routing.js` |
| Flat-roof assumption | Extend to pitched roofs using OSM `roof:shape` |
| ORS's built-in elevation has coarse horizontal resolution in some regions | Use a higher-res DEM (e.g. swisstopo DHM25 for Switzerland) for accurate urban D+/D− |
