import {
  doc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  db,
  formatRupiah,
  handleFirestoreError,
  INVENTORY_DOC_ID,
  OperationType,
  ORDER_CODE_PATTERN,
  REGION_META,
  testConnection,
  UNIT_PRICE,
  WHATSAPP_NUMBER,
  WHATSAPP_PATTERN,
  type InventoryState,
  type PaymentMethod,
  type ShippingRegion,
  type ShirtSize,
} from './firebase-core';

void testConnection();

let currentInventory: InventoryState = {
  stockM: 50,
  stockL: 50,
  stockXL: 50,
  unitPrice: UNIT_PRICE,
};
let inventoryLoaded = false;
let seedAttempted = false;

let selectedSize: ShirtSize = 'L';
let qty = 1;
let selectedRegion: ShippingRegion = 'jabodetabek_jabar';
let selectedPayment: PaymentMethod = 'QRIS';

function getStockForSize(size: ShirtSize): number {
  if (size === 'M') return currentInventory.stockM;
  if (size === 'L') return currentInventory.stockL;
  return currentInventory.stockXL;
}

function updateTotalUI(): void {
  const qtyEl = document.getElementById('qty-value');
  const totalEl = document.getElementById('total-price');
  const maxForSize = Math.min(10, Math.max(0, getStockForSize(selectedSize)));

  if (maxForSize > 0 && qty > maxForSize) {
    qty = maxForSize;
  } else if (maxForSize === 0) {
    qty = 1;
  }

  if (qtyEl) qtyEl.textContent = String(qty);
  if (totalEl) totalEl.textContent = formatRupiah(qty * UNIT_PRICE);
}

