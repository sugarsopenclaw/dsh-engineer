from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import init_database


def main() -> int:
    statements = init_database()
    if statements:
        for statement in statements:
            print(statement)
    else:
        print("agent archive schema is up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
