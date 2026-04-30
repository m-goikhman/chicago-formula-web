window.TeachImageModal = (() => {
    const shared = window.uiShared;
    const buildImageUrl =
        typeof shared?.buildImageUrl === 'function'
            ? shared.buildImageUrl
            : (value) => value;

    function resolveFullscreenImageUrl(imageUrl) {
        const raw = typeof imageUrl === 'string' ? imageUrl.trim() : '';
        if (!raw) {
            return imageUrl;
        }

        const replacementByFileName = {
            'clue3.png': 'clue3_bg.png',
            'nina.png': 'nina_bg.png'
        };
        const fileNameMatch = raw.match(/([^/?#]+)(\?[^#]*)?(#.*)?$/);
        const fileName = fileNameMatch ? fileNameMatch[1].toLowerCase() : '';
        const replacement = replacementByFileName[fileName];

        if (!replacement) {
            return imageUrl;
        }

        return raw.replace(/([^/?#]+)(\?[^#]*)?(#.*)?$/, `${replacement}$2$3`);
    }

    function openImageModal(imageUrl = null) {
        const overlay = document.getElementById('imageModalOverlay');
        const content = document.getElementById('imageModalContent');
        if (!overlay || !content) {
            return;
        }

        const fullscreenUrl = resolveFullscreenImageUrl(imageUrl);
        const resolvedUrl = buildImageUrl(fullscreenUrl);
        if (!resolvedUrl) {
            return;
        }

        content.src = resolvedUrl;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeImageModal() {
        const overlay = document.getElementById('imageModalOverlay');
        const content = document.getElementById('imageModalContent');
        if (!overlay) {
            return;
        }

        overlay.classList.remove('active');
        if (content) {
            content.src = '';
        }
        document.body.style.overflow = '';
    }

    function resolveBeforeReadingImageSrc(rawImagePath) {
        const path = typeof rawImagePath === 'string' ? rawImagePath.trim() : '';
        if (!path) {
            return [];
        }
        const normalizedPath = path.replace(/^\/+/, '');
        const fileName = normalizedPath.split('/').pop() || '';
        const staticTeachPath = /^(?:teach\/images\/|images\/)/i.test(normalizedPath)
            ? normalizedPath.replace(/^(?:teach\/images\/|images\/)/i, '')
            : fileName;

        const candidates = [
            staticTeachPath ? `images/${staticTeachPath}` : '',
            staticTeachPath ? `../images/${staticTeachPath}` : '',
            staticTeachPath ? `/images/${staticTeachPath}` : '',
            normalizedPath ? `/${normalizedPath}` : '',
            path,
            fileName ? buildImageUrl(fileName) : '',
            normalizedPath ? buildImageUrl(normalizedPath) : ''
        ];

        const unique = [];
        const seen = new Set();
        candidates
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .forEach((item) => {
                if (!seen.has(item)) {
                    seen.add(item);
                    unique.push(item);
                }
            });

        return unique;
    }

    return {
        resolveFullscreenImageUrl,
        openImageModal,
        closeImageModal,
        resolveBeforeReadingImageSrc
    };
})();
