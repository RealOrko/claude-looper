/**
 * Terminal UI Multi-View - Enhanced terminal interface with tabbed navigation
 *
 * Provides 5 distinct views accessible via keyboard shortcuts:
 * 1. Execution Timeline (F1) - Chronological workflow activity
 * 2. Prompt History (F2) - All agent prompts and responses
 * 3. Task Graph (F3) - Task hierarchy with dependencies
 * 4. Agent Communication (F4) - Inter-agent messages
 * 5. Event Log (F5) - System events and state changes
 *
 * Each view displays data from the persistent WorkflowHistoryStore.
 * Tab switching preserves scroll positions in other tabs.
 */

import blessed from 'blessed';
import { getHistoryStore, HistoryEntryTypes } from './workflow-history-store.js';

// View identifiers
export const ViewTypes = {
  TIMELINE: 'timeline',
  PROMPTS: 'prompts',
  TASKS: 'tasks',
  COMMUNICATION: 'communication',
  EVENTS: 'events'
};

// View configurations
const VIEW_CONFIG = {
  [ViewTypes.TIMELINE]: {
    label: 'Timeline',
    shortcut: 'F1',
    key: 'f1',
    description: 'Execution Timeline'
  },
  [ViewTypes.PROMPTS]: {
    label: 'Prompts',
    shortcut: 'F2',
    key: 'f2',
    description: 'Prompt History'
  },
  [ViewTypes.TASKS]: {
    label: 'Tasks',
    shortcut: 'F3',
    key: 'f3',
    description: 'Task Graph'
  },
  [ViewTypes.COMMUNICATION]: {
    label: 'Agents',
    shortcut: 'F4',
    key: 'f4',
    description: 'Agent Communication'
  },
  [ViewTypes.EVENTS]: {
    label: 'Events',
    shortcut: 'F5',
    key: 'f5',
    description: 'Event Log'
  }
};

// Status icons and colors (ASCII only for terminal compatibility)
const STATUS_STYLES = {
  pending: { icon: 'o', fg: 'gray' },
  in_progress: { icon: '*', fg: 'yellow' },
  completed: { icon: '+', fg: 'green' },
  failed: { icon: 'x', fg: 'red' },
  blocked: { icon: '-', fg: 'magenta' },
  next: { icon: '>', fg: 'cyan' }
};

// Tree drawing characters (ASCII only)
const TREE_CHARS = {
  vertical: '|',
  branch: '|',
  corner: "'",
  horizontal: '-'
};

// Phase display names
const PHASE_NAMES = {
  planning: 'Planning',
  plan_review: 'Review',
  execution: 'Executing',
  verification: 'Verifying'
};

// Spinner frames for busy animation
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Multi-View Terminal UI with tabbed navigation
 */
export class TerminalUIMultiView {
  constructor(options = {}) {
    this.initialized = false;
    this.screen = null;
    this.widgets = {};

    // View state
    this.currentView = ViewTypes.TIMELINE;
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
    this.commFilterAgent = null; // Filter by specific agent (null = all)
    this.commFilterType = null; // Filter by interaction type (null = all)
    this.commSelectedIndex = 0; // Currently selected interaction index
    this.commExpandedItems = new Set(); // Set of sequence numbers that are expanded
    this.commInteractionList = []; // Cached list of interactions for navigation

    // Event Log view state
    this.eventSearchQuery = ''; // Search filter for events
    this.eventSearchActive = false; // Whether search is active
    this.eventCategoryFilters = new Set(); // Set of hidden categories (categories to exclude)
    this.eventSelectedIndex = 0; // Currently selected event index
    this.eventExpandedItems = new Set(); // Set of sequence numbers that are expanded
    this.eventList = []; // Cached list of events for navigation
    this.eventCategories = ['agent', 'task', 'goal', 'workflow', 'tool', 'error', 'system']; // Available categories
  }

