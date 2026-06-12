import { describe, expect, it } from 'vitest';
import { configSchema } from '@coverage-insight/core';
import {
  INSTRUCTIONS_END,
  INSTRUCTIONS_START,
  renderCopilotInstructions,
  upsertInstructions,
} from '@coverage-insight/reporters';

describe('renderCopilotInstructions', () => {
  it('derives the guidance from the actual coverage policy', () => {
    const config = configSchema.parse({ thresholds: { lines: 90, branches: 80 }, ratchet: true });
    const block = renderCopilotInstructions(config);
    expect(block).toContain(INSTRUCTIONS_START);
    expect(block).toContain(INSTRUCTIONS_END);
    expect(block).toContain('min lines 90%, branches 80%');
    expect(block).toContain('ratchet (coverage never decreases)');
    expect(block).toContain('ships with tests in the same PR');
  });

  it('says report-only without thresholds and omits the ratchet rule', () => {
    const block = renderCopilotInstructions(configSchema.parse({}));
    expect(block).toContain('report-only');
    expect(block).not.toContain('Never reduce the coverage');
  });
});

describe('upsertInstructions', () => {
  const block = renderCopilotInstructions(configSchema.parse({ thresholds: { lines: 90 } }));

  it('creates, appends, and replaces idempotently', () => {
    expect(upsertInstructions(null, block)).toBe(`${block}\n`);

    const appended = upsertInstructions('# Team rules\n', block);
    expect(appended).toContain('# Team rules');
    expect(appended).toContain(INSTRUCTIONS_START);

    const replaced = upsertInstructions(appended, block.replaceAll('90%', '95%'));
    expect(replaced).toContain('95%');
    expect(replaced).not.toContain('90%');
    expect(replaced.split(INSTRUCTIONS_START)).toHaveLength(2);
  });
});
