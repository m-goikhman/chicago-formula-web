window.TeachAnswerKey = (() => {
    /**
     * Parses Answer Key from week section and returns an object with correct answers
     * @param {Object} week - week object with sections
     * @returns {Object} object with correct answers, key - exercise name, value - array of answers
     */
    function parseAnswerKey(week) {
        if (!week || !week.sections) {
            return {};
        }

        const answerKeySection = week.sections.find(section =>
            /answer.?key/i.test(section.heading || '')
        );

        if (!answerKeySection || !answerKeySection.content) {
            return {};
        }

        const answerKey = {};
        const content = answerKeySection.content;

        // Parse answers in format: **Exercise Name:** answer1, answer2, answer3
        // Or: **Exercise Name:** 1. answer1, 2. answer2, 3. answer3
        const exercisePattern = /\*\*([^*]+?):\*\*\s*([^\n]+)/g;
        let match;

        while ((match = exercisePattern.exec(content)) !== null) {
            const exerciseName = match[1].trim();
            const answersText = match[2].trim();

            // Normalize exercise name for matching
            const normalizedName = exerciseName.toLowerCase()
                .replace(/exercise\s*(\d+)/i, 'exercise $1')
                .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
                .trim();

            // Parse answers
            // Format can be: "1-d, 2-c, 3-a, 4-b" or "1. looked, 2. was trying, 3. were exchanging/received"
            const answers = [];

            // If format is "1-answer" or "1. answer"
            const numberedPattern = /(\d+)[-.)]\s*([^,\n]+?)(?=\s*,\s*\d+[-.)]|$)/g;
            let answerMatch;
            while ((answerMatch = numberedPattern.exec(answersText)) !== null) {
                const answer = answerMatch[2].trim();
                // If answer contains "/", this may be multiple answers for one question
                // For example: "were exchanging/received" means two answers for two sets of options
                // But we'll save it as is and process it when matching with options
                answers.push(answer);
            }

            // If numbered answers not found, try splitting by commas
            if (answers.length === 0) {
                const parts = answersText.split(',').map(part => part.trim()).filter(Boolean);
                answers.push(...parts);
            }

            if (answers.length > 0) {
                answerKey[normalizedName] = answers;
            }
        }

        return answerKey;
    }

    /**
     * Finds correct answers for a specific exercise by its name
     * @param {Object} answerKey - object with correct answers from parseAnswerKey
     * @param {Object} section - exercise section
     * @returns {Array|null} array of correct answers or null if not found
     */
    function getAnswersForExercise(answerKey, section) {
        if (!answerKey || !section) {
            return null;
        }

        const heading = section.heading || '';

        // Normalize exercise name for matching
        const normalizedHeading = heading.toLowerCase()
            .replace(/grammar\s*focus[^:]*:\s*/i, '')
            .replace(/exercise\s*(\d+)/i, 'exercise $1')
            .replace(/grammar\s*exercise\s*(\d+)/i, 'grammar exercise $1')
            .trim();

        // Extract exercise number if present
        const exerciseNumberMatch = normalizedHeading.match(/exercise\s*(\d+)/);
        const exerciseNumber = exerciseNumberMatch ? exerciseNumberMatch[1] : null;
        const isGrammarExercise = /grammar/i.test(normalizedHeading);

        // Try to find exact match
        for (const [key, answers] of Object.entries(answerKey)) {
            const normalizedKey = key.toLowerCase();

            // If exercise number exists, check it
            if (exerciseNumber) {
                const keyNumberMatch = normalizedKey.match(/exercise\s*(\d+)/);
                const keyNumber = keyNumberMatch ? keyNumberMatch[1] : null;

                if (keyNumber === exerciseNumber) {
                    // Check that this is the correct exercise type (grammar or regular)
                    const keyIsGrammar = /grammar/i.test(normalizedKey);
                    if (isGrammarExercise === keyIsGrammar) {
                        return answers;
                    }
                }
            }

            // Alternative method: check partial match
            if (normalizedHeading.includes(normalizedKey) || normalizedKey.includes(normalizedHeading)) {
                // For "Grammar Exercise 2" we look for "grammar exercise 2"
                if (normalizedHeading.includes('grammar exercise 2') && normalizedKey.includes('grammar exercise 2')) {
                    return answers;
                }
                if (normalizedHeading.includes('grammar exercise 1') && normalizedKey.includes('grammar exercise 1')) {
                    return answers;
                }
                if (normalizedHeading.includes('exercise 1') && normalizedKey.includes('exercise 1') && !normalizedHeading.includes('grammar')) {
                    return answers;
                }
                if (normalizedHeading.includes('exercise 3') && normalizedKey.includes('exercise 3')) {
                    return answers;
                }
            }
        }

        return null;
    }

    return {
        parseAnswerKey,
        getAnswersForExercise
    };
})();
