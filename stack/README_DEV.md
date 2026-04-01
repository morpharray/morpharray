# Developer guide — CI and local checks

This document describes **continuous integration (CI)** for the MorphArray Stack VS Code extension and how to match it on your machine.

## What CI is for

GitHub Actions runs a **predictable build** on every push and pull request targeting `main`. That catches problems that only show up on a **clean checkout** (for example, a missing dependency or a type error you did not see locally). It does not deploy the extension or publish to the Marketplace by itself.

## When workflows run

The workflow file is [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

| Trigger | Branches |
|--------|----------|
| `push` | `main` |
| `pull_request` | `main` (source branch can be anything) |

To run CI against another branch, add it under `on:` in the workflow file or open a PR into `main`.

## What the job does

A single job, **`build`**, runs on **`ubuntu-latest`** with **Node.js 22** (see `actions/setup-node`).

Steps, in order:

1. **Checkout** — Clone the commit under test.
2. **Install dependencies** — `npm ci`  
   - Uses **`package-lock.json` exactly**. If the lockfile is out of date with `package.json`, this step fails. Fix with `npm install` locally and commit the updated lockfile.
3. **Typecheck** — `npm run check-types` → `tsc --noEmit`  
   - Ensures TypeScript types check under `tsconfig.json` (excluding `src/test/**`).
4. **Lint** — `npm run lint` → `eslint src --ext ts`  
   - Runs ESLint with [`eslint.config.mjs`](eslint.config.mjs).
5. **Bundle** — `node esbuild.js --production`  
   - Production bundle to `dist/extension.js` (minified; aligned with a release-style build).

## CI vs local npm scripts

| Command | Typical use | Compared to CI |
|--------|-------------|----------------|
| `npm run compile` | Full dev check | Same typecheck + lint as CI, then **non-production** `esbuild` (e.g. sourcemaps as configured in [`esbuild.js`](esbuild.js)). |
| `npm run package` | Pre-publish style | Typecheck + lint + **production** esbuild — closest to what you want before packaging a `.vsix`. |
| CI | Automated gate | Typecheck + lint + **production** esbuild only (no single `npm run` name, but equivalent to the compile chain with a production bundle at the end). |

For day-to-day work, `npm run compile` or `npm run watch` is enough. Before a release or when debugging CI failures, run `npm run package` or mirror the CI steps manually.

## Reproducing CI locally

From the repository root:

```bash
npm ci
npm run check-types
npm run lint
node esbuild.js --production
```

If `npm ci` fails, run `npm install`, commit any `package-lock.json` changes, and try again.

## Maintenance you might do later

- **Bump Node** — When you change the Node version you use locally, update the `node-version` in `.github/workflows/ci.yml` so CI matches (or document the intentional difference).
- **Change build steps** — If you add tests (`npm test`), formatting, or `vsce package`, add matching steps to the workflow.
- **Another OS** — The job currently uses Ubuntu only. Optional: add a second job with `runs-on: windows-latest` (or `macos-latest`) to verify Windows/mac builds; that is extra YAML and slightly more maintenance.

## Where to look when CI is red

1. **npm ci** — Lockfile / `package.json` mismatch; or registry/network issues (rerun).
2. **Typecheck** — Fix TypeScript errors reported by `tsc`.
3. **Lint** — Fix or justify ESLint findings; run `npm run lint` locally.
4. **esbuild** — Import/bundle errors; run `node esbuild.js --production` locally for the stack trace.

CI logs for each run appear under the **Actions** tab on GitHub for this repository.
