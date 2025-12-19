/**
 * Execution Strategies - Strategy types and parameters for adaptive execution
 */

export const ExecutionStrategy = {
  FAST_ITERATION: 'fast_iteration',
  CAREFUL_VALIDATION: 'careful_validation',
  PARALLEL_AGGRESSIVE: 'parallel_aggressive',
  SEQUENTIAL_SAFE: 'sequential_safe',
  MINIMAL_CONTEXT: 'minimal_context',
  EXTENDED_TIMEOUT: 'extended_timeout',
  FREQUENT_CHECKPOINTS: 'frequent_checkpoints',
  DEFAULT: 'default',
};

export const STRATEGY_PARAMETERS = {
  [ExecutionStrategy.FAST_ITERATION]: {
    iterationDelay: 500,
    supervisionFrequency: 3,
    checkpointFrequency: 5,
    timeout: 60000,
    parallelEnabled: true,
    maxParallel: 4,
  },
  [ExecutionStrategy.CAREFUL_VALIDATION]: {
    iterationDelay: 2000,
    supervisionFrequency: 1,
    checkpointFrequency: 2,
    timeout: 180000,
    parallelEnabled: false,
    verificationLevel: 'thorough',
  },
  [ExecutionStrategy.PARALLEL_AGGRESSIVE]: {
    iterationDelay: 500,
    supervisionFrequency: 2,
    checkpointFrequency: 3,
    timeout: 120000,
    parallelEnabled: true,
    maxParallel: 6,
  },
  [ExecutionStrategy.SEQUENTIAL_SAFE]: {
    iterationDelay: 2000,
    supervisionFrequency: 1,
    checkpointFrequency: 1,
    timeout: 180000,
    parallelEnabled: false,
    verificationLevel: 'thorough',
  },
  [ExecutionStrategy.MINIMAL_CONTEXT]: {
    iterationDelay: 1000,
    supervisionFrequency: 2,
    checkpointFrequency: 3,
    timeout: 120000,
    contextTrimming: true,
    maxContextTokens: 30000,
  },
  [ExecutionStrategy.EXTENDED_TIMEOUT]: {
    iterationDelay: 1000,
    supervisionFrequency: 2,
    checkpointFrequency: 3,
    timeout: 300000,
    parallelEnabled: true,
    maxParallel: 2,
  },
  [ExecutionStrategy.FREQUENT_CHECKPOINTS]: {
    iterationDelay: 1000,
    supervisionFrequency: 1,
    checkpointFrequency: 1,
    timeout: 120000,
    parallelEnabled: true,
    maxParallel: 3,
  },
  [ExecutionStrategy.DEFAULT]: {
    iterationDelay: 1000,
    supervisionFrequency: 2,
    checkpointFrequency: 3,
    timeout: 120000,
    parallelEnabled: true,
    maxParallel: 3,
  },
};

export function getStrategyParameters(strategy) {
  return STRATEGY_PARAMETERS[strategy] || STRATEGY_PARAMETERS[ExecutionStrategy.DEFAULT];
}

export default ExecutionStrategy;
