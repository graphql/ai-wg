import os
import json
import threading
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from graphql import (
    build_client_schema,
    build_schema,
    get_introspection_query,
    graphql_sync,
    print_schema,
)
from mcp.server.fastmcp import FastMCP

from schema_indexer import (
    DEFAULT_DATA_DIR,
    DEFAULT_EMBED_MODEL,
    DEFAULT_SCHEMA_PATH,
    EmbeddingStore,
    OpenAIEmbedder,
    ensure_index,
    ensure_index_text,
)

APP_NAME = "graphql-mcp"
DEFAULT_TRANSPORT = os.environ.get("MCP_TRANSPORT", os.environ.get("FASTMCP_TRANSPORT", "sse"))
DEFAULT_INSTRUCTIONS = (
    "You are an information lookup assistant. Treat this MCP server as an abstraction layer for GraphQL "
    "For any user question, first call list_types with a focused query. Prefer Query fields "
    "and their query_template. Then call run_query with a single, valid query. Avoid unnecessary tool calls."
)
MCP_INSTRUCTIONS = os.environ.get("MCP_INSTRUCTIONS", DEFAULT_INSTRUCTIONS)

SCHEMA_PATH = Path(os.environ.get("GRAPHQL_SCHEMA_PATH", str(DEFAULT_SCHEMA_PATH)))
ENDPOINT_URL = os.environ.get("GRAPHQL_ENDPOINT_URL")
DATA_DIR = Path(os.environ.get("GRAPHQL_EMBEDDER_DATA_DIR", str(DEFAULT_DATA_DIR)))
EMBED_MODEL = os.environ.get("GRAPHQL_EMBED_MODEL", DEFAULT_EMBED_MODEL)

embedder = OpenAIEmbedder(model=EMBED_MODEL)
store = EmbeddingStore(data_dir=DATA_DIR, embedding_model=embedder.model)
SCHEMA_SOURCE: dict = {"kind": "file", "path": str(SCHEMA_PATH)}
SCHEMA_TEXT: str | None = None
_REMOTE_HEADERS: dict[str, str] = {}
_REMOTE_TIMEOUT_S: float = 30.0
_INDEX_LOCK = threading.Lock()
_SCALAR_TYPES = {"String", "Int", "Float", "Boolean", "ID"}
_STOPWORDS = {
    "a",
    "an",
    "the",
    "of",
    "to",
    "for",
    "with",
    "and",
    "or",
    "in",
    "on",
    "by",
    "from",
    "about",
    "show",
    "list",
    "all",
    "get",
    "fetch",
    "find",
}

mcp = FastMCP(APP_NAME, instructions=MCP_INSTRUCTIONS)
mcp.dependencies = ["graphql-core", "openai", "numpy"]


def _run_with_default_transport(
    self,
    transport: Literal["stdio", "sse", "streamable-http"] | None = None,
    mount_path: str | None = None,
):
    chosen = transport or DEFAULT_TRANSPORT
    return FastMCP.run(self, transport=chosen, mount_path=mount_path)


mcp.run = _run_with_default_transport.__get__(mcp, FastMCP)


def configure_runtime(*, schema_path: Path, data_dir: Path, embed_model: str) -> None:
    global SCHEMA_PATH, ENDPOINT_URL, DATA_DIR, EMBED_MODEL, embedder, store, SCHEMA_SOURCE, SCHEMA_TEXT
    SCHEMA_PATH = schema_path
    ENDPOINT_URL = None
    DATA_DIR = data_dir
    EMBED_MODEL = embed_model
    embedder = OpenAIEmbedder(model=EMBED_MODEL)
    store = EmbeddingStore(data_dir=DATA_DIR, embedding_model=embedder.model)
    SCHEMA_SOURCE = {"kind": "file", "path": str(SCHEMA_PATH)}
    SCHEMA_TEXT = None


def configure_runtime_endpoint(
    *,
    endpoint_url: str,
    data_dir: Path,
    embed_model: str,
    schema_text: str,
    schema_source: dict,
) -> None:
    global SCHEMA_PATH, ENDPOINT_URL, DATA_DIR, EMBED_MODEL, embedder, store, SCHEMA_SOURCE, SCHEMA_TEXT
    SCHEMA_PATH = Path("<endpoint>")
    ENDPOINT_URL = endpoint_url
    DATA_DIR = data_dir
    EMBED_MODEL = embed_model
    embedder = OpenAIEmbedder(model=EMBED_MODEL)
    store = EmbeddingStore(data_dir=DATA_DIR, embedding_model=embedder.model)
    SCHEMA_SOURCE = schema_source
    SCHEMA_TEXT = schema_text


def _parse_headers(raw_headers: list[str] | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for raw in raw_headers or []:
        if ":" not in raw:
            raise ValueError(f"Invalid header (expected 'Name: Value'): {raw}")
        name, value = raw.split(":", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            raise ValueError(f"Invalid header name in: {raw}")
        headers[name] = value
    return headers


def _post_json(url: str, payload: dict, headers: dict[str, str] | None = None, timeout_s: float = 30.0) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)

    try:
        with urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"errors": [{"message": raw}]}
        raise


