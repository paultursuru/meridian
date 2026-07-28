#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from collapse import collapse_feature

HERE = os.path.dirname(os.path.abspath(__file__))
GDB = os.path.join(HERE, "..", "SWISSBUILDINGS3D_3_0.gdb")
GRID_FILE = os.path.join(HERE, "output_grid.json")  # today's swisstopo map sheets — subdivided below, no longer the chunk list itself
CHUNKS_DIR = os.path.join(HERE, "chunks")
TMP_DIR = os.path.join(HERE, "tmp")
LOG_FILE = os.path.join(HERE, "build_log.jsonl")
BUCKET = "swissbuildings-tiles"
# The wrangler *binary*, not `npx wrangler` — measured live during a
# --workers 20 run (2026-07-28): even with wrangler installed as a
# devDependency, `npx`/`npm exec` still does an npm-registry revalidation
# fetch on every single invocation (confirmed in ~/.npm/_logs's debug output:
# "http fetch GET .../registry.npmjs.org/wrangler"). At 51k invocations, 20
# of those hitting the shared npm cache/registry concurrently is what caused
# 3 adjacent cells to each take ~470s instead of ~1-30s. Calling the resolved
# binary directly skips npm's resolution machinery entirely, not just the
# slow path within it.
WRANGLER_BIN = os.path.join(HERE, "..", "node_modules", ".bin", "wrangler")

# docs/2-search-latency-onepager.md step 5: re-tile from swisstopo's own
# ~0.058x0.028deg map sheets to a uniform 0.01deg grid, so a route's bbox
# pulls only the buildings near it instead of whole sheets (13345 buildings
# fetched for the 2088 actually used, measured on the Lausanne route).
TILE_DEG = 0.01

log_lock = threading.Lock()


def swiss_cells_from_sheets(sheets):
    """Subdivides today's swisstopo map-sheet grid into uniform TILE_DEG
    cells, deduped by id. Derived from the sheets' own coverage rather than a
    rectangular sweep over Switzerland's bounding box, so cells outside real
    Swiss territory (most of a bounding rectangle, given the country's shape)
    are never even considered — this is what keeps the candidate count close
    to the doc's ~47k estimate instead of the ~98k a blind sweep would try."""
    cells = {}
    for sh in sheets:
        w, s, e, n = sh["bbox"]
        lat_lo, lat_hi = math.floor(s * 100), math.floor(n * 100)
        lng_lo, lng_hi = math.floor(w * 100), math.floor(e * 100)
        for lat_idx in range(lat_lo, lat_hi + 1):
            for lng_idx in range(lng_lo, lng_hi + 1):
                cell_id = f"{lat_idx}_{lng_idx}"
                if cell_id in cells:
                    continue
                cells[cell_id] = {
                    # "sheet" kept as the field name throughout (append_log,
                    # load_done_sheets, R2 key, --sheets filter) to minimize
                    # the diff — it's a grid-cell id now, not a real
                    # swisstopo sheet, but it plays exactly the same role.
                    "sheet": cell_id,
                    "bbox": (lng_idx / 100, lat_idx / 100, (lng_idx + 1) / 100, (lat_idx + 1) / 100),
                }
    return list(cells.values())


def batch_transform_wgs84_to_lv95(chunks):
    """One gdaltransform call for every chunk's SW/NE corners, instead of
    one process spawn per chunk."""
    lines = []
    for c in chunks:
        w, s, e, n = c["bbox"]
        lines.append(f"{w} {s}")
        lines.append(f"{e} {n}")
    result = subprocess.run(
        ["gdaltransform", "-s_srs", "EPSG:4326", "-t_srs", "EPSG:2056"],
        input="\n".join(lines) + "\n",
        capture_output=True, text=True, check=True,
    )
    out = [line.split() for line in result.stdout.strip().split("\n")]
    for i, c in enumerate(chunks):
        xmin, ymin = float(out[2 * i][0]), float(out[2 * i][1])
        xmax, ymax = float(out[2 * i + 1][0]), float(out[2 * i + 1][1])
        c["bbox_lv95"] = (xmin, ymin, xmax, ymax)
    return chunks


def load_done_sheets():
    # Last status per sheet wins, not "ok/empty seen at any point in this
    # append-only, cumulative-across-every-run log" — the previous version of
    # this function had exactly that bug: a sheet that succeeded once, long
    # ago, then failed on a later re-run (e.g. a stale temp file from a
    # Ctrl+C) stayed marked "done" forever, silently leaving the old R2
    # object in place. Confirmed live on sheet 1032-31 during PR2's re-run.
    done = set()
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                sheet = rec.get("sheet")
                if sheet is None:
                    continue
                if rec.get("status") in ("ok", "empty"):
                    done.add(sheet)
                else:
                    done.discard(sheet)
    return done


def append_log(rec):
    with log_lock:
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(rec) + "\n")


