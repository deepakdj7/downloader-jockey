export type DownloadPlatform = 'youtube' | 'instagram' | 'unknown';

export type YoutubeFormat = 'video' | 'mp3';

export type JobStatus = 'queued' | 'preparing' | 'ready' | 'downloading' | 'complete' | 'error' | 'cancelled';

export interface DownloadJob {
  id: string;
  url: string;
  platform: DownloadPlatform;
  youtubeFormat: YoutubeFormat;
  status: JobStatus;
  /** 0–100 for current file or overall */
  progress: number;
  label: string;
  detail?: string;
  errorMessage?: string;
  serverJobId?: string;
  files: PreparedFile[];
}

export interface PreparedFile {
  name: string;
  size?: number;
  localUrl?: string;
  /** Path segment for API file route */
  href: string;
}

export interface CreateJobRequest {
  url: string;
  platform: DownloadPlatform;
  youtubeFormat: YoutubeFormat;
}

export interface CreateJobResponse {
  jobId: string;
}

export interface JobStatusResponse {
  id: string;
  state: 'pending' | 'running' | 'complete' | 'error';
  progress: number;
  line?: string;
  files: { name: string; size: number; href: string }[];
  error?: string;
}
