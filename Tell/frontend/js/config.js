// Configuration and constants
const sharedConfig = window.sharedConfig;
if (!sharedConfig) {
    throw new Error('sharedConfig must be loaded before Tell config');
}

const isLocalhost = sharedConfig.isLocalhost;
const API_URL = sharedConfig.resolveApiBase({
    local: sharedConfig.getLocalDevApiBase(8000),
    production: 'https://teach-tell-backend-801526931549.europe-west4.run.app'
});

if (typeof window !== 'undefined') {
    window.API_URL = API_URL;
}

console.log('API URL:', API_URL, '(Localhost:', String(isLocalhost) + ')');

const PORTAL_PRODUCTION_URL = 'https://chicago-formula.web.app/';
const PORTAL_LOCAL_URL = '../../Portal/frontend/portal.html';

function getPortalBaseUrl() {
    return isLocalhost ? PORTAL_LOCAL_URL : PORTAL_PRODUCTION_URL;
}

function buildPortalPosttestUrl() {
    const token = sessionToken || localStorage.getItem('sessionToken') || '';
    const code = participantCode || localStorage.getItem('participantCode') || '';
    let destination = getPortalBaseUrl();
    try {
        const url = new URL(destination, window.location.href);
        url.searchParams.set('phase', 'posttest');
        destination = url.toString();
    } catch (error) {
        console.warn('[Tell] Could not build portal posttest URL:', error);
    }
    if (window.authHandoff && typeof window.authHandoff.buildHandoffUrl === 'function' && token && code) {
        return window.authHandoff.buildHandoffUrl(destination, token, code);
    }
    return destination;
}

function navigateToPortalPosttest() {
    window.location.assign(buildPortalPosttestUrl());
}

window.buildPortalPosttestUrl = buildPortalPosttestUrl;
window.navigateToPortalPosttest = navigateToPortalPosttest;

// List of all characters (excluding "Everyone") — images in ep1/
const allCharacters = [
    { name: 'Tim Kane', image: 'ep1/tim.png' },
    { name: 'Ronnie Snapper', image: 'ep1/ronnie.png' },
    { name: 'Fiona McAllister', image: 'ep1/fiona.png' },
    { name: 'Pauline Thompson', image: 'ep1/pauline.png' }
];

// Global state variables
let sessionToken = '';
let participantCode = '';
let currentCharacter = null; // Track active character

