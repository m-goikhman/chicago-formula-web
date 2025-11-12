// Shared UI helper utilities for Teach/Tell frontends
(function (global) {
    'use strict';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    function renderMarkdown(text) {
        let html = escapeHtml(text);

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function renderTypewriterText(text) {
        let html = escapeHtml(text);

        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

        const paragraphs = html.split(/\n\s*\n/).filter(p => p.trim());
        return paragraphs
            .map(p => `<p>${p.trim().replace(/\n/g, ' ')}</p>`)
            .join('');
    }

    function buildImageUrl(imageFile) {
        if (!imageFile) {
            return null;
        }
        if (global.API_URL) {
            return `${global.API_URL}/api/images/${imageFile}`;
        }
        return imageFile;
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

        if (typewriterStyle) {
            messageDiv.classList.add('typewriter-intro');
        }

        const avatarUrl = buildImageUrl(senderAvatar);
        if (avatarUrl && type !== 'user') {
            const avatar = document.createElement('img');
            avatar.src = avatarUrl;
            avatar.alt = sender;
            avatar.className = 'message-avatar';
            avatar.loading = 'lazy';
            messageDiv.appendChild(avatar);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';

        const renderedContent = typewriterStyle ? renderTypewriterText(content) : renderMarkdown(content);
        contentWrapper.innerHTML = `
            <div class="message-sender">${sender}</div>
            <div class="message-text">${renderedContent}</div>
        `;

        const clueImageUrl = buildImageUrl(imageUrl);
        if (clueImageUrl) {
            const imageDiv = document.createElement('div');
            const img = document.createElement('img');
            img.src = clueImageUrl;
            img.alt = '';
            img.className = 'message-image';
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

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.appendChild(contentWrapper);

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

        return messageDiv;
    }

    function showTypingIndicator(character, options = {}) {
        const chatAreaId = options.chatAreaId || 'chatArea';
        const chatArea = document.getElementById(chatAreaId);

        if (!chatArea) {
            console.warn(`Chat area #${chatAreaId} not found`);
            return null;
        }

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

        typingDiv.appendChild(messageContent);
        chatArea.appendChild(typingDiv);
        chatArea.scrollTop = chatArea.scrollHeight;

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

