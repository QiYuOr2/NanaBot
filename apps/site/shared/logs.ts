export interface ProjectLogFile {
  name: string;
  size: number;
  updatedAt: string;
}

export interface ProjectLogsResponse {
  files: ProjectLogFile[];
  selected: string | null;
  content: string;
  truncated: boolean;
  generatedAt: string;
}
