from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from graphql import build_schema, graphql_sync
from mcp.server.fastmcp import FastMCP

from schema_index import (
    DEFAULT_DATA_DIR,
    DEFAULT_EMBED_MODEL,
    DEFAULT_SCHEMA_PATH,
    EmbeddingStore,
    OpenAIEmbedder,
    index_schema,
)

APP_NAME = "graphql-mcp"
DATA_DIR = DEFAULT_DATA_DIR
SCHEMA_PATH = DEFAULT_SCHEMA_PATH
DEFAULT_TRANSPORT = os.environ.get("MCP_TRANSPORT", os.environ.get("FASTMCP_TRANSPORT", "sse"))

embedder = OpenAIEmbedder(model=DEFAULT_EMBED_MODEL)
store = EmbeddingStore(data_dir=DATA_DIR, embedding_model=embedder.model)

mcp = FastMCP(APP_NAME)
mcp.dependencies = ["graphql-core", "openai", "numpy"]


def _run_with_default_transport(
    self,
    transport: Literal["stdio", "sse", "streamable-http"] | None = None,
    mount_path: str | None = None,
):
    chosen = transport or DEFAULT_TRANSPORT
    return FastMCP.run(self, transport=chosen, mount_path=mount_path)


mcp.run = _run_with_default_transport.__get__(mcp, FastMCP)

@mcp.tool()
def list_types(query: str, limit: int = 5) -> list[dict]:
    """
    Fuzzy search the schema for matching type.field signatures.
    Uses the persisted embedding index (auto-builds if missing).
    """
    try:
        if not store.is_ready():
            index_schema(schema_path=SCHEMA_PATH, data_dir=DATA_DIR, embedder=embedder)
        meta = store.load()
    except Exception as exc:
        raise RuntimeError(f"Schema index not available: {exc}")

    capped_limit = max(1, min(limit, 20))
    query_vec = embedder.embed_one(query)
    results = store.search(query_vec, limit=capped_limit)
    for item in results:
        item["schema_sha"] = meta.get("schema_sha")
    return results


@mcp.tool()
def run_query(query: str, variables: dict | None = None) -> dict:
    """
    Validate and run a GraphQL query against the static schema.

    Note: No resolvers are provided, so fields resolve to null;
    this is mainly for validation and shape checking.
    """
    schema = build_schema(Path(SCHEMA_PATH).read_text())
    result = graphql_sync(schema, query, variable_values=variables or {})
    output: dict = {"valid": not bool(result.errors)}
    if result.errors:
        output["errors"] = [str(err) for err in result.errors]
    if result.data is not None:
        output["data"] = result.data
    return output


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Run the GraphQL embedder MCP server."
    )
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default=DEFAULT_TRANSPORT,
        help="MCP transport to run (default: sse; override with --transport or MCP_TRANSPORT env).",
    )
    parser.add_argument(
        "--host",
        default=mcp.settings.host,
        help="Host for SSE/HTTP transports (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=mcp.settings.port,
        help="Port for SSE/HTTP transports (default: 8000).",
    )
    parser.add_argument(
        "--log-level",
        default=mcp.settings.log_level,
        help="Log level (DEBUG, INFO, WARNING, ERROR).",
    )
    parser.add_argument(
        "--mount-path",
        default=mcp.settings.mount_path,
        help="Mount path for SSE transport (default: /).",
    )
    args = parser.parse_args()

    mcp.settings.host = args.host
    mcp.settings.port = args.port
    mcp.settings.log_level = args.log_level
    mcp.settings.mount_path = args.mount_path

    print(
        f"Starting {APP_NAME} with transport={args.transport}, "
        f"host={mcp.settings.host}, port={mcp.settings.port}"
    )
    mcp.run(transport=args.transport, mount_path=args.mount_path)