  /**
   * Initialize the terminal UI
   */
  async init() {
    if (this.initialized) return;

    // Initialize history store
    await this.historyStore.init();

    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Claude Looper - Multi-View',
      fullUnicode: true,
      autoPadding: false
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
      this.refreshInterval = setInterval(() => {
        this._refreshCurrentView();
      }, 1000);
    }
  }

  /**
   * Create the UI layout
   */
  _createLayout() {
    // Header with tabs (top, full width)
    this.widgets.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    // Tab bar (inside header)
    this.widgets.tabBar = blessed.box({
      parent: this.widgets.header,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'white' }
    });

    // Left panel - Task list (always visible)
    this.widgets.taskPanel = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '25%',
      height: '100%-6',
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
      content: ''
    });

    // Main view panel (right side, changes based on active view)
    this.widgets.mainPanel = blessed.box({
      parent: this.screen,
      top: 3,
      left: '25%',
      right: 0,
      height: '100%-6',
      label: ' Timeline ',
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

    // Status bar (bottom)
    this.widgets.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'gray' }
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
    for (const [viewType, config] of Object.entries(VIEW_CONFIG)) {
      const isActive = viewType === this.currentView;
      const style = isActive ? '{cyan-fg}{bold}' : '{gray-fg}';
      const endStyle = isActive ? '{/bold}{/cyan-fg}' : '{/gray-fg}';
      const indicator = isActive ? '●' : '○';
      tabs.push(`${style}${indicator} ${config.shortcut}:${config.label}${endStyle}`);
    }

    const spinner = this.busy
      ? `{magenta-fg}${SPINNER_FRAMES[this.spinnerFrame]}{/magenta-fg} `
      : '';
    const phaseName = PHASE_NAMES[this.phase] || this.phase || '';
    const phaseText = phaseName ? ` {yellow-fg}[${phaseName}]{/yellow-fg}` : '';

    this.widgets.header.setContent(
      ` ${spinner}{bold}{cyan-fg}Claude Looper{/cyan-fg}{/bold}${phaseText}  │  ${tabs.join('  ')}`
    );
  }

  /**
   * Render the status bar
   */
  _renderStatusBar() {
    const viewConfig = VIEW_CONFIG[this.currentView];
    const stats = this.historyStore.getStats();

    const helpText = '{gray-fg}F1-F5: Switch Views | Tab: Focus | ↑↓/j/k: Scroll | q: Quit{/gray-fg}';
    const statsText = `{cyan-fg}Entries: ${stats.totalEntries}{/cyan-fg}`;

    this.widgets.statusBar.setContent(
      ` {bold}${viewConfig.description}{/bold}  │  ${statsText}  │  ${helpText}`
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

    // View switching with F1-F5
    this.screen.key(['f1'], () => this._switchToView(ViewTypes.TIMELINE));
    this.screen.key(['f2'], () => this._switchToView(ViewTypes.PROMPTS));
    this.screen.key(['f3'], () => this._switchToView(ViewTypes.TASKS));
    this.screen.key(['f4'], () => this._switchToView(ViewTypes.COMMUNICATION));
    this.screen.key(['f5'], () => this._switchToView(ViewTypes.EVENTS));

    // Number keys as alternative
    this.screen.key(['1'], () => this._switchToView(ViewTypes.TIMELINE));
    this.screen.key(['2'], () => this._switchToView(ViewTypes.PROMPTS));
    this.screen.key(['3'], () => this._switchToView(ViewTypes.TASKS));
    this.screen.key(['4'], () => this._switchToView(ViewTypes.COMMUNICATION));
    this.screen.key(['5'], () => this._switchToView(ViewTypes.EVENTS));

    // Tab to cycle focus
    this.screen.key(['tab'], () => {
      this.screen.focusNext();
      this.screen.render();
    });

    // Shift+Tab to cycle focus backwards
    this.screen.key(['S-tab'], () => {
      this.screen.focusPrevious();
      this.screen.render();
    });

    // Refresh current view
    this.screen.key(['r'], () => {
      this._refreshCurrentView();
      this.screen.render();
    });

    // Prompt History view specific shortcuts
    // '/' to start search
    this.screen.key(['/'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._startPromptSearch();
      }
    });

    // 'n' and 'N' to navigate between prompts
    this.screen.key(['n'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._navigatePrompt(1); // Next
      }
    });

    this.screen.key(['S-n'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._navigatePrompt(-1); // Previous
      }
    });

    // Enter to toggle expand/collapse
    this.screen.key(['enter'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._togglePromptExpand();
      }
    });

    // 'e' to expand all, 'c' to collapse all
    this.screen.key(['e'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._expandAllPrompts();
      }
    });

    this.screen.key(['c'], () => {
      if (this.currentView === ViewTypes.PROMPTS) {
        this._collapseAllPrompts();
      }
    });

    // Escape to clear search or exit
    this.screen.key(['escape'], () => {
      if (this.currentView === ViewTypes.PROMPTS && this.promptSearchActive) {
        this._clearPromptSearch();
        return;
      }
      this.destroy();
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

    // Enter to expand/collapse item
    this.screen.key(['enter'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this._toggleCommExpand();
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

    // Enter to expand/collapse event details
    this.screen.key(['enter'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this._toggleEventExpand();
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
    this.commSelectedIndex = Math.min(this.commInteractionList.length - 1, this.commSelectedIndex + 1);
    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Navigate communication view up
   */
  _navigateCommUp() {
    if (this.commInteractionList.length === 0) return;
    this.commSelectedIndex = Math.max(0, this.commSelectedIndex - 1);
    this._refreshCommunicationView();
    this._renderCurrentView();
    this.screen.render();
  }

  /**
   * Toggle expand/collapse for selected communication item
   */
  _toggleCommExpand() {
    if (this.commInteractionList.length === 0) return;
    const selected = this.commInteractionList[this.commSelectedIndex];
    if (!selected) return;

    if (this.commExpandedItems.has(selected.sequence)) {
      this.commExpandedItems.delete(selected.sequence);
    } else {
      this.commExpandedItems.add(selected.sequence);
    }

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
   * Toggle expand/collapse for selected event
   */
  _toggleEventExpand() {
    if (this.eventList.length === 0) return;
    const selected = this.eventList[this.eventSelectedIndex];
    if (!selected) return;

    if (this.eventExpandedItems.has(selected.sequence)) {
      this.eventExpandedItems.delete(selected.sequence);
    } else {
      this.eventExpandedItems.add(selected.sequence);
    }

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
      case 'agent': return '🤖';
      case 'task': return '📋';
      case 'goal': return '🎯';
      case 'workflow': return '⚙️';
      case 'tool': return '🔧';
      case 'error': return '❌';
      case 'system': return '💻';
      default: return '•';
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

    // Auto-expand the selected prompt
    const selected = this.promptConversations[this.promptSelectedIndex];
    if (selected) {
      this.promptExpandedSections.add(selected.sequence);
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
    this.screen.render();
  }

  /**
   * Refresh all view content from history store
   */
  _refreshAllViews() {
    this._refreshTimelineView();
    this._refreshPromptsView();
    this._refreshTasksView();
    this._refreshCommunicationView();
    this._refreshEventsView();
  }

  /**
   * Refresh only the current view
   */
  _refreshCurrentView() {
    switch (this.currentView) {
      case ViewTypes.TIMELINE:
        this._refreshTimelineView();
        break;
      case ViewTypes.PROMPTS:
        this._refreshPromptsView();
        break;
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
      lines.push('{gray-fg}  • Workflow phases (Planning → Review → Execution → Verification){/gray-fg}');
      lines.push('{gray-fg}  • Task execution periods with duration{/gray-fg}');
      lines.push('{gray-fg}  • Retry attempts and fix cycles{/gray-fg}');
      this.viewContent[ViewTypes.TIMELINE] = lines;
      return;
    }

    // Build timeline structure from entries
    const timeline = this._buildTimelineStructure(entries);

    // Render workflow header
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}                    EXECUTION TIMELINE                       {/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('');

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
      planning: '📋',
      plan_review: '🔍',
      execution: '⚙️',
      verification: '✓'
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
        statusLine += '{yellow-fg}   ▲ NOW   {/yellow-fg}';
      } else if (isCompleted) {
        flowLine += `{green-fg}[ ${phaseName} ]{/green-fg}`;
        statusLine += '{green-fg}    ✓     {/green-fg}';
      } else {
        flowLine += `{gray-fg}[ ${phaseName} ]{/gray-fg}`;
        statusLine += '{gray-fg}    ○     {/gray-fg}';
      }

      // Arrow between phases
      if (i < phaseOrder.length - 1) {
        const nextPhase = phaseOrder[i + 1];
        const nextVisited = visitedPhases.has(nextPhase);
        if (isCompleted || (isCurrent && nextVisited)) {
          flowLine += ' {green-fg}───▶{/green-fg} ';
          statusLine += '       ';
        } else {
          flowLine += ' {gray-fg}───▷{/gray-fg} ';
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
          lines.push(`  {yellow-fg}● ${phaseName}{/yellow-fg}: ${startTime} → {italic}ongoing{/italic} ({duration}+)`);
        } else {
          lines.push(`  {green-fg}✓ ${phaseName}{/green-fg}: ${startTime} → ${endTime} ({duration})`);
        }
      }
      lines.push('');
    }
  }

  /**
   * Render detailed timeline with task executions
   */
  _renderDetailedTimeline(lines, timeline, entries, contentWidth) {
    lines.push('{bold}{cyan-fg}───────────────────────────────────────────────────────────{/cyan-fg}{/bold}');
    lines.push('{bold}                     DETAILED TIMELINE                      {/bold}');
    lines.push('{bold}{cyan-fg}───────────────────────────────────────────────────────────{/cyan-fg}{/bold}');
    lines.push('');

    // Show retry and fix cycle summary if any
    if (timeline.retryAttempts.length > 0 || timeline.fixCycles.length > 0) {
      lines.push('{bold}Retries & Fix Cycles:{/bold}');
      if (timeline.retryAttempts.length > 0) {
        lines.push(`  {yellow-fg}⟳ Retry Attempts: ${timeline.retryAttempts.length}{/yellow-fg}`);
      }
      if (timeline.fixCycles.length > 0) {
        lines.push(`  {magenta-fg}🔧 Fix Cycles: ${timeline.fixCycles.length}{/magenta-fg}`);
      }
      lines.push('');
    }

    // Task execution summary
    if (timeline.taskExecutions.size > 0) {
      lines.push('{bold}Task Executions:{/bold}');

      for (const [taskId, exec] of timeline.taskExecutions) {
        const duration = this._formatDuration(exec.endTime - exec.startTime);
        const startTime = this._formatTimestamp(exec.startTime);
        const endTime = this._formatTimestamp(exec.endTime);
        const taskIdShort = taskId.substring(0, 25);

        // Status styling
        let statusIcon, statusColor;
        switch (exec.status) {
          case 'completed':
            statusIcon = '✓';
            statusColor = 'green';
            break;
          case 'failed':
            statusIcon = '✗';
            statusColor = 'red';
            break;
          case 'in_progress':
            statusIcon = '●';
            statusColor = 'yellow';
            break;
          default:
            statusIcon = '○';
            statusColor = 'gray';
        }

        // Build task line
        let taskLine = `  {${statusColor}-fg}${statusIcon}{/${statusColor}-fg} `;
        taskLine += `{white-fg}${taskIdShort}{/white-fg}`;

        // Add attempt indicator for retries
        if (exec.attempts > 1) {
          taskLine += ` {yellow-fg}(attempt ${exec.attempts}){/yellow-fg}`;
        }

        lines.push(taskLine);

        // Duration and timing on separate line
        let timingLine = `    {gray-fg}${startTime} → ${endTime} (${duration}){/gray-fg}`;
        lines.push(timingLine);
      }
      lines.push('');
    }

    // Chronological event log
    lines.push('{bold}Event Log:{/bold}');
    lines.push('{gray-fg}(Chronological order, oldest first){/gray-fg}');
    lines.push('');

    let lastPhase = null;
    let lastTimestamp = null;
    const now = Date.now();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLatest = i === entries.length - 1;
      const time = this._formatTimestamp(entry.timestamp);

      // Phase separator with transition marker
      if (entry.phase && entry.phase !== lastPhase) {
        if (lastPhase !== null) {
          // Phase transition marker
          lines.push('');
          lines.push('{cyan-fg}  │{/cyan-fg}');
          lines.push('{cyan-fg}  ▼ Phase Transition{/cyan-fg}');
        }
        const phaseName = PHASE_NAMES[entry.phase] || entry.phase;
        const phaseColor = entry.phase === this.phase ? 'yellow' : 'cyan';
        lines.push('');
        lines.push(`{${phaseColor}-fg}╔═══════════════════════════════════════════════════════{/${phaseColor}-fg}`);
        lines.push(`{${phaseColor}-fg}║ {bold}${phaseName.toUpperCase()}{/bold}{/${phaseColor}-fg}`);
        lines.push(`{${phaseColor}-fg}╚═══════════════════════════════════════════════════════{/${phaseColor}-fg}`);
        lastPhase = entry.phase;
      }

      // Entry formatting with timeline indicator
      const isCurrentPosition = isLatest && this.busy;
      const timelineMarker = isCurrentPosition ? '{yellow-fg}▶{/yellow-fg}' : '{gray-fg}│{/gray-fg}';

      // Format entry based on type
      const formattedLines = this._formatEnhancedTimelineEntry(entry, time, contentWidth, isCurrentPosition);
      for (const line of formattedLines) {
        lines.push(`${timelineMarker} ${line}`);
      }

      lastTimestamp = entry.timestamp;
    }

    // Current position indicator
    if (this.busy) {
      lines.push('');
      lines.push('{yellow-fg}▼ {bold}NOW{/bold} - Processing...{/yellow-fg}');
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
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {yellow-fg}← PROMPT{/yellow-fg}${endHighlight}`);
        const promptPreview = this._truncate(entry.data.content || '', contentWidth - 25);
        if (promptPreview) {
          lines.push(`  {gray-fg}${promptPreview}{/gray-fg}`);
        }
        break;

      case HistoryEntryTypes.RESPONSE:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {green-fg}→ RESPONSE{/green-fg}${endHighlight}`);
        const responsePreview = this._truncate(entry.data.content || '', contentWidth - 25);
        if (responsePreview) {
          lines.push(`  {white-fg}${responsePreview}{/white-fg}`);
        }
        if (entry.data.toolCalls && entry.data.toolCalls.length > 0) {
          lines.push(`  {magenta-fg}⚡ Tools: ${entry.data.toolCalls.map(t => t.name).join(', ')}{/magenta-fg}`);
        }
        break;

      case HistoryEntryTypes.TOOL_CALL:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {magenta-fg}⚡ Tool: ${entry.data.toolName}{/magenta-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.PHASE_CHANGE:
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} {cyan-fg}◆ PHASE TRANSITION: ${entry.data.previousPhase || 'start'} → ${entry.data.newPhase}{/cyan-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.TASK_UPDATE:
        const status = entry.data.status;
        const style = STATUS_STYLES[status] || STATUS_STYLES.pending;

        // Determine if this is a retry or fix cycle
        let indicator = '';
        if (entry.data.attempts && entry.data.attempts > 1) {
          indicator = ` {yellow-fg}⟳ RETRY #${entry.data.attempts}{/yellow-fg}`;
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

        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} ${agentTag} {${eventColor}-fg}○ ${eventType}{/${eventColor}-fg}${endHighlight}`);
        break;

      case HistoryEntryTypes.INTERACTION:
        const fromColor = this._getAgentColor(entry.data.from);
        const toColor = this._getAgentColor(entry.data.to);
        lines.push(`${highlight}{gray-fg}${time}{/gray-fg} {${fromColor}-fg}${entry.data.from}{/${fromColor}-fg} → {${toColor}-fg}${entry.data.to}{/${toColor}-fg}${endHighlight}`);
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
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}                     PROMPT HISTORY                         {/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('');

    // Show search status
    if (this.promptSearchQuery) {
      lines.push(`{yellow-fg}🔍 Search: "${this.promptSearchQuery}" ({bold}${filteredCount}{/bold} of ${totalCount} matches){/yellow-fg}`);
    } else {
      lines.push(`{gray-fg}Total conversations: {bold}${totalCount}{/bold}{/gray-fg}`);
    }

    // Show keyboard shortcuts help
    lines.push('');
    lines.push('{gray-fg}╭─────────────────────────────────────────────────────────────╮{/gray-fg}');
    lines.push('{gray-fg}│ {white-fg}Keyboard:{/white-fg}  {cyan-fg}/{/cyan-fg} Search   {cyan-fg}n/N{/cyan-fg} Next/Prev   {cyan-fg}Enter{/cyan-fg} Expand/Collapse │{/gray-fg}');
    lines.push('{gray-fg}│            {cyan-fg}e{/cyan-fg} Expand All   {cyan-fg}c{/cyan-fg} Collapse All   {cyan-fg}Esc{/cyan-fg} Clear Search   │{/gray-fg}');
    lines.push('{gray-fg}╰─────────────────────────────────────────────────────────────╯{/gray-fg}');
    lines.push('');
  }

  /**
   * Render a single conversation (prompt + response pair)
   */
  _renderConversation(lines, conv, isSelected, isExpanded, contentWidth) {
    const time = this._formatTimestamp(conv.timestamp);
    const agentColor = this._getAgentColor(conv.agentName);
    const expandIcon = isExpanded ? '▼' : '▶';
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
            lines.push(`{green-fg}│{/green-fg}   {magenta-fg}• ${toolDisplay}{/magenta-fg}`);
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
      const promptPreview = this._truncate(conv.prompt?.data?.content || '', 60);
      const responsePreview = conv.response
        ? this._truncate(conv.response.data?.content || '', 40)
        : '{gray-fg}(awaiting response){/gray-fg}';

      lines.push(`  {yellow-fg}←{/yellow-fg} ${this._highlightSearchTerms(promptPreview)}`);
      lines.push(`  {green-fg}→{/green-fg} ${this._highlightSearchTerms(responsePreview)}`);

      // Show tool count if collapsed
      const toolCount = conv.response?.data?.toolCalls?.length || 0;
      if (toolCount > 0) {
        lines.push(`  {magenta-fg}⚡ ${toolCount} tool call${toolCount > 1 ? 's' : ''}{/magenta-fg}`);
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

    // Render header with help
    this._renderTaskGraphHeader(lines, contentWidth);

    if (this.tasks.length === 0) {
      lines.push('');
      lines.push('{gray-fg}No tasks recorded yet...{/gray-fg}');
      lines.push('');
      lines.push('{gray-fg}Tasks will appear here when the planner creates them.{/gray-fg}');
      this.viewContent[ViewTypes.TASKS] = lines;
      return;
    }

    // Calculate graph layout dimensions
    const graphWidth = this.taskGraphShowDetails ? Math.floor(contentWidth * 0.55) : contentWidth - 2;
    const detailWidth = contentWidth - graphWidth - 3;

    // Render the task dependency graph
    this._renderTaskDependencyGraph(lines, taskMap, graphWidth);

    // If showing details, render selected task details
    if (this.taskGraphShowDetails && this.taskGraphFlatList.length > 0) {
      const selectedTask = this.taskGraphFlatList[this.taskGraphSelectedIndex];
      if (selectedTask) {
        this._renderTaskDetails(lines, selectedTask, taskMap, detailWidth, graphWidth);
      }
    }

    // Render summary
    this._renderTaskGraphSummary(lines, contentWidth);

    this.viewContent[ViewTypes.TASKS] = lines;
  }

  /**
   * Build flat list of tasks for navigation
   */
  _buildTaskFlatList(tasks, taskMap) {
    const flatList = [];
    const rootTasks = tasks.filter(t => !t.parentTaskId || !taskMap.has(t.parentTaskId));

    const addTaskAndChildren = (task, depth = 0) => {
      flatList.push({ ...task, depth });
      const subtaskIds = task.subtasks || [];
      for (const subtaskId of subtaskIds) {
        const subtask = taskMap.get(subtaskId);
        if (subtask) {
          addTaskAndChildren(subtask, depth + 1);
        }
      }
    };

    for (const task of rootTasks) {
      addTaskAndChildren(task);
    }

    return flatList;
  }

  /**
   * Render task graph header with help
   */
  _renderTaskGraphHeader(lines, contentWidth) {
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}                   TASK DEPENDENCY GRAPH                     {/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('');

    // Show keyboard shortcuts help
    lines.push('{gray-fg}╭─────────────────────────────────────────────────────────────╮{/gray-fg}');
    lines.push('{gray-fg}│ {white-fg}Keyboard:{/white-fg}  {cyan-fg}j/↓{/cyan-fg} Next   {cyan-fg}k/↑{/cyan-fg} Prev   {cyan-fg}d{/cyan-fg} Toggle Details        │{/gray-fg}');
    lines.push('{gray-fg}╰─────────────────────────────────────────────────────────────╯{/gray-fg}');
    lines.push('');

    // Legend
    lines.push('{bold}Legend:{/bold}');
    lines.push('  {green-fg}+ Completed{/green-fg}  {yellow-fg}* In Progress{/yellow-fg}  {gray-fg}o Pending{/gray-fg}  {red-fg}x Failed{/red-fg}  {magenta-fg}- Blocked{/magenta-fg}');
    lines.push('  {white-fg}Complexity:{/white-fg} {green-fg}[S]{/green-fg} Simple  {yellow-fg}[M]{/yellow-fg} Medium  {red-fg}[C]{/red-fg} Complex');
    lines.push('  {white-fg}Connectors:{/white-fg} {cyan-fg}├──{/cyan-fg} Parent-Child  {magenta-fg}-->{/magenta-fg} Dependency');
    lines.push('');
  }

  /**
   * Render the task dependency graph
   */
  _renderTaskDependencyGraph(lines, taskMap, graphWidth) {
    lines.push('{bold}Task Graph:{/bold}');
    lines.push(`{cyan-fg}${'─'.repeat(Math.min(60, graphWidth))}{/cyan-fg}`);

    // Build index map for dependency resolution
    const taskIndexMap = new Map();
    this.tasks.forEach((task, index) => {
      taskIndexMap.set(task.id, index);
    });

    // Render each task with visual connectors
    for (let i = 0; i < this.taskGraphFlatList.length; i++) {
      const task = this.taskGraphFlatList[i];
      const isSelected = i === this.taskGraphSelectedIndex;
      const depth = task.depth || 0;

      this._renderTaskNode(lines, task, isSelected, depth, graphWidth, taskMap, taskIndexMap, i);
    }

    lines.push('');
  }

  /**
   * Render a single task node in the graph
   */
  _renderTaskNode(lines, task, isSelected, depth, graphWidth, taskMap, taskIndexMap, flatIndex) {
    const isCurrent = task.id === this.currentTaskId;
    const isNext = task.id === this.nextTaskId;

    // Get status style
    let style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
    if (isCurrent) style = STATUS_STYLES.in_progress;
    if (isNext && !isCurrent) style = STATUS_STYLES.next;

    // Build tree connector prefix for parent-child relationships
    let prefix = '';
    if (depth > 0) {
      prefix = '  '.repeat(depth - 1);
      // Check if this is the last sibling at this depth
      const siblings = this._getSiblings(task, taskMap);
      const siblingIndex = siblings.findIndex(s => s.id === task.id);
      const isLastSibling = siblingIndex === siblings.length - 1;
      prefix += isLastSibling ? '{cyan-fg}└──{/cyan-fg}' : '{cyan-fg}├──{/cyan-fg}';
    }

    // Status icon
    const icon = isCurrent ? '●' : (isNext ? '▶' : style.icon);

    // Complexity indicator
    const complexity = task.metadata?.complexity || 'medium';
    let complexityBadge = '';
    switch (complexity) {
      case 'simple':
        complexityBadge = '{green-fg}[S]{/green-fg}';
        break;
      case 'medium':
        complexityBadge = '{yellow-fg}[M]{/yellow-fg}';
        break;
      case 'complex':
        complexityBadge = '{red-fg}[C]{/red-fg}';
        break;
    }

    // Task description (truncated)
    const descMaxWidth = graphWidth - prefix.length - 15;
    const desc = this._truncate(task.description || 'Task', Math.max(20, descMaxWidth));

    // Status suffix
    let statusSuffix = '';
    if (isCurrent) statusSuffix = ' {yellow-fg}[CURRENT]{/yellow-fg}';
    else if (isNext) statusSuffix = ' {cyan-fg}[NEXT]{/cyan-fg}';

    // Selection marker
    const selectMarker = isSelected ? '{inverse}' : '';
    const selectEnd = isSelected ? '{/inverse}' : '';

    // Main task line
    lines.push(`${selectMarker}${prefix}{${style.fg}-fg}${icon}{/${style.fg}-fg} ${complexityBadge} {white-fg}${desc}{/white-fg}${statusSuffix}${selectEnd}`);

    // Show dependency arrows (peer dependencies)
    const dependencies = task.metadata?.dependencies || [];
    if (dependencies.length > 0) {
      const depPrefix = '  '.repeat(depth) + '  ';
      const depTasks = dependencies
        .map(depIdx => this.tasks[depIdx])
        .filter(Boolean)
        .map(t => this._truncate(t.description || t.id, 20));

      if (depTasks.length > 0) {
        lines.push(`${depPrefix}{magenta-fg}└─→ depends on: ${depTasks.join(', ')}{/magenta-fg}`);
      }
    }
  }

  /**
   * Get siblings of a task (other children of same parent)
   */
  _getSiblings(task, taskMap) {
    if (!task.parentTaskId) {
      // Root level tasks
      return this.tasks.filter(t => !t.parentTaskId || !taskMap.has(t.parentTaskId));
    }
    const parent = taskMap.get(task.parentTaskId);
    if (!parent || !parent.subtasks) return [task];
    return parent.subtasks.map(id => taskMap.get(id)).filter(Boolean);
  }

  /**
   * Render task details panel
   */
  _renderTaskDetails(lines, task, taskMap, detailWidth, graphStartX) {
    // Find the line to start inserting details (after header and legend)
    const insertIndex = 12; // After header, help, and legend

    // Build detail content
    const detailLines = [];
    detailLines.push('{bold}Selected Task Details:{/bold}');
    detailLines.push(`{cyan-fg}${'─'.repeat(Math.min(40, detailWidth))}{/cyan-fg}`);
    detailLines.push('');

    // Task ID and Status
    const style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
    detailLines.push(`{white-fg}ID:{/white-fg} {gray-fg}${task.id.substring(0, 25)}{/gray-fg}`);
    detailLines.push(`{white-fg}Status:{/white-fg} {${style.fg}-fg}${task.status}{/${style.fg}-fg}`);

    // Complexity
    const complexity = task.metadata?.complexity || 'medium';
    let complexityColor = 'yellow';
    if (complexity === 'simple') complexityColor = 'green';
    else if (complexity === 'complex') complexityColor = 'red';
    detailLines.push(`{white-fg}Complexity:{/white-fg} {${complexityColor}-fg}${complexity}{/${complexityColor}-fg}`);

    // Description
    detailLines.push('');
    detailLines.push('{white-fg}Description:{/white-fg}');
    const descWrapped = this._wrapText(task.description || 'No description', detailWidth - 2);
    for (const line of descWrapped.slice(0, 5)) {
      detailLines.push(`  {gray-fg}${line}{/gray-fg}`);
    }
    if (descWrapped.length > 5) {
      detailLines.push(`  {gray-fg}... (${descWrapped.length - 5} more lines){/gray-fg}`);
    }

    // Dependencies
    const dependencies = task.metadata?.dependencies || [];
    if (dependencies.length > 0) {
      detailLines.push('');
      detailLines.push('{white-fg}Dependencies:{/white-fg}');
      for (const depIdx of dependencies.slice(0, 5)) {
        const depTask = this.tasks[depIdx];
        if (depTask) {
          const depStyle = STATUS_STYLES[depTask.status] || STATUS_STYLES.pending;
          const depDesc = this._truncate(depTask.description || depTask.id, detailWidth - 8);
          detailLines.push(`  {${depStyle.fg}-fg}${depStyle.icon}{/${depStyle.fg}-fg} ${depDesc}`);
        }
      }
      if (dependencies.length > 5) {
        detailLines.push(`  {gray-fg}... and ${dependencies.length - 5} more{/gray-fg}`);
      }
    }

    // Verification Criteria
    const criteria = task.metadata?.verificationCriteria || [];
    if (criteria.length > 0) {
      detailLines.push('');
      detailLines.push('{white-fg}Verification Criteria:{/white-fg}');
      for (const criterion of criteria.slice(0, 8)) {
        const critText = this._truncate(criterion, detailWidth - 4);
        detailLines.push(`  {cyan-fg}✓{/cyan-fg} ${critText}`);
      }
      if (criteria.length > 8) {
        detailLines.push(`  {gray-fg}... and ${criteria.length - 8} more{/gray-fg}`);
      }
    } else {
      detailLines.push('');
      detailLines.push('{gray-fg}No verification criteria defined{/gray-fg}');
    }

    // Subtasks
    const subtaskIds = task.subtasks || [];
    if (subtaskIds.length > 0) {
      detailLines.push('');
      detailLines.push('{white-fg}Subtasks:{/white-fg}');
      for (const subtaskId of subtaskIds.slice(0, 5)) {
        const subtask = taskMap.get(subtaskId);
        if (subtask) {
          const subStyle = STATUS_STYLES[subtask.status] || STATUS_STYLES.pending;
          const subDesc = this._truncate(subtask.description || subtaskId, detailWidth - 8);
          detailLines.push(`  {${subStyle.fg}-fg}${subStyle.icon}{/${subStyle.fg}-fg} ${subDesc}`);
        }
      }
      if (subtaskIds.length > 5) {
        detailLines.push(`  {gray-fg}... and ${subtaskIds.length - 5} more{/gray-fg}`);
      }
    }

    // Add blank line at end
    detailLines.push('');

    // Append detail lines to main lines
    lines.push('');
    for (const detailLine of detailLines) {
      lines.push(detailLine);
    }
  }

  /**
   * Render task graph summary
   */
  _renderTaskGraphSummary(lines, contentWidth) {
    const completed = this.tasks.filter(t => t.status === 'completed').length;
    const inProgress = this.tasks.filter(t => t.status === 'in_progress').length;
    const failed = this.tasks.filter(t => t.status === 'failed').length;
    const blocked = this.tasks.filter(t => t.status === 'blocked').length;
    const pending = this.tasks.filter(t => t.status === 'pending').length;
    const total = this.tasks.length;

    lines.push(`{cyan-fg}${'─'.repeat(Math.min(60, contentWidth - 2))}{/cyan-fg}`);
    lines.push('{bold}Summary:{/bold}');
    lines.push(`  {white-fg}Total:{/white-fg} ${total}  {green-fg}Completed:{/green-fg} ${completed}  {yellow-fg}In Progress:{/yellow-fg} ${inProgress}  {gray-fg}Pending:{/gray-fg} ${pending}`);
    if (failed > 0 || blocked > 0) {
      lines.push(`  {red-fg}Failed:{/red-fg} ${failed}  {magenta-fg}Blocked:{/magenta-fg} ${blocked}`);
    }

    // Progress bar
    if (total > 0) {
      const progressWidth = Math.min(40, contentWidth - 20);
      const completedWidth = Math.round((completed / total) * progressWidth);
      const inProgressWidth = Math.round((inProgress / total) * progressWidth);
      const failedWidth = Math.round((failed / total) * progressWidth);
      const remainingWidth = progressWidth - completedWidth - inProgressWidth - failedWidth;

      const progressBar =
        '{green-fg}' + '█'.repeat(completedWidth) + '{/green-fg}' +
        '{yellow-fg}' + '█'.repeat(inProgressWidth) + '{/yellow-fg}' +
        '{red-fg}' + '█'.repeat(failedWidth) + '{/red-fg}' +
        '{gray-fg}' + '░'.repeat(Math.max(0, remainingWidth)) + '{/gray-fg}';

      const percentage = Math.round((completed / total) * 100);
      lines.push(`  [${progressBar}] ${percentage}%`);
    }
  }

  /**
   * Render task tree recursively (legacy, kept for left panel)
   */
  _renderTaskTree(tasks, taskMap, lines, contentWidth, depth) {
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const isLast = i === tasks.length - 1;
      const isCurrent = task.id === this.currentTaskId;
      const isNext = task.id === this.nextTaskId;

      let style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
      if (isCurrent) style = STATUS_STYLES.in_progress;
      if (isNext && !isCurrent) style = STATUS_STYLES.next;

      const prefix = depth > 0
        ? '  '.repeat(depth - 1) + (isLast ? `${TREE_CHARS.corner}${TREE_CHARS.horizontal}` : `${TREE_CHARS.branch}${TREE_CHARS.horizontal}`)
        : '';

      const icon = isCurrent ? '●' : (isNext ? '▶' : style.icon);
      const desc = this._truncate(task.description || 'Task', contentWidth - prefix.length - 5);

      let statusSuffix = '';
      if (isCurrent) statusSuffix = ' {yellow-fg}[CURRENT]{/yellow-fg}';
      else if (isNext) statusSuffix = ' {cyan-fg}[NEXT]{/cyan-fg}';

      lines.push(`{${style.fg}-fg}${prefix}${icon} ${desc}{/${style.fg}-fg}${statusSuffix}`);

      // Render subtasks
      const subtaskIds = task.subtasks || [];
      const subtasks = subtaskIds.map(id => taskMap.get(id)).filter(Boolean);
      if (subtasks.length > 0) {
        this._renderTaskTree(subtasks, taskMap, lines, contentWidth, depth + 1);
      }
    }
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

    // Link tool results to their calls
    const linkedEntries = this._linkToolCallsAndResults(filtered);

    // Cache for navigation
    this.commInteractionList = linkedEntries;

    // Ensure selected index is valid
    if (this.commSelectedIndex >= linkedEntries.length) {
      this.commSelectedIndex = Math.max(0, linkedEntries.length - 1);
    }

    // Render header with help and filter status
    this._renderCommHeader(lines, linkedEntries.length, allEntries.length, contentWidth);

    if (linkedEntries.length === 0) {
      lines.push('');
      if (this.commFilterAgent || this.commFilterType) {
        lines.push('{yellow-fg}No messages match current filters{/yellow-fg}');
        lines.push('{gray-fg}Press x to clear filters{/gray-fg}');
      } else {
        lines.push('{gray-fg}No agent communications recorded yet...{/gray-fg}');
        lines.push('');
        lines.push('{gray-fg}Communications will appear here when agents:{/gray-fg}');
        lines.push('{gray-fg}  • Send prompts and receive responses{/gray-fg}');
        lines.push('{gray-fg}  • Make tool calls{/gray-fg}');
        lines.push('{gray-fg}  • Interact with each other{/gray-fg}');
      }
      this.viewContent[ViewTypes.COMMUNICATION] = lines;
      return;
    }

    // Render interaction timeline (newest first)
    const displayOrder = [...linkedEntries].reverse();
    for (let i = 0; i < displayOrder.length; i++) {
      const entry = displayOrder[i];
      const realIndex = linkedEntries.length - 1 - i;
      const isSelected = realIndex === this.commSelectedIndex;
      const isExpanded = this.commExpandedItems.has(entry.sequence);

      this._renderCommEntry(lines, entry, isSelected, isExpanded, contentWidth);
    }

    // Render summary
    this._renderCommSummary(lines, linkedEntries, contentWidth);

    this.viewContent[ViewTypes.COMMUNICATION] = lines;
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
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}                  AGENT COMMUNICATION                        {/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('');

    // Show keyboard shortcuts help
    lines.push('{gray-fg}╭─────────────────────────────────────────────────────────────╮{/gray-fg}');
    lines.push('{gray-fg}│ {white-fg}Keyboard:{/white-fg}  {cyan-fg}j/↓{/cyan-fg} Next  {cyan-fg}k/↑{/cyan-fg} Prev  {cyan-fg}Enter{/cyan-fg} Expand/Collapse    │{/gray-fg}');
    lines.push('{gray-fg}│            {cyan-fg}a{/cyan-fg} Filter Agent  {cyan-fg}t{/cyan-fg} Filter Type  {cyan-fg}x{/cyan-fg} Clear Filters │{/gray-fg}');
    lines.push('{gray-fg}╰─────────────────────────────────────────────────────────────╯{/gray-fg}');
    lines.push('');

    // Show filter status
    const filterParts = [];
    if (this.commFilterAgent) {
      filterParts.push(`{cyan-fg}Agent: ${this.commFilterAgent}{/cyan-fg}`);
    }
    if (this.commFilterType) {
      filterParts.push(`{magenta-fg}Type: ${this.commFilterType}{/magenta-fg}`);
    }

    if (filterParts.length > 0) {
      lines.push(`{yellow-fg}Filters:{/yellow-fg} ${filterParts.join('  ')}  {gray-fg}(${filteredCount} of ${totalCount}){/gray-fg}`);
    } else {
      lines.push(`{gray-fg}Total messages: {bold}${totalCount}{/bold}{/gray-fg}`);
    }
    lines.push('');

    // Legend
    lines.push('{bold}Message Types:{/bold}');
    lines.push('  {yellow-fg}← PROMPT{/yellow-fg}  {green-fg}→ RESPONSE{/green-fg}  {magenta-fg}⚡ TOOL{/magenta-fg}  {cyan-fg}◆ PHASE{/cyan-fg}  {white-fg}⇄ INTERACTION{/white-fg}');
    lines.push('');
  }

  /**
   * Render a single communication entry
   */
  _renderCommEntry(lines, entry, isSelected, isExpanded, contentWidth) {
    const time = this._formatTimestamp(entry.timestamp);
    const expandIcon = isExpanded ? '▼' : '▶';
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
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {yellow-fg}← PROMPT{/yellow-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

    if (isExpanded) {
      const content = entry.data?.content || '(empty)';
      lines.push('{yellow-fg}┌─ Prompt Content ─────────────────────────────────────────{/yellow-fg}');
      const wrapped = this._wrapText(content, contentWidth - 4);
      for (const line of wrapped) {
        lines.push(`{yellow-fg}│{/yellow-fg} {gray-fg}${line}{/gray-fg}`);
      }
      lines.push('{yellow-fg}└──────────────────────────────────────────────────────────{/yellow-fg}');
    } else {
      const preview = this._truncate(entry.data?.content || '', 60);
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
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}→ RESPONSE{/green-fg} {${agentColor}-fg}{bold}${agentName}{/bold}{/${agentColor}-fg}${selectEnd}`);

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
      const preview = this._truncate(entry.data?.content || '', 50);
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
    const hasResult = entry.linkedToolResult ? ' {green-fg}✓{/green-fg}' : ' {yellow-fg}…{/yellow-fg}';

    lines.push('');
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {magenta-fg}⚡ TOOL CALL{/magenta-fg} {${agentColor}-fg}${agentName}{/${agentColor}-fg} → {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${hasResult}${selectEnd}`);

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
        ? this._truncate(JSON.stringify(entry.data.input), 50)
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
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {green-fg}⚡ TOOL RESULT{/green-fg} {magenta-fg}{bold}${toolName}{/bold}{/magenta-fg}${callLink}${selectEnd}`);

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
        ? this._truncate(typeof entry.data.result === 'object' ? JSON.stringify(entry.data.result) : String(entry.data.result), 50)
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
    lines.push(`${selectMarker}{white-fg}${expandIcon}{/white-fg} {gray-fg}${time}{/gray-fg} {white-fg}⇄ ${interactionType.toUpperCase()}{/white-fg} {${fromColor}-fg}{bold}${entry.data?.from}{/bold}{/${fromColor}-fg} → {${toColor}-fg}{bold}${entry.data?.to}{/bold}{/${toColor}-fg}${selectEnd}`);

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
          lines.push(`{white-fg}│{/white-fg}   {magenta-fg}• ${tool.name || 'unknown'}{/magenta-fg}`);
        }
      }
      lines.push('{white-fg}└──────────────────────────────────────────────────────────{/white-fg}');
    } else {
      const preview = this._truncate(entry.data?.content || '', 50);
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
    lines.push(`${selectMarker}{gray-fg}${time}{/gray-fg} {cyan-fg}◆ PHASE{/cyan-fg} {gray-fg}${prevPhase}{/gray-fg} → {cyan-fg}{bold}${newPhase}{/bold}{/cyan-fg}${selectEnd}`);
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
   * Refresh events view content - Enhanced with filtering, categorization, search, and priority levels
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

    // Render header with controls
    this._renderEventLogHeader(lines, allEvents.length, categorizedEvents.length, contentWidth);

    // Render category counts summary
    this._renderEventCategoryCounts(lines, allEvents, contentWidth);

    if (categorizedEvents.length === 0) {
      lines.push('');
      if (this.eventSearchQuery || this.eventCategoryFilters.size > 0 || this.eventPriorityMode !== 'all') {
        lines.push('{yellow-fg}No events match current filters{/yellow-fg}');
        lines.push('{gray-fg}Press x to clear all filters{/gray-fg}');
      } else {
        lines.push('{gray-fg}No events recorded yet...{/gray-fg}');
        lines.push('');
        lines.push('{gray-fg}Events will appear here when:{/gray-fg}');
        lines.push('{gray-fg}  • Workflow phases change{/gray-fg}');
        lines.push('{gray-fg}  • Tasks are created, updated, or completed{/gray-fg}');
        lines.push('{gray-fg}  • Agents perform actions{/gray-fg}');
        lines.push('{gray-fg}  • Errors or warnings occur{/gray-fg}');
      }
      this.viewContent[ViewTypes.EVENTS] = lines;
      return;
    }

    lines.push('');

    // Render events
    for (let i = 0; i < categorizedEvents.length; i++) {
      const event = categorizedEvents[i];
      const isSelected = i === this.eventSelectedIndex;
      const isExpanded = this.eventExpandedItems.has(event.sequence);

      this._renderEventEntry(lines, event, isSelected, isExpanded, contentWidth);
    }

    this.viewContent[ViewTypes.EVENTS] = lines;
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
   * Render event log header with keyboard shortcuts
   */
  _renderEventLogHeader(lines, totalCount, filteredCount, contentWidth) {
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}                      EVENT LOG                              {/cyan-fg}{/bold}');
    lines.push('{bold}{cyan-fg}═══════════════════════════════════════════════════════════{/cyan-fg}{/bold}');
    lines.push('');

    // Keyboard shortcuts help
    lines.push('{gray-fg}╭─────────────────────────────────────────────────────────────╮{/gray-fg}');
    lines.push('{gray-fg}│ {white-fg}Keyboard:{/white-fg}  {cyan-fg}j/↓{/cyan-fg} Next  {cyan-fg}k/↑{/cyan-fg} Prev  {cyan-fg}Enter{/cyan-fg} Expand/Collapse    │{/gray-fg}');
    lines.push('{gray-fg}│            {cyan-fg}/{/cyan-fg} Search  {cyan-fg}f{/cyan-fg} Filter Category  {cyan-fg}p{/cyan-fg} Priority Filter │{/gray-fg}');
    lines.push('{gray-fg}│            {cyan-fg}x{/cyan-fg} Clear All Filters                               │{/gray-fg}');
    lines.push('{gray-fg}╰─────────────────────────────────────────────────────────────╯{/gray-fg}');
    lines.push('');

    // Filter status
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
    } else {
      lines.push(`{gray-fg}Total events: {bold}${totalCount}{/bold}{/gray-fg}`);
    }
    lines.push('');

    // Priority legend
    lines.push('{bold}Priority Levels:{/bold}  {red-fg}❌ ERROR{/red-fg}  {yellow-fg}⚠ WARNING{/yellow-fg}  {white-fg}ℹ INFO{/white-fg}');
  }

  /**
   * Render category counts summary
   */
  _renderEventCategoryCounts(lines, events, contentWidth) {
    const counts = {};
    for (const category of this.eventCategories) {
      counts[category] = 0;
    }

    for (const event of events) {
      const { category } = this._categorizeEvent(event);
      if (counts[category] !== undefined) {
        counts[category]++;
      }
    }

    lines.push('');
    lines.push('{bold}Category Counts:{/bold}');

    const categoryLine = this.eventCategories.map(cat => {
      const icon = this._getEventCategoryIcon(cat);
      const color = this._getEventCategoryColor(cat);
      const isHidden = this.eventCategoryFilters.has(cat);
      const strike = isHidden ? '{strikethrough}' : '';
      const strikeEnd = isHidden ? '{/strikethrough}' : '';
      return `${strike}{${color}-fg}${icon} ${cat}: ${counts[cat]}{/${color}-fg}${strikeEnd}`;
    }).join('  ');

    lines.push(`  ${categoryLine}`);
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

    const expandIcon = isExpanded ? '▼' : '▶';
    const selectMarker = isSelected ? '{inverse}' : '';
    const selectEnd = isSelected ? '{/inverse}' : '';

    // Priority indicator
    let priorityIcon = 'ℹ';
    if (event._priority === 'error') priorityIcon = '❌';
    else if (event._priority === 'warning') priorityIcon = '⚠';

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
   * Truncate text
   */
  _truncate(text, width) {
    if (!text || width <= 0) return '';
    const clean = this._sanitizeText(text);
    if (clean.length <= width) return clean;
    return clean.substring(0, width - 1) + '…';
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
      this._updateTaskPanel();
      if (this.currentView === ViewTypes.TASKS) {
        this._refreshTasksView();
        this._renderCurrentView();
      }
      this.screen.render();
    }
  }

  /**
   * Update the left task panel
   */
  _updateTaskPanel() {
    const lines = [];
    const contentWidth = this._getContentWidth(this.widgets.taskPanel);

    if (this.tasks.length === 0) {
      lines.push('{gray-fg}No tasks{/gray-fg}');
    } else {
      const taskMap = new Map();
      for (const task of this.tasks) {
        taskMap.set(task.id, task);
      }

      const rootTasks = this.tasks.filter(t =>
        !t.parentTaskId || !taskMap.has(t.parentTaskId)
      );

      this._renderTaskTree(rootTasks, taskMap, lines, contentWidth, 0);

      // Summary
      const completed = this.tasks.filter(t => t.status === 'completed').length;
      const total = this.tasks.length;
      lines.push('');
      lines.push(`{gray-fg}${'─'.repeat(Math.min(20, contentWidth - 2))}{/gray-fg}`);
      lines.push(`{white-fg}${completed}/${total}{/white-fg}`);
    }

    this.widgets.taskPanel.setContent(lines.join('\n'));
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
}

export default TerminalUIMultiView;
