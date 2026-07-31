#!/usr/bin/env bash
#
# Start (or stop) the shared backend and all three frontends for local development.
#
# Usage:
#   ./dev-local.sh              # sync shared assets, start everything
#   ./dev-local.sh --no-sync    # skip shared/frontend → Teach|Tell|Portal copy
#   ./dev-local.sh stop         # stop background processes
#   ./dev-local.sh status       # show running dev servers
#
# URLs (defaults):
#   Portal  http://127.0.0.1:3080/portal.html
#   Tell    http://127.0.0.1:3081/
#   Teach   http://127.0.0.1:3082/
#   API     http://127.0.0.1:8000/docs
#
# Override ports via environment:
#   DEV_API_PORT=8000 DEV_PORTAL_PORT=3080 DEV_TELL_PORT=3081 DEV_TEACH_PORT=3082

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${SCRIPT_DIR}/.dev-local"
PID_FILE="${STATE_DIR}/pids"
LOG_DIR="${STATE_DIR}/logs"

API_PORT="${DEV_API_PORT:-8000}"
PORTAL_PORT="${DEV_PORTAL_PORT:-3080}"
TELL_PORT="${DEV_TELL_PORT:-3081}"
TEACH_PORT="${DEV_TEACH_PORT:-3082}"

VENV_DIR="${SCRIPT_DIR}/.venv"
REQUIREMENTS="${SCRIPT_DIR}/shared/backend/requirements.txt"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ${NC} $*" >&2; }
success() { echo -e "${GREEN}✓${NC} $*" >&2; }
warning() { echo -e "${YELLOW}⚠${NC} $*" >&2; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

port_busy() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    else
        python3 - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
try:
    s.bind(("127.0.0.1", port))
except OSError:
    sys.exit(0)
else:
    sys.exit(1)
finally:
    s.close()
PY
    fi
}

ensure_python() {
    if ! command -v python3 >/dev/null 2>&1; then
        error "python3 is required but not found in PATH"
        exit 1
    fi
}

ensure_venv() {
    ensure_python
    if [ ! -d "$VENV_DIR" ]; then
        info "Creating virtualenv at .venv"
        python3 -m venv "$VENV_DIR"
    fi
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
    pip install -q -r "$REQUIREMENTS" >&2
}

sync_shared_frontend() {
    local source="${SCRIPT_DIR}/shared/frontend"
    local teach_target="${SCRIPT_DIR}/Teach/frontend/shared"
    local tell_target="${SCRIPT_DIR}/Tell/frontend/shared"
    local portal_target="${SCRIPT_DIR}/Portal/frontend/shared"

    if [ ! -d "$source" ]; then
        warning "Missing shared frontend source: ${source}"
        return 0
    fi

    info "Syncing shared/frontend → Teach|Tell|Portal copies"
    mkdir -p "$(dirname "$teach_target")" "$(dirname "$tell_target")" "$(dirname "$portal_target")"
    rm -rf "$teach_target" "$tell_target" "$portal_target"
    cp -R "$source" "$teach_target"
    cp -R "$source" "$tell_target"
    cp -R "$source" "$portal_target"
    success "Shared frontend synced"
}

read_pids() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    # shellcheck disable=SC1090
    source "$PID_FILE"
}

write_pids() {
    mkdir -p "$STATE_DIR" "$LOG_DIR"
    cat >"$PID_FILE" <<EOF
BACKEND_PID=${BACKEND_PID:-}
PORTAL_PID=${PORTAL_PID:-}
TELL_PID=${TELL_PID:-}
TEACH_PID=${TEACH_PID:-}
API_PORT=${API_PORT}
PORTAL_PORT=${PORTAL_PORT}
TELL_PORT=${TELL_PORT}
TEACH_PORT=${TEACH_PORT}
EOF
}

stop_dev() {
    if ! read_pids 2>/dev/null; then
        info "No dev-local processes recorded (missing ${PID_FILE})"
        return 0
    fi

    local killed=0
    for name in BACKEND_PID PORTAL_PID TELL_PID TEACH_PID; do
        local pid="${!name:-}"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            info "Stopping ${name} (pid ${pid})"
            kill "$pid" 2>/dev/null || true
            killed=$((killed + 1))
        fi
    done

    sleep 0.5
    for name in BACKEND_PID PORTAL_PID TELL_PID TEACH_PID; do
        local pid="${!name:-}"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done

    rm -f "$PID_FILE"
    if [ "$killed" -gt 0 ]; then
        success "Stopped ${killed} process(es)"
    else
        info "Nothing was running"
    fi
}

