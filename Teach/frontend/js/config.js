const sharedTeachConfig = window.sharedConfig;
if (!sharedTeachConfig) {
    throw new Error('sharedConfig must be loaded before Teach config');
}

const teachIsLocalhost = sharedTeachConfig.isLocalhost;
const API_URL = sharedTeachConfig.resolveApiBase({
    local: 'http://localhost:8000',
    production: 'https://teach-tell-backend-801526931549.europe-west4.run.app'
});

const TEACH_PROGRESS_STORAGE_KEY = 'teach_mode_progress_v1';

const TEACH_WEEKS = [
    {
        id: 'week1',
        title: 'Week 1 · The Party',
        source: '../week1_the_party.md',
        order: 1
    },
    {
        id: 'week2',
        title: 'Week 2 · Secrets & Shadows',
        source: '../week2_secrets_and_shadows.md',
        order: 2
    },
    {
        id: 'week3',
        title: 'Week 3 · The Attack',
        source: '../week3_the_attack.md',
        order: 3
    },
    {
        id: 'week4',
        title: 'Week 4 · The Investigation',
        source: '../week4_the_investigation.md',
        order: 4
    }
];

const TEACH_CONTENT_SETTINGS = {
    summarySentenceLimit: 2,
    maxReadingPreviewChars: 220,
    taskHeadingPatterns: [
        'exercise',
        'writing',
        'question',
        'task',
        'grammar',
        'vocabulary'
    ],
    readingHeadingPatterns: [
        'reading',
        'story',
        'text'
    ]
};

window.TEACH_CONFIG = {
    API_URL,
    teachIsLocalhost,
    TEACH_WEEKS,
    TEACH_PROGRESS_STORAGE_KEY,
    TEACH_CONTENT_SETTINGS
};

