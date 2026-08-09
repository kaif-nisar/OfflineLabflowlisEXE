// utils/subscriptionScheduler.js
import cron from "node-cron";
import { User } from "../models/user.model.js";
import nodemailer from "nodemailer";
import { Subscriber } from "../models/subscribe.model.js";
import { Tenant } from "../models/tenant.model.js";
import { cleanupCustomizationsOnStartup } from "./customizationCleanup.js";
import { syncPendingOfflineReports } from "./offlineReportSync.js";
import {
  advanceSubscriberAutomation,
  MAX_NEWSLETTER_STAGE,
  rescheduleSubscriberAutomation,
} from "./newsletterAutomation.js";

const isOfflineMode = String(process.env.OFFLINE_MODE || "").toLowerCase() === "true";
const canSendEmail = !isOfflineMode && process.env.EMAIL_USER && process.env.EMAIL_PASS;

const transporter = canSendEmail
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

// Check and deactivate expired subscriptions - runs daily at 12:01 AM
export const scheduleSubscriptionCheck = () => {
  cron.schedule("1 0 * * *", async () => {
    try {
      console.log("Running subscription check...");
      const expiredTenants = await Tenant.deactivateExpiredSubscriptions();
      console.log(`Deactivated ${expiredTenants} expired tenants`);
    } catch (error) {
      console.error("Error in subscription check:", error);
    }
  });
};

// Send expiry warnings - runs daily at 10:00 AM
export const scheduleExpiryWarnings = () => {
  if (!transporter) {
    console.log("Skipping expiry warning scheduler: offline mode or email credentials are not configured.");
    return;
  }

  cron.schedule("0 10 * * *", async () => {
    try {
      console.log("Sending expiry warnings...");
      const expiringUsers = await User.getExpiringSubscriptions(5);

      for (const user of expiringUsers) {
        await sendExpiryWarningEmail(user);
      }

      console.log(`Sent expiry warnings to ${expiringUsers.length} users`);
    } catch (error) {
      console.error("Error sending expiry warnings:", error);
    }
  });
};

// Cleanup customizations - runs daily at 3:00 AM
export const scheduleCustomizationCleanup = () => {
  cron.schedule("0 3 * * *", async () => {
    try {
      console.log("[Customization Cleanup] Scheduled cleanup started");
      await cleanupCustomizationsOnStartup();
      console.log("[Customization Cleanup] Scheduled cleanup completed");
    } catch (error) {
      console.error("[Customization Cleanup] Scheduled cleanup failed:", error);
    }
  });
};

// Local reports are always printable; this only drains the durable cloud-sync
// queue when connectivity is available again.
export const scheduleOfflineReportSync = () => {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const synced = await syncPendingOfflineReports();
      if (synced) console.log(`[offline-report-sync] retried ${synced} queued report(s)`);
    } catch (error) {
      console.error("[offline-report-sync] retry failed:", error.message);
    }
  });
};

export const scheduleNewsletterAutomation = () => {
  if (isOfflineMode || !canSendEmail) {
    console.log("Skipping newsletter automation scheduler: offline mode or email credentials are not configured.");
    return;
  }

  cron.schedule("15 * * * *", async () => {
    try {
      console.log("Running newsletter automation...");
      const dueSubscribers = await Subscriber.find({
        status: "active",
        automationStage: { $lt: MAX_NEWSLETTER_STAGE },
        nextAutomationAt: { $ne: null, $lte: new Date() },
      }).limit(100);

      for (const subscriber of dueSubscribers) {
        try {
          await advanceSubscriberAutomation(subscriber);
        } catch (error) {
          console.error(`Newsletter automation failed for ${subscriber.email}:`, error);
          await rescheduleSubscriberAutomation(subscriber, error);
        }
      }

      console.log(`Processed newsletter automation for ${dueSubscribers.length} subscribers`);
    } catch (error) {
      console.error("Error running newsletter automation:", error);
    }
  });
};

