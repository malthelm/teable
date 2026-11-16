# Ask True Nature

Native Teable page: `/base/bsewefS0g8rtQDeFtbt/ask`.

The AG-UI 1.0 endpoint uses the pinned 1.0.4 core/encoder SDK and the native
React interface uses HttpAgent. The assistant has two server-defined read-only
functions: imported radio detections and live Label Suite readiness. It cannot
execute SQL, browse, run commands, write records or send messages. Client tools,
state, system prompts and forwarded properties never grant authority.

Every request requires Teable session authentication and base read permission.
Radio queries additionally recheck record read permission and use RecordService's
permission-aware snapshots; release queries use the existing read-only Label
Suite projection. Shares, API and app tokens cannot use the personal provider.
No privileged API key is used to query Teable. Saved table filters are untouched.

Answers distinguish snapshot fetched dates, play timestamps (UTC) and live source
check times. Exact matching counts cover the complete bounded query; ranking lists
are top 15 and recent-play samples are 20. Invalid dates are counted separately.
No royalty estimates, registration claims or certification of audio quality.
Readiness remains the source's assessment, including unknown values. QA releases
are omitted consistently with the release workspace.

The server's existing Codex connection provides the language model. A restricted
host credential-handoff timer uses the existing Hermes resolver and refresh lock.
Only a short-lived access token is exposed through a private read-only directory
mount; refresh tokens and the wider credential stores are not mounted. The adapter
uses a fixed HTTPS provider endpoint, rejects redirects and never logs credentials.
The runtime model and credential path are environment configuration. This account
adapter depends on the existing login and provider limits; it is not an API-key
integration in Teable's AI settings. An expired connection fails clearly.

One active request per user, four overall, ten starts per minute per user; each
run has a 90-second timeout and at most four model rounds. Disconnect/Stop aborts
the provider stream. Conversations are browser-memory only and clear on leaving
the page. Provider requests use `store:false`; that is not a promise about all
provider-side retention. Source data is sent to the selected existing provider
as needed to answer the query.

Validation: source/date/count tests, denied-access and cancellation tests, frontend
typecheck, backend/frontend builds, live AG-UI request and authenticated browser
checks. Operational receipts and rollback are private under the deployment
workspace, outside version control. Physical iPhone acceptance remains separate
from WebKit device emulation.
