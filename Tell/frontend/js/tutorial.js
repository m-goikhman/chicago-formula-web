// Tutorial System
let tutorialStep = 0;
let tutorialSteps = [];
let tutorialResizeHandler = null;
let tutorialResumed = false; // Flag to track if tutorial is resumed manually
let tutorialStepCleanup = null; // Optional cleanup handler for custom step logic

function setupTutorialResizeHandler() {
    if (tutorialResizeHandler) {
        window.removeEventListener('resize', tutorialResizeHandler);
    }
    tutorialResizeHandler = () => {
        if (tutorialStep < tutorialSteps.length) {
            const step = tutorialSteps[tutorialStep];
            const element = document.querySelector(step.selector);
            if (element) {
                const rect = element.getBoundingClientRect();
                const padding = step.highlightPadding || 10;
                const spotlight = document.getElementById('tutorialSpotlight');
                const tooltip = document.getElementById('tutorialTooltip');
                
                if (spotlight && spotlight.classList.contains('active')) {
                    spotlight.style.left = (rect.left - padding) + 'px';
                    spotlight.style.top = (rect.top - padding) + 'px';
                    spotlight.style.width = (rect.width + padding * 2) + 'px';
                    spotlight.style.height = (rect.height + padding * 2) + 'px';
                    positionTooltip(tooltip, step.position, rect);
                }
            }
        }
    };
    window.addEventListener('resize', tutorialResizeHandler);
}

function initTutorial() {
    tutorialSteps = [
        {
            selector: '#navigationBar .nav-button:first-child',
            title: '👥 Suspects',
            text: 'Here you can open the suspects panel. Click this button to talk to individual characters privately.',
            position: 'bottom',
            highlightPadding: 10
        },
        {
            selector: '#navigationBar .nav-button:nth-child(2)',
            title: '📄 Case Materials',
            text: 'This button opens the case materials drawer where you can examine clues and evidence.',
            position: 'bottom',
            highlightPadding: 10
        },
        {
            selector: '#burgerButton',
            title: '📚 Menu',
            text: 'Click the menu button in the header to access language learning tools: adjust difficulty level, view your progress report, and get help.',
            position: 'bottom',
            highlightPadding: 10
        },
        {
            selector: '#chatArea',
            title: '💬 Chat Area',
            text: 'This is where all conversations take place. You\'ll see messages from characters and system notifications here. Highlight any unfamiliar word and click it to get its definition.',
            position: 'right',
            highlightPadding: 10,
            onShow: showChatHighlightDemo
        },
        {
            selector: '#messageInput',
            title: '✍️ Type Your Messages',
            text: 'Type your questions and messages here, then click Send or press Enter. You can chat with everyone or choose a private conversation.',
            position: 'top',
            highlightPadding: 10
        }
    ];
    setupTutorialResizeHandler();
}

