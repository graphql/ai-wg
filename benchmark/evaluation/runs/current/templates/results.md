# Templates Benchmark — Results

Generated: `2026-06-14T13:28:07.378Z`

- Fixed model: `openai-3-small`
- Fixed strategy: `pure-knn` (headline K = 50)
- Schemas: 5 (github, gitlab, linear, shopify, singapore)
- Categories: 1 (all-schemas)
- Templates: 7 (coord, coord-desc, coord-return, coord-return-desc, name-only, sig, sig-desc)
- Rows: 5712

## Headline — FIELD recall@50 (the metric)

Scored against `targetFields` in field-embedding space.

| template | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| coord-desc | 719/816 | 34 | 2085 | **44.6%** | **56.8%** | **65.6%** | **75.6%** | 0.429 |
| coord | 719/816 | 45 | 2766 | **41.8%** | **54.9%** | **63.8%** | **71.4%** | 0.421 |
| sig-desc | 719/816 | 44 | 2573 | **41.5%** | **54.4%** | **63.1%** | **72.1%** | 0.410 |
| coord-return-desc | 719/816 | 40 | 2461 | **42.4%** | **54.2%** | **63.3%** | **72.5%** | 0.407 |
| coord-return | 719/816 | 75 | 3583 | **33.9%** | **46.5%** | **56.2%** | **66.4%** | 0.379 |
| sig | 719/816 | 84 | 4188 | **33.8%** | **45.1%** | **54.9%** | **64.9%** | 0.380 |
| name-only | 719/816 | 1177 | 7247 | **12.1%** | **18.2%** | **25.1%** | **32.7%** | 0.258 |

## TYPE recall@50

Scored against `targetTypes` in type-embedding space. The type template is fixed for this benchmark, so type-embedding text is constant across these cohorts — vary it in the sibling `type-templates` benchmark.

| template | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| coord-desc | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |
| coord | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |
| sig-desc | 766/816 | 5 | 276 | 71.7% | 80.9% | 86.9% | 92.4% | 0.428 |
| coord-return-desc | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |
| coord-return | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |
| sig | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |
| name-only | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |

## Field-rank distribution (across all (query, targetField) pairs)

| template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| coord-desc | 1608 | 385.4 | 1 | 6 | 34 | 215 | 2085 | 5957 | 9384 | `█▁▁▁▁▁▁▁▁▁` |
| coord | 1608 | 504.1 | 1 | 7 | 45 | 332 | 2766 | 6229 | 12117 | `█▁▁▁▁▁▁▁▁▁` |
| sig-desc | 1608 | 445.4 | 1 | 8 | 44 | 279 | 2573 | 6092 | 9218 | `█▁▁▁▁▁▁▁▁▁` |
| coord-return-desc | 1608 | 423.5 | 1 | 8 | 40 | 258 | 2461 | 6232 | 10789 | `█▁▁▁▁▁▁▁▁▁` |
| coord-return | 1608 | 626.4 | 1 | 11 | 75 | 457 | 3583 | 6472 | 11945 | `█▁▁▁▁▁▁▁▁▁` |
| sig | 1608 | 728.5 | 1 | 12 | 84 | 587 | 4188 | 6721 | 12156 | `█▁▁▁▁▁▁▁▁▁` |
| name-only | 1608 | 2186.0 | 1 | 126 | 1177 | 3610 | 7247 | 11598 | 13232 | `█▃▂▂▁▁▁▁▁▁` |

## Type-rank distribution (across all (query, targetType) pairs)

| template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| coord-desc | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| coord | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| sig-desc | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| coord-return-desc | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| coord-return | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| sig | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |
| name-only | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |

## Latency (per row, ms)

| template | mean ms |
|---|---:|
| coord-desc | 26.7 |
| coord | 26.9 |
| sig-desc | 26.9 |
| coord-return-desc | 26.6 |
| coord-return | 26.5 |
| sig | 26.6 |
| name-only | 27.4 |
