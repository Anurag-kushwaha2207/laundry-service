let cart = {};
let totalAmount = 0;

// ================= CONFIGURATIONS =================
// 1. Firebase Configuration (Replace with your actual keys from Firebase Console)
const firebaseConfig = {
  apiKey: "AIzaSyAa4yo1eTO13cl0ARtmR7o3jcaBOMDCFB8",
  authDomain: "laundryservices-b99f1.firebaseapp.com",
  projectId: "laundryservices-b99f1",
  storageBucket: "laundryservices-b99f1.firebasestorage.app",
  messagingSenderId: "894893398993",
  appId: "1:894893398993:web:3d0a5cc37c86e330941ef0",
  measurementId: "G-9S0XTW0W1J"
};

// 2. EmailJS Configuration (Replace with your actual keys from EmailJS Dashboard)
const emailjsConfig = {
  serviceId: "service_zh1s3r6",
  bookingTemplateId: "template_prqcd1s", // Order Confirmation Template ID
  otpTemplateId: "template_3zqagfr", // OTP Template ID
  contactTemplateId: "YOUR_CONTACT_TEMPLATE_ID", // (Optional) Contact Form Template ID
  publicKey: "b-KsCTAjFBN6kqWvJ"
};

// ================= INITIALIZATION =================
let db = null;
let useCloud = false;
let useEmailJS = false;

// Initialize Firebase (Compat mode)
if (typeof firebase !== "undefined" && firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    useCloud = true;
    console.log("Firebase Firestore cloud database initialized successfully!");
  } catch (error) {
    console.error("Firebase initialization failed. Using LocalStorage Mock DB.", error);
    useCloud = false;
  }
} else {
  console.warn("Firebase script not loaded or config not set. Using LocalStorage Mock Cloud Database.");
  useCloud = false;
}

// Initialize EmailJS
if (typeof emailjs !== "undefined" && emailjsConfig.publicKey && emailjsConfig.publicKey !== "YOUR_PUBLIC_KEY") {
  try {
    emailjs.init(emailjsConfig.publicKey);
    useEmailJS = true;
    console.log("EmailJS initialized successfully!");
  } catch (error) {
    console.error("EmailJS initialization failed:", error);
    useEmailJS = false;
  }
} else {
  console.warn("EmailJS script not loaded or public key not set. Email notifications will be simulated.");
  useEmailJS = false;
}

// Global Auth State
let currentUser = null;
let tempAuthData = null;

// On Page Load
document.addEventListener("DOMContentLoaded", () => {
  // Restore active user session from browser cache
  const savedUser = localStorage.getItem("laundry_current_user");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    updateNavbarUser(currentUser.name);
    prefillCartForm();
  }
});

// ================= DATABASE HELPERS (Cloud / Mock Wrapper) =================
async function getCloudUser(email) {
  const cleanEmail = email.toLowerCase().trim();
  if (useCloud) {
    try {
      const docRef = db.collection("users").doc(cleanEmail);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        const cloudData = docSnap.data();
        // Merge bookings from local storage mock database to support instant UI updates
        const mockData = getMockUser(cleanEmail);
        if (mockData && mockData.bookings) {
          if (!cloudData.bookings) cloudData.bookings = [];
          const cloudBookingIds = new Set(cloudData.bookings.map(b => b.id));
          mockData.bookings.forEach(booking => {
            if (!cloudBookingIds.has(booking.id)) {
              cloudData.bookings.push(booking);
            }
          });
        }
        return cloudData;
      }
      return getMockUser(cleanEmail);
    } catch (e) {
      console.error("Error reading from Firestore:", e);
      return getMockUser(cleanEmail);
    }
  } else {
    return getMockUser(cleanEmail);
  }
}

async function saveCloudUser(email, userData) {
  const cleanEmail = email.toLowerCase().trim();
  if (useCloud) {
    try {
      await db.collection("users").doc(cleanEmail).set(userData);
    } catch (e) {
      console.error("Error writing to Firestore:", e);
      saveMockUser(cleanEmail, userData);
    }
  } else {
    saveMockUser(cleanEmail, userData);
  }
}

