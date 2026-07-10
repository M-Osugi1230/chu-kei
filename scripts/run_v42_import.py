from __future__ import annotations

import base64
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORT_DIR = ROOT / "imports" / "v42"
PACKAGE = IMPORT_DIR / "chukei_570_company_operations_v42.zip"
TEMP_CHUNK = IMPORT_DIR / "package.b64.part000"
CHECKSUM = IMPORT_DIR / "package.sha256"


def main() -> None:
    if not PACKAGE.is_file():
        raise FileNotFoundError(
            f"Import source not found: {PACKAGE}. "
            "Upload the original v42 operations ZIP without renaming its contents."
        )

    package_bytes = PACKAGE.read_bytes()
    actual = hashlib.sha256(package_bytes).hexdigest()
    expected = CHECKSUM.read_text(encoding="ascii").strip().split()[0]
    if actual != expected:
        raise RuntimeError(
            f"Source package checksum mismatch: expected={expected}, actual={actual}"
        )

    if TEMP_CHUNK.exists():
        raise RuntimeError(f"Temporary import chunk already exists: {TEMP_CHUNK}")

    TEMP_CHUNK.write_text(base64.b64encode(package_bytes).decode("ascii"), encoding="ascii")
    try:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "import_v42_to_v43.py")],
            cwd=ROOT,
            check=True,
        )
    finally:
        TEMP_CHUNK.unlink(missing_ok=True)

    print(f"Imported v42 source package: sha256={actual}")


if __name__ == "__main__":
    main()
