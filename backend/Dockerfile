FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# Set PORT variable for Cloud Run
ENV PORT=8080

# Start server
CMD exec uvicorn main:app --host 0.0.0.0 --port $PORT
