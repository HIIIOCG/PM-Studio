# Website development and deployment

PM Studio is migrating to one Project List spreadsheet and one Apps Script. The 2026-10-13 scope covers backups, source-sheet consolidation, and rules only. The code and live websites still implement two independent Apps Script applications and a GitHub Pages anonymous snapshot. The new Script, simplified interface, deployment, and retirement of old resources remain later steps. See the [project rules](../AGENTS.md) for the current authority and the [public website guide](public-site.md) for the retained legacy release contract.

## Current data rules and migration boundary

The `專案列表` tab is the sole place to maintain project information, dates, status, and confirmed workspace allocations. Keep the header on row 5 and projects from row 6. Retain A:Q; remove the former R field `對外名稱` and use R:V as follows:

| Column | Field | Meaning |
| --- | --- | --- |
| R | `客戶編號` | Public customer code only; never the full customer field containing a name |
| S | `工作區 A 占用` | Confirmed allocation in workspace A |
| T | `工作區 B 占用` | Confirmed allocation in workspace B |
| U | `工作區 C 占用` | Confirmed allocation in workspace C |
| V | `工作區 D 占用` | Confirmed allocation in workspace D |

Preserve existing project IDs and dates. Missing or uncertain codes and assignments remain blank and require clarification; do not derive them from names or project categories. Back up before consolidation, preserve all confirmed allocations, and read back the source after writing. An edit to this guide does not prove that migration succeeded.

The target public service includes every project using its project ID and customer code, with dates and necessary workspace information. It no longer uses public aliases, per-project publication approvals, or a separate anonymous spreadsheet. Build the public response on the server from an explicit field allowlist. Project and customer names, staff names, internal goals, notes, source links, credentials, and private settings must never reach the public browser. Projects with incomplete dates or no assigned workspace remain visible as pending.

Maintain new allocations in the source sheet. Do not use the old website's `saveLayout` operation, which writes the separate settings spreadsheet. Do not call the old `publishApprovedSnapshot` operation after removing `對外名稱`, or restore that column to satisfy the old code. Preserve the old resources for recovery until the replacement is verified. This step does not change deployment identities, loosen access checks, run a release, or retire a deployment.

## Legacy application: local development

Use Node.js 24 and run these commands from the repository root. The build and test scripts use Node's built-in modules; no package installation is required.

```sh
node --test google-app/tests/*.test.mjs web/tests/timeline-core.test.mjs
node scripts/serve-google-preview.mjs
```

