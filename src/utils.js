/**
 * Utility functions for claude-looper
 */

/**
 * Parse a value that might represent a boolean in various forms.
 * Returns true, false, or null (for inconclusive/unknown values).
 *
 * Truthy values: 'yes', 'true', '1', 'y', 't', true, 1
 * Falsy values: 'no', 'false', '0', 'n', 'f', false, 0
 * Inconclusive: null, undefined, 'partial', 'unknown', 'maybe', empty string
 *
 * @param {*} value - The value to parse
 * @returns {boolean|null} - true, false, or null for inconclusive
 */
export function parseBooleanish(value) {
  // Handle actual booleans
  if (value === true) return true;
  if (value === false) return false;

  // Handle null/undefined
  if (value === null || value === undefined) return null;

  // Handle numbers
  if (value === 1) return true;
  if (value === 0) return false;

  // Handle strings
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    // Truthy strings
    if (['yes', 'true', '1', 'y', 't', 'ok', 'pass', 'passed'].includes(normalized)) {
      return true;
    }

    // Falsy strings
    if (['no', 'false', '0', 'n', 'f', 'fail', 'failed'].includes(normalized)) {
      return false;
    }

    // Inconclusive strings
    if (['partial', 'unknown', 'maybe', 'inconclusive', ''].includes(normalized)) {
      return null;
    }
  }

  // Default to null for anything else we don't recognize
  return null;
}

/**
 * Check if a value represents a truthy boolean.
 * More permissive than parseBooleanish - treats inconclusive as false.
 *
 * @param {*} value - The value to check
 * @returns {boolean}
 */
export function isTruthy(value) {
  return parseBooleanish(value) === true;
}

/**
 * Check if a value represents a falsy boolean.
 * Specifically checks for explicit false values, not just !truthy.
 *
 * @param {*} value - The value to check
 * @returns {boolean}
 */
export function isFalsy(value) {
  return parseBooleanish(value) === false;
}

/**
 * Check if a value represents an inconclusive/unknown state.
 *
 * @param {*} value - The value to check
 * @returns {boolean}
 */
export function isInconclusive(value) {
  return parseBooleanish(value) === null;
}

export default {
  parseBooleanish,
  isTruthy,
  isFalsy,
  isInconclusive,
};
