# Vaillant aroTHERM (ebusd)

Preset `ebusd`. Back to the [README](../../README.md#supported-heat-pumps).

Confirmed on an aroTHERM plus cascade with two circuits and on a single aroTHERM plus with a sensoCOMFORT controller and a buffer (#189, #295).

## Setup

```yaml
type: custom:heatpump-flow-card
preset: ebusd
hc_count: 2
```
For Vaillant aroTHERM and aroTHERM plus outdoor units (eBUS circuit `hmu`) read by [ebusd](https://github.com/john30/ebusd) with its Home Assistant MQTT discovery, together with the VWZ hydraulic station (`vwzio`) and a sensoCOMFORT or multiMATIC controller (`ctlv2`, `ctlv3`, `ctls2`). Entity ids follow `<entity stem>_<circuit>_<message>`, for example `sensor.ebusd_hmu_rundatastatuscode` with the stem `ebusd`. Home Assistant may put a device name in front, for example the stem `heating_ebusd`.

With several ebusd daemons, the preset groups entities by this complete stem and takes every mapping from one group, so it cannot combine temperatures from one daemon with counters from another. It automatically selects the group with the most matching entities. The diagnostic report lists the selected and competing groups. To select one explicitly, set its full stem, for example `prefix: ebus_arotherm`; the old short topic prefix remains accepted when it identifies one best group.

What you get:
- operating state from `RunDataStatuscode` (heating, hot water, cooling, defrost, blocked, frost protection; fault codes show as text)
- flow, return, building-circuit flow rate, air inlet and outdoor temperature
- electrical power and heat output of the outdoor unit, giving a live COP
- compressor speed as "running"; the diverter valve from the hydraulic station's hot water flag (`vwzio_statusdhw_dhwactive`) where ebusd reports it, otherwise from the operating state (`hwc_…` is hot water)
- DHW temperature and target, heating circuits with flow, target and pump from the controller, zone room temperature and target
- heating-circuit pressure (outdoor unit, else controller)
- details and tiles: compressor hours and starts, heater hours, electricity per mode, environmental energy, evaporation, suction and hot-gas temperature, high pressure, expansion valve, superheat

Notes:
- The controller reports every circuit it knows, inactive ones included, so set `hc_count` yourself.
- The buffer is not mapped: which VR 70 / VR 71 sensor sits in it depends on the hydraulic scheme. Add `buffer_top` (and `buffer_bottom`) under `entities`.
- In a cascade of two outdoor units, ebusd reads only the unit on the bus; power, heat and the counters belong to that unit.
- Do not map the controller's `…_ctlv2_z1valvestatus` as `valve`: it is the valve of zone 1 (open or closed), closed also in standby, in summer and while another zone heats, so the card would show hot water at those times. Without a valve entity the card takes hot water from the operating state, which is the reliable source here.
- Saunier Duval GeniaAir units use the same HMU and work with this preset; set `unit_style: saunier` for their drawing.
- Older geoTHERM and other units on the `ehp` circuit are not covered yet (#24).
