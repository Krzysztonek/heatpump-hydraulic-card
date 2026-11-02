// Completeness of the presets and the built-in languages, generated from the card itself (docs/COVERAGE.md).
//
//   node scripts/coverage.mjs           write docs/COVERAGE.md and the coverage cells of README.md (npm run coverage)
//   node scripts/coverage.mjs --check   fail when upstream/<preset>.json lists a wrong role (npm run syntax); out-of-date files
//                                       are a note, and fail only on a release branch (release-<version>)
//   node scripts/coverage.mjs --open    list the open roles of every preset (roles neither mapped nor listed as unmapped)
//
// A preset is measured by what it can map, not by one installation: the card loads in a sandbox, and every lookup of the preset
// (entity ids, translation keys, patterns) is answered as if the entity existed. The demo installations of the preset only
// supply the prefix and the registry that its detection needs. A role the integration does not offer is listed with a reason
// under "unmapped" in upstream/<preset>.json; it leaves the percentage. Everything else that is not mapped stays "open".
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const args = process.argv.slice(2);

// The card and the demo installations in a sandbox with just enough of a browser to define the element.
const load = () => {
  const elements = new Map();
  const sandbox = {
    console: { ...console, info() {} }, setTimeout, clearTimeout, setInterval, clearInterval, URL, Intl,
    HTMLElement: class {}, customElements: { define: (name, element) => elements.set(name, element), get: (name) => elements.get(name) },
    document: { currentScript: null, createElement: () => ({}) }, navigator: { language: 'en' }, location: { href: 'http://localhost/' },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${read('dist/heatpump-hydraulic-card.js')}
globalThis.__card = { HFC_PRESETS, HFC_TILES, HFC_LANGUAGES, HFC_I18N, HFC_EDITOR, HFC_CORE_FIELDS, hfcTileSourceKey };`, sandbox, { filename: 'heatpump-hydraulic-card.js' });
  vm.runInContext(`${read('demo/setups.js')}\nglobalThis.__setups = setups;`, sandbox, { filename: 'setups.js' });
  return { ...sandbox.__card, setups: sandbox.__setups, Card: elements.get('heatpump-flow-card') };
};

// The roles of an integration, by area. Roles that depend on the installation rather than on the integration (a boiler, the
// heater rods at three heights, a bypass valve, power sources, circuits 2 to 6) are not counted.
const AREAS = {
  heat_pump: ['mode', 'status', 'compressor', 'fan_speed', 'defrost', 'power', 'heat', 'flow', 'return', 'volume', 'source_volume',
    'source_in', 'source_out', 'brine_pressure', 'outdoor', 'valve', 'heater', 'pv_boost'],
  storage: ['dhw_top', 'dhw_middle', 'dhw_bottom', 'dhw_target', 'dhw_mode', 'circulation', 'dhw_heater', 'buffer_top', 'buffer_middle',
    'buffer_bottom', 'buffer_mode', 'buffer_heater', 'solar_collector', 'solar_pump'],
  circuit: ['hc_flow', 'hc_return', 'hc_setpoint', 'hc_mode', 'hc_pump', 'hc_volume', 'hc_curve_offset', 'hc_mixer', 'hc_pressure', 'room',
    'room_target', 'program'],
  details: ['hours', 'starts_total', 'aux_hours', 'energy_total', 'env_energy', 'heat_total', 'compressor_speed', 'evap_temp', 'cond_temp',
    'suction_temp', 'hot_gas', 'liquid_temp', 'low_pressure', 'high_pressure', 'eev', 'superheat', 'subcooling', 'cutout_high_pressure',
    'cutout_low_pressure', 'cutout_temperature'],
};
const AREA_NAMES = { heat_pump: 'Heat pump', storage: 'Tanks', circuit: 'Heating circuit', details: 'Details' };
const ROLES = Object.values(AREAS).flat();
// What the card shows without the entity itself: the operating mode from the compressor (and the valve), whether the heat pump
// runs from its status or its power, the diverter position from the operating mode, a mixer from its opening and closing outputs.
const STANDS_IN = { mode: ['compressor'], compressor: ['status', 'power', 'mode'], valve: ['mode'], hc_mixer: ['hc_mixer_opening'] };

const toStates = (obj) => Object.fromEntries(Object.entries(obj).map(([id, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return [id, { entity_id: id, attributes: {}, ...v }];
  const [state, unit] = Array.isArray(v) ? v : [v];
  return [id, { entity_id: id, state, attributes: unit ? { unit_of_measurement: unit } : {} }];
}));

// Resolves a preset as if every entity it looks for existed. `base` is a demo installation (or an empty one) for the detection.
const resolveAll = (card, preset, base) => {
  const { Card } = card;
  const states = new Proxy(base.states, {
    get: (target, id) => target[id] || (typeof id === 'string' && /^[a-z_]+\.\S+$/.test(id) ? { entity_id: id, state: '1', attributes: {} } : undefined),
    has: () => true,
  });
  const realCtx = Card._ctx;
  Card._ctx = (hass, device, idx) => {
    const ctx = realCtx({ ...base }, device, idx);
    return {
      ...ctx,
      key: (platform, domain, key) => ctx.key(platform, domain, key) || `${domain}.${platform}_${key}`,
      match: (re, platform) => ctx.match(re, platform) || `sensor.pattern_${re.source.replace(/\W/g, '').slice(0, 60)}`,
    };
  };
  try {
    return Card._resolve({ preset }, { ...base, states, locale: { language: 'en' }, language: 'en' });
  } finally {
    Card._ctx = realCtx;
  }
};

export const measure = () => {
  const card = load();
  const presets = {};
  for (const [name, preset] of Object.entries(card.HFC_PRESETS)) {
    const bases = card.setups.filter((s) => s.config.preset === name).map((s) => ({ states: toStates(s.states('heat')), entities: s.registry || {} }));
    if (!bases.length) bases.push({ states: {}, entities: {} });
    const keys = new Set(); const tiles = new Set();
    let errors = false; let controls = false; let details = false;
    for (const base of bases) {
      const r = resolveAll(card, name, base);
      Object.keys(r.fromPreset).forEach((k) => keys.add(k));
      Object.keys(r.tiles).forEach((k) => tiles.add(k));
      errors ||= r.presetErrors.length > 0;
      controls ||= r.presetControls.length > 0;
      details ||= r.details.length > 0;
    }
    // A ratio tile (COP = heat ÷ electricity, hours per start) is filled when the preset supplies both of its counters.
    const catalog = Object.keys(card.HFC_TILES).filter(card.hfcTileSourceKey);
    catalog.filter((k) => card.HFC_TILES[k].ratio?.every((part) => tiles.has(part))).forEach((k) => tiles.add(k));
    // A defrost the operating mode reports (a mode text mapped to defrost) needs no defrost entity.
    if (Object.values(preset.mode_map || {}).includes('defrost')) keys.add('defrost');
    const manifest = existsSync(resolve(root, `upstream/${name}.json`)) ? JSON.parse(read(`upstream/${name}.json`)) : {};
    const unmapped = manifest.unmapped || {};
    const state = (role) => (keys.has(role) ? 'mapped' : (STANDS_IN[role] || []).some((k) => keys.has(k)) ? 'derived'
      : unmapped[role] ? 'unmapped' : 'open');
    const roles = Object.fromEntries(ROLES.map((role) => [role, state(role)]));
    const core = card.HFC_CORE_FIELDS.filter((role) => ROLES.includes(role));
    const statusLanguages = [...new Set([...Object.keys(preset.status_labels || {}),
      ...Object.values(preset.stat_labels || {}).flatMap((labels) => Object.keys(labels))])];
    presets[name] = {
      name: preset.name, tested: !!preset.tested, unitStyle: preset.unit_style || 'generic', roles, core, unmapped,
      tiles: catalog.filter((k) => tiles.has(k)), catalog, errors, controls, details, statusLanguages,
      problems: Object.entries(unmapped).flatMap(([role, reason]) => {
        if (!ROLES.includes(role)) return [`upstream/${name}.json: unmapped lists "${role}", which is not a counted role`];
        if (['mapped', 'derived'].includes(roles[role])) return [`upstream/${name}.json: "${role}" is mapped by the preset but listed as unmapped`];
        if (typeof reason !== 'string' || !reason.trim()) return [`upstream/${name}.json: unmapped.${role} needs a reason`];
        return [];
      }),
    };
  }
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const leaves = (obj, prefix = '') => Object.entries(obj || {}).flatMap(([k, v]) => (isObject(v) ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const texts = (table) => {
    const reference = leaves(table.en);
    return Object.fromEntries(Object.keys(card.HFC_LANGUAGES).map((code) => {
      const have = new Set(leaves(table[code]));
      return [code, { have: reference.filter((k) => have.has(k)).length, total: reference.length }];
    }));
  };
  const languages = { card: texts(card.HFC_I18N), editor: texts(card.HFC_EDITOR) };
  return { card, presets, languages };
};

// Whole percent, rounded down: 99.6 % is not complete.
const percent = (have, total) => (total ? Math.floor((100 * have) / total) : 100);
const coreScore = (p) => {
  const counted = p.core.filter((role) => p.roles[role] !== 'unmapped');
  const have = counted.filter((role) => ['mapped', 'derived'].includes(p.roles[role]));
  return { have: have.length, total: counted.length, open: counted.length - have.length, unmapped: p.core.length - counted.length,
    percent: percent(have.length, counted.length) };
};
const further = (p) => {
  const roles = ROLES.filter((role) => !p.core.includes(role));
  return { have: roles.filter((role) => ['mapped', 'derived'].includes(p.roles[role])).length, total: roles.length };
};

const code = (k) => `\`${k}\``;
const list = (roles) => roles.map(code).join(', ') || '–';

const presetsMarkdown = (presets) => {
  const rows = Object.entries(presets).map(([name, p]) => {
    const c = coreScore(p); const f = further(p);
    const named = (state) => p.core.filter((role) => p.roles[role] === state);
    return `| [${code(name)}](#${name}) | ${c.percent} % | ${c.open ? list(named('open')) : '–'} | ${c.unmapped ? list(named('unmapped')) : '–'} | ${f.have} of ${f.total} | ${p.tiles.length} of ${p.catalog.length} | ${p.errors ? 'yes' : '–'} | ${p.controls ? 'yes' : '–'} | ${p.statusLanguages.join(', ') || '–'} |`;
  });
  const sections = Object.entries(presets).map(([name, p]) => {
    const areaRows = Object.entries(AREAS).map(([area, roles]) => {
      const pick = (state) => roles.filter((role) => p.roles[role] === state);
      const core = (role) => (p.core.includes(role) ? `**${code(role)}**` : code(role));
      return `| ${AREA_NAMES[area]} | ${pick('mapped').map(core).join(', ') || '–'} | ${pick('derived').map(core).join(', ') || '–'} | ${pick('unmapped').map(core).join(', ') || '–'} | ${pick('open').map(core).join(', ') || '–'} |`;
    });
    const reasons = Object.entries(p.unmapped).filter(([role]) => p.roles[role] === 'unmapped').map(([role, reason]) => `- ${code(role)}: ${reason}`);
    return [`### ${name}`, '', `${p.name}. Core fields ${coreScore(p).percent} %, stat tiles: ${list(p.tiles)}.`, '',
      '| Area | Mapped | Shown without its own entity | Not mapped, with reason | Open |', '|---|---|---|---|---|', ...areaRows,
      ...(reasons.length ? ['', 'Not mapped:', '', ...reasons] : [])].join('\n');
  });
  return { summary: ['| Preset | Core fields | Open core fields | Core fields not offered | Further roles | Stat tiles | Error chip | Quick controls | Preset texts in |',
    '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n'), sections: sections.join('\n\n') };
};

const languagesMarkdown = (card, languages) => ['| Language | Card texts | Editor |', '|---|---|---|',
  ...Object.entries(card.HFC_LANGUAGES).filter(([lang]) => lang !== 'en').map(([lang, label]) => {
    const cell = ({ have, total }) => `${percent(have, total)} %${have < total ? ` (${total - have} missing)` : ''}`;
    return `| ${label} (${code(lang)}) | ${cell(languages.card[lang])} | ${cell(languages.editor[lang])} |`;
  })].join('\n');

const coverageDoc = ({ card, presets, languages }) => {
  const { summary, sections } = presetsMarkdown(presets);
  return `<!-- Generated by \`npm run coverage\` (scripts/coverage.mjs) from the card. Do not edit by hand. -->
# Coverage of the presets and languages

How much of the card each preset fills, and how much of the card and editor text each built-in language has. The numbers come from the card itself: \`npm run coverage\` writes this page and the coverage cells in the README, and every release brings them up to date.

## How a preset is measured

A preset is measured by what it can map, not by one installation: every lookup of the preset (entity ids, translation keys, patterns) is answered as if the entity existed. Each role of the card is then one of:

- **mapped**: the preset maps an entity for it;
- **shown without its own entity**: the card shows it from another value (the operating mode from the compressor and the diverter valve, whether the heat pump runs from its status, power or mode, the diverter position from the operating mode, defrost from the operating mode, a mixer from its opening and closing outputs);
- **not mapped, with reason**: the integration does not offer it, or what it offers does not fit; the reason is in \`unmapped\` of [\`upstream/<preset>.json\`](../upstream/README.md);
- **open**: none of these. Either the preset could map it, or the reason is still to be written down.

**Core fields** are the fields the card editor shows first (${list(presets[Object.keys(presets)[0]].core)}). Their percentage counts the core fields the integration offers: a field that is not mapped with a reason is left out, and listed as not offered. **Further roles** count the other roles of an integration: source, tanks, heating circuit, operating data and the refrigerant circuit. Roles that depend on the installation rather than on the integration (a boiler, heater rods at three heights, a bypass valve, power sources, circuits 2 to 6) are not counted. **Stat tiles** are the catalog tiles a preset can fill from its own counters, including the COP from heat and electricity; tiles computed from live values work with every preset and are not counted.

The percentage says how complete a preset is, not how well it was tested: see the test status in [Supported heat pumps](../README.md#supported-heat-pumps).

## Presets

${summary}

## Languages

English is the reference. A text without a translation shows in English.

${languagesMarkdown(card, languages)}

## Details per preset

Core fields in **bold**.

${sections}

## Improving a number

- An open role the integration offers: map it in the preset (with evidence, see [CONTRIBUTING](../CONTRIBUTING.md)).
- An open role the integration does not offer: add it with a short reason to \`unmapped\` in \`upstream/<preset>.json\`.
- A missing text: \`npm run i18n:check -- --missing <language>\` lists it ([translating](TRANSLATING.md)).

Then run \`npm run coverage\`.
`;
};

// README: the coverage link of every preset in the list of supported heat pumps ("[92 %](docs/COVERAGE.md#heishamon), 1 open",
// with a no-break space so that a narrow screen keeps the number and the percent sign together), and the language table.
const readmeWith = (readme, { card, presets, languages }) => {
  const seen = {};
  let text = readme.replace(/\[\d+[ \u00a0]%\]\(docs\/COVERAGE\.md#([a-z0-9_]+)\)(?:, \d+ open)?/g, (link, name) => {
    if (!presets[name]) throw new Error(`README.md: coverage link to unknown preset "${name}"`);
    seen[name] = (seen[name] || 0) + 1;
    const c = coreScore(presets[name]);
    return `[${c.percent} %](docs/COVERAGE.md#${name})${c.open ? `, ${c.open} open` : ''}`;
  });
  const wrong = Object.keys(presets).filter((name) => seen[name] !== 1);
  if (wrong.length) throw new Error(`README.md: needs exactly one coverage link "[0 %](docs/COVERAGE.md#<preset>)" for ${wrong.join(', ')}`);
  const lines = text.split('\n');
  const start = lines.indexOf('<!-- coverage:languages -->'); const end = lines.indexOf('<!-- /coverage:languages -->');
  if (start < 0 || end < start) throw new Error('README.md: the language table needs the markers <!-- coverage:languages --> and <!-- /coverage:languages -->');
  lines.splice(start + 1, end - start - 1, languagesMarkdown(card, languages));
  return lines.join('\n');
};

const run = () => {
  const result = measure();
  const problems = Object.values(result.presets).flatMap((p) => p.problems);
  const files = { 'docs/COVERAGE.md': coverageDoc(result), 'README.md': readmeWith(read('README.md'), result) };
  return { result, problems, files };
};

if (args.includes('--open')) {
  const { presets } = measure();
  for (const [name, p] of Object.entries(presets)) {
    const open = (roles) => roles.filter((role) => p.roles[role] === 'open');
    console.log(`\n${name}\n  core: ${open(p.core).join(', ') || '-'}`);
    for (const [area, roles] of Object.entries(AREAS)) {
      const rest = open(roles.filter((role) => !p.core.includes(role)));
      if (rest.length) console.log(`  ${area}: ${rest.join(', ')}`);
    }
    p.problems.forEach((problem) => console.log(`  PROBLEM ${problem}`));
  }
} else {
  const { problems, files } = run();
  const stale = Object.entries(files).filter(([path, text]) => !existsSync(resolve(root, path)) || read(path) !== text).map(([path]) => path);
  if (args.includes('--check')) {
    // Contributions do not touch the README (CONTRIBUTING.md), so the files are brought up to date in the release pull request
    // (npm run changelog:compile writes them). Its branch (release-<version>) fails when they are stale. A tag build only
    // notes it: the release exists by then, and a failed check would skip attaching the card file.
    const branch = process.env.GITHUB_HEAD_REF || (process.env.GITHUB_REF_TYPE === 'branch' ? process.env.GITHUB_REF_NAME : '') || '';
    const release = /(^|\/)release[-/]/.test(branch);
    const note = `${stale.join(' and ')} out of date: run npm run coverage`;
    if (stale.length && release) problems.push(note);
    if (problems.length) { console.error(problems.map((p) => `- ${p}`).join('\n')); process.exit(1); }
    console.log(stale.length ? `Coverage valid; ${note} before the release.` : 'Coverage valid and up to date.');
  } else {
    if (problems.length) { console.error(problems.map((p) => `- ${p}`).join('\n')); process.exitCode = 1; }
    stale.forEach((path) => writeFileSync(resolve(root, path), files[path]));
    console.log(stale.length ? `Written: ${stale.join(', ')}` : 'Coverage up to date.');
  }
}
