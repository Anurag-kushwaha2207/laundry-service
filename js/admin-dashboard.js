import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  collection, 
  onSnapshot, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc,
  addDoc, 
  setDoc,
  query, 
  orderBy,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sendNotification } from "./notifications.js";
import { generateLogDocId, getReadableDateString } from "./db-helper.js";

const itemsListEl = document.getElementById("adminItemsList");
const pendingCountEl = document.getElementById("pendingCount");
const approvedCountEl = document.getElementById("approvedCount");
const rejectedCountEl = document.getElementById("rejectedCount");
const trackingCountEl = document.getElementById("trackingCount");
const complaintsCountEl = document.getElementById("complaintsCount");
const tabBtns = document.querySelectorAll(".tab-btn");

let currentTab = "pending";
let allItems = [];
let activeBookings = [];
let allComplaints = [];
let activeDispatchFilter = "all";

// Initialize & Perform Route Guard Security Access Check (Step C)
async function initDashboard() {
  const securityOverlay = document.getElementById("securityOverlay");

  // Helper to verify admin permissions solely from Firebase Firestore
  async function checkUserAdminInFirebase(userEmail) {
    if (!userEmail) return { isAllowed: false, reason: "No email provided" };
    try {
      const cleanEmail = userEmail.toLowerCase().trim();
      const userSnap = await getDoc(doc(db, "users", cleanEmail));
      if (!userSnap.exists()) {
        return { isAllowed: false, reason: `User '${cleanEmail}' not found in Firestore 'users' collection.` };
      }
      const data = userSnap.data();
      const role = data && data.role ? String(data.role).toLowerCase().trim() : "";
      if (role === "admin") {
        return { isAllowed: true, role: role, name: data.name || "Admin", phone: data.phone || "" };
      } else {
        return { isAllowed: false, reason: `Role is '${data.role || "none"}', not 'admin'.` };
      }
    } catch (e) {
      console.error("Firestore admin check error:", e);
      return { isAllowed: false, reason: `Firestore connection error: ${e.message}` };
    }
  }

  function grantAdminAccess(email, name = "Admin") {
    console.log("✅ Admin access granted for:", email);
    if (securityOverlay) securityOverlay.style.display = "none";
    loadDashboardData();
  }

  function showAdminLoginForm(initialMsg = "") {
    if (!securityOverlay) return;
    const box = securityOverlay.querySelector(".security-box");
    if (!box) return;

    box.innerHTML = `
      <ion-icon name="shield-checkmark" style="font-size: 48px; color: #38bdf8; margin-bottom: 8px;"></ion-icon>
      <h2 style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px;">Admin Authentication</h2>
      <p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px;">Enter your registered Admin Email to enter the dashboard.</p>
      <form id="adminVerifyForm" style="display: flex; flex-direction: column; gap: 10px; text-align: left;">
        <label style="font-size: 12px; font-weight: 600; color: #cbd5e1;">Admin Email Address</label>
        <input type="email" id="adminEmailInput" placeholder="e.g. ps591362@gmail.com" required style="padding: 11px 14px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 14px; box-sizing: border-box;">
        <button type="submit" id="adminVerifyBtn" style="padding: 12px; background: #0284c7; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 4px;">
          <ion-icon name="lock-open-outline"></ion-icon> Verify & Enter Dashboard
        </button>
        <div id="adminVerifyStatus" style="font-size: 12.5px; margin-top: 4px; color: #f87171; ${initialMsg ? 'display: block;' : 'display: none;'}">${initialMsg}</div>
        <div style="text-align: center; margin-top: 8px;">
          <a href="../index.html" style="color: #38bdf8; font-size: 13px; text-decoration: none;">← Return to Main Website</a>
        </div>
      </form>
    `;

    const form = document.getElementById("adminVerifyForm");
    const emailInput = document.getElementById("adminEmailInput");
    const statusDiv = document.getElementById("adminVerifyStatus");
    const btn = document.getElementById("adminVerifyBtn");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim().toLowerCase();
      if (!email) return;

      btn.disabled = true;
      btn.innerHTML = `<ion-icon name="sync-outline" class="spin-icon"></ion-icon> Verifying...`;
      statusDiv.style.display = "none";

      const check = await checkUserAdminInFirebase(email);
      if (check.isAllowed) {
        const userObj = { email: email, role: "admin", name: check.name || "Admin", phone: check.phone || "" };
        localStorage.setItem("laundry_current_user", JSON.stringify(userObj));
        grantAdminAccess(email, check.name);
      } else {
        btn.disabled = false;
        btn.innerHTML = `<ion-icon name="lock-open-outline"></ion-icon> Verify & Enter Dashboard`;
        statusDiv.style.display = "block";
        statusDiv.innerHTML = `❌ Access Denied: <strong>${email}</strong> does not have 'admin' role in Firebase.`;
      }
    });
  }

  // 1. Check local user session (website login session)
  let localUser = null;
  const savedUser = localStorage.getItem("laundry_current_user");
  if (savedUser) {
    try {
      localUser = JSON.parse(savedUser);
    } catch (e) {
      localUser = null;
    }
  }

  if (localUser && localUser.email) {
    const cleanEmail = (localUser.email || "").toLowerCase().trim();
    const checkResult = await checkUserAdminInFirebase(cleanEmail);
    if (checkResult.isAllowed) {
      localUser.role = "admin";
      localStorage.setItem("laundry_current_user", JSON.stringify(localUser));
      grantAdminAccess(cleanEmail, checkResult.name);
      return;
    } else {
      console.warn("User is logged in but not admin in Firestore:", cleanEmail);
      showAdminLoginForm(`Account <strong>${cleanEmail}</strong> is not configured as an Admin in Firebase.`);
      return;
    }
  }

  // 2. If no local user, check Firebase Auth
  try {
    onAuthStateChanged(auth, async (user) => {
      if (user && user.email) {
        const checkResult = await checkUserAdminInFirebase(user.email);
        if (checkResult.isAllowed) {
          const userObj = { email: user.email, role: "admin", name: checkResult.name || user.displayName || "Admin" };
          localStorage.setItem("laundry_current_user", JSON.stringify(userObj));
          grantAdminAccess(user.email, checkResult.name);
          return;
        }
      }
      showAdminLoginForm();
    });
  } catch (err) {
    console.warn("onAuthStateChanged error:", err);
    showAdminLoginForm();
  }
}

