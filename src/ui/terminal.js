/**
 * Terminal utilities for fancy CLI output
 * Handles colors, cursor control, and Unicode rendering
 */

// ANSI escape codes
export const ESC = '\x1b';
export const CSI = `${ESC}[`;

// Cursor control
export const cursor = {
  hide: () => process.stdout.write(`${CSI}?25l`),
  show: () => process.stdout.write(`${CSI}?25h`),
  save: () => process.stdout.write(`${CSI}s`),
  restore: () => process.stdout.write(`${CSI}u`),
  up: (n = 1) => process.stdout.write(`${CSI}${n}A`),
  down: (n = 1) => process.stdout.write(`${CSI}${n}B`),
  forward: (n = 1) => process.stdout.write(`${CSI}${n}C`),
  back: (n = 1) => process.stdout.write(`${CSI}${n}D`),
  moveTo: (x, y) => process.stdout.write(`${CSI}${y};${x}H`),
  moveToColumn: (x) => process.stdout.write(`${CSI}${x}G`),
};

// Screen control
export const screen = {
  clear: () => process.stdout.write(`${CSI}2J${CSI}H`),
  clearLine: () => process.stdout.write(`${CSI}2K`),
  clearDown: () => process.stdout.write(`${CSI}J`),
  clearUp: () => process.stdout.write(`${CSI}1J`),
  width: () => process.stdout.columns || 80,
  height: () => process.stdout.rows || 24,
};

// 256-color support
export const color = {
  // Foreground
  fg: (code) => `${CSI}38;5;${code}m`,
  // Background
  bg: (code) => `${CSI}48;5;${code}m`,
  // RGB (true color)
  rgb: (r, g, b) => `${CSI}38;2;${r};${g};${b}m`,
  bgRgb: (r, g, b) => `${CSI}48;2;${r};${g};${b}m`,
  // Reset
  reset: `${CSI}0m`,
};

// Style codes
export const style = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  blink: `${CSI}5m`,
  inverse: `${CSI}7m`,
  hidden: `${CSI}8m`,
  strikethrough: `${CSI}9m`,
};

// Named colors (256-color palette)
export const colors = {
  // Grayscale
  black: color.fg(0),
  white: color.fg(15),
  gray: color.fg(245),
  darkGray: color.fg(238),
  lightGray: color.fg(250),

  // Basic colors
  red: color.fg(196),
  green: color.fg(46),
  yellow: color.fg(226),
  blue: color.fg(33),
  magenta: color.fg(201),
  cyan: color.fg(51),
  orange: color.fg(208),
  pink: color.fg(213),
  purple: color.fg(129),

  // Soft/muted variants
  softRed: color.fg(167),
  softGreen: color.fg(114),
  softYellow: color.fg(222),
  softBlue: color.fg(74),
  softCyan: color.fg(80),
  softPurple: color.fg(140),

  // Backgrounds
  bgRed: color.bg(196),
  bgGreen: color.bg(46),
  bgYellow: color.bg(226),
  bgBlue: color.bg(33),
  bgCyan: color.bg(51),
  bgOrange: color.bg(208),
  bgGray: color.bg(238),
  bgDarkGray: color.bg(235),
  bgLightGray: color.bg(248),
};

// Gradient generators
export const gradient = {
  // Progress gradient: red -> yellow -> green
  progress: (percent) => {
    if (percent < 50) {
      const r = 255;
      const g = Math.round((percent / 50) * 255);
      return color.rgb(r, g, 0);
    } else {
      const r = Math.round(((100 - percent) / 50) * 255);
      const g = 255;
      return color.rgb(r, g, 0);
    }
  },

  // Score gradient: red -> yellow -> green (for 0-100 scores)
  score: (score) => gradient.progress(score),

  // Time gradient: green -> yellow -> red (inverted for remaining time)
  timeRemaining: (percentRemaining) => gradient.progress(percentRemaining),

  // Rainbow gradient
  rainbow: (position, total) => {
    const hue = (position / total) * 360;
    return hslToRgb(hue, 100, 50);
  },

  // Cyan to purple gradient
  cool: (percent) => {
    const r = Math.round((percent / 100) * 128);
    const g = Math.round(200 - (percent / 100) * 100);
    const b = Math.round(255 - (percent / 100) * 55);
    return color.rgb(r, g, b);
  },
};

// HSL to RGB helper
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;

  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return color.rgb(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}

// Box drawing characters
export const box = {
  // Rounded corners
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
  // Sharp corners
  sharp: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  // Double line
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  // Heavy
  heavy: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
  },
};

// Progress bar characters
export const progressChars = {
  // Standard blocks
  blocks: {
    full: '█',
    seven: '▉',
    six: '▊',
    five: '▋',
    four: '▌',
    three: '▍',
    two: '▎',
    one: '▏',
    empty: '░',
  },
  // Braille (smoother)
  braille: ['⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿'],
  // Simple
  simple: {
    full: '■',
    empty: '□',
  },
  // Dots
  dots: {
    full: '●',
    empty: '○',
  },
};

// Sparkline characters (for mini-charts)
export const sparkline = {
  bars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  dots: ['⠀', '⢀', '⢠', '⢰', '⢸', '⣸', '⣾', '⣿'],
};

// Status icons
export const icons = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',
  running: '◉',
  complete: '●',
  arrow: '→',
  arrowRight: '▶',
  arrowDown: '▼',
  star: '★',
  dot: '•',
  ellipsis: '…',
  check: '✓',
  cross: '✗',
  play: '▶',
  pause: '⏸',
  stop: '⏹',
  clock: '⏱',
  fire: '🔥',
  rocket: '🚀',
  gear: '⚙',
  brain: '🧠',
  target: '🎯',
  chart: '📊',
  lightning: '⚡',
  sparkles: '✨',
};

// Spinner frames
export const spinners = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots2: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  line: ['-', '\\', '|', '/'],
  circle: ['◐', '◓', '◑', '◒'],
  square: ['◰', '◳', '◲', '◱'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  pulse: ['█', '▓', '▒', '░', '▒', '▓'],
  arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  grow: ['▁', '▃', '▄', '▅', '▆', '▇', '▆', '▅', '▄', '▃'],
  brain: ['🧠', '🧠', '💭', '💡', '✨', '🧠'],
};

// Helper to strip ANSI codes for length calculation
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Helper to pad string accounting for ANSI codes
export function padEnd(str, length, char = ' ') {
  const visibleLength = stripAnsi(str).length;
  const padding = Math.max(0, length - visibleLength);
  return str + char.repeat(padding);
}

export function padStart(str, length, char = ' ') {
  const visibleLength = stripAnsi(str).length;
  const padding = Math.max(0, length - visibleLength);
  return char.repeat(padding) + str;
}

export function center(str, length, char = ' ') {
  const visibleLength = stripAnsi(str).length;
  const totalPadding = Math.max(0, length - visibleLength);
  const leftPad = Math.floor(totalPadding / 2);
  const rightPad = totalPadding - leftPad;
  return char.repeat(leftPad) + str + char.repeat(rightPad);
}

// Truncate with ellipsis
export function truncate(str, maxLength) {
  const visible = stripAnsi(str);
  if (visible.length <= maxLength) return str;
  return visible.substring(0, maxLength - 1) + '…';
}
