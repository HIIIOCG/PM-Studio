# Google Apps Script applications

PM Studio uses two independent Apps Script projects: one for the internal team schedule and one for the approved public schedule.

| Application | Backend | Generated interface | Manifest source |
| --- | --- | --- | --- |
| Internal | `Code.gs` | `Index.html` | `appsscript.json` |
| Public | `PublicCode.gs` | `PublicIndex.html` | `public-appsscript.json` |

The `ui/` directory contains interface contracts, the Apps Script bridge, and view-specific behavior. The build combines these with the shared sources in `web/dist/` and `scripts/timeline-core.mjs` to generate both HTML files.

Read the [web development and deployment guide](../.agents/web-development.md) before changing or deploying either application. It covers local previews, tests, build outputs, spreadsheet schemas, access permissions, and the approval process for public data.

The public GitHub Pages frontend uses a reviewed anonymous snapshot rather than the Apps Script browser bridge. Its manual release process is described in the [public website guide](../.agents/public-site.md). The internal and public Apps Script projects keep their separate identities and permissions.
