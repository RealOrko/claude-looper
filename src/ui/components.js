/**
 * UI Components - Spinners, progress bars, boxes, sparklines
 */

import {
  color, colors, style, gradient, box, progressChars,
  sparkline as sparkChars, icons, spinners, cursor, screen,
  stripAnsi, padEnd, padStart, center, truncate
} from './terminal.js';

/**
 * Animated Spinner
 */
export class Spinner {
  constructor(options = {}) {
    this.frames = options.frames || spinners.dots;
    this.interval = options.interval || 80;
    this.color = options.color || colors.cyan;
    this.text = options.text || '';
    this.frame = 0;
    this.timer = null;
    this.stream = process.stdout;
  }

  start(text) {
    if (text) this.text = text;
    cursor.hide();
    this.timer = setInterval(() => this.render(), this.interval);
    return this;
  }

  stop(finalText, icon = icons.success) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    screen.clearLine();
    cursor.moveToColumn(1);
    if (finalText) {
      this.stream.write(`${colors.green}${icon}${style.reset} ${finalText}\n`);
    }
    cursor.show();
    return this;
  }

  fail(text) {
    this.stop(text, icons.error);
  }

  update(text) {
    this.text = text;
    return this;
  }

  render() {
    const frame = this.frames[this.frame % this.frames.length];
    screen.clearLine();
    cursor.moveToColumn(1);
    this.stream.write(`${this.color}${frame}${style.reset} ${this.text}`);
    this.frame++;
  }
}

/**
 * Progress Bar with gradient coloring
 */
export class ProgressBar {
  constructor(options = {}) {
    this.width = options.width || 40;
    this.complete = options.complete || progressChars.blocks.full;
    this.incomplete = options.incomplete || progressChars.blocks.empty;
    this.useGradient = options.gradient !== false;
    this.showPercent = options.showPercent !== false;
    this.showEta = options.showEta || false;
    this.startTime = null;
  }

  render(percent, label = '') {
    if (!this.startTime) this.startTime = Date.now();

    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * this.width);
    const empty = this.width - filled;

    // Build the bar with gradient coloring
    let bar = '';
    if (this.useGradient && filled > 0) {
      for (let i = 0; i < filled; i++) {
        const segmentPercent = (i / this.width) * 100;
        bar += `${gradient.progress(segmentPercent)}${this.complete}`;
      }
      bar += style.reset;
    } else {
      bar = `${colors.green}${this.complete.repeat(filled)}${style.reset}`;
    }
    bar += `${colors.darkGray}${this.incomplete.repeat(empty)}${style.reset}`;

    // Add percentage
    let suffix = '';
    if (this.showPercent) {
      const percentColor = gradient.progress(clamped);
      suffix = ` ${percentColor}${clamped.toString().padStart(3)}%${style.reset}`;
    }

    // Add ETA
    if (this.showEta && clamped > 0 && clamped < 100) {
      const elapsed = Date.now() - this.startTime;
      const rate = clamped / elapsed;
      const remaining = (100 - clamped) / rate;
      const eta = formatDuration(remaining);
      suffix += ` ${colors.gray}ETA: ${eta}${style.reset}`;
    }

    // Add label
    const prefix = label ? `${label} ` : '';

    return `${prefix}${bar}${suffix}`;
  }

  // Render a static bar (for inline use)
  static inline(percent, width = 20) {
    const bar = new ProgressBar({ width, showPercent: false });
    return bar.render(percent);
  }
}

/**
 * Sparkline - mini chart for data series
 */
export class Sparkline {
  constructor(options = {}) {
    this.chars = options.chars || sparkChars.bars;
    this.min = options.min;
    this.max = options.max;
    this.color = options.color || null; // Use gradient if null
  }

  render(data) {
    if (!data || data.length === 0) return '';

    const min = this.min ?? Math.min(...data);
    const max = this.max ?? Math.max(...data);
    const range = max - min || 1;

    return data.map((value, i) => {
      const normalized = (value - min) / range;
      const charIndex = Math.min(
        this.chars.length - 1,
        Math.floor(normalized * this.chars.length)
      );
      const char = this.chars[charIndex];

      if (this.color) {
        return `${this.color}${char}${style.reset}`;
      } else {
        // Use gradient based on value
        return `${gradient.score(normalized * 100)}${char}${style.reset}`;
      }
    }).join('');
  }

  // Static helper for quick sparklines
  static render(data, options = {}) {
    return new Sparkline(options).render(data);
  }
}

/**
 * Box - draw bordered boxes
 */
export class Box {
  constructor(options = {}) {
    this.style = options.style || 'rounded';
    this.padding = options.padding ?? 1;
    this.borderColor = options.borderColor || colors.cyan;
    this.titleColor = options.titleColor || colors.white;
    this.chars = box[this.style] || box.rounded;
  }

