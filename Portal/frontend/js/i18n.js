/* ── Portal i18n ─────────────────────────────────────────────────────
   Two-language support (IT / EN).
   Long consent-body HTML lives directly in portal.html as
   <div data-lang="it"> / <div data-lang="en" hidden> sibling blocks.
   Everything else is swapped via data-i18n / data-i18n-html attributes.
──────────────────────────────────────────────────────────────────── */

var PORTAL_TRANSLATIONS = {
    it: {
        introHow:
            '<h2 class="intro-heading">Come funziona</h2>' +
            '<p>Questo progetto di ricerca esplora diversi modi di imparare l’inglese attraverso storie investigative.' +
            ' Sarai assegnato a uno di due gruppi: uno lavora con un chatbot AI interattivo,' +
            ' l’altro con attività di lettura e scrittura.' +
            ' Entrambi i gruppi seguono la stessa storia e lo stesso mistero.</p>' +
            '<p>Un episodio a settimana, 4 settimane, circa 40–60 minuti ciascuno.' +
            ' Tutto online — telefono o computer.</p>',

        introWho:
            '<h2 class="intro-heading">Chi può partecipare</h2>' +
            '<p>Adulti (18+) con inglese intermedio (B1–B2).' +
            ' Puoi leggere e scrivere in inglese, anche se non sempre è facile.</p>' +
            '<ul class="intro-highlights">' +
            '<li>4 settimane, circa 40–60 min/settimana</li>' +
            '<li>Tutto online — telefono o computer</li>' +
            '<li>Crediti SONA per studenti UniTn (5 ore)</li>' +
            '</ul>',

        consentTitle:  'Prima di partecipare',
        consentIntro:  'Leggi entrambi i documenti e conferma il tuo consenso per procedere.',
        toggle1Title:  'Foglio informativo',
        toggle2Title:  'Informativa sul trattamento dei dati personali',
        check1Label:   'Ho letto e accetto il foglio informativo.',
        check2Label:   'Ho letto e accetto l’informativa sul trattamento dei dati.',
        continueBtn:   'Continua',
        footerContact: 'Domande? <a href="mailto:mariia.goikhman@unitn.it">mariia.goikhman@unitn.it</a>',

        surveyTitle: 'Profilo di apprendente linguistico',
        surveyLead:
            'Rispondi a tutte le domande. Per lettura, parlato e scrittura ci sono due affermazioni ciascuna: seleziona tutte quelle che ti descrivono.',
        surveySubmit: 'Invia e continua',
        studyCodeInstructions:
            '<p><strong>Codice partecipante.</strong> Crealo tu: <strong>due lettere</strong> (prime lettere del tuo nome) seguite da <strong>quattro cifre</strong> ' +
            '(giorno di nascita a due cifre + ultime due cifre del tuo numero di telefono). Lo stesso codice serve qui e nell’app.</p>',
        loginTitle: 'Accedi',
        loginLead: 'Il codice partecipante è quello che hai appena definito. Lo userai anche nell’applicazione dello studio.',
        participantCodeLabel: 'Codice partecipante',
        participantCodePlaceholder: 'es. AN0842',
        unlockButton: 'Sblocca accesso',
        unlockChecking: 'Verifica codice…',
        loginCodeMissing: 'Inserisci il tuo codice partecipante.',
        loginSuccessDual: 'Accesso riuscito! Scegli la modalità qui sotto.',
        sessionReadyDual: 'Sessione pronta. Puoi passare tra Teach e Tell in qualsiasi momento.',
        loginNetworkError: 'Impossibile contattare il server. Controlla la connessione e riprova.',
        sessionChipPrefix: 'Sessione attiva',
        modeSelectTitle: 'Come vuoi continuare',
        modeSelectLead: 'Entrambe le modalità condividono i progressi. Puoi passare dall’una all’altra.',
        assignedBlurb: 'Continui con l’attività assegnata per lo studio.',
        assignedContinueBtn: 'Vai all’attività',
        surveyLoadError: 'Impossibile caricare il questionario. Controlla la connessione.',
        surveySubmitError: 'Impossibile contattare il server. Riprova tra poco.',
        surveyValidationError: 'Rispondi a tutte le domande obbligatorie.',
        sessionClearedHint: 'Sessione azzerata. Inserisci un nuovo codice partecipante.',
        restoringSession: 'Ripristino sessione…',
        sessionRestoredAssigned: 'Sessione ripristinata. Continua con l’attività assegnata.',
        sessionRestoredDual: 'Sessione ripristinata. Scegli una modalità per continuare.',
        sessionExpired: 'Sessione scaduta. Inserisci di nuovo il codice partecipante.'
    },

    en: {
        introHow:
            '<h2 class="intro-heading">How it works</h2>' +
            '<p>This research project explores different ways of learning English through detective stories.' +
            ' You will be assigned to one of two groups: one works with an interactive AI chatbot,' +
            ' the other with reading and writing activities.' +
            ' Both groups follow the same story and the same mystery.</p>' +
            '<p>One episode per week, 4 weeks, approximately 40–60 minutes each.' +
            ' All online — phone or computer.</p>',

        introWho:
            '<h2 class="intro-heading">Who can join</h2>' +
            '<p>Adults (18+) with intermediate English (B1–B2).' +
            ' You can read and write in English, even if it is not always easy.</p>' +
            '<ul class="intro-highlights">' +
            '<li>4 weeks, approx. 40–60 min/week</li>' +
            '<li>All online — phone or computer</li>' +
            '<li>SONA credits for UniTn students (5 hours)</li>' +
            '</ul>',

        consentTitle:  'Before you participate',
        consentIntro:  'Please read both documents and confirm your consent to proceed.',
        toggle1Title:  'Study information sheet',
        toggle2Title:  'Privacy notice for research data processing',
        check1Label:   'I have read and accept the study information sheet.',
        check2Label:   'I have read and accept the privacy notice.',
        continueBtn:   'Continue',
        footerContact: 'Questions? <a href="mailto:mariia.goikhman@unitn.it">mariia.goikhman@unitn.it</a>',

        surveyTitle: 'Language learner profile',
        surveyLead:
            'Please answer every question. For Reading, Speaking, and Writing there are two statements each: select all that apply to you.',
        surveySubmit: 'Submit and continue',
        studyCodeInstructions:
            '<p><strong>Participant code.</strong> Create it yourself: <strong>two letters</strong> (first letters of your first name) followed by <strong>four digits</strong> ' +
            '(two-digit day of birth + last two digits of your phone number). Use the same code here and in the study app.</p>',
        loginTitle: 'Unlock your session',
        loginLead: 'Use the participant code you just defined. You will use it in the study app as well.',
        participantCodeLabel: 'Participant code',
        participantCodePlaceholder: 'e.g. AN0842',
        unlockButton: 'Unlock access',
        unlockChecking: 'Checking code…',
        loginCodeMissing: 'Please enter your participant code.',
        loginSuccessDual: 'Success! Choose your mode below.',
        sessionReadyDual: 'Session ready. You can move between Teach and Tell at any time.',
        loginNetworkError: 'Could not reach the server. Please check your connection and try again later.',
        sessionChipPrefix: 'Active session',
        modeSelectTitle: 'Select how you want to continue',
        modeSelectLead: 'Both modes use the same participant progress. You can switch at any time.',
        assignedBlurb: 'You are continuing in your assigned study activity.',
        assignedContinueBtn: 'Continue to your activity',
        surveyLoadError: 'Could not load the questionnaire. Please check your connection and try again.',
        surveySubmitError: 'Could not reach the server. Please try again later.',
        surveyValidationError: 'Please answer all required questions.',
        sessionClearedHint: 'Session cleared. Enter a new participant code.',
        restoringSession: 'Restoring your previous session…',
        sessionRestoredAssigned: 'Session restored. Continue to your assigned activity.',
        sessionRestoredDual: 'Session restored. Choose a mode to continue.',
        sessionExpired: 'Your previous session expired. Please enter your participant code again.'
    }
};

