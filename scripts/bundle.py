"""Inline library modules into single-file GenVM contracts.

GenVM's standard runner executes one Python file per contract, so shared code in
``lib/`` is inlined wherever a contract source in ``contracts/src/`` has a line
``# @@include <module>``. The result is written to ``contracts/<name>.py``.

Usage:
  python scripts/bundle.py          # regenerate every contract
  python scripts/bundle.py --check  # exit 1 if a generated contract is stale
"""

import ast
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


def _top_level_names(text: str) -> set:
    names = set()
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def check_collisions(source: pathlib.Path) -> list:
    """Inlined modules share one namespace: a name defined twice silently replaces the first."""
    text = source.read_text(encoding="utf-8")
    owners = {}
    for line in text.splitlines():
        match = INCLUDE.match(line)
        if match:
            for name in _top_level_names((LIB / f"{match.group(1)}.py").read_text(encoding="utf-8")):
                owners.setdefault(name, []).append("lib/" + match.group(1) + ".py")
    body = "\n".join(line for line in text.splitlines() if not INCLUDE.match(line))
    for name in _top_level_names(body):
        owners.setdefault(name, []).append("contracts/src/" + source.name)
    return [f"{name}: {', '.join(where)}" for name, where in sorted(owners.items()) if len(where) > 1]


def bundle(source: pathlib.Path) -> str:
    # GenVM concatenates every leading comment line into the runner header, so the
    # "generated" note must not sit directly under it: it goes before the first import.
    lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
    header, body = lines[:HEADER_LINES], lines[HEADER_LINES:]
    note = f"# GENERATED from contracts/src/{source.name} by scripts/bundle.py. Do not edit.\n"
    out = list(header)
    noted = False
    for line in body:
        if not noted and (line.startswith("import ") or line.startswith("from ")):
            out.append(note)
            noted = True
        match = INCLUDE.match(line)
        out.append(_module_body(match.group(1)) if match else line)
    return "".join(out)


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for source in sorted(SRC.glob("*.py")):
        collisions = check_collisions(source)
        if collisions:
            print(f"name collisions in {source.name}:\n  " + "\n  ".join(collisions))
            return 1
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
