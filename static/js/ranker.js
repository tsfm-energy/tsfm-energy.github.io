/* ForecastPowerBench JSON results visualizer.
 * Add each model/hardware result JSON path to data/results-index.json.
 */
const FPB_RESULTS_INDEX = 'data/results-index.json';
const FPB_ACCURACY_INDEX = 'data/accuracy-results.json';
const fpbAliases = {
  model: ['model_variant','model_name','model','model name','model_id','modelname','variant'],
  device: ['execution_device','device_category','hardware','device','platform','gpu_name','device_name'],
  context: ['context_len','context_length','context','input_length','lookback_len'],
  horizon: ['horizon_len','forecast_horizon','horizon','prediction_length','pred_len'],
  batch: ['batch_size','batch','inference_batch_size'],
  throughput: ['throughput_windows_per_sec_mean','throughput_windows_per_sec','throughput_windows_s','windows_per_sec','throughput','throughput_mean'],
  epf: ['energy_per_forecast_j','energy_per_window_j_mean','energy_per_window_j','dynamic_energy_per_window_j_mean','epf_j','energy_per_forecast','energy_per_window','joules_per_forecast','joules_per_window'],
  memoryGb: ['peak_gpu_memory_used_gb_mean','peak_gpu_memory_used_gb','peak_gpu_memory_gb','peak_memory_gb'],
  memoryMb: ['peak_gpu_memory_mb','gpu_memory_peak_mb','max_gpu_memory_mb','gpu_memory_used_mb'],
  accuracy: ['median_mase','mase','mase_median','accuracy_mase','median_accuracy_mase']
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
async function fpbFetchJSON(url) {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}
const fpbContainers = new Set(['results','records','measurements','runs','metrics','data','experiments','configurations']);
function fpbFlattenJSON(data, inherited = {}, out = []) {
  if (Array.isArray(data)) { data.forEach(x => fpbFlattenJSON(x, inherited, out)); return out; }
  if (!data || typeof data !== 'object') return out;
  const meta = {...inherited};
  for (const k of ['model_variant','model_name','model','model_id','variant','hardware','execution_device','device_category','context_len','context_length','horizon_len','forecast_horizon','batch_size','regime','workload']) {
    if (data[k] !== undefined && data[k] !== null && typeof data[k] !== 'object') meta[k] = data[k];
  }
  const metricAliases = [...Object.values(fpbAliases).flat()].map(fpbNormKey);
  const hasMetric = Object.keys(data).some(k => metricAliases.some(a => fpbNormKey(k) === a || fpbNormKey(k).startsWith(a)));
  const children = Object.entries(data).filter(([k,v]) => v && typeof v === 'object' && (Array.isArray(v) || fpbContainers.has(k.toLowerCase())));
  if (hasMetric) out.push({...meta, ...data});
  children.forEach(([k,v]) => fpbFlattenJSON(v, meta, out));
  return out;
}
function fpbPathMeta(path) {
  const parts = path.split('/').filter(Boolean);
  return {model_variant: parts.length >= 3 ? parts[parts.length-3] : null,
          hardware: parts.length >= 3 ? parts[parts.length-2] : null, source_file:path};
}
async function fpbLoadJSONResults() {
  const manifest = await fpbFetchJSON(FPB_RESULTS_INDEX);
  const files = Array.isArray(manifest) ? manifest : (manifest.files || manifest.json_files || manifest.results);
  if (!Array.isArray(files) || !files.length) throw new Error('results-index.json must contain a non-empty files array.');
  const settled = await Promise.allSettled(files.map(async entry => {
    const path = typeof entry === 'string' ? entry : entry.path;
    if (!path) throw new Error('Manifest entries must be path strings or objects with a path field.');
    const json = await fpbFetchJSON(path), pathMeta = fpbPathMeta(path);
    return fpbFlattenJSON(json, {...pathMeta, model_id:json.model_id, hardware:json.hardware}, []).map(row => ({...row,
      model_variant: fpbText(row, fpbAliases.model) || pathMeta.model_variant,
      hardware: fpbText(row, fpbAliases.device) || pathMeta.hardware,
      source_file:path}));
  }));
  const rows = settled.filter(x => x.status === 'fulfilled').flatMap(x => x.value);
  const failed = settled.filter(x => x.status === 'rejected');
  if (!rows.length) throw new Error(`None of the ${files.length} files listed in results-index.json could be loaded.`);
  return {files:files.length - failed.length, expectedFiles:files.length, missingFiles:failed.length, rows};
}
function fpbUnique(rows, candidates) {
  return [...new Set(rows.map(r => fpbText(r, candidates)).filter(v => v !== null))].sort((a,b) => {
    const na = Number(a), nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });
}
function fpbPopulateSelect(id, values, preferred = null) {
  const select = document.getElementById(id), previous = select.value;
  select.innerHTML = '';
  values.forEach(value => { const opt = document.createElement('option'); opt.value = value; opt.textContent = value; select.appendChild(opt); });
  if (values.includes(previous)) select.value = previous;
  else if (preferred != null && values.includes(String(preferred))) select.value = String(preferred);
  else if (values.length) select.value = values[0];
}
function fpbFmt(value, digits=3) { return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined,{maximumFractionDigits:digits}); }
function fpbEscape(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fpbMemoryGb(row) {
  const gb = fpbValue(row, fpbAliases.memoryGb); if (gb !== null) return gb;
  const mb = fpbValue(row, fpbAliases.memoryMb); return mb === null ? null : mb / 1024;
}
function fpbMatches(row, filters) {
  return String(fpbText(row, fpbAliases.device)) === String(filters.device) &&
    String(fpbText(row, fpbAliases.context)) === String(filters.context) &&
    String(fpbText(row, fpbAliases.horizon)) === String(filters.horizon) &&
    (!filters.batch || String(fpbText(row, fpbAliases.batch)) === String(filters.batch));
}
let fpbRows = [], fpbDataReady = false, fpbFileCount = 0;
function fpbChart(containerId, ranked, metric, lowerIsBetter=false) {
  const container = document.getElementById(containerId);
  if (!ranked.length) { container.innerHTML = '<p class="ranker-note">No measurements available for this configuration.</p>'; return; }
  const max = Math.max(...ranked.map(x => x.value));
  container.innerHTML = ranked.map((item, i) => {
    const pct = max > 0 ? Math.max(2, item.value / max * 100) : 0;
    return `<div class="ranking-row"><div class="ranking-model"><span class="ranking-position">${i+1}</span>${fpbEscape(item.model)}</div><div class="ranking-track" aria-label="${fpbEscape(item.model)} ${metric}: ${fpbFmt(item.value)}"><div class="ranking-bar ${lowerIsBetter?'epf':''}" style="width:${pct}%"></div></div><div class="ranking-value">${fpbFmt(item.value)}</div></div>`;
  }).join('');
}
// Accuracy is an aggregated GIFT-Eval median MASE, stored once per model/regime.
// It is deliberately NOT joined on exact context_len/horizon_len. For any selected
// system workload, the nearest Short/Medium/Long anchor is found in normalized log
// space across BOTH context and horizon, and that regime-level MASE is reused across
// the corresponding broad region. Throughput is still matched to the exact system
// workload and selected hardware.
let fpbAccuracyRows = [], fpbAccuracyLoadMessage = 'Accuracy file not loaded.';
async function fpbLoadAccuracyResults() {
  try {
    const json = await fpbFetchJSON(FPB_ACCURACY_INDEX);
    const rows = fpbFlattenJSON(json, {source_file:FPB_ACCURACY_INDEX}, []);
    fpbAccuracyLoadMessage = rows.length
      ? `Loaded ${rows.length} aggregated accuracy record(s) from ${FPB_ACCURACY_INDEX}.`
      : `${FPB_ACCURACY_INDEX} is present but contains no accuracy records yet.`;
    return rows;
  } catch (error) {
    fpbAccuracyLoadMessage = `Accuracy data unavailable (${FPB_ACCURACY_INDEX}). Add aggregated GIFT-Eval median MASE records to enable the alpha ranking.`;
    return [];
  }
}
function fpbCanonicalModel(name) {
  const key = fpbNormKey(name);
  const aliases = {
    chronos2:'chronos2', flowstate:'flowstate', flowstater1:'flowstate', flowstate91m:'flowstate',
    kairos:'kairos', kairos23m:'kairos', moirai2:'moirai2', moirai20:'moirai2',
    toto:'toto', totoopenbase10:'toto', tirex:'tirex', sundial:'sundial', sundialbase128m:'sundial',
    tempopfn:'tempopfn', ttmr3:'ttmr3', ttmr3r3:'ttmr3',
    timesfm:'timesfm25', timesfm25:'timesfm25', timesfm250:'timesfm25'
  };
  return aliases[key] || key;
}
function fpbMedian(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}
const FPB_ACCURACY_REFERENCE_WORKLOADS = [
  {regime:'short', context:512, horizon:48},
  {regime:'medium', context:1024, horizon:360},
  {regime:'long', context:2048, horizon:720}
];
// The three paper regimes define representative anchors, not exact accuracy points.
// Nearest-anchor assignment partitions the full context–horizon space into broad
// regions. Log scaling handles multiplicative workload changes; both dimensions
// contribute equally after normalization to their evaluated ranges.
const FPB_CONTEXT_LOG_SPAN = Math.log(2048 / 32);
const FPB_HORIZON_LOG_SPAN = Math.log(720 / 1);
function fpbAccuracyReferenceForWorkload(selectedContext, selectedHorizon) {
  const context = Number(selectedContext), horizon = Number(selectedHorizon);
  if (!Number.isFinite(context) || context <= 0 || !Number.isFinite(horizon) || horizon <= 0) {
    return FPB_ACCURACY_REFERENCE_WORKLOADS[0];
  }
  const distance = ref => Math.hypot(
    Math.log(context / ref.context) / FPB_CONTEXT_LOG_SPAN,
    Math.log(horizon / ref.horizon) / FPB_HORIZON_LOG_SPAN
  );
  return FPB_ACCURACY_REFERENCE_WORKLOADS.reduce((best, ref) =>
    distance(ref) < distance(best) ? ref : best
  );
}
function fpbAccuracyRegime(row) {
  const regime = fpbNormKey(fpbText(row, ['regime','workload']) || '');
  if (['short','shortterm'].includes(regime)) return 'short';
  if (['medium','mediumterm'].includes(regime)) return 'medium';
  if (['long','longterm'].includes(regime)) return 'long';
  // Backward-compatible inference for files that store only representative anchors.
  const c = fpbValue(row, fpbAliases.context), h = fpbValue(row, fpbAliases.horizon);
  if (c === 512 && h === 48) return 'short';
  if (c === 1024 && (h === 360 || h === 480)) return 'medium';
  if (c === 2048 && h === 720) return 'long';
  return null;
}
function fpbAccuracyForModel(model, filters) {
  const key = fpbCanonicalModel(model);
  const reference = fpbAccuracyReferenceForWorkload(filters.context, filters.horizon);
  const candidates = fpbAccuracyRows.filter(row =>
    fpbCanonicalModel(fpbText(row, fpbAliases.model) || '') === key &&
    fpbAccuracyRegime(row) === reference.regime &&
    fpbValue(row, fpbAliases.accuracy) !== null
  );
  const mase = fpbMedian(candidates.map(row => fpbValue(row, fpbAliases.accuracy)));
  return mase === null ? null : {
    mase,
    regime:reference.regime,
    referenceHorizon:reference.horizon,
    referenceContext:reference.context,
    sourceGiftHorizon:fpbValue(candidates[0] || {}, ['source_gift_horizon']),
    accuracyScope:'aggregated_regime_reference'
  };
}
function fpbUpdateAlphaRanking(filters, systemRows) {
  const slider = document.getElementById('alpha-slider');
  const valueEl = document.getElementById('alpha-value');
  const hardwareEl = document.getElementById('alpha-hardware-label');
  const statusEl = document.getElementById('alpha-status');
  const tableBody = document.getElementById('alpha-table-body');
  const chart = document.getElementById('alpha-chart');
  if (!slider || !tableBody || !chart || !statusEl) return;

  const alpha = Math.max(0, Math.min(1, Number(slider.value)));
  if (valueEl) valueEl.textContent = alpha.toFixed(2);
  if (hardwareEl) hardwareEl.textContent = filters.device || '—';

  const comparable = systemRows.map(row => ({
    model:row.model,
    throughput:row.throughput,
    accuracy:fpbAccuracyForModel(row.model, filters)
  })).map(row => ({...row, mase:row.accuracy ? row.accuracy.mase : null})).filter(row => Number.isFinite(row.throughput) && row.mase !== null && Number.isFinite(row.mase));

  if (!comparable.length) {
    tableBody.innerHTML = '<tr><td colspan="7">No models have both throughput and a representative MASE reference for this workload.</td></tr>';
    chart.innerHTML = '<p class="ranker-note">' + fpbEscape(fpbAccuracyLoadMessage) + '</p>';
    statusEl.className = 'ranker-status';
    statusEl.textContent = `No regime-level aggregated MASE is available for the selected models. Current system workload: context ${filters.context}, horizon ${filters.horizon}, hardware ${filters.device}. Accuracy is assigned by nearest Short/Medium/Long anchor across context and horizon and is independent of hardware.`;
    return;
  }

  const tMin = Math.min(...comparable.map(x=>x.throughput));
  const tMax = Math.max(...comparable.map(x=>x.throughput));
  const aMin = Math.min(...comparable.map(x=>x.mase));
  const aMax = Math.max(...comparable.map(x=>x.mase));
  comparable.forEach(row => {
    // Throughput: higher is better. MASE: lower is better, so invert its min-max utility.
    row.throughputNorm = tMax === tMin ? 0.5 : (row.throughput - tMin) / (tMax - tMin);
    row.accuracyNorm = aMax === aMin ? 0.5 : (aMax - row.mase) / (aMax - aMin);
    row.score = alpha * row.throughputNorm + (1 - alpha) * row.accuracyNorm;
  });
  comparable.sort((a,b)=>b.score-a.score || b.throughput-a.throughput || a.mase-b.mase || a.model.localeCompare(b.model));

  const maxScore = Math.max(...comparable.map(x=>x.score), 1e-12);
  chart.innerHTML = comparable.map((row,i)=>{
    const pct = Math.max(2, row.score / maxScore * 100);
    return `<div class="ranking-row"><div class="ranking-model"><span class="ranking-position">${i+1}</span>${fpbEscape(row.model)}</div><div class="ranking-track"><div class="ranking-bar" style="width:${pct}%"></div></div><div class="ranking-value">${row.score.toFixed(3)}</div></div>`;
  }).join('');

  tableBody.innerHTML = comparable.map((row,i)=>
    `<tr${i===0?' class="top-ranked"':''}><td><strong>${i+1}</strong></td><td><strong>${fpbEscape(row.model)}</strong></td><td>${fpbFmt(row.throughput)}</td><td>${row.throughputNorm.toFixed(3)}</td><td>${fpbFmt(row.mase,4)}</td><td>${row.accuracyNorm.toFixed(3)}</td><td><strong>${row.score.toFixed(3)}</strong></td></tr>`
  ).join('');

  statusEl.className = 'ranker-status ok';
  const accuracyReference = fpbAccuracyReferenceForWorkload(filters.context, filters.horizon);
  statusEl.textContent = `Ranked ${comparable.length} model(s) on ${filters.device}. α = ${alpha.toFixed(2)} weights normalized throughput; (1 − α) weights normalized MASE utility. The selected workload (context ${filters.context}, horizon ${filters.horizon}) uses the aggregated ${accuracyReference.regime} MASE reference (anchor ${accuracyReference.context}/${accuracyReference.horizon}) across its nearest-anchor region. MASE is a representative regime-level accuracy value, not an exact score for this workload.`;
}

function fpbUpdateVisuals() {
  if (!fpbDataReady) return;
  const filters = {
    device:document.getElementById('ranker-device').value,
    context:document.getElementById('ranker-context').value,
    horizon:document.getElementById('ranker-horizon').value,
    batch:document.getElementById('ranker-batch').value
  };
  const matched = fpbRows.filter(r => fpbMatches(r, filters));
  const byModel = new Map();
  matched.forEach(row => {
    const model = fpbText(row, fpbAliases.model); if (!model) return;
    const throughput = fpbValue(row, fpbAliases.throughput), epf = fpbValue(row, fpbAliases.epf), memory = fpbMemoryGb(row);
    if (!byModel.has(model)) byModel.set(model, {model, throughput:null, epf:null, memory:null});
    const entry = byModel.get(model);
    if (throughput !== null) entry.throughput = entry.throughput === null ? throughput : (entry.throughput + throughput)/2;
    if (epf !== null) entry.epf = entry.epf === null ? epf : (entry.epf + epf)/2;
    if (memory !== null) entry.memory = entry.memory === null ? memory : Math.max(entry.memory,memory);
  });
  const all = [...byModel.values()];
  fpbUpdateAlphaRanking(filters, all);
  const throughput = all.filter(x => x.throughput !== null).sort((a,b)=>b.throughput-a.throughput || a.model.localeCompare(b.model));
  const epf = all.filter(x => x.epf !== null).sort((a,b)=>a.epf-b.epf || a.model.localeCompare(b.model));
  const tRank = new Map(throughput.map((x,i)=>[x.model,i+1])), eRank = new Map(epf.map((x,i)=>[x.model,i+1]));
  fpbChart('throughput-chart', throughput.map(x=>({model:x.model,value:x.throughput})), 'throughput');
  fpbChart('epf-chart', epf.map(x=>({model:x.model,value:x.epf})), 'EPF', true);
  const models = [...new Set([...throughput.map(x=>x.model),...epf.map(x=>x.model)])].sort((a,b)=>(tRank.get(a)??Infinity)-(tRank.get(b)??Infinity)||a.localeCompare(b));
  const body = document.getElementById('ranker-table-body');
  if (!models.length) {
    body.innerHTML = '<tr><td colspan="6">No measurements found for this workload.</td></tr>';
  } else {
    body.innerHTML = models.map(model => {
      const x = byModel.get(model);
      return `<tr><td><strong>${fpbEscape(model)}</strong></td><td>${tRank.get(model) ? `#${tRank.get(model)}` : '—'}</td><td>${fpbFmt(x.throughput)}</td><td>${eRank.get(model) ? `#${eRank.get(model)}` : '—'}</td><td>${fpbFmt(x.epf)}</td><td>${fpbFmt(x.memory)}</td></tr>`;
    }).join('');
  }
  const summary = document.getElementById('ranker-summary'); summary.innerHTML = '';
  [['Hardware',filters.device],['Context',filters.context],['Horizon',filters.horizon],['Batch size',filters.batch || 'All'],['Models with data',models.length]].forEach(([k,v])=>{
    const el=document.createElement('div'); el.className='ranker-chip'; el.innerHTML=`<strong>${fpbEscape(k)}:</strong> ${fpbEscape(v)}`; summary.appendChild(el);
  });
  const status = document.getElementById('ranker-status');
  if (!models.length) { status.className='ranker-status error'; status.textContent='No results match this workload. Choose another context, horizon, hardware, or batch size.'; }
  else { status.className='ranker-status ok'; status.textContent=`Loaded ${fpbFileCount} JSON file(s). Showing ${models.length} model(s) with measurements for the selected configuration.`; }
}
async function fpbInitVisualizer() {
  const status = document.getElementById('ranker-status');
  try {
    const loaded = await fpbLoadJSONResults(); fpbRows = loaded.rows; fpbFileCount = loaded.files;
    if (!fpbRows.length) throw new Error('No measurement records found in the listed JSON files.');
    fpbAccuracyRows = await fpbLoadAccuracyResults();
    fpbDataReady = true;
    fpbPopulateSelect('ranker-device', fpbUnique(fpbRows,fpbAliases.device), 'RTX_5090');
    fpbPopulateSelect('ranker-context', fpbUnique(fpbRows,fpbAliases.context), '512');
    fpbPopulateSelect('ranker-horizon', fpbUnique(fpbRows,fpbAliases.horizon), '48');
    fpbPopulateSelect('ranker-batch', fpbUnique(fpbRows,fpbAliases.batch), '512');
    ['ranker-device','ranker-context','ranker-horizon','ranker-batch'].forEach(id=>{
      document.getElementById(id).addEventListener('change',fpbUpdateVisuals);
    });
    const alphaSlider = document.getElementById('alpha-slider');
    if (alphaSlider) alphaSlider.addEventListener('input', fpbUpdateVisuals);
    status.className='ranker-status ok'; status.textContent=`Loaded ${loaded.files} of ${loaded.expectedFiles} listed JSON file(s) and ${loaded.rows.length.toLocaleString()} measurements${loaded.missingFiles ? ` (${loaded.missingFiles} not yet available)` : ''}.`;
    fpbUpdateVisuals();
  } catch (error) {
    status.className='ranker-status error';
    status.textContent=`Could not load benchmark JSON: ${error.message}. Check data/results-index.json and the listed paths. Run via GitHub Pages or a local web server, not file://.`;
    document.getElementById('ranker-table-body').innerHTML='<tr><td colspan="6">JSON files could not be loaded.</td></tr>';
    document.getElementById('throughput-chart').innerHTML=''; document.getElementById('epf-chart').innerHTML='';
    const alphaStatus = document.getElementById('alpha-status'); if (alphaStatus) alphaStatus.textContent = 'System measurements could not be loaded; composite ranking is unavailable.';
  }
}
document.addEventListener('DOMContentLoaded',fpbInitVisualizer);
