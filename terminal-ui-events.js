/**
 * Terminal UI Events View - System events and state changes display
 */

import blessed from 'blessed';
import { HistoryEntryTypes } from './workflow-history-store.js';
import {
  truncate,
  stripTags,
  truncateWithTags,
  formatTimestamp,
  getContentWidth
} from './terminal-ui-utils.js';

/**
 * EventsView handles the rendering and navigation of the events view
 */
export class EventsView {
  constructor(ui) {
    this.ui = ui;

    // Event Log view state
    this.eventSearchQuery = '';
    this.eventSearchActive = false;
    this.eventCategoryFilters = new Set();
    this.eventPriorityMode = 'all';
    this.eventSelectedIndex = 0;
    this.eventList = [];
    this.eventCategories = ['agent', 'task', 'goal', 'workflow', 'tool', 'error', 'system'];
  }

  /**
   * Navigate event log down
   */
  navigateDown() {
    if (this.eventList.length === 0) return;
    this.eventSelectedIndex = Math.min(this.eventList.length - 1, this.eventSelectedIndex + 1);
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
    // Scroll after render to ensure content is laid out
    this.ui.scrollToLine(this.eventSelectedIndex);
    this.ui.screen.render();
  }

  /**
   * Navigate event log up
   */
  navigateUp() {
    if (this.eventList.length === 0) return;
    this.eventSelectedIndex = Math.max(0, this.eventSelectedIndex - 1);
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
    // Scroll after render to ensure content is laid out
    this.ui.scrollToLine(this.eventSelectedIndex);
    this.ui.screen.render();
  }

