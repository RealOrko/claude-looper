/**
 * Error Utilities - Standardized error handling for the autonomous runner
 */

// Error Classes
export class AutonomousRunnerError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AutonomousRunnerError';
    this.code = options.code || 'UNKNOWN_ERROR';
    this.recoverable = options.recoverable ?? true;
    this.context = options.context || {};
    this.timestamp = new Date().toISOString();
  }
  toJSON() {
    return { name: this.name, message: this.message, code: this.code,
      recoverable: this.recoverable, context: this.context, timestamp: this.timestamp };
  }
}

export class FileOperationError extends AutonomousRunnerError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'FILE_ERROR' });
    this.name = 'FileOperationError';
    this.path = options.path;
    this.operation = options.operation;
  }
}

export class APIError extends AutonomousRunnerError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'API_ERROR' });
    this.name = 'APIError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? true;
    this.endpoint = options.endpoint;
  }
}

export class ParseError extends AutonomousRunnerError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'PARSE_ERROR' });
    this.name = 'ParseError';
    this.input = options.input?.substring?.(0, 200);
  }
}

export class VerificationError extends AutonomousRunnerError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'VERIFICATION_ERROR' });
    this.name = 'VerificationError';
    this.verificationType = options.verificationType;
    this.evidence = options.evidence;
  }
}

export class TimeoutError extends AutonomousRunnerError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'TIMEOUT_ERROR', recoverable: true });
    this.name = 'TimeoutError';
    this.timeoutMs = options.timeoutMs;
    this.operation = options.operation;
  }
}

// Wrapper Functions

/** Wraps async function, returns default on error */
export async function withDefault(fn, defaultValue, options = {}) {
  const { silent = false, logPrefix = '', onError } = options;
  try {
    return await fn();
  } catch (error) {
    if (!silent) logError(logPrefix, error);
    if (onError) onError(error);
    return defaultValue;
  }
}

/** Wraps async function, returns { success, data } or { success, error } */
export async function withResult(fn) {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    return { success: false, error };
  }
}

/** Returns true if fn succeeds, false otherwise */
export function existsCheck(fn) {
  try { fn(); return true; } catch { return false; }
}

/** Wraps async function with fallback for verification patterns */
export async function withVerificationFallback(fn, fallbackResult, options = {}) {
  const { logPrefix = '[Verification]', onError } = options;
  try {
    return await fn();
  } catch (error) {
    logError(logPrefix, error);
    if (onError) onError(error);
    return { ...fallbackResult, error: error.message, fallbackUsed: true };
  }
}

/** Wraps async function with retry logic */
export async function withRetry(fn, options = {}) {
  const { maxAttempts = 3, delayMs = 1000, backoff = 2,
    shouldRetry = () => true, onRetry, logPrefix = '' } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) break;
      if (onRetry) onRetry(error, attempt);
      if (!options.silent) logError(logPrefix, error, { attempt, maxAttempts });
      await new Promise(r => setTimeout(r, delayMs * Math.pow(backoff, attempt - 1)));
    }
  }
  throw lastError;
}

/** Wraps function to ensure no throw, returns defaultValue on error */
export function safeCall(fn, options = {}) {
  const { logPrefix = '', defaultValue = null } = options;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch(error => {
        if (logPrefix) logError(logPrefix, error);
        return defaultValue;
      });
    }
    return result;
  } catch (error) {
    if (logPrefix) logError(logPrefix, error);
    return defaultValue;
  }
}

// Logging Helpers

/** Standard error logging with prefix */
export function logError(prefix, error, context = {}) {
  const ctxStr = Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
  console.error(`${prefix} ${error.message || error}${ctxStr}`);
}

/** Standard warning logging with prefix */
export function logWarning(prefix, message, context = {}) {
  const ctxStr = Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
  console.warn(`${prefix} ${message}${ctxStr}`);
}

/** Categorizes error for metrics and recovery */
export function categorizeError(error) {
  const msg = error.message?.toLowerCase() || '';
  if (/econnrefused|econnreset|etimedout|network/.test(msg))
    return { category: 'network', retryable: true, severity: 'warning' };
  if (/rate limit|429|too many requests/.test(msg))
    return { category: 'rate_limit', retryable: true, severity: 'warning' };
  if (/unauthorized|401|authentication|api key/.test(msg))
    return { category: 'auth', retryable: false, severity: 'critical' };
  if (/timeout|timed out/.test(msg))
    return { category: 'timeout', retryable: true, severity: 'warning' };
  if (/json|parse|unexpected token/.test(msg))
    return { category: 'parse', retryable: false, severity: 'error' };
  if (/enoent|eacces|file not found/.test(msg))
    return { category: 'file', retryable: false, severity: 'error' };
  return { category: 'unknown', retryable: false, severity: 'error' };
}

/** Creates standardized error response for API handlers */
export function createErrorResponse(error, options = {}) {
  const { includeStack = false } = options;
  const cat = categorizeError(error);
  return {
    success: false,
    error: {
      message: error.message,
      code: error.code || cat.category.toUpperCase(),
      category: cat.category,
      retryable: cat.retryable,
      ...(includeStack && { stack: error.stack }),
    },
  };
}

export default {
  AutonomousRunnerError, FileOperationError, APIError, ParseError,
  VerificationError, TimeoutError,
  withDefault, withResult, withRetry, withVerificationFallback, existsCheck, safeCall,
  logError, logWarning, categorizeError, createErrorResponse,
};