async function addCloudBooking(email, bookingData) {
  const cleanEmail = email.toLowerCase().trim();
  if (useCloud) {
    try {
      await db.collection("users").doc(cleanEmail).update({
        bookings: firebase.firestore.FieldValue.arrayUnion(bookingData)
      });
    } catch (e) {
      console.error("Error updating bookings in Firestore:", e);
      addMockBooking(cleanEmail, bookingData);
    }
  } else {
    addMockBooking(cleanEmail, bookingData);
  }
}

async function deleteCloudUser(email) {
  const cleanEmail = email.toLowerCase().trim();
  if (useCloud) {
    try {
      await db.collection("users").doc(cleanEmail).delete();
      console.log(`Cloud user document for ${cleanEmail} deleted.`);
    } catch (e) {
      console.error("Error deleting from Firestore:", e);
      deleteMockUser(cleanEmail);
    }
  } else {
    deleteMockUser(cleanEmail);
  }
}

function deleteMockUser(email) {
  const mockDB = JSON.parse(localStorage.getItem("_mock_cloud_db") || "{}");
  if (mockDB[email]) {
    delete mockDB[email];
    localStorage.setItem("_mock_cloud_db", JSON.stringify(mockDB));
  }
}

// Fallback Mock Cloud Database (Persists data in LocalStorage to simulate multiple device systems)
function getMockUser(email) {
  const mockDB = JSON.parse(localStorage.getItem("_mock_cloud_db") || "{}");
  return mockDB[email] || null;
}

function saveMockUser(email, userData) {
  const mockDB = JSON.parse(localStorage.getItem("_mock_cloud_db") || "{}");
  mockDB[email] = userData;
  localStorage.setItem("_mock_cloud_db", JSON.stringify(mockDB));
}

function addMockBooking(email, bookingData) {
  const mockDB = JSON.parse(localStorage.getItem("_mock_cloud_db") || "{}");
  if (mockDB[email]) {
    if (!mockDB[email].bookings) mockDB[email].bookings = [];
    mockDB[email].bookings.push(bookingData);
    localStorage.setItem("_mock_cloud_db", JSON.stringify(mockDB));
  }
}

// ================= EMAIL NOTIFICATION HELPERS =================
async function sendBookingEmail(name, email, phone, orderDetails, total, orderId) {
  console.log(`[Booking Email Request] To: ${name} <${email}>`);
  if (useEmailJS && typeof emailjs !== "undefined") {
    try {
      const templateParams = {
        from_name: name,
        customer_email: email,
        customer_phone: phone,
        order_details: orderDetails,
        total_amount: `₹${total}`,
        order_id: orderId
      };
      await emailjs.send(emailjsConfig.serviceId, emailjsConfig.bookingTemplateId, templateParams);
      console.log("EmailJS booking confirmation sent successfully!");
      return true;
    } catch (error) {
      console.error("Failed sending booking email through EmailJS:", error);
      return false;
    }
  }
  return false;
}

async function sendOTPEmail(name, email, otp) {
  console.log(`[OTP Email Request] To: ${name} <${email}> | OTP: ${otp}`);
  if (useEmailJS && typeof emailjs !== "undefined") {
    try {
      const templateId = (emailjsConfig.otpTemplateId && emailjsConfig.otpTemplateId !== "YOUR_OTP_TEMPLATE_ID") 
        ? emailjsConfig.otpTemplateId 
        : emailjsConfig.bookingTemplateId;

      let templateParams = {};
      if (templateId === emailjsConfig.bookingTemplateId) {
        // Reuse booking template structure for OTP delivery
        templateParams = {
          from_name: name,
          customer_email: email,
          customer_phone: "N/A",
          order_details: `🔑 Login / Verification OTP code is: ${otp}\n(Enter this code in the verification screen to authenticate.)`,
          total_amount: "N/A",
          order_id: "OTP-Verification"
        };
      } else {
        // Dedicated OTP template parameters
        templateParams = {
          to_name: name,
          to_email: email,
          otp_code: otp
        };
      }
      
      await emailjs.send(emailjsConfig.serviceId, templateId, templateParams);
      console.log("EmailJS OTP sent successfully!");
      return true;
    } catch (error) {
      console.error("Failed sending OTP email through EmailJS:", error);
      return false;
    }
  }
  return false;
}

// ================= ORIGINAL CART FUNCTIONALITY =================
function addToCart(name, price) {
  if (!cart[name]) {
    cart[name] = { price: price, qty: 1 };
  } else {
    cart[name].qty++;
  }
  renderCart();
}

