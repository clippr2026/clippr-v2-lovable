import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { ClipprLoader } from "@/components/ui/clippr-loader";

export function GlobalRouteLoader() {
  const status = useRouterState({ select: (state) => state.status });
  const isPending = status === "pending";
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!isPending) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, [isPending]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] grid place-items-center bg-[#050507]/92 backdrop-blur-sm transition-opacity duration-150">
      <ClipprLoader size="xl" />
    </div>
  );
}

export default GlobalRouteLoader;