function showTutorialStep(stepIndex) {
    if (typeof tutorialStepCleanup === 'function') {
        try {
            tutorialStepCleanup();
        } catch (cleanupError) {
            console.warn('Error during tutorial step cleanup:', cleanupError);
        }
        tutorialStepCleanup = null;
    }

    if (stepIndex >= tutorialSteps.length) {
        endTutorial();
        return;
    }
    
    const step = tutorialSteps[stepIndex];
    const element = document.querySelector(step.selector);
    
    if (!element) {
        // Element not found, skip to next step
        setTimeout(() => showTutorialStep(stepIndex + 1), 300);
        return;
    }
    
    // Show overlay
    const overlay = document.getElementById('tutorialOverlay');
    overlay.classList.add('active');
    
    // Get element position
    const rect = element.getBoundingClientRect();
    const padding = step.highlightPadding || 10;
    
    // Create spotlight
    const spotlight = document.getElementById('tutorialSpotlight');
    spotlight.style.left = (rect.left - padding) + 'px';
    spotlight.style.top = (rect.top - padding) + 'px';
    spotlight.style.width = (rect.width + padding * 2) + 'px';
    spotlight.style.height = (rect.height + padding * 2) + 'px';
    spotlight.style.display = 'block';
    spotlight.classList.add('active');
    
    // Create tooltip
    const tooltip = document.getElementById('tutorialTooltip');
    tooltip.innerHTML = `
        <div class="tutorial-tooltip-title">${step.title}</div>
        <div class="tutorial-tooltip-text">${step.text}</div>
        <button class="tutorial-tooltip-button" onclick="nextTutorialStep()">Got it!</button>
        <button class="tutorial-tooltip-skip" onclick="endTutorial()">Skip tutorial</button>
    `;
    tooltip.className = `tutorial-tooltip tooltip-${step.position}`;
    tooltip.style.display = 'block';
    
    // Position tooltip
    positionTooltip(tooltip, step.position, rect);
    
    if (typeof step.onShow === 'function') {
        try {
            const cleanupHandler = step.onShow(element, tooltip);
            if (typeof cleanupHandler === 'function') {
                tutorialStepCleanup = cleanupHandler;
            }
        } catch (onShowError) {
            console.warn('Error running tutorial step onShow handler:', onShowError);
        }
    }

    // Scroll element into view if needed (wait a bit for spotlight to appear)
    setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Recalculate position after scroll
        setTimeout(() => {
            const newRect = element.getBoundingClientRect();
            spotlight.style.left = (newRect.left - padding) + 'px';
            spotlight.style.top = (newRect.top - padding) + 'px';
            spotlight.style.width = (newRect.width + padding * 2) + 'px';
            spotlight.style.height = (newRect.height + padding * 2) + 'px';
            positionTooltip(tooltip, step.position, newRect);
        }, 300);
    }, 100);
    
    tutorialStep = stepIndex;
}

function positionTooltip(tooltip, position, elementRect) {
    const padding = 20;
    const tooltipRect = tooltip.getBoundingClientRect();
    
    switch(position) {
        case 'top':
            tooltip.style.left = elementRect.left + (elementRect.width / 2) - (tooltipRect.width / 2) + 'px';
            tooltip.style.top = (elementRect.top - tooltipRect.height - padding) + 'px';
            break;
        case 'bottom':
            tooltip.style.left = elementRect.left + (elementRect.width / 2) - (tooltipRect.width / 2) + 'px';
            tooltip.style.top = (elementRect.bottom + padding) + 'px';
            break;
        case 'left':
            tooltip.style.left = (elementRect.left - tooltipRect.width - padding) + 'px';
            tooltip.style.top = elementRect.top + (elementRect.height / 2) - (tooltipRect.height / 2) + 'px';
            break;
        case 'right':
            tooltip.style.left = (elementRect.right + padding) + 'px';
            tooltip.style.top = elementRect.top + (elementRect.height / 2) - (tooltipRect.height / 2) + 'px';
            break;
    }
    
    // Ensure tooltip is visible on screen
    const tooltipAfterRect = tooltip.getBoundingClientRect();
    if (tooltipAfterRect.left < 10) {
        tooltip.style.left = '10px';
    }
    if (tooltipAfterRect.right > window.innerWidth - 10) {
        tooltip.style.left = (window.innerWidth - tooltipAfterRect.width - 10) + 'px';
    }
    if (tooltipAfterRect.top < 10) {
        tooltip.style.top = '10px';
    }
    if (tooltipAfterRect.bottom > window.innerHeight - 10) {
        tooltip.style.top = (window.innerHeight - tooltipAfterRect.height - 10) + 'px';
    }
}

function nextTutorialStep() {
    showTutorialStep(tutorialStep + 1);
}

function endTutorial() {
    if (typeof tutorialStepCleanup === 'function') {
        try {
            tutorialStepCleanup();
        } catch (cleanupError) {
            console.warn('Error during tutorial cleanup:', cleanupError);
        }
        tutorialStepCleanup = null;
    }

    const overlay = document.getElementById('tutorialOverlay');
    const spotlight = document.getElementById('tutorialSpotlight');
    const tooltip = document.getElementById('tutorialTooltip');
    
    overlay.classList.remove('active');
    spotlight.style.display = 'none';
    spotlight.classList.remove('active');
    tooltip.style.display = 'none';
    
    // Mark tutorial as completed (only if called from automatic flow)
    if (!tutorialResumed) {
        localStorage.setItem(`tutorial_completed_${participantCode}`, 'true');
    }
    tutorialResumed = false; // Reset flag
}

