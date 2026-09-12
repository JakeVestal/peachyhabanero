#!/usr/bin/env bash
# Apply the highest-numbered peachyhabanero*.patch in ~/Downloads that
# is not already in patch-record.txt.
#
# WebStorm → Settings → Tools → External Tools → +
#   Name:              Apply latest peachyhabanero patch
#   Program:           /bin/bash
#   Arguments:         "$ProjectFileDir$/scripts/apply-latest-patch.sh"
#   Working directory: $ProjectFileDir$
#   [x] Open console
#
# Pick order: highest peachyhabanero-NNN- prefix not yet recorded.
# On success: delete THAT Downloads file only, append its name to
# patch-record.txt at the repo root. On failure: leave Downloads alone.
#
# Hunks for gitignored local files (scratch, notes/) are skipped so a
# mixed patch still applies to tracked files. A patch that is *only*
# those files is recorded as skipped and removed so it cannot block.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOWNLOADS="${DOWNLOADS:-$HOME/Downloads}"
RECORD="$ROOT/patch-record.txt"
cd "$ROOT"

EXCLUDE=(
  --exclude=site/scratch.html
  --exclude=site/scratch.js
  --exclude=notes/REGIME-LOCK.md
  --exclude=notes/patch-record.txt
  --exclude=notes/*
)

if [[ ! -d .git ]]; then
  echo "not a git repo: $ROOT" >&2
  exit 1
fi
if [[ ! -d "$DOWNLOADS" ]]; then
  echo "Downloads not found: $DOWNLOADS" >&2
  exit 1
fi

recorded() {
  local base="$1"
  [[ -f "$RECORD" ]] && grep -Fxq "$base" "$RECORD"
}

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
  if recorded "$base"; then
    echo "  $base  n=$n  already in patch-record — skip"
    continue
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
  echo "nothing new to apply (all Downloads patches already recorded, or none found)"
  exit 0
fi

echo "applying: $latest"

check_err=""
set +e
check_err=$(git apply --check "${EXCLUDE[@]}" "$latest" 2>&1)
check_st=$?
set -e

if (( check_st != 0 )); then
  if echo "$check_err" | grep -qi 'no valid patches'; then
    echo "skip: patch is only gitignored files (scratch / notes). not applying."
    echo "$(basename "$latest")" >> "$RECORD"
    rm -f "$latest"
    echo "recorded skip and deleted: $latest"
    exit 0
  fi
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
    echo "apply failed; Downloads left in place" >&2
    exit "$check_st"
  fi
  git apply --check "${EXCLUDE[@]}" "$latest"
fi

git apply "${EXCLUDE[@]}" "$latest"
echo "applied."

echo "$(basename "$latest")" >> "$RECORD"
echo "recorded: $RECORD"
rm -f "$latest"
echo "deleted: $latest"
