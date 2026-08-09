// Global variables
let userId;
let role;
let username;
let userRole;
let user;
let BASE_URL = window.location.origin;

function normalizeGlobalId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return normalizeGlobalId(value._id);
  if (typeof value === "object" && value.id) return normalizeGlobalId(value.id);
  return String(value);
}

function syncAdminGlobals() {
  window.userId = normalizeGlobalId(userId || user?.parentUser || user?._id);
  window.role = role || "";
  window.username = username || "";
  window.userRole = userRole || "";
  window.user = user || null;
  window.BASE_URL = BASE_URL || window.location.origin;
}

syncAdminGlobals();

// Select elements
const helpDiv = document.querySelector(".help-div");
const helpPopup = document.getElementById("helpPopup");
const closeHelpBtn = document.getElementById("closeHelpBtn");

// Show popup when Help is clicked
helpDiv.addEventListener("click", () => {
  if (helpPopup.style.display === "block") {
    helpPopup.style.display = "none";
  } else {
    helpPopup.style.display = "block";
  }
});

// Also hide if clicking outside the popup
window.addEventListener("click", (e) => {
  if (e.target === helpPopup) {
    helpPopup.style.display = "none";
  }
});


function notifications() {
  const toggleBtn = document.querySelector('#toggleNotifications');
  const notificationContainer = document.querySelector('#notificationContainer');

  toggleBtn.addEventListener('click', () => {

    const isShown = notificationContainer.classList.toggle('show');
    toggleBtn.setAttribute('aria-expanded', isShown);
    if (isShown) {
      // Move focus to the notification container for accessibility
      notificationContainer.focus();
    } else {
      // Return focus to the toggle button
      toggleBtn.focus();
    }
  });
}
notifications();

// Toggle sidebar functionality
function toggleSidebar() {
  let sidebar = document.getElementById("left-navbar");
  let mainContent = document.getElementById("content-box");
  sidebar.classList.toggle("hidden");
  mainContent.classList.toggle("collapsed");
}

// Toggle submenu items
function toggleSubItems(id) {
  var subItems = document.getElementById(id);
  var toggleItem = subItems.previousElementSibling;

  // Toggle the visibility of the sub-items
  if (subItems.style.display === "block") {
    subItems.style.display = "none";
  } else {
    subItems.style.display = "block";
  }
  // Toggle the class for the rotation of the toggle symbol
  toggleItem.classList.toggle("expanded");
}

// Logout functionality
function logout() {
  fetch(`${BASE_URL}/api/v1/user/logout`, {
    method: "POST",
    credentials: "include",
  })
    .then((response) => {
      if (response.ok) {
        localStorage.clear();
        sessionStorage.clear();
        console.log("Logout successful");
        window.location.href = `${BASE_URL}/franchiseelogin.html`;
      } else {
        throw new Error("Logout failed");
      }
    })
    .catch((error) => {
      console.error("Error:", error);
    });
}

// Menu configuration based on user roles and tenant layers
const menuConfig = {
  // First layer admin - hide franchisee sections
  admin1layer: {
    hidden: [
      "Add_franchisse", "List_franchisse", "Accounts",
      "Assign_price", "Bulk_pricing", "Transfer_pricing",
      "Assign_credit", "Credit_history"
    ],
  },
  // Second layer admin - show all franchisee sections
  admin2layer: {
    hidden: [],
  },
  // Third layer admin - show all franchisee sections
  admin3layer: {
    hidden: [],
  },
  // Fourth layer admin - show all franchisee sections
  admin4layer: {
    hidden: [],
  },
  franchisee: {
    // All sections visible for franchisee
    hidden: [],
  },
  staff: {
    // Hide management sections for staff
    hidden: [
      "Add_staff", "List_staff", "Add_lab",
      "List_lab", "Add_doctor", "List_doctor",
    ],
  },
};

/**
 * Apply staff permissions to hide/show menu items and pages
 * @param {Object} user - User object with permissions
 */
