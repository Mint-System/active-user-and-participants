# Active User and Participants Plugin for Obsidian

This plugin enables collaborative note-taking by managing vault participants and allowing tagging them with @ mentions. Each user of the shared vault can maintain their own identity as the active user while sharing a common participant list.

## Features

### Participant Management

- Manage a shared list of participants in YAML format
- Participants have an ID and a display name 
- Supports importing participants from existing mentions in the vault

### Active User Selection

- Each user can set their own active user identity (stored per installation)
- Multiple users of the same vault can each have their own active user
- Change active user through command palette or modal selection

### @ Mention Tagging

- Type `@` followed by a character to activate autocomplete suggestions
- Suggests existing participants by name or ID
- For non-existent participants, offers to create them on-the-fly
- Creates appropriate links based on your Obsidian wikilink settings:
  - When Wikilinks enabled: `@[[participant-id|Display Name]]`
  - When Wikilinks disabled: `@[Display Name](mention://participant-id)`

### Automatic Updates

- When participant information changes in settings, all mentions in all vault files are automatically updated
- Changes to name or ID are reflected across the entire vault

## Installation

1. Clone or download this plugin to your vault's `.obsidian/plugins/` directory
2. Restart Obsidian or reload plugins
3. Enable the "Active User and Participants" plugin in Settings → Community Plugins

## Usage

### Managing Participants

1. Open Settings → Community Plugins → Active User and Participants
2. Use the UI controls to manage participants:
   - Add participants using the "Add New Participant" form with ID and Name
   - Edit existing participants by modifying their ID or Name directly in the table
   - Delete participants using the Delete button in the participant table
3. Alternatively, click "Generate from Vault" (when participant list is empty) to auto-populate from existing mentions in the vault

### Setting Active User

- Go to Settings → Community Plugins → Active User and Participants
- Use the dropdown menu labeled "Set Active User" to select yourself from the participant list
- Each user can maintain their individual active user selection without affecting others

### Creating Mentions

1. In any note, type `@` followed by a few characters
2. Select from the suggested participants or choose "create new participant"
3. The appropriate mention link will be inserted based on your wikilink settings

## Commands

- `Active User and Participants: Search for Mentions of a Participant` - Opens a modal to search for all mentions of a specific participant by name/ID
- `Active User and Participants: Search for Mentions of Me` - Searches for all mentions of the currently active user across the vault

## Search Functionality

The plugin provides powerful search capabilities to find @ mentions across your vault:

### Mention-Based Search

You can search for user mentions in two ways:

1. **Search by User Name/ID**: Using the "Search for Mentions of a User" command, you can find all notes that contain mentions of a specific participant. Simply enter the participant's name or ID to search across your entire vault.

2. **Search for Active User ("Me")**: Using the "Search for Mentions of Me" command, you can quickly find all mentions of your currently active user without having to enter any search terms.

**Note**: Currently, the search functionality is accessed through Obsidian's Command Palette rather than directly in the search bar as a `mention:` operator. True search operator integration (like `mention:john` directly in the search bar) would require Obsidian to provide a public API for plugins to extend search operators, which is not currently available.

### How It Works

Both search methods scan all markdown files in your vault to find:

- Wikilink format mentions: `@[[participant-id|Display Name]]`
- Link format mentions: `@[Display Name](mention://participant-id)`

The search is case-insensitive and will match partial names or IDs. For example, searching for "john" would find participants with names like "John Smith" or IDs like "john.doe".

When you use the search feature, the plugin will report how many files contain the specified mentions, helping you quickly locate relevant notes.

## File Format Support

The plugin recognizes and creates both formats depending on your Obsidian settings:

- **Wikilinks enabled**: Uses `@[[id|name]]` format
- **Wikilinks disabled**: Uses `@[name](mention://id)` format

## Changelog

### Version 1.0.4
- Moved active user selection to plugin settings (no longer stored in vault data)
- Added active user dropdown directly in settings tab 
- Removed redundant "Change Active User" command from command palette
- Added ability to clear active user selection

### Version 1.0.3
- Added search functionality for mentions of specific participants
- Added search functionality for mentions of active user ("me")
- Fixed various bugs with mention processing

### Version 1.0.2
- Implemented automatic updating of mentions when participant information changes
- Added participant management with add/edit/delete capabilities
- Added ability to generate participants from existing mentions in vault

### Version 1.0.1
- Initial release with participant management and @ mention tagging

## Notes

- The participant list is shared across all users of the vault
- The active user selection is personal to each installation/user
- When changing participant information, the plugin scans all markdown files in the vault to update mentions
- Creating new participants on-the-fly adds them to the shared participants list

## Integration with External Plugins

The plugin exposes public methods that allow other plugins to access the participant list:

### For QuickAdd Integration

You can now access the participant list from QuickAdd templates to dynamically populate your checkbox prompts:

```javascript
// Access the plugin instance
const plugin = this.app.plugins.plugins['active-user-and-participants'];

if (plugin) {
  // Get participant names from the plugin
  const participantNames = plugin.getParticipantNames();
  
  // Use in your checkbox prompt
  const selectedParticipants = await this.quickAddApi.checkboxPrompt(participantNames);

  const participantsYaml = selectedParticipants.map(p => `  - ${p}`).join('\n');

  this.variables.participants = participantsYaml;
} else {
  // Fallback to hardcoded list if plugin isn't available
  const selectedParticipants = await this.quickAddApi.checkboxPrompt(
    ["Kurt", "Ulrich", "Marco", "Janik", "Gerit", "Bruno", "Astrid", "Laurens"]
  );

  const participantsYaml = selectedParticipants.map(p => `  - ${p}`).join('\n');

  this.variables.participants = participantsYaml;
}
```

#### Public Methods Available

- `getParticipants()`: Returns an array of Participant objects with id and name properties
- `getParticipantNames()`: Returns an array of participant names as strings

## Future Enhancements

- **Direct search bar integration**: Once Obsidian provides a public API for custom search operators, this plugin could support `mention:john` directly in the main search bar, eliminating the need for command palette access.
- **Real-time collaboration indicators**: Show currently active participants in the vault in real-time using presence indicators.
- **Mention statistics**: Track and display usage statistics for each participant's mentions.
- **Bulk operations**: Add capabilities to perform bulk updates and management operations on participant mentions across multiple files simultaneously.
- **Advanced sorting and filtering**: Enhanced search result views with advanced filtering and sorting options beyond the last updated date.