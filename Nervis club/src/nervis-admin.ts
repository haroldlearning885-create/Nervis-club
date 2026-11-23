import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  ADMIN_ALLOWLIST_EMAIL,
  auth,
  db,
  escapeHtml,
  formatRupiah,
  handleFirestoreError,
  INVENTORY_DOC_ID,
  OperationType,
  REGION_META,
  testConnection,
  UNIT_PRICE,
  type InventoryState,
  type OrderRecord,
  type OrderStatus,
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
let inventoryUnsubscribe: Unsubscribe | null = null;
let ordersUnsubscribe: Unsubscribe | null = null;
let cachedOrders: OrderRecord[] = [];
let statusFilter: 'semua' | OrderStatus = 'semua';
let searchQuery = '';

async function verifyAdminAccess(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email?.toLowerCase() === ADMIN_ALLOWLIST_EMAIL) return true;

  const adminPath = `admins/${user.uid}`;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    return adminSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, adminPath);
  }
}

function stopListeners(): void {
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }
  if (inventoryUnsubscribe) {
    inventoryUnsubscribe();
    inventoryUnsubscribe = null;
  }
  cachedOrders = [];
}

function syncStockInputs(): void {
  const inputM = document.getElementById('admin-stock-m') as HTMLInputElement | null;
  const inputL = document.getElementById('admin-stock-l') as HTMLInputElement | null;
  const inputXL = document.getElementById('admin-stock-xl') as HTMLInputElement | null;
  const kpiStock = document.getElementById('admin-kpi-stock');

  if (inputM && document.activeElement !== inputM) inputM.value = String(currentInventory.stockM);
  if (inputL && document.activeElement !== inputL) inputL.value = String(currentInventory.stockL);
  if (inputXL && document.activeElement !== inputXL) inputXL.value = String(currentInventory.stockXL);
  if (kpiStock) {
    kpiStock.textContent = `${
      currentInventory.stockM + currentInventory.stockL + currentInventory.stockXL
    } Pcs`;
  }
}

function subscribeAdminInventory(): void {
  if (inventoryUnsubscribe) inventoryUnsubscribe();
  const invPath = `inventory/${INVENTORY_DOC_ID}`;
  inventoryUnsubscribe = onSnapshot(
    doc(db, 'inventory', INVENTORY_DOC_ID),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      currentInventory = {
        stockM: typeof data.stockM === 'number' ? data.stockM : 0,
        stockL: typeof data.stockL === 'number' ? data.stockL : 0,
        stockXL: typeof data.stockXL === 'number' ? data.stockXL : 0,
        unitPrice: typeof data.unitPrice === 'number' ? data.unitPrice : UNIT_PRICE,
      };
      syncStockInputs();
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, invPath);
    }
  );
}

