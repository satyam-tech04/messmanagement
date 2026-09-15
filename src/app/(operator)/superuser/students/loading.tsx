import { PageHeader } from "@/components/page-header";
import { TableLoading } from "@/components/data-table";
import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS = ["Roll number", "Name", "Room", "Enrolment", " "];

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <PageHeader
        title="Enter as a student"
        description="Pick a student to see their QR, menu and plan exactly as they do."
      />
      <Skeleton className="h-10 w-full max-w-md" />
      <TableLoading columns={COLUMNS} rows={6} />
    </div>
  );
}