Open the [internal preview](http://127.0.0.1:4318/internal) or [public preview](http://127.0.0.1:4318/public). The preview uses fictional projects and a local mock service. Its assignments exist only in the running preview process; they are not saved to Google Sheets. Set `PM_STUDIO_GOOGLE_PREVIEW_PORT` to change the port.

The preview command rebuilds the HTML and deployment packages before starting the server. To build without starting a preview:

```sh
node scripts/build-google-ui.mjs
```

This generates `google-app/Index.html`, `google-app/PublicIndex.html`, and two deployment packages under the Git-ignored `local/google-app-bundle/` directory.

### Source files

| Location | Purpose |
| --- | --- |
| [web/dist/](../web/dist/) | Shared HTML template, styles, theme, and browser UI source used by the builder. Despite the directory name, these files are inputs to the Apps Script build. |
| [scripts/timeline-core.mjs](../scripts/timeline-core.mjs) | Workspace definitions, date handling, timeline calculations, and fictional preview data. |
| [google-app/ui/](../google-app/ui/) | Shared client, Apps Script bridge, payload validation, and separate internal/public features. |
| [google-app/Code.gs](../google-app/Code.gs) | Internal reads, workspace assignments, and authorized publication. |
| [google-app/PublicCode.gs](../google-app/PublicCode.gs) | Public reads from the anonymous feed only. |
| [google-app/appsscript.json](../google-app/appsscript.json) and [public-appsscript.json](../google-app/public-appsscript.json) | Separate deployment identities and OAuth scopes. |
| [scripts/build-google-ui.mjs](../scripts/build-google-ui.mjs) | Builds self-contained HTML and assembles the deployment packages. |
| [google-app/tests/](../google-app/tests/) and [web/tests/](../web/tests/) | Backend permissions, privacy, manifests, UI contracts, and timeline checks. |

Edit the source files and rebuild the generated HTML. Changes made directly to `Index.html` or `PublicIndex.html` will be overwritten. The builder extracts specific sections from the shared UI source, so changes to function boundaries also require checking the build script.

## Legacy application: data and permissions

The following contracts describe the existing code, not the new maintenance rules above. The old reader takes projects from `專案列表`, allocations from a separate settings spreadsheet, and public records from a third anonymous spreadsheet. It does not yet consume the consolidated R:V fields. Preserve this reference for maintenance and migration; do not continue parallel upkeep of the old allocation or approval tables.

Each internal request runs as the visiting Google user. The server requires a signed-in identity matching the effective user, then checks that user's access to the company Drive folder, project spreadsheet, and settings spreadsheet. Missing identity, configuration, or resource permission causes the request to fail. Workspace saves additionally require write access to the settings spreadsheet; publication requires write access to both settings and the anonymous feed. Ordinary internal access uses existing Google sharing permissions rather than an employee allowlist.

Keep actual file IDs and publisher accounts in Apps Script properties. Credentials, production URLs, internal directories, and private records must stay out of tracked source and documentation. Private operational configuration belongs in Git-ignored `local/operations/`. Original attachments and full transcripts are stored in Drive; matching local transcript copies belong in Git-ignored `transcripts/<project-id>/`.

### Spreadsheet structure

These are the old application's exact table contracts. They remain relevant when inspecting old code or backups; the current source-sheet schema above supersedes the old alias column.

| Spreadsheet | Required tabs | Header position and limits |
| --- | --- | --- |
| Project source | `專案列表` | Header on row 5, projects from row 6; last used row at most 1000 and last used column at most 64. |
| Settings | `工作區安排` (Workspace Arrangements), `公開設定` (Public Approvals) | Header on row 1; exact columns below; last used row at most 1000. |
| Anonymous feed | Exactly one tab: `匿名排程` (Anonymous Schedule) | Header on row 1; exactly six columns; last used row at most 1000. |

Prepare at least 1000 physical rows in every settings and feed tab. Writes replace rows 2–1000 while retaining the header, clearing previous records and cell notes. Settings and feed tables must contain values only, without formulas. Preserve existing source headers rather than replacing them with the anonymous schema.

The source header order can vary. Required fields are `案號`, `目前交付目標`, `客戶`, `負責人`, `狀態`, `原始開始`, `原始結束`, and either `專案名稱` or `專案／範圍`. Optional fields used by the current reader include `專案需求`, `執行者`, `目前排程開始`, `目前排程結束`, `修正開始`, `修正結束`, `延長修正／補充`, `交付步驟（參考）`, `對外名稱`, and `資料`.

The following table headers must match exactly, including order:

```text
工作區安排:
projectId | workspaceIds | workspaceUnits | updatedAt

公開設定:
projectId | approved | alias | approvedGoal | scheduleStart | scheduleEnd | approvedRevision

匿名排程:
alias | approvedGoal | scheduleStart | scheduleEnd | workspaceIds | workspaceUnits
```

`workspaceIds` is a JSON array, and `workspaceUnits` is a JSON object with exactly one positive integer allocation for each assigned workspace. For example, a fictional B+C assignment is `["B","C"]` with `{"B":2,"C":1}`.

Project IDs use a confirmed `C`, `BG`, `P`, `D`, or `O` prefix followed by a hyphen and at least three digits. They do not include a year. Keep an existing project's ID through revisions, rescheduling, and year changes, and check all previously used IDs before creating one.

### Scheduling rules

| Workspace | Work | Capacity |
| --- | --- | --- |
| A | 3D character modeling, with confirmed additional character work | Flexible; 2 characters is a usual-load reminder, not a maximum |
| B | 3D character modeling, with confirmed additional character work | Flexible; 2 characters is a usual-load reminder, not a maximum |
| C | Characters, environments, and other models | Flexible; maximum unspecified |
| D | CT game art outsourcing | Unspecified |

Assignments and occupied units must reflect confirmed arrangements. Do not infer workspace D from every project category, treat a project owner as its executor, or equate an entire project period with continuous occupancy. The timeline reminds users when overlapping A/B allocations exceed their usual load of 2; this does not reject an additional confirmed arrangement. All workspace maxima remain unspecified, and flexible allocation does not establish unlimited availability. In the workspace payload, `capacity` is `null` and A/B use a separate `usualLoad: 2` reminder threshold. The numeric allocation limit of 1000 is a data-validation bound, not production capacity.

The old website saves workspace arrangements to the separate settings table; that operation is no longer the maintenance route. Maintain dates, status, and allocations in the source sheet. Keep original dates, current rescheduled dates, and correction periods distinct. Use `YYYY-MM-DD` for confirmed full dates and `YYYY-MM` when only the month is known. Missing, incomplete, or reversed ranges remain pending. The old internal reader can use original dates when both current dates are empty and no rescheduling note indicates an unresolved schedule.

Week/month navigation, moving to today, and expanding past dates affect the view only. The timeline continues across years, and collapsing past dates does not close a project. Reference delivery steps do not establish completion. Google Calendar integration is disabled; notifications and messages require explicit authorization with a confirmed time, channel, and recipient.

## Legacy reference: Apps Script projects

These instructions document the old two-project deployment. Do not create another pair of projects as part of source-sheet consolidation. The single-Script replacement has not been implemented in this step.

Build the packages, then create two separate Apps Script projects. Copy each package's files into its corresponding project:

| Application | Package directory | Files to add |
| --- | --- | --- |
| Internal | `local/google-app-bundle/internal/` | `Code.gs`, `Index.html`, `appsscript.json` |
| Public | `local/google-app-bundle/public/` | `PublicCode.gs`, `PublicIndex.html`, `appsscript.json` |

Do not combine the two backends in one project. Enable the manifest editor in Apps Script project settings and apply the package's `appsscript.json`. Both manifests use V8 and the `Asia/Taipei` time zone.

### Script properties

Set these in each project's **Project Settings → Script Properties**:

| Property | Internal project | Public project |
| --- | --- | --- |
| `INTERNAL_FOLDER_ID` | Company Drive folder used for the access check | Do not set |
| `INTERNAL_SHEET_ID` | Project source spreadsheet | Do not set |
| `SETTINGS_SHEET_ID` | Separate settings spreadsheet | Do not set |
| `PUBLIC_FEED_SHEET_ID` | Separate anonymous feed spreadsheet | The same anonymous feed spreadsheet |
| `PUBLISHERS_JSON` | Administrator-managed JSON array of authorized publisher email addresses | Do not set |

The public project must contain **only** `PUBLIC_FEED_SHEET_ID`; it rejects additional properties. Publication is denied when the visiting user is absent from `PUBLISHERS_JSON`, including when that property is missing or invalid. This publisher list does not replace Google file permissions.

### Deploy and verify

1. In each Apps Script project, choose **Deploy → New deployment → Web app**.
2. Deploy the internal application as the user accessing the web app, with signed-in access: `USER_ACCESSING` + `ANYONE`. Its manifest requests spreadsheet access, read-only Drive access, and the user's email identity.
3. Deploy the public application as the deploying user, with anonymous access: `USER_DEPLOYING` + `ANYONE_ANONYMOUS`. Its manifest requests spreadsheet access, while its backend exposes only anonymous-feed reads. If organization policy does not offer anonymous access, leave this deployment private.
4. Complete Google authorization and record both deployment URLs privately. The public deployment account needs access to the anonymous feed; visitors do not receive its OAuth credentials.
5. Verify the internal application with an authorized account and verify that an account lacking the required resource permissions is denied. Test workspace saves and read back the saved settings. Dates and status must remain unchanged in the source sheet.
6. Verify the public application without signing in. Inspect its returned data as well as the page: it must contain only approved anonymous schedule information. Keep the initial feed empty until publication is explicitly approved.

A local preview or copied deployment package is not a live website. Confirm the deployed application and its readback before reporting it as available.

## Legacy reference: internal API and publication

These methods remain in the code. `saveLayout` and `publishApprovedSnapshot` are superseded operationally by the migration boundary above; their contracts are retained to explain the old implementation, not to require new aliases or approvals.

| Method | Behavior |
| --- | --- |
| `getTimeline()` | Reads current data without accepting mode, source, or revision arguments. |
| `saveLayout({assignments, allocations, revision})` | Validates a complete arrangement snapshot against the latest source revision, writes the settings table, and returns freshly read internal data. |
| `publishApprovedSnapshot({revision, approvals})` | Publisher-only operation that replaces the anonymous feed and approval table with the supplied approved snapshot. |

The internal UI calls `getTimeline` and `saveLayout`. Publication is available through the internal backend and has no button in the current UI. The public backend and browser bridge expose only `getTimeline`; URL parameters cannot switch views or data sources.

Before saving or publishing, read the latest internal data and use its `revision`. A source or arrangement change invalidates that revision, requiring a reload and review. Do not substitute a local snapshot when the latest source cannot be read.

Publication accepts at most 995 approvals. Each approval must contain exactly these fields:

```text
projectId, approved, alias, approvedGoal,
scheduleStart, scheduleEnd, workspaceIds, workspaceUnits
```

For every included project:

- `approved` must be the boolean `true`, with approval from an authorized person.
- `alias` must be unique, match the confirmed `對外名稱` in the source sheet, and use the current `專案 ` prefix followed by at least three digits.
- `approvedGoal` must be separately reviewed anonymous text. Never generate it automatically from the internal delivery goal. The backend rejects links, email markers, project IDs, formulas, control characters, and recognized private names.
- Dates must match the latest complete, valid project schedule. Workspace assignments and units must match the confirmed internal arrangements; at least one workspace is required.

Publication is a replacement, not an append: projects omitted from the approved snapshot are removed from the public feed, and an empty approvals array clears it. Review the entire snapshot before publishing. After publication, read back the anonymous feed, approval table, and public application to confirm the expected records; the returned publication count alone does not confirm that readback.

Only the six anonymous-feed fields may cross into the public spreadsheet. Internal project IDs, customer and staff names, source links, original dates, status, and alias mappings stay private. Privacy must be enforced on the server, before data reaches the public browser. An empty space on the public timeline is subject to team confirmation and does not create a reservation.
