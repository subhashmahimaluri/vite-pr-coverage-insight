/**
 * Audit trail (Stage 5.1): every prompt and response — including skips — is
 * recorded; the action writes the result as the ai-audit.json artifact.
 */

export type AuditRecord = {
  agent: string;
  prompt: string;
  response: string | null;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  timestamp: string;
  skipped?: string;
};

export class AuditLog {
  private records: AuditRecord[] = [];

  record(entry: AuditRecord): void {
    this.records.push(entry);
  }

  get entries(): readonly AuditRecord[] {
    return this.records;
  }

  toJson(): string {
    const totals = this.records.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        estCostUsd: acc.estCostUsd + r.estCostUsd,
      }),
      { inputTokens: 0, outputTokens: 0, estCostUsd: 0 }
    );
    return JSON.stringify({ schemaVersion: 1, totals, records: this.records }, null, 2);
  }
}
