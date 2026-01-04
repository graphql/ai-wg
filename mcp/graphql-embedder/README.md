# GraphQL schema embedder MCP server

Minimal Python MCP server that indexes a GraphQL schema once, stores OpenAI embeddings for each `type->field`, and serves fast lookup for relevant fields.

## Architecture
- GraphQL schema: `schema.graphql` is a small e-commerce example to exercise parsing and indexing.
- Indexer: `schema_index.py` flattens the schema into `type.field` signatures (with arguments and return types), embeds each summary via OpenAI, and persists to `data/metadata.json` + `data/vectors.npz` (normalized embeddings for cosine search).
- Server: `server.py` exposes MCP tools `index_status`, `reindex_schema`, and `search_schema`. The server reads the persisted index and only touches OpenAI when reindexing or embedding a new query.
- Persistence: `data/` is `.gitignore`'d so you can regenerate locally without polluting the repo.

## Setup
1st create a `.env` file with `OPENAI_API_KEY`.
```bash
cd mcp/graphql-embedder
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=...  # required for indexing and querying
```

## Index the schema
```bash
python schema_index.py  # uses schema.graphql and data/ by default
```
Outputs a count plus schema hash; rerun after editing the schema.

## Search via CLI (no server)
```bash
python schema_index.py search "find order mutations"
python schema_index.py search "product price fields" --limit 3
```
Search uses the persisted index; run `python schema_index.py index` (or just `python schema_index.py`) first if no data exists.

## Run the MCP server
```bash
python server.py                      # stdio (no port, for MCP host that speaks stdio)
python server.py --transport sse      # SSE on 127.0.0.1:8000/sse by default
python server.py --transport streamable-http  # Streamable HTTP on 127.0.0.1:8000/mcp
# Options: --host 0.0.0.0 --port 9000 --log-level DEBUG --mount-path /myapp
```
Tools:
- `list_types(query, limit=5)` – fuzzy search over `type.field` signatures (embeddings; auto-build index if missing).
- `run_query(query, variables=None)` – validate and execute a query against the schema (no resolvers; primarily for validation/shape checking, data resolves to null).

On first search without an index, call `reindex_schema` to build it. Both indexing and querying use the same embedding model (`text-embedding-3-small` by default).

Notes:
- `python server.py` defaults to the stdio transport, so you won’t see an HTTP port unless you pass `--transport sse` or `--transport streamable-http`.
- You can also set env vars prefixed with `FASTMCP_` (e.g., `FASTMCP_HOST`, `FASTMCP_PORT`, `FASTMCP_LOG_LEVEL`) to override defaults.

## Quick test with the MCP Inspector (fixed defaults)
1) Ensure deps: `pip install -r requirements.txt` and set `OPENAI_API_KEY=...` (embeddings needed for fuzzy search)  
2) Launch the Inspector (requires `npm`/`npx` on PATH and `pip install 'mcp[cli]'`):  
   ```bash
   mcp dev server.py  # now defaults to SSE transport so the Inspector can connect
   ```  
   From the Inspector, call `list_types` (with a query string) and `run_query` to smoke-test the tools.
3) If you prefer stdio, override: `MCP_TRANSPORT=stdio mcp dev server.py` or `python server.py --transport stdio`.
