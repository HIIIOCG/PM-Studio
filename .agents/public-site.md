# Public GitHub Pages website

The public website is published by this PM Studio repository's own GitHub Pages workflow. It reuses the timeline interface and reads a same-site `data/schedule.json` file. The internal and public Apps Script projects remain independent. The Google `專案列表` remains the sole source of current project information; the JSON snapshot is a derived publication artifact, never another project register.

Repository visibility and Pages activation remain under the user's control. Preparing or pushing the source does not activate Pages or change repository visibility. Do not publish this project through the company homepage repository or another repository without separate explicit authorization.

## Manual publication

1. Read the latest Google source and confirmed arrangements. An authorized publisher reviews the exact anonymous names, public goals, dates and workspaces, then uses the existing `publishApprovedSnapshot` operation. Its publisher configuration and revision checks remain mandatory. Building the website does not grant approval or bypass that operation.
2. Read back the independent `匿名排程` spreadsheet and approval settings. Export only the anonymous table's six columns. Keep the source export in the Git-ignored `local/public-release/` directory. Never export the internal project table into this workflow.
3. Export the reviewed public artifact and build the website:

```sh
node scripts/export-public-snapshot.mjs --feed local/public-release/anonymous-feed.csv --output public/data/schedule.json
node scripts/build-public-site.mjs --snapshot public/data/schedule.json
```

The exporter also accepts JSON containing an array of rows or an object with exactly one `values` array. The first row must be the exact anonymous-feed header:

```text
alias,approvedGoal,scheduleStart,scheduleEnd,workspaceIds,workspaceUnits
```

Workspace columns contain JSON text. Only confirmed full dates in `YYYY-MM-DD` are valid in the approved feed. Unknown fields, internal identifiers, links, email addresses, formulas and invalid dates or allocations are rejected. Format validation does not replace the human approval and Google publication permission established in steps 1 and 2.

An independently read-back header-only feed legitimately produces an empty public schedule. A missing feed, failed read or missing snapshot does not authorize an empty replacement or fictional records. If the current anonymous feed is already approved and verified, re-exporting it does not require modifying the Google source or publishing it again there.

`public/data/schedule.json` is the reviewed, canonical public artifact committed with the repository. It contains no Google IDs, deployment URLs, customer or staff names, internal project identifiers, original dates, status, source links, or alias mappings. Original exports and private operational settings stay outside Git.

4. Preview the completed site:

```sh
node scripts/serve-public-site.mjs
```

Open `http://127.0.0.1:4320/PM-Studio/`. This local preview serves only the built HTML and anonymous JSON. It uses the supplied snapshot, including an explicitly verified empty snapshot, and never substitutes demo projects.

5. Review the public artifact and source changes before committing. The build generates only `index.html`, `data/schedule.json` and `.nojekyll` under Git-ignored `local/public-site/`. It stages a complete output before replacing a previously clean build and preserves the previous publication if generation or installation fails. Never upload the repository root, Google deployment packages, tests or local operational files as the Pages artifact.
6. After the user has chosen to make the repository public and enabled **Settings → Pages → Source: GitHub Actions**, manually run the [Pages workflow](../.github/workflows/pages.yml). The workflow builds from `public/data/schedule.json` and deploys only `local/public-site/`. It does not change visibility, configure Pages on the user's behalf, write to other repositories, or deploy in response to a push. Confirm the intended branch and reviewed snapshot before dispatch.
7. Read back the deployed HTML and JSON. Verify that the JSON exactly matches the reviewed artifact, its publication time is correct, and anonymous desktop and mobile browsers can load the page, navigate dates, search and open project details. Do not report the website as online until the deployment and readback succeed.

This is a manual release process. It adds no scheduled jobs, notifications, messages, or Calendar integration. Actual Google IDs, deployment URLs and credentials stay in private operational configuration.

## Hosting and paths

The intended project path is `/PM-Studio/`, matching the repository name and capitalization. Relative public assets work under this prefix. Verify both the project entry and its trailing-slash behavior after activation.

When the organization's existing Pages homepage has a custom domain, a project Pages site with no separate custom domain inherits it and appends the repository name. Keep PM Studio's custom-domain setting empty; do not add a separate `CNAME` or modify the company's existing domain or DNS configuration. See [GitHub's custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

The repository's own Pages workflow is the publication route. If visibility or activation is pending, leave the reviewed source and artifact ready for the user. Do not substitute an existing company-site directory or change another repository's publishing settings.

## Data and browser behavior

The published schema is exactly:

```text
schemaVersion: 1
publishedAt: ISO UTC timestamp including milliseconds
projects: [{ alias, goal, start, end, workspaceIds, workspaceUnits }]
```

Publication time is set during the manual export and retained when rebuilding. The browser computes today's date in `Asia/Taipei`, independently of publication time, so navigation remains current after a snapshot ages. The screen displays the last publication date and time in Taipei time.

The page reads `./data/schedule.json` without credentials. It exposes no Google calls, internal source links, layout saves, reservation writes, or publication operations. It reuses the light/dark theme, week/month views, date navigation, search and project details. Empty time spans require team confirmation and never imply a booking or available production capacity.

If loading fails, the page reports the failure. Previously loaded data is marked as a previous read even after date or view navigation; a successful retry restores the normal last-publication label. No sample data or internal fallback is available.

## Checks

```sh
node --test google-app/tests/*.test.mjs web/tests/timeline-core.test.mjs
```

These include rejection of private fields, invalid dates and malformed imports, protection of the previous snapshot and complete site on failures, clean public build contents, executable browser output, correct Taipei dates, stale reload status, and preservation of the independent Apps Script applications.

Read the [project rules](../AGENTS.md) and [development guide](web-development.md) before changing the release process.
