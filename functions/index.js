const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");

admin.initializeApp();

// Initialize Razorpay instance with Key & Secret
// Set keys via Firebase environment config:
// firebase functions:config:set razorpay.key_id="YOUR_KEY_ID" razorpay.key_secret="YOUR_KEY_SECRET"
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "rzp_test_laundry_demo_key";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "YOUR_RAZORPAY_KEY_SECRET";

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});

/**
 * Step 13: Order Creation Endpoint (Cloud Function)
 * Creates Razorpay order for both Laundry checkout & Rental booking
 */
exports.createRazorpayOrder = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { amount, currency = "INR", receipt, notes } = req.body;

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }

    const options = {
      amount: Math.round(amount * 100), // convert to paise
      currency: currency,
      receipt: receipt || `rec_${Date.now()}`,
      notes: notes || { flow: "laundry_rental" }
    };

    const order = await razorpay.orders.create(options);
    console.log("Razorpay Order Created:", order.id);

    res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (error) {
    console.error("Error creating Razorpay Order:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Step 16: Webhook / Signature Verification Endpoint
 * Verifies HMAC-SHA256 signature to prevent fraud
 */
exports.verifyRazorpayPayment = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId, orderType } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(body.toString())
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
      // Update status in Firestore
      if (orderType === "rental" && bookingId) {
        await admin.firestore().collection("rental_bookings").doc(bookingId).update({
          status: "confirmed",
          verifiedByWebhook: true,
          paymentId: razorpay_payment_id
        });
      }

      res.status(200).json({ success: true, message: "Payment verified successfully" });
    } else {
      res.status(400).json({ success: false, message: "Invalid payment signature" });
    }

  } catch (err) {
    console.error("Signature verification error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Step 17: Refund Deposit API (Cloud Function)
 * Initiates Razorpay Refund for rental security deposit
 */
exports.refundSecurityDeposit = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  try {
    const { paymentId, depositAmount, bookingId } = req.body;

    if (!paymentId || !depositAmount) {
      res.status(400).json({ error: "Missing paymentId or depositAmount" });
      return;
    }

    const refund = await razorpay.payments.refund(paymentId, {
      amount: Math.round(depositAmount * 100),
      notes: { bookingId: bookingId || "", type: "security_deposit_refund" }
    });

    // Log refund in Firestore
    if (bookingId) {
      await admin.firestore().collection("rental_bookings").doc(bookingId).update({
        depositRefunded: true,
        refundId: refund.id,
        refundedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.status(200).json({ success: true, refundId: refund.id });

  } catch (error) {
    console.error("Error processing refund:", error);
    res.status(500).json({ error: error.message });
  }
});
