#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from collapse import collapse_feature

HERE = os.path.dirname(os.path.abspath(__file__))
GDB = os.path.join(HERE, "..", "SWISSBUILDINGS3D_3_0.gdb")
GRID_FILE = os.path.join(HERE, "output_grid.json")
CHUNKS_DIR = os.path.join(HERE, "chunks")
TMP_DIR = os.path.join(HERE, "tmp")
LOG_FILE = os.path.join(HERE, "build_log.jsonl")
BUCKET = "swissbuildings-tiles"

log_lock = threading.Lock()


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
    done = set()
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE) as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get("status") in ("ok", "empty"):
                    done.add(rec["sheet"])
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
                ["npx", "wrangler", "r2", "object", "put",
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
        grid = json.load(f)

    done = set() if args.rebuild_all else load_done_sheets()
    pending = [c for c in grid if c["sheet"] not in done]
    if args.sheets:
        pending = [c for c in pending if c["sheet"] in args.sheets]
    if args.limit:
        pending = pending[: args.limit]

    print(f"{len(grid)} total chunks, {len(done)} already done, "
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
