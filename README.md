# PM Studio

PM Studio shares our production schedule for 3D characters, environments, and game art.

Explore the timeline by week or month, search projects, and open a project to see its published goal, dates, and workspaces. Light and dark themes are available.

Public schedules contain only reviewed anonymous project information and show the last publication time. Contact our team to discuss your project and confirm availability. An empty time span does not reserve production time; every booking requires team confirmation.

<details>
<summary>Maintenance and publishing</summary>

The public site is prepared for this repository's own GitHub Pages project at `/PM-Studio/`. The repository owner controls public visibility and Pages activation. Releases are started manually after the approved anonymous snapshot is reviewed; pushing source changes does not publish the site automatically.

Use Node.js 24 to build and preview the approved public artifact:

```sh
node scripts/build-public-site.mjs --snapshot public/data/schedule.json
node scripts/serve-public-site.mjs
```

The build produces only the public HTML and anonymous schedule under the ignored `local/public-site/` directory. Google remains the source of project information; the snapshot is a publication artifact.

- [Project rules and agent instructions](AGENTS.md)
- [Public snapshot and GitHub Pages publication](.agents/public-site.md)
- [Development, Google permissions, and deployment](.agents/web-development.md)
- [Google Apps Script applications](google-app/README.md)

</details>
