import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

sys.path.insert(0, str(ROOT / "packages" / "agentsociety2"))

from agentsociety2.society.cli import main

if __name__ == "__main__":
    main()