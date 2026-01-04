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
import { getHistoryStore } from './workflow-history-store.js';
import {
  STATUS_STYLES,
  PHASE_NAMES,
  SPINNER_FRAMES,
  getContentWidth
} from './terminal-ui-utils.js';
import { TasksView } from './terminal-ui-tasks.js';
import { CommunicationView } from './terminal-ui-communication.js';
import { EventsView } from './terminal-ui-events.js';

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

    // Panel focus state ('left' or 'right')
    this.focusedPanel = 'left';

    // Initialize view components
    this.tasksView = new TasksView(this);
    this.communicationView = new CommunicationView(this);
    this.eventsView = new EventsView(this);
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

    // Hide the terminal cursor to prevent flashing during updates
    this.screen.program.hideCursor();

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

    // Left panel (list view - tasks, prompts, events)
    this.widgets.leftPanel = blessed.box({
      parent: this.screen,
      top: 1,
      left: 0,
      width: '50%',
      bottom: 1,
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
        border: { fg: 'cyan' }
      },
      border: { type: 'line' },
      content: '{gray-fg}Loading...{/gray-fg}'
    });

    // Right panel (details view)
    this.widgets.rightPanel = blessed.box({
      parent: this.screen,
      top: 1,
      left: '50%',
      right: 0,
      bottom: 1,
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
        border: { fg: 'gray' }
      },
      border: { type: 'line' },
      content: '{gray-fg}Select an item{/gray-fg}'
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

    // Build progress bar (root-level tasks only for stable denominator)
    const progress = this._getProgress();
    let progressBar = '';
    if (progress.total > 0) {
      const barWidth = 10;
      const filled = Math.round((progress.percent / 100) * barWidth);
      const empty = barWidth - filled;
      const barColor = progress.percent === 100 ? 'green' : 'cyan';
      progressBar = `{${barColor}-fg}[${'\u2588'.repeat(filled)}${'\u2591'.repeat(empty)}]{/${barColor}-fg} {white-fg}${progress.percent}%{/white-fg}`;
    }

    // Calculate left content and padding for right-aligned progress bar
    const leftContent = `{blue-fg}│{/blue-fg}${spinner}{bold}{cyan-fg}Claude Looper{/cyan-fg}{/bold}{blue-fg}│{/blue-fg}${phaseText}  ${tabs.join('  ')}`;

    // Strip tags to calculate visible length
    const stripTags = (str) => str.replace(/\{[^}]+\}/g, '');
    const leftLen = stripTags(leftContent).length;
    const progressLen = stripTags(progressBar).length;
    const screenWidth = this.widgets.header.width || 80;
    const padding = Math.max(2, screenWidth - leftLen - progressLen - 1);

    // Blue bounded box for title using box-drawing characters
    this.widgets.header.setContent(
      leftContent + ' '.repeat(padding) + progressBar
    );
  }

  /**
   * Render the status bar
   */
  _renderStatusBar() {
    const viewConfig = VIEW_CONFIG[this.currentView];

    // Build context-aware help text
    const focusedName = this.focusedPanel === 'left' ? 'List' : 'Details';
    const scrollAction = this.focusedPanel === 'left' ? 'Navigate' : 'Scroll';

    // Base shortcuts
    let shortcuts = [
      `{white-fg}Tab{/white-fg} Switch Panel`,
      `{white-fg}1/2/3{/white-fg} Views`,
      `{white-fg}j/k{/white-fg} ${scrollAction}`,
      `{white-fg}r{/white-fg} Refresh`,
      `{white-fg}q{/white-fg} Quit`
    ];

    // Add view-specific shortcuts
    if (this.currentView === ViewTypes.COMMUNICATION) {
      shortcuts.splice(3, 0, `{white-fg}a{/white-fg} Agent`, `{white-fg}t{/white-fg} Type`);
    } else if (this.currentView === ViewTypes.EVENTS) {
      shortcuts.splice(3, 0, `{white-fg}f{/white-fg} Filter`, `{white-fg}p{/white-fg} Priority`);
    }

    const helpText = `{gray-fg}${shortcuts.join('  ')}{/gray-fg}`;
    const focusIndicator = `{cyan-fg}[${focusedName}]{/cyan-fg}`;

    // Blue bounded box for footer using box-drawing characters
    this.widgets.statusBar.setContent(
      `{blue-fg}│{/blue-fg}{bold}${viewConfig.description}{/bold}{blue-fg}│{/blue-fg}  ${helpText}  ${focusIndicator}`
    );
  }

  /**
   * Calculate progress based on root-level tasks only.
   * Root tasks are those without a parentTaskId.
   * This keeps the denominator stable even when tasks are replanned into subtasks.
   */
  _getProgress() {
    if (!this.tasks || this.tasks.length === 0) {
      return { percent: 0, completed: 0, total: 0 };
    }

    // Filter to root-level tasks only (no parentTaskId)
    const rootTasks = this.tasks.filter(t => !t.parentTaskId);

    if (rootTasks.length === 0) {
      return { percent: 0, completed: 0, total: 0 };
    }

    const completed = rootTasks.filter(t => t.status === 'completed').length;
    const total = rootTasks.length;
    const percent = Math.round((completed / total) * 100);

    return { percent, completed, total };
  }

  /**
   * Set up keyboard shortcuts
   */
  _setupKeyboardShortcuts() {
    // Quit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
    });

    // Tab to switch focus between left and right panels
    this.screen.key(['tab'], () => {
      this.togglePanelFocus();
    });

    // Ctrl+Tab to cycle views forward
    this.screen.key(['C-tab'], () => {
      const currentIndex = VIEW_ORDER.indexOf(this.currentView);
      const nextIndex = (currentIndex + 1) % VIEW_ORDER.length;
      this._switchToView(VIEW_ORDER[nextIndex]);
    });

    // Number keys 1-3 to switch views directly
    this.screen.key(['1'], () => this._switchToView(ViewTypes.TASKS));
    this.screen.key(['2'], () => this._switchToView(ViewTypes.COMMUNICATION));
    this.screen.key(['3'], () => this._switchToView(ViewTypes.EVENTS));

    // Refresh current view with full screen redraw
    this.screen.key(['r'], () => {
      this._refreshCurrentView();
      this.screen.realloc();
      this.screen.render();
    });

    // j/k or arrow keys for navigation (left panel) or scrolling (right panel)
    this.screen.key(['j', 'down'], () => {
      if (this.focusedPanel === 'left') {
        // Left panel: navigate list items
        if (this.currentView === ViewTypes.TASKS) {
          this.tasksView.navigateDown();
        } else if (this.currentView === ViewTypes.COMMUNICATION) {
          this.communicationView.navigateDown();
        } else if (this.currentView === ViewTypes.EVENTS) {
          this.eventsView.navigateDown();
        }
      } else {
        // Right panel: scroll details using blessed's scroll method
        this.widgets.rightPanel.scroll(1);
        this.screen.render();
      }
    });

    this.screen.key(['k', 'up'], () => {
      if (this.focusedPanel === 'left') {
        // Left panel: navigate list items
        if (this.currentView === ViewTypes.TASKS) {
          this.tasksView.navigateUp();
        } else if (this.currentView === ViewTypes.COMMUNICATION) {
          this.communicationView.navigateUp();
        } else if (this.currentView === ViewTypes.EVENTS) {
          this.eventsView.navigateUp();
        }
      } else {
        // Right panel: scroll details using blessed's scroll method
        this.widgets.rightPanel.scroll(-1);
        this.screen.render();
      }
    });

    // 'd' to toggle details pane (Tasks view)
    this.screen.key(['d'], () => {
      if (this.currentView === ViewTypes.TASKS) {
        this.tasksView.toggleDetails();
      }
    });

    // 'a' to cycle agent filter (Communication view)
    this.screen.key(['a'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this.communicationView.cycleAgentFilter();
      }
    });

    // 't' to cycle type filter (Communication view)
    this.screen.key(['t'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this.communicationView.cycleTypeFilter();
      }
    });

    // 'x' to clear all filters
    this.screen.key(['x'], () => {
      if (this.currentView === ViewTypes.COMMUNICATION) {
        this.communicationView.clearFilters();
      }
      if (this.currentView === ViewTypes.EVENTS) {
        this.eventsView.clearFilters();
      }
    });

    // '/' to start search in Events view
    this.screen.key(['/'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this.eventsView.startSearch();
      }
    });

    // 'f' to cycle through category filters (Events view)
    this.screen.key(['f'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this.eventsView.cycleCategoryFilter();
      }
    });

    // 'p' to filter by priority (Events view)
    this.screen.key(['p'], () => {
      if (this.currentView === ViewTypes.EVENTS) {
        this.eventsView.cyclePriorityFilter();
      }
    });

    // Escape to clear search in Events view
    this.screen.key(['escape'], () => {
      if (this.currentView === ViewTypes.EVENTS && this.eventsView.eventSearchActive) {
        this.eventsView.clearSearch();
        return;
      }
    });

    // Focus on left panel by default
    this.widgets.leftPanel.focus();
  }

  /**
   * Switch to a different view
   */
  _switchToView(viewType) {
    if (!VIEW_CONFIG[viewType]) return;

    // Switch view
    this.currentView = viewType;

    // Reset scroll positions for new view
    this.widgets.leftPanel.childBase = 0;
    this.widgets.leftPanel.childOffset = 0;
    this.widgets.rightPanel.childBase = 0;
    this.widgets.rightPanel.childOffset = 0;

    // Reset focus to left panel
    this.focusedPanel = 'left';
    this._updatePanelFocusStyles();

    // Render the view content
    this._renderCurrentView();

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
    this.viewContent[ViewTypes.TASKS] = this.tasksView.refresh();
    this.viewContent[ViewTypes.COMMUNICATION] = this.communicationView.refresh();
    this.viewContent[ViewTypes.EVENTS] = this.eventsView.refresh();
  }

  /**
   * Refresh only the current view
   */
  _refreshCurrentView() {
    switch (this.currentView) {
      case ViewTypes.TASKS:
        this.viewContent[ViewTypes.TASKS] = this.tasksView.refresh();
        break;
      case ViewTypes.COMMUNICATION:
        this.viewContent[ViewTypes.COMMUNICATION] = this.communicationView.refresh();
        break;
      case ViewTypes.EVENTS:
        this.viewContent[ViewTypes.EVENTS] = this.eventsView.refresh();
        break;
    }
    this._renderCurrentView();
    this._renderStatusBar();
  }

  /**
   * Render the current view content to both panels
   */
  _renderCurrentView() {
    const content = this.viewContent[this.currentView] || { left: [], right: [] };
    const leftPanel = this.widgets.leftPanel;
    const rightPanel = this.widgets.rightPanel;

    // Save scroll positions before setting content
    const savedLeftScroll = leftPanel.childBase || 0;
    const savedRightScroll = rightPanel.childBase || 0;

    // Set content (this resets scroll)
    leftPanel.setContent((content.left || []).join('\n'));
    rightPanel.setContent((content.right || []).join('\n'));

    // Restore scroll positions
    leftPanel.childBase = savedLeftScroll;
    leftPanel.childOffset = 0;
    rightPanel.childBase = savedRightScroll;
    rightPanel.childOffset = 0;
  }

  /**
   * Scroll to ensure a specific line is visible in the left panel
   * @param {number} lineIndex - The line index to scroll into view
   */
  scrollToLine(lineIndex) {
    if (!this.initialized || !this.widgets.leftPanel) return;

    const panel = this.widgets.leftPanel;
    // Get visible height (subtract 2 for top/bottom borders)
    const visibleHeight = (panel.height || 20) - 2;
    const currentScroll = panel.childBase || 0;

    // Calculate if the line is outside the visible area
    if (lineIndex < currentScroll) {
      // Line is above visible area - scroll up
      panel.childBase = lineIndex;
    } else if (lineIndex >= currentScroll + visibleHeight) {
      // Line is below visible area - scroll down
      panel.childBase = lineIndex - visibleHeight + 1;
    }
    // If line is already visible, don't scroll
    panel.childOffset = 0;
  }

  /**
   * Scroll the right panel to a specific line
   * @param {number} lineIndex - The line index to scroll into view
   */
  scrollRightToLine(lineIndex) {
    if (!this.initialized || !this.widgets.rightPanel) return;

    const panel = this.widgets.rightPanel;
    const visibleHeight = (panel.height || 20) - 2;
    const currentScroll = panel.childBase || 0;

    if (lineIndex < currentScroll) {
      panel.childBase = lineIndex;
    } else if (lineIndex >= currentScroll + visibleHeight) {
      panel.childBase = lineIndex - visibleHeight + 1;
    }
    panel.childOffset = 0;
  }

  /**
   * Toggle focus between left and right panels
   */
  togglePanelFocus() {
    this.focusedPanel = this.focusedPanel === 'left' ? 'right' : 'left';

    // Reset details panel scroll to top when switching focus
    this.widgets.rightPanel.scrollTo(0);

    this._updatePanelFocusStyles();
    this._renderStatusBar();
    this.screen.render();
  }

  /**
   * Update panel border styles based on focus
   */
  _updatePanelFocusStyles() {
    const leftPanel = this.widgets.leftPanel;
    const rightPanel = this.widgets.rightPanel;

    if (this.focusedPanel === 'left') {
      leftPanel.style.border.fg = 'cyan';
      leftPanel.style.scrollbar = { bg: 'cyan' };
      rightPanel.style.border.fg = 'gray';
      rightPanel.style.scrollbar = { bg: 'gray' };
      leftPanel.focus();
    } else {
      leftPanel.style.border.fg = 'gray';
      leftPanel.style.scrollbar = { bg: 'gray' };
      rightPanel.style.border.fg = 'cyan';
      rightPanel.style.scrollbar = { bg: 'cyan' };
      rightPanel.focus();
    }
  }

  /**
   * Get the currently focused panel
   */
  getFocusedPanel() {
    return this.focusedPanel === 'left' ? this.widgets.leftPanel : this.widgets.rightPanel;
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
        this.viewContent[ViewTypes.TASKS] = this.tasksView.refresh();
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

    // Note: We no longer record responses/tool calls here during streaming.
    // Recording is now done in recordAgentResult() when execution completes,
    // which receives the properly parsed result and avoids duplicates.

    if (this.initialized && this.currentView === ViewTypes.COMMUNICATION) {
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
   * Record agent execution result (response and tool calls)
   * Called when an agent completes execution
   */
  recordAgentResult(agentName, result) {
    if (!result) return;

    // Record the response - stringify if it's an object
    const responseContent = result.response
      ? (typeof result.response === 'string' ? result.response : JSON.stringify(result.response))
      : null;

    if (responseContent) {
      this.historyStore.addResponse(agentName, responseContent, {
        taskId: this.currentTaskId,
        costUsd: result.costUsd,
        duration: result.duration,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut
      });
    }

    // Record tool calls - they're already extracted from structuredOutput by agent-executor
    const toolCalls = result.toolCalls || [];

    for (const toolCall of toolCalls) {
      if (toolCall.name) {
        this.historyStore.addToolCall(agentName, toolCall.name, toolCall.arguments || toolCall.input || {}, {
          taskId: this.currentTaskId
        });
      }
    }

    // Refresh view if on communication view
    if (this.initialized && this.currentView === ViewTypes.COMMUNICATION) {
      this._refreshCurrentView();
      this.screen.render();
    }
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
    this.screen.program.showCursor();
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
    this.screen.program.showCursor();
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
