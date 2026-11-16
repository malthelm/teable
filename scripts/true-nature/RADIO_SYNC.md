# True Nature radio updates

`radio-sync.mjs` runs as one bounded Dokploy worker. It reads the accessible True Nature label catalog and every page of expanded radio station timestamps once per hour. It stages responses before writing through Teable's normal permission-checked record API. It does not update historical non-radio metrics or import Airtable data.

The private directory named by `TRUE_NATURE_RADIO_SYNC_DIR` contains `config.json` (mode 0600), safe `status.json`, and restricted run captures and mutation journals. Configuration contains a base-scoped `teableToken`, optional Songstats `apiKey`, `enabled`, and `requestedAt`. The Teable token needs record read/create/update and base/table/field/view read; no delete or schema permissions. Renew it before its configured expiry. Never commit the private directory or log these credentials. `TRUE_NATURE_TEABLE_URL` is a deployment-controlled internal API origin.

The administrator-only connection form verifies the saved key against the fixed label endpoint. A failed replacement preserves the old credential. The browser receives only connection and freshness status. Keys are not sent to the assistant. Runtime credentials are stored in restricted server files; this is not a secrets vault.

A play's identity is track ID, station ID and UTC instant, so timestamp strings and numbers cannot produce duplicate rows. Existing plays are retained, source-owned summaries are updated, and saved views are not changed. New records have native links. Missing timestamp arrays or duplicate existing identities stop the import. Provider summary totals can differ from expanded details; those discrepancies are reported as coverage warnings rather than invented rows. Successful freshness advances only after readback verifies every returned detection and its links. A failed partial import is safe to resume; it does not advance last-success status.

HTTP 429 respects Retry-After with a minimum one-hour wait; manual refresh does not bypass that wait. Pause prevents future runs; an active run can finish. Status includes the worker heartbeat, last completed update, next check and failure. Source coverage and reporting delays still apply. Plays do not establish royalty eligibility or earnings.

For an authorized offline capture, `--once --snapshot DIR` uses the same import and verification pipeline. Capture files are `catalog-OFFSET.json` and `TRACK_ID-OFFSET.json`; keep all pages. Never run it concurrently with the worker. The worker's startup lock recovery assumes exactly one Dokploy-managed worker instance.

Rollback through Dokploy to the previous release and disable scheduling first. Preserve run journals and captures. Each before entry records changed fields, and each confirmed creation records its native ID; do not bulk-delete imported data as part of an application rollback. A failed network response may require reconciling native records by identity before considering data rollback.

Verification: `node --test scripts/true-nature/radio-sync.test.mjs`, backend radio-sync access tests, authenticated status/form checks, and a live readback of imported rows and native links. The assistant queries current permitted records for every question and includes sync status in its source context.
