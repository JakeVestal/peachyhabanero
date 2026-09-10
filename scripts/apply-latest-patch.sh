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
# Pick order: highest peachyhabanero-NNN- prefix, else newest mtime.
# Downloads copies are always removed (success or fail) so a broken older
# patch cannot win the next run.
#
# Files the patch wants to *add* that already exist (scratch.html / .js
# are gitignored, so git apply refuses) are moved aside as
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

cleanup_downloads() {
  local f
  for f in "${patches[@]}"; do
    rm -f "$f"
    echo "deleted: $f"
  done
}
trap cleanup_downloads EXIT

latest=""
latest_n=-1
latest_mtime=0
unnumbered=""
unnumbered_mtime=0
echo "found:"
for f in "${patches[@]}"; do
  m=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
  base=$(basename "$f")
  n=-1
  if [[ "$base" =~ peachyhabanero-([0-9]+) ]]; then
    n=$((10#${BASH_REMATCH[1]}))
  fi
  echo "  $base  n=$n  mtime=$m"
  if (( n >= 0 )); then
    if (( n > latest_n )) || { (( n == latest_n )) && (( m > latest_mtime )); }; then
      latest_n=$n
      latest_mtime=$m
      latest=$f
    fi
  elif (( m > unnumbered_mtime )); then
    unnumbered_mtime=$m
    unnumbered=$f
  fi
done
if [[ -z "$latest" ]]; then
  latest=$unnumbered
  latest_n=-1
fi
if [[ -z "$latest" ]]; then
  echo "could not pick a patch" >&2
  exit 1
fi

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
      *"already exists in working directory")
        f="${line#error: }"
        f="${f%: already exists in working directory}"
        bakdir="${TMPDIR:-/tmp}/peachyhabanero-baks"
        mkdir -p "$bakdir"
        bak="$bakdir/$(basename "$f").bak-before-patch"
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
