import {App, Notice, PluginSettingTab, Setting, TextAreaComponent} from "obsidian";
import ActiveUserAndParticipantsPlugin from "./main";

export interface Participant {
	id: string;
	name: string;
}

export interface ActiveUserAndParticipantsPluginSettings {
	participants: Participant[];
	autoUpdateMentions: boolean; // Feature flag for automatically updating mentions when participants change
	// Note: activeUserId is now stored separately per user installation, not in shared settings
}

export interface LocalUserData {
	activeUserId: string | null;
}

export const DEFAULT_SETTINGS: ActiveUserAndParticipantsPluginSettings = {
	participants: [],
	autoUpdateMentions: true  // Enabled by default as requested
}

export class ActiveUserAndParticipantsSettingTab extends PluginSettingTab {
	plugin: ActiveUserAndParticipantsPlugin;

	constructor(app: App, plugin: ActiveUserAndParticipantsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		// Auto-update mentions toggle
		new Setting(containerEl)
			.setName('Auto-update mentions')
			.setDesc('Automatically update all mentions in vault when participant name or ID changes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoUpdateMentions)
				.onChange(async (value) => {
					this.plugin.settings.autoUpdateMentions = value;
					await this.plugin.saveSettings();
				}));

		// Create participant management section
		new Setting(containerEl)
			.setName('Add new participant')
			.setDesc('Enter ID and name for a new participant');
		
		// Create form for adding new participants
		const addForm = containerEl.createDiv();
		addForm.addClass('participant-add-form');
		
		// ID input
		const idInput = addForm.createEl('input', {
			type: 'text',
			placeholder: 'Participant ID (e.g., john.doe)',
			attr: { style: 'margin-right: 8px; width: 200px;' }
		});
		
		// Name input
		const nameInput = addForm.createEl('input', {
			type: 'text',
			placeholder: 'Display Name (e.g., John Doe)',
			attr: { style: 'margin-right: 8px; width: 200px;' }
		});
		
		// Add button
		const addButton = addForm.createEl('button', {
			text: 'Add Participant',
			attr: { style: 'margin-top: 8px;' }
		});
		
		addButton.addEventListener('click', async () => {
			const id = idInput.value.trim();
			const name = nameInput.value.trim();
			
			if (!id || !name) {
				new Notice('Please enter both ID and Name');
				return;
			}
			
			// Check if participant already exists
			const exists = this.plugin.settings.participants.some(p => p.id === id || p.name === name);
			if (exists) {
				new Notice('A participant with this ID or Name already exists');
				return;
			}
			
			// Add new participant
			const oldParticipants = [...this.plugin.settings.participants];
			this.plugin.settings.participants.push({ id, name });
			
			// Update mentions if needed (though this is a new participant, so no mentions to update)
			this.updateChangedMentions(oldParticipants, this.plugin.settings.participants);
			
			await this.plugin.saveSettings();
			
			// Clear inputs
			idInput.value = '';
			nameInput.value = '';
			
			// Refresh the participants list display
			participantsList.empty ? participantsList.empty() : participantsList.replaceChildren();
			this.renderParticipantsList(participantsList);
		});
		
		// Create participants list section
		new Setting(containerEl)
			.setName('Existing participants')
			.setDesc('Manage your existing participants');
		
		// Create a container for the participants list
		const participantsList = containerEl.createDiv();
		this.renderParticipantsList(participantsList);
		
		// Generate from vault button
		if (this.plugin.settings.participants.length === 0) {
			new Setting(containerEl)
				.addButton(btn => btn
					.setButtonText('Generate from vault')
					.setCta()
					.onClick(async () => {
						await this.plugin.generateParticipantsFromVault();
						participantsList.empty ? participantsList.empty() : participantsList.replaceChildren();
						this.renderParticipantsList(participantsList);
						new Notice('Participants generated from vault');
					}));
		}
	}
	

	
	// Method to compare old and new participants to find changes and update mentions
	private updateChangedMentions(oldParticipants: Participant[], newParticipants: Participant[]) {
		// Check if auto-update is enabled
		if (!this.plugin.settings.autoUpdateMentions) {
			return; // Skip updating mentions if feature is disabled
		}
		
		let totalUpdated = 0;
		
		// 1. Check for participants where ID stayed the same but name changed
		for (const oldParticipant of oldParticipants) {
			const newParticipant = newParticipants.find(p => p.id === oldParticipant.id);
			if (newParticipant) {
				if (oldParticipant.name !== newParticipant.name) {
					const updatedCount = (this.plugin as any).updateMentionsForParticipant(oldParticipant.id, newParticipant.name, newParticipant.id);
					totalUpdated += updatedCount;
				}
			}
		}
		
		// 2. Check for participants where the name stayed the same but ID changed (renamed)
		for (const oldParticipant of oldParticipants) {
			const newParticipant = newParticipants.find(p => 
				p.name === oldParticipant.name && p.id !== oldParticipant.id
			);
			if (newParticipant) {
				const updatedCount = (this.plugin as any).updateMentionsForParticipant(oldParticipant.id, newParticipant.name, newParticipant.id);
				totalUpdated += updatedCount;
			}
		}
		
		if (totalUpdated > 0) {
			new Notice(`Updated ${totalUpdated} mention${totalUpdated !== 1 ? 's' : ''} in vault`);
		}
	}
	
