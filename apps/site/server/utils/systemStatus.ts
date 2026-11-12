import { execFile } from "node:child_process";
import { readFile, stat, statfs } from "node:fs/promises";
import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from "node:os";
import { parse } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { resolveProjectRoot } from "@nana/utils";
import type { SystemStatusResponse, SystemUsage } from "../../shared/system.ts";

const execute = promisify(execFile);
export function systemUsage(
  total: number,
  available: number,
  used = total - available,
): SystemUsage {
  return {
    total,
    available,
    used,
    percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}

async function readMemory() {
  let memory = systemUsage(totalmem(), freemem());
  let swap: SystemUsage | null = null;
  if (platform() === "linux") {
    try {
      const text = await readFile("/proc/meminfo", "utf8");
      const values = Object.fromEntries(
        [...text.matchAll(/^(\w+):\s+(\d+)\s+kB/gm)].map((match) => [
          match[1],
          Number(match[2]) * 1024,
        ]),
      );
      if (values.MemTotal && values.MemAvailable !== undefined)
        memory = systemUsage(values.MemTotal, values.MemAvailable);
      if (values.SwapTotal !== undefined && values.SwapFree !== undefined)
        swap = systemUsage(values.SwapTotal, values.SwapFree);
    } catch {
      // 非标准 Linux 环境使用 node:os 的内存统计。
    }
  }
  return { memory, swap };
}

export function parseNvidiaStats(stdout: string): SystemStatusResponse["gpus"] {
  const number = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  return stdout
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [index, name, percent, used, total, temperature] = line
        .split(",")
        .map((value) => value.trim());
      const id = number(index);
      if (id === null || !name) return [];
      const memoryTotal = number(total);
      const memoryUsed = number(used);
      return [
        {
          index: id,
          name,
          percent: number(percent),
          temperature: number(temperature),
          memory:
            memoryTotal !== null && memoryUsed !== null
              ? systemUsage(memoryTotal * 1024 ** 2, (memoryTotal - memoryUsed) * 1024 ** 2)
              : null,
        },
      ];
    });
}

async function readGpus() {
  try {
    const { stdout } = await execute(
      "nvidia-smi",
      [
        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2500, maxBuffer: 64 * 1024, encoding: "utf8" },
    );
    const gpus = parseNvidiaStats(stdout);
    return { gpus, gpuMessage: gpus.length ? null : "未检测到 NVIDIA GPU" };
  } catch {
    return { gpus: [], gpuMessage: "GPU 信息不可用：需要 NVIDIA GPU、驱动和 nvidia-smi" };
  }
}

async function readDisks(rootDir: string): Promise<SystemStatusResponse["disks"]> {
  const mounts = new Set([parse(rootDir).root]);
  try {
    const text = await readFile("/proc/self/mountinfo", "utf8");
    const devices = new Set<string>();
    for (const line of text.trim().split("\n")) {
      const [details, filesystem] = line.split(" - ");
      if (!details || !filesystem) continue;
      const fields = details.split(" ");
      const device = fields[2];
      const [type, source] = filesystem.split(" ");
      const mount = fields[4]?.replace(/\\([0-7]{3})/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
      if (!mount || !device || !source || devices.has(device) || mounts.size >= 32) continue;
      if (source.startsWith("/dev/") || type === "overlay") {
        if (!(await stat(mount).catch(() => null))?.isDirectory()) continue;
        devices.add(device);
        mounts.add(mount);
      }
    }
  } catch {
    // macOS 等环境展示根磁盘与项目所在磁盘。
  }
  mounts.add(rootDir);
  const disks: SystemStatusResponse["disks"] = [];
  const devices = new Set<number>();
  for (const mount of mounts) {
    try {
      const [info, fs] = await Promise.all([stat(mount), statfs(mount)]);
      if (devices.has(info.dev)) continue;
      devices.add(info.dev);
      const total = fs.blocks * fs.bsize;
      if (!total) continue;
      disks.push({
        mount,
        usage: systemUsage(total, fs.bavail * fs.bsize, (fs.blocks - fs.bfree) * fs.bsize),
        error: null,
      });
    } catch {
      disks.push({ mount, usage: null, error: "无法读取磁盘用量" });
    }
  }
  return disks;
}

async function readCpu() {
  const before = cpus();
  await setTimeout(100);
  const after = cpus();
  let idle = 0;
  let total = 0;
  after.forEach((cpu, index) => {
    const previous = before[index]?.times;
    if (!previous) return;
    idle += cpu.times.idle - previous.idle;
    for (const key of ["user", "nice", "sys", "idle", "irq"] as const)
      total += cpu.times[key] - previous[key];
  });
  return {
    model: after[0]?.model ?? "未知",
    cores: after.length,
    percent: total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0,
    load: loadavg(),
  };
}

export async function readSystemStatus(rootDir?: string): Promise<SystemStatusResponse> {
  const [cpu, memory, gpu, disks] = await Promise.all([
    readCpu(),
    readMemory(),
    readGpus(),
    readDisks(resolveProjectRoot(rootDir)),
  ]);
  return {
    hostname: hostname(),
    platform: `${platform()} ${release()}`,
    arch: arch(),
    uptime: uptime(),
    cpu,
    ...memory,
    ...gpu,
    disks,
    generatedAt: new Date().toISOString(),
  };
}
