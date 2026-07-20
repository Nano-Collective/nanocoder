(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');

	let modelDropdown, modeDropdown;

	function initDropdowns() {
		class CustomDropdown {
			constructor(triggerId, dropdownId, labelId, onChange) {
				this.trigger = document.getElementById(triggerId);
				this.dropdown = document.getElementById(dropdownId);
				this.label = document.getElementById(labelId);
				this.onChange = onChange;
				this.value = '';

				this.trigger.addEventListener('click', (e) => {
					e.stopPropagation();
					this.toggle();
				});
			}

			toggle() {
				const isHidden = this.dropdown.classList.contains('hidden');
				// Close all dropdowns
				document.getElementById('model-dropdown').classList.add('hidden');
				document.getElementById('mode-dropdown').classList.add('hidden');

				if (isHidden) {
					this.dropdown.classList.remove('hidden');
				}
			}

			setOptions(options, selectedValue) {
				this.dropdown.innerHTML = '';
				this.trigger.disabled = options.length === 0;

				options.forEach(opt => {
					const item = document.createElement('div');
					item.className = 'px-3 py-1.5 cursor-pointer hover:bg-vscode-list-hover text-[0.9em] transition-colors';
					if (opt === selectedValue) {
						item.classList.add('bg-vscode-list-active', 'text-vscode-list-activeFg');
					} else {
						item.classList.add('text-vscode-dropdown-foreground');
					}
					item.textContent = opt;
					item.addEventListener('click', (e) => {
						e.stopPropagation();
						this.setValue(opt);
						this.dropdown.classList.add('hidden');
						this.onChange(opt);
					});
					this.dropdown.appendChild(item);
				});

				this.setValue(selectedValue || (options.length > 0 ? options[0] : ''));
			}

			setValue(value) {
				this.value = value;
				// Clean up the label for better display
				let displayValue = value;
				if (displayValue.includes('/')) {
					displayValue = displayValue.split('/').pop();
				}
				this.label.textContent = displayValue || 'Loading...';
			}
		}

		modeDropdown = new CustomDropdown('mode-trigger', 'mode-dropdown', 'mode-trigger-label', (val) => {
			vscode.postMessage({ type: 'setMode', mode: val });
		});

		modelDropdown = new CustomDropdown('model-trigger', 'model-dropdown', 'model-trigger-label', (val) => {
			vscode.postMessage({ type: 'setModel', model: val });
		});

		document.addEventListener('click', () => {
			document.getElementById('model-dropdown').classList.add('hidden');
			document.getElementById('mode-dropdown').classList.add('hidden');
		});
	}

	initDropdowns();
	function toggleHistoryView() {
		isHistoryView = !isHistoryView;
		if (isHistoryView) {
			document.getElementById('chat-view').classList.add('hidden');
			document.getElementById('history-view').classList.remove('hidden');
		} else {
			document.getElementById('chat-view').classList.remove('hidden');
			document.getElementById('history-view').classList.add('hidden');
		}
	}
	const historyBtn = document.getElementById('history-btn');
	const chatView = document.getElementById('chat-view');
	const historyView = document.getElementById('history-view');
	const historyList = document.getElementById('history-list');
	const sendStopBtn = document.getElementById('send-stop-btn');
	const iconSend = document.getElementById('icon-send');
	const iconStop = document.getElementById('icon-stop');

	let currentTurnEl = null;
	let currentTextEl = null;
	let currentTurnText = '';
	let renderFrame = null;
	let sessionsData = [];
	let isHistoryView = false;
	let isProcessing = false;
	let currentAggregator = null;
	let currentThoughtBox = null;

	// Premium SVG Icons (Feather Icons)
	const ICONS = {
		trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
		pending: `<svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`,
		success: `<svg class="text-[#89d185]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
		error: `<svg class="text-[#f14c4c]" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
		cancelled: `<svg class="text-[#cccccc] opacity-80" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`,
		clipboard: `<svg class="mr-1.5" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`,
		chevron: `<svg class="transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
	};

	// --- Send / Stop toggle logic ---
	function setProcessing(active) {
		isProcessing = active;
		if (!active) {
			if (currentAggregator) {
				currentAggregator.cancelPending();
				currentAggregator.close();
			}
			currentAggregator = null;
		}
		if (sendStopBtn) {
			sendStopBtn.title = active ? 'Stop (cancel)' : 'Send (Enter)';
			sendStopBtn.classList.toggle('is-processing', active);
		}
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
	chatInput.addEventListener('input', function () {
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

		if (!isProcessing) {
			// Switch to processing state
			setProcessing(true);

			// Reset turn elements so agent starts a fresh block
			currentTurnEl = null;
			currentTextEl = null;
		}
	}

	function appendMessage(content, role) {
		// Remove welcome message if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();

		const msgEl = document.createElement('div');
		msgEl.className = 'leading-snug break-words shrink-0 min-w-0 ' +
			(role === 'user'
				? 'self-end bg-vscode-dropdown-bg text-vscode-dropdown-fg border border-vscode-border px-3 py-2 rounded-lg max-w-[85%]'
				: 'self-start max-w-full');

		const textContainer = document.createElement('div');
		textContainer.className = 'markdown-body';

		// If it's the user, we just render it directly (or we could use marked for them too)
		// Usually users prefer raw text, but let's render markdown for both just in case.
		if (typeof marked !== 'undefined') {
			textContainer.innerHTML = marked.parse(content);
		} else {
			textContainer.textContent = content;
		} // Phase 3: plain text for now, but incrementally updateable
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
			msgEl.className = 'message agent min-w-0';

			const textContainer = document.createElement('div');
			textContainer.className = 'markdown-body leading-snug break-words';
			currentTurnText = textChunk;

			if (typeof marked !== 'undefined') {
				textContainer.innerHTML = marked.parse(currentTurnText);
			} else {
				textContainer.textContent = currentTurnText;
			}

			msgEl.appendChild(textContainer);
			messagesContainer.appendChild(msgEl);

			currentTurnEl = msgEl;
			currentTextEl = textContainer;
		} else {
			// Append to existing turn
			currentTurnText += textChunk;

			if (typeof marked !== 'undefined') {
				if (!renderFrame) {
					renderFrame = true;
					setTimeout(() => {
						if (currentTextEl) {
							currentTextEl.innerHTML = marked.parse(currentTurnText);
						}
						renderFrame = false;
						scrollToBottom();
					}, 50); // 50ms throttle (20 updates/sec max) for smoother rendering
				}
			} else {
				currentTextEl.textContent += textChunk; // Fallback
				scrollToBottom();
			}
		}

		if (typeof marked === 'undefined') {
			scrollToBottom();
		}
	}

	function scrollToBottom() {
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	// Handle messages from extension
	window.addEventListener('message', event => {
		const message = event.data;

		switch (message.type) {
			case 'toggleHistory':
				toggleHistoryView();
				break;
			case 'appendMessage':
				appendMessage(message.content, 'agent');
				break;
			case 'clear':
				if (renderFrame) { cancelAnimationFrame(renderFrame); renderFrame = null; }
				messagesContainer.innerHTML = '';
				currentTurnEl = null;
				currentTextEl = null;
				currentTurnText = '';
				if (currentThoughtBox) {
					clearInterval(currentThoughtBox.timer);
					currentThoughtBox = null;
				}
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
		if (historyBtn) historyBtn.classList.remove('is-history-open');
	}

	function showHistoryView() {
		isHistoryView = true;
		if (chatView) chatView.style.display = 'none';
		if (historyView) historyView.style.display = '';
		if (historyBtn) historyBtn.title = 'Back to chat';
		if (historyBtn) historyBtn.classList.add('is-history-open');
		// Always refresh the list when opening history
		vscode.postMessage({ type: 'listSessions' });
		renderSessions();
	}

	function renderSessions() {
		if (!historyList) return;
		historyList.innerHTML = '';

		if (sessionsData.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'px-4 py-5 opacity-50 text-[0.9em] text-center';
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
			groupEl.className = 'mb-1';

			const groupHeader = document.createElement('div');
			groupHeader.className = 'px-4 py-1.5 text-[0.78em] font-semibold uppercase tracking-[0.06em] opacity-50';
			groupHeader.textContent = groupName;
			groupEl.appendChild(groupHeader);

			sessions.forEach(session => {
				const itemEl = document.createElement('div');
				itemEl.className = 'flex items-center px-4 py-1.5 cursor-pointer gap-2 rounded mx-1 transition-colors hover:bg-vscode-list-hover group';

				const labelEl = document.createElement('span');
				labelEl.className = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.9em]';
				labelEl.textContent = session.label;
				labelEl.title = session.cwd;
				labelEl.onclick = () => {
					showChatView();
					vscode.postMessage({ type: 'resumeSession', sessionId: session.sessionId });
				};

				const deleteBtn = document.createElement('button');
				deleteBtn.className = 'bg-transparent border-none cursor-pointer text-vscode-fg opacity-0 group-hover:opacity-100 transition-opacity p-1 flex items-center justify-center hover:bg-vscode-toolbarHover rounded';
				deleteBtn.title = 'Delete Session';
				deleteBtn.innerHTML = ICONS.trash;
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
		if (modeDropdown) modeDropdown.setOptions(message.availableModes, message.mode);
		if (modelDropdown) modelDropdown.setOptions(message.availableModels, message.model);
	}

	function handleAcpUpdate(payload) {
		if (!payload) return;
		const update = payload.update ? payload.update : payload;

		if (update.sessionUpdate === 'agent_message_chunk') {
			if (currentThoughtBox) {
				currentThoughtBox.finish();
				currentThoughtBox = null;
			}
			if (update.content && update.content.text) {
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'agent_thought_chunk') {
			if (!currentThoughtBox) {
				currentThoughtBox = new ThoughtAggregator();
			}
			if (update.content && update.content.text) {
				currentThoughtBox.append(update.content.text);
			}
		} else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
			if (currentThoughtBox) {
				currentThoughtBox.finish();
				currentThoughtBox = null;
			}
			handleToolCallUpdate(update);
		} else if (update.sessionUpdate === 'prompt_response' || update.sessionUpdate === 'done') {
			if (currentThoughtBox) {
				currentThoughtBox.finish();
				currentThoughtBox = null;
			}
			// Turn is complete — restore the send button
			setProcessing(false);
		}
	}

	class ThoughtAggregator {
		constructor() {
			this.el = document.createElement('div');
			this.el.className = 'my-2 flex flex-col shrink-0';

			this.header = document.createElement('div');
			this.header.className = 'flex items-center gap-1.5 cursor-pointer opacity-70 text-vscode-fg hover:opacity-100 transition-opacity select-none w-fit';
			this.header.onclick = () => this.toggle();

			this.title = document.createElement('span');
			this.title.className = 'font-vscode text-[0.85em] font-medium';
			this.title.textContent = 'Thinking...';

			this.chevron = document.createElement('span');
			this.chevron.className = 'flex items-center justify-center opacity-70';
			this.chevron.innerHTML = ICONS.chevron;
			this.chevron.style.transform = 'rotate(0deg)'; // open by default

			this.header.appendChild(this.title);
			this.header.appendChild(this.chevron);
			this.el.appendChild(this.header);

			this.body = document.createElement('div');
			this.body.className = 'mt-2 pl-3 border-l-[3px] border-vscode-border opacity-70 text-vscode-fg markdown-body text-[0.95em]';
			this.el.appendChild(this.body);

			this.isOpen = true;
			this.startTime = Date.now();
			this.text = '';
			this.renderFrame = null;

			this.timer = setInterval(() => this.updateTimer(), 1000);

			messagesContainer.appendChild(this.el);
			scrollToBottom();
		}

		updateTimer() {
			const seconds = Math.floor((Date.now() - this.startTime) / 1000);
			this.title.textContent = `Thinking for ${seconds}s`;
		}

		toggle(force) {
			this.isOpen = force !== undefined ? force : !this.isOpen;
			this.body.style.display = this.isOpen ? 'block' : 'none';

			const svg = this.chevron.querySelector('svg');
			if (svg) {
				svg.style.transform = this.isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
			}
		}

		append(chunk) {
			this.text += chunk;
			if (typeof marked !== 'undefined') {
				if (!this.renderFrame) {
					this.renderFrame = true;
					setTimeout(() => {
						this.body.innerHTML = marked.parse(this.text);
						this.renderFrame = false;
						scrollToBottom();
					}, 50);
				}
			} else {
				this.body.textContent = this.text;
				scrollToBottom();
			}
		}

		finish() {
			clearInterval(this.timer);
			if (this.renderFrame) {
				this.renderFrame = false;
				if (typeof marked !== 'undefined') {
					this.body.innerHTML = marked.parse(this.text);
				}
			}
			const seconds = Math.floor((Date.now() - this.startTime) / 1000);
			this.title.textContent = `Thought for ${seconds}s`;
			this.toggle(false); // Auto-shrink when done!
		}
	}

	class ToolAggregator {
		constructor() {
			this.el = document.createElement('div');
			this.el.className = 'my-3 border border-vscode-widget-border rounded bg-vscode-widget-bg overflow-hidden shrink-0 tool-aggregator';

			this.header = document.createElement('div');
			this.header.className = 'px-3 py-2 flex items-center bg-vscode-widget-header border-b border-vscode-widget-border gap-2 cursor-pointer select-none';
			this.header.onclick = () => this.toggle();

			this.title = document.createElement('span');
			this.title.className = 'font-vscode text-[0.9em] opacity-80';
			this.title.textContent = 'Exploring...';

			this.chevron = document.createElement('span');
			this.chevron.className = 'ml-auto flex items-center justify-center';
			this.chevron.innerHTML = ICONS.chevron;

			this.header.appendChild(this.title);
			this.header.appendChild(this.chevron);
			this.el.appendChild(this.header);

			this.body = document.createElement('div');
			this.body.className = 'flex flex-col';
			this.el.appendChild(this.body);

			this.isOpen = true;
			this.toolCount = 0;
			this.toolItems = new Map();

			messagesContainer.appendChild(this.el);
		}

		toggle() {
			this.isOpen = !this.isOpen;
			this.body.style.display = this.isOpen ? '' : 'none';

			const svg = this.chevron.querySelector('svg');
			if (svg) {
				svg.style.transform = this.isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
			}
		}

		close() {
			this.toggle(false);
		}

		cancelPending() {
			for (const [id, item] of this.toolItems.entries()) {
				const statusEl = item.querySelector('.ml-auto');
				if (statusEl && statusEl.innerHTML.includes('animate-spin')) {
					statusEl.innerHTML = ICONS.cancelled;
				}
			}
		}

		updateTitle() {
			this.title.textContent = `Exploring ${this.toolCount} tools...`;
		}

		addOrUpdateTool(toolCallId, update) {
			let item = this.toolItems.get(toolCallId);
			if (!item) {
				this.toolCount++;
				this.updateTitle();

				item = document.createElement('div');
				item.className = 'px-3 py-1.5 border-t border-vscode-widget-border flex items-center gap-2 text-[0.85em] font-vscode first:border-t-0';
				item.id = `tool-card-${toolCallId}`; // So permissions can find it

				const status = document.createElement('span');
				status.className = 'ml-auto flex items-center justify-center';
				status.innerHTML = ICONS.pending;

				const label = document.createElement('span');
				label.className = 'truncate flex-1';
				label.textContent = update.title || update.name || 'Tool Call';

				item.appendChild(status);
				item.appendChild(label);
				this.body.appendChild(item);
				this.toolItems.set(toolCallId, item);
			} else {
				const statusEl = item.querySelector('.ml-auto');
				if (statusEl) {
					if (update.status === 'success' || update.status === 'completed') statusEl.innerHTML = ICONS.success;
					else if (update.status === 'error') statusEl.innerHTML = ICONS.error;
					else if (update.status === 'cancelled' || update.status === 'denied') statusEl.innerHTML = ICONS.cancelled;
				}
			}
			scrollToBottom();
		}
	}

	function handleToolCallUpdate(update) {
		const toolCallId = update.toolCallId || (update.toolCall && update.toolCall.toolCallId);
		if (!toolCallId) return;

		const toolName = update.name || (update.toolCall && update.toolCall.name) || '';
		const isMutating = ['replace_file_content', 'multi_replace_file_content', 'write_to_file', 'write_file'].includes(toolName);

		if (isMutating) {
			let card = document.getElementById(`tool-card-${toolCallId}`);
			if (!card) {
				card = createEditCard(toolCallId, update);
				messagesContainer.appendChild(card);
				scrollToBottom();
			} else {
				updateEditCard(card, update);
			}
		} else {
			if (!currentAggregator) {
				currentAggregator = new ToolAggregator();
			}
			currentAggregator.addOrUpdateTool(toolCallId, update);
		}
	}

	function extractFileName(title) {
		if (!title) return 'File';
		const parts = title.split('/');
		let last = parts[parts.length - 1];
		last = last.split('\\').pop();
		return last.replace(/['"]+$/g, '').trim();
	}

	function getFileColor(filename) {
		const ext = filename.split('.').pop().toLowerCase();
		if (['ts', 'tsx'].includes(ext)) return 'text-[#3178C6]';
		if (['js', 'jsx'].includes(ext)) return 'text-[#F1E05A]';
		if (['css', 'scss'].includes(ext)) return 'text-[#563D7C]';
		if (['json'].includes(ext)) return 'text-[#CB3837]';
		if (['html'].includes(ext)) return 'text-[#E34F26]';
		return 'text-vscode-symbolIcon-fileForeground';
	}

	function createEditCard(toolCallId, update) {
		const card = document.createElement('div');
		card.className = 'my-2 flex items-center justify-between px-3 py-2 border border-vscode-widget-border rounded bg-vscode-editor-bg cursor-pointer hover:bg-vscode-list-hover group tool-card';
		card.id = `tool-card-${toolCallId}`;
		card.onclick = () => vscode.postMessage({ type: 'showDiff', toolCallId });

		const left = document.createElement('div');
		left.className = 'flex items-center gap-2 font-vscode text-[0.9em]';

		const status = document.createElement('span');
		status.className = 'ml-auto flex items-center justify-center';
		status.innerHTML = ICONS.pending;

		const label = document.createElement('span');
		label.className = 'flex items-center gap-1.5';

		const filename = extractFileName(update.title || update.name);
		const fileColor = getFileColor(filename);

		const actionText = document.createElement('span');
		actionText.textContent = 'Edited';
		actionText.className = 'opacity-80';

		const nameText = document.createElement('span');
		nameText.className = `font-semibold ${fileColor}`;
		nameText.textContent = filename;

		label.appendChild(actionText);
		label.appendChild(nameText);

		left.appendChild(status);
		left.appendChild(label);
		card.appendChild(left);

		const right = document.createElement('div');
		right.className = 'flex items-center gap-2';

		const hoverBtn = document.createElement('span');
		hoverBtn.className = 'opacity-0 group-hover:opacity-100 transition-opacity bg-vscode-button-secondary text-vscode-fg px-2 py-0.5 rounded text-[0.85em]';
		hoverBtn.textContent = 'Open Diff';

		right.appendChild(hoverBtn);
		card.appendChild(right);

		return card;
	}

	function updateEditCard(el, update) {
		const statusEl = el.querySelector('.ml-auto');
		if (statusEl) {
			if (update.status === 'success' || update.status === 'completed') statusEl.innerHTML = ICONS.success;
			else if (update.status === 'error') statusEl.innerHTML = ICONS.error;
			else if (update.status === 'cancelled' || update.status === 'denied') statusEl.innerHTML = ICONS.cancelled;
		}
		if (update.status === 'success' || update.status === 'completed' || update.status === 'error' || update.status === 'cancelled' || update.status === 'denied') {
			const actions = el.querySelector('.tool-actions');
			if (actions) actions.remove();
		}
	}

	function handlePermissionRequested(toolCallId, toolCall) {
		const card = document.getElementById(`tool-card-${toolCallId}`);
		if (!card) return;

		// Check if actions already exist
		if (card.querySelector('.tool-actions')) return;

		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'px-3 py-2 bg-vscode-widget-header border-t border-vscode-widget-border flex justify-end gap-2 tool-actions';

		const approveBtn = document.createElement('button');
		approveBtn.className = 'border-none rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.9em] transition-colors bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover';
		approveBtn.textContent = 'Approve';
		approveBtn.onclick = () => {
			vscode.postMessage({ type: 'approveTool', toolCallId });
			actionsDiv.remove();
		};

		const denyBtn = document.createElement('button');
		denyBtn.className = 'bg-transparent border border-vscode-button-secondary text-vscode-fg hover:bg-vscode-button-secondaryHover rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.9em] transition-colors';
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
		card.className = 'my-4 border-2 border-vscode-button-bg rounded bg-vscode-widget-bg overflow-hidden shrink-0 shadow-md';
		card.id = 'plan-review-card';

		const header = document.createElement('div');
		header.className = 'font-vscode font-semibold mb-3 flex items-center px-3 py-2 bg-vscode-button-bg text-vscode-button-fg text-[0.95em]';
		header.innerHTML = ICONS.clipboard + ' Plan Review';

		const body = document.createElement('div');
		body.className = 'px-3 py-3 flex flex-col gap-3';

		const desc = document.createElement('div');
		desc.className = 'text-[0.9em] leading-snug opacity-90';
		desc.textContent = message.description || 'The agent has generated an implementation plan. How would you like to proceed?';

		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'flex flex-col gap-2';

		const proceedBtn = document.createElement('button');
		proceedBtn.className = 'border-none rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.95em] transition-colors text-center w-full bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover font-semibold';
		proceedBtn.textContent = 'Proceed';
		proceedBtn.onclick = () => {
			vscode.postMessage({ type: 'proceedPlan' });
			card.remove();
		};

		const modifyBtn = document.createElement('button');
		modifyBtn.className = 'border-none rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.95em] transition-colors text-center w-full bg-vscode-button-secondary text-vscode-fg hover:bg-vscode-button-secondaryHover';
		modifyBtn.textContent = 'Modify';
		modifyBtn.onclick = () => {
			vscode.postMessage({ type: 'modifyPlan' });
			card.remove();
		};

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'bg-transparent border border-vscode-button-secondary rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.95em] transition-colors text-center w-full text-vscode-fg hover:bg-vscode-button-secondaryHover';
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
