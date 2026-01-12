FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY schema.graphql /app/schema.graphql
COPY test_graphql_server /app/test_graphql_server

WORKDIR /app/test_graphql_server

EXPOSE 4000

CMD ["python3", "server.py", "--host", "0.0.0.0", "--port", "4000"]
