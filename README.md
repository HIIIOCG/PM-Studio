# PM Studio

PM Studio shares our production schedule for 3D characters, environments, and game art.

The Google Project List is the single source for project information, dates, status, and workspace allocations. The simplified architecture will use one Apps Script and display every project's ID, customer code, dates, and necessary workspace information. Names and private details remain internal.

The 2026-10-13 migration covers backups and consolidation of the source sheet only. The former public alias field is replaced by a customer-code field and four workspace-allocation fields. Separate aliases and per-project publication approval are no longer part of the new data rules. The single Script and simplified website are pending later steps; the existing sites still use the previous applications and anonymous snapshot.

Contact our team to discuss your project and confirm availability. An empty time span does not reserve production time; every booking requires team confirmation.

<details>
<summary>Maintenance and publishing</summary>

The existing public site uses this repository's own GitHub Pages project at `/PM-Studio/`. The repository owner controls public visibility and Pages activation. The current workflow remains manual; pushing source changes does not publish the site automatically. No deployment is included in the source-sheet migration.

The following Node.js 24 commands still build and preview the legacy anonymous artifact. They do not read the consolidated source sheet or implement the new publication rules:

```sh
node scripts/build-public-site.mjs --snapshot public/data/schedule.json
node scripts/serve-public-site.mjs
```

The legacy build produces only public HTML and the existing anonymous schedule under the ignored `local/public-site/` directory. Google remains the source of project information; the snapshot is a publication artifact. Do not copy private source-sheet fields into it or restore the removed alias column to make the old publication method work.

- [Project rules and agent instructions](AGENTS.md)
- [Public snapshot and GitHub Pages publication](.agents/public-site.md)
- [Development, Google permissions, and deployment](.agents/web-development.md)
- [Google Apps Script applications](google-app/README.md)

</details>