function increaseQty(name) {
  cart[name].qty++;
  renderCart();
}

function decreaseQty(name) {
  cart[name].qty--;
  if (cart[name].qty <= 0) {
    delete cart[name];
  }
  renderCart();
}

function renderCart() {
  const cartList = document.getElementById("cartList");
  cartList.innerHTML = "";
  totalAmount = 0;

  if (Object.keys(cart).length === 0) {
    cartList.innerHTML = "<li>No Items Added</li>";
    document.getElementById("total").innerText = "0";
    return;
  }

  for (let item in cart) {
    const unitPrice = cart[item].price;
    const qty = cart[item].qty;
    const itemTotal = unitPrice * qty;

    let li = document.createElement("li");
    li.className = "cart-item";

    li.innerHTML = `
      <div class="cart-row">
        <span class="item-name">${item}</span>
        <span class="item-price">₹${itemTotal}</span>
        <div class="qty-controls">
          <button onclick="decreaseQty('${item}')">−</button>
          <span>${qty}</span>
          <button onclick="increaseQty('${item}')">+</button>
        </div>
      </div>
    `;

    cartList.appendChild(li);
    totalAmount += itemTotal;
  }

  document.getElementById("total").innerText = totalAmount;
}

// ================= USER AUTHENTICATION & LOGIN FLOW =================
function handleUsernameClick() {
  if (currentUser) {
    openDashboard();
  } else {
    switchAuthView('login');
    openModal('authModal');
  }
}

function switchAuthView(view) {
  document.getElementById("loginView").style.display = view === 'login' ? 'block' : 'none';
  document.getElementById("registerView").style.display = view === 'register' ? 'block' : 'none';
  document.getElementById("otpView").style.display = view === 'otp' ? 'block' : 'none';
}

function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

async function sendLoginOTP() {
  const email = document.getElementById("loginEmail").value.trim();
  
  if (!email || !validateEmail(email)) {
    alert("Please enter a valid Email ID.");
    return;
  }

  const user = await getCloudUser(email);
  if (!user) {
    alert("Email not registered! Switch to Create Account to sign up first.");
    switchAuthView('register');
    document.getElementById("regEmail").value = email;
    return;
  }

  // Generate 6-digit random OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  tempAuthData = {
    name: user.name,
    email: user.email,
    phone: user.phone,
    otp: otp,
    isRegistering: false
  };

  // Send actual email via EmailJS
  await sendOTPEmail(user.name, user.email, otp);

  document.getElementById("otpSubtitle").innerText = `We sent a login OTP code to: ${user.email}`;
  switchAuthView('otp');
}

async function sendRegisterOTP() {
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const phone = document.getElementById("regPhone").value.trim();

  if (!name) {
    alert("Please enter your Full Name.");
    return;
  }
  if (!email || !validateEmail(email)) {
    alert("Please enter a valid Email ID.");
    return;
  }
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit Phone Number.");
    return;
  }

  const existingUser = await getCloudUser(email);
  if (existingUser) {
    alert("Account already exists with this Email! Please login instead.");
    switchAuthView('login');
    document.getElementById("loginEmail").value = email;
    return;
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  tempAuthData = {
    name: name,
    email: email,
    phone: phone,
    otp: otp,
    isRegistering: true
  };

  // Send actual email via EmailJS
  await sendOTPEmail(name, email, otp);

  document.getElementById("otpSubtitle").innerText = `We sent a registration OTP code to: ${email}`;
  switchAuthView('otp');
}

