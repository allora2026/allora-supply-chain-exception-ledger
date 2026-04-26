import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const dockerfilePath = resolve(repoRoot, 'Dockerfile');
const workflowPath = resolve(repoRoot, '.github/workflows/publish-ghcr.yml');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>;
};
const dockerfile = existsSync(dockerfilePath)
  ? readFileSync(dockerfilePath, 'utf8')
  : '';
const workflow = existsSync(workflowPath)
  ? readFileSync(workflowPath, 'utf8')
  : '';

describe('runtime packaging contract', () => {
  it('defines build and start scripts for a runnable service', () => {
    expect(packageJson.scripts?.build).toBe('tsc -p tsconfig.json');
    expect(packageJson.scripts?.start).toBe('node dist/server.js');
    expect(packageJson.scripts?.check).toBe('tsc --noEmit -p tsconfig.json');
  });

  it('commits a Dockerfile and GHCR publish workflow for deployment', () => {
    expect(existsSync(dockerfilePath)).toBe(true);
    expect(dockerfile).toContain('FROM node:20-alpine');
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');

    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain('docker/build-push-action');
    expect(workflow).toContain('ghcr.io');
    expect(workflow).toContain('linux/amd64,linux/arm64');
  });
});
