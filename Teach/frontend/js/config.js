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
const ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK = '{{ONBOARDING_QUESTIONNAIRE_LINK}}';
const ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK = 'https://forms.gle/hghifvApKXPU1TjK6';
const ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL = (
    'https://docs.google.com/forms/d/e/'
    + '1FAIpQLSdE5BiT1SLKPhP2dH1L-kus0oey4857psewaZz6rA8o_c469g/viewform'
);
const ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY = '326737977';
const TEACH_ONBOARDING_WELCOME_TEMPLATE = [
    'Hi! 👋',
    'Thank you for participating in this experiment.',
    '',
    'We are exploring how interactive games can make learning English more fun and less stressful 🌱',
    '',
    'You will be one of the first to try our detective game, so your feedback is very important for our research ✨',
    '',
    'Before you start, please answer some questions in Google Forms, it will take 5-7 minutes:',
    `[Open pre-game questionnaire](${ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK})`
].join('\n');

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
        'task'
    ],
    readingHeadingPatterns: [
        'reading',
        'story',
        'text'
    ]
};

const TEACH_EXERCISE_BUTTON_POLICY_BY_CATEGORY = {
    writing: {
        check: false,
        reset: false
    }
};

const TEACH_EPISODE_COMPLETION_THRESHOLD = 0.75;
const TEACH_EXERCISE_PROGRESS_EXCLUDED_RENDERERS = ['suspects_drag'];

window.TEACH_CONFIG = {
    API_URL,
    teachIsLocalhost,
    TEACH_WEEKS,
    TEACH_PROGRESS_STORAGE_KEY,
    TEACH_CONTENT_SETTINGS,
    TEACH_EXERCISE_BUTTON_POLICY_BY_CATEGORY,
    TEACH_EPISODE_COMPLETION_THRESHOLD,
    TEACH_EXERCISE_PROGRESS_EXCLUDED_RENDERERS,
    ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK,
    ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK,
    ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL,
    ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY,
    TEACH_ONBOARDING_WELCOME_TEMPLATE
};

if (typeof window !== 'undefined') {
    window.API_URL = API_URL;
}

