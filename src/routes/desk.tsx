import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/desk")({
  component: () => <Navigate to="/admin" />,
});
