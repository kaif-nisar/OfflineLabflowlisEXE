import express from "express";
import { configDotenv } from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";
import xss from "xss-clean";
import mongoSanitize from "express-mongo-sanitize";
import Connect_DB from "./src/db/index.js";
import userRouter from "./src/routes/user.routes.js";
import {
    verifyJWT,
    clearAuthCookies,
    resolvePortalSession,
    applyPortalSessionCookies,
} from "./middlewares/auth.middleware.js";
import { initializeSchedulers } from "./src/utils/subscriptionScheduler.js";
import { cleanupCustomizationsOnStartup } from "./src/utils/customizationCleanup.js";
import { handleRazorpayWebhook } from "./src/controllers/subscription.controller.js";
import { asyncHandler } from "./src/utils/asyncHandler.js";
import { UPLOAD_ROOT, ensureUploadDirectoriesSync } from "./src/utils/localStorage.js";
import { ensureDefaultSuperAdmin } from "./src/utils/defaultSuperAdmin.js";
import {
    ensureAppDirectoriesSync,
    resolveReadablePath,
    resolveRuntimePath,
} from "./src/utils/runtimePaths.js";

configDotenv({ path: resolveReadablePath(".env") });
ensureAppDirectoriesSync();
const OFFLINE_MODE = String(process.env.OFFLINE_MODE || "").toLowerCase() === "true";
const DESKTOP_RUNTIME = String(process.env.LABFLOW_RUNTIME || "").toLowerCase() === "desktop";
const TRUST_PROXY_SETTING = String(process.env.TRUST_PROXY || "").trim();

const normalizeNetworkIdentifier = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
        return "";
    }

    return normalized.replace(/^::ffff:/, "");
};

const isLoopbackRequestTarget = (value) => {
    const normalized = normalizeNetworkIdentifier(value);
    return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
};

const getTrustedRequestAddresses = (req) => {
    return [
        req.ip,
        req.socket?.remoteAddress,
        req.connection?.remoteAddress,
    ]
        .map(normalizeNetworkIdentifier)
        .filter(Boolean);
};

const shouldBypassRateLimit = (req) => {
    if (OFFLINE_MODE || DESKTOP_RUNTIME) {
        return true;
    }

    return getTrustedRequestAddresses(req).some(isLoopbackRequestTarget);
};

const getClientRateLimitKey = (req, identifier) => {
    const clientAddress = getTrustedRequestAddresses(req)[0] || "unknown";
    const scopedIdentifier = String(identifier || req.path || "request").trim().toLowerCase();
    return `${clientAddress}:${scopedIdentifier}`;
};

const getAuthRateLimitIdentifier = (req) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const candidates = [
        body.email,
        body.username,
        body.identifier,
        body.phone,
        req.path,
    ];

    const scopedIdentity = candidates.find((value) => String(value || "").trim());
    return String(scopedIdentity || req.path || "auth").trim().toLowerCase();
};

// Ensure temp directory exists
const tempDir = resolveRuntimePath("temp");

import fs from "fs";
ensureUploadDirectoriesSync();
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`📁 Created temp directory: ${tempDir}`);
}

const app = express();

if (TRUST_PROXY_SETTING) {
    if (TRUST_PROXY_SETTING === "true") {
        app.set("trust proxy", 1);
    } else if (TRUST_PROXY_SETTING === "false") {
        app.set("trust proxy", false);
    } else if (/^\d+$/.test(TRUST_PROXY_SETTING)) {
        app.set("trust proxy", Number(TRUST_PROXY_SETTING));
    } else {
        app.set("trust proxy", TRUST_PROXY_SETTING);
    }
}

const buildErrorPageUrl = ({
    status = 500,
    title,
    message,
    loginPath,
    homePath,
    returnTo,
}) => {
    const params = new URLSearchParams();

    params.set("status", String(status));

    if (title) {
        params.set("title", title);
    }

    if (message) {
        params.set("message", message);
    }

    if (loginPath) {
        params.set("login", loginPath);
    }

    if (homePath) {
        params.set("home", homePath);
    }

    if (returnTo) {
        params.set("returnTo", returnTo);
    }

    return `/error.html?${params.toString()}`;
};

const getDefaultLoginPath = (req) => {
    if (req.originalUrl?.startsWith("/superAdmin") || req.originalUrl?.includes("/login.html")) {
        return "/login.html";
    }

    return "/franchiseelogin.html";
};

