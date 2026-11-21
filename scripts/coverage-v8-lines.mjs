import runner from '@vitest/coverage-v8';
import v8ToIstanbul from 'v8-to-istanbul';

// Keep the release thresholds on the line-based V8 coverage used before the Vitest upgrade.
export default {
  ...runner,
  async getProvider() {
    const provider = await runner.getProvider();
    if (typeof provider.remapCoverage !== 'function') {
      throw new Error('The installed Vitest V8 provider cannot remap line-based coverage.');
    }

    provider.remapCoverage = async (file, offset, transformed, functions) => {
      const converter = v8ToIstanbul(file, offset, {
        source: transformed.code,
        sourceMap: transformed.map ? { sourcemap: transformed.map } : undefined,
      });
      await converter.load();
      // Vitest passes no functions for completely untested files.
      converter.applyCoverage(functions.length ? functions : [{
        functionName: '(empty-report)',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: transformed.code.length + offset, count: 0 }],
      }]);
      return converter.toIstanbul();
    };
    return provider;
  },
};