function applyStaffPermissions(user) {
  // Only apply for staff role
  if (user.role !== 'staff') {
    console.log('Not a staff user, skipping permission checks');
    return;
  }

  console.log('Applying staff permissions:', user.permissions);

  const permissions = user.permissions || {};

  // Helper function to hide elements by data-page attribute
  function hidePageElements(pageName) {
    const elements = document.querySelectorAll(`[data-page="${pageName}"]`);
    elements.forEach(elem => {
      const parentLi = elem.closest('li');
      if (parentLi) {
        parentLi.style.display = 'none';
      }
    });
  }

  // Helper function to hide sections by ID
  function hideSectionById(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
      section.style.display = 'none';
      // Also hide the parent toggle button
      const parentItem = section.previousElementSibling;
      if (parentItem && parentItem.tagName === 'LI') {
        parentItem.style.display = 'none';
      }
    }
  }

  // Helper function to hide booking section headings
  function hideBookingSection(sectionName) {
    const headings = document.querySelectorAll('.booking-inner span.book_po');
    headings.forEach(heading => {
      if (heading.textContent.includes(sectionName)) {
        const bookingSection = heading.closest('.booking');
        if (bookingSection) {
          bookingSection.style.display = 'none';
        }
      }
    });
  }

  // ==========================================
  // 1. canManageBookings Permission
  // ==========================================
  if (!permissions.canManageBookings) {
    console.log('Hiding booking-related elements');
    
    // Hide samples page
    hidePageElements('samples');
    
    // Hide new booking page
    hidePageElements('new_booking');
    
    // Hide cancel booking page
    hidePageElements('cancel_booking');
    
    // Hide cancelled bookings page
    hidePageElements('cancelled');
    
    // Hide manage booking section
    hideSectionById('manageBooking');
    
    // Hide generate bill section
    hideSectionById('subItems2');
    hidePageElements('generatebill');
    
    // Hide samples dropdown section (subItem001)
    hideSectionById('subItem001');
    
    // Hide top navbar booking button
    const topNavBookingBtns = document.querySelectorAll('.top-navbar [data-page="new_booking"]');
    topNavBookingBtns.forEach(btn => {
      const parentLi = btn.closest('li');
      if (parentLi) parentLi.style.display = 'none';
    });
  }

  // ==========================================
  // 2. canViewReports Permission
  // ==========================================
  if (!permissions.canViewReports) {
    console.log('Hiding reports-related elements');
    
    // Hide cases page
    hidePageElements('allcases');
    
    // Hide samples page
    hidePageElements('samples');
    
    // Hide top navbar cases button
    const topNavCasesBtns = document.querySelectorAll('.top-navbar [data-page="allcases"]');
    topNavCasesBtns.forEach(btn => {
      const parentLi = btn.closest('li');
      if (parentLi) parentLi.style.display = 'none';
    });
    
    // Hide top navbar samples button
    const topNavSamplesBtns = document.querySelectorAll('.top-navbar [data-page="samples"]');
    topNavSamplesBtns.forEach(btn => {
      const parentLi = btn.closest('li');
      if (parentLi) parentLi.style.display = 'none';
    });
  }

  // ==========================================
  // 3. canManageUsers Permission
  // ==========================================
  if (!permissions.canManageUsers) {
    console.log('Hiding user management elements');
    
    // Hide My Franchisee section and all sub-options
    hideSectionById('subItems-b');
    hidePageElements('Add_franchisse');
    hidePageElements('List_franchisse');
    hidePageElements('Accounts');
    
    // Hide Franchisee Price section
    hideSectionById('subItems-c');
    hidePageElements('Assign_price');
    hidePageElements('Bulk_pricing');
    
    // Hide Franchisee Credits section
    hideSectionById('subItems-d');
    hidePageElements('Assign_credit');
    hidePageElements('assignTarget');
    hidePageElements('Credit_history');
    
    // Hide MY FRANCHISEE heading
    hideBookingSection('MY FRANCHISEE');
    
    // Hide orders page
    hidePageElements('Allorders');
    const topNavOrdersBtns = document.querySelectorAll('.top-navbar [data-page="Allorders"]');
    topNavOrdersBtns.forEach(btn => {
      const parentLi = btn.closest('li');
      if (parentLi) parentLi.style.display = 'none';
    });
    
    // Hide My Staff section and all sub-options
    hideSectionById('subItems-e');
    hidePageElements('Add_staff');
    hidePageElements('List_staff');
    hidePageElements('staffActivity');
    
    // Hide STAFF heading
    hideBookingSection('STAFF');
    
    // Hide Manage Doctors section
    hideSectionById('subItems5');
    hidePageElements('Add_doctor');
    hidePageElements('List_doctor');
    
    // Hide Manage Lab section
    hideSectionById('subItems6');
    hidePageElements('Add_lab');
    hidePageElements('List_lab');
    
    // Hide Manage Inventory section and all sub-options
    hideSectionById('subItems7');
    hidePageElements('inventory');
    hidePageElements('Addproduct');
  }

  // ==========================================
  // 4. canManagePayments Permission
  // ==========================================
  if (!permissions.canManagePayments) {
    console.log('Hiding payment-related elements');
    
    // Hide track ledger page
    hidePageElements('fullLedger');
    
    // Hide expense section
    hideSectionById('subItems8');
    hidePageElements('addexpense');
    hidePageElements('expense');
    
    // Hide budget category page
    hidePageElements('budgetCategory');
    
    // Hide remaining days page
    hidePageElements('refferDashboard');
    
    // Hide Franchisee Credits section
    hideSectionById('subItems-d');
    hidePageElements('Assign_credit');
    hidePageElements('assignTarget');
    hidePageElements('Credit_history');
    
    // Hide Expense heading
    hideBookingSection('Expense');
  }

  // ==========================================
  // 5. canManageTest Permission
  // ==========================================
  if (!permissions.canManageTest) {
    console.log('Hiding test management elements');
    
    // Hide Test Database section and all sub-options
    const testDatabaseSection = document.getElementById('testdatabase');
    if (testDatabaseSection) {
      testDatabaseSection.style.display = 'none';
    }
    
    hideSectionById('subItem');
    hidePageElements('test');
    hidePageElements('addTestDocument');
    hidePageElements('testPackage');
    hidePageElements('testPanels');
    hidePageElements('category');
  }

  console.log('Staff permissions applied successfully');
}