const isDocumentRequest = (req) => {
    const fetchMode = req.get("sec-fetch-mode");
    const fetchDest = req.get("sec-fetch-dest");
    const accept = req.get("accept") || "";

    if (fetchMode === "navigate" || fetchDest === "document") {
        return true;
    }

    return req.method === "GET" && accept.includes("text/html") && !req.originalUrl?.startsWith("/api/");
};

const sendAppError = (
    req,
    res,
    {
        status = 500,
        title,
        message,
        code,
        details,
        loginPath,
        homePath = "/index.html",
        returnTo,
        clearSession = false,
        extra = {},
    } = {}
) => {
    if (clearSession) {
        clearAuthCookies(res);
    }

    if (isDocumentRequest(req)) {
        return res.redirect(
            buildErrorPageUrl({
                status,
                title,
                message,
                loginPath,
                homePath,
                returnTo,
            })
        );
    }

    const payload = {
        success: false,
        status,
        code,
        message,
        loginPath,
        homePath,
        ...extra,
    };

    if (details && process.env.NODE_ENV !== "production") {
        payload.details = details;
    }

    return res.status(status).json(payload);
};

const createPortalGuard = ({ sessionType, allowedPortalRoles, loginPath }) => {
    return asyncHandler(async (req, res, next) => {
        const session = await resolvePortalSession(req, {
            type: sessionType,
            strict: true,
            allowRefresh: true,
        });

        if (!session) {
            return sendAppError(req, res, {
                status: 401,
                title: "Session Expired",
                message: "Your session is no longer valid. Please login again to continue.",
                code: "SESSION_EXPIRED",
                loginPath,
                clearSession: true,
                returnTo: req.originalUrl,
            });
        }

        if (
            Array.isArray(allowedPortalRoles) &&
            allowedPortalRoles.length > 0 &&
            !allowedPortalRoles.includes(session.portalRole)
        ) {
            return sendAppError(req, res, {
                status: 403,
                title: "Access Denied",
                message: "You do not have permission to open this portal.",
                code: "PORTAL_ACCESS_DENIED",
                loginPath,
                homePath: session.redirectTo || "/index.html",
                returnTo: req.originalUrl,
            });
        }

        if (session.kind === "superAdmin") {
            req.superAdmin = session.superAdmin;
        } else {
            req.user = session.user;
        }

        applyPortalSessionCookies(res, session);

        next();
    });
};

if (process.env.NODE_ENV === "production") {
    process.on('uncaughtException', (error) => {
        console.error('UNCAUGHT EXCEPTION', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('UNHANDLED REJECTION', reason);
        process.exit(1);
    });
}

// ========================
// 📊 MEMORY MONITORING
// ========================

// ✅ Memory Monitoring with AUTO CLEANUP
setInterval(() => {
    const used = process.memoryUsage();
    console.log(`📊 Memory Usage - RSS: ${Math.round(used.rss / 1024 / 1024)}MB, Heap: ${Math.round(used.heapUsed / 1024 / 1024)}MB`);
    
    // ✅ Auto memory cleanup when heap exceeds 70MB
    if (used.heapUsed > 70 * 1024 * 1024) {
        console.log('🔄 Auto memory cleanup triggered...');
        if (global.gc) {
            global.gc();
        }
        if (global.cache) {
            const keys = Object.keys(global.cache);
            console.log(`🧹 Clearing ${keys.length} cache entries`);
            global.cache = {};
        }
    }
}, 300000); // Every 5 minutes

// ✅ Regular cache cleanup every 1 hour
setInterval(() => {
    console.log('⏰ Scheduled cache cleanup');
    global.cache = {};
}, 60 * 60 * 1000);

// ========================
// 🔐 SECURITY MIDDLEWARES
// ========================

if (process.env.NODE_ENV === 'production') {
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "'unsafe-eval'",
                    "blob:",
                    "https:"
                ],
                scriptSrcElem: [
                    "'self'",
                    "'unsafe-inline'",
                    "blob:",
                    "https:"
                ],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https:",
                    "blob:"
                ],
                styleSrcElem: [
                    "'self'",
                    "'unsafe-inline'",
                    "https:"
                ],
                imgSrc: [
                    "'self'",
                    "data:",
                    "https:",
                    "blob:"
                ],
                frameSrc: ["'self'", "blob:"],
                connectSrc: [
                    "'self'",
                    "https:",
                    "blob:",
                    "wss:"
                ],
                fontSrc: ["'self'", "https:", "data:"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'", "https:", "blob:"],
                formAction: ["'self'"],
                baseUri: ["'self'"],
                childSrc: ["'self'", "blob:"]
            },
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    }));
} else {
    // ✅ CSP COMPLETELY DISABLED for development
    app.use(helmet({
        contentSecurityPolicy: false
    }));

    app.use((req, res, next) => {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });

    console.log('🔓 CSP: COMPLETELY DISABLED - Development mode');
}

