# Models Benchmark — Results

Generated: `2026-06-13T14:35:22.187Z`

- Fixed template: `coord-return-desc`
- Fixed strategy: `pure-knn` (headline K = 50)
- Schemas: 5 (github, gitlab, linear, shopify, singapore)
- Categories: 1 (all-schemas)
- Models: 2 (openai-3-large 3072d, openai-3-small 1536d)
- Rows: 1632

## Headline — FIELD recall@50 (the metric)

Scored against `targetFields` in field-embedding space.

| model | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| openai-3-large | 719/816 | 30 | 1790 | **47.3%** | **59.8%** | **67.6%** | **78.7%** | 0.370 |
| openai-3-small | 719/816 | 40 | 2461 | **42.4%** | **54.2%** | **63.3%** | **72.5%** | 0.407 |

## TYPE recall@50

Scored against `targetTypes` in type-embedding space.

| model | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| openai-3-large | 766/816 | 4 | 155 | 79.7% | 87.8% | 93.0% | 96.6% | 0.398 |
| openai-3-small | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |

## Field-rank distribution (across all (query, targetField) pairs)

| model | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| openai-3-large | 1608 | 320.6 | 1 | 5 | 30 | 183 | 1790 | 5124 | 7757 | `█▁▁▁▁▁▁▁▁▁` |
| openai-3-small | 1608 | 423.5 | 1 | 8 | 40 | 258 | 2461 | 6232 | 10789 | `█▁▁▁▁▁▁▁▁▁` |

## Type-rank distribution (across all (query, targetType) pairs)

| model | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| openai-3-large | 1137 | 33.0 | 1 | 1 | 4 | 16 | 155 | 563 | 1048 | `█▁▁▁▁▁▁▁▁▁` |
| openai-3-small | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |

## Latency (per row, ms)

| model | mean ms |
|---|---:|
| openai-3-large | 56.6 |
| openai-3-small | 35.3 |
