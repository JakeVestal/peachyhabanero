#!/usr/bin/env bash
# Apply the newest peachyhabanero*.patch in ~/Downloads, then delete every
# matching patch there. Run from the repo root (WebStorm External Tool
# working directory = $ProjectFileDir$).
#
# WebStorm → Settings → Tools → External Tools → +
#   Name:              Apply latest peachyhabanero patch
#   Program:           /bin/bash
#   Arguments:         "$ProjectFileDir$/scripts/apply-latest-patch.sh"
#   Working directory: $ProjectFileDir$
#   [x] Open console
#
# Files the patch wants to *add* that already exist (scratch.html is the
# usual one — gitignored, so git apply refuses) are moved aside as
# *.bak-before-patch, then the patch version is written.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOWNLOADS="${DOWNLOADS:-$HOME/Downloads}"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "not a git repo: $ROOT" >&2
  exit 1
fi
if [[ ! -d "$DOWNLOADS" ]]; then
  echo "Downloads not found: $DOWNLOADS" >&2
  exit 1
fi

shopt -s nullglob
patches=(
  "$DOWNLOADS"/peachyhabanero*.patch
  "$DOWNLOADS"/peachyhabanero*.pach
)
if ((${#patches[@]} == 0)); then
  echo "no peachyhabanero*.patch in $DOWNLOADS" >&2
  exit 1
fi

latest=""
latest_mtime=0
for f in "${patches[@]}"; do
  m=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
  if (( m > latest_mtime )); then
    latest_mtime=$m
    latest=$f
  fi
done

echo "applying: $latest"

check_err=""
set +e
check_err=$(git apply --check "$latest" 2>&1)
check_st=$?
set -e

if (( check_st != 0 )); then
  backed=0
  while IFS= read -r line; do
    case "$line" in
      "error: "*: already exists in working directory)
        f="${line#error: }"
        f="${f%: already exists in working directory}"
        bak="${f}.bak-before-patch"
        echo "exists, moving aside: $f -> $bak"
        mv "$f" "$bak"
        backed=1
        ;;
    esac
  done <<< "$check_err"
  if (( backed == 0 )); then
    echo "$check_err" >&2
    exit "$check_st"
  fi
  git apply --check "$latest"
fi

git apply "$latest"
echo "applied."

for f in "${patches[@]}"; do
  rm -f "$f"
  echo "deleted: $f"
done
