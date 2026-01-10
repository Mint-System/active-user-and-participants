import {App, Editor, MarkdownView, Modal, Notice, Plugin, TFile, WorkspaceLeaf, EditorSuggest, EditorSuggestTriggerInfo, EditorPosition, Scope, MarkdownPostProcessorContext} from 'obsidian';
import {DEFAULT_SETTINGS, LocalUserData, MyPluginSettings, SampleSettingTab, Participant} from "./settings";

interface MentionSuggestion {
	id: string;
	name: string;
	isNew?: boolean;
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private localUserData: LocalUserData;
	private mentionSuggest: MentionEditorSuggest;

	async onload() {
		await this.loadSettings();

		// Add a settings tab
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// Register the mention suggestion provider
		this.mentionSuggest = new MentionEditorSuggest(this.app, this);
		this.registerEditorSuggest(this.mentionSuggest);
		
		// Register markdown post processor to specially format active user mentions
		this.registerMarkdownPostProcessor((element, context) => {
			this.processMentionsInHtml(element);
		});
		
		// Register editor extension to highlight active user mentions in edit mode
		this.registerEditorExtension([]);
		
		// Listen to editor changes to update decorations
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, view) => {
				this.highlightActiveUserMentionsInEditor(editor);
			})
		);

		// Optionally prompt for active user when vault opens if not set
		this.app.workspace.onLayoutReady(() => {
			if (!this.localUserData.activeUserId && this.settings.participants.length > 0) {
				// We could show a notice instead of forcing the modal
				new Notice('Please select an active user in the plugin settings');
			}
		});

		// Add command to change active user
		this.addCommand({
			id: 'change-active-user',
			name: 'Change Active User',
			callback: () => {
				this.promptForActiveUser();
			}
		});
		

	}
	
	processMentionsInHtml(element: HTMLElement) {
		// Find all links that could be mentions
		const links = element.querySelectorAll('a');
		
		links.forEach(link => {
			const anchorEl = link as HTMLAnchorElement;
			let participantId: string | null = null;
			
			// Check if it's a mention link (mention:// protocol)
			if (anchorEl.href && anchorEl.href.includes('mention://')) {
				// Simple extraction for mention://id format
				const mentionMatch = anchorEl.href.match(/mention:\/\/([^?#]+)/);
				if (mentionMatch && mentionMatch[1]) {
					participantId = mentionMatch[1];
				}
			}
			// For internal links (wikilinks like @[[id|name]]), the data-href attribute usually contains the raw link text
			else if (anchorEl.hasAttribute('data-href') || anchorEl.classList.contains('internal-link')) {
				const dataHref = anchorEl.getAttribute('data-href') || '';
				
				// Check if it's in @[[id|name]] format
				if (dataHref && dataHref.startsWith('@[[') && dataHref.endsWith(']]')) {
					const content = dataHref.substring(2, dataHref.length - 2); // Remove @[[ and ]]
					const pipeIndex = content.indexOf('|');
					if (pipeIndex > 0) {
						participantId = content.substring(0, pipeIndex); // ID is before |
					}
				}
			}
			
			// If we identified a participant ID, check if it's the active user
			if (participantId && this.localUserData.activeUserId && participantId === this.localUserData.activeUserId) {
				anchorEl.classList.add('active-user-mention');
			}
		});
	}

	onunload() {
		// Cleanup if needed
	}

	async loadSettings() {
		const data = await this.loadData() as { settings?: MyPluginSettings, localUserData?: LocalUserData };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
		this.localUserData = data.localUserData || { activeUserId: null };
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			localUserData: this.localUserData
		});
	}

	promptForActiveUser() {
		if (this.settings.participants.length === 0) {
			new Notice('No participants available. Please add participants in settings first.');
			return;
		}

		// Create a simple modal to select active user
		new SelectActiveUserModal(this.app, this.settings.participants, async (selectedId: string) => {
			this.localUserData.activeUserId = selectedId;
			await this.saveSettings();
			
			const participant = this.settings.participants.find(p => p.id === selectedId);
			if (participant) {
				new Notice(`Active user set to: ${participant.name}`);
			}
		}).open();
	}
	
	setActiveUser(userId: string) {
		this.localUserData.activeUserId = userId;
		return this.saveSettings(); // Save the local user data
	}
	
	getActiveUserId(): string | null {
		return this.localUserData.activeUserId;
	}
	
	getActiveParticipant(): Participant | undefined {
		if (!this.localUserData.activeUserId) return undefined;
		return this.settings.participants.find(p => p.id === this.localUserData.activeUserId);
	}

	async updateMentionsForParticipant(oldId: string, newName: string, newId: string): Promise<number> {
		// Update all mentions in the vault when a participant changes
		const files = this.app.vault.getMarkdownFiles();
		let totalUpdated = 0;
		
		for (const file of files) {
			const content = await this.app.vault.read(file);
			let updatedContent = content;
			
			// Count occurrences before replacement for wikilink format
			const wikilinkMatches = (content.match(new RegExp(`@\\[\\[${oldId}\\|[^\\]]*\\]\\]`, 'g')) || []).length;
			// Count occurrences before replacement for mention link format  
			const mentionLinkMatches = (content.match(new RegExp(`@\\[[^\\]]*\\]\\(mention://${oldId}\\)`, 'g')) || []).length;
			
			// Update wikilink format @[[oldId|anyName]] to @[[newId|newName]]
			// This captures any mention with the old ID regardless of the name
			const wikilinkRegex = new RegExp(`@\\[\\[${oldId}\\|[^\\]]*\\]\\]`, 'g');
			updatedContent = updatedContent.replace(wikilinkRegex, `@[[${newId}|${newName}]]`);
			
			// Update mention link format @[anyName](mention://oldId) to @[newName](mention://newId)
			const mentionLinkRegex = new RegExp(`@\\[[^\\]]*\\]\\(mention://${oldId}\\)`, 'g');
			updatedContent = updatedContent.replace(mentionLinkRegex, `@[${newName}](mention://${newId})`);
			
			// Save the file if content was updated
			if (updatedContent !== content) {
				await this.app.vault.modify(file, updatedContent);
				totalUpdated += wikilinkMatches + mentionLinkMatches;
			}
		}
		
		return totalUpdated;
	}

	async generateParticipantsFromVault() {
		const participantsMap = new Map<string, string>(); // id -> name
		
		// Scan all markdown files in the vault for mention links
		const files = this.app.vault.getMarkdownFiles();
		
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			
			// Match @[[id|name]] format
			const wikilinkRegex = /@\[\[([^\]|]+)\|([^\]]+)\]\]/g;
			let match;
			while ((match = wikilinkRegex.exec(content)) !== null) {
				const id = match[1];
				const name = match[2];
				if (id && name && !participantsMap.has(id)) {
					participantsMap.set(id, name);
				}
			}
			
			// Match @[name](mention://id) format
			const mentionLinkRegex = /@\[([^\]]+)\]\(mention:\/\/([^\)]+)\)/g;
			while ((match = mentionLinkRegex.exec(content)) !== null) {
				const name = match[1];
				const id = match[2];
				if (id && name && !participantsMap.has(id)) {
					participantsMap.set(id, name);
				}
			}
		}
		
		// Convert map to participants array
		const participants: Participant[] = [];
		for (const [id, name] of participantsMap.entries()) {
			participants.push({ id, name });
		}
		
		this.settings.participants = participants;
		await this.saveSettings();
	}

	highlightActiveUserMentionsInEditor(editor: Editor) {
		// For edit mode highlighting, this would normally use CodeMirror decorations
		// A full implementation would require advanced CodeMirror manipulation
		// which is out of scope for this plugin's complexity level.
		// The primary highlighting occurs in preview mode with the post-processor.
	}
}



