/**
 * Agent Core - Singleton for multi-agent state management and event coordination
 *
 * This module provides:
 * - Agent registration with custom state
 * - Event-driven state changes
 * - Snapshotting and resume capabilities
 * - Workflow subscription management
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

/**
 * Event types emitted by AgentCore for state changes.
 * Subscribe to these events using agentCore.on(EventTypes.EVENT_NAME, handler).
 * All events are also emitted on the '*' wildcard channel.
 *
 * @constant {Object.<string, string>}
 * @property {string} AGENT_REGISTERED - Emitted when a new agent is registered
 * @property {string} STATE_CHANGED - Emitted when an agent's custom state is updated
 * @property {string} GOAL_SET - Emitted when a goal is set for an agent
 * @property {string} GOAL_UPDATED - Emitted when a goal is updated (not completed)
 * @property {string} GOAL_COMPLETED - Emitted when a goal is marked as completed
 * @property {string} TASK_ADDED - Emitted when a new task is added
 * @property {string} TASK_UPDATED - Emitted when a task is updated
 * @property {string} TASK_COMPLETED - Emitted when a task is marked as completed
 * @property {string} TASK_FAILED - Emitted when a task is marked as failed
 * @property {string} MEMORY_UPDATED - Emitted when memory is added to an agent
 * @property {string} OUTPUT_RECORDED - Emitted when an output is recorded
 * @property {string} INTERACTION_LOGGED - Emitted when an agent interaction is logged
 * @property {string} SNAPSHOT_SAVED - Emitted when state is saved to disk
 * @property {string} SNAPSHOT_LOADED - Emitted when state is loaded from disk
 * @property {string} WORKFLOW_STARTED - Emitted when a workflow begins
 * @property {string} WORKFLOW_COMPLETED - Emitted when a workflow completes
 */
export const EventTypes = {
  AGENT_REGISTERED: 'agent:registered',
  STATE_CHANGED: 'state:changed',
  GOAL_SET: 'goal:set',
  GOAL_UPDATED: 'goal:updated',
  GOAL_COMPLETED: 'goal:completed',
  TASK_ADDED: 'task:added',
  TASK_UPDATED: 'task:updated',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  PLAN_SUPERSEDED: 'plan:superseded',
  MEMORY_UPDATED: 'memory:updated',
  OUTPUT_RECORDED: 'output:recorded',
  INTERACTION_LOGGED: 'interaction:logged',
  INVOCATION_RECORDED: 'invocation:recorded',
  SNAPSHOT_SAVED: 'snapshot:saved',
  SNAPSHOT_LOADED: 'snapshot:loaded',
  WORKFLOW_STARTED: 'workflow:started',
  WORKFLOW_COMPLETED: 'workflow:completed'
};

/**
 * Change types for state modifications included in event payloads.
 *
 * @constant {Object.<string, string>}
 * @property {string} ADDED - A new entity was added
 * @property {string} MODIFIED - An existing entity was modified
 * @property {string} REMOVED - An entity was removed
 */
export const ChangeTypes = {
  ADDED: 'added',
  MODIFIED: 'modified',
  REMOVED: 'removed'
};

/**
 * Agent Core Singleton Class - Central hub for multi-agent state management.
 *
 * AgentCore extends EventEmitter to provide event-driven coordination between agents.
 * It manages agent registration, state, goals, tasks, and workflow persistence.
 *
 * @extends EventEmitter
 *
 * @example
 * // Import the singleton instance
 * import agentCore, { EventTypes } from './agent-core.js';
 *
 * // Register an agent
 * const agent = agentCore.registerAgent('planner', { model: 'sonnet' });
 *
 * // Subscribe to events
 * agentCore.on(EventTypes.TASK_COMPLETED, (event) => {
 *   console.log(`Task completed by ${event.source}`);
 * });
 *
 * // Subscribe to all events with wildcard
 * agentCore.on('*', (event) => {
 *   console.log(`Event: ${event.type}`);
 * });
 *
 * @fires AgentCore#agent:registered
 * @fires AgentCore#state:changed
 * @fires AgentCore#goal:set
 * @fires AgentCore#goal:updated
 * @fires AgentCore#goal:completed
 * @fires AgentCore#task:added
 * @fires AgentCore#task:updated
 * @fires AgentCore#task:completed
 * @fires AgentCore#task:failed
 * @fires AgentCore#memory:updated
 * @fires AgentCore#output:recorded
 * @fires AgentCore#interaction:logged
 * @fires AgentCore#snapshot:saved
 * @fires AgentCore#snapshot:loaded
 * @fires AgentCore#workflow:started
 * @fires AgentCore#workflow:completed
 */
