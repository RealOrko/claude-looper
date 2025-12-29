/**
 * Terminal UI Multi-View - Enhanced terminal interface with tabbed navigation
 *
 * Provides 3 views accessible via Tab/Shift+Tab:
 * 1. Tasks - Task hierarchy with dependencies
 * 2. Agents - Agent communication and tool calls
 * 3. Events - System events and state changes
 *
 * Each view displays data from the persistent WorkflowHistoryStore.
 */

import blessed from 'blessed';
import { getHistoryStore, HistoryEntryTypes } from './workflow-history-store.js';

// View identifiers
export const ViewTypes = {
  TASKS: 'tasks',
  COMMUNICATION: 'communication',
  EVENTS: 'events'
};

// View configurations
const VIEW_CONFIG = {
  [ViewTypes.TASKS]: {
    label: 'Tasks',
    description: 'Tasks'
  },
  [ViewTypes.COMMUNICATION]: {
    label: 'Agents',
    description: 'Agents'
  },
  [ViewTypes.EVENTS]: {
    label: 'Events',
    description: 'Events'
  }
};

// View order for tab navigation
const VIEW_ORDER = [ViewTypes.TASKS, ViewTypes.COMMUNICATION, ViewTypes.EVENTS];

// Status icons and colors (ASCII only for terminal compatibility)
const STATUS_STYLES = {
  pending: { icon: 'o', fg: 'gray' },
  in_progress: { icon: '*', fg: 'yellow' },
  completed: { icon: '+', fg: 'green' },
  failed: { icon: 'x', fg: 'red' },
  blocked: { icon: '-', fg: 'magenta' },
  next: { icon: '>', fg: 'cyan' }
};

// Phase display names
const PHASE_NAMES = {
  planning: 'Planning',
  plan_review: 'Review',
  execution: 'Executing',
  verification: 'Verifying'
};

// Spinner frames for busy animation
const SPINNER_FRAMES = ['|', '/', '-', '\\', '|', '/', '-', '\\', '|', '/'];

/**
 * Multi-View Terminal UI with tabbed navigation
 */
export class TerminalUIMultiView {
  constructor(options = {}) {
    this.initialized = false;
    this.screen = null;
    this.widgets = {};

    // View state
    this.currentView = ViewTypes.TASKS;
    this.viewPanels = {};
    this.viewScrollPositions = {};
    this.viewContent = {};

    // Initialize scroll positions for all views
    for (const view of Object.values(ViewTypes)) {
      this.viewScrollPositions[view] = 0;
      this.viewContent[view] = [];
    }

    // Task state (for task graph view)
    this.tasks = [];
    this.currentTaskId = null;
    this.nextTaskId = null;

    // Live agent tracking
    this.currentAgent = null;
    this.liveAgentOutput = [];
    this.jsonBuffer = '';

    // Phase and spinner
    this.phase = null;
    this.busy = false;
    this.spinnerFrame = 0;
    this.spinnerInterval = null;

    // History store reference
    this.historyStore = options.historyStore || getHistoryStore();

    // Auto-refresh interval
    this.refreshInterval = null;
    this.autoRefresh = options.autoRefresh !== false;

    // Prompt History view state
    this.promptSearchQuery = '';
    this.promptSearchActive = false;
    this.promptExpandedSections = new Set(); // Set of sequence numbers that are expanded
    this.promptSelectedIndex = 0; // Currently selected prompt/response pair index
    this.promptConversations = []; // Cached list of prompt/response pairs for navigation

    // Task Graph view state
    this.taskGraphSelectedIndex = 0; // Currently selected task index
    this.taskGraphShowDetails = true; // Whether to show detail pane for selected task
    this.taskGraphFlatList = []; // Flattened list of tasks for navigation

    // Agent Communication view state
    this.commFilterAgent = null;
    this.commFilterType = null;
    this.commSelectedIndex = 0;
    this.commInteractionList = [];

    // Event Log view state
    this.eventSearchQuery = '';
    this.eventSearchActive = false;
    this.eventCategoryFilters = new Set();
    this.eventSelectedIndex = 0;
    this.eventList = [];
    this.eventCategories = ['agent', 'task', 'goal', 'workflow', 'tool', 'error', 'system'];
  }

  /**
   * Initialize the terminal UI
   */
  async init() {
    if (this.initialized) return;

    // Initialize history store
    await this.historyStore.init();

    // Create blessed screen
    // Note: smartCSR causes rendering artifacts with non-full-width elements
    // Using fastCSR is less aggressive and causes fewer issues
    this.screen = blessed.screen({
      smartCSR: false,
      fastCSR: false,
      useBCE: true,
      title: 'Claude Looper - Multi-View',
      fullUnicode: true,
      autoPadding: false,
      warnings: false
    });

    this._createLayout();
    this._setupKeyboardShortcuts();

    // Initialize all view content
    this._refreshAllViews();

    // Show initial view
    this._switchToView(this.currentView);

    this.initialized = true;
    this.screen.render();

    // Start auto-refresh if enabled
    if (this.autoRefresh) {
      this.refreshCount = 0;
      this.refreshInterval = setInterval(() => {
        this._refreshCurrentView();
        // Periodically force full screen redraw to clear accumulated artifacts
        this.refreshCount++;
        if (this.refreshCount >= 5) {
          this.refreshCount = 0;
          this.screen.realloc();
        }
        this.screen.render();
      }, 200);
    }
  }

