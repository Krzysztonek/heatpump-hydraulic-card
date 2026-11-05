# Viessmann Vitocal (Open3E)

Preset `open3e`. Back to the [README](../../README.md#supported-heat-pumps).

## Setup

```yaml
type: custom:heatpump-flow-card
preset: open3e
hc_type: radiator
```
For the [Open3E Home Assistant integration](https://github.com/MojoOli/open3e-ha), which connects to the Open3E server over MQTT. The server communicates with the Vitocal over CAN. The preset uses the integration's entity-registry translation keys, so entity IDs and the Home Assistant language do not matter. If you have multiple Open3E devices, set `device:` to the Vitocal device ID.

Added from the card picker, the card counts the heating circuits the integration reports. `hc_count` can be set when the detected count needs adjusting; configure each circuit's emitter separately, for example:

```yaml
hc_count: 2
hc_type: radiator
hc2_type: underfloor
```

Open3E's `hot_water` valve state is recognized as DHW operation. Add a power meter if your installation does not expose `power_consumption_system`.

## Mapped

- Refrigeration circuit mode, compressor, diverter valve, system electrical and thermal power, flow and return temperatures, primary inlet temperature and outdoor temperature.
- Water pressure as the heating pressure (`hc_pressure`), drawn at the first circuit the card shows, also when it starts at circuit 2 (`index: { hc: 2 }`). Up to 0.18 it was mapped as brine pressure, which an air unit does not draw (#318).
- DHW tank levels, target and status; heating buffer temperature and mode; additional heater.
- Heating circuits: `flow_circuitN_temperature`, `flow_circuit_N_supply_temp_setpoint`, `circuit_N_pump` and `climate_circuit_N`, for every circuit up to `hc_count`. The room temperature `room1_temperature` is the house room of circuit 1.
- COP and energy for today, compressor and additional-heater counters, and available refrigerant measurements.

## Evidence and limits

Entity keys are based on the `open3e-ha` sensor, binary sensor, climate and select definitions listed in [`upstream/open3e.json`](../../upstream/open3e.json). The multiple-circuit mapping was tested with an Open3E installation (#168) and is covered by the browser self-test. Circuit count detection depends on the circuit entities exposed by the integration.
