import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardView } from "@/views/DashboardView";

function App() {
  if (window.location.pathname !== "/") {
    window.location.replace("/");
    return null;
  }

  return (
    <TooltipProvider>
      <DashboardView />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
