import { db, auth } from "./firebase-config.js";
import { 
  collection, 
  onSnapshot, 
  doc, 
  getDoc,
  updateDoc, 
  deleteDoc,
  addDoc, 
  query, 
  orderBy,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sendStatusNotification } from "./notifications.js";

const itemsListEl = document.getElementById("adminItemsList");
const pendingCountEl = document.getElementById("pendingCount");
const approvedCountEl = document.getElementById("approvedCount");
const rejectedCountEl = document.getElementById("rejectedCount");
const trackingCountEl = document.getElementById("trackingCount");
const tabBtns = document.querySelectorAll(".tab-btn");

let currentTab = "pending";
let allItems = [];
let activeBookings = [];

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
      alert("🔒 Access Denied: Sirf unhi accounts ko permission hai jinka role Firebase me 'admin' hai.");
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

    alert("🔒 Access Denied: Pehle Admin account se login karein.");
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
}

// Update counters in tabs
function updateCounts() {
  const pending = allItems.filter(item => (item.status || "pending") === "pending").length;
  const approved = allItems.filter(item => item.status === "approved").length;
  const rejected = allItems.filter(item => item.status === "rejected").length;
  const tracking = activeBookings.filter(b => b.status && b.status !== "pending_payment" && b.status !== "cancelled").length;

  if (pendingCountEl) pendingCountEl.textContent = pending;
  if (approvedCountEl) approvedCountEl.textContent = approved;
  if (rejectedCountEl) rejectedCountEl.textContent = rejected;
  if (trackingCountEl) trackingCountEl.textContent = tracking;
}

// Render items based on active tab
function renderCurrentTab() {
  if (currentTab === "tracking") {
    renderTrackingTab();
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
    btn.addEventListener("click", () => handleStatusChange(btn.dataset.id, "approved"));
  });

  document.querySelectorAll(".reject-btn").forEach(btn => {
    btn.addEventListener("click", () => handleStatusChange(btn.dataset.id, "rejected"));
  });

  document.querySelectorAll(".delete-item-btn").forEach(btn => {
    btn.addEventListener("click", () => handleDeleteItem(btn.dataset.id));
  });
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
          <p><strong>City / Location:</strong> ${item.city || 'India'}</p>
          <p><strong>Owner:</strong> ${item.ownerName || 'Valued User'} (${item.ownerPhone || item.ownerEmail || 'N/A'})</p>
        </div>

        <div class="admin-card-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${status !== 'approved' ? `
            <button class="action-btn approve-btn" data-id="${item.id}" style="background: #15803d; color: #fff;">
              <ion-icon name="checkmark-sharp"></ion-icon> Approve (लाइव करें)
            </button>
          ` : `
            <button class="action-btn reject-btn" data-id="${item.id}" style="background: #eab308; color: #000;">
              <ion-icon name="eye-off-outline"></ion-icon> Unpublish
            </button>
          `}

          <button class="action-btn delete-item-btn" data-id="${item.id}" style="background: #dc2626; color: #fff; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: 600;">
            <ion-icon name="trash-outline"></ion-icon> Delete
          </button>
        </div>
      </div>
    </div>
  `;
}

// Handle Delete action
async function handleDeleteItem(itemId) {
  if (!confirm("क्या आप वाकई इस आइटम को मार्केटप्लेस और डेटाबेस से हमेशा के लिए डिलीट करना चाहते हैं?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "rental_items", itemId));
    alert("✅ आइटम सफलतापूर्वक डिलीट कर दिया गया!");
  } catch (error) {
    console.error("Delete error:", error);
    alert("❌ डिलीट करने में समस्या आई: " + error.message);
  }
}

// Handle Approve / Reject action
async function handleStatusChange(itemId, newStatus) {
  try {
    const itemRef = doc(db, "rental_items", itemId);
    const updateData = {
      status: newStatus,
      verifiedByAdmin: newStatus === "approved",
      reviewedAt: serverTimestamp()
    };

    await updateDoc(itemRef, updateData);
    console.log(`Item ${itemId} updated to ${newStatus}`);
  } catch (error) {
    console.error(`Error updating item ${itemId}:`, error);
    alert("Error updating item status: " + error.message);
  }
}

// Render Pickup & Delivery Tracking Tab (Step 14)
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

  itemsListEl.innerHTML = activeList.map(booking => createTrackingCard(booking)).join("");

  // Attach stage advance event listeners
  document.querySelectorAll(".advance-stage-btn").forEach(btn => {
    btn.addEventListener("click", () => handleAdvanceTrackingStage(btn.dataset.id, btn.dataset.nextstage, btn.dataset.title));
  });
}

// Create Tracking Card HTML
function createTrackingCard(b) {
  const stages = [
    { key: "confirmed", label: "1. Confirmed", icon: "checkmark-circle-outline" },
    { key: "picked_up_from_owner", label: "2. Owner Pickup", icon: "cube-outline" },
    { key: "cleaning_in_progress", label: "3. Laundry Cleaned", icon: "sparkles-outline" },
    { key: "delivered_to_renter", label: "4. Delivered to Renter", icon: "home-outline" },
    { key: "picked_up_from_renter", label: "5. Return Pickup", icon: "return-down-back-outline" },
    { key: "returned_to_owner", label: "6. Returned to Owner", icon: "ribbon-outline" }
  ];

  const currentIdx = stages.findIndex(s => s.key === (b.status || "confirmed"));
  const nextStage = currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;

  return `
    <div class="tracking-card">
      <div class="tracking-card-header">
        <div>
          <h3>${b.itemTitle || 'Rental Outfit'}</h3>
          <span class="booking-id-tag">Booking ID: <code>${b.id}</code></span>
        </div>
        <span class="status-badge badge-approved">${(b.status || 'confirmed').replace(/_/g, ' ').toUpperCase()}</span>
      </div>

      <div class="tracking-meta">
        <p><strong>Renter:</strong> ${b.renterEmail || 'N/A'}</p>
        <p><strong>Rental Period:</strong> ${b.startDate} to ${b.endDate} (${b.rentalDays} days)</p>
        <p><strong>Total Paid:</strong> ₹${b.grandTotal} (Deposit: ₹${b.securityDeposit})</p>
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

      <div class="tracking-actions">
        ${nextStage ? `
          <button class="action-btn approve-btn advance-stage-btn" data-id="${b.id}" data-nextstage="${nextStage.key}" data-title="${b.itemTitle || 'Outfit'}">
            Advance to: ${nextStage.label}
          </button>
        ` : `
          <span class="completed-banner">🎉 Order Lifecycle Fully Completed!</span>
        `}
      </div>
    </div>
  `;
}

// Handle Advancing Tracking Stage & Log Entry
async function handleAdvanceTrackingStage(bookingId, nextStage, itemTitle) {
  try {
    const bookingRef = doc(db, "rental_bookings", bookingId);
    await updateDoc(bookingRef, {
      status: nextStage,
      lastUpdated: serverTimestamp()
    });

    // Log to pickup_delivery_logs
    await addDoc(collection(db, "pickup_delivery_logs"), {
      bookingId: bookingId,
      stage: nextStage,
      loggedBy: "admin",
      timestamp: serverTimestamp()
    });

    // Trigger Notification Alert (Step 15)
    sendStatusNotification({
      recipientPhone: "919999999999",
      recipientType: "Customer",
      title: itemTitle,
      newStatus: nextStage,
      bookingId: bookingId
    });

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
