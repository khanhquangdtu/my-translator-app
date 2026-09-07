---
name: deploy-translator
description: "Deploy my-translator-pwa to https://translator.rovatogroup.com — the AWS Lightsail instance behind that domain. Runs lint, test and build, copies the working tree to the instance, rebuilds the Docker stack, verifies the live site is serving that exact code, and only then commits and pushes. Use when asked to deploy, ship, release, or push this app live, or when asked to check what is currently deployed at translator.rovatogroup.com."
allowed-tools: [Bash, Read, Edit, Write, Glob, Grep]
---

# Deploy to translator.rovatogroup.com

Four steps, in this order. **Verification happens before the commit**, so a
deploy that does not reach the site is never recorded as one that did.

That ordering is why the script ships the *working tree* rather than `HEAD`:
sending `HEAD` at this point would deploy the previous commit, and the verify
step would then cheerfully confirm that stale code was live.

Everything below is driven by one script:

```bash
bash .claude/skills/deploy-translator/deploy.sh <stage>
```

Run it from the repository root. Stages are `check`, `sync`, `up`, `verify`,
and `all` (the first four in order). Run them **one at a time**, not `all`, so
a failure is attributable and you can stop before it reaches the instance.

## What you are deploying to

| | |
| --- | --- |
| Instance | Lightsail `my-translator`, `ap-southeast-1` |
| Address | `54.255.129.119` — the static IP `my-translator-ip`, so it survives a reboot |
| SSH | `ubuntu@`, key at `.aws/my-translator.pem` (gitignored) |
| Layout | `~/my-translator-pwa` is a **plain copy of the source, not a clone** — there is no git on the instance to pull with, which is what `sync` exists to do |
| Stack | `docker compose` with the prod overlay: app + mongo + Caddy for TLS |
| Runtime config | `.env.local` lives only on the instance and is never overwritten |

---

## 1. Check

```bash
bash .claude/skills/deploy-translator/deploy.sh check
```

Runs `lint`, `test` and `build`, each only if `package.json` defines it, and
stops at the first failure. This is the repo's own pre-flight from README's
"Before saying a change works" — `build` in particular catches route and import
errors that neither lint nor the unit tests see.

Do not deploy past a failure here. Fix it, or stop and report it.

## 2. Sync

```bash
bash .claude/skills/deploy-translator/deploy.sh sync
```

Stages the working tree (`git add -A`), turns it into a tree object, and sends
that to the instance over SSH. Going through git rather than tarring the
directory gets three things: `.gitignore` is honoured so `node_modules` and
local env files stay off the wire, text files are normalised to LF for the
Linux build, and the file list becomes a manifest the verify step can check
against.

It then **removes files on the instance that no longer exist here**, which
plain extraction would leave behind — a deleted route would otherwise keep
serving. `.env.local` is explicitly protected from that sweep.

`git add -A` leaves everything staged. If the deploy fails and you abandon it,
`git reset` unstages; nothing has been committed.

## 3. Up

```bash
bash .claude/skills/deploy-translator/deploy.sh up
```

Rebuilds the image, recreates the app container, and waits for it to report
healthy. Mongo and Caddy keep running; their volumes — including Caddy's issued
certificates, which are rate limited by Let's Encrypt — are untouched.

The recreation is forced, every time. A plain `up -d --build` was seen building
a new image and then leaving the old container running against the superseded
one — a deploy that reports success while the site serves the previous build.
The cost is a few seconds of downtime even when nothing changed, which is the
right trade for a command whose entire purpose is putting new code in front of
users.

Expect roughly two minutes on a cold cache, seconds when the layers are warm.

## 4. Verify

```bash
bash .claude/skills/deploy-translator/deploy.sh verify
```

This is the step that answers "is the newest code actually live?", and it does
it in four ways, from the disk outwards:

1. **The source on the instance is byte-for-byte this working tree.** Every
   file in the manifest is hashed on both machines and the two lists reduced to
   one digest.
2. **The running container is the image this deploy just built**, and reports
   healthy. This is the check that catches a build which succeeded while the
   old container kept serving.
3. **The public site answers over TLS** — `/` and `/api/config` both 200,
   through Caddy.
4. **Files served verbatim out of `public/`** (`pcm-worklet.js`, `sw.js`,
   `manifest.webmanifest`) are compared byte for byte against the working tree.
   This is the only check that follows a file the whole way — image, container,
   proxy — to what a browser receives.

It also prints the `/_next/static/chunks/*` hashes for `/live`. Those are
content-derived: they change when the bundle changes and stay put when it does
not, which distinguishes "a new build shipped" from "nothing needed
rebuilding". Reported, not asserted — neither answer is a failure.

The stage exits non-zero if any of 1–4 fail. **If it fails, do not commit.**
Report which check failed and what it means: a source mismatch is a bad copy, a
container mismatch means the rebuild did not take, an HTTP failure points at
Caddy or the app container rather than at the code.

## 5. Commit and push

Only after verify passes. Everything is already staged by step 2:

```bash
git commit -F - <<'EOF'
<subject>

<body>
EOF
git push origin main
```

Write the message yourself — do not template it. This repo's history is prose
that explains *why* a change was made, and a commit that says "deploy" tells a
future reader nothing. Match the surrounding style: an imperative subject line
under about 72 characters, then paragraphs explaining the reasoning, the
trade-offs and anything a future editor would trip over.

End the message with the trailers this repo uses:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: <the current session URL>
```

If the branch is not `main`, push to that branch instead — never force-push.

## When something goes wrong

Read the app logs before guessing:

```bash
ssh -i .aws/my-translator.pem ubuntu@54.255.129.119 \
  "cd my-translator-pwa && docker compose logs app --tail 50"
```

- **Compose aborts on `DOMAIN`** — `--env-file .env.local` was dropped. The
  script always passes it; a hand-run command probably did not.
- **The container is unhealthy** — the healthcheck hits `/api/config`, which
  reaches Mongo on a cold cache. Check the mongo container is up first.
- **TLS errors after a domain change** — Caddy re-issues on its own, but the
  `caddy-data` volume must survive. Deleting it forces a fresh Let's Encrypt
  issuance, which is rate limited.
- **The site is fine but shows old code** — almost always the service worker on
  the client, not the deploy. `public/sw.js` serves non-hashed assets
  stale-while-revalidate, so the *second* load after a deploy is the current
  one. Verify step 4 checks the network response, which is unaffected by that.
