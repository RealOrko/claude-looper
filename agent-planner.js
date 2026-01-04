/**
 * Planner Agent - Breaks down goals into actionable tasks
 *
 * This agent:
 * - Accepts goal descriptions
 * - Creates execution plans with tasks
 * - Tracks task completion
 * - Re-plans tasks that fail after 3 attempts
 */

import agentCore, { EventTypes } from './agent-core.js';
import agentExecutor from './agent-executor.js';

// Task status values
const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked'
};

// Maximum attempts before re-planning
const MAX_ATTEMPTS_BEFORE_REPLAN = 3;

// Tool definitions
const PLANNER_TOOLS = [
  {
    name: 'planComplete',
    description: 'Signal plan creation complete',
    params: [
      { name: 'tasks', type: 'array' },
      { name: 'risks', type: 'array' },
      { name: 'assumptions', type: 'array' }
    ]
  },
  {
    name: 'replanComplete',
    description: 'Signal re-planning complete',
    params: [
      { name: 'analysis', type: 'string' },
      { name: 'subtasks', type: 'array' },
      { name: 'blockerResolution', type: 'string' }
    ]
  }
];

/**
 * Planner Agent class
 */
export class PlannerAgent {
  constructor(options = {}) {
    this.name = 'planner';
    this.model = options.model || 'sonnet';
    this.fallbackModel = options.fallbackModel || 'haiku';

    // Current plan state
    this.currentPlan = null;

    // Register with agent core (allowExisting for resume scenarios)
    this.agent = agentCore.registerAgent(this.name, {
      model: this.model,
      subscribesTo: options.subscribesTo || ['supervisor', 'coder', 'tester'],
      tools: PLANNER_TOOLS,
      state: {
        plansCreated: 0,
        replansPerformed: 0,
        tasksTracked: 0,
        successRate: 0
      },
      allowExisting: options.allowExisting || false
    });

    // Set up subscriptions
    this._setupSubscriptions();
  }

  /**
   * Set up event subscriptions
   */
  _setupSubscriptions() {
    const subscribedAgents = this.agent.subscribesTo;

    agentCore.subscribeToAgents(this.name, subscribedAgents, (event) => {
      // React to task completions and failures
      if (event.type === EventTypes.TASK_COMPLETED || event.type === EventTypes.TASK_FAILED) {
        this._handleTaskUpdate(event);
      }
    });
  }

  /**
   * Handle task status updates
   */
  _handleTaskUpdate(event) {
    agentCore.addMemory(this.name, {
      content: `Task update: ${event.object?.description || 'unknown'} - ${event.type}`,
      type: 'task_update',
      metadata: { taskId: event.object?.id, status: event.object?.status }
    });
  }

