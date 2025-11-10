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

should_deploy() {
    local flag=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
    case "$flag" in
        true|1|yes|y) return 0 ;;
        *) return 1 ;;
    esac
}

deploy_frontend() {
    local label="$1"
    local directory="$2"
    local hosting_target="$3"

    if [ ! -d "$directory" ]; then
        warning "Skipping ${label} frontend: directory not found ($directory)"
        return
    fi

    if [ ! -f "$directory/firebase.json" ]; then
        warning "Skipping ${label} frontend: firebase.json missing in $directory"
        return
    fi

    info "Deploying ${label} frontend (${directory})..."
    pushd "$directory" > /dev/null
    if [ -n "$hosting_target" ]; then
        firebase deploy --only "hosting:${hosting_target}" --project "$FIREBASE_PROJECT_ID"
    else
        firebase deploy --only hosting --project "$FIREBASE_PROJECT_ID"
    fi
    local status=$?
    popd > /dev/null

    if [ $status -eq 0 ]; then
        success "${label} frontend deployed successfully!"
    else
        error "Error deploying ${label} frontend!"
        exit 1
    fi
}

# Get project root directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

DEPLOY_PORTAL_FRONTEND=${DEPLOY_PORTAL_FRONTEND:-true}
DEPLOY_TELL_FRONTEND=${DEPLOY_TELL_FRONTEND:-true}
DEPLOY_TEACH_FRONTEND=${DEPLOY_TEACH_FRONTEND:-true}
PORTAL_FIREBASE_TARGET=${PORTAL_FIREBASE_TARGET:-chicago-formula}
TELL_FIREBASE_TARGET=${TELL_FIREBASE_TARGET:-chicago-formula-n}
TEACH_FIREBASE_TARGET=${TEACH_FIREBASE_TARGET:-chicago-formula-t}

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

FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-$PROJECT_ID}
if [ -z "$FIREBASE_PROJECT_ID" ]; then
    error "Firebase project ID not set. Provide FIREBASE_PROJECT_ID env var or configure gcloud project."
    exit 1
fi

# Display Firebase project for clarity
info "Using Firebase project: ${GREEN}$FIREBASE_PROJECT_ID${NC}"
echo ""

# ============================================
# PREPARE CONTENT
# ============================================
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Step 0/3: Building Teach content bundle"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node Teach/scripts/build-content.mjs

if [ $? -eq 0 ]; then
    success "Teach content bundle updated!"
else
    error "Unable to build Teach content bundle"
    exit 1
fi

# ============================================
# BACKEND DEPLOYMENT
# ============================================
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Step 1/3: Deploying Backend (Cloud Run)"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BACKEND_IMAGE=${BACKEND_IMAGE:-"gcr.io/$PROJECT_ID/teach-tell-backend"}

info "Building backend container image..."
gcloud builds submit "$SCRIPT_DIR" \
  --tag "$BACKEND_IMAGE"

info "Deploying backend to Cloud Run..."
gcloud run deploy teach-tell-backend \
  --image "$BACKEND_IMAGE" \
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

# ============================================
# FRONTEND DEPLOYMENT
# ============================================
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Step 2/3: Deploying Frontends (Firebase Hosting)"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if should_deploy "$DEPLOY_PORTAL_FRONTEND"; then
    deploy_frontend "Portal" "$SCRIPT_DIR/Portal/frontend" "$PORTAL_FIREBASE_TARGET"
else
    warning "Skipping Portal frontend deployment (DEPLOY_PORTAL_FRONTEND=${DEPLOY_PORTAL_FRONTEND})"
fi

if should_deploy "$DEPLOY_TELL_FRONTEND"; then
    deploy_frontend "Tell" "$SCRIPT_DIR/Tell/frontend" "$TELL_FIREBASE_TARGET"
else
    warning "Skipping Tell frontend deployment (DEPLOY_TELL_FRONTEND=${DEPLOY_TELL_FRONTEND})"
fi

if should_deploy "$DEPLOY_TEACH_FRONTEND"; then
    deploy_frontend "Teach" "$SCRIPT_DIR/Teach/frontend" "$TEACH_FIREBASE_TARGET"
else
    warning "Skipping Teach frontend deployment (DEPLOY_TEACH_FRONTEND=${DEPLOY_TEACH_FRONTEND})"
fi

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

