import { Skeleton } from "@/components/ui/skeleton";
import { TableLoading } from "@/components/data-table";

export default function StudentsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b pb-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Skeleton className="h-10 w-full sm:max-w-xs" />
        <Skeleton className="h-10 w-72" />
      </div>
      <TableLoading columns={["Roll number", "Name", "Room", "Plan", "Status", ""]} />
    </div>
  );
}
