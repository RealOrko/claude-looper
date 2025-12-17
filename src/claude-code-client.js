/**
 * Claude Code CLI subprocess wrapper
 * Allows programmatic interaction with Claude Code using Max subscription
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Memory limits
const MAX_CONVERSATION_HISTORY = 100; // Keep last 100 messages (50 exchanges)

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
    };

    this.sessionId = null;
    this.conversationHistory = [];
    this.isRunning = false;
  }

  /**
   * Send a prompt to Claude Code and get the response
   */
  async sendPrompt(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(prompt, options);

      if (this.options.verbose) {
        console.log(`[ClaudeCodeClient] Running: claude ${args.join(' ')}`);
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
        reject(new Error(`Claude Code timed out after ${this.options.timeout}ms`));
      }, options.timeout || this.options.timeout);

      proc.on('close', () => clearTimeout(timeoutId));
    });
  }

  /**
   * Build command line arguments
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

    // Max turns if specified
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    return args;
  }

  /**
   * Parse Claude Code output
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

        return {
          response: parsed.result || parsed.response || parsed.content || output,
          sessionId: this.sessionId,
          costUsd: parsed.cost_usd,
          duration: parsed.duration_ms,
          tokensIn: parsed.input_tokens,
          tokensOut: parsed.output_tokens,
          raw: parsed,
        };
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
}

export default ClaudeCodeClient;