function showTutorial() {
    // If tutorial steps are not initialized, do it now
    if (!tutorialSteps || tutorialSteps.length === 0) {
        initTutorial();
    }
    tutorialResumed = true;
    tutorialStep = 0;
    showTutorialStep(0);
}

function showChatHighlightDemo(element, tooltip) {
    if (!element || typeof addMessage !== 'function') {
        return null;
    }

    const highlightManager = window.highlightManager;
    if (!highlightManager || typeof highlightManager.highlightWordInText !== 'function') {
        return null;
    }

    const existingDemo = document.querySelector('#chatArea .message.tutorial-highlight-demo');
    if (existingDemo && existingDemo.parentNode) {
        existingDemo.parentNode.removeChild(existingDemo);
    }

    const overlay = document.getElementById('tutorialOverlay');
    const spotlight = document.getElementById('tutorialSpotlight');
    const originalOverlayPointerEvents = overlay ? overlay.style.pointerEvents : null;
    const originalOverlayBackground = overlay ? overlay.style.background : null;

    if (overlay) {
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('tutorial-overlay-light');
        if (!overlay.style.background) {
            overlay.style.background = 'rgba(0, 0, 0, 0.2)';
        }
    }

    if (spotlight) {
        spotlight.classList.add('tutorial-spotlight-light');
    }

    const demoText = 'Select any word in a message to highlight it. Try double-clicking the word "definition" below, then tap the highlight to see the explanation.';
    const demoMessage = addMessage('system', 'Learning Coach', demoText);

    if (!demoMessage) {
        return null;
    }

    demoMessage.classList.add('tutorial-highlight-demo');

    const messageText = demoMessage.querySelector('.message-text');
    const demoWord = 'definition';

    if (!messageText) {
        return function cleanupMessageOnly() {
            if (demoMessage && demoMessage.parentNode) {
                demoMessage.parentNode.removeChild(demoMessage);
            }
        };
    }

    let messageId = demoMessage.dataset.messageId;
    if (!messageId && typeof highlightManager.generateMessageId === 'function') {
        messageId = highlightManager.generateMessageId(demoText);
        demoMessage.dataset.messageId = messageId;
    }

    let createdHighlight = null;

    try {
        highlightManager.highlightWordInText(messageText, demoWord, messageId);
        createdHighlight = messageText.querySelector(`.highlight[data-word="${demoWord}"]`);
        if (createdHighlight) {
            createdHighlight.dataset.tutorialDemo = 'true';
            createdHighlight.classList.add('tutorial-highlight-demo-word');
        }
    } catch (error) {
        console.warn('Failed to create tutorial highlight demo:', error);
    }

    if (tooltip) {
        const tooltipText = tooltip.querySelector('.tutorial-tooltip-text');
        if (tooltipText) {
            const hint = document.createElement('div');
            hint.className = 'tutorial-highlight-hint';
            hint.textContent = 'Double-click or drag to select a word, then tap the new highlight to open the definition panel.';
            tooltipText.appendChild(hint);
        }
    }

    return function cleanupDemo() {
        if (overlay) {
            overlay.style.pointerEvents = originalOverlayPointerEvents || '';
            if (originalOverlayBackground) {
                overlay.style.background = originalOverlayBackground;
            } else {
                overlay.style.removeProperty('background');
            }
            overlay.classList.remove('tutorial-overlay-light');
        }

        if (spotlight) {
            spotlight.classList.remove('tutorial-spotlight-light');
        }

        if (createdHighlight && createdHighlight.parentNode) {
            const textNode = document.createTextNode(createdHighlight.textContent);
            const parent = createdHighlight.parentNode;
            parent.replaceChild(textNode, createdHighlight);
            parent.normalize();
        }

        if (demoMessage && demoMessage.parentNode) {
            demoMessage.parentNode.removeChild(demoMessage);
        }

        if (tooltip) {
            const hintEl = tooltip.querySelector('.tutorial-highlight-hint');
            if (hintEl && hintEl.parentNode) {
                hintEl.parentNode.removeChild(hintEl);
            }
        }
    };
}

// Make functions globally accessible
window.nextTutorialStep = nextTutorialStep;
window.endTutorial = endTutorial;
window.showTutorial = showTutorial;
window.initTutorial = initTutorial;
window.showTutorialStep = showTutorialStep;
window.positionTooltip = positionTooltip;
