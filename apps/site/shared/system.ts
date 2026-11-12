export interface SystemUsage {
  total: number;
  used: number;
  available: number;
  percent: number;
}

export interface SystemStatusResponse {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  cpu: { model: string; cores: number; percent: number; load: number[] };
  memory: SystemUsage;
  swap: SystemUsage | null;
  disks: { mount: string; usage: SystemUsage | null; error: string | null }[];
  gpus: {
    index: number;
    name: string;
    percent: number | null;
    memory: SystemUsage | null;
    temperature: number | null;
  }[];
  gpuMessage: string | null;
  generatedAt: string;
}
