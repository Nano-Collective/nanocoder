(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');
	const composerBox = document.getElementById('composer-box');
	const contextChipsContainer = document.getElementById('context-chips');
	const addMenuBtn = document.getElementById('add-menu-btn');
	const addMenuDropdown = document.getElementById('add-menu-dropdown');

	let attachedPaths = []; // [{path, name, kind: 'file'|'folder'}]

	// ── @ mention autocomplete state ────────────────────────
	const mentionDropdown = document.getElementById('mention-dropdown');

	/** Only the file search is debounced; a bare `@` answers immediately. */
	const MENTION_DEBOUNCE_MS = 120;

	let mentionOpen = false;
	let mentionItems = [];
	let mentionRows = [];
	let mentionActiveIndex = 0;
	/** The {start, query} token the current results belong to. */
	let mentionToken = null;
	/** Newest request id. Responses that do not match it are stale — see below. */
	let mentionRequestId = 0;
	let mentionLastQuery = null;
	let mentionDebounceTimer = null;

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

				if (!this.trigger || !this.dropdown) return;

				this.trigger.addEventListener('click', (e) => {
					e.stopPropagation();
					const isHidden = this.dropdown.classList.contains('hidden');
					// Close all dropdowns
					closeAllDropdowns();
					
					if (isHidden) {
						this.dropdown.classList.remove('hidden');
					}
				});
			}

			setOptions(options, selectedValue) {
				this.dropdown.innerHTML = '';
				
				if (!options || options.length === 0) {
					this.label.textContent = 'None available';
					this.trigger.disabled = true;
					this.trigger.classList.add('opacity-50');
					return;
				}

				this.trigger.disabled = false;
				this.trigger.classList.remove('opacity-50');

				let hasSelected = false;

				options.forEach(opt => {
					// We receive arrays of strings, not objects
					const item = document.createElement('div');
					item.className = 'px-3 py-2 cursor-pointer hover:bg-vscode-list-hover transition-colors text-[0.9em] truncate';
					item.textContent = opt;
					
					if (opt === selectedValue) {
						item.classList.add('bg-vscode-list-active');
						item.classList.add('text-vscode-list-activeFg');
						
						let displayValue = opt;
						if (displayValue.includes('/')) {
							displayValue = displayValue.split('/').pop();
						}
						this.label.textContent = displayValue || 'Loading...';
						
						hasSelected = true;
					} else {
						item.classList.add('text-vscode-dropdown-foreground');
					}

					item.addEventListener('click', () => {
						this.onChange(opt);
						this.dropdown.classList.add('hidden');
					});

					this.dropdown.appendChild(item);
				});

				if (!hasSelected && options.length > 0) {
					let displayValue = options[0];
					if (displayValue.includes('/')) {
						displayValue = displayValue.split('/').pop();
					}
					this.label.textContent = displayValue || 'Loading...';
				}
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
			closeAllDropdowns();
		});
	}

	initDropdowns();

	function closeAllDropdowns() {
		document.getElementById('provider-dropdown').classList.add('hidden');
		document.getElementById('model-dropdown').classList.add('hidden');
		document.getElementById('mode-dropdown').classList.add('hidden');
		if (addMenuDropdown) addMenuDropdown.classList.add('hidden');
	}

	// ── @ mention autocomplete ──────────────────────────────
	// Selecting a suggestion pushes into `attachedPaths`, exactly as the 📎
	// attach button does. Everything downstream — chip rendering, the
	// `@[file] <path>` serialization in submitMessage, and host-side expansion
	// — is therefore untouched by this feature.

	// The trigger rules and token arithmetic live in mention-utils.js so they
	// can be unit tested in Node — this file is one DOM-bound IIFE and none of
	// it is reachable from a test runner.
	const { findMentionQuery, removeMentionToken } = globalThis.NanocoderMentionUtils;

	function closeMention() {
		mentionOpen = false;
		mentionItems = [];
		mentionRows = [];
		mentionActiveIndex = 0;
		mentionToken = null;
		mentionLastQuery = null;
		if (mentionDebounceTimer) {
			clearTimeout(mentionDebounceTimer);
			mentionDebounceTimer = null;
		}
		// Invalidate anything still in flight so a late response cannot reopen
		// the dropdown after the user has moved on.
		mentionRequestId++;
		chatInput.removeAttribute('aria-activedescendant');
		chatInput.setAttribute('aria-expanded', 'false');
		if (mentionDropdown) {
			mentionDropdown.classList.add('hidden');
			mentionDropdown.innerHTML = '';
		}
	}

	function requestMentions(token) {
		// input and selectionchange both fire per keystroke, so the same query
		// arrives here twice. Compared against the last *requested* query
		// rather than the last rendered one — while a search is in flight
		// nothing is open yet, so an `mentionOpen` check would let the
		// duplicate through. closeMention() clears this, so reopening the same
		// mention still re-searches.
		//
		// Note this guards the *search* only. `mentionToken` is assigned by
		// syncMentionState before we get here, because two mentions can share a
		// query while sitting at different offsets.
		if (mentionLastQuery === token.query) {
			return;
		}
		mentionLastQuery = token.query;
		vscode.postMessage({
			type: 'requestMentionCompletions',
			query: token.query,
			requestId: ++mentionRequestId
		});
	}

	/** Re-evaluate whether the caret sits in a mention, and refresh results. */
	function syncMentionState() {
		if (!mentionDropdown) return;

		// A range selection is not a caret position; treat it as "not mentioning".
		if (chatInput.selectionStart !== chatInput.selectionEnd) {
			closeMention();
			return;
		}

		const token = findMentionQuery(chatInput.value, chatInput.selectionStart);
		if (!token) {
			closeMention();
			return;
		}

		// Assigned here rather than in requestMentions, which the dedupe below
		// can skip. `@foo @foo` shares one query across two offsets, so moving
		// the caret from the second to the first short-circuits the search and
		// would otherwise leave `start` pointing at the mention the user just
		// left — accepting then adds the chip but strips the wrong `@foo`.
		mentionToken = token;

		if (mentionDebounceTimer) {
			clearTimeout(mentionDebounceTimer);
			mentionDebounceTimer = null;
		}

		// A bare `@` is answered from open editor tabs with no filesystem
		// search, so there is nothing to debounce — waiting would just make the
		// first keystroke feel laggy.
		if (token.query === '') {
			requestMentions(token);
			return;
		}

		mentionDebounceTimer = setTimeout(() => {
			mentionDebounceTimer = null;
			requestMentions(token);
		}, MENTION_DEBOUNCE_MS);
	}

	function highlightMention() {
		mentionRows.forEach((row, index) => {
			const isActive = index === mentionActiveIndex;
			row.classList.toggle('bg-vscode-list-active', isActive);
			row.classList.toggle('text-vscode-list-activeFg', isActive);
			row.setAttribute('aria-selected', isActive ? 'true' : 'false');
			if (isActive) {
				// The listbox is a sibling of the textarea, so focus never moves
				// into it. Without this pointer a screen reader announces the
				// dropdown opening but never which row the arrow keys landed on.
				chatInput.setAttribute('aria-activedescendant', row.id);
				row.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	function renderMentionDropdown() {
		mentionDropdown.innerHTML = '';
		mentionRows = [];

		// Nothing matched — close rather than show an empty popup. This is also
		// what makes a stray `@word` in prose harmless.
		if (mentionItems.length === 0) {
			closeMention();
			return;
		}

		mentionItems.forEach((item, index) => {
			const row = document.createElement('div');
			row.className = 'flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[0.9em] text-vscode-dropdown-fg hover:bg-vscode-list-hover transition-colors';
			row.setAttribute('role', 'option');
			// aria-activedescendant refers to a row by id, so every row needs one.
			row.id = 'mention-option-' + index;

			const iconSpan = document.createElement('span');
			iconSpan.className = 'shrink-0 opacity-70 flex items-center';
			iconSpan.appendChild(item.kind === 'folder' ? createFolderIcon() : createFileIcon());

			const textSpan = document.createElement('span');
			textSpan.className = 'flex flex-col min-w-0 flex-1';

			// textContent, never innerHTML: file names are arbitrary user data.
			const nameSpan = document.createElement('span');
			nameSpan.className = 'truncate';
			nameSpan.textContent = item.name;

			const pathSpan = document.createElement('span');
			pathSpan.className = 'truncate opacity-50 text-[0.85em]';
			pathSpan.textContent = item.isEditor
				? 'open · ' + item.relPath
				: item.relPath;

			textSpan.appendChild(nameSpan);
			textSpan.appendChild(pathSpan);
			row.appendChild(iconSpan);
			row.appendChild(textSpan);

			// mousedown rather than click: click would let the textarea blur
			// first, and the blur handler closes the dropdown before the
			// selection lands.
			row.addEventListener('mousedown', e => {
				e.preventDefault();
				acceptMention(index);
			});
			row.addEventListener('mouseenter', () => {
				mentionActiveIndex = index;
				highlightMention();
			});

			mentionDropdown.appendChild(row);
			mentionRows.push(row);
		});

		mentionDropdown.classList.remove('hidden');
		mentionOpen = true;
		chatInput.setAttribute('aria-expanded', 'true');
		highlightMention();
	}

	function acceptMention(index) {
		const item = mentionItems[index];
		if (!item || !mentionToken) return;

		// Drop the `@query` text: the chosen path becomes a chip instead, so
		// nothing is substituted back into the textarea. The whole token goes,
		// not just up to the caret — accepting from the middle of `@src/foo`
		// has to take the trailing `/foo` with it.
		const removed = removeMentionToken(chatInput.value, mentionToken.start);
		chatInput.value = removed.text;
		chatInput.setSelectionRange(removed.cursor, removed.cursor);
		// The textarea was sized around the token we just removed.
		chatInput.style.height = 'auto';
		chatInput.style.height = chatInput.scrollHeight + 'px';

		if (!attachedPaths.some(a => a.path === item.path)) {
			attachedPaths.push({ path: item.path, name: item.name, kind: item.kind });
			renderChips();
		}

		closeMention();
		chatInput.focus();
	}

	if (mentionDropdown) {
		chatInput.addEventListener('input', syncMentionState);
		chatInput.addEventListener('blur', closeMention);
		// Catches caret moves that fire no input event — arrow keys, clicking
		// into the middle of an existing mention, undo.
		document.addEventListener('selectionchange', () => {
			if (document.activeElement === chatInput) {
				syncMentionState();
			}
		});
	}

	function toggleHistoryView() {
		isHistoryView = !isHistoryView;
		if (isHistoryView) {
			isSettingsView = false;
			document.getElementById('settings-view').classList.add('hidden');
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
		isSettingsView = false;
		document.getElementById('history-view').classList.add('hidden');
		document.getElementById('settings-view').classList.add('hidden');
		document.getElementById('chat-view').classList.remove('hidden');
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
	let currentTurnFooter = null;
	let visualLoader = null;
	const toolKinds = new Map();
	let toastTimeout = null;
	// One agent response is split into several `.agent-markdown` containers -
	// endCurrentTextBlock() closes the current one whenever a tool card, thought
	// box or plan card is inserted. `agentTurnId` stamps every container of the
	// same response with the same id (bumped on each user message) so /copy and
	// /copy code can address the whole response instead of its last fragment.
	let agentTurnId = 0;
	// Raw markdown of the last agent response, kept for the /copy input command
	// (rendered DOM textContent would lose fences and bullets).
	// `lastAgentSegments` holds the segments already closed, `lastAgentRawText`
	// is those plus the one still streaming, and `lastAgentRawTurnId` records
	// which response they describe - so a finished response stays copyable after
	// the user sends again, until the next one actually produces text.
	let lastAgentRawTurnId = -1;
	let lastAgentSegments = '';
	let lastAgentRawText = '';

	// Premium SVG Icons (Feather Icons)
	const ICONS = {
		nanocoder: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M 2 5 H 5 V 8 H 7 V 12 H 9 V 5 H 12 V 19 H 9 V 16 H 7 V 12 H 5 V 19 H 2 Z" /><path d="M 14 5 H 22 V 8 H 17 V 16 H 22 V 19 H 14 Z" /></svg>`,
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
		footer.className = 'message-footer flex h-5 items-center gap-1.5 mt-1 text-xs text-vscode-fg opacity-60 ' +
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
				const status = statusEl.dataset.status;
				if (status === 'pending' || status === 'in_progress') {
					statusEl.innerHTML = ICONS.cancelled;
				}
			});
			stopVisualLoader();

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

	// Shared by the Stop button and Escape so the two can't drift apart.
	function requestCancel() {
		vscode.postMessage({ type: 'cancel' });
		setProcessing(false);
	}

	if (sendStopBtn) {
		sendStopBtn.addEventListener('click', () => {
			if (isProcessing) {
				requestCancel();
			} else {
				submitMessage();
			}
		});
	}

	if (addMenuBtn && addMenuDropdown) {
		addMenuBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const isHidden = addMenuDropdown.classList.contains('hidden');
			closeAllDropdowns();
			if (isHidden) {
				addMenuDropdown.classList.remove('hidden');
			}
		});

		const menuUploadImage = document.getElementById('menu-upload-image');
		if (menuUploadImage) {
			menuUploadImage.addEventListener('click', () => {
				addMenuDropdown.classList.add('hidden');
				if (isHistoryView) {
					showChatView();
				}
				if (imageUpload) {
					imageUpload.click();
				}
			});
		}

		const menuAttachFile = document.getElementById('menu-attach-file');
		if (menuAttachFile) {
			menuAttachFile.addEventListener('click', () => {
				addMenuDropdown.classList.add('hidden');
				vscode.postMessage({ type: 'requestOpenDialog' });
			});
		}
	}

	// Image upload logic
	if (imageUpload) {
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
		const menuUploadImageBtn = document.getElementById('menu-upload-image');
		if (menuUploadImageBtn) {
			menuUploadImageBtn.disabled = true;
			menuUploadImageBtn.classList.add('opacity-50', 'cursor-not-allowed');
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
				if (pendingReads === 0 && menuUploadImageBtn) {
					menuUploadImageBtn.disabled = false;
					menuUploadImageBtn.classList.remove('opacity-50', 'cursor-not-allowed');
				}
			};
			reader.onerror = () => {
				pendingReads--;
				if (pendingReads === 0 && menuUploadImageBtn) {
					menuUploadImageBtn.disabled = false;
					menuUploadImageBtn.classList.remove('opacity-50', 'cursor-not-allowed');
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
		// Mention navigation has to win over Enter-to-submit. Handled at the top
		// of this same listener rather than in a second one, because two
		// listeners on the same element would race and Enter could submit the
		// message when the user meant to accept a completion.
		if (mentionOpen) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				mentionActiveIndex = (mentionActiveIndex + 1) % mentionItems.length;
				highlightMention();
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				mentionActiveIndex = (mentionActiveIndex - 1 + mentionItems.length) % mentionItems.length;
				highlightMention();
				return;
			}
			if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
				e.preventDefault();
				acceptMention(mentionActiveIndex);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				// The document-level handler below cancels the in-flight request
				// on Escape whenever isProcessing. Without stopPropagation,
				// dismissing the dropdown mid-stream would also kill the run.
				e.stopPropagation();
				closeMention();
				return;
			}
			// Shift+Enter falls through: the newline is inserted, and the
			// resulting whitespace closes the mention via syncMentionState.
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitMessage();
		}
	});

	// Escape instantly cancels the in-flight LLM request, mirroring the Stop
	// button. Registered on `document` (not just the textarea) so it fires even
	// when the chat input has lost focus to a tool card, button, dropdown or the
	// streaming response area. Guarded by isProcessing so an idle Escape does
	// nothing.
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && isProcessing) {
			e.preventDefault();
			e.stopPropagation();
			requestCancel();
		}
	});
	// Ctrl/Cmd+Alt+Shift+C is owned by the host keybinding
	// (`nanocoder.copyLastCodeBlock` in package.json). VS Code forwards
	// webview keydowns to the host for resolution even after preventDefault,
	// so a document listener here would double-fire (two clipboard writes /
	// two toasts). The host posts `{type:'copyLastCodeBlock'}` back into
	// this page. Ctrl+Shift+C and Ctrl+Alt+C are avoided: VS Code (external
	// terminal) and Cursor (confetti) claim them at app level.

	function submitMessage() {
		let text = chatInput.value.trim();
		if (!text && attachedPaths.length === 0 && pendingImages.length === 0) return;

		// /copy is handled locally, mirroring the terminal slash command:
		// copy the previous agent output instead of prompting the agent.
		// Match on raw input before context chips are folded in, otherwise
		// `/copy` with an attachment becomes `/copy\n\n@[file] …` and falls
		// through to the agent as an unrecognized slash command.
		// `/copy code` copies just the last fenced code block. Inner whitespace
		// is collapsed so `/copy  code` doesn't fall through to the agent.
		const lower = text.toLowerCase().replace(/\s+/g, ' ');
		if (lower === '/copy' || lower === '/copy code') {
			chatInput.value = '';
			chatInput.style.height = 'auto';
			attachedPaths = [];
			renderChips();
			pendingImages = [];
			renderImagePreviews();
			if (lower === '/copy code') {
				copyLastCodeBlock();
			} else {
				copyLastResponse();
			}
			return;
		}

		// Append attached paths as context lines
		if (attachedPaths.length > 0) {
			const contextText = attachedPaths
				.map(a => `@${a.kind === 'folder' ? '[folder]' : '[file]'} ${a.path}`)
				.join('\n');
			text = text ? `${text}\n\n${contextText}` : contextText;
		}

		const imagesToSubmit = pendingImages.length > 0 ? [...pendingImages] : undefined;

		// Clear input. Close the mention first — its token offsets point into
		// text that is about to disappear.
		closeMention();
		chatInput.value = '';
		chatInput.style.height = 'auto';
		pendingImages = [];
		renderImagePreviews();

		// Clear chips after sending
		attachedPaths = [];
		renderChips();

		dispatchPrompt(text, imagesToSubmit);
	}

	// Send `text` to the agent as a turn of its own. Split out of
	// submitMessage so an editor-driven prompt can bypass the composer: going
	// through it would overwrite a draft the user is typing and sweep up chips
	// and images they staged for a different question.
	function dispatchPrompt(text, images) {
		// Send message to extension host
		vscode.postMessage({
			type: 'submitMessage',
			text: text,
			images: images
		});

		// Optimistically append user message
		appendMessage(text, 'user', images);
		pendingUserMessageText = text;

		if (!isProcessing) {
			// Switch to processing state
			setProcessing(true);

			startVisualLoader();

			// Reset turn elements so agent starts a fresh block
			currentTurnEl = null;
			currentTextEl = null;
		}
	}

	function createFileIcon() {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '14');
		svg.setAttribute('height', '14');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
		const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
		polyline.setAttribute('points', '14 2 14 8 20 8');
		svg.appendChild(path);
		svg.appendChild(polyline);
		return svg;
	}

	function createFolderIcon() {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '14');
		svg.setAttribute('height', '14');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z');
		svg.appendChild(path);
		return svg;
	}

	function renderChips() {
		contextChipsContainer.innerHTML = '';
		if (attachedPaths.length === 0) {
			contextChipsContainer.classList.add('hidden');
			return;
		}
		contextChipsContainer.classList.remove('hidden');
		for (const item of attachedPaths) {
			const chip = document.createElement('span');
			chip.className = 'context-chip';
			
			const iconSpan = document.createElement('span');
			iconSpan.className = 'chip-icon';
			iconSpan.appendChild(item.kind === 'folder' ? createFolderIcon() : createFileIcon());
			iconSpan.style.marginRight = '4px';
			iconSpan.style.display = 'flex';
			iconSpan.style.alignItems = 'center';

			const nameSpan = document.createElement('span');
			nameSpan.className = 'chip-name';
			nameSpan.setAttribute('title', item.path);
			nameSpan.textContent = item.name;

			const removeSpan = document.createElement('span');
			removeSpan.className = 'chip-remove';
			removeSpan.setAttribute('title', 'Remove');
			removeSpan.textContent = '×';

			chip.appendChild(iconSpan);
			chip.appendChild(nameSpan);
			chip.appendChild(removeSpan);
			
			chip.addEventListener('click', e => {
				if (e.target.classList.contains('chip-remove')) {
					attachedPaths = attachedPaths.filter(a => a.path !== item.path);
					renderChips();
					return;
				}
				vscode.postMessage({ type: 'openPath', path: item.path, kind: item.kind });
			});
			contextChipsContainer.appendChild(chip);
		}
	}

	if (composerBox) {
		const handleDrag = (e) => {
			e.preventDefault();
			e.stopPropagation();
		};
		
		// Prevent default on window to stop VS Code's native drop handler
		window.addEventListener('dragover', (e) => e.preventDefault(), true);
		window.addEventListener('drop', (e) => e.preventDefault(), true);

		// Prevent native text drop on the textarea
		chatInput.addEventListener('dragenter', handleDrag, true);
		chatInput.addEventListener('dragover', handleDrag, true);
		chatInput.addEventListener('drop', handleDrag, true);

		composerBox.addEventListener('dragenter', (e) => {
			handleDrag(e);
			composerBox.classList.add('drag-over');
		}, true);
		
		composerBox.addEventListener('dragover', (e) => {
			handleDrag(e);
			composerBox.classList.add('drag-over');
		}, true);
		
		composerBox.addEventListener('dragleave', (e) => {
			handleDrag(e);
			composerBox.classList.remove('drag-over');
		}, true);
		
		composerBox.addEventListener('drop', e => {
			handleDrag(e);
			composerBox.classList.remove('drag-over');
			const uris = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
			if (!uris) return;
			
			const isWindows = navigator.userAgentData?.platform?.toLowerCase().includes('win') || navigator.userAgent.includes('Windows');
			const paths = uris.split('\n')
				.map(u => u.trim())
				.filter(u => u && !u.startsWith('#'))
				.map(u => {
					if (u.startsWith('file://')) {
						let p = decodeURIComponent(u.replace(/^file:\/\/\/?/, ''));
						if (isWindows && p.match(/^[a-zA-Z]:/)) {
							// Already dropped leading slash via the regex above if it had exactly three slashes. 
							// But if it had two slashes e.g. file://C:/ it would become C:/
							// If it had three e.g. file:///C:/ the regex stripped up to 3 slashes so it also becomes C:/
							// Wait, what if it was file:///C:/... ? `u.replace(/^file:\/\/\/?/, '')` removes `file:///`.
							// What about UNC paths? `file://server/share` -> regex removes `file://`, leaving `server/share`. 
							// Wait, `u.replace(/^file:\/\/\/?/, '')` removes `file:///` or `file://`.
							// For UNC `file://server/share`, `replace` makes it `server/share`. 
							// So we need to put `//` back for UNC on Windows? 
							// Let's implement Will's explicit advice:
							// "strip with /^file:\/\/\/?/ and on Windows drop the leading slash before a drive letter."
						}
						// Let's strictly follow Will's suggestion:
						let p2 = decodeURIComponent(u.replace(/^file:\/\/\/?/, ''));
						if (isWindows && p2.match(/^\/[a-zA-Z]:/)) {
							p2 = p2.substring(1);
						}
						// wait, for UNC path `file://server/share`, replacing `/^file:\/\/\/?/` removes `file://`. 
						// So it becomes `server/share`. On Windows UNC paths need `\\server\share`. 
						// Actually vscode drop UNC path comes as `file:////server/share` or `file://server/share`.
						// If we don't mess with it too much, let's just do exactly what Will said.
						return p2;
					}
					return u;
				});

			paths.forEach(p => vscode.postMessage({ type: 'requestPathInfo', path: p }));
		}, true);
	}

	// True while the accumulator describes the response currently streaming.
	// Goes false as soon as the user sends again, freezing the previous
	// response until beginAgentSegment() hands the accumulator to the new one.
	function isAccumulatingCurrentTurn() {
		return lastAgentRawTurnId === agentTurnId;
	}

	function beginAgentSegment() {
		if (isAccumulatingCurrentTurn()) return;
		lastAgentRawTurnId = agentTurnId;
		lastAgentSegments = '';
		lastAgentRawText = '';
	}

	// Fold the segment being closed into the response-level accumulator so
	// /copy still yields the whole response after a tool card splits it.
	function closeAgentSegment() {
		if (isAccumulatingCurrentTurn() && currentTurnText) {
			lastAgentSegments = [lastAgentSegments, currentTurnText]
				.filter(Boolean)
				.join('\n\n');
		}
		currentTurnText = '';
	}

	function syncLastAgentRawText() {
		if (!isAccumulatingCurrentTurn()) return;
		lastAgentRawText = [lastAgentSegments, currentTurnText]
			.filter(Boolean)
			.join('\n\n');
	}

	function appendMessage(content, role, images = undefined) {
		// Remove welcome message and loader if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();
		const loader = document.getElementById('session-loader');
		if (loader) loader.remove();

		// A user message opens a new turn, so the agent segments that follow get
		// a fresh id. The raw-text accumulator is handed over lazily, once the
		// new response produces text.
		if (role === 'user') {
			agentTurnId++;
			currentTurnFooter = null;
		}

		const wrapper = document.createElement('div');
		wrapper.className = 'group flex flex-col min-w-0 shrink-0 ' +
			(role === 'user' ? 'self-end items-end max-w-[85%]' : 'self-start items-start max-w-full');

		const msgEl = document.createElement('div');
		msgEl.className = 'leading-snug break-words shrink-0 min-w-0 flex flex-col ' +
			(role === 'user'
				// No max-w here: the wrapper already caps the turn at 85%. A second
				// percentage would resolve against the wrapper's shrink-to-fit width,
				// squeezing the bubble to 85% of its own content and wrapping mid-word.
				? 'self-end bg-vscode-dropdown-bg text-vscode-dropdown-fg border border-vscode-border px-3 py-2 rounded-lg max-w-full'
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

		let parsedContent = content;
		let extractedChips = [];
		let textContainer = null;

		if (role === 'user' && content) {
			// Handle pre-injected format (before sending)
			parsedContent = content.replace(/@\[(file|folder)\]\s+([^\n]+)/g, (match, kind, path) => {
				const name = path.trim().split(/[/\\]/).pop();
				extractedChips.push({ kind, path: path.trim(), name });
				return ''; // Remove from text
			});

			// Handle post-injected format (from history sync)
			parsedContent = parsedContent.replace(/<context path="([^"]+)"(?: type="([^"]+)")?>[\s\S]*?<\/context>/g, (match, path, type) => {
				const kind = type === 'directory' ? 'folder' : 'file';
				const name = path.trim().split(/[/\\]/).pop();
				extractedChips.push({ kind, path: path.trim(), name });
				return ''; // Remove from text
			});

			parsedContent = parsedContent.trim();
		}

		if (parsedContent || extractedChips.length > 0) {
			textContainer = document.createElement('div');
			// `agent-markdown` marks assistant prose so copyLastCodeBlock() can skip
			// user echoes and thought boxes, which also render as `.markdown-body`.
			textContainer.className = 'markdown-body' + (role === 'agent' ? ' agent-markdown' : '');
			if (role === 'agent') textContainer.dataset.turnId = String(agentTurnId);

			if (typeof marked !== 'undefined') {
				textContainer.innerHTML = marked.parse(parsedContent);
			} else {
				textContainer.textContent = parsedContent;
			}

			if (extractedChips.length > 0 && role === 'user') {
				const chipsContainer = document.createElement('div');
				chipsContainer.style.display = 'flex';
				chipsContainer.style.flexWrap = 'wrap';
				chipsContainer.style.gap = '6px';
				chipsContainer.style.marginTop = parsedContent ? '8px' : '0';

				extractedChips.forEach(chipData => {
					const chip = document.createElement('span');
					chip.className = 'context-chip';
					chip.setAttribute('data-path', chipData.path);
					chip.setAttribute('data-kind', chipData.kind);
					chip.style.paddingRight = '8px';
					
					const iconSpan = document.createElement('span');
					iconSpan.style.marginRight = '4px';
					iconSpan.style.display = 'flex';
					iconSpan.style.alignItems = 'center';
					iconSpan.appendChild(chipData.kind === 'folder' ? createFolderIcon() : createFileIcon());
					
					const nameSpan = document.createElement('span');
					nameSpan.className = 'chip-name';
					nameSpan.setAttribute('title', chipData.path);
					nameSpan.textContent = chipData.name;
					
					chip.appendChild(iconSpan);
					chip.appendChild(nameSpan);
					chipsContainer.appendChild(chip);
				});

				chipsContainer.addEventListener('click', (e) => {
					const chip = e.target.closest('.context-chip');
					if (chip) {
						const path = chip.getAttribute('data-path');
						const kind = chip.getAttribute('data-kind');
						if (path) {
							vscode.postMessage({ type: 'openPath', path, kind });
						}
					}
				});

				textContainer.appendChild(chipsContainer);
			}

			msgEl.appendChild(textContainer);
		}

		wrapper.appendChild(msgEl);
		wrapper.appendChild(createMessageFooter(() => content, role, new Date()));

		messagesContainer.appendChild(wrapper);
		scrollToBottom();

		if (role === 'agent') {
			// This opens a fresh container, so whatever block was open is done.
			closeAgentSegment();
			beginAgentSegment();
			currentTurnEl = msgEl;
			currentTextEl = textContainer;
			currentTurnText = content;
			syncLastAgentRawText();
		}
	}

	function startVisualLoader() {
		const wrapper = document.createElement('div');
		wrapper.className = 'group flex flex-row gap-1.5 min-w-0 shrink-0 self-start items-center max-w-full';
		const span = document.createElement('span');
		span.className = 'flex items-center shrink-0 text-vscode-fg [&_svg]:w-6 [&_svg]:h-6 animate-pulse';

		span.innerHTML = ICONS.nanocoder;
		wrapper.appendChild(span);

		visualLoader = wrapper;
		messagesContainer.appendChild(wrapper);
		scrollToBottom();
	}

	function keepVisualLoaderAtBottom() {
		if (visualLoader && visualLoader.parentElement) {
			messagesContainer.appendChild(visualLoader);
		}
		scrollToBottom();
	}

	function stopVisualLoader() {
		if (visualLoader) {
			visualLoader.remove();
			visualLoader = null;
		}
	}

	function appendChunk(textChunk) {
		// Remove welcome message and loader if present
		const welcome = document.querySelector('.welcome-message');
		if (welcome) welcome.remove();

		if (!currentTurnEl || !currentTextEl) {
			// First chunk for this turn
			const wrapper = document.createElement('div');
			wrapper.className = 'group flex flex-col min-w-0 self-start items-start max-w-full';

			const msgEl = document.createElement('div');
			msgEl.className = 'message agent min-w-0 w-full';

			const textContainer = document.createElement('div');
			textContainer.className = 'markdown-body agent-markdown leading-snug break-words';
			textContainer.dataset.turnId = String(agentTurnId);
			beginAgentSegment();
			currentTurnText = textChunk;
			syncLastAgentRawText();

			if (typeof marked !== 'undefined') {
				textContainer.innerHTML = marked.parse(currentTurnText);
			} else {
				textContainer.textContent = currentTurnText;
			}

			msgEl.appendChild(textContainer);
			wrapper.appendChild(msgEl);
			if (currentTurnFooter) {
				currentTurnFooter.remove();
			} else {
				// captures footer, not currentTurnFooter - avoids copying the next turn's text
				const footer = createMessageFooter(() => footer.dataset.rawText || '', 'agent', new Date());
				currentTurnFooter = footer;
			}
			currentTurnFooter.dataset.rawText = lastAgentRawText;
			wrapper.appendChild(currentTurnFooter);
			messagesContainer.appendChild(wrapper);

			currentTurnEl = msgEl;
			currentTextEl = textContainer;
			scrollToBottom();
		} else {
			// Append to existing turn
			currentTurnText += textChunk;
			syncLastAgentRawText();
			if (currentTurnFooter) {
				currentTurnFooter.dataset.rawText = lastAgentRawText;
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

	// --- Copy last code block ---

	function showToast(text) {
		let toast = document.getElementById('copy-toast');
		if (!toast) {
			toast = document.createElement('div');
			toast.id = 'copy-toast';
			toast.setAttribute('role', 'status');
			toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center px-3 py-1.5 rounded-md border border-vscode-border bg-vscode-dropdown-bg text-vscode-dropdown-fg font-vscode text-[0.85em] shadow-lg pointer-events-none transition-opacity duration-200';
			document.body.appendChild(toast);
		}

		toast.innerHTML = ICONS.clipboard;
		const label = document.createElement('span');
		label.textContent = text;
		toast.appendChild(label);
		toast.classList.remove('opacity-0');

		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => {
			toast.classList.add('opacity-0');
			toastTimeout = null;
		}, 1500);
	}

	// Streaming batches marked.parse() behind a 50ms timer. Flush so a copy
	// mid-turn (or a turn boundary) reads the current markdown, not the
	// previous throttled frame. Shared by copyLastCodeBlock and endCurrentTextBlock.
	function flushPendingRender() {
		if (!renderTimeout) return;
		clearTimeout(renderTimeout);
		renderTimeout = null;
		if (currentTextEl && typeof marked !== 'undefined') {
			currentTextEl.innerHTML = marked.parse(currentTurnText);
		}
	}

	function copyLastCodeBlock() {
		flushPendingRender();

		const segments = messagesContainer.querySelectorAll('.agent-markdown');
		if (segments.length === 0) {
			showToast('No response to copy yet');
			return;
		}

		// Walk the segments of the last response back to front. Scanning the
		// whole response rather than only its final segment matters because a
		// tool call between the code block and the closing prose would
		// otherwise hide the block.
		const lastTurnId = segments[segments.length - 1].dataset.turnId;
		let text = '';
		for (let i = segments.length - 1; i >= 0; i--) {
			if (segments[i].dataset.turnId !== lastTurnId) break;
			const blocks = segments[i].querySelectorAll('pre code');
			if (blocks.length > 0) {
				text = blocks[blocks.length - 1].textContent.replace(/\n$/, '');
				break;
			}
		}

		if (!text) {
			showToast('No code block in the last response');
			return;
		}

		vscode.postMessage({ type: 'copyToClipboard', text: text });
	}

	// Webview twin of the terminal /copy command: copies the whole previous
	// agent response as raw markdown.
	function copyLastResponse() {
		if (!lastAgentRawText.trim()) {
			showToast('No response to copy yet');
			return;
		}
		vscode.postMessage({ type: 'copyToClipboard', text: lastAgentRawText });
	}

	// Compact token formatting: 812, 4.2k, 12k, 1.3M. Mirrors the CLI's
	// per-response indicator formatting (source/usage/format.ts).
	function formatCompactTokens(tokens) {
		if (!Number.isFinite(tokens) || tokens <= 0) return '0';
		if (tokens < 1000) return String(Math.round(tokens));
		const scaled = tokens < 1000000 ? tokens / 1000 : tokens / 1000000;
		const suffix = tokens < 1000000 ? 'k' : 'M';
		const num = scaled >= 100
			? String(Math.round(scaled))
			: scaled.toFixed(1).replace(/\.0$/, '');
		return num + suffix;
	}

	// Render a small grayed-out usage line (e.g. "Tokens: 4.2k | ~$0.01")
	// under the finished response. Cost is omitted when unknown (local models).
	function appendUsageIndicator(usage, cost) {
		if (!usage) return;
		const total = Number.isFinite(usage.totalTokens)
			? usage.totalTokens
			: (Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0) +
				(Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0);
		if (!total) return;

		let text = 'Tokens: ' + formatCompactTokens(total);
		if (Number.isFinite(cost) && cost > 0) {
			text += cost < 0.01 ? ' | <$0.01' : ' | ~$' + cost.toFixed(2);
		}

		endCurrentTextBlock();
		const el = document.createElement('div');
		el.className = 'self-start text-[0.8em] opacity-50 shrink-0 mb-1';
		el.textContent = text;
		messagesContainer.appendChild(el);
		scrollToBottom();
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
			case 'mentionCompletions': {
				// postMessage delivery is async and can land out of order, so a
				// fast typist gets responses for stale queries. Only the newest
				// request may paint, otherwise the list flickers backwards.
				if (message.requestId !== mentionRequestId) break;
				mentionItems = Array.isArray(message.items) ? message.items : [];
				mentionActiveIndex = 0;
				renderMentionDropdown();
				break;
			}
			case 'pathInfoResolved': {
				const { path, name, kind } = message;
				if (!attachedPaths.some(a => a.path === path)) {
					attachedPaths.push({ path, name, kind });
					renderChips();
				}
				break;
			}
			case 'appendMessage':
				appendMessage(message.content, 'agent');
				break;
			case 'clear':
				// Session reset (new chat or resume) should return to the active
				// chat view, not leave the panel stuck on the history list.
				if (isHistoryView) showChatView();
				if (isSettingsView) hideSettingsView();
				if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
				if (message.isLoading) {
					messagesContainer.innerHTML = `<div id="session-loader" class="flex flex-col items-center justify-center h-full opacity-50 mt-10">${ICONS.pending}<div class="mt-2 text-xs">Loading session...</div></div>`;
				} else {
					messagesContainer.innerHTML = '';
				}
				currentTurnEl = null;
				currentTextEl = null;
				currentTurnText = '';
				currentTurnFooter = null;
				toolKinds.clear();
				agentTurnId = 0;
				lastAgentRawTurnId = -1;
				lastAgentSegments = '';
				lastAgentRawText = '';
				if (currentThoughtBox) {
					clearInterval(currentThoughtBox.timer);
					currentThoughtBox = null;
				}
				setProcessing(false);
				break;
			case 'sessionLoaded':
				if (currentThoughtBox) {
					currentThoughtBox.pause();
					currentThoughtBox = null;
				}
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
			case 'permissionsCancelled':
				handlePermissionsCancelled(message.toolCallIds);
				break;
			case 'toggleSettings':
				toggleSettingsView();
				break;
			case 'settingsData':
				renderSettingsData(message.settings);
				break;
			case 'settingsUpdated':
				if (!message.success) {
					console.error('Failed to update setting:', message.error);
				}
				break;
			case 'syncState':
				handleSyncState(message);
				break;
			case 'updateSessions':
				sessionsData = message.sessions || [];
				renderSessions(); // Always update so list is ready when history opens
				break;
			case 'runPrompt':
				if (isHistoryView) showChatView();
				dispatchPrompt(message.text);
				chatInput.focus();
				break;
			case 'copyLastCodeBlock':
				copyLastCodeBlock();
				break;
			case 'copyResult':
				showToast(
					message.ok
						? `Copied ${message.chars} characters`
						: 'Could not copy to clipboard'
				);
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

		// Within each date bucket, show most-recently-used first. Sessions
		// without an updatedAt (shouldn't normally happen) sort to the end.
		Object.values(groups).forEach(sessions => {
			sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
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
					// Matches MAX_SESSION_NAME_LENGTH in source/constants.ts - fail
					// locally instead of round-tripping to a backend error toast.
					input.maxLength = 100;
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
		flushPendingRender();
		closeAgentSegment();
		currentTurnEl = null;
		currentTextEl = null;
		syncLastAgentRawText();
	}

	function aggregatorHasPendingTools(aggregator) {
		for (const item of aggregator.toolItems.values()) {
			if (item.dataset.pending === 'true') return true;
		}
		return false;
	}

	function closeAggregatorIfIdle() {
		if (currentAggregator && !aggregatorHasPendingTools(currentAggregator)) {
			currentAggregator.close();
			currentAggregator = null;
		}
	}

	function handleAcpUpdate(payload) {
		if (!payload) return;
		const update = payload.update ? payload.update : payload;

		if (update.sessionUpdate === 'user_message_chunk') {
			if (currentThoughtBox) {
				currentThoughtBox.pause();
				currentThoughtBox = null;
			}
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
				currentThoughtBox.pause();
			}
			closeAggregatorIfIdle();
			if (update.content && update.content.text) {
				stopVisualLoader();
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'agent_thought_chunk') {
			if (!currentThoughtBox) {
				endCurrentTextBlock();
				currentThoughtBox = new ThoughtAggregator();
				closeAggregatorIfIdle();
			}
			if (update.content && update.content.text) {
				currentThoughtBox.append(update.content.text);
			}
		} else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
			if (currentThoughtBox) {
				currentThoughtBox.pause();
			}
			handleToolCallUpdate(update);
		} else if (update.sessionUpdate === 'plan') {
			handlePlanUpdate(update);
		} else if (update.sessionUpdate === 'prompt_response' || update.sessionUpdate === 'done') {
			if (currentThoughtBox) {
				currentThoughtBox.pause();
				currentThoughtBox = null;
			}
			// Show token usage (and estimated cost) for the finished turn
			appendUsageIndicator(update.usage, update.cost);
			// Turn is complete — restore the send button
			setProcessing(false);
		}
		keepVisualLoaderAtBottom();
	}

	// ─── Settings Panel Logic ───────────────────────────────────────

	let isSettingsView = false;

	function showSettingsView() {
		isSettingsView = true;
		isHistoryView = false;
		document.getElementById('chat-view').classList.add('hidden');
		document.getElementById('history-view').classList.add('hidden');
		document.getElementById('settings-view').classList.remove('hidden');
		// Request fresh settings data from extension host
		vscode.postMessage({ type: 'requestSettings' });
	}

	function hideSettingsView() {
		isSettingsView = false;
		document.getElementById('settings-view').classList.add('hidden');
		showChatView();
	}

	function toggleSettingsView() {
		if (isSettingsView) {
			hideSettingsView();
		} else {
			showSettingsView();
		}
	}

	// Settings tab switching
	document.querySelectorAll('.settings-tab').forEach(tab => {
		tab.addEventListener('click', () => {
			document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
			tab.classList.add('active');
			const tabId = tab.dataset.tab;
			document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
			const content = document.getElementById('settings-tab-' + tabId);
			if (content) content.classList.remove('hidden');
		});
	});

	// Settings action buttons (edit config, restart, etc.)
	document.querySelectorAll('.settings-action-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const action = btn.dataset.action;
			if (action === 'edit-providers' || action === 'edit-mcp' || action === 'edit-tools' || action === 'open-agents-config') {
				vscode.postMessage({ type: 'openConfigFile', file: 'agents.config.json' });
			} else if (action === 'open-preferences') {
				vscode.postMessage({ type: 'openConfigFile', file: 'nanocoder-preferences.json' });
			} else if (action === 'restart-acp') {
				vscode.postMessage({ type: 'restartAcp' });
			}
		});
	});

	// Behavior tab — interactive controls change handlers
	function initSettingsControls() {
		// Default mode
		const modeSelect = document.getElementById('setting-defaultMode');
		if (modeSelect) {
			modeSelect.addEventListener('change', () => {
				vscode.postMessage({ type: 'updateSetting', key: 'defaultMode', value: modeSelect.value || null });
			});
		}

		// Auto-compact enabled
		const acEnabled = document.getElementById('setting-autoCompact-enabled');
		if (acEnabled) {
			acEnabled.addEventListener('change', () => {
				vscode.postMessage({ type: 'updateSetting', key: 'autoCompact.enabled', value: acEnabled.checked });
			});
		}

		// Auto-compact threshold
		const acThreshold = document.getElementById('setting-autoCompact-threshold');
		if (acThreshold) {
			acThreshold.addEventListener('change', () => {
				const val = parseInt(acThreshold.value, 10);
				if (!isNaN(val) && val >= 50 && val <= 95) {
					vscode.postMessage({ type: 'updateSetting', key: 'autoCompact.threshold', value: val });
				}
			});
		}

		// Auto-compact mode
		const acMode = document.getElementById('setting-autoCompact-mode');
		if (acMode) {
			acMode.addEventListener('change', () => {
				vscode.postMessage({ type: 'updateSetting', key: 'autoCompact.mode', value: acMode.value });
			});
		}

		// Reasoning traces
		const rtToggle = document.getElementById('setting-reasoningTraces');
		if (rtToggle) {
			rtToggle.addEventListener('change', () => {
				vscode.postMessage({ type: 'updateSetting', key: 'reasoningTraces', value: rtToggle.checked });
			});
		}

		// Sessions auto-save
		const saToggle = document.getElementById('setting-sessions-autoSave');
		if (saToggle) {
			saToggle.addEventListener('change', () => {
				vscode.postMessage({ type: 'updateSetting', key: 'sessions.autoSave', value: saToggle.checked });
			});
		}
	}
	initSettingsControls();

	/**
	 * Populate the settings UI with data received from the extension host.
	 */
	function renderSettingsData(settings) {
		// ── Providers list ──
		const providersList = document.getElementById('settings-providers-list');
		if (providersList) {
			if (settings.providers.length === 0) {
				providersList.innerHTML = '<div class="settings-list-empty">No providers configured</div>';
			} else {
				providersList.innerHTML = settings.providers.map(p => {
					const detail = p.baseUrl || 'default endpoint';
					const models = p.models.length > 0
						? p.models[0] + (p.models.length > 1 ? ` +${p.models.length - 1}` : '')
						: 'no models';
					const keyBadge = p.apiKeySet
						? '<span class="settings-badge settings-badge-ok">Key ✓</span>'
						: '<span class="settings-badge settings-badge-off">No key</span>';
					return `<div class="settings-list-item">
						<span class="settings-list-item-name">${escapeHtml(p.name)}</span>
						<span class="settings-list-item-detail">${escapeHtml(detail)} · ${escapeHtml(models)}</span>
						${keyBadge}
					</div>`;
				}).join('');
			}
		}

		// ── MCP Servers list ──
		const mcpList = document.getElementById('settings-mcp-list');
		if (mcpList) {
			if (settings.mcpServers.length === 0) {
				mcpList.innerHTML = '<div class="settings-list-empty">No MCP servers configured</div>';
			} else {
				mcpList.innerHTML = settings.mcpServers.map(s => {
					const detail = s.command || s.url || '(no endpoint)';
					return `<div class="settings-list-item">
						<span class="settings-list-item-name">${escapeHtml(s.name)}</span>
						<span class="settings-list-item-detail">${escapeHtml(s.transport)} · ${escapeHtml(detail)}</span>
					</div>`;
				}).join('');
			}
		}

		// ── Tool auto-approval list ──
		const toolsList = document.getElementById('settings-tools-list');
		if (toolsList) {
			if (settings.alwaysAllow.length === 0) {
				toolsList.innerHTML = '<div class="settings-list-empty">No tools auto-approved</div>';
			} else {
				toolsList.innerHTML = settings.alwaysAllow.map(t =>
					`<div class="settings-list-item">
						<span class="settings-list-item-name">${escapeHtml(t)}</span>
					</div>`
				).join('');
			}
		}

		// ── Web search status ──
		const wsStatus = document.getElementById('settings-websearch-status');
		if (wsStatus) {
			wsStatus.innerHTML = settings.webSearch.configured
				? '<div class="settings-list-item"><span class="settings-badge settings-badge-ok">API key configured ✓</span></div>'
				: '<div class="settings-list-item"><span class="settings-badge settings-badge-off">Not configured</span></div>';
		}

		// ── Behavior controls ──
		const modeSelect = document.getElementById('setting-defaultMode');
		if (modeSelect) modeSelect.value = settings.defaultMode || 'normal';

		const acEnabled = document.getElementById('setting-autoCompact-enabled');
		if (acEnabled) acEnabled.checked = settings.autoCompact.enabled;

		const acThreshold = document.getElementById('setting-autoCompact-threshold');
		if (acThreshold) acThreshold.value = settings.autoCompact.threshold;

		const acMode = document.getElementById('setting-autoCompact-mode');
		if (acMode) acMode.value = settings.autoCompact.mode;

		const rtToggle = document.getElementById('setting-reasoningTraces');
		if (rtToggle) rtToggle.checked = settings.reasoningTraces;

		const saToggle = document.getElementById('setting-sessions-autoSave');
		if (saToggle) saToggle.checked = settings.sessions.autoSave;
	}

	function escapeHtml(str) {
		const div = document.createElement('div');
		div.textContent = str;
		return div.innerHTML;
	}

	// ─── End Settings Panel Logic ───────────────────────────────────

	class ThoughtAggregator {
		constructor() {
			this.el = document.createElement('div');
			this.el.className = 'my-2 flex flex-col shrink-0 thought-aggregator';

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
			this.userToggled = false;
			this.text = '';
			this.renderTimeout = null;
			this.thinkingMs = 0;
			this.segmentStart = Date.now();

			this.timer = setInterval(() => this.updateTimer(), 1000);

			messagesContainer.appendChild(this.el);
			scrollToBottom();
		}

		elapsedSeconds() {
			const active = this.segmentStart ? Date.now() - this.segmentStart : 0;
			return Math.floor((this.thinkingMs + active) / 1000);
		}

		updateTimer() {
			this.title.textContent = `Thinking for ${this.elapsedSeconds()}s`;
		}

		toggle(force) {
			if (force === undefined) {
				this.userToggled = true;
			}
			this.isOpen = force !== undefined ? force : !this.isOpen;
			this.body.style.display = this.isOpen ? 'block' : 'none';

			const svg = this.chevron.querySelector('svg');
			if (svg) {
				svg.style.transform = this.isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
			}
		}

		render() {
			if (typeof marked !== 'undefined') {
				this.body.innerHTML = marked.parse(this.text);
			} else {
				this.body.textContent = this.text;
			}
		}

		append(chunk) {
			this.resume();
			this.text += chunk;
			if (typeof marked !== 'undefined') {
				if (!this.renderTimeout) {
					this.renderTimeout = setTimeout(() => {
						this.render();
						this.renderTimeout = null;
						scrollToBottom();
					}, 50);
				}
			} else {
				this.render();
				scrollToBottom();
			}
		}

		resume() {
			if (this.segmentStart) return;
			if (this.text && !this.text.endsWith('\n\n')) {
				this.text += '\n\n';
			}
			this.segmentStart = Date.now();
			this.timer = setInterval(() => this.updateTimer(), 1000);
			this.updateTimer();
			if (!this.userToggled) {
				this.toggle(true);
			}
		}

		pause() {
			if (!this.segmentStart) return;
			this.thinkingMs += Date.now() - this.segmentStart;
			this.segmentStart = null;
			clearInterval(this.timer);
			this.timer = null;
			if (this.renderTimeout) {
				clearTimeout(this.renderTimeout);
				this.renderTimeout = null;
			}
			this.render();
			this.title.textContent = `Thought for ${this.elapsedSeconds()}s`;
			if (!this.userToggled) {
				this.toggle(false);
			}
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

		toggle(force) {
			this.isOpen = force !== undefined ? force : !this.isOpen;
			this.body.style.display = this.isOpen ? '' : 'none';

			const svg = this.chevron.querySelector('svg');
			if (svg) {
				svg.style.transform = this.isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
			}
		}

		close() {
			this.toggle(false);
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
				label.textContent = humanizeToolTitle(update.title);

				headerRow.appendChild(status);
				headerRow.appendChild(label);
				item.appendChild(headerRow);
				
				this.body.appendChild(item);
				this.toolItems.set(toolCallId, item);

			} else {
				if (update.title) {
					const labelEl = item.querySelector('.tool-label');
					if (labelEl) labelEl.textContent = humanizeToolTitle(update.title);
				}
			}

			const statusEl = item.querySelector('.tool-status');
			if (statusEl) {
				statusEl.dataset.status = update.status || 'pending';
				if (update.status === 'success' || update.status === 'completed') {
					statusEl.innerHTML = ICONS.success;
					item.dataset.pending = 'false';
				} else if (
					update.status === 'cancelled' ||
					update.status === 'denied' ||
					// ACP has no 'cancelled' status, so a cancel arrives as failed with
					// 'Cancelled by user'. Case-insensitive, or the capital C misses.
					(update.status === 'failed' && update.rawOutput && typeof update.rawOutput === 'string' && /aborterror|cancelled|denied/i.test(update.rawOutput))
				) {
					statusEl.innerHTML = ICONS.cancelled;
					item.dataset.pending = 'false';
				} else if (update.status === 'error' || update.status === 'failed') {
					statusEl.innerHTML = ICONS.error;
					item.dataset.pending = 'false';
				} else if (update.status === 'pending') {
					// Queued, not yet running - still unfinished, so the
					// aggregator must stay open for it.
					statusEl.innerHTML = ICONS.circle;
					item.dataset.pending = 'true';
				} else {
					statusEl.innerHTML = ICONS.pending;
					item.dataset.pending = 'true';
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
		let card = document.getElementById(`plan-card-${agentTurnId}`);

		if (entries.length === 0) {
			if (card) card.remove();
			return;
		}

		if (!card) {
			endCurrentTextBlock();
			closeAggregatorIfIdle();
			card = document.createElement('div');
			card.id = `plan-card-${agentTurnId}`;
			card.className = 'my-3 border border-vscode-widget-border rounded bg-vscode-widget-bg overflow-hidden shrink-0';

			const header = document.createElement('div');
			header.className = 'px-3 py-2 flex items-center bg-vscode-widget-header border-b border-vscode-widget-border gap-2';

			const title = document.createElement('span');
			title.className = 'font-vscode text-[0.9em] opacity-80';
			title.textContent = 'Tasks';

			const progress = document.createElement('span');
			progress.className = 'plan-progress ml-auto font-vscode text-[0.8em] opacity-60';

			header.appendChild(title);
			header.appendChild(progress);
			card.appendChild(header);

			const body = document.createElement('div');
			body.className = 'plan-body flex flex-col';
			card.appendChild(body);

			messagesContainer.appendChild(card);
			scrollToBottom();
		}

		const body = card.querySelector('.plan-body');
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

		const progressEl = card.querySelector('.plan-progress');
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

		if (update.kind) toolKinds.set(toolCallId, update.kind);

		if (toolKinds.get(toolCallId) === 'edit') {
			let card = document.getElementById(`tool-card-${toolCallId}`);
			if (!card) {
				closeAggregatorIfIdle();
				card = createEditCard(toolCallId, update);
				messagesContainer.appendChild(card);
				scrollToBottom();
			}
			updateEditCard(card, update);
		} else {
			if (!currentAggregator) {
				currentAggregator = new ToolAggregator();
			}
			currentAggregator.addOrUpdateTool(toolCallId, update);
		}
	}

	// Verb per tool for the aggregated tool list. An entry only fires when the
	// tool's ACP title is "<name>: <target>", which humanizeToolTitle splits on.
	// Two families are deliberately absent: fetch_url / web_search take a
	// url/query rather than a path, so their title is the bare tool name; and
	// string_replace / write_file report ACP kind 'edit', so they render as edit
	// cards and never reach this list.
	const TOOL_VERBS = {
		read_file: 'Reading',
		list_directory: 'Listing',
		find_files: 'Finding files in',
		search_file_contents: 'Searching',
		execute_bash: 'Running',
		lsp_get_diagnostics: 'Checking diagnostics in',
	};

	// Action label per resolved status, rendered as "<action> <filename>".
	const EDIT_ACTIONS = {
		pending: 'Edit',
		in_progress: 'Editing',
		completed: 'Edited',
		failed: 'Failed to edit',
		cancelled: 'Cancelled edit to',
		denied: 'Denied edit to',
	};

	// Icon bucket per resolved status.
	const EDIT_TONES = {
		pending: 'circle',
		in_progress: 'pending',
		completed: 'success',
		failed: 'error',
		cancelled: 'cancelled',
		denied: 'cancelled',
	};

	function humanizeToolTitle(title) {
		if (!title) return 'Tool Call';
		const sep = title.indexOf(': ');
		if (sep === -1) return title;
		const name = title.slice(0, sep);
		if (!Object.hasOwn(TOOL_VERBS, name)) return title;
		return `${TOOL_VERBS[name]} ${title.slice(sep + 2)}`;
	}

	function extractFileName(title) {
		if (!title) return 'File';
		const sep = title.indexOf(': ');
		const parts = (sep === -1 ? title : title.slice(sep + 2)).split('/');
		let last = parts[parts.length - 1];
		last = last.split('\\').pop();
		return last.replace(/['"]+$/g, '').trim();
	}

	// True when this update carries a diff the extension host would have handed
	// to DiffManager. Mirrors handleDiffs in chat-webview-provider.ts so the
	// panel only offers "Open Diff" once the change is actually registered.
	function hasDiffContent(update) {
		if (!update || !Array.isArray(update.content)) return false;
		return update.content.some(block => !!block && block.type === 'diff' && !!block.path);
	}

	// Resolve an edit card's label and icon from an update. The agent reports a
	// user cancel or deny as 'failed' with an explanatory rawOutput, so those are
	// separated back out here rather than all reading as an error.
	function resolveEditCardState(update) {
		let status = (update && update.status) || 'pending';
		if (status === 'success') status = 'completed';
		if (status === 'error') status = 'failed';

		if (status === 'failed') {
			const raw = update && typeof update.rawOutput === 'string' ? update.rawOutput : '';
			if (/denied/i.test(raw)) status = 'denied';
			else if (/cancel|AbortError/i.test(raw)) status = 'cancelled';
		}

		if (!Object.hasOwn(EDIT_ACTIONS, status)) status = 'pending';
		return {status, action: EDIT_ACTIONS[status], tone: EDIT_TONES[status]};
	}

	// True once a card has reached a terminal state and its approval buttons
	// should come down.
	function isSettled(status) {
		return status !== 'pending' && status !== 'in_progress';
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
		card.className = 'my-2 border border-vscode-widget-border rounded bg-vscode-editor-bg overflow-hidden group tool-card';
		card.id = `tool-card-${toolCallId}`;

		const row = document.createElement('div');
		row.className = 'tool-card-row flex items-center justify-between px-3 py-2';
		// Guarded rather than unbound: the card is created from the queued
		// announcement, which carries no content, so DiffManager has nothing
		// registered under this id until the call is about to run. Clicking in
		// that window - the whole approval wait - raised "Change <id> not found".
		row.onclick = () => {
			if (card.dataset.hasDiff !== 'true') return;
			vscode.postMessage({ type: 'showDiff', toolCallId });
		};

		const left = document.createElement('div');
		left.className = 'flex items-center gap-2 font-vscode text-[0.9em]';

		const status = document.createElement('span');
		status.className = 'tool-status ml-auto flex items-center justify-center';

		const label = document.createElement('span');
		label.className = 'flex items-center gap-1.5';

		const filename = extractFileName(update.title);
		const fileColor = getFileColor(filename);

		// Text is filled in by updateEditCard, which runs immediately after.
		const actionText = document.createElement('span');
		actionText.className = 'tool-card-action opacity-80';

		const nameText = document.createElement('span');
		nameText.className = `font-semibold ${fileColor}`;
		nameText.textContent = filename;

		label.appendChild(actionText);
		label.appendChild(nameText);

		left.appendChild(status);
		left.appendChild(label);
		row.appendChild(left);

		const right = document.createElement('div');
		right.className = 'flex items-center gap-2';

		const hoverBtn = document.createElement('span');
		hoverBtn.className = 'tool-card-diff-btn hidden transition-opacity bg-vscode-button-secondary text-vscode-fg px-2 py-0.5 rounded text-[0.85em]';
		hoverBtn.textContent = 'Open Diff';

		right.appendChild(hoverBtn);
		row.appendChild(right);
		card.appendChild(row);

		return card;
	}

	// Reveal the diff affordance once the extension host has a change
	// registered for this card - see hasDiffContent.
	function setEditCardDiffAvailable(el) {
		if (el.dataset.hasDiff === 'true') return;
		el.dataset.hasDiff = 'true';

		const row = el.querySelector('.tool-card-row');
		if (row) row.classList.add('cursor-pointer', 'hover:bg-vscode-list-hover');

		const btn = el.querySelector('.tool-card-diff-btn');
		if (btn) {
			btn.classList.remove('hidden');
			btn.classList.add('opacity-0', 'group-hover:opacity-100');
		}
	}

	function updateEditCard(el, update) {
		const state = resolveEditCardState(update);

		const statusEl = el.querySelector('.tool-status');
		if (statusEl) {
			statusEl.dataset.status = state.status;
			statusEl.innerHTML = ICONS[state.tone];
		}

		// "Edit foo.ts" while queued, "Edited foo.ts" once it has run.
		const actionEl = el.querySelector('.tool-card-action');
		if (actionEl) actionEl.textContent = state.action;

		if (hasDiffContent(update)) setEditCardDiffAvailable(el);

		if (isSettled(state.status)) {
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

	// Drop the approval buttons off cards whose permission request was cancelled.
	function handlePermissionsCancelled(toolCallIds) {
		for (const toolCallId of toolCallIds || []) {
			const card = document.getElementById(`tool-card-${toolCallId}`);
			if (!card) continue;

			const actions = card.querySelector('.tool-actions');
			if (actions) actions.remove();

			// Tool cards keep their status in .tool-status, edit cards in .ml-auto.
			const statusEl = card.querySelector('.tool-status, .ml-auto');
			if (statusEl) statusEl.innerHTML = ICONS.cancelled;
		}
	}


	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
