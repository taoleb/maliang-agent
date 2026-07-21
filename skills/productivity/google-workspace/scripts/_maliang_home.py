"""Resolve MALIANG_HOME for standalone skill scripts.

Skill scripts may run outside the Maliang process (e.g. system Python,
nix env, CI) where ``maliang_constants`` is not importable.  This module
provides the same ``get_maliang_home()`` and ``display_maliang_home()``
contracts as ``maliang_constants`` without requiring it on ``sys.path``.

When ``maliang_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``maliang_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``MALIANG_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from maliang_constants import display_maliang_home as display_maliang_home
    from maliang_constants import get_maliang_home as get_maliang_home
except (ModuleNotFoundError, ImportError):

    def get_maliang_home() -> Path:
        """Return the Maliang home directory (default: ~/.maliang).

        Mirrors ``maliang_constants.get_maliang_home()``."""
        val = os.environ.get("MALIANG_HOME", "").strip()
        return Path(val) if val else Path.home() / ".maliang"

    def display_maliang_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``maliang_constants.display_maliang_home()``."""
        home = get_maliang_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
