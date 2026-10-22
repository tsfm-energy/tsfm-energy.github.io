# ForecastPowerBench project page + interactive ranker

## Files
- `index.html`: landing page and embedded ranking widget UI.
- `static/js/ranker.js`: loads CSV files and recalculates model ranks as alpha/filters change.
- `data/merged_system_metrics.csv`: **add your merged CSV** containing model identity, workload/hardware fields, and accuracy metrics (e.g. MASE).
- `data/raw_system_metrics.csv`: **add your raw system-metrics CSV** containing model/workload fields and raw or per-run efficiency measurements.

## Deploy on GitHub Pages
1. Copy this folder's contents into the root of your GitHub Pages repository (or adjust paths if you keep the site in a subfolder).
2. Add your two CSV files to `data/` using the filenames above, or change `FPB_MERGED_CSV` and `FPB_RAW_CSV` at the top of `static/js/ranker.js`.
3. Commit and push. The widget fetches CSVs from the same site origin; it will not load correctly by opening `index.html` with a `file://` URL.

## Expected CSV fields
The ranker recognizes common aliases, including:
- Identity: `model_name`, `device_category` or `execution_device`, `context_len`, `horizon_len`, `batch_size`.
- Accuracy: `MASE`, `MAPE`, `MAE`, `RMSE`, `SMAPE` (lower is better).
- Throughput: `throughput_windows_per_sec_mean` or `throughput_points_per_sec_mean` (higher is better).
- Energy: `energy_per_window_j_mean` or `energy_per_forecast_j` (lower is better). If unavailable, it can calculate energy per forecast from total energy divided by forecast count when those columns are present.
- Memory: `peak_gpu_memory_used_gb_mean` or a compatible peak-memory field (lower is better).

The merged CSV supplies accuracy and model/workload metadata. Raw CSV rows are preferred for the selected efficiency measurement; the merged CSV is used as a fallback when no raw efficiency value is available for that model. Model matching is by the model name string, and selected workload filters are applied to both files.

## Score
`score = alpha * efficiency_utility + (1 - alpha) * accuracy_utility`

Each utility is min-max normalized within the currently selected comparison set, with lower-is-better metrics inverted. At alpha 0, the score ranks by accuracy utility; at alpha 1, it ranks by the selected efficiency utility. When filters are set to “All”, metrics are averaged over the matching rows; for rigorous comparisons, select one hardware/context/horizon/batch configuration. The ranker excludes models missing either selected accuracy or efficiency values.

## Important
- Ensure accuracy values correspond to the selected forecasting workload. If accuracy is only available for short/medium/long GIFT-Eval regimes, map those records to the corresponding workload points or add an accuracy-regime selector before comparing.
- Do not publish sensitive raw telemetry or excessively large files. For very large raw data, prepare a compact per-run or per-configuration CSV for the browser widget and offer the full data separately as a download.
- If the site is hosted under a repository subpath, use relative paths that match that deployment structure.
