"""Sidecar HTTP server for self-hosted sentence-transformers embedding models.

Speaks the protocol the TS benchmark's `provider: 'http'` expects:
    POST /embed  { "model": "...", "kind": "query"|"document", "texts": ["..."] }
        -> { "vectors": [[float, ...], ...] }

The TS side caches every vector on disk, so this server is hot-path only on
the first run of a new (model, template, text, kind) tuple.
"""

from __future__ import annotations

import os
import sys
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_ID = os.environ.get("EMBED_MODEL", "xthor/Qwen3-Embedding-0.6B-GraphQL")
HOST = os.environ.get("EMBED_HOST", "127.0.0.1")
PORT = int(os.environ.get("EMBED_PORT", "8765"))

print(f"[embed-server] loading {MODEL_ID} ...", file=sys.stderr, flush=True)
model = SentenceTransformer(MODEL_ID)
dim = model.get_sentence_embedding_dimension()
print(f"[embed-server] ready: dim={dim}", file=sys.stderr, flush=True)


class EmbedRequest(BaseModel):
    model: str | None = None
    kind: Literal["query", "document"] = "document"
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    dim: int


app = FastAPI()


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {"ok": True, "model": MODEL_ID, "dim": dim}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if req.model and req.model != MODEL_ID:
        raise HTTPException(
            status_code=400,
            detail=f"server loaded '{MODEL_ID}', request asked for '{req.model}'",
        )
    if not req.texts:
        return EmbedResponse(vectors=[], dim=dim)
    vecs = model.encode(
        req.texts,
        prompt_name=req.kind,
        convert_to_numpy=True,
        normalize_embeddings=False,
    )
    return EmbedResponse(vectors=vecs.tolist(), dim=dim)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