def process_chunk(chunk):
    sheet = chunk["sheet"]
    xmin, ymin, xmax, ymax = chunk["bbox_lv95"]
    lv95_path = os.path.join(TMP_DIR, f"{sheet}_lv95.geojson")
    wgs84_path = os.path.join(TMP_DIR, f"{sheet}_wgs84.geojson")
    out_path = os.path.join(CHUNKS_DIR, f"{sheet}.json")
    t0 = time.time()
    try:
        subprocess.run(
            ["ogr2ogr", "-f", "GeoJSON", lv95_path, GDB,
             "-sql", "SELECT OBJECTID FROM Building_solid",
             "-nlt", "MULTIPOLYGONZ",
             "-spat", str(xmin), str(ymin), str(xmax), str(ymax)],
            check=True, capture_output=True, text=True,
        )
        subprocess.run(
            ["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", wgs84_path, lv95_path],
            check=True, capture_output=True, text=True,
        )
        with open(wgs84_path) as f:
            data = json.load(f)

        out, skipped, dropped = [], 0, []
        for feature in data.get("features", []):
            b, flag = collapse_feature(feature)
            if b is None:
                skipped += 1
                if flag:
                    dropped.append(flag)
                continue
            out.append(b)

        with open(out_path, "w") as f:
            json.dump(out, f, separators=(',', ':'))

        if out:
            subprocess.run(
                [WRANGLER_BIN, "r2", "object", "put",
                 f"{BUCKET}/swissbuildings3d_3_0_{sheet}.json",
                 "--file", out_path, "--remote"],
                check=True, capture_output=True, text=True,
            )
            status = "ok"
        else:
            status = "empty"

        elapsed = time.time() - t0
        append_log({
            "sheet": sheet, "status": status, "buildings": len(out),
            "skipped": skipped, "dropped": dropped, "elapsed": round(elapsed, 1),
        })
        return status, sheet, len(out)
    except subprocess.CalledProcessError as e:
        elapsed = time.time() - t0
        append_log({
            "sheet": sheet, "status": "failed",
            "error": (e.stderr or str(e))[-500:], "elapsed": round(elapsed, 1),
        })
        return "failed", sheet, 0
    finally:
        for p in (lv95_path, wgs84_path):
            if os.path.exists(p):
                os.remove(p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=None,
                     help="process only the first N pending chunks (testing)")
    ap.add_argument("--sheets", nargs="*",
                     help="process only these specific sheet ids (testing)")
    ap.add_argument("--rebuild-all", action="store_true",
                     help="ignore build_log.jsonl and reprocess every sheet — "
                          "needed whenever collapse_feature()'s output changes "
                          "(e.g. the coordinate rounding), since every sheet "
                          "already marked done/empty was built with the old format")
    args = ap.parse_args()

    os.makedirs(CHUNKS_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    with open(GRID_FILE) as f:
        sheets = json.load(f)
    grid = swiss_cells_from_sheets(sheets)

    done = set() if args.rebuild_all else load_done_sheets()
    pending = [c for c in grid if c["sheet"] not in done]
    # len(done) alone would be misleading now: it's every sheet ever marked
    # done across this log's whole history, including the old swisstopo-
    # sheet-name ids (e.g. "1011-34") from before this re-tile, which can
    # never match a new "latIdx_lngIdx" grid cell — so on this grid's very
    # first run, len(done) is ~3230 (all old-format history) while the
    # actual overlap with the *new* grid is 0. len(grid) - len(pending) is
    # the number that's actually true of this grid.
    already_done_in_grid = len(grid) - len(pending)
    if args.sheets:
        pending = [c for c in pending if c["sheet"] in args.sheets]
    if args.limit:
        pending = pending[: args.limit]

    print(f"{len(grid)} total chunks, {already_done_in_grid} already done, "
          f"{len(pending)} to process ({args.workers} workers)")

    if not pending:
        return

    pending = batch_transform_wgs84_to_lv95(pending)

    n_ok = n_empty = n_failed = 0
    total_buildings = 0
    t_start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_chunk, c): c for c in pending}
        for i, fut in enumerate(as_completed(futures), 1):
            status, sheet, n_buildings = fut.result()
            if status == "ok":
                n_ok += 1
                total_buildings += n_buildings
            elif status == "empty":
                n_empty += 1
            else:
                n_failed += 1
            elapsed = time.time() - t_start
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(pending) - i) / rate if rate > 0 else 0
            print(f"[{i}/{len(pending)}] {sheet}: {status} ({n_buildings} buildings) "
                  f"| ok={n_ok} empty={n_empty} failed={n_failed} "
                  f"| {elapsed:.0f}s elapsed, ETA {eta / 60:.0f}min", flush=True)

    print(f"\nDone. {n_ok} ok, {n_empty} empty, {n_failed} failed, "
          f"{total_buildings} buildings total, {time.time() - t_start:.0f}s")


if __name__ == "__main__":
    main()
