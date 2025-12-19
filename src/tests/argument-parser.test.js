/**
 * Tests for argument-parser.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VERSION,
  CLI_OPTIONS,
  generateHelpText,
  preprocessArgs,
  parseCliArgs,
  validateArgs,
  getOutputMode,
  parseTimeLimit,
} from '../argument-parser.js';

describe('argument-parser', () => {
  describe('VERSION', () => {
    it('should be a valid version string', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('CLI_OPTIONS', () => {
    it('should define all expected options', () => {
      expect(CLI_OPTIONS).toHaveProperty('goal');
      expect(CLI_OPTIONS).toHaveProperty('sub-goal');
      expect(CLI_OPTIONS).toHaveProperty('time-limit');
      expect(CLI_OPTIONS).toHaveProperty('directory');
      expect(CLI_OPTIONS).toHaveProperty('context');
      expect(CLI_OPTIONS).toHaveProperty('verbose');
      expect(CLI_OPTIONS).toHaveProperty('quiet');
      expect(CLI_OPTIONS).toHaveProperty('json');
      expect(CLI_OPTIONS).toHaveProperty('retry');
      expect(CLI_OPTIONS).toHaveProperty('max-retries');
      expect(CLI_OPTIONS).toHaveProperty('resume');
      expect(CLI_OPTIONS).toHaveProperty('list-sessions');
      expect(CLI_OPTIONS).toHaveProperty('state-dir');
      expect(CLI_OPTIONS).toHaveProperty('ui');
      expect(CLI_OPTIONS).toHaveProperty('ui-port');
      expect(CLI_OPTIONS).toHaveProperty('help');
      expect(CLI_OPTIONS).toHaveProperty('version');
      expect(CLI_OPTIONS).toHaveProperty('docker');
    });

    it('should have correct short aliases', () => {
      expect(CLI_OPTIONS.goal.short).toBe('g');
      expect(CLI_OPTIONS['sub-goal'].short).toBe('s');
      expect(CLI_OPTIONS['time-limit'].short).toBe('t');
      expect(CLI_OPTIONS.directory.short).toBe('d');
      expect(CLI_OPTIONS.context.short).toBe('c');
      expect(CLI_OPTIONS.verbose.short).toBe('v');
      expect(CLI_OPTIONS.quiet.short).toBe('q');
      expect(CLI_OPTIONS.json.short).toBe('j');
      expect(CLI_OPTIONS.retry.short).toBe('r');
      expect(CLI_OPTIONS.resume.short).toBe('R');
      expect(CLI_OPTIONS.help.short).toBe('h');
    });

    it('should have sub-goal as multiple', () => {
      expect(CLI_OPTIONS['sub-goal'].multiple).toBe(true);
    });
  });

  describe('generateHelpText', () => {
    it('should return a string', () => {
      const help = generateHelpText();
      expect(typeof help).toBe('string');
    });

    it('should include version', () => {
      const help = generateHelpText();
      expect(help).toContain(VERSION);
    });

    it('should include usage examples', () => {
      const help = generateHelpText();
      expect(help).toContain('USAGE:');
      expect(help).toContain('OPTIONS:');
      expect(help).toContain('EXAMPLES:');
    });

    it('should document all main options', () => {
      const help = generateHelpText();
      expect(help).toContain('--goal');
      expect(help).toContain('--sub-goal');
      expect(help).toContain('--time-limit');
      expect(help).toContain('--verbose');
      expect(help).toContain('--resume');
      expect(help).toContain('--docker');
    });
  });

  describe('preprocessArgs', () => {
    it('should not modify args without --resume', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['--verbose', 'goal']);
      expect(args).toEqual(['--verbose', 'goal']);
      expect(resumeNeedsSelection).toBe(false);
    });

    it('should detect --resume without value at end of args', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['--resume']);
      expect(args).toEqual(['--resume', '__SELECT__']);
      expect(resumeNeedsSelection).toBe(true);
    });

    it('should detect -R without value at end of args', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['-R']);
      expect(args).toEqual(['-R', '__SELECT__']);
      expect(resumeNeedsSelection).toBe(true);
    });

    it('should detect --resume followed by another flag', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['--resume', '--verbose']);
      expect(args).toEqual(['--resume', '__SELECT__', '--verbose']);
      expect(resumeNeedsSelection).toBe(true);
    });

    it('should not modify --resume with value', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['--resume', 'session123']);
      expect(args).toEqual(['--resume', 'session123']);
      expect(resumeNeedsSelection).toBe(false);
    });

    it('should not modify -R with value', () => {
      const { args, resumeNeedsSelection } = preprocessArgs(['-R', 'session123']);
      expect(args).toEqual(['-R', 'session123']);
      expect(resumeNeedsSelection).toBe(false);
    });
  });

  describe('parseCliArgs', () => {
    it('should parse positional goal', () => {
      const { values, positionals } = parseCliArgs(['Build a REST API']);
      expect(positionals).toEqual(['Build a REST API']);
    });

    it('should parse --goal flag', () => {
      const { values } = parseCliArgs(['--goal', 'Build something']);
      expect(values.goal).toBe('Build something');
    });

    it('should parse -g short flag', () => {
      const { values } = parseCliArgs(['-g', 'Build something']);
      expect(values.goal).toBe('Build something');
    });

    it('should parse multiple sub-goals', () => {
      const { values } = parseCliArgs(['-s', 'Step 1', '-s', 'Step 2', 'Goal']);
      expect(values['sub-goal']).toEqual(['Step 1', 'Step 2']);
    });

    it('should parse time-limit', () => {
      const { values } = parseCliArgs(['-t', '4h', 'Goal']);
      expect(values['time-limit']).toBe('4h');
    });

    it('should have default time-limit', () => {
      const { values } = parseCliArgs(['Goal']);
      expect(values['time-limit']).toBe('2h');
    });

    it('should parse boolean flags', () => {
      const { values } = parseCliArgs(['--verbose', '--retry', 'Goal']);
      expect(values.verbose).toBe(true);
      expect(values.retry).toBe(true);
    });

    it('should handle --resume needing selection', () => {
      const { values, resumeNeedsSelection } = parseCliArgs(['--resume']);
      expect(values.resume).toBe('__SELECT__');
      expect(resumeNeedsSelection).toBe(true);
    });

    it('should parse --resume with session ID', () => {
      const { values } = parseCliArgs(['--resume', 'abc123']);
      expect(values.resume).toBe('abc123');
    });
  });

  describe('validateArgs', () => {
    it('should pass validation with positional goal', () => {
      const result = validateArgs({}, ['Build something'], null);
      expect(result.valid).toBe(true);
      expect(result.primaryGoal).toBe('Build something');
    });

    it('should pass validation with --goal flag', () => {
      const result = validateArgs({ goal: 'Build something' }, [], null);
      expect(result.valid).toBe(true);
      expect(result.primaryGoal).toBe('Build something');
    });

    it('should pass validation with resumed goal', () => {
      const result = validateArgs({}, [], 'Resumed goal');
      expect(result.valid).toBe(true);
      expect(result.primaryGoal).toBe('Resumed goal');
    });

    it('should fail without goal', () => {
      const result = validateArgs({}, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required argument: goal');
    });

    it('should skip goal validation for --help', () => {
      const result = validateArgs({ help: true }, [], null);
      expect(result.valid).toBe(true);
    });

    it('should skip goal validation for --version', () => {
      const result = validateArgs({ version: true }, [], null);
      expect(result.valid).toBe(true);
    });

    it('should skip goal validation for --list-sessions', () => {
      const result = validateArgs({ 'list-sessions': true }, [], null);
      expect(result.valid).toBe(true);
    });

    it('should skip goal validation for --docker', () => {
      const result = validateArgs({ docker: true }, [], null);
      expect(result.valid).toBe(true);
    });

    it('should fail for invalid max-retries', () => {
      const result = validateArgs({ 'max-retries': 'abc', goal: 'test' }, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('--max-retries must be a number');
    });

    it('should fail for invalid ui-port', () => {
      const result = validateArgs({ 'ui-port': 'abc', goal: 'test' }, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('--ui-port must be a number');
    });

    it('should fail for verbose + quiet conflict', () => {
      const result = validateArgs({ verbose: true, quiet: true, goal: 'test' }, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot use both --verbose and --quiet');
    });

    it('should fail for verbose + json conflict', () => {
      const result = validateArgs({ verbose: true, json: true, goal: 'test' }, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot use both --verbose and --json');
    });

    it('should fail for quiet + json conflict', () => {
      const result = validateArgs({ quiet: true, json: true, goal: 'test' }, [], null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot use both --quiet and --json');
    });

    it('should allow goal to be missing when resuming', () => {
      const result = validateArgs({ resume: 'session123' }, [], null);
      expect(result.valid).toBe(true);
    });
  });

  describe('getOutputMode', () => {
    it('should return verbose when verbose flag set', () => {
      expect(getOutputMode({ verbose: true })).toBe('verbose');
    });

    it('should return quiet when quiet flag set', () => {
      expect(getOutputMode({ quiet: true })).toBe('quiet');
    });

    it('should return json when json flag set', () => {
      expect(getOutputMode({ json: true })).toBe('json');
    });

    it('should return dashboard by default', () => {
      expect(getOutputMode({})).toBe('dashboard');
    });

    it('should prioritize verbose over quiet', () => {
      expect(getOutputMode({ verbose: true, quiet: true })).toBe('verbose');
    });
  });

  describe('parseTimeLimit', () => {
    it('should parse minutes', () => {
      expect(parseTimeLimit('30m')).toBe(30 * 60 * 1000);
      expect(parseTimeLimit('45M')).toBe(45 * 60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseTimeLimit('2h')).toBe(2 * 60 * 60 * 1000);
      expect(parseTimeLimit('4H')).toBe(4 * 60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseTimeLimit('1d')).toBe(24 * 60 * 60 * 1000);
      expect(parseTimeLimit('2D')).toBe(2 * 24 * 60 * 60 * 1000);
    });

    it('should parse plain numbers as hours', () => {
      expect(parseTimeLimit('2')).toBe(2 * 60 * 60 * 1000);
      expect(parseTimeLimit('0.5')).toBe(0.5 * 60 * 60 * 1000);
    });

    it('should return default for invalid input', () => {
      expect(parseTimeLimit('invalid')).toBe(2 * 60 * 60 * 1000);
    });
  });
});