class AgentCore extends EventEmitter {
  /**
   * Creates a new AgentCore instance.
   * Note: Use the exported singleton `agentCore` instead of instantiating directly.
   */
  constructor() {
    super();

    /**
     * Map of registered agents by name.
     * @type {Object.<string, Agent>}
     */
    this.agents = {};

    /**
     * Current workflow state.
     * @type {{active: boolean, name: string|null, goal: string|null, startTime: number|null, configuration: Object|null}}
     */
    this.workflow = {
      active: false,
      name: null,
      goal: null,
      startTime: null,
      configuration: null
    };

    /**
     * Event log for debugging and replay.
     * @type {Array<Object>}
     */
    this.eventLog = [];

    /**
     * Invocations log - records every Claude CLI invocation with full details.
     * This is the rich graph of all prompts, responses, tool calls, and token usage.
     * @type {Array<Object>}
     */
    this.invocations = [];

    /**
     * Maximum number of events to keep in the log.
     * @type {number}
     */
    this.maxEventLogSize = 500;

    /**
     * Maximum number of invocations to keep (0 = unlimited).
     * Invocations are crucial for debugging so we keep more than events.
     * @type {number}
     */
    this.maxInvocationsSize = 0;

    /**
     * Directory name for state files (relative to cwd).
     * @type {string}
     */
    this.stateDir = '.claude-looper';

    /**
     * State snapshot filename.
     * @type {string}
     */
    this.stateFile = 'state.json';

    /**
     * Configuration filename.
     * @type {string}
     */
    this.configFile = 'configuration.json';

    // Increase listener limit for many agent subscriptions
    this.setMaxListeners(100);

    /**
     * Failure patterns learned during this session.
     * Used to provide context when replanning similar tasks.
     * @type {Array<Object>}
     */
    this.failurePatterns = [];
  }

  /**
   * Record a failure pattern for cross-task learning.
   *
   * @param {string} taskDescription - Description of the failed task
   * @param {string} failurePattern - Pattern/type of failure
   * @param {string} resolution - How it was resolved (if known)
   * @param {Object} [metadata={}] - Additional metadata
   * @returns {Object} The recorded pattern
   */
  recordFailurePattern(taskDescription, failurePattern, resolution = 'pending', metadata = {}) {
    const pattern = {
      id: `fp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskDescription,
      failurePattern,
      resolution,
      timestamp: Date.now(),
      metadata
    };

    this.failurePatterns.push(pattern);

    // Keep bounded to prevent memory growth
    if (this.failurePatterns.length > 50) {
      this.failurePatterns = this.failurePatterns.slice(-50);
    }

    return pattern;
  }

  /**
   * Get similar failure patterns for a given failure reason.
   * Matches on keywords in the failure pattern.
   *
   * @param {string} failureReason - The current failure reason to match against
   * @param {number} [limit=3] - Maximum patterns to return
   * @returns {Array<Object>} Matching failure patterns
   */
  getSimilarFailures(failureReason, limit = 3) {
    if (!failureReason || this.failurePatterns.length === 0) {
      return [];
    }

    // Extract keywords from failure reason
    const keywords = failureReason.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);

    // Score patterns by keyword matches
    const scored = this.failurePatterns.map(pattern => {
      const patternText = (pattern.failurePattern + ' ' + pattern.taskDescription).toLowerCase();
      const matches = keywords.filter(kw => patternText.includes(kw)).length;
      return { pattern, score: matches };
    });

    // Return top matches with score > 0
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.pattern);
  }

  /**
   * Get the full path to the state directory.
   * @returns {string} Absolute path to .claude-looper directory
   */
  getStateDir() {
    return path.join(process.cwd(), this.stateDir);
  }

  /**
   * Get the full path to the state file.
   * @returns {string} Absolute path to state.json
   */
  getStatePath() {
    return path.join(this.getStateDir(), this.stateFile);
  }

  /**
   * Get the full path to the configuration file.
   * @returns {string} Absolute path to configuration.json
   */
  getConfigPath() {
    return path.join(this.getStateDir(), this.configFile);
  }

  /**
   * Register a new agent with the core, or get existing if already registered.
   * Emits 'agent:registered' event on successful registration.
   *
   * @param {string} name - Unique agent name (e.g., 'planner', 'coder')
   * @param {Object} [options={}] - Agent configuration options
   * @param {string} [options.model='sonnet'] - Claude model to use ('opus', 'sonnet', 'haiku')
   * @param {Object} [options.state={}] - Initial custom state for the agent
   * @param {string[]} [options.subscribesTo=[]] - Names of agents to subscribe to events from
   * @param {Object[]} [options.tools=[]] - Tool definitions available to this agent
   * @param {boolean} [options.allowExisting=false] - If true, return existing agent instead of throwing
   * @returns {Object} The registered agent object
   * @throws {Error} If agent already exists and allowExisting is false
   *
   * @example
   * const planner = agentCore.registerAgent('planner', {
   *   model: 'sonnet',
   *   subscribesTo: ['supervisor', 'coder'],
   *   state: { plansCreated: 0 }
   * });
   */
  registerAgent(name, options = {}) {
    if (this.agents[name]) {
      if (options.allowExisting) {
        // Return existing agent for resume scenarios
        return this.agents[name];
      }
      throw new Error(`Agent '${name}' is already registered`);
    }

    const agent = {
      name,
      model: options.model || 'sonnet',
      state: options.state || {},
      subscribesTo: options.subscribesTo || [],
      tools: options.tools || [],
      memory: [],
      goals: [],
      tasks: [],
      outputs: [],
      interactions: [],
      registeredAt: Date.now(),
      lastActivity: Date.now()
    };

    this.agents[name] = agent;

    this._emitEvent(EventTypes.AGENT_REGISTERED, {
      source: name,
      changeType: ChangeTypes.ADDED,
      object: agent,
      agentState: agent
    });

    return agent;
  }

  /**
   * Get an agent by name.
   * @param {string} name - Agent name to look up
   * @returns {Object|null} The agent object or null if not found
   */
  getAgent(name) {
    return this.agents[name] || null;
  }

  /**
   * Get an agent's custom state object.
   * @param {string} name - Agent name
   * @returns {Object|null} The agent's state object or null if agent not found
   */
  getAgentState(name) {
    const agent = this.agents[name];
    return agent ? agent.state : null;
  }

  /**
   * Update an agent's custom state by merging in new values.
   * Emits 'state:changed' event with old and new state.
   *
   * @param {string} name - Agent name
   * @param {Object} updates - State updates to merge into existing state
   * @returns {Object} The updated state object
   * @throws {Error} If agent is not found
   */
  updateAgentState(name, updates) {
    const agent = this.agents[name];
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    const oldState = { ...agent.state };
    agent.state = { ...agent.state, ...updates };
    agent.lastActivity = Date.now();

    this._emitEvent(EventTypes.STATE_CHANGED, {
      source: name,
      changeType: ChangeTypes.MODIFIED,
      object: { oldState, newState: agent.state, updates },
      agentState: agent
    });

    return agent.state;
  }

  /**
   * Set a goal for an agent.
   * Emits 'goal:set' event.
   *
   * @param {string} agentName - Agent name
   * @param {Object|string} goal - Goal object with description and metadata, or just a description string
   * @param {string} [goal.description] - Goal description
   * @param {Object} [goal.metadata] - Additional metadata
   * @returns {Object} The created goal object with id, status, timestamps
   * @throws {Error} If agent is not found
   */
  setGoal(agentName, goal) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const goalObj = {
      id: `goal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      description: goal.description || goal,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: goal.metadata || {}
    };

    agent.goals.push(goalObj);
    agent.lastActivity = Date.now();

    this._emitEvent(EventTypes.GOAL_SET, {
      source: agentName,
      changeType: ChangeTypes.ADDED,
      object: goalObj,
      agentState: agent
    });

    return goalObj;
  }

