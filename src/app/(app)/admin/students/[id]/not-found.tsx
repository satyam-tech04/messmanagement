import Link from "next/link";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown for an id that does not exist *or* belongs to another mess — the two are
 * deliberately indistinguishable, so a guessed UUID cannot be used to confirm
 * that a student exists elsewhere (rule 8).
 */
export default function StudentNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
        <UserX className="size-6" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Student not found</h2>
        <p className="text-muted-foreground text-sm">
          This student does not exist in your mess. They may have been removed, or the link may be
          wrong.
        </p>
      </div>
      <Button render={<Link href="/admin/students" />}>Back to students</Button>
    </div>
  );
}
