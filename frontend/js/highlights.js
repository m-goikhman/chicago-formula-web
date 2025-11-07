// Word highlighting system
// Handles text selection, highlighting, and word explanations

class HighlightManager {
    constructor() {
        this.highlights = new Map(); // messageId -> Set of highlighted words/phrases
        this.messageIdCounter = 0;
        this.loadHighlights();
        this.setupEventListeners();
    }
    
    // Load saved highlights from localStorage
    loadHighlights() {
        try {
            const saved = localStorage.getItem('wordHighlights');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.highlights = new Map(Object.entries(parsed).map(([k, v]) => [k, new Set(v)]));
            }
        } catch (e) {
            console.error('Error loading highlights:', e);
        }
    }
    
    // Save highlights to localStorage
    saveHighlights() {
        try {
            const serializable = Object.fromEntries(
                Array.from(this.highlights.entries()).map(([k, v]) => [k, Array.from(v)])
            );
            localStorage.setItem('wordHighlights', JSON.stringify(serializable));
        } catch (e) {
            console.error('Error saving highlights:', e);
        }
    }
    
    // Generate unique message ID based on content hash
    generateMessageId(messageContent = null) {
        if (messageContent) {
            // Generate hash from content
            let hash = 0;
            for (let i = 0; i < messageContent.length; i++) {
                const char = messageContent.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return `msg_${Math.abs(hash)}_${Date.now()}`;
        }
        return `msg_${Date.now()}_${++this.messageIdCounter}`;
    }
    
    // Setup event listeners for text selection
    setupEventListeners() {
        // Track touch start position to detect if it's a selection or tap
        let touchStartTime = 0;
        let touchStartElement = null;
        
        // Track if text is currently selected
        let hasSelection = false;
        
        // Prevent context menu only when text is selected or on highlights
        document.addEventListener('contextmenu', (e) => {
            const highlight = e.target.closest('.highlight');
            const selection = window.getSelection();
            const hasTextSelected = selection && selection.rangeCount > 0 && selection.toString().trim().length > 0;
            
            // Block context menu on highlights or when text is selected in message text
            if (highlight || (hasTextSelected && e.target.closest('.message-text'))) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }, false);
        
        // Track selection state
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            hasSelection = selection && selection.rangeCount > 0 && selection.toString().trim().length > 0;
        });
        
        // Track touch start (passive to not interfere with text selection)
        document.addEventListener('touchstart', (e) => {
            // Only track if not on a highlight
            const highlight = e.target.closest('.highlight');
            if (!highlight) {
                const messageText = e.target.closest('.message-text');
                if (messageText) {
                    touchStartTime = Date.now();
                    touchStartElement = e.target;
                }
            }
        }, { passive: true });
        
        // Common handler for text selection (works for both mouse and touch)
        const handleTextSelection = (e) => {
            // For touch events, check if it was a quick tap (should not trigger selection)
            if (e.type === 'touchend') {
                const touchDuration = Date.now() - touchStartTime;
                // If it was a quick tap (< 150ms) without movement, don't process as selection
                // This allows normal text selection to work
                if (touchDuration < 150 && e.target === touchStartElement) {
                    touchStartTime = 0;
                    touchStartElement = null;
                    return;
                }
            }
            
            // Shorter delay for touch events to allow proper text selection
            const delay = e.type === 'touchend' ? 100 : 10;
            setTimeout(() => {
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0) return;
                
                const range = selection.getRangeAt(0);
                const selectedText = selection.toString().trim();
                
                // Only process if there's selected text and it's in a message
                if (selectedText.length === 0) return;
                
                // Check if selection is within a message text element
                const messageText = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
                    ? range.commonAncestorContainer.parentElement.closest('.message-text')
                    : range.commonAncestorContainer.closest('.message-text');
                
                if (!messageText) return;
                
                // Check if clicking on an existing highlight (already handled by click handler)
                const clickedHighlight = e.target.closest('.highlight');
                if (clickedHighlight) {
                    // Selection was made on a highlight, don't process
                    window.getSelection().removeAllRanges();
                    return;
                }
                
                // Don't highlight if selection is too short or too long
                if (selectedText.length < 2 || selectedText.length > 50) {
                    window.getSelection().removeAllRanges();
                    return;
                }
                
                // Don't highlight if selection contains only whitespace or special chars
                if (!/[\w\u0400-\u04FF]/.test(selectedText)) {
                    window.getSelection().removeAllRanges();
                    return;
                }
                
                // Highlight the selected text
                this.highlightSelection(range, messageText, selectedText);
            }, delay);
        };
        
        // Handle text selection for mouse devices
        document.addEventListener('mouseup', handleTextSelection);
        
        // Handle text selection for touch devices
        document.addEventListener('touchend', handleTextSelection);
        
        // Prevent text selection when clicking/touching on highlights only
        const preventSelectionOnHighlight = (e) => {
            const highlight = e.target.closest('.highlight');
            if (highlight) {
                // Only prevent default on highlights, not on regular text
                e.stopPropagation();
                // Prevent context menu and text selection on highlights
                e.preventDefault();
            }
        };
        
        document.addEventListener('mousedown', preventSelectionOnHighlight);
        document.addEventListener('touchstart', preventSelectionOnHighlight, { passive: false });
    }
    
    // Highlight selected text
    highlightSelection(range, messageText, selectedText) {
        try {
            // Get message ID (create if doesn't exist)
            const messageDiv = messageText.closest('.message');
            let messageId = messageDiv.dataset.messageId;
            if (!messageId) {
                messageId = this.generateMessageId();
                messageDiv.dataset.messageId = messageId;
            }
            
            // Check if this word/phrase is already highlighted
            if (!this.highlights.has(messageId)) {
                this.highlights.set(messageId, new Set());
            }
            
            const messageHighlights = this.highlights.get(messageId);
            if (messageHighlights.has(selectedText)) {
                // Already highlighted, just clear selection
                window.getSelection().removeAllRanges();
                return;
            }
            
            // Check if selection is within an existing highlight
            const existingHighlight = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
                ? range.commonAncestorContainer.parentElement.closest('.highlight')
                : range.commonAncestorContainer.closest('.highlight');
            
            if (existingHighlight) {
                // Don't highlight if already inside a highlight
                window.getSelection().removeAllRanges();
                return;
            }
            
            // Use a more robust method to highlight text
            this.highlightTextInRange(range, selectedText, messageId);
            
            // Add to highlights set
            messageHighlights.add(selectedText);
            this.saveHighlights();
            
            // Clear selection
            window.getSelection().removeAllRanges();
        } catch (e) {
            console.error('Error highlighting text:', e);
            window.getSelection().removeAllRanges();
        }
    }
    
    // Highlight text in a range (more robust method)
    highlightTextInRange(range, text, messageId) {
        try {
            // If range is within a single text node, use simple method
            if (range.startContainer === range.endContainer && 
                range.startContainer.nodeType === Node.TEXT_NODE) {
                const textNode = range.startContainer;
                const start = range.startOffset;
                const end = range.endOffset;
                
                // Split text node
                const beforeText = textNode.textContent.substring(0, start);
                const selectedText = textNode.textContent.substring(start, end);
                const afterText = textNode.textContent.substring(end);
                
                // Create highlight element
                const highlight = document.createElement('span');
                highlight.className = 'highlight';
                highlight.dataset.word = text;
                highlight.dataset.messageId = messageId;
                highlight.textContent = selectedText;
                
                // Add click handler
                this.addHighlightHandlers(highlight);
                
                // Replace text node with before + highlight + after
                const parent = textNode.parentNode;
                if (beforeText) {
                    parent.insertBefore(document.createTextNode(beforeText), textNode);
                }
                parent.insertBefore(highlight, textNode);
                if (afterText) {
                    parent.insertBefore(document.createTextNode(afterText), textNode);
                }
                parent.removeChild(textNode);
            } else {
                // For complex selections spanning multiple nodes, use extractContents
                const contents = range.extractContents();
                const highlight = document.createElement('span');
                highlight.className = 'highlight';
                highlight.dataset.word = text;
                highlight.dataset.messageId = messageId;
                highlight.appendChild(contents);
                
                // Add click handler
                this.addHighlightHandlers(highlight);
                
                range.insertNode(highlight);
            }
        } catch (e) {
            console.error('Error highlighting text in range:', e);
            // Fallback: use simple text replacement
            const html = range.commonAncestorContainer.parentElement.innerHTML;
            const newHtml = html.replace(
                new RegExp(this.escapeRegex(text), 'gi'),
                `<span class="highlight" data-word="${text}" data-message-id="${messageId}">$&</span>`
            );
            range.commonAncestorContainer.parentElement.innerHTML = newHtml;
            
            // Re-add click handlers
            const highlights = range.commonAncestorContainer.parentElement.querySelectorAll(
                `.highlight[data-word="${text}"]`
            );
            highlights.forEach(h => {
                this.addHighlightHandlers(h);
            });
        }
    }
    
    // Add event handlers for highlight (works for both mouse and touch)
    addHighlightHandlers(highlight) {
        const handleClick = (e) => {
            e.stopPropagation();
            this.handleHighlightClick(highlight, e);
        };
        
        // Support both mouse and touch events
        highlight.addEventListener('click', handleClick);
        highlight.addEventListener('touchend', (e) => {
            e.preventDefault(); // Prevent default touch behavior
            handleClick(e);
        });
    }
    
    // Handle click on highlighted word
    async handleHighlightClick(highlight, event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Clear any text selection
        window.getSelection().removeAllRanges();
        
        const word = highlight.dataset.word;
        const messageId = highlight.dataset.messageId;
        
        if (!word) return;
        
        // Prevent multiple simultaneous requests
        if (highlight.classList.contains('loading')) return;
        
        // Get original message text
        const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageDiv) return;
        
        const messageText = messageDiv.querySelector('.message-text');
        if (!messageText) return;
        
        // Get original text (without HTML tags)
        const originalText = this.getOriginalText(messageText);
        
        // Show loading state
        highlight.classList.add('loading');
        highlight.style.opacity = '0.6';
        
        try {
            // Call explainWord function
            if (window.explainWord) {
                await window.explainWord(word, originalText);
            }
        } catch (error) {
            console.error('Error explaining word:', error);
        } finally {
            // Remove loading state
            highlight.classList.remove('loading');
            highlight.style.opacity = '';
        }
    }
    
    // Get original text from message (without HTML tags and highlights)
    getOriginalText(messageText) {
        // Clone the element to avoid modifying the original
        const clone = messageText.cloneNode(true);
        
        // Remove all highlight elements
        const highlights = clone.querySelectorAll('.highlight');
        highlights.forEach(h => {
            const text = document.createTextNode(h.textContent);
            h.parentNode.replaceChild(text, h);
        });
        
        return clone.textContent || clone.innerText || '';
    }
    
    // Apply saved highlights to a message
    applyHighlights(messageDiv, messageId) {
        if (!messageId) {
            messageId = messageDiv.dataset.messageId;
        } else {
            messageDiv.dataset.messageId = messageId;
        }
        
        if (!messageId || !this.highlights.has(messageId)) {
            return;
        }
        
        const messageText = messageDiv.querySelector('.message-text');
        if (!messageText) return;
        
        const wordsToHighlight = this.highlights.get(messageId);
        const originalText = messageText.textContent || messageText.innerText;
        
        // Apply highlights
        wordsToHighlight.forEach(word => {
            this.highlightWordInText(messageText, word, messageId);
        });
    }
    
    // Highlight a specific word in text
    highlightWordInText(messageText, word, messageId) {
        // Get text content to work with
        const walker = document.createTreeWalker(
            messageText,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            // Skip if node is inside an existing highlight
            if (node.parentElement && node.parentElement.classList.contains('highlight')) {
                continue;
            }
            textNodes.push(node);
        }
        
        // Process each text node
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const regex = new RegExp(`(${this.escapeRegex(word)})`, 'gi');
            
            if (!regex.test(text)) return;
            
            // Reset regex
            regex.lastIndex = 0;
            
            const parts = [];
            let lastIndex = 0;
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                // Add text before match
                if (match.index > lastIndex) {
                    parts.push(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                
                // Create highlight for match
                const highlight = document.createElement('span');
                highlight.className = 'highlight';
                highlight.dataset.word = word;
                highlight.dataset.messageId = messageId;
                highlight.textContent = match[0];
                
                // Add click handler
                this.addHighlightHandlers(highlight);
                
                parts.push(highlight);
                lastIndex = regex.lastIndex;
            }
            
            // Add remaining text
            if (lastIndex < text.length) {
                parts.push(document.createTextNode(text.substring(lastIndex)));
            }
            
            // Replace text node with parts
            if (parts.length > 0) {
                const parent = textNode.parentNode;
                parts.forEach(part => {
                    parent.insertBefore(part, textNode);
                });
                parent.removeChild(textNode);
            }
        });
    }
    
    // Escape special regex characters
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    // Remove highlight from a word
    removeHighlight(messageId, word) {
        if (this.highlights.has(messageId)) {
            this.highlights.get(messageId).delete(word);
            if (this.highlights.get(messageId).size === 0) {
                this.highlights.delete(messageId);
            }
            this.saveHighlights();
        }
    }
}

// Initialize highlight manager immediately
// Scripts are loaded at the end of body, so DOM should be ready
const highlightManager = new HighlightManager();
window.highlightManager = highlightManager;

