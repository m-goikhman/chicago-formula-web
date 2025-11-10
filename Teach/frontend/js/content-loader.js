const TeachContentLoader = (() => {
    const { TEACH_WEEKS, TEACH_CONTENT_SETTINGS } = window.TEACH_CONFIG;

    function slugify(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
    }

    function classifyHeading(heading, settings) {
        const normalized = heading.toLowerCase();
        const taskMatch = settings.taskHeadingPatterns.some((pattern) => normalized.includes(pattern));
        const readingMatch = settings.readingHeadingPatterns.some((pattern) => normalized.includes(pattern));

        if (readingMatch) {
            return { type: 'reading', category: 'reading' };
        }

        if (taskMatch) {
            if (normalized.includes('vocabulary')) {
                return { type: 'task', category: 'vocabulary' };
            }
            if (normalized.includes('grammar')) {
                return { type: 'task', category: 'grammar' };
            }
            if (normalized.includes('writing')) {
                return { type: 'task', category: 'writing' };
            }
            if (normalized.includes('question')) {
                return { type: 'task', category: 'questions' };
            }
            return { type: 'task', category: 'exercise' };
        }

        return { type: 'info', category: 'info' };
    }

    function extractSummary(section, sentenceLimit = 2) {
        if (!section || !section.content) {
            return '';
        }
        const text = section.content.replace(/\n+/g, ' ').trim();
        const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        return sentences.slice(0, sentenceLimit).join(' ');
    }

    function parseWeekMarkdown(markdown, meta, settings) {
        const lines = markdown.split(/\r?\n/);
        let title = meta.title;
        const sections = [];
        let current = null;
        const slugCounts = new Map();

        lines.forEach((line) => {
            if (line.startsWith('# ')) {
                if (!title) {
                    title = line.replace(/^#\s*/, '').trim();
                }
                return;
            }

            if (line.startsWith('## ')) {
                if (current) {
                    sections.push(current);
                }
                current = {
                    heading: line.replace(/^##\s*/, '').trim(),
                    lines: [],
                    order: orderCounter++
                };
                return;
            }

            if (current) {
                current.lines.push(line);
            }
        });

        if (current) {
            sections.push(current);
        }

        let orderCounter = 0;
        const expandedSections = [];

        sections.forEach((section) => {
            const segments = [];
            let activeHeading = section.heading;
            let buffer = [];

            const flushSegment = () => {
                const content = buffer.join('\n').trim();
                if (!content) {
                    buffer = [];
                    return;
                }
                segments.push({
                    heading: activeHeading,
                    content
                });
                buffer = [];
            };

            section.lines.forEach((line) => {
                const subHeadingMatch = line.match(/^###\s+(.*)$/);
                if (subHeadingMatch) {
                    flushSegment();
                    activeHeading = subHeadingMatch[1].trim();
                    return;
                }
                buffer.push(line);
            });

            flushSegment();

            if (segments.length === 0) {
                segments.push({
                    heading: section.heading,
                    content: section.lines.join('\n').trim()
                });
            }

            segments.forEach((segment) => {
                const classification = classifyHeading(segment.heading, settings);
                let baseSlug = slugify(segment.heading) || `section-${orderCounter}`;
                if (slugCounts.has(baseSlug)) {
                    const count = slugCounts.get(baseSlug) + 1;
                    slugCounts.set(baseSlug, count);
                    baseSlug = `${baseSlug}-${count}`;
                } else {
                    slugCounts.set(baseSlug, 1);
                }

                expandedSections.push({
                    id: `${meta.id}-${baseSlug}`,
                    heading: segment.heading,
                    content: segment.content,
                    type: classification.type,
                    category: classification.category,
                    order: orderCounter++
                });
            });
        });

        const parsedSections = expandedSections;

        const tasks = parsedSections.filter((section) => section.type === 'task');
        const readingSections = parsedSections.filter((section) => section.type === 'reading');
        const referenceReading =
            readingSections.find((section) => !/vocabulary/i.test(section.heading)) ||
            readingSections[0] ||
            parsedSections.find((section) => section.type === 'info');

        return {
            id: meta.id,
            title: title || meta.title || meta.id,
            order: meta.order ?? 0,
            source: meta.source,
            sections: parsedSections,
            tasks,
            readingSections,
            summary: extractSummary(referenceReading, settings.summarySentenceLimit),
            preview: referenceReading?.content?.slice(0, settings.maxReadingPreviewChars) ?? ''
        };
    }

    async function fetchPrebuiltContent() {
        try {
            const response = await fetch('data/content.json', { cache: 'no-cache' });
            if (!response.ok) {
                return null;
            }
            const payload = await response.json();
            if (payload && Array.isArray(payload.weeks)) {
                return payload.weeks;
            }
        } catch (error) {
            console.warn('[TeachContentLoader] Failed to load prebuilt content:', error);
        }
        return null;
    }

    async function loadTeachContent(weeksConfig = TEACH_WEEKS, settings = TEACH_CONTENT_SETTINGS) {
        const prebuilt = await fetchPrebuiltContent();
        if (prebuilt) {
            return prebuilt
                .map((week) => ({
                    ...week,
                    sections: week.sections ?? [],
                    tasks: week.tasks ?? [],
                    readingSections: week.readingSections ?? []
                }))
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        }

        const fetchPromises = weeksConfig.map(async (weekMeta) => {
            try {
                const response = await fetch(weekMeta.source);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const markdown = await response.text();
                return parseWeekMarkdown(markdown, weekMeta, settings);
            } catch (error) {
                console.error(`[TeachContentLoader] Failed to load ${weekMeta.source}:`, error);
                return {
                    id: weekMeta.id,
                    title: weekMeta.title,
                    order: weekMeta.order ?? 0,
                    sections: [],
                    tasks: [],
                    readingSections: [],
                    summary: '',
                    error: error.message ?? String(error)
                };
            }
        });

        const weeks = await Promise.all(fetchPromises);
        return weeks
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    return {
        loadTeachContent
    };
})();

async function loadTeachContent(weeksConfig) {
    return TeachContentLoader.loadTeachContent(weeksConfig);
}

