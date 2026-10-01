import type { Metadata } from "next";

import { TodoWorkspaces } from "@/components/todos/todo-workspaces";

export const metadata: Metadata = {
  title: "To-do — FlowDesk",
};

/**
 * A personal to-do page: separate workspaces, each a board of columns the
 * person names themselves and cards they drag between them. Nobody else sees it.
 */
export default function TodoPage() {
  // Workspaces as tabs, each a board. The board registers its own header, so
  // its Add column can sit in the top bar.
  return <TodoWorkspaces />;
}
