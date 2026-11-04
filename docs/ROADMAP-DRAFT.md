# Product roadmap draft

**For review · 3 November 2026.** A household should be able to add the card, recognize its own installation, and see where heat is going. When something looks unusual, the same view should help the operator understand what happened. Presets do the routine setup. The operator supplies facts about the installation that Home Assistant cannot establish.

| Order | Proposed milestone | What the operator or maintainer can do at the end |
| --- | --- | --- |
| Release in progress | 0.18.0 · Hydraulic correctness | Follow the active water path on the reported reference installations. |
| 1 | Field baseline on 0.18.x | Tell how often a fresh preset produces the correct schematic, how long it takes, and where people need help. |
| 2 | 0.19.0 · Confirm the installation | Resolve an ambiguous layout in the editor by answering a short question and seeing the result. |
| 3 | 0.20.0 · Understand a cycle | Select a heating or hot-water cycle and see its duration and the measurements that explain it. |

The field baseline is a research milestone and can start as soon as the trial protocol is ready. Use one recorded card version per cohort. The 0.18 release can ship fixes independently of tester recruitment. Each of the three product milestones has a lead issue and an acceptance criterion. [Previous release plan](ROADMAP.md) · [GitHub milestones and issue assignments](ISSUE-PLAN.md#github-milestones)

## Gap analysis across milestones

| Gap | Consequence today | Decision the milestone enables |
| --- | --- | --- |
| 0.18 · A pump can publish a speed or mode that the card reads as stopped. | An active circuit behind a buffer appears idle. An operator can mistake a display error for a heating fault. | Release the correction once running, stopped and unavailable states agree with the reference cases on both sides of the buffer. |
| 1 · Field reports rarely record setup effort or failed starts consistently. | A well-mapped preset may still require considerable manual setup. It is hard to choose the most useful editor improvement. | Compare untouched presets, editor-assisted setups and YAML-assisted setups. Choose prompts from frequent observed errors. |
| 2 · A preset identifies integration entities more reliably than physical pipework. | A user who knows their system still has to translate that knowledge into settings such as circuit count and start index. | Keep a prompt only when it resolves a demonstrated ambiguity and the repeat trial shows less manual work. |
| 3 · The timeline describes activity and the tiles summarize periods. Their boundaries can differ. | A user can see several starts and a daily energy total but cannot tell how much is attributable to one DHW run. | Offer each cycle metric only when its source covers the same equipment and interval. A reliable duration alone is useful. |

## Release in progress · 0.18.0

**Target.** An operator looking at a heating or hot-water run can tell which circuit is active. A buffer without sensors can still appear in the correct place. A utility lock, cooling dew-point margin and circulation window appear when their inputs are available.

**Current gap.** On 3 November the published version is 0.17.2. The four planned features, the ViCare fallback for hot-water charging and the ebusd pump-state fix have reached `main`. The EMS-ESP preset maps PC1 for the first circuit of a WLW indoor unit from a field report. Since then `main` also has the `hc_flow_label` option, a plausibility check for a chosen mode mapped as `mode`, the ViCare and ebusd presets marked as tested, and a first `espaltherma` preset for Daikin Altherma. Bosch/Buderus Home Comfort uses a different integration and still needs its own evidence. [Release](https://github.com/Sturmi77/heatpump-hydraulic-card/releases/tag/v0.17.2) · [0.18 tracker](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/11) · [Pull requests](ISSUE-PLAN.md#pull-requests)

**Exit check.** Exercise running and stopped circuits behind a parallel buffer, including heating, cooling, DHW diversion, zero speed and an unavailable pump. Verify the EMS-ESP mapping against the merged pump logic, existing direct-circuit behavior, browser and topology checks. Publish release notes that distinguish a reported valve state from the ViCare temperature-based inference. Keep remaining field confirmations visible in the tracker.

## 1. Measure the first successful setup

**Target.** A maintainer can answer “Of the last ten supported installations we tried, how many got the right picture within five minutes without YAML?” Anyone reviewing the result can see which hydraulic arrangements were tried and what prevented success.

**Current gap.** The card already detects 14 presets, checks entity mappings, offers a device-based assistant and can generate a local diagnostic report. Preset coverage measures roles a preset *could* fill. The field tester thread contains valuable examples, but offers no common starting point, denominator or time-to-success measure. [Preset coverage method](COVERAGE.md) · [Tester thread](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/1)

**Trial protocol.**

- Recruit ten distinct installations with a supported integration. Aim to include direct and buffered systems, at least one multi-circuit system and several integrations. Report the mix. Record unsupported-device assistant trials separately.
- Start the clock when the user adds a fresh card with the integration already working in HA. Stop when they have a usable schematic. Record elapsed minutes, preset, card version, manual field assignments, whether YAML or outside help was needed, and the first point of friction.
- Ask the operator to verify the components, active circuit and, where fitted, hot-water path during ordinary operation. Subsequent waiting for a natural cycle is outside setup time. Keep unverified cases pending, abandoned attempts in the denominator, and wrong paths visible even if setup was fast. Use voluntary reports and user-reviewed diagnostic extracts.
- Publish the counts, median setup time for completed attempts, number of manual mappings and the most frequent failure. Distinguish an untouched preset from a setup completed through the editor. **Proposed success target** is 8 of 10 correct within five minutes without YAML. This is a pilot target for the tested cohort.

**Exit check.** Publish the baseline, including failures and pending confirmations, before choosing the prompts for milestone 2. If recruitment or mode confirmation is incomplete, publish the counts collected and keep the milestone open. Missing the 8/10 target is a valid finding and informs the next milestone.

## 2. Confirm an ambiguous installation

**Target.** A supported installation with an unambiguous layout opens directly. Where the evidence permits more than one schematic, the editor asks only what distinguishes the plausible layouts. For example, an owner can confirm a parallel buffer without temperature sensors, or select the first of several numbered heating circuits. The preview shows the changed pipework or circuit labels before the user saves.

**Current gap.** The editor has validated entity fields and overrides, a mapping assistant for unsupported devices, buffer options and a circuit start index. A user still has to translate “my circuits start at 2” into the right combination of settings. Missing temperature sensors alone cannot establish the existence or position of a buffer. [Current editor behavior](../README.md#quick-start) · [Open3E circuit example](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/269) · [Buffer without sensors](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/266)

**Deliverable.** Use the baseline to choose the top one or two repeatable ambiguities. Offer a small picture and plain-language choices in the existing editor, including “I don't know”. Preview and save through the existing configuration keys. An explicit user mapping takes precedence. Reopening or canceling a draft preserves the saved configuration. Users of unsupported devices can still review individual mapping suggestions.

**Exit check.** Replay the baseline cases and repeat the trial with fresh users on comparable configurations. Record the same measures beside the baseline. Aim for at least 8/10 correct in five minutes without YAML, fewer manual assignments in ambiguous cases, and no extra prompt on the unambiguous reference cases. Verify on a phone as well as a desktop. A misleading path or an overwritten manual mapping fails the relevant case even if setup was quick.

## 3. Explain an individual operating cycle

**Target.** A user asking “What happened overnight?” can tap a run in the timeline. A DHW run shows its duration and, when available, the tank temperature at the start and end. A heating run shows its duration and, when measured, the circuit spread. Electricity consumed during the run can appear when the data supports that interval. These details open on demand and keep the main schematic legible on a phone.

**Current gap.** The timeline already lets the user select a mode segment and read its start, end and duration. Period tiles supply COP, starts and runtime per start. A mode segment can be shorter than a compressor run, and a daily counter or hourly statistic cannot by itself attribute energy to a short cycle. The missing pieces are reliable run boundaries, interval-specific measurements and a readable detail view. [Statistics and timeline](../README.md#features) · [Prior discussion of history replay](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/3)

**Deliverable.** Use compressor transitions for run boundaries where available and retain mode changes within a run. Where only mode history exists, label the selection as a phase. Start with completed heating and DHW runs. Show partial history as partial, and omit energy, spread or COP when sensors, timestamps or meter scope do not support the calculation. Keep recorder queries bounded to the displayed period and reuse cached results.

**Exit check.** Compare displayed details with recorder traces from heating and DHW on at least two installations. Test a mode change within one run, missing history, a window cut through a run, and a counter reset. The user should be able to identify the selected activity, its duration and which values are available using touch or keyboard. A partial period must never appear as a complete cycle total.

## Decisions for the existing backlog

The three lead issues track [field measurement](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/298), [installation confirmation](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/299) and [cycle details](https://github.com/Sturmi77/heatpump-hydraulic-card/issues/300). Take hydraulic regressions as they arise. Daikin/ESPAltherma is the first additional preset pilot: the `espaltherma` preset is built from the source and one installation's entity list and waits for a field confirmation. Progress other preset mappings when a tester and a reproducible mapping exist. Try mobile readability within the editor and cycle work before committing to another full schematic layout.

The 0.19 tracker focuses on installation confirmation. The measurement rules for aggregation are assigned to 0.20 with the real cascade case. In Later, the seasonal brine minimum is the first analytics follow-up, ahead of the DHW energy balance. [0.19 milestone](https://github.com/Sturmi77/heatpump-hydraulic-card/milestone/12) · [Issue plan](ISSUE-PLAN.md)
