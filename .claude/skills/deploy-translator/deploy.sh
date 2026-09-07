#!/usr/bin/env bash
#
# Deploy my-translator-pwa to the Lightsail instance behind
# https://translator.rovatogroup.com. Run from the repository root:
#
#   bash .claude/skills/deploy-translator/deploy.sh <stage>
#
# Stages, in the order the skill runs them:
#
#   check    lint, test and build, each only if package.json defines it
#   sync     copy the working tree to the instance (mirrors deletions)
#   up       rebuild the image and recreate the app container
#   verify   prove the running site is built from this working tree
#   all      check -> sync -> up -> verify
#
# Committing is deliberately NOT a stage. The commit message is prose someone
# has to write; see SKILL.md.
#
# Every stage is safe to re-run. `up` recreates the app container every time,
# by design — see the note above `stage_up` — so re-running it costs a few
# seconds of downtime rather than nothing.

set -euo pipefail

# ── The deployment ─────────────────────────────────────────────────────────
# The IP is the static IP `my-translator-ip`, permanently attached to the
# instance, so it survives a reboot. If it ever does change:
#   npm run aws -- lightsail get-instances --query 'instances[].publicIpAddress'
HOST=54.255.129.119
SSH_USER=ubuntu
SSH_KEY=.aws/my-translator.pem
REMOTE_DIR=my-translator-pwa
DOMAIN=translator.rovatogroup.com
APP_CONTAINER=my-translator-pwa-app-1
APP_IMAGE=my-translator-pwa-app:latest

# Files that live on the instance and must never be treated as stale leftovers:
# `.env.local` holds DOMAIN, the Mongo URL and the admin secret, and exists only
# there. Losing it takes the site down until it is retyped.
REMOTE_KEEP='^(\.env\.local)$'

# `--env-file` is not optional: Compose interpolates ${DOMAIN} from `.env`
# alone, and the `:?` guard in the prod overlay aborts without it.
COMPOSE="docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.prod.yml --profile app"

ROOT=$(pwd)
WORK="${TMPDIR:-/tmp}/deploy-translator-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# State that has to survive between stages of the same run lives here rather
# than in the temp dir above, so `sync` and `verify` can be run separately.
STATE=.git/deploy-translator

ssh_run() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 "$SSH_USER@$HOST" "$@"
}

say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

# sha256sum prints "<hash> *path" on Windows and "<hash>  path" on Linux. The
# hashes agree; only the marker differs, and comparing raw output would report
# every file as changed.
normalise_sums() { sed 's/^\([0-9a-f]*\) [ *]/\1  /'; }

# ── check ──────────────────────────────────────────────────────────────────
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1']?0:1)"; }

stage_check() {
  for script in lint test build; do
    if has_script "$script"; then
      say "npm run $script"
      npm run "$script" || die "npm run $script"
    else
      say "no \"$script\" script in package.json, skipping"
    fi
  done
}

# ── sync ───────────────────────────────────────────────────────────────────
#
# The working tree goes up, not HEAD: this runs before the commit, so shipping
# HEAD would deploy the previous commit and the verify step would happily
# confirm that stale code was live.
#
# `git add -A` then `git write-tree` is how the working tree is turned into
# something `git archive` can send. It also gets the two things a hand-rolled
# tar would not: `.gitignore` is honoured, so `node_modules` and `.env.local`
# stay off the wire, and text files are normalised to LF exactly as a commit
# would store them — the instance builds Linux containers.
stage_sync() {
  say 'staging the working tree'
  git add -A
  local tree
  tree=$(git write-tree)
  mkdir -p "$STATE"
  echo "$tree" > "$STATE/tree"
  git ls-tree -r --name-only "$tree" | sort > "$STATE/manifest"
  printf 'tree %s, %s files\n' "$tree" "$(wc -l < "$STATE/manifest")"

  say "sending to $SSH_USER@$HOST:$REMOTE_DIR"
  git archive --format=tar "$tree" |
    ssh_run "mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && tar -x --overwrite" ||
    die 'could not copy the working tree to the instance'

  # tar overwrites and adds but never removes, so a file deleted here would
  # otherwise live on forever on the instance — a deleted route would keep
  # serving. Anything not in the manifest and not in REMOTE_KEEP goes.
  say 'removing files deleted since the last deploy'
  local extras
  extras=$(ssh_run "cd $REMOTE_DIR && find . -type f | sed 's|^\./||' | sort" |
    grep -vxF -f "$STATE/manifest" | grep -Ev "$REMOTE_KEEP" || true)
  if [ -n "$extras" ]; then
    printf '%s\n' "$extras"
    printf '%s\n' "$extras" | ssh_run "cd $REMOTE_DIR && xargs -d '\n' -r rm -f --"
  else
    echo 'none'
  fi
}

