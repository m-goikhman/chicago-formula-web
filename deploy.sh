#!/bin/bash

# Script for sequential deployment of backend and frontend
# Usage: ./deploy.sh

# Don't use set -e globally, we'll handle errors per section
set +e

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

# Interactive menu for deployment selection
show_deployment_menu() {
    echo ""
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "Select what to deploy:"
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "  ${GREEN}1${NC}) Backend (Teach & Tell - Cloud Run)"
    echo -e "  ${GREEN}2${NC}) Tell - Frontend (Firebase Hosting)"
    echo -e "  ${GREEN}3${NC}) Teach - Frontend (Firebase Hosting)"
    echo -e "  ${GREEN}4${NC}) Portal - Frontend (Firebase Hosting)"
    echo -e "  ${GREEN}5${NC}) Deploy everything"
    echo -e "  ${YELLOW}0${NC}) Cancel"
    echo ""
    echo -ne "${BLUE}Enter your choice [1-5, 0 to cancel]: ${NC}"
    read -r choice
    
    # Initialize all flags to false
    DEPLOY_BACKEND=false
    DEPLOY_TELL_FRONTEND=false
    DEPLOY_TEACH_FRONTEND=false
    DEPLOY_PORTAL_FRONTEND=false

    case "$choice" in
        1)
            DEPLOY_BACKEND=true
            ;;
        2)
            DEPLOY_TELL_FRONTEND=true
            ;;
        3)
            DEPLOY_TEACH_FRONTEND=true
            ;;
        4)
            DEPLOY_PORTAL_FRONTEND=true
            ;;
        5)
            DEPLOY_BACKEND=true
            DEPLOY_TELL_FRONTEND=true
            DEPLOY_TEACH_FRONTEND=true
            DEPLOY_PORTAL_FRONTEND=true
            ;;
        0)
            info "Deployment cancelled."
            exit 0
            ;;
        *)
            error "Invalid choice. Please run the script again."
            exit 1
            ;;
    esac
    
    echo ""
    info "Selected deployment options:"
    if [ "$DEPLOY_BACKEND" = true ]; then
        echo -e "  ${GREEN}✓${NC} Backend (Teach & Tell)"
    fi
    if [ "$DEPLOY_TELL_FRONTEND" = true ]; then
        echo -e "  ${GREEN}✓${NC} Tell Frontend"
    fi
    if [ "$DEPLOY_TEACH_FRONTEND" = true ]; then
        echo -e "  ${GREEN}✓${NC} Teach Frontend"
    fi
    if [ "$DEPLOY_PORTAL_FRONTEND" = true ]; then
        echo -e "  ${GREEN}✓${NC} Portal Frontend"
    fi
    echo ""
}

