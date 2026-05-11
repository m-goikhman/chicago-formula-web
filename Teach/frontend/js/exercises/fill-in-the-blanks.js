window.TeachFillInTheBlanks = (() => {
    function resolveButtonPolicy(section) {
        const categoryPolicies = window.TEACH_CONFIG?.TEACH_EXERCISE_BUTTON_POLICY_BY_CATEGORY || {};
        const category = String(section?.category || '').trim().toLowerCase();
        return categoryPolicies[category] || {
            check: true,
            reset: true
        };
    }

    function renderFillInTheBlanksExercise(messageEl, section, correctAnswersFromKey = null, weekId = null) {
        if (!messageEl || messageEl.querySelector('.teach-fill-blanks')) {
            return;
        }

        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) {
            return;
        }

        const messageText = contentEl.querySelector('.message-text');
        if (!messageText) {
            return;
        }

        const parseFillInAnswersConfig = (rawContent = '') => {
            const source = String(rawContent || '');
            const match = source.match(/\[answers\]\s*([\s\S]*)$/i);
            if (!match) {
                return {
                    answerSets: [],
                    cleanedContent: source.trim()
                };
            }

            const lines = match[1]
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => line !== '---');

            const answerSets = [];

            lines.forEach((line) => {
                const numbered = line.match(/^\d+\s*[-.)]?\s*(.+)$/);
                const answerText = (numbered ? numbered[1] : line).trim();
                if (!answerText) {
                    return;
                }

                const variants = answerText
                    .split(/\s*\|\|\s*/g)
                    .map((variant) => variant.trim())
                    .filter(Boolean);

                if (variants.length > 0) {
                    answerSets.push(variants);
                }
            });

            const cleanedContent = source.replace(/\n?\[answers\][\s\S]*$/i, '').trim();
            return { answerSets, cleanedContent };
        };

        const normalizeAnswer = (value) =>
            String(value || '')
                .toLowerCase()
                .replace(/[’`]/g, "'")
                .replace(/[^\p{L}\p{N}'\s-]/gu, '')
                .replace(/\s+/g, ' ')
                .trim();

        const answersConfig = parseFillInAnswersConfig(section?.content || '');
        // Determine if this is a "Choose and Write" exercise (needs clickable choices)
        const isChooseAndWrite = /choose and write/i.test(section.heading || '');
        const buttonPolicy = resolveButtonPolicy(section);

        const escapeHtml = (value = '') =>
            String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

        if (answersConfig.cleanedContent) {
            if (isChooseAndWrite && typeof window.marked?.parse === 'function') {
                messageText.innerHTML = window.marked.parse(answersConfig.cleanedContent);
            } else {
                // Keep each source line as a visual line so numbered prompts never collapse.
                messageText.innerHTML = escapeHtml(answersConfig.cleanedContent).replace(/\r?\n/g, '<br>');
            }
        }

        // Find all placeholders in text nodes (legacy underscores + new md tags).
        // We intentionally scan text nodes so placeholders inside HTML attributes are ignored.
        const placeholderPattern = /_{3,}|\[(?:small|medium|huge)_writing_space\]/gi;
        const placeholderDetector = /_{3,}|\[(?:small|medium|huge)_writing_space\]/i;
        const walker = document.createTreeWalker(
            messageText,
            NodeFilter.SHOW_TEXT,
            null
        );

        const textNodesWithPlaceholders = [];
        let node;
        while ((node = walker.nextNode())) {
            if (placeholderDetector.test(node.textContent)) {
                textNodesWithPlaceholders.push(node);
            }
        }

        // For "Choose and Write" exercises, we don't need blanks - we work with clickable choices
        // For other exercises, we need blanks to proceed
        if (!isChooseAndWrite && textNodesWithPlaceholders.length === 0) {
            return; // No blanks found, skip this renderer
        }
        
        // For "Choose and Write", check if there are any choices to make clickable
        if (isChooseAndWrite) {
            const hasChoices = /<strong>.*?\/.*?<\/strong>|<b>.*?\/.*?<\/b>/i.test(messageText.innerHTML);
            if (!hasChoices) {
                return; // No choices found, skip this renderer
            }
        }

        // Extract choices from HTML if this is a "Choose and Write" exercise
        // Look for <strong> or <b> tags containing "option1 / option2" pattern
        // Use correct answers from Answer Key if available, otherwise fall back to first option
        const choicesArray = [];
        const correctAnswers = [];
        if (isChooseAndWrite) {
            const choicePattern = /<strong>(.*?)<\/strong>|<b>(.*?)<\/b>/gi;
            const htmlContent = messageText.innerHTML;
            let match;
            let choiceIndex = 0;
            let answerKeyIndex = 0; // Index for answers from Answer Key
            
            // First, collect all choice sets to understand the structure
            const allChoices = [];
            while ((match = choicePattern.exec(htmlContent)) !== null) {
                const choiceText = (match[1] || match[2] || '').trim();
                if (choiceText.includes(' / ')) {
                    const options = choiceText.split(' / ').map(opt => opt.trim());
                    allChoices.push({ options, index: choiceIndex });
                    choiceIndex++;
                }
            }
            
            // Now process each choice set with correct answers
            // We need to handle cases where one answer in Answer Key (like "were exchanging/received")
            // corresponds to multiple choice sets in the same question
            let answerKeyIdx = 0;
            let partIndexInAnswer = 0; // Track which part of a "/" answer we're using
            let currentAnswerParts = null; // Store split parts of current answer
            
            allChoices.forEach((choiceSet, idx) => {
                const options = choiceSet.options;
                choicesArray.push(options);
                
                // Use correct answer from Answer Key if available
                if (correctAnswersFromKey && Array.isArray(correctAnswersFromKey) && answerKeyIdx < correctAnswersFromKey.length) {
                    let correctAnswer = correctAnswersFromKey[answerKeyIdx];
                    
                    // Handle cases where answer contains "/" (multiple answers for multiple choice sets in one question)
                    // For example: "were exchanging/received" means two answers for two choice sets
                    if (correctAnswer && correctAnswer.includes('/')) {
                        // Split the answer into parts if we haven't already
                        if (!currentAnswerParts) {
                            currentAnswerParts = correctAnswer.split('/').map(part => part.trim());
                            partIndexInAnswer = 0;
                        }
                        
                        // Use the current part of the split answer
                        if (partIndexInAnswer < currentAnswerParts.length) {
                            const answerPart = currentAnswerParts[partIndexInAnswer];
                            const matchingOption = options.find(opt => {
                                const optLower = opt.toLowerCase().trim();
                                const partLower = answerPart.toLowerCase().trim();
                                return optLower === partLower || 
                                       optLower.includes(partLower) || 
                                       partLower.includes(optLower);
                            });
                            correctAnswers.push(matchingOption || options[0]);
                            partIndexInAnswer++;
                            
                            // If we've used all parts, move to next answer in Answer Key
                            if (partIndexInAnswer >= currentAnswerParts.length) {
                                answerKeyIdx++;
                                currentAnswerParts = null;
                                partIndexInAnswer = 0;
                            }
                        } else {
                            // Fallback if something went wrong
                            correctAnswers.push(options[0]);
                        }
                    } else {
                        // Single answer - find matching option (case-insensitive, partial match)
                        const matchingOption = options.find(opt => {
                            const optLower = opt.toLowerCase().trim();
                            const answerLower = (correctAnswer || '').toLowerCase().trim();
                            return optLower === answerLower || 
                                   optLower.includes(answerLower) || 
                                   answerLower.includes(optLower);
                        });
                        correctAnswers.push(matchingOption || options[0]);
                        answerKeyIdx++;
                        currentAnswerParts = null;
                        partIndexInAnswer = 0;
                    }
                } else {
                    // Fallback to first option if no answer key provided
                    correctAnswers.push(options[0]);
                }
            });
        }

        const useCompactInlineBlanks =
            /fill in the gaps?|choose and write/i.test(section.heading || '');

        // Create container for interactive exercise
        const container = document.createElement('div');
        container.className = 'teach-fill-blanks';
        if (useCompactInlineBlanks) {
            container.classList.add('teach-fill-blanks-compact');
        }
        if (isChooseAndWrite) {
            container.classList.add('teach-fill-blanks-choose-write');
        }
        
        // For "Choose and Write" exercises, make choices clickable
        if (isChooseAndWrite) {
            const htmlContent = messageText.innerHTML;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlContent;
            
            // Find all choice elements and make them clickable
            const choiceElements = tempDiv.querySelectorAll('strong, b');
            let choiceIndex = 0;
            choiceElements.forEach((el) => {
                const choiceText = el.textContent.trim();
                if (choiceText.includes(' / ')) {
                    const options = choiceText.split(' / ').map(opt => opt.trim());
                    // Use correct answer from the parsed correctAnswers array
                    const correctAnswer = correctAnswers[choiceIndex] || options[0];
                    
                    // Create container for clickable choices with feedback
                    const choicesWrapper = document.createElement('span');
                    choicesWrapper.className = 'teach-choices-wrapper';
                    
                    const choicesContainer = document.createElement('span');
                    choicesContainer.className = 'teach-choices-container';
                    choicesContainer.dataset.choiceIndex = choiceIndex;
                    choicesContainer.dataset.correctAnswer = correctAnswer;
                    
                    options.forEach((option, optIndex) => {
                        const choiceButton = document.createElement('button');
                        choiceButton.type = 'button';
                        choiceButton.className = 'teach-choice-button';
                        choiceButton.textContent = option;
                        choiceButton.dataset.option = option;
                        choiceButton.dataset.choiceIndex = choiceIndex;
                        // Compare with correct answer (case-insensitive for robustness)
                        const isCorrect = option.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
                        choiceButton.dataset.isCorrect = isCorrect ? 'true' : 'false';
                        
                        if (optIndex > 0) {
                            const separator = document.createTextNode(' / ');
                            choicesContainer.appendChild(separator);
                        }
                        choicesContainer.appendChild(choiceButton);
                    });
                    
                    // Add feedback container right after choices
                    const feedback = document.createElement('span');
                    feedback.className = 'teach-choice-feedback';
                    feedback.dataset.feedbackIndex = choiceIndex;
                    
                    choicesWrapper.appendChild(choicesContainer);
                    choicesWrapper.appendChild(feedback);
                    
                    el.parentNode.replaceChild(choicesWrapper, el);
                    choiceIndex++;
                }
            });
            
            messageText.innerHTML = tempDiv.innerHTML;
        } else {
            // Replace placeholders in text nodes with input/textarea fields for non-Choose-and-Write exercises
            let blankIndex = 0;
            textNodesWithPlaceholders.forEach((textNode) => {
                const parent = textNode.parentNode;
                const text = textNode.textContent;
                const parts = text.split(placeholderPattern);
                const matches = text.match(placeholderPattern) || [];

                if (matches.length === 0) {
                    return;
                }

                const fragment = document.createDocumentFragment();
                
                parts.forEach((part, index) => {
                    if (part) {
                        fragment.appendChild(document.createTextNode(part));
                    }
                    if (index < matches.length) {
                        const rawToken = String(matches[index] || '').trim().toLowerCase();
                        const isMediumWritingSpace = rawToken === '[medium_writing_space]';
                        const isTextarea = isMediumWritingSpace;
                        const input = isTextarea
                            ? document.createElement('textarea')
                            : document.createElement('input');
                        input.id = `teach-blank-${section.id}-${blankIndex}`;
                        input.className = 'teach-blank-input';
                        input.dataset.blankIndex = blankIndex;

                        if (isTextarea) {
                            input.classList.add('teach-blank-textarea');
                            input.classList.add(
                                'teach-blank-textarea-medium'
                            );
                            input.rows = 6;
                            input.placeholder = 'Write your answer here...';
                        } else {
                            input.type = 'text';
                            input.classList.add('teach-blank-input-small');
                            input.placeholder = 'Fill in the blank';
                        }
                        blankIndex++;
                        fragment.appendChild(input);
                    }
                });

                parent.replaceChild(fragment, textNode);
            });
        }

        // Get inputs reference (will be empty for Choose-and-Write exercises)
        const inputs = messageText.querySelectorAll('.teach-blank-input');
        
        // Add feedback containers after each input (only for non-Choose-and-Write exercises)
        if (!isChooseAndWrite) {
            inputs.forEach((input, index) => {
                // Ensure blankIndex is set correctly
                if (!input.dataset.blankIndex) {
                    input.dataset.blankIndex = index;
                }
                const blankIndex = input.dataset.blankIndex;
                
                const feedback = document.createElement('span');
                feedback.className = 'teach-blank-feedback';
                feedback.dataset.feedbackIndex = blankIndex;
                // Insert feedback right after the input
                if (input.nextSibling) {
                    input.parentNode.insertBefore(feedback, input.nextSibling);
                } else {
                    input.parentNode.appendChild(feedback);
                }
            });
        }
        
        // Add action buttons
        const actions = document.createElement('div');
        actions.className = 'teach-fill-blanks-actions';

        let checkButton = null;
        let resetButton = null;
        if (buttonPolicy.check) {
            checkButton = document.createElement('button');
            checkButton.type = 'button';
            checkButton.className = 'teach-fill-blanks-button primary';
            checkButton.textContent = 'Check answers';
            actions.appendChild(checkButton);
        }

        if (buttonPolicy.reset) {
            resetButton = document.createElement('button');
            resetButton.type = 'button';
            resetButton.className = 'teach-fill-blanks-button secondary';
            resetButton.textContent = 'Reset';
            actions.appendChild(resetButton);
        }


        container.appendChild(actions);

        const result = document.createElement('div');
        result.className = 'teach-fill-blanks-result';
        container.appendChild(result);

        contentEl.appendChild(container);

        // Add click handlers for choice buttons in "Choose and Write" exercises
        // This must be done AFTER messageText.innerHTML is updated and container is added to DOM
        if (isChooseAndWrite) {
            const choiceButtons = messageText.querySelectorAll('.teach-choice-button');
            
            if (choiceButtons.length === 0) {
                console.warn('No choice buttons found for Choose and Write exercise');
            } else {
                choiceButtons.forEach((button) => {
                    button.addEventListener('click', function() {
                        const choiceIndex = parseInt(this.dataset.choiceIndex);
                        const selectedOption = this.dataset.option;
                        const isCorrect = this.dataset.isCorrect === 'true';
                        
                        // Find the feedback element for this choice set
                        const feedback = messageText.querySelector(`.teach-choice-feedback[data-feedback-index="${choiceIndex}"]`);
                        const container = this.closest('.teach-choices-container');
                        const allButtons = container?.querySelectorAll('.teach-choice-button') || [];
                        
                        // Remove previous classes from all buttons in this set
                        allButtons.forEach(btn => {
                            btn.classList.remove('correct', 'incorrect');
                        });
                        
                        // Add appropriate class to the clicked button
                        if (isCorrect) {
                            this.classList.add('correct');
                            if (feedback) {
                                feedback.textContent = '✓ Correct!';
                                feedback.classList.remove('incorrect');
                                feedback.classList.add('correct');
                            }
                        } else {
                            this.classList.add('incorrect');
                            if (feedback) {
                                const correctAnswer = container?.dataset.correctAnswer;
                                feedback.textContent = `✗ Incorrect. Correct: ${correctAnswer}`;
                                feedback.classList.remove('correct');
                                feedback.classList.add('incorrect');
                            }
                        }
                        
                        // Disable all buttons for this choice set
                        allButtons.forEach(btn => {
                            btn.disabled = true;
                            btn.classList.add('disabled');
                        });
                    });
                });
            }
        }

        // Validation logic
        function getFeedbackForInput(input) {
            const blankIndex = input.dataset.blankIndex;
            return messageText.querySelector(`.teach-blank-feedback[data-feedback-index="${blankIndex}"]`);
        }

        function clearState() {
            if (isChooseAndWrite) {
                // Clear feedback and reset buttons for "Choose and Write" exercises
                const feedbacks = messageText.querySelectorAll('.teach-choice-feedback');
                feedbacks.forEach(fb => {
                    fb.textContent = '';
                    fb.classList.remove('correct', 'incorrect');
                });
                
                const choiceButtons = messageText.querySelectorAll('.teach-choice-button');
                choiceButtons.forEach(btn => {
                    btn.disabled = false;
                    btn.classList.remove('disabled', 'correct', 'incorrect');
                });
            } else {
                // Clear inputs for other exercises
                inputs.forEach((input) => {
                    input.value = '';
                    input.classList.remove('correct', 'incorrect');
                    const feedback = getFeedbackForInput(input);
                    if (feedback) {
                        feedback.textContent = '';
                        feedback.classList.remove('correct', 'incorrect');
                    }
                    if (weekId && input.id && window.TeachState?.setExerciseDraft) {
                        window.TeachState.setExerciseDraft(weekId, input.id, '');
                    }
                });
            }
            
            result.textContent = '';
            result.classList.remove('success', 'error', 'warning');
        }

        function validate() {
            if (isChooseAndWrite) {
                // For "Choose and Write", check if all choices have been made
                const choiceContainers = messageText.querySelectorAll('.teach-choices-container');
                let allFilled = true;
                let allCorrect = true;
                
                choiceContainers.forEach((container) => {
                    const buttons = container.querySelectorAll('.teach-choice-button');
                    const hasSelection = Array.from(buttons).some(btn => 
                        btn.classList.contains('correct') || btn.classList.contains('incorrect')
                    );
                    
                    if (!hasSelection) {
                        allFilled = false;
                    } else {
                        const hasCorrect = Array.from(buttons).some(btn => btn.classList.contains('correct'));
                        if (!hasCorrect) {
                            allCorrect = false;
                        }
                    }
                });
                
                if (!allFilled) {
                    result.textContent = 'Please select an answer for each question.';
                    result.classList.remove('success', 'error');
                    result.classList.add('warning');
                } else if (allCorrect) {
                    result.textContent = 'Excellent! All answers are correct.';
                    result.classList.remove('warning', 'error');
                    result.classList.add('success');
                } else {
                    result.textContent = 'Some answers are incorrect. Review the feedback above.';
                    result.classList.remove('success', 'warning');
                    result.classList.add('error');
                }
            } else {
                // Regular validation for other exercises
                let allFilled = true;
                let hasEmpty = false;
                let allCheckedAnswersCorrect = true;

                inputs.forEach((input) => {
                    const value = input.value.trim();
                    input.classList.remove('correct', 'incorrect');
                    const feedback = getFeedbackForInput(input);
                    
                    if (feedback) {
                        feedback.textContent = '';
                        feedback.classList.remove('correct', 'incorrect');
                    }

                    if (!value) {
                        hasEmpty = true;
                        allFilled = false;
                        return;
                    }

                    const blankIndex = Number(input.dataset.blankIndex || 0);
                    const expectedVariants = answersConfig.answerSets[blankIndex] || [];

                    // If no answer is provided in the md block, keep this blank as completion-only.
                    if (expectedVariants.length === 0) {
                        input.classList.add('correct');
                        if (feedback) {
                            feedback.textContent = '✓';
                            feedback.classList.add('correct');
                        }
                        return;
                    }

                    const normalizedValue = normalizeAnswer(value);
                    const matchingVariant = expectedVariants.find(
                        (variant) => normalizeAnswer(variant) === normalizedValue
                    );

                    if (matchingVariant) {
                        input.classList.add('correct');
                        if (feedback) {
                            feedback.textContent = '✓ Correct';
                            feedback.classList.add('correct');
                        }
                    } else {
                        allCheckedAnswersCorrect = false;
                        input.classList.add('incorrect');
                        if (feedback) {
                            feedback.textContent = `✗ Correct: ${expectedVariants[0]}`;
                            feedback.classList.add('incorrect');
                        }
                    }
                });

                if (hasEmpty) {
                    result.textContent = 'Please fill in all blanks before checking.';
                    result.classList.remove('success', 'error');
                    result.classList.add('warning');
                    return;
                }

                if (allFilled) {
                    if (answersConfig.answerSets.length > 0) {
                        if (allCheckedAnswersCorrect) {
                            result.textContent = 'Excellent! All checked answers are correct.';
                            result.classList.remove('warning', 'error');
                            result.classList.add('success');
                        } else {
                            result.textContent = 'Some answers are incorrect. Review the corrections and try again.';
                            result.classList.remove('success', 'warning');
                            result.classList.add('error');
                        }
                    } else {
                        result.textContent = 'All blanks filled! Great work.';
                        result.classList.remove('warning', 'error');
                        result.classList.add('success');
                    }
                }
            }
        }

        if (checkButton) {
            checkButton.addEventListener('click', validate);
        }
        if (resetButton) {
            resetButton.addEventListener('click', clearState);
        }

        // Allow Enter key to move to next input or check (only for text inputs, not Choose-and-Write)
        if (!isChooseAndWrite && inputs.length > 0) {
            inputs.forEach((input, index) => {
                if (input.tagName === 'INPUT') {
                    input.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            const nextInput = inputs[index + 1];
                            if (nextInput) {
                                nextInput.focus();
                            } else if (buttonPolicy.check) {
                                validate();
                            }
                        }
                    });
                }
            });
        }
    }

    return {
        renderFillInTheBlanksExercise
    };
})();
