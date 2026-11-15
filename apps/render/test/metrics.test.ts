import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startMetrics } from '../src/metrics';

describe('métricas do render', () => {
  it('cgroup: CPU do container no período e pico de memória', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cg-'));
    writeFileSync(path.join(dir, 'cpu.stat'), 'usage_usec 1000000\nuser_usec 1\n');
    writeFileSync(path.join(dir, 'memory.current'), String(500 * 1024 * 1024));
    const stop = startMetrics(dir, 10);
    writeFileSync(path.join(dir, 'memory.current'), String(900 * 1024 * 1024));
    await new Promise((r) => setTimeout(r, 40));
    writeFileSync(path.join(dir, 'memory.current'), String(600 * 1024 * 1024));
    writeFileSync(path.join(dir, 'cpu.stat'), 'usage_usec 13500000\n');
    expect(stop()).toEqual({ cpuSeconds: 12.5, peakMemoryMb: 900, metricsSource: 'cgroup' });
  });

  it('cgroup v1 (cpuacct em nanossegundos, memory.usage_in_bytes)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cg1-'));
    mkdirSync(path.join(dir, 'cpuacct'));
    mkdirSync(path.join(dir, 'memory'));
    writeFileSync(path.join(dir, 'cpuacct', 'cpuacct.usage'), '2000000000\n');
    writeFileSync(path.join(dir, 'memory', 'memory.usage_in_bytes'), String(300 * 1024 * 1024));
    const stop = startMetrics(dir, 10);
    writeFileSync(path.join(dir, 'memory', 'memory.usage_in_bytes'), String(700 * 1024 * 1024));
    await new Promise((r) => setTimeout(r, 40));
    writeFileSync(path.join(dir, 'cpuacct', 'cpuacct.usage'), '9500000000\n');
    expect(stop()).toEqual({ cpuSeconds: 7.5, peakMemoryMb: 700, metricsSource: 'cgroup' });
  });

  it('sem cgroup: mede só o processo', () => {
    const stop = startMetrics('/caminho/que/nao/existe', 10);
    const m = stop();
    expect(m.metricsSource).toBe('processo');
    expect(m.peakMemoryMb).toBeGreaterThan(10);
  });
});