sync_shared_frontend() {
    local shared_source="$SCRIPT_DIR/shared/frontend"
    local teach_target="$SCRIPT_DIR/Teach/frontend/shared"
    local tell_target="$SCRIPT_DIR/Tell/frontend/shared"
    local portal_target="$SCRIPT_DIR/Portal/frontend/shared"

    if [ ! -d "$shared_source" ]; then
        warning "Shared frontend source not found: $shared_source"
        return
    fi

    info "Syncing shared frontend assets..."
    
    # Function to sync directory, checking for local modifications
    sync_directory_safe() {
        local source_dir="$1"
        local target_dir="$2"
        local label="$3"
        
        if [ ! -d "$source_dir" ]; then
            return
        fi
        
        # Check for modified files before syncing
        local modified_files=()
        if [ -d "$target_dir" ]; then
            while IFS= read -r -d '' file; do
                local rel_path="${file#$source_dir/}"
                local target_file="$target_dir/$rel_path"
                if [ -f "$target_file" ] && ! cmp -s "$file" "$target_file" 2>/dev/null; then
                    modified_files+=("$rel_path")
                fi
            done < <(find "$source_dir" -type f -print0 2>/dev/null)
        fi
        
        # Warn about local modifications
        if [ ${#modified_files[@]} -gt 0 ]; then
            warning "Found ${#modified_files[@]} file(s) with local modifications in $label:"
            for file in "${modified_files[@]}"; do
                warning "  - $file"
            done
            warning "These files will be overwritten with versions from shared/frontend"
            warning "To preserve local changes, move them to shared/frontend first"
            
            # Skip interactive prompt if SKIP_SYNC_CONFIRM is set
            if [ "${SKIP_SYNC_CONFIRM:-false}" != "true" ]; then
                echo ""
                read -p "Continue with sync? (y/N): " -n 1 -r
                echo ""
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    warning "Skipping sync for $label"
                    return
                fi
            else
                info "Auto-confirming sync (SKIP_SYNC_CONFIRM=true)"
            fi
        fi
        
        # Perform sync: remove target and copy from source
        if [ -d "$target_dir" ]; then
            rm -rf "$target_dir"
        fi
        mkdir -p "$target_dir"
        cp -r "$source_dir"/* "$target_dir"/ 2>/dev/null || true
        success "Shared assets synced to $label"
    }
    
    # Sync to Teach frontend
    if [ -d "$SCRIPT_DIR/Teach/frontend" ]; then
        sync_directory_safe "$shared_source" "$teach_target" "Teach/frontend/shared"
    fi
    
    # Sync to Tell frontend
    if [ -d "$SCRIPT_DIR/Tell/frontend" ]; then
        sync_directory_safe "$shared_source" "$tell_target" "Tell/frontend/shared"
    fi

    # Sync to Portal frontend (Firebase hosting cannot serve ../../shared/frontend)
    if [ -d "$SCRIPT_DIR/Portal/frontend" ]; then
        sync_directory_safe "$shared_source" "$portal_target" "Portal/frontend/shared"
    fi
}

deploy_frontend() {
    local label="$1"
    local directory="$2"
    local hosting_target="$3"

    if [ ! -d "$directory" ]; then
        error "Directory not found: $directory"
        exit 1
    fi

    if [ ! -f "$directory/firebase.json" ]; then
        error "firebase.json missing in $directory"
        exit 1
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

PORTAL_FIREBASE_TARGET=${PORTAL_FIREBASE_TARGET:-chicago-formula}
TELL_FIREBASE_TARGET=${TELL_FIREBASE_TARGET:-chicago-formula-n}
TEACH_FIREBASE_TARGET=${TEACH_FIREBASE_TARGET:-chicago-formula-t}

# Check if deployment flags are set via environment variables (non-interactive mode)
if [ -n "$DEPLOY_BACKEND" ] || [ -n "$DEPLOY_TELL_FRONTEND" ] || [ -n "$DEPLOY_TEACH_FRONTEND" ] || [ -n "$DEPLOY_PORTAL_FRONTEND" ]; then
    # Non-interactive mode: use environment variables
    DEPLOY_BACKEND=${DEPLOY_BACKEND:-false}
    DEPLOY_TELL_FRONTEND=${DEPLOY_TELL_FRONTEND:-false}
    DEPLOY_TEACH_FRONTEND=${DEPLOY_TEACH_FRONTEND:-false}
    DEPLOY_PORTAL_FRONTEND=${DEPLOY_PORTAL_FRONTEND:-false}
    info "Using environment variables for deployment selection (non-interactive mode)"
else
    # Interactive mode: show menu
    show_deployment_menu
fi

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
# BACKEND DEPLOYMENT
# ============================================
if [ "$DEPLOY_BACKEND" = true ]; then
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "Deploying Backend (Cloud Run)"
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    set -e  # Enable error checking for this section
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
    set +e
    echo ""
fi

# ============================================
# SYNC SHARED FRONTEND ASSETS
# ============================================
if [ "$DEPLOY_TELL_FRONTEND" = true ] || [ "$DEPLOY_TEACH_FRONTEND" = true ]; then
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "Syncing shared frontend assets"
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    set -e  # Enable error checking for this section
    sync_shared_frontend
    set +e
    echo ""
fi

# ============================================
# FRONTEND DEPLOYMENT
# ============================================
if [ "$DEPLOY_PORTAL_FRONTEND" = true ] || [ "$DEPLOY_TELL_FRONTEND" = true ] || [ "$DEPLOY_TEACH_FRONTEND" = true ]; then
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    info "Deploying Frontends (Firebase Hosting)"
    info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
fi

if [ "$DEPLOY_PORTAL_FRONTEND" = true ]; then
    set -e  # Enable error checking for this section
    deploy_frontend "Portal" "$SCRIPT_DIR/Portal/frontend" "$PORTAL_FIREBASE_TARGET"
    set +e
fi

if [ "$DEPLOY_TELL_FRONTEND" = true ]; then
    set -e  # Enable error checking for this section
    deploy_frontend "Tell" "$SCRIPT_DIR/Tell/frontend" "$TELL_FIREBASE_TARGET"
    set +e
fi

if [ "$DEPLOY_TEACH_FRONTEND" = true ]; then
    set -e  # Enable error checking for this section
    deploy_frontend "Teach" "$SCRIPT_DIR/Teach/frontend" "$TEACH_FIREBASE_TARGET"
    set +e
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

