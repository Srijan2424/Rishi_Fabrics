"use client";

import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch(`${apiUrl}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
    router.push("/login");
    router.refresh();
  }

  return (
    <button className="sidebar-action" type="button" onClick={logout}>
      Logout
    </button>
  );
}
