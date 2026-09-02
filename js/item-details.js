import { db, auth } from "./firebase-config.js";
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  updateDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openRazorpayCheckout } from "./razorpay-config.js";

const wrapper = document.getElementById("itemDetailsWrapper");

// Get Item ID from URL
const urlParams = new URLSearchParams(window.location.search);
const itemId = urlParams.get("id");

let itemData = null;
let existingBookings = [];

// Initialize Item Details Page
async function initItemDetails() {
  if (!itemId) {
    wrapper.innerHTML = `
      <div class="error-box full-width">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <h3>No item specified</h3>
        <p>Please select an outfit from the <a href="browse.html">Marketplace</a>.</p>
      </div>
    `;
    return;
  }

  try {
    // 1. Fetch Item Document
    const itemDocRef = doc(db, "rental_items", itemId);
    const itemSnap = await getDoc(itemDocRef);

    if (!itemSnap.exists()) {
      wrapper.innerHTML = `
        <div class="error-box full-width">
          <ion-icon name="shirt-outline"></ion-icon>
          <h3>Outfit not found</h3>
          <p>This rental listing does not exist or has been removed.</p>
        </div>
      `;
      return;
    }

    itemData = { id: itemSnap.id, ...itemSnap.data() };

    // 2. Fetch Existing Bookings for Availability Check
    await fetchExistingBookings();

    // 3. Render Page UI
    renderItemPage();

  } catch (error) {
    console.error("Error loading item details:", error);
    wrapper.innerHTML = `
      <div class="error-box full-width">
        <p>❌ Error loading item details: ${error.message}</p>
      </div>
    `;
  }
}

// Fetch existing active bookings for this item
async function fetchExistingBookings() {
  try {
    const q = query(
      collection(db, "rental_bookings"),
      where("itemId", "==", itemId)
    );
    const snapshot = await getDocs(q);
    existingBookings = [];
    snapshot.forEach(docSnap => {
      const bData = docSnap.data();
      if (bData.status !== "cancelled") {
        existingBookings.push(bData);
      }
    });
  } catch (err) {
    console.warn("Could not fetch existing bookings:", err);
  }
}

