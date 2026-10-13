# PM Studio development and deployment

The repository implements one Google Project List, one read-only Apps Script, and a GitHub Pages entry that embeds it. Read [AGENTS.md](../AGENTS.md), [the Script contract](../google-app/README.md), and the latest ignored `local/operations/` records before changing data or deploying. Live status is established by readback, not by this document.

## Source and data boundaries

The `專案列表` header is on row 5; records start at row 6. A:Q retain the existing business fields. R is `客戶編號`; S:V contain `工作區 A 占用`, `工作區 B 占用`, `工作區 C 占用`, and `工作區 D 占用`. There is no `對外名稱`. Dates, status, customer codes, and allocations are maintained only in this sheet under existing Google permissions.

Read the current cloud source before any edit, preserve others' changes, and read back afterward. Never replace unavailable current data with an old snapshot. Keep original dates, current dates, and correction dates distinct. Existing business data and source links are not rewritten by a code migration.

`Code.gs` reads formatted values through Advanced Sheets v4, validates at most 1000 used rows and 64 columns, and constructs the schema 2 response field by field. Only identifiers, selected schedule dates, workspace allocations, and fixed pending/warning codes cross the server boundary. Names, goals, notes, personnel, source links, and settings never enter the browser, even as hidden fields. The exact public keys and enums are listed in [google-app/README.md](../google-app/README.md).

Both empty current-date fields may fall back to original dates only when the supplemental note does not signal an unresolved reschedule. Missing, month-only, impossible, or reversed ranges remain pending. A correction period is separate from production. No date is guessed or written back.

Assignments use only confirmed positive integer units from S:V. Blank means unassigned or unconfirmed; do not infer assignments from names or categories. A/B usual load of 2 is a reminder; no workspace has a fixed maximum. A/B/C allow confirmed additional character work; C also covers environments and other models, and D is for CT game art. A project period does not establish continuous occupancy or bookable capacity.

## Source files and local checks

| Location | Purpose |
| --- | --- |
| `web/dist/` | Hand-maintained HTML, CSS, timeline, and localization inputs |
| `google-app/ui/` | Read-only Google bridge, strict payload contract, client |
| `google-app/Code.gs` | Single server with public field selection |
| `google-app/appsscript.json` | Read-only service manifest |
| `scripts/build-google-ui.mjs` | Generate HTML and the single deployment package |
| `scripts/serve-google-preview.mjs` | Fictional local preview with no Google writes |
| `google-app/tests/` | Data boundary, dates, UI, manifest, and Pages checks |

Use Node.js 24 with built-in modules; no dependency installation is needed.

```sh
node --test google-app/tests/*.test.mjs
node scripts/build-google-ui.mjs
node scripts/serve-google-preview.mjs
```

Preview `http://127.0.0.1:4318/`; `PM_STUDIO_GOOGLE_PREVIEW_PORT` may change the port. Preview records are fictional. The build generates `google-app/Index.html` and `local/google-app-bundle/single/{Code.gs,Index.html,appsscript.json}`. Edit inputs rather than generated HTML.

The interface retains earlier/later dates, today, Chinese/English, production/correction legends, and pending records. It does not expose search, editing, writeback, or per-project publication controls. Failed reads display a neutral failure, never fabricated records or private service errors.

## Configure and deploy the single Script

1. Preserve the current source and deployment recovery records before replacing files. Use the package above in the single retained Script project.
2. Configure exactly one Script property: `SOURCE_SHEET_ID`. Store its real value only in Google properties and local private operations. Remove the obsolete settings/feed/publisher properties from the replacement project.
3. Use the committed manifest: V8, `Asia/Taipei`, Advanced Sheets v4 (`Sheets`), and only `https://www.googleapis.com/auth/spreadsheets.readonly`. Do not add broader scopes to resolve a read failure.
4. Deploy as `USER_DEPLOYING` with `ANYONE_ANONYMOUS`. The deployment account must be able to read the source. If policy disallows anonymous deployment, leave the public cutover incomplete and report the constraint.
5. Only `doGet` and argument-free `getTimeline` are public functions. Helpers end in `_`; no POST/write/internal-mode API exists. Queries and additional paths are rejected. `doGet` uses `XFrameOptionsMode.ALLOWALL` for the Pages iframe.
6. Read back the deployed version and anonymous response. Compare IDs, counts, dates, pending records, and allocations with the latest source. Confirm exact schema 2 keys, no private values, generic errors, and desktop/mobile date navigation.
7. Record verified deployment details locally, then update the [Pages entry](public-site.md). A local build or copied package is not evidence of a live service.

After the new Script and Pages entry pass live readback, move obsolete settings, anonymous data, and superseded Script files into Drive history backups; disable their old deployments and verify retirement. Keep recovery records and previous source history. Do not leave old writable sites as parallel maintenance routes or claim retirement before checking it.

Changes are confined to PM Studio. Do not modify the company homepage, other repositories, visibility, domain/DNS settings, or unrelated cloud resources. Production IDs, URLs, directories, credentials, and original transcripts remain outside Git. Google Calendar stays disabled; no notifications, scheduled jobs, or messages are added without explicit authorization.
