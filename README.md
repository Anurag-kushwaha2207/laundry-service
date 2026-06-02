# 🧺 Premium Laundry & Dry Cleaning Services

A state-of-the-art, fully responsive web application for online laundry and dry cleaning bookings. Built with modern UI aesthetics, dynamic cart functionality, secure Email OTP verification, Firebase Firestore cloud storage, and automated email confirmation notifications.

🔗 **Live Website Demo**: [https://laundryservices-b99f1.web.app](https://laundryservices-b99f1.web.app)

---

## ✨ Key Features

* **Premium UI/UX Design**: Harmonious color palettes (tailored blues & whites), modern typography, subtle micro-animations, custom modals, and complete mobile responsiveness.
* **Interactive Shopping Cart**: Add, increase, decrease, or remove service items (Dry Cleaning, Ironing, Blanket Wash, etc.) with real-time bill calculations.
* **Instant Non-Blocking Checkout**: Clicking "Book Now" instantly clears the cart and launches the Success Modal, processing the database saves and email confirmation dispatches in the background to ensure zero UI lag.
* **Multi-Device Synchronization**: Log in from any laptop or mobile device. User credentials and order histories are safely fetched and synced using **Firebase Firestore**.
* **Offline Fallback Architecture**: Seamlessly degrades to a `localStorage` mock database if Firebase CDN scripts are blocked, ensuring the app remains 100% functional.
* **Secure Email OTP Authentication**: Uses **EmailJS** to deliver 6-digit verification codes for user registration, logins, and profile email changes.
* **User Profile & History Dashboard**: 
  * Edit profile details (Name, Phone, and Email with verification OTP).
  * Check past bookings, status details, and order dates in real time.
* **Send Message Contact Form**: Fully integrated contact section for customer support queries with automated email delivery.

---

## 🛠️ Technology Stack

* **Frontend**: HTML5 (Semantic Structure), CSS3 (Custom Variables, Flexbox, Grid, Glassmorphic overlays)
* **Logic & Authentication**: Vanilla JavaScript (ES6+, Async/Await)
* **Cloud Database**: Firebase Firestore (Compat SDK)
* **Email Notifications**: EmailJS API
* **Icons**: Ionicons

---

## 🚀 Setup & Installation

Follow these steps to run the project locally or deploy it:

### 1. Clone the Repository
```bash
git clone https://github.com/Anurag-kushwaha2207/laundry-service.git
cd laundry-service
```

### 2. Configure Credentials
Open `script.js` and update your Firebase and EmailJS keys:
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const emailjsConfig = {
  serviceId: "YOUR_SERVICE_ID",
  bookingTemplateId: "YOUR_BOOKING_TEMPLATE_ID",
  otpTemplateId: "YOUR_OTP_TEMPLATE_ID",
  contactTemplateId: "YOUR_CONTACT_TEMPLATE_ID",
  publicKey: "YOUR_PUBLIC_KEY"
};
```

### 3. Database Rules (Firebase Console)
Make sure your Cloud Firestore database rules are set to public/test mode so the frontend client can perform database operations:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### 4. Deploy to Firebase Hosting
Deploy your changes to live hosting in two simple commands:
```bash
npx firebase-tools login
npx firebase-tools deploy
```

---

## 👨‍💻 Author

* **Anurag Kushwaha**
* **GitHub**: [@Anurag-kushwaha2207](https://github.com/Anurag-kushwaha2207)
* **YouTube**: [@AnuragTalkies](https://www.youtube.com/@AnuragTalkies)
