import { PageHeader } from "@/components/page-header";
import { TableLoading, TableShell } from "@/components/data-table";

const COLUMNS = ["Mess", "Identifier", "Students", "Status", ""];

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Messes"
        description="Every hostel on the platform. Switching moves your account into that mess — you become its admin and lose sight of the others, exactly as its own admin does. One mess at a time, always."
      />
      <TableShell>
        <TableLoading columns={COLUMNS} rows={4} />
      </TableShell>
    </div>
  );
}