function loadDashboardData() {
  // Listen to rental items
  const rentalQuery = query(collection(db, "rental_items"), orderBy("createdAt", "desc"));
  onSnapshot(rentalQuery, (snapshot) => {
    allItems = [];
    snapshot.forEach((docSnap) => {
      allItems.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateCounts();
    renderCurrentTab();
  }, (error) => {
    console.error("Firestore Error (rental_items):", error);
  });

  // Listen to active rental bookings
  const bookingsQuery = query(collection(db, "rental_bookings"), orderBy("createdAt", "desc"));
  onSnapshot(bookingsQuery, (snapshot) => {
    activeBookings = [];
    snapshot.forEach((docSnap) => {
      activeBookings.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateCounts();
    if (currentTab === "tracking") renderTrackingTab();
  }, (error) => {
    console.warn("Firestore Warning (rental_bookings with orderBy):", error);
    // Safe fallback without orderBy so index/field issues never break tracking
    onSnapshot(collection(db, "rental_bookings"), (snapshot) => {
      activeBookings = [];
      snapshot.forEach((docSnap) => {
        activeBookings.push({ id: docSnap.id, ...docSnap.data() });
      });
      updateCounts();
      if (currentTab === "tracking") renderTrackingTab();
    }, (err2) => {
      console.error("Firestore Error fallback (rental_bookings):", err2);
    });
  });

  // Listen to rental complaints & dispute tickets
  const complaintsQuery = query(collection(db, "rental_complaints"), orderBy("createdAt", "desc"));
  onSnapshot(complaintsQuery, (snapshot) => {
    allComplaints = [];
    snapshot.forEach((docSnap) => {
      allComplaints.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateCounts();
    if (currentTab === "complaints") renderComplaintsTab();
  }, (error) => {
    console.warn("Firestore Warning (rental_complaints):", error);
  });
}

// Update counters in tabs
function updateCounts() {
  const pending = allItems.filter(item => (item.status || "pending") === "pending").length;
  const approved = allItems.filter(item => item.status === "approved").length;
  const rejected = allItems.filter(item => item.status === "rejected").length;
  
  // Tracking includes all approved outfits currently in the 5-step dispatch lifecycle + active customer rental bookings
  const trackingItems = allItems.filter(item => item.status === "approved" && (item.pickupStatus || "pending_pickup") !== "completed");
  const activeBookingsCount = activeBookings.filter(b => b.status && b.status !== "pending_payment" && b.status !== "cancelled").length;
  const tracking = trackingItems.length + activeBookingsCount;

  const complaints = allComplaints.filter(c => c.status !== "resolved").length;

  if (pendingCountEl) pendingCountEl.textContent = pending;
  if (approvedCountEl) approvedCountEl.textContent = approved;
  if (rejectedCountEl) rejectedCountEl.textContent = rejected;
  if (trackingCountEl) trackingCountEl.textContent = tracking;
  if (complaintsCountEl) complaintsCountEl.textContent = complaints;
}

// Render items based on active tab
function renderCurrentTab() {
  if (currentTab === "tracking") {
    renderTrackingTab();
    return;
  }
  if (currentTab === "complaints") {
    renderComplaintsTab();
    return;
  }

  const filtered = allItems.filter(item => {
    const status = item.status || "pending";
    return status === currentTab;
  });

  if (filtered.length === 0) {
    itemsListEl.innerHTML = `
      <div class="empty-admin-state">
        <ion-icon name="folder-open-outline"></ion-icon>
        <h3>No ${currentTab} rental items found</h3>
        <p>Items submitted by owners will appear here for review.</p>
      </div>
    `;
    return;
  }

  itemsListEl.innerHTML = filtered.map(item => createItemCard(item)).join("");

  // Attach event listeners to Approve/Reject/Delete buttons
  document.querySelectorAll(".approve-btn").forEach(btn => {
    btn.addEventListener("click", () => handleApproveItem(btn.dataset.id));
  });

  document.querySelectorAll(".reject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = allItems.find(i => i.id === btn.dataset.id);
      if (item) openRejectModal(item);
    });
  });

  document.querySelectorAll(".delete-item-btn").forEach(btn => {
    btn.addEventListener("click", () => handleDeleteItem(btn.dataset.id));
  });
}

// Rejection Modal State
let itemPendingRejection = null;
const rejectModal = document.getElementById("rejectReasonModal");
const rejectPreset = document.getElementById("rejectReasonPreset");
const rejectCustom = document.getElementById("rejectCustomReason");
const cancelRejectBtn = document.getElementById("cancelRejectBtn");
const confirmRejectBtn = document.getElementById("confirmRejectBtn");

if (cancelRejectBtn) {
  cancelRejectBtn.addEventListener("click", () => {
    if (rejectModal) rejectModal.style.display = "none";
    itemPendingRejection = null;
  });
}

if (confirmRejectBtn) {
  confirmRejectBtn.addEventListener("click", async () => {
    if (!itemPendingRejection) return;
    
    const preset = rejectPreset.value;
    const customText = rejectCustom.value.trim();
    const reason = (preset === "custom" || customText) ? (customText || preset) : preset;

    confirmRejectBtn.disabled = true;
    confirmRejectBtn.textContent = "Processing...";

    try {
      const itemRef = doc(db, "rental_items", itemPendingRejection.id);
      await updateDoc(itemRef, {
        status: "rejected",
        verifiedByAdmin: false,
        rejectionReason: reason,
        reviewedAt: serverTimestamp()
      });

      // Send In-App & Email Notification to Owner (No WhatsApp needed)
      await sendNotification({
        recipientUid: itemPendingRejection.ownerId || "",
        recipientEmail: itemPendingRejection.ownerEmail || "",
        recipientPhone: itemPendingRejection.ownerPhone || "",
        recipientName: itemPendingRejection.ownerName || "Valued Owner",
        title: `Listing Rejected: "${itemPendingRejection.title || 'Outfit'}"`,
        message: `Your listing for "${itemPendingRejection.title || 'Outfit'}" was rejected by admin. Reason: "${reason}". Please update photos/details and resubmit.`,
        type: "item_rejection",
        relatedId: itemPendingRejection.id,
        emailSubject: `Listing Review Notice: ${itemPendingRejection.title || 'Outfit'}`
      });

      alert("✅ Item rejected and owner notified directly inside their app notification center!");
      if (rejectModal) rejectModal.style.display = "none";
      itemPendingRejection = null;
      rejectCustom.value = "";
    } catch (err) {
      console.error("Rejection error:", err);
      alert("Error rejecting item: " + err.message);
    } finally {
      confirmRejectBtn.disabled = false;
      confirmRejectBtn.innerHTML = `<ion-icon name="send"></ion-icon> Reject & Send In-App Notice`;
    }
  });
}

function openRejectModal(item) {
  itemPendingRejection = item;
  if (rejectCustom) rejectCustom.value = "";
  if (rejectModal) rejectModal.style.display = "flex";
}

// Generate card HTML for Item Review
function createItemCard(item) {
  const mainImg = (item.images && item.images.length > 0) ? item.images[0] : "../images/placeholder.jpg";
  const extraImagesCount = item.images ? item.images.length - 1 : 0;
  const status = item.status || "pending";

  let statusBadge = "";
  if (status === "pending") statusBadge = `<span class="status-badge badge-pending">⏳ Pending Review</span>`;
  else if (status === "approved") statusBadge = `<span class="status-badge badge-approved">✅ Live / Approved</span>`;
  else if (status === "rejected") statusBadge = `<span class="status-badge badge-rejected">❌ Rejected</span>`;

  return `
    <div class="admin-item-card" id="card-${item.id}">
      <div class="admin-card-img">
        <img src="${mainImg}" alt="${item.title || 'Item Image'}" onerror="this.src='https://via.placeholder.com/300x200?text=No+Image'">
        ${extraImagesCount > 0 ? `<span class="extra-images-tag">+${extraImagesCount} photos</span>` : ''}
      </div>

      <div class="admin-card-body">
        <div class="admin-card-header">
          <h3>${item.title || 'Untitled Item'}</h3>
          ${statusBadge}
        </div>

        <div class="admin-item-details">
          <p><strong>Category:</strong> <span class="cap">${item.category || 'N/A'}</span></p>
          <p><strong>Size:</strong> ${item.size || 'N/A'}</p>
          <p><strong>Condition:</strong> ${item.condition || 'Good'}</p>
          <p><strong>Rent / Day:</strong> ₹${item.pricePerDay || 0}</p>
          <p><strong>Deposit:</strong> ₹${item.securityDeposit || 0}</p>
          <p><strong>Pickup City:</strong> ${item.city || 'India'}</p>
          ${item.ownerStreetAddress ? `<p><strong>Pickup Address:</strong> ${item.ownerStreetAddress}</p>` : ''}
          <p><strong>Owner:</strong> ${item.ownerName || 'Valued User'} (${item.ownerPhone || item.ownerEmail || 'N/A'})</p>
          ${item.rejectionReason ? `<p style="margin-top: 6px; padding: 6px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 12.5px; color: #b91c1c;"><strong>Rejection Reason:</strong> ${item.rejectionReason}</p>` : ''}
        </div>

        <div class="admin-card-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${status !== 'approved' ? `
            <button class="action-btn approve-btn" data-id="${item.id}" style="background: #15803d; color: #fff;">
              <ion-icon name="checkmark-sharp"></ion-icon> Approve & Publish
            </button>
          ` : ''}

          ${status !== 'rejected' ? `
            <button class="action-btn reject-btn" data-id="${item.id}" style="background: #eab308; color: #0f172a; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 4px;">
              <ion-icon name="close-circle-outline"></ion-icon> Reject / Decline
            </button>
          ` : ''}

          <button class="action-btn delete-item-btn" data-id="${item.id}" style="background: #dc2626; color: #fff; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: 600;">
            <ion-icon name="trash-outline"></ion-icon> Delete
          </button>
        </div>
      </div>
    </div>
  `;
}

// Handle Approve action with Notification & Queue for Delivery Boy Pickup
async function handleApproveItem(itemId) {
  try {
    const item = allItems.find(i => i.id === itemId);
    const itemRef = doc(db, "rental_items", itemId);
    await updateDoc(itemRef, {
      status: "approved",
      verifiedByAdmin: true,
      pickupStatus: "pending_pickup",
      reviewedAt: serverTimestamp()
    });

    // Create entry in pickup_delivery_logs
    const logId = generateLogDocId(itemId, "pending_pickup", 1);
    await setDoc(doc(db, "pickup_delivery_logs", logId), {
      bookingId: itemId,
      bookingShortId: itemId.substring(0, 8),
      stage: "approved_pending_pickup",
      stageNumber: 1,
      stageTitle: "Stage 1: Approved - Queued for Owner Pickup",
      summary: `Outfit "${item ? item.title : 'Outfit'}" approved by admin and assigned for delivery executive pickup`,
      itemTitle: item ? item.title : "Outfit",
      customerName: "Inventory Collection",
      customerPhone: "",
      ownerName: item ? (item.ownerName || "Owner") : "Owner",
      ownerPhone: item ? (item.ownerPhone || "") : "",
      loggedBy: "admin",
      readableDate: getReadableDateString(),
      timestamp: serverTimestamp()
    });

    // Notify Owner
    if (item) {
      sendNotification({
        recipientUid: item.ownerId || "",
        recipientEmail: item.ownerEmail || "",
        recipientPhone: item.ownerPhone || "",
        recipientName: item.ownerName || "Valued Owner",
        title: `Listing Approved! 🎉`,
        message: `Great news! Your outfit "${item.title}" has been verified and approved. Our delivery executive will pick it up from your address soon!`,
        type: "item_approval",
        relatedId: item.id,
        emailSubject: `Listing Approved: ${item.title}`
      });
    }

    alert(`✅ Outfit "${item ? item.title : 'Item'}" approved! It is now live on marketplace and queued in 'Pickup & Delivery Tracking' for the delivery boy.`);
    console.log(`Item ${itemId} approved and queued for delivery boy`);
  } catch (error) {
    console.error(`Error approving item ${itemId}:`, error);
    alert("Error approving item: " + error.message);
  }
}

// Handle Delete action
async function handleDeleteItem(itemId) {
  if (!confirm("Are you sure you want to permanently delete this outfit from the marketplace and database?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "rental_items", itemId));
    alert("✅ Item successfully deleted!");
  } catch (error) {
    console.error("Delete error:", error);
    alert("❌ Error deleting item: " + error.message);
  }
}

// Helper: Determine dispatch step (1 to 5) for approved rental outfits
function getItemDispatchStep(item) {
  const s = (item.pickupStatus || "pending_pickup").toLowerCase();
  if (s === "pending_pickup") return 1; // 1. To Pick Up from Owner
  if (s === "picked_up" || s === "delivered_hub" || s === "at_hub" || s === "washing_hub" || s === "cleaning_in_progress") return 2; // 2. Washing Hub
  if (s === "ready_for_delivery" || s === "ready_delivery" || s === "out_for_delivery") return 3; // 3. Deliver to Customer
  if (s === "delivered_to_customer" || s === "delivered_customer" || s === "in_use" || s === "return_due") return 4; // 4. Return Pickup
  if (s === "return_picked_up" || s === "in_transit_owner" || s === "return_owner" || s === "returned_to_owner" || s === "completed") return 5; // 5. Return to Owner
  return 1;
}

// Helper: Determine dispatch step (1 to 5) for rental bookings
function getBookingDispatchStep(b) {
  const s = (b.status || "confirmed").toLowerCase();
  if (s === "confirmed" || s === "pending_pickup") return 1; // 1. To Pick Up from Owner
  if (s === "picked_up_from_owner" || s === "cleaning_in_progress" || s === "hub_cleaning") return 2; // 2. Washing Hub
  if (s === "out_for_delivery" || s === "ready_delivery" || s === "ready_for_delivery") return 3; // 3. Deliver to Customer
  if (s === "delivered_to_renter" || s === "delivered_to_customer" || s === "return_due" || s === "in_use") return 4; // 4. Return Pickup
  if (s === "picked_up_from_renter" || s === "return_to_hub" || s === "returned_to_owner" || s === "completed" || s === "settled") return 5; // 5. Return to Owner
  return 1;
}

// Helper: Calculate or format Return Date string
function getFormattedReturnDate(itemOrBooking) {
  if (itemOrBooking.endDate) {
    return itemOrBooking.endDate;
  }
  if (itemOrBooking.returnScheduledDate) {
    return itemOrBooking.returnScheduledDate;
  }
  if (itemOrBooking.returnDate) {
    return itemOrBooking.returnDate;
  }
  const base = (itemOrBooking.deliveredAt && itemOrBooking.deliveredAt.seconds) 
    ? new Date(itemOrBooking.deliveredAt.seconds * 1000) 
    : new Date();
  base.setDate(base.getDate() + 3);
  return base.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Create Tracking Card for Approved Items across all 5 Dispatch Steps
function createApprovedItemPickupCard(item) {
  const cleanPhone = (item.ownerPhone || "").replace(/[^0-9]/g, "");
  const fullAddress = `${item.ownerStreetAddress || 'Address on file'}${item.ownerStreetAddress ? ', ' : ''}${item.city || 'India'}`;
  const mapUrl = (item.ownerLat && item.ownerLng)
    ? `https://www.google.com/maps/search/?api=1&query=${item.ownerLat},${item.ownerLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

  const currentStep = getItemDispatchStep(item);
  const returnDateFormatted = getFormattedReturnDate(item);

  // Status Badge configurations based on current step
  let statusLabel = "1. Pending Owner Pickup";
  let badgeColor = "#d97706";
  let badgeBg = "#fef3c7";
  let badgeIcon = "cube-outline";

  if (currentStep === 2) {
    statusLabel = "2. Washing Hub (Sanitizing & Pressing)";
    badgeColor = "#0284c7";
    badgeBg = "#e0f2fe";
    badgeIcon = "sparkles-outline";
  } else if (currentStep === 3) {
    statusLabel = "3. Out for Customer Delivery";
    badgeColor = "#16a34a";
    badgeBg = "#dcfce7";
    badgeIcon = "bicycle-outline";
  } else if (currentStep === 4) {
    statusLabel = "4. In Use / Return Due from Customer";
    badgeColor = "#7c3aed";
    badgeBg = "#f3e8ff";
    badgeIcon = "return-down-back-outline";
  } else if (currentStep === 5) {
    statusLabel = (item.pickupStatus === "returned_to_owner" || item.pickupStatus === "completed") 
      ? "5. Returned to Owner (Completed)" 
      : "5. In Transit - Returning to Owner";
    badgeColor = "#ea580c";
    badgeBg = "#ffedd5";
    badgeIcon = "home-outline";
  }

  const waMsg = encodeURIComponent(`Hello ${item.ownerName || 'Partner'}! Update regarding your approved outfit "${item.title}": Status is [${statusLabel}]. Address: ${fullAddress}.`);

  return `
    <div class="tracking-card" style="border-top: 4px solid ${badgeColor}; box-shadow: 0 4px 14px rgba(0,0,0,0.06); margin-bottom: 20px; border-radius: 12px; background: #fff;">
      <div class="tracking-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
        <div style="display: flex; gap: 14px; align-items: center;">
          ${(item.images && item.images.length > 0) ? `<img src="${item.images[0]}" style="width: 62px; height: 62px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">` : ''}
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h3 style="margin: 0; font-size: 18px; color: #0f172a;">${item.title}</h3>
              <span style="background: #e0f2fe; color: #0369a1; padding: 3px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 700;">Approved Listing</span>
            </div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">
              <span>Category: <strong>${item.category || 'Outfit'}</strong></span> | 
              <span>Size: <strong>${item.size || 'Free Size'}</strong></span> | 
              <span>Rent: <strong>₹${item.pricePerDay}/day</strong></span> | 
              <span>Deposit: <strong>₹${item.securityDeposit || 0}</strong></span>
            </div>
          </div>
        </div>
        <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 6px 14px; border-radius: 20px; font-size: 12.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
          <ion-icon name="${badgeIcon}"></ion-icon> ${statusLabel}
        </span>
      </div>

      <!-- 5-Step Visual Progress Timeline in Sequence -->
      <div class="stage-timeline" style="display: flex; align-items: center; justify-content: space-between; margin: 16px 0; padding: 12px 14px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; overflow-x: auto; gap: 8px;">
        <div class="timeline-step ${currentStep >= 1 ? 'completed' : ''} ${currentStep === 1 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 1 ? '#22c55e' : (currentStep === 1 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 1 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 1 ? '✓' : '1'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 1 ? '#0284c7' : (currentStep > 1 ? '#15803d' : '#94a3b8')};">1. Owner Pickup</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 1 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 2 ? 'completed' : ''} ${currentStep === 2 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 2 ? '#22c55e' : (currentStep === 2 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 2 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 2 ? '✓' : '2'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 2 ? '#0284c7' : (currentStep > 2 ? '#15803d' : '#94a3b8')};">2. Washing Hub</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 2 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 3 ? 'completed' : ''} ${currentStep === 3 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 3 ? '#22c55e' : (currentStep === 3 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 3 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 3 ? '✓' : '3'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 3 ? '#0284c7' : (currentStep > 3 ? '#15803d' : '#94a3b8')};">3. Deliver Customer</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 3 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 4 ? 'completed' : ''} ${currentStep === 4 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 4 ? '#22c55e' : (currentStep === 4 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 4 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 4 ? '✓' : '4'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 4 ? '#0284c7' : (currentStep > 4 ? '#15803d' : '#94a3b8')};">4. Return Pickup</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 4 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 5 ? 'completed' : ''} ${currentStep === 5 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${(item.pickupStatus === 'returned_to_owner' || item.pickupStatus === 'completed') ? '#22c55e' : (currentStep === 5 ? '#ea580c' : '#e2e8f0')}; color: ${currentStep >= 5 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${(item.pickupStatus === 'returned_to_owner' || item.pickupStatus === 'completed') ? '✓' : '5'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 5 ? '#ea580c' : '#94a3b8'};">5. Return Owner</span>
        </div>
      </div>

      <!-- Prominent Scheduled Return Date Box (Shown for Step 3, 4, 5 in Sequence) -->
      ${(currentStep >= 3) ? `
        <div style="background: linear-gradient(135deg, #eff6ff, #f0fdf4); border: 1.5px solid #3b82f6; border-radius: 10px; padding: 12px 16px; margin: 14px 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="background: #2563eb; color: #fff; width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 22px;">
              <ion-icon name="calendar-outline"></ion-icon>
            </div>
            <div>
              <div style="font-size: 11.5px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.5px;">
                📅 Scheduled Return Pickup Date / वापसी पिकअप की तारीख
              </div>
              <div style="font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 2px;">
                ${returnDateFormatted}
              </div>
            </div>
          </div>
          <span style="background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px;">
            <ion-icon name="time-outline"></ion-icon> Return in Sequence
          </span>
        </div>
      ` : ''}

      <!-- Owner Contact & Logistics Details for Delivery Boy -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 16px 0; background: #f8fafc; padding: 14px; border-radius: 10px; border: 1px solid #e2e8f0;">
        <div>
          <div style="font-size: 11.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <ion-icon name="person-outline"></ion-icon> Owner / Clothes Provider
          </div>
          <div style="font-weight: 700; color: #1e293b; font-size: 15px;">${item.ownerName || 'Owner'}</div>
          <div style="font-size: 13.5px; color: #475569; margin-top: 2px;">
            <ion-icon name="call-outline"></ion-icon> ${item.ownerPhone || 'No phone'}
          </div>
        </div>

        <div>
          <div style="font-size: 11.5px; font-weight: 700; color: #0284c7; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <ion-icon name="location-outline"></ion-icon> ${currentStep >= 5 ? 'Owner Return Destination' : (currentStep >= 3 ? 'Customer Delivery Target' : 'Pickup Address (Owner)')}
          </div>
          <div style="font-size: 13.5px; color: #1e293b; line-height: 1.4; font-weight: 500;">
            ${fullAddress}
          </div>
          <a href="${mapUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: #0284c7; font-weight: 700; margin-top: 6px; text-decoration: none;">
            <ion-icon name="navigate-circle-outline"></ion-icon> Open Navigation in Google Maps
          </a>
        </div>
      </div>

      <!-- Quick Delivery Boy Actions (Call, WhatsApp, Maps) -->
      <div style="display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;">
        ${cleanPhone ? `
          <a href="tel:${cleanPhone}" style="flex: 1; min-width: 140px; text-decoration: none; padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: #0284c7; color: #fff;">
            <ion-icon name="call"></ion-icon> Call Owner
          </a>
          <a href="https://wa.me/91${cleanPhone}?text=${waMsg}" target="_blank" style="flex: 1; min-width: 140px; text-decoration: none; padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: #25D366; color: #fff;">
            <ion-icon name="logo-whatsapp"></ion-icon> WhatsApp Owner
          </a>
        ` : ''}
        <a href="${mapUrl}" target="_blank" style="flex: 1; min-width: 140px; text-decoration: none; padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: #475569; color: #fff;">
          <ion-icon name="map-outline"></ion-icon> GPS Location
        </a>
      </div>

      <!-- Action Buttons to Advance through all 5 Steps -->
      <div style="border-top: 1px solid #f1f5f9; padding-top: 12px; display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 10px;">
        ${currentStep === 1 ? `
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="picked_up" data-nexttab="hub_cleaning" style="background: #16a34a; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13.5px;">
            <ion-icon name="checkmark-done-circle-outline"></ion-icon> ✅ Mark Picked Up from Owner
          </button>
        ` : currentStep === 2 ? `
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="ready_for_delivery" data-nexttab="deliver_customer" style="background: #0284c7; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13.5px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);">
            <ion-icon name="sparkles-outline"></ion-icon> 🫧 Mark Cleaning Completed & Move to Customer Delivery
          </button>
        ` : currentStep === 3 ? `
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="delivered_to_customer" data-nexttab="return_customer" style="background: #15803d; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13.5px; box-shadow: 0 4px 12px rgba(21, 128, 61, 0.25);">
            <ion-icon name="bicycle-outline"></ion-icon> 🚚 Mark Delivered to Customer Doorstep
          </button>
        ` : currentStep === 4 ? `
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="return_picked_up" data-nexttab="return_owner" style="background: #7c3aed; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13.5px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25);">
            <ion-icon name="return-down-back-outline"></ion-icon> 🔄 Mark Return Picked Up from Customer
          </button>
        ` : (item.pickupStatus === "returned_to_owner" || item.pickupStatus === "completed") ? `
          <span style="color: #16a34a; font-weight: 700; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <ion-icon name="checkmark-done-circle" style="font-size: 20px;"></ion-icon> 🎉 Rental Cycle Fully Completed & Returned to Owner!
          </span>
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="pending_pickup" data-nexttab="pickup_owner" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;">
            🔄 Re-queue for Next Rental
          </button>
        ` : `
          <button class="advance-item-pickup-btn" data-id="${item.id}" data-action="returned_to_owner" data-nexttab="return_owner" style="background: #ea580c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13.5px; box-shadow: 0 4px 12px rgba(234, 88, 12, 0.25);">
            <ion-icon name="home-outline"></ion-icon> 🏠 Mark Returned to Owner (Complete Cycle)
          </button>
        `}
      </div>
    </div>
  `;
}

// Handle Advancing Pickup for Approved Items across all 5 Steps with Auto-Tab Switch
async function handleAdvanceItemPickup(itemId, nextAction, nextTab) {
  try {
    const item = allItems.find(x => x.id === itemId);
    if (!item) return;

    const itemRef = doc(db, "rental_items", itemId);
    const updatePayload = {
      pickupStatus: nextAction,
      pickupLastUpdated: serverTimestamp()
    };

    // Calculate & set Return Date when delivered to customer
    if (nextAction === "delivered_to_customer") {
      updatePayload.deliveredAt = serverTimestamp();
      const d = new Date();
      d.setDate(d.getDate() + 3);
      updatePayload.returnScheduledDate = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } else if (nextAction === "returned_to_owner") {
      updatePayload.completedAt = serverTimestamp();
    }

    await updateDoc(itemRef, updatePayload);

    // Automatically switch active dispatch tab so item NEVER disappears from user view
    if (nextTab) {
      activeDispatchFilter = nextTab;
    }

    // Friendly milestone titles and logs
    let stepNumber = 1;
    let stageName = nextAction;
    let stageTitle = "Stage 1: Picked Up from Owner";
    let summaryText = `Outfit "${item.title}" stage updated to ${nextAction}`;

    if (nextAction === "picked_up") {
      stepNumber = 2;
      stageName = "picked_up_from_owner";
      stageTitle = "Stage 1: Picked Up from Owner";
      summaryText = `Outfit "${item.title}" collected from owner and in transit to washing hub`;
    } else if (nextAction === "ready_for_delivery") {
      stepNumber = 3;
      stageName = "cleaning_completed";
      stageTitle = "Stage 2: Cleaning Completed at Hub";
      summaryText = `Outfit "${item.title}" cleaned, pressed and ready for customer doorstep delivery`;
    } else if (nextAction === "delivered_to_customer") {
      stepNumber = 4;
      stageName = "delivered_to_customer";
      stageTitle = "Stage 3: Delivered to Customer";
      summaryText = `Outfit "${item.title}" delivered to customer doorstep. Return scheduled in sequence.`;
    } else if (nextAction === "return_picked_up") {
      stepNumber = 5;
      stageName = "return_picked_up";
      stageTitle = "Stage 4: Return Picked Up from Customer";
      summaryText = `Outfit "${item.title}" collected back from customer after rental period`;
    } else if (nextAction === "returned_to_owner") {
      stepNumber = 5;
      stageName = "returned_to_owner";
      stageTitle = "Stage 5: Returned to Owner";
      summaryText = `Outfit "${item.title}" successfully returned to owner. Full rental cycle completed.`;
    }

    const logId = generateLogDocId(itemId, stageName, stepNumber);
    await setDoc(doc(db, "pickup_delivery_logs", logId), {
      bookingId: itemId,
      bookingShortId: itemId.substring(0, 8),
      stage: stageName,
      stageNumber: stepNumber,
      stageTitle: stageTitle,
      summary: summaryText,
      itemTitle: item.title || "Outfit",
      customerName: "Marketplace Inventory",
      customerPhone: "",
      ownerName: item.ownerName || "Owner",
      ownerPhone: item.ownerPhone || "",
      loggedBy: "admin",
      readableDate: getReadableDateString(),
      timestamp: serverTimestamp()
    });

    // Notify Owner
    if (item.ownerPhone || item.ownerEmail || item.ownerId) {
      sendNotification({
        recipientUid: item.ownerId || "",
        recipientEmail: item.ownerEmail || "",
        recipientPhone: item.ownerPhone || "",
        recipientName: item.ownerName || "Valued Owner",
        title: `Dispatch Update: ${item.title}`,
        message: summaryText,
        type: "order_update",
        relatedId: itemId,
        emailSubject: `Outfit Update: ${item.title}`
      });
    }

    // Refresh UI immediately
    renderTrackingTab();
    updateCounts();
  } catch (e) {
    console.error("Item pickup error:", e);
    alert("Error updating pickup status: " + e.message);
  }
}

// Render Pickup & Delivery Tracking Tab with 5 Distinct Dispatch Queues
function renderTrackingTab() {
  // 1. Approved items to collect from owner / dispatch
  const approvedItems = allItems.filter(item => item.status === "approved");
  
  // 2. Active customer rental bookings
  const activeList = activeBookings.filter(b => b.status && b.status !== "pending_payment" && b.status !== "cancelled");

  const totalTrackingCount = approvedItems.length + activeList.length;

  if (totalTrackingCount === 0) {
    itemsListEl.innerHTML = `
      <div class="empty-admin-state">
        <ion-icon name="car-sport-outline"></ion-icon>
        <h3>No active pickup or delivery tasks</h3>
        <p>Approved outfits and confirmed rental bookings will appear here for delivery executives.</p>
      </div>
    `;
    return;
  }

  // Calculate Dispatch Stage Counts accurately across all 5 steps
  const countPickupOwner = approvedItems.filter(i => getItemDispatchStep(i) === 1).length + activeList.filter(b => getBookingDispatchStep(b) === 1).length;
  const countHub = approvedItems.filter(i => getItemDispatchStep(i) === 2).length + activeList.filter(b => getBookingDispatchStep(b) === 2).length;
  const countDeliverCustomer = approvedItems.filter(i => getItemDispatchStep(i) === 3).length + activeList.filter(b => getBookingDispatchStep(b) === 3).length;
  const countReturnCustomer = approvedItems.filter(i => getItemDispatchStep(i) === 4).length + activeList.filter(b => getBookingDispatchStep(b) === 4).length;
  const countReturnOwner = approvedItems.filter(i => getItemDispatchStep(i) === 5).length + activeList.filter(b => getBookingDispatchStep(b) === 5).length;

  // Filter lists based on activeDispatchFilter
  let displayApprovedItems = [];
  let displayBookings = [];

  if (activeDispatchFilter === "all") {
    displayApprovedItems = approvedItems;
    displayBookings = activeList;
  } else if (activeDispatchFilter === "pickup_owner") {
    displayApprovedItems = approvedItems.filter(i => getItemDispatchStep(i) === 1);
    displayBookings = activeList.filter(b => getBookingDispatchStep(b) === 1);
  } else if (activeDispatchFilter === "hub_cleaning") {
    displayApprovedItems = approvedItems.filter(i => getItemDispatchStep(i) === 2);
    displayBookings = activeList.filter(b => getBookingDispatchStep(b) === 2);
  } else if (activeDispatchFilter === "deliver_customer") {
    displayApprovedItems = approvedItems.filter(i => getItemDispatchStep(i) === 3);
    displayBookings = activeList.filter(b => getBookingDispatchStep(b) === 3);
  } else if (activeDispatchFilter === "return_customer") {
    displayApprovedItems = approvedItems.filter(i => getItemDispatchStep(i) === 4);
    displayBookings = activeList.filter(b => getBookingDispatchStep(b) === 4);
  } else if (activeDispatchFilter === "return_owner") {
    displayApprovedItems = approvedItems.filter(i => getItemDispatchStep(i) === 5);
    displayBookings = activeList.filter(b => getBookingDispatchStep(b) === 5);
  }

  const filterBarHtml = `
    <div style="grid-column: 1 / -1; display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; background: #ffffff; padding: 12px 14px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
      <button class="dispatch-filter-btn" data-filter="all" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'all' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'all' ? '#fff' : '#475569'};">All Tasks (${totalTrackingCount})</button>
      <button class="dispatch-filter-btn" data-filter="pickup_owner" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'pickup_owner' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'pickup_owner' ? '#fff' : '#475569'};">📦 1. To Pick Up from Owner (${countPickupOwner})</button>
      <button class="dispatch-filter-btn" data-filter="hub_cleaning" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'hub_cleaning' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'hub_cleaning' ? '#fff' : '#475569'};">🫧 2. Washing Hub (${countHub})</button>
      <button class="dispatch-filter-btn" data-filter="deliver_customer" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'deliver_customer' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'deliver_customer' ? '#fff' : '#475569'};">🚚 3. Deliver to Customer (${countDeliverCustomer})</button>
      <button class="dispatch-filter-btn" data-filter="return_customer" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'return_customer' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'return_customer' ? '#fff' : '#475569'};">🔄 4. Return Pickup (${countReturnCustomer})</button>
      <button class="dispatch-filter-btn" data-filter="return_owner" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'return_owner' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'return_owner' ? '#fff' : '#475569'};">🏠 5. Return to Owner (${countReturnOwner})</button>
    </div>
  `;

  const totalFilteredCount = displayApprovedItems.length + displayBookings.length;

  if (totalFilteredCount === 0) {
    itemsListEl.innerHTML = filterBarHtml + `
      <div class="empty-admin-state" style="grid-column: 1 / -1;">
        <ion-icon name="checkmark-done-circle-outline"></ion-icon>
        <h3>No tasks in this dispatch queue</h3>
        <p>All items in this stage have been processed or moved to another step.</p>
        <button type="button" onclick="document.querySelector('.dispatch-filter-btn[data-filter=\\'all\\']').click()" style="margin-top: 10px; background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer;">Show All Tasks</button>
      </div>
    `;
  } else {
    const approvedCardsHtml = displayApprovedItems.map(item => createApprovedItemPickupCard(item)).join("");
    const bookingCardsHtml = displayBookings.map(b => createTrackingCard(b)).join("");
    itemsListEl.innerHTML = filterBarHtml + approvedCardsHtml + bookingCardsHtml;
  }

  // Attach dispatch filter listeners
  document.querySelectorAll(".dispatch-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeDispatchFilter = btn.dataset.filter || "all";
      renderTrackingTab();
    });
  });

  // Attach approved item pickup advance listeners
  document.querySelectorAll(".advance-item-pickup-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAdvanceItemPickup(btn.dataset.id, btn.dataset.action, btn.dataset.nexttab));
  });

  // Attach stage advance event listeners for customer bookings
  document.querySelectorAll(".advance-stage-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAdvanceTrackingStage(btn.dataset.id, btn.dataset.nextstage, btn.dataset.title, btn.dataset.nexttab));
  });

  // Attach direct stage selector dropdown listeners
  document.querySelectorAll(".direct-stage-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const bookingId = sel.dataset.id;
      const targetStage = sel.value;
      const title = decodeURIComponent(sel.dataset.title || 'Outfit');
      handleAdvanceTrackingStage(bookingId, targetStage, title);
    });
  });

  // Attach deposit settlement event listeners
  document.querySelectorAll(".settle-deposit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const booking = activeBookings.find(b => b.id === btn.dataset.id);
      if (booking) openRefundModal(booking);
    });
  });

  // Attach owner payout event listeners
  document.querySelectorAll(".mark-owner-paid-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.id;
      const ownerUid = btn.dataset.ownerUid || "";
      const amount = btn.dataset.amount;
      const title = decodeURIComponent(btn.dataset.title || 'Outfit');
      const email = btn.dataset.ownerEmail;
      const phone = btn.dataset.ownerPhone;
      const name = decodeURIComponent(btn.dataset.ownerName || 'Owner');

      if (!confirm(`Confirm that ₹${amount} rent earnings have been disbursed to owner ${name}?`)) return;

      try {
        await updateDoc(doc(db, "rental_bookings", bookingId), {
          ownerPayoutStatus: "paid",
          ownerPaidAt: serverTimestamp()
        });

        // Notify Owner
        sendNotification({
          recipientUid: ownerUid,
          recipientEmail: email,
          recipientPhone: phone,
          recipientName: name,
          title: "Rental Earnings Disbursed! 💰",
          message: `Your rental payout of ₹${amount} for outfit "${title}" has been successfully transferred to your account.`,
          type: "payment",
          relatedId: bookingId,
          emailSubject: `Earnings Disbursed: ₹${amount} for ${title}`
        });

        alert(`✅ Payout of ₹${amount} marked as paid to owner ${name}. Owner has been notified!`);
      } catch (e) {
        console.error("Payout error:", e);
        alert("Error saving payout: " + e.message);
      }
    });
  });
}

// Deposit Refund & Inspection Modal Logic
let bookingPendingSettlement = null;
const refundModal = document.getElementById("refundModal");
const refundCustomerName = document.getElementById("refundCustomerName");
const refundCustomerPhone = document.getElementById("refundCustomerPhone");
const refundDepositAmount = document.getElementById("refundDepositAmount");
const refundPaymentId = document.getElementById("refundPaymentId");
const upiRefundLink = document.getElementById("upiRefundLink");
const razorpayDashboardLink = document.getElementById("razorpayDashboardLink");
const settleRefundRadio = document.getElementById("settleRefundRadio");
const settleForfeitRadio = document.getElementById("settleForfeitRadio");
const damageReasonBox = document.getElementById("damageReasonBox");
const damageReasonInput = document.getElementById("damageReasonInput");
const cancelRefundBtn = document.getElementById("cancelRefundBtn");
const confirmSettlementBtn = document.getElementById("confirmSettlementBtn");

if (settleRefundRadio && settleForfeitRadio) {
  settleRefundRadio.addEventListener("change", () => {
    if (damageReasonBox) damageReasonBox.style.display = "none";
  });
  settleForfeitRadio.addEventListener("change", () => {
    if (damageReasonBox) damageReasonBox.style.display = "block";
  });
}

if (cancelRefundBtn) {
  cancelRefundBtn.addEventListener("click", () => {
    if (refundModal) refundModal.style.display = "none";
    bookingPendingSettlement = null;
  });
}

function openRefundModal(b) {
  bookingPendingSettlement = b;
  const cleanPhone = (b.renterPhone || "").replace(/[^0-9]/g, "");
  
  if (refundCustomerName) refundCustomerName.textContent = b.renterName || "Valued Customer";
  if (refundCustomerPhone) refundCustomerPhone.textContent = b.renterPhone || "N/A";
  if (refundDepositAmount) refundDepositAmount.textContent = `₹${b.securityDeposit || 0}`;
  if (refundPaymentId) refundPaymentId.textContent = b.paymentId || "Direct";

  // UPI Link to customer mobile
  if (upiRefundLink) {
    upiRefundLink.href = `upi://pay?pa=${cleanPhone}@upi&pn=${encodeURIComponent(b.renterName || 'Customer')}&am=${b.securityDeposit || 0}&tn=Security%20Deposit%20Refund%20Order%20${b.id.substring(0, 6).toUpperCase()}`;
  }

  // Razorpay Dashboard Direct Search Link
  if (razorpayDashboardLink) {
    razorpayDashboardLink.href = b.paymentId && b.paymentId !== "Pending" 
      ? `https://dashboard.razorpay.com/app/payments/${b.paymentId}`
      : `https://dashboard.razorpay.com/app/payments`;
  }

  if (settleRefundRadio) settleRefundRadio.checked = true;
  if (damageReasonBox) damageReasonBox.style.display = "none";
  if (damageReasonInput) damageReasonInput.value = "";

  if (refundModal) refundModal.style.display = "flex";
}

