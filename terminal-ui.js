/**
 * Terminal UI - Rich terminal interface for Claude Looper
 *
 * Uses neo-blessed and blessed-contrib for proper panel management:
 * - Header with title and phase
 * - Left panel: Task list with status (scrollable)
 * - Right panel: Current agent activity (scrollable log)
 * - Bottom panel: Event log (scrollable, newest first)
 */

import blessed from 'blessed';
// Note: blessed-contrib is no longer needed - using explicit positioning for alignment

// Status icons and colors (ASCII only for terminal compatibility)
const STATUS_STYLES = {
  pending: { icon: 'o', fg: 'gray' },
  in_progress: { icon: '*', fg: 'yellow' },
  completed: { icon: '+', fg: 'green' },
  failed: { icon: 'x', fg: 'red' },
  blocked: { icon: '-', fg: 'magenta' },
  next: { icon: '>', fg: 'cyan' }  // Special indicator for next task
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
 * Terminal UI class using blessed-contrib
 */
export class TerminalUI {
  constructor() {
    this.initialized = false;
    this.screen = null;
    this.widgets = {};
    this.tasks = [];
    this.eventLines = [];
    this.agentLines = [];
    this.currentAgent = null;
    this.phase = null;
    this.maxEvents = 200;
    this.jsonBuffer = '';  // Buffer for partial JSON chunks
    this.lastEntryTime = null;  // Track time for separators
    // Spinner state
    this.busy = false;
    this.spinnerFrame = 0;
    this.spinnerInterval = null;
  }

  /**
   * Initialize the terminal UI
   */
  async init() {
    if (this.initialized) return;

    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Claude Looper',
      fullUnicode: true,
      autoPadding: false
    });

    // Use explicit positioning instead of grid to avoid rounding misalignment
    // Layout: header (3 rows), main area (tasks 33% + agent 67%), events (25%)

    // Header (top, full width)
    this.widgets.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {bold}{cyan-fg}Claude Looper{/cyan-fg}{/bold}',
      tags: true,
      border: { type: 'line' },
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    // Tasks panel (left side)
    this.widgets.tasks = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '33%',
      height: '75%-3',
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

    // Agent output panel (right side, aligned to right edge)
    this.widgets.agent = blessed.box({
      parent: this.screen,
      top: 3,
      left: '33%',
      right: 0,
      height: '75%-3',
      label: ' Agent Output ',
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
      content: '{gray-fg}Waiting for agent...{/gray-fg}'
    });
    this.agentLines = [];

    // Events panel (bottom, full width)
    this.widgets.events = blessed.box({
      parent: this.screen,
      top: '75%',
      left: 0,
      width: '100%',
      height: '25%',
      label: ' Events ',
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

    // Set up keyboard shortcuts
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
    });

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

    // Focus on events by default
    this.widgets.events.focus();

    this.initialized = true;
    this.screen.render();
  }

  /**
   * Render the header with current state
   */
  _renderHeader() {
    if (!this.initialized) return;

    const phaseName = PHASE_NAMES[this.phase] || this.phase || '';
    const phaseText = phaseName ? `[${phaseName}]` : '';
    const spinner = this.busy
      ? `{magenta-fg}${SPINNER_FRAMES[this.spinnerFrame]}{/magenta-fg} `
      : '';

    // Calculate padding for right-aligned phase text
    // Account for border (2 chars), spinner (2 if present), title, and phase text
    const headerWidth = (this.widgets.header.width || 80) - 2; // subtract borders, fallback to 80
    const spinnerLen = this.busy ? 2 : 0;
    const titleLen = 'Claude Looper'.length + 1; // +1 for leading space
    const phaseLen = phaseText.length;
    const padding = Math.max(1, headerWidth - spinnerLen - titleLen - phaseLen - 1);

    // Ensure we don't overflow - truncate phase if needed
    const availableForPhase = headerWidth - spinnerLen - titleLen - 2;
    const safePhaseText = availableForPhase > 5 ? phaseText : '';

    this.widgets.header.setContent(
      ` ${spinner}{bold}{cyan-fg}Claude Looper{/cyan-fg}{/bold}${' '.repeat(padding)}{yellow-fg}${safePhaseText}{/yellow-fg}`
    );
    this.screen.render();
  }

  /**
   * Update the header with phase information
   */
  setPhase(phase) {
    this.phase = phase;
    this._renderHeader();
  }

  /**
   * Set busy state (shows animated spinner)
   */
  setBusy(busy) {
    if (busy === this.busy) return;

    this.busy = busy;

    if (busy) {
      // Start spinner animation
      this.spinnerFrame = 0;
      this.spinnerInterval = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
        this._renderHeader();
      }, 80);
    } else {
      // Stop spinner animation
      if (this.spinnerInterval) {
        clearInterval(this.spinnerInterval);
        this.spinnerInterval = null;
      }
    }

    this._renderHeader();
  }

  /**
   * Update the tasks list with hierarchical display
   * @param {Array} tasks - Array of task objects
   * @param {Object} options - Display options
   * @param {string} options.currentTaskId - ID of task currently being worked on
   * @param {string} options.nextTaskId - ID of next task to be executed
   */
  updateTasks(tasks, options = {}) {
    this.tasks = tasks || [];
    if (!this.initialized) return;

    const { currentTaskId, nextTaskId } = options;
    const contentWidth = this._getContentWidth(this.widgets.tasks);
    const lines = [];

    // Build task lookup map
    const taskMap = new Map();
    for (const task of this.tasks) {
      taskMap.set(task.id, task);
    }

    // Find root tasks (no parentTaskId or parent not in list)
    const rootTasks = this.tasks.filter(t =>
      !t.parentTaskId || !taskMap.has(t.parentTaskId)
    );

    // Count children for each task to determine tree lines
    const childCounts = new Map();
    for (const task of this.tasks) {
      childCounts.set(task.id, (task.subtasks || []).length);
    }

    // Render task with hierarchy
    const renderTask = (task, depth = 0, isLast = true, ancestorLines = []) => {
      // Determine if this is the current or next task
      const isCurrent = task.id === currentTaskId;
      const isNext = task.id === nextTaskId && !isCurrent;

      // Get appropriate style
      let style;
      if (isCurrent) {
        style = STATUS_STYLES.in_progress;
      } else if (isNext) {
        style = STATUS_STYLES.next;
      } else {
        style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
      }

      // Build tree prefix
      let treePrefix = '';
      if (depth > 0) {
        // Add ancestor continuation lines
        for (let i = 0; i < ancestorLines.length; i++) {
          treePrefix += ancestorLines[i] ? `${TREE_CHARS.vertical} ` : '  ';
        }
        // Add branch or corner
        treePrefix += isLast ? `${TREE_CHARS.corner}${TREE_CHARS.horizontal}` : `${TREE_CHARS.branch}${TREE_CHARS.horizontal}`;
      }

      // Build prefix with icon
      const icon = isCurrent ? '●' : (isNext ? '▶' : style.icon);
      const prefix = `${treePrefix}${icon} `;
      const prefixLen = prefix.length;
      const textWidth = Math.max(10, contentWidth - prefixLen);

      // Format description
      const desc = task.description || 'Task';
      const wrappedLines = this._wrapText(desc, textWidth);

      // Add status suffix for clarity
      let statusSuffix = '';
      if (isCurrent) {
        statusSuffix = ' {yellow-fg}[CURRENT]{/yellow-fg}';
      } else if (isNext) {
        statusSuffix = ' {cyan-fg}[NEXT]{/cyan-fg}';
      }

      for (let i = 0; i < wrappedLines.length; i++) {
        if (i === 0) {
          lines.push(`{${style.fg}-fg}${prefix}${wrappedLines[i]}{/${style.fg}-fg}${statusSuffix}`);
        } else {
          // Continuation lines - maintain tree structure
          let contPrefix = '';
          if (depth > 0) {
            for (let j = 0; j < ancestorLines.length; j++) {
              contPrefix += ancestorLines[j] ? `${TREE_CHARS.vertical} ` : '  ';
            }
            contPrefix += '  '; // Space under branch
          }
          contPrefix += '  '; // Space for icon
          lines.push(`{${style.fg}-fg}${contPrefix}${wrappedLines[i]}{/${style.fg}-fg}`);
        }
      }

      // Render subtasks
      const subtaskIds = task.subtasks || [];
      if (subtaskIds.length > 0) {
        const newAncestorLines = [...ancestorLines, !isLast];
        for (let i = 0; i < subtaskIds.length; i++) {
          const subtask = taskMap.get(subtaskIds[i]);
          if (subtask) {
            const isLastChild = i === subtaskIds.length - 1;
            renderTask(subtask, depth + 1, isLastChild, newAncestorLines);
          }
        }
      }
    };

    // Render all root tasks
    for (let i = 0; i < rootTasks.length; i++) {
      const isLast = i === rootTasks.length - 1;
      renderTask(rootTasks[i], 0, isLast, []);
    }

    // Add summary at bottom
    if (this.tasks.length > 0) {
      const completed = this.tasks.filter(t => t.status === 'completed').length;
      const total = this.tasks.length;
      const pending = this.tasks.filter(t => t.status === 'pending').length;
      const inProgress = this.tasks.filter(t => t.status === 'in_progress').length;

      lines.push('');
      lines.push(`{gray-fg}${'─'.repeat(Math.min(30, contentWidth))}{/gray-fg}`);
      lines.push(`{white-fg}${completed}/${total} complete{/white-fg} {gray-fg}│{/gray-fg} {yellow-fg}${inProgress} active{/yellow-fg} {gray-fg}│{/gray-fg} {gray-fg}${pending} pending{/gray-fg}`);
    }

    this.widgets.tasks.setContent(lines.join('\n'));
    this.screen.render();
  }

  /**
   * Format a timestamp for display
   */
  _formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Add a separator line with timestamp to agent output
   */
  _addAgentSeparator(label) {
    const contentWidth = this._getContentWidth(this.widgets.agent);
    const time = this._formatTime();
    const sepWidth = Math.min(contentWidth, 50); // cap at 50 for aesthetics
    const sep = '─'.repeat(sepWidth);
    this.agentLines.push(`{gray-fg}${sep}{/gray-fg}`);
    // Truncate label if needed
    const maxLabelLen = contentWidth - time.length - 2;
    const safeLabel = this._truncate(label, maxLabelLen);
    this.agentLines.push(`{cyan-fg}${time}{/cyan-fg} {bold}${safeLabel}{/bold}`);
    this.agentLines.push(`{gray-fg}${sep}{/gray-fg}`);
  }

  /**
   * Parse and format Claude Code JSON output
   */
  _formatJsonOutput(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      const entries = [];

      // Handle different JSON structures from Claude Code
      if (data.result) {
        // Final result format
        entries.push({ type: 'result', content: data.result });
      }

      if (data.content) {
        // Message content (could be string or array)
        if (typeof data.content === 'string') {
          entries.push({ type: 'text', content: data.content });
        } else if (Array.isArray(data.content)) {
          for (const block of data.content) {
            if (block.type === 'text') {
              entries.push({ type: 'text', content: block.text });
            } else if (block.type === 'tool_use') {
              entries.push({ type: 'tool', name: block.name, input: block.input });
            } else if (block.type === 'tool_result') {
              entries.push({ type: 'tool_result', content: block.content });
            }
          }
        }
      }

      // Handle streaming events
      if (data.type === 'content_block_delta' && data.delta?.text) {
        entries.push({ type: 'text', content: data.delta.text });
      }

      if (data.type === 'message_start' || data.type === 'message_stop') {
        entries.push({ type: 'event', content: data.type });
      }

      return entries;
    } catch {
      // Not valid JSON, return as plain text
      return [{ type: 'raw', content: jsonStr }];
    }
  }

  /**
   * Add formatted entry to agent panel
   */
  _addAgentEntry(entry) {
    const contentWidth = this._getContentWidth(this.widgets.agent);

    switch (entry.type) {
      case 'text':
        // Sanitize and word wrap text
        const cleanText = this._sanitizeText(entry.content);
        if (cleanText) {
          const lines = this._wrapText(cleanText, contentWidth);
          for (const line of lines) {
            this.agentLines.push(line);
          }
        }
        break;

      case 'tool':
        this._addAgentSeparator(`Tool: ${this._sanitizeText(entry.name)}`);
        if (entry.input) {
          const inputStr = typeof entry.input === 'string'
            ? entry.input
            : JSON.stringify(entry.input, null, 2);
          // Sanitize and show truncated input for readability
          const cleanInput = this._sanitizeText(inputStr);
          const maxLen = contentWidth * 3; // ~3 lines worth
          const preview = cleanInput.length > maxLen
            ? cleanInput.substring(0, maxLen) + '...'
            : cleanInput;
          for (const line of preview.split('\n').slice(0, 8)) {
            this.agentLines.push(`  {gray-fg}${this._truncate(line, contentWidth - 2)}{/gray-fg}`);
          }
        }
        break;

      case 'tool_result':
        const resultStr = typeof entry.content === 'string'
          ? entry.content
          : JSON.stringify(entry.content);
        const cleanResult = this._sanitizeText(resultStr);
        const maxResultLen = contentWidth - 5; // account for "  → " prefix
        const resultPreview = this._truncate(cleanResult, maxResultLen);
        this.agentLines.push(`  {green-fg}→ ${resultPreview}{/green-fg}`);
        break;

      case 'result':
        this._addAgentSeparator('Result');
        const cleanResultText = this._sanitizeText(entry.content);
        if (cleanResultText) {
          const resultLines = this._wrapText(cleanResultText, contentWidth);
          for (const line of resultLines) {
            this.agentLines.push(`{white-fg}${line}{/white-fg}`);
          }
        }
        break;

      case 'event':
        const cleanEvent = this._sanitizeText(entry.content);
        this.agentLines.push(`{gray-fg}[${this._truncate(cleanEvent, contentWidth - 2)}]{/gray-fg}`);
        break;

      case 'raw':
        // Clean up raw output and wrap to fit
        const clean = this._sanitizeText(entry.content).trim();
        if (clean) {
          const wrappedRaw = this._wrapText(clean, contentWidth);
          for (const line of wrappedRaw.slice(0, 10)) { // limit to 10 lines
            this.agentLines.push(line);
          }
        }
        break;
    }
  }

  /**
   * Get the inner content width of a widget (accounting for borders and scrollbar)
   */
  _getContentWidth(widget) {
    const width = widget.width || 80;
    // Subtract: 2 for borders (left+right), 1 for scrollbar
    return Math.max(10, width - 3);
  }

  /**
   * Truncate text to specified width with ellipsis
   */
  _truncate(text, width) {
    if (!text || width <= 0) return '';
    if (text.length <= width) return text;
    return text.substring(0, width - 1) + '…';
  }

  /**
   * Word wrap text to specified width
   */
  _wrapText(text, width) {
    if (!text) return [];
    const lines = [];
    const paragraphs = text.split('\n');

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
   * Sanitize text by removing control characters that can cause garbled output
   */
  _sanitizeText(text) {
    if (!text) return '';
    // Remove control characters except newlines and tabs, and remove ANSI escape sequences
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // Remove ANSI escape sequences
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');  // Remove control chars except \t \n \r
  }

  /**
   * Show the prompt being sent to an agent
   */
  showAgentPrompt(agentName, prompt) {
    if (!this.initialized) return;

    // Update label and reset if agent changed
    if (agentName !== this.currentAgent) {
      this.currentAgent = agentName;
      this.agentLines = [];
      this.jsonBuffer = '';
      this.widgets.agent.setLabel(` Agent: ${agentName} `);
    }

    const contentWidth = this._getContentWidth(this.widgets.agent);

    // Add prompt section
    this._addAgentSeparator(`Prompt → ${agentName}`);

    // Sanitize and display prompt (truncated for readability)
    const cleanPrompt = this._sanitizeText(prompt);
    const maxPromptLines = 15;  // Limit prompt display to avoid overwhelming the panel
    const promptLines = this._wrapText(cleanPrompt, contentWidth);
    const displayLines = promptLines.slice(0, maxPromptLines);

    for (const line of displayLines) {
      this.agentLines.push(`{gray-fg}${line}{/gray-fg}`);
    }

    if (promptLines.length > maxPromptLines) {
      this.agentLines.push(`{gray-fg}  ... (${promptLines.length - maxPromptLines} more lines){/gray-fg}`);
    }

    // Add separator before response
    this.agentLines.push('');
    this._addAgentSeparator('Response');

    this.widgets.agent.setContent(this.agentLines.join('\n'));
    this.widgets.agent.setScrollPerc(100);
    this.screen.render();
  }

  /**
   * Update the agent panel with new output
   */
  updateAgentPanel(agentName, output) {
    if (!this.initialized) return;

    // Update label if agent changed
    if (agentName !== this.currentAgent) {
      this.currentAgent = agentName;
      this.agentLines = [];
      this.jsonBuffer = '';
      this._addAgentSeparator(`Agent: ${agentName}`);
      this.widgets.agent.setLabel(` Agent: ${agentName} `);
    }

    if (output) {
      // Buffer the output and try to parse complete JSON objects
      this.jsonBuffer += output;

      // Try to extract complete JSON objects (line-delimited)
      const lines = this.jsonBuffer.split('\n');
      this.jsonBuffer = lines.pop() || '';  // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const entries = this._formatJsonOutput(trimmed);
        for (const entry of entries) {
          this._addAgentEntry(entry);
        }
      }

      // Keep buffer bounded
      if (this.agentLines.length > 200) {
        this.agentLines = this.agentLines.slice(-200);
      }

      this.widgets.agent.setContent(this.agentLines.join('\n'));
      this.widgets.agent.setScrollPerc(100); // Scroll to bottom
      this.screen.render();
    }
  }

  /**
   * Clear agent output
   */
  clearAgentOutput() {
    if (!this.initialized) return;

    this.agentLines = [];
    this.jsonBuffer = '';
    // Set placeholder content to avoid empty panel rendering issues
    this.widgets.agent.setContent('{gray-fg}Waiting for agent...{/gray-fg}');
    this.widgets.agent.setLabel(' Agent Output ');
    this.currentAgent = null;
    this.screen.render();
  }

  /**
   * Add an event to the log
   */
  addEvent(source, message) {
    if (!this.initialized) return;

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Calculate available width for the log line
    const contentWidth = this._getContentWidth(this.widgets.events);

    const cleanMessage = message.replace(/[\r\n\x00-\x1F\x7F]+/g, ' ').trim();
    const prefix = `${time} [${source}] `;
    const maxMsgLen = Math.max(10, contentWidth - prefix.length);
    const truncatedMsg = this._truncate(cleanMessage, maxMsgLen);
    const logLine = `${prefix}${truncatedMsg}`;

    // Add to beginning (newest first)
    this.eventLines.unshift(logLine);
    if (this.eventLines.length > this.maxEvents) {
      this.eventLines = this.eventLines.slice(0, this.maxEvents);
    }

    this.widgets.events.setContent(this.eventLines.join('\n'));
    this.screen.render();
  }

  /**
   * Add an event from agentCore event object
   */
  addEventFromCore(event) {
    const typeShort = event.type.split(':').pop();
    let message = typeShort;

    if (event.object) {
      if (event.object.description) {
        message = `${typeShort}: ${event.object.description}`;
      } else if (event.object.status) {
        message = `${typeShort} -> ${event.object.status}`;
      } else if (event.object.content) {
        const content = typeof event.object.content === 'string'
          ? event.object.content
          : JSON.stringify(event.object.content);
        message = `${typeShort}: ${content.substring(0, 80)}`;
      }
    }

    this.addEvent(event.source || 'core', message);
  }

  /**
   * Clean up and exit
   */
  destroy() {
    if (!this.initialized) return;

    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.screen.destroy();
    this.initialized = false;
    process.exit(0);
  }

  /**
   * Gracefully shutdown without exiting
   */
  shutdown() {
    if (!this.initialized) return;

    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.screen.destroy();
    this.initialized = false;
  }
}

export default TerminalUI;
