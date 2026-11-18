# Patch-Cutting Guidance (peachyhabanero)

When asked to cut a patch for this repository:

1. Cut the patch against the current state of the files on GitHub (https://github.com/JakeVestal/peachyhabanero), not against thread memory or a local copy that may be stale. Fetch the relevant files if needed so the patch applies cleanly.

2. Produce a unified diff that applies with `git apply` (or the project’s apply script). Avoid trailing whitespace, corrupted lines, incomplete hunks, or context that does not match the live file.

3. Place the finished `.patch` file in the Grok thread (or in artifacts) so it has a download button. The user downloads it from there.

4. The user applies patches by downloading the file and running `scripts/apply-latest-patch.sh` (usually from WebStorm’s External Tools). The script looks in `~/Downloads` for the highest-numbered patch that is not already recorded in `patch-record.txt`.

5. Naming convention (see `patch-record.txt`):
   - Format: `{prefix}-{number}-{short-note}.patch`
   - Prefix for this repo is `peachyhabanero`.
   - Number is an integer. Increment the highest number currently in `patch-record.txt` by 1. Do not use letters in the number.
   - Short note is a brief kebab-case description.
   - Example: `peachyhabanero-131-ai-guidance.patch`

6. After the patch is applied and pushed, it is recorded in `patch-record.txt`. Do not reuse a number.

7. Prefer small, focused patches. If a change touches several files, one patch that includes all of them is fine as long as every hunk applies cleanly.

8. If the correct prefix or next number is unclear, check `patch-record.txt` or ask before writing the patch.
