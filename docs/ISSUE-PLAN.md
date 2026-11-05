# Issue plan for the roadmap draft

**GitHub assignments · 3 November 2026, updated in the evening after the merges #297 and #303–#306.** The milestone table records the assigned issues, including three new lead issues. The recommendations below give the scope and evidence for each item. A field report can belong to a milestone without committing an entire preset or layout to that release. [Roadmap and milestone criteria](ROADMAP-DRAFT.md) · [Open issues](https://github.com/Sturmi77/heatpump-hydraulic-card/issues?q=is%3Aissue+is%3Aopen)

## Pull requests

| PR | State at review | Proposed treatment |
| --- | --- | --- |
| [#296 · Circuit pump states](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/296) | Merged to `main`, #295 is closed. | Check running, stopped and unavailable states on the reporting ebusd installation after release. |
| [#297 · EMS-ESP PC1](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/297) | Merged to `main`. The reporter in #224 confirmed that `boiler_pc1on` exists, so it comes before `pc1rate`. | Check both entity-name formats on WLW circuit 1 after release. |
| [#303 · Circuit flow label](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/303), [#304 · Mode check](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/304), [#305 · Tested presets](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/305), [#306 · ESPAltherma](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/306) | Merged to `main`; #291 is closed. | Include all four in the 0.18 release notes. Ask for a field confirmation of `espaltherma` in #254. |
| [#281 · Circulation window](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/281) and [#286 · ViCare DHW](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/286) | Released in 0.18.0. | Include both in 0.18 release notes. Follow up on field verification for the temperature-based ViCare fallback with #282. |

## GitHub milestones

| Milestone | Assigned issues at publication | Scope |
| --- | --- | --- |
| [0.18.0](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/11) | #34, #283 (#291 done) | Release follow-up and kiosk triage. PRs #297 and #303–#306 are merged for this release. |
| [Field baseline (0.18.x)](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/13) | #298 (lead), #1, #282, #254 | Supported-preset cohort and field confirmations. Daikin is a separate exploratory pilot outside the cohort. |
| [0.19.0](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/14) | #300 (lead), #290, #23, #173, #289, #4 | Cycle details, circuit spread, complete heat/power pairs on a real cascade, display units and the phone readability trial. Moved ahead on 4 November, see [order](ROADMAP-DRAFT.md). |
| [0.20.0](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/12) | #299 (lead) | Installation confirmation, chosen from the field baseline. |
| [Later](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/15) | #12, #27, #31, #36, #82, #101, #114, #195, #224, #248, #250, #252, #253, #255, #256, #260, #261, #267, #276 | Open follow-ups with no release commitment. For analytics, take #27 before #114. |

## Lead issues

| Order | Issue | Acceptance evidence |
| --- | --- | --- |
| 1 | [#298 · Measure first setup on real installations](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/298) | A short voluntary field-test form linked from #1, a versioned ten-installation cohort, and a published baseline with unsuccessful and pending cases. Record setup time, manual fields, YAML and confirmation of the actual flow path. |
| 2 | [#300 · Show measurements for a selected operating cycle](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/300) | Extend the existing timeline selection with heating and DHW run details. Match two real recorder traces, label mode-only phases and partial runs, and leave unsupported measurements empty. |
| 3 | [#299 · Confirm ambiguous hydraulic layouts in the editor](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/299) | Choose the first prompts from milestone 1 evidence; this milestone now follows the cycle details (0.20). Provide preview, skip, cancel and explicit save. Compare fresh setup outcomes with the baseline and test existing overrides. |

## Plan for 0.19.0 · Understand a cycle

Agreed on 4 November after the mockup of the run details. One pull request per step, each with self-test, topology test, changelog fragment and README. Steps that change the same code run one after the other, each from `main` (no stacked pull requests). During the field test ([#298](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/298)) preset detection and the setup path stay unchanged; display options do not affect the measurement. State as of 5 November.

| Phase | Step | Issue | Content | State |
| --- | --- | --- | --- | --- |
| 0 · Housekeeping | 1 | [#321](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/321) | Field-test form, milestones swapped, #289 and #4 moved. | done |
| | 2 | [#254](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/254), [#173](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/173), [#322](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/322) | Replies; condensate tray heater to Later; Luxtronik in the upstream discussion. | done |
| 1 · Bugs and presets | 3 | [#323](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/323) | ESPAltherma: no derived superheat, evaporation from `low_pressuret`. | done ([#328](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/328)) |
| 2 · Runs and the detail panel | 4 | [#324](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/324) | Runs from the compressor, phases without one, partial runs at the window edges. | done ([#329](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/329)) |
| | 5 | [#325](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/325) | Detail panel under the timeline; `timeline_details`. | done ([#335](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/335)) |
| | 6 | [#326](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/326) | Values per run for hot water and heating, fetched for the run window only. | done ([#335](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/335), review follow-ups [#339](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/339)) |
| 3 · Measurements | 7 | [#290](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/290) | Circuit spread tiles; the run details use the same rule since [#326](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/326). | in review |
| | 8 | [#23](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/23) | Several entities per key: averages for temperature and humidity, rules for units and missing values. | open |
| | 9 | [#173](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/173) | Cascade: power and heat of both units through [#23](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/23), per-key entries stay possible, no system COP with a unit missing. | open |
| | 10 | [#327](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/327) | Energy and COP per run, only where power and heat cover the run. | open |
| 4 · Independent | 11 | [#289](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/289) | Flow rates in l/min as a display option. | open |
| | 12 | [#4](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/4) | Phone readability: `narrow_focus` by n42net. | done ([#330](https://github.com/Sturmi77/heatpump-hydraulic-card/pull/330)) |
| 5 · Acceptance and release | 13 | [#300](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/300) | Compare the run details with recorder traces of at least two installations (the maintainer's Lambda, the cascade in [#173](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/173) or the Daikin in [#254](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/254)); then release 0.19.0. | open |

## Scope and follow-up by issue

### Correct the hydraulic view and complete the 0.18 field follow-up

| Issue | Recommendation |
| --- | --- |
| [#34 · Circulation times](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/34) | Keep for 0.18. Check the single window and next schedule change in the release. Additional weekday programs need a separate use case. |
| [#291 · Circuit flow label](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/291) | Done in #303: `hc_flow_label: false` hides the circuit flow and keeps the target; the default is unchanged. Hiding an inherited temperature automatically on the inactive path remains a possible follow-up. |
| [#283 · Chromium kiosk failure](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/283) | Triage as a potential total outage. Obtain browser version and console error. Expedite a reproducible card regression. |
| [#282 · Vitocal 200-S](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/282) | Confirmed: the diagnostic report shows the charging signal (`ww_aufladung`) during a hot-water charge, with combined storage and fresh-water station. ViCare is marked as tested (#305). The temperature-based fallback of #286 still needs a unit without that signal. |
| [#195 · Home Comfort pumps](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/195) | Keep evidence-dependent. Obtain the Home Comfort PC0/PC1 resource keys and compare WP and circuit flow when only PC1 runs. The EMS-ESP mapping in #297 covers a different integration. |

### Measure setup and simplify the editor

| Issue | Recommendation |
| --- | --- |
| [#1 · Call for testers](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/1) | Keep as the recruitment entry point. Link the milestone 1 protocol, request underrepresented configurations and report trial results in the new lead issue. |
| [#269 · Heating-circuit remapping](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/269) | Use the reported contiguous Open3E circuits 2–4 as a milestone 2 example. Confirm the existing start index and count solve this case. Consider arbitrary reordering only if a different installation requires it. |
| [#4 · Phone layout](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/4) | Comes along in 0.19, independent of the field test; n42net offered a prototype. Use it in the 0.20 usability checks as well. Prototype the glance view with a target, an active path and a readable temperature. Decide about a separate portrait schematic after observing phone use. |
| [#289 · Flow units](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/289) | Small 0.19 candidate, independent of the field test. Apply the unit consistently in schema, circuit and tile. Preserve calculation units. |
| [#276 · Panasonic suggestions](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/276) | Keep as field evidence for #289 and #290. The missing spread and the grey timeline came from a select mapped as `mode`; the editor flags that since #304. Close the umbrella once the reporter confirms and both requests are tracked. |

### Make measurements useful in an operating cycle

| Issue | Recommendation |
| --- | --- |
| [#290 · Circuit spread](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/290) | First supporting metric for the 0.19 heating-run details. Use measured flow and return of the same active circuit. Show the WP spread separately. A current-value tile can reuse the same rule. |
| [#23 · Multiple entities per key](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/23) | Scope 0.19 to measurement completeness. Existing power lists already sum. Define which members, units and missing values permit a complete total. Room averages and general-purpose combinations can ship later. |
| [#173 · Cascade power and COP](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/173) | Use the real two-unit installation to test #23. Pair heat and electricity per unit over compatible intervals. Suppress misleading system COP with missing or incompatible heat data. Capture the correctness fix separately if it is ready earlier. Defer the second-unit drawing. |
| [#31 · Pump counters](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/31) and [#260 · Second fan speed](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/260) | Accept opportunistic detail mappings once states, units and a tester are available. They do not determine the cycle milestone. |
| [#27 · Seasonal brine minimum](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/27) | First analytics follow-up after cycle details. Show the minimum and its date only with valid seasonal statistics. |
| [#114 · DHW energy balance](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/114) | Follow #27. Pilot with a household that meters heat in, auxiliary input where present, and draw-off over the same interval. Keep the existing temperature-loss measurement separate. |

### Grow preset coverage with field evidence

| Issue | Recommendation |
| --- | --- |
| [#12 · Preset wishlist](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/12) | Keep as intake. Rank candidates by a willing tester, usable entity data and a repeatable mapping. Track first-setup results per integration and model. |
| [#254 · Daikin Altherma](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/254) | First pilot. The ESPAltherma beta branch publishes one entity per value, so no helpers are needed; the `espaltherma` preset (#306) is built from the source and the EPRA12EAV3 entity list. Confirm heating, hot water and the behaviour of "I/U operation mode" on the reporting installation. Track Onecta separately. |
| [#82 · Older ebusd brine units](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/82) | Continue from the existing `ehp` mapping once the entity list and mode meanings are confirmed. |
| [#253 · NIBE](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/253) and [#255 · Mitsubishi](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/255) | Candidate queue. Pick a specific local or cloud integration, obtain states and units, and recruit an operator for mode checks before assigning a version. |
| [#256 · Viessmann Optolink](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/256) | Start with a verified example profile from the submitted splitter configuration. User-defined MQTT names limit automatic detection across installations. |
| [#101 · Translations](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/101) | Continue as contributor-led work. Include new prompts and cycle details in the existing translation workflow. |

### Defer additions to the schematic

| Issue | Recommendation |
| --- | --- |
| [#248 · Pool](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/248) | First candidate for a new consumer after the three product milestones. Request a charging signal and a real pipe layout because pool mode can currently appear as space heating. |
| [#36 · Wood stove](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/36), [#250 · Ventilation](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/250) and [#267 · Domestic-water side](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/267) | Hold for a field diagram, sensors, and a question the addition would answer in operation. Revisit layout architecture if several variants qualify. |
| [#224 · Indoor enclosure](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/224) | The pump evidence is used in #297 (credited in the issue). Park the enclosure itself until it clarifies an operator decision. |
| [#261 · Resizable segments](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/261) | Park per-segment controls. Use the #4 phone trial to identify which components actually need more space. |
| [#252 · House load and wallbox](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/252) | Keep in Later. The current roadmap focuses on the heat pump's own supply and consumption. |