if (confirmSettlementBtn) {
  confirmSettlementBtn.addEventListener("click", async () => {
    if (!bookingPendingSettlement) return;
    const b = bookingPendingSettlement;
    const isRefund = settleRefundRadio && settleRefundRadio.checked;
    const damageReason = damageReasonInput ? damageReasonInput.value.trim() : "";

    if (!isRefund && !damageReason) {
      alert("⚠️ Please enter the damage reason for deducting the security deposit.");
      return;
    }

    confirmSettlementBtn.disabled = true;
    confirmSettlementBtn.textContent = "Processing...";

    try {
      const bookingRef = doc(db, "rental_bookings", b.id);

      if (isRefund) {
        // Approve Refund
        await updateDoc(bookingRef, {
          depositStatus: "refunded",
          refundAmount: b.securityDeposit || 0,
          status: "returned_to_owner",
          settledAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });

        // Notify Customer in-app and email
        await sendNotification({
          recipientUid: b.renterId || "",
          recipientEmail: b.renterEmail || "",
          recipientPhone: b.renterPhone || "",
          recipientName: b.renterName || "Customer",
          title: "✅ Security Deposit Refund Processed!",
          message: `Your refundable security deposit of ₹${b.securityDeposit || 0} for rental order #${b.id.substring(0, 8).toUpperCase()} has been processed and refunded to your original payment source.`,
          type: "refund",
          relatedId: b.id,
          emailSubject: "Security Deposit Refund Processed"
        });

        alert(`✅ Deposit of ₹${b.securityDeposit} marked as refunded and customer notified!`);
      } else {
        // Deduct / Forfeit Deposit
        await updateDoc(bookingRef, {
          depositStatus: "forfeited",
          deductionReason: damageReason,
          status: "returned_to_owner",
          settledAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });

        // Notify Customer of deduction with explanation
        await sendNotification({
          recipientUid: b.renterId || "",
          recipientEmail: b.renterEmail || "",
          recipientPhone: b.renterPhone || "",
          recipientName: b.renterName || "Customer",
          title: "⚠️ Security Deposit Inspection Notice",
          message: `Your security deposit of ₹${b.securityDeposit || 0} for order #${b.id.substring(0, 8).toUpperCase()} was deducted due to condition inspection: "${damageReason}".`,
          type: "damage_deduction",
          relatedId: b.id,
          emailSubject: "Security Deposit Settlement Notice"
        });

        alert(`⚠️ Deposit deducted due to damage and customer notified directly!`);
      }

      // Notify Owner that cycle is complete
      if (b.ownerEmail || b.ownerPhone || b.ownerId) {
        sendNotification({
          recipientUid: b.ownerId || "",
          recipientEmail: b.ownerEmail || "",
          recipientPhone: b.ownerPhone || "",
          recipientName: b.ownerName || "Owner",
          title: "👗 Outfit Rental Cycle Completed",
          message: `Your outfit "${b.itemTitle || 'Outfit'}" has completed its rental period and is being delivered back to your address in fresh, cleaned condition.`,
          type: "order_update",
          relatedId: b.id,
          emailSubject: `Rental Cycle Completed: ${b.itemTitle || 'Outfit'}`
        });
      }

      if (refundModal) refundModal.style.display = "none";
      bookingPendingSettlement = null;
    } catch (err) {
      console.error("Settlement error:", err);
      alert("Error processing settlement: " + err.message);
    } finally {
      confirmSettlementBtn.disabled = false;
      confirmSettlementBtn.innerHTML = `<ion-icon name="checkmark-done"></ion-icon> Save & Complete Settlement`;
    }
  });
}

