"""python -m thcad_field_docs generate|check"""

from __future__ import annotations

import sys


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else "generate"
    rest = args[1:] if args else []
    if cmd in ("generate", "gen"):
        from .generate import main as gen_main

        return gen_main(rest)
    if cmd in ("check", "coverage"):
        from .coverage import main as cov_main

        return cov_main(rest)
    sys.stderr.write("usage: python -m thcad_field_docs [generate|check] ...\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
