#!/usr/bin/env python3
"""Convert aggregated GIFT-Eval accuracy CSV into regime-level MASE JSON.

The MASE values are aggregated references, not measurements for one exact
ForecastPowerBench context/horizon pair. Each model therefore gets one MASE
record per broad regime (short, medium, long). The web visualizer selects the
nearest regime anchor in normalized log-space over context length and horizon,
then reuses that regime's MASE for the selected system workload.

Usage:
    python scripts/convert_accuracy_csv.py \
        aggregated_accuracy_exact_horizons_48_480_720_with_crps.csv \
        --output data/accuracy-results.json
"""

import argparse
import csv
import json
import math
import re
from collections import Counter
from pathlib import Path

MODEL_NAMES = {
    "chronos2": "Chronos-2",
    "flowstate91m": "FlowState",
    "kairos23m": "Kairos",
    "moirai2": "Moirai-2",
    "ttmr3pt": "TTM-R3",
    "tempopfn": "TempoPFN",
    "tirex": "TiRex",
    "timesfm25": "TimesFM 2.5",
    "totoopenbase10": "Toto",
    "sundialbase128m": "Sundial",
}

# Source horizon -> broad accuracy regime and its representative workload anchor.
# Anchors are used only to assign a selected workload to a broad regime; they do
# not imply that MASE was measured at that exact ForecastPowerBench workload.
SOURCE_HORIZON_TO_REGIME = {
    48: {
        "regime": "short",
        "reference_context_len": 512,
        "reference_horizon_len": 48,
    },
    480: {
        "regime": "medium",
        "reference_context_len": 1024,
        "reference_horizon_len": 360,
    },
    720: {
        "regime": "long",
        "reference_context_len": 2048,
        "reference_horizon_len": 720,
    },
}

MASE_COLUMN = "eval_metrics/MASE[0.5]_median"
N_VALID_COLUMN = "eval_metrics/MASE[0.5]_n_valid"


def normalize_key(value):
    return re.sub(r"[^a-z0-9]", "", str(value).strip().lower())


def parse_int(value, field, row_number):
    try:
        number = float(str(value).strip())
        if not math.isfinite(number) or not number.is_integer():
            raise ValueError
        return int(number)
    except (TypeError, ValueError):
        raise ValueError(
            f"Row {row_number}: expected an integer in {field!r}, got {value!r}"
        )


def parse_float(value, field, row_number):
    try:
        number = float(str(value).strip())
        if not math.isfinite(number):
            raise ValueError
        return number
    except (TypeError, ValueError):
        raise ValueError(
            f"Row {row_number}: expected a finite number in {field!r}, got {value!r}"
        )


