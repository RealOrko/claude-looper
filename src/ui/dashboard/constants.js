/**
 * Dashboard Constants - Shared constants and configuration
 */

import { colors, style } from '../terminal.js';

// Memory limits
export const MAX_SCORE_HISTORY = 50;
export const MAX_MESSAGES = 100;

// ASCII art logo
export const LOGO = `
   ██████╗ ██╗      █████╗ ██╗   ██╗ ██████╗  ███████╗
  ██╔════╝ ██║     ██╔══██╗██║   ██║ ██╔══██╗ ██╔════╝
  ██║      ██║     ███████║██║   ██║ ██║  ██║ █████╗
  ██║      ██║     ██╔══██║██║   ██║ ██║  ██║ ██╔══╝
  ╚██████╗ ███████╗██║  ██║╚██████╔╝ ██████╔╝ ███████╗
   ╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝  ╚══════╝
        ${colors.gray}A U T O N O M O U S   R U N N E R${style.reset}`;

// Compact header logo
export const MINI_LOGO = `${colors.cyan}${style.bold}◆ CLAUDE${style.reset} ${colors.gray}AUTONOMOUS${style.reset}`;

// Status color mappings
export const STATUS_COLORS = {
  completed: 'green',
  time_expired: 'yellow',
  stopped: 'orange',
  aborted: 'red',
};

// Log type color mappings
export const LOG_TYPE_COLORS = {
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  dim: 'gray',
  reset: 'reset',
};

export default {
  MAX_SCORE_HISTORY,
  MAX_MESSAGES,
  LOGO,
  MINI_LOGO,
  STATUS_COLORS,
  LOG_TYPE_COLORS,
};
