# Upstream integrations

A preset maps entity ids, translation keys and state texts of another project's integration. When that project renames an entity or changes a state text, the preset breaks without any change here. This folder lists what each preset depends on, so changes are noticed.

One file per preset, `upstream/<preset>.json`:

```json
{
  "preset": "heishamon",
  "reviewed": { "date": "2026-10-25", "version": "2.11.4" },
  "sources": [
    {
      "repo": "kamaradclimber/heishamon-homeassistant",
      "branch": "main",
      "paths": ["custom_components/aquarea/definitions.py"],
      "releases": true
    }
  ]
}
```

- `reviewed.date`: the day the preset was last checked against the sources. Commits and releases after that day are reported. `version` is the release that was checked (or `null`).
- `sources[].paths`: only the files that define entities, translation keys, state texts or units. Fewer files mean fewer false alarms.
- `sources[].releases: false`: do not report releases, for repositories where a release is not specific to the integration (Home Assistant core).
- `unmapped` (optional): fields of the card the preset does not map because the integration does not offer them, or not in a form that fits, each with a short reason, for example `"hc_return": "The integration reports no return temperature per circuit."`. They leave the coverage percentage in [docs/COVERAGE.md](../docs/COVERAGE.md); `npm run syntax` rejects a field the preset does map.

## What happens

The workflow `Upstream watch` runs every Monday (and on demand) and calls `node scripts/upstream-watch.mjs`. For every preset with changes it opens one issue `Upstream changes: <preset>` with the label `upstream-change`, listing the releases and the commits to the watched files. While the issue is open it is updated, not duplicated. It never changes the code.

## When an issue appears

1. Read the listed commits. Do entity ids, translation keys, state texts or units that the preset uses change?
2. Fix the preset if needed (with evidence, see CONTRIBUTING).
3. `npm run upstream:ack -- <preset>` sets the review date to today and the version to the newest release. Commit the file and close the issue.

## Commands

```bash
npm run upstream:watch    # dry run against GitHub (set GITHUB_TOKEN to avoid the rate limit), prints instead of opening issues
npm run upstream:ack -- heishamon
npm run upstream:check    # validate the files offline (part of npm run syntax)
```

A new preset adds its own `upstream/<preset>.json` in the same pull request.
