# TUI Paste Handling: Prevention Strategies and Best Practices

This document outlines prevention strategies, best practices, and testing recommendations for implementing paste functionality in Terminal User Interface (TUI) applications, based on lessons learned from the OpenTUI/Ghostty paste fix.

## Table of Contents

1. [Problem Overview](#problem-overview)
2. [Prevention Strategies](#prevention-strategies)
3. [Best Practices for Terminal Input Handling](#best-practices-for-terminal-input-handling)
4. [Testing Recommendations](#testing-recommendations)
5. [Implementation Checklist](#implementation-checklist)
6. [Terminal Compatibility Reference](#terminal-compatibility-reference)

---

## Problem Overview

### The Root Cause

TUI frameworks often abstract terminal input handling, but different terminals implement paste functionality differently:

1. **Bracketed Paste Mode**: Modern terminals wrap pasted content in escape sequences (`\x1b[200~` ... `\x1b[201~`) to distinguish paste from typed input
2. **Framework Abstraction Gap**: TUI frameworks may not expose raw terminal events or may handle them inconsistently
3. **Terminal Variation**: Ghostty, iTerm2, Kitty, Terminal.app, and others have subtle differences in how they emit paste events

### Symptoms of Paste Issues

- Pasted text appears character-by-character with delays
- Paste sequences appear as literal escape characters
- Partial paste (only first few characters appear)
- Complete paste failure (nothing appears)
- Framework paste events fire but content is empty
- Works in one terminal but fails in another

---

## Prevention Strategies

### Strategy 1: Multi-Layer Input Handling

Never rely on a single input mechanism. Implement a fallback chain:

```
Layer 1: Framework's native paste event handler
    |
    v (fallback if not triggered)
Layer 2: Direct stdin listener for bracketed paste
    |
    v (fallback if not available)
Layer 3: Clipboard API fallback (pbpaste/xclip)
```

**Implementation Pattern:**

```typescript
// Layer 1: Framework paste handler
useEffect(() => {
  if (!keyHandler) return;

  const handlePaste = (event: { text: string }) => {
    if (state === 'accepting_input') {
      processInput(event.text);
    }
  };

  keyHandler.on('paste', handlePaste);
  return () => keyHandler.off('paste', handlePaste);
}, [keyHandler, state]);

// Layer 2: Direct stdin for bracketed paste
useEffect(() => {
  if (state !== 'accepting_input') return;

  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';
  let buffer = '';
  let inPaste = false;

  const handleData = (data: Buffer) => {
    const str = data.toString();

    if (str.includes(PASTE_START)) {
      inPaste = true;
      buffer = str.slice(str.indexOf(PASTE_START) + PASTE_START.length);

      if (buffer.includes(PASTE_END)) {
        const content = buffer.slice(0, buffer.indexOf(PASTE_END));
        processInput(content);
        buffer = '';
        inPaste = false;
      }
    } else if (inPaste) {
      buffer += str;
      if (buffer.includes(PASTE_END)) {
        const content = buffer.slice(0, buffer.indexOf(PASTE_END));
        processInput(content);
        buffer = '';
        inPaste = false;
      }
    }
  };

  process.stdin.on('data', handleData);
  return () => process.stdin.off('data', handleData);
}, [state]);

// Layer 3: Manual clipboard access (keybinding fallback)
const pasteFromClipboard = async () => {
  try {
    // macOS
    const { stdout } = await execa('pbpaste');
    if (stdout) processInput(stdout);
  } catch {
    try {
      // Linux
      const { stdout } = await execa('xclip', ['-selection', 'clipboard', '-o']);
      if (stdout) processInput(stdout);
    } catch {
      // Windows or fallback
      // ...
    }
  }
};
```

### Strategy 2: Defensive Input Filtering

Always sanitize input regardless of source:

```typescript
const processInput = (raw: string): string => {
  // Strip any escape sequences that leaked through
  let content = raw;

  // Remove bracketed paste markers if present
  content = content.replace(/\x1b\[200~/g, '');
  content = content.replace(/\x1b\[201~/g, '');

  // For sensitive fields, filter to printable ASCII only
  if (requiresPrintableOnly) {
    content = content.split('').filter(c => /[\x20-\x7E]/.test(c)).join('');
  }

  // Trim and validate
  return content.trim();
};
```

### Strategy 3: State-Aware Input Handling

Only accept paste when appropriate:

```typescript
type InputState = 'idle' | 'form_input' | 'navigating' | 'processing';

// Gate all input handlers on current state
const handleInput = (content: string) => {
  if (state !== 'form_input') {
    // Discard or log unexpected input
    return;
  }
  // Process input...
};
```

### Strategy 4: Enable Bracketed Paste Mode Explicitly

Some terminals require explicit mode activation:

```typescript
// On startup
process.stdout.write('\x1b[?2004h'); // Enable bracketed paste

// On cleanup
process.on('exit', () => {
  process.stdout.write('\x1b[?2004l'); // Disable bracketed paste
});

// Also handle SIGINT, SIGTERM
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    process.stdout.write('\x1b[?2004l');
    process.exit();
  });
});
```

---

## Best Practices for Terminal Input Handling

### 1. Never Trust Framework Events Alone

Even well-designed frameworks may have gaps:

- **DO**: Implement fallback handlers at the stdin level
- **DON'T**: Assume framework events will always fire
- **DO**: Log when fallbacks are triggered (for debugging)

### 2. Handle Chunked Paste Data

Large pastes may arrive in multiple chunks:

```typescript
let pasteBuffer = '';
let pasteTimeout: NodeJS.Timeout | null = null;

const handleChunkedPaste = (chunk: string) => {
  pasteBuffer += chunk;

  // Reset timeout on each chunk
  if (pasteTimeout) clearTimeout(pasteTimeout);

  // If we see paste end, process immediately
  if (pasteBuffer.includes(PASTE_END)) {
    processPaste(pasteBuffer);
    pasteBuffer = '';
    return;
  }

  // Fallback: if no end marker after 100ms, process what we have
  pasteTimeout = setTimeout(() => {
    if (pasteBuffer) {
      processPaste(pasteBuffer);
      pasteBuffer = '';
    }
  }, 100);
};
```

### 3. Provide Visual Feedback During Paste

Users should know something is happening:

```typescript
const [isPasting, setIsPasting] = useState(false);

// Show indicator while processing paste
{isPasting && <text fg="#888">Pasting...</text>}

// Update state appropriately
const handlePaste = async (content: string) => {
  setIsPasting(true);
  try {
    await processInput(content);
  } finally {
    setIsPasting(false);
  }
};
```

### 4. Handle Multi-Line Paste Carefully

Pasted content may contain newlines:

```typescript
const processPaste = (content: string) => {
  if (fieldType === 'single-line') {
    // Replace newlines with spaces or take first line only
    const singleLine = content.split('\n')[0];
    setInputValue(prev => prev + singleLine);
  } else if (fieldType === 'multi-line') {
    // Preserve newlines
    setInputValue(prev => prev + content);
  }
};
```

### 5. Document Paste Behavior to Users

Make paste keybindings visible:

```typescript
<text fg="#666">
  Cmd+V or Ctrl+V: paste | p: paste (fallback) | Enter: submit
</text>
```

---

## Testing Recommendations

### Terminal Matrix Testing

Test paste functionality across all major terminals:

| Terminal | Priority | Notes |
|----------|----------|-------|
| Ghostty | High | Uses bracketed paste, may need stdin fallback |
| iTerm2 | High | Well-supported, good baseline |
| Terminal.app | High | macOS default, may have quirks |
| Kitty | Medium | Good standards support |
| Alacritty | Medium | Minimal, standards-compliant |
| Warp | Medium | Unique input model |
| VS Code Terminal | High | Common dev environment |
| tmux | High | Test with various $TERM values |
| Hyper | Low | Electron-based |

### Test Cases

#### Basic Paste Tests

1. **Single-line paste**: Paste a short string (< 50 chars)
2. **Multi-line paste**: Paste multiple lines
3. **Long paste**: Paste > 1000 characters
4. **Unicode paste**: Paste with emoji and non-ASCII characters
5. **Special characters**: Paste with `\t`, `\n`, control characters

#### Edge Case Tests

1. **Rapid paste**: Paste multiple times quickly
2. **Paste interrupt**: Start paste, then press Escape
3. **Empty paste**: Copy empty selection, attempt paste
4. **Paste during transition**: Paste while screen is changing
5. **Paste with modifier**: Cmd+V vs Ctrl+V vs middle-click

#### Integration Tests

```typescript
describe('Paste Functionality', () => {
  it('should handle bracketed paste sequences', () => {
    const input = '\x1b[200~test content\x1b[201~';
    const result = processPaste(input);
    expect(result).toBe('test content');
  });

  it('should filter non-printable characters', () => {
    const input = 'hello\x00\x01\x02world';
    const result = processInput(input);
    expect(result).toBe('helloworld');
  });

  it('should handle chunked paste data', async () => {
    const chunks = ['\x1b[200~hel', 'lo wor', 'ld\x1b[201~'];
    let result = '';
    for (const chunk of chunks) {
      result = handleChunk(chunk);
    }
    expect(result).toBe('hello world');
  });
});
```

### Automated Testing Script

```bash
#!/bin/bash
# test-paste.sh - Run paste tests across terminals

TERMINALS=("ghostty" "iterm2" "terminal" "kitty")
TEST_STRING="Hello, World! 123 @#$%"

for term in "${TERMINALS[@]}"; do
  echo "Testing paste in $term..."

  # Launch terminal, run app, simulate paste
  # (Specific implementation depends on terminal automation capabilities)

  # Verify output matches expected
done
```

---

## Implementation Checklist

Use this checklist when implementing paste in a TUI application:

### Pre-Implementation

- [ ] Identify target terminals (minimum: Ghostty, iTerm2, Terminal.app, tmux)
- [ ] Review framework documentation for paste event handling
- [ ] Determine if framework exposes raw stdin access
- [ ] Plan fallback mechanisms

### Core Implementation

- [ ] Enable bracketed paste mode (`\x1b[?2004h`) on startup
- [ ] Disable bracketed paste mode (`\x1b[?2004l`) on exit
- [ ] Implement Layer 1: Framework paste event handler
- [ ] Implement Layer 2: Direct stdin bracketed paste parser
- [ ] Implement Layer 3: Clipboard API fallback (pbpaste/xclip)
- [ ] Add input sanitization (strip escape sequences, filter characters)
- [ ] Handle chunked paste data with buffering
- [ ] Gate paste handling on appropriate UI state

### User Experience

- [ ] Show paste keybinding hints in UI
- [ ] Display visual feedback during paste processing
- [ ] Handle multi-line paste appropriately for field type
- [ ] Log paste failures for debugging (non-production)

### Testing

- [ ] Test in Ghostty
- [ ] Test in iTerm2
- [ ] Test in Terminal.app
- [ ] Test in VS Code integrated terminal
- [ ] Test inside tmux session
- [ ] Test single-line paste
- [ ] Test multi-line paste
- [ ] Test long paste (> 1000 chars)
- [ ] Test special characters and Unicode
- [ ] Test rapid consecutive pastes
- [ ] Test paste during screen transitions

### Cleanup

- [ ] Ensure bracketed paste mode is disabled on all exit paths
- [ ] Remove stdin listeners on component unmount
- [ ] Clear paste buffers on state change

---

## Terminal Compatibility Reference

### Bracketed Paste Mode

- **Enable**: `\x1b[?2004h`
- **Disable**: `\x1b[?2004l`
- **Paste Start**: `\x1b[200~`
- **Paste End**: `\x1b[201~`

### Terminal-Specific Notes

#### Ghostty
- Fully supports bracketed paste
- May not trigger framework paste events; use stdin fallback
- Fast paste processing

#### iTerm2
- Excellent bracketed paste support
- Framework events usually work
- Supports paste with Cmd+V

#### Terminal.app (macOS)
- Basic bracketed paste support
- May have issues with very long pastes
- Framework events generally work

#### Kitty
- Full bracketed paste support
- Configurable paste behavior
- Supports OSC 52 for clipboard access

#### tmux
- Passes through bracketed paste
- May need `set -g set-clipboard on`
- Test with various `$TERM` values

#### VS Code Terminal
- Supports bracketed paste
- Paste via Cmd+V or Ctrl+Shift+V
- Framework events usually work

### Clipboard Access Commands

| Platform | Copy | Paste |
|----------|------|-------|
| macOS | `pbcopy` | `pbpaste` |
| Linux (X11) | `xclip -selection clipboard` | `xclip -selection clipboard -o` |
| Linux (Wayland) | `wl-copy` | `wl-paste` |
| Windows | `clip` | PowerShell: `Get-Clipboard` |

---

## Summary

Robust paste handling in TUI applications requires:

1. **Multi-layer approach**: Framework events + stdin fallback + clipboard API
2. **Defensive processing**: Always sanitize, never trust raw input
3. **State awareness**: Only accept paste in appropriate contexts
4. **Explicit mode control**: Enable/disable bracketed paste mode
5. **Comprehensive testing**: Test across all target terminals

Following these practices will prevent paste-related issues across the terminal ecosystem and provide a consistent user experience regardless of terminal choice.
