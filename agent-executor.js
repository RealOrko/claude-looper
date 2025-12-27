/**
 * Agent Executor - Executes agent prompts against Claude Code CLI
 *
 * This module wraps the Claude Code CLI invocation for the multi-agent framework.
 * It handles:
 * - Template loading and transformation using Handlebars
 * - Tool call signaling for structured responses
 * - Session management per agent (conversation continuity)
 * - Metrics tracking (calls, retries, costs)
 * - Retry logic with exponential backoff
 * - Fallback model support
 *
 * Uses callbacks instead of EventEmitter for execution lifecycle events.
 * All events are routed through agentCore for centralized event management.
 *
 * @module agent-executor
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

/**
 * Error categories for retry decisions.
 * TRANSIENT errors are retried, PERMANENT errors fail immediately.
 * All keywords are lowercase since categorizeError() lowercases error strings.
 * @private
 */
const ERROR_CATEGORIES = {
  TRANSIENT: ['econnreset', 'etimedout', 'overloaded', 'rate_limit', '529', '503'],
  PERMANENT: ['invalid_api_key', 'permission_denied', 'invalid_request'],
  TIMEOUT: ['timed out', 'timeout']
};

/**
 * Agent Executor class for invoking Claude Code CLI.
 * Uses callbacks for execution lifecycle events instead of EventEmitter.
 *
 * @example
 * import agentExecutor from './agent-executor.js';
 *
 * // Set up callbacks for lifecycle events
 * agentExecutor.setCallbacks({
 *   onStart: ({ agentName, prompt }) => console.log(`${agentName} starting`),
 *   onComplete: ({ agentName, result }) => console.log(`${agentName} done`),
 *   onStdout: ({ agentName, chunk }) => console.log(chunk)
 * });
 *
 * // Execute a prompt
 * const result = await agentExecutor.execute('planner', 'Create a plan for...', {
 *   model: 'sonnet',
 *   fallbackModel: 'haiku'
 * });
 */
export class AgentExecutor {
  /**
   * Creates a new AgentExecutor instance.
   *
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.cwd=process.cwd()] - Working directory for CLI execution
   * @param {string} [options.claudePath='claude'] - Path to Claude CLI executable
   * @param {number} [options.timeout=600000] - Execution timeout in ms (10 minutes default)
   * @param {boolean} [options.skipPermissions=true] - Skip permission prompts
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.retryBaseDelay=1000] - Base delay for exponential backoff (ms)
   * @param {string} [options.templatesDir] - Directory for Handlebars templates
   */
  constructor(options = {}) {
    /**
     * Executor configuration options.
     * @type {Object}
     */
    this.options = {
      cwd: options.cwd || process.cwd(),
      claudePath: options.claudePath || 'claude',
      timeout: options.timeout || 10 * 60 * 1000, // 10 minutes
      skipPermissions: options.skipPermissions !== false,
      verbose: options.verbose || false,
      maxRetries: options.maxRetries ?? 3,
      retryBaseDelay: options.retryBaseDelay || 1000,
      templatesDir: options.templatesDir || path.join(process.cwd(), '.claude-looper', 'templates')
    };

    /**
     * Map of session IDs per agent for conversation continuity.
     * @type {Object.<string, string>}
     */
    this.sessions = {};

    /**
     * Cache of compiled Handlebars templates.
     * @type {Object.<string, Function>}
     */
    this.templateCache = {};

    /**
     * Execution metrics.
     * @type {{totalCalls: number, totalRetries: number, totalFallbacks: number, totalCostUsd: number, callsByAgent: Object.<string, number>}}
     */
    this.metrics = {
      totalCalls: 0,
      totalRetries: 0,
      totalFallbacks: 0,
      totalCostUsd: 0,
      callsByAgent: {}
    };

    /**
     * Callbacks for execution lifecycle events.
     * @type {Object}
     * @property {Function} onStart - Called when execution begins ({ agentName, prompt })
     * @property {Function} onComplete - Called when execution succeeds ({ agentName, result })
     * @property {Function} onError - Called when execution fails ({ agentName, error })
     * @property {Function} onRetry - Called when retrying ({ agentName, attempt, maxRetries, delay, error, category })
     * @property {Function} onFallback - Called when switching to fallback model ({ agentName, model })
     * @property {Function} onStdout - Called with stdout data ({ agentName, chunk })
     * @property {Function} onStderr - Called with stderr data ({ agentName, chunk })
     */
    this.callbacks = {
      onStart: null,
      onComplete: null,
      onError: null,
      onRetry: null,
      onFallback: null,
      onStdout: null,
      onStderr: null
    };
  }

