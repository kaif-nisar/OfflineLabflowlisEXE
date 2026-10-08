import { Router } from "express";
import { verifySuperAdmin } from "../../middlewares/superAdminMiddleware.js";
import {
    getMigrationStatus,
    exportCollections,
    deleteOfflineCollection,
    wipeOfflineJunk,
    fullResetOfflineBackup,
    downloadOfflineBackupZip
} from "../controllers/offlineMigration.controller.js";

const router = Router();

router.use(verifySuperAdmin);

router.get("/status", getMigrationStatus);
router.post("/export", exportCollections);
router.delete("/collection/:name", deleteOfflineCollection);
router.delete("/wipe-junk", wipeOfflineJunk);
router.delete("/full-reset", fullResetOfflineBackup);
router.get("/download-zip", downloadOfflineBackupZip);

export default router;
