# Viessmann Vitocal (ViCare)

Preset `vicare`. Back to the [README](../../README.md#supported-heat-pumps).

## Setup

```yaml
type: custom:heatpump-flow-card
preset: vicare
hc_type: radiator
```
Entities are found through the entity registry (platform `vicare` + translation key), so entity ids and the HA language don't matter. If you have several Viessmann devices, pick one with `device:` (device id, or use the editor).

What you get:
- flow and return of the secondary circuit
- source temperature and flow rate
- DHW tank top and bottom, buffer
- compressor phase, with DHW recognised via "DHW charging" (or from the flow temperature, see below)
- compressor running and circulation pump
- COP heating and DHW, energy today, compressor starts
- details: compressor hours and starts, heater rod hours, compressor modulation, inlet/outlet temperatures and pressures, liquid line, subcooling and superheat

## Hot water without a charging signal

The compressor phase has no hot-water state, and some units, such as the Vitocal 250 (#186, #196), report no "DHW charging" either. Their phase can also stay on idle ("ready" or "pause") while the compressor runs. The preset therefore reads:

- **running:** a running compressor wins over an idle phase;
- **hot water:** while the heat pump runs and the flow temperature is above the tank temperature (`flow` above `dhw_top`). Heating keeps the flow below a charged tank, a charge heats it beyond.

Limits:

- At the start of a charge the flow first has to rise above the tank, so the first minutes still show heating.
- A tank that has cooled below the heating flow reads as hot water for that time.

A mapped `valve` (for example your own template sensor) or a reported "DHW charging" entity replaces the rule. The diagnostic report says when the rule is in use. Confirmed on a Vitocal 250 by the reporter of #186: the compressor is on while heating and while charging hot water, and the flow rises above the tank during a charge.

## Notes

ViCare has no live electrical power, so add `power` from a meter if you have one; the heat output is estimated from flow rate × spread. For a Vitocal with a ground source, set `source_type: brine`: the primary circuit supply and return become brine in and out. Circuits 2 and 3 share the same translation keys in ViCare, so map their entities manually (`hc2_flow`, …).
