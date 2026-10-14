"use client";

import { Suspense } from "react";
import { TasksPage } from "@/features/tasks/TasksPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TasksPage />
    </Suspense>
  );
}
