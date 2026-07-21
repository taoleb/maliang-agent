#!/usr/bin/env bash
# Run a Maliang instance in an isolated sandbox — separate MALIANG_HOME,
# separate Electron userData, and a distinct Desktop app name so it doesn't compete
# with your main desktop instance's single-instance lock.
#
# By default the sandbox is throwaway: a temp dir is created and removed on
# exit. Use --persistent to keep the sandbox across restarts (stored under
# .maliang-sandbox/ in the worktree git root).
#
# Usage:
#   scripts/dev-sandbox.sh python -m maliang_cli.main
#   scripts/dev-sandbox.sh maliang desktop
#   scripts/dev-sandbox.sh electron .
#   scripts/dev-sandbox.sh -- npm run dev   # from apps/desktop/
#   scripts/dev-sandbox.sh --persistent maliang desktop
#   scripts/dev-sandbox.sh --persistent -- npm run dev
#
# Seed the sandbox MALIANG_HOME from an existing directory (e.g. your main
# ~/.maliang) so config, sessions, skills, etc. are pre-populated:
#   scripts/dev-sandbox.sh --from ~/.maliang maliang desktop
#
# Override the app name (default: MaliangSandbox):
#   MALIANG_DEV_SANDBOX_NAME=Staging scripts/dev-sandbox.sh maliang desktop
#
# Override the persistent sandbox dir name (default: .maliang-sandbox):
#   MALIANG_DEV_SANDBOX_DIR=.staging-sandbox scripts/dev-sandbox.sh --persistent maliang desktop

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_help() {
  cat <<'EOF'
Usage: dev-sandbox.sh [--persistent] [--from DIR] [--] <command...>

Run a Maliang instance in an isolated sandbox.

Options:
  --persistent    Keep the sandbox dir across restarts (under the worktree
                  git root, in .maliang-sandbox/). Without this flag the
                  sandbox is a temp dir that is removed on exit.
  --from DIR      Copy DIR into the sandbox MALIANG_HOME as the starting
                  point (config, sessions, skills, etc.).
                  Ignored if the sandbox MALIANG_HOME already has content
                  (e.g. reusing a --persistent sandbox) to avoid clobbering.
  --delete        Delete the existing persistent sandbox in .maliang-sandbox.
  -h, --help      Show this help message.

Environment:
  MALIANG_DEV_SANDBOX_NAME  Override the app name (default: MaliangSandbox)
  MALIANG_DEV_SANDBOX_DIR   Override the persistent dir name (default: .maliang-sandbox)

Examples:
  dev-sandbox.sh maliang desktop
  dev-sandbox.sh --persistent maliang desktop
  dev-sandbox.sh --from ~/.maliang maliang desktop
  dev-sandbox.sh -- npm run dev
EOF
}

PERSISTENT=false
DELETE=false
SEED_DIR=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --persistent)
      PERSISTENT=true
      shift
      ;;
    --from)
      if [ "$#" -lt 2 ] || [[ "$2" == -* ]]; then
        echo "error: --from requires a directory argument" >&2
        exit 1
      fi
      SEED_DIR="$2"
      shift 2
      ;;
    --from=*)
      SEED_DIR="${1#--from=}"
      if [ -z "$SEED_DIR" ]; then
        echo "error: --from requires a directory argument" >&2
        exit 1
      fi
      shift
      ;;
    --delete)
      DELETE=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [ -n "$SEED_DIR" ]; then
  if [ ! -d "$SEED_DIR" ]; then
    echo "error: --from dir '$SEED_DIR' does not exist" >&2
    exit 1
  fi
  # Resolve to absolute path so it's valid after we cd later.
  SEED_DIR="$(cd "$SEED_DIR" && pwd)"
fi

if [ "$#" -eq 0 ]; then
  print_help >&2
  exit 1
fi


SANDBOX_DIR_NAME="${MALIANG_DEV_SANDBOX_DIR:-.maliang-sandbox}"
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
GIT_ROOT="$(cd "$GIT_ROOT" && pwd)"
PERSISTENT_SANDBOX_ROOT="$GIT_ROOT/$SANDBOX_DIR_NAME"

if [ "$DELETE" = true ]; then
  if [ -d "$PERSISTENT_SANDBOX_ROOT" ]; then
    read -r -p "[sandbox] delete $PERSISTENT_SANDBOX_ROOT? [y/N] " REPLY
    case "$REPLY" in
      [yY]|[yY][eE][sS])
        echo "[sandbox] deleting $PERSISTENT_SANDBOX_ROOT" >&2
        rm -rf -- "$PERSISTENT_SANDBOX_ROOT"
        ;;
      *)
        echo "[sandbox] aborted" >&2
        exit 1
        ;;
    esac
  else
    echo "[sandbox] nothing to delete at $PERSISTENT_SANDBOX_ROOT" >&2
  fi
  exit 0
fi

# Derive a per-worktree app name so multiple checkouts don't collide.
# Each worktree has its own toplevel path even though they share one repo,
# so we hash that path into a short, stable suffix.
WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/..")"
WORKTREE_ROOT="$(cd "$WORKTREE_ROOT" && pwd)"
WORKTREE_HASH="$(printf '%s' "$WORKTREE_ROOT" | cksum | cut -d' ' -f1)"
WORKTREE_NAME="$(basename "$WORKTREE_ROOT")"
DEFAULT_SANDBOX_NAME="MaliangSandbox-${WORKTREE_NAME}-${WORKTREE_HASH}"

SANDBOX_NAME="${MALIANG_DEV_SANDBOX_NAME:-$DEFAULT_SANDBOX_NAME}"

if [ "$PERSISTENT" = true ]; then
  SANDBOX_ROOT="$PERSISTENT_SANDBOX_ROOT"
else
  SANDBOX_ROOT="$(mktemp -d -t maliang-sandbox.XXXXXX)"
fi

export MALIANG_HOME="$SANDBOX_ROOT/maliang-home"
export MALIANG_DESKTOP_USER_DATA_DIR="$SANDBOX_ROOT/user-data"
export MALIANG_DESKTOP_APP_NAME="$SANDBOX_NAME"

mkdir -p "$MALIANG_HOME" "$MALIANG_DESKTOP_USER_DATA_DIR"

if [ -n "$SEED_DIR" ]; then
  # Only seed when the sandbox MALIANG_HOME is empty — avoids clobbering an
  # existing persistent sandbox on re-run.
  if [ -z "$(ls -A "$MALIANG_HOME" 2>/dev/null)" ]; then
    echo "[sandbox] seeding MALIANG_HOME from $SEED_DIR" >&2
    cp -a "$SEED_DIR/." "$MALIANG_HOME/"
  else
    echo "[sandbox] --from ignored: $MALIANG_HOME already has content" >&2
  fi
fi

echo "[sandbox] MALIANG_HOME=$MALIANG_HOME" >&2
echo "[sandbox] userData=$MALIANG_DESKTOP_USER_DATA_DIR" >&2
echo "[sandbox] appName=$MALIANG_DESKTOP_APP_NAME" >&2
if [ "$PERSISTENT" = true ]; then
  echo "[sandbox] persistent: $SANDBOX_ROOT" >&2
else
  echo "[sandbox] ephemeral (will be cleaned up on exit)" >&2
fi

if [ "$PERSISTENT" = false ]; then
  cleanup() {
    chmod -R u+w "$SANDBOX_ROOT"
    rm -rf -- "$SANDBOX_ROOT"
  }
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM
fi

"$@"
rc=$?
exit $rc
