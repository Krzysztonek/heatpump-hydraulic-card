# Daikin Altherma / ROTEX (ESPAltherma)

Preset `espaltherma`. Back to the [README](../../README.md#supported-heat-pumps).

## Setup

```yaml
type: custom:heatpump-flow-card
preset: espaltherma
```
For Daikin Altherma and ROTEX heat pumps with an ESP32 on the X10A port running [ESPAltherma](https://github.com/raomin/ESPAltherma) with Home Assistant MQTT device discovery. The preset needs one entity per value. The [beta branch](https://github.com/raomin/ESPAltherma/tree/beta) creates them under the device "Daikin Altherma via ESPAltherma"; older versions only publish `sensor.althermasensors` with the values as attributes, which the card cannot read.

Each value gets the id `<prefix>_<label>`: the label of the model definition in lower case, letters and digits only, spaces as underscores. "Leaving water temp. after BUH (R2T)" becomes `sensor.espaltherma_leaving_water_temp_after_buh_r2t`. The labels stay English when the names are translated, and they are the same in the Altherma 3, LT, EPRA, ERGA and EBLA definitions. The prefix is the base topic (`espaltherma` by default) and is detected from the leaving water temperature together with the inverter frequency. Only the values you uncomment in the definition file exist, so every field is optional.

The preset was built from the beta source and the entity list of an EPRA12EAV3 (#254); it is not yet tested on a real installation.

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
- details: discharge pipe (R2T), suction pipe (R3T), heat exchanger mid (R5T) and liquid pipe (R6T) temperatures

There is no mode: the card shows heating while the inverter runs, hot water while the 3-way valve is on, and defrost from the defrost operation. "I/U operation mode" names the demand (Heating, DHW …) and may keep it while the compressor pauses, so it is not used. Cooling therefore shows as heating. The water pump of the indoor unit also runs for hot water, so the card draws it on the flow pipe next to the heat pump (`primary_pump: false` draws it in the circuit again).

Not mapped: the pressures (`High Pressure`, `Low Pressure` and their saturation temperatures carry no reliable unit), the expansion valves (pulses, not percent) and the second fan.
