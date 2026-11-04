# HeishaMon preset (Panasonic Aquarea)

Source: [HeishaMon](https://github.com/heishamon/HeishaMon) firmware and the [heishamon-homeassistant](https://github.com/kamaradclimber/heishamon-homeassistant) integration. Entity ids follow the MQTT topics (`sensor.<prefix>_main_main_outlet_temp`, …); the prefix is detected automatically.

## Setup

```yaml
type: custom:heatpump-flow-card
preset: heishamon
```
For Panasonic Aquarea heat pumps with a [HeishaMon](https://github.com/heishamon/HeishaMon) board and the [heishamon-homeassistant](https://github.com/kamaradclimber/heishamon-homeassistant) integration. Entity ids follow the MQTT topics (`sensor.panasonic_heat_pump_main_main_outlet_temp`, …); a different MQTT prefix is detected automatically.

[Real-installation feedback](https://github.com/heishamon/HeishaMon/discussions/1025#discussioncomment-19174931) confirms that the default MQTT mapping is detected correctly. That installation uses a combined/layered store, which is outside the card's supported topology; its remaining entities were easy to assign manually. This confirms the preset on one real installation, not every Aquarea generation, so additional model reports remain useful.

What you get:
- outlet and inlet temperature
- pump flow (L/min, converted)
- compressor frequency as "running"
- 3-way valve (Room/Tank)
- defrost
- the fan speed (`fan1_motor_speed`, rpm), so the fan keeps turning while it runs on after the compressor stops
- the primary pump of the outdoor unit or hydro module (`primary_pump`), drawn on the flow pipe; it also runs for hot water and turns slowly while the heat pump only circulates ("sniffing")
- total power consumption and production (heating, hot water and cooling, `sensor.<prefix>_consumption` / `_production` of the integration), giving a live COP; without them the heating power sensors
- outdoor temperature
- DHW temperature and target
- zone 1 water and room temperature; zone 2 becomes heating circuit 2 with `hc_count: 2`. The room temperature is `…_main_z1_temp` when the zone sensor setting is "Internal Thermostat" or "Thermistor"; otherwise `z1_temp` is the zone water temperature and the card uses the remote control sensor `…_main_room_thermostat_temp`
- heating curve shift (`hc_curve_offset`) in the heating mode "compensation curve": the circuit label shows the target with its parts, for example "Target 36 °C (curve 34 °C + 2 K shift)", from the heat request temperature (`number.<prefix>_main_z1_heat_request_temp`, `z2_` for circuit 2). The heating mode is read when the card is built, so reload the dashboard after changing it; in direct mode the entity is the flow target itself and is not used
- internal backup heater
- water pressure (`…_main_water_pressure`, TOP115, bar) as the heating pressure, only where the entity exists: K/L series, enabled by default since heishamon-homeassistant 2.12.0 (#276)
- details: operating hours and counter, heater hours, compressor frequency, discharge temperature, high and low pressure, expansion valve

Notes from real installations:
- The integration reads the Power and the Energy topic of each value, depending on the firmware, so the entity ids contain either `…_heat_power_consumption` or `…_heat_energy_consumption`. The preset accepts both. The schematic prefers the total sensors `sensor.<prefix>_consumption` and `sensor.<prefix>_production`, then `sensor.aquarea_energy_consumption` and `sensor.aquarea_energy_production` (all including hot water); the period tiles use the heating, hot water and cooling sensors.
- `sensor.<prefix>_main_z1_temp` is the zone *water* temperature when the zone sensor setting is "Water Temperature", and reads −128 °C without a room sensor. The preset then prefers `…_main_room_thermostat_temp`; if that value is not a room temperature either, remove it with `entities: {room: null}`.
- Some models report a low pressure of 0.0 permanently; hide it with `entities: {low_pressure: null}`.
- The heating setpoint is the zone target temperature. The outlet target (`main_target_temp`) follows the hot-water target while the 3-way valve is on the tank and is only used when no zone target exists.

S0 kWh meters on the HeishaMon board measure the real electrical power, which is more exact than the value the heat pump reports. The integration creates `sensor.<prefix>_s0_watt_<port>`; which port measures what depends on the wiring, so the preset does not use them. Set them as `power`, as one entity or as a list for several meters (for example heat pump and internal heater):

```yaml
entities:
  power:
    - sensor.panasonic_heat_pump_s0_watt_1
    - sensor.panasonic_heat_pump_s0_watt_2
```

HeishaMon has no "current activity" value: the card shows heating while the compressor runs, hot water when the valve is on "Tank", and defrost from the defrost state. Leave `mode` empty: `select.<prefix>_main_operating_mode_state` ("Heat only", "Heat+DHW" …) is the chosen mode, not what the unit does now, and keeps the card idle (#276); the plausibility check reports it. If you use HeishaMon with your own MQTT YAML instead of the integration, map the entities manually (see below).

## Mapped

- Error chip from TOP44 "Last Error" (`sensor.<prefix>_main_error`). "No error" is no error; an H/F code (H76, F12 …) stays until the error is reset.
- Electricity and heat total (`energy_total`, `heat_total`) from `sensor.aquarea_pump_total_consumption_total` and `sensor.aquarea_pump_total_production_total` (kWh). They also fill the energy, heat and total COP tiles. The tiles per mode get `sensor.aquarea_heat_power_consumed_total`, `…_heat_power_produced_total`, `…_dhw_power_consumed_total`, `…_dhw_power_produced_total` and the cooling totals, so all periods come from the long-term statistics.
- Refrigerant circuit in the details drawer, in heating mode:
  - evaporation (`evap_temp`) from the outdoor heat exchanger pipe, `…_main_outside_pipe_temp`
  - suction gas (`suction_temp`) from the evaporator outlet, `…_main_eva_outlet_temp`
  - liquid line (`liquid_temp`) from the indoor (plate heat exchanger) pipe, `…_main_inside_pipe_temp`
  - the card computes the superheat from suction gas and evaporation
- Heating curve shift (`hc_curve_offset`) from `number.<prefix>_main_z1_heat_request_temp` (`z2_` for circuit 2). Only with the heating mode "compensation curve" (`sensor.<prefix>_main_heating_mode`): there the value shifts the curve by −5 to +5 K. `…_z1_water_target_temp` already contains the shift (both change in the same second), so the card shows "Target 36 °C (curve 34 °C + 2 K shift)" above the circuit flow pipe. In direct mode the number is the flow target itself and is left out. The mode is read when the card is built; reload the dashboard after a change of the heating mode.
- Fan speed (`fan_speed`) from `sensor.<prefix>_main_fan1_motor_speed` (rpm). The fan turns while the speed is above 0, also while it runs on after the compressor stops, and turns faster at a higher speed.
- Primary pump (`primary_pump: true`): the Aquarea primary pump sits in the outdoor unit (monobloc) or the hydro module (split) and also runs for hot water. The card draws it on the flow pipe next to the heat pump block, centred under the flow temperature and over the flow rate, and turns it while `…_main_pump_flow` (TOP1) is above 0. The single zone has no pump of its own; `primary_pump: false` draws the pump in the circuit again.
- Zone water temperature (`hc_flow`) only with a zone sensor. Without one HeishaMon reports about −78 to −128 °C; the preset then leaves `hc_flow` out and the circuit shows the heat pump's flow (direct system). With the heating curve shift the circuit then shows no flow temperature of its own; the heat pump's flow stands at the VL label.

## Deliberately not mapped

- `dhw_heater`: `…_main_dhw_heater_state` (TOP58) and `…_room_heater_state` (TOP59) show if the heater is *permitted*, not if it runs.
- `hc_pump`: `…_main_z1_pump_state` (TOP124) is the zone pump of the zone kit; on a single-zone system without that kit it stays `off` while the heat pump's pump runs.
- `cond_temp`: no condensation temperature sensor, so the card computes no subcooling.
- `mode`, `status`, `room_target`, cut-outs, daily statistics: no matching value.
- S0 meters (`sensor.<prefix>_s0_watt_<port>`): which port measures what depends on the wiring. Set them as `power` (one entity or a list).

## Evidence

- Real installation: Panasonic WH-MDC05J3E5 (J generation), HeishaMon with S0 meters for heat pump and internal heater, no zone sensor. Diagnostic reports and history in https://github.com/heishamon/HeishaMon/discussions/1025.
- The kWh totals: the integration creates them as `IntegrationSensor` (left Riemann sum, `max_sub_interval` 5 min) from its W sensors, see https://github.com/Sturmi77/heatpump-hydraulic-card/issues/56.
- Refrigerant roles: in heating the outdoor pipe value follows the evaporation temperature, the evaporator outlet is a few kelvin above it, and the indoor pipe is near the flow temperature. A second HeishaMon user found the values plausible in the pull request.

## Known limits

- The kWh totals are not counters of the heat pump. They start when the integration was set up, stop while HeishaMon gets no data, and keep the 200 W steps of the reported power. On the installation above they were about 8 % (electricity) and 13 % (heat) lower than the meters over one year. For measured electricity set `energy_total` to an S0 meter, but only if `heat_total` covers the same time range.
- The refrigerant roles hold only in heating. In defrost and cooling the circuit runs backwards, so the card shows '–' for the three values and the superheat while the defrost entity is on or the mode is defrost or cooling (`heating_roles` in the preset). An entity set in the config keeps its value.
