# Test GraphQL server (for endpoint mode)

This is a tiny, dependency-free (stdlib) HTTP GraphQL server backed by `graphql-core`.

It exists so you can test `server.py --endpoint ...` and verify that `run_query` returns real data.

## Run
From `mcp/`:
```bash
python3 test_graphql_server/server.py --port 4000
```

GraphQL endpoint:
- `http://127.0.0.1:4000/graphql`

Health check:
- `http://127.0.0.1:4000/healthz`

## Example queries
```bash
curl -s http://127.0.0.1:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query($id: ID!){ user(id:$id){ id name email orders{ id status total }}}","variables":{"id":"u_1"}}' | jq
```
