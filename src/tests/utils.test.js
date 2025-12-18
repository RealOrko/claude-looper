/**
 * Tests for utils.js
 */

import { describe, it, expect } from 'vitest';
import { parseBooleanish, isTruthy, isFalsy, isInconclusive } from '../utils.js';

describe('parseBooleanish', () => {
  describe('truthy values', () => {
    it('should return true for boolean true', () => {
      expect(parseBooleanish(true)).toBe(true);
    });

    it('should return true for number 1', () => {
      expect(parseBooleanish(1)).toBe(true);
    });

    it('should return true for string "yes" (case insensitive)', () => {
      expect(parseBooleanish('yes')).toBe(true);
      expect(parseBooleanish('YES')).toBe(true);
      expect(parseBooleanish('Yes')).toBe(true);
    });

    it('should return true for string "true" (case insensitive)', () => {
      expect(parseBooleanish('true')).toBe(true);
      expect(parseBooleanish('TRUE')).toBe(true);
      expect(parseBooleanish('True')).toBe(true);
    });

    it('should return true for "y", "t", "1"', () => {
      expect(parseBooleanish('y')).toBe(true);
      expect(parseBooleanish('t')).toBe(true);
      expect(parseBooleanish('1')).toBe(true);
    });

    it('should return true for "pass", "passed", "ok"', () => {
      expect(parseBooleanish('pass')).toBe(true);
      expect(parseBooleanish('passed')).toBe(true);
      expect(parseBooleanish('ok')).toBe(true);
    });
  });

  describe('falsy values', () => {
    it('should return false for boolean false', () => {
      expect(parseBooleanish(false)).toBe(false);
    });

    it('should return false for number 0', () => {
      expect(parseBooleanish(0)).toBe(false);
    });

    it('should return false for string "no" (case insensitive)', () => {
      expect(parseBooleanish('no')).toBe(false);
      expect(parseBooleanish('NO')).toBe(false);
      expect(parseBooleanish('No')).toBe(false);
    });

    it('should return false for string "false" (case insensitive)', () => {
      expect(parseBooleanish('false')).toBe(false);
      expect(parseBooleanish('FALSE')).toBe(false);
      expect(parseBooleanish('False')).toBe(false);
    });

    it('should return false for "n", "f", "0"', () => {
      expect(parseBooleanish('n')).toBe(false);
      expect(parseBooleanish('f')).toBe(false);
      expect(parseBooleanish('0')).toBe(false);
    });

    it('should return false for "fail", "failed"', () => {
      expect(parseBooleanish('fail')).toBe(false);
      expect(parseBooleanish('failed')).toBe(false);
    });
  });

  describe('inconclusive values', () => {
    it('should return null for null', () => {
      expect(parseBooleanish(null)).toBe(null);
    });

    it('should return null for undefined', () => {
      expect(parseBooleanish(undefined)).toBe(null);
    });

    it('should return null for "partial"', () => {
      expect(parseBooleanish('partial')).toBe(null);
      expect(parseBooleanish('PARTIAL')).toBe(null);
    });

    it('should return null for "unknown", "maybe", "inconclusive"', () => {
      expect(parseBooleanish('unknown')).toBe(null);
      expect(parseBooleanish('maybe')).toBe(null);
      expect(parseBooleanish('inconclusive')).toBe(null);
    });

    it('should return null for empty string', () => {
      expect(parseBooleanish('')).toBe(null);
    });

    it('should return null for unrecognized values', () => {
      expect(parseBooleanish('banana')).toBe(null);
      expect(parseBooleanish({})).toBe(null);
      expect(parseBooleanish([])).toBe(null);
    });
  });

  describe('whitespace handling', () => {
    it('should trim whitespace from strings', () => {
      expect(parseBooleanish('  yes  ')).toBe(true);
      expect(parseBooleanish('  no  ')).toBe(false);
      expect(parseBooleanish('  partial  ')).toBe(null);
    });
  });
});

describe('isTruthy', () => {
  it('should return true only for truthy values', () => {
    expect(isTruthy(true)).toBe(true);
    expect(isTruthy('yes')).toBe(true);
    expect(isTruthy('YES')).toBe(true);
    expect(isTruthy(1)).toBe(true);
  });

  it('should return false for falsy and inconclusive values', () => {
    expect(isTruthy(false)).toBe(false);
    expect(isTruthy('no')).toBe(false);
    expect(isTruthy('NO')).toBe(false);
    expect(isTruthy(null)).toBe(false);
    expect(isTruthy('partial')).toBe(false);
  });
});

describe('isFalsy', () => {
  it('should return true only for falsy values', () => {
    expect(isFalsy(false)).toBe(true);
    expect(isFalsy('no')).toBe(true);
    expect(isFalsy('NO')).toBe(true);
    expect(isFalsy(0)).toBe(true);
  });

  it('should return false for truthy and inconclusive values', () => {
    expect(isFalsy(true)).toBe(false);
    expect(isFalsy('yes')).toBe(false);
    expect(isFalsy(null)).toBe(false);
    expect(isFalsy('partial')).toBe(false);
  });
});

describe('isInconclusive', () => {
  it('should return true only for inconclusive values', () => {
    expect(isInconclusive(null)).toBe(true);
    expect(isInconclusive(undefined)).toBe(true);
    expect(isInconclusive('partial')).toBe(true);
    expect(isInconclusive('PARTIAL')).toBe(true);
    expect(isInconclusive('unknown')).toBe(true);
  });

  it('should return false for truthy and falsy values', () => {
    expect(isInconclusive(true)).toBe(false);
    expect(isInconclusive(false)).toBe(false);
    expect(isInconclusive('yes')).toBe(false);
    expect(isInconclusive('no')).toBe(false);
  });
});

describe('real-world use case: goal verification', () => {
  it('should correctly parse supervisor agent goal verification responses', () => {
    // These are the actual values returned by parseGoalVerification in supervisor-agent.js
    expect(isTruthy('YES')).toBe(true);
    expect(isFalsy('NO')).toBe(true);
    expect(isInconclusive('PARTIAL')).toBe(true);
  });
});
