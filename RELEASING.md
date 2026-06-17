# Releasing

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versioning and npm publishing. Releases are fully automated via GitHub Actions — you never run `npm publish` by hand.

## Normal release flow

### 1. Add a changeset to your PR

After making changes, run:

```bash
pnpm changeset
```

The CLI will ask:

- **Which packages changed?** — select with spacebar (only packages under `packages/` matter; skip `demo`)
- **What kind of change?**  
  NOTE: Release ALL changes as a "patch"
  - `patch` — bug fix, internal tweak (0.0.x)
  - `minor` — new feature, backwards-compatible (0.x.0)
  - `major` — breaking change (x.0.0)
- **A summary** — one line describing the change (goes into the changelog)

This writes a small markdown file into `.changeset/`. Commit it along with your code changes in the same PR.

> If your PR is purely internal (CI config, docs, test fixtures, demo app) and doesn't affect any published package, skip this step — merging without a changeset is safe and does nothing.

### 2. Merge your PR to `main`

The GitHub Action detects the pending changeset and opens a **"Version Packages"** PR automatically. This PR:

- Bumps the version in each affected `package.json`
- Updates each package's `CHANGELOG.md`
- Deletes the consumed changeset file(s)

Review it, then merge when ready to ship.

### 3. The publish happens automatically

When the Version Packages PR is merged, the Action runs again, sees no pending changesets, builds all packages, and publishes to npm. No manual steps.

---

## Releasing multiple PRs together

Changeset files accumulate. If three PRs each add a changeset, the Version Packages PR will batch all three into one version bump and publish them together when merged. You don't need to do anything special.

---

## Bumping a specific package only

Changesets handles per-package versioning automatically. If only `market-widget` changed, only `market-widget` gets a version bump — `market-core` and `market-sdk` are untouched unless they appear in a changeset or are affected via `updateInternalDependencies`.

---

## Emergency / manual publish

If you ever need to publish outside the normal flow:

```bash
pnpm build
pnpm publish -r --no-git-checks
```

Requires `NODE_AUTH_TOKEN` to be set in your local environment.

---

## Setup (one-time, already done)

- `@changesets/cli` installed as a dev dependency
- `.changeset/config.json` configured for this monorepo
- `.github/workflows/release.yml` wired to `changesets/action`
- GitHub repo secret `NPM_TOKEN` must be set (Settings → Secrets → Actions)
