# True Nature authority matrix

The native `/base/:baseId/authority-matrix` route now shows live member grants and a role comparison. The former edition placeholder is replaced by our own UI, using the existing BaseLayout and shared Teable components. No proprietary implementation or license check is copied or bypassed. The sidebar links to the new implementation for members with base read access.

The member list reads all pages from the existing authenticated collaborator API and fails closed on incomplete, duplicated or changing lists. Permission display uses the same `@teable/core` role definitions as the backend. Base and space permissions are unioned, not reduced to the highest role: the presets are not strictly nested for every action. Scope badges identify each grant. Shared links, API tokens, system identities and organization group expansion are outside this direct-member view; individual view locks can impose further limits.

An eligible direct base grant can be changed through a review dialog. The dialog previews changes to the common capabilities shown, retains inherited space grants, rechecks source membership before saving, calls the existing role-update API, and verifies readback before reporting success. This preflight is not an atomic compare-and-swap; the existing server transaction remains authoritative. The server applies actor/target role checks and its audit event. Failed or unverified updates require a reload before retrying. Owner cannot be assigned at base scope, self-role changes are omitted, and inherited roles link to native space settings. No role is changed automatically by deployment.

This is a base/space role matrix. It does not add table, field, record, artist or workflow-specific authorization. In this version Viewer can export tables, as the existing native role map permits. UI visibility is not a substitute for server enforcement.

Validation covers inheritance, union semantics, pagination, role choices, review/cancel/save/conflict/403 flows with intercepted test identities, native backend role checks, live membership readback, anonymous denial, light/dark desktop and WebKit phone layouts. Real team grants are compared before/after; no invitations or role changes are sent to actual members during UI tests.

Deploy and roll back through Dokploy using the private deployment/authority-matrix helper. The previous immutable release is retained. No database schema or stored grant migrations are required.
