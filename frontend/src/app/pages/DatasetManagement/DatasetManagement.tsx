import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  Loader2,
  MonitorPlay,
  Play,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { PageHeader, RefreshButton, SubTabs } from "../../components/wireframe";
import { useHfAuth } from "../../hf-auth-context";
import { cn } from "../../components/ui/utils";
import { apiDelete, apiGet, apiPost } from "../../services/apiClient";
import { fromBackendDatasetList } from "../../services/contracts";
import { useLeStudioStore } from "../../store";
import {
  type DatasetDeleteResponse,
  type DatasetDetail,
  type DatasetPushStartResponse,
  type DatasetPushStatusResponse,
  type DatasetQualityResponse,
  type LocalDataset,
  type TagType,
  type TagsResponse,
} from "./types";
import { formatMetric, parseDatasetId } from "./utils";
import { AutoFlagPanelContent } from "./components/AutoFlagPanelContent";
import { CurationPanelContent } from "./components/CurationPanelContent";
import { HfGateBanner } from "./components/HfGateBanner";
import { HubSearchPanel } from "./components/HubSearchPanel";
import { VideoPlayerPanel } from "./components/VideoPlayerPanel";

export function DatasetManagement() {
  const { hfAuth } = useHfAuth();
  const addToast = useLeStudioStore((s) => s.addToast);
  const [pageTab, setPageTab] = useState<"local" | "hub">("local");
  const [localDatasets, setLocalDatasets] = useState<LocalDataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<LocalDataset | null>(null);
  const [detailData, setDetailData] = useState<DatasetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [qualityData, setQualityData] = useState<DatasetQualityResponse | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [datasetTags, setDatasetTags] = useState<Record<string, TagType>>({});
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [pushJobId, setPushJobId] = useState("");
  const [pushStatus, setPushStatus] = useState<DatasetPushStatusResponse | null>(null);
  const [detailTab, setDetailTab] = useState<"player" | "quality" | "curation">("player");
  const [jumpEpisode, setJumpEpisode] = useState<number | undefined>(undefined);
  const [envMetaOpen, setEnvMetaOpen] = useState(false);

  const fetchDetail = async (datasetId: string) => {
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const detail = await apiGet<DatasetDetail>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`,
      );
      if (Array.isArray(detail?.cameras)) setDetailData(detail);
    } catch {
      /* silent — player will show error state */
    } finally {
      setDetailLoading(false);
    }
  };

  const loadDatasets = async () => {
    apiGet<unknown>("/api/datasets").then((res) => {
      const datasets = fromBackendDatasetList(res);
      setLocalDatasets(datasets);
      if (datasets.length > 0) {
        setSelectedDataset(datasets[0]);
        void fetchDetail(datasets[0].id);
      } else {
        setSelectedDataset(null);
        setDetailData(null);
        setQualityData(null);
        setDatasetTags({});
        setPushJobId("");
        setPushStatus(null);
      }
    });
  };

  useEffect(() => {
    void loadDatasets();
    apiGet<unknown>("/api/datasets").then((res) => {
      const datasets = fromBackendDatasetList(res);
      setLocalDatasets(datasets);
      if (datasets.length > 0) {
        setSelectedDataset(datasets[0]);
        void fetchDetail(datasets[0].id);
      }
    });
  }, []);

  const selectDataset = (ds: LocalDataset) => {
    setSelectedDataset(ds);
    setQualityData(null);
    setPushJobId("");
    setPushStatus(null);
    setDatasetTags({});
    void fetchDetail(ds.id);
  };

  const refreshDatasetTags = async (datasetId: string) => {
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;
    try {
      const tagRes = await apiGet<TagsResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags`,
      );
      setDatasetTags(tagRes.ok ? (tagRes.tags ?? {}) : {});
    } catch {
      setDatasetTags({});
    }
  };

  useEffect(() => {
    if (!selectedDataset) return;
    void refreshDatasetTags(selectedDataset.id);
  }, [selectedDataset?.id]);

  const handleInspectQuality = async () => {
    if (!selectedDataset) return;
    const parsed = parseDatasetId(selectedDataset.id);
    if (!parsed) return;
    setQualityLoading(true);
    try {
      const res = await apiGet<DatasetQualityResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/quality`,
      );
      if (!res.ok) {
        addToast(res.error ?? "Quality check failed", "error");
        return;
      }
      setQualityData(res);
      addToast("Quality check complete", "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Quality check failed", "error");
    } finally {
      setQualityLoading(false);
    }
  };

  const handlePushToHub = async () => {
    if (!selectedDataset || hfAuth !== "ready") return;
    const parsed = parseDatasetId(selectedDataset.id);
    if (!parsed) return;
    try {
      const res = await apiPost<DatasetPushStartResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/push`,
        { target_repo_id: selectedDataset.id },
      );
      if (!res.ok || !res.job_id) {
        addToast(res.error ?? "Failed to start Hub push", "error");
        setPushStatus({ status: "error", phase: "error", progress: 0, error: res.error });
        return;
      }
      setPushJobId(res.job_id);
      setPushStatus({ status: "queued", phase: "queued", progress: 5, logs: ["Upload job queued"] });
      addToast("Hub push started", "info");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to start Hub push", "error");
    }
  };

  const handleDeleteDataset = async (datasetId: string) => {
    if (deletingDatasetId) return;
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;

    const confirmed = window.confirm(
      `Delete local dataset "${datasetId}"?\n\nThis will remove the local cache files permanently.`,
    );
    if (!confirmed) return;

    setDeletingDatasetId(datasetId);
    try {
      const res = await apiDelete<DatasetDeleteResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`,
      );
      if (!res.ok) {
        addToast(res.detail ?? res.error ?? "Failed to delete dataset", "error");
        return;
      }

      addToast(`Deleted: ${datasetId}`, "success");

      if (selectedDataset?.id === datasetId) {
        setSelectedDataset(null);
        setDetailData(null);
        setQualityData(null);
        setDatasetTags({});
      }

      await loadDatasets();
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to delete dataset", "error");
    } finally {
      setDeletingDatasetId(null);
    }
  };

  useEffect(() => {
    if (!pushJobId) return;
    const timer = window.setInterval(async () => {
      const status = await apiGet<DatasetPushStatusResponse>(`/api/datasets/push/status/${encodeURIComponent(pushJobId)}`);
      if (!status.ok) {
        setPushStatus({ status: "error", phase: "error", progress: 0, error: status.error });
        setPushJobId("");
        return;
      }
      setPushStatus(status);
      const s = String(status.status ?? "running");
      if (s === "success" || s === "error") {
        setPushJobId("");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [pushJobId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <PageHeader
            title="Dataset Management"
            subtitle="Manage datasets, quality checks, Hub integration, and curation"
            action={<RefreshButton onClick={() => { void loadDatasets(); }} />}
          />

          {/* Page-level Tabs */}
          <div className="flex flex-col gap-4">
            <SubTabs
              tabs={[
                { key: "local", icon: <MonitorPlay size={13} />, label: "Local Datasets" },
                { key: "hub", icon: <Download size={13} />, label: "Hub Download" },
              ]}
              activeKey={pageTab}
              onChange={(k) => setPageTab(k as "local" | "hub")}
              className="mx-auto"
            />

          {/* Hub Download Tab */}
          {pageTab === "hub" && (
            <div className="flex flex-col gap-4">
              {hfAuth !== "ready" && (
                <HfGateBanner authState={hfAuth} level="hf_read" />
              )}
              <HubSearchPanel />
            </div>
          )}

          {/* Local Dataset Tab */}
          {pageTab === "local" && (
          <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6 items-start">

            {/* Left Column: List (Fixed 320px) */}
            <div className="flex w-full flex-col gap-4 xl:sticky xl:top-6">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Local Datasets</span>
                  <span className="text-sm text-zinc-400">{localDatasets.length} items</span>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {localDatasets.map((ds) => (
                    <div
                      key={ds.id}
                      onClick={() => selectDataset(ds)}
                      className={cn(
                        "group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                        selectedDataset?.id === ds.id
                          ? "bg-blue-50/50 dark:bg-blue-900/20"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                      )}
                    >
                      {selectedDataset?.id === ds.id
                        ? <div className="w-1 h-6 rounded-full bg-blue-500 flex-none" />
                        : <div className="w-1 h-6 rounded-full bg-transparent flex-none" />
                      }
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                          {ds.id.split("/")[1]}
                        </div>
                        <div className="text-sm text-zinc-400 mt-0.5">
                          {ds.episodes} eps · {ds.frames} frames · {ds.size}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteDataset(ds.id);
                        }}
                        disabled={deletingDatasetId === ds.id}
                        className="p-1 rounded text-zinc-400 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-all flex-none disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Delete"
                        aria-label={`Delete ${ds.id}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                {/* Add link */}
                <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-center">
                  <Link to="/record" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline">
                    + Record new dataset
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Column: Detail (Fluid) */}
            <div className="flex flex-col gap-6">

              {/* Dataset Header / Actions */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                {!selectedDataset ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <Search size={28} className="text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400">Select a dataset to view details.</p>
                  </div>
                ) : (<>
                {/* Header bar: title + actions */}
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium font-mono text-zinc-700 dark:text-zinc-200 truncate">{selectedDataset?.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    {hfAuth === "ready" ? (
                      <button
                        onClick={() => { void handlePushToHub(); }}
                        disabled={!selectedDataset}
                        className="p-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        title="Upload to Hub"
                        aria-label="Upload to Hub"
                      >
                        <Upload size={12} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedDataset?.id) {
                          void handleDeleteDataset(selectedDataset.id);
                        }
                      }}
                      disabled={!selectedDataset}
                      className="p-1 rounded text-zinc-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-zinc-400 transition-colors"
                      title="Delete dataset"
                      aria-label="Delete dataset"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Sub-tabs */}
                <div className="px-2 pt-2">
                  <SubTabs
                    tabs={[
                      { key: "player", icon: <Play size={12} />, label: "Playback" },
                      { key: "quality", icon: <AlertTriangle size={12} />, label: "Quality Check" },
                      { key: "curation", icon: <Filter size={12} />, label: "Curation" },
                    ]}
                    activeKey={detailTab}
                    onChange={(k) => setDetailTab(k as "player" | "quality" | "curation")}
                  />
                </div>
                {/* Info row */}
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-4 text-sm text-zinc-500">
                    <span className="flex items-center gap-1"><MonitorPlay size={12} /> {formatMetric(selectedDataset?.episodes, "eps")}</span>
                    <span>{formatMetric(selectedDataset?.frames, "frames")}</span>
                    <span>{formatMetric(detailData?.fps, "FPS")}</span>
                    <span>{selectedDataset?.size}</span>
                    <span className="text-zinc-400">{selectedDataset?.modified}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {(selectedDataset?.tags ?? []).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">{t}</span>
                    ))}
                  </div>
                </div>

                {/* Recording environment metadata */}
                {detailData && (detailData.robot_type || detailData.camera_details?.length || detailData.joint_names?.length) && (
                  <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
                    <button
                      onClick={() => setEnvMetaOpen(!envMetaOpen)}
                      className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer"
                    >
                      Recording Environment
                      {envMetaOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                    {envMetaOpen && (
                      <div className="mt-2 pl-2 border-l-2 border-zinc-100 dark:border-zinc-800 flex flex-col gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {detailData.robot_type && (
                          <div>
                            <span className="text-zinc-400">Robot Type:</span>{" "}
                            <span className="font-mono text-zinc-600 dark:text-zinc-300">{detailData.robot_type}</span>
                          </div>
                        )}
                        {detailData.camera_details && detailData.camera_details.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-zinc-400">Cameras:</span>
                            {detailData.camera_details.map((cam) => (
                              <div key={cam.name} className="ml-2 font-mono text-zinc-600 dark:text-zinc-300">
                                {cam.name}
                                <span className="text-zinc-400 ml-1">
                                  {cam.width && cam.height ? `${cam.width}×${cam.height}` : ""}
                                  {cam.fps ? ` ${cam.fps}fps` : ""}
                                  {cam.codec ? ` ${cam.codec}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {detailData.joint_names && detailData.joint_names.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-zinc-400">Joints ({detailData.joint_names.length}):</span>
                            <div className="ml-2 font-mono text-zinc-600 dark:text-zinc-300">
                              {detailData.joint_names.join(", ")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Hub Push Status */}
                {pushStatus && (
                  <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 animate-in slide-in-from-top-2">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                        {String(pushStatus.status ?? "running") === "success" ? <CheckCircle2 size={12} /> : <Upload size={12} className="animate-bounce" />}
                        {String(pushStatus.status ?? "running") === "success" ? "Upload Complete" : `Pushing to Hugging Face Hub... (${pushStatus.phase ?? "running"})`}
                      </span>
                      <span className="text-zinc-500">{Math.max(0, Math.min(100, Number(pushStatus.progress ?? 0)))}%</span>
                    </div>
                    <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                        style={{ width: `${Math.max(0, Math.min(100, Number(pushStatus.progress ?? 0)))}%` }}
                      />
                    </div>
                    {pushStatus.error && (
                      <div className="text-xs text-red-500 mt-2">{pushStatus.error}</div>
                    )}
                  </div>
                )}

                {/* Quality Check Results */}
                {qualityData && (
                  <div className="px-3 py-3 border-t border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border-4 border-emerald-100 text-emerald-600">
                        <span className="text-xl font-bold">{Math.max(0, Math.min(100, Number(qualityData.score ?? 0)))}</span>
                        <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Score</span>
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">Quality Assessment Report</h4>
                        <p className="text-sm text-zinc-500 mt-0.5">Checked {Array.isArray(qualityData.checks) ? qualityData.checks.length : 0} items across {selectedDataset?.episodes} episodes.</p>
                      </div>
                      <Link to="/train" className="text-sm px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                        → Go to AI Training
                      </Link>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(qualityData.checks ?? []).map((item, idx) => (
                        <div key={`${item.name ?? "check"}-${idx}`} className="flex items-start gap-3 p-2 rounded bg-zinc-50 dark:bg-zinc-800/50">
                           {item.level === "ok" ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5" /> : <AlertTriangle size={14} className="text-amber-500 mt-0.5" />}
                           <div>
                             <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{item.name ?? `check-${idx}`}</div>
                             <div className="text-sm text-zinc-500">{item.message ?? ""}</div>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailTab === "player" && selectedDataset && (
                  detailLoading ? (
                    <div className="p-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
                      <Loader2 size={14} className="animate-spin" /> Loading episode data...
                    </div>
                  ) : detailData ? (
                    <VideoPlayerPanel
                      detail={detailData}
                      datasetId={selectedDataset.id}
                      onTagsChanged={() => { void refreshDatasetTags(selectedDataset.id); }}
                      initialEpisode={jumpEpisode}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                      <div className="text-3xl opacity-30">
                        <AlertTriangle size={28} />
                      </div>
                      <p className="text-sm text-zinc-400 max-w-xs">Unable to load data.</p>
                    </div>
                  )
                )}
                {detailTab === "quality" && selectedDataset && (
                  <AutoFlagPanelContent
                    datasetId={selectedDataset.id}
                    totalEpisodes={detailData?.total_episodes ?? selectedDataset.episodes}
                    tags={datasetTags}
                    onTagsChanged={() => { void refreshDatasetTags(selectedDataset.id); }}
                    onPreviewEpisode={(ep) => { setJumpEpisode(ep); setDetailTab("player"); }}
                  />
                )}
                {detailTab === "curation" && selectedDataset && detailData && (
                  <CurationPanelContent
                    datasetId={selectedDataset.id}
                    detail={detailData}
                    tags={datasetTags}
                    onDerived={(newRepoId) => {
                      void apiGet<unknown>("/api/datasets").then((res) => {
                        const datasets = fromBackendDatasetList(res);
                        setLocalDatasets(datasets);
                        const next = datasets.find((ds) => ds.id === newRepoId);
                        if (next) {
                          setSelectedDataset(next);
                          void fetchDetail(next.id);
                          void refreshDatasetTags(next.id);
                        }
                      });
                    }}
                  />
                )}
                </>)}
              </div>

            </div>
          </div>
          )}
          </div>

        </div>
      </div>

    </div>
  );
}
