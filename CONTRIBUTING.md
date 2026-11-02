# Contributing

Heat Pump Hydraulic Card deliberately keeps its toolchain small. The browser-based self-test is the main regression suite; Playwright only starts the local server and runs that same suite in Chromium and Firefox.

## Setup

Use Node.js 22 or newer, then install the locked dependencies and browsers:

```bash
npm ci
npm run browsers:install
```

Start the live demo at <http://127.0.0.1:4173/demo/>:

```bash
npm run dev
```

## Checks

Run the complete local gate before opening a pull request:

```bash
npm run check
```

For a faster loop, use `npm run test:chromium`, `npm run test:firefox`, or the interactive `npm run test:ui`. A failed browser test keeps a trace, screenshot, video and text log in `test-results/`; open the HTML summary with `npx playwright show-report`.

New setups and scenarios belong in `demo/setups.js`; assertions belong in `test/selftest.html`. Keep tests deterministic and independent of Home Assistant, the internet and real installations.

### Topology test and drawing snapshot

`test/topology.html` runs next to the self-test and guards the drawing and the flow logic:

- **Snapshot.** Every demo setup in every layout and scenario, and every generated combination in every operating state, is reduced to two fingerprints – the geometry of the schematic and its state (which pipe flows, classes, colours, texts) – and compared with `test/topology-snapshot.js`. A refactor must leave both unchanged.
- **Combinations.** The storage strategies the card draws (direct, parallel buffer, series buffer with and without bypass valve) × hot-water tank (none, tank, tank with solar thermal) × primary pump × 1–6 heating circuits, with source type, emitters, heaters, power sources and layout rotating through the cases. Each combination must render; every pipe must end at another pipe or a component; a flowing pipe must not end at a closed one; components must not overlap; the drawing must stay inside its view box; and the schematic must stay one tab stop with labelled parts.

A change that alters the drawing on purpose (a new part, a moved label, a changed text) updates the baseline in the same pull request:

```bash
npm run topology:update
```

To see what moved, write the full descriptions before and after the change and compare them:

```bash
node scripts/topology-snapshot.mjs --out before.json
node scripts/topology-snapshot.mjs --diff before.json after.json
```

If `test/topology-snapshot.js` conflicts after `main` was merged into a branch, do not merge it by hand: take either side and run `npm run topology:update` again.

The flow logic lives in one method, `_flowModel()`: it decides the operating state, the open side of the diverter valve, the series-buffer bypass and which pipe, circuit and loop flows; `_update()` only draws it. A new hydraulic part adds its pipes there instead of new flags in the drawing code. Without a parallel buffer the circuits and the heat pump are one water loop: the flow model moves them together, and each circuit has a `pump` (its impeller turns) apart from `on` (water flows through it).

## Pull requests without merge conflicts

Several pull requests are usually open at once. Files that every change edits make them collide, so a pull request keeps to these rules:

- **Do not edit `README.md` or `CHANGELOG.md`.** The maintainer updates the preset table, the feature list, the German summary and the preset list of the bug report template (`.github/ISSUE_TEMPLATE/bug_report.yml`) when merging.
- **Changelog:** add one file `changelog.d/<pull request number or topic>.md` with the entry as a bullet list (see `changelog.d/README.md`). At release time `npm run changelog:compile` moves the fragments into `CHANGELOG.md`.
- **Preset documentation** goes into `docs/presets/<preset>.md`: what is mapped, what is deliberately not, the evidence (integration source, real installation) and the known limits. Describe the same in the pull request text.
- **Do not list presets in the header comment of `dist/heatpump-hydraulic-card.js`;** it is generic on purpose.
- Add tests as one block with their own section heading in `test/selftest.html`, and refer to demo setups by name, not by position in the list.
- If a pull request still conflicts after another one was merged, merge `main` into the branch and keep both sides of each conflict; the maintainer can do this for you when "Allow edits by maintainers" is on.

## Translations

Languages are built into the card and may be partial. [docs/TRANSLATING.md](docs/TRANSLATING.md) explains where the texts live and how to add a language. `npm run i18n:check` (part of `npm run syntax`) verifies the language blocks and lists missing texts. Add a changelog fragment, do not edit `README.md`.

## Release contract

`npm run release:check` verifies that `package.json`, `HFC_VERSION`, the HACS distribution filename and the changelog agree and that the changelog fragments are well-formed. On a tag build, the tag must be `v<version>` and no fragment may be left in `changelog.d/`. Before tagging, run `npm run changelog:compile` and rename the `## Unreleased` heading to the version, and run `npm run coverage`: on a tag build `npm run syntax` also fails when `docs/COVERAGE.md` or the coverage cells of the README are out of date.

The recommended required checks for the default branch are `HACS validation`, `Quality`, `Browser / chromium` and `Browser / firefox`.

## Issue and release lifecycle

- Bugs take priority over enhancements. Reproduce them first and add a regression test with the fix.
- Do not guess preset entity mappings. Add them only from integration source evidence or reviewed diagnostic data from a real installation.
- A merged change that has not shipped stays open with the `ready for release` label. The merge comment should link the pull request and summarize its checks.
- When the containing version is published, assign its version milestone, remove `ready for release`, add a release comment and close the issue.
- Contributor-owned pull requests stay with their contributor unless they explicitly hand over the work. Follow-up work should not silently absorb or replace them.
- Umbrella issues remain open while only one sub-part is delivered; record the shipped part in a comment and keep the remaining scope explicit.

## Tracking upstream integrations

Presets depend on other projects' entity ids and state texts. `upstream/<preset>.json` lists the repositories and files a preset is built on, and the workflow `Upstream watch` opens one issue per preset when those files change (see `upstream/README.md`). A pull request for a new preset adds its own `upstream/<preset>.json`. After reviewing an upstream change, run `npm run upstream:ack -- <preset>` and close the issue.

## Preset and language coverage

[docs/COVERAGE.md](docs/COVERAGE.md) shows how much of the card each preset can fill and how complete each language is; the *Coverage* column of the README's preset table comes from it. `scripts/coverage.mjs` measures it from the card: every lookup of a preset is answered as if the entity existed, so the numbers do not depend on one installation. A field the integration does not offer, or offers in a form that does not fit, goes into `unmapped` of `upstream/<preset>.json` with a short reason, and leaves the percentage; `npm run coverage -- --open` lists the fields that are neither mapped nor explained. `npm run syntax` checks that every `unmapped` entry names a counted field that the preset does not map. Contributions do not regenerate the page or the README; the maintainer runs `npm run coverage` before a release.