// Render Item Details & Booking Form
function renderItemPage() {
  const images = (itemData.images && itemData.images.length > 0) 
    ? itemData.images 
    : ["https://via.placeholder.com/500x600?text=No+Image"];

  // Default dates: Today & Tomorrow
  const todayStr = new Date().toISOString().split("T")[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  wrapper.innerHTML = `
    <!-- Left Column: Gallery -->
    <div class="details-gallery">
      <div class="main-image-box">
        <img id="mainPreview" src="${images[0]}" alt="${itemData.title || 'Outfit Preview'}">
      </div>
      ${images.length > 1 ? `
        <div class="thumbnail-strip">
          ${images.map((img, idx) => `
            <img src="${img}" class="thumb-img ${idx === 0 ? 'active' : ''}" data-index="${idx}" alt="Thumbnail ${idx+1}">
          `).join("")}
        </div>
      ` : ''}
    </div>

    <!-- Right Column: Info & Booking Form -->
    <div class="details-info">
      <div class="info-header">
        <span class="category-badge-pill">${itemData.category || 'Outfit'}</span>
        <h1>${itemData.title || 'Untitled Outfit'}</h1>
        <p class="verified-tag"><ion-icon name="checkmark-seal-sharp"></ion-icon> Professionally Cleaned & Verified</p>
      </div>

      <div class="spec-grid">
        <div class="spec-card">
          <span class="spec-label">Size</span>
          <span class="spec-val">${itemData.size || 'Free Size'}</span>
        </div>
        <div class="spec-card">
          <span class="spec-label">Condition</span>
          <span class="spec-val cap">${itemData.condition || 'Good'}</span>
        </div>
        <div class="spec-card">
          <span class="spec-label">Rent / Day</span>
          <span class="spec-val highlight">₹${itemData.pricePerDay}</span>
        </div>
        <div class="spec-card">
          <span class="spec-label">Refundable Deposit</span>
          <span class="spec-val">₹${itemData.securityDeposit}</span>
        </div>
      </div>

      <!-- Booking Form -->
      <div class="booking-card" id="bookingCardBox">
        <h3><ion-icon name="calendar-outline"></ion-icon> Select Rental Dates</h3>
        <form id="bookingForm">
          <div class="date-picker-grid">
            <div class="date-input-group">
              <label for="startDate">Start Date</label>
              <input type="date" id="startDate" min="${todayStr}" value="${todayStr}" required>
            </div>
            <div class="date-input-group">
              <label for="endDate">End Date</label>
              <input type="date" id="endDate" min="${todayStr}" value="${tomorrowStr}" required>
            </div>
          </div>

          <div id="availabilityNotice" class="availability-notice"></div>

          <!-- Calculation Summary -->
          <div class="price-breakdown">
            <h4>Price Summary</h4>
            <div class="breakdown-row">
              <span>Rental Duration</span>
              <span id="daysCount">1 day</span>
            </div>
            <div class="breakdown-row">
              <span>Rental Charge</span>
              <span id="rentalFeeTotal">₹${itemData.pricePerDay}</span>
            </div>
            <div class="breakdown-row">
              <span>Security Deposit (Refundable)</span>
              <span id="depositTotal">₹${itemData.securityDeposit}</span>
            </div>
            <div class="breakdown-row">
              <span>Cleaning & Platform Fee (10%)</span>
              <span id="serviceFeeTotal">₹${Math.round(itemData.pricePerDay * 0.10)}</span>
            </div>
            <div class="breakdown-row grand-total">
              <span>Total Payable</span>
              <span id="grandTotal">₹${itemData.pricePerDay + itemData.securityDeposit + Math.round(itemData.pricePerDay * 0.10)}</span>
            </div>
          </div>

          <button type="submit" id="bookNowBtn" class="book-now-submit-btn">
            <ion-icon name="card-outline"></ion-icon> Pay Now with Razorpay
          </button>
        </form>
        <p id="bookingStatusMsg" class="booking-status-msg"></p>
      </div>
    </div>
  `;

  // Gallery Thumbnail Click Logic
  const mainPreview = document.getElementById("mainPreview");
  const thumbs = document.querySelectorAll(".thumb-img");
  thumbs.forEach(t => {
    t.addEventListener("click", () => {
      thumbs.forEach(other => other.classList.remove("active"));
      t.classList.add("active");
      const idx = t.dataset.index;
      mainPreview.src = images[idx];
    });
  });

  // Attach Date Input Change Listeners
  const startDateInput = document.getElementById("startDate");
  const endDateInput = document.getElementById("endDate");

  startDateInput.addEventListener("change", () => {
    if (endDateInput.value < startDateInput.value) {
      endDateInput.value = startDateInput.value;
    }
    endDateInput.min = startDateInput.value;
    recalculatePriceAndAvailability();
  });

  endDateInput.addEventListener("change", recalculatePriceAndAvailability);

  // Initial Math & Availability check
  recalculatePriceAndAvailability();

  // Attach Booking Form Submission
  const bookingForm = document.getElementById("bookingForm");
  bookingForm.addEventListener("submit", handleBookingSubmit);
}

// Recalculate price math and check availability overlap
function recalculatePriceAndAvailability() {
  const startDateStr = document.getElementById("startDate").value;
  const endDateStr = document.getElementById("endDate").value;
  const bookNowBtn = document.getElementById("bookNowBtn");
  const noticeEl = document.getElementById("availabilityNotice");

  if (!startDateStr || !endDateStr) return;

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (end < start) {
    noticeEl.className = "availability-notice error";
    noticeEl.innerHTML = "⚠️ End date must be on or after start date.";
    bookNowBtn.disabled = true;
    return;
  }

  // Calculate rental days
  const diffTime = Math.abs(end - start);
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  // Price calculations
  const pricePerDay = Number(itemData.pricePerDay) || 0;
  const securityDeposit = Number(itemData.securityDeposit) || 0;
  const rentalFee = days * pricePerDay;
  const serviceFee = Math.round(rentalFee * 0.10);
  const grandTotal = rentalFee + securityDeposit + serviceFee;

  // Update DOM elements
  document.getElementById("daysCount").textContent = `${days} day${days > 1 ? 's' : ''}`;
  document.getElementById("rentalFeeTotal").textContent = `₹${rentalFee}`;
  document.getElementById("depositTotal").textContent = `₹${securityDeposit}`;
  document.getElementById("serviceFeeTotal").textContent = `₹${serviceFee}`;
  document.getElementById("grandTotal").textContent = `₹${grandTotal}`;

  // Availability Conflict Check
  let isConflicting = false;
  for (let b of existingBookings) {
    if (b.startDate && b.endDate) {
      const bStart = new Date(b.startDate);
      const bEnd = new Date(b.endDate);
      if (start <= bEnd && end >= bStart) {
        isConflicting = true;
        break;
      }
    }
  }

  if (isConflicting) {
    noticeEl.className = "availability-notice error";
    noticeEl.innerHTML = "⚠️ Outfit is already reserved for these dates. Please select different dates.";
    bookNowBtn.disabled = true;
  } else {
    noticeEl.className = "availability-notice success";
    noticeEl.innerHTML = "✅ Dates available for instant booking!";
    bookNowBtn.disabled = false;
  }
}

// Handle Form Submission & Trigger Razorpay Modal
async function handleBookingSubmit(e) {
  e.preventDefault();
  const msgEl = document.getElementById("bookingStatusMsg");
  const bookNowBtn = document.getElementById("bookNowBtn");

  msgEl.textContent = "Creating booking reservation...";
  bookNowBtn.disabled = true;

  try {
    const user = auth.currentUser;
    if (!user) {
      msgEl.innerHTML = `⚠️ Pehle login karein! Please login on the home page first.`;
      bookNowBtn.disabled = false;
      return;
    }

    const startDateStr = document.getElementById("startDate").value;
    const endDateStr = document.getElementById("endDate").value;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const days = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;

    const pricePerDay = Number(itemData.pricePerDay);
    const securityDeposit = Number(itemData.securityDeposit);
    const rentalAmount = days * pricePerDay;
    const serviceFee = Math.round(rentalAmount * 0.10);
    const grandTotal = rentalAmount + securityDeposit + serviceFee;

    // 1. Create record in Firestore rental_bookings collection
    const bookingDoc = await addDoc(collection(db, "rental_bookings"), {
      itemId: itemData.id,
      itemTitle: itemData.title || 'Outfit',
      itemImage: (itemData.images && itemData.images.length > 0) ? itemData.images[0] : '',
      ownerId: itemData.ownerId || 'Anonymous',
      renterId: user.uid,
      renterEmail: user.email || 'N/A',
      startDate: startDateStr,
      endDate: endDateStr,
      rentalDays: days,
      pricePerDay: pricePerDay,
      rentalAmount: rentalAmount,
      securityDeposit: securityDeposit,
      serviceFee: serviceFee,
      grandTotal: grandTotal,
      status: "pending_payment",
      createdAt: serverTimestamp()
    });

    msgEl.textContent = "Launching Razorpay Checkout...";

    // 2. Open Razorpay Modal
    openRazorpayCheckout({
      amount: grandTotal,
      bookingId: bookingDoc.id,
      itemTitle: itemData.title,
      userEmail: user.email,
      onSuccess: async (payResponse) => {
        // Update booking status in Firestore
        const bookingRef = doc(db, "rental_bookings", bookingDoc.id);
        await updateDoc(bookingRef, {
          status: "confirmed",
          paymentId: payResponse.razorpay_payment_id,
          paidAt: serverTimestamp()
        });

        // Add transaction log to payments collection
        await addDoc(collection(db, "payments"), {
          bookingId: bookingDoc.id,
          itemId: itemData.id,
          renterId: user.uid,
          amount: grandTotal,
          paymentId: payResponse.razorpay_payment_id,
          razorpayOrderId: payResponse.razorpay_order_id,
          status: "success",
          createdAt: serverTimestamp()
        });

        // Render Confirmation Receipt UI
        renderConfirmationReceipt({
          bookingId: bookingDoc.id,
          paymentId: payResponse.razorpay_payment_id,
          title: itemData.title,
          startDate: startDateStr,
          endDate: endDateStr,
          grandTotal: grandTotal
        });
      },
      onFailure: (err) => {
        msgEl.innerHTML = `⚠️ Payment not completed. Booking status remains pending. (${err.message || 'Cancelled'})`;
        bookNowBtn.disabled = false;
      }
    });

  } catch (error) {
    console.error("Booking submission error:", error);
    msgEl.textContent = "❌ Booking failed: " + error.message;
    bookNowBtn.disabled = false;
  }
}

// Render Confirmation Receipt UI inside bookingCardBox
function renderConfirmationReceipt({ bookingId, paymentId, title, startDate, endDate, grandTotal }) {
  const box = document.getElementById("bookingCardBox");
  box.innerHTML = `
    <div class="payment-success-card">
      <div class="success-icon-badge">
        <ion-icon name="checkmark-circle-sharp"></ion-icon>
      </div>
      <h2>Booking Confirmed!</h2>
      <p class="success-subtitle">Thank you! Your outfit has been reserved successfully.</p>
      
      <div class="receipt-details">
        <div class="receipt-row">
          <span>Booking ID:</span>
          <code>${bookingId}</code>
        </div>
        <div class="receipt-row">
          <span>Payment ID:</span>
          <code>${paymentId}</code>
        </div>
        <div class="receipt-row">
          <span>Item:</span>
          <strong>${title}</strong>
        </div>
        <div class="receipt-row">
          <span>Rental Period:</span>
          <span>${startDate} to ${endDate}</span>
        </div>
        <div class="receipt-row grand">
          <span>Amount Paid:</span>
          <span class="paid-amount">₹${grandTotal}</span>
        </div>
      </div>

      <div class="receipt-actions">
        <a href="browse.html" class="browse-more-btn">
          <ion-icon name="shirt-outline"></ion-icon> Browse More Clothes
        </a>
      </div>
    </div>
  `;
}

// Start on DOM ready
document.addEventListener("DOMContentLoaded", initItemDetails);
