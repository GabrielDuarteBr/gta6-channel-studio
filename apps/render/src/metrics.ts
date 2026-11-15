import { readFileSync } from 'node:fs';

/**
 * Mede CPU e memória do container de render durante um trabalho (relatório por render e
 * estimativa para a VPS). Lê o cgroup do container, que conta o Chrome do Remotion também:
 * v2 (Docker Desktop no WSL 2, Ubuntu 24.04) ou v1 (Docker mais antigo). Sem cgroup, mede só
 * o processo Node (marcado como "processo", subestima a CPU).
 */
export interface RenderMetrics {
  cpuSeconds: number;
  peakMemoryMb: number;
  metricsSource: 'cgroup' | 'processo';
}

const CG = process.env.RENDER_CGROUP_ROOT ?? '/sys/fs/cgroup';

const readNumber = (file: string, re?: RegExp): number | null => {
  try {
    const text = readFileSync(file, 'utf8');
    const m = re ? re.exec(text) : /^\s*(\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

interface CgroupReader {
  /** CPU acumulada em segundos. */
  cpu(): number | null;
  /** Memória atual em bytes. */
  memory(): number | null;
}

function cgroupReader(root: string): CgroupReader | null {
  const v2: CgroupReader = {
    cpu: () => {
      const usec = readNumber(`${root}/cpu.stat`, /usage_usec (\d+)/);
      return usec === null ? null : usec / 1e6;
    },
    memory: () => readNumber(`${root}/memory.current`),
  };
  if (v2.cpu() !== null && v2.memory() !== null) return v2;
  const v1: CgroupReader = {
    cpu: () => {
      const ns =
        readNumber(`${root}/cpuacct/cpuacct.usage`) ??
        readNumber(`${root}/cpu,cpuacct/cpuacct.usage`);
      return ns === null ? null : ns / 1e9;
    },
    memory: () => readNumber(`${root}/memory/memory.usage_in_bytes`),
  };
  if (v1.cpu() !== null && v1.memory() !== null) return v1;
  return null;
}

export function startMetrics(root = CG, intervalMs = 500): () => RenderMetrics {
  const cg = cgroupReader(root);
  const cpu0 = cg?.cpu() ?? 0;
  const proc0 = process.cpuUsage();
  const memNow = () => (cg ? cg.memory() : process.memoryUsage().rss);
  let peak = memNow() ?? 0;
  const timer = setInterval(() => {
    const now = memNow();
    if (now !== null && now > peak) peak = now;
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    const last = memNow();
    if (last !== null && last > peak) peak = last;
    let cpuSeconds: number;
    if (cg) {
      cpuSeconds = (cg.cpu() ?? cpu0) - cpu0;
    } else {
      const d = process.cpuUsage(proc0);
      cpuSeconds = (d.user + d.system) / 1e6;
    }
    return {
      cpuSeconds: Number(cpuSeconds.toFixed(1)),
      peakMemoryMb: Math.round(peak / 1024 / 1024),
      metricsSource: cg ? 'cgroup' : 'processo',
    };
  };
}
