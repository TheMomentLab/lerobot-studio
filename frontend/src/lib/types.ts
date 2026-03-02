export type Toast = {
  id: string
  message: string
  kind: 'success' | 'info' | 'warn' | 'error'
}

export type LogLine = {
  id: string
  text: string
  kind: string
  ts: number
}

export type SidebarSignals = {
  rulesNeedsRoot: boolean
  rulesNeedsInstall: boolean
  hasCameras: boolean
  hasArms: boolean
  trainMissingDep: boolean
  datasetMissingDep: boolean
}

export type CameraDevice = {
  device: string
  path: string
  symlink: string
  model: string
  kernels: string
  serial: string
}

export type ArmDevice = {
  device: string
  path: string
  symlink: string
  model: string
  kernels: string
  serial: string
}

export type DevicesResponse = {
  cameras: CameraDevice[]
  arms: ArmDevice[]
}

export type RobotCapabilities = {
  display_name?: string
  description?: string
  has_arm: boolean
  arm_count: number
  has_mobile_base: boolean
  has_cameras: boolean
  is_remote: boolean
  has_keyboard_teleop: boolean
  connection_type: string
}

export type RobotDetail = {
  display_name?: string
  description?: string
  capabilities?: RobotCapabilities
  compatible_teleops?: string[]
}

export type RobotsResponse = {
  types?: string[]
  details?: Record<string, RobotDetail>
}

export type TeleopsResponse = {
  types?: string[]
}

export type PreflightCheck = {
  status: 'ok' | 'warn' | 'error'
  label: string
  msg: string
}

export type PreflightResponse = {
  ok: boolean
  checks: PreflightCheck[]
}

export type DatasetListItem = {
  id: string
  total_episodes?: number
  total_frames?: number
  size_mb?: number
  modified?: string
  timestamp?: number
}

export type DatasetVideoRef = {
  chunk_index?: number
  file_index?: number
  from_timestamp?: number
  to_timestamp?: number
}

export type DatasetEpisode = {
  episode_index: number
  length?: number
  video_files?: Record<string, DatasetVideoRef>
}

export type DatasetDetail = {
  dataset_id: string
  total_episodes: number
  total_frames: number
  fps: number
  cameras: string[]
  episodes: DatasetEpisode[]
}

export type LeStudioConfig = {
  robot_mode?: 'single' | 'bi' | string
  robot_type?: string
  teleop_type?: string
  robot_id?: string
  teleop_id?: string
  follower_port?: string
  leader_port?: string
  left_follower_port?: string
  right_follower_port?: string
  left_leader_port?: string
  right_leader_port?: string
  left_robot_id?: string
  right_robot_id?: string
  left_teleop_id?: string
  right_teleop_id?: string
  teleop_speed?: string
  cameras?: string[] | Record<string, string>
  camera_settings?: Record<string, unknown>
  record_task?: string
  record_episodes?: number
  record_repo_id?: string
  record_resume?: boolean
  record_push_to_hub?: boolean
  train_repo_id?: string
  dataset_repo_id?: string
  train_dataset_source?: string
  train_policy?: string
  train_steps?: number
  train_batch_size?: number
  train_device?: string
  train_lr?: number | string
  train_output_repo?: string
  eval_policy_path?: string
  eval_env_type?: string
  eval_robot_type?: string
  eval_teleop_type?: string
  eval_repo_id?: string
  eval_episodes?: number
  eval_device?: string
  eval_task?: string
  eval_cam_width?: number
  eval_cam_height?: number
  eval_cam_fps?: number
  record_cam_width?: number
  record_cam_height?: number
  record_cam_fps?: number
  profile_name?: string
  process_view_url?: string
}

export type WsOutputMessage = {
  type: 'output'
  process: string
  text?: string
  line?: string
  kind?: string
}

export type WsStatusMessage = {
  type: 'status'
  processes: Record<string, boolean>
}

export type WsApiHealthMessage = {
  type: 'api_health'
  key: string
  value: boolean
}

export type WsApiSupportMessage = {
  type: 'api_support'
  key: string
  value: boolean
}

export type WsMetricMessage = {
  type: 'metric'
  process: string
  metric: {
    step?: number
    total?: number
    loss?: number
    lr?: number
  }
}

export type WsMessage =
  | WsOutputMessage
  | WsStatusMessage
  | WsApiHealthMessage
  | WsApiSupportMessage
  | WsMetricMessage
