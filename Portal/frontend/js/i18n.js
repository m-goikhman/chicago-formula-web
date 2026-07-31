/* ── Portal i18n ─────────────────────────────────────────────────────
   Two-language support (IT / EN).
   Long consent-body HTML lives directly in portal.html as
   <div data-lang="it"> / <div data-lang="en" hidden> sibling blocks.
   Everything else is swapped via data-i18n / data-i18n-html attributes.
──────────────────────────────────────────────────────────────────── */

var PORTAL_TRANSLATIONS = {
    it: {
        pageTitle: 'English Writing Confidence Experiment · Portale partecipanti',
        portalMeta: 'APPROVAZIONE COMITATO ETICO · UNIVERSITÀ DI TRENTO PROT. 2025-065',
        headerTitle: 'Impara l\'inglese con un detective AI',

        introHow:
            '<h2 class="intro-heading">Come funziona</h2>' +
            '<p>Questo progetto di ricerca esplora diversi modi di imparare l’inglese attraverso storie investigative.' +
            ' Sarai assegnato a uno di due gruppi: uno lavora con un chatbot AI interattivo,' +
            ' l’altro con attività di lettura e scrittura.' +
            ' Entrambi i gruppi seguono la stessa storia.</p>' +
            '<p>Due episodi a settimana, 2 settimane, circa 40–60 minuti ciascuno.' +
            ' Tutto online — telefono o computer.</p>',

        introWho:
            '<h2 class="intro-heading">Chi può partecipare</h2>' +
            '<p>Adulti (18+) con inglese intermedio (B1–B2).' +
            ' Puoi leggere e scrivere in inglese, anche se non sempre è facile.</p>' +
            '<ul class="intro-highlights">' +
            '<li>2 settimane, 2 episodi/settimana, circa 40–60 min ciascuno</li>' +
            '<li>Tutto online — telefono o computer</li>' +
            '<li>280 SONA Time Credits per studenti UniTn</li>' +
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
            'Rispondi alle domande obbligatorie (contrassegnate con *). Per lettura, parlato e scrittura ci sono due affermazioni ciascuna: seleziona tutte quelle che ti descrivono.',
        surveySubmit: 'Invia e continua',
        studyCodeInstructions:
            '<p><strong>Codice partecipante.</strong> Crealo tu: <strong>due lettere</strong> (prime lettere del tuo nome) seguite da <strong>quattro cifre</strong> ' +
            '(giorno di nascita a due cifre + ultime due cifre del tuo numero di telefono).</p>',
        loginTitle: 'Il tuo codice partecipante',
        loginLead:
            'Crea il tuo codice partecipante qui sotto. Userai lo stesso codice per tutto lo studio.',
        participantCodeLabel: 'Codice partecipante',
        participantCodePlaceholder: 'es. AN0842',
        unlockButton: 'Continua',
        unlockChecking: 'Verifica codice…',
        loginCodeMissing: 'Inserisci il tuo codice partecipante.',
        loginRequiresSurvey:
            'Completa prima il questionario. Ogni codice partecipante deve essere collegato a un profilo linguistico.',
        loginNetworkError: 'Impossibile contattare il server. Controlla la connessione e riprova.',
        sessionChipPrefix: 'Sessione attiva',
        assignedBlurb: 'Continui con l’attività assegnata per lo studio.',
        assignedContinueBtn: 'Vai all’attività',
        surveyLoadError: 'Impossibile caricare il questionario. Controlla la connessione.',
        surveySubmitError: 'Impossibile contattare il server. Riprova tra poco.',
        surveyValidationError: 'Rispondi a tutte le domande obbligatorie.',
        mearaTitle: 'Verifica del vocabolario',
        mearaLead:
            'Vedrai parole in inglese, una alla volta. Per ogni parola indica se la conosci o no. Non ci sono risposte giuste o sbagliate sullo schermo: rispondi con sincerità.',
        mearaProgress: 'Parola {current} di {total}',
        mearaKnowBtn: 'Conosco questa parola',
        mearaDontKnowBtn: 'Non conosco questa parola',
        mearaLoadError: 'Impossibile caricare il test di vocabolario. Controlla la connessione.',
        mearaRequiresSurvey: 'Completa prima il questionario iniziale.',
        mearaRequiresCompletion: 'Completa prima il test di vocabolario.',
        mearaPosttestTitle: 'Verifica finale del vocabolario',
        mearaPosttestLead:
            'Come all’inizio dello studio, vedrai parole in inglese una alla volta. Indica se le conosci o no — rispondi con sincerità.',
        finalFormsTitle: 'Questionari finali',
        finalFormsLead:
            'Completa entrambi i questionari qui sotto. Si aprono in Google Forms.',
        finalFormsWeeklyBtn: 'Questionario settimanale (3–5 min)',
        finalFormsFinalBtn: 'Questionario finale (circa 10 min)',
        finalFormsThanks: 'Grazie per aver partecipato a questo studio!',
        finalFormsLoadError: 'Impossibile caricare i link dei questionari. Controlla la connessione.',
        sessionClearedHint: 'Sessione azzerata. Inserisci un nuovo codice partecipante.',
        restoringSession: 'Ripristino sessione…',
        sessionRestoredAssigned: 'Sessione ripristinata. Continua con l’attività assegnata.',
        sessionExpired: 'Sessione scaduta. Inserisci di nuovo il codice partecipante.'
    },

    en: {
        pageTitle: 'Writing Confidence Experiment · Participant Portal',
        portalMeta: 'ETHICS APPROVAL · UNIVERSITY OF TRENTO PROT. 2025-065',
        headerTitle: 'Try an AI detective for English learning',

        introHow:
            '<h2 class="intro-heading">How it works</h2>' +
            '<p>This research project explores different ways of learning English through detective stories.' +
            ' You will be assigned to one of two groups: one works with an interactive AI chatbot,' +
            ' the other with reading and writing activities.' +
            ' Both groups follow the same story and the same mystery.</p>' +
            '<p>Two episodes per week, 2 weeks, approximately 40–60 minutes each.' +
            ' All online — phone or computer.</p>',

        introWho:
            '<h2 class="intro-heading">Who can join</h2>' +
            '<p>Adults (18+) with intermediate English (B1–B2).' +
            ' You can read and write in English, even if it is not always easy.</p>' +
            '<ul class="intro-highlights">' +
            '<li>2 weeks, 2 episodes/week, approx. 40–60 min each</li>' +
            '<li>All online — phone or computer</li>' +
            '<li>280 SONA Time Credits for UniTn students</li>' +
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
            'Please answer all required questions (marked with *). For Reading, Speaking, and Writing there are two statements each: select all that apply to you.',
        surveySubmit: 'Submit and continue',
        studyCodeInstructions:
            '<p><strong>Participant code.</strong> Create it yourself: <strong>two letters</strong> (first letters of your first name) followed by <strong>four digits</strong> ' +
            '(two-digit day of birth + last two digits of your phone number).</p>',
        loginTitle: 'Your participant code',
        loginLead: 'Create your participant code below. You will use the same code throughout the study.',
        participantCodeLabel: 'Participant code',
        participantCodePlaceholder: 'e.g. AN0842',
        unlockButton: 'Continue',
        unlockChecking: 'Checking code…',
        loginCodeMissing: 'Please enter your participant code.',
        loginRequiresSurvey:
            'Please complete the questionnaire first. Every participant code must be linked to a language profile.',
        loginNetworkError: 'Could not reach the server. Please check your connection and try again later.',
        sessionChipPrefix: 'Active session',
        assignedBlurb: 'You are continuing in your assigned study activity.',
        assignedContinueBtn: 'Continue to your activity',
        surveyLoadError: 'Could not load the questionnaire. Please check your connection and try again.',
        surveySubmitError: 'Could not reach the server. Please try again later.',
        surveyValidationError: 'Please answer all required questions.',
        mearaTitle: 'Vocabulary check',
        mearaLead:
            'You will see English words one at a time. For each word, decide whether you know it or not. There are no right or wrong answers on screen — just answer honestly.',
        mearaProgress: 'Word {current} of {total}',
        mearaKnowBtn: 'I know this word',
        mearaDontKnowBtn: "I don't know this word",
        mearaLoadError: 'Could not load the vocabulary test. Please check your connection.',
        mearaRequiresSurvey: 'Please complete the initial questionnaire first.',
        mearaRequiresCompletion: 'Please complete the vocabulary check first.',
        mearaPosttestTitle: 'Final vocabulary check',
        mearaPosttestLead:
            'Just like at the start of the study, you will see English words one at a time. Decide whether you know each one — answer honestly.',
        finalFormsTitle: 'Final questionnaires',
        finalFormsLead:
            'Please complete both questionnaires below. They open in Google Forms.',
        finalFormsWeeklyBtn: 'Weekly questionnaire (3–5 min)',
        finalFormsFinalBtn: 'Final questionnaire (about 10 min)',
        finalFormsThanks: 'Thank you for taking part in this study!',
        finalFormsLoadError: 'Could not load the questionnaire links. Please check your connection.',
        sessionClearedHint: 'Session cleared. Enter a new participant code.',
        restoringSession: 'Restoring your previous session…',
        sessionRestoredAssigned: 'Session restored. Continue to your assigned activity.',
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

    // 5. Page title and document language
    if (t.pageTitle) {
        document.title = t.pageTitle;
    }
    document.documentElement.lang = lang;

    // 6. Persist choice
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