// ========================
// 🚀 RATE LIMITING
// ========================

const PUBLIC_AUTH_RATE_LIMIT_PATHS = [
    "/api/v1/user/login",
    "/api/v1/user/login-admin",
    "/api/v1/user/register",
    "/api/v1/user/send-otp",
    "/api/v1/user/verify-otp",
    "/api/v1/user/forgotPassword",
    "/api/v1/user/resetPassword",
    "/api/v1/user/register-with-referral",
];

const buildRateLimitHandler = (message, code) => {
    return (req, res) => {
        const clientAddress = getTrustedRequestAddresses(req)[0] || "unknown";
        console.warn(`[rate-limit:${code}] ${req.method} ${req.originalUrl} from ${clientAddress}`);
        return res.status(429).json({
            error: message,
            code,
        });
    };
};

if (process.env.NODE_ENV === 'production' && !OFFLINE_MODE && !DESKTOP_RUNTIME) {
    // Global request limiting removed in favor of targeted auth throttling.

    /* const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: {
            error: 'Too many login attempts, please try again later.'
        },
        skip: shouldBypassRateLimit,
    });

    const apiLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 200,
        message: {
            error: 'Too many API requests, please try again later.'
        },
        skip: shouldBypassRateLimit,
    });

    */
    /*

    console.log('🛡️ Production Rate Limiting: ACTIVE');
    */
    console.log("Production Rate Limiting: TARGETED AUTH ROUTES ONLY");
} else if (process.env.NODE_ENV === 'production' && (OFFLINE_MODE || DESKTOP_RUNTIME)) {
    console.log('🔓 Offline Mode - Rate Limiting: DISABLED');
} else {
    console.log('🔓 Development Mode - Rate Limiting: DISABLED');
}

// ========================
// 🔒 DATA SANITIZATION
// ========================

app.use(mongoSanitize()); // NoSQL Injection Protection
app.use(xss()); // XSS Protection
app.use(hpp()); // HTTP Parameter Pollution Protection

// ========================
// 🌐 CORS CONFIGURATION
// ========================

app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ========================
// 🔍 DEBUG MIDDLEWARE (Remove in production)
// ========================

if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`📍 ${req.method} ${req.path}`);
        next();
    });
}

// ========================
// 🛡️ CUSTOM SECURITY MIDDLEWARES - FIXED
// ========================

// 1. Block Suspicious User Agents & Bots - FIXED
app.use((req, res, next) => {
    const userAgent = req.get('User-Agent') || '';
    const lowerUA = userAgent.toLowerCase();
    const clientIP = req.ip || req.connection.remoteAddress;

    // ✅ CRITICAL FIX: Skip ALL security checks for API routes
    if (req.path.startsWith('/api/')) {
        return next();
    }

    // Allowed bots (whitelist)
    const allowedBots = ['googlebot', 'bingbot', 'slurp', 'duckduckbot', 'facebookexternalhit'];

    // Suspicious patterns (only actual malicious tools)
    const suspiciousPatterns = [
        'sqlmap',
        'nikto',
        'metasploit',
        'burpsuite',
        'hydra',
        'nmap',
        'masscan',
        'zgrab',
        'gobuster'
    ];

    const isAllowedBot = allowedBots.some(bot => lowerUA.includes(bot));
    if (isAllowedBot) {
        return next();
    }

    const isSuspicious = suspiciousPatterns.some(pattern => lowerUA.includes(pattern));
    if (isSuspicious) {
        console.log(`🚨 Blocked Suspicious UA: ${userAgent} from IP: ${clientIP}`);
        return sendAppError(req, res, {
            status: 403,
            title: "Access Denied",
            message: "Suspicious activity was detected for this request.",
            code: "SUSPICIOUS_USER_AGENT",
        });
    }

    next();
});

// 2. Block Malicious HTTP Methods - FIXED
app.use((req, res, next) => {
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];

    if (!allowedMethods.includes(req.method)) {
        console.log(`🚨 Blocked Suspicious Method: ${req.method} from IP: ${req.ip}`);
        return sendAppError(req, res, {
            status: 405,
            title: "Method Not Allowed",
            message: "This request method is not supported for the selected route.",
            code: "METHOD_NOT_ALLOWED",
        });
    }
    next();
});

