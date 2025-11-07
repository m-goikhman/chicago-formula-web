#!/bin/bash

# Script for sequential deployment of backend and frontend
# Usage: ./deploy.sh

set -e  # Stop execution on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions for message output
info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

success() {
    echo -e "${GREEN}✓ ${NC}$1"
}

warning() {
    echo -e "${YELLOW}⚠ ${NC}$1"
}

error() {
    echo -e "${RED}✗ ${NC}$1"
}

# Get project root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

info "Starting TeachOrTell deployment..."
echo ""

# Check for required tools
info "Checking tools..."

if ! command -v gcloud &> /dev/null; then
    error "gcloud CLI not found. Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

if ! command -v firebase &> /dev/null; then
    error "Firebase CLI not found. Install: npm install -g firebase-tools"
    exit 1
fi

success "All required tools are installed"
echo ""

# Get current GCP project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    error "GCP project not configured. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

info "Using GCP project: ${GREEN}$PROJECT_ID${NC}"
echo ""

# ============================================
# BACKEND DEPLOYMENT
# ============================================
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Step 1/2: Deploying Backend (Cloud Run)"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd backend

info "Deploying backend to Cloud Run..."
gcloud run deploy teach-tell-backend \
  --source . \
  --platform managed \
  --region europe-west4 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT="$PROJECT_ID" \
  --memory 1Gi \
  --cpu 1 \
  --timeout 900 \
  --max-instances 10

if [ $? -eq 0 ]; then
    success "Backend deployed successfully!"
    
    # Get backend URL
    BACKEND_URL=$(gcloud run services describe teach-tell-backend \
      --region europe-west4 \
      --format 'value(status.url)' 2>/dev/null)
    
    if [ ! -z "$BACKEND_URL" ]; then
        info "Backend URL: ${GREEN}$BACKEND_URL${NC}"
    fi
else
    error "Error deploying backend!"
    exit 1
fi

echo ""
cd ..

# ============================================
# FRONTEND DEPLOYMENT
# ============================================
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Step 2/2: Deploying Frontend (Firebase Hosting)"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd frontend

info "Deploying frontend to Firebase Hosting..."
firebase deploy --only hosting

if [ $? -eq 0 ]; then
    success "Frontend deployed successfully!"
else
    error "Error deploying frontend!"
    exit 1
fi

echo ""
cd ..

# ============================================
# COMPLETION
# ============================================
success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "Deployment completed successfully! 🎉"
success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -z "$BACKEND_URL" ]; then
    info "Backend: ${GREEN}$BACKEND_URL${NC}"
fi

info "Frontend: Check URL in Firebase Console or run: ${YELLOW}firebase hosting:sites:list${NC}"
echo ""