// Send expiry warning email
const sendExpiryWarningEmail = async (user) => {
  try {
    if (!transporter) {
      return;
    }

    if (!user) {
      return;
    }

    const endDate = user?.subscription?.gracePeriod?.graceUntil || user?.subscription?.endDate;
    if (!endDate) {
      console.warn(`Skipping expiry warning: missing subscription end date for user ${user?._id || "unknown"}`);
      return;
    }

    if (!user.email) {
      console.warn(`Skipping expiry warning: missing email for user ${user?._id || "unknown"}`);
      return;
    }

    const daysLeft = Math.ceil(
      (new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24)
    );
    const userName = user.fullName || user.username || "User";
    const planName = user?.subscription?.plan || "Current Plan";
    const planAmount = Number(user?.subscription?.amount || 0);
    const frontEndBase = process.env.FRONTEND_URL || "";
    const renewUrl = frontEndBase
      ? `${frontEndBase.replace(/\/$/, "")}/renew-subscription`
      : "#";

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: `Subscription Expiring Soon - ${daysLeft} days left`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ff6b35;">Subscription Expiring Soon!</h2>
          <p>Dear ${userName},</p>
          <p>Your subscription is expiring in <strong>${daysLeft} days</strong> on ${new Date(endDate).toDateString()}.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Current Plan Details:</h3>
            <p><strong>Plan:</strong> ${planName}</p>
            <p><strong>Amount:</strong> ₹${planAmount}</p>
            <p><strong>Expires on:</strong> ${new Date(endDate).toDateString()}</p>
          </div>
          
          ${
            user.commissionWallet > 0
              ? `
          <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745;">
            <p><strong>Good News!</strong> You have ₹${user.commissionWallet} in your commission wallet that you can use for renewal.</p>
          </div>
          `
              : ""
          }
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${renewUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Renew Now
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            If you don't renew your subscription, your account will be deactivated after the expiry date.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    // Log activity
    if (typeof user.logActivity === "function") {
      await user.logActivity("expiry_warning_sent", {
        daysLeft: daysLeft,
        expiryDate: new Date(endDate),
      });
    }
  } catch (error) {
    console.error(`Error sending expiry warning to ${user?.email || "unknown"}:`, error);
  }
};

// Initialize all schedulers
export const initializeSchedulers = () => {
  scheduleSubscriptionCheck();
  scheduleExpiryWarnings();
  scheduleCustomizationCleanup();
  scheduleOfflineReportSync();
  scheduleNewsletterAutomation();
  // Run once on server start
  (async () => {
    try {
      await syncPendingOfflineReports();
    } catch (error) {
      console.error("[offline-report-sync] startup retry failed:", error.message);
    }
  })();
  (async () => {
    try {
      console.log("Initial subscription check on server start...");
      const expiredCount = await Tenant.deactivateExpiredSubscriptions();
      console.log(`Deactivated ${expiredCount} expired tenants`);
    } catch (error) {
      console.error("Error in initial subscription check:", error);
    }
  })();
  (async () => {
    try {
      const dueSubscribers = await Subscriber.find({
        status: "active",
        automationStage: { $lt: MAX_NEWSLETTER_STAGE },
        nextAutomationAt: { $ne: null, $lte: new Date() },
      }).limit(25);

      for (const subscriber of dueSubscribers) {
        try {
          await advanceSubscriberAutomation(subscriber);
        } catch (error) {
          console.error(`Newsletter startup automation failed for ${subscriber.email}:`, error);
          await rescheduleSubscriberAutomation(subscriber, error);
        }
      }
    } catch (error) {
      console.error("Error in initial newsletter automation:", error);
    }
  })();
  console.log("Subscription schedulers initialized");
};

// Manual functions for testing
export const manualSubscriptionCheck = async () => {
  try {
    const expiredCount = await Tenant.deactivateExpiredSubscriptions();
    return { success: true, expiredCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const manualExpiryWarnings = async () => {
  try {
    const expiringUsers = await User.getExpiringSubscriptions(5);

    for (const user of expiringUsers) {
      await sendExpiryWarningEmail(user);
    }

    return { success: true, warningsSent: expiringUsers.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
