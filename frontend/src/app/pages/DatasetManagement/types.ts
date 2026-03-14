export type LocalDataset = {
  id: string;
  episodes: number;
  frames: number;
  size: string;
  modified: string;
  tags?: string[];
};

export type HubResult = {
  id: string;
  desc: string;
  downloads: number;
  likes: number;
  tags: string[];
  modified: string;
};

export type MyHubDataset = {
  id: string;
  downloads: number;
  likes: number;
  size: string;
  modified: string;
  local_sync: boolean;
};

export type MyHubDatasetsResponse = {
  ok?: boolean;
  username?: string;
  datasets?: MyHubDataset[];
  error?: string;
};

export type HubDownloadStartResponse = {
  ok?: boolean;
  job_id?: string;
  error?: string;
};

export type HubDownloadStatusResponse = {
  ok?: boolean;
  status?: string;
  progress?: number;
  logs?: string[];
  error?: string;
};

export type DatasetPushStartResponse = {
  ok?: boolean;
  job_id?: string;
  error?: string;
};

export type DatasetPushStatusResponse = {
  ok?: boolean;
  status?: string;
  phase?: string;
  progress?: number;
  logs?: string[];
  repo_id?: string;
  error?: string;
};

export type DatasetDeleteResponse = {
  ok?: boolean;
  detail?: string;
  error?: string;
};

export type QualityCheck = {
  level?: "ok" | "warn" | "error";
  name?: string;
  message?: string;
};

export type DatasetQualityResponse = {
  ok?: boolean;
  score?: number;
  checks?: QualityCheck[];
  error?: string;
};

export type EpisodeStat = {
  episode_index: number;
  frames: number;
  movement: number;
  jerk_score: number;
  jerk_ratio?: number;
};

export type StatsSummaryMetric = {
  min: number;
  max: number;
  p25: number;
  p75: number;
  median: number;
};

export type DatasetStatsResponse = {
  ok?: boolean;
  episodes?: EpisodeStat[];
  dataset_summary?: {
    frames?: StatsSummaryMetric;
    movement?: StatsSummaryMetric;
    jerk_score?: StatsSummaryMetric;
    jerk_ratio?: StatsSummaryMetric;
  };
  error?: string;
};

export type StatsRecomputeResponse = {
  ok?: boolean;
  status?: string;
  cached?: boolean;
  job_id?: string;
  error?: string;
};

export type StatsStatusResponse = {
  ok?: boolean;
  status?: string;
  phase?: string;
  progress?: number;
  error?: string;
};

export type BulkTagsResponse = {
  ok?: boolean;
  applied?: number;
  error?: string;
};

export type DeriveStartResponse = {
  ok?: boolean;
  job_id?: string;
  error?: string;
};

export type DeriveStatusResponse = {
  ok?: boolean;
  status?: string;
  phase?: string;
  progress?: number;
  logs?: string[];
  error?: string;
  keep_count?: number;
  delete_count?: number;
};

export type TagType = "good" | "bad" | "review" | "untagged";

export type TagsResponse = {
  ok?: boolean;
  tags?: Record<string, TagType>;
};

export type DatasetVideoRef = {
  chunk_index?: number;
  file_index?: number;
  from_timestamp?: number;
  to_timestamp?: number;
};

export type DatasetEpisode = {
  episode_index: number;
  length?: number;
  video_files?: Record<string, DatasetVideoRef>;
};

export type CameraDetail = {
  name: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
};

export type DatasetDetail = {
  dataset_id: string;
  total_episodes: number;
  total_frames: number;
  fps: number;
  cameras: string[];
  episodes: DatasetEpisode[];
  robot_type?: string;
  camera_details?: CameraDetail[];
  joint_names?: string[];
};

export type HfGateBannerProps = {
  authState: string;
  level: "hf_read" | "hf_write";
};
