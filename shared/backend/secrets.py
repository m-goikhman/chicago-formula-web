import os
import sys
from google.cloud import secretmanager


def get_secret(secret_name: str, default_env: str | None = None) -> str | None:
    """
    Retrieve a secret from Google Secret Manager or fall back to an environment variable.
    """
    try:
        client = secretmanager.SecretManagerServiceClient()
        project_id = os.getenv('GOOGLE_CLOUD_PROJECT', 'the-chicago-formula')
        name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        secret_value = response.payload.data.decode("UTF-8").strip()
        return secret_value
    except Exception as exc:
        if default_env:
            value = os.getenv(default_env)
            if value:
                print(
                    f"WARNING: Using environment variable for {secret_name}. Secret Manager failed: {exc}",
                    file=sys.stderr
                )
                return value.strip()
        return None


# Optional secrets used by both applications
TELEGRAM_TOKEN = None  # Included for backwards compatibility with bot version
GROQ_API_KEY = get_secret("groq-api-key", "GROQ_API_KEY")
GCS_BUCKET_NAME = get_secret("gcs-bucket-name", "GCS_BUCKET_NAME")

if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY not found. AI features will not work.", file=sys.stderr)

if not GCS_BUCKET_NAME:
    print("WARNING: GCS_BUCKET_NAME not found. Cloud storage features disabled.", file=sys.stderr)


__all__ = [
    "get_secret",
    "TELEGRAM_TOKEN",
    "GROQ_API_KEY",
    "GCS_BUCKET_NAME",
]