// Create Tracking Card HTML with Modern Delivery App UI & Contact Actions
// Create Tracking Card HTML with Modern Delivery App UI & Contact Actions
function createTrackingCard(b) {
  const currentStep = getBookingDispatchStep(b);
  const returnDateFormatted = getFormattedReturnDate(b);

  const stages = [
    { step: 1, key: "confirmed", nextKey: "cleaning_in_progress", nextTab: "hub_cleaning", label: "1. Owner Pickup", icon: "cube-outline" },
    { step: 2, key: "cleaning_in_progress", nextKey: "out_for_delivery", nextTab: "deliver_customer", label: "2. Washing Hub", icon: "sparkles-outline" },
    { step: 3, key: "out_for_delivery", nextKey: "delivered_to_renter", nextTab: "return_customer", label: "3. Deliver Customer", icon: "bicycle-outline" },
    { step: 4, key: "delivered_to_renter", nextKey: "picked_up_from_renter", nextTab: "return_owner", label: "4. Return Pickup", icon: "return-down-back-outline" },
    { step: 5, key: "returned_to_owner", nextKey: "returned_to_owner", nextTab: "return_owner", label: "5. Return Owner", icon: "home-outline" }
  ];

  const currentStageConfig = stages[currentStep - 1] || stages[0];
  const nextStageConfig = currentStep < stages.length ? stages[currentStep] : null;

  const renterCleanPhone = (b.renterPhone || "").replace(/[^0-9]/g, "");
  const ownerCleanPhone = (b.ownerPhone || "").replace(/[^0-9]/g, "");
  const customerFullAddress = `${b.deliveryAddress || 'Address on file'}, ${b.deliveryCity || ''} ${b.deliveryPincode ? '- ' + b.deliveryPincode : ''}`;
  const ownerFullAddress = `${b.ownerStreetAddress || ''}${b.ownerStreetAddress ? ', ' : ''}${b.ownerCity || 'India'}`;

  // Accurate GPS Coordinates Google Maps Navigation
  const customerMapUrl = (b.deliveryLat && b.deliveryLng)
    ? `https://www.google.com/maps/search/?api=1&query=${b.deliveryLat},${b.deliveryLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customerFullAddress)}`;

  const ownerMapUrl = (b.ownerLat && b.ownerLng)
    ? `https://www.google.com/maps/search/?api=1&query=${b.ownerLat},${b.ownerLng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ownerFullAddress)}`;

  const customerWaMsg = encodeURIComponent(`Hello ${b.renterName || 'Customer'}! Update regarding your rental order #${b.id.substring(0, 6)} for "${b.itemTitle || 'Outfit'}": Status is [${currentStageConfig.label}]. Address: ${customerFullAddress}.`);
  const ownerWaMsg = encodeURIComponent(`Hello ${b.ownerName || 'Owner'}! Update regarding rental booking #${b.id.substring(0, 6)} for your outfit "${b.itemTitle || 'Outfit'}": Status is [${currentStageConfig.label}].`);

  return `
    <div class="tracking-card" style="margin-bottom: 20px; border-radius: 12px; background: #fff; box-shadow: 0 4px 14px rgba(0,0,0,0.06);">
      <div class="tracking-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
        <div style="display: flex; gap: 14px; align-items: center;">
          ${b.itemImage ? `<img src="${b.itemImage}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">` : ''}
          <div>
            <h3 style="margin: 0; font-size: 18px; color: #0f172a;">${b.itemTitle || 'Rental Outfit'}</h3>
            <span class="booking-id-tag">Order ID: <code>#${b.id.substring(0, 8).toUpperCase()}</code> &bull; ${b.startDate} to ${b.endDate} (${b.rentalDays || 1} days)</span>
          </div>
        </div>
        <span class="status-badge badge-approved" style="font-size: 13px; padding: 6px 14px;">${currentStageConfig.label.toUpperCase()}</span>
      </div>

      <!-- 5-Step Visual Progress Timeline in Sequence -->
      <div class="stage-timeline" style="display: flex; align-items: center; justify-content: space-between; margin: 16px 0; padding: 12px 14px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; overflow-x: auto; gap: 8px;">
        <div class="timeline-step ${currentStep >= 1 ? 'completed' : ''} ${currentStep === 1 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 1 ? '#22c55e' : (currentStep === 1 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 1 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 1 ? '✓' : '1'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 1 ? '#0284c7' : (currentStep > 1 ? '#15803d' : '#94a3b8')};">1. Owner Pickup</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 1 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 2 ? 'completed' : ''} ${currentStep === 2 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 2 ? '#22c55e' : (currentStep === 2 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 2 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 2 ? '✓' : '2'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 2 ? '#0284c7' : (currentStep > 2 ? '#15803d' : '#94a3b8')};">2. Washing Hub</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 2 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 3 ? 'completed' : ''} ${currentStep === 3 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 3 ? '#22c55e' : (currentStep === 3 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 3 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 3 ? '✓' : '3'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 3 ? '#0284c7' : (currentStep > 3 ? '#15803d' : '#94a3b8')};">3. Deliver Customer</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 3 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 4 ? 'completed' : ''} ${currentStep === 4 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep > 4 ? '#22c55e' : (currentStep === 4 ? '#0284c7' : '#e2e8f0')}; color: ${currentStep >= 4 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep > 4 ? '✓' : '4'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 4 ? '#0284c7' : (currentStep > 4 ? '#15803d' : '#94a3b8')};">4. Return Pickup</span>
        </div>

        <div style="height: 2px; flex: 0.5; background: ${currentStep > 4 ? '#22c55e' : '#cbd5e1'}; min-width: 15px;"></div>

        <div class="timeline-step ${currentStep >= 5 ? 'completed' : ''} ${currentStep === 5 ? 'active' : ''}" style="display: flex; flex-direction: column; align-items: center; text-align: center; flex: 1; min-width: 85px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${currentStep >= 5 ? '#22c55e' : '#e2e8f0'}; color: ${currentStep >= 5 ? '#fff' : '#64748b'}; display: flex; align-items: center; justify-content: center; font-size: 15px; margin-bottom: 4px; font-weight: 700;">
            ${currentStep >= 5 ? '✓' : '5'}
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${currentStep === 5 ? '#15803d' : '#94a3b8'};">5. Return Owner</span>
        </div>
      </div>

      <!-- Prominent Scheduled Return Date Box (Shown for Step 3, 4, 5 in Sequence) -->
      ${(currentStep >= 3) ? `
        <div style="background: linear-gradient(135deg, #eff6ff, #f0fdf4); border: 1.5px solid #3b82f6; border-radius: 10px; padding: 12px 16px; margin: 14px 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="background: #2563eb; color: #fff; width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 22px;">
              <ion-icon name="calendar-outline"></ion-icon>
            </div>
            <div>
              <div style="font-size: 11.5px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.5px;">
                📅 Scheduled Return Pickup Date / वापसी पिकअप की तारीख
              </div>
              <div style="font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 2px;">
                ${returnDateFormatted} <span style="font-size: 13px; color: #64748b; font-weight: 500;">(${b.rentalDays || 1} Days Rental &bull; ${b.startDate} to ${b.endDate})</span>
              </div>
            </div>
          </div>
          <span style="background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px;">
            <ion-icon name="time-outline"></ion-icon> Return in Sequence
          </span>
        </div>
      ` : ''}

      <!-- Modern Two-Column Logistics Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 15px 0;">
        
        <!-- Customer Delivery Destination Box -->
        <div class="delivery-dest-box">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <strong style="color: #166534; font-size: 14px; display: flex; align-items: center; gap: 6px;">
              <ion-icon name="location-sharp" style="font-size: 18px;"></ion-icon> Delivery Destination (Customer)
            </strong>
            ${b.deliveryLat ? `<span style="font-size: 11px; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700;">📍 GPS Pinned</span>` : ''}
          </div>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Recipient:</strong> ${b.renterName || 'Customer'} (${b.renterPhone || 'No Phone'})</p>
          <p style="margin: 4px 0; font-size: 13.5px; color: #334155;"><strong>Address:</strong> ${customerFullAddress}</p>
          ${b.deliveryNotes ? `<p style="margin: 4px 0; font-size: 12.5px; color: #64748b;"><strong>Note / Landmark:</strong> ${b.deliveryNotes}</p>` : ''}
          
          <!-- Delivery Rider Quick Actions -->
          <div class="rider-action-bar">
            ${renterCleanPhone ? `
              <a href="tel:${renterCleanPhone}" class="rider-btn call-btn">
                <ion-icon name="call"></ion-icon> Call Customer
              </a>
              <a href="https://wa.me/91${renterCleanPhone}?text=${customerWaMsg}" target="_blank" class="rider-btn wa-btn">
                <ion-icon name="logo-whatsapp"></ion-icon> WhatsApp
              </a>
            ` : ''}
            <a href="${customerMapUrl}" target="_blank" class="rider-btn map-btn">
              <ion-icon name="navigate"></ion-icon> Google Maps
            </a>
          </div>
        </div>

        <!-- Owner Pickup Box -->
        <div class="owner-source-box">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <strong style="color: #475569; font-size: 14px; display: flex; align-items: center; gap: 6px;">
              <ion-icon name="home-sharp" style="font-size: 18px;"></ion-icon> Pickup Origin (Owner)
            </strong>
            ${b.ownerLat ? `<span style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: 700;">📍 GPS Pinned</span>` : ''}
          </div>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Owner:</strong> ${b.ownerName || 'Outfit Owner'} (${b.ownerCity || 'India'})</p>
          <p style="margin: 4px 0; font-size: 13.5px; color: #334155;"><strong>Pickup Address:</strong> ${ownerFullAddress}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #64748b;"><strong>Contact:</strong> ${b.ownerPhone || 'N/A'} ${b.ownerEmail ? `&bull; ${b.ownerEmail}` : ''}</p>
          
          <!-- Owner Quick Actions -->
          <div class="rider-action-bar">
            ${ownerCleanPhone ? `
              <a href="tel:${ownerCleanPhone}" class="rider-btn sec-btn">
                <ion-icon name="call"></ion-icon> Call Owner
              </a>
              <a href="https://wa.me/91${ownerCleanPhone}?text=${ownerWaMsg}" target="_blank" class="rider-btn wa-btn">
                <ion-icon name="logo-whatsapp"></ion-icon> WhatsApp
              </a>
            ` : ''}
            <a href="${ownerMapUrl}" target="_blank" class="rider-btn map-btn" style="background: #334155;">
              <ion-icon name="navigate"></ion-icon> Google Maps
            </a>
          </div>
        </div>

      </div>

      <!-- Financials Strip -->
      <div class="tracking-meta" style="margin-bottom: 12px;">
        <span><strong>Rent Amount:</strong> ₹${b.rentalAmount || 0}</span>
        <span><strong>Security Deposit:</strong> ₹${b.securityDeposit || 0} (Refundable)</span>
        <span><strong>Service Fee:</strong> ₹${b.serviceFee || 0}</span>
        <span><strong>Total Paid:</strong> <strong style="color: #15803d; font-size: 15px;">₹${b.grandTotal || 0}</strong></span>
        <span><strong>Payment ID:</strong> <code>${b.paymentId || 'Pending'}</code></span>
      </div>

      <!-- Security Deposit Settlement & Quality Inspection Status -->
      ${b.depositStatus === "refunded" ? `
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px 14px; margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; font-size: 13.5px;">
          <strong style="color: #15803d; display: flex; align-items: center; gap: 6px;">
            <ion-icon name="checkmark-circle" style="font-size: 18px;"></ion-icon> Security Deposit (₹${b.refundAmount || b.securityDeposit || 0}) Refunded to Customer
          </strong>
          <span style="color: #15803d; font-size: 12px; font-weight: 700;">✅ Settle Complete</span>
        </div>
      ` : b.depositStatus === "forfeited" ? `
        <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px 14px; margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; font-size: 13.5px;">
          <strong style="color: #b91c1c; display: flex; align-items: center; gap: 6px;">
            <ion-icon name="alert-circle" style="font-size: 18px;"></ion-icon> Deposit Forfeited (Damage: "${b.deductionReason || 'Reported damaged'}")
          </strong>
          <span style="color: #b91c1c; font-size: 12px; font-weight: 700;">⚠️ Customer Notified</span>
        </div>
      ` : currentStep >= 4 ? `
        <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong style="color: #1e40af; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
              <ion-icon name="shield-checkmark" style="font-size: 18px;"></ion-icon> Quality Inspection & Security Deposit (₹${b.securityDeposit || 0})
            </strong>
            <span style="font-size: 12.5px; color: #475569;">Inspect returned outfit condition to refund or deduct deposit directly.</span>
          </div>
          <button class="action-btn settle-deposit-btn" data-id="${b.id}" style="background: #0284c7; color: #fff; padding: 8px 16px; border-radius: 6px; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px;">
            <ion-icon name="shield-checkmark-outline"></ion-icon> Settle Deposit (₹${b.securityDeposit || 0})
          </button>
        </div>
      ` : ''}

      <!-- Owner Earnings Payout Status & Disbursal -->
      <div style="background: #fdf4ff; border: 1px solid #f0abfc; border-radius: 8px; padding: 12px 14px; margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div>
          <strong style="color: #86198f; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <ion-icon name="wallet-outline" style="font-size: 18px;"></ion-icon> Owner Rental Earnings: ₹${b.rentalAmount || 0}
          </strong>
          <span style="font-size: 12.5px; color: #475569;">
            Owner: <strong>${b.ownerName || 'Outfit Owner'}</strong> (${b.ownerPhone || b.ownerEmail || 'N/A'})
          </span>
        </div>
        ${b.ownerPayoutStatus === "paid" ? `
          <span style="background: #dcfce7; color: #15803d; font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 6px; display: flex; align-items: center; gap: 4px;">
            <ion-icon name="checkmark-done-circle"></ion-icon> ✅ Paid to Owner
          </span>
        ` : `
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            ${ownerCleanPhone ? `
              <a href="upi://pay?pa=${ownerCleanPhone}@upi&pn=${encodeURIComponent(b.ownerName || 'Owner')}&am=${b.rentalAmount || 0}&tn=Rental%20Earnings%20Order%20${b.id.substring(0, 6).toUpperCase()}" class="rider-btn" style="background: #7c3aed; color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px;">
                <ion-icon name="flash-outline"></ion-icon> Pay Owner via UPI (₹${b.rentalAmount || 0})
              </a>
            ` : ''}
            <button type="button" class="action-btn mark-owner-paid-btn" 
              data-id="${b.id}" 
              data-owner-uid="${b.ownerId || ''}"
              data-owner-name="${encodeURIComponent(b.ownerName || 'Owner')}" 
              data-owner-phone="${b.ownerPhone || ''}" 
              data-owner-email="${b.ownerEmail || ''}" 
              data-amount="${b.rentalAmount || 0}" 
              data-title="${encodeURIComponent(b.itemTitle || 'Outfit')}" 
              style="background: #15803d; color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 700; border: none; cursor: pointer;">
              Mark Paid
            </button>
          </div>
        `}
      </div>

      <div class="tracking-actions" style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 12.5px; font-weight: 700; color: #475569;">Stage Selector:</label>
          <select class="direct-stage-select" data-id="${b.id}" data-title="${encodeURIComponent(b.itemTitle || 'Outfit')}" style="padding: 7px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; font-weight: 600; background: #fff; cursor: pointer;">
            <option value="confirmed" ${currentStep === 1 ? 'selected' : ''}>1. Owner Pickup</option>
            <option value="cleaning_in_progress" ${currentStep === 2 ? 'selected' : ''}>2. Washing Hub</option>
            <option value="out_for_delivery" ${currentStep === 3 ? 'selected' : ''}>3. Deliver Customer</option>
            <option value="delivered_to_renter" ${currentStep === 4 ? 'selected' : ''}>4. Return Pickup</option>
            <option value="returned_to_owner" ${currentStep === 5 ? 'selected' : ''}>5. Return Owner</option>
          </select>
        </div>

        ${nextStageConfig ? `
          <button class="action-btn approve-btn advance-stage-btn" data-id="${b.id}" data-nextstage="${nextStageConfig.nextKey}" data-nexttab="${nextStageConfig.nextTab}" data-title="${encodeURIComponent(b.itemTitle || 'Outfit')}" style="background: #0284c7; color: #fff; padding: 10px 22px; font-size: 14px; font-weight: 700; border-radius: 8px; cursor: pointer; border: none; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);">
            <ion-icon name="arrow-forward-circle-outline" style="font-size: 20px;"></ion-icon> Advance Order to: ${nextStageConfig.label}
          </button>
        ` : `
          <span class="completed-banner" style="font-size: 14px; padding: 10px 20px; border-radius: 8px;">🎉 Rental Order Lifecycle Fully Completed & Settled!</span>
        `}
      </div>
    </div>
  `;
}

// Render Complaints & Disputes Tab
function renderComplaintsTab() {
  if (allComplaints.length === 0) {
    itemsListEl.innerHTML = `
      <div class="empty-admin-state">
        <ion-icon name="chatbubbles-outline"></ion-icon>
        <h3>No complaints or dispute tickets</h3>
        <p>User feedback, damaged outfit reports, or payout disputes will appear here for admin resolution.</p>
      </div>
    `;
    return;
  }

  itemsListEl.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 14px;">
      ${allComplaints.map(c => {
        const isResolved = c.status === "resolved";
        const dateStr = c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleString() : 'Recent';
        const complainantPhone = (c.complainantPhone || '').replace(/[^0-9]/g, '');

        return `
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px;">
              <div>
                <span style="background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
                  ${c.category || 'Dispute'}
                </span>
                <h3 style="margin: 6px 0 2px; font-size: 16px; color: #0f172a;">
                  Related Outfit: <strong>${c.itemTitle || 'Rental Outfit'}</strong>
                </h3>
                <span style="font-size: 12px; color: #64748b;">
                  Filed by: <strong>${c.complainantName || 'User'}</strong> (${c.complainantRole || 'User'}) &bull; ${dateStr}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${complainantPhone ? `
                  <a href="tel:${complainantPhone}" style="background: #e0f2fe; color: #0369a1; text-decoration: none; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                    <ion-icon name="call"></ion-icon> Call User
                  </a>
                ` : ''}
                <span style="background: ${isResolved ? '#dcfce7' : '#fee2e2'}; color: ${isResolved ? '#15803d' : '#b91c1c'}; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
                  ${isResolved ? '✅ Resolved' : '⚠️ Open Ticket'}
                </span>
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 13.5px; color: #334155; margin-bottom: 14px;">
              <strong>User Description:</strong>
              <p style="margin: 4px 0 0;">${c.description || 'No details provided.'}</p>
            </div>

            ${isResolved ? `
              <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 10px 14px; border-radius: 0 8px 8px 0; font-size: 13px; color: #166534;">
                <strong>Admin Resolution Note:</strong>
                <p style="margin: 3px 0 0;">${c.adminReply || 'Issue resolved.'}</p>
              </div>
            ` : `
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
                <input type="text" id="replyInput_${c.id}" placeholder="Type resolution note / action taken for user..." style="flex: 1; min-width: 250px; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box;">
                <button type="button" class="resolve-complaint-btn" 
                  data-id="${c.id}" 
                  data-uid="${c.complainantId || ''}"
                  data-email="${c.complainantEmail || ''}"
                  data-phone="${c.complainantPhone || ''}"
                  data-name="${encodeURIComponent(c.complainantName || 'User')}"
                  data-title="${encodeURIComponent(c.itemTitle || 'Outfit')}"
                  style="background: #15803d; color: #ffffff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                  <ion-icon name="checkmark-done"></ion-icon> Resolve & Notify User
                </button>
              </div>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Attach complaint resolution listeners
  document.querySelectorAll(".resolve-complaint-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const complaintId = btn.dataset.id;
      const uid = btn.dataset.uid || '';
      const email = btn.dataset.email;
      const phone = btn.dataset.phone;
      const name = decodeURIComponent(btn.dataset.name || 'User');
      const title = decodeURIComponent(btn.dataset.title || 'Outfit');
      const inputEl = document.getElementById(`replyInput_${complaintId}`);
      const replyText = inputEl ? inputEl.value.trim() : '';

      if (!replyText) {
        alert("Please enter a resolution note before marking as resolved.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Resolving...";

      try {
        await updateDoc(doc(db, "rental_complaints", complaintId), {
          status: "resolved",
          adminReply: replyText,
          resolvedAt: serverTimestamp()
        });

        // Send In-App & Email Notification to Complainant
        sendNotification({
          recipientUid: uid,
          recipientEmail: email,
          recipientPhone: phone,
          recipientName: name,
          title: "Complaint Resolved by Admin ✅",
          message: `Your dispute regarding "${title}" has been reviewed and resolved. Note: "${replyText}"`,
          type: "info",
          relatedId: complaintId,
          emailSubject: `Complaint Resolved: ${title}`
        });

        alert("✅ Complaint resolved successfully and user has been notified!");
      } catch (err) {
        console.error("Resolution error:", err);
        alert("Error resolving complaint: " + err.message);
        btn.disabled = false;
        btn.innerHTML = `<ion-icon name="checkmark-done"></ion-icon> Resolve & Notify User`;
      }
    });
  });
}

// Handle Advancing Tracking Stage & Log Entry with Auto-Tab Switch
async function handleAdvanceTrackingStage(bookingId, nextStage, itemTitle, nextTab) {
  try {
    const bookingRef = doc(db, "rental_bookings", bookingId);
    await updateDoc(bookingRef, {
      status: nextStage,
      lastUpdated: serverTimestamp()
    });

    const b = activeBookings.find(x => x.id === bookingId) || {};

    // Friendly milestone mappings and rich metadata (5 Core Dispatch Steps)
    const stageTitles = {
      "confirmed": { step: 1, title: "Step 1: Confirmed", summary: "Rental order confirmed and queued for pickup from owner" },
      "picked_up_from_owner": { step: 1, title: "Step 1: Picked Up from Owner", summary: "Outfit collected from owner and in transit to washing hub" },
      "cleaning_in_progress": { step: 2, title: "Step 2: Washing Hub (Sanitizing)", summary: "Outfit undergoing professional laundry & sanitization at hub" },
      "out_for_delivery": { step: 3, title: "Step 3: Out for Delivery", summary: "Rider on the way to deliver freshly sanitized outfit to customer doorstep" },
      "delivered_to_renter": { step: 4, title: "Step 4: Delivered & In Use", summary: "Outfit delivered cleanly to customer doorstep. Return scheduled in sequence." },
      "picked_up_from_renter": { step: 5, title: "Step 5: Return Picked from Renter", summary: "Outfit collected back from customer and returning to owner" },
      "returned_to_owner": { step: 5, title: "Step 5: Returned to Owner", summary: "Order complete. Outfit inspected and returned to owner" }
    };
    const meta = stageTitles[nextStage] || { step: 1, title: nextStage, summary: "Status update" };
    const logDocId = generateLogDocId(bookingId, nextStage, meta.step);

    // Log to pickup_delivery_logs with structured readable ID and rich fields
    await setDoc(doc(db, "pickup_delivery_logs", logDocId), {
      bookingId: bookingId,
      bookingShortId: bookingId.substring(0, 8),
      stage: nextStage,
      stageNumber: meta.step,
      stageTitle: meta.title,
      summary: meta.summary,
      itemTitle: itemTitle || b.itemTitle || "Outfit",
      customerName: b.renterName || "Customer",
      customerPhone: b.renterPhone || "",
      ownerName: b.ownerName || "Owner",
      ownerPhone: b.ownerPhone || "",
      loggedBy: "admin",
      readableDate: getReadableDateString(),
      timestamp: serverTimestamp()
    });

    // Friendly milestone message mappings
    const stageMessages = {
      "confirmed": "Your rental order has been confirmed! We are scheduling pickup from owner.",
      "picked_up_from_owner": "Our delivery executive has picked up your outfit from the owner and is heading to our cleaning hub.",
      "cleaning_in_progress": "Your outfit has arrived at our laundry center and is currently undergoing professional dry-cleaning & sanitization.",
      "out_for_delivery": "Your sanitized outfit is out for delivery! Our rider is on the way to your doorstep.",
      "delivered_to_renter": "Your outfit has been delivered to your doorstep! Enjoy your rental period.",
      "picked_up_from_renter": "Our delivery executive has picked up your returned outfit and is returning it to the owner.",
      "returned_to_owner": "Your rental order lifecycle is complete! Thank you for using Laundry & Rentals."
    };

    if (b && (b.renterId || b.renterEmail || b.renterPhone)) {
      // Send In-App & Email Notification to Customer
      sendNotification({
        recipientUid: b.renterId || "",
        recipientEmail: b.renterEmail || "",
        recipientPhone: b.renterPhone || "",
        recipientName: b.renterName || "Valued Customer",
        title: `Order Update: ${itemTitle}`,
        message: stageMessages[nextStage] || `Your rental order #${bookingId.substring(0, 8).toUpperCase()} status is now: "${nextStage}".`,
        type: "order_update",
        relatedId: bookingId,
        emailSubject: `Order Update: ${itemTitle}`
      });
    }

    // Automatically switch dispatch filter tab to the new step so the item never vanishes
    if (nextTab) {
      activeDispatchFilter = nextTab;
    }

    renderTrackingTab();
    updateCounts();
    console.log(`Booking ${bookingId} advanced to stage ${nextStage}`);
  } catch (err) {
    console.error("Error advancing tracking stage:", err);
    alert("Error updating tracking status: " + err.message);
  }
}

// Tab Switching
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.status;
    renderCurrentTab();
  });
});

// Start dashboard on DOM ready or immediately if already loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}
