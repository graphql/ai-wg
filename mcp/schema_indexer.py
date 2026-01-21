from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import numpy as np
from graphql import GraphQLList, GraphQLNonNull, GraphQLObjectType, build_schema
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()
DEFAULT_DATA_DIR = Path(__file__).parent / "data"
DEFAULT_SCHEMA_PATH = Path(__file__).parent / "schema.graphql"
DEFAULT_EMBED_MODEL = "text-embedding-3-small"


@dataclass
class TypeField:
    type_name: str
    field_name: str
    summary: str


def describe_type(graphql_type) -> str:
    if isinstance(graphql_type, GraphQLNonNull):
        return f"{describe_type(graphql_type.of_type)}!"
    if isinstance(graphql_type, GraphQLList):
        return f"[{describe_type(graphql_type.of_type)}]"
    return str(graphql_type)


def flatten_schema(schema_text: str) -> List[TypeField]:
    schema = build_schema(schema_text)
    type_fields: List[TypeField] = []

    for type_name, gql_type in sorted(schema.type_map.items()):
        if type_name.startswith("__"):
            continue
        if not isinstance(gql_type, GraphQLObjectType):
            continue

        for field_name, field in sorted(gql_type.fields.items()):
            arg_parts = [
                f"{arg_name}: {describe_type(arg.type)}"
                for arg_name, arg in field.args.items()
            ]
            arg_list = ", ".join(arg_parts)
            return_type = describe_type(field.type)
            signature = (
                f"{type_name}.{field_name}({arg_list}) -> {return_type}"
                if arg_list
                else f"{type_name}.{field_name} -> {return_type}"
            )

            summary_parts = [signature]
            if field.description:
                summary_parts.append(f"desc: {field.description}")

            type_fields.append(
                TypeField(
                    type_name=type_name,
                    field_name=field_name,
                    summary=" | ".join(summary_parts),
                )
            )

    return type_fields