def convert(input_csv: Path, output_json: Path):
    records = []
    seen = set()

    with input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        required = {"model", "gift_horizons", MASE_COLUMN}
        missing = sorted(required - columns)
        if missing:
            raise ValueError(
                "CSV is missing required column(s): " + ", ".join(missing)
                + "\nAvailable columns: " + ", ".join(reader.fieldnames or [])
            )

        for row_number, row in enumerate(reader, start=2):
            raw_model = (row.get("model") or "").strip()
            model = MODEL_NAMES.get(normalize_key(raw_model))
            if not model:
                raise ValueError(
                    f"Row {row_number}: unknown model label {raw_model!r}. "
                    "Add its normalized name to MODEL_NAMES."
                )

            source_horizon = parse_int(
                row.get("gift_horizons"), "gift_horizons", row_number
            )
            reference = SOURCE_HORIZON_TO_REGIME.get(source_horizon)
            if reference is None:
                raise ValueError(
                    f"Row {row_number}: unsupported GIFT-Eval horizon "
                    f"{source_horizon}. Add it to SOURCE_HORIZON_TO_REGIME."
                )

            raw_mase = row.get(MASE_COLUMN)
            if raw_mase is None or not str(raw_mase).strip():
                continue
            mase = parse_float(raw_mase, MASE_COLUMN, row_number)
            if mase < 0:
                raise ValueError(f"Row {row_number}: MASE must be non-negative")

            regime = reference["regime"]
            identity = (normalize_key(model), regime)
            if identity in seen:
                raise ValueError(
                    f"Row {row_number}: duplicate aggregated accuracy record "
                    f"for {model!r}, regime {regime!r}. Expected one row per model/regime."
                )
            seen.add(identity)

            record = {
                "model": model,
                "regime": regime,
                "source_gift_horizon": source_horizon,
                "median_mase": mase,
            }
            if N_VALID_COLUMN in columns and str(row.get(N_VALID_COLUMN, "")).strip():
                record["n_valid"] = parse_int(
                    row[N_VALID_COLUMN], N_VALID_COLUMN, row_number
                )
            records.append(record)

    if not records:
        raise ValueError("No valid MASE records were found in the CSV.")

    records.sort(key=lambda item: (item["regime"], item["model"].lower()))
    counts = Counter(record["regime"] for record in records)

    output = {
        "schema_version": 2,
        "description": (
            "Aggregated GIFT-Eval median MASE references, stored once per model "
            "and broad workload regime. These are representative accuracy values, "
            "not exact per-context/per-horizon measurements."
        ),
        "metric": "median_MASE",
        "accuracy_granularity": "model_by_broad_regime",
        "source_file": input_csv.name,
        "regime_assignment": {
            "method": "nearest_reference_in_normalized_log_space",
            "dimensions": ["context_len", "horizon_len"],
            "context_normalization_range": [32, 2048],
            "horizon_normalization_range": [1, 720],
            "description": (
                "For each selected ForecastPowerBench workload, calculate the "
                "Euclidean distance in normalized log-space to the three "
                "representative context-horizon anchors and use the MASE for "
                "the nearest broad regime. This reuses the same aggregated "
                "per-model MASE across the corresponding region of workloads."
            ),
        },
        "regimes": {
            regime: {
                "reference_context_len": config["reference_context_len"],
                "reference_horizon_len": config["reference_horizon_len"],
                "source_gift_horizon": source_horizon,
                "accuracy_scope": "aggregated_regime_reference",
            }
            for source_horizon, config in SOURCE_HORIZON_TO_REGIME.items()
            for regime in [config["regime"]]
        },
        "records": records,
        "note": (
            "MASE is lower-is-better. Each record is an aggregated GIFT-Eval "
            "median for one model and one broad regime. The value is reused for "
            "all selected context/horizon pairs assigned to that regime; it is "
            "not an exact accuracy measurement for the selected pair. Accuracy "
            "can vary with domain, dataset, sampling frequency, and other "
            "evaluation factors. System throughput remains exact to the selected "
            "hardware and workload. The medium regime uses the available "
            "GIFT-Eval source horizon 480 and the benchmark's representative "
            "anchor (context=1024, horizon=360). Accuracy is hardware-independent."
        ),
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    with output_json.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")

    print(f"Wrote {len(records)} regime-level accuracy records to: {output_json}")
    print(f"Models: {len({record['model'] for record in records})}")
    for regime in ("short", "medium", "long"):
        print(f"  {regime}: {counts.get(regime, 0)} records")


def main():
    parser = argparse.ArgumentParser(
        description="Convert aggregated GIFT-Eval MASE CSV to regime-level JSON."
    )
    parser.add_argument("input_csv", type=Path, help="Aggregated accuracy CSV")
    parser.add_argument(
        "--output", type=Path, default=Path("data/accuracy-results.json"),
        help="Output JSON path (default: data/accuracy-results.json)",
    )
    args = parser.parse_args()
    if not args.input_csv.is_file():
        parser.error(f"Input CSV does not exist: {args.input_csv}")
    convert(args.input_csv, args.output)


if __name__ == "__main__":
    main()
