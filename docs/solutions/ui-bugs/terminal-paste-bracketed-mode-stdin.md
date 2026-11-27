---
title: CMD+V Paste Not Working in OpenTUI Form Input on Ghostty Terminal
category: ui-bugs
tags:
  - opentui
  - ghostty
  - terminal
  - clipboard
  - paste
  - keyboard-input
  - tui
  - bracketed-paste-mode
  - stdin
component: OpenTUI input field / terminal clipboard integration
symptoms:
  - CMD+V keyboard shortcut does not paste text
  - Unable to paste API token into form input field
  - Clipboard content not transferred to TUI application
  - 'p' key shortcut being captured as character input instead of triggering paste
date_solved: 2026-01-11
---

# CMD+V Paste Not Working in OpenTUI Form Input on Ghostty Terminal

## Problem Summary

Paste functionality (CMD+V) was not working in an OpenTUI-based TUI application when running in Ghostty terminal. Users needed to paste API tokens into form input fields but the standard paste keyboard shortcut had no effect.

## Symptoms

- CMD+V keyboard shortcut does not paste text into form input
- Pressing 'p' (intended paste shortcut) types the letter 'p' instead of pasting
- Clipboard content is not transferred to the TUI application
- Only manual character-by-character typing works

## Root Cause Analysis

The paste functionality failed due to **three interconnected issues**:

### 1. OpenTUI's `useKeyboard` Hook Limitations

