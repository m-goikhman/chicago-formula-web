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

    function splitContentIntoSegments(defaultHeading, content) {
        const lines = String(content ?? '').split(/\r?\n/);
        const segments = [];
        let activeHeading = defaultHeading;
        let buffer = [];

        const flush = () => {
            const text = buffer.join('\n').trim();
            if (text) {
                segments.push({
                    heading: activeHeading,
                    content: text
                });
            }
            buffer = [];
        };

        lines.forEach((line) => {
            const subHeadingMatch = line.match(/^###\s+(.*)$/);
            if (subHeadingMatch) {
                flush();
                activeHeading = subHeadingMatch[1].trim();
                return;
            }
            buffer.push(line);
        });

        flush();

        if (segments.length === 0 && String(content ?? '').trim()) {
            segments.push({
                heading: defaultHeading,
                content: String(content ?? '').trim()
            });
        }

        return segments;
    }

    function createSectionEntry(heading, content, meta, settings, slugCounts, orderCounterRef) {
        const classification = classifyHeading(heading, settings);
        const defaultSlug = slugify(heading) || `section-${orderCounterRef.value}`;
        const existingCount = slugCounts.get(defaultSlug) ?? 0;
        slugCounts.set(defaultSlug, existingCount + 1);
        const slug = existingCount === 0 ? defaultSlug : `${defaultSlug}-${existingCount + 1}`;

        return {
            id: `${meta.id}-${slug}`,
            heading,
            content,
            type: classification.type,
            category: classification.category,
            order: orderCounterRef.value++
        };
    }

    function buildWeekFromSections(baseWeek, meta, settings) {
        const slugCounts = new Map();
        const orderCounterRef = { value: 0 };
        const expandedSections = [];

        (baseWeek.sections ?? []).forEach((section) => {
            const segments = splitContentIntoSegments(section.heading, section.content);
            const segmentList = segments.length > 0
                ? segments
                : [{
                    heading: section.heading,
                    content: String(section.content ?? '').trim()
                }];

            segmentList.forEach((segment) => {
                const entry = createSectionEntry(
                    segment.heading,
                    segment.content,
                    meta,
                    settings,
                    slugCounts,
                    orderCounterRef
                );
                expandedSections.push(entry);
            });
        });

        const tasks = expandedSections.filter((section) => section.type === 'task');
        const readingSections = expandedSections.filter((section) => section.type === 'reading');
        const referenceReading =
            readingSections.find((section) => !/vocabulary/i.test(section.heading)) ||
            readingSections[0] ||
            expandedSections.find((section) => section.type === 'info');

        return {
            ...baseWeek,
            sections: expandedSections,
            tasks,
            readingSections,
            summary: extractSummary(referenceReading, settings.summarySentenceLimit),
            preview: referenceReading?.content?.slice(0, settings.maxReadingPreviewChars) ?? ''
        };
    }

    function parseWeekMarkdown(markdown, meta, settings) {
        const lines = markdown.split(/\r?\n/);
        let title = meta.title;
        const sections = [];
        let current = null;

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
                    lines: []
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

        const baseWeek = {
            id: meta.id,
            title: title || meta.title || meta.id,
            order: meta.order ?? 0,
            source: meta.source,
            sections: sections.map((section) => ({
                heading: section.heading,
                content: section.lines.join('\n')
            }))
        };

        return buildWeekFromSections(baseWeek, { id: meta.id }, settings);
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
                .map((week) =>
                    buildWeekFromSections(
                        {
                            ...week,
                            sections: week.sections ?? []
                        },
                        { id: week.id },
                        settings
                    )
                )
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