// Function to check and hide print setting button on page load
// Call this function after loading any page
function checkAndHidePrintSettingButton(user) {
  if (user.role === 'staff' && user.permissions && !user.permissions.canManageTest) {
    const observer = new MutationObserver((mutations) => {
      const printSettingBtn = document.getElementById('printsettingbutton');
      if (printSettingBtn) {
        printSettingBtn.style.display = 'none';
        console.log('Print setting button hidden by observer');
      }
    });

    // Observe the content box for changes
    const contentBox = document.getElementById('content-box');
    if (contentBox) {
      observer.observe(contentBox, {
        childList: true,
        subtree: true
      });
    }
  }
}

// Verify token and extract user role with admin layer
async function verifyAccessToken() {
  try {
    const response = await fetch(`${BASE_URL}/api/verify-token`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      console.error("Authentication failed");
      localStorage.clear();
      sessionStorage.clear();
      return false;
    }

    const data = await response.json();
    if (data.user.role === "staff") {
      userId = data.user.parentUser;
      username = data.user.username;
      role = data.user.createdBy.role;
      userRole = data.user.role;
      user = data.user;
      document.getElementById('logo').src = user.tenantId.logo || '/images/logoLabFlow.svg';
      console.log("Staff user role:");
      usericon(user);

    }

    else {
      console.log("User role:");
      userId = data.user._id;
      username = data.user.username;
      role = data.user.role;
      userRole = data.user.role;
      user = data.user;
      document.getElementById('logo').src = user.tenantId.logo || '/images/logoLabFlow.svg';
      usericon(user);

    }
    // console.log("userdetails:", user);

    // Check if the user is an admin and extract the layer if available
    // If adminLayer is not provided in the API response, we can check localStorage
    // Or you can modify your backend to include this information
    if (role === "admin") {
      // Try to get adminLayer from localStorage or API response
      const adminLayer = data.user.tenantId.modelType;
      console.log("Admin layer:", adminLayer);
      role = `admin${adminLayer}`;
    }

    syncAdminGlobals();

    // console.log("User role with layer:", role);

    // Initialize menu based on the role
    initializeMenu(role);
    console.log("Menu initialized for role:", data);
    
    // Apply staff permissions if user is staff
    if (userRole === 'staff') {
      applyStaffPermissions(user);
      // Start observer for print setting button
      checkAndHidePrintSettingButton(user);
    }
    
    // If subscription object exists and is not active -> show modal
    try {
      if (data.user && data.user.subscription && data.user.subscription.isActive === false) {
        // call modal to block UI and allow screenshot upload/manual activation
        showSubscriptionModal();
      }
    } catch (e) {
      console.warn('Subscription check failed', e);
    }

    return data.isAuthorized;
  } catch (error) {
    console.error("Error verifying token:", error);
    return false;
  }
}

