"""update_persona tool — the agent rewrites its own SOUL.md persona.

The desktop UI no longer exposes a direct SOUL.md editor; instead the agent
self-modifies its persona based on user intent via this tool. The new persona
takes effect next session (SOUL.md is read at session start). The previous
persona is backed up to SOUL.md.bak before overwriting.

Security note: this is a first-party tool the agent invokes from user intent
("make your persona more concise"). It is NOT reachable from skills
(skills_guard blocks SOUL.md writes) and explicit "modify SOUL.md" phrasing in
user input is still flagged by threat_patterns — only the agent's own tool call
writes the file.
"""

from __future__ import annotations

from maliang_constants import get_maliang_home
from tools.registry import registry

PERSONA_SCHEMA = {
    "name": "update_persona",
    "description": (
        "Rewrite your own persona (SOUL.md). Use when the user asks to change your "
        "personality, identity, tone, or behavior. Provide the FULL new persona text — "
        "it replaces the current SOUL.md. The new persona takes effect next session. "
        "Briefly confirm the change with the user before writing."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The full new SOUL.md persona text (replaces the existing file).",
            }
        },
        "required": ["content"],
    },
}


def _update_persona(content: str) -> str:
    if not content or not content.strip():
        return "update_persona: empty content — persona unchanged."
    soul_path = get_maliang_home() / "SOUL.md"
    soul_path.parent.mkdir(parents=True, exist_ok=True)
    # Back up the existing persona before overwriting (safety net).
    if soul_path.exists():
        backup = soul_path.with_name("SOUL.md.bak")
        try:
            backup.write_text(soul_path.read_text(encoding="utf-8"), encoding="utf-8")
        except OSError:
            pass
    soul_path.write_text(content, encoding="utf-8")
    return f"Persona rewritten at {soul_path}. The new persona takes effect next session."


registry.register(
    name="update_persona",
    toolset="memory",
    schema=PERSONA_SCHEMA,
    handler=lambda args, **_kw: _update_persona(args.get("content", "")),
)
