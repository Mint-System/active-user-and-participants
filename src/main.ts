import {App, CachedMetadata, Editor, MarkdownView, Modal, Notice, Plugin, TFile, WorkspaceLeaf, EditorSuggest, EditorSuggestTriggerInfo, EditorPosition, Scope, MarkdownPostProcessorContext} from 'obsidian';
import {DEFAULT_SETTINGS, ActiveUserAndParticipantsPluginSettings, ActiveUserAndParticipantsSettingTab, Participant, ExternalUserMapping} from "./settings";
import {SearchResultModal} from "./searchResults";

interface MentionSuggestion {
	id: string;
	name: string;
	isNew?: boolean;
}



export default class ActiveUserAndParticipantsPlugin extends Plugin {
	settings: ActiveUserAndParticipantsPluginSettings;
	private mentionSuggest: MentionEditorSuggest;

	async onload() {
		await this.loadSettings();

		// Add a settings tab
		this.addSettingTab(new ActiveUserAndParticipantsSettingTab(this.app, this));

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
			if (!this.getActiveUserId() && this.settings.participants.length > 0) {
				// Show a notice directing users to the new settings location
				new Notice('Please select an active user in the plugin settings (Settings → Active User and Participants → Set Active User)');
			}
		});


		
		// Add command to search for mentions of a participant
		this.addCommand({
			id: 'search-mentions-of-user',
			name: 'Search for Mentions of a Participant',
			callback: async () => {
				// Create a modal for entering the search query
				const searchModal = new MentionSearchModal(this.app, this, async (query) => {
					await this.performMentionSearch(query);
				});
				searchModal.open();
			}
		});
		
		// Add command to search for mentions of active user ("me")
		this.addCommand({
			id: 'search-mentions-of-me',
			name: 'Search for Mentions of Me',
			callback: async () => {
				await this.performMentionSearch("me");
			}
		});
		
		// Initialize search integration
		this.initSearchIntegration();
	}
	
	// Initialize search integration to handle mention queries
	initSearchIntegration() {
		// Currently using command-based approach for stability
		// True search operator integration would require Obsidian to provide public API
		// for extending search operators, which is not currently available
	}
	
	// Method to perform mention search
	async performMentionSearch(query: string) {
		// Get all markdown files in the vault
		const files = this.app.vault.getMarkdownFiles();
		const matchingFiles = [];
		
		// Parse the query
		let participantIdsToFind: string[] = [];
		let searchDescription = `mentions of "${query}"`;
		
		if (query.toLowerCase() === "me") {
			// If searching for "me", use the active user's ID
			const activeUserId = this.getActiveUserId();
			if (activeUserId) {
				const participant = this.settings.participants.find(p => p.id === activeUserId);
				if (participant) {
					participantIdsToFind = [activeUserId];
					searchDescription = `mentions of "me" (${participant.name})`;
				} else {
					new Notice("You don't have an active user set. Please set your active user first.");
					return;
				}
			} else {
				new Notice("You don't have an active user set. Please set your active user first.");
				return;
			}
		} else {
			// Find participant by name or ID (case-insensitive)
			const matchingParticipants = this.settings.participants.filter(p => 
				p.name.toLowerCase().includes(query.toLowerCase()) || 
				p.id.toLowerCase().includes(query.toLowerCase())
			);
			
			if (matchingParticipants.length === 0) {
				new Notice(`No participants found matching "${query}".`);
				return;
			}
			
			participantIdsToFind = matchingParticipants.map(p => p.id);
			searchDescription = `mentions of "${query}"`;
		}
		
		// Search through each file for the participant mentions
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			
			// Check if any of the matching participant IDs appear in the file content
			let foundInFile = false;
			for (const participantId of participantIdsToFind) {
				// Check for wikilink format: @[[participantId|name]]
				const wikilinkPattern = new RegExp(`@\\[\\[${participantId}\\|[^\\]]*\\]\\]`, 'gi');
				if (wikilinkPattern.test(content)) {
					foundInFile = true;
					break;
				}
				
				// Check for link format: @[name](mention://participantId)
				const linkPattern = new RegExp(`@\\[[^\\]]*\\]\\(mention://${participantId}\\)`, 'gi');
				if (linkPattern.test(content)) {
					foundInFile = true;
					break;
				}
			}
			
			if (foundInFile) {
				matchingFiles.push(file);
			}
		}
		
		// Open search results in Obsidian's search panel if possible
		// For now, we'll show a notice with the count and open the search tab
		if (matchingFiles.length > 0) {
			const resultMessage = `Found ${matchingFiles.length} note(s) with ${searchDescription}.`;
			new Notice(resultMessage);
			

			
			// Create a modal to show detailed results
			const resultModal = new SearchResultModal(this.app, matchingFiles, searchDescription);
			resultModal.open();
		} else {
			new Notice(`No mentions found for ${searchDescription}. Checked ${files.length} files.`);
		}
	}
	
	processMentionsInHtml(element: HTMLElement) {
		// Find all links that could be mentions
		const links = element.querySelectorAll('a');
		
		links.forEach(link => {
			const anchorEl = link;
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
			const activeUserId = this.getActiveUserId();
			if (participantId && activeUserId && participantId === activeUserId) {
				anchorEl.classList.add('active-user-mention');
			}
		});
	}

	onunload() {
		// Cleanup if needed
	}

	// Load the external user mapping file from outside the vault (for migration purposes)
	async loadExternalUserMapping() {
		try {
			// Get the app's configuration directory path
			const configDir = this.app.vault.configDir;
			const filePath = `${configDir}/active-user-mapping.json`;
			
			// Read the mapping file if it exists
			if (await this.app.vault.adapter.exists(filePath)) {
				const fileContent = await this.app.vault.adapter.read(filePath);
				return JSON.parse(fileContent) as ExternalUserMapping;
			} 
		} catch (error) {
			console.error("Error loading external user mapping:", error);
		}
		return {};
	}
	
	async loadSettings() {
		const data = await this.loadData();
		if (!data) {
			// Initialize with default settings if no saved data
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		} else {
			// Cast data and assign (settings now include externalUserMapping)
			const typedData = data as { settings?: ActiveUserAndParticipantsPluginSettings };
			this.settings = Object.assign({}, DEFAULT_SETTINGS, typedData.settings || {});
		}
		
		// Initialize externalUserMapping if it doesn't exist
		if (!this.settings.externalUserMapping) {
			this.settings.externalUserMapping = {};
		}
		
		// Migrate from external file to vault data if needed
		await this.migrateExternalUserMappingIfNeeded();
	}
	
	// Migrate from external file to vault data if external file exists and vault data is empty
	async migrateExternalUserMappingIfNeeded() {
		if (Object.keys(this.settings.externalUserMapping!).length === 0) {
			// If the vault mapping is empty, check if there's an external file to migrate from
			const externalMapping = await this.loadExternalUserMapping();
			if (Object.keys(externalMapping).length > 0) {
				// Migrate the data from external file to vault data
				this.settings.externalUserMapping = externalMapping;
				await this.saveSettings();
				
				// Optionally, we could delete the external file after migration
				// But for safety, we'll leave it in place for now
				console.log("Migrated active user mapping from external file to vault data");
			}
		}
	}

	async saveSettings() {
		// Save settings to the vault (now includes externalUserMapping)
		await this.saveData({
			settings: this.settings
		});
	}

	promptForActiveUser() {
		if (this.settings.participants.length === 0) {
			new Notice('No participants available. Please add participants in settings first.');
			return;
		}

		// Create a simple modal to select active user
		new SelectActiveUserModal(this.app, this.settings.participants, async (selectedId: string) => {
			await this.setActiveUser(selectedId);
			
			const participant = this.settings.participants.find(p => p.id === selectedId);
			if (participant) {
				new Notice(`Active user set to: ${participant.name}`);
			}
		}).open();
	}
	
	// Get the current computer username/identifier
	getComputerIdentifier(): string {
		// In Obsidian desktop (Electron), we can try to get more specific user identification
		// Although we can't directly access Node.js, we'll use what's available
		try {
			// In electron environments, we might have access to require function
			if (typeof process !== 'undefined' && process.platform) {
				// We can potentially use process.env to get user info
				return process.env.USER || process.env.USERNAME || process.env.LOGNAME || "unknown_user";
			} else {
				// Fallback to a hash of some browser fingerprinting info if not in electron
				return "unknown_user_" + Math.random().toString(36).substr(2, 9);
			}
		} catch (e) {
			return "unknown_user_" + Math.random().toString(36).substr(2, 9);
		}
	}
	
	async setActiveUser(userId: string) {
		// Get the computer identifier and update the mapping in settings
		const computerId = this.getComputerIdentifier();
		this.settings.externalUserMapping![computerId] = userId;
		
		// Save the updated settings
		await this.saveSettings();
	}
	
	getActiveUserId(): string | null {
		const computerId = this.getComputerIdentifier();
		return this.settings.externalUserMapping?.[computerId] || null;
	}
	
	getActiveParticipant(): Participant | undefined {
		const activeUserId = this.getActiveUserId();
		if (!activeUserId) return undefined;
		return this.settings.participants.find(p => p.id === activeUserId);
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
		
		// Add existing participants to the map first to preserve them
		for (const participant of this.settings.participants) {
			participantsMap.set(participant.id, participant.name);
		}
		
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
	
	/**
	 * Public method to retrieve the full list of participants for external access (e.g., QuickAdd integration)
	 * @returns Array of Participant objects with id and name properties
	 */
	getParticipants(): Participant[] {
		return this.settings.participants;
	}
	
	/**
	 * Public method to retrieve only participant names for external access (e.g., QuickAdd integration)
	 * @returns Array of participant names as strings
	 */
	getParticipantNames(): string[] {
		return this.settings.participants.map(p => p.name);
	}
}



