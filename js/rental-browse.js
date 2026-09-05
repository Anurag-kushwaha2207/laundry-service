import { db } from "./firebase-config.js";
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initNotificationCenter } from "./notifications.js";

const browseGrid = document.getElementById("browseGrid");
const resultsCount = document.getElementById("resultsCount");
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const maxPriceInput = document.getElementById("maxPriceInput");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");

let approvedItems = [];

// Initialize fetching approved items from Firestore
function initBrowseMarketplace() {
  // Query all approved items
  const q = query(
    collection(db, "rental_items"),
    where("status", "==", "approved")
  );

  onSnapshot(q, (snapshot) => {
    approvedItems = [];
    snapshot.forEach((docSnap) => {
      approvedItems.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Sort client-side by creation date if available
    approvedItems.sort((a, b) => {
      const timeA = a.createdAt ? a.createdAt.seconds || 0 : 0;
      const timeB = b.createdAt ? b.createdAt.seconds || 0 : 0;
      return timeB - timeA;
    });

    applyFiltersAndRender();
  }, (error) => {
    console.error("Error fetching marketplace items:", error);
    // Fallback if index error occurs
    fetchApprovedItemsFallback();
  });
}

// Fallback query without compound indexing
function fetchApprovedItemsFallback() {
  onSnapshot(collection(db, "rental_items"), (snapshot) => {
    approvedItems = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.status === "approved") {
        approvedItems.push({ id: docSnap.id, ...data });
      }
    });

    applyFiltersAndRender();
  }, (err) => {
    console.error("Fallback error:", err);
    browseGrid.innerHTML = `<div class="error-box"><p>❌ Unable to load marketplace items.</p></div>`;
  });
}

// Apply active filters and render grid
function applyFiltersAndRender() {
  const searchTerm = (searchInput.value || "").toLowerCase().trim();
  const selectedCat = categoryFilter.value || "all";
  const maxPrice = Number(maxPriceInput.value) || 0;

  const filtered = approvedItems.filter(item => {
    // Search filter
    const matchesSearch = !searchTerm || 
      (item.title && item.title.toLowerCase().includes(searchTerm)) ||
      (item.category && item.category.toLowerCase().includes(searchTerm)) ||
      (item.size && item.size.toLowerCase().includes(searchTerm));

    // Category filter
    const matchesCat = (selectedCat === "all") || 
      (item.category && item.category.toLowerCase() === selectedCat);

    // Max Price filter
    const matchesPrice = !maxPrice || (Number(item.pricePerDay) <= maxPrice);

    return matchesSearch && matchesCat && matchesPrice;
  });

  // Update counter display
  resultsCount.textContent = `Showing ${filtered.length} available outfit${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    browseGrid.innerHTML = `
      <div class="empty-marketplace-state">
        <ion-icon name="shirt-outline"></ion-icon>
        <h3>No matching outfits found</h3>
        <p>Try adjusting your search criteria or resetting filters.</p>
      </div>
    `;
    return;
  }

  browseGrid.innerHTML = filtered.map(item => createMarketplaceCard(item)).join("");
}

// Create Card HTML
function createMarketplaceCard(item) {
  const mainImg = (item.images && item.images.length > 0) ? item.images[0] : "https://via.placeholder.com/350x450?text=No+Photo";

  return `
    <div class="browse-card">
      <div class="browse-card-img">
        <img src="${mainImg}" alt="${item.title || 'Rental Outfit'}" loading="lazy" onerror="this.src='https://via.placeholder.com/350x450?text=No+Photo'">
        <span class="category-badge">${item.category || 'Outfit'}</span>
      </div>

      <div class="browse-card-content">
        <h3 class="browse-card-title">${item.title || 'Untitled Outfit'}</h3>
        
        <div class="browse-card-meta">
          <span><strong>Size:</strong> ${item.size || 'Free'}</span>
          <span><strong>Condition:</strong> ${item.condition || 'Good'}</span>
        </div>

        <div class="browse-card-pricing">
          <div class="price-tag">
            <span class="price-amount">₹${item.pricePerDay}</span>
            <span class="price-period">/ day</span>
          </div>
          <div class="deposit-tag">
            <span>Deposit: ₹${item.securityDeposit}</span>
          </div>
        </div>

        <a href="item-details.html?id=${item.id}" class="rent-now-btn">
          <ion-icon name="flash-outline"></ion-icon> View & Rent Now
        </a>
      </div>
    </div>
  `;
}

// Event Listeners for Filter Inputs
searchInput.addEventListener("input", applyFiltersAndRender);
categoryFilter.addEventListener("change", applyFiltersAndRender);
maxPriceInput.addEventListener("input", applyFiltersAndRender);

resetFiltersBtn.addEventListener("click", () => {
  searchInput.value = "";
  categoryFilter.value = "all";
  maxPriceInput.value = "";
  applyFiltersAndRender();
});

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initBrowseMarketplace();
  initNotificationCenter();
});