OpenTUI's `useKeyboard` hook only listens to `"keypress"` events. It does not capture `"paste"` events from the terminal's event system. When CMD+V is pressed, terminals either:
- Emit a separate "paste" event (which OpenTUI's keyHandler can receive)
- Use bracketed paste mode (wraps content in escape sequences)

### 2. Bracketed Paste Mode Not Parsed

Modern terminals like Ghostty use **bracketed paste mode**, which wraps pasted content in escape sequences:
- Start: `\x1b[200~`
- End: `\x1b[201~`

The standard keyboard handler was receiving these raw escape sequences but not interpreting them correctly.

### 3. Character Input Capturing Special Keys

The original code had character input logic *before* the switch statement for special keys. When pressing 'p' (intended as a paste shortcut), the character input handler would capture it and type 'p' instead of triggering the paste action.

## Solution

The fix required a **three-layer approach** to ensure paste works across all terminals:

### Layer 1: Manual Paste Shortcut Using 'p' Key

Move special key handling *before* character input processing:

```typescript
// Handle special keys first before character input
switch (key.name) {
  case 'backspace':
    setInputValue((prev) => prev.slice(0, -1));
    return;

  case 'p':
    // Paste from clipboard using pbpaste (macOS) or xclip (Linux)
    (async () => {
      try {
        const { stdout } = await execa('pbpaste');
        if (stdout) {
          const printableChars = stdout.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
          setInputValue((prev) => prev + printableChars);
        }
      } catch {
        try {
          const { stdout } = await execa('xclip', ['-selection', 'clipboard', '-o']);
          if (stdout) {
            const printableChars = stdout.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
            setInputValue((prev) => prev + printableChars);
          }
        } catch {
          // Clipboard access failed, ignore
        }
      }
    })();
    return;  // Critical: prevents 'p' from being typed

  // ... other cases
}

// Character input AFTER special key handling
if (key.sequence && key.sequence.length > 0) {
  // Filter to printable ASCII
  const printableChars = key.sequence.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
  if (printableChars.length > 0) {
    setInputValue((prev) => prev + printableChars);
  }
}
```

### Layer 2: OpenTUI keyHandler Paste Event Listener

Use `useAppContext()` to access OpenTUI's keyHandler and listen for paste events:

```typescript
import { useAppContext } from '@opentui/react';

// Get keyHandler from app context for paste events
const { keyHandler } = useAppContext();

// Handle paste events from terminal
useEffect(() => {
  if (!keyHandler) return;

  const handlePaste = (event: { text: string }) => {
    // Only handle paste when in form input mode
    if (state === 'form_input') {
      const pastedText = event.text || '';
      const printableChars = pastedText.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
      if (printableChars.length > 0) {
        setInputValue((prev) => prev + printableChars);
      }
    }
  };

  keyHandler.on('paste', handlePaste);
  return () => {
    keyHandler.off('paste', handlePaste);
  };
}, [keyHandler, state]);
```

### Layer 3: Direct stdin Listener for Bracketed Paste Mode (Key Fix for Ghostty)

Listen directly to `process.stdin` for bracketed paste escape sequences:

```typescript
// Direct stdin listener for bracketed paste (fallback for terminals like Ghostty)
useEffect(() => {
  if (state !== 'form_input') return;

  let pasteBuffer = '';
  let inPaste = false;
  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';

  const handleData = (data: Buffer) => {
    const str = data.toString();

    // Check for paste start
    if (str.includes(PASTE_START)) {
      inPaste = true;
      const startIdx = str.indexOf(PASTE_START) + PASTE_START.length;
      pasteBuffer = str.slice(startIdx);

      // Check if paste end is also in this chunk
      if (pasteBuffer.includes(PASTE_END)) {
        const endIdx = pasteBuffer.indexOf(PASTE_END);
        const content = pasteBuffer.slice(0, endIdx);
        const printableChars = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
        if (printableChars.length > 0) {
          setInputValue((prev) => prev + printableChars);
        }
        pasteBuffer = '';
        inPaste = false;
      }
    } else if (inPaste) {
      pasteBuffer += str;

      // Check for paste end
      if (pasteBuffer.includes(PASTE_END)) {
        const endIdx = pasteBuffer.indexOf(PASTE_END);
        const content = pasteBuffer.slice(0, endIdx);
        const printableChars = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
        if (printableChars.length > 0) {
          setInputValue((prev) => prev + printableChars);
        }
        pasteBuffer = '';
        inPaste = false;
      }
    }
  };

  process.stdin.on('data', handleData);
  return () => {
    process.stdin.off('data', handleData);
  };
}, [state]);
```

## Why Each Layer Is Needed

| Layer | Handles | Terminal Compatibility |
|-------|---------|------------------------|
| 'p' key shortcut | Direct keyboard shortcut using system clipboard | All terminals (universal fallback) |
| keyHandler paste event | OpenTUI's paste event system | Terminals that work with OpenTUI's paste detection |
| Direct stdin listener | Bracketed paste mode escape sequences | Ghostty, iTerm2, Kitty, modern terminals |

## Prevention Strategies

### 1. Multi-Layer Input Handling
Always implement multiple fallback mechanisms for paste:
- Framework-level events (OpenTUI keyHandler)
- Direct stdin parsing for escape sequences
- System clipboard command fallback (pbpaste/xclip)

### 2. Order Matters: Special Keys Before Character Input
Process special key handlers (backspace, paste shortcuts) *before* general character input to prevent special keys from being captured as typed characters.

### 3. State-Aware Input Handling
Only enable paste handling when in the appropriate UI state (e.g., `form_input` mode) to prevent paste data from leaking into wrong contexts.

### 4. Filter to Printable Characters
Always filter input to printable ASCII range (`\x20-\x7E`) to strip control characters and escape sequences from the final value.

## Testing Checklist

- [ ] Test CMD+V paste in Ghostty
- [ ] Test CMD+V paste in iTerm2
- [ ] Test CMD+V paste in Terminal.app
- [ ] Test 'p' key paste shortcut
- [ ] Test long paste content (100+ characters)
- [ ] Test paste with special characters
- [ ] Test paste while not in form input mode (should be ignored)
- [ ] Test rapid successive pastes

## Related Files

- `/packages/otso-cli/src/commands/import/screens/flows/plugin-flow.tsx` - Implementation

## Terminal Compatibility Notes

### Ghostty
- Uses bracketed paste mode by default
- Requires direct stdin listener for paste to work
- Escape sequences: `\x1b[200~` ... `\x1b[201~`

### iTerm2
- May use keyHandler paste events or bracketed paste
- Both approaches should work

### Terminal.app (macOS)
- Standard macOS terminal
- 'p' key fallback with `pbpaste` always works

## Key Insight

> TUI frameworks often don't handle all terminal-specific behaviors. When dealing with features like paste in different terminals (iTerm2, Ghostty, Kitty, etc.), listening directly to `process.stdin` for raw escape sequences is often more reliable than relying on the framework's abstraction layer.
