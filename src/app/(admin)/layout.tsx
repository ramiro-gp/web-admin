import { requireAdmin } from "@/lib/auth";
import { formatDate, today } from "@/lib/calendar";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLayout({children}:{children:React.ReactNode}) {
  await requireAdmin();
  return <Shell dateLabel={formatDate(today())}>{children}</Shell>;
}