def _introspect_schema_sdl(endpoint_url: str, headers: dict[str, str], timeout_s: float) -> str:
    payload = {
        "query": get_introspection_query(descriptions=True),
        "operationName": "IntrospectionQuery",
        "variables": {},
    }
    result = _post_json(endpoint_url, payload, headers=headers, timeout_s=timeout_s)
    if result.get("errors"):
        raise RuntimeError(f"Introspection failed: {result['errors']}")
    data = result.get("data")
    if not data:
        raise RuntimeError("Introspection response missing 'data'.")
    schema = build_client_schema(data)
    return print_schema(schema)


def _parse_signature(signature: str) -> tuple[str, str, list[tuple[str, str]], str]:
    left, _, return_type = signature.partition(" -> ")
    args: list[tuple[str, str]] = []
    if "(" in left and left.endswith(")"):
        base, args_str = left[:-1].split("(", 1)
        for part in args_str.split(", "):
            if not part:
                continue
            name, _, type_str = part.partition(": ")
            if name and type_str:
                args.append((name, type_str))
    else:
        base = left
    type_name, _, field_name = base.partition(".")
    return type_name, field_name, args, return_type


def _base_type(type_str: str) -> str:
    base = type_str.strip()
    while True:
        base = base.rstrip("!")
        if base.startswith("[") and base.endswith("]"):
            base = base[1:-1].strip()
            continue
        return base.rstrip("!")


def _tokenize(text: str) -> list[str]:
    tokens = []
    current = []
    for ch in text.lower():
        if ch.isalnum():
            current.append(ch)
        else:
            if current:
                token = "".join(current)
                if token and token not in _STOPWORDS:
                    tokens.append(token)
                current = []
    if current:
        token = "".join(current)
        if token and token not in _STOPWORDS:
            tokens.append(token)
    return tokens


def _token_score(tokens: list[str], *values: str) -> int:
    score = 0
    haystack = " ".join(values).lower()
    for token in tokens:
        if token and token in haystack:
            score += 1
    return score


def _parse_field_info(meta: dict) -> dict[str, list[dict]]:
    fields_by_type: dict[str, list[dict]] = {}
    for item in meta.get("items", []):
        summary = item.get("summary", "")
        signature = summary.split(" | ", 1)[0]
        type_name, field_name, args, return_type = _parse_signature(signature)
        if not type_name or not field_name or not return_type:
            continue
        info = {
            "type_name": type_name,
            "field_name": field_name,
            "args": args,
            "return_type": return_type,
            "summary": summary,
        }
        fields_by_type.setdefault(type_name, []).append(info)
    return fields_by_type


def _format_args(args: list[tuple[str, str]]) -> str:
    if not args:
        return ""
    rendered = ", ".join(f"{name}: <{arg_type}>" for name, arg_type in args)
    return f"({rendered})"