  /**
   * Set callbacks for execution lifecycle events.
   *
   * @param {Object} callbacks - Callback functions
   * @param {Function} [callbacks.onStart] - Called when execution begins
   * @param {Function} [callbacks.onComplete] - Called when execution succeeds
   * @param {Function} [callbacks.onError] - Called when execution fails
   * @param {Function} [callbacks.onRetry] - Called when retrying after failure
   * @param {Function} [callbacks.onFallback] - Called when switching to fallback model
   * @param {Function} [callbacks.onStdout] - Called with stdout data
   * @param {Function} [callbacks.onStderr] - Called with stderr data
   */
  setCallbacks(callbacks) {
    Object.assign(this.callbacks, callbacks);
  }

  /**
   * Clear all callbacks.
   */
  clearCallbacks() {
    this.callbacks = {
      onStart: null,
      onComplete: null,
      onError: null,
      onRetry: null,
      onFallback: null,
      onStdout: null,
      onStderr: null
    };
  }

  /**
   * Internal helper to invoke a callback if set.
   * @private
   */
  _invokeCallback(name, data) {
    const callback = this.callbacks[name];
    if (typeof callback === 'function') {
      try {
        callback(data);
      } catch (err) {
        // Log but don't throw - callbacks shouldn't break execution
        if (this.options.verbose) {
          console.error(`[AgentExecutor] Callback error in ${name}:`, err.message);
        }
      }
    }
  }

