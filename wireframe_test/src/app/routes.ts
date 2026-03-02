import { createBrowserRouter } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { SystemStatus } from "./pages/SystemStatus";
import { CameraSetup } from "./pages/CameraSetup";
import { MotorSetup } from "./pages/MotorSetup";
import { Teleop } from "./pages/Teleop";
import { Recording } from "./pages/Recording";
import { DatasetManagement } from "./pages/DatasetManagement";
import { Training } from "./pages/Training";
import { Evaluation } from "./pages/Evaluation";

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
      { path: "dataset", Component: DatasetManagement },
      { path: "training", Component: Training },
      { path: "evaluation", Component: Evaluation },
    ],
  },
]);
