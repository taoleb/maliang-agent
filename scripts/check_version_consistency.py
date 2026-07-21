#!/usr/bin/env python3
"""Verify that shipped package surfaces use the same release version."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read_cli_version() -> str:
    text = (ROOT / "maliang_cli" / "__init__.py").read_text(encoding="utf-8")
    match = re.search(r'^__version__\s*=\s*["\']([^"\']+)["\']', text, re.MULTILINE)
    if not match:
        raise ValueError("maliang_cli/__init__.py does not define __version__")
    return match.group(1)


def _read_pyproject_version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["version"]


def _read_json(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def collect_versions() -> dict[str, str]:
    acp = _read_json("acp_registry/agent.json")
    acp_package = acp["distribution"]["uvx"]["package"]
    expected_acp_package = f"maliang-agent[acp]=={acp['version']}"
    if acp_package != expected_acp_package:
        raise ValueError(
            "acp_registry/agent.json has an unexpected ACP package pin: "
            f"{acp_package!r} (expected {expected_acp_package!r})"
        )
    return {
        "pyproject.toml [project].version": _read_pyproject_version(),
        "maliang_cli.__version__": _read_cli_version(),
        "apps/desktop/package.json": _read_json("apps/desktop/package.json")["version"],
        "acp_registry/agent.json": acp["version"],
        "acp_registry uvx package": acp_package.rsplit("==", 1)[-1],
    }


def main() -> int:
    try:
        versions = collect_versions()
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Version consistency check failed: {exc}", file=sys.stderr)
        return 1

    unique_versions = set(versions.values())
    for source, version in versions.items():
        print(f"{source}: {version}")

    if len(unique_versions) != 1:
        print("Version consistency check failed: release surfaces are out of sync.", file=sys.stderr)
        return 1

    print(f"Version consistency check passed: {unique_versions.pop()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
