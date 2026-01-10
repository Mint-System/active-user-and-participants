import { App, Modal, TFile } from 'obsidian';

export class SearchResultModal extends Modal {
	private files: TFile[];
	private searchDescription: string;

	constructor(app: App, files: TFile[], searchDescription: string) {
		super(app);
		this.files = files;
		this.searchDescription = searchDescription;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		contentEl.createEl('h2', { text: `Search Results: ${this.searchDescription}` });
		
		if (this.files.length === 0) {
			contentEl.createEl('p', { text: 'No files found.' });
			return;
		}
		
		const resultList = contentEl.createEl('ul');
		
		for (const file of this.files) {
			const li = resultList.createEl('li', { cls: 'search-result-item' });
			const link = li.createEl('a', { 
				text: file.basename, 
				href: '#',
				cls: 'search-result-link'
			});
			
			link.addEventListener('click', (evt) => {
				evt.preventDefault();
				// Open the file in the active leaf
				this.app.workspace.getLeaf(true).openFile(file);
				this.close();
			});
			
			// Add file path as secondary info
			li.createEl('div', { 
				text: file.path, 
				cls: 'search-result-path' 
			});
		}
		
		// Add summary
		contentEl.createEl('p', { 
			text: `Found ${this.files.length} file(s)`,
			cls: 'search-summary'
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}