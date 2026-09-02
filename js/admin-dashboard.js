import { db, auth } from "./firebase-config.js";
import { 
  collection, 
  onSnapshot, 
  doc, 
  updateDoc, 
  query, 
  orderBy,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const itemsListEl = document.getElementById("adminItemsList");
const pendingCountEl = document.getElementById("pendingCount");
const approvedCountEl = document.getElementById("approvedCount");
const rejectedCountEl = document.getElementById("rejectedCount");
const tabBtns = document.querySelectorAll(".tab-btn");

let currentTab = "pending";
let allItems = [];

// Initialize real-time listener
function initDashboard() {
  const rentalQuery = query(collection(db, "rental_items"), orderBy("createdAt", "desc"));

  onSnapshot(rentalQuery, (snapshot) => {
    allItems = [];
    snapshot.forEach((docSnap) => {
      allItems.push({ id: docSnap.id, ...docSnap.data() });
    });

    updateCounts();
    renderCurrentTab();
  }, (error) => {
    console.error("Firestore Error:", error);
    itemsListEl.innerHTML = `<div class="error-box"><p>❌ Error loading database: ${error.message}</p></div>`;
  });
}

// Update counters in tabs
function updateCounts() {
  const pending = allItems.filter(item => (item.status || "pending") === "pending").length;
  const approved = allItems.filter(item => item.status === "approved").length;
  const rejected = allItems.filter(item => item.status === "rejected").length;

  if (pendingCountEl) pendingCountEl.textContent = pending;
  if (approvedCountEl) approvedCountEl.textContent = approved;
  if (rejectedCountEl) rejectedCountEl.textContent = rejected;
}

// Render items based on active tab
function renderCurrentTab() {
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

  // Attach event listeners to Approve/Reject buttons
  document.querySelectorAll(".approve-btn").forEach(btn => {
    btn.addEventListener("click", () => handleStatusChange(btn.dataset.id, "approved"));
  });

  document.querySelectorAll(".reject-btn").forEach(btn => {
    btn.addEventListener("click", () => handleStatusChange(btn.dataset.id, "rejected"));
  });
}

// Generate card HTML
function createItemCard(item) {
  const mainImg = (item.images && item.images.length > 0) ? item.images[0] : "../images/placeholder.jpg";
  const extraImagesCount = item.images ? item.images.length - 1 : 0;
  const status = item.status || "pending";

  let statusBadge = "";
  if (status === "pending") statusBadge = `<span class="status-badge badge-pending">⏳ Pending Review</span>`;
  else if (status === "approved") statusBadge = `<span class="status-badge badge-approved">✅ Approved</span>`;
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
          <p><strong>Price / Day:</strong> ₹${item.pricePerDay || 0}</p>
          <p><strong>Security Deposit:</strong> ₹${item.securityDeposit || 0}</p>
          <p class="owner-id"><strong>Owner ID:</strong> <code>${item.ownerId || 'Anonymous'}</code></p>
        </div>

        <div class="admin-card-actions">
          ${status !== 'approved' ? `
            <button class="action-btn approve-btn" data-id="${item.id}">
              <ion-icon name="checkmark-sharp"></ion-icon> Approve
            </button>
          ` : ''}

          ${status !== 'rejected' ? `
            <button class="action-btn reject-btn" data-id="${item.id}">
              <ion-icon name="close-sharp"></ion-icon> Reject
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
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