function applySelectedSize(size: ShirtSize): void {
  const stockForTarget = getStockForSize(size);
  if (inventoryLoaded && stockForTarget <= 0) {
    const fallback = (['M', 'L', 'XL'] as ShirtSize[]).find((s) => getStockForSize(s) > 0);
    selectedSize = fallback || size;
  } else {
    selectedSize = size;
  }

  const sizeButtons = document.querySelectorAll<HTMLButtonElement>('.size-btn');
  sizeButtons.forEach((btn) => {
    const btnSize = btn.getAttribute('data-size') as ShirtSize | null;
    if (!btnSize) return;
    const stock = getStockForSize(btnSize);
    const outOfStock = inventoryLoaded && stock <= 0;
    const active = btnSize === selectedSize && !outOfStock;

    btn.disabled = outOfStock;
    btn.setAttribute('aria-checked', String(active));
    btn.classList.toggle('bg-ink', active);
    btn.classList.toggle('border-ink', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-canvas', !active);
    btn.classList.toggle('border-hairline', !active);
    btn.classList.toggle('text-ink', !active);
    btn.classList.toggle('opacity-45', outOfStock);
    btn.classList.toggle('cursor-not-allowed', outOfStock);

    const stockSpan = btn.querySelector<HTMLElement>('[data-stock-badge]');
    if (stockSpan) {
      stockSpan.textContent = outOfStock ? 'Habis' : `Sisa ${stock}`;
      stockSpan.classList.toggle('text-zinc-300', active);
      stockSpan.classList.toggle('text-ash', !active && !outOfStock);
      stockSpan.classList.toggle('text-crimson', outOfStock);
    }
  });

  updateTotalUI();
}

function renderInventoryUI(): void {
  const totalRemaining =
    currentInventory.stockM + currentInventory.stockL + currentInventory.stockXL;

  const heroQuotaEl = document.getElementById('hero-remaining-quota');
  if (heroQuotaEl) {
    heroQuotaEl.textContent = `${totalRemaining} / 150 Pcs`;
  }

  const orderQuotaEl = document.getElementById('order-remaining-badge');
  if (orderQuotaEl) {
    orderQuotaEl.textContent =
      totalRemaining > 0
        ? `Batch 01 Tersisa ${totalRemaining} Pcs (M: ${currentInventory.stockM} · L: ${currentInventory.stockL} · XL: ${currentInventory.stockXL})`
        : 'Batch 01 Habis Terjual';
  }

  const submitBtn = document.getElementById('order-submit-btn') as HTMLButtonElement | null;
  if (submitBtn) {
    const anyAvailable = totalRemaining > 0;
    submitBtn.disabled = !anyAvailable;
    if (!anyAvailable) {
      submitBtn.textContent = 'Kuota Batch 01 Habis';
    } else if (!submitBtn.dataset.loading) {
      submitBtn.textContent = 'Konfirmasi Pesanan Edisi Perdana';
    }
  }

  applySelectedSize(selectedSize);
}

function syncRegionAndPaymentUI(): void {
  const meta = REGION_META[selectedRegion];
  const etaEl = document.getElementById('shipping-eta-text');
  const noteEl = document.getElementById('shipping-method-note');
  const codNoticeEl = document.getElementById('cod-unavailable-note');

  if (etaEl) etaEl.textContent = meta.eta;
  if (noteEl) noteEl.textContent = meta.shippingNote;

  const paymentButtons = document.querySelectorAll<HTMLButtonElement>('.payment-btn');
  if (!meta.codAllowed && selectedPayment === 'COD') {
    selectedPayment = 'QRIS';
    if (codNoticeEl) codNoticeEl.classList.remove('hidden');
  } else if (codNoticeEl) {
    codNoticeEl.classList.toggle('hidden', meta.codAllowed);
  }

  paymentButtons.forEach((btn) => {
    const method = btn.getAttribute('data-payment') as PaymentMethod | null;
    if (!method) return;
    const isCodBlocked = method === 'COD' && !meta.codAllowed;
    const active = method === selectedPayment && !isCodBlocked;

    btn.disabled = isCodBlocked;
    btn.setAttribute('aria-checked', String(active));
    btn.classList.toggle('bg-ink', active);
    btn.classList.toggle('border-ink', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-canvas', !active);
    btn.classList.toggle('border-hairline', !active);
    btn.classList.toggle('text-ink', !active);
    btn.classList.toggle('opacity-45', isCodBlocked);
    btn.classList.toggle('cursor-not-allowed', isCodBlocked);
  });
}

async function seedInitialInventoryIfNeeded(): Promise<void> {
  if (seedAttempted) return;
  seedAttempted = true;
  const invPath = `inventory/${INVENTORY_DOC_ID}`;
  try {
    await setDoc(doc(db, 'inventory', INVENTORY_DOC_ID), {
      stockM: 50,
      stockL: 50,
      stockXL: 50,
      unitPrice: UNIT_PRICE,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    try {
      const recheck = await getDocFromServer(doc(db, 'inventory', INVENTORY_DOC_ID));
      if (recheck.exists()) return;
    } catch {
      // Lanjut lapor ke handleFirestoreError
    }
    handleFirestoreError(error, OperationType.CREATE, invPath);
  }
}

function subscribeInventory(): void {
  const invRef = doc(db, 'inventory', INVENTORY_DOC_ID);
  const invPath = `inventory/${INVENTORY_DOC_ID}`;

  onSnapshot(
    invRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        void seedInitialInventoryIfNeeded().catch((err) => {
          console.error('Gagal menginisialisasi stok awal:', err);
        });
        return;
      }

      const data = snapshot.data();
      currentInventory = {
        stockM: typeof data.stockM === 'number' ? data.stockM : 0,
        stockL: typeof data.stockL === 'number' ? data.stockL : 0,
        stockXL: typeof data.stockXL === 'number' ? data.stockXL : 0,
        unitPrice: typeof data.unitPrice === 'number' ? data.unitPrice : UNIT_PRICE,
      };
      inventoryLoaded = true;
      renderInventoryUI();
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, invPath);
    }
  );
}

function generateOrderCode(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  const code = `#NC-2026-${num}`;
  return ORDER_CODE_PATTERN.test(code) ? code : '#NC-2026-1001';
}

function generateOrderDocId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ord_${Date.now()}_${rand}`;
}

async function handleOrderSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const orderForm = document.getElementById('order-form') as HTMLFormElement | null;
  const formError = document.getElementById('form-error');
  const submitBtn = document.getElementById('order-submit-btn') as HTMLButtonElement | null;
  const orderConfirmation = document.getElementById('order-confirmation');
  const orderCodeEl = document.getElementById('order-code');
  const orderSummaryText = document.getElementById('order-summary-text');
  const waLinkEl = document.getElementById('order-wa-link') as HTMLAnchorElement | null;

  const nameInput = document.getElementById('buyer-name') as HTMLInputElement | null;
  const phoneInput = document.getElementById('buyer-phone') as HTMLInputElement | null;
  const addressInput = document.getElementById('buyer-address') as HTMLInputElement | null;

  if (!orderForm || !formError || !nameInput || !phoneInput || !addressInput) return;

  const showError = (message: string, focusEl?: HTMLElement | null) => {
    formError.textContent = message;
    formError.classList.remove('hidden');
    focusEl?.focus();
  };

  const customerName = nameInput.value.trim().slice(0, 80);
  const whatsapp = phoneInput.value.trim().slice(0, 20);
  const address = addressInput.value.trim().slice(0, 240);

  if (customerName.length < 2) {
    showError('Mohon masukkan nama lengkap Anda (minimal 2 karakter).', nameInput);
    return;
  }
  if (!WHATSAPP_PATTERN.test(whatsapp) || whatsapp.length < 9) {
    showError('Mohon masukkan nomor WhatsApp yang valid (9–20 karakter angka).', phoneInput);
    return;
  }
  if (address.length < 8) {
    showError('Mohon lengkapi alamat pengiriman beserta kecamatan dan kota tujuan.', addressInput);
    return;
  }
  if (!REGION_META[selectedRegion].codAllowed && selectedPayment === 'COD') {
    showError('Metode COD hanya tersedia untuk pengiriman Pulau Jawa.');
    return;
  }
  if (qty < 1 || qty > 10) {
    showError('Jumlah pesanan harus antara 1 hingga 10 pcs.');
    return;
  }

  const available = getStockForSize(selectedSize);
  if (inventoryLoaded && available < qty) {
    showError(
      available === 0
        ? `Maaf, stok ukuran ${selectedSize} baru saja habis. Silakan pilih ukuran lain.`
        : `Stok ukuran ${selectedSize} tersisa ${available} pcs.`
    );
    return;
  }

  formError.classList.add('hidden');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.loading = 'true';
    submitBtn.textContent = 'Menyimpan Pesanan ke Database...';
  }

  const orderId = generateOrderDocId();
  const orderCode = generateOrderCode();
  const totalPrice = qty * UNIT_PRICE;
  const invRef = doc(db, 'inventory', INVENTORY_DOC_ID);
  const orderRef = doc(db, 'orders', orderId);

  try {
    await runTransaction(db, async (transaction) => {
      const invSnap = await transaction.get(invRef);
      if (!invSnap.exists()) {
        throw new Error('STOCK_NOT_INITIALIZED');
      }

      const d = invSnap.data();
      const stockM = Number(d.stockM ?? 0);
      const stockL = Number(d.stockL ?? 0);
      const stockXL = Number(d.stockXL ?? 0);

      const currentSizeStock =
        selectedSize === 'M' ? stockM : selectedSize === 'L' ? stockL : stockXL;

      if (currentSizeStock < qty) {
        throw new Error(`INSUFFICIENT_STOCK:${currentSizeStock}`);
      }

      const nextStockM = selectedSize === 'M' ? stockM - qty : stockM;
      const nextStockL = selectedSize === 'L' ? stockL - qty : stockL;
      const nextStockXL = selectedSize === 'XL' ? stockXL - qty : stockXL;

      transaction.set(orderRef, {
        orderCode,
        customerName,
        whatsapp,
        address,
        region: selectedRegion,
        paymentMethod: selectedPayment,
        size: selectedSize,
        qty,
        unitPrice: UNIT_PRICE,
        totalPrice,
        status: 'baru',
        createdAt: serverTimestamp(),
      });

      transaction.update(invRef, {
        stockM: nextStockM,
        stockL: nextStockL,
        stockXL: nextStockXL,
        lastOrderId: orderId,
        updatedAt: serverTimestamp(),
      });
    });

    const regionInfo = REGION_META[selectedRegion];
    const totalLabel = formatRupiah(totalPrice);
    if (orderCodeEl) orderCodeEl.textContent = orderCode;
    if (orderSummaryText) {
      orderSummaryText.textContent = `Terima kasih, ${customerName}. Pesanan ${qty} pcs Kaos Nervis Club ukuran ${selectedSize} (${totalLabel}) via ${selectedPayment} ke ${address} (${regionInfo.label}, estimasi ${regionInfo.eta}) sudah tersimpan di database toko. Lanjutkan kirim bukti pesanan ke WhatsApp admin (+62 895-3429-24163).`;
    }

    if (waLinkEl) {
      const waMessage = encodeURIComponent(
        `Halo Nervis Club, saya ingin konfirmasi pesanan ${orderCode}:\n` +
          `- Nama: ${customerName}\n` +
          `- No. WA: ${whatsapp}\n` +
          `- Produk: Nervis Club Drop 01 (Washed Black)\n` +
          `- Ukuran: ${selectedSize}\n` +
          `- Jumlah: ${qty} pcs\n` +
          `- Pembayaran: ${selectedPayment}\n` +
          `- Wilayah Kirim: ${regionInfo.label} (${regionInfo.eta})\n` +
          `- Total: ${totalLabel}\n` +
          `- Alamat: ${address}`
      );
      waLinkEl.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMessage}`;
    }

    orderForm.hidden = true;
    if (orderConfirmation) orderConfirmation.hidden = false;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INSUFFICIENT_STOCK:')) {
      const rem = Number(error.message.split(':')[1] || '0');
      showError(
        rem <= 0
          ? `Maaf, stok ukuran ${selectedSize} baru saja habis. Silakan pilih ukuran lain.`
          : `Maaf, stok ukuran ${selectedSize} hanya tersisa ${rem} pcs.`
      );
      return;
    }
    if (error instanceof Error && error.message === 'STOCK_NOT_INITIALIZED') {
      await seedInitialInventoryIfNeeded();
      showError('Stok baru saja diinisialisasi. Silakan klik konfirmasi pesanan sekali lagi.');
      return;
    }
    showError('Terjadi kendala saat menyimpan pesanan ke database. Mohon periksa koneksi Anda.');
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  } finally {
    if (submitBtn) {
      delete submitBtn.dataset.loading;
      const totalRemaining =
        currentInventory.stockM + currentInventory.stockL + currentInventory.stockXL;
      submitBtn.disabled = totalRemaining <= 0;
      submitBtn.textContent =
        totalRemaining > 0 ? 'Konfirmasi Pesanan Edisi Perdana' : 'Kuota Batch 01 Habis';
    }
  }
}

