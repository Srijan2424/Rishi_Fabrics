import { TwoFactorSetup } from "../components/TwoFactorSetup";
import { UserApprovalManager } from "../components/UserApprovalManager";
import { getCurrentUser, getUsers } from "../lib/api";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const users = user?.permissions.includes("MANAGE_USERS") ? await getUsers() : [];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Settings</h1>
          <p>Company setup, access approvals, security, and workflow configuration.</p>
        </div>
      </header>

      <section className="settings-grid">
        <a className="settings-card" href="/factories">
          <strong>Company / Site</strong>
          <span>Rishi Fabrics ownership, working days, and shift context.</span>
        </a>
        <a className="settings-card" href="/workflows">
          <strong>SOP Workflows</strong>
          <span>Approved process routes used by progress, delay, and import engines.</span>
        </a>
        {user ? <TwoFactorSetup enabled={user.twoFactorEnabled} /> : null}
      </section>

      {user?.permissions.includes("MANAGE_USERS") ? <UserApprovalManager initialUsers={Array.isArray(users) ? users : []} /> : null}
    </>
  );
}
