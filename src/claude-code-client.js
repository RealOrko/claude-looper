/**
 * Claude Code CLI subprocess wrapper
 * Allows programmatic interaction with Claude Code using Max subscription
 *
 * Enhanced with:
 * - Automatic retry with exponential backoff
 * - Fallback model support for reliability
 * - JSON schema for structured outputs
 * - Tool restrictions for specialized agents
 * - Better error categorization and handling
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Memory limits
const MAX_CONVERSATION_HISTORY = 100; // Keep last 100 messages (50 exchanges)

// Error categories for smart retry decisions
const ERROR_CATEGORIES = {
  TRANSIENT: ['ECONNRESET', 'ETIMEDOUT', 'overloaded', 'rate_limit', '529', '503'],
  PERMANENT: ['invalid_api_key', 'permission_denied', 'invalid_request'],
  TIMEOUT: ['timed out', 'timeout'],
};

export class ClaudeCodeClient extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      cwd: options.cwd || process.cwd(),
      claudePath: options.claudePath || 'claude', // Assumes claude is in PATH
      timeout: options.timeout || 10 * 60 * 1000, // 10 minute default timeout
      skipPermissions: options.skipPermissions !== false, // Default true for autonomous mode
      verbose: options.verbose || false,
      model: options.model || null, // Default model for all requests
      fallbackModel: options.fallbackModel || null, // Fallback when primary overloaded
      maxRetries: options.maxRetries ?? 3, // Auto-retry count
      retryBaseDelay: options.retryBaseDelay || 1000, // Base delay for exponential backoff
      noSessionPersistence: options.noSessionPersistence || false, // Don't save sessions to disk
    };

    this.sessionId = null;
    this.conversationHistory = [];
    this.isRunning = false;
    this.metrics = {
      totalCalls: 0,
      totalRetries: 0,
      totalFallbacks: 0,
      totalCostUsd: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
    };
  }

  /**
   * Categorize an error to determine retry strategy
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
   * Send a prompt to Claude Code and get the response
   * Now with automatic retry and fallback model support
   */
  async sendPrompt(prompt, options = {}) {
    const maxRetries = options.maxRetries ?? this.options.maxRetries;
    const useFallback = options.useFallback !== false && this.options.fallbackModel;

    let lastError = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const result = await this._sendPromptOnce(prompt, options, attempt > 0);
        this.metrics.totalCalls++;
        return result;
      } catch (error) {
        lastError = error;
        const category = this.categorizeError(error);

        // Don't retry permanent errors
        if (category === 'PERMANENT') {
          throw error;
        }

        attempt++;
        this.metrics.totalRetries++;

        if (attempt <= maxRetries) {
          // Exponential backoff with jitter
          const delay = this.options.retryBaseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);

          if (this.options.verbose) {
            console.log(`[ClaudeCodeClient] Retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms (${category}): ${error.message}`);
          }

          this.emit('retry', { attempt, maxRetries, delay, error: error.message, category });
          await this.sleep(delay);

          // Try fallback model on transient errors after first retry
          if (useFallback && attempt >= 2 && !options._usingFallback) {
            if (this.options.verbose) {
              console.log(`[ClaudeCodeClient] Switching to fallback model: ${this.options.fallbackModel}`);
            }
            this.metrics.totalFallbacks++;
            options = { ...options, model: this.options.fallbackModel, _usingFallback: true };
            this.emit('fallback', { model: this.options.fallbackModel });
          }
        }
      }
    }

    throw lastError;
  }

  /**
   * Internal: Execute a single prompt without retry logic
   */
  async _sendPromptOnce(prompt, options = {}, isRetry = false) {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(prompt, options);

      if (this.options.verbose) {
        console.log(`[ClaudeCodeClient] Running: claude ${args.join(' ').substring(0, 200)}...`);
      }

      this.isRunning = true;
      let stdout = '';
      let stderr = '';

      const proc = spawn(this.options.claudePath, args, {
        cwd: this.options.cwd,
        env: { ...process.env },
        timeout: options.timeout || this.options.timeout,
        stdio: ['ignore', 'pipe', 'pipe'], // Close stdin to prevent blocking on prompts
      });

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('stdout', chunk);
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emit('stderr', chunk);
      });

      proc.on('error', (error) => {
        this.isRunning = false;
        reject(new Error(`Failed to spawn Claude Code: ${error.message}`));
      });

      proc.on('close', (code) => {
        this.isRunning = false;

        if (code !== 0 && code !== null) {
          reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = this.parseOutput(stdout, prompt);

          // Update metrics from result
          if (result.raw) {
            if (result.raw.total_cost_usd) {
              this.metrics.totalCostUsd += result.raw.total_cost_usd;
            }
            if (result.raw.usage) {
              this.metrics.cacheHitTokens += result.raw.usage.cache_read_input_tokens || 0;
              this.metrics.cacheMissTokens += result.raw.usage.cache_creation_input_tokens || 0;
            }
          }

          this.conversationHistory.push({
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
          });
          this.conversationHistory.push({
            role: 'assistant',
            content: result.response,
            timestamp: Date.now(),
          });

          // Trim history to prevent unbounded memory growth
          if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
            this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
          }

          resolve(result);
        } catch (parseError) {
          // If JSON parsing fails, return raw output
          resolve({
            response: stdout.trim(),
            raw: stdout,
            sessionId: this.sessionId,
            parseError: parseError.message,
          });
        }
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Claude Code timed out after ${options.timeout || this.options.timeout}ms`));
      }, options.timeout || this.options.timeout);

      proc.on('close', () => clearTimeout(timeoutId));
    });
  }

  /**
   * Build command line arguments
   * Enhanced with support for:
   * - JSON schema for structured outputs
   * - Tool restrictions
   * - System prompt injection
   * - Fallback model
   * - Session persistence control
   */
  buildArgs(prompt, options = {}) {
    const args = [];

    // Print mode (non-interactive, outputs to stdout)
    args.push('--print');

    // Add the prompt
    args.push('-p', prompt);

    // Output format - try JSON for structured parsing
    if (options.outputFormat !== 'text') {
      args.push('--output-format', 'json');
    }

    // JSON Schema for structured output validation (eliminates regex parsing!)
    if (options.jsonSchema) {
      const schemaStr = typeof options.jsonSchema === 'string'
        ? options.jsonSchema
        : JSON.stringify(options.jsonSchema);
      args.push('--json-schema', schemaStr);
    }

    // Continue previous session
    if (this.sessionId && options.newSession !== true) {
      args.push('--resume', this.sessionId);
    }

    // Skip permission prompts for autonomous operation
    if (this.options.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Model override if specified (per-call or default)
    const model = options.model || this.options.model;
    if (model) {
      args.push('--model', model);
    }

    // Fallback model for reliability
    const fallbackModel = options.fallbackModel || this.options.fallbackModel;
    if (fallbackModel && !options._usingFallback) {
      args.push('--fallback-model', fallbackModel);
    }

    // Max turns if specified
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    // Tool restrictions - limit available tools for specialized agents
    if (options.tools) {
      const toolsStr = Array.isArray(options.tools) ? options.tools.join(',') : options.tools;
      args.push('--tools', toolsStr);
    }

    // Allowed/disallowed tools for fine-grained control
    if (options.allowedTools) {
      const toolsStr = Array.isArray(options.allowedTools) ? options.allowedTools.join(' ') : options.allowedTools;
      args.push('--allowed-tools', toolsStr);
    }
    if (options.disallowedTools) {
      const toolsStr = Array.isArray(options.disallowedTools) ? options.disallowedTools.join(' ') : options.disallowedTools;
      args.push('--disallowed-tools', toolsStr);
    }

    // System prompt options
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }
    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }

    // Session persistence control
    if (options.noSessionPersistence || this.options.noSessionPersistence) {
      args.push('--no-session-persistence');
    }

    return args;
  }

  /**
   * Parse Claude Code output
   * Enhanced to extract structured_output from JSON schema responses
   */
  parseOutput(output, originalPrompt) {
    // Try to parse as JSON first
    try {
      // Claude Code JSON output format
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Extract session ID if present
        if (parsed.session_id) {
          this.sessionId = parsed.session_id;
        }

        // Build the result object
        const result = {
          response: parsed.result || parsed.response || parsed.content || output,
          sessionId: this.sessionId,
          costUsd: parsed.total_cost_usd || parsed.cost_usd,
          duration: parsed.duration_ms,
          durationApi: parsed.duration_api_ms,
          numTurns: parsed.num_turns,
          tokensIn: parsed.usage?.input_tokens,
          tokensOut: parsed.usage?.output_tokens,
          cacheRead: parsed.usage?.cache_read_input_tokens,
          cacheCreation: parsed.usage?.cache_creation_input_tokens,
          raw: parsed,
        };

        // Extract structured output if JSON schema was used
        // This eliminates the need for regex parsing!
        if (parsed.structured_output) {
          result.structuredOutput = parsed.structured_output;
        }

        // Extract model usage breakdown
        if (parsed.modelUsage) {
          result.modelUsage = parsed.modelUsage;
        }

        // Note any permission denials
        if (parsed.permission_denials?.length > 0) {
          result.permissionDenials = parsed.permission_denials;
        }

        return result;
      }
    } catch (e) {
      // JSON parsing failed, continue with text parsing
    }

    // Parse text output - look for session ID pattern
    const sessionMatch = output.match(/session[_-]?id[:\s]+([a-zA-Z0-9-]+)/i);
    if (sessionMatch) {
      this.sessionId = sessionMatch[1];
    }

    // Clean up the output
    let response = output.trim();

    // Remove common CLI artifacts
    response = response
      .replace(/^╭─.*─╮$/gm, '')
      .replace(/^│.*│$/gm, '')
      .replace(/^╰─.*─╯$/gm, '')
      .replace(/^\s*claude\s*$/gm, '')
      .trim();

    return {
      response,
      sessionId: this.sessionId,
      raw: output,
    };
  }

  /**
   * Start a new conversation session
   */
  async startSession(systemContext, initialPrompt) {
    // Reset session
    this.sessionId = null;
    this.conversationHistory = [];

    // Combine system context with initial prompt
    const fullPrompt = systemContext
      ? `${systemContext}\n\n---\n\n${initialPrompt}`
      : initialPrompt;

    const result = await this.sendPrompt(fullPrompt, { newSession: true });

    return result;
  }

  /**
   * Continue the current conversation
   */
  async continueConversation(prompt, options = {}) {
    if (!this.sessionId) {
      throw new Error('No active session. Call startSession first.');
    }

    return this.sendPrompt(prompt, options);
  }

  /**
   * Send a follow-up without explicit prompt (let Claude continue)
   */
  async continueWorking() {
    return this.continueConversation(
      'Continue working on the task. Execute the next step and report what you did.'
    );
  }

  /**
   * Inject a correction prompt
   */
  async injectCorrection(correctionPrompt) {
    return this.continueConversation(correctionPrompt);
  }

  /**
   * Request a progress report
   */
  async requestProgressReport() {
    return this.continueConversation(
      'Provide a brief progress update: What percentage complete? What did you just do? What will you do next? Then continue working.'
    );
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Get current session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Check if a session is active
   */
  hasActiveSession() {
    return this.sessionId !== null;
  }

  /**
   * Reset the client state
   */
  reset() {
    this.sessionId = null;
    this.conversationHistory = [];
    this.isRunning = false;
  }

  /**
   * Get metrics about client usage
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.cacheHitTokens + this.metrics.cacheMissTokens > 0
        ? (this.metrics.cacheHitTokens / (this.metrics.cacheHitTokens + this.metrics.cacheMissTokens) * 100).toFixed(1) + '%'
        : 'N/A',
    };
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
      cacheHitTokens: 0,
      cacheMissTokens: 0,
    };
  }

  /**
   * Create a specialized client for supervisor operations
   * Read-only tools, no session persistence, faster model
   */
  static createSupervisorClient(options = {}) {
    return new ClaudeCodeClient({
      ...options,
      model: options.model || 'sonnet',
      fallbackModel: options.fallbackModel || 'haiku',
      noSessionPersistence: true,
      maxRetries: 2, // Fewer retries for faster failure
    });
  }

  /**
   * Create a specialized client for planner operations
   * Full tools, session persistence for context
   */
  static createPlannerClient(options = {}) {
    return new ClaudeCodeClient({
      ...options,
      model: options.model || 'opus',
      fallbackModel: options.fallbackModel || 'sonnet',
      maxRetries: 3,
    });
  }

  /**
   * Create a specialized client for worker/coder operations
   * Full tools, session persistence, longer timeouts
   */
  static createWorkerClient(options = {}) {
    return new ClaudeCodeClient({
      ...options,
      model: options.model || 'opus',
      fallbackModel: options.fallbackModel || 'sonnet',
      timeout: options.timeout || 15 * 60 * 1000, // 15 minutes for complex work
      maxRetries: 3,
    });
  }
}

export default ClaudeCodeClient;
