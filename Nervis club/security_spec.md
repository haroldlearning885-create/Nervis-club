# Security Specification — Nervis Club Storefront & Admin

## 1. Data Invariants
1. **PII Isolation**: Dokumen di `/orders/{orderId}` berisi `customerName`, `whatsapp`, dan `address`. Hanya admin terverifikasi (`isAdmin()`) yang boleh membaca (`get`, `list`), memperbarui status (`update`), atau menghapus (`delete`). Pembeli anonim tidak boleh membaca pesanan orang lain.
2. **Order Creation Integrity**: Setiap pesanan baru wajib memiliki status awal `'baru'`, `unitPrice == 249000`, `qty` integer `1..10`, `totalPrice == qty * 249000`, `createdAt == request.time`, serta daftar kunci ketat (`hasAll` + `hasOnly`) tanpa field bayangan (`isAdmin`, `paid`, dll).
3. **Atomic Stock Integrity (`/inventory/drop01`)**: Pembeli publik tidak dapat mengubah `stockM`, `stockL`, atau `stockXL` secara sewenang-wenang. Pembaruan stok oleh non-admin hanya diizinkan jika dilakukan dalam batch atomik bersamaan dengan pembuatan `/orders/$(incoming().lastOrderId)` dan pengurangan tepat sebesar `qty` untuk ukuran yang dipesan, dengan hasil stok `>= 0`.
4. **Immutable Order Core Fields**: Saat admin mengubah status pesanan, `createdAt`, `orderCode`, `unitPrice`, `totalPrice`, `qty`, `size` tidak boleh diubah; hanya `status` dan `updatedAt` yang diizinkan berubah.
5. **Terminal State Lock**: Status `'selesai'` atau `'dibatalkan'` hanya dapat diubah oleh `isAdmin()` apabila diperlukan koreksi operasional.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Pembeli anonim mencoba `get` atau `list` pada `/orders` -> Ditolak (PII leak).
2. User terautentikasi non-admin mencoba `list` pada `/orders` -> Ditolak.
3. Pembeli mengirim pesanan dengan `status: "selesai"` saat `create` -> Ditolak (State Shortcutting).
4. Pembeli mengirim pesanan dengan `unitPrice: 1` atau `totalPrice: 100` -> Ditolak (Price Tampering).
5. Pembeli mengirim field tambahan `"isVerified": true` pada `/orders/{id}` -> Ditolak (Shadow Field Attack).
6. Pembeli mengirim `orderId` sepanjang 500 karakter berisi karakter spesial (`../admin`) -> Ditolak (`isValidId`).
7. Pembeli mengirim `createdAt` palsu (bukan `request.time`) -> Ditolak (Temporal Integrity).
8. Pembeli mengirim `qty: 50` atau `qty: -1` -> Ditolak (Boundary Violation).
9. Penyerang non-admin mencoba langsung `update` `/inventory/drop01` menjadi `stockM: 0` tanpa membuat order atomik -> Ditolak (`getAfter` + exact delta).
10. Penyerang mencoba menulis `stockM` pada `/inventory/drop01` dengan tipe string `"habis"` -> Ditolak.
11. User non-admin dengan email tidak terverifikasi mencoba akses admin (`email_verified: false`) -> Ditolak (`email_verified == true`).
12. User biasa mencoba menulis dokumen ke `/admins/{uid}` untuk eskalasi hak akses -> Ditolak.