  /**
   * Load and compile a Handlebars template.
   * Templates are cached after first load.
   *
   * @param {string} templatePath - Relative path to template file (from templatesDir)
   * @returns {Function} Compiled Handlebars template function
   * @throws {Error} If template file is not found
   */
  loadTemplate(templatePath) {
    const fullPath = path.join(this.options.templatesDir, templatePath);

    if (this.templateCache[fullPath]) {
      return this.templateCache[fullPath];
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Template not found: ${fullPath}`);
    }

    const templateContent = fs.readFileSync(fullPath, 'utf8');
    const compiled = Handlebars.compile(templateContent);
    this.templateCache[fullPath] = compiled;

    return compiled;
  }

  /**
   * Render a template with context variables.
   *
   * @param {string} templatePath - Relative path to template
   * @param {Object} [context={}] - Template context variables
   * @returns {string} Rendered template string
   */
  renderTemplate(templatePath, context = {}) {
    const template = this.loadTemplate(templatePath);
    return template(context);
  }

  /**
   * Build a JSON schema for tool definitions.
   * Used for structured output with Claude's --json-schema flag.
   *
   * @param {Object[]} tools - Array of tool definitions with name property
   * @returns {Object|null} JSON schema object or null if no tools
   */
  buildToolSchema(tools) {
    if (!tools || tools.length === 0) {
      return null;
    }

    return {
      type: 'object',
      properties: {
        toolCall: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              enum: tools.map(t => t.name || Object.keys(t)[0])
            },
            arguments: {
              type: 'object'
            }
          },
          required: ['name', 'arguments']
        }
      }
    };
  }

  /**
   * Categorize an error for retry logic.
   *
   * @param {Error|string} error - Error to categorize
   * @returns {'TIMEOUT'|'TRANSIENT'|'PERMANENT'|'UNKNOWN'} Error category
   */
  categorizeError(error) {
    const errorStr = String(error).toLowerCase();

    if (ERROR_CATEGORIES.TIMEOUT.some(t => errorStr.includes(t))) {
      return 'TIMEOUT';
    }
    if (ERROR_CATEGORIES.TRANSIENT.some(t => errorStr.includes(t))) {
      return 'TRANSIENT';
    }
    if (ERROR_CATEGORIES.PERMANENT.some(t => errorStr.includes(t))) {
      return 'PERMANENT';
    }
    return 'UNKNOWN';
  }

  /**
   * Sleep helper for retry delays.
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>} Resolves after delay
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a prompt for an agent with retry and fallback support.
   * Invokes onStart, onComplete, onError, onRetry, and onFallback callbacks.
   *
   * @param {string} agentName - Name of the agent
   * @param {string} prompt - The prompt to send to Claude
   * @param {Object} [options={}] - Execution options
   * @param {string} [options.model] - Claude model to use (opus, sonnet, haiku)
   * @param {string} [options.fallbackModel] - Fallback model if primary fails
   * @param {number} [options.timeout] - Execution timeout in ms
   * @param {number} [options.maxRetries] - Maximum retry attempts
   * @param {number} [options.maxTurns] - Maximum conversation turns
   * @param {Object} [options.jsonSchema] - JSON schema for structured output
   * @param {string} [options.systemPrompt] - System prompt to prepend
   * @param {string} [options.appendSystemPrompt] - System prompt to append
   * @param {string|string[]} [options.tools] - Tools to enable
   * @param {string|string[]} [options.allowedTools] - Allowed tools filter
   * @param {string|string[]} [options.disallowedTools] - Disallowed tools filter
   * @param {boolean} [options.newSession] - Force new session (don't resume)
   * @returns {Promise<Object>} Execution result with response, sessionId, cost info
   * @throws {Error} If execution fails after all retries
   */
  async execute(agentName, prompt, options = {}) {
    const maxRetries = options.maxRetries ?? this.options.maxRetries;
    let lastError = null;
    let attempt = 0;

    // Track metrics per agent
    if (!this.metrics.callsByAgent[agentName]) {
      this.metrics.callsByAgent[agentName] = 0;
    }

    // Signal execution start with the prompt
    this._invokeCallback('onStart', { agentName, prompt });

    while (attempt <= maxRetries) {
      try {
        const result = await this._executeOnce(agentName, prompt, options);
        this.metrics.totalCalls++;
        this.metrics.callsByAgent[agentName]++;
        this._invokeCallback('onComplete', { agentName, result });
        return result;
      } catch (error) {
        lastError = error;
        const category = this.categorizeError(error);

        if (category === 'PERMANENT') {
          this._invokeCallback('onError', { agentName, error });
          throw error;
        }

        attempt++;
        this.metrics.totalRetries++;

        if (attempt <= maxRetries) {
          const delay = this.options.retryBaseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);

          if (this.options.verbose) {
            console.log(`[AgentExecutor] ${agentName} retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms: ${error.message}`);
          }

          this._invokeCallback('onRetry', { agentName, attempt, maxRetries, delay, error: error.message, category });
          await this.sleep(delay);

          // Try fallback model after first retry
          if (options.fallbackModel && attempt >= 2 && !options._usingFallback) {
            if (this.options.verbose) {
              console.log(`[AgentExecutor] ${agentName} switching to fallback model: ${options.fallbackModel}`);
            }
            this.metrics.totalFallbacks++;
            options = { ...options, model: options.fallbackModel, _usingFallback: true };
            this._invokeCallback('onFallback', { agentName, model: options.fallbackModel });
          }
        }
      }
    }

    this._invokeCallback('onError', { agentName, error: lastError });
    throw lastError;
  }

  /**
   * Execute a single prompt without retry logic.
   *
   * @private
   * @param {string} agentName - Agent name
   * @param {string} prompt - Prompt to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async _executeOnce(agentName, prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const args = this._buildArgs(agentName, prompt, options);

      if (this.options.verbose) {
        console.log(`[AgentExecutor] ${agentName}: claude ${args.slice(0, 5).join(' ')}...`);
      }

      let stdout = '';
      let stderr = '';

      const proc = spawn(this.options.claudePath, args, {
        cwd: this.options.cwd,
        env: { ...process.env },
        timeout: options.timeout || this.options.timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        this._invokeCallback('onStdout', { agentName, chunk });
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        this._invokeCallback('onStderr', { agentName, chunk });
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn Claude Code for ${agentName}: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Claude Code exited with code ${code} for ${agentName}: ${stderr}`));
          return;
        }

        try {
          const result = this._parseOutput(agentName, stdout, prompt, options);

          // Update cost metrics
          if (result.costUsd) {
            this.metrics.totalCostUsd += result.costUsd;
          }

          // Store session for this agent
          if (result.sessionId) {
            this.sessions[agentName] = result.sessionId;
          }

          resolve(result);
        } catch (parseError) {
          resolve({
            response: stdout.trim(),
            raw: stdout,
            sessionId: this.sessions[agentName],
            parseError: parseError.message
          });
        }
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Claude Code timed out for ${agentName} after ${options.timeout || this.options.timeout}ms`));
      }, options.timeout || this.options.timeout);

      proc.on('close', () => clearTimeout(timeoutId));
    });
  }

  /**
   * Build CLI arguments for Claude Code invocation.
   *
   * @private
   * @param {string} agentName - Agent name (used for session lookup)
   * @param {string} prompt - Prompt text
   * @param {Object} options - Execution options
   * @returns {string[]} Array of CLI arguments
   */
  _buildArgs(agentName, prompt, options = {}) {
    const args = [];

    args.push('--print');
    args.push('-p', prompt);

    if (options.outputFormat !== 'text') {
      args.push('--output-format', 'json');
    }

    // JSON schema for structured tool call responses
    if (options.jsonSchema) {
      const schemaStr = typeof options.jsonSchema === 'string'
        ? options.jsonSchema
        : JSON.stringify(options.jsonSchema);
      args.push('--json-schema', schemaStr);
    }

    // Resume session if available
    const sessionId = this.sessions[agentName];
    if (sessionId && options.newSession !== true) {
      args.push('--resume', sessionId);
    }

    if (this.options.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.fallbackModel && !options._usingFallback) {
      args.push('--fallback-model', options.fallbackModel);
    }

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    if (options.tools) {
      const toolsStr = Array.isArray(options.tools) ? options.tools.join(',') : options.tools;
      args.push('--tools', toolsStr);
    }

    if (options.allowedTools) {
      const toolsStr = Array.isArray(options.allowedTools) ? options.allowedTools.join(' ') : options.allowedTools;
      args.push('--allowed-tools', toolsStr);
    }

    if (options.disallowedTools) {
      const toolsStr = Array.isArray(options.disallowedTools) ? options.disallowedTools.join(' ') : options.disallowedTools;
      args.push('--disallowed-tools', toolsStr);
    }

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }

    return args;
  }

  /**
   * Parse Claude Code output into structured result.
   *
   * @private
   * @param {string} agentName - Agent name
   * @param {string} output - Raw stdout output
   * @param {string} originalPrompt - Original prompt (for context)
   * @param {Object} options - Execution options
   * @returns {Object} Parsed result with response, sessionId, cost, toolCalls
   */
  _parseOutput(agentName, output, originalPrompt, options = {}) {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.session_id) {
          this.sessions[agentName] = parsed.session_id;
        }

        const result = {
          response: parsed.result || parsed.response || parsed.content || output,
          sessionId: this.sessions[agentName],
          costUsd: parsed.total_cost_usd || parsed.cost_usd,
          duration: parsed.duration_ms,
          numTurns: parsed.num_turns,
          tokensIn: parsed.usage?.input_tokens,
          tokensOut: parsed.usage?.output_tokens,
          raw: parsed
        };

        // Extract structured output (tool calls)
        if (parsed.structured_output) {
          result.structuredOutput = parsed.structured_output;
          result.toolCalls = this._extractToolCalls(parsed.structured_output);
        }

        return result;
      }
    } catch (e) {
      // JSON parsing failed
    }

    // Text output fallback
    const sessionMatch = output.match(/session[_-]?id[:\s]+([a-zA-Z0-9-]+)/i);
    if (sessionMatch) {
      this.sessions[agentName] = sessionMatch[1];
    }

    return {
      response: output.trim(),
      sessionId: this.sessions[agentName],
      raw: output
    };
  }

  /**
   * Extract tool calls from structured output
   */
  _extractToolCalls(structuredOutput) {
    const toolCalls = [];

    if (structuredOutput.toolCall) {
      toolCalls.push(structuredOutput.toolCall);
    }

    if (structuredOutput.toolCalls) {
      toolCalls.push(...structuredOutput.toolCalls);
    }

    return toolCalls;
  }

  /**
   * Execute with a template
   * @param {string} agentName - Agent name
   * @param {string} templatePath - Path to template
   * @param {object} context - Template context
   * @param {object} options - Execution options
   */
  async executeWithTemplate(agentName, templatePath, context = {}, options = {}) {
    const prompt = this.renderTemplate(templatePath, context);
    return this.execute(agentName, prompt, options);
  }

  /**
   * Start a new session for an agent
   * @param {string} agentName - Agent name
   * @param {string} systemContext - System context prompt
   * @param {string} initialPrompt - Initial prompt
   * @param {object} options - Options
   */
  async startSession(agentName, systemContext, initialPrompt, options = {}) {
    // Clear any existing session
    delete this.sessions[agentName];

    const fullPrompt = systemContext
      ? `${systemContext}\n\n---\n\n${initialPrompt}`
      : initialPrompt;

    return this.execute(agentName, fullPrompt, { ...options, newSession: true });
  }

  /**
   * Continue an agent's session
   * @param {string} agentName - Agent name
   * @param {string} prompt - Continuation prompt
   * @param {object} options - Options
   */
  async continueSession(agentName, prompt, options = {}) {
    if (!this.sessions[agentName]) {
      throw new Error(`No active session for agent ${agentName}. Call startSession first.`);
    }

    return this.execute(agentName, prompt, options);
  }

  /**
   * Get session ID for an agent
   */
  getSessionId(agentName) {
    return this.sessions[agentName] || null;
  }

  /**
   * Check if an agent has an active session
   */
  hasSession(agentName) {
    return !!this.sessions[agentName];
  }

  /**
   * Reset an agent's session
   */
  resetSession(agentName) {
    delete this.sessions[agentName];
  }

  /**
   * Reset all sessions
   */
  resetAllSessions() {
    this.sessions = {};
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalCalls: 0,
      totalRetries: 0,
      totalFallbacks: 0,
      totalCostUsd: 0,
      callsByAgent: {}
    };
  }

  /**
   * Clear template cache
   */
  clearTemplateCache() {
    this.templateCache = {};
  }
}

// Singleton instance
const agentExecutor = new AgentExecutor();

export default agentExecutor;
export { agentExecutor };
