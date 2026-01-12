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
		
		// Sort files by last updated date (most recent first)
		const sortedFiles = [...this.files].sort((a, b) => {
			// Direct access to mtime property on TFile
			const mtimeA = a.stat?.mtime;
			const mtimeB = b.stat?.mtime;
			
			// If modification times exist, compare them; otherwise fallback to file path comparison
			if (mtimeA !== undefined && mtimeB !== undefined) {
				return mtimeB - mtimeA; // Descending order (most recent first)
			}
			return 0; // Maintain original order if stats unavailable
		});
		
		const resultList = contentEl.createEl('ul');
		
		for (const file of sortedFiles) {
			const li = resultList.createEl('li', { cls: 'search-result-item' });
			const link = li.createEl('a', { 
				text: file.basename, 
				href: '#',
				cls: 'search-result-link'
			});
			
			link.addEventListener('click', (evt) => {
				evt.preventDefault();
				// Open the file in the active leaf
				void this.app.workspace.getLeaf(true).openFile(file);
				this.close();
			});
			
			// Add file path as secondary info
			li.createEl('div', { 
				text: file.path, 
				cls: 'search-result-path' 
			});
			
			// Add last modified date as tertiary info
			const mtime = file.stat?.mtime;
			if (mtime) {
				const dateStr = new Date(mtime).toLocaleDateString();
				li.createEl('div', { 
					text: `Last updated: ${dateStr}`, 
					cls: 'search-result-date' 
				});
			}
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