  /**
   * Update a goal's status or properties.
   * Emits 'goal:completed' if status is set to 'completed', otherwise 'goal:updated'.
   *
   * @param {string} agentName - Agent name
   * @param {string} goalId - Goal ID (e.g., 'goal-1234567890-abc123')
   * @param {Object} updates - Updates to apply to the goal
   * @param {string} [updates.status] - New status ('active', 'completed', 'failed')
   * @returns {Object} The updated goal object
   * @throws {Error} If agent or goal is not found
   */
  updateGoal(agentName, goalId, updates) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const goal = agent.goals.find(g => g.id === goalId);
    if (!goal) {
      throw new Error(`Goal '${goalId}' not found for agent '${agentName}'`);
    }

    Object.assign(goal, updates, { updatedAt: Date.now() });
    agent.lastActivity = Date.now();

    const eventType = updates.status === 'completed'
      ? EventTypes.GOAL_COMPLETED
      : EventTypes.GOAL_UPDATED;

    this._emitEvent(eventType, {
      source: agentName,
      changeType: ChangeTypes.MODIFIED,
      object: goal,
      agentState: agent
    });

    return goal;
  }

  /**
   * Add a task for an agent.
   * Emits 'task:added' event.
   *
   * @param {string} agentName - Agent name
   * @param {Object|string} task - Task object or description string
   * @param {string} [task.description] - Task description
   * @param {number} [task.maxAttempts=3] - Maximum retry attempts
   * @param {string} [task.parentGoalId] - ID of parent goal
   * @param {string} [task.parentTaskId] - ID of parent task (for subtasks)
   * @param {Object} [task.metadata] - Additional metadata
   * @returns {Object} The created task object with id, status, timestamps
   * @throws {Error} If agent is not found
   */
  addTask(agentName, task) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const taskObj = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      description: task.description || task,
      status: 'pending',
      attempts: 0,
      maxAttempts: task.maxAttempts || 3,
      parentGoalId: task.parentGoalId || null,
      parentTaskId: task.parentTaskId || null,
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: task.metadata || {}
    };

    agent.tasks.push(taskObj);
    agent.lastActivity = Date.now();

    this._emitEvent(EventTypes.TASK_ADDED, {
      source: agentName,
      changeType: ChangeTypes.ADDED,
      object: taskObj,
      agentState: agent
    });

    return taskObj;
  }

  /**
   * Update a task's status or properties.
   * Automatically increments attempts when status is 'in_progress' or 'failed'.
   * Emits 'task:completed', 'task:failed', or 'task:updated' based on new status.
   *
   * @param {string} agentName - Agent name
   * @param {string} taskId - Task ID (e.g., 'task-1234567890-abc123')
   * @param {Object} updates - Updates to apply
   * @param {string} [updates.status] - New status ('pending', 'in_progress', 'completed', 'failed', 'blocked')
   * @returns {Object} The updated task object
   * @throws {Error} If agent or task is not found
   */
  updateTask(agentName, taskId, updates) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const task = agent.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found for agent '${agentName}'`);
    }

    if (updates.status === 'in_progress' || updates.status === 'failed') {
      task.attempts = (task.attempts || 0) + 1;
    }

    // Track when task first started (for elapsed time display)
    if (updates.status === 'in_progress' && !task.startedAt) {
      task.startedAt = Date.now();
    }

    Object.assign(task, updates, { updatedAt: Date.now() });
    agent.lastActivity = Date.now();

    let eventType = EventTypes.TASK_UPDATED;
    if (updates.status === 'completed') {
      eventType = EventTypes.TASK_COMPLETED;
    } else if (updates.status === 'failed') {
      eventType = EventTypes.TASK_FAILED;
    }

    this._emitEvent(eventType, {
      source: agentName,
      changeType: ChangeTypes.MODIFIED,
      object: task,
      agentState: agent
    });

    return task;
  }

  /**
   * Add a subtask to an existing task.
   * The subtask inherits parentGoalId from the parent task.
   * Emits 'task:added' event.
   *
   * @param {string} agentName - Agent name
   * @param {string} parentTaskId - Parent task ID
   * @param {Object} subtask - Subtask object (same format as task)
   * @returns {Object} The created subtask object
   * @throws {Error} If agent or parent task is not found
   */
  addSubtask(agentName, parentTaskId, subtask) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const parentTask = agent.tasks.find(t => t.id === parentTaskId);
    if (!parentTask) {
      throw new Error(`Task '${parentTaskId}' not found for agent '${agentName}'`);
    }

    // Inherit parentGoalId from parent task so subtasks are included in plan queries
    subtask.parentTaskId = parentTaskId;
    subtask.parentGoalId = parentTask.parentGoalId;
    const taskObj = this.addTask(agentName, subtask);
    parentTask.subtasks.push(taskObj.id);

    return taskObj;
  }

  /**
   * Remove all tasks belonging to a specific goal.
   * Used when a plan is superseded by a new plan (e.g., after supervisor rejection).
   * Emits 'plan:superseded' event with details of removed tasks.
   *
   * @param {string} agentName - Agent name
   * @param {string} goalId - Goal ID whose tasks should be removed
   * @param {string} [reason] - Reason for superseding the plan
   * @returns {Object} Result with count of removed tasks and their IDs
   * @throws {Error} If agent is not found
   */
  removeTasksByGoalId(agentName, goalId, reason = 'Plan superseded by new plan') {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    // Find tasks to remove
    const tasksToRemove = agent.tasks.filter(t => t.parentGoalId === goalId);
    const removedTaskIds = tasksToRemove.map(t => t.id);
    const removedCount = tasksToRemove.length;

    if (removedCount === 0) {
      return { removedCount: 0, removedTaskIds: [] };
    }

    // Remove tasks from agent's task list
    agent.tasks = agent.tasks.filter(t => t.parentGoalId !== goalId);
    agent.lastActivity = Date.now();

    // Emit event
    this._emitEvent(EventTypes.PLAN_SUPERSEDED, {
      source: agentName,
      changeType: ChangeTypes.REMOVED,
      object: {
        goalId,
        reason,
        removedCount,
        removedTaskIds,
        removedTasks: tasksToRemove
      },
      agentState: agent
    });

    return { removedCount, removedTaskIds };
  }

  /**
   * Add to agent's memory.
   * Memory is bounded to 100 entries (oldest are removed).
   * Emits 'memory:updated' event.
   *
   * @param {string} agentName - Agent name
   * @param {Object|string} entry - Memory entry object or content string
   * @param {string} [entry.content] - Memory content
   * @param {string} [entry.type='general'] - Memory type (e.g., 'observation', 'decision')
   * @param {Object} [entry.metadata] - Additional metadata
   * @returns {Object} The created memory entry with id and timestamp
   * @throws {Error} If agent is not found
   */
  addMemory(agentName, entry) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const memoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content: entry.content || entry,
      type: entry.type || 'general',
      timestamp: Date.now(),
      metadata: entry.metadata || {}
    };

    agent.memory.push(memoryEntry);
    agent.lastActivity = Date.now();

    // Keep memory bounded
    if (agent.memory.length > 100) {
      agent.memory = agent.memory.slice(-100);
    }

    this._emitEvent(EventTypes.MEMORY_UPDATED, {
      source: agentName,
      changeType: ChangeTypes.ADDED,
      object: memoryEntry,
      agentState: agent
    });

    return memoryEntry;
  }

  /**
   * Record an output from an agent (e.g., Claude response).
   * Outputs are bounded to 50 entries (oldest are removed).
   * Emits 'output:recorded' event.
   *
   * @param {string} agentName - Agent name
   * @param {Object|string} output - Output object or content string
   * @param {string} [output.content] - Output content
   * @param {string} [output.type='response'] - Output type
   * @param {string} [output.taskId] - Associated task ID
   * @param {Array} [output.toolCalls] - Tool calls made in this output
   * @param {Object} [output.metadata] - Additional metadata
   * @returns {Object} The created output entry with id and timestamp
   * @throws {Error} If agent is not found
   */
  recordOutput(agentName, output) {
    const agent = this.agents[agentName];
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const outputEntry = {
      id: `out-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content: output.content || output,
      type: output.type || 'response',
      taskId: output.taskId || null,
      toolCalls: output.toolCalls || [],
      timestamp: Date.now(),
      metadata: output.metadata || {}
    };

    agent.outputs.push(outputEntry);
    agent.lastActivity = Date.now();

    // Keep outputs bounded
    if (agent.outputs.length > 50) {
      agent.outputs = agent.outputs.slice(-50);
    }

    this._emitEvent(EventTypes.OUTPUT_RECORDED, {
      source: agentName,
      changeType: ChangeTypes.ADDED,
      object: outputEntry,
      agentState: agent
    });

    return outputEntry;
  }

  /**
   * Log an interaction between agents.
   * Interaction is logged to both source and target agents.
   * Interactions are bounded to 100 entries per agent.
   * Emits 'interaction:logged' event.
   *
   * @param {string} fromAgent - Source agent name
   * @param {string} toAgent - Target agent name
   * @param {Object} interaction - Interaction details
   * @param {string} [interaction.type='message'] - Interaction type
   * @param {string} interaction.content - Interaction content
   * @param {Array} [interaction.toolCalls] - Tool calls in this interaction
   * @param {Object} [interaction.metadata] - Additional metadata
   * @returns {Object} The created interaction entry with id and timestamp
   * @throws {Error} If source agent is not found
   */
  logInteraction(fromAgent, toAgent, interaction) {
    const sourceAgent = this.agents[fromAgent];
    const targetAgent = this.agents[toAgent];

    if (!sourceAgent) {
      throw new Error(`Agent '${fromAgent}' not found`);
    }

    const interactionEntry = {
      id: `int-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from: fromAgent,
      to: toAgent,
      type: interaction.type || 'message',
      content: interaction.content,
      toolCalls: interaction.toolCalls || [],
      timestamp: Date.now(),
      metadata: interaction.metadata || {}
    };

    sourceAgent.interactions.push(interactionEntry);
    sourceAgent.lastActivity = Date.now();

    if (targetAgent) {
      targetAgent.interactions.push(interactionEntry);
      targetAgent.lastActivity = Date.now();
    }

    // Keep interactions bounded
    if (sourceAgent.interactions.length > 100) {
      sourceAgent.interactions = sourceAgent.interactions.slice(-100);
    }
    if (targetAgent && targetAgent.interactions.length > 100) {
      targetAgent.interactions = targetAgent.interactions.slice(-100);
    }

    this._emitEvent(EventTypes.INTERACTION_LOGGED, {
      source: fromAgent,
      changeType: ChangeTypes.ADDED,
      object: interactionEntry,
      agentState: sourceAgent
    });

    return interactionEntry;
  }

  /**
   * Record a Claude CLI invocation with full details.
   * This captures the complete execution trace including prompts, responses,
   * tool calls, token usage, and timing for debugging and analysis.
   * Emits 'invocation:recorded' event.
   *
   * @param {string} agentName - Agent that made the invocation
   * @param {Object} invocation - Invocation details
   * @param {string} invocation.prompt - The full prompt sent to Claude
   * @param {string} [invocation.templatePath] - Template used to generate the prompt
   * @param {Object} [invocation.templateContext] - Context passed to the template
   * @param {string} invocation.response - Claude's full response text
   * @param {Array} [invocation.toolCalls] - Tool calls with full arguments
   * @param {string} [invocation.taskId] - Associated task ID
   * @param {string} [invocation.goalId] - Associated goal ID
   * @param {string} [invocation.sessionId] - Claude CLI session ID
   * @param {string} [invocation.model] - Model used for this invocation
   * @param {number} [invocation.tokensIn] - Input tokens used
   * @param {number} [invocation.tokensOut] - Output tokens generated
   * @param {number} [invocation.costUsd] - Cost in USD
   * @param {number} [invocation.durationMs] - Execution duration in milliseconds
   * @param {string} [invocation.status] - Outcome status (success, error, timeout)
   * @param {string} [invocation.error] - Error message if failed
   * @param {Object} [invocation.metadata] - Additional metadata
   * @returns {Object} The created invocation entry with id and timestamp
   */
  recordInvocation(agentName, invocation) {
    const agent = this.agents[agentName];

    const invocationEntry = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      agentName,
      prompt: invocation.prompt,
      templatePath: invocation.templatePath || null,
      templateContext: invocation.templateContext || null,
      response: invocation.response,
      toolCalls: invocation.toolCalls || [],
      taskId: invocation.taskId || null,
      goalId: invocation.goalId || null,
      sessionId: invocation.sessionId || null,
      model: invocation.model || (agent?.model) || null,
      tokensIn: invocation.tokensIn || null,
      tokensOut: invocation.tokensOut || null,
      costUsd: invocation.costUsd || null,
      durationMs: invocation.durationMs || null,
      status: invocation.status || 'success',
      error: invocation.error || null,
      timestamp: Date.now(),
      metadata: invocation.metadata || {}
    };

    this.invocations.push(invocationEntry);

    // Keep invocations bounded if limit is set
    if (this.maxInvocationsSize > 0 && this.invocations.length > this.maxInvocationsSize) {
      this.invocations = this.invocations.slice(-this.maxInvocationsSize);
    }

    if (agent) {
      agent.lastActivity = Date.now();
    }

    this._emitEvent(EventTypes.INVOCATION_RECORDED, {
      source: agentName,
      changeType: ChangeTypes.ADDED,
      object: invocationEntry,
      agentState: agent
    });

    return invocationEntry;
  }

  /**
   * Get all invocations, optionally filtered.
   *
   * @param {Object} [filter={}] - Filter options
   * @param {string} [filter.agentName] - Filter by agent name
   * @param {string} [filter.taskId] - Filter by task ID
   * @param {string} [filter.goalId] - Filter by goal ID
   * @param {string} [filter.status] - Filter by status
   * @returns {Array<Object>} Matching invocations
   */
  getInvocations(filter = {}) {
    let result = this.invocations;

    if (filter.agentName) {
      result = result.filter(inv => inv.agentName === filter.agentName);
    }
    if (filter.taskId) {
      result = result.filter(inv => inv.taskId === filter.taskId);
    }
    if (filter.goalId) {
      result = result.filter(inv => inv.goalId === filter.goalId);
    }
    if (filter.status) {
      result = result.filter(inv => inv.status === filter.status);
    }

    return result;
  }

  /**
   * Get invocation statistics.
   *
   * @returns {Object} Statistics about invocations
   */
  getInvocationStats() {
    const stats = {
      total: this.invocations.length,
      byAgent: {},
      byStatus: {},
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostUsd: 0,
      totalDurationMs: 0
    };

    for (const inv of this.invocations) {
      // By agent
      stats.byAgent[inv.agentName] = (stats.byAgent[inv.agentName] || 0) + 1;

      // By status
      stats.byStatus[inv.status] = (stats.byStatus[inv.status] || 0) + 1;

      // Totals
      if (inv.tokensIn) stats.totalTokensIn += inv.tokensIn;
      if (inv.tokensOut) stats.totalTokensOut += inv.tokensOut;
      if (inv.costUsd) stats.totalCostUsd += inv.costUsd;
      if (inv.durationMs) stats.totalDurationMs += inv.durationMs;
    }

    return stats;
  }

  /**
   * Start a new workflow.
   * Emits 'workflow:started' event.
   *
   * @param {string} name - Workflow name (e.g., 'default-workflow')
   * @param {string} goal - Main goal description
   * @param {Object} [configuration=null] - Workflow configuration object
   * @returns {Object} The workflow state object
   */
  startWorkflow(name, goal, configuration = null) {
    this.workflow = {
      active: true,
      name,
      goal,
      startTime: Date.now(),
      configuration
    };

    this._emitEvent(EventTypes.WORKFLOW_STARTED, {
      source: 'core',
      changeType: ChangeTypes.ADDED,
      object: this.workflow,
      agentState: null
    });

    return this.workflow;
  }

  /**
   * Complete the current workflow.
   * Emits 'workflow:completed' event.
   *
   * @param {string} [status='completed'] - Completion status ('completed', 'failed', 'aborted')
   * @param {Object} [result=null] - Workflow result data
   * @returns {Object} The updated workflow state object
   */
  completeWorkflow(status = 'completed', result = null) {
    this.workflow.active = false;
    this.workflow.endTime = Date.now();
    this.workflow.status = status;
    this.workflow.result = result;

    this._emitEvent(EventTypes.WORKFLOW_COMPLETED, {
      source: 'core',
      changeType: ChangeTypes.MODIFIED,
      object: this.workflow,
      agentState: null
    });

    return this.workflow;
  }

  /**
   * Internal method to emit events and log them.
   * All events are emitted on their specific channel AND the '*' wildcard channel.
   *
   * @private
   * @param {string} eventType - Event type from EventTypes
   * @param {Object} eventData - Event data including source, changeType, object, agentState
   * @returns {Object} The complete event object with timestamp
   */
  _emitEvent(eventType, eventData) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      ...eventData
    };

    // Add to event log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxEventLogSize);
    }

    // Emit the event
    this.emit(eventType, event);
    this.emit('*', event); // Wildcard for catching all events

    return event;
  }

  /**
   * Subscribe to events from specific agents.
   * Events from 'core' are always included.
   *
   * @param {string} subscriberName - Subscribing agent name (for documentation only)
   * @param {string[]} sourceAgents - Agent names to subscribe to events from
   * @param {Function} handler - Event handler function, called with event object
   * @returns {Function} Unsubscribe function - call to remove the subscription
   *
   * @example
   * const unsubscribe = agentCore.subscribeToAgents('coder', ['planner', 'supervisor'], (event) => {
   *   console.log(`Event from ${event.source}: ${event.type}`);
   * });
   * // Later: unsubscribe();
   */
  subscribeToAgents(subscriberName, sourceAgents, handler) {
    const wrappedHandler = (event) => {
      if (sourceAgents.includes(event.source) || event.source === 'core') {
        handler(event);
      }
    };

    this.on('*', wrappedHandler);

    return () => this.off('*', wrappedHandler);
  }

  /**
   * Get all registered agents.
   * @returns {Object.<string, Object>} Shallow copy of agents map
   */
  getAllAgents() {
    return { ...this.agents };
  }

  /**
   * Get names of all registered agents.
   * @returns {string[]} Array of agent names
   */
  getAgentNames() {
    return Object.keys(this.agents);
  }

  /**
   * Get the event log (most recent events).
   * @param {number} [limit=100] - Maximum number of events to return
   * @returns {Array<Object>} Array of event objects, most recent last
   */
  getEventLog(limit = 100) {
    return this.eventLog.slice(-limit);
  }

  /**
   * Ensure the state directory exists, creating it if necessary.
   * @returns {void}
   */
  ensureStateDir() {
    const stateDir = this.getStateDir();
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
  }

  /**
   * Save current state to disk for resumability.
   * Saves agents, workflow, invocations, and recent event log to .claude-looper/state.json.
   * Emits 'snapshot:saved' event.
   *
   * @param {Object} [extras={}] - Additional state to persist (e.g., executor sessions)
   * @returns {Object} The saved state object
   */
  snapshot(extras = {}) {
    this.ensureStateDir();

    const state = {
      version: 3, // Bumped version for failure patterns support
      timestamp: Date.now(),
      agents: this.agents,
      workflow: this.workflow,
      invocations: this.invocations, // Full invocations graph - no truncation
      failurePatterns: this.failurePatterns, // Cross-task failure learning
      eventLog: this.eventLog.slice(-100), // Save last 100 events
      ...extras
    };

    // Use atomic write: write to temp file then rename
    const statePath = this.getStatePath();
    const tempPath = `${statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
    fs.renameSync(tempPath, statePath);

    this._emitEvent(EventTypes.SNAPSHOT_SAVED, {
      source: 'core',
      changeType: ChangeTypes.ADDED,
      object: { path: this.getStatePath(), timestamp: state.timestamp },
      agentState: null
    });

    return state;
  }

  /**
   * Load state from disk.
   * Restores agents, workflow, and event log from .claude-looper/state.json.
   * Emits 'snapshot:loaded' event.
   *
   * @returns {Object|null} The loaded state object, or null if no state file exists
   */
  loadSnapshot() {
    const statePath = this.getStatePath();

    if (!fs.existsSync(statePath)) {
      return null;
    }

    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      // Handle corrupted/partial JSON (e.g., from incomplete writes)
      return null;
    }

    this.agents = state.agents || {};
    this.workflow = state.workflow || { active: false };
    this.invocations = state.invocations || [];
    this.failurePatterns = state.failurePatterns || [];
    this.eventLog = state.eventLog || [];

    this._emitEvent(EventTypes.SNAPSHOT_LOADED, {
      source: 'core',
      changeType: ChangeTypes.MODIFIED,
      object: { path: statePath, timestamp: state.timestamp },
      agentState: null
    });

    return state;
  }

  /**
   * Load workflow configuration from disk.
   * @returns {Object|null} The configuration object, or null if no config file exists
   */
  loadConfiguration() {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      // Handle corrupted/partial JSON (e.g., from incomplete writes)
      return null;
    }
  }

  /**
   * Save workflow configuration to disk.
   * @param {Object} config - Configuration object to save
   * @returns {Object} The saved configuration object
   */
  saveConfiguration(config) {
    this.ensureStateDir();
    // Use atomic write: write to temp file then rename
    const configPath = this.getConfigPath();
    const tempPath = `${configPath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
    fs.renameSync(tempPath, configPath);
    return config;
  }

  /**
   * Check if there's a workflow that can be resumed.
   * Checks for active, failed, or aborted workflows in saved state.
   *
   * @returns {boolean} True if a resumable workflow exists
   */
  canResume() {
    const statePath = this.getStatePath();
    if (!fs.existsSync(statePath)) {
      return false;
    }

    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      // Handle corrupted/partial JSON (e.g., from incomplete writes)
      return false;
    }

    if (!state.workflow) {
      return false;
    }

    // Can resume active workflows, or failed/aborted ones
    const resumableStatuses = ['running', 'failed', 'aborted', undefined];
    return state.workflow.active || resumableStatuses.includes(state.workflow.status);
  }

  /**
   * Get information about the saved workflow for resume.
   *
   * @returns {Object|null} Resume info object with goal, status, tasks, or null if no saved state
   * @returns {string} returns.goal - The workflow goal
   * @returns {string} returns.name - Workflow name
   * @returns {string} returns.status - Current status
   * @returns {number} returns.startTime - Workflow start timestamp
   * @returns {Object} returns.tasks - Task summary (total, completed, failed, pending, inProgress)
   * @returns {boolean} returns.canRetry - Whether there are tasks to retry
   */
  getResumeInfo() {
    const statePath = this.getStatePath();
    if (!fs.existsSync(statePath)) {
      return null;
    }

    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      // Handle corrupted/partial JSON (e.g., from incomplete writes)
      return null;
    }

    if (!state.workflow) {
      return null;
    }

    // Count task states from planner agent
    const planner = state.agents?.planner;
    const tasks = planner?.tasks || [];
    const taskSummary = {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length
    };

    return {
      goal: state.workflow.goal,
      name: state.workflow.name,
      status: state.workflow.status || (state.workflow.active ? 'running' : 'unknown'),
      startTime: state.workflow.startTime,
      endTime: state.workflow.endTime,
      tasks: taskSummary,
      canRetry: taskSummary.failed > 0 || taskSummary.inProgress > 0 || taskSummary.pending > 0
    };
  }

  /**
   * Reset failed, in-progress, and orphaned blocked tasks to pending for retry.
   * Also re-activates the workflow.
   *
   * Blocked tasks are reset only if they have no subtasks (orphaned).
   * Blocked tasks WITH subtasks are left blocked - their subtasks will be executed.
   *
   * @param {string} [agentName='planner'] - Agent whose tasks to reset
   * @returns {object} { resetCount: number, blockedReset: number }
   */
  resetFailedTasks(agentName = 'planner') {
    const agent = this.agents[agentName];
    if (!agent) return { resetCount: 0, blockedReset: 0 };

    let resetCount = 0;
    let blockedReset = 0;

    for (const task of agent.tasks) {
      // Reset failed and in-progress tasks
      if (task.status === 'failed' || task.status === 'in_progress') {
        task.status = 'pending';
        task.attempts = 0;
        task.updatedAt = Date.now();
        resetCount++;
      }

      // Reset orphaned blocked tasks (blocked with no subtasks)
      // These were likely blocked by the old pivot logic and should be retried
      if (task.status === 'blocked' && (!task.subtasks || task.subtasks.length === 0)) {
        task.status = 'pending';
        task.attempts = 0;
        task.updatedAt = Date.now();
        // Clear any old blocked reason
        if (task.metadata) {
          delete task.metadata.blockedReason;
        }
        blockedReset++;
      }
    }

    // Re-activate workflow
    this.workflow.active = true;
    this.workflow.status = 'running';
    this.workflow.endTime = null;

    return { resetCount, blockedReset };
  }

  /**
   * Resume from saved state.
   * Loads the snapshot and returns the state.
   *
   * @returns {Object} The loaded state object
   * @throws {Error} If no saved state exists
   */
  resume() {
    const state = this.loadSnapshot();
    if (!state) {
      throw new Error('No saved state to resume from');
    }

    return state;
  }

  /**
   * Reset the core state to initial empty state.
   * Clears all agents, workflow, and event log.
   * @returns {void}
   */
  reset() {
    this.agents = {};
    this.workflow = {
      active: false,
      name: null,
      goal: null,
      startTime: null,
      configuration: null
    };
    this.eventLog = [];
    this.failurePatterns = [];
    this.invocations = [];
  }

  /**
   * Get summary of current state for reporting.
   *
   * @returns {Object} Summary object
   * @returns {number} returns.agentCount - Number of registered agents
   * @returns {Array<Object>} returns.agents - Array of agent summaries (name, model, taskCount, etc.)
   * @returns {Object} returns.workflow - Current workflow state
   * @returns {number} returns.eventLogSize - Number of events in log
   */
  getSummary() {
    const agents = Object.values(this.agents);
    return {
      agentCount: agents.length,
      agents: agents.map(a => ({
        name: a.name,
        model: a.model,
        taskCount: a.tasks.length,
        pendingTasks: a.tasks.filter(t => t.status === 'pending').length,
        completedTasks: a.tasks.filter(t => t.status === 'completed').length,
        goalCount: a.goals.length,
        activeGoals: a.goals.filter(g => g.status === 'active').length
      })),
      workflow: this.workflow,
      eventLogSize: this.eventLog.length
    };
  }
}

// Singleton instance
const agentCore = new AgentCore();

// Export the singleton
export default agentCore;
export { agentCore, AgentCore };
