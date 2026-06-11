/**
 * Redaction layer (Stage 5.1): in redacted mode prompts carry only file
 * paths, metrics and uncovered ranges — never source code.
 */

export type PromptBlocks = {
  paths: string[];
  metrics: string;
  uncoveredRanges: string;
  /** source snippets keyed by path — dropped entirely when redacted */
  snippets?: Map<string, string>;
};

export function buildPromptContext(blocks: PromptBlocks, redacted: boolean): string {
  const sections = [
    `Files under review:\n${blocks.paths.join('\n')}`,
    `Coverage metrics:\n${blocks.metrics}`,
    `Uncovered ranges:\n${blocks.uncoveredRanges}`,
  ];
  if (!redacted && blocks.snippets && blocks.snippets.size > 0) {
    const snippetText = [...blocks.snippets.entries()]
      .map(([path, code]) => `--- ${path} ---\n${code}`)
      .join('\n');
    sections.push(`Source snippets (uncovered regions):\n${snippetText}`);
  }
  return sections.join('\n\n');
}
