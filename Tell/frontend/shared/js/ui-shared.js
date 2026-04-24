// Shared UI helper utilities for Teach/Tell frontends
(function (global) {
    'use strict';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    function extractMarkdownLinks(text) {
        const links = [];
        const textWithTokens = text.replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            (_, label, url) => {
                const token = `%%MDLINK${links.length}%%`;
                links.push({ token, label, url });
                return token;
            }
        );
        return { textWithTokens, links };
    }

    function restoreMarkdownLinks(text, links) {
        let restored = text;
        for (const link of links) {
            restored = restored.replace(
                link.token,
                `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.label}</a>`
            );
        }
        return restored;
    }

    function renderMarkdown(text) {
        let html = escapeHtml(text);
        const { textWithTokens, links } = extractMarkdownLinks(html);
        html = textWithTokens;

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        html = restoreMarkdownLinks(html, links);
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function renderTypewriterText(text) {
        let html = escapeHtml(text);
        const { textWithTokens, links } = extractMarkdownLinks(html);
        html = textWithTokens;

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        html = restoreMarkdownLinks(html, links);

        const paragraphs = html.split(/\n\s*\n/).filter(p => p.trim());
        return paragraphs
            .map(p => `<p>${p.trim().replace(/\n/g, ' ')}</p>`)
            .join('');
    }

    function buildImageUrl(imageFile) {
        if (!imageFile) {
            return null;
        }
        const normalizedImageFile = String(imageFile).trim();
        if (!normalizedImageFile) {
            return null;
        }

        if (/^(https?:)?\/\//i.test(normalizedImageFile) || /^(data|blob):/i.test(normalizedImageFile)) {
            return normalizedImageFile;
        }

        if (/^\/?Teach\/images\//i.test(normalizedImageFile)) {
            return `/${normalizedImageFile.replace(/^\/?Teach\/images\//i, 'images/')}`;
        }

        if (/^(?:\.{1,2}\/|\/|images\/)/i.test(normalizedImageFile)) {
            return normalizedImageFile;
        }

        if (global.API_URL) {
            return `${global.API_URL}/api/images/${normalizedImageFile}`;
        }
        return normalizedImageFile;
    }

    function addMessage(type, sender, content, imageUrl = null, senderAvatar = null, typewriterStyle = false, options = {}) {
        const chatAreaId = options.chatAreaId || 'chatArea';
        const chatArea = document.getElementById(chatAreaId);

        if (!chatArea) {
            console.warn(`Chat area #${chatAreaId} not found`);
            return null;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        if (options.messageClass) {
            messageDiv.classList.add(options.messageClass);
        }

        if (typewriterStyle) {
            messageDiv.classList.add('typewriter-intro');
        }

        const avatarUrl = buildImageUrl(senderAvatar);
        if (avatarUrl && type !== 'user' && !options.hideAvatar) {
            const avatar = document.createElement('img');
            avatar.src = avatarUrl;
            avatar.alt = sender;
            avatar.className = 'message-avatar';
            avatar.loading = 'lazy';
            if (typeof options.onAvatarClick === 'function') {
                avatar.classList.add('clickable');
                avatar.setAttribute('role', 'button');
                avatar.setAttribute('tabindex', '0');
                avatar.setAttribute('aria-label', `Open ${sender} profile`);
                avatar.onclick = () => options.onAvatarClick();
                avatar.onkeydown = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        options.onAvatarClick();
                    }
                };
            }
            messageDiv.appendChild(avatar);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';

        const clueImageUrl = buildImageUrl(imageUrl);
        const imageFirst = Boolean(options.imageFirst);

        function appendMessageImage() {
            if (!clueImageUrl) {
                return;
            }
            const imageDiv = document.createElement('div');
            const img = document.createElement('img');
            img.src = clueImageUrl;
            img.alt = '';
            img.className = 'message-image';
            if (typeof imageUrl === 'string' && imageUrl.includes('detective_guide')) {
                img.classList.add('message-image--detective-guide');
            }
            if (typeof imageUrl === 'string' && /(^|\/)nina\.(png|webp|jpg|jpeg)$/i.test(imageUrl.trim())) {
                img.classList.add('message-image--no-shadow');
            }
            img.loading = 'lazy';
            img.onclick = () => {
                if (typeof options.onImageClick === 'function') {
                    options.onImageClick(imageUrl, clueImageUrl);
                } else if (typeof global.openImageModal === 'function') {
                    global.openImageModal(imageUrl);
                }
            };
            imageDiv.appendChild(img);
            contentWrapper.appendChild(imageDiv);
        }

        if (imageFirst) {
            appendMessageImage();
        }

        const renderedContent = typewriterStyle ? renderTypewriterText(content) : renderMarkdown(content);
        contentWrapper.insertAdjacentHTML('beforeend', `
            ${options.hideSender ? '' : `<div class="message-sender">${sender}</div>`}
            <div class="message-text">${renderedContent}</div>
        `);

        if (!imageFirst) {
            appendMessageImage();
        }

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.appendChild(contentWrapper);

        const scopeFromOptions = typeof options.chatScope === 'string' ? options.chatScope.trim() : '';
        const activeScope = (typeof global.getActiveChatScope === 'function')
            ? global.getActiveChatScope()
            : 'public';
        messageDiv.dataset.chatScope = scopeFromOptions || activeScope || 'public';

        messageDiv.appendChild(messageContent);
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;

        if (global.highlightManager && typeof global.highlightManager.generateMessageId === 'function') {
            try {
                const messageId = global.highlightManager.generateMessageId(content);
                messageDiv.dataset.messageId = messageId;

                setTimeout(() => {
                    if (global.highlightManager && typeof global.highlightManager.applyHighlights === 'function') {
                        global.highlightManager.applyHighlights(messageDiv, messageId);
                    }
                }, 0);
            } catch (e) {
                console.warn('Error applying highlights:', e);
            }
        }

        if (typeof global.applyChatScopeVisibility === 'function') {
            global.applyChatScopeVisibility();
        }

        return messageDiv;
    }

    function showTypingIndicator(character, options = {}) {
        const chatAreaId = options.chatAreaId || 'chatArea';
        const chatArea = document.getElementById(chatAreaId);

        if (!chatArea) {
            console.warn(`Chat area #${chatAreaId} not found`);
            return null;
        }

        // Keep only one typing indicator per chat area to avoid duplicates.
        const existingTypingIndicators = chatArea.querySelectorAll('.typing-message');
        existingTypingIndicators.forEach((indicator) => indicator.remove());

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message character typing-message';
        typingDiv.id = options.typingIndicatorId || 'typing-indicator';

        const avatarUrl = buildImageUrl(character?.image);
        if (avatarUrl) {
            const avatar = document.createElement('img');
            avatar.src = avatarUrl;
            avatar.alt = character?.name ?? 'Character';
            avatar.className = 'message-avatar';
            avatar.loading = 'lazy';
            typingDiv.appendChild(avatar);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';
        contentWrapper.innerHTML = `
            <div class="typing-indicator">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.appendChild(contentWrapper);

        const scopeFromOptions = typeof options.chatScope === 'string' ? options.chatScope.trim() : '';
        const activeScope = (typeof global.getActiveChatScope === 'function')
            ? global.getActiveChatScope()
            : 'public';
        typingDiv.dataset.chatScope = scopeFromOptions || activeScope || 'public';

        typingDiv.appendChild(messageContent);
        chatArea.appendChild(typingDiv);
        chatArea.scrollTop = chatArea.scrollHeight;

        if (typeof global.applyChatScopeVisibility === 'function') {
            global.applyChatScopeVisibility();
        }

        return typingDiv;
    }

    function autoResizeTextarea(options = {}) {
        const textareaId = options.textareaId || 'messageInput';
        const maxHeight = options.maxHeight ?? 120;
        const textarea = document.getElementById(textareaId);

        if (!textarea) {
            return;
        }

        textarea.style.height = 'auto';
        const newHeight = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = newHeight + 'px';
    }

    global.uiShared = {
        escapeHtml,
        renderMarkdown,
        renderTypewriterText,
        addMessage,
        showTypingIndicator,
        autoResizeTextarea,
        buildImageUrl
    };
})(window);

