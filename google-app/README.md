# PM Studio read-only Apps Script

One Apps Script reads the Google `專案列表` sheet and serves the public schedule. Staff edit the sheet directly under its Google sharing permissions. The website provides no editing, save, publication, or internal-mode operation.

| File | Purpose |
| --- | --- |
| `Code.gs` | Read the source and construct an explicit public field allowlist |
| `Index.html` | Generated, self-contained schedule interface |
| `appsscript.json` | V8, Asia/Taipei, Advanced Sheets v4, read-only OAuth scope |
| `ui/` | Browser bridge, payload validation, and rendering client |

The main sheet keeps its header on row 5 and records from row 6. A:Q retain business data. R is `客戶編號`; S:V are `工作區 A 占用`, `工作區 B 占用`, `工作區 C 占用`, and `工作區 D 占用`. The former `對外名稱` column is removed. Customer codes contain codes only; confirmed workspace units are positive integers, while unassigned or uncertain cells stay blank.

## Public contract

`getTimeline()` accepts no arguments. `doGet` accepts no query, path, or mode parameters. All helper functions end in `_` so they cannot be invoked through the browser bridge. There is no write endpoint.

The response has exactly these schema 2 fields:

```text
schemaVersion: 2
today, syncedAt
projects: [{ id, customerCode, start, end, correctionStart, correctionEnd,
             workspaceIds, workspaceUnits, pendingReasons }]
workspaces: [{ id, name, usualLoad? }]
warnings
```

Project IDs use the confirmed `C`, `BG`, `P`, `D`, or `O` prefix and at least three digits; customer codes use uppercase letters, a hyphen, and digits. Names, real delivery goals, status, notes, source links, original-row objects, and private settings are excluded on the server. Original dates may supply the current schedule only under the documented fallback rule; no separate original-date fields are returned.

Pending reasons are fixed codes: `no-workspace`, `workspace-values`, `production-dates`, `correction-dates`, and `customer-code`. Source warnings are `project-id-missing` and `project-id-invalid`; invalid identifiers are not echoed. Duplicate project IDs reject the read. Service failures return one generic message rather than private service details.

Incomplete dates and assignments keep valid projects in the response. The interface shows a continuous timeline with earlier/later dates, today, Chinese/English, correction periods, and a pending list. It has no search, details editor, or workspace save. A/B usual load of 2 is a reminder, not a capacity limit.

## Build and configure

```sh
node scripts/build-google-ui.mjs
node scripts/serve-google-preview.mjs
node --test google-app/tests/*.test.mjs
```

Build from the repository root; edit `web/dist/` and `ui/`, then regenerate `Index.html`. The package `local/google-app-bundle/single/` contains only `Code.gs`, `Index.html`, and `appsscript.json`. Preview records at `http://127.0.0.1:4318/` are fictional and never written to Google.

Configure exactly one Script property, `SOURCE_SHEET_ID`, with the private main-sheet ID. Enable Advanced Sheets v4; the only OAuth scope is `https://www.googleapis.com/auth/spreadsheets.readonly`. Deploy as `USER_DEPLOYING` with `ANYONE_ANONYMOUS` access. The deployment account needs read access to the source; visitors receive only the allowlisted response. `doGet` permits iframe embedding for the Pages entry.

Read the [deployment guide](../.agents/web-development.md) before changing a deployment and the [Pages guide](../.agents/public-site.md) before publishing its entry. Actual source IDs, execution URLs, credentials, and deployment status belong only in ignored private operation records. Local builds do not prove live deployment.
