FROM python:3.13-slim@sha256:bffeb7bd6a85767587059c6ba23e1e9122078e3aa3fa836099171b9bb5a9bb00

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libexpat1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.12.3

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ ./

RUN useradd --create-home --uid 10001 nightsky

USER nightsky

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "90", "--access-logfile", "-", "--error-logfile", "-"]
