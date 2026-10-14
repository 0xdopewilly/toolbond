"""Checks on the deployable contract files that genvm-lint does not cover."""

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNNER = re.compile(r'^# \{ "Depends": "py-genlayer:[0-9a-z]{52}" \}$')


def contracts():
    return sorted((ROOT / "contracts").glob("*.py"))


def test_generated_contracts_are_up_to_date():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "bundle.py"), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_runner_header_is_pinned_and_stands_alone():
    # GenVM concatenates every leading comment line into the runner header, so a
    # stray comment on line 3 makes the deploy fail with "runner malformed".
    for path in contracts():
        lines = path.read_text(encoding="utf-8").splitlines()
        assert lines[0] == "# v0.3.0", path.name
        assert RUNNER.match(lines[1]), path.name
        assert not lines[2].startswith("#"), path.name


def test_inlined_modules_do_not_shadow_each_other(tmp_path, monkeypatch):
    # The first ToolBond deploy broke because judge._header replaced gl_mcp._header in the
    # bundled namespace; the MCP client then sent a prompt string as Mcp-Session-Id.
    sys.path.insert(0, str(ROOT / "scripts"))
    import bundle

    for source in sorted((ROOT / "contracts" / "src").glob("*.py")):
        assert bundle.check_collisions(source) == [], source.name

    lib = tmp_path / "lib"
    lib.mkdir()
    (lib / "one.py").write_text("def _helper():\n    return 1\n")
    (lib / "two.py").write_text("def _helper():\n    return 2\n")
    src = tmp_path / "c.py"
    src.write_text("# v0.3.0\n# header\n# @@include one\n# @@include two\n")
    monkeypatch.setattr(bundle, "LIB", lib)
    assert bundle.check_collisions(src) == ["_helper: lib/one.py, lib/two.py"]