async function usericon(user) {
  const userAvatar = document.getElementById("userAvatar");
  const userPopup = document.getElementById("userPopup");

  if (user.showtestdatabase === false) {
    document.getElementById('testdatabase').style.display = "none";
  }

  if (user.tenantId.modelType === "1layer") {
    const divs = document.querySelectorAll('.forhide');
    divs.forEach(elem => {
      elem.style.display = "none";
    })
  }

  // Toggle popup on avatar click
  userAvatar.addEventListener("click", () => {
    userPopup.style.display = userPopup.style.display === "block" ? "none" : "block";
  });

  // Close popup if click happens outside
  document.addEventListener("click", (e) => {
    if (!userAvatar.contains(e.target) && !userPopup.contains(e.target)) {
      userPopup.style.display = "none";
    }
  });

  // Example logout action
  document.getElementById("logoutBtn").addEventListener("click", () => {
    alert("Logged out!");
    // window.location.href = "/login";
  });

  // Example: Set user data dynamically
  // const user = {
  //   name: "John Doe",
  //   email: "john@example.com",
  //   avatarSmall: "https://i.pravatar.cc/40?img=5",
  //   avatarLarge: "https://i.pravatar.cc/80?img=5"
  // };

  document.getElementById("userName").textContent = user.fullName;
  document.getElementById("userEmail").textContent = user.email;
  document.getElementById("userAvatarImg").src = user.profileimage || '/images/default-avatar.svg';
  document.getElementById("popupAvatar").src = user.profileimage || '/images/default-avatar.svg';
}

