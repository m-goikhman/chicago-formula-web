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

    function parseHeadingMetadata(rawHeading = '') {
        const text = String(rawHeading ?? '').trim();
        const match = text.match(/^(.*?)\s*\[\s*image\s*=\s*([^\]]+?)\s*\]\s*$/i);
        if (!match) {
            return {
                heading: text,
                image: null
            };
        }

        return {
            heading: match[1].trim(),
            image: match[2].trim() || null
        };
    }

    function classifyHeading(heading, settings, content = '') {
        const normalized = heading.toLowerCase();
        const taskMatch = settings.taskHeadingPatterns.some((pattern) => normalized.includes(pattern));
        const readingMatch = settings.readingHeadingPatterns.some((pattern) => normalized.includes(pattern));

        // If it matches reading patterns, it's definitely reading
        if (readingMatch) {
            return { type: 'reading', category: 'reading' };
        }

        // If it matches task patterns, classify as task
        if (taskMatch) {
            if (normalized.includes('writing')) {
                return { type: 'task', category: 'writing' };
            }
            if (normalized.includes('question')) {
                return { type: 'task', category: 'questions' };
            }
            return { type: 'task', category: 'exercise' };
        }

        // Check if it's a long text with a heading (likely a reading text)
        // Minimum length threshold: 500 characters
        const contentLength = String(content).trim().length;
        const hasHeading = heading && heading.trim().length > 0;
        const isLongText = contentLength >= 500;
        
        // If it has a heading and is a long text, and doesn't look like a task, treat as reading
        if (hasHeading && isLongText && !taskMatch) {
            // Exclude obvious non-reading sections
            const excludePatterns = ['exercise', 'question', 'comprehension', 'reflection'];
            const shouldExclude = excludePatterns.some((pattern) => normalized.includes(pattern));
            if (!shouldExclude) {
                return { type: 'reading', category: 'reading' };
            }
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

    function normalizeSection(weekId, section, index, settings) {
        const safeSection = section || {};
        const heading = String(safeSection.heading || '').trim();
        const content = String(safeSection.content || '').trim();
        const classification = classifyHeading(heading, settings, content);
        const fallbackId = `${weekId}-section-${index + 1}`;
        return {
            id: safeSection.id || fallbackId,
            heading,
            image: safeSection.image ?? null,
            portrait: safeSection.portrait === true,
            describe: safeSection.describe === true,
            content,
            type: safeSection.type || classification.type,
            category: safeSection.category || classification.category,
            renderer: safeSection.renderer || null,
            order: typeof safeSection.order === 'number' ? safeSection.order : index
        };
    }

    function finalizeWeek(rawWeek, settings) {
        const sections = (rawWeek.sections || [])
            .map((section, index) => normalizeSection(rawWeek.id, section, index, settings))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const tasks = sections.filter((section) => section.type === 'task');
        const readingSections = sections.filter((section) => section.type === 'reading');
        const referenceReading =
            readingSections[0] ||
            sections.find((section) => section.type === 'info');

        return {
            ...rawWeek,
            sections,
            tasks,
            readingSections,
            summary: extractSummary(referenceReading, settings.summarySentenceLimit),
            preview: referenceReading?.content?.slice(0, settings.maxReadingPreviewChars) ?? ''
        };
    }

    function splitContentIntoSegments(defaultHeading, content, defaultImage = null) {
        const lines = String(content ?? '').split(/\r?\n/);
        const segments = [];
        let activeHeading = defaultHeading;
        let activeImage = defaultImage;
        let buffer = [];
        const splitByDividerOnly = /part\s*2:\s*three suspects/i.test(defaultHeading);

        const flush = () => {
            const text = buffer.join('\n').trim();
            if (text) {
                segments.push({
                    heading: activeHeading,
                    image: activeImage,
                    content: text
                });
            }
            buffer = [];
        };

        lines.forEach((line) => {
            if (splitByDividerOnly && /^---+\s*$/.test(line.trim())) {
                flush();
                return;
            }
            const subHeadingMatch = line.match(/^###\s+(.*)$/);
            if (subHeadingMatch) {
                flush();
                const headingMeta = parseHeadingMetadata(subHeadingMatch[1].trim());
                activeHeading = headingMeta.heading;
                activeImage = headingMeta.image;
                return;
            }
            buffer.push(line);
        });

        flush();

        if (segments.length === 0 && String(content ?? '').trim()) {
            segments.push({
                heading: defaultHeading,
                image: defaultImage,
                content: String(content ?? '').trim()
            });
        }

        return segments;
    }

    function createSectionEntry(
        heading,
        content,
        image,
        meta,
        settings,
        slugCounts,
        orderCounterRef,
        classificationOverride = null
    ) {
        const classification = classificationOverride || classifyHeading(heading, settings, content);
        const defaultSlug = slugify(heading) || `section-${orderCounterRef.value}`;
        const existingCount = slugCounts.get(defaultSlug) ?? 0;
        slugCounts.set(defaultSlug, existingCount + 1);
        const slug = existingCount === 0 ? defaultSlug : `${defaultSlug}-${existingCount + 1}`;

        return {
            id: `${meta.id}-${slug}`,
            heading,
            content,
            image,
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
            const parentClassification = classifyHeading(section.heading, settings, section.content);
            const segments = splitContentIntoSegments(section.heading, section.content, section.image);
            const segmentList = segments.length > 0
                ? segments
                : [{
                    heading: section.heading,
                    image: section.image ?? null,
                    content: String(section.content ?? '').trim()
                }];

            segmentList.forEach((segment) => {
                const segmentClassification = classifyHeading(segment.heading, settings, segment.content);
                const shouldInheritReading =
                    parentClassification.type === 'reading' &&
                    segmentClassification.type === 'info';

                const entry = createSectionEntry(
                    segment.heading,
                    segment.content,
                    segment.image ?? null,
                    meta,
                    settings,
                    slugCounts,
                    orderCounterRef,
                    shouldInheritReading
                        ? { type: 'reading', category: 'reading' }
                        : segmentClassification
                );
                expandedSections.push(entry);
            });
        });

        const tasks = expandedSections.filter((section) => section.type === 'task');
        const readingSections = expandedSections.filter((section) => section.type === 'reading');
        const referenceReading =
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
                const headingMeta = parseHeadingMetadata(line.replace(/^##\s*/, '').trim());
                current = {
                    heading: headingMeta.heading,
                    image: headingMeta.image,
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
                image: section.image ?? null,
                content: section.lines.join('\n')
            }))
        };

        return buildWeekFromSections(baseWeek, { id: meta.id }, settings);
    }

    function buildLegacySectionMap(week, settings) {
        if (!week) {
            return new Map();
        }
        const map = new Map();
        (week.sections || [])
            .map((section, index) => normalizeSection(week.id, section, index, settings))
            .forEach((section) => {
                map.set(section.id, section);
            });
        return map;
    }

    async function fetchManifestForWeek(weekId) {
        try {
            const response = await fetch(`data/teach-manifest/${weekId}.json`, { cache: 'no-cache' });
            if (!response.ok) {
                return null;
            }
            return await response.json();
        } catch (error) {
            console.warn(`[TeachContentLoader] Failed to load manifest for ${weekId}:`, error);
            return null;
        }
    }

    async function fetchTextSource(path) {
        if (!path) {
            return '';
        }
        const response = await fetch(path, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`Could not load ${path} (HTTP ${response.status})`);
        }
        return response.text();
    }

    async function composeWeekFromManifest(manifest, legacyWeek, settings) {
        const fallbackWeek = legacyWeek || {
            id: manifest.id,
            title: manifest.title || manifest.id,
            order: manifest.order ?? 0,
            source: manifest.source || '',
            sections: []
        };
        const legacyMap = buildLegacySectionMap(fallbackWeek, settings);
        const items = Array.isArray(manifest.items) ? manifest.items : [];
        const sections = [];

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index] || {};
            const id = item.id || `${manifest.id}-item-${index + 1}`;
            const isStoryKind = item.kind === 'story';
            const fallbackType = item.kind === 'exercise' ? 'task' : 'info';
            const fallbackCategory = item.kind === 'exercise' ? 'exercise' : isStoryKind ? 'story' : 'info';

            if (item.fromLegacySectionId && legacyMap.has(item.fromLegacySectionId)) {
                const legacy = legacyMap.get(item.fromLegacySectionId);
                sections.push({
                    ...legacy,
                    id,
                    order: index,
                    renderer: item.renderer || legacy.renderer || null
                });
                continue;
            }

            const markdown = item.contentSource
                ? await fetchTextSource(item.contentSource)
                : String(item.content || '');
            const heading = String(item.heading || '').trim();
            const classification = classifyHeading(heading, settings, markdown);
            const resolvedType = isStoryKind ? 'info' : item.type || fallbackType || classification.type;
            const resolvedCategory = isStoryKind ? 'story' : item.category || fallbackCategory || classification.category;

            sections.push({
                id,
                kind: item.kind || null,
                heading,
                image: item.image ?? null,
                portrait: item.portrait === true,
                describe: item.describe === true,
                content: markdown,
                type: resolvedType,
                category: resolvedCategory,
                renderer: item.renderer || null,
                order: index
            });
        }

        return finalizeWeek({
            ...fallbackWeek,
            id: manifest.id || fallbackWeek.id,
            title: manifest.title || fallbackWeek.title,
            summaryText: manifest.summaryText || '',
            order: manifest.order ?? fallbackWeek.order ?? 0,
            source: manifest.source || fallbackWeek.source,
            sections
        }, settings);
    }

    async function applyWeekManifests(weeks, weeksConfig, settings) {
        const byId = new Map((weeks || []).map((week) => [week.id, week]));
        const result = [];

        for (const week of weeks || []) {
            const manifest = await fetchManifestForWeek(week.id);
            if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
                result.push(finalizeWeek(week, settings));
                continue;
            }
            const composed = await composeWeekFromManifest(manifest, week, settings);
            result.push(composed);
        }

        const existingIds = new Set(result.map((week) => week.id));
        for (const weekMeta of weeksConfig || []) {
            if (existingIds.has(weekMeta.id)) {
                continue;
            }
            const manifest = await fetchManifestForWeek(weekMeta.id);
            if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
                continue;
            }
            const composed = await composeWeekFromManifest(manifest, byId.get(weekMeta.id), settings);
            result.push(composed);
        }

        return result
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    async function loadTeachContent(weeksConfig = TEACH_WEEKS, settings = TEACH_CONTENT_SETTINGS) {
        const fetchPromises = weeksConfig.map(async (weekMeta) => {
            const manifest = await fetchManifestForWeek(weekMeta.id);
            if (manifest && Array.isArray(manifest.items)) {
                const requiresLegacySections = manifest.items.some((item) => item?.fromLegacySectionId);
                if (!requiresLegacySections) {
                    return composeWeekFromManifest(manifest, null, settings);
                }
                try {
                    const response = await fetch(weekMeta.source);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const markdown = await response.text();
                    const legacyWeek = parseWeekMarkdown(markdown, weekMeta, settings);
                    return composeWeekFromManifest(manifest, legacyWeek, settings);
                } catch (error) {
                    console.warn(`[TeachContentLoader] Failed to load legacy source ${weekMeta.source}:`, error);
                    return composeWeekFromManifest(manifest, null, settings);
                }
            }

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
        return applyWeekManifests(
            weeks.filter(Boolean),
            weeksConfig,
            settings
        );
    }

    return {
        loadTeachContent
    };
})();

async function loadTeachContent(weeksConfig) {
    return TeachContentLoader.loadTeachContent(weeksConfig);
}

