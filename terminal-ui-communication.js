/**
 * Terminal UI Communication View - Agent communication and tool calls display
 */

import { HistoryEntryTypes } from './workflow-history-store.js';
import {
  truncate,
  wrapText,
  stripTags,
  truncateWithTags,
  formatTimestamp,
  getAgentColor,
  getContentWidth,
  sanitizeForBlessed,
  makeBoxTop,
  makeBoxBottom,
  IS_WINDOWS
} from './terminal-ui-utils.js';

/**
 * CommunicationView handles the rendering and navigation of agent communication
 */
export class CommunicationView {
  constructor(ui) {
    this.ui = ui;

    // Agent Communication view state
    this.commFilterAgent = null;
    this.commFilterType = null;
    this.commSelectedIndex = 0;
    this.commInteractionList = [];
  }

  /**
   * Navigate communication view down (moves selection toward newer items)
   */
  navigateDown() {
    if (this.commInteractionList.length === 0) return;
    this.commSelectedIndex = Math.max(0, this.commSelectedIndex - 1);
    this.refresh();
    // Calculate display line (list is reversed, so newer items are at top)
    const displayLine = this.commInteractionList.length - 1 - this.commSelectedIndex;
    this.ui.scrollToLine(displayLine);
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Navigate communication view up (moves selection toward older items)
   */
  navigateUp() {
    if (this.commInteractionList.length === 0) return;
    this.commSelectedIndex = Math.min(this.commInteractionList.length - 1, this.commSelectedIndex + 1);
    this.refresh();
    // Calculate display line (list is reversed, so older items are at bottom)
    const displayLine = this.commInteractionList.length - 1 - this.commSelectedIndex;
    this.ui.scrollToLine(displayLine);
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Cycle through agent filter options
   */
  cycleAgentFilter() {
    // Get unique agents from interaction list
    const agents = new Set();
    for (const item of this.commInteractionList) {
      if (item.agentName) agents.add(item.agentName);
      if (item.data?.from) agents.add(item.data.from);
      if (item.data?.to) agents.add(item.data.to);
    }
    const agentList = [null, ...Array.from(agents).sort()]; // null = all

    const currentIdx = agentList.indexOf(this.commFilterAgent);
    this.commFilterAgent = agentList[(currentIdx + 1) % agentList.length];
    this.commSelectedIndex = 0;

    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Cycle through type filter options
   */
  cycleTypeFilter() {
    const types = [null, 'interaction', 'prompt', 'response', 'tool_call', 'tool_result'];
    const currentIdx = types.indexOf(this.commFilterType);
    this.commFilterType = types[(currentIdx + 1) % types.length];
    this.commSelectedIndex = 0;

    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Clear all communication filters
   */
  clearFilters() {
    this.commFilterAgent = null;
    this.commFilterType = null;
    this.commSelectedIndex = 0;

    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Refresh communication view content - Enhanced with full interaction timeline
   * Returns { left: [...], right: [...] } for split panel rendering
   */
  refresh() {
    const leftPanel = this.ui.widgets.leftPanel;
    const rightPanel = this.ui.widgets.rightPanel;
    const leftWidth = leftPanel ? (leftPanel.width || 40) - 2 : 40;
    const rightWidth = rightPanel ? (rightPanel.width || 40) - 2 : 40;

    // Gather all communication-related entries
    const allEntries = this._gatherCommunicationEntries();

    // Apply filters
    const filtered = this._filterCommunicationEntries(allEntries);

    // Cache for navigation
    this.commInteractionList = filtered;

    // Ensure selected index is valid
    if (this.commSelectedIndex >= filtered.length) {
      this.commSelectedIndex = Math.max(0, filtered.length - 1);
    }

    if (filtered.length === 0) {
      return {
        left: ['{gray-fg}No agent communications recorded yet...{/gray-fg}'],
        right: ['{gray-fg}Select a communication to view details{/gray-fg}']
      };
    }

    // Build left column (list)
    const leftLines = [];
    const displayOrder = [...filtered].reverse();
    for (let i = 0; i < displayOrder.length; i++) {
      const entry = displayOrder[i];
      const realIndex = filtered.length - 1 - i;
      const isSelected = realIndex === this.commSelectedIndex;
      const time = formatTimestamp(entry.timestamp);
      const agent = sanitizeForBlessed(entry.agentName || entry.data?.agentName || '?');
      const type = this._getCommTypeLabel(entry.entryType);
      const desc = truncate(this._getCommPreview(entry), leftWidth - 25);
      // Use bold for selection (same style as task tree)
      const line = `{gray-fg}${time}{/gray-fg} {${this._getCommTypeColor(entry.entryType)}-fg}${type}{/${this._getCommTypeColor(entry.entryType)}-fg} {cyan-fg}${agent}{/cyan-fg} ${desc}`;
      leftLines.push(isSelected ? `{bold}${line}{/bold}` : line);
    }

    // Build right column (details of selected)
    const rightLines = [];
    if (filtered.length > 0) {
      const selected = filtered[this.commSelectedIndex];
      if (selected) {
        this._renderCommDetails(rightLines, selected, rightWidth);
      }
    }

    return { left: leftLines, right: rightLines };
  }

  /**
   * Get communication type label
   */
  _getCommTypeLabel(entryType) {
    const labels = { prompt: '<-', response: '->', tool_call: '!', tool_result: '+', interaction: '<>', phase_change: '#' };
    return labels[entryType] || '?';
  }

  /**
   * Get communication type color
   */
  _getCommTypeColor(entryType) {
    const colors = { prompt: 'yellow', response: 'green', tool_call: 'magenta', tool_result: 'cyan', interaction: 'blue', phase_change: 'white' };
    return colors[entryType] || (IS_WINDOWS ? 'white' : 'gray');
  }

  /**
   * Get communication preview text
   */
  _getCommPreview(entry) {
    if (entry.data?.content) return sanitizeForBlessed(entry.data.content);
    if (entry.data?.toolName) return sanitizeForBlessed(entry.data.toolName);
    if (entry.data?.phase) return sanitizeForBlessed(entry.data.phase);
    return '';
  }

  /**
   * Render communication details
   */
  _renderCommDetails(lines, entry, width) {
    const time = formatTimestamp(entry.timestamp);
    const agent = sanitizeForBlessed(entry.agentName || entry.data?.agentName || 'unknown');

    lines.push(`{white-fg}Type:{/white-fg} {${this._getCommTypeColor(entry.entryType)}-fg}${entry.entryType}{/${this._getCommTypeColor(entry.entryType)}-fg}`);
    lines.push(`{white-fg}Agent:{/white-fg} {cyan-fg}${agent}{/cyan-fg}`);
    lines.push(`{white-fg}Time:{/white-fg} {gray-fg}${time}{/gray-fg}`);
    lines.push('');

    if (entry.data?.content) {
      lines.push('{white-fg}Content:{/white-fg}');
      const wrapped = wrapText(sanitizeForBlessed(entry.data.content), width - 2);
      for (const line of wrapped) {
        lines.push(`  {gray-fg}${line}{/gray-fg}`);
      }
    }

    if (entry.data?.toolName) {
      lines.push(`{white-fg}Tool:{/white-fg} {magenta-fg}${sanitizeForBlessed(entry.data.toolName)}{/magenta-fg}`);
      if (entry.data?.input) {
        lines.push('{white-fg}Input:{/white-fg}');
        const inputStr = typeof entry.data.input === 'object' ? JSON.stringify(entry.data.input, null, 2) : String(entry.data.input);
        for (const line of inputStr.split('\n')) {
          lines.push(`  {gray-fg}${sanitizeForBlessed(line)}{/gray-fg}`);
        }
      }
      if (entry.data?.result) {
        lines.push('{white-fg}Result:{/white-fg}');
        const resultStr = typeof entry.data.result === 'object' ? JSON.stringify(entry.data.result, null, 2) : String(entry.data.result);
        for (const line of resultStr.split('\n')) {
          lines.push(`  {gray-fg}${sanitizeForBlessed(line)}{/gray-fg}`);
        }
      }
    }

    if (entry.data?.toolCalls?.length > 0) {
      lines.push(`{white-fg}Tool Calls:{/white-fg} ${entry.data.toolCalls.length}`);
      for (const tc of entry.data.toolCalls) {
        lines.push(`  {magenta-fg}${sanitizeForBlessed(tc.name || 'unknown')}{/magenta-fg}`);
      }
    }
  }

  /**
   * Gather all communication-related entries
   */
  _gatherCommunicationEntries() {
    const historyStore = this.ui.historyStore;

    // Get all relevant entry types
    const prompts = historyStore.queryByType(HistoryEntryTypes.PROMPT, { order: 'asc' });
    const responses = historyStore.queryByType(HistoryEntryTypes.RESPONSE, { order: 'asc' });
    const interactions = historyStore.queryByType(HistoryEntryTypes.INTERACTION, { order: 'asc' });
    const toolCalls = historyStore.queryByType(HistoryEntryTypes.TOOL_CALL, { order: 'asc' });
    const toolResults = historyStore.queryByType(HistoryEntryTypes.TOOL_RESULT, { order: 'asc' });
    const phaseChanges = historyStore.queryByType(HistoryEntryTypes.PHASE_CHANGE, { order: 'asc' });

    // Combine and sort by sequence
    const all = [
      ...prompts.map(e => ({ ...e, entryType: 'prompt' })),
      ...responses.map(e => ({ ...e, entryType: 'response' })),
      ...interactions.map(e => ({ ...e, entryType: 'interaction' })),
      ...toolCalls.map(e => ({ ...e, entryType: 'tool_call' })),
      ...toolResults.map(e => ({ ...e, entryType: 'tool_result' })),
      ...phaseChanges.map(e => ({ ...e, entryType: 'phase_change' }))
    ].sort((a, b) => a.sequence - b.sequence);

    return all;
  }

  /**
   * Filter communication entries by agent and/or type
   */
  _filterCommunicationEntries(entries) {
    return entries.filter(entry => {
      // Filter by agent
      if (this.commFilterAgent) {
        const matchesAgent =
          entry.agentName === this.commFilterAgent ||
          entry.data?.from === this.commFilterAgent ||
          entry.data?.to === this.commFilterAgent ||
          entry.data?.agentName === this.commFilterAgent;

        if (!matchesAgent) return false;
      }

      // Filter by type
      if (this.commFilterType) {
        if (entry.entryType !== this.commFilterType) return false;
      }

      return true;
    });
  }

  /**
   * Link tool results to their corresponding tool calls
   */
  linkToolCallsAndResults(entries) {
    // Create a map of tool calls by agent and tool name
    const pendingToolCalls = new Map(); // key: `${agentName}-${toolName}-${sequence}` -> entry

    for (const entry of entries) {
      if (entry.entryType === 'tool_call') {
        const key = `${entry.agentName || entry.data?.agentName}-${entry.data?.toolName}`;
        if (!pendingToolCalls.has(key)) {
          pendingToolCalls.set(key, []);
        }
        pendingToolCalls.get(key).push(entry);
      } else if (entry.entryType === 'tool_result') {
        const key = `${entry.agentName || entry.data?.agentName}-${entry.data?.toolName}`;
        const calls = pendingToolCalls.get(key);
        if (calls && calls.length > 0) {
          // Link to the most recent unlinked call
          const linkedCall = calls.shift();
          entry.linkedToolCall = linkedCall;
          linkedCall.linkedToolResult = entry;
        }
      }
    }

    return entries;
  }

  /**
   * Render communication view header
   */
  renderHeader(lines, filteredCount, totalCount, contentWidth) {
    // Only show filter status if filters are active
    const filterParts = [];
    if (this.commFilterAgent) {
      filterParts.push(`{cyan-fg}Agent: ${this.commFilterAgent}{/cyan-fg}`);
    }
    if (this.commFilterType) {
      filterParts.push(`{magenta-fg}Type: ${this.commFilterType}{/magenta-fg}`);
    }

    if (filterParts.length > 0) {
      lines.push(`{yellow-fg}Filters:{/yellow-fg} ${filterParts.join('  ')}  {gray-fg}(${filteredCount} of ${totalCount}){/gray-fg}`);
    }
  }

  /**
   * Render a single communication entry
   */
  renderEntry(lines, entry, isSelected, isExpanded, contentWidth) {
    const time = formatTimestamp(entry.timestamp);
    const expandIcon = isExpanded ? 'v' : '>';
    const selectMarker = isSelected ? '{inverse}' : '';
    const selectEnd = isSelected ? '{/inverse}' : '';

    switch (entry.entryType) {
      case 'prompt':
        this._renderPromptEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth);
        break;

      case 'response':
        this._renderResponseEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth);
        break;

      case 'tool_call':
        this._renderToolCallEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth);
        break;

      case 'tool_result':
        this._renderToolResultEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth);
        break;

      case 'interaction':
        this._renderInteractionEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth);
        break;

      case 'phase_change':
        this._renderPhaseChangeEntry(lines, entry, time, selectMarker, selectEnd, contentWidth);
        break;
    }
  }