// 3. Block Suspicious Paths & Directory Traversal - COMPLETELY FIXED
app.use((req, res, next) => {
    const requestedPath = req.path.toLowerCase();
    const clientIP = req.ip || req.connection.remoteAddress;

    // ✅ CRITICAL FIX: WHITELIST all API routes FIRST
    const safePaths = [
        '/api/',              // ✅ This covers ALL API routes including /api/v1/
        '/health',
        '/security/info',
        '/admin',
        '/superadmin',
        '/superfranchisee',
        '/franchisee',
        '/subfranchisee'
    ];

    // ✅ Check if it's a safe path - IMMEDIATE RETURN
    const isSafePath = safePaths.some(path =>
        requestedPath.startsWith(path.toLowerCase())
    );
    
    if (isSafePath) {
        return next(); // ✅ Allow all API routes without any checks
    }

    // ✅ BLACKLIST: Only for non-API paths
    const suspiciousPaths = [
        '.env', '.git', '.htaccess', '.htpasswd',
        'wp-admin', 'administrator', 'phpmyadmin',
        'mysql', 'config', 'backup', 'debug', 'console'
    ];

    const suspiciousExtensions = ['.php', '.asp', '.aspx', '.jsp', '.sh', '.exe'];

    const hasSuspiciousPath = suspiciousPaths.some(path => requestedPath.includes(path));
    if (hasSuspiciousPath) {
        console.log(`🚨 Blocked Suspicious Path: ${req.path} from IP: ${clientIP}`);
        return sendAppError(req, res, {
            status: 404,
            title: "Page Not Found",
            message: "The page you requested could not be found.",
            code: "SUSPICIOUS_PATH_BLOCKED",
        });
    }

    const hasSuspiciousExtension = suspiciousExtensions.some(ext => requestedPath.endsWith(ext));
    if (hasSuspiciousExtension) {
        console.log(`🚨 Blocked Suspicious Extension: ${req.path} from IP: ${clientIP}`);
        return sendAppError(req, res, {
            status: 404,
            title: "Page Not Found",
            message: "The page you requested could not be found.",
            code: "SUSPICIOUS_EXTENSION_BLOCKED",
        });
    }

    // Block directory traversal
    if (req.url.includes('..') || req.url.includes('~/')) {
        console.log(`🚨 Blocked Directory Traversal: ${req.url} from IP: ${clientIP}`);
        return sendAppError(req, res, {
            status: 400,
            title: "Invalid Request",
            message: "The requested path is not allowed.",
            code: "DIRECTORY_TRAVERSAL_BLOCKED",
        });
    }

    next();
});

// 4. Request Size Limiter
app.use((req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');

    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
        return sendAppError(req, res, {
            status: 413,
            title: "Request Too Large",
            message: "The uploaded data is too large to process.",
            code: "REQUEST_TOO_LARGE",
        });
    }
    next();
});

// ========================
// 📋 STANDARD MIDDLEWARES
// ========================

app.post("/api/v1/user/razorpay-webhook", express.raw({ type: "*/*" }), handleRazorpayWebhook);
// A QR cloud upload carries a PDF as base64 (about 33% larger than the PDF).
// 10 MB rejected valid 8 MB report PDFs before the QR link could be created.
app.use(express.json({ limit: "14mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(resolveReadablePath("public")));
app.use(express.static(resolveRuntimePath("temp")));
app.use("/uploads", express.static(UPLOAD_ROOT));
app.use(cookieParser());

// Global Error Handling Middleware
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        console.error('JSON Parse Error:', error);
        return sendAppError(req, res, {
            status: 400,
            title: "Invalid Request",
            message: "The request body could not be processed. Please check the submitted data.",
            code: "INVALID_JSON_PAYLOAD",
            details: error.message,
        });
    }
    next();
});

// ========================
// 🚦 ROUTES
// ========================

if (process.env.NODE_ENV === "production" && !OFFLINE_MODE && !DESKTOP_RUNTIME) {
    const publicAuthLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 25,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        skip: shouldBypassRateLimit,
        keyGenerator: (req) => getClientRateLimitKey(req, getAuthRateLimitIdentifier(req)),
        handler: buildRateLimitHandler(
            "Too many authentication attempts. Please wait a few minutes and try again.",
            "AUTH_RATE_LIMITED"
        ),
    });

    for (const routePath of PUBLIC_AUTH_RATE_LIMIT_PATHS) {
        app.use(routePath, publicAuthLimiter);
    }
}

