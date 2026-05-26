import { createContext, useCallback, useEffect, useState } from "react";
import {
  fetchProjects,
  createProject as apiCreateProject,
  type ProjectSummary,
} from "../data/api";

const LS_PROJECT = "constrack_project";

export type ProjectContextValue = {
  projects: ProjectSummary[];
  activeProjectId: string | undefined;
  isLoading: boolean;
  setProjectId: (id: string) => void;
  createProject: (name: string) => Promise<string>;
  refreshProjects: () => Promise<ProjectSummary[]>;
};

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProjects = useCallback(async (): Promise<ProjectSummary[]> => {
    const list = await fetchProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchProjects();
        setProjects(list);
        const stored = localStorage.getItem(LS_PROJECT);
        const valid = stored && list.find((p) => p.id === stored);
        setActiveProjectId(valid ? stored! : list[0]?.id);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const setProjectId = useCallback((id: string) => {
    localStorage.setItem(LS_PROJECT, id);
    setActiveProjectId(id);
  }, []);

  const createProject = useCallback(
    async (name: string): Promise<string> => {
      const trimmed = String(name || "").trim();
      if (trimmed.length < 2) throw new Error("Project name is required");
      const created = await apiCreateProject({ name: trimmed });
      await refreshProjects();
      setProjectId(created.id);
      return created.id;
    },
    [refreshProjects, setProjectId]
  );

  return (
    <ProjectContext.Provider
      value={{ projects, activeProjectId, isLoading, setProjectId, createProject, refreshProjects }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
