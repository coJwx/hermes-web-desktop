import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import App from "./App";
import { SystemActionsProvider } from "./contexts/SystemActions";
import { I18nProvider } from "./i18n";
import { exposePluginSDK } from "./plugins";
import { ThemeProvider } from "./themes";
import { HERMES_BASE_PATH } from "./lib/api";
import { UnsavedChangesProvider } from "./contexts/UnsavedChangesProvider";

// Expose the plugin SDK before rendering so plugins loaded via <script>
// can access React, components, etc. immediately.
exposePluginSDK();

// Keep descendant routes and the persistent chat host intact while enabling router-native blockers.
const router = createBrowserRouter([{ path: "*", element: (
    <I18nProvider>
      <ThemeProvider>
        <SystemActionsProvider>
          <UnsavedChangesProvider>
            <App />
          </UnsavedChangesProvider>
        </SystemActionsProvider>
      </ThemeProvider>
    </I18nProvider>
)}], { basename: HERMES_BASE_PATH || undefined });

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
