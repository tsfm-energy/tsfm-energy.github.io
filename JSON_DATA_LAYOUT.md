# ForecastPowerBench JSON data layout

The visualizer loads each result file listed in `data/results-index.json`. GitHub Pages is static hosting and cannot automatically enumerate folders, so add every model/hardware file to the manifest.

```text
data/
├── results-index.json
└── results/
    ├── chronos2/
    │   ├── RTX_5090/results.json
    │   └── NVIDIA_H100/results.json
    ├── timesfm/
    │   └── NVIDIA_H100/results.json
    └── tirex/
        └── NVIDIA_H100/results.json
```

Each result file uses the schema from the supplied sample:

```json
{
  "model_id": "chronos2",
  "hardware": "RTX_5090",
  "num_measurements": 63,
  "measurements": [
    {
      "context_len": 512,
      "horizon_len": 48,
      "batch_size": 512,
      "throughput_windows_per_sec_mean": 3087.65,
      "energy_per_window_j_mean": 0.1851,
      "peak_gpu_memory_used_gb_mean": 4.13
    }
  ]
}
```

The numbers in the snippet above are illustrative; keep your actual measured values in your files. The visualizer supports the `measurements` array and reads throughput, energy-per-window (used as EPF), and peak GPU memory. Context and horizon selections must match an available measurement. Missing configurations are omitted rather than interpolated.

Example manifest:

```json
{
  "schema_version": 1,
  "files": [
    "data/results/chronos2/RTX_5090/results.json",
    "data/results/chronos2/NVIDIA_H100/results.json",
    "data/results/timesfm/NVIDIA_H100/results.json"
  ]
}
```

For fair cross-device comparisons, ensure the energy metric has a comparable measurement scope. The current chart ranks models separately by throughput (descending) and EPF (ascending); it does not combine the two into one score.
