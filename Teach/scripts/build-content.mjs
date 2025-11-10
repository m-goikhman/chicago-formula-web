import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEACH_DIR = path.resolve(PROJECT_ROOT, 'Teach');
const OUTPUT_PATH = path.resolve(PROJECT_ROOT, 'Teach', 'frontend', 'data', 'content.json');
const SHARED_FRONTEND_SOURCE = path.resolve(PROJECT_ROOT, 'shared', 'frontend');
const FRONTEND_SHARED_TARGETS = [
    path.resolve(PROJECT_ROOT, 'Teach', 'frontend', 'shared'),
    path.resolve(PROJECT_ROOT, 'Tell', 'frontend', 'shared')
];

const WEEKS = [
    {
        id: 'week1',
        title: 'Week 1 · The Party',
        source: 'week1_the_party.md',
        order: 1
    },
    {
        id: 'week2',
        title: 'Week 2 · Secrets & Shadows',
        source: 'week2_secrets_and_shadows.md',
        order: 2
    },
    {
        id: 'week3',
        title: 'Week 3 · The Attack',
        source: 'week3_the_attack.md',
        order: 3
    },
    {
        id: 'week4',
        title: 'Week 4 · The Investigation',
        source: 'week4_the_investigation.md',
        order: 4
    }
];

const CONTENT_SETTINGS = {
    summarySentenceLimit: 2,
    maxReadingPreviewChars: 220,
    taskHeadingPatterns: [
        'exercise',
        'writing',
        'question',
        'task',
        'grammar',
        'vocabulary'
    ],
    readingHeadingPatterns: [
        'reading',
        'story',
        'text'
    ]
};

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
    let orderCounter = 0;
    const slugCounts = new Map();

    for (const rawLine of lines) {
        const line = rawLine;
        if (line.startsWith('# ')) {
            if (!title) {
                title = line.replace(/^#\s*/, '').trim();
            }
            continue;
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
            continue;
        }

        if (current) {
            current.lines.push(line);
        }
    }

    if (current) {
        sections.push(current);
    }

    const parsedSections = sections.map((section) => {
        const content = section.lines.join('\n').trim();
        const classification = classifyHeading(section.heading, settings);
        let baseSlug = slugify(section.heading) || `section-${section.order}`;

        if (slugCounts.has(baseSlug)) {
            const count = slugCounts.get(baseSlug) + 1;
            slugCounts.set(baseSlug, count);
            baseSlug = `${baseSlug}-${count}`;
        } else {
            slugCounts.set(baseSlug, 1);
        }

        return {
            id: `${meta.id}-${baseSlug}`,
            heading: section.heading,
            content,
            type: classification.type,
            category: classification.category,
            order: section.order
        };
    });

    const tasks = parsedSections.filter((section) => section.type === 'task');
    const readingSections = parsedSections.filter((section) => section.type === 'reading');
    const referenceReading = readingSections[0] || parsedSections.find((section) => section.type === 'info');

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

async function buildContent() {
    const weeks = [];

    for (const meta of WEEKS) {
        const filePath = path.resolve(TEACH_DIR, meta.source);
        try {
            const markdown = await fs.readFile(filePath, 'utf-8');
            const parsed = parseWeekMarkdown(markdown, meta, CONTENT_SETTINGS);
            weeks.push(parsed);
        } catch (error) {
            console.error(`Failed to parse ${meta.source}:`, error);
        }
    }

    weeks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const output = {
        generatedAt: new Date().toISOString(),
        weeks
    };

    await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`Teach content saved to ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} (${weeks.length} weeks).`);
}

async function copyDirectoryRecursive(source, destination) {
    const entries = await fs.readdir(source, { withFileTypes: true });

    await fs.mkdir(destination, { recursive: true });

    for (const entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {
            await copyDirectoryRecursive(srcPath, destPath);
        } else if (entry.isSymbolicLink()) {
            const realPath = await fs.readlink(srcPath);
            await fs.symlink(realPath, destPath);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}

async function syncSharedFrontendAssets() {
    try {
        const stats = await fs.stat(SHARED_FRONTEND_SOURCE);
        if (!stats.isDirectory()) {
            console.warn(`Shared frontend source is not a directory: ${SHARED_FRONTEND_SOURCE}`);
            return;
        }
    } catch (error) {
        console.warn(`Shared frontend source not found: ${SHARED_FRONTEND_SOURCE}`);
        return;
    }

    for (const target of FRONTEND_SHARED_TARGETS) {
        try {
            await fs.rm(target, { recursive: true, force: true });
            await copyDirectoryRecursive(SHARED_FRONTEND_SOURCE, target);
            console.log(`Shared frontend assets synced to ${path.relative(PROJECT_ROOT, target)}`);
        } catch (error) {
            console.warn(`Failed to sync shared assets to ${target}:`, error);
        }
    }
}

async function main() {
    try {
        await buildContent();
        await syncSharedFrontendAssets();
    } catch (error) {
        console.error('Teach build script failed:', error);
        process.exit(1);
    }
}

main();

