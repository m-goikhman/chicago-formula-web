
// Initialize application
document.addEventListener('DOMContentLoaded', async function() {
    // Header no longer has background image - removed for performance
    
    // Try to restore session from localStorage
    const sessionRestored = await restoreSession();
    
    const textarea = document.getElementById('messageInput');
    
    // Auto-resize on input
    if (textarea) {
        textarea.addEventListener('input', autoResizeTextarea);
        
        // Handle Enter key (Shift+Enter for new line, Enter to send)
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Mobile: Scroll input area into view when focused
        textarea.addEventListener('focus', function() {
            setTimeout(() => {
                const inputArea = document.querySelector('.input-area');
                if (inputArea) {
                    inputArea.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
            }, 300); // Delay for keyboard animation
        });
    }
    
    // Allow Enter key in participant code input
    const participantCodeInput = document.getElementById('participantCode');
    if (participantCodeInput) {
        participantCodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });
    }
    
    // Close menu on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const menu = document.getElementById('horizontalMenu');
            const button = document.getElementById('burgerButton');
            if (menu && menu.classList.contains('active')) {
                menu.classList.remove('active');
                button.classList.remove('active');
            }
            closeImageModal();
        }
    });
    
    // Save session before page unload
    window.addEventListener('beforeunload', function() {
        // Session is already saved in localStorage, nothing to do
    });
});

// Global variables that need to be accessible
let inputAreaShown = false; // Track if input area has been shown

// Export to window for access from other modules
window.inputAreaShown = inputAreaShown;
