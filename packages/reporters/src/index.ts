export {
  buildReport,
  collapseUncoveredRanges,
  round2,
  type BuildReportInput,
  type InputError,
  type HistoryPoint,
} from './json/buildReport';
export {
  aggregateVerdict,
  buildProjectReports,
  sliceModelByPathPrefix,
  type ProjectInput,
} from './json/buildProjects';
export { renderMarkdown, COMMENT_MARKER, type RenderMarkdownOptions } from './markdown/render';
export { renderHtml } from './html/render';
export {
  buildTestPrompt,
  coverageGaps,
  renderFixPlan,
  renderTestPromptsSection,
} from './fixplan/render';
export {
  INSTRUCTIONS_END,
  INSTRUCTIONS_START,
  renderCopilotInstructions,
  upsertInstructions,
} from './copilot/instructions';