async function verifyOTPCode() {
  const enteredOtp = document.getElementById("otpCode").value.trim();
  if (!enteredOtp || enteredOtp.length !== 6) {
    alert("Please enter the 6-digit OTP code.");
    return;
  }

  if (enteredOtp !== tempAuthData.otp) {
    alert("Incorrect OTP. Please enter the correct code.");
    return;
  }

  // Clear OTP input field
  document.getElementById("otpCode").value = "";

  const oldEmail = currentUser ? currentUser.email.toLowerCase().trim() : "";

  if (tempAuthData.isProfileEdit) {
    // 1. Fetch bookings from the old account
    const oldUser = await getCloudUser(oldEmail);
    const bookings = (oldUser && oldUser.bookings) ? oldUser.bookings : [];

    // 2. Create the new user record under new email
    const updatedProfile = {
      name: tempAuthData.name,
      email: tempAuthData.email.toLowerCase().trim(),
      phone: tempAuthData.phone,
      bookings: bookings
    };
    await saveCloudUser(tempAuthData.email, updatedProfile);

    // 3. Delete the old user document
    if (oldEmail && oldEmail !== tempAuthData.email.toLowerCase().trim()) {
      await deleteCloudUser(oldEmail);
    }

    currentUser = { name: tempAuthData.name, email: tempAuthData.email.toLowerCase().trim(), phone: tempAuthData.phone };
    
    // Reset dashboard static fields just in case they open it again
    document.getElementById("profileName").innerText = currentUser.name;
    document.getElementById("profileEmail").innerText = currentUser.email;
    document.getElementById("profilePhone").innerText = currentUser.phone;
    cancelProfileEdit();
  } else {
    if (tempAuthData.isRegistering) {
      const newUser = {
        name: tempAuthData.name,
        email: tempAuthData.email.toLowerCase(),
        phone: tempAuthData.phone,
        bookings: []
      };
      await saveCloudUser(tempAuthData.email, newUser);
      currentUser = { name: tempAuthData.name, email: tempAuthData.email.toLowerCase(), phone: tempAuthData.phone };
    } else {
      currentUser = { name: tempAuthData.name, email: tempAuthData.email.toLowerCase(), phone: tempAuthData.phone };
    }
  }

  // Persist session locally on this device
  localStorage.setItem("laundry_current_user", JSON.stringify(currentUser));
  
  updateNavbarUser(currentUser.name);
  prefillCartForm();
  closeModal('authModal');

  alert(`Welcome, ${currentUser.name}! Details verified and saved.`);
}

function cancelOTP() {
  if (tempAuthData.isRegistering) {
    switchAuthView('register');
  } else {
    switchAuthView('login');
  }
}

function updateNavbarUser(name) {
  const navUsername = document.getElementById("navUsername");
  if (navUsername) {
    navUsername.innerText = name;
  }
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem("laundry_current_user");
  updateNavbarUser("Username");
  
  // Clear cart prefill inputs
  const cartName = document.getElementById("cartName");
  const cartEmail = document.getElementById("cartEmail");
  const cartPhone = document.getElementById("cartPhone");
  if (cartName) cartName.value = "";
  if (cartEmail) cartEmail.value = "";
  if (cartPhone) cartPhone.value = "";

  closeModal('dashboardModal');
  alert("You have logged out successfully.");
}

// ================= DASHBOARD & BOOKINGS HISTORY =================
async function openDashboard() {
  if (!currentUser) return;

  document.getElementById("profileName").innerText = currentUser.name;
  document.getElementById("profileEmail").innerText = currentUser.email;
  document.getElementById("profilePhone").innerText = currentUser.phone;

  const historyContainer = document.getElementById("historyContainer");
  historyContainer.innerHTML = "<p class='no-history'>Loading history from cloud...</p>";
  
  openModal('dashboardModal');

  const user = await getCloudUser(currentUser.email);
  const bookings = (user && user.bookings) ? user.bookings : [];

  if (bookings.length === 0) {
    historyContainer.innerHTML = "<p class='no-history'>No bookings found.</p>";
    return;
  }

  historyContainer.innerHTML = "";
  const sortedBookings = [...bookings].reverse(); // Newest first

  sortedBookings.forEach((order) => {
    const card = document.createElement("div");
    card.className = "history-item-card";

    let itemsHtml = "";
    for (let itName in order.items) {
      const itemQty = order.items[itName].qty;
      const itemPrice = order.items[itName].price;
      itemsHtml += `<div>• ${itName} x ${itemQty} (₹${itemPrice * itemQty})</div>`;
    }

    card.innerHTML = `
      <div class="history-header">
        <span class="history-date">📅 ${order.date}</span>
        <span>Order ID: #${order.id}</span>
      </div>
      <div class="history-body">
        ${itemsHtml}
      </div>
      <div class="history-footer">
        <span class="history-total">Total: ₹${order.total}</span>
        <span class="history-status">${order.status || 'Received'}</span>
      </div>
    `;
    historyContainer.appendChild(card);
  });
}

