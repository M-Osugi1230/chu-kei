from __future__ import annotations

import gzip
import importlib.util
import io
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "collect_phase1_review_packets_v1.py"

spec = importlib.util.spec_from_file_location("phase1_collector", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load collector: {MODULE_PATH}")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def write_gzip_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8") as text:
                json.dump(value, text, ensure_ascii=False, separators=(",", ":"))


collector.write_gzip_json = write_gzip_json
raise SystemExit(collector.main())
