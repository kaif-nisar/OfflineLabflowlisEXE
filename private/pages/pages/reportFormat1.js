(async function () {
    const BASE_URL = typeof window.BASE_URL !== 'undefined' ? window.BASE_URL : window.location.origin;
    const user = window.user || (() => {
        try {
            return JSON.parse(localStorage.getItem('user') || localStorage.getItem('userData') || '{}');
        } catch (e) {
            return {};
        }
    })();

    const DEFAULT_QR_IMAGE = `${window.location.origin}/images/download.png`;

    const bootStartedAt = Date.now();
    const MIN_SKELETON_VISIBLE_MS = 150;
    const bootLoaderEl = document.getElementById('pageBootLoader');
    const bootShellEl = bootLoaderEl?.querySelector('.page-boot-shell');
    const pageRootEl = document.getElementById('reportFormat1Root') || document.body;
    const reportContainerEl = document.getElementById('container');
    const signOffEl = document.querySelector('.signed-off-div');
    const actionBarEl = document.querySelector('.download-pdf-div');

    async function ensureReportActionHelpersLoaded() {
        if (window.ReportActionHelpers) {
            return window.ReportActionHelpers;
        }

        if (typeof window.loadScript === 'function') {
            await window.loadScript(`pages/pages/reportAction.shared.js?t=${Date.now()}`);
            return window.ReportActionHelpers || {};
        }

        const existingScript = document.querySelector('script[data-report-action-helper="true"]');
        if (existingScript) {
            await new Promise((resolve, reject) => {
                existingScript.addEventListener('load', resolve, { once: true });
                existingScript.addEventListener('error', reject, { once: true });
                setTimeout(resolve, 1500);
            });
            return window.ReportActionHelpers || {};
        }

        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `pages/pages/reportAction.shared.js?t=${Date.now()}`;
            script.async = false;
            script.dataset.reportActionHelper = 'true';
            script.onload = resolve;
            script.onerror = () => reject(new Error('reportAction.shared.js could not be loaded'));
            document.body.appendChild(script);
        });

        return window.ReportActionHelpers || {};
    }

    function syncBootLoaderLayout() {
        const container = document.getElementById('container');
        if (!bootLoaderEl || !bootShellEl || !container || !pageRootEl) return;
        const rootRect = pageRootEl.getBoundingClientRect();
        const rect = container.getBoundingClientRect();
        const topOffset = Math.max(0, Math.round(rect.top - rootRect.top));
        bootLoaderEl.style.paddingTop = `${topOffset}px`;
        bootLoaderEl.style.height = `${Math.max(pageRootEl.clientHeight, window.innerHeight)}px`;
        bootShellEl.style.width = `${Math.round(rect.width)}px`;
    }

    function setPageVisible(isVisible) {
        const visibility = isVisible ? 'visible' : 'hidden';
        if (reportContainerEl) reportContainerEl.style.visibility = visibility;
        if (signOffEl) signOffEl.style.visibility = visibility;
        if (actionBarEl) actionBarEl.style.visibility = visibility;
        if (pageRootEl) pageRootEl.style.overflow = isVisible ? '' : 'hidden';
    }

    setPageVisible(false);
    if (bootLoaderEl) {
        bootLoaderEl.style.display = 'flex';
        bootLoaderEl.classList.remove('is-hiding');
    }
    syncBootLoaderLayout();
    window.addEventListener('resize', syncBootLoaderLayout);

    async function waitForVisualReady() {
        const waitForCriticalImagesBootstrap = async () => {
            const imgs = document.querySelectorAll('#qrimg, #barcodeImage');
            await Promise.all(Array.from(imgs).map((img) => new Promise((resolve) => {
                if (!img || !img.src || img.complete) return resolve();
                const done = () => resolve();
                const timer = setTimeout(done, 300);
                img.addEventListener('load', () => { clearTimeout(timer); done(); }, { once: true });
                img.addEventListener('error', () => { clearTimeout(timer); done(); }, { once: true });
            })));
        };

        if (document.fonts?.ready) {
            try {
                await Promise.race([
                    document.fonts.ready,
                    new Promise((resolve) => setTimeout(resolve, 350))
                ]);
            } catch (e) { /* ignore */ }
        }
        await waitForCriticalImagesBootstrap();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function markPageReady() {
        const elapsed = Date.now() - bootStartedAt;
        const waitMs = Math.max(0, MIN_SKELETON_VISIBLE_MS - elapsed);
        setTimeout(() => {
            setPageVisible(true);
            const bootLoader = document.getElementById('pageBootLoader');
            if (bootLoader) {
                setTimeout(() => { bootLoader.style.display = 'none'; }, 240);
            }
            window.removeEventListener('resize', syncBootLoaderLayout);
        }, waitMs);
    }

    function markPageFailed(error) {
        console.error('Report bootstrap failed:', error);
        const bootLoader = document.getElementById('pageBootLoader');
        if (bootLoader) {
            const label = bootLoader.querySelector('.page-boot-text');
            if (label) label.textContent = `Report Load Failed: ${error?.message || 'Error occurred'}`;
        }
        const actionFeedbackMessage = document.getElementById('actionFeedbackMessage');
        if (actionFeedbackMessage) {
            actionFeedbackMessage.textContent = `❌ Report load nahi ho saki: ${error?.message || 'Unknown error'}. Please refresh or check report ID.`;
            actionFeedbackMessage.dataset.state = 'error';
            actionFeedbackMessage.style.display = 'block';
        }
        setPageVisible(true);
        if (bootLoader) {
            setTimeout(() => { bootLoader.style.display = 'none'; }, 1500);
        }
    }

    try {
        await ensureReportActionHelpersLoaded();
        // ─── 1. URL PARAMS ───────────────────────────────────────────────────────
        const urlParams = new URLSearchParams(window.location.search);
        let value1 = urlParams.get('value1');
        if (!value1) {
            value1 = localStorage.getItem('myKey');
        }
        if (!value1) {
            throw new Error('Report ID (value1) is missing in URL parameter and localStorage.');
        }

        // ─── 2. PARALLEL INITIAL FETCHES ─────────────────────────────────────────
        const report = await fetchreport();
        if (!report || !report._id) {
            throw new Error('Report data could not be fetched or returned an empty object.');
        }

        value1 = report._id;
        const baseUrl = `${BASE_URL}/pages/pages/download_reports.html`;
        let backgroundImageUrl = null;
        const templateImagePromise = fetchTemplateImages()
            .then((url) => {
                backgroundImageUrl = url || null;
                return backgroundImageUrl;
            })
            .catch(() => null);

        localStorage.setItem('myKey', value1);
        if (report.bookingId) localStorage.setItem('bookingId', report.bookingId);
        if (user?.pdfFormat) localStorage.setItem('pdfformat', user.pdfFormat);

        let publicReportUrl = "";
        let publicReportUrlPending = null;

        let reportformatlabsign = false;
        let reportformatfirstdoctorsign = false;
        let reportformatseconddoctorsign = false;
        let prewarmInFlight = false;
        let prefetchedViewBlob = null;
        let prefetchedViewBlobUrl = null;
        let prefetchedPayloadKey = "";
        let activeSendPdfBlobUrl = null;
        let activeSendPdfBlob = null;
        let doctorsSignCache = null;
        let renderTask = Promise.resolve();
        let qrTask = Promise.resolve();
        let barcodeTask = Promise.resolve();
        const reportActionHelpers = window.ReportActionHelpers || {};
        const viewPdfButton = document.getElementById('viewPDF');
        const downloadPdfButton = document.getElementById('downloadPDF');
        const emailReportButton = document.getElementById('sendReport');
        const printReportButton = document.getElementById('BrowserPrint');
        const emailStatusMessage = document.getElementById('emailStatusMessage');
        const actionFeedbackMessage = document.getElementById('actionFeedbackMessage');

        const normalizeActionCounters = (counters) =>
            reportActionHelpers.normalizeCounters ? reportActionHelpers.normalizeCounters(counters) : (counters || {});

        const normalizeActionHistory = (history) =>
            reportActionHelpers.normalizeActionHistory ? reportActionHelpers.normalizeActionHistory(history) : (history || {});

        const ACTION_STATS_REFRESH_MS = 20000;
        let actionStatsIntervalId = null;
        let actionStatsSyncInFlight = false;
        let unsubscribeActionUpdates = null;

        function syncActionButtons(actionState = {}) {
            const mergedActionState = reportActionHelpers.mergeQueuedActionStats
                ? reportActionHelpers.mergeQueuedActionStats({
                    reportId: value1,
                    bookingId: report.bookingId,
                    actionCounters: actionState?.actionCounters ?? actionState ?? report.actionCounters,
                    actionHistory: actionState?.actionHistory ?? report.actionHistory,
                })
                : {
                    actionCounters: actionState?.actionCounters ?? actionState ?? report.actionCounters,
                    actionHistory: actionState?.actionHistory ?? report.actionHistory,
                };

            report.actionCounters = normalizeActionCounters(mergedActionState.actionCounters);
            report.actionHistory = normalizeActionHistory(mergedActionState.actionHistory);
            if (reportActionHelpers.applyActionCounts) {
                reportActionHelpers.applyActionCounts({
                    viewButton: viewPdfButton,
                    downloadButton: downloadPdfButton,
                    emailButton: emailReportButton,
                    printButton: printReportButton,
                    counters: report.actionCounters,
                    actionHistory: report.actionHistory
                });
            }
            [viewPdfButton, downloadPdfButton, emailReportButton, printReportButton].forEach((button) => {
                const labelNode = button?.querySelector('span');
                if (button && labelNode) {
                    button.dataset.syncedLabel = labelNode.textContent;
                }
            });
        }

        function setEmailStatus(message = "", type = "info") {
            if (reportActionHelpers.setStatus) {
                reportActionHelpers.setStatus(emailStatusMessage, message, type);
            }
        }

        async function refreshActionStats({ silent = true } = {}) {
            if (!reportActionHelpers.fetchActionStats || actionStatsSyncInFlight) return null;

            actionStatsSyncInFlight = true;
            try {
                const latestStats = await reportActionHelpers.fetchActionStats({
                    reportId: value1,
                    bookingId: report.bookingId,
                });
                syncActionButtons(latestStats);
                return latestStats;
            } catch (error) {
                if (!silent) {
                    console.warn('Unable to refresh action stats:', error);
                }
                return null;
            } finally {
                actionStatsSyncInFlight = false;
            }
        }

        async function flushPendingActionStats() {
            if (!reportActionHelpers.flushPendingActions) return [];

            return reportActionHelpers.flushPendingActions({
                reportId: value1,
                bookingId: report.bookingId,
                onSynced: syncActionButtons,
            });
        }

        function bootstrapActionSync() {
            if (reportActionHelpers.subscribeToActionUpdates) {
                unsubscribeActionUpdates = reportActionHelpers.subscribeToActionUpdates((payload) => {
                    const sameReport = payload?.reportId && String(payload.reportId) === String(value1);
                    const sameBooking = payload?.bookingId && String(payload.bookingId) === String(report.bookingId);
                    if (!sameReport && !sameBooking) return;
                    syncActionButtons(payload);
                });
            }

            const syncNow = async () => {
                await flushPendingActionStats();
                await refreshActionStats();
            };

            syncNow();

            if (!actionStatsIntervalId) {
                actionStatsIntervalId = window.setInterval(() => {
                    if (document.hidden) return;
                    syncNow();
                }, ACTION_STATS_REFRESH_MS);
            }

            window.addEventListener('focus', syncNow);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    syncNow();
                }
            });
        }

        let actionFeedbackTimer = null;

        function setActionFeedback(message = "", type = "info", options = {}) {
            if (!actionFeedbackMessage) return;

            const { autoHideMs = type === 'error' ? 4200 : 2600 } = options;
            if (actionFeedbackTimer) {
                clearTimeout(actionFeedbackTimer);
                actionFeedbackTimer = null;
            }

            if (!message) {
                actionFeedbackMessage.textContent = "";
                actionFeedbackMessage.style.display = "none";
                delete actionFeedbackMessage.dataset.state;
                return;
            }

            actionFeedbackMessage.textContent = message;
            actionFeedbackMessage.dataset.state = type;
            actionFeedbackMessage.style.display = "block";

            if (autoHideMs > 0) {
                actionFeedbackTimer = setTimeout(() => {
                    actionFeedbackMessage.textContent = "";
                    actionFeedbackMessage.style.display = "none";
                    delete actionFeedbackMessage.dataset.state;
                    actionFeedbackTimer = null;
                }, autoHideMs);
            }
        }

        function setButtonBusy(button, isBusy, busyLabel = "") {
            if (!button) return;

            const labelNode = button.querySelector('span');
            if (!button.dataset.baseLabel) {
                button.dataset.baseLabel = labelNode ? labelNode.textContent : button.textContent;
            }

            button.disabled = Boolean(isBusy);
            button.classList.toggle('is-busy', Boolean(isBusy));
            button.setAttribute('aria-busy', isBusy ? 'true' : 'false');

            if (isBusy && busyLabel) {
                if (labelNode) labelNode.textContent = busyLabel;
                else button.textContent = busyLabel;
                return;
            }

            if (!isBusy) {
                const refreshedLabel = button.dataset.syncedLabel || button.dataset.baseLabel;
                if (refreshedLabel) {
                    if (labelNode) labelNode.textContent = refreshedLabel;
                    else button.textContent = refreshedLabel;
                }
            }
        }

        // ─── QR Readiness Guard ─────────────────────────────────────────────────
        function setQrPendingState(isPending) {
            const actionButtons = [viewPdfButton, downloadPdfButton, emailReportButton, printReportButton];
            actionButtons.forEach((btn) => {
                if (!btn) return;
                if (isPending) {
                    btn.disabled = true;
                    btn.classList.add('qr-pending');
                    btn.setAttribute('title', 'QR code ready ho raha hai, please wait...');
                } else {
                    if (!btn.classList.contains('is-busy')) {
                        btn.disabled = false;
                    }
                    btn.classList.remove('qr-pending');
                    btn.removeAttribute('title');
                }
            });
            if (isPending) {
                setActionFeedback('📡 QR code generate ho raha hai, please wait...', 'info', { autoHideMs: 0 });
            } else {
                if (actionFeedbackMessage?.textContent?.includes('QR code generate')) {
                    setActionFeedback('');
                }
            }
        }

        async function trackSuccessfulAction(action) {
            if (!reportActionHelpers.trackAction) return null;
            try {
                const clientActionId = reportActionHelpers.createActionRequestId
                    ? reportActionHelpers.createActionRequestId(action)
                    : `${action}-${Date.now()}`;
                const tracked = await reportActionHelpers.trackAction({
                    reportId: value1,
                    bookingId: report.bookingId,
                    action,
                    clientActionId,
                    currentCounters: report.actionCounters,
                    currentHistory: report.actionHistory,
                });

                if (tracked?.actionCounters || tracked?.actionHistory) {
                    syncActionButtons(tracked);
                }

                if (tracked?.queued) {
                    setActionFeedback(
                        tracked?.message || 'Action saved locally. Count will sync automatically.',
                        'info',
                        { autoHideMs: 3600 }
                    );
                }
                return tracked;
            } catch (error) {
                console.warn(`Unable to track ${action}:`, error);
                return null;
            }
        }

        function resolveDefaultEmail() {
            if (reportActionHelpers.resolveDoctorEmail) {
                return reportActionHelpers.resolveDoctorEmail(report);
            }
            return report?.contactDefaults?.email || report?.savedDoctorEmail || "";
        }

        syncActionButtons(report);
        bootstrapActionSync();

        // ─── 3. Header + Doctor Signs parallel ───────────────────────────────────
        const doctorsSignTask = fetchdoctorsandlabsign();
        await populateHeader();

        // ─── 4. QR + Barcode generation ──────────────────────────────────────────
        // #qrCheckbox DIV ke andar waale checkbox ko Target kar raha hai
        const qrCheckboxContainer = document.getElementById('qrCheckbox');
        const qrCheckbox = qrCheckboxContainer?.querySelector('input[type="checkbox"]');

        if (qrCheckbox) {
            qrCheckbox.addEventListener('change', async (event) => {
                if (event.target.checked) {
                    if (qrCheckboxContainer) {
                        qrCheckboxContainer.style.display = 'none';
                    }
                    setQrPendingState(true);
                    try {
                        await qrcodegenerator();
                    } catch (err) {
                        console.error('Error generating QR on checkbox click:', err);
                    } finally {
                        setQrPendingState(false);
                        prewarmPdfInBackground();
                    }
                }
            });
        }
        const defer = (cb) => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => cb(), { timeout: 1200 });
            } else {
                setTimeout(cb, 0);
            }
        };

        defer(() => {
            Promise.allSettled([
                doctorsSignTask,
                qrTask,
                barcodeTask,
                waitForVisualReady()
            ]).then(() => {
                prewarmPdfInBackground();
            }).catch(() => {
                prewarmPdfInBackground();
            });
        });

        // ─── 5. Render report data ────────────────────────────────────────────────
        renderTask = renderData(report);
        await renderTask;

        // ─── 6. Sign-off, Download, Send, Hide, Page Ready ───────────────────────
        await signoffdivfunction();
        downloadpdffunction();
        await sendReport();
        hidecontent();

        // ─── 7. Mark page visible (remove boot loader) ───────────────────────────
        await waitForVisualReady();
        markPageReady();

        // ════════════════════════════════════════════════════════════════════════
        //  FUNCTION DEFINITIONS
        // ════════════════════════════════════════════════════════════════════════

        async function fetchdoctorsandlabsign() {
            try {
                const response = await fetch(`${BASE_URL}/api/v1/user/getDoctorsSign`);
                if (!response.ok) { console.log("doctor sign is not available"); return null; }

                const doctorsdata = await response.json();
                doctorsSignCache = doctorsdata;
                reportformatlabsign = Boolean(doctorsdata?.showlabinchargesign);
                reportformatfirstdoctorsign = Boolean(doctorsdata?.showfirstdoctorsign);
                reportformatseconddoctorsign = Boolean(doctorsdata?.showseconddoctorsign);

                const firstSignSrc = doctorsdata?.firstdoctorsignInBase64 || doctorsdata?.firstdoctorsign;
                const labSignSrc = doctorsdata?.labinchargesignInBase64 || doctorsdata?.labinchargesign;
                const secondSignSrc = doctorsdata?.seconddoctorsignInBase64 || doctorsdata?.seconddoctorsign;

                const slot = (flag, src, text) => `
                    <div class="left-sign" style="display:${flag ? 'block' : 'none'}; text-align:center;">
                        ${src ? `<img src="${src}" width="95" height="35" loading="eager" decoding="sync"/>` : `<div style="height:35px;width:95px;"></div>`}
                        <div class="textspan">${text || ''}</div>
                    </div>`;

                const signoffdiv = document.querySelector('.signed-off-div');
                if (signoffdiv) {
                    signoffdiv.innerHTML = '';
                    const div = document.createElement('div');
                    div.className = 'signed-off-div2';
                    div.innerHTML = `
                    ${slot(reportformatfirstdoctorsign, firstSignSrc, doctorsdata.firstdoctorsigninfo)}
                    ${slot(reportformatlabsign, labSignSrc, doctorsdata.labinchargeinfo)}
                    ${slot(reportformatseconddoctorsign, secondSignSrc, doctorsdata.seconddoctorsigninfo)}
                    `;
                    signoffdiv.appendChild(div);
                }
                return doctorsdata;
            } catch (error) {
                console.log(error?.message || error);
                return null;
            }
        }

        async function qrcodegenerator() {
            const qrCodeImage = document.getElementById('qrimg');
            if (qrCodeImage && (!qrCodeImage.src || qrCodeImage.src === 'about:blank' || !qrCodeImage.src.startsWith('data:'))) {
                qrCodeImage.src = DEFAULT_QR_IMAGE;
                qrCodeImage.style.display = 'block';
            }

            try {
                const publicUrl = await ensurePublicReportUrl();
                const response = await fetch(`/api/v1/user/generate-qr`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ link: publicUrl }),
                });
                if (!response.ok) throw new Error('Failed to generate QR code.');
                const data = await response.json();
                if (!qrCodeImage) return false;
                const qrSource = data?.qrCode || data?.qrcode || data?.qr || data?.image || data?.url;
                if (!qrSource) throw new Error('QR source missing in API response');

                if (qrSource.startsWith('data:')) {
                    qrCodeImage.src = qrSource;
                } else if (qrSource) {
                    try {
                        qrCodeImage.src = await urlToBase64(qrSource);
                    } catch {
                        qrCodeImage.src = qrSource;
                    }
                }
                qrCodeImage.style.display = 'block';
                qrCodeImage.loading = 'eager';
                return true;
            } catch (error) {
                console.warn('QR Error, using offline default QR:', error);
                if (qrCodeImage) {
                    qrCodeImage.src = DEFAULT_QR_IMAGE;
                    qrCodeImage.style.display = 'block';
                }
                return false;
            }
        }

        function ensurePublicReportUrl(retryCount = 0) {
            if (publicReportUrl) return Promise.resolve(publicReportUrl);
            if (publicReportUrlPending) return publicReportUrlPending;

            publicReportUrlPending = (async () => {
                const payload = await collectPdfPayload({ bookingId: report?.bookingId }, { skipQrReadiness: true, withBackground: true });

                const response = await fetch('/api/v1/user/offline-report-link', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.downloadUrl) {
                    if (retryCount < 1) {
                        console.log('Retrying ensurePublicReportUrl due to timeout or transient error...');
                        publicReportUrlPending = null;
                        return await ensurePublicReportUrl(retryCount + 1);
                    }
                    throw new Error(data.message || 'Internet connect karke QR link dobara try karein.');
                }
                publicReportUrl = data.downloadUrl;
                return publicReportUrl;
            })().finally(() => {
                publicReportUrlPending = null;
            });

            return publicReportUrlPending;
        }

        async function urlToBase64(url) {
            if (!url) return '';
            if (url.startsWith('data:')) return url;
            const absoluteUrl = new URL(url, window.location.href).href;
            const target = new URL(absoluteUrl);
            const isSameOrigin = target.origin === window.location.origin;

            const res = await fetch(absoluteUrl, {
                credentials: isSameOrigin ? 'include' : 'omit',
                mode: 'cors',
                cache: 'no-store'
            });
            if (!res.ok) throw new Error('Network response was not ok');
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
            });
        }

        async function convertImagesToBase64(selector) {
            return;
        }

        async function ensureImagesBase64(selectors) {
            return;
        }

        async function ensureCriticalCodeAssetsReady() {
            const qrCodeImage = document.getElementById('qrimg');
            const barcodeImage = document.getElementById('barcodeImage');

            // First attempt: convert any non-base64 QR src to base64
            if (qrCodeImage && qrCodeImage.src && !qrCodeImage.src.startsWith('data:')) {
                try {
                    qrCodeImage.src = await urlToBase64(qrCodeImage.src);
                } catch (e) {
                    console.warn('Could not convert QR code image to Base64 (first attempt):', e);
                }
            }

            const hasQrData = !!(qrCodeImage?.src && qrCodeImage.src.startsWith('data:image'));
            const hasBarcodeData = !!(barcodeImage?.src && barcodeImage.src.startsWith('data:image'));
            if (hasQrData && hasBarcodeData) return;

            await Promise.allSettled([qrTask, barcodeTask]);
            const retryTasks = [];
            if (barcodeImage && !barcodeImage.src) {
                barcodeTask = barcodegenerator();
                retryTasks.push(barcodeTask);
            }

            if (retryTasks.length) {
                await Promise.allSettled(retryTasks);
            }

            const codeImgs = Array.from(document.querySelectorAll('#qrimg, #barcodeImage'));
            await Promise.all(codeImgs.map((img) => waitForImageReady(img, 850)));

            // Final pass: ensure QR image is base64 for PDF rendering
            // (may have been updated by qrTask settling above)
            if (qrCodeImage && qrCodeImage.src && !qrCodeImage.src.startsWith('data:')) {
                try {
                    qrCodeImage.src = await urlToBase64(qrCodeImage.src);
                } catch (e) {
                    console.warn('Could not convert QR code image to Base64 (final pass):', e);
                    // Fallback: use absolute URL so PDF server can fetch it
                    if (!qrCodeImage.src.startsWith('http')) {
                        qrCodeImage.src = new URL(qrCodeImage.src, window.location.origin).href;
                    }
                }
            }
        }

        function waitForImageReady(img, timeoutMs = 6000) {
            if (!img || !img.src || img.complete) return Promise.resolve();
            return new Promise((resolve) => {
                const done = () => resolve();
                const timer = setTimeout(done, Math.min(timeoutMs, 500));
                img.addEventListener('load', () => { clearTimeout(timer); done(); }, { once: true });
                img.addEventListener('error', () => { clearTimeout(timer); done(); }, { once: true });
            });
        }

        async function waitForCriticalImages() {
            const imgs = document.querySelectorAll('#qrimg, #barcodeImage, .signed-off-div2 img');
            await Promise.all(Array.from(imgs).map((img) => waitForImageReady(img)));
        }

        // ─── PDF data helper ─────────────────────────────────────────────────────
        async function collectPdfPayload(extras = {}, options = {}) {
            const { skipImagePrep = false, withBackground = true, skipQrReadiness = false } = options;
            await renderTask;
            if (!skipQrReadiness) await ensureCriticalCodeAssetsReady();
            await waitForCriticalImages();

            let resolvedBackgroundImageUrl = null;
            if (withBackground) {
                resolvedBackgroundImageUrl =
                    backgroundImageUrl ?? await templateImagePromise.catch(() => null);
            }

            return {
                showlab: reportformatlabsign,
                showdoctorfirst: reportformatfirstdoctorsign,
                showdoctorsecond: reportformatseconddoctorsign,
                htmlContent: document.querySelector('.container2')?.outerHTML || '',
                cssContent: document.getElementById('stying')?.innerHTML || '',
                header: document.querySelector('.report-details')?.outerHTML || '',
                footer: document.querySelector('.signed-off-div')?.outerHTML || '',
                reportId: value1,
                bookingId: report?.bookingId || '',
                backgroundImageUrl: resolvedBackgroundImageUrl,
                disableBackgroundImage: !withBackground,
                investigationmargin: countLines(),
                ...extras
            };
        }

        async function savePdfData(extras = {}) {
            const response = await fetch(`/api/v1/user/adding-pdf-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(await collectPdfPayload(extras)),
            });
            if (!response.ok) throw new Error('data not saved');
        }

        function buildViewPayloadKey(payload) {
            return JSON.stringify({ ...payload, value1, DownloadPdf: false });
        }

        function buildReportPdfFileName() {
            const safeName = (report?.patientName || 'Patient')
                .replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '')
                .trim()
                .replace(/\s+/g, '_');
            const safeId = (report?.bookingId || 'Report').replace(/[^a-zA-Z0-9-_]/g, '');
            return `${safeName || 'Patient'}-${safeId || 'Report'}.pdf`;
        }

        async function openPdfInDesktopShell(pdfBlob, fileName = buildReportPdfFileName()) {
            if (!window.LabFlowDesktopShell?.saveAndOpenPdf || !(pdfBlob instanceof Blob)) {
                return false;
            }

            const result = await window.LabFlowDesktopShell.saveAndOpenPdf({
                fileName,
                buffer: await pdfBlob.arrayBuffer(),
            });

            if (!result?.success) {
                throw new Error(result?.message || 'PDF open failed');
            }

            return true;
        }

        async function prewarmPdfInBackground() {
            if (prewarmInFlight) return;
            prewarmInFlight = true;
            try {
                const viewPayload = await collectPdfPayload({}, { skipImagePrep: true, withBackground: false });
                const payloadKey = buildViewPayloadKey(viewPayload);
                if (prefetchedViewBlobUrl && payloadKey === prefetchedPayloadKey) return;
                const blob = await fetchServerPdfBlob(viewPayload);
                setPrefetchedViewBlob(blob, payloadKey);
            } catch (error) {
                console.warn('PDF prewarm failed:', error);
            } finally {
                prewarmInFlight = false;
            }
        }

        function setPrefetchedViewBlob(blob, payloadKey) {
            if (prefetchedViewBlobUrl) URL.revokeObjectURL(prefetchedViewBlobUrl);
            prefetchedViewBlob = blob;
            prefetchedViewBlobUrl = URL.createObjectURL(blob);
            prefetchedPayloadKey = payloadKey;
        }

        async function fetchServerPdfBlob(payload) {
            const response = await fetch(`/api/v1/user/get-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, value1, DownloadPdf: false, isReportFormat: true }),
            });
            if (!response.ok) throw new Error('PDF generation failed');
            return response.blob();
        }

        // ─── PDF setting button ──────────────────────────────────────────────────
        document.getElementById('PDFsettinganchr')?.addEventListener('click', async (event) => {
            event.preventDefault();
            const settingsButton = document.getElementById('PDFsetting');
            setButtonBusy(settingsButton, true, 'Saving...');
            setActionFeedback('Print settings save ho rahi hain...', 'info', { autoHideMs: 0 });
            try {
                await savePdfData();
                const settingLink = document.getElementById('PDFsettinganchr');
                if (settingLink?.href) {
                    window.location.href = settingLink.href;
                }
            } catch (error) {
                console.error('Error generating PDF:', error);
                setActionFeedback('Print settings save nahi ho paayi. Please try again.', 'error');
            } finally {
                setButtonBusy(settingsButton, false);
            }
        });

        document.getElementById('shareWhatsapp')?.addEventListener('click', async () => {
            const button = document.getElementById('shareWhatsapp');
            setButtonBusy(button, true, 'Preparing...');
            const whatsappWindow = window.open('', '_blank');
            try {
                const link = await ensurePublicReportUrl();
                const message = `Your LabFlow report is ready. Download it here: ${link}`;
                const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
                if (whatsappWindow) {
                    whatsappWindow.opener = null;
                    whatsappWindow.location.replace(whatsappUrl);
                } else {
                    window.location.assign(whatsappUrl);
                }
                await trackSuccessfulAction('whatsappOpen');
                setActionFeedback('WhatsApp khul gaya — report link ready hai.', 'success');
            } catch (error) {
                if (whatsappWindow && !whatsappWindow.closed) whatsappWindow.close();
                console.error('WhatsApp link failed:', error);
                setActionFeedback(error.message || 'WhatsApp report link nahi ban paaya.', 'error');
            } finally {
                setButtonBusy(button, false);
            }
        });

        // ─── VIEW PDF ────────────────────────────────────────────────────────────
        document.getElementById('viewPDF')?.addEventListener('click', async (e) => {
            const button = e.currentTarget;
            setButtonBusy(button, true, 'Opening...');
            setActionFeedback('PDF prepare ho rahi hai...', 'info', { autoHideMs: 0 });

            const shouldUseBrowserPopup = !window.LabFlowDesktopShell?.saveAndOpenPdf;
            const newTab = shouldUseBrowserPopup ? window.open('', '_blank') : null;
            if (shouldUseBrowserPopup && !newTab) {
                alert('Popup blocked! Please allow popups for this site and try again.');
                setActionFeedback('Popup blocked hai. Please allow popups and try again.', 'error');
                setButtonBusy(button, false);
                return;
            }

            if (newTab) {
                newTab.document.write(`<!DOCTYPE html><html><head><title>Opening PDF...</title>
                <style>
                    *{margin:0;padding:0;box-sizing:border-box;}
                    body{display:flex;flex-direction:column;align-items:center;justify-content:center;
                         height:100vh;background:#f0f4ff;font-family:Arial,sans-serif;}
                    .spinner{width:56px;height:56px;border:6px solid #c7d9ff;
                             border-top:6px solid #1a73e8;border-radius:50%;
                             animation:spin 0.85s linear infinite;margin-bottom:22px;}
                    @keyframes spin{to{transform:rotate(360deg);}}
                    p{font-size:16px;color:#555;}
                </style></head><body>
                    <div class="spinner"></div>
                    <p>Opening PDF, please wait...</p>
                </body></html>`);
                newTab.document.close();
            }

            try {
                let pdfBlob = prefetchedViewBlob;

                if (!pdfBlob) {
                    const viewPayload = await collectPdfPayload({}, { skipImagePrep: true, withBackground: false });
                    const payloadKey = buildViewPayloadKey(viewPayload);
                    pdfBlob = await fetchServerPdfBlob(viewPayload);
                    setPrefetchedViewBlob(pdfBlob, payloadKey);
                }

                const openedInDesktop = await openPdfInDesktopShell(pdfBlob);
                if (!openedInDesktop && newTab) {
                    newTab.location.href = prefetchedViewBlobUrl;
                }
                const trackedViewAction = await trackSuccessfulAction('viewPdf');
                setActionFeedback(
                    trackedViewAction?.queued
                        ? 'PDF open ho gayi. Count locally save ho gaya, backend sync automatic hoga.'
                        : 'PDF open ho gayi aur count update ho gaya.',
                    trackedViewAction?.queued ? 'info' : 'success'
                );
            } catch (error) {
                console.error('Error viewing PDF:', error);
                if (newTab) {
                    newTab.document.open();
                    newTab.document.write(`<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial;font-size:17px;color:red;">
                    ❌ PDF generation failed. Please close this tab and try again.</body></html>`);
                    newTab.document.close();
                }
                setActionFeedback('PDF open nahi ho paayi. Please try again.', 'error');
            } finally {
                setButtonBusy(button, false);
            }
        });

        // ─── Send Report ─────────────────────────────────────────────────────────
        window.addEventListener('beforeunload', () => {
            if (actionStatsIntervalId) {
                clearInterval(actionStatsIntervalId);
                actionStatsIntervalId = null;
            }
            if (typeof unsubscribeActionUpdates === 'function') {
                unsubscribeActionUpdates();
                unsubscribeActionUpdates = null;
            }
            if (prefetchedViewBlobUrl) URL.revokeObjectURL(prefetchedViewBlobUrl);
            if (activeSendPdfBlobUrl) URL.revokeObjectURL(activeSendPdfBlobUrl);
            prefetchedViewBlob = null;
            prefetchedViewBlobUrl = null;
            activeSendPdfBlobUrl = null;
            activeSendPdfBlob = null;
            prefetchedPayloadKey = "";
        });

        async function sendReport() {
            const sendReportButton = document.getElementById('sendReport');
            const popupModal = document.getElementById('popupModal');
            const closeButton = document.querySelector('.close-button');
            const inputField = document.getElementById('inputField');
            const contactInput = document.getElementById('contactInput');
            const sendButton = document.getElementById('sendButton');
            const iframe = document.getElementById('pdfFrame');
            const openPdfButton = document.getElementById('openPdfButton');

            if (!sendReportButton || !popupModal) return;

            sendReportButton.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                setButtonBusy(button, true, 'Preparing...');
                setEmailStatus();
                setActionFeedback('Email preview prepare ho rahi hai...', 'info', { autoHideMs: 0 });
                try {
                    const latestPayload = await collectPdfPayload();
                    const pdfResponse = await fetch(`/api/v1/user/get-pdf`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...latestPayload, value1, isReportFormat: true }),
                    });
                    if (!pdfResponse.ok) throw new Error('PDF generation failed');
                    popupModal.style.display = 'block';
                    const pdfBlob = await pdfResponse.blob();
                    activeSendPdfBlob = pdfBlob;
                    if (activeSendPdfBlobUrl) URL.revokeObjectURL(activeSendPdfBlobUrl);
                    activeSendPdfBlobUrl = URL.createObjectURL(activeSendPdfBlob);
                    if (iframe) iframe.src = activeSendPdfBlobUrl;
                    if (inputField) inputField.style.display = 'flex';
                    if (contactInput) {
                        contactInput.value = resolveDefaultEmail();
                        contactInput.placeholder = 'Enter Email Address';
                        contactInput.focus();
                    }
                    setActionFeedback('Email preview ready hai. Address check karke send karein.', 'success');
                } catch (error) {
                    console.error('Error generating email preview:', error);
                    setActionFeedback('Email preview generate nahi ho paayi. Please try again.', 'error');
                    popupModal.style.display = 'none';
                } finally {
                    setButtonBusy(button, false);
                }
            });

            closeButton?.addEventListener('click', () => {
                popupModal.style.display = 'none';
                setEmailStatus();
            });
            window.addEventListener('click', (event) => {
                if (event.target === popupModal) {
                    popupModal.style.display = 'none';
                    setEmailStatus();
                }
            });

            if (sendButton) {
                sendButton.onclick = async () => {
                    const email = contactInput?.value?.trim()?.toLowerCase() || '';
                    if (!email || (typeof contactInput?.checkValidity === 'function' && !contactInput.checkValidity())) {
                        setEmailStatus('Please enter a valid email address.', 'error');
                        if (typeof contactInput?.reportValidity === 'function') {
                            contactInput.reportValidity();
                        }
                        return;
                    }
                    if (!activeSendPdfBlob && !iframe?.src) {
                        setEmailStatus('PDF preview ready nahi hai. Please try again.', 'error');
                        return;
                    }

                    setButtonBusy(sendButton, true, 'Sending...');
                    setEmailStatus('Email bheja ja raha hai...', 'info');
                    setActionFeedback('Email send ho rahi hai...', 'info', { autoHideMs: 0 });
                    try {
                        const clientActionId = reportActionHelpers.createActionRequestId
                            ? reportActionHelpers.createActionRequestId('email')
                            : `email-${Date.now()}`;
                        const payload = await reportActionHelpers.sendPdfByEmail({
                            email,
                            pdfBlob: activeSendPdfBlob,
                            pdfUrl: iframe?.src || '',
                            report,
                            clientActionId,
                        });
                        if (payload?.actionCounters || payload?.actionHistory) {
                            syncActionButtons(payload);
                        }
                        await refreshActionStats();
                        setEmailStatus(payload?.message || 'Email sent successfully.', 'success');
                        setActionFeedback(payload?.message || 'Email sent successfully.', 'success');
                    } catch (error) {
                        setEmailStatus(error?.message || 'Internet weak hai, email send nahi hua. Please try again.', 'error');
                        setActionFeedback(error?.message || 'Internet weak hai, email send nahi hua. Please try again.', 'error');
                    } finally {
                        setButtonBusy(sendButton, false);
                    }
                };
            }

            openPdfButton?.addEventListener('click', () => {
                if (!iframe?.src && !activeSendPdfBlob) {
                    setEmailStatus('Preview PDF abhi ready nahi hai.', 'error');
                    return;
                }
                void (async () => {
                    try {
                        if (activeSendPdfBlob && await openPdfInDesktopShell(activeSendPdfBlob)) {
                            return;
                        }
                        if (iframe?.src) window.open(iframe.src, '_blank');
                    } catch (error) {
                        console.error('Error opening preview PDF:', error);
                        setEmailStatus('Preview PDF open nahi ho paayi. Please try again.', 'error');
                    }
                })();
            });
        }

        async function fetchreport() {
            try {
                const response = await fetch(`/api/v1/user/ReportData`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value1 })
                });
                if (!response.ok) {
                    throw new Error(`Report API request failed with status ${response.status}`);
                }
                const data = await response.json();
                if (!data) throw new Error("Report API returned empty response");
                return data;
            } catch (error) {
                console.error("fetchreport error:", error);
                throw error;
            }
        }

        function formatDateTime(timestamp) {
            if (!timestamp) return '<span>-</span>';
            try {
                const date = new Date(timestamp);
                if (isNaN(date.getTime())) return '<span>-</span>';
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                const year = date.getFullYear();
                let hours = date.getHours();
                const minutes = date.getMinutes().toString().padStart(2, '0');
                const amPm = hours >= 12 ? 'PM' : 'AM';
                hours = (hours % 12 || 12).toString().padStart(2, '0');
                return `${day}-${month}-${year} <span>${hours}:${minutes} ${amPm}</span>`;
            } catch (e) {
                return '<span>-</span>';
            }
        }

        async function populateHeader() {
            const regElem = document.getElementById("booking-registeration-number");
            if (regElem) regElem.innerText = report.reg_id || report.bookingId || '';

            let registeredOnFormatted = '<span>-</span>';
            if (report.date) {
                try {
                    const datePart = new Date(report.date).toISOString().split('T')[0];
                    const timePart = report.time || '00:00';
                    registeredOnFormatted = formatDateTime(`${datePart}T${timePart}`);
                } catch (e) {
                    registeredOnFormatted = formatDateTime(report.date);
                }
            }

            const patientdetails = document.createElement("div");
            patientdetails.classList.add("report-details-innerDiv2");
            patientdetails.innerHTML = `
            <div class="format1left2">
                <div class="format1-infor-div fixedheightdiv">
                    <div class="format1-tags">Patient Name:</div>
                    <div class="value" style="font-weight:700;font-size:15px;color:#111;">${report.patientName || ''}</div>
                </div>
                <div class="format1-infor-div fixedheightdiv"><div class="format1-tags">Age / Sex:</div><div class="value">${report.year || ''} / ${report.gender || ''}</div></div>
                <div class="format1-infor-div fixedheightdiv"><div class="format1-tags">Referred By:</div><div class="value">${report.doctorName || ''}</div></div>
                <div class="format1-infor-div fixedheightdiv"><div class="format1-tags">Reg. no:</div><div class="value">${report.bookingId || ''}</div></div>
                <div class="format1-infor-div forhide fixedheightdiv"><div class="format1-tags">Lab Name:</div><div class="value">${report.labName || ''}</div></div>
                <div class="format1-infor-div forhide" id="investDiv"><div class="format1-tags">Investigations:</div><div class="value"><span id="investigationarray">${Array.isArray(report.uniquetestArray) ? report.uniquetestArray.join(', ') : (report.uniquetestArray || '')}</span></div></div>
            </div>
            <div class="format1-right2">
                <div>
                    <div class="format1-registered-div2">
                        <div class="barcode-div2"><div class="barcode2"><div id="barcodeContainer2">
                            <img id="barcodeImage" alt="Generated Barcode" style="background:transparent;" />
                        </div></div></div>
                    </div>
                    <div class="format1-registered-div2">
                        <div class="format1-registeration-tag2">Registered on:</div>
                        <div class="format1-time-div">${registeredOnFormatted}</div>
                    </div>
                    <div class="format1-registered-div2 forhide">
                        <div class="format1-registeration-tag2">Collected on:</div>
                        <div class="format1-time-div">${formatDateTime(report.collectedOn)}</div>
                    </div>
                    <div class="format1-registered-div2 forhide">
                        <div class="format1-registeration-tag2">Received on:</div>
                        <div class="format1-time-div">${formatDateTime(report.receivedOn)}</div>
                    </div>
                    <div class="format1-registered-div2">
                        <div class="format1-registeration-tag2">Reported on:</div>
                        <div class="format1-time-div">${formatDateTime(report.reportedOn)}</div>
                    </div>
                </div>
            </div>
            <div class="format1-rightcover"><span>${report.bookingId || ''}</span></div>
            <div class="sign click qr-div">
                <div id="qrCheckbox"><input type="checkbox"></div>
                <img id="qrimg" src="${window.location.origin}/images/download.png" style="display:block;" loading="eager" decoding="sync">
                <div class="branding">
                    <strong class="poweredby">Powered By</strong>
                    <span class="occusoft">www.LabFlow</span>
                </div>
            </div>`;

            const reportDetails = document.querySelector(".report-details");
            if (reportDetails) {
                reportDetails.appendChild(patientdetails);
            }
        }

        async function barcodegenerator() {
            try {
                let booking = null;
                try {
                    booking = JSON.parse(localStorage.getItem('booking') || 'null');
                } catch (e) {
                    booking = null;
                }
                const barcodeNumber = booking?.acceptedbarcode?.[0] || booking?.bookingId || report?.bookingId || value1;
                if (!barcodeNumber) return;

                const response = await fetch(`/api/v1/user/generate-barcode?nonumber=${true}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        number: barcodeNumber,
                        displayValue: false,
                        background: 'transparent'
                    }),
                });
                if (response.ok) {
                    const data = await response.json();
                    const barcodeImg = document.getElementById("barcodeImage");
                    if (barcodeImg && data?.barcode) {
                        barcodeImg.src = data.barcode;
                        barcodeImg.style.background = 'transparent';
                    }
                } else {
                    console.warn("Failed to generate barcode!");
                }
            } catch (error) {
                console.error("Error generating barcode:", error);
            }
        }

        async function renderData(data) {
            const container = document.getElementById("tables-container");
            if (!container) return;

            const fragment = document.createDocumentFragment();
            container.innerHTML = "";
            const categories = Array.isArray(data?.CategoryAndTest) ? data.CategoryAndTest : [];

            for (let index = 0; index < categories.length; index++) {
                const categoryData = categories[index];
                const section = document.createElement("div");
                section.className = "section";
                if (data.categorizedPDF && index > 0) section.classList.add("page-break");

                const headings = document.createElement("div");
                headings.classList.add("headings");

                const deleteH2Button = document.createElement("span");
                deleteH2Button.innerHTML = `<i class="fa-sharp fa-solid fa-xmark" title="Delete Entire category section"></i>`;
                deleteH2Button.className = "delete-btn wrong";

                const categoryHeading = document.createElement("h3");
                categoryHeading.classList.add("category-heading");
                categoryHeading.textContent = categoryData.category || '';
                categoryHeading.appendChild(deleteH2Button);
                headings.appendChild(categoryHeading);

                let titleHeading = null;
                if (categoryData.category !== categoryData.title) {
                    const deleteH3Button = document.createElement("span");
                    deleteH3Button.innerHTML = `<i class="fa-sharp fa-solid fa-xmark" title="Delete Panel"></i>`;
                    deleteH3Button.className = "delete-btn";

                    if (categoryData.title && !categoryData.title.includes('Unknown Title')) {
                        titleHeading = document.createElement("h4");
                        titleHeading.classList.add("table-heading");
                        titleHeading.textContent = categoryData.title;
                        titleHeading.appendChild(deleteH3Button);
                        headings.appendChild(titleHeading);
                    }

                    deleteH3Button.addEventListener("click", () => {
                        titleHeading?.remove();
                        section.querySelector("table")?.remove();
                    });
                }

                section.appendChild(headings);

                const table = document.createElement("table");
                table.className = "test-table";
                table.innerHTML = `
                    <thead>
                        <tr>
                            <th class="deletion"></th>
                            <th>Test Name</th>
                            <th class="valuecell">Value</th>
                            <th>Unit</th>
                            <th>Reference</th>
                        </tr>
                    </thead>`;

                const tbody = document.createElement("tbody");
                const tbodyFrag = document.createDocumentFragment();

                const tests = Array.isArray(categoryData?.tests) ? categoryData.tests : [];
                tests.forEach((test) => {
                    let testRow;

                    if (test.testName) {
                        testRow = document.createElement("tr");
                        if (test.pagebreak) testRow.classList.add('page-break');

                        let isBold = Boolean(test.isBold || test.isAbnormal);
                        let testNameSuffix = "";
                        const refType = (test.referenceType || "").toLowerCase();

                        if (typeof test.reference === "string" && refType !== "text") {
                            const parts = test.reference.split(" - ");
                            if (parts.length === 2) {
                                const lo = parseFloat(parts[0]), hi = parseFloat(parts[1]), v = parseFloat(test.value);
                                if (!isNaN(lo) && !isNaN(hi) && !isNaN(v)) {
                                    if (v < lo) { isBold = true; testNameSuffix = "L"; }
                                    else if (v > hi) { isBold = true; testNameSuffix = "H"; }
                                }
                            }
                        }

                        if (typeof test.value === "string" && test.value.toLowerCase().includes("positive")) {
                            isBold = true;
                        }
                        if (isBold) {
                            testRow.style.fontWeight = "bold";
                            testRow.classList.add('BoldRow', 'abnormal-result-row');
                        }

                        if (test.isDocumented) {
                            testRow.innerHTML = `
                            <td class="wrong"><span class="delete-row-icon" title="Delete Row"><i class="fa-sharp fa-solid fa-xmark"></i></span></td>
                            <td colspan="4" style="padding:0;border:none;"><div class="documented-content">${test.testName || ''}</div></td>`;
                        } else {
                            testRow.innerHTML = `
                            <td class="wrong"><span class="delete-row-icon" title="Delete Row"><i class="fa-sharp fa-solid fa-xmark"></i></span></td>
                            ${test.testName || ''}
                            <td class="high-low"><div class="HL"><span class="high-low-marker">${testNameSuffix}</span></div><span class="result-value">${test.value || ''}</span></td>
                            <td>${test.unit || ''}</td>
                            <td>${test.reference || ''}</td>`;
                        }
                        tbodyFrag.appendChild(testRow);
                    }

                    if (test.remark) {
                        const remarkRow = document.createElement("tr");
                        remarkRow.innerHTML = `
                        <td class="wrong"></td>
                        <td colspan="4" class="remark-row"><div>Remark:</div> <span>${test.remark}</span></td>`;
                        tbodyFrag.appendChild(remarkRow);
                    }

                    if (test.details) {
                        const detailsRow = document.createElement("tr");
                        detailsRow.innerHTML = `
                        <td class="wrong"></td>
                        <td colspan="4" class="details-row"><div class="documented-content">${test.details}</div></td>`;
                        tbodyFrag.appendChild(detailsRow);
                    }

                    const deleteIcon = testRow?.querySelector(".delete-row-icon");
                    if (deleteIcon) {
                        deleteIcon.addEventListener("click", () => {
                            const currentRow = deleteIcon.closest("tr");
                            let next = currentRow?.nextElementSibling;
                            if (next?.querySelector(".remark-row")) { next.remove(); next = currentRow?.nextElementSibling; }
                            if (next?.querySelector(".details-row")) next.remove();
                            currentRow?.remove();
                        });
                    }
                });

                tbody.appendChild(tbodyFrag);

                ['advice', 'notes', 'remarks'].forEach(key => {
                    if (categoryData[key]) {
                        const row = document.createElement("tr");
                        const cell = document.createElement("td");
                        cell.colSpan = 4;
                        cell.className = key;
                        cell.innerHTML = `<div>${key.charAt(0).toUpperCase() + key.slice(1)}:</div> <span>${categoryData[key]}</span>`;
                        row.appendChild(cell);
                        tbody.appendChild(row);
                    }
                });

                table.appendChild(tbody);

                if (categoryData.interpretation) {
                    const row = document.createElement("tr");
                    const cell = document.createElement("td");
                    cell.colSpan = 4;
                    cell.innerHTML = `<div class="interpretation"><p style="font-weight:bold;">Interpretation</p>${categoryData.interpretation}</div>`;
                    row.appendChild(cell);
                    table.appendChild(row);
                }

                section.appendChild(table);
                deleteH2Button.addEventListener("click", () => section.remove());
                fragment.appendChild(section);

                if ((index + 1) % 2 === 0) {
                    container.appendChild(fragment);
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                }
            }

            if (fragment.childNodes.length > 0) {
                container.appendChild(fragment);
            }

            if (data.MoreDetails) {
                const more = document.createElement("div");
                more.className = "moreDetails";
                more.innerHTML = `<span>Additional Findings :-</span><br><div>${data.MoreDetails}</div>`;
                container.appendChild(more);
            }
        }

        async function fetchTemplateImages() {
            try {
                const response = await fetch(`/api/v1/user/templates`, { method: "POST" });
                if (!response.ok) return null;
                const data = await response.json();
                if (data.urls && Array.isArray(data.urls) && data.urls.length > 0) {
                    const templateItem = data.urls[0];
                    let bgImage = templateItem.backgroundImageInBase64 || null;
                    if (!bgImage && templateItem.template) {
                        try {
                            bgImage = await urlToBase64(templateItem.template);
                        } catch (e) {
                            bgImage = templateItem.template;
                        }
                    }
                    return bgImage;
                }
            } catch (error) {
                console.error('Error fetching template images from Template DB:', error);
            }
            return null;
        }

        function countLines() {
            const reportDetails = document.querySelector(".report-details");
            return reportDetails ? reportDetails.offsetHeight : 0;
        }

        async function signoffdivfunction() {
            const signButton = document.getElementById("signOff");

            const isLayerOne = user?.tenantId?.modelType === "1layer";
            let isSignedOff = Boolean(report.signOff);

            const syncSignoffUi = (signed) => {
                document.querySelectorAll(".click").forEach((btn) => {
                    btn.classList.toggle("sign", !signed);
                });
            };

            const persistSignoff = async (signoff) => {
                const updateData = await collectPdfPayload({ bookingId: report.bookingId, isdocumented: report.isdocumented });

                try {
                    const data = doctorsSignCache || await fetch(`${BASE_URL}/api/v1/user/getDoctorsSign`).then(r => r.json());
                    doctorsSignCache = data;
                    if (signoff && data) {
                        Object.assign(updateData, {
                            showlab: data.showlabinchargesign,
                            showdoctorfirst: data.showfirstdoctorsign,
                            showdoctorsecond: data.showseconddoctorsign,
                            fileInputLab: data.labinchargesignInBase64 || data.labinchargesign,
                            fileInputDoctorleft: data.firstdoctorsignInBase64 || data.firstdoctorsign,
                            fileInputDoctorright: data.seconddoctorsignInBase64 || data.seconddoctorsign,
                            fileInputLabtext: data.labinchargeinfo,
                            fileInputDoctorlefttext: data.firstdoctorsigninfo,
                            fileInputDoctorrighttext: data.seconddoctorsigninfo,
                        });
                    }
                } catch (error) {
                    console.log(error?.message || error);
                }

                await Promise.all([
                    fetch(`/api/v1/user/editReportsignofffield`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value1, signoff }),
                    }),
                    fetch(`/api/v1/user/adding-pdf-data`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updateData),
                    })
                ]);

                isSignedOff = signoff;
                report.signOff = signoff;
                if (report.bookingId) await updatebookingisreportreadyfield(report.bookingId);
                setTimeout(() => { prewarmPdfInBackground(); }, 0);
            };

            if (isLayerOne) {
                if (signButton) {
                    const signWrap = signButton.closest(".downloadDiv");
                    if (signWrap) signWrap.style.display = "none";
                }

                syncSignoffUi(true);

                if (!isSignedOff) {
                    persistSignoff(true).catch((error) => {
                        console.error("Error applying default signoff for layer-1:", error);
                    });
                }
                return;
            }

            syncSignoffUi(isSignedOff);

            if (signButton) {
                signButton.addEventListener("click", async function (e) {
                    const button = e.currentTarget;
                    setButtonBusy(button, true, 'Saving...');
                    setActionFeedback('Sign status update ho raha hai...', 'info', { autoHideMs: 0 });

                    const prevSignedOff = isSignedOff;
                    const nextSignoff = !prevSignedOff;

                    try {
                        await persistSignoff(nextSignoff);
                        syncSignoffUi(nextSignoff);
                        setActionFeedback(nextSignoff ? 'Report sign off ho gayi.' : 'Report sign off hata di gayi.', 'success');
                    } catch (error) {
                        syncSignoffUi(prevSignedOff);
                        console.error('Error:', error);
                        setActionFeedback('Sign off update nahi ho paayi. Please try again.', 'error');
                    } finally {
                        setButtonBusy(button, false);
                    }
                });
            }
        }

        async function updatebookingisreportreadyfield(bookingid) {
            if (!bookingid) return;
            try {
                const response = await fetch(`/api/v1/user/CompleteBookingcontroller`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ bookingid }),
                });
                if (!response.ok) console.log("status not updated");
            } catch (error) { console.log(error); }
        }

        // ─── DOWNLOAD PDF ─────────────────────────────────────────────────────────
        async function downloadpdffunction({
            labinchargesign = null, checkBox = false, labinchargeinfo = "",
            headermargin, footermargin, marginRight, marginLeft,
            labinchargesignurl = null, selectedFontSize, RowSpacing,
            HighLow, HLinred, BoldRow, showInvest, DownloadPdf = true
        } = {}) {
            const downloadBtn = document.getElementById('downloadPDF');
            if (!downloadBtn) return;

            downloadBtn.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                setButtonBusy(button, true, 'Downloading...');
                setActionFeedback('PDF download prepare ho rahi hai...', 'info', { autoHideMs: 0 });

                try {
                    const latestPayload = await collectPdfPayload({}, { withBackground: !checkBox });

                    const response = await fetch(`/api/v1/user/get-pdf`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...latestPayload,
                            value1,
                            labinchargesign,
                            checkBox,
                            headermargin, footermargin, marginRight, marginLeft,
                            selectedFontSize, RowSpacing, HighLow, HLinred,
                            BoldRow, showInvest, DownloadPdf,
                            isReportFormat: true
                        }),
                    });
                    if (!response.ok) throw new Error('PDF generation failed');

                    const pdfBlob = await response.blob();

                    const safeName = (report?.patientName || 'Patient')
                        .replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, '').trim().replace(/\s+/g, '_');
                    const safeId = (report?.bookingId || '').replace(/[^a-zA-Z0-9]/g, '');
                    const link = document.createElement('a');
                    link.href = window.URL.createObjectURL(pdfBlob);
                    link.download = `${safeName}-${safeId}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    const trackedDownloadAction = await trackSuccessfulAction('downloadPdf');
                    if (report?.bookingId) await updatebookingisreportreadyfield(report.bookingId);
                    setActionFeedback(
                        trackedDownloadAction?.queued
                            ? 'PDF download ho gayi. Count locally save ho gaya, backend sync automatic hoga.'
                            : 'PDF download ho gayi aur count update ho gaya.',
                        trackedDownloadAction?.queued ? 'info' : 'success'
                    );
                } catch (error) {
                    console.error('Error generating PDF:', error);
                    setActionFeedback('PDF download nahi ho paayi. Please try again.', 'error');
                } finally {
                    setButtonBusy(button, false);
                }
            });
        }

        // ─── Browser Print ────────────────────────────────────────────────────────
        document.getElementById('BrowserPrint')?.addEventListener('click', async function (e) {
            const button = e.currentTarget;
            setButtonBusy(button, true, 'Opening...');
            setActionFeedback('Print preview open ho raha hai...', 'info', { autoHideMs: 0 });
            try {
                const printArea = document.getElementById('container')?.innerHTML || '';
                const cssContent = document.getElementById('stying')?.innerHTML || '';
                const printWindow = window.open('', '_blank');
                if (!printWindow) throw new Error('Popup blocked');
                printWindow.document.open();
                printWindow.document.write(`<html><head><title>Print Report</title>
                    <style>${cssContent} body{font-family:Arial,sans-serif;margin:20px;}</style></head>
                    <body onload="window.print();window.close();">${printArea}</body></html>`);
                printWindow.document.close();
                const trackedPrintAction = await trackSuccessfulAction('printDialog');
                setActionFeedback(
                    trackedPrintAction?.queued
                        ? 'Print preview open ho gaya. Count locally save ho gaya, backend sync automatic hoga.'
                        : 'Print preview open ho gaya aur count update ho gaya.',
                    trackedPrintAction?.queued ? 'info' : 'success'
                );
            } catch (error) {
                console.error('Error opening print preview:', error);
                setActionFeedback('Print preview open nahi ho paaya. Please try again.', 'error');
            } finally {
                setButtonBusy(button, false);
            }
        });

        function hidecontent() {
            if (user?.showprintsetting === false) {
                const printBtn = document.getElementById('printsettingbutton');
                if (printBtn) printBtn.style.display = "none";
            }
            if (user?.tenantId?.modelType === "1layer") {
                const style = document.getElementById("stying");
                if (style) {
                    style.textContent += `
                    .format1-rightcover{height:75px;}
                    #qrimg{width:83px;height:73px;}
                    .click.qr-div{right:42px;top:5px;}
                    @media print{
                        .format1-rightcover{height:50px !important;}
                        .format1-registered-div2{font-size:11px !important;}
                        .format1-rightcover{left:62.1%;}
                        .report-details-innerDiv2{min-height:70px !important;}
                        #qrimg{width:55px !important;height:45px !important;}
                    }`;
                }
                document.querySelectorAll('.forhide').forEach(elem => { elem.style.display = "none"; });
            }
        }
    } catch (error) {
        markPageFailed(error);
    }
})();