function prefillCartForm() {
  if (currentUser) {
    const cartName = document.getElementById("cartName");
    const cartEmail = document.getElementById("cartEmail");
    const cartPhone = document.getElementById("cartPhone");
    if (cartName) cartName.value = currentUser.name;
    if (cartEmail) cartEmail.value = currentUser.email;
    if (cartPhone) cartPhone.value = currentUser.phone;
  }
}

// ================= EDIT PROFILE DYNAMICS =================
function enableProfileEdit() {
  if (!currentUser) return;
  document.getElementById("editName").value = currentUser.name;
  document.getElementById("editEmail").value = currentUser.email;
  document.getElementById("editPhone").value = currentUser.phone;

  document.getElementById("profileDisplay").style.display = "none";
  document.getElementById("profileEditForm").style.display = "block";
}

function cancelProfileEdit() {
  document.getElementById("profileDisplay").style.display = "block";
  document.getElementById("profileEditForm").style.display = "none";
}

async function saveProfileChanges() {
  const name = document.getElementById("editName").value.trim();
  const email = document.getElementById("editEmail").value.trim();
  const phone = document.getElementById("editPhone").value.trim();

  if (!name) {
    alert("Please enter a name.");
    return;
  }
  if (!email || !validateEmail(email)) {
    alert("Please enter a valid Email ID.");
    return;
  }
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit Phone Number.");
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const oldEmail = currentUser.email.toLowerCase().trim();

  // If email is NOT changed, save immediately
  if (cleanEmail === oldEmail) {
    const user = await getCloudUser(oldEmail);
    const bookings = (user && user.bookings) ? user.bookings : [];
    
    const updatedProfile = {
      name: name,
      email: cleanEmail,
      phone: phone,
      bookings: bookings
    };
    
    await saveCloudUser(cleanEmail, updatedProfile);
    
    currentUser = { name: name, email: cleanEmail, phone: phone };
    localStorage.setItem("laundry_current_user", JSON.stringify(currentUser));
    
    updateNavbarUser(name);
    prefillCartForm();
    cancelProfileEdit();
    
    document.getElementById("profileName").innerText = name;
    document.getElementById("profileEmail").innerText = cleanEmail;
    document.getElementById("profilePhone").innerText = phone;
    
    alert("Profile details updated successfully!");
    return;
  }

  // If email IS changed, verify with OTP first!
  const existingUser = await getCloudUser(cleanEmail);
  if (existingUser) {
    alert("An account already exists with this new email. Please choose a different email.");
    return;
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  tempEditData = {
    name: name,
    email: cleanEmail,
    phone: phone,
    otp: otp
  };

  // Send OTP to new email address
  await sendOTPEmail(name, cleanEmail, otp);

  // Prep tempAuthData for verification Modal
  tempAuthData = {
    name: name,
    email: cleanEmail,
    phone: phone,
    otp: otp,
    isRegistering: false,
    isProfileEdit: true
  };

  closeModal('dashboardModal');
  document.getElementById("otpSubtitle").innerText = `We sent a verification code to your new email: ${cleanEmail}`;
  switchAuthView('otp');
  openModal('authModal');
}

// ================= SUBMIT BOOKING (Integrated with Cloud DB & EmailJS) =================
async function submitBooking() {
  const name = document.getElementById("cartName").value.trim();
  const email = document.getElementById("cartEmail").value.trim();
  const phone = document.getElementById("cartPhone").value.trim();

  if (Object.keys(cart).length === 0) {
    alert("Your cart is empty. Please add laundry items to book.");
    return;
  }

  if (!name) {
    alert("Please enter your Full Name.");
    return;
  }
  if (!email || !validateEmail(email)) {
    alert("Please enter a valid Email ID.");
    return;
  }
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit Phone Number.");
    return;
  }

  const targetEmail = email.toLowerCase().trim();
  const bookingDate = new Date();
  const formattedDate = bookingDate.toLocaleDateString() + " " + bookingDate.toLocaleTimeString();
  const bookingId = Math.floor(100000 + Math.random() * 900000);
  const totalBill = totalAmount; // Snapshot total before clearing cart

  const newBooking = {
    id: bookingId,
    date: formattedDate,
    items: JSON.parse(JSON.stringify(cart)),
    total: totalBill,
    status: "Received"
  };

  // 1. Instantly save booking to local mock database for immediate availability
  let localUser = getMockUser(targetEmail);
  if (!localUser) {
    localUser = {
      name: name,
      email: targetEmail,
      phone: phone,
      bookings: [newBooking]
    };
    saveMockUser(targetEmail, localUser);
  } else {
    addMockBooking(targetEmail, newBooking);
  }

  // 2. Instantly update current session user & sync storage
  if (currentUser && currentUser.email.toLowerCase().trim() === targetEmail) {
    prefillCartForm();
  } else {
    currentUser = { name: name, email: targetEmail, phone: phone };
    localStorage.setItem("laundry_current_user", JSON.stringify(currentUser));
    updateNavbarUser(name);
    prefillCartForm();
  }

  // 3. Instantly clear cart & update UI
  cart = {};
  renderCart();

  // 4. Instantly open Success Modal
  document.getElementById("successEmail").innerText = targetEmail;
  openModal('successModal');

  // 5. Asynchronously (in background) sync with Cloud database (Firestore) and send EmailJS confirmation
  (async () => {
    try {
      if (useCloud && db) {
        const docRef = db.collection("users").doc(targetEmail);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          // Auto-create cloud account for new user during booking
          await docRef.set({
            name: name,
            email: targetEmail,
            phone: phone,
            bookings: [newBooking]
          });
          console.log("New user registered in cloud database during background booking.");
        } else {
          // Add booking to existing cloud user
          await docRef.update({
            bookings: firebase.firestore.FieldValue.arrayUnion(newBooking)
          });
          console.log("Booking synced to cloud database in background.");
        }
      }
    } catch (error) {
      console.error("Background cloud database sync failed:", error);
    }

    // Build email notification order summary string
    let orderSummary = "";
    for (let item in newBooking.items) {
      const qty = newBooking.items[item].qty;
      const price = newBooking.items[item].price;
      orderSummary += `🧺 ${item} x ${qty} (₹${price * qty})\n\n`;
    }
    orderSummary = orderSummary.trim();

    // Send email confirmation via EmailJS in background
    try {
      const sent = await sendBookingEmail(name, targetEmail, phone, orderSummary, totalBill, bookingId);
      if (sent) {
        console.log("Confirmation email sent in background!");
      } else {
        console.warn("Background confirmation email failed to send.");
      }
    } catch (emailError) {
      console.error("Failed sending background email:", emailError);
    }
  })();
}