  /**
   * Start event search mode
   */
  startSearch() {
    if (!this.ui.widgets.eventSearchInput) {
      this.ui.widgets.eventSearchInput = blessed.textbox({
        parent: this.ui.screen,
        top: 3,
        left: '25%+1',
        width: '75%-2',
        height: 3,
        border: { type: 'line' },
        label: ' Search Events (Enter to confirm, Esc to cancel) ',
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'yellow' }
        },
        inputOnFocus: true
      });
    }

    this.eventSearchActive = true;
    this.ui.widgets.eventSearchInput.show();
    this.ui.widgets.eventSearchInput.focus();
    this.ui.widgets.eventSearchInput.setValue(this.eventSearchQuery);

    this.ui.widgets.eventSearchInput.once('submit', (value) => {
      this.eventSearchQuery = value || '';
      this.eventSearchActive = false;
      this.ui.widgets.eventSearchInput.hide();
      this.ui.widgets.mainPanel.focus();
      this.eventSelectedIndex = 0;
      this.refresh();
      this.ui._renderCurrentView();
      this.ui.screen.render();
    });

    this.ui.widgets.eventSearchInput.once('cancel', () => {
      this.eventSearchActive = false;
      this.ui.widgets.eventSearchInput.hide();
      this.ui.widgets.mainPanel.focus();
      this.ui.screen.render();
    });

    this.ui.screen.render();
  }

  /**
   * Clear event search
   */
  clearSearch() {
    this.eventSearchQuery = '';
    this.eventSearchActive = false;
    if (this.ui.widgets.eventSearchInput) {
      this.ui.widgets.eventSearchInput.hide();
    }
    this.ui.widgets.mainPanel.focus();
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Cycle through event category filters (toggle visibility)
   */
  cycleCategoryFilter() {
    // Cycle through: show all -> hide each category one at a time -> back to all
    const categories = this.eventCategories;

    if (this.eventCategoryFilters.size === 0) {
      // Currently showing all, start hiding first category
      this.eventCategoryFilters.add(categories[0]);
    } else {
      // Find the currently hidden category and move to next
      const hiddenList = Array.from(this.eventCategoryFilters);
      if (hiddenList.length === 1) {
        const currentIdx = categories.indexOf(hiddenList[0]);
        if (currentIdx < categories.length - 1) {
          this.eventCategoryFilters.clear();
          this.eventCategoryFilters.add(categories[currentIdx + 1]);
        } else {
          // Cycled through all, back to showing all
          this.eventCategoryFilters.clear();
        }
      } else {
        // Multiple categories hidden, clear all
        this.eventCategoryFilters.clear();
      }
    }

    this.eventSelectedIndex = 0;
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Cycle through priority filters (all -> errors only -> warnings+errors -> all)
   */
  cyclePriorityFilter() {
    const modes = ['all', 'errors', 'warnings'];
    const currentIdx = modes.indexOf(this.eventPriorityMode);
    this.eventPriorityMode = modes[(currentIdx + 1) % modes.length];

    this.eventSelectedIndex = 0;
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Clear all event filters
   */
  clearFilters() {
    this.eventSearchQuery = '';
    this.eventCategoryFilters.clear();
    this.eventPriorityMode = 'all';
    this.eventSelectedIndex = 0;

    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Categorize an event by its type
   */
  categorizeEvent(event) {
    const eventType = (event.data?.type || '').toLowerCase();
    const source = (event.data?.source || event.agentName || '').toLowerCase();

    // Error priority events
    if (eventType.includes('error') || eventType.includes('failed') || eventType.includes('failure')) {
      return { category: 'error', priority: 'error' };
    }

    // Warning priority events
    if (eventType.includes('warning') || eventType.includes('retry') || eventType.includes('timeout')) {
      return { category: 'workflow', priority: 'warning' };
    }

    // Categorize by type
    if (eventType.includes('task')) {
      return { category: 'task', priority: 'info' };
    }
    if (eventType.includes('goal')) {
      return { category: 'goal', priority: 'info' };
    }
    if (eventType.includes('phase') || eventType.includes('workflow') || eventType.includes('started') || eventType.includes('completed')) {
      return { category: 'workflow', priority: 'info' };
    }
    if (eventType.includes('tool')) {
      return { category: 'tool', priority: 'info' };
    }
    if (['planner', 'coder', 'tester', 'supervisor'].includes(source)) {
      return { category: 'agent', priority: 'info' };
    }

    return { category: 'system', priority: 'info' };
  }

  /**
   * Get color for event priority
   */
  getPriorityColor(priority) {
    switch (priority) {
      case 'error': return 'red';
      case 'warning': return 'yellow';
      case 'info':
      default: return 'white';
    }
  }

  /**
   * Get icon for event category
   */
  getCategoryIcon(category) {
    switch (category) {
      case 'agent': return '@';
      case 'task': return '#';
      case 'goal': return '*';
      case 'workflow': return '~';
      case 'tool': return '$';
      case 'error': return 'x';
      case 'system': return '>';
      default: return '-';
    }
  }

  /**
   * Get color for event category
   */
  getCategoryColor(category) {
    switch (category) {
      case 'agent': return 'cyan';
      case 'task': return 'green';
      case 'goal': return 'magenta';
      case 'workflow': return 'blue';
      case 'tool': return 'yellow';
      case 'error': return 'red';
      case 'system': return 'gray';
      default: return 'white';
    }
  }

  /**
   * Refresh events view content - side-by-side layout
   */
  refresh() {
    const lines = [];
    const contentWidth = getContentWidth(this.ui.widgets.mainPanel);

    // Get all events
    const allEvents = this.ui.historyStore.queryByType(HistoryEntryTypes.EVENT, { order: 'desc', limit: 500 });

    // Categorize and filter events
    const categorizedEvents = this._categorizeAndFilterEvents(allEvents);

    // Cache for navigation
    this.eventList = categorizedEvents;

    // Ensure selected index is valid
    if (this.eventSelectedIndex >= categorizedEvents.length) {
      this.eventSelectedIndex = Math.max(0, categorizedEvents.length - 1);
    }

    if (categorizedEvents.length === 0) {
      lines.push('{gray-fg}No events recorded yet...{/gray-fg}');
      return lines;
    }

    // Side-by-side layout
    const listWidth = Math.floor(contentWidth * 0.5);
    const detailWidth = contentWidth - listWidth - 3;

    // Build left column (list)
    const leftLines = [];
    for (let i = 0; i < categorizedEvents.length; i++) {
      const event = categorizedEvents[i];
      const isSelected = i === this.eventSelectedIndex;
      const time = formatTimestamp(event.timestamp);
      const type = event.data?.type || 'event';
      const source = event.data?.source || event.agentName || '?';
      const priority = event._priority || 'info';
      const color = priority === 'error' ? 'red' : priority === 'warning' ? 'yellow' : 'white';
      const desc = truncate(type, listWidth - 20);
      // Use bold for selection (same style as task tree)
      const line = `{gray-fg}${time}{/gray-fg} {${color}-fg}${desc}{/${color}-fg} {cyan-fg}${source}{/cyan-fg}`;
      leftLines.push(isSelected ? `{bold}${line}{/bold}` : line);
    }

    // Build right column (details)
    const rightLines = [];
    if (categorizedEvents.length > 0) {
      const selected = categorizedEvents[this.eventSelectedIndex];
      if (selected) {
        this._renderEventDetails(rightLines, selected, detailWidth);
      }
    }

    // Merge columns
    const maxLines = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxLines; i++) {
      let leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';
      const leftClean = stripTags(leftLine);
      if (leftClean.length > listWidth - 1) {
        leftLine = truncateWithTags(leftLine, listWidth - 4) + '...';
      }
      const leftLen = stripTags(leftLine).length;
      const padding = Math.max(0, listWidth - leftLen);
      lines.push(`${leftLine}${' '.repeat(padding)} {gray-fg}|{/gray-fg} ${rightLine}`);
    }

    return lines;
  }

  /**
   * Render event details
   */
  _renderEventDetails(lines, event, width) {
    const time = formatTimestamp(event.timestamp);
    const type = event.data?.type || 'event';
    const source = event.data?.source || event.agentName || 'unknown';
    const priority = event._priority || 'info';
    const color = priority === 'error' ? 'red' : priority === 'warning' ? 'yellow' : 'white';

    lines.push('{bold}Details:{/bold}');
    lines.push(`{cyan-fg}${'─'.repeat(Math.min(30, width))}{/cyan-fg}`);
    lines.push(`{white-fg}Type:{/white-fg} {${color}-fg}${type}{/${color}-fg}`);
    lines.push(`{white-fg}Source:{/white-fg} {cyan-fg}${source}{/cyan-fg}`);
    lines.push(`{white-fg}Time:{/white-fg} {gray-fg}${time}{/gray-fg}`);
    lines.push(`{white-fg}Priority:{/white-fg} {${color}-fg}${priority}{/${color}-fg}`);
    lines.push('');

    if (event.data?.object) {
      lines.push('{white-fg}Object:{/white-fg}');
      const objStr = typeof event.data.object === 'object' ? JSON.stringify(event.data.object, null, 2) : String(event.data.object);
      for (const line of objStr.split('\n').slice(0, 15)) {
        lines.push(`  {gray-fg}${truncate(line, width - 4)}{/gray-fg}`);
      }
      if (objStr.split('\n').length > 15) lines.push('  {gray-fg}...{/gray-fg}');
    }
  }

  /**
   * Categorize and filter events
   */
  _categorizeAndFilterEvents(events) {
    const result = [];

    for (const event of events) {
      const { category, priority } = this.categorizeEvent(event);

      // Apply category filter
      if (this.eventCategoryFilters.has(category)) {
        continue;
      }

      // Apply priority filter
      if (this.eventPriorityMode === 'errors' && priority !== 'error') {
        continue;
      }
      if (this.eventPriorityMode === 'warnings' && priority !== 'error' && priority !== 'warning') {
        continue;
      }

      // Apply search filter
      if (this.eventSearchQuery) {
        const searchLower = this.eventSearchQuery.toLowerCase();
        const eventType = (event.data?.type || '').toLowerCase();
        const source = (event.data?.source || event.agentName || '').toLowerCase();
        const description = (event.data?.object?.description || '').toLowerCase();
        const objectStr = event.data?.object ? JSON.stringify(event.data.object).toLowerCase() : '';

        if (!eventType.includes(searchLower) &&
            !source.includes(searchLower) &&
            !description.includes(searchLower) &&
            !objectStr.includes(searchLower)) {
          continue;
        }
      }

      // Add categorization to event
      result.push({
        ...event,
        _category: category,
        _priority: priority
      });
    }

    return result;
  }

  /**
   * Render event log header
   */
  renderHeader(lines, totalCount, filteredCount, contentWidth) {
    // Only show filter status if filters are active
    const filterParts = [];
    if (this.eventSearchQuery) {
      filterParts.push(`{yellow-fg}Search: "${this.eventSearchQuery}"{/yellow-fg}`);
    }
    if (this.eventCategoryFilters.size > 0) {
      const hidden = Array.from(this.eventCategoryFilters).join(', ');
      filterParts.push(`{magenta-fg}Hidden: ${hidden}{/magenta-fg}`);
    }
    if (this.eventPriorityMode && this.eventPriorityMode !== 'all') {
      filterParts.push(`{red-fg}Priority: ${this.eventPriorityMode}{/red-fg}`);
    }

    if (filterParts.length > 0) {
      lines.push(`{yellow-fg}Active Filters:{/yellow-fg} ${filterParts.join('  ')}  {gray-fg}(${filteredCount} of ${totalCount} events){/gray-fg}`);
    }
  }

  /**
   * Render a single event entry
   */
  renderEntry(lines, event, isSelected, isExpanded, contentWidth) {
    const time = formatTimestamp(event.timestamp);
    const eventType = event.data?.type || 'unknown';
    const source = event.data?.source || event.agentName || 'system';

    const categoryIcon = this.getCategoryIcon(event._category);
    const categoryColor = this.getCategoryColor(event._category);
    const priorityColor = this.getPriorityColor(event._priority);

    const expandIcon = isExpanded ? 'v' : '>';
    const selectMarker = isSelected ? '{inverse}' : '';
    const selectEnd = isSelected ? '{/inverse}' : '';

    // Priority indicator
    let priorityIcon = 'i';
    if (event._priority === 'error') priorityIcon = 'X';
    else if (event._priority === 'warning') priorityIcon = '!';

    lines.push('');

    // Main event line with category icon and priority
    let mainLine = `${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} `;
    mainLine += `{${priorityColor}-fg}${priorityIcon}{/${priorityColor}-fg} `;
    mainLine += `{${categoryColor}-fg}${categoryIcon} [${event._category.toUpperCase()}]{/${categoryColor}-fg} `;
    mainLine += `{cyan-fg}[${source}]{/cyan-fg} `;
    mainLine += `{${priorityColor}-fg}{bold}${eventType}{/bold}{/${priorityColor}-fg}${selectEnd}`;

    lines.push(mainLine);

    // Quick description preview when collapsed
    if (!isExpanded && event.data?.object) {
      const desc = event.data.object.description || event.data.object.status || '';
      if (desc) {
        const preview = truncate(desc, contentWidth - 10);
        lines.push(`    {gray-fg}${preview}{/gray-fg}`);
      }
    }

    // Expanded view with full details
    if (isExpanded) {
      this._renderExpandedEventDetails(lines, event, contentWidth);
    }
  }

  /**
   * Render expanded event details
   */
  _renderExpandedEventDetails(lines, event, contentWidth) {
    const categoryColor = this.getCategoryColor(event._category);

    lines.push(`{${categoryColor}-fg}┌─ Event Details ─────────────────────────────────────────{/${categoryColor}-fg}`);

    // Basic info
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Type:{/white-fg} ${event.data?.type || 'unknown'}`);
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Source:{/white-fg} ${event.data?.source || event.agentName || 'system'}`);
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Category:{/white-fg} ${event._category}`);
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Priority:{/white-fg} ${event._priority}`);
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Timestamp:{/white-fg} ${new Date(event.timestamp).toISOString()}`);
    lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Sequence:{/white-fg} #${event.sequence}`);

    // Object data (formatted as structured JSON)
    if (event.data?.object) {
      lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg}`);
      lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg} {white-fg}Data:{/white-fg}`);

      try {
        const objStr = JSON.stringify(event.data.object, null, 2);
        const objLines = objStr.split('\n');
        for (const objLine of objLines) {
          const truncatedLine = truncate(objLine, contentWidth - 8);
          lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg}   {gray-fg}${truncatedLine}{/gray-fg}`);
        }
      } catch {
        lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg}   {gray-fg}${String(event.data.object)}{/gray-fg}`);
      }
    }

    lines.push(`{${categoryColor}-fg}└──────────────────────────────────────────────────────────{/${categoryColor}-fg}`);
  }
}