  /**
   * Create a plan for a goal
   * @param {string} goal - Goal description
   * @param {object} context - Additional context
   */
  async createPlan(goal, context = {}) {
    // Set the goal for the planner
    const goalObj = agentCore.setGoal(this.name, {
      description: goal,
      metadata: { context }
    });

    const templateContext = {
      goal,
      context: context.description,
      constraints: context.constraints
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'planComplete' },
            arguments: {
              type: 'object',
              properties: {
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      description: { type: 'string' },
                      complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] },
                      dependencies: { type: 'array', items: { type: 'number' } },
                      verificationCriteria: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['description', 'complexity']
                  },
                  minItems: 2,
                  maxItems: 15
                },
                risks: { type: 'array', items: { type: 'string' } },
                assumptions: { type: 'array', items: { type: 'string' } }
              },
              required: ['tasks']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'planner/plan.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema,
        goalId: goalObj.id
      }
    );

    const plan = this._parsePlanResult(result);

    // Reset all sessions - new plan means fresh context for all agents
    agentExecutor.resetAllSessions();

    // Create tasks in agent core
    const tasks = [];
    for (const taskDef of plan.tasks || []) {
      const task = agentCore.addTask(this.name, {
        description: taskDef.description,
        parentGoalId: goalObj.id,
        metadata: {
          complexity: taskDef.complexity,
          dependencies: taskDef.dependencies,
          verificationCriteria: taskDef.verificationCriteria
        }
      });
      tasks.push(task);
    }

    // Update state
    agentCore.updateAgentState(this.name, {
      plansCreated: this.agent.state.plansCreated + 1,
      tasksTracked: this.agent.state.tasksTracked + tasks.length
    });

    // Store current plan
    this.currentPlan = {
      goalId: goalObj.id,
      goal,
      tasks,
      risks: plan.risks || [],
      assumptions: plan.assumptions || [],
      createdAt: Date.now()
    };

    // Record the output
    agentCore.recordOutput(this.name, {
      content: this.currentPlan,
      type: 'plan',
      metadata: { goalId: goalObj.id, taskCount: tasks.length }
    });

    return this.currentPlan;
  }

  /**
   * Re-plan a failed task
   * @param {object} task - The failed task
   * @param {string} failureReason - Why it failed
   * @param {object[]} previousAttempts - Previous attempt details
   */
  async replan(task, failureReason, previousAttempts = []) {
    const goal = this.currentPlan?.goal || 'Unknown goal';

    // Get similar failures from other tasks for cross-task learning
    const similarFailures = agentCore.getSimilarFailures(failureReason, 3);

    const templateContext = {
      goal,
      task,
      failureReason,
      attempts: task.attempts || previousAttempts.length,
      previousAttempts,
      similarFailures
    };

    const jsonSchema = {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: { type: 'string', const: 'replanComplete' },
            arguments: {
              type: 'object',
              properties: {
                analysis: { type: 'string' },
                subtasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      description: { type: 'string' },
                      complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] },
                      verificationCriteria: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['description', 'complexity']
                  },
                  minItems: 2,
                  maxItems: 15
                },
                blockerResolution: { type: 'string' }
              },
              required: ['analysis', 'subtasks']
            }
          },
          required: ['name', 'arguments']
        }
      },
      required: ['toolCall']
    };

    const result = await agentExecutor.executeWithTemplate(
      this.name,
      'planner/replan.hbs',
      templateContext,
      {
        model: this.model,
        fallbackModel: this.fallbackModel,
        jsonSchema,
        taskId: task.id,
        goalId: task.parentGoalId || null
      }
    );

    const replan = this._parseReplanResult(result);

    // Reset all sessions - replan means fresh context for all agents
    agentExecutor.resetAllSessions();

    // Create subtasks
    const subtasks = [];
    for (const subtaskDef of replan.subtasks || []) {
      const subtask = agentCore.addSubtask(this.name, task.id, {
        description: subtaskDef.description,
        metadata: {
          complexity: subtaskDef.complexity,
          verificationCriteria: subtaskDef.verificationCriteria,
          parentTaskDescription: task.description
        }
      });
      subtasks.push(subtask);
    }

    // Update the original task status
    agentCore.updateTask(this.name, task.id, {
      status: TASK_STATUS.BLOCKED,
      metadata: {
        ...task.metadata,
        replanReason: failureReason,
        replanAnalysis: replan.analysis
      }
    });

    // Update state
    agentCore.updateAgentState(this.name, {
      replansPerformed: this.agent.state.replansPerformed + 1,
      tasksTracked: this.agent.state.tasksTracked + subtasks.length
    });

    // Record the output
    agentCore.recordOutput(this.name, {
      content: { ...replan, subtasks },
      type: 'replan',
      metadata: { originalTaskId: task.id, subtaskCount: subtasks.length }
    });

    return { ...replan, subtasks };
  }

  /**
   * Mark a task as complete
   * @param {string} taskId - Task ID
   * @param {object} result - Completion result
   */
  markTaskComplete(taskId, result = {}) {
    const existingTask = this.agent.tasks.find(t => t.id === taskId);
    const task = agentCore.updateTask(this.name, taskId, {
      status: TASK_STATUS.COMPLETED,
      metadata: { ...existingTask?.metadata, ...result }
    });

    this._updateSuccessRate();

    // Check if parent task should be completed (all subtasks done)
    if (task?.parentTaskId) {
      this._checkAndCompleteParent(task.parentTaskId);
    }

    return task;
  }

  /**
   * Check if a parent task should be completed when all its subtasks are done
   * @param {string} parentTaskId - Parent task ID
   */
  _checkAndCompleteParent(parentTaskId) {
    const parentTask = this.agent.tasks.find(t => t.id === parentTaskId);
    if (!parentTask || !parentTask.subtasks || parentTask.subtasks.length === 0) {
      return;
    }

    // Check if all subtasks are completed
    const allSubtasksComplete = parentTask.subtasks.every(subId => {
      const subtask = this.agent.tasks.find(t => t.id === subId);
      return subtask && subtask.status === TASK_STATUS.COMPLETED;
    });

    if (allSubtasksComplete && parentTask.status === TASK_STATUS.BLOCKED) {
      agentCore.updateTask(this.name, parentTaskId, {
        status: TASK_STATUS.COMPLETED,
        metadata: {
          ...parentTask.metadata,
          completedAt: Date.now(),
          completedViaSubtasks: true
        }
      });

      // Recursively check if this parent also has a parent
      if (parentTask.parentTaskId) {
        this._checkAndCompleteParent(parentTask.parentTaskId);
      }
    }
  }

  /**
   * Mark a task as failed
   * @param {string} taskId - Task ID
   * @param {string} reason - Failure reason
   */
  markTaskFailed(taskId, reason) {
    const task = this.agent.tasks.find(t => t.id === taskId);

    if (task && task.attempts >= MAX_ATTEMPTS_BEFORE_REPLAN) {
      // Trigger re-planning
      return {
        task: agentCore.updateTask(this.name, taskId, {
          status: TASK_STATUS.FAILED,
          metadata: { ...task.metadata, failureReason: reason }
        }),
        needsReplan: true
      };
    }

    return {
      task: agentCore.updateTask(this.name, taskId, {
        status: TASK_STATUS.FAILED,
        metadata: { ...task.metadata, failureReason: reason }
      }),
      needsReplan: false
    };
  }

  /**
   * Get the currently executing task (in_progress status)
   */
  getCurrentTask() {
    if (!this.currentPlan) return null;

    return this.agent.tasks.find(t =>
      t.status === TASK_STATUS.IN_PROGRESS &&
      t.parentGoalId === this.currentPlan.goalId
    ) || null;
  }

  /**
   * Get the next pending task (respects hierarchy - subtasks before siblings)
   */
  getNextTask() {
    if (!this.currentPlan) return null;

    const goalTasks = this.agent.tasks.filter(t => t.parentGoalId === this.currentPlan.goalId);

    // Build a map of task ID to task
    const taskMap = new Map();
    for (const t of goalTasks) {
      taskMap.set(t.id, t);
    }

    // Find root tasks (no parent or parent not in this goal)
    const roots = goalTasks.filter(t => !t.parentTaskId || !taskMap.has(t.parentTaskId));

    // Recursively find first pending task (depth-first)
    const findPending = (task) => {
      // If this task is pending, return it
      if (task.status === TASK_STATUS.PENDING) {
        return task;
      }
      // If blocked/in_progress with subtasks, check subtasks first
      if (task.subtasks && task.subtasks.length > 0) {
        for (const subId of task.subtasks) {
          const sub = taskMap.get(subId);
          if (sub) {
            const found = findPending(sub);
            if (found) return found;
          }
        }
      }
      return null;
    };

    // Check each root task in order
    for (const root of roots) {
      const found = findPending(root);
      if (found) return found;
    }

    return null;
  }

  /**
   * Get task execution state for UI display
   * @returns {Object} Object with currentTaskId and nextTaskId
   */
  getTaskExecutionState() {
    const current = this.getCurrentTask();
    const next = this.getNextTask();
    return {
      currentTaskId: current?.id || null,
      nextTaskId: next?.id || null
    };
  }

  /**
   * Get plan status summary
   */
  getPlanStatus() {
    if (!this.currentPlan) {
      return { hasActivePlan: false };
    }

    const tasks = this.agent.tasks.filter(t => t.parentGoalId === this.currentPlan.goalId);

    return {
      hasActivePlan: true,
      goal: this.currentPlan.goal,
      totalTasks: tasks.length,
      pending: tasks.filter(t => t.status === TASK_STATUS.PENDING).length,
      inProgress: tasks.filter(t => t.status === TASK_STATUS.IN_PROGRESS).length,
      completed: tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length,
      failed: tasks.filter(t => t.status === TASK_STATUS.FAILED).length,
      blocked: tasks.filter(t => t.status === TASK_STATUS.BLOCKED).length,
      percentComplete: tasks.length > 0
        ? Math.round(tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length / tasks.length * 100)
        : 0
    };
  }

  /**
   * Parse plan result from structured output
   */
  _parsePlanResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'planComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    // Fallback: attempt to parse from response
    return this._parseTextPlan(result.response);
  }

  /**
   * Parse replan result from structured output
   */
  _parseReplanResult(result) {
    if (result.structuredOutput?.toolCall?.arguments) {
      return result.structuredOutput.toolCall.arguments;
    }

    if (result.toolCalls?.length > 0) {
      const toolCall = result.toolCalls.find(tc => tc.name === 'replanComplete');
      if (toolCall) {
        return toolCall.arguments;
      }
    }

    return {
      analysis: 'Unable to parse replan response',
      subtasks: [],
      blockerResolution: 'Unknown'
    };
  }

  /**
   * Fallback text parsing for plans
   */
  _parseTextPlan(response) {
    // Try to extract tasks from numbered list
    const taskMatches = response.match(/\d+\.\s+(.+?)(?=\n\d+\.|\n\n|$)/g) || [];

    const tasks = taskMatches.slice(0, 15).map(match => {
      const desc = match.replace(/^\d+\.\s+/, '').trim();
      // Try to extract complexity
      const complexityMatch = desc.match(/\|\s*(simple|medium|complex)/i);
      return {
        description: desc.replace(/\|.+$/, '').trim(),
        complexity: complexityMatch ? complexityMatch[1].toLowerCase() : 'medium',
        dependencies: [],
        verificationCriteria: []
      };
    });

    return {
      tasks: tasks.length > 0 ? tasks : [{ description: 'Execute goal', complexity: 'complex' }],
      risks: [],
      assumptions: []
    };
  }

  /**
   * Update success rate statistic
   */
  _updateSuccessRate() {
    const tasks = this.agent.tasks;
    const completed = tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length;
    const failed = tasks.filter(t => t.status === TASK_STATUS.FAILED).length;
    const total = completed + failed;

    if (total > 0) {
      agentCore.updateAgentState(this.name, {
        successRate: Math.round(completed / total * 100)
      });
    }
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      name: this.name,
      ...this.agent.state,
      currentPlan: this.getPlanStatus()
    };
  }
}

export default PlannerAgent;
export {
  TASK_STATUS,
  MAX_ATTEMPTS_BEFORE_REPLAN
};
