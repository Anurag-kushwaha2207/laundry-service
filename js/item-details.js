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

// Helper: Get Active Logged-in User from Session / Auth
function getActiveUser() {
  const savedUser = localStorage.getItem("laundry_current_user");
  if (savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && (parsed.email || parsed.phone || parsed.name)) {
        return parsed;
      }
    } catch (e) {
      console.warn("Error parsing local user session:", e);
    }
  }

  if (auth.currentUser) {
    return {
      uid: auth.currentUser.uid,
      name: auth.currentUser.displayName || "Customer",
      email: auth.currentUser.email || "",
      phone: auth.currentUser.phoneNumber || ""
    };
  }

  return null;
}

// Initialize Item Details Page
async function initItemDetails() {
  if (!itemId) {
    wrapper.innerHTML = `
      <div class="error-box full-width">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <h3>No outfit specified</h3>
        <p>Please select an outfit from the <a href="browse.html">Rental Marketplace</a>.</p>
      </div>
    `;
    return;
  }

  try {
    // 1. Fetch Item Document from Firestore
    const itemDocRef = doc(db, "rental_items", itemId);
    const itemSnap = await getDoc(itemDocRef);

    if (!itemSnap.exists()) {
      wrapper.innerHTML = `
        <div class="error-box full-width">
          <ion-icon name="shirt-outline"></ion-icon>
          <h3>Outfit not found</h3>
          <p>This rental listing does not exist or has been removed from the marketplace.</p>
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
        <p>❌ Error loading outfit details: ${error.message}</p>
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
      if (bData.status && bData.status !== "cancelled") {
        existingBookings.push(bData);
      }
    });
  } catch (err) {
    console.warn("Could not fetch existing bookings:", err);
  }
}

// Render Item Details & Booking Form
function renderItemPage() {
  const activeUser = getActiveUser();

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

        ${activeUser ? `
          <div class="active-user-badge">
            <ion-icon name="person-circle-outline" style="font-size: 22px; color: #16a34a;"></ion-icon>
            <span>Booking as: <strong>${activeUser.name || 'Valued Customer'}</strong> (${activeUser.email || activeUser.phone || 'Active Session'})</span>
          </div>
        ` : `
          <div class="login-alert-badge">
            <ion-icon name="alert-circle-outline" style="font-size: 22px; color: #d97706;"></ion-icon>
            <span>You are not logged in. <a href="../index.html">Please log in from Home</a> to complete your rental booking.</span>
          </div>
        `}

        <h3><ion-icon name="calendar-outline"></ion-icon> Select Rental Dates</h3>
        <form id="bookingForm">
          <div class="date-picker-grid">
            <div class="date-input-group">
              <label for="startDate">Rental Start Date</label>
              <input type="date" id="startDate" min="${todayStr}" value="${todayStr}" required>
            </div>
            <div class="date-input-group">
              <label for="endDate">Rental Return Date</label>
              <input type="date" id="endDate" min="${todayStr}" value="${tomorrowStr}" required>
            </div>
          </div>

          <div id="availabilityNotice" class="availability-notice"></div>

          <!-- Modern Delivery Address & Contact Section -->
          <div class="delivery-address-section" style="margin-top: 22px; padding-top: 18px; border-top: 1px solid #e2e8f0;">
            <h4 style="font-size: 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; color: #0f172a; font-weight: 700;">
              <ion-icon name="location-outline" style="color: #0284c7; font-size: 22px;"></ion-icon>
              Delivery Address & Contact Details
            </h4>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
              <div>
                <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">Recipient Full Name *</label>
                <input type="text" id="renterName" required placeholder="e.g. Anurag Singh" value="${activeUser ? (activeUser.name || '') : ''}" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
              </div>
              <div>
                <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">Mobile / WhatsApp Number *</label>
                <input type="tel" id="renterPhone" required placeholder="e.g. 9837101838" value="${activeUser ? (activeUser.phone || '') : ''}" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
              </div>
            </div>

            <div style="margin-bottom: 12px;">
              <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">House / Flat No., Building & Street Address *</label>
              <textarea id="deliveryAddress" required rows="2" placeholder="e.g. Flat 302, Shanti Kunj, Near Civil Lines Post Office, Station Road" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-family: inherit; box-sizing: border-box; resize: vertical;"></textarea>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
              <div>
                <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">City / Town *</label>
                <input type="text" id="deliveryCity" required placeholder="e.g. Etawah, Kanpur, Delhi" value="${itemData.city || ''}" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
              </div>
              <div>
                <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">Pincode *</label>
                <input type="text" id="deliveryPincode" required placeholder="e.g. 206001" pattern="[0-9]{6}" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
              </div>
            </div>

            <div style="margin-bottom: 15px;">
              <label style="font-size: 12px; font-weight: 600; color: #475569; display: block; margin-bottom: 5px;">Delivery Notes / Landmark (Optional)</label>
              <input type="text" id="deliveryNotes" placeholder="e.g. Near Big Water Tank, deliver between 10 AM - 2 PM" style="width: 100%; padding: 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; box-sizing: border-box;">
            </div>
          </div>

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
              <span>Security Deposit (100% Refundable)</span>
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
            <ion-icon name="card-outline"></ion-icon> <span>Pay Now with Razorpay</span>
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
    noticeEl.innerHTML = "⚠️ Return date must be on or after start date.";
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
    noticeEl.innerHTML = "⚠️ This outfit is already reserved for these dates. Please choose different dates.";
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

  const activeUser = getActiveUser();
  if (!activeUser) {
    alert("⚠️ Please log in from the Home page before proceeding to payment!");
    window.location.href = "../index.html";
    return;
  }

  const renterName = document.getElementById("renterName").value.trim();
  const renterPhone = document.getElementById("renterPhone").value.trim();
  const deliveryAddress = document.getElementById("deliveryAddress").value.trim();
  const deliveryCity = document.getElementById("deliveryCity").value.trim();
  const deliveryPincode = document.getElementById("deliveryPincode").value.trim();
  const deliveryNotes = document.getElementById("deliveryNotes").value.trim();

  if (!renterName || !renterPhone || !deliveryAddress || !deliveryCity || !deliveryPincode) {
    alert("⚠️ Please fill in complete delivery address and contact details!");
    return;
  }

  msgEl.textContent = "Creating booking reservation...";
  bookNowBtn.disabled = true;

  try {
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
      itemTitle: itemData.title || 'Rental Outfit',
      itemImage: (itemData.images && itemData.images.length > 0) ? itemData.images[0] : '',
      itemCategory: itemData.category || 'Outfit',
      itemSize: itemData.size || 'Free Size',
      
      // Owner Details
      ownerId: itemData.ownerId || 'Anonymous',
      ownerName: itemData.ownerName || 'Outfit Owner',
      ownerPhone: itemData.ownerPhone || '',
      ownerEmail: itemData.ownerEmail || '',
      ownerCity: itemData.city || 'India',

      // Renter Details & Delivery Address
      renterId: activeUser.uid || activeUser.email || 'customer',
      renterName: renterName,
      renterEmail: activeUser.email || '',
      renterPhone: renterPhone,
      deliveryAddress: deliveryAddress,
      deliveryCity: deliveryCity,
      deliveryPincode: deliveryPincode,
      deliveryNotes: deliveryNotes,

      // Pricing & Dates
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

    msgEl.textContent = "Opening Razorpay secure payment gateway...";

    // 2. Open Razorpay Modal
    openRazorpayCheckout({
      amount: grandTotal,
      bookingId: bookingDoc.id,
      itemTitle: itemData.title,
      userEmail: activeUser.email,
      userPhone: renterPhone,
      onSuccess: async (payResponse) => {
        // Update booking status in Firestore to confirmed
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
          renterId: activeUser.uid || activeUser.email || 'customer',
          renterName: renterName,
          amount: grandTotal,
          paymentId: payResponse.razorpay_payment_id,
          razorpayOrderId: payResponse.razorpay_order_id || '',
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
          grandTotal: grandTotal,
          deliveryAddress: `${deliveryAddress}, ${deliveryCity} - ${deliveryPincode}`,
          renterName: renterName,
          renterPhone: renterPhone
        });
      },
      onFailure: (err) => {
        console.warn("Razorpay payment failure notice:", err);
        msgEl.innerHTML = `⚠️ Payment not completed (${err.message || 'Cancelled by user'}). Booking remains saved in pending status.`;
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
function renderConfirmationReceipt({ bookingId, paymentId, title, startDate, endDate, grandTotal, deliveryAddress, renterName, renterPhone }) {
  const box = document.getElementById("bookingCardBox");
  box.innerHTML = `
    <div class="payment-success-card">
      <div class="success-icon-badge">
        <ion-icon name="checkmark-circle-sharp"></ion-icon>
      </div>
      <h2>Booking Confirmed!</h2>
      <p class="success-subtitle">Thank you ${renterName}! Your outfit has been reserved and scheduled for delivery.</p>
      
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
          <span>Outfit:</span>
          <strong>${title}</strong>
        </div>
        <div class="receipt-row">
          <span>Rental Dates:</span>
          <span>${startDate} to ${endDate}</span>
        </div>
        <div class="receipt-row">
          <span>Delivery Address:</span>
          <span style="text-align: right; max-width: 60%;">${deliveryAddress}</span>
        </div>
        <div class="receipt-row">
          <span>Contact:</span>
          <span>${renterPhone}</span>
        </div>
        <div class="receipt-row grand">
          <span>Total Paid:</span>
          <span class="paid-amount">₹${grandTotal}</span>
        </div>
      </div>

      <div class="receipt-actions" style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
        <a href="browse.html" class="browse-more-btn">
          <ion-icon name="shirt-outline"></ion-icon> Browse More Clothes
        </a>
      </div>
    </div>
  `;
}

// Start on DOM ready
document.addEventListener("DOMContentLoaded", initItemDetails);
