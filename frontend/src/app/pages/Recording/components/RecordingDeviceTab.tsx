import { FieldRow, WireSelect } from "../../../components/wireframe";

type RecordingDeviceTabProps = {
  mode: string;
  armPortOptions: string[];
  followerIdOptions: string[];
  leaderIdOptions: string[];
  bimanualIdOptions: string[];
  selectedFollowerPort: string;
  selectedLeaderPort: string;
  selectedFollowerId: string;
  selectedLeaderId: string;
  selectedBimanualId: string;
  setSelectedFollowerPort: (value: string) => void;
  setSelectedLeaderPort: (value: string) => void;
  setSelectedFollowerId: (value: string) => void;
  setSelectedLeaderId: (value: string) => void;
  setSelectedBimanualId: (value: string) => void;
};

export function RecordingDeviceTab({
  mode,
  armPortOptions,
  followerIdOptions,
  leaderIdOptions,
  bimanualIdOptions,
  selectedFollowerPort,
  selectedLeaderPort,
  selectedFollowerId,
  selectedLeaderId,
  selectedBimanualId,
  setSelectedFollowerPort,
  setSelectedLeaderPort,
  setSelectedFollowerId,
  setSelectedLeaderId,
  setSelectedBimanualId,
}: RecordingDeviceTabProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Device Configuration</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        <p className="text-sm text-zinc-400">Select robot type and control method.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <FieldRow label="Robot Type">
            <WireSelect value="so101_follower" options={["so101_follower", "so100_follower"]} />
          </FieldRow>
          <FieldRow label="Teleop Type">
            <WireSelect value="so101_leader" options={["so101_leader", "keyboard"]} />
          </FieldRow>
        </div>
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
          <p className="text-sm text-zinc-400">Select device ports to connect.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {mode === "Single Arm" ? (
              <>
                <FieldRow label="Follower Port">
                  <WireSelect
                    placeholder={armPortOptions.length === 0 ? "No ports detected" : undefined}
                    value={selectedFollowerPort}
                    options={armPortOptions}
                    onChange={setSelectedFollowerPort}
                  />
                </FieldRow>
                <FieldRow label="Leader Port">
                  <WireSelect
                    placeholder={armPortOptions.length === 0 ? "No ports detected" : undefined}
                    value={selectedLeaderPort}
                    options={armPortOptions}
                    onChange={setSelectedLeaderPort}
                  />
                </FieldRow>
              </>
            ) : (
              <>
                {["Left Follower", "Right Follower", "Left Leader", "Right Leader"].map((label) => (
                  <FieldRow key={label} label={label}>
                    <WireSelect
                      placeholder={armPortOptions.length === 0 ? "No ports detected" : `${label} Port`}
                      options={armPortOptions}
                    />
                  </FieldRow>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
          <p className="text-sm text-zinc-400">Select calibration profile.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {mode === "Single Arm" ? (
              <>
                <FieldRow label="Follower ID">
                  <WireSelect
                    placeholder={followerIdOptions.length === 0 ? "No calibration files" : undefined}
                    value={selectedFollowerId}
                    options={followerIdOptions}
                    onChange={setSelectedFollowerId}
                  />
                </FieldRow>
                <FieldRow label="Leader ID">
                  <WireSelect
                    placeholder={leaderIdOptions.length === 0 ? "No calibration files" : undefined}
                    value={selectedLeaderId}
                    options={leaderIdOptions}
                    onChange={setSelectedLeaderId}
                  />
                </FieldRow>
              </>
            ) : (
              <FieldRow label="Robot ID">
                <WireSelect
                  placeholder={bimanualIdOptions.length === 0 ? "No calibration files" : undefined}
                  value={selectedBimanualId}
                  options={bimanualIdOptions}
                  onChange={setSelectedBimanualId}
                />
              </FieldRow>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
