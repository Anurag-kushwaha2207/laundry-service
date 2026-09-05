import { db, auth } from "./firebase-config.js";
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
        return { isAllowed: true, role: role };
      } else {
        return { isAllowed: false, reason: `Role is '${data.role || "none"}', not 'admin'.` };
      }
    } catch (e) {
      console.error("Firestore admin check error:", e);
      return { isAllowed: false, reason: `Firestore connection error: ${e.message}` };
    }
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
    
    // Check if session has admin role or Firestore confirms admin role
    let isAllowed = localUser.role === "admin";
    if (!isAllowed) {
      const checkResult = await checkUserAdminInFirebase(cleanEmail);
      isAllowed = checkResult.isAllowed;
      if (isAllowed) {
        localUser.role = "admin";
        localStorage.setItem("laundry_current_user", JSON.stringify(localUser));
      } else {
        console.warn("Permission check detail:", checkResult.reason);
      }
    }

    if (isAllowed) {
      console.log("✅ Admin access granted for:", cleanEmail);
      if (securityOverlay) securityOverlay.style.display = "none";
      loadDashboardData();
      return;
    } else {
      alert("🔒 Access Denied: Only accounts with an 'admin' role in Firebase are authorized to access this dashboard.");
      window.location.href = "../index.html";
      return;
    }
  }

  // 2. If no local user, check Firebase Auth as fallback
  auth.onAuthStateChanged(async (user) => {
    if (user && user.email) {
      const checkResult = await checkUserAdminInFirebase(user.email);
      if (checkResult.isAllowed) {
        console.log("✅ Admin access granted via Firebase Auth:", user.email);
        if (securityOverlay) securityOverlay.style.display = "none";
        loadDashboardData();
        return;
      }
    }

    alert("🔒 Access Denied: Please log in with an authorized Admin account first.");
    window.location.href = "../index.html";
  });
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
    if (currentTab !== "tracking") renderCurrentTab();
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
    console.warn("Firestore Warning (rental_bookings):", error);
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
  const tracking = activeBookings.filter(b => b.status && b.status !== "pending_payment" && b.status !== "cancelled").length;
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