/* ── Core switch function (global so onclick can call it directly) ── */

function portalSwitchLang(lang) {
    var t = PORTAL_TRANSLATIONS[lang];
    if (!t) return;

    // 1. Replace textContent on [data-i18n] elements
    var textEls = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < textEls.length; i++) {
        var key = textEls[i].getAttribute('data-i18n');
        if (t[key] !== undefined) {
            textEls[i].textContent = t[key];
        }
    }

    // 2. Replace innerHTML on [data-i18n-html] elements
    var htmlEls = document.querySelectorAll('[data-i18n-html]');
    for (var j = 0; j < htmlEls.length; j++) {
        var hkey = htmlEls[j].getAttribute('data-i18n-html');
        if (t[hkey] !== undefined) {
            htmlEls[j].innerHTML = t[hkey];
        }
    }

    // 3. Show/hide consent bodies (.lang-btn uses data-lang too; scope avoids hiding switcher buttons)
    var langEls = document.querySelectorAll('.consent-body [data-lang]');
    for (var k = 0; k < langEls.length; k++) {
        if (langEls[k].getAttribute('data-lang') === lang) {
            langEls[k].removeAttribute('hidden');
        } else {
            langEls[k].setAttribute('hidden', '');
        }
    }

    // 4. Update switcher button state
    var btns = document.querySelectorAll('.lang-btn');
    for (var b = 0; b < btns.length; b++) {
        var active = btns[b].getAttribute('data-lang') === lang;
        if (active) {
            btns[b].classList.add('active');
            btns[b].setAttribute('aria-pressed', 'true');
        } else {
            btns[b].classList.remove('active');
            btns[b].setAttribute('aria-pressed', 'false');
        }
    }

    // 5. Persist choice
    try { localStorage.setItem('portalLang', lang); } catch (e) {}

    var pc = document.getElementById('participantCode');
    if (pc && t.participantCodePlaceholder) {
        pc.setAttribute('placeholder', t.participantCodePlaceholder);
    }
}

/* ── Init on load ────────────────────────────────────────────────── */

function portalI18nInit() {
    var lang = 'en';
    try { lang = localStorage.getItem('portalLang') || 'en'; } catch (e) {}
    if (!PORTAL_TRANSLATIONS[lang]) lang = 'en';
    portalSwitchLang(lang);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', portalI18nInit);
} else {
    portalI18nInit();
}
