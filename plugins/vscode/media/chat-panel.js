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
			case 'permissionRequested':
				handlePermissionRequested(message.toolCallId, message.toolCall);
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
			if (update.content && update.content.text) {
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
			handleToolCallUpdate(update);
		}
	}

	function handleToolCallUpdate(update) {
		const toolCallId = update.toolCallId || (update.toolCall && update.toolCall.toolCallId);
		if (!toolCallId) return;

		let card = document.getElementById(`tool-card-${toolCallId}`);
		if (!card) {
			card = createToolCard(toolCallId, update);
			messagesContainer.appendChild(card);
			scrollToBottom();
		} else {
			updateToolCard(card, update);
		}
	}

	function createToolCard(toolCallId, update) {
		const card = document.createElement('div');
		card.className = 'tool-card';
		card.id = `tool-card-${toolCallId}`;
		
		const header = document.createElement('div');
		header.className = 'tool-header';
		
		const title = document.createElement('span');
		title.className = 'tool-title';
		title.textContent = update.title || update.name || 'Tool Call';
		
		const status = document.createElement('span');
		status.className = 'tool-status pending';
		status.textContent = '⏳';
		
		header.appendChild(status);
		header.appendChild(title);
		card.appendChild(header);
		
		const body = document.createElement('div');
		body.className = 'tool-body';
		
		// Add diff link if there's a diff content
		if (update.content && Array.isArray(update.content)) {
			const hasDiff = update.content.some(c => c.type === 'diff');
			if (hasDiff) {
				const diffLink = document.createElement('a');
				diffLink.href = '#';
				diffLink.className = 'tool-diff-link';
				diffLink.textContent = 'View Changes';
				diffLink.onclick = (e) => {
					e.preventDefault();
					vscode.postMessage({ type: 'showDiff', toolCallId });
				};
				body.appendChild(diffLink);
			}
		}

		card.appendChild(body);
		return card;
	}

	function updateToolCard(card, update) {
		const statusEl = card.querySelector('.tool-status');
		const bodyEl = card.querySelector('.tool-body');
		
		if (update.status) {
			statusEl.className = `tool-status ${update.status}`;
			if (update.status === 'success' || update.status === 'completed') {
				statusEl.textContent = '✅';
				const actions = card.querySelector('.tool-actions');
				if (actions) actions.remove();
			} else if (update.status === 'error') {
				statusEl.textContent = '❌';
				const actions = card.querySelector('.tool-actions');
				if (actions) actions.remove();
			} else if (update.status === 'cancelled' || update.status === 'denied') {
				statusEl.textContent = '🚫';
				const actions = card.querySelector('.tool-actions');
				if (actions) actions.remove();
			}
		}
	}

	function handlePermissionRequested(toolCallId, toolCall) {
		const card = document.getElementById(`tool-card-${toolCallId}`);
		if (!card) return;
		
		// Check if actions already exist
		if (card.querySelector('.tool-actions')) return;

		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'tool-actions';
		
		const approveBtn = document.createElement('button');
		approveBtn.className = 'tool-btn approve-btn';
		approveBtn.textContent = 'Approve';
		approveBtn.onclick = () => {
			vscode.postMessage({ type: 'approveTool', toolCallId });
			actionsDiv.remove();
		};
		
		const denyBtn = document.createElement('button');
		denyBtn.className = 'tool-btn deny-btn';
		denyBtn.textContent = 'Deny';
		denyBtn.onclick = () => {
			vscode.postMessage({ type: 'denyTool', toolCallId });
			actionsDiv.remove();
		};
		
		actionsDiv.appendChild(approveBtn);
		actionsDiv.appendChild(denyBtn);
		
		card.appendChild(actionsDiv);
		scrollToBottom();
	}

	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