  /**
   * Create the UI layout
   */
  _createLayout() {
    // Header with tabs (top, full width, no border)
    this.widgets.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: 'white'
      }
    });

    // Main view panel (full width, changes based on active view)
    this.widgets.mainPanel = blessed.box({
      parent: this.screen,
      top: 1,
      left: 0,
      right: 0,
      bottom: 1,
      label: ' Tasks ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '|',
        track: { bg: 'black' },
        style: { bg: 'cyan' }
      },
      style: {
        fg: 'white',
        border: { fg: 'cyan' },
        label: { fg: 'cyan', bold: true }
      },
      border: { type: 'line' },
      content: '{gray-fg}Loading...{/gray-fg}'
    });

    // Status bar (bottom, no border)
    this.widgets.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: 'white'
      }
    });

    this._renderTabBar();
    this._renderStatusBar();
  }

  /**
   * Render the tab bar with active tab highlighted
   */
  _renderTabBar() {
    const tabs = [];
    for (const viewType of VIEW_ORDER) {
      const config = VIEW_CONFIG[viewType];
      const isActive = viewType === this.currentView;
      const style = isActive ? '{cyan-fg}{bold}' : '{gray-fg}';
      const endStyle = isActive ? '{/bold}{/cyan-fg}' : '{/gray-fg}';
      const indicator = isActive ? '*' : 'o';
      tabs.push(`${style}${indicator} ${config.label}${endStyle}`);
    }

    const spinner = this.busy
      ? `{magenta-fg}${SPINNER_FRAMES[this.spinnerFrame]}{/magenta-fg} `
      : '';
    const phaseName = PHASE_NAMES[this.phase] || this.phase || '';
    const phaseText = phaseName ? ` {yellow-fg}[${phaseName}]{/yellow-fg}` : '';

    // Blue bounded box for title using box-drawing characters
    this.widgets.header.setContent(
      `{blue-fg}│{/blue-fg}${spinner}{bold}{cyan-fg}Claude Looper{/cyan-fg}{/bold}{blue-fg}│{/blue-fg}${phaseText}  ${tabs.join('  ')}`
    );
  }

  /**
   * Render the status bar
   */
  _renderStatusBar() {
    const viewConfig = VIEW_CONFIG[this.currentView];

    const helpText = '{gray-fg}Tab: Views | jk: Scroll | r: Refresh | q: Quit{/gray-fg}';

    // Blue bounded box for footer using box-drawing characters
    this.widgets.statusBar.setContent(
      `{blue-fg}│{/blue-fg}{bold}${viewConfig.description}{/bold}{blue-fg}│{/blue-fg}  │  ${helpText}`
    );
  }

  /**
   * Set up keyboard shortcuts
   */
  _setupKeyboardShortcuts() {
    // Quit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
    });

    // Tab to cycle views forward
    this.screen.key(['tab'], () => {
      const currentIndex = VIEW_ORDER.indexOf(this.currentView);
      const nextIndex = (currentIndex + 1) % VIEW_ORDER.length;
      this._switchToView(VIEW_ORDER[nextIndex]);
    });

    // Shift+Tab to cycle views backward
    this.screen.key(['S-tab'], () => {
      const currentIndex = VIEW_ORDER.indexOf(this.currentView);
      const prevIndex = (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
      this._switchToView(VIEW_ORDER[prevIndex]);
    });

    // Refresh current view with full screen redraw
    this.screen.key(['r'], () => {
      this._refreshCurrentView();
      this.screen.realloc();
      this.screen.render();
    });

    // Task Graph view specific shortcuts
    // j/k or arrow keys for navigation
    this.screen.key(['j', 'down'], () => {
      if (this.currentView === ViewTypes.TASKS) {
        this._navigateTaskGraphDown();
      }
    });

    this.screen.key(['k', 'up'], () => {
      if (this.currentView === ViewTypes.TASKS) {
        this._navigateTaskGraphUp();
      }
    });

    // 'd' to toggle details pane
    this.screen.key(['d'], () => {
      if (this.currentView === ViewTypes.TASKS) {
        this._toggleTaskGraphDetails();
      }
    });

    // Agent Communication view specific shortcuts
    // j/k or arrow keys for navigation (shared with Tasks view)
    // These are already defined above for Tasks, but we extend them here for Communication
    this.screen.key(['j', 'down'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._navigateCommDown();
      }
    });

    this.screen.key(['k', 'up'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._navigateCommUp();
      }
    });

    // 'a' to cycle agent filter
    this.screen.key(['a'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._cycleCommAgentFilter();
      }
    });

    // 't' to cycle type filter
    this.screen.key(['t'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._cycleCommTypeFilter();
      }
    });

    // 'x' to clear all filters
    this.screen.key(['x'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._clearCommFilters();
      }
      if (this.currentView === ViewTypes.EVENTS) {
        this._clearEventFilters();
      }
    });

    // Event Log view specific shortcuts
    // j/k or arrow keys for navigation
    this.screen.key(['j', 'down'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._navigateEventDown();
      }
    });

    this.screen.key(['k', 'up'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._navigateEventUp();
      }
    });

    // '/' to start search in Events view
    this.screen.key(['/'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._startEventSearch();
      }
    });

    // 'f' to cycle through category filters (toggle hide/show)
    this.screen.key(['f'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._cycleEventCategoryFilter();
      }
    });

    // 'p' to filter by priority (error only, warning+error, all)
    this.screen.key(['p'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._cycleEventPriorityFilter();
      }
    });

    // Escape to clear search in Events view
    this.screen.key(['escape'], () => {
      if (this.currentView === ViewTypes.EVENTS && this.eventSearchActive) {
        this._clearEventSearch();
        return;
      }
    });

    // Focus on main panel by default
    this.widgets.mainPanel.focus();
  }

  /**
   * Navigate communication view down
   */
  _navigateCommDown() {
    if (this.commInteractionList.length === 0) return;
    this.commSelectedIndex = Math.max(0, this.commSelectedIndex - 1);
    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate communication view up
   */
  _navigateCommUp() {
    if (this.commInteractionList.length === 0) return;
    this.commSelectedIndex = Math.min(this.commInteractionList.length - 1, this.commSelectedIndex + 1);
    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Cycle through agent filter options
   */
  _cycleCommAgentFilter() {
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

    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Cycle through type filter options
   */
  _cycleCommTypeFilter() {
    const types = [null, 'interaction', 'prompt', 'response', 'tool_call', 'tool_result'];
    const currentIdx = types.indexOf(this.commFilterType);
    this.commFilterType = types[(currentIdx + 1) % types.length];
    this.commSelectedIndex = 0;

    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Clear all communication filters
   */
  _clearCommFilters() {
    this.commFilterAgent = null;
    this.commFilterType = null;
    this.commSelectedIndex = 0;

    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  // ============================================
  // Event Log View Helper Methods
  // ============================================

  /**
   * Navigate event log down
   */
  _navigateEventDown() {
    if (this.eventList.length === 0) return;
    this.eventSelectedIndex = Math.min(this.eventList.length - 1, this.eventSelectedIndex + 1);
    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate event log up
   */
  _navigateEventUp() {
    if (this.eventList.length === 0) return;
    this.eventSelectedIndex = Math.max(0, this.eventSelectedIndex - 1);
    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Start event search mode
   */
  _startEventSearch() {
    if (!this.widgets.eventSearchInput) {
      this.widgets.eventSearchInput = blessed.textbox({
        parent: this.screen,
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
    this.widgets.eventSearchInput.show();
    this.widgets.eventSearchInput.focus();
    this.widgets.eventSearchInput.setValue(this.eventSearchQuery);

    this.widgets.eventSearchInput.once('submit', (value) => {
      this.eventSearchQuery = value || '';
      this.eventSearchActive = false;
      this.widgets.eventSearchInput.hide();
      this.widgets.mainPanel.focus();
      this.eventSelectedIndex = 0;
      this._refreshEventsView();
      this._renderCurrentView();
      this.screen.render();
    });

    this.widgets.eventSearchInput.once('cancel', () => {
      this.eventSearchActive = false;
      this.widgets.eventSearchInput.hide();
      this.widgets.mainPanel.focus();
      this.screen.render();
    });

    this.screen.render();
  }

  /**
   * Clear event search
   */
  _clearEventSearch() {
    this.eventSearchQuery = '';
    this.eventSearchActive = false;
    if (this.widgets.eventSearchInput) {
      this.widgets.eventSearchInput.hide();
    }
    this.widgets.mainPanel.focus();
    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Cycle through event category filters (toggle visibility)
   */
  _cycleEventCategoryFilter() {
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
    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Cycle through priority filters (all -> errors only -> warnings+errors -> all)
   */
  _cycleEventPriorityFilter() {
    // Priority filter is managed by category filters
    // 'error' category filter cycles: show all -> only errors -> errors+warnings -> all
    const hasError = this.eventCategoryFilters.has('error');
    const hasWarning = this.eventCategoryFilters.has('warning');

    // We'll use a special property to track priority mode
    if (!this.eventPriorityMode) {
      this.eventPriorityMode = 'all';
    }

    const modes = ['all', 'errors', 'warnings'];
    const currentIdx = modes.indexOf(this.eventPriorityMode);
    this.eventPriorityMode = modes[(currentIdx + 1) % modes.length];

    this.eventSelectedIndex = 0;
    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Clear all event filters
   */
  _clearEventFilters() {
    this.eventSearchQuery = '';
    this.eventCategoryFilters.clear();
    this.eventPriorityMode = 'all';
    this.eventSelectedIndex = 0;

    this._refreshEventsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Categorize an event by its type
   */
  _categorizeEvent(event) {
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
  _getEventPriorityColor(priority) {
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
  _getEventCategoryIcon(category) {
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
  _getEventCategoryColor(category) {
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
   * Start prompt search mode
   */
  _startPromptSearch() {
    if (!this.widgets.searchInput) {
      // Create search input if it doesn't exist
      this.widgets.searchInput = blessed.textbox({
        parent: this.screen,
        top: 3,
        left: '25%+1',
        width: '75%-2',
        height: 3,
        border: { type: 'line' },
        label: ' Search (Enter to confirm, Esc to cancel) ',
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'yellow' }
        },
        inputOnFocus: true
      });
    }

    this.promptSearchActive = true;
    this.widgets.searchInput.show();
    this.widgets.searchInput.focus();
    this.widgets.searchInput.setValue(this.promptSearchQuery);

    this.widgets.searchInput.once('submit', (value) => {
      this.promptSearchQuery = value || '';
      this.promptSearchActive = false;
      this.widgets.searchInput.hide();
      this.widgets.mainPanel.focus();
      this._refreshPromptsView();
      this._renderCurrentView();
      this.screen.render();
    });

    this.widgets.searchInput.once('cancel', () => {
      this.promptSearchActive = false;
      this.widgets.searchInput.hide();
      this.widgets.mainPanel.focus();
      this.screen.render();
    });

    this.screen.render();
  }

  /**
   * Clear prompt search
   */
  _clearPromptSearch() {
    this.promptSearchQuery = '';
    this.promptSearchActive = false;
    if (this.widgets.searchInput) {
      this.widgets.searchInput.hide();
    }
    this.widgets.mainPanel.focus();
    this._refreshPromptsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate between prompts
   */
  _navigatePrompt(direction) {
    if (this.promptConversations.length === 0) return;

    this.promptSelectedIndex += direction;

    // Wrap around
    if (this.promptSelectedIndex < 0) {
      this.promptSelectedIndex = this.promptConversations.length - 1;
    } else if (this.promptSelectedIndex >= this.promptConversations.length) {
      this.promptSelectedIndex = 0;
    }

    this._refreshPromptsView();
    this._renderCurrentView();

    // Scroll to selected item
    this._scrollToPromptIndex(this.promptSelectedIndex);
    this.screen.render();
  }

  /**
   * Scroll to a specific prompt index
   */
  _scrollToPromptIndex(index) {
    // Calculate approximate line position (each collapsed item is ~4 lines, expanded varies)
    let linePos = 0;
    for (let i = 0; i < index && i < this.promptConversations.length; i++) {
      const conv = this.promptConversations[i];
      if (this.promptExpandedSections.has(conv.sequence)) {
        // Expanded: header + content lines
        linePos += 8 + (conv.promptLines || 0) + (conv.responseLines || 0);
      } else {
        // Collapsed: just header
        linePos += 5;
      }
    }

    if (this.widgets.mainPanel && this.widgets.mainPanel.scroll) {
      this.widgets.mainPanel.scrollTo(linePos);
    }
  }

  /**
   * Toggle expand/collapse for selected prompt
   */
  _togglePromptExpand() {
    if (this.promptConversations.length === 0) return;

    const selected = this.promptConversations[this.promptSelectedIndex];
    if (!selected) return;

    if (this.promptExpandedSections.has(selected.sequence)) {
      this.promptExpandedSections.delete(selected.sequence);
    } else {
      this.promptExpandedSections.add(selected.sequence);
    }

    this._refreshPromptsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Expand all prompts
   */
  _expandAllPrompts() {
    for (const conv of this.promptConversations) {
      this.promptExpandedSections.add(conv.sequence);
    }
    this._refreshPromptsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Collapse all prompts
   */
  _collapseAllPrompts() {
    this.promptExpandedSections.clear();
    this._refreshPromptsView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate task graph selection up
   */
  _navigateTaskGraphUp() {
    if (this.taskGraphFlatList.length === 0) return;
    this.taskGraphSelectedIndex = Math.max(0, this.taskGraphSelectedIndex - 1);
    this._refreshTasksView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate task graph selection down
   */
  _navigateTaskGraphDown() {
    if (this.taskGraphFlatList.length === 0) return;
    this.taskGraphSelectedIndex = Math.min(this.taskGraphFlatList.length - 1, this.taskGraphSelectedIndex + 1);
    this._refreshTasksView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Toggle task graph detail pane
   */
  _toggleTaskGraphDetails() {
    this.taskGraphShowDetails = !this.taskGraphShowDetails;
    this._refreshTasksView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Switch to a different view
   */
  _switchToView(viewType) {
    if (!VIEW_CONFIG[viewType]) return;

    // Save current scroll position
    this.viewScrollPositions[this.currentView] = this.widgets.mainPanel.getScroll();

    // Switch view
    this.currentView = viewType;
    const config = VIEW_CONFIG[viewType];

    // Clear the main panel content first to avoid artifacts
    this.widgets.mainPanel.setContent('');

    // Update panel label
    this.widgets.mainPanel.setLabel(` ${config.description} `);

    // Render the view content
    this._renderCurrentView();

    // Restore scroll position for new view
    const savedScroll = this.viewScrollPositions[viewType];
    if (savedScroll > 0) {
      this.widgets.mainPanel.setScroll(savedScroll);
    }

    // Update tab bar and status
    this._renderTabBar();
    this._renderStatusBar();

    // Force full screen redraw to clear any artifacts
    this.screen.realloc();
    this.screen.render();
  }

  /**
   * Refresh all view content from history store
   */
  _refreshAllViews() {
    this._refreshTasksView();
    this._refreshCommunicationView();
    this._refreshEventsView();
  }

  /**
   * Refresh only the current view
   */
  _refreshCurrentView() {
    switch (this.currentView) {
      case ViewTypes.TASKS:
        this._refreshTasksView();
        break;
      case ViewTypes.COMMUNICATION:
        this._refreshCommunicationView();
        break;
      case ViewTypes.EVENTS:
        this._refreshEventsView();
        break;
    }
    this._renderCurrentView();
    this._renderStatusBar();
  }

  /**
   * Refresh timeline view content - Enhanced execution timeline
   */
  _refreshTimelineView() {
    // Get all entries sorted chronologically (oldest first for timeline)
    const entries = this.historyStore.query({}, { order: 'asc', limit: 1000 });
    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.mainPanel);

    if (entries.length === 0) {
      lines.push('{gray-fg}No activity recorded yet...{/gray-fg}');
      lines.push('');
      lines.push('{gray-fg}The timeline will show:{/gray-fg}');
      lines.push('{gray-fg}  - Workflow phases (Planning -> Review -> Execution -> Verification){/gray-fg}');
      lines.push('{gray-fg}  - Task execution periods with duration{/gray-fg}');
      lines.push('{gray-fg}  - Retry attempts and fix cycles{/gray-fg}');
      this.viewContent[ViewTypes.TIMELINE] = lines;
      return;
    }

    // Build timeline structure from entries
    const timeline = this._buildTimelineStructure(entries);


    // Render phase flow visualization
    this._renderPhaseFlow(lines, timeline, contentWidth);
    lines.push('');

    // Render detailed timeline
    this._renderDetailedTimeline(lines, timeline, entries, contentWidth);

    this.viewContent[ViewTypes.TIMELINE] = lines;
  }

  /**
   * Build timeline structure from entries
   */
  _buildTimelineStructure(entries) {
    const timeline = {
      phases: [],
      currentPhase: null,
      taskExecutions: new Map(), // taskId -> { startTime, endTime, attempts, status }
      fixCycles: [],
      retryAttempts: []
    };

    let currentPhase = null;
    let phaseStartTime = null;

    for (const entry of entries) {
      // Track phase changes
      if (entry.type === HistoryEntryTypes.PHASE_CHANGE) {
        if (currentPhase && phaseStartTime) {
          timeline.phases.push({
            name: currentPhase,
            startTime: phaseStartTime,
            endTime: entry.timestamp
          });
        }
        currentPhase = entry.data.newPhase;
        phaseStartTime = entry.timestamp;
      }

      // Track task executions
      if (entry.type === HistoryEntryTypes.TASK_UPDATE) {
        const taskId = entry.data.taskId;
        if (!timeline.taskExecutions.has(taskId)) {
          timeline.taskExecutions.set(taskId, {
            taskId,
            startTime: entry.timestamp,
            endTime: entry.timestamp,
            attempts: 0,
            status: entry.data.status,
            events: []
          });
        }

        const taskExec = timeline.taskExecutions.get(taskId);
        taskExec.endTime = entry.timestamp;
        taskExec.status = entry.data.status;
        taskExec.events.push(entry);

        // Track attempts
        if (entry.data.status === 'in_progress') {
          taskExec.attempts++;
          if (taskExec.attempts > 1) {
            timeline.retryAttempts.push({
              taskId,
              attemptNumber: taskExec.attempts,
              timestamp: entry.timestamp
            });
          }
        }

        // Track fix cycles (when status goes from failed back to in_progress)
        if (entry.data.status === 'in_progress' && taskExec.events.length > 1) {
          const prevEvent = taskExec.events[taskExec.events.length - 2];
          if (prevEvent.data.status === 'failed') {
            timeline.fixCycles.push({
              taskId,
              timestamp: entry.timestamp,
              attemptNumber: taskExec.attempts
            });
          }
        }
      }
    }

    // Close current phase
    if (currentPhase && phaseStartTime) {
      timeline.phases.push({
        name: currentPhase,
        startTime: phaseStartTime,
        endTime: entries[entries.length - 1]?.timestamp || Date.now(),
        isCurrent: true
      });
    }

    timeline.currentPhase = currentPhase;
    return timeline;
  }

  /**
   * Render visual phase flow
   */
  _renderPhaseFlow(lines, timeline, contentWidth) {
    const phaseOrder = ['planning', 'plan_review', 'execution', 'verification'];
    const phaseIcons = {
      planning: 'P',
      plan_review: 'R',
      execution: 'E',
      verification: 'V'
    };

    // Determine which phases have been visited
    const visitedPhases = new Set(timeline.phases.map(p => p.name));
    const currentPhase = timeline.currentPhase;

    lines.push('{bold}Workflow Progress:{/bold}');
    lines.push('');

    // Build phase flow line
    let flowLine = '';
    let statusLine = '';

    for (let i = 0; i < phaseOrder.length; i++) {
      const phase = phaseOrder[i];
      const phaseName = PHASE_NAMES[phase] || phase;
      const isVisited = visitedPhases.has(phase);
      const isCurrent = phase === currentPhase;
      const isCompleted = isVisited && !isCurrent;

      // Phase box
      if (isCurrent) {
        flowLine += `{yellow-fg}{bold}[ ${phaseName} ]{/bold}{/yellow-fg}`;
        statusLine += '{yellow-fg}   ^ NOW   {/yellow-fg}';
      } else if (isCompleted) {
        flowLine += `{green-fg}[ ${phaseName} ]{/green-fg}`;
        statusLine += '{green-fg}    +     {/green-fg}';
      } else {
        flowLine += `{gray-fg}[ ${phaseName} ]{/gray-fg}`;
        statusLine += '{gray-fg}    o     {/gray-fg}';
      }

      // Arrow between phases
      if (i < phaseOrder.length - 1) {
        const nextPhase = phaseOrder[i + 1];
        const nextVisited = visitedPhases.has(nextPhase);
        if (isCompleted || (isCurrent && nextVisited)) {
          flowLine += ' {green-fg}───>{/green-fg} ';
          statusLine += '       ';
        } else {
          flowLine += ' {gray-fg}───>{/gray-fg} ';
          statusLine += '       ';
        }
      }
    }

    lines.push(flowLine);
    lines.push(statusLine);
    lines.push('');

    // Phase timing summary
    if (timeline.phases.length > 0) {
      lines.push('{bold}Phase Timing:{/bold}');
      for (const phase of timeline.phases) {
        const duration = this._formatDuration(phase.endTime - phase.startTime);
        const startTime = this._formatTimestamp(phase.startTime);
        const endTime = this._formatTimestamp(phase.endTime);
        const phaseName = PHASE_NAMES[phase.name] || phase.name;

        if (phase.isCurrent) {
          lines.push(`  {yellow-fg}* ${phaseName}{/yellow-fg}: ${startTime} -> {italic}ongoing{/italic} ({duration}+)`);
        } else {
          lines.push(`  {green-fg}+ ${phaseName}{/green-fg}: ${startTime} -> ${endTime} ({duration})`);
        }
      }
      lines.push('');
    }
  }

  /**
   * Render detailed timeline with task executions (focused dashboard view)
   */
  _renderDetailedTimeline(lines, timeline, entries, contentWidth) {
    // Calculate overall stats
    const totalTasks = timeline.taskExecutions.size;
    const completedTasks = Array.from(timeline.taskExecutions.values()).filter(e => e.status === 'completed').length;
    const failedTasks = Array.from(timeline.taskExecutions.values()).filter(e => e.status === 'failed').length;
    const inProgressTasks = Array.from(timeline.taskExecutions.values()).filter(e => e.status === 'in_progress').length;

    // Overall stats summary
    if (totalTasks > 0) {
      lines.push('{bold}Task Progress:{/bold}');

      // Progress bar
      const barWidth = Math.min(40, contentWidth - 20);
      const completedWidth = Math.round((completedTasks / totalTasks) * barWidth);
      const failedWidth = Math.round((failedTasks / totalTasks) * barWidth);
      const inProgressWidth = Math.round((inProgressTasks / totalTasks) * barWidth);
      const pendingWidth = barWidth - completedWidth - failedWidth - inProgressWidth;

      const progressBar =
        '{green-fg}' + '#'.repeat(completedWidth) + '{/green-fg}' +
        '{yellow-fg}' + '#'.repeat(inProgressWidth) + '{/yellow-fg}' +
        '{red-fg}' + '#'.repeat(failedWidth) + '{/red-fg}' +
        '{gray-fg}' + '.'.repeat(Math.max(0, pendingWidth)) + '{/gray-fg}';

      const percentage = Math.round((completedTasks / totalTasks) * 100);
      lines.push(`  [${progressBar}] ${percentage}%`);
      lines.push(`  {green-fg}${completedTasks} completed{/green-fg}  {yellow-fg}${inProgressTasks} in progress{/yellow-fg}  {red-fg}${failedTasks} failed{/red-fg}`);
      lines.push('');
    }

    // Show retry and fix cycle summary if any
    if (timeline.retryAttempts.length > 0 || timeline.fixCycles.length > 0) {
      lines.push('{bold}Retries & Fix Cycles:{/bold}');
      if (timeline.retryAttempts.length > 0) {
        lines.push(`  {yellow-fg}@ Retry Attempts: ${timeline.retryAttempts.length}{/yellow-fg}`);
      }
      if (timeline.fixCycles.length > 0) {
        lines.push(`  {magenta-fg}! Fix Cycles: ${timeline.fixCycles.length}{/magenta-fg}`);
      }
      lines.push('');
    }

    // Task execution Gantt-style view
    if (timeline.taskExecutions.size > 0) {
      lines.push('{bold}Task Execution Timeline:{/bold}');
      lines.push(`{cyan-fg}${'─'.repeat(Math.min(60, contentWidth - 2))}{/cyan-fg}`);

      // Find time range for scaling
      let minTime = Infinity, maxTime = 0;
      for (const exec of timeline.taskExecutions.values()) {
        minTime = Math.min(minTime, exec.startTime);
        maxTime = Math.max(maxTime, exec.endTime);
      }
      const timeRange = maxTime - minTime || 1;
      const barMaxWidth = Math.min(30, contentWidth - 40);

      for (const [taskId, exec] of timeline.taskExecutions) {
        const duration = this._formatDuration(exec.endTime - exec.startTime);

        // Get task description if available
        const task = this.tasks.find(t => t.id === taskId);
        const labelWidth = Math.max(20, contentWidth - 30);
        const taskLabel = task ? this._truncate(task.description || taskId, labelWidth) : taskId.substring(0, labelWidth);

        // Status styling
        let statusIcon, statusColor, barChar;
        switch (exec.status) {
          case 'completed':
            statusIcon = '+';
            statusColor = 'green';
            barChar = '#';
            break;
          case 'failed':
            statusIcon = 'x';
            statusColor = 'red';
            barChar = '#';
            break;
          case 'in_progress':
            statusIcon = '*';
            statusColor = 'yellow';
            barChar = '=';
            break;
          default:
            statusIcon = 'o';
            statusColor = 'gray';
            barChar = '.';
        }

        // Calculate bar position and width
        const startOffset = Math.round(((exec.startTime - minTime) / timeRange) * barMaxWidth);
        const barWidth = Math.max(1, Math.round(((exec.endTime - exec.startTime) / timeRange) * barMaxWidth));

        // Build Gantt bar
        const ganttBar = ' '.repeat(startOffset) + barChar.repeat(barWidth);

        // Build task line with attempt indicator
        let attemptSuffix = '';
        if (exec.attempts > 1) {
          attemptSuffix = ` {yellow-fg}(x${exec.attempts}){/yellow-fg}`;
        }

        lines.push(`  {${statusColor}-fg}${statusIcon}{/${statusColor}-fg} {white-fg}${taskLabel}{/white-fg}${attemptSuffix}`);
        lines.push(`    {${statusColor}-fg}${ganttBar}{/${statusColor}-fg} {gray-fg}${duration}{/gray-fg}`);
      }
      lines.push('');
    }

    // Current activity indicator
    if (this.busy) {
      lines.push(`{cyan-fg}${'─'.repeat(Math.min(60, contentWidth - 2))}{/cyan-fg}`);
      lines.push('{yellow-fg}* {bold}Processing...{/bold}{/yellow-fg}');
    }
  }

  /**
   * Format enhanced timeline entry with retry/fix cycle indicators
   */
  _formatEnhancedTimelineEntry(entry, time, contentWidth, isCurrentPosition) {
    const lines = [];
    const agentColor = this._getAgentColor(entry.agentName);
    const agentTag = entry.agentName ? `{${agentColor}-fg}[${entry.agentName}]{/${agentColor}-fg}` : '';
    const highlight = isCurrentPosition ? '{bold}' : '';
    const endHighlight = isCurrentPosition ? '{/bold}' : '';

    switch (entry.type) {
      case HistoryEntryTypes.PROMPT:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {yellow-fg}<- PROMPT{/yellow-fg}${endHighlight}`);
        const promptPreview = this._truncate(entry.data.content || '', contentWidth - 25);
        if (promptPreview) {
          lines.push(`  {gray-fg}${promptPreview}{/gray-fg}`);
        }
        break;

      case HistoryEntryTypes.RESPONSE:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {green-fg}-> RESPONSE{/green-fg}${endHighlight}`);
        const responsePreview = this._truncate(entry.data.content || '', contentWidth - 25);
        if (responsePreview) {
          lines.push(`  {white-fg}${responsePreview}{/white-fg}`);
        }
        if (entry.data.toolCalls && entry.data.toolCalls.length > 0) {
          lines.push(`  {magenta-fg}! Tools: ${entry.data.toolCalls.map(t => t.name).join(', ')}{/magenta-fg}`);
        }
        break;

      case HistoryEntryTypes.TOOL_CALL:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {magenta-fg}! Tool: ${entry.data.toolName}{/magenta-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.PHASE_CHANGE:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} {cyan-fg}# PHASE TRANSITION: ${entry.data.previousPhase || 'start'} -> ${entry.data.newPhase}{/cyan-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.TASK_UPDATE:
        const status = entry.data.status;
        const style = STATUS_STYLES[status] || STATUS_STYLES.pending;

        // Determine if this is a retry or fix cycle
        let indicator = '';
        if (entry.data.attempts && entry.data.attempts > 1) {
          indicator = ` {yellow-fg}@ RETRY #${entry.data.attempts}{/yellow-fg}`;
        }

        // Check if coming from failed state (fix cycle)
        const taskIdShort = entry.data.taskId?.substring(0, 20) || 'unknown';
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} {${style.fg}-fg}${style.icon} Task ${status}: ${taskIdShort}{/${style.fg}-fg}${indicator}${endHighlight}`);

        // Add duration if completed
        if (status === 'completed' && entry.data.duration) {
          lines.push(`  {gray-fg}Duration: ${this._formatDuration(entry.data.duration)}{/gray-fg}`);
        }
        break;

      case HistoryEntryTypes.EVENT:
        const eventType = entry.data.type || 'event';
        let eventColor = 'gray';
        if (eventType.includes('completed')) eventColor = 'green';
        else if (eventType.includes('failed')) eventColor = 'red';
        else if (eventType.includes('retry') || eventType.includes('fix')) eventColor = 'yellow';

        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {${eventColor}-fg}o ${eventType}{/${eventColor}-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.INTERACTION:
        const fromColor = this._getAgentColor(entry.data.from);
        const toColor = this._getAgentColor(entry.data.to);
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} {${fromColor}-fg}${entry.data.from}{/${fromColor}-fg} -> {${toColor}-fg}${entry.data.to}{/${toColor}-fg}${endHighlight}`);
        break;

      default:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} ${entry.type}${endHighlight}`);
    }

    return lines;
  }

  /**
   * Format duration in human-readable format
   */
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  /**
   * Refresh prompts view content - Enhanced with search, collapsible sections, and full content
   */
  _refreshPromptsView() {
    // Get ALL prompts and responses (no limit for complete archive)
    const prompts = this.historyStore.queryByType(HistoryEntryTypes.PROMPT, { order: 'asc' });
    const responses = this.historyStore.queryByType(HistoryEntryTypes.RESPONSE, { order: 'asc' });

    // Build conversation pairs (prompt + optional response)
    const conversations = this._buildConversationPairs(prompts, responses);

    // Apply search filter if active
    const filtered = this._filterPromptsBySearch(conversations);

    // Cache for navigation
    this.promptConversations = filtered;

    // Ensure selected index is valid
    if (this.promptSelectedIndex >= filtered.length) {
      this.promptSelectedIndex = Math.max(0, filtered.length - 1);
    }

    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.mainPanel);

    // Render header with help and search info
    this._renderPromptsHeader(lines, filtered.length, conversations.length, contentWidth);

    if (filtered.length === 0) {
      lines.push('');
      if (this.promptSearchQuery) {
        lines.push(`{yellow-fg}No results found for: "${this.promptSearchQuery}"{/yellow-fg}`);
        lines.push('{gray-fg}Press Esc to clear search, or / to search again{/gray-fg}');
      } else {
        lines.push('{gray-fg}No prompts or responses recorded yet...{/gray-fg}');
        lines.push('');
        lines.push('{gray-fg}Prompts will appear here as agents interact with the workflow.{/gray-fg}');
      }
    } else {
      // Render each conversation in reverse chronological order (newest first)
      const displayOrder = [...filtered].reverse();
      for (let i = 0; i < displayOrder.length; i++) {
        const conv = displayOrder[i];
        const realIndex = filtered.length - 1 - i;
        const isSelected = realIndex === this.promptSelectedIndex;
        const isExpanded = this.promptExpandedSections.has(conv.sequence);

        this._renderConversation(lines, conv, isSelected, isExpanded, contentWidth);
      }
    }

    this.viewContent[ViewTypes.PROMPTS] = lines;
  }

  /**
   * Build conversation pairs from prompts and responses
   */
  _buildConversationPairs(prompts, responses) {
    const conversations = [];
    const responseMap = new Map();

    // Index responses by their prompt sequence (response comes after prompt)
    for (const response of responses) {
      // Try to match response to most recent prompt from same agent
      const key = `${response.agentName}`;
      if (!responseMap.has(key)) {
        responseMap.set(key, []);
      }
      responseMap.get(key).push(response);
    }

    // Create conversation pairs
    for (const prompt of prompts) {
      const agentResponses = responseMap.get(prompt.agentName) || [];
      // Find the first response that comes after this prompt
      const matchingResponse = agentResponses.find(r => r.sequence > prompt.sequence);

      conversations.push({
        sequence: prompt.sequence,
        timestamp: prompt.timestamp,
        agentName: prompt.agentName,
        taskId: prompt.taskId,
        phase: prompt.phase,
        prompt: prompt,
        response: matchingResponse || null,
        promptLines: 0, // Will be calculated during render
        responseLines: 0
      });

      // Remove matched response from pool
      if (matchingResponse) {
        const idx = agentResponses.indexOf(matchingResponse);
        if (idx >= 0) agentResponses.splice(idx, 1);
      }
    }

    return conversations;
  }

  /**
   * Filter conversations by search query
   */
  _filterPromptsBySearch(conversations) {
    if (!this.promptSearchQuery || this.promptSearchQuery.trim() === '') {
      return conversations;
    }

    const query = this.promptSearchQuery.toLowerCase().trim();
    const terms = query.split(/\s+/).filter(t => t.length > 0);

    return conversations.filter(conv => {
      // Search in agent name
      if (conv.agentName && conv.agentName.toLowerCase().includes(query)) {
        return true;
      }

      // Search in task ID
      if (conv.taskId && conv.taskId.toLowerCase().includes(query)) {
        return true;
      }

      // Search in prompt content
      const promptContent = conv.prompt?.data?.content || '';
      if (terms.every(term => promptContent.toLowerCase().includes(term))) {
        return true;
      }

      // Search in response content
      const responseContent = conv.response?.data?.content || '';
      if (terms.every(term => responseContent.toLowerCase().includes(term))) {
        return true;
      }

      // Search in tool names
      const toolCalls = conv.response?.data?.toolCalls || [];
      const toolNames = toolCalls.map(t => t.name?.toLowerCase() || '').join(' ');
      if (terms.every(term => toolNames.includes(term))) {
        return true;
      }

      return false;
    });
  }

  /**
   * Render prompts view header with help info
   */
  _renderPromptsHeader(lines, filteredCount, totalCount, contentWidth) {

    // Show search status
    if (this.promptSearchQuery) {
      lines.push(`{yellow-fg}? Search: "${this.promptSearchQuery}" ({bold}${filteredCount}{/bold} of ${totalCount} matches){/yellow-fg}`);
    } else {
      lines.push(`{gray-fg}Total conversations: {bold}${totalCount}{/bold}{/gray-fg}`);
    }

    lines.push('');
  }

  /**
   * Render a single conversation (prompt + response pair)
   */
  _renderConversation(lines, conv, isSelected, isExpanded, contentWidth) {
    const time = this._formatTimestamp(conv.timestamp);
    const agentColor = this._getAgentColor(conv.agentName);
    const expandIcon = isExpanded ? 'v' : '>';
    const selectMarker = isSelected ? '{inverse}' : '';
    const selectEnd = isSelected ? '{/inverse}' : '';

    // Separator
    lines.push('');
    lines.push(`{cyan-fg}${'═'.repeat(Math.min(70, contentWidth - 2))}{/cyan-fg}`);

    // Header line with expand icon
    const taskInfo = conv.taskId ? ` {gray-fg}[${conv.taskId.substring(0, 20)}]{/gray-fg}` : '';
    const phaseInfo = conv.phase ? ` {gray-fg}(${conv.phase}){/gray-fg}` : '';
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {${agentColor}-fg}{bold}${conv.agentName}{/bold}{/${agentColor}-fg}${taskInfo}${phaseInfo}${selectEnd}`);

    if (isExpanded) {
      // PROMPT section - Full content without truncation
      lines.push('');
      lines.push('{yellow-fg}┌─ PROMPT ──────────────────────────────────────────────────{/yellow-fg}');

      const promptContent = conv.prompt?.data?.content || '(empty)';
      const promptWrapped = this._wrapText(promptContent, contentWidth - 4);
      conv.promptLines = promptWrapped.length;

      for (const line of promptWrapped) {
        // Highlight search matches
        const displayLine = this._highlightSearchTerms(line);
        lines.push(`{yellow-fg}│{/yellow-fg} {gray-fg}${displayLine}{/gray-fg}`);
      }
      lines.push('{yellow-fg}└────────────────────────────────────────────────────────────{/yellow-fg}');

      // RESPONSE section - Full content without truncation
      if (conv.response) {
        lines.push('');
        lines.push('{green-fg}┌─ RESPONSE ─────────────────────────────────────────────────{/green-fg}');

        const responseContent = conv.response.data?.content || '(empty)';
        const responseWrapped = this._wrapText(responseContent, contentWidth - 4);
        conv.responseLines = responseWrapped.length;

        for (const line of responseWrapped) {
          const displayLine = this._highlightSearchTerms(line);
          lines.push(`{green-fg}│{/green-fg} {white-fg}${displayLine}{/white-fg}`);
        }

        // Tool calls
        const toolCalls = conv.response.data?.toolCalls || [];
        if (toolCalls.length > 0) {
          lines.push('{green-fg}│{/green-fg}');
          lines.push('{green-fg}│{/green-fg} {magenta-fg}{bold}Tool Calls ({/bold}' + toolCalls.length + '{bold}):{/bold}{/magenta-fg}');
          for (const tool of toolCalls) {
            const toolDisplay = this._highlightSearchTerms(tool.name || 'unknown');
            lines.push(`{green-fg}│{/green-fg}   {magenta-fg}- ${toolDisplay}{/magenta-fg}`);
          }
        }

        lines.push('{green-fg}└────────────────────────────────────────────────────────────{/green-fg}');
      } else {
        lines.push('');
        lines.push('{gray-fg}(Awaiting response...){/gray-fg}');
      }

      // Response timestamp if available
      if (conv.response) {
        const responseTime = this._formatTimestamp(conv.response.timestamp);
        const duration = conv.response.timestamp - conv.timestamp;
        lines.push(`{gray-fg}Response at ${responseTime} (${this._formatDuration(duration)} later){/gray-fg}`);
      }
    } else {
      // Collapsed view - show preview
      const promptPreview = this._truncate(conv.prompt?.data?.content || '', contentWidth - 6);
      const responsePreview = conv.response
        ? this._truncate(conv.response.data?.content || '', contentWidth - 6)
        : '{gray-fg}(awaiting response){/gray-fg}';

      lines.push(`  {yellow-fg}<-{/yellow-fg} ${this._highlightSearchTerms(promptPreview)}`);
      lines.push(`  {green-fg}->{/green-fg} ${this._highlightSearchTerms(responsePreview)}`);

      // Show tool count if collapsed
      const toolCount = conv.response?.data?.toolCalls?.length || 0;
      if (toolCount > 0) {
        lines.push(`  {magenta-fg}! ${toolCount} tool call${toolCount > 1 ? 's' : ''}{/magenta-fg}`);
      }
    }
  }

  /**
   * Highlight search terms in text
   */
  _highlightSearchTerms(text) {
    if (!this.promptSearchQuery || !text) return text;

    const terms = this.promptSearchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    let result = text;

    for (const term of terms) {
      // Case-insensitive replacement with highlight
      const regex = new RegExp(`(${this._escapeRegex(term)})`, 'gi');
      result = result.replace(regex, '{bold}{yellow-bg}$1{/yellow-bg}{/bold}');
    }

    return result;
  }

  /**
   * Escape special regex characters
   */
  _escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Refresh tasks view content - Enhanced Task Dependency Graph
   */
  _refreshTasksView() {
    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.mainPanel);

    // Build task map and flat list
    const taskMap = new Map();
    for (const task of this.tasks) {
      taskMap.set(task.id, task);
    }

    // Build flat list for navigation (preserving hierarchy order)
    this.taskGraphFlatList = this._buildTaskFlatList(this.tasks, taskMap);

    // Ensure selected index is valid
    if (this.taskGraphSelectedIndex >= this.taskGraphFlatList.length) {
      this.taskGraphSelectedIndex = Math.max(0, this.taskGraphFlatList.length - 1);
    }

    if (this.tasks.length === 0) {
      lines.push('{gray-fg}No tasks recorded yet...{/gray-fg}');
      lines.push('{gray-fg}Tasks will appear here when the planner creates them.{/gray-fg}');
      this.viewContent[ViewTypes.TASKS] = lines;
      return;
    }

    // Calculate layout dimensions for side-by-side view
    const graphWidth = Math.floor(contentWidth * 0.5);
    const detailWidth = contentWidth - graphWidth - 3;

    // Render task tree into left column
    const leftLines = [];
    this._renderTaskTreeView(leftLines, taskMap, graphWidth);

    // Render details into right column
    const rightLines = [];
    if (this.taskGraphFlatList.length > 0) {
      const selectedTask = this.taskGraphFlatList[this.taskGraphSelectedIndex];
      if (selectedTask) {
        this._renderTaskDetailsColumn(rightLines, selectedTask, taskMap, detailWidth);
      }
    }

    // Merge columns side by side
    const maxLines = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxLines; i++) {
      let leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';

      // Truncate left line if it exceeds graphWidth
      const leftClean = this._stripTags(leftLine);
      if (leftClean.length > graphWidth - 1) {
        // Need to truncate - find a safe cut point
        leftLine = this._truncateWithTags(leftLine, graphWidth - 4) + '...';
      }

      const leftLen = this._stripTags(leftLine).length;
      const padding = Math.max(0, graphWidth - leftLen);
      lines.push(`${leftLine}${' '.repeat(padding)} {gray-fg}|{/gray-fg} ${rightLine}`);
    }

    this.viewContent[ViewTypes.TASKS] = lines;
  }

  /**
   * Build flat list of tasks for navigation with tree structure
   * Uses ONLY subtasks arrays for hierarchy (from replanning)
   * metadata.dependencies is execution order, NOT parent-child
   */
  _buildTaskFlatList(tasks, taskMap) {
    const flatList = [];
    const added = new Set();
    const childrenMap = new Map();
    const hasParent = new Set();

    // Build tree ONLY from subtasks arrays
    for (const task of tasks) {
      for (const kidId of (task.subtasks || [])) {
        const kid = taskMap.get(kidId);
        if (kid) {
          if (!childrenMap.has(task.id)) childrenMap.set(task.id, []);
          childrenMap.get(task.id).push(kid);
          hasParent.add(kidId);
        }
      }
    }

    // Roots = tasks not in any subtasks array
    const roots = tasks.filter(t => !hasParent.has(t.id));

    const addTask = (task, depth) => {
      if (added.has(task.id)) return;
      added.add(task.id);
      flatList.push({ ...task, depth });
      for (const child of (childrenMap.get(task.id) || [])) {
        addTask(child, depth + 1);
      }
    };

    for (const root of roots) {
      addTask(root, 0);
    }

    return flatList;
  }

  /**
   * Render the task tree view
   */
  _renderTaskTreeView(lines, taskMap, graphWidth) {
    for (let i = 0; i < this.taskGraphFlatList.length; i++) {
      const task = this.taskGraphFlatList[i];
      const isSelected = i === this.taskGraphSelectedIndex;
      const depth = task.depth || 0;

      // Find if last sibling at this depth
      let isLast = true;
      for (let j = i + 1; j < this.taskGraphFlatList.length; j++) {
        const nd = this.taskGraphFlatList[j].depth || 0;
        if (nd < depth) break;
        if (nd === depth) { isLast = false; break; }
      }

      // Track continuing lines
      const continuing = [];
      for (let d = 0; d < depth; d++) {
        let hasSibling = false;
        for (let j = i + 1; j < this.taskGraphFlatList.length; j++) {
          const nd = this.taskGraphFlatList[j].depth || 0;
          if (nd < d) break;
          if (nd === d) { hasSibling = true; break; }
        }
        continuing[d] = hasSibling;
      }

      this._renderTreeNode(lines, task, isSelected, depth, graphWidth, isLast, continuing);
    }
  }

  /**
   * Render a single task as a tree node
   */
  _renderTreeNode(lines, task, isSelected, depth, graphWidth, isLast, continuing) {
    const isCurrent = task.id === this.currentTaskId;
    const isNext = task.id === this.nextTaskId;

    let style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
    if (isCurrent) style = STATUS_STYLES.in_progress;
    if (isNext && !isCurrent) style = STATUS_STYLES.next;

    // Build tree prefix
    let prefix = '';
    for (let d = 0; d < depth; d++) {
      if (d === depth - 1) {
        prefix += isLast ? "'-- " : "|-- ";
      } else {
        prefix += continuing[d] ? "|   " : "    ";
      }
    }

    const icon = isCurrent ? '*' : (isNext ? '>' : style.icon);
    const descMaxWidth = Math.max(10, graphWidth - prefix.length - 4);
    const desc = this._truncate(task.description || 'Task', descMaxWidth);

    // Use bold for selection (no >> marker)
    const line = `{gray-fg}${prefix}{/gray-fg}{${style.fg}-fg}${icon}{/${style.fg}-fg} {white-fg}${desc}{/white-fg}`;
    lines.push(isSelected ? `{bold}${line}{/bold}` : line);
  }

  /**
   * Refresh communication view content - Enhanced with full interaction timeline
   */
  _refreshCommunicationView() {
    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.mainPanel);

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
      lines.push('{gray-fg}No agent communications recorded yet...{/gray-fg}');
      this.viewContent[ViewTypes.COMMUNICATION] = lines;
      return;
    }

    // Side-by-side layout like Tasks
    const listWidth = Math.floor(contentWidth * 0.5);
    const detailWidth = contentWidth - listWidth - 3;

    // Build left column (list)
    const leftLines = [];
    const displayOrder = [...filtered].reverse();
    for (let i = 0; i < displayOrder.length; i++) {
      const entry = displayOrder[i];
      const realIndex = filtered.length - 1 - i;
      const isSelected = realIndex === this.commSelectedIndex;
      const time = this._formatTimestamp(entry.timestamp);
      const agent = entry.agentName || entry.data?.agentName || '?';
      const type = this._getCommTypeLabel(entry.entryType);
      const desc = this._truncate(this._getCommPreview(entry), listWidth - 25);
      // Use bold for selection (same style as task tree)
      const line = `{gray-fg}${time}{/gray-fg} {${this._getCommTypeColor(entry.entryType)}-fg}${type}{/${this._getCommTypeColor(entry.entryType)}-fg} {cyan-fg}${agent}{/cyan-fg} ${desc}`;
      leftLines.push(isSelected ? `{bold}${line}{/bold}` : line);
    }

    // Build right column (details of selected)
    const rightLines = [];
    if (filtered.length > 0) {
      const selected = filtered[this.commSelectedIndex];
      if (selected) {
        this._renderCommDetails(rightLines, selected, detailWidth);
      }
    }

    // Merge columns
    const maxLines = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxLines; i++) {
      let leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';
      const leftClean = this._stripTags(leftLine);
      if (leftClean.length > listWidth - 1) {
        leftLine = this._truncateWithTags(leftLine, listWidth - 4) + '...';
      }
      const leftLen = this._stripTags(leftLine).length;
      const padding = Math.max(0, listWidth - leftLen);
      lines.push(`${leftLine}${' '.repeat(padding)} {gray-fg}|{/gray-fg} ${rightLine}`);
    }

    this.viewContent[ViewTypes.COMMUNICATION] = lines;
  }

  _getCommTypeLabel(entryType) {
    const labels = { prompt: '<-', response: '->', tool_call: '!', tool_result: '+', interaction: '<>', phase_change: '#' };
    return labels[entryType] || '?';
  }

  _getCommTypeColor(entryType) {
    const colors = { prompt: 'yellow', response: 'green', tool_call: 'magenta', tool_result: 'cyan', interaction: 'blue', phase_change: 'white' };
    return colors[entryType] || 'gray';
  }

  _getCommPreview(entry) {
    if (entry.data?.content) return entry.data.content;
    if (entry.data?.toolName) return entry.data.toolName;
    if (entry.data?.phase) return entry.data.phase;
    return '';
  }

  _renderCommDetails(lines, entry, width) {
    const time = this._formatTimestamp(entry.timestamp);
    const agent = entry.agentName || entry.data?.agentName || 'unknown';

    lines.push('{bold}Details:{/bold}');
    lines.push(`{cyan-fg}${'─'.repeat(Math.min(30, width))}{/cyan-fg}`);
    lines.push(`{white-fg}Type:{/white-fg} {${this._getCommTypeColor(entry.entryType)}-fg}${entry.entryType}{/${this._getCommTypeColor(entry.entryType)}-fg}`);
    lines.push(`{white-fg}Agent:{/white-fg} {cyan-fg}${agent}{/cyan-fg}`);
    lines.push(`{white-fg}Time:{/white-fg} {gray-fg}${time}{/gray-fg}`);
    lines.push('');

    if (entry.data?.content) {
      lines.push('{white-fg}Content:{/white-fg}');
      const wrapped = this._wrapText(entry.data.content, width - 2);
      for (const line of wrapped.slice(0, 15)) {
        lines.push(`  {gray-fg}${line}{/gray-fg}`);
      }
      if (wrapped.length > 15) lines.push('  {gray-fg}...{/gray-fg}');
    }

    if (entry.data?.toolName) {
      lines.push(`{white-fg}Tool:{/white-fg} {magenta-fg}${entry.data.toolName}{/magenta-fg}`);
      if (entry.data?.input) {
        lines.push('{white-fg}Input:{/white-fg}');
        const inputStr = typeof entry.data.input === 'object' ? JSON.stringify(entry.data.input, null, 2) : String(entry.data.input);
        for (const line of inputStr.split('\n').slice(0, 10)) {
          lines.push(`  {gray-fg}${this._truncate(line, width - 4)}{/gray-fg}`);
        }
      }
      if (entry.data?.result) {
        lines.push('{white-fg}Result:{/white-fg}');
        const resultStr = typeof entry.data.result === 'object' ? JSON.stringify(entry.data.result, null, 2) : String(entry.data.result);
        for (const line of resultStr.split('\n').slice(0, 10)) {
          lines.push(`  {gray-fg}${this._truncate(line, width - 4)}{/gray-fg}`);
        }
      }
    }

    if (entry.data?.toolCalls?.length > 0) {
      lines.push(`{white-fg}Tool Calls:{/white-fg} ${entry.data.toolCalls.length}`);
      for (const tc of entry.data.toolCalls.slice(0, 5)) {
        lines.push(`  {magenta-fg}${tc.name || 'unknown'}{/magenta-fg}`);
      }
    }
  }

  /**
   * Gather all communication-related entries
   */
  _gatherCommunicationEntries() {
    // Get all relevant entry types
    const prompts = this.historyStore.queryByType(HistoryEntryTypes.PROMPT, { order: 'asc' });
    const responses = this.historyStore.queryByType(HistoryEntryTypes.RESPONSE, { order: 'asc' });
    const interactions = this.historyStore.queryByType(HistoryEntryTypes.INTERACTION, { order: 'asc' });
    const toolCalls = this.historyStore.queryByType(HistoryEntryTypes.TOOL_CALL, { order: 'asc' });
    const toolResults = this.historyStore.queryByType(HistoryEntryTypes.TOOL_RESULT, { order: 'asc' });
    const phaseChanges = this.historyStore.queryByType(HistoryEntryTypes.PHASE_CHANGE, { order: 'asc' });

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
  _linkToolCallsAndResults(entries) {
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
  _renderCommHeader(lines, filteredCount, totalCount, contentWidth) {
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
  _renderCommEntry(lines, entry, isSelected, isExpanded, contentWidth) {
    const time = this._formatTimestamp(entry.timestamp);
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
    const agentColor = this._getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {yellow-fg}<- PROMPT{/yellow-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

    if (isExpanded) {
      const content = entry.data?.content || '(empty)';
      lines.push('{yellow-fg}┌─ Prompt Content ─────────────────────────────────────────{/yellow-fg}');
      const wrapped = this._wrapText(content, contentWidth - 4);
      for (const line of wrapped) {
        lines.push(`{yellow-fg}│{/yellow-fg} {gray-fg}${line}{/gray-fg}`);
      }
      lines.push('{yellow-fg}└──────────────────────────────────────────────────────────{/yellow-fg}');
    } else {
      const preview = this._truncate(entry.data?.content || '', contentWidth - 6);
      lines.push(`  {gray-fg}${preview}{/gray-fg}`);
    }
  }

  /**
   * Render a response entry
   */
  _renderResponseEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = this._getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolCalls = entry.data?.toolCalls || [];

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}-> RESPONSE{/green-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

    if (isExpanded) {
      const content = entry.data?.content || '(empty)';
      lines.push('{green-fg}┌─ Response Content ───────────────────────────────────────{/green-fg}');
      const wrapped = this._wrapText(content, contentWidth - 4);
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
              const truncatedLine = this._truncate(inputLine, contentWidth - 12);
              lines.push(`{green-fg}│{/green-fg}   {gray-fg}│  ${truncatedLine}{/gray-fg}`);
            }
            if (inputStr.split('\n').length > 5) {
              lines.push(`{green-fg}│{/green-fg}   {gray-fg}│  ... (more){/gray-fg}`);
            }
          }
        }
      }
      lines.push('{green-fg}└──────────────────────────────────────────────────────────{/green-fg}');
    } else {
      const preview = this._truncate(entry.data?.content || '', contentWidth - 20);
      const toolSuffix = toolCalls.length > 0 ? ` {magenta-fg}(${toolCalls.length} tools){/magenta-fg}` : '';
      lines.push(`  {white-fg}${preview}{/white-fg}${toolSuffix}`);
    }
  }

  /**
   * Render a tool call entry (structured format)
   */
  _renderToolCallEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = this._getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolName = entry.data?.toolName || 'unknown';

    // Show if this tool call has a linked result
    const hasResult = entry.linkedToolResult ? ' {green-fg}+{/green-fg}' : ' {yellow-fg}...{/yellow-fg}';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {magenta-fg}! TOOL CALL{/magenta-fg} {${agentColor}-fg}${agentName}{/${agentColor}-fg} -> {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${hasResult}${selectEnd}`);

    if (isExpanded) {
      lines.push('{magenta-fg}┌─ Tool Call ───────────────────────────────────────────────{/magenta-fg}');
      lines.push(`{magenta-fg}│{/magenta-fg} {white-fg}Tool:{/white-fg} {bold}${toolName}{/bold}`);

      // Format input as structured data
      const input = entry.data?.input;
      if (input) {
        lines.push(`{magenta-fg}│{/magenta-fg} {white-fg}Input:{/white-fg}`);
        const inputStr = typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input);
        const inputLines = inputStr.split('\n');
        for (const inputLine of inputLines) {
          const truncatedLine = this._truncate(inputLine, contentWidth - 6);
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
            const truncatedLine = this._truncate(resultLine, contentWidth - 6);
            lines.push(`{magenta-fg}│{/magenta-fg}   {green-fg}${truncatedLine}{/green-fg}`);
          }
          if (resultStr.split('\n').length > 10) {
            lines.push(`{magenta-fg}│{/magenta-fg}   {gray-fg}... (truncated){/gray-fg}`);
          }
        }
      }
      lines.push('{magenta-fg}└──────────────────────────────────────────────────────────{/magenta-fg}');
    } else {
      // Collapsed preview
      const inputPreview = entry.data?.input
        ? this._truncate(JSON.stringify(entry.data.input), contentWidth - 6)
        : '(no input)';
      lines.push(`  {gray-fg}${inputPreview}{/gray-fg}`);
    }
  }

  /**
   * Render a tool result entry (linked to call)
   */
  _renderToolResultEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const agentColor = this._getAgentColor(entry.agentName || entry.data?.agentName);
    const agentName = entry.agentName || entry.data?.agentName || 'unknown';
    const toolName = entry.data?.toolName || 'unknown';

    // Show link to original call
    const callLink = entry.linkedToolCall ? ` {gray-fg}(call #${entry.linkedToolCall.sequence}){/gray-fg}` : '';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}! TOOL RESULT{/green-fg} {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${callLink}${selectEnd}`);

    if (isExpanded) {
      lines.push('{green-fg}┌─ Tool Result ─────────────────────────────────────────────{/green-fg}');
      lines.push(`{green-fg}│{/green-fg} {white-fg}Tool:{/white-fg} {bold}${toolName}{/bold}`);
      lines.push(`{green-fg}│{/green-fg} {white-fg}Agent:{/white-fg} {${agentColor}-fg}${agentName}{/${agentColor}-fg}`);

      const result = entry.data?.result;
      if (result) {
        lines.push(`{green-fg}│{/green-fg} {white-fg}Result:{/white-fg}`);
        const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        const resultLines = resultStr.split('\n');
        for (const resultLine of resultLines) {
          const truncatedLine = this._truncate(resultLine, contentWidth - 6);
          lines.push(`{green-fg}│{/green-fg}   ${truncatedLine}`);
        }
      }
      lines.push('{green-fg}└──────────────────────────────────────────────────────────{/green-fg}');
    } else {
      const resultPreview = entry.data?.result
        ? this._truncate(typeof entry.data.result === 'object' ? JSON.stringify(entry.data.result) : String(entry.data.result), contentWidth - 6)
        : '(no result)';
      lines.push(`  {gray-fg}${resultPreview}{/gray-fg}`);
    }
  }

  /**
   * Render an agent interaction entry
   */
  _renderInteractionEntry(lines, entry, time, expandIcon, selectMarker, selectEnd, isExpanded, contentWidth) {
    const fromColor = this._getAgentColor(entry.data?.from);
    const toColor = this._getAgentColor(entry.data?.to);
    const interactionType = entry.data?.type || 'message';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {white-fg}<-> ${interactionType.toUpperCase()}{/white-fg} {${fromColor}-fg}{bold}${entry.data?.from}{/bold}{/${fromColor}-fg} -> {${toColor}-fg}{bold}${entry.data?.to}{/bold}{/${toColor}-fg}${selectEnd}`);

    if (isExpanded) {
      lines.push('{white-fg}┌─ Interaction ─────────────────────────────────────────────{/white-fg}');
      lines.push(`{white-fg}│{/white-fg} {gray-fg}Type:{/gray-fg} ${interactionType}`);
      lines.push(`{white-fg}│{/white-fg} {gray-fg}From:{/gray-fg} {${fromColor}-fg}${entry.data?.from}{/${fromColor}-fg}`);
      lines.push(`{white-fg}│{/white-fg} {gray-fg}To:{/gray-fg} {${toColor}-fg}${entry.data?.to}{/${toColor}-fg}`);

      const content = entry.data?.content || '';
      if (content) {
        lines.push(`{white-fg}│{/white-fg}`);
        lines.push(`{white-fg}│{/white-fg} {gray-fg}Content:{/gray-fg}`);
        const wrapped = this._wrapText(content, contentWidth - 4);
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
      lines.push('{white-fg}└──────────────────────────────────────────────────────────{/white-fg}');
    } else {
      const preview = this._truncate(entry.data?.content || '', contentWidth - 6);
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
  _renderCommSummary(lines, entries, contentWidth) {
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
    lines.push(`{cyan-fg}${'─'.repeat(Math.min(60, contentWidth - 2))}{/cyan-fg}`);
    lines.push('{bold}Summary:{/bold}');
    lines.push(`  {yellow-fg}Prompts:{/yellow-fg} ${counts.prompt}  {green-fg}Responses:{/green-fg} ${counts.response}  {magenta-fg}Tool Calls:{/magenta-fg} ${counts.tool_call}  {magenta-fg}Results:{/magenta-fg} ${counts.tool_result}`);
    lines.push(`  {white-fg}Interactions:{/white-fg} ${counts.interaction}  {cyan-fg}Phase Changes:{/cyan-fg} ${counts.phase_change}`);
  }

  /**
   * Refresh events view content - side-by-side layout
   */
  _refreshEventsView() {
    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.mainPanel);

    // Get all events
    const allEvents = this.historyStore.queryByType(HistoryEntryTypes.EVENT, { order: 'desc', limit: 500 });

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
      this.viewContent[ViewTypes.EVENTS] = lines;
      return;
    }

    // Side-by-side layout
    const listWidth = Math.floor(contentWidth * 0.5);
    const detailWidth = contentWidth - listWidth - 3;

    // Build left column (list)
    const leftLines = [];
    for (let i = 0; i < categorizedEvents.length; i++) {
      const event = categorizedEvents[i];
      const isSelected = i === this.eventSelectedIndex;
      const time = this._formatTimestamp(event.timestamp);
      const type = event.data?.type || 'event';
      const source = event.data?.source || event.agentName || '?';
      const priority = event._priority || 'info';
      const color = priority === 'error' ? 'red' : priority === 'warning' ? 'yellow' : 'gray';
      const desc = this._truncate(type, listWidth - 20);
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
      const leftClean = this._stripTags(leftLine);
      if (leftClean.length > listWidth - 1) {
        leftLine = this._truncateWithTags(leftLine, listWidth - 4) + '...';
      }
      const leftLen = this._stripTags(leftLine).length;
      const padding = Math.max(0, listWidth - leftLen);
      lines.push(`${leftLine}${' '.repeat(padding)} {gray-fg}|{/gray-fg} ${rightLine}`);
    }

    this.viewContent[ViewTypes.EVENTS] = lines;
  }

  _renderEventDetails(lines, event, width) {
    const time = this._formatTimestamp(event.timestamp);
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
        lines.push(`  {gray-fg}${this._truncate(line, width - 4)}{/gray-fg}`);
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
      const { category, priority } = this._categorizeEvent(event);

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
  _renderEventLogHeader(lines, totalCount, filteredCount, contentWidth) {
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
  _renderEventEntry(lines, event, isSelected, isExpanded, contentWidth) {
    const time = this._formatTimestamp(event.timestamp);
    const eventType = event.data?.type || 'unknown';
    const source = event.data?.source || event.agentName || 'system';

    const categoryIcon = this._getEventCategoryIcon(event._category);
    const categoryColor = this._getEventCategoryColor(event._category);
    const priorityColor = this._getEventPriorityColor(event._priority);

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
        const preview = this._truncate(desc, contentWidth - 10);
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
    const categoryColor = this._getEventCategoryColor(event._category);

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
          const truncatedLine = this._truncate(objLine, contentWidth - 8);
          lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg}   {gray-fg}${truncatedLine}{/gray-fg}`);
        }
      } catch {
        lines.push(`{${categoryColor}-fg}│{/${categoryColor}-fg}   {gray-fg}${String(event.data.object)}{/gray-fg}`);
      }
    }

    lines.push(`{${categoryColor}-fg}└──────────────────────────────────────────────────────────{/${categoryColor}-fg}`);
  }

  /**
   * Render the current view content
   */
  _renderCurrentView() {
    const content = this.viewContent[this.currentView] || [];
    // Clear before setting to avoid artifacts from previous content
    this.widgets.mainPanel.setContent('');
    this.widgets.mainPanel.setContent(content.join('\n'));
  }

  /**
   * Get color for an agent
   */
  _getAgentColor(agentName) {
    const colors = ['cyan', 'green', 'yellow', 'magenta', 'blue'];
    const agents = ['planner', 'coder', 'tester', 'supervisor', 'core'];
    const idx = agents.indexOf(agentName);
    return idx >= 0 ? colors[idx] : 'white';
  }

  /**
   * Format a timestamp
   */
  _formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Get content width of a widget
   */
  _getContentWidth(widget) {
    const width = (widget && widget.width) ? widget.width : 80;
    return Math.max(10, width - 3);
  }

  /**
   * Strip blessed tags from text for accurate width calculation
   */
  _stripTags(text) {
    if (!text) return '';
    return text.replace(/\{[^}]+\}/g, '');
  }

  /**
   * Truncate text while trying to preserve tags (simplified version)
   */
  _truncateWithTags(text, maxLen) {
    if (!text) return '';
    const stripped = this._stripTags(text);
    if (stripped.length <= maxLen) return text;
    // Simple approach: strip tags and truncate
    return stripped.substring(0, maxLen);
  }

  /**
   * Render task details column for side-by-side view
   */
  _renderTaskDetailsColumn(lines, task, taskMap, detailWidth) {
    lines.push('{bold}Details:{/bold}');
    lines.push(`{cyan-fg}${'─'.repeat(Math.min(30, detailWidth))}{/cyan-fg}`);

    // Status
    const style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
    lines.push(`{white-fg}Status:{/white-fg} {${style.fg}-fg}${task.status}{/${style.fg}-fg}`);

    // Complexity
    const complexity = task.metadata?.complexity || 'medium';
    let complexityColor = 'yellow';
    if (complexity === 'simple') complexityColor = 'green';
    else if (complexity === 'complex') complexityColor = 'red';
    lines.push(`{white-fg}Complexity:{/white-fg} {${complexityColor}-fg}${complexity}{/${complexityColor}-fg}`);

    // Description
    lines.push('');
    lines.push('{white-fg}Description:{/white-fg}');
    const descWrapped = this._wrapText(task.description || 'No description', detailWidth - 2);
    for (const line of descWrapped.slice(0, 4)) {
      lines.push(`  {gray-fg}${line}{/gray-fg}`);
    }
    if (descWrapped.length > 4) {
      lines.push(`  {gray-fg}...{/gray-fg}`);
    }

    // Verification Criteria
    const criteria = task.metadata?.verificationCriteria || [];
    if (criteria.length > 0) {
      lines.push('');
      lines.push('{white-fg}Criteria:{/white-fg}');
      for (const criterion of criteria.slice(0, 4)) {
        const critText = this._truncate(criterion, detailWidth - 4);
        lines.push(`  {cyan-fg}+{/cyan-fg} ${critText}`);
      }
      if (criteria.length > 4) {
        lines.push(`  {gray-fg}... +${criteria.length - 4} more{/gray-fg}`);
      }
    }

    // Subtasks
    const subtaskIds = task.subtasks || [];
    if (subtaskIds.length > 0) {
      lines.push('');
      lines.push('{white-fg}Subtasks:{/white-fg}');
      for (const subtaskId of subtaskIds.slice(0, 3)) {
        const subtask = taskMap.get(subtaskId);
        if (subtask) {
          const subStyle = STATUS_STYLES[subtask.status] || STATUS_STYLES.pending;
          const subDesc = this._truncate(subtask.description || subtaskId, detailWidth - 6);
          lines.push(`  {${subStyle.fg}-fg}${subStyle.icon}{/${subStyle.fg}-fg} ${subDesc}`);
        }
      }
      if (subtaskIds.length > 3) {
        lines.push(`  {gray-fg}... +${subtaskIds.length - 3} more{/gray-fg}`);
      }
    }
  }

  /**
   * Truncate text
   */
  _truncate(text, width) {
    if (!text || width <= 0) return '';
    const clean = this._sanitizeText(text);
    if (clean.length <= width) return clean;
    return clean.substring(0, width - 3) + '...';
  }

  /**
   * Wrap text
   */
  _wrapText(text, width) {
    if (!text) return [];
    const clean = this._sanitizeText(text);
    const lines = [];
    const paragraphs = clean.split('\n');

    for (const para of paragraphs) {
      if (para.length <= width) {
        lines.push(para);
      } else {
        let remaining = para;
        while (remaining.length > width) {
          let breakPoint = remaining.lastIndexOf(' ', width);
          if (breakPoint === -1) breakPoint = width;
          lines.push(remaining.substring(0, breakPoint));
          remaining = remaining.substring(breakPoint).trim();
        }
        if (remaining) lines.push(remaining);
      }
    }
    return lines;
  }

  /**
   * Sanitize text
   */
  _sanitizeText(text) {
    if (!text) return '';
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  }

  // ============================================
  // Public API - Compatible with existing TerminalUI
  // ============================================

  /**
   * Set current phase
   */
  setPhase(phase) {
    this.phase = phase;
    this.historyStore.setContext({ phase });
    if (this.initialized) {
      this._renderTabBar();
      this.screen.render();
    }
  }

  /**
   * Set busy state
   */
  setBusy(busy) {
    if (busy === this.busy) return;

    this.busy = busy;

    if (busy) {
      this.spinnerFrame = 0;
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        if (this.initialized) {
          this._renderTabBar();
          this.screen.render();
        }
      }, 80);
    } else {
      if (this.spinnerInterval) {
        clearInterval(this.spinnerInterval);
        this.spinnerInterval = null;
      }
    }

    if (this.initialized) {
      this._renderTabBar();
      this.screen.render();
    }
  }

  /**
   * Update tasks list
   */
  updateTasks(tasks, options = {}) {
    this.tasks = tasks || [];
    this.currentTaskId = options.currentTaskId || null;
    this.nextTaskId = options.nextTaskId || null;

    if (this.initialized) {
      if (this.currentView === ViewTypes.TASKS) {
        this._refreshTasksView();
        this._renderCurrentView();
      }
      this.screen.render();
    }
  }

  /**
   * Show agent prompt (stores to history)
   */
  showAgentPrompt(agentName, prompt) {
    this.currentAgent = agentName;

    // Store in history
    this.historyStore.addPrompt(agentName, prompt, {
      taskId: this.currentTaskId
    });

    if (this.initialized) {
      this._refreshCurrentView();
      this.screen.render();
    }
  }

  /**
   * Update agent panel (stores response chunks)
   */
  updateAgentPanel(agentName, output) {
    if (!output) return;

    this.jsonBuffer += output;

    // Try to extract complete JSON objects (line-delimited)
    const lines = this.jsonBuffer.split('\n');
    this.jsonBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);

        // Extract content from various formats
        if (data.content) {
          const content = typeof data.content === 'string'
            ? data.content
            : JSON.stringify(data.content);

          this.historyStore.addResponse(agentName, content, {
            taskId: this.currentTaskId,
            toolCalls: data.toolCalls || []
          });
        }

        // Handle tool calls
        if (data.type === 'tool_use' && data.name) {
          this.historyStore.addToolCall(agentName, data.name, data.input, {
            taskId: this.currentTaskId
          });
        }
      } catch {
        // Not JSON, ignore
      }
    }

    if (this.initialized && this.currentView === ViewTypes.TIMELINE) {
      this._refreshCurrentView();
      this.screen.render();
    }
  }

  /**
   * Clear agent output
   */
  clearAgentOutput() {
    this.currentAgent = null;
    this.jsonBuffer = '';
    this.liveAgentOutput = [];
  }

  /**
   * Add event (stores to history)
   */
  addEvent(source, message) {
    this.historyStore.addEvent({
      type: 'ui:event',
      source,
      object: { content: message }
    });

    if (this.initialized && this.currentView === ViewTypes.EVENTS) {
      this._refreshCurrentView();
      this.screen.render();
    }
  }

  /**
   * Add event from core (stores to history)
   */
  addEventFromCore(event) {
    this.historyStore.addEvent(event);

    if (this.initialized && this.currentView === ViewTypes.EVENTS) {
      this._refreshCurrentView();
      this.screen.render();
    }
  }

  /**
   * Get current view type
   */
  getCurrentView() {
    return this.currentView;
  }

  /**
   * Get scroll position for a view
   */
  getScrollPosition(viewType) {
    return this.viewScrollPositions[viewType] || 0;
  }

  /**
   * Destroy the UI
   */
  destroy() {
    if (!this.initialized) return;

    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    this.historyStore.shutdown();
    this.screen.destroy();
    this.initialized = false;
    process.exit(0);
  }

  /**
   * Graceful shutdown without exit
   */
  shutdown() {
    if (!this.initialized) return;

    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    this.historyStore.shutdown();
    this.screen.destroy();
    this.initialized = false;
  }

  /**
   * Show completion status and wait for user to quit
   * @param {boolean} success - Whether the workflow succeeded
   * @param {number} duration - Duration in milliseconds
   * @returns {Promise} Resolves when user quits
   */
  waitForExit(success, duration) {
    if (!this.initialized) return Promise.resolve();

    // Stop the spinner
    this.setBusy(false);

    // Update status bar to show completion
    const durationStr = Math.round(duration / 1000) + 's';
    const statusText = success
      ? `{green-fg}{bold}COMPLETED{/bold}{/green-fg} in ${durationStr}`
      : `{red-fg}{bold}FAILED{/bold}{/red-fg} after ${durationStr}`;

    const helpText = '{gray-fg}Press q to exit{/gray-fg}';

    this.widgets.statusBar.setContent(
      ` ${statusText}  │  ${helpText}`
    );
    this.screen.render();

    // Return a promise that resolves when user presses q
    return new Promise((resolve) => {
      const exitHandler = () => {
        this.shutdown();
        resolve();
      };

      // Override the quit handler to resolve instead of exit
      this.screen.unkey(['escape', 'q', 'C-c']);
      this.screen.key(['escape', 'q', 'C-c'], exitHandler);
    });
  }
}

export default TerminalUIMultiView;