// Function to initialize menu based on user role and tenant layer
function initializeMenu(userRole) {
  console.log("Initializing menu for role:", userRole);

  // Parse the role to determine if it's admin with layer
  let role = userRole; // Default to admin1 if undefined

  // Check if role is in the menuConfig, otherwise default to admin1
  if (!menuConfig[role]) {
    role = "admin1layer";
  }

  // Extract the layer number from the role (if it's an admin role)
  let layerNumber = 1;
  if (role.startsWith("admin") && role.length > 5) {
    layerNumber = parseInt(role.substring(5)) || 1;
  }

  // Get the hidden items for this role
  const hiddenItems = menuConfig[role]?.hidden || [];
  console.log("Items to hide:", hiddenItems);

  // Hide menu items based on role
  hiddenItems.forEach((itemId) => {
    const menuItems = document.querySelectorAll(`[data-page="${itemId}"]`);
    console.log(`Looking for items with data-page="${itemId}"`, menuItems.length);

    menuItems.forEach((item) => {
      // Find the parent li element
      const parentLi = item.closest("li");
      if (parentLi) {
        parentLi.style.display = "none";
        console.log(`Hidden: ${itemId}`);
      }
    });
  });

  // Only hide franchisee sections for admin1
  if (role === "admin1layer") {
    // Franchisee sections to hide
    const franchiseeSections = [
      "subItems-b", "subItems-c", "subItems-d"
    ];

    // Hide the sections and their headers
    franchiseeSections.forEach(sectionId => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.style.display = "none";
        // Also hide the parent menu item that toggles this section
        const parentItem = section.previousElementSibling;
        if (parentItem && parentItem.tagName === "LI") {
          parentItem.style.display = "none";
        }
      }
    });

    // Also hide the FRANCHISEE heading
    const franchiseeHeadings = document.querySelectorAll('.booking-inner span.book_po');
    franchiseeHeadings.forEach(heading => {
      if (heading.textContent.includes("FRANCHISEE")) {
        const bookingSection = heading.closest('.booking');
        if (bookingSection) {
          bookingSection.style.display = "none";
        }
      }
    });
  } else {
    // For admin2, admin3, admin4, ensure franchisee sections are visible
    const franchiseeSections = [
      "subItems-b", "subItems-c", "subItems-d"
    ];

    franchiseeSections.forEach(sectionId => {
      const section = document.getElementById(sectionId);
      if (section) {
        section.style.display = "none"; // Initially hide, will be toggled when needed
        // Make sure the parent menu item is visible
        const parentItem = section.previousElementSibling;
        if (parentItem && parentItem.tagName === "LI") {
          parentItem.style.display = "block";
          parentItem.style.display = "flex"
        }
      }
    });

    // Make sure the FRANCHISEE heading is visible
    const franchiseeHeadings = document.querySelectorAll('.booking-inner span.book_po');
    franchiseeHeadings.forEach(heading => {
      if (heading.textContent.includes("MY FRANCHISEE")) {
        const bookingSection = heading.closest('.booking');
        if (bookingSection) {
          bookingSection.style.display = "block";
          bookingSection.style.display = "flex";
        }
      }
    });
  }

  // Display username and role with layer information
  const nameElement = document.querySelector(".name_text");
  const roleElement = document.querySelector(".nt1");

  if (nameElement) {
    nameElement.textContent = username || "User";
  }

  if (roleElement) {
    // For admin roles, include the layer number in the display
    if (userRole.startsWith("staff")) {
      roleElement.textContent = `(STAFF - LAYER ${layerNumber})`;
    }
    // For franchisee roles, include the layer number in the display
    else if (userRole.startsWith("admin")) {
      roleElement.textContent = `(ADMIN - LAYER ${layerNumber})`;
    } else {
      // For other roles, just display the role in uppercase
      roleElement.textContent = `(${userRole.toUpperCase()})`;
    }
  }
}