# ── up ─────────────────────────────────────────────────────────────────────
#
# `--force-recreate app`, and only `app`, for a reason worth knowing.
#
# A plain `up -d --build` was observed building a new image and then leaving the
# old container running against the superseded one — the deploy reported success
# while the site served the previous build. Forcing the recreation removes that
# entire class of "did it actually take?" doubt, and it is what makes the image
# check in `verify` meaningful rather than a coin flip.
#
# The cost is a few seconds of downtime on every deploy, including one where
# nothing changed. That is the right trade for a command whose whole purpose is
# to put new code in front of users. Naming the service keeps it to `app`: mongo
# and Caddy keep running, so the database connection pool and the issued
# certificates survive. Caddy re-resolves `app` on each dial, so it follows the
# new container without being touched.
stage_up() {
  say 'rebuilding and restarting on the instance'
  ssh_run "cd $REMOTE_DIR && $COMPOSE up -d --build --force-recreate app" ||
    die 'compose up failed'

  # The image this deploy produced. `verify` checks the running container is
  # actually this one, which is the difference between "a build happened" and
  # "the build that happened is what is serving".
  mkdir -p "$STATE"
  ssh_run "docker image inspect $APP_IMAGE --format '{{.Id}}'" > "$STATE/image"
  printf 'image %s\n' "$(cat "$STATE/image")"

  # The healthcheck has a 20 s start period and the probe reaches Mongo on a
  # cold secrets cache, so `verify` would otherwise race a container that is
  # still legitimately starting.
  say 'waiting for the container to report healthy'
  ssh_run "for i in \$(seq 1 45); do
    s=\$(docker inspect $APP_CONTAINER --format '{{.State.Health.Status}}' 2>/dev/null | tail -1)
    [ -n \"\$s\" ] || s=gone
    [ \"\$s\" = healthy ] && { echo healthy; exit 0; }
    [ \"\$s\" = unhealthy ] && { echo unhealthy; exit 1; }
    sleep 2
  done; echo \"gave up after 90s, last status: \$s\"; exit 1" || die 'the app container never became healthy'
}

# ── verify ─────────────────────────────────────────────────────────────────
stage_verify() {
  local failures=0
  local tree
  [ -f "$STATE/tree" ] || die 'no sync recorded — run the sync stage first'
  tree=$(cat "$STATE/tree")

  # 1. The source on the instance is byte-for-byte this working tree.
  #
  # Hashing each file in manifest order and hashing that list gives one number
  # comparable across the two machines. A mismatch means the copy was partial,
  # or something on the instance was edited by hand.
  say 'source on the instance'
  rm -rf "$WORK/tree" && mkdir -p "$WORK/tree"
  git archive --format=tar "$tree" | tar -x -C "$WORK/tree"
  local local_digest remote_digest
  local_digest=$(cd "$WORK/tree" && tr '\n' '\0' < "$ROOT/$STATE/manifest" |
    xargs -0 sha256sum | normalise_sums | sha256sum | awk '{print $1}')
  remote_digest=$(ssh_run "cd $REMOTE_DIR && tr '\n' '\0' | xargs -0 sha256sum" \
    < "$STATE/manifest" | normalise_sums | sha256sum | awk '{print $1}')
  printf 'local  %s\nremote %s\n' "$local_digest" "$remote_digest"
  if [ "$local_digest" = "$remote_digest" ]; then
    echo 'MATCH — the instance holds this working tree'
  else
    echo 'MISMATCH — the instance is not running this code'
    failures=$((failures + 1))
  fi

  # 2. The container is running the image built from that source, and is
  #    healthy. This is the check that catches a build which succeeded while
  #    the old container kept serving — see the note above `stage_up`.
  say 'container'
  local built running health
  built=$(cat "$STATE/image" 2>/dev/null || echo unknown)
  running=$(ssh_run "docker inspect $APP_CONTAINER --format '{{.Image}}'")
  health=$(ssh_run "docker inspect $APP_CONTAINER --format '{{.State.Health.Status}}'")
  printf 'built   %s\nrunning %s\nhealth  %s\n' "$built" "$running" "$health"
  [ "$built" = "$running" ] || { echo 'the container is NOT the image this deploy built'; failures=$((failures + 1)); }
  [ "$health" = healthy ] || { echo 'the container is not healthy'; failures=$((failures + 1)); }

  # 3. The public site answers, over TLS, through Caddy.
  say "https://$DOMAIN"
  local code
  for path in / /api/config; do
    code=$(curl -sS -o "$WORK/body" -w '%{http_code}' --max-time 20 "https://$DOMAIN$path") || code=000
    printf '%-14s %s\n' "$path" "$code"
    [ "$code" = 200 ] || failures=$((failures + 1))
  done
  printf '/api/config    %s\n' "$(cat "$WORK/body")"

  # 4. Files served verbatim from `public/` are compared byte for byte against
  #    this working tree. Everything above proves the instance holds the code;
  #    this is the one check that follows a file all the way through the image,
  #    the container and the proxy to what a browser actually receives.
  say 'served assets match the working tree'
  for asset in pcm-worklet.js sw.js manifest.webmanifest; do
    if curl -sS --max-time 20 -o "$WORK/served" "https://$DOMAIN/$asset" &&
      cmp -s "$WORK/served" "$WORK/tree/public/$asset"; then
      printf '%-22s identical\n' "$asset"
    else
      printf '%-22s DIFFERS from public/%s\n' "$asset" "$asset"
      failures=$((failures + 1))
    fi
  done

  # Reported, not asserted. The hashes are content-derived, so they change when
  # the bundle changes and stay put when it does not — useful for telling "a
  # new build shipped" from "nothing needed rebuilding", which is not something
  # a deploy should fail over either way.
  say 'bundle fingerprint (informational)'
  curl -sS --max-time 20 "https://$DOMAIN/live" |
    grep -o '/_next/static/chunks/[^"]*' | sort -u | head -8

  say 'result'
  if [ "$failures" -eq 0 ]; then
    echo 'VERIFIED — the deployed site is built from this working tree'
  else
    die "$failures check(s) failed — do not commit this as a successful deploy"
  fi
}

case "${1:-all}" in
  check) stage_check ;;
  sync) stage_sync ;;
  up) stage_up ;;
  verify) stage_verify ;;
  all)
    stage_check
    stage_sync
    stage_up
    stage_verify
    ;;
  *) die "unknown stage '${1}' (check | sync | up | verify | all)" ;;
esac
