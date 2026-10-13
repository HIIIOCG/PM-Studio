# PM Studio

PM Studio displays our production schedule for 3D characters, environments, and game art. Browse dates, return to today, or switch between Chinese and English. Production and correction periods are distinct; projects awaiting dates or assignments remain visible.

The architecture has three parts:

1. **Google Project List:** the only source of project information, dates, status, and workspace allocations. Internal staff edit this sheet directly using their existing Google permissions.
2. **One read-only Apps Script:** selects project IDs, customer codes, dates, and workspace information on the server. Names, goals, notes, and source links never reach the public browser.
3. **This repository's GitHub Pages:** embeds the Script and stores no project snapshot.

Every project uses its existing ID. There is no separate public alias, anonymous spreadsheet, per-project publication approval, website editor, or internal website mode. Missing or uncertain data stays pending; it is never invented. Empty time spans do not reserve production time—contact the team to confirm availability.

## Development

Use Node.js 24; no package installation is required.

```sh
node --test google-app/tests/*.test.mjs
node scripts/build-google-ui.mjs
node scripts/serve-google-preview.mjs
```

The local preview at `http://127.0.0.1:4318/` contains fictional records only. The build produces `google-app/Index.html` and the private deployment package `local/google-app-bundle/single/`.

To build the Pages entry, supply the verified Script execution URL through `PM_STUDIO_APP_URL`, then run:

```sh
node scripts/build-public-site.mjs
node scripts/serve-public-site.mjs
```

The Pages preview is `http://127.0.0.1:4320/PM-Studio/`. Only `index.html` and `.nojekyll` under `local/public-site/` are deployable. The Pages workflow runs manually; a push does not publish. Repository visibility, activation, and the company homepage remain outside this build's scope.

Live deployment and retirement status must be verified separately; source changes or successful local builds do not establish that a site is online. Production IDs, URLs, and operation records remain in ignored `local/operations/`. Previous versions remain recoverable through Git history and Drive history backups.

- [Project rules](AGENTS.md)
- [Single Script and public data contract](google-app/README.md)
- [Development and deployment](.agents/web-development.md)
- [GitHub Pages release](.agents/public-site.md)
