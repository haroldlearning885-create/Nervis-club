import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, Timestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- 1. Firebase Initialization ---
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const ADMIN_ALLOWLIST_EMAIL = 'haroldlearning885@gmail.com';
export const UNIT_PRICE = 249000;
export const INVENTORY_DOC_ID = 'drop01';
export const WHATSAPP_NUMBER = '62895342924163';

// --- 2. Mandatory Structured Error Handling ---
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- 3. Boot-time Firestore Connection Verification ---
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

// --- 4. Shared Domain Types & Helpers ---
export type ShirtSize = 'M' | 'L' | 'XL';
export type ShippingRegion = 'jabodetabek_jabar' | 'jawa_tengah_timur' | 'luar_jawa';
export type PaymentMethod = 'QRIS' | 'Transfer Bank' | 'COD';
export type OrderStatus = 'baru' | 'diproses' | 'dikirim' | 'selesai' | 'dibatalkan';

export interface InventoryState {
  stockM: number;
  stockL: number;
  stockXL: number;
  unitPrice: number;
}

export interface OrderRecord {
  id: string;
  orderCode: string;
  customerName: string;
  whatsapp: string;
  address: string;
  region: ShippingRegion;
  paymentMethod: PaymentMethod;
  size: ShirtSize;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  status: OrderStatus;
  createdAt?: Timestamp | null;
}

export const REGION_META: Record<
  ShippingRegion,
  { label: string; eta: string; codAllowed: boolean; shippingNote: string }
> = {
  jabodetabek_jabar: {
    label: 'Jabodetabek & Jawa Barat',
    eta: '1–2 hari kerja dari Bandung',
    codAllowed: true,
    shippingNote: 'Mendukung QRIS, Transfer Bank, dan COD.',
  },
  jawa_tengah_timur: {
    label: 'Jawa Tengah, DIY & Jawa Timur',
    eta: '2–3 hari kerja dari Bandung',
    codAllowed: true,
    shippingNote: 'Mendukung QRIS, Transfer Bank, dan COD.',
  },
  luar_jawa: {
    label: 'Sumatera, Kalimantan, Sulawesi & Luar Jawa',
    eta: '3–6 hari kerja via kargo/reguler udara',
    codAllowed: false,
    shippingNote: 'Khusus pembayaran non-tunai (QRIS atau Transfer Bank).',
  },
};

export const ORDER_CODE_PATTERN = /^#NC-2026-[0-9]{4}$/;
export const WHATSAPP_PATTERN = /^[0-9+\s-]{9,20}$/;

export function formatRupiah(amount: number): string {
  return 'Rp ' + amount.toLocaleString('id-ID');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