class MentionEditorSuggest extends EditorSuggest<MentionSuggestion> {
	private plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const currentLine = editor.getLine(cursor.line);
		const beforeCursor = currentLine.slice(0, cursor.ch);

		// Check if we're in an @ mention context
		const match = beforeCursor.match(/@(\S*)$/);
		if (match && match[1]) {
			return {
				start: { line: cursor.line, ch: cursor.ch - match[0].length },
				end: cursor,
				query: match[1],
			};
		}

		return null;
	}

	getSuggestions(context: EditorSuggestTriggerInfo): MentionSuggestion[] | Promise<MentionSuggestion[]> {
		if (!this.plugin.settings.participants) return [];
		
		const query = context.query.toLowerCase();
		const matchingParticipants = this.plugin.settings.participants.filter(participant => 
			participant.id.toLowerCase().includes(query) || 
			participant.name.toLowerCase().includes(query)
		).map(participant => ({
			id: participant.id,
			name: participant.name
		}));
		
		// If there's a query but no matching participants, suggest creating a new participant
		if (query && matchingParticipants.length === 0) {
			// Suggest creating a new participant with the entered text as both id and name
			// We'll use a special identifier to denote this is a new participant
			matchingParticipants.push({
				id: `NEW:${query}`,
				name: query
			});
		}
		
		return matchingParticipants;
	}

	renderSuggestion(suggestion: MentionSuggestion, el: HTMLElement): void {
		if (suggestion.id.startsWith('NEW:')) {
			el.setText(`${suggestion.name} (create new participant)`);
		} else {
			el.setText(`${suggestion.name} (${suggestion.id})`);
		}
	}

	selectSuggestion(suggestion: MentionSuggestion, evt: KeyboardEvent | MouseEvent): void {
		// Replace the @... text with the proper mention format
		const leaf = this.app.workspace.activeLeaf;
		if (!leaf || !(leaf.view instanceof MarkdownView)) return;
		
		const editor = leaf.view.editor;
		
		// Find the @ trigger position
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const beforeCursor = currentLine.slice(0, cursor.ch);
		const match = beforeCursor.match(/@(\S*)$/);
		if (!match) return;
		
		const startCh = cursor.ch - match[0].length;
		const endCh = cursor.ch;
		
		// If this is a new participant that doesn't exist yet (identified by NEW: prefix)
		if (suggestion.id.startsWith('NEW:')) {
			const newId = suggestion.id.substring(4); // Remove 'NEW:' prefix
			
			// Ask user if they want to create this participant
			const shouldCreate = confirm(`"${suggestion.name}" is not in the participants list. Would you like to add them?`);
			if (!shouldCreate) {
				return; // User chose not to create, so just insert the text as-is
			}
			
			// Add the new participant to the plugin's settings
			const newParticipant = {
				id: newId,
				name: suggestion.name
			};
			
			// Check if participant doesn't already exist
			const exists = this.plugin.settings.participants.some(p => p.id === newParticipant.id || p.name === newParticipant.name);
			if (!exists) {
				this.plugin.settings.participants.push(newParticipant);
				this.plugin.saveSettings();
			}
			
			// Update the suggestion object to use the actual values without prefix
			suggestion.id = newId;
		}
		
		// Determine which format to use based on Obsidian's wikilink setting
		// Check the "Use [[Wikilinks]]" setting in Obsidian
		const useWikilinks = (this.app.vault as any).getConfig ? !(this.app.vault as any).getConfig('useMarkdownLinks') : true;
		
		let replacement: string;
		if (useWikilinks) {
			replacement = `@[[${suggestion.id}|${suggestion.name}]]`;
		} else {
			replacement = `@[${suggestion.name}](mention://${suggestion.id})`;
		}
		
		// Replace the matched text
		editor.replaceRange(replacement, { line: cursor.line, ch: startCh }, { line: cursor.line, ch: endCh });
	}
}

