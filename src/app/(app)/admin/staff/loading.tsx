import { Skeleton } from "@/components/ui/skeleton";
import { TableLoading } from "@/components/data-table";

export default function StaffLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b pb-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <TableLoading columns={["Name", "Email", "Phone", "Added", "Status", ""]} />
    </div>
  );
}
