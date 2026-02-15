/**
 * Terminal UI Utilities - Shared text formatting and helper functions
 */

// Platform detection - used for Windows-specific rendering fixes
export const IS_WINDOWS = process.platform === 'win32';

// Status icons and colors (ASCII only for terminal compatibility)
export const STATUS_STYLES = {
  pending: { icon: 'o', fg: IS_WINDOWS ? 'white' : 'gray' },
  in_progress: { icon: '*', fg: 'yellow' },
  completed: { icon: '+', fg: 'green' },
  failed: { icon: 'x', fg: 'red' },
  blocked: { icon: '-', fg: 'magenta' },
  next: { icon: '>', fg: 'cyan' }
};

// Phase display names
export const PHASE_NAMES = {
  planning: 'Planning',
  plan_review: 'Review',
  execution: 'Executing',
  verification: 'Verifying'
};

// Spinner frames for busy animation (braille dots - smooth spinning effect)
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Truncate text to specified width with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} width - Maximum width
 * @returns {string} Truncated text
 */
export function truncate(text, width) {
  if (!text || width <= 0) return '';
  const clean = sanitizeText(text);
  if (clean.length <= width) return clean;
  return clean.substring(0, width - 3) + '...';
}

/**
 * Wrap text to specified width
 * @param {string} text - Text to wrap
 * @param {number} width - Maximum width per line
 * @returns {string[]} Array of wrapped lines
 */
export function wrapText(text, width) {
  if (!text) return [];
  const clean = sanitizeText(text);
  const lines = [];
  const paragraphs = clean.split('\n');

  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
    } else {
      let remaining = para;
      while (remaining.length > width) {
        let breakPoint = remaining.lastIndexOf(' ', width);
        if (breakPoint === -1) breakPoint = width;
        lines.push(remaining.substring(0, breakPoint));
        remaining = remaining.substring(breakPoint).trim();
      }
      if (remaining) lines.push(remaining);
    }
  }
  return lines;
}

/**
 * Sanitize text by removing ANSI codes and control characters
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * Escape curly braces for blessed tag parsing
 * Converts { to {open} and } to {close} so blessed doesn't interpret them as tags
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeBlessedTags(text) {
  if (!text) return '';
  // Use a single-pass replacement to avoid corrupting escape sequences
  // We use placeholder tokens, then convert them
  return text.replace(/[{}]/g, (match) => {
    return match === '{' ? '{open}' : '{close}';
  });
}

/**
 * Sanitize and escape text for safe blessed rendering
 * @param {string} text - Text to sanitize and escape
 * @returns {string} Safe text for blessed
 */
export function sanitizeForBlessed(text) {
  if (!text) return '';
  return escapeBlessedTags(sanitizeText(text));
}

/**
 * Strip blessed tags from text for accurate width calculation
 * @param {string} text - Text with blessed tags
 * @returns {string} Text without tags
 */
export function stripTags(text) {
  if (!text) return '';
  return text.replace(/\{[^}]+\}/g, '');
}

/**
 * Truncate text while trying to preserve tags (simplified version)
 * @param {string} text - Text with blessed tags
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated text
 */
export function truncateWithTags(text, maxLen) {
  if (!text) return '';
  const stripped = stripTags(text);
  if (stripped.length <= maxLen) return text;
  // Simple approach: strip tags and truncate
  return stripped.substring(0, maxLen);
}

/**
 * Format a timestamp as HH:MM:SS
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format duration in human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/**
 * Escape special regex characters
 * @param {string} string - String to escape
 * @returns {string} Escaped string
 */
export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get color for an agent
 * @param {string} agentName - Name of the agent
 * @returns {string} Color name
 */
export function getAgentColor(agentName) {
  const colors = ['cyan', 'green', 'yellow', 'magenta', 'blue'];
  const agents = ['planner', 'coder', 'tester', 'supervisor', 'core'];
  const idx = agents.indexOf(agentName);
  return idx >= 0 ? colors[idx] : 'white';
}

/**
 * Get content width of a widget
 * @param {object} widget - Blessed widget
 * @returns {number} Content width
 */
export function getContentWidth(widget) {
  const width = (widget && widget.width) ? widget.width : 80;
  return Math.max(10, width - 3);
}

/**
 * Highlight search terms in text
 * @param {string} text - Text to highlight
 * @param {string} searchQuery - Search query
 * @returns {string} Text with highlighted terms
 */
export function highlightSearchTerms(text, searchQuery) {
  if (!searchQuery || !text) return text;

  const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  let result = text;

  for (const term of terms) {
    // Case-insensitive replacement with highlight
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    result = result.replace(regex, '{bold}{yellow-bg}$1{/yellow-bg}{/bold}');
  }

  return result;
}

/**
 * Create a dynamic-width box top line: ┌─ Label ────────
 * @param {string} label - The label text
 * @param {number} width - Total character width
 * @param {string} color - Blessed color name
 * @returns {string} Formatted box top line with blessed tags
 */
export function makeBoxTop(label, width, color) {
  const prefix = `\u250C\u2500 ${label} `;
  const fill = Math.max(1, width - prefix.length);
  return `{${color}-fg}${prefix}${'\u2500'.repeat(fill)}{/${color}-fg}`;
}

/**
 * Create a dynamic-width box bottom line: └────────────────
 * @param {number} width - Total character width
 * @param {string} color - Blessed color name
 * @returns {string} Formatted box bottom line with blessed tags
 */
export function makeBoxBottom(width, color) {
  return `{${color}-fg}\u2514${'\u2500'.repeat(Math.max(1, width - 1))}{/${color}-fg}`;
}