	// Method to render the participants list UI
	private renderParticipantsList(container: HTMLElement) {
		container.empty ? container.empty() : container.replaceChildren();
		
		if (this.plugin.settings.participants.length === 0) {
			container.createEl ? 
				container.createEl('p', { text: 'No participants added yet.' }) : 
				container.appendChild(Object.assign(document.createElement('p'), {textContent: 'No participants added yet.'}));
			return;
		}
		
		// Create a table-like structure for participants
		const table = container.createEl ? 
			container.createEl('table', { cls: 'participant-list-table' }) : 
			container.appendChild(Object.assign(document.createElement('table'), {className: 'participant-list-table'}));
		
		// Add table header
		const headerRow = table.createEl ? table.createEl('tr') : table.appendChild(document.createElement('tr'));
		headerRow.createEl('th', { text: 'ID' });
		headerRow.createEl('th', { text: 'Name' });
		headerRow.createEl('th', { text: 'Actions', attr: { style: 'width: 100px;' } });
		
		// Add table body with participants
		const tbody = table.createEl('tbody');
		
		this.plugin.settings.participants.forEach((participant, index) => {
			const row = tbody.createEl('tr', { attr: { 'data-index': index.toString() } });
			
			// ID cell (editable)
			const idCell = row.createEl('td');
			const idInput = idCell.createEl('input', {
				type: 'text',
				value: participant.id,
				attr: { style: 'width: 100%;' }
			});
			
			// Name cell (editable)
			const nameCell = row.createEl('td');
			const nameInput = nameCell.createEl('input', {
				type: 'text',
				value: participant.name,
				attr: { style: 'width: 100%;' }
			});
			
			// Actions cell (delete button)
			const actionsCell = row.createEl('td');
			const deleteBtn = actionsCell.createEl('button', {
				text: 'Delete',
				cls: 'mod-warning'
			});
			
			// Add event listeners
			idInput.addEventListener('change', async (e) => {
				await this.handleParticipantUpdate(index, 'id', (e.target as HTMLInputElement).value);
			});
			
			idInput.addEventListener('blur', async (e) => {
				await this.handleParticipantUpdate(index, 'id', (e.target as HTMLInputElement).value);
			});
			
			nameInput.addEventListener('change', async (e) => {
				await this.handleParticipantUpdate(index, 'name', (e.target as HTMLInputElement).value);
			});
			
			nameInput.addEventListener('blur', async (e) => {
				await this.handleParticipantUpdate(index, 'name', (e.target as HTMLInputElement).value);
			});
			
			deleteBtn.addEventListener('click', async () => {
				if (index >= this.plugin.settings.participants.length) return;
				
				const oldParticipants = [...this.plugin.settings.participants];
				this.plugin.settings.participants.splice(index, 1);
				
				// Update mentions since a participant was removed
				this.updateChangedMentions(oldParticipants, this.plugin.settings.participants);
				await this.plugin.saveSettings();
				
				// Refresh the list
				container.empty();
				this.renderParticipantsList(container);
			});
		});
	}
	
	private async handleParticipantUpdate(index: number, field: 'id' | 'name', newValue: string) {
		if (index >= this.plugin.settings.participants.length) {
			return;
		}
		
		const participant = this.plugin.settings.participants[index];
		if (!participant) {
			return;
		}
		
		const oldValue = field === 'id' ? participant.id : participant.name;
		newValue = newValue.trim();
		
		if (!newValue) {
			new Notice(`${field === 'id' ? 'ID' : 'Name'} cannot be empty`);
			// We can't revert the input value here since this runs async
			return;
		}
		
		if (oldValue !== newValue) {
			// Create a deep copy of the old participants array
			const oldParticipants = this.plugin.settings.participants.map(p => ({...p}));
			
			if (field === 'id') {
				// Check if ID already exists
				const exists = this.plugin.settings.participants.some((p, i) => p.id === newValue && i !== index);
				if (exists) {
					new Notice('A participant with this ID already exists');
					return;
				}
				participant.id = newValue;
			} else {
				// Check if name already exists
				const exists = this.plugin.settings.participants.some((p, i) => p.name === newValue && i !== index);
				if (exists) {
					new Notice('A participant with this name already exists');
					return;
				}
				participant.name = newValue;
			}
			
			// Update mentions since the participant changed
			this.updateChangedMentions(oldParticipants, this.plugin.settings.participants);
			await this.plugin.saveSettings();
		}
	}
}