// --- Subscription modal helpers ---
let __subscriptionHandlers = { keydown: null, click: null };
function showSubscriptionModal() {
  const modal = document.getElementById('subscriptionModal');
  if (!modal) return;
  // Show modal and prevent body scroll
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Prevent closing via outside click or ESC
  __subscriptionHandlers.keydown = function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Block clicks that are outside modal-content
  __subscriptionHandlers.click = function (e) {
    const content = modal.querySelector('.modal-content');
    if (content && !content.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  window.addEventListener('keydown', __subscriptionHandlers.keydown, true);
  window.addEventListener('click', __subscriptionHandlers.click, true);

  // Start polling subscription status every 10 seconds
  if (window._subscriptionPollInterval) clearInterval(window._subscriptionPollInterval);
  window._subscriptionPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/verify-token`, { method: 'GET', credentials: 'include', __topLoaderSilent: true });
      if (!res.ok) return; // still not authorized or server error
      const data = await res.json();
      if (data.user && data.user.subscription && data.user.subscription.isActive === true) {
        hideSubscriptionModal();
        // update local user object and UI
        user = data.user;
        usericon(user);
        clearInterval(window._subscriptionPollInterval);
        window._subscriptionPollInterval = null;
      }
    } catch (err) {
      console.warn('Subscription poll error', err);
    }
  }, 10000);
}

function hideSubscriptionModal() {
  const modal = document.getElementById('subscriptionModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  if (__subscriptionHandlers.keydown) {
    window.removeEventListener('keydown', __subscriptionHandlers.keydown, true);
    __subscriptionHandlers.keydown = null;
  }
  if (__subscriptionHandlers.click) {
    window.removeEventListener('click', __subscriptionHandlers.click, true);
    __subscriptionHandlers.click = null;
  }
  if (window._subscriptionPollInterval) {
    clearInterval(window._subscriptionPollInterval);
    window._subscriptionPollInterval = null;
  }
}


// Function to check authorization
async function checkAuthorization() {
  const isAuthorized = await verifyAccessToken();

  if (!isAuthorized) {
    window.location.href = `${BASE_URL}/index.html`;
    return false;
  }
  return true;
}

async function fetchNotifications() {
  try {
    const response = await fetch(`${BASE_URL}/api/v1/user/getnewnotificationforadmin`, { __topLoaderSilent: true });
    const data = await response.json();

    console.log("notification data:", data);

    if (!response.ok || data.status === "empty") {
      console.log(data.message);
      return;
    }

    populatemessages(data);
  } catch (error) {
    console.error("Error fetching notifications:", error);
  }

  function populatemessages(data) {
    const alertdiv = document.querySelector('.alert-div');
    const messagescountspan = alertdiv.querySelector("#messageshint");
    const messagescontainer = alertdiv.querySelector("#notificationContainer");

    messagescountspan.textContent = data.length;
    messagescontainer.innerHTML = ""; // ✅ Clear old notifications before adding new ones

    data.forEach((elem) => {
      const div = document.createElement('div');
      div.className = 'notification'; // ✅ FIXED
      div.setAttribute("role", "alert");
      div.setAttribute("data-objId", elem._id);

      div.innerHTML = `
                <span class="deletemsg" style="cursor:pointer;">✖</span>
                <strong>Booking ID:</strong> <span>${elem.relatedbooking?.bookingId || "N/A"}</span><br>
                <strong>Last Message:</strong> <span>${elem.lastMessage?.message || "No message"}</span><br>
                <strong>Patient Name:</strong> <span>${elem.relatedbooking?.patientName || "N/A"}</span><br>
                <strong>Franchisee:</strong> <span>${elem.relatedbooking?.createdBy?.username || "N/A"}</span>
            `;

      const deletebtn = div.querySelector('.deletemsg');

      deletebtn.addEventListener('click', async function () {
        const objId = div.getAttribute("data-objId");
        try {
          const response = await fetch(`${BASE_URL}/api/v1/user/changewatchedstatus/${objId}`);
          if (response.ok) {
            console.log("Conversation updated successfully");
            div.remove();
            if (messagescontainer.children.length === 0) {
              messagescountspan.textContent = "";
              messagescontainer.classList.remove('show');
            } else {
              messagescountspan.textContent = messagescontainer.children.length;
            }
          }
        } catch (error) {
          console.error("Error updating conversation:", error.message);
        }
      });

      messagescontainer.appendChild(div);
    });
  }
}

const DYNAMIC_PAGE_SCRIPT_SELECTOR = 'script[data-dynamic-page-script="true"]';

function pageUsesEditor(container) {
  return Boolean(container?.querySelector('#editor'));
}

// Load page function
async function loadPage(page, Name, _id, BASE_URL, name) {
  console.log("user:", user);
  const routeToken = window.AppTopLoader?.start(`route:${page}`);
  fetchNotifications();

  clearOldPage();

  try {
    const cacheBust = Date.now();
    const response = await fetch(`pages/pages/${page}.html?t=${cacheBust}`, { __topLoaderSilent: true });
    if (!response.ok) {
      throw new Error(`Failed to load page: ${page}`);
    }

    const html = await response.text();
    const container = document.querySelector(".content-box");
    container.innerHTML = html;

    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set("page", page);
    if (Name) urlParams.set("Name", Name);
    if (_id) urlParams.set("_id", _id);
    if (name) urlParams.set("name", name);
    window.history.pushState({ page }, "", `?${urlParams.toString()}`);

    if (pageUsesEditor(container)) {
      await loadScript(`./editor.js`);
    }

    await loadScript(`pages/pages/${page}.js?t=${cacheBust}`);

    if (user && user.role === 'staff') {
      checkAndHidePrintSettingButton(user);
    }

    // Highlight active menu item
    highlightActiveMenuItem(page);
  } catch (error) {
    console.error(error);
  } finally {
    if (routeToken) {
      window.AppTopLoader.done(routeToken);
    }
  }
}

window.loadPage = loadPage;

// Helper functions
function clearOldPage() {
  const container = document.querySelector(".content-box");
  if (window.editor && typeof window.editor.destroy === "function") {
    window.editor.destroy().catch((error) => console.warn("Editor cleanup failed:", error));
    window.editor = null;
  }
  document.querySelectorAll(DYNAMIC_PAGE_SCRIPT_SELECTOR).forEach((script) => {
    if (script.dataset.preserve !== "true") {
      script.remove();
    }
  });
  if (container) {
    container.innerHTML = "";
  }
}

function highlightActiveMenuItem(page) {
  // Remove active class from all menu items
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  // Add active class to current menu item
  const activeItems = document.querySelectorAll(
    `.nav-item[data-page="${page}"]`
  );
  activeItems.forEach((item) => {
    item.classList.add("active");
  });
}

function loadScript(url) {
  if (url === "./editor.js") {
    if (typeof window.editorInit === "function") {
      return Promise.resolve(null);
    }

    if (window.__editorPageScriptPromise) {
      return window.__editorPageScriptPromise;
    }
  }

  const loadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `${DYNAMIC_PAGE_SCRIPT_SELECTOR}[data-script-url="${url}"]`
    );
    if (existingScript) {
      if (url === "./editor.js") {
        resolve(existingScript);
        return;
      }
      existingScript.remove();
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.dataset.dynamicPageScript = "true";
    script.dataset.scriptUrl = url;
    if (url === "./editor.js") {
      script.dataset.preserve = "true";
    }
    script.onload = () => {
      if (url === "./editor.js") {
        window.__editorPageScriptPromise = Promise.resolve(script);
      }
      resolve(script);
    };
    script.onerror = () => {
      if (url === "./editor.js") {
        window.__editorPageScriptPromise = null;
      }
      script.remove();
      reject(new Error(`Failed to load script: ${url}`));
    };
    document.body.appendChild(script);
  });

  if (url === "./editor.js") {
    window.__editorPageScriptPromise = loadPromise;
  }

  return loadPromise;
}

window.loadScript = loadScript;

// Function to attach event listeners to menu items
function attachMenuEventListeners() {
  const navItems = document.querySelectorAll(".nav-item");
  let debounceTimeout;

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();

      // Debounce clicks
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        const page = item.getAttribute("data-page");
        if (page) {
          loadPage(page);
        }
      }, 300); // 300ms debounce delay
    });
  });
}

// Debug function to help troubleshoot admin layers
function debugAdminLayer() {
  // Only run in development or when specifically enabled
  const isDebugMode = localStorage.getItem("debugMode") === "true" ||
    window.location.search.includes("debug=true");

  if (!isDebugMode) return;

  console.log("🔍 DEBUG MODE ACTIVE");

  // Create a debug panel
  const debugPanel = document.createElement("div");
  debugPanel.style.position = "fixed";
  debugPanel.style.bottom = "10px";
  debugPanel.style.right = "10px";
  debugPanel.style.backgroundColor = "rgba(0,0,0,0.8)";
  debugPanel.style.color = "white";
  debugPanel.style.padding = "10px";
  debugPanel.style.borderRadius = "5px";
  debugPanel.style.zIndex = "9999";
  debugPanel.style.fontSize = "12px";
  debugPanel.style.maxWidth = "300px";

  // Add layer selector
  const layerSelector = document.createElement("select");
  layerSelector.innerHTML = `
    <option value="1">Layer 1</option>
    <option value="2">Layer 2</option>
    <option value="3">Layer 3</option>
    <option value="4">Layer 4</option>
  `;

  // Set the current layer
  const currentLayer = localStorage.getItem("superFranchisee") || "2layer";
  layerSelector.value = currentLayer;

  // Add event listener to change layer
  layerSelector.addEventListener("change", (e) => {
    const newLayer = e.target.value;
    localStorage.setItem("superFranchisee", newLayer);

    // Update the UI immediately
    const roleWithLayer = `superFranchisee${newLayer}`;
    initializeMenu(roleWithLayer);

    // Update the debug info
    document.getElementById("current-role").textContent = roleWithLayer;
  });

  // Add debug info and controls
  debugPanel.innerHTML = `
    <div style="margin-bottom:10px;"><strong>Admin Layer Debug</strong></div>
    <div style="margin-bottom:5px;">Current Role: <span id="current-role">${userRole || "unknown"}</span></div>
    <div style="margin-bottom:5px;">Override Layer: </div>
  `;

  // Append the layer selector
  debugPanel.appendChild(layerSelector);

  // Add a button to reload the page
  const reloadButton = document.createElement("button");
  reloadButton.textContent = "Apply & Reload";
  reloadButton.style.marginTop = "10px";
  reloadButton.style.padding = "5px";
  reloadButton.style.width = "100%";
  reloadButton.addEventListener("click", () => {
    window.location.reload();
  });

  debugPanel.appendChild(reloadButton);

  // Add to page
  document.body.appendChild(debugPanel);
}

// Initialize when DOM is fully loaded
document.addEventListener("DOMContentLoaded", async function () {
  // Verify token and initialize user data
  await verifyAccessToken();

  // Attach UPI screenshot upload handler (if modal present)
  const upiForm = document.getElementById('upiForm');
  if (upiForm) {
    upiForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const fileInput = document.getElementById('upiScreenshot');
      const statusDiv = document.getElementById('upiStatus');
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        if (statusDiv) { statusDiv.textContent = 'Please select a screenshot to upload.'; statusDiv.style.color = 'red'; }
        return;
      }
      const formData = new FormData();
      formData.append('screenshot', fileInput.files[0]);
      formData.append('userId', userId || '');
      try {
        if (statusDiv) { statusDiv.textContent = 'Uploading...'; statusDiv.style.color = 'blue'; }
        const res = await fetch(`${BASE_URL}/api/v1/user/upload-upi-screenshot`, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
        if (res.ok) {
          if (statusDiv) { statusDiv.textContent = 'Screenshot uploaded! SuperAdmin will verify and activate your account.'; statusDiv.style.color = 'green'; }
        } else {
          const text = await res.text();
          if (statusDiv) { statusDiv.textContent = 'Upload failed. Try again.'; statusDiv.style.color = 'red'; }
          console.warn('Upload failed', res.status, text);
        }
      } catch (err) {
        if (statusDiv) { statusDiv.textContent = 'Error uploading screenshot.'; statusDiv.style.color = 'red'; }
        console.error('Error uploading screenshot', err);
      }
    });
  }

  // Add event listener to the logout button
  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.addEventListener("click", logout);
  }

  // Set up event listeners for navbar items
  attachMenuEventListeners();

  // Load page from URL or default to dashboard
  const urlParams = new URLSearchParams(window.location.search);
  const currentPage = urlParams.get("page") || "dashboard";
  loadPage(currentPage);

  // Handle browser back/forward navigation
  window.addEventListener("popstate", (event) => {
    if (event.state) {
      loadPage(event.state.page);
    }
  });

  // Set up sidebar toggle if needed
  const toggleBtn = document.getElementById("toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleSidebar);
  }

  // Initialize debug tools if needed
  debugAdminLayer();
});

function loaderfunction() {
  window.AppTopLoader?.scanLegacyLoaders(document);
}

loaderfunction();
