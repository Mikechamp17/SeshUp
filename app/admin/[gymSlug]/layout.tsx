import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Topbar } from "../../ui";
import { OwnerTabs } from "./owner-tabs";

/** The frame of every owner page: the gym's header, the section tabs, then the page. Each page still checks staff access itself. */
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ gymSlug: string }> }) {
  const { gymSlug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_gym", { p_slug: gymSlug });
  const name = (data as { name: string }[] | null)?.[0]?.name ?? "Gym admin";

  return (
    <div className="app">
      <Topbar name={name} sub="Owner" href={`/admin/${gymSlug}`} />
      <OwnerTabs slug={gymSlug} />
      {children}
    </div>
  );
}
