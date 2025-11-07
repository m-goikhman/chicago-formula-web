// Configuration and constants
// Automatically detect if running locally or in production
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.protocol === 'file:';

const API_URL = isLocalhost 
    ? 'http://localhost:8000'  // Local backend
    : 'https://teach-tell-backend-801526931549.europe-west4.run.app';  // Production backend

// Log which API URL is being used (for debugging)
console.log('API URL:', API_URL, '(Localhost:', isLocalhost + ')');

// List of all characters (excluding "Everyone")
const allCharacters = [
    { name: 'Tim Kane', image: 'tim.png' },
    { name: 'Ronnie Snapper', image: 'ronnie.png' },
    { name: 'Fiona McAllister', image: 'fiona.png' },
    { name: 'Pauline Thompson', image: 'pauline.png' }
];

// Global state variables
let sessionToken = '';
let participantCode = '';
let currentCharacter = null; // Track active character