status_dev() {
    if ! read_pids 2>/dev/null; then
        info "Dev stack is not running"
        return 0
    fi

    echo ""
    info "Dev stack status:"
    for name in BACKEND_PID PORTAL_PID TELL_PID TEACH_PID; do
        local pid="${!name:-}"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo -e "  ${GREEN}running${NC} ${name} pid=${pid}"
        else
            echo -e "  ${RED}stopped${NC} ${name}"
        fi
    done
    echo ""
    print_urls
}

print_urls() {
    cat <<EOF >&2

${GREEN}Local URLs${NC}
  Portal  http://127.0.0.1:${PORTAL_PORT}/portal.html
  Tell    http://127.0.0.1:${TELL_PORT}/
  Teach   http://127.0.0.1:${TEACH_PORT}/
  API     http://127.0.0.1:${API_PORT}/docs

Logs: ${LOG_DIR}/
Stop: ./dev-local.sh stop

EOF
}

start_static_server() {
    local label="$1"
    local port="$2"
    local directory="$3"
    local log_file="${LOG_DIR}/${label}.log"

    if port_busy "$port"; then
        error "Port ${port} is already in use (${label}). Stop the other process or change DEV_*_PORT."
        exit 1
    fi

    python3 -m http.server "$port" --bind 127.0.0.1 --directory "$directory" \
        >"$log_file" 2>&1 &
    echo $!
}

start_backend() {
    local log_file="${LOG_DIR}/backend.log"

    if port_busy "$API_PORT"; then
        error "Port ${API_PORT} is already in use (backend). Run ./dev-local.sh stop or set DEV_API_PORT."
        exit 1
    fi

    ensure_venv
    export PYTHONPATH="${SCRIPT_DIR}"
  # Optional: skip GCS when developing without credentials
    export SKIP_GCS="${SKIP_GCS:-1}"

    info "Starting backend on port ${API_PORT}"
    uvicorn shared.backend.main:app \
        --reload \
        --host 127.0.0.1 \
        --port "$API_PORT" \
        >"$log_file" 2>&1 &
    echo $!
}

check_ports_available() {
    for port in "$API_PORT" "$PORTAL_PORT" "$TELL_PORT" "$TEACH_PORT"; do
        if port_busy "$port"; then
            error "Port ${port} is already in use. Run ./dev-local.sh stop or change DEV_*_PORT."
            exit 1
        fi
    done
}

start_dev() {
    local do_sync=1
    for arg in "$@"; do
        case "$arg" in
            --no-sync) do_sync=0 ;;
            *)
                warning "Ignoring unknown start option: ${arg}"
                ;;
        esac
    done

    if read_pids 2>/dev/null; then
        local any_running=0
        for name in BACKEND_PID PORTAL_PID TELL_PID TEACH_PID; do
            local pid="${!name:-}"
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                any_running=1
                break
            fi
        done
        if [ "$any_running" -eq 1 ]; then
            warning "Dev stack already running. Use ./dev-local.sh stop first."
            status_dev
            exit 1
        fi
        rm -f "$PID_FILE"
    fi

    check_ports_available
    mkdir -p "$LOG_DIR"

    if [ "$do_sync" -eq 1 ]; then
        sync_shared_frontend
    else
        info "Skipping shared frontend sync (--no-sync)"
    fi

    info "Starting services..."
    BACKEND_PID="$(start_backend)"
    PORTAL_PID="$(start_static_server portal "$PORTAL_PORT" "${SCRIPT_DIR}/Portal/frontend")"
    TELL_PID="$(start_static_server tell "$TELL_PORT" "${SCRIPT_DIR}/Tell/frontend")"
    TEACH_PID="$(start_static_server teach "$TEACH_PORT" "${SCRIPT_DIR}/Teach/frontend")"

    write_pids

    sleep 1
    success "All services started"
    print_urls

    if command -v open >/dev/null 2>&1 && [ "${DEV_OPEN_BROWSER:-}" = "1" ]; then
        open "http://127.0.0.1:${PORTAL_PORT}/portal.html"
    fi
}

main() {
    cd "$SCRIPT_DIR"
    local cmd="start"

    case "${1:-}" in
        stop|status|restart|sync)
            cmd="$1"
            shift
            ;;
        start)
            shift
            ;;
        -h|--help)
            sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac

    case "$cmd" in
        start)
            start_dev "$@"
            ;;
        stop)
            stop_dev
            ;;
        status)
            status_dev
            ;;
        restart)
            stop_dev
            start_dev "$@"
            ;;
        sync)
            sync_shared_frontend
            ;;
        *)
            error "Unknown command: ${cmd}"
            echo "Usage: ./dev-local.sh [start|stop|status|restart|sync] [--no-sync]"
            exit 1
            ;;
    esac
}

main "$@"
