(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');
	const modeSelector = document.getElementById('mode-selector');
	const modelSelector = document.getElementById('model-selector');
	const historyBtn = document.getElementById('history-btn');
	const chatView = document.getElementById('chat-view');
	const historyView = document.getElementById('history-view');
	const historyList = document.getElementById('history-list');
	const sendStopBtn = document.getElementById('send-stop-btn');
	const iconSend = document.getElementById('icon-send');
	const iconStop = document.getElementById('icon-stop');
	
	let currentTurnEl = null;
	let currentTextEl = null;
	let sessionsData = [];
	let isHistoryView = false;
	let isProcessing = false;

	// --- Send / Stop toggle logic ---
	function setProcessing(active) {
		isProcessing = active;
		if (iconSend) iconSend.style.display = active ? 'none' : '';
		if (iconStop) iconStop.style.display = active ? '' : 'none';
		if (sendStopBtn) {
			sendStopBtn.title = active ? 'Stop (cancel)' : 'Send (Enter)';
			sendStopBtn.classList.toggle('is-processing', active);
		}
		chatInput.disabled = active;
	}

	if (sendStopBtn) {
		sendStopBtn.addEventListener('click', () => {
			if (isProcessing) {
				vscode.postMessage({ type: 'cancel' });
				setProcessing(false);
			} else {
				submitMessage();
			}
		});
	}

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
		if (!text || isProcessing) return;

		// Send message to extension host
		vscode.postMessage({
			type: 'submitMessage',
			text: text
		});

		// Clear input
		chatInput.value = '';
		chatInput.style.height = 'auto';

		// Switch to processing state
		setProcessing(true);

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
				setProcessing(false);
				break;
			case 'acpUpdate':
				handleAcpUpdate(message.update);
				break;
			case 'permissionRequested':
				handlePermissionRequested(message.toolCallId, message.toolCall);
				break;
			case 'showPlanReview':
				handlePlanReview(message);
				break;
			case 'syncState':
				handleSyncState(message);
				break;
			case 'updateSessions':
				sessionsData = message.sessions || [];
				if (isHistoryView) renderSessions();
				break;
		}
	});

	modeSelector.addEventListener('change', () => {
		vscode.postMessage({ type: 'setMode', mode: modeSelector.value });
	});

	modelSelector.addEventListener('change', () => {
		vscode.postMessage({ type: 'setModel', model: modelSelector.value });
	});

	if (historyBtn) {
		historyBtn.addEventListener('click', () => {
			if (isHistoryView) {
				showChatView();
			} else {
				showHistoryView();
			}
		});
	}

	function showChatView() {
		isHistoryView = false;
		if (chatView) chatView.style.display = '';
		if (historyView) historyView.style.display = 'none';
		if (historyBtn) historyBtn.title = 'History';
		if (historyBtn) historyBtn.textContent = '🕐';
	}

	function showHistoryView() {
		isHistoryView = true;
		if (chatView) chatView.style.display = 'none';
		if (historyView) historyView.style.display = '';
		if (historyBtn) historyBtn.title = 'Back to chat';
		if (historyBtn) historyBtn.textContent = '✕';
		// Always refresh the list when opening history
		vscode.postMessage({ type: 'listSessions' });
		renderSessions();
	}

	function renderSessions() {
		if (!historyList) return;
		historyList.innerHTML = '';

		if (sessionsData.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'history-empty';
			empty.textContent = 'No previous sessions found.';
			historyList.appendChild(empty);
			return;
		}

		// Group sessions by date
		const now = new Date();
		const groups = { 'Today': [], 'Yesterday': [], 'Last 7 Days': [], 'Older': [] };

		sessionsData.forEach(session => {
			const label = session.title || session.cwd || session.sessionId.slice(0, 8);
			const item = { ...session, label };
			groups['Older'].push(item); // Simplified: metadata doesn't include createdAt yet
		});

		Object.entries(groups).forEach(([groupName, sessions]) => {
			if (sessions.length === 0) return;

			const groupEl = document.createElement('div');
			groupEl.className = 'history-group';

			const groupHeader = document.createElement('div');
			groupHeader.className = 'history-group-header';
			groupHeader.textContent = groupName;
			groupEl.appendChild(groupHeader);

			sessions.forEach(session => {
				const itemEl = document.createElement('div');
				itemEl.className = 'history-item';

				const labelEl = document.createElement('span');
				labelEl.className = 'history-item-label';
				labelEl.textContent = session.label;
				labelEl.title = session.cwd;
				labelEl.onclick = () => {
					showChatView();
					vscode.postMessage({ type: 'resumeSession', sessionId: session.sessionId });
				};

				const deleteBtn = document.createElement('button');
				deleteBtn.className = 'history-delete-btn';
				deleteBtn.title = 'Delete session';
				deleteBtn.textContent = '🗑';
				deleteBtn.onclick = (e) => {
					e.stopPropagation();
					vscode.postMessage({ type: 'deleteSession', sessionId: session.sessionId });
				};

				itemEl.appendChild(labelEl);
				itemEl.appendChild(deleteBtn);
				groupEl.appendChild(itemEl);
			});

			historyList.appendChild(groupEl);
		});
	}

	function handleSyncState(message) {
		// Update Mode Selector
		modeSelector.innerHTML = '';
		message.availableModes.forEach(mode => {
			const option = document.createElement('option');
			option.value = mode;
			option.textContent = mode;
			modeSelector.appendChild(option);
		});
		modeSelector.value = message.mode;
		modeSelector.disabled = false;

		// Update Model Selector
		modelSelector.innerHTML = '';
		message.availableModels.forEach(model => {
			const option = document.createElement('option');
			option.value = model;
			option.textContent = model;
			modelSelector.appendChild(option);
		});
		modelSelector.value = message.model;
		modelSelector.disabled = false;
	}

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
		} else if (update.sessionUpdate === 'prompt_response' || update.sessionUpdate === 'done') {
			// Turn is complete — restore the send button
			setProcessing(false);
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

	function handlePlanReview(message) {
		// Remove any existing plan review card
		const existing = document.getElementById('plan-review-card');
		if (existing) existing.remove();

		const card = document.createElement('div');
		card.className = 'plan-review-card';
		card.id = 'plan-review-card';

		const header = document.createElement('div');
		header.className = 'plan-header';
		header.textContent = '📋 Plan Review';

		const body = document.createElement('div');
		body.className = 'plan-body';

		const desc = document.createElement('div');
		desc.className = 'plan-description';
		desc.textContent = message.description || 'The agent has generated an implementation plan. How would you like to proceed?';

		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'plan-actions';

		const proceedBtn = document.createElement('button');
		proceedBtn.className = 'plan-btn proceed-btn';
		proceedBtn.textContent = 'Proceed';
		proceedBtn.onclick = () => {
			vscode.postMessage({ type: 'proceedPlan' });
			card.remove();
		};

		const modifyBtn = document.createElement('button');
		modifyBtn.className = 'plan-btn modify-btn';
		modifyBtn.textContent = 'Modify';
		modifyBtn.onclick = () => {
			vscode.postMessage({ type: 'modifyPlan' });
			card.remove();
		};

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'plan-btn cancel-btn';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.onclick = () => {
			vscode.postMessage({ type: 'cancelPlan' });
			card.remove();
		};

		actionsDiv.appendChild(proceedBtn);
		actionsDiv.appendChild(modifyBtn);
		actionsDiv.appendChild(cancelBtn);

		body.appendChild(desc);
		body.appendChild(actionsDiv);

		card.appendChild(header);
		card.appendChild(body);

		messagesContainer.appendChild(card);
		scrollToBottom();
	}

	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
