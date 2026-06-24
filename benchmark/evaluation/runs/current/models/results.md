# Models Benchmark — Results

Combined: OpenAI baselines (`2026-06-13`, upstream) + `qwen3-emb-graphql` (`2026-06-24`, local).

- Fixed template: `coord-return-desc`
- Fixed strategy: `pure-knn` (headline K = 50)
- Schemas: 5 (github, gitlab, linear, shopify, singapore)
- Categories: 1 (all-schemas)
- Models: 3 (qwen3-emb-graphql 1024d, openai-3-large 3072d, openai-3-small 1536d)

> **Note.** `qwen3-emb-graphql` is a self-hosted sentence-transformers fine-tune
> (`xthor/Qwen3-Embedding-0.6B-GraphQL`).

## Headline — FIELD recall@50 (the metric)

Scored against `targetFields` in field-embedding space. Sorted by FIELD r@50 desc.

| model | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| qwen3-emb-graphql | 719/816 | 24 | 1492 | **50.6%** | **63.6%** | **72.8%** | **81.6%** | 0.494 |
| openai-3-large | 719/816 | 30 | 1790 | 47.3% | 59.8% | 67.6% | 78.7% | 0.370 |
| openai-3-small | 719/816 | 40 | 2461 | 42.4% | 54.2% | 63.3% | 72.5% | 0.407 |

## TYPE recall@50

Scored against `targetTypes` in type-embedding space. Sorted by TYPE r@50 desc.

| model | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
|---|---:|---:|---:| ---: | ---: | ---: | ---: |---:|
| openai-3-large | 766/816 | 4 | 155 | **79.7%** | **87.8%** | **93.0%** | **96.6%** | 0.398 |
| qwen3-emb-graphql | 766/816 | 4 | 268 | 75.8% | 85.6% | 89.6% | 94.9% | 0.479 |
| openai-3-small | 766/816 | 5 | 276 | 71.7% | 80.9% | 87.1% | 92.4% | 0.428 |

## Field-rank distribution (across all (query, targetField) pairs)

| model | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| qwen3-emb-graphql | 1608 | 288.9 | 1 | 5 | 24 | 138 | 1492 | 4766 | 10513 | `█▁▁▁▁▁▁▁▁▁` |
| openai-3-large | 1608 | 320.6 | 1 | 5 | 30 | 183 | 1790 | 5124 | 7757 | `█▁▁▁▁▁▁▁▁▁` |
| openai-3-small | 1608 | 423.5 | 1 | 8 | 40 | 258 | 2461 | 6232 | 10789 | `█▁▁▁▁▁▁▁▁▁` |

## Type-rank distribution (across all (query, targetType) pairs)

| model | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| openai-3-large | 1137 | 33.0 | 1 | 1 | 4 | 16 | 155 | 563 | 1048 | `█▁▁▁▁▁▁▁▁▁` |
| qwen3-emb-graphql | 1137 | 48.9 | 1 | 1 | 4 | 21 | 268 | 777 | 1874 | `█▁▁▁▁▁▁▁▁▁` |
| openai-3-small | 1137 | 57.1 | 1 | 1 | 5 | 32 | 276 | 910 | 1683 | `█▁▁▁▁▁▁▁▁▁` |

## Latency (per row, ms)

In-process cosine scoring only (not the embed call); for `qwen3-emb-graphql` the
HTTP-served embed is amortised by the on-disk cache and not on the per-row hot path.

| model | mean ms |
|---|---:|
| qwen3-emb-graphql | 13.5 |
| openai-3-small | 35.3 |
| openai-3-large | 56.6 |

## Reproducing the qwen3 row

```bash
cd benchmark/evaluation
python3 -m venv embed-server/.venv && source embed-server/.venv/bin/activate
pip install -r embed-server/requirements.txt
EMBED_MODEL=xthor/Qwen3-Embedding-0.6B-GraphQL python embed-server/server.py &

pnpm install
pnpm eval models --model qwen3-emb-graphql
```

See `embed-server/README.md` for the sidecar protocol.