import targetRouter from "./src/routes/target.routes.js";
import maintenanceRouter from "./src/routes/maintenance.routes.js";

app.use("/api/v1/user", userRouter);
app.use("/api/v1/target", targetRouter);
app.use("/api/maintenance", maintenanceRouter);

// Health Check Route
app.get('/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        env: process.env.NODE_ENV
    };
    res.json(health);
});

// Security Info Route
app.get('/security/info', (req, res) => {
    res.json({
        message: 'Security measures active',
        features: [
            'Rate Limiting',
            'SQL Injection Protection',
            'XSS Protection',
            'DDoS Protection',
            'Bot Detection',
            'Helmet Security Headers'
        ]
    });
});

app.get('/adminRegister.html', (req, res) => {
    res.sendFile(resolveReadablePath("private", "adminRegister.html"));
});

// Verify token route
app.get('/api/verify-token', verifyJWT, (req, res) => {
    res.json({ isAuthorized: true, user: req.user });
});

app.get("/api/session", asyncHandler(async (req, res) => {
    const session = await resolvePortalSession(req, {
        type: req.query.type || "any",
        strict: req.query.strict === "true",
        allowRefresh: true,
    });

    if (!session) {
        clearAuthCookies(res);

        return res.status(401).json({
            authenticated: false,
            success: false,
            code: "NO_ACTIVE_SESSION",
            message: "No active session found. Please login again.",
        });
    }

    applyPortalSessionCookies(res, session);

    return res.status(200).json({
        authenticated: true,
        success: true,
        kind: session.kind,
        portalRole: session.portalRole,
        redirectTo: session.redirectTo,
        user: session.user || null,
        superAdmin: session.superAdmin || null,
        accessToken: session.tokens?.accessToken || null,
    });
}));

// ========================
// 🔒 PROTECTED STATIC ROUTES
// ========================

const protectedStatic = (directory) => {
    return express.static(resolveReadablePath(directory), {
        setHeaders: (res, path) => {
            if (path.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript');
            } else if (path.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css');
            } else if (path.endsWith('.html')) {
                res.setHeader('Content-Type', 'text/html');
            } else if (path.endsWith('.json')) {
                res.setHeader('Content-Type', 'application/json');
            }
        }
    });
};

// Admin routes
app.use(
    '/admin',
    createPortalGuard({
        sessionType: "user",
        allowedPortalRoles: ["admin"],
        loginPath: "/franchiseelogin.html",
    }),
    protectedStatic('private')
);

app.use(
    '/superFranchisee',
    createPortalGuard({
        sessionType: "user",
        allowedPortalRoles: ["superFranchisee"],
        loginPath: "/franchiseelogin.html",
    }),
    protectedStatic('private')
);

app.use(
    '/franchisee',
    createPortalGuard({
        sessionType: "user",
        allowedPortalRoles: ["franchisee"],
        loginPath: "/franchiseelogin.html",
    }),
    protectedStatic('private')
);

app.use(
    '/subFranchisee',
    createPortalGuard({
        sessionType: "user",
        allowedPortalRoles: ["subFranchisee"],
        loginPath: "/franchiseelogin.html",
    }),
    protectedStatic('private')
);

app.use(
    '/superAdmin',
    createPortalGuard({
        sessionType: "superAdmin",
        allowedPortalRoles: ["superAdmin"],
        loginPath: "/login.html",
    }),
    protectedStatic('private')
);

// ========================
// 🎯 ERROR HANDLERS
// ========================

// 404 Handler - MUST BE AFTER ALL ROUTES
app.use('*', (req, res) => {
    return sendAppError(req, res, {
        status: 404,
        title: "Page Not Found",
        message: "The page or route you requested could not be found.",
        code: "ROUTE_NOT_FOUND",
        loginPath: getDefaultLoginPath(req),
        returnTo: req.originalUrl,
    });
});

