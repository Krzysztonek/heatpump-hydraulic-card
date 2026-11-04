# Bosch, Buderus, Junkers, Nefit, Worcester, Sieger, elm.leblanc, iVT (EMS-ESP)

Preset `emsesp`. Back to the [README](../../README.md#supported-heat-pumps).

Confirmed on a real Buderus Logatherm WLW186i-5 TP70 installation with an EMS-ESP BBQKees gateway (#220). Other EMS/EMS+ heat-pump models remain welcome test coverage.

## Setup

```yaml
type: custom:heatpump-flow-card
preset: emsesp
```
For heat pumps on the EMS bus via the [EMS-ESP](https://github.com/emsesp/EMS-ESP32) gateway with Home Assistant MQTT discovery. The preset accepts both the established EMS-ESP short ids (`boiler_hpactivity`, `boiler_hptc1`, …) and the descriptive Home Assistant object ids of the "long names" entity format (`boiler_compressor_activity`, `boiler_heat_carrier_forward_tc1`, …). With long names the heat pump flow and return come from TC1/TC0 (`boiler_heat_carrier_forward_tc1`, `…_return_tc0`) before the system flow; with both hot-water sensors, `boiler_dhw_current_intern_temperature` is the tank top and `…_extern_temperature` the bottom, with only the external one it is the top. The long-name list was confirmed on a Nefit EnviLine with EMS-ESP 3.8.6 (#257). An instance prefix from the "multiple instances" entity format (e.g. `sensor.ems_esp_boiler_…`) is detected automatically. Compressor activity texts are understood in English and German.

What you get:
- compressor activity (heating, hot water, cooling, defrost) as the mode
- compressor running, 3-way valve, current electrical compressor power
- heat output ("compressor power output", `hppower` / `boiler_compressor_power_output`, kW)
- fan speed (long names: `boiler_fan_speed`)
- heat carrier flow and return (TC1/TC0, falling back to the boiler flow and return)
- flow rate PC0 (`pc0flow` / `boiler_flow_pc0`)
- air inlet (TL2), or brine inlet and outlet for ground source heat pumps (`source_type: brine`)
- auxiliary heater status as the backup heater
- outdoor temperature
- DHW temperature, target and circulation
- circuit 1 flow: the mixer module flow, or with TC1 the boiler's current flow temperature (T0, flow to the heating side)
- circuit target flow from the thermostat (`hc_setpoint`), circuit pump
- with TC1, circuit 1 pump and flow rate from PC1 (`pc1on`, else `pc1rate`; `pc1flow`)
- thermostat room temperature and target
- details: compressor operating time (`uptimecontrol`, "total operating time heat") and starts, total energy consumed and supplied, compressor speed, refrigerant temperatures (PL1 or evaporator inlet TR4, PH1, TR3, TR5, TR6), expansion valve (VR1)

**Compressor:** with long names the compressor speed comes before `binary_sensor.boiler_hp_compressor`, which read off while the compressor ran on a WLW166i with EMS-ESP 3.9.0-dev (#287).

**Operating time:** the compressor hours and the hours tile come from `uptimecontrol` (long name `total_operating_time_heat`), the operating time of all modes. `uptimetotal` ("heatpump total uptime") also counts standby, and `uptimecomp` belongs to hot water (`dhw_uptimecomp`), so neither is used (#333).

**Heating circuit:** the thermostat's flow temperature is a target, so it is the circuit target, not its flow. On WLW indoor units TC1 is the flow from the outdoor unit and T0 (`boiler_current_flow_temperature`) the flow to the heating side; there is no return sensor of the heating circuit (#224). A return sensor fitted later can be added with `entities: { hc_return: … }`. The indoor unit has two pumps: PC0 for the heat pump circuit (flow rate as `volume`) and PC1 for the first heating circuit (`hc_pump`, `hc_volume`). Below about 50 % speed PC0 reports no flow rate; a template sensor that estimates it from `hpcircspd` can be set as `volume`. The heater stages `el_heater_step_1` … `_3` are stages of the electric flow heater, not tank heater rods at three heights.

**Writable values with short names:** EMS-ESP publishes values that can be changed as `number` and `switch` entities, so the preset also looks for the hot-water target `number.boiler_dhw_seltemp` (older `wwseltemp`), the room target `number.thermostat_hc1_seltemp`, circulation `switch.boiler_dhw_circ` (older `wwcirc`) and the mixer circuit pump `switch.mixer_hc1_pumpstatus`. The 3-way valve is also found as `dhw_3wayvalve` (older `ww3wayvalve`), the boiler heating pump of a direct circuit as `heatingpump`, and the "circulation pump fitted" switch as `dhw_circpump`. Taken from a Bosch Compress with mixer module and EMS-ESP MQTT discovery.

Without a heat output sensor, the heat output is estimated from flow rate × spread. With `hc_count: 2` (up to 6) the mixer and thermostat entities of the further circuits are added; `index: {hc: 2}` starts at circuit 2 instead.

### PV, battery and grid

Do not map whole-house PV production, battery power or grid import directly to `pv`, `battery` and `grid`: explicit entities are interpreted as the part of the heat pump's consumption supplied by that source. Leave those overrides empty with `power_sources: auto` to let the card split the mapped heat-pump power by the current Energy-dashboard supply mix. Use `power_sources: manual` only when the mapped source sensors already measure the heat pump's individual shares.

The preset draws the hydraulic components, not the casing of an indoor unit. An integrated small buffer is represented by its mapped buffer sensor and the buffer symbol; a vendor-specific indoor-unit enclosure is a separate drawing feature.
