# MeridianWay

Pedestrian navigation app that finds the **sunniest** and **shadiest** walking routes between two addresses, based on real-time sun position and building shadows.

---

## How it works

1. **Geocoding:** addresses are resolved via Nominatim (OSM) with autocomplete
2. **Sun position:** altitude and azimuth computed with [SunCalc](https://github.com/mourner/suncalc) for the chosen date, time and midpoint coordinates
3. **Route generation:** OSRM foot-routing API generates up to ~10 route variants by shifting intermediate waypoints perpendicularly to the direct line (77-200 m offsets at pedestrian street scale)
4. **Building data:** Overpass API fetches all building footprints in the route bounding box, with real heights from OSM tags (`height`, `building:levels`)
5. **Shadow scoring:** for each route segment, every building's shadow is evaluated with a geometrically exact model: a segment midpoint `q` is in shadow if the reverse-projection `q - shadow_vec` (shifting `q` toward the sun by `height / tan(altitude)`) falls inside the building's ground footprint (ray-casting point-in-polygon)
6. **Ranking:** routes are sorted by sun fraction; the sunniest and shadiest are highlighted
7. **Display:** both routes are drawn with a per-segment orange-to-blue gradient matching the actual sun/shade pattern; the recommended tab (shade at high sun, sun at low sun) is pre-selected
8. **Elevation:** once results are displayed, a background request to OpenTopoData (SRTM 30 m) fetches elevation along both routes (25 sampled points each, combined into a single API call). D+ and D− are computed from the elevation profile and shown in the results drawer. Falls back to Open-Elevation if OpenTopoData is unavailable; both APIs use exponential-backoff retry (1.5 s → 4 s) on 429/503/504.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | [Astro](https://astro.build) v6 |
| Map | [Leaflet](https://leafletjs.com) + CartoDB Voyager tiles |
| Pedestrian routing | [OSRM](https://routing.openstreetmap.de) foot profile |
| Geocoding / autocomplete | [Nominatim](https://nominatim.org) (OSM) |
| Sun position | [SunCalc](https://github.com/mourner/suncalc) |
| Building footprints | [Overpass API](https://overpass-api.de) (OSM) |
| Elevation | [OpenTopoData](https://www.opentopodata.org) (SRTM 30 m) · fallback: [Open-Elevation](https://open-elevation.com) |

All external APIs are free and require no API key.

---

## Project structure

```
sunpath-app/
├── src/
│   ├── pages/
│   │   └── index.astro        # single page: HTML, CSS, script orchestration
│   └── lib/
│       ├── autocomplete.js    # address dropdown (Nominatim suggest, debounced)
│       ├── buildings.js       # Overpass query + building polygon parsing
│       ├── compass.js         # canvas compass showing sun direction
│       ├── geocode.js         # address → {lat, lng} via Nominatim
│       ├── helpers.js         # haversine, bearing, fmtDist, fmtDur
│       ├── map.js             # Leaflet init, gradient route drawing, opacity control
│       ├── elevation.js       # D+/D− fetch via OpenTopoData/Open-Elevation with retry
│       ├── routing.js         # OSRM foot routing + via-point variant generation
│       ├── shadow.js          # per-segment shadow scoring (point-in-polygon)
│       ├── sun.js             # SunCalc wrapper → {azDeg, altDeg}
│       └── ui.js              # status toast, tabs, swipeable results drawer
└── package.json
```

---

## Getting started

**Requires Node ≥ 22** (Astro 6 constraint). If you use nvm:

```sh
nvm install 22 && nvm use 22
```

```sh
cd sunpath-app
npm install
npm run dev        # http://localhost:4321
```

```sh
npm run build      # production build → dist/
npm run preview    # preview the build locally
```

---

## Shadow model

The shadow cast by a building of height `h` at solar altitude `α` extends in the direction opposite to the sun (azimuth + 180°) by `sLen = h / tan(α)` metres.

A route point `q` is in shadow if and only if the point `q - shadow_vec` (the reverse-projection of `q` toward the sun) falls inside the building's ground-floor polygon, tested with a standard ray-casting algorithm. This is geometrically exact for flat-roofed buildings and avoids the angular-tolerance heuristics of earlier approaches.

A conservative bounding-radius pre-filter (`|q - centroid| > sLen + building_radius`) skips buildings that cannot possibly cast shadow on `q`, keeping the per-route scoring fast even with hundreds of buildings.

---

## Geographic coverage

The app uses OSM-based services everywhere (Nominatim, OSRM, Overpass), so it works for any city in the world, not just Switzerland. The core shadow model, sun position, and routing logic are fully geography-agnostic.

The main variable across regions is **building height data quality**: OSM coverage is excellent in dense European cities but sparse elsewhere. The table below shows the main limitations and how they could be improved.

## Results drawer

After a route search, a bottom drawer slides up from the map edge. The drawer has two states:

- **Peeked (default):** the active tab and its sun/shade ratio bar are visible at a glance without covering the map.
- **Expanded:** drag the handle upward (or tap it) to reveal the full detail panel — distance, walking duration, elevation D+/D−, and the shaded vs. sunny distance split. Drag down or tap to collapse.

The drawer is driven by touch/mouse drag events and snaps to either state with a CSS `transform` transition (no layout reflow).

---

## Known limitations

| Limitation | Potential improvement |
|---|---|
| OSM building heights are incomplete in many areas | Integrate authoritative 3D building datasets per country (e.g. swisstopo swissBUILDINGS3D for Switzerland, IGN BD TOPO for France, OS Building Height Attribute for the UK) |
| OSRM via-point variants don't always find both sidewalks of the same street | Use micro-offsets (~11 m) or OSRM snapping to `highway=footway` ways |
| Route deduplication by distance ±3% may miss genuinely different same-length routes | Compare coordinate-level geometry overlap |
| No vegetation (trees, parks) | Integrate OSM `natural=tree` and `landuse=forest` |
| Flat-roof assumption | Extend to pitched roofs using OSM `roof:shape` |
| GraphHopper `algorithm=alternative_route` would produce cleaner non-backtracking variants | Needs an API key (free or 💰) |
| SRTM 30 m elevation has ~15–30 m horizontal resolution | Use higher-res DEM (e.g. swisstopo DHM25 for Switzerland) for accurate urban D+/D− |
