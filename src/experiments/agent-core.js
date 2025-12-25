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

// Event types for state changes
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
  MEMORY_UPDATED: 'memory:updated',
  OUTPUT_RECORDED: 'output:recorded',
  INTERACTION_LOGGED: 'interaction:logged',
  SNAPSHOT_SAVED: 'snapshot:saved',
  SNAPSHOT_LOADED: 'snapshot:loaded',
  WORKFLOW_STARTED: 'workflow:started',
  WORKFLOW_COMPLETED: 'workflow:completed'
};

// Change types for state modifications
export const ChangeTypes = {
  ADDED: 'added',
  MODIFIED: 'modified',
  REMOVED: 'removed'
};

/**
 * Agent Core Singleton Class
 * Manages all agent state, events, and persistence
 */
class AgentCore extends EventEmitter {
  constructor() {
    super();

    // Main agents state store
    this.agents = {};

    // Global workflow state
    this.workflow = {
      active: false,
      name: null,
      goal: null,
      startTime: null,
      configuration: null
    };

    // Event log for debugging and replay
    this.eventLog = [];
    this.maxEventLogSize = 500;

    // State directory configuration
    this.stateDir = '.claude-looper';
    this.stateFile = 'state.json';
    this.configFile = 'configuration.json';

    // Increase listener limit for many agent subscriptions
    this.setMaxListeners(100);
  }

  /**
   * Get the full path to the state directory
   */
  getStateDir() {
    return path.join(process.cwd(), this.stateDir);
  }

  /**
   * Get the full path to the state file
   */
  getStatePath() {
    return path.join(this.getStateDir(), this.stateFile);
  }

  /**
   * Get the full path to the configuration file
   */
  getConfigPath() {
    return path.join(this.getStateDir(), this.configFile);
  }

  /**
   * Register a new agent with the core
   * @param {string} name - Unique agent name
   * @param {object} options - Agent configuration
   * @param {string} options.model - Claude model to use (opus, sonnet, haiku)
   * @param {object} options.state - Initial custom state
   * @param {string[]} options.subscribesTo - Agent names to subscribe to
   * @param {object[]} options.tools - Tool definitions for this agent
   */
  registerAgent(name, options = {}) {
    if (this.agents[name]) {
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
   * Get an agent by name
   * @param {string} name - Agent name
   */
  getAgent(name) {
    return this.agents[name] || null;
  }

  /**
   * Get an agent's state
   * @param {string} name - Agent name
   */
  getAgentState(name) {
    const agent = this.agents[name];
    return agent ? agent.state : null;
  }

  /**
   * Update an agent's custom state
   * @param {string} name - Agent name
   * @param {object} updates - State updates to merge
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
   * Set a goal for an agent
   * @param {string} agentName - Agent name
   * @param {object} goal - Goal object
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
   * Update a goal's status
   * @param {string} agentName - Agent name
   * @param {string} goalId - Goal ID
   * @param {object} updates - Updates to apply
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
   * Add a task for an agent
   * @param {string} agentName - Agent name
   * @param {object} task - Task object
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
   * Update a task's status
   * @param {string} agentName - Agent name
   * @param {string} taskId - Task ID
   * @param {object} updates - Updates to apply
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
   * Add a subtask to an existing task
   * @param {string} agentName - Agent name
   * @param {string} parentTaskId - Parent task ID
   * @param {object} subtask - Subtask object
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

    subtask.parentTaskId = parentTaskId;
    const taskObj = this.addTask(agentName, subtask);
    parentTask.subtasks.push(taskObj.id);

    return taskObj;
  }

  /**
   * Add to agent's memory
   * @param {string} agentName - Agent name
   * @param {object} entry - Memory entry
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
   * Record an output from an agent
   * @param {string} agentName - Agent name
   * @param {object} output - Output object
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
   * Log an interaction between agents
   * @param {string} fromAgent - Source agent name
   * @param {string} toAgent - Target agent name
   * @param {object} interaction - Interaction details
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
   * Start a workflow
   * @param {string} name - Workflow name
   * @param {string} goal - Main goal description
   * @param {object} configuration - Workflow configuration
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
   * Complete the current workflow
   * @param {string} status - Completion status
   * @param {object} result - Workflow result
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
   * Internal method to emit events and log them
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
   * Subscribe to events from specific agents
   * @param {string} subscriberName - Subscribing agent name
   * @param {string[]} sourceAgents - Agent names to subscribe to
   * @param {function} handler - Event handler function
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
   * Get all agents
   */
  getAllAgents() {
    return { ...this.agents };
  }

  /**
   * Get registered agent names
   */
  getAgentNames() {
    return Object.keys(this.agents);
  }

  /**
   * Get the event log
   * @param {number} limit - Maximum number of events to return
   */
  getEventLog(limit = 100) {
    return this.eventLog.slice(-limit);
  }

  /**
   * Ensure the state directory exists
   */
  ensureStateDir() {
    const stateDir = this.getStateDir();
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
  }

  /**
   * Save current state to disk
   */
  snapshot() {
    this.ensureStateDir();

    const state = {
      version: 1,
      timestamp: Date.now(),
      agents: this.agents,
      workflow: this.workflow,
      eventLog: this.eventLog.slice(-100) // Save last 100 events
    };

    fs.writeFileSync(this.getStatePath(), JSON.stringify(state, null, 2));

    this._emitEvent(EventTypes.SNAPSHOT_SAVED, {
      source: 'core',
      changeType: ChangeTypes.ADDED,
      object: { path: this.getStatePath(), timestamp: state.timestamp },
      agentState: null
    });

    return state;
  }

  /**
   * Load state from disk
   */
  loadSnapshot() {
    const statePath = this.getStatePath();

    if (!fs.existsSync(statePath)) {
      return null;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    this.agents = state.agents || {};
    this.workflow = state.workflow || { active: false };
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
   * Load workflow configuration
   */
  loadConfiguration() {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  /**
   * Save workflow configuration
   * @param {object} config - Configuration object
   */
  saveConfiguration(config) {
    this.ensureStateDir();
    fs.writeFileSync(this.getConfigPath(), JSON.stringify(config, null, 2));
    return config;
  }

  /**
   * Check if there's a workflow that can be resumed (active, failed, or aborted)
   */
  canResume() {
    const statePath = this.getStatePath();
    if (!fs.existsSync(statePath)) {
      return false;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state.workflow) {
      return false;
    }

    // Can resume active workflows, or failed/aborted ones
    const resumableStatuses = ['running', 'failed', 'aborted', undefined];
    return state.workflow.active || resumableStatuses.includes(state.workflow.status);
  }

  /**
   * Get information about what can be resumed
   */
  getResumeInfo() {
    const statePath = this.getStatePath();
    if (!fs.existsSync(statePath)) {
      return null;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
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
   * Reset failed and in-progress tasks for retry
   */
  resetFailedTasks(agentName = 'planner') {
    const agent = this.agents[agentName];
    if (!agent) return 0;

    let resetCount = 0;
    for (const task of agent.tasks) {
      if (task.status === 'failed' || task.status === 'in_progress') {
        task.status = 'pending';
        task.attempts = 0;
        task.updatedAt = Date.now();
        resetCount++;
      }
    }

    // Re-activate workflow
    this.workflow.active = true;
    this.workflow.status = 'running';
    this.workflow.endTime = null;

    return resetCount;
  }

  /**
   * Resume from saved state
   */
  resume() {
    const state = this.loadSnapshot();
    if (!state) {
      throw new Error('No saved state to resume from');
    }

    return state;
  }

  /**
   * Reset the core state
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
  }

  /**
   * Get summary of current state
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
