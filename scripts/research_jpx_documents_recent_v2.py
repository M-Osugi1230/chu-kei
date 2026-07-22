#!/usr/bin/env python3
"""Run the JPX multi-document engine using only disclosures dated 2022 or later."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

ENGINE_PATH = Path(__file__).with_name("research_jpx_documents_v1.py")
SPEC = importlib.util.spec_from_file_location("chu_kei_research_engine", ENGINE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load research engine: {ENGINE_PATH}")

engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)
original_rank_documents = engine.rank_documents


def rank_recent_documents(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        row
        for row in original_rank_documents(documents)
        if str(row.get("date") or "") >= "2022-01-01"
    ]


engine.rank_documents = rank_recent_documents

if __name__ == "__main__":
    engine.main()
