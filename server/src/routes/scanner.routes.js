import { Router } from "express";
import * as scannerListController from "../controllers/scanner/scanner-list.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use(requireAuth);

router.post("/", scannerListController.createScanner);
router.get("/", scannerListController.getScanners);
/** Path filter (use if `?type=` is dropped by a reverse proxy / rewrite). */
router.get("/type/:type", scannerListController.getScanners);
router.get("/:id", scannerListController.getScannerById);
router.put("/:id", scannerListController.updateScanner);
router.delete("/:id", scannerListController.deleteScanner);

export default router;
