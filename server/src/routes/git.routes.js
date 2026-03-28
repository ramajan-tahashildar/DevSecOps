import { Router } from "express";
import * as gitBranchesController from "../controllers/git/gitBranches.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use(requireAuth);

router.post("/branches", gitBranchesController.postListGitBranches);

export default router;
