export const SETUP_MOTORS = [
  { name: "gripper", id: 6 },
  { name: "wrist_roll", id: 5 },
  { name: "wrist_flex", id: 4 },
  { name: "elbow_flex", id: 3 },
  { name: "shoulder_lift", id: 2 },
  { name: "shoulder_pan", id: 1 },
];

export const ARM_TYPES = ["so101_follower", "so100_follower", "so101_leader", "so100_leader"];

export const MOTOR_SETUP_TYPES = [
  "so101_follower",
  "so100_follower",
  "so101_leader",
  "so100_leader",
  "koch_follower",
  "koch_leader",
  "omx_follower",
  "omx_leader",
  "lekiwi",
];

export function toArmSymlink(roleLabel: string): string {
  if (roleLabel === "Follower Arm 1") return "follower_arm_1";
  if (roleLabel === "Follower Arm 2") return "follower_arm_2";
  if (roleLabel === "Leader Arm 1") return "leader_arm_1";
  if (roleLabel === "Leader Arm 2") return "leader_arm_2";
  return "(none)";
}

export const LOAD_WARN = 700;
export const LOAD_DANGER = 1023;
export const CURRENT_WARN = 560;
export const CURRENT_DANGER = 800;
