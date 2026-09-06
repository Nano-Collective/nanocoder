(function () {
	// @ts-ignore - acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	const messagesContainer = document.getElementById('messages-container');
	const chatInput = document.getElementById('chat-input');
	const composerBox = document.getElementById('composer-box');
	const artifactBar = document.getElementById('artifact-bar');
	const artifactLinks = document.getElementById('artifact-links');
	const contextChipsContainer = document.getElementById('context-chips');
	const contextChipsClearBtn = document.getElementById('context-chips-clear');
	const addMenuBtn = document.getElementById('add-menu-btn');
	const addMenuDropdown = document.getElementById('add-menu-dropdown');

	// [{path, name, kind: 'file'|'folder', agentEdited?: boolean}]. Entries the
	// agent contributed are flagged so submitMessage can leave them out.
	let attachedPaths = [];

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

	// ── Slash command autocomplete state ────────────────────
	const slashDropdown = document.getElementById('slash-dropdown');
	const { SLASH_COMMANDS, findSlashCommandToken, applySlashCommand } = globalThis.NanocoderSlashCommandUtils;

	let slashSuggestions = [];
	let slashSelectedIndex = 0;
	/**
	 * Set after a selection lands and after Escape, so the caret move we just
	 * made doesn't immediately reopen the menu on the name we just completed.
	 * Cleared by the next real keystroke.
	 */
	let slashSuppressed = false;

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
					const nested = triggerId === 'provider-trigger' || triggerId === 'mode-trigger';
					closeAllDropdowns(nested ? 'composer-settings' : undefined);
					if (isHidden) {
						this.dropdown.classList.remove('hidden');
					}
				});
			}

			syncModeBadge() {
				if (this.label?.id !== 'mode-trigger-label') return;
				const badge = document.getElementById('composer-mode-badge');
				if (badge) badge.textContent = this.label.textContent || '';
				const settingsTrigger = document.getElementById('composer-settings-trigger');
				if (settingsTrigger && this.label.textContent) {
					settingsTrigger.title = `Provider and approval mode (${this.label.textContent})`;
					settingsTrigger.setAttribute('aria-label', `Composer settings, ${this.label.textContent}`);
				}
			}

			setOptions(options, selectedValue) {
				this.dropdown.innerHTML = '';
				
				if (!options || options.length === 0) {
					this.label.textContent = 'None available';
					this.trigger.disabled = true;
					this.trigger.classList.add('opacity-50');
					this.syncModeBadge();
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
				this.syncModeBadge();
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

		const composerSettingsTrigger = document.getElementById('composer-settings-trigger');
		const composerSettings = document.getElementById('composer-settings');
		if (composerSettingsTrigger && composerSettings) {
			composerSettingsTrigger.addEventListener('click', (e) => {
				e.stopPropagation();
				const opening = composerSettings.classList.contains('hidden');
				closeAllDropdowns();
				if (opening) {
					composerSettings.classList.remove('hidden');
					composerSettingsTrigger.setAttribute('aria-expanded', 'true');
				}
			});
			composerSettings.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		}

		document.addEventListener('click', () => {
			closeAllDropdowns();
		});
	}

	initDropdowns();

	function closeAllDropdowns(keepId) {
		['provider-dropdown', 'model-dropdown', 'mode-dropdown', 'composer-settings'].forEach((id) => {
			if (id !== keepId) {
				document.getElementById(id)?.classList.add('hidden');
			}
		});
		if (addMenuDropdown) addMenuDropdown.classList.add('hidden');
		const composerSettings = document.getElementById('composer-settings');
		const composerSettingsTrigger = document.getElementById('composer-settings-trigger');
		if (composerSettingsTrigger) {
			const open = composerSettings && !composerSettings.classList.contains('hidden');
			composerSettingsTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
		}
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

		attachPath(item);

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

	const EDIT_TOOLS = new Set(['write_file', 'string_replace', 'diff_edit', 'file_op']);
	const EXECUTE_TOOLS = new Set(['execute_bash']);

	function timelineKind(toolName) {
		if (EDIT_TOOLS.has(toolName)) return 'edit';
		if (EXECUTE_TOOLS.has(toolName)) return 'execute';
		return 'other';
	}

	function timelineRelativeTime(timestamp) {
		const diffMs = Date.now() - new Date(timestamp).getTime();
		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	const timelineStrip = (function createTimelineStrip() {
		const root = document.getElementById('timeline-strip');
		const nodesEl = document.getElementById('timeline-nodes');
		const trackEl = document.getElementById('timeline-track');
		const hintEl = document.getElementById('timeline-hint');
		const confirmEl = document.getElementById('timeline-confirm');
		if (!root || !nodesEl || !confirmEl) {
			return {
				setEntries() {},
				setDisabled() {},
				clear() {},
			};
		}

		let entries = [];

		function setHint(text) {
			if (hintEl) hintEl.textContent = text || '';
		}

		function hideConfirm() {
			confirmEl.classList.add('hidden');
			confirmEl.innerHTML = '';
		}

		function showConfirm(entry) {
			const files = (entry.filesChanged || []).slice(0, 3).join(', ');
			const extra = (entry.filesChanged || []).length > 3 ? '…' : '';
			confirmEl.innerHTML = '';

			const text = document.createElement('div');
			text.textContent =
				`Revert workspace and conversation to before step ${entry.seq} (${entry.title || entry.toolName})? ` +
				`This deletes later chat messages and undoes later file changes.` +
				(files ? ` Files: ${files}${extra}` : '');
			confirmEl.appendChild(text);

			const actions = document.createElement('div');
			actions.className = 'timeline-confirm-actions';

			const revertBtn = document.createElement('button');
			revertBtn.textContent = 'Revert';
			revertBtn.style.background = 'var(--vscode-button-background)';
			revertBtn.style.color = 'var(--vscode-button-foreground)';
			revertBtn.addEventListener('click', () => {
				vscode.postMessage({ type: 'revertToCheckpoint', checkpointId: entry.id });
				hideConfirm();
			});

			const cancelBtn = document.createElement('button');
			cancelBtn.textContent = 'Cancel';
			cancelBtn.style.background = 'var(--vscode-button-secondaryBackground)';
			cancelBtn.style.color = 'var(--vscode-button-secondaryForeground, inherit)';
			cancelBtn.addEventListener('click', hideConfirm);

			actions.appendChild(revertBtn);
			actions.appendChild(cancelBtn);
			confirmEl.appendChild(actions);
			confirmEl.classList.remove('hidden');
		}

		// The label goes in a dedicated line under the strip rather than an
		// absolutely-positioned bubble: the track has to clip horizontally to
		// scroll, and a clipping box clips both axes, so a bubble above the dot
		// would be cut off. A static line also reads on focus, not just hover.
		function bindHint(el, text) {
			el.addEventListener('mouseenter', () => setHint(text));
			el.addEventListener('focus', () => setHint(text));
			el.addEventListener('mouseleave', () => setHint(''));
			el.addEventListener('blur', () => setHint(''));
		}

		function render() {
			nodesEl.innerHTML = '';
			setHint('');
			if (entries.length === 0) {
				root.classList.add('hidden');
				hideConfirm();
				return;
			}
			root.classList.remove('hidden');

			const line = document.createElement('div');
			line.className = 'timeline-line';
			nodesEl.appendChild(line);

			for (const entry of entries) {
				const files = (entry.filesChanged || []).slice(0, 2).join(', ');
				const label = `Step ${entry.seq} · ${entry.title || entry.toolName}` +
					(files ? ` · ${files}` : '') +
					` · ${timelineRelativeTime(entry.timestamp)}`;

				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'timeline-node';
				btn.dataset.kind = timelineKind(entry.toolName);
				btn.dataset.id = entry.id;
				btn.setAttribute('aria-label', label);
				btn.title = label;

				const dot = document.createElement('span');
				dot.className = 'timeline-dot';
				btn.appendChild(dot);

				bindHint(btn, label);
				btn.addEventListener('click', () => showConfirm(entry));
				nodesEl.appendChild(btn);
			}

			const nowBtn = document.createElement('button');
			nowBtn.type = 'button';
			nowBtn.className = 'timeline-node is-selected';
			nowBtn.dataset.kind = 'now';
			nowBtn.setAttribute('aria-label', 'Current state');
			nowBtn.title = 'Current state';
			const nowDot = document.createElement('span');
			nowDot.className = 'timeline-dot';
			nowBtn.appendChild(nowDot);
			bindHint(nowBtn, 'Now');
			nowBtn.addEventListener('click', hideConfirm);
			nodesEl.appendChild(nowBtn);

			// The scroller is the track, not the flex row inside it.
			if (trackEl) trackEl.scrollLeft = trackEl.scrollWidth;
		}

		return {
			setEntries(next) {
				entries = Array.isArray(next) ? next : [];
				hideConfirm();
				render();
			},
			setDisabled(disabled) {
				root.classList.toggle('timeline-disabled', Boolean(disabled));
			},
			clear() {
				this.setEntries([]);
			},
		};
	})();

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
	// True from the moment Stop/Escape is pressed until the next prompt starts.
	// Cancellation is a round trip: the agent keeps emitting updates for the
	// turn it was told to stop (a tool already in flight, the queued calls it
	// then marks cancelled), and those land after the UI has already closed the
	// turn. Without this flag they rebuild a second tool card group that looks
	// like the cancelled work restarting.
	let turnCancelled = false;
	// The one collapsible box holding this turn's thoughts, tool groups, edit
	// cards and plan. Null between turns.
	let currentWorkSummary = null;
	// Which summary owns a given tool card / plan card, so a late update lands
	// back in the turn it belongs to rather than opening a new one. Cleared per
	// turn, because ids are only unique within a turn.
	const workSummaryByToolCallId = new Map();
	const workSummaryByPlanId = new Map();
	// When the turn started, so the summary reports the whole turn and not just
	// the stretch from its first thought. Recorded on the user message rather
	// than in the summary's constructor, which runs later and lazily.
	let turnStartedAt = 0;
	let currentTurnFooter = null;
	let visualLoader = null;
	const toolKinds = new Map();
	// Absolute paths each tool call touches, kept until the call lands: the
	// completion update carries a status and nothing else. Same lifetime as
	// toolKinds, and cleared with it.
	const toolLocations = new Map();
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
	function setProcessing(active, outcome = 'completed') {
		isProcessing = active;
		timelineStrip.setDisabled(active);
		if (!active) {
			// Globally settle any stuck spinners across all tool cards, in case
			// several tool groups were created in the same session.
			const allSpinners = document.querySelectorAll('.tool-status');
			allSpinners.forEach(statusEl => {
				const status = statusEl.dataset.status;
				if (status === 'pending' || status === 'in_progress') {
					statusEl.innerHTML = ICONS.cancelled;
					statusEl.dataset.status = 'cancelled';
				}
			});
			stopVisualLoader();
			finishCurrentWorkSummary(outcome);
		}
		if (sendStopBtn) {
			sendStopBtn.title = active ? 'Stop (cancel)' : 'Send (Enter)';
			sendStopBtn.classList.toggle('is-processing', active);
		}
	}

	function setPlanReviewActive(active) {
		if (active) {
			if (typeof closeMention === 'function') closeMention();
			if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
		}
		chatInput.disabled = active;
		composerBox.classList.toggle('opacity-60', active);
		composerBox.classList.toggle('pointer-events-none', active);
	}

	function removePlanReview() {
		const existing = document.getElementById('plan-review-card');
		if (existing) existing.remove();
		setPlanReviewActive(false);
	}

	function renderArtifacts(artifacts) {
		if (!artifactBar || !artifactLinks) return;
		artifactLinks.innerHTML = '';
		const labels = {
			implementation_plan: 'Plan',
			task: 'Tasks',
			walkthrough: 'Walkthrough',
		};
		for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
			if (!artifact || !labels[artifact.kind] || typeof artifact.path !== 'string') continue;
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'bg-vscode-editor-bg border border-vscode-widget-border hover:border-vscode-focusBorder rounded px-2 py-1 cursor-pointer font-vscode text-[0.78em] text-vscode-fg';
			button.textContent = labels[artifact.kind];
			button.title = artifact.path;
			button.onclick = () => {
				vscode.postMessage({type: 'openPath', path: artifact.path, kind: 'file'});
			};
			artifactLinks.appendChild(button);
		}
		const hasArtifacts = artifactLinks.childElementCount > 0;
		artifactBar.classList.toggle('hidden', !hasArtifacts);
		artifactBar.classList.toggle('flex', hasArtifacts);
	}

	function renderPlanReview(artifactPath) {
		removePlanReview();
		endCurrentTextBlock();

		const card = document.createElement('div');
		card.id = 'plan-review-card';
		card.className = 'my-3 border border-vscode-focusBorder rounded-lg bg-vscode-widget-bg overflow-hidden shrink-0';

		const header = document.createElement('div');
		header.className = 'px-3 py-2 bg-vscode-widget-header border-b border-vscode-widget-border';
		const title = document.createElement('div');
		title.className = 'font-vscode text-[0.95em] font-semibold';
		title.textContent = 'Implementation plan ready';
		const subtitle = document.createElement('div');
		subtitle.className = 'font-vscode text-[0.82em] opacity-65 mt-0.5';
		subtitle.textContent = 'Review the saved plan before implementation begins.';
		header.appendChild(title);
		header.appendChild(subtitle);

		const body = document.createElement('div');
		body.className = 'px-3 py-3 flex flex-col gap-2.5';
		const openButton = document.createElement('button');
		openButton.type = 'button';
		openButton.className = 'w-full text-left bg-vscode-editor-bg border border-vscode-widget-border hover:border-vscode-focusBorder rounded px-3 py-2 cursor-pointer font-vscode text-[0.9em] transition-colors';
		openButton.textContent = 'Open implementation_plan.md';
		openButton.title = artifactPath;
		openButton.onclick = () => {
			vscode.postMessage({type: 'openPath', path: artifactPath, kind: 'file'});
		};

		const actions = document.createElement('div');
		actions.className = 'flex flex-col gap-1.5';
		const approveButton = document.createElement('button');
		approveButton.type = 'button';
		approveButton.className = 'w-full border-none rounded px-3 py-2 cursor-pointer font-vscode text-[0.9em] bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover';
		approveButton.textContent = 'Yes, execute this plan';
		approveButton.onclick = () => {
			removePlanReview();
			// Show the approval as a real user turn. The extension host sends the
			// approved-plan prompt straight through acpClient.prompt(), bypassing
			// submitMessage(), so nothing else would put a bubble in the
			// transcript and the turn would appear to start from nowhere.
			appendMessage('Approved the implementation plan. Proceeding.', 'user');
			currentTurnEl = null;
			currentTextEl = null;
			setProcessing(true);
			startVisualLoader();
			vscode.postMessage({type: 'approvePlan'});
		};

		const reviseButton = document.createElement('button');
		reviseButton.type = 'button';
		reviseButton.className = 'w-full bg-transparent border border-vscode-button-secondary text-vscode-fg hover:bg-vscode-button-secondaryHover rounded px-3 py-2 cursor-pointer font-vscode text-[0.9em]';
		reviseButton.textContent = 'No, tell Nanocoder what to change';
		reviseButton.onclick = () => {
			removePlanReview();
			vscode.postMessage({type: 'revisePlan'});
			chatInput.focus();
		};

		actions.appendChild(approveButton);
		actions.appendChild(reviseButton);
		body.appendChild(openButton);
		body.appendChild(actions);
		card.appendChild(header);
		card.appendChild(body);
		messagesContainer.appendChild(card);
		setPlanReviewActive(true);
		scrollToBottom();
	}

	// Shared by the Stop button and Escape so the two can't drift apart.
	function requestCancel() {
		vscode.postMessage({ type: 'cancel' });
		turnCancelled = true;
		setProcessing(false, 'cancelled');
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

	// ── Slash command functions ──────────────────────────────

	function hideSlashDropdown() {
		if (!slashDropdown) return;
		const wasOpen = !slashDropdown.classList.contains('hidden');
		slashDropdown.classList.add('hidden');
		slashDropdown.innerHTML = '';
		slashSuggestions = [];
		slashSelectedIndex = 0;
		// The textarea is a single combobox shared with the @-mention listbox,
		// so only reset its aria state when this dropdown is what set it.
		// Otherwise every keystroke typed into an open mention list would
		// announce the list as collapsed.
		if (wasOpen && !mentionOpen) {
			chatInput.removeAttribute('aria-activedescendant');
			chatInput.setAttribute('aria-expanded', 'false');
		}
	}

	/** @returns {boolean} whether the command was actually applied. */
	function applySlashSelection(command) {
		const result = applySlashCommand(
			chatInput.value,
			chatInput.selectionStart,
			chatInput.selectionEnd,
			command,
		);
		hideSlashDropdown();
		if (!result) return false;

		// Set before the caret moves, because that move fires selectionchange.
		// A command with no template completes to its own name, which is itself
		// a valid token, so without this the menu would reopen on top of it and
		// swallow the Enter that runs it.
		slashSuppressed = true;
		chatInput.value = result.text;
		chatInput.setSelectionRange(result.cursor, result.cursor);
		// Resized here rather than by dispatching a synthetic input event: that
		// would clear the suppression flag and re-run the mention search.
		chatInput.style.height = 'auto';
		chatInput.style.height = chatInput.scrollHeight + 'px';
		chatInput.focus();
		return true;
	}

	function renderSlashDropdown(commands) {
		if (!slashDropdown) return;
		slashDropdown.innerHTML = '';
		slashSuggestions = commands;
		commands.forEach((command, index) => {
			const item = document.createElement('button');
			item.type = 'button';
			item.id = 'slash-option-' + index;
			item.setAttribute('role', 'option');
			item.setAttribute('aria-selected', index === slashSelectedIndex ? 'true' : 'false');
			item.className = 'w-full text-left bg-transparent border-none px-3 py-2 cursor-pointer transition-colors flex items-start justify-between gap-3';
			if (index === slashSelectedIndex) {
				item.classList.add('bg-vscode-list-active', 'text-vscode-list-activeFg');
				chatInput.setAttribute('aria-activedescendant', item.id);
			} else {
				item.classList.add('hover:bg-vscode-list-hover', 'text-vscode-dropdown-foreground');
			}
			const left = document.createElement('span');
			left.className = 'font-semibold text-[0.9em]';
			left.textContent = command.name;
			const right = document.createElement('span');
			right.className = 'text-[0.8em] opacity-70';
			right.textContent = command.description;
			item.appendChild(left);
			item.appendChild(right);
			// mousedown rather than click, matching the mention rows: click
			// would let the textarea blur first, and the blur handler closes
			// the dropdown before the selection lands.
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				applySlashSelection(command);
			});
			slashDropdown.appendChild(item);
		});
		slashDropdown.classList.remove('hidden');
		chatInput.setAttribute('aria-expanded', 'true');
	}

	function updateSlashAutocomplete() {
		if (!slashDropdown || slashSuppressed) {
			hideSlashDropdown();
			return;
		}
		const token = findSlashCommandToken(
			chatInput.value,
			chatInput.selectionStart,
			chatInput.selectionEnd,
		);
		if (!token) {
			hideSlashDropdown();
			return;
		}
		const filtered = SLASH_COMMANDS.filter(command =>
			command.name.slice(1).toLowerCase().startsWith(token.query)
		);
		if (filtered.length === 0) {
			hideSlashDropdown();
			return;
		}
		slashSelectedIndex = 0;
		renderSlashDropdown(filtered);
	}

	// Auto-resize textarea
	chatInput.addEventListener('input', function () {
		this.style.height = 'auto';
		this.style.height = (this.scrollHeight) + 'px';
		// Typing is what lifts a dismissal, so this runs before the update.
		slashSuppressed = false;
		updateSlashAutocomplete();
	});

	if (slashDropdown) {
		chatInput.addEventListener('blur', hideSlashDropdown);
		// Catches caret moves that fire no input event, which would otherwise
		// leave the menu open over a token that is no longer under the caret.
		document.addEventListener('selectionchange', () => {
			if (document.activeElement === chatInput) {
				updateSlashAutocomplete();
			}
		});
	}

	// Handle Enter to submit (Shift+Enter for newline)
	chatInput.addEventListener('keydown', (e) => {
		// Slash command navigation wins before mention navigation.
		if (slashDropdown && !slashDropdown.classList.contains('hidden') && slashSuggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				slashSelectedIndex = (slashSelectedIndex + 1) % slashSuggestions.length;
				renderSlashDropdown(slashSuggestions);
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				slashSelectedIndex = (slashSelectedIndex - 1 + slashSuggestions.length) % slashSuggestions.length;
				renderSlashDropdown(slashSuggestions);
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				// Only claim the key if the completion actually landed. If the
				// caret has moved off the token the menu was opened for, this
				// falls through to submit instead of silently eating the Enter.
				if (applySlashSelection(slashSuggestions[slashSelectedIndex])) {
					e.preventDefault();
					return;
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				// Same reason as the mention dropdown below: the document-level
				// handler cancels the in-flight request on Escape whenever
				// isProcessing, so without this, dismissing the menu mid-stream
				// would also kill the run.
				e.stopPropagation();
				// Stays dismissed until the next keystroke; without this the
				// caret move from Escape would reopen it via selectionchange.
				slashSuppressed = true;
				hideSlashDropdown();
				return;
			}
		}

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
		if (e.key !== 'Escape') return;
		const chromeOpen = ['provider-dropdown', 'model-dropdown', 'mode-dropdown', 'composer-settings'].some(
			(id) => !document.getElementById(id)?.classList.contains('hidden'),
		) || (addMenuDropdown && !addMenuDropdown.classList.contains('hidden'));
		if (chromeOpen) {
			e.preventDefault();
			e.stopPropagation();
			closeAllDropdowns();
			return;
		}
		if (isProcessing) {
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
		// Files the agent wrote share the chip row but are a review affordance,
		// not an attachment - only what the user picked is part of the prompt.
		const attachments = attachedPaths.filter(a => !a.agentEdited);
		if (!text && attachments.length === 0 && pendingImages.length === 0) return;

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
			attachedPaths = attachedPaths.filter(a => a.agentEdited);
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
		if (attachments.length > 0) {
			const contextText = attachments
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

		// Clear the user's chips after sending. The agent's stay: they are a
		// running list of what it changed, not an outbox.
		attachedPaths = attachedPaths.filter(a => a.agentEdited);
		renderChips();

		dispatchPrompt(text, imagesToSubmit);
	}

	// Send `text` to the agent as a turn of its own. Split out of
	// submitMessage so an editor-driven prompt can bypass the composer: going
	// through it would overwrite a draft the user is typing and sweep up chips
	// and images they staged for a different question.
	function dispatchPrompt(text, images) {
		// A new turn re-opens the door to tool updates that the previous
		// cancel closed.
		turnCancelled = false;

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

	/** Last segment of a path, for either separator. */
	function basename(filePath) {
		return String(filePath).trim().split(/[/\\]/).pop();
	}

	/**
	 * Identity key for a path, for comparing chips only - never for display or
	 * for anything sent to the host, which both keep the path as it arrived.
	 *
	 * The row is fed by two producers that spell the same file differently: the
	 * agent's chips come from resolve() in the ACP layer, the user's from
	 * uri.fsPath in the extension host, and on Windows those disagree about the
	 * case of the drive letter and about separators. Compared raw, one file
	 * shows up twice - once solid, once dashed - and attaching it fails to
	 * promote the agent's chip. Only the drive letter is case-folded: the rest
	 * is left alone so this stays correct on a case-sensitive filesystem, where
	 * `/a/B.ts` and `/a/b.ts` really are two files.
	 */
	function pathKey(filePath) {
		return String(filePath)
			.replace(/\\/g, '/')
			.replace(/^([A-Za-z]):/, (_match, drive) => `${drive.toLowerCase()}:`);
	}

	/** Whether two paths name the same file. */
	function samePath(a, b) {
		return pathKey(a) === pathKey(b);
	}

	/**
	 * Attach a path the user picked. A file the agent already put in the row is
	 * promoted rather than ignored, so attaching it deliberately still sends it
	 * with the next message.
	 */
	function attachPath(item) {
		const existing = attachedPaths.find(a => samePath(a.path, item.path));
		if (existing) {
			existing.agentEdited = false;
		} else {
			attachedPaths.push({ path: item.path, name: item.name, kind: item.kind });
		}
		renderChips();
	}

	/**
	 * Surface a file the agent created or edited in the context row, so it can
	 * be opened and reviewed without hunting for it in the explorer. Flagged
	 * `agentEdited` so it is left out of the next prompt: the agent just wrote
	 * the file, and re-inlining it would spend context to say nothing new.
	 */
	function addChangedFileChip(filePath) {
		if (attachedPaths.some(a => samePath(a.path, filePath))) return;
		attachedPaths.push({
			path: filePath,
			name: basename(filePath),
			kind: 'file',
			agentEdited: true,
		});
		renderChips();
	}

	/**
	 * Drop a path from the context row because the file behind it is gone. This
	 * takes the user's own attachments too: a deleted path would otherwise ride
	 * along on the next prompt and expand to nothing.
	 */
	function dropChip(filePath) {
		const remaining = attachedPaths.filter(a => !samePath(a.path, filePath));
		if (remaining.length === attachedPaths.length) return;
		attachedPaths = remaining;
		renderChips();
	}

	// Only the agent's chips go: what the user attached is theirs to remove.
	if (contextChipsClearBtn) {
		contextChipsClearBtn.addEventListener('click', () => {
			attachedPaths = attachedPaths.filter(a => !a.agentEdited);
			renderChips();
		});
	}

	/**
	 * Label the bulk-dismiss control, or hide it when the row holds nothing the
	 * agent put there. A refactor turn can add dozens of chips, and dismissing
	 * them one x at a time is not a realistic ask - the row itself is capped and
	 * scrolls, so this is the way out of a long one.
	 */
	function renderChipsClear() {
		if (!contextChipsClearBtn) return;
		const changed = attachedPaths.filter(a => a.agentEdited).length;
		if (changed === 0) {
			contextChipsClearBtn.classList.add('hidden');
			contextChipsClearBtn.textContent = '';
			return;
		}
		contextChipsClearBtn.classList.remove('hidden');
		contextChipsClearBtn.textContent = `Clear ${changed} changed file${changed === 1 ? '' : 's'}`;
		contextChipsClearBtn.setAttribute(
			'title',
			'Dismiss the files Nanocoder changed. Files you attached stay.',
		);
	}

	function renderChips() {
		contextChipsContainer.innerHTML = '';
		if (attachedPaths.length === 0) {
			contextChipsContainer.classList.add('hidden');
			renderChipsClear();
			return;
		}
		contextChipsContainer.classList.remove('hidden');
		renderChipsClear();
		for (const item of attachedPaths) {
			const chip = document.createElement('span');
			chip.className = item.agentEdited
				? 'context-chip context-chip-edited'
				: 'context-chip';

			const iconSpan = document.createElement('span');
			iconSpan.className = 'chip-icon';
			iconSpan.appendChild(item.kind === 'folder' ? createFolderIcon() : createFileIcon());
			iconSpan.style.marginRight = '4px';
			iconSpan.style.display = 'flex';
			iconSpan.style.alignItems = 'center';

			const nameSpan = document.createElement('span');
			nameSpan.className = 'chip-name';
			nameSpan.setAttribute(
				'title',
				item.agentEdited
					? `${item.path}\nChanged by Nanocoder - click to open`
					: item.path,
			);
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
					attachedPaths = attachedPaths.filter(a => !samePath(a.path, item.path));
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

		// Editor tab drags carry a JSON array of URI strings under
		// `ResourceURLs` instead of a uri-list. Flatten it to the same
		// newline-separated shape so there is one parser downstream.
		const resourceUrlsToUriList = (raw) => {
			if (!raw) return '';
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter(u => typeof u === 'string').join('\n') : '';
			} catch {
				return '';
			}
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

			// VS Code's explorer publishes text/uri-list; some sources only set
			// text/plain. resource-urls is what the editor uses for tab drags.
			const uris =
				e.dataTransfer.getData('text/uri-list') ||
				e.dataTransfer.getData('text/plain') ||
				resourceUrlsToUriList(e.dataTransfer.getData('resourceurls'));
			if (!uris) return;

			const isWindows =
				navigator.userAgentData?.platform?.toLowerCase().includes('win') ||
				navigator.userAgent.includes('Windows');
			const paths = NanocoderUriUtils.parseDropPayload(uris, isWindows);

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
			// Close the previous turn's summary before the new message is
			// inserted, so it can never swallow work from the turn after it.
			// The ownership maps deliberately survive: a tool the agent was told
			// to stop still reports back after the next turn has started, and
			// that update belongs in the turn that ran it. They are cleared with
			// the transcript instead.
			finishCurrentWorkSummary('completed');
			turnStartedAt = Date.now();
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
				const name = basename(path);
				extractedChips.push({ kind, path: path.trim(), name });
				return ''; // Remove from text
			});

			// Handle post-injected format (from history sync)
			parsedContent = parsedContent.replace(/<context path="([^"]+)"(?: type="([^"]+)")?>[\s\S]*?<\/context>/g, (match, path, type) => {
				const kind = type === 'directory' ? 'folder' : 'file';
				const name = basename(path);
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
				attachPath({ path, name, kind });
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
				removePlanReview();
				currentTurnFooter = null;
				toolKinds.clear();
				toolLocations.clear();
				// A new or resumed conversation has no relationship to the files
				// the previous one touched.
				attachedPaths = attachedPaths.filter(a => !a.agentEdited);
				renderChips();
				turnCancelled = false;
				agentTurnId = 0;
				turnStartedAt = 0;
				lastAgentRawTurnId = -1;
				lastAgentSegments = '';
				lastAgentRawText = '';
				// The transcript was just wiped, so the summary has no DOM left to
				// close - drop it rather than stamping a duration on a box the
				// user can no longer see.
				discardCurrentWorkSummary();
				workSummaryByToolCallId.clear();
				workSummaryByPlanId.clear();
				if (!message.isLoading) {
					timelineStrip.clear();
				}
				setProcessing(false);
				break;
			case 'sessionLoaded':
				finishCurrentWorkSummary('completed');
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
			case 'planReviewRequested':
				setProcessing(false);
				renderPlanReview(message.artifactPath);
				break;
			case 'planReviewError':
				setProcessing(false);
				// Surface it in the transcript too. A toast alone is easy to miss,
				// and the approval bubble above it would otherwise sit there with
				// no visible outcome.
				appendMessage(
					`Could not approve the plan: ${message.message}`,
					'assistant',
				);
				break;
			case 'artifactsUpdated':
				renderArtifacts(message.artifacts);
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
			case 'updateTimeline':
				timelineStrip.setEntries(message.entries || []);
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
	// markdown block. Called whenever another element (the work summary or a
	// user message) is inserted - without this, text streamed after a tool
	// call is appended to the block ABOVE the summary, fusing pre-tool
	// and post-tool output into one paragraph.
	function endCurrentTextBlock() {
		flushPendingRender();
		closeAgentSegment();
		currentTurnEl = null;
		currentTextEl = null;
		syncLastAgentRawText();
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
			// Prose ends the current thought and tool group, so the next thought
			// or tool starts a fresh activity rather than extending one the
			// agent has already moved on from.
			currentWorkSummary?.endActivityGroup();
			if (update.content && update.content.text) {
				stopVisualLoader();
				appendChunk(update.content.text);
			}
		} else if (update.sessionUpdate === 'agent_thought_chunk') {
			const thoughtText = update.content && update.content.text;
			// Whitespace-only reasoning is not worth a section of its own: it
			// would reveal an empty summary and split the answer around it. Once
			// a thought is open, whitespace is real content and keeps flowing.
			if (thoughtText && (currentWorkSummary?.hasOpenThought() || thoughtText.trim())) {
				if (!currentWorkSummary?.hasOpenThought()) endCurrentTextBlock();
				ensureCurrentWorkSummary().appendThought(thoughtText);
			}
		} else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
			handleToolCallUpdate(update);
		} else if (update.sessionUpdate === 'plan') {
			handlePlanUpdate(update);
		} else if (update.sessionUpdate === 'prompt_response' || update.sessionUpdate === 'done') {
			// Show token usage (and estimated cost) for the finished turn
			appendUsageIndicator(update.usage, update.cost);
			// Turn is complete — restore the send button
			setProcessing(false, update.outcome || 'completed');
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
			if (action === 'edit-mcp') {
				// MCP servers live in .mcp.json, not agents.config.json.
				vscode.postMessage({ type: 'openConfigFile', file: '.mcp.json' });
			} else if (action === 'edit-providers' || action === 'edit-tools' || action === 'open-agents-config') {
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

	function formatWorkDuration(elapsedMs) {
		const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
		if (totalSeconds < 60) return `${totalSeconds}s`;

		const totalMinutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (totalMinutes < 60) {
			return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
		}

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
	}

	/**
	 * Open the turn's work summary, creating it on first use.
	 *
	 * Refuses to open one after a cancel: the agent keeps emitting updates for
	 * the turn it was told to stop (a tool already in flight, the calls queued
	 * behind it that it then marks cancelled), and those land after the UI has
	 * closed the turn. Without this they raise a second "Working..." box, with a
	 * live timer nothing will ever stop, for work the user just stopped.
	 *
	 * Deliberately not gated on `isProcessing`: resuming a session replays its
	 * whole thread as ACP updates with no turn running, and that history still
	 * has to render.
	 */
	function ensureCurrentWorkSummary() {
		if (!currentWorkSummary) {
			if (turnCancelled) return NULL_WORK_SUMMARY;
			currentWorkSummary = new WorkSummary(turnStartedAt || Date.now());
		}
		return currentWorkSummary;
	}

	function finishCurrentWorkSummary(outcome) {
		if (!currentWorkSummary) return;
		const summary = currentWorkSummary;
		// Cleared first: finish() collapses the box, and a collapse must not be
		// able to route more activity back into the turn it just closed.
		currentWorkSummary = null;
		summary.finish(outcome);
	}

	/** Drop the summary without stamping a duration, for a wiped transcript. */
	function discardCurrentWorkSummary() {
		if (!currentWorkSummary) return;
		currentWorkSummary.dispose();
		currentWorkSummary = null;
	}

	/**
	 * Absorbs activity that arrives with no turn to put it in - trailing updates
	 * after a cancel, mostly. Every call is a no-op and nothing is rendered.
	 */
	const NULL_WORK_SUMMARY = {
		el: null,
		hasOpenThought: () => false,
		appendThought() {},
		endThought() {},
		endActivityGroup() {},
		addOrUpdateTool() {},
		addStandaloneActivity() {},
		removeActivity(element) { element.remove(); },
		openForInteraction() {},
		finish() {},
		dispose() {},
	};

	/**
	 * One collapsible box per turn holding everything the agent did to answer:
	 * thoughts, tool groups, edit cards and the plan, in the order they arrived.
	 * The agent's prose stays outside it, so the answer is never hidden behind a
	 * collapsed header.
	 *
	 * The box is inserted at first activity rather than at turn start, so a turn
	 * that opens with prose and only then runs a tool keeps its transcript order.
	 */
	class WorkSummary {
		constructor(startedAt) {
			this.startedAt = startedAt;
			this.activityCount = 0;
			this.isOpen = true;
			this.isFinished = false;
			this.isAttached = false;
			// Set by a click on the header. Once the user has taken a view on
			// whether this box is open, the end of the turn does not overrule it.
			this.userToggled = false;
			this.currentThought = null;
			this.currentToolGroup = null;
			this.toolGroups = new Map();

			this.el = document.createElement('div');
			this.el.className = 'my-2 flex flex-col shrink-0 work-summary';

			// A button, not a div: the header is the only control on the box, so
			// it has to be reachable and toggleable from the keyboard.
			this.header = document.createElement('button');
			this.header.type = 'button';
			this.header.className = 'flex items-center gap-1.5 cursor-pointer opacity-70 text-vscode-fg hover:opacity-100 transition-opacity select-none w-fit bg-transparent border-none p-0';
			this.header.setAttribute('aria-expanded', 'true');
			this.header.onclick = () => this.toggle();

			this.title = document.createElement('span');
			this.title.className = 'font-vscode text-[0.85em] font-medium';
			this.title.textContent = 'Working...';

			this.chevron = document.createElement('span');
			this.chevron.className = 'flex items-center justify-center opacity-70';
			this.chevron.innerHTML = ICONS.chevron;
			this.chevron.style.transform = 'rotate(0deg)'; // open by default

			this.header.appendChild(this.title);
			this.header.appendChild(this.chevron);
			this.el.appendChild(this.header);

			this.body = document.createElement('div');
			this.body.className = 'mt-2 pl-3 border-l-[3px] border-vscode-border flex flex-col gap-2 min-w-0';
			this.el.appendChild(this.body);

			this.timer = setInterval(() => this.updateTimer(), 1000);
		}

		elapsedMs() {
			return Date.now() - this.startedAt;
		}

		updateTimer() {
			if (this.isFinished || !this.isAttached) return;
			this.title.textContent = `Working for ${formatWorkDuration(this.elapsedMs())}`;
		}

		attach() {
			if (this.isAttached) return;
			this.isAttached = true;
			messagesContainer.appendChild(this.el);
		}

		addActivity(element) {
			this.attach();
			this.activityCount++;
			// The header stays on 'Working...' until the first tick: a box that
			// opens on 'Working for 0s' reads worse than one that opens on a
			// label and grows a duration a second later.
			this.body.appendChild(element);
			scrollToBottom();
		}

		removeActivity(element) {
			if (element.parentElement !== this.body) return;
			element.remove();
			this.activityCount = Math.max(0, this.activityCount - 1);
			// An emptied box is noise, and finish() would stamp a duration on it.
			if (this.activityCount === 0 && this.isAttached) {
				this.isAttached = false;
				this.el.remove();
			}
		}

		hasOpenThought() {
			return this.currentThought !== null;
		}

		appendThought(chunk) {
			this.currentToolGroup = null;
			if (!this.currentThought) {
				this.currentThought = new WorkThought();
				this.addActivity(this.currentThought.el);
			}
			this.currentThought.append(chunk);
		}

		endThought() {
			if (!this.currentThought) return;
			this.currentThought.finish();
			this.currentThought = null;
		}

		/** Anything that is not another tool ends the run of tools before it. */
		endActivityGroup() {
			this.endThought();
			this.currentToolGroup = null;
		}

		addOrUpdateTool(toolCallId, update) {
			this.endThought();
			let group = this.toolGroups.get(toolCallId);
			if (!group) {
				if (!this.currentToolGroup) {
					this.currentToolGroup = new ToolAggregator();
					this.addActivity(this.currentToolGroup.el);
				}
				group = this.currentToolGroup;
				this.toolGroups.set(toolCallId, group);
			}
			group.addOrUpdateTool(toolCallId, update);
		}

		/** An edit or plan card: its own row, and it breaks the tool run. */
		addStandaloneActivity(element) {
			this.endActivityGroup();
			this.addActivity(element);
		}

		/**
		 * A pending approval is the one thing the user has to act on, so it wins
		 * over a collapse - including on a turn that has already been closed.
		 */
		openForInteraction() {
			if (this.activityCount > 0) this.toggle(true);
		}

		toggle(force) {
			if (force === undefined) {
				this.userToggled = true;
			}
			this.isOpen = force !== undefined ? force : !this.isOpen;
			this.body.style.display = this.isOpen ? '' : 'none';
			this.header.setAttribute('aria-expanded', String(this.isOpen));

			const svg = this.chevron.querySelector('svg');
			if (svg) {
				svg.style.transform = this.isOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
			}
		}

		finish(outcome) {
			if (this.isFinished) return;
			this.isFinished = true;
			this.endActivityGroup();
			clearInterval(this.timer);
			this.timer = null;

			if (this.activityCount === 0) {
				if (this.isAttached) this.el.remove();
				this.isAttached = false;
				return;
			}

			const terminalOutcome = outcome === 'cancelled' || outcome === 'failed'
				? outcome
				: 'completed';
			this.el.dataset.outcome = terminalOutcome;
			const duration = formatWorkDuration(this.elapsedMs());
			if (terminalOutcome === 'cancelled') {
				this.title.textContent = `Stopped after ${duration}`;
			} else if (terminalOutcome === 'failed') {
				this.title.textContent = `Failed after ${duration}`;
			} else {
				this.title.textContent = `Worked for ${duration}`;
			}
			if (!this.userToggled) this.toggle(false);
		}

		dispose() {
			this.currentThought?.dispose();
			this.currentThought = null;
			clearInterval(this.timer);
			this.timer = null;
			this.el.remove();
			this.isAttached = false;
		}
	}

	/** One stretch of reasoning inside a work summary. */
	class WorkThought {
		constructor() {
			this.text = '';
			this.renderTimeout = null;

			this.el = document.createElement('div');
			this.el.className = 'work-summary-thought py-1 min-w-0';

			this.label = document.createElement('div');
			this.label.className = 'font-vscode text-[0.78em] font-medium opacity-60 mb-1';
			this.label.textContent = 'Thought';

			this.body = document.createElement('div');
			this.body.className = 'markdown-body text-[0.95em] opacity-70 text-vscode-fg min-w-0';

			this.el.appendChild(this.label);
			this.el.appendChild(this.body);
		}

		render() {
			if (typeof marked !== 'undefined') {
				this.body.innerHTML = marked.parse(this.text);
			} else {
				this.body.textContent = this.text;
			}
		}

		append(chunk) {
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

		/** Flush the throttled render so the last chunk is never dropped. */
		finish() {
			if (this.renderTimeout) {
				clearTimeout(this.renderTimeout);
				this.renderTimeout = null;
			}
			this.render();
		}

		dispose() {
			if (this.renderTimeout) clearTimeout(this.renderTimeout);
			this.renderTimeout = null;
		}
	}

	/**
	 * One uninterrupted run of tool calls, rendered as a single card inside the
	 * turn's work summary. Collapse lives on the summary, not here: nesting a
	 * second collapsible inside a collapsed box gives the user two headers to
	 * fight with to reach one tool.
	 */
	class ToolAggregator {
		constructor() {
			this.el = document.createElement('div');
			this.el.className = 'border border-vscode-widget-border rounded bg-vscode-widget-bg overflow-hidden shrink-0 tool-aggregator work-summary-tool-group';

			this.header = document.createElement('div');
			this.header.className = 'px-3 py-2 flex items-center bg-vscode-widget-header border-b border-vscode-widget-border gap-2';

			this.title = document.createElement('span');
			this.title.className = 'font-vscode text-[0.9em] opacity-80';
			this.title.textContent = 'Tools';

			this.header.appendChild(this.title);
			this.el.appendChild(this.header);

			this.body = document.createElement('div');
			this.body.className = 'flex flex-col';
			this.el.appendChild(this.body);

			this.toolCount = 0;
			this.toolItems = new Map();
		}

		updateTitle() {
			this.title.textContent = `Tools (${this.toolCount})`;
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
				} else if (
					update.status === 'cancelled' ||
					update.status === 'denied' ||
					// ACP has no 'cancelled' status, so a cancel arrives as failed with
					// 'Cancelled by user'. Case-insensitive, or the capital C misses.
					(update.status === 'failed' && update.rawOutput && typeof update.rawOutput === 'string' && /aborterror|cancelled|denied/i.test(update.rawOutput))
				) {
					statusEl.innerHTML = ICONS.cancelled;
				} else if (update.status === 'error' || update.status === 'failed') {
					statusEl.innerHTML = ICONS.error;
				} else if (update.status === 'pending') {
					// Queued, not yet running.
					statusEl.innerHTML = ICONS.circle;
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
		const planId = `plan-card-${agentTurnId}`;
		let card = document.getElementById(planId);
		const owner = workSummaryByPlanId.get(planId);

		if (entries.length === 0) {
			if (card) {
				// Through the owner, so the summary's activity count drops with
				// the card and an emptied summary can retire itself.
				if (owner) owner.removeActivity(card);
				else card.remove();
			}
			workSummaryByPlanId.delete(planId);
			return;
		}

		if (!card) {
			endCurrentTextBlock();
			const summary = ensureCurrentWorkSummary();
			card = document.createElement('div');
			card.id = planId;
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

			summary.addStandaloneActivity(card);
			workSummaryByPlanId.set(planId, summary);
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

		const existingCard = document.getElementById(`tool-card-${toolCallId}`);
		// A card the user can already see keeps taking updates in the turn that
		// drew it, even after a cancel: that is how a tool still in flight when
		// Stop was pressed gets to report its real outcome. Only a card that
		// does not exist yet has to go through ensureCurrentWorkSummary(), which
		// refuses to open a new turn for work the user just stopped.
		const summary = workSummaryByToolCallId.get(toolCallId) || ensureCurrentWorkSummary();
		summary.endThought();

		// A new card is about to be inserted below the current text block -
		// close the block so any text streamed after the tool starts fresh
		// below the card instead of appending to the paragraph above it.
		if (!existingCard) {
			endCurrentTextBlock();
		}

		if (update.kind) toolKinds.set(toolCallId, update.kind);
		const kind = toolKinds.get(toolCallId);
		trackFileChanges(toolCallId, kind, update);

		if (kind === 'edit') {
			let card = existingCard;
			if (!card) {
				card = createEditCard(toolCallId, update);
				summary.addStandaloneActivity(card);
			}
			updateEditCard(card, update);
		} else {
			summary.addOrUpdateTool(toolCallId, update);
		}
		workSummaryByToolCallId.set(toolCallId, summary);
	}

	// Verb per tool for the aggregated tool list. An entry only fires when the
	// tool's ACP title is "<name>: <target>", which humanizeToolTitle splits on.
	// Two families are deliberately absent: fetch_url / web_search take a
	// url/query rather than a path, so their title is the bare tool name; and the
	// file editors (string_replace, write_file, diff_edit) report ACP kind
	// 'edit', so they render as edit cards and never reach this list.
	//
	// file_op is a third case, and an unresolved one: its delete and move do
	// reach this list, and with no entry here they show their raw ACP title
	// ("file_op: move /a → /b"). One verb cannot cover four operations sharing
	// a tool name, so fixing it means humanizing per operation rather than per
	// tool. Left as it was before the changed-file chips landed.
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

	// Path of the diff the extension host would have handed to DiffManager, or
	// null when this update carries none. Mirrors handleDiffs in
	// chat-webview-provider.ts so the panel only offers "Open Diff" once the
	// change is actually registered.
	function diffPath(update) {
		if (!update || !Array.isArray(update.content)) return null;
		const diff = update.content.find(block => !!block && block.type === 'diff' && !!block.path);
		return diff ? diff.path : null;
	}

	function hasDiffContent(update) {
		return diffPath(update) !== null;
	}

	// A path the extension host can actually open: `vscode.Uri.file()` resolves
	// a relative one against the filesystem root, so a chip built from it would
	// point at a file that does not exist and reject inside showTextDocument.
	// Absolute means a POSIX root, a UNC share, or a drive-qualified path.
	function isAbsolutePath(filePath) {
		return /^(?:[/\\]|[A-Za-z]:[/\\])/.test(filePath);
	}

	// Absolute paths an update names, in the order the agent reported them - for
	// a move that is [source, destination]. `locations` is the ACP field for
	// them, and the only source on a queued announcement, which withholds its
	// content until the call is about to run. A tool that reports a relative
	// location - an MCP or custom tool is under no obligation to resolve one -
	// contributes nothing rather than an unopenable chip.
	function updateLocations(update) {
		const reported =
			update && Array.isArray(update.locations) ? update.locations : [];
		const paths = reported
			.map(location => location && location.path)
			.filter(path => typeof path === 'string' && isAbsolutePath(path));
		if (paths.length > 0) return paths;

		const fromDiff = diffPath(update);
		return fromDiff && isAbsolutePath(fromDiff) ? [fromDiff] : [];
	}

	/**
	 * Keep the context row in step with what a finished call did to the
	 * filesystem: `edit` created or changed a file, `delete` removed one, and
	 * `move` did both at once, so the chip follows the file to its new path
	 * rather than being left pointing at one that is no longer there.
	 *
	 * Nothing happens until the call completes, so an edit or a delete that was
	 * denied, cancelled or failed leaves the row exactly as it was. The paths
	 * are remembered from the announcement because the completion update carries
	 * a status and nothing else.
	 */
	function trackFileChanges(toolCallId, kind, update) {
		const reported = updateLocations(update);
		if (reported.length > 0) toolLocations.set(toolCallId, reported);

		// resolveEditCardState is named for the card it was written for, but the
		// part used here is the status normalisation - 'success' folded into
		// 'completed', and a denial or a cancel separated back out of 'failed'.
		// That is the same question for a delete or a move as for an edit.
		if (resolveEditCardState(update).status !== 'completed') return;

		const paths = toolLocations.get(toolCallId);
		if (!paths || paths.length === 0) return;

		if (kind === 'edit') {
			addChangedFileChip(paths[0]);
		} else if (kind === 'delete') {
			dropChip(paths[0]);
		} else if (kind === 'move') {
			dropChip(paths[0]);
			// The destination is the half worth keeping. Without one there is
			// nothing to point at, so the move only takes the old chip away.
			if (paths.length > 1) addChangedFileChip(paths[paths.length - 1]);
		}
	}

	// Resolve an edit card's label and icon from an update. The agent reports a
	// user cancel or deny as 'failed' with an explanatory rawOutput, so those are
	// separated back out here rather than all reading as an error.
	//
	// The `status` it returns is the general normalisation of an update's
	// outcome, so trackFileChanges reads it for deletes and moves too - only the
	// label and icon are specific to an edit card.
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
		// The approval buttons are inside the summary, so a collapsed summary
		// would hide the one thing the user has to act on.
		workSummaryByToolCallId.get(toolCallId)?.openForInteraction();

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
			if (statusEl) {
				statusEl.innerHTML = ICONS.cancelled;
				// So the end-of-turn spinner sweep does not treat it as stuck.
				statusEl.dataset.status = 'cancelled';
			}
		}
	}


	// Notify extension that webview is ready
	vscode.postMessage({ type: 'ready' });

}());