class SelectActiveUserModal extends Modal {
	private participants: Participant[];
	private onSelect: (id: string) => void;

	constructor(app: App, participants: Participant[], onSelect: (id: string) => void) {
		super(app);
		this.participants = participants;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Select Active User' });

		if (this.participants.length === 0) {
			contentEl.createEl('p', { text: 'No participants available.' });
			return;
		}

		// Create dropdown for participant selection
		const dropdownContainer = contentEl.createEl('div', { cls: 'dropdown-container' });
		dropdownContainer.createEl('label', { text: 'Choose active user:' });
		
		const dropdown = dropdownContainer.createEl('select');
		
		// Create and add the default option
		const defaultOption = document.createElement('option');
		defaultOption.value = '';
		defaultOption.textContent = 'Select a participant...';
		dropdown.appendChild(defaultOption);
		
		this.participants.forEach(participant => {
			const option = document.createElement('option');
			option.value = participant.id;
			option.textContent = `${participant.name} (${participant.id})`;
			dropdown.appendChild(option);
		});

		// Create OK button to confirm selection
		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
		const okButton = buttonContainer.createEl('button', { text: 'OK', cls: 'mod-cta' });
		
		okButton.addEventListener('click', () => {
			const selectedValue = dropdown.value;
			if (selectedValue) {
				this.onSelect(selectedValue);
				this.onClose();  // Use the proper Obsidian modal lifecycle method
			} else {
				new Notice('Please select a participant.');
			}
		});

		// Allow Enter key to confirm selection
		dropdown.addEventListener('change', () => {
			const selectedValue = dropdown.value;
			if (selectedValue) {
				this.onSelect(selectedValue);
				this.onClose();  // Use the proper Obsidian modal lifecycle method
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
