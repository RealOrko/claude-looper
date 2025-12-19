import { describe, it, expect } from 'vitest';
import { ExecutionStrategy, STRATEGY_PARAMETERS, getStrategyParameters } from '../execution-strategies.js';

describe('ExecutionStrategy', () => {
  describe('enum values', () => {
    it('should export all strategy types', () => {
      expect(ExecutionStrategy.FAST_ITERATION).toBe('fast_iteration');
      expect(ExecutionStrategy.CAREFUL_VALIDATION).toBe('careful_validation');
      expect(ExecutionStrategy.PARALLEL_AGGRESSIVE).toBe('parallel_aggressive');
      expect(ExecutionStrategy.SEQUENTIAL_SAFE).toBe('sequential_safe');
      expect(ExecutionStrategy.MINIMAL_CONTEXT).toBe('minimal_context');
      expect(ExecutionStrategy.EXTENDED_TIMEOUT).toBe('extended_timeout');
      expect(ExecutionStrategy.FREQUENT_CHECKPOINTS).toBe('frequent_checkpoints');
      expect(ExecutionStrategy.DEFAULT).toBe('default');
    });
  });
});

describe('STRATEGY_PARAMETERS', () => {
  it('should have parameters for all strategies', () => {
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.FAST_ITERATION]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.CAREFUL_VALIDATION]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.PARALLEL_AGGRESSIVE]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.SEQUENTIAL_SAFE]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.MINIMAL_CONTEXT]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.EXTENDED_TIMEOUT]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.FREQUENT_CHECKPOINTS]).toBeDefined();
    expect(STRATEGY_PARAMETERS[ExecutionStrategy.DEFAULT]).toBeDefined();
  });

  describe('FAST_ITERATION', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.FAST_ITERATION];
    it('should have low iteration delay', () => {
      expect(params.iterationDelay).toBe(500);
    });
    it('should have infrequent supervision', () => {
      expect(params.supervisionFrequency).toBe(3);
    });
    it('should enable parallel execution', () => {
      expect(params.parallelEnabled).toBe(true);
    });
  });

  describe('CAREFUL_VALIDATION', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.CAREFUL_VALIDATION];
    it('should have high iteration delay', () => {
      expect(params.iterationDelay).toBe(2000);
    });
    it('should have frequent supervision', () => {
      expect(params.supervisionFrequency).toBe(1);
    });
    it('should disable parallel execution', () => {
      expect(params.parallelEnabled).toBe(false);
    });
    it('should have thorough verification', () => {
      expect(params.verificationLevel).toBe('thorough');
    });
  });

  describe('PARALLEL_AGGRESSIVE', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.PARALLEL_AGGRESSIVE];
    it('should have high max parallel', () => {
      expect(params.maxParallel).toBe(6);
    });
    it('should enable parallel execution', () => {
      expect(params.parallelEnabled).toBe(true);
    });
  });

  describe('SEQUENTIAL_SAFE', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.SEQUENTIAL_SAFE];
    it('should disable parallel execution', () => {
      expect(params.parallelEnabled).toBe(false);
    });
    it('should have checkpoint every step', () => {
      expect(params.checkpointFrequency).toBe(1);
    });
  });

  describe('MINIMAL_CONTEXT', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.MINIMAL_CONTEXT];
    it('should enable context trimming', () => {
      expect(params.contextTrimming).toBe(true);
    });
    it('should have max context tokens limit', () => {
      expect(params.maxContextTokens).toBe(30000);
    });
  });

  describe('EXTENDED_TIMEOUT', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.EXTENDED_TIMEOUT];
    it('should have long timeout', () => {
      expect(params.timeout).toBe(300000);
    });
  });

  describe('FREQUENT_CHECKPOINTS', () => {
    const params = STRATEGY_PARAMETERS[ExecutionStrategy.FREQUENT_CHECKPOINTS];
    it('should have checkpoint every step', () => {
      expect(params.checkpointFrequency).toBe(1);
    });
    it('should have supervision every iteration', () => {
      expect(params.supervisionFrequency).toBe(1);
    });
  });
});

describe('getStrategyParameters', () => {
  it('should return parameters for valid strategy', () => {
    const params = getStrategyParameters(ExecutionStrategy.FAST_ITERATION);
    expect(params.iterationDelay).toBe(500);
  });

  it('should return DEFAULT parameters for invalid strategy', () => {
    const params = getStrategyParameters('invalid_strategy');
    expect(params).toEqual(STRATEGY_PARAMETERS[ExecutionStrategy.DEFAULT]);
  });

  it('should return DEFAULT parameters for undefined', () => {
    const params = getStrategyParameters(undefined);
    expect(params).toEqual(STRATEGY_PARAMETERS[ExecutionStrategy.DEFAULT]);
  });
});