// Helpers
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.toLowerCase());
}

// ================= CONTACT FORM SUBMISSION =================
async function handleContactSubmit(event) {
  event.preventDefault();

  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const message = document.getElementById("contactMessage").value.trim();

  if (!name || !email || !message) {
    alert("Please fill in all fields.");
    return;
  }

  const submitBtn = document.getElementById("contactSubmitBtn");
  const originalBtnText = submitBtn.innerText;
  submitBtn.innerText = "Sending...";
  submitBtn.disabled = true;

  try {
    if (useEmailJS && typeof emailjs !== "undefined") {
      // Use contactTemplateId if set, otherwise try to reuse bookingTemplateId
      const templateId = (emailjsConfig.contactTemplateId && emailjsConfig.contactTemplateId !== "YOUR_CONTACT_TEMPLATE_ID")
        ? emailjsConfig.contactTemplateId
        : emailjsConfig.bookingTemplateId;

      let templateParams = {};
      if (templateId === emailjsConfig.bookingTemplateId) {
        // Reuse booking template structure for Contact message
        templateParams = {
          from_name: name,
          customer_email: email,
          customer_phone: "N/A",
          order_details: `💬 Contact Form Message:\n\n${message}`,
          total_amount: "N/A",
          order_id: "Contact-Message"
        };
      } else {
        // Dedicated contact template parameters (configured in EmailJS dashboard)
        templateParams = {
          from_name: name,
          from_email: email,
          message: message
        };
      }

      await emailjs.send(emailjsConfig.serviceId, templateId, templateParams);
      console.log("Contact form email sent successfully!");
    } else {
      console.log(`[Contact Form Message (Simulated)] From: ${name} <${email}> | Message: ${message}`);
    }

    alert("Your message has been sent successfully!");
    document.getElementById("contactForm").reset();
  } catch (error) {
    console.error("Failed to send contact message via EmailJS:", error);
    alert("Failed to send message. Please check your network and try again.");
  } finally {
    submitBtn.innerText = originalBtnText;
    submitBtn.disabled = false;
  }
}