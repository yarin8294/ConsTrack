import { createContext, useEffect, useMemo, useState } from "react";
import type { AppData, AreaId, AreaNode, ComparisonRun, ScanId } from "./types";
import {
  chat,
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  createReport,
  createRun,
  createZone,
  deleteScan,
  deleteZone,
  fetchDashboard,
  fetchRecommendations,
  fetchReports,
  fetchRuns,
  fetchScans,
  fetchZones,
  fetchWorkDiary,
  patchZoneLinks,
  patchZone,
  syncSchedule,
  uploadScan,
  type ProjectSummary,
} from "./api";
import { useProject } from "../project/useProject";
import { useRealtime } from "../realtime/useRealtime";

type AppDataContextValue = {
  data: AppData;
  isLoading: boolean;
  error?: string;
  projects: ProjectSummary[];

  // Scans
  addScan: (file: File, capturedAtISO: string, notes?: string, zoneId?: string) => Promise<void>;
  removeScan: (scanId: ScanId) => Promise<void>;
  setSelectedT1: (scanId?: ScanId) => void;
  setSelectedT2: (scanId?: ScanId) => void;

  // Zones
  addArea: (name: string, type: AreaNode["type"], parentId?: AreaId) => Promise<string>;
  renameArea: (id: AreaId, name: string) => Promise<void>;
  removeArea: (id: AreaId) => Promise<void>;
  setAreaCompletion: (id: AreaId, completionPct: number) => Promise<void>;
  linkScanToArea: (id: AreaId, scanIds: string[]) => Promise<void>;

  // Comparison
  runComparison: () => Promise<void>;

  // Reports
  refreshReports: () => Promise<void>;
  generateReportForRun: (runId: string) => Promise<void>;

  // Chat
  sendChat: (prompt: string) => Promise<string>;

  // Dashboard
  refreshDashboard: () => Promise<void>;
  fetchRecommendations: () => Promise<string[]>;
  syncSchedule: (provider: "msproject" | "primavera", token: string) => Promise<any>;
  fetchWorkDiary: () => Promise<any>;
  setProjectId: (projectId: string) => void;
  createProject: (name: string) => Promise<string>;
  createProjectFull: (data: { name: string; description?: string; startDateISO?: string; targetFinishDateISO?: string }) => Promise<string>;
  updateProject: (id: string, data: { name?: string; description?: string; startDateISO?: string; targetFinishDateISO?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  dashboard: {
    overallProgressPct: number;
    volumeChangeM3: number;
    forecastCompletionISO: string;
    productivityIndex: number;
    series: { t: string; progressPct: number }[];
  };
  reports: { id: string; createdAtISO: string; pdfUrl: string; xlsxUrl: string; runId: string }[];
};

export const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  // Project state now lives in ProjectContext — read it from there
  const {
    projects,
    activeProjectId,
    isLoading: projectsLoading,
    setProjectId,
    createProject: createProjectFromCtx,
    refreshProjects,
  } = useProject();

  const [data, setData] = useState<AppData>({ scans: [], areas: [], runs: [] });
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [dashboard, setDashboard] = useState<AppDataContextValue["dashboard"]>({
    overallProgressPct: 0,
    volumeChangeM3: 0,
    forecastCompletionISO: "",
    productivityIndex: 1.0,
    series: [],
  });
  const [reports, setReports] = useState<AppDataContextValue["reports"]>([]);

  const { subscribe } = useRealtime();
  const lsT1 = (pid: string) => `constrack_t1_${pid}`;
  const lsT2 = (pid: string) => `constrack_t2_${pid}`;

  async function loadAll(projectId: string) {
    const [zones, scans, runs, dash, reps] = await Promise.all([
      fetchZones(projectId),
      fetchScans(projectId),
      fetchRuns(projectId),
      fetchDashboard(projectId),
      fetchReports(projectId),
    ]);

    const scanIdSet = new Set(scans.map((s) => s.id));
    const rawT1 = localStorage.getItem(lsT1(projectId));
    const rawT2 = localStorage.getItem(lsT2(projectId));
    const restoredT1 = rawT1 && scanIdSet.has(rawT1) ? rawT1 : undefined;
    const restoredT2 = rawT2 && scanIdSet.has(rawT2) ? rawT2 : undefined;

    setData((prev) => ({
      ...prev,
      projectId,
      selectedT1: restoredT1,
      selectedT2: restoredT2,
      areas: zones.map((z) => ({
        id: z.id,
        name: z.name,
        type: z.type as AreaNode["type"],
        parentId: z.parentId,
        completionPct: z.completionPct,
        linkedScanIds: z.linkedScanIds || [],
      })),
      scans: scans.map((s) => ({
        id: s.id,
        name: s.name,
        sizeBytes: s.sizeBytes,
        capturedAtISO: s.capturedAtISO,
        uploadedAtISO: s.uploadedAtISO,
        notes: s.notes,
      })),
      runs: (runs || []).map((r) => ({
        id: r.id,
        createdAtISO: r.createdAtISO,
        t1ScanId: r.t1ScanId,
        t2ScanId: r.t2ScanId,
        status: r.status,
        error: r.error,
        alignmentConfidence: r.alignmentConfidence || "medium",
        forecastCompletionISO: r.forecastCompletionISO || "",
        overallProgressPct: r.overallProgressPct || 0,
        volumeT1M3: r.volumeT1M3,
        volumeT2M3: r.volumeT2M3,
        volumeChangeM3: r.volumeChangeM3,
        metricsByArea: (r.metricsByZone || []).map((m: any) => ({
          areaId: m.zoneId,
          progressPct: m.progressPct,
          volumeChangeM3: m.volumeChangeM3,
          areaChangeM2: 0,
          workRatePerDay: 0,
          deviationDays: 0,
        })),
      })) as ComparisonRun[],
    }));

    setDashboard(dash);
    setReports(
      (reps || []).map((x) => ({
        id: x.id,
        createdAtISO: x.createdAtISO,
        pdfUrl: x.pdfUrl,
        xlsxUrl: x.xlsxUrl,
        runId: x.runId,
      }))
    );
  }

  // Load project data whenever the active project changes
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        setDataLoading(true);
        await loadAll(activeProjectId);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId]);

  // Refresh data when the backend signals a run has changed
  useEffect(() => {
    if (!activeProjectId) return;
    const unsub1 = subscribe("run.done", () => loadAll(activeProjectId));
    const unsub2 = subscribe("run.created", () => loadAll(activeProjectId));
    return () => { unsub1(); unsub2(); };
  }, [activeProjectId, subscribe]);

  const api = useMemo<AppDataContextValue>(() => {
    const getProjectId = () => {
      const pid = activeProjectId || data.projectId;
      if (!pid) throw new Error("projectId not loaded");
      return pid;
    };

    return {
      data,
      // Expose combined loading: true while either project list or project data is loading
      isLoading: projectsLoading || dataLoading,
      error,
      projects,
      dashboard,
      reports,

      // Project mutations — delegate to ProjectContext; AppDataProvider keeps these in its
      // public surface so existing useAppData() call-sites don't need updating.
      setProjectId,
      createProject: createProjectFromCtx,

      createProjectFull: async (payload) => {
        const trimmed = String(payload.name || "").trim();
        if (trimmed.length < 2) throw new Error("Project name is required");
        const created = await apiCreateProject({ ...payload, name: trimmed });
        await refreshProjects();
        setProjectId(created.id);
        return created.id;
      },

      updateProject: async (id, payload) => {
        await apiUpdateProject(id, payload);
        await refreshProjects();
      },

      deleteProject: async (id) => {
        await apiDeleteProject(id);
        const newList = await refreshProjects();
        if (activeProjectId === id) {
          const next = newList[0]?.id;
          if (next) setProjectId(next);
        }
      },

      addScan: async (file, capturedAtISO, notes, zoneId) => {
        const projectId = getProjectId();
        await uploadScan(projectId, file, capturedAtISO, notes, zoneId);
        await loadAll(projectId);
      },

      removeScan: async (scanId) => {
        const projectId = getProjectId();
        await deleteScan(scanId);
        if (localStorage.getItem(lsT1(projectId)) === scanId) localStorage.removeItem(lsT1(projectId));
        if (localStorage.getItem(lsT2(projectId)) === scanId) localStorage.removeItem(lsT2(projectId));
        setData((prev) => ({
          ...prev,
          selectedT1: prev.selectedT1 === scanId ? undefined : prev.selectedT1,
          selectedT2: prev.selectedT2 === scanId ? undefined : prev.selectedT2,
          areas: prev.areas.map((area) => ({
            ...area,
            linkedScanIds: area.linkedScanIds?.filter((id) => id !== scanId) || [],
          })),
        }));
        await loadAll(projectId);
      },

      setSelectedT1: (scanId) => {
        const pid = activeProjectId || data.projectId;
        if (pid) {
          if (scanId) localStorage.setItem(lsT1(pid), scanId);
          else localStorage.removeItem(lsT1(pid));
        }
        setData((p) => ({ ...p, selectedT1: scanId }));
      },

      setSelectedT2: (scanId) => {
        const pid = activeProjectId || data.projectId;
        if (pid) {
          if (scanId) localStorage.setItem(lsT2(pid), scanId);
          else localStorage.removeItem(lsT2(pid));
        }
        setData((p) => ({ ...p, selectedT2: scanId }));
      },

      addArea: async (name, type, parentId) => {
        const projectId = getProjectId();
        const result = await createZone(projectId, { name, type, parentId });
        await loadAll(projectId);
        return result.id;
      },

      renameArea: async (id, name) => {
        const projectId = getProjectId();
        await patchZone(id, { name });
        await loadAll(projectId);
      },

      removeArea: async (id) => {
        const projectId = getProjectId();
        await deleteZone(id);
        await loadAll(projectId);
      },

      setAreaCompletion: async (id, completionPct) => {
        const projectId = getProjectId();
        await patchZone(id, { completionPct });
        await loadAll(projectId);
      },

      linkScanToArea: async (id, scanIds) => {
        const projectId = getProjectId();
        await patchZoneLinks(id, scanIds);
        await loadAll(projectId);
      },

      runComparison: async () => {
        const projectId = getProjectId();
        const t1 = data.selectedT1;
        const t2 = data.selectedT2;
        if (!t1 || !t2 || t1 === t2) throw new Error("Select two different scans");
        await createRun(projectId, t1, t2, 0.05);
        await loadAll(projectId);
      },

      refreshReports: async () => {
        const projectId = getProjectId();
        const reps = await fetchReports(projectId);
        setReports(
          (reps || []).map((x) => ({
            id: x.id,
            createdAtISO: x.createdAtISO,
            pdfUrl: x.pdfUrl,
            xlsxUrl: x.xlsxUrl,
            runId: x.runId,
          }))
        );
      },

      generateReportForRun: async (runId) => {
        const projectId = getProjectId();
        await createReport(projectId, runId);
        await loadAll(projectId);
      },

      sendChat: async (prompt) => {
        const r = await chat(prompt);
        return r.reply;
      },

      refreshDashboard: async () => {
        const projectId = getProjectId();
        setDashboard(await fetchDashboard(projectId));
      },

      fetchRecommendations: async () => {
        const projectId = getProjectId();
        const r = await fetchRecommendations(projectId);
        return r.recommendations;
      },

      syncSchedule: async (provider, token) => {
        const projectId = getProjectId();
        return syncSchedule(projectId, provider, token);
      },

      fetchWorkDiary: async () => {
        const projectId = getProjectId();
        return fetchWorkDiary(projectId);
      },
    };
  }, [data, dataLoading, projectsLoading, error, dashboard, reports, activeProjectId, projects, setProjectId, createProjectFromCtx, refreshProjects]);

  return <AppDataContext.Provider value={api}>{children}</AppDataContext.Provider>;
}
