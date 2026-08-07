(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');
	const addImageBtn = document.getElementById('add-image-btn');
	const imageUpload = document.getElementById('image-upload');
	const imagePreviewContainer = document.getElementById('image-preview-container');
	
	let pendingImages = [];
	let pendingUserMessageText = null;

	let modelDropdown, modeDropdown, providerDropdown;

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
				document.getElementById('provider-dropdown').classList.add('hidden');
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

		providerDropdown = new CustomDropdown('provider-trigger', 'provider-dropdown', 'provider-trigger-label', (val) => {
			vscode.postMessage({ type: 'setProvider', provider: val });
		});

		modelDropdown = new CustomDropdown('model-trigger', 'model-dropdown', 'model-trigger-label', (val) => {
			vscode.postMessage({ type: 'setModel', model: val });
		});

		document.addEventListener('click', () => {
			document.getElementById('provider-dropdown').classList.add('hidden');
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
			// Fetch sessions from extension host and render immediately
			vscode.postMessage({ type: 'listSessions' });
			renderSessions();
		} else {
			showChatView();
		}
	}

	function showChatView() {
		isHistoryView = false;
		document.getElementById('chat-view').classList.remove('hidden');
		document.getElementById('history-view').classList.add('hidden');
	}

	const sendStopBtn = document.getElementById('send-stop-btn');
	const iconSend = document.getElementById('icon-send');
	const iconStop = document.getElementById('icon-stop');
	const historyList = document.getElementById('history-list');

	let currentTurnEl = null;
	let currentTextEl = null;
	let currentTurnText = '';
	let renderTimeout = null;
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
		chevron: `<svg class="transition-transform duration-200" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
		circle: `<svg class="opacity-50" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle></svg>`,
		arrowRight: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
		edit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`
	};

	function formatRelativeTime(iso) {
		if (!iso) return '';
		const date = new Date(iso);
		if (isNaN(date.getTime())) return '';
		const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
		if (diffMin < 1) return 'Just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		if (diffDay < 7) return `${diffDay}d ago`;
		return date.toLocaleDateString();
	}

	function createMessageFooter(getText, role, sentAt) {
		const footer = document.createElement('div');
		footer.className = 'flex h-5 items-center gap-1.5 mt-1 text-xs text-vscode-fg opacity-60 ' +
			(role === 'user' ? 'self-end' : 'self-start');

		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'flex items-center justify-center bg-transparent border-none cursor-pointer text-vscode-fg opacity-60 hover:opacity-100 p-1 rounded hover:bg-vscode-toolbarHover [&_svg]:mr-0 mb-1';
		btn.title = 'Copy';
		btn.setAttribute('aria-label', 'Copy message');
		btn.innerHTML = ICONS.clipboard;

		let resetTimer = null;
		btn.addEventListener('click', () => {
			const text = getText();
			if (!text) return;
			(async () => {
				if (!navigator.clipboard?.writeText) {
					throw new Error('Clipboard API unavailable');
				}
				await navigator.clipboard.writeText(text);
			})().then(() => {
				btn.innerHTML = ICONS.success;
				btn.title = 'Copied!';
			}).catch(() => {
				btn.innerHTML = ICONS.error;
				btn.title = 'Copy failed';
			}).finally(() => {
				clearTimeout(resetTimer);
				resetTimer = setTimeout(() => {
					btn.innerHTML = ICONS.clipboard;
					btn.title = 'Copy';
				}, 1500);
			});
		});

		const timeEl = document.createElement('span');
		timeEl.className = 'leading-none';
		timeEl.textContent = sentAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});

		if (role === 'user') {
			footer.appendChild(timeEl);
			footer.appendChild(btn);
		} else {
			footer.appendChild(btn);
			footer.appendChild(timeEl);
		}

		return footer;
	}

	// --- Send / Stop toggle logic ---
	function setProcessing(active) {
		isProcessing = active;
		if (!active) {
			// Globally cancel any stuck spinners across all tool cards, 
			// in case multiple aggregators were created in the same session
			const allSpinners = document.querySelectorAll('.tool-status');
			allSpinners.forEach(statusEl => {
				if (statusEl.innerHTML.includes('animate-spin')) {
					statusEl.innerHTML = ICONS.cancelled;
				}
			});

			if (currentAggregator) {
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

	// Image upload logic
	if (addImageBtn && imageUpload) {
		addImageBtn.addEventListener('click', () => {
			if (isHistoryView) {
				showChatView();
			}
			imageUpload.click();
		});
		
		imageUpload.addEventListener('change', (e) => {
			if (e.target.files) {
				processImageFiles(Array.from(e.target.files));
				e.target.value = '';
			}
		});
	}

	chatInput.addEventListener('paste', (e) => {
		if (e.clipboardData && e.clipboardData.items) {
			const files = Array.from(e.clipboardData.items)
				.filter(item => item.type.startsWith('image/'))
				.map(item => item.getAsFile())
				.filter(file => file !== null);
			if (files.length > 0) {
				processImageFiles(files);
				e.preventDefault(); // Only prevent default if we're actually pasting images, allow text
			}
		}
	});

	const MAX_ATTACHMENTS = 10;
	const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
	const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

	function processImageFiles(files) {
		let validFiles = [];
		for (const file of files) {
			if (!SUPPORTED_TYPES.includes(file.type)) {
				vscode.postMessage({ type: 'showError', message: `Unsupported image format: ${file.name}` });
				continue;
			}
			if (file.size > MAX_FILE_SIZE) {
				vscode.postMessage({ type: 'showError', message: `Image exceeds 10 MB: ${file.name}` });
				continue;
			}
			validFiles.push(file);
		}

		if (pendingImages.length + validFiles.length > MAX_ATTACHMENTS) {
			vscode.postMessage({ type: 'showError', message: `Maximum attachment count reached (${MAX_ATTACHMENTS})` });
			validFiles = validFiles.slice(0, MAX_ATTACHMENTS - pendingImages.length);
		}

		if (validFiles.length === 0) return;

		let pendingReads = validFiles.length;
		if (addImageBtn) {
			addImageBtn.disabled = true;
			addImageBtn.classList.add('opacity-50', 'cursor-not-allowed');
		}

		for (const file of validFiles) {
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = e.target.result;
				if (typeof result === 'string') {
					const commaIdx = result.indexOf(',');
					if (commaIdx !== -1) {
						const data = result.substring(commaIdx + 1);
						pendingImages.push({ data, mimeType: file.type });
						renderImagePreviews();
					}
				}
				pendingReads--;
				if (pendingReads === 0 && addImageBtn) {
					addImageBtn.disabled = false;
					addImageBtn.classList.remove('opacity-50', 'cursor-not-allowed');
				}
			};
			reader.onerror = () => {
				pendingReads--;
				if (pendingReads === 0 && addImageBtn) {
					addImageBtn.disabled = false;
					addImageBtn.classList.remove('opacity-50', 'cursor-not-allowed');
				}
			};
			reader.readAsDataURL(file);
		}
	}

	function renderImagePreviews() {
		if (!imagePreviewContainer) return;
		imagePreviewContainer.innerHTML = '';
		pendingImages.forEach((img, idx) => {
			const wrapper = document.createElement('div');
			wrapper.className = 'relative w-12 h-12 rounded overflow-hidden border border-vscode-input-border shrink-0 group';
			
			const imageEl = document.createElement('img');
			// codeql[js/xss] False positive: mimeType is strictly validated and data is base64 encoded
			const src = `data:${img.mimeType};base64,${img.data}`;
			if (src.startsWith('data:image/')) {
				imageEl.src = src;
			}
			imageEl.className = 'w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity';
			imageEl.onclick = () => openImageModal(imageEl.src);
			
			const removeBtn = document.createElement('button');
			removeBtn.className = 'absolute top-0 right-0 bg-black/50 hover:bg-black/80 text-white w-5 h-5 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-bl cursor-pointer border-none outline-none';
			removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
			removeBtn.onclick = (e) => {
				e.stopPropagation();
				pendingImages.splice(idx, 1);
				renderImagePreviews();
			};
			
			wrapper.appendChild(imageEl);
			wrapper.appendChild(removeBtn);
			imagePreviewContainer.appendChild(wrapper);
		});
	}

	const imageModal = document.getElementById('image-modal');
	const modalImage = document.getElementById('modal-image');
	const closeModalBtn = document.getElementById('close-modal-btn');
	
	function openImageModal(src) {
		if (imageModal && modalImage) {
			// Validate src to prevent untrusted URL redirection (CodeQL)
			if (src.startsWith('data:image/')) {
				modalImage.src = src;
				imageModal.classList.remove('hidden');
			}
		}
	}
	
	if (closeModalBtn) {
		closeModalBtn.addEventListener('click', () => {
			imageModal.classList.add('hidden');
		});
	}
	if (imageModal) {
		imageModal.addEventListener('click', (e) => {
			if (e.target === imageModal) {
				imageModal.classList.add('hidden');
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
		if (!text && pendingImages.length === 0) return;

		const imagesToSubmit = pendingImages.length > 0 ? [...pendingImages] : undefined;

		// Send message to extension host
		vscode.postMessage({
			type: 'submitMessage',
			text: text,
			images: imagesToSubmit
		});

		// Clear input
		chatInput.value = '';
		chatInput.style.height = 'auto';
		pendingImages = [];
		renderImagePreviews();

		// Optimistically append user message
		appendMessage(text, 'user', imagesToSubmit);
		pendingUserMessageText = text;

		if (!isProcessing) {
			// Switch to processing state
			setProcessing(true);

			// Reset turn elements so agent starts a fresh block
			currentTurnEl = null;
			currentTextEl = null;
		}
	}

	function appendMessage(content, role, images = undefined) {
		// Remove welcome message and loader if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();
		const loader = document.getElementById('session-loader');
		if (loader) loader.remove();

		const wrapper = document.createElement('div');
		wrapper.className = 'group flex flex-col min-w-0 shrink-0 ' +
			(role === 'user' ? 'self-end items-end max-w-[85%]' : 'self-start items-start max-w-full');

		const msgEl = document.createElement('div');
		msgEl.className = 'leading-snug break-words shrink-0 min-w-0 flex flex-col ' +
			(role === 'user'
				? 'self-end bg-vscode-dropdown-bg text-vscode-dropdown-fg border border-vscode-border px-3 py-2 rounded-lg max-w-[85%]'
				: 'self-start max-w-full');

		if (images && images.length > 0) {
			const imagesContainer = document.createElement('div');
			imagesContainer.className = 'flex flex-wrap gap-2 mb-2';
			images.forEach(img => {
				const imgEl = document.createElement('img');
				// codeql[js/xss] False positive: mimeType is strictly validated and data is base64 encoded
				const src = `data:${img.mimeType};base64,${img.data}`;
				if (src.startsWith('data:image/')) {
					imgEl.src = src;
				}
				imgEl.className = 'w-24 h-24 object-cover rounded cursor-pointer border border-vscode-border hover:opacity-90';
				imgEl.onclick = () => openImageModal(imgEl.src);
				imagesContainer.appendChild(imgEl);
			});
			msgEl.appendChild(imagesContainer);
		}

		if (content) {
			const textContainer = document.createElement('div');
			textContainer.className = 'markdown-body';
	
			// If it's the user, we just render it directly (or we could use marked for them too)
			// Usually users prefer raw text, but let's render markdown for both just in case.
			if (typeof marked !== 'undefined') {
				textContainer.innerHTML = marked.parse(content);
			} else {
				textContainer.textContent = content;
			}
			msgEl.appendChild(textContainer);
		}

		wrapper.appendChild(msgEl);
		wrapper.appendChild(createMessageFooter(() => content, role, new Date()));

		messagesContainer.appendChild(wrapper);
		scrollToBottom();

		if (role === 'agent') {
			currentTurnEl = msgEl;
			currentTextEl = textContainer;
		}
	}

	function appendChunk(textChunk) {
		// Remove welcome message and loader if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();
		const loader = document.getElementById('session-loader');
		if (loader) loader.remove();

		if (!currentTurnEl || !currentTextEl) {
			// First chunk for this turn
			const wrapper = document.createElement('div');
			wrapper.className = 'group flex flex-col min-w-0 self-start items-start max-w-full';

			const msgEl = document.createElement('div');
			msgEl.className = 'message agent min-w-0 w-full';

			const textContainer = document.createElement('div');
			textContainer.className = 'markdown-body leading-snug break-words';
			currentTurnText = textChunk;

			if (typeof marked !== 'undefined') {
				textContainer.innerHTML = marked.parse(currentTurnText);
			} else {
				textContainer.textContent = currentTurnText;
			}

			msgEl.appendChild(textContainer);
			wrapper.appendChild(msgEl);
			wrapper.appendChild(createMessageFooter(() => wrapper.dataset.rawText || '', 'agent', new Date()));
			wrapper.dataset.rawText = currentTurnText;
			messagesContainer.appendChild(wrapper);

			currentTurnEl = msgEl;
			currentTextEl = textContainer;
			scrollToBottom();
		} else {
			// Append to existing turn
			currentTurnText += textChunk;
			if (currentTurnEl.parentElement) {
				currentTurnEl.parentElement.dataset.rawText = currentTurnText;
			}

			if (typeof marked !== 'undefined') {
				if (!renderTimeout) {
					renderTimeout = setTimeout(() => {
						if (currentTextEl) {
							currentTextEl.innerHTML = marked.parse(currentTurnText);
						}
						renderTimeout = null;
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

	// Handle messages from extension.
	// No origin check: this is a VS Code webview, not a browser page. The
	// extension host is the only sender, and chat-panel.html sets
	// `default-src 'none'` - frame-src inherits it, so the webview cannot embed
	// a frame that would have a handle to postMessage into this window.
	// nosemgrep: javascript.browser.security.insufficient-postmessage-origin-validation.insufficient-postmessage-origin-validation
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
				// Session reset (new chat or resume) should return to the active
				// chat view, not leave the panel stuck on the history list.
				showChatView();
				if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
				if (message.isLoading) {
					messagesContainer.innerHTML = `<div id="session-loader" class="flex flex-col items-center justify-center h-full opacity-50 mt-10">${ICONS.pending}<div class="mt-2 text-xs">Loading session...</div></div>`;
				} else {
					messagesContainer.innerHTML = '';
				}
				currentTurnEl = null;
				currentTextEl = null;
				currentTurnText = '';
				if (currentThoughtBox) {
					clearInterval(currentThoughtBox.timer);
					currentThoughtBox = null;
				}
				setProcessing(false);
				break;
			case 'sessionLoaded':
				const loader = document.getElementById('session-loader');
				if (loader) loader.remove();
				scrollToBottom();
				break;
			case 'acpUpdate':
				handleAcpUpdate(message.update);
				break;
			case 'permissionRequested':
				handlePermissionRequested(message.toolCallId, message.toolCall, message.options);
				break;

			case 'syncState':
				handleSyncState(message);
				break;
			case 'updateSessions':
				sessionsData = message.sessions || [];
				renderSessions(); // Always update so list is ready when history opens
				break;
		}
	});



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

		// Group sessions by last-used date
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
		const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 86400000);
		const groups = { 'Today': [], 'Yesterday': [], 'Last 7 Days': [], 'Older': [] };

		sessionsData.slice().reverse().forEach(session => {
			const label = session.title || session.cwd || session.sessionId.slice(0, 8);
			const item = { ...session, label };
			const updated = session.updatedAt ? new Date(session.updatedAt) : null;

			if (!updated || isNaN(updated.getTime())) {
				groups['Older'].push(item);
			} else if (updated >= startOfToday) {
				groups['Today'].push(item);
			} else if (updated >= startOfYesterday) {
				groups['Yesterday'].push(item);
			} else if (updated >= sevenDaysAgo) {
				groups['Last 7 Days'].push(item);
			} else {
				groups['Older'].push(item);
			}
		});

		Object.entries(groups).forEach(([groupName, sessions]) => {
			if (sessions.length === 0) return;

			const groupEl = document.createElement('div');
			groupEl.className = 'mb-1';

			if (groupName !== 'Older') {
				const groupHeader = document.createElement('div');
				groupHeader.className = 'px-4 py-1.5 text-[0.78em] font-semibold uppercase tracking-[0.06em] opacity-50';
				groupHeader.textContent = groupName;
				groupEl.appendChild(groupHeader);
			}

			sessions.forEach(session => {
				const itemEl = document.createElement('div');
				itemEl.className = 'flex flex-col px-4 py-1.5 cursor-pointer gap-0.5 rounded mx-1 transition-colors hover:bg-vscode-list-hover group';
				itemEl.onclick = () => {
					showChatView();
					vscode.postMessage({ type: 'resumeSession', sessionId: session.sessionId });
				};

				const topRow = document.createElement('div');
				topRow.className = 'flex items-center gap-2';

				const labelWrap = document.createElement('div');
				labelWrap.className = 'flex-1 min-w-0';

				const labelEl = document.createElement('span');
				labelEl.className = 'block overflow-hidden text-ellipsis whitespace-nowrap text-[0.9em]';
				labelEl.textContent = session.label;
				labelEl.title = session.cwd;
				labelWrap.appendChild(labelEl);

				const actions = document.createElement('div');
				actions.className = 'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0';

				const editBtn = document.createElement('button');
				editBtn.type = 'button';
				editBtn.className = 'bg-transparent border-none cursor-pointer text-vscode-fg p-1 flex items-center justify-center hover:bg-vscode-toolbarHover rounded';
				editBtn.title = 'Rename Session';
				editBtn.setAttribute('aria-label', 'Rename session');
				editBtn.innerHTML = ICONS.edit;
				editBtn.onclick = (e) => {
					e.stopPropagation();

					const input = document.createElement('input');
					input.type = 'text';
					input.value = session.label;
					input.className = 'block w-full bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-focus rounded px-1 py-0.5 text-[0.9em]';

					const finish = (commit) => {
						if (input.parentElement !== labelWrap) return; // already finished
						labelWrap.replaceChild(labelEl, input);
						if (commit) {
							const newTitle = input.value.trim();
							if (newTitle && newTitle !== session.label) {
								session.label = newTitle;
								labelEl.textContent = newTitle;
								vscode.postMessage({ type: 'renameSession', sessionId: session.sessionId, title: newTitle });
							}
						}
					};

					input.onclick = (ev) => ev.stopPropagation();
					input.onkeydown = (ev) => {
						ev.stopPropagation();
						if (ev.key === 'Enter') finish(true);
						else if (ev.key === 'Escape') finish(false);
					};
					input.onblur = () => finish(true);

					labelWrap.replaceChild(input, labelEl);
					input.focus();
					input.select();
				};

				const deleteBtn = document.createElement('button');
				deleteBtn.type = 'button';
				deleteBtn.className = 'bg-transparent border-none cursor-pointer text-vscode-fg p-1 flex items-center justify-center hover:bg-vscode-toolbarHover rounded';
				deleteBtn.title = 'Delete Session';
				deleteBtn.setAttribute('aria-label', 'Delete session');
				deleteBtn.innerHTML = ICONS.trash;
				deleteBtn.onclick = (e) => {
					e.stopPropagation();
					vscode.postMessage({ type: 'deleteSession', sessionId: session.sessionId });
				};

				actions.appendChild(editBtn);
				actions.appendChild(deleteBtn);
				topRow.appendChild(labelWrap);
				topRow.appendChild(actions);
				itemEl.appendChild(topRow);

				const relativeTime = formatRelativeTime(session.updatedAt);
				if (relativeTime) {
					const lastUsedEl = document.createElement('span');
					lastUsedEl.className = 'text-[0.75em] opacity-50';
					lastUsedEl.textContent = relativeTime;
					itemEl.appendChild(lastUsedEl);
				}

				groupEl.appendChild(itemEl);
			});

			historyList.appendChild(groupEl);
		});
	}

	function handleSyncState(message) {
		if (providerDropdown) providerDropdown.setOptions(message.availableProviders || [], message.provider);
		if (modeDropdown) modeDropdown.setOptions(message.availableModes, message.mode);
		if (modelDropdown) modelDropdown.setOptions(message.availableModels, message.model);
	}

	// Close the current streamed-text block: flush any pending throttled
	// render, then reset so the next agent_message_chunk starts a fresh
	// markdown block. Called whenever another element (tool card, thought
	// box, user message) is inserted - without this, text streamed after a
	// tool call is appended to the block ABOVE the card, fusing pre-tool
	// and post-tool output into one paragraph.
	function endCurrentTextBlock() {
		if (renderTimeout) {
			clearTimeout(renderTimeout);
			renderTimeout = null;
			if (currentTextEl && typeof marked !== 'undefined') {
				currentTextEl.innerHTML = marked.parse(currentTurnText);
			}
		}
		currentTurnEl = null;
		currentTextEl = null;
		currentTurnText = '';
	}

	function handleAcpUpdate(payload) {
		if (!payload) return;
		const update = payload.update ? payload.update : payload;

		if (update.sessionUpdate === 'user_message_chunk') {
			if (update.content) {
				endCurrentTextBlock();
				if (update.content.text) {
					if (pendingUserMessageText === update.content.text) {
						pendingUserMessageText = null;
					} else {
						appendMessage(update.content.text, 'user');
					}
				}
			}
		} else if (update.sessionUpdate === 'agent_message_chunk') {
			if (currentThoughtBox) {
				currentThoughtBox.finish();
				currentThoughtBox = null;
			}
			if (update.content && update.content.text) {
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'agent_thought_chunk') {
			if (!currentThoughtBox) {
				endCurrentTextBlock();
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
		} else if (update.sessionUpdate === 'plan') {
			handlePlanUpdate(update);
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
			this.renderTimeout = null;

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
				if (!this.renderTimeout) {
					this.renderTimeout = setTimeout(() => {
						this.body.innerHTML = marked.parse(this.text);
						this.renderTimeout = null;
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
			if (this.renderTimeout) {
				clearTimeout(this.renderTimeout);
				this.renderTimeout = null;
			}
			if (typeof marked !== 'undefined') {
				this.body.innerHTML = marked.parse(this.text);
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
				const statusEl = item.querySelector('.tool-status');
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
				item.className = 'px-3 py-1.5 border-t border-vscode-widget-border flex flex-col gap-2 text-[0.85em] font-vscode first:border-t-0';
				item.id = `tool-card-${toolCallId}`; // So permissions can find it

				const headerRow = document.createElement('div');
				headerRow.className = 'flex items-start gap-2 w-full';

				const status = document.createElement('span');
				status.className = 'tool-status flex items-center justify-center mt-0.5 shrink-0';
				status.innerHTML = ICONS.pending;

				const label = document.createElement('span');
				label.className = 'tool-label flex-1 break-words leading-relaxed';
				label.textContent = update.title || update.name || 'Tool Call';

				headerRow.appendChild(status);
				headerRow.appendChild(label);
				item.appendChild(headerRow);
				
				this.body.appendChild(item);
				this.toolItems.set(toolCallId, item);

			} else {
				if (update.title) {
					const labelEl = item.querySelector('.tool-label');
					if (labelEl) labelEl.textContent = update.title;
				}
			}

			const statusEl = item.querySelector('.tool-status');
			if (statusEl) {
				if (update.status === 'success' || update.status === 'completed') {
					statusEl.innerHTML = ICONS.success;
				} else if (
					update.status === 'cancelled' ||
					update.status === 'denied' ||
					(update.status === 'failed' && update.rawOutput && typeof update.rawOutput === 'string' && (update.rawOutput.includes('AbortError') || update.rawOutput.includes('cancelled')))
				) {
					statusEl.innerHTML = ICONS.cancelled;
				} else if (update.status === 'error' || update.status === 'failed') {
					statusEl.innerHTML = ICONS.error;
				} else {
					statusEl.innerHTML = ICONS.pending;
				}
			}

			scrollToBottom();
		}
	}

	// Render the agent's task list (ACP `plan` updates, emitted by the server
	// when the write_tasks tool runs) as a live checklist card. Each update
	// carries the complete replacement list, so the card is rebuilt in place.
	function handlePlanUpdate(update) {
		const entries = Array.isArray(update.entries) ? update.entries : [];
		let card = document.getElementById('plan-card');

		if (entries.length === 0) {
			if (card) card.remove();
			return;
		}

		if (!card) {
			endCurrentTextBlock();
			card = document.createElement('div');
			card.id = 'plan-card';
			card.className = 'my-3 border border-vscode-widget-border rounded bg-vscode-widget-bg overflow-hidden shrink-0';

			const header = document.createElement('div');
			header.className = 'px-3 py-2 flex items-center bg-vscode-widget-header border-b border-vscode-widget-border gap-2';

			const title = document.createElement('span');
			title.className = 'font-vscode text-[0.9em] opacity-80';
			title.textContent = 'Tasks';

			const progress = document.createElement('span');
			progress.id = 'plan-progress';
			progress.className = 'ml-auto font-vscode text-[0.8em] opacity-60';

			header.appendChild(title);
			header.appendChild(progress);
			card.appendChild(header);

			const body = document.createElement('div');
			body.id = 'plan-body';
			body.className = 'flex flex-col';
			card.appendChild(body);

			messagesContainer.appendChild(card);
			scrollToBottom();
		}

		const body = card.querySelector('#plan-body');
		body.innerHTML = '';

		let done = 0;
		for (const entry of entries) {
			if (entry.status === 'completed') done++;

			const row = document.createElement('div');
			row.className = 'px-3 py-1.5 border-t border-vscode-widget-border first:border-t-0 flex items-start gap-2 text-[0.85em] font-vscode';

			const icon = document.createElement('span');
			icon.className = 'mt-0.5 shrink-0 flex items-center justify-center';
			if (entry.status === 'completed') icon.innerHTML = ICONS.success;
			else if (entry.status === 'in_progress') icon.innerHTML = ICONS.arrowRight;
			else icon.innerHTML = ICONS.circle;

			const label = document.createElement('span');
			label.className = 'flex-1 break-words leading-relaxed' +
				(entry.status === 'completed' ? ' line-through opacity-60' : '') +
				(entry.status === 'in_progress' ? ' font-semibold' : '');
			label.textContent = entry.content || '';

			row.appendChild(icon);
			row.appendChild(label);
			body.appendChild(row);
		}

		const progressEl = card.querySelector('#plan-progress');
		if (progressEl) progressEl.textContent = `${done}/${entries.length}`;
	}

	function handleToolCallUpdate(update) {
		const toolCallId = update.toolCallId || (update.toolCall && update.toolCall.toolCallId);
		if (!toolCallId) return;

		// A new card is about to be inserted below the current text block -
		// close the block so any text streamed after the tool starts fresh
		// below the card instead of appending to the paragraph above it.
		if (!document.getElementById(`tool-card-${toolCallId}`)) {
			endCurrentTextBlock();
		}

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

	function handlePermissionRequested(toolCallId, toolCall, options) {
		const card = document.getElementById(`tool-card-${toolCallId}`);
		if (!card) return;

		// Check if actions already exist
		if (card.querySelector('.tool-actions')) return;

		const actionsDiv = document.createElement('div');
		actionsDiv.className = 'tool-actions';

		if (options && Array.isArray(options) && options.length > 0) {
			// This is an ask_user prompt — render a proper question card
			actionsDiv.className = 'tool-actions px-3 py-3 bg-vscode-widget-header border-t border-vscode-widget-border flex flex-col gap-2';


			// Stacked full-width buttons, one per option
			const btnGroup = document.createElement('div');
			btnGroup.className = 'flex flex-col gap-1.5 w-full';
			for (const opt of options) {
				const btn = document.createElement('button');
				btn.className = 'w-full text-left bg-transparent border border-vscode-button-secondary text-vscode-fg hover:bg-vscode-button-secondaryHover rounded px-3 py-1.5 cursor-pointer font-vscode text-[0.9em] transition-colors';
				btn.textContent = opt.name;
				btn.onclick = () => {
					vscode.postMessage({ type: 'resolveTool', toolCallId, optionId: opt.optionId });
					actionsDiv.remove();
				};
				btnGroup.appendChild(btn);
			}
			actionsDiv.appendChild(btnGroup);
		} else {
			// Standard tool approval — Approve / Deny side by side
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
		}

		card.appendChild(actionsDiv);
		scrollToBottom();
	}


	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
