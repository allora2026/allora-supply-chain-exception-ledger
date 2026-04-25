import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const doc = readFileSync(resolve(repoRoot, 'docs/contracts/exception-ledger-v0.md'), 'utf8');
const caseSchema = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/exception-case.v0.schema.json'), 'utf8'));
const eventSchema = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/flowcore-event.v0.schema.json'), 'utf8'));

describe('PRD boundary guards', () => {
  it('documents the required surfaces and the single-app boundary', () => {
    expect(doc).toContain('ledger.allora.usable.dev');
    expect(doc).toContain('exception list');
    expect(doc).toContain('case detail');
    expect(doc).toContain('evidence timeline');
    expect(doc).toContain('missing-artifact panel');
    expect(doc).toContain('counterpart state');
    expect(doc).toContain('handoff notes');
    expect(doc).toContain('resolution snapshot');
    expect(doc).toContain('single app');
  });

  it('keeps the wedge narrow and rejects adjacent-product drift', () => {
    expect(doc).toContain('generic case-platform abstractions');
    expect(doc).toContain('inbox or message-triage semantics');
    expect(doc).toContain('multi-service decomposition');
    expect(JSON.stringify(caseSchema)).not.toContain('pathway');
    expect(JSON.stringify(caseSchema)).not.toContain('generic_inbox');
    expect(JSON.stringify(eventSchema)).not.toContain('message_triaged');
    expect(caseSchema.properties.case_type.const).toBe('commercial_invoice_or_customs_document_exception');
    expect(caseSchema.properties.canonical_key.properties.document_type.const).toBe('commercial_invoice');
  });
});
