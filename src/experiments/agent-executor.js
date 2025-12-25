/**
 * Agent Executor - Executes agent prompts against Claude Code CLI
 *
 * This module wraps the Claude Code CLI invocation for the multi-agent framework.
 * It handles:
 * - Template loading and transformation
 * - Tool call signaling for structured responses
 * - Session management per agent
 * - Metrics tracking
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

// Error categories for retry decisions
const ERROR_CATEGORIES = {
  TRANSIENT: ['ECONNRESET', 'ETIMEDOUT', 'overloaded', 'rate_limit', '529', '503'],
  PERMANENT: ['invalid_api_key', 'permission_denied', 'invalid_request'],
  TIMEOUT: ['timed out', 'timeout']
};

/**
 * Agent Executor class for invoking Claude Code CLI
 */
export class AgentExecutor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      cwd: options.cwd || process.cwd(),
      claudePath: options.claudePath || 'claude',
      timeout: options.timeout || 10 * 60 * 1000, // 10 minutes
      skipPermissions: options.skipPermissions !== false,
      verbose: options.verbose || false,
      maxRetries: options.maxRetries ?? 3,
      retryBaseDelay: options.retryBaseDelay || 1000,
      templatesDir: options.templatesDir || path.join(process.cwd(), 'src/experiments/templates')
    };

    // Sessions per agent
    this.sessions = {};

    // Template cache
    this.templateCache = {};

    // Global metrics
    this.metrics = {
      totalCalls: 0,
      totalRetries: 0,
      totalFallbacks: 0,
      totalCostUsd: 0,
      callsByAgent: {}
    };
  }

  /**
   * Load and compile a template
   * @param {string} templatePath - Relative path to template file
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
   * Render a template with context
   * @param {string} templatePath - Relative path to template
   * @param {object} context - Template context variables
   */
  renderTemplate(templatePath, context = {}) {
    const template = this.loadTemplate(templatePath);
    return template(context);
  }

  /**
   * Build tool definitions for Claude
   * Tools are used for signaling completion and results
   * @param {object[]} tools - Tool definitions
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
   * Categorize an error for retry logic
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
   * Sleep helper for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a prompt for an agent
   * @param {string} agentName - Name of the agent
   * @param {string} prompt - The prompt to send
   * @param {object} options - Execution options
   */
  async execute(agentName, prompt, options = {}) {
    const maxRetries = options.maxRetries ?? this.options.maxRetries;
    let lastError = null;
    let attempt = 0;

    // Track metrics per agent
    if (!this.metrics.callsByAgent[agentName]) {
      this.metrics.callsByAgent[agentName] = 0;
    }

    while (attempt <= maxRetries) {
      try {
        const result = await this._executeOnce(agentName, prompt, options);
        this.metrics.totalCalls++;
        this.metrics.callsByAgent[agentName]++;
        return result;
      } catch (error) {
        lastError = error;
        const category = this.categorizeError(error);

        if (category === 'PERMANENT') {
          throw error;
        }

        attempt++;
        this.metrics.totalRetries++;

        if (attempt <= maxRetries) {
          const delay = this.options.retryBaseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);

          if (this.options.verbose) {
            console.log(`[AgentExecutor] ${agentName} retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms: ${error.message}`);
          }

          this.emit('retry', { agentName, attempt, maxRetries, delay, error: error.message, category });
          await this.sleep(delay);

          // Try fallback model after first retry
          if (options.fallbackModel && attempt >= 2 && !options._usingFallback) {
            if (this.options.verbose) {
              console.log(`[AgentExecutor] ${agentName} switching to fallback model: ${options.fallbackModel}`);
            }
            this.metrics.totalFallbacks++;
            options = { ...options, model: options.fallbackModel, _usingFallback: true };
            this.emit('fallback', { agentName, model: options.fallbackModel });
          }
        }
      }
    }

    throw lastError;
  }

  /**
   * Internal: Execute a single prompt without retry
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
        this.emit('stdout', { agentName, chunk });
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emit('stderr', { agentName, chunk });
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
   * Build CLI arguments
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
   * Parse Claude Code output
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
