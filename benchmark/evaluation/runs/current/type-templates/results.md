# Type-Templates Benchmark — Results

Generated: `2026-05-31T21:51:29.626Z`

- Fixed model: `openai-3-small`
- Fixed field template: `coord-return-desc`
- Fixed strategy: `pure-knn` (headline K = 50)
- Schemas: 1 (github)
- Categories: 1 (all-schemas)
- Type templates: 5 (fields-only, kind-name-desc, name-desc, name-fields, name-only)
- Rows: 5

## Headline — TYPE recall@50 (the metric)

Scored against `targetTypes` in type-embedding space. The varied axis is the TYPE rendering template.

| type template | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| fields-only | 1/1 | 40 | 40 | **0.0%** | **100.0%** | **100.0%** | **100.0%** | 0.311 |
| kind-name-desc | 1/1 | 30 | 30 | **0.0%** | **100.0%** | **100.0%** | **100.0%** | 0.328 |
| name-desc | 1/1 | 21 | 21 | **0.0%** | **100.0%** | **100.0%** | **100.0%** | 0.364 |
| name-fields | 1/1 | 32 | 32 | **0.0%** | **100.0%** | **100.0%** | **100.0%** | 0.341 |
| name-only | 1/1 | 49 | 49 | **0.0%** | **100.0%** | **100.0%** | **100.0%** | 0.277 |

## FIELD recall@50 (context)

Scored against `targetFields` in field-embedding space. The field template is fixed across cohorts, so these columns are constant — shown for parity with the templates/models reports.

| type template | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| fields-only | 1/1 | 12 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 0.527 |
| kind-name-desc | 1/1 | 12 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 0.527 |
| name-desc | 1/1 | 12 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 0.527 |
| name-fields | 1/1 | 12 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 0.527 |
| name-only | 1/1 | 12 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 0.527 |

## Type-rank distribution (across all (query, targetType) pairs)

| type template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| fields-only | 1 | 40.0 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | `▁▁▁▁▁▁▁▁█▁` |
| kind-name-desc | 1 | 30.0 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | `▁▁▁▁▁▁█▁▁▁` |
| name-desc | 1 | 21.0 | 21 | 21 | 21 | 21 | 21 | 21 | 21 | `▁▁▁▁█▁▁▁▁▁` |
| name-fields | 1 | 32.0 | 32 | 32 | 32 | 32 | 32 | 32 | 32 | `▁▁▁▁▁▁█▁▁▁` |
| name-only | 1 | 49.0 | 49 | 49 | 49 | 49 | 49 | 49 | 49 | `▁▁▁▁▁▁▁▁▁█` |

## Field-rank distribution (across all (query, targetField) pairs)

| type template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| fields-only | 1 | 12.0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | `▁▁▁▁▁▁▁▁▁█` |
| kind-name-desc | 1 | 12.0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | `▁▁▁▁▁▁▁▁▁█` |
| name-desc | 1 | 12.0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | `▁▁▁▁▁▁▁▁▁█` |
| name-fields | 1 | 12.0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | `▁▁▁▁▁▁▁▁▁█` |
| name-only | 1 | 12.0 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | `▁▁▁▁▁▁▁▁▁█` |

## Latency (per row, ms)

| type template | mean ms |
|---|---:|
| fields-only | 28.2 |
| kind-name-desc | 27.1 |
| name-desc | 20.7 |
| name-fields | 22.1 |
| name-only | 30.3 |
