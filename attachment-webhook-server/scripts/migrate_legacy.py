#!/usr/bin/env python3
"""Re-encrypt legacy single-tenant data into a user's tenant folder.

Usage:
  python3 scripts/migrate_legacy.py --user-id alice@example.com [--dry-run]

Legacy layout: STORAGE_ROOT/<folder>/{meta.json, <folder>-attachments.zip}
New layout:    STORAGE_ROOT/users/<tenant_hash>/<folder>/{meta.json.enc, <folder>-attachments.zip.enc}
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.crypto import encrypt_bytes, tenant_hash


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = settings.STORAGE_ROOT
    target_base = root / "users" / tenant_hash(args.user_id)
    legacy_dirs = [
        d for d in root.iterdir()
        if d.is_dir() and d.name != "users" and (d / "meta.json").exists()
    ]

    if not legacy_dirs:
        print("No legacy directories found.")
        return 0

    print(f"Migrating {len(legacy_dirs)} legacy folder(s) -> {target_base}")
    for src in legacy_dirs:
        dst = target_base / src.name
        if dst.exists():
            print(f"  SKIP (exists): {src.name}")
            continue
        if args.dry_run:
            print(f"  WOULD migrate: {src.name}")
            continue
        dst.mkdir(parents=True, mode=0o700)
        meta = json.loads((src / "meta.json").read_text())
        (dst / "meta.json.enc").write_bytes(
            encrypt_bytes(json.dumps(meta).encode(), args.user_id)
        )
        zip_src = src / f"{src.name}-attachments.zip"
        if zip_src.exists():
            (dst / f"{src.name}-attachments.zip.enc").write_bytes(
                encrypt_bytes(zip_src.read_bytes(), args.user_id)
            )
        for f in dst.iterdir():
            os.chmod(f, 0o600)
        shutil.rmtree(src)
        print(f"  migrated: {src.name}")

    print("Done. Register the user with /admin/users if not already done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
