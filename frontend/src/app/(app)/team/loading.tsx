import { DirectorySkeleton } from "@/components/ui/directory-skeleton";

/** Shown the moment Users is clicked, before the page itself has loaded. */
export default function TeamLoading() {
  return <DirectorySkeleton columns={6} />;
}
