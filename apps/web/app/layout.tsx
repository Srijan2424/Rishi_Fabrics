import type { Metadata } from "next";
import { DemoButton } from "./components/DemoButton";
import { IdleLogout } from "./components/IdleLogout";
import { LogoutButton } from "./components/LogoutButton";
import { getCurrentUser } from "./lib/api";
import "./styles.css";

export const metadata: Metadata = {
  title: "Rishi Fabrics",
  description: "Production, sampling, fabric, and delivery intelligence for Rishi Fabrics"
};

const navItems = [
  { href: "/", label: "Control Tower", permissions: ["VIEW_DASHBOARD"] },
  { href: "/sampling", label: "Sampling", permissions: ["VIEW_SAMPLING"] },
  { href: "/orders", label: "Orders", permissions: ["VIEW_ORDER"] },
  { href: "/fabric", label: "Fabric", permissions: ["VIEW_ORDER"] },
  { href: "/history", label: "History", permissions: ["VIEW_ORDER", "VIEW_SAMPLING"] },
  { href: "/imports", label: "Imports", permissions: ["UPLOAD_ERP_FILE", "APPROVE_IMPORT"] },
  { href: "/reports", label: "Reports", permissions: ["VIEW_REPORTS"] },
  { href: "/monitoring", label: "Monitoring", permissions: ["VIEW_MONITORING"] },
  { href: "/work-logs", label: "Work Logs", permissions: ["VIEW_WORK_LOGS"] },
  { href: "/settings", label: "Settings", permissions: ["MANAGE_USERS", "VIEW_DASHBOARD", "UPLOAD_ERP_FILE"] }
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        {user ? (
          <div className="shell">
            <aside className="sidebar">
              <div className="brand">
                <strong>Rishi Fabrics</strong>
                <span>Control Tower</span>
              </div>
              <div className="user-card">
                <strong>{user.name}</strong>
                <span>{user.role.replaceAll("_", " ")}</span>
              </div>
              <nav>
                {navItems
                  .filter((item) => item.permissions.some((permission) => user.permissions.includes(permission)))
                  .map((item) => (
                    <a key={item.href} href={item.href}>{item.label}</a>
                  ))}
              </nav>
              <DemoButton />
              <LogoutButton />
              <IdleLogout />
            </aside>
            <main className="main">{children}</main>
          </div>
        ) : (
          <main className="auth-main">{children}</main>
        )}
      </body>
    </html>
  );
}