  /**
   * Render a prompt entry
   */
  _renderPromptEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {yellow-fg}<- PROMPT{/yellow-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

    if (isExpanded) {
      const content = entry.data?.content || '(empty)';
      lines.push(makeBoxTop('Prompt Content', contentWidth, 'yellow'));
      const wrapped = wrapText(content, contentWidth - 4);
      for (const line of wrapped) {
        lines.push(`{yellow-fg}\u2502{/yellow-fg} {gray-fg}${line}{/gray-fg}`);
      }
      lines.push(makeBoxBottom(contentWidth, 'yellow'));
    } else {
      const preview = truncate(entry.data?.content || '', contentWidth - 6);
      lines.push(`  {gray-fg}${preview}{/gray-fg}`);
    }
  }

  /**
   * Render a response entry
   */
  _renderResponseEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolCalls = entry.data?.toolCalls || [];

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}-> RESPONSE{/green-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

    if (isExpanded) {
      const content = entry.data?.content || '(empty)';
      lines.push(makeBoxTop('Response Content', contentWidth, 'green'));
      const wrapped = wrapText(content, contentWidth - 4);
      for (const line of wrapped) {
        lines.push(`{green-fg}│{/green-fg} {white-fg}${line}{/white-fg}`);
      }

      // Show tool calls as structured data
      if (toolCalls.length > 0) {
        lines.push('{green-fg}│{/green-fg}');
        lines.push('{green-fg}│{/green-fg} {magenta-fg}{bold}Tool Calls ({/bold}' + toolCalls.length + '{bold}):{/bold}{/magenta-fg}');
        for (const tool of toolCalls) {
          lines.push(`{green-fg}│{/green-fg}   {magenta-fg}├─ {bold}${tool.name || 'unknown'}{/bold}{/magenta-fg}`);
          // Format tool input as structured data
          if (tool.input) {
            const inputStr = typeof tool.input === 'object' ? JSON.stringify(tool.input, null, 2) : String(tool.input);
            const inputLines = inputStr.split('\n').slice(0, 5);
            for (const inputLine of inputLines) {
              const truncatedLine = truncate(inputLine, contentWidth - 12);
              lines.push(`{green-fg}│{/green-fg}   {gray-fg}│  ${truncatedLine}{/gray-fg}`);
            }
            if (inputStr.split('\n').length > 5) {
              lines.push(`{green-fg}│{/green-fg}   {gray-fg}│  ... (more){/gray-fg}`);
            }
          }
        }
      }
      lines.push(makeBoxBottom(contentWidth, 'green'));
    } else {
      const preview = truncate(entry.data?.content || '', contentWidth - 20);
      const toolSuffix = toolCalls.length > 0 ? ` {magenta-fg}(${toolCalls.length} tools){/magenta-fg}` : '';
      lines.push(`  {white-fg}${preview}{/white-fg}${toolSuffix}`);
    }
  }

  /**
   * Render a tool call entry (structured format)
   */
  _renderToolCallEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolName = entry.data?.toolName || 'unknown';

    // Show if this tool call has a linked result
    const hasResult = entry.linkedToolResult ? ' {green-fg}+{/green-fg}' : ' {yellow-fg}...{/yellow-fg}';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {magenta-fg}! TOOL CALL{/magenta-fg} {${agentColor}-fg}${agentName}{/${agentColor}-fg} -> {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${hasResult}${selectEnd}`);

    if (isExpanded) {
      lines.push(makeBoxTop('Tool Call', contentWidth, 'magenta'));
      lines.push(`{magenta-fg}│{/magenta-fg} {white-fg}Tool:{/white-fg} {bold}${toolName}{/bold}`);

      // Format input as structured data
      const input = entry.data?.input;
      if (input) {
        lines.push(`{magenta-fg}│{/magenta-fg} {white-fg}Input:{/white-fg}`);
        const inputStr = typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input);
        const inputLines = inputStr.split('\n');
        for (const inputLine of inputLines) {
          const truncatedLine = truncate(inputLine, contentWidth - 6);
          lines.push(`{magenta-fg}│{/magenta-fg}   {gray-fg}${truncatedLine}{/gray-fg}`);
        }
      }

      // Show linked result if available
      if (entry.linkedToolResult) {
        lines.push(`{magenta-fg}│{/magenta-fg}`);
        lines.push(`{magenta-fg}│{/magenta-fg} {green-fg}Result (sequence #${entry.linkedToolResult.sequence}):{/green-fg}`);
        const result = entry.linkedToolResult.data?.result;
        if (result) {
          const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          const resultLines = resultStr.split('\n').slice(0, 10);
          for (const resultLine of resultLines) {
            const truncatedLine = truncate(resultLine, contentWidth - 6);
            lines.push(`{magenta-fg}│{/magenta-fg}   {green-fg}${truncatedLine}{/green-fg}`);
          }
          if (resultStr.split('\n').length > 10) {
            lines.push(`{magenta-fg}│{/magenta-fg}   {gray-fg}... (truncated){/gray-fg}`);
          }
        }
      }
      lines.push(makeBoxBottom(contentWidth, 'magenta'));
    } else {
      // Collapsed preview
      const inputPreview = entry.data?.input
        ? truncate(JSON.stringify(entry.data.input), contentWidth - 6)
        : '(no input)';
      lines.push(`  {gray-fg}${inputPreview}{/gray-fg}`);
    }
  }

  /**
   * Render a tool result entry (linked to call)
   */
  _renderToolResultEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolName = entry.data?.toolName || 'unknown';

    // Show link to original call
    const callLink = entry.linkedToolCall ? ` {gray-fg}(call #${entry.linkedToolCall.sequence}){/gray-fg}` : '';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}! TOOL RESULT{/green-fg} {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${callLink}${selectEnd}`);

    if (isExpanded) {
      lines.push(makeBoxTop('Tool Result', contentWidth, 'green'));
      lines.push(`{green-fg}│{/green-fg} {white-fg}Tool:{/white-fg} {bold}${toolName}{/bold}`);
      lines.push(`{green-fg}│{/green-fg} {white-fg}Agent:{/white-fg} {${agentColor}-fg}${agentName}{/${agentColor}-fg}`);

      const result = entry.data?.result;
      if (result) {
        lines.push(`{green-fg}│{/green-fg} {white-fg}Result:{/white-fg}`);
        const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        const resultLines = resultStr.split('\n');
        for (const resultLine of resultLines) {
          const truncatedLine = truncate(resultLine, contentWidth - 6);
          lines.push(`{green-fg}│{/green-fg}   ${truncatedLine}`);
        }
      }
      lines.push(makeBoxBottom(contentWidth, 'green'));
    } else {
      const resultPreview = entry.data?.result
        ? truncate(typeof entry.data.result === 'object' ? JSON.stringify(entry.data.result) : String(entry.data.result), contentWidth - 6)
        : '(no result)';
      lines.push(`  {gray-fg}${resultPreview}{/gray-fg}`);
    }
  }

  /**
   * Render an agent interaction entry
   */
  _renderInteractionEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const fromColor = getAgentColor(entry.data?.from);
    const toColor = getAgentColor(entry.data?.to);
    const interactionType = entry.data?.type || 'message';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {white-fg}<-> ${interactionType.toUpperCase()}{/white-fg} {${fromColor}-fg}{bold}${entry.data?.from}{/bold}{/${fromColor}-fg} -> {${toColor}-fg}{bold}${entry.data?.to}{/bold}{/${toColor}-fg}${selectEnd}`);

    if (isExpanded) {
      lines.push(makeBoxTop('Interaction', contentWidth, 'white'));
      lines.push(`{white-fg}│{/white-fg} {gray-fg}Type:{/gray-fg} ${interactionType}`);
      lines.push(`{white-fg}│{/white-fg} {gray-fg}From:{/gray-fg} {${fromColor}-fg}${entry.data?.from}{/${fromColor}-fg}`);
      lines.push(`{white-fg}│{/white-fg} {gray-fg}To:{/gray-fg} {${toColor}-fg}${entry.data?.to}{/${toColor}-fg}`);

      const content = entry.data?.content || '';
      if (content) {
        lines.push(`{white-fg}│{/white-fg}`);
        lines.push(`{white-fg}│{/white-fg} {gray-fg}Content:{/gray-fg}`);
        const wrapped = wrapText(content, contentWidth - 4);
        for (const line of wrapped) {
          lines.push(`{white-fg}│{/white-fg}   ${line}`);
        }
      }

      // Show any tool calls in the interaction
      const toolCalls = entry.data?.toolCalls || [];
      if (toolCalls.length > 0) {
        lines.push(`{white-fg}│{/white-fg}`);
        lines.push(`{white-fg}│{/white-fg} {magenta-fg}Tool Calls:{/magenta-fg}`);
        for (const tool of toolCalls) {
          lines.push(`{white-fg}│{/white-fg}   {magenta-fg}- ${tool.name || 'unknown'}{/magenta-fg}`);
        }
      }
      lines.push(makeBoxBottom(contentWidth, 'white'));
    } else {
      const preview = truncate(entry.data?.content || '', contentWidth - 6);
      lines.push(`  {gray-fg}${preview}{/gray-fg}`);
    }
  }

  /**
   * Render a phase change entry (always compact, state change indicator)
   */
  _renderPhaseChangeEntry(lines, entry, time, selectMarker, selectEnd, contentWidth) {
    const prevPhase = entry.data?.previousPhase || 'start';
    const newPhase = entry.data?.newPhase || 'unknown';

    lines.push('');
    lines.push(`${selectMarker}{gray-fg}${time}{/gray-fg} {cyan-fg}# PHASE{/cyan-fg} {gray-fg}${prevPhase}{/gray-fg} -> {cyan-fg}{bold}${newPhase}{/bold}{/cyan-fg}${selectEnd}`);
  }

  /**
   * Render communication summary
   */
  renderSummary(lines, entries, contentWidth) {
    // Count by type
    const counts = {
      prompt: 0,
      response: 0,
      tool_call: 0,
      tool_result: 0,
      interaction: 0,
      phase_change: 0
    };

    for (const entry of entries) {
      if (counts[entry.entryType] !== undefined) {
        counts[entry.entryType]++;
      }
    }

    lines.push('');
    lines.push(`{cyan-fg}${'\u2500'.repeat(Math.max(1, Math.min(60, contentWidth - 2)))}{/cyan-fg}`);
    lines.push('{bold}Summary:{/bold}');
    lines.push(`  {yellow-fg}Prompts:{/yellow-fg} ${counts.prompt}  {green-fg}Responses:{/green-fg} ${counts.response}  {magenta-fg}Tool Calls:{/magenta-fg} ${counts.tool_call}  {magenta-fg}Results:{/magenta-fg} ${counts.tool_result}`);
    lines.push(`  {white-fg}Interactions:{/white-fg} ${counts.interaction}  {cyan-fg}Phase Changes:{/cyan-fg} ${counts.phase_change}`);
  }
}
