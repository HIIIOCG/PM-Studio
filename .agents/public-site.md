# PM Studio GitHub Pages entry

This repository's Pages site embeds the single read-only Apps Script. It contains no project records, anonymous feed, or `schedule.json` snapshot. The Google `專案列表` remains the only source of current data; the Script selects safe public fields before they reach a browser. Read [AGENTS.md](../AGENTS.md) and [the deployment guide](web-development.md) before publishing.

## Build input and output

Supply the verified production execution URL through `PM_STUDIO_APP_URL`, or `buildPublicSite({ appUrl })` for programmatic use. Never place the actual URL in tracked source, documentation, or test fixtures. The builder accepts only an exact HTTPS Google Apps Script `/macros/s/<deployment-id>/exec` address, with no query, fragment, credentials, alternate host/port, or additional path.

```sh
node scripts/build-public-site.mjs
node scripts/serve-public-site.mjs
```

Set the environment variable privately before building. The ignored `local/public-site/` output contains exactly:

```text
index.html
.nojekyll
```

The HTML embeds the Script across the viewport and offers a small direct schedule link if embedding fails. It has no loading overlay or JavaScript and never waits for a cross-origin load event to reveal the schedule. It performs no data reads of its own and provides no write or editing route. Verify the actual schedule separately.

The builder rejects unknown output files and symlink/junction paths. It stages a complete site before replacing the previous one and restores the previous site if installation fails. A known legacy `data/schedule.json` may be present only in an old output: migration preserves that complete site in a separate local backup and excludes the data folder from the new artifact. Do not add internal bundles, exports, or settings to the output.

Preview `http://127.0.0.1:4320/PM-Studio/`; root and `/PM-Studio` redirect to this path. The preview serves only the entry HTML and rejects old snapshot/private-file routes. `--directory` and `--port` may select another built output and local port.

## Manual release

1. Verify the single Script deployment, its anonymous field allowlist, the latest source comparison, and iframe support. Keep its actual URL and deployment evidence in ignored private operation records.
2. Set the repository Actions secret `PM_STUDIO_APP_URL` to that verified URL. The secret is injected into the public HTML only during the build; it is an execution address, never a source-sheet ID or credential.
3. Run the tests, build, and inspect the two-file output. The tests use fictional URLs; they do not establish the health of a real Google deployment.
4. The repository owner controls public visibility and Pages activation. Use this original repository's **Settings → Pages → Source: GitHub Actions**. Do not change visibility or substitute another repository as part of a release.
5. On the default `main` branch, manually dispatch [the Pages workflow](../.github/workflows/pages.yml). It checks public/original/main prerequisites, runs tests, builds with the secret, and uploads only `local/public-site/`.
6. Confirm workflow success, then read back the deployed HTML and the embedded schedule without signing in. Compare the iframe target with private deployment records, test date navigation and language on desktop/mobile, and check that no old snapshot or private files are published.
7. Record the outcome locally. Only after verified cutover should superseded cloud files move to Drive history backups and old deployments be disabled and checked. Do not infer live or retired status from documentation or source changes.

```sh
node --test google-app/tests/*.test.mjs
```

The workflow is manual only: no push trigger, timer, Calendar action, notification, or message. It neither configures Pages automatically nor modifies the company homepage. Source and build changes do not mean a deployment has run.

## Hosting scope

The project path is `/PM-Studio/`, including capitalization. Keep the project's custom-domain setting empty and do not add `CNAME`, alter DNS, or edit the company's existing site. When the organization's Pages homepage uses a custom domain, this project inherits that host with its own project path; see [GitHub's domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

If visibility, activation, authorization, or deployment is unavailable, preserve the prepared artifact and report the specific incomplete step. Do not route around it through another repository. Private source IDs, actual URLs, credentials, and retirement records remain in `local/operations/`; previous versions remain in Git and Drive history backups.
