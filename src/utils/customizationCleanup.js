import { customization } from "../models/printsetting.model.js";

const cleanupCustomizationsOnStartup = async () => {
    try {
        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 2);

        console.log("[Customization Cleanup] Tenant-wise cleanup started");
        console.log(`[Customization Cleanup] Current time: ${now.toISOString()}`);
        console.log(`[Customization Cleanup] Deleting records created before: ${cutoffDate.toISOString()}`);

        const tenantIds = await customization.distinct("tenantId", {
            tenantId: { $exists: true, $ne: null }
        });

        console.log(`[Customization Cleanup] Total tenants found: ${tenantIds.length}`);

        let totalMatched = 0;
        let totalDeleted = 0;

        for (const tenantId of tenantIds) {
            if (!tenantId) continue;

            const deleteFilter = {
                tenantId,
                $or: [
                    { isDocumented: false },
                    { isdocumented: false }
                ],
                createdAt: { $lt: cutoffDate }
            };

            const countToDelete = await customization.countDocuments(deleteFilter);
            totalMatched += countToDelete;

            if (countToDelete === 0) {
                console.log(`[Customization Cleanup] Tenant ${tenantId}: matched=0, deleted=0`);
                continue;
            }

            const deleteResult = await customization.deleteMany(deleteFilter);
            const deletedCount = deleteResult.deletedCount || 0;
            totalDeleted += deletedCount;

            console.log(`[Customization Cleanup] Tenant ${tenantId}: matched=${countToDelete}, deleted=${deletedCount}`);
        }

        console.log(`[Customization Cleanup] Total matched count: ${totalMatched}`);
        console.log(`[Customization Cleanup] Total deleted count: ${totalDeleted}`);
        console.log("[Customization Cleanup] Tenant-wise cleanup completed");
    } catch (error) {
        console.error("[Customization Cleanup] Cleanup failed:", error.message);
    }
};

export { cleanupCustomizationsOnStartup };
