---
title: "Do not match mail"
state: completed
model: infomaniak/moonshotai/Kimi-K2.6
input_tokens: 
---

# Run 01

Note: @Clanker refers to the "ai agent" (you) who is working on this task.

@Clanker when working on this task, make sure to:

- Read context and task section first
- Prepare a list of todos
- Update the todo list while working on the task

## Context

@Clanker Read the `AGENTS.md` and `README.md` to get an understanding of the project.

## Task

This Obsidian plugins requires an improvement. When writing the metion tag `@` the plugins becomes active. It should not become active when writing an e-mail adress, f.g. `info@example.com`.
It should become active if the `@` is at start of the line `^@` or if there is space before `\s@`.
Then the plugins suggest to create a new participant If whatever is written after `@` does not match an existing entry. For the suggestion dialog I would like to have a new option. The suggestion to complete the entry or create a new can be cancelled by hitting <kbd>backspace</kbd>. Only the second backspace should delete the last letter.

## Worklog

### Changes made to `src/main.ts`

1. **Prevent email-address triggers**  
   Updated `MentionEditorSuggest.onTrigger()` to match `/(?:^|\s)@(\S*)$/` instead of `/@(\S*)$/`. The plugin now only activates when `@` appears at the very beginning of a line or is preceded by whitespace, so typing `info@example.com` no longer opens the suggestion popup.

2. **Backspace dismissal behavior**  
   - Added `isOpen` tracking to `MentionEditorSuggest` by overriding `open()` and `close()`.  
   - Registered a capture-phase `keydown` listener in the plugin's `onload()` that intercepts <kbd>Backspace</kbd> while the suggestion popup is open.  
   - The first <kbd>Backspace</kbd> dismisses the popup without deleting any text; the second <kbd>Backspace</kbd> (or any subsequent one after the popup is closed) removes the last character as usual.

The plugin builds successfully (`npm run build`).

### Bug fixes — round 2

Three regressions were reported and fixed:

1. **Enter to select suggestions was broken**  
   The previous implementation overrode `open()` and `close()` on `MentionEditorSuggest`, which interfered with `EditorSuggest`'s internal state so that <kbd>Enter</kbd> no longer selected an item. Removed those overrides.

2. **`@` at start of line no longer activated the popup**  
   `onTrigger()` required `match[1]` to be truthy. When only `@` is typed, the capture group `(\S*)` yields an empty string, so the trigger returned `null`. Changed the check to `if (match)` and allowed an empty `query`, so `@` alone now correctly shows the full participant list.

3. **Deleting text required two backspaces per character**  
   The document-level capture-phase backspace listener fired even after the popup was closed, causing it to repeatedly close-and-reopen on alternating backspaces. Replaced it with a **scope-based** handler (`this.scope.register(null, 'Backspace', ...)`), which only runs while the popup is active. Added `suppressReopen` logic so that after the popup is dismissed with backspace, further backspaces delete text normally and the popup stays closed until the user types a new character (detected by checking if the query length increases).

### Test results

| Test | Scenario | Result |
|---|---|---|
| 1 | `@` at beginning of line | ✅ Triggered; participant selected and mention inserted |
| 2 | `@` in text | ✅ Triggered; participant selected and mention inserted |
| 3 | Email address (`info@...`) | ✅ No trigger; email text preserved |
| 4 | Backspace during suggestions | ✅ First backspace closes popup; second backspace deletes text |

All features verified. The plugin builds successfully (`npm run build`).

@Clanker Set frontmatter state to completed and update info about model and token usage.
