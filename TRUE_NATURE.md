# True Nature's Teable fork

This fork is the foundation for a relational music workspace with Teable's native spreadsheet grid, linked-record picker and record editor. It retains upstream Teable branding and licensing.

- Fork: https://github.com/malthelm/teable
- Working branch: `true-nature`
- Upstream: https://github.com/teableio/teable, branch `develop`
- Starting revision: `b8425f5a60d056205adc456b9e8011ff7d622a29`
- Upstream toolchain: Node `24.22.2` (`.nvmrc`), pnpm `12.11.2` (`packageManager`).

## First addition: relational Songstats import

`scripts/true-nature/songstats.py` reads the saved export containing `manifest.json` and `normalized/*.jsonl`. It adds native Teable relationships while retaining the original source columns and raw-response archive:

- Artists ↔ Tracks (many-to-many)
- Radio Plays → Track and Station (with reverse links for navigation)
- Track Stations → Track and Station
- Daily History, Current Metrics, Activities and Detailed Records → their actual Track, Artist or Label and Platform
- Source Links → Track and Platform

Artist and label profiles are separated. Label aggregates never become fictional tracks. IDs, rather than display names, determine every relationship. Unknown references and duplicate source keys stop the import before mutation. Missing values remain missing; zero is preserved. Date/time fields use UTC; source JSON remains authoritative for the original representation.

All imported data is a dated snapshot, including radio detections rather than royalty statements. Some history contains provider-generated zero-filled dates. The source summary and detail totals may differ; the importer retains them separately.

## Use

No dependencies beyond Python 3.10+ on Linux/macOS are needed for the integration. From the repository root:

```sh
# Offline validation and counts; does not contact Teable or change data.
python3 scripts/true-nature/songstats.py /path/to/songstats-import

# Create an empty, dedicated base in Teable first. Supply its base ID below.
# Provide TEABLE_TOKEN securely in the process environment; never commit it.
python3 scripts/true-nature/songstats.py /path/to/songstats-import \
  --apply --url https://your-teable.example --base bseYOURBASEID \
  --state .true-nature/import-state.json

python3 -m unittest discover -s scripts/true-nature -p 'test_*.py'
```

After building the packages, validate a generated schema against this checkout's actual API validators:

```sh
mkdir -p .true-nature
python3 scripts/true-nature/songstats.py /path/to/songstats-import \
  --schema .true-nature/schema.json
node scripts/true-nature/check-contracts.mjs .true-nature/schema.json
```

On Winona, run imports, builds and browser tests through `winona-batch-run`; add `--resource-check winona-resource-check` to imports. Exit 75 means stop and wait for resource admission. Use Dokploy for deployed previews and production. Never point development or test configuration at an existing application's database.

The token needs table/field/record read and create access to the dedicated base. Use the instance's token editor to select those scopes. The script never logs the token, follows redirects, deletes records or overwrites existing values. First use requires an empty base. A checkpoint binds subsequent runs to the exact origin, base and snapshot digest. Resume the same command after a network interruption: committed rows are read back and matched before more rows are inserted. Simultaneous runs using the same checkpoint are rejected by a file lock. Imported fields are verified after each table, including linked record IDs; extra user-created fields are outside that comparison.

Data, credentials, checkpoints, logs and screenshots belong outside the repository or under ignored `.true-nature/`. The public fork contains only code, documentation and synthetic test records. A new source snapshot should initially use a new base; ongoing synchronization and conflict resolution are separate work.

## Development and upstream updates

```sh
corepack pnpm install --frozen-lockfile
node --test scripts/true-nature/build-config.test.cjs
corepack pnpm -r --workspace-concurrency=1 --filter './packages/**' run build
corepack pnpm -F @teable/backend build
NEXT_BUILD_ENV_CPUS=2 corepack pnpm -F @teable/app build
```

Use the upstream deployment/build documentation for PostgreSQL, Redis, assets and application settings. Generate independent secrets for each environment. An installed dependency tree or successful compilation is not proof of a working deployment: verify login, a scoped token, native linked-record navigation, editing and denied access in an isolated source-built runtime before switching users.

`NEXT_BUILD_ENV_CPUS` is an optional positive integer controlling Next.js page-generation workers. On Winona, use `2` to avoid the upstream default launching many workers at once. Leaving it unset in a direct build preserves the upstream default. The fork's Dockerfile defaults this build argument to `2`; override it with `--build-arg NEXT_BUILD_ENV_CPUS=...`. It does not limit every compilation thread or replace OS resource controls.

Keep `develop` as the upstream reference and development on `true-nature`. Fetch `upstream`, review changes, then merge a pinned upstream revision into a working branch and run the relevant checks. Keep integration changes outside the core unless a specific product need requires them.

## Next product milestones

1. Source-built isolated preview with login and scoped API verification.
2. Import a copy of the existing Songstats snapshot and exercise real relationships in the browser.
3. Refine saved views and record layouts around artist, track and radio-station work.
4. Add scheduled ingestion with explicit provenance and conflict handling.
5. Assess finer permissions and agent workflows against the community implementation.

Commercial-image features are not assumed to exist in this source fork. The upstream `LICENSE` and `AGPL_LICENSE` remain authoritative; this fork makes no promise of unrestricted rebranding or parity with paid Teable features.

## Recovery

This fork and its importer do not alter the existing Budibase database. A preview base is additive and can remain available while being evaluated. Preserve the checkpoint and original snapshot for recovery. Do not delete the preview base until it is confirmed to contain no unique human edits. Code changes can be reverted on the fork without replacing upstream or modifying any data.