  render(content, options = {}) {
    const width = options.width || screen.width() - 4;
    const title = options.title || '';
    const lines = content.split('\n');

    const innerWidth = width - 2 - (this.padding * 2);
    const paddingStr = ' '.repeat(this.padding);

    // Wrap lines to fit within box
    const wrappedLines = [];
    for (const line of lines) {
      const plainLine = stripAnsi(line);
      if (plainLine.length > innerWidth) {
        // Word-wrap long lines
        const words = plainLine.split(' ');
        let currentLine = '';
        for (const word of words) {
          if (currentLine.length === 0) {
            currentLine = word;
          } else if (currentLine.length + 1 + word.length <= innerWidth) {
            currentLine += ' ' + word;
          } else {
            wrappedLines.push(padEnd(currentLine, innerWidth));
            currentLine = word;
          }
        }
        if (currentLine.length > 0) {
          wrappedLines.push(padEnd(currentLine, innerWidth));
        }
      } else {
        wrappedLines.push(padEnd(line, innerWidth));
      }
    }

    // Build box
    const output = [];
    const c = this.chars;
    const bc = this.borderColor;

    // Top border with optional title
    if (title) {
      const titleText = ` ${title} `;
      const leftWidth = 2;
      const rightWidth = width - leftWidth - stripAnsi(titleText).length - 2;
      output.push(
        `${bc}${c.topLeft}${c.horizontal.repeat(leftWidth)}${style.reset}` +
        `${this.titleColor}${style.bold}${titleText}${style.reset}` +
        `${bc}${c.horizontal.repeat(Math.max(0, rightWidth))}${c.topRight}${style.reset}`
      );
    } else {
      output.push(`${bc}${c.topLeft}${c.horizontal.repeat(width - 2)}${c.topRight}${style.reset}`);
    }

    // Padding top
    for (let i = 0; i < this.padding; i++) {
      output.push(`${bc}${c.vertical}${style.reset}${' '.repeat(width - 2)}${bc}${c.vertical}${style.reset}`);
    }

    // Content lines
    for (const line of wrappedLines) {
      output.push(
        `${bc}${c.vertical}${style.reset}${paddingStr}${line}${paddingStr}${bc}${c.vertical}${style.reset}`
      );
    }

    // Padding bottom
    for (let i = 0; i < this.padding; i++) {
      output.push(`${bc}${c.vertical}${style.reset}${' '.repeat(width - 2)}${bc}${c.vertical}${style.reset}`);
    }

    // Bottom border
    output.push(`${bc}${c.bottomLeft}${c.horizontal.repeat(width - 2)}${c.bottomRight}${style.reset}`);

    return output.join('\n');
  }
}

/**
 * Status Badge - colored label
 */
export function badge(text, type = 'info') {
  const styles = {
    success: { bg: color.bg(34), fg: color.fg(255) },
    error: { bg: color.bg(160), fg: color.fg(255) },
    warning: { bg: color.bg(214), fg: color.fg(0) },
    info: { bg: color.bg(33), fg: color.fg(255) },
    pending: { bg: color.bg(240), fg: color.fg(255) },
    running: { bg: color.bg(39), fg: color.fg(255) },
  };

  const s = styles[type] || styles.info;
  return `${s.bg}${s.fg}${style.bold} ${text} ${style.reset}`;
}

/**
 * Table renderer
 */
export class Table {
  constructor(options = {}) {
    this.padding = options.padding ?? 1;
    this.headerColor = options.headerColor || colors.cyan;
    this.borderColor = options.borderColor || colors.darkGray;
  }

  render(headers, rows) {
    // Calculate column widths
    const widths = headers.map((h, i) => {
      const headerLen = stripAnsi(h).length;
      const maxRowLen = Math.max(...rows.map(r => stripAnsi(String(r[i] || '')).length));
      return Math.max(headerLen, maxRowLen);
    });

    const pad = ' '.repeat(this.padding);
    const output = [];

    // Header
    const headerRow = headers.map((h, i) =>
      `${this.headerColor}${style.bold}${padEnd(h, widths[i])}${style.reset}`
    ).join(`${pad}${this.borderColor}│${style.reset}${pad}`);
    output.push(`${pad}${headerRow}${pad}`);

    // Separator
    const separator = widths.map(w => '─'.repeat(w + this.padding * 2)).join('┼');
    output.push(`${this.borderColor}${separator}${style.reset}`);

    // Rows
    for (const row of rows) {
      const rowStr = row.map((cell, i) =>
        padEnd(String(cell || ''), widths[i])
      ).join(`${pad}${this.borderColor}│${style.reset}${pad}`);
      output.push(`${pad}${rowStr}${pad}`);
    }

    return output.join('\n');
  }
}

/**
 * Divider line
 */
export function divider(char = '─', width = null, color_ = colors.darkGray) {
  const w = width || screen.width();
  return `${color_}${char.repeat(w)}${style.reset}`;
}

/**
 * Section header
 */
export function sectionHeader(title, icon_ = null) {
  const iconStr = icon_ ? `${icon_}  ` : '';
  const text = `${iconStr}${title}`;
  const lineWidth = Math.max(0, screen.width() - stripAnsi(text).length - 4);
  return `${colors.cyan}${style.bold}${text}${style.reset} ${colors.darkGray}${'─'.repeat(lineWidth)}${style.reset}`;
}

/**
 * Key-value display
 */
export function keyValue(key, value, keyWidth = 20) {
  return `${colors.gray}${padEnd(key + ':', keyWidth)}${style.reset} ${value}`;
}

/**
 * Format duration in ms to human readable
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format a score with color
 */
export function formatScore(score, showBar = false) {
  const scoreColor = gradient.score(score);
  let result = `${scoreColor}${score}${style.reset}`;

  if (showBar) {
    const barWidth = 10;
    const filled = Math.round((score / 100) * barWidth);
    const bar = `${scoreColor}${'█'.repeat(filled)}${colors.darkGray}${'░'.repeat(barWidth - filled)}${style.reset}`;
    result = `${bar} ${result}`;
  }

  return result;
}

/**
 * Status indicator with icon
 */
export function statusIndicator(status) {
  const indicators = {
    success: `${colors.green}${icons.success}${style.reset}`,
    error: `${colors.red}${icons.error}${style.reset}`,
    warning: `${colors.yellow}${icons.warning}${style.reset}`,
    running: `${colors.cyan}${icons.running}${style.reset}`,
    pending: `${colors.gray}${icons.pending}${style.reset}`,
    complete: `${colors.green}${icons.complete}${style.reset}`,
  };
  return indicators[status] || indicators.pending;
}
