// src/components/navigation/Topbar.tsx
import { Link, useLocation } from "react-router-dom";
import { useUi } from "../../app/useUi";
import { useAuth } from "../../app/auth/AuthProvider";
import { useAppData } from "../../app/data/useAppData";
import { useTheme } from "../../app/useTheme";

export function Topbar() {
  const { toggleNav } = useUi();
  const { user, logout } = useAuth();
  const { projects, data } = useAppData();
  const { mode, toggle } = useTheme();
  const location = useLocation();

  const isProjectsPage = location.pathname === "/";
  const activeProject = projects.find((p) => p.id === data.projectId);

  return (
    <header className="sticky top-0 z-10 border-b border-app bg-app backdrop-blur">
      <div className="relative px-4 md:px-6 h-16 flex items-center justify-between max-w-7xl mx-auto">
        {/* Left: Menu button — hidden on the projects home page */}
        <div className="flex items-center gap-3">
          {!isProjectsPage && (
            <button
              onClick={toggleNav}
              className="rounded-lg border border-app px-3 py-2 text-sm bg-app"
              aria-label="Open menu"
            >
              ☰
            </button>
          )}
        </div>

        {/* Center: Project name — absolutely positioned so it stays visually centered */}
        {!isProjectsPage && activeProject && (
          <div className="absolute left-1/2 -translate-x-1/2 text-sm font-medium">
            <span className="muted text-xs mr-1">Project:</span>
            <span className="max-w-[160px] truncate inline-block align-bottom">
              {activeProject.name}
            </span>
          </div>
        )}

        {/* Right: home + theme toggle + user + logout */}
        <div className="flex items-center gap-3">
          {!isProjectsPage && (
            <Link
              to="/"
              className="rounded-lg border border-app px-3 py-2 text-sm bg-app hover:opacity-80 transition-opacity"
              aria-label="Go to home"
            >
              🏠 Home
            </Link>
          )}
          <button
            onClick={toggle}
            className="rounded-lg border border-app px-3 py-2 text-sm bg-app"
            aria-label="Toggle theme"
            title="Toggle light/dark"
          >
            {mode === "light" ? "🌞 Light" : "🌙 Dark"}
          </button>

          {user?.name && (
            <div className="text-xs muted hidden md:block">{user.name}</div>
          )}

          <button
            onClick={logout}
            className="rounded-lg border border-app px-3 py-2 text-sm bg-app"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
