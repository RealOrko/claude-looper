/**
 * Terminal UI Tasks View - Task hierarchy and dependency graph display
 */

import {
  STATUS_STYLES,
  truncate,
  wrapText,
  stripTags,
  truncateWithTags,
  getContentWidth,
  sanitizeForBlessed
} from './terminal-ui-utils.js';

/**
 * Format elapsed time in human-readable format
 * @param {number} ms - Elapsed time in milliseconds
 * @returns {string} Formatted time string (e.g., "0:32", "5:23", "1:23:45")
 */
function formatElapsedTime(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return '0:00';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * TasksView handles the rendering and navigation of the tasks view
 */
export class TasksView {
  constructor(ui) {
    this.ui = ui;

    // Task Graph view state
    this.taskGraphSelectedIndex = 0;
    this.taskGraphShowDetails = true;
    this.taskGraphFlatList = [];
  }

  /**
   * Navigate task graph selection up
   */
  navigateUp() {
    if (this.taskGraphFlatList.length === 0) return;
    this.taskGraphSelectedIndex = Math.max(0, this.taskGraphSelectedIndex - 1);
    this.refresh();
    this.ui.scrollToLine(this.taskGraphSelectedIndex);
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Navigate task graph selection down
   */
  navigateDown() {
    if (this.taskGraphFlatList.length === 0) return;
    this.taskGraphSelectedIndex = Math.min(this.taskGraphFlatList.length - 1, this.taskGraphSelectedIndex + 1);
    this.refresh();
    this.ui.scrollToLine(this.taskGraphSelectedIndex);
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Toggle task graph detail pane
   */
  toggleDetails() {
    this.taskGraphShowDetails = !this.taskGraphShowDetails;
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
  }

  /**
   * Refresh tasks view content - Enhanced Task Dependency Graph
   * Returns { left: [...], right: [...] } for split panel rendering
   */
  refresh() {
    const leftPanel = this.ui.widgets.leftPanel;
    const rightPanel = this.ui.widgets.rightPanel;
    const leftWidth = leftPanel ? (leftPanel.width || 40) - 2 : 40;
    const rightWidth = rightPanel ? (rightPanel.width || 40) - 2 : 40;

    // Build task map and flat list
    const taskMap = new Map();
    for (const task of this.ui.tasks) {
      taskMap.set(task.id, task);
    }

    // Build flat list for navigation (preserving hierarchy order)
    this.taskGraphFlatList = this._buildTaskFlatList(this.ui.tasks, taskMap);

    // Ensure selected index is valid
    if (this.taskGraphSelectedIndex >= this.taskGraphFlatList.length) {
      this.taskGraphSelectedIndex = Math.max(0, this.taskGraphFlatList.length - 1);
    }

    if (this.ui.tasks.length === 0) {
      return {
        left: ['{white-fg}No tasks recorded yet...{/white-fg}', '{white-fg}Tasks will appear here when the planner creates them.{/white-fg}'],
        right: ['{white-fg}Select a task to view details{/white-fg}']
      };
    }

    // Render task tree into left column
    const leftLines = [];
    this._renderTaskTreeView(leftLines, taskMap, leftWidth);

    // Render details into right column
    const rightLines = [];
    if (this.taskGraphFlatList.length > 0) {
      const selectedTask = this.taskGraphFlatList[this.taskGraphSelectedIndex];
      if (selectedTask) {
        this._renderTaskDetailsColumn(rightLines, selectedTask, taskMap, rightWidth);
      }
    }

    return { left: leftLines, right: rightLines };
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
    const isCurrent = task.id === this.ui.currentTaskId;
    const isNext = task.id === this.ui.nextTaskId;

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
    const desc = truncate(sanitizeForBlessed(task.description || 'Task'), descMaxWidth);

    // Use bold for selection (no >> marker)
    const line = `{white-fg}${prefix}{/white-fg}{${style.fg}-fg}${icon}{/${style.fg}-fg} {white-fg}${desc}{/white-fg}`;
    lines.push(isSelected ? `{bold}${line}{/bold}` : line);
  }

  /**
   * Render task details column for side-by-side view
   */
  _renderTaskDetailsColumn(lines, task, taskMap, detailWidth) {
    // Status
    const style = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
    lines.push(`{white-fg}Status:{/white-fg} {${style.fg}-fg}${task.status}{/${style.fg}-fg}`);

    // Elapsed Time - show for in_progress (live) or completed/failed (total duration)
    if (task.status === 'in_progress') {
      const startTime = task.startedAt || task.createdAt;
      if (startTime) {
        const elapsed = Date.now() - startTime;
        lines.push(`{white-fg}Elapsed:{/white-fg} {yellow-fg}${formatElapsedTime(elapsed)}{/yellow-fg}`);
      }
    } else if (task.status === 'completed' || task.status === 'failed') {
      const startTime = task.startedAt || task.createdAt;
      const endTime = task.updatedAt || Date.now();
      if (startTime) {
        const duration = endTime - startTime;
        const durationColor = task.status === 'completed' ? 'green' : 'red';
        lines.push(`{white-fg}Duration:{/white-fg} {${durationColor}-fg}${formatElapsedTime(duration)}{/${durationColor}-fg}`);
      }
    }

    // Retries - show attempts/maxAttempts if task has been attempted
    const attempts = task.attempts || 0;
    const maxAttempts = task.maxAttempts || 3;
    if (attempts > 0) {
      const attemptsColor = attempts >= maxAttempts ? 'red' : (attempts > 1 ? 'yellow' : 'white');
      lines.push(`{white-fg}Retries:{/white-fg} {${attemptsColor}-fg}${attempts}/${maxAttempts}{/${attemptsColor}-fg}`);
    }

    // Replan info - show if task has been replanned
    if (task.metadata?.replanReason) {
      lines.push(`{white-fg}Replanned:{/white-fg} {cyan-fg}yes{/cyan-fg}`);
      const reason = sanitizeForBlessed(task.metadata.replanReason);
      lines.push(`{white-fg}Replan reason:{/white-fg} {white-fg}${truncate(reason, detailWidth - 16)}{/white-fg}`);
    }

    // Complexity
    const complexity = task.metadata?.complexity || 'medium';
    let complexityColor = 'yellow';
    if (complexity === 'simple') complexityColor = 'green';
    else if (complexity === 'complex') complexityColor = 'red';
    lines.push(`{white-fg}Complexity:{/white-fg} {${complexityColor}-fg}${complexity}{/${complexityColor}-fg}`);

    // Description
    lines.push('');
    lines.push('{white-fg}Description:{/white-fg}');
    const descWrapped = wrapText(sanitizeForBlessed(task.description || 'No description'), detailWidth - 2);
    for (const line of descWrapped) {
      lines.push(`  {white-fg}${line}{/white-fg}`);
    }

    // Verification Criteria
    const criteria = task.metadata?.verificationCriteria || [];
    if (criteria.length > 0) {
      lines.push('');
      lines.push('{white-fg}Criteria:{/white-fg}');
      for (const criterion of criteria) {
        const critWrapped = wrapText(sanitizeForBlessed(criterion), detailWidth - 4);
        for (const line of critWrapped) {
          lines.push(`  {cyan-fg}+{/cyan-fg} ${line}`);
        }
      }
    }

    // Subtasks
    const subtaskIds = task.subtasks || [];
    if (subtaskIds.length > 0) {
      lines.push('');
      lines.push('{white-fg}Subtasks:{/white-fg}');
      for (const subtaskId of subtaskIds) {
        const subtask = taskMap.get(subtaskId);
        if (subtask) {
          const subStyle = STATUS_STYLES[subtask.status] || STATUS_STYLES.pending;
          const subtaskDesc = sanitizeForBlessed(subtask.description || subtaskId);
          lines.push(`  {${subStyle.fg}-fg}${subStyle.icon}{/${subStyle.fg}-fg} ${subtaskDesc}`);
        }
      }
    }
  }
}
