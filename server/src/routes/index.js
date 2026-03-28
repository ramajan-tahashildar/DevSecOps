import { Router } from "express";
import * as healthController from "../controllers/health.controller.js";
import * as gitBranchesController from "../controllers/git/gitBranches.controller.js";
import * as scanController from "../controllers/scan/scan.controller.js";
import authRoutes from "./auth.routes.js";
import secretRoutes from "./secret.routes.js";
import scannerRoutes from "./scanner.routes.js";
import gitRoutes from "./git.routes.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/secrets", secretRoutes);
router.get("/reports/by-repo", requireAuth, scanController.getReportsByRepoUrl);
/** Alias for frontends that poll `GET /api/scan-state?scannerId=` */
router.get("/scan-state", requireAuth, scanController.getScannerScanState);
/** Register before `/scanners` sub-router so `GET …/reports` and `POST …/run` are never shadowed. */
router.get("/scanners/:scannerId/reports", requireAuth, scanController.getScannerReports);
router.get("/scanners/:scannerId/scan-state", requireAuth, scanController.getScannerScanState);
router.get(
  "/scanners/:scannerId/branches",
  requireAuth,
  gitBranchesController.getBranchesForSastScanner,
);
router.post("/scanners/:scannerId/run", requireAuth, scanController.runScanHandler);
router.use("/scanners", scannerRoutes);
router.use("/git", gitRoutes);
router.get("/ping-db", healthController.pingDb);

export default router;
