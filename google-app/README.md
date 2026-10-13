# Google Apps Script applications

PM Studio is migrating to one source spreadsheet and one Apps Script. Under the new data rules, the `專案列表` sheet holds customer codes and workspace allocations; all projects will be displayed by project ID and customer code, without names or per-project publication approval.

The 2026-10-13 work covers backups and source-sheet consolidation only. The single Script and website migration are pending. The code and deployed applications listed below still implement the previous two-project architecture:

| Application | Backend | Generated interface | Manifest source |
| --- | --- | --- | --- |
| Internal | `Code.gs` | `Index.html` | `appsscript.json` |
| Public | `PublicCode.gs` | `PublicIndex.html` | `public-appsscript.json` |

The `ui/` directory contains interface contracts, the Apps Script bridge, and view-specific behavior. The build combines these with the shared sources in `web/dist/` and `scripts/timeline-core.mjs` to generate both HTML files.

The source sheet retains A:Q. Its former R column `對外名稱` is removed; R:V now define `客戶編號`, `工作區 A 占用`, `工作區 B 占用`, `工作區 C 占用`, and `工作區 D 占用`. Maintain confirmed allocations in the source sheet, not through the old website's save operation. The old reader does not consume R:V, so refreshing the old site does not synchronize these new allocations. Customer codes must contain codes only; the existing customer-name field stays private.

Read the [web development and deployment guide](../.agents/web-development.md) before changing or deploying an application. It distinguishes the new data rules from the legacy contracts retained for maintenance. Removing `對外名稱` makes the old publication operation unsuitable for new releases; do not recreate the field to satisfy that operation.

The existing GitHub Pages frontend still reads `public/data/schedule.json`. Its [legacy release guide](../.agents/public-site.md) remains a maintenance reference, not evidence that the new architecture is deployed. This migration step changes neither the code nor the live websites.
