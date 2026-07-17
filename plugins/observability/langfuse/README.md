# Langfuse Observability Plugin

This plugin ships bundled with Maliang but is **opt-in** — it only loads when
you explicitly enable it.

## Enable

Pick one:

```bash
# Interactive: walks you through credentials + SDK install + enable
maliang tools  # → Langfuse Observability

# Manual
pip install langfuse
maliang plugins enable observability/langfuse
```

## Required credentials

Set these in `~/.maliang/.env` (or via `maliang tools`):

```bash
MALIANG_LANGFUSE_PUBLIC_KEY=pk-lf-...
MALIANG_LANGFUSE_SECRET_KEY=sk-lf-...
MALIANG_LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or your self-hosted URL
```

Without the SDK or credentials the hooks no-op silently — the plugin fails
open.

## Verify

```bash
maliang plugins list                 # observability/langfuse should show "enabled"
maliang chat -q "hello"              # then check Langfuse for a "Maliang turn" trace
```

## Optional tuning

```bash
MALIANG_LANGFUSE_ENV=production       # environment tag
MALIANG_LANGFUSE_RELEASE=v1.0.0       # release tag
MALIANG_LANGFUSE_SAMPLE_RATE=0.5      # sample 50% of traces
MALIANG_LANGFUSE_MAX_CHARS=12000      # max chars per field (default: 12000)
MALIANG_LANGFUSE_DEBUG=true           # verbose plugin logging
```

## Disable

```bash
maliang plugins disable observability/langfuse
```
