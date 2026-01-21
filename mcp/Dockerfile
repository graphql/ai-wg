FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py
COPY schema_indexer.py /app/schema_indexer.py
COPY schema.graphql /app/schema.graphql

EXPOSE 8000

CMD ["python3", "server.py", "--transport", "sse", "--host", "0.0.0.0", "--port", "8000"]
