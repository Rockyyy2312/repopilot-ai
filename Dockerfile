# syntax=docker/dockerfile:1.7

FROM node:22.12.0-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm test && npm run build

FROM frontend-build AS frontend-test

FROM python:3.11-slim-bookworm AS backend-test
WORKDIR /build/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/tests ./tests
RUN python -m pytest -q

FROM python:3.11-slim-bookworm AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    REPOPILOT_ENV=production \
    REPOPILOT_SECURE_COOKIES=true \
    FRONTEND_DIST_DIR=/app/frontend-dist \
    REPOPILOT_DATA_DIR=/app/data \
    REPOPILOT_AUTH_DB=/app/data/repopilot-auth.sqlite3

RUN addgroup --system --gid 10001 repopilot \
    && adduser --system --uid 10001 --ingroup repopilot --home /nonexistent --no-create-home repopilot
COPY backend/requirements-runtime.txt ./requirements-runtime.txt
RUN pip install --no-cache-dir -r requirements-runtime.txt
COPY backend/app ./app
COPY --from=frontend-build /build/frontend/dist ./frontend-dist
RUN chown -R repopilot:repopilot /app

USER repopilot
VOLUME ["/app/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "from urllib.request import urlopen; response=urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3); raise SystemExit(0 if response.status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
