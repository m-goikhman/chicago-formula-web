FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY shared/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy unified backend (FastAPI app + shared auth/progress/secrets)
COPY shared/backend ./shared/backend

# Resolve package `shared.backend` from repo root layout
ENV PYTHONPATH="/app"

# Cloud Run listens on PORT
ENV PORT=8080

CMD exec uvicorn shared.backend.main:app --host 0.0.0.0 --port $PORT