class MentionEditorSuggest extends EditorSuggest<MentionSuggestion> {
	private plugin: ActiveUserAndParticipantsPlugin;

	constructor(app: App, plugin: ActiveUserAndParticipantsPlugin) {
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
		const vaultWithConfig = this.app.vault as any;
		const useWikilinks = vaultWithConfig.getConfig ? !vaultWithConfig.getConfig('useMarkdownLinks') : true;
		
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

class MentionSearchModal extends Modal {
	private plugin: ActiveUserAndParticipantsPlugin;
	private onSubmit: (query: string) => void;

	constructor(app: App, plugin: ActiveUserAndParticipantsPlugin, onSubmit: (query: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Search for Mentions' });

		// Create form for search input
		const formContainer = contentEl.createDiv();
		
		formContainer.createEl('label', { 
			text: 'Enter participant name or "me" for active user:', 
			attr: { style: 'display: block; margin-bottom: 8px;' } 
		});
		
		const input = formContainer.createEl('input', {
			type: 'text',
			placeholder: 'e.g. "john", "john.doe", or "me"',
			attr: { style: 'width: 100%; padding: 8px; margin-bottom: 10px;' }
		});
		
		// Example text
		formContainer.createEl('small', { 
			text: 'Examples: "mention: john" would search for all mentions of participants named John', 
			attr: { style: 'display: block; margin-top: 4px; color: #888;' } 
		});

		// Submit button
		const buttonContainer = formContainer.createDiv({ cls: 'modal-button-container' });
		const submitButton = buttonContainer.createEl('button', { 
			text: 'Search Mentions', 
			cls: 'mod-cta' 
		});
		
		submitButton.addEventListener('click', () => {
			const query = input.value.trim();
			if (query) {
				this.onSubmit(query);
				this.close();
			} else {
				new Notice('Please enter a name to search for.');
			}
		});

		// Allow Enter key to submit
		input.addEventListener('keypress', (evt) => {
			if (evt.key === 'Enter') {
				const query = input.value.trim();
				if (query) {
					this.onSubmit(query);
					this.close();
				} else {
					new Notice('Please enter a name to search for.');
				}
			}
		});

		// Focus the input
		input.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
				this.close();  // Use the proper Obsidian modal lifecycle method
			}
		});
	}

	onClose() {
		// Properly close the modal without necessarily emptying content
		// The modal will be destroyed anyway when closed
		super.onClose();
	}
}
