import { DirectorySkeleton } from "@/components/ui/directory-skeleton";

/** Shown the moment Users is clicked, before the page itself has loaded. */
export default function AdminUsersLoading() {
  return <DirectorySkeleton columns={8} />;
}
