import React, { useState, useMemo, useEffect } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { SourceMeta } from '../../../types/index.js';

interface SourceSelectionScreenProps {
  sources: Record<string, SourceMeta>;
  onSelect: (source: SourceMeta) => void;
  onBack: () => void;
}

const EXTRACTION_LABELS: Record<string, string> = {
  automated: 'Local',
  export: 'Export',
  api: 'API',
  takeout: 'Takeout',
};

const EXTRACTION_COLORS: Record<string, string> = {
  automated: '#00D4AA',
  export: '#FFB800',
  api: '#8B5CF6',
  takeout: '#FF6B6B',
};

export function SourceSelectionScreen({
  sources,
  onSelect,
  onBack,
}: SourceSelectionScreenProps) {
  const { width, height } = useTerminalDimensions();
  const [cursorIndex, setCursorIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);

  // Calculate visible area height (accounting for header, search, column headers, footer, borders)
  const visibleHeight = Math.max(1, height - 14);

  // Get all sources as array, sorted A-Z by displayName
  const allSources = useMemo(() => {
    return Object.values(sources).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [sources]);

  // Filter sources by search query
  const filteredSources = useMemo(() => {
    if (!searchQuery) return allSources;
    const query = searchQuery.toLowerCase();
    return allSources.filter(
      (s) =>
        s.displayName.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.category.toLowerCase().includes(query)
    );
  }, [allSources, searchQuery]);

  // Clamp cursor when filter changes
  const safeCursor = Math.min(cursorIndex, Math.max(0, filteredSources.length - 1));

  // Adjust scroll offset when cursor moves outside visible area
  useEffect(() => {
    if (safeCursor < scrollOffset) {
      setScrollOffset(safeCursor);
    } else if (safeCursor >= scrollOffset + visibleHeight) {
      setScrollOffset(safeCursor - visibleHeight + 1);
    }
  }, [safeCursor, scrollOffset, visibleHeight]);

  // Reset scroll when search changes
  useEffect(() => {
    setScrollOffset(0);
  }, [searchQuery]);

  useKeyboard((key) => {
    // Handle character input for search
    if (key.sequence && key.sequence.length === 1 && /[a-zA-Z0-9 ]/.test(key.sequence)) {
      setSearchQuery((prev) => prev + key.sequence);
      setCursorIndex(0);
      return;
    }

    switch (key.name) {
      case 'backspace':
        if (searchQuery.length > 0) {
          setSearchQuery((prev) => prev.slice(0, -1));
          setCursorIndex(0);
        }
        break;

      case 'j':
      case 'down':
        if (safeCursor < filteredSources.length - 1) {
          setCursorIndex(safeCursor + 1);
        }
        break;

      case 'k':
      case 'up':
        if (safeCursor > 0) {
          setCursorIndex(safeCursor - 1);
        }
        break;

      case 'u':
        if (key.ctrl) {
          setSearchQuery('');
          setCursorIndex(0);
        }
        break;

      case 'return':
        const source = filteredSources[safeCursor];
        if (source) {
          onSelect(source);
        }
        break;

      case 'escape':
        if (searchQuery) {
          setSearchQuery('');
          setCursorIndex(0);
        } else {
          onBack();
        }
        break;
    }
  });

  // Calculate column widths
  const nameColWidth = 18;
  const typeColWidth = 8;
  const descWidth = Math.max(10, width - nameColWidth - typeColWidth - 8);

  // Get only visible items (virtual scrolling)
  const visibleSources = filteredSources.slice(scrollOffset, scrollOffset + visibleHeight);

  // Show scroll indicators
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + visibleHeight < filteredSources.length;

  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" width={width - 2}>
        <text>
          <strong>SELECT A SOURCE</strong>
        </text>
        <text fg="#666666">
          {allSources.length} sources available
        </text>
      </box>

      <box height={1} />

      {/* Search bar */}
      <box flexDirection="row">
        <text fg="#666666">Search: </text>
        <text fg="#00D4AA">{searchQuery || '(type to filter)'}</text>
        {searchQuery && (
          <text fg="#666666"> ({filteredSources.length} matches)</text>
        )}
      </box>

      <box height={1} />

      {/* Column headers */}
      <box flexDirection="row">
        <text fg="#666666">  </text>
        <text fg="#888888" width={nameColWidth}>NAME</text>
        <text fg="#888888" width={typeColWidth}>TYPE</text>
        <text fg="#888888">DESCRIPTION</text>
      </box>

      {/* Source list with border */}
      <box
        flexDirection="column"
        flexGrow={1}
        border
        borderStyle="single"
        borderColor="#444444"
        padding={1}
      >
        {/* Scroll up indicator */}
        {canScrollUp && (
          <text fg="#666666">  ↑ {scrollOffset} more above</text>
        )}

        {/* Visible items */}
        {visibleSources.map((source, idx) => {
          const actualIndex = scrollOffset + idx;
          const isFocused = actualIndex === safeCursor;
          const typeLabel = EXTRACTION_LABELS[source.extractionType] || source.extractionType;
          const typeColor = EXTRACTION_COLORS[source.extractionType] || '#888888';

          return (
            <box key={source.name} flexDirection="row">
              <text fg={isFocused ? '#00D4AA' : '#666666'}>
                {isFocused ? '▸ ' : '  '}
              </text>
              <text fg={isFocused ? '#FFFFFF' : '#AAAAAA'} width={nameColWidth}>
                {source.displayName.slice(0, nameColWidth - 1)}
              </text>
              <text fg={typeColor} width={typeColWidth}>
                {typeLabel}
              </text>
              <text fg="#666666">
                {source.description.slice(0, descWidth)}
              </text>
            </box>
          );
        })}

        {/* Empty state */}
        {filteredSources.length === 0 && (
          <text fg="#666666">No sources match "{searchQuery}"</text>
        )}

        {/* Scroll down indicator */}
        {canScrollDown && (
          <text fg="#666666">  ↓ {filteredSources.length - scrollOffset - visibleHeight} more below</text>
        )}
      </box>

      {/* Footer */}
      <box marginTop={1}>
        <text fg="#666666">
          ↑/↓: navigate | Enter: select | Esc: back | Type to search
        </text>
      </box>
    </box>
  );
}
