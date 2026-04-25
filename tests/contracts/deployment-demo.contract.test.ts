import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const deploymentValuesPath = resolve(repoRoot, 'deploy/apps/ledger/values.yaml');
const deploymentEnvPath = resolve(repoRoot, 'deploy/apps/ledger/azure-eu.yaml');
const deploymentGuidePath = resolve(repoRoot, 'docs/deployment/ledger-allora-usable-dev.md');

const deploymentValues = existsSync(deploymentValuesPath)
  ? readFileSync(deploymentValuesPath, 'utf8')
  : '';
const deploymentEnv = existsSync(deploymentEnvPath)
  ? readFileSync(deploymentEnvPath, 'utf8')
  : '';
const deploymentGuide = existsSync(deploymentGuidePath)
  ? readFileSync(deploymentGuidePath, 'utf8')
  : '';

describe('deployment + demo contract', () => {
  it('commits the single-app GitOps shape for ledger.allora.usable.dev', () => {
    expect(existsSync(deploymentValuesPath)).toBe(true);
    expect(existsSync(deploymentEnvPath)).toBe(true);
    expect(deploymentValues).toContain('flowcore-microservices:');
    expect(deploymentValues).toContain('ledger.allora.usable.dev');
    expect(deploymentValues).toContain('allora-wildcard-tls');
    expect(deploymentValues).toContain('allora-supply-chain-exception-ledger');
    expect(deploymentEnv).toContain('enabled: true');
    expect(deploymentEnv).toContain('tag: 0.0.0');
  });

  it('documents the end-to-end operator verification loop and ArgoCD/main expectations', () => {
    expect(existsSync(deploymentGuidePath)).toBe(true);
    expect(deploymentGuide).toContain('ledger.allora.usable.dev');
    expect(deploymentGuide).toContain('flowcore-microservices');
    expect(deploymentGuide).toContain('allora-wildcard-tls');
    expect(deploymentGuide).toContain('ArgoCD');
    expect(deploymentGuide).toContain('main');
    expect(deploymentGuide).toContain('open the case');
    expect(deploymentGuide).toContain('wake the case with later evidence');
    expect(deploymentGuide).toContain('resolve the case');
    expect(deploymentGuide).toContain('reusable case memory');
    expect(deploymentGuide).toContain('commercial-invoice/customs-document exception family');
  });
});
