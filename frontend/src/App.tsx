import { useEffect, useState } from "react";
import { apiHealth, apiListTeams, type Team } from "./api.ts";
import { AuthProvider, useAuth } from "./auth.tsx";
import LoginView from "./views/Login.tsx";
import DashboardView from "./views/Dashboard.tsx";
import DetailView from "./views/Detail.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { MenuIcon, PlusIcon } from "./components/Icons.tsx";

function Shell() {
  const { token, me, loading, error, logout } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [mineFilter, setMineFilter] = useState(false);
  const [urgentFilter, setUrgentFilter] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    apiHealth()
      .then((h) => setBackend(`${h.status}`))
      .catch(() => setBackend("unreachable"));
  }, []);

  // Fetch teams for workspace context navigation
  useEffect(() => {
    if (!token) return;
    apiListTeams(token)
      .then((res) => setTeams(res.teams))
      .catch(() => setTeams([]));
  }, [token]);

  // Drop the detail selection when the session ends.
  useEffect(() => {
    if (!token) {
      setSelectedId(null);
      setSelectedTeamId("");
      setMineFilter(false);
      setUrgentFilter(false);
    }
  }, [token]);

  if (loading) {
    return (
      <main style={{ textAlign: "center", marginTop: "20vh" }}>
        <p aria-label="Loading session" className="muted">
          Loading session…
        </p>
      </main>
    );
  }

  if (!token || !me) {
    return (
      <main>
        <LoginView />
        {error && (
          <p className="error" role="alert" style={{ textAlign: "center", marginTop: "1rem" }}>
            {error}
          </p>
        )}
      </main>
    );
  }

  let activeNav: "all" | "mine" | "urgent" | "detail" = "all";
  if (selectedId) {
    activeNav = "detail";
  } else if (mineFilter) {
    activeNav = "mine";
  } else if (urgentFilter) {
    activeNav = "urgent";
  }

  const activeTeamName = teams.find((t) => t.id === selectedTeamId)?.name;

  return (
    <div className="app-container">
      {/* Responsive Collapsible Sidebar */}
      <Sidebar
        me={me}
        teams={teams}
        selectedTeamId={selectedTeamId}
        onSelectTeam={(tId) => {
          setSelectedTeamId(tId);
          setSelectedId(null);
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onNavigateHome={() => {
          setSelectedId(null);
          setMineFilter(false);
          setUrgentFilter(false);
        }}
        onFilterMine={() => {
          setSelectedId(null);
          setMineFilter(true);
          setUrgentFilter(false);
        }}
        onFilterUrgent={() => {
          setSelectedId(null);
          setUrgentFilter(true);
          setMineFilter(false);
        }}
        logout={logout}
        activeNav={activeNav}
      />

      {/* Main Content Area */}
      <div className="main-wrapper">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-trigger"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Toggle navigation"
            >
              <MenuIcon />
            </button>

            <nav aria-label="Breadcrumb" className="breadcrumb-nav">
              <span>Operations</span>
              <span className="breadcrumb-divider">/</span>
              {activeTeamName && (
                <>
                  <span>{activeTeamName}</span>
                  <span className="breadcrumb-divider">/</span>
                </>
              )}
              {selectedId ? (
                <span className="breadcrumb-current mono">
                  WI-{selectedId.slice(-6).toUpperCase()}
                </span>
              ) : (
                <span className="breadcrumb-current">
                  {mineFilter ? "My Work" : urgentFilter ? "Urgent Items" : "Work Items"}
                </span>
              )}
            </nav>
          </div>

          <div className="topbar-right">
            <span className="backend-status-pill" title={`Backend service health: ${backend ?? "unknown"}`}>
              <span className={`backend-dot ${backend === "unreachable" ? "unreachable" : ""}`} />
              Backend: {backend ?? "…"}
            </span>

            {selectedId && (
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setSelectedId(null)}
              >
                All work
              </button>
            )}

            <button
              type="button"
              className="btn-primary"
              onClick={() => setCreateOpen(true)}
              title="Create new work item"
            >
              <PlusIcon /> <span className="topbar-btn-text">Create</span>
            </button>

            <button
              type="button"
              className="btn-subtle"
              onClick={logout}
              title="Sign out of your session"
            >
              Log out
            </button>
          </div>
        </header>

        <main>
          {selectedId ? (
            <DetailView id={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <DashboardView
              onOpen={setSelectedId}
              teamId={selectedTeamId}
              onTeamChange={setSelectedTeamId}
              mineFilter={mineFilter}
              onMineChange={setMineFilter}
              urgentFilter={urgentFilter}
              onUrgentChange={setUrgentFilter}
              createOpen={createOpen}
              onCloseCreate={() => setCreateOpen(false)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
