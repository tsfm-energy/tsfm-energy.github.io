/* ForecastPowerBench interactive model ranker.
 * Put the two public CSVs at the paths below, or edit these constants.
 * merged_system_metrics.csv: model accuracy + aggregated system metrics
 * raw_system_metrics.csv: per-run system telemetry
 */
const FPB_MERGED_CSV = 'data/merged_system_metrics.csv';
const FPB_RAW_CSV = 'data/raw_system_metrics.csv';

const fpbAliases = {
  model: ['model_name','model','model name','model_id','modelname'],
  device: ['execution_device','device_category','hardware','device','platform','gpu_name','device_name'],
  context: ['context_len','context_length','context','input_length','lookback_len'],
  horizon: ['horizon_len','forecast_horizon','horizon','prediction_length','pred_len'],
  batch: ['batch_size','batch','inference_batch_size'],
  mase: ['mase','mase_median','median_mase','test_mase','accuracy_mase'],
  mape: ['mape','mape_median','median_mape','test_mape','accuracy_mape'],
  mae: ['mae','mae_mean','test_mae','accuracy_mae'],
  rmse: ['rmse','rmse_mean','test_rmse','accuracy_rmse'],
  smape: ['smape','smape_mean','test_smape','accuracy_smape'],
  throughput: ['throughput_windows_per_sec_mean','throughput_windows_per_sec','throughput_windows_s','windows_per_sec','throughput','throughput_mean'],
  throughputPoints: ['throughput_points_per_sec_mean','throughput_points_per_sec','points_per_sec'],
  epf: ['energy_per_forecast_j','energy_per_window_j_mean','energy_per_window_j','dynamic_energy_per_window_j_mean','epf_j','energy_per_forecast','energy_per_window','joules_per_forecast','joules_per_window'],
  totalEnergy: ['total_energy_j_mean','total_energy_j','dynamic_energy_j_mean','energy_j','gpu_energy_j','system_energy_j','energy_consumed_j','total_energy'],
  windows: ['total_windows','num_forecasts','n_forecasts','forecast_windows','windows_processed'],
  memory: ['peak_gpu_memory_used_gb_mean','peak_gpu_memory_used_gb','peak_gpu_memory_mb','gpu_memory_peak_mb','peak_memory_mb','max_gpu_memory_mb','peak_gpu_memory_gb','peak_memory_gb','gpu_memory_used_mb']
};

