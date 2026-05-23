import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../../app/data/useAppData";
import { createZone, type ProjectSummary } from "../../app/data/api";
import { ProgressBar } from "../../components/ui/ProgressBar";

// ── helpers ────────────────────────────────────────────────────────────────

function daysUntil(isoDate?: string): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const FLOOR_PRESETS = [
  { label: "No preset", floors: 0 },
  { label: "1 Floor", floors: 1 },
  { label: "2 Floors", floors: 2 },
  { label: "3 Floors", floors: 3 },
  { label: "4 Floors", floors: 4 },
  { label: "5 Floors", floors: 5 },
];

// ── modal ──────────────────────────────────────────────────────────────────

type ModalProps = {
  initial?: ProjectSummary;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description: string;
    startDateISO: string;
    targetFinishDateISO: string;
    floorPreset: number;
  }) => Promise<void>;
};

function ProjectModal({ initial, onClose, onSave }: ModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startDate, setStartDate] = useState(
    initial?.startDateISO ? initial.startDateISO.slice(0, 10) : ""
  );
  const [targetDate, setTargetDate] = useState(
    initial?.targetFinishDateISO ? initial.targetFinishDateISO.slice(0, 10) : ""
  );
  const [floorPreset, setFloorPreset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Project name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        startDateISO: startDate ? new Date(startDate).toISOString() : "",
        targetFinishDateISO: targetDate ? new Date(targetDate).toISOString() : "",
        floorPreset,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-app bg-app shadow-xl">
        <div className="px-6 py-4 border-b border-app flex items-center justify-between">
          <h2 className="font-semibold text-lg">{isEdit ? "Edit project" : "New project"}</h2>
          <button onClick={onClose} className="muted text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Project name <span className="text-red-500">*</span></label>
            <input
              className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Tower Block A"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional notes about this project"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Start date</label>
              <input
                type="date"
                className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Target finish date</label>
              <input
                type="date"
                className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          {/* Zone preset — only shown on create */}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium mb-1">Zone preset</label>
              <select
                className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={floorPreset}
                onChange={e => setFloorPreset(Number(e.target.value))}
              >
                {FLOOR_PRESETS.map(p => (
                  <option key={p.floors} value={p.floors}>{p.label}</option>
                ))}
              </select>
              <p className="text-xs muted mt-1">
                Automatically creates floor zones under the site. You can add more later.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-app px-4 py-2 text-sm bg-app"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── delete confirm ─────────────────────────────────────────────────────────

function DeleteConfirm({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-app bg-app shadow-xl px-6 py-5 space-y-4">
        <h2 className="font-semibold text-lg">Delete project?</h2>
        <p className="text-sm muted">
          <span className="font-medium text-app">{name}</span> and all its scans, zones, runs and reports will be permanently deleted. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-app px-4 py-2 text-sm bg-app">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── project card ───────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const days = daysUntil(project.targetFinishDateISO);
  const pct = Math.round(project.overallProgressPct ?? 0);

  const daysLabel = days === null
    ? "No finish date set"
    : days < 0
      ? `${Math.abs(days)} days overdue`
      : days === 0
        ? "Due today"
        : `${days} days remaining`;

  const daysColor = days === null
    ? "muted"
    : days < 0
      ? "text-red-500"
      : days <= 14
        ? "text-yellow-500"
        : "text-green-500";


  return (
    <div className="rounded-2xl border border-app bg-app flex flex-col gap-4 p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base truncate">{project.name}</h3>
          {project.description && (
            <p className="text-xs muted mt-0.5 line-clamp-2">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded-lg border border-app px-2 py-1 text-xs bg-app hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Edit project"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            title="Delete project"
          >
            Delete
          </button>
        </div>
      </div>

      <ProgressBar value={pct} label="Overall progress" />

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs">
        <div className="space-y-0.5">
          <div className={`font-medium ${daysColor}`}>{daysLabel}</div>
          {project.targetFinishDateISO && (
            <div className="muted">Target: {formatDate(project.targetFinishDateISO)}</div>
          )}
        </div>
        <div className="text-right space-y-0.5 muted">
          <div>{project.scanCount} scan{project.scanCount !== 1 ? "s" : ""}</div>
          <div>{project.zoneCount} zone{project.zoneCount !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Open button */}
      <button
        onClick={onOpen}
        className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-2 text-sm font-medium transition-colors"
      >
        Open project →
      </button>
    </div>
  );
}

// ── empty state ────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
      <div className="text-6xl select-none">🏗️</div>
      <div>
        <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
        <p className="muted text-sm max-w-xs mx-auto">
          Create your first construction project to start uploading scans and tracking progress.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 text-sm font-medium"
      >
        Create your first project
      </button>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { projects, createProjectFull, updateProject, deleteProject, setProjectId } = useAppData();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  async function handleCreate(data: {
    name: string;
    description: string;
    startDateISO: string;
    targetFinishDateISO: string;
    floorPreset: number;
  }) {
    const id = await createProjectFull({
      name: data.name,
      description: data.description || undefined,
      startDateISO: data.startDateISO || undefined,
      targetFinishDateISO: data.targetFinishDateISO || undefined,
    });

    // Create floor zones from preset using the returned project ID directly
    // (avoids stale activeProjectId in the context closure)
    if (data.floorPreset > 0) {
      for (let i = 1; i <= data.floorPreset; i++) {
        await createZone(id, { name: `Floor ${i}`, type: "floor" });
      }
    }

    setProjectId(id);
    navigate("/dashboard");
  }

  async function handleEdit(data: {
    name: string;
    description: string;
    startDateISO: string;
    targetFinishDateISO: string;
  }) {
    if (!editing) return;
    await updateProject(editing.id, {
      name: data.name,
      description: data.description || undefined,
      startDateISO: data.startDateISO || undefined,
      targetFinishDateISO: data.targetFinishDateISO || undefined,
    });
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteProject(deleting.id);
    setDeleting(null);
  }

  function openProject(project: ProjectSummary) {
    setProjectId(project.id);
    navigate("/dashboard");
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Projects</h1>
          <p className="muted text-sm mt-1">Select a project to open its dashboard, or create a new one.</p>
        </div>
        {projects.length > 0 && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium"
          >
            + New project
          </button>
        )}
      </div>

      {/* Project grid or empty state */}
      {projects.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => openProject(p)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <ProjectModal
          onClose={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <ProjectModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleEdit}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
