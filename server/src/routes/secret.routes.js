import { Router } from "express";
import * as secretController from "../controllers/secret/secret.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use(requireAuth);

router.post("/", secretController.createSecret);
router.get("/", secretController.getSecrets);
router.get("/:id", secretController.getSecretById);
router.put("/:id", secretController.updateSecret);
router.delete("/:id", secretController.deleteSecret);

export default router;
