# Storage topology plan

This plan covers the open requests that change the storage part of the schematic: a combined/layered storage ([#50](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/50)), a wood stove feeding the buffer ([#36](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/36)) and a second heat generator in hybrid/bivalent systems ([#51](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/51)). The standby loss of the hot-water tank ([#32](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/32)) is analysis rather than drawing and ships on its own; its interaction with a combined storage is listed below.

It answers five questions: how the schematic should grow (fixed slots or an internal component model), what each variant costs, which combinations exist and how common they are, which variants exclude each other, and how few building blocks cover most installations once exclusions and prevalence are weighed (the Pareto view that drives the recommendation).

## Principles

- **No user-facing topology language.** A freely composable graph in the configuration would make every dashboard a hydraulic design task. The configuration stays semantic (`storage: combined`, stove entities, boiler entities); how the card draws it is internal.
- **Existing configurations do not change.** Every variant is off by default and selected by an explicit option or by entities that only exist on such installations.
- **Reuse entity keys where the meaning holds.** Presets, the editor and the diagnostic report keep working without a parallel set of keys.
- **No guessed preset semantics.** A generic feature may ship with explicit, card-defined manual entities and conservative defaults. Integration-specific automatic mappings still require a reviewed diagnostic report from a real installation.
- **Invalid combinations are rejected or resolved visibly**, never drawn as plumbing that cannot exist.
- **Same quality gate as other features:** layout signature, EN/DE texts, editor fields, keyboard access, compact/wide/wall layouts and full screen, demo setup, self-test with geometry collision checks, README section.

## Current geometry and coupling

The SVG is 1000 units wide; height grows by 250 per extra heating circuit.

| Area | Position | Notes |
| --- | --- | --- |
| Power sources | x 40–300, y 10–190 | PV, battery, grid above the heat pump |
| Heat pump block | x 50–290, y 190–425 | source loop below (air, brine, water) |
| Flow / return to the valve | y 250 / y 380 | optional primary pump at x 340 |
| Diverter valve | x 420, y 250 | DHW branch up to y 80, heating branch down to y 360 |
| Storage column | x 520–640 | DHW tank y 40–240, buffer y 320–520 |
| Buffer bypass / series buffer | x 520–640, y 360–495 | when no parallel buffer is drawn |
| Heating circuits | from x 640, rows of 250 | up to six; single-circuit house x 720–940, multi-circuit room overview x 720–965 above |

The DHW branch already enters the column at y 80 (top) and the heating branch at y 360 (middle), with returns at y 215 and y 495. A tall single tank in the same column fits these heights without moving any pipe.

How tightly the drawing is coupled today (main, 0.12.0): about 4,300 lines in one file; the SVG is built in `_render` and a few helpers (`_circuitSvg`, `_seriesSvg`, `_solarSvg`, `_sourceSvg`, `_heaterSvg`, `_unitArt`) with 42 literal pipe paths and about 220 hard-coded coordinates. Which pipe animates is decided in `_update` from flags such as `toDhw`, `flowHeat`, `flowLoop` and `bypass`. The merges of the primary pump (#95), the fan speed (#96) and the series buffer (#97) each needed manual conflict resolution in exactly these flags and paths; that is the cost every further variant will pay under the current structure.

## Two ways to grow

### Option A – fixed slots, one variant at a time

Each request is added as an opt-in variant of the existing slot: new SVG strings, new flags in `_update`, a new collision check.

- **Benefit:** smallest first step, no change to existing code paths, no freeze for contributors.
- **Cost that grows:** every new variant has to be checked by hand against every existing one (storage type × generators × stove × solar × 1–6 circuits × series buffer × three layouts). Flow logic stays spread over flags; conflicts between parallel pull requests stay frequent.

### Option B – internal component model ("phase 0")

A refactor of the drawing, without any change to the configuration or to what users see:

1. **Components.** Heat pump, valve, DHW tank, buffer, series buffer, circuit, solar, and later combined storage, stove and boiler become components with one shape: the entity keys they use, their size, named **ports** (`flow_in`, `return_out`, `dhw_in` …), their SVG, their value update, editor fields and keyboard access.
2. **Columns with automatic stacking.** The columns stay fixed (generators, switching, storage, distribution); components inside a column are stacked from their sizes, so the height follows the content.
3. **Pipes as connections between ports**, routed on fixed lanes between neighbouring columns (orthogonal, no general path finding).
4. **One flow model.** Which generator runs and which path is open is decided once; each connection derives whether it animates. This replaces the scattered flags.
5. **Generated combination tests.** The self-test enumerates every valid combination of the matrix below and checks the same invariants for each: no overlaps, every pipe ends at a port (the lesson of #18), one tab stop per component, all layouts render.

- **Benefit:** a new storage type, generator or circuit element becomes one component plus its ports and texts; the generated tests check it against everything that exists. Merge conflicts shrink because a variant touches its own component instead of shared flags.
- **Cost and risk:** see the effort and risk tables below.

### Recommendation: Pareto path – no-regret stages first, components only for the tail

Not a big-bang rewrite, and not unguarded option A. The [coverage analysis](#coverage-pareto-view) shows that the card already covers about three quarters of installations and that two building blocks (combined storage with its hot-water types, then the boiler in series) bring it to about 90 %. Those fit into the existing slots. The component model pays off only for the tail (wood stove, boiler in parallel) and for variants beyond this catalogue. So the stages that help in every case come first, and the component refactor is decided when the tail is actually requested:

| Stage | Content | Pays off for |
| --- | --- | --- |
| 0a | **Safety net:** geometry snapshot test (position and size of every element for each demo setup, compared before/after) and the combination test harness over the valid set below, still over today's code | every later step, option A and B alike |
| 0b | **Flow model:** one function decides active generator and open paths; `_update` reads from it. No visual change. | every new hydraulic variant; removes the shared flags that caused the conflicts in #95–#97 |
| 1 | **Combined storage and `dhw_type` as fixed slots** in the storage column, on top of 0a/0b | about 85 % coverage |
| 3a | **Boiler in series** as a fixed slot on the flow pipe, manually configured first; preset mappings follow verified data | about 90 % coverage |
| 0c/0d | **Columns as components** – only at the decision point below | wood stove, boiler in parallel, further variants |

**Decision point before phase 2:** the component refactor (0c, then 0d where needed) starts when one of these holds; otherwise the remaining variants are added as fixed slots as well:

- the wood stove (#36) or the boiler in parallel is to be built, **and** at least one further variant outside this catalogue (pool, cascade, mixing valves, hydraulic separator …) is requested or planned;
- a fixed slot from step 1 or 3a needed geometry changes outside its own column, or the combination tests found an overlap that a fixed slot cannot avoid;
- open contributor pull requests keep conflicting in the storage or generator drawing after 0b.

When the decision point favours the refactor, 0c (storage column) and 0d (generator and distribution columns) follow as described for option B, and the fixed slots from steps 1 and 3a become the first components. An earlier version of this plan ran 0c before phase 1; the coverage analysis moved the decision after phase 1, because the refactor buys little for the common building blocks.

## Effort

Relative sizes as in the [roadmap](ROADMAP.md) (`S` local, `M` several code paths, `L` public API or data logic, `XL` architecture). Days are rough estimates for one focused working day each, including tests, demo, texts and documentation; they assume no surprises from real installations.

| Work | Option A | Staged option B | Note |
| --- | --- | --- | --- |
| 0a safety net | – (optional, M, 2 d) | M, 2 d | useful for A as well |
| 0b flow model | – | M–L, 2–3 d | highest regression risk of the stages |
| 0c storage column as components | – | L, 3–4 d | |
| 0d remaining columns | – | L, 3–5 d | only when needed |
| Phase 1 combined storage | M, 2–3 d | S–M, 1–2 d | |
| Phase 2 wood stove (incl. geometry spike) | L, 3–5 d | M, 2–3 d | B: stove = component in the generator column |
| Phase 3 second generator (generic manual contract) | M–L, 2–4 d | M, 2 d | |
| **Sum for the three requests** | **7–12 d** | **12–19 d** (incl. 0d) | B costs about 5–7 d more up front |
| Each further variant | M–L, growing | S–M, roughly constant | break-even after about 3–5 further variants |

The time is not the only difference: under option B the generated combination tests cover combinations nobody tried by hand, which is where option A will produce bugs on real installations. The Pareto path closes most of that gap, because the combination harness of 0a runs over today's code and over fixed slots just as well.

**Effort against coverage.** The Pareto path is 0a and 0b, then the building blocks as fixed slots; with one flow model the fixed slots get somewhat cheaper than under plain option A. The full refactor is 0a–0d with the building blocks as components. Coverage figures come from the [coverage analysis](#coverage-pareto-view).

| Target | Building blocks | Pareto path | Full refactor (0a–0d) |
| --- | --- | --- | --- |
| about 85 % | combined storage, `dhw_type` | 6–8 d | 8–11 d |
| about 90 % | + boiler in series | 8–11 d | 13–18 d (needs 0d) |
| 100 % of the catalogue | + boiler in parallel, wood stove | 13–18 d | 16–23 d |
| each variant beyond the catalogue | – | M–L, growing | S–M, roughly constant |

Up to about 90 % the Pareto path is 2–7 days cheaper and touches far less existing code. The full refactor wins back its extra cost only with variants beyond this catalogue; that is what the decision point above checks.

## Risks

| Risk | Option A | Option B | Mitigation |
| --- | --- | --- | --- |
| Regression on existing installations (the card is in the HACS default list) | low per step, rising with each variant | medium during 0b–0d | 0a snapshot test first; each stage a separate release; no visual change allowed in 0b–0d |
| Conflicts with contributor pull requests | frequent (shared flags and paths) | high during the refactor, low afterwards | announce a short freeze window right after a release; merge open contributions first; one column per pull request |
| Combinations nobody tested | grows with every variant | covered by generated tests | – |
| Scope creep (generic engine) | – | medium | no user-facing topology, fixed columns and lanes, refactor only at the decision point |
| Single-file size and review effort | grows slowly | grows during the refactor, then flatter | keep one file (HACS), group components in sections |
| Performance | unchanged | layout computed once per layout signature, as today | measure render time in the self-test |
| Narrow and phone layouts (#4) | each variant needs its own check | column stacking makes a second geometry easier later | out of scope here |

## Variants, prevalence and data

Prevalence is a qualitative estimate for single-family houses in Central Europe. Public statistics do not break heat pump installations down by storage configuration; the classes below come from manufacturer guidance, installer forums and the requests reaching this project, and should be corrected when better data appears.

| Variant | Status | Prevalence | Basis / evidence |
| --- | --- | --- | --- |
| Separate DHW tank with diverter valve | supported | very common | standard design of split and monobloc units |
| No buffer, direct circuit | supported | common (new builds with underfloor heating) | manufacturers recommend no buffer for modulating units with floor heating |
| Parallel buffer | supported, also without sensors (0.18) | common (existing buildings, radiators, several circuits) | #266 |
| Series buffer in the return | supported (0.12) | common | #97 |
| Solar thermal into the DHW tank | supported | uncommon, declining with PV | |
| Combined / layered storage | supported (0.14) | uncommon to medium; typical with solar thermal or a stove | #50, a HeishaMon installation |
| Fresh-water station on buffer or combined storage | supported (0.14, `dhw_type`) | uncommon to medium | |
| Tank-in-tank | supported (0.14, `dhw_type`) | rare with heat pumps | |
| Stratification valve instead of diverter valve | later | rare | |
| Wood stove with water jacket into the storage | phase 2 | rare; needs a large buffer (typically 800–1,000 l) and is connected as secondary generator | #36 |
| Boiler in series after the heat pump (hybrid) | supported (0.17, manual entities) | regional: common in retrofit hybrids (for example the Netherlands), less in Germany | #51 (Intergas Xtend) |
| Boiler in parallel into a buffer (bivalent) | phase 3, later | medium in existing buildings | |
| Cooling through the heating circuits | supported | medium (mainly air source and underfloor heating) | |

## Combinations and exclusions

Not every combination exists, and that is intended: a storage strategy is one choice per installation, while additional generators combine but need a suitable storage.

**Storage strategy – exactly one of:**

| Strategy | DHW | Heating side |
| --- | --- | --- |
| direct | separate tank or none | no buffer |
| parallel buffer | separate tank or none | buffer between valve and circuits |
| series buffer | separate tank or none | buffer in the return, optional bypass valve |
| combined | upper zone of the one tank | lower zone of the one tank |

**Additions and their requirements:**

| Addition | direct | parallel buffer | series buffer | combined | Rule in the card |
| --- | :---: | :---: | :---: | :---: | --- |
| Separate DHW tank | yes | yes | yes | – | combined replaces it |
| Fresh-water station (`dhw_type`) | – | yes | – | yes | needs a heating-side store to draw from |
| Tank-in-tank (`dhw_type`) | – | – | – | yes | only inside a combined storage |
| Solar thermal | into DHW tank | into DHW tank | into DHW tank | into the lower zone | target follows the storage |
| Wood stove | – | yes | – | yes | needs thermal separation and volume; series buffers are too small |
| Boiler in series (hybrid) | yes | yes | yes | yes | sits on the flow pipe before the valve |
| Boiler in parallel (bivalent) | – | yes | – | yes | needs a store as hydraulic separation |
| Cooling | yes | yes, if the buffer is a cooling buffer | yes | bypasses the storage | a combined tank holds hot water and is never cooled |
| Heating circuits 1–6 | yes | yes | yes | yes | |

**Tendencies** (not enforced, but useful for defaults and demos): combined storage often comes together with solar thermal or a stove; hybrid retrofits often have no buffer; installations with several circuits and radiators usually have a parallel buffer; a stove almost always means a large buffer or combined storage.

**How the card handles invalid combinations:** a direct conflict in the configuration (for example `storage: combined` with `series_buffer: true`, or `buffer: true` with either of them) is rejected in `setConfig` with a clear message; the editor clears the other strategy when one is selected. A missing requirement (a stove without buffer or combined storage) leaves the addition out and the editor says why. For backwards compatibility, entities that imply a parallel buffer still win over an existing `series_buffer` configuration. `buffer: true` explicitly selects the same parallel topology when no buffer sensor exists; the tank then stays neutral and circuit temperatures are used only when their own sensors are mapped.

With the four strategies and the additions above there are **88 valid hydraulic topologies**. Cooling and 1–6 heating circuits are independent of the storage and already supported; counted in, the card has to render about 1,000 cases per layout. That is far too many to check by hand and the main argument for the generated tests of stage 0a.

## Coverage (Pareto view)

The 88 topologies are not equally common. Weighting them with estimated shares shows how few building blocks cover most installations.

**Assumptions** (single-family houses in Central Europe, existing stock including retrofits; estimates like the prevalence table above, to be replaced by better data):

| Storage strategy | Share | Additions, conditional on the strategy |
| --- | --- | --- |
| direct | 35 % | separate DHW tank 96 %; solar 6 %; boiler in series 7 % |
| parallel buffer | 30 % | separate DHW tank 85 %, fresh-water station 12 %; solar 12 %; stove 8 %; boiler in series 4 %, in parallel 8 % |
| series buffer | 20 % | separate DHW tank 96 %; solar 6 %; boiler in series 5 % |
| combined | 15 % | coil 50 %, fresh-water station 40 %, tank-in-tank 10 %; solar 35 %; stove 30 %; boiler in series 2 %, in parallel 6 % |

For the three strategies with a separate tank, the remainder of the DHW share is "no DHW tank". Additions are treated as independent within a strategy.

**Distribution:** the three base forms already drawn today (direct, parallel buffer and series buffer, each with a separate DHW tank) cover about 65 % on their own; everything the card supports today covers about 73 %.

| Share of installations | Topologies needed |
| --- | --- |
| 80 % | 10 |
| 90 % | 17 |
| 95 % | 24 |
| 99 % | 46 |

**Coverage by building block** (cumulative; a building block unlocks every topology that uses it):

| Building block | Coverage | Topologies drawable |
| --- | --- | --- |
| today | about 73 % | 12 |
| + combined storage (coil) | about 78 % | 14 |
| + `dhw_type` (fresh-water station, tank-in-tank) | about 85 % | 20 |
| + boiler in series | about 90 % | 40 |
| + boiler in parallel | about 93 % | 52 |
| + wood stove | 100 % | 88 |

The wood stove appears in 36 of the 88 topologies, which together hold only about 7 % of installations: it multiplies the test matrix far more than it adds coverage.

**Exclusions also simplify the geometry.** The space below the storage column, which looked like the main conflict for the stove, is used either by the series buffer or the buffer bypass (direct and series buffer) or by the stove (parallel buffer and combined storage, where no bypass is drawn) – never by both. Only the risers of circuits 2–6 share it in every case.

**Sensitivity:** the order of the building blocks holds for any plausible weighting, because the three base forms dominate. The largest uncertainty is the share of combined storage: at 8 % instead of 15 % (the other strategies scaled up), today's coverage rises to about 79 %, 90 % needs 15 instead of 17 topologies, and the case for the refactor weakens further. The requests reaching this project come mostly from unusual installations, so the issue tracker overstates the tail; the decision point therefore asks for requests beyond this catalogue, not for more votes on the existing ones.

## Phase 1 – combined/layered storage (#50)

**Option:** `storage: separate | combined` (default `separate`).

**Drawing:** one tall tank in the storage column (x 520–640, y 40–520) with a hot-water zone at the top and a heating zone below, marked by a subtle zone line and the zone titles. The diverter valve feeds the two zones at the existing heights: DHW charging enters at the top, heating at the middle. Heating circuits draw from the lower zone exactly as from a buffer today.

**Sensors:** no new keys. The six existing keys map to heights in the one tank, top to bottom: `dhw_top`, `dhw_middle`, `dhw_bottom`, `buffer_top`, `buffer_middle`, `buffer_bottom`. That gives up to six sensors (the request asked for five), and presets that already report a DHW and a buffer temperature show both in the one tank. The gradient uses every available sensor at its height.

**Hot-water part:** `dhw_type: coil | fresh_water | tank_in_tank` (default `coil`) only changes the small drawing inside or beside the upper zone. The tap side is not drawn.

**Charging variants:** the first version supports the diverter valve into two heights. A stratification valve is a later option `storage_charge: stratified` once an installation reports it.

**Rules:** `storage: combined` with `series_buffer: true` is rejected; cooling runs through the heating zone like through a parallel buffer (a bypass around the tank would need geometry of its own; changed from "bypasses the tank" when the edge cases were tested); hot-water mode, valve text and the DHW heater rod keep their meaning; the buffer heater rod is drawn in the lower zone; tile and badge contracts do not change; a preset never sets `storage: combined` (it cannot know whether one or two tanks exist).

**Open questions** (asked in #50): storage type, how the heat pump charges it, whether a DHW target entity exists, number and height of the sensors. The defaults above shipped in 0.14.0; combined storage has since been confirmed on real installations, among them a Vitocal 200-S with a fresh-water station (#282). A stratification valve has not been reported yet.

**Done when:** both storage modes render in every layout, flows animate along the right zones for heating and hot water, the self-test covers sensor placement, zone flows, the conflict rules, editor fields and the geometry against circuits 2–6, and a demo setup "Combined storage" exists.

## Phase 2 – wood stove feeding the storage (#36)

**Keys:** `stove_temp`, `stove_pump`; option `stove_fire_temp` (°C, default 60) above which the fire is drawn burning.

**Drawing:** a stove below the storage column with its own flow into the upper heating zone and its return from the bottom of the buffer or the combined storage. Without a buffer or combined storage the stove is not drawn and the editor explains why.

**Geometry:** the space below the storage column is shared with the risers of circuits 2–6. The bypass and the series buffer use the same space, but only on installations without a parallel buffer or combined storage, where the stove is not allowed (see [coverage](#coverage-pareto-view)). Built as a fixed slot, a geometry spike decides the riser routing first; under the component model the stove is a component in the generator column and the lanes are already defined.

**Done when:** the block is absent without its entities, works in all layouts, is keyboard accessible (one tab stop, tap opens `stove_temp`), animates only while the stove pump runs, and has demo and self-test coverage.

## Phase 3 – second heat generator in hybrid systems (#51)

**Implemented for 0.17:** the vendor-neutral manual contract uses `boiler_state`, optional `boiler_power` and optional `boiler_flow`; a normalised mode `hp_only`, `boiler_only` or `both`; and a fixed boiler slot in series on the common flow between heat pump and the existing diverter valve, separate from the inline heater rod. `boiler_power` also serves as the running signal when `boiler_state` is absent. The valve decides whether that common flow goes to heating or DHW, so the first version needs no boiler-specific DHW branch. A boiler in parallel into a buffer or combined storage and all preset auto-mappings remain evidence-driven follow-ups.

## Standby loss of the hot-water tank (#32)

Shipped separately as the tile `dhw_loss` (cool-down in K/h from verified standby windows of the recorder history). With `storage: combined` the upper zone also loses heat to the lower zone while circuits draw from it, so phase 1 has to decide whether windows with running circuit pumps are excluded or the tile is marked approximate for combined storage. A loss in W or kWh per day needs the tank volume and is a possible follow-up (`dhw_volume`).

## Order and releases

| Step | Content | Release | Depends on |
| --- | --- | --- | --- |
| 1 | 0a safety net (snapshot + combination harness) – **done** ([#111](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/111)) | patch | – |
| 2 | 0b flow model, no visual change – **done** ([#111](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/111)) | minor, right after a release, short contributor freeze | step 1 |
| 3 | Phase 1 combined storage and `dhw_type` as fixed slots – **done** ([#133](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/133), 0.14.0) | next minor | step 2 |
| 4 | Phase 3a boiler in series as a fixed slot – **done for 0.17** | 0.17 after the guided setup | step 2; manual contract first |
| 5 | Decision point: fixed slots or component refactor (0c/0d) for the tail | – | requests after steps 3–4 |
| 6 | Phase 2 wood stove, boiler in parallel | following minors | step 5 |

Steps 3 and 4 are independent of each other; whichever has its input first goes first.

Each step is one pull request with its changelog fragment. Umbrella issues stay open while only part of the scope is delivered, as described in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Sprint plan

Planned after 0a and 0b were merged (28 October 2026). Each item is one pull request; items that change the flow model or the topology baseline run one after the other, never in parallel, because they touch the same code and the same baseline file.

**Rule for missing input:** where an open question has no answer from users or real installations when its item starts, the item is built with the planned default below. Later input changes the default in a follow-up pull request; it does not hold the item back. Phase 3a follows the same rule with explicit manual entities; only preset mappings wait for integration states.

| Sprint | Item | Content | Effort | Coverage | Input needed |
| --- | --- | --- | --- | --- | --- |
| 1 | [#124](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/124) one water loop – **done** ([#130](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/130)) | without a parallel buffer, circuits and heat pump flow together in the flow model; the combination test runs every state for every storage strategy | S–M, 1 d | – (correctness) | none |
| 1 | Phase 1a combined storage – **done** ([#131](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/131), landed with [#133](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/133)) | `storage: combined` with a coil for hot water, demo setup, combination test extended by the fourth storage strategy | S–M, 1–2 d | about 78 % | none, defaults D1 and D4 |
| 2 | Phase 1b `dhw_type` – **done** ([#132](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/132), landed with [#133](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/133)) | `coil`, `fresh_water`, `tank_in_tank` in the combined storage, and `fresh_water` on a parallel buffer | S–M, 1 d | about 85 % | none, default D2 |
| 2 | `dhw_loss` with combined storage – **done** (with #132; the pump of every circuit is required since the pre-release review) | standby windows with running circuit pumps are left out | S, 0.5 d | – | none, default D3 |
| 2 | Data for phase 3a – requested in parallel ([comment in #51](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/51#issuecomment-6470468181)) | ask for a diagnostic report of a hybrid installation in [#51](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/51) and the call for testers [#1](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/1) | – | – | user reports; does not block the generic feature |
| 3 | Phase 3a boiler in series – **done for 0.17** | fixed slot on the flow pipe with explicit manual entities | M, 2 d | about 90 % | generic contract complete; preset data remains parallel |
| – | Decision point | fixed slots or component refactor for the tail, by the criteria above | – | – | requests beyond the catalogue |

Sprints 1 and 2 brought the card from about 73 % to about 85 % of installations in roughly 4–5 working days. Phase 3a follows in 0.17 with a manual contract; installation data improves later automatic mappings.

**Status for 0.17:** sprints 1 and 2 shipped with 0.14.0 and phase 3a is implemented with manual entities. Defaults D1 to D4 apply as planned; D5 holds (0a/0b ship as an internal entry). Two decisions were taken while testing the earlier edge cases ([#134](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/134)): cooling runs through the heating zone of a combined storage (see phase 1), and the first stretch of flow and return that feeds several circuits is a pipe of its own. Hybrid-installation reports continue in parallel for later preset mappings and rarer hydraulic variants.

**Planned defaults** (used when no input arrives; each can be changed later without breaking configurations):

| | Question | Default | Reason |
| --- | --- | --- | --- |
| D1 | How is a combined storage configured, with which sensors and charging? | as in [phase 1](#phase-1--combinedlayered-storage-50): `storage: combined`, the six existing keys as heights top to bottom, the diverter valve charges two heights, no stratification valve | no new keys, presets keep working; asked in #50, confirmed on real installations after 0.14.0 |
| D2 | Does `dhw_type` also apply to separate storages? | yes: `fresh_water` on a parallel buffer draws no hot-water tank, the station hangs on the buffer | about 12 % of installations with a parallel buffer use a fresh-water station |
| D3 | `dhw_loss` with combined storage: leave out windows with running circuit pumps, or mark the value approximate? | leave them out | the circuits draw heat from the same tank; a marked value would still mislead |
| D4 | What flows when a circuit pump runs against a diverter valve on hot water (no parallel buffer)? | the pump turns, no water moves, no overflow valve is drawn | no installation has reported an overflow valve yet |
| D5 | Release of 0a/0b | with the next regular release, as an internal entry | no visible change |