def _render_selection_set(
    type_name: str,
    fields_by_type: dict[str, list[dict]],
    tokens: list[str],
    depth: int = 1,
    max_fields: int = 6,
) -> str | None:
    fields = list(fields_by_type.get(type_name, []))
    if not fields:
        return None

    def rank(field: dict) -> tuple[int, int, str]:
        base = _token_score(tokens, field["field_name"], field.get("summary", ""))
        if field["field_name"] in {"id", "name"}:
            base += 2
        return_type = field.get("return_type", "")
        if _base_type(return_type) in _SCALAR_TYPES:
            return (base + 1, 1, field["field_name"])
        return (base, 0, field["field_name"])

    fields.sort(key=rank, reverse=True)

    selections: list[str] = []
    for field in fields:
        if len(selections) >= max_fields:
            break
        return_type = field.get("return_type", "")
        base_type = _base_type(return_type)
        if base_type in _SCALAR_TYPES:
            selections.append(field["field_name"])
            continue
        if depth <= 0:
            continue
        nested = _render_selection_set(
            base_type,
            fields_by_type,
            tokens,
            depth=depth - 1,
            max_fields=max(2, max_fields // 2),
        )
        if nested:
            selections.append(f"{field['field_name']} {nested}")

    if not selections:
        return None
    return "{ " + " ".join(selections) + " }"


def ensure_schema_indexed(*, force: bool = False) -> dict:
    try:
        with _INDEX_LOCK:
            if ENDPOINT_URL:
                if not SCHEMA_TEXT:
                    raise RuntimeError("Endpoint mode requires schema introspection text.")
                return ensure_index_text(
                    SCHEMA_TEXT,
                    schema_source=SCHEMA_SOURCE,
                    data_dir=DATA_DIR,
                    embed_model=EMBED_MODEL,
                    embedder=embedder,
                    store=store,
                    force=force,
                )
            return ensure_index(
                schema_path=SCHEMA_PATH,
                data_dir=DATA_DIR,
                embed_model=EMBED_MODEL,
                embedder=embedder,
                store=store,
                force=force,
            )
    except Exception as exc:
        raise RuntimeError(f"Schema index not available for {SCHEMA_PATH}: {exc}")


@mcp.tool()
def list_types(query: str, limit: int = 5) -> list:
    """
    Fuzzy search the schema for matching type.field signatures.
    Uses the persisted embedding index (auto-builds if missing/outdated).
    """
    meta = ensure_schema_indexed(force=False)
    fields_by_type = _parse_field_info(meta)
    tokens = _tokenize(query)

    capped_limit = max(1, min(limit, 20))
    query_vec = embedder.embed_one(query)
    results = store.search(query_vec, limit=capped_limit)
    results.sort(key=lambda item: (item.get("type") != "Query", -item.get("score", 0.0)))

    formatted = []
    for item in results:
        summary = item.get("summary", "")
        signature = summary.split(" | ", 1)[0]
        type_name, field_name, args, return_type = _parse_signature(signature)

        entry = {
            "type": item.get("type"),
            "field": item.get("field"),
            "summary": summary,
        }

        if type_name == "Query":
            selection = None
            if _base_type(return_type) not in _SCALAR_TYPES:
                selection = _render_selection_set(
                    _base_type(return_type),
                    fields_by_type,
                    tokens,
                    depth=2,
                    max_fields=6,
                )
            selection_part = f" {selection}" if selection else ""
            entry["query_template"] = f"query {{ {field_name}{_format_args(args)}{selection_part} }}"
        elif _base_type(return_type) not in _SCALAR_TYPES:
            selection = _render_selection_set(
                _base_type(return_type),
                fields_by_type,
                tokens,
                depth=1,
                max_fields=5,
            )
            if selection:
                entry["selection_hint"] = f"{field_name} {selection}"

        formatted.append(entry)

    return formatted


@mcp.tool()
def run_query(query: str) -> dict:
    """
    Validate and run a GraphQL query against the static schema.

    Note: No resolvers are provided, so fields resolve to null;
    this is mainly for validation and shape checking.
    """
    if ENDPOINT_URL:
        try:
            payload = {"query": query}
            result = _post_json(ENDPOINT_URL, payload, headers=_REMOTE_HEADERS, timeout_s=_REMOTE_TIMEOUT_S)
        except Exception as exc:
            raise RuntimeError(f"Endpoint query failed: {exc}")
        output: dict = {"valid": not bool(result.get("errors"))}
        if "errors" in result:
            output["errors"] = result["errors"]
        if "data" in result:
            output["data"] = result["data"]
        if "extensions" in result:
            output["extensions"] = result["extensions"]
        return output

    schema = build_schema(SCHEMA_PATH.read_text())
    result = graphql_sync(schema, query)
    output = {"valid": not bool(result.errors)}
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
    source_group = parser.add_mutually_exclusive_group()
    source_group.add_argument(
        "--schema",
        type=Path,
        default=SCHEMA_PATH,
        help="Path to a GraphQL schema file (SDL).",
    )
    source_group.add_argument(
        "--endpoint",
        default=ENDPOINT_URL,
        help="GraphQL endpoint URL (uses introspection for indexing and proxies queries).",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DATA_DIR,
        help="Directory for the persisted embedding index (default: data/ next to this server).",
    )
    parser.add_argument(
        "--model",
        default=EMBED_MODEL,
        help="OpenAI embedding model to use for indexing/search queries.",
    )
    parser.add_argument(
        "--header",
        action="append",
        default=[],
        help="Add an HTTP header for endpoint mode, like 'Authorization: Bearer ...' (repeatable).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP timeout (seconds) for endpoint introspection/querying.",
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

    _REMOTE_HEADERS = _parse_headers(args.header)
    _REMOTE_TIMEOUT_S = float(args.timeout)

    if args.endpoint:
        schema_text = _introspect_schema_sdl(args.endpoint, headers=_REMOTE_HEADERS, timeout_s=_REMOTE_TIMEOUT_S)
        configure_runtime_endpoint(
            endpoint_url=args.endpoint,
            data_dir=args.data_dir,
            embed_model=args.model,
            schema_text=schema_text,
            schema_source={"kind": "endpoint", "url": args.endpoint, "headers": sorted(_REMOTE_HEADERS.keys())},
        )
    else:
        configure_runtime(schema_path=args.schema, data_dir=args.data_dir, embed_model=args.model)

    mcp.settings.host = args.host
    mcp.settings.port = args.port
    mcp.settings.log_level = args.log_level
    mcp.settings.mount_path = args.mount_path

    print(
        f"Starting {APP_NAME} with transport={args.transport}, "
        f"host={mcp.settings.host}, port={mcp.settings.port}, "
        f"schema={SCHEMA_PATH}",
        flush=True,
    )
    threading.Thread(
        target=lambda: ensure_schema_indexed(force=False),
        daemon=True,
        name="graphql-mcp-indexer",
    ).start()
    mcp.run(transport=args.transport, mount_path=args.mount_path)
