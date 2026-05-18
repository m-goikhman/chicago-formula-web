(function (global) {
    'use strict';

    function createSharedConfig() {
        const isLocalhost = Boolean(
            global.location.hostname === 'localhost' ||
            global.location.hostname === '127.0.0.1' ||
            global.location.protocol === 'file:'
        );

        let apiBaseUrl = null;

        function setApiBase(url) {
            if (!url) {
                return apiBaseUrl;
            }
            apiBaseUrl = url.replace(/\/+$/, '');
            return apiBaseUrl;
        }

        function getApiBase() {
            return apiBaseUrl;
        }

        function resolveApiBase(options = {}) {
            if (options.override) {
                return setApiBase(options.override);
            }

            const local = options.local ?? options.localApiBaseUrl;
            const production = options.production ?? options.productionApiBaseUrl;
            const fallback = options.fallback ?? options.fallbackApiBaseUrl ?? '';

            let resolved = apiBaseUrl;
            if (!resolved) {
                if (isLocalhost && local) {
                    resolved = local;
                } else if (!isLocalhost && production) {
                    resolved = production;
                } else {
                    resolved = local || production || fallback;
                }
            }

            return setApiBase(resolved);
        }

        return {
            isLocalhost,
            resolveApiBase,
            setApiBase,
            getApiBase
        };
    }

    function createApiClient(config) {
        function ensureBaseUrl() {
            const base = config.getApiBase?.();
            if (!base) {
                throw new Error('API base URL is not configured');
            }
            return base.replace(/\/+$/, '');
        }

        function normalizePath(path) {
            if (!path) {
                return '';
            }
            if (path.startsWith('http://') || path.startsWith('https://')) {
                return path;
            }
            return `/${path}`.replace(/\/{2,}/g, '/');
        }

        async function parseJsonResponse(response) {
            try {
                const text = await response.text();
                if (!text) {
                    return null;
                }
                return JSON.parse(text);
            } catch (error) {
                console.warn('Failed to parse JSON response:', error);
                return null;
            }
        }

        async function request(path, options = {}) {
            const {
                method = 'GET',
                headers = {},
                token,
                body,
                parseJson = true,
                fetchOptions = {}
            } = options;

            const baseUrl = ensureBaseUrl();
            const url = normalizePath(path);
            const fullUrl = url.startsWith('http://') || url.startsWith('https://')
                ? url
                : `${baseUrl}${url}`;

            const finalHeaders = new Headers(headers);
            if (token) {
                finalHeaders.set('Authorization', `Bearer ${token}`);
            }

            const fetchConfig = Object.assign({}, fetchOptions, {
                method,
                headers: finalHeaders
            });

            if (body !== undefined && body !== null) {
                fetchConfig.body = body;
            }

            const response = await fetch(fullUrl, fetchConfig);
            const data = parseJson ? await parseJsonResponse(response) : null;

            return { response, data };
        }

        function get(path, options = {}) {
            return request(path, Object.assign({}, options, { method: 'GET' }));
        }

        function postJson(path, payload = {}, options = {}) {
            const headers = Object.assign({}, options.headers, {
                'Content-Type': 'application/json'
            });

            return request(path, Object.assign({}, options, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload ?? {})
            }));
        }

        return {
            request,
            get,
            postJson
        };
    }

    const sharedConfig = createSharedConfig();

    const API_URL = sharedConfig.resolveApiBase({
        local: 'http://localhost:8000',
        production: 'https://teach-tell-backend-801526931549.europe-west4.run.app',
        fallback: 'http://localhost:8000'
    });

    const apiClient = createApiClient(sharedConfig);
    global.API_URL = API_URL;
    global.portalConfig = sharedConfig;

    const DEFAULT_DESTINATIONS = {
        teach: '../../Teach/frontend/index.html',
        tell: '../../Tell/frontend/index.html'
    };

    const destinationsOverride = global.portalDestinations || {};

    function resolveDestination(mode) {
        const isLocal = sharedConfig.isLocalhost;
        const overrideKey = isLocal ? `${mode}Local` : `${mode}Production`;
        const override = destinationsOverride[overrideKey];
        if (override) {
            return override;
        }

        if (!isLocal) {
            const localFallback = destinationsOverride[`${mode}Local`];
            if (localFallback) {
                return localFallback;
            }
        }

        return DEFAULT_DESTINATIONS[mode];
    }

    const CONSENT_STORAGE_KEY = 'portalConsentGiven';
    const STORAGE_STUDY_ARM = 'portalStudyArm';
    const SESSION_ONBOARDING_TOKEN = 'portalOnboardingToken';

    function isStudyFlowEnabled() {
        const params = new URLSearchParams(global.location.search || '');
        if (params.get('dev') === '1') {
            return false;
        }
        return !sharedConfig.isLocalhost;
    }

    const consentView = document.getElementById('consentView');
    const surveyView = document.getElementById('surveyView');
    const surveyForm = document.getElementById('surveyForm');
    const surveyError = document.getElementById('surveyError');
    const loginView = document.getElementById('loginView');
    const modeSelectView = document.getElementById('modeSelectView');
    const modeGridDual = document.getElementById('modeGridDual');
    const modeAssignedWrap = document.getElementById('modeAssignedWrap');
    const assignedContinueBtn = document.getElementById('assignedContinueBtn');
    const studyCodeInstructions = document.getElementById('studyCodeInstructions');
    const participantInput = document.getElementById('participantCode');
    const consentToggle1 = document.getElementById('consentToggle1');
    const consentToggle2 = document.getElementById('consentToggle2');
    const consentExpandable1 = document.getElementById('consentExpandable1');
    const consentExpandable2 = document.getElementById('consentExpandable2');
    const consentBody1 = document.getElementById('consentBody1');
    const consentBody2 = document.getElementById('consentBody2');
    const consentCheck1 = document.getElementById('consentCheck1');
    const consentCheck2 = document.getElementById('consentCheck2');
    const consentContinueButton = document.getElementById('consentContinueButton');
    const loginButton = document.getElementById('loginButton');
    const loginError = document.getElementById('loginError');
    const loginStatus = document.getElementById('loginStatus');
    const sessionCodeEl = document.getElementById('sessionCode');
    const modeStatus = document.getElementById('modeStatus');
    const switchCodeButton = document.getElementById('switchCodeButton');
    const enterTeachButton = document.querySelector('[data-action="enter-teach"]');
    const enterTellButton = document.querySelector('[data-action="enter-tell"]');

    let cachedQuestionnaire = null;

    function getUnlockButtonLabel() {
        const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('portalLang')) || 'en';
        if (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]) {
            return PORTAL_TRANSLATIONS[lang].unlockButton || 'Unlock access';
        }
        return 'Unlock access';
    }

    function getCheckingLabel() {
        const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('portalLang')) || 'en';
        if (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]) {
            return PORTAL_TRANSLATIONS[lang].unlockChecking || 'Checking code…';
        }
        return 'Checking code…';
    }

    function setLoading(isLoading) {
        if (isLoading) {
            loginButton.classList.add('loading');
            loginButton.disabled = true;
            loginButton.textContent = getCheckingLabel();
        } else {
            loginButton.classList.remove('loading');
            loginButton.disabled = false;
            loginButton.textContent = getUnlockButtonLabel();
        }
    }

    function clearMessages() {
        loginError.textContent = '';
        loginStatus.textContent = '';
        modeStatus.textContent = '';
    }

    function persistSession(token, participantCode) {
        if (!token || !participantCode) {
            return;
        }
        localStorage.setItem('sessionToken', token);
        localStorage.setItem('participantCode', participantCode);
    }

    function clearStoredSession() {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('participantCode');
    }

    function storeStudyArm(arm) {
        if (arm) {
            localStorage.setItem(STORAGE_STUDY_ARM, arm);
        }
    }

    function getPortalLang() {
        return localStorage.getItem('portalLang') || 'en';
    }

    function t(key) {
        const lang = getPortalLang();
        if (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang] && PORTAL_TRANSLATIONS[lang][key]) {
            return PORTAL_TRANSLATIONS[lang][key];
        }
        return null;
    }

    function clearPendingOnboarding() {
        sessionStorage.removeItem(SESSION_ONBOARDING_TOKEN);
        localStorage.removeItem(STORAGE_STUDY_ARM);
    }

    function resetSurveyForm() {
        cachedQuestionnaire = null;
        if (surveyForm) {
            surveyForm.innerHTML = '';
        }
    }

    async function attachPendingOnboarding(authToken) {
        const onboardingToken = sessionStorage.getItem(SESSION_ONBOARDING_TOKEN);
        if (!onboardingToken) {
            return;
        }
        try {
            await apiClient.postJson(
                '/api/study/onboarding/attach',
                { onboarding_token: onboardingToken },
                { token: authToken }
            );
        } catch (e) {
            console.warn('[Portal] onboarding attach failed:', e);
        }
        sessionStorage.removeItem(SESSION_ONBOARDING_TOKEN);
    }

    function resolveStudyArm(serverArm) {
        return serverArm || localStorage.getItem(STORAGE_STUDY_ARM) || null;
    }

    function hasPendingOnboarding() {
        return Boolean(
            sessionStorage.getItem(SESSION_ONBOARDING_TOKEN) && localStorage.getItem(STORAGE_STUDY_ARM)
        );
    }

    function requireSurveyBeforeCode() {
        clearStoredSession();
        clearPendingOnboarding();
        resetSurveyForm();
        const lang = getPortalLang();
        if (loginError) {
            loginError.textContent = t('loginRequiresSurvey') || 'Please complete the questionnaire before entering a participant code.';
        }
        showSurveyView();
    }

    function getStoredSession() {
        const token = localStorage.getItem('sessionToken');
        const code = localStorage.getItem('participantCode');
        if (!token || !code) {
            return null;
        }
        return { token, code };
    }

    function hasConsentGiven() {
        return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
    }

    function setConsentGiven() {
        localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    }

    function clearConsentGiven() {
        localStorage.removeItem(CONSENT_STORAGE_KEY);
    }

    function resetConsentUI() {
        if (consentCheck1) {
            consentCheck1.checked = false;
        }
        if (consentCheck2) {
            consentCheck2.checked = false;
        }
        closeExpandable(consentToggle1, consentExpandable1);
        closeExpandable(consentToggle2, consentExpandable2);
        updateConsentContinueButton();
    }

    function showConsentView() {
        clearMessages();
        hideAllMainSections();
        if (consentView) {
            consentView.classList.remove('hidden');
        }
        resetConsentUI();
        const lang = getPortalLang();
        if (typeof portalSwitchLang === 'function') {
            portalSwitchLang(lang);
        }
        if (consentToggle1) {
            consentToggle1.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function hideAllMainSections() {
        [consentView, surveyView, loginView, modeSelectView].forEach((el) => {
            if (!el) {
                return;
            }
            el.classList.add('hidden');
            if (el === modeSelectView) {
                el.classList.remove('active');
            }
        });
    }

    function hideConsentOnly() {
        if (consentView) {
            consentView.classList.add('hidden');
        }
    }

    function showLoginDev() {
        hideAllMainSections();
        if (studyCodeInstructions) {
            studyCodeInstructions.classList.add('hidden');
        }
        loginView.classList.remove('hidden');
    }

    function showLoginAfterSurvey() {
        hideAllMainSections();
        if (studyCodeInstructions) {
            studyCodeInstructions.classList.remove('hidden');
        }
        loginView.classList.remove('hidden');
        const lang = localStorage.getItem('portalLang') || 'en';
        if (typeof portalSwitchLang === 'function') {
            portalSwitchLang(lang);
        }
        if (participantInput) {
            participantInput.focus();
        }
    }

    function renderQuestionField(q) {
        const wrap = document.createElement('fieldset');
        wrap.className = 'survey-fieldset';
        wrap.dataset.questionId = q.question_id;

        const leg = document.createElement('legend');
        leg.className = 'survey-legend';
        leg.textContent = q.text_en;
        wrap.appendChild(leg);

        if (q.type === 'single_select') {
            (q.options_en || []).forEach((label, idx) => {
                const row = document.createElement('label');
                row.className = 'survey-option';
                const inp = document.createElement('input');
                inp.type = 'radio';
                inp.name = q.question_id;
                inp.value = String(idx);
                if (q.required) {
                    inp.required = true;
                }
                const span = document.createElement('span');
                span.className = 'survey-option-text';
                span.textContent = label;
                row.appendChild(inp);
                row.appendChild(span);
                wrap.appendChild(row);
            });
        } else if (q.type === 'multi_select') {
            (q.options_en || []).forEach((label, idx) => {
                const row = document.createElement('label');
                row.className = 'survey-option';
                const inp = document.createElement('input');
                inp.type = 'checkbox';
                inp.name = q.question_id;
                inp.value = String(idx);
                const span = document.createElement('span');
                span.className = 'survey-option-text';
                span.textContent = label;
                row.appendChild(inp);
                row.appendChild(span);
                wrap.appendChild(row);
            });
        } else if (q.type === 'open_text') {
            const ta = document.createElement('textarea');
            ta.className = 'survey-textarea';
            ta.name = q.question_id;
            ta.rows = 3;
            if (q.required) {
                ta.required = true;
            }
            wrap.appendChild(ta);
        }

        return wrap;
    }

    async function ensureQuestionnaire() {
        if (cachedQuestionnaire) {
            return cachedQuestionnaire;
        }
        const { response, data } = await apiClient.get('/api/study/questionnaire');
        if (!response.ok) {
            throw new Error((data && (data.detail || data.message)) || 'Could not load questionnaire');
        }
        cachedQuestionnaire = data.questions || [];
        return cachedQuestionnaire;
    }

    async function loadAndRenderSurvey() {
        surveyError.textContent = '';
        const questions = await ensureQuestionnaire();
        surveyForm.innerHTML = '';
        questions.forEach((q) => {
            surveyForm.appendChild(renderQuestionField(q));
        });
    }

    function showSurveyView() {
        clearMessages();
        hideAllMainSections();
        surveyView.classList.remove('hidden');
        surveyError.textContent = '';
        loadAndRenderSurvey().catch((err) => {
            console.error('[Portal] Survey load failed:', err);
            surveyError.textContent =
                (typeof PORTAL_TRANSLATIONS !== 'undefined' &&
                    PORTAL_TRANSLATIONS[localStorage.getItem('portalLang') || 'en']?.surveyLoadError) ||
                'Could not load the questionnaire. Please check your connection and try again.';
        });
    }

    function collectSurveyAnswers() {
        const questions = cachedQuestionnaire;
        if (!questions) {
            return null;
        }
        const answers = {};
        for (let i = 0; i < questions.length; i += 1) {
            const q = questions[i];
            if (q.type === 'single_select') {
                const sel = surveyForm.querySelector(`input[name="${q.question_id}"]:checked`);
                if (!sel) {
                    return null;
                }
                answers[q.question_id] = parseInt(sel.value, 10);
            } else if (q.type === 'multi_select') {
                const sels = surveyForm.querySelectorAll(`input[name="${q.question_id}"]:checked`);
                if (q.required && sels.length === 0) {
                    return null;
                }
                answers[q.question_id] = Array.from(sels).map((el) => parseInt(el.value, 10));
            } else if (q.type === 'open_text') {
                const ta = surveyForm.querySelector(`textarea[name="${q.question_id}"]`);
                const v = (ta && ta.value.trim()) || '';
                if (q.required && !v) {
                    return null;
                }
                answers[q.question_id] = v;
            }
        }
        return answers;
    }

    async function handleSurveySubmit(event) {
        event.preventDefault();
        surveyError.textContent = '';
        const answers = collectSurveyAnswers();
        if (!answers) {
            const lang = localStorage.getItem('portalLang') || 'en';
            const msg =
                (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]?.surveyValidationError) ||
                'Please answer all required questions.';
            surveyError.textContent = msg;
            return;
        }

        const submitBtn = document.getElementById('surveySubmitButton');
        if (submitBtn) {
            submitBtn.disabled = true;
        }
        try {
            const { response, data } = await apiClient.postJson('/api/study/onboarding', { answers });
            if (!response.ok) {
                const detail =
                    (data && (data.detail || data.error || data.message)) ||
                    'Submission failed. Please check your answers.';
                surveyError.textContent = detail;
                return;
            }
            sessionStorage.setItem(SESSION_ONBOARDING_TOKEN, data.onboarding_token);
            localStorage.setItem(STORAGE_STUDY_ARM, data.arm);
            showLoginAfterSurvey();
        } catch (err) {
            console.error('[Portal] Onboarding submit failed:', err);
            const lang = localStorage.getItem('portalLang') || 'en';
            surveyError.textContent =
                (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]?.surveySubmitError) ||
                'Could not reach the server. Please try again later.';
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
            }
        }
    }

    function updateConsentContinueButton() {
        if (!consentContinueButton) {
            return;
        }
        const bothChecked = consentCheck1 && consentCheck1.checked && consentCheck2 && consentCheck2.checked;
        consentContinueButton.disabled = !bothChecked;
    }

    function showModeSelect(participantCode, options = {}) {
        sessionCodeEl.textContent = participantCode ?? '—';
        if (consentView) {
            consentView.classList.add('hidden');
        }
        if (surveyView) {
            surveyView.classList.add('hidden');
        }
        loginView.classList.add('hidden');
        modeSelectView.classList.add('active');
        if (modeGridDual) {
            modeGridDual.classList.remove('hidden');
        }
        if (modeAssignedWrap) {
            modeAssignedWrap.classList.add('hidden');
        }
        if (options.showStatus) {
            modeStatus.textContent = options.showStatus;
        } else {
            modeStatus.textContent = '';
        }
    }

    function showModeSelectAssigned(participantCode, arm, options = {}) {
        sessionCodeEl.textContent = participantCode ?? '—';
        if (consentView) {
            consentView.classList.add('hidden');
        }
        if (surveyView) {
            surveyView.classList.add('hidden');
        }
        loginView.classList.add('hidden');
        modeSelectView.classList.add('active');
        if (modeGridDual) {
            modeGridDual.classList.add('hidden');
        }
        if (modeAssignedWrap) {
            modeAssignedWrap.classList.remove('hidden');
        }
        if (assignedContinueBtn) {
            assignedContinueBtn.onclick = () => navigateTo(arm);
        }
        if (options.showStatus) {
            modeStatus.textContent = options.showStatus;
        } else {
            modeStatus.textContent = '';
        }
        const lang = localStorage.getItem('portalLang') || 'en';
        if (typeof portalSwitchLang === 'function') {
            portalSwitchLang(lang);
        }
    }

    function showLoginView() {
        hideAllMainSections();
        if (studyCodeInstructions) {
            studyCodeInstructions.classList.add('hidden');
        }
        loginView.classList.remove('hidden');
        modeSelectView.classList.remove('active');
        clearMessages();
        const lang = localStorage.getItem('portalLang') || 'en';
        loginStatus.textContent =
            (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]?.sessionClearedHint) ||
            'Session cleared. Enter a new participant code.';
        if (typeof portalSwitchLang === 'function') {
            portalSwitchLang(lang);
        }
    }

    async function handleLogin() {
        const rawCode = participantInput.value.trim();
        if (!rawCode) {
            loginError.textContent = t('loginCodeMissing') || 'Please enter the participant code provided to you.';
            return;
        }

        const normalizedCode = rawCode.toUpperCase();
        clearMessages();
        setLoading(true);

        try {
            const { response, data } = await apiClient.postJson('/api/auth/login', {
                participant_code: normalizedCode
            });

            if (!response.ok) {
                const detail =
                    (data && (data.detail || data.error || data.message)) ||
                    'Login failed. Please check your code.';
                loginError.textContent = detail;
                return;
            }

            const token = data?.token;
            const participantCode = (data?.participant_code || normalizedCode).toUpperCase();
            participantInput.value = '';

            if (isStudyFlowEnabled()) {
                const serverArm = data?.study_arm;
                const pendingArm = localStorage.getItem(STORAGE_STUDY_ARM);

                if (!serverArm && !hasPendingOnboarding()) {
                    requireSurveyBeforeCode();
                    return;
                }

                persistSession(token, participantCode);
                storeStudyArm(serverArm || pendingArm);

                if (serverArm) {
                    sessionStorage.removeItem(SESSION_ONBOARDING_TOKEN);
                } else if (hasPendingOnboarding()) {
                    await attachPendingOnboarding(token);
                }

                navigateTo(localStorage.getItem(STORAGE_STUDY_ARM));
                return;
            }

            persistSession(token, participantCode);
            loginStatus.textContent = t('loginSuccessDual') || 'Success! Choose your mode below.';
            showModeSelect(participantCode, {
                showStatus: t('sessionReadyDual') || 'Session ready. You can move between Teach and Tell at any time.'
            });
        } catch (error) {
            console.error('[Portal] Login failed:', error);
            loginError.textContent =
                t('loginNetworkError') ||
                'Could not reach the server. Please check your connection or try again later.';
        } finally {
            setLoading(false);
        }
    }

    async function tryRestoreSession() {
        const stored = getStoredSession();
        if (!stored) {
            return false;
        }

        clearMessages();
        const lang = localStorage.getItem('portalLang') || 'en';
        loginStatus.textContent =
            (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]?.restoringSession) ||
            'Restoring your previous session…';

        try {
            const { response, data } = await apiClient.get('/api/auth/session', {
                token: stored.token
            });

            if (!response.ok) {
                throw new Error((data && (data.detail || data.error || data.message)) || 'Session invalid');
            }

            const participantCode = (data && data.participant_code) || stored.code;
            const studyArm = resolveStudyArm(data && data.study_arm);

            if (isStudyFlowEnabled()) {
                if (!studyArm) {
                    clearStoredSession();
                    showLoginAfterSurvey();
                    loginStatus.textContent =
                        t('sessionExpired') ||
                        'Your previous session expired. Please enter your participant code again.';
                    return false;
                }
                persistSession(stored.token, participantCode);
                storeStudyArm(studyArm);
                showModeSelectAssigned(participantCode, studyArm, {
                    showStatus:
                        t('sessionRestoredAssigned') ||
                        'Session restored. Continue to your assigned activity.'
                });
                return true;
            }

            persistSession(stored.token, participantCode);
            showModeSelect(participantCode, {
                showStatus:
                    t('sessionRestoredDual') || 'Session restored. Choose a mode to continue.'
            });
            return true;
        } catch (error) {
            console.warn('[Portal] Stored session is no longer valid:', error);
            clearStoredSession();
            loginStatus.textContent =
                (typeof PORTAL_TRANSLATIONS !== 'undefined' && PORTAL_TRANSLATIONS[lang]?.sessionExpired) ||
                'Your previous session expired. Please enter your participant code again.';
            return false;
        }
    }

    function navigateTo(mode) {
        const destination = resolveDestination(mode);
        if (!destination) {
            modeStatus.textContent = `Destination for ${mode} mode is not configured.`;
            return;
        }
        window.location.assign(destination);
    }

    function closeExpandable(toggle, expandable) {
        if (!expandable) return;
        expandable.classList.remove('is-open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function setupConsentToggles() {
        function handleToggle(toggle, expandable) {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            expandable.classList.toggle('is-open', !expanded);
            toggle.setAttribute('aria-expanded', !expanded);
            if (!expanded) {
                requestAnimationFrame(() => {
                    toggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
        }
        if (consentToggle1 && consentExpandable1) {
            consentToggle1.addEventListener('click', () => handleToggle(consentToggle1, consentExpandable1));
        }
        if (consentToggle2 && consentExpandable2) {
            consentToggle2.addEventListener('click', () => handleToggle(consentToggle2, consentExpandable2));
        }
        consentExpandable1?.querySelector('.consent-close')?.addEventListener('click', () => closeExpandable(consentToggle1, consentExpandable1));
        consentExpandable2?.querySelector('.consent-close')?.addEventListener('click', () => closeExpandable(consentToggle2, consentExpandable2));
    }

    function setupConsentCheckboxes() {
        const update = updateConsentContinueButton;
        if (consentCheck1) {
            consentCheck1.addEventListener('change', () => {
                update();
                if (consentCheck1.checked) closeExpandable(consentToggle1, consentExpandable1);
            });
        }
        if (consentCheck2) {
            consentCheck2.addEventListener('change', () => {
                update();
                if (consentCheck2.checked) closeExpandable(consentToggle2, consentExpandable2);
            });
        }
    }

    function handleConsentContinue() {
        setConsentGiven();
        hideConsentOnly();
        if (isStudyFlowEnabled()) {
            showSurveyView();
        } else {
            showLoginDev();
            if (participantInput) {
                participantInput.focus();
            }
        }
    }

    loginButton.addEventListener('click', handleLogin);

    if (consentContinueButton) {
        consentContinueButton.addEventListener('click', handleConsentContinue);
    }
    setupConsentToggles();
    setupConsentCheckboxes();

    if (surveyForm) {
        surveyForm.addEventListener('submit', handleSurveySubmit);
    }

    participantInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });

    enterTeachButton.addEventListener('click', () => navigateTo('teach'));
    enterTellButton.addEventListener('click', () => navigateTo('tell'));

    switchCodeButton.addEventListener('click', () => {
        clearStoredSession();
        clearPendingOnboarding();
        resetSurveyForm();
        if (isStudyFlowEnabled()) {
            clearConsentGiven();
            showConsentView();
        } else {
            showLoginView();
            if (participantInput) {
                participantInput.focus();
            }
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const lang = localStorage.getItem('portalLang') || 'en';
        if (typeof portalSwitchLang === 'function') {
            portalSwitchLang(lang);
        }
        if (hasConsentGiven()) {
            hideConsentOnly();
            if (!isStudyFlowEnabled()) {
                showLoginDev();
                tryRestoreSession().then((restored) => {
                    if (!restored && participantInput) {
                        participantInput.focus();
                    }
                });
            } else {
                tryRestoreSession().then((restored) => {
                    if (restored) {
                        return;
                    }
                    clearMessages();
                    showLoginAfterSurvey();
                });
            }
        }
    });
})(window);
