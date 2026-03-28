import { Router } from "express";
import * as authController from "../controllers/auth/auth.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.get("/me", requireAuth, authController.me);

export default router;
