/**
 * Tests for DAG utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  truncateText,
  formatDuration,
  calculateEdgePath,
  getNodeFilter,
} from '../utils.js';

describe('DAG utils', () => {
  describe('truncateText', () => {
    it('should return empty string for null/undefined', () => {
      expect(truncateText(null, 10)).toBe('');
      expect(truncateText(undefined, 10)).toBe('');
      expect(truncateText('', 10)).toBe('');
    });

    it('should return full text if shorter than maxLen', () => {
      expect(truncateText('hello', 10)).toBe('hello');
      expect(truncateText('test', 4)).toBe('test');
    });

    it('should truncate with ellipsis if longer than maxLen', () => {
      expect(truncateText('hello world', 8)).toBe('hello...');
      expect(truncateText('abcdefghij', 6)).toBe('abc...');
    });
  });

  describe('formatDuration', () => {
    it('should return 0s for null/undefined/0', () => {
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(undefined)).toBe('0s');
      expect(formatDuration(0)).toBe('0s');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours, minutes, and seconds', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(5400000)).toBe('1h 30m 0s');
      expect(formatDuration(7200000)).toBe('2h 0m 0s');
    });
  });

  describe('calculateEdgePath', () => {
    it('should calculate bezier path between two nodes', () => {
      const from = { x: 100, y: 50, height: 60 };
      const to = { x: 100, y: 150, height: 60 };
      const path = calculateEdgePath(from, to);
      expect(path).toContain('M 100');
      expect(path).toContain('C');
    });

    it('should use default height if not provided', () => {
      const from = { x: 100, y: 50 };
      const to = { x: 100, y: 150 };
      const path = calculateEdgePath(from, to);
      expect(path).toMatch(/^M \d+ \d+ C/);
    });
  });

  describe('getNodeFilter', () => {
    it('should return selected filter when isSelected', () => {
      expect(getNodeFilter({ isSelected: true, hasChanged: false, isActive: false }))
        .toBe('url(#glow-selected)');
    });

    it('should return changed filter when hasChanged (not selected)', () => {
      expect(getNodeFilter({ isSelected: false, hasChanged: true, isActive: false }))
        .toBe('url(#glow-changed)');
    });

    it('should return active filter when isActive (not selected or changed)', () => {
      expect(getNodeFilter({ isSelected: false, hasChanged: false, isActive: true }))
        .toBe('url(#glow-active)');
    });

    it('should return empty string when no special state', () => {
      expect(getNodeFilter({ isSelected: false, hasChanged: false, isActive: false }))
        .toBe('');
    });

    it('should prioritize selected over changed and active', () => {
      expect(getNodeFilter({ isSelected: true, hasChanged: true, isActive: true }))
        .toBe('url(#glow-selected)');
    });

    it('should prioritize changed over active', () => {
      expect(getNodeFilter({ isSelected: false, hasChanged: true, isActive: true }))
        .toBe('url(#glow-changed)');
    });
  });
});
