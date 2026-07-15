(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');
	
	let currentTurnEl = null;
	let currentTextEl = null;

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

		// Optimistically append user message 
		appendMessage(text, 'user');
		
		// Reset turn elements so agent starts a fresh block
		currentTurnEl = null;
		currentTextEl = null;
	}

	function appendMessage(content, role) {
		// Remove welcome message if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();

		const msgEl = document.createElement('div');
		msgEl.className = `message ${role}`;
		
		const textContainer = document.createElement('div');
		textContainer.textContent = content; // Phase 3: plain text for now, but incrementally updateable
		msgEl.appendChild(textContainer);

		messagesContainer.appendChild(msgEl);
		scrollToBottom();
		
		if (role === 'agent') {
			currentTurnEl = msgEl;
			currentTextEl = textContainer;
		}
	}

	function appendChunk(textChunk) {
		// Remove welcome message if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();

		if (!currentTurnEl || !currentTextEl) {
			// First chunk for this turn
			const msgEl = document.createElement('div');
			msgEl.className = 'message agent';
			
			const textContainer = document.createElement('div');
			textContainer.textContent = textChunk;
			
			msgEl.appendChild(textContainer);
			messagesContainer.appendChild(msgEl);
			
			currentTurnEl = msgEl;
			currentTextEl = textContainer;
		} else {
			// Append to existing turn
			currentTextEl.textContent += textChunk;
		}
		
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
				currentTurnEl = null;
				currentTextEl = null;
				break;
			case 'acpUpdate':
				handleAcpUpdate(message.update);
				break;
		}
	});

	function handleAcpUpdate(payload) {
		if (!payload || !payload.update) return;
		const update = payload.update;
		
		if (update.sessionUpdate === 'agent_message_chunk') {
			if (update.content && update.content.text) {
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'agent_thought_chunk') {
			// Treat thoughts as chunks for now (we can prefix them with "🤔 " or style them later)
			if (update.content) {
				appendChunk(update.content);
			}
		}
	}

	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