class OpenAIEmbedder:
    def __init__(self, model: str = DEFAULT_EMBED_MODEL):
        self.client = OpenAI()
        self.model = model

    def embed_many(self, texts: Sequence[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)

        response = self.client.embeddings.create(model=self.model, input=list(texts))
        vectors = np.array([item.embedding for item in response.data], dtype=np.float32)
        return self._normalize(vectors)

    def embed_one(self, text: str) -> np.ndarray:
        return self.embed_many([text])[0]

    @staticmethod
    def _normalize(vectors: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return vectors / norms


class EmbeddingStore:
    def __init__(self, data_dir: Path, embedding_model: str):
        self.data_dir = data_dir
        self.embedding_model = embedding_model
        self.meta_path = data_dir / "metadata.json"
        self.vectors_path = data_dir / "vectors.npz"

        self._vectors: np.ndarray | None = None
        self._items: list[dict] | None = None
        self._meta: dict | None = None

    def is_ready(self) -> bool:
        return self.meta_path.exists() and self.vectors_path.exists()

    def load(self) -> dict:
        if self._meta and self._vectors is not None and self._items is not None:
            return self._meta

        if not self.is_ready():
            raise FileNotFoundError(
                f"Index not found in {self.data_dir}. Run the indexer first."
            )

        self._meta = json.loads(self.meta_path.read_text())
        if self._meta.get("embedding_model") != self.embedding_model:
            raise ValueError(
                "Embedding model mismatch: "
                f"{self._meta.get('embedding_model')} vs {self.embedding_model}"
            )

        self._items = self._meta["items"]
        self._vectors = np.load(self.vectors_path)["vectors"]
        return self._meta

    def save(
        self,
        vectors: np.ndarray,
        items: list[dict],
        schema_sha: str,
        schema_source: dict | None = None,
    ) -> dict:
        self.data_dir.mkdir(parents=True, exist_ok=True)

        meta = {
            "embedding_model": self.embedding_model,
            "schema_sha": schema_sha,
            "items": items,
        }
        if schema_source is not None:
            meta["schema_source"] = schema_source

        np.savez_compressed(self.vectors_path, vectors=vectors)
        self.meta_path.write_text(json.dumps(meta, indent=2))

        self._vectors = vectors
        self._items = items
        self._meta = meta
        return meta

    def search(self, query_vector: np.ndarray, limit: int = 5) -> list[dict]:
        if self._vectors is None or self._items is None:
            self.load()

        assert self._vectors is not None and self._items is not None

        limit = max(1, min(limit, len(self._items)))
        scores = self._vectors @ query_vector
        top_indices = np.argsort(scores)[::-1][:limit]

        return [
            {
                "type": self._items[idx]["type_name"],
                "field": self._items[idx]["field_name"],
                "summary": self._items[idx]["summary"],
                "score": float(scores[idx]),
            }
            for idx in top_indices
        ]

def compute_schema_sha(schema_text: str) -> str:
    return hashlib.sha256(schema_text.encode("utf-8")).hexdigest()

def index_schema_text(
    schema_text: str,
    *,
    data_dir: Path = DEFAULT_DATA_DIR,
    embed_model: str = DEFAULT_EMBED_MODEL,
    embedder: OpenAIEmbedder | None = None,
    store: EmbeddingStore | None = None,
    schema_source: dict | None = None,
) -> dict:
    items = flatten_schema(schema_text)
    summaries = [item.summary for item in items]
    embedder = embedder or OpenAIEmbedder(model=embed_model)
    vectors = embedder.embed_many(summaries)

    schema_sha = compute_schema_sha(schema_text)
    store = store or EmbeddingStore(data_dir=data_dir, embedding_model=embedder.model)
    meta = store.save(
        vectors,
        [asdict(item) for item in items],
        schema_sha=schema_sha,
        schema_source=schema_source,
    )
    meta["count"] = len(items)
    return meta


def index_schema(
    schema_path: Path = DEFAULT_SCHEMA_PATH,
    data_dir: Path = DEFAULT_DATA_DIR,
    embed_model: str = DEFAULT_EMBED_MODEL,
    embedder: OpenAIEmbedder | None = None,
    store: EmbeddingStore | None = None,
    schema_source: dict | None = None,
) -> dict:
    resolved_source = schema_source
    if resolved_source is None:
        try:
            resolved_source = {"kind": "file", "path": str(schema_path.resolve())}
        except Exception:
            resolved_source = {"kind": "file", "path": str(schema_path)}
    return index_schema_text(
        schema_path.read_text(),
        data_dir=data_dir,
        embed_model=embed_model,
        embedder=embedder,
        store=store,
        schema_source=resolved_source,
    )


def ensure_index_text(
    schema_text: str,
    *,
    schema_source: dict,
    data_dir: Path = DEFAULT_DATA_DIR,
    embed_model: str = DEFAULT_EMBED_MODEL,
    embedder: OpenAIEmbedder | None = None,
    store: EmbeddingStore | None = None,
    force: bool = False,
) -> dict:
    """
    Ensure a persisted embedding index exists for a given schema text.

    Rebuilds the index if missing, corrupt, model-mismatched, schema changed, or schema source changed.
    """
    embedder = embedder or OpenAIEmbedder(model=embed_model)
    store = store or EmbeddingStore(data_dir=data_dir, embedding_model=embedder.model)

    if not force and store.is_ready():
        schema_sha = compute_schema_sha(schema_text)
        try:
            meta = store.load()
        except Exception:
            return index_schema_text(
                schema_text,
                data_dir=data_dir,
                embed_model=embedder.model,
                embedder=embedder,
                store=store,
                schema_source=schema_source,
            )

        stored_source = meta.get("schema_source")
        if meta.get("schema_sha") == schema_sha and (stored_source is None or stored_source == schema_source):
            meta["count"] = len(meta.get("items", []))
            return meta

    return index_schema_text(
        schema_text,
        data_dir=data_dir,
        embed_model=embedder.model,
        embedder=embedder,
        store=store,
        schema_source=schema_source,
    )


def ensure_index(
    schema_path: Path = DEFAULT_SCHEMA_PATH,
    data_dir: Path = DEFAULT_DATA_DIR,
    embed_model: str = DEFAULT_EMBED_MODEL,
    embedder: OpenAIEmbedder | None = None,
    store: EmbeddingStore | None = None,
    force: bool = False,
) -> dict:
    """
    Ensure a persisted embedding index exists for the given schema.

    Rebuilds the index if missing, corrupt, model-mismatched, or if the schema file changed.
    """
    embedder = embedder or OpenAIEmbedder(model=embed_model)
    store = store or EmbeddingStore(data_dir=data_dir, embedding_model=embedder.model)
    try:
        schema_source = {"kind": "file", "path": str(schema_path.resolve())}
    except Exception:
        schema_source = {"kind": "file", "path": str(schema_path)}

    if not force and store.is_ready():
        schema_text = schema_path.read_text()
        schema_sha = compute_schema_sha(schema_text)
        try:
            meta = store.load()
        except Exception:
            return index_schema(
                schema_path=schema_path,
                data_dir=data_dir,
                embed_model=embedder.model,
                embedder=embedder,
                store=store,
                schema_source=schema_source,
            )

        stored_source = meta.get("schema_source")
        if meta.get("schema_sha") == schema_sha and (stored_source is None or stored_source == schema_source):
            meta["count"] = len(meta.get("items", []))
            return meta

    return index_schema(
        schema_path=schema_path,
        data_dir=data_dir,
        embed_model=embedder.model,
        embedder=embedder,
        store=store,
        schema_source=schema_source,
    )


def search_index(
    query: str,
    data_dir: Path = DEFAULT_DATA_DIR,
    embed_model: str = DEFAULT_EMBED_MODEL,
    embedder: OpenAIEmbedder | None = None,
    limit: int = 5,
) -> list[dict]:
    embedder = embedder or OpenAIEmbedder(model=embed_model)
    store = EmbeddingStore(data_dir=data_dir, embedding_model=embedder.model)
    meta = store.load()

    query_vector = embedder.embed_one(query)
    results = store.search(query_vector, limit=limit)
    for item in results:
        item["schema_sha"] = meta.get("schema_sha")
    return results


def cli(argv: Iterable[str] | None = None) -> int:
    # Parse arguments and set defaults properly
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_EMBED_MODEL, help="Embedding model to use")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA_PATH, help="Path to the GraphQL schema file")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Path to store data files")
    
    subparsers = parser.add_subparsers(dest="command", help="Subcommands")
    
    # Index subcommand
    index_parser = subparsers.add_parser("index", help="Index the schema into persistent embeddings")
    index_parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA_PATH, help="Path to the GraphQL schema file")
    
    # Search subcommand  
    search_parser = subparsers.add_parser("search", help="Search the persisted index with a natural language query")
    search_parser.add_argument("query", help="Search query text")
    search_parser.add_argument("--limit", type=int, default=5, help="Maximum number of results")
    
    args = parser.parse_args(argv)
    
    # Get the selected model (either from --model or default)
    model_arg = getattr(args, 'model', DEFAULT_EMBED_MODEL)
    embedder = OpenAIEmbedder(model=model_arg)
    
    if args.command == "search":
        limit = max(1, min(getattr(args, 'limit', 5), 20))
        ensure_index(
            schema_path=getattr(args, 'schema', DEFAULT_SCHEMA_PATH),
            data_dir=getattr(args, 'data_dir', DEFAULT_DATA_DIR),
            embed_model=model_arg,
            embedder=embedder,
            force=False,
        )
        results = search_index(
            query=args.query,
            data_dir=getattr(args, 'data_dir', DEFAULT_DATA_DIR),
            embed_model=model_arg,
            embedder=embedder,
            limit=limit
        )
        print(json.dumps(results, indent=2))
        return 0

    meta = index_schema(
        schema_path=args.schema,
        data_dir=args.data_dir,
        embed_model=model_arg,
        embedder=embedder,
    )
    print(
        f"Indexed {meta['count']} fields from {args.schema} "
        f"using {meta['embedding_model']} (schema sha {meta['schema_sha']})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
