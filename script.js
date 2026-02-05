let cart = {};
let totalAmount = 0;

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

        <!-- ✅ THIS IS THE FIX -->
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
} // js 