/**
 * Terminal UI Tasks View - Task hierarchy and dependency graph display
 */

import {
  STATUS_STYLES,
  truncate,
  wrapText,
  stripTags,
  truncateWithTags,
  getContentWidth
} from './terminal-ui-utils.js';

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
    this.ui._renderCurrentView();
    this.ui.screen.render();
    // Scroll after render to ensure content is laid out
    this.ui.scrollToLine(this.taskGraphSelectedIndex);
    this.ui.screen.render();
  }

  /**
   * Navigate task graph selection down
   */
  navigateDown() {
    if (this.taskGraphFlatList.length === 0) return;
    this.taskGraphSelectedIndex = Math.min(this.taskGraphFlatList.length - 1, this.taskGraphSelectedIndex + 1);
    this.refresh();
    this.ui._renderCurrentView();
    this.ui.screen.render();
    // Scroll after render to ensure content is laid out
    this.ui.scrollToLine(this.taskGraphSelectedIndex);
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
   */
  refresh() {
    const lines = [];
    const contentWidth = getContentWidth(this.ui.widgets.mainPanel);

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
      lines.push('{gray-fg}No tasks recorded yet...{/gray-fg}');
      lines.push('{gray-fg}Tasks will appear here when the planner creates them.{/gray-fg}');
      return lines;
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
      const leftClean = stripTags(leftLine);
      if (leftClean.length > graphWidth - 1) {
        // Need to truncate - find a safe cut point
        leftLine = truncateWithTags(leftLine, graphWidth - 4) + '...';
      }

      const leftLen = stripTags(leftLine).length;
      const padding = Math.max(0, graphWidth - leftLen);
      lines.push(`${leftLine}${' '.repeat(padding)} {gray-fg}|{/gray-fg} ${rightLine}`);
    }

    return lines;
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
    const desc = truncate(task.description || 'Task', descMaxWidth);

    // Use bold for selection (no >> marker)
    const line = `{gray-fg}${prefix}{/gray-fg}{${style.fg}-fg}${icon}{/${style.fg}-fg} {white-fg}${desc}{/white-fg}`;
    lines.push(isSelected ? `{bold}${line}{/bold}` : line);
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
    const descWrapped = wrapText(task.description || 'No description', detailWidth - 2);
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
        const critText = truncate(criterion, detailWidth - 4);
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
          const subDesc = truncate(subtask.description || subtaskId, detailWidth - 6);
          lines.push(`  {${subStyle.fg}-fg}${subStyle.icon}{/${subStyle.fg}-fg} ${subDesc}`);
        }
      }
      if (subtaskIds.length > 3) {
        lines.push(`  {gray-fg}... +${subtaskIds.length - 3} more{/gray-fg}`);
      }
    }
  }
}
