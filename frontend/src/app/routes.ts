import { createBrowserRouter } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { SystemStatus } from "./pages/SystemStatus";
import { CameraSetup } from "./pages/CameraSetup";
import { MotorSetup } from "./pages/MotorSetup";
import { Teleop } from "./pages/Teleop";
import { Recording } from "./pages/Recording";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    children: [
      { index: true, Component: SystemStatus },
      { path: "camera-setup", Component: CameraSetup },
      { path: "motor-setup", Component: MotorSetup },
      { path: "teleop", Component: Teleop },
      { path: "recording", Component: Recording },
      {
        path: "dataset",
        lazy: async () => ({
          Component: (await import("./pages/DatasetManagement")).DatasetManagement,
        }),
      },
      {
        path: "training",
        lazy: async () => ({
          Component: (await import("./pages/Training")).Training,
        }),
      },
      {
        path: "evaluation",
        lazy: async () => ({
          Component: (await import("./pages/Evaluation")).Evaluation,
        }),
      },
    ],
  },
]);