function renderAdminOrders(): void {
  const listEl = document.getElementById('admin-orders-list');
  const kpiOrders = document.getElementById('admin-kpi-orders');
  const kpiNew = document.getElementById('admin-kpi-new');
  const kpiRevenue = document.getElementById('admin-kpi-revenue');

  const activeOrders = cachedOrders.filter((o) => o.status !== 'dibatalkan');
  const newOrdersCount = cachedOrders.filter((o) => o.status === 'baru').length;
  const totalRevenue = activeOrders.reduce((acc, o) => acc + (o.totalPrice || 0), 0);

  if (kpiOrders) kpiOrders.textContent = String(cachedOrders.length);
  if (kpiNew) kpiNew.textContent = String(newOrdersCount);
  if (kpiRevenue) kpiRevenue.textContent = formatRupiah(totalRevenue);

  syncStockInputs();

  if (!listEl) return;

  const q = searchQuery.trim().toLowerCase();
  const filtered = cachedOrders.filter((o) => {
    const matchStatus = statusFilter === 'semua' || o.status === statusFilter;
    const matchSearch =
      q === '' ||
      o.orderCode.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.whatsapp.toLowerCase().includes(q) ||
      o.address.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  if (filtered.length === 0) {
    listEl.innerHTML =
      '<div class="p-8 text-center text-sm text-ash bg-white border border-hairline rounded-xl">Tidak ada pesanan yang cocok dengan filter saat ini.</div>';
    return;
  }

  const statuses: OrderStatus[] = ['baru', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];

  listEl.innerHTML = filtered
    .map((order) => {
      const regionLabel = REGION_META[order.region]?.label ?? order.region;
      const createdDate = order.createdAt?.toDate
        ? order.createdAt.toDate().toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Baru saja';

      const optionsHtml = statuses
        .map(
          (st) =>
            `<option value="${st}" ${order.status === st ? 'selected' : ''}>${
              st.charAt(0).toUpperCase() + st.slice(1)
            }</option>`
        )
        .join('');

      const cleanPhone = order.whatsapp.replace(/[^0-9]/g, '');
      const waTarget = cleanPhone.startsWith('0')
        ? `62${cleanPhone.slice(1)}`
        : cleanPhone.startsWith('62')
        ? cleanPhone
        : `62${cleanPhone}`;

      return `
        <article class="bg-white border border-hairline rounded-xl p-4 sm:p-5 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <div class="flex flex-wrap items-center gap-2.5">
              <span class="font-mono text-xs sm:text-sm font-bold text-crimson tabular-nums">${escapeHtml(
                order.orderCode
              )}</span>
              <span class="text-xs text-ash tabular-nums">${escapeHtml(createdDate)}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <label class="sr-only" for="status-${escapeHtml(order.id)}">Ubah status ${escapeHtml(
        order.orderCode
      )}</label>
              <select
                id="status-${escapeHtml(order.id)}"
                data-order-status-select="${escapeHtml(order.id)}"
                class="min-h-[38px] px-3 py-1 bg-canvas border border-hairline rounded-md text-xs font-semibold text-ink"
              >
                ${optionsHtml}
              </select>
              <button
                type="button"
                data-order-delete-btn="${escapeHtml(order.id)}"
                class="min-h-[38px] px-3 py-1 bg-canvas hover:bg-hairline border border-hairline text-xs font-semibold text-crimson rounded-md transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>

          <div
            data-order-delete-confirm-box="${escapeHtml(order.id)}"
            hidden
            class="p-3 bg-canvas border border-crimson/30 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span class="text-ink font-medium">Hapus pesanan ${escapeHtml(order.orderCode)} dari database?</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                data-order-delete-confirm="${escapeHtml(order.id)}"
                class="min-h-[34px] px-3 py-1 bg-crimson hover:bg-crimson-dark text-white font-semibold rounded transition-colors"
              >
                Hapus Permanen
              </button>
              <button
                type="button"
                data-order-delete-cancel="${escapeHtml(order.id)}"
                class="min-h-[34px] px-3 py-1 bg-white hover:bg-hairline border border-hairline text-ink font-semibold rounded transition-colors"
              >
                Batal
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm">
            <div class="space-y-1">
              <p class="font-bold text-ink text-sm sm:text-base">${escapeHtml(order.customerName)}</p>
              <p class="text-ash font-mono tabular-nums">
                WA: <a href="https://wa.me/${escapeHtml(
                  waTarget
                )}" target="_blank" rel="noopener noreferrer" class="text-ink underline hover:text-crimson">${escapeHtml(
        order.whatsapp
      )}</a>
              </p>
              <p class="text-ash leading-relaxed">${escapeHtml(order.address)}</p>
            </div>
            <div class="space-y-1 md:text-right">
              <p class="font-bold text-ink tabular-nums">
                Size ${escapeHtml(order.size)} &times; ${order.qty} pcs · ${formatRupiah(
        order.totalPrice
      )}
              </p>
              <p class="text-ash">${escapeHtml(order.paymentMethod)} · ${escapeHtml(regionLabel)}</p>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  listEl.querySelectorAll<HTMLSelectElement>('[data-order-status-select]').forEach((select) => {
    select.addEventListener('change', async () => {
      const orderId = select.getAttribute('data-order-status-select');
      const nextStatus = select.value as OrderStatus;
      if (!orderId) return;
      select.disabled = true;
      const orderPath = `orders/${orderId}`;
      try {
        await updateDoc(doc(db, 'orders', orderId), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, orderPath);
      } finally {
        select.disabled = false;
      }
    });
  });

  listEl.querySelectorAll<HTMLButtonElement>('[data-order-delete-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-order-delete-btn');
      if (!id) return;
      const box = listEl.querySelector<HTMLElement>(`[data-order-delete-confirm-box="${id}"]`);
      if (box) box.hidden = false;
    });
  });

  listEl.querySelectorAll<HTMLButtonElement>('[data-order-delete-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-order-delete-cancel');
      if (!id) return;
      const box = listEl.querySelector<HTMLElement>(`[data-order-delete-confirm-box="${id}"]`);
      if (box) box.hidden = true;
    });
  });

  listEl.querySelectorAll<HTMLButtonElement>('[data-order-delete-confirm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const orderId = btn.getAttribute('data-order-delete-confirm');
      if (!orderId) return;
      btn.disabled = true;
      btn.textContent = 'Menghapus...';
      const orderPath = `orders/${orderId}`;
      try {
        await deleteDoc(doc(db, 'orders', orderId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, orderPath);
      }
    });
  });
}

function attachAdminOrdersListener(): void {
  if (ordersUnsubscribe) ordersUnsubscribe();
  const ordersQuery = query(
    collection(db, 'orders'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  ordersUnsubscribe = onSnapshot(
    ordersQuery,
    (snapshot) => {
      cachedOrders = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          orderCode: String(data.orderCode ?? ''),
          customerName: String(data.customerName ?? ''),
          whatsapp: String(data.whatsapp ?? ''),
          address: String(data.address ?? ''),
          region: (data.region as ShippingRegion) ?? 'jabodetabek_jabar',
          paymentMethod: (data.paymentMethod as PaymentMethod) ?? 'QRIS',
          size: (data.size as ShirtSize) ?? 'L',
          qty: Number(data.qty ?? 1),
          unitPrice: Number(data.unitPrice ?? UNIT_PRICE),
          totalPrice: Number(data.totalPrice ?? UNIT_PRICE),
          status: (data.status as OrderStatus) ?? 'baru',
          createdAt: (data.createdAt as Timestamp | undefined) ?? null,
        };
      });
      renderAdminOrders();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  const viewLoading = document.getElementById('admin-view-loading');
  const viewLoggedOut = document.getElementById('admin-view-logged-out');
  const viewUnauthorized = document.getElementById('admin-view-unauthorized');
  const viewDashboard = document.getElementById('admin-view-dashboard');
  const authEmailDisplay = document.getElementById('admin-email-display');
  const unauthorizedEmailDisplay = document.getElementById('admin-unauthorized-email');
  const searchInput = document.getElementById('admin-order-search') as HTMLInputElement | null;
  const stockForm = document.getElementById('admin-stock-form') as HTMLFormElement | null;
  const stockFeedback = document.getElementById('admin-stock-feedback');
  const resetTriggerBtn = document.getElementById('admin-reset-trigger-btn') as HTMLButtonElement | null;
  const resetConfirmBox = document.getElementById('admin-reset-confirm-box');
  const resetConfirmBtn = document.getElementById('admin-reset-confirm-btn') as HTMLButtonElement | null;
  const resetCancelBtn = document.getElementById('admin-reset-cancel-btn');
  const resetFeedback = document.getElementById('admin-reset-feedback');

  resetTriggerBtn?.addEventListener('click', () => {
    if (resetConfirmBox) resetConfirmBox.hidden = false;
    resetFeedback?.classList.add('hidden');
  });

  resetCancelBtn?.addEventListener('click', () => {
    if (resetConfirmBox) resetConfirmBox.hidden = true;
  });

  resetConfirmBtn?.addEventListener('click', async () => {
    if (!resetConfirmBtn) return;
    resetConfirmBtn.disabled = true;
    resetConfirmBtn.textContent = 'Mereset Database...';

    let deletedCount = 0;
    try {
      const ordersSnap = await getDocs(collection(db, 'orders'));
      const docs = ordersSnap.docs;

      // Hapus pesanan dalam chunk agar aman terhadap batas 500 operasi per batch Firestore
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 400);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deletedCount += chunk.length;
      }
    } catch (error) {
      resetConfirmBtn.disabled = false;
      resetConfirmBtn.textContent = 'Ya, Hapus & Reset';
      handleFirestoreError(error, OperationType.DELETE, 'orders');
    }

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
      resetConfirmBtn.disabled = false;
      resetConfirmBtn.textContent = 'Ya, Hapus & Reset';
      handleFirestoreError(error, OperationType.WRITE, invPath);
    }

    if (resetConfirmBox) resetConfirmBox.hidden = true;
    resetConfirmBtn.disabled = false;
    resetConfirmBtn.textContent = 'Ya, Hapus & Reset';

    if (resetFeedback) {
      resetFeedback.textContent = `Selesai: ${deletedCount} pesanan dihapus dan stok dikembalikan ke M: 50, L: 50, XL: 50 (150 pcs).`;
      resetFeedback.classList.remove('hidden', 'text-crimson');
      resetFeedback.classList.add('text-emerald-700');
    }
  });

  document.getElementById('admin-google-signin-btn')?.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login Google Admin gagal atau dibatalkan:', error);
    }
  });

  const handleSignOut = async () => {
    stopListeners();
    await signOut(auth);
  };

  document.getElementById('admin-signout-btn')?.addEventListener('click', () => void handleSignOut());
  document
    .getElementById('admin-unauthorized-signout-btn')
    ?.addEventListener('click', () => void handleSignOut());

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderAdminOrders();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-admin-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = (btn.getAttribute('data-admin-filter') as 'semua' | OrderStatus) || 'semua';
      document.querySelectorAll<HTMLButtonElement>('[data-admin-filter]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('bg-ink', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('text-ash', !active);
      });
      renderAdminOrders();
    });
  });

  stockForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputM = document.getElementById('admin-stock-m') as HTMLInputElement | null;
    const inputL = document.getElementById('admin-stock-l') as HTMLInputElement | null;
    const inputXL = document.getElementById('admin-stock-xl') as HTMLInputElement | null;
    if (!inputM || !inputL || !inputXL) return;

    const nextM = Math.max(0, Math.min(500, Math.floor(Number(inputM.value || 0))));
    const nextL = Math.max(0, Math.min(500, Math.floor(Number(inputL.value || 0))));
    const nextXL = Math.max(0, Math.min(500, Math.floor(Number(inputXL.value || 0))));

    const invPath = `inventory/${INVENTORY_DOC_ID}`;
    try {
      await updateDoc(doc(db, 'inventory', INVENTORY_DOC_ID), {
        stockM: nextM,
        stockL: nextL,
        stockXL: nextXL,
        unitPrice: UNIT_PRICE,
        updatedAt: serverTimestamp(),
      });
      if (stockFeedback) {
        stockFeedback.textContent = 'Stok berhasil diperbarui ke toko utama.';
        stockFeedback.classList.remove('hidden', 'text-crimson');
        stockFeedback.classList.add('text-emerald-700');
      }
    } catch (error) {
      if (stockFeedback) {
        stockFeedback.textContent = 'Gagal memperbarui stok.';
        stockFeedback.classList.remove('hidden', 'text-emerald-700');
        stockFeedback.classList.add('text-crimson');
      }
      handleFirestoreError(error, OperationType.UPDATE, invPath);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    stopListeners();
    viewLoading?.classList.add('hidden');

    if (!user) {
      viewLoggedOut?.classList.remove('hidden');
      viewUnauthorized?.classList.add('hidden');
      viewDashboard?.classList.add('hidden');
      return;
    }

    const isAdmin = await verifyAdminAccess(user);
    if (!isAdmin) {
      viewLoggedOut?.classList.add('hidden');
      viewUnauthorized?.classList.remove('hidden');
      viewDashboard?.classList.add('hidden');
      if (unauthorizedEmailDisplay) {
        unauthorizedEmailDisplay.textContent = user.email || '(tanpa email)';
      }
      return;
    }

    viewLoggedOut?.classList.add('hidden');
    viewUnauthorized?.classList.add('hidden');
    viewDashboard?.classList.remove('hidden');
    if (authEmailDisplay) authEmailDisplay.textContent = user.email || ADMIN_ALLOWLIST_EMAIL;

    subscribeAdminInventory();
    attachAdminOrdersListener();
  });
});
