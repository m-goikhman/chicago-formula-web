// Configuration and constants
const sharedConfig = window.sharedConfig;
if (!sharedConfig) {
    throw new Error('sharedConfig must be loaded before Tell config');
}

const isLocalhost = sharedConfig.isLocalhost;
const API_URL = sharedConfig.resolveApiBase({
    local: 'http://localhost:8000',
    production: 'https://teach-tell-backend-801526931549.europe-west4.run.app'
});

if (typeof window !== 'undefined') {
    window.API_URL = API_URL;
}

console.log('API URL:', API_URL, '(Localhost:', String(isLocalhost) + ')');

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

