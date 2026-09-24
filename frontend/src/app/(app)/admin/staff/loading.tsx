import { DirectorySkeleton } from "@/components/ui/directory-skeleton";

/** Shown the moment Admin Access is clicked, before the page has loaded. */
export default function AdminStaffLoading() {
  return <DirectorySkeleton columns={8} />;
}
