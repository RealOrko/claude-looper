/**
 * Tests for terminal-ui-utils.js - Shared text utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STATUS_STYLES,
  PHASE_NAMES,
  SPINNER_FRAMES,
  truncate,
  wrapText,
  sanitizeText,
  stripTags,
  truncateWithTags,
  formatTimestamp,
  formatDuration,
  escapeRegex,
  getAgentColor,
  getContentWidth,
  highlightSearchTerms
} from './terminal-ui-utils.js';

describe('terminal-ui-utils - Constants', () => {
  it('should export STATUS_STYLES with required statuses', () => {
    assert.ok(STATUS_STYLES.pending);
    assert.ok(STATUS_STYLES.in_progress);
    assert.ok(STATUS_STYLES.completed);
    assert.ok(STATUS_STYLES.failed);
    assert.ok(STATUS_STYLES.blocked);
    assert.ok(STATUS_STYLES.next);

    // Each status should have icon and fg
    for (const status of Object.values(STATUS_STYLES)) {
      assert.ok(status.icon);
      assert.ok(status.fg);
    }
  });

  it('should export PHASE_NAMES with required phases', () => {
    assert.ok(PHASE_NAMES.planning);
    assert.ok(PHASE_NAMES.plan_review);
    assert.ok(PHASE_NAMES.execution);
    assert.ok(PHASE_NAMES.verification);
  });

  it('should export SPINNER_FRAMES array', () => {
    assert.ok(Array.isArray(SPINNER_FRAMES));
    assert.ok(SPINNER_FRAMES.length > 0);
  });
});

describe('terminal-ui-utils - truncate', () => {
  it('should truncate text correctly', () => {
    const result = truncate('This is a long text that needs truncation', 20);
    assert.ok(result.length <= 20);
    assert.ok(result.endsWith('...'));
  });

  it('should not truncate short text', () => {
    const result = truncate('Short', 20);
    assert.strictEqual(result, 'Short');
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(truncate(null, 20), '');
    assert.strictEqual(truncate(undefined, 20), '');
    assert.strictEqual(truncate('', 20), '');
  });

  it('should handle negative/zero width', () => {
    const result = truncate('Test', 0);
    assert.strictEqual(result, '');
  });
});

describe('terminal-ui-utils - wrapText', () => {
  it('should wrap text correctly', () => {
    const text = 'This is a long line that should be wrapped at a reasonable width for display';
    const wrapped = wrapText(text, 30);
    assert.ok(wrapped.length > 1);
    for (const line of wrapped) {
      assert.ok(line.length <= 30);
    }
  });

  it('should handle null/undefined', () => {
    assert.deepStrictEqual(wrapText(null), []);
    assert.deepStrictEqual(wrapText(undefined), []);
    assert.deepStrictEqual(wrapText(''), []);
  });

  it('should preserve newlines as paragraph breaks', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const wrapped = wrapText(text, 100);
    assert.strictEqual(wrapped.length, 3);
  });
});

describe('terminal-ui-utils - sanitizeText', () => {
  it('should sanitize text with ANSI codes', () => {
    const input = '\x1b[31mRed text\x1b[0m with codes';
    const result = sanitizeText(input);
    assert.ok(!result.includes('\x1b'));
    assert.ok(result.includes('Red text'));
  });

  it('should remove control characters', () => {
    const input = 'Text\x00with\x07control\x1fchars';
    const result = sanitizeText(input);
    assert.ok(!result.includes('\x00'));
    assert.ok(!result.includes('\x07'));
    assert.ok(!result.includes('\x1f'));
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(sanitizeText(null), '');
    assert.strictEqual(sanitizeText(undefined), '');
  });
});

describe('terminal-ui-utils - stripTags', () => {
  it('should strip blessed tags', () => {
    const input = '{red-fg}Colored{/red-fg} text';
    const result = stripTags(input);
    assert.strictEqual(result, 'Colored text');
  });

  it('should handle multiple tags', () => {
    const input = '{bold}{cyan-fg}Bold cyan{/cyan-fg}{/bold}';
    const result = stripTags(input);
    assert.strictEqual(result, 'Bold cyan');
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(stripTags(null), '');
    assert.strictEqual(stripTags(undefined), '');
  });
});

describe('terminal-ui-utils - truncateWithTags', () => {
  it('should truncate while handling tags', () => {
    const input = '{red-fg}This is colored text{/red-fg}';
    const result = truncateWithTags(input, 10);
    assert.ok(result.length <= 10);
  });

  it('should not truncate if within limit', () => {
    const input = '{red-fg}Short{/red-fg}';
    const result = truncateWithTags(input, 20);
    assert.strictEqual(result, input);
  });
});

describe('terminal-ui-utils - formatTimestamp', () => {
  it('should format timestamp correctly', () => {
    const timestamp = Date.now();
    const formatted = formatTimestamp(timestamp);

    // Should be in HH:MM:SS format
    assert.ok(/^\d{2}:\d{2}:\d{2}$/.test(formatted));
  });

  it('should handle specific timestamp', () => {
    // Create a specific date
    const date = new Date('2024-01-15T14:30:45');
    const formatted = formatTimestamp(date.getTime());
    assert.ok(formatted.includes(':'));
  });
});

describe('terminal-ui-utils - formatDuration', () => {
  it('should format milliseconds', () => {
    assert.strictEqual(formatDuration(500), '500ms');
  });

  it('should format seconds', () => {
    const result = formatDuration(5000);
    assert.ok(result.includes('s'));
  });

  it('should format minutes', () => {
    const result = formatDuration(125000); // 2m 5s
    assert.ok(result.includes('m'));
  });

  it('should format hours', () => {
    const result = formatDuration(3700000); // ~1h 1m
    assert.ok(result.includes('h'));
  });
});

describe('terminal-ui-utils - escapeRegex', () => {
  it('should escape special regex characters', () => {
    const input = 'test.*+?^${}()|[]\\';
    const escaped = escapeRegex(input);
    // Should be able to create a regex from it without error
    const regex = new RegExp(escaped);
    assert.ok(regex instanceof RegExp);
  });
});

describe('terminal-ui-utils - getAgentColor', () => {
  it('should return different colors for different agents', () => {
    const plannerColor = getAgentColor('planner');
    const coderColor = getAgentColor('coder');
    const testerColor = getAgentColor('tester');

    // All should be valid color names
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(plannerColor));
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(coderColor));
    assert.ok(['cyan', 'green', 'yellow', 'magenta', 'blue', 'white'].includes(testerColor));

    // Known agents should have consistent colors
    assert.strictEqual(plannerColor, 'cyan');
    assert.strictEqual(coderColor, 'green');
    assert.strictEqual(testerColor, 'yellow');
  });

  it('should return white for unknown agents', () => {
    const color = getAgentColor('unknown-agent');
    assert.strictEqual(color, 'white');
  });
});

describe('terminal-ui-utils - getContentWidth', () => {
  it('should return minimum width for null widget', () => {
    const width = getContentWidth(null);
    assert.ok(width >= 10);
  });

  it('should return minimum width for widget without width', () => {
    const widget = {};
    const width = getContentWidth(widget);
    assert.ok(width >= 10);
  });

  it('should calculate width from widget', () => {
    const widget = { width: 100 };
    const width = getContentWidth(widget);
    assert.strictEqual(width, 97); // 100 - 3
  });
});

describe('terminal-ui-utils - highlightSearchTerms', () => {
  it('should highlight search terms', () => {
    const text = 'This is a test string';
    const result = highlightSearchTerms(text, 'test');
    assert.ok(result.includes('{bold}'));
    assert.ok(result.includes('{yellow-bg}'));
  });

  it('should handle multiple terms', () => {
    const text = 'The quick brown fox';
    const result = highlightSearchTerms(text, 'quick fox');
    assert.ok(result.includes('quick'));
    assert.ok(result.includes('fox'));
  });

  it('should handle empty search query', () => {
    const text = 'Test text';
    const result = highlightSearchTerms(text, '');
    assert.strictEqual(result, text);
  });

  it('should handle null text', () => {
    const result = highlightSearchTerms(null, 'test');
    assert.strictEqual(result, null);
  });
});
