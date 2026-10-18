import { useState } from "react";
import type { MeResponse, Team } from "../api.ts";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  LogOutIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
} from "./Icons.tsx";

export interface SidebarProps {
  me: MeResponse;
  teams: Team[];
  selectedTeamId: string;
  onSelectTeam: (teamId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNavigateHome: () => void;
  onFilterMine?: () => void;
  onFilterUrgent?: () => void;
  logout: () => void;
  activeNav?: "all" | "mine" | "urgent" | "detail";
}

export function Sidebar({
  me,
  teams,
  selectedTeamId,
  onSelectTeam,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  onNavigateHome,
  onFilterMine,
  onFilterUrgent,
  logout,
  activeNav = "all",
}: SidebarProps) {
  const [showTeamMenu, setShowTeamMenu] = useState(false);

  const activeTeam = teams.find((t) => t.id === selectedTeamId);
  const initials = me.user.name
    ? me.user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : me.user.email[0].toUpperCase();

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${
          mobileOpen ? "mobile-open" : ""
        }`}
        aria-label="Application navigation"
      >
        {/* Brand header */}
        <div className="sidebar-header">
          <button
            type="button"
            className="brand-button"
            onClick={() => {
              onNavigateHome();
              onCloseMobile();
            }}
            title="Newtonite Ops Home"
          >
            <div className="brand-logo" aria-hidden="true">
              <span className="brand-logo-mark">N</span>
            </div>
            {!collapsed && (
              <div className="brand-text">
                <span className="brand-title">Newtonite Ops</span>
                <span className="brand-badge">SaaS Ops</span>
              </div>
            )}
          </button>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            className="mobile-close-btn"
            onClick={onCloseMobile}
            aria-label="Close navigation"
          >
            <XIcon />
          </button>
        </div>

        {/* Workspace / Team Context Selector */}
        {!collapsed && (
          <div className="workspace-context">
            <span className="workspace-context-label">WORKSPACE CONTEXT</span>
            <div className="workspace-selector-wrapper">
              <button
                type="button"
                className="workspace-selector-btn"
                onClick={() => setShowTeamMenu(!showTeamMenu)}
                aria-expanded={showTeamMenu}
                aria-label="Select team context"
              >
                <div className="workspace-info">
                  <span className="workspace-name">
                    {activeTeam ? activeTeam.name : "All Teams"}
                  </span>
                  <span className="workspace-role">
                    {me.user.isGlobalAdmin
                      ? "Global Admin"
                      : activeTeam?.role
                      ? `Role: ${activeTeam.role}`
                      : `${me.memberships.length} team(s)`}
                  </span>
                </div>
                <ChevronDownIcon />
              </button>

              {showTeamMenu && (
                <div className="workspace-dropdown" role="menu">
                  <button
                    type="button"
                    className={`workspace-option ${!selectedTeamId ? "active" : ""}`}
                    onClick={() => {
                      onSelectTeam("");
                      setShowTeamMenu(false);
                      onNavigateHome();
                    }}
                    role="menuitem"
                  >
                    All Teams
                  </button>
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`workspace-option ${
                        selectedTeamId === t.id ? "active" : ""
                      }`}
                      onClick={() => {
                        onSelectTeam(t.id);
                        setShowTeamMenu(false);
                        onNavigateHome();
                      }}
                      role="menuitem"
                    >
                      <span>{t.name}</span>
                      {t.role && <span className="option-badge">{t.role}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation list */}
        <nav className="sidebar-nav">
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className={`nav-item ${activeNav === "all" ? "active" : ""}`}
                onClick={() => {
                  onNavigateHome();
                  onCloseMobile();
                }}
                title="All Work Items"
              >
                <LayersIcon className="nav-icon" />
                {!collapsed && <span>All Work Items</span>}
              </button>
            </li>
            {onFilterMine && (
              <li>
                <button
                  type="button"
                  className={`nav-item ${activeNav === "mine" ? "active" : ""}`}
                  onClick={() => {
                    onFilterMine();
                    onCloseMobile();
                  }}
                  title="Assigned to me"
                >
                  <UserIcon className="nav-icon" />
                  {!collapsed && <span>Assigned to me</span>}
                </button>
              </li>
            )}
            {onFilterUrgent && (
              <li>
                <button
                  type="button"
                  className={`nav-item ${activeNav === "urgent" ? "active" : ""}`}
                  onClick={() => {
                    onFilterUrgent();
                    onCloseMobile();
                  }}
                  title="Urgent items"
                >
                  <AlertCircleIcon className="nav-icon" />
                  {!collapsed && <span>Urgent items</span>}
                </button>
              </li>
            )}
          </ul>
        </nav>

        {/* Sidebar Collapse Toggle (Desktop) */}
        <div className="sidebar-toggle-section">
          <button
            type="button"
            className="collapse-toggle-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>

        {/* User profile footer */}
        <div className="sidebar-user-footer">
          <div className="user-profile">
            <div className="user-avatar" title={me.user.name || me.user.email}>
              {initials}
            </div>
            {!collapsed && (
              <div className="user-info">
                <span className="user-name">{me.user.name}</span>
                <span className="user-email">{me.user.email}</span>
                {me.user.isGlobalAdmin && (
                  <span className="user-admin-badge">
                    <ShieldIcon /> Global Admin
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="sidebar-logout-btn"
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOutIcon />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
