// Simulated installations shared by the live demo (demo/index.html) and the self-test (test/selftest.html).
const lambdaStates = (x, s) => {
  const v = {
    [`${x}hp1_operating_state`]: 'CH', [`${x}hp1_state`]: 'REGULATION',
    [`${x}hp1_inverter_power_consumption`]: '1240', [`${x}hp1_actual_heating_capacity`]: '6.3',
    [`${x}hp1_flow_line_temperature`]: '32.4', [`${x}hp1_return_line_temperature`]: '27.9',
    [`${x}hp1_volume_flow_heat_sink`]: '2281', [`${x}hp1_energy_source_inlet_temperature`]: '9.8',
    [`${x}ambient_temperature_calculated`]: '10.4',
    [`${x}boil1_actual_high_temperature`]: '46.0', [`${x}boil1_actual_low_temperature`]: '38.5',
    [`${x}boil1_target_high_temperature`]: '50.0', [`${x}boil1_operating_state`]: 'STBY',
    [`${x}boil1_actual_circulation_pump_state`]: 'Off',
    [`${x}buff1_actual_high_temperature`]: '31.2', [`${x}buff1_actual_low_temperature`]: '27.4', [`${x}buff1_operating_state`]: 'HEATING',
    [`${x}hc1_flow_line_temperature`]: '30.1', [`${x}hc1_flow_line_temperature_setpoint`]: '30.2', [`${x}hc1_operating_state`]: 'HEATING',
    [`${x}hc1_room_device_temperature`]: 'unknown', [`${x}hc1_target_room_temperature`]: '23.0',
    [`${x}hp1_heating_cop_daily`]: '5.05', [`${x}hp1_hot_water_cop_daily`]: '4.15', [`${x}hp1_compressor_start_cycling_daily`]: '3',
    [`${x}hp1_relais_state_2nd_heating_stage`]: 'Off',
    [`${x}hp1_heating_cop_monthly`]: '4.62', [`${x}hp1_heating_cop_yearly`]: '4.48', [`${x}hp1_heating_cop_total`]: '4.51',
    [`${x}hp1_hot_water_cop_monthly`]: '3.95',
    [`${x}hp1_heating_energy_daily`]: ['4.2', 'kWh'], [`${x}hp1_heating_thermal_energy_daily`]: ['20.4', 'kWh'],
    [`${x}hp1_hot_water_energy_daily`]: ['0.9', 'kWh'], [`${x}hp1_hot_water_thermal_energy_daily`]: ['3.7', 'kWh'],
    [`${x}hp1_heating_energy_total`]: { state: '2410.2', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
    [`${x}hp1_compressor_start_cycling_yesterday`]: '5', [`${x}hp1_defrost_cycling_daily`]: '2', [`${x}hp1_defrost_cycling_yesterday`]: '4',
    [`${x}hp1_stby_energy_daily`]: ['0.12', 'kWh'],
    [`${x}hp1_compressor_start_cycling_total`]: ['1843', 'cycles'],
    [`${x}hp1_compressor_power_consumption_accumulated`]: ['3120.4', 'kWh'],
    [`${x}hp1_compressor_thermal_energy_output_accumulated`]: ['14210.8', 'kWh'],
    [`${x}hp1_compressor_unit_rating`]: ['46', '%'],
    [`${x}hp1_evaporation_temperature`]: ['3.6', '°C'], [`${x}hp1_condensation_temperature`]: ['36.9', '°C'],
    [`${x}hp1_suction_gas_temperature`]: ['8.4', '°C'], [`${x}hp1_hot_gas_temperature`]: ['61.5', '°C'],
    [`${x}hp1_subcooling_temperature`]: ['3.1', '°C'], [`${x}hp1_expansion_valve_opening_angle`]: ['38', '%'],
    [`${x}emgr_power_consumption_setpoint`]: ['0', 'W'],
    [`${x}hp1_error_number`]: '0', [`${x}boil1_error_number`]: '0', [`${x}buff1_error_number`]: '0', [`${x}hc1_error_number`]: '0', [`${x}ambient_error_number`]: '0',
  };
  const S = {
    heat: { [`${x}emgr_power_consumption_setpoint`]: ['1800', 'W'] },
    dhw: { [`${x}hp1_compressor_unit_rating`]: ['62', '%'], [`${x}hp1_condensation_temperature`]: ['52.4', '°C'], [`${x}hp1_hot_gas_temperature`]: ['78.0', '°C'],
      [`${x}hp1_operating_state`]: 'DHW', [`${x}boil1_operating_state`]: 'DHW', [`${x}buff1_operating_state`]: 'STBY',
      [`${x}hp1_flow_line_temperature`]: '48.6', [`${x}hp1_return_line_temperature`]: '43.1', [`${x}hp1_inverter_power_consumption`]: '1650',
      [`${x}hp1_actual_heating_capacity`]: '6.9', [`${x}boil1_actual_circulation_pump_state`]: 'On' },
    defrost: { [`${x}hp1_operating_state`]: 'DEFROST', [`${x}hp1_flow_line_temperature`]: '24.0', [`${x}hp1_actual_heating_capacity`]: '0',
      [`${x}hp1_relais_state_2nd_heating_stage`]: 'On' },
    idle: { ...Object.fromEntries(['compressor_unit_rating', 'evaporation_temperature', 'condensation_temperature', 'suction_gas_temperature',
        'hot_gas_temperature', 'subcooling_temperature', 'expansion_valve_opening_angle'].map((k) => [`${x}hp1_${k}`, 'unknown'])),
      [`${x}hp1_operating_state`]: 'STBY', [`${x}hp1_state`]: 'READY', [`${x}hp1_inverter_power_consumption`]: '0',
      [`${x}hp1_actual_heating_capacity`]: '0', [`${x}buff1_operating_state`]: 'STBY', [`${x}hp1_error_number`]: '7' },
  }[s];
  const out = {};
  for (const [k, val] of Object.entries({ ...v, ...S })) out[`sensor.${k}`] = val;
  return out;
};
const extras = (s) => ({
  'sensor.living_room_temperature': '22.8', 'sensor.heatpump_energy_today': '5.1', 'sensor.heatpump_pv_share_today': '24',
  'sensor.heatpump_power_from_pv': s === 'heat' ? '820' : '0', 'sensor.heatpump_power_from_battery': s === 'dhw' ? '1650' : '0',
  'sensor.heatpump_power_from_grid': s === 'heat' ? '420' : (s === 'defrost' ? '900' : '0'),
  'input_boolean.heatpump_boost': { state: s === 'dhw' ? 'on' : 'off', attributes: { friendly_name: 'Boost' } },
  'select.heatpump_operating_mode': { state: 'Automatic', attributes: { friendly_name: 'Operating mode', options: ['Automatic', 'Manual', 'Summer', 'Off'] } },
  'number.heatpump_dhw_target': { state: '50', attributes: { friendly_name: 'DHW target', min: 40, max: 60, step: 1, unit_of_measurement: '°C' } },
  'button.heatpump_dhw_boost': { state: 'unknown', attributes: { friendly_name: 'DHW boost once' } },
  'sensor.heating_curve_flow': ['33.5', '°C'],
  // Cut-out counters: events since the counter started, no unit.
  'sensor.heatpump_cutouts_high_pressure': { state: '3', attributes: { state_class: 'total_increasing' } },
  'sensor.heatpump_cutouts_low_pressure': { state: '0', attributes: { state_class: 'total_increasing' } },
  'sensor.heatpump_cutouts_temperature': { state: '12', attributes: { state_class: 'total_increasing' } },
  'sensor.heatpump_dhw_middle': ['42.3', '°C'], 'sensor.heatpump_buffer_middle': ['29.4', '°C'],
  // Heating program and a solar thermal collector (pump runs while the collector is hotter than the tank).
  'select.heatpump_heating_program': { state: { heat: 'Eco', dhw: 'Party', defrost: 'Night', idle: 'Holiday' }[s], attributes: { friendly_name: 'Heating program' } },
  'sensor.heatpump_solar_collector': [{ heat: '58.4', dhw: '71.0', defrost: '12.5', idle: '44.0' }[s], '°C'],
  'binary_sensor.heatpump_solar_pump': s === 'heat' || s === 'dhw' ? 'on' : 'off',
});
const otherStates = (s) => ({
  'sensor.wp_betriebsart': { heat: 'Heating', dhw: 'Hot water', defrost: 'Defrost', idle: 'Standby' }[s],
  'sensor.wp_vorlauf': { heat: '35.2', dhw: '52.0', defrost: '22', idle: '29' }[s],
  'sensor.wp_ruecklauf': { heat: '30.4', dhw: '46.5', defrost: '24', idle: '28.5' }[s],
  'sensor.wp_leistung': { heat: '1800', dhw: '2100', defrost: '900', idle: '3' }[s],
  'sensor.ww_temperatur': '47.5', 'sensor.aussen': '-2.4',
});

// ViCare: German entity ids, resolved via translation_key in the entity registry. Values may carry units.
const vicareReg = {
  'sensor.vitocal_verdichterphase': 'compressor_phase', 'binary_sensor.vitocal_verdichter': 'compressor',
  'binary_sensor.vitocal_warmwasser_laden': 'domestic_hot_water_charging', 'sensor.vitocal_vorlauf_sekundar': 'secondary_circuit_supply_temperature',
  'sensor.vitocal_rucklauf_sekundar': 'secondary_circuit_return_temperature', 'sensor.vitocal_volumenstrom': 'volumetric_flow',
  'sensor.vitocal_vorlauf_primar': 'primary_circuit_supply_temperature', 'sensor.vitocal_aussentemperatur': 'outside_temperature',
  'sensor.vitocal_speicher_oben': 'dhw_storage_top_temperature', 'sensor.vitocal_speicher_unten': 'dhw_storage_bottom_temperature',
  'binary_sensor.vitocal_heizkreispumpe': 'circulation_pump', 'sensor.vitocal_cop_heizen': 'cop_heating', 'sensor.vitocal_cop_ww': 'cop_dhw',
  'sensor.vitocal_stromverbrauch_heute': 'power_consumption_today', 'sensor.vitocal_verdichterstarts': 'compressor_starts',
};
const vicareStates = (s) => ({
  'sensor.vitocal_verdichterphase': { heat: 'heating', dhw: 'heating', defrost: 'defrost', idle: 'pause' }[s],
  'binary_sensor.vitocal_verdichter': s === 'idle' ? 'off' : 'on', 'binary_sensor.vitocal_warmwasser_laden': s === 'dhw' ? 'on' : 'off',
  'sensor.vitocal_vorlauf_sekundar': [{ heat: '42.5', dhw: '51.0', defrost: '25', idle: '30' }[s], '°C'],
  'sensor.vitocal_rucklauf_sekundar': [{ heat: '36.0', dhw: '45.5', defrost: '27', idle: '29.5' }[s], '°C'],
  'sensor.vitocal_volumenstrom': [s === 'idle' ? '0' : '0.95', 'm³/h'], 'sensor.vitocal_vorlauf_primar': ['2.1', '°C'],
  'sensor.vitocal_aussentemperatur': ['1.4', '°C'], 'sensor.vitocal_speicher_oben': ['49.0', '°C'], 'sensor.vitocal_speicher_unten': ['41.0', '°C'],
  'binary_sensor.vitocal_heizkreispumpe': s === 'idle' ? 'off' : 'on', 'sensor.vitocal_cop_heizen': '3.9', 'sensor.vitocal_cop_ww': '3.1',
  'sensor.vitocal_stromverbrauch_heute': ['8.4', 'kWh'], 'sensor.vitocal_verdichterstarts': '4123',
});
const vaillantStates = (s) => ({
  'sensor.zuhause_energy_manager_state': { heat: 'HEATING', dhw: 'DHW', defrost: 'HEATING', idle: 'STANDBY' }[s],
  'sensor.zuhause_system_flow_temperature': [{ heat: '34.0', dhw: '52.5', defrost: '30', idle: '28' }[s], '°C'],
  'sensor.zuhause_outdoor_temperature': ['3.5', '°C'], 'sensor.zuhause_domestic_hot_water_0_tank_temperature': ['47.0', '°C'],
  'sensor.zuhause_domestic_hot_water_0_setpoint': ['50', '°C'], 'sensor.zuhause_circuit_0_current_flow_temperature': ['32.8', '°C'],
  'sensor.zuhause_circuit_0_flow_temperature_setpoint': ['33.5', '°C'], 'sensor.zuhause_circuit_0_state': s === 'idle' ? 'STANDBY' : 'HEATING',
  'sensor.zuhause_device_1_arotherm_plus_current_power': [s === 'idle' ? '0.01' : '1.35', 'kW'],
  'sensor.zuhause_device_1_arotherm_plus_operation_time': ['4165.5', 'h'], 'sensor.zuhause_device_1_arotherm_plus_on_off_cycles': '2329',
  'sensor.zuhause_device_2_hydraulic_station_operation_time': ['1.5', 'h'], 'sensor.zuhause_device_2_hydraulic_station_on_off_cycles': '12',
  'sensor.zuhause_system_water_pressure': ['1.7', 'bar'],
  'sensor.zuhause_zone_wohnen_current_temperature': ['21.6', '°C'], 'sensor.zuhause_zone_wohnen_desired_temperature': ['21.5', '°C'],
  'binary_sensor.zuhause_trouble_codes': s === 'idle' ? 'on' : 'off',
});

// EMS-ESP (Bosch/Buderus …), German enum texts, entity format with instance prefix.
const emsStates = (s) => ({
  'sensor.ems_esp_boiler_hpactivity': { heat: 'Heizen', dhw: 'Warmwasser', defrost: 'Abtauen', idle: 'aus' }[s],
  'binary_sensor.ems_esp_boiler_hpcompon': s === 'idle' ? 'off' : 'on', 'binary_sensor.ems_esp_boiler_hp3way': s === 'dhw' ? 'on' : 'off',
  'sensor.ems_esp_boiler_hpcurrpower': [{ heat: '1450', dhw: '1900', defrost: '700', idle: '0' }[s], 'W'],
  'sensor.ems_esp_boiler_hptc1': [{ heat: '38.5', dhw: '52.0', defrost: '24', idle: '29' }[s], '°C'],
  'sensor.ems_esp_boiler_hptc0': [{ heat: '33.0', dhw: '46.5', defrost: '27', idle: '28.5' }[s], '°C'],
  'sensor.ems_esp_boiler_pc0flow': [s === 'idle' ? '0' : '1080', 'l/h'], 'sensor.ems_esp_boiler_hptl2': ['3.4', '°C'],
  'sensor.ems_esp_boiler_outdoortemp': ['2.8', '°C'], 'sensor.ems_esp_boiler_dhw_curtemp': ['47.5', '°C'], 'sensor.ems_esp_boiler_dhw_seltemp': ['52', '°C'],
  'sensor.ems_esp_thermostat_hc1_currtemp': ['21.4', '°C'], 'sensor.ems_esp_thermostat_hc1_seltemp': ['21.5', '°C'],
  'sensor.ems_esp_mixer_hc1_flowtemphc': ['34.0', '°C'],
  // Totals only; today and month come from the simulated long-term statistics (emsStatistics).
  'sensor.ems_esp_boiler_nrgconscompheating': { state: '4210.5', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ems_esp_boiler_nrgsuppheating': { state: '17890.2', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ems_esp_boiler_totalcompstarts': { state: '5123', attributes: { state_class: 'total_increasing' } },
  'sensor.ems_esp_boiler_uptimecontrol': { state: '312450', attributes: { unit_of_measurement: 'min', state_class: 'total_increasing' } },
});
const emsStatistics = {
  'sensor.ems_esp_boiler_nrgconscompheating': { today: 9.6, yesterday: 12.1, week: 58.3, month: 210.4, year: 1890.7 },
  'sensor.ems_esp_boiler_nrgsuppheating': { today: 38.9, yesterday: 47.2, week: 231.0, month: 812.0, year: 7610.3 },
  'sensor.ems_esp_boiler_totalcompstarts': { today: 4, yesterday: 6, week: 31, month: 118, year: 1102 },
  'sensor.ems_esp_boiler_uptimecontrol': { today: 610, yesterday: 790, week: 3950, month: 14200, year: 131000 },
};
// Simulated long-term statistics: change of a total counter per calendar period (recorder/statistic_during_period).
const statChange = (setup, msg) => {
  const c = msg.calendar || {};
  const v = setup.statistics?.[msg.statistic_id]?.[c.period === 'day' ? (c.offset ? 'yesterday' : 'today') : c.period];
  return v === undefined ? Promise.reject(new Error('no statistics')) : Promise.resolve({ change: v });
};
// Simulated history (compact format of the history API, seconds): one day of operating modes, ending in heating.
const historySim = (setup, msg) => {
  const now = Date.now(); const out = {};
  const plan = [[24, 'idle'], [22.5, 'heat'], [20, 'defrost'], [19.6, 'heat'], [17, 'dhw'], [16.3, 'idle'], [12, 'heat'], [8.5, 'defrost'], [8.1, 'heat'], [7, 'dhw'], [6.2, 'heat'], [3, 'defrost'], [2.9, 'heat']];
  for (const id of msg.entity_ids) {
    // A setup can bring its own history for switches and helpers: [hours ago, state].
    if (setup.history?.[id]) { out[id] = setup.history[id].map(([h, st]) => ({ s: st, lu: (now - h * 3600000) / 1000 })); continue; }
    out[id] = plan.map(([h, k]) => { const v = setup.states(k)[id]; const st = Array.isArray(v) ? v[0] : (v && typeof v === 'object' ? v.state : v); return { s: String(st), lu: (now - h * 3600000) / 1000 }; });
  }
  return Promise.resolve(out);
};
// HeishaMon (Panasonic Aquarea): no operating-mode entity, valve as Room/Tank, flow in L/min, power in W.
const hmStates = (s) => ({
  'sensor.panasonic_heat_pump_main_heat_pump_model': 'WH-MDC05J3E5 5 1ph HP',
  'sensor.panasonic_heat_pump_main_main_outlet_temp': [{ heat: '36.0', dhw: '50.5', defrost: '23', idle: '30' }[s], '°C'],
  'sensor.panasonic_heat_pump_main_main_inlet_temp': [{ heat: '31.0', dhw: '45.0', defrost: '26', idle: '29.5' }[s], '°C'],
  'sensor.panasonic_heat_pump_main_pump_flow': [s === 'idle' ? '0' : '18.5', 'L/min'],
  'sensor.panasonic_heat_pump_main_compressor_freq': [s === 'idle' ? '0' : '42', 'Hz'],
  'sensor.panasonic_heat_pump_main_threeway_valve_state': s === 'dhw' ? 'Tank' : 'Room',
  'binary_sensor.panasonic_heat_pump_main_defrosting_state': s === 'defrost' ? 'on' : 'off',
  'sensor.panasonic_heat_pump_main_heat_power_consumption': [s === 'idle' ? '0' : '1250', 'W'],
  'sensor.panasonic_heat_pump_main_heat_power_production': [{ heat: '5400', dhw: '4900', defrost: '0', idle: '0' }[s], 'W'],
  'sensor.panasonic_heat_pump_main_outside_temp': ['4.0', '°C'], 'sensor.panasonic_heat_pump_main_dhw_temp': ['48.0', '°C'],
  'number.panasonic_heat_pump_main_dhw_target_temp': ['50', '°C'], 'sensor.panasonic_heat_pump_main_z1_water_temp': ['35.5', '°C'],
  'sensor.panasonic_heat_pump_main_main_target_temp': ['36', '°C'], 'sensor.panasonic_heat_pump_main_z1_temp': ['21.0', '°C'],
});
// Ground source heat pump (EMS-ESP, no instance prefix): brine loop, two circuits, DHW heater rod and backup heater.
const brineStates = (s) => ({
  'sensor.boiler_hpactivity': { heat: 'Heizen', dhw: 'Warmwasser', defrost: 'Heizen', idle: 'aus' }[s],
  'binary_sensor.boiler_hpcompon': s === 'idle' ? 'off' : 'on', 'binary_sensor.boiler_hp3way': s === 'dhw' ? 'on' : 'off',
  'sensor.boiler_hpcurrpower': [{ heat: '1650', dhw: '2100', defrost: '1700', idle: '0' }[s], 'W'],
  'sensor.boiler_hptc1': [{ heat: '36.5', dhw: '53.0', defrost: '38.0', idle: '29' }[s], '°C'],
  'sensor.boiler_hptc0': [{ heat: '31.5', dhw: '47.0', defrost: '33.0', idle: '28.5' }[s], '°C'],
  'sensor.boiler_pc0flow': [s === 'idle' ? '0' : '1250', 'l/h'],
  'sensor.boiler_hpbrinein': [s === 'idle' ? '9.8' : '8.4', '°C'], 'sensor.boiler_hpbrineout': [s === 'idle' ? '9.6' : '5.1', '°C'],
  'sensor.boiler_brine_pressure': [{ heat: '145', dhw: '118', defrost: '82', idle: '54' }[s], 'kPa'],
  'sensor.boiler_heating_pressure': [{ heat: '1.8', dhw: '1.6', defrost: '0.9', idle: '0.6' }[s], 'bar'],
  'sensor.boiler_nrgconstotal': { state: '2600', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.boiler_environmental_energy_total': { state: '8200', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.boiler_outdoortemp': ['-6.5', '°C'], 'sensor.boiler_dhw_curtemp': ['49.5', '°C'], 'sensor.boiler_dhw_seltemp': ['55', '°C'],
  'binary_sensor.boiler_auxheaterstatus': s === 'defrost' ? 'on' : 'off',
  'binary_sensor.dhw_heater_rod': s === 'dhw' ? 'on' : 'off',
  'sensor.mixer_hc1_flowtemphc': ['33.0', '°C'], 'binary_sensor.mixer_hc1_pumpstatus': ['heat', 'defrost'].includes(s) ? 'on' : 'off',
  'sensor.mixer_hc2_flowtemphc': ['45.5', '°C'], 'binary_sensor.mixer_hc2_pumpstatus': s === 'heat' || s === 'defrost' ? 'on' : 'off',
  'sensor.thermostat_hc1_currtemp': ['21.2', '°C'], 'sensor.thermostat_hc1_seltemp': ['21.5', '°C'],
  // Upstairs (circuit 2): a room sensor of its own and the target of the thermostat's second circuit.
  'sensor.upstairs_temperature': ['20.6', '°C'], 'sensor.thermostat_hc2_seltemp': ['21.0', '°C'],
});
// Wolf CHA via wolflink: English parameter names, German list states, ein/aus switches, kW, L/min, repeated names with _2/_3.
const wolfStates = (s) => {
  const x = 'sensor.zuhause_';
  const on = s !== 'idle';
  const v = {
    operating_mode_heater: { heat: 'heizbetrieb', dhw: 'warmwasser', defrost: 'Abtaubetrieb', idle: 'standby' }[s],
    compressor_status: on ? 'Betrieb' : 'standby',
    compressor_frequency: [{ heat: '38', dhw: '50', defrost: '45', idle: '0' }[s], 'Hz'],
    current_capacity_specification_compressor: [{ heat: '46', dhw: '70', defrost: '60', idle: '0' }[s], '%'],
    power_consumption_wp_ehz: [{ heat: '1.2', dhw: '1.7', defrost: '0.9', idle: '0' }[s], 'kW'],
    current_secondary_power: [{ heat: '4.1', dhw: '4.9', defrost: '0', idle: '0' }[s], 'kW'],
    boiler_water_temperature: [{ heat: '31.4', dhw: '49.0', defrost: '22.0', idle: '28.8' }[s], '°C'],
    return_temperature: [{ heat: '26.9', dhw: '44.2', defrost: '25.0', idle: '24.6' }[s], '°C'],
    header_temperature: [{ heat: '30.8', dhw: '29.6', defrost: '29.8', idle: '29.4' }[s], '°C'],
    set_boiler_temperature: ['31.0', '°C'],
    hc_flow_rate: [on ? '17.6' : '0', 'L/min'],
    outside_temperature: ['4.5', '°C'], average_outside_temperature: ['5.2', '°C'],
    '3_way_diverter_valve_htg_dhw': s === 'dhw' ? 'warmwasser' : 'Heizen', '3_way_diverter_valve_htg_clg': 'Heizen',
    electric_booster_heater: 'aus',
    dhw_temperature: [s === 'dhw' ? '44' : '47', '°C'], set_dhw_temperature_adjusted: ['48', '°C'], set_dhw_temperature_adjusted_2: ['10', '°C'],
    set_dhw_temperature: ['10', '°C'], dhw_status: s === 'dhw' ? 'ein' : 'bereit_keine_ladung', '1x_dhw': 'aus',
    flow_temperature: ['30.1', '°C'], vf_mixer_circuit_flow_sensor: '30',
    mixer_circuit_status: 'heizbetrieb', mixer_circuit_demand: 'automatik_ein', mixer_circuit_pump: 'ein', mkp_mixer_circuit_pump: '1',
    heating_circuit_pump: 'aus', feed_heating_circuit_pump: 'aus', mixer_motor_mm: '0',
    room_temperature: { state: 'unknown', attributes: { unit_of_measurement: '°C' } },
    day_temperature: ['20', '°C'], day_temperature_2: ['21', '°C'], day_temperature_3: ['22', '°C'],
    prog_select: 'auto', prog_select_2: 'auto',
    party_mode: 'deaktiviert', holiday_mode: 'deaktiviert',
    system_pressure: ['1.65', 'bar'], sub_fault_code: '0',
    compressor_operating_hours: { state: '7500', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
    e_heating_operating_hours: { state: '3', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
    energy_amount_htg: { state: '28534', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
    energy_amount_dhw: { state: '11218', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
    clg_energy_amount: { state: '0', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
    heat_generated_previous_day: ['51', 'kWh'], heat_generated_current_month: ['732', 'kWh'],
    heat_generated_current_year: ['11865', 'kWh'], heat_generated_previous_year: ['19258', 'kWh'],
    consumption_previous_day: ['0', 'kWh'], consumption_current_month: ['0', 'kWh'], consumption_current_year: ['0', 'kWh'], consumption_previous_year: ['0', 'kWh'],
    dpf_previous_day: '0', mpf_current_month: '0', spf_current_year: '0', spf_previous_year: '0',
  };
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [`${x}${k}`, val]));
};
// Wolf CHA via wolf_smartset (HACS): German entity ids (device name + Wolf label), found by translation key only. List states are
// Wolf's texts as the SmartSet app shows them (Heizbetrieb, Betrieb, Ein). "Ausgang MKP" and "Raumtemperatur" start disabled in
// the integration, so they do not exist here; the circuit pump is "Mischerkreispumpe" of the system tab.
const wolfSmartsetReg = {
  'sensor.heizgerat_betriebsart_heizgerat': 'operating_mode_heater', 'sensor.heizgerat_verdichterstatus': 'compressor_status',
  'sensor.heizgerat_verdichterfrequenz': 'compressor_frequency', 'sensor.heizgerat_aktuelle_leistungsvorgabe_verdichter': 'current_capacity_specification_compressor',
  'sensor.heizgerat_leistungsaufnahme_wp_ehz': 'power_consumption_wp_ehz', 'sensor.heizgerat_aktuelle_sekundarleistung': 'current_secondary_power',
  'sensor.heizgerat_kesseltemperatur': 'boiler_water_temperature', 'sensor.heizgerat_kesselsolltemperatur': 'set_boiler_temperature',
  'sensor.heizgerat_rucklauftemperatur': 'return_temperature', 'sensor.heizgerat_sammlertemperatur': 'header_temperature',
  'sensor.heizgerat_heizkreisdurchfluss': 'hc_flow_rate', 'sensor.heizgerat_aussentemperatur_heizung': 'outside_temperature',
  'sensor.bedienmodul_bm_2_0_gemittelte_aussentemperatur': 'average_outside_temperature',
  'sensor.heizgerat_3_wege_umschaltventil_hz_ww': '3_way_diverter_valve_htg_dhw', 'sensor.heizgerat_3_wege_umschaltventil_hz_k': '3_way_diverter_valve_htg_clg',
  'sensor.heizgerat_e_heizung': 'electric_booster_heater', 'sensor.heizgerat_warmwassertemperatur': 'dhw_temperature',
  'sensor.heizgerat_warmwassersolltemperatur': 'set_dhw_temperature_adjusted', 'sensor.wolf_cha_warmwasser_status': 'dhw_status',
  'sensor.bedienmodul_bm_2_0_vorlauftemperatur': 'flow_temperature', 'sensor.bedienmodul_bm_2_0_mischerkreis_status': 'mixer_circuit_status',
  'sensor.bedienmodul_bm_2_0_anforderung_mischerkreis': 'mixer_circuit_demand', 'sensor.wolf_cha_mischerkreispumpe': 'mixer_circuit_pump',
  'sensor.heizgerat_heizkreispumpe': 'heating_circuit_pump', 'sensor.heizgerat_anlagendruck': 'system_pressure',
  'number.bedienmodul_bm_2_0_tagtemperatur_heizung_mischerkreis_1': 'day_temperature_mixer_circuit_1',
  'number.wolf_cha_warmwassersolltemperatur_eingestellt': 'set_dhw_temperature',
  'sensor.heizgerat_betriebsstunden_verdichter': 'compressor_operating_hours', 'sensor.heizgerat_betriebsstunden_e_heizung': 'e_heating_operating_hours',
  'sensor.heizgerat_energiemenge_hz': 'energy_amount_htg', 'sensor.heizgerat_energiemenge_ww': 'energy_amount_dhw', 'sensor.heizgerat_energiemenge_kuhl': 'clg_energy_amount',
  'sensor.heizgerat_erzeugte_warmemenge_vortag': 'heat_generated_previous_day', 'sensor.heizgerat_erzeugte_warmemenge_aktueller_monat': 'heat_generated_current_month',
  'sensor.heizgerat_erzeugte_warmemenge_aktuelles_jahr': 'heat_generated_current_year',
};
const wolfSmartsetStates = (s) => ({
  'sensor.heizgerat_betriebsart_heizgerat': { heat: 'Heizbetrieb', dhw: 'Warmwasser', defrost: 'Abtaubetrieb', idle: 'Standby' }[s],
  'sensor.heizgerat_verdichterstatus': { heat: 'Betrieb', dhw: 'Betrieb', defrost: 'Abtaubetrieb', idle: 'Standby' }[s],
  'sensor.heizgerat_verdichterfrequenz': [{ heat: '38', dhw: '50', defrost: '45', idle: '0' }[s], 'Hz'],
  'sensor.heizgerat_aktuelle_leistungsvorgabe_verdichter': [{ heat: '46', dhw: '70', defrost: '60', idle: '0' }[s], '%'],
  'sensor.heizgerat_leistungsaufnahme_wp_ehz': [{ heat: '1.2', dhw: '1.7', defrost: '0.9', idle: '0' }[s], 'kW'],
  'sensor.heizgerat_aktuelle_sekundarleistung': [{ heat: '4.1', dhw: '4.9', defrost: '0', idle: '0' }[s], 'kW'],
  'sensor.heizgerat_kesseltemperatur': [{ heat: '31.4', dhw: '49.0', defrost: '22.0', idle: '28.8' }[s], '°C'],
  'sensor.heizgerat_kesselsolltemperatur': ['31.0', '°C'],
  'sensor.heizgerat_rucklauftemperatur': [{ heat: '26.9', dhw: '44.2', defrost: '25.0', idle: '24.6' }[s], '°C'],
  'sensor.heizgerat_sammlertemperatur': [{ heat: '30.8', dhw: '29.6', defrost: '29.8', idle: '29.4' }[s], '°C'],
  'sensor.heizgerat_heizkreisdurchfluss': [s === 'idle' ? '0' : '17.6', 'L/min'],
  'sensor.heizgerat_aussentemperatur_heizung': ['4.5', '°C'], 'sensor.bedienmodul_bm_2_0_gemittelte_aussentemperatur': ['5.2', '°C'],
  'sensor.heizgerat_3_wege_umschaltventil_hz_ww': s === 'dhw' ? 'Warmwasser' : 'Heizen', 'sensor.heizgerat_3_wege_umschaltventil_hz_k': 'Heizen',
  'sensor.heizgerat_e_heizung': 'Aus',
  // "Warmwassersolltemperatur" (read-only) is the effective DHW target: 48 °C while hot water is on or ready, 10 °C only while the DHW status is Aus.
  'sensor.heizgerat_warmwassertemperatur': [s === 'dhw' ? '44' : '47', '°C'], 'sensor.heizgerat_warmwassersolltemperatur': ['48', '°C'],
  'sensor.wolf_cha_warmwasser_status': s === 'dhw' ? 'Ein' : 'Bereit, keine Ladung',
  'sensor.bedienmodul_bm_2_0_vorlauftemperatur': ['30.1', '°C'],
  'sensor.bedienmodul_bm_2_0_mischerkreis_status': s === 'idle' ? 'AT Abschaltung' : 'Heizbetrieb',
  'sensor.bedienmodul_bm_2_0_anforderung_mischerkreis': 'Automatik ein',
  'sensor.wolf_cha_mischerkreispumpe': s === 'idle' ? 'Aus' : 'Ein', 'sensor.heizgerat_heizkreispumpe': 'Aus',
  'sensor.heizgerat_anlagendruck': ['1.65', 'bar'],
  'number.bedienmodul_bm_2_0_tagtemperatur_heizung_mischerkreis_1': { state: '20', attributes: { unit_of_measurement: '°C', min: 5, max: 30, step: 0.5, friendly_name: 'Tagtemperatur (Heizung) (Mischerkreis 1)' } },
  'number.wolf_cha_warmwassersolltemperatur_eingestellt': { state: '48', attributes: { unit_of_measurement: '°C', min: 25, max: 65, step: 1, friendly_name: 'Warmwassersolltemperatur eingestellt' } },
  'sensor.heizgerat_betriebsstunden_verdichter': { state: '7500', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
  'sensor.heizgerat_betriebsstunden_e_heizung': { state: '3', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
  'sensor.heizgerat_energiemenge_hz': { state: '28534', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.heizgerat_energiemenge_ww': { state: '11218', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.heizgerat_energiemenge_kuhl': { state: '0', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.heizgerat_erzeugte_warmemenge_vortag': ['51', 'kWh'], 'sensor.heizgerat_erzeugte_warmemenge_aktueller_monat': ['732', 'kWh'],
  'sensor.heizgerat_erzeugte_warmemenge_aktuelles_jahr': ['11865', 'kWh'],
});
// Vaillant aroTHERM plus via ebusd (HMU + VWZ hydraulic station + sensoCOMFORT), entity ids from a real installation:
// most carry the topic prefix, newer ones also the device name (sensor.heating_ebusd_…). Underfloor + radiator circuit.
const ebusdStates = (s) => ({
  'sensor.ebusd_hmu_rundatastatuscode': { heat: 'heat_compressor_active', dhw: 'hwc_compressor_active', defrost: 'deicing_active', idle: 'standby' }[s],
  'sensor.ebusd_hmu_rundatacompressorspeed': [{ heat: '70.8', dhw: '88.0', defrost: '60.0', idle: '0' }[s], 'rps'],
  'sensor.ebusd_vwzio_statusdhw_dhwactive': s === 'dhw' ? 'on' : 'off',
  'sensor.ebusd_hmu_currentconsumedpower': [{ heat: '0.9', dhw: '1.6', defrost: '0.7', idle: '0' }[s], 'kW'],
  'sensor.ebusd_hmu_currentyieldpower': [{ heat: '2.3', dhw: '3.4', defrost: '0', idle: '0' }[s], 'kW'],
  'sensor.ebusd_hmu_rundataflowtemp': [{ heat: '45.3', dhw: '55.1', defrost: '24.0', idle: '30.2' }[s], '°C'],
  'sensor.ebusd_hmu_rundatareturntemp': [{ heat: '42.4', dhw: '50.2', defrost: '27.5', idle: '29.8' }[s], '°C'],
  'sensor.ebusd_hmu_buildingcircuitflow': [s === 'idle' ? '0' : '1201', 'l/h'],
  'sensor.ebusd_hmu_rundataairinlettemp': ['7.2', '°C'], 'sensor.ebusd_broadcast_outsidetemp': ['9.0', '°C'],
  'sensor.ebusd_hmu_flowpressure': [s === 'idle' ? '1.2' : '1.41', 'bar'],
  'sensor.ebusd_ctlv2_hwcstoragetemp': ['45.5', '°C'], 'sensor.ebusd_ctlv2_hwctempdesired': ['48', '°C'],
  'sensor.ebusd_ctlv2_hc1flowtemp': ['33.9', '°C'], 'sensor.ebusd_ctlv2_hc1actualflowtempdesired': ['33.8', '°C'],
  'sensor.ebusd_ctlv2_hc1pumpstatus': s === 'idle' ? '0' : '1',
  'sensor.ebusd_ctlv2_hc2flowtemp': ['43.8', '°C'], 'sensor.ebusd_ctlv2_hc2actualflowtempdesired': ['43.8', '°C'],
  'sensor.ebusd_ctlv2_hc2pumpstatus': s === 'heat' ? '1' : '0',
  'sensor.ebusd_ctlv2_hc3flowtemp': 'unknown', 'sensor.ebusd_ctlv2_hc3pumpstatus': '0',
  'sensor.ebusd_ctlv2_z1roomtemp': ['21.4', '°C'], 'sensor.ebusd_ctlv2_z1actualroomtempdesired': ['21.5', '°C'],
  'sensor.ebusd_hmu_runstatscompressorhours': { state: '7927', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
  'sensor.ebusd_hmu_runstatscompressorstarts': { state: '9309', attributes: { state_class: 'total_increasing' } },
  'sensor.ebusd_vwzio_immersionheaterhours': ['116', 'h'],
  'sensor.ebusd_hmu_statelectricenergysum': { state: '20612.3', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ebusd_hmu_statelectricenergysumhc': { state: '13515.2', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ebusd_hmu_statelectricenergysumhwc': { state: '7081.8', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ebusd_hmu_statenvironmentenergysum': { state: '31922.9', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.ebusd_hmu_rundataevaporationtemp': ['3.2', '°C'],
  'sensor.ebusd_hmu_rundatacompressorinlettemp': ['1.7', '°C'], 'sensor.ebusd_hmu_rundatacompressoroutlettemp': ['55.5', '°C'],
  'sensor.ebusd_hmu_rundatahighpressure': ['15.2', 'bar'], 'sensor.ebusd_hmu_rundataeevpositionabs': '143',
  'sensor.ebusd_hmu_rundataoverheatingactualvalue': ['0.2', 'K'],
  'sensor.ebusd_hmu_currenterror_error': s === 'idle' ? '1100' : 'unknown',
});
// Luxtronik controller (Alpha Innotec, Novelan, Roth …) through the Luxtronik integration (BenPru/luxtronik), resolved via translation_key.
// Built from the integration source, not from a real installation: a water/water heat pump with one mixing circuit; mixing circuit 2
// is not installed and reports a flow but a target of 0.
const luxtronikReg = {
  'sensor.luxtronik2_status': 'status', 'binary_sensor.luxtronik2_compressor': 'compressor',
  'sensor.luxtronik2_flow_in_temperature': 'flow_in_temperature', 'sensor.luxtronik2_flow_out_temperature': 'flow_out_temperature',
  'sensor.luxtronik2_heat_amount_flow_rate': 'heat_amount_flow_rate', 'sensor.luxtronik2_heat_source_flow_rate': 'heat_source_flow_rate',
  'sensor.luxtronik2_heat_source_input_temperature': 'heat_source_input_temperature', 'sensor.luxtronik2_heat_source_output_temperature': 'heat_source_output_temperature',
  'sensor.luxtronik2_outdoor_temperature': 'outdoor_temperature', 'sensor.luxtronik2_dhw_temperature': 'dhw_temperature',
  'number.luxtronik2_dhw_target_temperature': 'dhw_target_temperature', 'select.luxtronik2_heating_mode': 'heating_mode',
  'sensor.luxtronik2_current_power_consumption': 'current_power_consumption', 'sensor.luxtronik2_current_heat_output': 'current_heat_output',
  'binary_sensor.luxtronik2_additional_heat_generator': 'additional_heat_generator', 'binary_sensor.luxtronik2_circulation_pump_heating': 'circulation_pump_heating',
  'sensor.luxtronik2_flow_in_circuit1_temperature': 'flow_in_circuit1_temperature', 'sensor.luxtronik2_flow_in_circuit1_target_temperature': 'flow_in_circuit1_target_temperature',
  'sensor.luxtronik2_flow_in_circuit2_temperature': 'flow_in_circuit2_temperature', 'sensor.luxtronik2_flow_in_circuit2_target_temperature': 'flow_in_circuit2_target_temperature',
  'sensor.luxtronik2_room_thermostat_temperature': 'room_thermostat_temperature', 'sensor.luxtronik2_room_thermostat_temperature_target': 'room_thermostat_temperature_target',
  'sensor.luxtronik2_hot_gas_temperature': 'hot_gas_temperature', 'sensor.luxtronik2_suction_compressor_temperature': 'suction_compressor_temperature',
  'sensor.luxtronik2_overheating_temperature': 'overheating_temperature', 'sensor.luxtronik2_high_pressure': 'high_pressure', 'sensor.luxtronik2_low_pressure': 'low_pressure',
  'sensor.luxtronik2_compressor1_operation_hours': 'compressor1_operation_hours', 'sensor.luxtronik2_compressor1_impulses': 'compressor1_impulses',
  'sensor.luxtronik2_heat_amount_counter': 'heat_amount_counter', 'sensor.luxtronik2_heat_amount_heating': 'heat_amount_heating', 'sensor.luxtronik2_dhw_heat_amount': 'dhw_heat_amount',
  'sensor.luxtronik2_heat_energy_input': 'heat_energy_input', 'sensor.luxtronik2_dhw_energy_input': 'dhw_energy_input',
};
const luxtronikStates = (s) => ({
  'sensor.luxtronik2_status': { heat: 'heating', dhw: 'hot_water', defrost: 'defrost', idle: 'no_request' }[s],
  'binary_sensor.luxtronik2_compressor': s === 'idle' ? 'off' : 'on',
  'sensor.luxtronik2_flow_in_temperature': [{ heat: '34.8', dhw: '53.1', defrost: '27.4', idle: '29.6' }[s], '°C'],
  'sensor.luxtronik2_flow_out_temperature': [{ heat: '29.9', dhw: '47.6', defrost: '28.1', idle: '29.3' }[s], '°C'],
  'sensor.luxtronik2_heat_amount_flow_rate': [{ heat: '1520', dhw: '1280', defrost: '1480', idle: '0' }[s], 'l/h'],
  'sensor.luxtronik2_heat_source_flow_rate': [{ heat: '2350', dhw: '2350', defrost: '2350', idle: '0' }[s], 'l/h'],
  'sensor.luxtronik2_heat_source_input_temperature': ['9.4', '°C'], 'sensor.luxtronik2_heat_source_output_temperature': [{ heat: '6.1', dhw: '6.4', defrost: '7.0', idle: '9.3' }[s], '°C'],
  'sensor.luxtronik2_outdoor_temperature': ['7.8', '°C'], 'sensor.luxtronik2_dhw_temperature': [{ heat: '49.2', dhw: '50.4', defrost: '49.0', idle: '49.6' }[s], '°C'],
  'number.luxtronik2_dhw_target_temperature': ['50', '°C'], 'select.luxtronik2_heating_mode': 'Automatic',
  'sensor.luxtronik2_current_power_consumption': [{ heat: '1180', dhw: '1790', defrost: '1010', idle: '0' }[s], 'W'],
  'sensor.luxtronik2_current_heat_output': [{ heat: '5260', dhw: '6930', defrost: '0', idle: '0' }[s], 'W'],
  'binary_sensor.luxtronik2_additional_heat_generator': 'off', 'binary_sensor.luxtronik2_circulation_pump_heating': s === 'heat' || s === 'idle' ? 'on' : 'off',
  'sensor.luxtronik2_flow_in_circuit1_temperature': [{ heat: '33.1', dhw: '31.5', defrost: '31.9', idle: '30.2' }[s], '°C'],
  'sensor.luxtronik2_flow_in_circuit1_target_temperature': ['33.5', '°C'],
  'sensor.luxtronik2_flow_in_circuit2_temperature': ['5.0', '°C'], 'sensor.luxtronik2_flow_in_circuit2_target_temperature': ['0.0', '°C'],
  'sensor.luxtronik2_room_thermostat_temperature': ['21.4', '°C'], 'sensor.luxtronik2_room_thermostat_temperature_target': ['21.5', '°C'],
  'sensor.luxtronik2_hot_gas_temperature': [{ heat: '68.2', dhw: '81.5', defrost: '44.0', idle: '24.1' }[s], '°C'],
  'sensor.luxtronik2_suction_compressor_temperature': [{ heat: '5.9', dhw: '6.6', defrost: '2.0', idle: '9.1' }[s], '°C'],
  'sensor.luxtronik2_overheating_temperature': [{ heat: '5.2', dhw: '5.8', defrost: '3.1', idle: '0.0' }[s], 'K'],
  'sensor.luxtronik2_high_pressure': [{ heat: '19.4', dhw: '25.8', defrost: '14.0', idle: '10.7' }[s], 'bar'],
  'sensor.luxtronik2_low_pressure': [{ heat: '6.3', dhw: '6.5', defrost: '4.8', idle: '8.9' }[s], 'bar'],
  'sensor.luxtronik2_compressor1_operation_hours': { state: '6218.43', attributes: { unit_of_measurement: 'h', state_class: 'total_increasing' } },
  'sensor.luxtronik2_compressor1_impulses': { state: '9120', attributes: { state_class: 'total_increasing' } },
  'sensor.luxtronik2_heat_amount_counter': { state: '41230.5', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.luxtronik2_heat_amount_heating': { state: '33810.2', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.luxtronik2_dhw_heat_amount': { state: '7420.3', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.luxtronik2_heat_energy_input': { state: '7690.4', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.luxtronik2_dhw_energy_input': { state: '2310.1', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
});

// Stiebel Eltron ISG (WPMsystem) through the Stiebel Eltron ISG integration (pail23), resolved via translation_key. The entity ids and the
// values of the temperatures, the flow rate, the hot water, the heat counter and the operating mode are those of the installation in
// issue #69 (a French Home Assistant); the rest is invented. Heating circuit 2, the solar collector and the heat source are not installed
// and read unavailable, as the integration does for hardware that is missing.
const isgPrefix = 'stiebel_eltron_wpmsystem_';
const isgNames = {
  sensor: {
    outdoor_temperature: 'temperature_exterieure', flow_temperature_wp1: 'temperature_de_depart_pac1', return_temperature_wp1: 'temperature_de_retour_pac1',
    volume_stream_wp1: 'debit_volumique_pac1', actual_temperature_water: 'temperature_actuelle_eau_chaude', target_temperature_water: 'temperature_cible_eau_chaude',
    actual_temperature_buffer: 'temperature_actuelle_tampon', actual_temperature_hk1: 'temperature_actuelle_cc_1', target_temperature_hk1: 'temperature_cible_cc_1',
    actual_temperature_hk2: 'temperature_actuelle_cc_2', target_temperature_hk2: 'temperature_cible_cc_2',
    actual_room_temperature_hk1: 'temperature_ambiante_cc_1', target_room_temperature_hk1: 'temperature_ambiante_cible_cc_1',
    current_power_consumption: 'puissance_absorbee', heater_pressure: 'pression_chauffage', source_temperature: 'temperature_source', source_pressure: 'pression_source',
    solar_collector_temperature: 'temperature_capteur_solaire', hot_gas_temperature_wp1: 'temperature_gaz_chauds_pac1',
    high_pressure_wp1: 'haute_pression_pac1', low_pressure_wp1: 'basse_pression_pac1',
    produced_heating: 'chaleur_produite_chauffage', produced_heating_total: 'chaleur_produite_chauffage_total',
    produced_water_heating: 'chaleur_produite_eau_chaude', consumed_heating: 'energie_consommee_chauffage', consumed_water_heating: 'energie_consommee_eau_chaude',
    compressor_heating: 'duree_compresseur_chauffage', compressor_heating_water: 'duree_compresseur_eau_chaude', nhz_1_2_runtime: 'duree_appoint_1_2',
  },
  binary_sensor: {
    compressor_on: 'compresseur', evaporator_defrost: 'degivrage_evaporateur', is_heating_water: 'production_eau_chaude', nhz_stages_running: 'appoint_en_marche',
    heating_circuit_1_pump: 'pompe_circuit_chauffage_1', heating_circuit_2_pump: 'pompe_circuit_chauffage_2', circulation_pump: 'pompe_de_bouclage', error_status: 'defaut',
  },
  select: { operation_mode: 'mode_de_fonctionnement' },
  number: { comfort_water_temperature_target: 'consigne_confort_eau_chaude' },
};
const isgId = (domain, tk) => `${domain}.${isgPrefix}${isgNames[domain][tk]}`;
const isgReg = Object.fromEntries(Object.entries(isgNames).flatMap(([domain, tks]) => Object.keys(tks).map((tk) => [isgId(domain, tk), tk])));
const isgStates = (s) => {
  const pick = (v) => v[s];
  const sensor = (tk, value, unit) => [isgId('sensor', tk), unit ? [value, unit] : value];
  const counter = (tk, value, unit) => [isgId('sensor', tk), { state: value, attributes: { unit_of_measurement: unit, state_class: 'total_increasing' } }];
  const binary = (tk, on) => [isgId('binary_sensor', tk), on ? 'on' : 'off'];
  return Object.fromEntries([
    sensor('outdoor_temperature', '5.2', '°C'),
    sensor('flow_temperature_wp1', pick({ heat: '33.8', dhw: '52.4', defrost: '24.6', idle: '30.1' }), '°C'),
    sensor('return_temperature_wp1', pick({ heat: '29.4', dhw: '47.9', defrost: '26.2', idle: '29.8' }), '°C'),
    sensor('volume_stream_wp1', pick({ heat: '22.2', dhw: '19.4', defrost: '21.0', idle: '0.0' }), 'L/min'),
    sensor('actual_temperature_water', pick({ heat: '45.4', dhw: '47.1', defrost: '45.2', idle: '45.0' }), '°C'),
    sensor('target_temperature_water', '48.0', '°C'),
    sensor('actual_temperature_buffer', pick({ heat: '27.4', dhw: '27.0', defrost: '26.8', idle: '28.1' }), '°C'),
    sensor('actual_temperature_hk1', pick({ heat: '28.9', dhw: '28.2', defrost: '27.6', idle: '28.4' }), '°C'),
    sensor('target_temperature_hk1', '27.5', '°C'),
    sensor('actual_temperature_hk2', 'unavailable'), sensor('target_temperature_hk2', 'unavailable'),
    sensor('actual_room_temperature_hk1', '22.8', '°C'), sensor('target_room_temperature_hk1', '22.5', '°C'),
    sensor('current_power_consumption', pick({ heat: '1.6', dhw: '2.1', defrost: '1.2', idle: '0.0' }), 'kW'),
    sensor('heater_pressure', '1.6', 'bar'),
    sensor('source_temperature', 'unavailable'), sensor('source_pressure', 'unavailable'), sensor('solar_collector_temperature', 'unavailable'),
    sensor('hot_gas_temperature_wp1', pick({ heat: '62.0', dhw: '78.4', defrost: '41.0', idle: '25.0' }), '°C'),
    sensor('high_pressure_wp1', pick({ heat: '17.8', dhw: '24.6', defrost: '13.2', idle: '10.9' }), 'bar'),
    sensor('low_pressure_wp1', pick({ heat: '5.2', dhw: '5.0', defrost: '3.9', idle: '7.4' }), 'bar'),
    counter('produced_heating', '33856', 'kWh'), counter('produced_heating_total', '33837', 'kWh'),
    counter('produced_water_heating', '7420', 'kWh'), counter('consumed_heating', '9210', 'kWh'), counter('consumed_water_heating', '2150', 'kWh'),
    counter('compressor_heating', '5120', 'h'), counter('compressor_heating_water', '1310', 'h'), counter('nhz_1_2_runtime', '38', 'h'),
    binary('compressor_on', s !== 'idle'), binary('evaporator_defrost', s === 'defrost'), binary('is_heating_water', s === 'dhw'),
    binary('nhz_stages_running', false), binary('heating_circuit_1_pump', s === 'heat' || s === 'idle'), binary('heating_circuit_2_pump', false),
    binary('circulation_pump', false), binary('error_status', s === 'idle'),
    [isgId('select', 'operation_mode'), { state: pick({ heat: 'program', dhw: 'program', defrost: 'program', idle: 'eco' }), attributes: { friendly_name: 'Mode de fonctionnement', options: ['emergency', 'ready', 'program', 'comfort', 'eco', 'water_heating'] } }],
    [isgId('number', 'comfort_water_temperature_target'), { state: '48', attributes: { friendly_name: 'Consigne confort eau chaude', unit_of_measurement: '°C', min: 10, max: 60, step: 1 } }],
  ]);
};
// Samsung EHS (esphome-samsung-nasa): entity names of Beormund's example.yaml, valve and error code as text sensors.
const samsungStates = (s) => ({
  'sensor.heat_pump_flow_temp_out': [{ heat: '32.6', dhw: '45.1', defrost: '22.0', idle: '28.0' }[s], '°C'],
  'sensor.heat_pump_flow_temp_return': [{ heat: '30.5', dhw: '40.3', defrost: '25.5', idle: '27.5' }[s], '°C'],
  'sensor.heat_pump_flow_rate_sensor': [s === 'idle' ? '0' : '14.5', 'L/min'],
  'binary_sensor.heat_pump_compressor_status': s === 'idle' ? 'off' : 'on',
  'sensor.heat_pump_compressor_frequency': [{ heat: '47', dhw: '58', defrost: '62', idle: '0' }[s], 'Hz'],
  'sensor.heat_pump_3_way_valve': s === 'dhw' ? 'Tank (DHW)' : 'Room (Heating)',
  'binary_sensor.heat_pump_defrost': s === 'defrost' ? 'on' : 'off',
  'binary_sensor.heat_pump_primary_water_pump': s === 'idle' ? 'off' : 'on',
  'binary_sensor.heat_pump_booster_heater': 'off',
  'sensor.heat_pump_power_consumed_last_minute': [{ heat: '1190', dhw: '1450', defrost: '1300', idle: '12' }[s], 'W'],
  'sensor.heat_pump_power_produced_last_minute': [{ heat: '4300', dhw: '4700', defrost: '0', idle: '0' }[s], 'W'],
  'sensor.heat_pump_outdoor_temperature': ['9.3', '°C'],
  'sensor.heat_pump_dhw_temperature': [s === 'dhw' ? '38.2' : '42.4', '°C'],
  'number.heat_pump_dhw_target_temperature': { state: '43', attributes: { unit_of_measurement: '°C', min: 30, max: 50, step: 1 } },
  'sensor.heat_pump_zone_1_indoor_temp': ['20.8', '°C'], 'number.heat_pump_zone_1_target_temp': ['21', '°C'],
  'sensor.heat_pump_error_code': s === 'idle' ? 'Communication Error (ODU Time-out 3m)' : 'No Error',
  'switch.heat_pump_away_mode': 'off',
  'sensor.heat_pump_total_consumed_energy': { state: '1843.2', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.heat_pump_total_produced_energy': { state: '6912.0', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.heat_pump_daily_energy_consumed': ['4.3', 'kWh'], 'sensor.heat_pump_daily_heat_generated': ['16.1', 'kWh'],
  'sensor.heat_pump_cop_daily': '3.74', 'sensor.heat_pump_cop_total': '3.75',
});
const regOf = (fn, platform) => Object.fromEntries(Object.keys(fn('heat')).map((id) => [id, { platform }]));

// Kronoterm via the Kronoterm integration (Cloud API), resolved via translation_key. Entity ids and values as on a real
// Hydro S + ADAPT installation: the hot water tank exists only as the DHW thermostat (climate), loop 1 has a room thermostat.
const kronotermReg = {
  'sensor.kronoterm_working_function_2': 'working_function', 'sensor.kronoterm_operation_regime_2': 'operation_regime',
  'sensor.kronoterm_error_warning_2': 'error_warning', 'sensor.kronoterm_heat_pump_hp_load': 'hp_load',
  'binary_sensor.kronoterm_heat_pump_defrost_status': 'defrost_status', 'binary_sensor.kronoterm_heat_pump_dhw_circulation_pump': 'dhw_circulation_pump',
  'binary_sensor.kronoterm_heat_pump_circulation_pump': 'circulation_pump', 'binary_sensor.kronoterm_heat_pump_main_circulation_pump': 'main_pump_status',
  'binary_sensor.kronoterm_heat_pump_reserve_source_status': 'reserve_source_status',
  'sensor.kronoterm_heat_pump_current_heating_cooling_power': 'current_heating_cooling_power',
  'sensor.kronoterm_heat_pump_current_heating_cooling_capacity': 'current_heating_cooling_capacity', 'sensor.kronoterm_heat_pump_cop_value': 'cop_value',
  'sensor.kronoterm_heat_pump_temperature_hp_outlet': 'hp_outlet_temperature', 'sensor.kronoterm_heat_pump_temperature_hp_inlet': 'hp_inlet_temperature',
  'sensor.kronoterm_heat_pump_temperature_outside': 'temperature_outside', 'climate.kronoterm_dhw_temperature': 'dhw_temperature',
  'climate.kronoterm_loop_1_temperature': 'loop_1_temperature', 'climate.kronoterm_loop_2_temperature': 'loop_2_temperature',
  'climate.kronoterm_reservoir_temperature': 'reservoir_temperature', 'sensor.kronoterm_loop_1_temperature': 'loop_1_temperature',
  'sensor.kronoterm_loop_2_temperature': 'loop_2_temperature', 'sensor.kronoterm_loop_1_inlet_temperature': 'loop_1_inlet_temperature',
  'sensor.kronoterm_heat_pump_loop_1_thermostat_temperature': 'loop_1_thermostat_temperature',
  'binary_sensor.kronoterm_heat_pump_circulation_loop_1': 'circulation_loop_1', 'binary_sensor.kronoterm_heat_pump_circulation_loop_2': 'circulation_loop_2',
  'sensor.kronoterm_heat_pump_heating_system_pressure': 'heating_system_pressure', 'select.kronoterm_operational_mode': 'operational_mode',
  'sensor.kronoterm_energy_combined': 'energy_combined', 'sensor.kronoterm_energy_heating': 'energy_heating', 'sensor.kronoterm_energy_dhw': 'energy_dhw',
  'sensor.kronoterm_energy_heater': 'energy_heater', 'sensor.kronoterm_heat_pump_electrical_energy_heating_dhw': 'electrical_energy_heating_dhw',
  'sensor.kronoterm_heat_pump_heating_energy_heating_dhw': 'heating_energy_heating_dhw', 'sensor.kronoterm_heat_pump_scop_value': 'scop_value',
  'sensor.kronoterm_heat_pump_compressor_activations_heating_24_h': 'compressor_activations_heating',
  'sensor.kronoterm_heat_pump_activations_boiler_24_h': 'activations_boiler', 'sensor.kronoterm_heat_pump_compressor_activations_cooling': 'compressor_activations_cooling',
  'sensor.kronoterm_heat_pump_operating_hours_compressor_heating': 'operating_hours_compressor_heating',
  'sensor.kronoterm_heat_pump_operating_hours_compressor_dhw': 'operating_hours_compressor_dhw',
  'sensor.kronoterm_heat_pump_operating_hours_additional_source_1': 'operating_hours_additional_source_1',
  'sensor.kronoterm_heat_pump_temperature_compressor_inlet': 'temperature_compressor_inlet',
  'sensor.kronoterm_heat_pump_temperature_compressor_outlet': 'temperature_compressor_outlet',
};
const kronotermStates = (s) => ({
  'sensor.kronoterm_working_function_2': { heat: 'heating', dhw: 'dhw', defrost: 'heating', idle: 'standby' }[s],
  'sensor.kronoterm_operation_regime_2': 'heating', 'sensor.kronoterm_error_warning_2': s === 'idle' ? 'warning' : 'no_error',
  'sensor.kronoterm_heat_pump_hp_load': [{ heat: '27', dhw: '100', defrost: '48', idle: '0' }[s], '%'],
  'binary_sensor.kronoterm_heat_pump_defrost_status': s === 'defrost' ? 'on' : 'off',
  'binary_sensor.kronoterm_heat_pump_dhw_circulation_pump': s === 'dhw' ? 'on' : 'off',
  'binary_sensor.kronoterm_heat_pump_circulation_pump': 'off', 'binary_sensor.kronoterm_heat_pump_main_circulation_pump': s === 'idle' ? 'off' : 'on',
  'binary_sensor.kronoterm_heat_pump_reserve_source_status': 'off',
  // The Cloud reports the electrical power as capacity ÷ COP; both read 0 while the unit defrosts.
  'sensor.kronoterm_heat_pump_current_heating_cooling_power': [{ heat: '1463.9', dhw: '2870.5', defrost: '0', idle: '0' }[s], 'W'],
  'sensor.kronoterm_heat_pump_current_heating_cooling_capacity': [{ heat: '5475', dhw: '8991', defrost: '0', idle: '0' }[s], 'W'],
  'sensor.kronoterm_heat_pump_cop_value': { heat: '3.74', dhw: '3.13', defrost: '0', idle: '0' }[s],
  'sensor.kronoterm_heat_pump_temperature_hp_outlet': [{ heat: '35.6', dhw: '52.4', defrost: '30.1', idle: '29.4' }[s], '°C'],
  'sensor.kronoterm_heat_pump_temperature_hp_inlet': [{ heat: '31.2', dhw: '47.0', defrost: '30.6', idle: '28.9' }[s], '°C'],
  'sensor.kronoterm_heat_pump_temperature_outside': ['6.2', '°C'],
  'climate.kronoterm_dhw_temperature': { state: 'heat', attributes: { current_temperature: { heat: 49.6, dhw: 46.8, defrost: 49.4, idle: 51.3 }[s], temperature: 50, friendly_name: 'DHW Thermostat' } },
  'climate.kronoterm_loop_1_temperature': { state: 'heat', attributes: { current_temperature: 22.4, temperature: 22.7, friendly_name: 'Loop 1 Thermostat' } },
  'climate.kronoterm_loop_2_temperature': { state: 'heat', attributes: { current_temperature: 30.5, temperature: 19.9, friendly_name: 'Loop 2 Thermostat' } },
  'climate.kronoterm_reservoir_temperature': { state: 'heat', attributes: { current_temperature: 35.6, temperature: 19.9, friendly_name: 'Reservoir Thermostat' } },
  'sensor.kronoterm_loop_1_temperature': ['22.4', '°C'], 'sensor.kronoterm_heat_pump_loop_1_thermostat_temperature': ['22.4', '°C'],
  'sensor.kronoterm_loop_1_inlet_temperature': [{ heat: '33.2', dhw: '28.7', defrost: '31.3', idle: '27.5' }[s], '°C'],
  'sensor.kronoterm_loop_2_temperature': [{ heat: '30.5', dhw: '24.9', defrost: '29.3', idle: '26.0' }[s], '°C'],
  'binary_sensor.kronoterm_heat_pump_circulation_loop_1': s === 'heat' || s === 'defrost' ? 'on' : 'off',
  'binary_sensor.kronoterm_heat_pump_circulation_loop_2': s === 'heat' || s === 'defrost' ? 'on' : 'off',
  'sensor.kronoterm_heat_pump_heating_system_pressure': ['1.3', 'bar'],
  'select.kronoterm_operational_mode': { state: s === 'idle' ? 'eco' : 'auto', attributes: { friendly_name: 'Operational Mode', options: ['auto', 'eco', 'comfort'] } },
  'sensor.kronoterm_energy_combined': { state: '27.42', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.kronoterm_energy_heating': { state: '21.62', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.kronoterm_energy_dhw': { state: '4.94', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.kronoterm_energy_heater': { state: '0', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.kronoterm_heat_pump_electrical_energy_heating_dhw': { state: '13762', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  // Not mapped by the preset: on the reference installation it reads a tenth of the heat that the SCOP implies.
  'sensor.kronoterm_heat_pump_heating_energy_heating_dhw': { state: '4728', attributes: { unit_of_measurement: 'kWh', state_class: 'total_increasing' } },
  'sensor.kronoterm_heat_pump_scop_value': '3.43',
  'sensor.kronoterm_heat_pump_compressor_activations_heating_24_h': '12245', 'sensor.kronoterm_heat_pump_activations_boiler_24_h': '641',
  'sensor.kronoterm_heat_pump_compressor_activations_cooling': '0',
  'sensor.kronoterm_heat_pump_operating_hours_compressor_heating': ['9692', 'h'], 'sensor.kronoterm_heat_pump_operating_hours_compressor_dhw': ['652', 'h'],
  'sensor.kronoterm_heat_pump_operating_hours_additional_source_1': ['0', 'h'],
  'sensor.kronoterm_heat_pump_temperature_compressor_inlet': [{ heat: '1.5', dhw: '-0.8', defrost: '-4.2', idle: '7.9' }[s], '°C'],
  'sensor.kronoterm_heat_pump_temperature_compressor_outlet': [{ heat: '71.4', dhw: '91.6', defrost: '58.0', idle: '35.2' }[s], '°C'],
});

// Energy dashboard of the simulated house: power sensors (stat_rate) for PV, battery (+ = discharging) and grid (+ = import).
const energyPrefs = { energy_sources: [
  { type: 'solar', stat_energy_from: 'sensor.pv_energy_today', stat_rate: 'sensor.pv_power' },
  { type: 'battery', stat_energy_from: 'sensor.battery_out_today', stat_energy_to: 'sensor.battery_in_today', stat_rate: 'sensor.battery_power' },
  { type: 'grid', stat_energy_from: 'sensor.grid_import_today', stat_energy_to: 'sensor.grid_export_today', stat_rate: 'sensor.grid_power' },
] };
const houseStates = (s) => ({
  'sensor.pv_power': [{ heat: '1800', dhw: '300', defrost: '0', idle: '900' }[s], 'W'],
  'sensor.battery_power': [{ heat: '-300', dhw: '1400', defrost: '0', idle: '-480' }[s], 'W'],
  'sensor.grid_power': [{ heat: '200', dhw: '100', defrost: '1500', idle: '-150' }[s], 'W'],
});

const setups = [
  {
    name: 'Lambda', sub: 'legacy naming, PV/battery split, quick controls, own tile selection, details with refrigerant circuit',
    states: (s) => ({ ...lambdaStates('eu08l_', s), ...extras(s) }),
    statistics: { 'sensor.eu08l_hp1_heating_energy_total': { yesterday: 12.9, week: 61.3 } },
    // The E-Manager asks for PV surplus during part of the heating periods: they show as PV surplus in the timeline.
    history: { 'input_boolean.heatpump_boost': [[24, 'off'], [14, 'on'], [10, 'off'], [5.5, 'on'], [3.2, 'off']],
      'sensor.eu08l_emgr_power_consumption_setpoint': [[24, '0'], [19.6, '1800'], [17, '0'], [12, '1500'], [10.5, '0'], [2.9, '1900']] },
    config: {
      preset: 'lambda', title: 'Lambda', hc_type: 'radiator', timeline: true, timeline_marks: true,
      entities: {
        room: 'sensor.living_room_temperature', pv: 'sensor.heatpump_power_from_pv', battery: 'sensor.heatpump_power_from_battery',
        grid: 'sensor.heatpump_power_from_grid', energy_today: 'sensor.heatpump_energy_today', pv_share_today: 'sensor.heatpump_pv_share_today',
        program: 'select.heatpump_heating_program', solar_collector: 'sensor.heatpump_solar_collector', solar_pump: 'binary_sensor.heatpump_solar_pump',
        dhw_middle: 'sensor.heatpump_dhw_middle', buffer_middle: 'sensor.heatpump_buffer_middle',
        cutout_high_pressure: 'sensor.heatpump_cutouts_high_pressure', cutout_low_pressure: 'sensor.heatpump_cutouts_low_pressure', cutout_temperature: 'sensor.heatpump_cutouts_temperature',
      },
      badges: [{ entity: 'input_boolean.heatpump_boost', label: 'Boost' }],
      controls: ['input_boolean.heatpump_boost', 'button.heatpump_dhw_boost', 'select.heatpump_operating_mode', 'number.heatpump_dhw_target'],
      details: [{ entity: 'sensor.heating_curve_flow', name: 'Heating curve flow' }],
      details_open: true,
      tiles: ['cop_heating', 'cop_heating:month', 'cop_dhw', 'energy', 'starts', 'defrosts:yesterday', 'energy_heating:week', 'pv_boost_share:today'],
    },
  },
  {
    name: 'Lambda', sub: 'new naming, zero-config, PV/battery/grid from the Energy dashboard',
    states: (s) => ({ ...lambdaStates('', s), ...houseStates(s) }),
    energy: energyPrefs,
    config: { preset: 'lambda' },
  },
  {
    name: 'Viessmann Vitocal', sub: 'ViCare, German entity ids, radiators',
    states: vicareStates,
    registry: Object.fromEntries(Object.entries(vicareReg).map(([id, tk]) => [id, { platform: 'vicare', translation_key: tk }])),
    config: { preset: 'vicare', title: 'Vitocal', hc_type: 'radiator' },
  },
  {
    name: 'Vaillant aroTHERM plus', sub: 'myPyllant',
    states: vaillantStates,
    registry: { 'sensor.zuhause_energy_manager_state': { platform: 'mypyllant' } },
    config: { preset: 'vaillant', title: 'aroTHERM plus' },
  },
  {
    name: 'Buderus / Bosch', sub: 'EMS-ESP, German enum texts, tiles for today and month from long-term statistics',
    states: emsStates, registry: regOf(emsStates, 'mqtt'), statistics: emsStatistics,
    config: {
      preset: 'emsesp', title: 'Buderus WLW',
      tiles: ['cop_heating', 'energy_heating', 'cop_heating:month', 'starts', 'hours_per_start', 'spread', 'heat_estimated'],
    },
  },
  {
    name: 'Panasonic Aquarea', sub: 'HeishaMon, radiators',
    states: hmStates, registry: regOf(hmStates, 'aquarea'),
    config: { preset: 'heishamon', title: 'Aquarea', hc_type: 'radiator' },
  },
  {
    name: 'Ground source heat pump', sub: 'EMS-ESP, brine loop, environmental energy, two heating circuits with a room temperature each, heaters',
    states: brineStates, registry: regOf(brineStates, 'mqtt'),
    statistics: {
      'sensor.boiler_nrgconstotal': { today: 6.1, month: 180, year: 1720 },
      'sensor.boiler_environmental_energy_total': { today: 24.3, month: 690, year: 6520 },
    },
    scenarioLabels: { defrost: 'Backup heater' },
    config: {
      preset: 'emsesp', title: 'Logatherm WLW', source_type: 'brine',
      hc_count: 2, hc_name: 'Ground floor', hc2_type: 'column', hc2_name: 'Upstairs',
      brine_pressure_min: 0.9, brine_pressure_crit: 0.6, brine_pressure_max: 2.5,
      hc_pressure_min: 1.0, hc_pressure_crit: 0.7, hc_pressure_max: 2.8,
      entities: { dhw_heater: 'binary_sensor.dhw_heater_rod', brine_pressure: 'sensor.boiler_brine_pressure', hc_pressure: 'sensor.boiler_heating_pressure',
        env_energy: 'sensor.boiler_environmental_energy_total', hc2_room: 'sensor.upstairs_temperature', hc2_room_target: 'sensor.thermostat_hc2_seltemp' },
      tiles: ['energy', 'env_energy', 'cop_total', 'env_energy:month', 'spread', 'brine_pressure', 'hc_pressure'],
    },
  },
  {
    name: 'Any other heat pump', sub: 'no preset: manual mapping, no buffer, no power sources',
    states: otherStates,
    config: {
      title: 'Heat pump',
      entities: { mode: 'sensor.wp_betriebsart', flow: 'sensor.wp_vorlauf', return: 'sensor.wp_ruecklauf', power: 'sensor.wp_leistung',
        dhw_top: 'sensor.ww_temperatur', outdoor: 'sensor.aussen' },
      mode_map: { Heating: 'heating', 'Hot water': 'dhw', Defrost: 'defrost', Standby: 'idle' },
    },
  },
  {
    name: 'Wolf CHA', sub: 'wolflink, buffer from the header sensor, mixer circuit, heat counters',
    states: wolfStates, registry: regOf(wolfStates, 'wolflink'),
    statistics: { 'sensor.zuhause_energy_amount_htg': { today: 38.6, month: 612 }, 'sensor.zuhause_energy_amount_dhw': { today: 7.9, month: 120 } },
    config: {
      preset: 'wolf', title: 'Wolf CHA',
      entities: { buffer_top: 'sensor.zuhause_header_temperature' },
      tiles: ['heat_heating', 'heat_dhw', 'heat:yesterday', 'heat:month', 'hours:total', 'spread', 'hc_pressure'],
    },
  },
  {
    name: 'Kronoterm ADAPT', sub: 'Kronoterm integration (Cloud API), hot water tank from the DHW thermostat, two circuits',
    states: kronotermStates,
    registry: Object.fromEntries(Object.entries(kronotermReg).map(([id, tk]) => [id, { platform: 'kronoterm', translation_key: tk }])),
    statistics: { 'sensor.kronoterm_heat_pump_electrical_energy_heating_dhw': { yesterday: 24.9, week: 160.2, month: 512.6, year: 3871 } },
    config: {
      preset: 'kronoterm', title: 'Kronoterm ADAPT', hc_count: 2, hc2_type: 'radiator',
      tiles: ['energy', 'energy_heating', 'energy_dhw', 'energy:month', 'cop_live', 'cop_total', 'cycles_heating', 'spread'],
    },
  },
  {
    name: 'Vaillant aroTHERM plus', sub: 'ebusd, underfloor and radiator circuit, environmental energy',
    states: ebusdStates, registry: regOf(ebusdStates, 'mqtt'),
    statistics: {
      'sensor.ebusd_hmu_statelectricenergysum': { today: 21.8, month: 412, year: 4210 },
      'sensor.ebusd_hmu_statenvironmentenergysum': { today: 32.6, month: 690, year: 6830 },
      'sensor.ebusd_hmu_runstatscompressorstarts': { today: 6 }, 'sensor.ebusd_hmu_runstatscompressorhours': { today: 9 },
    },
    config: {
      preset: 'ebusd', title: 'aroTHERM plus', hc_count: 2, hc_name: 'Underfloor', hc2_type: 'radiator', hc2_name: 'Radiators',
      tiles: ['cop_live', 'cop_total', 'energy', 'env_energy', 'starts', 'hours_per_start', 'hc_pressure'],
    },
  },
  {
    name: 'Samsung EHS', sub: 'esphome-samsung-nasa, underfloor heating',
    states: samsungStates, registry: regOf(samsungStates, 'esphome'),
    config: { preset: 'samsung', title: 'Samsung EHS' },
  },
  {
    name: 'Alpha Innotec (Luxtronik)', sub: 'Luxtronik integration, water source, one mixing circuit, energy counters per use',
    states: luxtronikStates,
    registry: Object.fromEntries(Object.entries(luxtronikReg).map(([id, tk]) => [id, { platform: 'luxtronik2', translation_key: tk }])),
    config: {
      preset: 'luxtronik', title: 'Alpha Innotec WWC', source_type: 'water',
      tiles: ['cop_heating:total', 'cop_dhw:total', 'energy_heating:total', 'heat:total', 'hours:total', 'spread'],
    },
  },
  {
    name: 'Wolf CHA (wolf_smartset)', sub: 'wolf_smartset integration, German entity ids found by translation key, buffer from the header sensor',
    states: wolfSmartsetStates,
    registry: Object.fromEntries(Object.entries(wolfSmartsetReg).map(([id, tk]) => [id, { platform: 'wolf_smartset', translation_key: tk }])),
    statistics: { 'sensor.heizgerat_energiemenge_hz': { today: 38.6, month: 612 }, 'sensor.heizgerat_energiemenge_ww': { today: 7.9, month: 120 } },
    config: {
      preset: 'wolf', title: 'Wolf CHA (SmartSet)',
      entities: { buffer_top: 'sensor.heizgerat_sammlertemperatur' },
      tiles: ['heat_heating', 'heat_dhw', 'heat:yesterday', 'heat:month', 'hours:total', 'spread', 'hc_pressure'],
    },
  },
];
// Synthetic PointT installation. Resource keys follow Home Comfort 0.8.2-beta.7;
// gateway identifiers, entity ids and values are invented, not a registry export.
function pointtSetup(scenario = 'heat', gateway = 'demo-pointt', suffix = '') {
  const rows = [
    ['sensor', 'heatSources:compressor:status', { heat: 'heating', dhw: 'dhw', defrost: 'defrost', idle: 'off', cool: 'cooling' }[scenario], '', { translation_key: 'compressor_status' }],
    ['sensor', 'gateway:supply_temperature', scenario === 'dhw' ? 49 : 33, '°C'],
    ['sensor', 'gateway:return_temperature', 28, '°C'],
    ['sensor', 'gateway:outdoor_temperature', 6, '°C'],
    ['sensor', 'gateway:modulation', scenario === 'idle' ? 0 : 42, '%'],
    ['sensor', 'gateway:system_pressure', 1.7, 'bar'],
    ['sensor', 'gateway:hot_water_temperature', 48, '°C'],
    ['sensor', 'dhwCircuits:dhw1:currentSetpoint', 50, '°C'],
    ['sensor', 'heatSources:hs1:heatPumpType', 'air_water'],
    ['sensor', 'heatSources:hs1:numberOfStarts:total', 120],
    ['sensor', 'heatSources:hs1:numberOfStarts:ch', 90],
    ['sensor', 'heatSources:hs1:numberOfStarts:dhw', 30],
    ['sensor', 'heatSources:hs1:numberOfStarts:cooling', 0],
    ['sensor', 'heatSources:hs1:workingTime:total', 240, 'h'],
    ['sensor', 'heatSources:hs1:workingTime:ch', 180, 'h'],
    ['sensor', 'heatSources:hs1:workingTime:dhw', 60, 'h'],
    ['sensor', 'heatSources:hs1:supplyFlowCondenserTemp', 32.5, '°C'],
    ['sensor', 'heatSources:numberOfStarts', 135],
    ['sensor', 'heatSources:workingTime:totalSystem', 500, 'h'],
    ['sensor', 'heatSources:Source:eHeater:status', 'off'],
    ['sensor', 'gateway:total_electricity', 400, 'kWh'],
    ['sensor', 'gateway:total_heat_produced', 1600, 'kWh'],
    ['sensor', 'gateway:environmental_energy', 1200, 'kWh'],
    ['sensor', 'gateway:heating_electricity', 300, 'kWh'],
    ['sensor', 'gateway:heating_heat_produced', 1200, 'kWh'],
    ['sensor', 'gateway:hot_water_electricity', 100, 'kWh'],
    ['sensor', 'gateway:hot_water_heat_produced', 400, 'kWh'],
    ['sensor', 'heatSources:emon:totalConsumption:eheater', 0, 'kWh'],
    ['sensor', 'heatSources:emon:coolingConsumption:compressor', 20, 'kWh'],
    ['sensor', 'heatSources:emon:coolingConsumption:outputProduced', 80, 'kWh'],
    ['binary_sensor', 'system_fault', scenario === 'idle' ? 'on' : 'off'],
    ['binary_sensor', 'holiday_active', scenario === 'idle' ? 'on' : 'off'],
    ...[1, 2].flatMap((n) => [
      ['sensor', `heatingCircuits:hc${n}:currentRoomSetpoint`, 20 + n, '°C'],
      ['sensor', `heatingCircuits:hc${n}:roomtemperature`, 19 + n, '°C'],
      ['sensor', `heatingCircuits:hc${n}:actualSupplyTemperature`, 31 + n, '°C'],
      ['select', `heatingCircuits:hc${n}:operationMode:control`, 'auto'],
      ...['manualRoomSetpoint', 'temperatureLevels:comfort2', 'temperatureLevels:eco', 'maxFlowTemp']
        .map((key) => ['number', `heatingCircuits:hc${n}:${key}:control`, 21, '°C']),
    ]),
    ['sensor', 'dhwCircuits:dhw2:actualTemp', 42, '°C'],
    ['sensor', 'dhwCircuits:dhw2:currentSetpoint', 45, '°C'],
    ['select', 'dhwCircuits:dhw1:operationMode:control', 'auto'],
    ...['temperatureLevels:high', 'temperatureLevels:low', 'temperatureLevels:eco', 'singleChargeSetpoint']
      .map((key) => ['number', `dhwCircuits:dhw1:${key}:control`, 50, '°C']),
    ['number', 'dhwCircuits:dhw1:chargeDuration:control', 60, 'min'],
    ['switch', 'dhwCircuits:dhw1:charge:control', 'off'],
    ['switch', 'dhwCircuits:dhw1:reduceTempOnAlarm:control', 'on'],
    ['select', 'system:silentMode:enabled:control', 'off'],
    ['select', 'heatSources:additionalHeater:operationMode:control', 'off'],
    ['select', 'system:seasonOptimizer:mode:control', 'auto'],
    ['switch', 'system:awayMode:enabled:control', 'off'],
  ];
  const states = {}; const registry = {};
  rows.forEach(([domain, key, value, unit, extra], n) => {
    // Deliberately unrelated to the resource names: test renamed entities and mixed languages.
    const id = `${domain}.pointt_${suffix}value_${n}`;
    const attributes = { friendly_name: key.replace(/:/g, ' / '), ...(unit ? { unit_of_measurement: unit } : {}) };
    if (domain === 'select') attributes.options = ['off', 'manual', 'auto'];
    if (domain === 'number') Object.assign(attributes, { min: 5, max: 80, step: 0.5 });
    if (unit === 'kWh' || unit === 'h' || key.includes(':numberOfStarts:')) attributes.state_class = 'total_increasing';
    if (key === 'gateway:environmental_energy') attributes.state_class = 'total';
    states[id] = { state: String(value), attributes };
    registry[id] = { platform: 'bosch_buderus_heating', unique_id: `${gateway}:${key}`, device_id: `device-${gateway}`, ...extra };
  });
  return { states, registry };
}
setups.push({
  name: 'Bosch/Buderus Home Comfort', sub: 'PointT cloud, synthetic data; preset awaiting installation testing',
  states: (s) => pointtSetup(s).states, registry: pointtSetup().registry,
  config: { preset: 'bosch_buderus_heating', title: 'Home Comfort', power_sources: 'manual',
    tiles: ['energy:total', 'heat:total', 'env_energy:total', 'cop_total:total', 'starts:total', 'hours:total'] },
});
setups.push({
  name: 'Stiebel Eltron WPMsystem', sub: 'Stiebel Eltron ISG integration, French entity ids found by translation key, buffer, one circuit, optional hardware unavailable',
  states: isgStates,
  registry: Object.fromEntries(Object.entries(isgReg).map(([id, tk]) => [id, { platform: 'stiebel_eltron_isg', translation_key: tk }])),
  config: {
    preset: 'stiebel_isg', title: 'Stiebel Eltron',
    tiles: ['cop_heating:total', 'cop_dhw:total', 'energy_heating:total', 'heat_heating:total', 'spread', 'hc_pressure'],
  },
});
// Combined (layered) storage (#50): one tank, hot-water zone on top with three sensors, heating zone below with two, solar thermal.
const combinedStates = (s) => ({
  'sensor.cs_mode': { heat: 'Heating', dhw: 'Hot water', defrost: 'Defrost', idle: 'Standby' }[s],
  'sensor.cs_flow': [{ heat: '36.4', dhw: '53.0', defrost: '21.5', idle: '31' }[s], '°C'],
  'sensor.cs_return': [{ heat: '31.2', dhw: '47.1', defrost: '25.0', idle: '30.5' }[s], '°C'],
  'sensor.cs_power': [{ heat: '1350', dhw: '1900', defrost: '850', idle: '4' }[s], 'W'],
  'sensor.cs_volume': [{ heat: '1100', dhw: '1150', defrost: '1000', idle: '0' }[s], 'L/h'],
  'binary_sensor.cs_valve': s === 'dhw' ? 'on' : 'off',
  'sensor.cs_top': [{ heat: '50.2', dhw: '48.5', defrost: '49.8', idle: '51.0' }[s], '°C'],
  'sensor.cs_upper': [{ heat: '47.0', dhw: '44.0', defrost: '46.5', idle: '47.5' }[s], '°C'],
  'sensor.cs_middle': [{ heat: '41.5', dhw: '38.0', defrost: '40.8', idle: '42.0' }[s], '°C'],
  'sensor.cs_lower': [{ heat: '34.8', dhw: '33.5', defrost: '30.2', idle: '33.0' }[s], '°C'],
  'sensor.cs_bottom': [{ heat: '30.1', dhw: '29.8', defrost: '26.0', idle: '29.5' }[s], '°C'],
  'binary_sensor.cs_hc_pump': s === 'idle' ? 'off' : 'on',
  'sensor.cs_collector': [{ heat: '55.0', dhw: '68.5', defrost: '9.0', idle: '41.0' }[s], '°C'],
  'binary_sensor.cs_solar_pump': s === 'heat' || s === 'dhw' ? 'on' : 'off',
  'sensor.cs_outdoor': ['1.5', '°C'], 'sensor.cs_room': ['21.3', '°C'], 'sensor.cs_room_target': ['21', '°C'],
});
setups.push({
  name: 'Combined storage', sub: 'no preset: one layered tank with hot-water and heating zone, five sensors, solar thermal',
  states: combinedStates,
  config: {
    title: 'Heat pump', storage: 'combined', hc_type: 'radiator',
    entities: {
      mode: 'sensor.cs_mode', flow: 'sensor.cs_flow', return: 'sensor.cs_return', power: 'sensor.cs_power', volume: 'sensor.cs_volume',
      valve: 'binary_sensor.cs_valve', dhw_top: 'sensor.cs_top', dhw_middle: 'sensor.cs_upper', dhw_bottom: 'sensor.cs_middle',
      buffer_top: 'sensor.cs_lower', buffer_bottom: 'sensor.cs_bottom', hc_pump: 'binary_sensor.cs_hc_pump',
      solar_collector: 'sensor.cs_collector', solar_pump: 'binary_sensor.cs_solar_pump',
      outdoor: 'sensor.cs_outdoor', room: 'sensor.cs_room', room_target: 'sensor.cs_room_target',
    },
    mode_map: { Heating: 'heating', 'Hot water': 'dhw', Defrost: 'defrost', Standby: 'idle' },
  },
});
// Parallel buffer with a fresh-water station (dhw_type: fresh_water): no hot-water tank and no diverter valve.
setups.push({
  name: 'Fresh-water station', sub: 'no preset: parallel buffer with three sensors, fresh-water station for the tap water, no diverter valve',
  states: combinedStates,
  config: {
    title: 'Heat pump', dhw_type: 'fresh_water', hc_type: 'underfloor',
    entities: {
      mode: 'sensor.cs_mode', flow: 'sensor.cs_flow', return: 'sensor.cs_return', power: 'sensor.cs_power', volume: 'sensor.cs_volume',
      dhw_top: 'sensor.cs_upper', buffer_top: 'sensor.cs_top', buffer_middle: 'sensor.cs_middle', buffer_bottom: 'sensor.cs_bottom',
      hc_pump: 'binary_sensor.cs_hc_pump', outdoor: 'sensor.cs_outdoor', room: 'sensor.cs_room', room_target: 'sensor.cs_room_target',
    },
    mode_map: { Heating: 'heating', 'Hot water': 'dhw', Defrost: 'defrost', Standby: 'idle' },
  },
});
// The two other hot-water preparations of a combined storage, on the same data (appended, so earlier demos keep their index).
const combinedSetup = setups.find((s) => s.name === 'Combined storage');
setups.push({
  name: 'Combined storage, tank in tank', sub: 'no preset: layered tank with an inner hot-water tank (dhw_type: tank_in_tank)',
  states: combinedStates, config: { ...combinedSetup.config, dhw_type: 'tank_in_tank' },
});
setups.push({
  name: 'Combined storage, fresh-water station', sub: 'no preset: layered tank, the tap water heated by a fresh-water station (dhw_type: fresh_water)',
  states: combinedStates, config: { ...combinedSetup.config, dhw_type: 'fresh_water', hc_type: 'underfloor' },
});

// Hybrid installation (#51): the generic scenarios deliberately cover HP-only, simultaneous, boiler-only and idle operation.
const hybridStates = (s) => ({
  'sensor.hybrid_mode': { heat: 'Heating', dhw: 'DHW', defrost: 'Standby', idle: 'Standby' }[s],
  'binary_sensor.hybrid_compressor': ['heat', 'dhw'].includes(s) ? 'on' : 'off',
  'sensor.hybrid_power': [['heat', 'dhw'].includes(s) ? '1300' : '0', 'W'],
  'sensor.hybrid_flow': [{ heat: '36', dhw: '50', defrost: '29', idle: '28' }[s], '°C'],
  'sensor.hybrid_return': [{ heat: '30', dhw: '44', defrost: '28', idle: '28' }[s], '°C'],
  'sensor.hybrid_volume': [s === 'idle' ? '0' : '850', 'L/h'],
  'sensor.hybrid_valve': s === 'dhw' ? 'Tank' : 'Room',
  'binary_sensor.hybrid_boiler': ['dhw', 'defrost'].includes(s) ? 'on' : 'off',
  'sensor.hybrid_boiler_power': [['dhw', 'defrost'].includes(s) ? '8000' : '0', 'W'],
  'sensor.hybrid_boiler_flow': [{ heat: '35', dhw: '58', defrost: '52', idle: '28' }[s], '°C'],
  'sensor.hybrid_dhw': ['48', '°C'], 'sensor.hybrid_hc_flow': ['35', '°C'], 'binary_sensor.hybrid_hc_pump': s === 'idle' ? 'off' : 'on',
});
setups.push({
  name: 'Hybrid heat pump and boiler', sub: 'manual mapping: HP-only, both generators, boiler-only and idle; boiler in the common flow',
  states: hybridStates,
  config: {
    title: 'Hybrid heating', hc_type: 'radiator',
    entities: {
      mode: 'sensor.hybrid_mode', compressor: 'binary_sensor.hybrid_compressor', power: 'sensor.hybrid_power', flow: 'sensor.hybrid_flow', return: 'sensor.hybrid_return', volume: 'sensor.hybrid_volume',
      valve: 'sensor.hybrid_valve', boiler_state: 'binary_sensor.hybrid_boiler', boiler_power: 'sensor.hybrid_boiler_power', boiler_flow: 'sensor.hybrid_boiler_flow',
      dhw_top: 'sensor.hybrid_dhw', hc_flow: 'sensor.hybrid_hc_flow', hc_pump: 'binary_sensor.hybrid_hc_pump',
    },
    mode_map: { Heating: 'heating', DHW: 'dhw', Standby: 'idle' },
  },
});

// A real parallel buffer without usable buffer sensors (#266): the heat-pump side stays measured, the tank and circuit side neutral.
setups.push({
  name: 'Parallel buffer without sensors', sub: 'manual topology: the real buffer is drawn neutrally without invented temperature entities',
  states: combinedStates,
  config: {
    title: 'Heat pump', buffer: true, hc_type: 'radiator',
    entities: {
      mode: 'sensor.cs_mode', flow: 'sensor.cs_flow', return: 'sensor.cs_return', power: 'sensor.cs_power', volume: 'sensor.cs_volume',
      valve: 'binary_sensor.cs_valve', dhw_top: 'sensor.cs_top', dhw_bottom: 'sensor.cs_middle', hc_pump: 'binary_sensor.cs_hc_pump',
      outdoor: 'sensor.cs_outdoor', room: 'sensor.cs_room', room_target: 'sensor.cs_room_target',
    },
    mode_map: { Heating: 'heating', 'Hot water': 'dhw', Defrost: 'defrost', Standby: 'idle' },
  },
});

// Vendor-neutral SG-Ready / utility-lock contract (#249), deliberately manual until a real preset mapping is verified.
const sgReadyStates = (s) => ({
  'sensor.sg_mode': { heat: 'heating', dhw: 'dhw', defrost: 'blocked', idle: 'idle' }[s],
  'binary_sensor.sg_compressor': ['heat', 'dhw'].includes(s) ? 'on' : 'off',
  'sensor.sg_flow': [{ heat: '36', dhw: '51', defrost: '28', idle: '29' }[s], '°C'],
  'sensor.sg_return': [{ heat: '30', dhw: '44', defrost: '28', idle: '28' }[s], '°C'],
  'sensor.sg_state': { heat: '3', dhw: '4', defrost: '1', idle: '2' }[s],
  'sensor.sg_dhw': ['48', '°C'], 'binary_sensor.sg_hc_pump': s === 'heat' ? 'on' : 'off',
});
setups.push({
  name: 'SG-Ready and utility lock', sub: 'manual mapping: raised targets, forced operation, utility lock and normal operation',
  states: sgReadyStates,
  config: {
    title: 'SG-Ready heat pump', timeline: true,
    entities: {
      mode: 'sensor.sg_mode', compressor: 'binary_sensor.sg_compressor', flow: 'sensor.sg_flow', return: 'sensor.sg_return',
      sg_ready: 'sensor.sg_state', dhw_top: 'sensor.sg_dhw', hc_pump: 'binary_sensor.sg_hc_pump',
    },
  },
});

// Vendor-neutral cooling safety (#251): measured dew point wins; otherwise the card calculates it from room temperature and RH.
const coolingDewStates = (s) => ({
  'sensor.cool_mode': 'cooling', 'binary_sensor.cool_compressor': 'on',
  'sensor.cool_flow': [{ heat: '18', dhw: '18', defrost: '17', idle: '18' }[s], '°C'],
  'sensor.cool_return': ['20', '°C'], 'sensor.cool_room': ['22', '°C'],
  'sensor.cool_humidity': [{ heat: '50', dhw: '50', defrost: '75', idle: 'unavailable' }[s], '%'],
  'sensor.cool_dew_point': [{ heat: 'unknown', dhw: '17', defrost: 'unknown', idle: 'unknown' }[s], '°C'],
});
setups.push({
  name: 'Cooling dew-point safety', sub: 'manual entities: room humidity, calculated or measured dew point and condensation warning',
  scenarioLabels: { heat: 'Safe · calculated', dhw: 'Warning · measured', defrost: 'High humidity', idle: 'Missing humidity' },
  states: coolingDewStates,
  config: {
    title: 'Cooling and dew point',
    entities: {
      mode: 'sensor.cool_mode', compressor: 'binary_sensor.cool_compressor', flow: 'sensor.cool_flow', return: 'sensor.cool_return',
      room: 'sensor.cool_room', room_humidity: 'sensor.cool_humidity', dew_point: 'sensor.cool_dew_point',
    },
  },
});

// Generic circulation program (#34): explicit start/end entities win; a schedule helper supplies the next change otherwise.
const circulationWindowStates = (s) => ({
  'sensor.cw_mode': 'Standby', 'sensor.cw_dhw': ['49', '°C'],
  'binary_sensor.cw_pump': ['heat', 'defrost'].includes(s) ? 'on' : 'off',
  'time.cw_start': { heat: '06:00:00', dhw: 'unavailable', defrost: 'unavailable', idle: 'unknown' }[s],
  'time.cw_end': { heat: '22:00:00', dhw: 'unavailable', defrost: 'unavailable', idle: 'unknown' }[s],
  'schedule.cw': {
    state: s === 'defrost' ? 'on' : s === 'dhw' ? 'off' : 'unavailable',
    attributes: { next_event: s === 'dhw' ? '2030-01-01T06:00:00+01:00' : s === 'defrost' ? '2030-01-01T22:00:00+01:00' : null },
  },
});
setups.push({
  name: 'Circulation program window', sub: 'manual entities: one explicit window or the next change of a schedule helper',
  scenarioLabels: { heat: '06:00–22:00', dhw: 'Schedule · from', defrost: 'Schedule · until', idle: 'Missing times' },
  states: circulationWindowStates,
  config: {
    title: 'Circulation program',
    entities: {
      mode: 'sensor.cw_mode', dhw_top: 'sensor.cw_dhw', circulation: 'binary_sensor.cw_pump',
      circulation_start: 'time.cw_start', circulation_end: 'time.cw_end', circulation_schedule: 'schedule.cw',
    },
  },
});

const scenarios = [['heat', 'Heating'], ['dhw', 'Hot water'], ['defrost', 'Defrost'], ['idle', 'Standby + error']];