function initOrderFormControls(): void {
  const sizeBtns = document.querySelectorAll<HTMLButtonElement>('.size-btn');
  const qtyMinus = document.getElementById('qty-minus');
  const qtyPlus = document.getElementById('qty-plus');
  const regionSelect = document.getElementById('buyer-region') as HTMLSelectElement | null;
  const paymentBtns = document.querySelectorAll<HTMLButtonElement>('.payment-btn');
  const orderForm = document.getElementById('order-form') as HTMLFormElement | null;
  const orderConfirmation = document.getElementById('order-confirmation');
  const orderResetBtn = document.getElementById('order-reset-btn');

  sizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = btn.getAttribute('data-size') as ShirtSize | null;
      if (size) applySelectedSize(size);
    });
  });

  window.addEventListener('nervis:select-size', ((evt: CustomEvent<{ size: ShirtSize }>) => {
    if (evt.detail?.size) {
      applySelectedSize(evt.detail.size);
    }
  }) as EventListener);

  qtyMinus?.addEventListener('click', () => {
    if (qty > 1) {
      qty -= 1;
      updateTotalUI();
    }
  });

  qtyPlus?.addEventListener('click', () => {
    const maxForSize = Math.min(10, Math.max(1, getStockForSize(selectedSize)));
    if (qty < maxForSize) {
      qty += 1;
      updateTotalUI();
    }
  });

  regionSelect?.addEventListener('change', () => {
    selectedRegion = (regionSelect.value as ShippingRegion) || 'jabodetabek_jabar';
    syncRegionAndPaymentUI();
  });

  paymentBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const method = btn.getAttribute('data-payment') as PaymentMethod | null;
      if (method) {
        selectedPayment = method;
        syncRegionAndPaymentUI();
      }
    });
  });

  orderForm?.addEventListener('submit', (e) => {
    void handleOrderSubmit(e);
  });

  orderResetBtn?.addEventListener('click', () => {
    orderForm?.reset();
    qty = 1;
    selectedRegion = 'jabodetabek_jabar';
    selectedPayment = 'QRIS';
    if (regionSelect) regionSelect.value = 'jabodetabek_jabar';
    syncRegionAndPaymentUI();
    updateTotalUI();
    if (orderConfirmation) orderConfirmation.hidden = true;
    if (orderForm) orderForm.hidden = false;
  });

  syncRegionAndPaymentUI();
  applySelectedSize(selectedSize);
}

document.addEventListener('DOMContentLoaded', () => {
  initOrderFormControls();
  subscribeInventory();
});
