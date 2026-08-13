#!/usr/bin/env python3
"""Workspace-level wrapper for CT demo experiment generation.

This keeps CT_demo/generate_ct_experiment.py as the canonical implementation
while providing a stable top-level entrypoint under scripts/.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    target = repo_root / "CT_demo" / "generate_ct_experiment.py"
    if not target.is_file():
        raise SystemExit(f"Missing generator script: {target}")

    os.execv(sys.executable, [sys.executable, str(target), *sys.argv[1:]])


if __name__ == "__main__":
    main()
