"""Inline library modules into single-file GenVM contracts.

GenVM's standard runner executes one Python file per contract, so shared code in
``lib/`` is inlined wherever a contract source in ``contracts/src/`` has a line
``# @@include <module>``. The result is written to ``contracts/<name>.py``.

Usage:
  python scripts/bundle.py          # regenerate every contract
  python scripts/bundle.py --check  # exit 1 if a generated contract is stale
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "contracts" / "src"
LIB = ROOT / "lib"
OUT = ROOT / "contracts"
INCLUDE = re.compile(r"^# @@include ([a-z_][a-z0-9_]*)\s*$")
HEADER_LINES = 2  # "# v0.3.0" and the Depends line must stay first


def _module_body(name: str) -> str:
    text = (LIB / f"{name}.py").read_text(encoding="utf-8")
    return (
        f"# ---- begin lib/{name}.py (inlined by scripts/bundle.py) ----\n"
        + text.rstrip("\n")
        + f"\n# ---- end lib/{name}.py ----\n"
    )


def bundle(source: pathlib.Path) -> str:
    lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
    header, body = lines[:HEADER_LINES], lines[HEADER_LINES:]
    note = f"# GENERATED from contracts/src/{source.name} by scripts/bundle.py. Do not edit.\n"
    out = header + [note]
    for line in body:
        match = INCLUDE.match(line)
        out.append(_module_body(match.group(1)) if match else line)
    return "".join(out)


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for source in sorted(SRC.glob("*.py")):
        target = OUT / source.name
        text = bundle(source)
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != text:
                stale.append(target.name)
        else:
            target.write_text(text, encoding="utf-8")
            print(f"wrote contracts/{target.name}")
    if stale:
        print("stale generated contracts: " + ", ".join(stale) + " (run scripts/bundle.py)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