// Global Error Handler
app.use((error, req, res, next) => {
    console.error('💥 Global Error Handler:', error);

    const status = error?.statusCode || error?.status || 500;
    const titleByStatus = {
        401: "Session Expired",
        403: "Access Denied",
        404: "Page Not Found",
        500: "Something Went Wrong",
    };

    return sendAppError(req, res, {
        status,
        title: titleByStatus[status] || "Something Went Wrong",
        message: error?.message || "An unexpected error occurred. Please try again.",
        code: error?.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED"),
        details: error?.stack || error?.message,
        loginPath: getDefaultLoginPath(req),
        returnTo: req.originalUrl,
        clearSession: Boolean(error?.clearAuth),
        extra: {
            subscriptionLocked: Boolean(error?.subscriptionLocked),
            reason: error?.reason,
        },
    });
});

// ========================
// 🚀 SERVER STARTUP
// ========================

/* Connect_DB()
    .then(async () => {
        await cleanupCustomizationsOnStartup();

        const port = Number(process.env.PORT) || 3000;
        const server = app.listen(port, () => {
            console.log(`✅ Server is running on port ${port}`);
            console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🛡️  Security Features: Active`);
            console.log(`🔓 Development Mode - CSP & Rate Limiting: DISABLED`);
            console.log(`🧹 Memory Auto-Cleanup: ACTIVE (70MB threshold)`);

            initializeSchedulers();
        });

        server.on("error", (error) => {
            if (error?.code === "EADDRINUSE") {
                console.error(`Port ${port} is already in use. Close the other process or change PORT in .env.`);
            } else {
                console.error("Server startup failed:", error);
            }

            process.exit(1);
        });

        const gracefulShutdown = () => {
            console.log('🛑 Received shutdown signal, closing server gracefully...');
            server.close(() => {
                console.log('✅ Server closed');
                process.exit(0);
            });

            setTimeout(() => {
                console.error('❌ Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    })
    .catch((err) => {
        console.error("❌ MongoDB connection failed:", err);
        process.exit(1);
    });

*/

let activeServer = null;
let shutdownHandlerRegistered = false;
const LOCAL_RUNTIME_HOST = "127.0.0.1";

const closeServerInstance = (server, forceAfterMs = 10000) => {
    return new Promise((resolve, reject) => {
        let settled = false;

        const finish = (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeoutHandle);

            if (error) {
                reject(error);
                return;
            }

            resolve();
        };

        const timeoutHandle = setTimeout(() => {
            if (typeof server.closeAllConnections === "function") {
                server.closeAllConnections();
            }

            finish(new Error("Server shutdown timed out."));
        }, forceAfterMs);

        server.close((error) => {
            finish(error || null);
        });
    });
};

export const stopApplication = async ({ forceAfterMs = 10000 } = {}) => {
    const server = activeServer;
    if (!server) {
        return;
    }

    activeServer = null;
    await closeServerInstance(server, forceAfterMs);
};

const registerGracefulShutdown = () => {
    if (shutdownHandlerRegistered) {
        return;
    }

    shutdownHandlerRegistered = true;

    const gracefulShutdown = async () => {
        console.log("Received shutdown signal, closing server gracefully...");

        try {
            await stopApplication({ forceAfterMs: 10000 });
            console.log("Server closed");
            process.exit(0);
        } catch (error) {
            console.error("Could not close connections in time, forcefully shutting down");
            if (error?.message) {
                console.error(error.message);
            }
            process.exit(1);
        }
    };

    process.on("SIGTERM", () => {
        void gracefulShutdown();
    });
    process.on("SIGINT", () => {
        void gracefulShutdown();
    });
};

export const startApplication = async () => {
    if (activeServer?.listening) {
        return {
            app,
            server: activeServer,
            port: Number(process.env.PORT) || 3000,
        };
    }

    await Connect_DB();
    await ensureDefaultSuperAdmin();
    await cleanupCustomizationsOnStartup();

    const port = Number(process.env.PORT) || 3000;

    const server = await new Promise((resolve, reject) => {
        const nextServer = app.listen(port, LOCAL_RUNTIME_HOST, () => {
            console.log(`Server is running at http://${LOCAL_RUNTIME_HOST}:${port}`);
            console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
            console.log("Security features: active");
            console.log("Memory auto-cleanup: active");

            initializeSchedulers();
            resolve(nextServer);
        });

        nextServer.once("error", reject);
    });

    server.on("error", (error) => {
        if (error?.code === "EADDRINUSE") {
            console.error(`Port ${port} is already in use. Close the other process or change PORT in .env.`);
        } else {
            console.error("Server startup failed:", error);
        }

        process.exit(1);
    });

    activeServer = server;
    registerGracefulShutdown();

    return {
        app,
        server,
        port,
    };
};

export default app;
