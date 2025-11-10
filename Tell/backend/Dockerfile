FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY Tell/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy Tell backend source
COPY Tell/backend/ .
# Copy shared backend utilities
COPY shared/backend ./shared/backend

# Set Python path so shared modules are discoverable
ENV PYTHONPATH="/app:/app/shared/backend"

# Set PORT variable for Cloud Run
ENV PORT=8080

# Start server
CMD exec uvicorn main:app --host 0.0.0.0 --port $PORT
