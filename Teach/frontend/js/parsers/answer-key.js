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

            const normalizedName = exerciseName.toLowerCase()
                .replace(/exercise\s*(\d+)/i, 'exercise $1')
                .trim();

            const answers = [];

            const numberedPattern = /(\d+)[-.)]\s*([^,\n]+?)(?=\s*,\s*\d+[-.)]|$)/g;
            let answerMatch;
            while ((answerMatch = numberedPattern.exec(answersText)) !== null) {
                const answer = answerMatch[2].trim();
                answers.push(answer);
            }

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

        const normalizedHeading = heading.toLowerCase()
            .replace(/exercise\s*(\d+)/i, 'exercise $1')
            .trim();

        const exerciseNumberMatch = normalizedHeading.match(/exercise\s*(\d+)/);
        const exerciseNumber = exerciseNumberMatch ? exerciseNumberMatch[1] : null;

        for (const [key, answers] of Object.entries(answerKey)) {
            const normalizedKey = key.toLowerCase();

            if (exerciseNumber) {
                const keyNumberMatch = normalizedKey.match(/exercise\s*(\d+)/);
                const keyNumber = keyNumberMatch ? keyNumberMatch[1] : null;

                if (keyNumber === exerciseNumber) {
                    return answers;
                }
            }

            if (normalizedHeading.includes(normalizedKey) || normalizedKey.includes(normalizedHeading)) {
                return answers;
            }
        }

        return null;
    }

    return {
        parseAnswerKey,
        getAnswersForExercise
    };
})();
