/**
 * argument-parser.js - CLI argument parsing and validation for claude-auto
 *
 * Handles:
 * - Argument parsing with parseArgs
 * - Validation of required arguments
 * - Help text generation
 * - Pre-processing of special args (like --resume without value)
 */

import { parseArgs } from 'util';
import { colors, style, icons } from './ui/terminal.js';

export const VERSION = '1.0.0';

/** CLI options configuration for parseArgs */
export const CLI_OPTIONS = {
  goal: { type: 'string', short: 'g' },
  'sub-goal': { type: 'string', short: 's', multiple: true },
  'time-limit': { type: 'string', short: 't', default: '2h' },
  directory: { type: 'string', short: 'd', default: process.cwd() },
  context: { type: 'string', short: 'c' },
  verbose: { type: 'boolean', short: 'v', default: false },
  quiet: { type: 'boolean', short: 'q', default: false },
  json: { type: 'boolean', short: 'j', default: false },
  retry: { type: 'boolean', short: 'r', default: false },
  'max-retries': { type: 'string', default: '100' },
  resume: { type: 'string', short: 'R' },
  'list-sessions': { type: 'boolean', default: false },
  'state-dir': { type: 'string', default: '.claude-runner' },
  ui: { type: 'boolean', default: false },
  'ui-port': { type: 'string', default: '3000' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', default: false },
  docker: { type: 'boolean', default: false },
};

/** Generate help text */
export function generateHelpText() {
  return `
${colors.cyan}${style.bold}◆ CLAUDE AUTONOMOUS RUNNER${style.reset} v${VERSION}
${colors.gray}Run Claude in continuous autonomous mode using your Claude Max subscription.${style.reset}

${colors.white}${style.bold}USAGE:${style.reset}
  ${colors.cyan}claude-auto${style.reset} [options] "Your primary goal"
  ${colors.cyan}claude-auto${style.reset} --goal "Primary goal" --sub-goal "Sub goal 1" --sub-goal "Sub goal 2"

${colors.white}${style.bold}OPTIONS:${style.reset}
  ${colors.green}-g, --goal${style.reset} <text>        Primary goal (can also be passed as positional argument)
  ${colors.green}-s, --sub-goal${style.reset} <text>    Sub-goal (can be specified multiple times)
  ${colors.green}-t, --time-limit${style.reset} <time>  Time limit (e.g., "30m", "2h", "24h") [default: 2h]
  ${colors.green}-d, --directory${style.reset} <path>   Working directory [default: current directory]
  ${colors.green}-c, --context${style.reset} <text>     Additional context for the task
  ${colors.green}-v, --verbose${style.reset}            Enable verbose logging (shows Claude's full output)
  ${colors.green}-q, --quiet${style.reset}              Minimal output (only errors and final report)
  ${colors.green}-j, --json${style.reset}               Output progress as JSON
  ${colors.green}-r, --retry${style.reset}              Enable retry loop (continues until HIGH confidence)
  ${colors.green}--max-retries${style.reset} <n>        Maximum retry attempts [default: 100]
  ${colors.green}-R, --resume${style.reset} [id]        Resume a previous session (shows selection if no ID given)
  ${colors.green}--list-sessions${style.reset}          List all available sessions
  ${colors.green}--state-dir${style.reset} <path>       Directory for session state [default: .claude-runner]
  ${colors.green}--ui${style.reset}                     Enable web UI for visualization (default port: 3000)
  ${colors.green}--ui-port${style.reset} <port>         Port for web UI [default: 3000]
  ${colors.green}-h, --help${style.reset}               Show this help message
  ${colors.green}--version${style.reset}                Show version number
  ${colors.green}--docker${style.reset}                 Run inside the claude docker container

${colors.white}${style.bold}EXAMPLES:${style.reset}
  ${colors.cyan}claude-auto${style.reset} "Implement a REST API"                    ${colors.gray}# Simple goal${style.reset}
  ${colors.cyan}claude-auto${style.reset} -g "Build app" -s "Step 1" -s "Step 2" -t 4h  ${colors.gray}# Multi-step${style.reset}
  ${colors.cyan}claude-auto${style.reset} "Fix tests" -c "Focus on auth module" -t 1h  ${colors.gray}# With context${style.reset}
  ${colors.cyan}claude-auto${style.reset} --docker "Build a REST API"              ${colors.gray}# Docker mode${style.reset}
  ${colors.cyan}claude-auto${style.reset} -r --max-retries 5 -t 4h "Build API"     ${colors.gray}# Retry mode${style.reset}
  ${colors.cyan}claude-auto${style.reset} --ui "Build a REST API"                  ${colors.gray}# With web UI${style.reset}
  ${colors.cyan}claude-auto${style.reset} --resume                                 ${colors.gray}# Resume session${style.reset}
  ${colors.cyan}claude-auto${style.reset} --list-sessions                          ${colors.gray}# List sessions${style.reset}

${colors.white}${style.bold}REQUIREMENTS:${style.reset}
  ${icons.arrow} Claude Code CLI must be installed and authenticated
  ${icons.arrow} Run 'claude' once to authenticate if needed
  ${icons.arrow} Your Max subscription will be used for API calls

${colors.white}${style.bold}BEHAVIOR:${style.reset}
  ${icons.brain} Claude works autonomously toward the goal
  ${icons.chart} Progress is tracked and reported periodically
  ${icons.target} Auto-correction activates if Claude drifts off-topic
  ${icons.clock} Execution stops when goal achieved or time expires
`;
}

/**
 * Pre-process args to handle --resume without a value
 * parseArgs doesn't support optional string values
 * @param {string[]} args - Raw command line arguments
 * @returns {{ args: string[], resumeNeedsSelection: boolean }}
 */
export function preprocessArgs(args) {
  const rawArgs = [...args];
  const resumeIndex = rawArgs.findIndex(arg => arg === '--resume' || arg === '-R');
  let resumeNeedsSelection = false;

  if (resumeIndex !== -1) {
    const nextArg = rawArgs[resumeIndex + 1];
    // If --resume is last arg, or next arg starts with -, we need interactive selection
    if (!nextArg || nextArg.startsWith('-')) {
      resumeNeedsSelection = true;
      // Insert a placeholder so parseArgs doesn't fail
      rawArgs.splice(resumeIndex + 1, 0, '__SELECT__');
    }
  }

  return { args: rawArgs, resumeNeedsSelection };
}

/**
 * Parse CLI arguments
 * @param {string[]} args - Command line arguments (process.argv.slice(2))
 * @returns {{ values: object, positionals: string[], resumeNeedsSelection: boolean }}
 */
export function parseCliArgs(args) {
  const { args: processedArgs, resumeNeedsSelection } = preprocessArgs(args);

  const { values, positionals } = parseArgs({
    args: processedArgs,
    options: CLI_OPTIONS,
    allowPositionals: true,
  });

  // Mark if we need interactive selection
  if (resumeNeedsSelection || values.resume === '__SELECT__') {
    values.resume = '__SELECT__';
  }

  return { values, positionals, resumeNeedsSelection };
}

/**
 * Validate parsed arguments and return errors if any
 * @param {object} values - Parsed values from parseArgs
 * @param {string[]} positionals - Positional arguments
 * @param {string|null} resumedGoal - Goal from resumed session (if any)
 * @returns {{ valid: boolean, errors: string[], primaryGoal: string|null }}
 */
export function validateArgs(values, positionals, resumedGoal = null) {
  const errors = [];

  // Determine primary goal
  const primaryGoal = resumedGoal || values.goal || positionals[0];

  // Skip goal validation for special commands
  if (values.help || values.version || values['list-sessions'] || values.docker) {
    return { valid: true, errors: [], primaryGoal };
  }

  // Goal is required unless resuming
  if (!primaryGoal && values.resume === undefined) {
    errors.push('Missing required argument: goal');
  }

  // Validate max-retries is a number
  if (values['max-retries'] && isNaN(parseInt(values['max-retries'], 10))) {
    errors.push('--max-retries must be a number');
  }

  // Validate ui-port is a number
  if (values['ui-port'] && isNaN(parseInt(values['ui-port'], 10))) {
    errors.push('--ui-port must be a number');
  }

  // Validate conflicting options
  if (values.verbose && values.quiet) {
    errors.push('Cannot use both --verbose and --quiet');
  }

  if (values.verbose && values.json) {
    errors.push('Cannot use both --verbose and --json');
  }

  if (values.quiet && values.json) {
    errors.push('Cannot use both --quiet and --json');
  }

  return {
    valid: errors.length === 0,
    errors,
    primaryGoal,
  };
}

/**
 * Get output mode based on flags
 * @param {object} values - Parsed values
 * @returns {'verbose'|'quiet'|'json'|'dashboard'}
 */
export function getOutputMode(values) {
  if (values.verbose) return 'verbose';
  if (values.quiet) return 'quiet';
  if (values.json) return 'json';
  return 'dashboard';
}

/**
 * Parse time limit string to milliseconds
 * @param {string} timeStr - Time string like "30m", "2h", "1d"
 * @returns {number} Milliseconds
 */
export function parseTimeLimit(timeStr) {
  const match = timeStr.match(/^(\d+)(m|h|d)$/i);
  if (!match) {
    // Default to parsing as hours for backwards compatibility
    const hours = parseFloat(timeStr);
    if (!isNaN(hours)) return hours * 60 * 60 * 1000;
    return 2 * 60 * 60 * 1000; // Default 2 hours
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 2 * 60 * 60 * 1000;
  }
}

export default {
  VERSION,
  CLI_OPTIONS,
  generateHelpText,
  preprocessArgs,
  parseCliArgs,
  validateArgs,
  getOutputMode,
  parseTimeLimit,
};