const fpbNormKey = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
function fpbFindKey(row, candidates) {
  const lookup = new Map(Object.keys(row || {}).map(k => [fpbNormKey(k), k]));
  for (const candidate of candidates) {
    const normalized = fpbNormKey(candidate);
    if (lookup.has(normalized)) return lookup.get(normalized);
    for (const suffix of ['mean','median']) if (lookup.has(normalized + suffix)) return lookup.get(normalized + suffix);
  }
  return null;
}
function fpbValue(row, candidates) {
  const key = fpbFindKey(row, candidates);
  if (!key || row[key] == null || String(row[key]).trim() === '') return null;
  const n = Number(String(row[key]).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function fpbText(row, candidates) {
  const key = fpbFindKey(row, candidates);
  return !key || row[key] == null || String(row[key]).trim() === '' ? null : String(row[key]).trim();
}
function fpbParseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = ''; if (row.some(v => String(v).trim())) rows.push(row); row = [];
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some(v => String(v).trim())) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim().replace(/^\uFEFF/, ''));
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}
async function fpbLoadCSV(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return fpbParseCSV(await response.text());
}
function fpbUnique(rows, candidates) {
  return [...new Set(rows.map(r => fpbText(r, candidates)).filter(v => v !== null))].sort((a,b) => {
    const na = Number(a), nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });
}
function fpbPopulateSelect(id, values, allLabel, preferred = null) {
  const select = document.getElementById(id), previous = select.value;
  select.innerHTML = '';
  const all = document.createElement('option'); all.value = ''; all.textContent = allLabel; select.appendChild(all);
  values.forEach(value => { const opt = document.createElement('option'); opt.value = value; opt.textContent = value; select.appendChild(opt); });
  if (values.includes(previous)) select.value = previous;
  else if (preferred && values.includes(String(preferred))) select.value = String(preferred);
  else if (values.length) select.value = values[0];
}
function fpbMean(values) { const nums = values.filter(Number.isFinite); return nums.length ? nums.reduce((a,b) => a+b, 0) / nums.length : null; }
function fpbEfficiencyValue(row, metric) {
  if (metric === 'throughput') return fpbValue(row, fpbAliases.throughput) ?? fpbValue(row, fpbAliases.throughputPoints);
  if (metric === 'epf') {
    const direct = fpbValue(row, fpbAliases.epf);
    if (direct !== null) return direct;
    const energy = fpbValue(row, fpbAliases.totalEnergy), windows = fpbValue(row, fpbAliases.windows);
    return energy !== null && windows > 0 ? energy / windows : null;
  }
  const memory = fpbValue(row, fpbAliases.memory);
  if (memory === null) return null;
  const key = fpbFindKey(row, fpbAliases.memory);
  return key && /gb/i.test(key) ? memory * 1024 : memory;
}
function fpbMatches(row, filters) {
  return [['device',fpbAliases.device],['context',fpbAliases.context],['horizon',fpbAliases.horizon],['batch',fpbAliases.batch]]
    .every(([name, aliases]) => !filters[name] || String(fpbText(row, aliases)) === String(filters[name]));
}
function fpbNormalize(values, lowerIsBetter) {
  const nums = values.map(v => v.value), min = Math.min(...nums), max = Math.max(...nums);
  return values.map(v => ({...v, utility: max === min ? 1 : Math.max(0, Math.min(1, lowerIsBetter ? (max-v.value)/(max-min) : (v.value-min)/(max-min)))}));
}
function fpbFmt(value, digits=3) { return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined,{maximumFractionDigits:digits}); }
function fpbEscape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let fpbMergedRows = [], fpbRawRows = [], fpbDataReady = false;
async function fpbInitRanker() {
  const status = document.getElementById('ranker-status');
  try {
    const [merged, raw] = await Promise.all([fpbLoadCSV(FPB_MERGED_CSV), fpbLoadCSV(FPB_RAW_CSV)]);
    fpbMergedRows = merged; fpbRawRows = raw;
    if (!merged.length || !raw.length) throw new Error('One or both CSV files contain no data rows.');
    fpbDataReady = true;
    fpbPopulateSelect('ranker-device', fpbUnique(merged,fpbAliases.device), 'All available platforms', 'NVIDIA H100');
    fpbPopulateSelect('ranker-context', fpbUnique(merged,fpbAliases.context), 'All available contexts', '512');
    fpbPopulateSelect('ranker-horizon', fpbUnique(merged,fpbAliases.horizon), 'All available horizons', '48');
    fpbPopulateSelect('ranker-batch', fpbUnique(merged,fpbAliases.batch), 'All available batch sizes', '512');
    status.className = 'ranker-status ok';
    status.textContent = `Loaded ${merged.length.toLocaleString()} merged rows and ${raw.length.toLocaleString()} raw telemetry rows.`;
    fpbUpdateRankings();
  } catch (error) {
    status.className = 'ranker-status error';
    status.textContent = `Could not load benchmark CSVs: ${error.message}. Check FPB_MERGED_CSV and FPB_RAW_CSV in static/js/ranker.js, and ensure both files are committed to the GitHub Pages repository. Test via GitHub Pages or a local web server, not by opening the HTML with file://.`;
    document.getElementById('ranker-table-body').innerHTML = '<tr><td colspan="7">CSV files could not be loaded.</td></tr>';
    document.getElementById('ranker-summary').innerHTML = '';
  }
}
function fpbUpdateRankings() {
  if (!fpbDataReady) return;
  const alpha = Number(document.getElementById('alpha-slider').value);
  document.getElementById('alpha-value').textContent = alpha.toFixed(2);
  const filters = {device:document.getElementById('ranker-device').value,context:document.getElementById('ranker-context').value,horizon:document.getElementById('ranker-horizon').value,batch:document.getElementById('ranker-batch').value};
  const accuracyName = document.getElementById('ranker-accuracy').value, accuracyAliases = fpbAliases[accuracyName.toLowerCase()];
  const efficiencyMetric = document.getElementById('ranker-efficiency').value;
  const accuracyRows = fpbMergedRows.filter(r => fpbMatches(r,filters)), rawRows = fpbRawRows.filter(r => fpbMatches(r,filters));
  const byModel = new Map();
  accuracyRows.forEach(row => {
    const model = fpbText(row,fpbAliases.model), accuracy = fpbValue(row,accuracyAliases);
    if (!model || accuracy === null) return;
    if (!byModel.has(model)) byModel.set(model,{model,accuracyValues:[],mergedRows:[]});
    byModel.get(model).accuracyValues.push(accuracy); byModel.get(model).mergedRows.push(row);
  });
  const candidates = [];
  for (const item of byModel.values()) {
    const accuracy = fpbMean(item.accuracyValues), modelRaw = rawRows.filter(r => fpbText(r,fpbAliases.model) === item.model);
    let values = modelRaw.map(r => fpbEfficiencyValue(r,efficiencyMetric)).filter(v => v !== null), source = 'raw';
    if (!values.length) { values = item.mergedRows.map(r => fpbEfficiencyValue(r,efficiencyMetric)).filter(v => v !== null); source = 'merged'; }
    const efficiency = fpbMean(values);
    if (accuracy !== null && efficiency !== null) candidates.push({model:item.model,accuracy,efficiency,source});
  }
  const body = document.getElementById('ranker-table-body'), summary = document.getElementById('ranker-summary'), status = document.getElementById('ranker-status');
  if (!candidates.length) {
    body.innerHTML = '<tr><td colspan="7">No comparable models found for these filters.</td></tr>'; summary.innerHTML = '';
    status.className = 'ranker-status error';
    status.textContent = 'No rows contain both the selected accuracy metric and efficiency metric. Check column names and choose a workload supported by the data.'; return;
  }
  const au = fpbNormalize(candidates.map(c=>({...c,value:c.accuracy})),true), eu = fpbNormalize(candidates.map(c=>({...c,value:c.efficiency})),efficiencyMetric!=='throughput');
  const auMap = new Map(au.map(c=>[c.model,c.utility])), euMap = new Map(eu.map(c=>[c.model,c.utility]));
  const ranked = candidates.map(c=>({...c,accuracyUtility:auMap.get(c.model),efficiencyUtility:euMap.get(c.model),score:alpha*euMap.get(c.model)+(1-alpha)*auMap.get(c.model)})).sort((a,b)=>b.score-a.score||a.model.localeCompare(b.model));
  const metricLabel = efficiencyMetric==='throughput'?'throughput':efficiencyMetric==='epf'?'EPF':'peak GPU memory';
  const unit = efficiencyMetric==='throughput'?' windows/s':efficiencyMetric==='epf'?' J/forecast':' MB';
  summary.innerHTML = '';
  [['Comparable models',ranked.length],['Accuracy priority',`${Math.round((1-alpha)*100)}%`],['Efficiency priority',`${Math.round(alpha*100)}%`],['Efficiency metric',metricLabel]].forEach(([label,value])=>{const chip=document.createElement('div');chip.className='ranker-chip';chip.innerHTML=`<strong>${label}:</strong> ${value}`;summary.appendChild(chip);});
  body.innerHTML = ranked.map((r,i)=>`<tr class="${i===0?'top-ranked':''}"><td><span class="rank-num">${i+1}</span></td><td><strong>${fpbEscape(r.model)}</strong>${r.source==='merged'?' <small title="Efficiency value sourced from merged CSV">†</small>':''}</td><td>${fpbFmt(r.accuracy)}</td><td>${fpbFmt(r.efficiency)}${unit}</td><td>${r.accuracyUtility.toFixed(3)}</td><td>${r.efficiencyUtility.toFixed(3)}</td><td><strong>${r.score.toFixed(3)}</strong><div class="score-track"><span style="width:${Math.max(0,Math.min(100,r.score*100))}%"></span></div></td></tr>`).join('');
  status.className = 'ranker-status ok';
  status.textContent = `Ranked ${ranked.length} models for the selected filters. Efficiency values use raw telemetry where available; † marks fallback to the merged CSV. Utilities are normalized within this comparison set.`;
}
document.addEventListener('DOMContentLoaded',()=>{
  ['alpha-slider','ranker-device','ranker-context','ranker-horizon','ranker-batch','ranker-efficiency','ranker-accuracy'].forEach(id=>{document.getElementById(id).addEventListener('input',fpbUpdateRankings);document.getElementById(id).addEventListener('change',fpbUpdateRankings);});
  fpbInitRanker();
});
