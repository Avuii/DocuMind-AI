import { createHashRouter } from "react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./components/Dashboard";
import { Documents } from "./components/Documents";
import { DocumentDetail } from "./components/DocumentDetail";
import { Exports } from "./components/Exports";
import { Settings } from "./components/Settings";

export const router = createHashRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: Dashboard },
      { path: "documents", Component: Documents },
      { path: "documents/:id", Component: DocumentDetail },
      { path: "exports", Component: Exports },
      { path: "settings", Component: Settings },
    ],
  },
]);
