const sharedTeachConfig = window.sharedConfig;
if (!sharedTeachConfig) {
    throw new Error('sharedConfig must be loaded before Teach config');
}

const teachIsLocalhost = sharedTeachConfig.isLocalhost;
const API_URL = sharedTeachConfig.resolveApiBase({
    local: sharedTeachConfig.getLocalDevApiBase(8000),
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
const WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK = '{{QUESTIONNAIRE_LINK}}';
const NEXT_EPISODE_CALENDAR_TEMPLATE_LINK = '{{NEXT_EPISODE_CALENDAR_LINK}}';
const WEEKLY_QUESTIONNAIRE_FALLBACK_STATIC_LINK = 'https://forms.gle/hWc2Uedw8KkdCLhv6';
const WEEKLY_QUESTIONNAIRE_FORM_VIEW_URL = (
    'https://docs.google.com/forms/d/e/'
    + '1FAIpQLSf7wqiYQXAQZLF3I_lbItkm2iAG8ro6aYUhkj8z7bHt_Pj0WQ/viewform'
);
const WEEKLY_QUESTIONNAIRE_PARTICIPANT_ENTRY = '1171438860';
const WEEKLY_QUESTIONNAIRE_WEEK_ENTRY = '1690586821';
const CALENDAR_REMINDER_TITLE = 'Teach&Tell: Next episode unlock';
const CALENDAR_REMINDER_DETAILS = (
    'Your next Teach&Tell episode is now unlocked. '
    + 'Episodes unlock every week from your game start date. '
    + 'Open the game: https://chicago-formula-n.web.app/'
);
const TEACH_DEMO_OUTRO_TEXT = [
    'Thanks for playing!',
    '',
    'You can keep exploring the next episode whenever you like.'
].join('\n');
const TEACH_OUTRO_QUESTIONNAIRE_TEMPLATE = [
    'Thanks for playing!',
    '',
    `Please answer this [questionnaire:](${WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK}) (the link will take you to Google Forms).`,
    'It will take about 3-5 minutes of your time.',
    '',
    'The game will continue next week.',
    `You can [add a weekly reminder to Google Calendar](${NEXT_EPISODE_CALENDAR_TEMPLATE_LINK}) to get notified when the next episode unlocks.`
].join('\n');
const TEACH_DEMO_ONBOARDING_INTRO = [
    'This is Demo of control group condition.',
    '',
    'You can check all the episodes in the game.',
].join('\n');

const TEACH_DEMO_SURVEY_FOLD_LABEL = 'Study questionnaires (not required for demo)';

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
        title: 'Episode 1 · The Party',
        source: '../week1_the_party.md',
        order: 1
    },
    {
        id: 'week2',
        title: 'Episode 2 · Someone Unexpected',
        order: 2
    },
    {
        id: 'week3',
        title: 'Episode 3 · The Formula',
        order: 3
    },
    {
        id: 'week4',
        title: 'Episode 4 · Someone Missing',
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
    WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK,
    NEXT_EPISODE_CALENDAR_TEMPLATE_LINK,
    WEEKLY_QUESTIONNAIRE_FALLBACK_STATIC_LINK,
    WEEKLY_QUESTIONNAIRE_FORM_VIEW_URL,
    WEEKLY_QUESTIONNAIRE_PARTICIPANT_ENTRY,
    WEEKLY_QUESTIONNAIRE_WEEK_ENTRY,
    CALENDAR_REMINDER_TITLE,
    CALENDAR_REMINDER_DETAILS,
    TEACH_OUTRO_QUESTIONNAIRE_TEMPLATE,
    TEACH_DEMO_OUTRO_TEXT,
    TEACH_ONBOARDING_WELCOME_TEMPLATE,
    TEACH_DEMO_ONBOARDING_INTRO,
    TEACH_DEMO_SURVEY_FOLD_LABEL
};

if (typeof window !== 'undefined') {
    window.API_URL = API_URL;
}

