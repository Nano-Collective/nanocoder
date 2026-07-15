(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');

	// Auto-resize textarea
	chatInput.addEventListener('input', function() {
		this.style.height = 'auto';
		this.style.height = (this.scrollHeight) + 'px';
	});

	// Handle Enter to submit (Shift+Enter for newline)
	chatInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitMessage();
		}
	});

	function submitMessage() {
		const text = chatInput.value.trim();
		if (!text) return;

		// Send message to extension host
		vscode.postMessage({
			type: 'submitMessage',
			text: text
		});

		// Clear input
		chatInput.value = '';
		chatInput.style.height = 'auto';

		// Optimistically append user message (or we can wait for extension to echo)
		appendMessage(text, 'user');
	}

	function appendMessage(content, role) {
		const msgEl = document.createElement('div');
		msgEl.className = `message ${role}`;
		
		// For now, just set text. In Phase 3, we'll render markdown.
		msgEl.textContent = content;

		// Remove welcome message if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();

		messagesContainer.appendChild(msgEl);
		scrollToBottom();
	}

	function scrollToBottom() {
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'appendMessage':
				appendMessage(message.content, 'agent');
				break;
			case 'clear':
				messagesContainer.innerHTML = '';
				break;
			// Ignore stateUpdate/appendThought for Phase 2, handle in Phase 3
		}
	});

	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
