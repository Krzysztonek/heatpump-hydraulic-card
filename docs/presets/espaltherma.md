# Daikin Altherma / ROTEX (ESPAltherma)

Preset `espaltherma`. Back to the [README](../../README.md#supported-heat-pumps).

## Setup

```yaml
type: custom:heatpump-flow-card
preset: espaltherma
```
For Daikin Altherma and ROTEX heat pumps with an ESP32 on the X10A port running [ESPAltherma](https://github.com/raomin/ESPAltherma) with Home Assistant MQTT device discovery. The preset needs one entity per value. The [beta branch](https://github.com/raomin/ESPAltherma/tree/beta) creates them under the device "Daikin Altherma via ESPAltherma"; older versions only publish `sensor.althermasensors` with the values as attributes, which the card cannot read.

Each value gets the id `<prefix>_<label>`: the label of the model definition in lower case, letters and digits only, spaces as underscores. "Leaving water temp. after BUH (R2T)" becomes `sensor.espaltherma_leaving_water_temp_after_buh_r2t`. The labels stay English when the names are translated, and they are the same in the Altherma 3, LT, EPRA, ERGA and EBLA definitions. The prefix is the base topic (`espaltherma` by default) and is detected from the leaving water temperature together with the inverter frequency. Only the values you uncomment in the definition file exist, so every field is optional.

The preset was built from the beta source and the entity list of an EPRA12EAV3 (#254). Heating is confirmed on that installation with card 0.18.0; a hot-water charge is not yet confirmed, so the preset is still marked untested.

What you get:
- leaving water after the backup heater (R2T, falling back to R1T before it), inlet water (R4T), flow rate (l/min)
- inverter frequency (rps) as "running" and compressor speed, defrost, 3-way valve (on = hot water)
- backup heater (step 1) and booster heater in the tank
- electrical input and heat output from ESPAltherma's statistics (`Stats: …`): the input is estimated from the inverter current, the heat from flow rate and spread
- outdoor air (R1T), fan step
- DHW tank temperature (R5T) and target (`number.<prefix>_hot_water_target`, else the DHW setpoint), circulation pump
- circuit 1: leaving water target (main), water pressure, indoor ambient temperature and room target
- starts today and the COP of today for heating and hot water
- error codes of the indoor and outdoor unit: " 0" is fine, a code such as "U4" shows the error chip
- tiles: electricity and heat today for heating, hot water and cooling; week and month come from their long-term statistics
- details: evaporation and condensation as the saturation temperatures at low and high pressure (`Low Pressure(T)`, `High Pressure(T)`; without the first, the heat exchanger mid temperature R5T), discharge pipe (R2T), suction pipe (R3T) and liquid pipe (R6T)

No superheat or subcooling is derived from these sensors. On the EPRA12EAV3 of #254 the suction pipe read 4.4 °C while the saturation temperature at low pressure was 5.1 °C, so their differences mean nothing (#323).

There is no mode: the card shows heating while the inverter runs, hot water while the 3-way valve is on, and defrost from the defrost operation. "I/U operation mode" names the demand (Heating, DHW …) and may keep it while the compressor pauses, so it is not used. Cooling therefore shows as heating. The water pump of the indoor unit also runs for hot water, so the card draws it on the flow pipe next to the heat pump (`primary_pump: false` draws it in the circuit again).

Not mapped: the pressures themselves (`High Pressure`, `Low Pressure`), the expansion valves (pulses, not percent) and the second fan.
