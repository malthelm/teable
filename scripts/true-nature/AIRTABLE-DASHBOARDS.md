# Airtable dashboards

`/base/bsewefS0g8rtQDeFtbt/insights` uses the native BaseLayout, base permissions, table record APIs, shared UI components and theme. Funding, Catalog and Radio contacts are separate views selected by `?view=funding|catalog|contacts`.

The November 16, 2026 import contains 46 applications and 8 projects from Airtable Grant Applications, plus 133 recordings, 507 radio contacts and 12 artists from Airtable Label Suite v3. These five new tables are separate from Songstats and the live Label Suite release workspace. Actual rows are private database records, never frontend fixtures or public build assets. Source IDs, URLs and import time are retained. Six application/project relationships were verified; no recording has a primary artist link in the source, so none was inferred.

This is an explicitly dated snapshot. Reload records reads Teable; it does not refresh Airtable. A new source refresh requires fetching all pages from the connected Airtable source and reviewing source-ID differences before updating the imported tables. No recurring job or two-way sync is installed. The resumable private operational importer rejects changed destination values instead of overwriting edits. It normalizes whitespace as Teable does and verifies all imported values and actual links after writing.

Funding uses the source Status and Workflow Stage independently. It does not infer payments from approvals, treat past dates as current obligations, or sum amounts with unverified currency. Catalog presence checks do not assert clearance or delivery. Country/type charts count station records, not unique verified stations or plays. Email presence does not validate an address. City/state values are kept as supplied, including apparent reversals.

Source readiness is all "Needs attention" in this import; the UI summarizes a single category instead of inventing differences. All filters apply to summary counts, charts and the paged detail list. Record links open the native Teable record; source links open the original Airtable record. No private rows are stored in localStorage or bundled snapshots.

Validation: source counts and normalized values, linked-record readback, pagination and duplicate protection, intersected filters, missing-value semantics, desktop/WebKit phone layouts, native navigation, dark theme, error state and anonymous access denial. A physical installed-iPhone test is still a user acceptance step.

Rollback restores the previous immutable app release through Dokploy. Imported tables are retained for recovery; no source records or pre-existing Teable tables are deleted.