// Handle Approve action with Notification
async function handleApproveItem(itemId) {
  try {
    const item = allItems.find(i => i.id === itemId);
    const itemRef = doc(db, "rental_items", itemId);
    await updateDoc(itemRef, {
      status: "approved",
      verifiedByAdmin: true,
      reviewedAt: serverTimestamp()
    });

    // Notify Owner
    if (item) {
      sendNotification({
        recipientUid: item.ownerId || "",
        recipientEmail: item.ownerEmail || "",
        recipientPhone: item.ownerPhone || "",
        recipientName: item.ownerName || "Valued Owner",
        title: `Listing Approved! 🎉`,
        message: `Great news! Your outfit "${item.title}" has been verified and published live on the marketplace.`,
        type: "item_approval",
        relatedId: item.id,
        emailSubject: `Listing Approved: ${item.title}`
      });
    }

    console.log(`Item ${itemId} approved and published live`);
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

// Render Pickup & Delivery Tracking Tab with Dispatch Queues
function renderTrackingTab() {
  const activeList = activeBookings.filter(b => b.status && b.status !== "pending_payment" && b.status !== "cancelled");

  if (activeList.length === 0) {
    itemsListEl.innerHTML = `
      <div class="empty-admin-state">
        <ion-icon name="car-sport-outline"></ion-icon>
        <h3>No active rental orders to track</h3>
        <p>Confirmed rental bookings will appear here for pickup & delivery stage management.</p>
      </div>
    `;
    return;
  }

  // Calculate Dispatch Stage Counts
  const countPickupOwner = activeList.filter(b => (b.status || "confirmed") === "confirmed").length;
  const countHub = activeList.filter(b => b.status === "picked_up_from_owner").length;
  const countDeliverCustomer = activeList.filter(b => b.status === "cleaning_in_progress").length;
  const countReturnCustomer = activeList.filter(b => b.status === "delivered_to_renter").length;
  const countReturnOwner = activeList.filter(b => b.status === "picked_up_from_renter" || b.status === "returned_to_owner").length;

  let filteredList = activeList;
  if (activeDispatchFilter === "pickup_owner") {
    filteredList = activeList.filter(b => (b.status || "confirmed") === "confirmed");
  } else if (activeDispatchFilter === "hub_cleaning") {
    filteredList = activeList.filter(b => b.status === "picked_up_from_owner");
  } else if (activeDispatchFilter === "deliver_customer") {
    filteredList = activeList.filter(b => b.status === "cleaning_in_progress");
  } else if (activeDispatchFilter === "return_customer") {
    filteredList = activeList.filter(b => b.status === "delivered_to_renter");
  } else if (activeDispatchFilter === "return_owner") {
    filteredList = activeList.filter(b => b.status === "picked_up_from_renter" || b.status === "returned_to_owner");
  }

  const filterBarHtml = `
    <div style="grid-column: 1 / -1; display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; background: #ffffff; padding: 12px 14px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
      <button class="dispatch-filter-btn" data-filter="all" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'all' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'all' ? '#fff' : '#475569'};">All (${activeList.length})</button>
      <button class="dispatch-filter-btn" data-filter="pickup_owner" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'pickup_owner' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'pickup_owner' ? '#fff' : '#475569'};">📦 1. To Pick Up from Owner (${countPickupOwner})</button>
      <button class="dispatch-filter-btn" data-filter="hub_cleaning" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'hub_cleaning' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'hub_cleaning' ? '#fff' : '#475569'};">🫧 2. Washing Hub (${countHub})</button>
      <button class="dispatch-filter-btn" data-filter="deliver_customer" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'deliver_customer' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'deliver_customer' ? '#fff' : '#475569'};">🚚 3. To Deliver to Customer (${countDeliverCustomer})</button>
      <button class="dispatch-filter-btn" data-filter="return_customer" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'return_customer' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'return_customer' ? '#fff' : '#475569'};">🔄 4. Return Pickup Due (${countReturnCustomer})</button>
      <button class="dispatch-filter-btn" data-filter="return_owner" style="padding: 7px 13px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12.5px; font-weight: 700; cursor: pointer; background: ${activeDispatchFilter === 'return_owner' ? '#0284c7' : '#fff'}; color: ${activeDispatchFilter === 'return_owner' ? '#fff' : '#475569'};">🏠 5. Return Back to Owner & Settle (${countReturnOwner})</button>
    </div>
  `;

  if (filteredList.length === 0) {
    itemsListEl.innerHTML = filterBarHtml + `
      <div class="empty-admin-state" style="grid-column: 1 / -1;">
        <ion-icon name="checkmark-done-circle-outline"></ion-icon>
        <h3>No orders in this dispatch queue</h3>
        <p>All items in this stage have been processed or moved to the next step.</p>
      </div>
    `;
  } else {
    itemsListEl.innerHTML = filterBarHtml + filteredList.map(booking => createTrackingCard(booking)).join("");
  }

  // Attach dispatch filter listeners
  document.querySelectorAll(".dispatch-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeDispatchFilter = btn.dataset.filter || "all";
      renderTrackingTab();
    });
  });

  // Attach stage advance event listeners
  document.querySelectorAll(".advance-stage-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAdvanceTrackingStage(btn.dataset.id, btn.dataset.nextstage, btn.dataset.title));
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
function createTrackingCard(b) {
  const stages = [
    { key: "confirmed", label: "1. Confirmed", icon: "checkmark-circle-outline" },
    { key: "picked_up_from_owner", label: "2. Owner Pickup", icon: "cube-outline" },
    { key: "cleaning_in_progress", label: "3. Laundry Cleaned", icon: "sparkles-outline" },
    { key: "delivered_to_renter", label: "4. Delivered to Renter", icon: "home-outline" },
    { key: "picked_up_from_renter", label: "5. Return Pickup", icon: "return-down-back-outline" },
    { key: "returned_to_owner", label: "6. Returned & Settled", icon: "ribbon-outline" }
  ];

  const currentIdx = stages.findIndex(s => s.key === (b.status || "confirmed"));
  const nextStage = currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;
  const currentStageLabel = currentIdx >= 0 ? stages[currentIdx].label : (b.status || "Confirmed");

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

  const customerWaMsg = encodeURIComponent(`Hello ${b.renterName || 'Customer'}! Update regarding your rental order #${b.id.substring(0, 6)} for "${b.itemTitle || 'Outfit'}": Status is [${currentStageLabel}]. Our delivery executive will reach your address: ${customerFullAddress}.`);
  const ownerWaMsg = encodeURIComponent(`Hello ${b.ownerName || 'Owner'}! Update regarding rental booking #${b.id.substring(0, 6)} for your outfit "${b.itemTitle || 'Outfit'}": Status is [${currentStageLabel}].`);

  return `
    <div class="tracking-card">
      <div class="tracking-card-header">
        <div style="display: flex; gap: 14px; align-items: center;">
          ${b.itemImage ? `<img src="${b.itemImage}" style="width: 58px; height: 58px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">` : ''}
          <div>
            <h3 style="margin: 0; font-size: 18px; color: #0f172a;">${b.itemTitle || 'Rental Outfit'}</h3>
            <span class="booking-id-tag">Order ID: <code>#${b.id.substring(0, 8).toUpperCase()}</code> &bull; ${b.startDate} to ${b.endDate} (${b.rentalDays || 1} days)</span>
          </div>
        </div>
        <span class="status-badge badge-approved" style="font-size: 13px; padding: 6px 14px;">${currentStageLabel.toUpperCase()}</span>
      </div>

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
      ` : currentIdx >= 4 ? `
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

      <!-- Stage Timeline Progress Bar -->
      <div class="stage-timeline">
        ${stages.map((s, idx) => `
          <div class="timeline-step ${idx <= currentIdx ? 'completed' : ''}">
            <div class="step-icon"><ion-icon name="${s.icon}"></ion-icon></div>
            <span class="step-label">${s.label}</span>
          </div>
        `).join("")}
      </div>

      <div class="tracking-actions" style="margin-top: 15px; display: flex; justify-content: flex-end;">
        ${nextStage ? `
          <button class="action-btn approve-btn advance-stage-btn" data-id="${b.id}" data-nextstage="${nextStage.key}" data-title="${b.itemTitle || 'Outfit'}" style="background: #0284c7; color: #fff; padding: 10px 20px; font-size: 14px; font-weight: 700; border-radius: 8px; cursor: pointer; border: none; display: flex; align-items: center; gap: 8px;">
            <ion-icon name="arrow-forward-circle-outline" style="font-size: 20px;"></ion-icon> Advance Order to: ${nextStage.label}
          </button>
        ` : `
          <span class="completed-banner" style="font-size: 15px; padding: 10px 20px;">🎉 Rental Order Lifecycle Fully Completed & Settled!</span>
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

// Handle Advancing Tracking Stage & Log Entry
async function handleAdvanceTrackingStage(bookingId, nextStage, itemTitle) {
  try {
    const bookingRef = doc(db, "rental_bookings", bookingId);
    await updateDoc(bookingRef, {
      status: nextStage,
      lastUpdated: serverTimestamp()
    });

    const b = activeBookings.find(x => x.id === bookingId) || {};

    // Friendly milestone mappings and rich metadata
    const stageTitles = {
      "picked_up_from_owner": { step: 1, title: "Stage 1: Picked Up from Owner", summary: "Outfit collected from owner and in transit to laundry hub" },
      "cleaning_in_progress": { step: 2, title: "Stage 2: Cleaning & Sanitization", summary: "Outfit undergoing professional laundry & sanitization at hub" },
      "delivered_to_renter": { step: 3, title: "Stage 3: Delivered to Renter", summary: "Outfit delivered cleanly to customer doorstep" },
      "picked_up_from_renter": { step: 4, title: "Stage 4: Return Picked from Renter", summary: "Outfit collected back from customer after rental period" },
      "returned_to_owner": { step: 5, title: "Stage 5: Returned to Owner", summary: "Order complete. Outfit inspected and returned to owner" }
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
      "picked_up_from_owner": "Our delivery executive has picked up your outfit from the owner and is heading to our cleaning hub.",
      "cleaning_in_progress": "Your outfit has arrived at our laundry center and is currently undergoing professional dry-cleaning & sanitization.",
      "delivered_to_renter": "Your outfit has been delivered to your doorstep! Enjoy your rental period.",
      "picked_up_from_renter": "Our delivery executive has picked up your returned outfit and is returning it for inspection.",
      "returned_to_owner": "Your rental order lifecycle is complete! Thank you for using Laundry & Rentals."
    };

    const b = activeBookings.find(x => x.id === bookingId);
    if (b) {
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

// Start dashboard on DOM ready
document.addEventListener("DOMContentLoaded", initDashboard);
