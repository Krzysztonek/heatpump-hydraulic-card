/*
 * Heatpump Flow Card
 * Animated hydraulic schematic for heat pumps (air, ground or groundwater source) in Home Assistant:
 * power sources (PV / battery / grid) → heat pump → diverter valve → DHW tank / buffer → heating circuit.
 * Vendor-neutral core with built-in presets for several brands (list: README preset table).
 *
 * https://github.com/Sturmi77/heatpump-hydraulic-card · MIT License
 */
const HFC_VERSION = '0.18.0';
// Address this file was loaded from: shows at once when a dashboard resource still points to an old file.
const HFC_SCRIPT_URL = (() => {
  try {
    if (document.currentScript?.src) return document.currentScript.src
    return performance.getEntriesByType('resource').map((r) => r.name).find((n) => /heatpump-(flow|hydraulic)-card[^/?]*\.js/.test(n)) || '';
  } catch (e) { return ''; }
})();

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */
// A preset maps a heat pump integration onto the card:
//   detect(ctx)                → prefix (string, may be '') or undefined when the integration is not present
//   entities(prefix, idx, ctx) → { key: entity_id | [candidates…] }  (first existing candidate wins)
//   errors(prefix, idx, ctx)   → error sensors (numeric ≠ 0 or binary "on" shows the error chip)
//   error_ok                   → text states that mean "no error"; any other known text shows the chip
//   tiles(prefix, idx, ctx)    → { tile: { period: entity_id | [candidates…] } } for the stat tile catalog (HFC_TILES);
//                                a "total" counter with long-term statistics also gives today, yesterday, week, month and year
//   dynamic                    → true when entities() maps parts by their readings (ctx.state): the card resolves again every
//                                minute and rebuilds when a mapping appears, so parts that report late are not lost
//   *_mode_map                 → raw state → normalized mode
//   sg_ready_map               → raw state → normal | blocked | boost | forced
//   valve_map                  → raw state of the `valve` entity → dhw | heating (default: on, Tank, DHW … mean hot water)
// ctx.key(platform, domain, translation_key) finds entities via the entity registry (language-independent),
// ctx.match(regex, platform) finds the first entity id matching a pattern, ctx.state(entity_id) reads a current state.
// PointT uses stable resource keys in unique_id; entity ids can be translated or renamed.
// Keep gateway identifiers inside the resolver, never in the saved preset prefix or diagnostic report.
function hfcPointT(ctx) {
  if ('_pointt' in ctx) return ctx._pointt;
  ctx._pointt = null;
  const ids = new Set(ctx.ids);
  const rows = Object.entries(ctx.registry).filter(([id, e]) => e?.platform === 'bosch_buderus_heating'
    && ids.has(id) && !e.disabled_by && typeof e.unique_id === 'string' && e.unique_id.indexOf(':') > 0)
    .map(([id, e]) => {
      const colon = e.unique_id.indexOf(':');
      return { id, device: e.device_id, gateway: e.unique_id.slice(0, colon), key: e.unique_id.slice(colon + 1) };
    }).filter((e) => e.gateway && e.key);
  const selected = new Set(rows.filter((e) => !ctx.device || e.device === ctx.device).map((e) => e.gateway));
  const gateways = [...new Set(rows.filter((e) => selected.has(e.gateway)
    && e.key === 'heatSources:compressor:status' && e.id.startsWith('sensor.')).map((e) => e.gateway))];
  // An explicit device is required when several gateways report a compressor.
  if (gateways.length !== 1 || ctx.idx.hp !== 1) return null;
  const own = rows.filter((e) => e.gateway === gateways[0]);
  // The compressor mode and energy resources are gateway totals. Do not assign those totals
  // to a particular heat pump in a cascade; that topology needs an explicit manual mapping.
  const sources = new Set(own.filter((e) => /^heatSources:hs[^:]+:heatPumpType$/.test(e.key)).map((e) => e.key));
  if (sources.size > 1) return null;
  const find = (domain, ...keys) => {
    for (const key of keys) {
      const hits = own.filter((e) => e.id.startsWith(`${domain}.`) && e.key === key);
      if (hits.length > 1) return undefined;
      if (hits.length === 1) return hits[0].id;
    }
    return undefined;
  };
  return (ctx._pointt = { find });
}

// Wolf: the prefix '' marks the wolf_smartset branch (sensors by translation key), a device slug the wolflink branch (entity ids).
const hfcWolfSensor = (p, ctx) => (p === '' ? (tk) => ctx.key('wolf_smartset', 'sensor', tk) : (name) => `sensor.${p}_${name}`);

// ebusd can publish several legitimate copies of the same messages. Keep one complete MQTT entity stem together instead of
// resolving every field independently across daemons (#197). `prefix` may be the short topic prefix (`arotherm`) or the full
// entity stem (`ebus_arotherm`); the latter selects one instance explicitly.
function hfcEbusdInstances(ctx, requested) {
  // Besides finding candidates below, record the platform/pattern for the editor and diagnostic detection explanation.
  ctx.match(/^sensor\..+_hmu_rundatastatuscode$/, 'mqtt');
  const mqtt = (id) => !ctx.registry[id] || ctx.registry[id].platform === 'mqtt';
  const own = (id) => !ctx.device || ctx.registry[id]?.device_id === ctx.device;
  const ids = ctx.ids.filter(own);
  const want = String(requested || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const statusStems = [...new Set(ids.filter((id) => id.startsWith('sensor.') && id.endsWith('_hmu_rundatastatuscode') && mqtt(id))
    .map((id) => id.slice('sensor.'.length, -'_hmu_rundatastatuscode'.length)))];
  // A prefix set by hand still finds its group when the status-code entity is missing (not yet published or disabled): the
  // stems then come from any heat pump, hydraulic station or controller entity. Detection without a prefix keeps the status code.
  const stems = statusStems.length || !want ? statusStems : [...new Set(ids.filter(mqtt)
    .map((id) => id.match(/^(?:sensor|binary_sensor|number|select|switch)\.(.+?)_(?:hmu|vwzio|ctl[sv]\d)_/)?.[1]).filter(Boolean))];
  const exact = want && stems.includes(want);
  const eligible = want ? (exact ? [want] : stems.filter((stem) => stem.endsWith(`_${want}`))) : stems;
  const score = (stem) => ids.filter((id) => mqtt(id)
    && new RegExp(`^(?:sensor|binary_sensor|number|select|switch)\\.${stem}_(?:hmu|vwzio|broadcast|ctl[sv]\\d)_`).test(id)).length;
  return eligible.map((stem) => ({ stem, score: score(stem) }))
    .sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem));
}
// Entity-id stem for the ebusd regexes: always one concrete group, so the fields never mix daemons; the prefix itself only when
// no entity of any group exists.
const hfcEbusdStem = (ctx, p) => hfcEbusdInstances(ctx, p)[0]?.stem || String(p || '').replace(/[^a-z0-9_]/g, '');
const HFC_PRESETS = {
  bosch_buderus_heating: {
    name: 'Bosch/Buderus Home Comfort (PointT cloud)',
    unit_style: 'bosch',
    entity_registry: true,
    // The compact registry suffices to offer this preset in a new card. Resource mappings
    // wait for the full local registry, loaded only when this preset is selected.
    detect: (ctx) => hfcPointT(ctx) || ctx.key('bosch_buderus_heating', 'sensor', 'compressor_status') ? '' : undefined,
    ready: (ctx) => !!hfcPointT(ctx),
    auto_circuits: false,
    entities: (p, i, ctx) => {
      const pointt = hfcPointT(ctx); if (!pointt) return {};
      const s = (...keys) => pointt.find('sensor', ...keys);
      const hc = `heatingCircuits:hc${i.hc}`; const dhw = `dhwCircuits:dhw${i.dhw}`;
      return {
        mode: s('heatSources:compressor:status'),
        flow: s('gateway:supply_temperature', 'heatSources:actualSupplyTemperature'),
        return: s('gateway:return_temperature', 'heatSources:returnTemperature'),
        outdoor: s('gateway:outdoor_temperature', 'system:sensors:temperatures:outdoor_t1'),
        dhw_top: s(...(i.dhw === 1 ? ['gateway:hot_water_temperature'] : []), `${dhw}:actualTemp`),
        dhw_target: s(`${dhw}:currentSetpoint`),
        hc_flow: s(`${hc}:actualSupplyTemperature`),
        hc_pressure: s('gateway:system_pressure', 'heatSources:systemPressure'),
        room: s(`${hc}:roomtemperature`),
        room_target: s(`${hc}:currentRoomSetpoint`),
        compressor_speed: s('gateway:modulation', 'heatSources:actualModulation'),
        hours: s('heatSources:hs1:workingTime:total'),
        starts_total: s('heatSources:hs1:numberOfStarts:total'),
        energy_total: s('gateway:total_electricity', 'heatSources:emon:totalConsumption:total_electricity'),
        heat_total: s('gateway:total_heat_produced', 'heatSources:emon:totalConsumption:outputProduced'),
        env_energy: s('gateway:environmental_energy', 'heatSources:emon:totalConsumption:environmental_energy'),
        program: pointt.find('binary_sensor', 'holiday_active'),
      };
    },
    errors: (p, i, ctx) => [hfcPointT(ctx)?.find('binary_sensor', 'system_fault')].filter(Boolean),
    tiles: (p, i, ctx) => {
      const pointt = hfcPointT(ctx); if (!pointt) return {};
      const t = (...keys) => ({ total: pointt.find('sensor', ...keys) });
      return {
        energy: t('gateway:total_electricity', 'heatSources:emon:totalConsumption:total_electricity'),
        energy_heating: t('gateway:heating_electricity', 'heatSources:emon:chConsumption:total_electricity'),
        energy_dhw: t('gateway:hot_water_electricity', 'heatSources:emon:dhwConsumption:total_electricity'),
        energy_cooling: t('heatSources:emon:coolingConsumption:total_electricity'),
        energy_aux: t('heatSources:emon:totalConsumption:eheater'),
        env_energy: t('gateway:environmental_energy', 'heatSources:emon:totalConsumption:environmental_energy'),
        heat: t('gateway:total_heat_produced', 'heatSources:emon:totalConsumption:outputProduced'),
        heat_heating: t('gateway:heating_heat_produced', 'heatSources:emon:chConsumption:outputProduced'),
        heat_dhw: t('gateway:hot_water_heat_produced', 'heatSources:emon:dhwConsumption:outputProduced'),
        heat_cooling: t('heatSources:emon:coolingConsumption:outputProduced'),
        starts: t('heatSources:hs1:numberOfStarts:total'),
        cycles_heating: t('heatSources:hs1:numberOfStarts:ch'),
        cycles_dhw: t('heatSources:hs1:numberOfStarts:dhw'),
        cycles_cooling: t('heatSources:hs1:numberOfStarts:cooling'),
        hours: t('heatSources:hs1:workingTime:total'),
      };
    },
    controls: (p, i, ctx) => {
      const pointt = hfcPointT(ctx); if (!pointt) return [];
      const hc = `heatingCircuits:hc${i.hc}`; const dhw = `dhwCircuits:dhw${i.dhw}`;
      return [
        pointt.find('select', `${hc}:operationMode:control`),
        pointt.find('select', `${dhw}:operationMode:control`),
        pointt.find('switch', `${dhw}:charge:control`),
      ].filter(Boolean);
    },
    details: (p, i, ctx) => {
      const pointt = hfcPointT(ctx); if (!pointt) return [];
      const hc = `heatingCircuits:hc${i.hc}`; const dhw = `dhwCircuits:dhw${i.dhw}`;
      return [
        'heatSources:actualHeatDemand:values', 'heatSources:emStatus', 'heatSources:Source:eHeater:status',
        'heatSources:hs1:supplyFlowCondenserTemp', 'heatSources:numberOfStarts', 'heatSources:workingTime:totalSystem',
        ...['ch', 'dhw', 'cooling', 'pool'].map((mode) => `heatSources:hs1:numberOfStarts:${mode}`),
        ...['ch', 'dhw', 'cooling'].map((mode) => `heatSources:hs1:workingTime:${mode}`),
        ...['totalConsumption', 'chConsumption', 'dhwConsumption', 'coolingConsumption']
          .flatMap((mode) => ['compressor', 'eheater'].map((part) => `heatSources:emon:${mode}:${part}`)),
        `${hc}:operationMode`, ...(i.hc === 1 ? ['gateway:heating_status'] : []), `${hc}:overallStatus`,
        `${dhw}:operationMode`, ...(i.dhw === 1 ? ['gateway:hot_water_status'] : []), `${dhw}:overallStatus`,
        `${dhw}:chargeRemainingTime`, 'active_faults', 'active_notifications', 'system_pressure_status',
      ].map((key) => pointt.find('sensor', key)).filter(Boolean);
    },
    mode_map: { off: 'idle', heating: 'heating', cooling: 'cooling', dhw: 'dhw', defrost: 'defrost', alarm: 'off' },
    program_map: { on: 'holiday', off: 'none' },
  },
  lambda: {
    name: 'Lambda (lambda_heat_pumps)',
    tested: true,
    unit_style: 'lambda',
    // Legacy naming: sensor.<prefix>_hp1_…; new naming (no prefix): sensor.hp1_…
    // pv_boost: the E-Manager setpoint (W) is above 0 while the energy manager asks the heat pump to take up PV surplus.
    detect: (ctx) => {
      const re = new RegExp(`^sensor\\.(?:(.+)_)?hp${ctx.idx.hp}_operating_state$`);
      const id = ctx.match(re, 'lambda_heat_pumps');
      return id === undefined ? undefined : (id.match(re)[1] || '');
    },
    entities: (p, i) => {
      const x = p ? `${p}_` : '';
      const hp = `sensor.${x}hp${i.hp}`;
      const boil = `sensor.${x}boil${i.dhw}`;
      const buff = `sensor.${x}buff${i.buffer}`;
      const hc = `sensor.${x}hc${i.hc}`;
      return {
        mode: `${hp}_operating_state`,
        status: `${hp}_state`,
        power: `${hp}_inverter_power_consumption`,
        heat: `${hp}_actual_heating_capacity`,
        flow: `${hp}_flow_line_temperature`,
        return: `${hp}_return_line_temperature`,
        volume: `${hp}_volume_flow_heat_sink`,
        source_volume: `${hp}_volume_flow_energy_source`,
        source_in: `${hp}_energy_source_inlet_temperature`,
        source_out: `${hp}_energy_source_outlet_temperature`,
        heater: `${hp}_relais_state_2nd_heating_stage`,
        pv_boost: `sensor.${x}emgr_power_consumption_setpoint`,
        outdoor: `sensor.${x}ambient_temperature_calculated`,
        dhw_top: `${boil}_actual_high_temperature`,
        dhw_bottom: `${boil}_actual_low_temperature`,
        dhw_target: `${boil}_target_high_temperature`,
        dhw_mode: `${boil}_operating_state`,
        circulation: `${boil}_actual_circulation_pump_state`,
        buffer_top: `${buff}_actual_high_temperature`,
        buffer_bottom: `${buff}_actual_low_temperature`,
        buffer_mode: `${buff}_operating_state`,
        hc_flow: `${hc}_flow_line_temperature`,
        hc_return: `${hc}_return_line_temperature`,
        hc_setpoint: `${hc}_flow_line_temperature_setpoint`,
        hc_mode: `${hc}_operating_state`,
        room: `${hc}_room_device_temperature`,
        room_target: `${hc}_target_room_temperature`,
        cop_heating_today: `${hp}_heating_cop_daily`,
        cop_dhw_today: `${hp}_hot_water_cop_daily`,
        starts_today: `${hp}_compressor_start_cycling_daily`,
        starts_total: `${hp}_compressor_start_cycling_total`,
        energy_total: `${hp}_compressor_power_consumption_accumulated`,
        heat_total: `${hp}_compressor_thermal_energy_output_accumulated`,
        compressor_speed: `${hp}_compressor_unit_rating`,
        evap_temp: `${hp}_evaporation_temperature`,
        cond_temp: `${hp}_condensation_temperature`,
        suction_temp: `${hp}_suction_gas_temperature`,
        hot_gas: `${hp}_hot_gas_temperature`,
        subcooling: `${hp}_subcooling_temperature`,
        eev: `${hp}_expansion_valve_opening_angle`,
      };
    },
    tiles: (p, i) => {
      const hp = `sensor.${p ? `${p}_` : ''}hp${i.hp}`;
      const per = (base, periods = { today: 'daily', month: 'monthly', year: 'yearly', total: 'total' }) =>
        Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, `${hp}_${base}_${v}`]));
      const cyc = { today: 'daily', yesterday: 'yesterday', total: 'total' };
      return {
        cop_heating: per('heating_cop'), cop_dhw: per('hot_water_cop'), cop_cooling: per('cooling_cop'),
        energy: { total: `${hp}_compressor_power_consumption_accumulated` }, heat: { total: `${hp}_compressor_thermal_energy_output_accumulated` },
        energy_heating: per('heating_energy'), energy_dhw: per('hot_water_energy'), energy_cooling: per('cooling_energy'),
        energy_defrost: per('defrost_energy'), energy_standby: per('stby_energy'),
        heat_heating: per('heating_thermal_energy'), heat_dhw: per('hot_water_thermal_energy'),
        heat_cooling: per('cooling_thermal_energy'), heat_defrost: per('defrost_thermal_energy'),
        starts: per('compressor_start_cycling', { today: 'daily', yesterday: 'yesterday', month: 'monthly', total: 'total' }),
        cycles_heating: per('heating_cycling', cyc), cycles_dhw: per('hot_water_cycling', cyc),
        cycles_cooling: per('cooling_cycling', cyc), defrosts: per('defrost_cycling', cyc),
      };
    },
    errors: (p, i) => {
      const x = p ? `${p}_` : '';
      return [`sensor.${x}hp${i.hp}_error_number`, `sensor.${x}boil${i.dhw}_error_number`,
        `sensor.${x}buff${i.buffer}_error_number`, `sensor.${x}hc${i.hc}_error_number`, `sensor.${x}ambient_error_number`];
    },
    mode_map: {
      STBY: 'idle', CH: 'heating', DHW: 'dhw', CC: 'cooling', DEFROST: 'defrost',
      'TIME-BLOCK': 'blocked', 'RESTART-BLOCK': 'blocked', 'STBY-FROST': 'frost',
      CIRCULATE: 'circulate', OFF: 'off',
    },
    dhw_mode_map: { STBY: 'idle', DHW: 'dhw', LEGIO: 'legionella', 'TRAILING-STOP': 'trailing', OFF: 'off' },
    buffer_mode_map: { STBY: 'idle', HEATING: 'heating', COOLING: 'cooling', OFF: 'off' },
    hc_mode_map: { HEATING: 'heating', ECO: 'heating', COOLING: 'cooling', STBY: 'idle', OFF: 'off' },
    running_states: ['START COMPRESSOR', 'PRE-REGULATION', 'REGULATION', 'DEFROSTING'],
    status_labels: {
      de: {
        READY: 'bereit', 'START PUMPS': 'Pumpen starten', 'START COMPRESSOR': 'Verdichter startet',
        'PRE-REGULATION': 'Vorregelung', REGULATION: 'Regelung', STOPPING: 'stoppt',
        'RESTART-BLOCK': 'Wiederanlaufsperre', REFERENCE: 'Referenzfahrt', DEFROSTING: 'Abtauen',
      },
      en: {
        READY: 'ready', 'START PUMPS': 'starting pumps', 'START COMPRESSOR': 'starting compressor',
        'PRE-REGULATION': 'pre-regulation', REGULATION: 'regulating', STOPPING: 'stopping',
        'RESTART-BLOCK': 'restart block', REFERENCE: 'reference run', DEFROSTING: 'defrosting',
      },
    },
  },

  // Viessmann Vitocal via the core ViCare integration. Entities are found by translation_key,
  // so entity ids and the HA language do not matter. Restrict to one device with `device:`.
  vicare: {
    name: 'Viessmann (ViCare)',
    // Confirmed on a Vitocal 250 (#186, #196) and a Vitocal 200-S with combined storage and fresh-water station (#282).
    tested: true,
    unit_style: 'viessmann',
    // Gas boilers also report outside_temperature, so only compressor entities count as a heat pump.
    detect: (ctx) => (ctx.key('vicare', 'binary_sensor', 'compressor') || ctx.key('vicare', 'sensor', 'compressor_phase')
      || ctx.key('vicare', 'sensor', 'compressor_starts') ? '' : undefined),
    entities: (p, i, ctx) => {
      const s = (...tks) => tks.map((tk) => ctx.key('vicare', 'sensor', tk)).filter(Boolean);
      const b = (tk) => ctx.key('vicare', 'binary_sensor', tk);
      return {
        mode: s('compressor_phase'),
        compressor: b('compressor'),
        valve: b('domestic_hot_water_charging'),
        flow: s('secondary_circuit_supply_temperature', 'supply_temperature'),
        return: s('secondary_circuit_return_temperature', 'return_temperature'),
        volume: s('volumetric_flow'),
        source_in: s('primary_circuit_supply_temperature'),
        source_out: s('primary_circuit_return_temperature'),
        outdoor: s('outside_temperature'),
        dhw_top: s('dhw_storage_top_temperature', 'dhw_storage_temperature'),
        dhw_bottom: s('dhw_storage_bottom_temperature'),
        circulation: b('domestic_hot_water_circulation_pump'),
        buffer_top: s('buffer_top_temperature', 'buffer_main_temperature'),
        buffer_bottom: s('buffer_bottom_temperature'),
        hc_pump: b('circulation_pump'),
        cop_heating_today: s('cop_heating'),
        cop_dhw_today: s('cop_dhw'),
        energy_today: s('power_consumption_today'),
        starts_total: s('compressor_starts'),
        hours: s('compressor_hours'),
        aux_hours: s('heating_rod_hours'),
        compressor_speed: s('compressor_modulation'),
        solar_collector: s('collector_temperature'),
        solar_pump: b('solar_pump'),
        suction_temp: s('compressor_inlet_temperature'),
        hot_gas: s('compressor_outlet_temperature'),
        low_pressure: s('compressor_inlet_pressure', 'suction_gas_pressure'),
        high_pressure: s('compressor_outlet_pressure', 'hot_gas_pressure'),
        liquid_temp: s('condenser_liquid_temperature'),
        subcooling: s('condenser_subcooling_temperature'),
        superheat: s('evaporator_overheat_temperature'),
      };
    },
    tiles: (p, i, ctx) => {
      const s = (tk) => ctx.key('vicare', 'sensor', tk);
      const per = (base, periods) => Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, s(`${base}${v}`)]));
      const summary = { today: 'currentday', week: 'lastsevendays', month: 'currentmonth', year: 'currentyear' };
      return {
        cop_heating: { total: s('cop_heating') }, cop_dhw: { total: s('cop_dhw') }, cop_cooling: { total: s('cop_cooling') },
        cop_total: { total: s('cop_total') }, spf: { year: s('spf_total') },
        energy: { today: s('power_consumption_today'), week: s('power_consumption_this_week'), year: s('power_consumption_this_year') },
        energy_heating: { ...per('energy_summary_consumption_heating_', summary), year: [s('energy_summary_consumption_heating_currentyear'), s('energy_consumption_heating_this_year')] },
        energy_dhw: { ...per('energy_dhw_summary_consumption_heating_', summary), year: [s('energy_dhw_summary_consumption_heating_currentyear'), s('energy_consumption_dhw_this_year')] },
        energy_cooling: per('energy_consumption_cooling_', { today: 'today', month: 'this_month', year: 'this_year' }),
        starts: { total: s('compressor_starts') }, hours: { total: s('compressor_hours') },
        ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`load_class${n}`, { total: s(`compressor_hours_loadclass${n}`) }])),
        aux_hours: { total: s('heating_rod_hours') }, aux_starts: { total: s('heating_rod_starts') },
        pv_production: per('photovoltaic_energy_production_', { today: 'today', week: 'this_week', month: 'this_month', year: 'this_year', total: 'total' }),
        solar_thermal: per('solar_power_production_', { today: 'today', week: 'this_week', month: 'this_month', year: 'this_year' }),
      };
    },
    mode_map: {
      heating: 'heating', cooling: 'cooling', defrost: 'defrost', passive_defrost: 'defrost',
      pause: 'idle', ready: 'idle', preparing: 'idle', off: 'off',
    },
    // compressor_phase has no hot-water state, and some units (Vitocal 250, #186) report neither domestic_hot_water_charging
    // nor a phase other than ready/pause while the compressor runs. Without a valve entity hot water is read from the flow
    // (valve_rule), and a running compressor wins over an idle phase (#196).
    valve_rule: 'flow_above_dhw',
    compressor_over_idle: true,
    stat_labels: {
      cop_heating_today: { de: 'COP Heizen', en: 'COP heating' },
      cop_dhw_today: { de: 'COP Warmwasser', en: 'COP DHW' },
      starts_today: { de: 'Verdichterstarts', en: 'Compressor starts' },
    },
  },

  // Viessmann Vitocal via the Open3E MQTT integration. The integration exposes stable
  // translation keys; entity ids include the device name and serial number.
  open3e: {
    name: 'Viessmann (Open3E)',
    // Confirmed on a real installation with two heating circuits (#168).
    tested: true,
    unit_style: 'viessmann',
    index: { hc: 1 },
    auto_circuits: true,
    detect: (ctx) => (ctx.key('open3e', 'sensor', 'refrigeration_circuit_mode')
      || ctx.key('open3e', 'binary_sensor', 'heat_pump_compressor_active') ? '' : undefined),
    entities: (p, i, ctx) => {
      const s = (...tks) => tks.map((tk) => ctx.key('open3e', 'sensor', tk)).filter(Boolean);
      const b = (...tks) => tks.map((tk) => ctx.key('open3e', 'binary_sensor', tk)).filter(Boolean);
      return {
        mode: s('refrigeration_circuit_mode'),
        compressor: b('heat_pump_compressor_active'),
        valve: s('four_three_way_valve_position'),
        power: s('power_consumption_system'),
        heat: s('thermal_power'),
        flow: s('flow_temperature'),
        return: s('return_temperature'),
        source_in: s('primary_inlet_temperature'),
        outdoor: s('outside_temperature'),
        // The pressure of the heating water, drawn at the first circuit; an air unit has no brine loop to show it at (#318).
        hc_pressure: s('water_pressure'),
        dhw_top: s('dhw_buffer_top_temperature', 'domestic_hot_water_temperature'),
        dhw_middle: s('dhw_buffer_mid_temperature'),
        dhw_bottom: s('dhw_buffer_bottom_temperature'),
        dhw_target: s('domestic_hot_water_temperature_setpoint'),
        dhw_mode: s('domestic_hot_water_status'),
        buffer_top: s('heating_buffer_temperature', 'heating_cooling_buffer_temperature'),
        buffer_mode: ctx.key('open3e', 'select', 'buffer_operation_mode'),
        heater: b('additional_heater_active'),
        hc_flow: s(`flow_circuit${i.hc}_temperature`),
        hc_setpoint: s(`flow_circuit_${i.hc}_supply_temp_setpoint`),
        hc_mode: ctx.key('open3e', 'climate', `climate_circuit_${i.hc}`),
        hc_pump: b(`circuit_${i.hc}_pump`),
        room: s(`room${i.hc}_temperature`),
        cop_heating_today: s('cop_heating_today'),
        cop_dhw_today: s('cop_dhw_today'),
        energy_today: s('energy_consumption_total_today'),
        starts_total: s('compressor_starts'),
        hours: s('compressor_operating_hours'),
        compressor_speed: s('compressor_speed_percentage'),
        evap_temp: s('evaporation_vapor_temperature'),
        suction_temp: s('compressor_inlet_temperature'),
        hot_gas: s('compressor_outlet_temperature'),
        low_pressure: s('compressor_inlet_pressure'),
        high_pressure: s('compressor_outlet_pressure'),
        eev: s('expansion_valve1_position'),
      };
    },
    tiles: (p, i, ctx) => {
      const s = (tk) => ctx.key('open3e', 'sensor', tk);
      return {
        cop_heating: { today: s('cop_heating_today') }, cop_dhw: { today: s('cop_dhw_today') },
        cop_cooling: { today: s('cop_cooling_today') }, cop_total: { today: s('cop_total_today') },
        energy: { today: s('energy_consumption_total_today') },
        energy_heating: { today: s('energy_consumption_central_heating_today') },
        energy_dhw: { today: s('energy_consumption_domestic_hot_water_today') },
        energy_cooling: { today: s('energy_consumption_cooling_today') },
        heat_heating: { today: s('thermal_output_today') }, heat_dhw: { today: s('warm_water_output_today') },
        starts: { total: s('compressor_starts') }, hours: { total: s('compressor_operating_hours') },
        aux_hours: { total: s('additional_heater_operating_hours') }, aux_starts: { total: s('additional_heater_starts') },
      };
    },
    mode_map: { off: 'off', shutdown: 'idle', heating: 'heating', cooling: 'cooling', defrost: 'defrost', grid_lock: 'blocked' },
    // domestic_hot_water_status reports idle, active and postrun
    dhw_mode_map: { idle: 'idle', active: 'dhw', postrun: 'idle' },
    buffer_mode_map: { heating: 'heating', cooling: 'cooling' },
    hc_mode_map: { heat: 'heating', cool: 'cooling', off: 'off', auto: 'idle' },
  },

  // Vaillant aroTHERM via myPyllant (HACS). Names are fixed English strings prefixed with the
  // home name, so entity ids follow sensor.<home>_…; indices start at 0 (circuit_0, domestic_hot_water_0).
  vaillant: {
    name: 'Vaillant (myPyllant)',
    tested: true,
    circuit_rooms: true,
    index: { hc: 0, dhw: 0 },
    unit_style: 'vaillant',
    // Home Assistant adds a number (_2) to an entity id that was already taken: the home name stands before the name of
    // the entity, and a trailing number is not part of it.
    detect: (ctx) => {
      const id = ctx.match(/^sensor\.(.+)_energy_manager_state(?:_\d+)?$/, 'mypyllant')
        || ctx.match(/^sensor\.(.+)_system_flow_temperature(?:_\d+)?$/, 'mypyllant');
      return id === undefined ? undefined : id.replace(/^sensor\./, '').replace(/_(energy_manager_state|system_flow_temperature)(?:_\d+)?$/, '');
    },
    // Device counters "<home> Device <n> <product> Operation Time" and "… On/Off Cycles" (#120). The heat pump is the device
    // that reports its power, else the first device that is not the hydraulic station. The station's counters count its
    // backup heater: 1.5 h against 4165 h of the compressor on the installation in #120.
    counters: (p, ctx) => {
      const m = (re) => ctx.match(re, 'mypyllant');
      const power = m(new RegExp(`^sensor\\.${p}_device_\\d+_(?!hydraulic_station)[^.]*_current_power(?:_\\d+)?$`));
      const hp = power ? power.match(/_device_(\d+)_/)[1] : '\\d+';
      const device = (name) => m(new RegExp(`^sensor\\.${p}_device_${hp}_(?!hydraulic_station)[^.]*_${name}(?:_\\d+)?$`));
      const station = (name) => m(new RegExp(`^sensor\\.${p}_device_\\d+_hydraulic_station_${name}(?:_\\d+)?$`));
      return { hours: device('operation_time'), starts: device('on_off_cycles'), aux_hours: station('operation_time'), aux_starts: station('on_off_cycles') };
    },
    entities: (p, i, ctx) => {
      const counters = HFC_PRESETS.vaillant.counters(p, ctx);
      const m = (re) => ctx.match(re, 'mypyllant');
      // The exact id first; if it does not exist, the entity of that name that carries a number (_2).
      const e = (name) => {
        const exact = `sensor.${p}_${name}`;
        return ctx.state(exact) !== undefined ? exact : (m(new RegExp(`^sensor\\.${p}_${name}_\\d+$`)) || exact);
      };
      // A myPyllant zone names the circuit it belongs to (`zone_2_circuit_1_…`). Bind every room to that circuit instead
      // of taking the first zone of the home. Older integrations without the circuit part remain the fallback for circuit 0.
      const zoneSensor = (suffix) => m(new RegExp(`^sensor\\.${p}_zone_.+_circuit_${i.hc}_${suffix}(?:_\\d+)?$`))
        || (i.hc === 0 ? m(new RegExp(`^sensor\\.${p}_zone_.+_${suffix}(?:_\\d+)?$`)) : undefined);
      const zoneClimate = m(new RegExp(`^climate\\.${p}_zone_.+_circuit_${i.hc}(?:_climate)?(?:_\\d+)?$`))
        || (i.hc === 0 ? m(new RegExp(`^climate\\.${p}_zone_[^.]+$`)) : undefined);
      return {
        mode: e('energy_manager_state'),
        flow: e('system_flow_temperature'),
        outdoor: e('outdoor_temperature'),
        power: m(new RegExp(`^sensor\\.${p}_device_\\d+.*_current_power(?:_\\d+)?$`)),
        dhw_top: [e(`domestic_hot_water_${i.dhw}_tank_temperature`), e('top_dhw_cylinder_temperature')],
        dhw_bottom: e('bottom_dhw_cylinder_temperature'),
        dhw_target: e(`domestic_hot_water_${i.dhw}_setpoint`),
        buffer_top: e('top_central_heating_cylinder_temperature'),
        buffer_bottom: e('bottom_central_heating_cylinder_temperature'),
        hc_flow: e(`circuit_${i.hc}_current_flow_temperature`),
        hc_setpoint: e(`circuit_${i.hc}_flow_temperature_setpoint`),
        hc_mode: e(`circuit_${i.hc}_state`),
        // An installation with only the zone thermostat (climate) uses its current temperature and target.
        room: [zoneSensor('current_temperature'), zoneClimate],
        room_target: [zoneSensor('desired_temperature'), zoneClimate],
        program: zoneSensor('current_special_function'),
        cop_heating_today: m(new RegExp(`^sensor\\.${p}.*_heating_energy_efficiency(?:_\\d+)?$`)),
        hc_pressure: e('system_water_pressure'),
        hours: counters.hours,
        starts_total: counters.starts,
        aux_hours: counters.aux_hours,
      };
    },
    // Daily energy per device and mode ("Consumed Electrical Energy Heating", "Heat Generated Domestic Hot Water" …).
    tiles: (p, i, ctx) => {
      const d = (suffix) => ctx.match(new RegExp(`^sensor\\.${p}_device_\\d+.*_${suffix}(?:_\\d+)?$`), 'mypyllant');
      const counters = HFC_PRESETS.vaillant.counters(p, ctx);
      return {
        energy_heating: { today: d('consumed_electrical_energy_heating') }, energy_dhw: { today: d('consumed_electrical_energy_domestic_hot_water') },
        heat_heating: { today: d('heat_generated_heating') }, heat_dhw: { today: d('heat_generated_domestic_hot_water') },
        hours: { total: counters.hours }, starts: { total: counters.starts },
        aux_hours: { total: counters.aux_hours }, aux_starts: { total: counters.aux_starts },
      };
    },
    errors: (p, i, ctx) => [ctx.match(new RegExp(`^binary_sensor\\.${p}.*_trouble_codes(?:_\\d+)?$`), 'mypyllant')].filter(Boolean),
    mode_map: { STANDBY: 'idle', DHW: 'dhw', HEATING: 'heating', COOLING: 'cooling' },
    hc_mode_map: { HEATING: 'heating', COOLING: 'cooling', STANDBY: 'idle' },
    stat_labels: { cop_heating_today: { de: 'Effizienz Heizen', en: 'Heating efficiency' } },
  },

  // Bosch, Buderus, Junkers, Nefit, Worcester and other EMS-bus heat pumps via the EMS-ESP gateway (MQTT discovery).
  // Entity ids come either from EMS-ESP short names (boiler_hpactivity, …) or its descriptive Home Assistant object ids
  // (boiler_compressor_activity, …); the "multiple instances" entity format adds a prefix, which is detected. Enum texts
  // follow the EMS-ESP language.
  emsesp: {
    name: 'EMS-ESP (Bosch, Buderus, Junkers, Nefit …)',
    tested: true,
    unit_style: 'bosch',
    source_type: (e, hass) => (/hpbrinein$/.test(e.source_in || '') && hass.states[e.source_in] ? 'brine' : 'air'),
    // The circulation depends on the reading of the "pump fitted" switch.
    dynamic: true,
    detect: (ctx) => {
      // Gas boilers have curflowtemp as well; only heat pump entities count.
      const id = ctx.match(/^sensor\.(?:(.+)_)?boiler_(hpactivity|hptc1|compressor_activity|heat_carrier_forward_tc1)$/, 'mqtt');
      return id === undefined ? undefined : (id.match(/^sensor\.(?:(.+)_)?boiler_/)[1] || '');
    },
    entities: (p, i, ctx) => {
      const x = p ? `${p}_` : '';
      const b = (...ks) => ks.flatMap((k) => [`binary_sensor.${x}boiler_${k}`, `sensor.${x}boiler_${k}`]);
      // "Long names" format (#257): the hot-water tank has an internal and an external sensor; with both, the external one is the lower.
      // An existing internal sensor stays the top even while it is unavailable, so the external one never fills both positions.
      const dhwIntern = `sensor.${x}boiler_dhw_current_intern_temperature`;
      const dhwExtern = `sensor.${x}boiler_dhw_current_extern_temperature`;
      const hasIntern = ctx?.state(dhwIntern) !== undefined;
      const sw = (...ks) => ks.map((k) => `switch.${x}boiler_${k}`);
      // EMS-ESP publishes whether a circulation pump is fitted at all; without one the card draws no circulation (#257). Only a
      // switch that reports on maps it, so a switch that is unavailable at the first build cannot leave a mapping behind.
      const circPump = ['dhw_circulation_pump_available', 'dhw_circpump', 'wwcircpump'].map((k) => ctx?.state(`switch.${x}boiler_${k}`)).find((v) => v !== undefined);
      const s = (...ks) => ks.map((k) => `sensor.${x}${k}`);
      const hc = `hc${i.hc}`;
      // With the heat pump's own flow sensor (TC1) the boiler's current flow temperature is T0, the flow to the heating side
      // (WLW indoor units, #224); without TC1 it is the heat pump flow itself. The thermostat's flow temperature is a target (#287).
      const tc1 = ['boiler_hptc1', 'boiler_heat_carrier_forward_tc1'].some((k) => ctx?.state(`sensor.${x}${k}`) !== undefined);
      // Short names: writable values come as number and switch entities (dhw/seltemp, hc1/seltemp, dhw/circ, mixer pumpstatus).
      return {
        mode: s('boiler_hpactivity', 'boiler_compressor_activity'),
        // Long names: binary_sensor.boiler_hp_compressor read off while the compressor ran at 31 % (EMS-ESP 3.9.0-dev, #287),
        // so the compressor speed comes first there.
        compressor: b('hpcompon').concat(s('boiler_compressor_speed'), b('hp_compressor')),
        valve: b('hp3way', 'dhw_3wayvalve', 'ww3wayvalve', 'dhw_3_way_valve_active').concat(sw('3_way_valve')),
        power: s('boiler_hpcurrpower', 'boiler_compressor_current_power'),
        // "Compressor power output" is the heat output in kW, next to the electrical current power in W.
        heat: s('boiler_hppower', 'boiler_compressor_power_output'),
        fan_speed: s('boiler_fan_speed'),
        flow: s('boiler_hptc1', 'boiler_heat_carrier_forward_tc1', 'boiler_curflowtemp', 'boiler_current_flow_temperature'),
        return: s('boiler_hptc0', 'boiler_heat_carrier_return_tc0', 'boiler_rettemp', 'boiler_return_temperature'),
        volume: s('boiler_pc0flow', 'boiler_flow_pc0'),
        source_in: s('boiler_hptl2', 'boiler_air_inlet_temperature_tl2', 'boiler_hpbrinein'),
        source_out: s('boiler_hpbrineout'),
        heater: b('auxheaterstatus', 'aux_heater_status').concat(s('boiler_auxheaterlevel', 'boiler_aux_heater_level')),
        outdoor: s('boiler_outdoortemp', 'thermostat_outdoortemp', 'boiler_outside_temperature'),
        dhw_top: s('boiler_dhw_curtemp', 'boiler_wwcurtemp', 'boiler_dhw_storagetemp1').concat(hasIntern ? dhwIntern : dhwExtern),
        dhw_bottom: s('boiler_dhw_storagetemp2').concat(hasIntern ? [dhwExtern] : []),
        dhw_target: s('boiler_dhw_seltemp', 'boiler_wwseltemp').concat(`number.${x}boiler_dhw_seltemp`, `number.${x}boiler_wwseltemp`,
          `number.${x}boiler_dhw_selected_temperature`),
        circulation: circPump !== undefined && circPump !== 'on' ? undefined : b('dhw_circ', 'wwcirc').concat(sw('dhw_circ', 'wwcirc', 'dhw_circulation_active')),
        // The indoor unit's own circuit pump PC1 drives the first circuit (WLW, #224): on/off where reported, else its rate in %.
        hc_pump: [`binary_sensor.${x}mixer_${hc}_pumpstatus`, `sensor.${x}mixer_${hc}_pumpstatus`, `switch.${x}mixer_${hc}_pumpstatus`,
          ...(i.hc === 1 ? [`binary_sensor.${x}boiler_heating_pump`, `binary_sensor.${x}boiler_heatingpump`] : []),
          ...(tc1 && i.hc === 1 ? b('pc1on', 'pc1').concat(s('boiler_pc1rate', 'boiler_pc1_rate')) : [])],
        // Only a reported PC1 flow: a candidate id without an entity would draw an empty flow-rate label at the circuit.
        hc_volume: tc1 && i.hc === 1 ? s('boiler_pc1flow', 'boiler_flow_pc1').find((id) => ctx?.state(id) !== undefined) : undefined,
        hc_flow: s(`mixer_${hc}_flowtemphc`).concat(tc1 && i.hc === 1 ? s('boiler_curflowtemp', 'boiler_current_flow_temperature') : []),
        hc_setpoint: s(`thermostat_${hc}_targetflowtemp`, `thermostat_${hc}_target_flow_temperature`),
        room: s(`thermostat_${hc}_currtemp`, `thermostat_${hc}_current_room_temperature`),
        room_target: s(`thermostat_${hc}_seltemp`).concat(`number.${x}thermostat_${hc}_seltemp`, `number.${x}thermostat_${hc}_selected_room_temperature`),
        program: s(`thermostat_${hc}_modetype`),
        // Compressor operating time of all modes: "total operating time heat" (uptimecontrol). "heatpump total uptime" (uptimetotal)
        // also counts standby, and uptimecomp is the hot-water share under the dhw tag (#333).
        hours: s('boiler_uptimecontrol', 'boiler_total_operating_time_heat'),
        starts_total: s('boiler_totalcompstarts', 'boiler_total_compressor_control_starts'),
        energy_total: s('boiler_nrgconstotal', 'boiler_total_energy_consumption'),
        heat_total: s('boiler_nrgsupptotal', 'boiler_total_energy_supplied'),
        compressor_speed: s('boiler_hpcompspd', 'boiler_compressor_speed'),
        evap_temp: s('boiler_hppl1', 'boiler_evaporator_inlet_temperature_tr4'),
        eev: s('boiler_expansion_valve_vr1'),
        cond_temp: s('boiler_hpph1'),
        suction_temp: s('boiler_hptr5', 'boiler_compressor_inlet_temperature_tr5'),
        hot_gas: s('boiler_hptr6', 'boiler_compressor_outlet_temperature_tr6'),
        liquid_temp: s('boiler_hptr3', 'boiler_refrigerant_temperature_liquid_side_condenser_output_tr3'),
      };
    },
    // EMS-ESP only reports totals; today, month … come from their long-term statistics.
    tiles: (p) => {
      const t = (...ks) => ({ total: ks.map((k) => `sensor.${p ? `${p}_` : ''}boiler_${k}`) });
      return {
        energy: t('nrgconstotal', 'metertotal', 'total_energy_consumption'), energy_heating: t('nrgconscompheating', 'meterheat'), energy_dhw: t('dhw_nrgconscomp', 'dhw_meter'),
        energy_cooling: t('nrgconscompcooling', 'metercool'), energy_aux: t('auxelecheatnrgconstotal', 'metereheat'),
        heat: t('nrgsupptotal', 'total_energy_supplied'), heat_heating: t('nrgsuppheating'), heat_dhw: t('dhw_nrgsupp'), heat_cooling: t('nrgsuppcooling'),
        starts: t('totalcompstarts', 'total_compressor_control_starts'), cycles_heating: t('heatingstarts'), cycles_dhw: t('dhw_startshp'), cycles_cooling: t('coolingstarts'),
        hours: t('uptimecontrol', 'total_operating_time_heat'),
      };
    },
    mode_map: {
      off: 'idle', heating: 'heating', cooling: 'cooling', 'hot water': 'dhw', pool: 'heating', 'pool heating': 'heating',
      defrost: 'defrost', 'compressor alarm': 'off',
      aus: 'idle', heizen: 'heating', kühlen: 'cooling', warmwasser: 'dhw', 'pool beheizen': 'heating', abtauen: 'defrost',
      'alarm kompressor': 'off',
    },
  },

  // Panasonic Aquarea via HeishaMon and the "heishamon-homeassistant" integration (domain aquarea).
  // Entity ids are slugs of the MQTT topics: sensor.<prefix>_main_<topic>, prefix default panasonic_heat_pump.
  heishamon: {
    name: 'Panasonic Aquarea (HeishaMon)',
    tested: true,
    unit_style: 'panasonic',
    // Size of the drawing from the model HeishaMon reports ("WH-MXC09H3E5 9 1ph T-CAP"): T-CAP units, 12 and 16 kW and the 9 kW
    // units of the H generation have the tall casing with two fans; the J generation monobloc up to 9 kW has one (#176).
    unit_size: (e, hass) => {
      const text = String(hass?.states?.[e.model]?.state || '');
      // All-in-one models carry two capacities in the code (WH-ADC0916H9E8 12 3ph T-CAP); the number after the code counts.
      const m = /WH-[A-Z]{3}(\d{2,4})([A-Z])\w*\s+(\d+)/.exec(text);
      if (!m) return undefined;
      const kw = +m[3]; const generation = m[2];
      return /T-CAP/i.test(text) || kw >= 12 || (kw >= 9 && generation === 'H') ? 'large' : 'medium';
    },
    // The primary pump sits in the heat pump (outdoor unit of the monobloc, hydro module of the split) and also runs for hot water.
    primary_pump: true,
    auto_circuits: false,
    detect: (ctx) => {
      const id = ctx.match(/^sensor\.(.+)_main_main_outlet_temp$/, 'aquarea');
      return id === undefined ? undefined : id.replace(/^sensor\./, '').replace(/_main_main_outlet_temp$/, '');
    },
    entities: (p, i, ctx) => {
      const m = `${p}_main_`;
      const z = `z${i.hc}`;
      // Z1_Temp is the room temperature only with a room sensor at the zone ("Internal Thermostat", "Thermistor").
      // With "Water Temperature" or "External Thermostat" it is the zone water temperature; then the remote control sensor is the room.
      const zoneRoom = ['Internal Thermostat', 'Thermistor'].includes(ctx.state(`sensor.${m}z1_sensor_settings`));
      // The zone water temperature needs a zone sensor; without one HeishaMon reports about -78 to -128 °C.
      // Then the circuit has no own flow temperature and the card uses the heat pump's flow (direct system).
      const zoneFlow = parseFloat(ctx.state(`sensor.${m}${z}_water_temp`));
      const curve = ctx.state(`sensor.${m}heating_mode`) === 'compensation curve';
      return {
        // The model text ("Aquarea Heatpump model") only picks the size of the drawing (unit_size above).
        model: `sensor.${m}heat_pump_model`,
        compressor: `sensor.${m}compressor_freq`,
        // The fan runs on for about a minute after the compressor stops.
        fan_speed: `sensor.${m}fan1_motor_speed`,
        valve: `sensor.${m}threeway_valve_state`,
        defrost: [`binary_sensor.${m}defrosting_state`, `switch.${m}defrosting_state`],
        heater: [`binary_sensor.${m}internal_heater_state`, `sensor.${m}internal_heater_state`],
        // The integration reads Power and Energy topics (firmware dependent), so the id has either spelling.
        // The totals (sensor.<prefix>_consumption / _production) add heating, hot water and cooling;
        // the heating values stay 0 W while the valve is on the tank.
        power: [`sensor.${p}_consumption`, 'sensor.aquarea_energy_consumption', `sensor.${m}heat_power_consumption`, `sensor.${m}heat_energy_consumption`],
        heat: [`sensor.${p}_production`, 'sensor.aquarea_energy_production', `sensor.${m}heat_power_production`, `sensor.${m}heat_energy_production`],
        flow: `sensor.${m}main_outlet_temp`,
        return: `sensor.${m}main_inlet_temp`,
        volume: `sensor.${m}pump_flow`,
        outdoor: `sensor.${m}outside_temp`,
        dhw_top: `sensor.${m}dhw_temp`,
        dhw_target: [`number.${m}dhw_target_temp`, `sensor.${m}dhw_target_temp`],
        hc_flow: zoneFlow > -50 || Number.isNaN(zoneFlow) ? `sensor.${m}${z}_water_temp` : undefined,
        // main_target_temp follows the hot-water target while the valve is on the tank, so the zone target comes first.
        hc_setpoint: [`sensor.${m}${z}_water_target_temp`, i.hc === 1 ? `sensor.${m}main_target_temp` : undefined],
        // With the compensation curve the heat request temperature shifts the curve (-5 to +5 K); in direct mode it is the target itself.
        hc_curve_offset: curve ? [`number.${m}${z}_heat_request_temp`, `sensor.${m}${z}_heat_request_temp`] : undefined,
        room: zoneRoom ? `sensor.${m}z1_temp` : [`sensor.${m}room_thermostat_temp`, `sensor.${m}z1_temp`],
        // Water pressure (TOP115, K/L series, seen in bar on a real installation in #276): only where the entity exists, so units
        // without it draw no empty pressure label. One system pressure, for the first circuit only.
        hc_pressure: i.hc === 1 && ctx.state(`sensor.${m}water_pressure`) !== undefined ? `sensor.${m}water_pressure` : undefined,
        program: [`sensor.${m}holiday_mode_state`, `switch.${m}holiday_mode_state`],
        hours: `sensor.${m}operations_hours`,
        starts_total: `sensor.${m}operations_counter`,
        aux_hours: `sensor.${m}room_heater_operations_hours`,
        // kWh totals that the integration integrates from its W sensors (left Riemann sum, ids from their names). They are no
        // counters of the heat pump: they start with the integration and stop without data. Long-term statistics give the periods.
        energy_total: 'sensor.aquarea_pump_total_consumption_total',
        heat_total: 'sensor.aquarea_pump_total_production_total',
        compressor_speed: `sensor.${m}compressor_freq`,
        hot_gas: `sensor.${m}discharge_temp`,
        // Refrigerant sensors in heating mode: the outdoor heat exchanger pipe is the evaporator (evaporation temperature),
        // the evaporator outlet is the suction gas, the indoor (plate heat exchanger) pipe is the liquid line.
        evap_temp: `sensor.${m}outside_pipe_temp`,
        suction_temp: `sensor.${m}eva_outlet_temp`,
        liquid_temp: `sensor.${m}inside_pipe_temp`,
        high_pressure: `sensor.${m}high_pressure`,
        low_pressure: `sensor.${m}low_pressure`,
        eev: `sensor.${m}expansion_valve`,
      };
    },
    // The pipe sensors above have these roles only in heating: in defrost and cooling the circuit runs backwards.
    heating_roles: ['evap_temp', 'suction_temp', 'liquid_temp'],
    // TOP44 "Last Error": "No error", or an H/F code (H76, F12 …) until the error is reset.
    errors: (p) => [`sensor.${p}_main_error`],
    error_ok: ['No error'],
    // Holiday mode reports Off / Scheduled / Active as a sensor, or on / off as a switch.
    program_map: { Active: 'holiday', Scheduled: 'none', Off: 'none', on: 'holiday' },
    // Heat and electricity per mode as current power ("now") and as the integration's kWh counters ("total" and, from the
    // long-term statistics, today … year). The counter ids come from the names of the power sensors plus " Total".
    tiles: (p) => {
      const m = `sensor.${p}_main_`;
      const both = (topic) => [`${m}${topic}_power_`, `${m}${topic}_energy_`];
      const now = (topic, kind, total) => ({ now: both(topic).map((x) => x + kind), total: `sensor.aquarea_${total}_total` });
      return {
        energy_heating: now('heat', 'consumption', 'heat_power_consumed'), heat_heating: now('heat', 'production', 'heat_power_produced'),
        energy_dhw: now('dhw', 'consumption', 'dhw_power_consumed'), heat_dhw: now('dhw', 'production', 'dhw_power_produced'),
        energy_cooling: now('cool', 'consumption', 'thermal_cooling_power_consumption'),
        heat_cooling: now('cool', 'production', 'thermal_cooling_power_production'),
        starts: { total: `${m}operations_counter` }, hours: { total: `${m}operations_hours` },
        aux_hours: { total: `${m}room_heater_operations_hours` },
      };
    },
  },

  // Wolf heat pumps (CHA …) via the core wolflink integration or the custom wolf_smartset integration (both WOLF Link home and
  // the SmartSet cloud). wolflink: entity ids sensor.<device>_<parameter name> in the SmartSet language (English expected here),
  // list states as German texts or slugs (Abtaubetrieb, heizbetrieb, at_abschaltung); names that repeat get _2, _3 in no fixed
  // order and are not used. wolf_smartset: entities found by translation_key (the wolflink suffixes), list states as Wolf's
  // German texts (Heizbetrieb, AT Abschaltung, Ein). The prefix tells the branches apart: '' is wolf_smartset, a slug is wolflink.
  // wolf_smartset spreads its entities over several HA devices (Heizgerät, Bedienmodul BM-2, Mischermodul MM1, the system), so the
  // `device` option, which limits every registry lookup to one device, must stay unset for it.
  wolf: {
    name: 'Wolf (wolflink, wolf_smartset)',
    tested: true,
    // CHA monoblock; the CHA-07/10 and CHA-16/20 share the proportions, so one drawing serves all sizes (#156).
    unit_style: 'wolf',
    // Both integrations also serve gas and oil boilers; only heat pumps report a compressor status (Verdichterstatus).
    // wolf_smartset wins when both are installed (its README asks to disable wolflink for the same account anyway).
    detect: (ctx) => {
      if (ctx.key('wolf_smartset', 'sensor', 'compressor_status')) return '';
      const id = ctx.match(/^sensor\.(.+)_compressor_status$/, 'wolflink');
      return id === undefined ? undefined : id.replace(/^sensor\./, '').replace(/_compressor_status$/, '');
    },
    entities: (p, i, ctx) => {
      const sm = p === '';
      const s = hfcWolfSensor(p, ctx);
      // One mixer circuit only (neither the wolflink names nor the wolf_smartset keys carry a circuit number): further circuits map nothing.
      const hc = (v) => (i.hc === 1 ? v : undefined);
      return {
        mode: s('operating_mode_heater'),
        status: s('compressor_status'),
        compressor: s('compressor_frequency'),
        compressor_speed: s('current_capacity_specification_compressor'),
        power: s('power_consumption_wp_ehz'),
        heat: s('current_secondary_power'),
        flow: s('boiler_water_temperature'),
        return: s('return_temperature'),
        volume: s('hc_flow_rate'),
        outdoor: s('outside_temperature'),
        valve: s('3_way_diverter_valve_htg_dhw'),
        heater: s('electric_booster_heater'),
        dhw_top: s('dhw_temperature'),
        // wolf_smartset: the sensor set_dhw_temperature_adjusted ("Warmwassersolltemperatur") is the effective DHW target; it follows the
        // DHW status and drops to 10 °C (frost protection) while hot water is off. The number set_dhw_temperature ("Warmwassersolltemperatur
        // eingestellt") holds the configured value around the clock and is the fallback. The keys are bound the reverse way from wolflink.
        dhw_target: sm ? [s('set_dhw_temperature_adjusted'), ctx.key('wolf_smartset', 'number', 'set_dhw_temperature')] : s('set_dhw_temperature_adjusted'),
        hc_flow: hc(s('flow_temperature')),
        // In wolf_smartset "Ausgang MKP" duplicates "Mischerkreispumpe" and starts disabled, so the pump of the system tab comes first.
        hc_pump: hc(sm ? [s('mixer_circuit_pump'), s('mkp_mixer_circuit_pump')] : s('mkp_mixer_circuit_pump')),
        hc_mode: hc(s('mixer_circuit_status')),
        hc_pressure: s('system_pressure'),
        room: s('room_temperature'),
        room_target: sm ? ctx.key('wolf_smartset', 'number', 'day_temperature_mixer_circuit_1') : s('day_temperature'),
        // wolf_smartset: the mixer circuit demand (Anforderung Mischerkreis, 36000400001) carries the time program and the party, holiday and eco modes.
        program: sm ? s('mixer_circuit_demand') : s('holiday_mode'),
        hours: s('compressor_operating_hours'),
        aux_hours: s('e_heating_operating_hours'),
      };
    },
    // Heat counters only: the electricity counters stay 0 without an energy meter at the heat pump, which would give empty COP tiles.
    tiles: (p, i, ctx) => {
      const s = hfcWolfSensor(p, ctx);
      return {
        heat: { yesterday: s('heat_generated_previous_day'), month: s('heat_generated_current_month'), year: s('heat_generated_current_year') },
        heat_heating: { total: s('energy_amount_htg') }, heat_dhw: { total: s('energy_amount_dhw') }, heat_cooling: { total: s('clg_energy_amount') },
        hours: { total: s('compressor_operating_hours') }, aux_hours: { total: s('e_heating_operating_hours') },
      };
    },
    // wolf_smartset has no fault code: none in its translation keys, none in the Wolf heat pump description. Configure `errors` by hand there.
    errors: (p) => (p === '' ? [] : [`sensor.${p}_sub_fault_code`]),
    // "Betriebsart Heizgerät" list items (wolf-comm parameter example for heat pumps). wolflink reports some as slugs, wolf_smartset
    // reports Wolf's texts (Heizbetrieb); the lookup is case-insensitive, so one entry serves both.
    mode_map: {
      heizbetrieb: 'heating', warmwasser: 'dhw', 'WW-Nachlauf': 'circulate', 'HZ-Nachlauf': 'circulate', Abtaubetrieb: 'defrost', standby: 'idle',
      'Aktive Kühlung': 'cooling', 'Nachlauf K': 'circulate', 'Frostschutz HK': 'frost', 'Frostschutz Warmwasser': 'frost',
      antilegionellenfunktion: 'dhw', Pool: 'heating',
    },
    // "Mischerkreis Status" list items. wolflink slugifies the four AT/RT states (at_abschaltung); wolf_smartset reports Wolf's text
    // with a space (AT Abschaltung), which lower-casing cannot bridge, so both spellings are listed.
    hc_mode_map: {
      aus: 'off', heizbetrieb: 'heating', absenkbetrieb: 'heating', eco: 'heating', absenkstop: 'heating', Kühlbetrieb: 'cooling',
      at_abschaltung: 'off', rt_abschaltung: 'off', at_frostschutz: 'frost', rt_frostschutz: 'frost', warmwasservorrang: 'idle',
      'AT Abschaltung': 'off', 'RT Abschaltung': 'off', 'AT Frostschutz': 'frost', 'RT Frostschutz': 'frost',
    },
    // wolflink holiday mode (aktiviert, deaktiviert); wolf_smartset mixer circuit demand: "Automatik aus" is the setback outside the heating
    // time program, "Automatik ein" the normal operation. Partymodus, Urlaubsmodus and Sparbetrieb match the card's default patterns.
    program_map: { aktiviert: 'holiday', deaktiviert: 'none', 'Automatik ein': 'none', 'Automatik aus': 'night' },
    running_states: ['Betrieb'],
    // Keys are the raw status texts: wolflink slugs (vorspulen) and wolf_smartset texts (Vorspülen).
    status_labels: {
      de: { vorspulen: 'Vorspülen', nachspulen: 'Nachspülen', Vorspülen: 'Vorspülen', Nachspülen: 'Nachspülen', Sperrzeit: 'Sperrzeit', 'EVU Sperre': 'EVU-Sperre' },
      en: { vorspulen: 'pre-flush', nachspulen: 'post-flush', Vorspülen: 'pre-flush', Nachspülen: 'post-flush', Sperrzeit: 'blocking time', 'EVU Sperre': 'utility lock' },
    },
  },

  // Kronoterm (ADAPT, ETERA, VERSI, WPLV …) via the "Kronoterm" integration (HACS), Cloud API or Modbus. Entities are
  // found by translation_key, so entity ids and the HA language do not matter. Cloud and Modbus name the circuit
  // temperatures differently (loop_1_inlet_temperature, loop_1_temp); both spellings are candidates.
  kronoterm: {
    name: 'Kronoterm',
    tested: true,
    // ADAPT air/water unit; brine and water units (ETERA, WPLV …) keep the loop symbol through source_type (#157).
    unit_style: 'kronoterm',
    // The main circulation pump (register 2038, `main_pump_status`) belongs to the heat pump and runs for heating, hot water and defrost.
    primary_pump: true,
    // The hot water heat pumps of the Kronoterm DHW cloud have neither, so only heating heat pumps are detected.
    detect: (ctx) => (ctx.key('kronoterm', 'sensor', 'working_function') || ctx.key('kronoterm', 'sensor', 'hp_outlet_temperature') ? '' : undefined),
    entities: (p, i, ctx) => {
      const s = (...tks) => tks.map((tk) => ctx.key('kronoterm', 'sensor', tk)).filter(Boolean);
      const b = (tk) => ctx.key('kronoterm', 'binary_sensor', tk);
      const c = (tk) => ctx.key('kronoterm', 'climate', tk);
      const n = i.hc;
      // With a room thermostat the Cloud reports the room temperature as loop_<n>_temperature, without one the loop water.
      const thermostat = s(`loop_${n}_thermostat_temperature`);
      return {
        mode: s('working_function'),
        // HP load in %: above 0 while the compressor runs, also while it defrosts (power and heat output then read 0).
        compressor: s('hp_load'),
        defrost: b('defrost_status'),
        // Bit 1 of register 2028, the hot water circulator: on exactly while the tank is charged.
        valve: b('dhw_circulation_pump'),
        power: s('current_heating_cooling_power'),
        heat: s('current_heating_cooling_capacity'),
        flow: s('hp_outlet_temperature'),
        return: s('hp_inlet_temperature'),
        outdoor: s('temperature_outside'),
        heater: b('reserve_source_status'),
        // The Cloud has the tank temperature only as the current temperature of the DHW thermostat (climate).
        dhw_top: [...s('dhw_temperature'), c('dhw_temperature')],
        dhw_target: [...s('dhw_current_setpoint'), c('dhw_temperature')],
        circulation: b('circulation_pump'),
        hc_flow: [...s(`loop_${n}_inlet_temperature`, `loop_${n}_temp`), ...(thermostat.length ? [] : s(`loop_${n}_temperature`))],
        hc_pump: b(`circulation_loop_${n}`),
        hc_pressure: s('heating_system_pressure'),
        room: thermostat,
        room_target: thermostat.length ? [...s(`loop_${n}_room_current_setpoint`), c(`loop_${n}_temperature`)] : undefined,
        program: [ctx.key('kronoterm', 'select', 'operational_mode'), ...s('operation_program')],
        energy_today: s('energy_combined'),
        aux_hours: s('operating_hours_additional_source_1'),
        energy_total: s('electrical_energy_heating_dhw'),
        compressor_speed: s('hp_load'),
        evap_temp: s('temperature_compressor_inlet'),
        hot_gas: s('temperature_compressor_outlet'),
      };
    },
    // Today's electricity per use from the Cloud; compressor starts per use and the SCOP as totals.
    tiles: (p, i, ctx) => {
      const s = (tk) => ctx.key('kronoterm', 'sensor', tk);
      return {
        energy_heating: { today: s('energy_heating') }, energy_dhw: { today: s('energy_dhw') }, energy_aux: { today: s('energy_heater') },
        cop_total: { total: s('scop_value') },
        cycles_heating: { total: s('compressor_activations_heating') }, cycles_dhw: { total: s('activations_boiler') },
        cycles_cooling: { total: s('compressor_activations_cooling') },
        aux_hours: { total: s('operating_hours_additional_source_1') },
      };
    },
    errors: (p, i, ctx) => [ctx.key('kronoterm', 'sensor', 'error_warning')].filter(Boolean),
    // Cloud: no_error, warning, error. Modbus: no_error, warning, alarm, notice.
    error_ok: ['no_error', 'notice'],
    mode_map: {
      heating: 'heating', dhw: 'dhw', cooling: 'cooling', pool_heating: 'heating', thermal_disinfection: 'dhw',
      standby: 'idle', start: 'heating', remote_deactivation: 'blocked', protection: 'blocked',
    },
  },

  // Heat pumps with a Luxtronik controller (Alpha Innotec, Novelan, Roth, Siemens, Elco, Buderus, Nibe, Wolf) through the
  // "Luxtronik" integration (BenPru/luxtronik, HACS, domain luxtronik2). Confirmed on a water-to-water installation (#75, #208).
  // The SensorKey values are the translation keys, so entity ids and the HA language do not matter. Flow (Vorlauf,
  // TVL) is flow_in_temperature and return (Rücklauf, TRL) is flow_out_temperature, "in" and "out" as seen from the heating system.
  // The mixing circuits 1 to 3 are circuits 1 to 3 of the card, but only where they report a flow and a target; without a mixing
  // circuit the card draws the heat pump flow as the circuit flow. The last error (error_reason) stays after a reset and the
  // buffer is not exposed, so neither is mapped.
  luxtronik: {
    name: 'Luxtronik (Alpha Innotec, Novelan, Roth …)',
    tested: true,
    // Alpha Innotec Hybrox for air units; Novelan, Roth and the other brands share the controller, not the casing (#158).
    unit_style: 'alpha_innotec',
    // A mixing circuit counts when its sensors report: the card looks again every minute for circuits that report late.
    dynamic: true,
    auto_circuits: false,
    detect: (ctx) => (ctx.key('luxtronik2', 'sensor', 'status') || ctx.key('luxtronik2', 'sensor', 'flow_in_temperature') ? '' : undefined),
    entities: (p, i, ctx) => {
      const s = (tk) => ctx.key('luxtronik2', 'sensor', tk);
      const b = (tk) => ctx.key('luxtronik2', 'binary_sensor', tk);
      const n = i.hc;
      // A mixing circuit that is not installed still has its sensors; it counts when flow and target are plain numbers.
      const mixFlow = n <= 3 ? s(`flow_in_circuit${n}_temperature`) : undefined;
      const mixTarget = n <= 3 ? s(`flow_in_circuit${n}_target_temperature`) : undefined;
      const mixer = Number.isFinite(parseFloat(ctx.state(mixFlow))) && parseFloat(ctx.state(mixTarget)) >= 10;
      return {
        mode: s('status'),
        compressor: b('compressor'),
        // Both are disabled in the integration by default: enable "Current power consumption" and "Current heat output".
        power: s('current_power_consumption'),
        heat: s('current_heat_output'),
        flow: s('flow_in_temperature'),
        return: s('flow_out_temperature'),
        volume: s('heat_amount_flow_rate'),
        source_volume: s('heat_source_flow_rate'),
        source_in: s('heat_source_input_temperature'),
        source_out: s('heat_source_output_temperature'),
        outdoor: s('outdoor_temperature'),
        heater: b('additional_heat_generator'),
        dhw_top: s('dhw_temperature'),
        // The controller's current target (calc 18, firmware x.90.1) where the integration has no target number.
        dhw_target: [ctx.key('luxtronik2', 'number', 'dhw_target_temperature'), ctx.key('luxtronik2', 'sensor', 'dhw_target_temperature_controller')].filter(Boolean),
        solar_collector: s('solar_collector_temperature'),
        solar_pump: b('solar_pump'),
        hc_flow: mixer ? mixFlow : undefined,
        hc_setpoint: mixer ? mixTarget : undefined,
        hc_pump: n === 1 ? b('circulation_pump_heating') : undefined,
        room: n === 1 ? s('room_thermostat_temperature') : undefined,
        room_target: n === 1 ? s('room_thermostat_temperature_target') : undefined,
        program: ctx.key('luxtronik2', 'select', 'heating_mode'),
        hours: [s('compressor1_operation_hours'), s('operation_hours')],
        starts_total: s('compressor1_impulses'),
        aux_hours: s('additional_heat_generator_operation_hours'),
        heat_total: s('heat_amount_counter'),
        hot_gas: s('hot_gas_temperature'),
        suction_temp: s('suction_compressor_temperature'),
        superheat: s('overheating_temperature'),
        high_pressure: s('high_pressure'),
        low_pressure: s('low_pressure'),
      };
    },
    // The kWh counters per use (P1136 to P1139 and the heat amounts) exist on newer firmware only; each tile appears where its counter does.
    tiles: (p, i, ctx) => {
      const s = (tk) => ctx.key('luxtronik2', 'sensor', tk);
      return {
        energy_heating: { total: s('heat_energy_input') }, energy_dhw: { total: s('dhw_energy_input') }, energy_cooling: { total: s('cooling_energy_input') },
        energy_aux: { total: s('additional_heat_generator_energy') },
        heat: { total: s('heat_amount_counter') }, heat_heating: { total: s('heat_amount_heating') }, heat_dhw: { total: s('dhw_heat_amount') },
        heat_cooling: { total: s('cooling_heat_amount') },
        hours: { total: [s('compressor1_operation_hours'), s('operation_hours')] }, aux_hours: { total: s('additional_heat_generator_operation_hours') },
        starts: { total: s('compressor1_impulses') },
      };
    },
    // Status values (LuxOperationMode); the pool and solar mode and an external heat source count as heating.
    mode_map: {
      heating: 'heating', hot_water: 'dhw', swimming_pool_solar: 'heating', heating_external_source: 'heating', cooling: 'cooling',
      defrost: 'defrost', evu: 'blocked', no_request: 'idle',
    },
    // Heating mode select (LuxMode).
    program_map: { Automatic: 'none', Off: 'none', 'Second heatsource': 'none', Party: 'party', Holidays: 'holiday' },
  },

  // Stiebel Eltron heat pumps with an ISG (WPM 3, WPM 3i, WPMsystem, LWZ; Tecalor) through the "Stiebel Eltron ISG" integration
  // (pail23, HACS, domain stiebel_eltron_isg, Modbus TCP). Built from the integration source (2026.9) and confirmed on a WPMsystem
  // (#69, card 0.13.1, French Home Assistant); WPM 3, WPM 3i and the LWZ family follow the source only. Every entity carries its key as translation key, so entity ids and the HA language do not matter (a French Home Assistant calls the
  // heat pump flow sensor_..._temperature_de_depart_pac1). The integration creates the sensors of the whole controller family, also those of
  // hardware that is not installed; they read unavailable. Optional parts (buffer, solar, heat source, refrigerant circuit, circuits 2 and 3)
  // are therefore mapped only where they report a number. There is no operating mode entity (the select is the program), so the card
  // derives the mode from the compressor, the defrost flag and the hot water flag; cooling is not shown.
  stiebel_isg: {
    name: 'Stiebel Eltron ISG (WPM, LWZ) / Tecalor',
    tested: true,
    // WPL-A for air sources (the integration does not name the model); brine units keep the loop symbol (#159).
    unit_style: 'stiebel',
    // Optional parts are mapped by their readings: the card looks again every minute for parts that report late.
    dynamic: true,
    auto_circuits: false,
    source_type: (e) => (e.source_in || e.brine_pressure ? 'brine' : 'air'),
    detect: (ctx) => (['outdoor_temperature', 'actual_temperature_water', 'flow_temperature'].some((tk) => ctx.key('stiebel_eltron_isg', 'sensor', tk)) ? '' : undefined),
    // While the Modbus connection is down every sensor is unavailable and the optional parts cannot be told apart: wait for a value.
    ready: (ctx) => ['outdoor_temperature', 'actual_temperature_water', 'flow_temperature']
      .some((tk) => Number.isFinite(parseFloat(ctx.state(ctx.key('stiebel_eltron_isg', 'sensor', tk))))),
    entities: (p, i, ctx) => {
      const k = (domain, ...tks) => tks.map((tk) => ctx.key('stiebel_eltron_isg', domain, tk)).filter(Boolean);
      const s = (...tks) => k('sensor', ...tks);
      const b = (...tks) => k('binary_sensor', ...tks);
      // Hardware that is not installed reads unavailable: such an entity is left out.
      const reading = (ids) => ids.filter((id) => Number.isFinite(parseFloat(ctx.state(id))));
      const n = i.hc;
      // Circuit 1 always exists; circuits 2 and 3 count when they report a flow temperature.
      const circuit = n === 1 || reading(s(`actual_temperature_hk${n}`)).length > 0;
      const roomActual = reading(n === 1 ? s('actual_room_temperature_hk1', 'actual_temperature_fek', 'actual_temperature') : s(`actual_room_temperature_hk${n}`));
      const roomTarget = reading(n === 1 ? s('target_room_temperature_hk1', 'target_temperature_fek', 'target_temperature') : s(`target_room_temperature_hk${n}`));
      return {
        compressor: b('compressor_on', 'heat_pump_1_on'),
        defrost: b('evaporator_defrost'),
        // The hot water flag of the operating status stands for the diverter valve.
        valve: b('is_heating_water'),
        // Only the WPMsystem reports the inverter power (kW).
        power: reading(s('current_power_consumption')),
        flow: s('flow_temperature_wp1', 'flow_temperature_wp', 'flow_temperature'),
        return: s('return_temperature_wp1', 'return_temperature'),
        volume: s('volume_stream_wp1', 'volume_stream'),
        outdoor: s('outdoor_temperature'),
        source_in: reading(s('source_temperature')),
        brine_pressure: reading(s('source_pressure')),
        heater: b('nhz_stages_running', 'emergency_heating_1_2', 'emergency_heating_1', 'electric_reheating'),
        dhw_top: s('actual_temperature_water'),
        dhw_target: s('target_temperature_water'),
        circulation: b('circulation_pump'),
        buffer_top: reading(s('actual_temperature_buffer')),
        solar_collector: reading(s('solar_collector_temperature')),
        ...(circuit ? {
          hc_flow: s(`actual_temperature_hk${n}`),
          hc_setpoint: s(`target_temperature_hk${n}`),
          hc_pump: b(`heating_circuit_${n}_pump`, `pump_on_hk${n}`),
        } : {}),
        ...(n === 1 ? { room: roomActual, room_target: roomTarget, hc_pressure: reading(s('heater_pressure')) } : { hc_room: roomActual, hc_room_target: roomTarget }),
        // THZ/LWZ units get their own operation-mode select (`operation_mode_thz`, integration after 2026.9).
        program: k('select', 'operation_mode', 'operation_mode_thz'),
        compressor_speed: reading(s('compressor_speed')),
        hot_gas: reading(s('hot_gas_temperature_wp1', 'hot_gas_temperature')),
        high_pressure: reading(s('high_pressure_wp1', 'high_pressure')),
        low_pressure: reading(s('low_pressure_wp1', 'low_pressure')),
        starts_total: reading(s('compressor_starts')),
        aux_hours: reading(s('nhz_1_2_runtime', 'electrical_booster_heating')),
      };
    },
    // Counters per use. The combined sensors (day and total) come first: the plain totals count whole kWh only.
    tiles: (p, i, ctx) => {
      const s = (...tks) => tks.map((tk) => ctx.key('stiebel_eltron_isg', 'sensor', tk)).filter((id) => id && Number.isFinite(parseFloat(ctx.state(id))));
      return {
        energy_heating: { total: s('consumed_heating', 'consumed_heating_total') },
        energy_dhw: { total: s('consumed_water_heating', 'consumed_water_heating_total') },
        heat_heating: { total: s('produced_heating', 'produced_heating_total') },
        heat_dhw: { total: s('produced_water_heating', 'produced_water_heating_total') },
        heat_cooling: { total: s('produced_cooling_total') },
        starts: { total: s('compressor_starts') },
        aux_hours: { total: s('nhz_1_2_runtime', 'electrical_booster_heating') },
      };
    },
    errors: (p, i, ctx) => [ctx.key('stiebel_eltron_isg', 'binary_sensor', 'error_status')].filter(Boolean),
    controls: (p, i, ctx) => {
      const key = (domain, ...tks) => tks.map((tk) => ctx.key('stiebel_eltron_isg', domain, tk)).find(Boolean);
      return [key('select', 'operation_mode', 'operation_mode_thz'), key('number', 'comfort_water_temperature_target', 'comfort_water_temperature_target_thz')].filter(Boolean);
    },
    details: (p, i, ctx) => ['compressor_heating', 'compressor_heating_water', 'compressor_heating_hp_1', 'cooling_runtime', 'nhz_1_runtime', 'nhz_2_runtime',
      'electrical_booster_heating', 'electrical_booster_heating_water', 'solar_runtime', 'efficiency_heating_1_12_m', 'efficiency_dhw_1_12_m',
      'efficiency_cooling_1_12_m', 'sg_ready_state']
      .map((tk) => ctx.key('stiebel_eltron_isg', 'sensor', tk)).filter((id) => id && Number.isFinite(parseFloat(ctx.state(id)))),
    // Operating mode select (WPM: emergency, ready, program, comfort, eco, water_heating; LWZ adds automatic and manual). Only eco has a chip.
    program_map: { emergency: 'none', ready: 'none', program: 'none', comfort: 'none', eco: 'eco', water_heating: 'none', automatic: 'none', manual: 'none' },
  },

  // Vaillant aroTHERM / aroTHERM plus (HMU) on the eBUS via ebusd and its Home Assistant MQTT discovery.
  // Entity ids are <topic prefix>_<circuit>_<message>[_<field>]; Home Assistant may put the device name in front
  // (sensor.heating_ebusd_hmu_…), so every lookup accepts a leading part. Circuits: hmu (outdoor unit), vwzio (hydraulic
  // station), ctlv2 / ctlv3 / ctls2 (sensoCOMFORT / multiMATIC, one message set). The buffer is not mapped: which VR 70/71
  // sensor sits in it depends on the hydraulic scheme. Status texts from RunDataStatuscode in ebusd-configuration.
  ebusd: {
    name: 'ebusd (Vaillant aroTHERM, HMU)',
    // Confirmed on an aroTHERM plus cascade with two circuits and on a single aroTHERM plus with a buffer (#189, #295).
    tested: true,
    unit_style: 'vaillant',
    // The controller reports all its circuits, inactive ones included, so the editor stub cannot count them.
    auto_circuits: false,
    detect: (ctx) => hfcEbusdInstances(ctx)[0]?.stem,
    instances: (ctx, requested) => hfcEbusdInstances(ctx, requested),
    entities: (p, i, ctx) => {
      const x = hfcEbusdStem(ctx, p);
      const e = (circuit, name) => ctx.match(new RegExp(`^sensor\\.${x}_${circuit}_${name}$`), 'mqtt');
      const h = (n) => e('hmu', n); const c = (n) => e('ctl[sv]\\d', n); const w = (n) => e('vwzio', n);
      // Writable controller values that ebusd publishes as number or select entities.
      const cd = (domain, n) => ctx.match(new RegExp(`^${domain}\\.${x}_ctl[sv]\\d_${n}$`), 'mqtt');
      return {
        mode: h('rundatastatuscode'),
        compressor: [h('rundatacompressorspeed'), h('currentcompressorutil')],
        // The hydraulic station's hot water flag, where ebusd reports it. Without it the operating state (hwc_*) tells hot water.
        // The controller's Z1ValveStatus is the zone 1 valve (open/closed), also closed in standby and while another zone heats,
        // so it is no diverter valve and stays unmapped (#155).
        valve: w('statusdhw_dhwactive'),
        power: [h('currentconsumedpower'), h('rundataelectricpowerconsumption')],
        heat: h('currentyieldpower'),
        flow: h('rundataflowtemp'),
        return: h('rundatareturntemp'),
        volume: h('buildingcircuitflow'),
        source_in: h('rundataairinlettemp'),
        outdoor: [e('broadcast', 'outsidetemp'), c('displayedoutsidetemp'), c('outsidetemp')],
        dhw_top: [c('hwcstoragetemp'), w('statusdhw_hwcstoragetemp')],
        dhw_target: [c('hwctempdesired'), cd('number', 'hwctempdesired')],
        dhw_mode: cd('select', 'hwcopmode'),
        fan_speed: h('rundatafan1speed'),
        hc_flow: c(`hc${i.hc}flowtemp`),
        hc_setpoint: c(`hc${i.hc}actualflowtempdesired`),
        hc_pump: c(`hc${i.hc}pumpstatus`),
        // Mixer movement of a mixed circuit, signed: above 0 opening, below 0 closing (VR 71, #1).
        hc_mixer_opening: c(`hc${i.hc}mixermovement`),
        // One system pressure: only for the first circuit, the further ones would copy it as hc2_pressure …
        hc_pressure: i.hc === 1 ? [h('flowpressure'), c('waterpressure')] : undefined,
        room: c(`z${i.hc}roomtemp`),
        room_target: c(`z${i.hc}actualroomtempdesired`),
        hours: h('runstatscompressorhours'),
        starts_total: h('runstatscompressorstarts'),
        aux_hours: w('immersionheaterhours'),
        energy_total: h('statelectricenergysum'),
        env_energy: h('statenvironmentenergysum'),
        compressor_speed: h('rundatacompressorspeed'),
        evap_temp: h('rundataevaporationtemp'),
        suction_temp: h('rundatacompressorinlettemp'),
        hot_gas: h('rundatacompressoroutlettemp'),
        high_pressure: h('rundatahighpressure'),
        eev: h('rundataeevpositionabs'),
        superheat: h('rundataoverheatingactualvalue'),
      };
    },
    // Lifetime counters per mode; today, month … come from their long-term statistics.
    tiles: (p, i, ctx) => {
      const x = hfcEbusdStem(ctx, p);
      const t = (name) => ({ total: ctx.match(new RegExp(`^sensor\\.${x}_hmu_${name}$`), 'mqtt') });
      return {
        energy: t('statelectricenergysum'), energy_heating: t('statelectricenergysumhc'), energy_dhw: t('statelectricenergysumhwc'),
        energy_cooling: t('statelectricenergysumcool'), env_energy: t('statenvironmentenergysum'),
        starts: t('runstatscompressorstarts'), hours: t('runstatscompressorhours'),
      };
    },
    errors: (p, i, ctx) => {
      const x = hfcEbusdStem(ctx, p);
      // The heat pump, the controller and the VR 71 answer the same error message (#1). A longer stem is another daemon's group.
      const others = [...new Set(ctx.ids.map((id) => id.match(/^(?:sensor|binary_sensor|number|select|switch)\.(.+?)_(?:hmu|vwzio|ctl[sv]\d)_/)?.[1]))]
        .filter((stem) => stem && stem !== x && stem.startsWith(`${x}_`));
      const re = new RegExp(`^sensor\\.${x}_.+_currenterror_error$`);
      const ids = ctx.ids.filter((id) => re.test(id) && !others.some((stem) => id.startsWith(`sensor.${stem}_`))
        && (!ctx.registry[id] || ctx.registry[id].platform === 'mqtt') && (!ctx.device || ctx.registry[id]?.device_id === ctx.device));
      const hmu = `sensor.${x}_hmu_currenterror_error`;
      return [...ids.filter((id) => id === hmu), ...ids.filter((id) => id !== hmu).sort()];
    },
    // Pre-run, overrun and shutdown keep the mode of their phase; the compressor speed tells whether it runs.
    // Fault codes (fan1_blocked, building_circuit_flow_too_low …) stay unmapped and show as text.
    mode_map: {
      standby: 'idle', frost_protect: 'frost', compressor_oil_heating_active: 'idle', air_purging_program_active: 'circulate',
      deicing_active: 'defrost',
      heat_prerun: 'heating', heat_compressor_active: 'heating', heat_overrun: 'heating', heat_compressor_shutdown: 'heating',
      heat_immersion_heater_active: 'heating', heat_immersion_heater_shutdown: 'heating',
      heat_compressor_blocked: 'blocked', heat_immersion_heater_blocked: 'blocked',
      hwc_prerun: 'dhw', hwc_compressor_active: 'dhw', hwc_overrun: 'dhw', hwc_immersion_heater_active: 'dhw', hwc_immersion_heater_shutdown: 'dhw',
      hwc_compressor_blocked: 'blocked', hwc_immersion_heater_blocked: 'blocked',
      cool_prerun: 'cooling', cool_compressor_active: 'cooling', cool_overrun: 'cooling', cool_compressor_shutdown: 'cooling',
      cool_compressor_blocked: 'blocked',
    },
  },

  // Samsung EHS (Mono, Split, TDM) over the NASA bus with the ESPHome component "esphome-samsung-nasa" by Beormund.
  // ESPHome entity ids are <node>_<name slug>, and the names are set in each user's YAML. The candidates are the names
  // of Beormund's example.yaml and README, then those of the installation the preset was tested on (EHS Mono AE050JXYDEH).
  samsung: {
    name: 'Samsung EHS (esphome-samsung-nasa)',
    tested: true,
    // The EHS Mono drawing also stands for Split installations, whose outdoor unit the integration does not identify (#151).
    unit_style: 'samsung',
    // The primary water pump (0x4089) belongs to the heat pump (outdoor unit of the Mono, hydro unit of the Split) and runs for hot water, too.
    primary_pump: true,
    auto_circuits: false,
    // The 3-way valve (0x4067) and the error code (0x8235) together: a plain "3-way valve" alone could be any ESPHome node.
    detect: (ctx) => {
      const re = /^sensor\.(.+)_3_way_valve(?:_position)?$/;
      const id = ctx.match(re, 'esphome');
      const p = id && id.match(re)[1];
      return p && [`sensor.${p}_error_code`, `sensor.${p}_system_error_status`].some((e) => ctx.ids.includes(e)) ? p : undefined;
    },
    entities: (p, i) => {
      const s = (...ks) => ks.map((k) => `sensor.${p}_${k}`);
      const b = (...ks) => ks.map((k) => `binary_sensor.${p}_${k}`);
      const z = i.hc;
      // No hc_pump: the primary water pump (0x4089) also runs for hot water, so the circuit follows the valve instead.
      return {
        compressor: b('compressor_status', 'compressor').concat(s('compressor_frequency')),
        defrost: b('defrost', 'defrost_mode', 'defrost_status'),
        valve: s('3_way_valve', '3_way_valve_position'),
        heater: b('backup_heater'),
        power: s('power_consumed_last_minute', 'power'),
        heat: s('power_produced_last_minute', 'heat_produced_last_minute'),
        flow: s('flow_temp_out', 'flow_temperature'),
        return: s('flow_temp_return', 'return_temperature'),
        volume: s('flow_rate_sensor', 'water_flow'),
        outdoor: s('outdoor_temperature'),
        dhw_top: s('dhw_temperature', 'dhw_tank_temperature'),
        dhw_target: [`number.${p}_dhw_target_temperature`, `sensor.${p}_dhw_target_temperature`],
        dhw_heater: b('booster_heater'),
        // Without a mixing kit zone 1 is fed straight from the heat pump outlet.
        hc_flow: z === 1 ? s('flow_temp_out', 'flow_temperature') : undefined,
        hc_setpoint: z === 1 ? s('water_law_target_flow_temperature', 'water_target_in_use') : undefined,
        room: s(`zone_${z}_indoor_temp`),
        room_target: [`number.${p}_zone_${z}_target_temp`],
        program: [`switch.${p}_away_mode`, `switch.${p}_outing_mode`],
        energy_today: s('daily_energy_consumed'),
        energy_total: s('total_consumed_energy', 'energy'),
        heat_total: s('total_produced_energy', 'heat_produced_total'),
        compressor_speed: s('compressor_frequency'),
        hot_gas: s('discharge_temperature'),
        eev: s('expansion_valve_opening'),
      };
    },
    errors: (p) => [`sensor.${p}_error_code`, `sensor.${p}_system_error_status`],
    // The text sensor for 0x8235 says "No Error"; any other text is a fault. As a plain sensor it is the number (0 = none).
    error_ok: ['No Error'],
    // Away (outing) mode is a switch.
    program_map: { on: 'holiday', off: 'none' },
    // The template sensors of Beormund's example.yaml give today; the NASA counters (0x8414, 0x4427) the totals.
    tiles: (p) => {
      const s = (...ks) => ks.map((k) => `sensor.${p}_${k}`);
      return {
        energy: { today: s('daily_energy_consumed'), total: s('total_consumed_energy', 'energy') },
        heat: { today: s('daily_heat_generated'), total: s('total_produced_energy', 'heat_produced_total') },
        cop_total: { today: s('cop_daily'), total: s('cop_total') },
      };
    },
  },

  // Daikin Altherma / ROTEX through ESPAltherma (ESP32 on the X10A port, MQTT device discovery, beta branch, #254). Every value of
  // the model definition becomes <prefix>_<label>: the label lowercased, letters and digits only, spaces as underscores. The labels
  // stay English in every language and are the same in the Altherma 3, LT, EPRA, ERGA and EBLA definitions. The prefix is the
  // base topic ("espaltherma"). Only the values a user uncomments in the definition exist, so every key is optional.
  espaltherma: {
    name: 'Daikin Altherma (ESPAltherma)',
    // The water pump of the indoor unit (or monobloc) also runs for hot water.
    primary_pump: true,
    auto_circuits: false,
    // No superheat or subcooling from the pipe sensors: on an EPRA12EAV3 the suction pipe (R3T) read below the saturation
    // temperature at low pressure, so their differences mean nothing (#323).
    refrigerant_derived: false,
    // Leaving water after the backup heater together with the inverter frequency: both belong to every Altherma definition.
    detect: (ctx) => {
      const re = /^sensor\.(.+)_leaving_water_temp_after_buh_r2t$/;
      const id = ctx.match(re, 'mqtt');
      const p = id && id.match(re)[1];
      return p && ctx.ids.includes(`sensor.${p}_inv_frequency_rps`) ? p : undefined;
    },
    entities: (p, i) => {
      const s = (...ks) => ks.map((k) => `sensor.${p}_${k}`);
      const b = (...ks) => ks.map((k) => `binary_sensor.${p}_${k}`);
      // No mode: "I/U operation mode" names the demand (Heating, DHW …) and may stay on it while the compressor pauses. The
      // compressor frequency tells running, the 3-way valve hot water. Only circuit 1: the main zone's leaving-water target.
      return {
        compressor: s('inv_frequency_rps'),
        compressor_speed: s('inv_frequency_rps'),
        defrost: b('defrost_operation'),
        valve: b('3way_valveondhwoffspace'),
        // Backup heater in the flow (two steps) and booster heater in the tank.
        heater: b('buh_step1'),
        dhw_heater: b('bsh'),
        // ESPAltherma's own statistics: electrical input estimated from the inverter current, heat from flow rate and spread.
        power: s('stats_electrical_input_estimated_kw'),
        heat: s('stats_heat_output_kw'),
        flow: s('leaving_water_temp_after_buh_r2t', 'leaving_water_temp_before_buh_r1t'),
        return: s('inlet_water_tempr4t'),
        volume: s('flow_sensor_lmin'),
        outdoor: s('r1toutdoor_air_temp'),
        fan_speed: s('fan_1_step'),
        dhw_top: s('dhw_tank_temp_r5t'),
        dhw_target: [`number.${p}_hot_water_target`, `sensor.${p}_dhw_setpoint`],
        circulation: b('circulation_pump_operation'),
        hc_setpoint: i.hc === 1 ? s('lw_setpoint_main') : undefined,
        hc_pressure: i.hc === 1 ? s('water_pressure') : undefined,
        room: i.hc === 1 ? s('indoor_ambient_temp_r1t') : undefined,
        room_target: i.hc === 1 ? s('rt_setpoint') : undefined,
        starts_today: s('stats_compressor_starts_today'),
        cop_heating_today: s('stats_cop_today_heating'),
        cop_dhw_today: s('stats_cop_today_hot_water'),
        hot_gas: s('discharge_pipe_tempr2t'),
        suction_temp: s('suction_pipe_tempr3t'),
        // Evaporation and condensation are the saturation temperatures at low and high pressure, in every mode. The heat exchanger
        // mid temperature (R5T) is only the fallback: it is the evaporation while heating, but the condensation while cooling.
        evap_temp: s('low_pressuret', 'heat_exchanger_midtempr5t'),
        cond_temp: s('high_pressuret'),
        liquid_temp: s('liquid_pipe_tempr6t', 'liquid_pipe_temp'),
      };
    },
    // Error codes: " 0" (a number after trimming) is no error, a code such as "U4" or "A1" is one.
    errors: (p) => [`sensor.${p}_iu_error_code`, `sensor.${p}_ou_error_code`],
    error_ok: ['0'],
    // The statistics count from midnight; week and month come from their long-term statistics.
    tiles: (p) => {
      const s = (...ks) => ks.map((k) => `sensor.${p}_stats_${k}`);
      return {
        energy_heating: { today: s('electricity_today_heating_kwh') }, energy_dhw: { today: s('electricity_today_hot_water_kwh') },
        energy_cooling: { today: s('electricity_today_cooling_kwh') },
        heat_heating: { today: s('heat_today_heating_kwh') }, heat_dhw: { today: s('heat_today_hot_water_kwh') }, heat_cooling: { today: s('heat_today_cooling_kwh') },
      };
    },
  },
};

/* ------------------------------------------------------------------ */
/* Translations                                                        */
/* ------------------------------------------------------------------ */
// Built-in languages: one entry here, one block in HFC_I18N (card texts) and one in HFC_EDITOR (editor labels), see
// docs/TRANSLATING.md. The value is the name of the language in that language. A language may be translated in part:
// every missing text falls back to English. `npm run i18n:check` verifies the blocks.
const HFC_LANGUAGES = { en: 'English', de: 'Deutsch', pl: 'Polski', sk: 'Slovenčina', cs: 'Čeština', nl: 'Nederlands' };

const HFC_I18N = {
  en: {
    not_found: 'No entities of this preset found. Check the integration and the prefix, or open the card editor.',
    start: 'No supported heat pump integration found. Open the card editor to pick a preset or to map your entities.', start_link: 'Supported integrations',
    title: 'Heat pump', heat_pump: 'Heat pump', boiler: 'Boiler', boiler_off: 'Boiler off', dhw: 'Hot water', buffer: 'Buffer', series_tank: 'Series buffer', combined_tank: 'Combined storage', heating_zone: 'Heating', fresh_water_station: 'Fresh-water station', heating_circuit: 'Heating circuit',
    house: 'Rooms', room: 'Room', room_target: 'Room target', humidity: 'Humidity', dew_point: 'Dew point', dew_margin: 'Dew-point margin', dew_warning: 'condensation risk', flow_short: 'Flow', comfort_below: 'below target', comfort_on: 'at target', comfort_above: 'above target', running: 'running', compressor_off: 'Compressor off', source_in: 'Air inlet', outdoor: 'Outdoor',
    energy_missing: 'Energy dashboard: no power sensor for {sources}; energy counters alone cannot show live flow.',
    brine_in: 'Brine in', brine_out: 'Brine out', well_in: 'Well in', well_out: 'Well out',
    details: 'Details', sec_operation: 'Operation', sec_hydraulic: 'Hydraulic pressures', sec_refrigerant: 'Refrigerant circuit', sec_cutouts: 'Cut-outs (number of events)', sec_more: 'More',
    diagnostic_copy: 'Copy diagnostic report', diagnostic_copied: 'Diagnostic report copied', diagnostic_failed: 'Could not copy diagnostic report',
    fullscreen_open: 'Open full screen', fullscreen_close: 'Close full screen',
    det: {
      hours: 'Compressor hours', starts_total: 'Compressor starts total', aux_hours: 'Heater hours', energy_total: 'Electricity total',
      cutout_high_pressure: 'High-pressure cut-outs', cutout_low_pressure: 'Low-pressure cut-outs', cutout_temperature: 'Temperature cut-outs',
      env_energy: 'Environmental energy total', heat_total: 'Heat total', cop_total: 'COP total', compressor_speed: 'Compressor', evap_temp: 'Evaporation', cond_temp: 'Condensation',
      suction_temp: 'Suction gas', hot_gas: 'Hot gas', liquid_temp: 'Liquid line', low_pressure: 'Low pressure', high_pressure: 'High pressure',
      eev: 'Expansion valve', superheat: 'Superheat', subcooling: 'Subcooling',
    },
    source_flow: 'Source', target: 'Target', curve_offset: 'curve', curve_shift: 'shift', mixer: 'Mixer', mixer_opening: 'opening', mixer_closing: 'closing', return_short: 'RL', error: 'Error', circulation: 'Circ.', circulation_from: 'from', circulation_until: 'until', valve_dhw: 'DHW', solar: 'Solar',
    brine_pressure: 'Brine pressure', hc_pressure: 'Heating pressure', pressure_normal: 'normal', pressure_warning: 'warning', pressure_critical: 'critical',
    timeline_title: 'Last {h} hours', timeline_gap: 'No data', timeline_aria: 'Operating mode of the last {h} hours. Arrow keys select a period.',
    run_series: 'run {n} since {t}', run_pause: 'pause before {d}', run_partial: 'began before the timeline', run_ongoing: 'still running', run_phase: 'operating period, no compressor data', run_close: 'Close', run_flow: 'Flow', run_reached: 'reached', run_missed: '{d} K below', run_heater: 'Heater rod', run_on: 'on', run_off: 'off',
    programs: { eco: 'Eco', night: 'Night', party: 'Party', holiday: 'Holiday' },
    sg_ready: { normal: 'SG normal', blocked: 'Utility lock', boost: 'SG boost', forced: 'SG forced on' },
    valve_heating: 'Heating', valve_cooling: 'Cooling', bypass: 'Bypass', pv: 'PV', pv_boost: 'PV surplus', battery: 'Battery', grid: 'Grid',
    stat_cop_heating: 'COP heating today', stat_cop_dhw: 'COP DHW today', stat_energy: 'Energy today',
    stat_starts: 'Starts today', stat_spread: 'Spread', stat_volume: 'Flow rate', stat_heat: 'Heat output', pv_share: 'PV',
    tiles: {
      cop_live: 'COP live', cop_heating: 'COP heating', cop_dhw: 'COP DHW', cop_cooling: 'EER cooling', cop_total: 'COP total', spf: 'SPF (year)',
      energy: 'Electricity', env_energy: 'Environmental energy', energy_heating: 'Electricity heating', energy_dhw: 'Electricity DHW', energy_cooling: 'Electricity cooling',
      energy_defrost: 'Electricity defrost', energy_standby: 'Standby', energy_aux: 'Electricity heater',
      heat: 'Heat', heat_heating: 'Heat heating', heat_dhw: 'Heat DHW', heat_cooling: 'Cooling output', heat_defrost: 'Heat defrost',
      starts: 'Compressor starts', cycles_heating: 'Heating cycles', cycles_dhw: 'DHW cycles', cycles_cooling: 'Cooling cycles', defrosts: 'Defrosts',
      hours: 'Compressor hours', hours_per_start: 'Runtime per start', load_classes: 'Load classes 1-5', aux_hours: 'Heater hours', aux_starts: 'Heater starts',
      spread: 'Spread', volume: 'Flow rate', heat_estimated: 'Heat output', power: 'Power', heat_live: 'Heat output', compressor_speed: 'Compressor',
      source_spread: 'Source spread', outdoor: 'Outdoor', dhw_top: 'DHW tank', room: 'Room', brine_pressure: 'Brine pressure', hc_pressure: 'Heating pressure', hc_spread: 'Circuit spread', pv_share: 'PV share today',
      pv_boost_share: 'PV surplus share of heating', pv_production: 'PV yield', solar_thermal: 'Solar thermal', cost: 'Cost', dhw_loss: 'DHW standby loss',
    },
    periods: { now: 'now', today: 'today', yesterday: 'yesterday', week: 'week', month: 'month', year: 'year', total: 'total' },
    modes: {
      idle: 'Standby', heating: 'Heating', dhw: 'Hot water', cooling: 'Cooling', defrost: 'Defrost', blocked: 'Blocked',
      frost: 'Frost protection', circulate: 'Circulating', off: 'Off', legionella: 'Legionella', trailing: 'Run-on',
    },
  },
  de: {
    not_found: 'Keine Entitäten dieser Voreinstellung gefunden. Integration und Präfix prüfen oder den Karteneditor öffnen.',
    start: 'Keine unterstützte Wärmepumpen-Integration gefunden. Im Karteneditor eine Voreinstellung wählen oder die Entitäten selbst zuordnen.', start_link: 'Unterstützte Integrationen',
    title: 'Wärmepumpe', heat_pump: 'Wärmepumpe', boiler: 'Heizkessel', boiler_off: 'Kessel aus', dhw: 'Warmwasser', buffer: 'Puffer', series_tank: 'Reihenpuffer', combined_tank: 'Kombispeicher', heating_zone: 'Heizung', fresh_water_station: 'Frischwasserstation', heating_circuit: 'Heizkreis',
    house: 'Wohnräume', room: 'Raum', room_target: 'Raum-Soll', humidity: 'Luftfeuchte', dew_point: 'Taupunkt', dew_margin: 'Taupunktabstand', dew_warning: 'Kondensationsgefahr', flow_short: 'VL', comfort_below: 'unter Soll', comfort_on: 'im Soll', comfort_above: 'über Soll', running: 'läuft', compressor_off: 'Verdichter aus', source_in: 'Luft-Eintritt', outdoor: 'Außen',
    energy_missing: 'Energie-Dashboard: kein Leistungssensor für {sources}; Energiezähler allein zeigen keinen aktuellen Fluss.',
    brine_in: 'Sole ein', brine_out: 'Sole aus', well_in: 'Brunnen ein', well_out: 'Brunnen aus',
    details: 'Details', sec_operation: 'Betrieb', sec_hydraulic: 'Hydraulikdrücke', sec_refrigerant: 'Kältekreis', sec_cutouts: 'Abschaltungen (Anzahl der Ereignisse)', sec_more: 'Weitere',
    diagnostic_copy: 'Diagnosebericht kopieren', diagnostic_copied: 'Diagnosebericht kopiert', diagnostic_failed: 'Diagnosebericht konnte nicht kopiert werden',
    fullscreen_open: 'Vollbild öffnen', fullscreen_close: 'Vollbild schließen',
    det: {
      hours: 'Betriebsstunden Verdichter', starts_total: 'Verdichterstarts gesamt', aux_hours: 'Betriebsstunden Heizstab', energy_total: 'Strom gesamt',
      cutout_high_pressure: 'Hochdruck-Abschaltungen', cutout_low_pressure: 'Niederdruck-Abschaltungen', cutout_temperature: 'Temperatur-Abschaltungen',
      env_energy: 'Umweltenergie gesamt', heat_total: 'Wärme gesamt', cop_total: 'COP gesamt', compressor_speed: 'Verdichter', evap_temp: 'Verdampfung', cond_temp: 'Kondensation',
      suction_temp: 'Sauggas', hot_gas: 'Heißgas', liquid_temp: 'Flüssigkeitsleitung', low_pressure: 'Niederdruck', high_pressure: 'Hochdruck',
      eev: 'Expansionsventil', superheat: 'Überhitzung', subcooling: 'Unterkühlung',
    },
    source_flow: 'Quelle', target: 'Soll', curve_offset: 'Kurve', curve_shift: 'Verschiebung', mixer: 'Mischer', mixer_opening: 'öffnet', mixer_closing: 'schließt', return_short: 'RL', error: 'Fehler', circulation: 'Zirk.', circulation_from: 'ab', circulation_until: 'bis', valve_dhw: 'WW', solar: 'Solar',
    brine_pressure: 'Soledruck', hc_pressure: 'Heizungsdruck', pressure_normal: 'normal', pressure_warning: 'Warnung', pressure_critical: 'kritisch',
    timeline_title: 'Letzte {h} Stunden', timeline_gap: 'Keine Daten', timeline_aria: 'Betriebsart der letzten {h} Stunden. Mit den Pfeiltasten einen Zeitraum wählen.',
    run_series: '{n}. Lauf seit {t}', run_pause: 'Pause davor {d}', run_partial: 'begann vor der Zeitleiste', run_ongoing: 'läuft noch', run_phase: 'Betriebsphase, ohne Verdichterdaten', run_close: 'Schließen', run_flow: 'Vorlauf', run_reached: 'erreicht', run_missed: '{d} K darunter', run_heater: 'Heizstab', run_on: 'an', run_off: 'aus',
    programs: { eco: 'Eco', night: 'Nacht', party: 'Party', holiday: 'Urlaub' },
    sg_ready: { normal: 'SG normal', blocked: 'EVU-Sperre', boost: 'SG-Anhebung', forced: 'SG-Zwangsbetrieb' },
    valve_heating: 'Heizen', valve_cooling: 'Kühlen', bypass: 'Bypass', pv: 'PV', pv_boost: 'PV-Überschuss', battery: 'Akku', grid: 'Netz',
    stat_cop_heating: 'COP Heizen heute', stat_cop_dhw: 'COP WW heute', stat_energy: 'Verbrauch heute',
    stat_starts: 'Starts heute', stat_spread: 'Spreizung', stat_volume: 'Volumenstrom', stat_heat: 'Wärmeleistung', pv_share: 'PV',
    tiles: {
      cop_live: 'COP live', cop_heating: 'COP Heizen', cop_dhw: 'COP WW', cop_cooling: 'EER Kühlen', cop_total: 'COP gesamt', spf: 'JAZ',
      energy: 'Strom', env_energy: 'Umweltenergie', energy_heating: 'Strom Heizen', energy_dhw: 'Strom WW', energy_cooling: 'Strom Kühlen',
      energy_defrost: 'Strom Abtauen', energy_standby: 'Standby', energy_aux: 'Strom Heizstab',
      heat: 'Wärme', heat_heating: 'Wärme Heizen', heat_dhw: 'Wärme WW', heat_cooling: 'Kälte', heat_defrost: 'Wärme Abtauen',
      starts: 'Verdichterstarts', cycles_heating: 'Heizzyklen', cycles_dhw: 'WW-Zyklen', cycles_cooling: 'Kühlzyklen', defrosts: 'Abtauungen',
      hours: 'Verdichterstunden', hours_per_start: 'Laufzeit pro Start', load_classes: 'Lastklassen 1-5', aux_hours: 'Heizstab-Stunden', aux_starts: 'Heizstab-Starts',
      spread: 'Spreizung', volume: 'Volumenstrom', heat_estimated: 'Wärmeleistung', power: 'Leistung', heat_live: 'Wärmeleistung', compressor_speed: 'Verdichter',
      source_spread: 'Spreizung Quelle', outdoor: 'Außen', dhw_top: 'WW-Speicher', room: 'Raum', brine_pressure: 'Soledruck', hc_pressure: 'Heizungsdruck', hc_spread: 'Spreizung Heizkreis', pv_share: 'PV-Anteil heute',
      pv_boost_share: 'PV-Überschuss-Anteil am Heizen', pv_production: 'PV-Ertrag', solar_thermal: 'Solarthermie', cost: 'Kosten', dhw_loss: 'WW-Standbyverlust',
    },
    periods: { now: 'aktuell', today: 'heute', yesterday: 'gestern', week: 'Woche', month: 'Monat', year: 'Jahr', total: 'gesamt' },
    modes: {
      idle: 'Bereit', heating: 'Heizen', dhw: 'Warmwasser', cooling: 'Kühlen', defrost: 'Abtauen', blocked: 'Sperrzeit',
      frost: 'Frostschutz', circulate: 'Umwälzen', off: 'Aus', legionella: 'Legionellenschutz', trailing: 'Nachlauf',
    },
  },
  
// Polish by Krzysztonek
  pl: {
    not_found: 'Nie znaleziono encji dla tego presetu. Sprawdź integrację i prefiks lub otwórz edytor karty.',
    start: 'Nie znaleziono obsługiwanej integracji pompy ciepła. Otwórz edytor karty, aby wybrać preset lub zmapować encje.', start_link: 'Obsługiwane integracje',
    title: 'Pompa ciepła', heat_pump: 'Pompa ciepła', dhw: 'C.W.U.', buffer: 'Bufor', series_tank: 'Bufor szeregowy', combined_tank: 'Zbiornik kombi', heating_zone: 'Ogrzewanie', fresh_water_station: 'Stacja świeżej wody', heating_circuit: 'Obieg grzewczy',
    house: 'Pokoje', room: 'Pokój', room_target: 'Temp. docelowa pokoju', humidity: 'Wilgotność', dew_point: 'Punkt rosy', dew_margin: 'Margines punktu rosy', dew_warning: 'ryzyko kondensacji', flow_short: 'Zasilanie', comfort_below: 'poniżej celu', comfort_on: 'w celu', comfort_above: 'powyżej celu', running: 'praca', compressor_off: 'Sprężarka wył.', source_in: 'Wlot powietrza', outdoor: 'Zewnątrz',
    energy_missing: 'Panel energii: brak czujnika mocy dla {sources}; same liczniki energii nie pokazują przepływu na żywo.',
    brine_in: 'Solanka wejście', brine_out: 'Solanka wyjście', well_in: 'Woda gruntowa wejście', well_out: 'Woda gruntowa wyjście',
    details: 'Szczegóły', sec_operation: 'Praca', sec_hydraulic: 'Ciśnienia hydrauliczne', sec_refrigerant: 'Obieg czynnika chłodniczego', sec_cutouts: 'Wyłączenia ochronne (liczba zdarzeń)', sec_more: 'Więcej',
    diagnostic_copy: 'Kopiuj raport diagnostyczny', diagnostic_copied: 'Skopiowano raport diagnostyczny', diagnostic_failed: 'Nie udało się skopiować raportu diagnostycznego',
    fullscreen_open: 'Otwórz na pełnym ekranie', fullscreen_close: 'Zamknij pełny ekran',
    det: {
      hours: 'Czas pracy sprężarki', starts_total: 'Liczba uruchomień sprężarki', aux_hours: 'Czas pracy grzałki', energy_total: 'Energia elektryczna ogółem',
      cutout_high_pressure: 'Wyłączenia wysokie ciśnienie', cutout_low_pressure: 'Wyłączenia niskie ciśnienie', cutout_temperature: 'Wyłączenia temperatura',
      env_energy: 'Energia z otoczenia ogółem', heat_total: 'Ciepło ogółem', cop_total: 'COP całkowity', compressor_speed: 'Sprężarka', evap_temp: 'Parowanie', cond_temp: 'Kondensacja',
      suction_temp: 'Gaz ssawny', hot_gas: 'Gorący gaz', liquid_temp: 'Linia cieczowa', low_pressure: 'Niskie ciśnienie', high_pressure: 'Wysokie ciśnienie',
      eev: 'Zawór rozprężny', superheat: 'Przegrzanie', subcooling: 'Dochłodzenie',
    },
    boiler: 'Kocioł', boiler_off: 'Kocioł wył.', mixer: 'Mieszacz', mixer_opening: 'otwieranie', mixer_closing: 'zamykanie',
    source_flow: 'Źródło', target: 'Cel', curve_offset: 'krzywa', curve_shift: 'przesunięcie', return_short: 'Powrót', error: 'Błąd', circulation: 'Cyrk.', circulation_from: 'od', circulation_until: 'do', valve_dhw: 'C.W.U.', solar: 'Kolektor słoneczny',
    brine_pressure: 'Ciśnienie solanki', hc_pressure: 'Ciśnienie c.o.', pressure_normal: 'normalne', pressure_warning: 'ostrzeżenie', pressure_critical: 'krytyczne',
    timeline_title: 'Ostatnie {h} godz.', timeline_gap: 'Brak danych', timeline_aria: 'Tryb pracy z ostatnich {h} godzin. Strzałki wybierają okres.',
    run_series: 'cykl {n} od {t}', run_pause: 'przerwa przed {d}', run_partial: 'rozpoczęto przed osiä czasu', run_ongoing: 'nadal trwa', run_phase: 'okres pracy, brak danych sprężarki', run_close: 'Zamknij', run_flow: 'Zasilanie', run_reached: 'osiągnięto', run_missed: '{d} K poniżej', run_heater: 'Grzałka elektryczna', run_on: 'włączona', run_off: 'wyłączona',
    programs: { eco: 'Eco', night: 'Noc', party: 'Party', holiday: 'Wakacje' },
    sg_ready: { normal: 'SG normalny', blocked: 'Blokada dostawcy', boost: 'SG podbicie', forced: 'SG wymuszenie' },
    valve_heating: 'Ogrzewanie', valve_cooling: 'Chłodzenie', bypass: 'Bypass', pv: 'PV', pv_boost: 'Nadwyżka PV', battery: 'Bateria', grid: 'Sieć',
    stat_cop_heating: 'COP ogrzewania dzisiaj', stat_cop_dhw: 'COP C.W.U. dzisiaj', stat_energy: 'Energia dzisiaj',
    stat_starts: 'Uruchomienia dzisiaj', stat_spread: 'Różnica temp.', stat_volume: 'Przepływ', stat_heat: 'Moc grzewcza', pv_share: 'PV',
    tiles: {
      cop_live: 'COP na żywo', cop_heating: 'COP ogrzewania', cop_dhw: 'COP C.W.U.', cop_cooling: 'EER chłodzenia', cop_total: 'COP całkowity', spf: 'SPF (roczny)',
      energy: 'Energia elektryczna', env_energy: 'Energia z otoczenia', energy_heating: 'Energia ogrzewanie', energy_dhw: 'Energia C.W.U.', energy_cooling: 'Energia chłodzenie',
      energy_defrost: 'Energia odszranianie', energy_standby: 'Czuwanie', energy_aux: 'Energia grzałka',
      heat: 'Ciepło', heat_heating: 'Ciepło ogrzewanie', heat_dhw: 'Ciepło C.W.U.', heat_cooling: 'Moc chłodnicza', heat_defrost: 'Ciepło odszranianie',
      starts: 'Uruchomienia sprężarki', cycles_heating: 'Cykle ogrzewania', cycles_dhw: 'Cykle C.W.U.', cycles_cooling: 'Cykle chłodzenia', defrosts: 'Odszraniania',
      hours: 'Czas pracy sprężarki', hours_per_start: 'Czas pracy na cykl', load_classes: 'Klasy obciążenia 1-5', aux_hours: 'Czas pracy grzałki', aux_starts: 'Uruchomienia grzałki',
      spread: 'Różnica temp.', volume: 'Przepływ', heat_estimated: 'Moc grzewcza', power: 'Moc pobierana', heat_live: 'Moc grzewcza', compressor_speed: 'Sprężarka',
      source_spread: 'Różnica temp. źródła', outdoor: 'Zewnątrz', dhw_top: 'Zbiornik C.W.U.', room: 'Pokój', brine_pressure: 'Ciśnienie solanki', hc_pressure: 'Ciśnienie c.o.', pv_share: 'Udział PV dzisiaj',
      pv_boost_share: 'Udział nadwyżki PV w ogrzewaniu', pv_production: 'Produkcja PV', solar_thermal: 'Kolektor słoneczny', cost: 'Koszt', dhw_loss: 'Strata postojowa C.W.U.',
    },
    periods: { now: 'teraz', today: 'dzisiaj', yesterday: 'wczoraj', week: 'tydzień', month: 'miesiąc', year: 'rok', total: 'łącznie' },
    modes: {
      idle: 'Czuwanie', heating: 'Ogrzewanie', dhw: 'C.W.U.', cooling: 'Chłodzenie', defrost: 'Odszranianie', blocked: 'Zablokowano',
      frost: 'Ochrona przed mrozem', circulate: 'Cyrkulacja', off: 'Wyłączono', legionella: 'Legionella', trailing: 'Wybieg pompy',
    },
  },
  
  // Slovak and Czech by Havinko1991 (#177, #182).
  sk: {
    not_found: 'Nenašli sa žiadne entity tejto predvoľby. Skontrolujte integráciu a predponu, alebo otvorte editor karty.',
    start: 'Nenašla sa žiadna podporovaná integrácia tepelného čerpadla. Otvorte editor karty a vyberte predvoľbu alebo priraďte svoje entity.', start_link: 'Podporované integrácie',
    title: 'Tepelné čerpadlo', heat_pump: 'Tepelné čerpadlo', dhw: 'Teplá voda', buffer: 'Akumulačný zásobník', series_tank: 'Sériový akumulačný zásobník', combined_tank: 'Kombinovaný zásobník', heating_zone: 'Vykurovanie', fresh_water_station: 'Čerstvá voda (stanica)', heating_circuit: 'Vykurovací okruh',
    house: 'Miestnosti', room: 'Miestnosť', room_target: 'Cieľová teplota', humidity: 'Vlhkosť', dew_point: 'Rosný bod', dew_margin: 'Odstup od rosného bodu', dew_warning: 'riziko kondenzácie', flow_short: 'Prívod', comfort_below: 'pod cieľom', comfort_on: 'na cieli', comfort_above: 'nad cieľom', running: 'beží', compressor_off: 'Kompresor vypnutý', source_in: 'Prívod vzduchu', outdoor: 'Vonku',
    energy_missing: 'Energetický panel: chýba senzor výkonu pre {sources}; samotné merače energie nedokážu zobraziť aktuálny prietok.',
    brine_in: 'Vstup nemrznúcej zmesi', brine_out: 'Výstup nemrznúcej zmesi', well_in: 'Vstup zo studne', well_out: 'Výstup do studne',
    details: 'Podrobnosti', sec_operation: 'Prevádzka', sec_hydraulic: 'Hydraulické tlaky', sec_refrigerant: 'Chladiaci okruh', sec_cutouts: 'Vypnutia (počet udalostí)', sec_more: 'Viac',
    diagnostic_copy: 'Kopírovať diagnostickú správu', diagnostic_copied: 'Diagnostická správa bola skopírovaná', diagnostic_failed: 'Nepodarilo sa skopírovať diagnostickú správu',
    fullscreen_open: 'Otvoriť na celú obrazovku', fullscreen_close: 'Zatvoriť celú obrazovku',
    det: {
      hours: 'Prevádzkové hodiny kompresora', starts_total: 'Celkový počet štartov kompresora', aux_hours: 'Hodiny prídavného ohrevu', energy_total: 'Celková elektrina',
      cutout_high_pressure: 'Vysokotlakové vypnutia', cutout_low_pressure: 'Nízkotlakové vypnutia', cutout_temperature: 'Teplotné vypnutia',
      env_energy: 'Celková energia prostredia', heat_total: 'Celkové vyrobené teplo', cop_total: 'Celkové COP', compressor_speed: 'Kompresor', evap_temp: 'Odparovanie', cond_temp: 'Kondenzácia',
      suction_temp: 'Nasávaný plyn', hot_gas: 'Horúci plyn', liquid_temp: 'Kvapalinové potrubie', low_pressure: 'Nízky tlak', high_pressure: 'Vysoký tlak',
      eev: 'Expanzný ventil', superheat: 'Prehriatie', subcooling: 'Podchladenie',
    },
    boiler: 'Bojler', boiler_off: 'Bojler vypnutý', mixer: 'Zmiešavač', mixer_opening: 'zmiešavač sa otvára', mixer_closing: 'zmiešavač sa zatvára',
    source_flow: 'Zdroj', target: 'Cieľ', curve_offset: 'krivka', curve_shift: 'posun', return_short: 'RL', error: 'Chyba', circulation: 'Cirk.', circulation_from: 'od', circulation_until: 'do', valve_dhw: 'TÚV', solar: 'Solár',
    brine_pressure: 'Tlak nemrznúcej zmesi', hc_pressure: 'Tlak vykurovania', pressure_normal: 'normálny', pressure_warning: 'varovanie', pressure_critical: 'kritický',
    timeline_title: 'Posledných {h} hodín', timeline_gap: 'Žiadne dáta', timeline_aria: 'Prevádzkový režim za posledných {h} hodín. Šípkami vyberte obdobie.',
    run_series: '{n}. beh od {t}', run_pause: 'prestávka predtým {d}', run_partial: 'začal pred časovou osou', run_ongoing: 'stále beží', run_phase: 'prevádzková fáza, bez údajov kompresora', run_close: 'Zavrieť', run_flow: 'Prívod', run_reached: 'dosiahnutý', run_missed: '{d} K pod', run_heater: 'Vykurovacia tyč', run_on: 'zap', run_off: 'vyp',
    programs: { eco: 'Eko', night: 'Nočný', party: 'Párty', holiday: 'Dovolenka' },
    sg_ready: { normal: 'SG normálna prevádzka', blocked: 'Blokovanie distribučnou sieťou', boost: 'SG zvýšená prevádzka', forced: 'SG vynútená prevádzka' },
    valve_heating: 'Vykurovanie', valve_cooling: 'Chladenie', bypass: 'Obtok (Bypass)', pv: 'FVE', pv_boost: 'Prebytok FVE', battery: 'Batéria', grid: 'Sieť',
    stat_cop_heating: 'COP vykurovania dnes', stat_cop_dhw: 'COP TÚV dnes', stat_energy: 'Energia dnes',
    stat_starts: 'Štarty dnes', stat_spread: 'Rozpätie', stat_volume: 'Prietok', stat_heat: 'Tepelný výkon', pv_share: 'FVE',
    tiles: {
      cop_live: 'Aktuálne COP', cop_heating: 'COP vykurovania', cop_dhw: 'COP TÚV', cop_cooling: 'EER chladenia', cop_total: 'Celkové COP', spf: 'SPF (rok)',
      energy: 'Elektrina', env_energy: 'Energia prostredia', energy_heating: 'Elektrina na vykurovanie', energy_dhw: 'Elektrina na TÚV', energy_cooling: 'Elektrina na chladenie',
      energy_defrost: 'Elektrina na odmrazovanie', energy_standby: 'Pohotovostný režim', energy_aux: 'Elektrina prídavného ohrevu',
      heat: 'Teplo', heat_heating: 'Teplo na vykurovanie', heat_dhw: 'Teplo na TÚV', heat_cooling: 'Chladiaci výkon', heat_defrost: 'Teplo na odmrazovanie',
      starts: 'Štarty kompresora', cycles_heating: 'Vykurovacie cykly', cycles_dhw: 'Cykly TÚV', cycles_cooling: 'Chladiace cykly', defrosts: 'Odmrazovania',
      hours: 'Prevádzkové hodiny', hours_per_start: 'Doba behu na štart', load_classes: 'Záťažové triedy 1-5', aux_hours: 'Hodiny prídavného ohrevu', aux_starts: 'Štarty prídavného ohrevu',
      spread: 'Rozpätie', volume: 'Prietok', heat_estimated: 'Tepelný výkon', power: 'Výkon', heat_live: 'Tepelný výkon', compressor_speed: 'Kompresor',
      source_spread: 'Rozpätie zdroja', outdoor: 'Vonku', dhw_top: 'Nádrž TÚV', room: 'Izba', brine_pressure: 'Tlak nemrznúcej zmesi', hc_pressure: 'Tlak vykurovania', hc_spread: 'Rozpätie okruhu', pv_share: 'Podiel FVE dnes',
      pv_boost_share: 'Podiel prebytku FVE na vykurovaní', pv_production: 'Výnos FVE', solar_thermal: 'Solárne teplo', cost: 'Náklady', dhw_loss: 'Pohotovostná strata TÚV',
    },
    periods: { now: 'teraz', today: 'dnes', yesterday: 'včera', week: 'týždeň', month: 'mesiac', year: 'rok', total: 'celkovo' },
    modes: {
      idle: 'Pohotovostný režim', heating: 'Vykurovanie', dhw: 'Teplá voda', cooling: 'Chladenie', defrost: 'Odmrazovanie', blocked: 'Blokované',
      frost: 'Protimrazová ochrana', circulate: 'Cirkulácia', off: 'Vypnuté', legionella: 'Antilegionela', trailing: 'Dobeh',
    },
  },
  cs: {
    not_found: 'Nenalezeny žádné entity této předvolby. Zkontrolujte integraci a předponu, nebo otevřete editor karty.',
    start: 'Nenalezena žádná podporovaná integrace tepelného čerpadla. Otevřete editor karty a vyberte předvolbu nebo přiřaďte své entity.', start_link: 'Podporované integrace',
    title: 'Tepelné čerpadlo', heat_pump: 'Tepelné čerpadlo', dhw: 'Teplá voda', buffer: 'Akumulační zásobník', series_tank: 'Sériový akumulační zásobník', combined_tank: 'Kombinovaný zásobník', heating_zone: 'Vytápění', fresh_water_station: 'Čerstvá voda (stanice)', heating_circuit: 'Topný okruh',
    house: 'Místnosti', room: 'Místnost', room_target: 'Cílová teplota', humidity: 'Vlhkost', dew_point: 'Rosný bod', dew_margin: 'Odstup od rosného bodu', dew_warning: 'riziko kondenzace', flow_short: 'Přívod', comfort_below: 'pod cílem', comfort_on: 'na cíli', comfort_above: 'nad cílem', running: 'běží', compressor_off: 'Kompresor vypnutý', source_in: 'Přívod vzduchu', outdoor: 'Venku',
    energy_missing: 'Energetický panel: chybí senzor výkonu pro {sources}; samotné měřiče energie nedokážou zobrazit aktuální průtok.',
    brine_in: 'Vstup nemrznoucí směsi', brine_out: 'Výstup nemrznoucí směsi', well_in: 'Vstup ze studny', well_out: 'Výstup do studny',
    details: 'Podrobnosti', sec_operation: 'Provoz', sec_hydraulic: 'Hydraulické tlaky', sec_refrigerant: 'Chladicí okruh', sec_cutouts: 'Vypnutí (počet událostí)', sec_more: 'Více',
    diagnostic_copy: 'Kopírovat diagnostickou zprávu', diagnostic_copied: 'Diagnostická zpráva byla zkopírována', diagnostic_failed: 'Nepodařilo se zkopírovat diagnostickou zprávu',
    fullscreen_open: 'Otevřít na celou obrazovku', fullscreen_close: 'Zavřít celou obrazovku',
    det: {
      hours: 'Provozní hodiny kompresoru', starts_total: 'Celkový počet startů kompresoru', aux_hours: 'Hodiny přídavného ohřevu', energy_total: 'Celková elektřina',
      cutout_high_pressure: 'Vysokotlaká vypnutí', cutout_low_pressure: 'Nízkotlaká vypnutí', cutout_temperature: 'Teplotní vypnutí',
      env_energy: 'Celková energie prostředí', heat_total: 'Celkové vyrobené teplo', cop_total: 'Celkové COP', compressor_speed: 'Kompresor', evap_temp: 'Odpařování', cond_temp: 'Kondenzace',
      suction_temp: 'Nasávaný plyn', hot_gas: 'Horký plyn', liquid_temp: 'Kapalinové potrubí', low_pressure: 'Nízký tlak', high_pressure: 'Vysoký tlak',
      eev: 'Expanzní ventil', superheat: 'Přehřátí', subcooling: 'Podchlazení',
    },
    boiler: 'Bojler', boiler_off: 'Bojler vypnutý', mixer: 'Směšovač', mixer_opening: 'směšovač se otevírá', mixer_closing: 'směšovač se zavírá',
    source_flow: 'Zdroj', target: 'Cíl', curve_offset: 'křivka', curve_shift: 'posun', return_short: 'RL', error: 'Chyba', circulation: 'Cirk.', circulation_from: 'od', circulation_until: 'do', valve_dhw: 'TUV', solar: 'Solár',
    brine_pressure: 'Tlak nemrznoucí směsi', hc_pressure: 'Tlak vytápění', pressure_normal: 'normální', pressure_warning: 'varování', pressure_critical: 'kritický',
    timeline_title: 'Posledních {h} hodin', timeline_gap: 'Žádná data', timeline_aria: 'Provozní režim za posledních {h} hodin. Šipkami vyberte období.',
    run_series: '{n}. běh od {t}', run_pause: 'pauza předtím {d}', run_partial: 'začal před časovou osou', run_ongoing: 'stále běží', run_phase: 'provozní fáze, bez údajů kompresoru', run_close: 'Zavřít', run_flow: 'Přívod', run_reached: 'dosažen', run_missed: '{d} K pod', run_heater: 'Topná tyč', run_on: 'zap', run_off: 'vyp',
    programs: { eco: 'Eko', night: 'Noční', party: 'Párty', holiday: 'Dovolená' },
    sg_ready: { normal: 'SG normální provoz', blocked: 'Blokování distribuční sítí', boost: 'SG zvýšený provoz', forced: 'SG vynucený provoz' },
    valve_heating: 'Vytápění', valve_cooling: 'Chlazení', bypass: 'Obtok (Bypass)', pv: 'FVE', pv_boost: 'Přebytek FVE', battery: 'Baterie', grid: 'Síť',
    stat_cop_heating: 'COP vytápění dnes', stat_cop_dhw: 'COP TUV dnes', stat_energy: 'Energie dnes',
    stat_starts: 'Starty dnes', stat_spread: 'Rozpětí', stat_volume: 'Průtok', stat_heat: 'Tepelný výkon', pv_share: 'FVE',
    tiles: {
      cop_live: 'Aktuální COP', cop_heating: 'COP vytápění', cop_dhw: 'COP TUV', cop_cooling: 'EER chlazení', cop_total: 'Celkové COP', spf: 'SPF (rok)',
      energy: 'Elektřina', env_energy: 'Energie prostředí', energy_heating: 'Elektřina pro vytápění', energy_dhw: 'Elektřina pro TUV', energy_cooling: 'Elektřina pro chlazení',
      energy_defrost: 'Elektřina pro odmrazování', energy_standby: 'Pohotovostní režim', energy_aux: 'Elektřina přídavného ohřevu',
      heat: 'Teplo', heat_heating: 'Teplo pro vytápění', heat_dhw: 'Teplo pro TUV', heat_cooling: 'Chladicí výkon', heat_defrost: 'Teplo pro odmrazování',
      starts: 'Starty kompresoru', cycles_heating: 'Topné cykly', cycles_dhw: 'Cykly TUV', cycles_cooling: 'Chladicí cykly', defrosts: 'Odmrazování',
      hours: 'Provozní hodiny', hours_per_start: 'Doba běhu na start', load_classes: 'Zátěžové třídy 1-5', aux_hours: 'Hodiny přídavného ohřevu', aux_starts: 'Starty přídavného ohřevu',
      spread: 'Rozpětí', volume: 'Průtok', heat_estimated: 'Tepelný výkon', power: 'Výkon', heat_live: 'Tepelný výkon', compressor_speed: 'Kompresor',
      source_spread: 'Rozpětí zdroje', outdoor: 'Venku', dhw_top: 'Nádrž TUV', room: 'Pokoj', brine_pressure: 'Tlak nemrznoucí směsi', hc_pressure: 'Tlak vytápění', hc_spread: 'Rozpětí okruhu', pv_share: 'Podíl FVE dnes',
      pv_boost_share: 'Podíl přebytku FVE na vytápění', pv_production: 'Výnos FVE', solar_thermal: 'Solární teplo', cost: 'Náklady', dhw_loss: 'Pohotovostní ztráta TUV',
    },
    periods: { now: 'nyní', today: 'dnes', yesterday: 'včera', week: 'týden', month: 'měsíc', year: 'rok', total: 'celkově' },
    modes: {
      idle: 'Pohotovostní režim', heating: 'Vytápění', dhw: 'Teplá voda', cooling: 'Chlazení', defrost: 'Odmrazování', blocked: 'Blokováno',
      frost: 'Protimrazová ochrana', circulate: 'Cirkulace', off: 'Vypnuto', legionella: 'Antilegionela', trailing: 'Doběh',
    },
  },
  nl: {
    not_found: 'Geen entiteiten van deze preset gevonden. Controleer de integratie en het voorvoegsel, of open de kaarteditor.',
    start: 'Geen ondersteunde warmtepompintegratie gevonden. Open de kaarteditor om een preset te kiezen of je entiteiten te koppelen.', start_link: 'Ondersteunde integraties',
    title: 'Warmtepomp', heat_pump: 'Warmtepomp', dhw: 'Warm water', buffer: 'Buffervat', series_tank: 'Seriebuffer', combined_tank: 'Combivat', heating_zone: 'Verwarming', fresh_water_station: 'Verswaterstation', heating_circuit: 'Verwarmingsgroep',
    house: 'Woning', room: 'Kamer', room_target: 'Kamerdoel', humidity: 'Luchtvochtigheid', dew_point: 'Dauwpunt', dew_margin: 'Dauwpuntsmarge', dew_warning: 'condensatierisico', flow_short: 'Aanvoer', comfort_below: 'onder doelwaarde', comfort_on: 'op doelwaarde', comfort_above: 'boven doelwaarde', running: 'actief', compressor_off: 'Compressor uit', source_in: 'Luchtinlaat', outdoor: 'Buiten',
    energy_missing: 'Energiedashboard: geen vermogenssensor voor {sources}; met alleen energietellers is geen live stroom te tonen.',
    brine_in: 'Bron in', brine_out: 'Bron uit', well_in: 'Put in', well_out: 'Put uit',
    details: 'Details', sec_operation: 'Bedrijf', sec_hydraulic: 'Hydraulische druk', sec_refrigerant: 'Koudemiddelcircuit', sec_cutouts: 'Uitschakelingen (aantal keer)', sec_more: 'Meer',
    diagnostic_copy: 'Diagnoserapport kopiëren', diagnostic_copied: 'Diagnoserapport gekopieerd', diagnostic_failed: 'Diagnoserapport kopiëren mislukt',
    fullscreen_open: 'Volledig scherm openen', fullscreen_close: 'Volledig scherm sluiten',
    det: {
      hours: 'Compressoruren', starts_total: 'Compressorstarts totaal', aux_hours: 'Uren bijverwarming', energy_total: 'Stroom totaal',
      cutout_high_pressure: 'Hogedrukuitschakelingen', cutout_low_pressure: 'Lagedrukuitschakelingen', cutout_temperature: 'Temperatuuruitschakelingen',
      env_energy: 'Omgevingsenergie totaal', heat_total: 'Warmte totaal', cop_total: 'COP totaal', compressor_speed: 'Compressor', evap_temp: 'Verdamping', cond_temp: 'Condensatie',
      suction_temp: 'Zuiggas', hot_gas: 'Heetgas', liquid_temp: 'Vloeistofleiding', low_pressure: 'Lage druk', high_pressure: 'Hoge druk',
      eev: 'Expansieventiel', superheat: 'Oververhitting', subcooling: 'Nakoeling',
    },
    source_flow: 'Bron', target: 'Doel', curve_offset: 'stooklijn', curve_shift: 'verschuiving', return_short: 'RL', error: 'Storing', circulation: 'Circ.', circulation_from: 'vanaf', circulation_until: 'tot', valve_dhw: 'WW', solar: 'Zon',
    brine_pressure: 'Brondruk', hc_pressure: 'Verwarmingsdruk', pressure_normal: 'normaal', pressure_warning: 'waarschuwing', pressure_critical: 'kritiek',
    timeline_title: 'Laatste {h} uur', timeline_gap: 'Geen gegevens', timeline_aria: 'Bedrijfsstand van de laatste {h} uur. Kies een periode met de pijltjestoetsen.',
    run_series: 'run {n} sinds {t}', run_pause: 'pauze ervoor {d}', run_partial: 'begon vóór de tijdlijn', run_ongoing: 'loopt nog', run_phase: 'bedrijfsperiode, geen compressorgegevens', run_close: 'Sluiten', run_flow: 'Aanvoer', run_reached: 'bereikt', run_missed: '{d} K eronder', run_heater: 'Verwarmingselement', run_on: 'aan', run_off: 'uit',
    programs: { eco: 'Eco', night: 'Nacht', party: 'Party', holiday: 'Vakantie' },
    sg_ready: { normal: 'SG normaal', blocked: 'Netblokkering', boost: 'SG-verhoging', forced: 'SG gedwongen aan' },
    valve_heating: 'Verwarmen', valve_cooling: 'Koelen', bypass: 'Bypass', pv: 'PV', pv_boost: 'PV-overschot', battery: 'Accu', grid: 'Net',
    stat_cop_heating: 'COP verwarmen vandaag', stat_cop_dhw: 'COP warm water vandaag', stat_energy: 'Energie vandaag',
    stat_starts: 'Starts vandaag', stat_spread: 'ΔT', stat_volume: 'Debiet', stat_heat: 'Warmtevermogen', pv_share: 'PV',
    tiles: {
      cop_live: 'COP live', cop_heating: 'COP verwarmen', cop_dhw: 'COP warm water', cop_cooling: 'EER koelen', cop_total: 'COP totaal', spf: 'SPF (jaar)',
      energy: 'Stroom', env_energy: 'Omgevingsenergie', energy_heating: 'Stroom verwarmen', energy_dhw: 'Stroom warm water', energy_cooling: 'Stroom koelen',
      energy_defrost: 'Stroom ontdooien', energy_standby: 'Stand-by', energy_aux: 'Stroom bijverwarming',
      heat: 'Warmte', heat_heating: 'Warmte verwarmen', heat_dhw: 'Warmte warm water', heat_cooling: 'Koelvermogen', heat_defrost: 'Warmte ontdooien',
      starts: 'Compressorstarts', cycles_heating: 'Verwarmingscycli', cycles_dhw: 'Warmwatercycli', cycles_cooling: 'Koelcycli', defrosts: 'Ontdooiingen',
      hours: 'Compressoruren', hours_per_start: 'Looptijd per start', load_classes: 'Lastklassen 1-5', aux_hours: 'Uren bijverwarming', aux_starts: 'Starts bijverwarming',
      spread: 'ΔT', volume: 'Debiet', heat_estimated: 'Warmtevermogen', power: 'Vermogen', heat_live: 'Warmtevermogen', compressor_speed: 'Compressor',
      source_spread: 'ΔT bron', outdoor: 'Buiten', dhw_top: 'Warmwatervat', room: 'Kamer', brine_pressure: 'Brondruk', hc_pressure: 'Verwarmingsdruk', hc_spread: 'ΔT groep', pv_share: 'PV-aandeel vandaag',
      pv_boost_share: 'Aandeel PV-overschot in verwarmen', pv_production: 'PV-opbrengst', solar_thermal: 'Zonthermie', cost: 'Kosten', dhw_loss: 'Stilstandsverlies warm water',
    },
    periods: { now: 'nu', today: 'vandaag', yesterday: 'gisteren', week: 'week', month: 'maand', year: 'jaar', total: 'totaal' },
    modes: {
      idle: 'Stand-by', heating: 'Verwarmen', dhw: 'Warm water', cooling: 'Koelen', defrost: 'Ontdooien', blocked: 'Geblokkeerd',
      frost: 'Vorstbeveiliging', circulate: 'Circuleren', off: 'Uit', legionella: 'Legionella', trailing: 'Naloop',
    },
    boiler: 'Ketel', boiler_off: 'Ketel uit', mixer: 'Mengklep', mixer_opening: 'opent', mixer_closing: 'sluit',
  },
};

// Translation objects are a public configuration surface. Merge them recursively so a custom language only needs to
// provide the labels it changes; every missing leaf falls back to English (and then to a built-in language, if present).
const hfcTextMerge = (...parts) => {
  const out = {};
  parts.filter((p) => p && typeof p === 'object' && !Array.isArray(p)).forEach((part) => Object.entries(part).forEach(([key, value]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return;
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? hfcTextMerge(out[key], value) : value;
  }));
  return out;
};

// The built-in text of a language on top of English, so a translation in progress never leaves a gap.
const hfcBuiltin = (table, lang) => hfcTextMerge(table.en, lang === 'en' ? null : table[lang]);

const HFC_EDITOR = {
  en: {
    preset: 'Preset', prefix: 'Prefix (empty = auto-detect)', device: 'Device (optional, restricts the preset)',
    title: 'Title', language: 'Language', power_threshold: 'Running above (W)', hc_type: 'Heat emitter',
    power_sources: 'PV / battery / grid', ps_auto: 'Energy dashboard, unless set below', ps_manual: 'Only the sensors below',
    source_type: 'Heat source', src_air: 'Air', src_brine: 'Ground (brine)', src_water: 'Groundwater',
    hc_count: 'Heating circuits', hc2_type: 'Circuit 2 emitter', hc3_type: 'Circuit 3 emitter', hc4_type: 'Circuit 4 emitter', hc5_type: 'Circuit 5 emitter', hc6_type: 'Circuit 6 emitter',
    unit_style: 'Unit drawing', unit_auto: 'Automatic (from the preset)', unit_generic: 'Generic (fan)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono', unit_wolf: 'Wolf CHA', unit_kronoterm: 'Kronoterm ADAPT', unit_alpha_innotec: 'Alpha Innotec Hybrox', unit_stiebel: 'Stiebel Eltron WPL-A',
    unit_size: 'Size of the unit drawing', size_pana_medium: '1 fan (3 to 9 kW)', size_pana_large: '2 fans (T-CAP, 12 and 16 kW)', size_small: '3.5 / 5.5 kW (1 fan, low)', size_medium: '7.5 kW (1 fan)', size_large: '10.5 / 12.5 kW (2 fans)',
    timeline: 'Timeline of the operating mode', timeline_hours: 'Timeline length (hours)', timeline_details: 'Run details under the timeline', timeline_marks: 'Show the badges (e.g. Boost) as extra lanes',
    layout: 'Layout', layout_default: 'Default', layout_compact: 'Compact (narrow columns)', layout_wide: 'Wide (tiles beside the schematic)', layout_wall: 'Wall display (large, controls fade out)',
    animations: 'Animations', animations_auto: 'Automatic (respect reduced motion)', animations_always: 'Always', animations_off: 'Off',
    flow_speed: 'Animation speed', source_spread: 'Show source spread',
    theme: 'Card theme', theme_auto: 'Automatic (dashboard)', theme_night: 'Night', theme_contrast: 'High contrast', fullscreen: 'Full-screen button', diagnostic: 'Diagnostic report button',
    wall_timeout: 'Hide controls after (seconds, 0 = never)',
    hc_flow_label: 'Show circuit flow temperature', hc_return_label: 'Show circuit return temperature', dew_point_margin: 'Minimum dew-point margin (K)', narrow_values: 'Keep tank sub-values, hot-water target and circuit return on narrow cards', narrow_focus: 'Phone focus: larger key values on narrow cards, secondary values in one line below', buffer_values: 'Buffer temperature emphasis', buffer_values_default: 'Top value prominent (default)', buffer_values_equal: 'All configured values equal', storage: 'Storage', storage_separate: 'Separate hot-water tank and buffer', storage_combined: 'Combined storage (one tank, hot-water zone on top)', buffer: 'Parallel buffer (also without sensors)', dhw_type: 'Hot-water preparation', dhw_type_coil: 'Tank with heat-exchanger coil', dhw_type_fresh_water: 'Fresh-water station (on the buffer or the combined storage)', dhw_type_tank_in_tank: 'Tank in tank (combined storage)', series_buffer: 'Series buffer in the return', series_bypass: 'Series buffer with bypass valve (off: the circuits run in defrost)', primary_pump: 'Primary pump', hc_name: 'Circuit 1 name', hc2_name: 'Circuit 2 name', hc3_name: 'Circuit 3 name', hc4_name: 'Circuit 4 name', hc5_name: 'Circuit 5 name', hc6_name: 'Circuit 6 name',
    sec_hc2: 'Heating circuit 2', sec_hc3: 'Heating circuit 3', sec_hc4: 'Heating circuit 4', sec_hc5: 'Heating circuit 5', sec_hc6: 'Heating circuit 6', sec_details: 'Details: operation', sec_refrigerant: 'Details: refrigerant circuit', sec_cutouts: 'Details: cut-out counters',
    controls: 'Quick controls (switch, button, select, number …)', details_open: 'Details open by default',
    from_preset: 'Found by the preset', more_fields: 'More fields',
    sum_help: 'Sum of these entities',
    sec_advanced: 'Advanced',
    tiles_custom: 'Own tile selection', tiles: 'Tiles (drag to sort)',
    tiles_custom_help: 'Off: default tiles. On: pick tiles and periods from what this installation provides; an empty list hides the row.',
    tiles_yaml: 'Some tiles have their own name, entity, price or action: edit them in YAML.',
    price_fixed: 'Electricity price per kWh', price_entity: 'Electricity price entity',
    price_help: 'Enables the cost tile. With an entity that has long-term statistics (e.g. a dynamic tariff), the cost is billed per hour.',
    untested: 'untested',
    untested_help: 'Not yet tested on a real installation. Please report whether it works: github.com/Sturmi77/heatpump-hydraulic-card/issues (Preset feedback).',
    warn_title: 'Missing in the card',
    warn_running: 'No operating mode, compressor, status or power: the card cannot tell whether the heat pump runs.',
    warn_power: 'No electrical power: no live COP, and no PV / battery / grid split from the Energy dashboard.',
    warn_energy_sources: 'Energy dashboard: no power sensor for {sources}; energy counters alone cannot show live flow.',
    warn_temps: 'No flow or return temperature: no spread and no estimated heat output.',
    warn_heat: 'No heat output and no flow rate: no live COP.',
    warn_valve: 'The diverter valve reports a number and has no valve states: the card reads 1 as hot water. If 1 means heating on this valve, set its states under Advanced.',
    warn_map_entities: '{maps} is under entities, where the card ignores it. In YAML it belongs at the top level of the card configuration.',
    warn_disabled: 'The preset would use these entities, but they are disabled in Home Assistant: {list}. Enable them under Settings → Devices & services → Entities.',
    checks_title: 'Check these fields',
    check_unit: '{field}: {entity} reports {unit}, expected {expected}.',
    check_domain: '{field}: {entity} is a {domain} entity, expected {expected}.',
    check_state: '{field}: {entity} reports "{state}", expected {expected}.',
    check_counter: '{field}: {entity} is a counter (it only grows), expected {expected}.',
    check_same: '{field}: {entity} is also used for {other}; the two fields measure different things.',
    check_air: '{field}: {entity} is set, but the heat source is air. The card draws no brine or well loop; clear the field or set the heat source.',
    check_setting: '{field}: {entity} is a setting ({domain}), not what the heat pump is doing now. A chosen mode such as "Heat only" reads as idle; leave the field empty or use a sensor of the current operation.',
    check_today: '{field}: {entity} reports {value}, more than one day can bring. Is it the total counter?',
    kind_temperature: 'a temperature (°C)', kind_offset: 'a temperature difference (K)', kind_power: 'a power (W or kW)', kind_energy: 'an energy (kWh)',
    kind_pressure: 'a pressure (bar)', kind_flowrate: 'a flow rate (l/h, l/min or m³/h)', kind_hours: 'a duration (h)', kind_percent: 'a percentage (%)',
    kind_counter: 'a count without unit', kind_ratio: 'a number without unit', kind_speed: 'on/off, or a frequency or speed',
    kind_onoff: 'on/off', kind_onoff_power: 'on/off, a stage or a power (W)', kind_valve: 'on/off, or a state like Tank/Room', kind_text: 'a state text',
    all_entities: 'Show all entities in the pickers',
    all_entities_help: 'Off: measurement fields offer entities whose unit or device class fits (°C, W, kWh, bar, l/h). On: every entity, for sensors without a unit.',
    assistant_device: 'Find entities on this heat pump device',
    assistant_device_help: 'Only available when no supported preset is detected. Suggestions are not saved until you select and confirm them.',
    assistant_title: 'Proposed entity mapping',
    assistant_intro: 'Exact English and German names, units and device classes are checked. Select every proposal you want to save.',
    assistant_apply: 'Use selected proposals',
    assistant_none: 'No unambiguous proposals were found on this device.',
    preset_help: 'Found entities are filled in below. Pick another entity to override one, clear a field to hide it.',
    from_energy: 'Empty: taken from the Energy dashboard',
    errors: 'Error entities', error_ok_text: 'Text states that mean no error',
    valve_dhw_text: 'Valve states for hot water', valve_heating_text: 'Valve states for heating',
    valve_help: 'Comma-separated raw states of the valve entity, for example 0, 1 or Tank. Current state: {state}.',
    errors_help: 'Active for a number other than 0 or state on. Text needs the no-error states below; unknown, unavailable, off and empty are ignored.',
    error_ok_help: 'Comma-separated, case-insensitive; for example: No Error, OK. Any other known text then shows the error chip.',
    total_cop_help: 'Total heat, environmental energy and electricity must cover the same time range. Without total heat, COP uses environmental energy plus electricity.',
    language_help: 'Additional languages and custom labels are configured with texts in YAML; missing labels fall back to English.',
    detected: 'Detected', entities_found: 'entities', also_detected: 'Also detected here:', not_detected: 'Not found in this Home Assistant - check the integration, the prefix or choose another preset',
    program: 'Heating program (eco, night, party, holiday)', solar_collector: 'Solar collector temperature (°C)', solar_pump: 'Solar pump running (on/off)',
    source_out: 'Source outlet temperature (°C: brine or well water out)', heater: 'Backup / inline heater of the heat pump active (on/off, stage 1 to 3, or W)',
    dhw_heater: 'DHW heater rod active (on/off, or W)', buffer_heater: 'Buffer heater rod active (on/off, or W)',
    dhw_heater_top: 'DHW heater rod at the top active (on/off, or W)', dhw_heater_middle: 'DHW heater rod in the middle active (on/off, or W)', dhw_heater_bottom: 'DHW heater rod at the bottom active (on/off, or W)',
    buffer_heater_top: 'Buffer heater rod at the top active (on/off, or W)', buffer_heater_middle: 'Buffer heater rod in the middle active (on/off, or W)', buffer_heater_bottom: 'Buffer heater rod at the bottom active (on/off, or W)',
    hc_underfloor: 'Underfloor heating', hc_radiator: 'Panel radiators', hc_column: 'Column radiators',
    brine_pressure_min: 'Brine pressure warning below', brine_pressure_crit: 'Brine pressure critical below', brine_pressure_max: 'Brine pressure warning above',
    hc_pressure_min: 'Heating pressure warning below', hc_pressure_crit: 'Heating pressure critical below', hc_pressure_max: 'Heating pressure warning above',
    sec_hp: 'Heat pump', sec_boiler: 'Boiler / second heat generator', sec_storage: 'Storage', sec_hc: 'Heating circuit & house', sec_power: 'Power sources', sec_stats: 'Statistics',
    mode: 'Operating mode (state text)', status: 'Status / sub-state (text)', compressor: 'Compressor running (on/off, or frequency / speed above 0)', defrost: 'Defrost active (on/off)', fan_speed: 'Fan speed (rpm, or on/off)', power: 'Electrical power of the heat pump (W or kW)',
    heat: 'Heat output (kW or W)', flow: 'Heat pump flow temperature (°C)', return: 'Heat pump return temperature (°C)', volume: 'Flow rate of the heat pump loop (l/h or l/min, primary pump)',
    boiler_state: 'Boiler running (on/off, or a power above 0)', boiler_power: 'Boiler output (W or kW)', boiler_flow: 'Boiler flow temperature (°C)',
    source_volume: 'Flow rate of the brine or well loop (l/h or l/min, not for air)', source_in: 'Source inlet temperature (°C: air, brine or well water in)', outdoor: 'Outdoor temperature (°C)',
    valve: 'Diverter valve towards hot water (on/off, or a state like Tank/Room)', bypass_valve: 'Series buffer bypass valve (on = bypass; default: defrost)',
    pv_boost: 'PV surplus mode (on, or a power above 0)',
    sg_ready: 'SG-Ready / utility lock state (1–4 or text)',
    dhw_top: 'DHW tank top (°C)', dhw_middle: 'DHW tank middle (°C)', dhw_bottom: 'DHW tank bottom (°C)', dhw_target: 'DHW target (°C)', dhw_mode: 'DHW mode (state text)',
    circulation: 'Circulation pump running (on/off)', circulation_start: 'Circulation window starts', circulation_end: 'Circulation window ends', circulation_schedule: 'Circulation schedule (next change)', dhw_loss_sensor: 'DHW standby-loss measurement (°C)', buffer_top: 'Buffer top (°C)', buffer_middle: 'Buffer middle (°C)', buffer_bottom: 'Buffer bottom (°C)', buffer_mode: 'Buffer mode (state text)',
    hc_flow: 'Circuit flow temperature (°C)', hc_return: 'Circuit return temperature (°C)', hc_setpoint: 'Circuit flow target (°C)',
    hc_mode: 'Circuit mode (state text)', hc_pump: 'Circuit pump running (on/off)', hc_volume: 'Flow rate of the heating circuit (l/h or l/min, circuit pump)', hc_curve_offset: 'Heating curve shift (K)', hc_mixer: 'Mixer position or share (%, shown as reported)', hc_mixer_opening: 'Mixer motor opening (on/off)', hc_mixer_closing: 'Mixer motor closing (on/off)', hc_pressure: 'Heating circuit pressure (bar)', brine_pressure: 'Brine circuit pressure (bar)',
    cutout_high_pressure: 'High-pressure cut-outs (count of events, not a pressure)', cutout_low_pressure: 'Low-pressure cut-outs (count of events, not a pressure)', cutout_temperature: 'Temperature cut-outs (count of events, not a temperature)',
    room: 'Room temperature (°C)', room_target: 'Room target (°C)', room_humidity: 'Room humidity (%)', dew_point: 'Dew point (°C, optional)',
    env_energy: 'Environmental energy total (kWh)', pv: 'Power from PV (W)', battery: 'Power from battery (W)', grid: 'Power from grid (W)',
    cop_heating_today: 'COP heating today', cop_dhw_today: 'COP DHW today', energy_today: 'Energy today (kWh)',
    pv_share_today: 'PV share today (%)', starts_today: 'Compressor starts today',
  },
  de: {
    preset: 'Voreinstellung', prefix: 'Präfix (leer = automatisch erkennen)', device: 'Gerät (optional, schränkt die Voreinstellung ein)',
    title: 'Titel', language: 'Sprache', power_threshold: 'Läuft ab (W)', hc_type: 'Wärmeabgabe',
    power_sources: 'PV / Akku / Netz', ps_auto: 'Energie-Dashboard, außer unten gesetzt', ps_manual: 'Nur die Sensoren unten',
    source_type: 'Wärmequelle', src_air: 'Luft', src_brine: 'Erdreich (Sole)', src_water: 'Grundwasser',
    hc_count: 'Heizkreise', hc2_type: 'Wärmeabgabe Heizkreis 2', hc3_type: 'Wärmeabgabe Heizkreis 3', hc4_type: 'Wärmeabgabe Heizkreis 4', hc5_type: 'Wärmeabgabe Heizkreis 5', hc6_type: 'Wärmeabgabe Heizkreis 6',
    unit_style: 'Geräte-Zeichnung', unit_auto: 'Automatisch (aus der Voreinstellung)', unit_generic: 'Allgemein (Lüfter)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono', unit_wolf: 'Wolf CHA', unit_kronoterm: 'Kronoterm ADAPT', unit_alpha_innotec: 'Alpha Innotec Hybrox', unit_stiebel: 'Stiebel Eltron WPL-A',
    unit_size: 'Größe der Geräte-Zeichnung', size_pana_medium: '1 Lüfter (3 bis 9 kW)', size_pana_large: '2 Lüfter (T-CAP, 12 und 16 kW)', size_small: '3,5 / 5,5 kW (1 Lüfter, niedrig)', size_medium: '7,5 kW (1 Lüfter)', size_large: '10,5 / 12,5 kW (2 Lüfter)',
    timeline: 'Zeitleiste der Betriebsart', timeline_hours: 'Länge der Zeitleiste (Stunden)', timeline_details: 'Laufdetails unter der Zeitleiste', timeline_marks: 'Badges (z. B. Boost) als zusätzliche Spuren zeigen',
    layout: 'Layout', layout_default: 'Standard', layout_compact: 'Kompakt (schmale Spalten)', layout_wide: 'Breit (Kacheln neben dem Schema)', layout_wall: 'Wanddisplay (groß, Bedienelemente blenden aus)',
    animations: 'Animationen', animations_auto: 'Automatisch (reduzierte Bewegung beachten)', animations_always: 'Immer', animations_off: 'Aus',
    flow_speed: 'Animationsgeschwindigkeit', source_spread: 'Quellenspreizung anzeigen',
    theme: 'Kartendarstellung', theme_auto: 'Automatisch (Dashboard)', theme_night: 'Nacht', theme_contrast: 'Hoher Kontrast', fullscreen: 'Vollbild-Schaltfläche', diagnostic: 'Diagnosebericht-Schaltfläche',
    wall_timeout: 'Bedienelemente ausblenden nach (Sekunden, 0 = nie)',
    hc_flow_label: 'Heizkreis-Vorlauf anzeigen', hc_return_label: 'Heizkreis-Rücklauf anzeigen', dew_point_margin: 'Mindestabstand zum Taupunkt (K)', narrow_values: 'Speicher-Unterwerte, WW-Soll und Heizkreis-Rücklauf auf schmalen Karten zeigen', narrow_focus: 'Handy-Fokus: Kernwerte auf schmalen Karten größer, Nebenwerte in einer Zeile darunter', buffer_values: 'Gewichtung der Puffertemperaturen', buffer_values_default: 'Oberen Wert hervorheben (Standard)', buffer_values_equal: 'Alle vorhandenen Werte gleich', storage: 'Speicher', storage_separate: 'Getrennter Warmwasserspeicher und Puffer', storage_combined: 'Kombispeicher (ein Speicher, Warmwasserzone oben)', buffer: 'Parallelpuffer (auch ohne Sensoren)', dhw_type: 'Warmwasserbereitung', dhw_type_coil: 'Speicher mit Wärmetauscher-Wendel', dhw_type_fresh_water: 'Frischwasserstation (am Puffer oder Kombispeicher)', dhw_type_tank_in_tank: 'Tank im Tank (Kombispeicher)', series_buffer: 'Reihenpuffer im Rücklauf', series_bypass: 'Reihenpuffer mit Bypass-Ventil (aus: die Heizkreise laufen beim Abtauen)', primary_pump: 'Primärpumpe', hc_name: 'Name Heizkreis 1', hc2_name: 'Name Heizkreis 2', hc3_name: 'Name Heizkreis 3', hc4_name: 'Name Heizkreis 4', hc5_name: 'Name Heizkreis 5', hc6_name: 'Name Heizkreis 6',
    sec_hc2: 'Heizkreis 2', sec_hc3: 'Heizkreis 3', sec_hc4: 'Heizkreis 4', sec_hc5: 'Heizkreis 5', sec_hc6: 'Heizkreis 6', sec_details: 'Details: Betrieb', sec_refrigerant: 'Details: Kältekreis', sec_cutouts: 'Details: Abschaltzähler',
    controls: 'Schnellbedienung (Schalter, Taste, Auswahl, Zahl …)', details_open: 'Details standardmäßig offen',
    from_preset: 'Von der Voreinstellung gefunden', more_fields: 'Weitere Felder',
    sum_help: 'Summe dieser Entitäten',
    sec_advanced: 'Erweitert',
    tiles_custom: 'Eigene Kachelauswahl', tiles: 'Kacheln (zum Sortieren ziehen)',
    tiles_custom_help: 'Aus: Standardkacheln. An: Kacheln und Zeiträume aus dem wählen, was diese Anlage liefert; eine leere Liste blendet die Zeile aus.',
    tiles_yaml: 'Einige Kacheln haben einen eigenen Namen, eine eigene Entität, einen Preis oder eine Aktion: im YAML bearbeiten.',
    price_fixed: 'Strompreis je kWh', price_entity: 'Strompreis-Entität',
    price_help: 'Schaltet die Kostenkachel frei. Mit einer Entität mit Langzeitstatistik (z. B. dynamischer Tarif) werden die Kosten stundengenau abgerechnet.',
    untested: 'ungetestet',
    untested_help: 'Noch nicht mit einer echten Anlage getestet. Bitte melden, ob es funktioniert: github.com/Sturmi77/heatpump-hydraulic-card/issues (Preset feedback).',
    warn_title: 'Fehlt in der Karte',
    warn_running: 'Keine Betriebsart, kein Verdichter, kein Status und keine Leistung: Die Karte kann nicht erkennen, ob die Wärmepumpe läuft.',
    warn_power: 'Keine Leistungsaufnahme: kein Live-COP und keine Aufteilung PV / Akku / Netz aus dem Energie-Dashboard.',
    warn_energy_sources: 'Energie-Dashboard: kein Leistungssensor für {sources}; Energiezähler allein zeigen keinen aktuellen Fluss.',
    warn_temps: 'Kein Vor- oder Rücklauf: keine Spreizung und keine geschätzte Wärmeleistung.',
    warn_heat: 'Keine Wärmeleistung und kein Volumenstrom: kein Live-COP.',
    warn_valve: 'Das Umschaltventil meldet eine Zahl und hat keine Ventilstellungen: Die Karte liest 1 als Warmwasser. Bedeutet 1 bei diesem Ventil Heizen, die Stellungen unter „Erweitert“ eintragen.',
    warn_map_entities: '{maps} steht unter entities und wird dort von der Karte ignoriert. In YAML gehört es auf die oberste Ebene der Kartenkonfiguration.',
    warn_disabled: 'Die Voreinstellung würde diese Entitäten nutzen, sie sind in Home Assistant aber deaktiviert: {list}. Aktivieren unter Einstellungen → Geräte & Dienste → Entitäten.',
    checks_title: 'Diese Felder prüfen',
    check_unit: '{field}: {entity} meldet {unit}, erwartet: {expected}.',
    check_domain: '{field}: {entity} ist eine {domain}-Entität, erwartet: {expected}.',
    check_state: '{field}: {entity} meldet „{state}“, erwartet: {expected}.',
    check_counter: '{field}: {entity} ist ein Zähler (er wächst nur), erwartet: {expected}.',
    check_same: '{field}: {entity} steht auch bei {other}; die beiden Felder messen Verschiedenes.',
    check_air: '{field}: {entity} ist eingetragen, die Wärmequelle ist aber Luft. Die Karte zeichnet keinen Sole- oder Brunnenkreis; Feld leeren oder Wärmequelle einstellen.',
    check_setting: '{field}: {entity} ist eine Einstellung ({domain}), nicht das, was die Wärmepumpe gerade tut. Eine gewählte Betriebsart wie „Nur Heizen“ gilt als Bereitschaft; Feld leer lassen oder einen Sensor des aktuellen Betriebs wählen.',
    check_today: '{field}: {entity} meldet {value}, mehr als ein Tag bringen kann. Ist es der Gesamtzähler?',
    kind_temperature: 'eine Temperatur (°C)', kind_offset: 'eine Temperaturdifferenz (K)', kind_power: 'eine Leistung (W oder kW)', kind_energy: 'eine Energie (kWh)',
    kind_pressure: 'ein Druck (bar)', kind_flowrate: 'ein Volumenstrom (l/h, l/min oder m³/h)', kind_hours: 'eine Dauer (h)', kind_percent: 'ein Prozentwert (%)',
    kind_counter: 'eine Anzahl ohne Einheit', kind_ratio: 'eine Zahl ohne Einheit', kind_speed: 'ein/aus, oder eine Frequenz oder Drehzahl',
    kind_onoff: 'ein/aus', kind_onoff_power: 'ein/aus, eine Stufe oder eine Leistung (W)', kind_valve: 'ein/aus, oder ein Zustand wie Speicher/Raum', kind_text: 'ein Zustandstext',
    all_entities: 'Alle Entitäten in der Auswahl zeigen',
    all_entities_help: 'Aus: Messfelder bieten Entitäten an, deren Einheit oder Geräteklasse passt (°C, W, kWh, bar, l/h). Ein: alle Entitäten, für Sensoren ohne Einheit.',
    assistant_device: 'Entitäten auf diesem Wärmepumpen-Gerät finden',
    assistant_device_help: 'Nur verfügbar, wenn keine unterstützte Voreinstellung erkannt wird. Vorschläge werden erst nach Auswahl und Bestätigung gespeichert.',
    assistant_title: 'Vorgeschlagene Entitätszuordnung',
    assistant_intro: 'Exakte englische und deutsche Namen, Einheiten und Geräteklassen werden geprüft. Jeden gewünschten Vorschlag auswählen.',
    assistant_apply: 'Ausgewählte Vorschläge übernehmen',
    assistant_none: 'Auf diesem Gerät wurden keine eindeutigen Vorschläge gefunden.',
    preset_help: 'Gefundene Entitäten sind unten eingetragen. Andere Entität wählen zum Überschreiben, Feld leeren zum Ausblenden.',
    from_energy: 'Leer: aus dem Energie-Dashboard',
    errors: 'Fehler-Entitäten', error_ok_text: 'Textzustände ohne Fehler',
    valve_dhw_text: 'Ventilstellungen für Warmwasser', valve_heating_text: 'Ventilstellungen für Heizen',
    valve_help: 'Kommagetrennte Rohwerte der Ventil-Entität, zum Beispiel 0, 1 oder Tank. Aktueller Zustand: {state}.',
    errors_help: 'Aktiv bei einer Zahl ungleich 0 oder Zustand on. Text braucht die fehlerfreien Zustände unten; unknown, unavailable, off und leer werden ignoriert.',
    error_ok_help: 'Kommagetrennt, ohne Beachtung der Groß-/Kleinschreibung; zum Beispiel: No Error, OK. Jeder andere bekannte Text zeigt dann den Fehler-Chip.',
    total_cop_help: 'Gesamtwärme, Umweltenergie und Gesamtstrom müssen denselben Zeitraum abdecken. Ohne Gesamtwärme nutzt der COP Umweltenergie plus Strom.',
    language_help: 'Weitere Sprachen und eigene Beschriftungen werden mit texts im YAML konfiguriert; fehlende Texte fallen auf Englisch zurück.',
    detected: 'Erkannt', entities_found: 'Entitäten', also_detected: 'Hier ebenfalls erkannt:', not_detected: 'In diesem Home Assistant nicht gefunden - Integration und Präfix prüfen oder andere Voreinstellung wählen',
    program: 'Heizprogramm (Eco, Nacht, Party, Urlaub)', solar_collector: 'Kollektortemperatur Solarthermie (°C)', solar_pump: 'Solarpumpe läuft (ein/aus)',
    source_out: 'Quelle Austritt (°C: Sole oder Brunnenwasser raus)', heater: 'Heizstab / Zusatzheizer der Wärmepumpe aktiv (ein/aus, Stufe 1 bis 3, oder W)',
    dhw_heater: 'Heizstab Warmwasser aktiv (ein/aus, oder W)', buffer_heater: 'Heizstab Puffer aktiv (ein/aus, oder W)',
    dhw_heater_top: 'Heizstab Warmwasser oben aktiv (ein/aus, oder W)', dhw_heater_middle: 'Heizstab Warmwasser Mitte aktiv (ein/aus, oder W)', dhw_heater_bottom: 'Heizstab Warmwasser unten aktiv (ein/aus, oder W)',
    buffer_heater_top: 'Heizstab Puffer oben aktiv (ein/aus, oder W)', buffer_heater_middle: 'Heizstab Puffer Mitte aktiv (ein/aus, oder W)', buffer_heater_bottom: 'Heizstab Puffer unten aktiv (ein/aus, oder W)',
    hc_underfloor: 'Flächenheizung', hc_radiator: 'Plattenheizkörper', hc_column: 'Gliederheizkörper',
    brine_pressure_min: 'Soledruck Warnung unter', brine_pressure_crit: 'Soledruck kritisch unter', brine_pressure_max: 'Soledruck Warnung über',
    hc_pressure_min: 'Heizungsdruck Warnung unter', hc_pressure_crit: 'Heizungsdruck kritisch unter', hc_pressure_max: 'Heizungsdruck Warnung über',
    sec_hp: 'Wärmepumpe', sec_boiler: 'Heizkessel / zweiter Wärmeerzeuger', sec_storage: 'Speicher', sec_hc: 'Heizkreis & Haus', sec_power: 'Stromquellen', sec_stats: 'Kennzahlen',
    mode: 'Betriebsart (Statustext)', status: 'Status / Unterzustand (Text)', compressor: 'Verdichter läuft (ein/aus, oder Frequenz / Drehzahl über 0)', defrost: 'Abtauen aktiv (ein/aus)', fan_speed: 'Lüfterdrehzahl (U/min, oder ein/aus)', power: 'Elektrische Leistungsaufnahme der Wärmepumpe (W oder kW)',
    heat: 'Wärmeleistung (kW oder W)', flow: 'Vorlauftemperatur der Wärmepumpe (°C)', return: 'Rücklauftemperatur der Wärmepumpe (°C)', volume: 'Volumenstrom Wärmepumpenkreis (l/h oder l/min, Primärpumpe)',
    boiler_state: 'Heizkessel läuft (ein/aus, oder Leistung über 0)', boiler_power: 'Kesselleistung (W oder kW)', boiler_flow: 'Kessel-Vorlauftemperatur (°C)',
    source_volume: 'Volumenstrom Sole- oder Brunnenkreis (l/h oder l/min, nicht bei Luft)', source_in: 'Quelle Eintritt (°C: Luft, Sole oder Brunnenwasser rein)', outdoor: 'Außentemperatur (°C)',
    valve: 'Umschaltventil auf Warmwasser (ein/aus, oder Zustand wie Tank/Room)', bypass_valve: 'Bypass-Ventil Reihenpuffer (ein = Bypass; Standard: Abtauen)',
    pv_boost: 'PV-Überschussbetrieb (ein, oder Leistung über 0)',
    sg_ready: 'SG-Ready / EVU-Sperre (1–4 oder Text)',
    dhw_top: 'WW-Speicher oben (°C)', dhw_middle: 'WW-Speicher Mitte (°C)', dhw_bottom: 'WW-Speicher unten (°C)', dhw_target: 'WW-Soll (°C)', dhw_mode: 'WW-Betriebsart (Statustext)',
    circulation: 'Zirkulationspumpe läuft (ein/aus)', circulation_start: 'Zirkulationsfenster beginnt', circulation_end: 'Zirkulationsfenster endet', circulation_schedule: 'Zirkulations-Zeitplan (nächster Wechsel)', dhw_loss_sensor: 'Messsensor WW-Standbyverlust (°C)', buffer_top: 'Puffer oben (°C)', buffer_middle: 'Puffer Mitte (°C)', buffer_bottom: 'Puffer unten (°C)', buffer_mode: 'Puffer-Betriebsart (Statustext)',
    hc_flow: 'Heizkreis-Vorlauf (°C)', hc_return: 'Heizkreis-Rücklauf (°C)', hc_setpoint: 'Heizkreis-Vorlauf-Soll (°C)',
    hc_mode: 'Heizkreis-Betriebsart (Statustext)', hc_pump: 'Heizkreispumpe läuft (ein/aus)', hc_volume: 'Volumenstrom Heizkreis (l/h oder l/min, Heizkreispumpe)', hc_curve_offset: 'Heizkurven-Verschiebung (K)', hc_mixer: 'Mischer-Stellung oder -Anteil (%, wird angezeigt wie gemeldet)', hc_mixer_opening: 'Mischermotor öffnet (ein/aus)', hc_mixer_closing: 'Mischermotor schließt (ein/aus)', hc_pressure: 'Heizkreis-Druck (bar)', brine_pressure: 'Solekreis-Druck (bar)',
    cutout_high_pressure: 'Hochdruck-Abschaltungen (Anzahl der Ereignisse, kein Druck)', cutout_low_pressure: 'Niederdruck-Abschaltungen (Anzahl der Ereignisse, kein Druck)', cutout_temperature: 'Temperatur-Abschaltungen (Anzahl der Ereignisse, keine Temperatur)',
    room: 'Raumtemperatur (°C)', room_target: 'Raum-Soll (°C)', room_humidity: 'Raumluftfeuchte (%)', dew_point: 'Taupunkt (°C, optional)',
    env_energy: 'Umweltenergie gesamt (kWh)', pv: 'Strom aus PV (W)', battery: 'Strom aus Akku (W)', grid: 'Strom aus Netz (W)',
    cop_heating_today: 'COP Heizen heute', cop_dhw_today: 'COP WW heute', energy_today: 'Verbrauch heute (kWh)',
    pv_share_today: 'PV-Anteil heute (%)', starts_today: 'Verdichterstarts heute',
  },

  // Polish Editor by Krzysztonek 
  pl: {
    preset: 'Preset', prefix: 'Prefiks (puste = wykryj automatycznie)', device: 'Urządzenie (opcjonalnie, ogranicza preset)',
    title: 'Tytuł', language: 'Język', power_threshold: 'Praca powyżej (W)', hc_type: 'Emisja ciepła',
    power_sources: 'PV / akumulator / sieć', ps_auto: 'Panel energii, chyba że ustawiono poniżej', ps_manual: 'Tylko poniższe czujniki',
    source_type: 'Źródło ciepła', src_air: 'Powietrze', src_brine: 'Grunt (solanka)', src_water: 'Woda gruntowa',
    hc_count: 'Obiegi grzewcze', hc2_type: 'Emiter obiegu 2', hc3_type: 'Emiter obiegu 3', hc4_type: 'Emiter obiegu 4', hc5_type: 'Emiter obiegu 5', hc6_type: 'Emiter obiegu 6',
    unit_style: 'Rysunek urządzenia', unit_auto: 'Automatycznie (z presetu)', unit_generic: 'Ogólny (wentylator)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono',
    unit_size: 'Rozmiar Vaillant', size_small: '3.5 / 5.5 kW (1 wentylator, niski)', size_medium: '7.5 kW (1 wentylator)', size_large: '10.5 / 12.5 kW (2 wentylatory)',
    timeline: 'Oś czasu trybu pracy', timeline_hours: 'Długość osi czasu (godziny)', timeline_details: 'Szczegóły pracy pod osią czasu', timeline_marks: 'Pokaż etykiety (np. Podbicie) jako dodatkowe pasy',
    layout: 'Układ', layout_default: 'Domyślny', layout_compact: 'Kompaktowy (wąskie kolumny)', layout_wide: 'Szeroki (kafelki obok schematu)', layout_wall: 'Wyświetlacz ścienny (duży, kontrolki wygaszają się)',
    animations: 'Animacje', animations_auto: 'Automatycznie (uwzględnia redukcję ruchu)', animations_always: 'Zawsze', animations_off: 'Wyłączone',
    flow_speed: 'Prędkość animacji', source_spread: 'Pokaż rozpiętość źródła',
    theme: 'Motyw karty', theme_auto: 'Automatyczny (panel)', theme_night: 'Nocny', theme_contrast: 'Wysoki kontrast', fullscreen: 'Przycisk pełnego ekranu', diagnostic: 'Przycisk raportu diagnostycznego',
    wall_timeout: 'Ukryj kontrolki po (sekundy, 0 = nigdy)',
    narrow_values: 'Zachowaj podwartości zasobnika i powrót obiegu na wąskich kartach',
    narrow_focus: 'Skupienie na telefonie: większe kluczowe wartości na wąskich kartach, wartości pomocnicze w jednej linii pod schémou',
    buffer_values: 'Wyróżnienie temperatury bufora', buffer_values_default: 'Górna wartość prominentna (domyślnie)', buffer_values_equal: 'Wszystkie skonfigurowane wartości równe',
    assistant_device: 'Znajdź encje na tym urządzeniu pompy ciepła',
    assistant_device_help: 'Dostępne tylko wtedy, gdy nie wykryto żadnego obsługiwanego presetu. Sugestie nie są zapisywane do momentu ich wyboru i potwierdzenia.',
    assistant_title: 'Proponowane mapowanie encji',
    assistant_intro: 'Dokładne angielskie i niemieckie nazwy, jednostki oraz klasy urządzeń (device classes) są sprawdzane. Wybierz każdą propozycję, którą chcesz zapisać.',
    assistant_apply: 'Użyj wybranych propozycji', assistant_none: 'Nie znaleziono jednoznacznych propozycji na tym urządzeniu.',
    sec_boiler: 'Kocioł / drugi generator ciepła', boiler_state: 'Kocioł włączony (włączony/wyłączony lub moc powyżej 0)', boiler_power: 'Moc kotła (W lub kW)', boiler_flow: 'Temperatura zasilania kotła (°C)',
    dhw_loss_sensor: 'Pomiar strat postojowych c.w.u. (°C)',
    hc_mixer: 'Pozycja lub stopień otwarcia mieszacza (%, zgodnie z raportem)', hc_mixer_opening: 'Otwieranie silnika mieszacza (włączone/wyłączone)', hc_mixer_closing: 'Zamykanie silnika mieszacza (włączone/wyłączone)',
    hc_flow_label: 'Pokaż temperaturę zasilania obiegu', hc_return_label: 'Pokaż temperaturę powrotu obiegu', dew_point_margin: 'Minimalny margines punktu rosy (K)', series_buffer: 'Bufor szeregowy na powrocie', series_bypass: 'Bufor szeregowy z zaworem bocznikowym (wył.: obiegi pracują przy odszranianiu)', primary_pump: 'Pompa pierwotna', hc_name: 'Nazwa obiegu 1', hc2_name: 'Nazwa obiegu 2', hc3_name: 'Nazwa obiegu 3', hc4_name: 'Nazwa obiegu 4', hc5_name: 'Nazwa obiegu 5', hc6_name: 'Nazwa obiegu 6',
    sec_hc2: 'Obieg grzewczy 2', sec_hc3: 'Obieg grzewczy 3', sec_hc4: 'Obieg grzewczy 4', sec_hc5: 'Obieg grzewczy 5', sec_hc6: 'Obieg grzewczy 6', sec_details: 'Szczegóły: praca', sec_refrigerant: 'Szczegóły: obieg czynnika chłodniczego', sec_cutouts: 'Szczegóły: liczniki wyłączeń',
    controls: 'Szybkie sterowanie (przełącznik, przycisk, wybór, liczba…)', details_open: 'Szczegóły otwarte domyślnie',
    from_preset: 'Znalezione przez preset',
    sum_help: 'Suma tych encji',
    sec_advanced: 'Zaawansowane',
    tiles_custom: 'Własny wybór kafelków', tiles: 'Kafelki (przeciągnij, aby uporządkować)',
    tiles_custom_help: 'Wył.: domyślnie kafelki. Wł.: wybierz kafelki i okresy spośród udostępnianych przez tę instalację; pusta lista ukrywa wiersz.',
    tiles_yaml: 'Niektóre kafelki mają własną nazwę, encję, cenę lub akcję: edytuj je w YAML.',
    price_fixed: 'Cena energii elektrycznej za kWh', price_entity: 'Encja ceny energii elektrycznej',
    price_help: 'Włącza kafelek kosztów. Z encją posiadającą statystyki długoterminowe (np. taryfa dynamiczna), koszty są naliczane godzinowo.',
    untested: 'nieprzetestowane',
    untested_help: 'Jeszcze nieprzetestowane na prawdziwej instalacji. Proszę zgłosić, czy działa na: github.com/Sturmi77/heatpump-hydraulic-card/issues (Opinie o presecie).',
    warn_title: 'Brak w karcie',
    warn_running: 'Brak trybu pracy, sprężarki, statusu lub mocy: karta nie może określić, czy pompa ciepła pracuje.',
    warn_power: 'Brak mocy elektrycznej: brak COP na żywo oraz podziału na PV / akumulator / sieć z panelu energii.',
    warn_energy_sources: 'Panel energii: brak czujnika mocy dla {sources}; same liczniki energii nie pokazują przepływu na żywo.',
    warn_temps: 'Brak temperatury zasilania lub powrotu: brak różnicy temperatur (spread) i szacowanej mocy grzewczej.',
    warn_heat: 'Brak mocy grzewczej ani przepływu: brak COP na żywo.',
    preset_help: 'Znalezione encje są wypełniane poniżej. Wybierz inną encję, aby zastąpić wartość, lub wyczyść pole, aby je ukryć.',
    from_energy: 'Puste: pobierane z panelu energii',
    errors: 'Encje błędów', error_ok_text: 'Stany tekstowe oznaczające brak błędu',
    errors_help: 'Aktywne dla liczby różnej od 0 lub stanu włączonego. Tekst wymaga stanów braku błędu poniżej; stany: nieznany, niedostępny, wyłączony i puste są ignorowane.',
    error_ok_help: 'Rozdzielone przecinkami, bez rozróżniania wielkości liter; na przykład: No Error, OK. Każdy inny znany tekst wyświetli wtedy chybowy štítok.',
    total_cop_help: 'Całkowite ciepło, energia środowiskowa i energia elektryczna muszą obejmować ten sam przedział czasowy. Bez całkowitego ciepła COP używa energii środowiskowej plus energii elektrycznej.',
    language_help: 'Dodatkowe języki i niestandardowe etykiety są konfigurowane za pomocą tekstów w YAML; brakujące etykiety powracają do języka angielskiego.',
    detected: 'Wykryto', entities_found: 'encji', also_detected: 'Wykryto również tutaj:', not_detected: 'Nie znaleziono w tym Home Assistante – sprawdź integrację, prefiks lub wybierz inny preset',
    program: 'Program grzewczy (eko, nocny, party, wakacje)', solar_collector: 'Temperatura kolektora słonecznego', solar_pump: 'Pompa solarna działa (binarna)',
    source_out: 'Temperatura na wyjściu źródła', heater: 'Zapasowa / wbudowana grzałka aktywna',
    dhw_heater: 'Grzałka c.w.u. aktywna', buffer_heater: 'Grzałka bufora aktywna',
    hc_underfloor: 'Ogrzewanie podłogowe', hc_radiator: 'Grzejniki płytowe', hc_column: 'Grzejniki członowe',
    brine_pressure_min: 'Ostrzeżenie o niskim ciśnieniu solanki poniżej', brine_pressure_crit: 'Krytyczne niskie ciśnienie solanki poniżej', brine_pressure_max: 'Ostrzeżenie o wysokim ciśnieniu solanki powyżej',
    hc_pressure_min: 'Ostrzeżenie o niskim ciśnieniu ogrzewania poniżej', hc_pressure_crit: 'Krytyczne niskie ciśnienie ogrzewania poniżej', hc_pressure_max: 'Ostrzeżenie o wysokim ciśnieniu ogrzewania powyżej',
    sec_hp: 'Pompa ciepła', sec_storage: 'Magazyn energii', sec_hc: 'Obieg grzewczy i dom', sec_power: 'Źródła zasilania', sec_stats: 'Statystyki',
    mode: 'Tryb pracy', status: 'Status / podstan', compressor: 'Sprężarka działa (binarna lub częstotliwość)', defrost: 'Odszranianie aktywne (binarne)', fan_speed: 'Prędkość wentylatora (obr./min lub binarna)', power: 'Moc elektryczna',
    heat: 'Moc grzewcza', flow: 'Temperatura na zasilaniu', return: 'Temperatura na powrocie', volume: 'Przepływ po stronie grzewczej',
    source_volume: 'Przepływ po stronie źródła', source_in: 'Temperatura źródła / wlotu powietrza', outdoor: 'Temperatura zewnętrzna',
    valve: 'Zawór przełączający c.w.u. (binarny lub Zbiornik/Pomieszczenie)', bypass_valve: 'Zawór bocznikowy bufora szeregowego (włączony = obejście; domyślnie: odszranianie)',
    pv_boost: 'Tryb nadwyżki PV (włączony, lub moc powyżej 0)',
    sg_ready: 'SG-Ready / blokada taryfowa (1–4 lub tekst)',
    dhw_top: 'Zasobnik c.w.u. góra', dhw_middle: 'Zasobnik c.w.u. środek', dhw_bottom: 'Zasobnik c.w.u. dół', dhw_target: 'Temperatura docelowa c.w.u.', dhw_mode: 'Tryb c.w.u.',
    circulation: 'Pompa cyrkulacyjna', circulation_start: 'Początek okna cyrkulacji', circulation_end: 'Koniec okna cyrkulacji', circulation_schedule: 'Harmonogram cyrkulacji (następna zmiana)', buffer_top: 'Bufor góra', buffer_middle: 'Bufor środek', buffer_bottom: 'Bufor dół', buffer_mode: 'Tryb bufora',
    hc_flow: 'Temperatura zasilania obiegu', hc_return: 'Temperatura powrotu obiegu', hc_setpoint: 'Docelowa temperatura zasilania obiegu',
    hc_mode: 'Tryb obiegu', hc_pump: 'Pompa obiegowa działa (binarna)', hc_volume: 'Przepływ obiegu', hc_curve_offset: 'Przesunięcie krzywej grzewczej (K)', hc_pressure: 'Ciśnienie w obiegu grzewczym', brine_pressure: 'Ciśnienie w obiegu solanki',
    cutout_high_pressure: 'Wyłączenia wysokociśnieniowe (liczba zdarzeń, a nie ciśnienie)', cutout_low_pressure: 'Wyłączenia niskociśnieniowe (liczba zdarzeń, a nie ciśnienie)', cutout_temperature: 'Wyłączenia temperaturowe (liczba zdarzeń, a nie temperatura)',
    room: 'Temperatura w pomieszczeniu', room_target: 'Docelowa temperatura w pomieszczeniu', room_humidity: 'Wilgotność w pomieszczeniu (%)', dew_point: 'Punkt rosy (°C, opcjonalnie)',
    env_energy: 'Całkowita energia środowiskowa', pv: 'Moc z PV (W)', battery: 'Moc z akumulatora (W)', grid: 'Moc z sieci (W)',
    cop_heating_today: 'COP ogrzewania dzisiaj', cop_dhw_today: 'COP c.w.u. dzisiaj', energy_today: 'Energia dzisiaj (kWh)',
    pv_share_today: 'Udział PV dzisiaj (%)', starts_today: 'Liczba uruchomień sprężarki dzisiaj',
    unit_wolf: 'Wolf CHA',
    unit_kronoterm: 'Kronoterm ADAPT',
    unit_alpha_innotec: 'Alpha Innotec Hybrox',
    unit_stiebel: 'Stiebel Eltron WPL-A',
    storage: 'Zasobnik',
    storage_separate: 'Oddzielny zasobnik c.w.u. i bufor',
    storage_combined: 'Zasobnik kombinowany (jeden zbiornik, strefa c.w.u. na górze)',
    buffer: 'Bufor równoległy (również bez czujników)',
    dhw_type: 'Przygotowanie ciepłej wody',
    dhw_type_coil: 'Zasobnik z wężownicą wymiennika',
    dhw_type_fresh_water: 'Stacja świeżej wody (na buforze lub zasobniku kombinowanym)',
    dhw_type_tank_in_tank: 'Zasobnik w zasobniku (zbiornik kombinowany)',
    warn_valve: 'Zawór przełączający raportuje liczbę i nie ma stanów zaworu: karta odczytuje 1 jako ciepłą wodę. Jeśli 1 oznacza ogrzewanie, ustaw jego stany w sekcji Zaawansowane.',
    warn_map_entities: 'Parametr {maps} znajduje się pod encjami (entities), gdzie karta go ignoruje. W YAML należy umieścić go na najwyższym poziomie konfiguracji karty.',
    valve_dhw_text: 'Stany zaworu dla ciepłej wody',
    valve_heating_text: 'Stany zaworu dla ogrzewania',
    valve_help: 'Rozdzielone przecinkami surowe stany encji zaworu, na przykład 0, 1 lub Tank. Aktualny stan: {state}.',
    dhw_heater_top: 'Grzałka c.w.u. u góry aktywna (włączona/wyłączona lub W)',
    dhw_heater_middle: 'Grzałka c.w.u. pośrodku aktywna (włączona/wyłączona lub W)',
    dhw_heater_bottom: 'Grzałka c.w.u. na dole aktywna (włączona/wyłączona lub W)',
    buffer_heater_top: 'Grzałka bufora u góry aktywna (włączona/wyłączona lub W)',
    buffer_heater_middle: 'Grzałka bufora pośrodku aktywna (włączona/wyłączona lub W)',
    buffer_heater_bottom: 'Grzałka bufora na dole aktywna (włączona/wyłączona lub W)',
    size_pana_medium: '1 wentylator (3 do 9 kW)',
    size_pana_large: '2 wentylatory (T-CAP, 12 i 16 kW)',
    more_fields: 'Więcej pól',
    warn_disabled: 'Preset użyłby tych encji, ale w Home Assistant są one wyłączone: {list}. Włącz je w menu Ustawienia → Urządzenia i usługi → Encje.',
    checks_title: 'Sprawdź te pola',
    check_unit: '{field}: {entity} raportuje jednostkę {unit}, oczekiwano {expected}.',
    check_domain: '{field}: {entity} jest encją typu {domain}, oczekiwano {expected}.',
    check_state: '{field}: {entity} raportuje stan \"{state}\", oczekiwano {expected}.',
    check_counter: '{field}: {entity} jest licznikiem (wartość stale rośnie), oczekiwano {expected}.',
    check_same: '{field}: {entity} jest również używana dla {other}; te dwa pola mierzą jednak odrębne wielkości.',
    check_air: '{field}: {entity} jest ustawiona, ale źródłem ciepła jest powietrze. Karta nie rysuje obiegu solanki ani studni; wyczyść to pole lub zmień źródło ciepła.',
    check_setting: '{field}: {entity} jest ustawieniem ({domain}), a nie tym, co pompa ciepła robi w tej chwili. Wybrany tryb typu „Tylko ogrzewanie” jest odczytywany jako tryb czuwania; pozostaw pole puste lub wskaż czujnik aktualnej pracy.',
    check_today: '{field}: {entity} raportuje wartość {value}, co przekracza możliwości jednego dnia. Czy to licznik całkowity?',
    kind_temperature: 'temperatura (°C)',
    kind_offset: 'różnica temperatur (K)',
    kind_power: 'moc (W lub kW)',
    kind_energy: 'energia (kWh)',
    kind_pressure: 'ciśnienie (bar)',
    kind_flowrate: 'natężenie przepływu (l/h, l/min lub m³/h)',
    kind_hours: 'czas trwania (h)',
    kind_percent: 'procent (%)',
    kind_counter: 'licznik bez jednostki',
    kind_ratio: 'liczba bez jednostki',
    kind_speed: 'włączony/wyłączony, częstotliwość lub prędkość',
    kind_onoff: 'włączony/wyłączony',
    kind_onoff_power: 'włączony/wyłączony, stopień lub moc (W)',
    kind_valve: 'włączony/wyłączony lub stan taki jak Zasobnik/Pomieszczenie',
    kind_text: 'tekst stanu',
    all_entities: 'Pokaż wszystkie encje w selektorach',
    all_entities_help: 'Wył.: pola pomiarowe oferują wyłącznie encje, których jednostka lub klasa urządzenia odpowiadają (°C, W, kWh, bar, l/h). Wł.: każda encja, przydatne dla czujników bez przypisanej jednostki.',
  },
  
  // Slovak by Havinko1991 (#177): the editor labels; the card texts fall back to English.
  sk: {
    preset: 'Predvoľba', prefix: 'Predpona (prázdne = automatická detekcia)', device: 'Zariadenie (voliteľné, obmedzuje predvoľbu)',
    title: 'Názov', language: 'Jazyk', power_threshold: 'Beží nad (W)', hc_type: 'Vykurovacie teleso',
    power_sources: 'FVE / batéria / sieť', ps_auto: 'Energetický panel, pokiaľ nie je nastavené nižšie', ps_manual: 'Iba senzory nižšie',
    source_type: 'Zdroj tepla', src_air: 'Vzduch', src_brine: 'Zem (nemrznúca zmes)', src_water: 'Podzemná voda',
    hc_count: 'Vykurovacie okruhy', hc2_type: 'Teleso okruhu 2', hc3_type: 'Teleso okruhu 3', hc4_type: 'Teleso okruhu 4', hc5_type: 'Teleso okruhu 5', hc6_type: 'Teleso okruhu 6',
    unit_style: 'Nákres jednotky', unit_auto: 'Automaticky (z predvoľby)', unit_generic: 'Všeobecná (ventilátor)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono',
    unit_size: 'Veľkosť Vaillant', size_small: '3.5 / 5.5 kW (1 ventilátor, nízky)', size_medium: '7.5 kW (1 ventilátor)', size_large: '10.5 / 12.5 kW (2 ventilátory)',
    timeline: 'Časová os prevádzkového režimu', timeline_hours: 'Dĺžka časovej osi (hodiny)', timeline_details: 'Podrobnosti behu pod časovou osou', timeline_marks: 'Zobraziť odznaky (napr. Boost) ako extra riadky',
    layout: 'Rozloženie', layout_default: 'Predvolené', layout_compact: 'Kompaktné (úzke stĺpce)', layout_wide: 'Široké (dlaždice vedľa schémy)', layout_wall: 'Nástenný displej (veľký, ovládacie prvky miznú)',
    animations: 'Animácie', animations_auto: 'Automaticky (rešpektovať obmedzenie pohybu)', animations_always: 'Vždy', animations_off: 'Vypnuté',
    flow_speed: 'Rýchlosť animácie', source_spread: 'Zobraziť rozpätie (spread) zdroja',
    theme: 'Téma karty', theme_auto: 'Automaticky (podľa panelu)', theme_night: 'Nočná', theme_contrast: 'Vysoký kontrast', fullscreen: 'Tlačidlo na celú obrazovku', diagnostic: 'Tlačidlo diagnostickej správy',
    wall_timeout: 'Skryť ovládacie prvky po (sekundy, 0 = nikdy)',
    narrow_values: 'Ponechať podhodnoty akumulačnej nádrže a spiatočku okruhu na úzkych kartách',
    narrow_focus: 'Mobilné zobrazenie: hlavné hodnoty na úzkych kartách väčšie, vedľajšie v jednom riadku pod schémou',
    buffer_values: 'Zvýraznenie teplôt akumulačnej nádrže', buffer_values_default: 'Zvýrazniť hornú hodnotu (predvolené)', buffer_values_equal: 'Všetky nakonfigurované hodnoty rovnocenné',
    assistant_device: 'Nájsť entity na tomto zariadení tepelného čerpadla',
    assistant_device_help: 'Dostupné iba vtedy, ak nie je detegovaný žiadny podporovaný profil (preset). Návrhy sa neuložia, kým ich nevyberiete a nepotvrdíte.',
    assistant_title: 'Navrhované mapovanie entít',
    assistant_intro: 'Kontrolujú sa presné anglické a nemecké názvy, jednotky a triedy zariadení (device classes). Vyberte každý návrh, ktorý chcete uložiť.',
    assistant_apply: 'Použiť vybrané návrhy', assistant_none: 'Na tomto zariadení sa nenašli žiadne jednoznačné návrhy.',
    sec_boiler: 'Kotol / druhý zdroj tepla', boiler_state: 'Kotol v prevádzke (zap/vyp, alebo výkon nad 0)', boiler_power: 'Výkon kotla (W alebo kW)', boiler_flow: 'Teplota výstupu z kotla (°C)',
    dhw_loss_sensor: 'Meranie pohotovostných strát TÚV (°C)',
    hc_mixer: 'Poloha alebo podiel zmiešavacieho ventilu (%, zobrazené podľa stavu)', hc_mixer_opening: 'Otváranie motora zmiešavača (zap/vyp)', hc_mixer_closing: 'Zatváranie motora zmiešavača (zap/vyp)',
    hc_flow_label: 'Zobraziť prívod okruhu', hc_return_label: 'Zobraziť spiatočku okruhu', dew_point_margin: 'Minimálny odstup od rosného bodu (K)', series_buffer: 'Sériový akumulačný zásobník na spiatočke', series_bypass: 'Sériový akumulačný zásobník s obtokovým ventilom (vypnuté: okruhy bežia v odmrazovaní)', primary_pump: 'Primárne čerpadlo', hc_name: 'Názov okruhu 1', hc2_name: 'Názov okruhu 2', hc3_name: 'Názov okruhu 3', hc4_name: 'Názov okruhu 4', hc5_name: 'Názov okruhu 5', hc6_name: 'Názov okruhu 6',
    sec_hc2: 'Vykurovací okruh 2', sec_hc3: 'Vykurovací okruh 3', sec_hc4: 'Vykurovací okruh 4', sec_hc5: 'Vykurovací okruh 5', sec_hc6: 'Vykurovací okruh 6', sec_details: 'Podrobnosti: prevádzka', sec_refrigerant: 'Podrobnosti: chladiaci okruh', sec_cutouts: 'Podrobnosti: počítadlá vypnutí',
    controls: 'Rýchle ovládanie (prepínač, tlačidlo, výber, číslo…)', details_open: 'Podrobnosti predvolene otvorené',
    from_preset: 'Nájdené predvoľbou',
    sum_help: 'Súčet týchto entít',
    sec_advanced: 'Pokročilé',
    tiles_custom: 'Vlastný výber dlaždíc', tiles: 'Dlaždice (potiahnutím zoradíte)',
    tiles_custom_help: 'Vypnuté: predvolené dlaždice. Zapnuté: vyberte dlaždice a obdobia z toho, čo táto inštalácia poskytuje; prázdny zoznam riadok skryje.',
    tiles_yaml: 'Niektoré dlaždice majú vlastný názov, entitu, cenu alebo akciu: upravte ich v YAML.',
    price_fixed: 'Cena elektriny za kWh', price_entity: 'Entita ceny elektriny',
    price_help: 'Aktivuje dlaždicu nákladov. S entitou, ktorá má dlhodobé štatistiky (napr. dynamická tarifa), sa náklady účtujú po hodinách.',
    untested: 'netestované',
    untested_help: 'Zatiaľ netestované na reálnej inštalácii. Nahláste prosím, či to funguje na: github.com/Sturmi77/heatpump-hydraulic-card/issues (Spätná väzba k predvoľbám).',
    warn_title: 'Chýba na karte',
    warn_running: 'Žiadny prevádzkový režim, kompresor, stav ani výkon: karta nedokáže určiť, či tepelné čerpadlo beží.',
    warn_power: 'Žiadny elektrický výkon: chýba aktuálne COP a rozdelenie FVE / batéria / sieť z energetického panelu.',
    warn_energy_sources: 'Energetický panel: chýba senzor výkonu pre {sources}; samotné merače energie nedokážu zobraziť aktuálny prietok.',
    warn_temps: 'Žiadna teplota na prívode ani spiatočke: žiadne rozpätie (spread) a žiadny odhadovaný tepelný výkon.',
    warn_heat: 'Žiadny tepelný výkon ani prietok: chýba aktuálne COP.',
    preset_help: 'Nájdené entity sú vyplnené nižšie. Vyberte inú entitu na prepísanie hodnoty, alebo vymažte pole pre jej skrytie.',
    from_energy: 'Prázdne: prebraté z energetického panelu',
    errors: 'Chybové entity', error_ok_text: 'Textové stavy znamenajúce bezchybný stav',
    errors_help: 'Aktívne pre číslo iné ako 0 alebo stav zapnuté. Text vyžaduje bezchybné stavy uvedené nižšie; neznáme, nedostupné, vypnuté a prázdne hodnoty sa ignorujú.',
    error_ok_help: 'Oddelené čiarkou, bez ohľadu na veľkosť písmen; napríklad: No Error, OK. Akýkoľvek iný známy text potom zobrazí chybový štítok.',
    total_cop_help: 'Celkové teplo, energia prostredia a elektrina musia pokrývať rovnaký časový rozsah. Bez celkového tepla využíva COP energiu prostredia plus elektrinu.',
    language_help: 'Ďalšie jazyky a vlastné štítky sa konfigurujú pomocou textov v YAML; chýbajúce štítky sa nahradia angličtinou.',
    detected: 'Zistené', entities_found: 'entít', also_detected: 'Tu sa tiež zistilo:', not_detected: 'Nenašlo sa v tomto Home Assistante – skontrolujte integráciu, predponu alebo zvoľte inú predvoľbu',
    program: 'Vykurovací program (eko, nočný, párty, dovolenka)', solar_collector: 'Teplota solárneho kolektora', solar_pump: 'Solárne čerpadlo beží (binárne)',
    source_out: 'Teplota na výstupe zdroja', heater: 'Záložný / prídavný ohrev aktívny',
    dhw_heater: 'Vykurovacia tyč TÚV aktívna', buffer_heater: 'Vykurovacia tyč akumulačného zásobníka aktívna',
    hc_underfloor: 'Podlahové vykurovanie', hc_radiator: 'Doskové radiátory', hc_column: 'Článkové radiátory',
    brine_pressure_min: 'Varovanie: nízky tlak nemrznúcej zmesi pod', brine_pressure_crit: 'Kritický nízky tlak nemrznúcej zmesi pod', brine_pressure_max: 'Varovanie: vysoký tlak nemrznúcej zmesi nad',
    hc_pressure_min: 'Varovanie: nízky tlak vykurovania pod', hc_pressure_crit: 'Kritický nízky tlak vykurovania pod', hc_pressure_max: 'Varovanie: vysoký tlak vykurovania nad',
    sec_hp: 'Tepelné čerpadlo', sec_storage: 'Zásobník', sec_hc: 'Vykurovací okruh a dom', sec_power: 'Zdroje energie', sec_stats: 'Štatistiky',
    mode: 'Prevádzkový režim', status: 'Stav / podstav', compressor: 'Kompresor beží (binárne alebo frekvencia)', defrost: 'Odmrazovanie aktívne (binárne)', fan_speed: 'Rýchlosť ventilátora (ot/min alebo binárne)', power: 'Elektrický výkon',
    heat: 'Tepelný výkon', flow: 'Teplota na prívode', return: 'Teplota na spiatočke', volume: 'Prietok na strane vykurovania',
    source_volume: 'Prietok na strane zdroja', source_in: 'Teplota zdroja / prívodu vzduchu', outdoor: 'Vonkajšia teplota',
    valve: 'Prepínací ventil na TÚV (binárne alebo Nádrž/Miestnosť)', bypass_valve: 'Obtokový ventil sériového akumulačného zásobníka (zapnuté = obtok; predvolené: odmrazovanie)',
    pv_boost: 'Režim prebytku FVE (zapnuté, alebo výkon nad 0)',
    sg_ready: 'SG-Ready / blokovanie siete (1–4 alebo text)',
    dhw_top: 'Nádrž TÚV hore', dhw_middle: 'Nádrž TÚV v strede', dhw_bottom: 'Nádrž TÚV dole', dhw_target: 'Cieľová teplota TÚV', dhw_mode: 'Režim TÚV',
    circulation: 'Cirkulačné čerpadlo', circulation_start: 'Začiatok okna cirkulácie', circulation_end: 'Koniec okna cirkulácie', circulation_schedule: 'Plán cirkulácie (ďalšia zmena)', buffer_top: 'Akumulačný zásobník hore', buffer_middle: 'Akumulačný zásobník v strede', buffer_bottom: 'Akumulačný zásobník dole', buffer_mode: 'Režim akumulačného zásobníka',
    hc_flow: 'Teplota prívodu okruhu', hc_return: 'Teplota spiatočky okruhu', hc_setpoint: 'Cieľová teplota prívodu okruhu',
    hc_mode: 'Režim okruhu', hc_pump: 'Čerpadlo okruhu beží (binárne)', hc_volume: 'Prietok okruhu', hc_curve_offset: 'Posun vykurovacej krivky (K)', hc_pressure: 'Tlak vo vykurovacom okruhu', brine_pressure: 'Tlak v okruhu nemrznúcej zmesi',
    cutout_high_pressure: 'Vysokotlakové vypnutia (počet udalostí, nie tlak)', cutout_low_pressure: 'Nízkotlakové vypnutia (počet udalostí, nie tlak)', cutout_temperature: 'Teplotné vypnutia (počet udalostí, nie teplota)',
    room: 'Teplota v miestnosti', room_target: 'Cieľová teplota v miestnosti', room_humidity: 'Vlhkosť v miestnosti (%)', dew_point: 'Rosný bod (°C, voliteľné)',
    env_energy: 'Celková energia prostredia', pv: 'Výkon z FVE (W)', battery: 'Výkon z batérie (W)', grid: 'Výkon zo siete (W)',
    cop_heating_today: 'COP vykurovania dnes', cop_dhw_today: 'COP TÚV dnes', energy_today: 'Energia dnes (kWh)',
    pv_share_today: 'Podiel FVE dnes (%)', starts_today: 'Počet štartov kompresora dnes',
    unit_wolf: 'Wolf CHA',
    unit_kronoterm: 'Kronoterm ADAPT',
    unit_alpha_innotec: 'Alpha Innotec Hybrox',
    unit_stiebel: 'Stiebel Eltron WPL-A',
    storage: 'Zásobník',
    storage_separate: 'Samostatná nádrž na teplú vodu a akumulačný zásobník',
    storage_combined: 'Kombinovaný zásobník (jedna nádrž, zóna teplej vody hore)',
    buffer: 'Paralelný akumulačný zásobník (aj bez snímačov)',
    dhw_type: 'Príprava teplej vody',
    dhw_type_coil: 'Nádrž s vnútorným výmenníkom (hadom)',
    dhw_type_fresh_water: 'Stanica na čerstvú vodu (na akumulačnom alebo kombinovanom zásobníku)',
    dhw_type_tank_in_tank: 'Nádrž v nádrži (kombinovaný zásobník)',
    warn_valve: 'Prepínací ventil hlási číslo a nemá nastavené stavy ventilu: karta číta hodnotu 1 ako teplú vodu. Ak 1 znamená vykurovanie, nastavte jeho stavy v sekcii Pokročilé.',
    warn_map_entities: 'Parameter {maps} sa nachádza pod entitami (entities), kde ho karta ignoruje. V YAML patrí na najvyššiu úroveň konfigurácie karty.',
    valve_dhw_text: 'Stavy ventilu pre teplú vodu',
    valve_heating_text: 'Stavy ventilu pre vykurovanie',
    valve_help: 'Čiarkou oddelené surové stavy entity ventilu, napríklad 0, 1 alebo Tank. Aktuálny stav: {state}.',
    dhw_heater_top: 'Vykurovacia tyč TÚV hore aktívna (zap/vyp, alebo W)',
    dhw_heater_middle: 'Vykurovacia tyč TÚV v strede aktívna (zap/vyp, alebo W)',
    dhw_heater_bottom: 'Vykurovacia tyč TÚV dole aktívna (zap/vyp, alebo W)',
    buffer_heater_top: 'Vykurovacia tyč akumulačného zásobníka hore aktívna (zap/vyp, alebo W)',
    buffer_heater_middle: 'Vykurovacia tyč akumulačného zásobníka v strede aktívna (zap/vyp, alebo W)',
    buffer_heater_bottom: 'Vykurovacia tyč akumulačného zásobníka dole aktívna (zap/vyp, alebo W)',
    // Field checks, pickers, "More fields", disabled entities and the Panasonic sizes, by Havinko1991 (#191).
    size_pana_medium: '1 ventilátor (3 až 9 kW)',
    size_pana_large: '2 ventilátory (T-CAP, 12 a 16 kW)',
    more_fields: 'Ďalšie polia',
    warn_disabled: 'Predvoľba by chcela použiť tieto entity, ale v Home Assistantovi sú zakázané: {list}. Povoľte ich v menu Nastavenia → Zariadenia a služby → Entity.',
    checks_title: 'Skontrolujte tieto polia',
    check_unit: '{field}: {entity} hlási jednotku {unit}, očakáva sa {expected}.',
    check_domain: '{field}: {entity} je entita typu {domain}, očakáva sa {expected}.',
    check_state: '{field}: {entity} hlási stav \"{state}\", očakáva sa {expected}.',
    check_counter: '{field}: {entity} je počítadlo (hodnota iba rastie), očakáva sa {expected}.',
    check_same: '{field}: {entity} sa používa aj pre {other}; tieto dve polia však merajú odlišné veličiny.',
    check_air: '{field}: {entity} je nastavené, ale zdrojom tepla je vzduch. Karta nekreslí okruh nemrznúcej zmesi ani studne; vymažte toto pole alebo zmeňte zdroj tepla.',
    check_setting: '{field}: {entity} je nastavenie ({domain}), nie to, čo tepelné čerpadlo práve robí. Zvolený režim ako „Len kúrenie“ sa číta ako pohotovosť; nechajte pole prázdne alebo zvoľte senzor aktuálnej prevádzky.',
    check_today: '{field}: {entity} hlási hodnotu {value}, čo je viac, než dokáže priniesť jeden deň. Ide o celkové počítadlo?',
    kind_temperature: 'teplota (°C)',
    kind_offset: 'teplotný rozdiel (K)',
    kind_power: 'výkon (W alebo kW)',
    kind_energy: 'energia (kWh)',
    kind_pressure: 'tlak (bar)',
    kind_flowrate: 'prietok (l/h, l/min alebo m³/h)',
    kind_hours: 'doba trvania (h)',
    kind_percent: 'percento (%)',
    kind_counter: 'počet bez jednotky',
    kind_ratio: 'číslo bez jednotky',
    kind_speed: 'zap/vyp, frekvencia alebo otáčky',
    kind_onoff: 'zap/vyp',
    kind_onoff_power: 'zap/vyp, stupeň alebo výkon (W)',
    kind_valve: 'zap/vyp, alebo stav ako Nádrž/Miestnosť',
    kind_text: 'text stavu',
    all_entities: 'Zobraziť všetky entity vo výberoch',
    all_entities_help: 'Vypnuté: polia meraní ponúkajú iba entity, ktorých jednotka alebo trieda zariadenia sedí (°C, W, kWh, bar, l/h). Zapnuté: každá entita, vhodné pre senzory bez jednotky.',
  },
  // Czech by Havinko1991 (#182): the editor labels; the card texts fall back to English.
  cs: {
    preset: 'Předvolba', prefix: 'Předpona (prázdné = automatická detekce)', device: 'Zařízení (volitelné, omezuje předvolbu)',
    title: 'Název', language: 'Jazyk', power_threshold: 'Běží nad (W)', hc_type: 'Topné těleso',
    power_sources: 'FVE / baterie / síť', ps_auto: 'Energetický panel, pokud není nastaveno níže', ps_manual: 'Pouze senzory níže',
    source_type: 'Zdroj tepla', src_air: 'Vzduch', src_brine: 'Země (nemrznoucí směs)', src_water: 'Podzemní voda',
    hc_count: 'Topné okruhy', hc2_type: 'Těleso okruhu 2', hc3_type: 'Těleso okruhu 3', hc4_type: 'Těleso okruhu 4', hc5_type: 'Těleso okruhu 5', hc6_type: 'Těleso okruhu 6',
    unit_style: 'Nákres jednotky', unit_auto: 'Automaticky (z předvolby)', unit_generic: 'Obecná (ventilátor)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono',
    unit_size: 'Velikost Vaillant', size_small: '3.5 / 5.5 kW (1 ventilátor, nízký)', size_medium: '7.5 kW (1 ventilátor)', size_large: '10.5 / 12.5 kW (2 ventilátory)',
    timeline: 'Časová osa provozního režimu', timeline_hours: 'Délka časové osy (hodiny)', timeline_details: 'Podrobnosti běhu pod časovou osou', timeline_marks: 'Zobrazit odznaky (např. Boost) jako extra řádky',
    layout: 'Rozvržení', layout_default: 'Výchozí', layout_compact: 'Kompaktní (úzké sloupce)', layout_wide: 'Široké (dlaždice vedle schématu)', layout_wall: 'Nástěnný displej (velký, ovládací prvky mizí)',
    animations: 'Animace', animations_auto: 'Automaticky (respektovat omezení pohybu)', animations_always: 'Vždy', animations_off: 'Vypnuto',
    flow_speed: 'Rychlost animace', source_spread: 'Zobrazit rozpětí (spread) zdroje',
    theme: 'Téma karty', theme_auto: 'Automaticky (podle panelu)', theme_night: 'Noční', theme_contrast: 'Vysoký kontrast', fullscreen: 'Tlačítko na celou obrazovku', diagnostic: 'Tlačítko diagnostické zprávy',
    wall_timeout: 'Skrýt ovládací prvky po (sekundy, 0 = nikdy)',
    narrow_values: 'Ponechat podhodnoty akumulační nádrže a zpátečku okruhu na úzkých kartách',
    narrow_focus: 'Mobilní zobrazení: hlavní hodnoty na úzkých kartách větší, vedlejší v jednom řádku pod schématem',
    buffer_values: 'Zvýraznění teplot akumulační nádrže', buffer_values_default: 'Zvýraznit horní hodnotu (výchozí)', buffer_values_equal: 'Všechny nakonfigurované hodnoty rovnocenné',
    assistant_device: 'Najít entity na tomto zařízení tepelného čerpadla',
    assistant_device_help: 'Dostupné pouze tehdy, pokud není detekován žádný podporovaný profil (preset). Návrhy se neuloží, dokud je nevyberete a nepotvrdíte.',
    assistant_title: 'Navrhované mapování entit',
    assistant_intro: 'Kontrolují se přesné anglické a německé názvy, jednotky a třídy zařízení (device classes). Vyberte každý návrh, který chcete uložit.',
    assistant_apply: 'Použít vybrané návrhy', assistant_none: 'Na tomto zařízení nebyly nalezeny žádné jednoznačné návrhy.',
    sec_boiler: 'Kotel / druhý zdroj tepla', boiler_state: 'Kotel v provozu (zap/vyp, nebo výkon nad 0)', boiler_power: 'Výkon kotle (W nebo kW)', boiler_flow: 'Teplota výstupu z kotle (°C)',
    dhw_loss_sensor: 'Měření pohotovostních ztrát TÚV (°C)',
    hc_mixer: 'Poloha nebo podíl směšovacího ventilu (%, zobrazeno podle stavu)', hc_mixer_opening: 'Otevírání motoru směšovače (zap/vyp)', hc_mixer_closing: 'Zavírání motoru směšovače (zap/vyp)',
    hc_flow_label: 'Zobrazit přívod okruhu', hc_return_label: 'Zobrazit zpátečku okruhu', dew_point_margin: 'Minimální odstup od rosného bodu (K)', series_buffer: 'Sériový akumulační zásobník na zpátečce', series_bypass: 'Sériový akumulační zásobník s obtokovým ventilem (vypnuto: okruhy běží v odmrazování)', primary_pump: 'Primární čerpadlo', hc_name: 'Název okruhu 1', hc2_name: 'Název okruhu 2', hc3_name: 'Název okruhu 3', hc4_name: 'Název okruhu 4', hc5_name: 'Název okruhu 5', hc6_name: 'Název okruhu 6',
    sec_hc2: 'Topný okruh 2', sec_hc3: 'Topný okruh 3', sec_hc4: 'Topný okruh 4', sec_hc5: 'Topný okruh 5', sec_hc6: 'Topný okruh 6', sec_details: 'Podrobnosti: provoz', sec_refrigerant: 'Podrobnosti: chladicí okruh', sec_cutouts: 'Podrobnosti: počítadla vypnutí',
    controls: 'Rychlé ovládání (přepínač, tlačítko, výběr, číslo…)', details_open: 'Podrobnosti výchozně otevřené',
    from_preset: 'Nalezeno předvolbou',
    sum_help: 'Součet těchto entit',
    sec_advanced: 'Pokročilé',
    tiles_custom: 'Vlastní výběr dlaždic', tiles: 'Dlaždice (tažením seřadíte)',
    tiles_custom_help: 'Vypnuto: výchozí dlaždice. Zapnuto: vyberte dlaždice a období z toho, co tato instalace poskytuje; prázdny seznam řádek skryje.',
    tiles_yaml: 'Některé dlaždice mají vlastní název, entitu, cenu nebo akci: upravte je v YAML.',
    price_fixed: 'Cena elektřiny za kWh', price_entity: 'Entita ceny elektřiny',
    price_help: 'Aktivuje dlaždici nákladů. S entitou, která má dlouhodobé statistiky (např. dynamická tarifa), se náklady účtují po hodinách.',
    untested: 'netestováno',
    untested_help: 'Zatím netestováno na reálné instalaci. Nahlaste prosím, zda to funguje na: github.com/Sturmi77/heatpump-hydraulic-card/issues (Zpětná vazba k předvolbám).',
    warn_title: 'Chybí na kartě',
    warn_running: 'Žádný provozní režim, kompresor, stav ani výkon: karta nedokáže určit, zda tepelné čerpadlo běží.',
    warn_power: 'Žádný elektrický výkon: chybí aktuální COP a rozdělení FVE / baterie / síť z energetického panelu.',
    warn_energy_sources: 'Energetický panel: chýba senzor výkonu pro {sources}; samotné měřiče energie nedokážou zobrazit aktuální průtok.',
    warn_temps: 'Žádná teplota na přívodu ani zpátečce: žádné rozpětí (spread) a žádný odhadovaný tepelný výkon.',
    warn_heat: 'Žao dný tepelný výkon ani průtok: chybí aktuální COP.',
    preset_help: 'Nalezené entity jsou vyplněny níže. Vyberte jinou entitu pro přepsání hodnoty, nebo vymažte pole pro její skrytí.',
    from_energy: 'Prázdné: převzato z energetického panelu',
    errors: 'Chybové entity', error_ok_text: 'Textové stavy znamenající bezchybný stav',
    errors_help: 'Aktivní pro číslo jiné než 0 nebo stav zapnuto. Text vyžaduje bezchybné stavy uvedené níže; neznámé, nedostupné, vypnuté a prázdné hodnoty se ignorují.',
    error_ok_help: 'Oddělené čárkou, bez ohledu na velikost písmen; například: No Error, OK. Jakýkoli jiný známý text pak zobrazí chybový štítek.',
    total_cop_help: 'Celkové teplo, energie prostředí a elektřina musí pokrývat stejný časový rozsah. Bez celkového tepla využívá COP energii prostředí plus elektřinu.',
    language_help: 'Další jazyky a vlastní štítky se konfigurují pomocí textů v YAML; chybějící štítky se nahradí angličtinou.',
    detected: 'Zjištěno', entities_found: 'entit', also_detected: 'Zde bylo také zjištěno:', not_detected: 'Nenalezeno v tomto Home Assistantovi – zkontrolujte integraci, předponu nebo zvolte jinou předvolbu',
    program: 'Topný program (eko, noční, párty, dovolená)', solar_collector: 'Teplota solárního kolektoru', solar_pump: 'Solární čerpadlo běží (binární)',
    source_out: 'Teplota na výstupu zdroje', heater: 'Záložní / přídavný ohřev aktivní',
    dhw_heater: 'Topná tyč TUV aktivní', buffer_heater: 'Topná tyč akumulačního zásobníku aktivní',
    hc_underfloor: 'Podlahové vytápění', hc_radiator: 'Deskové radiátory', hc_column: 'Článkové radiátory',
    brine_pressure_min: 'Varování: nízký tlak nemrznoucí směsi pod', brine_pressure_crit: 'Kritický nízký tlak nemrznoucí směsi pod', brine_pressure_max: 'Varování: vysoký tlak nemrznoucí směsi nad',
    hc_pressure_min: 'Varování: nízký tlak vytápění pod', hc_pressure_crit: 'Kritický nízký tlak vytápění pod', hc_pressure_max: 'Varování: vysoký tlak vytápění nad',
    sec_hp: 'Tepelné čerpadlo', sec_storage: 'Zásobník', sec_hc: 'Topný okruh a dům', sec_power: 'Zdroje energie', sec_stats: 'Statistiky',
    mode: 'Provozní režim', status: 'Stav / podstav', compressor: 'Kompresor běží (binární nebo frekvence)', defrost: 'Odmrazování aktivní (binární)', fan_speed: 'Rychlost ventilátoru (ot/min nebo binární)', power: 'Elektrický výkon',
    heat: 'Tepelný výkon', flow: 'Teplota na přívodu', return: 'Teplota na zpátečce', volume: 'Průtok na straně vytápění',
    source_volume: 'Průtok na strane zdroje', source_in: 'Teplota zdroje / přívodu vzduchu', outdoor: 'Venkovní teplota',
    valve: 'Přepínací ventil na TUV (binární nebo Nádrž/Místnost)', bypass_valve: 'Obtokový ventil sériového akumulačního zásobníku (zapnuto = obtok; výchozí: odmrazování)',
    pv_boost: 'Režim přebytku FVE (zapnuto, nebo výkon nad 0)',
    sg_ready: 'SG-Ready / blokování sítě (1–4 nebo text)',
    dhw_top: 'Nádrž TUV nahoře', dhw_middle: 'Nádrž TUV uprostřed', dhw_bottom: 'Nádrž TUV dole', dhw_target: 'Cílová teplota TUV', dhw_mode: 'Režim TUV',
    circulation: 'Cirkulační čerpadlo', circulation_start: 'Začátek okna cirkulace', circulation_end: 'Konec okna cirkulace', circulation_schedule: 'Plán cirkulace (další změna)', buffer_top: 'Akumulační zásobník nahoře', buffer_middle: 'Akumulační zásobník uprostřed', buffer_bottom: 'Akumulační zásobník dole', buffer_mode: 'Režim akumulačního zásobníku',
    hc_flow: 'Teplota přívodu okruhu', hc_return: 'Teplota zpátečky okruhu', hc_setpoint: 'Cílová teplota přívodu okruhu',
    hc_mode: 'Režim okruhu', hc_pump: 'Čerpadlo okruhu běží (binární)', hc_volume: 'Průtok okruhu', hc_curve_offset: 'Posun topné křivky (K)', hc_pressure: 'Tlak v topném okruhu', brine_pressure: 'Tlak v okruhu nemrznoucí směsi',
    cutout_high_pressure: 'Vysokotlaká vypnutí (počet událostí, nikoli tlak)', cutout_low_pressure: 'Nízkotlaká vypnutí (počet událostí, nikoli tlak)', cutout_temperature: 'Teplotní vypnutí (počet událostí, nikoli teplota)',
    room: 'Teplota v místnosti', room_target: 'Cílová teplota v místnosti', room_humidity: 'Vlhkost v místnosti (%)', dew_point: 'Rosný bod (°C, volitelné)',
    env_energy: 'Celková energie prostředí', pv: 'Výkon z FVE (W)', battery: 'Výkon z baterie (W)', grid: 'Výkon ze sítě (W)',
    cop_heating_today: 'COP vytápění dnes', cop_dhw_today: 'COP TUV dnes', energy_today: 'Energie dnes (kWh)',
    pv_share_today: 'Podíl FVE dnes (%)', starts_today: 'Počet startů kompresoru dnes',
    unit_wolf: 'Wolf CHA',
    unit_kronoterm: 'Kronoterm ADAPT',
    unit_alpha_innotec: 'Alpha Innotec Hybrox',
    unit_stiebel: 'Stiebel Eltron WPL-A',
    storage: 'Zásobník',
    storage_separate: 'Samostatná nádrž na teplou vodu a akumulační zásobník',
    storage_combined: 'Kombinovaný zásobník (jedna nádrž, zóna teplé vody nahoře)',
    buffer: 'Paralelní akumulační zásobník (i bez snímačů)',
    dhw_type: 'Příprava teplé vody',
    dhw_type_coil: 'Nádrž s vnitřním výměníkem (hadem)',
    dhw_type_fresh_water: 'Stanice na čerstvou vodu (na akumulačním nebo kombinovaném zásobníku)',
    dhw_type_tank_in_tank: 'Nádrž v nádrži (kombinovaný zásobník)',
    warn_valve: 'Přepínací ventil hlásí číslo a nemá nastavené stavy ventilu: karta čte hodnotu 1 jako teplou vodu. Pokud 1 znamená vytápění, nastavte jeho stavy v sekci Pokročilé.',
    warn_map_entities: 'Parametr {maps} se nachází pod entitami (entities), kde jej karta ignoruje. V YAML patří na nejvyšší úroveň konfigurace karty.',
    valve_dhw_text: 'Stavy ventilu pro teplou vodu',
    valve_heating_text: 'Stavy ventilu pro vytápění',
    valve_help: 'Čárkou oddělené surové stavy entity ventilu, například 0, 1 nebo Tank. Aktuální stav: {state}.',
    dhw_heater_top: 'Topná tyč TUV nahoře aktivní (zap/vyp, nebo W)',
    dhw_heater_middle: 'Topná tyč TUV uprostřed aktivní (zap/vyp, nebo W)',
    dhw_heater_bottom: 'Topná tyč TUV dole aktivní (zap/vyp, nebo W)',
    buffer_heater_top: 'Topná tyč akumulačního zásobníku nahoře aktivní (zap/vyp, nebo W)',
    buffer_heater_middle: 'Topná tyč akumulačního zásobníku uprostřed aktivní (zap/vyp, nebo W)',
    buffer_heater_bottom: 'Topná tyč akumulačního zásobníku dole aktivní (zap/vyp, nebo W)',
    // Field checks, pickers, "More fields", disabled entities and the Panasonic sizes, by Havinko1991 (#191).
    size_pana_medium: '1 ventilátor (3 až 9 kW)',
    size_pana_large: '2 ventilátory (T-CAP, 12 a 16 kW)',
    more_fields: 'Další pole',
    warn_disabled: 'Předvolba by chtěla použít tyto entity, ale v Home Assistantovi jsou zakázané: {list}. Povolte je v menu Nastavení → Zařízení a služby → Entity.',
    checks_title: 'Zkontrolujte tato pole',
    check_unit: '{field}: {entity} hlásí jednotku {unit}, očekává se {expected}.',
    check_domain: '{field}: {entity} je entita typu {domain}, očekává se {expected}.',
    check_state: '{field}: {entity} hlásí stav \"{state}\", očekává se {expected}.',
    check_counter: '{field}: {entity} je počítadlo (hodnota pouze roste), očekává se {expected}.',
    check_same: '{field}: {entity} se používá také pro {other}; tato dvě pole však měří odlišné veličiny.',
    check_air: '{field}: {entity} je nastaveno, ale zdrojem tepla je vzduch. Karta nekreslí okruh nemrznoucí směsi ani studny; vymažte toto pole nebo změňte zdroj tepla.',
    check_setting: '{field}: {entity} je nastavení ({domain}), ne to, co tepelné čerpadlo právě dělá. Zvolený režim jako „Jen topení“ se čte jako pohotovost; nechte pole prázdné nebo zvolte senzor aktuálního provozu.',
    check_today: '{field}: {entity} hlásí hodnotu {value}, což je více, než dokáže přinést jeden den. Jedná se o celkové počítadlo?',
    kind_temperature: 'teplota (°C)',
    kind_offset: 'teplotní rozdíl (K)',
    kind_power: 'výkon (W nebo kW)',
    kind_energy: 'energie (kWh)',
    kind_pressure: 'tlak (bar)',
    kind_flowrate: 'průtok (l/h, l/min nebo m³/h)',
    kind_hours: 'doba trvání (h)',
    kind_percent: 'procento (%)',
    kind_counter: 'počet bez jednotky',
    kind_ratio: 'číslo bez jednotky',
    kind_speed: 'zap/vyp, frekvence nebo otáčky',
    kind_onoff: 'zap/vyp',
    kind_onoff_power: 'zap/vyp, stupeň nebo výkon (W)',
    kind_valve: 'zap/vyp, nebo stav jako Nádrž/Místnost',
    kind_text: 'text stavu',
    all_entities: 'Zobrazit všechny entity ve výběrech',
    all_entities_help: 'Vypnuto: pole měření nabízejí pouze entity, jejichž jednotka nebo třída zařízení sedí (°C, W, kWh, bar, l/h). Zapnuto: každá entita, vhodné pro senzory bez jednotky.',
  },
  nl: {
    preset: 'Preset', prefix: 'Voorvoegsel (leeg = automatisch)', device: 'Apparaat (optioneel, beperkt de preset)',
    title: 'Titel', language: 'Taal', power_threshold: 'Actief boven (W)', hc_type: 'Afgiftesysteem',
    power_sources: 'PV / accu / net', ps_auto: 'Energiedashboard, tenzij hieronder ingesteld', ps_manual: 'Alleen de sensoren hieronder',
    source_type: 'Warmtebron', src_air: 'Lucht', src_brine: 'Bodem (brine)', src_water: 'Grondwater',
    hc_count: 'Verwarmingsgroepen', hc2_type: 'Afgifte groep 2', hc3_type: 'Afgifte groep 3', hc4_type: 'Afgifte groep 4', hc5_type: 'Afgifte groep 5', hc6_type: 'Afgifte groep 6',
    unit_style: 'Tekening buitenunit', unit_auto: 'Automatisch (uit de preset)', unit_generic: 'Algemeen (ventilator)', unit_lambda: 'Lambda EU-L', unit_vaillant: 'Vaillant aroTHERM plus', unit_panasonic: 'Panasonic Aquarea', unit_viessmann: 'Viessmann Vitocal', unit_bosch: 'Bosch / Buderus', unit_saunier: 'Saunier Duval GeniaAir', unit_samsung: 'Samsung EHS Mono', unit_wolf: 'Wolf CHA', unit_kronoterm: 'Kronoterm ADAPT', unit_alpha_innotec: 'Alpha Innotec Hybrox', unit_stiebel: 'Stiebel Eltron WPL-A',
    unit_size: 'Grootte van de buitenunit', size_pana_medium: '1 ventilator (3 tot 9 kW)', size_pana_large: '2 ventilatoren (T-CAP, 12 en 16 kW)', size_small: '3,5 / 5,5 kW (1 ventilator, laag)', size_medium: '7,5 kW (1 ventilator)', size_large: '10,5 / 12,5 kW (2 ventilatoren)',
    timeline: 'Tijdlijn van de bedrijfsstand', timeline_hours: 'Lengte tijdlijn (uren)', timeline_details: 'Rundetails onder de tijdlijn', timeline_marks: 'Badges (bijv. Boost) als extra banen tonen',
    layout: 'Opmaak', layout_default: 'Standaard', layout_compact: 'Compact (smalle kolommen)', layout_wide: 'Breed (tegels naast het schema)', layout_wall: 'Wandscherm (groot, bediening verdwijnt)',
    animations: 'Animaties', animations_auto: 'Automatisch (respecteert minder beweging)', animations_always: 'Altijd', animations_off: 'Uit',
    flow_speed: 'Animatiesnelheid', source_spread: 'ΔT van de bron tonen',
    theme: 'Kaartthema', theme_auto: 'Automatisch (dashboard)', theme_night: 'Nacht', theme_contrast: 'Hoog contrast', fullscreen: 'Knop volledig scherm', diagnostic: 'Knop diagnoserapport',
    wall_timeout: 'Bediening verbergen na (seconden, 0 = nooit)',
    hc_flow_label: 'Aanvoertemperatuur per groep tonen', hc_return_label: 'Retourtemperatuur per groep tonen', dew_point_margin: 'Minimale dauwpuntsmarge (K)', narrow_values: 'Vat-subwaarden, warmwaterdoel en groepsretour op smalle kaarten tonen', narrow_focus: 'Telefoonweergave: kernwaarden groter op smalle kaarten, bijwaarden in één regel eronder', buffer_values: 'Nadruk buffertemperaturen', buffer_values_default: 'Bovenste waarde prominent (standaard)', buffer_values_equal: 'Alle ingestelde waarden gelijk', storage: 'Opslag', storage_separate: 'Apart warmwatervat en buffervat', storage_combined: 'Combivat (één vat, warmwaterzone bovenin)', buffer: 'Parallel buffervat (ook zonder sensoren)', dhw_type: 'Warmwaterbereiding', dhw_type_coil: 'Vat met warmtewisselaarspiraal', dhw_type_fresh_water: 'Verswaterstation (op het buffervat of het combivat)', dhw_type_tank_in_tank: 'Tank in tank (combivat)', series_buffer: 'Seriebuffer in de retour', series_bypass: 'Seriebuffer met bypassklep (uit: de groepen draaien door bij ontdooien)', primary_pump: 'Primaire pomp', hc_name: 'Naam groep 1', hc2_name: 'Naam groep 2', hc3_name: 'Naam groep 3', hc4_name: 'Naam groep 4', hc5_name: 'Naam groep 5', hc6_name: 'Naam groep 6',
    sec_hc2: 'Verwarmingsgroep 2', sec_hc3: 'Verwarmingsgroep 3', sec_hc4: 'Verwarmingsgroep 4', sec_hc5: 'Verwarmingsgroep 5', sec_hc6: 'Verwarmingsgroep 6', sec_details: 'Details: bedrijf', sec_refrigerant: 'Details: koudemiddelcircuit', sec_cutouts: 'Details: uitschakeltellers',
    controls: 'Snelbediening (schakelaar, knop, keuzelijst, getal …)', details_open: 'Details standaard open',
    from_preset: 'Gevonden door de preset', more_fields: 'Meer velden',
    sum_help: 'Som van deze entiteiten',
    sec_advanced: 'Geavanceerd',
    tiles_custom: 'Eigen tegelkeuze', tiles: 'Tegels (sleep om te sorteren)',
    tiles_custom_help: 'Uit: standaardtegels. Aan: kies tegels en periodes uit wat deze installatie levert; een lege lijst verbergt de rij.',
    tiles_yaml: 'Sommige tegels hebben een eigen naam, entiteit, prijs of actie: bewerk die in YAML.',
    price_fixed: 'Stroomprijs per kWh', price_entity: 'Entiteit stroomprijs',
    price_help: 'Schakelt de kostentegel in. Met een entiteit met langetermijnstatistieken (bijv. een dynamisch tarief) worden de kosten per uur berekend.',
    untested: 'niet getest',
    untested_help: 'Nog niet getest op een echte installatie. Laat weten of het werkt: github.com/Sturmi77/heatpump-hydraulic-card/issues (Preset feedback).',
    warn_title: 'Ontbreekt in de kaart',
    warn_running: 'Geen bedrijfsstand, compressor, status of vermogen: de kaart kan niet zien of de warmtepomp draait.',
    warn_power: 'Geen elektrisch vermogen: geen live COP, en geen verdeling PV / accu / net uit het energiedashboard.',
    warn_energy_sources: 'Energiedashboard: geen vermogenssensor voor {sources}; met alleen energietellers is geen live stroom te tonen.',
    warn_temps: 'Geen aanvoer- of retourtemperatuur: geen ΔT en geen geschat warmtevermogen.',
    warn_heat: 'Geen warmtevermogen en geen debiet: geen live COP.',
    warn_valve: 'De driewegklep meldt een getal en heeft geen klepstanden: de kaart leest 1 als warm water. Betekent 1 bij deze klep verwarmen, stel de standen dan in onder Geavanceerd.',
    warn_map_entities: '{maps} staat onder entities, waar de kaart het negeert. In YAML hoort het op het hoogste niveau van de kaartconfiguratie.',
    warn_disabled: 'De preset zou deze entiteiten gebruiken, maar ze zijn uitgeschakeld in Home Assistant: {list}. Schakel ze in via Instellingen → Apparaten & diensten → Entiteiten.',
    checks_title: 'Controleer deze velden',
    check_unit: '{field}: {entity} meldt {unit}, verwacht {expected}.',
    check_domain: '{field}: {entity} is een {domain}-entiteit, verwacht {expected}.',
    check_state: '{field}: {entity} meldt "{state}", verwacht {expected}.',
    check_counter: '{field}: {entity} is een teller (loopt alleen op), verwacht {expected}.',
    check_same: '{field}: {entity} wordt ook gebruikt voor {other}; de twee velden meten verschillende dingen.',
    check_air: '{field}: {entity} is ingesteld, maar de warmtebron is lucht. De kaart tekent geen bron- of putcircuit; maak het veld leeg of stel de warmtebron in.',
    check_setting: '{field}: {entity} is een instelling ({domain}), niet wat de warmtepomp nu doet. Een gekozen stand zoals „Alleen verwarmen“ geldt als stand-by; laat het veld leeg of kies een sensor van de huidige werking.',
    check_today: '{field}: {entity} meldt {value}, meer dan één dag kan opleveren. Is het de totaalteller?',
    kind_temperature: 'een temperatuur (°C)', kind_offset: 'een temperatuurverschil (K)', kind_power: 'een vermogen (W of kW)', kind_energy: 'een energie (kWh)',
    kind_pressure: 'een druk (bar)', kind_flowrate: 'een debiet (l/h, l/min of m³/h)', kind_hours: 'een duur (h)', kind_percent: 'een percentage (%)',
    kind_counter: 'een aantal zonder eenheid', kind_ratio: 'een getal zonder eenheid', kind_speed: 'aan/uit, of een frequentie of toerental',
    kind_onoff: 'aan/uit', kind_onoff_power: 'aan/uit, een trap of een vermogen (W)', kind_valve: 'aan/uit, of een stand zoals Tank/Room', kind_text: 'een statustekst',
    all_entities: 'Alle entiteiten tonen in de keuzelijsten',
    all_entities_help: 'Uit: meetvelden bieden entiteiten met een passende eenheid of apparaatklasse (°C, W, kWh, bar, l/h). Aan: elke entiteit, voor sensoren zonder eenheid.',
    preset_help: 'Gevonden entiteiten zijn hieronder ingevuld. Kies een andere entiteit om er een te vervangen, maak een veld leeg om het te verbergen.',
    from_energy: 'Leeg: uit het energiedashboard',
    errors: 'Storingsentiteiten', error_ok_text: 'Tekststanden die geen storing betekenen',
    valve_dhw_text: 'Klepstanden voor warm water', valve_heating_text: 'Klepstanden voor verwarmen',
    valve_help: 'Kommagescheiden ruwe standen van de klepentiteit, bijvoorbeeld 0, 1 of Tank. Huidige stand: {state}.',
    errors_help: 'Actief bij een getal anders dan 0 of de stand on. Tekst vraagt om de geen-storing-standen hieronder; unknown, unavailable, off en leeg worden genegeerd.',
    error_ok_help: 'Kommagescheiden, hoofdletterongevoelig; bijvoorbeeld: No Error, OK. Elke andere bekende tekst toont dan de storingschip.',
    total_cop_help: 'Totale warmte, omgevingsenergie en stroom moeten dezelfde periode beslaan. Zonder totale warmte gebruikt de COP omgevingsenergie plus stroom.',
    language_help: 'Extra talen en eigen labels stel je in met texts in YAML; ontbrekende labels vallen terug op Engels.',
    detected: 'Gevonden', entities_found: 'entiteiten', also_detected: 'Hier ook gevonden:', not_detected: 'Niet gevonden in deze Home Assistant - controleer de integratie, het voorvoegsel of kies een andere preset',
    program: 'Verwarmingsprogramma (eco, nacht, party, vakantie)', solar_collector: 'Temperatuur zonnecollector (°C)', solar_pump: 'Zonnepomp actief (aan/uit)',
    source_out: 'Uitlaattemperatuur bron (°C: brine of putwater uit)', heater: 'Bijverwarming van de warmtepomp actief (aan/uit, trap 1 tot 3, of W)',
    dhw_heater: 'Verwarmingselement warmwatervat actief (aan/uit, of W)', buffer_heater: 'Verwarmingselement buffervat actief (aan/uit, of W)',
    dhw_heater_top: 'Verwarmingselement bovenin warmwatervat actief (aan/uit, of W)', dhw_heater_middle: 'Verwarmingselement midden warmwatervat actief (aan/uit, of W)', dhw_heater_bottom: 'Verwarmingselement onderin warmwatervat actief (aan/uit, of W)',
    buffer_heater_top: 'Verwarmingselement bovenin buffervat actief (aan/uit, of W)', buffer_heater_middle: 'Verwarmingselement midden buffervat actief (aan/uit, of W)', buffer_heater_bottom: 'Verwarmingselement onderin buffervat actief (aan/uit, of W)',
    hc_underfloor: 'Vloerverwarming', hc_radiator: 'Paneelradiatoren', hc_column: 'Ledenradiatoren',
    brine_pressure_min: 'Brondruk waarschuwing onder', brine_pressure_crit: 'Brondruk kritiek onder', brine_pressure_max: 'Brondruk waarschuwing boven',
    hc_pressure_min: 'Verwarmingsdruk waarschuwing onder', hc_pressure_crit: 'Verwarmingsdruk kritiek onder', hc_pressure_max: 'Verwarmingsdruk waarschuwing boven',
    sec_hp: 'Warmtepomp', sec_storage: 'Opslag', sec_hc: 'Verwarmingsgroep & woning', sec_power: 'Stroombronnen', sec_stats: 'Statistieken',
    mode: 'Bedrijfsstand (statustekst)', status: 'Status / substatus (tekst)', compressor: 'Compressor actief (aan/uit, of frequentie / toerental boven 0)', defrost: 'Ontdooien actief (aan/uit)', fan_speed: 'Ventilatortoerental (rpm, of aan/uit)', power: 'Elektrisch vermogen van de warmtepomp (W of kW)',
    heat: 'Warmtevermogen (kW of W)', flow: 'Aanvoertemperatuur warmtepomp (°C)', return: 'Retourtemperatuur warmtepomp (°C)', volume: 'Debiet van het warmtepompcircuit (l/h of l/min, primaire pomp)',
    source_volume: 'Debiet van het bron- of putcircuit (l/h of l/min, niet voor lucht)', source_in: 'Inlaattemperatuur bron (°C: lucht, brine of putwater in)', outdoor: 'Buitentemperatuur (°C)',
    valve: 'Driewegklep naar warm water (aan/uit, of een stand zoals Tank/Room)', bypass_valve: 'Bypassklep seriebuffer (aan = bypass; standaard: ontdooien)',
    pv_boost: 'PV-overschotstand (aan, of een vermogen boven 0)',
    sg_ready: 'SG-Ready / netblokkering (1–4 of tekst)',
    dhw_top: 'Warmwatervat boven (°C)', dhw_middle: 'Warmwatervat midden (°C)', dhw_bottom: 'Warmwatervat onder (°C)', dhw_target: 'Warmwaterdoel (°C)', dhw_mode: 'Warmwaterstand (statustekst)',
    circulation: 'Circulatiepomp actief (aan/uit)', circulation_start: 'Circulatievenster begint', circulation_end: 'Circulatievenster eindigt', circulation_schedule: 'Circulatieschema (volgende wissel)', dhw_loss_sensor: 'Meetsensor stilstandsverlies warm water (°C)', buffer_top: 'Buffervat boven (°C)', buffer_middle: 'Buffervat midden (°C)', buffer_bottom: 'Buffervat onder (°C)', buffer_mode: 'Bufferstand (statustekst)',
    hc_flow: 'Aanvoertemperatuur groep (°C)', hc_return: 'Retourtemperatuur groep (°C)', hc_setpoint: 'Aanvoerdoel groep (°C)',
    hc_mode: 'Stand groep (statustekst)', hc_pump: 'Groepspomp actief (aan/uit)', hc_volume: 'Debiet van de verwarmingsgroep (l/h of l/min, groepspomp)', hc_curve_offset: 'Verschuiving stooklijn (K)', hc_pressure: 'Druk verwarmingsgroep (bar)', brine_pressure: 'Druk broncircuit (bar)',
    cutout_high_pressure: 'Hogedrukuitschakelingen (aantal keer, geen druk)', cutout_low_pressure: 'Lagedrukuitschakelingen (aantal keer, geen druk)', cutout_temperature: 'Temperatuuruitschakelingen (aantal keer, geen temperatuur)',
    room: 'Kamertemperatuur (°C)', room_target: 'Kamerdoel (°C)', room_humidity: 'Luchtvochtigheid kamer (%)', dew_point: 'Dauwpunt (°C, optioneel)',
    env_energy: 'Omgevingsenergie totaal (kWh)', pv: 'Vermogen uit PV (W)', battery: 'Vermogen uit accu (W)', grid: 'Vermogen uit net (W)',
    cop_heating_today: 'COP verwarmen vandaag', cop_dhw_today: 'COP warm water vandaag', energy_today: 'Energie vandaag (kWh)',
    pv_share_today: 'PV-aandeel vandaag (%)', starts_today: 'Compressorstarts vandaag',
    assistant_device: 'Entiteiten zoeken op dit warmtepompapparaat',
    assistant_device_help: 'Alleen beschikbaar als er geen ondersteunde preset is gevonden. Voorstellen worden pas opgeslagen als je ze selecteert en bevestigt.',
    assistant_title: 'Voorgestelde koppeling van entiteiten',
    assistant_intro: 'Exacte Engelse en Duitse namen, eenheden en apparaatklassen worden gecontroleerd. Selecteer elk voorstel dat je wilt opslaan.',
    assistant_apply: 'Geselecteerde voorstellen gebruiken',
    assistant_none: 'Geen eenduidige voorstellen gevonden op dit apparaat.',
    sec_boiler: 'Ketel / tweede warmteopwekker', boiler_state: 'Ketel actief (aan/uit, of een vermogen boven 0)', boiler_power: 'Ketelvermogen (W of kW)', boiler_flow: 'Aanvoertemperatuur ketel (°C)',
    hc_mixer: 'Stand of aandeel mengklep (%, getoond zoals gemeld)', hc_mixer_opening: 'Mengklepmotor opent (aan/uit)', hc_mixer_closing: 'Mengklepmotor sluit (aan/uit)',
  },
};

// Heating circuits the card can draw; circuit 1 uses the plain hc_ keys, circuits 2 to 6 hc2_ to hc6_.
const HFC_MAX_HC = 6;
// Entities that make a preset match useful; the best match is the preset that finds most of them live (#143).
const HFC_CORE_KEYS = ['mode', 'compressor', 'power', 'flow', 'return', 'dhw_top'];
const hfcHcCount = (config) => Math.min(Math.max(Math.round(+config?.hc_count) || 1, 1), HFC_MAX_HC);
// Keys whose list of entities is averaged (#23): room temperature and humidity of each circuit. Power, heat and the power
// sources add up their lists instead; every other key takes the first entity of a list.
const hfcMeanKey = (key) => /^(hc[2-6]_)?room(_humidity)?$/.test(key);

const HFC_ENTITY_GROUPS = {
  sec_hp: ['mode', 'status', 'compressor', 'fan_speed', 'defrost', 'power', 'heat', 'flow', 'return', 'volume', 'source_volume', 'source_in', 'source_out', 'brine_pressure', 'outdoor', 'valve', 'heater', 'pv_boost', 'sg_ready'],
  sec_boiler: ['boiler_state', 'boiler_power', 'boiler_flow'],
  sec_storage: ['dhw_top', 'dhw_middle', 'dhw_bottom', 'dhw_target', 'dhw_mode', 'circulation', 'circulation_start', 'circulation_end', 'circulation_schedule', 'dhw_loss_sensor', 'dhw_heater', 'dhw_heater_top', 'dhw_heater_middle', 'dhw_heater_bottom', 'buffer_top', 'buffer_middle', 'buffer_bottom', 'buffer_mode', 'buffer_heater', 'buffer_heater_top', 'buffer_heater_middle', 'buffer_heater_bottom', 'bypass_valve', 'solar_collector', 'solar_pump'],
  sec_hc: ['hc_flow', 'hc_return', 'hc_setpoint', 'hc_mode', 'hc_pump', 'hc_volume', 'hc_curve_offset', 'hc_mixer', 'hc_mixer_opening', 'hc_mixer_closing', 'hc_pressure', 'room', 'room_target', 'room_humidity', 'dew_point', 'program'],
  // The room of circuit 1 uses room/room_target; circuits 2 to 6 use their numbered keys in the shared house overview.
  sec_hc2: ['hc2_flow', 'hc2_return', 'hc2_setpoint', 'hc2_mode', 'hc2_pump', 'hc2_volume', 'hc2_curve_offset', 'hc2_mixer', 'hc2_mixer_opening', 'hc2_mixer_closing', 'hc2_room', 'hc2_room_target', 'hc2_room_humidity', 'hc2_dew_point'],
  sec_hc3: ['hc3_flow', 'hc3_return', 'hc3_setpoint', 'hc3_mode', 'hc3_pump', 'hc3_volume', 'hc3_curve_offset', 'hc3_mixer', 'hc3_mixer_opening', 'hc3_mixer_closing', 'hc3_room', 'hc3_room_target', 'hc3_room_humidity', 'hc3_dew_point'],
  sec_hc4: ['hc4_flow', 'hc4_return', 'hc4_setpoint', 'hc4_mode', 'hc4_pump', 'hc4_volume', 'hc4_curve_offset', 'hc4_mixer', 'hc4_mixer_opening', 'hc4_mixer_closing', 'hc4_room', 'hc4_room_target', 'hc4_room_humidity', 'hc4_dew_point'],
  sec_hc5: ['hc5_flow', 'hc5_return', 'hc5_setpoint', 'hc5_mode', 'hc5_pump', 'hc5_volume', 'hc5_curve_offset', 'hc5_mixer', 'hc5_mixer_opening', 'hc5_mixer_closing', 'hc5_room', 'hc5_room_target', 'hc5_room_humidity', 'hc5_dew_point'],
  sec_hc6: ['hc6_flow', 'hc6_return', 'hc6_setpoint', 'hc6_mode', 'hc6_pump', 'hc6_volume', 'hc6_curve_offset', 'hc6_mixer', 'hc6_mixer_opening', 'hc6_mixer_closing', 'hc6_room', 'hc6_room_target', 'hc6_room_humidity', 'hc6_dew_point'],
  sec_power: ['pv', 'battery', 'grid'],
  sec_details: ['hours', 'starts_total', 'aux_hours', 'energy_total', 'env_energy', 'heat_total'],
  sec_refrigerant: ['compressor_speed', 'evap_temp', 'cond_temp', 'suction_temp', 'hot_gas', 'liquid_temp', 'low_pressure', 'high_pressure', 'eev', 'superheat', 'subcooling'],
  sec_cutouts: ['cutout_high_pressure', 'cutout_low_pressure', 'cutout_temperature'],
  sec_stats: ['cop_heating_today', 'cop_dhw_today', 'energy_today', 'pv_share_today', 'starts_today'],
};
const HFC_DIAGNOSTIC_KEYS = [...new Set(Object.values(HFC_ENTITY_GROUPS).flat())];
// Editor (#193): the fields a group shows before "More fields" (circuits 2 to 6 use those of circuit 1), and the fields of a brine
// or well loop, which an air heat pump does not have.
const HFC_CORE_FIELDS = ['mode', 'compressor', 'power', 'heat', 'flow', 'return', 'volume', 'outdoor', 'valve', 'boiler_state', 'boiler_power', 'boiler_flow', 'dhw_top', 'dhw_target',
  'hc_flow', 'hc_return', 'hc_pump', 'room'];
const HFC_SOURCE_KEYS = ['source_volume', 'source_out', 'brine_pressure'];
// Entity domains usable as quick controls and the service each one calls.
const HFC_CONTROL_DOMAINS = ['switch', 'input_boolean', 'light', 'fan', 'automation', 'button', 'input_button', 'script', 'scene',
  'select', 'input_select', 'water_heater', 'climate', 'number', 'input_number'];
// Heater rods of the tanks: the plain key keeps its place between the middle and the bottom sensor, a key with a position stands at
// that height (a large tank can have a rod at the top, in the middle and at the bottom).
const HFC_TANK_HEATERS = ['dhw_heater', 'dhw_heater_top', 'dhw_heater_middle', 'dhw_heater_bottom', 'buffer_heater', 'buffer_heater_top', 'buffer_heater_middle', 'buffer_heater_bottom'];
// What an entity key expects (#192). The plausibility checks, the entity picker of the editor (#194) and the unit in the field labels
// follow this table. units: accepted units (lower case); device_class and domains: positive evidence for the picker; domains also
// limit what the checks accept; numeric: the state is a number; extra: further units an on/off key accepts (power, speed).
const HFC_KINDS = {
  temperature: { units: ['°c', '°f', 'k'], device_class: 'temperature', domains: ['sensor', 'number', 'input_number', 'climate', 'water_heater'], numeric: true, label: '°C' },
  offset: { units: ['k', '°c', '°f'], domains: ['sensor', 'number', 'input_number'], numeric: true, label: 'K' },
  power: { units: ['w', 'kw', 'mw', 'gw', 'tw', 'btu/h'], device_class: 'power', domains: ['sensor', 'number', 'input_number'], numeric: true, label: 'W' },
  energy: { units: ['wh', 'kwh', 'mwh'], device_class: 'energy', domains: ['sensor', 'number', 'input_number'], numeric: true, label: 'kWh' },
  pressure: { units: ['bar', 'mbar', 'pa', 'hpa', 'kpa', 'mpa', 'psi'], device_class: 'pressure', domains: ['sensor', 'number', 'input_number'], numeric: true, label: 'bar' },
  flowrate: { units: ['l/h', 'l/min', 'l/s', 'm³/h', 'm3/h'], device_class: 'volume_flow_rate', domains: ['sensor', 'number', 'input_number'], numeric: true, label: 'l/h' },
  hours: { units: ['h', 'min', 's', 'd'], device_class: 'duration', domains: ['sensor', 'number', 'input_number'], numeric: true },
  percent: { units: ['%'], domains: ['sensor', 'number', 'input_number'], numeric: true, label: '%' },
  counter: { domains: ['sensor', 'number', 'input_number', 'counter'], numeric: true },
  ratio: { domains: ['sensor', 'number', 'input_number'], numeric: true },
  speed: { extra: ['hz', 'rpm', '1/min', 'min⁻¹', 'rps', '%'], domains: ['binary_sensor', 'switch', 'input_boolean', 'sensor'], onoff: true },
  onoff: { extra: ['%'], domains: ['binary_sensor', 'switch', 'input_boolean', 'sensor'], onoff: true },
  onoff_power: { extra: ['w', 'kw', '%'], domains: ['binary_sensor', 'switch', 'input_boolean', 'sensor'], onoff: true },
  valve: { domains: ['binary_sensor', 'switch', 'input_boolean', 'sensor', 'select', 'input_select'], onoff: true },
  text: { domains: ['sensor', 'select', 'input_select', 'binary_sensor', 'switch', 'climate', 'water_heater', 'input_text', 'text'] },
  time: { domains: ['time', 'input_datetime', 'sensor', 'input_text', 'text'] },
  schedule: { domains: ['schedule'] },
};
// Keys of circuits 2 to 6 use the kind of circuit 1 (hc2_flow → hc_flow, hc2_room → room); keys not listed are not checked.
const HFC_KEY_KINDS = Object.fromEntries(Object.entries({
  temperature: ['flow', 'return', 'source_in', 'source_out', 'outdoor', 'boiler_flow', 'dhw_top', 'dhw_middle', 'dhw_bottom', 'dhw_target', 'dhw_loss_sensor', 'buffer_top', 'buffer_middle',
    'buffer_bottom', 'solar_collector', 'hc_flow', 'hc_return', 'hc_setpoint', 'room', 'room_target', 'dew_point', 'evap_temp', 'cond_temp', 'suction_temp', 'hot_gas', 'liquid_temp'],
  offset: ['hc_curve_offset', 'superheat', 'subcooling'],
  power: ['power', 'heat', 'boiler_power', 'pv', 'battery', 'grid'],
  energy: ['energy_total', 'env_energy', 'heat_total', 'energy_today'],
  pressure: ['brine_pressure', 'hc_pressure', 'low_pressure', 'high_pressure'],
  flowrate: ['volume', 'source_volume', 'hc_volume'],
  hours: ['hours', 'aux_hours'],
  percent: ['pv_share_today', 'hc_mixer', 'room_humidity'],
  counter: ['starts_total', 'starts_today', 'cutout_high_pressure', 'cutout_low_pressure', 'cutout_temperature'],
  ratio: ['cop_heating_today', 'cop_dhw_today'],
  speed: ['compressor', 'fan_speed', 'compressor_speed'],
  onoff: ['defrost', 'circulation', 'hc_pump', 'hc_mixer_opening', 'hc_mixer_closing', 'solar_pump', 'bypass_valve'],
  onoff_power: ['heater', 'boiler_state', ...HFC_TANK_HEATERS, 'pv_boost'],
  valve: ['valve'],
  text: ['mode', 'status', 'dhw_mode', 'buffer_mode', 'hc_mode', 'program', 'sg_ready'],
  time: ['circulation_start', 'circulation_end'],
  schedule: ['circulation_schedule'],
}).flatMap(([kind, keys]) => keys.map((key) => [key, kind])));
const hfcKindOf = (key) => HFC_KEY_KINDS[key] || HFC_KEY_KINDS[String(key).replace(/^hc[2-6]_/, 'hc_')] || HFC_KEY_KINDS[String(key).replace(/^hc[2-6]_/, '')];

// Guided mapping without a preset (#149). These are deliberately small exact-name tables, not fuzzy matching. A name can be
// the entity's friendly/original name or its complete entity-id object name (underscores and punctuation are normalized).
// A proposal is made only when exactly one entity on the selected device has a fitting kind and an exact listed name.
const HFC_ASSISTANT_RULES = {
  flow: { kind: 'temperature', names: ['heat pump flow temperature', 'heatpump flow temperature', 'flow temperature', 'supply temperature', 'flow', 'supply', 'wp vorlauf', 'vorlauf', 'vorlauftemperatur'] },
  return: { kind: 'temperature', names: ['heat pump return temperature', 'heatpump return temperature', 'return temperature', 'wp return', 'wp rucklauf', 'wp ruecklauf', 'rucklauf', 'ruecklauf', 'rucklauftemperatur', 'ruecklauftemperatur'] },
  power: { kind: 'power', names: ['heat pump electrical power', 'heatpump electrical power', 'electrical power', 'power consumption', 'input power', 'power', 'wp leistung', 'leistungsaufnahme', 'leistung'] },
  mode: { kind: 'text', names: ['heat pump operating mode', 'heatpump operating mode', 'operating mode', 'operation mode', 'hp mode', 'wp betriebsart', 'betriebsart', 'betriebsmodus'] },
  compressor: { kind: 'speed', names: ['compressor running', 'compressor frequency', 'compressor speed', 'compressor', 'wp verdichter', 'verdichter status', 'verdichterfrequenz', 'verdichterdrehzahl', 'verdichter'] },
  valve: { kind: 'valve', names: ['diverter valve', 'three way valve', '3 way valve', 'dhw valve', 'wp umschaltventil', 'umschaltventil', 'dreiwegeventil', '3 wege ventil', 'ww ventil'] },
  dhw_top: { kind: 'temperature', names: ['domestic hot water temperature', 'hot water temperature', 'dhw temperature', 'warmwasser temperatur', 'warmwassertemperatur', 'ww temperatur'] },
  outdoor: { kind: 'temperature', names: ['outdoor temperature', 'outside temperature', 'ambient temperature', 'aussentemperatur', 'aussen temperatur', 'aussen'] },
};
const hfcAssistantName = (value) => String(value || '').trim().toLowerCase().replace(/ß/g, 'ss').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const hfcAssistantNames = (id, entry, state) => {
  const values = [String(id || '').split('.').slice(1).join('.'), entry?.name, entry?.original_name, state?.attributes?.friendly_name];
  return new Set(values.map(hfcAssistantName).filter(Boolean));
};
// Units of the measuring kinds: one of them on a text, on/off or counter key is a mistake.
const HFC_PHYSICAL_UNITS = new Set(['temperature', 'power', 'energy', 'pressure', 'flowrate', 'hours'].flatMap((kind) => HFC_KINDS[kind].units));
// On/off keys keep the domain filter of their entity picker (a sensor can report on/off as text).
const HFC_BINARY_KEYS = Object.values(HFC_ENTITY_GROUPS).flat().filter((key) => HFC_KINDS[hfcKindOf(key)]?.onoff);
// Climate and water heater entities keep their temperatures in attributes: the reading in `current_temperature`, the target in
// `temperature`. Keys ending in _target or _setpoint read the target, so one thermostat can serve as dhw_top and dhw_target.
const hfcTempAttr = (id, key) => (['climate', 'water_heater'].includes(String(id || '').split('.')[0])
  ? (/_(target|setpoint)$/.test(key || '') ? 'temperature' : 'current_temperature') : null);

// Stat tile catalog for the `tiles` option. kind: cop | energy (kWh, or W for period "now") | count | hours | classes | cost.
// legacy: entity key of the default tiles that serves as "today"; ratio: computed from two other tiles when the integration
// has no own entity (COP = heat ÷ electricity); live: current value from the schematic entities; periods: allowed periods.
const HFC_PERIODS = ['now', 'today', 'yesterday', 'week', 'month', 'year', 'total'];
// Tiles that `tile_sources` can feed: live values and computed tiles (load classes, cost, standby loss, PV share) have no entity.
const hfcTileSourceKey = (key) => !!HFC_TILES[key] && !HFC_TILES[key].live && !['classes', 'cost', 'loss', 'share'].includes(HFC_TILES[key].kind);
// Periods that can be taken from the long-term statistics of a total counter: [calendar period, offset].
const HFC_STAT_PERIODS = { today: ['day', 0], yesterday: ['day', -1], week: ['week', 0], month: ['month', 0], year: ['year', 0] };
// Home Assistant actions a tile can carry (more-info, navigate, url, toggle, perform-action …).
const HFC_ACTIONS = ['tap_action', 'hold_action', 'double_tap_action'];
const HFC_LAYOUTS = ['default', 'compact', 'wide', 'wall'];
const HFC_BUFFER_VALUES = ['default', 'equal'];
// Option for phones: key values of the schematic grow below 500 px, secondary ones move to one line under it (#4). The name lives
// here, in the editor labels and in the CSS class narrow-focus.
const HFC_NARROW_FOCUS = 'narrow_focus';
const HFC_ANIMATIONS = ['auto', 'always', 'off'];
const HFC_THEMES = ['auto', 'night', 'contrast'];
// Storage: a hot-water tank and a buffer, or one combined (layered) tank with the hot-water zone on top (docs/TOPOLOGY.md, phase 1).
const HFC_STORAGES = ['separate', 'combined'];
// Sides of the diverter valve in a `valve_map`: dhw or heating, in any case and with the usual synonyms (#126).
const HFC_VALVE_SIDES = { dhw: 'dhw', 'hot water': 'dhw', hot_water: 'dhw', hotwater: 'dhw', heating: 'heating', heat: 'heating' };
const hfcValveSide = (v) => HFC_VALVE_SIDES[String(v ?? '').trim().toLowerCase()];
// Value maps of a preset or the configuration, listed in the diagnostic report.
const HFC_MAP_KEYS = ['valve_map', 'mode_map', 'dhw_mode_map', 'buffer_mode_map', 'hc_mode_map', 'program_map', 'sg_ready_map'];
// How the tap water is heated: a coil in the tank, a fresh-water station on the storage, or a tank in the combined storage.
const HFC_DHW_TYPES = ['coil', 'fresh_water', 'tank_in_tank'];
// Drawing of the outdoor unit: `auto` takes the style of the preset; `unit_size` picks the Vaillant aroTHERM plus class.
const HFC_UNIT_STYLES = ['auto', 'generic', 'lambda', 'vaillant', 'panasonic', 'viessmann', 'bosch', 'saunier', 'samsung', 'wolf', 'kronoterm', 'alpha_innotec', 'stiebel'];
const HFC_UNIT_SIZES = ['small', 'medium', 'large'];
const HFC_EMITTERS = ['underfloor', 'radiator', 'column'];
// Wall display: seconds the quick controls and the details toggle stay visible after the last touch or mouse move.
const HFC_WALL_TIMEOUT = 10;
// Heating program shown as a chip: the first pattern that matches the raw state of the `program` entity (or the circuit mode) wins.
// A `program_map` (raw state → eco | night | party | holiday | none) takes precedence.
const HFC_PROGRAMS = ['eco', 'night', 'party', 'holiday'];
const HFC_PROGRAM_ICONS = {
  eco: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19c2-5 5-8 9-10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  night: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" stroke-linejoin="round"/></svg>',
  party: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.4 5.6 6 .6-4.5 4 1.4 5.9L12 16l-5.3 3.1 1.4-5.9-4.5-4 6-.6z" stroke-linejoin="round"/></svg>',
  holiday: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
};
const HFC_PROGRAM_PATTERNS = [
  ['holiday', /holiday|vacation|urlaub|ferien|abwes|absence|away/],
  ['party', /party|boost|quick.?veto|powerful/],
  ['night', /night|nacht|setback|absenk|reduced|reduziert|lowered/],
  ['eco', /(^|[^a-z])eco|spar|economy/],
];
// SG-Ready state 1 blocks the heat pump, 2 is normal operation, 3 raises targets and 4 forces operation. Text and binary
// entities use sg_ready_map; only the standardized numbers and normalized names are interpreted without a map.
const HFC_SG_READY_STATES = ['normal', 'blocked', 'boost', 'forced'];
const HFC_SG_READY_MAP = { 1: 'blocked', 2: 'normal', 3: 'boost', 4: 'forced', normal: 'normal', blocked: 'blocked', boost: 'boost', forced: 'forced' };
const HFC_SG_READY_ICONS = {
  blocked: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  boost: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6"/></svg>',
  forced: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 13h6l-1 9 8-12h-6z"/></svg>',
};
// Colours the card draws with. Every role can be restyled from a theme or card-mod with --hfc-<role>; the values here are the defaults.
const HFC_COLORS = {
  heat: '#f97316', hot: '#dc2626', cool: '#38bdf8', 'cool-strong': '#0ea5e9', defrost: '#7dd3fc',
  pv: '#f59e0b', battery: '#10b981', grid: '#94a3b8', good: '#16a34a', badge: '#a855f7', brine: '#60a5fa', ground: '#a16207',
  'flow-cold': '#fb923c', 'flow-hot': '#dc2626', 'return-cold': '#7dd3fc', 'return-hot': '#2563eb', 'tank-cold': '#3b82f6', 'tank-cool': '#22d3ee', 'tank-warm': '#f97316', 'tank-hot': '#ef4444',
  'flow-dash': 'rgba(255,255,255,.9)', anthracite: '#3b4148', casing: '#e6e9ec',
};
const hfcVar = (name) => `var(--hfc-${name}, ${HFC_COLORS[name]})`;
// Home Assistant's power units normalized to watts. The exact spelling decides first, so MW (megawatt) and mW (milliwatt) stay
// distinct; other spellings (kw, KW, w, as 0.15 accepted them) are read case-insensitively. A lower-case "mw" is ambiguous and
// is not read. The editor checks use the same table, so a unit the card cannot read is named there.
const HFC_POWER_FACTORS = { W: 1, kW: 1000, MW: 1000000, GW: 1e9, TW: 1e12, mW: 0.001, 'BTU/h': 0.29307107 };
const HFC_POWER_FACTORS_ANY_CASE = { w: 1, kw: 1000, gw: 1e9, tw: 1e12, 'btu/h': 0.29307107 };
const hfcPowerFactor = (unit) => {
  const u = String(unit || '').trim();
  return Object.hasOwn(HFC_POWER_FACTORS, u) ? HFC_POWER_FACTORS[u] : HFC_POWER_FACTORS_ANY_CASE[u.toLowerCase()];
};
const hfcPowerW = (st, unitlessFactor = 1) => {
  const value = parseFloat(st?.state); const unit = String(st?.attributes?.unit_of_measurement || '').trim();
  if (!Number.isFinite(value)) return NaN;
  if (!unit) return value * unitlessFactor; // Preserve the field's historical default (W for power, kW for heat).
  const factor = hfcPowerFactor(unit);
  return factor === undefined ? NaN : value * factor;
};
// Translucent fill and a darker text colour of the same role, for chips and highlighted controls.
const hfcTint = (name, pct) => `color-mix(in srgb, ${hfcVar(name)} ${pct}%, transparent)`;
const hfcInk = (name) => `color-mix(in srgb, ${hfcVar(name)} 47%, var(--primary-text-color, #212121))`;
const HFC_TILES = {
  cop_live: { live: true },
  cop_heating: { kind: 'cop', legacy: 'cop_heating_today', ratio: ['heat_heating', 'energy_heating'] },
  cop_dhw: { kind: 'cop', legacy: 'cop_dhw_today', ratio: ['heat_dhw', 'energy_dhw'] },
  cop_cooling: { kind: 'cop', ratio: ['heat_cooling', 'energy_cooling'] },
  cop_total: { kind: 'cop', ratio: ['heat', 'energy'] },
  spf: { kind: 'cop', ratio: ['heat', 'energy'], periods: ['year'], noSuffix: true },
  energy: { kind: 'energy', legacy: 'energy_today' }, env_energy: { kind: 'energy' },
  energy_heating: { kind: 'energy' }, energy_dhw: { kind: 'energy' }, energy_cooling: { kind: 'energy' },
  energy_defrost: { kind: 'energy' }, energy_standby: { kind: 'energy' }, energy_aux: { kind: 'energy' },
  heat: { kind: 'energy' }, heat_heating: { kind: 'energy' }, heat_dhw: { kind: 'energy' }, heat_cooling: { kind: 'energy' }, heat_defrost: { kind: 'energy' },
  starts: { kind: 'count', legacy: 'starts_today' },
  cycles_heating: { kind: 'count' }, cycles_dhw: { kind: 'count' }, cycles_cooling: { kind: 'count' }, defrosts: { kind: 'count' },
  hours: { kind: 'hours' },
  hours_per_start: { kind: 'hours', ratio: ['hours', 'starts'], perStart: true },
  load_classes: { kind: 'classes' },
  aux_hours: { kind: 'hours' }, aux_starts: { kind: 'count' },
  spread: { live: true }, volume: { live: true }, heat_estimated: { live: true }, power: { live: true }, heat_live: { live: true },
  compressor_speed: { live: true }, source_spread: { live: true }, outdoor: { live: true }, dhw_top: { live: true }, room: { live: true },
  brine_pressure: { live: true }, hc_pressure: { live: true },
  // Spread of a heating circuit from its own flow and return sensors, one tile per circuit (#290).
  hc_spread: { live: true }, hc2_spread: { live: true }, hc3_spread: { live: true }, hc4_spread: { live: true }, hc5_spread: { live: true }, hc6_spread: { live: true },
  pv_share: { live: true },
  // Share of the heating time in PV surplus mode, from the recorder history of the mode and the `pv_boost` entity.
  pv_boost_share: { kind: 'share', periods: ['today', 'yesterday', 'week'] },
  pv_production: { kind: 'energy' }, solar_thermal: { kind: 'energy' },
  cost: { kind: 'cost', periods: ['today', 'yesterday', 'week', 'month', 'year', 'total'] },
  dhw_loss: { kind: 'loss', periods: ['now'], noSuffix: true },
};
// Standby loss of the hot-water tank: history window, minimum standby window, settling time after charging or draw-off,
// and the temperature changes within 30 minutes that count as draw-off or as heating the card cannot explain.
const HFC_LOSS = { hours: 48, minWindow: 3, settle: 0.5, drawOff: 1.5, rise: 1.0 };
// Runs of the timeline (#300): a pause shorter than seriesGap minutes continues a series of runs, so short cycling shows as
// "3rd run since 21:00"; a longer standstill starts a new series.
const HFC_RUNS = { seriesGap: 60 };

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */
class HeatpumpFlowCard extends HTMLElement {
  static _registries = new WeakMap();
  static _pointtStates = new WeakMap();
  static _pointtLast = { key: undefined, revision: undefined };

  static _registryKey(hass) { return hass?.connection || hass?.callWS; }

  // HA replaces the compact registry when its metadata changes. Cache only this
  // integration's enabled ids, then check their presence once per states object.
  // Comparing each id also catches removals/additions with an unchanged count.
  // Cards and the editor share the result; ordinary value changes keep its identity.
  // HA also sends a new registry object after a change to any entity anywhere: the revision follows the enabled and present
  // ids, not the object, so unrelated registry updates do not trigger needless rebuilds (#164).
  static _pointtRevision(hass) {
    if (!hass?.entities || !hass.states) return undefined;
    let cache = this._pointtStates.get(hass.entities);
    if (!cache) {
      cache = { ids: Object.keys(hass.entities).filter((id) => {
        const e = hass.entities[id];
        return e?.platform === 'bosch_buderus_heating' && !e.disabled_by;
      }), present: [] };
      this._pointtStates.set(hass.entities, cache);
    }
    if (cache.states !== hass.states) {
      cache.ids.forEach((id, n) => { cache.present[n] = !!hass.states[id]; });
      cache.states = hass.states;
      cache.key = cache.ids.filter((id, n) => cache.present[n]).join();
    }
    if (this._pointtLast.key !== cache.key) this._pointtLast = { key: cache.key, revision: {} };
    return this._pointtLast.revision;
  }

  static _registry(hass) {
    const cache = this._registries.get(this._registryKey(hass));
    return cache && cache.display === hass?.entities && cache.entries ? cache.entries : (hass?.entities || {});
  }

  // Only presets using stable unique ids request the full local HA registry. Share one request
  // per connection and compact-registry revision, including between the card and its editor.
  // A denied/failed request is not retried on every state update; manual mappings still work.
  static _loadPresetRegistry(host, update) {
    const hass = host._hass;
    if (!HFC_PRESETS[host._config?.preset]?.entity_registry || typeof hass?.callWS !== 'function') return;
    const key = this._registryKey(hass);
    let cache = this._registries.get(key);
    if (!cache || cache.display !== hass.entities) {
      const old = cache;
      cache = { display: hass.entities };
      this._registries.set(key, cache);
      // Until the new list arrives, the PointT entries of the previous one stay in use on top of the new compact registry.
      if (old?.pointtFull) { cache.entries = { ...cache.display, ...old.pointtFull }; cache.carriedSig = old.sig; }
      const pointt = Object.entries(hass.entities || {}).filter(([, e]) => e.platform === 'bosch_buderus_heating');
      // The demo and tests may already provide the full registry.
      const full = pointt.length && pointt.every(([, e]) => typeof e.unique_id === 'string');
      cache.promise = Promise.resolve().then(() => full ? pointt.map(([entity_id, e]) => ({ ...e, entity_id }))
        : hass.callWS({ type: 'config/entity_registry/list' })).then((entries) => {
        if (!Array.isArray(entries)) throw new Error('Invalid entity registry response');
        cache.pointtFull = {};
        // Do not retain unrelated registry data, options, user names or credentials.
        entries.filter((e) => e?.platform === 'bosch_buderus_heating' && typeof e.entity_id === 'string')
          .forEach(({ entity_id, platform, unique_id, device_id, disabled_by, translation_key }) => {
            cache.pointtFull[entity_id] = { platform, unique_id, device_id, disabled_by, translation_key };
          });
        cache.entries = { ...cache.display, ...cache.pointtFull };
        cache.sig = JSON.stringify(Object.entries(cache.pointtFull).sort(([a], [b]) => (a < b ? -1 : 1)));
      }).catch(() => { cache.entries = null; });
    }
    if (host._registryRequest === cache.promise) return;
    host._registryRequest = cache.promise;
    // HA sends a new compact registry after a change to any entity. The host rebuilds only when the PointT entries differ from
    // the ones it was built with, avoiding flicker and unnecessary work (#164).
    // Without carried-over entries (first list of a connection) the host drew without the registry and needs the update.
    cache.promise.then(() => {
      if (host._registryRequest !== cache.promise || host._hass?.entities !== cache.display) return;
      if (cache.sig !== undefined && cache.sig === host._registrySig && cache.carriedSig === host._registrySig) return;
      host._registrySig = cache.sig;
      update();
    });
  }

  static _ctx(hass, device, idx) {
    const states = hass?.states || {};
    const reg = HeatpumpFlowCard._registry(hass);
    const ids = Object.keys(states);
    const onDevice = (e) => !device || reg[e]?.device_id === device;
    return {
      ids,
      idx,
      registry: reg,
      device,
      key: (platform, domain, tk) => ids.find((e) => e.startsWith(`${domain}.`) && reg[e]?.platform === platform
        && reg[e]?.translation_key === tk && onDevice(e)),
      // Without a registry entry (YAML entities) the platform cannot be checked; accept the pattern match.
      match: (re, platform) => ids.find((e) => re.test(e) && (!reg[e] || !platform || reg[e].platform === platform) && onDevice(e)),
      state: (id) => states[id]?.state,
    };
  }

  static getStubConfig(hass) {
    // The preset that finds the most live core entities; on a tie the order of HFC_PRESETS (#143).
    // No supported integration: no preset. The card shows its start state instead of a preset that finds nothing (#142).
    return HeatpumpFlowCard._presetMatches(hass)[0]?.stub || {};
  }

  // Every preset whose detection matches, best first: { name, score, stub }. The score counts the live core entities
  // (mode, compressor, power, flow, return, hot water) the preset maps, so with two integrations for one heat pump
  // (myPyllant and ebusd, ViCare and Open3E) the richer one wins, not the order of HFC_PRESETS (#143).
  static _presetMatches(hass) {
    if (!hass) return [];
    const live = (id) => id && hass.states[id] && !['unknown', 'unavailable'].includes(hass.states[id].state);
    const matches = [];
    Object.entries(HFC_PRESETS).forEach(([name, preset], order) => {
      const ctx = HeatpumpFlowCard._ctx(hass, undefined, { hp: 1, dhw: 1, buffer: 1, hc: 1, ...(preset.index || {}) });
      if (preset.detect(ctx) === undefined) return;
      const stub = { preset: name };
      // Further circuits count when the preset finds a different, reporting flow or mode entity for them.
      const base = HeatpumpFlowCard._resolve({ preset: name, hc_count: HFC_MAX_HC }, hass).fromPreset;
      let n = 1;
      while (n < HFC_MAX_HC && preset.auto_circuits !== false && ['flow', 'mode', 'pump'].some((k) => live(base[`hc${n + 1}_${k}`]) && base[`hc${n + 1}_${k}`] !== base[`hc_${k}`])) n++;
      if (n > 1) stub.hc_count = n;
      if (preset.source_type) { const st = preset.source_type(base, hass); if (st && st !== 'air') stub.source_type = st; }
      const score = HFC_CORE_KEYS.filter((k) => [].concat(base[k] || []).some(live)).length;
      // The live entities the preset maps, each counted once (the editor shows them next to the preset, #145).
      const found = new Set(Object.values(base).flat().filter(live)).size;
      matches.push({ name, score, found, stub, order });
    });
    return matches.sort((a, b) => b.score - a.score || a.order - b.order);
  }

  // Start state: no preset and nothing of its own (entities, error entities, badges, quick controls), so there is nothing to
  // show yet: a new card without a detected integration.
  _startState() {
    const c = this._config || {};
    return !this._preset && !Object.values(c.entities || {}).some((v) => v && v !== 'none')
      && !['errors', 'badges', 'controls'].some((k) => Array.isArray(c[k]) && c[k].length);
  }

  static getConfigElement() { return document.createElement('heatpump-flow-card-editor'); }

  static getConfigForm() { return HeatpumpFlowCard._formSchema(); }

  // Form schema. With a config, circuit fields and groups are limited to hc_count.
  // opts.valve: a valve entity is mapped, so the editor offers its states for hot water and heating (valve_map, #126).
  // opts.assistant: no supported preset was detected, so the editor offers the confirmed-proposal assistant (#149).
  static _formSchema(config, tiles, opts = {}) {
    // The full locale first (pt-br), then its language (pt), like the card does; each table has its own set of languages.
    const locale = String(document.querySelector('home-assistant')?.hass?.locale?.language || navigator.language || 'en').toLowerCase().replace('_', '-');
    const langIn = (table) => (locale in table ? locale : locale.split('-')[0]);
    const L = hfcBuiltin(HFC_EDITOR, langIn(HFC_EDITOR));
    const hcCount = config ? hfcHcCount(config) : HFC_MAX_HC;
    const customLanguages = Object.keys(config?.texts || {}).filter((v) => !(v in HFC_LANGUAGES));
    const languageOptions = [{ value: 'auto', label: 'Auto' },
      ...Object.entries(HFC_LANGUAGES).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      ...customLanguages.map((value) => ({ value, label: value }))];
    const keep = (name) => { const m = /^hc([2-6])_/.exec(name); return !m || +m[1] <= hcCount; };
    const groups = Object.entries(HFC_ENTITY_GROUPS).filter(([sec]) => keep(sec.replace('sec_', '') + '_'));
    const hcTypeSel = (name) => ({ name, selector: { select: { mode: 'dropdown', options: HFC_EMITTERS.map((value) => ({ value, label: L[`hc_${value}`] })) } } });
    // A YAML list (sum of several entities) keeps a picker for several entities. On/off keys offer the domains of their kind. With
    // opts.fits (the editor, #194) a measuring key offers the entities whose unit, device class or domain fits its kind, plus what
    // is already mapped; opts.all ("Show all entities") lifts that filter.
    const entitySchema = (key) => {
      const kind = HFC_KINDS[hfcKindOf(key)];
      const multiple = Array.isArray(config?.entities?.[key]);
      // No fitting entity at all (an integration without units): no filter rather than an empty list.
      const fits = !opts.all && opts.fits?.[hfcKindOf(key)]?.length && opts.fits[hfcKindOf(key)];
      const current = [opts.shown?.[key]].flat().filter((id) => typeof id === 'string' && id);
      return {
        name: key,
        selector: { entity: { ...(multiple ? { multiple: true } : {}),
          ...(kind?.onoff || ['time', 'schedule'].includes(hfcKindOf(key)) ? { domain: kind.domains }
            : fits ? { include_entities: [...new Set([...fits, ...current])] } : {}) } },
      };
    };
    return {
      schema: [
        {
          name: 'preset',
          // Presets detected in this Home Assistant come first, best match first, with the number of entities they find (#145).
          selector: { select: { mode: 'dropdown', options: [{ value: 'none', label: '—' }, ...[
            ...(opts.matches || []).map((m) => m.name).filter((k) => HFC_PRESETS[k]),
            ...Object.keys(HFC_PRESETS).filter((k) => !(opts.matches || []).some((m) => m.name === k)),
          ].map((k) => {
            const p = HFC_PRESETS[k]; const m = (opts.matches || []).find((x) => x.name === k);
            const label = m ? `${p.name} · ${L.detected} (${m.found} ${L.entities_found})` : p.name;
            return { value: k, label: p.tested ? label : `${label} · ${L.untested}` };
          })] } },
        },
        ...(opts.assistant ? [{ name: 'assistant_device', selector: { device: {} } }] : []),
        {
          type: 'grid', name: '', schema: [
            { name: 'title', selector: { text: {} } },
            hcTypeSel('hc_type'),
            { name: 'hc_count', selector: { number: { min: 1, max: HFC_MAX_HC, step: 1, mode: 'box' } } },
            { name: 'layout', selector: { select: { mode: 'dropdown', options: HFC_LAYOUTS.map((v) => ({ value: v, label: L[`layout_${v}`] })) } } },
             { name: 'theme', selector: { select: { mode: 'dropdown', options: HFC_THEMES.map((v) => ({ value: v, label: L[`theme_${v}`] })) } } },
            ...['hc2_type', 'hc3_type', 'hc4_type', 'hc5_type', 'hc6_type'].filter(keep).map(hcTypeSel),
          ],
        },
        {
          name: 'controls',
          selector: { entity: { multiple: true, domain: HFC_CONTROL_DOMAINS } },
        },
        // Tile selection (editor only): a sortable list of the tiles this installation can fill.
        ...(tiles ? [{ name: 'tiles_custom', selector: { boolean: {} } }] : []),
        ...(tiles && tiles.editable && Array.isArray(config.tiles)
          ? [{ name: 'tiles', selector: { select: { multiple: true, reorder: true, mode: 'dropdown', options: tiles.options } } }] : []),
        // Price for the cost tile: a fixed number or an entity (both write `price`).
        ...(tiles && Array.isArray(config.tiles) ? [{
          type: 'grid', name: '', schema: [
            { name: 'price_fixed', selector: { number: { min: 0, max: 10, step: 0.001, mode: 'box' } } },
            { name: 'price_entity', selector: { entity: { domain: ['sensor', 'input_number', 'number'] } } },
          ],
        }] : []),
        ...(opts.fits ? [{ name: 'all_entities', selector: { boolean: {} } }] : []),
        // Core fields first, the further fields of a group in "More fields" (#193): open as soon as the configuration sets one of
        // them. Source fields of an air heat pump are left out unless the configuration sets them (so they can be cleared).
        ...groups.map(([sec, keys]) => {
          const ownSet = (k) => { const v = config?.entities?.[k]; return v !== undefined && v !== null && v !== 'none' && v !== ''; };
          const air = (config?.source_type || 'air') === 'air';
          const shown = keys.filter((k) => !(air && HFC_SOURCE_KEYS.includes(k) && !ownSet(k)));
          const core = shown.filter((k) => HFC_CORE_FIELDS.includes(k.replace(/^hc[2-6]_/, 'hc_').replace(/^hc_room/, 'room')));
          const more = shown.filter((k) => !core.includes(k));
          return {
            type: 'expandable', name: 'entities', title: L[sec],
            schema: core.length && more.length ? [...core.map(entitySchema), {
              type: 'expandable', name: `${sec}_more`, flatten: true, title: L.more_fields, expanded: more.some(ownSet), schema: more.map(entitySchema),
            }] : shown.map(entitySchema),
          };
        }),
        {
          type: 'expandable', name: 'advanced', flatten: true, title: L.sec_advanced, schema: [{
            type: 'grid', name: '', schema: [
              { name: 'prefix', selector: { text: {} } },
              { name: 'device', selector: { device: {} } },
              { name: 'source_type', selector: { select: { mode: 'dropdown', options: ['air', 'brine', 'water'].map((v) => ({ value: v, label: L[`src_${v}`] })) } } },
              { name: 'power_sources', selector: { select: { mode: 'dropdown', options: [{ value: 'auto', label: L.ps_auto }, { value: 'manual', label: L.ps_manual }] } } },
              { name: 'errors', selector: { entity: { multiple: true } } },
              { name: 'error_ok_text', selector: { text: {} } },
              ...(opts.valve ? [{ name: 'valve_dhw_text', selector: { text: {} } }, { name: 'valve_heating_text', selector: { text: {} } }] : []),
              { name: 'power_threshold', selector: { number: { min: 0, max: 2000, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
              { name: 'animations', selector: { select: { mode: 'dropdown', options: HFC_ANIMATIONS.map((v) => ({ value: v, label: L[`animations_${v}`] })) } } },
              { name: 'flow_speed', selector: { number: { min: 0.2, max: 3, step: 0.1, mode: 'slider' } } },
              { name: 'source_spread', selector: { boolean: {} } },
              ...['brine_pressure_min', 'brine_pressure_crit', 'brine_pressure_max', 'hc_pressure_min', 'hc_pressure_crit', 'hc_pressure_max']
                .map((name) => ({ name, selector: { number: { min: 0, max: 20, step: 0.1, mode: 'box', unit_of_measurement: 'bar' } } })),
              { name: 'language', selector: { select: { mode: 'dropdown', options: languageOptions } } },
              { name: 'fullscreen', selector: { boolean: {} } },
              { name: 'diagnostic', selector: { boolean: {} } },
              { name: 'hc_flow_label', selector: { boolean: {} } },
              { name: 'hc_return_label', selector: { boolean: {} } },
              { name: 'dew_point_margin', selector: { number: { min: 0, max: 10, step: 0.5, mode: 'box', unit_of_measurement: 'K' } } },
              { name: 'narrow_values', selector: { boolean: {} } },
              { name: HFC_NARROW_FOCUS, selector: { boolean: {} } },
              { name: 'buffer_values', selector: { select: { mode: 'dropdown', options: HFC_BUFFER_VALUES.map((v) => ({ value: v, label: L[`buffer_values_${v}`] })) } } },
              { name: 'storage', selector: { select: { mode: 'dropdown', options: HFC_STORAGES.map((v) => ({ value: v, label: L[`storage_${v}`] })) } } },
              { name: 'dhw_type', selector: { select: { mode: 'dropdown', options: HFC_DHW_TYPES.filter((v) => v !== 'tank_in_tank' || (config && config.storage === 'combined')).map((v) => ({ value: v, label: L[`dhw_type_${v}`] })) } } },
              ...(config && config.storage === 'combined' ? [] : [{ name: 'buffer', selector: { boolean: {} } }, { name: 'series_buffer', selector: { boolean: {} } }]),
              ...(config && config.series_buffer && config.storage !== 'combined' ? [{ name: 'series_bypass', selector: { boolean: {} } }] : []),
              ...['hc_name', 'hc2_name', 'hc3_name', 'hc4_name', 'hc5_name', 'hc6_name'].filter(keep).map((name) => ({ name, selector: { text: {} } })),
              { name: 'unit_style', selector: { select: { mode: 'dropdown', options: HFC_UNIT_STYLES.map((v) => ({ value: v, label: L[`unit_${v}`] })) } } },
              ...(config && (config.unit_style === 'vaillant' || ((!config.unit_style || config.unit_style === 'auto') && config.preset === 'vaillant'))
                ? [{ name: 'unit_size', selector: { select: { mode: 'dropdown', options: HFC_UNIT_SIZES.map((v) => ({ value: v, label: L[`size_${v}`] })) } } }] : []),
              // Panasonic: one or two fans; left empty, the HeishaMon preset takes the size from the model (#176).
              ...(config && (config.unit_style === 'panasonic' || ((!config.unit_style || config.unit_style === 'auto') && config.preset === 'heishamon'))
                ? [{ name: 'unit_size', selector: { select: { mode: 'dropdown', options: ['medium', 'large'].map((v) => ({ value: v, label: L[`size_pana_${v}`] })) } } }] : []),
              { name: 'primary_pump', selector: { boolean: {} } },
              { name: 'timeline', selector: { boolean: {} } },
              ...(config && config.timeline ? [{ name: 'timeline_hours', selector: { number: { min: 3, max: 72, step: 1, mode: 'box', unit_of_measurement: 'h' } } }, { name: 'timeline_details', selector: { boolean: {} } }, { name: 'timeline_marks', selector: { boolean: {} } }] : []),
              { name: 'details_open', selector: { boolean: {} } },
              ...(config && config.layout === 'wall' ? [{ name: 'wall_timeout', selector: { number: { min: 0, max: 600, step: 1, mode: 'box', unit_of_measurement: 's' } } }] : []),
            ],
          }],
        },
      ],
      // Keys of circuits 2 to 6 reuse the labels of circuit 1 (hc2_flow → hc_flow, hc2_room → room).
      computeLabel: (s) => L[s.name] || L[String(s.name).replace(/^hc[2-6]_/, 'hc_')] || L[String(s.name).replace(/^hc[2-6]_/, '')]
        || hfcBuiltin(HFC_I18N, langIn(HFC_I18N)).det[s.name] || s.name,
      L,
    };
  }

  static _language(config, hass) {
    const raw = String(config?.language && config.language !== 'auto'
      ? config.language : (hass?.locale?.language || hass?.language || navigator.language || 'en')).toLowerCase().replace('_', '-');
    const exact = raw; const base = raw.split('-')[0]; const custom = config?.texts || {};
    if (HFC_I18N[exact] || custom[exact]) return exact;
    if (HFC_I18N[base] || custom[base]) return base;
    return 'en';
  }

  static _texts(config, hass) {
    const lang = HeatpumpFlowCard._language(config, hass);
    const base = lang.split('-')[0]; const custom = config?.texts || {};
    return hfcTextMerge(HFC_I18N.en, HFC_I18N[base], HFC_I18N[lang], custom[base], custom[lang]);
  }

  static _validateTexts(texts) {
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) throw new Error('texts must map language codes to text objects');
    const visit = (value, reference, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
      Object.entries(value).forEach(([key, child]) => {
        if (!Object.prototype.hasOwnProperty.call(reference, key)) throw new Error(`Unknown text key "${path}.${key}"`);
        const expected = reference[key];
        if (expected && typeof expected === 'object') visit(child, expected, `${path}.${key}`);
        else if (typeof child !== 'string') throw new Error(`${path}.${key} must be text`);
      });
    };
    Object.entries(texts).forEach(([lang, value]) => {
      if (!/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/.test(lang)) throw new Error(`Invalid language code "${lang}" in texts (use lowercase, for example nl or pt-br)`);
      visit(value, HFC_I18N.en, `texts.${lang}`);
    });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    if (config.preset && config.preset !== 'none' && !HFC_PRESETS[config.preset]) {
      throw new Error(`Unknown preset "${config.preset}". Available: ${Object.keys(HFC_PRESETS).join(', ')}`);
    }
    ['hc_type', 'hc2_type', 'hc3_type', 'hc4_type', 'hc5_type', 'hc6_type'].forEach((k) => {
      if (config[k] && !HFC_EMITTERS.includes(config[k])) throw new Error(`${k} must be one of: ${HFC_EMITTERS.join(', ')}`);
    });
    if (config.source_type && !['air', 'brine', 'water'].includes(config.source_type)) {
      throw new Error('source_type must be "air", "brine" or "water"');
    }
    if (config.tiles !== undefined && config.tiles !== null) {
      if (!Array.isArray(config.tiles)) throw new Error('tiles must be a list');
      config.tiles.forEach((t) => {
        const s = HeatpumpFlowCard._tileSpec(t);
        if (s && s.key !== undefined && !HFC_TILES[s.key]) throw new Error(`Unknown tile "${s.key}". Available: ${Object.keys(HFC_TILES).join(', ')}`);
        if (s && s.period !== undefined && !HFC_PERIODS.includes(s.period)) throw new Error(`Unknown tile period "${s.period}". Available: ${HFC_PERIODS.join(', ')}`);
      });
    }
    if (config.tile_sources !== undefined && config.tile_sources !== null) {
      if (typeof config.tile_sources !== 'object' || Array.isArray(config.tile_sources)) throw new Error('tile_sources must map tile keys to entities');
      Object.entries(config.tile_sources).forEach(([key, v]) => {
        if (!hfcTileSourceKey(key)) throw new Error(`tile_sources: "${key}" cannot take an entity. Available: ${Object.keys(HFC_TILES).filter(hfcTileSourceKey).join(', ')}`);
        if (v === null || v === 'none' || typeof v === 'string') return;
        if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`tile_sources.${key} must be an entity or a map of periods to entities`);
        Object.entries(v).forEach(([period, id]) => {
          if (!HFC_PERIODS.includes(period) || period === 'now') throw new Error(`tile_sources.${key}: unknown period "${period}". Available: ${HFC_PERIODS.filter((p) => p !== 'now').join(', ')}`);
          if (typeof id !== 'string') throw new Error(`tile_sources.${key}.${period} must be an entity id`);
        });
      });
    }
    if (config.layout !== undefined && config.layout !== null && !HFC_LAYOUTS.includes(config.layout)) {
      throw new Error(`layout must be one of: ${HFC_LAYOUTS.join(', ')}`);
    }
    if (config.buffer_values !== undefined && config.buffer_values !== null && !HFC_BUFFER_VALUES.includes(config.buffer_values)) {
      throw new Error(`buffer_values must be one of: ${HFC_BUFFER_VALUES.join(', ')}`);
    }
    if (config.animations !== undefined && config.animations !== null && !HFC_ANIMATIONS.includes(config.animations)) {
      throw new Error(`animations must be one of: ${HFC_ANIMATIONS.join(', ')}`);
    }
    if (config.theme !== undefined && config.theme !== null && !HFC_THEMES.includes(config.theme)) {
      throw new Error(`theme must be one of: ${HFC_THEMES.join(', ')}`);
    }
    if (config.fullscreen !== undefined && config.fullscreen !== null && typeof config.fullscreen !== 'boolean') {
      throw new Error('fullscreen must be true or false');
    }
    if (config.diagnostic !== undefined && config.diagnostic !== null && typeof config.diagnostic !== 'boolean') {
      throw new Error('diagnostic must be true or false');
    }
    if (config.narrow_values !== undefined && config.narrow_values !== null && typeof config.narrow_values !== 'boolean') {
      throw new Error('narrow_values must be true or false');
    }
    if (config[HFC_NARROW_FOCUS] !== undefined && config[HFC_NARROW_FOCUS] !== null && typeof config[HFC_NARROW_FOCUS] !== 'boolean') {
      throw new Error(`${HFC_NARROW_FOCUS} must be true or false`);
    }
    if (config.buffer !== undefined && config.buffer !== null && typeof config.buffer !== 'boolean') {
      throw new Error('buffer must be true or false');
    }
    if (config.series_buffer !== undefined && config.series_buffer !== null && typeof config.series_buffer !== 'boolean') {
      throw new Error('series_buffer must be true or false');
    }
    if (config.series_bypass !== undefined && config.series_bypass !== null && typeof config.series_bypass !== 'boolean') {
      throw new Error('series_bypass must be true or false');
    }
    if (config.storage !== undefined && config.storage !== null && !HFC_STORAGES.includes(config.storage)) {
      throw new Error(`storage must be one of: ${HFC_STORAGES.join(', ')}`);
    }
    // One tank holds hot water and the heating zone; a separate parallel or series buffer cannot be drawn with it.
    if (config.storage === 'combined' && config.buffer) throw new Error('storage: combined cannot be used with buffer');
    if (config.storage === 'combined' && config.series_buffer) throw new Error('storage: combined cannot be used with series_buffer');
    if (config.buffer && config.series_buffer) throw new Error('buffer cannot be used with series_buffer');
    if (config.dhw_type !== undefined && config.dhw_type !== null && !HFC_DHW_TYPES.includes(config.dhw_type)) {
      throw new Error(`dhw_type must be one of: ${HFC_DHW_TYPES.join(', ')}`);
    }
    if (config.dhw_type === 'tank_in_tank' && config.storage !== 'combined') throw new Error('dhw_type: tank_in_tank needs storage: combined');
    const lossSensor = config.entities?.dhw_loss_sensor;
    if (lossSensor !== undefined && lossSensor !== null && lossSensor !== 'none'
      && (typeof lossSensor !== 'string' || !lossSensor.startsWith('sensor.'))) {
      throw new Error('entities.dhw_loss_sensor must be one sensor.* entity id');
    }
    if (config.primary_pump !== undefined && config.primary_pump !== null && typeof config.primary_pump !== 'boolean') {
      throw new Error('primary_pump must be true or false');
    }
    if (config.valve_map !== undefined && config.valve_map !== null) {
      if (typeof config.valve_map !== 'object' || Array.isArray(config.valve_map)) throw new Error('valve_map must map raw valve states to dhw or heating');
      const bad = Object.entries(config.valve_map).find(([, v]) => !hfcValveSide(v));
      if (bad) {
        const synonyms = Object.keys(HFC_VALVE_SIDES).filter((k) => !['dhw', 'heating'].includes(k)).join(', ');
        throw new Error(`valve_map: "${bad[1]}" for the state "${bad[0]}" is neither dhw nor heating (also accepted: ${synonyms}, in any case)`);
      }
    }
    if (config.texts !== undefined && config.texts !== null) HeatpumpFlowCard._validateTexts(config.texts);
    if (config.flow_speed !== undefined && config.flow_speed !== null && config.flow_speed !== '' && !(+config.flow_speed >= 0.2 && +config.flow_speed <= 3)) {
      throw new Error('flow_speed must be a number from 0.2 to 3');
    }
    if (config.source_spread !== undefined && config.source_spread !== null && typeof config.source_spread !== 'boolean') {
      throw new Error('source_spread must be true or false');
    }
    if (config.hc_flow_label !== undefined && config.hc_flow_label !== null && typeof config.hc_flow_label !== 'boolean') {
      throw new Error('hc_flow_label must be true or false');
    }
    if (config.dew_point_margin !== undefined && config.dew_point_margin !== null && config.dew_point_margin !== ''
      && !(Number.isFinite(+config.dew_point_margin) && +config.dew_point_margin >= 0 && +config.dew_point_margin <= 10)) {
      throw new Error('dew_point_margin must be a number from 0 to 10 K');
    }
    ['brine_pressure_min', 'brine_pressure_crit', 'brine_pressure_max', 'hc_pressure_min', 'hc_pressure_crit', 'hc_pressure_max'].forEach((key) => {
      if (config[key] !== undefined && config[key] !== null && config[key] !== '' && !(Number.isFinite(+config[key]) && +config[key] >= 0)) throw new Error(`${key} must be a number of bar, 0 or more`);
    });
    ['brine', 'hc'].forEach((kind) => {
      const critical = config[`${kind}_pressure_crit`]; const minimum = config[`${kind}_pressure_min`]; const maximum = config[`${kind}_pressure_max`];
      if (critical !== undefined && critical !== null && critical !== '' && minimum !== undefined && minimum !== null && minimum !== '' && +critical > +minimum) throw new Error(`${kind}_pressure_crit must be less than or equal to ${kind}_pressure_min`);
      if (minimum !== undefined && minimum !== null && minimum !== '' && maximum !== undefined && maximum !== null && maximum !== '' && +minimum > +maximum) throw new Error(`${kind}_pressure_min must be less than or equal to ${kind}_pressure_max`);
    });
    if (config.wall_timeout !== undefined && config.wall_timeout !== null && !(+config.wall_timeout >= 0)) {
      throw new Error('wall_timeout must be a number of seconds, 0 or more');
    }
    if (config.timeline !== undefined && config.timeline !== null && typeof config.timeline !== 'boolean') throw new Error('timeline must be true or false');
    if (config.timeline_hours !== undefined && config.timeline_hours !== null && !(+config.timeline_hours > 0)) throw new Error('timeline_hours must be a number of hours above 0 (3 to 72)');
    if (config.timeline_details !== undefined && config.timeline_details !== null && typeof config.timeline_details !== 'boolean') {
      throw new Error('timeline_details must be true or false');
    }
    if (config.timeline_marks !== undefined && config.timeline_marks !== null && typeof config.timeline_marks !== 'boolean') {
      if (!Array.isArray(config.timeline_marks)) throw new Error('timeline_marks must be true or a list of entities');
      config.timeline_marks.forEach((m) => { if (!(typeof m === 'string' ? m : m && m.entity)) throw new Error('timeline_marks: every entry needs an entity'); });
    }
    if (config.unit_style !== undefined && config.unit_style !== null && !HFC_UNIT_STYLES.includes(config.unit_style)) {
      throw new Error(`unit_style must be one of: ${HFC_UNIT_STYLES.join(', ')}`);
    }
    if (config.unit_size !== undefined && config.unit_size !== null && !HFC_UNIT_SIZES.includes(config.unit_size)) {
      throw new Error(`unit_size must be one of: ${HFC_UNIT_SIZES.join(', ')}`);
    }
    if (config.program_map !== undefined && config.program_map !== null && (typeof config.program_map !== 'object' || Array.isArray(config.program_map))) {
      throw new Error(`program_map must map raw states to ${HFC_PROGRAMS.join(', ')} or none`);
    }
    if (config.sg_ready_map !== undefined && config.sg_ready_map !== null) {
      if (typeof config.sg_ready_map !== 'object' || Array.isArray(config.sg_ready_map)
        || Object.values(config.sg_ready_map).some((v) => !HFC_SG_READY_STATES.includes(String(v).toLowerCase()))) {
        throw new Error(`sg_ready_map must map raw states to ${HFC_SG_READY_STATES.join(', ')}`);
      }
    }
    if (config.errors !== undefined && (!Array.isArray(config.errors) || config.errors.some((id) => typeof id !== 'string'))) {
      throw new Error('errors must be a list of entity ids');
    }
    if (config.error_ok !== undefined && (!Array.isArray(config.error_ok) || config.error_ok.some((state) => typeof state !== 'string'))) {
      throw new Error('error_ok must be a list of text states');
    }
    if (config.compressor_speed_max !== undefined && config.compressor_speed_max !== null && !(+config.compressor_speed_max > 0)) {
      throw new Error('compressor_speed_max must be a number above 0 (the Hz or rpm that count as full speed)');
    }
    if (config.actions !== undefined && config.actions !== null) {
      if (typeof config.actions !== 'object' || Array.isArray(config.actions)) throw new Error('actions must map entity keys to actions, e.g. {dhw_top: {tap_action: {action: navigate, navigation_path: /dhw}}}');
      if (Object.values(config.actions).some((a) => !a || typeof a !== 'object')) throw new Error('every entry of actions needs tap_action, hold_action or double_tap_action');
    }
    [config, ...(config.tiles || []), ...(config.stats || []), ...(config.badges || []), ...Object.values(config.actions || {})].forEach((s) => {
      if (!s || typeof s !== 'object') return;
      if (s.price !== undefined && s.price !== null && !['number', 'string'].includes(typeof s.price)) throw new Error('price must be a number or an entity');
      HFC_ACTIONS.forEach((a) => { if (s[a] !== undefined && (!s[a] || typeof s[a] !== 'object')) throw new Error(`${a} must be an action, e.g. {action: navigate, navigation_path: /energy}`); });
    });
    if (config.fullscreen === false && this._fullscreenOpen) this._closeFullscreen(false, false);
    this._config = config;
    this._textCache = null;
    const preset = HFC_PRESETS[config.preset];
    this._preset = preset;
    HeatpumpFlowCard._loadPresetRegistry(this, () => {
      this._needsBuild = true; this._rendered = false; this.hass = this._hass;
    });
    this._idx = { hp: 1, dhw: 1, buffer: 1, hc: 1, ...(preset?.index || {}), ...(config.index || {}) };
    this._maps = {
      mode: { ...(preset?.mode_map || {}), ...(config.mode_map || {}) },
      dhw: { ...(preset?.dhw_mode_map || {}), ...(config.dhw_mode_map || {}) },
      buffer: { ...(preset?.buffer_mode_map || {}), ...(config.buffer_mode_map || {}) },
      hc: { ...(preset?.hc_mode_map || {}), ...(config.hc_mode_map || {}) },
      sg: { ...HFC_SG_READY_MAP, ...(preset?.sg_ready_map || {}), ...(config.sg_ready_map || {}) },
      // The keys are lower case, so a state matches whatever case the key was written in; the values are dhw or heating.
      valve: Object.fromEntries(Object.entries({ ...(preset?.valve_map || {}), ...(config.valve_map || {}) }).map(([k, v]) => [String(k).toLowerCase(), hfcValveSide(v)])),
    };
    this._runningStates = config.running_states || preset?.running_states || [];
    this._statusLabels = preset?.status_labels || {};
    this._statLabels = preset?.stat_labels || {};
    this._errorOk = (config.error_ok || preset?.error_ok || []).map((state) => state.trim().toLowerCase()).filter(Boolean);
    this._badges = config.badges || [];
    this._layout = HFC_LAYOUTS.includes(config.layout) ? config.layout : 'default';
    this._animations = HFC_ANIMATIONS.includes(config.animations) ? config.animations : 'auto';
    this._theme = HFC_THEMES.includes(config.theme) ? config.theme : 'auto';
    this._flowSpeed = +config.flow_speed >= 0.2 && +config.flow_speed <= 3 ? +config.flow_speed : 1;
    this._sourceSpread = config.source_spread !== false;
    // hc_flow_label: false hides the flow temperature at the circuits, e.g. where it is the heat pump's flow during a hot-water charge (#291).
    this._hcFlowLabel = config.hc_flow_label !== false;
    this._hcType = config.hc_type || preset?.hc_type || 'underfloor';
    this._hcCount = hfcHcCount(config);
    this._hcTypes = [this._hcType, ...[2, 3, 4, 5, 6].map((n) => config[`hc${n}_type`] || 'underfloor')];
    this._sourceType = config.source_type || 'air';
    this._threshold = Number.isFinite(+config.power_threshold) && config.power_threshold !== '' && config.power_threshold !== undefined ? +config.power_threshold : 100;
    this._needsBuild = true;
    this._lastTry = 0;
    this._rendered = false;
    this._e = this._e || {};
    this._tileMap = this._tileMap || {};
    this._errors = this._errors || [];
    if (this.shadowRoot && this._hass) { try { this._build(); this._render(); this._update(); } catch (err) { this._fail(err); } }
  }

  // Resolves preset + user entities. Needs hass for detection and registry lookups.
  // Resolves preset and user entities. Used by the card and by the editor (which shows what the preset found).
  static _resolve(config, hass) {
    const preset = HFC_PRESETS[config.preset];
    const idx = { hp: 1, dhw: 1, buffer: 1, hc: 1, ...(preset?.index || {}), ...(config.index || {}) };
    const hcCount = hfcHcCount(config);
    const ctx =HeatpumpFlowCard._ctx(hass, config.device, idx);
    let prefix = config.prefix;
    let ready = true;
    if (preset && (prefix === undefined || prefix === null || prefix === '' || prefix === 'auto')) {
      prefix = preset.detect ? preset.detect(ctx) : '';
      if (prefix === undefined) { prefix = ''; ready = false; }
    }
    if (preset?.ready && !preset.ready(ctx)) ready = false;
    prefix = String(prefix || '').trim().toLowerCase();
    const fromPreset = {};
    const take = (k, v) => {
      const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
      // First candidate with a value; one that exists but is unavailable or unknown (not reported by this model) yields to a later one.
      const live = (id) => hass.states[id] && !['unknown', 'unavailable'].includes(hass.states[id].state);
      const hit = list.find(live) || list.find((id) => hass.states[id]) || list[0];
      if (hit) fromPreset[k] = hit;
    };
    if (preset) Object.entries(preset.entities(prefix, idx, ctx)).forEach(([k, v]) => take(k, v));
    for (let n = 2; preset && n <= hcCount; n++) {
      const rawN = preset.entities(prefix, { ...idx, hc: idx.hc + n - 1 }, ctx);
      // hc_pressure is the pressure of the whole heating system, drawn at circuit 1 only.
      Object.entries(rawN).filter(([k]) => k.startsWith('hc_') && k !== 'hc_pressure').forEach(([k, v]) => take(`hc${n}_${k.slice(3)}`, v));
      // Room keys are not prefixed with hc_ in a preset because circuit 1 uses room/room_target. Carry the circuit-specific
      // result into the numbered public keys so the house overview receives the rooms of circuits 2 to 6.
      if (preset.circuit_rooms) ['room', 'room_target'].forEach((k) => take(`hc${n}_${k}`, rawN[k]));
    }
    const e = { ...fromPreset };
    const sums = {};
    // User entities override the preset; null or "none" removes a preset entity.
    // A list adds the values of its entities (power, heat and the power sources), e.g. two S0 meters; the first one stands for the key.
    Object.entries(config.entities || {}).forEach(([k, v]) => {
      if (v === null || v === 'none') delete e[k];
      else if (Array.isArray(v)) {
        const ids = v.filter(Boolean);
        if (ids.length) e[k] = ids[0];
        if (ids.length > 1) sums[k] = ids;
      } else if (v) e[k] = v;
    });
    const presetErrors = preset && preset.errors ? preset.errors(prefix, idx, ctx) : [];
    const errors = config.errors !== undefined ? config.errors : presetErrors;
    // Stat tile entities: { tile: { period: entity } }, only entities that exist.
    const tiles = {};
    if (preset && preset.tiles) {
      Object.entries(preset.tiles(prefix, idx, ctx)).forEach(([k, periods]) => Object.entries(periods || {}).forEach(([period, v]) => {
        const hit = (Array.isArray(v) ? v : [v]).filter(Boolean).find((id) => hass.states[id]);
        if (hit) (tiles[k] = tiles[k] || {})[period] = hit;
      }));
    }
    // Total counters configured directly are also tile sources. Their calendar periods come from long-term statistics.
    [['energy_total', 'energy'], ['env_energy', 'env_energy'], ['heat_total', 'heat']].forEach(([entityKey, tileKey]) => {
      if (e[entityKey] && hass.states[e[entityKey]]) (tiles[tileKey] = tiles[tileKey] || {}).total = e[entityKey];
    });
    // Own tile sources replace the preset's for that tile (#262): an entity id is a total counter, whose calendar periods come
    // from long-term statistics; a map names the entity of each period. null or "none" removes the tile's preset source.
    Object.entries(config.tile_sources || {}).forEach(([key, v]) => {
      if (!hfcTileSourceKey(key)) return;
      delete tiles[key];
      const periods = typeof v === 'string' ? (v === 'none' ? {} : { total: v }) : (v || {});
      Object.entries(periods).forEach(([period, id]) => {
        if (typeof id === 'string' && hass.states[id] && HFC_PERIODS.includes(period)) (tiles[key] = tiles[key] || {})[period] = id;
      });
    });
    const presetControls = preset?.controls ? preset.controls(prefix, idx, ctx) : [];
    const presetDetails = preset?.details ? preset.details(prefix, idx, ctx) : [];
    const controls = config.controls !== undefined ? config.controls : presetControls;
    const details = config.details !== undefined ? config.details : presetDetails;
    return { preset, prefix, ready, idx, fromPreset, entities: e, sums, presetErrors, errors, tiles,
      presetControls, controls, details };
  }

  // Conservative suggestions for the no-preset assistant (#149). Existing mappings are left alone, disabled/unavailable entities
  // are ignored, and an ambiguous field receives no proposal. The editor writes none of these until the user confirms them.
  static _assistantProposals(hass, device, config = {}) {
    if (!device || !hass?.states || !hass?.entities) return [];
    const rows = Object.entries(hass.states).filter(([id, state]) => {
      const entry = hass.entities[id];
      return entry?.device_id === device && !entry.disabled_by && !['unknown', 'unavailable'].includes(String(state?.state || '').toLowerCase());
    });
    return Object.entries(HFC_ASSISTANT_RULES).flatMap(([key, rule]) => {
      if (config.entities?.[key] && config.entities[key] !== 'none') return [];
      const wanted = new Set(rule.names.map(hfcAssistantName));
      const hits = rows.filter(([id, state]) => {
        if (HeatpumpFlowCard._fit(rule.kind, id, state).verdict === 'bad') return false;
        return [...hfcAssistantNames(id, hass.entities[id], state)].some((name) => wanted.has(name));
      });
      return hits.length === 1 ? [{ key, id: hits[0][0] }] : [];
    });
  }

  // How an entity fits a kind of HFC_KINDS: 'ok' with positive evidence (unit, device class, thermostat), 'bad' with a reason
  // ({code, unit | domain | state}), 'unknown' when nothing tells (a number without unit). Unavailable states are never 'bad'.
  static _fit(kindName, id, st) {
    const kind = HFC_KINDS[kindName];
    if (!kind || !st) return { verdict: 'unknown' };
    const domain = String(id).split('.')[0];
    // Spellings of the same unit: the ordinal sign for the degree (ºC), the one-character ℃ and ℉, hours written out.
    const unit = String(st.attributes?.unit_of_measurement || '').trim().toLowerCase().replace(/º/g, '°').replace('℃', '°c').replace('℉', '°f')
      .replace(/^(hours|hrs|hr)$/, 'h');
    const cls = st.attributes?.device_class;
    if (!kind.domains.includes(domain)) return { verdict: 'bad', code: 'domain', domain };
    if (kind.units) {
      // Power: exactly the units the card converts (hfcPowerFactor), so the check and the card agree.
      const known = kindName === 'power' ? hfcPowerFactor(st.attributes?.unit_of_measurement) !== undefined : kind.units.includes(unit);
      if (unit && !known) return { verdict: 'bad', code: 'unit', unit: st.attributes.unit_of_measurement };
      if (kind.numeric && !['climate', 'water_heater'].includes(domain) && !['unknown', 'unavailable', '', 'none'].includes(String(st.state ?? '').toLowerCase())
        && !Number.isFinite(parseFloat(st.state))) return { verdict: 'bad', code: 'state', state: st.state };
      return (unit || (kind.device_class && cls === kind.device_class) || (kindName === 'temperature' && ['climate', 'water_heater'].includes(domain)))
        ? { verdict: 'ok' } : { verdict: 'unknown' };
    }
    if (unit && HFC_PHYSICAL_UNITS.has(unit) && !(kind.extra || []).includes(unit)) return { verdict: 'bad', code: 'unit', unit: st.attributes.unit_of_measurement };
    // A key for a running state holds no counter: starts and hours only grow (#186, heater = heater starts).
    if (kind.onoff && ['total', 'total_increasing'].includes(st.attributes?.state_class)) return { verdict: 'bad', code: 'counter' };
    return { verdict: kind.onoff && ['binary_sensor', 'switch', 'input_boolean'].includes(domain) ? 'ok' : 'unknown' };
  }

  // Plausibility checks of the mapped entities (#192): entities that do not fit their field, one entity in fields that measure
  // different things, source fields of an air heat pump, daily values far above what a day can bring. Warnings only, for the editor
  // and the diagnostic report; the card itself shows nothing. Returns [{key, code, id, ...details}].
  static _checks(config, hass, r = HeatpumpFlowCard._resolve(config || {}, hass)) {
    config = config || {};
    const out = [];
    const ids = (key) => (r.sums?.[key] || [r.entities[key]]).filter((id) => typeof id === 'string' && id);
    Object.keys(r.entities).forEach((key) => {
      const kind = hfcKindOf(key);
      if (!kind) return;
      ids(key).forEach((id) => {
        const fit = HeatpumpFlowCard._fit(kind, id, hass.states[id]);
        if (fit.verdict === 'bad') out.push({ key, id, kind, ...fit });
      });
    });
    // Keys that never share an entity: they measure different places or different quantities (#75, #180, #189).
    const circuits = ['', ...Array.from({ length: HFC_MAX_HC - 1 }, (_, n) => String(n + 2))];
    const pairs = [['flow', 'return'], ['power', 'heat'], ['compressor', 'heater'], ['starts_total', 'starts_today'], ['energy_total', 'energy_today'],
      ['heat_total', 'energy_today'], ['heat_total', 'energy_total'], ['env_energy', 'heat_total'], ['env_energy', 'energy_total'],
      ['volume', 'source_volume'], ['source_in', 'flow'], ['source_in', 'return'], ['source_out', 'flow'], ['source_out', 'return'],
      ...['flow', 'return'].flatMap((a) => ['dhw_top', 'dhw_middle', 'dhw_bottom', 'buffer_top', 'buffer_middle', 'buffer_bottom'].map((b) => [a, b])),
      ...circuits.flatMap((n) => [[`hc${n}_flow`, `hc${n}_return`], [`hc${n}_volume`, 'source_volume']])];
    pairs.forEach(([a, b]) => {
      const id = r.entities[a];
      if (typeof id === 'string' && id && id === r.entities[b]) out.push({ key: b, id, code: 'same', other: a });
    });
    // Source fields of an air heat pump: the card draws no brine or well loop, an own entity there is a mix-up (#180).
    if ((config.source_type || 'air') === 'air') {
      ['source_volume', 'source_out', 'brine_pressure'].forEach((key) => {
        const own = config.entities?.[key];
        if (own && own !== 'none') out.push({ key, id: Array.isArray(own) ? own.join(', ') : own, code: 'air' });
      });
    }
    // The operating mode is what the heat pump does now. A select is a mode someone chose ("Heat only"), which the card cannot read as
    // running, so heating and hot water stay idle (#276).
    ids('mode').forEach((id) => {
      const domain = id.split('.')[0];
      if (['select', 'input_select'].includes(domain)) out.push({ key: 'mode', id, code: 'setting', domain });
    });
    // Daily values no home installation reaches: the total counter in a daily field (#189). state_class cannot tell, daily
    // utility meters are total_increasing as well. A preset that names the value itself (ViCare shows its start counter as
    // "Compressor starts" through stat_labels) means it.
    const today = (key, limit, scale = () => 1) => ids(key).forEach((id) => {
      if (r.preset?.stat_labels?.[key] && r.fromPreset?.[key] === id) return;
      const st = hass.states[id]; const v = parseFloat(st?.state) * scale(String(st?.attributes?.unit_of_measurement || '').toLowerCase());
      if (Number.isFinite(v) && v > limit) out.push({ key, id, code: 'today', value: st.state });
    });
    today('starts_today', 150);
    today('energy_today', 150, (u) => ({ wh: 0.001, mwh: 1000 }[u] || 1));
    return out;
  }

  // One finding as text. L: editor labels of one language; label: how the key is named (the field label or the key).
  static _checkText(f, L, label = (k) => k) {
    const fill = (text) => String(text || '').replace(/\{(\w+)\}/g, (_, k) => ({
      field: label(f.key), other: label(f.other), entity: f.id, unit: f.unit, domain: f.domain, state: f.state, value: f.value,
      expected: L[`kind_${f.kind}`] || f.kind,
    }[k] ?? ''));
    return fill(L[`check_${f.code}`] || f.code);
  }

  // Entities the preset would map but that are disabled in Home Assistant (#146), from the full entity registry (`disabled`:
  // [{entity_id, platform, translation_key, device_id, name}]). Disabled entities are missing from hass.states and hass.entities, so
  // the preset is resolved once more with them added; keys whose entity is then a disabled one and not live today are returned.
  static _disabledMappings(config, hass, disabled) {
    if (!disabled?.length || !HFC_PRESETS[config?.preset] || !hass?.states) return [];
    const extra = Object.fromEntries(disabled.map((e) => [e.entity_id, e]));
    const states = { ...hass.states };
    disabled.forEach((e) => { if (!states[e.entity_id]) states[e.entity_id] = { entity_id: e.entity_id, state: 'unavailable', attributes: {} }; });
    const live = HeatpumpFlowCard._resolve(config, hass).entities;
    const probe = HeatpumpFlowCard._resolve(config, { ...hass, states, entities: { ...HeatpumpFlowCard._registry(hass), ...extra } });
    return Object.entries(probe.fromPreset).filter(([key, id]) => extra[id] && !hass.states[live[key]] && !(key in (config.entities || {})))
      .map(([key, id]) => ({ key, id, name: extra[id].name }));
  }

  // What the detection of a preset looks for (#147): its calls to ctx.key and ctx.match, recorded while it runs, with the
  // integration (platform) and whether each one found something. Detection stops at the first hit, so later lookups are not listed.
  static _detectProbe(preset, hass, device, idx = { hp: 1, dhw: 1, buffer: 1, hc: 1, ...(preset?.index || {}) }) {
    const ctx = HeatpumpFlowCard._ctx(hass, device, idx);
    const looked = [];
    const note = (platform, what, hit) => { if (!looked.some((l) => l.what === what && l.platform === platform)) looked.push({ platform, what, hit: hit !== undefined }); return hit; };
    const { key, match } = ctx;
    ctx.key = (platform, domain, tk) => note(platform, `${domain} with translation key ${tk}`, key(platform, domain, tk));
    ctx.match = (re, platform) => note(platform, `entity id ${re.source}`, match(re, platform));
    let found = false;
    try { found = !!preset?.detect && preset.detect(ctx) !== undefined; } catch (err) { /* a failing detection finds nothing */ }
    return { looked, found };
  }

  // Plain-text support report. It is created locally and contains only the mappings used by this card, never registry
  // dumps, credentials or network data. Entity ids may still contain personal names, so the report starts with a warning.
  static _diagnosticReport(config, hass) {
    config = config || {};
    const r = HeatpumpFlowCard._resolve(config, hass);
    const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    const entityLine = (key, id) => {
      if (!id) return `- ${key}: not mapped`;
      const st = hass.states[id];
      if (!st) return `- ${key}: ${id} = unavailable (entity not found)`;
      const unit = clean(st.attributes?.unit_of_measurement);
      const attr = hfcTempAttr(id, key);
      return `- ${key}: ${id} = ${clean(st.state) || '(empty)'}${unit ? ` ${unit}` : ''}${attr ? ` (${attr} ${clean(st.attributes?.[attr]) || '(empty)'})` : ''}`;
    };
    const keys = [...HFC_DIAGNOSTIC_KEYS, ...Object.keys(r.entities).filter((key) => !HFC_DIAGNOSTIC_KEYS.includes(key) && !HFC_MAP_KEYS.includes(key))];
    // Detection (#147): what the configured preset looked for, the heat pump integrations in this Home Assistant (platform names
    // and entity counts only) and the presets that match here. The platforms are the ones the detections of all presets ask for.
    const reg = HeatpumpFlowCard._registry(hass) || {};
    const probes = Object.fromEntries(Object.entries(HFC_PRESETS).map(([name, preset]) => [name, HeatpumpFlowCard._detectProbe(preset, hass)]));
    const own = HeatpumpFlowCard._detectProbe(r.preset, hass, config.device, r.idx);
    const platformPresets = {};
    Object.entries(probes).forEach(([name, probe]) => probe.looked.forEach((l) => { if (l.platform) (platformPresets[l.platform] = platformPresets[l.platform] || new Set()).add(name); }));
    const counts = {};
    Object.values(reg).forEach((e) => { if (e?.platform && platformPresets[e.platform]) counts[e.platform] = (counts[e.platform] || 0) + 1; });
    const matches = HeatpumpFlowCard._presetMatches(hass);
    const instanceGroups = r.preset?.instances ? r.preset.instances(HeatpumpFlowCard._ctx(hass, config.device, r.idx)) : [];
    const bestInstanceScore = instanceGroups[0]?.score;
    const tiedInstances = instanceGroups.filter((g) => g.score === bestInstanceScore);
    const configuredInstance = String(config.prefix || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const instanceExplicit = !!configuredInstance && instanceGroups.some((g) => g.stem === configuredInstance);
    const detection = [
      ...(r.preset ? [`- ${clean(config.preset)} looked for: ${own.looked.length
        ? own.looked.map((l) => `${l.what}${l.platform ? ` (${l.platform})` : ''}: ${l.hit ? 'found' : 'not found'}`).join('; ') : 'its own entity ids'}`] : []),
      `- Heat pump integrations here: ${Object.keys(counts).length ? Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([pl, n]) => `${pl} (${n} ${n === 1 ? 'entity' : 'entities'}; preset${platformPresets[pl].size > 1 ? 's' : ''} ${[...platformPresets[pl]].join(', ')})`).join(', ') : 'none found'}`,
      `- Presets that match here: ${matches.length ? matches.map((m) => `${m.name} (${m.score} of ${HFC_CORE_KEYS.length} core entities)`).join(', ') : 'none'}`,
      ...(instanceGroups.length ? [`- Preset entity groups: selected ${r.prefix || '(none)'}; ${instanceGroups.map((g) => `${g.stem} (${g.score} entities)`).join(', ')}${tiedInstances.length > 1 && !instanceExplicit ? '; equally complete groups: set prefix to the full group name' : ''}`] : []),
    ];
    // Source of each mapping (#147): found by the preset, set in the configuration ("own", naming its integration when it is not
    // one the preset reads), or cleared on purpose. Keys of circuits beyond hc_count are left out of the unmapped list.
    const ownEntities = config.entities && typeof config.entities === 'object' ? config.entities : {};
    const presetPlatforms = new Set(own.looked.map((l) => l.platform).filter(Boolean));
    const source = (key, id) => {
      const set = ownEntities[key];
      if (set === undefined || set === null || set === 'none') return 'preset';
      const pl = reg[id]?.platform;
      return pl && r.preset && presetPlatforms.size && !presetPlatforms.has(pl) ? `own · ${pl}` : 'own';
    };
    const hcCount = hfcHcCount(config);
    const inUse = (key) => { const m = /^hc([2-6])_/.exec(key); return !m || +m[1] <= hcCount; };
    const cleared = keys.filter((key) => ownEntities[key] === null || ownEntities[key] === 'none');
    const unmapped = keys.filter((key) => !r.entities[key] && !cleared.includes(key) && inUse(key));
    // Value maps of the preset and of the configuration, each with its source (#125): raw states and card modes only. Short maps
    // list their entries, long ones (mostly from presets) their size. A map under `entities` never reaches the card.
    const isMap = (m) => !!m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length > 0;
    const mapText = (m) => { const list = Object.entries(m); return list.length > 8 ? `${list.length} entries` : list.map(([k, v]) => `${clean(k)}=${clean(v)}`).join(', '); };
    const mapLines = HFC_MAP_KEYS.flatMap((name) => [[r.preset?.[name], 'preset'], [config[name], 'configuration']]
      .filter(([m]) => isMap(m)).map(([m, from]) => `- ${name}: ${mapText(m)} (${from})`));
    const misplaced = HFC_MAP_KEYS.filter((name) => config.entities && typeof config.entities === 'object' && name in config.entities)
      .map((name) => `- ${name} under entities: ignored, it belongs at the top level of the card configuration`);
    const lines = [
      'Heat Pump Hydraulic Card diagnostic report',
      'Privacy: entity ids can contain personal names. Review this text before sharing it.',
      '',
      `Card version: ${HFC_VERSION}`,
      `Loaded from: ${clean(HFC_SCRIPT_URL.replace(/[?#].*$/, '')) || 'unknown'}`,
      // Two scripts of this card mean an old resource next to the new one: the first loaded wins the element names (#171).
      ...(hfcCardScripts().length > 1 ? [`Card scripts on this page: ${hfcCardScripts().map(clean).join(', ')} (only one should be loaded)`] : []),
      `Home Assistant: ${clean(hass.config?.version) || 'unknown'}`,
      `Browser language: ${clean(navigator.language) || 'unknown'}`,
      `Card language: ${HeatpumpFlowCard._language(config, hass)}`,
      `Preset: ${clean(config.preset) || 'none'}`,
      `Preset detected: ${r.preset ? (r.ready ? 'yes' : 'no') : 'not used'}`,
      `Prefix: ${r.prefix || '(none)'}`,
      `Source type: ${config.source_type || 'air'}`,
      `Heating circuits: ${hfcHcCount(config)}`,
      // The hydraulic options decide what the schematic draws, so a report of a storage or flow problem needs them.
      `Storage: ${config.storage || 'separate'} · hot water: ${config.dhw_type || 'coil'} · parallel buffer: ${config.storage === 'combined' ? 'combined storage' : config.buffer ? 'yes, configured' : ['buffer_top', 'buffer_mode'].some((k) => r.entities[k]) ? 'yes, from entities' : 'no'} · series buffer: ${config.series_buffer ? (config.series_bypass === false ? 'yes, no bypass valve' : 'yes') : 'no'} · primary pump: ${(config.primary_pump ?? !!r.preset?.primary_pump) ? 'yes' : 'no'}`,
      `Layout: ${config.layout || 'default'}`,
      `Circuit labels: flow ${config.hc_flow_label === false ? 'hidden' : 'shown'} · return ${config.hc_return_label ? 'shown' : 'hidden'}`,
      '',
      'Detection:',
      ...detection,
      '',
      'Entity mappings (source: [preset] found by the preset, [own] set in the card configuration):',
      ...keys.filter((key) => r.entities[key]).flatMap((key) => (r.sums[key] ? r.sums[key].map((id, n) => `${entityLine(`${key} (${hfcMeanKey(key) ? 'average' : 'sum'} ${n + 1})`, id)} [${source(key, id)}]`)
        : [`${entityLine(key, r.entities[key])} [${source(key, r.entities[key])}]`])),
      ...(cleared.length ? [`- Cleared on purpose: ${cleared.join(', ')}`] : []),
      `- Not mapped: ${unmapped.length ? unmapped.join(', ') : 'none'} (an empty key is fine when the installation does not have it)`,
      ...(r.preset?.valve_rule === 'flow_above_dhw' && !r.entities.valve && r.entities.flow && r.entities.dhw_top
        ? ['- Hot water without a valve entity: while the heat pump runs and flow is above dhw_top (preset rule)'] : []),
      '',
      // Plausibility checks (#192), in English like the rest of the report.
      'Checks:',
      ...((checks) => (checks.length ? checks.map((f) => `- ${clean(HeatpumpFlowCard._checkText(f, HFC_EDITOR.en))}`) : ['- no findings']))(HeatpumpFlowCard._checks(config, hass, r)),
      '',
      'Maps:',
      ...(mapLines.length || misplaced.length ? [...mapLines, ...misplaced] : ['- none']),
      '',
      'Error entities:',
      ...(r.errors?.length ? r.errors.map((id, n) => entityLine(`error_${n + 1}`, id)) : ['- none']),
      '',
      ...(config.tile_sources ? ['Tile sources (own):', ...Object.keys(config.tile_sources).flatMap((key) => {
        const periods = Object.entries(r.tiles[key] || {});
        return periods.length ? periods.map(([period, id]) => entityLine(`${key} ${period}`, id)) : [`- ${key}: none (entity missing or removed)`];
      }), ''] : []),
      'Quick controls:',
      ...(r.controls.length ? r.controls.map((c, n) => entityLine(`control_${n + 1}`, typeof c === 'string' ? c : c?.entity)) : ['- none']),
    ];
    return lines.join('\n');
  }

  _build() {
    const r = HeatpumpFlowCard._resolve(this._config, this._hass);
    this._e = r.entities;
    this._sums = r.sums;
    this._errors = r.errors;
    this._tileMap = r.tiles;
    this._presetControls = r.presetControls;
    this._details = r.details;
    // Preset sensors whose refrigerant role holds only in heating; an entity set in the config keeps its role.
    this._heatingRoles = (r.preset?.heating_roles || []).filter((k) => this._e[k] && this._e[k] === r.fromPreset[k] && !(this._config.entities || {})[k]);
    // An action for a key without an entity does nothing; say so once instead of failing silently.
    if (r.ready && this._config.actions) {
      const lost = Object.keys(this._config.actions).filter((k) => !this._e[k] && !(this._warned || (this._warned = {}))[k]);
      lost.forEach((k) => { this._warned[k] = true; console.warn(`heatpump-flow-card: actions.${k} has no entity (check the key or the preset)`); });
    }
    this._needsBuild = !r.ready;
    this._lastTry = Date.now();
    this._mapped = HeatpumpFlowCard._mappingSet(r); this._checkedAt = Date.now();
  }

  // Everything a resolution maps, as "kind:key=entity" strings: compared to find mappings that appeared later.
  static _mappingSet(r) {
    const id = (x) => (typeof x === 'string' ? x : x?.entity);
    return new Set([
      ...Object.entries(r.entities).map(([k, v]) => `entity:${k}=${v}`),
      ...Object.entries(r.tiles).flatMap(([k, periods]) => Object.entries(periods).map(([p, v]) => `tile:${k}.${p}=${v}`)),
      ...[...(r.controls || []), ...(r.details || []), ...(r.errors || [])].map((x) => `list:${id(x)}`),
    ]);
  }

  static _energyInfo(prefs, hass) {
    const sources = prefs?.energy_sources || [];
    const rate = (src) => {
      const pc = src.power_config;
      let result = null;
      if (pc && (pc.stat_rate_from || pc.stat_rate_to)) result = { from: pc.stat_rate_from, to: pc.stat_rate_to };
      else if (pc && pc.stat_rate) result = { id: pc.stat_rate, inv: !!pc.stat_rate_inverted };
      else if (src.stat_rate) result = { id: src.stat_rate };
      if (!result || !hass) return result;
      const ids = [result.id, result.from, result.to].filter(Boolean);
      // A missing state remains usable until HA supplies it; a known energy counter (Wh/kWh/MWh) is not current power.
      return ids.every((id) => !hass.states[id] || HeatpumpFlowCard._fit('power', id, hass.states[id]).verdict !== 'bad') ? result : null;
    };
    const configured = {}; const missing = [];
    const of = (type) => {
      const found = sources.filter((s) => s.type === type);
      // The same power sensor behind several sources (e.g. two tariffs) counts once.
      const sig = (r) => [r.id, !!r.inv, r.from, r.to].join('|');
      const rates = found.map(rate).filter(Boolean).filter((r, n, all) => all.findIndex((o) => sig(o) === sig(r)) === n);
      configured[type] = found.length > 0;
      // Several grid sources are usually tariffs of one connection and one meter, so one power sensor covers them all.
      // Several PV arrays or batteries are separate devices: each needs its own sensor, or the sum is incomplete.
      if (type === 'grid' ? found.length > 0 && !rates.length : found.length > found.map(rate).filter(Boolean).length) missing.push(type);
      return rates;
    };
    return { energy: { solar: of('solar'), battery: of('battery'), grid: of('grid') }, configured, missing };
  }

  // PV / battery / grid power from the Energy dashboard (its "stat_rate" power sensors), loaded once per page.
  // Conventions of the Energy dashboard: battery positive = discharging, grid positive = import.
  _loadEnergy() {
    if (this._energyReq || this._config.power_sources === 'manual' || typeof this._hass.callWS !== 'function') return;
    this._energyReq = true;
    HeatpumpFlowCard._energyPrefs = HeatpumpFlowCard._energyPrefs || this._hass.callWS({ type: 'energy/get_prefs' });
    HeatpumpFlowCard._energyPrefs.then((prefs) => {
      const { energy, configured, missing } = HeatpumpFlowCard._energyInfo(prefs, this._hass);
      this._energy = energy.solar.length || energy.battery.length || energy.grid.length ? energy : null;
      this._energyConfigured = configured;
      this._energyMissing = missing;
      if (this._hass) { this._rendered = false; this.hass = this._hass; }
    }).catch(() => { this._energy = null; this._energyConfigured = {}; this._energyMissing = []; });
  }

  // Manual pv/battery/grid entities win; otherwise the Energy dashboard is used (needs the heat pump power).
  _powerMode() {
    if (['pv', 'battery', 'grid'].some((k) => this._has(k))) return 'manual';
    if (this._energy && this._config.power_sources !== 'manual' && this._has('power')) return 'energy';
    return '';
  }

  // Power sources the installation has: a manual entity, or a source of that type in the Energy dashboard.
  // A missing one (e.g. no battery) is left out of the schematic instead of being drawn dimmed.
  _srcKeys() {
    const mode = this._powerMode();
    const type = { pv: 'solar', battery: 'battery', grid: 'grid' };
    return ['pv', 'battery', 'grid'].filter((key) => (mode === 'energy' ? !!this._energyConfigured?.[type[key]] : mode === 'manual' && !!this._e[key]));
  }

  _rateW(r) {
    const w = (id) => hfcPowerW(id && this._hass.states[id]);
    if (r.id) return w(r.id) * (r.inv ? -1 : 1);
    return (r.from ? w(r.from) : 0) - (r.to ? w(r.to) : 0);
  }

  // Splits the heat pump's power by the house's current supply mix: PV used in the house, battery discharge, grid import.
  // PV first covers battery charging and export. Returns W per source, or null while a sensor is unavailable.
  _energySplit() {
    const sum = (list) => list.reduce((a, r) => a + this._rateW(r), 0);
    const values = {}; const unknown = [];
    [['pv', 'solar'], ['battery', 'battery'], ['grid', 'grid']].forEach(([key, type]) => {
      const value = sum(this._energy[type] || []);
      const incomplete = this._energyMissing?.includes(type);
      if (incomplete || (this._energyConfigured?.[type] && !Number.isFinite(value))) unknown.push(key);
      values[key] = Number.isFinite(value) && !incomplete ? value : 0;
    });
    if (unknown.length > 1) return null;
    const pv = values.pv; const bat = values.battery; const grid = values.grid;
    const charge = Math.max(-bat, 0); const discharge = Math.max(bat, 0);
    const imp = Math.max(grid, 0); const exp = Math.max(-grid, 0);
    const pvHome = Math.max(Math.max(pv, 0) - charge - exp, 0);
    const hp = Math.max(this._w('power'), 0);
    if (!Number.isFinite(hp) || hp <= 50) return { pv: 0, battery: 0, grid: 0 };
    const shares = { pv: pvHome, battery: discharge, grid: imp };
    if (unknown.length === 1) {
      const known = Object.entries(shares).filter(([key]) => key !== unknown[0]).reduce((total, [, value]) => total + value, 0);
      shares[unknown[0]] = Math.max(hp - known, 0);
    }
    const total = shares.pv + shares.battery + shares.grid;
    if (!(total > 50) || !Number.isFinite(hp)) return { pv: 0, battery: 0, grid: 0 };
    return { pv: hp * shares.pv / total, battery: hp * shares.battery / total, grid: hp * shares.grid / total };
  }

  getCardSize() { return 9 + (this._hcCount || 1) * 3 - 3; }
  getGridOptions() { return { columns: 'full', min_columns: 6, rows: 'auto' }; }

  set hass(hass) {
    this._hass = hass;
    this._renderRoot();
    if (!this._config) return;
    HeatpumpFlowCard._loadPresetRegistry(this, () => {
      this._needsBuild = true; this._rendered = false; this.hass = this._hass;
    });
    try { this._apply(); } catch (err) { this._fail(err); }
  }

  // Only this container belongs to the card. card-mod and other integrations may add styles beside it in the shadow root;
  // keeping those nodes out of our render target prevents a later setConfig/rebuild from deleting their CSS variables (#164).
  _renderRoot() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (this._ownedRoot?.parentNode !== this.shadowRoot) {
      this._ownedRoot = document.createElement('div');
      this._ownedRoot.setAttribute('data-hfc-root', '');
      this.shadowRoot.prepend(this._ownedRoot);
    }
    return this._ownedRoot;
  }

  _apply() {
    if (this._preset?.entity_registry) {
      const revision = HeatpumpFlowCard._pointtRevision(this._hass);
      if (revision !== this._pointtRevision) {
        this._pointtRevision = revision; this._needsBuild = true; this._lastTry = 0;
      }
    }
    // A preset that maps optional hardware by its readings (`dynamic`) looks again every minute. Only a mapping that has
    // appeared since the build triggers a new build: a sensor that drops out for a moment never removes anything.
    if (this._preset?.dynamic && !this._needsBuild && this._rendered && this._mapped && Date.now() - this._checkedAt > 60000) {
      this._checkedAt = Date.now();
      const r = HeatpumpFlowCard._resolve(this._config, this._hass);
      if (r.ready && [...HeatpumpFlowCard._mappingSet(r)].some((m) => !this._mapped.has(m))) { this._needsBuild = true; this._lastTry = 0; }
    }
    // Retry detection at most every 30 s while the integration's entities are not there yet.
    if (this._needsBuild && (!this._rendered || Date.now() - this._lastTry > 30000)) { this._build(); this._rendered = false; }
    this._loadEnergy();
    const sig = this._layoutSignature();
    if (!this._rendered || sig !== this._sig) this._render();
    this._update();
  }

  // Unexpected data must not leave an empty card: show a short message and log the details once.
  _fail(err) {
    if (!this._failed) console.error('heatpump-flow-card:', err);
    this._failed = true;
    this._rendered = false;
    const msg = this._esc(err && err.message ? err.message : String(err));
    this._renderRoot().innerHTML = `<style>${HeatpumpFlowCard.styles}</style><ha-card><div class="hint">Heat Pump Hydraulic Card: ${msg}<br>Details in the browser console. Please report it: github.com/Sturmi77/heatpump-hydraulic-card/issues</div></ha-card>`;
  }

  /* ---------- helpers ---------- */
  get _lang() { return HeatpumpFlowCard._language(this._config, this._hass); }
  get _i() {
    const lang = this._lang; const texts = this._config?.texts;
    if (!this._textCache || this._textCache.lang !== lang || this._textCache.texts !== texts) {
      this._textCache = { lang, texts, value: HeatpumpFlowCard._texts(this._config, this._hass) };
    }
    return this._textCache.value;
  }
  _st(key) { const id = this._e[key]; return id && this._hass ? this._hass.states[id] : undefined; }
  _has(key) { return !!this._st(key); }
  _s(key) { return this._st(key)?.state; }
  _n(key) {
    if (this._sums?.[key] && hfcMeanKey(key)) return this._mean(key);
    const attr = hfcTempAttr(this._e[key], key);
    const v = parseFloat(attr ? this._st(key)?.attributes?.[attr] : this._s(key));
    return Number.isFinite(v) ? v : NaN;
  }
  // Mean of a list of room sensors (#23): the members that report a number, each converted to the unit of the first member,
  // so the key keeps that member's unit. Unknown only when no member reports a number.
  _mean(key) {
    const unitOf = (id) => String(this._hass?.states[id]?.attributes?.unit_of_measurement || '').trim().toLowerCase().replace(/º/g, '°').replace('℃', '°c').replace('℉', '°f');
    const toC = (v, u) => (u === '°f' ? (v - 32) * 5 / 9 : u === 'k' ? v - 273.15 : v);
    const fromC = (v, u) => (u === '°f' ? v * 9 / 5 + 32 : u === 'k' ? v + 273.15 : v);
    const humidity = key.endsWith('_humidity'); const base = unitOf(this._e[key]);
    const values = this._sums[key].map((id) => {
      const st = this._hass?.states[id]; const attr = hfcTempAttr(id, key);
      const v = parseFloat(attr ? st?.attributes?.[attr] : st?.state);
      return !Number.isFinite(v) || humidity ? v : fromC(toC(v, unitOf(id)), base);
    }).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  }
  // A sum is complete when every member reports a number. An incomplete sum is still shown, but no COP is formed from it:
  // with one of two units of a cascade missing, heat and power would not belong to the same machines (#23, #173).
  _sumComplete(key) { return !this._sums?.[key] || this._sums[key].every((id) => Number.isFinite(hfcPowerW(this._hass?.states[id]))); }
  _unit(key) { return String(this._st(key)?.attributes?.unit_of_measurement || '').toLowerCase(); }
  // Absolute temperature normalized to Celsius. Most of the drawing uses the installation's native values, but physical
  // calculations (dew point and its margin) need one common scale; a temperature difference in °F is not a kelvin difference.
  _tempC(key) {
    const value = this._n(key);
    if (!Number.isFinite(value)) return NaN;
    const unit = this._unit(key).trim().replace(/º/g, '°').replace('℃', '°c').replace('℉', '°f');
    if (unit === '°f') return (value - 32) * 5 / 9;
    if (unit === 'k') return value - 273.15;
    return value;
  }
  // Unit-aware readings: power in W, heat in kW, flow rates in l/h. A list of entities gives the sum of the members that report a number.
  _w(key) { return this._sumPower(key, 1); }
  _kw(key) { return this._sumPower(key, 1000); }
  _sumPower(key, divisor) {
    const read = (st) => hfcPowerW(st, divisor) / divisor;
    if (!this._sums?.[key]) { const v = read(this._st(key)); return Number.isFinite(v) ? v : NaN; }
    const values = this._sums[key].map((id) => read(this._hass?.states[id])).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) : NaN;
  }
  // Flow rate in l/h. A negative value is a marker, not a flow: EMS-ESP reports -1 for PC0 below about 50 % speed (#312). It
  // counts as unknown, so the primary pump follows the operating state and no "-1 l/h" is shown.
  _lh(key) {
    const v = this._n(key); const u = this._unit(key).replace('³', '3');
    if (v < 0) return NaN;
    if (u === 'm3/h') return v * 1000;
    if (u === 'l/min') return v * 60;
    return v;
  }
  // Hydraulic pressure normalized to bar. Unknown or missing units are treated as bar for simple numeric helpers.
  _pressure(key) {
    const v = this._n(key); const u = this._unit(key).replace(/\s/g, '');
    if (!Number.isFinite(v)) return NaN;
    if (u === 'pa') return v / 100000;
    if (u === 'hpa') return v / 1000;
    if (u === 'kpa') return v / 100;
    if (u === 'mpa') return v * 10;
    if (u === 'psi') return v * 0.0689476;
    return v;
  }
  _pressureState(kind, value) {
    if (!Number.isFinite(value)) return 'normal';
    const c = +this._config[`${kind}_pressure_crit`]; const min = +this._config[`${kind}_pressure_min`]; const max = +this._config[`${kind}_pressure_max`];
    if (this._config[`${kind}_pressure_crit`] !== undefined && this._config[`${kind}_pressure_crit`] !== '' && value <= c) return 'critical';
    if ((this._config[`${kind}_pressure_min`] !== undefined && this._config[`${kind}_pressure_min`] !== '' && value < min)
      || (this._config[`${kind}_pressure_max`] !== undefined && this._config[`${kind}_pressure_max`] !== '' && value > max)) return 'warning';
    return 'normal';
  }
  _pressureText(key) { const v = this._pressure(key); return Number.isFinite(v) ? `${this._fmt(v, 1)} bar` : '–'; }
  _updatePressure(key, kind, groupId, textId, label) {
    const group = this._$(groupId); if (!group) return;
    const value = this._pressure(key); const state = this._pressureState(kind, value);
    group.classList.toggle('warning', state === 'warning'); group.classList.toggle('critical', state === 'critical');
    const glyph = state === 'critical' ? '⚠ ' : state === 'warning' ? '! ' : '';
    this._txt(textId, `${glyph}${label} ${this._pressureText(key)}`);
    group.dataset.a11y = `${label}: ${this._pressureText(key)}, ${this._i[`pressure_${state}`]}`;
  }
  _on(key) { return ['on', 'true', 'open', '1', 'ein'].includes(String(this._s(key)).toLowerCase()); }
  // A manually mapped second heat generator may be binary, a numeric level/power, or a common running-state text.
  _boilerOn() {
    if (!this._has('boiler_state')) return this._w('boiler_power') > 0;
    const s = String(this._s('boiler_state')).trim().toLowerCase();
    return ['on', 'true', 'open', 'ein', 'active', 'running', 'heating', 'heat', 'burner', 'firing'].includes(s)
      || parseFloat(s) > 0;
  }
  // A circuit pump: binary, a speed above 0 (%), or the ebusd pump state, which names what the pump runs for:
  // off, heat, cool or exthwc (#295).
  _pumpOn(key) {
    const s = String(this._s(key)).trim().toLowerCase();
    return this._on(key) || ['heat', 'cool', 'exthwc'].includes(s) || parseFloat(s) > 0;
  }
  // Diverter valve state through `valve_map`: true = hot water, false = heating, undefined = the state is not in the map.
  _valveMapped(raw) {
    const mapped = this._norm(this._maps.valve, raw);
    return mapped === 'dhw' ? true : mapped === 'heating' ? false : undefined;
  }
  // PV surplus mode: a binary entity that is on, or a power (e.g. the setpoint of an energy manager) above 0.
  _pvOn(state) { const s = String(state).toLowerCase(); return ['on', 'true', 'open', 'ein'].includes(s) || parseFloat(s) > 0; }
  _pvBoost() { return this._has('pv_boost') && this._pvOn(this._s('pv_boost')); }
  _sgReadyState(raw = this._s('sg_ready')) {
    if (raw === undefined || ['unknown', 'unavailable'].includes(String(raw).toLowerCase())) return '';
    const state = String(this._norm(this._maps.sg, raw)).toLowerCase();
    return HFC_SG_READY_STATES.includes(state) ? state : '';
  }
  // Defrost and cooling run the refrigerant circuit backwards: the outdoor heat exchanger is the condenser then.
  _reversedCycle() {
    return ['defrost', 'cooling'].includes(this._norm(this._maps.mode, this._s('mode')))
      || String(this._s('status') || '').toUpperCase().includes('DEFROST') || (this._has('defrost') && this._on('defrost'));
  }
  // Compressor modulation 0..1 from `compressor_speed` (percent; Hz or rpm against `compressor_speed_max`), NaN without a usable value.
  _speedFraction() {
    const v = this._n('compressor_speed');
    if (!Number.isFinite(v)) return NaN;
    const u = this._unit('compressor_speed');
    const max = +this._config.compressor_speed_max;
    const full = max > 0 ? max : (u === 'rpm' || u.includes('min') ? 6000 : 100);
    return Math.min(Math.max(v / full, 0), 1);
  }
  // Heating program (eco, night, party, holiday) from the `program` entity, else from the circuit mode; kind 'none' when it matches nothing.
  _program() {
    const key = this._has('program') ? 'program' : (this._has('hc_mode') ? 'hc_mode' : '');
    if (!key) return null;
    const raw = String(this._s(key));
    const map = { ...(this._preset?.program_map || {}), ...(this._config.program_map || {}) };
    const mapped = this._norm(map, raw);
    let kind = HFC_PROGRAMS.includes(mapped) ? mapped : 'none';
    if (kind === 'none' && mapped !== 'none') {
      const hit = HFC_PROGRAM_PATTERNS.find(([, re]) => re.test(raw.toLowerCase()));
      if (hit) kind = hit[0];
    }
    return { kind, entity: this._e[key] };
  }
  // Heater level: 0 = off, 1 = on / stage 1, 2-3 = stage. Binary, on/off text, power (> 0) or a stage number.
  _level(key) {
    if (!this._has(key)) return 0;
    const s = String(this._s(key)).toLowerCase();
    if (['on', 'true', 'open', 'ein'].includes(s)) return 1;
    const v = parseFloat(s);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return ['w', 'kw', '%'].includes(this._unit(key)) ? 1 : Math.min(Math.round(v), 3);
  }
  _hk(n, key) { return n === 1 ? `hc_${key}` : `hc${n}_${key}`; }
  _norm(map, raw) { if (raw === undefined) return ''; return map[raw] || map[String(raw).toUpperCase()] || map[String(raw).toLowerCase()] || String(raw).toLowerCase(); }
  _fmt(v, d = 1) {
    const loc = this._hass?.locale?.language || this._lang;
    return Number.isFinite(v) ? v.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
  }
  _t(v) { return Number.isFinite(v) ? `${this._fmt(v)} °C` : '– °C'; }
  _circulationKey() { return ['circulation', 'circulation_schedule', 'circulation_start', 'circulation_end'].find((key) => this._has(key)); }
  // One explicit daily window, or the next change of a Home Assistant schedule. Plain time states and local date-time states keep
  // their wall-clock value; timestamped values are formatted in the Home Assistant time zone.
  _timeText(raw) {
    const value = String(raw ?? '').trim();
    if (!value || ['unknown', 'unavailable', 'none'].includes(value.toLowerCase())) return '';
    const clock = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
    if (clock && +clock[1] < 24 && +clock[2] < 60) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
    // A program slot that runs to the end of the day ends at 24:00 (ebusd CcTimer, #331).
    if (clock && +clock[1] === 24 && +clock[2] === 0 && !+(clock[3] || 0)) return '24:00';
    const local = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
    if (local && +local[1] < 24 && +local[2] < 60) return `${local[1]}:${local[2]}`;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? this._timelineTime(ms) : '';
  }
  _circulationProgram() {
    const start = this._timeText(this._s('circulation_start')); const end = this._timeText(this._s('circulation_end'));
    if (start && end) return `${start}–${end}`;
    const schedule = this._st('circulation_schedule');
    const state = String(schedule?.state || '').toLowerCase();
    const next = this._timeText(schedule?.attributes?.next_event);
    if (!next || !['on', 'off'].includes(state)) return '';
    return `${state === 'on' ? this._i.circulation_until : this._i.circulation_from} ${next}`;
  }
  _modeLabel(m, raw) { return this._i.modes[m] || raw || '–'; }
  _statLabel(key, fallback) { return this._statLabels[key]?.[this._lang] || this._statLabels[key]?.en || fallback; }
  // Colour scales follow hydraulic convention: flow red/orange, return blue, tanks blue (cold) → red (hot).
  // The end colours are the --hfc-*-cold / --hfc-*-hot variables, mixed in the browser.
  _mix(cold, hot, t, lo, hi) {
    if (!Number.isFinite(t)) return 'var(--disabled-text-color, #9e9e9e)';
    const f = Math.min(Math.max((t - lo) / (hi - lo), 0), 1);
    return `color-mix(in oklch, ${hfcVar(hot)} ${Math.round(f * 100)}%, ${hfcVar(cold)})`;
  }
  // Tank scale in four steps (cold, cool, warm, hot), each step mixed in oklch.
  _tankColor(t) {
    if (!Number.isFinite(t)) return 'var(--disabled-text-color, #9e9e9e)';
    const stops = ['tank-cold', 'tank-cool', 'tank-warm', 'tank-hot'];
    const x = Math.min(Math.max((t - 20) / (58 - 20), 0), 1) * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    return `color-mix(in oklch, ${hfcVar(stops[i + 1])} ${Math.round((x - i) * 100)}%, ${hfcVar(stops[i])})`;
  }
  // Pipes without a temperature sensor keep their conventional base colour instead of turning grey.
  _vlColor(t) { return Number.isFinite(t) ? this._mix('flow-cold', 'flow-hot', t, 25, 55) : `color-mix(in srgb, ${hfcVar('flow-cold')} 60%, #fff)`; }
  _rlColor(t) { return Number.isFinite(t) ? this._mix('return-cold', 'return-hot', t, 20, 45) : `color-mix(in srgb, ${hfcVar('return-cold')} 75%, #fff)`; }
  _$(id) { return this.shadowRoot.getElementById(id); }
  // Status line of the heat pump block: one line, or mode on top and status below when it is too long for the block (the text of an
  // SVG does not wrap by itself). A single long word is squeezed to the width of the block.
  _hpStatus(text) {
    const el = this._$('t-hp-status');
    if (!el) return;
    const ku = parseFloat(getComputedStyle(this._$('svg')).getPropertyValue('--ku')) || 1;
    const key = `${text}|${ku}`;
    if (el._k === key) return;
    el._k = key;
    const long = text.length * 7.4 * ku > 216;
    const parts = long ? text.split(' · ') : [text];
    const wrapped = parts.length > 1;
    el.textContent = '';
    if (wrapped) {
      const NS = 'http://www.w3.org/2000/svg';
      const a = document.createElementNS(NS, 'tspan'); a.setAttribute('x', 170); a.textContent = parts[0];
      const b = document.createElementNS(NS, 'tspan'); b.setAttribute('x', 170); b.setAttribute('dy', 17); b.setAttribute('class', 'status2'); b.textContent = parts.slice(1).join(' · ');
      el.append(a, b);
    } else el.textContent = text;
    if (long && !wrapped) { el.setAttribute('textLength', 216); el.setAttribute('lengthAdjust', 'spacingAndGlyphs'); } else { el.removeAttribute('textLength'); el.removeAttribute('lengthAdjust'); }
    el.setAttribute('y', wrapped ? 362 : 366);
    this._$('t-hp-power')?.setAttribute('y', wrapped ? 397 : 390);
    this._$('t-hp-cop')?.setAttribute('y', wrapped ? 416 : 412);
  }

  // Target of circuit n with the heating curve shift, e.g. "Target 36 °C (curve 34 °C + 2 K shift)": the target already contains the
  // shift, so the curve gives target − shift. The text ends at the pump and runs left over the circuit pipe; where it does not fit
  // (narrow schematics), the word for the shift and then the part in brackets are left out. A shift is a difference: °C shows as K.
  // Next to a buffer the text starts right of the tank in two lines (data-lines="2"): the target, then the part in brackets in
  // smaller type, which drops the word for the shift and then itself where it would reach the circuit title (x 800).
  _hcTarget(n, set, shift, unit) {
    const el = this._$(`t-hc${n === 1 ? '' : n}`); if (!el) return;
    const i = this._i;
    const f = (v) => this._fmt(v, Number.isInteger(v) ? 0 : 1);
    const u = ['', '°c', 'k'].includes(unit) ? 'K' : unit;
    // Without a shift the curve is the target: only "Target 34 °C".
    const part = Number.isFinite(shift) && shift !== 0 ? `${shift < 0 ? '−' : '+'} ${f(Math.abs(shift))} ${u}` : '';
    let texts = [''];
    if (Number.isFinite(set) && part) {
      const head = `${i.target} ${f(set)} °C`; const curve = `${i.curve_offset} ${f(set - shift)} °C ${part}`;
      texts = [`${head} (${curve} ${i.curve_shift})`, `${head} (${curve})`, head];
    } else if (Number.isFinite(set)) texts = [`${i.target} ${f(set)} °C`];
    else if (part) texts = [`${i.curve_shift} ${part}`];
    const key = `${texts[0]}|${getComputedStyle(el).fontSize}`;
    if (el._k === key) return;
    if (el.dataset.lines === '2') { el._k = this._hcTargetLines(el, texts) ? key : ''; return; }
    let measured = true;
    for (const t of texts) {
      el.textContent = t;
      let w = 0;
      try { w = el.getComputedTextLength(); } catch (err) { w = 0; }
      if (!(w > 0)) { measured = false; break; }
      // From the pump (x 736) back to the riser of the diverter valve (x 386) with some air.
      if (w <= 736 - 400) break;
    }
    el._k = measured ? key : '';
  }

  // Two-line variant of _hcTarget: texts as there, the first is the full text "head (part)". Returns false while unmeasured.
  _hcTargetLines(el, texts) {
    const full = texts[0]; const cut = full.indexOf(' (');
    const head = cut < 0 ? full : full.slice(0, cut);
    const parts = cut < 0 ? [''] : [...texts.filter((t) => t.startsWith(`${head} (`)).map((t) => t.slice(head.length + 1)), ''];
    const NS = 'http://www.w3.org/2000/svg';
    el.textContent = '';
    const top = document.createElementNS(NS, 'tspan'); top.textContent = head; el.append(top);
    const sub = document.createElementNS(NS, 'tspan'); sub.setAttribute('class', 'curve-part'); sub.setAttribute('x', el.getAttribute('x')); sub.setAttribute('dy', '17');
    el.append(sub);
    for (const p of parts) {
      sub.textContent = p;
      if (!p) return true;
      let w = 0;
      try { w = sub.getComputedTextLength(); } catch (err) { w = 0; }
      if (!(w > 0)) return false;
      if (w <= 800 - 648) return true;
    }
    return true;
  }

  // The line under the schematic in the narrow focus view: outdoor and air inlet temperatures, the power from PV, battery and grid
  // (as configured, in the format of the schematic) and the room humidity of a single circuit. Missing values are left out.
  _focusLine(srcParts) {
    const el = this._$('focus-line'); const i = this._i; const P = this._parts;
    const parts = [];
    if (this._has('outdoor')) parts.push(`${i.outdoor} ${this._t(this._n('outdoor'))}`);
    if (this._sourceType === 'air') parts.push(...srcParts);
    if (P.power) {
      const split = P.power === 'energy' ? this._energySplit() : null;
      const labels = { pv: i.pv, battery: i.battery, grid: i.grid };
      this._srcKeys().forEach((key) => {
        const w = P.power === 'energy' ? (split ? split[key] : NaN) : this._w(key);
        if (Number.isFinite(w)) parts.push(`${labels[key]} ${P.power === 'energy' ? '≈' : ''}${this._fmt(w, 0)} W`);
      });
    }
    const humidity = P.house && this._hcCount === 1 ? this._roomHumidity(1) : NaN;
    if (Number.isFinite(humidity)) parts.push(`${i.humidity} ${this._fmt(humidity, 0)} %`);
    const html = parts.map((p) => `<span>${this._esc(p)}</span>`).join(' · ');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // Room keys of circuit n: circuit 1 uses the room and target of the house, circuits 2 to 6 their own.
  _roomKey(n, key = 'room') { return n === 1 ? key : `hc${n}_${key}`; }

  // Dew point per circuit: an explicit sensor wins. Otherwise calculate it from room temperature and relative humidity with the
  // Magnus approximation (valid for normal indoor conditions). Missing or implausible values deliberately produce no warning.
  _roomHumidity(n) {
    const value = this._n(this._roomKey(n, 'room_humidity'));
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : NaN;
  }
  _dewPoint(n) {
    const explicit = this._tempC(this._roomKey(n, 'dew_point'));
    if (Number.isFinite(explicit)) return explicit;
    const temperature = this._tempC(this._roomKey(n)); const humidity = this._roomHumidity(n);
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return NaN;
    const a = 17.62; const b = 243.12;
    const gamma = Math.log(humidity / 100) + (a * temperature) / (b + temperature);
    return (b * gamma) / (a - gamma);
  }

  // Room values have their own overview in the house (#140); the line below an emitter is reserved for its operating mode.
  _hcStatus(n, status) {
    const s = n === 1 ? '' : String(n);
    this._txt(`t-hc-mode${s}`, status);
  }

  // Label with a prefix (VL / RL) that narrow schematics leave out.
  _txtPre(id, pre, text) {
    const el = this._$(id); if (!el) return;
    const key = text ? `${pre}|${text}` : '';
    if (el._k === key) return;
    el._k = key; el.textContent = '';
    if (!text) return;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    t.setAttribute('class', 'pre'); t.textContent = `${pre} `;
    el.append(t, text);
  }
  _txt(id, text) { const el = this._$(id); if (el && el.textContent !== text) el.textContent = text; }
  // Label whose tail (for example the humidity after the room target) the narrow focus view hides; without the option a plain label.
  _txtTail(id, main, tail) {
    if (!this._narrowFocus()) { this._txt(id, `${main}${tail}`); return; }
    const el = this._$(id); if (!el) return;
    const key = `${main}|${tail}`;
    if (el._k === key) return;
    el._k = key; el.textContent = main;
    if (!tail) return;
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    t.setAttribute('class', 'nf-tail'); t.textContent = tail;
    el.append(t);
  }
  _cls(id, on) { const el = this._$(id); if (el) el.classList.toggle('on', !!on); }
  _esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Which optional blocks exist – the SVG is rebuilt only when this changes.
  _layoutSignature() {
    if (!this._hass || !this._e) return '';
    // A combined storage is one tank with the hot-water zone on top and the heating zone below: drawn without sensors, and to the
    // circuits it is a buffer that decouples them from the heat pump.
    const combined = this._config.storage === 'combined';
    const configuredBuffer = !combined && this._config.buffer === true;
    const buffer = combined || configuredBuffer || this._has('buffer_top') || this._has('buffer_mode');
    const dhwType = this._config.dhw_type || 'coil';
    const station = this._station();
    const dhw = combined || station || ['dhw_top', 'dhw_middle', 'dhw_bottom', 'dhw_mode'].some((k) => this._has(k));
    const parts = {
      combined,
      configuredBuffer,
      dhwType: station || combined ? dhwType : 'coil',
      station,
      power: this._powerMode(),
      sources: `${this._powerMode() === 'energy' ? [this._energy.solar.length, this._energy.battery.length, this._energy.grid.length].join() : ''}|${this._srcKeys().join()}`,
      // A tank with only a lower sensor (e.g. HeishaMon's single sensor near the bottom) is still drawn.
      dhw,
      buffer,
      // A series buffer sits in the return; a parallel buffer (explicit or with its own sensors) wins.
      series: !!this._config.series_buffer && !buffer && (this._noBypass() ? 'fixed' : 'valve'),
      // Circuit 1 exists wherever the heat loop is drawn, without a sensor of its own: it hangs on the buffer (whose temperature
      // it shows as its flow), or on the heat pump's flow and return in a direct system.
      hc: this._has('hc_flow') || this._has('hc_mode') || this._has('hc_pump') || buffer || this._has('flow') || this._has('return'),
      house: Array.from({ length: this._hcCount }, (_, n) => ['room', 'room_target', 'room_humidity'].some((key) => this._has(this._roomKey(n + 1, key)))).some(Boolean),
      circ: ['circulation', 'circulation_start', 'circulation_end', 'circulation_schedule'].some((key) => this._has(key)),
      primaryPump: this._primaryPump(),
      hcPump: this._has('hc_pump'),
      hcType: this._hcType,
      hcs: this._hcCount > 1 ? this._hcTypes.slice(0, this._hcCount).join() : '',
      mixers: Array.from({ length: this._hcCount }, (_, n) => (this._hasMixer(n + 1) ? 1 : 0)).join(''),
      src: this._sourceType,
      unit: this._unitKey(),
      boiler: ['boiler_state', 'boiler_power', 'boiler_flow'].some((k) => this._has(k)),
      heaters: ['heater', ...HFC_TANK_HEATERS].map((k) => (this._has(k) ? 1 : 0)).join(''),
      middle: [this._has('dhw_middle') ? 1 : 0, this._has('buffer_middle') ? 1 : 0].join(''),
      // The gradient of a combined storage has one stop per sensor present: a sensor that appears later rebuilds it.
      combinedSensors: combined ? this._combinedSensors().map(([k]) => k).join() : '',
      pressure: [this._sourceType === 'brine' && this._has('brine_pressure') ? 1 : 0, this._has('hc_pressure') ? 1 : 0].join(''),
      solar: dhw && !station && (this._has('solar_collector') || this._has('solar_pump')),
      controls: this._controlList().map((c) => c.entity).join(),
      drawer: this._drawerRows().map(([s, r]) => s + r.map((x) => x[0]).join('.')).join('|'),
      lang: this._lang,
    };
    this._parts = parts;
    return JSON.stringify(parts);
  }

  /* ---------- render ---------- */
  _emitter(type, title) {
    if (type === 'column') {
      // Traditional column radiator: rounded joined sections, flow at the top and return at the bottom.
      const columns = Array.from({ length: 7 }, (_, n) => `<g transform="translate(${832 + n * 17} 0)"><rect class="column-rib" x="0" y="350" width="13" height="120" rx="6" style="fill:url(#g-rad__S__)"/><circle class="column-cap" cx="6.5" cy="356" r="6"/><circle class="column-cap" cx="6.5" cy="464" r="6"/></g>`).join('');
      return {
        vl: 'M640 360 H826',
        body: 'M826 360 H944 M944 460 H826',
        rl: 'M826 460 H805 Q785 460 785 478 Q785 495 765 495 H640',
        title: `<text class="tank-title" x="888" y="296" text-anchor="middle">${title}</text>`,
        art: `<path class="column-link" d="M832 372 H947 M832 448 H947"/>${columns}<path class="column-foot" d="M846 470v8 M934 470v8"/>
          <g class="waves" id="waves__S__">${[854, 888, 922].map((x) => `<path class="wave" d="M${x} 338 q7 -7 0 -14 q-7 -7 0 -14"/>`).join('')}</g>`,
      };
    }
    if (type === 'radiator') {
      // Radiator: flow enters top left, return leaves bottom left, heat waves rise above.
      const ribs = Array.from({ length: 8 }, (_, n) => `<rect class="rib" x="${838 + n * 14}" y="352" width="9" height="116" rx="4" style="fill:url(#g-rad__S__)"/>`).join('');
      return {
        vl: 'M640 360 H826',
        body: 'M826 365 H940 M940 455 H826',
        rl: 'M826 455 H805 Q785 455 785 475 Q785 495 765 495 H640',
        title: `<text class="tank-title" x="888" y="296" text-anchor="middle">${title}</text>`,
        art: `<rect class="radiator" x="826" y="345" width="126" height="130" rx="10"/>${ribs}
          <g class="waves" id="waves__S__">${[855, 888, 921].map((x) => `<path class="wave" d="M${x} 336 q7 -7 0 -14 q-7 -7 0 -14"/>`).join('')}</g>`,
      };
    }
    return {
      vl: 'M640 360 H800',
      body: 'M800 360 H935 Q955 360 955 380 Q955 400 935 400 H825 Q805 400 805 420 Q805 440 825 440 H935 Q955 440 955 460 Q955 480 935 480 H800',
      rl: 'M800 480 Q785 480 785 490 Q785 495 775 495 H640',
      title: `<text class="tank-title" x="880" y="320" text-anchor="middle">${title}</text>`,
      art: '<rect class="screed" x="795" y="490" width="170" height="10" rx="3"/>',
    };
  }

  _render() {
    if (!this._hass || !this._config) return;
    this._sig = this._layoutSignature();
    const P = this._parts;
    const e = this._e;
    const i = this._i;
    const T = this._esc(this._config.title ?? i.title);
    if (this._startState()) {
      this._renderRoot().innerHTML = `<style>${HeatpumpFlowCard.styles}</style><ha-card class="start"><div class="head">${T ? `<div class="title">${T}</div>` : '<div></div>'}</div>
        <div class="hint" id="start-hint">${this._esc(i.start)} <a href="https://github.com/Sturmi77/heatpump-hydraulic-card#quick-start" target="_blank" rel="noopener noreferrer">${this._esc(i.start_link)}</a></div></ha-card>`;
      this._rendered = true;
      return;
    }
    const fullLabel = this._fullscreenOpen ? i.fullscreen_close : i.fullscreen_open;
    const diagnosticIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h4"/></svg>';
    const fullscreenIcon = this._fullscreenOpen
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>';
    const automaticEnergy = this._config.power_sources !== 'manual' && !['pv', 'battery', 'grid'].some((key) => this._has(key));
    const energyHint = automaticEnergy && this._energyMissing?.length
      ? i.energy_missing.replace('{sources}', this._energyMissing.map((type) => ({ solar: i.pv, battery: i.battery, grid: i.grid }[type])).join(', ')) : '';
    const de = (k) => (e[k] ? `data-entity="${this._esc(e[k])}"` : '');
    const pipePair = (id, d, show = true) => (show
      ? `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>` : '');
    const P_SRC = 'M70 70 V118 Q70 140 92 140 H148 Q170 140 170 162 V190';
    const G_SRC = 'M270 70 V118 Q270 140 248 140 H192 Q170 140 170 162 V190';
    const shown = P.power ? this._srcKeys() : [];
    const SRC = [['pv', 70, i.pv, P_SRC, 'pv'], ['bat', 170, i.battery, 'M170 70 V190', 'battery'], ['grid', 270, i.grid, G_SRC, 'grid']]
      .filter((s) => shown.includes(s[4]));
    const showHc = P.hc || this._hcCount > 1;
    const U = this._sourceType === 'air' ? this._unitArt() : null;
    const H = 560 + (showHc ? (this._hcCount - 1) * 250 : 0);
    const equalBuffer = this._config.buffer_values === 'equal';
    const nf = this._narrowFocus();
    const bufferKeys = ['buffer_top', 'buffer_middle', 'buffer_bottom'].filter((key) => this._has(key));
    const bufferY = equalBuffer && bufferKeys.length
      ? Object.fromEntries(bufferKeys.map((key, n) => [key, bufferKeys.length === 1 ? 446 : 382 + n * (118 / (bufferKeys.length - 1))]))
      : { buffer_top: 392, buffer_middle: 446, buffer_bottom: 502 };

    this._renderRoot().innerHTML = `
      <style>${HeatpumpFlowCard.styles}</style>
      <div class="fullscreen-backdrop" id="fullscreen-backdrop" ${this._fullscreenOpen ? '' : 'hidden'}></div>
      <ha-card class="layout-${this._layout} motion-${this._animations} theme-${this._theme}${this._config.narrow_values ? ' narrow-values' : ''}${nf ? ' narrow-focus' : ''}${equalBuffer ? ' buffer-values-equal' : ''}${this._fullscreenOpen ? ' fullscreen' : ''}"${this._fullscreenOpen ? ` role="dialog" aria-modal="true" aria-label="${T}"` : ''}>
        <div class="head">
          ${T ? `<div class="title">${T}</div>` : '<div></div>'}
          <div class="head-right">
            <div class="chips">
              <span class="chip" id="chip-mode" ${de('mode')}></span>
              <span class="chip program" id="chip-program"></span>
              <span class="chip pvboost" id="chip-pv" ${de('pv_boost')}><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" stroke-linecap="round"/></svg>${this._esc(i.pv_boost)}</span>
              <span class="chip sg-ready" id="chip-sg" ${de('sg_ready')}></span>
              ${this._badges.map((b, n) => `<span class="chip badge" id="chip-b${n}" data-badge="${n}" data-entity="${this._esc(b.entity)}">${this._esc(b.label || b.entity)}</span>`).join('')}
              <span class="chip err" id="chip-err"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20.5h19z" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.5v.01" stroke-linecap="round"/></svg>${this._esc(i.error)}</span>
            </div>
            <div class="card-tools">
              ${this._config.diagnostic === false ? '' : `<button class="icon-button" id="diagnostic-copy" type="button" title="${this._esc(i.diagnostic_copy)}" aria-label="${this._esc(i.diagnostic_copy)}">${diagnosticIcon}</button>`}
              ${this._config.fullscreen === false ? '' : `<button class="icon-button" id="fullscreen-toggle" type="button" title="${this._esc(fullLabel)}" aria-label="${this._esc(fullLabel)}" aria-pressed="${!!this._fullscreenOpen}">${fullscreenIcon}</button>`}
              <span class="sr-only" id="tool-status" aria-live="polite"></span>
            </div>
          </div>
        </div>
        ${this._needsBuild && this._preset ? `<div class="hint">${this._esc(i.not_found)}</div>` : ''}
        ${energyHint ? `<div class="hint">${this._esc(energyHint)}</div>` : ''}
        <div class="body">
        <div class="stage">
        <svg viewBox="0 0 1000 ${H}" id="svg" role="group" tabindex="-1" aria-label="${T}">
          <defs>
            <linearGradient id="g-dhw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" id="g-dhw-top"/>${this._has('dhw_middle') ? '<stop offset="50%" id="g-dhw-middle"/>' : ''}<stop offset="100%" id="g-dhw-bottom"/></linearGradient>
            <linearGradient id="g-buf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" id="g-buf-top"/>${this._has('buffer_middle') ? '<stop offset="50%" id="g-buf-middle"/>' : ''}<stop offset="100%" id="g-buf-bottom"/></linearGradient>
            ${P.combined ? `<linearGradient id="g-cs" x1="0" y1="0" x2="0" y2="1">${this._combinedSensors().map(([k, y]) => `<stop offset="${(((y - 40) / 480) * 100).toFixed(1)}%" id="g-cs-${k}"/>`).join('') || `<stop offset="0%" stop-color="${this._tankColor(NaN)}"/>`}</linearGradient>` : ''}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          ${P.power ? `
            ${SRC.map(([id, , , d]) => `<path class="eline ${id}" d="${d}"/>`).join('')}
            ${SRC.map(([id, , , d]) => `<path class="eflow ${id}" id="ef-${id}" d="${d}"/>`).join('')}
            ${SRC.map(([id, x, label, , key]) => this._source(id, x, label, this._srcEntity(key))).join('')}` : ''}

          ${
    // The return pipes lie under the flow pipes where they cross (the flow at x 380, the hot-water flow at x 420).
    pipePair('rl-dhw', 'M520 215 H400 Q380 215 380 235 V380', P.dhw && !P.station)}
          ${pipePair('rl-buf', 'M520 495 H400 Q380 495 380 475 V380')}
          ${pipePair('rl', 'M380 380 H290')}
          ${pipePair('vl', P.dhw && !P.station ? 'M290 250 H402' : 'M290 250 H400 Q420 250 420 270 V338 Q420 360 442 360 H520')}
          ${pipePair('vl-dhw', 'M420 232 V102 Q420 80 442 80 H520', P.dhw && !P.station)}
          ${pipePair('vl-buf', 'M420 268 V338 Q420 360 442 360 H520', P.dhw && !P.station)}
          ${P.buffer ? '' : P.series ? this._seriesSvg() : `${pipePair('byp-vl', 'M520 360 H640')}${pipePair('byp-rl', 'M640 495 H520')}`}
          ${showHc ? Array.from({ length: this._hcCount }, (_, n) => this._circuitSvg(n + 1)
    // The trunk shared by all circuits lies over circuit 1 and under the risers. The risers lie under circuits 2 to 6, so their
    // labels stay in front of the pipes (#302).
    + (n === 0 && this._hcCount > 1 ? `${pipePair('hc-trunk-vl', 'M640 360 H660')}${pipePair('hc-trunk-rl', 'M676 495 H640')}${this._risersSvg()}` : '')).join('') : ''}
          ${this._sourceSvg()}

          ${this._primaryPump() ? `<g class="tap" ${de(e.volume ? 'volume' : 'mode')}>
            <circle class="pump" cx="${P.boiler ? 316 : 340}" cy="250" r="16"/>
            <g class="impeller" id="impeller-primary" style="transform-origin:${P.boiler ? 316 : 340}px 250px"><path d="M${P.boiler ? 316 : 340} 238 L${P.boiler ? 322 : 346} 250 L${P.boiler ? 310 : 334} 250Z M${P.boiler ? 316 : 340} 262 L${P.boiler ? 310 : 334} 250 L${P.boiler ? 322 : 346} 250Z" class="imp"/></g>
          </g>` : ''}
          <g class="tap" ${de('flow')}><text class="pipe-label${nf && !P.boiler ? ' nf-big' : ''}" id="t-vl" x="${P.boiler ? 316 : (this._primaryPump() ? 340 : 338)}" y="${this._primaryPump() ? 226 : 236}" text-anchor="middle"></text></g>
          <g class="tap" ${de('volume')}><text class="vol-label" id="t-vol" x="${P.boiler ? 316 : (this._primaryPump() ? 340 : 346)}" y="${this._primaryPump() ? 284 : 275}" text-anchor="middle"></text></g>
          <g class="tap" ${de('return')}><text class="pipe-label" id="t-rl" x="335" y="406" text-anchor="middle"></text></g>

          <g class="tap" ${de('mode')}>
            <rect class="unit" id="hp-box" x="50" y="190" width="240" height="235" rx="20"/>
            <text class="unit-title" x="170" y="218" text-anchor="middle">${this._esc(i.heat_pump)}</text>
            ${U ? `${U.below}${U.fans.map((fn, n) => this._fanSvg(n ? `fan${n + 1}` : 'fan', ...fn)).join('')}${U.above}${U.snows.map((sn, n) => this._snowSvg(n ? `snow${n + 1}` : 'snow', ...sn)).join('')}`
              : `<circle class="fan-ring" cx="170" cy="288" r="50"/>
            <g class="fan" id="fan"><path class="blade" d="M170 254 L184 288 L156 288Z M170 322 L156 288 L184 288Z"/><circle cx="170" cy="288" r="7" class="hub"/></g>
            ${this._snowSvg('snow', 170, 288, 18)}`}
            <g class="vapour" id="vapour" aria-hidden="true"><path class="vapour-puff" d="M112 332 q-14 -18 2 -32 q14 -12 0 -28"/><path class="vapour-puff" d="M170 338 q-16 -20 2 -35 q15 -13 0 -30"/><path class="vapour-puff" d="M226 332 q-14 -18 2 -32 q14 -12 0 -28"/></g>
            <text class="unit-status" id="t-hp-status" x="170" y="366" text-anchor="middle"></text>
            <text class="unit-val" id="t-hp-power" x="170" y="390" text-anchor="middle"></text>
            <text class="unit-val strong" id="t-hp-cop" x="170" y="412" text-anchor="middle"></text>
            ${nf ? '<text class="unit-val" id="t-hp-heat" x="170" y="374" text-anchor="middle"></text>' : ''}
          </g>
          ${this._sourceType === 'air' ? `<g class="tap" ${de(e.source_in ? 'source_in' : 'source_volume')}><text class="small${nf ? ' nf-moved' : ''}" id="t-src-in" x="170" y="450" text-anchor="middle"></text></g>${this._has('outdoor') ? `<g class="tap" ${de('outdoor')}><text class="small" id="t-outdoor-hp" x="170" y="472" text-anchor="middle"></text></g>` : ''}` : ''}
          ${this._heaterSvg('heater', 'inline')}
          ${P.boiler ? `<g class="tap boiler" id="boiler" ${de(e.boiler_state ? 'boiler_state' : (e.boiler_power ? 'boiler_power' : 'boiler_flow'))}>
            <text class="boiler-title" x="372" y="207" text-anchor="middle">${this._esc(i.boiler)}</text>
            <rect class="boiler-box" x="348" y="216" width="48" height="68" rx="8"/>
            <path class="boiler-water" d="M348 250 H396"/>
            <path class="flow" id="f-boiler" d="M348 250 H396"/>
            <path class="boiler-flame" d="M372 244 C360 237 365 226 373 222 C371 229 384 232 378 242 C377 244 375 245 372 244Z"/>
            <text class="boiler-value" id="t-boiler-power" x="372" y="274" text-anchor="middle"></text>
            <text class="small boiler-flow" id="t-boiler-flow" x="372" y="304" text-anchor="middle"></text>
          </g>` : ''}

          ${P.station ? this._stationSvg() : ''}
          ${P.solar ? this._solarPipes() : ''}
          ${P.dhw && !P.station ? `
            <g class="tap" ${de(e.valve ? 'valve' : 'dhw_mode')}>
              <circle class="valve" cx="420" cy="250" r="18"/>
              <path class="valve-arrow" id="valve-arrow" d="M420 262 V240 M412 248 L420 240 L428 248"/>
              <text class="small" id="t-valve" x="446" y="254"></text>
            </g>
            <g class="tap" ${de(['dhw_top', 'dhw_middle', 'dhw_bottom'].find((k) => e[k]) || 'dhw_top')}>
              ${P.combined ? `<text class="tank-title" x="580" y="30" text-anchor="middle">${this._esc(i.combined_tank)}</text>
              <rect class="tank" id="cs-tank" x="520" y="40" width="120" height="480" rx="26" fill="url(#g-cs)"/>
              <path class="zone-line" d="M528 280 H632"/>
              <text class="small zone-title on-tank" x="580" y="62" text-anchor="middle">${this._esc(i.dhw)}</text>`
    : `<text class="tank-title" x="580" y="30" text-anchor="middle">${this._esc(i.dhw)}</text>
              <rect class="tank" x="520" y="40" width="120" height="200" rx="26" fill="url(#g-dhw)"/>`}
              ${P.dhwType === 'coil' ? '<path class="coil" id="coil" d="M520 80 H600 L540 100 H600 L540 120 H600 L540 140 H600 L540 160 H600 L540 180 H600 L540 200 H520"/>' : ''}
              ${P.dhwType === 'tank_in_tank' ? '<rect class="inner-tank" id="inner-tank" x="540" y="72" width="80" height="188" rx="18"/>' : ''}
              ${P.dhwType === 'fresh_water' ? `${pipePair('fws-a', 'M640 206 H654')}${pipePair('fws-b', 'M640 226 H654')}${this._stationArt(652, 196, 56, 40)}` : ''}
              <text class="tank-temp" id="t-dhw-top" x="580" y="112" text-anchor="middle"></text>
              <text class="small${P.combined ? ' on-tank' : ''}" id="t-dhw-mode" x="580" y="262" text-anchor="middle"></text>
            </g>
            ${this._has('dhw_middle') ? `<g class="tap" ${de('dhw_middle')}><text class="tank-sub" id="t-dhw-middle" x="580" y="166" text-anchor="middle"></text></g>` : ''}
            <g class="tap" ${de('dhw_bottom')}><text class="tank-sub" id="t-dhw-bottom" x="580" y="222" text-anchor="middle"></text></g>
            ${this._tankHeaters('dhw', P).map((h) => this._heaterSvg(...h)).join('')}
            ${P.circ ? `<g class="tap" ${de(this._circulationKey())}><text class="small circ" id="t-circ" x="650" y="60">↻ ${this._esc(i.circulation)}</text></g>` : ''}` : ''}

          ${P.buffer ? `
            <g class="tap" ${de(P.combined ? (['buffer_top', 'buffer_middle', 'buffer_bottom', 'buffer_mode'].find((k) => e[k]) || 'buffer_top') : 'buffer_top')}>
              ${P.combined ? `<text class="small zone-title on-tank" x="580" y="304" text-anchor="middle">${this._esc(i.heating_zone)}</text>`
    : `<text class="tank-title" x="${P.station ? 512 : 580}" y="310" text-anchor="${P.station ? 'end' : 'middle'}">${this._esc(i.buffer)}</text>
              <rect class="tank" x="520" y="320" width="120" height="200" rx="26" fill="url(#g-buf)"/>`}
              <text class="tank-temp${equalBuffer ? ' buffer-value' : ''}" id="t-buf-top" x="580" y="${bufferY.buffer_top ?? 392}" text-anchor="middle"></text>
              <text class="small" id="t-buf-mode" x="580" y="542" text-anchor="middle"></text>
            </g>
            ${this._has('buffer_middle') ? `<g class="tap" ${de('buffer_middle')}><text class="tank-sub${equalBuffer ? ' buffer-value' : ''}" id="t-buf-middle" x="580" y="${bufferY.buffer_middle ?? 446}" text-anchor="middle"></text></g>` : ''}
            <g class="tap" ${de('buffer_bottom')}><text class="tank-sub${equalBuffer ? ' buffer-value' : ''}" id="t-buf-bottom" x="580" y="${bufferY.buffer_bottom ?? 502}" text-anchor="middle"></text></g>
            ${this._tankHeaters('buffer', P).map((h) => this._heaterSvg(...h)).join('')}` : ''}


          ${P.solar ? this._solarSvg() : ''}

          ${P.house ? this._houseSvg() : (this._has('outdoor') && this._sourceType !== 'air' ? `<g class="tap" ${de('outdoor')}><text class="small" id="t-outdoor" x="880" y="120" text-anchor="middle"></text></g>` : '')}
        </svg>
        ${nf ? '<div class="focus-line" id="focus-line"></div>' : ''}
        </div>
        <div class="side">
          ${this._config.timeline ? '<div class="timeline" id="timeline" hidden></div>' : ''}
          ${this._controlsHtml()}
          <div class="stats" id="stats"></div>
          ${this._drawerHtml()}
        </div>
        </div>
      </ha-card>`;

    this._wireTools();
    if (this._layout === 'wall') {
      const card = this.shadowRoot.querySelector('ha-card');
      ['pointerdown', 'pointermove', 'keydown', 'focusin'].forEach((t) => card.addEventListener(t, () => this._wake(), { passive: true }));
      card.classList.toggle('awake', !!this._awake || this._wallSeconds() === 0);
    }
    this._actEvents(this._$('svg'));
    this._actEvents(this.shadowRoot.querySelector('.head'));
    this._tileEvents(this._$('stats'));
    if (this._$('timeline')) this._timelineEvents(this._$('timeline'));
    this._rove(this._$('svg'), '[data-entity]', 'svg');
    this._rove(this._$('stats'), '.stat', 'stats');
    const drawer = this._$('drawer-body');
    if (drawer) {
      this._actEvents(drawer);
      this._rove(drawer, '.drow', 'drawer');
      this._$('drawer-toggle').addEventListener('click', () => {
        this._drawerOpen = !this._drawerOpen;
        drawer.hidden = !this._drawerOpen;
        this._$('drawer-toggle').setAttribute('aria-expanded', String(this._drawerOpen));
      });
    }
    const ctl = this._$('controls');
    if (ctl) {
      ctl.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-ctl]'); if (b) this._control(+b.dataset.ctl); });
      ctl.addEventListener('change', (ev) => { const el = ev.target.closest('[data-ctl]'); if (el) this._control(+el.dataset.ctl, el.value); });
    }
    this._rendered = true;
    this._a11yAt = 0;
  }

  /* ---------- quick controls ---------- */
  _controlList() {
    return (this._config.controls ?? this._presetControls ?? []).map((c) => (typeof c === 'string' ? { entity: c } : c))
      .filter((c) => c && c.entity && this._hass.states[c.entity]);
  }

  _controlKind(id) {
    const d = id.split('.')[0];
    if (['button', 'input_button', 'script', 'scene'].includes(d)) return 'press';
    if (['select', 'input_select', 'water_heater', 'climate'].includes(d)) return 'select';
    if (['number', 'input_number'].includes(d)) return 'number';
    return 'toggle';
  }

  _controlOptions(st) {
    const d = st.entity_id.split('.')[0];
    if (d === 'water_heater') return st.attributes.operation_list || [];
    if (d === 'climate') return st.attributes.hvac_modes || [];
    return st.attributes.options || [];
  }

  _stateText(st, value) {
    try { if (this._hass.formatEntityState) return this._hass.formatEntityState(st, value); } catch (e) { /* older HA */ }
    return value;
  }

  _controlsHtml() {
    const list = this._controlList();
    if (!list.length) return '';
    return `<div class="controls" id="controls">${list.map((c, n) => {
      const st = this._hass.states[c.entity];
      const name = this._esc(c.name || st.attributes.friendly_name || c.entity);
      const kind = this._controlKind(c.entity);
      if (kind === 'select') {
        return `<label class="ctl sel"><span>${name}</span><select data-ctl="${n}" id="ctl-${n}">${this._controlOptions(st).map((o) => `<option value="${this._esc(o)}">${this._esc(this._stateText(st, o))}</option>`).join('')}</select></label>`;
      }
      if (kind === 'number') {
        const a = st.attributes;
        return `<label class="ctl num"><span>${name}</span><input type="number" data-ctl="${n}" id="ctl-${n}" min="${a.min ?? ''}" max="${a.max ?? ''}" step="${a.step ?? 'any'}"><em>${this._esc(a.unit_of_measurement || '')}</em></label>`;
      }
      return `<button class="ctl ${kind}" data-ctl="${n}" id="ctl-${n}">${name}</button>`;
    }).join('')}</div>`;
  }

  _control(n, value) {
    const c = this._controlList()[n]; if (!c) return;
    const id = c.entity; const d = id.split('.')[0]; const kind = this._controlKind(id);
    const call = (domain, service, data = {}) => this._hass.callService(domain, service, { entity_id: id, ...data });
    if (kind === 'press') {
      if (d === 'script' || d === 'scene') call(d, 'turn_on'); else call(d, 'press');
    } else if (kind === 'select') {
      if (d === 'water_heater') call(d, 'set_operation_mode', { operation_mode: value });
      else if (d === 'climate') call(d, 'set_hvac_mode', { hvac_mode: value });
      else call(d, 'select_option', { option: value });
    } else if (kind === 'number') {
      const v = parseFloat(value); if (Number.isFinite(v)) call(d, 'set_value', { value: v });
    } else {
      call(['switch', 'input_boolean', 'light', 'fan', 'automation'].includes(d) ? d : 'homeassistant', 'toggle');
    }
  }

  _updateControls() {
    this._controlList().forEach((c, n) => {
      const el = this._$(`ctl-${n}`); if (!el) return;
      const st = this._hass.states[c.entity];
      const kind = this._controlKind(c.entity);
      if (kind === 'toggle') el.classList.toggle('on', ['on', 'open', 'heat', 'auto'].includes(st.state));
      else if (kind === 'select') { if (el.value !== st.state && this.shadowRoot.activeElement !== el) el.value = st.state; }
      else if (kind === 'number') { if (this.shadowRoot.activeElement !== el) el.value = st.state; }
    });
  }

  /* ---------- stat tiles ---------- */
  // Config entry → { key, period, … } or { entity, … }. Strings may carry the period: "cop_heating:month".
  static _tileSpec(t) {
    if (typeof t === 'string') { const [key, period] = t.split(':').map((x) => x.trim()); return { key, ...(period ? { period } : {}) }; }
    return t && typeof t === 'object' ? t : null;
  }

  // Editor: the tiles this installation can fill as select options, the current selection as option values and the default set.
  static _tileOptions(config, r, hass) {
    const I = HeatpumpFlowCard._texts(config, hass);
    const probe = Object.assign(Object.create(HeatpumpFlowCard.prototype), { _hass: hass, _e: r.entities, _sums: r.sums, _tileMap: r.tiles, _config: config });
    const options = [];
    const periodsOf = {};
    // The cost tile needs a price (global `price`).
    const hasPrice = config.price !== undefined && config.price !== null && config.price !== '';
    Object.keys(HFC_TILES).filter((k) => k !== 'cost' || hasPrice).forEach((key) => {
      const periods = probe._tilePeriods(key);
      periodsOf[key] = periods;
      periods.forEach((p) => options.push({ value: periods.length === 1 ? key : `${key}:${p}`, label: probe._tileLabel(key, p, I) }));
    });
    // Tiles with a single period are stored without it; others with the period, so the select can show them.
    const valueOf = (key, period) => {
      const periods = periodsOf[key] || [];
      if (periods.length === 1) return key;
      const p = period || probe._tileDefault(key);
      return p ? `${key}:${p}` : key;
    };
    let editable = true;
    const value = (Array.isArray(config.tiles) ? config.tiles : []).map((t) => {
      const s = HeatpumpFlowCard._tileSpec(t);
      if (!s) return null;
      if (!s.key || Object.keys(s).some((k) => !['key', 'period'].includes(k))) { editable = false; return null; }
      return valueOf(s.key, s.period);
    }).filter(Boolean);
    value.forEach((v) => { if (!options.some((o) => o.value === v)) options.push({ value: v, label: v }); });
    const defaults = ['cop_heating', 'cop_dhw', 'energy', 'starts', 'spread', 'volume', 'heat_estimated']
      .filter((k) => periodsOf[k].length).map((k) => valueOf(k));
    return { options, value, editable, defaults };
  }

  _tileLabel(key, period, I = this._i) {
    const def = HFC_TILES[key];
    // A circuit spread is named after its circuit: the configured name, else the number from circuit 2 on.
    const hc = HeatpumpFlowCard._hcSpreadCircuit(key);
    if (hc) {
      const own = this._config?.[this._hk(hc, 'name')];
      return own ? `${I.tiles.hc_spread} · ${own}` : hc > 1 ? `${I.tiles.hc_spread} ${hc}` : String(I.tiles.hc_spread);
    }
    const name = String(I.tiles[key]);
    const word = def.live || def.noSuffix || !period ? '' : String(I.periods[period]);
    // A name that already ends in the period word does not repeat it: "COP gesamt" for the total, not "COP gesamt · gesamt" (#288).
    return word && !name.toLowerCase().endsWith(` ${word.toLowerCase()}`) ? `${name} · ${word}` : name;
  }

  // Where a tile's value comes from for a period: an entity, the long-term statistics of a total counter,
  // a ratio of two other tiles (COP = heat ÷ electricity), or null when this installation cannot fill it.
  _tileSource(key, period) {
    const def = HFC_TILES[key];
    if (!def || (def.periods && !def.periods.includes(period))) return null;
    if (def.live) return period === 'now' && this._liveAvail(key) ? { live: true } : null;
    if (def.kind === 'classes') return period === 'total' && this._tileMap.load_class1 ? { classes: true } : null;
    if (def.kind === 'cost') return this._tileSource('energy', period) ? { cost: true } : null;
    if (def.kind === 'loss') return period === 'now' && this._lossIds() ? { loss: true } : null;
    if (def.kind === 'share') return this._timelineIds()?.pv ? { share: true } : null;
    const map = this._tileMap[key] || {};
    // The entities of the default tiles (cop_heating_today …) count as "today", unless the preset maps them to another period.
    const legacy = def.legacy && this._has(def.legacy) ? this._e[def.legacy] : null;
    if (period === 'today' && legacy && !Object.entries(map).some(([p, id]) => p !== 'today' && id === legacy)) return { id: legacy };
    if (map[period]) return { id: map[period] };
    const total = map.total;
    if (total && HFC_STAT_PERIODS[period] && ['total', 'total_increasing'].includes(this._hass.states[total]?.attributes?.state_class)) return { stat: total };
    if (def.ratio) {
      const parts = def.ratio.map((k) => [this._tileSource(k, period), HFC_TILES[k].kind]);
      if (parts.every(([s]) => s)) return { ratio: parts };
    }
    // Without a delivered-heat counter, heat = environmental energy + electricity. Keep this visibly approximate.
    if (key === 'cop_total') {
      const environmental = this._tileSource('env_energy', period); const electricity = this._tileSource('energy', period);
      if (environmental && electricity) return { envCop: [environmental, electricity] };
    }
    return null;
  }

  _tilePeriods(key) {
    const def = HFC_TILES[key];
    if (!def) return [];
    if (def.live) return this._liveAvail(key) ? ['now'] : [];
    return HFC_PERIODS.filter((p) => this._tileSource(key, p));
  }

  // Without a period: today if possible, else the current value, the total, then the longest period.
  _tileDefault(key) {
    const periods = this._tilePeriods(key);
    return ['today', 'now', 'total', 'year', 'month', 'week', 'yesterday'].find((p) => periods.includes(p));
  }

  // Base units: kWh for energy (W for period "now"), h for hours.
  _toBase(v, unit, kind, period) {
    const u = String(unit || '').toLowerCase();
    if (kind === 'energy' && period === 'now') return u === 'kw' ? v * 1000 : v;
    if (kind === 'energy') return u === 'wh' ? v / 1000 : u === 'mwh' ? v * 1000 : v;
    if (kind === 'hours') return { min: v / 60, s: v / 3600, d: v * 24 }[u] ?? v;
    return v;
  }

  _tileRead(id, kind, period) {
    const st = id && this._hass.states[id]; const v = parseFloat(st?.state);
    return Number.isFinite(v) ? this._toBase(v, st.attributes?.unit_of_measurement, kind, period) : NaN;
  }

  // Result of a recorder query, cached per instance and refreshed every 5 minutes: undefined while loading, null on error.
  _wsCached(key, msg, pick) {
    this._statCache = this._statCache || {};
    const c = this._statCache[key];
    if ((!c || (!c.req && Date.now() - c.t > 300000)) && typeof this._hass.callWS === 'function') {
      this._statCache[key] = { ...(c || {}), req: true, t: Date.now() };
      this._hass.callWS(msg)
        .then((res) => { this._statCache[key] = { v: pick(res), t: Date.now() }; })
        .catch(() => { this._statCache[key] = { v: null, t: Date.now() }; })
        .then(() => { if (this._rendered) { try { this._update(); } catch (err) { this._fail(err); } } });
    }
    return this._statCache[key]?.v;
  }

  // Change of a total counter over a calendar period from the recorder's long-term statistics.
  _statChange(id, kind, period) {
    const [calendar, offset] = HFC_STAT_PERIODS[period];
    const v = this._wsCached(`${id}|${period}`, { type: 'recorder/statistic_during_period', statistic_id: id, calendar: { period: calendar, offset }, types: ['change'] }, (res) => res?.change);
    return typeof v === 'number' ? this._toBase(v, this._hass.states[id]?.attributes?.unit_of_measurement, kind, period) : NaN;
  }

  // Price per kWh from the tile's or the card's `price`: a number or an entity; ct/kWh and per-MWh prices are converted.
  _price(spec) {
    const p = spec.price ?? this._config.price;
    if (typeof p === 'number') return { v: p };
    const st = typeof p === 'string' && this._hass.states[p];
    if (!st) return typeof p === 'string' && p.trim() !== '' && Number.isFinite(+p) ? { v: +p } : null;
    const u = String(st.attributes?.unit_of_measurement || '').toLowerCase();
    const f = (/ct|cent/.test(u) ? 0.01 : 1) * (/\/\s*mwh/.test(u) ? 0.001 : /\/\s*wh/.test(u) ? 1000 : 1);
    return { v: parseFloat(st.state) * f, f, id: p, stats: !!st.attributes?.state_class };
  }

  // Energy counter with long-term statistics for the cost of a period.
  _costStatId(period) {
    const counter = (id) => ['total', 'total_increasing'].includes(this._hass.states[id]?.attributes?.state_class);
    const src = this._tileSource('energy', period);
    if (src?.stat) return src.stat;
    if (src?.id && counter(src.id)) return src.id;
    const total = this._tileMap.energy?.total;
    return total && counter(total) ? total : null;
  }

  // Start (and end) of a calendar period in the Home Assistant time zone, and the statistics granularity used for costs.
  _periodRange(period) {
    const opts = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' };
    let fmt;
    try { fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: this._hass.config?.time_zone }); } catch (err) { fmt = new Intl.DateTimeFormat('en-US', opts); }
    const parts = (t) => Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    // Wall-clock midnight in the time zone as UTC; two passes cover daylight saving changes.
    const midnight = (y, m, d) => {
      const wall = Date.UTC(y, m, d); let t = wall;
      for (let n = 0; n < 2; n++) { const q = parts(t); t = wall - (Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute, +q.second) - t); }
      return new Date(t).toISOString();
    };
    const p = parts(Date.now()); const y = +p.year; const m = +p.month - 1; const d = +p.day;
    const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
    return {
      today: [midnight(y, m, d), null, 'hour'],
      yesterday: [midnight(y, m, d - 1), midnight(y, m, d), 'hour'],
      week: [midnight(y, m, d - weekday), null, 'hour'],
      month: [midnight(y, m, 1), null, 'hour'],
      year: [midnight(y, 0, 1), null, 'day'],
      total: [new Date(0).toISOString(), null, 'month'],
    }[period] || null;
  }

  // Electricity × mean price per hour (per day for the year, per month in total) from the long-term statistics.
  _priceBuckets(energy, price, period) {
    const range = this._periodRange(period);
    if (!range) return null;
    const [start, end, gran] = range;
    const msg = {
      type: 'recorder/statistics_during_period', start_time: start, ...(end ? { end_time: end } : {}),
      statistic_ids: [energy, price], period: gran, types: ['change', 'mean'], units: { energy: 'kWh' },
    };
    return this._wsCached(`cost|${energy}|${price}|${period}`, msg, (res) => {
      const means = new Map((res?.[price] || []).map((r) => [new Date(r.start).getTime(), r.mean]));
      let cost = 0; let kwh = 0; let last = NaN;
      (res?.[energy] || []).forEach((r) => {
        const p = means.get(new Date(r.start).getTime());
        if (Number.isFinite(p)) last = p;
        if (Number.isFinite(r.change) && Number.isFinite(last)) { cost += r.change * last; kwh += r.change; }
      });
      return means.size ? { cost, kwh, coarse: gran !== 'hour' } : null;
    });
  }

  // [cost, approximate]: a fixed price × electricity; a price entity with statistics is billed per hour, the hour
  // not yet in the statistics at the current price. Without statistics: electricity × current price (≈).
  _cost(period, spec) {
    const kwh = this._srcValue(this._tileSource('energy', period), 'energy', period);
    const price = this._price(spec);
    if (!price || !Number.isFinite(kwh)) return [NaN];
    if (!price.id) return [kwh * price.v];
    const energy = price.stats && this._costStatId(period);
    const b = energy ? this._priceBuckets(energy, price.id, period) : null;
    if (b === undefined) return [NaN];
    if (!b) return [kwh * price.v, true];
    const rest = kwh - b.kwh;
    return [b.cost * price.f + (rest > 0.0005 ? rest * price.v : 0), b.coarse];
  }

  _srcValue(src, kind, period) {
    if (!src) return NaN;
    if (src.id) return this._tileRead(src.id, kind, period);
    if (src.stat) return this._statChange(src.stat, kind, period);
    if (src.ratio) { const [a, b] = src.ratio.map(([s, k]) => this._srcValue(s, k, period)); return b > 0 && a >= 0 ? a / b : NaN; }
    if (src.envCop) {
      const environmental = this._srcValue(src.envCop[0], 'energy', period); const electricity = this._srcValue(src.envCop[1], 'energy', period);
      return electricity > 0 && environmental >= 0 ? (environmental + electricity) / electricity : NaN;
    }
    return NaN;
  }

  _tileEntity(src, period) {
    if (!src) return '';
    if (src.id || src.stat) return src.id || src.stat;
    if (src.ratio) return this._tileEntity(src.ratio[0][0], period);
    if (src.envCop) return this._tileEntity(src.envCop[0], period);
    if (src.classes) return this._tileMap.load_class1;
    if (src.share) return this._e.pv_boost;
    if (src.cost) return this._tileEntity(this._tileSource('energy', period), period);
    if (src.loss) return this._lossIds()?.temps[0] || '';
    return '';
  }

  _tileText(key, period, src, spec) {
    const def = HFC_TILES[key];
    const dec = (d) => spec.decimals ?? d;
    const out = (v, d, unit) => (Number.isFinite(v) ? `${this._fmt(v, dec(d))} ${spec.unit ?? unit}`.trim() : '–');
    if (src.classes) {
      const hrs = [1, 2, 3, 4, 5].map((n) => this._tileRead(this._tileMap[`load_class${n}`], 'hours'));
      const sum = hrs.reduce((a, h) => a + (Number.isFinite(h) ? h : 0), 0);
      return sum > 0 ? `${hrs.map((h) => this._fmt(Number.isFinite(h) ? (h / sum) * 100 : NaN, 0)).join(' · ')} %` : '–';
    }
    if (src.share) return out(this._pvShare(period), 0, '%');
    if (src.cost) {
      // Currency from the tile, the card or the Home Assistant settings.
      const [v, approx] = this._cost(period, spec);
      if (!Number.isFinite(v)) return '–';
      const currency = spec.currency || this._config.currency || this._hass.config?.currency || 'EUR';
      try {
        return `${approx ? '≈' : ''}${v.toLocaleString(this._hass.locale?.language || this._lang, { style: 'currency', currency, minimumFractionDigits: dec(2), maximumFractionDigits: dec(2) })}`;
      } catch (err) { return `${approx ? '≈' : ''}${out(v, 2, currency)}`; }
    }
    if (src.loss) { const loss = this._dhwLossNow(); return loss ? out(loss.rate, 2, 'K/h') : '–'; }
    const v = this._srcValue(src, def.kind, period);
    const approx = src.ratio || src.envCop ? '≈' : '';
    if (def.kind === 'cop') return Number.isFinite(v) ? `${approx}${this._fmt(v, dec(2))}` : '–';
    // Small amounts (standby, defrost) keep two decimals so they do not read as 0.0.
    if (def.kind === 'energy') return period === 'now' ? out(v, 0, 'W') : out(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) < 1 ? 2 : 1, 'kWh');
    if (def.kind === 'count') return out(v, 0, '');
    if (def.perStart) return !Number.isFinite(v) ? '–' : `${approx}${v < 1 ? out(v * 60, 0, 'min') : out(v, 1, 'h')}`;
    if (def.kind === 'hours') return out(v, Math.abs(v) >= 100 ? 0 : 1, 'h');
    return out(v, 1, '');
  }

  // The circuit of a circuit-spread tile (hc_spread = 1, hc2_spread = 2 …), else 0.
  static _hcSpreadCircuit(key) { const m = /^hc(\d)?_spread$/.exec(key); return m ? +(m[1] || 1) : 0; }

  // Live tiles: current values from the schematic entities.
  _liveAvail(key) {
    const h = (k) => this._has(k);
    const hc = HeatpumpFlowCard._hcSpreadCircuit(key);
    if (hc) return hc <= (this._hcCount ?? hfcHcCount(this._config)) && h(this._hk(hc, 'flow')) && h(this._hk(hc, 'return'));
    return !!{
      cop_live: h('power') && (h('heat') || (h('volume') && h('flow') && h('return'))),
      spread: h('flow') && h('return'), volume: h('volume'),
      heat_estimated: !h('heat') && h('volume') && h('flow') && h('return'),
      power: h('power'), heat_live: h('heat'), compressor_speed: h('compressor_speed'),
      source_spread: h('source_in') && h('source_out'), outdoor: h('outdoor'), dhw_top: h('dhw_top'), room: h('room'),
      brine_pressure: h('brine_pressure'), hc_pressure: h('hc_pressure'),
      pv_share: h('pv_share_today'),
    }[key];
  }

  _liveTile(key, L) {
    const f = (v, d, u) => (Number.isFinite(v) ? `${this._fmt(v, d)} ${u}`.trim() : '–');
    // Like the heat-pump spread, a circuit spread is shown only while water moves through the circuit.
    const hc = HeatpumpFlowCard._hcSpreadCircuit(key);
    if (hc) {
      const on = (L.circuits || []).find((c) => c.n === hc)?.on;
      return [on ? f(this._n(this._hk(hc, 'flow')) - this._n(this._hk(hc, 'return')), 1, 'K') : '–', this._e[this._hk(hc, 'flow')]];
    }
    switch (key) {
      case 'cop_live': return [Number.isFinite(L.cop) ? `${L.heatEstimated ? '≈' : ''}${this._fmt(L.cop, 1)}` : '–', this._e.heat || this._e.power];
      case 'spread': return [L.loop ? f(L.spread, 1, 'K') : '–', this._e.flow];
      case 'volume': return [L.flowLoop ? f(L.vol, 0, 'l/h') : '–', this._e.volume];
      case 'heat_estimated': return [L.heatEstimated ? `≈${f(L.heat, 1, 'kW')}` : '–', this._e.volume];
      case 'power': return [f(L.power, 0, 'W'), this._e.power];
      case 'heat_live': return [f(this._kw('heat'), 1, 'kW'), this._e.heat];
      case 'compressor_speed': return [this._fmtState('compressor_speed'), this._e.compressor_speed];
      case 'source_spread': return [f(this._n('source_in') - this._n('source_out'), 1, 'K'), this._e.source_in];
      case 'brine_pressure': return [this._pressureText('brine_pressure'), this._e.brine_pressure];
      case 'hc_pressure': return [this._pressureText('hc_pressure'), this._e.hc_pressure];
      case 'pv_share': return [f(this._n('pv_share_today'), 0, '%'), this._e.pv_share_today];
      default: return [this._t(this._n(key)), this._e[key]];
    }
  }

  // Tiles from the `tiles` option, in the configured order: catalog keys (with period) and free entities.
  _catalogTiles(L) {
    const i = this._i; const out = [];
    this._config.tiles.forEach((raw) => {
      const spec = HeatpumpFlowCard._tileSpec(raw);
      if (!spec) return;
      const def = HFC_TILES[spec.key];
      if (!def) {
        const st = spec.entity && this._hass.states[spec.entity];
        if (st) out.push([spec.name || st.attributes.friendly_name || spec.entity, this._fmtState(null, spec), spec.entity, spec]);
        return;
      }
      if (def.live) {
        if (!this._liveAvail(spec.key)) return;
        const [text, entity] = this._liveTile(spec.key, L);
        out.push([spec.name || this._tileLabel(spec.key, 'now'), text, entity, spec]);
        return;
      }
      // A catalog key with an own entity uses the key's label and formatting.
      const period = spec.period || (spec.entity ? 'total' : this._tileDefault(spec.key));
      const src = spec.entity ? (this._hass.states[spec.entity] ? { id: spec.entity } : null) : (period && this._tileSource(spec.key, period));
      if (!src) return;
      let text = this._tileText(spec.key, period, src, spec);
      const share = this._n('pv_share_today');
      if (spec.key === 'energy' && period === 'today' && Number.isFinite(share)) text += ` · ${this._fmt(share, 0)} % ${i.pv_share}`;
      out.push([spec.name || this._tileLabel(spec.key, spec.entity && !spec.period ? '' : period), text, this._tileEntity(src, period), spec]);
    });
    return out;
  }

  /* ---------- details drawer ---------- */
  // Rows of the drawer: [section, [[id, label, entity, value()]]]. Only existing entities (or computable values) are shown.
  _drawerRows() {
    const i = this._i; const D = i.det;
    const kwh = (key) => {
      const v = this._n(key); const u = this._unit(key);
      return u === 'wh' ? v / 1000 : u === 'mwh' ? v * 1000 : v;
    };
    // Entities that are unknown or unavailable (not reported by this model) are left out.
    const ok = (key) => this._has(key) && !['unknown', 'unavailable'].includes(this._s(key));
    const row = (key) => (ok(key) ? [key, D[key], this._e[key], () => this._fmtState(key)] : null);
    const op = ['hours', 'starts_total', 'aux_hours', 'energy_total', 'env_energy', 'heat_total'].map(row);
    if (ok('energy_total') && (ok('heat_total') || ok('env_energy'))) {
      op.push(['cop_total', D.cop_total, ok('heat_total') ? this._e.heat_total : this._e.env_energy, () => {
        const electricity = kwh('energy_total');
        const heat = ok('heat_total') ? kwh('heat_total') : kwh('env_energy') + electricity;
        const c = heat / electricity;
        return Number.isFinite(c) && c > 0 ? `≈${this._fmt(c, 2)}` : '–';
      }]);
    }
    // A sensor with a heating-only role shows '–' while the cycle runs backwards (defrost, cooling).
    const reversed = (key) => (this._heatingRoles || []).includes(key) && this._reversedCycle();
    const rf = ['compressor_speed', 'evap_temp', 'cond_temp', 'suction_temp', 'hot_gas', 'liquid_temp', 'low_pressure', 'high_pressure', 'eev'].map(row)
      .map((r) => (r && (this._heatingRoles || []).includes(r[0]) ? [...r.slice(0, 3), () => (reversed(r[0]) ? '–' : r[3]())] : r));
    // Cut-out counters are event counts, shown as plain numbers with a times sign, never with a unit of pressure or temperature.
    const cutouts = ['cutout_high_pressure', 'cutout_low_pressure', 'cutout_temperature'].filter(ok).map((key) => [key, D[key], this._e[key], () => this._countText(key)]);
    const hydraulic = [['brine_pressure', i.brine_pressure], ['hc_pressure', i.hc_pressure]].filter(([key]) => ok(key))
      .map(([key, label]) => [key, label, this._e[key], () => this._pressureText(key)]);
    // Superheat = suction gas − evaporation, subcooling = condensation − liquid line, unless the integration provides them or the
    // preset's pipe sensors do not allow it (`refrigerant_derived: false`).
    const diff = (a, b) => { const v = this._n(a) - this._n(b); return Number.isFinite(v) && !reversed(a) && !reversed(b) ? `${this._fmt(v, 1)} K` : '–'; };
    const derive = this._preset?.refrigerant_derived !== false;
    rf.push(row('superheat') || (derive && ok('suction_temp') && ok('evap_temp') ? ['superheat', D.superheat, this._e.suction_temp, () => diff('suction_temp', 'evap_temp')] : null));
    rf.push(row('subcooling') || (derive && ok('cond_temp') && ok('liquid_temp') ? ['subcooling', D.subcooling, this._e.liquid_temp, () => diff('cond_temp', 'liquid_temp')] : null));
    const more = (this._details || []).map((d, n) => (typeof d === 'string' ? { entity: d } : d)).filter((d) => d && this._hass.states[d.entity])
      .map((d, n) => [`x${n}`, d.name || this._hass.states[d.entity].attributes.friendly_name || d.entity, d.entity, () => this._fmtState(null, d)]);
    return [[i.sec_operation, op.filter(Boolean)], [i.sec_hydraulic, hydraulic], [i.sec_refrigerant, rf.filter(Boolean)], [i.sec_cutouts, cutouts], [i.sec_more, more]].filter(([, r]) => r.length);
  }

  // Event counter: a whole number followed by "×"; text states stay as they are.
  _countText(key) {
    const st = this._hass.states[this._e[key]]; if (!st) return '–';
    const v = parseFloat(st.state);
    if (!Number.isFinite(v)) return ['unknown', 'unavailable'].includes(st.state) ? '–' : this._stateText(st, st.state);
    return `${this._fmt(Math.round(v), 0)} ×`;
  }

  // Formats an entity value with its unit: integers without decimals, large values with none, others with one.
  _fmtState(key, spec) {
    const id = spec ? spec.entity : this._e[key];
    const st = this._hass.states[id]; if (!st) return '–';
    let v = parseFloat(st.state);
    if (!Number.isFinite(v)) return ['unknown', 'unavailable'].includes(st.state) ? '–' : this._stateText(st, st.state);
    let unit = spec?.unit ?? st.attributes.unit_of_measurement ?? '';
    // Energy counters in Wh (e.g. Lambda) read better in kWh.
    if (!spec?.unit && unit === 'Wh' && Math.abs(v) >= 1000) { v /= 1000; unit = 'kWh'; }
    const d = spec?.decimals ?? (Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
    return `${this._fmt(v, d)} ${unit}`.trim();
  }

  _drawerHtml() {
    const sections = this._drawerRows();
    if (!sections.length) return '';
    if (this._drawerOpen === undefined) this._drawerOpen = !!this._config.details_open;
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    return `<div class="drawer">
      <button class="drawer-toggle" id="drawer-toggle" aria-expanded="${this._drawerOpen}">${this._esc(this._i.details)}${chevron}</button>
      <div class="drawer-body" id="drawer-body" ${this._drawerOpen ? '' : 'hidden'}>${sections.map(([title, rows]) => `<div class="dsec"><div class="dsec-title">${this._esc(title)}</div>
        <div class="dgrid">${rows.map(([id, label, entity]) => `<div class="drow" data-entity="${this._esc(entity)}"><span>${this._esc(label)}</span><b id="d-${id}"></b></div>`).join('')}</div></div>`).join('')}</div>
    </div>`;
  }

  _updateDrawer() {
    if (!this._$('drawer-body')) return;
    this._drawerRows().forEach(([, rows]) => rows.forEach(([id, , , value]) => this._txt(`d-${id}`, value())));
  }

  // Series buffer in the return of the heating circuits with a 3-way valve (A: bypass from the flow, B: circuit return, AB: buffer).
  // Normally B–AB is open: the circuit return runs through the buffer. In defrost (or with the bypass valve entity on) A–AB opens
  // and the flow runs straight into the buffer, past the circuits, so the heat pump defrosts from the buffer water.
  // series_bypass: false: a series buffer without a bypass valve.
  _noBypass() { return this._config.series_bypass === false; }

  // Combined storage: the six storage sensors are heights in one tank, top to bottom, at the y of their labels.
  _combinedSensors() {
    return [['dhw_top', 112], ['dhw_middle', 166], ['dhw_bottom', 222], ['buffer_top', 392], ['buffer_middle', 446], ['buffer_bottom', 502]]
      .filter(([k]) => this._has(k));
  }

  // A fresh-water station next to separate storages needs a parallel buffer; without one the tank with its coil is drawn.
  _station() {
    return this._config.dhw_type === 'fresh_water' && this._config.storage !== 'combined'
      && (this._config.buffer === true || this._has('buffer_top') || this._has('buffer_mode'));
  }

  // Fresh-water station (dhw_type: fresh_water): a plate heat exchanger that heats the tap water from the storage; the tap side is not drawn.
  _stationArt(x, y, w, h) {
    const plates = Array.from({ length: Math.floor((w - 12) / 10) + 1 }, (_, n) => `M${x + 6 + n * 10} ${y + 8} V${y + h - 8}`).join(' ');
    return `<rect class="fws" id="fws" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><path class="fws-plates" d="${plates}"/>`;
  }

  // Without a hot-water tank: the fresh-water station stands on the parallel buffer and draws from its top. There is no diverter
  // valve; hot-water operation heats the top of the buffer (docs/TOPOLOGY.md, default D2).
  _stationSvg() {
    const e = this._e; const i = this._i;
    const de = (k) => (e[k] ? `data-entity="${this._esc(e[k])}"` : '');
    const pp = (id, d) => `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    return `${pp('fws-a', 'M612 320 V212')}${pp('fws-b', 'M592 212 V320')}
      <g class="tap" ${de(['dhw_top', 'dhw_middle', 'dhw_bottom'].find((k) => e[k]) || 'dhw_mode')}>
        <text class="tank-title" x="580" y="122" text-anchor="middle">${this._esc(i.fresh_water_station)}</text>
        ${this._stationArt(526, 132, 108, 80)}
        <text class="house-temp" id="t-dhw-top" x="580" y="182" text-anchor="middle"></text>
        <text class="small" id="t-dhw-mode" x="580" y="100" text-anchor="middle"></text>
      </g>
      ${this._parts.circ ? `<g class="tap" ${de(this._circulationKey())}><text class="small circ" id="t-circ" x="650" y="60">↻ ${this._esc(i.circulation)}</text></g>` : ''}`;
  }

  _seriesSvg() {
    const e = this._e; const i = this._i;
    const pp = (id, d) => `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    const de = (k) => (e[k] ? `data-entity="${this._esc(e[k])}"` : '');
    // Without a bypass valve the return always flows through the buffer.
    if (this._noBypass()) {
      return `${pp('byp-vl', 'M520 360 H600')}${pp('sb-vl', 'M600 360 H640')}${pp('sb-b', 'M640 495 H582')}${pp('byp-rl', 'M582 495 H520')}
      <rect class="tank" id="sb-tank" x="450" y="452" width="116" height="86" rx="20"/>
      <text class="small series-title" x="508" y="499" text-anchor="middle">${this._esc(i.series_tank)}</text>`;
    }
    // The branches leave the flow line under its end, so the round cap of the idle branch does not cover the flowing pipe.
    return `${pp('sb-a', 'M600 360 V477')}${pp('sb-vl', 'M600 360 H640')}${pp('byp-vl', 'M520 360 H600')}${pp('sb-b', 'M640 495 H618')}${pp('byp-rl', 'M582 495 H520')}
      <g class="tap" ${de(e.bypass_valve ? 'bypass_valve' : 'defrost')}>
        <rect class="tank" id="sb-tank" x="450" y="452" width="116" height="86" rx="20"/>
        <text class="small series-title" x="508" y="499" text-anchor="middle">${this._esc(i.series_tank)}</text>
        <circle class="valve" cx="600" cy="495" r="18"/>
        <path class="valve-arrow" id="sb-arrow" d="M614 495 H586 M593 488 L586 495 L593 502"/>
        <text class="small" id="t-bypass" x="600" y="534" text-anchor="middle"></text>
      </g>`;
  }

  // One circuit keeps the established large room display. With several circuits, the house becomes a compact overview: one
  // independently tappable row per circuit, with its configured name, actual/target temperatures and comfort dot (#140).
  _houseSvg() {
    const i = this._i; const e = this._e;
    const de = (key) => (e[key] ? `data-entity="${this._esc(e[key])}"` : '');
    if (this._hcCount === 1) {
      const entityKey = ['room', 'room_target', 'room_humidity'].find((key) => e[key]);
      return `<g class="tap" ${de(entityKey)}>
        <path class="house" d="M720 130 L830 50 L940 130 V240 H720 Z"/>
        <text class="tank-title" x="830" y="118" text-anchor="middle">${this._esc(i.house)}</text>
        <text class="house-temp" id="t-room" x="830" y="172" text-anchor="middle"></text>
        <text class="house-sub" id="t-room-target" x="830" y="202" text-anchor="middle"></text>
        ${this._sourceType === 'air' ? '' : '<text class="small" id="t-outdoor" x="830" y="226" text-anchor="middle"></text>'}
      </g>`;
    }
    // narrow_focus with up to three circuits: each row takes two lines on a narrow schematic, the name above a larger value.
    const twoLines = this._narrowFocus() && this._hcCount <= 3 ? ' nf-two' : '';
    const rows = Array.from({ length: this._hcCount }, (_, x) => {
      const n = x + 1; const s = n === 1 ? '' : String(n); const key = this._roomKey(n);
      const target = this._roomKey(n, 'room_target'); const humidity = this._roomKey(n, 'room_humidity');
      const entityKey = [key, target, humidity].find((candidate) => e[candidate]);
      const name = this._config[n === 1 ? 'hc_name' : `hc${n}_name`] || `${i.heating_circuit} ${n}`;
      const y = 118 + x * 21.5;
      return `<g class="tap house-row${twoLines}" id="house-row${s}" ${de(entityKey)} data-name="${this._esc(name)}">
        <circle class="house-comfort unknown" id="house-comfort${s}" cx="734" cy="${y - 4}" r="5"/>
        <text class="house-row-name" x="746" y="${y}">${this._esc(name)}</text>
        <text class="house-row-value" id="t-house-room${s}" x="950" y="${y}" text-anchor="end"></text>
      </g>`;
    }).join('');
    return `<path class="house" d="M720 110 L842.5 25 L965 110 V262 H720 Z"/>
      <text class="tank-title" x="842.5" y="91" text-anchor="middle">${this._esc(i.house)}</text>
      ${rows}
      ${this._sourceType === 'air' ? '' : `<g class="tap" ${de('outdoor')}><text class="small" id="t-outdoor" x="842.5" y="252" text-anchor="middle"></text></g>`}`;
  }

  // Heating circuit n (1-6). Circuits 2 to 6 sit below circuit 1, fed by risers from its flow and return.
  // Risers from the trunk down to circuits 2 to 6, one segment per step: segment n runs from circuit n − 1 to circuit n and feeds
  // circuit n and every circuit below it. One full-length riser per circuit lay over the shorter ones, so a stopped lower circuit
  // hid a running upper one (#302). The hop lets circuit 1's return pass under the risers.
  _risersSvg() {
    const pp = (id, d) => `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    const segs = Array.from({ length: this._hcCount - 1 }, (_, x) => {
      const n = x + 2; const top = (n - 2) * 250; const bottom = (n - 1) * 250;
      return pp(`hc-up${n}`, `M660 ${360 + top} V${360 + bottom}`) + pp(`hc-down${n}`, `M676 ${495 + bottom} V${495 + top}`);
    });
    return `<path class="hop" d="M660 483 V507"/>${segs.join('')}`;
  }

  _circuitSvg(n) {
    const i = this._i; const e = this._e;
    const s = n === 1 ? '' : String(n);
    const dy = (n - 1) * 250;
    const k = (key) => this._hk(n, key);
    const entity = (key) => e[key] || (n === 1 && !this._parts.buffer && key === k('flow') ? e.flow : '');
    const de = (key) => (entity(key) ? `data-entity="${this._esc(entity(key))}"` : '');
    const name = this._config[n === 1 ? 'hc_name' : `hc${n}_name`];
    const title = this._esc(name || (this._hcCount > 1 ? `${i.heating_circuit} ${n}` : i.heating_circuit));
    const em = this._emitter(this._hcTypes[n - 1], title);
    let { vl, rl } = em;
    if (n > 1) { vl = vl.replace('M640 ', 'M660 '); rl = rl.replace(/H640$/, 'H676'); }
    const pp = (id, d) => `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    const gy = this._hcTypes[n - 1] === 'underfloor' ? [360, 480] : [365, 455];
    return `<g transform="translate(0 ${dy})">
      <defs><linearGradient id="g-rad${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" id="g-rad${s}-top"/><stop offset="100%" id="g-rad${s}-bottom"/></linearGradient>
      <linearGradient id="g-hcb${s}" gradientUnits="userSpaceOnUse" x1="0" y1="${gy[0]}" x2="0" y2="${gy[1]}"><stop offset="0" id="g-hcb${s}-a"/><stop offset="0.5" id="g-hcb${s}-m"/><stop offset="1" id="g-hcb${s}-b"/></linearGradient></defs>
      ${em.art.split('__S__').join(s)}${pp(`hc-vl${s}`, vl)}${pp(`hc-body${s}`, em.body)}${pp(`hc-rl${s}`, rl)}
      ${this._mixerSvg(n)}
      ${e[k('curve_offset')]
    // With a heating curve shift the target and its parts stand above the pump, ending at the pump; the flow temperature goes below it.
    // Next to a buffer or combined storage (x 520–640) there is no room to the left: the label starts right of the tank in two lines.
    ? `<g class="tap" ${de(k('curve_offset'))}>${this._parts.buffer
      ? `<text class="pipe-label" id="t-hc${s}" x="648" y="316" text-anchor="start" data-lines="2"></text>`
      : `<text class="pipe-label" id="t-hc${s}" x="736" y="334" text-anchor="end"></text>`}</g>
      <g class="tap" ${de(k('flow'))}><text class="pipe-label" id="t-hc-now${s}" x="720" y="396" text-anchor="middle"></text></g>`
    : `<g class="tap" ${de(k('flow'))}><text class="pipe-label" id="t-hc${s}" x="740" y="334" text-anchor="middle"></text></g>`}
      <g class="tap" ${de(k('volume'))}><text class="vol-label" id="t-hc-vol${s}" x="720" y="${e[k('curve_offset')] ? 414 : 394}" text-anchor="middle"></text></g>
      ${this._config.hc_return_label ? `<g class="tap" ${de(k('return'))}><text class="vol-label" id="t-hc-rl${s}" x="690" y="515" text-anchor="start"></text></g>` : ''}
      ${n === 1 && e.hc_pressure
    // Starts right of the storage column (and right of the risers of further circuits), so a long text such as
    // "Heizungsdruck 1,8 bar" is not covered by the buffer (#129); low enough to pass between the pipes of the emitter.
    ? `<g class="tap pressure" id="pressure-hc" ${de('hc_pressure')}><text class="pressure-label" id="t-hc-pressure" x="${this._hcCount > 1 ? 684 : 650}" y="458" text-anchor="start"></text></g>` : ''}
      <g class="tap" ${de(e[k('pump')] ? k('pump') : k('mode'))}>
        ${this._circuitPump(n) ? `<circle class="pump" cx="720" cy="360" r="16"/>
        <g class="impeller" id="impeller${s}"><path d="M720 348 L726 360 L714 360Z M720 372 L714 360 L726 360Z" class="imp"/></g>` : ''}
        ${em.title}
        <text class="small" id="t-hc-mode${s}" x="880" y="524" text-anchor="middle"></text>
      </g>
    </g>`;
  }

  // The heat pump has its own primary pump (`primary_pump`, default from the preset). It is drawn on the flow pipe next to the
  // heat pump block, centred between the flow temperature and the flow rate. A single direct circuit without its own pump sensor then has no pump of its own.
  _primaryPump() { return this._config.primary_pump ?? !!this._preset?.primary_pump; }
  // narrow_focus (#4): below 500 px the key values grow and the secondary ones move to one line under the schematic. Only CSS
  // inside the narrow container query uses it, so wider schematics look the same with and without the option.
  _narrowFocus() { return this._config[HFC_NARROW_FOCUS] === true; }
  // Three-way mixer of circuit n (#214): drawn as soon as one of its keys is mapped. Most controllers drive a three-point motor
  // without position feedback, so opening and closing are motor pulses and hc_mixer is shown as reported, not read as a position.
  _hasMixer(n) { return ['mixer', 'mixer_opening', 'mixer_closing'].some((key) => this._has(this._hk(n, key))); }
  _mixerSvg(n) {
    if (!this._hasMixer(n)) return '';
    const s = n === 1 ? '' : String(n);
    const k = (key) => this._hk(n, key);
    const key = ['mixer', 'mixer_opening', 'mixer_closing'].map(k).find((x) => this._has(x));
    // Bypass from the circuit return up into the bottom port of the valve, which sits on the flow between pump and emitter.
    return `<path class="pipe mix-bypass" id="p-hc-mix${s}" d="M760 495 V374"/>
      <g class="tap mixer" id="mixer${s}" data-entity="${this._esc(this._e[key])}">
        <path class="valve mix-body" d="M748 352 L760 360 L748 368 Z M772 352 L760 360 L772 368 Z M752 374 L760 360 L768 374 Z"/>
        <text class="mix-label" id="t-hc-mix${s}" x="752" y="432" text-anchor="end"></text>
        <path class="mix-dir" id="hc-mix-dir${s}" d=""/>
      </g>`;
  }

  _updateMixer(n, on, cRet) {
    const s = n === 1 ? '' : String(n);
    const k = (key) => this._hk(n, key);
    const bypass = this._$(`p-hc-mix${s}`);
    if (bypass) { bypass.style.setProperty('--pc', cRet); bypass.classList.toggle('on', !!on); }
    const value = this._has(k('mixer')) ? this._n(k('mixer')) : NaN;
    const text = this._has(k('mixer')) ? (Number.isFinite(value) ? `${this._fmt(value, 0)} %` : '–') : '';
    this._txt(`t-hc-mix${s}`, text);
    // The opening key may also carry a signed movement (ebusd: −100 … +100 %, above 0 opening, below 0 closing); a mapped
    // closing key still decides for closing.
    const move = this._has(k('mixer_opening')) ? parseFloat(this._s(k('mixer_opening'))) : NaN;
    const opening = this._has(k('mixer_opening')) && (Number.isFinite(move) ? move > 0 : this._on(k('mixer_opening')));
    const closing = !opening && (this._has(k('mixer_closing')) ? this._on(k('mixer_closing')) : Number.isFinite(move) && move < 0);
    // The arrow stands right of the bypass: up while the motor opens, down while it closes, nothing at rest.
    const dir = this._$(`hc-mix-dir${s}`);
    if (dir) {
      dir.setAttribute('d', opening ? 'M771 434 V420 M765 426 L771 420 L777 426' : closing ? 'M771 420 V434 M765 428 L771 434 L777 428' : '');
      dir.classList.toggle('on', opening || closing);
    }
    const group = this._$(`mixer${s}`);
    if (group) {
      const i = this._i;
      group.dataset.a11y = [i.mixer, text, opening ? i.mixer_opening : closing ? i.mixer_closing : ''].filter(Boolean).join(', ');
    }
  }

  _circuitPump(n) { return !(n === 1 && this._hcCount === 1 && this._primaryPump() && !this._parts.buffer && !this._e.hc_pump); }

  // Drawing of the outdoor unit inside the heat pump block (air source only; brine and water keep the loop symbol).
  // Manufacturer-inspired, logo-free outdoor units. `auto` takes the style of the preset.
  _unitKey() {
    if (this._sourceType !== 'air') return 'generic';
    const style = this._config.unit_style && this._config.unit_style !== 'auto' ? this._config.unit_style : (this._preset?.unit_style || 'generic');
    if (style === 'vaillant') return `vaillant-${this._config.unit_size || 'medium'}`;
    // Panasonic: one fan, or two for the large units; without unit_size the preset may tell the size from the model (#176).
    if (style === 'panasonic') {
      const size = this._config.unit_size || this._preset?.unit_size?.(this._e || {}, this._hass);
      return size === 'large' ? 'panasonic-large' : 'panasonic';
    }
    return style;
  }

  // One blade, scaled to a fan of radius r at (cx, cy); the group spins around its own centre.
  _fanSvg(id, cx, cy, r, cls = '') {
    const k = r / 50;
    const p = (x, y) => `${(cx + x * k).toFixed(1)} ${(cy + y * k).toFixed(1)}`;
    const blade = `M${p(0, 0)} C${p(-10, -26)} ${p(-2, -42)} ${p(12, -44)} C${p(16, -26)} ${p(10, -10)} ${p(0, 0)}Z`;
    return `<g class="fan ${cls}" id="${id}" style="transform-origin:${cx}px ${cy}px">${[0, 120, 240].map((a) => `<path class="blade" d="${blade}" transform="rotate(${a} ${cx} ${cy})"/>`).join('')}<circle cx="${cx}" cy="${cy}" r="${(7 * k).toFixed(1)}" class="hub"/></g>`;
  }

  _snowSvg(id, cx, cy, r) {
    const arms = '<path d="M0-13V13M-4-11 0-7 4-11M-4 11 0 7 4 11"/>';
    return `<g class="snow" id="${id}" transform="translate(${cx} ${cy}) scale(${(r / 18).toFixed(2)})"><circle class="snow-bg" r="18"/><g class="snow-flake">${arms}<g transform="rotate(60)">${arms}</g><g transform="rotate(120)">${arms}</g></g></g>`;
  }

  // { below, fans: [[cx, cy, r, class]], above, snows: [[cx, cy, r]] } in card coordinates. Parts are drawn relative to the block (50, 190).
  _unitArt() {
    const key = this._unitKey();
    const T = (s) => (s ? `<g transform="translate(50 190)">${s}</g>` : '');
    const abs = (x, y) => [x + 50, y + 190];
    if (key === 'lambda') {
      const bars = [45, 53, 61, 69, 77, 85, 93, 101].map((y) => `<path class="lam-cut" d="M99 ${y} H141"/>`).join('');
      return {
        below: T('<rect class="lam-plinth" x="83" y="150" width="74" height="5" rx="1"/><rect class="lam-body" x="88" y="36" width="64" height="114" rx="3"/><rect class="lam-edge" x="88" y="36" width="8" height="114" rx="2"/><rect class="lam-edge" x="144" y="36" width="8" height="114" rx="2"/><rect class="lam-open" x="99" y="40" width="42" height="66" rx="2"/>'),
        fans: [[...abs(120, 73), 19, 'lam-fan']],
        above: T(`${bars}<path class="lam-cut curve" d="M108 106 C105 84 111 60 120 41"/><path class="lam-cut curve" d="M132 106 C135 84 129 60 120 41"/><path class="lam-cut vein" d="M120 106 V66"/><path class="lam-hi" d="M88 106 H152"/><path class="lam-hi" d="M96 38 V148 M144 38 V148"/><rect class="lam-slot" x="128" y="132" width="3.5" height="13" rx="1.7"/><rect class="lam-rim" x="88" y="36" width="64" height="114" rx="3"/>`),
        snows: [[...abs(120, 73), 17]],
      };
    }
    if (key.startsWith('vaillant')) {
      // Sizes from the data sheets (width 1100 mm): 765 mm (3.5 / 5.5 kW), 965 mm (7.5 kW), about 1480 mm with two fans (10.5 / 12.5 kW).
      const size = { 'vaillant-small': [60, 68, 120, 82, 1], 'vaillant-large': [77, 34, 86, 116, 2] }[key] || [60, 45, 120, 105, 1];
      const [x, y, w, h, n] = size;
      const pw = Math.round(w * 0.6);
      const grilles = n === 1
        ? [[x + 4 + pw / 2, y + h / 2, Math.min(pw / 2 - 4, h / 2 - 8)]]
        : [0, 1].map((m) => [x + 4 + pw / 2, y + 4 + (h - 8) * (0.25 + 0.5 * m), Math.min(pw / 2 - 3, (h - 8) / 4 - 2)]);
      const ring = ([cx, cy, r]) => `<circle class="vai-gr" cx="${cx}" cy="${cy}" r="${r}"/><circle class="vai-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.76).toFixed(1)}"/><circle class="vai-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.52).toFixed(1)}"/>${Array.from({ length: 12 }, (_, m) => { const a = (m * Math.PI) / 6; return `<line class="vai-gr thin" x1="${(cx + Math.cos(a) * 7).toFixed(1)}" y1="${(cy + Math.sin(a) * 7).toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}"/>`; }).join('')}`;
      return {
        below: T(`<rect class="vai-foot" x="${x + 10}" y="${y + h}" width="14" height="6" rx="2"/><rect class="vai-foot" x="${x + w - 24}" y="${y + h}" width="14" height="6" rx="2"/><rect class="vai-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(14, w / 8)}"/><rect class="vai-dark" x="${x + 4}" y="${y + 4}" width="${pw}" height="${h - 8}" rx="9"/>${grilles.map(ring).join('')}`),
        fans: grilles.map(([cx, cy, r]) => [...abs(cx, cy), +(r * 0.86).toFixed(1), 'vai-fan']),
        above: T(`<path class="vai-seam" d="M${x + pw + 8} ${y + 6} V${y + h - 6}"/>`),
        snows: grilles.map(([cx, cy, r]) => [...abs(cx, cy), +Math.min(19, r * 0.58).toFixed(1)]),
      };
    }
    if (key.startsWith('panasonic')) {
      const ring = (cx, cy, r) => `<circle class="pana-gr" cx="${cx}" cy="${cy}" r="${r}"/><circle class="pana-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.78).toFixed(1)}"/><circle class="pana-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.54).toFixed(1)}"/>${Array.from({ length: 16 }, (_, m) => { const a = (m * Math.PI) / 8; return `<line class="pana-gr thin" x1="${(cx + Math.cos(a) * 7).toFixed(1)}" y1="${(cy + Math.sin(a) * 7).toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}"/>`; }).join('')}`;
      if (key === 'panasonic-large') {
        // T-CAP and the larger units (bi-bloc 1340 x 900 mm, monobloc 1410 mm high): a tall pale casing with two fans one above
        // the other on the left and the service panel on the right (#176).
        const x = 66; const y = 32; const w = 112; const h = 118;
        const grilles = [[107, y + 32, 25], [107, y + 86, 25]];
        return {
          below: T(`<rect class="pana-foot" x="${x + 10}" y="${y + h}" width="15" height="6" rx="1.5"/><rect class="pana-foot" x="${x + w - 25}" y="${y + h}" width="15" height="6" rx="1.5"/><rect class="pana-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><path class="pana-top" d="M${x + 3} ${y + 5} H${x + w - 3}"/>${grilles.map(([cx, cy, r]) => ring(cx, cy, r)).join('')}`),
          fans: grilles.map(([cx, cy, r]) => [...abs(cx, cy), +(r * 0.82).toFixed(1), 'pana-fan']),
          above: T(`<path class="pana-seam" d="M146 ${y + 8} V${y + h - 7}"/><path class="pana-vents" d="M152 ${y + 44}h18M152 ${y + 50}h18M152 ${y + 56}h18M152 ${y + 62}h18M152 ${y + 68}h18M152 ${y + 74}h18"/><rect class="pana-panel" x="154" y="${y + h - 22}" width="15" height="12" rx="1.5"/>`),
          snows: grilles.map(([cx, cy]) => [...abs(cx, cy), 15]),
        };
      }
      // Aquarea H/J/K outdoor units: a pale rectangular casing, large left-hand grille and a narrow service panel.
      // This is an original simplified drawing without branding; proportions follow the common single-fan 824/875 mm units.
      const x = 58; const y = 48; const w = 124; const h = 96;
      const cx = 102; const cy = 95; const r = 37;
      const grille = ring(cx, cy, r);
      return {
        below: T(`<rect class="pana-foot" x="${x + 10}" y="${y + h}" width="15" height="6" rx="1.5"/><rect class="pana-foot" x="${x + w - 25}" y="${y + h}" width="15" height="6" rx="1.5"/><rect class="pana-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><path class="pana-top" d="M${x + 3} ${y + 7} H${x + w - 3}"/>${grille}`),
        fans: [[...abs(cx, cy), +(r * 0.82).toFixed(1), 'pana-fan']],
        above: T(`<path class="pana-seam" d="M148 ${y + 8} V${y + h - 7}"/><path class="pana-vents" d="M156 76h17M156 82h17M156 88h17M156 94h17M156 100h17M156 106h17M156 112h17"/><rect class="pana-panel" x="157" y="119" width="15" height="12" rx="1.5"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'viessmann') {
      // Vitocal 250-A: tall graphite body with a softly rounded, full-height horizontal-louvre front.
      const x = 78; const y = 28; const w = 84; const h = 124; const cx = 120; const cy = 88; const r = 32;
      const slats = Array.from({ length: 17 }, (_, n) => `<path class="vies-slat" d="M${x + 9} ${y + 12 + n * 6} H${x + w - 9}"/>`).join('');
      return {
        below: T(`<rect class="vies-foot" x="${x + 9}" y="${y + h}" width="14" height="5" rx="1.5"/><rect class="vies-foot" x="${x + w - 23}" y="${y + h}" width="14" height="5" rx="1.5"/><rect class="vies-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/><circle class="vies-well" cx="${cx}" cy="${cy}" r="${r + 3}"/>`),
        fans: [[...abs(cx, cy), r, 'vies-fan']],
        above: T(`<g>${slats}</g><rect class="vies-rim" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'bosch') {
      // Compress 5800i/6800i AW: broad pale casing, rounded corners and one centred circular intake.
      const x = 52; const y = 50; const w = 136; const h = 94; const cx = 120; const cy = 96; const r = 37;
      const spokes = Array.from({ length: 16 }, (_, n) => { const a = (n * Math.PI) / 8; return `<line class="bosch-gr thin" x1="${(cx + Math.cos(a) * 8).toFixed(1)}" y1="${(cy + Math.sin(a) * 8).toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}"/>`; }).join('');
      return {
        below: T(`<rect class="bosch-foot" x="${x + 13}" y="${y + h}" width="15" height="6" rx="2"/><rect class="bosch-foot" x="${x + w - 28}" y="${y + h}" width="15" height="6" rx="2"/><rect class="bosch-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="13"/><circle class="bosch-gr" cx="${cx}" cy="${cy}" r="${r}"/><circle class="bosch-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.74).toFixed(1)}"/>${spokes}`),
        fans: [[...abs(cx, cy), +(r * 0.83).toFixed(1), 'bosch-fan']],
        above: T(`<path class="bosch-top" d="M${x + 13} ${y + 9} H${x + w - 13}"/><rect class="bosch-mark" x="${x + w - 19}" y="${y + 13}" width="5" height="18" rx="2.5"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'saunier') {
      // GeniaAir Mono: white horizontal casing, black fan grille with the characteristic red accent ring.
      const x = 56; const y = 56; const w = 128; const h = 88; const cx = 101; const cy = 99; const r = 35;
      const spokes = Array.from({ length: 14 }, (_, n) => { const a = (n * Math.PI) / 7; return `<line class="sd-gr thin" x1="${(cx + Math.cos(a) * 7).toFixed(1)}" y1="${(cy + Math.sin(a) * 7).toFixed(1)}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}"/>`; }).join('');
      return {
        below: T(`<rect class="sd-foot" x="${x + 10}" y="${y + h}" width="15" height="6" rx="2"/><rect class="sd-foot" x="${x + w - 25}" y="${y + h}" width="15" height="6" rx="2"/><rect class="sd-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/><circle class="sd-accent" cx="${cx}" cy="${cy}" r="${r + 2}"/><circle class="sd-gr" cx="${cx}" cy="${cy}" r="${r}"/><circle class="sd-gr thin" cx="${cx}" cy="${cy}" r="${(r * 0.7).toFixed(1)}"/>${spokes}`),
        fans: [[...abs(cx, cy), +(r * 0.82).toFixed(1), 'sd-fan']],
        above: T(`<path class="sd-seam" d="M148 ${y + 8} V${y + h - 8}"/><path class="sd-vents" d="M157 83h17M157 90h17M157 97h17M157 104h17M157 111h17"/><rect class="sd-badge" x="160" y="120" width="10" height="4" rx="2"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'samsung') {
      // EHS Mono HT Quiet: dark-grey monolith with a horizontal black grille hiding the fan.
      const x = 57; const y = 46; const w = 126; const h = 102; const cx = 103; const cy = 97; const r = 34;
      const slats = Array.from({ length: 13 }, (_, n) => `<path class="sam-slat" d="M${x + 8} ${y + 14 + n * 6} H${x + 88}"/>`).join('');
      return {
        below: T(`<rect class="sam-foot" x="${x + 10}" y="${y + h}" width="15" height="6" rx="2"/><rect class="sam-foot" x="${x + w - 25}" y="${y + h}" width="15" height="6" rx="2"/><rect class="sam-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/><rect class="sam-grille" x="${x + 5}" y="${y + 7}" width="88" height="${h - 14}" rx="3"/>`),
        fans: [[...abs(cx, cy), r, 'sam-fan']],
        above: T(`<g>${slats}</g><path class="sam-seam" d="M${x + 96} ${y + 8} V${y + h - 8}"/><circle class="sam-dot" cx="${x + 110}" cy="${y + 17}" r="2"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'wolf') {
      // CHA monoblock (1286 x 979 mm, the 16/20 1700 x 1300 mm): graphite body under a darker overhanging lid, a recessed front panel
      // with the large round fan opening on the left, a lighter service side on the right and two foot rails.
      // 122 wide (not 128): the lid overhangs, and the heater symbol starts at x 180.
      const x = 54; const y = 52; const w = 122; const h = 94; const cx = 100; const cy = 100; const r = 34;
      return {
        below: T(`<rect class="wolf-foot" x="${x + 9}" y="${y + h}" width="18" height="6" rx="1.5"/><rect class="wolf-foot" x="${x + w - 27}" y="${y + h}" width="18" height="6" rx="1.5"/><rect class="wolf-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><rect class="wolf-panel" x="${x + 7}" y="${y + 9}" width="78" height="${h - 14}" rx="2"/><circle class="wolf-hole" cx="${cx}" cy="${cy}" r="${r}"/>`),
        fans: [[...abs(cx, cy), +(r * 0.86).toFixed(1), 'wolf-fan']],
        above: T(`<circle class="wolf-ring" cx="${cx}" cy="${cy}" r="${r}"/><path class="wolf-seam" d="M${x + 89} ${y + 8} V${y + h - 4} M${x + w - 9} ${y + 12} V${y + h - 8}"/><rect class="wolf-rim" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/><rect class="wolf-lid" x="${x + 12}" y="${y - 9}" width="60" height="5" rx="2"/><rect class="wolf-lid" x="${x - 3}" y="${y - 6}" width="${w + 6}" height="9" rx="3"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'kronoterm') {
      // ADAPT / ADAPT 2: an almost square dark box, the whole front covered by horizontal louvres that hide the fan,
      // a closed side panel on the left and a plinth band below the louvres.
      const x = 62; const y = 40; const w = 114; const h = 112; const cx = 123; const cy = 89; const r = 34;
      const slats = Array.from({ length: 15 }, (_, n) => `<path class="kro-slat" d="M${x + 15} ${y + 9 + n * 6} H${x + w - 6}"/>`).join('');
      return {
        below: T(`<rect class="kro-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/><rect class="kro-side" x="${x + 2}" y="${y + 2}" width="9" height="${h - 4}" rx="1"/><rect class="kro-grille" x="${x + 13}" y="${y + 5}" width="${w - 17}" height="${h - 21}" rx="1"/>`),
        fans: [[...abs(cx, cy), r, 'kro-fan']],
        above: T(`<g>${slats}</g><rect class="kro-plinth" x="${x + 13}" y="${y + h - 14}" width="${w - 17}" height="11" rx="1"/><rect class="kro-plate" x="${x + 17}" y="${y + 2}" width="12" height="2.5" rx="1"/><rect class="kro-rim" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'alpha_innotec') {
      // Hybrox (Luxtronik 2.1, 1320 x 930 mm): a narrow silver panel on the left, a large black front with the open round fan,
      // a red line along its lower edge, a column of short slots at the top right and a dark base.
      const x = 54; const y = 56; const w = 124; const h = 86; const fx = x + 24; const fw = w - 27;
      const cx = fx + fw / 2; const cy = y + 40; const r = 33;
      const slots = Array.from({ length: 5 }, (_, n) => `<path class="ait-slot" d="M${x + w - 10} ${y + 9 + n * 4} H${x + w - 6}"/>`).join('');
      return {
        below: T(`<rect class="ait-base" x="${x + 2}" y="${y + h}" width="${w - 4}" height="6" rx="1"/><rect class="ait-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/><rect class="ait-front" x="${fx}" y="${y + 3}" width="${fw}" height="${h - 9}" rx="1.5"/><circle class="ait-hole" cx="${cx}" cy="${cy}" r="${r + 1}"/>`),
        fans: [[...abs(cx, cy), +(r * 0.86).toFixed(1), 'ait-fan']],
        above: T(`<circle class="ait-ring" cx="${cx}" cy="${cy}" r="${r}"/>${slots}<path class="ait-red" d="M${fx + 2} ${y + h - 8} H${fx + fw - 2}"/><rect class="ait-plate" x="${x + 5}" y="${y + 6}" width="12" height="3" rx="1"/><rect class="ait-rim" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    if (key === 'stiebel') {
      // WPL-A: a dark box with a slightly arched lid, a plain panel on the left, fine horizontal louvres over the fan on the right
      // two thirds, and a recessed base on short feet.
      const x = 54; const y = 52; const w = 124; const h = 88; const gx = x + 42; const gw = w - 45;
      const cx = gx + gw / 2; const cy = y + 46; const r = 33;
      const body = `M${x} ${y + h} V${y + 5} Q${x} ${y + 2} ${x + 3} ${y + 2} Q${x + w / 2} ${y - 3} ${x + w - 3} ${y + 2} Q${x + w} ${y + 2} ${x + w} ${y + 5} V${y + h} Z`;
      const slats = Array.from({ length: 20 }, (_, n) => `<path class="stb-slat" d="M${gx + 1} ${y + 7 + n * 4} H${gx + gw - 1}"/>`).join('');
      return {
        below: T(`<rect class="stb-foot" x="${x + 7}" y="${y + h}" width="9" height="7" rx="1"/><rect class="stb-foot" x="${x + w - 16}" y="${y + h}" width="9" height="7" rx="1"/><rect class="stb-base" x="${x + 5}" y="${y + h}" width="${w - 10}" height="4"/><path class="stb-body" d="${body}"/><rect class="stb-grille" x="${gx}" y="${y + 4}" width="${gw}" height="${h - 6}" rx="1"/>`),
        fans: [[...abs(cx, cy), r, 'stb-fan']],
        above: T(`<g>${slats}</g><path class="stb-seam" d="M${gx - 1} ${y + 3} V${y + h}"/><rect class="stb-plate" x="${x + 10}" y="${y + 13}" width="20" height="3" rx="0.5"/><path class="stb-rim" d="${body}"/>`),
        snows: [[...abs(cx, cy), 18]],
      };
    }
    return { below: '<circle class="fan-ring" cx="170" cy="288" r="50"/>', fans: [[170, 288, 50, '']], above: '', snows: [[170, 288, 18]] };
  }

  /* ---------- keyboard and screen readers ---------- */
  // Clickable parts become buttons. The schematic, the tiles and the details are one tab stop each (arrow keys, Home and End move
  // inside); the header chips are tab stops of their own. Elements that are not shown (empty labels, hidden by the narrow layout) are skipped.
  _a11y(force) {
    const now = Date.now();
    if (!force && now - (this._a11yAt || 0) < 2000) return;
    this._a11yAt = now;
    const root = this.shadowRoot;
    if (!root) return;
    const shown = (el) => {
      if (el instanceof SVGGraphicsElement) { try { return el.getBBox().width > 0 && getComputedStyle(el).display !== 'none'; } catch (err) { return false; } }
      return el.getClientRects().length > 0;
    };
    const label = (el) => {
      if (el.dataset.a11y) return el.dataset.a11y;
      const st = this._hass?.states[el.dataset.entity];
      if (!st) return '';
      const attr = hfcTempAttr(el.dataset.entity);
      if (attr) return `${st.attributes?.friendly_name || el.dataset.entity}: ${this._t(parseFloat(st.attributes?.[attr]))}`;
      const u = st.attributes?.unit_of_measurement;
      return `${st.attributes?.friendly_name || el.dataset.entity}: ${st.state}${u ? ` ${u}` : ''}`;
    };
    [['#svg [data-entity]', 'svg', true], ['#stats .stat', 'stats', false], ['#drawer-body .drow', 'drawer', false]].forEach(([sel, name, labelled]) => {
      const all = [...root.querySelectorAll(sel)];
      const items = all.filter(shown);
      const keep = Math.min(this._focusMem?.[name] ?? 0, items.length - 1);
      items.forEach((el, n) => {
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
        const t = n === keep ? '0' : '-1';
        if (el.getAttribute('tabindex') !== t) el.setAttribute('tabindex', t);
        if (labelled) { const l = label(el); if (l && el.getAttribute('aria-label') !== l) el.setAttribute('aria-label', l); }
      });
      all.forEach((el) => { if (!items.includes(el) && el.hasAttribute('tabindex')) el.removeAttribute('tabindex'); });
    });
    root.querySelectorAll('.head [data-entity], .head [data-badge]').forEach((el) => {
      if (shown(el)) { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); } else el.removeAttribute('tabindex');
    });
  }

  // Arrow keys, Home and End move the focus between the items of a group; the focused item is the group's tab stop.
  _rove(box, selector, name) {
    if (!box) return;
    this._focusMem = this._focusMem || {};
    const items = () => [...box.querySelectorAll(selector)].filter((el) => el.getAttribute('tabindex') !== null);
    box.addEventListener('focusin', (ev) => {
      const list = items(); const n = list.indexOf(ev.target);
      if (n < 0) return;
      this._focusMem[name] = n;
      list.forEach((el, m) => el.setAttribute('tabindex', m === n ? '0' : '-1'));
      if (name === 'svg') this._showRing(ev.target);
    });
    box.addEventListener('focusout', () => { if (name === 'svg') this._hideRing(); });
    box.addEventListener('keydown', (ev) => {
      const list = items(); const n = list.indexOf(ev.target);
      if (n < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      let to = null;
      if (step) to = (n + step + list.length) % list.length;
      else if (ev.key === 'Home') to = 0;
      else if (ev.key === 'End') to = list.length - 1;
      if (to === null) return;
      ev.preventDefault();
      list[to].focus();
      if (name === 'svg') this._showRing(list[to], true);
    });
  }

  // Focus frame inside the schematic (outlines on SVG groups are not drawn everywhere): a rectangle around the focused group.
  _showRing(el, force) {
    if (!(el instanceof SVGGraphicsElement)) return;
    if (!force && !el.matches(':focus-visible')) return;
    this._hideRing();
    let b;
    try { b = el.getBBox(); } catch (err) { return; }
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', 'focus-ring');
    [['x', b.x - 5], ['y', b.y - 5], ['width', b.width + 10], ['height', b.height + 10], ['rx', 8]].forEach(([k, v]) => r.setAttribute(k, v));
    el.appendChild(r);
    this._ring = r;
  }
  _hideRing() { if (this._ring) { this._ring.remove(); this._ring = null; } }

  /* ---------- standby loss of the hot-water tank ---------- */
  // The configured measurement sensor (otherwise the uppermost tank sensor) is fitted; every real tank sensor detects draw-off.
  // What tells charging from standby:
  // the operating mode or the compressor with the valve, plus the DHW heater rod and the solar pump. Without a running
  // signal no standby window can be verified, so there is no value.
  // A thermostat (climate, water heater) keeps the temperature in an attribute, which the history query leaves out, so it
  // cannot be the measured sensor: without a plain sensor at the top the tile is not offered.
  _lossIds() {
    const keys = ['dhw_top', 'dhw_middle', 'dhw_bottom'].filter((k) => this._has(k));
    const sensors = keys.filter((k) => !['climate', 'water_heater'].includes(String(this._e[k]).split('.')[0]));
    const configured = this._e.dhw_loss_sensor;
    const measured = configured && this._has('dhw_loss_sensor') && String(configured).startsWith('sensor.') ? configured : null;
    const tankTemps = sensors.map((k) => this._e[k]);
    const temps = measured ? [measured, ...tankTemps.filter((id) => id !== measured)] : tankTemps;
    const timeline = this._timelineIds();
    // Grid instructions only annotate the public operating timeline. They must not replace a real DHW or gap segment while
    // deciding whether a tank cool-down happened in verified standby (for example SG forced-on during a DHW charge).
    // The compressor that only delimits the runs (`cycle`) does not decide the segments, so the loss analysis leaves it out too.
    const run = timeline ? { ...timeline, sg: null, cycle: null } : null;
    if (!temps.length || (configured ? !measured : sensors[0] !== keys[0]) || !run) return null;
    // A fresh-water station on the buffer has no tank of its own. In a combined storage the circuits draw heat from the same
    // tank, so the pump of every circuit must be known and every window with a running circuit pump is left out (docs/TOPOLOGY.md,
    // D3): one unmonitored circuit could draw heat that would count as standby loss.
    const combined = this._config.storage === 'combined';
    // Both come from the configuration, so the editor's tile probe, which has no rendered parts, decides like the card.
    if (this._station()) return null;
    const circuits = combined ? Array.from({ length: this._hcCount ?? hfcHcCount(this._config) }, (_, n) => this._hk(n + 1, 'pump')) : [];
    const pumps = circuits.filter((k) => this._has(k));
    if (pumps.length < circuits.length) return null;
    // Every rod in the hot-water tank heats it; in a combined storage the rods of the heating zone heat the same tank.
    const rods = HFC_TANK_HEATERS.filter((k) => combined || k.startsWith('dhw_'));
    // A boiler (#51) can charge the tank while the heat pump reports standby, and the operating-mode history does not show it:
    // every window in which its state or its power is not clearly off is left out.
    return { temps, run, extra: [...rods, 'solar_pump', 'boiler_state', 'boiler_power', ...pumps].filter((k) => this._has(k)).map((k) => this._e[k]) };
  }

  // Loss over the last HFC_LOSS.hours from the recorder history, cached like the other recorder queries.
  _dhwLossNow() {
    const ids = this._lossIds();
    if (!ids) return null;
    const list = [...new Set([...ids.temps, ...Object.values(ids.run).filter(Boolean), ...ids.extra])];
    const end = Date.now(); const start = end - HFC_LOSS.hours * 3600000;
    const hist = this._wsCached(`dhwloss|${list.join(',')}`, {
      type: 'history/history_during_period', start_time: new Date(start).toISOString(), entity_ids: list,
      minimal_response: true, no_attributes: true, significant_changes_only: false,
    }, (res) => this._timelineHistory(res, list));
    if (!hist) return null;
    // The history changes every five minutes; the analysis runs once per history.
    if (this._lossMemo?.hist !== hist) this._lossMemo = { hist, v: this._dhwLoss(hist, ids, start, end) };
    return this._lossMemo.v;
  }

  // Cool-down of the tank in K/h from verified standby windows only. Excluded, each with a settling time: hot-water operation,
  // heater rod or solar pump not clearly off, unknown states, draw-off (a sensor drops HFC_LOSS.drawOff K within 30 minutes)
  // and heating the card cannot explain (a rise of HFC_LOSS.rise K). Every remaining window of at least HFC_LOSS.minWindow
  // hours gets a linear fit of the uppermost sensor; the result is the mean slope weighted by window length.
  // Returns { rate, hours, windows, temp } or null without a window.
  _dhwLoss(hist, ids, start, end) {
    const H = 3600000; const settle = HFC_LOSS.settle * H; const half = H / 2;
    const busy = [];
    // Hot-water operation and gaps from the same segments as the timeline; time before the first state is unknown.
    const segs = this._timelineSegments(hist, ids.run, start, end);
    if (!segs.length) return null;
    if (segs[0].from > start) busy.push([start, segs[0].from]);
    segs.forEach((s) => { if (s.kind === 'dhw' || s.kind === 'gap') busy.push([s.from, s.to + settle]); });
    // The timeline reads a missing or unavailable compressor or valve as idle or heating, which could hide a hot-water run:
    // every running signal must be known all the time.
    Object.values(ids.run).filter(Boolean).forEach((id) => {
      const list = hist[id] || [];
      if (!list.length || list[0].t > start) busy.push([start, list.length ? list[0].t : end]);
      list.forEach((e, n) => { if (['unknown', 'unavailable'].includes(e.s)) busy.push([e.t, (list[n + 1]?.t ?? end) + settle]); });
    });
    const off = (s) => ['off', 'false', 'aus', 'idle', 'standby'].includes(String(s).toLowerCase()) || parseFloat(s) === 0;
    ids.extra.forEach((id) => {
      const list = hist[id] || [];
      if (!list.length || list[0].t > start) busy.push([start, list.length ? list[0].t : end]);
      list.forEach((e, n) => { if (!off(e.s)) busy.push([e.t, (list[n + 1]?.t ?? end) + settle]); });
    });
    const series = ids.temps.map((id) => (hist[id] || []).map((e) => ({ t: e.t, v: parseFloat(e.s) })));
    series.forEach((list) => {
      if (!list.length || list[0].t > start) busy.push([start, list.length ? list[0].t : end]);
      let j = 0;
      list.forEach((e, n) => {
        if (!Number.isFinite(e.v)) { busy.push([e.t, (list[n + 1]?.t ?? end) + settle]); return; }
        // The value held 30 minutes earlier, found with a pointer that only moves forward. Within the first 30 minutes of the
        // history the first value is the baseline, so a draw-off right at the start is seen as well.
        while (j + 1 < n && list[j + 1].t <= e.t - half) j++;
        const before = n > 0 ? list[j].v : NaN;
        if (before - e.v >= HFC_LOSS.drawOff || e.v - before >= HFC_LOSS.rise) busy.push([e.t - half - settle, e.t + settle]);
      });
    });
    // Free windows between the merged busy intervals.
    busy.sort((a, b) => a[0] - b[0]);
    const free = []; let t = start;
    busy.forEach(([from, to]) => { if (from > t) free.push([t, Math.min(from, end)]); t = Math.max(t, to); });
    if (t < end) free.push([t, end]);
    const measured = series[0];
    let weight = 0; let sum = 0; let temps = 0; let samples = 0; let windows = 0;
    free.filter(([from, to]) => to - from >= HFC_LOSS.minWindow * H).forEach(([from, to]) => {
      // Sample the held value every ten minutes and fit a line (K per hour).
      const pts = []; let k = 0;
      for (let at = from; at <= to; at += 600000) {
        while (k + 1 < measured.length && measured[k + 1].t <= at) k++;
        if (measured[k] && measured[k].t <= at && Number.isFinite(measured[k].v)) pts.push([(at - from) / H, measured[k].v]);
      }
      if (pts.length < 4) return;
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length; const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
      // A tank does not warm up in standby: a rising fit means an unknown heat source, so the window is not used.
      if (!(slope <= 0.05)) return;
      const len = (to - from) / H;
      weight += len; sum += Math.max(-slope, 0) * len; temps += my * pts.length; samples += pts.length; windows++;
    });
    return windows ? { rate: sum / weight, hours: weight, windows, temp: temps / samples } : null;
  }

  /* ---------- timeline of the operating mode ---------- */
  // Entities whose history tells what the heat pump did: the operating mode, else the compressor (and the valve for hot water).
  // PV surplus and SG-Ready add their histories and split the base operating periods into their own kinds. A preset may let a
  // running compressor win over an idle mode; without a valve, `valve_rule` adds flow and tank temperature.
  _timelineIds() {
    const comp = this._has('compressor') ? { comp: this._e.compressor, valve: this._has('valve') ? this._e.valve : null } : null;
    const byFlow = this._valveByFlow() ? { vflow: this._e.flow, vtank: this._e.dhw_top } : {};
    const base = this._has('mode') ? { mode: this._e.mode, ...byFlow, ...(comp && this._preset?.compressor_over_idle ? comp : {}) }
      : comp ? { ...comp, ...byFlow } : null;
    // The runs read the compressor even where the segments follow the mode alone; `cycle` only when `comp` is not there already.
    // Presets without a compressor entity but with its speed (Lambda, Bosch/Buderus Home Comfort) delimit the runs by the speed.
    const runSignal = comp ? comp.comp : (this._has('compressor_speed') ? this._e.compressor_speed : null);
    const cycle = base && runSignal && !base.comp ? { cycle: runSignal } : {};
    return base ? { ...base, ...cycle, ...(this._has('pv_boost') ? { pv: this._e.pv_boost } : {}), ...(this._has('sg_ready') ? { sg: this._e.sg_ready } : {}) } : null;
  }

  // Runs of the heat pump between start and end, from the segments of _timelineSegments (#300, #324). With a compressor a run
  // lasts from on to off; the operating periods inside it (heating, hot water, defrost) are its phases. Without one, every
  // stretch of operating periods without a pause is a phase run. A run that began before the window is `partial`, one still
  // going at its end `ongoing`. `pause` is the standstill before the run; `series` counts the runs since the last standstill of
  // at least HFC_RUNS.seriesGap minutes, which began at `seriesFrom`.
  // Returns [{ from, to, kind, phases: [{ kind, from, to }], source: 'run' | 'phase', partial, ongoing, pause, series, seriesFrom }].
  _timelineRuns(hist, ids, segs, start, end) {
    const heatKinds = ['heat', 'pv', 'sg-boost', 'sg-forced'];
    const active = (kind) => [...heatKinds, 'dhw', 'defrost', 'cool'].includes(kind);
    const phasesIn = (from, to) => segs.filter((s) => s.to > from && s.from < to && active(s.kind))
      .map((s) => ({ kind: s.kind, from: Math.max(s.from, from), to: Math.min(s.to, to) }));
    const runs = [];
    const add = (from, to, source) => {
      const last = runs[runs.length - 1];
      if (last && last.to === from) last.to = to; else runs.push({ from, to, source });
    };
    // A compressor without recorded history (excluded from the recorder) leaves the phases of the operating mode.
    const list = (ids.cycle || ids.comp) ? hist[ids.cycle || ids.comp] || [] : [];
    if (list.length) {
      // The same on-states as the segments; a speed or frequency of 0 is off, unavailable ends the run.
      const on = (s) => !['off', 'unavailable', 'unknown', 'none', ''].includes(String(s).toLowerCase()) && !(parseFloat(s) <= 0);
      list.forEach((e, n) => {
        if (!on(e.s)) return;
        const from = Math.max(e.t, start); const to = Math.min(list[n + 1] ? list[n + 1].t : end, end);
        if (to > from) add(from, to, 'run');
      });
    } else segs.forEach((s) => { if (active(s.kind)) add(s.from, s.to, 'phase'); });
    runs.forEach((r, n) => {
      r.phases = phasesIn(r.from, r.to);
      // The kind is the phase kind that lasted longest; PV surplus and SG boost are heating. Without any phase the compressor
      // ran for heating as far as the card can tell.
      const time = {};
      r.phases.forEach((p) => { const k = heatKinds.includes(p.kind) ? 'heat' : p.kind; time[k] = (time[k] || 0) + p.to - p.from; });
      r.kind = Object.keys(time).sort((a, b) => time[b] - time[a])[0] || 'heat';
      r.partial = r.from <= start;
      r.ongoing = r.to >= end;
      const prev = runs[n - 1];
      r.pause = prev ? r.from - prev.to : null;
      r.series = prev && r.pause < HFC_RUNS.seriesGap * 60000 ? prev.series + 1 : 1;
      r.seriesFrom = r.series > 1 ? prev.seriesFrom : r.from;
    });
    return runs;
  }

  // Preset rule for units without a valve or hot-water charging entity (`valve_rule: 'flow_above_dhw'`, ViCare #196): hot water
  // while the heat pump runs and its flow is above the tank temperature, since heating keeps the flow below a charged tank.
  // A tank that has cooled below the heating flow reads as hot water for that time.
  _valveByFlow() {
    return this._preset?.valve_rule === 'flow_above_dhw' && !this._has('valve') && this._has('flow') && this._has('dhw_top');
  }

  // The parts of the heating periods in which the PV surplus entity was on become periods of the kind `pv`.
  _timelinePv(segs, list, start, end) {
    const on = [];
    list.forEach((e, n) => {
      if (!this._pvOn(e.s)) return;
      const from = Math.max(e.t, start); const to = Math.min(list[n + 1] ? list[n + 1].t : end, end);
      if (to > from) on.push([from, to]);
    });
    if (!on.length) return segs;
    const out = [];
    const add = (kind, raw, from, to) => {
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.to === from) last.to = to; else out.push({ kind, raw, from, to });
    };
    segs.forEach((seg) => {
      if (seg.kind !== 'heat') { add(seg.kind, seg.raw, seg.from, seg.to); return; }
      let at = seg.from;
      on.forEach(([a, b]) => {
        const from = Math.max(a, at); const to = Math.min(b, seg.to);
        if (to <= from) return;
        if (from > at) add('heat', seg.raw, at, from);
        add('pv', seg.raw, from, to); at = to;
      });
      if (at < seg.to) add('heat', seg.raw, at, seg.to);
    });
    return out;
  }

  // SG-Ready overrides the displayed operating kind while a grid instruction is active. Normal operation and states that are not
  // in sg_ready_map leave the operating timeline unchanged; unknown history therefore never looks like a lock or forced run.
  _timelineSg(segs, list, start, end) {
    const active = [];
    list.forEach((e, n) => {
      const state = this._sgReadyState(e.s);
      if (!['blocked', 'boost', 'forced'].includes(state)) return;
      const from = Math.max(e.t, start); const to = Math.min(list[n + 1] ? list[n + 1].t : end, end);
      if (to > from) active.push({ from, to, kind: `sg-${state}`, raw: e.s });
    });
    if (!active.length) return segs;
    const out = [];
    const add = (kind, raw, from, to) => {
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.to === from) last.to = to; else out.push({ kind, raw, from, to });
    };
    segs.forEach((seg) => {
      let at = seg.from;
      active.forEach((sg) => {
        const from = Math.max(sg.from, at); const to = Math.min(sg.to, seg.to);
        if (to <= from) return;
        if (from > at) add(seg.kind, seg.raw, at, from);
        add(sg.kind, sg.raw, from, to); at = to;
      });
      if (at < seg.to) add(seg.kind, seg.raw, at, seg.to);
    });
    return out;
  }

  // Share of the heating time in PV surplus mode (percent) for today, yesterday or the week, from the recorder history
  // (kept for about ten days). NaN while the history loads or when it is not available.
  _pvShare(period) {
    const ids = this._timelineIds(); const range = this._periodRange(period);
    if (!ids?.pv || !range) return NaN;
    const shareIds = { ...ids, sg: null };
    const idList = Object.values(shareIds).filter(Boolean);
    const hist = this._wsCached(`pvshare|${idList.join(',')}|${period}`, {
      type: 'history/history_during_period', start_time: range[0], ...(range[1] ? { end_time: range[1] } : {}), entity_ids: idList,
      minimal_response: true, ...(!this._timelineNeedsAttributes(shareIds) ? { no_attributes: true } : {}), significant_changes_only: false,
    }, (res) => this._timelineHistory(res, idList));
    if (!hist) return NaN;
    const from = Date.parse(range[0]); const to = range[1] ? Date.parse(range[1]) : Date.now();
    const segs = this._timelineSegments(hist, shareIds, from, to);
    // Only the time in which the PV entity has a known state counts: before its first state (not recorded, added later) and
    // while it is unknown or unavailable nothing is known about it, which must not read as "not in PV surplus mode".
    const list = hist[ids.pv] || [];
    const known = list.map((e, n) => [e.t, list[n + 1] ? list[n + 1].t : to, e.s]).filter(([, , s]) => !['unknown', 'unavailable'].includes(s));
    const within = (s) => known.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(s.to, b) - Math.max(s.from, a)), 0);
    const time = (kind) => segs.filter((s) => s.kind === kind).reduce((sum, s) => sum + within(s), 0);
    const heating = time('heat') + time('pv');
    return heating > 0 ? (time('pv') / heating) * 100 : NaN;
  }

  // History of one or two entities as { entity: [{ t: ms, s: state }] }. Accepts the compact format of the history API
  // ({ s, lu } with seconds) and the full state objects ({ state, last_updated } with ISO strings).
  _timelineHistory(res, ids) {
    const time = (e) => {
      const v = e.lu ?? e.lc ?? e.last_updated ?? e.last_changed;
      const ms = typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : Date.parse(v);
      return ms;
    };
    const out = {};
    ids.forEach((id) => {
      const list = (res && res[id]) || [];
      const key = id === this._e?.flow ? 'flow' : id === this._e?.dhw_top ? 'dhw_top' : '';
      const attr = hfcTempAttr(id, key);
      out[id] = list.map((e) => ({ t: time(e), s: String((attr ? e.attributes?.[attr] ?? e.a?.[attr] : undefined) ?? e.s ?? e.state) }))
        .filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    });
    return out;
  }

  _timelineNeedsAttributes(ids) { return !![ids?.vflow, ids?.vtank].find((id) => hfcTempAttr(id, id === ids?.vflow ? 'flow' : 'dhw_top')); }

  // Segments { kind, raw, from, to } between start and end: operating modes plus PV/SG overlays or gap (no data).
  _timelineSegments(hist, ids, start, end) {
    const kindOfMode = (raw) => {
      if (['unknown', 'unavailable', 'None'].includes(raw)) return 'gap';
      const m = this._norm(this._maps.mode, raw);
      return { heating: 'heat', dhw: 'dhw', defrost: 'defrost', cooling: 'cool', blocked: 'blocked' }[m] || 'idle';
    };
    const points = [];
    if (ids.mode && !ids.comp && !ids.vflow) hist[ids.mode].forEach((e) => points.push({ t: e.t, kind: kindOfMode(e.s), raw: e.s }));
    else {
      // Compressor on = heating, with the valve on hot water = dhw. With a mode as well, the compressor only decides while the
      // mode is idle. The times are walked in order, so each list keeps a pointer to the state held at that time.
      const list = (id) => (id ? hist[id] || [] : []);
      const held = (entries) => { let n = -1; return (t) => { while (n + 1 < entries.length && entries[n + 1].t <= t) n++; return entries[n]?.s; }; };
      const mode = held(list(ids.mode)); const comp = held(list(ids.comp)); const valve = held(list(ids.valve));
      const vflow = held(list(ids.vflow)); const vtank = held(list(ids.vtank));
      const on = (s) => s !== undefined && !['off', 'unavailable', 'unknown', '0', '0.0'].includes(String(s).toLowerCase());
      const dhw = (s) => s !== undefined && (this._valveMapped(s) ?? ['on', 'tank', 'dhw', 'hot water', 'warmwasser'].includes(String(s).toLowerCase()));
      const times = [...new Set([ids.mode, ids.comp, ids.valve, ids.vflow, ids.vtank].flatMap((id) => list(id).map((e) => e.t)))].sort((a, b) => a - b);
      times.forEach((t) => {
        const ms = mode(t); const cs = comp(t); const vs = valve(t); const fl = parseFloat(vflow(t)); const tk = parseFloat(vtank(t));
        const toDhw = ids.valve ? dhw(vs) : !!ids.vflow && fl > tk;
        if (ids.mode) {
          if (ms === undefined) return;
          const kind = kindOfMode(ms);
          // ViCare may keep reporting either ready/idle or heating while the inferred hydraulic route already charges DHW.
          const running = ids.comp ? on(cs) : ['heat', 'dhw', 'cool'].includes(kind);
          const routed = running && ['idle', 'heat'].includes(kind) ? (toDhw ? 'dhw' : 'heat') : kind;
          points.push({ t, kind: routed, raw: ms });
        } else if (['unknown', 'unavailable'].includes(cs)) points.push({ t, kind: 'gap', raw: cs });
        else points.push({ t, kind: on(cs) ? (toDhw ? 'dhw' : 'heat') : 'idle', raw: on(cs) ? 'on' : 'off' });
      });
    }
    const segs = [];
    points.forEach((p, n) => {
      const from = Math.max(p.t, start); const to = Math.min(points[n + 1] ? points[n + 1].t : end, end);
      if (to <= from) return;
      const last = segs[segs.length - 1];
      if (last && last.kind === p.kind && last.to === from) last.to = to; else segs.push({ kind: p.kind, raw: p.raw, from, to });
    });
    let out = ids.pv ? this._timelinePv(segs, hist[ids.pv] || [], start, end) : segs;
    if (ids.sg) out = this._timelineSg(out, hist[ids.sg] || [], start, end);
    return out;
  }

  // Entities shown as extra lanes under the bar: timeline_marks true = the badges, or a list of entities / { entity, label }.
  _timelineMarks() {
    const m = this._config.timeline_marks;
    if (!m) return [];
    const list = m === true ? this._badges : (Array.isArray(m) ? m : []);
    const seen = new Set();
    return list.map((x) => (typeof x === 'string' ? { entity: x } : x)).filter((x) => x && x.entity && !seen.has(x.entity) && seen.add(x.entity))
      .map((x) => ({ entity: x.entity, label: x.label || this._hass.states[x.entity]?.attributes?.friendly_name || x.entity }));
  }

  // Periods in which a mark entity was on (same on-states as the badge chips), merged, between start and end.
  _timelineMarkSegments(hist, mark, start, end) {
    const list = hist[mark.entity] || [];
    const segs = [];
    list.forEach((e, n) => {
      if (!['on', 'true', 'home', 'open', 'ein'].includes(String(e.s).toLowerCase())) return;
      const from = Math.max(e.t, start); const to = Math.min(list[n + 1] ? list[n + 1].t : end, end);
      if (to <= from) return;
      const last = segs[segs.length - 1];
      if (last && last.to === from) last.to = to; else segs.push({ from, to });
    });
    return segs;
  }

  _timelineTime(ms) {
    let tz; try { tz = this._hass.config?.time_zone; new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (err) { tz = undefined; }
    return new Intl.DateTimeFormat(this._lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(ms);
  }

  _timelineDuration(ms) {
    const m = Math.max(Math.round(ms / 60000), 1);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }

  _timelineLabel(seg) {
    const i = this._i;
    if (seg.kind === 'gap') return i.timeline_gap;
    return { heat: i.modes.heating, pv: `${i.modes.heating} · ${i.pv_boost}`, dhw: i.modes.dhw, defrost: i.modes.defrost, cool: i.modes.cooling,
      blocked: i.modes.blocked, 'sg-blocked': i.sg_ready.blocked, 'sg-boost': i.sg_ready.boost, 'sg-forced': i.sg_ready.forced, idle: i.modes.idle }[seg.kind];
  }

  _timelineDetail(seg) {
    return `${this._timelineLabel(seg)} · ${this._timelineTime(seg.from)}–${this._timelineTime(seg.to)} · ${this._timelineDuration(seg.to - seg.from)}`;
  }

  _updateTimeline() {
    const box = this._$('timeline');
    if (!box) return;
    const ids = this._timelineIds();
    const hours = Math.min(Math.max(+this._config.timeline_hours || 24, 3), 72);
    const idList = ids ? Object.values(ids).filter(Boolean) : [];
    if (!idList.length) { box.hidden = true; return; }
    const now = Date.now(); const start = now - hours * 3600000;
    const marks = this._timelineMarks();
    const allIds = [...new Set([...idList, ...marks.map((m) => m.entity)])];
    const hist = this._wsCached(`timeline|${allIds.join(',')}|${hours}`, {
      type: 'history/history_during_period', start_time: new Date(start).toISOString(), entity_ids: allIds,
      minimal_response: true, ...(!this._timelineNeedsAttributes(ids) ? { no_attributes: true } : {}), significant_changes_only: false,
    }, (res) => this._timelineHistory(res, allIds));
    if (!hist) { box.hidden = true; return; }
    // The window is cached for five minutes; the bar always ends at "now".
    const segs = this._timelineSegments(hist, ids, start, now);
    if (!segs.length) { box.hidden = true; return; }
    const lanes = marks.map((m, n) => ({ ...m, n, segs: this._timelineMarkSegments(hist, m, start, now) })).filter((l) => l.segs.length);
    // Runs and their detail panel (#325); `timeline_details: false` keeps the one-line period detail of before.
    const runs = this._config.timeline_details === false ? [] : this._timelineRuns(hist, ids, segs, start, now);
    // The values of a selected run arrive with their own query (#326); the panel redraws when they are there.
    const run = runs.find((r) => this._runId(r) === this._tlRun);
    // A selected run that left the window is no longer selected, so a later run cannot take its place.
    if (!run) this._tlRun = null;
    const panel = run && this._layout !== 'wall';
    const rows = panel ? this._runValues(run) : [];
    const minute = Math.floor(now / 60000);
    const key = `${minute}|${segs.map((s) => `${s.kind}${s.from}${s.to}`).join(',')}|${lanes.map((l) => `${l.n}${l.label}${l.segs.map((s) => `${s.from}-${s.to}`).join(',')}`).join(';')}|${this._lang}|${this._tlSel ?? ''}|${this._tlMarkSel ?? ''}|${this._tlRun ?? ''}|${runs.length}|${rows.map((r) => r.join('=')).join(';')}`;
    if (box._k === key) return;
    box._k = key; box.hidden = false;
    this._tl = { segs, start, now, lanes, runs };
    const pct = (t) => (((t - start) / (now - start)) * 100).toFixed(3);
    const i = this._i;
    // Hour ticks at clock times (every 6 h for a day), found in the Home Assistant time zone.
    const step = hours <= 6 ? 1 : hours <= 24 ? 6 : hours <= 48 ? 12 : 24;
    let tz; try { tz = this._hass.config?.time_zone; new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (err) { tz = undefined; }
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
    const ticks = [];
    for (let t = Math.ceil(start / 900000) * 900000; t < now; t += 900000) {
      const [h, m] = fmt.format(t).split(':').map(Number);
      if (m === 0 && h % step === 0) ticks.push([t, String(h).padStart(2, '0')]);
    }
    const kinds = [...new Set(segs.map((s) => s.kind))].filter((k) => k !== 'idle');
    const sel = segs.findIndex((s) => s.from === this._tlSel);
    const markDetail = (l, s) => `${l.label} · ${this._timelineTime(s.from)}–${this._timelineTime(s.to)} · ${this._timelineDuration(s.to - s.from)}`;
    let detail = sel >= 0 ? this._timelineDetail(segs[sel]) : '';
    lanes.forEach((l) => l.segs.forEach((s) => { if (`${l.n}:${s.from}` === this._tlMarkSel) detail = markDetail(l, s); }));
    // A selected run opens the panel under the axis; the wall display, which nobody taps, keeps the one line.
    if (run) detail = panel ? '' : [this._runHead(run), ...this._runNotes(run)].join(' · ');
    const edges = [...new Set(runs.filter((r) => r.source === 'run').flatMap((r) => [r.from, r.to]).filter((t) => t > start && t < now))];
    box.innerHTML = `<div class="tl-head"><span>${this._esc(i.timeline_title.replace('{h}', hours))}</span><span class="tl-detail" id="tl-detail" aria-live="polite">${this._esc(detail)}</span></div>
      <div class="tl-bar" id="tl-bar" tabindex="0" role="group" aria-label="${this._esc(i.timeline_aria.replace('{h}', hours))}">${segs.map((s, n) =>
    `<span class="seg k-${s.kind}${n === sel && !run ? ' sel' : ''}" data-seg="${n}" style="left:${pct(s.from)}%;width:${(pct(s.to) - pct(s.from)).toFixed(3)}%" title="${this._esc(this._timelineDetail(s))}"></span>`).join('')}${edges.map((t) =>
    `<span class="tick" style="left:${pct(t)}%"></span>`).join('')}${run ? `<span class="run-sel" style="left:${pct(run.from)}%;width:${(pct(run.to) - pct(run.from)).toFixed(3)}%"></span>` : ''}</div>
      ${lanes.map((l) => `<div class="tl-mark" role="img" aria-label="${this._esc(`${l.label}: ${l.segs.map((s) => `${this._timelineTime(s.from)}–${this._timelineTime(s.to)}`).join(', ')}`)}">${l.segs.map((s) =>
    `<span class="mseg${`${l.n}:${s.from}` === this._tlMarkSel ? ' sel' : ''}" data-mseg="${l.n}:${s.from}" style="left:${pct(s.from)}%;width:${(pct(s.to) - pct(s.from)).toFixed(3)}%" title="${this._esc(markDetail(l, s))}"></span>`).join('')}</div>`).join('')}
      <div class="tl-axis">${ticks.map(([t, l]) => `<span style="left:${pct(t)}%">${l}</span>`).join('')}</div>
      ${panel ? this._runPanel(run, rows) : ''}
      <div class="tl-legend">${kinds.map((k) => `<span><i class="k-${k}"></i>${this._esc(this._timelineLabel({ kind: k }))}</span>`).join('')}${lanes.map((l) => `<span><i class="k-mark"></i>${this._esc(l.label)}</span>`).join('')}</div>`;
  }

  // Identity of a run for the selection and its query. A run cut by the window starts at the window start, which moves with
  // every update, so it is known by its end; one that also still runs is the only run in the window.
  _runId(run) { return run.partial ? `partial-${run.ongoing ? 'now' : run.to}` : String(run.from); }

  // "Hot water · 10:07–10:55 · 48 min" for a run.
  _runHead(run) {
    return `${this._timelineLabel({ kind: run.kind })} · ${this._timelineTime(run.from)}–${this._timelineTime(run.to)} · ${this._timelineDuration(run.to - run.from)}`;
  }

  // The line under the head: phase run, cut by the window or still running, its place in a series and the pause before it.
  _runNotes(run) {
    const i = this._i;
    return [
      run.source === 'phase' ? i.run_phase : '',
      run.partial ? i.run_partial : '', run.ongoing ? i.run_ongoing : '',
      run.series > 1 ? i.run_series.replace('{n}', run.series).replace('{t}', this._timelineTime(run.seriesFrom)) : '',
      run.pause !== null ? i.run_pause.replace('{d}', this._timelineDuration(run.pause)) : '',
    ].filter(Boolean);
  }

  // Values of a run (#326), from the recorder history of its window only, fetched when the run is selected and cached like the
  // other queries. Hot water: tank at start and end, target reached, heater rod, defrosts. Heating and other runs: mean flow
  // against the circuit target, mean spread of the heat pump and of circuit 1, mean compressor modulation, flow rate and outdoor
  // temperature, defrosts. Means are weighted by time. A value without data is left out. Returns [[label, html]], [] while loading.
  _runValues(run) {
    const i = this._i;
    const dhw = run.kind === 'dhw';
    const keys = (dhw ? ['dhw_top', 'dhw_target', 'heater', ...HFC_TANK_HEATERS.filter((k) => k.startsWith('dhw_')), 'defrost']
      : ['flow', 'return', 'hc_flow', 'hc_return', 'hc_setpoint', 'compressor_speed', 'volume', 'outdoor', 'defrost']).filter((k) => this._has(k));
    if (!keys.length) return [];
    const list = [...new Set(keys.map((k) => this._e[k]))];
    const attrs = keys.some((k) => hfcTempAttr(this._e[k], k));
    // A run that is still going ends "now", which moves with every update: its query has no end and a fixed key, so it is
    // refreshed every five minutes like the other queries instead of being asked again on every update. The same holds for the
    // start of a run cut by the window, which moves with the window.
    const hist = this._wsCached(`run|${list.join(',')}|${this._runId(run)}|${run.ongoing ? 'now' : run.to}`, {
      type: 'history/history_during_period', start_time: new Date(run.from).toISOString(), ...(run.ongoing ? {} : { end_time: new Date(run.to).toISOString() }),
      entity_ids: list, minimal_response: true, ...(attrs ? {} : { no_attributes: true }), significant_changes_only: false,
    }, (res) => res || {});
    if (!hist) return [];
    const time = (e) => { const v = e.lu ?? e.lc ?? e.last_updated ?? e.last_changed; return typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : Date.parse(v); };
    const states = (key) => {
      const id = this._e[key]; const attr = hfcTempAttr(id, key);
      return (hist[id] || []).map((e) => ({ t: time(e), s: String((attr ? e.attributes?.[attr] ?? e.a?.[attr] : undefined) ?? e.s ?? e.state) }))
        .filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
    };
    // Numbers of a key in °C for temperatures and l/h for flow rates; a negative flow rate is a marker, not a value (#312).
    const unit = (key) => this._unit(key).trim().replace(/º/g, '°').replace('℃', '°c').replace('℉', '°f').replace('³', '3');
    const scale = (key) => {
      const u = unit(key);
      if (key === 'volume') return (v) => (v < 0 ? NaN : u === 'm3/h' ? v * 1000 : u === 'l/min' ? v * 60 : v);
      return u === '°f' ? (v) => (v - 32) * 5 / 9 : u === 'k' && key !== 'compressor_speed' ? (v) => v - 273.15 : (v) => v;
    };
    // An invalid sample (unavailable, a negative flow-rate marker) stays in the list as NaN: it ends the valid value before it,
    // so a mean leaves the gap out instead of carrying that value across it.
    const nums = (key) => { const f = scale(key); return states(key).map((e) => ({ t: e.t, v: f(parseFloat(e.s)) })); };
    // The value held at t; without a sample at or before t it is unknown, a later sample is never moved back to the start.
    const at = (pts, t) => { let v = NaN; pts.forEach((p) => { if (p.t <= t) v = p.v; }); return v; };
    const mean = (pts) => {
      let sum = 0; let w = 0;
      pts.forEach((p, n) => {
        const a = Math.max(p.t, run.from); const b = Math.min(pts[n + 1]?.t ?? run.to, run.to);
        if (b > a && Number.isFinite(p.v)) { sum += p.v * (b - a); w += b - a; }
      });
      return w ? sum / w : NaN;
    };
    const diff = (a, b) => {
      const pa = nums(a); const pb = nums(b);
      const times = [...new Set([...pa, ...pb].map((p) => p.t))].sort((x, y) => x - y);
      return mean(times.map((t) => ({ t, v: at(pa, t) - at(pb, t) })));
    };
    const on = (s) => !['off', 'unavailable', 'unknown', 'none', '', 'false', 'aus'].includes(String(s).toLowerCase()) && !(parseFloat(s) <= 0);
    // Periods a key was on within the run, and how often it switched on. A key without recorder history in the window is
    // unknown, not off.
    const onTime = (key) => {
      const ss = states(key); const spans = []; let starts = 0;
      ss.forEach((e, n) => {
        if (!on(e.s)) return;
        const a = Math.max(e.t, run.from); const b = Math.min(ss[n + 1]?.t ?? run.to, run.to);
        if (b > a) spans.push([a, b]);
        if (e.t >= run.from && !(n > 0 && on(ss[n - 1].s))) starts++;
      });
      return { spans, starts, known: ss.length > 0 };
    };
    // Length of the union of periods: two heaters one after the other count both, two at the same time once.
    const union = (spans) => {
      let ms = 0; let end = -Infinity;
      [...spans].sort((x, y) => x[0] - y[0]).forEach(([a, b]) => { if (b > end) { ms += b - Math.max(a, end); end = b; } });
      return ms;
    };
    const K = (v) => `${this._fmt(v)} K`;
    const rows = [];
    const thaw = this._has('defrost') ? onTime('defrost') : null;
    const defrosts = thaw?.known ? thaw.starts : run.phases.filter((p) => p.kind === 'defrost').length;
    if (dhw) {
      const tank = nums('dhw_top');
      const a = at(tank, run.from); const b = at(tank, run.to);
      if (Number.isFinite(a) && Number.isFinite(b)) rows.push([i.tiles.dhw_top, `${this._esc(this._t(a))} → ${this._esc(this._t(b))} <span class="m">(${b >= a ? '+' : '−'}${this._esc(K(Math.abs(b - a)))})</span>`]);
      const target = at(nums('dhw_target'), run.to);
      if (Number.isFinite(target) && Number.isFinite(b)) {
        rows.push([`${i.target} ${this._fmt(target)} °C`, this._esc(b >= target - 0.5 ? i.run_reached : i.run_missed.replace('{d}', this._fmt(target - b)))]);
      }
      const rods = ['heater', ...HFC_TANK_HEATERS.filter((k) => k.startsWith('dhw_'))].filter((k) => keys.includes(k)).map(onTime).filter((r) => r.known);
      if (rods.length) {
        const ms = union(rods.flatMap((r) => r.spans));
        rows.push([i.run_heater, this._esc(ms > 0 ? `${i.run_on} · ${this._timelineDuration(ms)}` : i.run_off)]);
      }
    } else {
      const flow = mean(nums('flow'));
      const set = mean(nums('hc_setpoint'));
      if (Number.isFinite(flow)) rows.push([`${i.run_flow} Ø`, `${this._esc(this._t(flow))}${Number.isFinite(set) ? ` <span class="m">(${this._esc(`${i.target} ${this._fmt(set)}`)})</span>` : ''}`]);
      const spread = keys.includes('return') ? diff('flow', 'return') : NaN;
      const circuit = keys.includes('hc_flow') && keys.includes('hc_return') ? diff('hc_flow', 'hc_return') : NaN;
      if (Number.isFinite(spread) || Number.isFinite(circuit)) {
        rows.push([`${i.tiles.spread} Ø`, [Number.isFinite(spread) ? this._esc(K(spread)) : '', Number.isFinite(circuit) ? `<span class="m">${this._esc(`${i.heating_circuit} ${K(circuit)}`)}</span>` : '']
          .filter(Boolean).join(' <span class="m">·</span> ')]);
      }
      const mod = mean(nums('compressor_speed'));
      if (Number.isFinite(mod)) rows.push([`${i.det.compressor_speed} Ø`, this._esc(`${this._fmt(mod, 0)} ${this._st('compressor_speed')?.attributes?.unit_of_measurement || ''}`.trim())]);
      const vol = mean(nums('volume'));
      if (Number.isFinite(vol)) rows.push([`${i.tiles.volume} Ø`, this._esc(`${this._fmt(vol, 0)} l/h`)]);
      const out = mean(nums('outdoor'));
      if (Number.isFinite(out)) rows.push([`${i.outdoor} Ø`, this._esc(this._t(out))]);
    }
    if (defrosts > 0 || thaw?.known) rows.push([i.tiles.defrosts, String(defrosts)]);
    return rows;
  }

  // Detail panel of the selected run under the timeline (#325): head, notes, the phases when the run had more than one kind,
  // and the values of the run (#326). Its colour bar follows the kind.
  _runPanel(run, rows = []) {
    const i = this._i;
    const color = { dhw: hfcVar('hot'), defrost: hfcVar('cool-strong'), cool: hfcVar('cool') }[run.kind] || hfcVar('heat');
    const time = {};
    run.phases.forEach((p) => { const k = ['pv', 'sg-boost', 'sg-forced'].includes(p.kind) ? 'heat' : p.kind; time[k] = (time[k] || 0) + p.to - p.from; });
    const phases = Object.keys(time).length > 1 ? Object.entries(time).map(([k, ms]) => `${this._timelineLabel({ kind: k })} ${this._timelineDuration(ms)}`) : [];
    // Each part stays on one line ("Hot water 48 min"); a narrow card wraps between the parts.
    const line = (parts) => (parts.length ? `<div class="tl-run-sub">${parts.map((p) => `<span>${this._esc(p)}</span>`).join(' · ')}</div>` : '');
    return `<div class="tl-run" id="tl-run" role="group" aria-live="polite" aria-label="${this._esc(this._runHead(run))}" style="--run-c:${color}">
        <div class="tl-run-head"><b>${this._esc(this._runHead(run))}</b><button class="tl-run-x" id="tl-run-x" type="button" aria-label="${this._esc(i.run_close)}" title="${this._esc(i.run_close)}">×</button></div>
        ${line(this._runNotes(run))}${line(phases)}
        ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${this._esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
      </div>`;
  }

  // Tap or arrow keys select a period and show its start, end and duration. With runs (#325), a tap on an operating period
  // selects the run it belongs to and opens its panel, a second tap or Esc closes it; the arrow keys step from run to run.
  _timelineEvents(box) {
    const redraw = (focus) => { box._k = null; this._updateTimeline(); if (focus) this._$('tl-bar')?.focus({ preventScroll: true }); };
    // A period can hold several runs (heating while the compressor cycles): the run at the tapped time, else the nearest one.
    const select = (n, t) => {
      const seg = this._tl?.segs[n];
      if (!seg) return;
      const near = (r) => (Number.isFinite(t) ? Math.max(r.from - t, t - r.to, 0) : 0);
      const run = (this._tl.runs || []).filter((r) => seg.from < r.to && seg.to > r.from).sort((a, b) => near(a) - near(b))[0];
      if (run) { const id = this._runId(run); this._tlRun = this._tlRun === id ? null : id; this._tlSel = null; } else { this._tlSel = seg.from; this._tlRun = null; }
      this._tlMarkSel = null;
      redraw(true);
    };
    // Time under the pointer on the bar; none for a click without a position.
    const timeAt = (ev) => {
      const r = this._$('tl-bar')?.getBoundingClientRect();
      if (!r?.width || !this._tl || !(ev.clientX >= r.left && ev.clientX <= r.right)) return NaN;
      return this._tl.start + ((ev.clientX - r.left) / r.width) * (this._tl.now - this._tl.start);
    };
    box.addEventListener('click', (ev) => {
      if (ev.target.closest('#tl-run-x')) { this._tlRun = null; redraw(true); return; }
      const el = ev.target.closest('[data-seg]'); if (el) { select(+el.dataset.seg, timeAt(ev)); return; }
      // A tap on a lane shows that period; a second tap on the same one clears it.
      const m = ev.target.closest('[data-mseg]');
      if (m) { this._tlMarkSel = this._tlMarkSel === m.dataset.mseg ? null : m.dataset.mseg; this._tlSel = null; this._tlRun = null; redraw(false); }
    });
    box.addEventListener('keydown', (ev) => {
      if (ev.target.id !== 'tl-bar' || !this._tl) return;
      if (ev.key === 'Escape' && (this._tlRun !== null && this._tlRun !== undefined)) { ev.preventDefault(); this._tlRun = null; redraw(true); return; }
      const runs = this._tl.runs || [];
      const list = runs.length ? runs : this._tl.segs;
      const cur = list.findIndex((s) => (runs.length ? this._runId(s) === this._tlRun : s.from === this._tlSel));
      const to = { ArrowRight: cur + 1, ArrowDown: cur + 1, ArrowLeft: cur < 0 ? list.length - 1 : cur - 1, ArrowUp: cur < 0 ? list.length - 1 : cur - 1, Home: 0, End: list.length - 1 }[ev.key];
      if (to === undefined) return;
      ev.preventDefault();
      const item = list[Math.min(Math.max(to, 0), list.length - 1)];
      if (runs.length) { this._tlRun = this._runId(item); this._tlSel = null; } else this._tlSel = item.from;
      this._tlMarkSel = null;
      redraw(true);
    });
  }

  // Heater rods of a tank as [key, id, y, left end]. The plain key keeps its place; the top rod stays clear of the large top value,
  // the middle and bottom rods stand at their sensor's label unless a pipe enters the right wall there (solar loop, fresh-water
  // station, buffer return).
  _tankHeaters(tank, P = {}) {
    const dhw = tank === 'dhw';
    const y = dhw ? { '': 186, top: 74, middle: P.solar ? 184 : 162, bottom: P.dhwType === 'fresh_water' ? 244 : 218 } : { '': 455, top: 340, middle: 442, bottom: 476 };
    return Object.entries(y).map(([pos, h]) => [`${tank}_heater${pos ? `_${pos}` : ''}`, `${dhw ? 'dhw' : 'buf'}${pos ? `-${pos}` : ''}`, h, pos ? 612 : dhw ? 604 : 578]);
  }

  // Heater rod entering a tank from the right wall at height y, reaching left to x; backup / inline heater as a box inside the heat pump.
  _heaterSvg(key, id, y, left) {
    if (!this._has(key)) return '';
    const de = `data-entity="${this._esc(this._e[key])}"`;
    if (id === 'inline') {
      return `<g class="tap heater" id="heater-${id}" ${de}><rect class="heater-box" x="230" y="266" width="46" height="30" rx="6"/>
        <path class="heater-el" d="M236 281 l4 -8 l6 16 l6 -16 l6 16 l6 -16 l6 16 l4 -8"/></g>`;
    }
    // A running rod is red like the hot-water phase of the timeline, with rising heat waves like the emitters; a dark casing keeps
    // it visible in a tank of a similar colour.
    const d = `M640 ${y - 4} H${left + 6} Q${left} ${y - 4} ${left} ${y} Q${left} ${y + 4} ${left + 6} ${y + 4} H640`;
    const waves = [0, 1, 2].map((n) => `<path class="wave" d="M${left + 6 + n * (634 - left - 6) / 2} ${y - 7} q4 -4 0 -8 q-4 -4 0 -8"/>`).join('');
    return `<g class="tap heater rod" id="heater-${id}" ${de}><rect class="heater-flange" x="638" y="${y - 9}" width="9" height="18" rx="2"/>
      <path class="heater-case" d="${d}"/><path class="heater-el" d="${d}"/><g class="waves rod-waves">${waves}</g></g>`;
  }

  // Solar thermal loop into the right side of the DHW tank. Drawn before the tank, so the tank covers the pipe ends; at the
  // collector both pipes run along its axis into the lower end, where the opaque panel covers them.
  _solarPipes() {
    const flow = 'M724.3 101.9 L704.9 116.1 Q690 126.9 690 134 Q690 150 674 150 H640';
    const back = 'M640 166 H700 Q712 166 712 154 V136 Q712 125.7 718.4 121.1 L731.4 111.7';
    const pp = (id, d) => `<path class="pipe" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    return `${pp('sol', flow)}${pp('sol-rl', back)}`;
  }

  // Solar thermal collector on the roof edge of the house, with the coil of its loop in the DHW tank.
  _solarSvg() {
    const entity = this._e.solar_collector || this._e.solar_pump;
    return `<path class="coil" id="coil-sol" d="M640 150 H612 Q602 150 602 158 Q602 166 612 166 H640"/>
      <g class="tap solar" id="solar" data-entity="${this._esc(entity)}">
        <g transform="translate(728 124) rotate(-36)"><rect class="collector-base" x="0" y="-28" width="84" height="26" rx="3"/>
          <rect class="collector" x="0" y="-28" width="84" height="26" rx="3"/>
          <path class="collector-cells" d="M21 -28 V-2 M42 -28 V-2 M63 -28 V-2 M0 -15 H84"/></g>
        <text class="small" id="t-sol" x="716" y="94" text-anchor="end"></text>
      </g>`;
  }

  // Ground loop (brine) or two wells (groundwater) below the heat pump; air keeps the fan.
  _sourceSvg() {
    if (this._sourceType === 'air') return '';
    const pp = (id, d) => `<path class="pipe src" id="p-${id}" d="${d}"/><path class="flow" id="f-${id}" d="${d}"/>`;
    const ground = '<path class="ground" d="M60 478 H280"/>';
    const out = this._e.source_out ? `data-entity="${this._esc(this._e.source_out)}"` : '';
    const inn = this._e.source_in ? `data-entity="${this._esc(this._e.source_in)}"` : '';
    const labels = `<g class="tap" ${out}><text class="small" id="t-src-out" x="130" y="462" text-anchor="end"></text></g>
      <g class="tap" ${inn}><text class="small" id="t-src-in" x="210" y="462"></text></g>
      <g class="tap" ${inn}><text class="small source-spread" id="t-src-spread" x="96" y="512" text-anchor="middle"></text></g>
      <g class="tap" ${this._e.source_volume ? `data-entity="${this._esc(this._e.source_volume)}"` : ''}><text class="vol-label" id="t-src-vol" x="212" y="512"></text></g>
      ${this._sourceType === 'brine' && this._e.brine_pressure ? `<g class="tap pressure" id="pressure-brine" data-entity="${this._esc(this._e.brine_pressure)}"><text class="pressure-label" id="t-brine-pressure" x="170" y="532" text-anchor="middle"></text></g>` : ''}`;
    if (this._sourceType === 'brine') {
      return `${ground}${pp('src', 'M140 425 V528 Q140 548 170 548 Q200 548 200 528 V425')}${labels}`;
    }
    return `${ground}<rect class="well" x="126" y="486" width="28" height="66" rx="4"/><rect class="well" x="186" y="486" width="28" height="66" rx="4"/>
      <path class="water" d="M128 512 q6 -4 12 0 t12 0 M188 512 q6 -4 12 0 t12 0"/>
      ${pp('src-in', 'M200 540 V425')}${pp('src-out', 'M140 425 V540')}${labels}`;
  }

  // Entity behind a power source: the manual entity, or the Energy dashboard's power sensor.
  _srcEntity(key) {
    if (this._parts.power !== 'energy') return this._e[key];
    const r = this._energy[{ pv: 'solar', battery: 'battery', grid: 'grid' }[key]][0];
    return r && (r.id || r.from || r.to);
  }

  _source(key, x, label, entity) {
    const icons = {
      pv: `<circle cx="${x}" cy="40" r="9" class="ico"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) =>
        `<line x1="${x}" y1="25" x2="${x}" y2="20" class="ico-l" transform="rotate(${a} ${x} 40)"/>`).join('')}`,
      bat: `<rect x="${x - 8}" y="30" width="16" height="22" rx="3" class="ico-o"/><rect x="${x - 4}" y="26" width="8" height="4" rx="1" class="ico"/><rect x="${x - 5}" y="40" width="10" height="9" rx="1" class="ico"/>`,
      grid: `<path d="M${x - 10} 54 L${x} 24 L${x + 10} 54 M${x - 7} 44 H${x + 7} M${x - 12} 32 H${x + 12}" class="ico-l"/>`,
    };
    const has = entity && this._hass.states[entity];
    return `<g class="tap src ${key}${has ? '' : ' absent'}" ${has ? `data-entity="${this._esc(entity)}"` : ''} id="src-${key}">
      <circle cx="${x}" cy="40" r="28" class="src-ring"/>${icons[key]}
      <text class="small" x="${x}" y="88" text-anchor="middle" id="t-src-${key}">${this._esc(label)}</text>
      <text class="small src-val" x="${x}" y="108" text-anchor="middle" id="t-src-${key}-v"></text>
    </g>`;
  }

  _moreInfo(entityId) {
    const e = new Event('hass-more-info', { bubbles: true, composed: true });
    e.detail = { entityId };
    this.dispatchEvent(e);
  }

  // The actions configured for an element of the schematic, the header or the drawer. A badge has its own, every other element
  // carries the actions of the entity key it shows (`actions: { dhw_top: … }`); without any, a tap opens more-info.
  _elementActs(ev) {
    const path = ev.composedPath();
    const pick = (cfg) => Object.fromEntries(HFC_ACTIONS.filter((a) => cfg && cfg[a]).map((a) => [a, cfg[a]]));
    const badge = path.find((n) => n.dataset && n.dataset.badge !== undefined);
    if (badge) { const b = this._badges[+badge.dataset.badge]; return b ? { entity: b.entity, ...pick(b) } : null; }
    const el = path.find((n) => n.dataset && n.dataset.entity);
    if (!el) return null;
    const id = el.dataset.entity;
    const own = Object.entries(this._config.actions || {}).find(([k]) => this._e[k] === id);
    return { entity: id, ...pick(own && own[1]) };
  }

  _actEvents(box) { this._pointerActions(box, (ev) => this._elementActs(ev)); }

  /* ---------- card tools ---------- */
  _wireTools() {
    this._$('diagnostic-copy')?.addEventListener('click', () => this._copyDiagnostic());
    this._$('fullscreen-toggle')?.addEventListener('click', () => (this._fullscreenOpen ? this._closeFullscreen() : this._openFullscreen()));
    this._$('fullscreen-backdrop')?.addEventListener('click', () => this._closeFullscreen());
  }

  async _writeClipboard(text) {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;left:-9999px;top:0';
    this.shadowRoot.appendChild(area); area.select();
    const copied = document.execCommand && document.execCommand('copy'); area.remove();
    if (!copied) throw new Error('Clipboard API unavailable');
  }

  async _copyDiagnostic() {
    const button = this._$('diagnostic-copy'); const status = this._$('tool-status');
    try {
      await this._writeClipboard(HeatpumpFlowCard._diagnosticReport(this._config, this._hass));
      if (status) status.textContent = this._i.diagnostic_copied;
      if (button) { button.classList.add('done'); button.title = this._i.diagnostic_copied; button.setAttribute('aria-label', this._i.diagnostic_copied); }
    } catch (err) {
      if (status) status.textContent = this._i.diagnostic_failed;
      if (button) { button.title = this._i.diagnostic_failed; button.setAttribute('aria-label', this._i.diagnostic_failed); }
    }
    clearTimeout(this._diagnosticTimer);
    this._diagnosticTimer = setTimeout(() => {
      const b = this._$('diagnostic-copy'); if (!b) return;
      b.classList.remove('done'); b.title = this._i.diagnostic_copy; b.setAttribute('aria-label', this._i.diagnostic_copy);
    }, 1800);
  }

  _openFullscreen() {
    if (this._fullscreenOpen || this._config.fullscreen === false) return;
    this._fullscreenOpen = true;
    this._bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    this._fullscreenKeyHandler = this._fullscreenKeyHandler || ((ev) => this._fullscreenKey(ev));
    document.addEventListener('keydown', this._fullscreenKeyHandler);
    this._render(); this._update();
    this._$('fullscreen-toggle')?.focus({ preventScroll: true });
  }

  _closeFullscreen(restoreFocus = true, render = true) {
    if (!this._fullscreenOpen) return;
    this._fullscreenOpen = false;
    document.removeEventListener('keydown', this._fullscreenKeyHandler);
    if (this._bodyOverflow !== undefined) { document.body.style.overflow = this._bodyOverflow; delete this._bodyOverflow; }
    if (render && this.shadowRoot && this._hass && this._config) { this._render(); this._update(); }
    if (restoreFocus) this._$('fullscreen-toggle')?.focus({ preventScroll: true });
  }

  _fullscreenKey(ev) {
    if (!this._fullscreenOpen) return;
    if (ev.key === 'Escape') { ev.preventDefault(); this._closeFullscreen(); return; }
    if (ev.key !== 'Tab') return;
    const card = this.shadowRoot.querySelector('ha-card');
    const focusable = [...card.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]')]
      .filter((el) => !el.hidden && el.getClientRects().length);
    if (!focusable.length) return;
    const current = this.shadowRoot.activeElement; const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (ev.shiftKey && (current === first || !card.contains(current))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && current === last) { ev.preventDefault(); first.focus(); }
  }

  // Wall display: the quick controls and the details toggle appear on a touch or mouse move and fade out again.
  _wallSeconds() {
    const t = this._config.wall_timeout;
    return t === undefined || t === null || t === '' ? HFC_WALL_TIMEOUT : +t;
  }
  _wake() {
    const card = this.shadowRoot && this.shadowRoot.querySelector('ha-card');
    if (!card) return;
    this._awake = true; card.classList.add('awake');
    clearTimeout(this._sleepTimer);
    const sec = this._wallSeconds();
    if (sec > 0) this._sleepTimer = setTimeout(() => this._sleep(), sec * 1000);
  }
  _sleep() {
    const card = this.shadowRoot && this.shadowRoot.querySelector('ha-card');
    if (!card) return;
    // Keep the controls while one of them is being used (an open dropdown, a number field).
    if (this.shadowRoot.activeElement && card.querySelector('.controls')?.contains(this.shadowRoot.activeElement)) { this._sleepTimer = setTimeout(() => this._sleep(), 2000); return; }
    this._awake = false; card.classList.remove('awake');
    const drawer = this._$('drawer-body');
    if (drawer && !drawer.hidden) { this._drawerOpen = false; drawer.hidden = true; this._$('drawer-toggle')?.setAttribute('aria-expanded', 'false'); }
  }
  disconnectedCallback() { clearTimeout(this._sleepTimer); clearTimeout(this._diagnosticTimer); this._closeFullscreen(false, false); }

  // Tiles: the actions of the tile under the pointer.
  _tileEvents(box) {
    this._pointerActions(box, (ev) => {
      const el = ev.composedPath().find((n) => n.dataset && n.dataset.tile !== undefined);
      return el ? this._tileActs?.[+el.dataset.tile] : null;
    });
  }

  // Tap, hold (500 ms) and double tap (within 250 ms, only waited for when configured).
  _pointerActions(box, actOf) {
    let timer = null; let held = false; let pending = null;
    box.addEventListener('pointerdown', (ev) => {
      const a = actOf(ev);
      held = false; clearTimeout(timer);
      if (a?.hold_action) timer = setTimeout(() => { held = true; this._tileAction(a, 'hold'); }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => box.addEventListener(t, () => clearTimeout(timer)));
    box.addEventListener('contextmenu', (ev) => { if (actOf(ev)?.hold_action) ev.preventDefault(); });
    // Keyboard: Enter or Space = tap, Shift+Enter = hold, Alt+Enter = double tap.
    box.addEventListener('keydown', (ev) => {
      if (['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;
      const act = ev.key === 'Enter' ? (ev.shiftKey ? 'hold' : ev.altKey ? 'double_tap' : 'tap') : (ev.key === ' ' || ev.key === 'Spacebar' ? 'tap' : null);
      if (!act) return;
      const a = actOf(ev);
      if (!a) return;
      ev.preventDefault();
      this._tileAction(a, act);
    });
    box.addEventListener('click', (ev) => {
      const a = actOf(ev);
      if (!a) return;
      if (held) { held = false; return; }
      if (!a.double_tap_action) { this._tileAction(a, 'tap'); return; }
      if (pending) { clearTimeout(pending); pending = null; this._tileAction(a, 'double_tap'); return; }
      pending = setTimeout(() => { pending = null; this._tileAction(a, 'tap'); }, 250);
    });
  }

  // Configured actions go to Home Assistant's action handler (hass-action), so all standard actions and confirmations work.
  _tileAction(a, action) {
    const cfg = a[`${action}_action`];
    if (!cfg) { if (action === 'tap' && a.entity) this._moreInfo(a.entity); return; }
    if (cfg.action === 'none') return;
    const e = new Event('hass-action', { bubbles: true, composed: true });
    e.detail = { config: a, action };
    this.dispatchEvent(e);
  }

  /* ---------- flow model ---------- */
  // One place decides how the water moves: the operating state of the heat pump, which side of the diverter valve is open, whether
  // the series buffer is bypassed, and which pipe, circuit and loop flows. `_update` only draws it. A new hydraulic variant adds its
  // paths here instead of new flags in the drawing code (docs/TOPOLOGY.md, stage 0b).
  _flowModel() {
    const P = this._parts;
    const rawMode = this._s('mode');
    const status = this._s('status') || '';
    let hp = this._norm(this._maps.mode, rawMode);
    const dhwMode = this._norm(this._maps.dhw, this._s('dhw_mode'));
    const bufMode = this._norm(this._maps.buffer, this._s('buffer_mode'));
    const power = this._w('power');
    const vol = this._lh('volume');
    // Compressor may be a binary sensor or a numeric one (frequency / speed > 0 means running).
    const compOn = this._has('compressor') && (this._on('compressor') || this._n('compressor') > 0);
    const running = compOn || power > this._threshold || this._runningStates.includes(status)
      || (!this._has('compressor') && !this._has('power') && !this._has('status') && ['heating', 'dhw', 'cooling', 'defrost'].includes(hp));
    const boilerRunning = !!P.boiler && this._boilerOn();
    const generatorMode = running ? (boilerRunning ? 'both' : 'hp_only') : (boilerRunning ? 'boiler_only' : 'idle');
    const generatorRunning = running || boilerRunning;
    const defrost = hp === 'defrost' || status.toUpperCase().includes('DEFROST') || (this._has('defrost') && this._on('defrost'));
    // Valve: binary (on = DHW) or a state such as "Tank" / "DHW".
    // A `valve_map` (raw state → dhw | heating) decides first, for valves that report 1 for heating or other texts.
    const valveMapped = this._has('valve') ? this._valveMapped(this._s('valve')) : undefined;
    const valveDhw = this._has('valve') ? (valveMapped ?? (this._on('valve') || ['tank', 'tank (dhw)', 'dhw', 'hot water', 'hot_water', 'warmwasser'].includes(String(this._s('valve')).toLowerCase())))
      : this._valveByFlow() && running && this._n('flow') > this._n('dhw_top');
    // Integrations without an operating-mode entity: a running compressor means heating unless the valve says DHW.
    // Defrost wins over a stopped compressor: it pauses for about a minute while the 4-way valve switches (HeishaMon).
    if (!this._has('mode')) hp = defrost ? 'defrost' : !running ? 'idle' : (valveDhw ? 'dhw' : 'heating');
    // A defrost entity wins over an operating mode that keeps reporting heating while the unit defrosts (e.g. Kronoterm).
    else if (this._has('defrost') && this._on('defrost') && ['heating', 'cooling', 'dhw'].includes(hp)) hp = 'defrost';
    // An operating mode that stays idle while the compressor runs (preset flag compressor_over_idle, ViCare #196).
    else if (hp === 'idle' && compOn && this._preset?.compressor_over_idle) hp = valveDhw ? 'dhw' : 'heating';
    const cooling = hp === 'cooling' || bufMode === 'cooling';

    const dhwActive = P.dhw && (hp === 'dhw' || ['dhw', 'legionella'].includes(dhwMode) || valveDhw);
    const toDhw = dhwActive && (generatorRunning || dhwMode === 'trailing' || hp === 'dhw');
    // The manually configured boiler feeds the same common flow as the heat pump. The existing valve remains the only routing
    // decision: boiler-only operation therefore goes to DHW when the valve says DHW, otherwise to the heating side. Without a drawn
    // tank a valve on DHW still closes the heating side, so the boiler does not move water through the circuits then.
    const toHeat = !toDhw && ((boilerRunning && !valveDhw) || ['heating', 'defrost', 'cooling'].includes(hp) || ['heating', 'cooling'].includes(bufMode));
    const loop = toDhw || toHeat;
    // The primary pump also runs without heating or hot water (Panasonic "sniffing", run-on): the water then circulates
    // slowly along the valve path (flow dashes 2000 / l/h seconds, 6 to 30 s). It only moves the water, so mode chip, valve text, spread and heat stay idle.
    const circ = this._primaryPump() && !loop && Number.isFinite(vol) && vol > 0;
    const flowDhw = toDhw || (circ && valveDhw && !!P.dhw);
    const flowHeat = toHeat || (circ && !flowDhw);
    const flowLoop = flowDhw || flowHeat;
    // Series buffer: the bypass valve follows its own entity, else the defrost signal, and then stops the circuits.
    // Without a bypass valve (series_bypass: false) the circuits keep running in defrost.
    const bypass = !!P.series && !this._noBypass() && (this._has('bypass_valve') ? this._on('bypass_valve') : defrost);

    // Circuits: own pump, else own mode, else they run whenever the heating side flows; a bypassed series buffer stops them all.
    const showHc = P.hc || this._hcCount > 1;
    const demand = showHc ? Array.from({ length: this._hcCount }, (_, x) => {
      const k = (key) => this._hk(x + 1, key);
      const mode = this._norm(this._maps.hc, this._s(k('mode')));
      return { mode, own: this._has(k('pump')) ? this._pumpOn(k('pump')) : (this._has(k('mode')) ? ['heating', 'cooling'].includes(mode) : null) };
    }) : [];
    // Without a parallel buffer the circuits and the heat pump are one water loop (#124). A running circuit pump moves the water
    // through the heat pump as well, unless the diverter valve stands on hot water and closes the heating side (also after a
    // charge, while the compressor is off). When the heat pump or its primary pump moves the water and no circuit pump runs, it
    // passes the circuits with their pumps standing still.
    const shared = !P.buffer;
    const heatClosed = flowDhw || (!!P.dhw && valveDhw);
    const pumped = shared && !heatClosed && !bypass && demand.some((c) => c.own === true);
    const heatLoop = flowHeat || pumped;
    const passive = shared && !demand.some((c) => c.own !== false);

    // Pipes by id (p-<id> and its flow f-<id>): the loop to the valve, then the open side of the valve.
    const pipes = {
      vl: flowLoop || pumped, rl: flowLoop || pumped, 'vl-dhw': flowDhw, 'rl-dhw': flowDhw,
      'vl-buf': heatLoop, 'rl-buf': heatLoop, 'byp-vl': heatLoop, 'byp-rl': heatLoop,
    };
    if (P.boiler) pipes.boiler = flowLoop || pumped;
    if (P.series) Object.assign(pipes, { 'sb-vl': heatLoop && !bypass, 'sb-a': heatLoop && bypass, 'sb-b': heatLoop && !bypass });
    // A fresh-water station on the buffer has no diverter valve: hot-water operation heats the buffer along the heating path.
    // Its own pipes do not animate, because the card does not know when water is drawn.
    if (P.station) Object.assign(pipes, { 'rl-buf': heatLoop || flowDhw });
    // Per circuit: `pump` turns the impeller, `on` moves the water through it (the two differ only in the shared loop).
    const circuits = demand.map(({ mode, own }, x) => {
      const n = x + 1; const s = n === 1 ? '' : String(n);
      const pump = !bypass && (own ?? heatLoop);
      const on = !shared ? pump : !bypass && heatLoop && (own !== false || passive);
      [`hc-vl${s}`, `hc-body${s}`, `hc-rl${s}`].forEach((id) => { pipes[id] = on; });
      return { n, mode, on, pump };
    });
    // Riser segment n feeds circuit n and every circuit below it, so it flows when any of them flows (#302).
    circuits.slice(1).forEach(({ n }) => { pipes[`hc-up${n}`] = pipes[`hc-down${n}`] = circuits.slice(n - 1).some((c) => c.on); });
    // With several circuits the first metres of flow and return feed all of them: they flow when any circuit flows.
    if (circuits.length > 1) { const trunk = circuits.some((c) => c.on); pipes['hc-trunk-vl'] = trunk; pipes['hc-trunk-rl'] = trunk; }
    // Ground and water sources: the source loop runs with the compressor.
    if (this._sourceType !== 'air') ['src', 'src-in', 'src-out'].forEach((id) => { pipes[id] = running; });
    // Solar thermal: the collector loop runs with the solar pump.
    const solar = !!P.solar && this._level('solar_pump') > 0;
    if (P.solar) { pipes.sol = solar; pipes['sol-rl'] = solar; }

    return {
      rawMode, status, hp, dhwMode, bufMode, power, vol, running, boilerRunning, generatorMode, generatorRunning, defrost, cooling, valveDhw,
      toDhw, toHeat, loop, circ, flowDhw, flowHeat, flowLoop, bypass, heatLoop,
      // The heat pump's own primary pump runs with a flow rate, else with the hot-water or heating loop.
      primaryPump: Number.isFinite(vol) ? vol > 0 : loop,
      // The DHW coil heats while the valve charges the tank.
      coil: toDhw,
      solar, circuits, pipes,
    };
  }

  /* ---------- update ---------- */
  _update() {
    if (!this._rendered || !this._hass || this._startState()) return;
    const i = this._i;
    const P = this._parts;
    const F = this._flowModel();
    const { rawMode, status, hp, dhwMode, bufMode, power, vol, running, boilerRunning, generatorMode, defrost, cooling, toDhw, toHeat, loop, flowLoop, bypass } = F;
    const tFlow = this._n('flow'); const tRet = this._n('return');
    const tBoiler = this._n('boiler_flow');
    const tCommonFlow = boilerRunning && Number.isFinite(tBoiler) ? tBoiler : tFlow;
    const spread = Number.isFinite(tFlow) && Number.isFinite(tRet) ? tFlow - tRet : NaN;

    // Heat output: sensor, or estimated from flow rate × spread × 1.163 Wh/(l·K) for water.
    let heat = this._kw('heat');
    let heatEstimated = false;
    if (!this._has('heat') && loop && running && vol > 0 && spread > 0) { heat = (vol * spread * 1.163) / 1000; heatEstimated = true; }

    // Animation speed: fan, flow dashes and pumps follow the compressor modulation when the integration reports it,
    // the flow dashes the flow rate, the fan otherwise the electrical power.
    const mod = this._speedFraction();
    const modOk = Number.isFinite(mod) && mod > 0;
    const speed = this._flowSpeed;
    const scaled = (seconds) => `${(seconds / speed).toFixed(2)}s`;
    // The dash speed is proportional to the flow rate: 1000 l/h is one dash cycle per second, sniffing a few l/h crawls.
    const dur = Number.isFinite(vol) && vol > 0 ? Math.min(Math.max(1000 / vol, 0.4), 30) : (modOk ? 2.6 - mod * 1.8 : 2);
    // A fan speed entity wins: the fan runs on after the compressor stops. Numeric values are rpm, else on/off.
    // An unavailable or unknown fan entity (integration offline, Home Assistant restart) counts as missing.
    const fanKnown = this._has('fan_speed') && !['unavailable', 'unknown'].includes(String(this._s('fan_speed')).toLowerCase());
    const fanRpm = fanKnown ? this._n('fan_speed') : NaN;
    const fanOn = fanKnown ? (Number.isFinite(fanRpm) ? fanRpm > 0 : this._on('fan_speed')) : running;
    const fanDur = !fanOn ? 0 : Number.isFinite(fanRpm) ? Math.min(Math.max(2.4 - fanRpm / 500, 0.5), 2.4)
      : (modOk ? 2.4 - mod * 1.9 : Math.min(Math.max(2.4 - (power || 0) / 1500, 0.5), 2.4));
    const pumpDur = modOk ? 1.8 - mod * 1.2 : 1.2;
    // Flow dashes, fans and pumps change their speed with every new sensor value: they get it as a playback rate (_speeds).
    this._speedDurs = {
      flow: dur / speed, fan: fanDur / speed, pump: pumpDur / speed,
      primary: (Number.isFinite(vol) && vol > 0 ? Math.min(Math.max(800 / vol, 0.6), 30) : pumpDur) / speed,
    };
    this.style.setProperty('--hfc-electrical', scaled(1.1));
    this.style.setProperty('--hfc-coil', scaled(1.4));
    this.style.setProperty('--hfc-snow', scaled(1.6));
    this.style.setProperty('--hfc-vapour', scaled(2.2));
    this.style.setProperty('--hfc-wave', scaled(2.4));
    this.style.setProperty('--hfc-wave-delay', scaled(0.8));
    this.style.setProperty('--hfc-wave-delay2', scaled(1.6));

    // pipes
    const cFlow = defrost || cooling ? hfcVar('defrost') : this._vlColor(tCommonFlow);
    const cRet = this._rlColor(tRet);
    const stroke = (id, c) => { const el = this._$(`p-${id}`); if (el) el.style.setProperty('--pc', c); };
    ['vl', 'vl-dhw', 'vl-buf', 'byp-vl'].forEach((id) => stroke(id, cFlow));
    ['rl', 'rl-dhw', 'rl-buf', 'byp-rl'].forEach((id) => stroke(id, cRet));
    const pipe = (id, on) => { this._cls(`p-${id}`, on); this._cls(`f-${id}`, on); };
    Object.entries(F.pipes).forEach(([id, on]) => pipe(id, on));
    // The primary pump's speed follows the flow rate, so a sniffing pump with a few l/h turns slowly.
    this._cls('impeller-primary', F.primaryPump);
    if (P.series) {
      stroke('sb-vl', cFlow); stroke('sb-a', cFlow); stroke('sb-b', cRet);
      this._$('sb-arrow')?.setAttribute('d', bypass ? 'M600 481 V495 H586 M593 488 L586 495 L593 502' : 'M614 495 H586 M593 488 L586 495 L593 502');
      this._$('sb-tank')?.style.setProperty('fill', `color-mix(in oklch, ${cRet} 30%, var(--card-background-color, #fff))`);
      this._txt('t-bypass', bypass ? i.bypass : '');
    }
    this._cls('coil', F.coil);
    // Fresh-water station: hot from the top of the storage, cooled back.
    if (P.dhwType === 'fresh_water') {
      const top = P.station ? 'buffer_top' : 'dhw_top'; const bottom = P.station ? 'buffer_bottom' : 'dhw_bottom';
      stroke('fws-a', this._vlColor(this._n(top))); stroke('fws-b', this._rlColor(this._n(bottom)));
    }

    if (P.hc || this._hcCount > 1) {
      const pick = (...v) => v.find((x) => Number.isFinite(x)) ?? NaN;
      // The shared trunk carries the water before it splits. An explicitly drawn, unmeasured buffer decouples the circuits, so
      // heat-pump temperatures are not copied to its circuit side; own circuit sensors still colour that side below.
      const measuredBuffer = !P.configuredBuffer || ['buffer_top', 'buffer_middle', 'buffer_bottom'].some((k) => this._has(k));
      stroke('hc-trunk-vl', this._vlColor(measuredBuffer ? pick(this._n('buffer_top'), tCommonFlow) : NaN)); stroke('hc-trunk-rl', this._rlColor(measuredBuffer ? pick(this._n('buffer_bottom'), tRet) : NaN));
      for (const { n, mode: cMode, on: hcOn, pump: hcPump } of F.circuits) {
        const k = (key) => this._hk(n, key);
        const s = n === 1 ? '' : String(n);
        // Without circuit sensors fall back to the buffer / main loop temperatures.
        const tHc = pick(this._n(k('flow')), ...(measuredBuffer ? [this._n('buffer_top'), tCommonFlow] : []));
        const tHcR = pick(this._n(k('return')), ...(measuredBuffer ? [this._n('buffer_bottom'), tRet] : []));
        const cHc = cMode === 'cooling' ? hfcVar('defrost') : this._vlColor(tHc);
        stroke(`hc-vl${s}`, cHc); stroke(`hc-body${s}`, cHc); stroke(`hc-rl${s}`, this._rlColor(tHcR));
        if (n > 1) { stroke(`hc-up${s}`, cHc); stroke(`hc-down${s}`, this._rlColor(tHcR)); }
        if (this._hasMixer(n)) this._updateMixer(n, hcOn, this._rlColor(tHcR));
        const rt = this._$(`g-rad${s}-top`); const rb = this._$(`g-rad${s}-bottom`);
        if (rt) { rt.setAttribute('stop-color', hcOn ? cHc : 'var(--disabled-text-color, #9e9e9e)'); rb.setAttribute('stop-color', hcOn ? this._rlColor(tHcR) : 'var(--disabled-text-color, #9e9e9e)'); }
        // The heating surface fades from the flow colour to the return colour; one colour when the temperatures do not differ.
        const grad = hcOn && cMode !== 'cooling' && Number.isFinite(tHc) && Number.isFinite(tHcR) && Math.abs(tHc - tHcR) >= 0.5;
        const ga = this._$(`g-hcb${s}-a`); const gm = this._$(`g-hcb${s}-m`); const gb = this._$(`g-hcb${s}-b`); const body = this._$(`p-hc-body${s}`);
        if (ga && gb && body) {
          if (grad) { const rc = this._rlColor(tHcR); ga.setAttribute('stop-color', cHc); gb.setAttribute('stop-color', rc); gm.setAttribute('stop-color', `color-mix(in oklch, ${rc} 50%, ${cHc})`); }
          body.style.stroke = grad ? `url(#g-hcb${s})` : '';
        }
        this._cls(`impeller${s}`, hcPump);
        // Without a buffer heat reaches the emitter only while the heat pump heats: sniffing or a circuit pump alone only move the water.
        this._cls(`waves${s}`, hcOn && cMode !== 'cooling' && (!!P.buffer || toHeat));
        const set = this._n(k('setpoint'));
        const showFlow = this._hcFlowLabel && (this._has(k('flow')) || (n === 1 && !P.buffer && this._has('flow')));
        const hcVol = this._lh(k('volume'));
        const ownFlow = this._e[k('flow')];
        // A configured circuit sensor that is unavailable is unknown, not a license to assess condensation from the warmer
        // buffer/common trunk. Only a direct first circuit with no own sensor inherits the heat-pump flow for this calculation.
        const dewFlow = ownFlow ? this._tempC(k('flow')) : (n === 1 && !P.buffer ? this._tempC('flow') : NaN);
        const dew = this._dewPoint(n); const circuitCooling = cooling || cMode === 'cooling';
        const dewKnown = circuitCooling && Number.isFinite(dewFlow) && Number.isFinite(dew);
        const dewMargin = dewKnown ? dewFlow - dew : NaN;
        const configuredDewMargin = this._config.dew_point_margin;
        const minimumDewMargin = configuredDewMargin === undefined || configuredDewMargin === null || configuredDewMargin === '' ? 2 : +configuredDewMargin;
        const dewWarning = dewKnown && dewMargin < minimumDewMargin;
        this._txt(`t-hc-vol${s}`, this._has(k('volume')) && Number.isFinite(hcVol) ? `${this._fmt(hcVol, 0)} l/h` : '');
        if (this._$(`t-hc-now${s}`)) {
          // Heating curve shift: "Target 36 °C (curve 34 °C + 2 K shift)" above the pump, the flow temperature below it.
          // Only the circuit's own flow sensor: the heat pump's flow already stands at the VL label.
          // The dew-point warning keeps its flow value with hc_flow_label: false, because the margin needs it.
          this._txt(`t-hc-now${s}`, dewKnown ? `${i.flow_short} ${this._t(dewFlow)}` : (this._hcFlowLabel && this._has(k('flow')) ? this._t(tHc) : ''));
          if (dewKnown) {
            const label = this._$(`t-hc${s}`); if (label) label._k = '';
            this._txt(`t-hc${s}`, `${i.dew_point} ${this._t(dew)}`);
          } else this._hcTarget(n, set, this._n(k('curve_offset')), this._unit(k('curve_offset')));
        } else {
          this._txt(`t-hc${s}`, dewKnown ? `${i.flow_short} ${this._t(dewFlow)} · ${i.dew_point} ${this._t(dew)}`
            : showFlow ? `${this._t(tHc)}${Number.isFinite(set) ? ` · ${i.target} ${this._fmt(set)}` : ''}`
              : !this._hcFlowLabel && Number.isFinite(set) ? `${i.target} ${this._fmt(set)}` : '');
        }
        [`t-hc${s}`, `t-hc-now${s}`].forEach((id) => {
          const label = this._$(id); if (!label) return;
          label.classList.toggle('dew-warning', dewWarning);
          const accessible = dewKnown ? `${i.flow_short} ${this._t(dewFlow)}, ${i.dew_point} ${this._t(dew)}, ${i.dew_margin} ${this._fmt(dewMargin)} K${dewWarning ? `, ${i.dew_warning}` : ''}` : '';
          const tap = label.closest('[data-entity]');
          if (accessible) {
            label.dataset.a11y = accessible;
            if (tap) tap.dataset.a11y = accessible;
          } else {
            delete label.dataset.a11y;
            if (tap) delete tap.dataset.a11y;
          }
        });
        // Own return sensor of the circuit only; the fallback to the buffer or heat pump return would repeat another label.
        if (this._config.hc_return_label) this._txtPre(`t-hc-rl${s}`, i.return_short, this._has(k('return')) && Number.isFinite(this._n(k('return'))) ? this._t(this._n(k('return'))) : '');
        this._hcStatus(n, this._has(k('mode')) ? this._modeLabel(cMode, this._s(k('mode'))) : (hcPump ? i.running : ''));
        if (n === 1 && this._has('hc_pressure')) this._updatePressure('hc_pressure', 'hc', 'pressure-hc', 't-hc-pressure', i.hc_pressure);
      }
    }

    // solar thermal: collector temperature, loop animated while the solar pump runs
    if (P.solar) {
      const tc = this._n('solar_collector');
      stroke('sol', this._vlColor(tc)); stroke('sol-rl', this._rlColor(this._n('dhw_bottom')));
      this._cls('coil-sol', F.solar); this._cls('solar', F.solar);
      this._txt('t-sol', Number.isFinite(tc) ? this._t(tc) : i.solar);
    }

    // heaters
    [['heater', 'inline'], ...this._tankHeaters('dhw'), ...this._tankHeaters('buffer')].forEach(([key, id]) => {
      const el = this._$(`heater-${id}`); if (!el) return;
      const lv = this._level(key);
      el.classList.toggle('on', lv > 0); el.classList.toggle('stage2', lv > 1);
      el.querySelector('.waves')?.classList.toggle('on', lv > 0);
    });

    if (P.boiler) {
      this._cls('boiler', boilerRunning);
      const boilerPower = this._w('boiler_power');
      this._txt('t-boiler-power', boilerRunning
        ? (Number.isFinite(boilerPower) && boilerPower > 0 ? `${this._fmt(boilerPower >= 1000 ? boilerPower / 1000 : boilerPower, boilerPower >= 1000 ? 1 : 0)} ${boilerPower >= 1000 ? 'kW' : 'W'}` : i.running)
        : i.boiler_off);
      this._txt('t-boiler-flow', this._has('boiler_flow') ? this._t(tBoiler) : '');
      const boiler = this._$('boiler');
      if (boiler) {
        const state = { hp_only: `${i.heat_pump}: ${i.running}; ${i.boiler_off}`, boiler_only: `${i.heat_pump}: ${i.compressor_off}; ${i.boiler}: ${i.running}`, both: `${i.heat_pump}: ${i.running}; ${i.boiler}: ${i.running}`, idle: `${i.compressor_off}; ${i.boiler_off}` }[generatorMode];
        const values = [state, this._has('boiler_power') && Number.isFinite(boilerPower) ? `${this._fmt(boilerPower, 0)} W` : '', this._has('boiler_flow') ? this._t(tBoiler) : ''].filter(Boolean);
        boiler.dataset.a11y = values.join(', ');
      }
    }

    this._txtPre('t-vl', 'VL', this._has('flow') ? this._t(tFlow) : '');
    this._txtPre('t-rl', 'RL', this._has('return') ? this._t(tRet) : '');
    this._txt('t-vol', this._has('volume') && flowLoop && Number.isFinite(vol) ? `${this._fmt(vol, 0)} l/h` : '');

    // heat pump
    this._cls('fan', fanOn); this._cls('fan2', fanOn);
    this._cls('snow', defrost && this._sourceType === 'air'); this._cls('snow2', defrost && this._sourceType === 'air'); this._cls('vapour', defrost && this._sourceType === 'air'); this._cls('hp-box', running);
    const hpBox = this._$('hp-box');
    if (hpBox) {
      ['dhw', 'defrost', 'cool'].forEach((c) => hpBox.classList.remove(c));
      const tone = defrost ? 'defrost' : cooling ? 'cool' : toDhw ? 'dhw' : '';
      if (tone) hpBox.classList.add(tone);
    }
    // Some integrations report "heating" while charging DHW (e.g. ViCare compressor phase); the valve decides.
    const shownMode = toDhw && ['heating', 'idle', ''].includes(hp) ? 'dhw' : hp;
    const modeTxt = this._modeLabel(shownMode, rawMode);
    const sl = (this._statusLabels[this._lang] || this._statusLabels.en || {})[status];
    this._hpStatus(`${modeTxt}${running && sl ? ` · ${sl}` : ''}`);
    const heatTxt = Number.isFinite(heat) ? `${heatEstimated ? '≈' : ''}${this._fmt(heat, 1)} kW` : '';
    this._txt('t-hp-power', running
      ? (Number.isFinite(power) ? `${this._fmt(power, 0)} W${heatTxt ? ` → ${heatTxt}` : ''}` : (heatTxt || i.running))
      : i.compressor_off);
    const cop = running && power > 50 && heat > 0 && this._sumComplete('power') && this._sumComplete('heat') ? (heat * 1000) / power : NaN;
    this._txt('t-hp-cop', Number.isFinite(cop) ? `COP ${heatEstimated ? '≈' : ''}${this._fmt(cop, 1)}` : '');
    const hpHeat = this._$('t-hp-heat');
    if (hpHeat) {
      this._txt('t-hp-heat', running ? (heatTxt || (Number.isFinite(power) ? `${this._fmt(power, 0)} W` : i.running)) : i.compressor_off);
      hpHeat.classList.toggle('off', !running);
    }
    const srcVol = this._lh('source_volume');
    const srcParts = [];
    if (this._has('source_in')) srcParts.push(`${i.source_in} ${this._t(this._n('source_in'))}`);
    if (this._has('source_volume') && srcVol > 0) srcParts.push(`${i.source_flow} ${this._fmt(srcVol, 0)} l/h`);
    if (this._sourceType === 'air') { this._txt('t-src-in', srcParts.join(' · ')); this._$('t-outdoor-hp')?.setAttribute('y', srcParts.length ? 472 : 450); }
    else {
      const brine = this._sourceType === 'brine';
      this._txt('t-src-in', this._has('source_in') ? `${brine ? i.brine_in : i.well_in} ${this._t(this._n('source_in'))}` : '');
      this._txt('t-src-out', this._has('source_out') ? `${brine ? i.brine_out : i.well_out} ${this._t(this._n('source_out'))}` : '');
      const sourceSpread = this._n('source_in') - this._n('source_out');
      this._txt('t-src-spread', this._sourceSpread && running && Number.isFinite(sourceSpread) ? `ΔT ${this._fmt(sourceSpread)} K` : '');
      this._txt('t-src-vol', this._has('source_volume') && srcVol > 0 ? `${this._fmt(srcVol, 0)} l/h` : '');
      if (brine && this._has('brine_pressure')) this._updatePressure('brine_pressure', 'brine', 'pressure-brine', 't-brine-pressure', i.brine_pressure);
    }

    // valve + tanks
    if (P.dhw) {
      const arrow = this._$('valve-arrow');
      if (arrow) arrow.setAttribute('transform', toDhw ? '' : 'rotate(180 420 250)');
      this._txt('t-valve', loop ? (toDhw ? i.valve_dhw : (cooling ? i.valve_cooling : i.valve_heating)) : '');
      // Without a top sensor the large value stays empty: the lower sensors show their value at their own position.
      const hasTop = this._has('dhw_top');
      const middle = this._has('dhw_middle') ? this._n('dhw_middle') : NaN;
      const top = hasTop ? this._n('dhw_top') : NaN;
      // A lower sensor says nothing reliable about the water above it. Keep an unmeasured upper zone neutral instead of
      // painting the whole tank with a cool middle/bottom value (#215). With a measured top, the old two-point fallback stays.
      const bot = this._has('dhw_bottom') ? this._n('dhw_bottom') : Number.isFinite(middle) ? middle : top - 5;
      this._$('g-dhw-top').setAttribute('stop-color', this._tankColor(top));
      if (this._has('dhw_middle')) this._$('g-dhw-middle')?.setAttribute('stop-color', this._tankColor(middle));
      this._$('g-dhw-bottom').setAttribute('stop-color', this._tankColor(bot));
      this._txt('t-dhw-top', hasTop ? this._t(top) : '');
      this._txt('t-dhw-middle', this._has('dhw_middle') ? this._t(this._n('dhw_middle')) : '');
      // Each value stands at the height of its sensor, so it needs no position word.
      this._txt('t-dhw-bottom', this._has('dhw_bottom') ? this._t(this._n('dhw_bottom')) : '');
      const tgt = this._n('dhw_target');
      const parts = [];
      if (this._has('dhw_mode')) parts.push(this._modeLabel(dhwMode, this._s('dhw_mode')));
      if (Number.isFinite(tgt)) parts.push(`${i.target} ${this._fmt(tgt, 0)} °C`);
      this._txt('t-dhw-mode', parts.join(' · '));
      const circProgram = this._circulationProgram();
      this._txt('t-circ', P.circ ? `↻ ${i.circulation}${circProgram ? ` ${circProgram}` : ''}` : '');
      this._cls('t-circ', this._on('circulation'));
    }
    if (P.buffer) {
      const top = this._n('buffer_top'); const bot = this._has('buffer_bottom') ? this._n('buffer_bottom') : top - 5;
      this._$('g-buf-top').setAttribute('stop-color', this._tankColor(top));
      if (this._has('buffer_middle')) this._$('g-buf-middle')?.setAttribute('stop-color', this._tankColor(this._n('buffer_middle')));
      this._$('g-buf-bottom').setAttribute('stop-color', this._tankColor(bot));
      // A combined storage or explicitly configured buffer may have no sensor in its heating zone: it stays neutral and empty.
      this._txt('t-buf-top', this._has('buffer_top') ? this._t(top) : '');
      this._txt('t-buf-middle', this._has('buffer_middle') ? this._t(this._n('buffer_middle')) : '');
      this._txt('t-buf-bottom', this._has('buffer_bottom') ? this._t(this._n('buffer_bottom')) : '');
      this._txt('t-buf-mode', this._has('buffer_mode') ? this._modeLabel(bufMode, this._s('buffer_mode')) : '');
    }

    // Combined storage: one gradient over every sensor at its height.
    // A sensor without a value (unavailable) takes the colour of the nearest sensor with one, so the tank shows no grey band.
    if (P.combined) {
      const cs = this._combinedSensors().map(([k, y]) => ({ k, y, t: this._n(k) }));
      const known = cs.filter((c) => Number.isFinite(c.t));
      cs.forEach((c) => {
        const near = Number.isFinite(c.t) ? c : known.reduce((a, b) => (!a || Math.abs(b.y - c.y) < Math.abs(a.y - c.y) ? b : a), null);
        this._$(`g-cs-${c.k}`)?.setAttribute('stop-color', this._tankColor(near ? near.t : NaN));
      });
    }

    // house
    if (P.house) {
      if (this._hcCount === 1) {
        const rt = this._n('room_target'); const r = this._n('room');
        const tgt = Number.isFinite(rt) ? `${i.target} ${this._fmt(rt)} °C` : '';
        const humidity = this._roomHumidity(1); const humidityText = Number.isFinite(humidity) ? `${i.humidity} ${this._fmt(humidity, 0)} %` : '';
        // Room sensor missing or unknown: promote the target to the big line.
        this._txt('t-room', Number.isFinite(r) ? this._t(r) : tgt);
        const target = Number.isFinite(r) ? tgt : '';
        this._txtTail('t-room-target', target, humidityText ? `${target ? ' · ' : ''}${humidityText}` : '');
      } else {
        for (let n = 1; n <= this._hcCount; n++) {
          const s = n === 1 ? '' : String(n); const key = this._roomKey(n); const targetKey = this._roomKey(n, 'room_target');
          const r = this._n(key); const rt = this._n(targetKey); const value = (x) => (Number.isFinite(x) ? this._fmt(x) : '–');
          const hasRoom = !!this._e[key]; const hasTarget = !!this._e[targetKey];
          const humidity = this._roomHumidity(n); const humidityText = Number.isFinite(humidity) ? `${this._fmt(humidity, 0)} %` : '';
          const temperatures = hasRoom && hasTarget ? `${value(r)} / ${value(rt)} °C` : hasRoom ? `${value(r)} °C` : hasTarget ? `${i.target} ${value(rt)} °C` : '';
          if (temperatures || !humidityText) this._txtTail(`t-house-room${s}`, temperatures || '–', humidityText ? ` · ${humidityText}` : '');
          else this._txtTail(`t-house-room${s}`, '', humidityText);
          const state = Number.isFinite(r) && Number.isFinite(rt) ? (r < rt - 0.5 ? 'below' : r > rt + 0.5 ? 'above' : 'on') : 'unknown';
          const dot = this._$(`house-comfort${s}`); const row = this._$(`house-row${s}`);
          if (dot) dot.setAttribute('class', `house-comfort ${state}`);
          if (row) {
            const comfort = state === 'unknown' ? '' : i[`comfort_${state}`];
            row.dataset.a11y = `${row.dataset.name}: ${hasRoom ? `${i.room} ${value(r)} °C` : ''}${hasRoom && hasTarget ? ', ' : ''}${hasTarget ? `${i.target} ${value(rt)} °C` : ''}${humidityText ? `${hasRoom || hasTarget ? ', ' : ''}${i.humidity} ${humidityText}` : ''}${comfort ? `; ${comfort}` : ''}`;
          }
        }
      }
    }
    const outTxt = this._has('outdoor') ? `${i.outdoor} ${this._t(this._n('outdoor'))}` : '';
    this._txt('t-outdoor', outTxt); this._txt('t-outdoor-hp', outTxt);

    // power sources
    if (P.power) {
      const split = P.power === 'energy' ? this._energySplit() : null;
      [['pv', 'pv', i.pv], ['bat', 'battery', i.battery], ['grid', 'grid', i.grid]].forEach(([id, key, label]) => {
        const w = P.power === 'energy' ? (split ? split[key] : NaN) : this._w(key); const on = w > 10;
        this._cls(`ef-${id}`, on); this._cls(`src-${id}`, on);
        this._txt(`t-src-${id}`, label);
        this._txt(`t-src-${id}-v`, on ? `${P.power === 'energy' ? '≈' : ''}${this._fmt(w, 0)} W` : '');
      });
    }
    if (this._$('focus-line')) this._focusLine(srcParts);

    // header chips
    const chip = this._$('chip-mode');
    chip.textContent = `${modeTxt}${running ? ` · ${i.running}` : ''}`;
    chip.className = `chip mode-${defrost ? 'defrost' : cooling ? 'cool' : toDhw ? 'dhw' : toHeat ? 'heat' : 'idle'}`;
    this._badges.forEach((b, n) => this._cls(`chip-b${n}`, ['on', 'true', 'home', 'open', 'ein'].includes(String(this._hass.states[b.entity]?.state).toLowerCase())));
    const errs = this._errors.filter((id) => {
      const state = this._hass.states[id]?.state;
      if (state === undefined) return false;
      const raw = String(state).trim(); const normalized = raw.toLowerCase(); const value = Number(raw);
      if (Number.isFinite(value)) return value !== 0;
      if (normalized === 'on') return true;
      if (['unknown', 'unavailable', 'off', ''].includes(normalized)) return false;
      return this._errorOk.length > 0 && !this._errorOk.includes(normalized);
    });
    const prog = this._program();
    const pc = this._$('chip-program');
    const progKind = prog && prog.kind !== 'none' ? prog.kind : '';
    if (pc._kind !== progKind) {
      pc._kind = progKind;
      pc.className = `chip program${progKind ? ` on ${progKind}` : ''}`;
      pc.innerHTML = progKind ? `${HFC_PROGRAM_ICONS[progKind]}${this._esc(i.programs[progKind])}` : '';
    }
    if (progKind) pc.dataset.entity = prog.entity;
    this._cls('chip-pv', this._pvBoost());
    const sg = this._has('sg_ready') ? this._sgReadyState() : '';
    const sgChip = this._$('chip-sg');
    const sgKind = sg && sg !== 'normal' ? sg : '';
    if (sgChip._kind !== sgKind) {
      sgChip._kind = sgKind;
      sgChip.className = `chip sg-ready${sgKind ? ` on ${sgKind}` : ''}`;
      sgChip.innerHTML = sgKind ? `${HFC_SG_READY_ICONS[sgKind]}${this._esc(i.sg_ready[sgKind])}` : '';
    }
    if (sgKind) sgChip.dataset.entity = this._e.sg_ready; else delete sgChip.dataset.entity;
    const err = this._$('chip-err');
    err.classList.toggle('on', errs.length > 0);
    if (errs.length) err.dataset.entity = errs[0];

    // statistics: the tile catalog when `tiles` is set, otherwise the default tiles
    const share = this._n('pv_share_today');
    const custom = Array.isArray(this._config.tiles);
    const tiles = custom ? this._catalogTiles({ loop, flowLoop, spread, vol, heat, heatEstimated, power, cop, circuits: F.circuits }) : [];
    const add = (key, label, value) => { if (!custom && this._has(key)) tiles.push([this._statLabel(key, label), value, this._e[key]]); };
    add('cop_heating_today', i.stat_cop_heating, this._fmt(this._n('cop_heating_today'), 2));
    add('cop_dhw_today', i.stat_cop_dhw, this._fmt(this._n('cop_dhw_today'), 2));
    add('energy_today', i.stat_energy, `${this._fmt(this._n('energy_today'), 1)} kWh${Number.isFinite(share) ? ` · ${this._fmt(share, 0)} % ${i.pv_share}` : ''}`);
    add('starts_today', i.stat_starts, this._fmt(this._n('starts_today'), 0));
    if (!custom && this._has('flow') && this._has('return')) tiles.push([i.stat_spread, loop && Number.isFinite(spread) ? `${this._fmt(spread, 1)} K` : '–', this._e.flow]);
    add('volume', i.stat_volume, flowLoop && Number.isFinite(vol) ? `${this._fmt(vol, 0)} l/h` : '–');
    if (!custom && heatEstimated) tiles.push([i.stat_heat, `≈${this._fmt(heat, 1)} kW`, this._e.volume]);
    (this._config.stats || []).forEach((s) => {
      const st = this._hass.states[s.entity]; if (!st) return;
      const v = parseFloat(st.state);
      const unit = s.unit ?? st.attributes.unit_of_measurement ?? '';
      tiles.push([s.name || st.attributes.friendly_name || s.entity, Number.isFinite(v) ? `${this._fmt(v, s.decimals ?? 1)} ${unit}`.trim() : st.state, s.entity, s]);
    });
    // Actions per tile (default: more-info of the tile's entity).
    this._tileActs = tiles.map(([, , id, s]) => ({ entity: id, ...Object.fromEntries(HFC_ACTIONS.filter((a) => s && s[a]).map((a) => [a, s[a]])) }));
    const html = tiles.map(([l, v, id], n) => `<div class="stat" data-tile="${n}" data-entity="${this._esc(id)}"><div class="sv">${this._esc(v)}</div><div class="sl">${this._esc(l)}</div></div>`).join('');
    const box = this._$('stats');
    if (box._html !== html) {
      const had = this.shadowRoot.activeElement?.dataset?.tile;
      box.innerHTML = html; box._html = html; box.style.display = tiles.length ? '' : 'none';
      this._a11y(true);
      if (had !== undefined) box.querySelector(`[data-tile="${had}"]`)?.focus();
    }
    this._speeds();
    this._updateControls();
    this._updateDrawer();
    this._updateTimeline();
    this._a11y();
  }

  // The speed-driven animations run for 1 s in the stylesheet; the card sets their speed as the playback rate, after the
  // `on` classes of this update have started or stopped them. updatePlaybackRate() keeps the current position. A new
  // animation-duration would move a running animation to another point of its cycle, so the flow dashes jumped with
  // every new flow rate and seemed to flow backwards for a moment.
  _speeds() {
    const d = this._speedDurs;
    if (!d) return;
    const set = (el, seconds) => {
      if (!el?.getAnimations || !(seconds > 0)) return;
      el.getAnimations().forEach((a) => { if (a._hfcRate !== 1 / seconds) { a._hfcRate = 1 / seconds; a.updatePlaybackRate(1 / seconds); } });
    };
    const all = (sel) => this.shadowRoot.querySelectorAll(sel);
    all('.flow').forEach((el) => set(el, d.flow));
    all('.fan').forEach((el) => set(el, d.fan));
    all('.impeller').forEach((el) => set(el, el.id === 'impeller-primary' ? d.primary : d.pump));
  }
}

HeatpumpFlowCard.styles = `
  :host { display: block; --hfc-muted: var(--secondary-text-color, #888); }
  ha-card { padding: 12px 12px 8px; overflow: hidden; background: var(--card-background-color, #fff); }
  .fullscreen-backdrop { position: fixed; inset: 0; z-index: 2147483645; background: rgba(0,0,0,.62); }
  ha-card.fullscreen { position: fixed; inset: 0; z-index: 2147483646; box-sizing: border-box; width: 100vw; height: 100dvh; margin: 0;
    border-radius: 0; overflow: auto; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
  @media (min-width: 1640px) and (min-height: 800px) { ha-card.fullscreen { inset: 20px; width: min(1600px, calc(100vw - 40px)); height: calc(100dvh - 40px); margin: auto; border-radius: 14px; } }
  .theme-night { color-scheme: dark; --card-background-color: #111827; --primary-text-color: #e5e7eb; --secondary-text-color: #94a3b8;
    --secondary-background-color: #1e293b; --divider-color: #475569; --hfc-muted: #94a3b8; --hfc-heat: #c8783d; --hfc-hot: #c75b5b;
    --hfc-cool: #5795ad; --hfc-cool-strong: #4387a3; --hfc-defrost: #79aabd; --hfc-pv: #c79336; --hfc-battery: #3f9b78;
    --hfc-grid: #7f8a9a; --hfc-good: #4f9c5a; --hfc-badge: #9263b5; --hfc-brine: #668fc4; --hfc-ground: #8f6a35;
    --hfc-flow-cold: #c47742; --hfc-flow-hot: #b64c4c; --hfc-return-cold: #6b9fb4; --hfc-return-hot: #486eaa;
    --hfc-tank-cold: #486eaa; --hfc-tank-cool: #3e91a4; --hfc-tank-warm: #c8783d; --hfc-tank-hot: #c75b5b; --hfc-flow-dash: rgba(255,255,255,.72); }
  .theme-contrast { color-scheme: light; --card-background-color: #fff; --primary-text-color: #000; --secondary-text-color: #111;
    --secondary-background-color: #fff; --divider-color: #000; --hfc-muted: #111; --hfc-heat: #a83a00; --hfc-hot: #a40000;
    --hfc-cool: #006b8f; --hfc-cool-strong: #00506b; --hfc-defrost: #00749a; --hfc-pv: #8a5b00; --hfc-battery: #006b3c;
    --hfc-grid: #333; --hfc-good: #006b28; --hfc-badge: #5d2483; --hfc-brine: #0057b8; --hfc-ground: #664000;
    --hfc-flow-cold: #b84f00; --hfc-flow-hot: #a40000; --hfc-return-cold: #00749a; --hfc-return-hot: #003f9e;
    --hfc-tank-cold: #003f9e; --hfc-tank-cool: #006b8f; --hfc-tank-warm: #b84f00; --hfc-tank-hot: #a40000; --hfc-flow-dash: #fff; }
  .theme-contrast .pipe { stroke-width: 11; } .theme-contrast .unit, .theme-contrast .tank, .theme-contrast .house,
  .theme-contrast .src-ring, .theme-contrast .pump { stroke-width: 3; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin: 0 4px 4px; }
  .head-right { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
  .card-tools { display: inline-flex; align-items: center; gap: 3px; }
  .icon-button { width: 30px; height: 30px; padding: 5px; border: 1px solid transparent; border-radius: 7px; color: var(--hfc-muted); background: transparent; cursor: pointer; }
  .icon-button:hover { border-color: var(--divider-color, rgba(127,127,127,.35)); background: var(--secondary-background-color, rgba(127,127,127,.12)); }
  .icon-button.done { color: ${hfcVar('good')}; }
  .icon-button svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .title { font-size: 1.15em; font-weight: 600; color: var(--primary-text-color); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { cursor: pointer; font-size: .82em; padding: 3px 10px; border-radius: 999px; background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--primary-text-color); white-space: nowrap; }
  .chip.mode-heat { background: ${hfcTint('heat', 18)}; color: ${hfcInk('heat')}; }
  .chip.mode-dhw { background: ${hfcTint('hot', 16)}; color: ${hfcInk('hot')}; }
  .chip.mode-defrost, .chip.mode-cool { background: ${hfcTint('cool', 20)}; color: ${hfcInk('cool')}; }
  .chip.badge, .chip.err, .chip.program, .chip.pvboost, .chip.sg-ready { display: none; }
  .chip.program.on { display: inline-block; }
  .chip.pvboost.on { display: inline-block; background: ${hfcTint('pv', 20)}; color: ${hfcInk('pv')}; }
  .chip.sg-ready.on { display: inline-block; }
  .chip.sg-ready.blocked { background: ${hfcTint('hot', 20)}; color: ${hfcInk('hot')}; }
  .chip.sg-ready.boost { background: ${hfcTint('pv', 20)}; color: ${hfcInk('pv')}; }
  .chip.sg-ready.forced { background: ${hfcTint('heat', 20)}; color: ${hfcInk('heat')}; }
  .chip.program.eco { background: ${hfcTint('good', 18)}; color: ${hfcInk('good')}; }
  .chip.program.night { background: ${hfcTint('cool-strong', 18)}; color: ${hfcInk('cool-strong')}; }
  .chip.program.party { background: ${hfcTint('pv', 20)}; color: ${hfcInk('pv')}; }
  .chip.program.holiday { background: ${hfcTint('badge', 18)}; color: ${hfcInk('badge')}; }
  .chip.badge.on { display: inline-block; background: ${hfcTint('badge', 18)}; color: ${hfcInk('badge')}; }
  .chip.err.on { display: inline-block; background: ${hfcTint('hot', 20)}; color: ${hfcInk('hot')}; }
  .chip .ico { display: inline-block; width: 1.1em; height: 1.1em; vertical-align: -.2em; margin-right: 4px; fill: none; stroke: currentColor; stroke-width: 2.2; }
  svg { width: 100%; height: auto; display: block; }
  text { fill: var(--primary-text-color); font-family: var(--ha-font-family-body, inherit); }
  .tap { cursor: pointer; }
  .small { font-size: calc(15px * var(--k2, 1)); fill: var(--hfc-muted); }
  .series-title { font-size: 14px; fill: var(--primary-text-color); }
  .room-temp { font-weight: 600; fill: var(--primary-text-color); }
  .pipe-label { font-size: calc(15px * var(--kp, 1)); font-weight: 600; }
  .pipe-label.dew-warning { fill: var(--error-color, #db4437); font-weight: 750; }
  .vol-label { font-size: 13px; fill: var(--hfc-muted); }
  .curve-part { font-size: calc(13px * var(--kp, 1)); font-weight: 500; }
  .pressure-label { font-size: 13px; font-weight: 600; fill: var(--hfc-muted); paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-width: 4px; }
  .pressure.warning .pressure-label { fill: ${hfcInk('pv')}; } .pressure.critical .pressure-label { fill: ${hfcInk('hot')}; }
  .unit { fill: var(--secondary-background-color, rgba(127,127,127,.12)); stroke: var(--divider-color, rgba(127,127,127,.35)); stroke-width: 2; transition: stroke .4s; }
  .unit.on.dhw { stroke: ${hfcVar('hot')}; } .unit.on.defrost, .unit.on.cool { stroke: ${hfcVar('cool-strong')}; }
  .unit.on { stroke: ${hfcVar('heat')}; filter: url(#glow); }
  .unit-title, .tank-title { font-size: calc(17px * var(--k, 1)); font-weight: 600; }
  .unit-status { font-size: calc(16px * var(--ku, 1)); font-weight: 600; }
  .unit-status .status2 { font-size: .88em; font-weight: 500; fill: var(--hfc-muted); }
  .unit-val { font-size: calc(15px * var(--ku, 1)); fill: var(--hfc-muted); }
  .unit-val.strong { font-size: calc(17px * var(--ku, 1)); font-weight: 700; fill: ${hfcVar('good')}; }
  .fan-ring { fill: none; stroke: var(--divider-color, rgba(127,127,127,.35)); stroke-width: 3; }
  .blade { fill: var(--hfc-muted); opacity: .55; }
  .hub { fill: var(--hfc-muted); }
  .fan { transform-box: view-box; transform-origin: 170px 288px; }
  .fan.on { animation: hfc-spin 1s linear infinite; }
  .fan.on .blade { fill: ${hfcVar('cool')}; opacity: .9; }
  .snow { opacity: 0; }
  .snow-bg { fill: var(--card-background-color, #fff); opacity: .85; }
  .snow-flake { fill: none; stroke: ${hfcVar('cool-strong')}; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  .snow.on { opacity: 1; animation: hfc-pulse var(--hfc-snow, 1.6s) ease-in-out infinite; }
  .vapour { opacity: 0; pointer-events: none; }
  .vapour-puff { fill: none; stroke: ${hfcVar('defrost')}; stroke-width: 4; stroke-linecap: round; }
  .vapour.on { opacity: .85; }
  .vapour.on .vapour-puff { animation: hfc-vapour var(--hfc-vapour, 2.2s) ease-out infinite; transform-box: fill-box; transform-origin: center bottom; }
  .vapour.on .vapour-puff:nth-child(2) { animation-delay: .45s; } .vapour.on .vapour-puff:nth-child(3) { animation-delay: .9s; }
  /* idle pipes are a solid pale tint, not transparent, so round caps that overlap at a junction do not show as dots */
  .pipe { fill: none; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; stroke: color-mix(in srgb, var(--pc, var(--hfc-muted)) 22%, var(--card-background-color, #fff)); transition: stroke .5s; }
  .pipe.on { stroke: var(--pc, var(--hfc-muted)); }
  .flow { fill: none; stroke: ${hfcVar('flow-dash')}; stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 3 17; opacity: 0; pointer-events: none; }
  .flow.on { opacity: 1; animation: hfc-dash 1s linear infinite; }
  .eline { fill: none; stroke-width: 4; stroke-linecap: round; opacity: .18; }
  .eline.pv { stroke: ${hfcVar('pv')}; } .eline.bat { stroke: ${hfcVar('battery')}; } .eline.grid { stroke: ${hfcVar('grid')}; }
  .eflow { fill: none; stroke-width: 7; stroke-linecap: round; stroke-dasharray: 0.1 18; opacity: 0; pointer-events: none; }
  .eflow.pv { stroke: ${hfcVar('pv')}; } .eflow.bat { stroke: ${hfcVar('battery')}; } .eflow.grid { stroke: ${hfcVar('grid')}; }
  .eflow.on { opacity: 1; animation: hfc-edash var(--hfc-electrical, 1.1s) linear infinite; }
  .hop { fill: none; stroke: var(--card-background-color, #fff); stroke-width: 15; }
  .src.absent { opacity: .35; }
  .src text { font-size: calc(15px * var(--ks, 1)); paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-width: 5px; stroke-linejoin: round; }
  .src-ring { fill: var(--secondary-background-color, rgba(127,127,127,.12)); stroke: var(--divider-color, rgba(127,127,127,.35)); stroke-width: 2; transition: stroke .4s; }
  .src.pv.on .src-ring { stroke: ${hfcVar('pv')}; } .src.bat.on .src-ring { stroke: ${hfcVar('battery')}; } .src.grid.on .src-ring { stroke: ${hfcVar('grid')}; }
  .ico { fill: var(--hfc-muted); } .ico-o { fill: none; stroke: var(--hfc-muted); stroke-width: 2.5; }
  .ico-l { stroke: var(--hfc-muted); stroke-width: 2.5; fill: none; stroke-linecap: round; }
  .src.pv.on .ico { fill: ${hfcVar('pv')}; } .src.pv.on .ico-l { stroke: ${hfcVar('pv')}; }
  .src.bat.on .ico { fill: ${hfcVar('battery')}; } .src.bat.on .ico-o { stroke: ${hfcVar('battery')}; }
  .src.grid.on .ico-l { stroke: ${hfcVar('grid')}; }
  .valve { fill: var(--card-background-color, #fff); stroke: var(--hfc-muted); stroke-width: 3; }
  .mix-body { stroke-width: 2; }
  .mix-label { font-size: calc(13px * var(--k2, 1)); font-weight: 600; fill: var(--primary-text-color, #212121); paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-width: 4px; }
  .mix-dir { fill: none; stroke: var(--primary-text-color, #212121); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  .valve-arrow { fill: none; stroke: var(--primary-text-color); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .tank { stroke: var(--divider-color, rgba(127,127,127,.4)); stroke-width: 2; }
  .tank-temp { font-size: calc(26px * var(--kt, 1)); font-weight: 700; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.45); stroke-width: 4px; stroke-linejoin: round; }
  .tank-sub { font-size: 14px; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.35); stroke-width: 3px; }
  .buffer-values-equal .buffer-value { font-size: calc(18px * var(--kt, 1)); font-weight: 600; stroke: rgba(0,0,0,.4); stroke-width: 3px; }
  .on-tank { fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.35); stroke-width: 3px; }
  .zone-title { font-weight: 600; }
  .zone-line { fill: none; stroke: rgba(255,255,255,.8); stroke-width: 2; stroke-dasharray: 6 5; }
  .inner-tank { fill: rgba(255,255,255,.12); stroke: rgba(255,255,255,.85); stroke-width: 2; }
  .fws { fill: color-mix(in oklch, ${hfcVar('tank-warm')} 35%, var(--card-background-color, #fff)); stroke: var(--divider-color, rgba(127,127,127,.4)); stroke-width: 2; }
  .fws-plates { fill: none; stroke: var(--hfc-muted); stroke-width: 2; opacity: .25; }
  .house-temp { font-size: calc(26px * var(--kt, 1)); font-weight: 700; }
  .house-sub { font-size: calc(14px * var(--k2, 1)); }
  .house-row-name { font-size: calc(12px * var(--k2, 1)); clip-path: polygon(0 0, 80px 0, 80px 100%, 0 100%); }
  .house-row-value { font-size: calc(13px * var(--k2, 1)); font-weight: 600; }
  .house-comfort { fill: var(--disabled-text-color, #9e9e9e); stroke: var(--card-background-color, #fff); stroke-width: 1.5; }
  .house-comfort.below { fill: ${hfcVar('cool-strong')}; }
  .house-comfort.on { fill: ${hfcVar('good')}; }
  .house-comfort.above { fill: ${hfcVar('hot')}; }
  .coil { fill: none; stroke: rgba(255,255,255,.55); stroke-width: 3; stroke-linejoin: round; opacity: .25; }
  .coil.on { opacity: .6; stroke-width: 2.5; stroke-dasharray: 5 9; animation: hfc-cdash var(--hfc-coil, 1.4s) linear infinite; }
  .circ { opacity: .35; } .circ.on { opacity: 1; fill: ${hfcVar('cool-strong')}; }
  .pump { fill: var(--card-background-color, #fff); stroke: var(--hfc-muted); stroke-width: 3; }
  .imp { fill: var(--hfc-muted); }
  .impeller { transform-box: view-box; transform-origin: 720px 360px; }
  .impeller.on { animation: hfc-spin 1s linear infinite; }
  .impeller.on .imp { fill: ${hfcVar('heat')}; }
  .house { fill: var(--secondary-background-color, rgba(127,127,127,.1)); stroke: var(--divider-color, rgba(127,127,127,.35)); stroke-width: 2; stroke-linejoin: round; }
  .screed { fill: var(--divider-color, rgba(127,127,127,.35)); }
  .collector-base { fill: var(--card-background-color, #fff); }
  .collector { fill: var(--secondary-background-color, rgba(127,127,127,.15)); stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 2; transition: fill .4s, stroke .4s; }
  .collector-cells { fill: none; stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 1.5; }
  .solar.on .collector { fill: ${hfcTint('pv', 28)}; stroke: ${hfcVar('pv')}; }
  .heater-case { fill: none; stroke: rgba(0,0,0,.45); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .heater-el { fill: none; stroke: var(--disabled-text-color, #9e9e9e); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .heater-flange, .heater-box { fill: var(--secondary-background-color, rgba(127,127,127,.15)); stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 1.5; }
  .heater.on .heater-el { stroke: ${hfcVar('heat')}; filter: url(#glow); }
  .heater.on.stage2 .heater-el { stroke: ${hfcVar('hot')}; }
  .heater.rod.on .heater-el, .rod-waves .wave { stroke: ${hfcVar('hot')}; } .rod-waves .wave { stroke-width: 2; }
  .boiler-title { font-size: 12px; font-weight: 600; fill: var(--primary-text-color); }
  .boiler-box { fill: var(--card-background-color, #fff); stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 2; }
  .boiler-water { fill: none; stroke: var(--hfc-muted); stroke-width: 6; }
  .boiler-flame { fill: var(--disabled-text-color, #9e9e9e); transition: fill .4s; }
  .boiler-value { font-size: 10px; fill: var(--secondary-text-color, #727272); }
  .boiler-flow { font-size: 11px; }
  .boiler.on .boiler-box { stroke: ${hfcVar('heat')}; }
  .boiler.on .boiler-water { stroke: ${hfcVar('heat')}; }
  .boiler.on .boiler-flame { fill: ${hfcVar('hot')}; filter: url(#glow); }
  .ground { fill: none; stroke: ${hfcVar('ground')}; stroke-width: 3; stroke-dasharray: 10 5; opacity: .7; }
  .well { fill: none; stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 2; }
  .water { fill: none; stroke: ${hfcVar('cool')}; stroke-width: 2; }
  .pipe.src { --pc: ${hfcVar('brine')}; }
  .radiator { fill: var(--secondary-background-color, rgba(127,127,127,.12)); stroke: var(--divider-color, rgba(127,127,127,.4)); stroke-width: 2; }
  .rib { fill: url(#g-rad); stroke: rgba(0,0,0,.08); stroke-width: 1; }
  .column-rib { stroke: var(--divider-color, rgba(127,127,127,.45)); stroke-width: 1.5; }
  .column-cap { fill: color-mix(in srgb, var(--hfc-muted) 24%, transparent); stroke: var(--divider-color, rgba(127,127,127,.45)); stroke-width: 1; }
  .column-link, .column-foot { fill: none; stroke: var(--divider-color, rgba(127,127,127,.5)); stroke-width: 4; stroke-linecap: round; }
  #p-hc-body, #f-hc-body { display: var(--hfc-body, inline); }
  .wave { fill: none; stroke: ${hfcVar('heat')}; stroke-width: 3; stroke-linecap: round; opacity: 0; }
  .waves.on .wave { animation: hfc-rise var(--hfc-wave, 2.4s) ease-in-out infinite; }
  .waves.on .wave:nth-child(2) { animation-delay: var(--hfc-wave-delay, .8s); } .waves.on .wave:nth-child(3) { animation-delay: var(--hfc-wave-delay2, 1.6s); }
  .hint { margin: 4px 4px 8px; padding: 8px 12px; border-radius: 8px; background: ${hfcTint('heat', 14)}; color: var(--primary-text-color); font-size: .9em; }
  .hint a { color: var(--primary-color, #03a9f4); }
  .controls { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 4px 0; }
  .ctl { font: inherit; font-size: .88em; color: var(--primary-text-color); background: var(--secondary-background-color, rgba(127,127,127,.12));
    border: 1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius: 999px; padding: 5px 12px; display: inline-flex; align-items: center; gap: 6px; }
  button.ctl { cursor: pointer; }
  button.ctl.toggle.on { background: ${hfcTint('heat', 18)}; border-color: ${hfcVar('heat')}; color: ${hfcInk('heat')}; }
  button.ctl.press:active { background: ${hfcTint('heat', 25)}; }
  .ctl select, .ctl input { font: inherit; color: inherit; background: transparent; border: none; outline: none; max-width: 11em; }
  .ctl input { width: 3.5em; }
  .ctl em { font-style: normal; color: var(--hfc-muted); }
  .ctl select option { color: #000; }
  .drawer { margin: 6px 4px 0; }
  .drawer-toggle { font: inherit; font-size: .9em; color: var(--hfc-muted); background: none; border: none; cursor: pointer; padding: 4px 0; display: inline-flex; align-items: center; gap: 4px; }
  .drawer-toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; transition: transform .2s; }
  .drawer-toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
  .dsec { margin: 4px 0 10px; }
  .dsec-title { font-size: .78em; text-transform: uppercase; letter-spacing: .04em; color: var(--hfc-muted); margin-bottom: 4px; }
  .dgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 16px; }
  .drow { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.18)); font-size: .9em; color: var(--primary-text-color); }
  .drow span { color: var(--hfc-muted); }
  .drow b { white-space: nowrap; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 6px; margin-top: 6px; }
  .stat { cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; background: var(--secondary-background-color, rgba(127,127,127,.1)); border-radius: 10px; padding: 6px 8px; text-align: center; }
  .sv { font-weight: 700; font-size: 1.05em; color: var(--primary-text-color); }
  .sl { font-size: .78em; color: var(--hfc-muted); }
  .tap, .chip, .drow { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  /* outdoor unit drawings (unit_style): anthracite and light casings derive from --hfc-anthracite and --hfc-casing */
  .lam-body { fill: ${hfcVar('anthracite')}; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 78%, #000); stroke-width: 1.5; }
  .lam-edge { fill: color-mix(in srgb, ${hfcVar('anthracite')} 78%, #000); }
  .lam-open, .lam-slot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 30%, #000); }
  .lam-cut { stroke: ${hfcVar('anthracite')}; stroke-width: 3; fill: none; }
  .lam-cut.curve { stroke-width: 3.4; stroke-linecap: round; } .lam-cut.vein { stroke-width: 2.4; stroke-linecap: round; }
  .lam-hi { stroke: color-mix(in srgb, ${hfcVar('anthracite')} 85%, #fff); stroke-width: 1.2; fill: none; opacity: .8; }
  .lam-plinth { fill: color-mix(in srgb, var(--primary-text-color, #1f2937) 22%, var(--card-background-color, #fff)); }
  /* a rim in the theme text colour keeps the anthracite body visible on dark cards */
  .lam-rim { fill: none; stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 48%, transparent); stroke-width: 1.4; }
  .fan.lam-fan .blade, .fan.vai-fan .blade, .fan.pana-fan .blade, .fan.vies-fan .blade, .fan.bosch-fan .blade, .fan.sd-fan .blade, .fan.sam-fan .blade, .fan.wolf-fan .blade, .fan.kro-fan .blade, .fan.ait-fan .blade, .fan.stb-fan .blade { fill: #9aa3ad; opacity: .55; }
  .fan.lam-fan .hub, .fan.vai-fan .hub, .fan.pana-fan .hub, .fan.vies-fan .hub, .fan.bosch-fan .hub, .fan.sd-fan .hub, .fan.sam-fan .hub, .fan.wolf-fan .hub, .fan.kro-fan .hub, .fan.ait-fan .hub, .fan.stb-fan .hub { fill: #9aa3ad; }
  .fan.lam-fan.on .blade, .fan.vai-fan.on .blade, .fan.pana-fan.on .blade, .fan.vies-fan.on .blade, .fan.bosch-fan.on .blade, .fan.sd-fan.on .blade, .fan.sam-fan.on .blade, .fan.wolf-fan.on .blade, .fan.kro-fan.on .blade, .fan.ait-fan.on .blade, .fan.stb-fan.on .blade { fill: ${hfcVar('cool')}; opacity: .95; }
  .vai-body { fill: ${hfcVar('casing')}; stroke: color-mix(in srgb, ${hfcVar('casing')} 80%, #6b7280); stroke-width: 1.5; }
  .vai-dark, .vai-foot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 60%, #000); }
  .vai-gr { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 45%, #a0a8b0); stroke-width: 2; } .vai-gr.thin { stroke-width: 1; opacity: .85; }
  .vai-seam { stroke: color-mix(in srgb, ${hfcVar('casing')} 80%, #6b7280); stroke-width: 1.2; fill: none; opacity: .8; }
  .pana-body { fill: ${hfcVar('casing')}; stroke: color-mix(in srgb, ${hfcVar('casing')} 76%, #64748b); stroke-width: 1.5; }
  .pana-foot, .pana-panel { fill: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); }
  .pana-gr { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 52%, #94a3b8); stroke-width: 2; }
  .pana-gr.thin { stroke-width: 1; opacity: .88; }
  .pana-top, .pana-seam, .pana-vents { fill: none; stroke: color-mix(in srgb, ${hfcVar('casing')} 62%, #64748b); stroke-width: 1.25; }
  .pana-vents { stroke-width: 1.5; stroke-linecap: round; }
  .vies-body { fill: ${hfcVar('anthracite')}; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 76%, #000); stroke-width: 1.5; }
  .vies-foot, .sam-foot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 55%, #000); }
  .vies-well { fill: color-mix(in srgb, ${hfcVar('anthracite')} 35%, #000); opacity: .8; }
  .vies-slat { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); stroke-width: 2.3; stroke-linecap: round; }
  .vies-rim { fill: none; stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 42%, transparent); stroke-width: 1.2; }
  .bosch-body, .sd-body { fill: ${hfcVar('casing')}; stroke: color-mix(in srgb, ${hfcVar('casing')} 76%, #64748b); stroke-width: 1.5; }
  .bosch-foot, .sd-foot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 58%, #000); }
  .bosch-gr, .sd-gr { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 50%, #94a3b8); stroke-width: 2; }
  .bosch-gr.thin, .sd-gr.thin { stroke-width: 1; opacity: .88; }
  .bosch-top, .sd-seam, .sd-vents { fill: none; stroke: color-mix(in srgb, ${hfcVar('casing')} 62%, #64748b); stroke-width: 1.3; }
  .bosch-mark { fill: ${hfcVar('good')}; opacity: .8; }
  .sd-accent { fill: none; stroke: ${hfcVar('hot')}; stroke-width: 2.5; }
  .sd-vents { stroke-linecap: round; } .sd-badge { fill: ${hfcVar('hot')}; }
  .sam-body { fill: color-mix(in srgb, ${hfcVar('anthracite')} 88%, #111827); stroke: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); stroke-width: 1.5; }
  .sam-grille { fill: color-mix(in srgb, ${hfcVar('anthracite')} 32%, #000); }
  .sam-slat { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 48%, #000); stroke-width: 3; stroke-linecap: round; }
  .sam-seam { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 75%, #94a3b8); stroke-width: 1.2; }
  .sam-dot { fill: color-mix(in srgb, ${hfcVar('casing')} 70%, #fff); opacity: .7; }
  .wolf-body { fill: color-mix(in srgb, ${hfcVar('anthracite')} 84%, #9ca3af); stroke: color-mix(in srgb, ${hfcVar('anthracite')} 70%, #000); stroke-width: 1.5; }
  .wolf-panel { fill: color-mix(in srgb, ${hfcVar('anthracite')} 74%, #000); }
  .wolf-hole { fill: color-mix(in srgb, ${hfcVar('anthracite')} 30%, #000); }
  .wolf-ring { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 80%, #cbd5e1); stroke-width: 1.6; }
  .wolf-lid, .wolf-foot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 55%, #000); }
  /* the lid is the darkest part; an edge in the theme text colour keeps it visible on dark cards */
  .wolf-lid { stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 34%, transparent); stroke-width: 1; }
  .wolf-seam { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); stroke-width: 1.2; }
  .wolf-rim { fill: none; stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 42%, transparent); stroke-width: 1.2; }
  .kro-body { fill: color-mix(in srgb, ${hfcVar('anthracite')} 70%, #000); }
  .kro-side { fill: color-mix(in srgb, ${hfcVar('anthracite')} 92%, #9ca3af); }
  .kro-grille { fill: color-mix(in srgb, ${hfcVar('anthracite')} 28%, #000); }
  .kro-slat { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); stroke-width: 3.2; }
  .kro-plinth { fill: color-mix(in srgb, ${hfcVar('anthracite')} 82%, #000); }
  .kro-plate { fill: color-mix(in srgb, ${hfcVar('casing')} 60%, #64748b); opacity: .8; }
  .kro-rim { fill: none; stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 42%, transparent); stroke-width: 1.2; }
  .ait-body { fill: color-mix(in srgb, ${hfcVar('casing')} 82%, #94a3b8); }
  .ait-front { fill: color-mix(in srgb, ${hfcVar('anthracite')} 40%, #000); }
  .ait-hole { fill: color-mix(in srgb, ${hfcVar('anthracite')} 18%, #000); }
  .ait-ring { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 70%, #94a3b8); stroke-width: 1.6; }
  .ait-slot { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 70%, #94a3b8); stroke-width: 1.4; stroke-linecap: round; }
  .ait-red { fill: none; stroke: ${hfcVar('hot')}; stroke-width: 2; }
  .ait-base { fill: color-mix(in srgb, ${hfcVar('anthracite')} 55%, #000); }
  .ait-plate { fill: color-mix(in srgb, ${hfcVar('casing')} 55%, #64748b); opacity: .7; }
  .ait-rim { fill: none; stroke: color-mix(in srgb, ${hfcVar('casing')} 62%, #64748b); stroke-width: 1.2; }
  .stb-body { fill: color-mix(in srgb, ${hfcVar('anthracite')} 78%, #000); }
  .stb-grille { fill: color-mix(in srgb, ${hfcVar('anthracite')} 30%, #000); }
  .stb-slat { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 62%, #000); stroke-width: 2.4; }
  .stb-seam { fill: none; stroke: color-mix(in srgb, ${hfcVar('anthracite')} 55%, #000); stroke-width: 1.2; }
  .stb-base, .stb-foot { fill: color-mix(in srgb, ${hfcVar('anthracite')} 50%, #000); }
  .stb-plate { fill: color-mix(in srgb, ${hfcVar('casing')} 70%, #94a3b8); opacity: .75; }
  .stb-rim { fill: none; stroke: color-mix(in srgb, var(--primary-text-color, #1f2937) 42%, transparent); stroke-width: 1.2; }
  /* timeline of the operating mode */
  .timeline { margin: 8px 4px 0; }
  .tl-head { display: flex; justify-content: space-between; gap: 8px; font-size: .82em; color: var(--hfc-muted); }
  .tl-detail { color: var(--primary-text-color); text-align: right; }
  .tl-bar { position: relative; height: 14px; margin-top: 4px; border-radius: 7px; overflow: hidden; background: color-mix(in srgb, var(--hfc-muted) 16%, transparent); }
  .tl-bar .seg { position: absolute; top: 0; bottom: 0; min-width: 3px; cursor: pointer; }
  .seg.k-heat, .tl-legend i.k-heat { background: ${hfcVar('heat')}; }
  .seg.k-pv, .tl-legend i.k-pv { background: repeating-linear-gradient(135deg, ${hfcVar('pv')} 0 3px, ${hfcVar('heat')} 3px 6px); }
  .seg.k-sg-boost, .tl-legend i.k-sg-boost { background: repeating-linear-gradient(135deg, ${hfcVar('pv')} 0 4px, color-mix(in srgb, ${hfcVar('pv')} 45%, transparent) 4px 7px); }
  .seg.k-sg-forced, .tl-legend i.k-sg-forced { background: repeating-linear-gradient(135deg, ${hfcVar('heat')} 0 4px, ${hfcVar('hot')} 4px 7px); }
  .seg.k-dhw, .tl-legend i.k-dhw { background: ${hfcVar('hot')}; }
  .seg.k-defrost, .tl-legend i.k-defrost { background: ${hfcVar('cool-strong')}; }
  .seg.k-cool, .tl-legend i.k-cool { background: ${hfcVar('cool')}; }
  .seg.k-idle { background: transparent; }
  .seg.k-blocked, .tl-legend i.k-blocked, .seg.k-sg-blocked, .tl-legend i.k-sg-blocked { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--hfc-muted) 55%, transparent) 0 3px, transparent 3px 6px); }
  .seg.k-gap, .tl-legend i.k-gap { background: repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in srgb, var(--hfc-muted) 30%, transparent) 3px 4px); }
  .seg.sel { box-shadow: inset 0 0 0 2px var(--primary-text-color); }
  .tl-bar .tick { position: absolute; top: 0; bottom: 0; width: 1px; margin-left: -.5px; background: var(--primary-text-color); opacity: .45; pointer-events: none; }
  .tl-bar .run-sel { position: absolute; top: 0; bottom: 0; min-width: 3px; border-radius: 3px; box-shadow: inset 0 0 0 2px var(--primary-text-color); pointer-events: none; }
  .tl-run { margin: 8px 0 2px; padding: 8px 12px 9px; border-radius: 12px; font-size: max(.86em, 13px); border-left: 4px solid var(--run-c);
    background: color-mix(in srgb, var(--hfc-muted) 12%, transparent); }
  .tl-run-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .tl-run-head b { font-weight: 600; }
  .tl-run-x { border: 0; background: none; color: var(--hfc-muted); font: inherit; font-size: 1.2em; line-height: 1; padding: 0 2px; cursor: pointer; }
  .tl-run-x:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); border-radius: 4px; }
  .tl-run-sub { color: var(--hfc-muted); margin-top: 2px; }
  .tl-run-sub span { white-space: nowrap; }
  .tl-run dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; margin: 8px 0 0; }
  .tl-run dt { color: var(--hfc-muted); }
  .tl-run dd { margin: 0; }
  .tl-run dd .m { color: var(--hfc-muted); }
  .tl-mark { position: relative; height: 7px; margin-top: 4px; border-radius: 4px; background: color-mix(in srgb, var(--hfc-muted) 10%, transparent); }
  .tl-mark .mseg { position: absolute; top: 0; bottom: 0; min-width: 3px; border-radius: 4px; cursor: pointer; background: ${hfcVar('badge')}; }
  .tl-mark .mseg::before { content: ''; position: absolute; inset: -6px 0; }
  .tl-mark .mseg.sel { box-shadow: 0 0 0 2px var(--primary-text-color); }
  .tl-legend i.k-mark { background: ${hfcVar('badge')}; }
  .tl-bar:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  .tl-axis { position: relative; height: 1.2em; font-size: .72em; color: var(--hfc-muted); }
  .tl-axis span { position: absolute; top: 2px; transform: translateX(-50%); }
  .tl-legend { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: .78em; color: var(--hfc-muted); }
  .tl-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  /* keyboard focus */
  .focus-ring { fill: none; stroke: var(--primary-color, #03a9f4); stroke-width: 3; pointer-events: none; }
  .tap:focus, .tap:focus-visible, #svg:focus { outline: none; }
  .chip:focus-visible, .stat:focus-visible, .drow:focus-visible, .drawer-toggle:focus-visible, .ctl:focus-visible, .icon-button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
  /* narrow schematic (phones, narrow columns): larger type, secondary labels hidden */
  .stage { container-type: inline-size; }
  @container (max-width: 640px) { #svg { --k: 1.2; --ku: 1.1; --kp: 1; --k2: 1; --ks: 1.2; --kt: 1.15; } }
  @container (max-width: 500px) { #svg { --k: 1.4; --ku: 1.25; --kp: 1.4; --k2: 1.3; --ks: 1.4; --kt: 1.3; } .vol-label, .tank-sub, .pre, #t-valve, #t-circ, #t-dhw-mode { display: none; } .narrow-values #t-buf-middle, .narrow-values #t-buf-bottom, .narrow-values #t-dhw-middle, .narrow-values #t-dhw-bottom, .narrow-values #t-dhw-mode, .narrow-values [id^="t-hc-rl"] { display: block; font-size: calc(13px * var(--k2, 1)); } }
  /* narrow_focus: below 500 px the key values grow to about the size of the tank temperature; the outdoor, air inlet and power
     source values move to one line under the schematic, and the secondary labels are hidden. Wins over narrow_values. */
  #t-hp-heat, .focus-line { display: none; }
  .focus-line { margin: 2px 4px 0; text-align: center; font-size: .85em; line-height: 1.45; color: var(--primary-text-color); }
  .focus-line span { white-space: nowrap; }
  @container (max-width: 500px) {
    .narrow-focus #t-hp-status, .narrow-focus #t-hp-power, .narrow-focus .src text, .narrow-focus .nf-moved, .narrow-focus #t-outdoor, .narrow-focus #t-outdoor-hp,
    .narrow-focus .pipe-label[id^="t-hc"]:not(.dew-warning), .narrow-focus [id^="t-hc-mode"], .narrow-focus #t-valve, .narrow-focus #t-bypass, .narrow-focus .nf-tail { display: none; }
    .narrow-focus #t-hp-heat { display: inline; font-size: 32px; font-weight: 700; fill: var(--primary-text-color); }
    .narrow-focus #t-hp-heat.off { font-size: 22px; font-weight: 600; fill: var(--hfc-muted); }
    .narrow-focus #t-hp-cop { font-size: 32px; }
    .narrow-focus #t-vl.nf-big { font-size: 30px; transform: translate(7px, -31px); }
    .narrow-focus #t-rl { font-size: 30px; text-anchor: start; transform: translate(57px, 14px); }
    .narrow-focus #t-room-target { font-size: 28px; transform: translateY(6px); }
    .narrow-focus .house-row-value { font-size: 20px; }
    .narrow-focus .house-row-name { clip-path: polygon(0 0, 72px 0, 72px 100%, 0 100%); }
    .narrow-focus .nf-two .house-row-name { font-size: 18px; clip-path: polygon(0 0, 200px 0, 200px 100%, 0 100%); }
    .narrow-focus .nf-two .house-row-value { font-size: 26px; text-anchor: start; transform: translate(-204px, 27px); }
    .narrow-focus #house-row2.nf-two { transform: translateY(24.5px); } .narrow-focus #house-row3.nf-two { transform: translateY(49px); }
    .narrow-focus .focus-line:not(:empty) { display: block; }
  }
  /* layout: compact – tighter spacing for narrow dashboard columns */
  ha-card.layout-compact { padding: 6px 6px 4px; }
  .layout-compact .head { margin: 0 2px 2px; }
  .layout-compact .title { font-size: 1em; }
  .layout-compact .chip { font-size: .75em; padding: 2px 8px; }
  .layout-compact .stats { grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 4px; margin-top: 4px; }
  .layout-compact .stat { padding: 4px 6px; border-radius: 8px; }
  .layout-compact .sv { font-size: .95em; } .layout-compact .sl { font-size: .7em; }
  .layout-compact .controls { gap: 4px; margin: 4px 2px 0; }
  .layout-compact .ctl { font-size: .8em; padding: 3px 9px; }
  .layout-compact .drawer { margin: 4px 2px 0; }
  /* layout: wide – schematic left, controls, tiles and details right (wall tablets, wide dashboards) */
  ha-card.layout-wide, ha-card.layout-wall { display: block; container-type: inline-size; }
  @container (min-width: 760px) {
    .layout-wide .body, .layout-wall .body { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(250px, 1fr); gap: 14px; align-items: center; }
    .layout-wide .side > :first-child, .layout-wall .side > :first-child { margin-top: 0; }
  }
  /* layout: wall – large type for wall tablets; controls and the details toggle only show after a touch */
  ha-card.layout-wall { font-size: 1.3em; padding: 16px 16px 12px; }
  @container (min-width: 760px) { .layout-wall .body { align-items: start; } }
  .layout-wall .title { font-size: 1.25em; }
  .layout-wall .chip { font-size: .9em; padding: 4px 12px; }
  .layout-wall .stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
  .layout-wall .stat { padding: 10px 12px; border-radius: 14px; }
  .layout-wall .sv { font-size: 1.4em; } .layout-wall .sl { font-size: .85em; }
  .layout-wall .controls, .layout-wall .drawer-toggle { opacity: 0; pointer-events: none; transition: opacity .5s; }
  .layout-wall.awake .controls, .layout-wall.awake .drawer-toggle { opacity: 1; pointer-events: auto; }
  /* Each dash animation moves by whole periods of its own dash pattern, so the end of a cycle matches its start (#135):
     water 3 + 17 = 20, power dots 0.1 + 18 = 18.1, coil 5 + 9 = 14. */
  @keyframes hfc-dash { to { stroke-dashoffset: -40; } }
  @keyframes hfc-edash { to { stroke-dashoffset: -36.2; } }
  @keyframes hfc-cdash { to { stroke-dashoffset: -42; } }
  @keyframes hfc-spin { to { transform: rotate(360deg); } }
  @keyframes hfc-pulse { 50% { opacity: .35; } }
  @keyframes hfc-rise { 0% { opacity: 0; transform: translateY(6px); } 40% { opacity: .9; } 100% { opacity: 0; transform: translateY(-10px); } }
  @keyframes hfc-vapour { 0% { opacity: 0; transform: translateY(6px) scale(.9); } 35% { opacity: .9; } 100% { opacity: 0; transform: translateY(-12px) scale(1.08); } }
  .motion-off .flow.on, .motion-off .eflow.on, .motion-off .fan.on, .motion-off .impeller.on, .motion-off .coil.on, .motion-off .snow.on, .motion-off .vapour.on .vapour-puff, .motion-off .waves.on .wave { animation: none !important; }
  .motion-off .vapour.on .vapour-puff { opacity: .65; }
  .motion-off .waves.on .wave { opacity: .7; }
  @media (prefers-reduced-motion: reduce) { .motion-auto .flow.on, .motion-auto .eflow.on, .motion-auto .fan.on, .motion-auto .impeller.on, .motion-auto .coil.on, .motion-auto .snow.on, .motion-auto .vapour.on .vapour-puff, .motion-auto .waves.on .wave { animation: none; } .motion-auto .vapour.on .vapour-puff { opacity: .65; } .motion-auto .waves.on .wave { opacity: .7; } }
`;

// Card editor: the same form as getConfigForm, but entity pickers show what the preset found,
// only the configured number of circuits is offered, and the preset field reports the detection.
class HeatpumpFlowCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._resolved = null; this._loadEnergyInfo(); this._loadRegistry(); this._render(); }

  _loadRegistry() { HeatpumpFlowCard._loadPresetRegistry(this, () => this._render()); this._loadDisabled(); }

  // Disabled entities (#146): the full entity registry, read once per registry version and only with a preset. Administrators only;
  // for other users the request fails and nothing is shown. Kept: id, integration, translation key, device and name, nothing else.
  // Presets that load the full registry themselves (PointT) keep their one shared request and are left out.
  _loadDisabled() {
    const hass = this._hass; const preset = HFC_PRESETS[this._config?.preset];
    if (!preset || preset.entity_registry || typeof hass?.callWS !== 'function' || this._disabledFor === hass.entities) return;
    this._disabledFor = hass.entities;
    Promise.resolve(hass.callWS({ type: 'config/entity_registry/list' })).then((entries) => {
      if (!Array.isArray(entries) || this._disabledFor !== hass.entities) return;
      this._disabled = entries.filter((e) => e?.disabled_by && typeof e.entity_id === 'string')
        .map(({ entity_id, platform, translation_key, device_id, name, original_name }) => ({ entity_id, platform, translation_key, device_id, name: name || original_name || '' }));
      this._render();
    }).catch(() => { this._disabled = []; });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    this._loadEnergyInfo();
    this._loadRegistry();
    const revision = HFC_PRESETS[this._config?.preset]?.entity_registry ? HeatpumpFlowCard._pointtRevision(hass) : undefined;
    const changed = revision !== this._pointtRevision;
    this._pointtRevision = revision;
    if (first || changed) this._render();
  }

  _loadEnergyInfo() {
    if (!this._config || this._config.power_sources === 'manual') return;
    if (this._energyReq || typeof this._hass?.callWS !== 'function') return;
    this._energyReq = true;
    HeatpumpFlowCard._energyPrefs = HeatpumpFlowCard._energyPrefs || this._hass.callWS({ type: 'energy/get_prefs' });
    HeatpumpFlowCard._energyPrefs.then((prefs) => {
      this._energyMissing = HeatpumpFlowCard._energyInfo(prefs, this._hass).missing;
      this._render();
    }).catch(() => { this._energyMissing = []; });
  }

  _render() {
    try { this._renderForm(); } catch (err) { console.error('heatpump-flow-card editor:', err); }
  }

  _renderAssistant(show, proposals, L, computeLabel) {
    if (!this._assistant) return;
    if (!show) { this._assistant.innerHTML = ''; return; }
    const esc = (x) => String(x).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
    const intro = `<ha-alert alert-type="info" title="${esc(L.assistant_title)}">${esc(L.assistant_intro)}</ha-alert>`;
    if (!this._assistantDevice) { this._assistant.innerHTML = intro; return; }
    if (!proposals.length) { this._assistant.innerHTML = `${intro}<p style="margin:10px 0 14px">${esc(L.assistant_none)}</p>`; return; }
    const field = (key) => String(computeLabel({ name: key })).replace(/\s*\(.*\)\s*$/, '');
    const rows = proposals.map((proposal, n) => {
      const state = this._hass.states[proposal.id];
      const name = state?.attributes?.friendly_name;
      const entity = name ? `${name} (${proposal.id})` : proposal.id;
      return `<label style="display:flex;gap:10px;align-items:flex-start;margin:9px 2px"><input type="checkbox" data-hfc-assistant="${n}" style="margin-top:3px"><span><strong>${esc(field(proposal.key))}</strong><br><code>${esc(entity)}</code></span></label>`;
    }).join('');
    this._assistant.innerHTML = `${intro}<div style="margin:10px 0">${rows}</div><button type="button" data-hfc-assistant-apply disabled>${esc(L.assistant_apply)}</button>`;
    const button = this._assistant.querySelector('[data-hfc-assistant-apply]');
    this._assistant.onchange = () => { button.disabled = !this._assistant.querySelector('input[data-hfc-assistant]:checked'); };
    this._assistant.onclick = (ev) => {
      if (ev.target !== button) return;
      const selected = [...this._assistant.querySelectorAll('input[data-hfc-assistant]:checked')]
        .map((input) => proposals[+input.dataset.hfcAssistant]).filter(Boolean);
      if (selected.length) this._applyAssistant(selected);
    };
  }

  _applyAssistant(proposals) {
    const entities = { ...(this._config.entities || {}) };
    proposals.forEach(({ key, id }) => { if (key && id) entities[key] = id; });
    const config = { ...this._config, entities };
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    this._render();
  }

  _renderForm() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.addEventListener('value-changed', (ev) => { ev.stopPropagation(); this._changed(ev.detail.value); });
      this._assistant = document.createElement('div');
      this._warn = document.createElement('div');
      this.appendChild(this._assistant);
      this.appendChild(this._warn);
      this.appendChild(this._form);
    }
    const r = HeatpumpFlowCard._resolve(this._config, this._hass);
    // Only entities that exist are shown as found by the preset.
    this._fromPreset = Object.fromEntries(Object.entries(r.fromPreset).filter(([, id]) => this._hass.states[id]));
    this._presetErrors = r.presetErrors || [];
    this._presetControls = r.presetControls;
    this._presetErrorOk = r.preset?.error_ok || [];
    const tiles = HeatpumpFlowCard._tileOptions(this._config, r, this._hass);
    this._tiles = tiles;
    // Valve states (#126): the preset map with the configuration on top, shown as two lists of raw states.
    const valveId = r.entities.valve;
    const valveState = valveId ? this._hass.states[valveId]?.state : undefined;
    this._presetValveMap = r.preset?.valve_map || {};
    const valveMap = { ...this._presetValveMap, ...(this._config.valve_map || {}) };
    const statesOf = (side) => Object.entries(valveMap).filter(([, v]) => hfcValveSide(v) === side).map(([k]) => k).join(', ');
    this._valveText = { dhw: statesOf('dhw'), heating: statesOf('heating') };
    this._valveShown = !!valveId;
    // Preset detection for the dropdown (#145): once per registry, not on every change in the form.
    if (this._matchesFor !== this._hass.entities) { this._matches = HeatpumpFlowCard._presetMatches(this._hass); this._matchesFor = this._hass.entities; }
    const assistant = !r.preset && !(this._matches || []).length;
    const own = this._config.entities || {};
    const shown = { ...this._fromPreset };
    Object.entries(own).forEach(([k, v]) => { if (v === null || v === 'none') delete shown[k]; else if (v) shown[k] = v; });
    // Entities that fit each measuring kind, for the pickers (#194): once per set of entities, not on every new state.
    if (this._fitsFor !== (this._hass.entities || this._hass.states)) {
      this._fitsFor = this._hass.entities || this._hass.states;
      this._fits = Object.fromEntries(Object.entries(HFC_KINDS).filter(([, k]) => k.units).map(([name]) => [name,
        Object.entries(this._hass.states).filter(([id, st]) => HeatpumpFlowCard._fit(name, id, st).verdict === 'ok').map(([id]) => id).sort()]));
    }
    const { schema, computeLabel, L } = HeatpumpFlowCard._formSchema(this._config, tiles,
      { valve: !!valveId, matches: this._matches, fits: this._fits, all: !!this._allEntities, shown, assistant });
    const found = Object.keys(this._fromPreset).length;
    // Core entities the card needs; warn about what is missing (not while a preset is not detected, its field says so).
    const has = (k) => { const id = r.entities[k]; return !!(id && this._hass.states[id]); };
    const warn = [];
    if (!(r.preset && !r.ready)) {
      if (!['mode', 'compressor', 'status', 'power'].some(has)) warn.push(L.warn_running);
      if (!has('power')) warn.push(L.warn_power);
      if (!has('flow') || !has('return')) warn.push(L.warn_temps);
      if (!has('heat') && !has('volume')) warn.push(L.warn_heat);
      // A numeric sensor as the valve without any map: 1 is read as hot water, which is wrong for valves that report 1 for heating.
      if (valveId && valveId.startsWith('sensor.') && /^-?\d+(\.\d+)?$/.test(String(valveState ?? '').trim()) && !Object.keys(valveMap).length) warn.push(L.warn_valve);
    }
    // A value map under `entities` (the mistake in #109) is ignored by the card; say so, the editor cannot show or move it.
    const misplacedMaps = HFC_MAP_KEYS.filter((name) => own && typeof own === 'object' && name in own);
    if (misplacedMaps.length) warn.push(L.warn_map_entities.replace('{maps}', misplacedMaps.join(', ')));
    // Entities of the preset that exist but are disabled (#146), with the field they would fill.
    const disabled = HeatpumpFlowCard._disabledMappings(this._config, this._hass, this._disabled);
    if (disabled.length) {
      const field = (key) => String(computeLabel({ name: key })).replace(/\s*\(.*\)\s*$/, '');
      warn.push(L.warn_disabled.replace('{list}', disabled.map((d) => `${field(d.key)}: ${d.name ? `${d.name} (${d.id})` : d.id}`).join('; ')));
    }
    if (this._config.power_sources !== 'manual' && !['pv', 'battery', 'grid'].some((key) => r.entities[key]) && this._energyMissing?.length) {
      const names = this._energyMissing.map((type) => ({ solar: L.pv, battery: L.battery, grid: L.grid }[type])).join(', ');
      warn.push(L.warn_energy_sources.replace('{sources}', names));
    }
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Plausibility checks (#192): one line per finding above the form, and the same text as the helper of the field. Fields are named
    // by their label without the hint in brackets.
    const fieldName = (key) => String(computeLabel({ name: key })).replace(/\s*\(.*\)\s*$/, '');
    const checks = HeatpumpFlowCard._checks(this._config, this._hass, r);
    this._checkHelp = {};
    checks.forEach((f) => { const text = HeatpumpFlowCard._checkText(f, L, fieldName); this._checkHelp[f.key] = this._checkHelp[f.key] ? `${this._checkHelp[f.key]} ${text}` : text; });
    const list = (items) => `<ul style="margin:0;padding-left:18px">${items.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    // A valve that does not fit at all needs no hint about its value map.
    const info = checks.some((f) => f.key === 'valve') ? warn.filter((w) => w !== L.warn_valve) : warn;
    const html = (checks.length ? `<ha-alert alert-type="warning" title="${esc(L.checks_title)}">${list(checks.map((f) => HeatpumpFlowCard._checkText(f, L, fieldName)))}</ha-alert>` : '')
      + (info.length ? `<ha-alert alert-type="info" title="${esc(L.warn_title)}">${list(info)}</ha-alert>` : '');
    if (this._warn._html !== html) { this._warn.innerHTML = html; this._warn._html = html; this._warn.style.marginBottom = html ? '12px' : '0'; }
    const proposals = assistant ? HeatpumpFlowCard._assistantProposals(this._hass, this._assistantDevice, this._config) : [];
    this._renderAssistant(assistant, proposals, L, computeLabel);
    this._form.hass = this._hass;
    this._form.schema = schema;
    this._form.computeLabel = computeLabel;
    this._form.computeHelper = (s) => {
      if (s.name === 'preset') {
        // Further detected presets: another integration for the same heat pump may suit better (#145).
        const others = (this._matches || []).filter((m) => m.name !== this._config.preset).map((m) => HFC_PRESETS[m.name].name);
        const also = others.length ? ` ${L.also_detected} ${others.join(', ')}.` : '';
        if (!r.preset) return also.trim();
        const status = r.ready ? `${L.detected}${r.prefix ? ` · ${r.prefix}` : ''} · ${found} ${L.entities_found}. ${L.preset_help}` : L.not_detected;
        return `${r.preset.tested ? status : `${status} ${L.untested_help}`}${also}`;
      }
      if (s.name === 'tiles_custom') return tiles.editable ? L.tiles_custom_help : L.tiles_yaml;
      if (s.name === 'price_entity') return L.price_help;
      if (s.name === 'errors') return L.errors_help;
      if (s.name === 'error_ok_text') return L.error_ok_help;
      if (s.name === 'valve_dhw_text' || s.name === 'valve_heating_text') return L.valve_help.replace('{state}', valveState ?? '–');
      if (['energy_total', 'env_energy', 'heat_total'].includes(s.name)) return L.total_cop_help;
      if (s.name === 'language') return L.language_help;
      if (s.name === 'all_entities') return L.all_entities_help;
      if (s.name === 'assistant_device') return L.assistant_device_help;
      if (this._checkHelp[s.name]) return this._checkHelp[s.name];
      if (own[s.name] === undefined && this._fromPreset[s.name]) return L.from_preset;
      if (Array.isArray(own[s.name])) return L.sum_help;
      if (['pv', 'battery', 'grid'].includes(s.name) && !own[s.name] && this._config.power_sources !== 'manual') return L.from_energy;
      return '';
    };
    const custom = Array.isArray(this._config.tiles);
    const controls = r.controls.map((c) => (typeof c === 'string' ? c : c?.entity)).filter(Boolean);
    const data = { ...this._config, entities: shown, controls, timeline_marks: !!this._config.timeline_marks, timeline_details: this._config.timeline_details !== false,
      errors: this._config.errors !== undefined ? this._config.errors : this._presetErrors,
      error_ok_text: (this._config.error_ok !== undefined ? this._config.error_ok : this._presetErrorOk).join(', '), tiles_custom: custom,
      animations: this._config.animations || 'auto', flow_speed: this._config.flow_speed ?? 1, source_spread: this._config.source_spread !== false,
      hc_flow_label: this._config.hc_flow_label !== false,
      theme: this._config.theme || 'auto', fullscreen: this._config.fullscreen !== false, diagnostic: this._config.diagnostic !== false, series_bypass: this._config.series_bypass !== false,
      storage: this._config.storage || 'separate', dhw_type: this._config.dhw_type || 'coil',
      valve_dhw_text: this._valveText.dhw, valve_heating_text: this._valveText.heating, all_entities: !!this._allEntities,
      ...(assistant ? { assistant_device: this._assistantDevice || '' } : {}) };
    if (this._config.controls === undefined && !r.presetControls.length) delete data.controls;
    if (custom && tiles.editable) data.tiles = tiles.value;
    this._priceShown = custom;
    if (custom) {
      const p = this._config.price;
      data.price_fixed = typeof p === 'number' ? p : undefined;
      data.price_entity = typeof p === 'string' ? p : undefined;
    }
    this._form.data = data;
  }

  // Writes back only what differs from the preset: other entities as overrides, cleared preset entities as null.
  _changed(value) {
    // The device choice belongs to the assistant, not to the card. Changing it only computes proposals; no configuration is emitted.
    if (Object.prototype.hasOwnProperty.call(value, 'assistant_device')
      && String(value.assistant_device || '') !== String(this._assistantDevice || '')) {
      this._assistantDevice = value.assistant_device || '';
      this._render();
      return;
    }
    // "Show all entities" (#194) belongs to the editor, not to the card: switching it only redraws the form.
    if (!!value.all_entities !== !!this._allEntities) { this._allEntities = !!value.all_entities; this._render(); return; }
    const own = this._config.entities || {};
    const shownBefore = { ...this._fromPreset, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v)) };
    const next = value.entities || {};
    const ents = {};
    new Set([...Object.keys(next), ...Object.keys(own), ...Object.keys(this._fromPreset)]).forEach((k) => {
      const v = next[k];
      if (v) {
        if (v !== this._fromPreset[k] || own[k] === v) ents[k] = v;
      } else if (this._fromPreset[k] || own[k] === null || own[k] === 'none') {
        // A preset entity that was shown and is now empty, or one that was already removed.
        if (shownBefore[k] || own[k] === null || own[k] === 'none') ents[k] = null;
      }
    });
    const config = { ...value };
    // Nested translations are YAML-only; ha-form does not render them and therefore may omit them from value-changed.
    if (this._config.texts && value.texts === undefined) config.texts = this._config.texts;
    if (this._config.tile_sources && value.tile_sources === undefined) config.tile_sources = this._config.tile_sources;
    // The entity picker deals in ids; keep YAML-only metadata of controls that stay selected.
    if (Array.isArray(value.controls)) {
      const old = new Map((this._config.controls || []).filter((c) => c && typeof c === 'object' && c.entity).map((c) => [c.entity, c]));
      config.controls = value.controls.map((c) => {
        const id = typeof c === 'string' ? c : c?.entity;
        return old.get(id) || id;
      }).filter(Boolean);
      if (this._config.controls === undefined && JSON.stringify(config.controls) === JSON.stringify(this._presetControls)) delete config.controls;
    }
    delete config.error_ok_text; delete config.all_entities; delete config.assistant_device;
    // Valve states (#126): untouched fields keep the YAML map as it is; edited ones write back only what differs from the preset.
    delete config.valve_dhw_text; delete config.valve_heating_text;
    // ha-form may drop a text field that was cleared, so a missing value counts as empty while the fields are shown.
    const shown = this._valveShown;
    const dhwText = shown ? value.valve_dhw_text ?? '' : this._valveText?.dhw ?? ''; const heatText = shown ? value.valve_heating_text ?? '' : this._valveText?.heating ?? '';
    if (this._valveText && (dhwText !== this._valveText.dhw || heatText !== this._valveText.heating)) {
      const list = (text) => String(text).split(',').map((state) => state.trim()).filter(Boolean);
      const wanted = {};
      list(dhwText).forEach((state) => { wanted[state] = 'dhw'; });
      list(heatText).forEach((state) => { wanted[state] = 'heating'; });
      const preset = Object.fromEntries(Object.entries(this._presetValveMap || {}).map(([k, v]) => [k.toLowerCase(), hfcValveSide(v)]));
      const own = Object.fromEntries(Object.entries(wanted).filter(([state, side]) => preset[state.toLowerCase()] !== side));
      if (Object.keys(own).length) config.valve_map = own; else delete config.valve_map;
    } else if (this._config.valve_map !== undefined) config.valve_map = this._config.valve_map;
    else delete config.valve_map;
    // The switch only knows on and off; a YAML list of marks stays as it is while the switch stays on.
    if (value.timeline_details !== false) delete config.timeline_details;
    if (!value.timeline_marks) delete config.timeline_marks;
    else if (Array.isArray(this._config.timeline_marks)) config.timeline_marks = this._config.timeline_marks;
    if (!value.animations || value.animations === 'auto') delete config.animations;
    if (!value.theme || value.theme === 'auto') delete config.theme;
    if (value.fullscreen !== false) delete config.fullscreen;
    if (value.diagnostic !== false) delete config.diagnostic;
    if (value.flow_speed === undefined || value.flow_speed === null || value.flow_speed === '' || +value.flow_speed === 1) delete config.flow_speed;
    if (value.source_spread !== false) delete config.source_spread;
    if (value.hc_flow_label !== false) delete config.hc_flow_label;
    // Storage defaults stay out of the configuration. An option that does not go with the chosen storage is cleared, because the
    // editor hides its field and the card would reject the combination.
    if (!value.storage || value.storage === 'separate') delete config.storage;
    if (config.storage === 'combined') { delete config.buffer; delete config.series_buffer; delete config.series_bypass; }
    // The two switches select different hydraulic strategies. When one is newly enabled, clear the other instead of emitting an
    // invalid configuration; hand-written YAML with both stays rejected by setConfig.
    const bufferChanged = !!value.buffer !== !!this._config.buffer;
    const seriesChanged = !!value.series_buffer !== !!this._config.series_buffer;
    if (value.buffer && bufferChanged) { delete config.series_buffer; delete config.series_bypass; }
    else if (value.series_buffer && seriesChanged) delete config.buffer;
    if (!value.buffer) delete config.buffer;
    // series_bypass only matters as false next to a series buffer; the switch's default (true) is not written.
    if (!config.series_buffer || value.series_bypass !== false) delete config.series_bypass;
    if (!value.dhw_type || value.dhw_type === 'coil' || (value.dhw_type === 'tank_in_tank' && config.storage !== 'combined')) delete config.dhw_type;
    const errorOk = String(value.error_ok_text || '').split(',').map((state) => state.trim()).filter(Boolean);
    if (JSON.stringify(errorOk) !== JSON.stringify(this._presetErrorOk || [])) config.error_ok = errorOk; else delete config.error_ok;
    const errors = Array.isArray(value.errors) ? value.errors.filter(Boolean) : [];
    if (JSON.stringify(errors) !== JSON.stringify(this._presetErrors || [])) config.errors = errors; else delete config.errors;
    if (Object.keys(ents).length) config.entities = ents; else delete config.entities;
    // Tiles: off = default tiles; switched on = start from the default set; tiles with own options stay as in YAML.
    delete config.tiles_custom;
    delete config.price_fixed; delete config.price_entity;
    if (this._priceShown) {
      if (value.price_entity) config.price = value.price_entity;
      else if (Number.isFinite(value.price_fixed)) config.price = value.price_fixed;
      else delete config.price;
    }
    if (!value.tiles_custom) delete config.tiles;
    else if (!Array.isArray(this._config.tiles)) config.tiles = this._tiles.defaults;
    else if (!this._tiles.editable) config.tiles = this._config.tiles;
    this._config = config;
    this._loadEnergyInfo();
    this._loadRegistry();
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
    this._render();
  }
}
// Registration. Other cards use the same generic element names (heatpump-flow-card, heatpump-flow-card-editor) and a browser keeps only the
// first definition, so this card is always available under names of its own as well: custom:heatpump-hydraulic-card.
HeatpumpFlowCard.hfcOwner = 'sturmi77';
HeatpumpFlowCardEditor.hfcOwner = 'sturmi77';
// The version marker tells this script whether another copy of the card took the element names first (#171).
HeatpumpFlowCard.hfcVersion = HFC_VERSION;
HeatpumpFlowCardEditor.hfcVersion = HFC_VERSION;
class HeatpumpHydraulicCard extends HeatpumpFlowCard {
  static getConfigElement() { return document.createElement('heatpump-hydraulic-card-editor'); }
}
class HeatpumpHydraulicCardEditor extends HeatpumpFlowCardEditor {}
const hfcDefine = (name, cls) => { if (!customElements.get(name)) customElements.define(name, cls); };
// A class of this card from another copy of the script: marked since 0.9.3, recognised by its name before.
const hfcOwnCopy = (cls) => !!cls && (cls.hfcOwner === 'sturmi77' || ['HeatpumpFlowCard', 'HeatpumpHydraulicCard'].includes(cls.name));
const hfcMine = (name) => { const c = customElements.get(name); return !c || hfcOwnCopy(c); };
const hfcNewer = (a, b) => {
  const p = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a); const y = p(b);
  for (let n = 0; n < 3; n++) if ((x[n] || 0) !== (y[n] || 0)) return (x[n] || 0) > (y[n] || 0);
  return false;
};
// An older copy of this card that owns an element name: releases before 0.15 carry no version marker. A newer copy, the same
// version loaded twice and a foreign card with the same name are no conflict here.
const hfcOlderCopy = (cls, own = HFC_VERSION) => (hfcOwnCopy(cls) && (!cls.hfcVersion || hfcNewer(own, cls.hfcVersion))
  ? { version: cls.hfcVersion || 'older than 0.15' } : null);
// Every script of this card the page loaded, without query strings; the first one wins the element names.
const hfcCardScripts = () => {
  const re = /heatpump-(flow|hydraulic)-card[^/?#]*\.js/;
  let urls = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  try { urls = urls.concat(performance.getEntriesByType('resource').map((r) => r.name)); } catch (e) { /* no timing API */ }
  return [...new Set(urls.filter((u) => re.test(u)).map((u) => u.replace(/[?#].*$/, '')))];
};
// The warning for an older copy: in the console, and once per browser session as a Home Assistant notification, because the
// dashboard keeps running the old code and nothing else would show it (#166).
const hfcOldCopyText = (conflict, scripts = hfcCardScripts()) => {
  const others = scripts.filter((u) => u !== HFC_SCRIPT_URL.replace(/[?#].*$/, ''));
  return `An older copy of the Heat Pump Hydraulic Card (${conflict.version}) was loaded before version ${HFC_VERSION}, so dashboards still run the old one.`
    + `${others.length ? ` Card scripts on this page: ${others.join(', ')}.` : ''}`
    + ' In Settings → Dashboards → ⋮ → Resources, delete the resource of the old copy (on installations from before the rename: every entry with'
    + ' "heatpump-flow-card"), delete the folder /config/www/community/heatpump-flow-card/ if it exists, and reload the browser.'
    + ' Details: https://github.com/Sturmi77/heatpump-hydraulic-card#upgrading-an-installation-from-before-the-rename';
};
const hfcNotifyOldCopy = (text, getHass = () => document.querySelector('home-assistant')?.hass, tries = 20) => {
  try { if (sessionStorage.getItem('hfc-old-copy')) return; } catch (e) { /* storage blocked: notify anyway */ }
  const hass = getHass();
  if (typeof hass?.callService !== 'function') { if (tries > 0) setTimeout(() => hfcNotifyOldCopy(text, getHass, tries - 1), 3000); return; }
  try { sessionStorage.setItem('hfc-old-copy', '1'); } catch (e) { /* storage blocked */ }
  Promise.resolve(hass.callService('persistent_notification', 'create', {
    notification_id: 'heatpump_hydraulic_card_old_copy', title: 'Heat Pump Hydraulic Card: an older copy is loaded', message: text,
  })).catch(() => {});
};
const hfcConflict = hfcOlderCopy(customElements.get('heatpump-flow-card')) || hfcOlderCopy(customElements.get('heatpump-hydraulic-card'));
hfcDefine('heatpump-hydraulic-card-editor', HeatpumpHydraulicCardEditor);
hfcDefine('heatpump-hydraulic-card', HeatpumpHydraulicCard);
hfcDefine('heatpump-flow-card-editor', HeatpumpFlowCardEditor);
hfcDefine('heatpump-flow-card', HeatpumpFlowCard);
if (hfcConflict) {
  const text = hfcOldCopyText(hfcConflict);
  console.warn(`heatpump-flow-card: ${text}`);
  hfcNotifyOldCopy(text);
}
// The card picker lists the card once: with the generic element name when this card owns it, otherwise with the unique one; the
// shown name is always "Heat Pump Hydraulic Card", as in HACS and the README (#144).
const hfcGeneric = hfcMine('heatpump-flow-card') && hfcMine('heatpump-flow-card-editor');
if (!hfcGeneric) {
  console.warn('heatpump-flow-card: the element name "heatpump-flow-card" is already used by another card, so "type: custom:heatpump-flow-card" opens that card. '
    + 'Use "type: custom:heatpump-hydraulic-card" for this card (github.com/Sturmi77/heatpump-hydraulic-card).');
}
const hfcType = hfcGeneric ? 'heatpump-flow-card' : 'heatpump-hydraulic-card';
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === hfcType)) {
  window.customCards.push({
    type: hfcType,
    name: 'Heat Pump Hydraulic Card',
    description: 'Animated hydraulic schematic of a heat pump with tanks, heating circuits and power sources. Presets for Lambda, Viessmann, Vaillant, Bosch/Buderus, Panasonic, Wolf, Kronoterm, Luxtronik, Stiebel Eltron, Samsung and more.',
    preview: true,
    documentationURL: 'https://github.com/Sturmi77/heatpump-hydraulic-card',
  });
}
console.info(`%c HEATPUMP-FLOW-CARD %c ${HFC_VERSION} `, 'background:#f97316;color:#fff;border-radius:3px 0 0 3px', 'background:#334155;color:#fff;border-radius:0 3px 3px 0');
