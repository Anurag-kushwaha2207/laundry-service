// Razorpay Configuration & Integration Helper
// Obtain your Test Key ID from Razorpay Dashboard > Settings > API Keys
// Standard test Key ID format: rzp_test_xxxxxxxxxxxxxx

export const RAZORPAY_TEST_KEY = "rzp_test_laundry_demo_key"; 

/**
 * Open Razorpay Checkout Modal
 * @param {Object} options - Payment options (amount, currency, orderId, name, email, handler)
 */
export function openRazorpayCheckout({ amount, bookingId, itemTitle, userEmail, userPhone, onSuccess, onFailure }) {
  if (typeof Razorpay === "undefined") {
    alert("Razorpay SDK failed to load. Please check your internet connection.");
    if (onFailure) onFailure(new Error("SDK Not Loaded"));
    return;
  }

  const options = {
    key: RAZORPAY_TEST_KEY,
    amount: amount * 100, // Amount in paise (e.g. ₹500 = 50000 paise)
    currency: "INR",
    name: "Laundry & Rental Marketplace",
    description: `Payment for booking: ${itemTitle}`,
    image: "https://cdn-icons-png.flaticon.com/512/3159/3159066.png",
    handler: function (response) {
      console.log("Razorpay Payment Success:", response);
      if (onSuccess) {
        onSuccess({
          razorpay_payment_id: response.razorpay_payment_id || `pay_test_${Date.now()}`,
          razorpay_order_id: response.razorpay_order_id || `order_test_${Date.now()}`,
          razorpay_signature: response.razorpay_signature || "test_signature"
        });
      }
    },
    prefill: {
      name: "Valued Customer",
      email: userEmail || "customer@example.com",
      contact: userPhone || "9999999999"
    },
    notes: {
      booking_id: bookingId,
      marketplace: "P2P Laundry Rentals"
    },
    theme: {
      color: "#0284c7"
    },
    modal: {
      ondismiss: function () {
        console.log("Razorpay Modal Closed by user");
        if (onFailure) onFailure(new Error("Payment cancelled by user"));
      }
    }
  };

  const rzp = new Razorpay(options);
  
  // Custom fallback handler for demo mode if test key is non-live
  rzp.on('payment.failed', function (response){
    console.error("Razorpay Payment Failed:", response.error);
    if (onFailure) onFailure(response.error);
  });

  rzp.open();
}
