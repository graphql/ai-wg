# embed-server

Local HTTP sidecar that serves a [sentence-transformers](https://www.sbert.net/) model to the TS
benchmark via the `provider: 'http'` path in `src/core/shared/embeddings.ts`.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
EMBED_MODEL=xthor/Qwen3-Embedding-0.6B-GraphQL python server.py
# → listens on http://127.0.0.1:8765
```

The matching TS model entry (`src/models/qwen3-emb-graphql/meta.json`) points its `endpoint` at the
same URL. The TS cache stores every vector on disk, so subsequent benchmark runs do not hit this
server at all.

## Protocol

```
POST /embed
  { "model": "<id>", "kind": "query" | "document", "texts": ["..."] }
  → { "vectors": [[float, ...], ...], "dim": <int> }
```

`kind` is forwarded as `prompt_name=` to `model.encode(...)` — required for instruction-tuned
embedding models (Qwen3-Embedding, BGE-M3, E5, …) that produce different vectors for queries vs.
documents.

## Env

| var          | default                                  |
| ------------ | ---------------------------------------- |
| `EMBED_MODEL`| `xthor/Qwen3-Embedding-0.6B-GraphQL`     |
| `EMBED_HOST` | `127.0.0.1`                              |
| `EMBED_PORT` | `8765`                                   |
